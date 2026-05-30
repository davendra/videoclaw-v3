import { test } from 'node:test';
import assert from 'node:assert/strict';
import { negativeToPositive } from '../video/prompt-rules.js';
test('rewrites identity-drift prohibition into a positional lock', () => {
  const out = negativeToPositive('Keep the character. No identity drift.');
  assert.ok(/identical|stays|locked|same/i.test(out));
  assert.ok(!/no identity drift/i.test(out));
});
test('leaves sanctioned on-screen-text negation intact', () => {
  assert.ok(/no on-screen text/i.test(negativeToPositive('Hero shot. No on-screen text.')));
});
