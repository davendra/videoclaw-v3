import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw execution-plan cli', () => {
  it('prints a blocked execution plan for an incomplete project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-exec-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execution-plan', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { plan?: { ready?: boolean; blockers?: string[]; promptGuidance?: Array<{ name?: string }> } };
      assert.equal(payload.plan?.ready, false);
      assert.ok(payload.plan?.blockers?.some((item) => item.includes('Missing required artifacts')));
      assert.ok(payload.plan?.promptGuidance?.some((entry) => entry.name === 'checkpoint-protocol'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks execution planning when storyboard character anchors are incomplete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-exec-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one', '--scene-character', '0:Nova'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:seedance'],
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
        [cliPath, 'video', 'execution-plan', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { plan?: { ready?: boolean; blockers?: string[] } };
      assert.equal(payload.plan?.ready, false);
      assert.ok(payload.plan?.blockers?.some((item) => item.includes('Characters missing reference assets: Nova')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports the lifecycle alias `video plan`', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-exec-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'plan', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { plan?: { ready?: boolean } };
      assert.equal(payload.plan?.ready, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
