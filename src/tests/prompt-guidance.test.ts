import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptGuidance } from '../video/prompt-guidance.js';

describe('buildPromptGuidance', () => {
  it('recommends route-aware provider and framework references', () => {
    const guidance = buildPromptGuidance({
      routeId: 'seedance-direct',
      operationKind: 'text-to-video',
      productionMode: 'storyboard',
    });

    assert.ok(guidance.some((entry) => entry.name === 'seedance-ugc-formulas'));
    assert.ok(guidance.some((entry) => entry.name === 'checkpoint-protocol'));
    assert.ok(guidance.some((entry) => entry.name === 'stage-directors'));
    assert.ok(guidance.some((entry) => entry.name === 'generation-telemetry'));
    assert.ok(guidance.some((entry) => entry.name === 'dialogue-duration-preflight'));
  });

  it('adds director-specific reference guidance', () => {
    const guidance = buildPromptGuidance({
      routeId: 'seedance-direct',
      operationKind: 'image-to-video',
      productionMode: 'director',
    });

    assert.ok(guidance.some((entry) => entry.name === 'character-reference-sheet'));
    assert.ok(guidance.some((entry) => entry.name === 'dialogue-duration-preflight'));
  });
});
