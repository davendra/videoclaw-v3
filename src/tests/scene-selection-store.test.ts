import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectWorkspace } from '../video/workspace.js';
import {
  readSceneSelectionArtifact,
  writeSceneSelectionArtifact,
  sceneSelectionPathFor,
} from '../video/scene-selection-store.js';
import type { SceneSelectionArtifact } from '../video/types.js';

test('read returns empty artifact when file does not exist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-scene-selection-'));
  await ensureProjectWorkspace('demo', root);
  const artifact = await readSceneSelectionArtifact(root, 'demo');
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.scenes, []);
});

test('sceneSelectionPathFor lives under artifacts/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-scene-selection-'));
  await ensureProjectWorkspace('demo', root);
  const path = sceneSelectionPathFor(root, 'demo');
  assert.match(path, /projects\/demo\/artifacts\/scene-selection\.json$/);
});

test('write then read round-trips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-scene-selection-'));
  await ensureProjectWorkspace('demo', root);
  const artifact: SceneSelectionArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        selectedCandidateId: 'scene-0-take-1',
        rejectedCandidateIds: ['scene-0-take-2'],
        pendingCandidateIds: [],
        rerollRequested: false,
        chainFromPrev: false,
      },
      {
        sceneIndex: 1,
        selectedCandidateId: null,
        rejectedCandidateIds: [],
        pendingCandidateIds: ['scene-1-take-1'],
        rerollRequested: true,
        chainFromPrev: true,
        notes: 'rerolling with seed from scene 0',
      },
    ],
  };
  await writeSceneSelectionArtifact(root, 'demo', artifact);
  assert.equal(existsSync(sceneSelectionPathFor(root, 'demo')), true);
  const readBack = await readSceneSelectionArtifact(root, 'demo');
  assert.deepEqual(readBack, artifact);
});
