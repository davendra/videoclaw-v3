import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cameraSpec, lightingSpec, gradeSpec, audioMix, type DetailLevel } from '../video/cinematography.js';
import { cinemaMode, resolveCameraVocab, CINEMA_MODE_IDS, type CinemaModeId } from '../video/cinematography.js';

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
