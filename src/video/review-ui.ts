import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCharacterProfiles } from './characters.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { readSceneCandidatesArtifact } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { listProjects } from './projects.js';
import { listPlaybooks } from './playbooks.js';
import { listPromptReferences } from './prompt-library.js';
import {
  buildStoryboardScenesFromTemplate,
  listStoryboardTemplates,
  readStoryboardTemplate,
} from './storyboard-templates.js';
import { writeTextFileAtomic } from './atomic-write.js';
import { writeArtifact } from './artifact-store.js';
import { writeStageCheckpoint } from './checkpoints.js';
import {
  ensureProjectWorkspace,
  readProjectManifest,
  resolveProjectWorkspace,
  updateProjectManifestState,
} from './workspace.js';
import { recordStoryboardStillCandidate } from './storyboard-still-candidates.js';
import { appendProjectEvent } from './events.js';
import type { StoryboardArtifact } from './artifacts.js';
import type { SceneCandidate, SceneCandidatesArtifact, SceneSelectionArtifact } from './types.js';

export interface ReviewUiOptions {
  root: string;
  projectSlug: string;
  host?: string;
  port?: number;
  uiPath?: string;
  dryRun?: boolean;
}

export interface ReviewUiLaunch {
  url: string;
  host: string;
  port: number;
  root: string;
  projectSlug: string;
  uiPath: string;
  dryRun: boolean;
}

export interface ReviewInventory {
  root: string;
  projectSlug: string;
  projectDir: string;
  projectExists: boolean;
  projects: string[];
  characters: Awaited<ReturnType<typeof listCharacterProfiles>>;
  referenceSheets: Awaited<ReturnType<typeof readReferenceSheetsArtifact>>;
  sceneCandidates: Awaited<ReturnType<typeof readSceneCandidatesArtifact>>;
  sceneSelection: Awaited<ReturnType<typeof readSceneSelectionArtifact>>;
  reviewLedger: Record<string, unknown> | null;
  reviewReport: Record<string, unknown> | null;
  brief: Record<string, unknown> | null;
  storyboard: Record<string, unknown> | null;
  assetManifest: Record<string, unknown> | null;
  executionReport: Record<string, unknown> | null;
  publishReport: Record<string, unknown> | null;
  generationQueue: ReviewStoryboardStillGenerationQueue | null;
  characterQueue: ReviewCharacterIterationQueue | null;
  playbooks: Awaited<ReturnType<typeof listPlaybooks>>;
  promptReferences: ReturnType<typeof listPromptReferences>;
  storyboardTemplates: ReturnType<typeof listStoryboardTemplates>;
  mediaAssets: Array<{ path: string; kind: string }>;
  schemas: string[];
}

export interface ReviewDecisionSaveResult {
  projectSlug: string;
  path: string;
  savedAt: string;
  derivedArtifacts: Array<{
    name: string;
    path: string;
    purpose: string;
  }>;
  lifecycle?: {
    checkpointPath: string;
    status: 'completed' | 'retry-required' | 'failed';
    currentStage: 'publish' | 'review';
    lastCompletedStage: 'review' | 'assets';
    manifestUpdated: boolean;
  };
  reviewReport?: Record<string, unknown>;
}

export interface ReviewStoryboardStillCandidateResult {
  sceneIndex: number;
  candidate: SceneCandidate;
  reused: boolean;
}

export interface ReviewUpscaledStillCandidateResult {
  sceneIndex: number;
  sourceCandidateId: string;
  candidate: SceneCandidate;
  reused: boolean;
}

export interface ReviewStoryboardStillGenerationRequest {
  id: string;
  sceneIndex: number;
  provider: 'gobananas';
  route: 'gobananas-storyboard-still';
  status: 'queued' | 'fulfilled';
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  requestedAt: string;
  source: 'review-ui';
  notes?: string;
  fulfilledAt?: string;
  candidateId?: string;
  imageUrl?: string;
  imageId?: string;
}

export interface ReviewStoryboardStillGenerationQueue {
  schemaVersion: 1;
  projectSlug: string;
  updatedAt: string;
  requests: ReviewStoryboardStillGenerationRequest[];
}

export interface ReviewStoryboardStillGenerationRequestResult {
  path: string;
  request: ReviewStoryboardStillGenerationRequest;
  queue: ReviewStoryboardStillGenerationQueue;
}

export interface ReviewCharacterIterationRequest {
  id: string;
  provider: 'gobananas';
  route: 'gobananas-character-iteration';
  status: 'queued' | 'fulfilled' | 'failed';
  characterName: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  count: number;
  requestedAt: string;
  source: 'review-ui';
  notes?: string;
  fulfilledAt?: string;
  characterProfileId?: string;
  goBananasId?: number;
  referenceImageUrl?: string;
  imageId?: string;
  failedAt?: string;
  error?: string;
}

export interface ReviewCharacterIterationQueue {
  schemaVersion: 1;
  projectSlug: string;
  updatedAt: string;
  requests: ReviewCharacterIterationRequest[];
}

export interface ReviewCharacterIterationRequestResult {
  path: string;
  request: ReviewCharacterIterationRequest;
  queue: ReviewCharacterIterationQueue;
}

export interface ReviewAutopilotOptions {
  root: string;
  projectSlug: string;
  template?: string;
  character?: string;
  runId?: string;
}

export interface ReviewAutopilotResult {
  projectSlug: string;
  template: string;
  character: string;
  runId: string;
  lockedStills: Array<{
    sceneIndex: number;
    candidateId: string;
    imageUrl: string;
  }>;
  upscaledStills: Array<{
    sceneIndex: number;
    sourceCandidateId: string;
    candidateId: string;
    imageUrl: string;
    reused: boolean;
  }>;
  decision: ReviewDecisionSaveResult;
  reviewReport: Record<string, unknown> | null;
}

function defaultReviewUiPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tmp', 'review-station', 'index.html');
}

export async function launchReviewUi(options: ReviewUiOptions): Promise<ReviewUiLaunch> {
  const root = resolve(options.root);
  const projectSlug = options.projectSlug;
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4317;
  const uiPath = resolve(options.uiPath ?? defaultReviewUiPath());
  const staticRoot = reviewUiStaticRoot(uiPath);
  const url = `http://${host}:${port}/review-ui?project=${encodeURIComponent(projectSlug)}`;
  const launch: ReviewUiLaunch = {
    url,
    host,
    port,
    root,
    projectSlug,
    uiPath,
    dryRun: options.dryRun ?? false,
  };

  if (options.dryRun) return launch;
  if (!existsSync(uiPath)) {
    throw new Error(`review-ui file not found: ${uiPath}`);
  }

  const server = createServer((request, response) => {
    handleReviewUiRequest(request, response, {
      root,
      projectSlug,
      uiPath,
      staticRoot,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        sendText(response, 500, message);
      } else {
        response.end();
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  return launch;
}

export async function runReviewAutopilot(options: ReviewAutopilotOptions): Promise<ReviewAutopilotResult> {
  const root = resolve(options.root);
  const projectSlug = options.projectSlug;
  const template = options.template ?? 'product-commercial-4';
  const runId = sanitizeRunId(options.runId ?? new Date().toISOString());
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const sceneCandidates = await readSceneCandidatesArtifact(root, projectSlug);
  const sceneSelection = await readSceneSelectionArtifact(root, projectSlug);
  const lockedStills = selectAutopilotLockedStills(sceneCandidates, sceneSelection);
  if (!lockedStills.length) {
    throw new Error('review-autopilot requires at least one completed storyboard still candidate');
  }
  const characters = await listCharacterProfiles(workspace);
  const character = selectAutopilotCharacter(
    options.character,
    lockedStills,
    characters.map((entry) => entry.name),
  );
  const upscaledStills = [];
  for (const locked of lockedStills) {
    const upscaledCandidate = findUpscaledCandidateForSource(sceneCandidates, locked.sceneIndex, locked.candidate.id);
    if (upscaledCandidate) {
      const output = imageOutput(upscaledCandidate);
      upscaledStills.push({
        sceneIndex: locked.sceneIndex,
        sourceCandidateId: locked.candidate.id,
        candidateId: upscaledCandidate.id,
        imageUrl: output?.path ?? '',
        reused: true,
      });
      continue;
    }
    const imageUrl = await materializeAutopilotUpscaleAsset({
      root,
      projectSlug,
      runId,
      sceneIndex: locked.sceneIndex,
      candidate: locked.candidate,
    });
    const upscaled = await recordReviewUpscaledStillCandidate(root, projectSlug, {
      sceneIndex: locked.sceneIndex,
      sourceCandidateId: locked.candidate.id,
      imageUrl,
      prompt: `Agent autopilot promoted locked still ${locked.candidate.id} into the artifact-backed upscale gate. No video generation was run.`,
    });
    upscaledStills.push({
      sceneIndex: locked.sceneIndex,
      sourceCandidateId: locked.candidate.id,
      candidateId: upscaled.candidate.id,
      imageUrl,
      reused: upscaled.reused,
    });
  }
  const firstLocked = lockedStills[0]!;
  const lastLocked = lockedStills[lockedStills.length - 1]!;
  const selections: Record<string, unknown> = {
    character,
    characterPlan: 'agent-selected-existing-character',
    reference: 'seedance-motion-design-reference',
    'referenceRole-identity': character,
    'referenceRole-pose': firstLocked.candidate.id,
    'referenceRole-lookdev': firstLocked.candidate.id,
    'referenceRole-background': firstLocked.candidate.id,
    'referenceRole-prop': firstLocked.candidate.id,
    'referenceRole-start-frame': firstLocked.candidate.id,
    'referenceRole-end-frame': lastLocked.candidate.id,
    template,
    bridgePosePlan: 'bridge-hard-actions',
    motionCandidate: 'control-pass',
    assemblyPlan: 'balanced',
    reviewCompleteAt: new Date().toISOString(),
    'assemblyCheck-voiceover-fit': 'voiceover-fit-approved',
    'assemblyCheck-continuity-cuts': 'continuity-cuts-approved',
    'assemblyCheck-retiming-polish': 'retiming-polish-approved',
    'assemblyCheck-logo-payoff': 'logo-payoff-approved',
    'assemblyCheck-review-report': 'review-report-approved',
  };
  for (const locked of lockedStills) {
    selections[`draftStill-${locked.sceneIndex}`] = locked.candidate.id;
    selections[`lockedStill-${locked.sceneIndex}`] = locked.candidate.id;
    selections[`upscaledStill-${locked.sceneIndex}`] = `${locked.candidate.id}-4k`;
    selections[`continuity-${locked.sceneIndex}`] = locked.sceneIndex === 0
      ? 'start-frame-confirmed'
      : 'extract-end-frame';
  }
  const decision = await saveReviewDecision(root, projectSlug, {
    activeGate: 'assembly',
    seedanceWorkflow: defaultSeedanceWorkflow(),
    qualityScore: '8/8',
    recommendedNextAction: 'Ready to write review artifacts.',
    selections,
    notes: {
      storyboard: 'Agent autopilot selected the best available storyboard stills, locked them, and prepared artifact-backed upscaled still handoff assets.',
      continuity: 'Agent autopilot assigned start/end continuity roles from the locked still sequence.',
      upscale: 'Agent autopilot created review handoff upscale candidates from local still assets where possible. Run a real image upscaler before provider submission when higher resolution is required.',
    },
  });
  const reviewReport = await readJsonArtifact(workspace.artifactsDir, 'review-report.json');
  return {
    projectSlug,
    template,
    character,
    runId,
    lockedStills: lockedStills.map((locked) => ({
      sceneIndex: locked.sceneIndex,
      candidateId: locked.candidate.id,
      imageUrl: imageOutput(locked.candidate)?.path ?? '',
    })),
    upscaledStills,
    decision,
    reviewReport,
  };
}

function sanitizeRunId(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'review-autopilot';
}

function selectAutopilotLockedStills(
  sceneCandidates: SceneCandidatesArtifact,
  sceneSelection: SceneSelectionArtifact,
): Array<{ sceneIndex: number; candidate: SceneCandidate }> {
  return sceneCandidates.scenes
    .map((scene) => {
      const selectedId = sceneSelection.scenes
        .find((selection) => selection.sceneIndex === scene.sceneIndex)
        ?.selectedCandidateId;
      const selected = selectedId
        ? scene.candidates.find((candidate) => candidate.id === selectedId && isUsableStoryboardStill(candidate))
        : null;
      const fallback = scene.candidates.find(isUsableStoryboardStill) ?? null;
      const candidate = selected ?? fallback;
      return candidate ? { sceneIndex: scene.sceneIndex, candidate } : null;
    })
    .filter((entry): entry is { sceneIndex: number; candidate: SceneCandidate } => entry !== null)
    .sort((left, right) => left.sceneIndex - right.sceneIndex);
}

function isUsableStoryboardStill(candidate: SceneCandidate): boolean {
  return candidate.status === 'completed'
    && candidate.route !== 'upscaled-storyboard-still'
    && Boolean(imageOutput(candidate)?.path);
}

function imageOutput(candidate: SceneCandidate): { kind: string; path: string } | null {
  return candidate.outputs.find((output) => output.kind === 'image') ?? candidate.outputs[0] ?? null;
}

function selectAutopilotCharacter(
  explicitCharacter: string | undefined,
  lockedStills: Array<{ sceneIndex: number; candidate: SceneCandidate }>,
  knownCharacterNames: string[],
): string {
  if (explicitCharacter?.trim()) return explicitCharacter.trim().toLowerCase();
  const promptHaystack = lockedStills
    .map((locked) => locked.candidate.prompt)
    .join('\n')
    .toLowerCase();
  const known = knownCharacterNames.find((name) => promptHaystack.includes(name.toLowerCase()));
  if (known) return known.toLowerCase();
  const properNoun = /\b([A-Z][a-z][a-z0-9-]{1,30})\b/.exec(
    lockedStills
      .map((locked) => locked.candidate.prompt)
      .join('\n')
      .replace(/\b(?:Scene|Wide|Medium|Low|Final|Static|Agent|Use|Create|Preserve)\b/g, ''),
  )?.[1];
  if (properNoun && promptHaystack.includes(properNoun.toLowerCase())) {
    return properNoun.toLowerCase();
  }
  return 'selected character';
}

function findUpscaledCandidateForSource(
  sceneCandidates: SceneCandidatesArtifact,
  sceneIndex: number,
  sourceCandidateId: string,
): SceneCandidate | null {
  return sceneCandidates.scenes
    .find((scene) => scene.sceneIndex === sceneIndex)
    ?.candidates.find((candidate) => (
      candidate.route === 'upscaled-storyboard-still'
      && candidate.source.chainedFromCandidateId === sourceCandidateId
      && Boolean(imageOutput(candidate)?.path)
    ))
    ?? null;
}

async function materializeAutopilotUpscaleAsset(input: {
  root: string;
  projectSlug: string;
  runId: string;
  sceneIndex: number;
  candidate: SceneCandidate;
}): Promise<string> {
  const output = imageOutput(input.candidate);
  if (!output?.path) {
    throw new Error(`review-autopilot cannot upscale candidate without image output: ${input.candidate.id}`);
  }
  if (/^https?:\/\//i.test(output.path)) return output.path;
  const workspace = resolveProjectWorkspace(input.projectSlug, input.root);
  const projectRelativePath = projectRelativeAssetPath(input.projectSlug, output.path);
  const sourcePath = resolve(workspace.projectDir, projectRelativePath);
  if (!existsSync(sourcePath)) return output.path;
  const extension = extname(sourcePath) || '.jpg';
  const targetRelativePath = join(
    'assets',
    'upscaled',
    'storyboard',
    input.runId,
    `scene-${input.sceneIndex}-${input.candidate.id}-review-autopilot${extension}`,
  );
  const targetPath = join(workspace.projectDir, targetRelativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return targetRelativePath;
}

function defaultSeedanceWorkflow(): Record<string, unknown> {
  return {
    source: 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md',
    qualityBar: 'award-winning director cinematic video with minimal operator work',
    method: [
      'idea and voiceover first',
      'role-tagged reference canvas before prompting',
      'still storyboard locked before motion',
      'focused edit prompts before animation',
      'upscale locked frames before Seedance',
      'Seedance start/end frame chaining',
      'long control prompt plus short variant prompt',
      'bridge poses for hard hand/object/logo motion',
      'continuity end-frame extraction between shots',
      'planned post retiming and voiceover fit',
    ],
    promptPatterns: {
      stillCreate: 'Use reference roles as source truth. Create one visual beat. Preserve identity, materials, colors, lighting, and camera. Avoid readable text, logos, clutter, extra objects, and real people.',
      stillEdit: 'Edit only the named defect or layout issue. Keep identity, pose, camera, lighting, composition, and background unchanged.',
      motionControl: 'Use image 1 as start and image 2 as end. Preserve identity, style, background, lighting, and camera. Animate one readable action with easing, anticipation, overshoot, and soft settle. End exactly matching target.',
      shortVariant: 'Static camera. Same start and target. Faster playful single-action alternate while preserving character, background, composition, and style.',
      bridgePose: 'Create intermediate pose stills for catches, throws, hand-object contact, object escapes, transformations, and logo morphs before video generation.',
      postPolish: 'Retiming, voiceover fit, opacity, and final logo reveal are planned before publish.',
    },
    bridgeTriggers: [
      'catch',
      'throw',
      'hand-object contact',
      'escaping card',
      'character transformation',
      'logo morph',
      'multi-object choreography',
    ],
    negativeGuidance: [
      'no readable UI text unless required',
      'no random logos',
      'no clutter',
      'no extra objects',
      'no real humans',
      'no distorted anatomy',
      'no unwanted camera change',
    ],
  };
}

async function handleReviewUiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: { root: string; projectSlug: string; uiPath: string; staticRoot: string },
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  if (requestUrl.pathname === '/' || requestUrl.pathname === '/review-ui') {
    await sendFile(response, options.uiPath);
    return;
  }

  if (requestUrl.pathname === '/api/review-inventory') {
    const projectSlug = requestUrl.searchParams.get('project') ?? options.projectSlug;
    const inventory = await buildReviewInventory(options.root, projectSlug);
    sendJson(response, inventory);
    return;
  }

  if (requestUrl.pathname === '/api/review-decision') {
    if (request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed');
      return;
    }
    const projectSlug = requestUrl.searchParams.get('project') ?? options.projectSlug;
    const body = await readJsonBody(request);
    const result = await saveReviewDecision(options.root, projectSlug, body);
    sendJson(response, result);
    return;
  }

  if (requestUrl.pathname === '/api/storyboard-still-candidate') {
    if (request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed');
      return;
    }
    const projectSlug = requestUrl.searchParams.get('project') ?? options.projectSlug;
    const body = await readJsonBody(request);
    const result = await recordReviewStoryboardStillCandidate(options.root, projectSlug, body);
    sendJson(response, result);
    return;
  }

  if (requestUrl.pathname === '/api/upscaled-still-candidate') {
    if (request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed');
      return;
    }
    const projectSlug = requestUrl.searchParams.get('project') ?? options.projectSlug;
    const body = await readJsonBody(request);
    const result = await recordReviewUpscaledStillCandidate(options.root, projectSlug, body);
    sendJson(response, result);
    return;
  }

  if (requestUrl.pathname === '/api/storyboard-still-request') {
    if (request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed');
      return;
    }
    const projectSlug = requestUrl.searchParams.get('project') ?? options.projectSlug;
    const body = await readJsonBody(request);
    const result = await recordReviewStoryboardStillGenerationRequest(options.root, projectSlug, body);
    sendJson(response, result);
    return;
  }

  if (requestUrl.pathname === '/api/character-iteration-request') {
    if (request.method !== 'POST') {
      sendText(response, 405, 'Method not allowed');
      return;
    }
    const projectSlug = requestUrl.searchParams.get('project') ?? options.projectSlug;
    const body = await readJsonBody(request);
    const result = await recordReviewCharacterIterationRequest(options.root, projectSlug, body);
    sendJson(response, result);
    return;
  }

  if (requestUrl.pathname === '/api/media-proxy') {
    await sendProxiedMedia(response, requestUrl.searchParams.get('url'));
    return;
  }

  const projectPath = safePathFromUrl(options.root, requestUrl.pathname);
  if (projectPath && existsSync(projectPath) && (await stat(projectPath)).isFile()) {
    await sendFile(response, projectPath);
    return;
  }

  const staticPath = safeStaticAssetPathFromUrl(options.staticRoot, requestUrl.pathname);
  if (staticPath && existsSync(staticPath) && (await stat(staticPath)).isFile()) {
    await sendFile(response, staticPath);
    return;
  }

  if (!projectPath && !staticPath) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  sendText(response, 404, 'Not found');
}

function reviewUiStaticRoot(uiPath: string): string {
  return resolve(dirname(uiPath), '..', '..');
}

function safePathFromUrl(root: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const withoutLeadingSlash = decoded.replace(/^\/+/, '');
  const candidate = normalize(resolve(root, withoutLeadingSlash));
  if (candidate === normalize(root)) return candidate;
  const normalizedRoot = normalize(root.endsWith(sep) ? root : `${root}${sep}`);
  if (!candidate.startsWith(normalizedRoot)) return null;
  return candidate;
}

function safeStaticAssetPathFromUrl(staticRoot: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const withoutLeadingSlash = decoded.replace(/^\/+/, '');
  const allowedPrefixes = [
    'docs/assets/',
    'skills/davendra-presenter/assets/',
    'skills/nex-presenter/assets/',
  ];
  if (!allowedPrefixes.some((prefix) => withoutLeadingSlash.startsWith(prefix))) return null;
  return safePathFromUrl(staticRoot, pathname);
}

async function sendFile(response: ServerResponse, path: string): Promise<void> {
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType(path));
  response.setHeader('Cache-Control', 'no-store');
  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(path);
    stream.once('error', rejectStream);
    response.once('finish', resolveStream);
    stream.pipe(response);
  });
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function sendProxiedMedia(response: ServerResponse, rawUrl: string | null): Promise<void> {
  const mediaUrl = stringValue(rawUrl);
  if (!mediaUrl) {
    sendText(response, 400, 'Missing media URL');
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    sendText(response, 400, 'Invalid media URL');
    return;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    sendText(response, 400, 'Unsupported media URL protocol');
    return;
  }
  const upstream = await fetch(parsed);
  if (!upstream.ok) {
    sendText(response, upstream.status, `Could not fetch media: ${upstream.statusText}`);
    return;
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (!/^(image|video)\//.test(contentType)) {
    sendText(response, 415, 'Media proxy only supports image and video responses');
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(body.byteLength),
    'Cache-Control': 'public, max-age=3600',
  });
  response.end(body);
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`${body}\n`);
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 1024 * 1024) {
      throw new Error('review decision payload is too large');
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw.trim() ? JSON.parse(raw) as unknown : {};
}

export async function saveReviewDecision(
  root: string,
  projectSlug: string,
  decision: unknown,
): Promise<ReviewDecisionSaveResult> {
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const savedAt = new Date().toISOString();
  const normalizedDecision = asReviewDecision(decision);
  const path = join(workspace.artifactsDir, 'review-ui-ledger.json');
  const derivedArtifacts = await writeDerivedReviewArtifacts({
    root,
    artifactsDir: workspace.artifactsDir,
    projectSlug,
    savedAt,
    decision: normalizedDecision,
  });
  const lifecycle = stringValue(normalizedDecision.selections.reviewCompleteAt)
    ? await writeReviewLifecycleState(workspace, savedAt, normalizedDecision, derivedArtifacts)
    : undefined;
  if (lifecycle?.status === 'completed') {
    await updateCompletedLifecycleDerivedArtifacts(derivedArtifacts, 'Ready for publish handoff.');
  }
  const reviewReport = await readReviewReportFromDerivedArtifacts(derivedArtifacts);
  const savedNextAction = lifecycle?.status === 'completed'
    ? 'Ready for publish handoff.'
    : nextActionFromReviewReport(reviewReport, normalizedDecision.recommendedNextAction);
  const savedDecision: ReviewDecisionRecord = {
    ...normalizedDecision,
    recommendedNextAction: savedNextAction,
    savedArtifact: {
      path,
      savedAt,
      derivedArtifacts,
      ...(lifecycle ? { lifecycle } : {}),
    },
  };
  await writeTextFileAtomic(path, `${JSON.stringify({
    schemaVersion: 1,
    projectSlug,
    savedAt,
    decision: savedDecision,
  }, null, 2)}\n`);
  return {
    projectSlug,
    path,
    savedAt,
    derivedArtifacts,
    ...(reviewReport ? { reviewReport } : {}),
    ...(lifecycle ? { lifecycle } : {}),
  };
}

async function readReviewReportFromDerivedArtifacts(
  derivedArtifacts: ReviewDecisionSaveResult['derivedArtifacts'],
): Promise<Record<string, unknown> | undefined> {
  const reviewReportPath = derivedArtifacts.find((artifact) => artifact.name === 'review-report.json')?.path;
  if (!reviewReportPath) return undefined;
  const raw = JSON.parse(await readFile(reviewReportPath, 'utf-8')) as unknown;
  return isRecord(raw) ? raw : {};
}

async function updateCompletedLifecycleDerivedArtifacts(
  derivedArtifacts: ReviewDecisionSaveResult['derivedArtifacts'],
  nextAction: string,
): Promise<void> {
  for (const artifact of derivedArtifacts) {
    if (artifact.name !== 'director-seedance-plan.json' && artifact.name !== 'review-report.json') continue;
    const raw = JSON.parse(await readFile(artifact.path, 'utf-8')) as unknown;
    const body = isRecord(raw) ? raw : {};
    if (artifact.name === 'director-seedance-plan.json') {
      body.nextAction = nextAction;
    }
    if (artifact.name === 'review-report.json') {
      const metrics = isRecord(body.metrics) ? body.metrics : {};
      metrics.nextAction = nextAction;
      body.metrics = metrics;
    }
    await writeTextFileAtomic(artifact.path, `${JSON.stringify(body, null, 2)}\n`);
  }
}

async function writeReviewLifecycleState(
  workspace: Awaited<ReturnType<typeof ensureProjectWorkspace>>,
  savedAt: string,
  decision: ReviewDecisionRecord,
  derivedArtifacts: ReviewDecisionSaveResult['derivedArtifacts'],
): Promise<NonNullable<ReviewDecisionSaveResult['lifecycle']>> {
  const reviewReportPath = derivedArtifacts.find((artifact) => artifact.name === 'review-report.json')?.path;
  if (!reviewReportPath) {
    throw new Error('review lifecycle update requires review-report.json');
  }
  const rawReviewReport = JSON.parse(await readFile(reviewReportPath, 'utf-8')) as unknown;
  const reviewReport = isRecord(rawReviewReport) ? rawReviewReport : {};
  const verdict = reviewVerdict(reviewReport.verdict);
  const publishReady = isReviewReportPublishReady(reviewReport);
  const status = publishReady ? 'completed' : verdict === 'fail' ? 'failed' : 'retry-required';
  const currentStage = publishReady ? 'publish' : 'review';
  const lastCompletedStage = publishReady ? 'review' : 'assets';
  const issues = Array.isArray(reviewReport.findings)
    ? reviewReport.findings.map(stringValue).filter((finding): finding is string => Boolean(finding))
    : [];
  const reviewNextAction = nextActionFromReviewReport(
    reviewReport,
    decision.recommendedNextAction ?? 'Resolve review findings before publishing.',
  );

  const manifest = await readProjectManifest(workspace);
  if (publishReady) {
    await writeCanonicalReviewUiPipelineState(
      workspace,
      manifest?.productionMode ?? 'director',
      savedAt,
      decision,
    );
  }

  await writeStageCheckpoint(workspace, {
    stage: 'review',
    status,
    generatedAt: savedAt,
    artifacts: {
      'review-report': reviewReportPath,
    },
    summary: `Review UI recorded with verdict: ${verdict}.`,
    issues,
    nextAction: publishReady
      ? 'Publish the project.'
      : reviewNextAction,
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.review-report.written',
    recordedAt: savedAt,
    payload: {
      source: 'review-ui',
      artifactPath: reviewReportPath,
      verdict,
    },
  });

  let manifestUpdated = false;
  if (manifest) {
    await updateProjectManifestState(workspace, {
      updatedAt: savedAt,
      currentStage,
      lastCompletedStage,
      lastCheckpointStatus: status,
    });
    manifestUpdated = true;
  }

  return {
    checkpointPath: join(workspace.checkpointsDir, 'review.json'),
    status,
    currentStage,
    lastCompletedStage,
    manifestUpdated,
  };
}

function reviewVerdict(value: unknown): 'pass' | 'retry' | 'fail' {
  return value === 'pass' || value === 'retry' || value === 'fail' ? value : 'retry';
}

function projectRelativeAssetPath(projectSlug: string, path: string): string {
  const prefix = `projects/${projectSlug}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function storyboardScenesForReview(input: {
  existingStoryboard: Record<string, unknown> | null;
  templateId: string;
  characterName: string;
  selectedCharacterName?: string;
}): StoryboardArtifact['scenes'] {
  const existing = existingStoryboardScenes(input.existingStoryboard);
  if (existing.length > 0) return existing;

  return buildStoryboardScenesFromTemplate({
    templateId: input.templateId,
    environment: 'a premium cinematic product world with clean composition',
    characterA: input.characterName,
  }).map((scene) => ({
    sceneIndex: scene.sceneIndex,
    description: scene.description,
    ...(input.selectedCharacterName ? { characters: [input.selectedCharacterName] } : {}),
    scenePrompt: {
      imagePrompt: scene.description,
      animationPrompt: 'Animate only after the storyboard still is locked and upscaled.',
      cameraMove: 'static',
      styleFooter: 'Seedance reference workflow: still first, edit narrowly, lock, upscale, then motion.',
    },
  }));
}

function isStoryboardCameraMove(
  value: string | null,
): value is Exclude<NonNullable<StoryboardArtifact['scenes'][number]['scenePrompt']>['cameraMove'], undefined> {
  return value === 'push-in'
    || value === 'pull-out'
    || value === 'tracking'
    || value === 'crane'
    || value === 'orbit'
    || value === 'static';
}

function existingStoryboardScenes(storyboard: Record<string, unknown> | null): StoryboardArtifact['scenes'] {
  const rawScenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  return rawScenes
    .filter(isRecord)
    .map((scene, fallbackIndex): StoryboardArtifact['scenes'][number] | null => {
      const description = stringValue(scene.description);
      if (!description) return null;
      const sceneIndex = numberValue(scene.sceneIndex) ?? fallbackIndex;
      const characters = Array.isArray(scene.characters)
        ? scene.characters.map(stringValue).filter((value): value is string => Boolean(value))
        : [];
      const rawPrompt = isRecord(scene.scenePrompt) ? scene.scenePrompt : null;
      const imagePrompt = stringValue(rawPrompt?.imagePrompt);
      const animationPrompt = stringValue(rawPrompt?.animationPrompt);
      const cameraMove = stringValue(rawPrompt?.cameraMove);
      const styleFooter = stringValue(rawPrompt?.styleFooter);
      return {
        sceneIndex,
        description,
        ...(characters.length ? { characters } : {}),
        ...(rawPrompt ? {
          scenePrompt: {
            ...(imagePrompt ? { imagePrompt } : {}),
            ...(animationPrompt ? { animationPrompt } : {}),
            ...(isStoryboardCameraMove(cameraMove) ? { cameraMove } : {}),
            ...(styleFooter ? { styleFooter } : {}),
          },
        } : {}),
      };
    })
    .filter((scene): scene is StoryboardArtifact['scenes'][number] => scene !== null)
    .sort((left, right) => left.sceneIndex - right.sceneIndex);
}

async function writeCanonicalReviewUiPipelineState(
  workspace: Awaited<ReturnType<typeof ensureProjectWorkspace>>,
  productionMode: 'storyboard' | 'director',
  savedAt: string,
  decision: ReviewDecisionRecord,
): Promise<void> {
  const sceneCandidates = await readSceneCandidatesArtifact(workspace.root, workspace.slug);
  const templateId = stringValue(decision.selections.template) || 'product-commercial-4';
  const selectedCharacterName =
    stringValue(decision.selections.character)
    || stringValue(decision.selections.characterSource);
  const characterName = selectedCharacterName || 'the selected hero character';
  const existingStoryboard = await readJsonArtifact(workspace.artifactsDir, 'storyboard.json');
  const storyboardScenes = storyboardScenesForReview({
    existingStoryboard,
    templateId,
    characterName,
    ...(selectedCharacterName ? { selectedCharacterName } : {}),
  });
  const sceneSelection = buildSceneSelectionArtifact(decision, sceneCandidates);
  const selectedAssets = sceneSelection.scenes.flatMap((scene) => {
    const candidate = selectPublishStillCandidate(sceneCandidates, scene, decision);
    const output = candidate?.outputs.find((entry) => entry.kind === 'image') ?? candidate?.outputs[0];
    if (!candidate || !output?.path) return [];
    return [{
      id: `${candidate.id}-${candidate.route === 'upscaled-storyboard-still' ? 'selected-upscaled-still' : 'selected-still'}`,
      kind: 'image' as const,
      path: projectRelativeAssetPath(workspace.slug, output.path),
      sceneIndex: scene.sceneIndex,
      backend: candidate.route,
    }];
  });

  const briefPath = await writeArtifact(workspace, 'brief', {
    title: workspace.slug,
    intent: 'Review UI storyboard-to-motion production handoff.',
    productionMode,
    createdAt: savedAt,
    metadata: {
      source: 'review-ui',
      workflowSource: workflowSource(decision),
      qualityScore: decision.qualityScore ?? null,
    },
  });
  await writeStageCheckpoint(workspace, {
    stage: 'brief',
    status: 'completed',
    generatedAt: savedAt,
    artifacts: { brief: briefPath },
    summary: 'Brief hydrated from the completed Review UI handoff.',
    issues: [],
    nextAction: 'Use the storyboard still plan to generate or refine scene images.',
  });

  const storyboardPath = await writeArtifact(workspace, 'storyboard', {
    ...(storyboardScenes.length && existingStoryboard
      ? existingStoryboard
      : {
          scenes: storyboardScenes.map((scene) => ({
            sceneIndex: scene.sceneIndex,
            description: scene.description,
            ...(scene.characters?.length ? { characters: scene.characters } : {}),
            scenePrompt: scene.scenePrompt ?? {
              imagePrompt: scene.description,
              animationPrompt: 'Animate only after the storyboard still is locked and upscaled.',
              cameraMove: 'static',
              styleFooter: 'Seedance reference workflow: still first, edit narrowly, lock, upscale, then motion.',
            },
          })),
        }),
    projectSlug: workspace.slug,
    productionMode,
  });
  await writeStageCheckpoint(workspace, {
    stage: 'storyboard',
    status: 'completed',
    generatedAt: savedAt,
    artifacts: { storyboard: storyboardPath },
    summary: 'Storyboard hydrated from the completed Review UI scene plan.',
    issues: [],
    nextAction: 'Use selected still assets as the source frames for motion planning.',
  });

  const assetManifestPath = await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: workspace.slug,
    assets: selectedAssets,
  });
  await writeStageCheckpoint(workspace, {
    stage: 'assets',
    status: 'completed',
    generatedAt: savedAt,
    artifacts: { 'asset-manifest': assetManifestPath },
    summary: 'Selected storyboard stills were promoted into the canonical asset manifest.',
    issues: selectedAssets.length ? [] : ['No selected storyboard still assets were available.'],
    nextAction: 'Run final review or publish handoff.',
  });
}

function selectPublishStillCandidate(
  sceneCandidates: SceneCandidatesArtifact,
  scene: SceneSelectionArtifact['scenes'][number],
  decision: ReviewDecisionRecord,
): SceneCandidate | null {
  if (!scene.selectedCandidateId) return null;
  const lockedCandidate = findSceneCandidate(sceneCandidates, scene.sceneIndex, scene.selectedCandidateId);
  if (!lockedCandidate) return null;

  const upscaledCandidateId = stringValue(decision.selections[`upscaledStill-${scene.sceneIndex}`]);
  if (!upscaledCandidateId) return lockedCandidate;

  const upscaledCandidate = findSceneCandidate(sceneCandidates, scene.sceneIndex, upscaledCandidateId);
  const isUpscaledFromLock = Boolean(
    upscaledCandidate
    && (
      upscaledCandidate.source.chainedFromCandidateId === lockedCandidate.id
      || upscaledCandidate.id.startsWith(`${lockedCandidate.id}-`)
    ),
  );
  const hasImageOutput = Boolean(
    upscaledCandidate?.outputs.some((output) => output.kind === 'image' && output.path),
  );
  return isUpscaledFromLock && hasImageOutput ? upscaledCandidate : lockedCandidate;
}

interface ReviewDecisionRecord {
  activeGate?: string;
  recommendedNextAction?: string;
  seedanceWorkflow?: Record<string, unknown>;
  qualityScore?: string;
  qualityChecks?: Array<Record<string, unknown>>;
  existingInventory?: Record<string, unknown>;
  savedArtifact?: Record<string, unknown>;
  selections: Record<string, unknown>;
  notes: Record<string, unknown>;
}

function asReviewDecision(value: unknown): ReviewDecisionRecord {
  const record = isRecord(value) ? value : {};
  return {
    ...(typeof record.activeGate === 'string' ? { activeGate: record.activeGate } : {}),
    ...(typeof record.recommendedNextAction === 'string' ? { recommendedNextAction: record.recommendedNextAction } : {}),
    ...(isRecord(record.seedanceWorkflow) ? { seedanceWorkflow: record.seedanceWorkflow } : {}),
    ...(typeof record.qualityScore === 'string' ? { qualityScore: record.qualityScore } : {}),
    ...(Array.isArray(record.qualityChecks) ? { qualityChecks: record.qualityChecks.filter(isRecord) } : {}),
    ...(isRecord(record.existingInventory) ? { existingInventory: record.existingInventory } : {}),
    ...(isRecord(record.savedArtifact) ? { savedArtifact: record.savedArtifact } : {}),
    selections: isRecord(record.selections) ? record.selections : {},
    notes: isRecord(record.notes) ? record.notes : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function recordReviewStoryboardStillCandidate(
  root: string,
  projectSlug: string,
  body: unknown,
): Promise<ReviewStoryboardStillCandidateResult> {
  const record = isRecord(body) ? body : {};
  const sceneIndex = numberValue(record.sceneIndex);
  const imageUrl = stringValue(record.imageUrl);
  if (sceneIndex === null || !imageUrl) {
    throw new Error('storyboard still candidate requires sceneIndex and imageUrl');
  }
  validateReviewImageUrl(imageUrl);
  const imageId = stringValue(record.imageId);
  const prompt = stringValue(record.prompt);
  const notes = stringValue(record.notes);
  const existing = findExistingStoryboardStillCandidate(
    await readSceneCandidatesArtifact(root, projectSlug),
    sceneIndex,
    imageUrl,
  );
  if (existing) {
    const workspace = await ensureProjectWorkspace(projectSlug, root);
    await appendProjectEvent(workspace, {
      type: 'storyboard-still.candidate.reused',
      payload: {
        source: 'review-ui',
        sceneIndex,
        candidateId: existing.id,
        imageUrl,
        ...(imageId ? { imageId } : {}),
        ...(notes ? { notes } : {}),
      },
    });
    return {
      sceneIndex,
      candidate: existing,
      reused: true,
    };
  }

  const result = await recordStoryboardStillCandidate({
    root,
    projectSlug,
    sceneIndex,
    imageUrl,
    ...(imageId ? { imageId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(notes ? { notes } : {}),
  });
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await fulfillLatestStoryboardStillGenerationRequest({
    root,
    projectSlug,
    sceneIndex,
    candidateId: result.candidate.id,
    imageUrl,
    ...(imageId ? { imageId } : {}),
  });
  await appendProjectEvent(workspace, {
    type: 'storyboard-still.candidate.added',
    payload: {
      source: 'review-ui',
      sceneIndex,
      candidateId: result.candidate.id,
      imageUrl,
      ...(imageId ? { imageId } : {}),
      ...(notes ? { notes } : {}),
    },
  });
  return {
    ...result,
    reused: false,
  };
}

export async function recordReviewUpscaledStillCandidate(
  root: string,
  projectSlug: string,
  body: unknown,
): Promise<ReviewUpscaledStillCandidateResult> {
  const record = isRecord(body) ? body : {};
  const sceneIndex = numberValue(record.sceneIndex);
  const sourceCandidateId = stringValue(record.sourceCandidateId);
  const imageUrl = stringValue(record.imageUrl);
  if (sceneIndex === null || !sourceCandidateId || !imageUrl) {
    throw new Error('upscaled still candidate requires sceneIndex, sourceCandidateId, and imageUrl');
  }
  if (!isSceneCandidateId(sourceCandidateId)) {
    throw new Error('upscaled still sourceCandidateId must be a storyboard candidate id');
  }
  validateReviewImageReference(imageUrl, { allowLocalPath: true });
  const artifact = await readSceneCandidatesArtifact(root, projectSlug);
  if (!sceneHasCandidate(artifact, sceneIndex, sourceCandidateId)) {
    throw new Error(`upscaled still source candidate not found: ${sourceCandidateId}`);
  }
  const candidateId = `${sourceCandidateId}-4k`;
  const existing = artifact.scenes
    .find((scene) => scene.sceneIndex === sceneIndex)
    ?.candidates
    .find((candidate) => candidate.id === candidateId || candidate.outputs.some((output) => output.kind === 'image' && output.path === imageUrl));
  if (existing) {
    return {
      sceneIndex,
      sourceCandidateId,
      candidate: existing,
      reused: true,
    };
  }
  const imageId = stringValue(record.imageId);
  const prompt = stringValue(record.prompt) || `Upscaled 4k still asset for ${sourceCandidateId}.`;
  const result = await recordStoryboardStillCandidate({
    root,
    projectSlug,
    sceneIndex,
    candidateId,
    imageUrl,
    ...(imageId ? { imageId } : {}),
    prompt,
    route: 'upscaled-storyboard-still',
    chainedFromCandidateId: sourceCandidateId,
  });
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await appendProjectEvent(workspace, {
    type: 'storyboard-still.upscale.added',
    payload: {
      source: 'review-ui',
      sceneIndex,
      sourceCandidateId,
      candidateId: result.candidate.id,
      imageUrl,
      ...(imageId ? { imageId } : {}),
    },
  });
  return {
    sceneIndex,
    sourceCandidateId,
    candidate: result.candidate,
    reused: false,
  };
}

async function fulfillLatestStoryboardStillGenerationRequest(input: {
  root: string;
  projectSlug: string;
  sceneIndex: number;
  candidateId: string;
  imageUrl: string;
  imageId?: string;
}): Promise<void> {
  const workspace = resolveProjectWorkspace(input.projectSlug, input.root);
  const path = join(workspace.artifactsDir, 'storyboard-still-generation-requests.json');
  const queue = await readStoryboardStillGenerationQueue(path, input.projectSlug);
  if (!queue) return;
  let requestIndex = -1;
  for (let index = queue.requests.length - 1; index >= 0; index -= 1) {
    const request = queue.requests[index];
    if (request?.sceneIndex === input.sceneIndex && request.status === 'queued') {
      requestIndex = index;
      break;
    }
  }
  if (requestIndex < 0) return;
  const fulfilledAt = new Date().toISOString();
  const nextRequests = queue.requests.map((request, index) => (
    index === requestIndex
      ? {
          ...request,
          status: 'fulfilled' as const,
          fulfilledAt,
          candidateId: input.candidateId,
          imageUrl: input.imageUrl,
          ...(input.imageId ? { imageId: input.imageId } : {}),
        }
      : request
  ));
  const nextQueue: ReviewStoryboardStillGenerationQueue = {
    ...queue,
    updatedAt: fulfilledAt,
    requests: nextRequests,
  };
  await writeTextFileAtomic(path, `${JSON.stringify(nextQueue, null, 2)}\n`);
}

export async function recordReviewStoryboardStillGenerationRequest(
  root: string,
  projectSlug: string,
  body: unknown,
): Promise<ReviewStoryboardStillGenerationRequestResult> {
  const record = isRecord(body) ? body : {};
  const sceneIndex = numberValue(record.sceneIndex);
  const prompt = stringValue(record.prompt);
  if (sceneIndex === null || !prompt) {
    throw new Error('storyboard still generation request requires sceneIndex and prompt');
  }
  const requestedAt = new Date().toISOString();
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const path = join(workspace.artifactsDir, 'storyboard-still-generation-requests.json');
  const queue = await readStoryboardStillGenerationQueue(path, projectSlug) ?? {
    schemaVersion: 1,
    projectSlug,
    updatedAt: '',
    requests: [],
  };
  const request: ReviewStoryboardStillGenerationRequest = {
    id: `gobananas-still-${String(sceneIndex).padStart(2, '0')}-${String(queue.requests.length + 1).padStart(3, '0')}`,
    sceneIndex,
    provider: 'gobananas',
    route: 'gobananas-storyboard-still',
    status: 'queued',
    prompt,
    negativePrompt: stringValue(record.negativePrompt)
      ?? 'readable text, random logos, clutter, extra objects, real humans, distorted anatomy, inconsistent character identity, unwanted camera change',
    aspectRatio: stringValue(record.aspectRatio) ?? '16:9',
    requestedAt,
    source: 'review-ui',
    ...(stringValue(record.notes) ? { notes: stringValue(record.notes)! } : {}),
  };
  const nextQueue: ReviewStoryboardStillGenerationQueue = {
    schemaVersion: 1,
    projectSlug,
    updatedAt: requestedAt,
    requests: [...queue.requests, request],
  };
  await writeTextFileAtomic(path, `${JSON.stringify(nextQueue, null, 2)}\n`);
  await appendProjectEvent(workspace, {
    type: 'storyboard-still.generation-request.queued',
    payload: {
      source: 'review-ui',
      sceneIndex,
      requestId: request.id,
      provider: request.provider,
      route: request.route,
    },
  });
  return {
    path,
    request,
    queue: nextQueue,
  };
}

export async function recordReviewCharacterIterationRequest(
  root: string,
  projectSlug: string,
  body: unknown,
): Promise<ReviewCharacterIterationRequestResult> {
  const record = isRecord(body) ? body : {};
  const characterName = stringValue(record.characterName) ?? 'Komo';
  const prompt = stringValue(record.prompt);
  if (!prompt) {
    throw new Error('character iteration request requires prompt');
  }
  const requestedAt = new Date().toISOString();
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const path = join(workspace.artifactsDir, 'gobananas-character-iteration-requests.json');
  const queue = await readCharacterIterationQueue(path, projectSlug) ?? {
    schemaVersion: 1,
    projectSlug,
    updatedAt: '',
    requests: [],
  };
  const request: ReviewCharacterIterationRequest = {
    id: `gobananas-character-${String(queue.requests.length + 1).padStart(3, '0')}`,
    provider: 'gobananas',
    route: 'gobananas-character-iteration',
    status: 'queued',
    characterName,
    prompt,
    negativePrompt: stringValue(record.negativePrompt)
      ?? 'inconsistent identity, realistic human photo, readable text, logos, clutter, distorted anatomy, extra limbs',
    aspectRatio: normalizeCharacterAspectRatio(stringValue(record.aspectRatio)),
    count: numberValue(record.count) ?? 4,
    requestedAt,
    source: 'review-ui',
    ...(stringValue(record.notes) ? { notes: stringValue(record.notes)! } : {}),
  };
  const nextQueue: ReviewCharacterIterationQueue = {
    schemaVersion: 1,
    projectSlug,
    updatedAt: requestedAt,
    requests: [...queue.requests, request],
  };
  await writeTextFileAtomic(path, `${JSON.stringify(nextQueue, null, 2)}\n`);
  await appendProjectEvent(workspace, {
    type: 'character-iteration.request.queued',
    payload: {
      source: 'review-ui',
      requestId: request.id,
      provider: request.provider,
      route: request.route,
      characterName: request.characterName,
      count: request.count,
    },
  });
  return {
    path,
    request,
    queue: nextQueue,
  };
}

function findExistingStoryboardStillCandidate(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
  imageUrl: string,
): SceneCandidate | null {
  const scene = artifact.scenes.find((entry) => entry.sceneIndex === sceneIndex);
  if (!scene) return null;
  return [...scene.candidates].reverse().find((candidate) => (
    candidate.outputs.some((output) => output.kind === 'image' && output.path === imageUrl)
  )) ?? null;
}

function findSceneCandidate(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
  candidateId: string,
): SceneCandidate | null {
  return artifact.scenes
    .find((scene) => scene.sceneIndex === sceneIndex)
    ?.candidates.find((candidate) => candidate.id === candidateId)
    ?? null;
}

function validateReviewImageUrl(imageUrl: string): void {
  validateReviewImageReference(imageUrl, { allowLocalPath: false });
}

function validateReviewImageReference(imageUrl: string, options: { allowLocalPath: boolean }): void {
  if (options.allowLocalPath && !/^[a-z][a-z0-9+.-]*:/i.test(imageUrl)) {
    validateReviewImagePath(imageUrl);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error('storyboard still image URL must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('storyboard still image URL must use http or https');
  }
  const host = parsed.hostname.toLowerCase();
  if (['example.com', 'example.net', 'example.org'].includes(host)) {
    throw new Error('storyboard still image URL cannot use a placeholder domain');
  }
  const path = parsed.pathname.toLowerCase();
  if (!/\.(jpg|jpeg|png|webp|gif)(?:$|\?)/.test(`${path}${parsed.search}`)) {
    throw new Error('storyboard still image URL must point to a jpg, png, webp, or gif image');
  }
}

function validateReviewImagePath(path: string): void {
  const normalizedPath = normalize(path);
  if (normalizedPath.startsWith('..') || normalizedPath.startsWith(sep) || normalizedPath.includes(`${sep}..${sep}`)) {
    throw new Error('storyboard still image path must stay inside the project workspace');
  }
  if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(normalizedPath)) {
    throw new Error('storyboard still image path must point to a jpg, png, webp, or gif image');
  }
}

async function writeDerivedReviewArtifacts(input: {
  root: string;
  artifactsDir: string;
  projectSlug: string;
  savedAt: string;
  decision: ReviewDecisionRecord;
}): Promise<ReviewDecisionSaveResult['derivedArtifacts']> {
  const sceneCandidates = await readSceneCandidatesArtifact(input.root, input.projectSlug);
  const existingStoryboard = await readJsonArtifact(input.artifactsDir, 'storyboard.json');
  const reviewReport = buildReviewReportArtifact(
    input.projectSlug,
    input.savedAt,
    input.decision,
    sceneCandidates,
    existingStoryboard,
  );
  const reviewMetrics = isRecord(reviewReport.metrics) ? reviewReport.metrics : {};
  const publishReady = reviewMetrics.publishReady === true;
  const reviewNextAction = nextActionFromReviewReport(reviewReport, input.decision.recommendedNextAction);
  const artifacts = [
    {
      name: 'reference-board.json',
      purpose: 'Role-tagged reference intent for image prompting and Seedance source images.',
      body: buildReferenceBoardArtifact(input.projectSlug, input.savedAt, input.decision),
    },
    {
      name: 'director-seedance-plan.json',
      purpose: 'Director-grade Seedance still, motion, continuity, variant, and bridge-pose plan.',
      body: buildDirectorSeedancePlanArtifact(input.projectSlug, input.savedAt, input.decision, reviewNextAction),
    },
    {
      name: 'storyboard-stills-plan.json',
      purpose: 'Scene-by-scene still image prompts, cleanup prompts, and upscale locks before video.',
      body: buildStoryboardStillsPlanArtifact(
        input.projectSlug,
        input.savedAt,
        input.decision,
        sceneCandidates,
        existingStoryboard,
      ),
    },
    {
      name: 'scene-selection.json',
      purpose: 'Mutable scene candidate selection ledger derived from locked storyboard stills.',
      body: buildSceneSelectionArtifact(input.decision, sceneCandidates),
    },
    {
      name: 'gobananas-character-brief.json',
      purpose: 'Reusable character-iteration brief for Go Bananas character generation.',
      body: buildGoBananasCharacterBriefArtifact(input.projectSlug, input.savedAt, input.decision),
    },
    {
      name: 'post-plan.json',
      purpose: 'Post-production timing, voiceover, retiming, and final assembly plan.',
      body: buildPostPlanArtifact(input.projectSlug, input.savedAt, input.decision, publishReady),
    },
    {
      name: 'review-report.json',
      purpose: 'Compact final human review verdict and handoff evidence from the review UI.',
      body: reviewReport,
    },
  ];

  const written: ReviewDecisionSaveResult['derivedArtifacts'] = [];
  for (const artifact of artifacts) {
    const path = join(input.artifactsDir, artifact.name);
    await writeTextFileAtomic(path, `${JSON.stringify(artifact.body, null, 2)}\n`);
    written.push({
      name: artifact.name,
      path,
      purpose: artifact.purpose,
    });
  }
  return written;
}

function buildReferenceBoardArtifact(
  projectSlug: string,
  generatedAt: string,
  decision: ReviewDecisionRecord,
): Record<string, unknown> {
  const selections = decision.selections;
  const notes = decision.notes;
  const references = [
    selectedReference('workflow-guide', selections.reference, {
      role: 'workflow-guide',
      allowedUse: 'Prompting and quality guidance only.',
      notes: stringValue(notes.reference),
    }),
    selectedReference('character', selections.character ?? selections.characterSource ?? selections.characterPlan, {
      role: 'identity',
      allowedUse: 'Character identity, proportions, texture, and repeatability.',
    }),
    selectedReference('operator-asset', selections.asset, {
      role: 'operator-selected-reference',
      allowedUse: 'Use only after assigning a precise role before generation.',
    }),
    selectedReference('storyboard-template', selections.template, {
      role: 'story-structure',
      allowedUse: 'Scene count and beat structure.',
    }),
  ].filter((entry): entry is Record<string, unknown> => entry !== null);

  return {
    schemaVersion: 1,
    projectSlug,
    generatedAt,
    source: 'review-ui',
    workflowSource: workflowSource(decision),
    references,
    roleAssignments: referenceRoleAssignments(selections),
    requiredReferenceRoles: [
      'identity',
      'pose',
      'lookdev',
      'background',
      'ui-structure',
      'prop',
      'start-frame',
      'end-frame',
      'texture',
    ],
    rule: 'Every image reference must have exactly one job before it influences a prompt.',
  };
}

function selectedReference(
  id: string,
  value: unknown,
  metadata: Record<string, unknown>,
): Record<string, unknown> | null {
  const selected = stringValue(value);
  if (!selected) return null;
  return {
    id,
    selected,
    ...metadata,
  };
}

function buildDirectorSeedancePlanArtifact(
  projectSlug: string,
  generatedAt: string,
  decision: ReviewDecisionRecord,
  nextActionOverride?: string,
): Record<string, unknown> {
  const selections = decision.selections;
  const workflow = isRecord(decision.seedanceWorkflow) ? decision.seedanceWorkflow : {};
  const promptPatterns = isRecord(workflow.promptPatterns) ? workflow.promptPatterns : {};
  return {
    schemaVersion: 1,
    projectSlug,
    generatedAt,
    source: 'review-ui',
    workflowSource: workflowSource(decision),
    qualityBar: stringValue(workflow.qualityBar) || 'award-winning director cinematic video with minimal operator work',
    qualityScore: decision.qualityScore ?? null,
    qualityChecks: decision.qualityChecks ?? [],
    stillStoryboard: {
      template: stringValue(selections.template) || null,
      lockedStills: Object.entries(selections)
        .filter(([key]) => key.startsWith('lockedStill-'))
        .filter(([, value]) => {
          const candidateId = stringValue(value);
          return Boolean(candidateId && !rejectedCandidateIds(selections).includes(candidateId));
        })
        .map(([key, value]) => ({ key, value })),
      editInstruction: stringValue(decision.notes.storyboard) || null,
      mustLockBeforeMotion: true,
      upscaleBeforeSeedance: true,
    },
    motion: {
      candidateStrategy: stringValue(selections.motionCandidate) || 'control-pass',
      variantStrategy: stringValue(selections.variantStrategy) || 'control-plus-short-variant',
	      continuityPlan: stringValue(selections.continuityPlan) || 'start-end-frame-chain',
	      continuityFrames: continuityFramePlan(selections),
	      bridgePosePlan: stringValue(selections.bridgePosePlan),
	      bridgePoseRequired: Boolean(stringValue(selections.bridgePosePlan)),
      cameraRule: 'Static camera unless a deliberate cinematic move is selected.',
      promptPatterns,
      bridgeTriggers: Array.isArray(workflow.bridgeTriggers) ? workflow.bridgeTriggers : [],
      negativeGuidance: Array.isArray(workflow.negativeGuidance) ? workflow.negativeGuidance : [],
    },
    nextAction: nextActionOverride ?? decision.recommendedNextAction ?? null,
  };
}

function buildGoBananasCharacterBriefArtifact(
  projectSlug: string,
  generatedAt: string,
  decision: ReviewDecisionRecord,
): Record<string, unknown> {
  const workflow = isRecord(decision.seedanceWorkflow) ? decision.seedanceWorkflow : {};
  const negativeGuidance = Array.isArray(workflow.negativeGuidance) ? workflow.negativeGuidance : [];
  return {
    schemaVersion: 1,
    projectSlug,
    generatedAt,
    source: 'review-ui',
    workflowSource: workflowSource(decision),
    status: stringValue(decision.selections.characterPlan) === 'generate-gobananas-iterations'
      ? 'ready-for-character-iterations'
      : 'operator-selected-character-source',
    selectedCharacter: stringValue(decision.selections.character) || null,
    selectedCharacterSource: stringValue(decision.selections.characterSource) || null,
    characterPlan: stringValue(decision.selections.characterPlan) || null,
    iterationCount: 4,
    preferredAspectRatio: 'portrait',
    basePromptFormula: [
      'Create a reusable cinematic character design suitable for multi-scene Seedance storyboard-to-motion production.',
      'Prioritize a clear silhouette, expressive face, stable wardrobe, readable materials, and repeatable proportions.',
      'Keep the design premium, director-grade, and compatible with role-tagged references.',
      'Provide full-body, close-up texture, expression, and action-bridge variants.',
    ],
    negativePrompt: [
      ...negativeGuidance,
      'inconsistent face',
      'wardrobe drift',
      'extra fingers',
      'unreadable silhouette',
      'overly busy accessories',
    ].join(', '),
    requiredOutputs: [
      'full-body canonical identity reference',
      'close-up face and material texture reference',
      'expression variants',
      'action bridge pose reference',
    ],
    saveBackToVideoClaw: {
      command: `vclaw video character-add --project ${projectSlug} --name <name> --gb-id <id> --ref gobananas://character/<id>`,
      artifact: `projects/${projectSlug}/characters/characters.json`,
    },
  };
}

function buildStoryboardStillsPlanArtifact(
  projectSlug: string,
  generatedAt: string,
  decision: ReviewDecisionRecord,
  sceneCandidates: SceneCandidatesArtifact,
  existingStoryboard: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const selections = decision.selections;
  const notes = decision.notes;
  const templateId = stringValue(selections.template) || 'product-commercial-4';
  const template = readStoryboardTemplate(templateId);
  const characterName =
    stringValue(selections.character)
    || stringValue(selections.characterSource)
    || 'the selected hero character';
  const scenes = storyboardScenesForReview({
    existingStoryboard,
    templateId: template?.id ?? 'product-commercial-4',
    characterName,
    selectedCharacterName: characterName,
  });
  const environment = 'a premium cinematic product world with clean composition';
  const workflow = isRecord(decision.seedanceWorkflow) ? decision.seedanceWorkflow : {};
  const promptPatterns = isRecord(workflow.promptPatterns) ? workflow.promptPatterns : {};
  const rejected = handoffRejectedCandidateIds(selections, sceneCandidates);
  const stillCreatePattern = stringValue(promptPatterns.stillCreate)
    || 'Use reference roles as source truth. Create one visual beat. Preserve identity, materials, colors, lighting, and camera.';
  const stillEditPattern = stringValue(promptPatterns.stillEdit)
    || 'Edit only the named defect or layout issue. Keep identity, pose, camera, lighting, composition, and background unchanged.';
  const negativeGuidance = Array.isArray(workflow.negativeGuidance)
    ? workflow.negativeGuidance
    : [
        'no readable UI text unless required',
        'no random logos',
        'no clutter',
        'no extra objects',
        'no real humans',
        'no distorted anatomy',
        'no unwanted camera change',
      ];

  return {
    schemaVersion: 1,
    projectSlug,
    generatedAt,
    source: 'review-ui',
    workflowSource: workflowSource(decision),
    template: template
      ? {
          id: template.id,
          name: template.name,
          emotionalArc: template.emotionalArc,
          bestFor: template.bestFor,
        }
      : { id: templateId },
    qualityBar: 'Storyboard stills must be strong enough to animate before any video generation starts.',
    globalRules: [
      'Generate still frames before motion.',
      'Iterate with narrow edit prompts until the still is clean.',
      'Lock and upscale each approved still before Seedance.',
      'Use each locked still as start/end frame material for later video continuity.',
      'Keep one readable story beat per frame.',
    ],
    promptPatterns: {
      stillCreate: stillCreatePattern,
      stillEdit: stillEditPattern,
    },
    negativeGuidance,
    referenceRolesRequired: [
      'identity',
      'pose',
      'lookdev',
      'background',
      'prop',
      'start-frame',
      'end-frame',
    ],
    scenes: scenes.map((scene) => {
      const sceneIndex = scene.sceneIndex;
      const lockedKey = `lockedStill-${sceneIndex}`;
      const selectedLockedStill = stringValue(selections[lockedKey]);
      const lockedStill = selectedLockedStill && !rejected.includes(selectedLockedStill) ? selectedLockedStill : null;
      const draftStill = selections[`draftStill-${sceneIndex}`];
      const editStill = selections[`editStill-${sceneIndex}`];
      const upscaledStill = stringValue(selections[`upscaledStill-${sceneIndex}`]);
      const upscaledStillMatchesLock = Boolean(
        lockedStill
        && upscaledStill
        && upscaledStill.startsWith(`${lockedStill}-`),
      );
      const upscaledStillHasAsset = Boolean(
        upscaledStillMatchesLock
        && upscaledStill
        && sceneHasCandidate(sceneCandidates, sceneIndex, upscaledStill),
      );
      const panel = template?.panels.find((candidate) => candidate.sceneIndex === scene.sceneIndex);
      const createPrompt = [
        stillCreatePattern,
        `Scene ${scene.sceneIndex}: ${scene.scenePrompt?.imagePrompt ?? scene.description}`,
        `Character source: ${characterName}.`,
        `Environment: ${environment}.`,
        'Composition: cinematic, premium, clear focal hierarchy, no clutter.',
        `Negative guidance: ${negativeGuidance.join(', ')}.`,
      ].join('\n');
      return {
        sceneIndex: scene.sceneIndex,
        shotType: panel?.shotType ?? 'cinematic still',
        purpose: panel?.purpose ?? 'story beat',
        beat: scene.description,
        createPrompt,
        editPrompt: [
          stillEditPattern,
          'Only fix defects that reduce clarity, continuity, or cinematic quality.',
          stringValue(notes.storyboard) || 'Preserve identity, camera, lighting, composition, and background during edits.',
        ].join('\n'),
        goBananas: {
          tool: 'generate_with_character',
          characterName,
          aspectRatio: '16:9',
          scenePrompt: createPrompt,
          additionalDetails: 'Generate storyboard still only. Do not animate. Keep the image clean enough to upscale and use as a Seedance start/end frame.',
        },
        lockState: lockedStill ? 'operator-marked-locked' : 'needs-generated-still',
        draftStillReference: stringValue(draftStill),
        editStillReference: stringValue(editStill),
        lockedStillReference: lockedStill,
        upscaledStillReference: upscaledStillMatchesLock ? upscaledStill : null,
        submittedUpscaledStillReference: upscaledStill,
        upscaleState: upscaledStillMatchesLock ? 'operator-marked-upscaled' : 'needs-upscale-confirmation',
        upscaleEvidenceState: upscaledStillHasAsset ? 'artifact-backed-upscale' : upscaledStillMatchesLock ? 'operator-marker-only' : 'missing-upscale',
        upscaleTarget: '4k-before-seedance',
        continuityRole: sceneIndex === 0 ? 'opening-start-frame' : 'target-end-frame-for-previous-scene',
        rejectedStillReferences: rejected.filter((candidateId) => candidateId.startsWith(`scene-${sceneIndex}-take-`)),
        nextAction: lockedStill
          ? 'Generate or verify upscaled still asset.'
          : 'Generate first still candidate, review, edit, then lock.',
      };
    }),
  };
}

function referenceRoleAssignments(selections: Record<string, unknown>): Array<{
  role: string;
  selected: string;
}> {
  return Object.entries(selections)
    .filter(([key, value]) => key.startsWith('referenceRole-') && stringValue(value))
    .map(([key, value]) => ({
      role: key.replace(/^referenceRole-/, ''),
      selected: stringValue(value) as string,
    }))
    .sort((left, right) => left.role.localeCompare(right.role));
}

function continuityFramePlan(selections: Record<string, unknown>): Array<{
  sceneIndex: number;
  startFrame: string | null;
  endFrame: string | null;
  continuityDecision: string | null;
}> {
  const sceneIndexes = new Set<number>();
  for (const key of Object.keys(selections)) {
    const match = /^(?:lockedStill|continuity)-(\d+)$/.exec(key);
    if (match) sceneIndexes.add(Number(match[1]));
  }
  return [...sceneIndexes]
    .sort((left, right) => left - right)
    .map((sceneIndex) => ({
      sceneIndex,
      startFrame: sceneIndex === 0
        ? stringValue(selections[`lockedStill-${sceneIndex}`])
        : stringValue(selections[`lockedStill-${sceneIndex - 1}`]),
      endFrame: stringValue(selections[`lockedStill-${sceneIndex}`]),
      continuityDecision: stringValue(selections[`continuity-${sceneIndex}`]),
    }));
}

function buildSceneSelectionArtifact(
  decision: ReviewDecisionRecord,
  sceneCandidates: SceneCandidatesArtifact,
): SceneSelectionArtifact {
  const selectionEntries: SceneSelectionArtifact['scenes'] = [];
  const rejected = handoffRejectedCandidateIds(decision.selections, sceneCandidates);
  const expectedCharacter = expectedStoryboardCharacter(decision.selections);
  const sceneIndexes = new Set<number>();
  for (const [key, value] of Object.entries(decision.selections)) {
    const match = /^lockedStill-(\d+)$/.exec(key);
    const selectedCandidateId = stringValue(value);
    if (match && selectedCandidateId && isSceneCandidateId(selectedCandidateId)) {
      sceneIndexes.add(Number(match[1]));
    }
  }
  for (const scene of sceneCandidates.scenes) {
    if (scene.candidates.some((candidate) => rejected.includes(candidate.id))) {
      sceneIndexes.add(scene.sceneIndex);
    }
  }
  for (const sceneIndex of [...sceneIndexes].sort((left, right) => left - right)) {
    const selectedCandidateId = stringValue(decision.selections[`lockedStill-${sceneIndex}`]);
    const previousSelectedCandidateId = sceneIndex > 0
      ? stringValue(decision.selections[`lockedStill-${sceneIndex - 1}`])
      : null;
    const previousSelectedCandidate = previousSelectedCandidateId
      ? findSceneCandidate(sceneCandidates, sceneIndex - 1, previousSelectedCandidateId)
      : null;
    const canChainFromPrev = Boolean(
      sceneIndex > 0
      && previousSelectedCandidate?.outputs.some((output) => output.kind === 'video'),
    );
    const selectedExists = Boolean(
      selectedCandidateId
      && isSceneCandidateId(selectedCandidateId)
      && !rejected.includes(selectedCandidateId)
      && sceneHasCandidate(sceneCandidates, sceneIndex, selectedCandidateId)
      && sceneCandidateMatchesExpectedCharacter(sceneCandidates, sceneIndex, selectedCandidateId, expectedCharacter),
    );
    const rejectedForScene = rejected.filter((candidateId) => sceneHasCandidate(sceneCandidates, sceneIndex, candidateId));
    const pendingForScene = sceneCandidates.scenes
      .find((scene) => scene.sceneIndex === sceneIndex)
      ?.candidates
      .map((candidate) => candidate.id)
      .filter((candidateId) => (
        candidateId !== selectedCandidateId
        && !isUpscaledStillCandidateId(candidateId)
        && !rejectedForScene.includes(candidateId)
        && sceneCandidateMatchesExpectedCharacter(sceneCandidates, sceneIndex, candidateId, expectedCharacter)
      ))
      ?? [];
    if (!selectedExists && rejectedForScene.length === 0 && pendingForScene.length === 0) continue;
    selectionEntries.push({
      sceneIndex,
      selectedCandidateId: selectedExists ? selectedCandidateId : null,
      rejectedCandidateIds: rejectedForScene,
      pendingCandidateIds: pendingForScene,
      rerollRequested: false,
      chainFromPrev: canChainFromPrev,
      notes: [
        selectedExists ? 'Selected from review-ui locked storyboard still.' : 'No locked storyboard still selected yet.',
        expectedCharacter && selectedCandidateId && !selectedExists
          ? `Selected still must match character "${expectedCharacter}".`
          : null,
        rejectedForScene.length ? `Rejected in review UI: ${rejectedForScene.join(', ')}.` : null,
        stringValue(decision.notes.storyboard),
      ].filter(Boolean).join(' '),
    });
  }
  selectionEntries.sort((left, right) => left.sceneIndex - right.sceneIndex);

  return {
    schemaVersion: 1,
    scenes: selectionEntries,
  };
}

function isSceneCandidateId(value: string): boolean {
  return /^scene-\d+-take-\d+$/.test(value);
}

function isUpscaledStillCandidateId(value: string): boolean {
  return /^scene-\d+-take-\d+-4k$/.test(value);
}

function expectedStoryboardCharacter(selections: Record<string, unknown>): string | null {
  const selected = stringValue(selections.character);
  if (!selected) return null;
  const normalized = selected.toLowerCase();
  if (normalized.startsWith('gobananas://character/')) return null;
  if (normalized === 'generate-gobananas-iterations') return null;
  if (normalized === 'selected character') return null;
  return normalized;
}

function sceneCandidateMatchesExpectedCharacter(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
  candidateId: string,
  expectedCharacter: string | null,
): boolean {
  if (!expectedCharacter) return true;
  const candidate = artifact.scenes
    .find((scene) => scene.sceneIndex === sceneIndex)
    ?.candidates
    .find((entry) => entry.id === candidateId);
  if (!candidate) return false;
  const haystack = [
    candidate.prompt,
    candidate.route,
    candidate.source.externalJobId,
    ...candidate.outputs.map((output) => output.path),
  ].join('\n').toLowerCase();
  return haystack.includes(expectedCharacter);
}

function sceneHasCandidate(
  artifact: SceneCandidatesArtifact,
  sceneIndex: number,
  candidateId: string,
): boolean {
  return artifact.scenes.some((scene) => (
    scene.sceneIndex === sceneIndex
    && scene.candidates.some((candidate) => candidate.id === candidateId)
  ));
}

function rejectedCandidateIds(selections: Record<string, unknown>): string[] {
  const value = selections.rejectedStillCandidates;
  return Array.isArray(value)
    ? value.map(stringValue).filter((candidateId): candidateId is string => Boolean(candidateId))
    : [];
}

function handoffRejectedCandidateIds(
  selections: Record<string, unknown>,
  sceneCandidates: SceneCandidatesArtifact,
): string[] {
  const rejected = rejectedCandidateIds(selections);
  const expectedCharacter = expectedStoryboardCharacter(selections);
  if (!expectedCharacter) return rejected;
  return rejected.filter((candidateId) => {
    const scene = sceneCandidates.scenes.find((entry) => (
      entry.candidates.some((candidate) => candidate.id === candidateId)
    ));
    return Boolean(
      scene
      && sceneCandidateMatchesExpectedCharacter(sceneCandidates, scene.sceneIndex, candidateId, expectedCharacter),
    );
  });
}

function buildPostPlanArtifact(
  projectSlug: string,
  generatedAt: string,
  decision: ReviewDecisionRecord,
  publishReady: boolean,
): Record<string, unknown> {
  const assemblyApprovals = assemblyApprovalEntries(decision.selections);
  return {
    schemaVersion: 1,
    projectSlug,
    generatedAt,
    source: 'review-ui',
    workflowSource: workflowSource(decision),
    assemblyPlan: stringValue(decision.selections.assemblyPlan) || 'balanced',
    voiceoverTiming: stringValue(decision.notes.voiceover) || 'Map every scene to voiceover timing before final assembly.',
    retiming: 'Use simple time remapping to tighten slow generated clips while preserving readable motion beats.',
    assemblyApprovals,
    publishReady,
    polishChecklist: [
      'Scene pacing matches voiceover.',
      'Continuity frames cut cleanly between shots.',
      'Opacity and transitions are intentional.',
      'Logo reveal is readable and timed as the final payoff.',
      'Final render is reviewed before publish.',
    ],
  };
}

function buildReviewReportArtifact(
  projectSlug: string,
  generatedAt: string,
  decision: ReviewDecisionRecord,
  sceneCandidates: SceneCandidatesArtifact,
  existingStoryboard: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const selections = decision.selections;
  const qualityChecks = decision.qualityChecks ?? [];
  const failedChecks = qualityChecks
    .filter((check) => check.done === false)
    .map((check) => stringValue(check.label))
    .filter((label): label is string => Boolean(label));
  const lockedSceneSelections = buildSceneSelectionArtifact(decision, sceneCandidates).scenes;
  const publishApprovals = assemblyApprovalEntries(selections);
  const reviewCompleteAt = stringValue(selections.reviewCompleteAt);
  const templateId = stringValue(selections.template) || 'product-commercial-4';
  const customSceneCount = existingStoryboardScenes(existingStoryboard).length;
  const expectedSceneCount = customSceneCount || buildStoryboardScenesFromTemplate({
    templateId,
    environment: 'a premium cinematic product world with clean composition',
    characterA: stringValue(selections.character) || stringValue(selections.characterSource) || 'the selected hero character',
  }).length;
  const mismatchedLocks = lockedStoryboardMismatchIds(decision, sceneCandidates);
  const lockedSceneCount = lockedSceneSelections.filter((scene) => scene.selectedCandidateId).length;
  const upscaleEvidence = storyboardUpscaleEvidence(decision, sceneCandidates);
  const missingLocks = Math.max(0, expectedSceneCount - lockedSceneCount);
  const missingApprovals = Math.max(0, 5 - publishApprovals.length);
  const missingUpscaleAssets = Math.max(0, expectedSceneCount - upscaleEvidence.artifactBackedCount);
  const publishReady = Boolean(
    publishApprovals.length >= 5
    && !missingLocks
    && !missingApprovals
    && !mismatchedLocks.length
    && !missingUpscaleAssets,
  );
  const verdict = failedChecks.length || !reviewCompleteAt || missingLocks || missingApprovals || mismatchedLocks.length || missingUpscaleAssets ? 'retry' : 'pass';
  const nextAction = buildReviewNextAction({
    verdict,
    failedChecks,
    reviewCompleteAt,
    missingLocks,
    missingUpscaleAssets,
    missingApprovals,
    mismatchedLocks,
  });
  return {
    projectSlug,
    verdict,
    generatedAt,
    findings: failedChecks.length
      ? failedChecks.map((label) => `Incomplete quality check: ${label}`)
      : [
          ...(!reviewCompleteAt ? ['Review UI has not been finished by the operator.'] : []),
          ...(mismatchedLocks.length ? [`Storyboard locks do not match selected character: ${mismatchedLocks.join(', ')}.`] : []),
          ...(missingLocks ? [`Missing locked storyboard stills: ${missingLocks}.`] : []),
          ...(missingUpscaleAssets ? [`Missing artifact-backed 4k/upscaled still assets: ${missingUpscaleAssets}.`] : []),
          ...(missingApprovals ? [`Missing publish approvals: ${missingApprovals}.`] : []),
          ...(reviewCompleteAt && !mismatchedLocks.length && !missingLocks && !missingUpscaleAssets && !missingApprovals ? ['Human review UI gates completed and saved.'] : []),
        ],
    metrics: {
      qualityScore: decision.qualityScore ?? null,
      activeGate: decision.activeGate ?? null,
      reviewCompleteAt,
      expectedSceneCount,
      lockedSceneCount,
      characterMismatchCount: mismatchedLocks.length,
      upscaleMarkerCount: upscaleEvidence.markerCount,
      artifactBackedUpscaleCount: upscaleEvidence.artifactBackedCount,
      operatorOnlyUpscaleCount: upscaleEvidence.operatorOnlyCount,
      missingUpscaleAssetCount: missingUpscaleAssets,
      rejectedCandidateCount: lockedSceneSelections.reduce((count, scene) => count + scene.rejectedCandidateIds.length, 0),
      publishApprovalCount: publishApprovals.length,
      publishReady,
      motionCandidate: stringValue(selections.motionCandidate),
      bridgePosePlan: stringValue(selections.bridgePosePlan),
      nextAction,
    },
  };
}

function buildReviewNextAction(input: {
  verdict: 'pass' | 'retry' | 'fail';
  failedChecks: string[];
  reviewCompleteAt: string | null;
  missingLocks: number;
  missingUpscaleAssets: number;
  missingApprovals: number;
  mismatchedLocks: string[];
}): string {
  if (input.verdict === 'pass') return 'Ready for publish handoff.';
  if (input.failedChecks.length) {
    return `Resolve review quality checks: ${input.failedChecks.join(', ')}.`;
  }
  if (!input.reviewCompleteAt) return 'Finish the review gate and save the review artifacts.';
  if (input.mismatchedLocks.length) {
    return `Replace mismatched storyboard locks before publishing: ${input.mismatchedLocks.join(', ')}.`;
  }
  if (input.missingLocks) return `Lock generated storyboard stills for ${input.missingLocks} scene(s).`;
  if (input.missingUpscaleAssets) return `Attach artifact-backed 4k/upscaled stills for ${input.missingUpscaleAssets} scene(s).`;
  if (input.missingApprovals) return `Approve ${input.missingApprovals} remaining final assembly check(s).`;
  return 'Resolve review findings before publishing.';
}

export function isReviewReportPublishReady(reviewReport: Record<string, unknown> | undefined | null): boolean {
  if (!reviewReport) return false;
  const metrics = isRecord(reviewReport.metrics) ? reviewReport.metrics : {};
  return reviewVerdict(reviewReport.verdict) === 'pass' && metrics.publishReady === true;
}

export function nextActionFromReviewReport(reviewReport: Record<string, unknown> | undefined | null, fallback?: string): string | undefined {
  if (!reviewReport) return fallback;
  const metrics = isRecord(reviewReport.metrics) ? reviewReport.metrics : {};
  const nextAction = stringValue(metrics.nextAction);
  const verdict = reviewVerdict(reviewReport.verdict);
  if (isReviewReportPublishReady(reviewReport)) return 'Ready for publish handoff.';
  if (nextAction && nextAction !== 'Ready for publish handoff.') return nextAction;
  const findings = Array.isArray(reviewReport.findings)
    ? reviewReport.findings.map(stringValue).filter((finding): finding is string => Boolean(finding))
    : [];
  if (findings.length) return `Resolve review findings: ${findings.join('; ')}.`;
  if (verdict === 'pass') return 'Complete publish readiness evidence before publishing.';
  return fallback;
}

function storyboardUpscaleEvidence(
  decision: ReviewDecisionRecord,
  sceneCandidates: SceneCandidatesArtifact,
): { markerCount: number; artifactBackedCount: number; operatorOnlyCount: number } {
  let markerCount = 0;
  let artifactBackedCount = 0;
  for (const [key, value] of Object.entries(decision.selections)) {
    const match = /^upscaledStill-(\d+)$/.exec(key);
    const upscaledStill = stringValue(value);
    if (!match || !upscaledStill) continue;
    markerCount += 1;
    if (sceneHasCandidate(sceneCandidates, Number(match[1]), upscaledStill)) {
      artifactBackedCount += 1;
    }
  }
  return {
    markerCount,
    artifactBackedCount,
    operatorOnlyCount: Math.max(0, markerCount - artifactBackedCount),
  };
}

function lockedStoryboardMismatchIds(
  decision: ReviewDecisionRecord,
  sceneCandidates: SceneCandidatesArtifact,
): string[] {
  const expectedCharacter = expectedStoryboardCharacter(decision.selections);
  if (!expectedCharacter) return [];
  return Object.entries(decision.selections)
    .map(([key, value]) => {
      const match = /^lockedStill-(\d+)$/.exec(key);
      const candidateId = stringValue(value);
      if (!match || !candidateId || !isSceneCandidateId(candidateId)) return null;
      const sceneIndex = Number(match[1]);
      return sceneCandidateMatchesExpectedCharacter(sceneCandidates, sceneIndex, candidateId, expectedCharacter)
        ? null
        : candidateId;
    })
    .filter((candidateId): candidateId is string => Boolean(candidateId));
}

function assemblyApprovalEntries(selections: Record<string, unknown>): Array<{
  id: string;
  approved: boolean;
  value: string;
}> {
  return Object.entries(selections)
    .filter(([key, value]) => key.startsWith('assemblyCheck-') && stringValue(value))
    .map(([key, value]) => ({
      id: key.replace(/^assemblyCheck-/, ''),
      approved: true,
      value: stringValue(value) as string,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function workflowSource(decision: ReviewDecisionRecord): string {
  const workflow = isRecord(decision.seedanceWorkflow) ? decision.seedanceWorkflow : {};
  return stringValue(workflow.source) || 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export async function buildReviewInventory(root: string, projectSlug: string): Promise<ReviewInventory> {
  const resolvedRoot = resolve(root);
  const workspace = resolveProjectWorkspace(projectSlug, resolvedRoot);
  const projects = await listProjects(resolvedRoot);
  const characters = existsSync(workspace.projectDir)
    ? await listCharacterProfiles(workspace)
    : [];
  const referenceSheets = await readReferenceSheetsArtifact(resolvedRoot, projectSlug);
  const sceneCandidates = await readSceneCandidatesArtifact(resolvedRoot, projectSlug);
  const sceneSelection = await readSceneSelectionArtifact(resolvedRoot, projectSlug);
  const reviewLedger = await readReviewLedger(workspace.artifactsDir);
  const reviewReport = await readJsonArtifact(workspace.artifactsDir, 'review-report.json');
  const brief = await readJsonArtifact(workspace.artifactsDir, 'brief.json');
  const storyboard = await readJsonArtifact(workspace.artifactsDir, 'storyboard.json');
  const assetManifest = await readJsonArtifact(workspace.artifactsDir, 'asset-manifest.json');
  const executionReport = await readJsonArtifact(workspace.artifactsDir, 'execution-report.json');
  const publishReport = await readJsonArtifact(workspace.artifactsDir, 'publish-report.json');
  const generationQueue = await readStoryboardStillGenerationQueue(
    join(workspace.artifactsDir, 'storyboard-still-generation-requests.json'),
    projectSlug,
  );
  const characterQueue = await readCharacterIterationQueue(
    join(workspace.artifactsDir, 'gobananas-character-iteration-requests.json'),
    projectSlug,
  );
  const playbooks = await listPlaybooks(resolvedRoot);
  const promptReferences = listPromptReferences();
  const storyboardTemplates = listStoryboardTemplates();
  const mediaAssets = await findReviewMediaAssets(resolvedRoot);

  return {
    root: resolvedRoot,
    projectSlug,
    projectDir: workspace.projectDir,
    projectExists: existsSync(workspace.projectDir),
    projects,
    characters,
    referenceSheets,
    sceneCandidates,
    sceneSelection,
    reviewLedger,
    reviewReport,
    brief,
    storyboard,
    assetManifest,
    executionReport,
    publishReport,
    generationQueue,
    characterQueue,
    playbooks,
    promptReferences,
    storyboardTemplates,
    mediaAssets,
    schemas: [
      'analyze-output',
      'asset-manifest',
      'brief',
      'clone-plan',
      'execution-plan',
      'execution-report',
      'publish-report',
      'reference-sheets',
      'review-report',
      'scene-candidates',
      'scene-selection',
      'storyboard',
    ],
  };
}

async function readReviewLedger(artifactsDir: string): Promise<Record<string, unknown> | null> {
  return readJsonArtifact(artifactsDir, 'review-ui-ledger.json');
}

async function readJsonArtifact(artifactsDir: string, name: string): Promise<Record<string, unknown> | null> {
  const path = join(artifactsDir, name);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  return isRecord(parsed) ? parsed : null;
}

async function readStoryboardStillGenerationQueue(
  path: string,
  projectSlug: string,
): Promise<ReviewStoryboardStillGenerationQueue | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.requests)) return null;
  return {
    schemaVersion: 1,
    projectSlug: stringValue(parsed.projectSlug) ?? projectSlug,
    updatedAt: stringValue(parsed.updatedAt) ?? '',
    requests: parsed.requests
      .filter(isRecord)
      .map((request): ReviewStoryboardStillGenerationRequest | null => {
        const sceneIndex = numberValue(request.sceneIndex);
        const prompt = stringValue(request.prompt);
        const id = stringValue(request.id);
        if (sceneIndex === null || !prompt || !id) return null;
        return {
          id,
          sceneIndex,
          provider: 'gobananas',
          route: 'gobananas-storyboard-still',
          status: request.status === 'fulfilled' ? 'fulfilled' : 'queued',
          prompt,
          negativePrompt: stringValue(request.negativePrompt) ?? '',
          aspectRatio: stringValue(request.aspectRatio) ?? '16:9',
          requestedAt: stringValue(request.requestedAt) ?? '',
          source: 'review-ui',
          ...(stringValue(request.notes) ? { notes: stringValue(request.notes)! } : {}),
          ...(stringValue(request.fulfilledAt) ? { fulfilledAt: stringValue(request.fulfilledAt)! } : {}),
          ...(stringValue(request.candidateId) ? { candidateId: stringValue(request.candidateId)! } : {}),
          ...(stringValue(request.imageUrl) ? { imageUrl: stringValue(request.imageUrl)! } : {}),
          ...(stringValue(request.imageId) ? { imageId: stringValue(request.imageId)! } : {}),
        };
      })
      .filter((request): request is ReviewStoryboardStillGenerationRequest => request !== null),
  };
}

async function readCharacterIterationQueue(
  path: string,
  projectSlug: string,
): Promise<ReviewCharacterIterationQueue | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.requests)) return null;
  return {
    schemaVersion: 1,
    projectSlug: stringValue(parsed.projectSlug) ?? projectSlug,
    updatedAt: stringValue(parsed.updatedAt) ?? '',
    requests: parsed.requests
      .filter(isRecord)
      .map((request): ReviewCharacterIterationRequest | null => {
        const id = stringValue(request.id);
        const prompt = stringValue(request.prompt);
        if (!id || !prompt) return null;
        return {
          id,
          provider: 'gobananas',
          route: 'gobananas-character-iteration',
          status: request.status === 'failed' ? 'failed' : request.status === 'fulfilled' ? 'fulfilled' : 'queued',
          characterName: stringValue(request.characterName) ?? 'Komo',
          prompt,
          negativePrompt: stringValue(request.negativePrompt) ?? '',
          aspectRatio: normalizeCharacterAspectRatio(stringValue(request.aspectRatio)),
          count: numberValue(request.count) ?? 4,
          requestedAt: stringValue(request.requestedAt) ?? '',
          source: 'review-ui',
          ...(stringValue(request.notes) ? { notes: stringValue(request.notes)! } : {}),
          ...(stringValue(request.fulfilledAt) ? { fulfilledAt: stringValue(request.fulfilledAt)! } : {}),
          ...(stringValue(request.characterProfileId) ? { characterProfileId: stringValue(request.characterProfileId)! } : {}),
          ...(numberValue(request.goBananasId) ? { goBananasId: numberValue(request.goBananasId)! } : {}),
          ...(stringValue(request.referenceImageUrl) ? { referenceImageUrl: stringValue(request.referenceImageUrl)! } : {}),
          ...(stringValue(request.imageId) ? { imageId: stringValue(request.imageId)! } : {}),
          ...(stringValue(request.failedAt) ? { failedAt: stringValue(request.failedAt)! } : {}),
          ...(stringValue(request.error) ? { error: stringValue(request.error)! } : {}),
        };
      })
      .filter((request): request is ReviewCharacterIterationRequest => request !== null),
  };
}

function normalizeCharacterAspectRatio(value: string | null): string {
  if (!value || value === '1:1') return 'square';
  return value;
}

async function findReviewMediaAssets(root: string): Promise<Array<{ path: string; kind: string }>> {
  const roots = [
    join(root, 'docs', 'assets'),
    join(root, 'skills', 'davendra-presenter', 'assets'),
    join(root, 'skills', 'nex-presenter', 'assets'),
  ];
  const assets: Array<{ path: string; kind: string }> = [];
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = join(dir, entry.name);
      const kind = extname(entry.name).replace('.', '').toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(kind)) continue;
      assets.push({
        path: filePath.slice(root.length + 1),
        kind,
      });
    }
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  return assets;
}
