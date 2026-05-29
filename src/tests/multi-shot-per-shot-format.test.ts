import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEEDANCE_10S_PRESET,
  buildShotPlan,
  composePerShotFormat,
} from '../video/multi-shot-prompt.js';
import { resolveCategory } from '../video/category-registry.js';

describe('multi-shot-prompt: composePerShotFormat', () => {
  // Seed chosen so the plan partitions into >=2 shots deterministically.
  const plan = buildShotPlan(SEEDANCE_10S_PRESET, { seed: 7 });
  const descriptor = resolveCategory('cinematic');

  it('renders one structured block per shot with labeled lines', () => {
    const out = composePerShotFormat(plan, descriptor);
    assert.ok(plan.shots.length >= 2, 'fixture should have at least 2 shots');

    // First shot header present.
    assert.match(out, /SHOT 1 — /);
    // One header per shot.
    assert.match(out, /SHOT 2 — /);

    // Labeled lines present.
    assert.match(out, /Framing:/);
    assert.match(out, /Scene:/);
    assert.match(out, /SFX:/);
    assert.match(out, /Camera:/);
  });

  it('emits exactly one trailing Audio: footer', () => {
    const out = composePerShotFormat(plan, descriptor);
    const audioCount = out.split('Audio:').length - 1;
    assert.equal(audioCount, 1, `expected exactly one Audio: footer, got ${audioCount}`);
    // Footer is last: nothing labeled after it except its value.
    assert.ok(
      out.lastIndexOf('Audio:') > out.lastIndexOf('SHOT '),
      'Audio footer comes after all shot blocks',
    );
  });

  it('emits exactly one header per shot', () => {
    const out = composePerShotFormat(plan, descriptor);
    const headerCount = (out.match(/^SHOT \d+ — /gm) ?? []).length;
    assert.equal(headerCount, plan.shots.length);
  });

  it('is deterministic for the same plan/descriptor', () => {
    const a = composePerShotFormat(plan, descriptor);
    const b = composePerShotFormat(plan, descriptor);
    assert.equal(a, b);
  });
});
