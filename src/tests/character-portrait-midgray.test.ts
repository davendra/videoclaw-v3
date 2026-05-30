import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPortraitPrompt } from '../video/character-auto-create.js';

test('portrait prompt uses mid-gray seamless, not bare neutral background', () => {
  const p = buildPortraitPrompt({ description: 'a weathered fisherman', style: 'live-action' } as any);
  assert.ok(/mid-gray seamless/i.test(p), `Expected "mid-gray seamless" in: ${p}`);
  assert.ok(!/[^-]neutral background/i.test(p), `Expected no bare "neutral background" in: ${p}`);
});

test('portrait prompt contains no seam line clause', () => {
  const p = buildPortraitPrompt({ description: 'a warrior princess', style: 'animated' } as any);
  assert.ok(/no seam line/i.test(p), `Expected "no seam line" in: ${p}`);
});
