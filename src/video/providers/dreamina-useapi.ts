export type DreaminaModel =
  | 'seedance-2.0'
  | 'seedance-2.0-fast'
  | 'seedance-1.5-pro'
  | 'seedance-1.0-pro'
  | 'seedance-1.0-mini'
  | 'seedance-1.0-fast'
  | 'sora2';
export type DreaminaRegion = 'US' | 'CA';
export type DreaminaAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
export type DreaminaResolution = '720p' | '1080p';
/**
 * Valid duration depends on the model:
 *   - seedance-2.0 / seedance-2.0-fast: 4-15
 *   - seedance-1.5-pro: 5, 10, 12
 *   - seedance-1.0-*: 5, 10
 *   - sora2: 4, 8, 12
 * UseAPI enforces server-side; we ship the common Seedance-2 set.
 */
export type DreaminaDurationSeconds = 4 | 5 | 8 | 10 | 12 | 15;

/**
 * Minimal `fetch` shape that allows tests to inject a mock without depending
 * on a full DOM `Response` type. Compatible with both `globalThis.fetch` and
 * the matching helper in `../native-dreamina.ts`.
 */
export type DreaminaFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

const USEAPI_BASE = 'https://api.useapi.net/v1';

/**
 * Dreamina Omni Reference budget (Seedance 2.0 via UseAPI's Dreamina proxy):
 * up to 9 image refs + 3 video refs + 3 audio refs per submission — the same
 * 9/3/3 reference budget Seedance enforces on every gateway. Emitted as the
 * individual `omni_N_imageRef` / `omni_N_videoRef` / `omni_N_audioRef` fields.
 */
export const DREAMINA_MAX_IMAGE_REFS = 9;
export const DREAMINA_MAX_VIDEO_REFS = 3;
export const DREAMINA_MAX_AUDIO_REFS = 3;

export interface SubmitDreaminaJobInput {
  apiToken: string;
  model: DreaminaModel;
  prompt: string;
  /**
   * Dreamina account identifier, e.g. "CA:ai@3rdeye.co.uk". Optional on the API
   * (auto-selected if omitted), but videoclaw always pins it so generations land
   * on the configured CA 1080p account.
   */
  account?: string;
  /** Video aspect ratio. Cannot be combined with firstFrameRef (image dictates ratio). */
  ratio?: DreaminaAspectRatio;
  duration?: DreaminaDurationSeconds;
  resolution?: DreaminaResolution;
  /**
   * assetRef from POST /assets/<account> for the starting frame. Triggers
   * `first_frame` (image-to-video) mode. When set, `ratio` is omitted because
   * Dreamina auto-detects the ratio from the uploaded image.
   */
  firstFrameRef?: string;
  /**
   * Omni Reference (multi-character identity-lock): up to 9 image assetRefs,
   * emitted as INDIVIDUAL `omni_1_imageRef`..`omni_9_imageRef` fields (NOT an
   * array), per the UseAPI Dreamina contract. Mutually exclusive with the
   * single-keyframe `firstFrameRef` frame-mode path: when any omni ref is
   * present the builder emits the omni fields and drops `firstFrameRef`/`ratio`
   * (Omni mode auto-detects the ratio from the references, like first_frame).
   */
  imageRefs?: string[];
  /** Omni Reference videos: up to 3, emitted as omni_1_videoRef..omni_3_videoRef. */
  videoRefs?: string[];
  /** Omni Reference audios: up to 3, emitted as omni_1_audioRef..omni_3_audioRef. */
  audioRefs?: string[];
  /** Optional fetch override (defaults to global fetch). Used by tests + native wrapper. */
  fetchImpl?: DreaminaFetchLike;
}

export interface SubmitDreaminaJobResult {
  /** Namespaced jobid, e.g. "j0223...v-u12345-CA:user@example.com-bot:dreamina". Use as-is in poll. */
  jobid: string;
}

/** POST https://api.useapi.net/v1/dreamina/videos — create video endpoint. */
export function dreaminaVideosEndpoint(): string {
  return `${USEAPI_BASE}/dreamina/videos`;
}

/** GET https://api.useapi.net/v1/dreamina/videos/{jobid} — poll endpoint. */
export function dreaminaVideoJobEndpoint(jobid: string): string {
  // UseAPI path params are passed verbatim (no encoding). The namespaced jobid
  // contains ':' and '@' which are valid in URL paths.
  return `${USEAPI_BASE}/dreamina/videos/${jobid}`;
}

/** POST https://api.useapi.net/v1/dreamina/assets/{account} — upload an image/asset. */
export function dreaminaAssetsEndpoint(account: string): string {
  return `${USEAPI_BASE}/dreamina/assets/${encodeURIComponent(account)}`;
}

export function buildDreaminaSubmitBody(input: SubmitDreaminaJobInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    model: input.model,
  };
  if (input.account) body.account = input.account;
  if (input.duration) body.duration = input.duration;
  if (input.resolution) body.resolution = input.resolution;

  // Omni Reference (multi-character) path: individual omni_N_imageRef /
  // omni_N_videoRef / omni_N_audioRef fields (1-based, NOT an array), capped at
  // 9/3/3. Mutually exclusive with the single-keyframe firstFrameRef frame mode:
  // when any image/video/audio omni ref is present we drop firstFrameRef and
  // ratio (Dreamina auto-detects the ratio in Omni mode just like first_frame).
  const imageRefs = (input.imageRefs ?? []).filter(Boolean).slice(0, DREAMINA_MAX_IMAGE_REFS);
  const videoRefs = (input.videoRefs ?? []).filter(Boolean).slice(0, DREAMINA_MAX_VIDEO_REFS);
  const audioRefs = (input.audioRefs ?? []).filter(Boolean).slice(0, DREAMINA_MAX_AUDIO_REFS);

  if (imageRefs.length > 0 || videoRefs.length > 0 || audioRefs.length > 0) {
    imageRefs.forEach((ref, i) => {
      body[`omni_${i + 1}_imageRef`] = ref;
    });
    videoRefs.forEach((ref, i) => {
      body[`omni_${i + 1}_videoRef`] = ref;
    });
    audioRefs.forEach((ref, i) => {
      body[`omni_${i + 1}_audioRef`] = ref;
    });
  } else if (input.firstFrameRef) {
    // first_frame mode: ratio is auto-detected from the image and cannot be sent.
    body.firstFrameRef = input.firstFrameRef;
  } else if (input.ratio) {
    body.ratio = input.ratio;
  }
  return body;
}

export async function submitDreaminaJob(input: SubmitDreaminaJobInput): Promise<SubmitDreaminaJobResult> {
  const body = buildDreaminaSubmitBody(input);
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as DreaminaFetchLike);
  const response = await fetchImpl(dreaminaVideosEndpoint(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dreamina submit failed: ${response.status} ${text}`);
  }
  const json = (await response.json()) as { jobid?: string; error?: string };
  if (!json.jobid) {
    throw new Error(`Dreamina submit returned unexpected shape (no jobid): ${JSON.stringify(json)}`);
  }
  return { jobid: json.jobid };
}

export type DreaminaPollStatus = 'pending' | 'completed' | 'failed';

export interface DreaminaJobResponse {
  /** Direct MP4 URL — clean master when available, watermarked fallback otherwise. */
  videoUrl?: string;
  videoUrlBackup?: string;
  videoUrlWatermarked?: string;
  watermarked?: boolean;
  videoId?: string;
  coverUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  hasAudio?: boolean;
  assetId?: string;
  [key: string]: unknown;
}

export interface PollDreaminaJobResult {
  status: DreaminaPollStatus;
  /** Direct MP4 URL of the completed video, when present. */
  videoUrl: string | null;
  /** Cover/thumbnail URL, when present. */
  coverUrl: string | null;
  /** Error summary on failure (e.g. "fail_code: 2043"). */
  error: string | null;
  raw: Record<string, unknown>;
}

/**
 * Maps Dreamina's `status` string to videoclaw's tri-state. Dreamina reports
 * `created` while a job is still generating; only `completed`/`failed` are
 * terminal.
 */
export function mapDreaminaStatus(raw: string): DreaminaPollStatus {
  const s = raw.toLowerCase();
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  return 'pending'; // created, queued, started, etc.
}

/** Parses a GET /videos/{jobid} response body into videoclaw's poll result. */
export function parseDreaminaPollResponse(json: unknown): PollDreaminaJobResult {
  const record = (json ?? {}) as {
    status?: string;
    error?: string;
    errorDetails?: string;
    response?: DreaminaJobResponse;
  };
  const status = mapDreaminaStatus(record.status ?? '');
  const response = record.response ?? {};
  const error = record.error
    ? record.errorDetails
      ? `${record.error} (${record.errorDetails})`
      : record.error
    : null;
  return {
    status,
    videoUrl: typeof response.videoUrl === 'string' ? response.videoUrl : null,
    coverUrl: typeof response.coverUrl === 'string' ? response.coverUrl : null,
    error,
    raw: (json ?? {}) as Record<string, unknown>,
  };
}

export interface PollDreaminaJobInput {
  apiToken: string;
  /** Namespaced jobid from SubmitDreaminaJobResult. */
  jobid: string;
  /** Optional fetch override (defaults to global fetch). */
  fetchImpl?: DreaminaFetchLike;
}

export async function pollDreaminaJob(input: PollDreaminaJobInput): Promise<PollDreaminaJobResult> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as DreaminaFetchLike);
  const response = await fetchImpl(dreaminaVideoJobEndpoint(input.jobid), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${input.apiToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dreamina poll failed: ${response.status} ${text}`);
  }
  return parseDreaminaPollResponse(await response.json());
}

export interface UploadDreaminaAssetInput {
  apiToken: string;
  /** Dreamina account identifier, e.g. "CA:ai@3rdeye.co.uk". */
  account: string;
  /** Raw image bytes. */
  bytes: Uint8Array;
  /** Image MIME type (image/jpeg, image/png, image/webp). Defaults to image/jpeg. */
  contentType?: string;
  /** Optional fetch override (defaults to global fetch). */
  fetchImpl?: DreaminaFetchLike;
}

export interface UploadDreaminaAssetResult {
  /** assetRef used as firstFrameRef / endFrameRef / frame_N_imageRef in POST /videos. */
  assetRef: string;
  width: number | null;
  height: number | null;
}

/**
 * Uploads raw image bytes to Dreamina and returns the `assetRef` to use as a
 * keyframe (first frame) in a video generation request.
 */
export async function uploadDreaminaAsset(input: UploadDreaminaAssetInput): Promise<UploadDreaminaAssetResult> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as DreaminaFetchLike);
  const response = await fetchImpl(dreaminaAssetsEndpoint(input.account), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiToken}`,
      'Content-Type': input.contentType ?? 'image/jpeg',
    },
    body: input.bytes,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dreamina asset upload failed: ${response.status} ${text}`);
  }
  // assetRef is the canonical field; imageRef is a legacy alias (images only).
  const json = (await response.json()) as {
    assetRef?: string;
    imageRef?: string;
    width?: number;
    height?: number;
    error?: string;
  };
  const assetRef = json.assetRef ?? json.imageRef;
  if (!assetRef) {
    throw new Error(`Dreamina asset upload returned no assetRef: ${JSON.stringify(json)}`);
  }
  return {
    assetRef,
    width: typeof json.width === 'number' ? json.width : null,
    height: typeof json.height === 'number' ? json.height : null,
  };
}
