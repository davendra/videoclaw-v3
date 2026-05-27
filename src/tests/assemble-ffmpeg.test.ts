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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  runFfmpeg,
  resolveFfmpegBin,
  resolveFfprobeBin,
  ffprobeDuration,
  isValidMp4,
  STANDARD_VIDEO_ARGS,
  STANDARD_AUDIO_ARGS,
} from '../video/assemble/ffmpeg.js';

/** Is ffmpeg/ffprobe on PATH? Used to gate the one real-media sub-case. */
function ffmpegAvailable(): boolean {
  return (
    spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' }).status === 0 &&
    spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' }).status === 0
  );
}

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

describe('isValidMp4 — MP4 corruption guard (ported from _ffprobe_is_valid_mp4)', () => {
  // False-cases are deterministic and need no ffmpeg: ffprobe exits non-zero
  // (or the binary is absent → spawn error) and the guard resolves false.
  it('returns false for a non-existent path', async () => {
    assert.equal(await isValidMp4('/does/not/exist/nope.mp4'), false);
  });

  it('returns false for an empty / garbage file (no moov atom)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-validmp4-'));
    try {
      const junk = join(dir, 'junk.mp4');
      await writeFile(junk, Buffer.from('not-a-mp4!'), 'binary'); // 10 bytes of garbage
      assert.equal(await isValidMp4(junk), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns false quickly when the timeout is effectively immediate', async () => {
    // A 0ms timeout forces the kill-path before ffprobe could ever finish.
    assert.equal(await isValidMp4('/does/not/exist/nope.mp4', { timeoutMs: 0 }), false);
  });

  // Real valid-mp4 case requires ffmpeg to synthesize a tiny clip; skip if absent.
  it('returns true for a real 1s lavfi-generated mp4 (requires ffmpeg)', async (t) => {
    if (!ffmpegAvailable()) {
      t.skip('ffmpeg/ffprobe not on PATH');
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-validmp4-ok-'));
    try {
      const good = join(dir, 'good.mp4');
      const r = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=24:duration=1',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
          good,
        ],
        { encoding: 'utf-8' },
      );
      assert.equal(r.status, 0, `ffmpeg synth failed: ${r.stderr}`);
      assert.equal(await isValidMp4(good), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
