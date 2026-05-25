import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildPortfolioReport } from './report.js';
import type { VideoProductionMode } from './types.js';

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export interface CsvExportResult {
  reportPath: string;
  projectsCsvPath: string;
  timelineCsvPath: string;
}

export async function exportPortfolioCsv(
  root = process.cwd(),
  outputDir = join(root, 'exports'),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<CsvExportResult> {
  const report = await buildPortfolioReport(root, productionMode);
  await mkdir(outputDir, { recursive: true });

  const reportPath = join(outputDir, 'portfolio-report.json');
  const projectsCsvPath = join(outputDir, 'projects.csv');
  const timelineCsvPath = join(outputDir, 'timeline.csv');

  const projectHeaders = [
    'slug',
    'opsStatus',
    'productionMode',
    'targetRuntimeSeconds',
    'clipDurationSeconds',
    'genre',
    'platform',
    'style',
    'colorGrading',
    'legacyImportManifestPresent',
    'legacyImportQueueFilePresent',
    'legacyImportQueueStatusMismatch',
    'legacyImportNestedOutputRootDetected',
    'owner',
    'priority',
    'dueDate',
    'nextStage',
    'storyboardReviewState',
    'storyboardReviewExists',
    'storyboardReviewPath',
    'storyboardReviewGeneratedAt',
    'storyboardReviewStale',
    'reviewReportVerdict',
    'reviewPublishReady',
    'executionProfileAspectRatio',
    'executionProfileQuality',
    'executionProfileResolution',
    'executionProfileGenerateAudio',
    'executionProfileOutputCount',
    'promptGuidance',
    'characterProfileCount',
    'characterHydrationExplicitCount',
    'characterHydrationImportedCount',
    'characterHydrationAutoCreatedCount',
    'characterBindings',
    'completedStageCount',
    'pendingStageCount',
    'artifactCount',
    'checkpointCount',
    'reference_sheets_count',
    'reference_sheets_types',
    'scene_selection_with_selection',
    'scene_candidates_total',
  ];
  const projectLines = [
    projectHeaders.join(','),
    ...report.index.projects.map((project) => [
      project.slug,
      project.opsStatus,
      project.productionMode,
      typeof project.targetRuntimeSeconds === 'number' ? project.targetRuntimeSeconds : '',
      typeof project.clipDurationSeconds === 'number' ? project.clipDurationSeconds : '',
      project.genre ?? '',
      project.platform ?? '',
      project.style ?? '',
      project.colorGrading ?? '',
      typeof project.legacyImportSummary?.manifestPresent === 'boolean' ? String(project.legacyImportSummary.manifestPresent) : '',
      typeof project.legacyImportSummary?.queueFilePresent === 'boolean' ? String(project.legacyImportSummary.queueFilePresent) : '',
      typeof project.legacyImportSummary?.queueStatusMismatch === 'boolean' ? String(project.legacyImportSummary.queueStatusMismatch) : '',
      typeof project.legacyImportSummary?.nestedOutputRootDetected === 'boolean' ? String(project.legacyImportSummary.nestedOutputRootDetected) : '',
      project.owner ?? '',
      project.priority ?? '',
      project.dueDate ?? '',
      project.nextStage ?? 'complete',
      project.storyboardReviewState ?? '',
      typeof project.storyboardReviewExists === 'boolean' ? String(project.storyboardReviewExists) : '',
      project.storyboardReviewPath ?? '',
      project.storyboardReviewGeneratedAt ?? '',
      typeof project.storyboardReviewStale === 'boolean' ? String(project.storyboardReviewStale) : '',
      project.reviewReportVerdict ?? '',
      typeof project.reviewPublishReady === 'boolean' ? String(project.reviewPublishReady) : '',
      project.executionProfile?.aspectRatio ?? '',
      project.executionProfile?.quality ?? '',
      project.executionProfile?.resolution ?? '',
      typeof project.executionProfile?.generateAudio === 'boolean' ? String(project.executionProfile.generateAudio) : '',
      typeof project.executionProfile?.outputCount === 'number' ? project.executionProfile.outputCount : '',
      (project.promptGuidance ?? []).join('|'),
      typeof project.characterProfileCount === 'number' ? project.characterProfileCount : '',
      typeof project.characterHydrationSummary?.explicitCount === 'number' ? project.characterHydrationSummary.explicitCount : '',
      typeof project.characterHydrationSummary?.importedCount === 'number' ? project.characterHydrationSummary.importedCount : '',
      typeof project.characterHydrationSummary?.autoCreatedCount === 'number' ? project.characterHydrationSummary.autoCreatedCount : '',
      (project.characterBindings ?? [])
        .map((binding) => `${binding.name}:${binding.goBananasId ?? 'none'}:${binding.referenceAssets.join('&') || 'none'}`)
        .join('|'),
      project.completedStages.length,
      project.pendingStages.length,
      project.artifactCount,
      project.checkpointCount,
      project.referenceSheets?.count ?? 0,
      Object.keys(project.referenceSheets?.byType ?? {}).join('|'),
      project.sceneSelection?.withSelection ?? 0,
      project.sceneSelection?.totalCandidates ?? 0,
    ].map(csvEscape).join(',')),
  ];

  const timelineHeaders = ['recordedAt', 'slug', 'type', 'payload'];
  const timelineLines = [
    timelineHeaders.join(','),
    ...report.timeline.map((event) => [
      event.recordedAt,
      event.slug,
      event.type,
      JSON.stringify(event.payload ?? {}),
    ].map(csvEscape).join(',')),
  ];

  await Promise.all([
    writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(projectsCsvPath, `${projectLines.join('\n')}\n`),
    writeFile(timelineCsvPath, `${timelineLines.join('\n')}\n`),
  ]);

  return {
    reportPath,
    projectsCsvPath,
    timelineCsvPath,
  };
}
