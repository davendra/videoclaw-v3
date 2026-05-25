import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { getBuiltinPipelineManifest } from './pipeline-manifest.js';
import { readStageCheckpoint } from './checkpoints.js';
import { readSceneCandidatesArtifact, sceneCandidatesPathFor } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import type { VideoProductionMode } from './types.js';
import type { VideoProjectWorkspace } from './workspace.js';

async function assertSceneSelectionsPresent(
  workspace: VideoProjectWorkspace,
  stageName: 'review' | 'publish',
): Promise<void> {
  // Feature-gate: when no scene-candidates.json exists, skip entirely so legacy
  // projects without candidates keep advancing.
  if (!existsSync(sceneCandidatesPathFor(workspace.root, workspace.slug))) return;

  const candidates = await readSceneCandidatesArtifact(workspace.root, workspace.slug);
  const selection = await readSceneSelectionArtifact(workspace.root, workspace.slug);
  const selectedByScene = new Map<number, string | null>();
  for (const entry of selection.scenes) {
    selectedByScene.set(entry.sceneIndex, entry.selectedCandidateId);
  }
  const missing: number[] = [];
  for (const entry of candidates.scenes) {
    if (entry.candidates.length === 0) continue;
    const selected = selectedByScene.get(entry.sceneIndex) ?? null;
    if (!selected) missing.push(entry.sceneIndex);
  }
  if (missing.length > 0) {
    throw new Error(
      `Stage "${stageName}" is blocked: scene-selection-missing for scene(s) ${missing.join(', ')}.`,
    );
  }
}

export async function assertStageReady(
  workspace: VideoProjectWorkspace,
  productionMode: VideoProductionMode,
  stageName: 'brief' | 'storyboard' | 'assets' | 'review' | 'publish',
): Promise<void> {
  const manifest = getBuiltinPipelineManifest(productionMode);
  const stage = manifest.stages.find((candidate) => candidate.name === stageName);
  if (!stage) {
    throw new Error(`Unknown stage: ${stageName}`);
  }

  for (const requiredArtifact of stage.requiredArtifactsIn ?? []) {
    const producingStage = manifest.stages.find((candidate) => candidate.produces.includes(requiredArtifact));
    if (!producingStage) {
      throw new Error(`No producing stage found for required artifact: ${requiredArtifact}`);
    }
    const checkpoint = await readStageCheckpoint(workspace, producingStage.name);
    if (!checkpoint) {
      throw new Error(`Stage "${stageName}" is blocked: prerequisite stage "${producingStage.name}" has not run yet.`);
    }
    if (checkpoint.status !== 'completed') {
      throw new Error(`Stage "${stageName}" is blocked: prerequisite stage "${producingStage.name}" is ${checkpoint.status}.`);
    }
    if (!checkpoint.artifacts[requiredArtifact]) {
      throw new Error(`Stage "${stageName}" is blocked: prerequisite artifact "${requiredArtifact}" is missing.`);
    }
  }

  if (stageName === 'review') {
    await assertSceneSelectionsPresent(workspace, 'review');
  }

  if (stageName === 'publish') {
    const reviewCheckpoint = await readStageCheckpoint(workspace, 'review');
    if (!reviewCheckpoint) {
      throw new Error('Stage "publish" is blocked: review has not run yet.');
    }
    if (reviewCheckpoint.status !== 'completed') {
      throw new Error(`Stage "publish" is blocked: review is ${reviewCheckpoint.status}.`);
    }
    await assertReviewReportPublishReady(reviewCheckpoint.artifacts['review-report']);
    await assertSceneSelectionsPresent(workspace, 'publish');
  }
}

async function assertReviewReportPublishReady(
  reviewReportPath: string | undefined,
): Promise<void> {
  if (!reviewReportPath) {
    throw new Error('Stage "publish" is blocked: review-report artifact is missing.');
  }
  if (!existsSync(reviewReportPath)) {
    throw new Error(`Stage "publish" is blocked: review-report artifact is missing: ${reviewReportPath}`);
  }

  let reviewReport: unknown;
  try {
    reviewReport = JSON.parse(await readFile(reviewReportPath, 'utf-8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    throw new Error(`Stage "publish" is blocked: review-report artifact is malformed (${message}).`);
  }

  const report = isRecord(reviewReport) ? reviewReport : {};
  const metrics = isRecord(report.metrics) ? report.metrics : {};
  if (report.verdict !== 'pass') {
    throw new Error(`Stage "publish" is blocked: review-report verdict is ${String(report.verdict ?? 'missing')}.`);
  }
  if (metrics.publishReady !== true) {
    throw new Error('Stage "publish" is blocked: review-report metrics.publishReady is not true.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
