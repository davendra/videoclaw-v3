import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStyleLine } from '../video/multi-shot-prompt.js';

test('unknown/absent genre falls back to the Nolan style line', () => {
  assert.ok(/Christopher Nolan/.test(resolveStyleLine()));
  assert.ok(/Christopher Nolan/.test(resolveStyleLine('totally-unknown')));
});
test('music-video does NOT read as a Nolan narrative', () => {
  const s = resolveStyleLine('music-video');
  assert.ok(!/Christopher Nolan/.test(s));
  assert.ok(s.length > 0);
});
test('action resolves to its own line', () => {
  assert.ok(!/Christopher Nolan/.test(resolveStyleLine('action')));
});
