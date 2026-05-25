import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('vclaw character-import-library cli', () => {
  it('imports exact-name Go Bananas matches from intent into the project character store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-character-import-'));
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/characters' || req.method !== 'GET') {
        res.writeHead(404).end();
        return;
      }
      const search = url.searchParams.get('search');
      const payload = (() => {
        if (search === 'komo') {
          return [{ id: 170, character_name: 'Komo', description: 'Child hero with a determined stance.' }];
        }
        if (search === 'mochi') {
          return [{ id: 247, character_name: 'Mochi', description: 'Small fluffy white rabbit.' }];
        }
        if (search === 'hiro') {
          return [{ id: 206, character_name: 'Hiro', description: 'Stoic samurai ally.' }];
        }
        return [];
      })();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: payload }));
    });

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address unavailable');
      }

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          cliPath,
          'video',
          'character-import-library',
          '--project',
          'alpha',
          '--root',
          root,
          '--intent',
          'Komo and Mochi meet Hiro in Neo Tokyo',
          '--api-url',
          `http://127.0.0.1:${address.port}`,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            GO_BANANAS_API_KEY: 'token',
          },
        },
      );

      assert.doesNotMatch(stderr ?? '', /Unknown|Error:/);
      const payload = JSON.parse(stdout) as {
        imported?: Array<{ name?: string; goBananasId?: number }>;
      };
      assert.deepEqual(
        payload.imported?.map((character) => character.goBananasId),
        [170, 247, 206],
      );

      const store = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'characters', 'characters.json'), 'utf-8'),
      ) as { characters?: Array<{ name?: string; goBananasId?: number; referenceAssets?: string[] }> };
      assert.ok(store.characters?.some((character) => character.name === 'Komo' && character.goBananasId === 170));
      assert.ok(store.characters?.some((character) => character.name === 'Mochi' && character.goBananasId === 247));
      assert.ok(store.characters?.some((character) => character.name === 'Hiro' && character.goBananasId === 206));
      assert.ok(store.characters?.every((character) => character.referenceAssets?.[0]?.startsWith('gobananas://character/')));
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      await rm(root, { recursive: true, force: true });
    }
  });
});
