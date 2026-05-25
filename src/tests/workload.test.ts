import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildOwnerWorkloadReport } from '../video/workload.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';

describe('buildOwnerWorkloadReport', () => {
  it('groups projects by owner and computes workload counters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-workload-'));
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
        owner: 'davendra',
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });
      await writeProjectManifest(beta, {
        slug: 'beta',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        owner: 'davendra',
        dueDate: '2026-04-21',
        currentStage: 'review',
        lastCompletedStage: 'assets',
        lastCheckpointStatus: 'completed',
      });

      const report = await buildOwnerWorkloadReport(root);
      assert.equal(report.owners.length, 1);
      assert.equal(report.owners[0]?.owner, 'davendra');
      assert.equal(report.owners[0]?.totalProjects, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
