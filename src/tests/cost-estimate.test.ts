import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { buildProjectCostEstimate, buildVideoCostEstimate } from '../video/cost-estimate.js';
import { appendGenerationTelemetry } from '../video/generation-telemetry.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('cost estimate', () => {
  it('computes the legacy-style estimate from direct inputs', () => {
    const estimate = buildVideoCostEstimate({
      sceneCount: 14,
      clipDurationSeconds: 15,
      newCharacterCount: 2,
      narrationEnabled: true,
    });

    assert.equal(estimate.seedancePerSceneUsd, 0.4);
    assert.equal(estimate.seedanceTotalUsd, 5.6);
    assert.equal(estimate.geminiTotalUsd, 0.03);
    assert.equal(estimate.goBananasTotalUsd, 0.1);
    assert.equal(estimate.elevenLabsTotalUsd, 0.14);
    assert.equal(estimate.totalUsd, 5.87);
    assert.equal(estimate.wallTimeMinutes, 61);
  });

  it('derives estimate defaults from a project storyboard and character set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cost-estimate-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'director',
        metadata: {
          executionProfile: {
            generateAudio: false,
          },
        },
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [
          { sceneIndex: 0, description: 'Scene one', durationSeconds: 12 },
          { sceneIndex: 1, description: 'Scene two', durationSeconds: 12 },
          { sceneIndex: 2, description: 'Scene three', durationSeconds: 12 },
        ],
      }));
      await addCharacterProfile(workspace, {
        name: 'Nova',
      });
      await addCharacterProfile(workspace, {
        name: 'Mochi',
        goBananasId: 247,
      });

      const estimate = await buildProjectCostEstimate({
        projectSlug: 'alpha',
        root,
      });

      assert.equal(estimate.sceneCount, 3);
      assert.equal(estimate.clipDurationSeconds, 12);
      assert.equal(estimate.newCharacterCount, 1);
      assert.equal(estimate.narrationEnabled, false);
      assert.equal(estimate.seedancePerSceneUsd, 0.4);
      assert.equal(estimate.seedanceTotalUsd, 1.2);
      assert.equal(estimate.goBananasTotalUsd, 0.05);
      assert.equal(estimate.elevenLabsTotalUsd, 0);
      assert.equal(estimate.totalUsd, 1.28);
      assert.equal(estimate.wallTimeMinutes, 17);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses completed Seedance USD telemetry when estimating future scenes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cost-estimate-'));
    try {
      const historyWorkspace = await ensureProjectWorkspace('history', root);
      await appendGenerationTelemetry(historyWorkspace, {
        schemaVersion: 1,
        projectSlug: 'history',
        routeId: 'seedance-direct',
        operationKind: 'text-to-video',
        status: 'completed',
        dryRun: false,
        recordedAt: '2026-05-03T12:00:00.000Z',
        taskCount: 2,
        sceneIndices: [0, 1],
        config: {
          referenceImageCount: 0,
          referenceVideoCount: 0,
          referenceAudioCount: 0,
          promptWordCount: 18,
        },
        cost: {
          usd: 1,
          source: 'provider-response',
        },
      });

      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'director',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [
          { sceneIndex: 0, description: 'Scene one', durationSeconds: 12 },
          { sceneIndex: 1, description: 'Scene two', durationSeconds: 12 },
          { sceneIndex: 2, description: 'Scene three', durationSeconds: 12 },
        ],
      }));

      const estimate = await buildProjectCostEstimate({
        projectSlug: 'alpha',
        root,
        narrationEnabled: false,
      });

      assert.equal(estimate.estimateSource, 'historical-telemetry');
      assert.equal(estimate.seedancePerSceneUsd, 0.5);
      assert.equal(estimate.seedanceTotalUsd, 1.5);
      assert.equal(estimate.totalUsd, 1.53);
      assert.equal(estimate.telemetry?.sampleCount, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
