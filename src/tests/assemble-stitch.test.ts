/**
 * Unit tests for the stitch keystone (sub-slice 3h).
 *
 * Scope: arg-shape only. The pure builders (`buildConcatDemuxerArgs`,
 * `buildConcatFilterArgs`, `buildMusicMixArgs`) are asserted against the
 * verbatim FFmpeg invocations from stitch_bunty.py / ffmpeg_wrapper.py /
 * assembly_utils.py. `stitch` is exercised via its DRY-RUN path only — we assert
 * the planned command sequence and the demuxer/filter selection threshold.
 *
 * We DO NOT run ffmpeg, do NOT write concat lists, and do NOT require any media
 * files. Whether the final MP4 looks/sounds right is a HUMAN integration
 * checkpoint, explicitly out of scope. Deterministic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve as resolvePath, join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  stitch,
  orderedSegments,
  selectConcatStrategy,
  buildConcatListContent,
  buildConcatDemuxerArgs,
  buildConcatFilterArgs,
  buildMusicMixArgs,
  FILTER_FALLBACK_SEGMENT_THRESHOLD,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_MUSIC_FADE_OUT_SEC,
  type StitchInput,
} from '../video/assemble/stitch.js';

/** Locate the value following a flag token in an args array. */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('buildConcatDemuxerArgs (primary path)', () => {
  const args = buildConcatDemuxerArgs(
    ['/proj/final/segments/seg_slide_01.mp4', '/proj/final/segments/seg_slide_02.mp4'],
    '/proj/final/segments/concat.txt',
    '/proj/final/out.mp4',
  );

  it('matches stitch_bunty._concat_via_demuxer: -f concat -safe 0 -i list -c copy out', () => {
    assert.deepEqual(args, [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '/proj/final/segments/concat.txt',
      '-c',
      'copy',
      '/proj/final/out.mp4',
    ]);
  });

  it('does NOT include -y (runFfmpeg prepends it)', () => {
    assert.ok(!args.includes('-y'));
  });

  it('uses -c copy (no re-encode) — preserves exact AV timing', () => {
    assert.equal(valueAfter(args, '-c'), 'copy');
  });

  it('is a single invocation regardless of segment count (survives sandbox limit)', () => {
    const many = buildConcatDemuxerArgs(
      Array.from({ length: 25 }, (_, i) => `/proj/seg_${i}.mp4`),
      '/proj/concat.txt',
      '/proj/out.mp4',
    );
    // Demuxer always references the single concat list — no per-segment -i.
    assert.equal(many.filter((a) => a === '-i').length, 1);
    assert.equal(valueAfter(many, '-i'), '/proj/concat.txt');
    assert.equal(many.length, args.length);
  });
});

describe('buildConcatListContent', () => {
  it("emits one `file '<abspath>'` line per segment, newline-terminated", () => {
    const content = buildConcatListContent(['a/seg1.mp4', 'b/seg2.mp4']);
    assert.equal(
      content,
      `file '${resolvePath('a/seg1.mp4')}'\nfile '${resolvePath('b/seg2.mp4')}'\n`,
    );
  });
});

describe('buildConcatFilterArgs (fallback path)', () => {
  const segs = ['/p/seg_01.mp4', '/p/seg_02.mp4', '/p/seg_03.mp4'];
  const args = buildConcatFilterArgs(segs, '/p/out.mp4');

  it('passes each segment as its own -i input', () => {
    assert.equal(args.filter((a) => a === '-i').length, 3);
    assert.equal(args[0], '-i');
    assert.equal(args[1], '/p/seg_01.mp4');
  });

  it('builds the verbatim concat filter_complex [i:v][i:a]...concat=n=N:v=1:a=1[outv][outa]', () => {
    const fc = valueAfter(args, '-filter_complex');
    assert.equal(fc, '[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[outv][outa]');
  });

  it('maps [outv] + [outa] and re-encodes h264 preset fast crf20 + aac 192k 44100 stereo', () => {
    const mapIdxs = args.reduce<number[]>((acc, a, i) => (a === '-map' ? [...acc, i] : acc), []);
    assert.equal(args[mapIdxs[0] + 1], '[outv]');
    assert.equal(args[mapIdxs[1] + 1], '[outa]');
    assert.equal(valueAfter(args, '-c:v'), 'libx264');
    assert.equal(valueAfter(args, '-preset'), 'fast');
    assert.equal(valueAfter(args, '-crf'), '20');
    assert.equal(valueAfter(args, '-c:a'), 'aac');
    assert.equal(valueAfter(args, '-b:a'), '192k');
    assert.equal(valueAfter(args, '-ar'), '44100');
    assert.equal(valueAfter(args, '-ac'), '2');
    assert.equal(valueAfter(args, '-movflags'), '+faststart');
  });

  it('ends with the output path', () => {
    assert.equal(args[args.length - 1], '/p/out.mp4');
  });

  it('honors crf/audioBitrate/sampleRate/channels overrides', () => {
    const a = buildConcatFilterArgs(segs, '/p/out.mp4', {
      crf: 18,
      audioBitrate: '256k',
      sampleRate: 48000,
      channels: 1,
    });
    assert.equal(valueAfter(a, '-crf'), '18');
    assert.equal(valueAfter(a, '-b:a'), '256k');
    assert.equal(valueAfter(a, '-ar'), '48000');
    assert.equal(valueAfter(a, '-ac'), '1');
  });
});

describe('buildMusicMixArgs', () => {
  const args = buildMusicMixArgs('/p/concat.mp4', '/p/music.mp3', '/p/final.mp4', {
    totalDurationSec: 120,
  });

  it('takes the video then loops the music (-stream_loop -1) as the second input', () => {
    assert.equal(args[0], '-i');
    assert.equal(args[1], '/p/concat.mp4');
    assert.equal(args[2], '-stream_loop');
    assert.equal(args[3], '-1');
    assert.equal(args[4], '-i');
    assert.equal(args[5], '/p/music.mp3');
  });

  it('builds the verbatim amix filter: narration at 1.0, music ducked + tail fade', () => {
    const fc = valueAfter(args, '-filter_complex');
    // fade_start = 120 - 3 = 117.00 ; default volume 0.05 ; default fade 3
    assert.equal(
      fc,
      '[0:a]volume=1.0[v];' +
        '[1:a]volume=0.05,afade=t=out:st=117.00:d=3[m];' +
        '[v][m]amix=inputs=2:duration=first:dropout_transition=600:normalize=0[a]',
    );
  });

  it('copies video, re-encodes audio aac 192k, caps with -t total', () => {
    assert.equal(valueAfter(args, '-c:v'), 'copy');
    assert.equal(valueAfter(args, '-c:a'), 'aac');
    assert.equal(valueAfter(args, '-b:a'), '192k');
    assert.equal(valueAfter(args, '-movflags'), '+faststart');
    assert.equal(valueAfter(args, '-t'), '120.000');
    assert.equal(args[args.length - 1], '/p/final.mp4');
  });

  it('maps the original video stream + the mixed audio', () => {
    const mapIdxs = args.reduce<number[]>((acc, a, i) => (a === '-map' ? [...acc, i] : acc), []);
    assert.equal(args[mapIdxs[0] + 1], '0:v');
    assert.equal(args[mapIdxs[1] + 1], '[a]');
  });

  it('clamps fade-start to 0 when total < fadeOut', () => {
    const a = buildMusicMixArgs('/p/c.mp4', '/p/m.mp3', '/p/o.mp4', {
      totalDurationSec: 1,
      fadeOutSec: 3,
    });
    const fc = valueAfter(a, '-filter_complex')!;
    assert.ok(fc.includes('afade=t=out:st=0.00:d=3'));
  });

  it('honors a custom volume', () => {
    const a = buildMusicMixArgs('/p/c.mp4', '/p/m.mp3', '/p/o.mp4', {
      totalDurationSec: 60,
      volume: 0.1,
    });
    assert.ok(valueAfter(a, '-filter_complex')!.includes('volume=0.1,afade'));
  });

  it('exposes the proven defaults', () => {
    assert.equal(DEFAULT_MUSIC_VOLUME, 0.05);
    assert.equal(DEFAULT_MUSIC_FADE_OUT_SEC, 3.0);
  });
});

describe('orderedSegments + selectConcatStrategy', () => {
  it('orders intro + body + outro', () => {
    const segs = orderedSegments({
      intro: ['/i1.mp4', '/i2.mp4'],
      segments: ['/s1.mp4', '/s2.mp4'],
      outro: ['/o1.mp4'],
      outputPath: '/out.mp4',
    });
    assert.deepEqual(segs, ['/i1.mp4', '/i2.mp4', '/s1.mp4', '/s2.mp4', '/o1.mp4']);
  });

  it('honors explicit demuxer/filter strategy regardless of count', () => {
    assert.equal(selectConcatStrategy('demuxer', 50), 'demuxer');
    assert.equal(selectConcatStrategy('filter', 1), 'filter');
  });

  it('auto flips demuxer→filter at the segment-count threshold (8)', () => {
    assert.equal(FILTER_FALLBACK_SEGMENT_THRESHOLD, 8);
    assert.equal(selectConcatStrategy('auto', 7), 'demuxer');
    assert.equal(selectConcatStrategy('auto', 8), 'filter');
    assert.equal(selectConcatStrategy('auto', 20), 'filter');
  });
});

describe('stitch dry-run — no music, small project (demuxer)', () => {
  const input: StitchInput = {
    intro: ['/p/seg_intro_0.mp4'],
    segments: ['/p/seg_slide_01.mp4', '/p/seg_slide_02.mp4'],
    outro: ['/p/seg_outro_0.mp4'],
    outputPath: '/p/final/out.mp4',
  };

  it('plans a single concat-demuxer step (4 segments < threshold) and reports dry-run', async () => {
    const res = await stitch(input, { dryRun: true });
    assert.equal(res.status, 'dry-run');
    assert.equal(res.concatStrategy, 'demuxer');
    assert.equal(res.music, false);
    assert.equal(res.durationMs, 0);
    assert.equal(res.plan.length, 1);
    assert.equal(res.plan[0].kind, 'concat-demuxer');
    assert.deepEqual(res.orderedSegments, [
      '/p/seg_intro_0.mp4',
      '/p/seg_slide_01.mp4',
      '/p/seg_slide_02.mp4',
      '/p/seg_outro_0.mp4',
    ]);
  });

  it('demuxer step targets the final output directly (no intermediate)', async () => {
    const res = await stitch(input, { dryRun: true });
    assert.equal(res.plan[0].outputPath, '/p/final/out.mp4');
    // Default concat list sits alongside the output.
    assert.equal(valueAfter(res.plan[0].args, '-i'), resolvePath('/p/final', 'concat.txt'));
  });
});

describe('stitch dry-run — with music (demuxer concat → intermediate, then mix)', () => {
  const input: StitchInput = {
    segments: ['/p/s1.mp4', '/p/s2.mp4'],
    outputPath: '/p/final/out.mp4',
    music: { trackPath: '/p/audio/bg.mp3' },
  };

  it('plans concat→intermediate then a music-mix producing the final output', async () => {
    const res = await stitch(input, { dryRun: true });
    assert.equal(res.music, true);
    assert.equal(res.plan.length, 2);
    assert.equal(res.plan[0].kind, 'concat-demuxer');
    // concat writes the intermediate "concat_no_music.mp4" alongside the output.
    assert.equal(res.plan[0].outputPath, resolvePath('/p/final', 'concat_no_music.mp4'));
    assert.equal(res.plan[1].kind, 'music-mix');
    assert.equal(res.plan[1].outputPath, '/p/final/out.mp4');
    // The music step reads the concat intermediate and the music track.
    assert.equal(res.plan[1].args[1], resolvePath('/p/final', 'concat_no_music.mp4'));
    assert.equal(res.plan[1].args[5], '/p/audio/bg.mp3');
  });
});

describe('stitch dry-run — large project flips to filter concat', () => {
  it('uses concat-filter at >= 8 segments (auto)', async () => {
    const input: StitchInput = {
      segments: Array.from({ length: 10 }, (_, i) => `/p/seg_${i}.mp4`),
      outputPath: '/p/final/out.mp4',
    };
    const res = await stitch(input, { dryRun: true });
    assert.equal(res.concatStrategy, 'filter');
    assert.equal(res.plan[0].kind, 'concat-filter');
    // Filter path passes each segment as its own -i input.
    assert.equal(res.plan[0].args.filter((a) => a === '-i').length, 10);
  });

  it('with intro+outro, the filter concat includes the full ordered set', async () => {
    const input: StitchInput = {
      intro: ['/p/i0.mp4', '/p/i1.mp4'],
      segments: Array.from({ length: 6 }, (_, i) => `/p/s_${i}.mp4`),
      outro: ['/p/o0.mp4'],
      outputPath: '/p/final/out.mp4',
      music: { trackPath: '/p/m.mp3' },
    };
    const res = await stitch(input, { dryRun: true });
    // 2 + 6 + 1 = 9 segments → filter; with music → 2 steps.
    assert.equal(res.concatStrategy, 'filter');
    assert.equal(res.plan.length, 2);
    assert.equal(res.plan[0].args.filter((a) => a === '-i').length, 9);
  });
});

describe('stitch dry-run — explicit strategy override', () => {
  it('forces filter even below the threshold when requested', async () => {
    const res = await stitch(
      { segments: ['/p/a.mp4', '/p/b.mp4'], outputPath: '/p/out.mp4', concatStrategy: 'filter' },
      { dryRun: true },
    );
    assert.equal(res.concatStrategy, 'filter');
    assert.equal(res.plan[0].kind, 'concat-filter');
  });

  it('forces demuxer even above the threshold when requested', async () => {
    const res = await stitch(
      {
        segments: Array.from({ length: 12 }, (_, i) => `/p/s_${i}.mp4`),
        outputPath: '/p/out.mp4',
        concatStrategy: 'demuxer',
      },
      { dryRun: true },
    );
    assert.equal(res.concatStrategy, 'demuxer');
    assert.equal(res.plan[0].kind, 'concat-demuxer');
  });
});

describe('stitch — empty input guard', () => {
  it('throws when there are no segments', async () => {
    await assert.rejects(
      () => stitch({ segments: [], outputPath: '/p/out.mp4' }, { dryRun: true }),
      /no segments/,
    );
  });
});

describe('stitch — pre-concat MP4-validity guard', () => {
  it('dry-run does NOT validate segments (plans without any files existing)', async () => {
    // These paths do not exist; if dry-run probed them this would throw.
    const res = await stitch(
      { segments: ['/no/such/seg_a.mp4', '/no/such/seg_b.mp4'], outputPath: '/no/such/out.mp4' },
      { dryRun: true },
    );
    assert.equal(res.status, 'dry-run');
    assert.equal(res.plan.length, 1);
    assert.equal(res.plan[0].kind, 'concat-demuxer');
  });

  it('rejects a corrupt/truncated segment with ffmpeg_failed when not dry-run (requires ffprobe)', async (t) => {
    if (spawnSync('ffprobe', ['-version'], { encoding: 'utf-8' }).status !== 0) {
      t.skip('ffprobe not on PATH');
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-stitch-guard-'));
    try {
      const junk = join(dir, 'truncated.mp4');
      await writeFile(junk, Buffer.from('garbage-not-mp4'), 'binary');
      await assert.rejects(
        () => stitch({ segments: [junk], outputPath: join(dir, 'out.mp4') }, { dryRun: false }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal((err as { code?: string }).code, 'ffmpeg_failed');
          assert.match((err as Error).message, /corrupt or truncated MP4/);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
