import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteCharacter,
  extractLibraryIntentQueries,
  findLibraryCharactersByIntent,
  formatRow,
  listAllCharacters,
  parseLibraryCleanArgs,
  patchCharacter,
  searchCharactersByExactName,
  runLibraryClean,
  selectCandidates,
  type GoBananasCharacter,
} from '../video/library-clean.js';

const originalFetch = globalThis.fetch;
const characters: GoBananasCharacter[] = [
  { id: 1, character_name: 'Komo', base_prompt: 'short prompt' },
  { id: 141, character_name: 'Luna the Moon Creature', base_prompt: 'moon-headed celestial being' },
  { id: 244, character_name: 'Marcus', base_prompt: 'x'.repeat(600) },
];

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

describe('listAllCharacters', () => {
  it('collects paginated Go Bananas character responses', async () => {
    const urls: string[] = [];
    let requestCount = 0;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async (input: string | URL) => {
        urls.push(String(input));
        requestCount += 1;
        if (requestCount === 1) {
          return jsonResponse(200, {
            data: characters.slice(0, 2),
            pagination: { hasMore: true, offset: 0, limit: 2 },
          });
        }
        return jsonResponse(200, {
          characters: characters.slice(2),
          pagination: { hasMore: false, offset: 2, limit: 1 },
        });
      },
    });

    const listed = await listAllCharacters('token', 'https://example.test/api');
    assert.equal(listed.length, 3);
    assert.deepEqual(listed.map((character) => character.id), [1, 141, 244]);
    assert.deepEqual(urls, [
      'https://example.test/api/characters?offset=0',
      'https://example.test/api/characters?offset=2',
    ]);
  });
});

describe('extractLibraryIntentQueries', () => {
  it('keeps capitalized proper nouns and skips generic words', () => {
    assert.deepEqual(
      extractLibraryIntentQueries('Komo and Mochi meet Hiro in Neo Tokyo with a rabbit'),
      ['komo', 'mochi', 'hiro', 'neo', 'tokyo'],
    );
  });
});

describe('searchCharactersByExactName', () => {
  it('calls the exact-match Go Bananas search endpoint', async () => {
    let seenUrl = '';
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async (input: string | URL) => {
        seenUrl = String(input);
        return jsonResponse(200, {
          data: [{ id: 247, character_name: 'Mochi', base_prompt: 'rabbit companion' }],
        });
      },
    });

    const results = await searchCharactersByExactName('mochi', 'token', 'https://example.test/api');
    assert.equal(results.length, 1);
    assert.equal(seenUrl, 'https://example.test/api/characters?search=mochi&exact=true');
  });
});

describe('findLibraryCharactersByIntent', () => {
  it('returns deduped exact-name matches for capitalized character names in an intent', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async (input: string | URL) => {
        const url = String(input);
        const search = new URL(url).searchParams.get('search');
        if (search === 'komo') {
          return jsonResponse(200, {
            data: [{ id: 170, character_name: 'Komo', base_prompt: 'hero child' }],
          });
        }
        if (search === 'mochi') {
          return jsonResponse(200, {
            data: [{ id: 247, character_name: 'Mochi', base_prompt: 'small fluffy white rabbit' }],
          });
        }
        if (search === 'hiro') {
          return jsonResponse(200, {
            data: [{ id: 206, character_name: 'Hiro', base_prompt: 'samurai ally' }],
          });
        }
        return jsonResponse(200, { data: [] });
      },
    });

    const results = await findLibraryCharactersByIntent(
      'Komo and Mochi meet Hiro in Neo Tokyo',
      'token',
      'https://example.test/api',
    );
    assert.deepEqual(results.map((character) => character.id), [170, 247, 206]);
  });
});

describe('deleteCharacter', () => {
  it('treats missing characters as already deleted', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async () => jsonResponse(404, { error: 'not found' }),
    });

    const result = await deleteCharacter(247, 'token', 'https://example.test/api');
    assert.deepEqual(result, { deleted: false });
  });
});

describe('patchCharacter', () => {
  it('returns the updated character payload', async () => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async (_input: string | URL, init?: RequestInit) => {
        assert.equal(init?.method, 'PATCH');
        assert.equal(init?.body, JSON.stringify({ base_prompt: 'Slim prompt' }));
        return jsonResponse(200, {
          data: {
            id: 247,
            character_name: 'Mochi',
            base_prompt: 'Slim prompt',
          },
        });
      },
    });

    const result = await patchCharacter(
      247,
      { base_prompt: 'Slim prompt' },
      'token',
      'https://example.test/api',
    );
    assert.equal(result.character_name, 'Mochi');
    assert.equal(result.base_prompt, 'Slim prompt');
  });
});

describe('selectCandidates', () => {
  it('returns no candidates when no selector is set', () => {
    const opts = { ids: new Set<number>(), nameRegex: null, bloated: false, maxPromptChars: 400 };
    assert.deepEqual(selectCandidates(characters, opts), []);
  });

  it('matches explicit ids, regexes, and bloated prompts', () => {
    const opts = {
      ids: new Set([1]),
      nameRegex: /moon/i,
      bloated: true,
      maxPromptChars: 400,
    };
    assert.deepEqual(
      selectCandidates(characters, opts).map((character) => character.id),
      [1, 141, 244],
    );
  });
});

describe('parseLibraryCleanArgs', () => {
  it('parses selectors and patch options', () => {
    const opts = parseLibraryCleanArgs([
      '--ids',
      '244,141',
      '--name-regex',
      'mochi',
      '--bloated',
      '--dry-run',
      '--yes',
      '--patch',
      '247',
      '--base-prompt',
      'Slim prompt',
      '--api-url',
      'https://example.test/api',
    ]);

    assert.deepEqual([...opts.ids].sort((left, right) => left - right), [141, 244]);
    assert.ok(opts.nameRegex?.test('Mochi'));
    assert.equal(opts.bloated, true);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.yes, true);
    assert.equal(opts.patchId, 247);
    assert.equal(opts.patchBasePrompt, 'Slim prompt');
    assert.equal(opts.baseUrl, 'https://example.test/api');
  });
});

describe('formatRow', () => {
  it('shows prompt length and truncates long prompt content', () => {
    const row = formatRow({ id: 244, character_name: 'Marcus', base_prompt: 'y'.repeat(500) });
    assert.match(row, /500ch/);
    assert.match(row, /…"/);
  });
});

describe('runLibraryClean', () => {
  it('supports dry-run patch mode without issuing a network request', async () => {
    let fetchCalled = false;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async () => {
        fetchCalled = true;
        throw new Error('fetch should not be called in dry-run patch mode');
      },
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (message?: unknown) => {
      stdout.push(String(message ?? ''));
    };
    console.error = (message?: unknown) => {
      stderr.push(String(message ?? ''));
    };

    try {
      const exitCode = await runLibraryClean({
        dryRun: true,
        ids: new Set<number>(),
        nameRegex: null,
        bloated: false,
        maxPromptChars: 400,
        yes: false,
        patchId: 247,
        patchBasePrompt: 'Slim prompt',
        baseUrl: 'https://example.test/api',
        apiKey: 'token',
      });

      assert.equal(exitCode, 0);
      assert.equal(fetchCalled, false);
      assert.ok(stderr.some((line) => line.includes('PATCH /characters/247 base_prompt')));
      assert.ok(stdout.some((line) => line.includes('(dry-run)')));
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});
