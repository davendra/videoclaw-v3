import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0;

describe('vclaw verify-final cli', { skip: ffmpegAvailable ? false : 'ffmpeg is not installed' }, () => {
  it('verifies a final project output and extracts a midpoint frame', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-verify-final-'));
    try {
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

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'verify-final', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        projectSlug?: string;
        sourcePath?: string;
        durationSeconds?: number;
        videoCodec?: string;
        width?: number;
        height?: number;
        audioPresent?: boolean;
        audioCodec?: string;
        framePath?: string;
      };

      assert.equal(payload.projectSlug, 'alpha');
      assert.equal(payload.sourcePath, videoPath);
      assert.ok((payload.durationSeconds ?? 0) >= 0.9);
      assert.equal(payload.videoCodec, 'h264');
      assert.equal(payload.width, 320);
      assert.equal(payload.height, 240);
      assert.equal(payload.audioPresent, true);
      assert.equal(payload.audioCodec, 'aac');
      const frame = await readFile(payload.framePath!, 'utf-8').catch(() => null);
      assert.equal(frame === null, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('verifies a published project output from publish-report finalOutputPath when final directory is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-verify-final-publish-report-'));
    try {
      const projectDir = join(root, 'projects', 'alpha');
      const artifactsDir = join(projectDir, 'artifacts');
      await mkdir(artifactsDir, { recursive: true });

      const publishedVideoPath = join(root, 'published', 'alpha-final.mp4');
      await mkdir(join(root, 'published'), { recursive: true });
      const makeVideo = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-f', 'lavfi',
          '-i', 'color=c=black:s=320x240:d=1',
          '-f', 'lavfi',
          '-i', 'sine=frequency=800:duration=1',
          '-shortest',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          publishedVideoPath,
        ],
        { encoding: 'utf-8' },
      );
      assert.equal(makeVideo.status, 0, makeVideo.stderr);

      await writeFile(
        join(artifactsDir, 'publish-report.json'),
        `${JSON.stringify({
          projectSlug: 'alpha',
          status: 'ready',
          finalOutputPath: publishedVideoPath,
          generatedAt: new Date().toISOString(),
        }, null, 2)}\n`,
      );

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'verify-final', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        projectSlug?: string;
        sourcePath?: string;
        audioPresent?: boolean;
        framePath?: string;
      };

      assert.equal(payload.projectSlug, 'alpha');
      assert.equal(payload.sourcePath, publishedVideoPath);
      assert.equal(payload.audioPresent, true);
      const frame = await readFile(payload.framePath!, 'utf-8').catch(() => null);
      assert.equal(frame === null, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
