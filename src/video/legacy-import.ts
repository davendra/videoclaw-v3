import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { appendProjectEvent } from './events.js';
import { getBuiltinPipelineManifest } from './pipeline-manifest.js';
import { ensureProjectWorkspace, readProjectManifest, updateProjectManifestMetadata, updateProjectManifestState, writeProjectManifest } from './workspace.js';
import type { LegacyImportSummary } from './types.js';
import type { VideoProjectManifest } from './workspace.js';

export interface LegacyImportResult {
  slug: string;
  sourcePath: string;
  imported: boolean;
  skipped: boolean;
  summaryPath?: string;
}

async function countFiles(dirPath: string, pattern: RegExp): Promise<number> {
  if (!existsSync(dirPath)) return 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && pattern.test(entry.name)).length;
}

function objectContainsPendingStatus(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'pending';
  }
  if (Array.isArray(value)) {
    return value.some((item) => objectContainsPendingStatus(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => objectContainsPendingStatus(item));
  }
  return false;
}

export async function inspectLegacyProject(sourcePath: string): Promise<LegacyImportSummary> {
  const imagesDir = join(sourcePath, 'images');
  const videosDir = join(sourcePath, 'videos');
  const finalDir = join(sourcePath, 'final');
  const telemetryDir = join(sourcePath, 'telemetry');
  const nestedRoot = join(sourcePath, basename(sourcePath));
  const nestedVideosDir = join(nestedRoot, 'videos');
  const nestedFinalDir = join(nestedRoot, 'final');
  const manifestPath = join(sourcePath, 'manifest.json');
  const queuePath = join(sourcePath, 'seedance_queue.json');

  const imageCount = await countFiles(imagesDir, /\.(png|jpe?g|webp)$/i);
  const videoCount = await countFiles(videosDir, /\.mp4$/i);
  const finalCount = await countFiles(finalDir, /\.mp4$/i);
  const telemetryCount = await countFiles(telemetryDir, /\.(jsonl|json)$/i);
  const nestedVideoCount = await countFiles(nestedVideosDir, /\.mp4$/i);
  const nestedFinalCount = await countFiles(nestedFinalDir, /\.mp4$/i);
  const manifestPresent = existsSync(manifestPath);
  const queueFilePresent = existsSync(queuePath);
  let queuePendingStatusDetected = false;
  if (queueFilePresent) {
    try {
      const queue = JSON.parse(await readFile(queuePath, 'utf-8')) as unknown;
      queuePendingStatusDetected = objectContainsPendingStatus(queue);
    } catch {
      queuePendingStatusDetected = false;
    }
  }
  const nestedOutputRootDetected = nestedVideoCount > 0 || nestedFinalCount > 0;
  const queueStatusMismatch = queuePendingStatusDetected && (
    videoCount > 0
    || finalCount > 0
    || nestedVideoCount > 0
    || nestedFinalCount > 0
  );

  let inferredCurrentStage: string | null = 'brief';
  let inferredLastCompletedStage: string | null = null;
  let inferredCheckpointStatus: string | null = 'pending';

  if (finalCount > 0 || nestedFinalCount > 0) {
    inferredCurrentStage = null;
    inferredLastCompletedStage = 'publish';
    inferredCheckpointStatus = 'completed';
  } else if (videoCount > 0 || nestedVideoCount > 0) {
    inferredCurrentStage = 'review';
    inferredLastCompletedStage = 'assets';
    inferredCheckpointStatus = 'completed';
  } else if (imageCount > 0) {
    inferredCurrentStage = 'assets';
    inferredLastCompletedStage = 'storyboard';
    inferredCheckpointStatus = 'completed';
  }

  return {
    sourcePath,
    importedAt: new Date().toISOString(),
    imageCount,
    videoCount,
    finalCount,
    telemetryCount,
    manifestPresent,
    queueFilePresent,
    queuePendingStatusDetected,
    queueStatusMismatch,
    nestedVideoCount,
    nestedFinalCount,
    nestedOutputRootDetected,
    inferredCurrentStage,
    inferredLastCompletedStage,
    inferredCheckpointStatus,
  };
}

function buildImportTags(summary: LegacyImportSummary): string[] {
  const tags = ['legacy-import'];
  if (summary.finalCount > 0) tags.push('legacy-final');
  else if (summary.videoCount > 0) tags.push('legacy-video');
  else if (summary.imageCount > 0) tags.push('legacy-image');
  else tags.push('legacy-empty');
  if (summary.manifestPresent) tags.push('legacy-manifest');
  if (summary.nestedOutputRootDetected) tags.push('legacy-nested-output');
  if (summary.queueStatusMismatch) tags.push('legacy-queue-drift');
  return tags;
}

export async function importLegacyProjects(
  sourceRoot: string,
  targetRoot = process.cwd(),
): Promise<LegacyImportResult[]> {
  const normalizedSourceRoot = resolve(sourceRoot);
  const entries = await readdir(normalizedSourceRoot, { withFileTypes: true });
  const results: LegacyImportResult[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const sourcePath = join(normalizedSourceRoot, slug);
    const workspace = await ensureProjectWorkspace(slug, targetRoot);
    const existingManifest = await readProjectManifest(workspace);
    if (existingManifest) {
      results.push({ slug, sourcePath, imported: false, skipped: true });
      continue;
    }

    const summary = await inspectLegacyProject(sourcePath);
    const pipeline = getBuiltinPipelineManifest('storyboard');
    const manifest: VideoProjectManifest = {
      slug,
      productionMode: 'storyboard',
      createdAt: summary.importedAt,
      updatedAt: summary.importedAt,
      pipeline,
      currentStage: summary.inferredCurrentStage,
      lastCompletedStage: summary.inferredLastCompletedStage,
      lastCheckpointStatus: summary.inferredCheckpointStatus,
      tags: buildImportTags(summary),
    };
    await writeProjectManifest(workspace, manifest);
    await updateProjectManifestMetadata(workspace, {
      updatedAt: summary.importedAt,
      tags: buildImportTags(summary),
    });

    const stateDir = join(workspace.projectDir, 'state');
    await mkdir(stateDir, { recursive: true });
    const summaryPath = join(stateDir, 'legacy-import-summary.json');
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await appendProjectEvent(workspace, {
      type: 'project.legacy-imported',
      recordedAt: summary.importedAt,
      payload: {
        sourcePath,
        imageCount: summary.imageCount,
        videoCount: summary.videoCount,
        finalCount: summary.finalCount,
        telemetryCount: summary.telemetryCount,
        manifestPresent: summary.manifestPresent,
        queueFilePresent: summary.queueFilePresent,
        queuePendingStatusDetected: summary.queuePendingStatusDetected,
        queueStatusMismatch: summary.queueStatusMismatch,
        nestedVideoCount: summary.nestedVideoCount,
        nestedFinalCount: summary.nestedFinalCount,
        nestedOutputRootDetected: summary.nestedOutputRootDetected,
        inferredCurrentStage: summary.inferredCurrentStage,
        inferredLastCompletedStage: summary.inferredLastCompletedStage,
        inferredCheckpointStatus: summary.inferredCheckpointStatus,
      },
    });

    results.push({
      slug,
      sourcePath,
      imported: true,
      skipped: false,
      summaryPath,
    });
  }

  return results;
}
