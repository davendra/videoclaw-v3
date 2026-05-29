import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cameraSpec, lightingSpec, gradeSpec, audioMix, type DetailLevel } from '../video/cinematography.js';
import { cinemaMode, resolveCameraVocab, CINEMA_MODE_IDS, type CinemaModeId } from '../video/cinematography.js';
import { hookBeat, HOOK_PATTERN_IDS, type HookPatternId } from '../video/cinematography.js';
import { genreDefaults, type GenreDefaults } from '../video/cinematography.js';
import { stackModes, type StackedShot } from '../video/cinematography.js';
import { beats, type Beat } from '../video/cinematography.js';

describe('cinematography emitters', () => {
  it('terse omits numbers, rich includes them', () => {
    const move = { shot: 'wide', lens: 35, angle: 'low', movement: 'push-in' as const };
    assert.doesNotMatch(cameraSpec(move, 'terse'), /ft\/s|mm/);
    assert.match(cameraSpec(move, 'rich'), /35mm/);
    assert.match(cameraSpec(move, 'rich'), /ft\/s/);
  });
  it('standard lighting carries Kelvin + ratio', () => {
    assert.match(lightingSpec('hard-dawn', 'standard'), /\d{3,5}K/);
    assert.match(lightingSpec('hard-dawn', 'standard'), /\d:\d/);
  });
  it('grade carries hue + saturation at rich', () => {
    assert.match(gradeSpec('desaturated-earth', 'rich'), /\d+°/);
    assert.match(gradeSpec('desaturated-earth', 'rich'), /\d+%/);
  });
  it('unknown lighting/grade ids fall back without throwing', () => {
    assert.equal(typeof lightingSpec('nonexistent', 'standard'), 'string');
    assert.equal(typeof gradeSpec('nonexistent', 'rich'), 'string');
  });
});

describe('audio mix', () => {
  it('rich audio carries a dB hierarchy; terse does not', () => {
    assert.match(audioMix('rich'), /dB|-?\d+\s?dB/i);
    assert.doesNotMatch(audioMix('terse'), /dB/);
  });
});

describe('cinema modes', () => {
  it('exposes exactly the five canonical modes', () => {
    assert.deepEqual([...CINEMA_MODE_IDS].sort(), ['action','atmospheric','narrative','performance','studio']);
  });
  it('action mode reads as kinetic; each mode carries the full spec', () => {
    const m = cinemaMode('action');
    assert.match(`${m.movement} ${m.camera}`.toLowerCase(), /kinetic|handheld|whip|fast/);
    for (const id of CINEMA_MODE_IDS) {
      const s = cinemaMode(id);
      assert.ok(s.camera && s.lens && s.movement && s.filtration && s.grade, `${id} fully specified`);
    }
  });
  it('resolveCameraVocab maps vocab tokens to a mode spec (orbit, cinematic, handheld-social)', () => {
    assert.ok(resolveCameraVocab('orbit').movement.toLowerCase().includes('orbit'));
    assert.equal(typeof resolveCameraVocab('cinematic').camera, 'string');
    assert.equal(typeof resolveCameraVocab('handheld-social').camera, 'string');
  });
  it('unknown mode/vocab falls back to narrative without throwing', () => {
    assert.equal(typeof cinemaMode('nope' as CinemaModeId).camera, 'string');
    assert.equal(typeof resolveCameraVocab('nope').camera, 'string');
  });
});

describe('hook patterns', () => {
  it('renders a 2s opening beat for a known pattern with a timecode stamp', () => {
    const beat = hookBeat('black-to-light', 2);
    assert.match(beat, /^\[00:00 - 00:02\]/);
    assert.ok(beat.length > 12);
  });
  it('honors a custom hook length', () => {
    assert.match(hookBeat('beat-drop', 3), /^\[00:00 - 00:03\]/);
  });
  it('exposes a non-empty pattern id list', () => {
    assert.ok(HOOK_PATTERN_IDS.length >= 4);
  });
  it('throws on an unknown pattern id', () => {
    assert.throws(() => hookBeat('nope' as HookPatternId, 2), /unknown hook pattern/i);
  });
});

describe('mode stacking', () => {
  it('keeps each shot\'s own mode block when modes differ (no averaging)', () => {
    const stacked = stackModes(['studio', 'action']);
    assert.equal(stacked.length, 2);
    assert.equal(stacked[0].modeId, 'studio');
    assert.equal(stacked[1].modeId, 'action');
    assert.notEqual(stacked[0].spec.camera, stacked[1].spec.camera); // distinct, not merged
  });
  it('preserves repeated modes as separate entries (one block per shot)', () => {
    const stacked = stackModes(['narrative', 'narrative']);
    assert.equal(stacked.length, 2);
    assert.equal(stacked[0].spec.camera, stacked[1].spec.camera);
  });
  it('renders a per-shot camera block string for each stacked shot', () => {
    const stacked = stackModes(['atmospheric', 'performance']);
    for (const s of stacked) assert.ok(s.block.includes(s.spec.camera));
  });
});

describe('genre defaults lookup', () => {
  it('returns concrete numeric defaults for a known genre', () => {
    const d = genreDefaults('music-video');
    assert.equal(typeof d.cutRatePerSec, 'number');
    assert.equal(typeof d.paletteHue, 'number');
    assert.equal(typeof d.keyLightId, 'string');
  });
  it('covers the known genres', () => {
    for (const g of ['live-action','pixar','anime','noir','influencer','action','music-video']) {
      assert.ok(genreDefaults(g).cutRatePerSec > 0, `${g} has a positive cut rate`);
    }
  });
  it('unknown genre falls back to a neutral default without throwing', () => {
    const d = genreDefaults('claymation');
    assert.equal(typeof d.cutRatePerSec, 'number');
  });
});

describe('beat templates', () => {
  it('three-act yields setup/rising/climax-style ordered beats summing to duration', () => {
    const b = beats('three-act', 15, 0);
    assert.ok(b.length >= 3);
    assert.equal(b[0].start, 0);
    assert.equal(b[b.length - 1].end, 15);
  });
  it('ad-hook-feature-cta starts with a hook beat and ends with a CTA beat', () => {
    const b = beats('ad-hook-feature-cta', 15, 2);
    assert.equal(b[0].start, 0);
    assert.equal(b[0].end, 2); // the 2s hook
    assert.match(b[0].label.toLowerCase(), /hook/);
    assert.match(b[b.length - 1].label.toLowerCase(), /cta|call to action/);
    assert.equal(b[b.length - 1].end, 15);
  });
  it('turntable brackets the clip with a hero-angle open and close', () => {
    const b = beats('turntable', 12, 0);
    assert.match(b[0].label.toLowerCase(), /hero/);
    assert.match(b[b.length - 1].label.toLowerCase(), /hero/);
    assert.equal(b[b.length - 1].end, 12);
  });
  it('lookbook yields pose-change beats covering the duration', () => {
    const b = beats('lookbook', 12, 0);
    assert.ok(b.length >= 2);
    assert.equal(b[b.length - 1].end, 12);
  });
});
