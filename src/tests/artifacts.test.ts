import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBriefArtifact,
  createPublishReportArtifact,
  createReviewReportArtifact,
} from '../video/artifacts.js';

describe('artifact helpers', () => {
  it('fills timestamps for brief artifacts', () => {
    const artifact = createBriefArtifact({
      title: 'Launch Teaser',
      intent: 'Make a launch teaser for a new product.',
      productionMode: 'storyboard',
    });

    assert.equal(artifact.title, 'Launch Teaser');
    assert.match(artifact.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('fills timestamps for review and publish artifacts', () => {
    const review = createReviewReportArtifact({
      projectSlug: 'launch-teaser',
      verdict: 'pass',
    });
    const publish = createPublishReportArtifact({
      projectSlug: 'launch-teaser',
      status: 'ready',
    });

    assert.match(review.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(publish.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});
