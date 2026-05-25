import { readFile } from 'node:fs/promises';
import { listPortfolioReportSnapshots } from './report-history.js';
import type { VideoPortfolioReport } from './report.js';

export interface PortfolioReportDiff {
  generatedAt: string;
  root: string;
  from?: string;
  to?: string;
  summary: {
    totalProjectsDelta: number;
    completedProjectsDelta: number;
    completionRateDelta: number;
    averageScoreDelta: number;
    warningProjectsDelta: number;
    blockedProjectsDelta: number;
    needsReviewProjectsDelta: number;
    legacyImportedProjectsDelta: number;
    legacyQueueDriftProjectsDelta: number;
    legacyNestedOutputProjectsDelta: number;
  };
  projectChanges: {
    added: string[];
    removed: string[];
    statusChanged: Array<{
      slug: string;
      from: string;
      to: string;
    }>;
    stageChanged: Array<{
      slug: string;
      from: string | null;
      to: string | null;
    }>;
    platformChanged: Array<{
      slug: string;
      from: string | null;
      to: string | null;
    }>;
    targetRuntimeChanged: Array<{
      slug: string;
      from: number | null;
      to: number | null;
    }>;
    clipDurationChanged: Array<{
      slug: string;
      from: number | null;
      to: number | null;
    }>;
    executionProfileChanged: Array<{
      slug: string;
      from: {
        aspectRatio?: string;
        quality?: string;
        resolution?: string;
        generateAudio?: boolean;
        outputCount?: number;
      } | null;
      to: {
        aspectRatio?: string;
        quality?: string;
        resolution?: string;
        generateAudio?: boolean;
        outputCount?: number;
      } | null;
    }>;
    legacyImportChanged: Array<{
      slug: string;
      from: {
        manifestPresent?: boolean;
        queueFilePresent?: boolean;
        queueStatusMismatch?: boolean;
        nestedOutputRootDetected?: boolean;
      } | null;
      to: {
        manifestPresent?: boolean;
        queueFilePresent?: boolean;
        queueStatusMismatch?: boolean;
        nestedOutputRootDetected?: boolean;
      } | null;
    }>;
    reviewStateChanged: Array<{
      slug: string;
      from: string | null;
      to: string | null;
    }>;
  };
}

async function readReport(path: string): Promise<VideoPortfolioReport> {
  return JSON.parse(await readFile(path, 'utf-8')) as VideoPortfolioReport;
}

function normalizeExecutionProfile(
  profile: {
    aspectRatio?: string;
    quality?: string;
    resolution?: string;
    generateAudio?: boolean;
    outputCount?: number;
  } | null | undefined,
): {
  aspectRatio?: string;
  quality?: string;
  resolution?: string;
  generateAudio?: boolean;
  outputCount?: number;
} | null {
  if (!profile) return null;
  const normalized = {
    ...(profile.aspectRatio ? { aspectRatio: profile.aspectRatio } : {}),
    ...(profile.quality ? { quality: profile.quality } : {}),
    ...(profile.resolution ? { resolution: profile.resolution } : {}),
    ...(typeof profile.generateAudio === 'boolean' ? { generateAudio: profile.generateAudio } : {}),
    ...(typeof profile.outputCount === 'number' ? { outputCount: profile.outputCount } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeLegacyImportSummary(
  summary: {
    manifestPresent?: boolean;
    queueFilePresent?: boolean;
    queueStatusMismatch?: boolean;
    nestedOutputRootDetected?: boolean;
  } | null | undefined,
): {
  manifestPresent?: boolean;
  queueFilePresent?: boolean;
  queueStatusMismatch?: boolean;
  nestedOutputRootDetected?: boolean;
} | null {
  if (!summary) return null;
  const normalized = {
    ...(typeof summary.manifestPresent === 'boolean' ? { manifestPresent: summary.manifestPresent } : {}),
    ...(typeof summary.queueFilePresent === 'boolean' ? { queueFilePresent: summary.queueFilePresent } : {}),
    ...(typeof summary.queueStatusMismatch === 'boolean' ? { queueStatusMismatch: summary.queueStatusMismatch } : {}),
    ...(typeof summary.nestedOutputRootDetected === 'boolean' ? { nestedOutputRootDetected: summary.nestedOutputRootDetected } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export async function buildPortfolioReportDiff(
  root = process.cwd(),
  options: {
    fromPath?: string;
    toPath?: string;
  } = {},
): Promise<PortfolioReportDiff> {
  let fromPath = options.fromPath;
  let toPath = options.toPath;

  if (!fromPath || !toPath) {
    const snapshots = await listPortfolioReportSnapshots(root);
    if (snapshots.length < 2) {
      return {
        generatedAt: new Date().toISOString(),
        root,
        summary: {
          totalProjectsDelta: 0,
          completedProjectsDelta: 0,
          completionRateDelta: 0,
          averageScoreDelta: 0,
          warningProjectsDelta: 0,
          blockedProjectsDelta: 0,
          needsReviewProjectsDelta: 0,
          legacyImportedProjectsDelta: 0,
          legacyQueueDriftProjectsDelta: 0,
          legacyNestedOutputProjectsDelta: 0,
        },
        projectChanges: {
          added: [],
          removed: [],
          statusChanged: [],
          stageChanged: [],
          platformChanged: [],
          targetRuntimeChanged: [],
          clipDurationChanged: [],
          executionProfileChanged: [],
          legacyImportChanged: [],
          reviewStateChanged: [],
        },
      };
    }
    fromPath = snapshots[snapshots.length - 2]!.path;
    toPath = snapshots[snapshots.length - 1]!.path;
  }

  const [from, to] = await Promise.all([readReport(fromPath), readReport(toPath)]);
  const fromProjects = new Map(from.index.projects.map((project) => [project.slug, project]));
  const toProjects = new Map(to.index.projects.map((project) => [project.slug, project]));

  const added = [...toProjects.keys()].filter((slug) => !fromProjects.has(slug)).sort();
  const removed = [...fromProjects.keys()].filter((slug) => !toProjects.has(slug)).sort();
  const statusChanged: PortfolioReportDiff['projectChanges']['statusChanged'] = [];
  const stageChanged: PortfolioReportDiff['projectChanges']['stageChanged'] = [];
  const platformChanged: PortfolioReportDiff['projectChanges']['platformChanged'] = [];
  const targetRuntimeChanged: PortfolioReportDiff['projectChanges']['targetRuntimeChanged'] = [];
  const clipDurationChanged: PortfolioReportDiff['projectChanges']['clipDurationChanged'] = [];
  const executionProfileChanged: PortfolioReportDiff['projectChanges']['executionProfileChanged'] = [];
  const legacyImportChanged: PortfolioReportDiff['projectChanges']['legacyImportChanged'] = [];
  const reviewStateChanged: PortfolioReportDiff['projectChanges']['reviewStateChanged'] = [];

  for (const [slug, toProject] of toProjects) {
    const fromProject = fromProjects.get(slug);
    if (!fromProject) continue;
    if (fromProject.opsStatus !== toProject.opsStatus) {
      statusChanged.push({
        slug,
        from: fromProject.opsStatus,
        to: toProject.opsStatus,
      });
    }
    if (fromProject.nextStage !== toProject.nextStage) {
      stageChanged.push({
        slug,
        from: fromProject.nextStage,
        to: toProject.nextStage,
      });
    }
    if ((fromProject.platform ?? null) !== (toProject.platform ?? null)) {
      platformChanged.push({
        slug,
        from: fromProject.platform ?? null,
        to: toProject.platform ?? null,
      });
    }
    if ((fromProject.targetRuntimeSeconds ?? null) !== (toProject.targetRuntimeSeconds ?? null)) {
      targetRuntimeChanged.push({
        slug,
        from: fromProject.targetRuntimeSeconds ?? null,
        to: toProject.targetRuntimeSeconds ?? null,
      });
    }
    if ((fromProject.clipDurationSeconds ?? null) !== (toProject.clipDurationSeconds ?? null)) {
      clipDurationChanged.push({
        slug,
        from: fromProject.clipDurationSeconds ?? null,
        to: toProject.clipDurationSeconds ?? null,
      });
    }
    const fromExecutionProfile = normalizeExecutionProfile(fromProject.executionProfile ?? null);
    const toExecutionProfile = normalizeExecutionProfile(toProject.executionProfile ?? null);
    if (JSON.stringify(fromExecutionProfile) !== JSON.stringify(toExecutionProfile)) {
      executionProfileChanged.push({
        slug,
        from: fromExecutionProfile,
        to: toExecutionProfile,
      });
    }
    const fromLegacyImport = normalizeLegacyImportSummary(fromProject.legacyImportSummary ?? null);
    const toLegacyImport = normalizeLegacyImportSummary(toProject.legacyImportSummary ?? null);
    if (JSON.stringify(fromLegacyImport) !== JSON.stringify(toLegacyImport)) {
      legacyImportChanged.push({
        slug,
        from: fromLegacyImport,
        to: toLegacyImport,
      });
    }
    if ((fromProject.storyboardReviewState ?? null) !== (toProject.storyboardReviewState ?? null)) {
      reviewStateChanged.push({
        slug,
        from: fromProject.storyboardReviewState ?? null,
        to: toProject.storyboardReviewState ?? null,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    root,
    from: from.generatedAt,
    to: to.generatedAt,
    summary: {
      totalProjectsDelta: to.metrics.totalProjects - from.metrics.totalProjects,
      completedProjectsDelta: to.metrics.completedProjects - from.metrics.completedProjects,
      completionRateDelta: to.metrics.completionRate - from.metrics.completionRate,
      averageScoreDelta: to.metrics.averageScore - from.metrics.averageScore,
      warningProjectsDelta: to.health.warningProjects - from.health.warningProjects,
      blockedProjectsDelta: to.metrics.byOpsStatus.blocked - from.metrics.byOpsStatus.blocked,
      needsReviewProjectsDelta: to.metrics.byOpsStatus['needs-review'] - from.metrics.byOpsStatus['needs-review'],
      legacyImportedProjectsDelta: to.metrics.legacyImportedProjects - from.metrics.legacyImportedProjects,
      legacyQueueDriftProjectsDelta: to.metrics.legacyQueueDriftProjects - from.metrics.legacyQueueDriftProjects,
      legacyNestedOutputProjectsDelta: to.metrics.legacyNestedOutputProjects - from.metrics.legacyNestedOutputProjects,
    },
    projectChanges: {
      added,
      removed,
      statusChanged,
      stageChanged,
      platformChanged,
      targetRuntimeChanged,
      clipDurationChanged,
      executionProfileChanged,
      legacyImportChanged,
      reviewStateChanged,
    },
  };
}
