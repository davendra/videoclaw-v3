import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAnalyzeOutputArtifact,
  validateAssetManifestArtifact,
  validateBriefArtifact,
  validatePublishReportArtifact,
  validateReviewReportArtifact,
  validateStoryboardArtifact,
} from '../video/artifact-validation.js';

describe('artifact validation', () => {
  it('flags malformed brief artifacts', () => {
    const issues = validateBriefArtifact({ title: '', intent: 3 });
    assert.ok(issues.some((issue) => issue.message.includes('title')));
    assert.ok(issues.some((issue) => issue.message.includes('intent')));
  });

  it('flags malformed storyboard and asset manifest artifacts', () => {
    const storyboardIssues = validateStoryboardArtifact({ projectSlug: 'x', productionMode: 'storyboard', scenes: [{}] });
    const assetIssues = validateAssetManifestArtifact({ projectSlug: 'x', assets: [{}] });
    assert.ok(storyboardIssues.some((issue) => issue.message.includes('sceneIndex')));
    assert.ok(assetIssues.some((issue) => issue.message.includes('id')));
  });

  it('accepts optional structured storyboard prompts and validates camera moves', () => {
    const validIssues = validateStoryboardArtifact({
      projectSlug: 'x',
      productionMode: 'storyboard',
      scenes: [{
        sceneIndex: 0,
        description: 'Scene one',
        scenePrompt: {
          imagePrompt: 'Static frame of the product on a reflective counter.',
          animationPrompt: 'Slow push-in while the reflection shifts naturally.',
          cameraMove: 'push-in',
          styleFooter: 'clean commercial lighting',
        },
      }],
    });
    assert.deepEqual(validIssues, []);

    const invalidIssues = validateStoryboardArtifact({
      projectSlug: 'x',
      productionMode: 'storyboard',
      scenes: [{
        sceneIndex: 0,
        description: 'Scene one',
        scenePrompt: {
          cameraMove: 'spiral',
        },
      }],
    });
    assert.ok(invalidIssues.some((issue) => issue.message.includes('scenePrompt.cameraMove')));
  });

  it('flags malformed review, publish, and analyze artifacts', () => {
    const reviewIssues = validateReviewReportArtifact({ projectSlug: 'x', verdict: 'maybe' });
    const publishIssues = validatePublishReportArtifact({ projectSlug: 'x', status: 'later' });
    const analyzeIssues = validateAnalyzeOutputArtifact({ reference: {}, pacing: {} });
    assert.ok(reviewIssues.some((issue) => issue.message.includes('verdict')));
    assert.ok(publishIssues.some((issue) => issue.message.includes('status')));
    assert.ok(analyzeIssues.some((issue) => issue.message.includes('reference source')));
  });
});
