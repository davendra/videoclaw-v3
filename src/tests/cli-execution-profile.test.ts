import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw set-execution-profile cli', () => {
  it('updates execution profile overrides on the brief artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-profile-'));
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

      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'set-execution-profile',
          '--project',
          'alpha',
          '--root',
          root,
          '--aspect-ratio',
          '9:16',
          '--quality',
          'quality',
          '--resolution',
          '1080p',
          '--audio',
          'off',
          '--outputs',
          '2',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { brief?: { metadata?: { executionProfile?: { aspectRatio?: string; quality?: string; resolution?: string; generateAudio?: boolean; outputCount?: number } } } };
      assert.equal(payload.brief?.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(payload.brief?.metadata?.executionProfile?.quality, 'quality');
      assert.equal(payload.brief?.metadata?.executionProfile?.resolution, '1080p');
      assert.equal(payload.brief?.metadata?.executionProfile?.generateAudio, false);
      assert.equal(payload.brief?.metadata?.executionProfile?.outputCount, 2);

      const briefArtifact = JSON.parse(await readFile(join(root, 'projects', 'alpha', 'artifacts', 'brief.json'), 'utf-8')) as {
        metadata?: { executionProfile?: { aspectRatio?: string; quality?: string; resolution?: string; generateAudio?: boolean; outputCount?: number } };
      };
      assert.equal(briefArtifact.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(briefArtifact.metadata?.executionProfile?.quality, 'quality');
      assert.equal(briefArtifact.metadata?.executionProfile?.resolution, '1080p');
      assert.equal(briefArtifact.metadata?.executionProfile?.generateAudio, false);
      assert.equal(briefArtifact.metadata?.executionProfile?.outputCount, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
