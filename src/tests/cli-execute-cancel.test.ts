import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw execute-cancel cli', () => {
  it('cancels a submitted execution through the adapter surface', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cancel-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const adapterPath = join(root, 'veo-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'INPUT=$(cat)',
        'if echo "$INPUT" | grep -q \'"action":"cancel"\'; then',
        '  printf \'{"status":"cancelled","externalJobId":"job-cli-cancel","issues":[]}\';',
        'elif echo "$INPUT" | grep -q \'"action":"poll"\'; then',
        '  printf \'{"status":"pending","externalJobId":"job-cli-cancel","outputs":[],"issues":[]}\';',
        'else',
        '  printf \'{"externalJobId":"job-cli-cancel","status":"submitted"}\';',
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

      const cancelResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-cancel', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
          },
        },
      );
      assert.equal(cancelResult.status, 0, cancelResult.stderr);
      const payload = JSON.parse(cancelResult.stdout) as {
        cancellation?: { status?: string };
        report?: { status?: string; poll?: { status?: string; issues?: string[] } };
      };
      assert.equal(payload.cancellation?.status, 'cancelled');
      assert.equal(payload.report?.status, 'blocked');
      assert.equal(payload.report?.poll?.status, 'failed');
      assert.ok(payload.report?.poll?.issues?.some((issue) => issue.includes('cancelled by operator')));

      const report = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'execution-report.json'), 'utf-8'),
      ) as { poll?: { status?: string } };
      assert.equal(report.poll?.status, 'failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns structured unsupported JSON when no live adapter job id is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cancel-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const projectDir = join(root, 'projects', 'alpha');
      const artifactsDir = join(projectDir, 'artifacts');
      await mkdir(artifactsDir, { recursive: true });

      await writeFile(join(projectDir, 'project.json'), JSON.stringify({
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pipeline: {
          name: 'storyboard',
          stages: [
            { name: 'brief', requiredArtifacts: ['brief'] },
            { name: 'storyboard', requiredArtifacts: ['storyboard'] },
            { name: 'assets', requiredArtifacts: ['asset-manifest'] },
            { name: 'review', requiredArtifacts: ['review-report'] },
            { name: 'publish', requiredArtifacts: ['publish-report'] },
          ],
        },
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'failed',
      }, null, 2));
      await writeFile(join(artifactsDir, 'execution-report.json'), JSON.stringify({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        operationKind: 'image-to-video',
        routeId: 'veo-useapi',
        status: 'blocked',
        dryRun: false,
        generatedAt: new Date().toISOString(),
        blockers: ['submission failed before live job id was created'],
        executedSteps: ['validated-readiness', 'selected-provider-route'],
      }, null, 2));

      const cancelResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-cancel', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(cancelResult.status, 0, cancelResult.stderr);
      const payload = JSON.parse(cancelResult.stdout) as {
        reportPath?: string | null;
        report?: { status?: string; blockers?: string[] };
        cancellation?: { status?: string; externalJobId?: string | null; issues?: string[] };
      };
      assert.equal(payload.reportPath, null);
      assert.equal(payload.report?.status, 'blocked');
      assert.ok(payload.report?.blockers?.some((issue) => issue.includes('no live adapter job id')));
      assert.equal(payload.cancellation?.status, 'unsupported');
      assert.equal(payload.cancellation?.externalJobId, null);
      assert.ok(payload.cancellation?.issues?.some((issue) => issue.includes('no live adapter job id')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns structured unsupported JSON when execution-report is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cancel-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const projectDir = join(root, 'projects', 'alpha');
      await mkdir(projectDir, { recursive: true });

      await writeFile(join(projectDir, 'project.json'), JSON.stringify({
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pipeline: {
          name: 'storyboard',
          stages: [
            { name: 'brief', requiredArtifacts: ['brief'] },
            { name: 'storyboard', requiredArtifacts: ['storyboard'] },
            { name: 'assets', requiredArtifacts: ['asset-manifest'] },
            { name: 'review', requiredArtifacts: ['review-report'] },
            { name: 'publish', requiredArtifacts: ['publish-report'] },
          ],
        },
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'failed',
      }, null, 2));

      const cancelResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-cancel', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(cancelResult.status, 0, cancelResult.stderr);
      const payload = JSON.parse(cancelResult.stdout) as {
        reportPath?: string | null;
        report?: { status?: string; blockers?: string[] };
        cancellation?: { status?: string; externalJobId?: string | null; issues?: string[] };
      };
      assert.equal(payload.reportPath, null);
      assert.equal(payload.report?.status, 'blocked');
      assert.ok(payload.report?.blockers?.some((issue) => issue.includes('execution-report artifact is missing')));
      assert.equal(payload.cancellation?.status, 'unsupported');
      assert.equal(payload.cancellation?.externalJobId, null);
      assert.ok(payload.cancellation?.issues?.some((issue) => issue.includes('execution-report artifact is missing')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns structured unsupported JSON when project manifest is missing and does not create the project directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execute-cancel-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const projectDir = join(root, 'projects', 'ghost');
      assert.equal(existsSync(projectDir), false);

      const cancelResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'execute-cancel', '--project', 'ghost', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(cancelResult.status, 0, cancelResult.stderr);
      const payload = JSON.parse(cancelResult.stdout) as {
        reportPath?: string | null;
        report?: { status?: string; blockers?: string[] };
        cancellation?: { status?: string; externalJobId?: string | null; issues?: string[] };
      };
      assert.equal(payload.reportPath, null);
      assert.equal(payload.report?.status, 'blocked');
      assert.ok(payload.report?.blockers?.some((issue) => issue.includes('project manifest is missing')));
      assert.equal(payload.cancellation?.status, 'unsupported');
      assert.equal(payload.cancellation?.externalJobId, null);
      assert.ok(payload.cancellation?.issues?.some((issue) => issue.includes('project manifest is missing')));
      assert.equal(existsSync(projectDir), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
