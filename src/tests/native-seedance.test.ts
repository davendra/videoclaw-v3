import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeProject } from '../video/execute.js';
import { refreshExecutionStatus } from '../video/execution-status.js';
import { submitSeedanceDirectNative } from '../video/native-seedance.js';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
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
    metadata: {
      executionProfile: {
        aspectRatio: '9:16',
        quality: 'quality',
        resolution: '1080p',
        generateAudio: false,
      },
    },
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode: 'storyboard',
    scenes: [{ sceneIndex: 0, description: 'Scene one', durationSeconds: 6 }],
  }));
  await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: 'alpha',
    assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png', sceneIndex: 0, backend: 'veo-useapi' }],
  });
  await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');
}

describe('veo-useapi native transport via built-in adapter commands', () => {
  it('submits and polls through submit/poll command hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-useapi-cmd-'));
    const submitCapturePath = join(root, 'veo-useapi-submit.json');
    const generatedVideoPath = join(root, 'scene-0.mp4');
    await writeFile(generatedVideoPath, 'fake-video-binary');
    try {
      await seedReadyProject(root);
      const env = {
        ...process.env,
        USEAPI_API_TOKEN: 'test-token',
        USEAPI_ACCOUNT_EMAIL: 'test@example.com',
        VCLAW_VEO_USEAPI_SUBMIT_CMD: `cat > ${JSON.stringify(submitCapturePath)} && printf '{\"externalJobId\":\"veo-job-123\",\"status\":\"submitted\"}'`,
        VCLAW_VEO_USEAPI_POLL_CMD: `cat >/dev/null && printf '{\"status\":\"completed\",\"externalJobId\":\"veo-job-123\",\"outputs\":[{\"id\":\"generated-scene-0\",\"kind\":\"video\",\"path\":${JSON.stringify(generatedVideoPath)},\"sceneIndex\":0,\"backend\":\"veo-useapi\"}]}'`,
      };

      const submit = await executeProject('alpha', {
        root,
        env,
      });
      assert.equal(submit.report.status, 'live-submitted');
      assert.equal(submit.report.routeId, 'veo-useapi');
      assert.ok(String(submit.report.submission?.externalJobId).startsWith('veo-job-'));

      const submitPayload = JSON.parse(await readFile(submitCapturePath, 'utf-8')) as { routeId?: string };
      assert.equal(submitPayload.routeId, 'veo-useapi');

      const poll = await refreshExecutionStatus('alpha', {
        root,
        env,
      });
      assert.equal(poll.poll.status, 'completed');

      const assetManifest = JSON.parse(await readFile(poll.assetManifestPath!, 'utf-8')) as {
        assets?: Array<{ id?: string; path?: string; backend?: string }>;
      };
      const generated = assetManifest.assets?.find((asset) => asset.id === 'generated-scene-0');
      assert.equal(generated?.backend, 'veo-useapi');
      assert.ok(generated?.path?.endsWith('scene-0.mp4'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('seedance-direct native transport', () => {
  it('classifies chained video references separately from first-frame images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-seedance-refs-'));
    const capturedBodies: unknown[] = [];
    try {
      const result = await submitSeedanceDirectNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'director',
        routeId: 'seedance-direct',
        operationKind: 'image-to-video',
        executionProfile: {
          aspectRatio: '16:9',
          quality: 'quality',
          resolution: '720p',
          generateAudio: true,
          outputCount: 1,
        },
        generatedAt: new Date().toISOString(),
        outputDir: join(root, 'outputs'),
        tasks: [
          {
            sceneIndex: 1,
            prompt: 'Continue the proof sequence.',
            inputKind: 'video',
            referencePaths: [
              'https://cdn.example.com/scene-0.mp4',
              'https://cdn.example.com/scene-1.jpg',
            ],
            sourceAssetIds: [],
            backendHints: [],
            characters: ['proofy'],
            chainedFromCandidateId: 'scene-0-take-8',
          },
        ],
        promptGuidance: [],
      }, {
        env: { SUTUI_API_KEY: 'test-sutui' },
        fetchImpl: async (_url, init) => {
          capturedBodies.push(JSON.parse(init?.body ?? '{}') as unknown);
          return {
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({
              data: {
                task_id: 'seedance-task-1',
              },
            }),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      });

      assert.equal(result.externalJobId.startsWith('seedance-'), true);
      const body = capturedBodies[0] as { params?: Record<string, unknown> };
      assert.equal(body.params?.image_url, undefined);
      assert.deepEqual(body.params?.reference_images, ['https://cdn.example.com/scene-1.jpg']);
      assert.deepEqual(body.params?.reference_videos, ['https://cdn.example.com/scene-0.mp4']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sends multiple image references as ordered reference_images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-seedance-multi-image-'));
    const capturedBodies: unknown[] = [];
    try {
      const result = await submitSeedanceDirectNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'director',
        routeId: 'seedance-direct',
        operationKind: 'image-to-video',
        executionProfile: {
          aspectRatio: '16:9',
          quality: 'quality',
          resolution: '720p',
          generateAudio: true,
          outputCount: 1,
        },
        generatedAt: new Date().toISOString(),
        outputDir: join(root, 'outputs'),
        tasks: [
          {
            sceneIndex: 0,
            prompt: 'Read @image1 then @image2 as storyboard source references.',
            inputKind: 'image',
            referencePaths: [
              'https://cdn.example.com/hero-sheet.jpg',
              'https://cdn.example.com/storyboard-grid.jpg',
              'Asset://scene-start-frame',
            ],
            sourceAssetIds: ['@image1', '@image2', 'scene-start-frame'],
            backendHints: ['filmmaking-prompts'],
            characters: ['hero'],
          },
        ],
        promptGuidance: [],
      }, {
        env: { SUTUI_API_KEY: 'test-sutui' },
        fetchImpl: async (_url, init) => {
          capturedBodies.push(JSON.parse(init?.body ?? '{}') as unknown);
          return {
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({
              data: {
                task_id: 'seedance-task-1',
              },
            }),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      });

      assert.equal(result.externalJobId.startsWith('seedance-'), true);
      const body = capturedBodies[0] as { params?: Record<string, unknown> };
      assert.equal(body.params?.image_url, undefined);
      assert.deepEqual(body.params?.reference_images, [
        'https://cdn.example.com/hero-sheet.jpg',
        'https://cdn.example.com/storyboard-grid.jpg',
        'Asset://scene-start-frame',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
