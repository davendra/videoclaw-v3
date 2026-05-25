import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectReadiness } from '../video/readiness.js';
import { assertStageReady } from '../video/stage-guards.js';
import {
  ensureProjectWorkspace,
  writeProjectManifest,
} from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';
import { writeArtifact } from '../video/artifact-store.js';
import {
  createBriefArtifact,
  createStoryboardArtifact,
} from '../video/artifacts.js';

type CandStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

function seedCandidates(
  root: string,
  slug: string,
  scenes: Array<{
    sceneIndex: number;
    candidates: Array<{ id: string; generationRound: number; status: CandStatus }>;
  }>,
): void {
  const artifactsDir = join(root, 'projects', slug, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    join(artifactsDir, 'scene-candidates.json'),
    JSON.stringify({
      schemaVersion: 1,
      scenes: scenes.map((scene) => ({
        sceneIndex: scene.sceneIndex,
        candidates: scene.candidates.map((c) => ({
          id: c.id,
          generationRound: c.generationRound,
          prompt: `scene ${scene.sceneIndex}`,
          route: 'seedance-direct',
          submittedAt: '2026-04-22T00:00:00.000Z',
          status: c.status,
          outputs: [],
          source: {
            executionRound: c.generationRound,
            adapter: 'builtin' as const,
            chainedFromCandidateId: null,
          },
        })),
      })),
    }, null, 2),
    'utf8',
  );
}

function seedSelection(
  root: string,
  slug: string,
  scenes: Array<{ sceneIndex: number; selectedCandidateId?: string | null; rerollRequested?: boolean }>,
): void {
  const artifactsDir = join(root, 'projects', slug, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    join(artifactsDir, 'scene-selection.json'),
    JSON.stringify({
      schemaVersion: 1,
      scenes: scenes.map((s) => ({
        sceneIndex: s.sceneIndex,
        selectedCandidateId: s.selectedCandidateId ?? null,
        rejectedCandidateIds: [],
        pendingCandidateIds: [],
        rerollRequested: s.rerollRequested ?? false,
        chainFromPrev: false,
      })),
    }, null, 2),
    'utf8',
  );
}

async function seedMinimalProject(root: string, slug = 'demo'): Promise<void> {
  const workspace = await ensureProjectWorkspace(slug, root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug,
    productionMode: 'director',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('director'),
    currentStage: 'assets',
    lastCompletedStage: 'assets',
    lastCheckpointStatus: 'completed',
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Demo',
    intent: 'x',
    productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: slug,
    productionMode: 'director',
    scenes: [
      { sceneIndex: 0, description: 'Scene zero.' },
      { sceneIndex: 1, description: 'Scene one.' },
    ],
  }));
  await writeArtifact(workspace, 'asset-manifest', { projectSlug: slug, assets: [] });
  for (const stage of ['brief', 'storyboard', 'assets'] as const) {
    const artifactName = stage === 'assets' ? 'asset-manifest' : stage;
    await writeStageCheckpoint(workspace, {
      stage,
      status: 'completed',
      generatedAt: now,
      artifacts: { [artifactName]: join(workspace.artifactsDir, `${artifactName}.json`) },
      summary: `${stage} done`,
      issues: [],
    });
  }
}

test('readiness flags scene-selection-missing when a scene has a completed candidate but no selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task12-readiness-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        { id: 'scene-0-take-1', generationRound: 1, status: 'completed' },
        { id: 'scene-0-take-2', generationRound: 2, status: 'completed' },
      ],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 0, selectedCandidateId: null }]);

  const readiness = await buildProjectReadiness('demo', root, 'director');
  assert.ok(
    readiness.blockers.some((b) => b.startsWith('scene-selection-missing:')),
    `expected scene-selection-missing blocker, got: ${readiness.blockers.join(' | ')}`,
  );
  assert.equal(readiness.ready, false);
});

test('readiness does NOT flag scene-selection-missing on legacy projects with no scene-candidates.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task12-legacy-'));
  await seedMinimalProject(root);
  const readiness = await buildProjectReadiness('demo', root, 'director');
  assert.equal(
    readiness.blockers.some((b) => b.startsWith('scene-selection-missing:')),
    false,
  );
});

test('readiness does NOT flag scene-selection-missing when all candidates are pending (in-flight)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task12-pending-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'pending' }],
    },
  ]);
  const readiness = await buildProjectReadiness('demo', root, 'director');
  assert.equal(
    readiness.blockers.some((b) => b.startsWith('scene-selection-missing:')),
    false,
  );
});

test('readiness does NOT flag scene-selection-missing when reroll is requested for the scene', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task12-reroll-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 0, selectedCandidateId: null, rerollRequested: true }]);
  const readiness = await buildProjectReadiness('demo', root, 'director');
  assert.equal(
    readiness.blockers.some((b) => b.startsWith('scene-selection-missing:')),
    false,
  );
});

test('assertStageReady("review") hard-fails with scene-selection-missing when a scene has no selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task12-stage-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 0, selectedCandidateId: null }]);

  const workspace = await ensureProjectWorkspace('demo', root);
  await assert.rejects(
    () => assertStageReady(workspace, 'director', 'review'),
    /scene-selection-missing/,
  );
});

test('assertStageReady("review") passes on legacy projects with no scene-candidates.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task12-stage-legacy-'));
  await seedMinimalProject(root);
  const workspace = await ensureProjectWorkspace('demo', root);
  // Should not throw.
  await assertStageReady(workspace, 'director', 'review');
});
