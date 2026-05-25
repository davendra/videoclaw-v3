import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSceneCandidatesArtifact } from '../video/scene-candidate-store.js';
import { recordStoryboardStillCandidate } from '../video/storyboard-still-candidates.js';

describe('storyboard still candidates', () => {
  it('records generated still images as scene candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-still-candidates-'));
    try {
      const result = await recordStoryboardStillCandidate({
        root,
        projectSlug: 'alpha',
        sceneIndex: 0,
        imageUrl: 'https://example.com/still.jpg',
        imageId: '6636',
        prompt: 'Create a cinematic storyboard still.',
        submittedAt: '2026-05-06T01:00:00.000Z',
      });

      assert.equal(result.candidate.id, 'scene-0-take-1');
      assert.equal(result.candidate.route, 'gobananas-storyboard-still');
      assert.equal(result.candidate.outputs[0]?.kind, 'image');
      assert.equal(result.candidate.outputs[0]?.path, 'https://example.com/still.jpg');
      assert.equal(result.candidate.source.externalJobId, '6636');

      const artifact = await readSceneCandidatesArtifact(root, 'alpha');
      assert.equal(artifact.scenes[0]?.candidates[0]?.id, 'scene-0-take-1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves concurrent storyboard still candidate records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-still-candidates-'));
    try {
      const results = await Promise.all(Array.from({ length: 8 }, (_, index) => (
        recordStoryboardStillCandidate({
          root,
          projectSlug: 'alpha',
          sceneIndex: index % 4,
          imageUrl: `https://cdn.vclaw.local/still-${index}.jpg`,
          imageId: `gb-${index}`,
          prompt: `Create storyboard still ${index}.`,
          submittedAt: `2026-05-06T01:00:0${index}.000Z`,
        })
      )));

      const artifact = await readSceneCandidatesArtifact(root, 'alpha');
      const candidateIds = artifact.scenes.flatMap((scene) => scene.candidates.map((candidate) => candidate.id));
      const externalJobIds = artifact.scenes.flatMap((scene) => scene.candidates.map((candidate) => candidate.source.externalJobId));

      assert.equal(candidateIds.length, 8);
      assert.equal(new Set(candidateIds).size, 8);
      assert.deepEqual(new Set(artifact.scenes.map((scene) => scene.sceneIndex)), new Set([0, 1, 2, 3]));
      assert.deepEqual(new Set(externalJobIds), new Set(Array.from({ length: 8 }, (_, index) => `gb-${index}`)));
      assert.deepEqual(
        new Set(results.map((result) => result.candidate.id)),
        new Set(candidateIds),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
