import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSeedanceBlockOrder,
  resolveGenreStyle,
  seedancePromptText,
} from '../video/filmmaking-prompts.js';

// The 10-block Joey master-prompt order (WS6). The text-driven Seedance packet
// must emit exactly these block labels, in this sequence.
const TEN_BLOCK_ORDER = [
  'SCENE & MOOD',
  'FRAME MAP',
  'SUBJECT LOCK',
  'CROSS-FRAME',
  'MOVEMENT',
  'LAST FRAME',
  'WORLD PLATE',
  'SOUND BED',
  'CAPTURE REALISM',
  'CAMERA CAPTURE',
] as const;

function minimalScene(): Parameters<typeof seedancePromptText>[0]['scene'] {
  return {
    sceneIndex: 0,
    description: 'A lone figure crosses a rain-slick courtyard',
    durationSeconds: 9,
    scenePrompt: { animationPrompt: 'The figure walks forward through the rain.' },
  };
}

test('text-driven packet emits the 10 blocks in Joey order', () => {
  const text = seedancePromptText({
    scene: minimalScene(),
    brief: { title: 'Night Crossing', intent: 'A tense night-time vignette.' } as Parameters<typeof seedancePromptText>[0]['brief'],
    references: [],
    variant: 'text-driven',
    durationSeconds: 9,
    genreStyle: resolveGenreStyle('live-action'),
  });

  let last = -1;
  for (const block of TEN_BLOCK_ORDER) {
    const idx = text.indexOf(block);
    assert.ok(idx > last, `block ${block} out of order or missing (idx=${idx}, last=${last})`);
    last = idx;
  }
});

test('text-driven packet at default detail carries no quantified cinematography tokens', () => {
  const text = seedancePromptText({
    scene: minimalScene(),
    brief: undefined,
    references: [],
    variant: 'text-driven',
    durationSeconds: 9,
    genreStyle: resolveGenreStyle('live-action'),
  });
  assert.doesNotMatch(text, /\d+K|\d+°|dB|ft\/s/);
});

test('checkSeedanceBlockOrder returns null for a well-ordered 10-block packet', () => {
  const text = seedancePromptText({
    scene: minimalScene(),
    brief: undefined,
    references: [],
    variant: 'text-driven',
    durationSeconds: 9,
    genreStyle: resolveGenreStyle('live-action'),
  });
  assert.equal(checkSeedanceBlockOrder(text), null);
});

test('checkSeedanceBlockOrder warns when a block is missing', () => {
  const broken = [
    'SCENE & MOOD: x',
    'FRAME MAP:',
    'SUBJECT LOCK: y',
    'MOVEMENT: z',
    'LAST FRAME: w',
    'WORLD PLATE: v',
    'SOUND BED: u',
    'CAPTURE REALISM: t',
    'CAMERA CAPTURE: s',
  ].join('\n');
  const issue = checkSeedanceBlockOrder(broken);
  assert.equal(issue?.code, 'seedance-block-order');
  assert.equal(issue?.severity, 'warning');
});

test('checkSeedanceBlockOrder warns when blocks are out of order', () => {
  const reordered = [
    'FRAME MAP:',
    'SCENE & MOOD: x',
    'SUBJECT LOCK: y',
    'CROSS-FRAME: a',
    'MOVEMENT: z',
    'LAST FRAME: w',
    'WORLD PLATE: v',
    'SOUND BED: u',
    'CAPTURE REALISM: t',
    'CAMERA CAPTURE: s',
  ].join('\n');
  const issue = checkSeedanceBlockOrder(reordered);
  assert.equal(issue?.code, 'seedance-block-order');
  assert.equal(issue?.severity, 'warning');
});
