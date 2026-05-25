import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { artifactPathFor } from './artifact-store.js';
import { buildExecutionProfile } from './execution-profile.js';
import { buildProviderStatusReport } from './provider-status.js';
import { buildPromptGuidance } from './prompt-guidance.js';
import { buildProjectReadiness } from './readiness.js';
import { sceneCandidatesPathFor } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { resolveProjectWorkspace, readProjectManifest } from './workspace.js';
import type {
  ProviderRouteId,
  VideoOperationKind,
} from './provider-platform/types.js';
import type {
  VideoExecutionPlan,
  VideoProductionMode,
} from './types.js';

function preferredRoutesForMode(mode: VideoProductionMode): ProviderRouteId[] {
  if (mode === 'director') {
    return ['seedance-direct', 'veo-useapi'];
  }
  return ['veo-useapi', 'seedance-direct'];
}

async function hasUnselectedStoryboardScenesInCandidateMode(
  projectSlug: string,
  root: string,
): Promise<boolean> {
  if (!existsSync(sceneCandidatesPathFor(root, projectSlug))) return false;
  const selection = await readSceneSelectionArtifact(root, projectSlug);
  const selectedSceneIndexes = new Set(
    selection.scenes
      .filter((scene) => typeof scene.selectedCandidateId === 'string' && scene.selectedCandidateId.length > 0)
      .map((scene) => scene.sceneIndex),
  );
  const workspace = resolveProjectWorkspace(projectSlug, root);
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  if (!existsSync(storyboardPath)) return false;
  const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as {
    scenes?: Array<{ sceneIndex?: number }>;
  };
  const sceneIndexes = (storyboard.scenes ?? [])
    .map((scene, index) => (typeof scene.sceneIndex === 'number' ? scene.sceneIndex : index));
  if (sceneIndexes.length === 0) return false;
  return sceneIndexes.some((sceneIndex) => !selectedSceneIndexes.has(sceneIndex));
}

async function inferOperationKind(
  projectSlug: string,
  root: string,
  mode: VideoProductionMode,
): Promise<VideoOperationKind> {
  const workspace = resolveProjectWorkspace(projectSlug, root);
  const assetManifestPath = artifactPathFor(workspace, 'asset-manifest');
  if (!existsSync(assetManifestPath)) {
    return mode === 'director' ? 'image-to-video' : 'image-to-video';
  }
  const manifest = JSON.parse(await readFile(assetManifestPath, 'utf-8')) as {
    assets?: Array<{ kind?: string }>;
  };
  const hasVideo = manifest.assets?.some((asset) => asset.kind === 'video') ?? false;
  const hasImage = manifest.assets?.some((asset) => asset.kind === 'image') ?? false;
  if (hasVideo && !hasImage) {
    // Candidate-mode reruns can temporarily produce a video-only manifest from
    // selected winners while later storyboard scenes still need generation.
    if (await hasUnselectedStoryboardScenesInCandidateMode(projectSlug, root)) {
      return 'image-to-video';
    }
    return 'edit';
  }
  if (hasImage) return 'image-to-video';
  return mode === 'director' ? 'image-to-video' : 'text-to-video';
}

export async function buildExecutionPlan(
  projectSlug: string,
  root = process.cwd(),
  fallbackMode: VideoProductionMode = 'storyboard',
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<VideoExecutionPlan> {
  const workspace = resolveProjectWorkspace(projectSlug, root);
  const manifest = await readProjectManifest(workspace);
  const productionMode = manifest?.productionMode ?? fallbackMode;
  const readiness = await buildProjectReadiness(projectSlug, root, productionMode);
  const operationKind = await inferOperationKind(projectSlug, root, productionMode);
  const providerStatus = buildProviderStatusReport({
    workspaceRoot: root,
    env: options.env,
    ignoreRuntimeDependencyIssues: true,
  });
  const preferredRoutes = preferredRoutesForMode(productionMode);

  const blockers = [...readiness.blockers];
  const rationale: string[] = [];
  let recommendedRouteId: ProviderRouteId | null = null;

  for (const routeId of preferredRoutes) {
    const route = providerStatus.routes.find((candidate) => candidate.routeId === routeId);
    if (!route) continue;
    if (!route.supportedOperations.includes(operationKind)) {
      rationale.push(`${routeId} skipped: does not support ${operationKind}.`);
      continue;
    }
    if (route.availability !== 'available') {
      rationale.push(`${routeId} skipped: route is ${route.availability}.`);
      continue;
    }
    recommendedRouteId = routeId;
    rationale.push(`${routeId} selected: supports ${operationKind} and is available.`);
    break;
  }

  if (!recommendedRouteId) {
    blockers.push(`No available provider route supports ${operationKind}.`);
  }
  const executionProfile = await buildExecutionProfile({
    projectSlug,
    root,
    productionMode,
    routeId: recommendedRouteId,
    operationKind,
  });
  const promptGuidance = buildPromptGuidance({
    routeId: recommendedRouteId,
    operationKind,
    productionMode,
  });

  return {
    projectSlug,
    productionMode,
    operationKind,
    recommendedRouteId,
    executionProfile,
    ready: blockers.length === 0,
    blockers,
    rationale,
    promptGuidance,
    generatedAt: new Date().toISOString(),
  };
}
