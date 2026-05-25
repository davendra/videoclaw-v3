import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportProjectToObsidian } from '../video/obsidian-export.js';
import {
  ensureProjectWorkspace,
  writeProjectManifest,
} from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';
import { writeArtifact } from '../video/artifact-store.js';
import {
  createBriefArtifact,
  createReviewReportArtifact,
  createStoryboardArtifact,
} from '../video/artifacts.js';

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
      { sceneIndex: 0, description: 'Open on the plaza.', characters: ['Nova'] },
      { sceneIndex: 1, description: 'Cut to the rooftop.' },
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

function seedCandidatesWithSelection(root: string, slug: string): void {
  const artifactsDir = join(root, 'projects', slug, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(
    join(artifactsDir, 'scene-candidates.json'),
    JSON.stringify({
      schemaVersion: 1,
      scenes: [
        {
          sceneIndex: 0,
          candidates: [
            {
              id: 'scene-0-take-1',
              generationRound: 1,
              prompt: 'Open on the plaza.',
              route: 'seedance-direct',
              submittedAt: '2026-04-22T00:00:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'video', path: '/tmp/s0.mp4' }],
              source: { executionRound: 1, adapter: 'builtin', chainedFromCandidateId: null },
            },
          ],
        },
        {
          sceneIndex: 1,
          candidates: [
            {
              id: 'scene-1-take-1',
              generationRound: 1,
              prompt: 'Cut to the rooftop.',
              route: 'seedance-direct',
              submittedAt: '2026-04-22T00:00:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'video', path: '/tmp/s1.mp4' }],
              source: { executionRound: 1, adapter: 'builtin', chainedFromCandidateId: null },
            },
          ],
        },
      ],
    }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(artifactsDir, 'scene-selection.json'),
    JSON.stringify({
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
        {
          sceneIndex: 1,
          selectedCandidateId: null,
          rejectedCandidateIds: [],
          pendingCandidateIds: [],
          rerollRequested: true,
          chainFromPrev: true,
        },
      ],
    }, null, 2),
    'utf8',
  );
}

test('exportProjectToObsidian writes per-scene notes at <slug>/Scenes/<i>.md when candidates exist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task15-'));
  await seedMinimalProject(root);
  seedCandidatesWithSelection(root, 'demo');

  const outputDir = join(root, 'vault', 'Projects');
  const result = await exportProjectToObsidian('demo', { root, outputDir, productionMode: 'director' });
  assert.equal(result.sceneNotePaths.length, 2);
  const scene0Path = join(outputDir, 'demo', 'Scenes', '0.md');
  const scene1Path = join(outputDir, 'demo', 'Scenes', '1.md');
  assert.equal(existsSync(scene0Path), true);
  assert.equal(existsSync(scene1Path), true);
  const s0 = readFileSync(scene0Path, 'utf8');
  assert.match(s0, /# Scene 0/);
  assert.match(s0, /scene-0-take-1/);
  assert.match(s0, /\/tmp\/s0\.mp4/);
  assert.match(s0, /Selected candidate: `scene-0-take-1`/);
  assert.match(s0, /Open on the plaza\./);
  const s1 = readFileSync(scene1Path, 'utf8');
  assert.match(s1, /Reroll requested: yes/);
  assert.match(s1, /Chain from previous scene: yes/);
});

test('exportProjectToObsidian writes sceneSelectionCoverage and sceneCandidatesTotal in project frontmatter', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task15-frontmatter-'));
  await seedMinimalProject(root);
  seedCandidatesWithSelection(root, 'demo');

  const outputDir = join(root, 'vault', 'Projects');
  const result = await exportProjectToObsidian('demo', { root, outputDir, productionMode: 'director' });
  const note = readFileSync(result.outputPath, 'utf8');
  assert.match(note, /sceneSelectionCoverage: "1\/2"/);
  assert.match(note, /sceneCandidatesTotal: 2/);
});

test('exportProjectToObsidian emits no per-scene notes on legacy projects with no candidates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task15-legacy-'));
  await seedMinimalProject(root);
  const outputDir = join(root, 'vault', 'Projects');
  const result = await exportProjectToObsidian('demo', { root, outputDir, productionMode: 'director' });
  assert.equal(result.sceneNotePaths.length, 0);
  assert.equal(existsSync(join(outputDir, 'demo', 'Scenes')), false);
});

test('exportProjectToObsidian keeps legacy published projects in needs-review when review truth is not publish-ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task15-legacy-published-review-'));
  await seedMinimalProject(root);
  const workspace = await ensureProjectWorkspace('demo', root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug: 'demo',
    productionMode: 'director',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('director'),
    currentStage: 'complete',
    lastCompletedStage: 'publish',
    lastCheckpointStatus: 'completed',
  });
  const reviewReportPath = await writeArtifact(workspace, 'review-report', createReviewReportArtifact({
    projectSlug: 'demo',
    verdict: 'pass',
  }));
  const publishReportPath = await writeArtifact(workspace, 'publish-report', {
    projectSlug: 'demo',
    status: 'published',
    finalOutputPath: '/tmp/demo-final.mp4',
    notes: [],
  });
  await writeStageCheckpoint(workspace, {
    stage: 'review',
    status: 'completed',
    generatedAt: now,
    artifacts: { 'review-report': reviewReportPath },
    summary: 'legacy review pass without publish-ready metric',
    issues: [],
    nextAction: 'Ready for publish handoff.',
  });
  await writeStageCheckpoint(workspace, {
    stage: 'publish',
    status: 'completed',
    generatedAt: now,
    artifacts: { 'publish-report': publishReportPath },
    summary: 'legacy publish checkpoint',
    issues: [],
    nextAction: 'Project complete.',
  });

  const outputDir = join(root, 'vault', 'Projects');
  const result = await exportProjectToObsidian('demo', { root, outputDir, productionMode: 'director' });
  const note = readFileSync(result.outputPath, 'utf8');
  assert.match(note, /ops_status: "needs-review"/);
  assert.match(note, /review_publish_ready: false/);
});

test('exportProjectToObsidian uses canonical needs-review status for legacy import drift', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-task15-legacy-drift-'));
  await seedMinimalProject(root);
  const workspace = await ensureProjectWorkspace('demo', root);
  mkdirSync(join(workspace.stateDir), { recursive: true });
  writeFileSync(
    join(workspace.stateDir, 'legacy-import-summary.json'),
    JSON.stringify({
      sourcePath: '/tmp/legacy-demo',
      importedAt: '2026-04-21T10:00:00.000Z',
      imageCount: 1,
      videoCount: 0,
      finalCount: 0,
      telemetryCount: 0,
      manifestPresent: true,
      queueFilePresent: true,
      queueStatusMismatch: true,
      nestedOutputRootDetected: false,
    }, null, 2),
    'utf8',
  );

  const outputDir = join(root, 'vault', 'Projects');
  const result = await exportProjectToObsidian('demo', { root, outputDir, productionMode: 'director' });
  const note = readFileSync(result.outputPath, 'utf8');
  assert.match(note, /ops_status: "needs-review"/);
  assert.match(note, /legacy_import_queue_status_mismatch: true/);
});
