import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  submitRunwayJob,
  pollRunwayJob,
  fetchRunwayResult,
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

  for (const task of payload.tasks) {
    const { images } = classifyReferences(task.referencePaths);
    // Use the first usable image as the keyframe. Runway-via-UseAPI uses
    // startFrameAssetId for Seedance-2 and firstImage_assetId for Gen-4.x;
    // we route purely on `model`.
    let keyframeAssetId: string | null = null;
    if (images[0]) {
      const bytes = await readReferenceBytes(images[0], fetchImpl);
      if (bytes) {
        keyframeAssetId = await uploadRunwayAsset(
          apiToken,
          bytes,
          `scene-${task.sceneIndex}-frame`,
          fetchImpl,
        );
      }
    }

    const seconds = clampDuration(task.durationSeconds);
    const submit = await submitRunwayJob({
      apiToken,
      model,
      textPrompt: task.prompt,
      mode,
      seconds,
      aspectRatio,
      ...(keyframeAssetId && model === 'seedance-2.0' ? { startFrameAssetId: keyframeAssetId } : {}),
      ...(keyframeAssetId && model !== 'seedance-2.0' ? { firstImageAssetId: keyframeAssetId } : {}),
      fetchImpl,
    });
    rawResponses.push({ sceneIndex: task.sceneIndex, taskId: submit.taskId, keyframeAssetId });

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
