import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw execute cli', () => {
  it('prints a dry-run execution report for a ready project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cli-'));
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

      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const executeResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute', '--project', 'alpha', '--root', root, '--dry-run'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(executeResult.status, 0);
      const payload = JSON.parse(executeResult.stdout) as { report?: { status?: string; dryRun?: boolean } };
      assert.equal(payload.report?.status, 'dry-run-complete');
      assert.equal(payload.report?.dryRun, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('submits a live execution report through a configured adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cli-'));
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

      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');
      const adapterPath = join(root, 'veo-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'cat >/dev/null',
        'printf \'{"externalJobId":"job-cli-1","status":"submitted"}\'',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      const executeResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
          },
        },
      );
      assert.equal(executeResult.status, 0, executeResult.stderr);
      const payload = JSON.parse(executeResult.stdout) as { report?: { status?: string; dryRun?: boolean; submission?: { externalJobId?: string } } };
      assert.equal(payload.report?.status, 'live-submitted');
      assert.equal(payload.report?.dryRun, false);
      assert.equal(payload.report?.submission?.externalJobId, 'job-cli-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports the lifecycle alias `video produce`', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cli-'));
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

      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const executeResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'produce', '--project', 'alpha', '--root', root, '--dry-run'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(executeResult.status, 0);
      const payload = JSON.parse(executeResult.stdout) as { report?: { status?: string; dryRun?: boolean } };
      assert.equal(payload.report?.status, 'dry-run-complete');
      assert.equal(payload.report?.dryRun, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks director execution until storyboard approval is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--mode', 'director', '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:veo-useapi'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const executeResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute', '--project', 'alpha', '--root', root, '--mode', 'director', '--dry-run'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(executeResult.status, 0, executeResult.stderr);
      const payload = JSON.parse(executeResult.stdout) as { report?: { status?: string; blockers?: string[] } };
      assert.equal(payload.report?.status, 'blocked');
      assert.ok(payload.report?.blockers?.some((item) => item.includes('VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video execute --project "alpha" --root') && item.includes('--mode director')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks stale director review execution even when approval is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--mode', 'director', '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'assets', '--project', 'alpha', '--root', root, '--asset', 'image:/tmp/image.png:0:veo-useapi'],
        ['video', 'storyboard-review', '--project', 'alpha', '--root', root, '--mode', 'director'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
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
      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');

      const executeResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute', '--project', 'alpha', '--root', root, '--mode', 'director', '--dry-run'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VIDEOCLAW_APPROVE_STORYBOARD: '1',
          },
        },
      );
      assert.equal(executeResult.status, 0, executeResult.stderr);
      const payload = JSON.parse(executeResult.stdout) as { report?: { status?: string; blockers?: string[] } };
      assert.equal(payload.report?.status, 'blocked');
      assert.ok(payload.report?.blockers?.some((item) => item.includes('Storyboard review is stale')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
