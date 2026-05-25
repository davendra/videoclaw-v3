import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
}

describe('vclaw readiness cli', () => {
  it('prints readiness for a project based on required artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const readinessResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'readiness', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(readinessResult.status, 0);
      const payload = JSON.parse(readinessResult.stdout) as { ready?: boolean; missingArtifacts?: string[] };
      assert.equal(payload.ready, false);
      assert.ok(payload.missingArtifacts?.includes('storyboard'));
      assert.ok(payload.missingArtifacts?.includes('asset-manifest'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes character consistency blockers in readiness output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-cli-'));
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

      const readinessResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'readiness', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(readinessResult.status, 0);
      const payload = JSON.parse(readinessResult.stdout) as { ready?: boolean; blockers?: string[]; characterConsistency?: { missingReferenceAssets?: string[] } };
      assert.equal(payload.ready, false);
      assert.deepEqual(payload.characterConsistency?.missingReferenceAssets, ['Nova']);
      assert.ok(payload.blockers?.some((item) => item.includes('Characters missing reference assets: Nova')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('director-mode readiness fails when a character-bound scene has no Identity Sheet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-refsheet-'));
    try {
      assert.equal(runCli(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
      assert.equal(runCli(['video', 'brief', '--project', 'demo', '--root', root, '--mode', 'director', '--title', 'T', '--intent', 'intent']).status, 0);
      assert.equal(runCli(['video', 'character-add', '--project', 'demo', '--root', root, '--name', 'Mochi', '--ref', 'refs/mochi.png']).status, 0);
      assert.equal(runCli(['video', 'storyboard', '--project', 'demo', '--root', root, '--mode', 'director', '--scene', 'open', '--scene-character', '0:Mochi']).status, 0);

      const res = runCli(['video', 'readiness', '--project', 'demo', '--root', root, '--mode', 'director']);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout) as { ready?: boolean; blockers?: string[] };
      assert.equal(payload.ready, false);
      assert.ok(
        payload.blockers?.some((item) => item.startsWith('reference-sheet-missing-identity')),
        `expected missing-identity blocker, got: ${(payload.blockers ?? []).join(' | ')}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('director-mode readiness passes the identity check when every character-bound scene has an Identity Sheet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-refsheet-'));
    try {
      assert.equal(runCli(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
      assert.equal(runCli(['video', 'brief', '--project', 'demo', '--root', root, '--mode', 'director', '--title', 'T', '--intent', 'intent']).status, 0);
      assert.equal(runCli(['video', 'character-add', '--project', 'demo', '--root', root, '--name', 'Mochi', '--ref', 'refs/mochi.png']).status, 0);
      assert.equal(runCli(['video', 'storyboard', '--project', 'demo', '--root', root, '--mode', 'director', '--scene', 'open', '--scene-character', '0:Mochi']).status, 0);
      assert.equal(
        runCli([
          'video', 'reference-sheet-add',
          '--project', 'demo', '--root', root,
          '--type', 'identity',
          '--name', 'Lead',
          '--character-name', 'Mochi',
          '--ref', 'refs/mochi.png:identity',
          '--binding', '0',
        ]).status,
        0,
      );

      const res = runCli(['video', 'readiness', '--project', 'demo', '--root', root, '--mode', 'director']);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout) as { blockers?: string[] };
      assert.ok(
        !(payload.blockers ?? []).some((item) => item.startsWith('reference-sheet-missing-identity')),
        `unexpected missing-identity blocker, got: ${(payload.blockers ?? []).join(' | ')}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('storyboard-mode readiness does not enforce the Identity Sheet requirement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-refsheet-'));
    try {
      assert.equal(runCli(['video', 'init', 'demo', '--root', root]).status, 0);
      assert.equal(runCli(['video', 'brief', '--project', 'demo', '--root', root, '--title', 'T', '--intent', 'intent']).status, 0);
      assert.equal(runCli(['video', 'character-add', '--project', 'demo', '--root', root, '--name', 'Mochi', '--ref', 'refs/mochi.png']).status, 0);
      assert.equal(runCli(['video', 'storyboard', '--project', 'demo', '--root', root, '--scene', 'open', '--scene-character', '0:Mochi']).status, 0);

      const res = runCli(['video', 'readiness', '--project', 'demo', '--root', root]);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout) as { blockers?: string[] };
      assert.ok(
        !(payload.blockers ?? []).some((item) => item.startsWith('reference-sheet-missing-identity')),
        `unexpected missing-identity blocker in storyboard-mode: ${(payload.blockers ?? []).join(' | ')}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
