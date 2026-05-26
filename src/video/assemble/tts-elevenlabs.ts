/**
 * ElevenLabs TTS adapter (fetch-based).
 *
 * Ported from `skills/video-replicator/scripts/generate_tts.py`:
 *  - API base:           https://api.elevenlabs.io
 *  - auth header:        xi-api-key: <ELEVENLABS_API_KEY>
 *  - core TTS call:      POST /v1/text-to-speech/{voice_id}
 *                          ?output_format=<fmt>
 *                          body { text, model_id, voice_settings }
 *                          Accept: audio/mpeg -> returns raw audio bytes
 *  - list voices:        GET  /v2/voices?page_size=100  (fallback /v1/voices)
 *  - list models:        GET  /v1/models
 *
 * This adapter covers only the basic text->speech + listing surface
 * (sub-slice 3b.2). The dialogue / with-timestamps / speech-to-speech
 * variants from the Python source are intentionally NOT ported here yet —
 * see TODOs in `tts.ts`.
 */
import { VclawError } from '../errors.js';

export const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io';

export const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';
export const DEFAULT_STABILITY = 0.5;
export const DEFAULT_SIMILARITY_BOOST = 0.75;

/** voice_settings object sent in the TTS request body. */
export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  /** Style exaggeration 0.0-1.0 (default 0). */
  style: number;
  /** Boost similarity to original voice (default true). */
  use_speaker_boost: boolean;
}

export interface SynthesizeSpeechInput {
  voiceId: string;
  text: string;
  modelId?: string;
  voiceSettings: VoiceSettings;
  outputFormat: string;
  /** Speech speed; only sent when != 1.0 (matches Python behavior). */
  speed?: number;
  /** Read from ELEVENLABS_API_KEY when omitted. */
  apiKey?: string;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name?: string;
  [key: string]: unknown;
}

export interface ElevenLabsModel {
  model_id: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Resolve the API key from the explicit input or the environment.
 * Throws `env_var_missing` if absent.
 */
export function resolveApiKey(explicit?: string): string {
  const key = explicit ?? process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new VclawError(
      'env_var_missing',
      'ELEVENLABS_API_KEY is not set. Export it (e.g. `export ELEVENLABS_API_KEY=sk_...`) before running TTS.',
      { envVar: 'ELEVENLABS_API_KEY' },
    );
  }
  return key;
}

/**
 * Synthesize speech for a single block of text. Returns the raw audio bytes
 * (mp3 / pcm / etc. per `outputFormat`).
 */
export async function synthesizeSpeech(input: SynthesizeSpeechInput): Promise<Uint8Array> {
  const apiKey = resolveApiKey(input.apiKey);
  const modelId = input.modelId ?? DEFAULT_MODEL_ID;

  if (!input.text.trim()) {
    throw new VclawError('tts_failed', 'Cannot synthesize empty text.', {
      voiceId: input.voiceId,
    });
  }

  const url = new URL(
    `${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`,
  );
  url.searchParams.set('output_format', input.outputFormat);

  const body: Record<string, unknown> = {
    text: input.text,
    model_id: modelId,
    voice_settings: input.voiceSettings,
  };
  if (input.speed !== undefined && input.speed !== 1.0) {
    body.speed = input.speed;
  }

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await safeReadText(resp);
    throw new VclawError(
      'tts_failed',
      `ElevenLabs TTS request failed: ${resp.status} ${resp.statusText}`,
      { status: resp.status, voiceId: input.voiceId, detail: detail.slice(0, 300) },
    );
  }

  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * List available voices. Tries the v2 endpoint first, falling back to v1
 * (mirrors the Python `list_voices`).
 */
export async function listVoices(apiKey?: string): Promise<ElevenLabsVoice[]> {
  const key = resolveApiKey(apiKey);

  let resp = await fetch(`${ELEVENLABS_API_BASE}/v2/voices?page_size=100`, {
    method: 'GET',
    headers: { 'xi-api-key': key },
  });
  if (!resp.ok) {
    resp = await fetch(`${ELEVENLABS_API_BASE}/v1/voices`, {
      method: 'GET',
      headers: { 'xi-api-key': key },
    });
  }
  if (!resp.ok) {
    const detail = await safeReadText(resp);
    throw new VclawError(
      'tts_failed',
      `ElevenLabs list-voices request failed: ${resp.status} ${resp.statusText}`,
      { status: resp.status, detail: detail.slice(0, 300) },
    );
  }
  const data = (await resp.json()) as { voices?: ElevenLabsVoice[] };
  return data.voices ?? [];
}

/** List available TTS models (mirrors the Python `list_models`). */
export async function listModels(apiKey?: string): Promise<ElevenLabsModel[]> {
  const key = resolveApiKey(apiKey);
  const resp = await fetch(`${ELEVENLABS_API_BASE}/v1/models`, {
    method: 'GET',
    headers: { 'xi-api-key': key },
  });
  if (!resp.ok) {
    const detail = await safeReadText(resp);
    throw new VclawError(
      'tts_failed',
      `ElevenLabs list-models request failed: ${resp.status} ${resp.statusText}`,
      { status: resp.status, detail: detail.slice(0, 300) },
    );
  }
  const data = await resp.json();
  return Array.isArray(data) ? (data as ElevenLabsModel[]) : [];
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}
