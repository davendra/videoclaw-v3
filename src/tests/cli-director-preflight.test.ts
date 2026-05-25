import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw director-preflight cli', () => {
  it('returns a failing report for storyboard hazards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-director-preflight-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--mode', 'director', '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--mode', 'director', '--scene', 'Scene one with a spectral blade.'],
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
        [cliPath, 'video', 'director-preflight', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 1);
      const payload = JSON.parse(result.stdout) as { result?: { pass?: boolean; errors?: Array<{ code?: string }> } };
      assert.equal(payload.result?.pass, false);
      assert.ok(payload.result?.errors?.some((item) => item.code === 'CONTENT_FILTER_HAZARD'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies content fixes and returns a passing report when hazards are rewritten', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-director-preflight-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--mode', 'director', '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--mode', 'director', '--scene', 'Scene one with a spectral blade and fires a gun.'],
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
        [cliPath, 'video', 'director-preflight', '--project', 'alpha', '--root', root, '--apply-content-fixes'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { applied?: { changeCount?: number } | null; result?: { pass?: boolean } };
      const storyboard = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'storyboard.json'), 'utf-8'),
      ) as { scenes?: Array<{ description?: string }> };

      assert.ok((payload.applied?.changeCount ?? 0) > 0);
      assert.equal(payload.result?.pass, true);
      assert.doesNotMatch(storyboard.scenes?.[0]?.description ?? '', /spectral blade/i);
      assert.doesNotMatch(storyboard.scenes?.[0]?.description ?? '', /fires a gun/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags role-collision when two sheets supply the same role on one scene', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-director-preflight-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'demo', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'demo', '--root', root, '--mode', 'director', '--title', 'T', '--intent', 'intent'],
        ['video', 'storyboard', '--project', 'demo', '--root', root, '--mode', 'director', '--scene', 'a', '--scene', 'b'],
        ['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'A', '--id', 'a', '--ref', 'refs/a.png:palette', '--binding', '1'],
        ['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'B', '--id', 'b', '--ref', 'refs/b.png:palette', '--binding', '1'],
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
        [cliPath, 'video', 'director-preflight', '--project', 'demo', '--root', root],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      const payload = JSON.parse(result.stdout) as {
        result?: { pass?: boolean; errors?: Array<{ code?: string; message?: string }> };
      };
      const codes = (payload.result?.errors ?? []).map((item) => item.code);
      assert.ok(codes.includes('role-collision'), `expected role-collision, got: ${codes.join(',')}`);
      assert.equal(payload.result?.pass, false);
      assert.equal(result.status, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
