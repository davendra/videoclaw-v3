import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lightingProse,
  gradeProse,
  cameraProse,
  phoneCaptureBlock,
  volumetricHaze,
  volumetricHazeThreePlane,
  type DetailLevel,
  type CameraMovement,
} from '../video/cinematography.js';

// The Joey 2.0 "behavior-not-brand" PROSE register: evocative physical
// phrasing with NO Kelvin / key-angle degrees / contrast ratio / hue° / sat° /
// lift-gamma numerals, but KEEPING real optical numerals (focal length mm,
// fps, shutter). These tests guard that contract.

// Numeric markers that MUST NOT appear in the prose register.
const NO_KELVIN = /\d+\s?K\b/; // e.g. "5200K"
const NO_DEGREES = /\d+\s?°/; // hue / key-angle degrees
const NO_RATIO = /\b\d+(\.\d+)?:\d+(\.\d+)?\b/; // e.g. "3:1", "1.5:1"
const NO_PERCENT_TINT = /\d+\s?%/; // sat % tint
const NO_LIFT_GAMMA = /\b(lift|gamma|gain)\s+[\d.]/i;

// Optical numerals that ARE allowed (and asserted) in the prose register.
const HAS_MM = /\d+\s?mm/;

const LEVELS: DetailLevel[] = ['terse', 'standard', 'rich'];

function assertNoForbiddenNumerals(s: string, label: string): void {
  assert.doesNotMatch(s, NO_KELVIN, `${label} must not carry Kelvin`);
  assert.doesNotMatch(s, NO_DEGREES, `${label} must not carry degrees`);
  assert.doesNotMatch(s, NO_RATIO, `${label} must not carry a contrast ratio`);
  assert.doesNotMatch(s, NO_PERCENT_TINT, `${label} must not carry a % tint`);
  assert.doesNotMatch(s, NO_LIFT_GAMMA, `${label} must not carry lift/gamma/gain`);
}

describe('prose lighting register (lightingProse)', () => {
  it('has no Kelvin / degrees / ratio at any detail level', () => {
    for (const id of ['rembrandt-gray', 'golden-hour', 'night-fire', 'neutral-studio']) {
      for (const d of LEVELS) {
        assertNoForbiddenNumerals(lightingProse(id, d), `lightingProse(${id},${d})`);
      }
    }
  });
  it('renders rembrandt-gray as a physical light description (triangle / no kicker)', () => {
    const s = lightingProse('rembrandt-gray', 'rich').toLowerCase();
    assert.match(s, /triangle of light/);
    assert.match(s, /shadow cheek/);
    assert.match(s, /no rim/);
    assert.match(s, /no hair light/);
    assert.match(s, /no kicker/);
    assert.match(s, /camera-left/);
  });
  it('falls back without throwing on an unknown id', () => {
    assert.equal(typeof lightingProse('nonexistent', 'rich'), 'string');
    assertNoForbiddenNumerals(lightingProse('nonexistent', 'rich'), 'lightingProse(unknown)');
  });
});

describe('prose grade register (gradeProse)', () => {
  it('has no degrees / saturation% / lift-gamma at any detail level', () => {
    for (const id of ['teal-orange', 'desaturated-earth', 'warm-nostalgia', 'bleach-bypass']) {
      for (const d of LEVELS) {
        assertNoForbiddenNumerals(gradeProse(id, d), `gradeProse(${id},${d})`);
      }
    }
  });
  it('renders teal-orange as physical grade prose (lifted shadows, rolled-off highlights)', () => {
    const s = gradeProse('teal-orange', 'rich').toLowerCase();
    assert.match(s, /teal-amber|teal-orange/);
    assert.match(s, /shadows lifted/);
    assert.match(s, /highlights rolled off/);
    assert.match(s, /never crush|never crushed/);
    assert.match(s, /never clip|never clipping/);
  });
  it('falls back without throwing on an unknown id', () => {
    assert.equal(typeof gradeProse('nonexistent', 'rich'), 'string');
    assertNoForbiddenNumerals(gradeProse('nonexistent', 'rich'), 'gradeProse(unknown)');
  });
});

describe('prose camera register (cameraProse)', () => {
  it('keeps optical mm numerals but drops Kelvin / degrees / ratio', () => {
    const moves: CameraMovement[] = ['dolly', 'push-in', 'handheld', 'orbit', 'locked-off'];
    for (const m of moves) {
      for (const d of LEVELS) {
        const s = cameraProse(m, d);
        assertNoForbiddenNumerals(s, `cameraProse(${m},${d})`);
      }
    }
  });
  it('a dolly move reads as a physical anamorphic capture description with a focal length', () => {
    const s = cameraProse('dolly', 'rich');
    assert.match(s, HAS_MM); // real optical numeral preserved (e.g. 75mm)
    const low = s.toLowerCase();
    assert.match(low, /anamorphic/);
    assert.match(low, /oval bokeh/);
    assert.match(low, /diffusion bloom/);
    assert.match(low, /operator breath/);
    assert.match(low, /35mm grain/);
  });
});

describe('phone capture register (phoneCaptureBlock)', () => {
  it('reads as an amateur/unstaged phone clip — never cinematic, never an ad', () => {
    const s = phoneCaptureBlock({}, 'rich').toLowerCase();
    assert.match(s, /smartphone|phone/);
    assert.match(s, /amateur|casual|unstaged|imperfection/);
    assert.match(s, /never cinematic/);
    assert.match(s, /never an ad/);
    assert.match(s, /never color-graded/);
  });
  it('drops the cinema gear: no film grain, no anamorphic, no diffusion bloom', () => {
    // The phone register strips the cinema hardware. It must never make a
    // POSITIVE cinema-gear claim (e.g. "soft 35mm film grain", "2x anamorphic",
    // "soft diffusion bloom") — any mention of that gear may appear only as an
    // explicit negation ("no film grain"). And it must carry NO real optical
    // numerals at all (no mm), unlike the cinema cameraProse register.
    for (const d of LEVELS) {
      const s = phoneCaptureBlock({}, d).toLowerCase();
      assert.doesNotMatch(s, /\bmm\b/, `${d}: no optical mm numerals on a phone clip`);
      assert.doesNotMatch(s, /\bsoft\s+\S*\s*film grain\b/, `${d}: no positive film-grain claim`);
      assert.doesNotMatch(s, /\b2x anamorphic\b|vintage[^.]*anamorphic/, `${d}: no positive anamorphic claim`);
      assert.doesNotMatch(s, /soft diffusion bloom|light diffusion bloom/, `${d}: no positive diffusion-bloom claim`);
    }
  });
  it('the rich register explicitly negates the cinema gear it dropped', () => {
    const s = phoneCaptureBlock({}, 'rich').toLowerCase();
    assert.match(s, /no film grain/);
    assert.match(s, /no anamorphic/);
    assert.match(s, /no diffusion bloom/);
  });
  it('keeps a flattering-skin clause', () => {
    const s = phoneCaptureBlock({}, 'rich').toLowerCase();
    assert.match(s, /flattering|even skin|no blemish/);
  });
});

describe('three-plane volumetric haze (volumetricHazeThreePlane)', () => {
  it('names all three planes when foreground/midground/background labels are given', () => {
    const s = volumetricHazeThreePlane(
      { density: 'light', foreground: 'the rider', midground: 'the wreckage', background: 'the skyline' },
      'rich',
    ).toLowerCase();
    assert.match(s, /the rider/);
    assert.match(s, /the wreckage/);
    assert.match(s, /the skyline/);
    // and it carries the three-plane relationship vocabulary
    assert.match(s, /sharp|saturated/);
    assert.match(s, /softest|softer|soften/);
    assert.match(s, /desaturat/);
  });
  it('is backward-compatible: no planes => the single-register haze string', () => {
    for (const d of LEVELS) {
      const single = volumetricHaze('light', d);
      const viaThree = volumetricHazeThreePlane({ density: 'light' }, d);
      assert.equal(viaThree, single);
    }
  });
  it('carries no Kelvin / degrees / ratio numerals', () => {
    const s = volumetricHazeThreePlane(
      { density: 'heavy', foreground: 'fg', midground: 'mg', background: 'bg' },
      'rich',
    );
    assertNoForbiddenNumerals(s, 'volumetricHazeThreePlane');
  });
});
