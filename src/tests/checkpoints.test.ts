import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { getNextStage, readStageCheckpoint, writeStageCheckpoint } from '../video/checkpoints.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('stage checkpoints', () => {
  it('returns the first incomplete stage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-checkpoints-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      const manifest = getBuiltinPipelineManifest('storyboard');
      assert.equal(await getNextStage(workspace, manifest), 'brief');

      await writeStageCheckpoint(workspace, {
        stage: 'brief',
        status: 'completed',
        generatedAt: new Date().toISOString(),
        artifacts: {},
        summary: 'brief done',
        issues: [],
      });

      assert.equal(await getNextStage(workspace, manifest), 'storyboard');
      const checkpoint = await readStageCheckpoint(workspace, 'brief');
      assert.equal(checkpoint?.status, 'completed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
