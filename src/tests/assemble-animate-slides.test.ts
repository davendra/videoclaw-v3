/**
 * Unit tests for the slide-animation arg-builder (sub-slice 3e).
 *
 * Scope: arg-shape only. `buildAnimateArgs` is a PURE function — we assert the
 * returned args array matches the verbatim FFmpeg invocation from
 * `bunty_animate_slides.py:encode_animated_slide_segment`. We DO NOT run ffmpeg
 * here; rendering real video is a human integration checkpoint, out of scope.
 * No media files are needed and ffmpeg need not be installed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnimateArgs,
  animateSlide,
  alignDurationToFrame,
  TARGET_FPS,
} from '../video/assemble/animate-slides.js';

/** Locate the value following a flag token in an args array. */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('alignDurationToFrame', () => {
  it('rounds up to the next 24fps frame boundary (math.ceil(d*24)/24)', () => {
    // 3.01s -> ceil(72.24)/24 = 73/24 = 3.041666...
    assert.equal(alignDurationToFrame(3.01), 73 / 24);
    // Exact frame boundary stays put: 3.0s -> 72/24 = 3.0
    assert.equal(alignDurationToFrame(3.0), 3.0);
  });
});

describe('buildAnimateArgs — middle slide (no fades)', () => {
  const args = buildAnimateArgs({
    slidePath: '/proj/videos/scene_3.mp4',
    ttsPath: '/proj/audio/tts/scene_3_tts.mp3',
    outputPath: '/proj/final/segments_animated/seg_slide_03.mp4',
    durationSec: 4.0,
    slideNum: 3,
    numSlides: 12,
  });

  it('starts with -stream_loop -1 then the F2V input', () => {
    assert.equal(args[0], '-stream_loop');
    assert.equal(args[1], '-1');
    assert.equal(args[2], '-i');
    assert.equal(args[3], '/proj/videos/scene_3.mp4');
  });

  it('passes the TTS file as the second input', () => {
    assert.equal(args[4], '-i');
    assert.equal(args[5], '/proj/audio/tts/scene_3_tts.mp3');
  });

  it('builds the verbatim filter_complex (scale/pad/yuv420p + aresample/apad)', () => {
    const fc = valueAfter(args, '-filter_complex');
    assert.ok(fc, 'filter_complex present');
    assert.equal(
      fc,
      '[0:v]scale=1280:720:force_original_aspect_ratio=decrease,' +
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v];' +
        '[1:a]aresample=44100,aformat=channel_layouts=stereo,' +
        'apad=whole_dur=4.500000[a]',
    );
  });

  it('has NO fade tokens on a middle slide', () => {
    const fc = valueAfter(args, '-filter_complex') ?? '';
    assert.ok(!fc.includes('fade='), 'no video fade');
    assert.ok(!fc.includes('afade='), 'no audio fade');
  });

  it('maps [v] and [a]', () => {
    const mapIdx = args.indexOf('-map');
    assert.equal(args[mapIdx + 1], '[v]');
    assert.equal(args[mapIdx + 3], '[a]');
  });

  it('uses the standard 24fps libx264/crf20 + aac encoding params', () => {
    assert.equal(valueAfter(args, '-r'), '24');
    assert.equal(valueAfter(args, '-c:v'), 'libx264');
    assert.equal(valueAfter(args, '-preset'), 'fast');
    assert.equal(valueAfter(args, '-crf'), '20');
    assert.equal(valueAfter(args, '-c:a'), 'aac');
    assert.equal(valueAfter(args, '-ar'), '44100');
    assert.equal(valueAfter(args, '-ac'), '2');
  });

  it('caps video at the aligned frame count and trims output with -t', () => {
    // duration aligns to 4.0s -> frames:v = 96, -t = 4.000000
    assert.equal(valueAfter(args, '-frames:v'), '96');
    assert.equal(valueAfter(args, '-t'), '4.000000');
  });

  it('ends with the output path', () => {
    assert.equal(args[args.length - 1], '/proj/final/segments_animated/seg_slide_03.mp4');
  });
});

describe('buildAnimateArgs — first slide gets a fade-in', () => {
  const args = buildAnimateArgs({
    slidePath: 's.mp4',
    ttsPath: 't.mp3',
    outputPath: 'o.mp4',
    durationSec: 5.0,
    slideNum: 1,
    numSlides: 12,
  });

  it('includes fade=t=in and afade=t=in at st=0 with the default 0.75 duration', () => {
    const fc = valueAfter(args, '-filter_complex') ?? '';
    assert.ok(fc.includes('format=yuv420p,fade=t=in:st=0:d=0.75[v]'), fc);
    assert.ok(fc.includes('afade=t=in:st=0:d=0.75[a]'), fc);
  });

  it('does NOT include a fade-out (not the last slide)', () => {
    const fc = valueAfter(args, '-filter_complex') ?? '';
    assert.ok(!fc.includes('fade=t=out'), 'no video fade-out');
  });
});

describe('buildAnimateArgs — last slide gets a fade-out at duration-fade', () => {
  const args = buildAnimateArgs({
    slidePath: 's.mp4',
    ttsPath: 't.mp3',
    outputPath: 'o.mp4',
    durationSec: 6.0,
    slideNum: 12,
    numSlides: 12,
  });

  it('includes fade=t=out / afade=t=out starting at (duration - fade) = 5.250', () => {
    const fc = valueAfter(args, '-filter_complex') ?? '';
    // 6.0 aligned stays 6.0; fade_start = 6.0 - 0.75 = 5.25 -> "5.250"
    assert.ok(fc.includes('fade=t=out:st=5.250:d=0.75[v]'), fc);
    assert.ok(fc.includes('afade=t=out:st=5.250:d=0.75[a]'), fc);
  });

  it('does NOT include a fade-in (not slide 1)', () => {
    const fc = valueAfter(args, '-filter_complex') ?? '';
    assert.ok(!fc.includes('fade=t=in'), 'no video fade-in');
  });
});

describe('buildAnimateArgs — single-slide deck gets both fades', () => {
  it('slide 1 of 1 has both fade-in and fade-out', () => {
    const args = buildAnimateArgs({
      slidePath: 's.mp4',
      ttsPath: 't.mp3',
      outputPath: 'o.mp4',
      durationSec: 4.0,
      slideNum: 1,
      numSlides: 1,
    });
    const fc = valueAfter(args, '-filter_complex') ?? '';
    assert.ok(fc.includes('fade=t=in:st=0'), 'fade-in present');
    assert.ok(fc.includes('fade=t=out:st=3.250'), 'fade-out present at 4.0-0.75');
  });
});

describe('buildAnimateArgs — fade disabled', () => {
  it('fadeDurationSec=0 suppresses fades even on slide 1 / last slide', () => {
    const args = buildAnimateArgs({
      slidePath: 's.mp4',
      ttsPath: 't.mp3',
      outputPath: 'o.mp4',
      durationSec: 4.0,
      slideNum: 1,
      numSlides: 1,
      fadeDurationSec: 0,
    });
    const fc = valueAfter(args, '-filter_complex') ?? '';
    assert.ok(!fc.includes('fade='), 'no fades when fadeDurationSec=0');
  });
});

describe('buildAnimateArgs — frame alignment on non-frame-boundary duration', () => {
  it('rounds 3.01s up to 73/24s -> frames:v 73, -t 3.041667', () => {
    const args = buildAnimateArgs({
      slidePath: 's.mp4',
      ttsPath: 't.mp3',
      outputPath: 'o.mp4',
      durationSec: 3.01,
      slideNum: 2,
      numSlides: 12,
    });
    const aligned = alignDurationToFrame(3.01);
    assert.equal(valueAfter(args, '-frames:v'), String(Math.round(aligned * TARGET_FPS)));
    assert.equal(valueAfter(args, '-frames:v'), '73');
    assert.equal(valueAfter(args, '-t'), aligned.toFixed(6));
    // apad whole_dur = aligned + 0.5
    const fc = valueAfter(args, '-filter_complex') ?? '';
    assert.ok(fc.includes(`apad=whole_dur=${(aligned + 0.5).toFixed(6)}`), fc);
  });
});

describe('animateSlide dry-run (no spawn)', () => {
  it('returns the output path + aligned duration without running ffmpeg', async () => {
    const res = await animateSlide(
      {
        slidePath: 's.mp4',
        ttsPath: 't.mp3',
        outputPath: '/out/seg_slide_01.mp4',
        durationSec: 4.0,
        slideNum: 5,
        numSlides: 12,
      },
      { dryRun: true },
    );
    assert.equal(res.path, '/out/seg_slide_01.mp4');
    assert.equal(res.durationMs, 4000);
  });
});
