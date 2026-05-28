import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor } from './artifact-store.js';
import type { VideoProjectWorkspace } from './workspace.js';

export interface MultiShotPromptArtifactSummary {
  path: string;
  preset?: string;
  valid?: boolean;
  shotCount: number;
  issueCount: number;
  generatedAt?: string;
  source?: {
    kind?: string;
    projectSlug?: string;
    sceneIndex?: number;
    storyboardDescription?: string;
    characters?: string[];
    presetSource?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

export async function readMultiShotPromptArtifactSummary(
  workspace: VideoProjectWorkspace,
): Promise<MultiShotPromptArtifactSummary | undefined> {
  const path = artifactPathFor(workspace, 'multi-shot-prompt');
  if (!existsSync(path)) return undefined;
  const artifact = JSON.parse(await readFile(path, 'utf-8')) as unknown;
  if (!isRecord(artifact)) {
    return {
      path,
      shotCount: 0,
      issueCount: 0,
    };
  }
  const source = isRecord(artifact.source) ? artifact.source : undefined;
  return {
    path,
    ...(typeof artifact.preset === 'string' ? { preset: artifact.preset } : {}),
    ...(typeof artifact.valid === 'boolean' ? { valid: artifact.valid } : {}),
    shotCount: Array.isArray(artifact.shots) ? artifact.shots.length : 0,
    issueCount: Array.isArray(artifact.issues) ? artifact.issues.length : 0,
    ...(typeof artifact.generatedAt === 'string' ? { generatedAt: artifact.generatedAt } : {}),
    ...(source ? {
      source: {
        ...(typeof source.kind === 'string' ? { kind: source.kind } : {}),
        ...(typeof source.projectSlug === 'string' ? { projectSlug: source.projectSlug } : {}),
        ...(typeof source.sceneIndex === 'number' ? { sceneIndex: source.sceneIndex } : {}),
        ...(typeof source.storyboardDescription === 'string' ? { storyboardDescription: source.storyboardDescription } : {}),
        ...(stringArray(source.characters) ? { characters: stringArray(source.characters) } : {}),
        ...(typeof source.presetSource === 'string' ? { presetSource: source.presetSource } : {}),
      },
    } : {}),
  };
}
