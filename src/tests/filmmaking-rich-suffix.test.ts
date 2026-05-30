import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richCinematographySuffix } from '../video/filmmaking-prompts.js';

test('no-arg call is byte-identical to the legacy hardcoded suffix', () => {
  const legacy =
    'Cinematography: master, eye-level angle, 35mm, dolly at 3 ft/s, subtle lens breathing; ' +
    '5600K key at 45°, 2:1 ratio, gentle fill and crisp rim light, clean balanced studio light, even and neutral; ' +
    'shadows 190° 45% tint; highlights 30° 55% tint, cinematic teal-and-orange contrast.';
  assert.equal(richCinematographySuffix(), legacy);
});

test('lighting/grade ids are overridable', () => {
  assert.ok(richCinematographySuffix({ lightingId: 'night-fire' }).includes('2000K'));
});

test('realism opt-in appends the capture-realism block', () => {
  assert.ok(/Capture realism:/.test(richCinematographySuffix({ realism: {} })));
  assert.ok(!/Capture realism:/.test(richCinematographySuffix()));
});
