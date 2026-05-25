import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw doctor-portfolio cli', () => {
  it('reports unhealthy projects across the portfolio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-portfolio-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'init', 'beta', '--root', root],
        ['video', 'brief', '--project', 'beta', '--root', root, '--title', 'Beta', '--intent', 'Beta intent'],
        ['video', 'init', 'gamma', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'gamma', '--root', root, '--mode', 'director', '--title', 'Gamma', '--intent', 'Gamma intent'],
        ['video', 'storyboard', '--project', 'gamma', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'storyboard-review', '--project', 'gamma', '--root', root, '--mode', 'director'],
        ['video', 'init', 'delta', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'delta', '--root', root, '--mode', 'director', '--title', 'Delta', '--intent', 'Delta intent'],
        ['video', 'storyboard', '--project', 'delta', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'storyboard-review', '--project', 'delta', '--root', root, '--mode', 'director'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      await unlink(join(root, 'projects', 'beta', 'artifacts', 'brief.json'));
      await unlink(join(root, 'projects', 'gamma', 'storyboard.md'));
      await writeFile(
        join(root, 'projects', 'gamma', 'checkpoints', 'storyboard.json'),
        JSON.stringify({
          stage: 'storyboard',
          status: 'awaiting-approval',
          generatedAt: new Date().toISOString(),
          artifacts: {
            storyboard: join(root, 'projects', 'gamma', 'artifacts', 'storyboard.json'),
          },
          summary: 'waiting for storyboard approval',
          issues: [],
          nextAction: 'Review storyboard.md and approve execution.',
        }, null, 2),
      );
      await writeFile(
        join(root, 'projects', 'delta', 'events', 'events.jsonl'),
        [
          JSON.stringify({ type: 'storyboard.review.generated', recordedAt: '2026-04-20T10:00:00.000Z', payload: { markdownPath: join(root, 'projects', 'delta', 'storyboard.md') } }),
          JSON.stringify({ type: 'artifact.storyboard.written', recordedAt: '2026-04-20T11:00:00.000Z', payload: { artifactPath: join(root, 'projects', 'delta', 'artifacts', 'storyboard.json') } }),
          '',
        ].join('\n'),
      );
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
        [cliPath, 'video', 'doctor-portfolio', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as {
        unhealthyProjects?: number;
        warningProjects?: number;
        legacyImportedProjects?: number;
        legacyQueueDriftProjects?: number;
        legacyNestedOutputProjects?: number;
        missingStoryboardReviewProjects?: number;
        staleStoryboardReviewProjects?: number;
        entries?: Array<{ slug?: string; ok?: boolean; issues?: Array<{ message?: string }> }>;
      };
      assert.equal(payload.unhealthyProjects, 3);
      assert.equal(payload.warningProjects, 1);
      assert.equal(payload.legacyImportedProjects, 1);
      assert.equal(payload.legacyQueueDriftProjects, 1);
      assert.equal(payload.legacyNestedOutputProjects, 1);
      assert.equal(payload.missingStoryboardReviewProjects, 1);
      assert.equal(payload.staleStoryboardReviewProjects, 1);
      assert.ok(payload.entries?.some((entry) => entry.slug === 'beta' && entry.ok === false));
      assert.ok(payload.entries?.some((entry) =>
        entry.slug === 'gamma'
        && entry.ok === false
        && entry.issues?.some((issue) => issue.message?.includes('storyboard.md is missing')),
      ));
      assert.ok(payload.entries?.some((entry) =>
        entry.slug === 'delta'
        && entry.ok === false
        && entry.issues?.some((issue) => issue.message?.includes('storyboard.md is stale')),
      ));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('counts projects with reference-sheet collisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-portfolio-refsheet-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'demo', '--root', root, '--mode', 'director'],
        ['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'A', '--ref', 'refs/a.png:palette', '--binding', '0'],
        ['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'B', '--ref', 'refs/b.png:palette', '--binding', '0'],
      ];
      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: process.cwd(), encoding: 'utf-8' });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const res = spawnSync(process.execPath, [cliPath, 'video', 'doctor-portfolio', '--root', root, '--mode', 'director'], { cwd: process.cwd(), encoding: 'utf-8' });
      assert.equal(res.status, 0);
      const payload = JSON.parse(res.stdout) as {
        referenceSheets?: {
          projectsWithSheets?: number;
          projectsWithCollisions?: number;
          projectsWithUnassignedRoles?: number;
          projectsWithoutIdentityWhenApprovalPending?: number;
        };
      };
      assert.ok(payload.referenceSheets, 'expected referenceSheets summary');
      assert.equal(payload.referenceSheets?.projectsWithSheets, 1);
      assert.equal(payload.referenceSheets?.projectsWithCollisions, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
