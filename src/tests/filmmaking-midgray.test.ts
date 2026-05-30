import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  characterSheetReferencePrompt,
  characterSheetDescriptionPrompt,
} from '../video/filmmaking-prompts.js';

test('characterSheetReferencePrompt defaults to mid-gray seamless background', () => {
  const r = characterSheetReferencePrompt(['@image1'], 'live-action', '16:9');
  assert.ok(/mid-gray seamless/i.test(r), `Expected "mid-gray seamless" in: ${r}`);
  assert.ok(!/simple and not distracting/i.test(r), `Expected old wording removed from: ${r}`);
  assert.ok(/no seam line/i.test(r), `Expected "no seam line" in: ${r}`);
  assert.ok(/clean neutral studio lighting/i.test(r), `Expected "clean neutral studio lighting" preserved in: ${r}`);
});

test('characterSheetDescriptionPrompt defaults to mid-gray seamless background', () => {
  const d = characterSheetDescriptionPrompt('a weathered fisherman', 'live-action', '16:9');
  assert.ok(/mid-gray seamless/i.test(d), `Expected "mid-gray seamless" in: ${d}`);
  assert.ok(!/simple and not distracting/i.test(d), `Expected old wording removed from: ${d}`);
  assert.ok(/no seam line/i.test(d), `Expected "no seam line" in: ${d}`);
  assert.ok(/no scene-specific lighting/i.test(d), `Expected "no scene-specific lighting" preserved in: ${d}`);
});
