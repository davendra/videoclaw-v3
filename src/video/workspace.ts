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

/**
 * Project-level cinematic look profile. Persisted on the manifest so a project
 * carries its default cinematography register across every `vclaw` invocation
 * (Joey 2.0: "photorealism is the universal default, dial down by exception").
 * Every field is optional and backward-compatible — an absent block resolves to
 * the HARD DEFAULT in {@link ../video/cinema-profile.resolveCinemaProfile}.
 */
export interface VideoCinemaProfile {
  /** Cinematography language density. Default (resolved) `'rich'`. */
  detail?: 'terse' | 'standard' | 'rich';
  /** Whether the anti-plastic capture-realism block is emitted. Default `true`. */
  realism?: boolean;
  /** Prose (behaviour) vs numeric (Kelvin/°/ratio) cinematography register. Default `'prose'`. */
  register?: 'prose' | 'numeric';
  /** Volumetric-haze density for the realism block. Default `'light'`. */
  haze?: 'thin' | 'light' | 'heavy';
  /** Emit the moisture-matte clause in the realism block. Default off. */
  wet?: boolean;
  /** Lighting register id (see cinematography `lightingSpec`/`lightingProse`). */
  lightingId?: string;
  /** Color-grade register id (see cinematography `gradeSpec`/`gradeProse`). */
  gradeId?: string;
  /** Backdrop plate kind. Default `'mid-gray'`. */
  plateKind?: 'mid-gray' | 'white' | 'black';
  /** Cinema (film hardware) vs phone (UGC smartphone) capture register. */
  captureRegister?: 'cinema' | 'phone';
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
  /** Optional project-level cinematic look profile (backward-compatible). */
  cinemaProfile?: VideoCinemaProfile;
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

/**
 * Merge a partial {@link VideoCinemaProfile} into the project manifest's
 * `cinemaProfile` block. Only the provided fields are written; absent fields are
 * preserved from any existing block. Mirrors {@link updateProjectManifestMetadata}.
 */
export async function updateProjectManifestCinemaProfile(
  workspace: VideoProjectWorkspace,
  patch: VideoCinemaProfile,
  updatedAt?: string,
): Promise<VideoProjectManifest> {
  const manifest = await readProjectManifest(workspace);
  if (!manifest) {
    throw new Error(`Cannot update cinema profile for ${workspace.slug}: manifest missing`);
  }
  const merged: VideoCinemaProfile = { ...(manifest.cinemaProfile ?? {}) };
  for (const key of Object.keys(patch) as (keyof VideoCinemaProfile)[]) {
    const value = patch[key];
    if (value !== undefined) {
      // Narrowing through `unknown` keeps the heterogeneous union assignment safe.
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  const updatedManifest: VideoProjectManifest = {
    ...manifest,
    updatedAt: updatedAt ?? new Date().toISOString(),
    cinemaProfile: merged,
  };
  await writeProjectManifest(workspace, updatedManifest);
  return updatedManifest;
}
