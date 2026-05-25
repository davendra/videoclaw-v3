#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-smoke-'));
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
  const veoCliRoot = join(root, 'vclaw-cli');
  const outputDir = join(veoCliRoot, 'output-videos');
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(veoCliRoot, 'cookie.json'), '{"session":"ok"}\n');
  await writeFile(join(veoCliRoot, 'flow.ts'), 'console.log("stub");\n');

  const bunStub = join(root, 'bun-stub.sh');
  const commandCapturePath = join(root, 'veo-command.txt');
  await writeFile(bunStub, [
    '#!/bin/sh',
    `printf '%s\\n' "$@" > ${JSON.stringify(commandCapturePath)}`,
    'mkdir -p output-videos',
    'printf fake-video > "output-videos/$(date +%s)-scene-0.mp4"',
    '',
  ].join('\n'));
  await chmod(bunStub, 0o755);

  const env = {
    ...process.env,
    VCLAW_VEO_BUN_BIN: bunStub,
    VCLAW_VEO_CLI_ROOT: veoCliRoot,
    USEAPI_API_TOKEN: process.env.USEAPI_API_TOKEN ?? 'smoke-token',
    USEAPI_ACCOUNT_EMAIL: process.env.USEAPI_ACCOUNT_EMAIL ?? 'smoke@example.com',
  };

  const init = run(['video', 'init', 'veo-smoke', '--root', root, '--mode', 'storyboard'], env);
  const brief = run([
    'video',
    'brief',
    '--project',
    'veo-smoke',
    '--root',
    root,
    '--mode',
    'storyboard',
    '--title',
    'Veo Smoke',
    '--intent',
    'Native Veo smoke validation.',
    '--platform',
    'youtube',
    '--aspect-ratio',
    '16:9',
    '--quality',
    'quality',
    '--outputs',
    '2',
  ], env);
  const storyboard = run([
    'video',
    'storyboard',
    '--project',
    'veo-smoke',
    '--root',
    root,
    '--mode',
    'storyboard',
    '--scene',
    'Hero shot',
  ], env);
  run([
    'video',
    'assets',
    '--project',
    'veo-smoke',
    '--root',
    root,
    '--asset',
    'image:/tmp/veo-frame.png:0:veo-useapi',
  ], env);

  const execute = run(['video', 'execute', '--project', 'veo-smoke', '--root', root, '--mode', 'storyboard'], env);
  const executeStatus = execute.report?.status === 'live-submitted'
    ? run(['video', 'execute-status', '--project', 'veo-smoke', '--root', root, '--mode', 'storyboard'], env)
    : { skipped: true, reason: `execute status is ${execute.report?.status ?? 'unknown'}` };
  const status = run(['video', 'status', '--project', 'veo-smoke', '--root', root, '--mode', 'storyboard'], env);
  const report = run(['video', 'report', '--root', root, '--mode', 'storyboard'], env);
  const veoCommand = await readFile(commandCapturePath, 'utf-8');

  process.stdout.write(`${JSON.stringify({
    root,
    init,
    brief,
    storyboard,
    execute,
    executeStatus,
    status,
    reportSummary: {
      totalProjects: report.metrics?.totalProjects,
      nextStage: report.index?.projects?.[0]?.nextStage,
      executionProfile: report.index?.projects?.[0]?.executionProfile,
    },
    veoCommand,
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
