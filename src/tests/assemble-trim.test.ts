/**
 * Unit tests for the per-clip cut-at-N tail-trim arg builder (WS9 Task 9.1).
 *
 * Scope: pure arg-shape only. No ffmpeg is spawned — `trimTailArgs` is a pure
 * function that emits the `-t <seconds>` ffmpeg flag pair (or nothing).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimTailArgs } from '../video/assemble/ffmpeg.js';

test('trimTailArgs cuts to maxSeconds with -t', () => {
  const args = trimTailArgs(3);
  assert.deepEqual(args, ['-t', '3']);
});

test('zero/undefined means no trim', () => {
  assert.deepEqual(trimTailArgs(0), []);
  assert.deepEqual(trimTailArgs(undefined), []);
});

test('negative means no trim', () => {
  assert.deepEqual(trimTailArgs(-5), []);
});

test('fractional seconds are preserved', () => {
  assert.deepEqual(trimTailArgs(2.5), ['-t', '2.5']);
});
