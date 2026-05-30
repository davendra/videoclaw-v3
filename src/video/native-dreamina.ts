import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  submitDreaminaJob,
  pollDreaminaJob,
  uploadDreaminaAsset,
  DREAMINA_MAX_IMAGE_REFS,
  DREAMINA_MAX_VIDEO_REFS,
  DREAMINA_MAX_AUDIO_REFS,
  type DreaminaAspectRatio,
  type DreaminaDurationSeconds,
  type DreaminaModel,
  type DreaminaResolution,
} from './providers/dreamina-useapi.js';
import type { VideoExecutionCancelResult, VideoExecutionPayload, VideoExecutionPollResult } from './types.js';
import { isContentViolation, preValidatePrompt, sanitizePrompt } from './seedance-content-filter.js';

interface DreaminaJobSceneState {
  sceneIndex: number;
  prompt: string;
  jobid: string;
  outputPath: string;
  status: 'submitted' | 'completed' | 'failed';
  error?: string;
}

interface DreaminaNativeJobState {
  externalJobId: string;
  routeId: 'dreamina-useapi';
  outputDir: string;
  createdAt: string;
  scenes: DreaminaJobSceneState[];
}

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}) => Promise<FetchLikeResponse>;

function readDotEnvLike(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    out[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function loadWorkspaceEnv(workspaceRoot: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const envLocalPath = join(workspaceRoot, '.env.local');
  if (!existsSync(envLocalPath)) return env;
  return {
    ...readDotEnvLike(await readFile(envLocalPath, 'utf-8')),
    ...env,
  };
}

function getUseApiToken(env: NodeJS.ProcessEnv): string {
  const token = env.USEAPI_API_TOKEN;
  if (!token || !token.trim()) {
    throw new Error('dreamina-useapi native transport requires USEAPI_API_TOKEN.');
  }
  return token.trim();
}

function getDreaminaAccount(env: NodeJS.ProcessEnv): string {
  const account = env.VCLAW_DREAMINA_ACCOUNT;
  if (!account || !account.trim()) {
    throw new Error('dreamina-useapi native transport requires VCLAW_DREAMINA_ACCOUNT (e.g. "CA:ai@example.com").');
  }
  return account.trim();
}

function defaultDreaminaModel(env: NodeJS.ProcessEnv): DreaminaModel {
  const raw = (env.VCLAW_DREAMINA_MODEL ?? '').trim().toLowerCase();
  const known: DreaminaModel[] = [
    'seedance-2.0',
    'seedance-2.0-fast',
    'seedance-1.5-pro',
    'seedance-1.0-pro',
    'seedance-1.0-mini',
    'seedance-1.0-fast',
    'sora2',
  ];
  if ((known as string[]).includes(raw)) {
    return raw as DreaminaModel;
  }
  // Seedance 2.0 is the production default — image-to-video (keyframe) plus
  // 1080p on CA accounts.
  return 'seedance-2.0';
}

/**
 * 1080p is CA-only as of April 2026; we honor the project's requested
 * resolution but the API rejects 1080p on US accounts server-side.
 */
function resolutionFor(profileResolution: VideoExecutionPayload['executionProfile']['resolution']): DreaminaResolution {
  return profileResolution === '1080p' ? '1080p' : '720p';
}

function aspectRatioFor(profileAspect: VideoExecutionPayload['executionProfile']['aspectRatio']): DreaminaAspectRatio {
  if (profileAspect === '9:16') return '9:16';
  if (profileAspect === '1:1') return '1:1';
  return '16:9';
}

function clampDuration(seconds: number | undefined): DreaminaDurationSeconds {
  const value = Number.isFinite(seconds) ? Number(seconds) : 5;
  if (value >= 15) return 15;
  if (value >= 12) return 12;
  if (value >= 10) return 10;
  if (value >= 8) return 8;
  if (value >= 5) return 5;
  return 4;
}

function classifyReferences(referencePaths: string[]): { images: string[]; videos: string[]; audios: string[] } {
  const imageExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
  const videoExt = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);
  const audioExt = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);
  const images: string[] = [];
  const videos: string[] = [];
  const audios: string[] = [];
  for (const path of referencePaths) {
    if (!path) continue;
    const ext = (path.split('?')[0]?.match(/\.[^.\\/]+$/)?.[0] ?? '').toLowerCase();
    if (videoExt.has(ext)) videos.push(path);
    else if (audioExt.has(ext)) audios.push(path);
    else if (imageExt.has(ext)) images.push(path);
    else images.push(path); // unknown → treat as image to avoid silently dropping
  }
  return { images, videos, audios };
}

/**
 * Preflight the Dreamina Omni Reference budget before any upload or submit.
 * Mirrors `assertRunwayReferenceBudget` (native-runway) and Seedance's
 * `assertReferenceBudget`: fail-fast with a clear error rather than letting the
 * gateway reject a partially-uploaded payload. Dreamina caps: 9 img / 3 vid /
 * 3 aud per submission.
 */
function assertDreaminaReferenceBudget(
  sceneIndex: number,
  images: string[],
  videos: string[],
  audios: string[],
): void {
  if (images.length > DREAMINA_MAX_IMAGE_REFS) {
    throw new Error(
      `dreamina-useapi scene ${sceneIndex}: ${images.length} image references exceed the Dreamina cap of ${DREAMINA_MAX_IMAGE_REFS}.`,
    );
  }
  if (videos.length > DREAMINA_MAX_VIDEO_REFS) {
    throw new Error(
      `dreamina-useapi scene ${sceneIndex}: ${videos.length} video references exceed the Dreamina cap of ${DREAMINA_MAX_VIDEO_REFS}.`,
    );
  }
  if (audios.length > DREAMINA_MAX_AUDIO_REFS) {
    throw new Error(
      `dreamina-useapi scene ${sceneIndex}: ${audios.length} audio references exceed the Dreamina cap of ${DREAMINA_MAX_AUDIO_REFS}.`,
    );
  }
}

/**
 * Asset:// URIs are ARK Asset-Library avatar references — they are NOT valid
 * Dreamina assetRefs and cannot be resolved against UseAPI's Dreamina proxy, so
 * they are skipped here (with a warning), exactly as the Runway transport does.
 * Only real file-path / HTTP-URL references are uploadable as Dreamina assets.
 */
function filterUploadableRefs(
  refs: string[],
  sceneIndex: number,
  kind: 'image' | 'video' | 'audio',
  warnings: string[],
): string[] {
  return refs.filter((path) => {
    if (path.startsWith('Asset://')) {
      warnings.push(
        `dreamina-useapi scene ${sceneIndex}: skipped Asset:// ${kind} reference (ARK avatar, not a Dreamina assetRef): ${path}`,
      );
      return false;
    }
    return true;
  });
}

function referenceContentType(path: string): string {
  const ext = (path.split('?')[0]?.match(/\.[^.\\/]+$/)?.[0] ?? '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.aac') return 'audio/aac';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.ogg') return 'audio/ogg';
  return 'image/jpeg';
}

/**
 * Best-effort prompt pre-validation against the shared Seedance content filter.
 * Seedance moderation is identical across all three gateways (ARK / Runway /
 * Dreamina), so the Dreamina transport reuses `seedance-content-filter`. Returns
 * formatted HIGH/MEDIUM warning strings (advisory — never blocks submission),
 * iterating the `ContentFilterWarning[]` directly like native-seedance does.
 */
function preValidateDreaminaPrompt(prompt: string): string[] {
  const notes: string[] = [];
  for (const warning of preValidatePrompt(prompt)) {
    if (warning.level === 'HIGH' || warning.level === 'MEDIUM') {
      notes.push(`${warning.level} risk: ${warning.reason} (match: ${warning.match})`);
    }
  }
  return notes;
}

/**
 * Upload each reference in order, returning the assetRefs of the ones that
 * resolved to bytes (missing/unresolvable paths are skipped). Used for the Omni
 * Reference multi-character path.
 */
async function uploadReferenceAssets(
  paths: string[],
  ctx: { apiToken: string; account: string; fetchImpl: FetchLike },
): Promise<string[]> {
  const refs: string[] = [];
  for (const path of paths) {
    const bytes = await readReferenceBytes(path, ctx.fetchImpl);
    if (!bytes) continue;
    const uploaded = await uploadDreaminaAsset({
      apiToken: ctx.apiToken,
      account: ctx.account,
      bytes,
      contentType: referenceContentType(path),
      fetchImpl: ctx.fetchImpl as unknown as Parameters<typeof uploadDreaminaAsset>[0]['fetchImpl'],
    });
    refs.push(uploaded.assetRef);
  }
  return refs;
}

async function readReferenceBytes(path: string, fetchImpl: FetchLike): Promise<Buffer | null> {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const response = await fetchImpl(path);
    if (!response.ok) {
      throw new Error(`dreamina-useapi reference fetch failed (HTTP ${response.status}): ${path}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  if (path.startsWith('Asset://')) {
    // Asset:// is a videoclaw asset-library URI we can't resolve here; the
    // pipeline must pre-resolve it before invoking the dreamina transport.
    return null;
  }
  if (!existsSync(path)) return null;
  return readFile(path);
}

function jobStateDir(outputDir: string): string {
  return join(outputDir, '.vclaw-jobs');
}

function jobStatePath(outputDir: string, externalJobId: string): string {
  return join(jobStateDir(outputDir), `${externalJobId}.json`);
}

async function writeJobState(state: DreaminaNativeJobState): Promise<void> {
  await mkdir(jobStateDir(state.outputDir), { recursive: true });
  await writeFile(jobStatePath(state.outputDir, state.externalJobId), `${JSON.stringify(state, null, 2)}\n`);
}

async function readJobState(outputDir: string, externalJobId: string): Promise<DreaminaNativeJobState> {
  const path = jobStatePath(outputDir, externalJobId);
  if (!existsSync(path)) {
    throw new Error(`Dreamina native job state not found for ${externalJobId}.`);
  }
  return JSON.parse(await readFile(path, 'utf-8')) as DreaminaNativeJobState;
}

async function downloadToFile(fetchImpl: FetchLike, url: string, outputPath: string): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`dreamina-useapi download failed (HTTP ${response.status}): ${await response.text()}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  await writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));
  await rename(tmpPath, outputPath);
  if (existsSync(tmpPath)) {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function submitDreaminaUseApiNative(
  payload: VideoExecutionPayload,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<{
  externalJobId: string;
  rawResult: unknown;
}> {
  const env = await loadWorkspaceEnv(payload.workspaceRoot, options.env ?? process.env);
  const apiToken = getUseApiToken(env);
  const account = getDreaminaAccount(env);
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const model = defaultDreaminaModel(env);
  const aspectRatio = aspectRatioFor(payload.executionProfile.aspectRatio);
  const resolution = resolutionFor(payload.executionProfile.resolution);
  const externalJobId = `dreamina-useapi-${Date.now()}`;

  const scenes: DreaminaJobSceneState[] = [];
  const rawResponses: unknown[] = [];
  const warnings: string[] = [];

  // Preflight the 9/3/3 Omni Reference budget for EVERY task before any network
  // call, so an over-budget task N cannot cause a partial submit (tasks 0..N-1
  // already charged against credits while task N throws). Asset:// avatar URIs
  // are dropped first (they are not Dreamina assetRefs).
  for (const task of payload.tasks) {
    const { images, videos, audios } = classifyReferences(task.referencePaths);
    assertDreaminaReferenceBudget(
      task.sceneIndex,
      filterUploadableRefs(images, task.sceneIndex, 'image', []),
      filterUploadableRefs(videos, task.sceneIndex, 'video', []),
      filterUploadableRefs(audios, task.sceneIndex, 'audio', []),
    );
  }

  for (const task of payload.tasks) {
    const { images, videos, audios } = classifyReferences(task.referencePaths);

    // Surface Seedance content-moderation warnings (shared across gateways;
    // advisory only — never blocks or alters the submit).
    for (const note of preValidateDreaminaPrompt(task.prompt)) {
      warnings.push(`dreamina-useapi scene ${task.sceneIndex}: content-filter: ${note}`);
    }

    // Drop ARK Asset:// avatar URIs (not valid Dreamina assetRefs), recording a
    // warning per skipped reference.
    const uploadableImages = filterUploadableRefs(images, task.sceneIndex, 'image', warnings);
    const uploadableVideos = filterUploadableRefs(videos, task.sceneIndex, 'video', warnings);
    const uploadableAudios = filterUploadableRefs(audios, task.sceneIndex, 'audio', warnings);

    // Routing:
    //  - exactly 1 image, no video/audio → single firstFrameRef (first_frame
    //    image-to-video mode), unchanged from the original behavior.
    //  - multiple images, or any video/audio reference → Omni Reference
    //    multi-character lock via omni_N_imageRef/videoRef/audioRef.
    const multiRef =
      uploadableImages.length > 1 || uploadableVideos.length > 0 || uploadableAudios.length > 0;

    let firstFrameRef: string | null = null;
    let imageRefs: string[] = [];
    let videoRefs: string[] = [];
    let audioRefs: string[] = [];

    if (multiRef) {
      imageRefs = await uploadReferenceAssets(uploadableImages, { apiToken, account, fetchImpl });
      videoRefs = await uploadReferenceAssets(uploadableVideos, { apiToken, account, fetchImpl });
      audioRefs = await uploadReferenceAssets(uploadableAudios, { apiToken, account, fetchImpl });
    } else if (uploadableImages[0]) {
      // Use the first usable image as the keyframe (first frame). Dreamina takes
      // an uploaded assetRef as firstFrameRef, which switches the job into
      // image-to-video (first_frame) mode.
      const single = await uploadReferenceAssets([uploadableImages[0]], { apiToken, account, fetchImpl });
      firstFrameRef = single[0] ?? null;
    }

    // If a multi-ref upload yielded nothing usable (e.g. all paths unresolved),
    // fall back to single-keyframe/text routing semantics (no omni fields).
    const hasOmniRefs = imageRefs.length > 0 || videoRefs.length > 0 || audioRefs.length > 0;

    const duration = clampDuration(task.durationSeconds);
    // Submit with the content-filter retry-with-sanitization loop, consistent
    // with native-seedance: on a content-violation (ark error 2038 / 违规)
    // submit error, retry once with level-1 then level-2 sanitized prompt. A
    // non-violation error is re-thrown immediately; a clean prompt takes the
    // exact same single-submit path as before.
    const buildSubmitInput = (prompt: string) => ({
      apiToken,
      model,
      prompt,
      account,
      duration,
      resolution,
      // Omni Reference mode and first_frame mode both auto-detect the ratio from
      // the references; only send ratio for pure text-to-video.
      ...(hasOmniRefs
        ? { imageRefs, videoRefs, audioRefs }
        : firstFrameRef
          ? { firstFrameRef }
          : { ratio: aspectRatio }),
      fetchImpl: fetchImpl as unknown as Parameters<typeof submitDreaminaJob>[0]['fetchImpl'],
    });
    const submit = await submitWithContentFilter(task.prompt, buildSubmitInput);
    rawResponses.push({
      sceneIndex: task.sceneIndex,
      jobid: submit.jobid,
      ...(hasOmniRefs ? { imageRefs, videoRefs, audioRefs } : { firstFrameRef }),
    });

    scenes.push({
      sceneIndex: task.sceneIndex,
      prompt: task.prompt,
      jobid: submit.jobid,
      outputPath: join(payload.outputDir, `scene-${task.sceneIndex}.mp4`),
      status: 'submitted',
    });
  }

  await writeJobState({
    externalJobId,
    routeId: 'dreamina-useapi',
    outputDir: payload.outputDir,
    createdAt: new Date().toISOString(),
    scenes,
  });

  return {
    externalJobId,
    rawResult: {
      externalJobId,
      model,
      resolution,
      account,
      submittedScenes: scenes.map((scene) => ({ sceneIndex: scene.sceneIndex, jobid: scene.jobid })),
      responses: rawResponses,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Submit with the content-filter retry-with-sanitization loop ported from
 * native-seedance / `seedance_client.py`: submit with the original prompt; on a
 * content-violation submit error (`isContentViolation`, e.g. ark error code
 * 2038 / Chinese 违规 patterns), retry once with `sanitizePrompt(prompt, 1)`,
 * then once more with level 2. A non-content-violation error is re-thrown
 * immediately, and a clean prompt takes the exact same single-submit path as
 * before (no behavior change without a violation). `buildSubmitInput(prompt)`
 * rebuilds the full submit input so the retried submission keeps the same
 * references/profile, swapping only the sanitized prompt.
 */
async function submitWithContentFilter(
  prompt: string,
  buildSubmitInput: (prompt: string) => Parameters<typeof submitDreaminaJob>[0],
): ReturnType<typeof submitDreaminaJob> {
  try {
    return await submitDreaminaJob(buildSubmitInput(prompt));
  } catch (error) {
    if (!isContentViolation(errorMessage(error))) {
      throw error;
    }
    for (const level of [1, 2] as const) {
      const sanitized = sanitizePrompt(prompt, level);
      try {
        return await submitDreaminaJob(buildSubmitInput(sanitized));
      } catch (retryError) {
        if (!isContentViolation(errorMessage(retryError)) || level === 2) {
          throw retryError;
        }
      }
    }
    // Unreachable: the level-2 branch above always either returns or throws.
    throw error;
  }
}

export async function pollDreaminaUseApiNative(
  input: {
    outputDir: string;
    externalJobId: string;
    workspaceRoot: string;
  },
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<VideoExecutionPollResult> {
  const env = await loadWorkspaceEnv(input.workspaceRoot, options.env ?? process.env);
  const apiToken = getUseApiToken(env);
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const state = await readJobState(input.outputDir, input.externalJobId);

  const outputs: VideoExecutionPollResult['outputs'] = [];
  const issues: string[] = [];
  const rawResults: unknown[] = [];
  let anyPending = false;
  let anyFailed = false;

  for (const scene of state.scenes) {
    if (scene.status === 'completed' && existsSync(scene.outputPath)) {
      outputs.push({
        id: `generated-scene-${scene.sceneIndex}`,
        kind: 'video',
        path: scene.outputPath,
        sceneIndex: scene.sceneIndex,
        backend: 'dreamina-useapi',
      });
      continue;
    }
    if (scene.status === 'failed') {
      anyFailed = true;
      if (scene.error) issues.push(scene.error);
      continue;
    }
    const polled = await pollDreaminaJob({
      apiToken,
      jobid: scene.jobid,
      fetchImpl: fetchImpl as unknown as Parameters<typeof pollDreaminaJob>[0]['fetchImpl'],
    });
    rawResults.push({ sceneIndex: scene.sceneIndex, status: polled.status });
    if (polled.status === 'completed') {
      if (!polled.videoUrl) {
        scene.status = 'failed';
        scene.error = `dreamina-useapi scene ${scene.sceneIndex} completed without a video URL.`;
        issues.push(scene.error);
        anyFailed = true;
        continue;
      }
      if (!existsSync(scene.outputPath)) {
        await downloadToFile(fetchImpl, polled.videoUrl, scene.outputPath);
      }
      scene.status = 'completed';
      outputs.push({
        id: `generated-scene-${scene.sceneIndex}`,
        kind: 'video',
        path: scene.outputPath,
        sceneIndex: scene.sceneIndex,
        backend: 'dreamina-useapi',
      });
    } else if (polled.status === 'failed') {
      scene.status = 'failed';
      scene.error = `dreamina-useapi scene ${scene.sceneIndex} failed: ${polled.error ?? JSON.stringify(polled.raw).slice(0, 400)}`;
      issues.push(scene.error);
      anyFailed = true;
    } else {
      anyPending = true;
    }
  }

  await writeJobState(state);

  return {
    status: anyFailed ? 'failed' : anyPending ? 'pending' : 'completed',
    externalJobId: input.externalJobId,
    outputs,
    issues,
    rawResult: rawResults,
  };
}

export async function cancelDreaminaUseApiNative(
  input: {
    outputDir: string;
    externalJobId: string;
    workspaceRoot: string;
  },
): Promise<VideoExecutionCancelResult> {
  // UseAPI's Dreamina video endpoints don't expose a cancel verb for an
  // in-flight job — best we can do is mark local state failed so subsequent
  // polls don't keep waiting. Pending server-side jobs continue and consume
  // credits until they resolve on their own.
  const state = await readJobState(input.outputDir, input.externalJobId);
  for (const scene of state.scenes) {
    if (scene.status === 'submitted') {
      scene.status = 'failed';
      scene.error = 'Execution cancelled by operator (dreamina-useapi has no server-side cancel; remote job continues).';
    }
  }
  await writeJobState(state);
  return {
    status: 'cancelled',
    externalJobId: input.externalJobId,
    issues: [
      'dreamina-useapi has no UseAPI cancel endpoint; remote jobs may continue to run and consume credits.',
    ],
    rawResult: null,
  };
}
