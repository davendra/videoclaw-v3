import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { appendProjectEvent } from '../video/events.js';
import { executeProject } from '../video/execute.js';
import { refreshExecutionStatus } from '../video/execution-status.js';
import {
  readSceneCandidatesArtifact,
  writeSceneCandidatesArtifact,
} from '../video/scene-candidate-store.js';
import {
  readSceneSelectionArtifact,
  writeSceneSelectionArtifact,
} from '../video/scene-selection-store.js';
import { selectCandidate, setChainFromPrev } from '../video/scene-selection.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { readStageCheckpoint } from '../video/checkpoints.js';

async function seedReadyProject(root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace('alpha', root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug: 'alpha',
    productionMode: 'storyboard',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('storyboard'),
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Alpha',
    intent: 'Alpha intent',
    productionMode: 'storyboard',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode: 'storyboard',
    scenes: [{ sceneIndex: 0, description: 'Scene one' }],
  }));
  await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: 'alpha',
    assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png', sceneIndex: 0, backend: 'veo-useapi' }],
  });
  await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');
}

async function seedReadyThreeSceneProject(root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace('alpha', root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug: 'alpha',
    productionMode: 'storyboard',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('storyboard'),
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Alpha',
    intent: 'Alpha intent',
    productionMode: 'storyboard',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode: 'storyboard',
    scenes: [
      { sceneIndex: 0, description: 'Scene zero' },
      { sceneIndex: 1, description: 'Scene one' },
      { sceneIndex: 2, description: 'Scene two' },
    ],
  }));
  await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: 'alpha',
    assets: [
      { id: 'image-0', kind: 'image', path: '/tmp/image0.png', sceneIndex: 0, backend: 'veo-useapi' },
      { id: 'image-1', kind: 'image', path: '/tmp/image1.png', sceneIndex: 1, backend: 'veo-useapi' },
      { id: 'image-2', kind: 'image', path: '/tmp/image2.png', sceneIndex: 2, backend: 'veo-useapi' },
    ],
  });
  await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');
}

async function writeStubAdapter(root: string, externalJobId: string): Promise<string> {
  const adapterPath = join(root, 'seedance-adapter.sh');
  await writeFile(adapterPath, [
    '#!/bin/sh',
    'cat >/dev/null',
    `printf '{"externalJobId":"${externalJobId}","status":"submitted"}'`,
    '',
  ].join('\n'));
  await chmod(adapterPath, 0o755);
  return adapterPath;
}

async function seedReadyDirectorProject(root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace('alpha', root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug: 'alpha',
    productionMode: 'director',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('director'),
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Alpha',
    intent: 'Alpha director intent',
    productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode: 'director',
    scenes: [{ sceneIndex: 0, description: 'Scene one', durationSeconds: 15 }],
  }));
  await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: 'alpha',
    assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png', sceneIndex: 0, backend: 'veo-useapi' }],
  });
  await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');
}

describe('executeProject', () => {
  it('emits a blocked execution report when the project is not ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'brief',
        lastCompletedStage: null,
        lastCheckpointStatus: 'pending',
      });

      const result = await executeProject('alpha', { root, dryRun: false });
      assert.equal(result.report.status, 'blocked');
      assert.ok(result.report.blockers.length > 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits a dry-run-complete execution report when the project is ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-'));
    try {
      await seedReadyProject(root);

      const result = await executeProject('alpha', { root, dryRun: true });
      const context = await readFile(join(root, '.omx', 'video-context.md'), 'utf-8');
      assert.equal(result.report.status, 'dry-run-complete');
      assert.equal(result.report.blockers.length, 0);
      assert.ok(result.report.executedSteps.includes('simulated-execution-plan'));
      assert.match(context, /produce: dry-run-complete for project alpha via veo-useapi/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('submits a live execution payload through the configured adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-'));
    try {
      await seedReadyProject(root);
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{
          sceneIndex: 0,
          description: 'Scene one',
          scenePrompt: {
            imagePrompt: 'Static frame of the product on a reflective counter.',
            animationPrompt: 'Slow push-in while the product reflection shifts naturally.',
            cameraMove: 'push-in',
          },
        }],
      }));
      const adapterPath = join(root, 'seedance-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'cat > "$1"',
        'printf \'{"externalJobId":"job-123","status":"submitted"}\'',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      const stdinCapturePath = join(root, 'adapter-stdin.json');
      const result = await executeProject('alpha', {
        root,
        dryRun: false,
        env: {
          ...process.env,
          VCLAW_VEO_USEAPI_ADAPTER: `${adapterPath} ${stdinCapturePath}`,
        },
      });

      assert.equal(result.report.status, 'live-submitted');
      assert.equal(result.report.dryRun, false);
      assert.equal(result.report.taskCount, 1);
      assert.equal(result.report.submission?.externalJobId, 'job-123');
      const checkpoint = await readStageCheckpoint(await ensureProjectWorkspace('alpha', root), 'assets');
      assert.equal(checkpoint?.status, 'pending');

      const capturedPayload = JSON.parse(await readFile(stdinCapturePath, 'utf-8')) as { routeId?: string; tasks?: Array<{ prompt?: string; inputKind?: string }> };
      assert.equal(capturedPayload.routeId, 'veo-useapi');
      assert.equal(capturedPayload.tasks?.[0]?.prompt, 'Slow push-in while the product reflection shifts naturally.');
      assert.equal(capturedPayload.tasks?.[0]?.inputKind, 'image');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to the built-in veo-useapi adapter when only route commands are configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-'));
    try {
      await seedReadyProject(root);
      const stdinCapturePath = join(root, 'seedance-submit.json');
      const result = await executeProject('alpha', {
        root,
        dryRun: false,
        env: {
          ...process.env,
          VCLAW_VEO_USEAPI_SUBMIT_CMD: `cat > ${JSON.stringify(stdinCapturePath)} && printf '{\"externalJobId\":\"job-built-in-1\",\"status\":\"submitted\"}'`,
        },
      });

      assert.equal(result.report.status, 'live-submitted');
      assert.equal(result.report.submission?.externalJobId, 'job-built-in-1');
      const capturedPayload = JSON.parse(await readFile(stdinCapturePath, 'utf-8')) as { routeId?: string };
      assert.equal(capturedPayload.routeId, 'veo-useapi');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires storyboard approval before director execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-director-'));
    try {
      await seedReadyDirectorProject(root);

      const result = await executeProject('alpha', { root, productionMode: 'director', dryRun: true });
      const markdown = await readFile(join(root, 'projects', 'alpha', 'storyboard.md'), 'utf-8');
      const checkpoint = await readStageCheckpoint(await ensureProjectWorkspace('alpha', root), 'storyboard');

      assert.equal(result.report.status, 'blocked');
      assert.ok(result.report.blockers.some((item) => item.includes('VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video execute --project "alpha" --root')));
      assert.match(markdown, /Alpha director intent/);
      assert.match(markdown, /Scene 1/);
      assert.equal(checkpoint?.status, 'awaiting-approval');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks director execution when preflight errors are present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-director-'));
    try {
      await seedReadyDirectorProject(root);
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [{ sceneIndex: 0, description: 'Scene one with a spectral blade.' }],
      }));

      const result = await executeProject('alpha', { root, productionMode: 'director', dryRun: true });
      const markdown = await readFile(join(root, 'projects', 'alpha', 'storyboard.md'), 'utf-8');
      const checkpoint = await readStageCheckpoint(await ensureProjectWorkspace('alpha', root), 'storyboard');

      assert.equal(result.report.status, 'blocked');
      assert.ok(result.report.blockers.some((item) => item.includes('provider-risk wording')));
      assert.match(markdown, /## Preflight/);
      assert.match(markdown, /CONTENT_FILTER_HAZARD/);
      assert.equal(checkpoint?.status, 'failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('auto-fixes known content hazards before director execution when enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-director-'));
    try {
      await seedReadyDirectorProject(root);
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [{ sceneIndex: 0, description: 'Scene one with a spectral blade and fires a gun.' }],
      }));

      const result = await executeProject('alpha', {
        root,
        productionMode: 'director',
        dryRun: true,
        env: {
          ...process.env,
          DIRECTOR_AUTO_FIX_CONTENT: '1',
          VIDEOCLAW_APPROVE_STORYBOARD: '1',
        },
      });
      const storyboard = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'storyboard.json'), 'utf-8'),
      ) as { scenes?: Array<{ description?: string }> };

      assert.equal(result.report.status, 'dry-run-complete');
      assert.doesNotMatch(storyboard.scenes?.[0]?.description ?? '', /spectral blade/i);
      assert.doesNotMatch(storyboard.scenes?.[0]?.description ?? '', /fires a gun/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('continues director execution once storyboard approval is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-director-'));
    try {
      await seedReadyDirectorProject(root);

      const result = await executeProject('alpha', {
        root,
        productionMode: 'director',
        dryRun: true,
        env: {
          ...process.env,
          VIDEOCLAW_APPROVE_STORYBOARD: '1',
        },
      });
      const checkpoint = await readStageCheckpoint(await ensureProjectWorkspace('alpha', root), 'storyboard');

      assert.equal(result.report.status, 'dry-run-complete');
      assert.equal(checkpoint?.status, 'completed');
      assert.match(checkpoint?.summary ?? '', /approved|created/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('legacy path: projects without candidates never create a candidates artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-legacy-'));
    try {
      await seedReadyProject(root);
      await writeStubAdapter(root, 'job-legacy-1');
      const adapterPath = join(root, 'seedance-adapter.sh');

      const result = await executeProject('alpha', {
        root,
        dryRun: false,
        env: {
          ...process.env,
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });
      assert.equal(result.report.status, 'live-submitted');
      // Legacy invariant: no candidates artifact gets written.
      assert.equal(existsSync(join(root, 'projects', 'alpha', 'artifacts', 'scene-candidates.json')), false);
      assert.equal(existsSync(join(root, 'projects', 'alpha', 'artifacts', 'scene-selection.json')), false);
      assert.equal(result.report.candidatesByScene, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--scene partial rerun only submits targeted scenes and creates candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-scene-flag-'));
    try {
      await seedReadyThreeSceneProject(root);
      const adapterPath = await writeStubAdapter(root, 'job-scene-0');

      // Submit scene 0 only.
      const first = await executeProject('alpha', {
        root,
        dryRun: false,
        sceneIndices: [0],
        env: {
          ...process.env,
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });
      assert.equal(first.report.status, 'live-submitted');
      assert.equal(first.report.taskCount, 1);

      let candidates = await readSceneCandidatesArtifact(root, 'alpha');
      assert.equal(candidates.scenes.length, 1);
      assert.equal(candidates.scenes[0].sceneIndex, 0);
      assert.equal(candidates.scenes[0].candidates.length, 1);
      assert.equal(candidates.scenes[0].candidates[0].status, 'pending');
      assert.equal(candidates.scenes[0].candidates[0].generationRound, 1);

      // Submit scenes 1 and 2.
      await writeStubAdapter(root, 'job-scene-12');
      const second = await executeProject('alpha', {
        root,
        dryRun: false,
        sceneIndices: [1, 2],
        env: {
          ...process.env,
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });
      assert.equal(second.report.status, 'live-submitted');
      assert.equal(second.report.taskCount, 2);

      candidates = await readSceneCandidatesArtifact(root, 'alpha');
      const sceneIndexes = candidates.scenes.map((s) => s.sceneIndex).sort((a, b) => a - b);
      assert.deepEqual(sceneIndexes, [0, 1, 2]);
      const scene0 = candidates.scenes.find((s) => s.sceneIndex === 0)!;
      const scene1 = candidates.scenes.find((s) => s.sceneIndex === 1)!;
      const scene2 = candidates.scenes.find((s) => s.sceneIndex === 2)!;
      assert.equal(scene0.candidates.length, 1);
      assert.equal(scene1.candidates.length, 1);
      assert.equal(scene2.candidates.length, 1);
      assert.equal(scene0.candidates[0].id, 'scene-0-take-1');
      assert.equal(scene1.candidates[0].id, 'scene-1-take-1');
      assert.equal(scene2.candidates[0].id, 'scene-2-take-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('candidate mode: execute-status promotes pending candidates to completed and derives the asset manifest from selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-status-candidates-'));
    try {
      await seedReadyThreeSceneProject(root);
      const adapterPath = join(root, 'adapter.sh');
      // First invocation = submit (returns externalJobId). Second invocation = poll (returns completed + outputs).
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'PAYLOAD="$(cat)"',
        'if echo "$PAYLOAD" | grep -q \'"action":"poll"\'; then',
        `  printf '{"status":"completed","externalJobId":"job-cand-1","outputs":[{"id":"out-1","kind":"video","path":"/tmp/scene0.mp4","sceneIndex":0}]}'`,
        'else',
        '  printf \'{"externalJobId":"job-cand-1","status":"submitted"}\'',
        'fi',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      const env = {
        ...process.env,
        VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
      };

      // Submit scene 0 (enters candidate mode via --scene).
      const submitResult = await executeProject('alpha', {
        root,
        dryRun: false,
        sceneIndices: [0],
        env,
      });
      assert.equal(submitResult.report.status, 'live-submitted');
      assert.equal(submitResult.report.candidatesByScene?.length, 1);

      // Poll until completed.
      const statusResult = await refreshExecutionStatus('alpha', { root, env });
      assert.equal(statusResult.poll.status, 'completed');

      const candidates = await readSceneCandidatesArtifact(root, 'alpha');
      const scene0 = candidates.scenes.find((s) => s.sceneIndex === 0)!;
      const completed = scene0.candidates[0];
      assert.equal(completed.status, 'completed');
      assert.ok(completed.completedAt);
      assert.equal(completed.outputs.length, 1);
      assert.equal(completed.outputs[0].kind, 'video');
      assert.equal(completed.outputs[0].path, '/tmp/scene0.mp4');

      // Before selection, the asset manifest should be empty.
      const manifestBefore = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'asset-manifest.json'), 'utf-8'),
      ) as { assets: unknown[] };
      assert.equal(manifestBefore.assets.length, 0);

      // Selecting the candidate and re-deriving yields a manifest entry.
      const selection = await readSceneSelectionArtifact(root, 'alpha');
      const updated = selectCandidate(selection, 0, completed.id);
      await writeSceneSelectionArtifact(root, 'alpha', updated);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('chain-from-prev: carries the previous scene\'s video output as a seed input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-chain-'));
    try {
      await seedReadyThreeSceneProject(root);

      // Seed candidates artifact with a completed & selected scene 0 candidate.
      const candidates = {
        schemaVersion: 1 as const,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-take-1',
                generationRound: 1,
                prompt: 'Scene zero',
                route: 'veo-useapi',
                submittedAt: '2026-04-21T00:00:00.000Z',
                completedAt: '2026-04-21T00:05:00.000Z',
                status: 'completed' as const,
                outputs: [{ kind: 'video' as const, path: '/tmp/scene0.mp4' }],
                source: {
                  executionRound: 1,
                  adapter: 'builtin' as const,
                  chainedFromCandidateId: null,
                },
              },
            ],
          },
        ],
      };
      await writeSceneCandidatesArtifact(root, 'alpha', candidates);
      const selection0 = await readSceneSelectionArtifact(root, 'alpha');
      let selection = selectCandidate(selection0, 0, 'scene-0-take-1');
      selection = setChainFromPrev(selection, 1, true);
      await writeSceneSelectionArtifact(root, 'alpha', selection);

      // Stub adapter that captures the submitted payload so we can inspect
      // whether scene 0's video path rode along as a referencePath.
      const capturePath = join(root, 'payload.json');
      const adapterPath = join(root, 'adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        `cat > ${JSON.stringify(capturePath)}`,
        'printf \'{"externalJobId":"job-chain-1","status":"submitted"}\'',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      const result = await executeProject('alpha', {
        root,
        dryRun: false,
        sceneIndices: [1],
        env: {
          ...process.env,
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });
      assert.equal(result.report.status, 'live-submitted');

      const captured = JSON.parse(await readFile(capturePath, 'utf-8')) as {
        tasks: Array<{
          sceneIndex: number;
          inputKind: string;
          referencePaths: string[];
          chainedFromCandidateId?: string;
        }>;
      };
      assert.equal(captured.tasks.length, 1);
      assert.equal(captured.tasks[0].sceneIndex, 1);
      assert.equal(captured.tasks[0].inputKind, 'video');
      assert.ok(captured.tasks[0].referencePaths.includes('/tmp/scene0.mp4'));
      assert.equal(captured.tasks[0].chainedFromCandidateId, 'scene-0-take-1');

      // The newly-created candidate records chain provenance.
      const after = await readSceneCandidatesArtifact(root, 'alpha');
      const scene1 = after.scenes.find((s) => s.sceneIndex === 1)!;
      assert.equal(scene1.candidates[0].source.chainedFromCandidateId, 'scene-0-take-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('chain-from-prev hard-fails when the source scene has no selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-chain-miss-'));
    try {
      await seedReadyThreeSceneProject(root);

      // Initialise candidates artifact (enters candidate mode) but without a
      // scene 0 selection. Scene 1 has chainFromPrev on.
      await writeSceneCandidatesArtifact(root, 'alpha', { schemaVersion: 1, scenes: [] });
      const selection0 = await readSceneSelectionArtifact(root, 'alpha');
      const selection = setChainFromPrev(selection0, 1, true);
      await writeSceneSelectionArtifact(root, 'alpha', selection);

      const adapterPath = await writeStubAdapter(root, 'job-chain-miss');

      const result = await executeProject('alpha', {
        root,
        dryRun: false,
        sceneIndices: [1],
        env: {
          ...process.env,
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });
      assert.equal(result.report.status, 'blocked');
      assert.ok(
        result.report.blockers.some((blocker) => blocker.includes('chain-from-prev-source-missing')),
        `expected chain-from-prev-source-missing blocker, got ${JSON.stringify(result.report.blockers)}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks director execution when the review artifact is stale even if approval is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-director-'));
    try {
      await seedReadyDirectorProject(root);
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeFile(join(root, 'projects', 'alpha', 'storyboard.md'), '# Review\n');
      await appendProjectEvent(workspace, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T10:00:00.000Z',
        payload: { markdownPath: join(root, 'projects', 'alpha', 'storyboard.md') },
      });
      await appendProjectEvent(workspace, {
        type: 'artifact.storyboard.written',
        recordedAt: '2026-04-20T11:00:00.000Z',
        payload: { artifactPath: join(root, 'projects', 'alpha', 'artifacts', 'storyboard.json') },
      });

      const result = await executeProject('alpha', {
        root,
        productionMode: 'director',
        dryRun: true,
        env: {
          ...process.env,
          VIDEOCLAW_APPROVE_STORYBOARD: '1',
        },
      });
      const checkpoint = await readStageCheckpoint(await ensureProjectWorkspace('alpha', root), 'storyboard');

      assert.equal(result.report.status, 'blocked');
      assert.ok(result.report.blockers.some((item) => item.includes('vclaw video storyboard-review --project "alpha" --root') && item.includes('--mode director')));
      assert.equal(checkpoint?.status, 'awaiting-approval');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
