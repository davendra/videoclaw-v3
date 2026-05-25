import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

function seedCandidates(root: string, slug: string): void {
  const artifactsDir = join(root, 'projects', slug, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    join(artifactsDir, 'scene-candidates.json'),
    JSON.stringify({
      schemaVersion: 1,
      scenes: [
        {
          sceneIndex: 0,
          candidates: [
            {
              id: 'scene-0-take-1',
              generationRound: 1,
              prompt: 'p',
              route: 'seedance-direct',
              submittedAt: '2026-04-22T00:00:00.000Z',
              status: 'completed',
              outputs: [],
              source: { executionRound: 1, adapter: 'builtin', chainedFromCandidateId: null },
            },
            {
              id: 'scene-0-take-2',
              generationRound: 2,
              prompt: 'p',
              route: 'seedance-direct',
              submittedAt: '2026-04-22T00:00:00.000Z',
              status: 'completed',
              outputs: [],
              source: { executionRound: 2, adapter: 'builtin', chainedFromCandidateId: null },
            },
          ],
        },
      ],
    }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(artifactsDir, 'scene-selection.json'),
    JSON.stringify({
      schemaVersion: 1,
      scenes: [
        {
          sceneIndex: 0,
          selectedCandidateId: 'scene-0-take-2',
          rejectedCandidateIds: [],
          pendingCandidateIds: [],
          rerollRequested: false,
          chainFromPrev: false,
        },
      ],
    }, null, 2),
    'utf8',
  );
}

test('storyboard-review writes a Candidates & selection section when candidates exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task14-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(
    run(['video', 'brief', '--project', 'demo', '--root', root, '--mode', 'director', '--title', 'Demo', '--intent', 'x']).status,
    0,
  );
  assert.equal(
    run(['video', 'storyboard', '--project', 'demo', '--root', root, '--mode', 'director', '--scene', 'open']).status,
    0,
  );

  seedCandidates(root, 'demo');

  assert.equal(
    run(['video', 'storyboard-review', '--project', 'demo', '--root', root, '--mode', 'director']).status,
    0,
  );
  const md = readFileSync(join(root, 'projects', 'demo', 'storyboard.md'), 'utf8');
  assert.match(md, /Candidates & selection/);
  assert.match(md, /scene-0-take-1/);
  assert.match(md, /scene-0-take-2/);
  assert.match(md, /✅/);
  assert.match(md, /Chain from prev: no/);
  assert.match(md, /Reroll requested: no/);
});
