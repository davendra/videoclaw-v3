import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import { appendProjectEvent } from './events.js';
import { resolveProjectWorkspace } from './workspace.js';
import type { ProviderRouteId, VideoOperationKind } from './provider-platform/types.js';
import type { VideoExecutionPlan, VideoProductionMode } from './types.js';
import type { BriefArtifact } from './artifacts.js';

type ExecutionProfile = VideoExecutionPlan['executionProfile'];

function normalizeAspectRatio(value: unknown): ExecutionProfile['aspectRatio'] | null {
  return value === '16:9' || value === '9:16' || value === '1:1' ? value : null;
}

function normalizeQuality(value: unknown): ExecutionProfile['quality'] | null {
  return value === 'fast' || value === 'quality' ? value : null;
}

function normalizeResolution(value: unknown): ExecutionProfile['resolution'] | null {
  return value === '720p' || value === '1080p' ? value : null;
}

function normalizeOutputCount(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4 ? Number(value) : null;
}

function normalizeGenerateAudio(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

async function readExecutionProfileOverrides(
  projectSlug: string,
  root: string,
): Promise<Partial<ExecutionProfile>> {
  const workspace = resolveProjectWorkspace(projectSlug, root);
  const briefPath = artifactPathFor(workspace, 'brief');
  if (!existsSync(briefPath)) return {};
  const brief = JSON.parse(await readFile(briefPath, 'utf-8')) as {
    metadata?: {
      platform?: string;
      executionProfile?: Record<string, unknown>;
    };
  };

  const executionProfile = brief.metadata?.executionProfile ?? {};
  const platform = String(brief.metadata?.platform ?? '').toLowerCase();
  return {
    ...(normalizeAspectRatio(executionProfile.aspectRatio) ? { aspectRatio: normalizeAspectRatio(executionProfile.aspectRatio)! } : {}),
    ...(normalizeQuality(executionProfile.quality) ? { quality: normalizeQuality(executionProfile.quality)! } : {}),
    ...(normalizeResolution(executionProfile.resolution) ? { resolution: normalizeResolution(executionProfile.resolution)! } : {}),
    ...(typeof executionProfile.generateAudio === 'boolean' ? { generateAudio: executionProfile.generateAudio } : {}),
    ...(normalizeOutputCount(executionProfile.outputCount) ? { outputCount: normalizeOutputCount(executionProfile.outputCount)! } : {}),
    ...(!normalizeAspectRatio(executionProfile.aspectRatio) && ['tiktok', 'reels', 'shorts'].includes(platform)
      ? { aspectRatio: '9:16' as const }
      : {}),
  };
}

export async function setExecutionProfileOverrides(
  projectSlug: string,
  input: Partial<ExecutionProfile>,
  root = process.cwd(),
): Promise<{
  artifactPath: string;
  brief: BriefArtifact;
}> {
  const workspace = resolveProjectWorkspace(projectSlug, root);
  const briefPath = artifactPathFor(workspace, 'brief');
  if (!existsSync(briefPath)) {
    throw new Error(`Execution profile cannot be updated for "${projectSlug}" because the brief artifact is missing.`);
  }

  const brief = JSON.parse(await readFile(briefPath, 'utf-8')) as BriefArtifact;
  const existingProfile = ((brief.metadata ?? {}).executionProfile ?? {}) as Record<string, unknown>;
  const nextProfile = {
    ...existingProfile,
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(typeof input.outputCount === 'number' ? { outputCount: input.outputCount } : {}),
  };

  const nextBrief: BriefArtifact = {
    ...brief,
    metadata: {
      ...(brief.metadata ?? {}),
      executionProfile: nextProfile,
    },
  };
  const artifactPath = await writeArtifact(workspace, 'brief', nextBrief);
  await appendProjectEvent(workspace, {
    type: 'artifact.brief.execution-profile.updated',
    payload: {
      artifactPath,
      executionProfile: nextProfile,
    },
  });
  return { artifactPath, brief: nextBrief };
}

export function parseExecutionProfileInput(input: {
  aspectRatio?: unknown;
  quality?: unknown;
  resolution?: unknown;
  generateAudio?: unknown;
  outputCount?: unknown;
}): Partial<ExecutionProfile> {
  const profile: Partial<ExecutionProfile> = {};
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const quality = normalizeQuality(input.quality);
  const resolution = normalizeResolution(input.resolution);
  const generateAudio = normalizeGenerateAudio(input.generateAudio);
  const outputCount = normalizeOutputCount(input.outputCount);
  if (aspectRatio) profile.aspectRatio = aspectRatio;
  if (quality) profile.quality = quality;
  if (resolution) profile.resolution = resolution;
  if (generateAudio !== null) profile.generateAudio = generateAudio;
  if (outputCount !== null) profile.outputCount = outputCount;
  return profile;
}

export async function buildExecutionProfile(input: {
  projectSlug: string;
  root?: string;
  productionMode: VideoProductionMode;
  routeId: ProviderRouteId | null;
  operationKind: VideoOperationKind;
}): Promise<ExecutionProfile> {
  const root = input.root ?? process.cwd();
  const overrides = await readExecutionProfileOverrides(input.projectSlug, root);
  const defaults: ExecutionProfile = {
    aspectRatio: '16:9',
    quality: input.productionMode === 'director' ? 'quality' : 'fast',
    resolution: '720p',
    generateAudio: input.routeId === 'seedance-direct',
    outputCount: 1,
  };
  return {
    ...defaults,
    ...overrides,
  };
}
