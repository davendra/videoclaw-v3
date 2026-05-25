import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildProjectStatusReport } from '../video/status.js';
import { buildProjectIndex } from '../video/project-index.js';
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

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

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
          prompt: `s${scene.sceneIndex}`,
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
    scenes: [{ sceneIndex: 0, description: 'Zero' }, { sceneIndex: 1, description: 'One' }],
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

test('buildProjectStatusReport exposes sceneSelection summary with the expected counts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task13-status-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        { id: 'scene-0-take-1', generationRound: 1, status: 'completed' },
        { id: 'scene-0-take-2', generationRound: 2, status: 'completed' },
      ],
    },
    {
      sceneIndex: 1,
      candidates: [{ id: 'scene-1-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);
  seedSelection(root, 'demo', [
    { sceneIndex: 0, selectedCandidateId: 'scene-0-take-1', rejectedCandidateIds: ['scene-0-take-2'] },
    { sceneIndex: 1, selectedCandidateId: null, rerollRequested: true },
  ]);

  const status = await buildProjectStatusReport('demo', root, 'director');
  assert.deepEqual(status.sceneSelection, {
    sceneCount: 2,
    withSelection: 1,
    withPending: 0,
    withReroll: 1,
    totalCandidates: 3,
    rejectedCount: 1,
  });
});

test('buildProjectStatusReport returns zeroed sceneSelection on legacy projects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task13-legacy-'));
  await seedMinimalProject(root);
  const status = await buildProjectStatusReport('demo', root, 'director');
  assert.deepEqual(status.sceneSelection, {
    sceneCount: 0,
    withSelection: 0,
    withPending: 0,
    withReroll: 0,
    totalCandidates: 0,
    rejectedCount: 0,
  });
});

test('buildProjectIndex propagates sceneSelection onto each project entry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task13-index-'));
  await seedMinimalProject(root);
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [{ id: 'scene-0-take-1', generationRound: 1, status: 'completed' }],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 0, selectedCandidateId: 'scene-0-take-1' }]);

  const index = await buildProjectIndex(root, 'director');
  assert.equal(index.projects[0]?.sceneSelection?.sceneCount, 1);
  assert.equal(index.projects[0]?.sceneSelection?.withSelection, 1);
  assert.equal(index.projects[0]?.sceneSelection?.totalCandidates, 1);
});

test('export-csv writes scene_selection_with_selection and scene_candidates_total columns', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task13-csv-'));
  assert.equal(
    spawnSync('node', [CLI, 'video', 'init', 'demo', '--root', root, '--mode', 'director'], { encoding: 'utf8' }).status,
    0,
  );
  seedCandidates(root, 'demo', [
    {
      sceneIndex: 0,
      candidates: [
        { id: 'scene-0-take-1', generationRound: 1, status: 'completed' },
        { id: 'scene-0-take-2', generationRound: 2, status: 'completed' },
      ],
    },
  ]);
  seedSelection(root, 'demo', [{ sceneIndex: 0, selectedCandidateId: 'scene-0-take-1' }]);

  const outputDir = join(root, 'exports');
  const res = spawnSync(
    'node',
    [CLI, 'video', 'export-csv', '--root', root, '--output-dir', outputDir],
    { encoding: 'utf8' },
  );
  assert.equal(res.status, 0, res.stderr);
  const payload = JSON.parse(res.stdout) as { projectsCsvPath?: string };
  const csv = readFileSync(payload.projectsCsvPath!, 'utf8');
  assert.match(csv, /scene_selection_with_selection,scene_candidates_total/);
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',');
  const row = lines[1].split(',');
  assert.equal(row[header.indexOf('scene_selection_with_selection')], '1');
  assert.equal(row[header.indexOf('scene_candidates_total')], '2');
});

