import type {
  SceneCandidatesArtifact,
  SceneSelectionArtifact,
  SceneSelectionEntry,
} from './types.js';

function makeEmptyEntry(sceneIndex: number): SceneSelectionEntry {
  return {
    sceneIndex,
    selectedCandidateId: null,
    rejectedCandidateIds: [],
    pendingCandidateIds: [],
    rerollRequested: false,
    chainFromPrev: false,
  };
}

/**
 * If the artifact already has an entry for `sceneIndex`, return the artifact
 * reference unchanged. Otherwise append a default (empty) entry.
 */
export function ensureSelectionEntry(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
): SceneSelectionArtifact {
  if (artifact.scenes.some((s) => s.sceneIndex === sceneIndex)) return artifact;
  return {
    ...artifact,
    scenes: [...artifact.scenes, makeEmptyEntry(sceneIndex)],
  };
}

function updateEntry(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
  updater: (entry: SceneSelectionEntry) => SceneSelectionEntry,
): SceneSelectionArtifact {
  const ensured = ensureSelectionEntry(artifact, sceneIndex);
  const idx = ensured.scenes.findIndex((s) => s.sceneIndex === sceneIndex);
  const updated = updater(ensured.scenes[idx]);
  const scenes = [...ensured.scenes];
  scenes[idx] = updated;
  return { ...ensured, scenes };
}

/**
 * Sets the selected candidate id. Pulls the id out of `rejectedCandidateIds`
 * and `pendingCandidateIds` so the disjointness invariant holds, and clears
 * `rerollRequested` because a concrete pick supersedes an in-flight reroll.
 */
export function selectCandidate(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
  candidateId: string,
): SceneSelectionArtifact {
  return updateEntry(artifact, sceneIndex, (entry) => ({
    ...entry,
    selectedCandidateId: candidateId,
    rejectedCandidateIds: entry.rejectedCandidateIds.filter((id) => id !== candidateId),
    pendingCandidateIds: entry.pendingCandidateIds.filter((id) => id !== candidateId),
    rerollRequested: false,
  }));
}

/**
 * Adds the candidate id to `rejectedCandidateIds` (dedup), removes it from
 * `pendingCandidateIds`, and clears `selectedCandidateId` if it matched.
 */
export function rejectCandidate(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
  candidateId: string,
): SceneSelectionArtifact {
  return updateEntry(artifact, sceneIndex, (entry) => {
    const rejected = entry.rejectedCandidateIds.includes(candidateId)
      ? entry.rejectedCandidateIds
      : [...entry.rejectedCandidateIds, candidateId];
    return {
      ...entry,
      selectedCandidateId:
        entry.selectedCandidateId === candidateId ? null : entry.selectedCandidateId,
      rejectedCandidateIds: rejected,
      pendingCandidateIds: entry.pendingCandidateIds.filter((id) => id !== candidateId),
    };
  });
}

/**
 * Adds the given candidate ids to `pendingCandidateIds`, skipping any that
 * already appear in `selectedCandidateId` or `rejectedCandidateIds` and any
 * that are already pending. Preserves existing order; appends new ids in the
 * order they were passed.
 */
export function markPending(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
  candidateIds: string[],
): SceneSelectionArtifact {
  return updateEntry(artifact, sceneIndex, (entry) => {
    const pending = [...entry.pendingCandidateIds];
    for (const id of candidateIds) {
      if (entry.selectedCandidateId === id) continue;
      if (entry.rejectedCandidateIds.includes(id)) continue;
      if (pending.includes(id)) continue;
      pending.push(id);
    }
    return { ...entry, pendingCandidateIds: pending };
  });
}

/**
 * Marks the scene as needing a reroll. Clears `selectedCandidateId` so the
 * operator has to make a fresh pick once the reroll produces a new candidate.
 * When `chainFromPrev` is passed, sets the chain flag explicitly; otherwise
 * leaves it unchanged.
 */
export function requestReroll(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
  chainFromPrev?: boolean,
): SceneSelectionArtifact {
  return updateEntry(artifact, sceneIndex, (entry) => ({
    ...entry,
    selectedCandidateId: null,
    rerollRequested: true,
    chainFromPrev: chainFromPrev !== undefined ? chainFromPrev : entry.chainFromPrev,
  }));
}

/** Explicitly sets the `chainFromPrev` flag. */
export function setChainFromPrev(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
  value: boolean,
): SceneSelectionArtifact {
  return updateEntry(artifact, sceneIndex, (entry) => ({
    ...entry,
    chainFromPrev: value,
  }));
}

/** Clears the `rerollRequested` flag. */
export function clearReroll(
  artifact: SceneSelectionArtifact,
  sceneIndex: number,
): SceneSelectionArtifact {
  return updateEntry(artifact, sceneIndex, (entry) => ({
    ...entry,
    rerollRequested: false,
  }));
}

export interface SceneSelectionSummary {
  /** Number of scenes with at least one candidate. */
  sceneCount: number;
  /** Number of scenes where `selectedCandidateId` is set. */
  withSelection: number;
  /** Number of scenes with a non-empty `pendingCandidateIds[]`. */
  withPending: number;
  /** Number of scenes with `rerollRequested: true`. */
  withReroll: number;
  /** Total candidate count across all scenes. */
  totalCandidates: number;
  /** Sum of `rejectedCandidateIds[].length` across all scenes. */
  rejectedCount: number;
}

/**
 * Aggregates coverage counts across the candidates and selection artifacts.
 * Safe to call with the empty artifacts returned by the disk stores when the
 * underlying JSON file is missing, so this works on legacy projects that never
 * produced candidates.
 */
export function summarizeSceneSelection(
  candidates: SceneCandidatesArtifact,
  selection: SceneSelectionArtifact,
): SceneSelectionSummary {
  let totalCandidates = 0;
  let sceneCount = 0;
  for (const entry of candidates.scenes) {
    if (entry.candidates.length === 0) continue;
    sceneCount += 1;
    totalCandidates += entry.candidates.length;
  }

  let withSelection = 0;
  let withPending = 0;
  let withReroll = 0;
  let rejectedCount = 0;
  for (const entry of selection.scenes) {
    if (entry.selectedCandidateId) withSelection += 1;
    if (entry.pendingCandidateIds.length > 0) withPending += 1;
    if (entry.rerollRequested) withReroll += 1;
    rejectedCount += entry.rejectedCandidateIds.length;
  }

  return {
    sceneCount,
    withSelection,
    withPending,
    withReroll,
    totalCandidates,
    rejectedCount,
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validates a selection artifact against a candidates artifact.
 *
 * Checks:
 *  - `unknown-candidate-ref` — every id referenced by selection must exist in
 *    the candidates artifact.
 *  - `disjointness-violation` — per scene, `selectedCandidateId`,
 *    `rejectedCandidateIds`, and `pendingCandidateIds` must be pairwise
 *    disjoint.
 *  - `round-gap` — generation rounds within a scene must be contiguous starting
 *    at 1.
 */
export function validateSelection(
  selection: SceneSelectionArtifact,
  candidates: SceneCandidatesArtifact,
): ValidationResult {
  const errors: string[] = [];
  const knownIds = new Set<string>();
  for (const entry of candidates.scenes) {
    for (const candidate of entry.candidates) knownIds.add(candidate.id);
  }

  for (const entry of selection.scenes) {
    const prefix = `scene=${entry.sceneIndex}`;
    const refs: string[] = [];
    if (entry.selectedCandidateId !== null) refs.push(entry.selectedCandidateId);
    refs.push(...entry.rejectedCandidateIds, ...entry.pendingCandidateIds);
    for (const id of refs) {
      if (!knownIds.has(id)) {
        errors.push(`unknown-candidate-ref: ${id} (${prefix})`);
      }
    }

    const rejectedSet = new Set(entry.rejectedCandidateIds);
    const pendingSet = new Set(entry.pendingCandidateIds);
    if (entry.selectedCandidateId !== null) {
      if (rejectedSet.has(entry.selectedCandidateId)) {
        errors.push(
          `disjointness-violation: selected id ${entry.selectedCandidateId} also in rejected (${prefix})`,
        );
      }
      if (pendingSet.has(entry.selectedCandidateId)) {
        errors.push(
          `disjointness-violation: selected id ${entry.selectedCandidateId} also in pending (${prefix})`,
        );
      }
    }
    for (const id of entry.rejectedCandidateIds) {
      if (pendingSet.has(id)) {
        errors.push(
          `disjointness-violation: id ${id} in both rejected and pending (${prefix})`,
        );
      }
    }
  }

  for (const entry of candidates.scenes) {
    if (entry.candidates.length === 0) continue;
    const rounds = Array.from(
      new Set(entry.candidates.map((c) => c.generationRound)),
    ).sort((a, b) => a - b);
    // Contiguous starting at 1.
    for (let i = 0; i < rounds.length; i++) {
      if (rounds[i] !== i + 1) {
        errors.push(
          `round-gap: scene=${entry.sceneIndex} expected ${i + 1} got ${rounds[i]}`,
        );
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
