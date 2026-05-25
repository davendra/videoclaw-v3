import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw storyboard-review cli', () => {
  it('writes storyboard.md without running execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-review-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'character-add', '--project', 'alpha', '--root', root, '--name', 'Nova', '--gb-id', '170', '--ref', 'refs/nova.png'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--mode', 'director', '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--mode', 'director', '--scene', 'Scene one', '--scene-character', '0:Nova'],
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
        [cliPath, 'video', 'storyboard-review', '--project', 'alpha', '--root', root, '--mode', 'director'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { review?: { markdownPath?: string }; preflight?: { pass?: boolean } };
      const markdown = await readFile(payload.review?.markdownPath!, 'utf-8');
      const checkpoint = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'checkpoints', 'storyboard.json'), 'utf-8'),
      ) as { status?: string; nextAction?: string };

      assert.equal(payload.preflight?.pass, true);
      assert.match(markdown, /# Storyboard Review - Alpha/);
      assert.match(markdown, /\| Nova \| 170 \| refs\/nova\.png \|/);
      assert.equal(checkpoint.status, 'awaiting-approval');
      assert.match(checkpoint.nextAction ?? '', /storyboard\.md/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can apply content fixes during storyboard review generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-review-cli-'));
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
        [cliPath, 'video', 'storyboard-review', '--project', 'alpha', '--root', root, '--apply-content-fixes'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        applied?: { changeCount?: number } | null;
        review?: { markdownPath?: string };
        preflight?: { pass?: boolean };
      };
      const markdown = await readFile(payload.review?.markdownPath!, 'utf-8');
      const checkpoint = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'checkpoints', 'storyboard.json'), 'utf-8'),
      ) as { status?: string };

      assert.ok((payload.applied?.changeCount ?? 0) > 0);
      assert.equal(payload.preflight?.pass, true);
      assert.doesNotMatch(markdown, /spectral blade/i);
      assert.doesNotMatch(markdown, /fires a gun/i);
      assert.equal(checkpoint.status, 'awaiting-approval');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes a Reference sheets section when sheets exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-md-refsheet-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'demo', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'demo', '--root', root, '--title', 'T', '--intent', 'x'],
        ['video', 'storyboard', '--project', 'demo', '--root', root, '--scene', 'open'],
        ['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'Dusk', '--ref', 'refs/dusk.png:palette', '--binding', '0'],
        ['video', 'storyboard-review', '--project', 'demo', '--root', root, '--mode', 'director'],
      ];
      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: process.cwd(), encoding: 'utf-8' });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const md = await readFile(join(root, 'projects', 'demo', 'storyboard.md'), 'utf-8');
      assert.match(md, /Reference sheets/i);
      assert.match(md, /Dusk/);
      assert.match(md, /palette/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('defaults storyboard-review mode from project manifest when --mode is omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-review-default-mode-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'story-a', '--root', root, '--mode', 'storyboard'],
        ['video', 'brief', '--project', 'story-a', '--root', root, '--title', 'Story A', '--intent', 'Storyboard mode intent'],
        ['video', 'storyboard', '--project', 'story-a', '--root', root, '--scene', 'One storyboard scene'],
      ];
      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: process.cwd(), encoding: 'utf-8' });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const review = spawnSync(
        process.execPath,
        [cliPath, 'video', 'storyboard-review', '--project', 'story-a', '--root', root],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(review.status, 0, review.stderr);
      const payload = JSON.parse(review.stdout) as { plan?: { productionMode?: string } };
      assert.equal(payload.plan?.productionMode, 'storyboard');

      const checkpoint = JSON.parse(
        await readFile(join(root, 'projects', 'story-a', 'checkpoints', 'storyboard.json'), 'utf-8'),
      ) as { status?: string };
      assert.equal(checkpoint.status, 'completed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
