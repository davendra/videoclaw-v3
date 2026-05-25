import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { appendProjectEvent } from '../video/events.js';
import { buildProjectStatusReport } from '../video/status.js';
import { ensureProjectWorkspace } from '../video/workspace.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';

describe('buildProjectStatusReport', () => {
  it('reports pending brief stage for a missing project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const report = await buildProjectStatusReport('missing-project', root);
      assert.equal(report.projectExists, false);
      assert.equal(report.nextStage, 'brief');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports completed and pending stages for an initialized project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      await writeStageCheckpoint(workspace, {
        stage: 'brief',
        status: 'completed',
        generatedAt: new Date().toISOString(),
        artifacts: {},
        summary: 'brief done',
        issues: [],
      });

      const report = await buildProjectStatusReport('launch-teaser', root);
      assert.equal(report.projectExists, true);
      assert.deepEqual(report.completedStages, ['brief']);
      assert.equal(report.nextStage, 'storyboard');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes stale publish-handoff text on retry review checkpoints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('review-truth', root);
      await writeFile(
        join(workspace.artifactsDir, 'review-report.json'),
        JSON.stringify({
          projectSlug: 'review-truth',
          verdict: 'retry',
          findings: ['Missing artifact-backed 4k/upscaled still assets: 4.'],
          metrics: {
            publishReady: false,
            nextAction: 'Attach artifact-backed 4k/upscaled stills for 4 scene(s).',
          },
        }, null, 2),
      );
      await writeStageCheckpoint(workspace, {
        stage: 'review',
        status: 'retry-required',
        generatedAt: new Date().toISOString(),
        artifacts: { 'review-report': join(workspace.artifactsDir, 'review-report.json') },
        summary: 'review needs retry',
        issues: ['Missing 4k stills'],
        nextAction: 'Ready for publish handoff.',
      });

      const report = await buildProjectStatusReport('review-truth', root);
      const reviewCheckpoint = report.checkpoints.find((checkpoint) => checkpoint.stage === 'review');
      assert.equal(reviewCheckpoint?.status, 'retry-required');
      assert.equal(reviewCheckpoint?.nextAction, 'Attach artifact-backed 4k/upscaled stills for 4 scene(s).');
      assert.equal(report.reviewReportVerdict, 'retry');
      assert.equal(report.reviewPublishReady, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes execution profile and prompt guidance when artifacts exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Launch Teaser',
        intent: 'Intent',
        productionMode: 'storyboard',
        metadata: {
          targetRuntimeSeconds: 90,
          clipDurationSeconds: 10,
          genre: 'sci-fi',
          platform: 'tiktok',
          style: 'villeneuve',
          colorGrading: 'neon-noir',
          executionProfile: {
            aspectRatio: '9:16',
            quality: 'quality',
            resolution: '1080p',
            generateAudio: false,
            outputCount: 2,
          },
        },
      }));
      await writeFile(
        join(root, 'projects', 'launch-teaser', 'artifacts', 'execution-plan.json'),
        JSON.stringify({
          promptGuidance: [
            { name: 'seedance-ugc-formulas', reason: 'Seedance route selected.', category: 'provider' },
          ],
        }, null, 2),
      );

      const report = await buildProjectStatusReport('launch-teaser', root);
      assert.equal(report.targetRuntimeSeconds, 90);
      assert.equal(report.clipDurationSeconds, 10);
      assert.equal(report.genre, 'sci-fi');
      assert.equal(report.platform, 'tiktok');
      assert.equal(report.style, 'villeneuve');
      assert.equal(report.colorGrading, 'neon-noir');
      assert.equal(report.executionProfile?.aspectRatio, '9:16');
      assert.equal(report.executionProfile?.quality, 'quality');
      assert.equal(report.promptGuidance?.[0]?.name, 'seedance-ugc-formulas');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes legacy import diagnostics when a legacy summary exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('legacy-alpha', root);
      await writeFile(
        join(workspace.stateDir, 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/legacy-alpha',
          importedAt: '2026-04-21T10:00:00.000Z',
          imageCount: 1,
          videoCount: 0,
          finalCount: 0,
          telemetryCount: 0,
          manifestPresent: true,
          queueFilePresent: true,
          queuePendingStatusDetected: true,
          queueStatusMismatch: true,
          nestedVideoCount: 1,
          nestedFinalCount: 0,
          nestedOutputRootDetected: true,
          inferredCurrentStage: 'review',
          inferredLastCompletedStage: 'assets',
          inferredCheckpointStatus: 'completed',
        }, null, 2),
      );

      const report = await buildProjectStatusReport('legacy-alpha', root);
      assert.equal(report.legacyImportSummary?.manifestPresent, true);
      assert.equal(report.legacyImportSummary?.queueStatusMismatch, true);
      assert.equal(report.legacyImportSummary?.nestedVideoCount, 1);
      assert.equal(report.legacyImportSummary?.nestedOutputRootDetected, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to imported manifest progress when checkpoints are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('legacy-alpha', root);
      await writeFile(
        join(workspace.manifestPath),
        JSON.stringify({
          slug: 'legacy-alpha',
          productionMode: 'storyboard',
          createdAt: '2026-04-21T10:00:00.000Z',
          updatedAt: '2026-04-21T10:00:00.000Z',
          pipeline: {
            name: 'storyboard',
            version: '1.0.0',
            productionMode: 'storyboard',
            stages: [
              { name: 'brief', produces: ['brief'], checkpointRequired: true, humanApprovalDefault: false, successCriteria: [] },
              { name: 'storyboard', produces: ['storyboard'], checkpointRequired: true, humanApprovalDefault: false, successCriteria: [] },
              { name: 'assets', produces: ['asset-manifest'], checkpointRequired: true, humanApprovalDefault: false, successCriteria: [] },
              { name: 'review', produces: ['review-report'], checkpointRequired: true, humanApprovalDefault: false, successCriteria: [] },
              { name: 'publish', produces: ['publish-report'], checkpointRequired: true, humanApprovalDefault: false, successCriteria: [] },
            ],
          },
          currentStage: 'review',
          lastCompletedStage: 'assets',
          lastCheckpointStatus: 'completed',
          tags: ['legacy-import'],
        }, null, 2),
      );

      const report = await buildProjectStatusReport('legacy-alpha', root);
      assert.equal(report.nextStage, 'review');
      assert.deepEqual(report.completedStages, ['brief', 'storyboard', 'assets']);
      assert.deepEqual(report.pendingStages, ['review', 'publish']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes referenced character bindings with stored Go Bananas ids and refs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      await addCharacterProfile(workspace, {
        name: 'Nova',
        goBananasId: 170,
        referenceAssets: ['refs/nova.png'],
      });
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'launch-teaser',
        productionMode: 'director',
        scenes: [{ sceneIndex: 0, description: 'Scene one', characters: ['Nova', 'Mochi'] }],
      }));

      const report = await buildProjectStatusReport('launch-teaser', root, 'director');
      assert.equal(report.characterHydrationSummary?.totalProfiles, 1);
      assert.equal(report.characterHydrationSummary?.explicitCount, 0);
      assert.equal(report.characterHydrationSummary?.importedCount, 0);
      assert.equal(report.characterHydrationSummary?.autoCreatedCount, 0);
      assert.deepEqual(report.characterProfiles, [
        { name: 'Nova', goBananasId: 170, referenceAssets: ['refs/nova.png'] },
      ]);
      assert.deepEqual(report.characterBindings, [
        { name: 'Nova', goBananasId: 170, referenceAssets: ['refs/nova.png'], profileExists: true },
        { name: 'Mochi', referenceAssets: [], profileExists: false },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes storyboard review path when storyboard.md exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      await writeFile(join(workspace.projectDir, 'storyboard.md'), '# Review\n');

      const report = await buildProjectStatusReport('launch-teaser', root, 'director');
      assert.equal(report.storyboardReviewState, 'missing');
      assert.equal(report.storyboardReviewPath, join(workspace.projectDir, 'storyboard.md'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes the latest storyboard review generation timestamp when events exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      await writeFile(join(workspace.projectDir, 'storyboard.md'), '# Review\n');
      await appendProjectEvent(workspace, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T10:00:00.000Z',
        payload: { markdownPath: join(workspace.projectDir, 'storyboard.md') },
      });
      await appendProjectEvent(workspace, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T11:00:00.000Z',
        payload: { markdownPath: join(workspace.projectDir, 'storyboard.md') },
      });

      const report = await buildProjectStatusReport('launch-teaser', root, 'director');
      assert.equal(report.storyboardReviewState, 'current');
      assert.equal(report.storyboardReviewExists, true);
      assert.equal(report.storyboardReviewGeneratedAt, '2026-04-20T11:00:00.000Z');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks storyboard review stale when storyboard changes after the last review generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      await writeFile(join(workspace.projectDir, 'storyboard.md'), '# Review\n');
      await appendProjectEvent(workspace, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T10:00:00.000Z',
        payload: { markdownPath: join(workspace.projectDir, 'storyboard.md') },
      });
      await appendProjectEvent(workspace, {
        type: 'artifact.storyboard.written',
        recordedAt: '2026-04-20T11:00:00.000Z',
        payload: { artifactPath: join(workspace.projectDir, 'artifacts', 'storyboard.json') },
      });

      const report = await buildProjectStatusReport('launch-teaser', root, 'director');
      assert.equal(report.storyboardReviewState, 'stale');
      assert.equal(report.storyboardReviewStale, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('summarizes create-time character hydration sources from stored profile notes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
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
      await addCharacterProfile(workspace, {
        name: 'Mochi',
        goBananasId: 247,
        referenceAssets: ['gobananas://character/247'],
        notes: ['Imported from `video create --gb-character`.'],
      });

      const report = await buildProjectStatusReport('launch-teaser', root, 'director');
      assert.equal(report.characterHydrationSummary?.totalProfiles, 3);
      assert.equal(report.characterHydrationSummary?.explicitCount, 1);
      assert.equal(report.characterHydrationSummary?.importedCount, 1);
      assert.equal(report.characterHydrationSummary?.autoCreatedCount, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('status + reference sheets', () => {
  it('exposes referenceSheets summary when sheets exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-refsheet-'));
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

      const res = spawnSync(process.execPath, [cliPath, 'video', 'status', '--project', 'demo', '--root', root, '--mode', 'director'], { encoding: 'utf-8' });
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout) as { referenceSheets?: { count?: number; byType?: { identity?: number }; boundSceneCount?: number; unboundSheetIds?: string[] } };
      assert.equal(payload.referenceSheets?.count, 1);
      assert.equal(payload.referenceSheets?.byType?.identity, 1);
      assert.equal(payload.referenceSheets?.boundSceneCount, 1);
      assert.deepEqual(payload.referenceSheets?.unboundSheetIds, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('vclaw status cli', () => {
  it('prints project status JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-status-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'launch-teaser', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { slug?: string; nextStage?: string; platform?: string; style?: string; colorGrading?: string; storyboardReviewState?: string; storyboardReviewExists?: boolean; storyboardReviewPath?: string; storyboardReviewGeneratedAt?: string; executionProfile?: { aspectRatio?: string }; characterBindings?: unknown[] };
      assert.equal(payload.slug, 'launch-teaser');
      assert.equal(payload.nextStage, 'brief');
      assert.equal(payload.platform, undefined);
      assert.equal(payload.style, undefined);
      assert.equal(payload.colorGrading, undefined);
      assert.equal(payload.storyboardReviewState, undefined);
      assert.equal(payload.storyboardReviewExists, undefined);
      assert.equal(payload.storyboardReviewPath, undefined);
      assert.equal(payload.storyboardReviewGeneratedAt, undefined);
      assert.equal(payload.executionProfile, undefined);
      assert.equal(payload.characterBindings, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
