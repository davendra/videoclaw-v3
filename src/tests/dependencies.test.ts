import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDependencyReport } from '../video/dependencies.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

describe('buildDependencyReport', () => {
  it('builds dependency edges from blockedBy metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-deps-'));
    try {
      const now = new Date().toISOString();
      const alpha = await ensureProjectWorkspace('alpha', root);
      const beta = await ensureProjectWorkspace('beta', root);

      await writeProjectManifest(alpha, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
        blockedBy: ['beta'],
        blockedReason: 'Waiting on beta assets.',
      });

      await writeProjectManifest(beta, {
        slug: 'beta',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'review',
        lastCompletedStage: 'assets',
        lastCheckpointStatus: 'completed',
      });

      const report = await buildDependencyReport(root);
      assert.equal(report.edges.length, 1);
      assert.equal(report.edges[0]?.from, 'alpha');
      assert.equal(report.edges[0]?.to, 'beta');
      assert.deepEqual(report.blockedProjects, ['alpha']);
      assert.deepEqual(report.blockerProjects, ['beta']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
