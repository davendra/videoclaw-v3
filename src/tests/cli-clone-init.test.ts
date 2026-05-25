import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw clone-init cli', () => {
  it('creates a clone plan and seeded brief from a saved template', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-clone-init-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'analyze', '--project', 'alpha', '--root', root, '--source', 'https://example.com/ref.mp4', '--title', 'Reference Ad', '--pacing', 'fast', '--motion', 'motion-clips', '--beat', 'hook', '--beat', 'demo', '--beat', 'cta', '--keep', 'hook energy', '--change', 'topic', '--var', 'product'],
        ['video', 'template-save', '--project', 'alpha', '--root', root, '--name', 'launch-template'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const cloneInit = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'clone-init',
          '--template',
          'launch-template',
          '--project',
          'beta',
          '--intent',
          'Make a launch teaser for a smart bottle.',
          '--root',
          root,
          '--platform',
          'shorts',
          '--aspect-ratio',
          '9:16',
          '--quality',
          'quality',
          '--resolution',
          '1080p',
          '--audio',
          'off',
          '--outputs',
          '2',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(cloneInit.status, 0);
      const payload = JSON.parse(cloneInit.stdout) as { clonePlanPath?: string; briefPath?: string };
      const clonePlan = JSON.parse(await readFile(payload.clonePlanPath!, 'utf-8')) as { templateName?: string; beats?: string[] };
      const brief = JSON.parse(await readFile(payload.briefPath!, 'utf-8')) as {
        metadata?: {
          templateName?: string;
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
      const manifest = JSON.parse(await readFile(join(root, 'projects', 'beta', 'project.json'), 'utf-8')) as { currentStage?: string; lastCompletedStage?: string };

      assert.equal(clonePlan.templateName, 'launch-template');
      assert.deepEqual(clonePlan.beats, ['hook', 'demo', 'cta']);
      assert.equal(brief.metadata?.templateName, 'launch-template');
      assert.equal(brief.metadata?.platform, 'shorts');
      assert.equal(brief.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(brief.metadata?.executionProfile?.quality, 'quality');
      assert.equal(brief.metadata?.executionProfile?.resolution, '1080p');
      assert.equal(brief.metadata?.executionProfile?.generateAudio, false);
      assert.equal(brief.metadata?.executionProfile?.outputCount, 2);
      assert.equal(manifest.currentStage, 'storyboard');
      assert.equal(manifest.lastCompletedStage, 'brief');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives a platform-aware aspect ratio when clone-init receives a short-form platform without explicit overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-clone-init-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'analyze', '--project', 'alpha', '--root', root, '--source', 'https://example.com/ref.mp4', '--title', 'Reference Ad', '--pacing', 'fast', '--motion', 'motion-clips', '--beat', 'hook', '--beat', 'demo', '--beat', 'cta', '--keep', 'hook energy', '--change', 'topic', '--var', 'product'],
        ['video', 'template-save', '--project', 'alpha', '--root', root, '--name', 'launch-template'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const cloneInit = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'clone-init',
          '--template',
          'launch-template',
          '--project',
          'gamma',
          '--intent',
          'Make a short-form launch teaser.',
          '--root',
          root,
          '--platform',
          'shorts',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(cloneInit.status, 0, cloneInit.stderr);

      const payload = JSON.parse(cloneInit.stdout) as { briefPath?: string };
      const brief = JSON.parse(await readFile(payload.briefPath!, 'utf-8')) as {
        metadata?: {
          platform?: string;
          executionProfile?: {
            aspectRatio?: string;
          };
        };
      };
      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'gamma', '--root', root],
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

      assert.equal(brief.metadata?.platform, 'shorts');
      assert.equal(brief.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(statusPayload.executionProfile?.aspectRatio, '9:16');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
