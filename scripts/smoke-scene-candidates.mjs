#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function runCLI(args) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
}

const root = mkdtempSync(join(tmpdir(), 'smoke-scene-candidates-'));

try {
  runCLI(['video', 'init', 'demo', '--root', root, '--mode', 'director']);
  runCLI([
    'video', 'brief',
    '--project', 'demo',
    '--root', root,
    '--title', 'Smoke',
    '--intent', 'verify scene candidates',
  ]);
  runCLI([
    'video', 'storyboard',
    '--project', 'demo',
    '--root', root,
    '--scene', 'open',
    '--scene', 'middle',
    '--scene', 'close',
  ]);

  // Seed candidates directly (smoke is about the operator surface, not the
  // execute path itself).
  const candidatesDir = join(root, 'projects', 'demo', 'artifacts');
  mkdirSync(candidatesDir, { recursive: true });
  const candidates = {
    schemaVersion: 1,
    scenes: [0, 1, 2].map((i) => ({
      sceneIndex: i,
      candidates: [
        {
          id: `scene-${i}-take-1`,
          generationRound: 1,
          prompt: `scene ${i}`,
          route: 'veo-direct',
          submittedAt: '2026-04-22T10:00:00.000Z',
          completedAt: '2026-04-22T10:00:30.000Z',
          status: 'completed',
          outputs: [{ kind: 'video', path: `artifacts/outputs/scene-${i}-take-1.mp4` }],
          source: {
            executionRound: 1,
            adapter: 'builtin',
            chainedFromCandidateId: null,
          },
        },
      ],
    })),
  };
  writeFileSync(
    join(candidatesDir, 'scene-candidates.json'),
    JSON.stringify(candidates, null, 2) + '\n',
  );

  // Operator actions across three scenes:
  //   - scene 0: select a take
  //   - scene 1: reject the only take (leaves selection unset)
  //   - scene 2: request a reroll with chain-from-prev on
  runCLI([
    'video', 'select-candidate',
    '--project', 'demo',
    '--root', root,
    '--scene', '0',
    '--candidate-id', 'scene-0-take-1',
  ]);
  runCLI([
    'video', 'reject-candidate',
    '--project', 'demo',
    '--root', root,
    '--scene', '1',
    '--candidate-id', 'scene-1-take-1',
  ]);
  runCLI([
    'video', 'reroll-scene',
    '--project', 'demo',
    '--root', root,
    '--scene', '2',
    '--chain-from-prev', 'on',
  ]);

  // candidates-list surfaces all three scenes + a portfolio summary.
  const listOut = JSON.parse(runCLI([
    'video', 'candidates-list',
    '--project', 'demo',
    '--root', root,
  ]));
  if (!Array.isArray(listOut.scenes) || listOut.scenes.length !== 3) {
    throw new Error(`candidates-list expected 3 scenes, got ${listOut.scenes?.length}`);
  }
  if (listOut.summary.totalCandidates !== 3) {
    throw new Error(`candidates-list summary.totalCandidates expected 3, got ${listOut.summary.totalCandidates}`);
  }

  // candidates-show returns a full candidate record by id.
  const showOut = JSON.parse(runCLI([
    'video', 'candidates-show',
    '--project', 'demo',
    '--root', root,
    '--candidate-id', 'scene-0-take-1',
  ]));
  if (!showOut.candidate || showOut.candidate.id !== 'scene-0-take-1') {
    throw new Error(`candidates-show missing or wrong id: ${JSON.stringify(showOut)}`);
  }

  // storyboard.md review should include the Candidates section with the take id.
  runCLI([
    'video', 'storyboard-review',
    '--project', 'demo',
    '--root', root,
    '--mode', 'director',
  ]);
  const md = readFileSync(join(root, 'projects', 'demo', 'storyboard.md'), 'utf8');
  const mdLower = md.toLowerCase();
  if (!mdLower.includes('candidate')) {
    throw new Error('storyboard.md missing Candidates section');
  }
  if (!md.includes('scene-0-take-1')) {
    throw new Error('storyboard.md missing take id scene-0-take-1');
  }

  // doctor-project just has to run without throwing — shape varies.
  const doctor = JSON.parse(runCLI([
    'video', 'doctor-project',
    '--project', 'demo',
    '--root', root,
  ]));
  if (typeof doctor !== 'object' || doctor === null) {
    throw new Error('doctor-project returned non-object');
  }

  process.stdout.write('smoke-scene-candidates: OK\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}
