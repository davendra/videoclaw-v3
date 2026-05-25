import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPortfolioTrendReport, listPortfolioReportSnapshots, writePortfolioReportSnapshot } from '../video/report-history.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

describe('portfolio report history', () => {
  it('writes snapshots and builds trend points', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-history-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
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
        join(workspace.projectDir, 'artifacts', 'brief.json'),
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
      await writeFile(
        join(workspace.projectDir, 'state', 'legacy-import-summary.json'),
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

      const first = await writePortfolioReportSnapshot(root);
      const second = await writePortfolioReportSnapshot(root);
      assert.ok(first.outputPath.endsWith('.json'));
      assert.ok(second.outputPath.endsWith('.json'));

      const history = await listPortfolioReportSnapshots(root);
      assert.equal(history.length, 2);
      assert.equal(history[0]?.totalProjects, 1);
      assert.equal(history[0]?.completedProjects, 0);
      assert.equal(history[0]?.warningProjects, 1);
      assert.equal(history[0]?.byPlatform?.tiktok, 1);
      assert.equal(history[0]?.legacyImportedProjects, 1);
      assert.equal(history[0]?.legacyQueueDriftProjects, 1);
      assert.equal(history[0]?.legacyNestedOutputProjects, 1);

      const trends = await buildPortfolioTrendReport(root);
      assert.equal(trends.points.length, 2);
      assert.equal(trends.points[0]?.totalProjects, 1);
      assert.equal(trends.points[0]?.warningProjects, 1);
      assert.equal(trends.points[0]?.byPlatform.tiktok, 1);
      assert.equal(trends.points[0]?.legacyImportedProjects, 1);
      assert.equal(trends.points[0]?.legacyQueueDriftProjects, 1);
      assert.equal(trends.points[0]?.legacyNestedOutputProjects, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
