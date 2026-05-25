import { buildProjectIndex } from './project-index.js';
import type { VideoProductionMode } from './types.js';
import type { VideoProjectOpsStatus } from './project-index.js';
import type { DueRisk } from './scheduling.js';

export interface VideoPortfolioMetrics {
  generatedAt: string;
  root: string;
  totalProjects: number;
  completedProjects: number;
  completionRate: number;
  averageScore: number;
  unreviewedStoryboardProjects: number;
  staleStoryboardReviewProjects: number;
  legacyImportedProjects: number;
  legacyQueueDriftProjects: number;
  legacyNestedOutputProjects: number;
  totalCharacterProfiles: number;
  explicitCharacterProfiles: number;
  importedCharacterProfiles: number;
  autoCreatedCharacterProfiles: number;
  byReviewState: Record<'missing' | 'current' | 'stale', number>;
  byOpsStatus: Record<VideoProjectOpsStatus, number>;
  byProductionMode: Record<string, number>;
  byPlatform: Record<string, number>;
  byPriority: Record<string, number>;
  byDueRisk: Record<DueRisk, number>;
  byScoreBand: Record<string, number>;
  byNextStage: Record<string, number>;
}

export async function buildPortfolioMetrics(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<VideoPortfolioMetrics> {
  const index = await buildProjectIndex(root, productionMode);
  const byOpsStatus: Record<VideoProjectOpsStatus, number> = {
    missing: 0,
    planned: 0,
    active: 0,
    'needs-review': 0,
    blocked: 0,
    complete: 0,
  };
  const byProductionMode: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byDueRisk: Record<DueRisk, number> = {
    none: 0,
    soon: 0,
    overdue: 0,
  };
  const byReviewState: Record<'missing' | 'current' | 'stale', number> = {
    missing: 0,
    current: 0,
    stale: 0,
  };
  const byScoreBand: Record<string, number> = {};
  const byNextStage: Record<string, number> = {};
  let totalScore = 0;

  for (const project of index.projects) {
    byOpsStatus[project.opsStatus] += 1;
    byProductionMode[project.productionMode] = (byProductionMode[project.productionMode] ?? 0) + 1;
    const platformKey = project.platform ?? 'unset';
    byPlatform[platformKey] = (byPlatform[platformKey] ?? 0) + 1;
    const priorityKey = project.priority ?? 'unset';
    byPriority[priorityKey] = (byPriority[priorityKey] ?? 0) + 1;
    byDueRisk[project.dueRisk] += 1;
    byReviewState[project.storyboardReviewState ?? 'missing'] += 1;
    byScoreBand[project.scoreBand] = (byScoreBand[project.scoreBand] ?? 0) + 1;
    const nextStageKey = project.nextStage ?? 'complete';
    byNextStage[nextStageKey] = (byNextStage[nextStageKey] ?? 0) + 1;
    totalScore += project.score;
  }

  const totalProjects = index.projects.length;
  const completedProjects = byOpsStatus.complete;
  const completionRate = totalProjects === 0 ? 0 : completedProjects / totalProjects;
  const averageScore = totalProjects === 0 ? 0 : totalScore / totalProjects;
  const unreviewedStoryboardProjects = index.projects.filter((project) => project.storyboardReviewExists !== true).length;
  const staleStoryboardReviewProjects = index.projects.filter((project) => project.storyboardReviewStale === true).length;
  const legacyImportedProjects = index.projects.filter((project) => project.legacyImportSummary !== undefined).length;
  const legacyQueueDriftProjects = index.projects.filter((project) => project.legacyImportSummary?.queueStatusMismatch === true).length;
  const legacyNestedOutputProjects = index.projects.filter((project) => project.legacyImportSummary?.nestedOutputRootDetected === true).length;
  const totalCharacterProfiles = index.projects.reduce((sum, project) => sum + (project.characterProfileCount ?? 0), 0);
  const explicitCharacterProfiles = index.projects.reduce((sum, project) => sum + (project.characterHydrationSummary?.explicitCount ?? 0), 0);
  const importedCharacterProfiles = index.projects.reduce((sum, project) => sum + (project.characterHydrationSummary?.importedCount ?? 0), 0);
  const autoCreatedCharacterProfiles = index.projects.reduce((sum, project) => sum + (project.characterHydrationSummary?.autoCreatedCount ?? 0), 0);

  return {
    generatedAt: index.generatedAt,
    root: index.root,
    totalProjects,
    completedProjects,
    completionRate,
    averageScore,
    unreviewedStoryboardProjects,
    staleStoryboardReviewProjects,
    legacyImportedProjects,
    legacyQueueDriftProjects,
    legacyNestedOutputProjects,
    totalCharacterProfiles,
    explicitCharacterProfiles,
    importedCharacterProfiles,
    autoCreatedCharacterProfiles,
    byReviewState,
    byOpsStatus,
    byProductionMode,
    byPlatform,
    byPriority,
    byDueRisk,
    byScoreBand,
    byNextStage,
  };
}
