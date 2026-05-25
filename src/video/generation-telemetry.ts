import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { appendProjectEvent, readProjectEvents } from './events.js';
import { resolveProjectWorkspace, type VideoProjectWorkspace } from './workspace.js';
import type {
  VideoExecutionPayload,
  VideoExecutionPollResult,
  VideoExecutionReport,
} from './types.js';
import type { ProviderRouteId, VideoOperationKind } from './provider-platform/types.js';

export interface GenerationTelemetryEntry {
  schemaVersion: 1;
  projectSlug: string;
  routeId: ProviderRouteId | null;
  operationKind: VideoOperationKind;
  status: 'dry-run' | 'submitted' | 'pending' | 'completed' | 'failed' | 'blocked';
  dryRun: boolean;
  recordedAt: string;
  taskCount: number;
  sceneIndices: number[];
  config: {
    aspectRatio?: '16:9' | '9:16' | '1:1';
    resolution?: '720p' | '1080p';
    generateAudio?: boolean;
    outputCount?: number;
    averageDurationSeconds?: number;
    referenceImageCount: number;
    referenceVideoCount: number;
    referenceAudioCount: number;
    promptWordCount: number;
  };
  externalJobId?: string | null;
  outputsIngested?: number;
  cost?: {
    creditsCharged?: number;
    usd?: number;
    source: 'provider-response' | 'estimate';
  };
  generationTimeSec?: number;
  issues?: string[];
}

export interface HistoricalSeedanceCostTelemetry {
  sampleCount: number;
  averageSeedancePerSceneUsd: number;
  lastRecordedAt: string;
  matchedRouteId: ProviderRouteId;
}

function promptWordCount(text: string): number {
  return text.match(/[A-Za-z0-9']+/g)?.length ?? 0;
}

function classifyReference(path: string): 'image' | 'video' | 'audio' | 'other' {
  const ext = extname(path).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac'].includes(ext)) return 'audio';
  return 'other';
}

function summarizePayload(payload?: VideoExecutionPayload): GenerationTelemetryEntry['config'] {
  let referenceImageCount = 0;
  let referenceVideoCount = 0;
  let referenceAudioCount = 0;
  let words = 0;
  const durations: number[] = [];

  for (const task of payload?.tasks ?? []) {
    words += promptWordCount(task.prompt);
    if (Number.isFinite(task.durationSeconds)) durations.push(Number(task.durationSeconds));
    for (const referencePath of task.referencePaths) {
      const kind = classifyReference(referencePath);
      if (kind === 'image') referenceImageCount += 1;
      if (kind === 'video') referenceVideoCount += 1;
      if (kind === 'audio') referenceAudioCount += 1;
    }
  }

  return {
    ...(payload?.executionProfile ? {
      aspectRatio: payload.executionProfile.aspectRatio,
      resolution: payload.executionProfile.resolution,
      generateAudio: payload.executionProfile.generateAudio,
      outputCount: payload.executionProfile.outputCount,
    } : {}),
    ...(durations.length > 0
      ? { averageDurationSeconds: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) }
      : {}),
    referenceImageCount,
    referenceVideoCount,
    referenceAudioCount,
    promptWordCount: words,
  };
}

function reportStatusToTelemetry(status: VideoExecutionReport['status']): GenerationTelemetryEntry['status'] {
  if (status === 'dry-run-complete') return 'dry-run';
  if (status === 'live-submitted') return 'submitted';
  return 'blocked';
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function walkNumbers(value: unknown, visit: (key: string, value: number) => void, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) walkNumbers(item, visit, seen);
    return;
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const numeric = numberFrom(raw);
    if (numeric !== undefined) {
      visit(key, numeric);
      continue;
    }
    walkNumbers(raw, visit, seen);
  }
}

export function extractProviderMetrics(rawResult: unknown): {
  creditsCharged?: number;
  usd?: number;
  generationTimeSec?: number;
} {
  let creditsCharged: number | undefined;
  let usd: number | undefined;
  let generationTimeSec: number | undefined;

  walkNumbers(rawResult, (key, value) => {
    const normalized = key.toLowerCase();
    if (creditsCharged === undefined && ['creditscharged', 'creditcost', 'credits'].includes(normalized)) {
      creditsCharged = value;
    }
    if (usd === undefined && (normalized.includes('usd') || normalized === 'cost')) {
      usd = value;
    }
    if (
      generationTimeSec === undefined
      && (normalized.includes('generationtime') || normalized.includes('elapsedseconds') || normalized.includes('processingseconds'))
    ) {
      generationTimeSec = value;
    }
  });

  return {
    ...(creditsCharged !== undefined ? { creditsCharged } : {}),
    ...(usd !== undefined ? { usd } : {}),
    ...(generationTimeSec !== undefined ? { generationTimeSec } : {}),
  };
}

export function buildGenerationTelemetryFromReport(input: {
  report: VideoExecutionReport;
  payload?: VideoExecutionPayload;
  recordedAt?: string;
}): GenerationTelemetryEntry {
  const metrics = extractProviderMetrics(input.report.submission?.rawResult);
  const tasks = input.payload?.tasks ?? [];
  return {
    schemaVersion: 1,
    projectSlug: input.report.projectSlug,
    routeId: input.report.routeId,
    operationKind: input.report.operationKind,
    status: reportStatusToTelemetry(input.report.status),
    dryRun: input.report.dryRun,
    recordedAt: input.recordedAt ?? input.report.generatedAt,
    taskCount: input.report.taskCount ?? tasks.length,
    sceneIndices: tasks.map((task) => task.sceneIndex),
    config: summarizePayload(input.payload),
    ...(input.report.submission?.externalJobId !== undefined ? { externalJobId: input.report.submission.externalJobId } : {}),
    ...(metrics.creditsCharged !== undefined || metrics.usd !== undefined
      ? {
          cost: {
            ...(metrics.creditsCharged !== undefined ? { creditsCharged: metrics.creditsCharged } : {}),
            ...(metrics.usd !== undefined ? { usd: metrics.usd } : {}),
            source: 'provider-response' as const,
          },
        }
      : {}),
    ...(metrics.generationTimeSec !== undefined ? { generationTimeSec: metrics.generationTimeSec } : {}),
    ...(input.report.blockers.length > 0 ? { issues: input.report.blockers } : {}),
  };
}

export function buildGenerationTelemetryFromPoll(input: {
  report: VideoExecutionReport;
  poll: VideoExecutionPollResult;
  recordedAt: string;
}): GenerationTelemetryEntry {
  const metrics = extractProviderMetrics(input.poll.rawResult);
  return {
    schemaVersion: 1,
    projectSlug: input.report.projectSlug,
    routeId: input.report.routeId,
    operationKind: input.report.operationKind,
    status: input.poll.status,
    dryRun: input.report.dryRun,
    recordedAt: input.recordedAt,
    taskCount: input.report.taskCount ?? 0,
    sceneIndices: (input.report.candidatesByScene ?? []).map((entry) => entry.sceneIndex),
    config: summarizePayload(),
    externalJobId: input.poll.externalJobId,
    outputsIngested: input.poll.outputs.length,
    ...(metrics.creditsCharged !== undefined || metrics.usd !== undefined
      ? {
          cost: {
            ...(metrics.creditsCharged !== undefined ? { creditsCharged: metrics.creditsCharged } : {}),
            ...(metrics.usd !== undefined ? { usd: metrics.usd } : {}),
            source: 'provider-response' as const,
          },
        }
      : {}),
    ...(metrics.generationTimeSec !== undefined ? { generationTimeSec: metrics.generationTimeSec } : {}),
    ...(input.poll.issues.length > 0 ? { issues: input.poll.issues } : {}),
  };
}

export async function appendGenerationTelemetry(
  workspace: VideoProjectWorkspace,
  entry: GenerationTelemetryEntry,
): Promise<void> {
  await appendProjectEvent(workspace, {
    type: 'generation.telemetry.recorded',
    recordedAt: entry.recordedAt,
    payload: entry as unknown as Record<string, unknown>,
  });
}

export async function readProjectGenerationTelemetry(
  workspace: VideoProjectWorkspace,
): Promise<GenerationTelemetryEntry[]> {
  const events = await readProjectEvents(workspace);
  return events
    .filter((event) => event.type === 'generation.telemetry.recorded')
    .map((event) => event.payload)
    .filter((payload): payload is Record<string, unknown> => Boolean(payload))
    .map((payload) => payload as unknown as GenerationTelemetryEntry);
}

export async function readPortfolioGenerationTelemetry(root = process.cwd()): Promise<GenerationTelemetryEntry[]> {
  const projectsDir = join(resolve(root), 'projects');
  if (!existsSync(projectsDir)) return [];
  const entries = await readdir(projectsDir, { withFileTypes: true });
  const telemetry: GenerationTelemetryEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspace = resolveProjectWorkspace(entry.name, root);
    telemetry.push(...await readProjectGenerationTelemetry(workspace));
  }
  return telemetry.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
}

export async function findHistoricalSeedanceCostTelemetry(
  root = process.cwd(),
): Promise<HistoricalSeedanceCostTelemetry | null> {
  const samples = (await readPortfolioGenerationTelemetry(root))
    .filter((entry) => entry.routeId === 'seedance-direct')
    .filter((entry) => entry.status === 'completed')
    .filter((entry) => (entry.cost?.usd ?? 0) > 0 && entry.taskCount > 0)
    .map((entry) => ({
      recordedAt: entry.recordedAt,
      perSceneUsd: Number(entry.cost?.usd) / entry.taskCount,
    }))
    .filter((entry) => Number.isFinite(entry.perSceneUsd) && entry.perSceneUsd > 0)
    .slice(-20);

  if (samples.length === 0) return null;
  const average = samples.reduce((sum, sample) => sum + sample.perSceneUsd, 0) / samples.length;
  return {
    sampleCount: samples.length,
    averageSeedancePerSceneUsd: Math.round(average * 100) / 100,
    lastRecordedAt: samples[samples.length - 1].recordedAt,
    matchedRouteId: 'seedance-direct',
  };
}
