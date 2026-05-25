import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status ?? -1 };
}

function seedCandidates(root: string, slug: string, scenes: Array<{
  sceneIndex: number;
  candidates: Array<{ id: string; generationRound: number; status: 'pending' | 'completed' | 'failed' | 'cancelled' }>;
}>): void {
  const artifactsDir = join(root, 'projects', slug, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  const artifact = {
    schemaVersion: 1,
    scenes: scenes.map((scene) => ({
      sceneIndex: scene.sceneIndex,
      candidates: scene.candidates.map((c) => ({
        id: c.id,
        generationRound: c.generationRound,
        prompt: `Scene ${scene.sceneIndex} take ${c.generationRound}`,
        route: 'seedance-direct',
        submittedAt: '2026-04-22T00:00:00.000Z',
        status: c.status,
        outputs: [],
        source: {
          executionRound: c.generationRound,
          adapter: 'builtin' as const,
          chainedFromCandidateId: null,
        },
      })),
    })),
  };
  writeFileSync(
    join(artifactsDir, 'scene-candidates.json'),
    JSON.stringify(artifact, null, 2),
    'utf8',
  );
}

test('candidates-list returns all scenes and a summary', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-candidates-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        { id: 'scene-0-take-1', generationRound: 1, status: 'completed' },
        { id: 'scene-0-take-2', generationRound: 2, status: 'pending' },
      ],
    },
    {
      sceneIndex: 1,
      candidates: [{ id: 'scene-1-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);

  const res = run(['video', 'candidates-list', '--project', 'demo', '--root', root]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.scenes.length, 2);
  assert.equal(payload.summary.totalCandidates, 3);
  assert.equal(payload.summary.completedCount, 2);
  assert.equal(payload.summary.pendingCount, 1);
});

test('candidates-list filters by --scene', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-candidates-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
    {
      sceneIndex: 1,
      candidates: [
        { id: 'scene-1-take-1', generationRound: 1, status: 'completed' },
        { id: 'scene-1-take-2', generationRound: 2, status: 'pending' },
      ],
    },
  ]);

  const res = run(['video', 'candidates-list', '--project', 'demo', '--root', root, '--scene', '1']);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.sceneIndex, 1);
  assert.equal(payload.candidates.length, 2);
  assert.equal(payload.candidates[0].id, 'scene-1-take-1');
  // Summary is across the whole artifact, not just the filtered scene.
  assert.equal(payload.summary.totalCandidates, 3);
});

test('candidates-list on a project with no candidates returns an empty shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-candidates-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const res = run(['video', 'candidates-list', '--project', 'demo', '--root', root]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.deepEqual(payload.scenes, []);
  assert.equal(payload.summary.totalCandidates, 0);
});

test('candidates-show returns a full candidate record by id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-candidates-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 2,
      candidates: [{ id: 'scene-2-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);

  const res = run(['video', 'candidates-show', '--project', 'demo', '--root', root, '--candidate-id', 'scene-2-take-1']);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.sceneIndex, 2);
  assert.equal(payload.candidate.id, 'scene-2-take-1');
  assert.equal(payload.candidate.generationRound, 1);
  assert.equal(payload.candidate.status, 'completed');
});

test('candidates-show fails with non-zero exit on unknown id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-candidates-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);

  const res = run(['video', 'candidates-show', '--project', 'demo', '--root', root, '--candidate-id', 'scene-99-take-99']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /unknown candidate/);
});

test('candidates-show requires --candidate-id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-candidates-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const res = run(['video', 'candidates-show', '--project', 'demo', '--root', root]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /--candidate-id/);
});
