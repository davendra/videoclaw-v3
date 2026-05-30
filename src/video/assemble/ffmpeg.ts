/**
 * Shared FFmpeg / ffprobe helper for the assemble stage (sub-slice 3e).
 *
 * Source of truth: `skills/video-replicator/scripts/ffmpeg_wrapper.py`.
 *
 * This ports the proven Python `FFmpegWrapper` spawn primitives to Node:
 *  - `runFfmpeg` mirrors `FFmpegWrapper.run` — prepends `-y`, captures stderr,
 *    raises on a non-zero exit (here: `VclawError('ffmpeg_failed', ...)`).
 *  - `ffprobeDuration` mirrors `FFmpegWrapper.probe`/`get_duration` — runs
 *    ffprobe with `format=duration` and returns the value in **milliseconds**.
 *  - `STANDARD_VIDEO_ARGS` / `STANDARD_AUDIO_ARGS` encode the exact codec /
 *    rate / preset / crf knobs the Python encoders use, so segments produced by
 *    `animate-slides.ts` (and later 3h stitch) share one uniform encoding.
 *
 * IMPORTANT — testing boundary: the *arg shapes* built here are the unit-tested
 * surface. Actually spawning ffmpeg/ffprobe against real media (and eyeballing
 * the result) is a HUMAN integration checkpoint, explicitly out of scope for
 * the unit tests. Tests exercise the dry-run path + the env/bin override only;
 * they never require ffmpeg to be installed.
 *
 * ffmpeg/ffprobe are system binaries (no npm dep); they are spawned directly.
 */
import { spawn } from 'node:child_process';
import { VclawError } from '../errors.js';

/**
 * Standard H.264 video encoding params — matches the Python encoders
 * (`-r 24 -c:v libx264 -preset fast -crf 20`). Keeping these uniform across
 * every segment is what lets the 3h stitch step concat segments cleanly.
 */
export const STANDARD_VIDEO_ARGS: readonly string[] = [
  '-r',
  '24',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-crf',
  '20',
];

/**
 * Standard AAC audio encoding params — matches the Python encoders
 * (`-c:a aac -ar 44100 -ac 2`).
 */
export const STANDARD_AUDIO_ARGS: readonly string[] = [
  '-c:a',
  'aac',
  '-ar',
  '44100',
  '-ac',
  '2',
];

/** Resolve the ffmpeg binary: explicit opt > VCLAW_FFMPEG_BIN env > `ffmpeg`. */
export function resolveFfmpegBin(explicit?: string): string {
  return explicit ?? process.env.VCLAW_FFMPEG_BIN ?? 'ffmpeg';
}

/** Resolve the ffprobe binary: explicit opt > VCLAW_FFPROBE_BIN env > `ffprobe`. */
export function resolveFfprobeBin(explicit?: string): string {
  return explicit ?? process.env.VCLAW_FFPROBE_BIN ?? 'ffprobe';
}

/**
 * Per-clip cut-at-N tail trim (WS9). Returns the ffmpeg `-t <seconds>` flag pair
 * when `maxSeconds` is a positive number, else `[]` (no trim). PURE — splice the
 * result into a per-clip ffmpeg arg array just before the output path.
 */
export function trimTailArgs(maxSeconds?: number): string[] {
  return maxSeconds && maxSeconds > 0 ? ['-t', String(maxSeconds)] : [];
}

/**
 * Letterbox normalization filter (WS9). Scales the source to the canvas
 * `width` (preserving aspect via `-2`) and pads it onto a `width`x`height`
 * black canvas, producing cinematic bars. Mirrors the DHUAAN TITLEFIT pattern
 * (`scale=W:-2,pad=W:H:0:(oh-ih)/2:black`). Returns '' when no `ratio` is given
 * (an empty/undefined ratio disables the filter). PURE — no ffmpeg spawned.
 *
 * `ratio` is the target aspect ratio label (e.g. '2.39:1'); the actual letterbox
 * geometry comes from the `width`/`height` canvas the caller already targets.
 */
export function letterboxFilter(
  ratio: string | undefined,
  width: number,
  height: number,
): string {
  if (!ratio) return '';
  return `scale=${width}:-2,pad=${width}:${height}:0:(oh-ih)/2:black`;
}

export interface RunFfmpegOptions {
  /** Build + return the command string without spawning ffmpeg. */
  dryRun?: boolean;
  /** Override the ffmpeg binary (falls back to VCLAW_FFMPEG_BIN, then `ffmpeg`). */
  ffmpegBin?: string;
}

export interface RunFfmpegResult {
  exitCode: number;
  stderr: string;
  /** The fully-resolved command line that was (or would be) run. */
  command: string;
}

/**
 * Render a binary + args into a printable command string. Tokens containing
 * whitespace or shell-significant chars are single-quoted so the printed
 * command is copy-pasteable. This is for *logging/inspection only* — the actual
 * spawn passes the args array verbatim (no shell), so quoting never affects
 * execution.
 */
function formatCommand(bin: string, args: string[]): string {
  const quote = (tok: string): string =>
    /[^A-Za-z0-9_\-./:=,]/.test(tok) ? `'${tok.replace(/'/g, `'\\''`)}'` : tok;
  return [bin, ...args].map(quote).join(' ');
}

/**
 * Run ffmpeg with the given args. The `-y` flag (overwrite output without
 * prompting) is prepended automatically, mirroring the Python wrapper, so
 * callers never block on an interactive prompt.
 *
 * On `dryRun`, returns the command string without spawning (exitCode 0,
 * empty stderr). On a non-zero exit, throws `VclawError('ffmpeg_failed', ...)`.
 *
 * NOTE: This is the real-spawn path. Unit tests must use `dryRun: true` — we do
 * NOT run ffmpeg in tests.
 */
export async function runFfmpeg(
  args: string[],
  opts: RunFfmpegOptions = {},
): Promise<RunFfmpegResult> {
  const bin = resolveFfmpegBin(opts.ffmpegBin);
  // Prepend -y exactly like FFmpegWrapper.run.
  const fullArgs = ['-y', ...args];
  const command = formatCommand(bin, fullArgs);

  if (opts.dryRun) {
    return { exitCode: 0, stderr: '', command };
  }

  return await new Promise<RunFfmpegResult>((resolve, reject) => {
    const child = spawn(bin, fullArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(
        new VclawError(
          'ffmpeg_failed',
          `Failed to spawn ffmpeg ("${bin}"): ${err.message}`,
          { bin, command },
        ),
      );
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(
          new VclawError(
            'ffmpeg_failed',
            `ffmpeg exited with code ${exitCode}.`,
            { exitCode, command, stderr: stderr.trim().slice(0, 500) },
          ),
        );
        return;
      }
      resolve({ exitCode, stderr, command });
    });
  });
}

export interface FfprobeDurationOptions {
  /** Return 0 without spawning (dry-run friendly, mirrors callers). */
  dryRun?: boolean;
  /** Override the ffprobe binary (falls back to VCLAW_FFPROBE_BIN, then `ffprobe`). */
  ffprobeBin?: string;
}

/**
 * Probe a media file's duration, returned in **milliseconds**.
 *
 * Mirrors `FFmpegWrapper.probe(entries="format=duration")` + `get_duration`:
 *   ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <path>
 *
 * On `dryRun`, returns 0 without spawning. Throws `VclawError('ffmpeg_failed', ...)`
 * if ffprobe fails or emits an unparseable duration.
 */
export async function ffprobeDuration(
  path: string,
  opts: FfprobeDurationOptions = {},
): Promise<number> {
  if (opts.dryRun) return 0;

  const bin = resolveFfprobeBin(opts.ffprobeBin);
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ];
  const command = formatCommand(bin, args);

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(
        new VclawError('ffmpeg_failed', `Failed to spawn ffprobe ("${bin}"): ${err.message}`, {
          bin,
          command,
        }),
      );
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(
          new VclawError('ffmpeg_failed', `ffprobe exited with code ${exitCode} for "${path}".`, {
            exitCode,
            command,
            stderr: stderr.trim().slice(0, 500),
          }),
        );
        return;
      }
      const seconds = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(seconds)) {
        reject(
          new VclawError(
            'ffmpeg_failed',
            `ffprobe returned an unparseable duration for "${path}": ${JSON.stringify(stdout.trim())}`,
            { command },
          ),
        );
        return;
      }
      resolve(Math.round(seconds * 1000));
    });
  });
}

export interface IsValidMp4Options {
  /** Override the ffprobe binary (falls back to VCLAW_FFPROBE_BIN, then `ffprobe`). */
  ffprobeBin?: string;
  /** Probe timeout in ms; on expiry the probe is killed and false is returned. Default 15000. */
  timeoutMs?: number;
}

/**
 * True iff ffprobe can read a positive duration from `path`. Catches
 * truncated/no-moov MP4s that pass existence+size checks but fail at
 * stitch. Ported from parallel_video_gen._ffprobe_is_valid_mp4. Never
 * throws — returns false on any probe failure / missing file / timeout.
 *
 * Mirrors the Python guard's args exactly:
 *   ffprobe -v error -show_entries format=duration -of csv=p=0 <path>
 * returning true only when ffprobe exits 0 AND stdout trims to a finite
 * number > 0.
 */
export async function isValidMp4(path: string, opts: IsValidMp4Options = {}): Promise<boolean> {
  const bin = resolveFfprobeBin(opts.ffprobeBin);
  const timeoutMs = opts.timeoutMs ?? 15000;
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    path,
  ];

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      // Spawn threw synchronously (e.g. binary not found on some platforms).
      done(false);
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(false);
    }, timeoutMs);

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    // Missing binary / spawn failure → false (never throws).
    child.on('error', () => done(false));

    child.on('close', (code) => {
      if (code !== 0) {
        done(false);
        return;
      }
      const seconds = Number.parseFloat(stdout.trim());
      done(Number.isFinite(seconds) && seconds > 0);
    });
  });
}
