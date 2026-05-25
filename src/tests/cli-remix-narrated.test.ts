import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0;

describe('vclaw remix-narrated cli', { skip: ffmpegAvailable ? false : 'ffmpeg is not installed' }, () => {
  it('re-muxes per-clip narrated mp4 files into a clean final output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-remix-cli-'));
    try {
      const projectDir = join(root, 'projects', 'alpha');
      const videosDir = join(projectDir, 'videos');
      await mkdir(videosDir, { recursive: true });

      const makeClip = (output: string, seconds: string) => spawnSync(
        'ffmpeg',
        [
          '-y',
          '-f', 'lavfi',
          '-i', `color=c=black:s=320x240:d=${seconds}`,
          '-f', 'lavfi',
          '-i', `sine=frequency=1000:duration=${seconds}`,
          '-shortest',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          output,
        ],
        { encoding: 'utf-8' },
      );

      const clip1 = makeClip(join(videosDir, 'clip_01_narrated.mp4'), '1');
      const clip2 = makeClip(join(videosDir, 'clip_02_narrated.mp4'), '1');
      assert.equal(clip1.status, 0, clip1.stderr);
      assert.equal(clip2.status, 0, clip2.stderr);

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'remix-narrated', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        outputPath?: string;
        inputFiles?: string[];
        durationSeconds?: number;
      };

      assert.equal(payload.inputFiles?.length, 2);
      assert.match(payload.outputPath ?? '', /final\/narrated-fixed\.mp4$/);
      const outputStat = await readFile(payload.outputPath!, 'utf-8').catch(() => null);
      assert.equal(outputStat === null, false);
      assert.ok((payload.durationSeconds ?? 0) >= 1.9);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
