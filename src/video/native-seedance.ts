import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { VideoExecutionCancelResult, VideoExecutionPayload, VideoExecutionPollResult } from './types.js';

interface SeedanceJobSceneState {
  sceneIndex: number;
  prompt: string;
  taskId: string;
  outputPath: string;
  status: 'submitted' | 'completed' | 'failed';
  error?: string;
}

interface SeedanceNativeJobState {
  externalJobId: string;
  routeId: 'seedance-direct';
  outputDir: string;
  createdAt: string;
  scenes: SeedanceJobSceneState[];
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
  body?: string;
}) => Promise<FetchLikeResponse>;

interface ClassifiedReferencePaths {
  images: string[];
  videos: string[];
  audios: string[];
}

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
  if (!existsSync(envLocalPath)) {
    return env;
  }
  const raw = await readFile(envLocalPath, 'utf-8');
  return {
    ...readDotEnvLike(raw),
    ...env,
  };
}

function getSeedanceApiKey(env: NodeJS.ProcessEnv): string {
  const apiKey = env.SUTUI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('seedance-direct native transport requires SUTUI_API_KEY.');
  }
  return apiKey.trim();
}

function baseUrl(env: NodeJS.ProcessEnv): string {
  return (env.VCLAW_SEEDANCE_BASE_URL || 'https://api.xskill.ai').replace(/\/+$/, '');
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function referenceExtension(referencePath: string): string {
  try {
    return extname(new URL(referencePath).pathname).toLowerCase();
  } catch {
    return extname(referencePath.split('?')[0] ?? referencePath).toLowerCase();
  }
}

function classifyReferencePaths(referencePaths: string[]): ClassifiedReferencePaths {
  const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
  const videos = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);
  const audios = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);
  const classified: ClassifiedReferencePaths = { images: [], videos: [], audios: [] };

  for (const referencePath of referencePaths) {
    if (referencePath.startsWith('Asset://')) {
      classified.images.push(referencePath);
      continue;
    }
    const extension = referenceExtension(referencePath);
    if (videos.has(extension)) {
      classified.videos.push(referencePath);
    } else if (audios.has(extension)) {
      classified.audios.push(referencePath);
    } else {
      classified.images.push(referencePath);
    }
  }

  return classified;
}

const REFERENCE_BUDGET = { images: 9, videos: 3, audios: 3 } as const;

/**
 * Fail fast when a reference set exceeds Seedance 2.0's per-generation limits
 * (<=9 image, <=3 video, <=3 audio references). Classifies via the same
 * `classifyReferencePaths` logic used to route references into provider params,
 * so image/video/audio counts always agree with what would actually be sent.
 * Returns void at or below every limit; throws a clear Error otherwise.
 */
export function assertReferenceBudget(referencePaths: string[]): void {
  const classified = classifyReferencePaths(referencePaths);
  if (classified.images.length > REFERENCE_BUDGET.images) {
    throw new Error(
      `Seedance reference budget exceeded: ${classified.images.length} image references (max ${REFERENCE_BUDGET.images}).`,
    );
  }
  if (classified.videos.length > REFERENCE_BUDGET.videos) {
    throw new Error(
      `Seedance reference budget exceeded: ${classified.videos.length} video references (max ${REFERENCE_BUDGET.videos}).`,
    );
  }
  if (classified.audios.length > REFERENCE_BUDGET.audios) {
    throw new Error(
      `Seedance reference budget exceeded: ${classified.audios.length} audio references (max ${REFERENCE_BUDGET.audios}).`,
    );
  }
}

function seedanceReferenceParams(referencePaths: string[]): Record<string, unknown> {
  assertReferenceBudget(referencePaths);
  const classified = classifyReferencePaths(referencePaths);
  const params: Record<string, unknown> = {};

  const hasMultimodalReferences = classified.videos.length > 0 || classified.audios.length > 0;

  if (hasMultimodalReferences && classified.images.length > 0) {
    params.reference_images = classified.images;
  } else if (classified.images.length === 1) {
    params.image_url = classified.images[0];
  } else if (classified.images.length > 1) {
    params.reference_images = classified.images;
  }

  if (classified.videos.length > 0) {
    params.reference_videos = classified.videos;
  }
  if (classified.audios.length > 0) {
    params.reference_audios = classified.audios;
  }

  return params;
}

function jobStateDir(outputDir: string): string {
  return join(outputDir, '.vclaw-jobs');
}

function jobStatePath(outputDir: string, externalJobId: string): string {
  return join(jobStateDir(outputDir), `${externalJobId}.json`);
}

async function writeJobState(state: SeedanceNativeJobState): Promise<void> {
  await mkdir(jobStateDir(state.outputDir), { recursive: true });
  await writeFile(jobStatePath(state.outputDir, state.externalJobId), `${JSON.stringify(state, null, 2)}\n`);
}

async function readJobState(outputDir: string, externalJobId: string): Promise<SeedanceNativeJobState> {
  const path = jobStatePath(outputDir, externalJobId);
  if (!existsSync(path)) {
    throw new Error(`Seedance native job state not found for ${externalJobId}.`);
  }
  return JSON.parse(await readFile(path, 'utf-8')) as SeedanceNativeJobState;
}

function extractTaskId(result: unknown): string {
  const taskId = result && typeof result === 'object' && 'data' in result
    ? (result as { data?: { task_id?: unknown } }).data?.task_id
    : undefined;
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error('Seedance native submit did not return a task id.');
  }
  return taskId;
}

function extractStatus(result: unknown): string {
  const status = result && typeof result === 'object' && 'data' in result
    ? (result as { data?: { status?: unknown } }).data?.status
    : undefined;
  return typeof status === 'string' ? status : '';
}

function extractVideoUrl(result: unknown): string {
  const data = result && typeof result === 'object' && 'data' in result
    ? (result as { data?: Record<string, unknown> }).data ?? {}
    : {};
  const asRecord = data as Record<string, unknown>;
  const output = typeof asRecord.output === 'object' && asRecord.output ? asRecord.output as Record<string, unknown> : {};
  const resultNode = typeof asRecord.result === 'object' && asRecord.result ? asRecord.result as Record<string, unknown> : {};
  const resultOutput = typeof resultNode.output === 'object' && resultNode.output ? resultNode.output as Record<string, unknown> : {};

  // Video URLs first: a video job's response can also carry an `images` array
  // (a preview/cover frame), and returning that ahead of the video URL would
  // download a still frame in place of the rendered clip. Treat `images` as the
  // last-resort fallback only.
  if (typeof output.video_url === 'string') return output.video_url;
  if (typeof resultNode.video_url === 'string') return resultNode.video_url;
  const videos = Array.isArray(resultOutput.videos) ? resultOutput.videos : [];
  if (typeof videos[0] === 'string') return videos[0];
  if (typeof asRecord.video_url === 'string') return asRecord.video_url;
  const images = Array.isArray(resultOutput.images) ? resultOutput.images : [];
  if (typeof images[0] === 'string') return images[0];
  throw new Error('Seedance native poll completed without a video URL.');
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  init: {
    headers: Record<string, string>;
    body: unknown;
  },
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: init.headers,
    body: JSON.stringify(init.body),
  });
  if (!response.ok) {
    throw new Error(`Seedance request failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function downloadToFile(fetchImpl: FetchLike, url: string, outputPath: string): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Seedance download failed with HTTP ${response.status}: ${await response.text()}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  await writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));
  await rename(tmpPath, outputPath);
  if (existsSync(tmpPath)) {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function submitSeedanceDirectNative(
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
  const apiKey = getSeedanceApiKey(env);
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const createUrl = `${baseUrl(env)}/api/v3/tasks/create`;
  const externalJobId = `seedance-${Date.now()}`;

  // Preflight: validate every task's reference budget before any network call so
  // an over-budget task N cannot cause a partial submit (tasks 0..N-1 already
  // charged against provider credits while task N throws).
  for (const task of payload.tasks) {
    assertReferenceBudget(task.referencePaths);
  }

  const scenes: SeedanceJobSceneState[] = [];
  const rawResults: unknown[] = [];
  for (const task of payload.tasks) {
    const result = await postJson(fetchImpl, createUrl, {
      headers: headers(apiKey),
      body: {
        model: 'ark/seedance-2.0',
        params: {
          prompt: task.prompt,
          ratio: payload.executionProfile.aspectRatio,
          duration: String(task.durationSeconds ?? 8),
          model: payload.executionProfile.quality === 'quality' ? 'seedance_2.0' : 'seedance_2.0_fast',
          resolution: payload.executionProfile.resolution,
          generate_audio: payload.executionProfile.generateAudio,
          watermark: false,
          ...seedanceReferenceParams(task.referencePaths),
        },
        channel: null,
      },
    });
    rawResults.push(result);
    scenes.push({
      sceneIndex: task.sceneIndex,
      prompt: task.prompt,
      taskId: extractTaskId(result),
      outputPath: join(payload.outputDir, `scene-${task.sceneIndex}.mp4`),
      status: 'submitted',
    });
  }

  await writeJobState({
    externalJobId,
    routeId: 'seedance-direct',
    outputDir: payload.outputDir,
    createdAt: new Date().toISOString(),
    scenes,
  });

  return {
    externalJobId,
    rawResult: {
      externalJobId,
      submittedScenes: scenes.map((scene) => ({ sceneIndex: scene.sceneIndex, taskId: scene.taskId })),
      responses: rawResults,
    },
  };
}

export async function pollSeedanceDirectNative(
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
  const apiKey = getSeedanceApiKey(env);
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const queryUrl = `${baseUrl(env)}/api/v3/tasks/query`;
  const state = await readJobState(input.outputDir, input.externalJobId);

  const outputs: VideoExecutionPollResult['outputs'] = [];
  const issues: string[] = [];
  const rawResults: unknown[] = [];
  let anyPending = false;
  let anyFailed = false;

  for (const scene of state.scenes) {
    const result = await postJson(fetchImpl, queryUrl, {
      headers: headers(apiKey),
      body: { task_id: scene.taskId },
    });
    rawResults.push(result);
    const status = extractStatus(result);
    if (status === 'completed') {
      const videoUrl = extractVideoUrl(result);
      if (!existsSync(scene.outputPath)) {
        await downloadToFile(fetchImpl, videoUrl, scene.outputPath);
      }
      scene.status = 'completed';
      outputs.push({
        id: `generated-scene-${scene.sceneIndex}`,
        kind: 'video',
        path: scene.outputPath,
        sceneIndex: scene.sceneIndex,
        backend: 'seedance-direct',
      });
    } else if (status === 'failed') {
      scene.status = 'failed';
      scene.error = `Seedance task ${scene.taskId} failed.`;
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

export async function cancelSeedanceDirectNative(
  input: {
    outputDir: string;
    externalJobId: string;
    workspaceRoot: string;
  },
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<VideoExecutionCancelResult> {
  const env = await loadWorkspaceEnv(input.workspaceRoot, options.env ?? process.env);
  const apiKey = getSeedanceApiKey(env);
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const cancelUrl = `${baseUrl(env)}/api/v3/tasks/cancel`;
  const state = await readJobState(input.outputDir, input.externalJobId);

  const rawResults: unknown[] = [];
  for (const scene of state.scenes) {
    const result = await postJson(fetchImpl, cancelUrl, {
      headers: headers(apiKey),
      body: { task_id: scene.taskId },
    });
    rawResults.push(result);
    scene.status = 'failed';
    scene.error = 'Execution cancelled by operator.';
  }

  await writeJobState(state);

  return {
    status: 'cancelled',
    externalJobId: input.externalJobId,
    issues: [],
    rawResult: rawResults,
  };
}
