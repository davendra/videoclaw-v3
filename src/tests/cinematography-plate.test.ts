import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundPlate, lightingSpec } from '../video/cinematography.js';

test('mid-gray plate forbids seam/gradient/falloff', () => {
  const s = backgroundPlate('mid-gray', 'standard');
  assert.ok(/mid-gray/i.test(s));
  assert.ok(/no seam/i.test(s) && /no gradient/i.test(s) && /falloff/i.test(s));
});
test('white and black plates resolve distinctly', () => {
  assert.ok(/white/i.test(backgroundPlate('white', 'terse')));
  assert.ok(/black/i.test(backgroundPlate('black', 'terse')));
});
test('rembrandt-gray lighting has no rim/hair/kicker and preserves warmth', () => {
  const s = lightingSpec('rembrandt-gray', 'rich');
  assert.ok(/no rim/i.test(s) && /no hair light/i.test(s) && /no kicker/i.test(s));
  assert.ok(/warmth/i.test(s));
});
test('mid-gray rich names true natural tone', () => {
  assert.ok(/true natural tone/i.test(backgroundPlate('mid-gray', 'rich')));
});
test('mid-gray rich elaborates beyond standard', () => {
  assert.ok(backgroundPlate('mid-gray', 'rich').length > backgroundPlate('mid-gray', 'standard').length);
});
