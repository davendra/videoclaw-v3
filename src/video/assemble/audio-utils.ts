/**
 * Pure audio helpers for the assemble stage (no I/O).
 *
 * Ported from the validation/derivation logic in
 * `skills/video-replicator/scripts/generate_tts.py`. Everything here is
 * deterministic + unit-testable; network and filesystem work lives in
 * `tts.ts` / `tts-elevenlabs.ts`.
 */
import { VclawError } from '../errors.js';

/**
 * ElevenLabs `output_format` values we accept. Each maps to a container/
 * codec + sample-rate + bitrate. The Python CLI takes a free string, but we
 * validate against the documented ElevenLabs set so a typo surfaces as a
 * clean `invalid_audio_format` error rather than an opaque API 4xx.
 */
export const VALID_OUTPUT_FORMATS = [
  'mp3_22050_32',
  'mp3_44100_32',
  'mp3_44100_64',
  'mp3_44100_96',
  'mp3_44100_128',
  'mp3_44100_192',
  'pcm_8000',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
  'pcm_48000',
  'ulaw_8000',
  'alaw_8000',
  'opus_48000_32',
  'opus_48000_64',
  'opus_48000_96',
  'opus_48000_128',
  'opus_48000_192',
] as const;

export type OutputFormat = typeof VALID_OUTPUT_FORMATS[number];

export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'mp3_44100_128';

/**
 * Validate an ElevenLabs output-format string. Returns the normalized format
 * on success; throws `VclawError('invalid_audio_format', ...)` otherwise.
 */
export function validateOutputFormat(format: string): OutputFormat {
  if ((VALID_OUTPUT_FORMATS as readonly string[]).includes(format)) {
    return format as OutputFormat;
  }
  throw new VclawError(
    'invalid_audio_format',
    `Unsupported audio output format: "${format}". Valid formats: ${VALID_OUTPUT_FORMATS.join(', ')}`,
    { format, valid: VALID_OUTPUT_FORMATS },
  );
}

/**
 * The file extension that corresponds to a given output format
 * (mp3 -> mp3, pcm/ulaw/alaw -> wav, opus -> opus).
 */
export function extensionForFormat(format: string): string {
  if (format.startsWith('mp3_')) return 'mp3';
  if (format.startsWith('opus_')) return 'opus';
  // pcm / ulaw / alaw are raw; we wrap them as wav on disk.
  return 'wav';
}

/**
 * Derive a per-scene audio filename. Scene indexes are 1-based in the
 * transcript / on disk to mirror the Python pipeline's `scene_NN` naming.
 */
export function sceneAudioFilename(sceneIndex: number, format: string): string {
  const padded = String(sceneIndex).padStart(2, '0');
  return `scene_${padded}.${extensionForFormat(format)}`;
}

/** Filename for the combined narration track. */
export function combinedNarrationFilename(format: string): string {
  return `narration.${extensionForFormat(format)}`;
}

/**
 * Format a duration (milliseconds) as `MM:SS.mmm` for human-readable logs
 * and report entries.
 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new VclawError('invalid_audio_format', `Invalid duration: ${durationMs}`, {
      durationMs,
    });
  }
  const totalSeconds = durationMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round(durationMs % 1000);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}
