/**
 * Public TTS entrypoint for the assemble stage (sub-slice 3b).
 *
 * Source of truth: `skills/video-replicator/scripts/generate_tts.py`.
 *
 * This sub-commit (3b.1 + 3b.2) wires the basic text->speech path through the
 * ElevenLabs adapter. The richer behaviors from the Python pipeline are
 * deferred to later 3b sub-commits and explicitly marked TODO below.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  synthesizeSpeech,
  DEFAULT_MODEL_ID,
  DEFAULT_STABILITY,
  DEFAULT_SIMILARITY_BOOST,
  type VoiceSettings,
} from './tts-elevenlabs.js';
import {
  validateOutputFormat,
  DEFAULT_OUTPUT_FORMAT,
  sceneAudioFilename,
  type OutputFormat,
} from './audio-utils.js';
import type { AssembleManifestEntry } from './types.js';

/** A single narration segment: one scene's text. */
export interface TtsSegment {
  /** 1-based scene index, used for filenames + manifest ordering. */
  sceneIndex: number;
  text: string;
}

export interface TtsInput {
  /** Path to a transcript JSON file (per-scene narration). */
  transcriptPath?: string;
  /** Inline segments, used instead of `transcriptPath` when provided. */
  segments?: TtsSegment[];
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  /** Boost similarity to original voice (default true). */
  speakerBoost?: boolean;
  outputFormat?: string;
  /** Directory to write per-scene + combined audio into. */
  outputDir: string;
  /** Read from ELEVENLABS_API_KEY when omitted. */
  apiKey?: string;
  /** Skip provider calls and file writes; report intended actions only. */
  dryRun?: boolean;
}

export interface TtsSceneOutput {
  sceneIndex: number;
  path: string;
  sizeBytes: number;
}

export interface TtsResult {
  status: 'complete' | 'dry-run';
  /** Per-scene audio file paths. */
  scenes: TtsSceneOutput[];
  /**
   * Path to the combined narration track.
   *
   * TODO(3b later): the Python pipeline concatenates per-scene audio (with
   * inter-scene padding) into a single narration track via FFmpeg. That
   * conductor/concat step is deferred; for now this is undefined unless a
   * later sub-commit fills it in.
   */
  combinedPath?: string;
  manifest: AssembleManifestEntry[];
}

/**
 * Generate per-scene narration audio from a transcript or inline segments.
 *
 * TODO(3b later sub-commits):
 *  - transcript-file loading (load_transcript): parse the per-scene narration
 *    JSON, incl. SEALCAM+-embedded transcripts. For now require `segments`.
 *  - conductor / sync-to-slides: align narration to slide timings + pad to
 *    target durations.
 *  - bake-narration / speech-to-speech (swap) subcommands.
 *  - combined-track concat via FFmpeg.
 */
export async function generateTts(input: TtsInput): Promise<TtsResult> {
  const outputFormat: OutputFormat = validateOutputFormat(
    input.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
  );

  const segments = resolveSegments(input);

  const voiceSettings: VoiceSettings = {
    stability: input.stability ?? DEFAULT_STABILITY,
    similarity_boost: input.similarityBoost ?? DEFAULT_SIMILARITY_BOOST,
    style: input.style ?? 0.0,
    use_speaker_boost: input.speakerBoost ?? true,
  };
  const modelId = input.modelId ?? DEFAULT_MODEL_ID;

  if (input.dryRun) {
    return {
      status: 'dry-run',
      scenes: segments.map((s) => ({
        sceneIndex: s.sceneIndex,
        path: join(input.outputDir, sceneAudioFilename(s.sceneIndex, outputFormat)),
        sizeBytes: 0,
      })),
      manifest: [],
    };
  }

  await mkdir(input.outputDir, { recursive: true });

  const scenes: TtsSceneOutput[] = [];
  const manifest: AssembleManifestEntry[] = [];

  for (const segment of segments) {
    const bytes = await synthesizeSpeech({
      voiceId: input.voiceId,
      text: segment.text,
      modelId,
      voiceSettings,
      outputFormat,
      speed: input.speed,
      apiKey: input.apiKey,
    });
    const filename = sceneAudioFilename(segment.sceneIndex, outputFormat);
    const path = join(input.outputDir, filename);
    await writeFile(path, bytes);
    scenes.push({ sceneIndex: segment.sceneIndex, path, sizeBytes: bytes.byteLength });
    manifest.push({
      kind: 'narration',
      path,
      // TODO(3b later): probe real audio duration via FFmpeg.
      durationMs: 0,
      sceneIndex: segment.sceneIndex,
      sizeBytes: bytes.byteLength,
      generator: `elevenlabs:${modelId}`,
    });
  }

  return { status: 'complete', scenes, manifest };
}

function resolveSegments(input: TtsInput): TtsSegment[] {
  if (input.segments && input.segments.length > 0) {
    return input.segments;
  }
  if (input.transcriptPath) {
    // TODO(3b later): load + parse the transcript JSON file here.
    throw new Error(
      'generateTts: transcriptPath loading is not implemented yet (deferred to a later 3b sub-commit); pass inline `segments` for now.',
    );
  }
  throw new Error('generateTts: provide either `segments` or `transcriptPath`.');
}
