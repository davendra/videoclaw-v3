import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lintDialogue,
  countWords,
  STANDARD_MAX_WORDS,
  SIGNOFF_SCENE_INDEX,
  SIGNOFF_MAX_WORDS,
} from '../video/assemble/qa-dialogue-lint.js';
import {
  checkNarration,
  countNarrationWords,
} from '../video/assemble/qa-narration.js';
import {
  checkImageFilter,
  classifyImagePrompt,
} from '../video/assemble/qa-image-filter.js';
import { VclawError } from '../video/errors.js';

/** Build a string of n one-letter words. */
function words(n: number): string {
  return Array.from({ length: n }, () => 'word').join(' ');
}

describe('qa-dialogue-lint', () => {
  it('countWords ignores standalone punctuation, counts hyphenated as one', () => {
    assert.equal(countWords('the top-order collapsed — again'), 4);
    assert.equal(countWords('   '), 0);
    assert.equal(countWords('one'), 1);
  });

  it('passes when all segments are within limits', () => {
    const res = lintDialogue({
      segments: [
        { sceneIndex: 17, text: words(20) },
        { sceneIndex: 19, text: words(24) },
      ],
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.warnings, []);
  });

  it('flags near-limit (warn) for standard scene above recommended', () => {
    const res = lintDialogue({ segments: [{ sceneIndex: 17, text: words(27) }] });
    assert.equal(res.ok, false);
    assert.equal(res.warnings.length, 1);
    const w = res.warnings[0]!;
    assert.equal(w.sceneIndex, 17);
    assert.equal(w.rule, 'near-limit');
    assert.equal(w.wordCount, 27);
    assert.match(w.message, /edge/);
  });

  it('flags over-limit (error) for standard scene above max', () => {
    const res = lintDialogue({ segments: [{ sceneIndex: 19, text: words(STANDARD_MAX_WORDS + 6) }] });
    assert.equal(res.ok, false);
    const w = res.warnings[0]!;
    assert.equal(w.rule, 'over-limit');
    assert.match(w.message, /OVER LIMIT/);
  });

  it('applies the tighter sign-off ceiling to scene 21', () => {
    // 22 words is fine for a standard scene but over the sign-off max (20).
    const standard = lintDialogue({ segments: [{ sceneIndex: 20, text: words(22) }] });
    assert.equal(standard.ok, true);
    const signoff = lintDialogue({ segments: [{ sceneIndex: SIGNOFF_SCENE_INDEX, text: words(22) }] });
    assert.equal(signoff.ok, false);
    assert.equal(signoff.warnings[0]!.rule, 'over-limit');
    assert.equal(SIGNOFF_MAX_WORDS, 20);
  });

  it('respects override thresholds', () => {
    const res = lintDialogue({
      segments: [{ sceneIndex: 1, text: words(10) }],
      standardMaxWords: 5,
      standardRecommendedWords: 3,
    });
    assert.equal(res.ok, false);
    assert.equal(res.warnings[0]!.rule, 'over-limit');
  });

  it('throws VclawError on invalid input', () => {
    assert.throws(
      () => lintDialogue({ segments: undefined as never }),
      (err: unknown) => err instanceof VclawError && err.code === 'unexpected_internal_error',
    );
  });
});

describe('qa-narration', () => {
  it('countNarrationWords counts word-like tokens', () => {
    assert.equal(countNarrationWords('a quick — recap of 4 wickets'), 6);
  });

  it('passes for well-formed narration', () => {
    const res = checkNarration({
      scenes: [
        { sceneIndex: 1, narration: 'The openers steadied the chase early.' },
        { sceneIndex: 2, narration: 'Then a flurry of boundaries shifted momentum.' },
      ],
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.warnings, []);
  });

  it('flags empty narration', () => {
    const res = checkNarration({ scenes: [{ sceneIndex: 3, narration: '   ' }] });
    assert.equal(res.ok, false);
    assert.equal(res.warnings[0]!.rule, 'empty-narration');
    assert.equal(res.warnings[0]!.sceneIndex, 3);
  });

  it('flags over-length narration', () => {
    const res = checkNarration({
      scenes: [{ sceneIndex: 4, narration: words(80) }],
      maxNarrationWords: 60,
    });
    assert.equal(res.ok, false);
    assert.ok(res.warnings.some((w) => w.rule === 'over-length'));
  });

  it('flags timing overrun against a slide budget', () => {
    // 30 words at 2.5 w/s = 12s, exceeds a 5s budget.
    const res = checkNarration({
      scenes: [{ sceneIndex: 5, narration: words(30) }],
      slideDurationSec: 5,
    });
    assert.equal(res.ok, false);
    const timing = res.warnings.find((w) => w.rule === 'timing-overrun');
    assert.ok(timing);
    assert.match(timing!.message, /slide budget/);
  });

  it('does not flag timing when within budget', () => {
    // 10 words at 2.5 w/s = 4s, under an 8s budget.
    const res = checkNarration({
      scenes: [{ sceneIndex: 6, narration: words(10) }],
      slideDurationSec: 8,
    });
    assert.equal(res.ok, true);
  });

  it('flags slide/narration count mismatch as a whole-deck warning', () => {
    const res = checkNarration({
      scenes: [
        { sceneIndex: 1, narration: 'one' },
        { sceneIndex: 2, narration: 'two' },
      ],
      slideCount: 3,
    });
    assert.equal(res.ok, false);
    const mismatch = res.warnings.find((w) => w.rule === 'count-mismatch');
    assert.ok(mismatch);
    assert.equal(mismatch!.sceneIndex, -1);
  });

  it('passes when slide count matches scene count', () => {
    const res = checkNarration({
      scenes: [{ sceneIndex: 1, narration: 'one' }],
      slideCount: 1,
    });
    assert.equal(res.ok, true);
  });

  it('throws VclawError on invalid input', () => {
    assert.throws(
      () => checkNarration({ scenes: null as never }),
      (err: unknown) => err instanceof VclawError && err.code === 'unexpected_internal_error',
    );
  });
});

describe('qa-image-filter', () => {
  it('classifies a clean cricket prompt as safe', () => {
    const { verdict, categories } = classifyImagePrompt(
      'Player portrait in cricket gear beside a scoreboard and team logo',
    );
    assert.equal(verdict, 'safe');
    assert.deepEqual(categories, []);
  });

  it('classifies a single weapon mention as likely-blocked (high weight)', () => {
    const { verdict, categories } = classifyImagePrompt('A warrior holding a glowing sword');
    assert.equal(verdict, 'likely-blocked');
    assert.ok(categories.includes('weapon'));
  });

  it('classifies a single low-weight category as risky', () => {
    const { verdict, categories } = classifyImagePrompt('Batsman in a dramatic fighting stance');
    assert.equal(verdict, 'risky');
    assert.deepEqual(categories, ['combatPose']);
  });

  it('escalates two distinct categories to likely-blocked', () => {
    const { verdict } = classifyImagePrompt(
      'Helmeted silhouette in a destroyed environment striking a battle pose',
    );
    assert.equal(verdict, 'likely-blocked');
  });

  it('default threshold (risky) flags risky and above, not safe', () => {
    const res = checkImageFilter({
      candidates: [
        { sceneIndex: 1, prompt: 'clean cricket scoreboard' },
        { sceneIndex: 2, prompt: 'a fighting stance silhouette' },
        { sceneIndex: 3, prompt: 'demonic glowing eyes and a sword' },
      ],
    });
    assert.equal(res.ok, false);
    const scenes = res.warnings.map((w) => w.sceneIndex).sort();
    assert.deepEqual(scenes, [2, 3]);
  });

  it('honours a likely-blocked threshold (filters out merely risky)', () => {
    const res = checkImageFilter({
      candidates: [{ sceneIndex: 2, prompt: 'a fighting stance silhouette' }],
      threshold: 'likely-blocked',
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.warnings, []);
  });

  it('warning carries verdict + categories + message', () => {
    const res = checkImageFilter({
      candidates: [{ sceneIndex: 7, prompt: 'a glowing energy weapon' }],
    });
    const w = res.warnings[0]!;
    assert.equal(w.rule, 'content-filter-risk');
    assert.equal(w.verdict, 'likely-blocked');
    assert.ok(w.categories.includes('weapon'));
    assert.match(w.message, /soften/i);
  });

  it('throws VclawError on invalid input', () => {
    assert.throws(
      () => checkImageFilter({ candidates: 'nope' as never }),
      (err: unknown) => err instanceof VclawError && err.code === 'unexpected_internal_error',
    );
  });
});
