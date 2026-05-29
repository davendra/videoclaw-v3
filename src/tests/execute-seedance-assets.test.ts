import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { buildExecutionPayload } from '../video/execution-runtime.js';
import type { VideoExecutionPlan } from '../video/types.js';

async function seedProject(
  root: string,
  slug: string,
  scenes: Array<{ sceneIndex: number; description: string; characters?: string[] }>,
): Promise<void> {
  const workspace = await ensureProjectWorkspace(slug, root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug,
    productionMode: 'storyboard',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('storyboard'),
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: slug,
    intent: `${slug} intent`,
    productionMode: 'storyboard',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: slug,
    productionMode: 'storyboard',
    scenes,
  }));
}

function seedancePlan(slug: string): VideoExecutionPlan {
  return {
    projectSlug: slug,
    productionMode: 'storyboard',
    operationKind: 'generate',
    recommendedRouteId: 'seedance-direct',
    executionProfile: 'native',
    promptGuidance: [],
  } as unknown as VideoExecutionPlan;
}

describe('buildExecutionPayload seedance Asset:// auto-resolution', () => {
  it('injects per-scene Asset:// references from seedance-assets.json by cast name', async () => {
    const slug = 'cast-resolve';
    const root = await mkdtemp(join(tmpdir(), 'vclaw-exec-assets-'));
    await seedProject(root, slug, [
      { sceneIndex: 0, description: 'Scene A', characters: ['Aanya'] },
      { sceneIndex: 1, description: 'Scene B', characters: ['Vikram'] },
    ]);
    const assetsArtifact = {
      schemaVersion: 1,
      projectSlug: slug,
      groupName: `${slug}-cast`,
      generatedAt: '2026-05-29T00:00:00.000Z',
      assets: [
        { name: 'Aanya', assetId: 'a-1', assetUri: 'Asset://aanya-uri', intlAssetUri: 'asset://aanya-uri' },
        { name: 'Vikram', assetId: 'a-2', assetUri: 'Asset://vikram-uri', intlAssetUri: 'asset://vikram-uri' },
      ],
    };
    await writeFile(
      join(root, 'projects', slug, 'artifacts', 'seedance-assets.json'),
      `${JSON.stringify(assetsArtifact, null, 2)}\n`,
    );

    const payload = await buildExecutionPayload(slug, seedancePlan(slug), root);
    const sceneA = payload.tasks.find((task) => task.sceneIndex === 0);
    const sceneB = payload.tasks.find((task) => task.sceneIndex === 1);
    assert.deepEqual(sceneA?.referencePaths, ['Asset://aanya-uri']);
    assert.deepEqual(sceneB?.referencePaths, ['Asset://vikram-uri']);
  });

  it('omits cast names that do not resolve to an Asset:// URI', async () => {
    const slug = 'partial-resolve';
    const root = await mkdtemp(join(tmpdir(), 'vclaw-exec-assets-'));
    await seedProject(root, slug, [
      { sceneIndex: 0, description: 'Scene A', characters: ['Aanya', 'Ghost'] },
    ]);
    const assetsArtifact = {
      schemaVersion: 1,
      projectSlug: slug,
      groupName: `${slug}-cast`,
      generatedAt: '2026-05-29T00:00:00.000Z',
      assets: [
        { name: 'Aanya', assetId: 'a-1', assetUri: 'Asset://aanya-uri', intlAssetUri: 'asset://aanya-uri' },
      ],
    };
    await writeFile(
      join(root, 'projects', slug, 'artifacts', 'seedance-assets.json'),
      `${JSON.stringify(assetsArtifact, null, 2)}\n`,
    );

    const payload = await buildExecutionPayload(slug, seedancePlan(slug), root);
    const sceneA = payload.tasks.find((task) => task.sceneIndex === 0);
    assert.deepEqual(sceneA?.referencePaths, ['Asset://aanya-uri']);
  });

  it('leaves referencePaths unchanged when seedance-assets.json is absent (no regression)', async () => {
    const slug = 'no-assets';
    const root = await mkdtemp(join(tmpdir(), 'vclaw-exec-assets-'));
    await seedProject(root, slug, [
      { sceneIndex: 0, description: 'Scene A', characters: ['Aanya'] },
      { sceneIndex: 1, description: 'Scene B', characters: ['Vikram'] },
    ]);

    const payload = await buildExecutionPayload(slug, seedancePlan(slug), root);
    for (const task of payload.tasks) {
      assert.deepEqual(task.referencePaths, []);
    }
  });
});
