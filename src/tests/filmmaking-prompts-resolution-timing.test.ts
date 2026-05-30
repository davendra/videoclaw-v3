import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import { buildExecutionPayload } from '../video/execution-runtime.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import type { VideoExecutionPlan } from '../video/types.js';

// Resolution, duration, and the scene-timing/timeline block are OUTPUT-DEPENDENT
// PARAMETERS, not fixed: some renders need a multi-beat timeline, others are a
// single kinetic shot (no timeline); resolution/duration vary per render. These
// tests prove the option toggles the timeline and that resolution/duration flow
// through both the packet builder and the execution payload.

async function setupProject(slug: string, root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace(slug, root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug,
    productionMode: 'director',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('director'),
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  await addCharacterProfile(workspace, {
    name: 'Meera',
    description: 'late twenties Indian woman, athletic build, sharp brown eyes, charcoal tactical jacket',
    referenceAssets: ['characters/meera-sheet.jpg'],
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Timing Probe', intent: 'A tactical scene.', productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: slug, productionMode: 'director',
    scenes: [{
      sceneIndex: 0,
      description: 'Meera advances through smoke',
      characters: ['Meera'],
      durationSeconds: 8,
      scenePrompt: { animationPrompt: 'Meera steps through smoke.' },
    }],
  }));
}

function seedancePlan(slug: string): VideoExecutionPlan {
  return {
    projectSlug: slug,
    productionMode: 'director',
    operationKind: 'generate',
    recommendedRouteId: 'seedance-direct',
    executionProfile: 'native',
    promptGuidance: [],
  } as unknown as VideoExecutionPlan;
}

describe('filmmaking prompt resolution/duration/timeline output-dependent params', () => {
  it('default output is byte-stable: no timeline, no resolution field on packets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-restime-default-'));
    await setupProject('default-p', root);
    const result = await generateFilmmakingPrompts({ root, projectSlug: 'default-p' });
    const packet = result.artifact.seedancePackets[0];
    assert.ok(packet);
    assert.equal(packet?.timeline, undefined);
    assert.equal(packet?.resolution, undefined);
    // Per-scene duration still flows by default (already output-dependent).
    assert.equal(packet?.durationSeconds, 8);
  });

  it('emits a multi-beat timeline when timeline is opted in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-restime-multibeat-'));
    await setupProject('multibeat-p', root);
    const result = await generateFilmmakingPrompts({ root, projectSlug: 'multibeat-p', timeline: true });
    const packet = result.artifact.seedancePackets[0];
    assert.ok(packet?.timeline, 'expected a populated timeline block');
    assert.equal(packet?.timeline?.length, 3);
    for (const beat of packet?.timeline ?? []) {
      assert.match(beat.t, /\d/);
      assert.ok(beat.beat.length > 0);
    }
  });

  it('omits the timeline entirely for a single kinetic shot (singleShot wins over timeline)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-restime-single-'));
    await setupProject('single-p', root);
    // Even when timeline is requested, singleShot forces a no-timeline render.
    const result = await generateFilmmakingPrompts({
      root, projectSlug: 'single-p', singleShot: true, timeline: true,
    });
    const packet = result.artifact.seedancePackets[0];
    assert.ok(packet);
    assert.equal(packet?.timeline, undefined);
  });

  it('threads resolution and duration through the packet (output-dependent, not fixed)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-restime-thread-'));
    await setupProject('thread-p', root);
    const result = await generateFilmmakingPrompts({
      root, projectSlug: 'thread-p', resolution: '1080p', durationSeconds: 12,
    });
    const packet = result.artifact.seedancePackets[0];
    assert.equal(packet?.resolution, '1080p');
    // The scene's own durationSeconds still wins per-render where present.
    assert.equal(packet?.durationSeconds, 8);
  });

  it('flows packet resolution + duration through buildExecutionPayload to the task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-restime-payload-'));
    await setupProject('payload-p', root);
    // A ready prompt packet needs a ready storyboard-grid reference path.
    await generateFilmmakingPrompts({
      root, projectSlug: 'payload-p', resolution: '1080p',
      storyboardGridPath: 'assets/storyboard-grid.png', write: true,
    });
    const payload = await buildExecutionPayload('payload-p', seedancePlan('payload-p'), root);
    const task = payload.tasks.find((t) => t.sceneIndex === 0);
    assert.ok(task);
    assert.equal(task?.resolution, '1080p');
    assert.equal(task?.durationSeconds, 8);
  });
});
