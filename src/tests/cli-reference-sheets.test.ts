import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status ?? -1 };
}

test('reference-sheet-add creates an Identity Sheet with a valid role', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo',
    '--root', root,
    '--type', 'identity',
    '--name', 'Lead',
    '--ref', 'refs/mochi.png:identity',
    '--binding', '0',
  ]);
  assert.equal(add.status, 0, `stderr: ${add.stderr}`);
  const payload = JSON.parse(add.stdout);
  assert.equal(payload.sheet.type, 'identity');
  assert.equal(payload.sheet.references[0].role, 'identity');
  assert.deepEqual(payload.sheet.bindings.sceneIndices, [0]);

  const artifactPath = join(root, 'projects', 'demo', 'references', 'reference-sheets.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.sheets.length, 1);
});

test('reference-sheet-add rejects a role outside the sheet-type vocabulary', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo',
    '--root', root,
    '--type', 'identity',
    '--name', 'BadRole',
    '--ref', 'refs/x.png:palette',
  ]);
  assert.notEqual(add.status, 0);
  assert.match(add.stderr, /role-vocabulary-violation/);
});

test('reference-sheet-add accepts --gb-ref kind:id:role', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-gbref-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo', '--root', root,
    '--type', 'environment', '--name', 'Dusk',
    '--gb-ref', 'scene:15:location',
    '--binding', '0',
  ]);
  assert.equal(add.status, 0, `stderr: ${add.stderr}`);
  const payload = JSON.parse(add.stdout);
  const ref = payload.sheet.references[0];
  assert.equal('gbRef' in ref ? ref.gbRef.kind : null, 'scene');
  assert.equal('gbRef' in ref ? ref.gbRef.id : null, 15);
  assert.equal(ref.role, 'location');
});

test('reference-sheet-add rejects --gb-ref with a role outside the sheet-type vocabulary', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-gbref-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo', '--root', root,
    '--type', 'identity', '--name', 'Bad',
    '--gb-ref', 'character:1:palette',
  ]);
  assert.notEqual(add.status, 0);
  assert.match(add.stderr, /role-vocabulary-violation/);
});

test('reference-sheet-list returns all sheets and can filter by type', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--ref', 'refs/a.png:identity']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'Dusk', '--ref', 'refs/b.png:palette']).status, 0);

  const all = run(['video', 'reference-sheet-list', '--project', 'demo', '--root', root]);
  assert.equal(all.status, 0);
  const allPayload = JSON.parse(all.stdout);
  assert.equal(allPayload.sheets.length, 2);

  const filtered = run(['video', 'reference-sheet-list', '--project', 'demo', '--root', root, '--type', 'identity']);
  assert.equal(filtered.status, 0);
  const filteredPayload = JSON.parse(filtered.stdout);
  assert.equal(filteredPayload.sheets.length, 1);
  assert.equal(filteredPayload.sheets[0].type, 'identity');
});

test('reference-sheet-show returns a single sheet by id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--id', 'lead-v1', '--ref', 'refs/a.png:identity']).status, 0);

  const show = run(['video', 'reference-sheet-show', '--project', 'demo', '--root', root, '--id', 'lead-v1']);
  assert.equal(show.status, 0);
  const payload = JSON.parse(show.stdout);
  assert.equal(payload.sheet.id, 'lead-v1');
});

test('reference-sheet-show fails for unknown id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const show = run(['video', 'reference-sheet-show', '--project', 'demo', '--root', root, '--id', 'nope']);
  assert.notEqual(show.status, 0);
  assert.match(show.stderr, /unknown sheet/);
});

test('reference-sheet-bind adds scene indices idempotently', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--id', 'lead', '--ref', 'refs/a.png:identity']).status, 0);

  const bind1 = run(['video', 'reference-sheet-bind', '--project', 'demo', '--root', root, '--id', 'lead', '--scene', '0', '--scene', '2']);
  assert.equal(bind1.status, 0);
  assert.deepEqual(JSON.parse(bind1.stdout).sheet.bindings.sceneIndices, [0, 2]);

  // Idempotent: binding the same scenes again should not duplicate.
  const bind2 = run(['video', 'reference-sheet-bind', '--project', 'demo', '--root', root, '--id', 'lead', '--scene', '2', '--scene', '3']);
  assert.equal(bind2.status, 0);
  assert.deepEqual(JSON.parse(bind2.stdout).sheet.bindings.sceneIndices, [0, 2, 3]);
});

test('reference-sheet-validate reports collisions on the same scene', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'A', '--id', 'a', '--ref', 'refs/a.png:palette', '--binding', '1']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'B', '--id', 'b', '--ref', 'refs/b.png:palette', '--binding', '1']).status, 0);

  const res = run(['video', 'reference-sheet-validate', '--project', 'demo', '--root', root]);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.collisions.length, 1);
  assert.equal(payload.collisions[0].role, 'palette');
  assert.equal(payload.collisions[0].sceneIndex, 1);
});

test('reference-sheet-validate reports ok on clean artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--ref', 'refs/a.png:identity', '--binding', '0']).status, 0);

  const res = run(['video', 'reference-sheet-validate', '--project', 'demo', '--root', root]);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.errors, []);
  assert.deepEqual(payload.collisions, []);
});
