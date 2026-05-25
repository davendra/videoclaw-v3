import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetPoolForTests,
  fetchGeminiWithPool,
  getPoolLabels,
  getPoolSize,
  markKeyRateLimited,
  nextAvailableKey,
} from '../video/gemini-key-pool.js';

beforeEach(() => {
  _resetPoolForTests();
  delete process.env.GEMINI_API_KEYS;
  delete process.env.GOOGLE_API_KEYS;
  delete process.env.GOOGLE_API_KEY;
});

describe('gemini-key-pool discovery', () => {
  it('parses comma-separated GEMINI_API_KEYS', () => {
    process.env.GEMINI_API_KEYS = 'AIzaABC,AIzaDEF,AIzaGHI';
    assert.equal(getPoolSize(), 3);
    assert.ok(getPoolLabels()[0]?.includes('AIzaAB'));
  });

  it('parses semicolon and newline separators', () => {
    process.env.GEMINI_API_KEYS = 'AIzaONE;AIzaTWO\nAIzaTHREE';
    assert.equal(getPoolSize(), 3);
  });

  it('deduplicates identical keys across sources', () => {
    process.env.GEMINI_API_KEYS = 'AIzaOK,AIzaOK';
    process.env.GOOGLE_API_KEY = 'AIzaOK';
    assert.equal(getPoolSize(), 1);
  });

  it('falls back to GOOGLE_API_KEY when the pool is otherwise unset', () => {
    process.env.GOOGLE_API_KEY = 'AIzaSOLO';
    assert.equal(getPoolSize(), 1);
  });
});

describe('gemini-key-pool rotation', () => {
  it('rotates through all keys before repeating', async () => {
    process.env.GEMINI_API_KEYS = 'A,B,C';
    const picks: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      picks.push((await nextAvailableKey())!.key);
    }

    const counts = picks.reduce<Record<string, number>>((accumulator, key) => ({
      ...accumulator,
      [key]: (accumulator[key] ?? 0) + 1,
    }), {});

    assert.deepEqual(counts, { A: 2, B: 2, C: 2 });
  });

  it('skips keys that are cooling down', async () => {
    process.env.GEMINI_API_KEYS = 'A,B,C';
    await nextAvailableKey();
    markKeyRateLimited('A', 10_000);

    const picks = new Set<string>();
    for (let index = 0; index < 4; index += 1) {
      picks.add((await nextAvailableKey())!.key);
    }

    assert.ok(!picks.has('A'));
    assert.ok(picks.has('B'));
    assert.ok(picks.has('C'));
  });
});

describe('fetchGeminiWithPool', () => {
  it('rotates to the next key when the first key returns 429', async () => {
    process.env.GEMINI_API_KEYS = 'FAIL,OK';
    const keysUsed: string[] = [];

    const response = await fetchGeminiWithPool(
      (key) => `https://example.test/generate?key=${key}`,
      { method: 'POST' },
      {
        fetcher: async (url: string | URL | Request) => {
          const value = typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.toString()
              : url.url;
          const key = new URL(value).searchParams.get('key') ?? '';
          keysUsed.push(key);
          if (key === 'FAIL') {
            return new Response('rate limited', { status: 429 });
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(keysUsed, ['FAIL', 'OK']);
  });

  it('returns the final 429 when the pool is exhausted', async () => {
    process.env.GEMINI_API_KEYS = 'A,B';

    const response = await fetchGeminiWithPool(
      (key) => `https://example.test/generate?key=${key}`,
      { method: 'POST' },
      {
        maxAttempts: 2,
        fetcher: async () => new Response('exhausted', { status: 429 }),
      },
    );

    assert.equal(response.status, 429);
  });
});
