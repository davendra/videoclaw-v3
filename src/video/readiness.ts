import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { artifactPathFor } from './artifact-store.js';
import { buildCharacterConsistencyReport } from './character-consistency.js';
import { readImageDimensions } from './image-dimensions.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { sheetsCoveringScene } from './reference-sheets.js';
import { readSceneCandidatesArtifact, sceneCandidatesPathFor } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { readMultiShotPromptArtifactSummary, type MultiShotPromptArtifactSummary } from './multi-shot-artifact.js';
import { readProjectManifest, resolveProjectWorkspace } from './workspace.js';
import type { CharacterConsistencyReport, VideoProductionMode } from './types.js';
import type { ReferenceSheet } from './types.js';

export interface VideoProjectReadiness {
  slug: string;
  root: string;
  productionMode: VideoProductionMode;
  ready: boolean;
  requiredArtifacts: string[];
  presentArtifacts: string[];
  missingArtifacts: string[];
  characterConsistency: CharacterConsistencyReport;
  multiShotPrompt?: MultiShotPromptArtifactSummary;
  blockers: string[];
  warnings: string[];
  nextAction: string;
}

type ExecutionAspectRatio = '16:9' | '9:16' | '1:1';
type ExecutionResolution = '720p' | '1080p';

function normalizeAspectRatio(value: unknown): ExecutionAspectRatio | null {
  return value === '16:9' || value === '9:16' || value === '1:1' ? value : null;
}

function normalizeResolution(value: unknown): ExecutionResolution | null {
  return value === '720p' || value === '1080p' ? value : null;
}

function expectedRatio(value: ExecutionAspectRatio): number {
  switch (value) {
    case '16:9':
      return 16 / 9;
    case '9:16':
      return 9 / 16;
    case '1:1':
      return 1;
  }
}

function minShortEdge(value: ExecutionResolution): number {
  return value === '1080p' ? 1080 : 720;
}

async function readImageExecutionProfile(workspace: ReturnType<typeof resolveProjectWorkspace>): Promise<{
  aspectRatio: ExecutionAspectRatio;
  resolution: ExecutionResolution;
}> {
  const briefPath = artifactPathFor(workspace, 'brief');
  if (!existsSync(briefPath)) {
    return { aspectRatio: '16:9', resolution: '720p' };
  }
  try {
    const brief = JSON.parse(await readFile(briefPath, 'utf-8')) as {
      metadata?: {
        platform?: string;
        executionProfile?: Record<string, unknown>;
      };
    };
    const explicitAspectRatio = normalizeAspectRatio(brief.metadata?.executionProfile?.aspectRatio);
    const platform = String(brief.metadata?.platform ?? '').toLowerCase();
    const inferredAspectRatio = ['tiktok', 'reels', 'shorts'].includes(platform) ? '9:16' : '16:9';
    return {
      aspectRatio: explicitAspectRatio ?? inferredAspectRatio,
      resolution: normalizeResolution(brief.metadata?.executionProfile?.resolution) ?? '720p',
    };
  } catch {
    return { aspectRatio: '16:9', resolution: '720p' };
  }
}

function localAssetPath(workspace: ReturnType<typeof resolveProjectWorkspace>, value: string): string {
  return isAbsolute(value) ? value : resolve(workspace.projectDir, value);
}

function identitySheetWarnings(sceneIndex: number, characters: string[], sheets: ReferenceSheet[]): string[] {
  const warnings: string[] = [];
  const characterSet = new Set(characters.map((name) => name.toLowerCase()));
  for (const sheet of sheets.filter((candidate) => candidate.type === 'identity')) {
    const identityRefs = sheet.references.filter((reference) => reference.role === 'identity').length;
    if (sheet.characterName && !characterSet.has(sheet.characterName.toLowerCase())) {
      warnings.push(
        `reference-sheet-character-mismatch: scene ${sceneIndex} binds Identity Sheet ${sheet.id} for ${sheet.characterName}, but that character is not listed on the scene`,
      );
    }
    if (identityRefs === 0) {
      warnings.push(
        `reference-sheet-weak-identity: scene ${sceneIndex} Identity Sheet ${sheet.id} has no identity-role reference`,
      );
      continue;
    }
    if (identityRefs < 2) {
      warnings.push(
        `reference-sheet-thin-identity-coverage: scene ${sceneIndex} Identity Sheet ${sheet.id} has ${identityRefs} identity reference; add front/profile/detail references when continuity matters`,
      );
    }
  }
  return warnings;
}

export async function buildProjectReadiness(
  slug: string,
  root = process.cwd(),
  fallbackMode: VideoProductionMode = 'storyboard',
): Promise<VideoProjectReadiness> {
  const workspace = resolveProjectWorkspace(slug, root);
  const manifest = await readProjectManifest(workspace);
  const productionMode = manifest?.productionMode ?? fallbackMode;

  const requiredArtifacts = ['brief', 'storyboard', 'asset-manifest'];
  const presentArtifacts = requiredArtifacts.filter((artifact) =>
    existsSync(artifactPathFor(workspace, artifact as 'brief' | 'storyboard' | 'asset-manifest')),
  );
  const missingArtifacts = requiredArtifacts.filter((artifact) => !presentArtifacts.includes(artifact));

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!manifest) {
    blockers.push('Project manifest is missing.');
  }
  if (manifest?.blockedBy && manifest.blockedBy.length > 0) {
    blockers.push(
      manifest.blockedReason
        ? `${manifest.blockedReason} (blocked by: ${manifest.blockedBy.join(', ')})`
        : `Blocked by: ${manifest.blockedBy.join(', ')}`,
    );
  }
  if (missingArtifacts.length > 0) {
    blockers.push(`Missing required artifacts: ${missingArtifacts.join(', ')}`);
  }
  const characterConsistency = await buildCharacterConsistencyReport(slug, root);
  blockers.push(...characterConsistency.issues);
  const multiShotPrompt = await readMultiShotPromptArtifactSummary(workspace);
  if (multiShotPrompt && multiShotPrompt.valid === false) {
    warnings.push(
      `multi-shot-prompt-invalid: ${multiShotPrompt.issueCount} issue(s) recorded; rerun \`vclaw video multi-shot --validate --explain-issues\` before rendering this prompt`,
    );
  }

  // Reference-sheet readiness (director-mode only): any scene that binds at least one
  // character must be covered by at least one Identity Sheet.
  const missingIdentityScenes: number[] = [];
  if (productionMode === 'director') {
    const storyboardPath = artifactPathFor(workspace, 'storyboard');
    if (existsSync(storyboardPath)) {
      try {
        const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as {
          scenes?: Array<{ sceneIndex?: number; characters?: string[] }>;
        };
        const sheetsArtifact = await readReferenceSheetsArtifact(workspace.root, slug);
        for (const [i, scene] of (storyboard.scenes ?? []).entries()) {
          if (!scene.characters || scene.characters.length === 0) continue;
          const sceneIndex = typeof scene.sceneIndex === 'number' ? scene.sceneIndex : i;
          const covering = sheetsCoveringScene(sheetsArtifact, sceneIndex);
          const hasIdentity = covering.some((sheet) => sheet.type === 'identity');
          if (!hasIdentity) {
            missingIdentityScenes.push(sceneIndex);
            blockers.push(
              `reference-sheet-missing-identity: scene ${sceneIndex} has character bindings but no Identity Sheet is bound to it`,
            );
          } else {
            warnings.push(...identitySheetWarnings(sceneIndex, scene.characters, covering));
          }
        }
      } catch {
        // Storyboard or sheets unreadable — other blockers will surface it.
      }
    }
  }

  // Scene-candidate selection readiness (feature-gated on the candidates file).
  // When the project has no `scene-candidates.json` on disk we skip entirely so
  // legacy projects without candidates continue to advance. When the file does
  // exist, any scene with ≥1 candidate but no selection blocks review/publish.
  const scenesMissingSelection: number[] = [];
  if (existsSync(sceneCandidatesPathFor(workspace.root, slug))) {
    const candidates = await readSceneCandidatesArtifact(workspace.root, slug);
    const selection = await readSceneSelectionArtifact(workspace.root, slug);
    const selectedByScene = new Map<number, string | null>();
    const rerollByScene = new Map<number, boolean>();
    for (const entry of selection.scenes) {
      selectedByScene.set(entry.sceneIndex, entry.selectedCandidateId);
      rerollByScene.set(entry.sceneIndex, entry.rerollRequested);
    }
    for (const entry of candidates.scenes) {
      // Only scenes with at least one *completed* candidate require a
      // selection — scenes whose candidates are still pending/failed are
      // in-flight and shouldn't block further execute runs on sibling scenes.
      const hasCompleted = entry.candidates.some((c) => c.status === 'completed');
      if (!hasCompleted) continue;
      const selected = selectedByScene.get(entry.sceneIndex) ?? null;
      const rerollRequested = rerollByScene.get(entry.sceneIndex) ?? false;
      if (!selected && !rerollRequested) {
        scenesMissingSelection.push(entry.sceneIndex);
      }
    }
    if (scenesMissingSelection.length > 0) {
      blockers.push(
        `scene-selection-missing: scene(s) ${scenesMissingSelection.join(', ')} have candidates but no selection`,
      );
    }
  }

  const assetManifestPath = artifactPathFor(workspace, 'asset-manifest');
  if (existsSync(assetManifestPath)) {
    try {
      const assetManifest = JSON.parse(await readFile(assetManifestPath, 'utf-8')) as {
        assets?: Array<{ id?: string; kind?: string; path?: string; sceneIndex?: number }>;
      };
      const profile = await readImageExecutionProfile(workspace);
      const expected = expectedRatio(profile.aspectRatio);
      const ratioTolerance = 0.03;
      for (const asset of assetManifest.assets ?? []) {
        if (asset.kind !== 'image' || !asset.path) continue;
        const path = localAssetPath(workspace, asset.path);
        const label = asset.id ?? asset.path;
        if (!existsSync(path)) {
          warnings.push(`image-input-missing: asset ${label} points to missing local image ${asset.path}`);
          continue;
        }
        const dimensions = await readImageDimensions(path);
        if (!dimensions) {
          warnings.push(`image-input-unreadable: asset ${label} is not a supported PNG/JPEG image`);
          continue;
        }
        const actualRatio = dimensions.width / dimensions.height;
        if (Math.abs(actualRatio - expected) > ratioTolerance) {
          warnings.push(
            `image-input-aspect-ratio-mismatch: asset ${label} is ${dimensions.width}x${dimensions.height}, expected ${profile.aspectRatio}`,
          );
        }
        const shortEdge = Math.min(dimensions.width, dimensions.height);
        const minimum = minShortEdge(profile.resolution);
        if (shortEdge < minimum) {
          warnings.push(
            `image-input-low-resolution: asset ${label} is ${dimensions.width}x${dimensions.height}, below ${profile.resolution} short-edge target ${minimum}px`,
          );
        }
      }
    } catch {
      warnings.push('image-input-check-skipped: asset-manifest could not be parsed for image readiness checks');
    }
  }

  const ready = blockers.length === 0;
  const nextAction = ready
    ? 'Project is ready for execution/runtime wiring.'
    : missingArtifacts.length > 0
      ? `Create missing artifacts: ${missingArtifacts.join(', ')}`
      : characterConsistency.issues.length > 0
        ? 'Resolve character consistency issues before execution.'
      : missingIdentityScenes.length > 0
        ? `Bind an Identity Sheet to scene(s) ${missingIdentityScenes.join(', ')} before execution.`
      : scenesMissingSelection.length > 0
        ? `Select a candidate for scene(s) ${scenesMissingSelection.join(', ')} before review.`
      : blockers[0] ?? 'Resolve project blockers.';

  return {
    slug,
    root: workspace.root,
    productionMode,
    ready,
    requiredArtifacts,
    presentArtifacts,
    missingArtifacts,
    characterConsistency,
    ...(multiShotPrompt ? { multiShotPrompt } : {}),
    blockers,
    warnings,
    nextAction,
  };
}
