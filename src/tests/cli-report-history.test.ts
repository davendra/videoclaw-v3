import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw report history cli', () => {
  it('writes snapshots and exposes history and trends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-report-history-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);
      const briefResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(briefResult.status, 0);

      const snap1 = spawnSync(process.execPath, [cliPath, 'video', 'report-snapshot', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      const snap2 = spawnSync(process.execPath, [cliPath, 'video', 'report-snapshot', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(snap1.status, 0);
      assert.equal(snap2.status, 0);

      const historyResult = spawnSync(process.execPath, [cliPath, 'video', 'report-history', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(historyResult.status, 0);
      const historyPayload = JSON.parse(historyResult.stdout) as {
        snapshots?: Array<{
          totalProjects?: number;
          completedProjects?: number;
          warningProjects?: number;
          byPlatform?: Record<string, number>;
          legacyImportedProjects?: number;
          legacyQueueDriftProjects?: number;
          legacyNestedOutputProjects?: number;
        }>;
      };
      assert.equal(historyPayload.snapshots?.length, 2);
      assert.equal(historyPayload.snapshots?.[0]?.totalProjects, 1);
      assert.equal(historyPayload.snapshots?.[0]?.completedProjects, 0);
      assert.equal(historyPayload.snapshots?.[0]?.warningProjects, 0);
      assert.equal(historyPayload.snapshots?.[0]?.byPlatform?.tiktok, 1);
      assert.equal(historyPayload.snapshots?.[0]?.legacyImportedProjects, 0);
      assert.equal(historyPayload.snapshots?.[0]?.legacyQueueDriftProjects, 0);
      assert.equal(historyPayload.snapshots?.[0]?.legacyNestedOutputProjects, 0);

      const trendResult = spawnSync(process.execPath, [cliPath, 'video', 'trends', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(trendResult.status, 0);
      const trendPayload = JSON.parse(trendResult.stdout) as {
        points?: Array<{
          warningProjects?: number;
          byPlatform?: Record<string, number>;
          legacyImportedProjects?: number;
          legacyQueueDriftProjects?: number;
          legacyNestedOutputProjects?: number;
        }>;
      };
      assert.equal(trendPayload.points?.length, 2);
      assert.equal(trendPayload.points?.[0]?.warningProjects, 0);
      assert.equal(trendPayload.points?.[0]?.byPlatform?.tiktok, 1);
      assert.equal(trendPayload.points?.[0]?.legacyImportedProjects, 0);
      assert.equal(trendPayload.points?.[0]?.legacyQueueDriftProjects, 0);
      assert.equal(trendPayload.points?.[0]?.legacyNestedOutputProjects, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
