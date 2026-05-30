import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_PATTERN_IDS, resolveHookPattern } from '../video/cinematography.js';

test('twelve hook patterns, all resolvable', () => {
  assert.equal(HOOK_PATTERN_IDS.length, 12);
  for (const id of HOOK_PATTERN_IDS) {
    assert.ok(resolveHookPattern(id).length > 10, `${id} empty`);
  }
});
test('new hook ids present', () => {
  for (const id of ['speed-ramp','first-person-rush','impact-freeze','title-burn-in','slow-reveal','snap-zoom']) {
    assert.ok((HOOK_PATTERN_IDS as readonly string[]).includes(id), `missing ${id}`);
  }
});
