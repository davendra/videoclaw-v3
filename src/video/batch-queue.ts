/**
 * Overnight batch video queue.
 *
 * A "batch" is a JSON manifest the operator authors listing many independent
 * video jobs. It compiles into ONE {@link VideoExecutionPayload} with N tasks,
 * which is exactly the shape the native route transports (native-runway,
 * native-dreamina, native-seedance) already accept and loop over. This module
 * is pure/deterministic apart from the small fs helpers at the bottom:
 *
 *  - readBatchManifest()   — graceful parse, throws on malformed (no silent fallback)
 *  - buildBatchPayload()   — pure: manifest -> VideoExecutionPayload
 *  - queue-state helpers    — persist <outDir>/batch-queue.json, idempotent rollup
 *  - clip mapping helpers   — scene-<i>.mp4 -> clips/<jobId>.mp4
 *
 * The default route is the FREE runway-useapi explore mode, so a large queue
 * can run unattended overnight at zero credit cost (low-res/slow drafts).
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VideoExecutionPayload } from './types.js';

/** Routes the batch queue can target. A subset of ProviderRouteId — the three
 * routes with in-process native submit/poll transports that loop payload.tasks. */
export type BatchRouteId = 'runway-useapi' | 'dreamina-useapi' | 'seedance-direct';

const SUPPORTED_ROUTES: readonly BatchRouteId[] = ['runway-useapi', 'dreamina-useapi', 'seedance-direct'];

const DEFAULT_ROUTE: BatchRouteId = 'runway-useapi';
const DEFAULT_SECONDS = 8;
const DEFAULT_ASPECT_RATIO: VideoExecutionPayload['executionProfile']['aspectRatio'] = '16:9';
const DEFAULT_RESOLUTION: VideoExecutionPayload['executionProfile']['resolution'] = '720p';

export interface BatchQueueJob {
  /** Stable, operator-chosen id. Used as the downloaded clip filename. */
  id: string;
  prompt: string;
  /** Optional first-frame keyframe — a local path or a public http(s) URL. */
  keyframe?: string;
  /** Per-job duration override; falls back to defaults.seconds, then 8. */
  seconds?: number;
  /** Per-job aspect-ratio override (recorded; provider uses the batch default). */
  aspectRatio?: string;
}

export interface BatchQueueManifest {
  schemaVersion: 1;
  route?: BatchRouteId;
  defaults?: {
    seconds?: number;
    aspectRatio?: string;
    resolution?: string;
  };
  jobs: BatchQueueJob[];
}

export type BatchJobStatus = 'pending' | 'done' | 'failed';

export interface BatchQueueJobState {
  id: string;
  sceneIndex: number;
  taskId: string;
  status: BatchJobStatus;
  /** Set once the clip has been copied to clips/<id>.mp4. */
  clipPath?: string;
  error?: string;
}

export interface BatchQueueState {
  schemaVersion: 1;
  externalJobId: string;
  route: BatchRouteId;
  outputDir: string;
  workspaceRoot: string;
  submittedAt: string;
  jobs: BatchQueueJobState[];
}

export interface BatchQueueRollup {
  total: number;
  done: number;
  pending: number;
  failed: number;
  /** True when no job is still pending (every job is done or failed). */
  terminal: boolean;
}

function isSupportedRoute(value: unknown): value is BatchRouteId {
  return typeof value === 'string' && (SUPPORTED_ROUTES as readonly string[]).includes(value);
}

/**
 * Reads + validates a batch manifest. Throws loudly on malformed JSON or
 * missing required fields — no silent fallback. The only default applied is
 * `route` -> "runway-useapi" when omitted (the free explore default).
 */
export async function readBatchManifest(path: string): Promise<BatchQueueManifest & { route: BatchRouteId }> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`batch manifest not readable at ${path}: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`batch manifest is not valid JSON (${path}): ${message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`batch manifest must be a JSON object: ${path}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== 1) {
    throw new Error(`batch manifest schemaVersion must be 1, got: ${JSON.stringify(obj.schemaVersion)}`);
  }
  const route = obj.route === undefined ? DEFAULT_ROUTE : obj.route;
  if (!isSupportedRoute(route)) {
    throw new Error(
      `batch manifest route must be one of ${SUPPORTED_ROUTES.join(', ')}, got: ${JSON.stringify(obj.route)}`,
    );
  }
  if (!Array.isArray(obj.jobs) || obj.jobs.length === 0) {
    throw new Error(`batch manifest requires at least one job in "jobs": ${path}`);
  }
  const seenIds = new Set<string>();
  const jobs: BatchQueueJob[] = obj.jobs.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`batch manifest job ${index} must be an object`);
    }
    const job = entry as Record<string, unknown>;
    if (typeof job.id !== 'string' || !job.id.trim()) {
      throw new Error(`batch manifest job ${index} requires a non-empty string "id"`);
    }
    if (typeof job.prompt !== 'string' || !job.prompt.trim()) {
      throw new Error(`batch manifest job "${job.id}" requires a non-empty string "prompt"`);
    }
    if (seenIds.has(job.id)) {
      throw new Error(`batch manifest has a duplicate job id: "${job.id}"`);
    }
    seenIds.add(job.id);
    if (job.keyframe !== undefined && (typeof job.keyframe !== 'string' || !job.keyframe.trim())) {
      throw new Error(`batch manifest job "${job.id}" keyframe must be a non-empty string when present`);
    }
    if (job.seconds !== undefined && (typeof job.seconds !== 'number' || !Number.isFinite(job.seconds))) {
      throw new Error(`batch manifest job "${job.id}" seconds must be a number when present`);
    }
    if (job.aspectRatio !== undefined && typeof job.aspectRatio !== 'string') {
      throw new Error(`batch manifest job "${job.id}" aspectRatio must be a string when present`);
    }
    return {
      id: job.id,
      prompt: job.prompt,
      ...(typeof job.keyframe === 'string' ? { keyframe: job.keyframe } : {}),
      ...(typeof job.seconds === 'number' ? { seconds: job.seconds } : {}),
      ...(typeof job.aspectRatio === 'string' ? { aspectRatio: job.aspectRatio } : {}),
    };
  });

  const defaults =
    obj.defaults && typeof obj.defaults === 'object' && !Array.isArray(obj.defaults)
      ? (obj.defaults as BatchQueueManifest['defaults'])
      : undefined;

  return { schemaVersion: 1, route, ...(defaults ? { defaults } : {}), jobs };
}

function coerceAspectRatio(value: string | undefined): VideoExecutionPayload['executionProfile']['aspectRatio'] {
  if (value === '9:16' || value === '1:1' || value === '16:9') return value;
  return DEFAULT_ASPECT_RATIO;
}

function coerceResolution(value: string | undefined): VideoExecutionPayload['executionProfile']['resolution'] {
  if (value === '1080p' || value === '720p') return value;
  return DEFAULT_RESOLUTION;
}

/**
 * Pure: compiles a manifest into a single VideoExecutionPayload whose `tasks`
 * map jobs 1:1. Job index becomes sceneIndex; job.keyframe becomes the task's
 * sole referencePath; duration resolves job.seconds -> defaults.seconds -> 8.
 *
 * The resulting payload is byte-compatible with what the native route
 * transports already consume, so submit/poll need no batch-specific code path.
 */
export function buildBatchPayload(
  manifest: BatchQueueManifest,
  opts: { workspaceRoot: string; outputDir: string },
): VideoExecutionPayload {
  const route = isSupportedRoute(manifest.route) ? manifest.route : DEFAULT_ROUTE;
  const defaultSeconds =
    typeof manifest.defaults?.seconds === 'number' && Number.isFinite(manifest.defaults.seconds)
      ? manifest.defaults.seconds
      : DEFAULT_SECONDS;
  const aspectRatio = coerceAspectRatio(manifest.defaults?.aspectRatio);
  const resolution = coerceResolution(manifest.defaults?.resolution);

  const tasks = manifest.jobs.map((job, index) => {
    const referencePaths = job.keyframe ? [job.keyframe] : [];
    const durationSeconds =
      typeof job.seconds === 'number' && Number.isFinite(job.seconds) ? job.seconds : defaultSeconds;
    return {
      sceneIndex: index,
      prompt: job.prompt,
      inputKind: (referencePaths.length > 0 ? 'image' : 'text') as 'image' | 'text',
      referencePaths,
      sourceAssetIds: [],
      backendHints: ['batch-queue'],
      characters: [],
      durationSeconds,
    };
  });

  return {
    workspaceRoot: opts.workspaceRoot,
    projectSlug: 'batch-queue',
    productionMode: 'storyboard',
    routeId: route,
    operationKind: 'text-to-video',
    executionProfile: {
      aspectRatio,
      quality: 'fast',
      resolution,
      generateAudio: false,
      outputCount: 1,
    },
    generatedAt: new Date().toISOString(),
    outputDir: opts.outputDir,
    tasks,
    promptGuidance: [],
  };
}

/** The path the native transport writes a completed scene to. */
export function sceneOutputPathFor(outputDir: string, sceneIndex: number): string {
  return join(outputDir, `scene-${sceneIndex}.mp4`);
}

/** The stable per-job clip path the batch monitor copies completed scenes to. */
export function clipPathForJob(outputDir: string, jobId: string): string {
  return join(outputDir, 'clips', `${jobId}.mp4`);
}

export function batchQueueStatePath(outputDir: string): string {
  return join(outputDir, 'batch-queue.json');
}

export function batchStatusPath(outputDir: string): string {
  return join(outputDir, 'batch-status.json');
}

export async function writeBatchQueueState(state: BatchQueueState): Promise<void> {
  await mkdir(state.outputDir, { recursive: true });
  await writeFile(batchQueueStatePath(state.outputDir), `${JSON.stringify(state, null, 2)}\n`);
}

export async function readBatchQueueState(outputDir: string): Promise<BatchQueueState> {
  const path = batchQueueStatePath(outputDir);
  if (!existsSync(path)) {
    throw new Error(`batch-queue.json not found in ${outputDir}; run "vclaw video batch-submit" first.`);
  }
  return JSON.parse(await readFile(path, 'utf-8')) as BatchQueueState;
}

/** Counts done/pending/failed and reports whether the queue is fully terminal. */
export function rollupBatchQueueState(state: BatchQueueState): BatchQueueRollup {
  let done = 0;
  let pending = 0;
  let failed = 0;
  for (const job of state.jobs) {
    if (job.status === 'done') done += 1;
    else if (job.status === 'failed') failed += 1;
    else pending += 1;
  }
  return { total: state.jobs.length, done, pending, failed, terminal: pending === 0 };
}
