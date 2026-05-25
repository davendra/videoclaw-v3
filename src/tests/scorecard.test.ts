import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectScorecard } from '../video/scorecard.js';

describe('buildProjectScorecard', () => {
  it('rewards completed stages and metadata completeness', () => {
    const scorecard = buildProjectScorecard({
      status: {
        slug: 'alpha',
        root: '/tmp',
        productionMode: 'storyboard',
        projectExists: true,
        nextStage: 'review',
        completedStages: ['brief', 'storyboard', 'assets'],
        pendingStages: ['review', 'publish'],
        artifactFiles: ['a', 'b', 'c'],
        checkpoints: [
          { stage: 'brief', status: 'completed', generatedAt: 'x' },
          { stage: 'storyboard', status: 'completed', generatedAt: 'x' },
          { stage: 'assets', status: 'completed', generatedAt: 'x' },
        ],
        referenceSheets: { count: 0, byType: {}, boundSceneCount: 0, unboundSheetIds: [] },
        sceneSelection: { sceneCount: 0, withSelection: 0, withPending: 0, withReroll: 0, totalCandidates: 0, rejectedCount: 0 },
      },
      manifest: {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        pipeline: { name: 'storyboard', version: '1', productionMode: 'storyboard', stages: [] },
        owner: 'davendra',
        priority: 'high',
        dueDate: '2026-05-01',
      },
    });

    assert.ok(scorecard.score >= 70);
    assert.equal(scorecard.band, 'excellent');
  });

  it('penalizes failed checkpoints', () => {
    const scorecard = buildProjectScorecard({
      status: {
        slug: 'beta',
        root: '/tmp',
        productionMode: 'storyboard',
        projectExists: true,
        nextStage: 'publish',
        completedStages: ['brief'],
        pendingStages: ['storyboard', 'assets', 'review', 'publish'],
        artifactFiles: ['a'],
        checkpoints: [
          { stage: 'brief', status: 'completed', generatedAt: 'x' },
          { stage: 'publish', status: 'failed', generatedAt: 'x' },
        ],
        referenceSheets: { count: 0, byType: {}, boundSceneCount: 0, unboundSheetIds: [] },
        sceneSelection: { sceneCount: 0, withSelection: 0, withPending: 0, withReroll: 0, totalCandidates: 0, rejectedCount: 0 },
      },
      manifest: {
        slug: 'beta',
        productionMode: 'storyboard',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        pipeline: { name: 'storyboard', version: '1', productionMode: 'storyboard', stages: [] },
      },
    });

    assert.ok(scorecard.score < 50);
    assert.equal(scorecard.band, 'poor');
  });

  it('penalizes imported legacy drift even when the workspace exists', () => {
    const scorecard = buildProjectScorecard({
      status: {
        slug: 'legacy-alpha',
        root: '/tmp',
        productionMode: 'storyboard',
        projectExists: true,
        nextStage: 'review',
        legacyImportSummary: {
          sourcePath: '/tmp/legacy-alpha',
          importedAt: '2026-04-21T10:00:00.000Z',
          imageCount: 1,
          videoCount: 0,
          finalCount: 0,
          telemetryCount: 0,
          manifestPresent: true,
          queueFilePresent: true,
          queuePendingStatusDetected: true,
          queueStatusMismatch: true,
          nestedVideoCount: 1,
          nestedFinalCount: 0,
          nestedOutputRootDetected: true,
          inferredCurrentStage: 'review',
          inferredLastCompletedStage: 'assets',
          inferredCheckpointStatus: 'completed',
        },
        completedStages: ['brief', 'storyboard', 'assets'],
        pendingStages: ['review', 'publish'],
        artifactFiles: [],
        checkpoints: [],
        referenceSheets: { count: 0, byType: {}, boundSceneCount: 0, unboundSheetIds: [] },
        sceneSelection: { sceneCount: 0, withSelection: 0, withPending: 0, withReroll: 0, totalCandidates: 0, rejectedCount: 0 },
      },
      manifest: {
        slug: 'legacy-alpha',
        productionMode: 'storyboard',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        pipeline: { name: 'storyboard', version: '1', productionMode: 'storyboard', stages: [] },
      },
    });

    assert.ok(scorecard.score < 65);
    assert.ok(scorecard.reasons.includes('Legacy import shows queue/output drift.'));
    assert.ok(scorecard.reasons.includes('Legacy import shows nested output roots.'));
  });
});
