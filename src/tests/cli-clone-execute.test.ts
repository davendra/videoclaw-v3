import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw clone-execute cli', () => {
  it('seeds a project from a template and executes it through the runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-clone-execute-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const submitCapturePath = join(root, 'clone-submit.json');
      const generatedVideoPath = join(root, 'generated-clone-scene-0.mp4');
      await writeFile(generatedVideoPath, 'fake-video-binary');
      await writeFile(
        join(root, '.env.local'),
        'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n',
      );

      const setupCommands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'analyze-template', '--project', 'alpha', '--root', root, '--source', 'https://example.com/ref.mp4', '--title', 'Reference Ad', '--pacing', 'fast', '--motion', 'motion-clips', '--beat', 'hook', '--beat', 'demo', '--beat', 'cta', '--keep', 'hook energy', '--change', 'topic', '--var', 'product'],
        ['video', 'template-save', '--project', 'alpha', '--root', root, '--name', 'launch-template'],
      ];
      for (const args of setupCommands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const sharedEnv = {
        ...process.env,
        USEAPI_API_TOKEN: 'test-token',
        USEAPI_ACCOUNT_EMAIL: 'test@example.com',
        VCLAW_VEO_USEAPI_SUBMIT_CMD: `cat > ${JSON.stringify(submitCapturePath)} && printf '{\"externalJobId\":\"clone-job-1\",\"status\":\"submitted\"}'`,
        VCLAW_VEO_USEAPI_POLL_CMD: `cat >/dev/null && printf '{\"status\":\"completed\",\"externalJobId\":\"clone-job-1\",\"outputs\":[{\"id\":\"generated-scene-0\",\"kind\":\"video\",\"path\":${JSON.stringify(generatedVideoPath)},\"sceneIndex\":0,\"backend\":\"veo-useapi\"}]}'`,
      };

      const cloneExecuteResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'clone-ad', '--template', 'launch-template', '--project', 'beta', '--intent', 'Make a launch teaser for a smart bottle.', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: sharedEnv,
        },
      );
      assert.equal(cloneExecuteResult.status, 0, cloneExecuteResult.stderr);
      const payload = JSON.parse(cloneExecuteResult.stdout) as {
        execution?: { report?: { status?: string; submission?: { externalJobId?: string } } };
        seedAssetManifestPath?: string;
      };
      assert.equal(payload.execution?.report?.status, 'live-submitted');
      assert.equal(payload.execution?.report?.submission?.externalJobId, 'clone-job-1');

      const statusPollResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-status', '--project', 'beta', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: sharedEnv,
        },
      );
      assert.equal(statusPollResult.status, 0, statusPollResult.stderr);
      const pollPayload = JSON.parse(statusPollResult.stdout) as { poll?: { status?: string }; assetManifestPath?: string };
      assert.equal(pollPayload.poll?.status, 'completed');

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'beta', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0);
      const statusPayload = JSON.parse(statusResult.stdout) as { nextStage?: string | null };
      assert.equal(statusPayload.nextStage, 'review');

      const assetManifest = JSON.parse(await readFile(pollPayload.assetManifestPath!, 'utf-8')) as { assets?: Array<{ id?: string }> };
      assert.ok(assetManifest.assets?.some((asset) => asset.id === 'generated-scene-0'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists platform-aware defaults through clone-execute when the platform implies a short-form ratio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-clone-execute-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const setupCommands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'analyze-template', '--project', 'alpha', '--root', root, '--source', 'https://example.com/ref.mp4', '--title', 'Reference Ad', '--pacing', 'fast', '--motion', 'motion-clips', '--beat', 'hook', '--beat', 'demo', '--beat', 'cta', '--keep', 'hook energy', '--change', 'topic', '--var', 'product'],
        ['video', 'template-save', '--project', 'alpha', '--root', root, '--name', 'launch-template'],
      ];
      for (const args of setupCommands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const cloneExecuteResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'clone-ad',
          '--template',
          'launch-template',
          '--project',
          'shorts-beta',
          '--intent',
          'Make a short-form launch teaser for a smart bottle.',
          '--root',
          root,
          '--platform',
          'shorts',
          '--dry-run',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(cloneExecuteResult.status, 0, cloneExecuteResult.stderr);
      const brief = JSON.parse(
        await readFile(join(root, 'projects', 'shorts-beta', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          platform?: string;
          executionProfile?: {
            aspectRatio?: string;
          };
        };
      };
      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'shorts-beta', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0, statusResult.stderr);
      const statusPayload = JSON.parse(statusResult.stdout) as {
        nextStage?: string | null;
        executionProfile?: {
          aspectRatio?: string;
        };
      };

      assert.equal(brief.metadata?.platform, 'shorts');
      assert.equal(brief.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(statusPayload.executionProfile?.aspectRatio, '9:16');
      assert.equal(statusPayload.nextStage, 'review');
      const eventsRaw = await readFile(join(root, 'projects', 'shorts-beta', 'events', 'events.jsonl'), 'utf-8');
      assert.match(eventsRaw, /artifact\.clone-plan\.written/);
      assert.match(eventsRaw, /artifact\.brief\.written/);
      assert.match(eventsRaw, /artifact\.storyboard\.written/);
      assert.match(eventsRaw, /"platform":"shorts"/);
      assert.match(eventsRaw, /"executionProfile":\{"aspectRatio":"9:16"\}/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
