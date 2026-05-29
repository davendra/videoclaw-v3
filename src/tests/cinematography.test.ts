import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cameraSpec, lightingSpec, gradeSpec, type DetailLevel } from '../video/cinematography.js';

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
