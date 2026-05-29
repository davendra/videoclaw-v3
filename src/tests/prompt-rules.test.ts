import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripProperNames, brandNeutralize, noFaceMorphTag, diegeticAudioLine } from '../video/prompt-rules.js';

describe('standing prompt rules', () => {
  it('replaces a known proper name with its descriptor', () => {
    const out = stripProperNames('Meera raises her pistol', [{ name: 'Meera', descriptor: 'the woman with the long dark braid' }]);
    assert.match(out, /the woman with the long dark braid raises/);
    assert.doesNotMatch(out, /Meera/);
  });
  it('is word-boundary safe (does not replace substrings inside other words)', () => {
    const out = stripProperNames('Ramesh and Meera', [{ name: 'Mee', descriptor: 'X' }]);
    assert.match(out, /Meera/); // "Mee" must not clobber "Meera"
  });
  it('scrubs a brand token to a generic descriptor', () => {
    assert.doesNotMatch(brandNeutralize('wearing Nike shoes', ['Nike']), /Nike/);
  });
  it('emits the no-face-morphing tag and a diegetic audio line', () => {
    assert.match(noFaceMorphTag(), /no face morphing/i);
    assert.match(diegeticAudioLine(), /Diegetic sound only/);
  });
});
