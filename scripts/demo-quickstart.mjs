#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const PAUSE_MS = Number(process.env.VCLAW_DEMO_PAUSE_MS ?? 900);
const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
const root = await mkdtemp(join(tmpdir(), 'vclaw-demo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runJson(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`command failed: ${args.join(' ')}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

async function step(display, args, describe) {
  process.stdout.write(`${CYAN}▶${RESET} ${BOLD}vclaw${RESET} ${display}\n`);
  const out = runJson(args);
  let summary;
  try { summary = describe(out) ?? 'ok'; } catch { summary = 'ok'; }
  process.stdout.write(`  ${GREEN}✓${RESET} ${summary}\n\n`);
  await sleep(PAUSE_MS);
}

try {
  process.stdout.write(`${BOLD}vclaw-video-core · 60-second tour${RESET}\n`);
  process.stdout.write(`${DIM}explicit artifacts · multi-provider · no silent fallbacks${RESET}\n\n`);
  await sleep(600);

  await step(
    'video init demo-ad',
    ['video', 'init', 'demo-ad', '--root', root],
    (out) => `project ready · next stage: ${BOLD}${firstDefined(out.nextStage, out.status?.nextStage, 'brief')}${RESET}`,
  );

  await step(
    'video brief --project demo-ad --title "Launch tease" --intent "15s reveal"',
    [
      'video', 'brief', '--project', 'demo-ad', '--root', root,
      '--title', 'Launch tease',
      '--intent', '15s product reveal',
      '--platform', 'shorts',
      '--aspect-ratio', '9:16',
      '--quality', 'quality',
      '--resolution', '1080p',
      '--audio', 'off',
      '--outputs', '2',
    ],
    () => 'brief.json written · shorts · 9:16 · 1080p · 2 outputs',
  );

  await step(
    'video storyboard --project demo-ad --scene hook --scene reveal --scene cta',
    [
      'video', 'storyboard', '--project', 'demo-ad', '--root', root,
      '--scene', 'Hook on hands unboxing',
      '--scene', 'Product reveal',
      '--scene', 'CTA on logo',
    ],
    () => '3 scenes written · storyboard.json',
  );

  await step(
    'video assets --project demo-ad --asset image:logo.png:0:seedance',
    [
      'video', 'assets', '--project', 'demo-ad', '--root', root,
      '--asset', 'image:/tmp/demo-frame.png:0:seedance',
    ],
    () => '1 asset pinned · ready to plan',
  );

  await step(
    'video plan --project demo-ad',
    ['video', 'plan', '--project', 'demo-ad', '--root', root],
    (out) => {
      const route = firstDefined(out.plan?.route, out.route, out.executionPlan?.route, 'seedance-direct');
      const segs = firstDefined(out.plan?.segments?.length, out.segments?.length, out.executionPlan?.segments?.length);
      return `route: ${BOLD}${route}${RESET}${segs ? ` · ${segs} segment(s)` : ''} · dry-run safe`;
    },
  );

  await step(
    'video produce --project demo-ad --dry-run',
    ['video', 'produce', '--project', 'demo-ad', '--root', root, '--dry-run'],
    () => 'dry-run passed · no provider submission',
  );

  await step(
    'video status --project demo-ad',
    ['video', 'status', '--project', 'demo-ad', '--root', root],
    (out) => {
      const stage = firstDefined(out.nextStage, out.status?.nextStage, 'review');
      const review = firstDefined(out.storyboardReviewState, out.status?.storyboardReviewState, 'missing');
      return `next: ${BOLD}${stage}${RESET} · review state: ${review}`;
    },
  );

  await step(
    'video report',
    ['video', 'report', '--root', root],
    (out) => {
      const total = firstDefined(out.metrics?.totalProjects, out.totalProjects, 1);
      return `portfolio · ${total} project(s) · machine-readable JSON`;
    },
  );

  await step(
    'video export-obsidian --project demo-ad',
    ['video', 'export-obsidian', '--project', 'demo-ad', '--root', root, '--output-dir', join(root, 'vault', 'Projects')],
    () => `Obsidian note exported · ${DIM}…/vault/Projects/demo-ad.md${RESET}`,
  );

  process.stdout.write(`${BOLD}${GREEN}done${RESET} · your campaign is JSON on disk.\n`);
  process.stdout.write(`${DIM}github.com/davendra/vclaw-video-core${RESET}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
