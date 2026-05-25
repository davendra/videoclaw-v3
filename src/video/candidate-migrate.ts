import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor } from './artifact-store.js';
import { appendProjectEvent } from './events.js';
import { ensureProjectWorkspace } from './workspace.js';
import {
  readSceneCandidatesArtifact,
  sceneCandidatesPathFor,
  writeSceneCandidatesArtifact,
} from './scene-candidate-store.js';
import {
  sceneSelectionPathFor,
  writeSceneSelectionArtifact,
} from './scene-selection-store.js';
import type { AssetManifestArtifact } from './artifacts.js';
import type {
  SceneCandidate,
  SceneCandidatesArtifact,
  SceneSelectionArtifact,
  SceneSelectionEntry,
} from './types.js';

export interface MigrateCandidatesOptions {
  dryRun?: boolean;
}

export interface MigrateCandidatesResult {
  slug: string;
  dryRun: boolean;
  sceneCount: number;
  candidateIds: string[];
  candidatesPath: string;
  selectionPath: string;
  candidates: SceneCandidatesArtifact;
  selection: SceneSelectionArtifact;
}

/**
 * Rebuilds a `scene-candidates.json` + `scene-selection.json` pair from an
 * existing `asset-manifest.json`. One synthetic candidate is created per
 * distinct sceneIndex observed in the asset manifest, marked completed at
 * generationRound 1, with the original asset's path carried into the
 * candidate's `outputs`. The companion selection artifact is written with
 * that candidate already selected.
 *
 * Refuses (throws) if `scene-candidates.json` already exists. There is no
 * `--force` in v1 — the operator must remove the file explicitly first.
 */
export async function migrateCandidatesFromAssetManifest(
  root: string,
  slug: string,
  options: MigrateCandidatesOptions = {},
): Promise<MigrateCandidatesResult> {
  const dryRun = options.dryRun === true;

  const workspace = await ensureProjectWorkspace(slug, root);

  const candidatesPath = sceneCandidatesPathFor(root, slug);
  const selectionPath = sceneSelectionPathFor(root, slug);

  // Refuse if candidates already exist — migration is one-shot.
  if (existsSync(candidatesPath)) {
    const existing = await readSceneCandidatesArtifact(root, slug);
    if (existing.scenes.length > 0) {
      throw new Error(
        `migrate-refused: scene-candidates.json already exists at ${candidatesPath}. ` +
          `Remove it manually before migrating (no --force in v1).`,
      );
    }
  }

  const assetManifestPath = artifactPathFor(workspace, 'asset-manifest');
  if (!existsSync(assetManifestPath)) {
    throw new Error(
      `asset-manifest-missing: no asset-manifest.json at ${assetManifestPath}. ` +
        `Run 'vclaw video assets' or 'vclaw video produce --dry-run' first to seed one.`,
    );
  }
  const manifest = JSON.parse(
    await readFile(assetManifestPath, 'utf-8'),
  ) as AssetManifestArtifact;

  // Group assets by scene index. Assets without a sceneIndex are ignored —
  // migration only synthesizes candidates for scene-anchored outputs.
  const assetsByScene = new Map<number, AssetManifestArtifact['assets']>();
  for (const asset of manifest.assets) {
    if (asset.sceneIndex === undefined || asset.sceneIndex === null) continue;
    const bucket = assetsByScene.get(asset.sceneIndex) ?? [];
    bucket.push(asset);
    assetsByScene.set(asset.sceneIndex, bucket);
  }

  const sceneIndices = Array.from(assetsByScene.keys()).sort((a, b) => a - b);

  const now = new Date().toISOString();
  const scenes: SceneCandidatesArtifact['scenes'] = [];
  const selectionScenes: SceneSelectionEntry[] = [];
  const candidateIds: string[] = [];

  for (const sceneIndex of sceneIndices) {
    const sceneAssets = assetsByScene.get(sceneIndex) ?? [];
    const id = `scene-${sceneIndex}-take-1`;
    candidateIds.push(id);
    const outputs: SceneCandidate['outputs'] = sceneAssets
      .filter(
        (asset) =>
          asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'image',
      )
      .map((asset) => ({
        kind: asset.kind as 'video' | 'audio' | 'image',
        path: asset.path,
      }));
    const candidate: SceneCandidate = {
      id,
      generationRound: 1,
      prompt: `migrated from asset-manifest scene ${sceneIndex}`,
      route: 'legacy-migrated',
      submittedAt: now,
      completedAt: now,
      status: 'completed',
      outputs,
      source: {
        executionRound: 1,
        adapter: 'builtin',
        chainedFromCandidateId: null,
      },
    };
    scenes.push({ sceneIndex, candidates: [candidate] });
    selectionScenes.push({
      sceneIndex,
      selectedCandidateId: id,
      rejectedCandidateIds: [],
      pendingCandidateIds: [],
      rerollRequested: false,
      chainFromPrev: false,
    });
  }

  const candidates: SceneCandidatesArtifact = { schemaVersion: 1, scenes };
  const selection: SceneSelectionArtifact = {
    schemaVersion: 1,
    scenes: selectionScenes,
  };

  if (!dryRun) {
    await writeSceneCandidatesArtifact(root, slug, candidates);
    await writeSceneSelectionArtifact(root, slug, selection);
    for (const sceneIndex of sceneIndices) {
      const id = `scene-${sceneIndex}-take-1`;
      await appendProjectEvent(workspace, {
        type: 'scene-candidate.migrated',
        payload: {
          sceneIndex,
          candidateId: id,
          source: 'asset-manifest',
        },
      });
    }
  }

  return {
    slug,
    dryRun,
    sceneCount: sceneIndices.length,
    candidateIds,
    candidatesPath,
    selectionPath,
    candidates,
    selection,
  };
}
