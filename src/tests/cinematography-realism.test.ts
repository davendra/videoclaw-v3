import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  specularKillClause,
  subsurfaceScatteringClause,
  strandHairClause,
  contrastCurveClause,
  moistureMatteClause,
  flatteringRealismClause,
  volumetricHaze,
  captureRealismBlock,
} from '../video/cinematography.js';

test('specularKillClause names individual face zones (matte-skin alone is too weak)', () => {
  const s = specularKillClause();
  for (const zone of ['forehead', 'nose bridge', 'cheekbones', 'temples', 'chin']) {
    assert.ok(s.toLowerCase().includes(zone), `missing zone: ${zone}`);
  }
  assert.ok(/no oily|no shine|zero shine/i.test(s));
});

test('subsurfaceScatteringClause reads as translucent biology, never plastic', () => {
  const s = subsurfaceScatteringClause();
  assert.ok(/subsurface scattering/i.test(s));
  assert.ok(/never .*plastic|not .*plastic/i.test(s));
});

test('strandHairClause specifies strand-by-strand flyaways', () => {
  assert.ok(/strand by strand/i.test(strandHairClause()));
  assert.ok(/flyaway|baby hair/i.test(strandHairClause()));
});

test('contrastCurveClause states the curve three ways', () => {
  const s = contrastCurveClause();
  assert.ok(/lifted|shadows lifted/i.test(s));
  assert.ok(/roll(ed)? off|highlights/i.test(s));
  assert.ok(/nothing clip|no clip|not crush/i.test(s));
});

test('moistureMatteClause is damp-not-glossy', () => {
  assert.ok(/damp/i.test(moistureMatteClause()));
  assert.ok(/not glossy|never glossy|no .*hotspot/i.test(moistureMatteClause()));
});

test('flatteringRealismClause keeps anti-plastic from reading as dermatology macro', () => {
  const s = flatteringRealismClause();
  assert.ok(/no acne|no blemish/i.test(s));
  assert.ok(/flattering/i.test(s));
});

test('volumetricHaze scales density and always names planes', () => {
  for (const k of ['thin', 'light', 'heavy'] as const) {
    for (const d of ['terse', 'standard', 'rich'] as const) {
      const s = volumetricHaze(k, d);
      assert.ok(/camera, subject/i.test(s), `${k}/${d} missing planes`);
      assert.ok(/distant|background/i.test(s));
    }
  }
  assert.ok(volumetricHaze('heavy', 'rich').length > volumetricHaze('thin', 'terse').length);
});

test('captureRealismBlock composes specular+SSS+hair+contrast+haze+grain', () => {
  const s = captureRealismBlock({}, 'rich');
  assert.ok(/specular/i.test(s) && /subsurface/i.test(s) && /strand/i.test(s));
  assert.ok(/haze|air density/i.test(s) && /grain/i.test(s));
});

test('captureRealismBlock emits moisture clause ONLY when wet', () => {
  assert.ok(!/damp/i.test(captureRealismBlock({ wet: false }, 'rich')));
  assert.ok(/damp/i.test(captureRealismBlock({ wet: true }, 'rich')));
});

test('captureRealismBlock terse is shorter than rich', () => {
  assert.ok(captureRealismBlock({}, 'terse').length < captureRealismBlock({}, 'rich').length);
});
