import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CINEMATIC_15S_PRESET,
  buildShotPlan,
  formatTimecode,
  assembleMetadataBlock,
  composePromptText,
} from '../video/multi-shot-prompt.js';

describe('multi-shot-prompt: buildShotPlan', () => {
  it('produces shots that sum to the preset total and stay within bounds', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const plan = buildShotPlan(CINEMATIC_15S_PRESET, { seed });
      const total = plan.shots.reduce((sum, s) => sum + (s.end - s.start), 0);
      assert.equal(total, CINEMATIC_15S_PRESET.totalSeconds, `seed ${seed} total`);
      assert.ok(plan.shots.length >= 3 && plan.shots.length <= 7, `seed ${seed} count`);
      assert.equal(plan.shots[0].start, 0);
      for (const s of plan.shots) {
        const dur = s.end - s.start;
        assert.ok(dur >= CINEMATIC_15S_PRESET.minShotSeconds, `seed ${seed} min`);
        assert.ok(dur <= CINEMATIC_15S_PRESET.maxShotSeconds, `seed ${seed} max`);
      }
    }
  });

  it('varies shot count across seeds', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 20; seed += 1) {
      counts.add(buildShotPlan(CINEMATIC_15S_PRESET, { seed }).shots.length);
    }
    assert.ok(counts.size > 1, 'expected varied shot counts across seeds');
  });

  it('respects an explicit shot count', () => {
    const plan = buildShotPlan(CINEMATIC_15S_PRESET, { shots: 5, seed: 1 });
    assert.equal(plan.shots.length, 5);
  });

  it('suggests a non-repeating camera grid for consecutive shots', () => {
    const plan = buildShotPlan(CINEMATIC_15S_PRESET, { shots: 5, seed: 3 });
    for (let i = 1; i < plan.shots.length; i += 1) {
      const prev = plan.shots[i - 1];
      const cur = plan.shots[i];
      assert.notEqual(cur.shotSize, prev.shotSize, `shot ${i} shotSize repeats`);
      assert.notEqual(cur.movement, prev.movement, `shot ${i} movement repeats`);
    }
  });
});

describe('multi-shot-prompt: formatTimecode', () => {
  it('formats seconds as MM:SS', () => {
    assert.equal(formatTimecode(0), '00:00');
    assert.equal(formatTimecode(4), '00:04');
    assert.equal(formatTimecode(65), '01:05');
  });
});

describe('multi-shot-prompt: assembleMetadataBlock', () => {
  it('emits the three-line Location/Style/Audio block', () => {
    const block = assembleMetadataBlock(CINEMATIC_15S_PRESET, 'Tokyo alley', 'night');
    const lines = block.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Location: Tokyo alley, night\.?$/);
    assert.match(lines[1], /^Style: .*Christopher Nolan/);
    assert.match(lines[2], /^Audio: Diegetic sound only/);
  });
});

describe('multi-shot-prompt: composePromptText', () => {
  it('joins shot lines with blank lines and appends the metadata block', () => {
    const text = composePromptText(
      [
        { timecode: '[00:00 - 00:04]', line: 'Wide, a man walks.' },
        { timecode: '[00:04 - 00:08]', line: 'Medium, he turns.' },
      ],
      'Location: X\nStyle: Y\nAudio: Z',
    );
    assert.equal(
      text,
      '[00:00 - 00:04] Wide, a man walks.\n\n[00:04 - 00:08] Medium, he turns.\n\nLocation: X\nStyle: Y\nAudio: Z',
    );
  });
});

import { runMultiShotChecks, type PromptQualityIssue } from '../video/prompt-quality.js';

const VALID_PROMPT = [
  '[00:00 - 00:04] Wide, 24mm, low angle, tracking — a man walks through a Tokyo alley.',
  '',
  '[00:04 - 00:07] Medium, 50mm, eye-level, handheld — he moves between food stalls.',
  '',
  '[00:07 - 00:09] Close-up, 85mm, high angle, static — his hand brushes a lantern.',
  '',
  '[00:09 - 00:12] Wide, 35mm, Dutch angle, push-in — he emerges into a broad street.',
  '',
  '[00:12 - 00:15] Medium close-up, 50mm, low angle, pull-out — he looks up at a sign.',
  '',
  'Location: Narrow Tokyo alley, night.',
  'Style: Cool shadows, natural skin tones. In the style of a Christopher Nolan movie.',
  'Audio: Diegetic sound only — natural ambience.',
].join('\n');

function codes(issues: PromptQualityIssue[]): string[] {
  return issues.map((i) => i.code);
}

describe('multi-shot-prompt: runMultiShotChecks', () => {
  it('passes a well-formed prompt with no errors', () => {
    const issues = runMultiShotChecks(VALID_PROMPT, CINEMATIC_15S_PRESET);
    assert.equal(issues.filter((i) => i.severity === 'error').length, 0, JSON.stringify(issues));
  });

  it('flags timecodes that do not total the preset duration', () => {
    const bad = VALID_PROMPT.replace('[00:12 - 00:15]', '[00:12 - 00:14]');
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-timecode-total'));
  });

  it('flags non-contiguous timecodes', () => {
    const bad = VALID_PROMPT.replace('[00:04 - 00:07]', '[00:05 - 00:07]');
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-timecode-gap'));
  });

  it('flags a first shot that does not start at 00:00', () => {
    const bad = [
      '[00:01 - 00:04] Wide, 24mm, low angle, tracking — a man walks through a Tokyo alley.',
      '',
      '[00:04 - 00:07] Medium, 50mm, eye-level, handheld — he moves between food stalls.',
      '',
      '[00:07 - 00:09] Close-up, 85mm, high angle, static — his hand brushes a lantern.',
      '',
      '[00:09 - 00:12] Wide, 35mm, Dutch angle, push-in — he emerges into a broad street.',
      '',
      '[00:12 - 00:15] Medium close-up, 50mm, low angle, pull-out — he looks up at a sign.',
      '',
      'Location: Narrow Tokyo alley, night.',
      'Style: Cool shadows. In the style of a Christopher Nolan movie.',
      'Audio: Diegetic sound only.',
    ].join('\n');
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-timecode-start'));
  });

  it('flags a prompt with no parseable timecode stamps', () => {
    const bad = [
      'A man walks through a narrow Tokyo alley, glancing at the food stalls.',
      '',
      'Location: Narrow Tokyo alley, night.',
      'Style: Cool shadows. In the style of a Christopher Nolan movie.',
      'Audio: Diegetic sound only.',
    ].join('\n');
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-timecode-parse'));
  });

  it('flags a shot shorter than minShotSeconds', () => {
    const bad = [
      '[00:00 - 00:01] Wide, 24mm, low angle, tracking — too short.',
      '',
      '[00:01 - 00:15] Medium, 50mm, eye-level, handheld — too long.',
      '',
      'Location: X, night.',
      'Style: Nolan.',
      'Audio: Diegetic.',
    ].join('\n');
    const c = codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET));
    assert.ok(c.includes('multi-shot-shot-duration'));
  });

  it('flags exceeding the character budget', () => {
    const bad = VALID_PROMPT + ' '.repeat(1600);
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-overlong'));
  });

  it('flags a repeated camera parameter in consecutive shots', () => {
    const bad = VALID_PROMPT.replace(
      '[00:04 - 00:07] Medium, 50mm, eye-level, handheld',
      '[00:04 - 00:07] Wide, 50mm, eye-level, handheld',
    );
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-repeated-parameter'));
  });

  it('flags a missing metadata block', () => {
    const bad = VALID_PROMPT.split('\nLocation:')[0];
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-missing-metadata'));
  });
});
