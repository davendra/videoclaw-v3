import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { buildExecutionPlan } from '../video/execution-plan.js';
import { writeSceneCandidatesArtifact } from '../video/scene-candidate-store.js';
import { writeSceneSelectionArtifact } from '../video/scene-selection-store.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import type { VideoProductionMode } from '../video/types.js';

async function seedMinimalReadyProject(
  root: string,
  productionMode: VideoProductionMode,
): Promise<void> {
  const workspace = await ensureProjectWorkspace('alpha', root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug: 'alpha',
    productionMode,
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest(productionMode),
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Alpha',
    intent: 'Alpha intent',
    productionMode,
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode,
    scenes: [{ sceneIndex: 0, description: 'Scene one' }],
  }));
  await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: 'alpha',
    assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png' }],
  });
}

describe('buildExecutionPlan', () => {
  it('blocks execution planning when required artifacts are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-plan-'));
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

      const plan = await buildExecutionPlan('alpha', root);
      assert.equal(plan.ready, false);
      assert.ok(plan.blockers.some((item) => item.includes('Missing required artifacts')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('selects an available route when the project is ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-plan-'));
    try {
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
        assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png' }],
      });
      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const plan = await buildExecutionPlan('alpha', root);
      assert.equal(plan.ready, true);
      assert.equal(plan.recommendedRouteId, 'veo-useapi');
      assert.equal(plan.executionProfile.quality, 'fast');
      assert.equal(plan.executionProfile.aspectRatio, '16:9');
      assert.ok(plan.promptGuidance.some((entry) => entry.name === 'veo-prompting-guide'));
      assert.ok(plan.promptGuidance.some((entry) => entry.name === 'checkpoint-protocol'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prefers Seedance for director image-to-video planning when the direct route is available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-plan-'));
    try {
      await seedMinimalReadyProject(root, 'director');
      await writeFile(join(root, '.env.local'), 'SUTUI_API_KEY=test-token\n');

      const plan = await buildExecutionPlan('alpha', root);
      assert.equal(plan.ready, true);
      assert.equal(plan.operationKind, 'image-to-video');
      assert.equal(plan.recommendedRouteId, 'seedance-direct');
      assert.ok(plan.rationale.some((entry) => entry.includes('seedance-direct selected')));
      assert.ok(plan.promptGuidance.some((entry) => entry.name === 'seedance-ugc-formulas'));
      assert.ok(plan.promptGuidance.some((entry) => entry.name === 'character-reference-sheet'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports both preferred director routes when image-to-video providers are unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-plan-'));
    try {
      await seedMinimalReadyProject(root, 'director');

      const plan = await buildExecutionPlan('alpha', root, 'director', { env: {} });
      assert.equal(plan.ready, false);
      assert.equal(plan.recommendedRouteId, null);
      assert.ok(plan.rationale.some((entry) => entry.includes('seedance-direct skipped: route is unavailable')));
      assert.ok(plan.rationale.some((entry) => entry.includes('veo-useapi skipped: route is unavailable')));
      assert.ok(plan.blockers.some((entry) => entry.includes('No available provider route supports image-to-video')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks execution planning when character continuity requirements are not satisfied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-plan-'));
    try {
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
      await addCharacterProfile(workspace, {
        name: 'Nova',
      });
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'storyboard',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Scene one', characters: ['Nova'] }],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png' }],
      });
      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const plan = await buildExecutionPlan('alpha', root);
      assert.equal(plan.ready, false);
      assert.ok(plan.blockers.some((item) => item.includes('Characters missing reference assets: Nova')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes execution profile overrides from brief metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-plan-'));
    try {
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
            outputCount: 2,
          },
        },
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Scene one' }],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png' }],
      });
      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const plan = await buildExecutionPlan('alpha', root);
      assert.equal(plan.executionProfile.aspectRatio, '9:16');
      assert.equal(plan.executionProfile.quality, 'quality');
      assert.equal(plan.executionProfile.resolution, '1080p');
      assert.equal(plan.executionProfile.generateAudio, false);
      assert.equal(plan.executionProfile.outputCount, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to image-to-video for candidate-mode partial scene coverage with video-only manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-plan-'));
    try {
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
        ],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'generated-scene-0', kind: 'video', path: '/tmp/generated-scene-0.mp4', sceneIndex: 0 }],
      });
      await writeSceneCandidatesArtifact(root, 'alpha', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-take-1',
                generationRound: 1,
                prompt: 'Scene zero prompt',
                route: 'veo-useapi',
                submittedAt: now,
                status: 'completed',
                completedAt: now,
                outputs: [{ kind: 'video', path: '/tmp/generated-scene-0.mp4' }],
                source: { executionRound: 1, adapter: 'native', chainedFromCandidateId: null },
              },
            ],
          },
        ],
      });
      await writeSceneSelectionArtifact(root, 'alpha', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            selectedCandidateId: 'scene-0-take-1',
            rejectedCandidateIds: [],
            pendingCandidateIds: [],
            rerollRequested: false,
            chainFromPrev: false,
          },
        ],
      });
      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const plan = await buildExecutionPlan('alpha', root);
      assert.equal(plan.operationKind, 'image-to-video');
      assert.equal(plan.ready, true);
      assert.equal(plan.recommendedRouteId, 'veo-useapi');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
