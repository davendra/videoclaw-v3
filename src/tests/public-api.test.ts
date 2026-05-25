import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewInventory,
  isProjectSlug,
  launchReviewUi,
  recordReviewCharacterIterationRequest,
  recordReviewStoryboardStillGenerationRequest,
  recordReviewStoryboardStillCandidate,
  recordReviewUpscaledStillCandidate,
  recordStoryboardStillCandidate,
  runReviewAutopilot,
  saveReviewDecision,
  updateSceneCandidatesArtifact,
} from '../index.js';
import type {
  RecordStoryboardStillCandidateInput,
  ReviewCharacterIterationRequest,
  ReviewStoryboardStillGenerationRequest,
  ReviewUiOptions,
} from '../index.js';

describe('public api surface', () => {
  it('exports review station and storyboard still helpers from the package entrypoint', () => {
    const reviewOptions: ReviewUiOptions = {
      root: process.cwd(),
      projectSlug: 'alpha',
      dryRun: true,
    };
    const stillInput: RecordStoryboardStillCandidateInput = {
      root: process.cwd(),
      projectSlug: 'alpha',
      sceneIndex: 0,
      imageUrl: 'https://example.com/storyboard.png',
    };
    const generationRequest: ReviewStoryboardStillGenerationRequest = {
      id: 'gobananas-still-00-001',
      sceneIndex: 0,
      provider: 'gobananas',
      route: 'gobananas-storyboard-still',
      status: 'queued',
      prompt: 'Create storyboard still.',
      negativePrompt: 'no text',
      aspectRatio: '16:9',
      requestedAt: new Date(0).toISOString(),
      source: 'review-ui',
    };
    const characterRequest: ReviewCharacterIterationRequest = {
      id: 'gobananas-character-001',
      provider: 'gobananas',
      route: 'gobananas-character-iteration',
      status: 'fulfilled',
      characterName: 'Komo',
      prompt: 'Create character iterations.',
      negativePrompt: 'no text',
      aspectRatio: 'square',
      count: 4,
      requestedAt: new Date(0).toISOString(),
      source: 'review-ui',
      fulfilledAt: new Date(0).toISOString(),
      characterProfileId: 'komo',
      goBananasId: 170,
    };

    assert.equal(reviewOptions.projectSlug, 'alpha');
    assert.equal(stillInput.sceneIndex, 0);
    assert.equal(generationRequest.route, 'gobananas-storyboard-still');
    assert.equal(characterRequest.route, 'gobananas-character-iteration');
    assert.equal(typeof buildReviewInventory, 'function');
    assert.equal(typeof launchReviewUi, 'function');
    assert.equal(typeof recordReviewCharacterIterationRequest, 'function');
    assert.equal(typeof recordReviewStoryboardStillGenerationRequest, 'function');
    assert.equal(typeof recordReviewStoryboardStillCandidate, 'function');
    assert.equal(typeof recordReviewUpscaledStillCandidate, 'function');
    assert.equal(typeof recordStoryboardStillCandidate, 'function');
    assert.equal(typeof runReviewAutopilot, 'function');
    assert.equal(typeof saveReviewDecision, 'function');
    assert.equal(typeof updateSceneCandidatesArtifact, 'function');
    assert.equal(isProjectSlug('--project'), false);
    assert.equal(isProjectSlug('fresh-proof'), true);
  });
});
