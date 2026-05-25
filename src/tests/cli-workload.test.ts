import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw workload cli', () => {
  it('prints owner workload JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-workload-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'set-meta', '--project', 'alpha', '--root', root, '--owner', 'davendra'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok']
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'workload', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { owners?: Array<{ owner?: string; totalProjects?: number; byPlatform?: Record<string, number> }> };
      assert.equal(payload.owners?.[0]?.owner, 'davendra');
      assert.equal(payload.owners?.[0]?.totalProjects, 1);
      assert.equal(payload.owners?.[0]?.byPlatform?.tiktok, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
