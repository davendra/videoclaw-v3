import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { artifactPathFor } from './artifact-store.js';
import { readSceneCandidatesArtifact } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { readSeedanceAssets } from './seedance-asset-library.js';
import { assertReferenceBudget } from './native-seedance.js';
import { resolveProjectWorkspace } from './workspace.js';
import type { FilmmakingPromptsArtifact, FilmmakingSeedancePacket } from './filmmaking-prompts.js';
import type { ProviderRouteId } from './provider-platform/types.js';
import type {
  VideoExecutionCancelResult,
  VideoExecutionPayload,
  VideoExecutionPlan,
  VideoExecutionPollResult,
  VideoExecutionTask,
} from './types.js';

function adapterEnvVarForRoute(routeId: ProviderRouteId): string {
  switch (routeId) {
    case 'veo-direct':
      return 'VCLAW_VEO_DIRECT_ADAPTER';
    case 'veo-useapi':
      return 'VCLAW_VEO_USEAPI_ADAPTER';
    case 'seedance-direct':
      return 'VCLAW_SEEDANCE_DIRECT_ADAPTER';
    case 'runway-useapi':
      return 'VCLAW_RUNWAY_USEAPI_ADAPTER';
    case 'dreamina-useapi':
      return 'VCLAW_DREAMINA_USEAPI_ADAPTER';
  }
}

function builtinAdapterCommandForRoute(routeId: ProviderRouteId): string | null {
  if (!(routeId === 'seedance-direct' || routeId === 'veo-useapi' || routeId === 'runway-useapi' || routeId === 'dreamina-useapi')) {
    return null;
  }
  const scriptPath = fileURLToPath(new URL('../cli/provider-adapter.js', import.meta.url));
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} --route ${routeId}`;
}

function resolveAdapterCommand(routeId: ProviderRouteId, env: NodeJS.ProcessEnv): string {
  const override = env[adapterEnvVarForRoute(routeId)];
  if (override && override.trim()) {
    return override;
  }
  const builtin = builtinAdapterCommandForRoute(routeId);
  if (builtin) {
    return builtin;
  }
  throw new Error(`Live execution for ${routeId} requires ${adapterEnvVarForRoute(routeId)} to point at an adapter command.`);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export interface BuildExecutionPayloadOptions {
  /**
   * Restricts the payload to these scene indices. When omitted, all storyboard
   * scenes are included (legacy behavior). When provided, scenes not in the
   * list are dropped.
   */
  sceneIndices?: number[];
  /**
   * When true, resolves `chainFromPrev` seeds from the previous scene's
   * selected candidate. Only honored in candidate mode.
   */
  resolveChainSeeds?: boolean;
}

/**
 * Error thrown when `resolveChainSeeds` is enabled and the upstream scene has
 * no selected candidate (or no usable video output).
 */
export class ChainFromPrevSourceMissingError extends Error {
  readonly code = 'chain-from-prev-source-missing';
  readonly sceneIndex: number;
  readonly sourceSceneIndex: number;
  constructor(sceneIndex: number, sourceSceneIndex: number, reason: string) {
    super(
      `chain-from-prev-source-missing: scene ${sceneIndex} requested chain from scene ${sourceSceneIndex} but ${reason}`,
    );
    this.sceneIndex = sceneIndex;
    this.sourceSceneIndex = sourceSceneIndex;
    this.name = 'ChainFromPrevSourceMissingError';
  }
}

export async function buildExecutionPayload(
  projectSlug: string,
  plan: VideoExecutionPlan,
  root = process.cwd(),
  options: BuildExecutionPayloadOptions = {},
): Promise<VideoExecutionPayload> {
  if (!plan.recommendedRouteId) {
    throw new Error(`Cannot build execution payload for ${projectSlug}: recommendedRouteId missing.`);
  }

  const workspace = resolveProjectWorkspace(projectSlug, root);
  const storyboard = JSON.parse(await readFile(artifactPathFor(workspace, 'storyboard'), 'utf-8')) as {
    scenes?: Array<{
      sceneIndex?: number;
      description?: string;
      scenePrompt?: {
        animationPrompt?: string;
      };
      characters?: string[];
      durationSeconds?: number;
    }>;
  };
  const assetManifest = existsSync(artifactPathFor(workspace, 'asset-manifest'))
    ? JSON.parse(await readFile(artifactPathFor(workspace, 'asset-manifest'), 'utf-8')) as {
        assets?: Array<{ id?: string; kind?: string; path?: string; sceneIndex?: number; backend?: string }>;
      }
    : { assets: [] };
  const filmmakingPrompts = existsSync(artifactPathFor(workspace, 'filmmaking-prompts'))
    ? JSON.parse(await readFile(artifactPathFor(workspace, 'filmmaking-prompts'), 'utf-8')) as FilmmakingPromptsArtifact
    : null;
  const readyPromptPacketsByScene = new Map<number, FilmmakingSeedancePacket>();
  for (const packet of filmmakingPrompts?.seedancePackets ?? []) {
    if (isExecutionReadyPromptPacket(packet)) {
      readyPromptPacketsByScene.set(packet.sceneIndex, packet);
    }
  }

  const assetsByScene = new Map<number, Array<{ id?: string; kind?: string; path?: string; backend?: string }>>();
  for (const asset of assetManifest.assets ?? []) {
    if (!Number.isInteger(asset.sceneIndex)) continue;
    const sceneAssets = assetsByScene.get(asset.sceneIndex as number) ?? [];
    sceneAssets.push(asset);
    assetsByScene.set(asset.sceneIndex as number, sceneAssets);
  }

  // Chain-from-prev resolution is only considered when the caller opts in.
  // Reads both selection + candidates so we can locate the upstream scene's
  // selected candidate's video output.
  const chainSeedsByScene = new Map<number, { path: string; sourceCandidateId: string }>();
  if (options.resolveChainSeeds) {
    const selection = await readSceneSelectionArtifact(root, projectSlug);
    const candidates = await readSceneCandidatesArtifact(root, projectSlug);
    const sceneList = (storyboard.scenes ?? []).map((s) => s.sceneIndex ?? 0);
    const sceneIndexFilter = options.sceneIndices
      ? new Set(options.sceneIndices)
      : new Set(sceneList);

    for (const sel of selection.scenes) {
      if (!sel.chainFromPrev) continue;
      if (!sceneIndexFilter.has(sel.sceneIndex)) continue;
      const sourceSceneIndex = sel.sceneIndex - 1;
      const upstreamSelection = selection.scenes.find((s) => s.sceneIndex === sourceSceneIndex);
      if (!upstreamSelection || !upstreamSelection.selectedCandidateId) {
        throw new ChainFromPrevSourceMissingError(
          sel.sceneIndex,
          sourceSceneIndex,
          upstreamSelection ? 'upstream scene has no selected candidate' : 'upstream scene has no selection entry',
        );
      }
      const upstreamEntry = candidates.scenes.find((s) => s.sceneIndex === sourceSceneIndex);
      const upstreamCandidate = upstreamEntry?.candidates.find(
        (c) => c.id === upstreamSelection.selectedCandidateId,
      );
      if (!upstreamCandidate) {
        throw new ChainFromPrevSourceMissingError(
          sel.sceneIndex,
          sourceSceneIndex,
          `candidate ${upstreamSelection.selectedCandidateId} missing from candidates artifact`,
        );
      }
      const firstVideo = upstreamCandidate.outputs.find((o) => o.kind === 'video');
      if (!firstVideo) {
        throw new ChainFromPrevSourceMissingError(
          sel.sceneIndex,
          sourceSceneIndex,
          `candidate ${upstreamSelection.selectedCandidateId} has no video output to chain from`,
        );
      }
      chainSeedsByScene.set(sel.sceneIndex, {
        path: firstVideo.path,
        sourceCandidateId: upstreamCandidate.id,
      });
    }
  }

  const sceneFilter = options.sceneIndices ? new Set(options.sceneIndices) : null;

  // Seedance character/product identity is locked via managed Asset Library
  // avatars (Asset:// URIs). When the project has registered them, each scene's
  // cast names resolve to Asset:// URIs that become that scene's reference set.
  // Absent artifact -> empty map -> behavior identical to today (no injection).
  // Gated to the Seedance route so Veo/Runway payloads are untouched.
  const assetUriByName = plan.recommendedRouteId === 'seedance-direct'
    ? (await readSeedanceAssets(workspace.root, projectSlug)).assetUriByName
    : new Map<string, string>();

  const tasks: VideoExecutionTask[] = (storyboard.scenes ?? [])
    .filter((scene) => {
      if (!sceneFilter) return true;
      const sceneIndex = scene.sceneIndex ?? 0;
      return sceneFilter.has(sceneIndex);
    })
    .map((scene) => {
      const sceneIndex = scene.sceneIndex ?? 0;
      const sceneAssets = assetsByScene.get(sceneIndex) ?? [];
      const chainSeed = chainSeedsByScene.get(sceneIndex);
      const promptPacket = readyPromptPacketsByScene.get(sceneIndex);
      const promptPacketReferencePaths = promptPacket
        ? promptPacket.references.map((reference) => reference.path ?? '')
        : [];
      const hasVideo = !!chainSeed || sceneAssets.some((asset) => asset.kind === 'video');
      const hasImage = sceneAssets.some((asset) => asset.kind === 'image') || promptPacketReferencePaths.length > 0;

      // When we chain from the previous scene's output, the seed video path
      // must lead `referencePaths` so downstream adapters pick it as the
      // primary input. We also force `inputKind: 'video'`.
      const baseReferencePaths = unique(
        sceneAssets
          .filter((asset) => asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio')
          .map((asset) => asset.path ?? ''),
      );
      // A ready prompt packet supplies the IMAGE references, but the scene's
      // own audio/video reference assets must still survive — otherwise
      // reference_audios (and any non-packet video reference) silently
      // disappears from the provider payload for packet-driven scenes.
      const baseNonImageReferencePaths = unique(
        sceneAssets
          .filter((asset) => asset.kind === 'video' || asset.kind === 'audio')
          .map((asset) => asset.path ?? ''),
      );
      const packetOrBaseReferencePaths = promptPacketReferencePaths.length > 0
        ? unique([...promptPacketReferencePaths, ...baseNonImageReferencePaths])
        : baseReferencePaths;
      // When the project has registered Seedance Asset Library avatars, this
      // scene's resolved cast/product Asset:// URIs become its reference set
      // (the proven identity-lock mechanism). Names that don't resolve are
      // dropped. Empty map (no artifact) -> falls through to today's behavior.
      const resolvedAssetUris = unique(
        unique(scene.characters ?? [])
          .map((name) => assetUriByName.get(name))
          .filter((uri): uri is string => Boolean(uri)),
      );
      const referencePaths = resolvedAssetUris.length > 0
        ? resolvedAssetUris
        : chainSeed
          ? unique([chainSeed.path, ...packetOrBaseReferencePaths])
          : packetOrBaseReferencePaths;
      // Fail fast if the injected Asset:// reference set exceeds Seedance's
      // per-generation limits (reuses the canonical budget; does not duplicate
      // the limits). Only runs when this feature actually populated references,
      // so non-asset/non-seedance payloads are byte-identical to today.
      if (resolvedAssetUris.length > 0) {
        assertReferenceBudget(referencePaths);
      }
      const backendHints = unique([
        ...sceneAssets.map((asset) => asset.backend ?? ''),
        ...(promptPacket ? ['filmmaking-prompts', `prompt-variant:${promptPacket.variant}`] : []),
      ]);
      const durationSeconds = promptPacket?.durationSeconds ?? scene.durationSeconds;
      // OUTPUT-DEPENDENT render resolution, threaded from the prompt packet.
      // Absent on legacy packets -> field omitted (no change to existing tasks).
      const resolution = promptPacket?.resolution;

      return {
        sceneIndex,
        prompt: promptPacket?.promptText.trim() || scene.scenePrompt?.animationPrompt?.trim() || scene.description || '',
        inputKind: hasVideo ? 'video' : hasImage ? 'image' : 'text',
        referencePaths,
        ...(promptPacket ? {
          referenceSlots: promptPacket.references.map((reference) => ({
            slot: reference.slot,
            role: reference.role,
            label: reference.label,
            ...(reference.path ? { path: reference.path } : {}),
          })),
          promptPacketVariant: promptPacket.variant,
        } : {}),
        // Asset ids only — packet reference slot names are surfaced separately
        // via `referenceSlots` and must not pollute the asset-id provenance
        // contract (telemetry/reports join these back to the asset manifest).
        sourceAssetIds: unique(sceneAssets.map((asset) => asset.id ?? '')),
        backendHints,
        characters: unique(scene.characters ?? []),
        ...(Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
        ...(resolution ? { resolution } : {}),
        ...(chainSeed ? { chainedFromCandidateId: chainSeed.sourceCandidateId } : {}),
      };
    });

  const outputDir = join(workspace.projectDir, 'outputs');
  await mkdir(outputDir, { recursive: true });

  return {
    workspaceRoot: workspace.root,
    projectSlug,
    productionMode: plan.productionMode,
    routeId: plan.recommendedRouteId,
    operationKind: plan.operationKind,
    executionProfile: plan.executionProfile,
    generatedAt: new Date().toISOString(),
    outputDir,
    tasks,
    promptGuidance: plan.promptGuidance,
  };
}

function isExecutionReadyPromptPacket(packet: FilmmakingSeedancePacket): boolean {
  if (!packet.promptText.trim()) return false;
  if (packet.references.some((reference) => reference.status !== 'ready')) return false;
  if (packet.references.some((reference) => !reference.path?.trim())) return false;
  return true;
}

export async function submitExecutionPayload(
  payload: VideoExecutionPayload,
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{
  adapterCommand: string;
  externalJobId: string | null;
  rawResult: unknown;
}> {
  const env = options.env ?? process.env;
  const adapterCommand = resolveAdapterCommand(payload.routeId, env);

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn('sh', ['-lc', adapterCommand], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });

  if (result.code !== 0) {
    throw new Error(`Adapter command failed for ${payload.routeId}: ${result.stderr.trim() || `exit ${result.code}`}`);
  }

  const trimmed = result.stdout.trim();
  let rawResult: unknown = trimmed;
  if (trimmed) {
    try {
      rawResult = JSON.parse(trimmed) as unknown;
    } catch {
      rawResult = trimmed;
    }
  }

  const externalJobId = rawResult && typeof rawResult === 'object' && 'externalJobId' in rawResult
    ? String((rawResult as { externalJobId?: unknown }).externalJobId ?? '') || null
    : null;

  return {
    adapterCommand,
    externalJobId,
    rawResult,
  };
}

export async function pollExecutionPayload(
  input: {
    projectSlug: string;
    routeId: ProviderRouteId;
    externalJobId: string;
    outputDir: string;
  },
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<VideoExecutionPollResult> {
  const env = options.env ?? process.env;
  const adapterCommand = resolveAdapterCommand(input.routeId, env);

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn('sh', ['-lc', adapterCommand], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
    child.stdin.write(JSON.stringify({
      action: 'poll',
      ...input,
    }));
    child.stdin.end();
  });

  if (result.code !== 0) {
    throw new Error(`Adapter poll failed for ${input.routeId}: ${result.stderr.trim() || `exit ${result.code}`}`);
  }

  const trimmed = result.stdout.trim();
  let rawResult: unknown = trimmed;
  if (trimmed) {
    try {
      rawResult = JSON.parse(trimmed) as unknown;
    } catch {
      rawResult = trimmed;
    }
  }

  const status = rawResult && typeof rawResult === 'object' && 'status' in rawResult
    ? String((rawResult as { status?: unknown }).status ?? '')
    : '';
  if (!(status === 'pending' || status === 'completed' || status === 'failed')) {
    throw new Error(`Adapter poll for ${input.routeId} returned invalid status: ${status || 'missing'}`);
  }

  const outputs = rawResult && typeof rawResult === 'object' && 'outputs' in rawResult && Array.isArray((rawResult as { outputs?: unknown }).outputs)
    ? ((rawResult as { outputs: Array<{ id?: unknown; kind?: unknown; path?: unknown; sceneIndex?: unknown; backend?: unknown }> }).outputs
        .filter((asset) => typeof asset.id === 'string' && typeof asset.kind === 'string' && typeof asset.path === 'string')
        .map((asset) => ({
          id: String(asset.id),
          kind: ['image', 'video', 'audio', 'subtitle', 'other'].includes(String(asset.kind))
            ? String(asset.kind) as 'image' | 'video' | 'audio' | 'subtitle' | 'other'
            : 'other',
          path: String(asset.path),
          ...(Number.isInteger(asset.sceneIndex) ? { sceneIndex: asset.sceneIndex as number } : {}),
          ...(typeof asset.backend === 'string' && asset.backend.trim() ? { backend: asset.backend } : {}),
        })))
    : [];

  const issues = rawResult && typeof rawResult === 'object' && 'issues' in rawResult && Array.isArray((rawResult as { issues?: unknown }).issues)
    ? (rawResult as { issues: unknown[] }).issues.map((value) => String(value))
    : [];

  const externalJobId = rawResult && typeof rawResult === 'object' && 'externalJobId' in rawResult
    ? String((rawResult as { externalJobId?: unknown }).externalJobId ?? '') || input.externalJobId
    : input.externalJobId;

  return {
    status,
    externalJobId,
    outputs,
    issues,
    rawResult,
  };
}

export async function cancelExecutionPayload(
  input: {
    projectSlug: string;
    routeId: ProviderRouteId;
    externalJobId: string;
    outputDir: string;
    workspaceRoot: string;
  },
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<VideoExecutionCancelResult> {
  const env = options.env ?? process.env;
  const adapterCommand = resolveAdapterCommand(input.routeId, env);

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn('sh', ['-lc', adapterCommand], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
    child.stdin.write(JSON.stringify({
      action: 'cancel',
      ...input,
    }));
    child.stdin.end();
  });

  if (result.code !== 0) {
    throw new Error(`Adapter cancel failed for ${input.routeId}: ${result.stderr.trim() || `exit ${result.code}`}`);
  }

  const trimmed = result.stdout.trim();
  let rawResult: unknown = trimmed;
  if (trimmed) {
    try {
      rawResult = JSON.parse(trimmed) as unknown;
    } catch {
      rawResult = trimmed;
    }
  }

  const status = rawResult && typeof rawResult === 'object' && 'status' in rawResult
    ? String((rawResult as { status?: unknown }).status ?? '')
    : '';
  if (!(status === 'cancelled' || status === 'unsupported')) {
    throw new Error(`Adapter cancel for ${input.routeId} returned invalid status: ${status || 'missing'}`);
  }

  const issues = rawResult && typeof rawResult === 'object' && 'issues' in rawResult && Array.isArray((rawResult as { issues?: unknown }).issues)
    ? (rawResult as { issues: unknown[] }).issues.map((value) => String(value))
    : [];

  const externalJobId = rawResult && typeof rawResult === 'object' && 'externalJobId' in rawResult
    ? String((rawResult as { externalJobId?: unknown }).externalJobId ?? '') || input.externalJobId
    : input.externalJobId;

  return {
    status: status as 'cancelled' | 'unsupported',
    externalJobId,
    issues,
    rawResult,
  };
}
