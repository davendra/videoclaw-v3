import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEEDANCE_10S_PRESET,
  buildShotPlan,
  composeSeedanceParagraph,
} from '../video/multi-shot-prompt.js';
import { resolveCategory } from '../video/category-registry.js';

describe('multi-shot-prompt: composeSeedanceParagraph', () => {
  const plan = buildShotPlan(SEEDANCE_10S_PRESET, { seed: 7 });
  const descriptor = resolveCategory('cinematic');

  it('renders all labeled segments inline in order', () => {
    const paragraph = composeSeedanceParagraph(plan, descriptor);
    assert.match(paragraph, /Style & Mood:/);
    assert.match(paragraph, /Dynamic Description:/);
    assert.match(paragraph, /Static Description:/);
    assert.match(paragraph, /Audio:/);

    // Order: Style & Mood → Dynamic → Static → Audio (footer last).
    const styleIdx = paragraph.indexOf('Style & Mood:');
    const dynIdx = paragraph.indexOf('Dynamic Description:');
    const staticIdx = paragraph.indexOf('Static Description:');
    const audioIdx = paragraph.indexOf('Audio:');
    assert.ok(styleIdx < dynIdx, 'Style & Mood precedes Dynamic Description');
    assert.ok(dynIdx < staticIdx, 'Dynamic precedes Static Description');
    assert.ok(staticIdx < audioIdx, 'Static precedes Audio footer');
  });

  it('is a single flowing paragraph (no double-newline block separators)', () => {
    const paragraph = composeSeedanceParagraph(plan, descriptor);
    assert.ok(paragraph.length > 0, 'non-empty paragraph');
    assert.ok(
      !paragraph.includes('\n\n'),
      `expected single block, found block separator: ${JSON.stringify(paragraph)}`,
    );
  });

  it('is deterministic for the same plan/descriptor', () => {
    const a = composeSeedanceParagraph(plan, descriptor);
    const b = composeSeedanceParagraph(plan, descriptor);
    assert.equal(a, b);
  });
});
