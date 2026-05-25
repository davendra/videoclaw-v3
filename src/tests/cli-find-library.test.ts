import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

describe('vclaw find-library cli', () => {
  it('finds exact-name Go Bananas library matches from an intent', async () => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/characters') {
        res.writeHead(404).end();
        return;
      }

      const search = url.searchParams.get('search');
      const payload = (() => {
        if (search === 'komo') {
          return [{ id: 170, character_name: 'Komo', base_prompt: 'hero child' }];
        }
        if (search === 'mochi') {
          return [{ id: 247, character_name: 'Mochi', base_prompt: 'small fluffy white rabbit' }];
        }
        if (search === 'hiro') {
          return [{ id: 206, character_name: 'Hiro', base_prompt: 'samurai ally' }];
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
          'find-library',
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
        characters?: Array<{ id?: number; character_name?: string }>;
      };
      assert.deepEqual(
        payload.characters?.map((character) => character.id),
        [170, 247, 206],
      );
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });
});
