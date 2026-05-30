import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  submitRunwayJob,
  pollRunwayJob,
  fetchRunwayResult,
  RUNWAY_MAX_IMAGE_REFS,
  RUNWAY_MAX_VIDEO_REFS,
  type RunwayAspectRatio,
  type RunwayDurationSeconds,
  type RunwayMode,
  type RunwayModel,
} from './providers/runway-useapi.js';
import type { VideoExecutionCancelResult, VideoExecutionPayload, VideoExecutionPollResult } from './types.js';

interface RunwayJobSceneState {
  sceneIndex: number;
  prompt: string;
  taskId: string;
  outputPath: string;
  status: 'submitted' | 'completed' | 'failed';
  error?: string;
}

interface RunwayNativeJobState {
  externalJobId: string;
  routeId: 'runway-useapi';
  outputDir: string;
  createdAt: string;
  scenes: RunwayJobSceneState[];
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
    throw new Error('runway-useapi native transport requires USEAPI_API_TOKEN.');
  }
  return token.trim();
}

function defaultRunwayModel(env: NodeJS.ProcessEnv): RunwayModel {
  const raw = (env.VCLAW_RUNWAY_MODEL ?? '').trim().toLowerCase();
  if (raw === 'gen-4.5' || raw === 'gen-4' || raw === 'gen-4-turbo' || raw === 'seedance-2.0') {
    return raw;
  }
  // Seedance-2 via Runway is the production default — it supports keyframe
  // (image-to-video) plus all aspect ratios we ship, with the widest duration
  // set (5/8/10/15s).
  return 'seedance-2.0';
}

function defaultRunwayMode(env: NodeJS.ProcessEnv): RunwayMode {
  const raw = (env.VCLAW_RUNWAY_MODE ?? '').trim().toLowerCase();
  if (raw === 'credits' || raw === 'credit') return 'credits';
  // 'explore' is the safe, free-tier default. videoclaw's queue executor
  // defaulted to explore as well.
  return 'explore';
}

function aspectRatioFor(profileAspect: VideoExecutionPayload['executionProfile']['aspectRatio']): RunwayAspectRatio {
  if (profileAspect === '9:16') return '9:16';
  if (profileAspect === '1:1') return '1:1';
  return '16:9';
}

function clampDuration(seconds: number | undefined): RunwayDurationSeconds {
  const value = Number.isFinite(seconds) ? Number(seconds) : 8;
  if (value >= 15) return 15;
  if (value >= 10) return 10;
  if (value >= 8) return 8;
  return 5;
}

function classifyReferences(referencePaths: string[]): { images: string[]; videos: string[] } {
  const imageExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
  const videoExt = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);
  const images: string[] = [];
  const videos: string[] = [];
  for (const path of referencePaths) {
    if (!path) continue;
    const ext = (path.split('?')[0]?.match(/\.[^.\\/]+$/)?.[0] ?? '').toLowerCase();
    if (videoExt.has(ext)) videos.push(path);
    else if (imageExt.has(ext)) images.push(path);
    else images.push(path); // unknown → treat as image to avoid silently dropping
  }
  return { images, videos };
}

/**
 * Preflight the Runway/Seedance-2 reference budget before any upload or submit.
 * Mirrors `assertReferenceBudget` (native-seedance): fail-fast with a clear
 * error rather than letting the gateway reject a partially-uploaded payload.
 * Runway caps: ≤11 images, ≤3 videos per submission.
 */
function assertRunwayReferenceBudget(sceneIndex: number, images: string[], videos: string[]): void {
  if (images.length > RUNWAY_MAX_IMAGE_REFS) {
    throw new Error(
      `runway-useapi scene ${sceneIndex}: ${images.length} image references exceed the Runway cap of ${RUNWAY_MAX_IMAGE_REFS}.`,
    );
  }
  if (videos.length > RUNWAY_MAX_VIDEO_REFS) {
    throw new Error(
      `runway-useapi scene ${sceneIndex}: ${videos.length} video references exceed the Runway cap of ${RUNWAY_MAX_VIDEO_REFS}.`,
    );
  }
}

/**
 * Best-effort prompt pre-validation against the shared Seedance content filter.
 * Seedance moderation is identical across all three gateways (ARK / Runway /
 * Dreamina), so the Runway transport reuses `seedance-content-filter` to surface
 * HIGH/MEDIUM-risk warnings. Loaded defensively so the transport never hard-fails
 * if the module's surface changes; warnings are advisory (returned, not thrown).
 */
async function preValidateRunwayPrompt(prompt: string): Promise<string[]> {
  try {
    const mod: Record<string, unknown> = await import('./seedance-content-filter.js');
    const fn = mod.preValidatePrompt as
      | ((p: string) => { warnings?: string[]; messages?: string[]; reasons?: string[] } | string[])
      | undefined;
    if (typeof fn !== 'function') return [];
    const result = fn(prompt);
    if (Array.isArray(result)) {
      // preValidatePrompt returns ContentFilterWarning[] ({level,reason,match}).
      // Format objects the same way native-dreamina/native-seedance do (HIGH/MEDIUM
      // only) instead of String(obj) -> "[object Object]". A plain string[] (the
      // defensive alt-shape) passes through unchanged.
      return result
        .filter((w) =>
          typeof w === 'string' ||
          (w as { level?: string }).level === 'HIGH' ||
          (w as { level?: string }).level === 'MEDIUM',
        )
        .map((w) =>
          typeof w === 'string'
            ? w
            : `${(w as { level?: string }).level} risk: ${(w as { reason?: string }).reason} (match: ${(w as { match?: string }).match})`,
        );
    }
    if (result && typeof result === 'object') {
      const out = result.warnings ?? result.messages ?? result.reasons ?? [];
      return Array.isArray(out) ? out.map(String) : [];
    }
    return [];
  } catch {
    // Content filter is advisory only — never block submission on its absence.
    return [];
  }
}

async function readReferenceBytes(path: string, fetchImpl: FetchLike): Promise<Buffer | null> {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const response = await fetchImpl(path);
    if (!response.ok) {
      throw new Error(`runway-useapi reference fetch failed (HTTP ${response.status}): ${path}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  if (path.startsWith('Asset://')) {
    // Asset:// is a videoclaw asset-library URI we can't resolve here; the
    // pipeline must pre-resolve it before invoking the runway transport.
    return null;
  }
  if (!existsSync(path)) return null;
  return readFile(path);
}

async function uploadRunwayAsset(
  apiToken: string,
  bytes: Buffer,
  name: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const url = `https://api.useapi.net/v1/runwayml/assets/?name=${encodeURIComponent(name)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'image/jpeg' },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`runway-useapi asset upload failed (HTTP ${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { assetId?: string; asset?: { assetId?: string }; id?: string };
  const assetId = json.assetId ?? json.asset?.assetId ?? json.id;
  if (!assetId) {
    throw new Error(`runway-useapi asset upload returned no assetId: ${JSON.stringify(json)}`);
  }
  return assetId;
}

function jobStateDir(outputDir: string): string {
  return join(outputDir, '.vclaw-jobs');
}

function jobStatePath(outputDir: string, externalJobId: string): string {
  return join(jobStateDir(outputDir), `${externalJobId}.json`);
}

async function writeJobState(state: RunwayNativeJobState): Promise<void> {
  await mkdir(jobStateDir(state.outputDir), { recursive: true });
  await writeFile(jobStatePath(state.outputDir, state.externalJobId), `${JSON.stringify(state, null, 2)}\n`);
}

async function readJobState(outputDir: string, externalJobId: string): Promise<RunwayNativeJobState> {
  const path = jobStatePath(outputDir, externalJobId);
  if (!existsSync(path)) {
    throw new Error(`Runway native job state not found for ${externalJobId}.`);
  }
  return JSON.parse(await readFile(path, 'utf-8')) as RunwayNativeJobState;
}

async function downloadToFile(fetchImpl: FetchLike, url: string, outputPath: string): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`runway-useapi download failed (HTTP ${response.status}): ${await response.text()}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  await writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));
  await rename(tmpPath, outputPath);
  if (existsSync(tmpPath)) {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function submitRunwayUseApiNative(
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
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const model = defaultRunwayModel(env);
  const mode = defaultRunwayMode(env);
  const aspectRatio = aspectRatioFor(payload.executionProfile.aspectRatio);
  const externalJobId = `runway-useapi-${Date.now()}`;

  const scenes: RunwayJobSceneState[] = [];
  const rawResponses: unknown[] = [];

  const warnings: string[] = [];

  for (const task of payload.tasks) {
    const { images } = classifyReferences(task.referencePaths);
    // Asset:// URIs are ARK Asset-Library avatar references — they are NOT
    // valid Runway asset ids and cannot be resolved against UseAPI's Runway
    // proxy, so they are skipped here (with a logged note). Only real
    // file-path / HTTP-URL images are uploadable as Runway assets.
    const uploadableImages = images.filter((path) => {
      if (path.startsWith('Asset://')) {
        warnings.push(
          `runway-useapi scene ${task.sceneIndex}: skipped Asset:// reference (ARK avatar, not a Runway asset id): ${path}`,
        );
        return false;
      }
      return true;
    });

    // Fail-fast on the reference budget BEFORE uploading anything.
    assertRunwayReferenceBudget(task.sceneIndex, uploadableImages, []);

    // Surface Seedance content-moderation warnings (shared across gateways).
    for (const note of await preValidateRunwayPrompt(task.prompt)) {
      warnings.push(`runway-useapi scene ${task.sceneIndex}: content-filter: ${note}`);
    }

    // Upload ALL usable images in referencePaths order. Each successful upload
    // yields a Runway asset id; unresolved/missing paths are skipped.
    const imageAssetIds: string[] = [];
    for (let i = 0; i < uploadableImages.length; i += 1) {
      const bytes = await readReferenceBytes(uploadableImages[i], fetchImpl);
      if (!bytes) continue;
      const assetId = await uploadRunwayAsset(
        apiToken,
        bytes,
        `scene-${task.sceneIndex}-ref-${i + 1}`,
        fetchImpl,
      );
      imageAssetIds.push(assetId);
    }

    // Routing:
    //  - Seedance-2 + >1 image  → multi-reference (imageAssetId1..N) in submitRunwayJob.
    //  - Seedance-2 + exactly 1 → single keyframe (startFrameAssetId) — unchanged.
    //  - Gen-4.x + ≥1 image     → firstImageAssetId i2v (uses first image only).
    const singleKeyframe = imageAssetIds.length === 1 ? imageAssetIds[0] : null;

    const seconds = clampDuration(task.durationSeconds);
    const submit = await submitRunwayJob({
      apiToken,
      model,
      textPrompt: task.prompt,
      mode,
      seconds,
      aspectRatio,
      ...(model === 'seedance-2.0' && imageAssetIds.length > 1 ? { imageAssetIds } : {}),
      ...(model === 'seedance-2.0' && singleKeyframe ? { startFrameAssetId: singleKeyframe } : {}),
      ...(model !== 'seedance-2.0' && singleKeyframe ? { firstImageAssetId: singleKeyframe } : {}),
      ...(model !== 'seedance-2.0' && imageAssetIds.length > 1 ? { firstImageAssetId: imageAssetIds[0] } : {}),
      fetchImpl,
    });
    rawResponses.push({ sceneIndex: task.sceneIndex, taskId: submit.taskId, imageAssetIds });

    scenes.push({
      sceneIndex: task.sceneIndex,
      prompt: task.prompt,
      taskId: submit.taskId,
      outputPath: join(payload.outputDir, `scene-${task.sceneIndex}.mp4`),
      status: 'submitted',
    });
  }

  await writeJobState({
    externalJobId,
    routeId: 'runway-useapi',
    outputDir: payload.outputDir,
    createdAt: new Date().toISOString(),
    scenes,
  });

  return {
    externalJobId,
    rawResult: {
      externalJobId,
      model,
      mode,
      submittedScenes: scenes.map((scene) => ({ sceneIndex: scene.sceneIndex, taskId: scene.taskId })),
      responses: rawResponses,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

export async function pollRunwayUseApiNative(
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
        backend: 'runway-useapi',
      });
      continue;
    }
    if (scene.status === 'failed') {
      anyFailed = true;
      if (scene.error) issues.push(scene.error);
      continue;
    }
    const polled = await pollRunwayJob({ apiToken, taskId: scene.taskId, fetchImpl });
    rawResults.push({ sceneIndex: scene.sceneIndex, status: polled.status, progress: polled.progress });
    if (polled.status === 'completed') {
      const fetched = await fetchRunwayResult({ apiToken, taskId: scene.taskId, fetchImpl });
      if (!fetched.videoUrl) {
        scene.status = 'failed';
        scene.error = `runway-useapi scene ${scene.sceneIndex} completed without a video URL.`;
        issues.push(scene.error);
        anyFailed = true;
        continue;
      }
      if (!existsSync(scene.outputPath)) {
        await downloadToFile(fetchImpl, fetched.videoUrl, scene.outputPath);
      }
      scene.status = 'completed';
      outputs.push({
        id: `generated-scene-${scene.sceneIndex}`,
        kind: 'video',
        path: scene.outputPath,
        sceneIndex: scene.sceneIndex,
        backend: 'runway-useapi',
      });
    } else if (polled.status === 'failed') {
      scene.status = 'failed';
      scene.error = `runway-useapi scene ${scene.sceneIndex} failed: ${JSON.stringify(polled.raw).slice(0, 400)}`;
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

export async function cancelRunwayUseApiNative(
  input: {
    outputDir: string;
    externalJobId: string;
    workspaceRoot: string;
  },
): Promise<VideoExecutionCancelResult> {
  // UseAPI's Runway endpoints don't expose a cancel verb — best we can do is
  // mark local state failed so subsequent polls don't keep waiting. Pending
  // server-side tasks will continue and consume credits/quota until they
  // resolve on their own.
  const state = await readJobState(input.outputDir, input.externalJobId);
  for (const scene of state.scenes) {
    if (scene.status === 'submitted') {
      scene.status = 'failed';
      scene.error = 'Execution cancelled by operator (runway-useapi has no server-side cancel; remote task continues).';
    }
  }
  await writeJobState(state);
  return {
    status: 'cancelled',
    externalJobId: input.externalJobId,
    issues: [
      'runway-useapi has no UseAPI cancel endpoint; remote tasks may continue to run and consume quota.',
    ],
    rawResult: null,
  };
}
