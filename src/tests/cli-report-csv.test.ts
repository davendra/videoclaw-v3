import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBriefArtifact,
  createReviewReportArtifact,
  createStoryboardArtifact,
} from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';
import { exportPortfolioCsv } from '../video/csv-export.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';

describe('vclaw report and export-csv cli', () => {
  it('prints a full portfolio report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'create', 'A lonely astronaut discovers an alien flower on Mars.', '--project', 'alpha', '--root', root, '--production-mode', 'director'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok', '--aspect-ratio', '9:16', '--quality', 'quality', '--resolution', '1080p', '--audio', 'off', '--outputs', '2'],
        ['video', 'create', 'Alpha style pass.', '--project', 'alpha', '--root', root, '--style', 'villeneuve', '--color-grading', 'neon-noir'],
        ['video', 'character-add', '--project', 'alpha', '--root', root, '--name', 'Nova', '--gb-id', '170', '--ref', 'refs/nova.png', '--note', 'Imported from `video create --import-library-characters`.'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one', '--scene-character', '0:Nova'],
        ['video', 'storyboard-review', '--project', 'alpha', '--root', root, '--mode', 'storyboard'],
        ['video', 'execution-plan', '--project', 'alpha', '--root', root],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }
      await writeFile(
        join(root, 'projects', 'alpha', 'state', 'legacy-import-summary.json'),
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

      const reportResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'report', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(reportResult.status, 0);
      const payload = JSON.parse(reportResult.stdout) as {
        metrics?: { totalProjects?: number };
        index?: {
          projects?: Array<{
            targetRuntimeSeconds?: number;
            clipDurationSeconds?: number;
            genre?: string;
            platform?: string;
            style?: string;
            colorGrading?: string;
            legacyImportSummary?: {
              manifestPresent?: boolean;
              queueFilePresent?: boolean;
              queueStatusMismatch?: boolean;
              nestedOutputRootDetected?: boolean;
            };
            executionProfile?: { aspectRatio?: string; quality?: string; resolution?: string; generateAudio?: boolean; outputCount?: number };
            promptGuidance?: string[];
            characterBindings?: Array<{ name?: string; goBananasId?: number }>;
            storyboardReviewState?: string;
            storyboardReviewExists?: boolean;
            storyboardReviewPath?: string;
            storyboardReviewGeneratedAt?: string;
            storyboardReviewStale?: boolean;
          }>;
        };
      };
      assert.equal(payload.metrics?.totalProjects, 1);
      assert.equal(payload.index?.projects?.length, 1);
      assert.equal(payload.index?.projects?.[0]?.targetRuntimeSeconds, undefined);
      assert.equal(payload.index?.projects?.[0]?.clipDurationSeconds, 15);
      assert.equal(payload.index?.projects?.[0]?.genre, 'sci-fi');
      assert.equal(payload.index?.projects?.[0]?.platform, 'tiktok');
      assert.equal(payload.index?.projects?.[0]?.style, 'villeneuve');
      assert.equal(payload.index?.projects?.[0]?.colorGrading, 'neon-noir');
      assert.equal(payload.index?.projects?.[0]?.legacyImportSummary?.manifestPresent, true);
      assert.equal(payload.index?.projects?.[0]?.legacyImportSummary?.queueStatusMismatch, true);
      assert.equal(payload.index?.projects?.[0]?.legacyImportSummary?.nestedOutputRootDetected, true);
      assert.equal(payload.index?.projects?.[0]?.executionProfile?.aspectRatio, '9:16');
      assert.equal(payload.index?.projects?.[0]?.executionProfile?.quality, 'quality');
      assert.equal(payload.index?.projects?.[0]?.executionProfile?.resolution, '1080p');
      assert.equal(payload.index?.projects?.[0]?.executionProfile?.generateAudio, false);
      assert.equal(payload.index?.projects?.[0]?.executionProfile?.outputCount, 2);
      assert.ok(payload.index?.projects?.[0]?.promptGuidance?.includes('seedance-ugc-formulas'));
      assert.deepEqual(payload.index?.projects?.[0]?.characterBindings, [
        { name: 'Nova', goBananasId: 170, referenceAssets: ['refs/nova.png'], profileExists: true },
      ]);
      assert.equal(payload.index?.projects?.[0]?.storyboardReviewState, 'current');
      assert.equal(payload.index?.projects?.[0]?.storyboardReviewExists, true);
      assert.match(payload.index?.projects?.[0]?.storyboardReviewPath ?? '', /projects\/alpha\/storyboard\.md$/);
      assert.match(payload.index?.projects?.[0]?.storyboardReviewGeneratedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(payload.index?.projects?.[0]?.storyboardReviewStale, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exports csv snapshots for projects and timeline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-csv-'));
    const outputDir = join(root, 'exports');
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'create', 'A lonely astronaut discovers an alien flower on Mars.', '--project', 'alpha', '--root', root, '--production-mode', 'director', '--runtime', '1:30', '--clip-duration', '10'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok', '--aspect-ratio', '9:16', '--quality', 'quality', '--resolution', '1080p', '--audio', 'off', '--outputs', '2'],
        ['video', 'create', 'Alpha style pass.', '--project', 'alpha', '--root', root, '--style', 'villeneuve', '--color-grading', 'neon-noir'],
        ['video', 'character-add', '--project', 'alpha', '--root', root, '--name', 'Nova', '--gb-id', '170', '--ref', 'refs/nova.png'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one', '--scene-character', '0:Nova'],
        ['video', 'storyboard-review', '--project', 'alpha', '--root', root, '--mode', 'storyboard'],
        ['video', 'execution-plan', '--project', 'alpha', '--root', root]
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }
      await writeFile(
        join(root, 'projects', 'alpha', 'state', 'legacy-import-summary.json'),
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

      const exportResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'export-csv', '--root', root, '--output-dir', outputDir],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(exportResult.status, 0);
      const payload = JSON.parse(exportResult.stdout) as { projectsCsvPath?: string; timelineCsvPath?: string; reportPath?: string };
      const projectsCsv = await readFile(payload.projectsCsvPath!, 'utf-8');
      const timelineCsv = await readFile(payload.timelineCsvPath!, 'utf-8');
      const reportJson = JSON.parse(await readFile(payload.reportPath!, 'utf-8')) as { metrics?: { totalProjects?: number } };
      assert.match(projectsCsv, /slug,opsStatus,productionMode,targetRuntimeSeconds,clipDurationSeconds,genre,platform,style,colorGrading,legacyImportManifestPresent,legacyImportQueueFilePresent,legacyImportQueueStatusMismatch,legacyImportNestedOutputRootDetected,owner,priority,dueDate,nextStage,storyboardReviewState,storyboardReviewExists,storyboardReviewPath,storyboardReviewGeneratedAt,storyboardReviewStale,reviewReportVerdict,reviewPublishReady,executionProfileAspectRatio,executionProfileQuality,executionProfileResolution,executionProfileGenerateAudio,executionProfileOutputCount,promptGuidance,characterProfileCount,characterHydrationExplicitCount,characterHydrationImportedCount,characterHydrationAutoCreatedCount,characterBindings/);
      assert.match(projectsCsv, /alpha/);
      assert.match(projectsCsv, /,90,10,sci-fi,tiktok,villeneuve,neon-noir/);
      assert.match(projectsCsv, /sci-fi/);
      assert.match(projectsCsv, /tiktok/);
      assert.match(projectsCsv, /villeneuve/);
      assert.match(projectsCsv, /neon-noir/);
      assert.match(projectsCsv, /true,true,true,true/);
      assert.match(projectsCsv, /9:16/);
      assert.match(projectsCsv, /quality/);
      assert.match(projectsCsv, /1080p/);
      assert.match(projectsCsv, /false/);
      assert.match(projectsCsv, /2/);
      assert.match(projectsCsv, /seedance-ugc-formulas/);
      assert.match(projectsCsv, /,1,0,0,0,/);
      assert.match(projectsCsv, /Nova:170:refs\/nova\.png/);
      assert.match(projectsCsv, /current/);
      assert.match(projectsCsv, /true/);
      assert.match(projectsCsv, /projects\/alpha\/storyboard\.md/);
      assert.match(projectsCsv, /\d{4}-\d{2}-\d{2}T/);
      assert.match(projectsCsv, /false/);
      const [headerLine, rowLine] = projectsCsv.trim().split('\n');
      const header = headerLine!.split(',');
      const row = rowLine!.split(',');
      assert.equal(header.includes('reviewReportVerdict'), true);
      assert.equal(header.includes('reviewPublishReady'), true);
      assert.equal(row[header.indexOf('reviewReportVerdict')], '');
      assert.equal(row[header.indexOf('reviewPublishReady')], '');
      assert.match(timelineCsv, /recordedAt,slug,type,payload/);
      assert.equal(reportJson.metrics?.totalProjects, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes reference_sheets columns in the projects CSV', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-csv-refsheet-'));
    const outputDir = join(root, 'exports');
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'demo', '--root', root, '--mode', 'director'],
        ['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--ref', 'refs/a.png:identity', '--binding', '0'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: process.cwd(), encoding: 'utf-8' });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const exportResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'export-csv', '--root', root, '--output-dir', outputDir],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(exportResult.status, 0);
      const payload = JSON.parse(exportResult.stdout) as { projectsCsvPath?: string };
      const projectsCsv = await readFile(payload.projectsCsvPath!, 'utf-8');
      assert.match(projectsCsv, /reference_sheets_count,reference_sheets_types/);
      const lines = projectsCsv.trim().split('\n');
      assert.equal(lines.length, 2, 'expected header + one project row');
      const header = lines[0]!.split(',');
      const row = lines[1]!.split(',');
      const countIdx = header.indexOf('reference_sheets_count');
      const typesIdx = header.indexOf('reference_sheets_types');
      assert.equal(row[countIdx], '1');
      assert.equal(row[typesIdx], 'identity');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exports review-report truth columns for legacy published projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-csv-review-truth-'));
    const outputDir = join(root, 'exports');
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
      for (const checkpoint of [
        { stage: 'brief', artifacts: { brief: briefPath }, summary: 'brief done' },
        { stage: 'storyboard', artifacts: { storyboard: storyboardPath }, summary: 'storyboard done' },
        { stage: 'assets', artifacts: { 'asset-manifest': assetManifestPath }, summary: 'assets done' },
        { stage: 'review', artifacts: { 'review-report': reviewReportPath }, summary: 'legacy pass without publish-ready metric' },
        { stage: 'publish', artifacts: { 'publish-report': publishReportPath }, summary: 'legacy publish checkpoint' },
      ] as const) {
        await writeStageCheckpoint(workspace, {
          stage: checkpoint.stage,
          status: 'completed',
          generatedAt: now,
          artifacts: checkpoint.artifacts,
          summary: checkpoint.summary,
          issues: [],
        });
      }

      const exportResult = await exportPortfolioCsv(root, outputDir);
      const projectsCsv = await readFile(exportResult.projectsCsvPath, 'utf-8');
      const [headerLine, rowLine] = projectsCsv.trim().split('\n');
      const header = headerLine!.split(',');
      const row = rowLine!.split(',');

      assert.equal(row[header.indexOf('slug')], 'alpha');
      assert.equal(row[header.indexOf('opsStatus')], 'needs-review');
      assert.equal(row[header.indexOf('nextStage')], 'complete');
      assert.equal(row[header.indexOf('reviewReportVerdict')], 'pass');
      assert.equal(row[header.indexOf('reviewPublishReady')], 'false');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
