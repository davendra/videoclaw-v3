/**
 * Unit tests for the shared FFmpeg helper (sub-slice 3e).
 *
 * Scope: arg-shape / command-string + bin-resolution only. We DO NOT run
 * ffmpeg or ffprobe here — running them against real media is a human
 * integration checkpoint, out of scope. Every test uses the dry-run path or
 * the pure resolve helpers; none require ffmpeg installed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  runFfmpeg,
  resolveFfmpegBin,
  resolveFfprobeBin,
  ffprobeDuration,
  STANDARD_VIDEO_ARGS,
  STANDARD_AUDIO_ARGS,
} from '../video/assemble/ffmpeg.js';

const realFfmpegBin = process.env.VCLAW_FFMPEG_BIN;
const realFfprobeBin = process.env.VCLAW_FFPROBE_BIN;

afterEach(() => {
  if (realFfmpegBin === undefined) delete process.env.VCLAW_FFMPEG_BIN;
  else process.env.VCLAW_FFMPEG_BIN = realFfmpegBin;
  if (realFfprobeBin === undefined) delete process.env.VCLAW_FFPROBE_BIN;
  else process.env.VCLAW_FFPROBE_BIN = realFfprobeBin;
});

describe('STANDARD_*_ARGS encoding constants (Python parity)', () => {
  it('STANDARD_VIDEO_ARGS matches `-r 24 -c:v libx264 -preset fast -crf 20`', () => {
    assert.deepEqual(
      [...STANDARD_VIDEO_ARGS],
      ['-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20'],
    );
  });

  it('STANDARD_AUDIO_ARGS matches `-c:a aac -ar 44100 -ac 2`', () => {
    assert.deepEqual([...STANDARD_AUDIO_ARGS], ['-c:a', 'aac', '-ar', '44100', '-ac', '2']);
  });
});

describe('resolveFfmpegBin / resolveFfprobeBin', () => {
  it('defaults to `ffmpeg` / `ffprobe` when nothing is set', () => {
    delete process.env.VCLAW_FFMPEG_BIN;
    delete process.env.VCLAW_FFPROBE_BIN;
    assert.equal(resolveFfmpegBin(), 'ffmpeg');
    assert.equal(resolveFfprobeBin(), 'ffprobe');
  });

  it('honours the VCLAW_FFMPEG_BIN / VCLAW_FFPROBE_BIN env overrides', () => {
    process.env.VCLAW_FFMPEG_BIN = '/opt/custom/ffmpeg';
    process.env.VCLAW_FFPROBE_BIN = '/opt/custom/ffprobe';
    assert.equal(resolveFfmpegBin(), '/opt/custom/ffmpeg');
    assert.equal(resolveFfprobeBin(), '/opt/custom/ffprobe');
  });

  it('explicit arg beats the env override', () => {
    process.env.VCLAW_FFMPEG_BIN = '/opt/custom/ffmpeg';
    assert.equal(resolveFfmpegBin('/explicit/ffmpeg'), '/explicit/ffmpeg');
  });
});

describe('runFfmpeg dry-run (no spawn)', () => {
  it('returns the command string without spawning, prepending -y', async () => {
    delete process.env.VCLAW_FFMPEG_BIN;
    const res = await runFfmpeg(['-i', 'in.mp4', '-c:v', 'libx264', 'out.mp4'], {
      dryRun: true,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
    assert.equal(res.command, 'ffmpeg -y -i in.mp4 -c:v libx264 out.mp4');
  });

  it('respects the ffmpegBin option in the dry-run command string', async () => {
    const res = await runFfmpeg(['-i', 'in.mp4', 'out.mp4'], {
      dryRun: true,
      ffmpegBin: '/opt/ff/ffmpeg',
    });
    assert.equal(res.command, '/opt/ff/ffmpeg -y -i in.mp4 out.mp4');
  });

  it('respects VCLAW_FFMPEG_BIN in the dry-run command string', async () => {
    process.env.VCLAW_FFMPEG_BIN = '/env/ffmpeg';
    const res = await runFfmpeg(['-version'], { dryRun: true });
    assert.equal(res.command, '/env/ffmpeg -y -version');
  });

  it('quotes args containing whitespace for a copy-pasteable command', async () => {
    const res = await runFfmpeg(['-i', '/path/with space/in.mp4', 'out.mp4'], {
      dryRun: true,
      ffmpegBin: 'ffmpeg',
    });
    assert.match(res.command, /'\/path\/with space\/in\.mp4'/);
  });
});

describe('ffprobeDuration dry-run (no spawn)', () => {
  it('returns 0 without spawning when dryRun is set', async () => {
    const ms = await ffprobeDuration('/does/not/matter.mp4', { dryRun: true });
    assert.equal(ms, 0);
  });
});
