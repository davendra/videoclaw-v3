import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeProject } from '../video/execute.js';
import { refreshExecutionStatus } from '../video/execution-status.js';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

async function seedReadyProject(root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace('alpha', root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug: 'alpha',
    productionMode: 'storyboard',
    createdAt: now,
    updatedAt: now,
    pipeline: getBuiltinPipelineManifest('storyboard'),
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Alpha',
    intent: 'Alpha intent',
    productionMode: 'storyboard',
    metadata: {
      executionProfile: {
        aspectRatio: '9:16',
        quality: 'quality',
        outputCount: 2,
      },
    },
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode: 'storyboard',
    scenes: [{ sceneIndex: 0, description: 'Scene one' }],
  }));
  await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: 'alpha',
    assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png', sceneIndex: 0, backend: 'seedance-direct' }],
  });
}

describe('veo-useapi native transport', () => {
  it('submits through the native Veo UseAPI transport with backend flag', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-useapi-'));
    const previousUseApiToken = process.env.USEAPI_API_TOKEN;
    const previousUseApiEmail = process.env.USEAPI_ACCOUNT_EMAIL;
    try {
      process.env.USEAPI_API_TOKEN = 'token';
      process.env.USEAPI_ACCOUNT_EMAIL = 'email@example.com';
      await seedReadyProject(root);
      const veoCliRoot = join(root, 'vclaw-cli');
      const outputDir = join(veoCliRoot, 'output-videos');
      const commandCapturePath = join(root, 'veo-useapi-command.txt');
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(veoCliRoot, 'flow.ts'), 'console.log("stub");\n');

      const bunStub = join(root, 'bun-useapi-stub.sh');
      await writeFile(bunStub, [
        '#!/bin/sh',
        `printf '%s\\n' "$@" > ${JSON.stringify(commandCapturePath)}`,
        'mkdir -p output-videos',
        'printf fake-video > "output-videos/$(date +%s)-scene-0.mp4"',
        '',
      ].join('\n'));
      await chmod(bunStub, 0o755);

      const submit = await executeProject('alpha', {
        root,
        productionMode: 'storyboard',
        env: {
          ...process.env,
          VCLAW_VEO_BUN_BIN: bunStub,
          VCLAW_VEO_CLI_ROOT: veoCliRoot,
        },
      });
      assert.equal(submit.report.status, 'live-submitted');
      assert.equal(submit.report.routeId, 'veo-useapi');
      assert.ok(String(submit.report.submission?.externalJobId).startsWith('veo-useapi-'));

      const poll = await refreshExecutionStatus('alpha', {
        root,
        productionMode: 'storyboard',
      });
      assert.equal(poll.poll.status, 'completed');

      const assetManifest = JSON.parse(await readFile(poll.assetManifestPath!, 'utf-8')) as {
        assets?: Array<{ id?: string; path?: string; backend?: string }>;
      };
      const generated = assetManifest.assets?.find((asset) => asset.id === 'generated-scene-0');
      assert.equal(generated?.backend, 'veo-useapi');
      assert.ok(generated?.path?.includes('output-videos'));
      const commandText = await readFile(commandCapturePath, 'utf-8');
      assert.match(commandText, /--backend\nuseapi/);
      assert.match(commandText, /-m\nquality/);
    } finally {
      if (previousUseApiToken === undefined) delete process.env.USEAPI_API_TOKEN;
      else process.env.USEAPI_API_TOKEN = previousUseApiToken;
      if (previousUseApiEmail === undefined) delete process.env.USEAPI_ACCOUNT_EMAIL;
      else process.env.USEAPI_ACCOUNT_EMAIL = previousUseApiEmail;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails with actionable context when native Veo command returns success but creates no output file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-no-output-'));
    const previousUseApiToken = process.env.USEAPI_API_TOKEN;
    const previousUseApiEmail = process.env.USEAPI_ACCOUNT_EMAIL;
    try {
      process.env.USEAPI_API_TOKEN = 'token';
      process.env.USEAPI_ACCOUNT_EMAIL = 'email@example.com';
      await seedReadyProject(root);
      const veoCliRoot = join(root, 'vclaw-cli');
      const outputDir = join(veoCliRoot, 'output-videos');
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(veoCliRoot, 'flow.ts'), 'console.log("stub");\n');

      const bunStub = join(root, 'bun-useapi-no-output-stub.sh');
      await writeFile(bunStub, [
        '#!/bin/sh',
        'echo "completed without output file"',
        'exit 0',
        '',
      ].join('\n'));
      await chmod(bunStub, 0o755);

      const result = await executeProject('alpha', {
        root,
        productionMode: 'storyboard',
        env: {
          ...process.env,
          VCLAW_VEO_BUN_BIN: bunStub,
          VCLAW_VEO_CLI_ROOT: veoCliRoot,
        },
      });
      assert.equal(result.report.status, 'blocked');
      const blockerText = (result.report.blockers ?? []).join('\n');
      assert.match(blockerText, /did not produce an output file for scene 0/);
      assert.match(blockerText, new RegExp(`cliRoot=${veoCliRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(blockerText, new RegExp(`outputDir=${outputDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(blockerText, /command output: completed without output file/);
    } finally {
      if (previousUseApiToken === undefined) delete process.env.USEAPI_API_TOKEN;
      else process.env.USEAPI_API_TOKEN = previousUseApiToken;
      if (previousUseApiEmail === undefined) delete process.env.USEAPI_ACCOUNT_EMAIL;
      else process.env.USEAPI_ACCOUNT_EMAIL = previousUseApiEmail;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails with actionable guidance when flow.ts is missing in the resolved Veo CLI root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-missing-google-ts-'));
    const previousUseApiToken = process.env.USEAPI_API_TOKEN;
    const previousUseApiEmail = process.env.USEAPI_ACCOUNT_EMAIL;
    try {
      process.env.USEAPI_API_TOKEN = 'token';
      process.env.USEAPI_ACCOUNT_EMAIL = 'email@example.com';
      await seedReadyProject(root);

      const result = await executeProject('alpha', {
        root,
        productionMode: 'storyboard',
        env: {
          ...process.env,
        },
      });
      assert.equal(result.report.status, 'blocked');
      const blockerText = (result.report.blockers ?? []).join('\n');
      assert.match(blockerText, /could not find flow\.ts/);
      assert.match(blockerText, /Set VCLAW_VEO_CLI_ROOT/);
      assert.match(blockerText, /videoclaw-v2\/vclaw-cli/);
    } finally {
      if (previousUseApiToken === undefined) delete process.env.USEAPI_API_TOKEN;
      else process.env.USEAPI_API_TOKEN = previousUseApiToken;
      if (previousUseApiEmail === undefined) delete process.env.USEAPI_ACCOUNT_EMAIL;
      else process.env.USEAPI_ACCOUNT_EMAIL = previousUseApiEmail;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails with cookie refresh guidance when the native command reports session refresh errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-refresh-fail-'));
    const previousUseApiToken = process.env.USEAPI_API_TOKEN;
    const previousUseApiEmail = process.env.USEAPI_ACCOUNT_EMAIL;
    try {
      process.env.USEAPI_API_TOKEN = 'token';
      process.env.USEAPI_ACCOUNT_EMAIL = 'email@example.com';
      await seedReadyProject(root);
      const veoCliRoot = join(root, 'vclaw-cli');
      const outputDir = join(veoCliRoot, 'output-videos');
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(veoCliRoot, 'flow.ts'), 'console.log("stub");\n');

      const bunStub = join(root, 'bun-useapi-refresh-fail-stub.sh');
      await writeFile(bunStub, [
        '#!/bin/sh',
        'echo \'Warning: Account status is "error". Failed to refresh session.\' 1>&2',
        'exit 1',
        '',
      ].join('\n'));
      await chmod(bunStub, 0o755);

      const result = await executeProject('alpha', {
        root,
        productionMode: 'storyboard',
        env: {
          ...process.env,
          VCLAW_VEO_BUN_BIN: bunStub,
          VCLAW_VEO_CLI_ROOT: veoCliRoot,
        },
      });
      assert.equal(result.report.status, 'blocked');
      const blockerText = (result.report.blockers ?? []).join('\n');
      assert.match(blockerText, /session refresh failed/i);
      assert.match(blockerText, /cookie\.json/);
      assert.match(blockerText, /setup-google-flow/);
    } finally {
      if (previousUseApiToken === undefined) delete process.env.USEAPI_API_TOKEN;
      else process.env.USEAPI_API_TOKEN = previousUseApiToken;
      if (previousUseApiEmail === undefined) delete process.env.USEAPI_ACCOUNT_EMAIL;
      else process.env.USEAPI_ACCOUNT_EMAIL = previousUseApiEmail;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails with cookie refresh guidance when the native command exits 0 but reports session refresh errors and creates no output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-refresh-fail-no-output-'));
    const previousUseApiToken = process.env.USEAPI_API_TOKEN;
    const previousUseApiEmail = process.env.USEAPI_ACCOUNT_EMAIL;
    try {
      process.env.USEAPI_API_TOKEN = 'token';
      process.env.USEAPI_ACCOUNT_EMAIL = 'email@example.com';
      await seedReadyProject(root);
      const veoCliRoot = join(root, 'vclaw-cli');
      const outputDir = join(veoCliRoot, 'output-videos');
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(veoCliRoot, 'flow.ts'), 'console.log("stub");\n');

      const bunStub = join(root, 'bun-useapi-refresh-fail-no-output-stub.sh');
      await writeFile(bunStub, [
        '#!/bin/sh',
        'echo \'Warning: Account status is "error". Failed to refresh session. Please update cookies STRICTLY following the instructions at https://useapi.net/docs/start-here/setup-google-flow\'',
        'exit 0',
        '',
      ].join('\n'));
      await chmod(bunStub, 0o755);

      const result = await executeProject('alpha', {
        root,
        productionMode: 'storyboard',
        env: {
          ...process.env,
          VCLAW_VEO_BUN_BIN: bunStub,
          VCLAW_VEO_CLI_ROOT: veoCliRoot,
        },
      });
      assert.equal(result.report.status, 'blocked');
      const blockerText = (result.report.blockers ?? []).join('\n');
      assert.match(blockerText, /session refresh failed/i);
      assert.match(blockerText, /cookie\.json/);
      assert.match(blockerText, /setup-google-flow/);
      assert.match(blockerText, /Original output:/);
    } finally {
      if (previousUseApiToken === undefined) delete process.env.USEAPI_API_TOKEN;
      else process.env.USEAPI_API_TOKEN = previousUseApiToken;
      if (previousUseApiEmail === undefined) delete process.env.USEAPI_ACCOUNT_EMAIL;
      else process.env.USEAPI_ACCOUNT_EMAIL = previousUseApiEmail;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails with cookie refresh guidance when the native command times out after reporting session refresh errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-refresh-timeout-'));
    const previousUseApiToken = process.env.USEAPI_API_TOKEN;
    const previousUseApiEmail = process.env.USEAPI_ACCOUNT_EMAIL;
    try {
      process.env.USEAPI_API_TOKEN = 'token';
      process.env.USEAPI_ACCOUNT_EMAIL = 'email@example.com';
      await seedReadyProject(root);
      const veoCliRoot = join(root, 'vclaw-cli');
      const outputDir = join(veoCliRoot, 'output-videos');
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(veoCliRoot, 'flow.ts'), 'console.log("stub");\n');

      const bunStub = join(root, 'bun-useapi-refresh-timeout-stub.sh');
      await writeFile(bunStub, [
        '#!/bin/sh',
        'echo \'Warning: Account status is "error". Failed to refresh session. Please update cookies STRICTLY following the instructions at https://useapi.net/docs/start-here/setup-google-flow\' 1>&2',
        'sleep 2',
        'exit 0',
        '',
      ].join('\n'));
      await chmod(bunStub, 0o755);

      const result = await executeProject('alpha', {
        root,
        productionMode: 'storyboard',
        env: {
          ...process.env,
          VCLAW_VEO_BUN_BIN: bunStub,
          VCLAW_VEO_CLI_ROOT: veoCliRoot,
          VCLAW_VEO_COMMAND_TIMEOUT_MS: '1000',
        },
      });
      assert.equal(result.report.status, 'blocked');
      const blockerText = (result.report.blockers ?? []).join('\n');
      assert.match(blockerText, /timed out/i);
      assert.match(blockerText, /session refresh failed/i);
      assert.match(blockerText, /cookie\.json/);
      assert.match(blockerText, /setup-google-flow/);
      assert.match(blockerText, /Original output:/);
    } finally {
      if (previousUseApiToken === undefined) delete process.env.USEAPI_API_TOKEN;
      else process.env.USEAPI_API_TOKEN = previousUseApiToken;
      if (previousUseApiEmail === undefined) delete process.env.USEAPI_ACCOUNT_EMAIL;
      else process.env.USEAPI_ACCOUNT_EMAIL = previousUseApiEmail;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails with actionable guidance when the native command times out before emitting output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-veo-timeout-no-output-'));
    const previousUseApiToken = process.env.USEAPI_API_TOKEN;
    const previousUseApiEmail = process.env.USEAPI_ACCOUNT_EMAIL;
    try {
      process.env.USEAPI_API_TOKEN = 'token';
      process.env.USEAPI_ACCOUNT_EMAIL = 'email@example.com';
      await seedReadyProject(root);
      const veoCliRoot = join(root, 'vclaw-cli');
      const outputDir = join(veoCliRoot, 'output-videos');
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(veoCliRoot, 'flow.ts'), 'console.log("stub");\n');

      const bunStub = join(root, 'bun-useapi-timeout-no-output-stub.sh');
      await writeFile(bunStub, [
        '#!/bin/sh',
        'sleep 2',
        'exit 0',
        '',
      ].join('\n'));
      await chmod(bunStub, 0o755);

      const result = await executeProject('alpha', {
        root,
        productionMode: 'storyboard',
        env: {
          ...process.env,
          VCLAW_VEO_BUN_BIN: bunStub,
          VCLAW_VEO_CLI_ROOT: veoCliRoot,
          VCLAW_VEO_COMMAND_TIMEOUT_MS: '50',
        },
      });
      assert.equal(result.report.status, 'blocked');
      const blockerText = (result.report.blockers ?? []).join('\n');
      assert.match(blockerText, /timed out/i);
      assert.match(blockerText, /cookie\.json/);
      assert.match(blockerText, /setup-google-flow/);
    } finally {
      if (previousUseApiToken === undefined) delete process.env.USEAPI_API_TOKEN;
      else process.env.USEAPI_API_TOKEN = previousUseApiToken;
      if (previousUseApiEmail === undefined) delete process.env.USEAPI_ACCOUNT_EMAIL;
      else process.env.USEAPI_ACCOUNT_EMAIL = previousUseApiEmail;
      await rm(root, { recursive: true, force: true });
    }
  });
});
