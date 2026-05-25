import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzeOutput } from '../video/analyze-output.js';
import { getBuiltinPipelineManifest, listBuiltinPipelineManifests } from '../video/pipeline-manifest.js';

describe('pipeline manifests', () => {
  it('lists storyboard and director manifests', () => {
    const manifests = listBuiltinPipelineManifests();
    assert.equal(manifests.length, 2);
    assert.deepEqual(manifests.map((m) => m.productionMode).sort(), ['director', 'storyboard']);
  });

  it('keeps publish as the terminal stage', () => {
    const manifest = getBuiltinPipelineManifest('director');
    assert.equal(manifest.stages.at(-1)?.name, 'publish');
  });
});

describe('createAnalyzeOutput', () => {
  it('fills generatedAt when absent', () => {
    const output = createAnalyzeOutput({
      reference: { source: 'https://example.com/video.mp4' },
      pacing: { label: 'fast', notes: ['strong hook'] },
      structure: { beats: ['hook', 'demo', 'cta'] },
      motionClassification: { primaryMode: 'motion-clips', notes: ['mostly active footage'] },
      keep: ['pacing'],
      change: ['topic'],
      reusableVariables: ['product', 'audience'],
    });

    assert.equal(output.reference.source, 'https://example.com/video.mp4');
    assert.match(output.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});
