/**
 * Stitch keystone for the assemble stage (sub-slice 3h).
 *
 * Source of truth (ported VERBATIM):
 *  - `skills/video-replicator/scripts/stitch_bunty.py` — the bunty stitch. Uses
 *    the concat **demuxer** path (`ffmpeg -y -f concat -safe 0 -i concat.txt
 *    -c copy output`) — a single ffmpeg invocation regardless of segment count,
 *    chosen deliberately so it survives the sandbox's per-session FFmpeg limit.
 *  - `skills/video-replicator/scripts/ffmpeg_wrapper.py:concat_via_filter` — the
 *    concat **filter** fallback (`-filter_complex
 *    "[0:v][0:a]...concat=n=N:v=1:a=1[outv][outa]"` + re-encode). Used for 8+
 *    segments where demuxer-accumulated AV drift across boundaries matters, OR
 *    when a segment has incompatible codec params and the demuxer rejects it.
 *  - `skills/video-replicator/scripts/assembly_utils.py:add_background_music` —
 *    the music-bed mix (loops the music under the narration at low volume with a
 *    tail fade-out, via amix).
 *
 * bunty (stitch_bunty.py) and nex (nex_assemble.py) collapse into ONE
 * parameterized stitch driven by brand-profile-derived knobs:
 *  - bunty: pre-encoded segments → demuxer concat, no music, intro/outro by
 *    lip-sync scene segments. (`_concat_via_demuxer`, demuxer-first with a
 *    filter fallback.)
 *  - nex: normalized segments → filter concat (drift-free for 8+), optional
 *    background-music bed, optional title-card prepend. (`concat_via_filter`
 *    + `add_background_music`.)
 * These differences become StitchInput fields: `concatStrategy`
 * (demuxer | filter | auto), `intro` / `outro` segment paths, and the optional
 * `music` block (track + volume + tail fade). The demuxer-vs-filter selection in
 * `auto` mode flips at `FILTER_FALLBACK_SEGMENT_THRESHOLD` segments — the real
 * sandbox-survival + drift lesson from the Python.
 *
 * AV-drift note (stitch_bunty.py ~L471-479): demuxer `-c copy` preserves exact
 * packet timing and accumulates no re-encode drift, BUT it requires every
 * segment to share encoding params. The per-segment AV-lock from 3e
 * (1280×720@24, H.264 libx264 preset-fast crf20, AAC 44100 stereo) guarantees
 * that, so the demuxer path is the primary one. Filter concat re-encodes (and so
 * can introduce its own drift) but tolerates mismatched inputs — it is the
 * fallback.
 *
 * IMPORTANT — testing boundary (SAME as 3e): the PURE arg-builders
 * (`buildConcatDemuxerArgs`, `buildConcatFilterArgs`, `buildMusicMixArgs`) are
 * the unit-tested surface (arg-shape only). `stitch` actually spawns ffmpeg and
 * writes the concat list; verifying that the final MP4 looks/sounds right on
 * real media is a HUMAN integration checkpoint, explicitly OUT OF SCOPE for the
 * unit tests. Tests use the dry-run path and never run ffmpeg or require media.
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { runFfmpeg, ffprobeDuration, type RunFfmpegOptions } from './ffmpeg.js';

/**
 * Segment-count threshold at which `auto` strategy switches from the
 * concat demuxer to the concat filter. Mirrors the Python lesson that the
 * demuxer accumulates audible AV drift across "8+ segments"
 * (ffmpeg_wrapper.concat_via_filter docstring). At or above this many segments
 * `auto` prefers the filter path.
 */
export const FILTER_FALLBACK_SEGMENT_THRESHOLD = 8;

/** Default background-music mix level (nex_assemble.py --music-volume default 0.05). */
export const DEFAULT_MUSIC_VOLUME = 0.05;
/** Default tail fade-out for the music bed in seconds (add_background_music default 3.0). */
export const DEFAULT_MUSIC_FADE_OUT_SEC = 3.0;
/** AAC bitrate for re-encode paths (filter concat + music mix). Matches the Python "192k". */
export const STANDARD_AUDIO_BITRATE = '192k';

/** Which concat path to use. `auto` picks demuxer/filter by segment count. */
export type ConcatStrategy = 'demuxer' | 'filter' | 'auto';

export interface MusicMixSettings {
  /** Path to the background-music track. Looped under the narration. */
  trackPath: string;
  /** Mix level for the music bed (0..1). Defaults to {@link DEFAULT_MUSIC_VOLUME}. */
  volume?: number;
  /** Tail fade-out duration in seconds. Defaults to {@link DEFAULT_MUSIC_FADE_OUT_SEC}. */
  fadeOutSec?: number;
}

export interface StitchInput {
  /**
   * Ordered body segment paths (the slide segments). These sit between the
   * optional intro and outro segments. From 3e every segment conforms to
   * 1280×720@24 / H.264 / AAC 44100 stereo, so demuxer concat is valid.
   */
  segments: string[];
  /** Optional ordered intro segment paths, prepended before `segments`. */
  intro?: string[];
  /** Optional ordered outro segment paths, appended after `segments`. */
  outro?: string[];
  /** Where the final stitched MP4 is written. */
  outputPath: string;
  /**
   * Path for the concat-demuxer list file. Defaults to `concat.txt` alongside
   * the output. Only used by the demuxer path.
   */
  concatListPath?: string;
  /**
   * Concat strategy. `auto` (default) uses the demuxer up to
   * {@link FILTER_FALLBACK_SEGMENT_THRESHOLD} segments, then the filter.
   * bunty maps to `auto`/`demuxer`; nex maps to `filter`.
   */
  concatStrategy?: ConcatStrategy;
  /** Optional background-music bed (the nex-brand knob). Omit for bunty. */
  music?: MusicMixSettings;
}

export interface StitchPlannedStep {
  /** What this step does. */
  kind: 'concat-demuxer' | 'concat-filter' | 'music-mix';
  /** The ffmpeg args (everything after the binary and the auto-prepended `-y`). */
  args: string[];
  /** The output this step writes. */
  outputPath: string;
}

export interface StitchResult {
  status: 'complete' | 'dry-run';
  /** Final MP4 path. */
  outputPath: string;
  /** Ordered list of every segment that went into the concat. */
  orderedSegments: string[];
  /** Which concat path was actually used. */
  concatStrategy: 'demuxer' | 'filter';
  /** Whether a music bed was mixed. */
  music: boolean;
  /** The planned ffmpeg command sequence (always populated, incl. dry-run). */
  plan: StitchPlannedStep[];
  /** Final video duration in milliseconds (0 on dry-run — no probe). */
  durationMs: number;
}

/** Assemble the full ordered segment list: intro + body + outro. */
export function orderedSegments(input: StitchInput): string[] {
  return [...(input.intro ?? []), ...input.segments, ...(input.outro ?? [])];
}

/**
 * Choose the effective concat path. `demuxer`/`filter` are honored directly;
 * `auto` flips to the filter at {@link FILTER_FALLBACK_SEGMENT_THRESHOLD}
 * segments (the drift lesson from the Python).
 */
export function selectConcatStrategy(
  strategy: ConcatStrategy,
  segmentCount: number,
): 'demuxer' | 'filter' {
  if (strategy === 'demuxer' || strategy === 'filter') return strategy;
  return segmentCount >= FILTER_FALLBACK_SEGMENT_THRESHOLD ? 'filter' : 'demuxer';
}

/** Render the concat-demuxer list file body: one `file '<abspath>'` line per segment. */
export function buildConcatListContent(segments: string[]): string {
  // Mirrors stitch_bunty._concat_via_demuxer: file '<os.path.abspath(seg)>'.
  return segments.map((seg) => `file '${resolvePath(seg)}'\n`).join('');
}

/**
 * Build the concat-DEMUXER ffmpeg args (PURE). The primary path.
 *
 * Ported VERBATIM from stitch_bunty._concat_via_demuxer (L240):
 *   ffmpeg -y -f concat -safe 0 -i concat.txt -c copy output
 * (`-y` is prepended by `runFfmpeg`, so it is NOT included here.)
 *
 * A single ffmpeg invocation regardless of segment count — survives the
 * sandbox's per-session FFmpeg limit. Requires all segments to share encoding
 * params (true for 3e segments).
 */
export function buildConcatDemuxerArgs(
  _segments: string[],
  concatListPath: string,
  outputPath: string,
): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath];
}

export interface BuildConcatFilterOptions {
  /** H.264 CRF (Python default 20). */
  crf?: number;
  /** AAC bitrate (Python default "192k"). */
  audioBitrate?: string;
  /** Audio sample rate Hz (Python default 44100). */
  sampleRate?: number;
  /** Audio channel count (Python default 2). */
  channels?: number;
}

/**
 * Build the concat-FILTER fallback ffmpeg args (PURE). For 8+ segments where
 * demuxer drift accumulates, or when a segment has incompatible codec params.
 *
 * Ported VERBATIM from ffmpeg_wrapper.concat_via_filter (L296-326):
 *   -i f0 -i f1 ... -i f{n-1}
 *   -filter_complex "[0:v][0:a][1:v][1:a]...concat=n=N:v=1:a=1[outv][outa]"
 *   -map [outv] -map [outa]
 *   -c:v libx264 -preset fast -crf 20
 *   -c:a aac -b:a 192k -ar 44100 -ac 2
 *   -movflags +faststart output
 */
export function buildConcatFilterArgs(
  segments: string[],
  outputPath: string,
  opts: BuildConcatFilterOptions = {},
): string[] {
  const crf = opts.crf ?? 20;
  const audioBitrate = opts.audioBitrate ?? STANDARD_AUDIO_BITRATE;
  const sampleRate = opts.sampleRate ?? 44100;
  const channels = opts.channels ?? 2;

  const inputArgs: string[] = [];
  for (const seg of segments) {
    inputArgs.push('-i', seg);
  }

  // [0:v][0:a][1:v][1:a]...[n-1:v][n-1:a]concat=n=N:v=1:a=1[outv][outa]
  let filterInputs = '';
  for (let i = 0; i < segments.length; i += 1) {
    filterInputs += `[${i}:v][${i}:a]`;
  }
  const filterComplex = `${filterInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`;

  return [
    ...inputArgs,
    '-filter_complex',
    filterComplex,
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    String(crf),
    '-c:a',
    'aac',
    '-b:a',
    audioBitrate,
    '-ar',
    String(sampleRate),
    '-ac',
    String(channels),
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

export interface BuildMusicMixOptions {
  /** Mix level for the music bed (0..1). Default {@link DEFAULT_MUSIC_VOLUME}. */
  volume?: number;
  /** Tail fade-out seconds. Default {@link DEFAULT_MUSIC_FADE_OUT_SEC}. */
  fadeOutSec?: number;
  /**
   * Total video duration in seconds — used to compute the fade-out start
   * (`total - fadeOut`) and the `-t` cap. The caller probes this via
   * `ffprobeDuration`. Defaults to 0 (fade starts at 0 / `-t 0`), only used by
   * the dry-run / pure-builder path where the duration is not yet known.
   */
  totalDurationSec?: number;
}

/** Format a number the way the Python f-strings do (`:.2f` / `:.3f`). */
function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

/**
 * Build the background-music mix ffmpeg args (PURE). Loops the music under the
 * narration at a low volume with a tail fade-out, then mixes via amix.
 *
 * Ported VERBATIM from assembly_utils.add_background_music (L408-435):
 *   -i video -stream_loop -1 -i music
 *   -filter_complex "[0:a]volume=1.0[v];
 *     [1:a]volume={vol},afade=t=out:st={fade_start}:d={fade_out}[m];
 *     [v][m]amix=inputs=2:duration=first:dropout_transition=600:normalize=0[a]"
 *   -map 0:v -map [a]
 *   -c:v copy -c:a aac -b:a 192k
 *   -movflags +faststart
 *   -t {total} output
 *
 * fade_start = max(0, total - fade_out). `dropout_transition=600` prevents early
 * audio cutoff on silent sections; `normalize=0` keeps the narration at full
 * level while the music stays at `volume`.
 */
export function buildMusicMixArgs(
  videoPath: string,
  musicPath: string,
  outputPath: string,
  opts: BuildMusicMixOptions = {},
): string[] {
  const volume = opts.volume ?? DEFAULT_MUSIC_VOLUME;
  const fadeOut = opts.fadeOutSec ?? DEFAULT_MUSIC_FADE_OUT_SEC;
  const totalDur = opts.totalDurationSec ?? 0;
  const fadeStart = Math.max(0, totalDur - fadeOut);

  const filterComplex =
    `[0:a]volume=1.0[v];` +
    `[1:a]volume=${volume},afade=t=out:st=${fixed(fadeStart, 2)}:d=${fadeOut}[m];` +
    `[v][m]amix=inputs=2:duration=first:dropout_transition=600:normalize=0[a]`;

  return [
    '-i',
    videoPath,
    '-stream_loop',
    '-1',
    '-i',
    musicPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    STANDARD_AUDIO_BITRATE,
    '-movflags',
    '+faststart',
    '-t',
    fixed(totalDur, 3),
    outputPath,
  ];
}

export interface StitchOptions extends RunFfmpegOptions {
  /** Override the ffprobe binary (forwarded to `ffprobeDuration`). */
  ffprobeBin?: string;
}

/**
 * Orchestrate the stitch: write the concat list (demuxer path), pick the
 * demuxer-vs-filter path, run via `runFfmpeg`, optionally mix a music bed, and
 * return the final MP4 path + a plan of the executed command sequence.
 *
 * On `dryRun`, returns the planned command sequence WITHOUT writing the concat
 * list, spawning ffmpeg, or probing durations (music fade-start is computed
 * from 0). This is the path unit tests use.
 *
 * NOTE: the real-spawn path. The final-MP4 quality check is a HUMAN integration
 * checkpoint — out of scope here.
 */
export async function stitch(
  input: StitchInput,
  opts: StitchOptions = {},
): Promise<StitchResult> {
  const segs = orderedSegments(input);
  if (segs.length === 0) {
    // Defensive: nothing to concat. Caller is expected to pass >=1 segment.
    throw new Error('stitch: no segments to concatenate');
  }

  const strategy = selectConcatStrategy(input.concatStrategy ?? 'auto', segs.length);
  const hasMusic = input.music !== undefined;
  const concatListPath =
    input.concatListPath ?? resolvePath(dirname(input.outputPath), 'concat.txt');

  // When music is mixed, concat writes an intermediate file and the music step
  // produces the final output (mirrors nex_assemble's concat_no_music.mp4).
  const concatOutput = hasMusic
    ? resolvePath(dirname(input.outputPath), 'concat_no_music.mp4')
    : input.outputPath;

  const plan: StitchPlannedStep[] = [];

  // --- Concat step ---
  const concatArgs =
    strategy === 'demuxer'
      ? buildConcatDemuxerArgs(segs, concatListPath, concatOutput)
      : buildConcatFilterArgs(segs, concatOutput);
  plan.push({
    kind: strategy === 'demuxer' ? 'concat-demuxer' : 'concat-filter',
    args: concatArgs,
    outputPath: concatOutput,
  });

  // --- Music step (optional) ---
  if (hasMusic && input.music) {
    // The fade-start / -t cap need the concat duration; on dry-run we leave it 0.
    const musicArgs = buildMusicMixArgs(concatOutput, input.music.trackPath, input.outputPath, {
      volume: input.music.volume,
      fadeOutSec: input.music.fadeOutSec,
      totalDurationSec: 0,
    });
    plan.push({ kind: 'music-mix', args: musicArgs, outputPath: input.outputPath });
  }

  if (opts.dryRun) {
    return {
      status: 'dry-run',
      outputPath: input.outputPath,
      orderedSegments: segs,
      concatStrategy: strategy,
      music: hasMusic,
      plan,
      durationMs: 0,
    };
  }

  // --- Real execution ---
  await mkdir(dirname(input.outputPath), { recursive: true });

  if (strategy === 'demuxer') {
    await mkdir(dirname(concatListPath), { recursive: true });
    await writeFile(concatListPath, buildConcatListContent(segs), 'utf8');
  }

  await runFfmpeg(concatArgs, opts);

  let finalPath = concatOutput;
  if (hasMusic && input.music) {
    // Probe the concat output to compute the real fade-start + -t cap.
    const concatMs = await ffprobeDuration(concatOutput, { ffprobeBin: opts.ffprobeBin });
    const musicArgs = buildMusicMixArgs(concatOutput, input.music.trackPath, input.outputPath, {
      volume: input.music.volume,
      fadeOutSec: input.music.fadeOutSec,
      totalDurationSec: concatMs / 1000,
    });
    // Refresh the plan's music step with the duration-resolved args.
    const musicStep = plan.find((s) => s.kind === 'music-mix');
    if (musicStep) musicStep.args = musicArgs;
    await runFfmpeg(musicArgs, opts);
    finalPath = input.outputPath;
  }

  const durationMs = await ffprobeDuration(finalPath, { ffprobeBin: opts.ffprobeBin });
  // Touch stat so a 0-byte output surfaces as a runtime failure path-side.
  await stat(finalPath);

  return {
    status: 'complete',
    outputPath: finalPath,
    orderedSegments: segs,
    concatStrategy: strategy,
    music: hasMusic,
    plan,
    durationMs,
  };
}
