import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { artifactPathFor, writeArtifact } from '../video/artifact-store.js';
import { readStageCheckpoint } from '../video/checkpoints.js';
import { appendProjectEvent } from '../video/events.js';
import { executeProject } from '../video/execute.js';
import { refreshExecutionStatus } from '../video/execution-status.js';
import { ensureProjectWorkspace, readProjectManifest, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

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

async function seedLiveProject(root: string, adapterPath: string): Promise<void> {
  await seedReadyProject(root);
  await executeProject('alpha', {
    root,
    env: {
      ...process.env,
      USEAPI_API_TOKEN: 'test-token',
      USEAPI_ACCOUNT_EMAIL: 'test@example.com',
      VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
    },
  });
}

describe('refreshExecutionStatus', () => {
  it('returns failed status JSON when execution-report artifact is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-'));
    try {
      await seedReadyProject(root);
      const result = await refreshExecutionStatus('alpha', { root });
      assert.equal(result.poll.status, 'failed');
      assert.equal((result.poll.rawResult as { reason?: string }).reason, 'missing-execution-report');
      assert.ok(
        result.poll.issues.some((issue) => issue.includes('execution-report artifact is missing')),
      );

      const workspace = await ensureProjectWorkspace('alpha', root);
      const checkpoint = await readStageCheckpoint(workspace, 'assets');
      assert.equal(checkpoint?.status, 'failed');
      assert.equal(checkpoint?.nextAction, 'Run execution before polling execution status.');

      const manifest = await readProjectManifest(workspace);
      assert.equal(manifest?.currentStage, 'assets');
      assert.equal(manifest?.lastCheckpointStatus, 'failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('polls a live job, ingests outputs, and advances the project to review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-'));
    try {
      const adapterPath = join(root, 'veo-useapi-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'INPUT=$(cat)',
        'if echo "$INPUT" | grep -q \'"action":"poll"\'; then',
        '  printf \'{"status":"completed","externalJobId":"job-123","outputs":[{"id":"generated-scene-0","kind":"video","path":"/tmp/generated-scene-0.mp4","sceneIndex":0,"backend":"veo-useapi"}]}\'',
        'else',
        '  printf \'{"externalJobId":"job-123","status":"submitted"}\'',
        'fi',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      await seedLiveProject(root, adapterPath);
      const result = await refreshExecutionStatus('alpha', {
        root,
        env: {
          ...process.env,
          USEAPI_API_TOKEN: 'test-token',
          USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });

      assert.equal(result.poll.status, 'completed');
      assert.equal(result.assetManifestPath, artifactPathFor(await ensureProjectWorkspace('alpha', root), 'asset-manifest'));

      const assetManifest = JSON.parse(await readFile(result.assetManifestPath!, 'utf-8')) as {
        assets?: Array<{ id?: string; kind?: string; backend?: string }>;
      };
      assert.ok(assetManifest.assets?.some((asset) => asset.id === 'generated-scene-0' && asset.kind === 'video' && asset.backend === 'veo-useapi'));

      const workspace = await ensureProjectWorkspace('alpha', root);
      const checkpoint = await readStageCheckpoint(workspace, 'assets');
      assert.equal(checkpoint?.status, 'completed');
      const manifest = await readProjectManifest(workspace);
      assert.equal(manifest?.currentStage, 'review');
      assert.equal(manifest?.lastCompletedStage, 'assets');

      const report = JSON.parse(await readFile(artifactPathFor(workspace, 'execution-report'), 'utf-8')) as {
        poll?: { status?: string; outputsIngested?: number };
      };
      assert.equal(report.poll?.status, 'completed');
      assert.equal(report.poll?.outputsIngested, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the built-in veo-useapi adapter when only submit/poll commands are configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-'));
    try {
      const submitCapturePath = join(root, 'seedance-submit.json');
      await seedReadyProject(root);
      await executeProject('alpha', {
        root,
        env: {
          ...process.env,
          USEAPI_API_TOKEN: 'test-token',
          USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          VCLAW_VEO_USEAPI_SUBMIT_CMD: `cat > ${JSON.stringify(submitCapturePath)} && printf '{\"externalJobId\":\"job-built-in-2\",\"status\":\"submitted\"}'`,
        },
      });
      const result = await refreshExecutionStatus('alpha', {
        root,
        env: {
          ...process.env,
          USEAPI_API_TOKEN: 'test-token',
          USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          VCLAW_VEO_USEAPI_SUBMIT_CMD: `cat > ${JSON.stringify(submitCapturePath)} && printf '{\"externalJobId\":\"job-built-in-2\",\"status\":\"submitted\"}'`,
          VCLAW_VEO_USEAPI_POLL_CMD: `cat >/dev/null && printf '{\"status\":\"completed\",\"externalJobId\":\"job-built-in-2\",\"outputs\":[{\"id\":\"generated-scene-0-built-in\",\"kind\":\"video\",\"path\":\"/tmp/generated-built-in.mp4\",\"sceneIndex\":0,\"backend\":\"veo-useapi\"}]}'`,
        },
      });

      assert.equal(result.poll.status, 'completed');
      const submitPayload = JSON.parse(await readFile(submitCapturePath, 'utf-8')) as { routeId?: string };
      assert.equal(submitPayload.routeId, 'veo-useapi');

      const assetManifest = JSON.parse(await readFile(result.assetManifestPath!, 'utf-8')) as {
        assets?: Array<{ id?: string }>;
      };
      assert.ok(assetManifest.assets?.some((asset) => asset.id === 'generated-scene-0-built-in'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats completed polls with zero outputs as failed and keeps project on assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-'));
    try {
      const adapterPath = join(root, 'veo-useapi-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'INPUT=$(cat)',
        'if echo "$INPUT" | grep -q \'"action":"poll"\'; then',
        '  printf \'{"status":"completed","externalJobId":"job-empty","outputs":[],"issues":[]}\'',
        'else',
        '  printf \'{"externalJobId":"job-empty","status":"submitted"}\'',
        'fi',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      await seedLiveProject(root, adapterPath);
      const result = await refreshExecutionStatus('alpha', {
        root,
        env: {
          ...process.env,
          USEAPI_API_TOKEN: 'test-token',
          USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });

      assert.equal(result.poll.status, 'completed');
      const workspace = await ensureProjectWorkspace('alpha', root);
      const report = JSON.parse(await readFile(result.reportPath, 'utf-8')) as {
        poll?: { status?: string; issues?: string[] };
      };
      assert.equal(report.poll?.status, 'failed');
      assert.ok(
        report.poll?.issues?.some((issue) => issue.includes('returned no outputs')),
      );

      const checkpoint = await readStageCheckpoint(workspace, 'assets');
      assert.equal(checkpoint?.status, 'failed');
      const manifest = await readProjectManifest(workspace);
      assert.equal(manifest?.currentStage, 'assets');
      assert.equal(manifest?.lastCheckpointStatus, 'failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks director polling when the storyboard review is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-'));
    try {
      const adapterPath = join(root, 'veo-useapi-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'INPUT=$(cat)',
        'if echo "$INPUT" | grep -q \'"action":"poll"\'; then',
        '  printf \'{"status":"completed","externalJobId":"job-123","outputs":[{"id":"generated-scene-0","kind":"video","path":"/tmp/generated-scene-0.mp4","sceneIndex":0,"backend":"veo-useapi"}]}\'',
        'else',
        '  printf \'{"externalJobId":"job-123","status":"submitted"}\'',
        'fi',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

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
        intent: 'Alpha intent',
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

      await executeProject('alpha', {
        root,
        productionMode: 'director',
        dryRun: false,
        env: {
          ...process.env,
          VIDEOCLAW_APPROVE_STORYBOARD: '1',
          USEAPI_API_TOKEN: 'test-token',
          USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
        },
      });

      await assert.rejects(
        () => refreshExecutionStatus('alpha', {
          root,
          productionMode: 'director',
          env: {
            ...process.env,
            USEAPI_API_TOKEN: 'test-token',
            USEAPI_ACCOUNT_EMAIL: 'test@example.com',
            VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
          },
        }),
        /storyboard review is stale/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing blockers when the execution report is already blocked and has no live adapter job id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-'));
    try {
      await seedReadyProject(root);
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'execution-report', {
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        operationKind: 'image-to-video',
        routeId: 'veo-useapi',
        status: 'blocked',
        dryRun: false,
        generatedAt: new Date().toISOString(),
        blockers: ['Adapter submission blocked upstream.'],
        executedSteps: ['validated-readiness', 'selected-provider-route', 'prepared-provider-adapter-payload'],
      });

      const result = await refreshExecutionStatus('alpha', { root });
      assert.equal(result.poll.status, 'failed');
      assert.equal(result.poll.externalJobId, null);
      assert.ok(result.poll.issues.some((issue) => issue.includes('Adapter submission blocked upstream')));
      assert.equal((result.poll.rawResult as { reason?: string }).reason, 'execution-already-blocked');

      const report = JSON.parse(await readFile(result.reportPath, 'utf-8')) as { poll?: { status?: string; issues?: string[] } };
      assert.equal(report.poll?.status, 'failed');
      assert.ok(report.poll?.issues?.some((issue) => issue.includes('Adapter submission blocked upstream')));

      const checkpoint = await readStageCheckpoint(workspace, 'assets');
      assert.equal(checkpoint?.status, 'failed');
      assert.ok(checkpoint?.issues?.some((issue) => issue.includes('Adapter submission blocked upstream')));
      assert.equal(checkpoint?.nextAction, 'Resolve execution blockers and rerun execution.');

      const manifest = await readProjectManifest(workspace);
      assert.equal(manifest?.currentStage, 'assets');
      assert.equal(manifest?.lastCheckpointStatus, 'failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves existing blockers when the execution report has no provider route id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-'));
    try {
      await seedReadyProject(root);
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'execution-report', {
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        operationKind: 'image-to-video',
        routeId: null,
        status: 'blocked',
        dryRun: false,
        generatedAt: new Date().toISOString(),
        blockers: ['No route selected for execution.'],
        executedSteps: ['validated-readiness', 'selected-provider-route'],
      });

      const result = await refreshExecutionStatus('alpha', { root });
      assert.equal(result.poll.status, 'failed');
      assert.equal(result.poll.externalJobId, null);
      assert.ok(result.poll.issues.some((issue) => issue.includes('No route selected for execution')));
      assert.equal((result.poll.rawResult as { reason?: string }).reason, 'execution-already-blocked');

      const report = JSON.parse(await readFile(result.reportPath, 'utf-8')) as { poll?: { status?: string; issues?: string[] } };
      assert.equal(report.poll?.status, 'failed');
      assert.ok(report.poll?.issues?.some((issue) => issue.includes('No route selected for execution')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
