import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
        outputs: c.status === 'completed'
          ? [{ kind: 'video', path: `/tmp/${c.id}.mp4` }]
          : [],
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

function readSelection(root: string, slug: string): { schemaVersion: number; scenes: Array<Record<string, unknown>> } {
  const path = join(root, 'projects', slug, 'artifacts', 'scene-selection.json');
  if (!existsSync(path)) return { schemaVersion: 1, scenes: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readEvents(root: string, slug: string): Array<{ type: string; payload?: Record<string, unknown> }> {
  const path = join(root, 'projects', slug, 'events', 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readAssetManifest(root: string, slug: string): { projectSlug: string; assets: Array<{ kind: string; path: string; sceneIndex?: number }> } {
  const path = join(root, 'projects', slug, 'artifacts', 'asset-manifest.json');
  if (!existsSync(path)) return { projectSlug: slug, assets: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeAssetManifest(root: string, slug: string, assets: Array<{ id?: string; kind: string; path: string; sceneIndex?: number }>): void {
  const artifactsDir = join(root, 'projects', slug, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    join(artifactsDir, 'asset-manifest.json'),
    JSON.stringify({ projectSlug: slug, assets }, null, 2),
    'utf8',
  );
}

// ------- select-candidate -------

test('select-candidate records the selected id and emits a scene-candidate.selected event', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        { id: 'scene-0-take-1', generationRound: 1, status: 'completed' },
        { id: 'scene-0-take-2', generationRound: 2, status: 'completed' },
      ],
    },
  ]);

  const res = run([
    'video', 'select-candidate',
    '--project', 'demo', '--root', root,
    '--scene', '0', '--candidate-id', 'scene-0-take-2',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.sceneIndex, 0);
  assert.equal(payload.selection.selectedCandidateId, 'scene-0-take-2');

  const selection = readSelection(root, 'demo');
  assert.equal(selection.scenes.length, 1);
  assert.equal(selection.scenes[0].selectedCandidateId, 'scene-0-take-2');

  const events = readEvents(root, 'demo');
  const selected = events.find((e) => e.type === 'scene-candidate.selected');
  assert.ok(selected, 'expected scene-candidate.selected event');
  assert.equal(selected!.payload?.sceneIndex, 0);
  assert.equal(selected!.payload?.candidateId, 'scene-0-take-2');

  const manifest = readAssetManifest(root, 'demo');
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].kind, 'video');
  assert.equal(manifest.assets[0].path, '/tmp/scene-0-take-2.mp4');
});

test('select-candidate accepts --notes and records them on the selection entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);

  const res = run([
    'video', 'select-candidate',
    '--project', 'demo', '--root', root,
    '--scene', '0', '--candidate-id', 'scene-0-take-1',
    '--notes', 'best composition',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection.notes, 'best composition');

  const events = readEvents(root, 'demo');
  const selected = events.find((e) => e.type === 'scene-candidate.selected');
  assert.equal(selected!.payload?.notes, 'best composition');
});

test('select-candidate preserves existing non-empty asset-manifest when derived outputs are empty', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        { id: 'scene-0-take-1', generationRound: 1, status: 'completed' },
      ],
    },
  ]);
  // Simulate migrated legacy candidate with no outputs.
  writeFileSync(
    join(root, 'projects', 'demo', 'artifacts', 'scene-candidates.json'),
    JSON.stringify({
      schemaVersion: 1,
      scenes: [
        {
          sceneIndex: 0,
          candidates: [
            {
              id: 'scene-0-take-1',
              generationRound: 1,
              prompt: 'migrated candidate',
              route: 'legacy-migrated',
              submittedAt: '2026-04-22T00:00:00.000Z',
              completedAt: '2026-04-22T00:00:00.000Z',
              status: 'completed',
              outputs: [],
              source: {
                executionRound: 1,
                adapter: 'builtin',
                chainedFromCandidateId: null,
              },
            },
          ],
        },
      ],
    }, null, 2),
    'utf8',
  );
  writeAssetManifest(root, 'demo', [
    { id: 'seed-0', kind: 'video', path: '/tmp/existing-seed.mp4', sceneIndex: 0 },
  ]);

  const res = run([
    'video', 'select-candidate',
    '--project', 'demo', '--root', root,
    '--scene', '0', '--candidate-id', 'scene-0-take-1',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);

  const manifest = readAssetManifest(root, 'demo');
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].path, '/tmp/existing-seed.mp4');

  const events = readEvents(root, 'demo');
  const manifestEvent = events.find((e) => e.type === 'artifact.asset-manifest.written');
  assert.equal(manifestEvent?.payload?.source, 'select-candidate-preserved');
});

test('select-candidate fails if the candidate id does not exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);

  const res = run([
    'video', 'select-candidate',
    '--project', 'demo', '--root', root,
    '--scene', '0', '--candidate-id', 'scene-0-take-99',
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /unknown candidate/);
});

test('select-candidate fails if the candidate belongs to a different scene', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
    {
      sceneIndex: 1,
      candidates: [{ id: 'scene-1-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);

  const res = run([
    'video', 'select-candidate',
    '--project', 'demo', '--root', root,
    '--scene', '1', '--candidate-id', 'scene-0-take-1',
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /candidate-scene-mismatch/);
});

// ------- reject-candidate -------

test('reject-candidate records the rejection and emits a scene-candidate.rejected event', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        { id: 'scene-0-take-1', generationRound: 1, status: 'completed' },
        { id: 'scene-0-take-2', generationRound: 2, status: 'completed' },
      ],
    },
  ]);

  const res = run([
    'video', 'reject-candidate',
    '--project', 'demo', '--root', root,
    '--scene', '0', '--candidate-id', 'scene-0-take-1',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.deepEqual(payload.selection.rejectedCandidateIds, ['scene-0-take-1']);

  const events = readEvents(root, 'demo');
  const rejected = events.find((e) => e.type === 'scene-candidate.rejected');
  assert.ok(rejected, 'expected scene-candidate.rejected event');
  assert.equal(rejected!.payload?.candidateId, 'scene-0-take-1');
});

test('reject-candidate fails on unknown candidate id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);

  const res = run([
    'video', 'reject-candidate',
    '--project', 'demo', '--root', root,
    '--scene', '0', '--candidate-id', 'missing',
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /unknown candidate/);
});

// ------- reroll-scene -------

test('reroll-scene sets rerollRequested and emits scene-reroll.requested', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const res = run([
    'video', 'reroll-scene',
    '--project', 'demo', '--root', root,
    '--scene', '2',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection.rerollRequested, true);
  assert.equal(payload.selection.chainFromPrev, false);

  const events = readEvents(root, 'demo');
  const reroll = events.find((e) => e.type === 'scene-reroll.requested');
  assert.ok(reroll, 'expected scene-reroll.requested event');
  assert.equal(reroll!.payload?.sceneIndex, 2);
});

test('reroll-scene --chain-from-prev on sets the chain flag', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const res = run([
    'video', 'reroll-scene',
    '--project', 'demo', '--root', root,
    '--scene', '1', '--chain-from-prev', 'on',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection.chainFromPrev, true);
  assert.equal(payload.selection.rerollRequested, true);
});

test('reroll-scene --chain-from-prev off clears an existing chain', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  // First configure chain-from.
  assert.equal(
    run([
      'video', 'chain-from',
      '--project', 'demo', '--root', root,
      '--scene', '1', '--from', '0',
    ]).status,
    0,
  );

  const res = run([
    'video', 'reroll-scene',
    '--project', 'demo', '--root', root,
    '--scene', '1', '--chain-from-prev', 'off',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection.chainFromPrev, false);
});

test('reroll-scene rejects malformed --chain-from-prev values', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const res = run([
    'video', 'reroll-scene',
    '--project', 'demo', '--root', root,
    '--scene', '0', '--chain-from-prev', 'maybe',
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /invalid --chain-from-prev/);
});

// ------- chain-from -------

test('chain-from with --from = sceneIndex - 1 sets chainFromPrev and emits scene-chain.configured', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const res = run([
    'video', 'chain-from',
    '--project', 'demo', '--root', root,
    '--scene', '2', '--from', '1',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection.chainFromPrev, true);

  const events = readEvents(root, 'demo');
  const chain = events.find((e) => e.type === 'scene-chain.configured');
  assert.ok(chain, 'expected scene-chain.configured event');
  assert.equal(chain!.payload?.sceneIndex, 2);
  assert.equal(chain!.payload?.from, 1);
  assert.equal(chain!.payload?.chainFromPrev, true);
});

test('chain-from with --from that is not sceneIndex - 1 fails (v1 only supports chain-from-prev)', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const res = run([
    'video', 'chain-from',
    '--project', 'demo', '--root', root,
    '--scene', '3', '--from', '0',
  ]);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /chain-from-unsupported/);
});

// ------- unchain -------

test('unchain clears chainFromPrev and emits scene-chain.configured', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-selection-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  // First set chain-from-prev.
  assert.equal(
    run([
      'video', 'chain-from',
      '--project', 'demo', '--root', root,
      '--scene', '1', '--from', '0',
    ]).status,
    0,
  );

  const res = run([
    'video', 'unchain',
    '--project', 'demo', '--root', root,
    '--scene', '1',
  ]);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.selection.chainFromPrev, false);

  const events = readEvents(root, 'demo');
  const chains = events.filter((e) => e.type === 'scene-chain.configured');
  assert.equal(chains.length, 2);
  assert.equal(chains[1].payload?.chainFromPrev, false);
});
