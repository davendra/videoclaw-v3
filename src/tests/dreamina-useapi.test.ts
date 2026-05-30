import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDreaminaSubmitBody } from '../video/providers/dreamina-useapi.js';

describe('buildDreaminaSubmitBody single-frame / text modes', () => {
  it('emits firstFrameRef and drops ratio in first_frame mode', () => {
    const body = buildDreaminaSubmitBody({
      apiToken: 't',
      model: 'seedance-2.0',
      prompt: 'continue from this frame',
      firstFrameRef: 'frame-1',
      ratio: '16:9',
    });
    assert.equal(body.firstFrameRef, 'frame-1');
    assert.equal('ratio' in body, false, 'first_frame mode auto-detects ratio');
    assert.equal('omni_1_imageRef' in body, false);
  });

  it('emits ratio for pure text-to-video (no refs)', () => {
    const body = buildDreaminaSubmitBody({
      apiToken: 't',
      model: 'seedance-2.0',
      prompt: 'a serene mountain at dawn',
      ratio: '9:16',
    });
    assert.equal(body.ratio, '9:16');
    assert.equal('firstFrameRef' in body, false);
    assert.equal('omni_1_imageRef' in body, false);
  });
});

describe('buildDreaminaSubmitBody Omni Reference (multi-ref)', () => {
  it('emits omni_N_imageRef/videoRef/audioRef and drops firstFrameRef/ratio', () => {
    const body = buildDreaminaSubmitBody({
      apiToken: 't',
      model: 'seedance-2.0',
      prompt: 'three warriors @image1 @image2',
      imageRefs: ['ref-a', 'ref-b'],
      videoRefs: ['vid-a'],
      audioRefs: ['aud-a'],
      // firstFrameRef and ratio must be ignored once omni refs are present.
      firstFrameRef: 'should-be-dropped',
      ratio: '9:16',
    });
    assert.equal(body.omni_1_imageRef, 'ref-a');
    assert.equal(body.omni_2_imageRef, 'ref-b');
    assert.equal(body.omni_1_videoRef, 'vid-a');
    assert.equal(body.omni_1_audioRef, 'aud-a');
    assert.equal('firstFrameRef' in body, false);
    assert.equal('ratio' in body, false);
  });

  it('caps omni image refs at 9 (omni_9 set, omni_10 absent)', () => {
    const imageRefs = Array.from({ length: 12 }, (_, i) => `ref-${i + 1}`);
    const body = buildDreaminaSubmitBody({
      apiToken: 't',
      model: 'seedance-2.0',
      prompt: 'crowd scene',
      imageRefs,
    });
    assert.equal(body.omni_9_imageRef, 'ref-9');
    assert.equal('omni_10_imageRef' in body, false);
  });

  it('keeps single firstFrameRef when no omni refs are present (unchanged)', () => {
    const body = buildDreaminaSubmitBody({
      apiToken: 't',
      model: 'seedance-2.0',
      prompt: 'a quiet lake',
      firstFrameRef: 'frame-1',
      ratio: '16:9',
    });
    assert.equal(body.firstFrameRef, 'frame-1');
    assert.equal('ratio' in body, false);
    assert.equal('omni_1_imageRef' in body, false);
  });
});
