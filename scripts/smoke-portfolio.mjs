#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'vclaw-portfolio-smoke-'));
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
  const init = run(['video', 'init', 'portfolio-smoke', '--root', root]);
  const brief = run([
    'video',
    'brief',
    '--project',
    'portfolio-smoke',
    '--root',
    root,
    '--title',
    'Portfolio Smoke',
    '--intent',
    'Portfolio visibility validation.',
    '--platform',
    'reels',
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
    'portfolio-smoke',
    '--root',
    root,
    '--scene',
    'Hook shot',
  ]);
  const executionPlan = run(['video', 'execution-plan', '--project', 'portfolio-smoke', '--root', root]);
  const index = run(['video', 'index', '--root', root]);
  const report = run(['video', 'report', '--root', root]);
  const csv = run(['video', 'export-csv', '--root', root, '--output-dir', join(root, 'exports')]);
  const projectsCsv = await readFile(csv.projectsCsvPath, 'utf-8');

  process.stdout.write(`${JSON.stringify({
    root,
    init,
    brief,
    storyboard,
    executionPlan,
    index,
    reportSummary: {
      totalProjects: report.metrics?.totalProjects,
      project: report.index?.projects?.[0],
    },
    csv,
    projectsCsv,
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
