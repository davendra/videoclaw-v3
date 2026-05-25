import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw execute-status cli', () => {
  it('returns failed poll JSON (exit 0) when the project manifest is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const pollResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-status', '--project', 'missing-project', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(pollResult.status, 0, pollResult.stderr);
      const payload = JSON.parse(pollResult.stdout) as {
        poll?: { status?: string; rawResult?: { reason?: string } };
        report?: { blockers?: string[] };
      };
      assert.equal(payload.poll?.status, 'failed');
      assert.equal(payload.poll?.rawResult?.reason, 'missing-project-manifest');
      assert.ok(payload.report?.blockers?.some((item) => item.includes('project manifest is missing')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns failed poll JSON (exit 0) when execution-report artifact is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:veo-useapi'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const pollResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-status', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(pollResult.status, 0, pollResult.stderr);
      const payload = JSON.parse(pollResult.stdout) as { poll?: { status?: string; rawResult?: { reason?: string } } };
      assert.equal(payload.poll?.status, 'failed');
      assert.equal(payload.poll?.rawResult?.reason, 'missing-execution-report');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('polls a submitted job and advances the project when outputs are ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const adapterPath = join(root, 'veo-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'INPUT=$(cat)',
        'if echo "$INPUT" | grep -q \'"action":"poll"\'; then',
        '  printf \'{"status":"completed","externalJobId":"job-cli-1","outputs":[{"id":"generated-scene-0","kind":"video","path":"/tmp/generated-scene-0.mp4","sceneIndex":0,"backend":"seedance-direct"}]}\'',
        'else',
        '  printf \'{"externalJobId":"job-cli-1","status":"submitted"}\'',
        'fi',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:veo-useapi'],
        ['video', 'execute', '--project', 'alpha', '--root', root],
      ];

      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
          },
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const pollResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-status', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
          },
        },
      );
      assert.equal(pollResult.status, 0, pollResult.stderr);
      const payload = JSON.parse(pollResult.stdout) as { poll?: { status?: string }; assetManifestPath?: string };
      assert.equal(payload.poll?.status, 'completed');

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0);
      const statusPayload = JSON.parse(statusResult.stdout) as { completedStages?: string[]; nextStage?: string | null };
      assert.ok(statusPayload.completedStages?.includes('assets'));
      assert.equal(statusPayload.nextStage, 'review');

      const assetManifest = JSON.parse(await readFile(payload.assetManifestPath!, 'utf-8')) as {
        assets?: Array<{ id?: string }>;
      };
      assert.ok(assetManifest.assets?.some((asset) => asset.id === 'generated-scene-0'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks stale director review polling before provider status refresh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const adapterPath = join(root, 'veo-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'INPUT=$(cat)',
        'if echo "$INPUT" | grep -q \'"action":"poll"\'; then',
        '  printf \'{"status":"completed","externalJobId":"job-cli-2","outputs":[{"id":"generated-scene-0","kind":"video","path":"/tmp/generated-scene-0.mp4","sceneIndex":0,"backend":"seedance-direct"}]}\'',
        'else',
        '  printf \'{"externalJobId":"job-cli-2","status":"submitted"}\'',
        'fi',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      const commands = [
        ['video', 'init', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--mode', 'director', '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:veo-useapi'],
        ['video', 'storyboard-review', '--project', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'execute', '--project', 'alpha', '--root', root, '--mode', 'director'],
      ];

      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VIDEOCLAW_APPROVE_STORYBOARD: '1',
            VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
          },
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      await writeFile(
        join(root, 'projects', 'alpha', 'events', 'events.jsonl'),
        [
          JSON.stringify({ type: 'storyboard.review.generated', recordedAt: '2026-04-20T10:00:00.000Z', payload: { markdownPath: join(root, 'projects', 'alpha', 'storyboard.md') } }),
          JSON.stringify({ type: 'artifact.storyboard.written', recordedAt: '2026-04-20T11:00:00.000Z', payload: { artifactPath: join(root, 'projects', 'alpha', 'artifacts', 'storyboard.json') } }),
          '',
        ].join('\n'),
      );

      const pollResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-status', '--project', 'alpha', '--root', root, '--mode', 'director'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
          },
        },
      );
      assert.notEqual(pollResult.status, 0);
      assert.match(pollResult.stderr, /storyboard review is stale/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns failed poll JSON (exit 0) with preserved blockers when the last execution report has no live adapter job id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const failingAdapterPath = join(root, 'veo-fail-adapter.sh');
      await writeFile(failingAdapterPath, [
        '#!/bin/sh',
        'cat >/dev/null',
        'echo "simulated submit failure" >&2',
        'exit 1',
        '',
      ].join('\n'));
      await chmod(failingAdapterPath, 0o755);

      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:veo-useapi'],
        ['video', 'execute', '--project', 'alpha', '--root', root],
      ];

      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VCLAW_VEO_USEAPI_ADAPTER: failingAdapterPath,
          },
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const pollResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-status', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(pollResult.status, 0, pollResult.stderr);
      const payload = JSON.parse(pollResult.stdout) as { poll?: { status?: string; issues?: string[] } };
      assert.equal(payload.poll?.status, 'failed');
      assert.ok(payload.poll?.issues?.some((item) => item.includes('simulated submit failure')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns failed poll JSON (exit 0) with preserved blockers when the last execution report has no provider route id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-status-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:veo-useapi'],
        ['video', 'execute', '--project', 'alpha', '--root', root],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const pollResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-status', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(pollResult.status, 0, pollResult.stderr);
      const payload = JSON.parse(pollResult.stdout) as { poll?: { status?: string; issues?: string[] } };
      assert.equal(payload.poll?.status, 'failed');
      assert.ok(payload.poll?.issues?.some((item) => item.includes('No available provider route supports image-to-video')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
