import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPortfolioReport } from '../video/report.js';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { appendProjectEvent } from '../video/events.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';

describe('buildPortfolioReport', () => {
  it('aggregates metrics, health, index, and timeline in one structure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-'));
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
      await writeArtifact(workspace, 'execution-plan', {
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        operationKind: 'text-to-video',
        executionProfile: {
          aspectRatio: '9:16',
          quality: 'quality',
          resolution: '1080p',
          generateAudio: false,
          outputCount: 2,
        },
        recommendedRouteId: 'seedance-direct',
        ready: true,
        blockers: [],
        rationale: [],
        promptGuidance: [
          { name: 'seedance-ugc-formulas', reason: 'Seedance route selected.', category: 'provider' },
        ],
        generatedAt: now,
      });
      await addCharacterProfile(workspace, {
        name: 'Nova',
        goBananasId: 170,
        referenceAssets: ['refs/nova.png'],
      });
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Scene one', characters: ['Nova'] }],
      }));
      await writeFile(join(workspace.projectDir, 'storyboard.md'), '# Review\n');
      await appendProjectEvent(workspace, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T11:00:00.000Z',
        payload: { markdownPath: join(workspace.projectDir, 'storyboard.md') },
      });
      await appendProjectEvent(workspace, { type: 'artifact.brief.written' });

      const report = await buildPortfolioReport(root);
      assert.equal(report.index.projects.length, 1);
      assert.equal(report.metrics.totalProjects, 1);
      assert.equal(report.health.totalProjects, 1);
      assert.equal(report.timeline.length, 2);
      assert.ok(report.timeline.some((event) => event.type === 'storyboard.review.generated'));
      assert.equal(report.index.projects[0]?.executionProfile?.aspectRatio, '9:16');
      assert.deepEqual(report.index.projects[0]?.promptGuidance, ['seedance-ugc-formulas']);
      assert.deepEqual(report.index.projects[0]?.characterBindings, [
        { name: 'Nova', goBananasId: 170, referenceAssets: ['refs/nova.png'], profileExists: true },
      ]);
      assert.equal(report.index.projects[0]?.storyboardReviewState, 'current');
      assert.equal(report.index.projects[0]?.storyboardReviewExists, true);
      assert.equal(report.index.projects[0]?.storyboardReviewPath, join(workspace.projectDir, 'storyboard.md'));
      assert.equal(report.index.projects[0]?.storyboardReviewGeneratedAt, '2026-04-20T11:00:00.000Z');
      assert.equal(report.index.projects[0]?.storyboardReviewStale, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes per-project referenceSheets summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-refsheet-'));
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

      const report = await buildPortfolioReport(root, 'director');
      assert.equal(report.index.projects[0]?.referenceSheets?.count, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
