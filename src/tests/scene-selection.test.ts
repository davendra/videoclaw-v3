import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  SceneCandidate,
  SceneCandidatesArtifact,
  SceneSelectionArtifact,
  SceneSelectionEntry,
} from '../video/types.js';
import {
  clearReroll,
  ensureSelectionEntry,
  markPending,
  rejectCandidate,
  requestReroll,
  selectCandidate,
  setChainFromPrev,
  validateSelection,
} from '../video/scene-selection.js';

function emptyArtifact(): SceneSelectionArtifact {
  return { schemaVersion: 1, scenes: [] };
}

function makeCandidate(id: string, overrides: Partial<SceneCandidate> = {}): SceneCandidate {
  return {
    id,
    generationRound: overrides.generationRound ?? 1,
    prompt: overrides.prompt ?? 'prompt',
    route: overrides.route ?? 'seedance-direct',
    submittedAt: overrides.submittedAt ?? '2026-04-22T10:00:00.000Z',
    status: overrides.status ?? 'completed',
    outputs: overrides.outputs ?? [],
    source: overrides.source ?? {
      executionRound: 1,
      adapter: 'builtin',
      chainedFromCandidateId: null,
    },
    ...(overrides.completedAt !== undefined ? { completedAt: overrides.completedAt } : {}),
  };
}

function findEntry(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
): SceneSelectionEntry {
  const entry = artifact.scenes.find((s) => s.sceneIndex === sceneIndex);
  assert.ok(entry, `expected entry for scene ${sceneIndex}`);
  return entry;
}

test('ensureSelectionEntry creates a default entry when missing', () => {
  const artifact = emptyArtifact();
  const next = ensureSelectionEntry(artifact, 0);
  assert.equal(next.scenes.length, 1);
  const entry = findEntry(next, 0);
  assert.equal(entry.sceneIndex, 0);
  assert.equal(entry.selectedCandidateId, null);
  assert.deepEqual(entry.rejectedCandidateIds, []);
  assert.deepEqual(entry.pendingCandidateIds, []);
  assert.equal(entry.rerollRequested, false);
  assert.equal(entry.chainFromPrev, false);
  assert.deepEqual(artifact.scenes, []);
});

test('ensureSelectionEntry returns the same artifact reference when entry exists', () => {
  const artifact: SceneSelectionArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        selectedCandidateId: null,
        rejectedCandidateIds: [],
        pendingCandidateIds: [],
        rerollRequested: false,
        chainFromPrev: false,
      },
    ],
  };
  const next = ensureSelectionEntry(artifact, 0);
  assert.strictEqual(next, artifact);
});

test('selectCandidate moves id into selectedCandidateId and clears reroll', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = markPending(artifact, 0, ['scene-0-take-1']);
  artifact = requestReroll(artifact, 0);
  artifact = selectCandidate(artifact, 0, 'scene-0-take-1');
  const entry = findEntry(artifact, 0);
  assert.equal(entry.selectedCandidateId, 'scene-0-take-1');
  assert.deepEqual(entry.pendingCandidateIds, []);
  assert.deepEqual(entry.rejectedCandidateIds, []);
  assert.equal(entry.rerollRequested, false);
});

test('selectCandidate pulls id out of rejected list if previously rejected', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = rejectCandidate(artifact, 0, 'scene-0-take-1');
  artifact = selectCandidate(artifact, 0, 'scene-0-take-1');
  const entry = findEntry(artifact, 0);
  assert.equal(entry.selectedCandidateId, 'scene-0-take-1');
  assert.deepEqual(entry.rejectedCandidateIds, []);
});

test('rejectCandidate adds id to rejectedCandidateIds and clears selected if it was this id', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = selectCandidate(artifact, 0, 'scene-0-take-1');
  artifact = rejectCandidate(artifact, 0, 'scene-0-take-1');
  const entry = findEntry(artifact, 0);
  assert.equal(entry.selectedCandidateId, null);
  assert.deepEqual(entry.rejectedCandidateIds, ['scene-0-take-1']);
});

test('rejectCandidate leaves a different selected candidate alone', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = selectCandidate(artifact, 0, 'scene-0-take-1');
  artifact = rejectCandidate(artifact, 0, 'scene-0-take-2');
  const entry = findEntry(artifact, 0);
  assert.equal(entry.selectedCandidateId, 'scene-0-take-1');
  assert.deepEqual(entry.rejectedCandidateIds, ['scene-0-take-2']);
});

test('rejectCandidate removes id from pending list', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = markPending(artifact, 0, ['scene-0-take-1']);
  artifact = rejectCandidate(artifact, 0, 'scene-0-take-1');
  const entry = findEntry(artifact, 0);
  assert.deepEqual(entry.pendingCandidateIds, []);
  assert.deepEqual(entry.rejectedCandidateIds, ['scene-0-take-1']);
});

test('markPending skips ids that are already selected or rejected', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = selectCandidate(artifact, 0, 'scene-0-take-1');
  artifact = rejectCandidate(artifact, 0, 'scene-0-take-2');
  artifact = markPending(artifact, 0, ['scene-0-take-1', 'scene-0-take-2', 'scene-0-take-3']);
  const entry = findEntry(artifact, 0);
  assert.deepEqual(entry.pendingCandidateIds, ['scene-0-take-3']);
});

test('markPending dedupes already-pending ids', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = markPending(artifact, 0, ['scene-0-take-1']);
  artifact = markPending(artifact, 0, ['scene-0-take-1', 'scene-0-take-2']);
  const entry = findEntry(artifact, 0);
  assert.deepEqual(entry.pendingCandidateIds, ['scene-0-take-1', 'scene-0-take-2']);
});

test('requestReroll sets the flag, clears selected, and applies chain when provided', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 1);
  artifact = selectCandidate(artifact, 1, 'scene-1-take-1');
  artifact = requestReroll(artifact, 1, true);
  const entry = findEntry(artifact, 1);
  assert.equal(entry.rerollRequested, true);
  assert.equal(entry.selectedCandidateId, null);
  assert.equal(entry.chainFromPrev, true);
});

test('requestReroll without chain arg leaves chainFromPrev unchanged', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 1);
  artifact = setChainFromPrev(artifact, 1, true);
  artifact = requestReroll(artifact, 1);
  const entry = findEntry(artifact, 1);
  assert.equal(entry.rerollRequested, true);
  assert.equal(entry.chainFromPrev, true);
});

test('setChainFromPrev toggles the boolean', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 2);
  artifact = setChainFromPrev(artifact, 2, true);
  assert.equal(findEntry(artifact, 2).chainFromPrev, true);
  artifact = setChainFromPrev(artifact, 2, false);
  assert.equal(findEntry(artifact, 2).chainFromPrev, false);
});

test('clearReroll flips rerollRequested to false', () => {
  let artifact = ensureSelectionEntry(emptyArtifact(), 0);
  artifact = requestReroll(artifact, 0);
  artifact = clearReroll(artifact, 0);
  assert.equal(findEntry(artifact, 0).rerollRequested, false);
});

test('validateSelection reports ok when references exist and are disjoint', () => {
  const candidates: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [
          makeCandidate('scene-0-take-1'),
          makeCandidate('scene-0-take-2'),
        ],
      },
    ],
  };
  const selection: SceneSelectionArtifact = {
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
    ],
  };
  const result = validateSelection(selection, candidates);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('validateSelection catches unknown candidate refs', () => {
  const candidates: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [{ sceneIndex: 0, candidates: [makeCandidate('scene-0-take-1')] }],
  };
  const selection: SceneSelectionArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        selectedCandidateId: 'missing-id',
        rejectedCandidateIds: [],
        pendingCandidateIds: ['also-missing'],
        rerollRequested: false,
        chainFromPrev: false,
      },
    ],
  };
  const result = validateSelection(selection, candidates);
  assert.equal(result.ok, false);
  const joined = result.errors.join('|');
  assert.match(joined, /unknown-candidate-ref: missing-id/);
  assert.match(joined, /unknown-candidate-ref: also-missing/);
});

test('validateSelection catches disjointness violations', () => {
  const candidates: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [
          makeCandidate('scene-0-take-1'),
          makeCandidate('scene-0-take-2'),
        ],
      },
    ],
  };
  const selection: SceneSelectionArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        selectedCandidateId: 'scene-0-take-1',
        rejectedCandidateIds: ['scene-0-take-1'],
        pendingCandidateIds: ['scene-0-take-2'],
        rerollRequested: false,
        chainFromPrev: false,
      },
    ],
  };
  const result = validateSelection(selection, candidates);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('|'), /disjointness-violation/);
});

test('validateSelection catches round gaps within a scene', () => {
  const candidates: SceneCandidatesArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        candidates: [
          makeCandidate('scene-0-take-1', { generationRound: 1 }),
          makeCandidate('scene-0-take-3', { generationRound: 3 }),
        ],
      },
    ],
  };
  const selection: SceneSelectionArtifact = {
    schemaVersion: 1,
    scenes: [
      {
        sceneIndex: 0,
        selectedCandidateId: null,
        rejectedCandidateIds: [],
        pendingCandidateIds: [],
        rerollRequested: false,
        chainFromPrev: false,
      },
    ],
  };
  const result = validateSelection(selection, candidates);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('|'), /round-gap/);
});
