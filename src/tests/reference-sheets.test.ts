import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceEntry, ReferenceSheet, ReferenceSheetsArtifact } from '../video/types.js';
import {
  ROLE_VOCABULARY,
  isRoleValidForType,
  validateSheet,
  createSheet,
  addReferenceToSheet,
  bindSheetToScenes,
  findSheet,
  removeSheet,
  findRoleCollisions,
  summarizeArtifact,
} from '../video/reference-sheets.js';

test('ReferenceSheetsArtifact shape is importable and type-compatible', () => {
  const artifact: ReferenceSheetsArtifact = {
    schemaVersion: 1,
    sheets: [],
  };
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.sheets, []);
});

test('ReferenceSheet carries required fields', () => {
  const sheet: ReferenceSheet = {
    id: 'sheet-001',
    type: 'identity',
    name: 'Lead',
    references: [{ path: 'refs/mochi.png', role: 'identity' }],
    bindings: { sceneIndices: [1, 2] },
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
  };
  assert.equal(sheet.type, 'identity');
  assert.equal(sheet.references[0].role, 'identity');
});

test('ROLE_VOCABULARY covers all 5 types', () => {
  assert.deepEqual(Object.keys(ROLE_VOCABULARY).sort(), [
    'environment',
    'identity',
    'motion-camera',
    'outfit-material',
    'palette-mood',
  ]);
});

test('isRoleValidForType enforces per-type vocabulary', () => {
  assert.equal(isRoleValidForType('identity', 'identity'), true);
  assert.equal(isRoleValidForType('palette', 'identity'), false);
  assert.equal(isRoleValidForType('palette', 'palette-mood'), true);
  assert.equal(isRoleValidForType('wardrobe', 'outfit-material'), false);
});

test('validateSheet catches role-vocabulary violations', () => {
  const result = validateSheet({
    id: 's1',
    type: 'identity',
    name: 'X',
    references: [{ path: 'a.png', role: 'palette' }],
    bindings: { sceneIndices: [] },
    createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('|'), /role-vocabulary-violation/);
});

test('validateSheet accepts a well-formed sheet', () => {
  const result = validateSheet({
    id: 's1',
    type: 'identity',
    name: 'X',
    references: [{ path: 'a.png', role: 'identity' }],
    bindings: { sceneIndices: [0] },
    createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('createSheet generates a stable id and timestamps', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({
    type: 'identity',
    name: 'Lead',
    existingIds: [],
    now,
  });
  assert.equal(sheet.id, 'sheet-001');
  assert.equal(sheet.type, 'identity');
  assert.deepEqual(sheet.references, []);
  assert.deepEqual(sheet.bindings.sceneIndices, []);
  assert.equal(sheet.createdAt, '2026-04-22T10:00:00.000Z');
});

test('createSheet picks next free id', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({
    type: 'palette-mood',
    name: 'Dusk',
    existingIds: ['sheet-001', 'sheet-002'],
    now,
  });
  assert.equal(sheet.id, 'sheet-003');
});

test('createSheet honors explicit id', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({
    type: 'identity', name: 'Lead', id: 'lead-v1',
    existingIds: [], now,
  });
  assert.equal(sheet.id, 'lead-v1');
});

test('addReferenceToSheet appends and updates updatedAt', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  let sheet = createSheet({ type: 'identity', name: 'Lead', existingIds: [], now });
  sheet = addReferenceToSheet(sheet, { path: 'a.png', role: 'identity' }, new Date('2026-04-22T11:00:00.000Z'));
  assert.equal(sheet.references.length, 1);
  assert.equal(sheet.updatedAt, '2026-04-22T11:00:00.000Z');
});

test('bindSheetToScenes dedupes and sorts', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  let sheet = createSheet({ type: 'identity', name: 'Lead', existingIds: [], now });
  sheet = bindSheetToScenes(sheet, [2, 1, 2, 3], now);
  assert.deepEqual(sheet.bindings.sceneIndices, [1, 2, 3]);
});

test('findSheet and removeSheet work', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const s1 = createSheet({ type: 'identity', name: 'A', existingIds: [], now });
  const s2 = createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now });
  const artifact = { schemaVersion: 1 as const, sheets: [s1, s2] };
  assert.equal(findSheet(artifact, 'sheet-002')?.name, 'B');
  const reduced = removeSheet(artifact, 'sheet-001');
  assert.equal(reduced.sheets.length, 1);
  assert.equal(reduced.sheets[0].id, 'sheet-002');
});

test('findRoleCollisions detects two sheets providing the same role on the same scene', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const s1 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'A', existingIds: [], now }), [1], now),
    { path: 'a.png', role: 'palette' }, now);
  const s2 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now }), [1], now),
    { path: 'b.png', role: 'palette' }, now);
  const collisions = findRoleCollisions({ schemaVersion: 1, sheets: [s1, s2] });
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].sceneIndex, 1);
  assert.equal(collisions[0].role, 'palette');
  assert.deepEqual(collisions[0].sheetIds.sort(), ['sheet-001', 'sheet-002']);
});

test('findRoleCollisions returns empty when roles differ', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const s1 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'A', existingIds: [], now }), [1], now),
    { path: 'a.png', role: 'palette' }, now);
  const s2 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now }), [1], now),
    { path: 'b.png', role: 'composition' }, now);
  const collisions = findRoleCollisions({ schemaVersion: 1, sheets: [s1, s2] });
  assert.deepEqual(collisions, []);
});

test('summarizeArtifact counts sheets by type and bindings', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const a = bindSheetToScenes(createSheet({ type: 'identity', name: 'A', existingIds: [], now }), [0, 1], now);
  const b = createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now });
  const summary = summarizeArtifact({ schemaVersion: 1, sheets: [a, b] });
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.byType, { identity: 1, 'palette-mood': 1 });
  assert.deepEqual(summary.boundSceneCount, 2);
  assert.deepEqual(summary.unboundSheetIds, ['sheet-002']);
});

test('ReferenceEntry supports the gbRef union variant', () => {
  const entry: ReferenceEntry = { gbRef: { kind: 'character', id: 247 }, role: 'identity' };
  assert.equal('gbRef' in entry ? entry.gbRef.kind : 'none', 'character');
});

test('validateSheet accepts a gbRef entry with a role valid for the sheet type', () => {
  const result = validateSheet({
    id: 's1', type: 'environment', name: 'Dusk',
    references: [{ gbRef: { kind: 'scene', id: 15 }, role: 'location' }],
    bindings: { sceneIndices: [0] }, createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, true);
});

test('validateSheet rejects a gbRef entry whose role is not in the sheet-type vocabulary', () => {
  const result = validateSheet({
    id: 's1', type: 'identity', name: 'X',
    references: [{ gbRef: { kind: 'character', id: 1 }, role: 'palette' }],
    bindings: { sceneIndices: [] }, createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('|'), /role-vocabulary-violation/);
});

test('ROLE_VOCABULARY[outfit-material] includes product-* roles', () => {
  const roles = ROLE_VOCABULARY['outfit-material'];
  assert(roles.includes('product-hero'));
  assert(roles.includes('product-variant'));
  assert(roles.includes('product-in-use'));
  assert(roles.includes('packaging'));
});
