#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'vclaw-runtime-smoke-'));
const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${args.join(' ')}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

try {
  await writeFile(join(root, '.env.local'), 'SUTUI_API_KEY=test-key\n');

  const init = run(['video', 'init', 'smoke', '--root', root]);
  const brief = run([
    'video',
    'brief',
    '--project',
    'smoke',
    '--root',
    root,
    '--title',
    'Smoke',
    '--intent',
    'Smoke runtime validation.',
    '--platform',
    'shorts',
    '--aspect-ratio',
    '9:16',
    '--quality',
    'quality',
    '--resolution',
    '1080p',
    '--audio',
    'off',
    '--outputs',
    '2',
  ]);
  const storyboard = run([
    'video',
    'storyboard',
    '--project',
    'smoke',
    '--root',
    root,
    '--scene',
    'Hook shot',
    '--scene',
    'Product reveal',
  ]);
  run([
    'video',
    'assets',
    '--project',
    'smoke',
    '--root',
    root,
    '--asset',
    'image:/tmp/smoke-frame.png:0:seedance',
  ]);
  const executionPlan = run(['video', 'execution-plan', '--project', 'smoke', '--root', root]);
  const dryRun = run(['video', 'execute', '--project', 'smoke', '--root', root, '--dry-run']);
  const status = run(['video', 'status', '--project', 'smoke', '--root', root]);
  const report = run(['video', 'report', '--root', root]);
  const obsidian = run(['video', 'export-obsidian', '--project', 'smoke', '--root', root, '--output-dir', join(root, 'vault', 'Projects')]);
  const noteHead = (await readFile(obsidian.outputPath, 'utf-8')).split('\n').slice(0, 40).join('\n');

  process.stdout.write(`${JSON.stringify({
    root,
    init,
    brief,
    storyboard,
    executionPlan,
    dryRun,
    status,
    reportSummary: {
      totalProjects: report.metrics?.totalProjects,
      nextStage: report.index?.projects?.[0]?.nextStage,
      executionProfile: report.index?.projects?.[0]?.executionProfile,
      promptGuidance: report.index?.projects?.[0]?.promptGuidance,
    },
    obsidian,
    noteHead,
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
