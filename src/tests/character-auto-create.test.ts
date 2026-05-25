import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoCreateCharacters } from '../video/character-auto-create.js';
import { ensureProjectWorkspace } from '../video/workspace.js';
import { listCharacterProfiles } from '../video/characters.js';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  } as Response;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

describe('autoCreateCharacters', () => {
  it('reuses exact-name matches and imports them into the project character store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-character-auto-'));
    try {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: async (input: string | URL) => {
          const url = String(input);
          if (url.includes('/characters?search=Mochi')) {
            return jsonResponse(200, {
              data: [{ id: 247, character_name: 'Mochi', base_prompt: 'rabbit companion' }],
            });
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
      });

      const results = await autoCreateCharacters(
        [{ name: 'Mochi', description: 'Small fluffy white rabbit.', style: 'villeneuve cinematic photograph' }],
        { projectSlug: 'alpha', root, apiKey: 'token', apiUrl: 'https://example.test/api' },
      );

      assert.equal(results.Mochi?.characterId, 247);
      assert.equal(results.Mochi?.created, false);
      const workspace = await ensureProjectWorkspace('alpha', root);
      const characters = await listCharacterProfiles(workspace);
      assert.equal(characters.length, 1);
      assert.equal(characters[0]?.goBananasId, 247);
      assert.deepEqual(characters[0]?.referenceAssets, ['gobananas://character/247']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates missing characters through the Go Bananas REST flow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-character-auto-'));
    try {
      const requests: string[] = [];
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: async (input: string | URL, init?: RequestInit) => {
          const url = String(input);
          requests.push(`${init?.method ?? 'GET'} ${url}`);
          if (url.includes('/characters?search=Nova')) {
            return jsonResponse(200, { data: [] });
          }
          if (url.endsWith('/images')) {
            return jsonResponse(200, { url: 'https://cdn.example.test/nova.png' });
          }
          if (url.endsWith('/upload-for-editing')) {
            return jsonResponse(200, { image_id: 991 });
          }
          if (url.endsWith('/characters')) {
            return jsonResponse(201, { data: { id: 555 } });
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
      });

      const results = await autoCreateCharacters(
        [{ name: 'Nova', description: 'A determined spaceship captain.', style: 'cinematic sci-fi still' }],
        { projectSlug: 'alpha', root, apiKey: 'token', apiUrl: 'https://example.test/api' },
      );

      assert.equal(results.Nova?.characterId, 555);
      assert.equal(results.Nova?.created, true);
      assert.equal(results.Nova?.imageUrl, 'https://cdn.example.test/nova.png');
      assert.deepEqual(requests, [
        'GET https://example.test/api/characters?search=Nova&exact=true',
        'POST https://example.test/api/images',
        'POST https://example.test/api/upload-for-editing',
        'POST https://example.test/api/characters',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
