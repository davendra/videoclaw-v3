import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw storyboard-still-add cli', () => {
  it('records a generated image URL as a completed image candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-still-add-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'storyboard-still-add',
          '--project',
          'alpha',
          '--root',
          root,
          '--scene',
          '0',
          '--image-url',
          'https://example.com/still.jpg',
          '--image-id',
          '6636',
          '--prompt',
          'Create a cinematic storyboard still.',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        candidate?: { id?: string; outputs?: Array<{ kind?: string; path?: string }> };
      };
      assert.equal(payload.candidate?.id, 'scene-0-take-1');
      assert.equal(payload.candidate?.outputs?.[0]?.kind, 'image');

      const artifact = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'scene-candidates.json'), 'utf-8'),
      ) as { scenes?: Array<{ candidates?: Array<{ source?: { externalJobId?: string } }> }> };
      assert.equal(artifact.scenes?.[0]?.candidates?.[0]?.source?.externalJobId, '6636');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
