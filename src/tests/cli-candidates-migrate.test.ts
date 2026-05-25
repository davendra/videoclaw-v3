import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status ?? -1 };
}

function writeAssetManifest(
  root: string,
  slug: string,
  assets: Array<{
    id: string;
    kind: 'video' | 'image' | 'audio' | 'subtitle' | 'other';
    path: string;
    sceneIndex?: number;
  }>,
): void {
  const artifactsDir = join(root, 'projects', slug, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  const manifest = { projectSlug: slug, assets };
  writeFileSync(
    join(artifactsDir, 'asset-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

test('candidates-migrate-from-assets synthesizes candidates + selection from an asset manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-candidates-migrate-'));
  assert.equal(run(['video', 'init', 'migrate-demo', '--root', root, '--mode', 'director']).status, 0);
  writeAssetManifest(root, 'migrate-demo', [
    { id: 'scene-0', kind: 'video', path: 'artifacts/outputs/scene-0.mp4', sceneIndex: 0 },
    { id: 'scene-1', kind: 'video', path: 'artifacts/outputs/scene-1.mp4', sceneIndex: 1 },
    { id: 'scene-2', kind: 'video', path: 'artifacts/outputs/scene-2.mp4', sceneIndex: 2 },
  ]);

  const res = run([
    'video', 'candidates-migrate-from-assets',
    '--project', 'migrate-demo',
    '--root', root,
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.slug, 'migrate-demo');
  assert.equal(payload.dryRun, false);
  assert.equal(payload.sceneCount, 3);
  assert.deepEqual(payload.candidateIds, [
    'scene-0-take-1',
    'scene-1-take-1',
    'scene-2-take-1',
  ]);

  const candidatesPath = join(root, 'projects', 'migrate-demo', 'artifacts', 'scene-candidates.json');
  const selectionPath = join(root, 'projects', 'migrate-demo', 'artifacts', 'scene-selection.json');
  assert.ok(existsSync(candidatesPath), 'scene-candidates.json must exist');
  assert.ok(existsSync(selectionPath), 'scene-selection.json must exist');

  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
  assert.equal(candidates.schemaVersion, 1);
  assert.equal(candidates.scenes.length, 3);
  for (const [i, entry] of candidates.scenes.entries()) {
    assert.equal(entry.sceneIndex, i);
    assert.equal(entry.candidates.length, 1);
    const c = entry.candidates[0];
    assert.equal(c.id, `scene-${i}-take-1`);
    assert.equal(c.generationRound, 1);
    assert.equal(c.status, 'completed');
    assert.equal(c.outputs.length, 1);
    assert.equal(c.outputs[0].kind, 'video');
    assert.equal(c.source.adapter, 'builtin');
    assert.equal(c.source.executionRound, 1);
    assert.equal(c.source.chainedFromCandidateId, null);
  }

  const selection = JSON.parse(readFileSync(selectionPath, 'utf8'));
  assert.equal(selection.schemaVersion, 1);
  assert.equal(selection.scenes.length, 3);
  for (const [i, entry] of selection.scenes.entries()) {
    assert.equal(entry.sceneIndex, i);
    assert.equal(entry.selectedCandidateId, `scene-${i}-take-1`);
    assert.equal(entry.rerollRequested, false);
    assert.equal(entry.chainFromPrev, false);
  }

  const eventsPath = join(root, 'projects', 'migrate-demo', 'events', 'events.jsonl');
  const eventLines = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
  const migrated = eventLines
    .map((line) => JSON.parse(line))
    .filter((e) => e.type === 'scene-candidate.migrated');
  assert.equal(migrated.length, 3, 'one migration event per scene');
});

test('candidates-migrate-from-assets --dry-run does not write artifacts or events', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-candidates-migrate-'));
  assert.equal(run(['video', 'init', 'dry-demo', '--root', root, '--mode', 'director']).status, 0);
  writeAssetManifest(root, 'dry-demo', [
    { id: 'scene-0', kind: 'video', path: 'artifacts/outputs/scene-0.mp4', sceneIndex: 0 },
  ]);

  const res = run([
    'video', 'candidates-migrate-from-assets',
    '--project', 'dry-demo',
    '--root', root,
    '--dry-run',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.sceneCount, 1);

  const candidatesPath = join(root, 'projects', 'dry-demo', 'artifacts', 'scene-candidates.json');
  assert.equal(existsSync(candidatesPath), false, 'dry-run must not write scene-candidates.json');
});

test('candidates-migrate-from-assets refuses when scene-candidates.json already exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-candidates-migrate-'));
  assert.equal(run(['video', 'init', 'conflict-demo', '--root', root, '--mode', 'director']).status, 0);
  writeAssetManifest(root, 'conflict-demo', [
    { id: 'scene-0', kind: 'video', path: 'artifacts/outputs/scene-0.mp4', sceneIndex: 0 },
  ]);

  // First run seeds scene-candidates.json.
  const first = run([
    'video', 'candidates-migrate-from-assets',
    '--project', 'conflict-demo',
    '--root', root,
  ]);
  assert.equal(first.status, 0, `stderr: ${first.stderr}`);

  // Second run must refuse.
  const second = run([
    'video', 'candidates-migrate-from-assets',
    '--project', 'conflict-demo',
    '--root', root,
  ]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /migrate-refused/);
});

test('candidates-migrate-from-assets fails when asset-manifest.json is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-candidates-migrate-'));
  assert.equal(run(['video', 'init', 'no-assets', '--root', root, '--mode', 'director']).status, 0);

  const res = run([
    'video', 'candidates-migrate-from-assets',
    '--project', 'no-assets',
    '--root', root,
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /asset-manifest-missing/);
});
