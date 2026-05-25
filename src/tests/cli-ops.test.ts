import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw list and doctor-project cli', () => {
  it('lists created projects under the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-list-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const slug of ['alpha', 'beta']) {
        const result = spawnSync(process.execPath, [cliPath, 'video', 'init', slug, '--root', root], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0);
      }

      const listResult = spawnSync(process.execPath, [cliPath, 'video', 'list', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(listResult.status, 0);
      const payload = JSON.parse(listResult.stdout) as { projects?: string[] };
      assert.deepEqual(payload.projects, ['alpha', 'beta']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project errors when a completed stage points to a missing artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.']
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0);
      }

      const briefPath = join(root, 'projects', 'launch-teaser', 'artifacts', 'brief.json');
      await unlink(briefPath);

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'launch-teaser', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ message?: string }> };
      assert.equal(payload.ok, false);
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('missing artifact file')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project errors when an artifact file exists but is malformed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-invalid-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.']
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0);
      }

      const briefPath = join(root, 'projects', 'launch-teaser', 'artifacts', 'brief.json');
      await writeFile(briefPath, JSON.stringify({ title: 'Broken Brief' }, null, 2));

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'launch-teaser', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ message?: string }> };
      assert.equal(payload.ok, false);
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('Brief artifact missing intent')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project errors when publish-report JSON is malformed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-invalid-publish-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'launch-teaser', '--root', root, '--asset', 'video:/tmp/final.mp4:0:veo-useapi'],
        ['video', 'review', '--project', 'launch-teaser', '--root', root, '--verdict', 'pass'],
        ['video', 'publish', '--project', 'launch-teaser', '--root', root, '--status', 'published', '--final-output', '/tmp/final.mp4'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const publishPath = join(root, 'projects', 'launch-teaser', 'artifacts', 'publish-report.json');
      await writeFile(publishPath, '{"status":');

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'launch-teaser', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0, doctorResult.stderr);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ message?: string }> };
      assert.equal(payload.ok, false);
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('publish-report: malformed JSON artifact')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project errors when review is not publish-ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-review-retry-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'launch-teaser', '--root', root, '--asset', 'video:/tmp/final.mp4:0:veo-useapi'],
        ['video', 'review', '--project', 'launch-teaser', '--root', root, '--verdict', 'retry', '--finding', 'Needs revision.'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }
      await writeFile(
        join(root, 'projects', 'launch-teaser', 'events', 'events.jsonl'),
        [
          JSON.stringify({ type: 'storyboard.review.generated', recordedAt: '2026-04-20T10:00:00.000Z', payload: { markdownPath: join(root, 'projects', 'launch-teaser', 'storyboard.md') } }),
          JSON.stringify({ type: 'artifact.storyboard.written', recordedAt: '2026-04-20T11:00:00.000Z', payload: { artifactPath: join(root, 'projects', 'launch-teaser', 'artifacts', 'storyboard.json') } }),
          '',
        ].join('\n'),
      );

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'launch-teaser', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ message?: string }> };
      assert.equal(payload.ok, false);
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('Review checkpoint is retry-required')));
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('Review report is not publish-ready: verdict retry')));
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('Storyboard review is stale relative')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project errors when a passing review report lacks publishReady truth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-review-pass-missing-ready-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'launch-teaser', '--root', root, '--asset', 'video:/tmp/final.mp4:0:veo-useapi'],
        ['video', 'review', '--project', 'launch-teaser', '--root', root, '--verdict', 'pass', '--finding', 'No blocking issues.'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const reviewReportPath = join(root, 'projects', 'launch-teaser', 'artifacts', 'review-report.json');
      await writeFile(
        reviewReportPath,
        JSON.stringify({
          projectSlug: 'launch-teaser',
          verdict: 'pass',
          generatedAt: new Date().toISOString(),
          findings: ['Legacy pass report without publish-ready metric.'],
        }, null, 2),
      );

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'launch-teaser', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ message?: string }> };
      assert.equal(payload.ok, false);
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('metrics.publishReady is not true')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project errors when storyboard approval is pending but storyboard.md is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-review-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'launch-teaser', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--mode', 'director', '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'storyboard-review', '--project', 'launch-teaser', '--root', root, '--mode', 'director'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      await unlink(join(root, 'projects', 'launch-teaser', 'storyboard.md'));
      await writeFile(
        join(root, 'projects', 'launch-teaser', 'checkpoints', 'storyboard.json'),
        JSON.stringify({
          stage: 'storyboard',
          status: 'awaiting-approval',
          generatedAt: new Date().toISOString(),
          artifacts: {
            storyboard: join(root, 'projects', 'launch-teaser', 'artifacts', 'storyboard.json'),
          },
          summary: 'waiting for storyboard approval',
          issues: [],
          nextAction: 'Review storyboard.md and approve execution.',
        }, null, 2),
      );

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'launch-teaser', '--root', root, '--mode', 'director'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ message?: string }> };
      assert.equal(payload.ok, false);
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('storyboard.md is missing')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project errors when storyboard approval is pending but the review file is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-stale-review-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'launch-teaser', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--mode', 'director', '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'storyboard-review', '--project', 'launch-teaser', '--root', root, '--mode', 'director'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      await writeFile(
        join(root, 'projects', 'launch-teaser', 'events', 'events.jsonl'),
        [
          JSON.stringify({ type: 'storyboard.review.generated', recordedAt: '2026-04-20T10:00:00.000Z', payload: { markdownPath: join(root, 'projects', 'launch-teaser', 'storyboard.md') } }),
          JSON.stringify({ type: 'artifact.storyboard.written', recordedAt: '2026-04-20T11:00:00.000Z', payload: { artifactPath: join(root, 'projects', 'launch-teaser', 'artifacts', 'storyboard.json') } }),
          '',
        ].join('\n'),
      );

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'launch-teaser', '--root', root, '--mode', 'director'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ message?: string }> };
      assert.equal(payload.ok, false);
      assert.ok(payload.issues?.some((issue) => issue.message?.includes('storyboard.md is stale')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports doctor-project warnings for imported legacy drift diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-doctor-legacy-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'legacy-alpha', '--root', root],
        ['video', 'brief', '--project', 'legacy-alpha', '--root', root, '--title', 'Legacy Alpha', '--intent', 'Legacy Alpha intent'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      await writeFile(
        join(root, 'projects', 'legacy-alpha', 'state', 'legacy-import-summary.json'),
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

      const doctorResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'doctor-project', '--project', 'legacy-alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(doctorResult.status, 0, doctorResult.stderr);
      const payload = JSON.parse(doctorResult.stdout) as { ok?: boolean; issues?: Array<{ severity?: string; message?: string }> };
      assert.equal(payload.ok, true);
      assert.ok(payload.issues?.some((issue) => issue.severity === 'warning' && issue.message?.includes('queue/output drift')));
      assert.ok(payload.issues?.some((issue) => issue.severity === 'warning' && issue.message?.includes('nested output roots')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
