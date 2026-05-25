import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('vclaw character-auto-create cli', () => {
  it('reuses existing library matches and creates missing characters from input json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-character-auto-'));
    const inputPath = join(root, 'characters.json');
    await writeFile(inputPath, JSON.stringify([
      {
        name: 'Mochi',
        description: 'Small fluffy white rabbit with long soft ears.',
        style: 'villeneuve cinematic photograph',
      },
      {
        name: 'Nova',
        description: 'A determined spaceship captain with a silver jacket.',
        style: 'cinematic sci-fi still',
      },
    ], null, 2));

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/characters' && req.method === 'GET') {
        const search = url.searchParams.get('search');
        const data = search === 'Mochi'
          ? [{ id: 247, character_name: 'Mochi', base_prompt: 'rabbit companion' }]
          : [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data }));
        return;
      }
      if (url.pathname === '/images' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: 'https://cdn.example.test/nova.png' }));
        return;
      }
      if (url.pathname === '/upload-for-editing' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ image_id: 991 }));
        return;
      }
      if (url.pathname === '/characters' && req.method === 'POST') {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { id: 555 } }));
        return;
      }
      res.writeHead(404).end();
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
          'character-auto-create',
          '--project',
          'alpha',
          '--root',
          root,
          '--input',
          inputPath,
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
        results?: Record<string, { characterId?: number; created?: boolean }>;
      };
      assert.equal(payload.results?.Mochi?.characterId, 247);
      assert.equal(payload.results?.Mochi?.created, false);
      assert.equal(payload.results?.Nova?.characterId, 555);
      assert.equal(payload.results?.Nova?.created, true);

      const store = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'characters', 'characters.json'), 'utf-8'),
      ) as { characters?: Array<{ name?: string; goBananasId?: number }> };
      assert.ok(store.characters?.some((character) => character.name === 'Mochi' && character.goBananasId === 247));
      assert.ok(store.characters?.some((character) => character.name === 'Nova' && character.goBananasId === 555));
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      await rm(root, { recursive: true, force: true });
    }
  });
});
