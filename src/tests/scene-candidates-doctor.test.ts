import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorProject } from '../video/doctor.js';
import { doctorPortfolio } from '../video/doctor-portfolio.js';
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
    candidates: Array<{
      id: string;
      generationRound: number;
      status: CandStatus;
      outputs?: Array<{ kind: 'video' | 'audio' | 'image'; path: string }>;
      chainedFromCandidateId?: string | null;
    }>;
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
          prompt: `s${scene.sceneIndex}`,
          route: 'seedance-direct',
          submittedAt: '2026-04-22T00:00:00.000Z',
          status: c.status,
          outputs: c.outputs ?? [],
          source: {
            executionRound: c.generationRound,
            adapter: 'builtin' as const,
            chainedFromCandidateId: c.chainedFromCandidateId ?? null,
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
  scenes: Array<{
    sceneIndex: number;
    selectedCandidateId?: string | null;
    rejectedCandidateIds?: string[];
    rerollRequested?: boolean;
  }>,
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
        rejectedCandidateIds: s.rejectedCandidateIds ?? [],
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
      { sceneIndex: 0, description: 'Zero' },
      { sceneIndex: 1, description: 'One' },
      { sceneIndex: 2, description: 'Two' },
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

test('doctorProject emits scene-selection-missing for a scene with a completed candidate and no selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task16-missing-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 2,
      candidates: [{ id: 'scene-2-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 2, selectedCandidateId: null }]);

  const report = await doctorProject('demo', root, 'director');
  assert.ok(
    report.issues.some((i) => i.message.startsWith('scene-selection-missing:') && i.message.includes('scene 2')),
    `expected scene-selection-missing, got: ${report.issues.map((i) => i.message).join(' | ')}`,
  );
});

test('doctorProject emits scene-selection-stale when the selected candidate output file is missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task16-stale-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        {
          id: 'scene-0-take-1',
          generationRound: 1,
          status: 'completed',
          outputs: [{ kind: 'video', path: '/tmp/definitely-does-not-exist-xyz.mp4' }],
        },
      ],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 0, selectedCandidateId: 'scene-0-take-1' }]);

  const report = await doctorProject('demo', root, 'director');
  assert.ok(
    report.issues.some((i) => i.message.startsWith('scene-selection-stale:')),
    `expected scene-selection-stale, got: ${report.issues.map((i) => i.message).join(' | ')}`,
  );
});

test('doctorProject accepts remote selected candidate outputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task16-remote-output-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        {
          id: 'scene-0-take-1',
          generationRound: 1,
          status: 'completed',
          outputs: [{ kind: 'image', path: 'https://cdn.vclaw.local/scene-0.jpg' }],
        },
      ],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 0, selectedCandidateId: 'scene-0-take-1' }]);

  const report = await doctorProject('demo', root, 'director');
  assert.ok(
    !report.issues.some((i) => i.message.startsWith('scene-selection-stale:')),
    `expected no scene-selection-stale, got: ${report.issues.map((i) => i.message).join(' | ')}`,
  );
});

test('doctorProject emits scene-reroll-pending when rerollRequested is set and no newer candidate exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task16-reroll-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 1,
      candidates: [{ id: 'scene-1-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 1, selectedCandidateId: null, rerollRequested: true }]);

  const report = await doctorProject('demo', root, 'director');
  assert.ok(
    report.issues.some((i) => i.message.startsWith('scene-reroll-pending:') && i.message.includes('scene 1')),
    `expected scene-reroll-pending, got: ${report.issues.map((i) => i.message).join(' | ')}`,
  );
});

test('doctorProject emits scene-chain-upstream-stale when a selected candidate chains from a rejected upstream', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task16-chain-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
    {
      sceneIndex: 1,
      candidates: [
        {
          id: 'scene-1-take-1',
          generationRound: 1,
          status: 'completed',
          chainedFromCandidateId: 'scene-0-take-1',
        },
      ],
    },
  ]);
  seedSelection(root, 'demo', [
    { sceneIndex: 0, selectedCandidateId: null, rejectedCandidateIds: ['scene-0-take-1'] },
    { sceneIndex: 1, selectedCandidateId: 'scene-1-take-1' },
  ]);

  const report = await doctorProject('demo', root, 'director');
  assert.ok(
    report.issues.some((i) => i.message.startsWith('scene-chain-upstream-stale:') && i.message.includes('scene 1')),
    `expected scene-chain-upstream-stale, got: ${report.issues.map((i) => i.message).join(' | ')}`,
  );
});

test('doctorPortfolio aggregates scene-candidates counters across projects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task16-portfolio-'));
  await seedMinimalProject(root, 'alpha');
  seedCandidates(root, 'alpha', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);
  seedSelection(root, 'alpha', [{ sceneIndex: 0, selectedCandidateId: null }]);

  const report = await doctorPortfolio(root, 'director');
  assert.ok(report.sceneCandidates, 'expected sceneCandidates summary');
  assert.equal(report.sceneCandidates.projectsWithCandidates, 1);
  assert.equal(report.sceneCandidates.projectsWithMissingSelection, 1);
});
