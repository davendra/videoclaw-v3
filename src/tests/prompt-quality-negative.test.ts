import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPromptQualityChecks } from '../video/prompt-quality.js';

test('flags negative tempo/motion direction as a warning', () => {
  const issues = runPromptQualityChecks('A hero shot, no slow motion, dont make it blurry.');
  assert.ok(issues.some((i) => /negative direction/i.test(i.message)));
});
test('sanctioned suppressions (on-screen text, specular) are NOT flagged', () => {
  const issues = runPromptQualityChecks('Hero shot. No on-screen text, no captions. Specular highlights removed from skin.');
  assert.ok(!issues.some((i) => /negative direction/i.test(i.message)));
});
