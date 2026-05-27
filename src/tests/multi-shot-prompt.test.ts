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
