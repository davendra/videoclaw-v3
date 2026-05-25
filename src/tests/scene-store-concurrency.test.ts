import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readSceneCandidatesArtifact,
  writeSceneCandidatesArtifact,
} from '../video/scene-candidate-store.js';
import {
  readSceneSelectionArtifact,
  writeSceneSelectionArtifact,
} from '../video/scene-selection-store.js';

describe('scene store concurrency', () => {
  it('keeps scene-candidates and scene-selection JSON readable during concurrent writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-scene-store-concurrency-'));
    const slug = 'alpha';
    try {
      await writeSceneCandidatesArtifact(root, slug, {
        schemaVersion: 1,
        scenes: [{ sceneIndex: 0, candidates: [] }],
      });
      await writeSceneSelectionArtifact(root, slug, {
        schemaVersion: 1,
        scenes: [{
          sceneIndex: 0,
          selectedCandidateId: null,
          rejectedCandidateIds: [],
          pendingCandidateIds: [],
          rerollRequested: false,
          chainFromPrev: false,
        }],
      });

      let writersDone = false;
      const writerCount = 24;
      const writesPerWriter = 30;
      const writers = Array.from({ length: writerCount }, (_, writerIndex) => (async () => {
        for (let i = 0; i < writesPerWriter; i += 1) {
          await writeSceneCandidatesArtifact(root, slug, {
            schemaVersion: 1,
            scenes: [{
              sceneIndex: 0,
              candidates: [{
                id: `scene-0-take-${writerIndex}-${i}`,
                generationRound: i + 1,
                prompt: 'concurrency soak candidate',
                route: 'veo-useapi',
                submittedAt: new Date().toISOString(),
                source: {
                  executionRound: i + 1,
                  adapter: 'builtin',
                  chainedFromCandidateId: null,
                },
                status: 'completed',
                outputs: [{ kind: 'image', path: `/tmp/out-${writerIndex}-${i}.png` }],
              }],
            }],
          });
          await writeSceneSelectionArtifact(root, slug, {
            schemaVersion: 1,
            scenes: [{
              sceneIndex: 0,
              selectedCandidateId: null,
              rejectedCandidateIds: [`scene-0-take-${writerIndex}-${i}`],
              pendingCandidateIds: [],
              rerollRequested: i % 2 === 0,
              chainFromPrev: i % 3 === 0,
            }],
          });
        }
      })());
      const writerCompletion = Promise.all(writers).then(() => {
        writersDone = true;
      });

      while (true) {
        const candidates = await readSceneCandidatesArtifact(root, slug);
        const selection = await readSceneSelectionArtifact(root, slug);
        assert.equal(candidates.schemaVersion, 1);
        assert.equal(selection.schemaVersion, 1);
        assert.ok(Array.isArray(candidates.scenes));
        assert.ok(Array.isArray(selection.scenes));
        if (writersDone) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
      }

      await writerCompletion;
      const finalCandidates = await readSceneCandidatesArtifact(root, slug);
      const finalSelection = await readSceneSelectionArtifact(root, slug);
      assert.equal(finalCandidates.schemaVersion, 1);
      assert.equal(finalSelection.schemaVersion, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
