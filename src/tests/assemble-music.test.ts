import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateMusic,
  resolveMusicApiKey,
  KIE_API_BASE,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_DURATION_SEC,
} from '../video/assemble/music.js';
import { VclawError } from '../video/errors.js';

type FetchCall = { url: string; init?: RequestInit };

const realFetch = globalThis.fetch;
const realKey = process.env.KIE_API_KEY;

const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04]); // "ID3" mp3-ish

/** Install a fetch mock driven by a per-call handler. Returns recorded calls. */
function mockFetch(handler: (call: FetchCall, index: number) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FetchCall = { url, init };
    const index = calls.length;
    calls.push(call);
    return handler(call, index);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('generateMusic (Kie.ai Suno adapter)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'vclaw-music-'));
    process.env.KIE_API_KEY = 'test-kie-key';
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.KIE_API_KEY;
    else process.env.KIE_API_KEY = realKey;
    await rm(tmp, { recursive: true, force: true });
  });

  it('resolveMusicApiKey throws env_var_missing when key absent', () => {
    delete process.env.KIE_API_KEY;
    assert.throws(
      () => resolveMusicApiKey(),
      (err: unknown) => err instanceof VclawError && err.code === 'env_var_missing',
    );
  });

  it('resolveMusicApiKey prefers explicit key over env', () => {
    assert.equal(resolveMusicApiKey('explicit'), 'explicit');
  });

  it('throws env_var_missing on generate when key absent', async () => {
    delete process.env.KIE_API_KEY;
    await assert.rejects(
      () => generateMusic({ prompt: 'Calm cinematic', outputPath: join(tmp, 'm.mp3'), pollIntervalMs: 0 }),
      (err: unknown) => err instanceof VclawError && err.code === 'env_var_missing',
    );
  });

  it('submits correct request, polls (pending -> SUCCESS), downloads + writes file', async () => {
    const out = join(tmp, 'sub', 'background.mp3');
    const calls = mockFetch((call, index) => {
      if (index === 0) {
        // submit
        return jsonResponse({ code: 200, data: { taskId: 'task-123' } });
      }
      if (index === 1) {
        // first poll: pending
        return jsonResponse({ code: 200, data: { status: 'PENDING' } });
      }
      if (index === 2) {
        // second poll: success with track
        return jsonResponse({
          code: 200,
          data: {
            status: 'SUCCESS',
            response: {
              sunoData: [
                { audioUrl: 'https://cdn.kie.ai/audio/track-1.mp3', title: 'BG', duration: 31.5, tags: 'cinematic' },
              ],
            },
          },
        });
      }
      // download
      return new Response(AUDIO_BYTES, { status: 200 });
    });

    const result = await generateMusic({
      prompt: 'Cinematic orchestral, 120 BPM, D minor',
      durationSec: 30,
      outputPath: out,
      pollIntervalMs: 0,
    });

    // 1 submit + 2 polls + 1 download
    assert.equal(calls.length, 4);

    // submit request shape
    const submit = calls[0];
    assert.equal(submit.url, `${KIE_API_BASE}/api/v1/generate`);
    assert.equal(submit.init?.method, 'POST');
    const submitHeaders = submit.init?.headers as Record<string, string>;
    assert.equal(submitHeaders.Authorization, 'Bearer test-kie-key');
    assert.equal(submitHeaders['Content-Type'], 'application/json');
    const submitBody = JSON.parse(submit.init?.body as string);
    assert.equal(submitBody.prompt, 'Cinematic orchestral, 120 BPM, D minor');
    assert.equal(submitBody.customMode, false);
    assert.equal(submitBody.instrumental, true);
    assert.equal(submitBody.model, DEFAULT_MUSIC_MODEL);

    // poll request shape
    assert.ok(calls[1].url.startsWith(`${KIE_API_BASE}/api/v1/generate/record-info`));
    assert.ok(calls[1].url.includes('taskId=task-123'));
    assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, 'Bearer test-kie-key');

    // download
    assert.equal(calls[3].url, 'https://cdn.kie.ai/audio/track-1.mp3');

    // result + file written
    assert.equal(result.path, out);
    assert.equal(result.durationMs, 31500); // prefers track-reported duration
    const written = await readFile(out);
    assert.deepEqual(new Uint8Array(written), AUDIO_BYTES);
  });

  it('falls back to requested durationSec when track has no duration', async () => {
    const out = join(tmp, 'm.mp3');
    mockFetch((_call, index) => {
      if (index === 0) return jsonResponse({ code: 200, data: { taskId: 't' } });
      if (index === 1) {
        return jsonResponse({
          code: 200,
          data: { status: 'SUCCESS', response: { sunoData: [{ audioUrl: 'https://x/a.mp3' }] } },
        });
      }
      return new Response(AUDIO_BYTES, { status: 200 });
    });
    const result = await generateMusic({ prompt: 'ambient', durationSec: 45, outputPath: out, pollIntervalMs: 0 });
    assert.equal(result.durationMs, 45000);
  });

  it('throws music_gen_failed on non-2xx submit', async () => {
    mockFetch(() => new Response('rate limited', { status: 429 }));
    await assert.rejects(
      () => generateMusic({ prompt: 'x', outputPath: join(tmp, 'm.mp3'), pollIntervalMs: 0 }),
      (err: unknown) => err instanceof VclawError && err.code === 'music_gen_failed',
    );
  });

  it('throws music_gen_failed when submit code != 200', async () => {
    mockFetch(() => jsonResponse({ code: 401, msg: 'bad key' }));
    await assert.rejects(
      () => generateMusic({ prompt: 'x', outputPath: join(tmp, 'm.mp3'), pollIntervalMs: 0 }),
      (err: unknown) => err instanceof VclawError && err.code === 'music_gen_failed',
    );
  });

  it('throws music_gen_failed when generation status is FAILED', async () => {
    mockFetch((_call, index) => {
      if (index === 0) return jsonResponse({ code: 200, data: { taskId: 't' } });
      return jsonResponse({ code: 200, data: { status: 'FAILED', errorMessage: 'no good' } });
    });
    await assert.rejects(
      () => generateMusic({ prompt: 'x', outputPath: join(tmp, 'm.mp3'), pollIntervalMs: 0 }),
      (err: unknown) => err instanceof VclawError && err.code === 'music_gen_failed',
    );
  });

  it('throws music_gen_failed on poll timeout', async () => {
    mockFetch((_call, index) => {
      if (index === 0) return jsonResponse({ code: 200, data: { taskId: 't' } });
      return jsonResponse({ code: 200, data: { status: 'PENDING' } });
    });
    await assert.rejects(
      () =>
        generateMusic({
          prompt: 'x',
          outputPath: join(tmp, 'm.mp3'),
          pollIntervalMs: 0,
          maxPollAttempts: 3,
        }),
      (err: unknown) => err instanceof VclawError && err.code === 'music_gen_failed',
    );
  });

  it('throws music_gen_failed on empty prompt', async () => {
    await assert.rejects(
      () => generateMusic({ prompt: '   ', outputPath: join(tmp, 'm.mp3'), pollIntervalMs: 0 }),
      (err: unknown) => err instanceof VclawError && err.code === 'music_gen_failed',
    );
  });

  it('dryRun returns synthetic result without any fetch or file I/O', async () => {
    const calls = mockFetch(() => {
      throw new Error('fetch should not be called in dryRun');
    });
    const out = join(tmp, 'm.mp3');
    const result = await generateMusic({ prompt: 'x', durationSec: 20, outputPath: out, dryRun: true });
    assert.equal(calls.length, 0);
    assert.equal(result.path, out);
    assert.equal(result.durationMs, 20000);
  });

  it('dryRun defaults to DEFAULT_DURATION_SEC when durationSec omitted', async () => {
    mockFetch(() => {
      throw new Error('no fetch');
    });
    const result = await generateMusic({ prompt: 'x', outputPath: join(tmp, 'm.mp3'), dryRun: true });
    assert.equal(result.durationMs, DEFAULT_DURATION_SEC * 1000);
  });
});
