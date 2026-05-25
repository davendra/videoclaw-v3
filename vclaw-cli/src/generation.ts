/**
 * Video generation module for veo-cli
 * Handles T2V, I2V, Frames-to-Video, and Ingredients/References generation
 */

import { randomUUID } from "crypto";
import type { Project, Operation, VideoAspectRatio, Session } from "./types";
import { createTimeoutController, TARGET_PAGE_URL } from "./api";

// User agent (set from main module)
let userAgent = "";

/**
 * Set user agent for generation requests
 */
export function setGenerationUserAgent(ua: string): void {
  userAgent = ua;
}

// Video model key type
export type VideoModelKey = string;

/**
 * Generate a random seed
 */
export function genSeed(max: number = 0xf4240): number {
  return Math.floor(Math.random() * max);
}

// Base options for video generation
export type Veo3Options = {
  project: Project;
  isSeedLocked: boolean;
  recaptchaToken: string;
  outputsPerPrompt: number;
  videoModelKey: VideoModelKey;
  aspectRatio: VideoAspectRatio;
  requestTimeoutMs?: number;
  statusTimeoutMs?: number;
  userPaygateTier: string;
  seed?: number;
  /** Delay in ms to wait for media ingestion before API call. Default: 0 for T2V, 5000 for I2V/F2V/R2V modes */
  mediaIngestionDelayMs?: number;
};

// Options for image-based video generation
export type ImageVideoOptions = Veo3Options & {
  startImageId: string;
  endImageId?: string;
};

// Options for reference-based video generation
export type ReferenceVideoOptions = Veo3Options & {
  referenceImageIds: string[];
};

// Internal session type for API calls
type InternalSession = {
  access_token: string;
  user?: { name: string; image?: string };
};

const BASE_API_URL = "https://aisandbox-pa.googleapis.com/v1";

/**
 * Build a descriptive error message with actionable guidance for common HTTP status codes.
 * Prepends context-specific advice while preserving the raw response body for debugging.
 */
function formatHttpError(context: string, status: number, statusText: string, body: string): string {
  let guidance = "";

  switch (status) {
    case 401:
      guidance =
        "Authentication failed. Session cookies expired.\n" +
        "  Re-login with: bun run flow.ts --visible\n\n";
      break;
    case 403:
      guidance =
        "Access denied. Your session may have expired. Try:\n" +
        "  1. Re-login: bun run flow.ts --visible\n" +
        "  2. Check account tier supports this model\n" +
        "  3. Verify project access\n\n";
      break;
    case 429:
      guidance =
        "Rate limited. Wait a few minutes and retry, or reduce --count.\n\n";
      break;
    case 400:
      guidance =
        "Bad request. The prompt or parameters may be invalid.\n" +
        "  Check aspect ratio, model key, and image IDs.\n\n";
      break;
    case 500:
    case 502:
    case 503:
      guidance =
        "Google API server error. This is usually transient.\n" +
        "  Wait a moment and retry. If persistent, check https://status.cloud.google.com\n\n";
      break;
  }

  return `${context}: ${guidance}${status} ${statusText} - ${body}`;
}

/**
 * Normalize session to internal format
 */
function toInternalSession(session: Session | InternalSession): InternalSession {
  if ("access_token" in session) {
    return session as InternalSession;
  }
  return { access_token: (session as Session).accessToken };
}

/**
 * Poll operations for completion status
 */
async function pollOperations(
  operations: any[],
  headers: Headers,
  statusTimeoutMs: number
): Promise<Operation[]> {
  const statusMap = new Map<string, Operation>(
    operations.map((op: any) => [op.sceneId, op])
  );

  return new Promise((resolve, reject) => {
    let pendingOps = [...operations];
    let attempts = 0;

    const interval = setInterval(async () => {
      try {
        attempts += 1;
        if (attempts > 250) {
          clearInterval(interval);
          reject(new Error("Exceeded max polling attempts for video status"));
          return;
        }

        if (pendingOps.length === 0) {
          clearInterval(interval);
          resolve([...statusMap.values()]);
          return;
        }

        const statusController = createTimeoutController(statusTimeoutMs);
        const response = await fetch(
          BASE_API_URL + "/video:batchCheckAsyncVideoGenerationStatus",
          {
            headers,
            method: "POST",
            body: JSON.stringify({ operations: pendingOps }),
            signal: statusController.signal,
          }
        ).finally(statusController.cancel);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          throw new Error(
            formatHttpError("Video status check failed", response.status, response.statusText, errorBody)
          );
        }

        const data: any = await response.json();
        pendingOps = data.operations.filter((op: any) => {
          // Track successful operations
          if (
            typeof op.operation === "object" &&
            op.status === "MEDIA_GENERATION_STATUS_SUCCESSFUL"
          ) {
            statusMap.set(op.sceneId, op);
            return false; // Remove from polling
          }
          // Also stop polling failed operations
          if (op.status === "MEDIA_GENERATION_STATUS_FAILED") {
            console.log(`  Video generation failed for scene ${op.sceneId}`);
            statusMap.set(op.sceneId, op);
            return false; // Remove from polling
          }
          return true; // Keep polling in-progress operations
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`Status check attempt ${attempts} failed: ${msg}`);
      }
    }, 3_000);
  });
}

/**
 * Create headers for API requests
 */
function createHeaders(session: InternalSession): Headers {
  return new Headers({
    "user-agent": userAgent,
    "content-type": "text/plain",
    origin: TARGET_PAGE_URL.origin,
    referer: TARGET_PAGE_URL.origin + "/",
    authorization: "Bearer " + session.access_token,
  });
}

/**
 * Build base request object for video generation
 */
function buildBaseRequest(options: Veo3Options): Record<string, unknown> {
  return {
    aspectRatio: options.aspectRatio,
    seed: options.isSeedLocked ? 1234567 : (options.seed ?? genSeed(0x7fff)),
    videoModelKey: options.videoModelKey,
    metadata: { sceneId: randomUUID() },
  };
}

/**
 * Build client context for API payload
 */
function buildClientContext(options: Veo3Options): Record<string, unknown> {
  return {
    tool: "PINHOLE",
    sessionId: ";" + Date.now(),
    projectId: options.project.projectId,
    recaptchaToken: options.recaptchaToken,
    userPaygateTier: options.userPaygateTier,
  };
}

/**
 * Execute video generation request and poll for completion
 */
async function executeVideoGeneration(
  session: Session | InternalSession,
  endpoint: string,
  payload: Record<string, unknown>,
  options: Veo3Options
): Promise<Operation[]> {
  const internalSession = toInternalSession(session);
  const headers = createHeaders(internalSession);
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const statusTimeoutMs = options.statusTimeoutMs ?? 30_000;

  // Wait for media ingestion if delay is specified (for I2V/F2V/R2V modes with uploaded images)
  const mediaIngestionDelayMs = options.mediaIngestionDelayMs ?? 0;
  if (mediaIngestionDelayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, mediaIngestionDelayMs));
  }

  if (endpoint.includes('ReferenceImages') && process.env.VEO_DEBUG_R2V === '1') {
    console.log('  [R2V Debug] Endpoint:', endpoint);
    console.log('  [R2V Debug] Request payload:', JSON.stringify(payload, null, 2));
  }

  const createController = createTimeoutController(requestTimeoutMs);
  const response = await fetch(BASE_API_URL + endpoint, {
    headers,
    method: "POST",
    body: JSON.stringify(payload),
    signal: createController.signal,
  }).finally(createController.cancel);

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpError("Failed to create video", response.status, response.statusText, responseBody)
    );
  }

  const { operations } = JSON.parse(responseBody);
  return pollOperations(operations, headers, statusTimeoutMs);
}

/**
 * Create video from text prompt (Text-to-Video / T2V mode)
 */
export async function createVideoText(
  session: Session | InternalSession,
  prompt: string,
  options: Veo3Options
): Promise<Operation[]> {
  const requests = Array(options.outputsPerPrompt)
    .fill(null)
    .map(() => ({
      ...buildBaseRequest(options),
      textInput: { prompt },
    }));

  const payload = {
    clientContext: buildClientContext(options),
    requests,
  };

  return executeVideoGeneration(
    session,
    "/video:batchAsyncGenerateVideoText",
    payload,
    options
  );
}

/**
 * Create video from a single start image (Image-to-Video / I2V mode)
 */
export async function createVideoImage(
  session: Session | InternalSession,
  prompt: string,
  options: ImageVideoOptions
): Promise<Operation[]> {
  const requests = Array(options.outputsPerPrompt)
    .fill(null)
    .map(() => ({
      ...buildBaseRequest(options),
      textInput: { prompt },
      startImage: { mediaId: options.startImageId },
    }));

  const payload = {
    clientContext: buildClientContext(options),
    requests,
  };

  return executeVideoGeneration(
    session,
    "/video:batchAsyncGenerateVideoStartImage",
    payload,
    options
  );
}

/**
 * Create video from start and end frames (First-Last / I2V-FL mode)
 */
export async function createVideoFrames(
  session: Session | InternalSession,
  prompt: string,
  options: ImageVideoOptions & { endImageId: string }
): Promise<Operation[]> {
  const requests = Array(options.outputsPerPrompt)
    .fill(null)
    .map(() => ({
      ...buildBaseRequest(options),
      textInput: { prompt },
      startImage: { mediaId: options.startImageId },
      endImage: { mediaId: options.endImageId },
    }));

  const payload = {
    clientContext: buildClientContext(options),
    requests,
  };

  return executeVideoGeneration(
    session,
    "/video:batchAsyncGenerateVideoStartAndEndImage",
    payload,
    options
  );
}

/**
 * Create video using reference images (R2V / Ingredients mode)
 * Uses referenceImages array with imageUsageType and mediaId (Flow API format)
 * Requires veo_3_0_r2v_* model keys
 */
export async function createVideoIngredients(
  session: Session | InternalSession,
  prompt: string,
  options: ReferenceVideoOptions
): Promise<Operation[]> {
  // Build referenceImages array (Flow API format with imageUsageType)
  const referenceImages = options.referenceImageIds.slice(0, 3).map(id => ({
    imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
    mediaId: id
  }));

  const requests = Array(options.outputsPerPrompt)
    .fill(null)
    .map(() => ({
      ...buildBaseRequest(options),
      textInput: { prompt },
      referenceImages,
    }));

  const payload = {
    clientContext: buildClientContext(options),
    requests,
  };

  return executeVideoGeneration(
    session,
    "/video:batchAsyncGenerateVideoReferenceImages",
    payload,
    options
  );
}
