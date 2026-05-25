import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw index and sync-obsidian cli', () => {
  it('writes a machine-readable project index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-index-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'character-add', '--project', 'alpha', '--root', root, '--name', 'Nova', '--gb-id', '170', '--ref', 'refs/nova.png', '--note', 'Imported from `video create --import-library-characters`.'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one', '--scene-character', '0:Nova'],
        ['video', 'init', 'beta', '--root', root],
      ];
      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0);
      }

      const indexResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'index', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(indexResult.status, 0);
      const payload = JSON.parse(indexResult.stdout) as {
        outputPath?: string;
        index?: { projects?: Array<{ slug?: string; opsStatus?: string; characterBindings?: Array<{ name?: string; goBananasId?: number; referenceAssets?: string[]; profileExists?: boolean }> }> };
      };
      const indexFile = JSON.parse(await readFile(payload.outputPath!, 'utf-8')) as {
        projects?: Array<{ slug?: string; opsStatus?: string; characterBindings?: Array<{ name?: string; goBananasId?: number; referenceAssets?: string[]; profileExists?: boolean }> }>;
      };
      assert.deepEqual(payload.index?.projects?.map((project) => project.slug), ['alpha', 'beta']);
      assert.deepEqual(indexFile.projects?.map((project) => project.slug), ['alpha', 'beta']);
      assert.deepEqual(payload.index?.projects?.map((project) => project.opsStatus), ['active', 'planned']);
      assert.deepEqual(payload.index?.projects?.[0]?.characterBindings, [
        { name: 'Nova', goBananasId: 170, referenceAssets: ['refs/nova.png'], profileExists: true },
      ]);
      assert.deepEqual(indexFile.projects?.[0]?.characterBindings, [
        { name: 'Nova', goBananasId: 170, referenceAssets: ['refs/nova.png'], profileExists: true },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('syncs all projects into an obsidian dashboard and notes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-sync-'));
    const outputDir = join(root, 'vault');
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'create', 'A lonely astronaut discovers an alien flower on Mars.', '--project', 'alpha', '--root', root, '--production-mode', 'director'],
        ['video', 'set-meta', '--project', 'alpha', '--root', root, '--owner', 'davendra', '--priority', 'high', '--due', '2026-05-01', '--tag', 'launch'],
        ['video', 'character-add', '--project', 'alpha', '--root', root, '--name', 'Nova', '--gb-id', '170', '--ref', 'refs/nova.png'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'youtube', '--aspect-ratio', '16:9', '--quality', 'fast'],
        ['video', 'report-snapshot', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok', '--aspect-ratio', '9:16', '--quality', 'quality', '--resolution', '1080p', '--audio', 'off', '--outputs', '2'],
        ['video', 'create', 'Alpha style pass.', '--project', 'alpha', '--root', root, '--runtime', '1:30', '--clip-duration', '10', '--style', 'villeneuve', '--color-grading', 'neon-noir'],
        ['video', 'report-snapshot', '--root', root],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one', '--scene-character', '0:Nova'],
        ['video', 'storyboard-review', '--project', 'alpha', '--root', root],
        ['video', 'execution-plan', '--project', 'alpha', '--root', root],
        ['video', 'init', 'beta', '--root', root],
        ['video', 'brief', '--project', 'beta', '--root', root, '--title', 'Beta', '--intent', 'Beta intent', '--platform', 'youtube'],
        ['video', 'set-meta', '--project', 'alpha', '--root', root, '--blocked-by', 'beta', '--blocked-reason', 'Waiting on beta assets'],
      ];

      for (const args of commands) {
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

      const syncResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'sync-obsidian', '--root', root, '--output-dir', outputDir],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(syncResult.status, 0);
      const payload = JSON.parse(syncResult.stdout) as { dashboardPath?: string; viewPaths?: string[]; exportedProjects?: string[] };
      const dashboard = await readFile(payload.dashboardPath!, 'utf-8');
      const activeView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Active.md'))!, 'utf-8');
      const blockedView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Blocked.md'))!, 'utf-8');
      const nextActionsView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Next Actions.md'))!, 'utf-8');
      const timelineView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Timeline.md'))!, 'utf-8');
      const trendsView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Trends.md'))!, 'utf-8');
      const historyView = await readFile(payload.viewPaths!.find((path) => path.endsWith('History.md'))!, 'utf-8');
      const changesView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Changes.md'))!, 'utf-8');
      const metricsView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Metrics.md'))!, 'utf-8');
      const workloadView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Owner Workload.md'))!, 'utf-8');
      const dependenciesView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Dependencies.md'))!, 'utf-8');
      assert.match(dashboard, /# Production Dashboard/);
      assert.match(dashboard, /\[\[Projects\/alpha\|alpha\]\]/);
      assert.match(dashboard, /davendra/);
      assert.match(dashboard, /2026-05-01/);
      assert.match(dashboard, /\| none \|/);
      assert.match(dashboard, /director \(sci-fi, 90s @ 10s\)/);
      assert.match(dashboard, /tiktok/);
      assert.match(dashboard, /villeneuve \/ neon-noir/);
      assert.match(dashboard, /manifest=true \/ queue-drift=true \/ nested-output=true/);
      assert.match(dashboard, /9:16/);
      assert.match(dashboard, /storyboard\.md/);
      assert.match(dashboard, /seedance-ugc-formulas/);
      assert.match(dashboard, /\| 1 \| explicit=0 \/ imported=0 \/ auto=0 \|/);
      assert.match(dashboard, /Nova:170:refs\/nova\.png/);
      assert.match(activeView, /# Active Projects/);
      assert.doesNotMatch(activeView, /\[\[Projects\/alpha\|alpha\]\]/);
      const needsReviewView = await readFile(payload.viewPaths!.find((path) => path.endsWith('Needs Review.md'))!, 'utf-8');
      assert.match(needsReviewView, /# Needs Review/);
      assert.match(needsReviewView, /\[\[Projects\/alpha\|alpha\]\]/);
      assert.match(blockedView, /\| _none_ \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \| - \|/);
      assert.match(nextActionsView, /# Next Actions/);
      assert.match(nextActionsView, /platform=tiktok/);
      assert.match(nextActionsView, /Waiting on beta assets/);
      assert.match(nextActionsView, /platform=youtube/);
      assert.match(changesView, /# Changes/);
      assert.match(changesView, /### Platform Changed/);
      assert.match(changesView, /\[\[Projects\/alpha\|alpha\]\]: youtube -> tiktok/);
      assert.match(changesView, /### Target Runtime Changed/);
      assert.match(changesView, /\[\[Projects\/alpha\|alpha\]\]: none -> 90s/);
      assert.match(changesView, /### Clip Duration Changed/);
      assert.match(changesView, /\[\[Projects\/alpha\|alpha\]\]: 15s -> 10s/);
      assert.match(changesView, /### Execution Profile Changed/);
      assert.match(changesView, /16:9 \/ fast \/ - \/ audio=- \/ outputs=- -> 9:16 \/ quality \/ 1080p \/ audio=false \/ outputs=2/);
      assert.match(metricsView, /# Portfolio Metrics/);
      assert.match(metricsView, /Total character profiles: 1/);
      assert.match(metricsView, /Imported character profiles: 0/);
      assert.match(metricsView, /## By Platform/);
      assert.match(metricsView, /- tiktok: 1/);
      assert.match(metricsView, /- unset: 1/);
      assert.match(dependenciesView, /# Dependencies/);
      assert.match(dependenciesView, /\[\[Projects\/alpha\|alpha\]\] \(tiktok\) \[legacy queue-drift=true nested-output=true\] depends on \[\[Projects\/beta\|beta\]\] \(youtube\)/);
      assert.match(trendsView, /# Trends/);
      assert.match(trendsView, /Platforms/);
      assert.match(trendsView, /youtube:1/);
      assert.match(trendsView, /tiktok:1/);
      assert.match(historyView, /# History/);
      assert.match(historyView, /Platforms/);
      assert.match(historyView, /tiktok:1/);
      assert.match(historyView, /reports\/history\//);
      assert.match(workloadView, /# Owner Workload/);
      assert.match(workloadView, /Platforms/);
      assert.match(workloadView, /tiktok:1/);
      assert.match(timelineView, /# Timeline/);
      assert.match(timelineView, /alpha/);
      assert.match(timelineView, /"platform":"tiktok"/);
      assert.match(timelineView, /"targetRuntimeSeconds":90/);
      assert.match(timelineView, /"clipDurationSeconds":10/);
      assert.match(timelineView, /"executionProfile":\{"aspectRatio":"9:16","quality":"quality","resolution":"1080p","generateAudio":false,"outputCount":2\}/);
      assert.equal(payload.exportedProjects?.length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
