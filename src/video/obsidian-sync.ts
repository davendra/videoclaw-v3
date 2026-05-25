import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { exportProjectToObsidian } from './obsidian-export.js';
import { buildDependencyReport } from './dependencies.js';
import { doctorPortfolio } from './doctor-portfolio.js';
import { buildProjectIndex } from './project-index.js';
import { buildPortfolioMetrics } from './metrics.js';
import { buildNextActions } from './next-actions.js';
import { buildOwnerWorkloadReport } from './workload.js';
import { buildPortfolioReportDiff } from './report-diff.js';
import { buildPortfolioTrendReport, listPortfolioReportSnapshots } from './report-history.js';
import { scaffoldObsidianVault } from './obsidian-vault.js';
import { buildTimeline } from './timeline.js';
import type { VideoProductionMode } from './types.js';
import type { VideoProjectOpsStatus } from './project-index.js';

export interface ObsidianSyncResult {
  outputDir: string;
  dashboardPath: string;
  viewPaths: string[];
  exportedProjects: string[];
}

function buildDashboardMarkdown(input: {
  title: string;
  generatedAt: string;
  projects: Array<{
    slug: string;
    productionMode: VideoProductionMode;
    targetRuntimeSeconds?: number;
    clipDurationSeconds?: number;
    genre?: string;
    platform?: string;
    style?: string;
    colorGrading?: string;
    legacyImportSummary?: {
      manifestPresent?: boolean;
      queueFilePresent?: boolean;
      queueStatusMismatch?: boolean;
      nestedOutputRootDetected?: boolean;
    };
    opsStatus: VideoProjectOpsStatus;
    score: number;
    scoreBand: string;
    owner?: string | null;
    priority?: string | null;
    dueDate?: string | null;
    dueRisk: string;
    blockedReason?: string | null;
    nextStage: string | null;
    storyboardReviewState?: 'missing' | 'current' | 'stale';
    storyboardReviewExists?: boolean;
    storyboardReviewPath?: string;
    storyboardReviewGeneratedAt?: string;
    storyboardReviewStale?: boolean;
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
  }>;
}): string {
  const lines: string[] = [
    `# ${input.title}`,
    '',
    `Generated: ${input.generatedAt}`,
    '',
    '| Project | Status | Score | Owner | Priority | Due | Due Risk | Blocked Reason | Mode | Platform | Creative Direction | Legacy Import | Next Stage | Review State | Review Exists | Review | Review Generated | Review Stale | Profile | Guidance | Character Profiles | Character Hydration | Character Bindings | Completed | Pending | Artifacts |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const project of input.projects) {
    const profile = project.executionProfile
      ? `${project.executionProfile.aspectRatio ?? '-'} / ${project.executionProfile.quality ?? '-'} / ${project.executionProfile.resolution ?? '-'} / audio=${project.executionProfile.generateAudio ?? '-'} / n=${project.executionProfile.outputCount ?? '-'}`
      : '-';
    const guidance = project.promptGuidance && project.promptGuidance.length > 0
      ? project.promptGuidance.join(', ')
      : '-';
    const reviewState = project.storyboardReviewState ?? '-';
    const reviewExists = typeof project.storyboardReviewExists === 'boolean' ? String(project.storyboardReviewExists) : '-';
    const review = project.storyboardReviewPath
      ? `[storyboard.md](${project.storyboardReviewPath})`
      : '-';
    const reviewGenerated = project.storyboardReviewGeneratedAt ?? '-';
    const reviewStale = typeof project.storyboardReviewStale === 'boolean' ? String(project.storyboardReviewStale) : '-';
    const characterBindings = project.characterBindings && project.characterBindings.length > 0
      ? project.characterBindings
          .map((binding) => `${binding.name}:${binding.goBananasId ?? 'none'}:${binding.referenceAssets.join('&') || 'none'}`)
          .join(', ')
      : '-';
    const characterProfiles = typeof project.characterProfileCount === 'number'
      ? String(project.characterProfileCount)
      : '-';
    const characterHydration = project.characterHydrationSummary
      ? `explicit=${project.characterHydrationSummary.explicitCount} / imported=${project.characterHydrationSummary.importedCount} / auto=${project.characterHydrationSummary.autoCreatedCount}`
      : '-';
    const creativeDirection = project.style || project.colorGrading
      ? `${project.style ?? '-'} / ${project.colorGrading ?? '-'}`
      : '-';
    const mode = project.genre
      ? `${project.productionMode} (${project.genre}${typeof project.targetRuntimeSeconds === 'number' ? `, ${project.targetRuntimeSeconds}s` : ''}${typeof project.clipDurationSeconds === 'number' ? ` @ ${project.clipDurationSeconds}s` : ''})`
      : project.productionMode;
    const legacyImport = project.legacyImportSummary
      ? `manifest=${project.legacyImportSummary.manifestPresent ?? '-'} / queue-drift=${project.legacyImportSummary.queueStatusMismatch ?? '-'} / nested-output=${project.legacyImportSummary.nestedOutputRootDetected ?? '-'}`
      : '-';
    lines.push(
      `| [[Projects/${project.slug}|${project.slug}]] | ${project.opsStatus} | ${project.score} (${project.scoreBand}) | ${project.owner ?? '-'} | ${project.priority ?? '-'} | ${project.dueDate ?? '-'} | ${project.dueRisk} | ${project.blockedReason ?? '-'} | ${mode} | ${project.platform ?? '-'} | ${creativeDirection} | ${legacyImport} | ${project.nextStage ?? 'complete'} | ${reviewState} | ${reviewExists} | ${review} | ${reviewGenerated} | ${reviewStale} | ${profile} | ${guidance} | ${characterProfiles} | ${characterHydration} | ${characterBindings} | ${project.completedStages.length} | ${project.pendingStages.length} | ${project.artifactCount} |`,
    );
  }

  if (input.projects.length === 0) {
    lines.push('| _none_ | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |');
  }

  return `${lines.join('\n')}\n`;
}

function buildMetricsMarkdown(input: Awaited<ReturnType<typeof buildPortfolioMetrics>>): string {
  const lines: string[] = [
    '# Portfolio Metrics',
    '',
    `Generated: ${input.generatedAt}`,
    '',
    `- Total projects: ${input.totalProjects}`,
    `- Completed projects: ${input.completedProjects}`,
    `- Completion rate: ${(input.completionRate * 100).toFixed(1)}%`,
    `- Average score: ${input.averageScore.toFixed(1)}`,
    `- Unreviewed storyboard projects: ${input.unreviewedStoryboardProjects}`,
    `- Stale storyboard review projects: ${input.staleStoryboardReviewProjects}`,
    `- Legacy imported projects: ${input.legacyImportedProjects}`,
    `- Legacy queue-drift projects: ${input.legacyQueueDriftProjects}`,
    `- Legacy nested-output projects: ${input.legacyNestedOutputProjects}`,
    `- Total character profiles: ${input.totalCharacterProfiles}`,
    `- Explicit character profiles: ${input.explicitCharacterProfiles}`,
    `- Imported character profiles: ${input.importedCharacterProfiles}`,
    `- Auto-created character profiles: ${input.autoCreatedCharacterProfiles}`,
    '',
    '## By Review State',
    '',
  ];

  for (const [key, value] of Object.entries(input.byReviewState)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push('', '## By Ops Status', '');

  for (const [key, value] of Object.entries(input.byOpsStatus)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push('', '## By Production Mode', '');
  for (const [key, value] of Object.entries(input.byProductionMode)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push('', '## By Platform', '');
  for (const [key, value] of Object.entries(input.byPlatform)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push('', '## By Priority', '');
  for (const [key, value] of Object.entries(input.byPriority)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push('', '## By Due Risk', '');
  for (const [key, value] of Object.entries(input.byDueRisk)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push('', '## By Score Band', '');
  for (const [key, value] of Object.entries(input.byScoreBand)) {
    lines.push(`- ${key}: ${value}`);
  }

  lines.push('', '## By Next Stage', '');
  for (const [key, value] of Object.entries(input.byNextStage)) {
    lines.push(`- ${key}: ${value}`);
  }

  return `${lines.join('\n')}\n`;
}

function buildTimelineMarkdown(
  events: Awaited<ReturnType<typeof buildTimeline>>,
): string {
  const lines: string[] = [
    '# Timeline',
    '',
  ];

  if (events.length === 0) {
    lines.push('- No events recorded yet.');
    return `${lines.join('\n')}\n`;
  }

  for (const event of events) {
    lines.push(`- ${event.recordedAt} | [[Projects/${event.slug}|${event.slug}]] | \`${event.type}\`${event.payload ? ` | ${JSON.stringify(event.payload)}` : ''}`);
  }

  return `${lines.join('\n')}\n`;
}

function buildTrendsMarkdown(
  report: Awaited<ReturnType<typeof buildPortfolioTrendReport>>,
): string {
  const lines: string[] = [
    '# Trends',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Snapshot | Total | Completed | Completion Rate | Avg Score | Warning Projects | Blocked | Needs Review | Platforms | Legacy Imported | Queue Drift | Nested Output |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  if (report.points.length === 0) {
    lines.push('| _none_ | - | - | - | - | - | - | - | - | - | - | - |');
    return `${lines.join('\n')}\n`;
  }

  for (const point of report.points) {
    const platforms = Object.entries(point.byPlatform)
      .map(([platform, count]) => `${platform}:${count}`)
      .join(', ');
    lines.push(
      `| ${point.generatedAt} | ${point.totalProjects} | ${point.completedProjects} | ${(point.completionRate * 100).toFixed(1)}% | ${point.averageScore.toFixed(1)} | ${point.warningProjects} | ${point.blockedProjects} | ${point.needsReviewProjects} | ${platforms || '-'} | ${point.legacyImportedProjects} | ${point.legacyQueueDriftProjects} | ${point.legacyNestedOutputProjects} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildHistoryMarkdown(
  snapshots: Awaited<ReturnType<typeof listPortfolioReportSnapshots>>,
): string {
  const lines: string[] = [
    '# History',
    '',
    '| Snapshot | Total | Completed | Avg Score | Warning Projects | Platforms | Legacy Imported | Queue Drift | Nested Output | File |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  if (snapshots.length === 0) {
    lines.push('| _none_ | - | - | - | - | - | - | - | - | - |');
    return `${lines.join('\n')}\n`;
  }

  for (const snapshot of snapshots) {
    const platforms = Object.entries(snapshot.byPlatform ?? {})
      .map(([platform, count]) => `${platform}:${count}`)
      .join(', ');
    lines.push(
      `| ${snapshot.generatedAt} | ${snapshot.totalProjects ?? '-'} | ${snapshot.completedProjects ?? '-'} | ${typeof snapshot.averageScore === 'number' ? snapshot.averageScore.toFixed(1) : '-'} | ${snapshot.warningProjects ?? '-'} | ${platforms || '-'} | ${snapshot.legacyImportedProjects ?? '-'} | ${snapshot.legacyQueueDriftProjects ?? '-'} | ${snapshot.legacyNestedOutputProjects ?? '-'} | ${snapshot.path} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildHealthMarkdown(
  report: Awaited<ReturnType<typeof doctorPortfolio>>,
): string {
  const lines: string[] = [
    '# Health',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Total projects: ${report.totalProjects}`,
    `- Healthy: ${report.healthyProjects}`,
    `- Unhealthy: ${report.unhealthyProjects}`,
    `- Warning-only projects: ${report.warningProjects}`,
    `- Legacy imported projects: ${report.legacyImportedProjects}`,
    `- Legacy queue-drift projects: ${report.legacyQueueDriftProjects}`,
    `- Legacy nested-output projects: ${report.legacyNestedOutputProjects}`,
    `- Missing storyboard review files: ${report.missingStoryboardReviewProjects}`,
    `- Stale storyboard review files: ${report.staleStoryboardReviewProjects}`,
    '',
    '| Project | OK | Errors | Warnings |',
    '| --- | --- | --- | --- |',
  ];

  for (const entry of report.entries) {
    lines.push(`| [[Projects/${entry.slug}|${entry.slug}]] | ${entry.ok ? 'yes' : 'no'} | ${entry.errorCount} | ${entry.warningCount} |`);
  }

  if (report.entries.length === 0) {
    lines.push('| _none_ | - | - | - |');
  }

  lines.push('', '## Detailed Issues', '');
  for (const entry of report.entries.filter((item) => !item.ok || item.warningCount > 0)) {
    lines.push(`### ${entry.slug}`);
    for (const issue of entry.issues) {
      lines.push(`- ${issue.severity}: ${issue.message}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function buildNextActionsMarkdown(
  report: Awaited<ReturnType<typeof buildNextActions>>,
): string {
  const lines: string[] = [
    '# Next Actions',
    '',
    `Generated: ${report.generatedAt}`,
    '',
  ];

  if (report.actions.length === 0) {
    lines.push('- No open actions.');
    return `${lines.join('\n')}\n`;
  }

  for (const action of report.actions) {
    const platform = action.platform
      ? ` | platform=${action.platform}`
      : '';
    const legacyImport = action.legacyImportSummary
      ? ` | legacy-import=manifest:${action.legacyImportSummary.manifestPresent ?? '-'},queue-drift:${action.legacyImportSummary.queueStatusMismatch ?? '-'},nested-output:${action.legacyImportSummary.nestedOutputRootDetected ?? '-'}`
      : '';
    const reviewLink = action.storyboardReviewPath
      ? ` | [storyboard.md](${action.storyboardReviewPath})`
      : '';
    const reviewGenerated = action.storyboardReviewGeneratedAt
      ? ` | review-generated=${action.storyboardReviewGeneratedAt}`
      : '';
    lines.push(`- [[Projects/${action.slug}|${action.slug}]] | ${action.priority.toUpperCase()} | ${action.action} | ${action.reason}${platform}${legacyImport}${reviewLink}${reviewGenerated}`);
  }

  return `${lines.join('\n')}\n`;
}

function buildChangesMarkdown(
  diff: Awaited<ReturnType<typeof buildPortfolioReportDiff>>,
): string {
  const lines: string[] = [
    '# Changes',
    '',
    `Generated: ${diff.generatedAt}`,
    '',
    `- From: ${diff.from ?? 'n/a'}`,
    `- To: ${diff.to ?? 'n/a'}`,
    '',
    '## Summary Delta',
    '',
    `- Total projects delta: ${diff.summary.totalProjectsDelta}`,
    `- Completed projects delta: ${diff.summary.completedProjectsDelta}`,
    `- Completion rate delta: ${(diff.summary.completionRateDelta * 100).toFixed(1)}%`,
    `- Average score delta: ${diff.summary.averageScoreDelta.toFixed(1)}`,
    `- Warning-only projects delta: ${diff.summary.warningProjectsDelta}`,
    `- Blocked projects delta: ${diff.summary.blockedProjectsDelta}`,
    `- Needs-review projects delta: ${diff.summary.needsReviewProjectsDelta}`,
    `- Legacy imported projects delta: ${diff.summary.legacyImportedProjectsDelta}`,
    `- Legacy queue-drift projects delta: ${diff.summary.legacyQueueDriftProjectsDelta}`,
    `- Legacy nested-output projects delta: ${diff.summary.legacyNestedOutputProjectsDelta}`,
    '',
    '## Project Changes',
    '',
  ];

  if (
    diff.projectChanges.added.length === 0
    && diff.projectChanges.removed.length === 0
    && diff.projectChanges.statusChanged.length === 0
    && diff.projectChanges.stageChanged.length === 0
    && diff.projectChanges.platformChanged.length === 0
    && diff.projectChanges.targetRuntimeChanged.length === 0
    && diff.projectChanges.clipDurationChanged.length === 0
    && diff.projectChanges.executionProfileChanged.length === 0
    && diff.projectChanges.legacyImportChanged.length === 0
  ) {
    lines.push('- No snapshot-to-snapshot project changes detected.');
    return `${lines.join('\n')}\n`;
  }

  if (diff.projectChanges.added.length > 0) {
    lines.push('### Added');
    for (const slug of diff.projectChanges.added) {
      lines.push(`- [[Projects/${slug}|${slug}]]`);
    }
    lines.push('');
  }

  if (diff.projectChanges.removed.length > 0) {
    lines.push('### Removed');
    for (const slug of diff.projectChanges.removed) {
      lines.push(`- ${slug}`);
    }
    lines.push('');
  }

  if (diff.projectChanges.statusChanged.length > 0) {
    lines.push('### Status Changed');
    for (const change of diff.projectChanges.statusChanged) {
      lines.push(`- [[Projects/${change.slug}|${change.slug}]]: ${change.from} -> ${change.to}`);
    }
    lines.push('');
  }

  if (diff.projectChanges.stageChanged.length > 0) {
    lines.push('### Stage Changed');
    for (const change of diff.projectChanges.stageChanged) {
      lines.push(`- [[Projects/${change.slug}|${change.slug}]]: ${change.from ?? 'none'} -> ${change.to ?? 'none'}`);
    }
    lines.push('');
  }

  if (diff.projectChanges.platformChanged.length > 0) {
    lines.push('### Platform Changed');
    for (const change of diff.projectChanges.platformChanged) {
      lines.push(`- [[Projects/${change.slug}|${change.slug}]]: ${change.from ?? 'none'} -> ${change.to ?? 'none'}`);
    }
    lines.push('');
  }

  if (diff.projectChanges.targetRuntimeChanged.length > 0) {
    lines.push('### Target Runtime Changed');
    for (const change of diff.projectChanges.targetRuntimeChanged) {
      lines.push(`- [[Projects/${change.slug}|${change.slug}]]: ${change.from !== null ? `${change.from}s` : 'none'} -> ${change.to !== null ? `${change.to}s` : 'none'}`);
    }
    lines.push('');
  }

  if (diff.projectChanges.clipDurationChanged.length > 0) {
    lines.push('### Clip Duration Changed');
    for (const change of diff.projectChanges.clipDurationChanged) {
      lines.push(`- [[Projects/${change.slug}|${change.slug}]]: ${change.from !== null ? `${change.from}s` : 'none'} -> ${change.to !== null ? `${change.to}s` : 'none'}`);
    }
    lines.push('');
  }

  if (diff.projectChanges.executionProfileChanged.length > 0) {
    lines.push('### Execution Profile Changed');
    for (const change of diff.projectChanges.executionProfileChanged) {
      const from = change.from
        ? `${change.from.aspectRatio ?? '-'} / ${change.from.quality ?? '-'} / ${change.from.resolution ?? '-'} / audio=${change.from.generateAudio ?? '-'} / outputs=${change.from.outputCount ?? '-'}`
        : 'none';
      const to = change.to
        ? `${change.to.aspectRatio ?? '-'} / ${change.to.quality ?? '-'} / ${change.to.resolution ?? '-'} / audio=${change.to.generateAudio ?? '-'} / outputs=${change.to.outputCount ?? '-'}`
        : 'none';
      lines.push(`- [[Projects/${change.slug}|${change.slug}]]: ${from} -> ${to}`);
    }
    lines.push('');
  }

  if (diff.projectChanges.legacyImportChanged.length > 0) {
    lines.push('### Legacy Import Changed');
    for (const change of diff.projectChanges.legacyImportChanged) {
      const from = change.from
        ? `manifest=${change.from.manifestPresent ?? '-'} / queue-file=${change.from.queueFilePresent ?? '-'} / queue-drift=${change.from.queueStatusMismatch ?? '-'} / nested-output=${change.from.nestedOutputRootDetected ?? '-'}`
        : 'none';
      const to = change.to
        ? `manifest=${change.to.manifestPresent ?? '-'} / queue-file=${change.to.queueFilePresent ?? '-'} / queue-drift=${change.to.queueStatusMismatch ?? '-'} / nested-output=${change.to.nestedOutputRootDetected ?? '-'}`
        : 'none';
      lines.push(`- [[Projects/${change.slug}|${change.slug}]]: ${from} -> ${to}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function buildDependenciesMarkdown(
  report: Awaited<ReturnType<typeof buildDependencyReport>>,
): string {
  const lines: string[] = [
    '# Dependencies',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Blocked projects: ${report.blockedProjects.length}`,
    `- Blocker projects: ${report.blockerProjects.length}`,
    '',
    '## Edges',
    '',
  ];

  if (report.edges.length === 0) {
    lines.push('- No project dependencies recorded.');
    return `${lines.join('\n')}\n`;
  }

  const nodeBySlug = new Map(report.nodes.map((node) => [node.slug, node]));
  for (const edge of report.edges) {
    const fromPlatform = nodeBySlug.get(edge.from)?.platform;
    const toPlatform = nodeBySlug.get(edge.to)?.platform;
    const fromLegacyImport = nodeBySlug.get(edge.from)?.legacyImportSummary;
    const toLegacyImport = nodeBySlug.get(edge.to)?.legacyImportSummary;
    lines.push(
      `- [[Projects/${edge.from}|${edge.from}]]${fromPlatform ? ` (${fromPlatform})` : ''}${fromLegacyImport ? ` [legacy queue-drift=${fromLegacyImport.queueStatusMismatch ?? '-'} nested-output=${fromLegacyImport.nestedOutputRootDetected ?? '-'}]` : ''} depends on [[Projects/${edge.to}|${edge.to}]]${toPlatform ? ` (${toPlatform})` : ''}${toLegacyImport ? ` [legacy queue-drift=${toLegacyImport.queueStatusMismatch ?? '-'} nested-output=${toLegacyImport.nestedOutputRootDetected ?? '-'}]` : ''}${edge.reason ? ` | ${edge.reason}` : ''}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function buildWorkloadMarkdown(
  report: Awaited<ReturnType<typeof buildOwnerWorkloadReport>>,
): string {
  const lines: string[] = [
    '# Owner Workload',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Owner | Total | Active | Blocked | Needs Review | Due Soon | Overdue | Avg Score | Platforms | Projects |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const owner of report.owners) {
    const platforms = Object.entries(owner.byPlatform)
      .map(([platform, count]) => `${platform}:${count}`)
      .join(', ');
    lines.push(
      `| ${owner.owner} | ${owner.totalProjects} | ${owner.activeProjects} | ${owner.blockedProjects} | ${owner.needsReviewProjects} | ${owner.dueSoonProjects} | ${owner.overdueProjects} | ${owner.averageScore.toFixed(1)} | ${platforms || '-'} | ${owner.projects.join(', ')} |`,
    );
  }

  if (report.owners.length === 0) {
    lines.push('| _none_ | - | - | - | - | - | - | - | - | - |');
  }

  return `${lines.join('\n')}\n`;
}

export async function syncObsidianVault(
  options: {
    root?: string;
    outputDir?: string;
    productionMode?: VideoProductionMode;
  } = {},
): Promise<ObsidianSyncResult> {
  const root = resolve(options.root ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(root, 'ops', 'obsidian'));
  const scaffold = await scaffoldObsidianVault(outputDir);
  const projectNotesDir = join(outputDir, 'Projects');
  const dashboardPath = scaffold.dashboardPath;
  const viewPaths: string[] = [];
  const index = await buildProjectIndex(root, options.productionMode ?? 'storyboard');
  const dependencies = await buildDependencyReport(root, options.productionMode ?? 'storyboard');
  const metrics = await buildPortfolioMetrics(root, options.productionMode ?? 'storyboard');
  const health = await doctorPortfolio(root, options.productionMode ?? 'storyboard');
  const nextActions = await buildNextActions(root, options.productionMode ?? 'storyboard');
  const workload = await buildOwnerWorkloadReport(root, options.productionMode ?? 'storyboard');
  const trends = await buildPortfolioTrendReport(root);
  const history = await listPortfolioReportSnapshots(root);
  const timeline = await buildTimeline(root);
  const diff = await buildPortfolioReportDiff(root);

  const exportedProjects: string[] = [];
  for (const project of index.projects) {
    const result = await exportProjectToObsidian(project.slug, {
      root,
      outputDir: projectNotesDir,
      productionMode: project.productionMode,
    });
    exportedProjects.push(result.outputPath);
  }

  const dashboard = buildDashboardMarkdown({
    title: 'Production Dashboard',
    generatedAt: index.generatedAt,
    projects: index.projects,
  });
  await writeFile(dashboardPath, dashboard);

  const groupedViews: Array<{ title: string; fileName: string; status: VideoProjectOpsStatus }> = [
    { title: 'Active Projects', fileName: 'Active.md', status: 'active' },
    { title: 'Needs Review', fileName: 'Needs Review.md', status: 'needs-review' },
    { title: 'Blocked Projects', fileName: 'Blocked.md', status: 'blocked' },
    { title: 'Completed Projects', fileName: 'Complete.md', status: 'complete' },
  ];

  for (const view of groupedViews) {
    const path = join(outputDir, view.fileName);
    const markdown = buildDashboardMarkdown({
      title: view.title,
      generatedAt: index.generatedAt,
      projects: index.projects.filter((project) => project.opsStatus === view.status),
    });
    await writeFile(path, markdown);
    viewPaths.push(path);
  }

  const metricsPath = join(outputDir, 'Metrics.md');
  await writeFile(metricsPath, buildMetricsMarkdown(metrics));
  viewPaths.push(metricsPath);

  const timelinePath = join(outputDir, 'Timeline.md');
  await writeFile(timelinePath, buildTimelineMarkdown(timeline));
  viewPaths.push(timelinePath);

  const trendsPath = join(outputDir, 'Trends.md');
  await writeFile(trendsPath, buildTrendsMarkdown(trends));
  viewPaths.push(trendsPath);

  const historyPath = join(outputDir, 'History.md');
  await writeFile(historyPath, buildHistoryMarkdown(history));
  viewPaths.push(historyPath);

  const healthPath = join(outputDir, 'Health.md');
  await writeFile(healthPath, buildHealthMarkdown(health));
  viewPaths.push(healthPath);

  const nextActionsPath = join(outputDir, 'Next Actions.md');
  await writeFile(nextActionsPath, buildNextActionsMarkdown(nextActions));
  viewPaths.push(nextActionsPath);

  const changesPath = join(outputDir, 'Changes.md');
  await writeFile(changesPath, buildChangesMarkdown(diff));
  viewPaths.push(changesPath);

  const dependenciesPath = join(outputDir, 'Dependencies.md');
  await writeFile(dependenciesPath, buildDependenciesMarkdown(dependencies));
  viewPaths.push(dependenciesPath);

  const workloadPath = join(outputDir, 'Owner Workload.md');
  await writeFile(workloadPath, buildWorkloadMarkdown(workload));
  viewPaths.push(workloadPath);

  return {
    outputDir,
    dashboardPath,
    viewPaths,
    exportedProjects,
  };
}
