import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  VideoPipelineManifest,
  VideoStageArtifactName,
} from './types.js';
import type { VideoProjectWorkspace } from './workspace.js';
import { writeTextFileAtomic } from './atomic-write.js';

export type VideoCheckpointStatus =
  | 'pending'
  | 'completed'
  | 'awaiting-approval'
  | 'retry-required'
  | 'failed';

export interface VideoStageCheckpoint {
  stage: string;
  status: VideoCheckpointStatus;
  generatedAt: string;
  artifacts: Partial<Record<VideoStageArtifactName, string>>;
  summary: string;
  issues: string[];
  nextAction?: string;
}

function checkpointPathFor(workspace: VideoProjectWorkspace, stage: string): string {
  return join(workspace.checkpointsDir, `${stage}.json`);
}

export async function writeStageCheckpoint(
  workspace: VideoProjectWorkspace,
  checkpoint: VideoStageCheckpoint,
): Promise<void> {
  const checkpointPath = checkpointPathFor(workspace, checkpoint.stage);
  await writeTextFileAtomic(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

export async function readStageCheckpoint(
  workspace: VideoProjectWorkspace,
  stage: string,
): Promise<VideoStageCheckpoint | null> {
  const checkpointPath = checkpointPathFor(workspace, stage);
  if (!existsSync(checkpointPath)) return null;
  const raw = await readFile(checkpointPath, 'utf-8');
  return JSON.parse(raw) as VideoStageCheckpoint;
}

export async function getNextStage(
  workspace: VideoProjectWorkspace,
  manifest: VideoPipelineManifest,
): Promise<string | null> {
  for (const stage of manifest.stages) {
    const checkpoint = await readStageCheckpoint(workspace, stage.name);
    if (!checkpoint) return stage.name;
    if (checkpoint.status !== 'completed') return stage.name;
  }
  return null;
}
