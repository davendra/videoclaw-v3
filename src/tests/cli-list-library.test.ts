import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('vclaw list-library cli', () => {
  it('lists Go Bananas character rows through the top-level library browser alias', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-list-library-'));
    const server = createServer((req, res) => {
      if ((req.url ?? '').startsWith('/characters')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            {
              id: 247,
              character_name: 'Mochi',
              base_prompt: 'Mochi is a small fluffy white rabbit with clean concise prompt text.',
            },
            {
              id: 170,
              character_name: 'Komo',
              base_prompt: 'Komo is a determined child hero with a clear silhouette and cinematic style cues.',
            },
          ],
          pagination: { hasMore: false, offset: 0, limit: 100 },
        }));
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
          'list-library',
          '--name-regex',
          '^Komo$',
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
      assert.match(stdout, /Candidates \(1\):/);
      assert.match(stdout, /Komo/);
      assert.match(stdout, /\(dry-run\)/);
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      await rm(root, { recursive: true, force: true });
    }
  });
});
