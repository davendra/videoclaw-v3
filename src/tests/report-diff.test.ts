import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendProjectEvent } from '../video/events.js';
import { buildPortfolioReportDiff } from '../video/report-diff.js';
import { writePortfolioReportSnapshot } from '../video/report-history.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';

describe('buildPortfolioReportDiff', () => {
  it('detects added projects and state changes between snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-diff-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
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

      const first = await writePortfolioReportSnapshot(root);

      const beta = await ensureProjectWorkspace('beta', root);
      await writeProjectManifest(beta, {
        slug: 'beta',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'brief',
        lastCompletedStage: null,
        lastCheckpointStatus: 'pending',
      });

      const second = await writePortfolioReportSnapshot(root);
      const diff = await buildPortfolioReportDiff(root, {
        fromPath: first.outputPath,
        toPath: second.outputPath,
      });

      assert.equal(diff.projectChanges.added.includes('beta'), true);
      assert.equal(diff.summary.totalProjectsDelta, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects review-state changes between snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-diff-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(alpha, {
        slug: 'alpha',
        productionMode: 'director',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'storyboard',
        lastCompletedStage: 'brief',
        lastCheckpointStatus: 'awaiting-approval',
      });
      await writeFile(join(alpha.projectDir, 'storyboard.md'), '# Review\n');

      const first = await writePortfolioReportSnapshot(root);

      await appendProjectEvent(alpha, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T10:00:00.000Z',
        payload: { markdownPath: join(alpha.projectDir, 'storyboard.md') },
      });
      await appendProjectEvent(alpha, {
        type: 'artifact.storyboard.written',
        recordedAt: '2026-04-20T11:00:00.000Z',
        payload: { artifactPath: join(alpha.projectDir, 'artifacts', 'storyboard.json') },
      });

      const second = await writePortfolioReportSnapshot(root);
      const diff = await buildPortfolioReportDiff(root, {
        fromPath: first.outputPath,
        toPath: second.outputPath,
      });

      assert.deepEqual(diff.projectChanges.reviewStateChanged, [
        { slug: 'alpha', from: 'missing', to: 'stale' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects platform changes between snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-diff-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
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
      await writeFile(
        join(alpha.projectDir, 'artifacts', 'brief.json'),
        JSON.stringify({
          title: 'Alpha',
          intent: 'Alpha intent',
          productionMode: 'storyboard',
          createdAt: now,
          metadata: {
            platform: 'youtube',
          },
        }, null, 2),
      );

      const first = await writePortfolioReportSnapshot(root);

      await writeFile(
        join(alpha.projectDir, 'artifacts', 'brief.json'),
        JSON.stringify({
          title: 'Alpha',
          intent: 'Alpha intent',
          productionMode: 'storyboard',
          createdAt: now,
          metadata: {
            platform: 'tiktok',
          },
        }, null, 2),
      );

      const second = await writePortfolioReportSnapshot(root);
      const diff = await buildPortfolioReportDiff(root, {
        fromPath: first.outputPath,
        toPath: second.outputPath,
      });

      assert.deepEqual(diff.projectChanges.platformChanged, [
        { slug: 'alpha', from: 'youtube', to: 'tiktok' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects execution-profile changes between snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-diff-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
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
      await writeFile(
        join(alpha.projectDir, 'artifacts', 'brief.json'),
        JSON.stringify({
          title: 'Alpha',
          intent: 'Alpha intent',
          productionMode: 'storyboard',
          createdAt: now,
          metadata: {
            executionProfile: {
              aspectRatio: '16:9',
              quality: 'fast',
            },
          },
        }, null, 2),
      );

      const first = await writePortfolioReportSnapshot(root);

      await writeFile(
        join(alpha.projectDir, 'artifacts', 'brief.json'),
        JSON.stringify({
          title: 'Alpha',
          intent: 'Alpha intent',
          productionMode: 'storyboard',
          createdAt: now,
          metadata: {
            executionProfile: {
              aspectRatio: '9:16',
              quality: 'quality',
              resolution: '1080p',
              generateAudio: false,
              outputCount: 2,
            },
          },
        }, null, 2),
      );

      const second = await writePortfolioReportSnapshot(root);
      const diff = await buildPortfolioReportDiff(root, {
        fromPath: first.outputPath,
        toPath: second.outputPath,
      });

      assert.deepEqual(diff.projectChanges.executionProfileChanged, [
        {
          slug: 'alpha',
          from: {
            aspectRatio: '16:9',
            quality: 'fast',
          },
          to: {
            aspectRatio: '9:16',
            quality: 'quality',
            resolution: '1080p',
            generateAudio: false,
            outputCount: 2,
          },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects target runtime and clip-duration changes between snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-diff-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(alpha, {
        slug: 'alpha',
        productionMode: 'director',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'brief',
        lastCompletedStage: null,
        lastCheckpointStatus: 'pending',
      });
      await writeFile(
        join(alpha.projectDir, 'artifacts', 'brief.json'),
        JSON.stringify({
          title: 'Alpha',
          intent: 'Alpha intent',
          productionMode: 'director',
          createdAt: now,
          metadata: {
            genre: 'sci-fi',
          },
        }, null, 2),
      );

      const first = await writePortfolioReportSnapshot(root);

      await writeFile(
        join(alpha.projectDir, 'artifacts', 'brief.json'),
        JSON.stringify({
          title: 'Alpha',
          intent: 'Alpha intent',
          productionMode: 'director',
          createdAt: now,
          metadata: {
            genre: 'sci-fi',
            targetRuntimeSeconds: 90,
            clipDurationSeconds: 10,
          },
        }, null, 2),
      );

      const second = await writePortfolioReportSnapshot(root);
      const diff = await buildPortfolioReportDiff(root, {
        fromPath: first.outputPath,
        toPath: second.outputPath,
      });

      assert.deepEqual(diff.projectChanges.targetRuntimeChanged, [
        { slug: 'alpha', from: null, to: 90 },
      ]);
      assert.deepEqual(diff.projectChanges.clipDurationChanged, [
        { slug: 'alpha', from: null, to: 10 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects legacy import changes between snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-diff-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
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
      await writeFile(
        join(alpha.projectDir, 'state', 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/legacy-alpha',
          importedAt: now,
          imageCount: 1,
          videoCount: 0,
          finalCount: 0,
          telemetryCount: 0,
          manifestPresent: true,
          queueFilePresent: true,
          queuePendingStatusDetected: true,
          queueStatusMismatch: false,
          nestedVideoCount: 0,
          nestedFinalCount: 0,
          nestedOutputRootDetected: false,
          inferredCurrentStage: 'assets',
          inferredLastCompletedStage: 'storyboard',
          inferredCheckpointStatus: 'completed',
        }, null, 2),
      );

      const first = await writePortfolioReportSnapshot(root);

      await writeFile(
        join(alpha.projectDir, 'state', 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/legacy-alpha',
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

      const second = await writePortfolioReportSnapshot(root);
      const diff = await buildPortfolioReportDiff(root, {
        fromPath: first.outputPath,
        toPath: second.outputPath,
      });

      assert.deepEqual(diff.projectChanges.legacyImportChanged, [
        {
          slug: 'alpha',
          from: {
            manifestPresent: true,
            queueFilePresent: true,
            queueStatusMismatch: false,
            nestedOutputRootDetected: false,
          },
          to: {
            manifestPresent: true,
            queueFilePresent: true,
            queueStatusMismatch: true,
            nestedOutputRootDetected: true,
          },
        },
      ]);
      assert.equal(diff.summary.warningProjectsDelta, 1);
      assert.equal(diff.summary.legacyImportedProjectsDelta, 0);
      assert.equal(diff.summary.legacyQueueDriftProjectsDelta, 1);
      assert.equal(diff.summary.legacyNestedOutputProjectsDelta, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
