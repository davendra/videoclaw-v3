import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendGenerationTelemetry,
  buildGenerationTelemetryFromReport,
  extractProviderMetrics,
  readProjectGenerationTelemetry,
} from '../video/generation-telemetry.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('generation telemetry', () => {
  it('extracts provider metrics from nested raw responses', () => {
    const metrics = extractProviderMetrics({
      data: {
        creditsCharged: 24,
        billing: { totalUsd: 1.25 },
        timing: { generationTimeSec: 42 },
      },
    });
    assert.deepEqual(metrics, {
      creditsCharged: 24,
      usd: 1.25,
      generationTimeSec: 42,
    });
  });

  it('records execution report telemetry as project events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-generation-telemetry-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const entry = buildGenerationTelemetryFromReport({
        report: {
          projectSlug: 'alpha',
          productionMode: 'director',
          operationKind: 'image-to-video',
          routeId: 'seedance-direct',
          status: 'live-submitted',
          dryRun: false,
          generatedAt: '2026-05-03T12:00:00.000Z',
          blockers: [],
          executedSteps: ['submitted-provider-adapter'],
          taskCount: 1,
          submission: {
            externalJobId: 'job-1',
            rawResult: { costUsd: 0.5 },
          },
        },
        payload: {
          workspaceRoot: root,
          projectSlug: 'alpha',
          productionMode: 'director',
          routeId: 'seedance-direct',
          operationKind: 'image-to-video',
          executionProfile: {
            aspectRatio: '9:16',
            quality: 'quality',
            resolution: '1080p',
            generateAudio: true,
            outputCount: 1,
          },
          generatedAt: '2026-05-03T12:00:00.000Z',
          outputDir: join(root, 'outputs'),
          tasks: [{
            sceneIndex: 0,
            prompt: 'Nova smiles and lifts the product.',
            inputKind: 'image',
            referencePaths: ['refs/nova.png'],
            sourceAssetIds: ['image-1'],
            backendHints: [],
            characters: ['Nova'],
            durationSeconds: 5,
          }],
          promptGuidance: [],
        },
      });

      await appendGenerationTelemetry(workspace, entry);
      const telemetry = await readProjectGenerationTelemetry(workspace);

      assert.equal(telemetry.length, 1);
      assert.equal(telemetry[0]?.status, 'submitted');
      assert.equal(telemetry[0]?.cost?.usd, 0.5);
      assert.equal(telemetry[0]?.config.referenceImageCount, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
