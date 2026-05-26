import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  synthesizeSpeech,
  listVoices,
  listModels,
  resolveApiKey,
  ELEVENLABS_API_BASE,
  DEFAULT_MODEL_ID,
} from '../video/assemble/tts-elevenlabs.js';
import {
  validateOutputFormat,
  extensionForFormat,
  sceneAudioFilename,
  combinedNarrationFilename,
  formatDuration,
  DEFAULT_OUTPUT_FORMAT,
} from '../video/assemble/audio-utils.js';
import { VclawError } from '../video/errors.js';

type FetchCall = { url: string; init?: RequestInit };

const realFetch = globalThis.fetch;
const realKey = process.env.ELEVENLABS_API_KEY;

function mockFetch(handler: (call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FetchCall = { url, init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04]); // "ID3" mp3-ish

describe('audio-utils (pure helpers)', () => {
  it('validateOutputFormat accepts a valid format', () => {
    assert.equal(validateOutputFormat('mp3_44100_128'), 'mp3_44100_128');
    assert.equal(validateOutputFormat('pcm_24000'), 'pcm_24000');
  });

  it('validateOutputFormat throws invalid_audio_format on a bad value', () => {
    assert.throws(
      () => validateOutputFormat('flac_99999'),
      (err: unknown) =>
        err instanceof VclawError && err.code === 'invalid_audio_format',
    );
  });

  it('DEFAULT_OUTPUT_FORMAT matches the Python pipeline default', () => {
    assert.equal(DEFAULT_OUTPUT_FORMAT, 'mp3_44100_128');
  });

  it('extensionForFormat maps codecs to extensions', () => {
    assert.equal(extensionForFormat('mp3_44100_128'), 'mp3');
    assert.equal(extensionForFormat('pcm_24000'), 'wav');
    assert.equal(extensionForFormat('ulaw_8000'), 'wav');
    assert.equal(extensionForFormat('opus_48000_64'), 'opus');
  });

  it('sceneAudioFilename zero-pads the 1-based scene index', () => {
    assert.equal(sceneAudioFilename(1, 'mp3_44100_128'), 'scene_01.mp3');
    assert.equal(sceneAudioFilename(12, 'pcm_24000'), 'scene_12.wav');
  });

  it('combinedNarrationFilename uses the format extension', () => {
    assert.equal(combinedNarrationFilename('mp3_44100_128'), 'narration.mp3');
  });

  it('formatDuration renders MM:SS.mmm', () => {
    assert.equal(formatDuration(0), '00:00.000');
    assert.equal(formatDuration(1500), '00:01.500');
    assert.equal(formatDuration(65250), '01:05.250');
  });

  it('formatDuration rejects negative/NaN durations', () => {
    assert.throws(() => formatDuration(-1), VclawError);
    assert.throws(() => formatDuration(Number.NaN), VclawError);
  });
});

describe('tts-elevenlabs adapter (mocked fetch)', () => {
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = 'sk_test_key';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
  });

  it('resolveApiKey reads ELEVENLABS_API_KEY', () => {
    assert.equal(resolveApiKey(), 'sk_test_key');
    assert.equal(resolveApiKey('explicit'), 'explicit');
  });

  it('resolveApiKey throws env_var_missing when absent', () => {
    delete process.env.ELEVENLABS_API_KEY;
    assert.throws(
      () => resolveApiKey(),
      (err: unknown) => err instanceof VclawError && err.code === 'env_var_missing',
    );
  });

  it('synthesizeSpeech POSTs the right URL, headers and body, returns bytes', async () => {
    const calls = mockFetch(
      () =>
        new Response(AUDIO_BYTES, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
    );

    const bytes = await synthesizeSpeech({
      voiceId: 'voice123',
      text: 'Hello world',
      voiceSettings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
      },
      outputFormat: 'mp3_44100_128',
    });

    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.ok(
      call.url.startsWith(`${ELEVENLABS_API_BASE}/v1/text-to-speech/voice123`),
      `unexpected url: ${call.url}`,
    );
    assert.ok(call.url.includes('output_format=mp3_44100_128'));
    assert.equal(call.init?.method, 'POST');

    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers['xi-api-key'], 'sk_test_key');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['Accept'], 'audio/mpeg');

    const body = JSON.parse(call.init?.body as string);
    assert.equal(body.text, 'Hello world');
    assert.equal(body.model_id, DEFAULT_MODEL_ID);
    assert.deepEqual(body.voice_settings, {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    });
    // speed omitted when default (1.0) — matches Python behavior
    assert.equal('speed' in body, false);

    assert.deepEqual([...bytes], [...AUDIO_BYTES]);
  });

  it('synthesizeSpeech includes speed only when != 1.0', async () => {
    const calls = mockFetch(() => new Response(AUDIO_BYTES, { status: 200 }));
    await synthesizeSpeech({
      voiceId: 'v',
      text: 'hi',
      voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
      outputFormat: 'mp3_44100_128',
      speed: 1.1,
    });
    const body = JSON.parse(calls[0]!.init?.body as string);
    assert.equal(body.speed, 1.1);
  });

  it('synthesizeSpeech throws tts_failed on a 500', async () => {
    mockFetch(() => new Response('upstream boom', { status: 500, statusText: 'Server Error' }));
    await assert.rejects(
      () =>
        synthesizeSpeech({
          voiceId: 'v',
          text: 'hi',
          voiceSettings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
          outputFormat: 'mp3_44100_128',
        }),
      (err: unknown) => err instanceof VclawError && err.code === 'tts_failed',
    );
  });

  it('synthesizeSpeech throws env_var_missing when key absent', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await assert.rejects(
      () =>
        synthesizeSpeech({
          voiceId: 'v',
          text: 'hi',
          voiceSettings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
          outputFormat: 'mp3_44100_128',
        }),
      (err: unknown) => err instanceof VclawError && err.code === 'env_var_missing',
    );
  });

  it('synthesizeSpeech rejects empty text with tts_failed', async () => {
    await assert.rejects(
      () =>
        synthesizeSpeech({
          voiceId: 'v',
          text: '   ',
          voiceSettings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
          outputFormat: 'mp3_44100_128',
        }),
      (err: unknown) => err instanceof VclawError && err.code === 'tts_failed',
    );
  });

  it('listVoices hits /v2/voices and returns the voices array', async () => {
    const calls = mockFetch(
      () =>
        new Response(JSON.stringify({ voices: [{ voice_id: 'a', name: 'Rachel' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const voices = await listVoices();
    assert.ok(calls[0]!.url.startsWith(`${ELEVENLABS_API_BASE}/v2/voices`));
    assert.equal(calls[0]!.init?.method, 'GET');
    assert.equal(voices.length, 1);
    assert.equal(voices[0]!.voice_id, 'a');
  });

  it('listVoices falls back to /v1/voices when v2 is not ok', async () => {
    let n = 0;
    const calls = mockFetch(() => {
      n += 1;
      if (n === 1) return new Response('nope', { status: 404 });
      return new Response(JSON.stringify({ voices: [{ voice_id: 'b' }] }), { status: 200 });
    });
    const voices = await listVoices();
    assert.equal(calls.length, 2);
    assert.ok(calls[1]!.url.startsWith(`${ELEVENLABS_API_BASE}/v1/voices`));
    assert.equal(voices[0]!.voice_id, 'b');
  });

  it('listModels hits /v1/models and returns the array', async () => {
    const calls = mockFetch(
      () =>
        new Response(JSON.stringify([{ model_id: 'eleven_flash_v2_5' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const models = await listModels();
    assert.equal(calls[0]!.url, `${ELEVENLABS_API_BASE}/v1/models`);
    assert.equal(models[0]!.model_id, 'eleven_flash_v2_5');
  });

  it('listModels throws tts_failed on non-2xx', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await assert.rejects(
      () => listModels(),
      (err: unknown) => err instanceof VclawError && err.code === 'tts_failed',
    );
  });
});
