import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicSyncLine } from '../video/cinematography.js';
test('musicSync names beat alignment without negative tempo direction', () => {
  const s = musicSyncLine(120, 'standard');
  assert.ok(/beat|downbeat|on the beat/i.test(s));
  assert.ok(!/slow.?motion|no music/i.test(s));
});
test('rich includes BPM', () => {
  assert.ok(/120/.test(musicSyncLine(120, 'rich')));
});
test('undefined bpm omits a numeric BPM', () => {
  assert.doesNotMatch(musicSyncLine(undefined, 'rich'), /\d+ BPM/);
});
