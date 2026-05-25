import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw character-consistency cli', () => {
  it('reports storyboard character gaps for a project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-character-consistency-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one', '--scene-character', '0:Nova', '--scene-character', '0:Ghost'],
        ['video', 'character-add', '--project', 'alpha', '--root', root, '--name', 'Nova'],
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
        [cliPath, 'video', 'character-consistency', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { ok?: boolean; missingProfiles?: string[]; missingReferenceAssets?: string[] };
      assert.equal(payload.ok, false);
      assert.deepEqual(payload.missingProfiles, ['Ghost']);
      assert.deepEqual(payload.missingReferenceAssets, ['Nova']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
