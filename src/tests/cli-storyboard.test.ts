import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw storyboard cli', () => {
  it('writes a storyboard artifact and advances status after brief', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const briefResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(briefResult.status, 0);

      const storyboardResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'storyboard',
          '--project',
          'launch-teaser',
          '--root',
          root,
          '--scene',
          'Cold open on the product silhouette.',
          '--scene-character',
          '0:Nova',
          '--scene',
          'Fast reveal with dramatic closeup.',
          '--scene-character',
          '1:Nova',
          '--scene',
          'Final CTA over hero shot.'
        ],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(storyboardResult.status, 0);

      const storyboardPayload = JSON.parse(storyboardResult.stdout) as { artifactPath?: string };
      const storyboard = JSON.parse(await readFile(storyboardPayload.artifactPath!, 'utf-8')) as { scenes?: Array<{ description?: string; characters?: string[] }> };
      assert.equal(storyboard.scenes?.length, 3);
      assert.equal(storyboard.scenes?.[0]?.description, 'Cold open on the product silhouette.');
      assert.deepEqual(storyboard.scenes?.[0]?.characters, ['Nova']);
      assert.deepEqual(storyboard.scenes?.[1]?.characters, ['Nova']);

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'launch-teaser', '--root', root],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(statusResult.status, 0);
      const statusPayload = JSON.parse(statusResult.stdout) as { completedStages?: string[]; nextStage?: string };
      assert.deepEqual(statusPayload.completedStages, ['brief', 'storyboard']);
      assert.equal(statusPayload.nextStage, 'assets');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can materialize a storyboard from a built-in storyboard template', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-template-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const briefResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(briefResult.status, 0);

      const storyboardResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'storyboard',
          '--project',
          'launch-teaser',
          '--root',
          root,
          '--template',
          'product-story',
          '--environment',
          'a polished product showroom',
          '--character-a',
          'Nova',
        ],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(storyboardResult.status, 0, storyboardResult.stderr);

      const storyboardPayload = JSON.parse(storyboardResult.stdout) as { artifactPath?: string };
      const storyboard = JSON.parse(await readFile(storyboardPayload.artifactPath!, 'utf-8')) as { scenes?: Array<{ description?: string }> };
      assert.equal(storyboard.scenes?.length, 9);
      assert.match(storyboard.scenes?.[0]?.description ?? '', /Nova/);
      assert.match(storyboard.scenes?.[0]?.description ?? '', /showroom/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks storyboard when the brief stage has not completed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-blocked-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const storyboardResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'storyboard',
          '--project',
          'launch-teaser',
          '--root',
          root,
          '--scene',
          'Cold open on the product silhouette.'
        ],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );

      assert.notEqual(storyboardResult.status, 0);
      assert.match(storyboardResult.stderr, /blocked/i);
      assert.match(storyboardResult.stderr, /brief/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
