/**
 * useapi.net Backend for veo-cli
 * Uses useapi.net REST API for video generation
 */

import { join } from "path";
import { existsSync } from "fs";
import type { Operation, VideoAspectRatio } from "../../types";
import type {
  BackendInitOptions,
  DirectResources,
  HealthResult,
  VideoRequest,
  VideoGenerationResult,
  ImageUploadResult,
  AccountTier,
  CostEstimate,
  VideoBackend,
  UseApiVideoParams,
  UseApiVideoResponse,
} from "../types";
import {
  UseApiClient,
  mapModelToUseApi,
  mapAspectRatioToUseApi,
  calculateCost,
} from "./client";
import { log } from "../../config";
import { download } from "../../download";

/**
 * Normalize a Google Flow video response into a flat media list.
 * Prefers the current `media[]` (200 sync) shape; falls back to the legacy
 * `operations[].operation.metadata.video.fifeUrl` shape used by async + upscale.
 */
export function transformVideoResponse(
  resp: UseApiVideoResponse
): Array<{
  mediaGenerationId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  seed?: number;
  status?: string;
}> {
  if (resp.media && resp.media.length > 0) {
    return resp.media.map((m) => ({
      mediaGenerationId: m.mediaGenerationId,
      videoUrl: m.videoUrl,
      thumbnailUrl: m.thumbnailUrl,
      seed: m.video?.generatedVideo?.seed,
    }));
  }
  return (resp.operations ?? []).map((op) => ({
    mediaGenerationId: op.mediaGenerationId,
    videoUrl: op.operation?.metadata?.video?.fifeUrl,
    thumbnailUrl: op.operation?.metadata?.video?.servingBaseUri,
    seed: op.operation?.metadata?.video?.seed,
    status: op.status,
  }));
}

/**
 * useapi.net Backend implementation
 * Uses REST API for video generation
 */
export class UseApiBackend implements VideoBackend {
  readonly name = "useapi" as const;
  readonly requiresBrowser = false;

  private options: BackendInitOptions;
  private client: UseApiClient | null = null;
  private accountEmail: string = "";
  private accountTier: AccountTier = "unknown";
  private initialized = false;
  private webhookUrl?: string;
  private skipConfirmation: boolean = false;

  constructor(options: BackendInitOptions) {
    this.options = options;
    this.webhookUrl = options.webhookUrl;
    this.skipConfirmation = options.skipConfirmation ?? false;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Get configuration from environment or options
    const apiToken = this.options.config.useapi?.apiToken || process.env.USEAPI_API_TOKEN;
    const accountEmail = this.options.config.useapi?.accountEmail || process.env.USEAPI_ACCOUNT_EMAIL;
    const baseUrl = this.options.config.useapi?.baseUrl || process.env.USEAPI_BASE_URL;

    if (!apiToken) {
      throw new Error(
        "USEAPI_API_TOKEN environment variable is required.\n" +
        "Get your API token from https://useapi.net/dashboard"
      );
    }

    if (!accountEmail) {
      throw new Error(
        "USEAPI_ACCOUNT_EMAIL environment variable is required.\n" +
        "This should be the Google account email registered with useapi.net"
      );
    }

    this.accountEmail = accountEmail;

    // Create client
    this.client = new UseApiClient({
      apiToken,
      accountEmail,
      baseUrl,
    });

    // Validate credentials by checking account health
    try {
      const health = await this.client.getAccountHealth(accountEmail);
      this.accountTier = health.tier;
      log(`useapi.net account: ${accountEmail} (${health.tier})`);

      if (health.status !== "active" && health.status !== "ok") {
        console.warn(`Warning: Account status is "${health.status}". ${health.message || ""}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to validate useapi.net credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    // No-op for REST API client
    this.initialized = false;
  }

  async checkHealth(): Promise<HealthResult> {
    if (!this.initialized || !this.client) {
      return {
        healthy: false,
        message: "Backend not initialized",
      };
    }

    try {
      const health = await this.client.getAccountHealth(this.accountEmail);

      return {
        healthy: health.status === "active" || health.status === "ok",
        message: health.message || health.status,
        accountTier: health.tier,
        accountEmail: this.accountEmail,
        captchaCredits: health.captchaCredits,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
        accountEmail: this.accountEmail,
      };
    }
  }

  async getAccountTier(): Promise<AccountTier> {
    if (!this.initialized || !this.client) {
      throw new Error("Backend not initialized");
    }
    return this.accountTier;
  }

  async uploadImage(path: string, _mode: "frames" | "ingredients"): Promise<ImageUploadResult> {
    if (!this.initialized || !this.client) {
      throw new Error("Backend not initialized");
    }

    // Resolve path
    const fullPath = path.startsWith("/") ? path : join(process.cwd(), path);

    if (!existsSync(fullPath)) {
      throw new Error(`Image file not found: ${path}`);
    }

    log(`Uploading image: ${path}`);
    const result = await this.client.uploadImage(fullPath);

    // Extract mediaGenerationId - API returns nested object { mediaGenerationId: { mediaGenerationId: "..." } }
    const mediaId = typeof result.mediaGenerationId === 'object'
      ? result.mediaGenerationId.mediaGenerationId
      : result.mediaGenerationId;

    return {
      mediaId,
      url: undefined,
    };
  }

  async generateVideo(request: VideoRequest): Promise<VideoGenerationResult> {
    if (!this.initialized || !this.client) {
      throw new Error("Backend not initialized");
    }

    // Map parameters
    const model = mapModelToUseApi(request.model);
    const aspectRatio = mapAspectRatioToUseApi(request.aspectRatio);

    // Check if free model is allowed (Ultra tier only)
    if (model === "veo-3.1-lite-low-priority" && this.accountTier !== "ultra") {
      throw new Error(
        `Free model (veo-3.1-lite-low-priority) requires Ultra tier account.\n` +
        `Your account tier: ${this.accountTier}. Use --model fast instead.`
      );
    }

    // Show cost estimate and ask for confirmation (unless --yes flag)
    const outputCount = request.outputsPerPrompt ?? 1;
    const costEstimate = this.estimateCost(request);

    if (costEstimate && !this.skipConfirmation) {
      console.log(`\nEstimated cost: ${costEstimate.totalCredits} credits`);
      console.log(`  ${outputCount} video(s) × ${model} = ${costEstimate.videoGenerationCredits} credits`);

      // Ask for confirmation
      const confirmed = await this.askConfirmation("Proceed? [Y/n] ");
      if (!confirmed) {
        throw new Error("Generation cancelled by user");
      }
    }

    // Build request parameters
    const params: UseApiVideoParams = {
      email: this.accountEmail,
      prompt: request.prompt,
      model,
      aspectRatio: aspectRatio,
    };

    // Add output count if specified
    if (request.outputsPerPrompt && request.outputsPerPrompt > 1) {
      params.count = request.outputsPerPrompt;
    }

    // Add seed if specified
    if (request.seed !== undefined) {
      params.seed = request.seed;
    }

    // Flow v1 extensions: thread duration, voice (referenceAudio_1), refVideo (referenceVideo_1)
    // through to the wire so validateFlowVideoRequest sees them and the API receives them.
    if (request.duration !== undefined) {
      params.duration = request.duration;
    }
    if (request.voice) {
      params.referenceAudio_1 = request.voice;
    }
    if (request.refVideo) {
      params.referenceVideo_1 = request.refVideo;
    }

    // Add webhook if configured
    if (this.webhookUrl) {
      params.replyUrl = this.webhookUrl;
      params.replyRef = `veo-cli-${Date.now()}`;
    }

    // Handle image references based on request type
    if (request.type === "image") {
      // Upload image if needed
      let mediaId: string;
      if (request.startImageMediaId) {
        mediaId = request.startImageMediaId;
      } else if (request.startImagePath) {
        const result = await this.uploadImage(request.startImagePath, "frames");
        mediaId = result.mediaId;
      } else {
        throw new Error("I2V request requires startImagePath or startImageMediaId");
      }
      params.startImage = mediaId;
    } else if (request.type === "frames") {
      // Upload start and end frames
      let startMediaId: string;
      let endMediaId: string;

      if (request.startImageMediaId) {
        startMediaId = request.startImageMediaId;
      } else if (request.startImagePath) {
        const result = await this.uploadImage(request.startImagePath, "frames");
        startMediaId = result.mediaId;
      } else {
        throw new Error("Frames request requires startImagePath or startImageMediaId");
      }

      if (request.endImageMediaId) {
        endMediaId = request.endImageMediaId;
      } else if (request.endImagePath) {
        const result = await this.uploadImage(request.endImagePath, "frames");
        endMediaId = result.mediaId;
      } else {
        throw new Error("Frames request requires endImagePath or endImageMediaId");
      }

      params.startImage = startMediaId;
      params.endImage = endMediaId;
    } else if (request.type === "ingredients") {
      // Upload reference images (max 3)
      const mediaIds: string[] = [];

      if (request.referenceImageMediaIds && request.referenceImageMediaIds.length > 0) {
        mediaIds.push(...request.referenceImageMediaIds);
      } else if (request.referenceImagePaths && request.referenceImagePaths.length > 0) {
        for (const imgPath of request.referenceImagePaths) {
          const result = await this.uploadImage(imgPath, "ingredients");
          mediaIds.push(result.mediaId);
        }
      } else {
        throw new Error("Ingredients request requires referenceImagePaths or referenceImageMediaIds");
      }

      // R2V on Veo is supported by all variants except veo-3.1-quality;
      // omni-flash supports R2V via _1..7 with its own validator path.
      if (model === "veo-3.1-quality") {
        throw new Error("R2V (Ingredients) mode is not supported on veo-3.1-quality; use fast, lite, lite-low-priority, or omni-flash.");
      }

      // Assign to individual referenceImage_N fields (API format)
      if (mediaIds[0]) params.referenceImage_1 = mediaIds[0];
      if (mediaIds[1]) params.referenceImage_2 = mediaIds[1];
      if (mediaIds[2]) params.referenceImage_3 = mediaIds[2];
    }

    // Submit generation request
    log("Submitting video generation to useapi.net...");
    const response = await this.client.generateVideo(params);

    // Check for API error
    if (response.error) {
      throw new Error(`useapi.net error: ${response.error}`);
    }

    // useapi.net returns synchronous response - video is already complete
    log(`Job ${response.jobId} completed.`);

    // Normalize the response — prefers media[] (200 sync), falls back to operations[] (async/upscale)
    const mediaItems = transformVideoResponse(response);

    // Build operations array compatible with existing download code
    const operations: Operation[] = [];

    for (const item of mediaItems) {
      const videoUrl = item.videoUrl;
      const status = item.status;

      if (videoUrl && (!status || !status.includes("FAILED"))) {
        operations.push({
          name: item.mediaGenerationId || `useapi-${response.jobId}`,
          done: true,
          metadata: {
            video: {
              state: "SUCCEEDED",
            },
          },
          operation: {
            metadata: {
              video: {
                fifeUrl: videoUrl,
                state: "SUCCEEDED",
                seed: item.seed,
                aspectRatio: params.aspectRatio,
              },
            },
          },
        } as unknown as Operation);
      } else if (status && status.includes("FAILED")) {
        log(`Operation failed: ${status}`);
      }
    }

    if (operations.length === 0) {
      throw new Error("All operations failed - no video URLs returned");
    }

    return {
      operations,
      jobId: response.jobId,
      estimatedCredits: costEstimate?.totalCredits,
    };
  }

  estimateCost(request: VideoRequest): CostEstimate | null {
    const model = mapModelToUseApi(request.model);
    const videoCount = request.outputsPerPrompt ?? 1;
    const duration = request.duration ?? 8;
    const cost = calculateCost(model, videoCount, duration);

    return {
      videoGenerationCredits: cost.credits,
      captchaCredits: 0,
      totalCredits: cost.credits,
      model,
      videoCount,
    };
  }

  getDirectResources(): DirectResources | null {
    // useapi backend doesn't have direct resources
    return null;
  }

  /**
   * Ask user for confirmation (returns true if confirmed)
   */
  private async askConfirmation(prompt: string): Promise<boolean> {
    process.stdout.write(prompt);

    // Read from stdin
    const response = await new Promise<string>((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode?.(false);
      stdin.resume();
      stdin.setEncoding("utf8");

      let data = "";
      const onData = (chunk: string) => {
        data += chunk;
        if (data.includes("\n")) {
          stdin.removeListener("data", onData);
          resolve(data.trim().toLowerCase());
        }
      };
      stdin.on("data", onData);

      // Timeout after 30 seconds
      setTimeout(() => {
        stdin.removeListener("data", onData);
        resolve("n");
      }, 30000);
    });

    return response === "" || response === "y" || response === "yes";
  }
}
