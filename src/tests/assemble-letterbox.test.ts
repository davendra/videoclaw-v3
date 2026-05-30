/**
 * Unit tests for the letterbox normalization filter (WS9 Task 9.2).
 *
 * Scope: pure filter-string shape only. No ffmpeg is spawned — `letterboxFilter`
 * returns an ffmpeg `scale,pad` filter string (or '' when no ratio is given).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterboxFilter } from '../video/assemble/ffmpeg.js';

test('letterbox to 2.39:1 produces a pad filter', () => {
  const f = letterboxFilter('2.39:1', 1920, 1080);
  assert.ok(/pad=/.test(f) && /black/.test(f));
});

test('no ratio = empty filter', () => {
  assert.equal(letterboxFilter(undefined, 1920, 1080), '');
});

test('empty-string ratio = empty filter', () => {
  assert.equal(letterboxFilter('', 1920, 1080), '');
});

test('the filter scales to the canvas width and pads to the canvas height', () => {
  const f = letterboxFilter('2.39:1', 1920, 1080);
  assert.ok(f.startsWith('scale=1920:'));
  assert.ok(f.includes('pad=1920:1080:'));
});
