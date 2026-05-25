import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { VideoPipelineManifest, VideoProductionMode } from './types.js';
import { writeTextFileAtomic } from './atomic-write.js';

export interface VideoProjectWorkspace {
  root: string;
  slug: string;
  projectDir: string;
  artifactsDir: string;
  artifactsHistoryDir: string;
  checkpointsDir: string;
  charactersDir: string;
  charactersPath: string;
  eventsDir: string;
  eventsPath: string;
  stateDir: string;
  manifestPath: string;
}

export interface VideoProjectManifest {
  slug: string;
  productionMode: VideoProductionMode;
  createdAt: string;
  updatedAt: string;
  pipeline: VideoPipelineManifest;
  owner?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical' | null;
  dueDate?: string | null;
  tags?: string[];
  blockedBy?: string[];
  blockedReason?: string | null;
  currentStage?: string | null;
  lastCompletedStage?: string | null;
  lastCheckpointStatus?: string | null;
}

export function resolveProjectWorkspace(slug: string, root = process.cwd()): VideoProjectWorkspace {
  const normalizedRoot = resolve(root);
  const projectDir = join(normalizedRoot, 'projects', slug);
  return {
    root: normalizedRoot,
    slug,
    projectDir,
    artifactsDir: join(projectDir, 'artifacts'),
    artifactsHistoryDir: join(projectDir, 'artifacts', 'history'),
    checkpointsDir: join(projectDir, 'checkpoints'),
    charactersDir: join(projectDir, 'characters'),
    charactersPath: join(projectDir, 'characters', 'characters.json'),
    eventsDir: join(projectDir, 'events'),
    eventsPath: join(projectDir, 'events', 'events.jsonl'),
    stateDir: join(projectDir, 'state'),
    manifestPath: join(projectDir, 'project.json'),
  };
}

export async function ensureProjectWorkspace(
  slug: string,
  root = process.cwd(),
): Promise<VideoProjectWorkspace> {
  const workspace = resolveProjectWorkspace(slug, root);
  await mkdir(workspace.artifactsDir, { recursive: true });
  await mkdir(workspace.artifactsHistoryDir, { recursive: true });
  await mkdir(workspace.checkpointsDir, { recursive: true });
  await mkdir(workspace.charactersDir, { recursive: true });
  await mkdir(workspace.eventsDir, { recursive: true });
  await mkdir(workspace.stateDir, { recursive: true });
  return workspace;
}

export async function writeProjectManifest(
  workspace: VideoProjectWorkspace,
  manifest: VideoProjectManifest,
): Promise<void> {
  await writeTextFileAtomic(workspace.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function readProjectManifest(
  workspace: VideoProjectWorkspace,
): Promise<VideoProjectManifest | null> {
  if (!existsSync(workspace.manifestPath)) return null;
  const raw = await readFile(workspace.manifestPath, 'utf-8');
  return JSON.parse(raw) as VideoProjectManifest;
}

export async function updateProjectManifestState(
  workspace: VideoProjectWorkspace,
  input: {
    updatedAt?: string;
    currentStage?: string | null;
    lastCompletedStage?: string | null;
    lastCheckpointStatus?: string | null;
  },
): Promise<VideoProjectManifest> {
  const manifest = await readProjectManifest(workspace);
  if (!manifest) {
    throw new Error(`Cannot update project manifest for ${workspace.slug}: manifest missing`);
  }
  const updatedManifest: VideoProjectManifest = {
    ...manifest,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    ...(input.currentStage !== undefined ? { currentStage: input.currentStage } : {}),
    ...(input.lastCompletedStage !== undefined ? { lastCompletedStage: input.lastCompletedStage } : {}),
    ...(input.lastCheckpointStatus !== undefined ? { lastCheckpointStatus: input.lastCheckpointStatus } : {}),
  };
  await writeProjectManifest(workspace, updatedManifest);
  return updatedManifest;
}

export async function updateProjectManifestMetadata(
  workspace: VideoProjectWorkspace,
  input: {
    updatedAt?: string;
    owner?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'critical' | null;
    dueDate?: string | null;
    tags?: string[];
    blockedBy?: string[];
    blockedReason?: string | null;
  },
): Promise<VideoProjectManifest> {
  const manifest = await readProjectManifest(workspace);
  if (!manifest) {
    throw new Error(`Cannot update project metadata for ${workspace.slug}: manifest missing`);
  }
  const updatedManifest: VideoProjectManifest = {
    ...manifest,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.blockedBy !== undefined ? { blockedBy: input.blockedBy } : {}),
    ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
  };
  await writeProjectManifest(workspace, updatedManifest);
  return updatedManifest;
}
