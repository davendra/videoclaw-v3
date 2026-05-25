import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addCharacterProfile } from '../video/characters.js';
import {
  createBriefArtifact,
  createReviewReportArtifact,
  createStoryboardArtifact,
} from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';
import { appendProjectEvent } from '../video/events.js';
import { buildProjectIndex } from '../video/project-index.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

describe('buildProjectIndex', () => {
  it('includes storyboard review paths for projects that have storyboard.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-project-index-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'director',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'storyboard',
        lastCompletedStage: 'brief',
        lastCheckpointStatus: 'completed',
      });
      await writeFile(join(workspace.projectDir, 'storyboard.md'), '# Review\n');
      await appendProjectEvent(workspace, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T11:00:00.000Z',
        payload: { markdownPath: join(workspace.projectDir, 'storyboard.md') },
      });
      await appendProjectEvent(workspace, {
        type: 'artifact.storyboard.written',
        recordedAt: '2026-04-20T12:00:00.000Z',
        payload: { artifactPath: join(workspace.projectDir, 'artifacts', 'storyboard.json') },
      });

      const index = await buildProjectIndex(root, 'director');
      assert.equal(index.projects[0]?.storyboardReviewState, 'stale');
      assert.equal(index.projects[0]?.storyboardReviewExists, true);
      assert.equal(index.projects[0]?.storyboardReviewPath, join(workspace.projectDir, 'storyboard.md'));
      assert.equal(index.projects[0]?.storyboardReviewGeneratedAt, '2026-04-20T11:00:00.000Z');
      assert.equal(index.projects[0]?.storyboardReviewStale, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes character profile counts and hydration summary from project status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-project-index-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'director',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'storyboard',
        lastCompletedStage: 'brief',
        lastCheckpointStatus: 'completed',
      });
      await addCharacterProfile(workspace, {
        name: 'Komo',
        goBananasId: 170,
        referenceAssets: ['gobananas://character/170'],
        notes: ['Imported from `video create --import-library-characters`.'],
      });
      await addCharacterProfile(workspace, {
        name: 'Nova',
        goBananasId: 555,
        referenceAssets: ['gobananas://character/555'],
        notes: ['Created via `video create --auto-create-characters`.'],
      });

      const index = await buildProjectIndex(root, 'director');
      assert.equal(index.projects[0]?.characterProfileCount, 2);
      assert.deepEqual(index.projects[0]?.characterHydrationSummary, {
        totalProfiles: 2,
        explicitCount: 0,
        importedCount: 1,
        autoCreatedCount: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exposes referenceSheets summary per project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-project-index-refsheet-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      assert.equal(spawnSync(process.execPath, [cliPath, 'video', 'init', 'demo', '--root', root, '--mode', 'director'], { encoding: 'utf-8' }).status, 0);
      assert.equal(spawnSync(process.execPath, [
        cliPath, 'video', 'reference-sheet-add',
        '--project', 'demo', '--root', root,
        '--type', 'identity', '--name', 'Lead',
        '--ref', 'refs/a.png:identity',
        '--binding', '0',
      ], { encoding: 'utf-8' }).status, 0);

      const index = await buildProjectIndex(root, 'director');
      assert.equal(index.projects[0]?.referenceSheets?.count, 1);
      assert.equal(index.projects[0]?.referenceSheets?.byType?.identity, 1);
      assert.equal(index.projects[0]?.referenceSheets?.boundSceneCount, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks completed reviews without publishReady truth as needs-review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-project-index-review-ready-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'publish',
        lastCompletedStage: 'review',
        lastCheckpointStatus: 'completed',
      });
      const briefPath = await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Legacy published project.',
        productionMode: 'storyboard',
      }));
      const storyboardPath = await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Open.' }],
      }));
      const assetManifestPath = await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'scene-0', kind: 'video', path: '/tmp/scene-0.mp4', sceneIndex: 0 }],
      });
      const reviewReportPath = await writeArtifact(workspace, 'review-report', createReviewReportArtifact({
        projectSlug: 'alpha',
        verdict: 'pass',
      }));
      await writeStageCheckpoint(workspace, {
        stage: 'brief',
        status: 'completed',
        generatedAt: now,
        artifacts: { brief: briefPath },
        summary: 'brief done',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'storyboard',
        status: 'completed',
        generatedAt: now,
        artifacts: { storyboard: storyboardPath },
        summary: 'storyboard done',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'assets',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'asset-manifest': assetManifestPath },
        summary: 'assets done',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'review',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'review-report': reviewReportPath },
        summary: 'legacy pass without publish-ready metric',
        issues: [],
        nextAction: 'Ready for publish handoff.',
      });

      const index = await buildProjectIndex(root);
      assert.equal(index.projects[0]?.opsStatus, 'needs-review');
      assert.equal(index.projects[0]?.reviewReportVerdict, 'pass');
      assert.equal(index.projects[0]?.reviewPublishReady, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps legacy published projects in needs-review when review truth is not publish-ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-project-index-published-review-ready-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'complete',
        lastCompletedStage: 'publish',
        lastCheckpointStatus: 'completed',
      });
      const briefPath = await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Legacy published project.',
        productionMode: 'storyboard',
      }));
      const storyboardPath = await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Open.' }],
      }));
      const assetManifestPath = await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'scene-0', kind: 'video', path: '/tmp/scene-0.mp4', sceneIndex: 0 }],
      });
      const reviewReportPath = await writeArtifact(workspace, 'review-report', createReviewReportArtifact({
        projectSlug: 'alpha',
        verdict: 'pass',
      }));
      const publishReportPath = await writeArtifact(workspace, 'publish-report', {
        projectSlug: 'alpha',
        status: 'published',
        finalOutputPath: '/tmp/final.mp4',
        notes: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'brief',
        status: 'completed',
        generatedAt: now,
        artifacts: { brief: briefPath },
        summary: 'brief done',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'storyboard',
        status: 'completed',
        generatedAt: now,
        artifacts: { storyboard: storyboardPath },
        summary: 'storyboard done',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'assets',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'asset-manifest': assetManifestPath },
        summary: 'assets done',
        issues: [],
      });
      await writeStageCheckpoint(workspace, {
        stage: 'review',
        status: 'completed',
        generatedAt: now,
        artifacts: { 'review-report': reviewReportPath },
        summary: 'legacy pass without publish-ready metric',
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

      const index = await buildProjectIndex(root);
      assert.equal(index.projects[0]?.opsStatus, 'needs-review');
      assert.equal(index.projects[0]?.nextStage, null);
      assert.deepEqual(index.projects[0]?.completedStages, ['brief', 'storyboard', 'assets', 'review', 'publish']);
      assert.equal(index.projects[0]?.reviewPublishReady, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
