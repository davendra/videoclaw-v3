import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertReferenceBudget, submitSeedanceDirectNative } from '../video/native-seedance.js';

function repeat(template: (i: number) => string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => template(i));
}

const image = (i: number): string => `https://cdn.example.com/image-${i}.jpg`;
const video = (i: number): string => `https://cdn.example.com/video-${i}.mp4`;
const audio = (i: number): string => `https://cdn.example.com/audio-${i}.mp3`;

describe('assertReferenceBudget', () => {
  it('accepts exactly 9 images + 3 videos + 3 audio at the boundary', () => {
    const refs = [...repeat(image, 9), ...repeat(video, 3), ...repeat(audio, 3)];
    assert.doesNotThrow(() => assertReferenceBudget(refs));
  });

  it('throws when there are more than 9 image references', () => {
    const refs = repeat(image, 10);
    assert.throws(() => assertReferenceBudget(refs), /image/i);
    assert.throws(() => assertReferenceBudget(refs), /9/);
  });

  it('counts Asset:// URIs as images toward the image budget', () => {
    const refs = repeat((i) => `Asset://character-${i}`, 10);
    assert.throws(() => assertReferenceBudget(refs), /image/i);
  });

  it('throws when there are more than 3 video references', () => {
    const refs = repeat(video, 4);
    assert.throws(() => assertReferenceBudget(refs), /video/i);
    assert.throws(() => assertReferenceBudget(refs), /3/);
  });

  it('throws when there are more than 3 audio references', () => {
    const refs = repeat(audio, 4);
    assert.throws(() => assertReferenceBudget(refs), /audio/i);
    assert.throws(() => assertReferenceBudget(refs), /3/);
  });
});

describe('seedanceReferenceParams budget enforcement (via submit path)', () => {
  it('fails fast when a submit carries an over-budget reference set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-seedance-budget-'));
    try {
      await assert.rejects(
        submitSeedanceDirectNative({
          workspaceRoot: root,
          projectSlug: 'alpha',
          productionMode: 'director',
          routeId: 'seedance-direct',
          operationKind: 'image-to-video',
          executionProfile: {
            aspectRatio: '16:9',
            quality: 'quality',
            resolution: '720p',
            generateAudio: true,
            outputCount: 1,
          },
          generatedAt: new Date().toISOString(),
          outputDir: join(root, 'outputs'),
          tasks: [
            {
              sceneIndex: 0,
              prompt: 'Over budget on images.',
              inputKind: 'image',
              referencePaths: repeat(image, 10),
              sourceAssetIds: [],
              backendHints: [],
              characters: [],
            },
          ],
          promptGuidance: [],
        }, {
          env: { SUTUI_API_KEY: 'test-sutui' },
          fetchImpl: async () => {
            throw new Error('fetch should not be called for an over-budget submit');
          },
        }),
        /image/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects before any fetch when task 0 is in-budget but task 1 is over-budget (no partial submit)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-seedance-budget-partial-'));
    let fetchCallCount = 0;
    try {
      await assert.rejects(
        submitSeedanceDirectNative({
          workspaceRoot: root,
          projectSlug: 'alpha',
          productionMode: 'director',
          routeId: 'seedance-direct',
          operationKind: 'image-to-video',
          executionProfile: {
            aspectRatio: '16:9',
            quality: 'quality',
            resolution: '720p',
            generateAudio: true,
            outputCount: 1,
          },
          generatedAt: new Date().toISOString(),
          outputDir: join(root, 'outputs'),
          tasks: [
            {
              sceneIndex: 0,
              prompt: 'Task 0 is within budget.',
              inputKind: 'image',
              referencePaths: repeat(image, 2),
              sourceAssetIds: [],
              backendHints: [],
              characters: [],
            },
            {
              sceneIndex: 1,
              prompt: 'Task 1 is over-budget on images.',
              inputKind: 'image',
              referencePaths: repeat(image, 10),
              sourceAssetIds: [],
              backendHints: [],
              characters: [],
            },
          ],
          promptGuidance: [],
        }, {
          env: { SUTUI_API_KEY: 'test-sutui' },
          fetchImpl: async () => {
            fetchCallCount += 1;
            throw new Error('fetch must not be reached in a whole-payload preflight');
          },
        }),
        /image/i,
      );
      // Confirm fetch was never called — proving no task 0 partial submit occurred.
      assert.equal(fetchCallCount, 0, 'fetchImpl was called but should not have been');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
