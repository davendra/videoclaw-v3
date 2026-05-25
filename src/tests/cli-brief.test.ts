import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw brief cli', () => {
  it('writes a canonical brief artifact and updates stage status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-brief-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'launch-teaser', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const briefResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'brief',
          '--project',
          'launch-teaser',
          '--root',
          root,
          '--title',
          'Launch Teaser',
          '--intent',
          'Make a short launch teaser for a new product.',
          '--platform',
          'tiktok',
          '--aspect-ratio',
          '9:16',
          '--quality',
          'quality',
          '--resolution',
          '1080p',
          '--audio',
          'off',
          '--outputs',
          '2'
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(briefResult.status, 0);

      const briefPayload = JSON.parse(briefResult.stdout) as { artifactPath?: string };
      const briefArtifact = JSON.parse(await readFile(briefPayload.artifactPath!, 'utf-8')) as {
        title?: string;
        metadata?: {
          platform?: string;
          executionProfile?: {
            aspectRatio?: string;
            quality?: string;
            resolution?: string;
            generateAudio?: boolean;
            outputCount?: number;
          };
        };
      };
      const context = await readFile(join(root, '.omx', 'video-context.md'), 'utf-8');
      assert.equal(briefArtifact.title, 'Launch Teaser');
      assert.equal(briefArtifact.metadata?.platform, 'tiktok');
      assert.equal(briefArtifact.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(briefArtifact.metadata?.executionProfile?.quality, 'quality');
      assert.equal(briefArtifact.metadata?.executionProfile?.resolution, '1080p');
      assert.equal(briefArtifact.metadata?.executionProfile?.generateAudio, false);
      assert.equal(briefArtifact.metadata?.executionProfile?.outputCount, 2);
      assert.match(context, /brief: updated project launch-teaser for storyboard mode/);
      const projectManifest = JSON.parse(
        await readFile(join(root, 'projects', 'launch-teaser', 'project.json'), 'utf-8'),
      ) as { currentStage?: string; lastCompletedStage?: string; lastCheckpointStatus?: string };
      assert.equal(projectManifest.currentStage, 'storyboard');
      assert.equal(projectManifest.lastCompletedStage, 'brief');
      assert.equal(projectManifest.lastCheckpointStatus, 'completed');

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'launch-teaser', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0);
      const statusPayload = JSON.parse(statusResult.stdout) as { completedStages?: string[]; nextStage?: string };
      assert.deepEqual(statusPayload.completedStages, ['brief']);
      assert.equal(statusPayload.nextStage, 'storyboard');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives a platform-aware aspect ratio when brief receives a short-form platform without explicit overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-brief-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'shorts-brief', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const briefResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'brief',
          '--project',
          'shorts-brief',
          '--root',
          root,
          '--title',
          'Shorts Brief',
          '--intent',
          'Make a short-form teaser for a launch.',
          '--platform',
          'tiktok',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(briefResult.status, 0, briefResult.stderr);

      const briefPayload = JSON.parse(briefResult.stdout) as { artifactPath?: string };
      const briefArtifact = JSON.parse(await readFile(briefPayload.artifactPath!, 'utf-8')) as {
        metadata?: {
          platform?: string;
          executionProfile?: {
            aspectRatio?: string;
          };
        };
      };

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'shorts-brief', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0, statusResult.stderr);
      const statusPayload = JSON.parse(statusResult.stdout) as {
        executionProfile?: {
          aspectRatio?: string;
        };
      };

      assert.equal(briefArtifact.metadata?.platform, 'tiktok');
      assert.equal(briefArtifact.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(statusPayload.executionProfile?.aspectRatio, '9:16');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
