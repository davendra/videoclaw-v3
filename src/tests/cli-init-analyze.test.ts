import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw init/analyze cli', () => {
  it('initializes a project workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-init-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });

      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { workspace?: { manifestPath?: string } };
      const manifest = JSON.parse(await readFile(payload.workspace!.manifestPath!, 'utf-8')) as { slug?: string };
      assert.equal(manifest.slug, 'launch-teaser');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes an analyze artifact into the project workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-analyze-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'analyze-template',
          '--project',
          'launch-teaser',
          '--root',
          root,
          '--source',
          'https://example.com/ref.mp4',
          '--title',
          'Reference Ad',
          '--pacing',
          'fast',
          '--motion',
          'motion-clips',
          '--beat',
          'hook',
          '--beat',
          'payoff',
          '--keep',
          'energy',
          '--change',
          'topic',
          '--var',
          'product'
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { artifactPath?: string; artifact?: { reference?: { title?: string } } };
      const artifact = JSON.parse(await readFile(payload.artifactPath!, 'utf-8')) as { keep?: string[] };
      const context = await readFile(join(root, '.omx', 'video-context.md'), 'utf-8');
      assert.equal(payload.artifact?.reference?.title, 'Reference Ad');
      assert.deepEqual(artifact.keep, ['energy']);
      assert.match(context, /analyze: captured reference "Reference Ad" for project launch-teaser/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can auto-generate analyze output through the Gemini-backed path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-analyze-'));
    const server = createServer((request, response) => {
      request.resume();
      if (!request.url?.includes('key=test-key')) {
        response.writeHead(400);
        response.end('missing key');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' });
      response.end(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                pacing: { label: 'fast', notes: ['hook in first second'] },
                structure: { hook: 'Open on disruption', beats: ['hook', 'demo', 'cta'], ending: 'Brand lockup' },
                motionClassification: { primaryMode: 'motion-clips', notes: ['live action'] },
                keep: ['high energy'],
                change: ['product'],
                reusableVariables: ['product', 'offer'],
              }),
            }],
          },
        }],
      }));
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const endpoint = `http://127.0.0.1:${port}/generate`;

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const child = spawn(
        process.execPath,
        [
          cliPath,
          'video',
          'analyze-template',
          '--project',
          'launch-teaser',
          '--root',
          root,
          '--source',
          'https://example.com/ref.mp4',
          '--title',
          'Reference Ad',
          '--auto',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            GEMINI_API_KEYS: 'test-key',
            VCLAW_GEMINI_API_ENDPOINT: endpoint,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf-8');
      });
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 0));
      });

      assert.equal(exitCode, 0, stderr);
      const payload = JSON.parse(stdout) as { artifactPath?: string; artifact?: { pacing?: { label?: string } } };
      const artifact = JSON.parse(await readFile(payload.artifactPath!, 'utf-8')) as { reusableVariables?: string[] };
      assert.equal(payload.artifact?.pacing?.label, 'fast');
      assert.deepEqual(artifact.reusableVariables, ['product', 'offer']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
