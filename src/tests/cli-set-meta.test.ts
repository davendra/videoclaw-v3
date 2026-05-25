import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw set-meta cli', () => {
  it('updates project metadata for owner, priority, due date, and tags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-meta-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const setMetaResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'set-meta',
          '--project',
          'alpha',
          '--root',
          root,
          '--owner',
          'davendra',
          '--priority',
          'high',
          '--due',
          '2026-05-01',
          '--tag',
          'launch',
          '--tag',
          'priority',
          '--blocked-by',
          'beta',
          '--blocked-reason',
          'Waiting on beta assets'
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(setMetaResult.status, 0);
      const manifest = JSON.parse(await readFile(join(root, 'projects', 'alpha', 'project.json'), 'utf-8')) as {
        owner?: string;
        priority?: string;
        dueDate?: string;
        tags?: string[];
        blockedBy?: string[];
        blockedReason?: string;
      };
      assert.equal(manifest.owner, 'davendra');
      assert.equal(manifest.priority, 'high');
      assert.equal(manifest.dueDate, '2026-05-01');
      assert.deepEqual(manifest.tags, ['launch', 'priority']);
      assert.deepEqual(manifest.blockedBy, ['beta']);
      assert.equal(manifest.blockedReason, 'Waiting on beta assets');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
