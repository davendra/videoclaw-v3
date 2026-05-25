import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBriefArtifact,
  createPublishReportArtifact,
  createReviewReportArtifact,
  createStoryboardArtifact,
} from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';
import { appendProjectEvent } from '../video/events.js';
import { buildNextActions } from '../video/next-actions.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';

describe('buildNextActions', () => {
  it('prioritizes blocked and review-required projects ahead of planned work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-next-actions-'));
    try {
      const now = new Date().toISOString();

      const blocked = await ensureProjectWorkspace('blocked-project', root);
      await writeProjectManifest(blocked, {
        slug: 'blocked-project',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'publish',
        lastCompletedStage: 'review',
        lastCheckpointStatus: 'failed',
      });
      await writeStageCheckpoint(blocked, {
        stage: 'publish',
        status: 'failed',
        generatedAt: now,
        artifacts: {},
        summary: 'publish failed',
        issues: ['missing final file'],
        nextAction: 'Fix publish blocker.',
      });

      const review = await ensureProjectWorkspace('review-project', root);
      await writeProjectManifest(review, {
        slug: 'review-project',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'review',
        lastCompletedStage: 'assets',
        lastCheckpointStatus: 'retry-required',
      });
      const reviewArtifactPath = await writeArtifact(review, 'review-report', createReviewReportArtifact({
        projectSlug: 'review-project',
        verdict: 'retry',
        findings: ['Needs revision'],
      }));
      await writeStageCheckpoint(review, {
        stage: 'review',
        status: 'retry-required',
        generatedAt: now,
        artifacts: { 'review-report': reviewArtifactPath },
        summary: 'review needs retry',
        issues: ['Needs revision'],
        nextAction: 'Ready for publish handoff.',
      });

      const planned = await ensureProjectWorkspace('planned-project', root);
      await writeProjectManifest(planned, {
        slug: 'planned-project',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        tags: ['tiktok-launch'],
        currentStage: 'brief',
        lastCompletedStage: null,
        lastCheckpointStatus: 'pending',
      });
      await writeFile(
        join(planned.projectDir, 'artifacts', 'brief.json'),
        JSON.stringify({
          title: 'Planned Project',
          intent: 'Intent',
          productionMode: 'storyboard',
          createdAt: now,
          metadata: {
            platform: 'tiktok',
          },
        }, null, 2),
      );
      await writeFile(
        join(planned.projectDir, 'state', 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/planned-project',
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

      const dependency = await ensureProjectWorkspace('dependency-project', root);
      await writeProjectManifest(dependency, {
        slug: 'dependency-project',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
        blockedBy: ['planned-project'],
        blockedReason: 'Waiting for storyboard approval.',
      });

      const approval = await ensureProjectWorkspace('approval-project', root);
      await writeProjectManifest(approval, {
        slug: 'approval-project',
        productionMode: 'director',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'storyboard',
        lastCompletedStage: 'brief',
        lastCheckpointStatus: 'awaiting-approval',
      });
      await writeStageCheckpoint(approval, {
        stage: 'storyboard',
        status: 'awaiting-approval',
        generatedAt: now,
        artifacts: {},
        summary: 'waiting for storyboard approval',
        issues: [],
        nextAction: 'Review /tmp/approval-project/storyboard.md and approve execution.',
      });
      await writeFile(join(approval.projectDir, 'storyboard.md'), '# Review\n');
      await appendProjectEvent(approval, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T12:00:00.000Z',
        payload: { markdownPath: join(approval.projectDir, 'storyboard.md') },
      });
      await appendProjectEvent(approval, {
        type: 'artifact.storyboard.written',
        recordedAt: '2026-04-20T13:00:00.000Z',
        payload: { artifactPath: join(approval.projectDir, 'artifacts', 'storyboard.json') },
      });

      const publishNotReady = await ensureProjectWorkspace('publish-not-ready-project', root);
      await writeProjectManifest(publishNotReady, {
        slug: 'publish-not-ready-project',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'publish',
        lastCompletedStage: 'review',
        lastCheckpointStatus: 'completed',
      });
      const publishNotReadyArtifactPath = await writeArtifact(publishNotReady, 'review-report', createReviewReportArtifact({
        projectSlug: 'publish-not-ready-project',
        verdict: 'pass',
        findings: ['Legacy pass report without publish-ready metric.'],
      }));
      await writeStageCheckpoint(publishNotReady, {
        stage: 'review',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'review-report': publishNotReadyArtifactPath },
        summary: 'legacy review pass without publish-ready metric',
        issues: [],
        nextAction: 'Ready for publish handoff.',
      });

      const report = await buildNextActions(root);
      assert.equal(report.actions.length, 6);
      assert.equal(report.actions[0]?.slug, 'approval-project');
      assert.equal(report.actions[1]?.slug, 'blocked-project');
      assert.equal(report.actions[2]?.slug, 'dependency-project');
      assert.equal(report.actions[3]?.slug, 'planned-project');
      assert.equal(report.actions[4]?.slug, 'publish-not-ready-project');
      assert.equal(report.actions[5]?.slug, 'review-project');
      assert.match(String(report.actions[0]?.action), /Refresh the storyboard review/i);
      assert.match(String(report.actions[0]?.reason), /changed after the last generated review artifact/i);
      assert.match(String(report.actions[0]?.storyboardReviewPath), /storyboard\.md$/);
      assert.equal(report.actions[0]?.storyboardReviewGeneratedAt, '2026-04-20T12:00:00.000Z');
      assert.equal(report.actions[0]?.storyboardReviewStale, true);
      assert.match(String(report.actions[2]?.reason), /blocked by: planned-project/i);
      assert.equal(report.actions[3]?.platform, 'tiktok');
      assert.match(String(report.actions[3]?.action), /Reconcile imported legacy state/i);
      assert.match(String(report.actions[3]?.reason), /queue status disagrees with discovered legacy outputs/i);
      assert.equal(report.actions[3]?.legacyImportSummary?.queueStatusMismatch, true);
      assert.equal(report.actions[4]?.action, 'Resolve review findings: Legacy pass report without publish-ready metric.');
      assert.match(String(report.actions[4]?.reason), /not yet approved/i);
      assert.equal(report.actions[5]?.action, 'Resolve review findings: Needs revision.');
      assert.match(String(report.actions[5]?.reason), /requested revisions/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces legacy published projects whose saved review is not publish-ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-next-actions-published-review-'));
    try {
      const now = new Date().toISOString();
      const workspace = await ensureProjectWorkspace('legacy-published-project', root);
      await writeProjectManifest(workspace, {
        slug: 'legacy-published-project',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'complete',
        lastCompletedStage: 'publish',
        lastCheckpointStatus: 'completed',
      });

      const briefPath = await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Legacy Published',
        intent: 'Legacy published project.',
        productionMode: 'storyboard',
      }));
      const storyboardPath = await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'legacy-published-project',
        productionMode: 'storyboard',
        scenes: [
          {
            sceneIndex: 0,
            description: 'Opening scene.',
          },
        ],
      }));
      const assetManifestPath = await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'legacy-published-project',
        assets: [
          {
            id: 'scene-0-video',
            kind: 'video',
            path: '/tmp/scene-0.mp4',
            sceneIndex: 0,
          },
        ],
      });
      const reviewReportPath = await writeArtifact(workspace, 'review-report', createReviewReportArtifact({
        projectSlug: 'legacy-published-project',
        verdict: 'pass',
        findings: ['Legacy pass report without publish-ready metric.'],
      }));
      const publishReportPath = await writeArtifact(workspace, 'publish-report', createPublishReportArtifact({
        projectSlug: 'legacy-published-project',
        status: 'published',
        finalOutputPath: '/tmp/final.mp4',
      }));

      await writeStageCheckpoint(workspace, {
        stage: 'brief',
        status: 'completed',
        generatedAt: now,
        artifacts: { brief: briefPath },
        summary: 'brief completed',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'storyboard',
        status: 'completed',
        generatedAt: now,
        artifacts: { storyboard: storyboardPath },
        summary: 'storyboard completed',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'assets',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'asset-manifest': assetManifestPath },
        summary: 'assets completed',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'review',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'review-report': reviewReportPath },
        summary: 'legacy review pass without publish-ready metric',
        issues: [],
        nextAction: 'Ready for publish handoff.',
      });
      await writeStageCheckpoint(workspace, {
        stage: 'publish',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'publish-report': publishReportPath },
        summary: 'publish completed',
        issues: [],
      });

      const report = await buildNextActions(root);
      assert.equal(report.actions.length, 1);
      assert.equal(report.actions[0]?.slug, 'legacy-published-project');
      assert.equal(report.actions[0]?.opsStatus, 'needs-review');
      assert.equal(report.actions[0]?.nextStage, null);
      assert.equal(report.actions[0]?.action, 'Resolve review findings: Legacy pass report without publish-ready metric.');
      assert.match(String(report.actions[0]?.reason), /not yet approved/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces cancelled executions as a resubmit-or-leave-cancelled decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-next-actions-cancelled-'));
    try {
      const now = new Date().toISOString();
      const cancelled = await ensureProjectWorkspace('cancelled-project', root);
      await writeProjectManifest(cancelled, {
        slug: 'cancelled-project',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'failed',
      });
      await writeStageCheckpoint(cancelled, {
        stage: 'assets',
        status: 'failed',
        generatedAt: now,
        artifacts: {},
        summary: 'Execution cancelled by operator.',
        issues: ['Execution cancelled by operator.'],
        nextAction: 'Resolve the issue and resubmit execution when ready.',
      });

      const report = await buildNextActions(root);
      assert.equal(report.actions.length, 1);
      assert.equal(report.actions[0]?.slug, 'cancelled-project');
      assert.equal(report.actions[0]?.priority, 'high');
      assert.equal(report.actions[0]?.action, 'Resubmit execution or intentionally leave the run cancelled.');
      assert.equal(report.actions[0]?.reason, 'Execution cancelled by operator.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
