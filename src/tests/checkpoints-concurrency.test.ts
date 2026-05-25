import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureProjectWorkspace } from '../video/workspace.js';
import { readStageCheckpoint, writeStageCheckpoint } from '../video/checkpoints.js';

describe('checkpoint concurrency', () => {
  it('keeps checkpoint JSON readable during concurrent writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-checkpoint-concurrency-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeStageCheckpoint(workspace, {
        stage: 'assets',
        status: 'pending',
        generatedAt: new Date().toISOString(),
        artifacts: {},
        summary: 'seed',
        issues: [],
      });

      let writersDone = false;
      const writerCount = 20;
      const writesPerWriter = 25;
      const writers = Array.from({ length: writerCount }, (_, writerIndex) => (async () => {
        for (let i = 0; i < writesPerWriter; i += 1) {
          await writeStageCheckpoint(workspace, {
            stage: 'assets',
            status: i % 2 === 0 ? 'completed' : 'failed',
            generatedAt: new Date().toISOString(),
            artifacts: { 'execution-report': `${workspace.artifactsDir}/execution-report.json` },
            summary: `writer-${writerIndex}-iteration-${i}`,
            issues: i % 2 === 0 ? [] : ['simulated issue'],
            nextAction: i % 2 === 0 ? 'advance' : 'retry',
          });
        }
      })());
      const writerCompletion = Promise.all(writers).then(() => {
        writersDone = true;
      });

      while (true) {
        const checkpoint = await readStageCheckpoint(workspace, 'assets');
        assert.ok(checkpoint, 'checkpoint should remain parseable');
        if (checkpoint) {
          assert.equal(checkpoint.stage, 'assets');
          assert.ok(checkpoint.generatedAt.length > 0);
        }
        if (writersDone) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
      }

      await writerCompletion;
      const finalCheckpoint = await readStageCheckpoint(workspace, 'assets');
      assert.ok(finalCheckpoint);
      assert.equal(finalCheckpoint?.stage, 'assets');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
