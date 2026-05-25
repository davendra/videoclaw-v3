#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'vclaw-refsheet-smoke-'));
const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args, { expectStatus = 0 } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
  if (result.status !== expectStatus) {
    throw new Error(
      `command status=${result.status} expected=${expectStatus} args=${args.join(' ')}\n` +
        `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  const stdout = result.stdout.trim();
  return stdout.length > 0 ? JSON.parse(stdout) : null;
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e} got ${a}`);
  }
}

try {
  // 1. Initialize a director-mode project.
  const init = run(['video', 'init', 'refsheet-smoke', '--root', root, '--mode', 'director']);

  // 2. Add a brief and a storyboard with a character-bound scene.
  const brief = run([
    'video', 'brief',
    '--project', 'refsheet-smoke',
    '--root', root,
    '--title', 'Reference Sheet Smoke',
    '--intent', 'Exercise role-tagged reference sheets end-to-end.',
    '--platform', 'reels',
    '--aspect-ratio', '9:16',
    '--quality', 'quality',
    '--resolution', '1080p',
    '--audio', 'off',
    '--outputs', '2',
  ]);
  const storyboard = run([
    'video', 'storyboard',
    '--project', 'refsheet-smoke',
    '--root', root,
    '--scene', 'Hero approaches door',
    '--scene', 'Hero opens door',
    '--scene-character', '0:Mochi',
    '--scene-character', '1:Mochi',
  ]);

  // 3. Add an Identity Sheet with a path-backed reference and bind it to scenes 0 and 1.
  const identity = run([
    'video', 'reference-sheet-add',
    '--project', 'refsheet-smoke', '--root', root,
    '--type', 'identity', '--name', 'Mochi identity',
    '--character-name', 'Mochi',
    '--ref', 'refs/mochi-identity.png:identity:primary face',
    '--binding', '0', '--binding', '1',
  ]);
  if (identity.sheet.type !== 'identity') {
    throw new Error(`identity sheet type wrong: ${identity.sheet.type}`);
  }

  // 4. Add a palette-mood sheet bound to scene 0 only.
  const palette = run([
    'video', 'reference-sheet-add',
    '--project', 'refsheet-smoke', '--root', root,
    '--type', 'palette-mood', '--name', 'Dusk palette',
    '--ref', 'refs/dusk.png:palette',
    '--binding', '0',
  ]);

  // 5. Add an outfit-material sheet using a product-* role (Seedance 2.0 handbook vocabulary).
  const product = run([
    'video', 'reference-sheet-add',
    '--project', 'refsheet-smoke', '--root', root,
    '--type', 'outfit-material', '--name', 'Hero product',
    '--gb-ref', 'product:42:product-hero',
    '--binding', '1',
  ]);
  const firstRef = product.sheet.references[0];
  if (!('gbRef' in firstRef) || firstRef.gbRef.kind !== 'product' || firstRef.gbRef.id !== 42) {
    throw new Error(`product sheet gbRef wrong: ${JSON.stringify(firstRef)}`);
  }
  if (firstRef.role !== 'product-hero') {
    throw new Error(`product sheet role wrong: ${firstRef.role}`);
  }

  // 6. Role-vocabulary violation is rejected with a non-zero exit.
  run(
    [
      'video', 'reference-sheet-add',
      '--project', 'refsheet-smoke', '--root', root,
      '--type', 'identity', '--name', 'BadRole',
      '--ref', 'refs/x.png:palette',
    ],
    { expectStatus: 1 },
  );

  // 7. list returns all three sheets and honours a --type filter.
  const listAll = run(['video', 'reference-sheet-list', '--project', 'refsheet-smoke', '--root', root]);
  assertEqual(listAll.sheets.length, 3, 'list count');
  assertEqual(listAll.summary.count, 3, 'summary count');

  const listPalette = run([
    'video', 'reference-sheet-list',
    '--project', 'refsheet-smoke', '--root', root,
    '--type', 'palette-mood',
  ]);
  assertEqual(listPalette.sheets.length, 1, 'palette filter count');
  assertEqual(listPalette.sheets[0].type, 'palette-mood', 'palette filter type');

  // 8. show returns the identity sheet by id.
  const show = run([
    'video', 'reference-sheet-show',
    '--project', 'refsheet-smoke', '--root', root,
    '--id', identity.sheet.id,
  ]);
  assertEqual(show.sheet.id, identity.sheet.id, 'show id');

  // 9. bind extends the palette sheet to scene 1 idempotently.
  const bind = run([
    'video', 'reference-sheet-bind',
    '--project', 'refsheet-smoke', '--root', root,
    '--id', palette.sheet.id,
    '--scene', '0', '--scene', '1',
  ]);
  assertEqual(bind.sheet.bindings.sceneIndices, [0, 1], 'palette bindings');

  // 10. validate now reports a palette-vs-palette collision on scene 0 between the palette sheet
  //     alone and... wait, only one palette. So ok=true. Let's validate a clean state.
  const cleanValidate = run([
    'video', 'reference-sheet-validate',
    '--project', 'refsheet-smoke', '--root', root,
  ]);
  assertEqual(cleanValidate.ok, true, 'clean validate ok');
  assertEqual(cleanValidate.errors, [], 'clean validate errors');
  assertEqual(cleanValidate.collisions, [], 'clean validate collisions');

  // 11. Add a second palette sheet bound to the same scene → validate reports a collision.
  run([
    'video', 'reference-sheet-add',
    '--project', 'refsheet-smoke', '--root', root,
    '--type', 'palette-mood', '--name', 'Competing palette',
    '--ref', 'refs/competing.png:palette',
    '--binding', '0',
  ]);
  const collide = run([
    'video', 'reference-sheet-validate',
    '--project', 'refsheet-smoke', '--root', root,
  ]);
  assertEqual(collide.ok, false, 'collision validate ok');
  if (collide.collisions.length !== 1) {
    throw new Error(`expected 1 collision, got ${collide.collisions.length}`);
  }
  assertEqual(collide.collisions[0].role, 'palette', 'collision role');
  assertEqual(collide.collisions[0].sceneIndex, 0, 'collision scene');

  // 12. status surfaces referenceSheets summary.
  const status = run(['video', 'status', '--project', 'refsheet-smoke', '--root', root]);
  if (!status.referenceSheets) {
    throw new Error('status.referenceSheets missing');
  }
  if (status.referenceSheets.count !== 4) {
    throw new Error(`status.referenceSheets.count expected 4, got ${status.referenceSheets.count}`);
  }

  // 13. On-disk artifact exists and is well-formed JSON.
  const artifactPath = join(root, 'projects', 'refsheet-smoke', 'references', 'reference-sheets.json');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  if (!Array.isArray(artifact.sheets) || artifact.sheets.length !== 4) {
    throw new Error(`on-disk artifact wrong: ${artifact.sheets?.length} sheets`);
  }

  process.stdout.write(`${JSON.stringify({
    root,
    init,
    brief: { slug: brief.slug },
    storyboardSceneCount: storyboard.scenes?.length ?? storyboard.storyboard?.scenes?.length,
    sheetIds: [identity.sheet.id, palette.sheet.id, product.sheet.id],
    listAllCount: listAll.sheets.length,
    listPaletteCount: listPalette.sheets.length,
    paletteBindings: bind.sheet.bindings.sceneIndices,
    cleanValidate: { ok: cleanValidate.ok, collisions: cleanValidate.collisions.length },
    collide: { ok: collide.ok, collisions: collide.collisions.length, role: collide.collisions[0].role },
    statusReferenceSheets: status.referenceSheets,
    artifactSheets: artifact.sheets.length,
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
