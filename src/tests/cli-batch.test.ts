import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('cli batch-status', () => {
  it('prints the queue-state rollup from a hand-written batch-queue.json (no network)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-batch-'));
    const outDir = join(root, 'out');
    await mkdir(outDir, { recursive: true });
    const state = {
      schemaVersion: 1,
      externalJobId: 'runway-useapi-555',
      route: 'runway-useapi',
      outputDir: outDir,
      workspaceRoot: root,
      submittedAt: '2026-05-29T00:00:00.000Z',
      jobs: [
        { id: 'alpha', sceneIndex: 0, taskId: 't0', status: 'done', clipPath: join(outDir, 'clips', 'alpha.mp4') },
        { id: 'bravo', sceneIndex: 1, taskId: 't1', status: 'pending' },
        { id: 'charlie', sceneIndex: 2, taskId: 't2', status: 'failed', error: 'boom' },
      ],
    };
    await writeFile(join(outDir, 'batch-queue.json'), `${JSON.stringify(state, null, 2)}\n`);

    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
    const result = spawnSync(process.execPath, [cliPath, 'video', 'batch-status', '--out', outDir], {
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      externalJobId: string;
      route: string;
      rollup: { total: number; done: number; pending: number; failed: number; terminal: boolean };
      jobs: Array<{ id: string; status: string }>;
    };
    assert.equal(parsed.externalJobId, 'runway-useapi-555');
    assert.equal(parsed.route, 'runway-useapi');
    assert.equal(parsed.rollup.total, 3);
    assert.equal(parsed.rollup.done, 1);
    assert.equal(parsed.rollup.pending, 1);
    assert.equal(parsed.rollup.failed, 1);
    assert.equal(parsed.rollup.terminal, false);
    assert.equal(parsed.jobs.length, 3);
  });

  it('batch-status errors cleanly when no queue-state exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-batch-missing-'));
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
    const result = spawnSync(process.execPath, [cliPath, 'video', 'batch-status', '--out', root], {
      encoding: 'utf-8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /batch-queue\.json/i);
  });
});
