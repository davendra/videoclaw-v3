import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { VideoStageArtifactName } from './types.js';
import type { VideoProjectWorkspace } from './workspace.js';
import { writeTextFileAtomic } from './atomic-write.js';

export function artifactPathFor(
  workspace: VideoProjectWorkspace,
  name: VideoStageArtifactName,
): string {
  return join(workspace.artifactsDir, `${name}.json`);
}

export function artifactHistoryDirFor(
  workspace: VideoProjectWorkspace,
  name: VideoStageArtifactName,
): string {
  return join(workspace.artifactsHistoryDir, name);
}

export function artifactSnapshotPathFor(
  workspace: VideoProjectWorkspace,
  name: VideoStageArtifactName,
  timestamp: string,
): string {
  const safeTimestamp = timestamp.replaceAll(':', '-');
  return join(artifactHistoryDirFor(workspace, name), `${safeTimestamp}.json`);
}

export async function listArtifactHistory(
  workspace: VideoProjectWorkspace,
  name: VideoStageArtifactName,
): Promise<string[]> {
  const historyDir = artifactHistoryDirFor(workspace, name);
  try {
    return (await readdir(historyDir))
      .filter((entry) => entry.endsWith('.json'))
      .sort()
      .map((entry) => join(historyDir, entry));
  } catch {
    return [];
  }
}

export async function writeArtifact(
  workspace: VideoProjectWorkspace,
  name: VideoStageArtifactName,
  value: unknown,
): Promise<string> {
  const timestamp = new Date().toISOString();
  const path = artifactPathFor(workspace, name);
  const historyDir = artifactHistoryDirFor(workspace, name);
  const snapshotPath = artifactSnapshotPathFor(workspace, name, timestamp);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(historyDir, { recursive: true });
  await writeTextFileAtomic(path, content);
  await writeTextFileAtomic(snapshotPath, content);
  return path;
}
