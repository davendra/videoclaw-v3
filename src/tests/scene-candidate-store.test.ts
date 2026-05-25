import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectWorkspace } from '../video/workspace.js';
import {
  readSceneCandidatesArtifact,
  writeSceneCandidatesArtifact,
  sceneCandidatesPathFor,
} from '../video/scene-candidate-store.js';
import type { SceneCandidatesArtifact } from '../video/types.js';

test('read returns empty artifact when file does not exist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-scene-candidates-'));
  await ensureProjectWorkspace('demo', root);
  const artifact = await readSceneCandidatesArtifact(root, 'demo');
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.scenes, []);
});

test('sceneCandidatesPathFor lives under artifacts/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-scene-candidates-'));
  await ensureProjectWorkspace('demo', root);
  const path = sceneCandidatesPathFor(root, 'demo');
  assert.match(path, /projects\/demo\/artifacts\/scene-candidates\.json$/);
});

test('write then read round-trips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-scene-candidates-'));
  await ensureProjectWorkspace('demo', root);
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [
          {
            id: 'scene-0-take-1',
            generationRound: 1,
            prompt: 'establishing shot',
            route: 'seedance-direct',
            submittedAt: '2026-04-22T10:00:00.000Z',
            status: 'pending',
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
  };
  await writeSceneCandidatesArtifact(root, 'demo', artifact);
  assert.equal(existsSync(sceneCandidatesPathFor(root, 'demo')), true);
  const readBack = await readSceneCandidatesArtifact(root, 'demo');
  assert.deepEqual(readBack, artifact);
});
