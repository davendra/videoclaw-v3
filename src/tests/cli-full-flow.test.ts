import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw full stage flow', () => {
  it('runs init through publish with canonical stage artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-flow-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--scene', 'Open with silhouette.', '--scene', 'Reveal the product.', '--scene', 'CTA on hero shot.'],
        ['video', 'assets', '--project', 'launch-teaser', '--root', root, '--asset', 'image:/tmp/scene0.png:0:seedance', '--asset', 'video:/tmp/scene1.mp4:1:veo-useapi'],
        ['video', 'review', '--project', 'launch-teaser', '--root', root, '--verdict', 'pass', '--finding', 'No blocking issues.'],
        ['video', 'publish', '--project', 'launch-teaser', '--root', root, '--status', 'ready', '--final-output', '/tmp/final.mp4']
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'launch-teaser', '--root', root],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(statusResult.status, 0);
      const statusPayload = JSON.parse(statusResult.stdout) as { completedStages?: string[]; nextStage?: string | null; artifactFiles?: string[] };
      assert.deepEqual(statusPayload.completedStages, ['brief', 'storyboard', 'assets', 'review', 'publish']);
      assert.equal(statusPayload.nextStage, null);
      assert.equal(statusPayload.artifactFiles?.length, 5);
      const projectManifest = JSON.parse(
        await readFile(join(root, 'projects', 'launch-teaser', 'project.json'), 'utf-8'),
      ) as { currentStage?: string | null; lastCompletedStage?: string; lastCheckpointStatus?: string };
      assert.equal(projectManifest.currentStage, null);
      assert.equal(projectManifest.lastCompletedStage, 'publish');
      assert.equal(projectManifest.lastCheckpointStatus, 'completed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks publish when review is not completed with a passing verdict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-flow-blocked-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--scene', 'Open with silhouette.'],
        ['video', 'assets', '--project', 'launch-teaser', '--root', root, '--asset', 'image:/tmp/scene0.png:0:seedance'],
        ['video', 'review', '--project', 'launch-teaser', '--root', root, '--verdict', 'retry', '--finding', 'Needs better continuity.']
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const publishResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'publish', '--project', 'launch-teaser', '--root', root, '--status', 'ready'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.notEqual(publishResult.status, 0);
      assert.match(publishResult.stderr, /review/i);
      assert.match(publishResult.stderr, /retry-required/i);
      const projectManifest = JSON.parse(
        await readFile(join(root, 'projects', 'launch-teaser', 'project.json'), 'utf-8'),
      ) as { currentStage?: string | null; lastCompletedStage?: string; lastCheckpointStatus?: string };
      assert.equal(projectManifest.currentStage, 'review');
      assert.equal(projectManifest.lastCheckpointStatus, 'retry-required');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks publish when a passing review report is missing publishReady truth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-flow-missing-publish-ready-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--scene', 'Open with silhouette.'],
        ['video', 'assets', '--project', 'launch-teaser', '--root', root, '--asset', 'image:/tmp/scene0.png:0:seedance'],
        ['video', 'review', '--project', 'launch-teaser', '--root', root, '--verdict', 'pass', '--finding', 'No blocking issues.'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const reviewReportPath = join(root, 'projects', 'launch-teaser', 'artifacts', 'review-report.json');
      const reviewReport = JSON.parse(await readFile(reviewReportPath, 'utf-8')) as Record<string, unknown>;
      delete reviewReport.metrics;
      await writeFile(reviewReportPath, `${JSON.stringify(reviewReport, null, 2)}\n`);

      const publishResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'publish', '--project', 'launch-teaser', '--root', root, '--status', 'ready'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.notEqual(publishResult.status, 0);
      assert.match(publishResult.stderr, /metrics\.publishReady is not true/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
