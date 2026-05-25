import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendProjectEvent } from '../video/events.js';
import { buildPortfolioMetrics } from '../video/metrics.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';
import { createBriefArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

describe('buildPortfolioMetrics', () => {
  it('summarizes project counts by status and mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-metrics-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
      const beta = await ensureProjectWorkspace('beta', root);
      const now = new Date().toISOString();
      await writeProjectManifest(alpha, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'brief',
        lastCompletedStage: null,
        lastCheckpointStatus: 'pending',
      });
      await writeProjectManifest(beta, {
        slug: 'beta',
        productionMode: 'director',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'storyboard',
        lastCompletedStage: 'brief',
        lastCheckpointStatus: 'awaiting-approval',
      });
      await writeStageCheckpoint(beta, {
        stage: 'storyboard',
        status: 'awaiting-approval',
        generatedAt: now,
        artifacts: {},
        summary: 'waiting for storyboard approval',
        issues: [],
        nextAction: 'Review storyboard.md and approve execution.',
      });
      await writeArtifact(alpha, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'storyboard',
        metadata: {
          platform: 'youtube',
        },
      }));
      await writeArtifact(beta, 'brief', createBriefArtifact({
        title: 'Beta',
        intent: 'Beta intent',
        productionMode: 'director',
        metadata: {
          platform: 'tiktok',
        },
      }));
      await writeFile(join(beta.projectDir, 'storyboard.md'), '# Review\n');
      await writeFile(
        join(beta.projectDir, 'state', 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/legacy-beta',
          importedAt: now,
          imageCount: 1,
          videoCount: 0,
          finalCount: 0,
          telemetryCount: 0,
          manifestPresent: true,
          queueFilePresent: true,
          queuePendingStatusDetected: true,
          queueStatusMismatch: true,
          nestedVideoCount: 1,
          nestedFinalCount: 0,
          nestedOutputRootDetected: true,
          inferredCurrentStage: 'review',
          inferredLastCompletedStage: 'assets',
          inferredCheckpointStatus: 'completed',
        }, null, 2),
      );
      await appendProjectEvent(beta, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T10:00:00.000Z',
        payload: { markdownPath: join(beta.projectDir, 'storyboard.md') },
      });
      await appendProjectEvent(beta, {
        type: 'artifact.storyboard.written',
        recordedAt: '2026-04-20T11:00:00.000Z',
        payload: { artifactPath: join(beta.projectDir, 'artifacts', 'storyboard.json') },
      });
      await addCharacterProfile(alpha, {
        name: 'Nova',
        goBananasId: 170,
        referenceAssets: ['gobananas://character/170'],
        notes: ['Imported from `video create --gb-character`.'],
      });
      await addCharacterProfile(beta, {
        name: 'Komo',
        goBananasId: 170,
        referenceAssets: ['gobananas://character/170'],
        notes: ['Imported from `video create --import-library-characters`.'],
      });
      await addCharacterProfile(beta, {
        name: 'Nova',
        goBananasId: 555,
        referenceAssets: ['gobananas://character/555'],
        notes: ['Created via `video create --auto-create-characters`.'],
      });

      const metrics = await buildPortfolioMetrics(root);
      assert.equal(metrics.totalProjects, 2);
      assert.equal(metrics.byOpsStatus.planned, 1);
      assert.equal(metrics.byOpsStatus['needs-review'], 1);
      assert.equal(metrics.byReviewState.missing, 1);
      assert.equal(metrics.byReviewState.current, 0);
      assert.equal(metrics.byReviewState.stale, 1);
      assert.equal(metrics.unreviewedStoryboardProjects, 1);
      assert.equal(metrics.staleStoryboardReviewProjects, 1);
      assert.equal(metrics.legacyImportedProjects, 1);
      assert.equal(metrics.legacyQueueDriftProjects, 1);
      assert.equal(metrics.legacyNestedOutputProjects, 1);
      assert.equal(metrics.totalCharacterProfiles, 3);
      assert.equal(metrics.explicitCharacterProfiles, 1);
      assert.equal(metrics.importedCharacterProfiles, 1);
      assert.equal(metrics.autoCreatedCharacterProfiles, 1);
      assert.equal(metrics.byProductionMode.storyboard, 1);
      assert.equal(metrics.byProductionMode.director, 1);
      assert.equal(metrics.byPlatform.youtube, 1);
      assert.equal(metrics.byPlatform.tiktok, 1);
      assert.equal(metrics.byDueRisk.none, 2);
      assert.equal(metrics.byScoreBand.poor, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
