import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDialogue } from '../video/multi-shot-prompt.js';

const SHOT_LINE = 'Medium shot, 50mm lens, eye-level, slow push-in on the operator at the console.';

function countReplies(text: string): number {
  return text.split('replies:').length - 1;
}

test('withDialogue: single speaker carries the line and emits zero replies: openers', () => {
  const out = withDialogue(SHOT_LINE, { speaker: 'Mara', line: 'We are clear to launch.' });
  assert.ok(out.includes('We are clear to launch.'), 'speaker line preserved');
  assert.ok(out.includes('Mara'), 'speaker name present');
  assert.equal(countReplies(out), 0, 'no replies: opener for a single speaker');
});

test('withDialogue: single speaker weaves in emotion when present', () => {
  const out = withDialogue(SHOT_LINE, { speaker: 'Mara', line: 'We are clear to launch.', emotion: 'calm' });
  assert.ok(out.includes('calm'), 'emotion woven into opener');
  assert.equal(countReplies(out), 0, 'still no replies: opener');
});

test('withDialogue: two speakers carry the second line and emit exactly one replies: opener', () => {
  const out = withDialogue(SHOT_LINE, {
    speaker: 'Mara',
    line: 'We are clear to launch.',
    secondSpeaker: { speaker: 'Devon', line: 'Copy that, on your mark.' },
  });
  assert.ok(out.includes('Copy that, on your mark.'), 'second speaker line preserved');
  assert.equal(countReplies(out), 1, 'exactly one replies: opener for two speakers');
});

test('withDialogue: preserves the original shot line at the start', () => {
  const out = withDialogue(SHOT_LINE, { speaker: 'Mara', line: 'We are clear to launch.' });
  assert.ok(out.startsWith(SHOT_LINE), 'original shot line preserved at start');
});

test('withDialogue: deterministic — identical calls produce identical output', () => {
  const args = {
    speaker: 'Mara',
    line: 'We are clear to launch.',
    emotion: 'tense',
    secondSpeaker: { speaker: 'Devon', line: 'Copy that.', emotion: 'wary' },
  } as const;
  assert.equal(withDialogue(SHOT_LINE, { ...args }), withDialogue(SHOT_LINE, { ...args }));
});
