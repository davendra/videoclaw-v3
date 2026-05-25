import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildProjectScorecard } from './scorecard.js';
import { deriveDueRisk } from './scheduling.js';
import { buildProjectStatusReport } from './status.js';
import type { ArtifactSummary } from './reference-sheets.js';
import type { SceneSelectionSummary } from './scene-selection.js';
import { readProjectManifest, resolveProjectWorkspace } from './workspace.js';
import { listProjects } from './projects.js';
import type { LegacyImportSummary, VideoProductionMode } from './types.js';

export type VideoProjectOpsStatus =
  | 'missing'
  | 'planned'
  | 'active'
  | 'needs-review'
  | 'blocked'
  | 'complete';

export interface VideoProjectIndexEntry {
  slug: string;
  productionMode: VideoProductionMode;
  opsStatus: VideoProjectOpsStatus;
  score: number;
  scoreBand: 'poor' | 'fair' | 'good' | 'excellent';
  targetRuntimeSeconds?: number;
  clipDurationSeconds?: number;
  genre?: string;
  platform?: string;
  style?: string;
  colorGrading?: string;
  legacyImportSummary?: LegacyImportSummary;
  owner?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical' | null;
  dueDate?: string | null;
  dueRisk: 'none' | 'soon' | 'overdue';
  tags?: string[];
  blockedBy?: string[];
  blockedReason?: string | null;
  projectExists: boolean;
  nextStage: string | null;
  storyboardReviewState?: 'missing' | 'current' | 'stale';
  storyboardReviewExists?: boolean;
  storyboardReviewPath?: string;
  storyboardReviewGeneratedAt?: string;
  storyboardReviewStale?: boolean;
  reviewReportVerdict?: string;
  reviewPublishReady?: boolean;
  executionProfile?: {
    aspectRatio?: string;
    quality?: string;
    resolution?: string;
    generateAudio?: boolean;
    outputCount?: number;
  };
  promptGuidance?: string[];
  characterProfileCount?: number;
  characterHydrationSummary?: {
    totalProfiles: number;
    explicitCount: number;
    importedCount: number;
    autoCreatedCount: number;
  };
  characterBindings?: Array<{
    name: string;
    goBananasId?: number;
    referenceAssets: string[];
    profileExists: boolean;
  }>;
  completedStages: string[];
  pendingStages: string[];
  artifactCount: number;
  checkpointCount: number;
  referenceSheets: ArtifactSummary;
  sceneSelection: SceneSelectionSummary;
}

export interface VideoProjectIndex {
  generatedAt: string;
  root: string;
  projects: VideoProjectIndexEntry[];
}

export function deriveProjectOpsStatus(input: {
  projectExists: boolean;
  nextStage: string | null;
  completedStages: string[];
  checkpoints: Array<{ status: string }>;
  reviewPublishReady?: boolean;
  legacyImportSummary?: {
    queueStatusMismatch?: boolean;
    nestedOutputRootDetected?: boolean;
  };
}): VideoProjectOpsStatus {
  if (!input.projectExists) return 'missing';
  if (input.checkpoints.some((checkpoint) => checkpoint.status === 'failed')) return 'blocked';
  if (input.checkpoints.some((checkpoint) => checkpoint.status === 'retry-required' || checkpoint.status === 'awaiting-approval')) return 'needs-review';
  if (input.completedStages.includes('review') && input.reviewPublishReady === false) {
    return 'needs-review';
  }
  if (input.nextStage === null) return 'complete';
  if (input.legacyImportSummary?.queueStatusMismatch || input.legacyImportSummary?.nestedOutputRootDetected) {
    return 'needs-review';
  }
  if (input.completedStages.length === 0) return 'planned';
  return 'active';
}

export async function buildProjectIndex(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<VideoProjectIndex> {
  const normalizedRoot = resolve(root);
  const slugs = await listProjects(normalizedRoot);
  const projects: VideoProjectIndexEntry[] = [];

  for (const slug of slugs) {
    const status = await buildProjectStatusReport(slug, normalizedRoot, productionMode);
    const manifest = await readProjectManifest(resolveProjectWorkspace(slug, normalizedRoot));
    const scorecard = buildProjectScorecard({ status, manifest });
    projects.push({
      slug,
      productionMode: status.productionMode,
      opsStatus: deriveProjectOpsStatus(status),
      score: scorecard.score,
      scoreBand: scorecard.band,
      ...(status.targetRuntimeSeconds ? { targetRuntimeSeconds: status.targetRuntimeSeconds } : {}),
      ...(status.clipDurationSeconds ? { clipDurationSeconds: status.clipDurationSeconds } : {}),
      ...(status.genre ? { genre: status.genre } : {}),
      ...(status.platform ? { platform: status.platform } : {}),
      ...(status.style ? { style: status.style } : {}),
      ...(status.colorGrading ? { colorGrading: status.colorGrading } : {}),
      ...(status.legacyImportSummary ? { legacyImportSummary: status.legacyImportSummary } : {}),
      owner: manifest?.owner ?? null,
      priority: manifest?.priority ?? null,
      dueDate: manifest?.dueDate ?? null,
      dueRisk: deriveDueRisk(manifest?.dueDate),
      tags: manifest?.tags ?? [],
      blockedBy: manifest?.blockedBy ?? [],
      blockedReason: manifest?.blockedReason ?? null,
      projectExists: status.projectExists,
      nextStage: status.nextStage,
      ...(status.storyboardReviewState ? { storyboardReviewState: status.storyboardReviewState } : {}),
      ...(status.storyboardReviewExists ? { storyboardReviewExists: status.storyboardReviewExists } : {}),
      ...(status.storyboardReviewPath ? { storyboardReviewPath: status.storyboardReviewPath } : {}),
      ...(status.storyboardReviewGeneratedAt ? { storyboardReviewGeneratedAt: status.storyboardReviewGeneratedAt } : {}),
      ...(status.storyboardReviewStale !== undefined ? { storyboardReviewStale: status.storyboardReviewStale } : {}),
      ...(status.reviewReportVerdict ? { reviewReportVerdict: status.reviewReportVerdict } : {}),
      ...(status.reviewPublishReady !== undefined ? { reviewPublishReady: status.reviewPublishReady } : {}),
      ...(status.executionProfile ? { executionProfile: status.executionProfile } : {}),
      ...(status.promptGuidance ? { promptGuidance: status.promptGuidance.map((entry) => entry.name) } : {}),
      ...(status.characterProfiles ? { characterProfileCount: status.characterProfiles.length } : {}),
      ...(status.characterHydrationSummary ? { characterHydrationSummary: status.characterHydrationSummary } : {}),
      ...(status.characterBindings ? { characterBindings: status.characterBindings } : {}),
      completedStages: status.completedStages,
      pendingStages: status.pendingStages,
      artifactCount: status.artifactFiles.length,
      checkpointCount: status.checkpoints.length,
      referenceSheets: status.referenceSheets,
      sceneSelection: status.sceneSelection,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    root: normalizedRoot,
    projects,
  };
}

export async function writeProjectIndex(
  index: VideoProjectIndex,
  outputPath?: string,
): Promise<string> {
  const path = outputPath ?? join(index.root, 'projects', 'index.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`);
  return path;
}
