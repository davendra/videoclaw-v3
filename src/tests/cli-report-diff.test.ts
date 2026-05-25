import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw report-diff cli', () => {
  it('diffs the latest two snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-diff-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initAlpha = spawnSync(process.execPath, [cliPath, 'video', 'init', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initAlpha.status, 0);
      const briefAlpha = spawnSync(process.execPath, [cliPath, 'video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'youtube', '--aspect-ratio', '16:9', '--quality', 'fast'], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(briefAlpha.status, 0);
      const storyboard = spawnSync(process.execPath, [cliPath, 'video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one'], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(storyboard.status, 0);
      await writeFile(join(root, 'projects', 'alpha', 'storyboard.md'), '# Review\n');

      const snap1 = spawnSync(process.execPath, [cliPath, 'video', 'report-snapshot', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(snap1.status, 0);

      const initBeta = spawnSync(process.execPath, [cliPath, 'video', 'init', 'beta', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initBeta.status, 0);
      const review = spawnSync(process.execPath, [cliPath, 'video', 'storyboard-review', '--project', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(review.status, 0);
      await writeFile(
        join(root, 'projects', 'alpha', 'events', 'events.jsonl'),
        [
          JSON.stringify({ type: 'storyboard.review.generated', recordedAt: '2026-04-20T10:00:00.000Z', payload: { markdownPath: join(root, 'projects', 'alpha', 'storyboard.md') } }),
          JSON.stringify({ type: 'artifact.storyboard.written', recordedAt: '2026-04-20T11:00:00.000Z', payload: { artifactPath: join(root, 'projects', 'alpha', 'artifacts', 'storyboard.json') } }),
          '',
        ].join('\n'),
      );
      const briefUpdate = spawnSync(process.execPath, [cliPath, 'video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok', '--quality', 'quality', '--resolution', '1080p', '--audio', 'off', '--outputs', '2'], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(briefUpdate.status, 0);
      const runtimeUpdate = spawnSync(process.execPath, [cliPath, 'video', 'create', 'Alpha style pass.', '--project', 'alpha', '--root', root, '--runtime', '1:30', '--clip-duration', '10'], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(runtimeUpdate.status, 0);
      await writeFile(
        join(root, 'projects', 'alpha', 'state', 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/legacy-alpha',
          importedAt: '2026-04-20T09:00:00.000Z',
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

      const snap2 = spawnSync(process.execPath, [cliPath, 'video', 'report-snapshot', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(snap2.status, 0);

      const diff = spawnSync(process.execPath, [cliPath, 'video', 'report-diff', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(diff.status, 0);
      const payload = JSON.parse(diff.stdout) as {
        projectChanges?: {
          added?: string[];
          platformChanged?: Array<{ slug?: string; from?: string | null; to?: string | null }>;
          targetRuntimeChanged?: Array<{ slug?: string; from?: number | null; to?: number | null }>;
          clipDurationChanged?: Array<{ slug?: string; from?: number | null; to?: number | null }>;
          executionProfileChanged?: Array<{
            slug?: string;
            from?: { aspectRatio?: string; quality?: string };
            to?: { aspectRatio?: string; quality?: string; resolution?: string; generateAudio?: boolean; outputCount?: number };
          }>;
          legacyImportChanged?: Array<{
            slug?: string;
            from?: { queueStatusMismatch?: boolean; nestedOutputRootDetected?: boolean } | null;
            to?: { queueStatusMismatch?: boolean; nestedOutputRootDetected?: boolean } | null;
          }>;
          reviewStateChanged?: Array<{ slug?: string; from?: string | null; to?: string | null }>;
        };
      };
      assert.equal(payload.projectChanges?.added?.includes('beta'), true);
      assert.ok(payload.projectChanges?.platformChanged?.some((change) => change.slug === 'alpha' && change.from === 'youtube' && change.to === 'tiktok'));
      assert.ok(payload.projectChanges?.targetRuntimeChanged?.some((change) => change.slug === 'alpha' && change.from === null && change.to === 90));
      assert.ok(payload.projectChanges?.clipDurationChanged?.some((change) => change.slug === 'alpha' && change.from === null && change.to === 10));
      assert.ok(
        payload.projectChanges?.executionProfileChanged?.some((change) =>
          change.slug === 'alpha'
          && change.from?.aspectRatio === '16:9'
          && change.from?.quality === 'fast'
          && change.to?.aspectRatio === '16:9'
          && change.to?.quality === 'quality'
          && change.to?.resolution === '1080p'
          && change.to?.generateAudio === false
          && change.to?.outputCount === 2),
      );
      assert.ok(
        payload.projectChanges?.legacyImportChanged?.some((change) =>
          change.slug === 'alpha'
          && change.from?.queueStatusMismatch !== true
          && change.to?.queueStatusMismatch === true
          && change.to?.nestedOutputRootDetected === true),
      );
      const summary = (payload as {
        summary?: {
          warningProjectsDelta?: number;
          legacyImportedProjectsDelta?: number;
          legacyQueueDriftProjectsDelta?: number;
          legacyNestedOutputProjectsDelta?: number;
        };
      }).summary;
      assert.equal(summary?.warningProjectsDelta, 1);
      assert.equal(summary?.legacyImportedProjectsDelta, 1);
      assert.equal(summary?.legacyQueueDriftProjectsDelta, 1);
      assert.equal(summary?.legacyNestedOutputProjectsDelta, 1);
      assert.ok(payload.projectChanges?.reviewStateChanged?.some((change) => change.slug === 'alpha' && change.from === 'missing' && change.to === 'current'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
