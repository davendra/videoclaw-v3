/**
 * Backend-specific types for veo-cli
 * Defines interfaces for different video generation backends
 */

import type { Operation, VideoAspectRatio, Project, Session } from "../types";

// ============================================================================
// Backend Configuration
// ============================================================================

/**
 * Configuration for the direct (browser-based) backend
 */
export interface DirectBackendConfig {
  headless: boolean;
  cookiesPath: string;
  loginWaitMs: number;
}

/**
 * Configuration for the useapi.net backend
 */
export interface UseApiConfig {
  apiToken: string;        // from USEAPI_API_TOKEN env var
  accountEmail: string;    // from USEAPI_ACCOUNT_EMAIL env var
  baseUrl?: string;        // default: https://api.useapi.net/v1
  webhookUrl?: string;     // optional webhook for job completion notifications
}

/**
 * Combined backend configuration
 */
export interface BackendConfig {
  type: "direct" | "useapi";
  direct?: DirectBackendConfig;
  useapi?: UseApiConfig;
}

// ============================================================================
// Health & Status Types
// ============================================================================

/**
 * Health check result from a backend
 */
export interface HealthResult {
  healthy: boolean;
  message: string;
  accountTier?: "free" | "pro" | "ultra" | "unknown";
  accountEmail?: string;
  captchaCredits?: number;
  recentStats?: {
    success: number;
    failed: number;
    rateLimited: number;
    lastChecked: string;
  };
}

/**
 * Account tier levels
 */
export type AccountTier = "free" | "pro" | "ultra" | "unknown";

// ============================================================================
// Video Request Types
// ============================================================================

/**
 * Base video generation request
 */
export interface VideoRequestBase {
  prompt: string;
  aspectRatio: VideoAspectRatio;
  model: string;                    // quality, fast, free, veo2
  outputsPerPrompt?: number;        // 1-4
  seed?: number;                    // 0-32767
  isSeedLocked?: boolean;
  audioEnabled?: boolean;
  // Flow v1 / Omni Flash extensions (Task 10)
  duration?: 4 | 6 | 8 | 10;        // Output duration in seconds (FlowDuration)
  voice?: string;                   // Voice narration preset → referenceAudio_1
  refVideo?: string;                // Reference video mediaGenerationId → referenceVideo_1 (omni-flash V2V)
}

/**
 * Text-to-Video request
 */
export interface T2VRequest extends VideoRequestBase {
  type: "text";
}

/**
 * Image-to-Video request (single start image)
 */
export interface I2VRequest extends VideoRequestBase {
  type: "image";
  startImagePath?: string;          // Local file path (will be uploaded)
  startImageMediaId?: string;       // Already uploaded media ID
}

/**
 * Frames-to-Video request (start + end frames)
 */
export interface FramesRequest extends VideoRequestBase {
  type: "frames";
  startImagePath?: string;
  startImageMediaId?: string;
  endImagePath?: string;
  endImageMediaId?: string;
}

/**
 * Ingredients/References request (1-3 reference images)
 */
export interface IngredientsRequest extends VideoRequestBase {
  type: "ingredients";
  referenceImagePaths?: string[];   // Local file paths (will be uploaded)
  referenceImageMediaIds?: string[]; // Already uploaded media IDs
}

/**
 * Union type for all video requests
 */
export type VideoRequest = T2VRequest | I2VRequest | FramesRequest | IngredientsRequest;

// ============================================================================
// Video Generation Result Types
// ============================================================================

/**
 * Result from video generation
 */
export interface VideoGenerationResult {
  operations: Operation[];
  jobId?: string;                   // useapi.net job ID for tracking
  estimatedCredits?: number;        // Estimated cost in Flow credits (per Google's credit table)
  actualCredits?: number;           // Actual cost in Flow credits after completion
}

/**
 * Image upload result
 */
export interface ImageUploadResult {
  mediaId: string;
  url?: string;
}

// ============================================================================
// useapi.net Specific Types
// ============================================================================

/**
 * useapi.net API response for accounts list
 * GET /google-flow/accounts
 *
 * Returns a map keyed by email address, or empty object {} if no accounts configured.
 *
 * Error codes:
 * - 401: Invalid API token
 */
export type UseApiAccountsResponse = Record<string, UseApiAccountInfo>;

/**
 * useapi.net account info (as returned by GET /accounts API)
 */
export interface UseApiAccountInfo {
  health: string;                     // "OK" or error message describing health status
  error?: string;                     // Error message if health check failed
  created?: string;                   // ISO 8601 creation timestamp
  sessionData?: {
    expires: string;                  // ISO 8601 session expiration timestamp
  };
  project?: {
    projectId: string;                // Unique project identifier
    projectTitle: string;             // Project name
  };
  nextRefresh?: {
    scheduledFor: string;             // ISO 8601 next refresh timestamp
  };
}

/**
 * useapi.net account (transformed for display)
 */
export interface UseApiAccount {
  email: string;
  status: "active" | "inactive" | "error";
  tier: AccountTier;
  lastUsed?: string;
  health?: string;
}


/**
 * Google Flow v1 video model identifiers (useapi.net `model` field).
 */
export type FlowVideoModel =
  | "veo-3.1-quality"
  | "veo-3.1-fast"
  | "veo-3.1-lite"
  | "veo-3.1-lite-low-priority"
  | "omni-flash";

/**
 * Aspect ratios. `1:1`/`4:3`/`3:4` are Veo-only; omni-flash accepts only landscape/portrait.
 */
export type FlowAspectRatio = "landscape" | "portrait" | "1:1" | "4:3" | "3:4";

/**
 * Output duration in seconds. 8 is the default; 4/6 require Ultra on Veo; 10 is omni-flash only.
 */
export type FlowDuration = 4 | 6 | 8 | 10;

/**
 * The 30 Google Flow voice-narration presets (case-insensitive on the wire).
 */
export const FLOW_VOICE_PRESETS = [
  "Achird", "Achernar", "Algieba", "Algenib", "Alnilam", "Aoede", "Autonoe",
  "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux",
  "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Puck", "Pulcherrima",
  "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel",
  "Vindemiatrix", "Zephyr", "Zubenelgenubi",
] as const;

/**
 * One of the {@link FLOW_VOICE_PRESETS} string literals.
 */
export type FlowVoicePreset = (typeof FLOW_VOICE_PRESETS)[number];

/**
 * A single generated video in the current `media[]` response (200 sync).
 */
export interface FlowMediaItem {
  name: string;
  mediaGenerationId: string;
  videoUrl?: string;          // Signed MP4, ~24h
  thumbnailUrl?: string;      // Signed JPEG, ~24h
  video?: {
    generatedVideo?: {
      seed?: number;
      prompt?: string;
      model?: string;         // e.g. veo_3_1_t2v, omni_flash_*
      aspectRatio?: string;
      isLooped?: boolean;
      baseImageMediaGenerationId?: string;
    };
    dimensions?: { length?: string };
    operation?: { name: string };
  };
  mediaMetadata?: {
    mediaStatus?: { mediaGenerationStatus?: string; error?: { code: number; message: string } };
  };
}

/**
 * useapi.net video generation parameters
 * POST /google-flow/videos
 *
 * Generation modes:
 * - T2V (text-to-video): prompt only
 * - I2V (image-to-video): startImage only (Veo only)
 * - I2V-FL (frames): startImage + endImage (Veo only)
 * - R2V (references): referenceImage_1..3 on Veo (not veo-3.1-quality); _1..7 on omni-flash
 * - V2V (video edit): referenceVideo_1 + frame indices (omni-flash only)
 *
 * CONSTRAINTS:
 * - Cannot mix R2V (referenceImage_*) and I2V (startImage/endImage)
 * - endImage requires startImage
 * - I2V/I2V-FL only available on Veo models
 * - veo-3.1-quality does not support R2V
 *
 * Timing: Generation typically takes 60-180 seconds
 *
 * Error codes:
 * - 400: Validation error, mode conflict, or content policy violation
 * - 401: Invalid API token
 * - 402: Subscription expired or insufficient credits
 * - 403: Google rejection; increase captchaRetry
 * - 404: Account not found
 * - 408: Video generation timeout (10 minutes)
 * - 429: Rate limit; wait 5-10 seconds and retry
 * - 596: Session refresh failed; reconfigure account
 */
export interface UseApiVideoParams {
  prompt: string;                   // Required: text description
  email?: string;                   // Optional: omit to load-balance across accounts
  model?: FlowVideoModel;           // Default: veo-3.1-fast
  aspectRatio?: FlowAspectRatio;    // Default: landscape
  duration?: FlowDuration;          // Default: 8 (per-model rules — see validateFlowVideoRequest)
  count?: number;                   // 1-4 variations, default: 1
  seed?: number;                    // Random seed (≥0)

  // I2V / I2V-FL — Veo only (omni-flash frames mode not yet available)
  startImage?: string;              // mediaGenerationId for start frame
  endImage?: string;                // mediaGenerationId for end frame (requires startImage)

  // R2V — referenceImage_1..3 on Veo (not veo-3.1-quality); _1..7 on omni-flash
  referenceImage_1?: string;
  referenceImage_2?: string;
  referenceImage_3?: string;
  referenceImage_4?: string;        // omni-flash only
  referenceImage_5?: string;        // omni-flash only
  referenceImage_6?: string;        // omni-flash only
  referenceImage_7?: string;        // omni-flash only

  // Voice narration — preset names. _1 universal; _2..5 omni-flash only.
  referenceAudio_1?: string;
  referenceAudio_2?: string;
  referenceAudio_3?: string;
  referenceAudio_4?: string;
  referenceAudio_5?: string;

  // V2V edit — omni-flash only
  referenceVideo_1?: string;        // mediaGenerationId of an uploaded MP4
  startFrameIndex_1?: number;       // 0-239, 24fps virtual timeline
  endFrameIndex_1?: number;         // 1-240 (240 = 10s); must exceed startFrameIndex_1

  // Async mode
  async?: boolean;                  // Fire-and-forget; 201 + poll GET /jobs/{jobId}

  // Webhook callbacks
  replyUrl?: string;
  replyRef?: string;

  // CAPTCHA configuration (mutually exclusive)
  captchaToken?: string;            // Your own reCAPTCHA token
  captchaRetry?: number;            // Retry attempts 1-10, default: 3
  captchaOrder?: string;            // Comma-separated provider sequence
}

/**
 * useapi.net video generation response
 * POST /google-flow/videos
 *
 * Response modes:
 * - 200 (sync): Video complete, includes signed URLs (~24h valid)
 * - 201 (async): Job created, poll via GET /jobs/{jobId}
 *
 * Note: fifeUrl and servingBaseUri are signed URLs valid for ~24 hours
 */
export interface UseApiVideoResponse {
  jobId: string;
  /** Current 200-sync shape: one entry per generated video. Preferred over operations[]. */
  media?: FlowMediaItem[];
  /**
   * Legacy/async shape: returned by 201 async, /jobs/{jobId} polling, and upscale.
   * Absent on the current 200-sync shape — read `media[]` first, fall back to this.
   */
  operations?: Array<{
    operation: {
      name: string;
      metadata: {
        "@type"?: string;
        video?: {
          seed?: number;
          mediaGenerationId?: string;
          prompt?: string;
          fifeUrl?: string;              // Signed MP4 URL (~24h valid)
          servingBaseUri?: string;       // Signed thumbnail JPEG (~24h valid)
          model?: string;                // veo_3_1_t2v | i2v | i2v_fl | r2v
          isLooped?: boolean;
          aspectRatio?: string;
        };
      };
    };
    sceneId?: string;
    mediaGenerationId?: string;
    status: string;
  }>;
  remainingCredits?: number;           // Credits remaining after generation
  captcha?: {
    service?: string;
    taskId?: string;
    durationMs?: number;
    attempts?: any[];
  };
  error?: string;
}

/**
 * POST /google-flow/videos/extend — adds an ~8s continuation segment.
 * CAPTCHA required. Response shape matches UseApiVideoResponse (media[]).
 */
export interface UseApiVideoExtendParams {
  mediaGenerationId: string;        // Required: source video to extend
  prompt: string;                   // Required: what happens next
  model?: Exclude<FlowVideoModel, "omni-flash">;  // Default: veo-3.1-fast
  count?: number;                   // 1-4, default: 1
  seed?: number;
  async?: boolean;
  replyUrl?: string;
  replyRef?: string;
  captchaToken?: string;
  captchaRetry?: number;
  captchaOrder?: string;
}

/**
 * POST /google-flow/videos/concatenate — joins 2-10 videos. No CAPTCHA.
 * Returns base64 MP4 in `encodedVideo`.
 */
export interface UseApiVideoConcatParams {
  media: Array<{
    mediaGenerationId: string;
    trimStart?: number;             // Seconds 0-8, default 0
    trimEnd?: number;               // Seconds 0-8, default 0
  }>;
}

export interface UseApiVideoConcatResponse {
  jobId?: string;
  status?: string;
  inputsCount?: number;
  encodedVideo?: string;            // Base64 MP4
  error?: string | { code: number; message: string; status: string };
}

/**
 * useapi.net job polling response (for async jobs)
 * GET /google-flow/jobs/{jobId}
 *
 * Retrieves status and details of image or video generation jobs.
 * Video jobs return signed URLs valid for ~24 hours.
 * Jobs are retained for 7 days.
 *
 * Status values:
 * - "created": Job created, not yet started
 * - "started": Job in progress
 * - "completed": Job finished successfully
 * - "failed": Job failed
 *
 * Error codes:
 * - 400: Invalid job ID format
 * - 401: Invalid API token
 * - 403: Access denied (different user's job)
 * - 404: Job not found
 * - 410: Job expired (7-day retention)
 */
export interface UseApiJobResponse {
  jobid?: string;                     // Job ID (API uses lowercase 'i')
  jobId?: string;                     // Job ID (some responses use camelCase)
  type?: "video" | "image";           // Job type
  status: string;                     // created | started | completed | failed
  created?: string;                   // ISO 8601 creation timestamp
  updated?: string;                   // ISO 8601 last update timestamp
  request?: Record<string, unknown>;  // Original generation parameters
  response?: {                        // Generation results (when completed)
    operations?: UseApiVideoResponse["operations"];
    media?: UseApiImageResponseRaw["media"];
  };
  error?: string;                     // Error message if failed
  code?: number;                      // Error code if failed
  // Legacy fields for backward compatibility
  progress?: number;
  result?: {
    video_url?: string;
    thumbnail_url?: string;
    duration_seconds?: number;
    error?: string;
  };
  cost?: number;
  created_at?: string;
  completed_at?: string;
}

/**
 * useapi.net CAPTCHA provider configuration
 * POST /google-flow/accounts/captcha-providers
 *
 * Providers are specified by their exact API names.
 * Set apiKey to empty string "" to remove a provider.
 *
 * Priority: First configured provider in alphabetical order is used for solves.
 * To use a specific sequence, configure captchaOrder in request params.
 *
 * Error codes:
 * - 400: Invalid provider name (must be EzCaptcha, CapSolver, or YesCaptcha)
 * - 401: Invalid API token
 */
export interface UseApiCaptchaConfig {
  provider: "EzCaptcha" | "CapSolver" | "YesCaptcha";
  apiKey: string;  // Set to "" to remove provider
}

/**
 * useapi.net CAPTCHA providers response
 * GET /google-flow/accounts/captcha-providers
 *
 * Returns configured provider keys (masked) or free credits info.
 *
 * Response variants:
 * - If providers configured: { "EzCaptcha": "xxxx...xxxx", "CapSolver": "xxxx...xxxx" }
 * - If no providers: { "freeCaptchaCredits": 100 }
 * - Mixed: { "freeCaptchaCredits": 50, "EzCaptcha": "xxxx...xxxx" }
 *
 * Note: freeCaptchaCredits only shown when credits remain and/or no providers configured
 */
export interface UseApiCaptchaProvidersResponse {
  EzCaptcha?: string;       // Masked key if configured
  CapSolver?: string;       // Masked key if configured
  YesCaptcha?: string;      // Masked key if configured
  freeCaptchaCredits?: number;  // Remaining free credits (100 for new accounts)
}

/**
 * useapi.net image upload response
 * POST /google-flow/assets/{email}
 *
 * Uploads an image for use in video generation (I2V, frames, R2V modes).
 *
 * Request:
 * - Content-Type: image/png or image/jpeg
 * - Body: Raw binary image data (max 20MB)
 * - Path param {email} is optional - auto-selects via load balancing if omitted
 *
 * mediaGenerationId format: "user:{userid}-email:{hex_encoded_email}-image:{internal_id}"
 *
 * Error codes:
 * - 400: Invalid request (empty content, unsupported type, oversized, or content policy violation)
 * - 401: Invalid API token
 * - 404: Account not configured
 * - 429: Rate limited (retry after 5-10 seconds)
 * - 596: Session error (reconfigure account)
 */
export interface UseApiImageUploadResponse {
  mediaGenerationId: { mediaGenerationId: string } | string;  // Nested object or string
  width?: number;               // Image width in pixels
  height?: number;              // Image height in pixels
  email?: string;               // Account email used for upload
}

/**
 * useapi.net video asset upload response — POST /google-flow/assets/{email}
 * with Content-Type: video/mp4 (max 100 MB). The returned video
 * mediaGenerationId is used as `referenceVideo_1` for Omni Flash V2V edit.
 *
 * mediaGenerationId format: "user:{userid}-email:{hex_encoded_email}-video:{uuid}"
 *
 * Error codes:
 * - 400: Invalid request (empty content, unsupported type, oversized, or content policy violation)
 * - 401: Invalid API token
 * - 404: Account not configured
 * - 413: Payload too large (exceeds 100 MB server limit)
 * - 429: Rate limited (retry after 5-10 seconds)
 * - 596: Session error (reconfigure account)
 */
export interface UseApiVideoUploadResponse {
  mediaGenerationId: { mediaGenerationId: string } | string;
  durationSeconds?: number;     // Use to compute endFrameIndex_1: min(round(s*24), 240)
  width?: number;
  height?: number;
  email?: string;
}

// ============================================================================
// History Tracking Types
// ============================================================================

/**
 * History entry for tracking useapi.net job results
 */
export interface UseApiHistoryEntry {
  id?: number;
  timestamp: string;
  jobId: string;
  backend: string;
  status: "success" | "failed" | "rate_limited" | "timeout";
  durationMs: number | null;
  errorMessage: string | null;
  cost: number | null;
}

// ============================================================================
// useapi.net Extended Features Types
// ============================================================================

/**
 * Image generation parameters for useapi.net
 * POST /google-flow/images
 *
 * Model selection:
 * - imagen-4: Best for text-to-image, max 3 references
 * - nano-banana: Legacy alias → mapped to nano-banana-2 on the wire
 * - nano-banana-2: Character consistency, max 3 references
 * - nano-banana-pro: Maximum references (10), upscale-able, Ultra tier only
 *
 * Error codes:
 * - 400: Bad request / content policy violation
 * - 401: Invalid API token
 * - 402: Expired subscription / insufficient credits
 * - 403: Google rejection; increase captchaRetry
 * - 404: Account not configured
 * - 429: Rate/quota limit; wait 5-10 seconds, retry
 * - 500: Content moderation; retry or modify prompt
 * - 503: Temporary outage; wait and retry
 * - 596: Session error; cookie refresh required
 */
export interface UseApiImageParams {
  prompt: string;                   // Required: Text description for image generation
  email?: string;                   // Optional: Auto-selected if single account configured
  // imagen-4 (default), nano-banana-2, nano-banana-pro.
  // "nano-banana" is an accepted legacy alias mapped to nano-banana-2.
  model?: "imagen-4" | "nano-banana" | "nano-banana-2" | "nano-banana-pro";
  // 16:9/4:3/1:1/3:4/9:16/auto. landscape/portrait accepted as legacy aliases.
  // auto valid only for nano-banana-2/-pro with at least one reference.
  aspectRatio?: "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto" | "landscape" | "portrait";
  count?: number;                   // 1-4 images, default: 4
  seed?: number;                    // Random seed for reproducible results (≥0)

  // Reference images (mediaGenerationId values from uploaded assets)
  // Max 3 for imagen-4/nano-banana, max 10 for nano-banana-pro
  reference_1?: string;
  reference_2?: string;
  reference_3?: string;
  reference_4?: string;
  reference_5?: string;
  reference_6?: string;
  reference_7?: string;
  reference_8?: string;
  reference_9?: string;
  reference_10?: string;

  // Webhook callbacks
  replyUrl?: string;                // Webhook URL for job status callbacks
  replyRef?: string;                // Custom reference string in webhook callbacks

  // CAPTCHA configuration (mutually exclusive)
  captchaRetry?: number;            // Retry attempts 1-10, default: 3
  captchaOrder?: string;            // Comma-separated CAPTCHA provider sequence (max 10)
}

/**
 * Raw image generation response from useapi.net API
 * The actual API returns a different structure than the normalized one
 *
 * Note: Image generation typically completes within 10-20 seconds
 * Dynamic concurrency: 3-20 parallel generations depending on capacity
 */
export interface UseApiImageResponseRaw {
  jobId: string;
  media: Array<{
    name?: string;
    workflowId?: string;
    image?: {
      generatedImage?: {
        seed?: number;
        mediaGenerationId?: string;
        mediaVisibility?: "PRIVATE" | "PUBLIC";
        prompt?: string;
        modelNameType?: string;
        workflowId?: string;
        fifeUrl?: string;
        aspectRatio?: string;
        requestData?: Record<string, unknown>;
      };
    };
  }>;
  model?: string;
  captcha?: {
    service?: string;
    taskId?: string;
    durationMs?: number;
    attempts?: any[];
  };
  error?: string;
}

/**
 * Normalized image generation response from useapi.net
 * This is the structure returned by the client after transformation
 */
export interface UseApiImageResponse {
  jobId: string;
  images: Array<{
    mediaGenerationId: string;
    seed?: number;
    name?: string;
    workflowId?: string;
    url?: string;
    fifeUrl?: string;
    width?: number;
    height?: number;
  }>;
  model?: string;
  captcha?: {
    service?: string;
    taskId?: string;
    durationMs?: number;
  };
  error?: string;
}

/**
 * Image upscaling parameters for useapi.net
 * POST /google-flow/images/upscale
 *
 * IMPORTANT: Only works with images generated using nano-banana-pro or nano-banana-2 models.
 *
 * Error codes:
 * - 400: Missing/invalid mediaGenerationId
 * - 401: Invalid API token
 * - 403: Google rejected request; increase captchaRetry
 * - 404: Account or image not found
 * - 429: Upscaling unsupported; only nano-banana-pro or nano-banana-2 images supported
 */
export interface UseApiImageUpscaleParams {
  mediaGenerationId: string;        // Must be from nano-banana-pro or nano-banana-2 model
  email?: string;                   // Optional account selector
  resolution?: "2k" | "4k";         // Default: 2k, 4k requires paid Google account
  captchaRetry?: number;            // Retry attempts 1-10, default 3
  captchaOrder?: string;            // Comma-separated captcha provider sequence
  // Note: captchaRetry and captchaOrder are mutually exclusive
}

/**
 * Image upscaling response from useapi.net
 * Returns base64-encoded upscaled image
 */
export interface UseApiImageUpscaleResponse {
  encodedImage: string;             // Base64-encoded upscaled image
  mediaGenerationId?: string;
  url?: string;
  fifeUrl?: string;
  width?: number;
  height?: number;
  resolution?: string;
  captcha?: {
    service: "EzCaptcha" | "CapSolver" | "YesCaptcha" | string;
    taskId?: string;
    durationMs?: number;
    attempts?: any[];
  };
  error?: string;
}

/**
 * Video to GIF conversion parameters for useapi.net
 * POST /google-flow/videos/gif
 *
 * IMPORTANT: This endpoint does NOT require CAPTCHA! (Free to use)
 *
 * Processing time: Up to 90 seconds
 * Operation: Synchronous (returns immediately upon completion)
 *
 * Error codes:
 * - 400: Missing/invalid mediaGenerationId or incorrect reference type
 * - 401: Invalid/missing API token
 * - 404: Account or video not found
 */
export interface UseApiVideoGifParams {
  mediaGenerationId: string;        // Required: Video ID from POST /videos
}

/**
 * Video to GIF conversion response from useapi.net
 * POST /google-flow/videos/gif
 *
 * Returns base64-encoded GIF data (no CAPTCHA required)
 */
export interface UseApiVideoGifResponse {
  encodedGif: string;               // Base64-encoded GIF data
  width?: number;
  height?: number;
  error?: string | {                // Error can be string or object
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      "@type"?: string;
      reason?: string;
    }>;
  };
}

/**
 * Video upscaling parameters for useapi.net
 * POST /google-flow/videos/upscale
 *
 * Timing:
 * - 1080p: 30-60 seconds
 * - 4K: a few minutes
 *
 * Caching: Re-upscaling identical video returns cached result (free)
 *
 * Cost:
 * - 1080p: Free
 * - 4K: 50 credits (requires Ultra subscription)
 *
 * Error codes:
 * - 400: Invalid request parameters
 * - 401: Invalid API token
 * - 403: Google rejected (reCAPTCHA failed); increase captchaRetry
 * - 404: Account or video not found
 * - 408: Polling timeout after 10 minutes
 */
export interface UseApiVideoUpscaleParams {
  mediaGenerationId: string;        // Required: Video media ID from POST /videos
  resolution?: "1080p" | "4k";      // Default: 1080p (free), 4k requires Ultra tier

  // Async mode
  async?: boolean;                  // Fire-and-forget mode; returns 201, poll via GET /jobs/{jobId}

  // Webhook callbacks
  replyUrl?: string;                // Webhook URL for job status callbacks
  replyRef?: string;                // Custom reference passed in callbacks

  // CAPTCHA configuration (mutually exclusive)
  captchaRetry?: number;            // Retry attempts 1-10, default: 3
  captchaOrder?: string;            // Comma-separated captcha provider sequence (max 10)
}

/**
 * Video upscaling response from useapi.net
 * POST /google-flow/videos/upscale
 *
 * Response modes:
 * - 200 (sync): Upscaling complete, includes signed URLs (~24h valid)
 * - 201 (async): Job created, poll via GET /jobs/{jobId}
 *
 * Models returned:
 * - veo_3_1_upsampler_1080p
 * - veo_3_1_upsampler_4k
 */
export interface UseApiVideoUpscaleResponse {
  jobId?: string;
  operations?: Array<{
    operation?: {
      name?: string;
      metadata?: {
        video?: {
          seed?: number;
          mediaGenerationId?: string;
          prompt?: string;
          fifeUrl?: string;            // Signed MP4 URL (~24h valid)
          servingBaseUri?: string;     // Thumbnail URL (~24h valid)
          model?: string;              // veo_3_1_upsampler_1080p | veo_3_1_upsampler_4k
          isLooped?: boolean;
          aspectRatio?: string;
        };
      };
    };
    rawBytes?: string;                 // Base64 data when re-upscaling (cached)
    sceneId?: string;
    mediaGenerationId?: string;
    status?: string;                   // MEDIA_GENERATION_STATUS_SUCCESSFUL | FAILED | PENDING
  }>;
  media?: Array<{
    mediaGenerationId?: string;
    videoUrl?: string;                 // Signed MP4 URL (~24h valid)
    thumbnailUrl?: string;             // Signed thumbnail URL (~24h valid)
  }>;
  // Async mode response fields
  type?: string;                       // "video" for async
  status?: string;                     // "created" for async
  created?: string;                    // ISO 8601 timestamp
  cached?: boolean;                    // True when UseAPI returns an existing upscale result
  request?: {
    async?: boolean;
    mediaGenerationId?: string;
    resolution?: string;
  };
  captcha?: {
    service?: string;
    taskId?: string;
    durationMs?: number;
    attempts?: any[];
  };
  error?: string;
}

// ============================================================================
// Cost Estimation Types
// ============================================================================

/**
 * Cost estimate for a video generation request.
 * All cost fields are in Flow credits (the real billing unit on Google's
 * official credit table); USD equivalent varies by subscription tier.
 */
export interface CostEstimate {
  videoGenerationCredits: number;   // Per-video credit cost × videoCount
  captchaCredits: number;           // CAPTCHA credit cost (typically 0 — Flow credits don't cover captcha)
  totalCredits: number;             // Total credit cost (videoGeneration + captcha)
  model: string;                    // Model used for estimate
  videoCount: number;               // Number of videos
}

// ============================================================================
// Backend Interface Types
// ============================================================================

/**
 * Backend initialization options
 */
export interface BackendInitOptions {
  config: BackendConfig;
  // Direct backend specific
  headless?: boolean;
  cookiesPath?: string;
  loginWaitMs?: number;
  // useapi backend specific
  skipConfirmation?: boolean;     // --yes flag
  webhookUrl?: string;            // --webhook flag
}

/**
 * Resources needed by direct backend for operations
 * Allows access to the underlying page and cookies for advanced use cases
 */
export interface DirectResources {
  page: any;                        // PageWithCursor from puppeteer-real-browser
  cookies: any[];                   // Cookie[] from rebrowser-puppeteer-core
  session: Session;
  project: Project;
}

/**
 * Video generation backend interface
 * Both direct (browser-based) and useapi.net backends implement this interface
 */
export interface VideoBackend {
  /** Backend identifier */
  readonly name: "direct" | "useapi";

  /** Whether this backend requires a browser */
  readonly requiresBrowser: boolean;

  /**
   * Initialize the backend
   * For direct: launches browser, loads cookies
   * For useapi: validates API token
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the backend and release resources
   * For direct: closes browser
   * For useapi: no-op
   */
  shutdown(): Promise<void>;

  /**
   * Check backend health
   * For direct: verifies login, session valid
   * For useapi: verifies API token, account status, CAPTCHA credits
   */
  checkHealth(): Promise<HealthResult>;

  /**
   * Get account tier
   * For direct: always returns 'unknown' (tier is determined at generation time)
   * For useapi: returns account tier from API
   */
  getAccountTier(): Promise<AccountTier>;

  /**
   * Upload an image for I2V/R2V modes
   * For direct: uploads via Flow browser automation
   * For useapi: uploads via REST API
   *
   * @param path - Local file path to upload
   * @param mode - Upload mode ("frames" for I2V, "ingredients" for R2V)
   * @returns Media ID that can be used in video generation
   */
  uploadImage(path: string, mode: "frames" | "ingredients"): Promise<ImageUploadResult>;

  /**
   * Generate a video
   * For direct: calls Google API directly via browser session
   * For useapi: calls useapi.net REST API
   *
   * @param request - Video generation request
   * @returns Operations array and optional job ID
   */
  generateVideo(request: VideoRequest): Promise<VideoGenerationResult>;

  /**
   * Estimate cost for a video generation request (useapi only)
   * For direct: returns null (no cost)
   * For useapi: calculates estimated cost based on model and count
   */
  estimateCost(request: VideoRequest): CostEstimate | null;

  /**
   * Get page and cookies for direct backend operations
   * Returns null for useapi backend
   */
  getDirectResources(): DirectResources | null;
}
