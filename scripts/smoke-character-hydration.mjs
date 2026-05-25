#!/usr/bin/env node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'vclaw-character-hydration-smoke-'));
const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

async function run(args, env = process.env) {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env,
  });
  return JSON.parse(result.stdout);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/characters' && req.method === 'GET') {
    const search = url.searchParams.get('search');
    const payload = (() => {
      if (search === 'komo') return [{ id: 170, character_name: 'Komo', description: 'Child hero with a determined stance.' }];
      if (search === 'mochi') return [{ id: 247, character_name: 'Mochi', description: 'Small fluffy white rabbit.' }];
      return [];
    })();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: payload }));
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
  await writeFile(join(root, '.env.local'), 'GO_BANANAS_API_KEY=token\n');
  const seedPath = join(root, 'character-seed.json');
  await writeFile(seedPath, JSON.stringify([
    {
      name: 'Nova',
      description: 'A determined spaceship captain with a silver jacket.',
      style: 'cinematic sci-fi still',
    },
  ], null, 2));

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server address unavailable');
  }
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const env = { ...process.env, GO_BANANAS_API_KEY: 'token' };

  const create = await run([
    'video',
    'create',
    'Komo and Mochi recruit Nova for a neon sci-fi corridor escape.',
    '--root',
    root,
    '--project',
    'hydration-smoke',
    '--production-mode',
    'director',
    '--scenes',
    '3',
    '--import-library-characters',
    '--auto-create-characters',
    seedPath,
    '--api-url',
    apiUrl,
  ], env);

  const charactersStore = JSON.parse(
    await readFile(join(root, 'projects', 'hydration-smoke', 'characters', 'characters.json'), 'utf-8'),
  );
  const briefArtifact = JSON.parse(
    await readFile(join(root, 'projects', 'hydration-smoke', 'artifacts', 'brief.json'), 'utf-8'),
  );

  process.stdout.write(`${JSON.stringify({
    root,
    create,
    importedCharacterIds: briefArtifact.metadata?.goBananasCharacters?.map((entry) => entry.goBananasId),
    characterStore: charactersStore.characters,
  }, null, 2)}\n`);
} finally {
  server.closeAllConnections();
  server.close();
  await once(server, 'close').catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
