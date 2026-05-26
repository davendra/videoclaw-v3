/**
 * Slide-animation arg-builder for the assemble stage (sub-slice 3e).
 *
 * Source of truth: `skills/video-replicator/scripts/bunty_animate_slides.py`,
 * function `encode_animated_slide_segment` (~lines 344-406). That function
 * loops a pre-generated F2V (frames-to-video) loop to the narration (TTS)
 * duration, bakes the TTS audio, applies optional boundary fades, and writes a
 * `seg_slide_NN.mp4` segment. We port the FFmpeg invocation VERBATIM.
 *
 * The Python invocation we port (bunty_animate_slides.py ~L387-401):
 *
 *   ffmpeg -y -stream_loop -1 -i {f2v_video} -i {tts_file} \
 *     -filter_complex "
 *       [0:v]scale=1280:720:force_original_aspect_ratio=decrease,
 *            pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p{vfade}[v];
 *       [1:a]aresample=44100,aformat=channel_layouts=stereo,
 *            apad=whole_dur={safety_pad}{afade}[a]" \
 *     -map "[v]" -map "[a]" \
 *     -r 24 -frames:v {frame_count} \
 *     -c:v libx264 -preset fast -crf 20 \
 *     -c:a aac -ar 44100 -ac 2 \
 *     -t {duration} \
 *     {output_path}
 *
 * AV-lock strategy (ported from the Python comments verbatim):
 *  - `duration` is rounded UP to the next 24fps frame boundary so video and
 *    audio end on the same exact timestamp (math.ceil(tts * 24) / 24).
 *  - `apad whole_dur = duration + 0.5` pads audio with silence past the aligned
 *    duration so the AAC encoder always has a full frame to emit.
 *  - `-frames:v frame_count` (round(duration * 24)) caps video at the exact
 *    aligned frame count, and `-t duration` trims output to the aligned length.
 * This is what keeps per-segment AV duration mismatch within ±5ms so the 3h
 * concat (demuxer-first) path doesn't accumulate audible drift.
 *
 * IMPORTANT — testing boundary: `buildAnimateArgs` is a PURE function and is the
 * unit-tested surface (arg-shape only). `animateSlide` actually spawns ffmpeg;
 * verifying the rendered video on real media is a HUMAN integration checkpoint,
 * explicitly OUT OF SCOPE for the unit tests. Tests never run ffmpeg.
 */
import { runFfmpeg, type RunFfmpegOptions } from './ffmpeg.js';

/** Default fade-through-black on the first / last slide (Python --fade default). */
export const DEFAULT_FADE_DURATION_SEC = 0.75;
/** Output target resolution (Python scale=1280:720). */
export const TARGET_WIDTH = 1280;
export const TARGET_HEIGHT = 720;
/** Output frame rate (Python -r 24). Uniform across every assembled segment. */
export const TARGET_FPS = 24;
/** Extra silence padding past the aligned duration (Python safety_pad = +0.5). */
export const APAD_SAFETY_SEC = 0.5;

export interface BuildAnimateArgsInput {
  /** Path to the pre-generated F2V loop video (input 0). */
  slidePath: string;
  /** Path to the narration (TTS) audio for this slide (input 1). */
  ttsPath: string;
  /** Where the encoded slide segment is written. */
  outputPath: string;
  /**
   * Narration duration in seconds (the caller probes the TTS file via
   * `ffprobeDuration`). The builder rounds this UP to the next 24fps frame
   * boundary internally, exactly like the Python `math.ceil(tts * 24) / 24`.
   */
  durationSec: number;
  /**
   * 1-based slide number. Drives boundary fades: slide 1 gets a fade-in, the
   * last slide gets a fade-out (Python `slide_num == 1` / `== num_slides`).
   */
  slideNum: number;
  /** Total number of slides — used to detect the last slide for the fade-out. */
  numSlides: number;
  /**
   * Fade-through-black duration in seconds (default 0.75). A value <= 0
   * disables boundary fades entirely, matching the Python `fade_duration > 0`
   * guard.
   */
  fadeDurationSec?: number;
}

/** Format a number the way the Python f-strings do (`:.3f` / `:.6f`). */
function fixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

/**
 * Round a raw duration UP to the next 24fps frame boundary.
 * Mirrors `math.ceil(tts_dur * 24) / 24` from the Python.
 */
export function alignDurationToFrame(rawSeconds: number): number {
  return Math.ceil(rawSeconds * TARGET_FPS) / TARGET_FPS;
}

/**
 * Build the FFmpeg args array for one animated slide segment. PURE: no I/O, no
 * spawning. The returned array is everything AFTER the ffmpeg binary and the
 * `-y` flag (which `runFfmpeg` prepends), matching the Python invocation.
 *
 * This is the unit-tested core — assert the returned tokens match the Python's
 * filter_complex + encoding params.
 */
export function buildAnimateArgs(input: BuildAnimateArgsInput): string[] {
  const fadeDuration = input.fadeDurationSec ?? DEFAULT_FADE_DURATION_SEC;

  // Align duration up to the next 24fps frame boundary (Python parity).
  const duration = alignDurationToFrame(input.durationSec);
  // round(duration * 24) — exact aligned frame count.
  const frameCount = Math.round(duration * TARGET_FPS);
  const safetyPad = duration + APAD_SAFETY_SEC;

  // Boundary fades (verbatim from the Python: fade-in on slide 1, fade-out on
  // the last slide), each gated on fade_duration > 0.
  const vfades: string[] = [];
  const afades: string[] = [];
  if (input.slideNum === 1 && fadeDuration > 0) {
    vfades.push(`fade=t=in:st=0:d=${fadeDuration}`);
    afades.push(`afade=t=in:st=0:d=${fadeDuration}`);
  }
  if (input.slideNum === input.numSlides && fadeDuration > 0) {
    const fadeStart = duration - fadeDuration;
    vfades.push(`fade=t=out:st=${fixed(fadeStart, 3)}:d=${fadeDuration}`);
    afades.push(`afade=t=out:st=${fixed(fadeStart, 3)}:d=${fadeDuration}`);
  }

  const vfadeStr = vfades.length > 0 ? `,${vfades.join(',')}` : '';
  const afadeStr = afades.length > 0 ? `,${afades.join(',')}` : '';

  // filter_complex, ported VERBATIM from bunty_animate_slides.py L391-394.
  const filterComplex =
    `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=yuv420p${vfadeStr}[v];` +
    `[1:a]aresample=44100,aformat=channel_layouts=stereo,` +
    `apad=whole_dur=${fixed(safetyPad, 6)}${afadeStr}[a]`;

  // Args in the exact order the Python builds them. STANDARD_VIDEO_ARGS encodes
  // `-r 24 -c:v libx264 -preset fast -crf 20` and STANDARD_AUDIO_ARGS encodes
  // `-c:a aac -ar 44100 -ac 2`, but the Python interleaves `-frames:v` between
  // `-r 24` and `-c:v`, so we splice rather than concat the constant to keep
  // the arg ORDER byte-identical to the proven invocation.
  return [
    '-stream_loop',
    '-1',
    '-i',
    input.slidePath,
    '-i',
    input.ttsPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-r',
    String(TARGET_FPS),
    '-frames:v',
    String(frameCount),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-t',
    fixed(duration, 6),
    input.outputPath,
  ];
}

export interface AnimateSlideResult {
  path: string;
  /** Aligned output duration in milliseconds (matches the `-t` value). */
  durationMs: number;
}

/**
 * Build the args and run ffmpeg to encode one animated slide segment.
 *
 * On `dryRun`, returns the result without spawning ffmpeg (the command string
 * is available via `runFfmpeg`'s dry-run path; this wrapper just reports the
 * output path + aligned duration). Throws `VclawError('ffmpeg_failed', ...)` on
 * a non-zero exit.
 *
 * NOTE: the real-spawn path. Unit tests exercise `buildAnimateArgs` + the
 * dry-run path only; they never run ffmpeg against real media.
 */
export async function animateSlide(
  input: BuildAnimateArgsInput,
  opts: RunFfmpegOptions = {},
): Promise<AnimateSlideResult> {
  const args = buildAnimateArgs(input);
  const duration = alignDurationToFrame(input.durationSec);
  await runFfmpeg(args, opts);
  return { path: input.outputPath, durationMs: Math.round(duration * 1000) };
}
