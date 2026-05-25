import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw cost-estimate cli', () => {
  it('prints an estimate from direct flags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cost-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'cost-estimate', '--root', root, '--scenes', '14', '--clip-duration', '15', '--new-characters', '2', '--narration', 'on'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        estimate?: {
          sceneCount?: number;
          clipDurationSeconds?: number;
          totalUsd?: number;
          wallTimeMinutes?: number;
        };
      };
      assert.equal(payload.estimate?.sceneCount, 14);
      assert.equal(payload.estimate?.clipDurationSeconds, 15);
      assert.equal(payload.estimate?.totalUsd, 5.87);
      assert.equal(payload.estimate?.wallTimeMinutes, 61);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can derive an estimate from an existing project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cost-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'create', 'A lonely astronaut discovers an alien flower on Mars.', '--project', 'alpha', '--root', root, '--production-mode', 'director'],
        ['video', 'character-add', '--project', 'alpha', '--root', root, '--name', 'Nova'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'cost-estimate', '--project', 'alpha', '--root', root, '--narration', 'off'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        projectSlug?: string;
        estimate?: {
          sceneCount?: number;
          clipDurationSeconds?: number;
          newCharacterCount?: number;
          narrationEnabled?: boolean;
          totalUsd?: number;
        };
      };
      assert.equal(payload.projectSlug, 'alpha');
      assert.equal(payload.estimate?.sceneCount, 14);
      assert.equal(payload.estimate?.clipDurationSeconds, 15);
      assert.equal(payload.estimate?.newCharacterCount, 1);
      assert.equal(payload.estimate?.narrationEnabled, false);
      assert.equal(payload.estimate?.totalUsd, 5.68);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
