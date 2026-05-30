import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoPhotorealFaceRefs } from '../video/native-seedance.js';

test('rejects a reference flagged as a photoreal face on seedance-direct', () => {
  assert.throws(
    () => assertNoPhotorealFaceRefs([{ path: '/x/face.png', kind: 'photoreal-face' } as any]),
    /photoreal face|content filter|no-faces/i,
  );
});

test('allows Asset:// and non-face references', () => {
  assert.doesNotThrow(() => assertNoPhotorealFaceRefs([
    { assetUri: 'Asset://abc' } as any,
    { path: '/x/plate.png' } as any,
  ]));
});

test('allows an empty reference set', () => {
  assert.doesNotThrow(() => assertNoPhotorealFaceRefs([]));
});

test('allows plain string reference paths (untagged)', () => {
  assert.doesNotThrow(() => assertNoPhotorealFaceRefs([
    '/x/plate.png' as any,
    'Asset://abc' as any,
  ]));
});

test('error message points the operator to the no-faces remedy and Asset Library', () => {
  assert.throws(
    () => assertNoPhotorealFaceRefs([{ path: '/x/face.png', kind: 'photoreal-face' } as any]),
    /Asset Library/i,
  );
  assert.throws(
    () => assertNoPhotorealFaceRefs([{ path: '/x/face.png', kind: 'photoreal-face' } as any]),
    /--no-faces/,
  );
});
