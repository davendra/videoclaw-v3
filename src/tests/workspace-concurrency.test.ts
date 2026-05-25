import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import {
  ensureProjectWorkspace,
  readProjectManifest,
  updateProjectManifestState,
  writeProjectManifest,
} from '../video/workspace.js';

describe('workspace manifest concurrency', () => {
  it('keeps project manifest readable during concurrent state updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-workspace-concurrency-'));
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

      const writerCount = 30;
      const writesPerWriter = 20;
      let writersDone = false;
      const writers = Array.from({ length: writerCount }, (_, writerIndex) => (async () => {
        for (let i = 0; i < writesPerWriter; i += 1) {
          const stage = i % 2 === 0 ? 'assets' : 'review';
          await updateProjectManifestState(workspace, {
            currentStage: stage,
            lastCompletedStage: stage === 'assets' ? 'storyboard' : 'assets',
            lastCheckpointStatus: i % 3 === 0 ? 'failed' : 'completed',
          });
        }
        return writerIndex;
      })());
      const writerCompletion = Promise.all(writers).then(() => {
        writersDone = true;
      });

      while (true) {
        const manifest = await readProjectManifest(workspace);
        assert.ok(manifest, 'manifest should always be readable');
        if (manifest) {
          assert.equal(manifest.slug, 'alpha');
          assert.ok(manifest.updatedAt.length > 0);
        }
        if (writersDone) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
      }

      await writerCompletion;
      const finalManifest = await readProjectManifest(workspace);
      assert.ok(finalManifest);
      assert.equal(finalManifest?.slug, 'alpha');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
