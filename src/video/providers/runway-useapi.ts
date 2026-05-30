export type RunwayModel = 'gen-4.5' | 'gen-4' | 'gen-4-turbo' | 'seedance-2.0';
export type RunwayMode = 'explore' | 'credits';
export type RunwayAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
export type RunwayResolution = '720p' | '1080p';
/**
 * Valid duration depends on the model:
 *   - Gen-4.5 / Gen-4 / Gen-4 Turbo: 5, 8, 10
 *   - Seedance 2.0 (via /videos/create): 5, 8, 10, 15
 * Other models have their own ranges. UseAPI enforces server-side.
 */
export type RunwayDurationSeconds = 5 | 8 | 10 | 15;

/**
 * Minimal `fetch` shape that allows tests to inject a mock without depending
 * on a full DOM `Response` type. Compatible with both `globalThis.fetch` and
 * the matching helper in `../native-runway.ts`.
 */
export type RunwayFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface SubmitRunwayJobInput {
  apiToken: string;
  model: RunwayModel;
  textPrompt: string;
  mode: RunwayMode;
  seconds?: RunwayDurationSeconds;
  aspectRatio?: RunwayAspectRatio;
  resolution?: RunwayResolution;
  seed?: number;
  /** Optional fetch override (defaults to global fetch). Used by tests + native wrapper. */
  fetchImpl?: RunwayFetchLike;
  /**
   * UseAPI asset id (not a URL) — e.g. "user:2305-runwayml:email@example.com:uuid".
   * Switches Gen-4.5 / Gen-4 into image-to-video mode. Not supported on
   * /runwayml/videos/create for all models — check the endpoint docs.
   */
  firstImageAssetId?: string;
  /**
   * UseAPI asset id used as the Seedance-2 keyframe (first frame) on the
   * unified /runwayml/videos/create endpoint. Distinct from
   * firstImageAssetId (Gen-4.x i2v) — Seedance-2 uses startFrameAssetId.
   */
  startFrameAssetId?: string;
  /**
   * Seedance-2 multi-reference image asset ids (up to 11). When more than one
   * is supplied on the `seedance-2.0` model, the request emits individual
   * `imageAssetId1`..`imageAssetIdN` fields (1-based, capped at 11) and does
   * NOT set `startFrameAssetId` — keyframe mode and multi-reference mode are
   * mutually exclusive per the UseAPI Runway contract. Exactly one id keeps the
   * single-keyframe `startFrameAssetId` path. See
   * `references/video/seedance-transport-payloads.md` (Gateway B).
   */
  imageAssetIds?: string[];
  /**
   * Seedance-2 multi-reference video asset ids (up to 3). Emitted as
   * `videoAssetId`, `videoAssetId2`, `videoAssetId3`.
   */
  videoAssetIds?: string[];
}

/** Runway Seedance-2 caps: up to 11 image refs, up to 3 video refs. */
export const RUNWAY_MAX_IMAGE_REFS = 11;
export const RUNWAY_MAX_VIDEO_REFS = 3;

export interface SubmitRunwayJobResult {
  /** Namespaced taskId, e.g. "user:N-runwayml:email@x:task:uuid". Use as-is in poll/fetch. */
  taskId: string;
}

const USEAPI_BASE = 'https://api.useapi.net/v1';

interface EndpointRouting {
  url: string;
  /** If true, the model name must be included in the request body. */
  includesModelInBody: boolean;
  /** Field name for duration on this endpoint: gen4_5/gen4 use 'seconds'; videos/create uses 'duration'. */
  durationField: 'seconds' | 'duration';
}

function endpointForModel(model: RunwayModel): EndpointRouting {
  switch (model) {
    case 'gen-4.5':
      return { url: `${USEAPI_BASE}/runwayml/gen4_5/create`, includesModelInBody: false, durationField: 'seconds' };
    case 'gen-4':
      return { url: `${USEAPI_BASE}/runwayml/gen4/create`, includesModelInBody: false, durationField: 'seconds' };
    case 'gen-4-turbo':
      return { url: `${USEAPI_BASE}/runwayml/gen4turbo/create`, includesModelInBody: false, durationField: 'seconds' };
    case 'seedance-2.0':
      return { url: `${USEAPI_BASE}/runwayml/videos/create`, includesModelInBody: true, durationField: 'duration' };
  }
}

/** Maps our internal model alias to the string UseAPI's unified endpoint expects. */
function unifiedModelName(model: RunwayModel): string {
  if (model === 'seedance-2.0') return 'seedance-2';
  return model;
}

export async function submitRunwayJob(input: SubmitRunwayJobInput): Promise<SubmitRunwayJobResult> {
  const routing = endpointForModel(input.model);
  const body: Record<string, unknown> = {
    text_prompt: input.textPrompt,
    exploreMode: input.mode === 'explore',
  };
  if (routing.includesModelInBody) {
    body.model = unifiedModelName(input.model);
  }
  if (input.seconds) body[routing.durationField] = input.seconds;
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  if (input.resolution) body.resolution = input.resolution;
  if (input.seed) body.seed = input.seed;
  if (input.firstImageAssetId) body.firstImage_assetId = input.firstImageAssetId;

  // Seedance-2 multi-reference: when >1 image asset id is supplied, emit the
  // individual `imageAssetId1`..`imageAssetIdN` fields (1-based, capped 11) and
  // OMIT `startFrameAssetId` — keyframe and multi-ref modes are mutually
  // exclusive. Exactly one image asset id falls through to the single
  // `startFrameAssetId` keyframe path (unchanged behavior). Multi-ref is only
  // valid on the unified seedance-2 endpoint.
  const imageRefs = (input.imageAssetIds ?? []).filter((id) => !!id);
  const videoRefs = (input.videoAssetIds ?? []).filter((id) => !!id);
  const useMultiRef = input.model === 'seedance-2.0' && imageRefs.length > 1;

  if (useMultiRef) {
    if (imageRefs.length > RUNWAY_MAX_IMAGE_REFS) {
      throw new Error(
        `Runway seedance-2 multi-reference accepts at most ${RUNWAY_MAX_IMAGE_REFS} image refs (got ${imageRefs.length}).`,
      );
    }
    if (videoRefs.length > RUNWAY_MAX_VIDEO_REFS) {
      throw new Error(
        `Runway seedance-2 multi-reference accepts at most ${RUNWAY_MAX_VIDEO_REFS} video refs (got ${videoRefs.length}).`,
      );
    }
    imageRefs.forEach((assetId, idx) => {
      body[`imageAssetId${idx + 1}`] = assetId;
    });
    videoRefs.forEach((assetId, idx) => {
      body[idx === 0 ? 'videoAssetId' : `videoAssetId${idx + 1}`] = assetId;
    });
    // startFrameAssetId is intentionally NOT set in multi-ref mode.
  } else {
    if (input.startFrameAssetId) body.startFrameAssetId = input.startFrameAssetId;
    // Single-ref convenience: a lone image asset id routes to the keyframe
    // field on the seedance-2 endpoint when startFrameAssetId was not given.
    if (!input.startFrameAssetId && input.model === 'seedance-2.0' && imageRefs.length === 1) {
      body.startFrameAssetId = imageRefs[0];
    }
    if (videoRefs.length > 0) {
      videoRefs.slice(0, RUNWAY_MAX_VIDEO_REFS).forEach((assetId, idx) => {
        body[idx === 0 ? 'videoAssetId' : `videoAssetId${idx + 1}`] = assetId;
      });
    }
  }

  const fetchImpl = input.fetchImpl ?? (fetch as unknown as RunwayFetchLike);
  const response = await fetchImpl(routing.url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runway submit failed: ${response.status} ${text}`);
  }
  const json = (await response.json()) as { task?: { taskId?: string; id?: string }; code?: number };
  const taskId = json.task?.taskId ?? json.task?.id;
  if (!taskId) {
    throw new Error(`Runway submit returned unexpected shape (no task.taskId or task.id): ${JSON.stringify(json)}`);
  }
  return { taskId };
}

export interface PollRunwayJobInput {
  apiToken: string;
  /** Namespaced taskId from SubmitRunwayJobResult. */
  taskId: string;
  /** Optional fetch override (defaults to global fetch). */
  fetchImpl?: RunwayFetchLike;
}

export type RunwayPollStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RunwayArtifact {
  /** Signed CloudFront URL of the rendered video. JWT in query string — expires. */
  url?: string;
  /** Pre-signed JPG preview thumbnails (typically 3-5 frames sampled across the clip). */
  previewUrls?: string[];
  /** Reusable Runway asset id for chaining into i2v / multi-shot workflows. */
  assetId?: string;
  fileSize?: string;
  metadata?: {
    duration?: number;
    frameRate?: number;
    dimensions?: [number, number];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PollRunwayJobResult {
  status: RunwayPollStatus;
  /** 0.0 - 1.0 progress fraction, parsed from UseAPI's stringy progressRatio. */
  progress: number;
  artifacts: RunwayArtifact[];
  raw: Record<string, unknown>;
}

export async function pollRunwayJob(input: PollRunwayJobInput): Promise<PollRunwayJobResult> {
  // UseAPI's path params are passed verbatim (no encoding). The namespaced
  // taskId contains ':' which is valid in URL paths.
  const url = `${USEAPI_BASE}/runwayml/tasks/${input.taskId}`;
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as RunwayFetchLike);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${input.apiToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runway poll failed: ${response.status} ${text}`);
  }
  const json = (await response.json()) as {
    status: string;
    progressRatio?: string;
    artifacts?: unknown[];
  };
  const status: RunwayPollStatus = mapPollStatus(json.status);
  const progress = json.progressRatio !== undefined ? parseFloat(json.progressRatio) : 0;
  return {
    status,
    progress: Number.isFinite(progress) ? progress : 0,
    artifacts: (json.artifacts ?? []) as RunwayArtifact[],
    raw: json as Record<string, unknown>,
  };
}

function mapPollStatus(raw: string): RunwayPollStatus {
  const s = raw.toUpperCase();
  if (s === 'COMPLETED' || s === 'SUCCEEDED' || s === 'DONE') return 'completed';
  if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED' || s === 'CANCELLED') return 'failed';
  if (s === 'RUNNING') return 'running';
  return 'pending'; // PENDING, QUEUED, INITIALIZING, etc.
}

export interface FetchRunwayResultInput {
  apiToken: string;
  taskId: string;
  /** Optional fetch override (defaults to global fetch). */
  fetchImpl?: RunwayFetchLike;
}

export interface FetchRunwayResultResult {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  raw: Record<string, unknown>;
}

/**
 * Convenience: poll once and extract the first artifact's video + thumbnail URLs.
 * Use after a poll has returned status='completed'.
 */
export async function fetchRunwayResult(input: FetchRunwayResultInput): Promise<FetchRunwayResultResult> {
  const polled = await pollRunwayJob({
    apiToken: input.apiToken,
    taskId: input.taskId,
    fetchImpl: input.fetchImpl,
  });
  const first = polled.artifacts[0];
  return {
    videoUrl: first?.url ?? null,
    thumbnailUrl: first?.previewUrls?.[0] ?? null,
    raw: polled.raw,
  };
}

export interface RegisterRunwayAccountInput {
  apiToken: string;
  email: string;
  password: string;
  maxJobs: number;
}

export interface RegisterRunwayAccountResult {
  /** JWT bearer token UseAPI uses to authenticate against the user's Runway session. */
  token: string;
  /** UseAPI internal account id. */
  id: number;
  exp: number;
  iat: number;
}

export async function registerRunwayAccount(input: RegisterRunwayAccountInput): Promise<RegisterRunwayAccountResult> {
  if (input.maxJobs < 1 || input.maxJobs > 10) {
    throw new Error('maxJobs must be 1-10');
  }
  // UseAPI's server does NOT URL-decode the email path param. Verbatim is required.
  const url = `${USEAPI_BASE}/runwayml/accounts/${input.email}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: input.email, password: input.password, maxJobs: input.maxJobs }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runway account registration failed: ${response.status} ${text}`);
  }
  // UseAPI wraps the JWT response in `{...creds, jwt: {token, id, exp, iat}}`
  // Some responses return the JWT at the top level — handle both shapes.
  const json = (await response.json()) as {
    token?: string; id?: number; exp?: number; iat?: number;
    jwt?: { token: string; id: number; exp: number; iat: number };
  };
  if (json.jwt) {
    return json.jwt;
  }
  if (json.token && json.id !== undefined) {
    return { token: json.token, id: json.id, exp: json.exp ?? 0, iat: json.iat ?? 0 };
  }
  throw new Error(`Runway account registration returned unexpected shape: ${JSON.stringify(json)}`);
}
