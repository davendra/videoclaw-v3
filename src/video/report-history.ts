import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildPortfolioReport } from './report.js';
import type { VideoPortfolioReport } from './report.js';
import type { VideoProductionMode } from './types.js';

export interface PortfolioReportSnapshotRef {
  path: string;
  generatedAt: string;
  totalProjects?: number;
  completedProjects?: number;
  averageScore?: number;
  warningProjects?: number;
  byPlatform?: Record<string, number>;
  legacyImportedProjects?: number;
  legacyQueueDriftProjects?: number;
  legacyNestedOutputProjects?: number;
}

export interface PortfolioTrendPoint {
  generatedAt: string;
  totalProjects: number;
  completedProjects: number;
  completionRate: number;
  averageScore: number;
  warningProjects: number;
  blockedProjects: number;
  needsReviewProjects: number;
  byPlatform: Record<string, number>;
  legacyImportedProjects: number;
  legacyQueueDriftProjects: number;
  legacyNestedOutputProjects: number;
}

export interface PortfolioTrendReport {
  generatedAt: string;
  root: string;
  points: PortfolioTrendPoint[];
}

function historyDir(root: string): string {
  return join(root, 'reports', 'history');
}

function snapshotPath(root: string, generatedAt: string): string {
  const safeTimestamp = generatedAt.replaceAll(':', '-');
  return join(historyDir(root), `${safeTimestamp}.json`);
}

export async function writePortfolioReportSnapshot(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<{ outputPath: string; report: VideoPortfolioReport }> {
  const report = await buildPortfolioReport(root, productionMode);
  const dir = historyDir(root);
  await mkdir(dir, { recursive: true });
  const outputPath = snapshotPath(root, report.generatedAt);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return { outputPath, report };
}

export async function listPortfolioReportSnapshots(
  root = process.cwd(),
): Promise<PortfolioReportSnapshotRef[]> {
  const dir = historyDir(root);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir))
    .filter((entry) => entry.endsWith('.json'))
    .sort();

  const snapshots: PortfolioReportSnapshotRef[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<VideoPortfolioReport>;
    snapshots.push({
      path,
      generatedAt: parsed.generatedAt ?? file.replace(/\.json$/, ''),
      ...(typeof parsed.metrics?.totalProjects === 'number' ? { totalProjects: parsed.metrics.totalProjects } : {}),
      ...(typeof parsed.metrics?.completedProjects === 'number' ? { completedProjects: parsed.metrics.completedProjects } : {}),
      ...(typeof parsed.metrics?.averageScore === 'number' ? { averageScore: parsed.metrics.averageScore } : {}),
      ...(typeof parsed.health?.warningProjects === 'number' ? { warningProjects: parsed.health.warningProjects } : {}),
      ...(parsed.metrics?.byPlatform ? { byPlatform: parsed.metrics.byPlatform } : {}),
      ...(typeof parsed.metrics?.legacyImportedProjects === 'number' ? { legacyImportedProjects: parsed.metrics.legacyImportedProjects } : {}),
      ...(typeof parsed.metrics?.legacyQueueDriftProjects === 'number' ? { legacyQueueDriftProjects: parsed.metrics.legacyQueueDriftProjects } : {}),
      ...(typeof parsed.metrics?.legacyNestedOutputProjects === 'number' ? { legacyNestedOutputProjects: parsed.metrics.legacyNestedOutputProjects } : {}),
    });
  }
  return snapshots;
}

export async function buildPortfolioTrendReport(
  root = process.cwd(),
): Promise<PortfolioTrendReport> {
  const snapshots = await listPortfolioReportSnapshots(root);
  const points: PortfolioTrendPoint[] = [];
  for (const snapshot of snapshots) {
    const raw = await readFile(snapshot.path, 'utf-8');
    const parsed = JSON.parse(raw) as VideoPortfolioReport;
    points.push({
      generatedAt: parsed.generatedAt,
      totalProjects: parsed.metrics.totalProjects,
      completedProjects: parsed.metrics.completedProjects,
      completionRate: parsed.metrics.completionRate,
      averageScore: parsed.metrics.averageScore,
      warningProjects: parsed.health.warningProjects,
      blockedProjects: parsed.metrics.byOpsStatus.blocked,
      needsReviewProjects: parsed.metrics.byOpsStatus['needs-review'],
      byPlatform: parsed.metrics.byPlatform,
      legacyImportedProjects: parsed.metrics.legacyImportedProjects,
      legacyQueueDriftProjects: parsed.metrics.legacyQueueDriftProjects,
      legacyNestedOutputProjects: parsed.metrics.legacyNestedOutputProjects,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    root,
    points,
  };
}
