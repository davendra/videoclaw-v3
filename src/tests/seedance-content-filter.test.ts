import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  preValidatePrompt,
  sanitizePrompt,
  isContentViolation,
  suggestRecovery,
} from '../video/seedance-content-filter.js';

test('celebrity name yields a HIGH warning', () => {
  const warnings = preValidatePrompt('A cinematic shot of Taylor Swift on stage');
  const high = warnings.filter((w) => w.level === 'HIGH');
  assert.ok(high.length >= 1, 'expected at least one HIGH warning');
  assert.ok(
    high.some((w) => /taylor\s+swift/i.test(w.match)),
    'expected the celebrity name to be the matched substring',
  );
});

test('minor term yields HIGH warning and sanitize replaces with "young adult"', () => {
  const warnings = preValidatePrompt('A child running through a sunlit field');
  const high = warnings.filter((w) => w.level === 'HIGH');
  assert.ok(
    high.some((w) => /child/i.test(w.match)),
    'expected a HIGH warning matching the minor term',
  );

  const sanitized = sanitizePrompt('A child running through a sunlit field', 1);
  assert.ok(
    /young adult/i.test(sanitized),
    `expected sanitized prompt to contain "young adult", got: ${sanitized}`,
  );
  assert.ok(!/\bchild\b/i.test(sanitized), 'expected "child" to be removed');
});

test('@image1 media ref is preserved through sanitize (level 1)', () => {
  const sanitized = sanitizePrompt('@image1 Taylor Swift dances in a luxury ballroom', 1);
  assert.ok(/@image1/.test(sanitized), `expected @image1 preserved, got: ${sanitized}`);
});

test('@image1 media ref is preserved through sanitize (level 2)', () => {
  const sanitized = sanitizePrompt('@image1 slow dolly push in across the dim interior', 2);
  assert.ok(/@image1/.test(sanitized), `expected @image1 preserved, got: ${sanitized}`);
});

test('isContentViolation matches "error code: 2038"', () => {
  assert.equal(isContentViolation('Task failed with error code: 2038'), true);
});

test('isContentViolation matches Chinese "内容违规"', () => {
  assert.equal(isContentViolation('生成失败：内容违规'), true);
});

test('isContentViolation returns false for empty or unrelated errors', () => {
  assert.equal(isContentViolation(''), false);
  assert.equal(isContentViolation('HTTP 500: internal server error'), false);
});

test('clean cinematic prompt yields no HIGH warnings', () => {
  const warnings = preValidatePrompt(
    'Slow dolly push in across a misty forest clearing at golden hour, cinematic lighting',
  );
  const high = warnings.filter((w) => w.level === 'HIGH');
  assert.equal(high.length, 0, `expected no HIGH warnings, got: ${JSON.stringify(high)}`);
});

test('suggestRecovery returns a non-empty suggestion for a 2038 error', () => {
  const recovery = suggestRecovery('error code: 2038 real person detected');
  assert.ok(recovery.length > 0);
  assert.ok(/Asset Library/i.test(recovery));
});

test('suggestRecovery falls back to a generic suggestion', () => {
  const recovery = suggestRecovery('some unrelated failure');
  assert.ok(recovery.length > 0);
});
