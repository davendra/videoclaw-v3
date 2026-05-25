import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeProject } from '../video/execute.js';
import { cancelExecution } from '../video/execution-cancel.js';
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
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode: 'storyboard',
    scenes: [{ sceneIndex: 0, description: 'Scene one', durationSeconds: 6 }],
  }));
  await writeArtifact(workspace, 'asset-manifest', {
    projectSlug: 'alpha',
    assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png', sceneIndex: 0, backend: 'veo-useapi' }],
  });
  await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');
}

describe('cancelExecution', () => {
  it('cancels a configured veo-useapi adapter job and marks the report failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-cancel-'));

    try {
      await seedReadyProject(root);
      const adapterPath = join(root, 'veo-adapter.sh');
      await writeFile(adapterPath, [
        '#!/bin/sh',
        'PAYLOAD="$(cat)"',
        'if echo "$PAYLOAD" | grep -q \'"action":"cancel"\'; then',
        '  printf \'{"status":"cancelled","externalJobId":"job-1","issues":[]}\'',
        'else',
        '  printf \'{"externalJobId":"job-1","status":"submitted"}\'',
        'fi',
        '',
      ].join('\n'));
      await chmod(adapterPath, 0o755);

      const env = {
        ...process.env,
        VCLAW_VEO_USEAPI_ADAPTER: adapterPath,
      };

      const submit = await executeProject('alpha', { root, env });
      assert.equal(submit.report.status, 'live-submitted');

      const cancellation = await cancelExecution('alpha', { root, env });
      assert.equal(cancellation.cancellation.status, 'cancelled');
      assert.equal(cancellation.report.status, 'blocked');
      assert.equal(cancellation.report.poll?.status, 'failed');
      assert.ok(cancellation.report.poll?.issues.some((issue) => issue.includes('cancelled by operator')));

      const report = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'execution-report.json'), 'utf-8'),
      ) as { poll?: { status?: string; issues?: string[] } };
      assert.equal(report.poll?.status, 'failed');
      assert.ok(report.poll?.issues?.some((issue) => issue.includes('cancelled by operator')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns an unsupported cancellation result for built-in routes that do not support cancel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-execution-cancel-'));
    try {
      await seedReadyProject(root);
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'execution-report', {
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        operationKind: 'image-to-video',
        routeId: 'veo-useapi',
        status: 'live-submitted',
        dryRun: false,
        generatedAt: new Date().toISOString(),
        blockers: [],
        executedSteps: ['validated-readiness', 'selected-provider-route', 'submitted-provider-adapter'],
        submission: {
          adapterCommand: 'builtin',
          externalJobId: 'veo-useapi-job-1',
          rawResult: { externalJobId: 'veo-useapi-job-1' },
        },
      });

      const cancellation = await cancelExecution('alpha', { root });
      assert.equal(cancellation.cancellation.status, 'unsupported');
      assert.equal(cancellation.report.status, 'blocked');
      assert.equal(cancellation.report.poll?.status, 'failed');
      assert.ok(cancellation.report.poll?.issues.some((issue) => issue.includes('does not support cancel')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
