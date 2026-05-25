import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw next-actions cli', () => {
  it('prints next-action guidance for open projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-next-actions-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one'],
        ['video', 'storyboard-review', '--project', 'alpha', '--root', root]
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }
      await mkdir(join(root, 'projects', '--project'), { recursive: true });
      await (await import('node:fs/promises')).writeFile(
        join(root, 'projects', 'alpha', 'state', 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/alpha',
          importedAt: new Date().toISOString(),
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

      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'next-actions', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as {
        actions?: Array<{
          slug?: string;
          action?: string;
          platform?: string;
          legacyImportSummary?: { queueStatusMismatch?: boolean };
          storyboardReviewPath?: string;
          storyboardReviewGeneratedAt?: string;
        }>;
      };
      assert.ok(payload.actions?.some((action) => action.slug === 'alpha'));
      assert.equal(payload.actions?.some((action) => action.slug === '--project'), false);
      assert.ok(payload.actions?.some((action) => action.platform === 'tiktok'));
      assert.ok(payload.actions?.some((action) => action.legacyImportSummary?.queueStatusMismatch === true));
      assert.ok(payload.actions?.some((action) => String(action.action).includes('Reconcile imported legacy state')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
