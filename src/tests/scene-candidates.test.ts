import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  SceneCandidate,
  SceneCandidatesArtifact,
  SceneCandidatesEntry,
  SceneCandidateOutput,
  SceneCandidateSource,
  SceneCandidateStatus,
  SceneSelectionArtifact,
  SceneSelectionEntry,
} from '../video/types.js';
import {
  appendCandidate,
  candidatesForScene,
  findCandidate,
  maxRoundForScene,
  nextCandidateId,
  summarizeCandidates,
} from '../video/scene-candidates.js';

function makeCandidate(overrides: Partial<SceneCandidate> & { id: string }): SceneCandidate {
  return {
    id: overrides.id,
    generationRound: overrides.generationRound ?? 1,
    prompt: overrides.prompt ?? 'prompt',
    route: overrides.route ?? 'seedance-direct',
    submittedAt: overrides.submittedAt ?? '2026-04-22T10:00:00.000Z',
    status: overrides.status ?? 'pending',
    outputs: overrides.outputs ?? [],
    source: overrides.source ?? {
      executionRound: 1,
      adapter: 'builtin',
      chainedFromCandidateId: null,
    },
    ...(overrides.completedAt !== undefined ? { completedAt: overrides.completedAt } : {}),
  };
}

test('SceneCandidatesArtifact shape is importable and type-compatible', () => {
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [],
  };
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.scenes, []);
});

test('SceneSelectionArtifact shape is importable and type-compatible', () => {
  const artifact: SceneSelectionArtifact = {
    schemaVersion: 1,
    scenes: [],
  };
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.scenes, []);
});

test('SceneCandidate carries required fields including source', () => {
  const output: SceneCandidateOutput = { kind: 'video', path: 'out/scene-0-take-1.mp4' };
  const source: SceneCandidateSource = {
    executionRound: 1,
    adapter: 'builtin',
    chainedFromCandidateId: null,
  };
  const candidate: SceneCandidate = {
    id: 'scene-0-take-1',
    generationRound: 1,
    prompt: 'A wide establishing shot.',
    route: 'seedance-direct',
    submittedAt: '2026-04-22T10:00:00.000Z',
    status: 'pending' as SceneCandidateStatus,
    outputs: [output],
    source,
  };
  const entry: SceneCandidatesEntry = { sceneIndex: 0, candidates: [candidate] };
  assert.equal(entry.sceneIndex, 0);
  assert.equal(entry.candidates[0].id, 'scene-0-take-1');
  assert.equal(entry.candidates[0].source.adapter, 'builtin');
  assert.equal(entry.candidates[0].source.chainedFromCandidateId, null);
});

test('SceneSelectionEntry carries required fields', () => {
  const entry: SceneSelectionEntry = {
    sceneIndex: 0,
    selectedCandidateId: null,
    rejectedCandidateIds: [],
    pendingCandidateIds: [],
    rerollRequested: false,
    chainFromPrev: false,
  };
  assert.equal(entry.sceneIndex, 0);
  assert.equal(entry.selectedCandidateId, null);
  assert.deepEqual(entry.rejectedCandidateIds, []);
  assert.deepEqual(entry.pendingCandidateIds, []);
  assert.equal(entry.rerollRequested, false);
  assert.equal(entry.chainFromPrev, false);
});

test('nextCandidateId starts at take-1 when scene has no candidates', () => {
  const artifact: SceneCandidatesArtifact = { schemaVersion: 1, scenes: [] };
  assert.equal(nextCandidateId(artifact, 0), 'scene-0-take-1');
  assert.equal(nextCandidateId(artifact, 2), 'scene-2-take-1');
});

test('nextCandidateId picks the next free integer within the scene', () => {
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [
          makeCandidate({ id: 'scene-0-take-1' }),
          makeCandidate({ id: 'scene-0-take-2' }),
        ],
      },
    ],
  };
  assert.equal(nextCandidateId(artifact, 0), 'scene-0-take-3');
});

test('nextCandidateId scans the entire artifact for uniqueness across scenes', () => {
  // If a scene-0-take-3 slot exists somewhere unexpectedly, the scene-0 pick should skip it.
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [makeCandidate({ id: 'scene-0-take-1' })],
      },
      {
        sceneIndex: 1,
        candidates: [makeCandidate({ id: 'scene-0-take-2' })],
      },
    ],
  };
  // scene-0-take-2 already exists (in another scene entry); next for scene 0 must be take-3.
  assert.equal(nextCandidateId(artifact, 0), 'scene-0-take-3');
});

test('appendCandidate creates a scene entry when absent', () => {
  const artifact: SceneCandidatesArtifact = { schemaVersion: 1, scenes: [] };
  const candidate = makeCandidate({ id: 'scene-0-take-1' });
  const next = appendCandidate(artifact, 0, candidate);
  assert.notStrictEqual(next, artifact);
  assert.equal(next.scenes.length, 1);
  assert.equal(next.scenes[0].sceneIndex, 0);
  assert.deepEqual(next.scenes[0].candidates, [candidate]);
  // Original is untouched (immutability).
  assert.deepEqual(artifact.scenes, []);
});

test('appendCandidate appends to existing scene entry', () => {
  const existing = makeCandidate({ id: 'scene-0-take-1' });
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [{ sceneIndex: 0, candidates: [existing] }],
  };
  const added = makeCandidate({ id: 'scene-0-take-2', generationRound: 2 });
  const next = appendCandidate(artifact, 0, added);
  assert.equal(next.scenes.length, 1);
  assert.equal(next.scenes[0].candidates.length, 2);
  assert.equal(next.scenes[0].candidates[1].id, 'scene-0-take-2');
  // Original is untouched.
  assert.equal(artifact.scenes[0].candidates.length, 1);
});

test('findCandidate returns the candidate and its scene index or null', () => {
  const c1 = makeCandidate({ id: 'scene-0-take-1' });
  const c2 = makeCandidate({ id: 'scene-1-take-1', generationRound: 1 });
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      { sceneIndex: 0, candidates: [c1] },
      { sceneIndex: 1, candidates: [c2] },
    ],
  };
  const hit = findCandidate(artifact, 'scene-1-take-1');
  assert.ok(hit);
  assert.equal(hit.sceneIndex, 1);
  assert.equal(hit.candidate.id, 'scene-1-take-1');
  assert.equal(findCandidate(artifact, 'missing'), null);
});

test('summarizeCandidates returns totals by status', () => {
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [
          makeCandidate({ id: 'scene-0-take-1', status: 'completed' }),
          makeCandidate({ id: 'scene-0-take-2', status: 'pending' }),
        ],
      },
      {
        sceneIndex: 1,
        candidates: [
          makeCandidate({ id: 'scene-1-take-1', status: 'failed' }),
        ],
      },
    ],
  };
  const summary = summarizeCandidates(artifact);
  assert.equal(summary.totalCandidates, 3);
  assert.equal(summary.sceneCount, 2);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.failedCount, 1);
});

test('candidatesForScene returns scene candidates or empty', () => {
  const c1 = makeCandidate({ id: 'scene-0-take-1' });
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [{ sceneIndex: 0, candidates: [c1] }],
  };
  assert.deepEqual(candidatesForScene(artifact, 0), [c1]);
  assert.deepEqual(candidatesForScene(artifact, 5), []);
});

test('maxRoundForScene returns highest generationRound or 0', () => {
  const artifact: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [
          makeCandidate({ id: 'scene-0-take-1', generationRound: 1 }),
          makeCandidate({ id: 'scene-0-take-2', generationRound: 3 }),
          makeCandidate({ id: 'scene-0-take-3', generationRound: 2 }),
        ],
      },
    ],
  };
  assert.equal(maxRoundForScene(artifact, 0), 3);
  assert.equal(maxRoundForScene(artifact, 7), 0);
});
