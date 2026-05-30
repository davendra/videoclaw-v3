import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameMapBlock, subjectLockBlock, crossFrameBlock, lastFrameBlock } from '../video/seedance-blocks.js';

test('subjectLockBlock binds @imageN per character', () => {
  const s = subjectLockBlock([{ label: 'a weathered fisherman', slot: '@image1' }]);
  assert.ok(/@image1/.test(s));
  assert.ok(/a weathered fisherman/.test(s));
});
test('frameMapBlock lists ordered beats with timecodes', () => {
  const s = frameMapBlock([{ t: '0:00-0:03', beat: 'establish' }, { t: '0:03-0:06', beat: 'develop' }]);
  assert.ok(/0:00-0:03/.test(s) && /0:03-0:06/.test(s));
});
test('crossFrameBlock locks identity across cuts', () => {
  assert.ok(/identical|same .*across/i.test(crossFrameBlock()));
});
test('lastFrameBlock suppresses on-screen text', () => {
  assert.ok(/no on-screen text|no captions|no rendered text/i.test(lastFrameBlock('resolved hero frame')));
});
