import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw metrics cli', () => {
  it('prints portfolio metrics JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-metrics-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'init', 'beta', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'beta', '--root', root, '--mode', 'director', '--title', 'Beta', '--intent', 'Beta intent'],
        ['video', 'storyboard', '--project', 'beta', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'storyboard-review', '--project', 'beta', '--root', root, '--mode', 'director'],
      ];
      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0);
      }
      await writeFile(
        join(root, 'projects', 'beta', 'events', 'events.jsonl'),
        [
          JSON.stringify({ type: 'storyboard.review.generated', recordedAt: '2026-04-20T10:00:00.000Z', payload: { markdownPath: join(root, 'projects', 'beta', 'storyboard.md') } }),
          JSON.stringify({ type: 'artifact.storyboard.written', recordedAt: '2026-04-20T11:00:00.000Z', payload: { artifactPath: join(root, 'projects', 'beta', 'artifacts', 'storyboard.json') } }),
          '',
        ].join('\n'),
      );

      const metricsResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'metrics', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(metricsResult.status, 0);
      const payload = JSON.parse(metricsResult.stdout) as {
        totalProjects?: number;
        unreviewedStoryboardProjects?: number;
        staleStoryboardReviewProjects?: number;
        byReviewState?: { missing?: number; current?: number; stale?: number };
        byOpsStatus?: { planned?: number; 'needs-review'?: number };
      };
      assert.equal(payload.totalProjects, 2);
      assert.equal(payload.byOpsStatus?.planned, 1);
      assert.equal(payload.byOpsStatus?.['needs-review'], 1);
      assert.equal(payload.byReviewState?.missing, 1);
      assert.equal(payload.byReviewState?.current, 0);
      assert.equal(payload.byReviewState?.stale, 1);
      assert.equal(payload.unreviewedStoryboardProjects, 1);
      assert.equal(payload.staleStoryboardReviewProjects, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
