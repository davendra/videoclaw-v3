import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  submitDreaminaJob,
  pollDreaminaJob,
  uploadDreaminaAsset,
  type DreaminaAspectRatio,
  type DreaminaDurationSeconds,
  type DreaminaModel,
  type DreaminaResolution,
} from './providers/dreamina-useapi.js';
import type { VideoExecutionCancelResult, VideoExecutionPayload, VideoExecutionPollResult } from './types.js';

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

function imageContentType(path: string): string {
  const ext = (path.split('?')[0]?.match(/\.[^.\\/]+$/)?.[0] ?? '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
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

  for (const task of payload.tasks) {
    const { images } = classifyReferences(task.referencePaths);
    // Use the first usable image as the keyframe (first frame). Dreamina takes
    // an uploaded assetRef as firstFrameRef, which switches the job into
    // image-to-video (first_frame) mode.
    let firstFrameRef: string | null = null;
    if (images[0]) {
      const bytes = await readReferenceBytes(images[0], fetchImpl);
      if (bytes) {
        const uploaded = await uploadDreaminaAsset({
          apiToken,
          account,
          bytes,
          contentType: imageContentType(images[0]),
          fetchImpl: fetchImpl as unknown as Parameters<typeof uploadDreaminaAsset>[0]['fetchImpl'],
        });
        firstFrameRef = uploaded.assetRef;
      }
    }

    const duration = clampDuration(task.durationSeconds);
    const submit = await submitDreaminaJob({
      apiToken,
      model,
      prompt: task.prompt,
      account,
      duration,
      resolution,
      // first_frame mode auto-detects ratio from the image; only send ratio for
      // pure text-to-video.
      ...(firstFrameRef ? { firstFrameRef } : { ratio: aspectRatio }),
      fetchImpl: fetchImpl as unknown as Parameters<typeof submitDreaminaJob>[0]['fetchImpl'],
    });
    rawResponses.push({ sceneIndex: task.sceneIndex, jobid: submit.jobid, firstFrameRef });

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
    },
  };
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
