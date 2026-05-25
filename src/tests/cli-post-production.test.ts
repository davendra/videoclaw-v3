import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0;

async function createFixtureProject(root: string): Promise<string> {
  const projectDir = join(root, 'projects', 'alpha');
  const finalDir = join(projectDir, 'final');
  await mkdir(finalDir, { recursive: true });
  const videoPath = join(finalDir, 'narrated-fixed.mp4');
  const makeVideo = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=320x240:d=1',
      '-f', 'lavfi',
      '-i', 'sine=frequency=1000:duration=1',
      '-shortest',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      videoPath,
    ],
    { encoding: 'utf-8' },
  );
  assert.equal(makeVideo.status, 0, makeVideo.stderr);
  return videoPath;
}

describe('vclaw post-production cli', { skip: ffmpegAvailable ? false : 'ffmpeg is not installed' }, () => {
  it('creates vertical and square variants from a project final output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-post-'));
    try {
      await createFixtureProject(root);
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

      const verticalResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'make-vertical', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(verticalResult.status, 0, verticalResult.stderr);
      const verticalPayload = JSON.parse(verticalResult.stdout) as {
        variant?: string;
        outputPath?: string;
        width?: number;
        height?: number;
      };
      assert.equal(verticalPayload.variant, 'vertical');
      assert.ok(existsSync(verticalPayload.outputPath ?? ''));
      assert.equal(verticalPayload.width, 1080);
      assert.equal(verticalPayload.height, 1920);

      const squareResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'make-square', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(squareResult.status, 0, squareResult.stderr);
      const squarePayload = JSON.parse(squareResult.stdout) as {
        variant?: string;
        outputPath?: string;
        width?: number;
        height?: number;
      };
      assert.equal(squarePayload.variant, 'square');
      assert.ok(existsSync(squarePayload.outputPath ?? ''));
      assert.equal(squarePayload.width, 1080);
      assert.equal(squarePayload.height, 1080);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates a reversible loop variant from a project final output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-post-'));
    try {
      await createFixtureProject(root);
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'make-loop', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        variant?: string;
        outputPath?: string;
        durationSeconds?: number;
        audioPresent?: boolean;
      };
      assert.equal(payload.variant, 'loop');
      assert.ok(existsSync(payload.outputPath ?? ''));
      assert.ok((payload.durationSeconds ?? 0) >= 1.8);
      assert.equal(payload.audioPresent, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates a thumbnail from a project final output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-post-'));
    try {
      await createFixtureProject(root);
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'thumbnail', '--project', 'alpha', '--root', root, '--text', 'Hook Line'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        outputPath?: string;
        timestampSeconds?: number;
        text?: string;
      };
      assert.ok(existsSync(payload.outputPath ?? ''));
      assert.ok((payload.timestampSeconds ?? 0) >= 0.4);
      assert.equal(payload.text, 'Hook Line');
      const thumbnail = await readFile(payload.outputPath!, 'utf-8').catch(() => null);
      assert.equal(thumbnail === null, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('burns subtitles into a project final output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-post-'));
    try {
      await createFixtureProject(root);
      const subtitlePath = join(root, 'alpha.srt');
      await (await import('node:fs/promises')).writeFile(
        subtitlePath,
        '1\n00:00:00,000 --> 00:00:00,800\nHook line\n',
      );
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'burn-subtitles', '--project', 'alpha', '--root', root, '--subtitle', subtitlePath],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        subtitlePath?: string;
        outputPath?: string;
        burnedIn?: boolean;
        audioPresent?: boolean;
      };
      assert.equal(payload.subtitlePath, subtitlePath);
      assert.ok(existsSync(payload.outputPath ?? ''));
      assert.match(payload.outputPath ?? '', /subtitled\.mp4$/);
      assert.equal(typeof payload.burnedIn, 'boolean');
      assert.equal(payload.audioPresent, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
