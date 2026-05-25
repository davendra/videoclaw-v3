import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw dependencies cli', () => {
  it('prints project dependency edges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-deps-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'init', 'beta', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent', '--platform', 'tiktok'],
        ['video', 'brief', '--project', 'beta', '--root', root, '--title', 'Beta', '--intent', 'Beta intent', '--platform', 'youtube'],
        ['video', 'set-meta', '--project', 'alpha', '--root', root, '--blocked-by', 'beta', '--blocked-reason', 'Waiting on beta assets']
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
        [cliPath, 'video', 'dependencies', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as {
        edges?: Array<{ from?: string; to?: string }>;
        nodes?: Array<{ slug?: string; platform?: string; legacyImportSummary?: { queueStatusMismatch?: boolean; nestedOutputRootDetected?: boolean } }>;
      };
      assert.equal(payload.edges?.length, 1);
      assert.equal(payload.edges?.[0]?.from, 'alpha');
      assert.equal(payload.edges?.[0]?.to, 'beta');
      assert.equal(payload.nodes?.find((node) => node.slug === 'alpha')?.platform, 'tiktok');
      assert.equal(payload.nodes?.find((node) => node.slug === 'beta')?.platform, 'youtube');
      assert.equal(payload.nodes?.find((node) => node.slug === 'alpha')?.legacyImportSummary?.queueStatusMismatch, true);
      assert.equal(payload.nodes?.find((node) => node.slug === 'alpha')?.legacyImportSummary?.nestedOutputRootDetected, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
