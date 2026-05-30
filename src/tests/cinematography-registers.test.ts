import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightingSpec, gradeSpec } from '../video/cinematography.js';

const NEW_LIGHTS = ['moonlight','overcast','neon-split','chiaroscuro','silhouette','fluorescent','night-practical','night-urban-neon'];
test('new lighting ids resolve to non-fallback rich specs', () => {
  for (const id of NEW_LIGHTS) {
    const rich = lightingSpec(id, 'rich');
    assert.notEqual(rich, '5600K key at 45°, 2:1 ratio, neutral fill', `${id} fell back`);
    assert.ok(/K key at/.test(rich), `${id} missing Kelvin`);
  }
});

const NEW_GRADES = ['warm-nostalgia','cool-isolation','cyberpunk-neon','bleach-bypass','mono-accent'];
test('new grade ids resolve non-fallback', () => {
  for (const id of NEW_GRADES) {
    assert.ok(/tint/.test(gradeSpec(id, 'rich')), `${id} missing tint`);
  }
});
test('bleach-bypass rich output states lifted-black lift/gamma when present', () => {
  const s = gradeSpec('bleach-bypass', 'rich');
  assert.ok(/lift|gamma|lifted/i.test(s));
});
test('legacy grades stay byte-stable (no trailing lift/gamma)', () => {
  // teal-orange has no lift/gamma/gain so the rich string must NOT gain a "; lift..." suffix
  assert.ok(!/; lift|; gamma|; gain/.test(gradeSpec('teal-orange', 'rich')));
});
