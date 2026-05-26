#!/usr/bin/env node
// smoke-assemble-render.mjs — REAL-ffmpeg integration smoke for the assemble pipeline.
//
// LOCAL / MANUAL integration check — NOT part of check:release-readiness-lite.
// It actually SPAWNS ffmpeg 8.1 and renders MP4s (the unit tests only assert the
// arg SHAPE via dry-run and never run ffmpeg). This proves the ported Python
// FFmpeg arg-strings (sub-slices 3e animate-slides + 3h stitch) execute for real
// and produce valid h264/aac MP4s — surfacing any filter/flag bug an arg-shape
// test cannot catch.
//
// NO API keys required: all inputs are synthesized with ffmpeg lavfi sources +
// sharp. It validates plumbing/codecs/durations ONLY — aesthetic quality and
// real TTS/music voices/content still need a human.
//
// Skip-guard: if ffmpeg/ffprobe are not on PATH it prints "SKIP" and exits 0, so
// it is safe to run anywhere (including CI that lacks ffmpeg).
//
//   npm run smoke:assemble-render
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { animateSlide } from '../dist/video/assemble/animate-slides.js';
import { stitch, buildMusicMixArgs } from '../dist/video/assemble/stitch.js';
import { runFfmpeg, ffprobeDuration } from '../dist/video/assemble/ffmpeg.js';
import { generateTitleCard } from '../dist/video/assemble/title-card.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function onPath(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf-8' });
  return r.status === 0;
}

/** Run ffmpeg synchronously, throwing the stderr + command on failure. */
function ffmpegSync(args, label) {
  const full = ['-y', ...args];
  const r = spawnSync('ffmpeg', full, { encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(
      `[${label}] ffmpeg exited ${r.status}\n  cmd: ffmpeg ${full.join(' ')}\n  stderr:\n${r.stderr}`,
    );
  }
}

/** ffprobe a stream summary: codecs, resolution, fps, stream counts, duration. */
function probe(path) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels,avg_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json',
      path,
    ],
    { encoding: 'utf-8' },
  );
  if (r.status !== 0) {
    throw new Error(`ffprobe failed for ${path}:\n${r.stderr}`);
  }
  const data = JSON.parse(r.stdout);
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const fps = v?.avg_frame_rate
    ? (() => {
        const [n, d] = v.avg_frame_rate.split('/').map(Number);
        return d ? Math.round((n / d) * 100) / 100 : 0;
      })()
    : 0;
  return {
    durationSec: Number.parseFloat(data.format?.duration ?? '0'),
    videoStreams: streams.filter((s) => s.codec_type === 'video').length,
    audioStreams: streams.filter((s) => s.codec_type === 'audio').length,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    width: v?.width,
    height: v?.height,
    fps,
    sampleRate: a?.sample_rate ? Number(a.sample_rate) : undefined,
    channels: a?.channels,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

let passes = 0;
function stagePass(stage, info) {
  passes += 1;
  console.log(`  PASS [${stage}] ${info}`);
}

// ---------------------------------------------------------------------------
// Skip-guard
// ---------------------------------------------------------------------------
if (!onPath('ffmpeg') || !onPath('ffprobe')) {
  console.log('SKIP: ffmpeg not available');
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), 'vclaw-render-smoke-'));
console.log(`# real-ffmpeg assemble render smoke (tmpdir: ${root})`);

try {
  const NUM = 3;
  const SLIDE_SECS = 2; // synthetic narration length per slide
  const slidePngs = [];
  const slideLoops = [];
  const ttsFiles = [];

  // --- 1. Synthesize inputs (no API keys) ---
  for (let i = 0; i < NUM; i += 1) {
    const colors = ['#1c2541', '#3a506b', '#5bc0be'];
    const png = join(root, `slide_${i}.png`);
    await generateTitleCard({
      title: `Slide ${i + 1}`,
      subtitle: 'synthetic input',
      outputPath: png,
      background: colors[i],
    });
    slidePngs.push(png);

    // F2V loop stand-in: a short looping video derived from the PNG (input 0 of
    // animateSlide is a pre-generated frames-to-video loop, NOT a raw PNG).
    const loop = join(root, `slide_loop_${i}.mp4`);
    ffmpegSync(
      [
        '-loop', '1', '-i', png, '-t', '1', '-r', '24',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', loop,
      ],
      'synth-loop',
    );
    slideLoops.push(loop);

    // Synthetic narration: silent stereo AAC m4a (stands in for TTS output).
    const tts = join(root, `tts_${i}.m4a`);
    ffmpegSync(
      [
        '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
        '-t', String(SLIDE_SECS), '-c:a', 'aac', tts,
      ],
      'synth-tts',
    );
    ttsFiles.push(tts);
  }

  // Synthetic music bed: 8s silent mp3.
  const musicTrack = join(root, 'music.mp3');
  ffmpegSync(
    ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '8', '-c:a', 'libmp3lame', musicTrack],
    'synth-music',
  );
  console.log(`# synthesized ${NUM} slides + ${NUM} narration tracks + 1 music bed`);

  // --- 2. animateSlide (REAL ffmpeg) for each slide ---
  const segments = [];
  let segSum = 0;
  for (let i = 0; i < NUM; i += 1) {
    const out = join(root, `seg_${i}.mp4`);
    const ttsMs = await ffprobeDuration(ttsFiles[i]);
    const res = await animateSlide(
      {
        slidePath: slideLoops[i],
        ttsPath: ttsFiles[i],
        outputPath: out,
        durationSec: ttsMs / 1000,
        slideNum: i + 1,
        numSlides: NUM,
      },
      { dryRun: false },
    );
    const st = await stat(out);
    assert(st.size > 0, `segment ${i} is non-zero bytes`);
    const p = probe(out);
    assert(p.videoCodec === 'h264', `seg ${i} video codec h264 (got ${p.videoCodec})`);
    assert(p.width === 1280 && p.height === 720, `seg ${i} is 1280x720 (got ${p.width}x${p.height})`);
    assert(p.fps === 24, `seg ${i} is 24fps (got ${p.fps})`);
    assert(p.audioStreams === 1, `seg ${i} has 1 audio stream (got ${p.audioStreams})`);
    assert(p.audioCodec === 'aac', `seg ${i} audio codec aac (got ${p.audioCodec})`);
    assert(p.sampleRate === 44100, `seg ${i} audio 44100 (got ${p.sampleRate})`);
    assert(p.channels === 2, `seg ${i} audio stereo (got ${p.channels})`);
    segSum += p.durationSec;
    segments.push(out);
    stagePass(
      `animate#${i}`,
      `${p.videoCodec}/${p.audioCodec} ${p.width}x${p.height}@${p.fps} ${p.durationSec.toFixed(3)}s (aligned ${res.durationMs}ms)`,
    );
  }

  // --- 3. stitch via DEMUXER path (3 segments < 8) ---
  const demuxOut = join(root, 'final_demuxer.mp4');
  const demuxRes = await stitch(
    { segments, outputPath: demuxOut, concatStrategy: 'demuxer' },
    { dryRun: false },
  );
  assert(demuxRes.concatStrategy === 'demuxer', 'demuxer strategy used');
  const demuxP = probe(demuxOut);
  assert(demuxP.videoStreams === 1 && demuxP.audioStreams === 1, 'demuxer out has 1 v + 1 a stream');
  assert(demuxP.videoCodec === 'h264' && demuxP.audioCodec === 'aac', 'demuxer out h264/aac');
  assert(
    Math.abs(demuxP.durationSec - segSum) <= 0.5,
    `demuxer duration ~= sum of segments (${demuxP.durationSec.toFixed(3)} vs ${segSum.toFixed(3)})`,
  );
  stagePass(
    'stitch-demuxer',
    `${demuxP.videoCodec}/${demuxP.audioCodec} ${demuxP.width}x${demuxP.height} ${demuxP.durationSec.toFixed(3)}s v=${demuxP.videoStreams} a=${demuxP.audioStreams}`,
  );

  // --- 4. stitch via FILTER path (re-encode) ---
  const filterOut = join(root, 'final_filter.mp4');
  const filterRes = await stitch(
    { segments, outputPath: filterOut, concatStrategy: 'filter' },
    { dryRun: false },
  );
  assert(filterRes.concatStrategy === 'filter', 'filter strategy used');
  const filterP = probe(filterOut);
  assert(filterP.videoStreams === 1 && filterP.audioStreams === 1, 'filter out has 1 v + 1 a stream');
  assert(filterP.videoCodec === 'h264' && filterP.audioCodec === 'aac', 'filter out h264/aac');
  assert(
    Math.abs(filterP.durationSec - segSum) <= 0.5,
    `filter duration ~= sum of segments (${filterP.durationSec.toFixed(3)} vs ${segSum.toFixed(3)})`,
  );
  stagePass(
    'stitch-filter',
    `${filterP.videoCodec}/${filterP.audioCodec} ${filterP.width}x${filterP.height} ${filterP.durationSec.toFixed(3)}s v=${filterP.videoStreams} a=${filterP.audioStreams}`,
  );

  // --- 5. music mix (REAL) — final video + synthetic music track ---
  const mixOut = join(root, 'final_music.mp4');
  const totalSec = demuxP.durationSec;
  const mixArgs = buildMusicMixArgs(demuxOut, musicTrack, mixOut, { totalDurationSec: totalSec });
  await runFfmpeg(mixArgs, { dryRun: false });
  const mixSt = await stat(mixOut);
  assert(mixSt.size > 0, 'music-mix output is non-zero bytes');
  const mixP = probe(mixOut);
  assert(mixP.videoStreams === 1 && mixP.audioStreams === 1, 'music-mix out has 1 v + 1 a stream');
  assert(mixP.videoCodec === 'h264' && mixP.audioCodec === 'aac', 'music-mix out h264/aac');
  assert(
    Math.abs(mixP.durationSec - totalSec) <= 0.5,
    `music-mix duration ~= input (${mixP.durationSec.toFixed(3)} vs ${totalSec.toFixed(3)})`,
  );
  stagePass(
    'music-mix',
    `${mixP.videoCodec}/${mixP.audioCodec} ${mixP.width}x${mixP.height} ${mixP.durationSec.toFixed(3)}s v=${mixP.videoStreams} a=${mixP.audioStreams}`,
  );

  // Also exercise stitch's own music path end-to-end (concat + mix in one call).
  const stitchMusicOut = join(root, 'final_stitch_music.mp4');
  const stitchMusicRes = await stitch(
    { segments, outputPath: stitchMusicOut, concatStrategy: 'demuxer', music: { trackPath: musicTrack } },
    { dryRun: false },
  );
  assert(stitchMusicRes.music === true, 'stitch reports music mixed');
  const smP = probe(stitchMusicOut);
  assert(smP.videoStreams === 1 && smP.audioStreams === 1, 'stitch+music out has 1 v + 1 a stream');
  stagePass(
    'stitch+music',
    `${smP.videoCodec}/${smP.audioCodec} ${smP.width}x${smP.height} ${smP.durationSec.toFixed(3)}s`,
  );

  console.log(`\nALL STAGES PASS (${passes} stage assertions, real ffmpeg renders)`);
} catch (err) {
  console.error(`\nSMOKE FAILED:\n${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  if (err && typeof err === 'object' && 'details' in err) {
    console.error(`details: ${JSON.stringify(err.details, null, 2)}`);
  }
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
