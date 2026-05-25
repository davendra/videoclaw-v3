import type {
  SceneCandidate,
  SceneCandidatesArtifact,
  SceneCandidatesEntry,
  SceneSelectionArtifact,
} from './types.js';
import type { AssetManifestArtifact } from './artifacts.js';

/**
 * Returns the next available candidate id for the given scene, shaped as
 * `scene-<sceneIndex>-take-<n>`. The integer `n` is chosen so that the resulting
 * id does not collide with any existing candidate in the artifact — we scan the
 * ENTIRE artifact (not just the scene's own entry) because candidate ids are
 * unique globally.
 */
export function nextCandidateId(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
): string {
  const used = new Set<string>();
  for (const entry of artifact.scenes) {
    for (const candidate of entry.candidates) {
      used.add(candidate.id);
    }
  }
  for (let n = 1; n < 10_000; n++) {
    const candidate = `scene-${sceneIndex}-take-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`ran out of candidate ids for scene ${sceneIndex}`);
}

/**
 * Immutable append. Creates a new scene entry if none exists for `sceneIndex`,
 * otherwise appends to the existing entry's candidate list. Does not mutate
 * inputs.
 */
export function appendCandidate(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
  candidate: SceneCandidate,
): SceneCandidatesArtifact {
  const idx = artifact.scenes.findIndex((s) => s.sceneIndex === sceneIndex);
  if (idx === -1) {
    const entry: SceneCandidatesEntry = { sceneIndex, candidates: [candidate] };
    return { ...artifact, scenes: [...artifact.scenes, entry] };
  }
  const existing = artifact.scenes[idx];
  const updated: SceneCandidatesEntry = {
    ...existing,
    candidates: [...existing.candidates, candidate],
  };
  const scenes = [...artifact.scenes];
  scenes[idx] = updated;
  return { ...artifact, scenes };
}

export interface FindCandidateResult {
  sceneIndex: number;
  candidate: SceneCandidate;
}

/**
 * Looks up a candidate by id across all scenes. Returns `null` when not found.
 */
export function findCandidate(
  artifact: SceneCandidatesArtifact,
  candidateId: string,
): FindCandidateResult | null {
  for (const entry of artifact.scenes) {
    for (const candidate of entry.candidates) {
      if (candidate.id === candidateId) {
        return { sceneIndex: entry.sceneIndex, candidate };
      }
    }
  }
  return null;
}

export interface CandidatesSummary {
  totalCandidates: number;
  sceneCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
}

/**
 * Aggregates headline counts across the artifact. `sceneCount` is the number of
 * scene entries (one per sceneIndex), not the storyboard scene total.
 */
export function summarizeCandidates(
  artifact: SceneCandidatesArtifact,
): CandidatesSummary {
  let total = 0;
  let completed = 0;
  let pending = 0;
  let failed = 0;
  for (const entry of artifact.scenes) {
    for (const candidate of entry.candidates) {
      total += 1;
      if (candidate.status === 'completed') completed += 1;
      else if (candidate.status === 'pending') pending += 1;
      else if (candidate.status === 'failed') failed += 1;
    }
  }
  return {
    totalCandidates: total,
    sceneCount: artifact.scenes.length,
    completedCount: completed,
    pendingCount: pending,
    failedCount: failed,
  };
}

/**
 * Returns the candidate list for a scene, or an empty array when the scene has
 * no entry.
 */
export function candidatesForScene(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
): SceneCandidate[] {
  const entry = artifact.scenes.find((s) => s.sceneIndex === sceneIndex);
  return entry ? [...entry.candidates] : [];
}

/**
 * Returns the highest `generationRound` recorded for the scene, or 0 when the
 * scene has no candidates.
 */
export function maxRoundForScene(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
): number {
  const entry = artifact.scenes.find((s) => s.sceneIndex === sceneIndex);
  if (!entry || entry.candidates.length === 0) return 0;
  return entry.candidates.reduce((max, c) => Math.max(max, c.generationRound), 0);
}

function assetKindForCandidateOutput(
  kind: 'video' | 'audio' | 'image',
): AssetManifestArtifact['assets'][number]['kind'] {
  // SceneCandidateOutput.kind is a subset of asset-manifest asset kinds.
  return kind;
}

/**
 * Re-derives an `asset-manifest.json` artifact from the current candidates and
 * selection state. Only candidates referenced by `selectedCandidateId` in the
 * selection artifact contribute assets. The resulting manifest preserves the
 * provided project slug.
 *
 * This helper is pure — it does not touch disk. Callers are responsible for
 * persisting the returned artifact via `writeArtifact(workspace, 'asset-manifest', …)`.
 */
export function deriveAssetManifestFromSelection(
  projectSlug: string,
  candidates: SceneCandidatesArtifact,
  selection: SceneSelectionArtifact,
): AssetManifestArtifact {
  const assets: AssetManifestArtifact['assets'] = [];
  const selectedByScene = new Map<number, string>();
  for (const entry of selection.scenes) {
    if (entry.selectedCandidateId) {
      selectedByScene.set(entry.sceneIndex, entry.selectedCandidateId);
    }
  }

  for (const entry of candidates.scenes) {
    const selectedId = selectedByScene.get(entry.sceneIndex);
    if (!selectedId) continue;
    const candidate = entry.candidates.find((c) => c.id === selectedId);
    if (!candidate) continue;
    for (let i = 0; i < candidate.outputs.length; i += 1) {
      const out = candidate.outputs[i];
      assets.push({
        id: `${candidate.id}-output-${i + 1}`,
        kind: assetKindForCandidateOutput(out.kind),
        path: out.path,
        sceneIndex: entry.sceneIndex,
      });
    }
  }

  assets.sort((left, right) => left.id.localeCompare(right.id));
  return { projectSlug, assets };
}
