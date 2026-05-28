import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CINEMATIC_15S_PRESET,
  SEEDANCE_10S_PRESET,
  VEO_8S_PRESET,
  RUNWAY_10S_PRESET,
  resolvePreset,
  buildShotPlan,
  formatTimecode,
  assembleMetadataBlock,
  composePromptText,
  listMultiShotPresets,
  parseMultiShotPrompt,
  type MultiShotPreset,
} from '../video/multi-shot-prompt.js';

describe('multi-shot-prompt: preset shot bounds', () => {
  it('CINEMATIC_15S_PRESET declares explicit shot-count bounds', () => {
    assert.equal(CINEMATIC_15S_PRESET.minShots, 3);
    assert.equal(CINEMATIC_15S_PRESET.maxShots, 7);
  });

  it('buildShotPlan respects preset.minShots / preset.maxShots when --shots not given', () => {
    const narrowed: MultiShotPreset = {
      ...CINEMATIC_15S_PRESET,
      name: 'narrowed-test',
      minShots: 4,
      maxShots: 4,
    };
    for (let seed = 1; seed <= 30; seed += 1) {
      const plan = buildShotPlan(narrowed, { seed });
      assert.equal(plan.shots.length, 4, `seed=${seed}`);
    }
  });
});

describe('multi-shot-prompt: preset registry', () => {
  it('listMultiShotPresets returns every registered preset in registry order', () => {
    assert.deepEqual(
      listMultiShotPresets().map((preset) => preset.name),
      ['cinematic-15s', 'seedance-10s', 'veo-8s', 'runway-10s'],
    );
  });

  it('SEEDANCE_10S_PRESET constants', () => {
    assert.equal(SEEDANCE_10S_PRESET.name, 'seedance-10s');
    assert.equal(SEEDANCE_10S_PRESET.totalSeconds, 10);
    assert.equal(SEEDANCE_10S_PRESET.minShotSeconds, 2);
    assert.equal(SEEDANCE_10S_PRESET.maxShotSeconds, 5);
    assert.equal(SEEDANCE_10S_PRESET.minShots, 2);
    assert.equal(SEEDANCE_10S_PRESET.maxShots, 5);
    assert.equal(SEEDANCE_10S_PRESET.maxChars, 1500);
    assert.equal(SEEDANCE_10S_PRESET.styleLine, CINEMATIC_15S_PRESET.styleLine);
    assert.equal(SEEDANCE_10S_PRESET.audioLine, CINEMATIC_15S_PRESET.audioLine);
  });

  it('VEO_8S_PRESET constants', () => {
    assert.equal(VEO_8S_PRESET.name, 'veo-8s');
    assert.equal(VEO_8S_PRESET.totalSeconds, 8);
    assert.equal(VEO_8S_PRESET.minShotSeconds, 2);
    assert.equal(VEO_8S_PRESET.maxShotSeconds, 4);
    assert.equal(VEO_8S_PRESET.minShots, 2);
    assert.equal(VEO_8S_PRESET.maxShots, 4);
    assert.equal(VEO_8S_PRESET.maxChars, 1500);
  });

  it('RUNWAY_10S_PRESET constants', () => {
    assert.equal(RUNWAY_10S_PRESET.name, 'runway-10s');
    assert.equal(RUNWAY_10S_PRESET.totalSeconds, 10);
    assert.equal(RUNWAY_10S_PRESET.minShotSeconds, 2);
    assert.equal(RUNWAY_10S_PRESET.maxShotSeconds, 5);
    assert.equal(RUNWAY_10S_PRESET.minShots, 2);
    assert.equal(RUNWAY_10S_PRESET.maxShots, 5);
    assert.equal(RUNWAY_10S_PRESET.maxChars, 1000);
  });

  it('resolvePreset defaults to cinematic-15s when name is undefined', () => {
    assert.strictEqual(resolvePreset(), CINEMATIC_15S_PRESET);
    assert.strictEqual(resolvePreset(undefined), CINEMATIC_15S_PRESET);
  });

  it('resolvePreset returns the registered preset for each known name', () => {
    assert.strictEqual(resolvePreset('cinematic-15s'), CINEMATIC_15S_PRESET);
    assert.strictEqual(resolvePreset('seedance-10s'), SEEDANCE_10S_PRESET);
    assert.strictEqual(resolvePreset('veo-8s'), VEO_8S_PRESET);
    assert.strictEqual(resolvePreset('runway-10s'), RUNWAY_10S_PRESET);
  });

  it('resolvePreset throws on unknown names with the full known list', () => {
    assert.throws(
      () => resolvePreset('bogus-99s'),
      /unknown preset "bogus-99s".*cinematic-15s.*seedance-10s.*veo-8s.*runway-10s/,
    );
  });
});

const ALL_PRESETS: readonly MultiShotPreset[] = [
  CINEMATIC_15S_PRESET,
  SEEDANCE_10S_PRESET,
  VEO_8S_PRESET,
  RUNWAY_10S_PRESET,
];

describe('multi-shot-prompt: buildShotPlan invariants (all presets)', () => {
  for (const preset of ALL_PRESETS) {
    it(`invariants hold across 30 seeds — ${preset.name}`, () => {
      for (let seed = 1; seed <= 30; seed += 1) {
        const plan = buildShotPlan(preset, { seed });
        const n = plan.shots.length;

        assert.ok(
          n >= preset.minShots && n <= preset.maxShots,
          `${preset.name} seed=${seed}: shot count ${n} outside [${preset.minShots}, ${preset.maxShots}]`,
        );

        let cursor = 0;
        let prevSize: string | undefined;
        let prevLens: string | undefined;
        let prevAngle: string | undefined;
        let prevMove: string | undefined;
        for (const shot of plan.shots) {
          const dur = shot.end - shot.start;
          assert.ok(
            dur >= preset.minShotSeconds && dur <= preset.maxShotSeconds,
            `${preset.name} seed=${seed} shot ${shot.index}: duration ${dur}s outside [${preset.minShotSeconds}, ${preset.maxShotSeconds}]`,
          );
          assert.equal(
            shot.start,
            cursor,
            `${preset.name} seed=${seed} shot ${shot.index}: gap/overlap (start ${shot.start}, expected ${cursor})`,
          );
          cursor = shot.end;
          assert.notStrictEqual(shot.shotSize, prevSize, `${preset.name} seed=${seed} shot ${shot.index}: shotSize repeats prev`);
          assert.notStrictEqual(shot.lens, prevLens, `${preset.name} seed=${seed} shot ${shot.index}: lens repeats prev`);
          assert.notStrictEqual(shot.angle, prevAngle, `${preset.name} seed=${seed} shot ${shot.index}: angle repeats prev`);
          assert.notStrictEqual(shot.movement, prevMove, `${preset.name} seed=${seed} shot ${shot.index}: movement repeats prev`);
          prevSize = shot.shotSize;
          prevLens = shot.lens;
          prevAngle = shot.angle;
          prevMove = shot.movement;
        }
        assert.equal(
          cursor,
          preset.totalSeconds,
          `${preset.name} seed=${seed}: total ${cursor}s != ${preset.totalSeconds}s`,
        );
      }
    });
  }
});

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

describe('multi-shot-prompt: parseMultiShotPrompt', () => {
  it('parses authored prompt text into structured shot rows', () => {
    const prompt = [
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
    const shots = parseMultiShotPrompt(prompt);
    assert.equal(shots.length, 5);
    assert.deepEqual(
      {
        index: shots[0].index,
        timecode: shots[0].timecode,
        start: shots[0].start,
        end: shots[0].end,
        shotSize: shots[0].shotSize,
        lens: shots[0].lens,
        angle: shots[0].angle,
        movement: shots[0].movement,
      },
      {
        index: 0,
        timecode: '[00:00 - 00:04]',
        start: 0,
        end: 4,
        shotSize: 'wide',
        lens: '24mm',
        angle: 'low angle',
        movement: 'tracking',
      },
    );
    assert.equal(shots[0].description, 'a man walks through a Tokyo alley.');
  });

  it('normalizes spaced and hyphenated camera terms without corrupting descriptions', () => {
    const text = [
      '[00:00 - 00:04] Wide, 24mm, eye level, push in — a woman crosses frame.',
      '',
      '[00:04 - 00:08] Medium close up, 50mm, eye-level, pull-out — she turns back.',
      '',
      'Location: X, day',
      'Style: Y',
      'Audio: Z',
    ].join('\n');
    const shots = parseMultiShotPrompt(text);
    assert.equal(shots[0].angle, 'eye-level');
    assert.equal(shots[0].movement, 'push-in');
    assert.equal(shots[1].shotSize, 'medium close-up');
    assert.equal(shots[1].description, 'she turns back.');
  });

  it('keeps parseable rows even when a camera field is absent', () => {
    const shots = parseMultiShotPrompt('[00:00 - 00:04] Wide shot only — no full camera grid.');
    assert.equal(shots.length, 1);
    assert.equal(shots[0].shotSize, 'wide');
    assert.equal(shots[0].lens, '');
    assert.equal(shots[0].angle, '');
    assert.equal(shots[0].movement, '');
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

  it('detects repeated movement when authored with spaces ("push in") instead of hyphens ("push-in")', () => {
    // Two consecutive shots both use the SPACED spelling "push in".
    // Shot sizes, lenses, and angles are all varied so ONLY movement repeats.
    // This test FAILS before the firstMatch hyphen/space normalisation fix and
    // PASSES after it.
    const spacedMovementPrompt = [
      '[00:00 - 00:04] Wide, 24mm, low angle, push in — a man walks through a Tokyo alley.',
      '',
      '[00:04 - 00:08] Medium, 50mm, eye-level, push in — he moves between food stalls.',
      '',
      '[00:08 - 00:11] Close-up, 85mm, high angle, static — his hand brushes a lantern.',
      '',
      '[00:11 - 00:15] Medium close-up, 35mm, Dutch angle, handheld — he looks up at a sign.',
      '',
      'Location: Narrow Tokyo alley, night.',
      'Style: Cool shadows, natural skin tones. In the style of a Christopher Nolan movie.',
      'Audio: Diegetic sound only — natural ambience.',
    ].join('\n');
    assert.ok(
      codes(runMultiShotChecks(spacedMovementPrompt, CINEMATIC_15S_PRESET)).includes('multi-shot-repeated-parameter'),
      'expected multi-shot-repeated-parameter when consecutive shots both use spaced "push in"',
    );
  });

  it('emits shot-count-out-of-range when too few shots (veo-8s requires minShots=2)', () => {
    const text = [
      '[00:00 - 00:08] Single static shot spanning the full duration.',
      '',
      'Location: Test, evening',
      `Style: ${VEO_8S_PRESET.styleLine}`,
      `Audio: ${VEO_8S_PRESET.audioLine}`,
    ].join('\n');
    const issues = runMultiShotChecks(text, VEO_8S_PRESET);
    const match = issues.find((i: PromptQualityIssue) => i.code === 'multi-shot-shot-count-out-of-range');
    assert.ok(match, `expected shot-count-out-of-range issue, got: ${JSON.stringify(issues)}`);
    assert.equal(match!.severity, 'error');
    assert.match(match!.message, /too few/i);
  });

  it('emits shot-count-out-of-range when too many shots (veo-8s requires maxShots=4)', () => {
    // 5 shots × 2s each totals 10s — total mismatch will ALSO fire, but the shot-count check is what we assert.
    const lines: string[] = [];
    const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    for (let i = 0; i < 5; i += 1) {
      const start = i * 2;
      const end = (i + 1) * 2;
      lines.push(`[${fmt(start)} - ${fmt(end)}] Shot ${i}.`);
      lines.push('');
    }
    lines.push('Location: Test, evening');
    lines.push(`Style: ${VEO_8S_PRESET.styleLine}`);
    lines.push(`Audio: ${VEO_8S_PRESET.audioLine}`);
    const issues = runMultiShotChecks(lines.join('\n'), VEO_8S_PRESET);
    const match = issues.find((i: PromptQualityIssue) => i.code === 'multi-shot-shot-count-out-of-range');
    assert.ok(match, `expected shot-count-out-of-range issue, got: ${JSON.stringify(issues)}`);
    assert.equal(match!.severity, 'error');
    assert.match(match!.message, /too many/i);
  });

  it('does NOT emit shot-count-out-of-range at the boundaries (cinematic-15s 3 and 7)', () => {
    const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    const mkPrompt = (durations: number[]) => {
      let cursor = 0;
      const lines: string[] = [];
      for (let i = 0; i < durations.length; i += 1) {
        const start = cursor;
        const end = cursor + durations[i];
        cursor = end;
        lines.push(`[${fmt(start)} - ${fmt(end)}] Shot ${i}.`);
        lines.push('');
      }
      lines.push('Location: Test, evening');
      lines.push(`Style: ${CINEMATIC_15S_PRESET.styleLine}`);
      lines.push(`Audio: ${CINEMATIC_15S_PRESET.audioLine}`);
      return lines.join('\n');
    };
    for (const durs of [[5, 5, 5], [2, 2, 2, 2, 2, 2, 3]]) {
      const issues = runMultiShotChecks(mkPrompt(durs), CINEMATIC_15S_PRESET);
      const match = issues.find((i: PromptQualityIssue) => i.code === 'multi-shot-shot-count-out-of-range');
      assert.equal(match, undefined, `boundary count ${durs.length}: unexpected issue ${JSON.stringify(match)}`);
    }
  });
});
