#!/usr/bin/env node
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-cancel-smoke-'));
const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env,
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${args.join(' ')}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

try {
  await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

  const adapterPath = join(root, 'veo-adapter.sh');
  await writeFile(adapterPath, [
    '#!/bin/sh',
    'INPUT=$(cat)',
    'if echo "$INPUT" | grep -q \'"action":"cancel"\'; then',
    '  printf \'{"status":"cancelled","externalJobId":"job-smoke-cancel","issues":[]}\';',
    'elif echo "$INPUT" | grep -q \'"action":"poll"\'; then',
    '  printf \'{"status":"pending","externalJobId":"job-smoke-cancel","outputs":[],"issues":[]}\';',
    'else',
    '  printf \'{"externalJobId":"job-smoke-cancel","status":"submitted"}\';',
    'fi',
    '',
  ].join('\n'));
  await chmod(adapterPath, 0o755);

  const env = {
    ...process.env,
    VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
  };

  const init = run(['video', 'init', 'cancel-smoke', '--root', root], env);
  const brief = run([
    'video',
    'brief',
    '--project',
    'cancel-smoke',
    '--root',
    root,
    '--title',
    'Cancel Smoke',
    '--intent',
    'Cancel smoke validation.',
  ], env);
  const storyboard = run([
    'video',
    'storyboard',
    '--project',
    'cancel-smoke',
    '--root',
    root,
    '--scene',
    'Scene one',
  ], env);
  const assets = run([
    'video',
    'assets',
    '--project',
    'cancel-smoke',
    '--root',
    root,
    '--asset',
    'image:/tmp/image.png:0:veo-useapi',
  ], env);
  const execute = run(['video', 'execute', '--project', 'cancel-smoke', '--root', root], env);
  const cancel = run(['video', 'execute-cancel', '--project', 'cancel-smoke', '--root', root], env);
  const report = JSON.parse(
    await readFile(join(root, 'projects', 'cancel-smoke', 'artifacts', 'execution-report.json'), 'utf-8'),
  );
  const events = await readFile(join(root, 'projects', 'cancel-smoke', 'events', 'events.jsonl'), 'utf-8');

  process.stdout.write(`${JSON.stringify({
    root,
    init,
    brief,
    storyboard,
    assets,
    execute,
    cancel,
    report,
    hasCancelEvent: events.includes('execution.cancelled'),
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
