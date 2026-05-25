import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectWorkspace } from '../video/workspace.js';
import {
  readReferenceSheetsArtifact,
  writeReferenceSheetsArtifact,
  referenceSheetsPathFor,
} from '../video/reference-sheet-store.js';
import { createSheet } from '../video/reference-sheets.js';

test('read returns empty artifact when file does not exist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-refsheet-'));
  await ensureProjectWorkspace('demo', root);
  const artifact = await readReferenceSheetsArtifact(root, 'demo');
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.sheets, []);
});

test('write then read round-trips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-refsheet-'));
  await ensureProjectWorkspace('demo', root);
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({ type: 'identity', name: 'Lead', existingIds: [], now });
  const artifact = { schemaVersion: 1 as const, sheets: [sheet] };
  await writeReferenceSheetsArtifact(root, 'demo', artifact);
  assert.equal(existsSync(referenceSheetsPathFor(root, 'demo')), true);
  const readBack = await readReferenceSheetsArtifact(root, 'demo');
  assert.deepEqual(readBack, artifact);
});
