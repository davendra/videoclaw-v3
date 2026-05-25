import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor } from './artifact-store.js';
import { listCharacterProfiles } from './characters.js';
import { findHistoricalSeedanceCostTelemetry } from './generation-telemetry.js';
import { resolveProjectWorkspace } from './workspace.js';

export interface VideoCostEstimate {
  sceneCount: number;
  clipDurationSeconds: number;
  newCharacterCount: number;
  narrationEnabled: boolean;
  seedancePerSceneUsd: number;
  seedanceTotalUsd: number;
  geminiTotalUsd: number;
  goBananasTotalUsd: number;
  elevenLabsTotalUsd: number;
  totalUsd: number;
  wallTimeMinutes: number;
  estimateSource: 'static-default' | 'historical-telemetry';
  telemetry?: {
    sampleCount: number;
    matchedRouteId: string;
    averageSeedancePerSceneUsd: number;
    lastRecordedAt: string;
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function estimateSeedancePerSceneUsd(clipDurationSeconds: number): number {
  if (clipDurationSeconds <= 10) return 0.27;
  if (clipDurationSeconds <= 15) return 0.40;
  return 0.53;
}

export function buildVideoCostEstimate(input: {
  sceneCount: number;
  clipDurationSeconds: number;
  newCharacterCount?: number;
  narrationEnabled?: boolean;
  seedancePerSceneUsd?: number;
  telemetry?: VideoCostEstimate['telemetry'];
}): VideoCostEstimate {
  const sceneCount = input.sceneCount;
  const clipDurationSeconds = input.clipDurationSeconds;
  const newCharacterCount = input.newCharacterCount ?? 0;
  const narrationEnabled = input.narrationEnabled ?? true;
  const seedancePerSceneUsd = input.seedancePerSceneUsd ?? estimateSeedancePerSceneUsd(clipDurationSeconds);
  const seedanceTotalUsd = roundUsd(sceneCount * seedancePerSceneUsd);
  const geminiTotalUsd = 0.03;
  const goBananasTotalUsd = roundUsd(newCharacterCount * 0.05);
  const elevenLabsTotalUsd = narrationEnabled ? roundUsd(sceneCount * 0.01) : 0;
  const totalUsd = roundUsd(seedanceTotalUsd + geminiTotalUsd + goBananasTotalUsd + elevenLabsTotalUsd);
  const wallTimeMinutes = sceneCount * 4 + 5;

  return {
    sceneCount,
    clipDurationSeconds,
    newCharacterCount,
    narrationEnabled,
    seedancePerSceneUsd,
    seedanceTotalUsd,
    geminiTotalUsd,
    goBananasTotalUsd,
    elevenLabsTotalUsd,
    totalUsd,
    wallTimeMinutes,
    estimateSource: input.telemetry ? 'historical-telemetry' : 'static-default',
    ...(input.telemetry ? { telemetry: input.telemetry } : {}),
  };
}

export async function buildProjectCostEstimate(input: {
  projectSlug: string;
  root?: string;
  sceneCount?: number;
  clipDurationSeconds?: number;
  newCharacterCount?: number;
  narrationEnabled?: boolean;
}): Promise<VideoCostEstimate> {
  const root = input.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(input.projectSlug, root);
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  const briefPath = artifactPathFor(workspace, 'brief');

  let inferredSceneCount = input.sceneCount;
  let inferredClipDurationSeconds = input.clipDurationSeconds;

  if (existsSync(storyboardPath)) {
    const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as {
      scenes?: Array<{ durationSeconds?: number }>;
    };
    const scenes = storyboard.scenes ?? [];
    if (inferredSceneCount === undefined) {
      inferredSceneCount = scenes.length;
    }
    if (inferredClipDurationSeconds === undefined && scenes.length > 0) {
      const durations = scenes
        .map((scene) => scene.durationSeconds)
        .filter((value): value is number => Number.isFinite(value));
      if (durations.length > 0) {
        inferredClipDurationSeconds = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
      }
    }
  }

  let narrationEnabled = input.narrationEnabled;
  if (narrationEnabled === undefined && existsSync(briefPath)) {
    const brief = JSON.parse(await readFile(briefPath, 'utf-8')) as {
      metadata?: { executionProfile?: { generateAudio?: boolean } };
    };
    const generateAudio = brief.metadata?.executionProfile?.generateAudio;
    if (typeof generateAudio === 'boolean') {
      narrationEnabled = generateAudio;
    }
  }

  let newCharacterCount = input.newCharacterCount;
  if (newCharacterCount === undefined) {
    const characters = await listCharacterProfiles(workspace);
    newCharacterCount = characters.filter((character) => character.goBananasId === undefined).length;
  }

  if (inferredSceneCount === undefined || !Number.isInteger(inferredSceneCount) || inferredSceneCount <= 0) {
    throw new Error('Could not determine scene count. Provide --scenes or create a storyboard first.');
  }
  const resolvedSceneCount: number = inferredSceneCount;
  const resolvedClipDurationSeconds: number = inferredClipDurationSeconds ?? 15;
  const resolvedNewCharacterCount: number = newCharacterCount ?? 0;
  const historicalTelemetry = await findHistoricalSeedanceCostTelemetry(root);
  const telemetry = historicalTelemetry
    ? {
        sampleCount: historicalTelemetry.sampleCount,
        matchedRouteId: historicalTelemetry.matchedRouteId,
        averageSeedancePerSceneUsd: historicalTelemetry.averageSeedancePerSceneUsd,
        lastRecordedAt: historicalTelemetry.lastRecordedAt,
      }
    : undefined;

  return buildVideoCostEstimate({
    sceneCount: resolvedSceneCount,
    clipDurationSeconds: resolvedClipDurationSeconds,
    newCharacterCount: resolvedNewCharacterCount,
    narrationEnabled,
    ...(telemetry ? { seedancePerSceneUsd: telemetry.averageSeedancePerSceneUsd, telemetry } : {}),
  });
}
