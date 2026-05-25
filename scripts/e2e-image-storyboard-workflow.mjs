#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const repoRoot = process.cwd();
const cliPath = join(repoRoot, 'dist', 'cli', 'vclaw.js');
const defaultManifestPath = join(repoRoot, 'examples', 'image-storyboard', 'proofy-e2e-stills.json');
const reviewStationUiPath = join(repoRoot, 'tmp', 'review-station', 'index.html');

function parseArgs(argv) {
  const parsed = {
    manifest: defaultManifestPath,
    root: null,
    reset: false,
    includeExamples: false,
    verifyServer: false,
    port: 4322,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') parsed.manifest = argv[++i];
    else if (arg === '--project') parsed.project = argv[++i];
    else if (arg === '--root') parsed.root = argv[++i];
    else if (arg === '--run-id') parsed.runId = argv[++i];
    else if (arg === '--reset') parsed.reset = true;
    else if (arg === '--include-examples') parsed.includeExamples = true;
    else if (arg === '--verify-server') parsed.verifyServer = true;
    else if (arg === '--port') parsed.port = Number(argv[++i]);
    else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function safeRunId(value = new Date().toISOString()) {
  return value.replace(/[:.]/g, '-');
}

function asJson(stdout) {
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

function commandLine(args) {
  return ['node', relative(repoRoot, cliPath), ...args].join(' ');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image download failed ${response.status} ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) {
    throw new Error(`image download too small (${bytes.length} bytes): ${url}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return {
    path: outputPath,
    bytes: bytes.length,
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} returned HTTP ${response.status}\n${text}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

function runCli(args, record, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });
  const endedAt = new Date().toISOString();
  const entry = {
    command: commandLine(args),
    status: result.status,
    startedAt,
    endedAt,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
  record.commands.push(entry);
  if (result.status !== (options.expectStatus ?? 0)) {
    throw new Error(
      `command failed status=${result.status}: ${entry.command}\n${result.stderr}\n${result.stdout}`,
    );
  }
  return options.parseJson === false ? result.stdout : asJson(result.stdout);
}

function runScript(scriptPath, record, env = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [join(repoRoot, scriptPath)], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...env,
    },
  });
  const endedAt = new Date().toISOString();
  const entry = {
    script: scriptPath,
    command: `node ${scriptPath}`,
    status: result.status,
    startedAt,
    endedAt,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
  record.exampleRuns.push(entry);
  if (result.status !== 0) {
    throw new Error(`example failed: ${scriptPath}\n${result.stderr}\n${result.stdout}`);
  }
}

async function verifyReviewUiServer(projectSlug, root, port, record) {
  const server = spawn(process.execPath, [
    cliPath,
    'video',
    'review-ui',
    '--project',
    projectSlug,
    '--root',
    root,
    '--ui-path',
    reviewStationUiPath,
    '--port',
    String(port),
  ], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const launch = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`review-ui server launch timed out\nstdout=${stdout}\nstderr=${stderr}`));
    }, 5000);
    server.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
      try {
        const parsed = JSON.parse(stdout);
        clearTimeout(timer);
        resolve(parsed);
      } catch {
        // Wait for the first full JSON object.
      }
    });
    server.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`review-ui server exited before verification, code=${code}\nstdout=${stdout}\nstderr=${stderr}`));
    });
    server.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  try {
    const pageResponse = await fetch(launch.url, { method: 'HEAD' });
    if (!pageResponse.ok) {
      throw new Error(`review-ui page returned HTTP ${pageResponse.status}`);
    }
    const inventoryResponse = await fetch(
      `http://127.0.0.1:${port}/api/review-inventory?project=${encodeURIComponent(projectSlug)}`,
    );
    if (!inventoryResponse.ok) {
      throw new Error(`review-ui inventory returned HTTP ${inventoryResponse.status}`);
    }
    let inventory = await inventoryResponse.json();
    const apiChecks = [];
    const selectedScenesBeforeReview = (inventory.sceneSelection?.scenes ?? [])
      .filter((scene) => scene.selectedCandidateId);
    const firstScene = record.images[0];
    if (!firstScene) {
      throw new Error('review-ui API verification requires at least one generated storyboard image');
    }
    const apiBase = `http://127.0.0.1:${port}`;
    const projectParam = `project=${encodeURIComponent(projectSlug)}`;

    const mediaProxyResponse = await fetch(
      `${apiBase}/api/media-proxy?url=${encodeURIComponent(firstScene.imageUrl)}`,
    );
    if (!mediaProxyResponse.ok) {
      throw new Error(`review-ui media proxy returned HTTP ${mediaProxyResponse.status}`);
    }
    const proxiedBytes = Buffer.from(await mediaProxyResponse.arrayBuffer()).byteLength;
    if (proxiedBytes < 1024) {
      throw new Error(`review-ui media proxy returned too few bytes: ${proxiedBytes}`);
    }
    apiChecks.push({
      endpoint: '/api/media-proxy',
      status: mediaProxyResponse.status,
      contentType: mediaProxyResponse.headers.get('content-type'),
      bytes: proxiedBytes,
    });

    const storyboardRequest = await postJson(`${apiBase}/api/storyboard-still-request?${projectParam}`, {
      sceneIndex: firstScene.sceneIndex,
      prompt: `${firstScene.prompt}\nE2E request check: create one cleaner still candidate, preserving Proofy identity.`,
      aspectRatio: '16:9',
      notes: `Queued by E2E review UI API verification ${record.runId}.`,
    });
    apiChecks.push({
      endpoint: '/api/storyboard-still-request',
      requestId: storyboardRequest.request.id,
      status: storyboardRequest.request.status,
    });

    const apiCandidate = await postJson(`${apiBase}/api/storyboard-still-candidate?${projectParam}`, {
      sceneIndex: firstScene.sceneIndex,
      imageUrl: firstScene.imageUrl,
      imageId: `${firstScene.imageId}-api-review`,
      prompt: `${firstScene.prompt}\nAPI candidate acceptance check for Proofy identity and storyboard quality.`,
      notes: `Recorded through Review UI API during E2E run ${record.runId}; not selected for final lock.`,
    });
    apiChecks.push({
      endpoint: '/api/storyboard-still-candidate',
      candidateId: apiCandidate.candidate.id,
      reused: apiCandidate.reused,
    });

    const characterRequest = await postJson(`${apiBase}/api/character-iteration-request?${projectParam}`, {
      characterName: 'Proofy',
      prompt: 'Generate four Proofy character identity iterations: front pose, three-quarter pose, happy proof moment, and determined investigation pose. Keep the same flat illustrated fintech adventure mascot identity.',
      aspectRatio: '1:1',
      count: 4,
      notes: `Queued by E2E review UI API verification ${record.runId}; no images generated by this request.`,
    });
    apiChecks.push({
      endpoint: '/api/character-iteration-request',
      requestId: characterRequest.request.id,
      status: characterRequest.request.status,
      count: characterRequest.request.count,
    });

    const upscaledCandidates = [];
    const upscaleDir = join(root, 'projects', projectSlug, 'assets', 'upscaled', 'storyboard', record.runId);
    await mkdir(upscaleDir, { recursive: true });
    for (const image of record.images) {
      const sourcePath = join(root, 'projects', projectSlug, image.projectRelativePath);
      const upscaledRelativePath = join(
        'assets',
        'upscaled',
        'storyboard',
        record.runId,
        `scene-${image.sceneIndex}-take-1-e2e-upscaled.jpg`,
      );
      const upscaledPath = join(root, 'projects', projectSlug, upscaledRelativePath);
      await copyFile(sourcePath, upscaledPath);
      const upscaled = await postJson(`${apiBase}/api/upscaled-still-candidate?${projectParam}`, {
        sceneIndex: image.sceneIndex,
        sourceCandidateId: image.candidateId,
        imageUrl: upscaledRelativePath,
        imageId: `${image.imageId}-e2e-upscale`,
        prompt: `Artifact-backed upscale candidate for ${image.title}. This E2E copy represents the locked still promoted into the upscale gate; no video generation was run.`,
      });
      upscaledCandidates.push({
        sceneIndex: image.sceneIndex,
        sourceCandidateId: image.candidateId,
        candidateId: upscaled.candidate.id,
        path: upscaledRelativePath,
        reused: upscaled.reused,
      });
    }
    apiChecks.push({
      endpoint: '/api/upscaled-still-candidate',
      candidates: upscaledCandidates.map((candidate) => candidate.candidateId),
    });

    const selections = {
      character: 'proofy',
      characterPlan: 'generate-gobananas-iterations',
      reference: 'seedance-motion-design-reference',
      'referenceRole-identity': 'generate-gobananas-iterations',
      'referenceRole-pose': firstScene.candidateId,
      'referenceRole-lookdev': firstScene.candidateId,
      'referenceRole-background': firstScene.candidateId,
      'referenceRole-prop': firstScene.candidateId,
      'referenceRole-start-frame': firstScene.candidateId,
      'referenceRole-end-frame': record.images.at(-1)?.candidateId ?? firstScene.candidateId,
      template: 'product-commercial-4',
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
    for (const image of record.images) {
      selections[`draftStill-${image.sceneIndex}`] = image.candidateId;
      selections[`lockedStill-${image.sceneIndex}`] = image.candidateId;
      selections[`upscaledStill-${image.sceneIndex}`] = `${image.candidateId}-4k`;
      selections[`continuity-${image.sceneIndex}`] = image.sceneIndex === 0
        ? 'start-frame-confirmed'
        : 'extract-end-frame';
    }
    const reviewDecision = await postJson(`${apiBase}/api/review-decision?${projectParam}`, {
      activeGate: 'assembly',
      seedanceWorkflow: {
        source: 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md',
        qualityBar: 'award-winning director cinematic video with minimal operator work',
      },
      qualityScore: '8/8',
      recommendedNextAction: 'Ready to write review artifacts.',
      selections,
      notes: {
        storyboard: 'E2E human-in-the-loop review selected all locked storyboard stills and artifact-backed upscales.',
        continuity: 'Each scene has a continuity decision; later video generation must use locked stills as start/end frame anchors.',
        upscale: 'Upscale gate is represented by artifact-backed still candidates only; no video generation was run.',
      },
    });
    apiChecks.push({
      endpoint: '/api/review-decision',
      lifecycleStatus: reviewDecision.lifecycle?.status ?? null,
      nextAction: reviewDecision.decision?.recommendedNextAction ?? null,
    });

    const finalInventoryResponse = await fetch(
      `${apiBase}/api/review-inventory?${projectParam}`,
    );
    if (!finalInventoryResponse.ok) {
      throw new Error(`review-ui final inventory returned HTTP ${finalInventoryResponse.status}`);
    }
    inventory = await finalInventoryResponse.json();
    const selectedScenesAfterReview = (inventory.sceneSelection?.scenes ?? [])
      .filter((scene) => scene.selectedCandidateId);
    const reviewReportVerdict = inventory.reviewReport?.verdict ?? null;
    const publishReady = inventory.reviewReport?.metrics?.publishReady ?? null;
    if (reviewReportVerdict !== 'pass' || publishReady !== true) {
      throw new Error(`review-ui completed review did not pass: verdict=${reviewReportVerdict} publishReady=${publishReady}`);
    }
    const selectedScenes = (inventory.sceneSelection?.scenes ?? [])
      .filter((scene) => scene.selectedCandidateId).length;
    return {
      launch,
      page: {
        status: pageResponse.status,
        cacheControl: pageResponse.headers.get('cache-control'),
      },
      inventory: {
        projectSlug: inventory.projectSlug,
        projectExists: inventory.projectExists,
        characters: inventory.characters?.length ?? 0,
        mediaAssets: inventory.mediaAssets?.length ?? 0,
        referenceSheets: inventory.referenceSheets?.sheets?.length ?? 0,
        sceneCandidateScenes: inventory.sceneCandidates?.scenes?.length ?? 0,
        selectedScenesBeforeReview: selectedScenesBeforeReview.length,
        selectedScenesAfterReview: selectedScenesAfterReview.length,
        selectedScenes,
        reviewReportVerdict: inventory.reviewReport?.verdict ?? null,
        publishReady: inventory.reviewReport?.metrics?.publishReady ?? null,
        artifactBackedUpscaleCount: inventory.reviewReport?.metrics?.artifactBackedUpscaleCount ?? null,
        apiChecks,
      },
    };
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1000);
      server.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    record.commands.push({
      command: commandLine([
        'video',
        'review-ui',
        '--project',
        projectSlug,
        '--root',
        root,
        '--ui-path',
        reviewStationUiPath,
        '--port',
        String(port),
      ]),
      status: 0,
      startedAt: launch.generatedAt ?? null,
      endedAt: new Date().toISOString(),
      stdout: JSON.stringify(launch),
      stderr,
      note: 'live review-ui server verification; process terminated after API checks',
    });
  }
}

function markdownForRun(record) {
  const lines = [];
  lines.push(`# Image Storyboard E2E Run ${record.runId}`);
  lines.push('');
  lines.push(`- Project: \`${record.projectSlug}\``);
  lines.push(`- Started: ${record.startedAt}`);
  lines.push(`- Completed: ${record.completedAt}`);
  lines.push(`- Manifest: \`${record.manifestPath}\``);
  lines.push(`- Source workflow: \`${record.sourceDocument}\``);
  lines.push(`- Video generation: not run`);
  lines.push('');
  lines.push('## Generated Images');
  lines.push('');
  for (const image of record.images) {
    lines.push(`### Scene ${image.sceneIndex}: ${image.title}`);
    lines.push('');
    lines.push(`- Go Bananas image ID: \`${image.imageId}\``);
    lines.push(`- Source URL: ${image.imageUrl}`);
    lines.push(`- Local asset: \`${image.projectRelativePath}\``);
    lines.push(`- Bytes: ${image.bytes}`);
    lines.push(`- Candidate: \`${image.candidateId}\``);
    lines.push(`- Selected: ${image.selected ? 'yes' : 'no'}`);
    lines.push('');
    lines.push('Prompt:');
    lines.push('');
    lines.push('```text');
    lines.push(image.prompt);
    lines.push('```');
    lines.push('');
  }
  lines.push('## Verification');
  lines.push('');
  lines.push(`- Readiness: ${record.verification.readiness.ready ? 'ready' : 'blocked'}`);
  lines.push(`- Director preflight: ${record.verification.directorPreflight.pass ? 'pass' : 'fail'}`);
  lines.push(`- Plan ready: ${record.verification.plan.ready ? 'ready' : 'blocked'} (${record.verification.plan.recommendedRouteId ?? 'no route'})`);
  lines.push(`- Doctor errors: ${record.verification.doctor.errors}`);
  lines.push(`- Review UI dry-run URL: ${record.verification.reviewUi.url}`);
  if (record.verification.reviewUi.liveServer) {
    const live = record.verification.reviewUi.liveServer;
    lines.push(`- Review UI live server: HTTP ${live.page.status}, ${live.inventory.selectedScenes} selected scenes`);
    lines.push(`- Review UI final verdict: ${live.inventory.reviewReportVerdict} (publish ready: ${live.inventory.publishReady ? 'yes' : 'no'})`);
    lines.push(`- Artifact-backed upscales: ${live.inventory.artifactBackedUpscaleCount}`);
    lines.push(`- Review UI API checks: ${live.inventory.apiChecks.map((check) => check.endpoint).join(', ')}`);
  }
  lines.push(`- Obsidian note: \`${record.verification.obsidian.outputPath}\``);
  lines.push('');
  lines.push('## Commands');
  lines.push('');
  for (const command of record.commands) {
    lines.push(`- \`${command.command}\` -> ${command.status}`);
  }
  if (record.exampleRuns.length > 0) {
    lines.push('');
    lines.push('## Example Runs');
    lines.push('');
    for (const example of record.exampleRuns) {
      lines.push(`- \`${example.command}\` -> ${example.status}`);
    }
  }
  if (record.skippedExamples.length > 0) {
    lines.push('');
    lines.push('## Skipped Examples');
    lines.push('');
    for (const skipped of record.skippedExamples) {
      lines.push(`- \`${skipped.name}\`: ${skipped.reason}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(cliPath)) {
  throw new Error(`compiled CLI missing at ${cliPath}; run the build first`);
}

const manifestPath = args.manifest;
const manifest = await readJson(manifestPath);
const projectSlug = args.project ?? manifest.projectSlug;
const runId = safeRunId(args.runId);
const root = args.root ?? await mkdtemp(join(tmpdir(), 'vclaw-image-storyboard-e2e-'));
const projectDir = join(root, 'projects', projectSlug);

if (args.reset) {
  await rm(projectDir, { recursive: true, force: true });
}

const record = {
  schemaVersion: 1,
  runId,
  projectSlug,
  root,
  manifestPath: relative(repoRoot, manifestPath),
  sourceDocument: manifest.sourceDocument,
  startedAt: new Date().toISOString(),
  completedAt: null,
  commands: [],
  exampleRuns: [],
  skippedExamples: [],
  images: [],
  verification: {},
};

const profile = manifest.executionProfile ?? {};
const character = manifest.character;
const scenes = manifest.scenes ?? [];
if (!projectSlug || scenes.length === 0 || !character?.name) {
  throw new Error('manifest requires projectSlug, character, and at least one scene');
}

runCli(['video', 'init', projectSlug, '--root', root, '--mode', 'director'], record);
runCli([
  'video',
  'brief',
  '--project',
  projectSlug,
  '--root',
  root,
  '--title',
  manifest.title,
  '--intent',
  manifest.intent,
  '--mode',
  'director',
  '--platform',
  profile.platform ?? 'youtube',
  '--aspect-ratio',
  profile.aspectRatio ?? '16:9',
  '--quality',
  profile.quality ?? 'quality',
  '--resolution',
  profile.resolution ?? '720p',
  '--audio',
  profile.audio ?? 'off',
  '--outputs',
  profile.outputs ?? '1',
], record);

const downloadedByScene = [];
for (const scene of scenes) {
  const fileName = `scene-${scene.sceneIndex}-gb-${scene.imageId}.jpg`;
  const projectRelativePath = join('assets', 'storyboard', 'generated', runId, fileName);
  const absolutePath = join(projectDir, projectRelativePath);
  const download = await downloadImage(scene.imageUrl, absolutePath);
  downloadedByScene.push({ ...scene, projectRelativePath, absolutePath, bytes: download.bytes });
}

runCli([
  'video',
  'character-add',
  '--project',
  projectSlug,
  '--root',
  root,
  '--name',
  character.name,
  '--gb-id',
  String(character.goBananasId),
  '--description',
  character.description,
  '--ref',
  downloadedByScene[0].projectRelativePath,
  '--note',
  `E2E image-only run ${runId}; Go Bananas character ${character.goBananasId}; reference image ${character.referenceImageId}.`,
], record);

const storyboardArgs = [
  'video',
  'storyboard',
  '--project',
  projectSlug,
  '--root',
  root,
  '--mode',
  'director',
];
for (const scene of scenes) {
  storyboardArgs.push('--scene', `${scene.title}: ${scene.description} Motion intent: ${scene.motionIntent}`);
  storyboardArgs.push('--scene-character', `${scene.sceneIndex}:${character.name}`);
}
runCli(storyboardArgs, record);

const refSheetArgs = [
  'video',
  'reference-sheet-add',
  '--project',
  projectSlug,
  '--root',
  root,
  '--type',
  'identity',
  '--id',
  `${character.name.toLowerCase()}-identity-e2e`,
  '--name',
  `${character.name} E2E identity`,
  '--character-name',
  character.name,
  '--ref',
  `${downloadedByScene[0].projectRelativePath}:identity:front readable silhouette`,
  '--ref',
  `${downloadedByScene[downloadedByScene.length - 1].projectRelativePath}:identity:final readable silhouette`,
  '--gb-ref',
  `character:${character.goBananasId}:identity`,
];
for (const scene of scenes) {
  refSheetArgs.push('--binding', String(scene.sceneIndex));
}
runCli(refSheetArgs, record);

for (const scene of downloadedByScene) {
  const stillAdd = runCli([
    'video',
    'storyboard-still-add',
    '--project',
    projectSlug,
    '--root',
    root,
    '--scene',
    String(scene.sceneIndex),
    '--image-url',
    scene.projectRelativePath,
    '--image-id',
    String(scene.imageId),
    '--prompt',
    scene.prompt,
    '--notes',
    `E2E image-only storyboard still generated by Go Bananas session; source ${scene.imageUrl}`,
  ], record);
  const candidateId = stillAdd.candidate.id;
  runCli([
    'video',
    'select-candidate',
    '--project',
    projectSlug,
    '--root',
    root,
    '--scene',
    String(scene.sceneIndex),
    '--candidate-id',
    candidateId,
    '--notes',
    `Selected by image-only E2E run ${runId}; no video generated.`,
  ], record);
  if (scene.sceneIndex > 0) {
    runCli([
      'video',
      'chain-from',
      '--project',
      projectSlug,
      '--root',
      root,
      '--scene',
      String(scene.sceneIndex),
      '--from',
      String(scene.sceneIndex - 1),
    ], record);
  }
  record.images.push({
    sceneIndex: scene.sceneIndex,
    title: scene.title,
    imageId: scene.imageId,
    imageUrl: scene.imageUrl,
    projectRelativePath: scene.projectRelativePath,
    bytes: scene.bytes,
    prompt: scene.prompt,
    candidateId,
    selected: true,
  });
}

const readiness = runCli(['video', 'readiness', '--project', projectSlug, '--root', root, '--mode', 'director'], record);
const directorPreflight = runCli(['video', 'director-preflight', '--project', projectSlug, '--root', root], record);
const plan = runCli(['video', 'plan', '--project', projectSlug, '--root', root, '--mode', 'director'], record);
const storyboardReview = runCli(['video', 'storyboard-review', '--project', projectSlug, '--root', root, '--mode', 'director'], record);
const reviewUi = runCli([
  'video',
  'review-ui',
  '--project',
  projectSlug,
  '--root',
  root,
  '--ui-path',
  reviewStationUiPath,
  '--dry-run',
], record);
const doctor = runCli(['video', 'doctor-project', '--project', projectSlug, '--root', root, '--mode', 'director'], record);
const status = runCli(['video', 'status', '--project', projectSlug, '--root', root, '--mode', 'director'], record);
const obsidian = runCli([
  'video',
  'export-obsidian',
  '--project',
  projectSlug,
  '--root',
  root,
  '--output-dir',
  join(projectDir, 'obsidian'),
  '--mode',
  'director',
], record);

const liveServer = args.verifyServer
  ? await verifyReviewUiServer(projectSlug, root, args.port, record)
  : null;
const preflightResult = directorPreflight.result ?? directorPreflight;
const reviewResult = storyboardReview.review ?? storyboardReview;
record.verification = {
  readiness: {
    ready: readiness.ready,
    blockers: readiness.blockers,
    warnings: readiness.warnings,
  },
  directorPreflight: {
    pass: preflightResult.pass,
    errors: preflightResult.errors?.length ?? 0,
    warnings: preflightResult.warnings?.length ?? 0,
  },
  plan: {
    ready: plan.plan.ready,
    recommendedRouteId: plan.plan.recommendedRouteId,
    blockers: plan.plan.blockers,
    rationale: plan.plan.rationale,
  },
  storyboardReview: {
    markdownPath: reviewResult.markdownPath,
  },
  reviewUi: {
    url: reviewUi.url,
    uiPath: reviewUi.uiPath,
    ...(liveServer ? { liveServer } : {}),
  },
  doctor: {
    errors: doctor.errors?.length ?? 0,
    warnings: doctor.warnings?.length ?? 0,
  },
  status: {
    nextStage: status.nextStage,
    stageStatuses: status.stages?.map((stage) => ({ name: stage.name, status: stage.status })),
  },
  obsidian: {
    outputPath: obsidian.outputPath,
  },
};

if (args.includeExamples) {
  runScript('scripts/demo-quickstart.mjs', record, { VCLAW_DEMO_PAUSE_MS: '1' });
  runScript('scripts/smoke-runtime.mjs', record);
  runScript('scripts/smoke-reference-sheets.mjs', record);
  runScript('scripts/smoke-scene-candidates.mjs', record);
  runScript('scripts/smoke-character-hydration.mjs', record);
  runScript('scripts/smoke-portfolio.mjs', record);
  record.skippedExamples.push(
    {
      name: 'scripts/smoke-native-veo.mjs',
      reason: 'video provider transport smoke; intentionally skipped for image-only E2E.',
    },
    {
      name: 'scripts/smoke-execution-cancel.mjs',
      reason: 'live execution/cancel transport surface; intentionally skipped for image-only E2E.',
    },
    {
      name: 'post-production and final-video checks',
      reason: 'ffmpeg/video-output surfaces; intentionally skipped before video generation.',
    },
  );
}

const sceneSelection = await readJson(join(projectDir, 'artifacts', 'scene-selection.json'));
const assetManifest = await readJson(join(projectDir, 'artifacts', 'asset-manifest.json'));
const referenceSheets = await readJson(join(projectDir, 'references', 'reference-sheets.json'));
record.artifactSummary = {
  selectedScenes: sceneSelection.scenes.filter((scene) => scene.selectedCandidateId).length,
  assetCount: assetManifest.assets.length,
  referenceSheetCount: referenceSheets.sheets.length,
};

for (const image of record.images) {
  const imageStat = await stat(join(projectDir, image.projectRelativePath));
  image.bytes = imageStat.size;
}

record.completedAt = new Date().toISOString();
const historyDir = join(projectDir, 'artifacts', 'e2e-image-storyboard-history');
const jsonPath = join(historyDir, `${runId}.json`);
const mdPath = join(historyDir, `${runId}.md`);
await writeJson(jsonPath, record);
await writeFile(mdPath, markdownForRun(record));
await writeJson(join(historyDir, 'latest.json'), record);
await writeFile(join(historyDir, 'latest.md'), markdownForRun(record));

process.stdout.write(`${JSON.stringify({
  ok: true,
  projectSlug,
  runId,
  images: record.images.map((image) => ({
    sceneIndex: image.sceneIndex,
    imageId: image.imageId,
    candidateId: image.candidateId,
    path: image.projectRelativePath,
  })),
  readiness: record.verification.readiness,
  plan: record.verification.plan,
  history: {
    jsonPath,
    mdPath,
  },
}, null, 2)}\n`);
