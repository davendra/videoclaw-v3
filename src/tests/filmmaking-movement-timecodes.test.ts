import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSeedanceBlockOrder,
  resolveGenreStyle,
  seedancePromptText,
} from '../video/filmmaking-prompts.js';
import type { DetailLevel } from '../video/cinematography.js';

function scene(durationSeconds: number): Parameters<typeof seedancePromptText>[0]['scene'] {
  return {
    sceneIndex: 0,
    description: 'A lone figure crosses a rain-slick courtyard',
    durationSeconds,
    scenePrompt: { animationPrompt: 'The figure walks forward through the rain.' },
  };
}

// Render the text-driven packet with an explicit detail level so the test does
// not depend on the resolved-profile default. `seedancePromptText` with no
// `profile` uses the legacy default register, which is all this block needs.
function render(durationSeconds: number, detail: DetailLevel = 'standard'): string {
  return seedancePromptText({
    scene: scene(durationSeconds),
    brief: undefined,
    references: [],
    variant: 'text-driven',
    durationSeconds,
    genreStyle: resolveGenreStyle('live-action'),
    detail,
  });
}

function movementLine(text: string): string {
  const line = text.split('\n').find((l) => l.startsWith('MOVEMENT:'));
  assert.ok(line, 'MOVEMENT line present');
  return line!;
}

test('MOVEMENT block carries inline per-beat timecodes', () => {
  const line = movementLine(render(9));
  // The first beat starts at 0:00 and the block reads the per-shot timecode spans.
  assert.match(line, /MOVEMENT:.*\(0:00-0:03\)/);
  assert.match(line, /\(0:03-0:06\)/);
  assert.match(line, /\(0:06-0:09\)/);
});

test('single-shot MOVEMENT is one flowing paragraph with no Shot/hard-cut labels', () => {
  // Per cinema-worldbuilder-pro-2.0: a 4–8s (here 9s, still under the multi-cut
  // threshold) scene is "one strong character action, single locked composition"
  // (Rule #21: one main idea per shot). The single-shot Movement example is one
  // flowing four-layer paragraph with inline per-beat timestamps and NO "Shot N"
  // labels — the hard-cut form is reserved for multi-cut sequences only.
  const line = movementLine(render(9));
  assert.doesNotMatch(line, /Shot \d/);
  assert.doesNotMatch(line, /Hard cut to/);
});

test('multi-cut MOVEMENT labels per-shot beats with hard-cut markers', () => {
  // A 12–15s scene is "2–3 simple beats with hard cuts inside the prompt"
  // (cinema-worldbuilder-pro-2.0). Above the multi-cut duration threshold the
  // Movement block names each shot and stitches them with "Hard cut to".
  const line = movementLine(render(15));
  assert.match(line, /Shot 1 \(0:00-0:05\)/);
  assert.match(line, /Hard cut to Shot 2 \(0:05-0:10\)/);
  assert.match(line, /Hard cut to Shot 3 \(0:10-0:15\)/);
});

test('timecoded MOVEMENT keeps the 10-block order intact', () => {
  assert.equal(checkSeedanceBlockOrder(render(15)), null);
  assert.equal(checkSeedanceBlockOrder(render(9)), null);
});

test('terse-detail MOVEMENT carries no quantified cinematography tokens', () => {
  // detail governs quantified-token emission per beat exactly as before: at
  // terse there is no lens-mm or ft/s, even though the timecodes are present.
  const line = movementLine(render(9, 'terse'));
  assert.match(line, /\(0:00-0:03\)/);
  assert.doesNotMatch(line, /\d+mm|ft\/s/);
});

test('rich-detail MOVEMENT still carries the quantified camera tokens per beat', () => {
  const line = movementLine(render(9, 'rich'));
  assert.match(line, /35mm/);
  assert.match(line, /ft\/s/);
});

test('MOVEMENT beats are deterministic across calls', () => {
  assert.equal(render(12), render(12));
});
