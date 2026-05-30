import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outfitSwapPrompt, outfitBuildPrompt } from '../video/outfit-prompts.js';

test('outfitSwap is a lean two-reference prompt with fixed @image1=outfit/@image2=identity order', () => {
  const s = outfitSwapPrompt();
  assert.ok(/@image1/.test(s) && /@image2/.test(s));
  assert.ok(/outfit and pose from @image1/i.test(s));
  assert.ok(/face.*body.*from @image2/i.test(s) || /from @image2/.test(s));
  assert.ok(/mid-gray/i.test(s));
});
test('outfitBuild step builds wardrobe on a bland model first', () => {
  const s = outfitBuildPrompt('a charcoal wool overcoat');
  assert.ok(/bland|generic|slim model/i.test(s));
  assert.ok(/charcoal wool overcoat/.test(s));
  assert.ok(/mid-gray/i.test(s));
});
