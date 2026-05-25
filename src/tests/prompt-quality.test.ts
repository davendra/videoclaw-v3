import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runPromptQualityChecks,
  type PromptQualityIssue,
} from '../video/prompt-quality.js';

describe('prompt-quality', () => {
  it('returns empty array for a clean prompt', () => {
    const issues: PromptQualityIssue[] = runPromptQualityChecks(
      'A woman walks through a market at dusk. Handheld camera. Warm light.',
    );
    assert.deepEqual(issues, []);
  });

  it('detects adjective soup', () => {
    const issues = runPromptQualityChecks(
      'A tall, mysterious, charismatic, weathered, sun-kissed, stoic man walks.',
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, 'prompt-quality-adjective-soup');
    assert.equal(issues[0]?.severity, 'warn');
  });

  it('clean sentence with few adjectives passes', () => {
    const issues = runPromptQualityChecks('A tall man walks through the market.');
    assert.deepEqual(issues, []);
  });

  it('flags overlong prompt', () => {
    const longPrompt = 'a man walks here. '.repeat(40).trim();
    const issues = runPromptQualityChecks(longPrompt + ' extra word extra word extra word');
    assert.ok(issues.some((i) => i.code === 'prompt-quality-overlong'));
    const over = issues.find((i) => i.code === 'prompt-quality-overlong');
    assert.equal(over?.severity, 'warn');
  });

  it('promotes overlong prompt to error under strict mode', () => {
    const previous = process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY = '1';
    try {
      const longPrompt = 'a man walks here. '.repeat(40).trim();
      const issues = runPromptQualityChecks(longPrompt + ' extra word extra word extra word');
      const over = issues.find((i) => i.code === 'prompt-quality-overlong');
      assert.equal(over?.severity, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
      } else {
        process.env.DIRECTOR_STRICT_PROMPT_QUALITY = previous;
      }
    }
  });

  it('flags literary emotion language', () => {
    const issues = runPromptQualityChecks(
      'She feels overwhelmed by a profound sadness that seems to linger.',
    );
    assert.ok(issues.some((i) => i.code === 'prompt-quality-literary-emotion'));
    const emotion = issues.find((i) => i.code === 'prompt-quality-literary-emotion');
    assert.equal(emotion?.severity, 'warn');
  });

  it('visible behavior passes literary-emotion check', () => {
    const issues = runPromptQualityChecks(
      'She wipes tears, puts the photo down, walks away.',
    );
    assert.ok(!issues.some((i) => i.code === 'prompt-quality-literary-emotion'));
  });

  it('promotes literary emotion to error under strict mode', () => {
    const previous = process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY = '1';
    try {
      const issues = runPromptQualityChecks(
        'She feels overwhelmed by a profound sadness that seems to linger.',
      );
      const emotion = issues.find((i) => i.code === 'prompt-quality-literary-emotion');
      assert.equal(emotion?.severity, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
      } else {
        process.env.DIRECTOR_STRICT_PROMPT_QUALITY = previous;
      }
    }
  });

  it('flags style-word overload', () => {
    const issues = runPromptQualityChecks(
      'An epic atmospheric ethereal moody scene at dusk.',
    );
    assert.ok(issues.some((i) => i.code === 'prompt-quality-style-word-overload'));
    const style = issues.find((i) => i.code === 'prompt-quality-style-word-overload');
    assert.equal(style?.severity, 'warn');
  });

  it('promotes style-word overload to error under strict mode', () => {
    const previous = process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY = '1';
    try {
      const issues = runPromptQualityChecks(
        'An epic atmospheric ethereal moody scene at dusk.',
      );
      const style = issues.find((i) => i.code === 'prompt-quality-style-word-overload');
      assert.equal(style?.severity, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
      } else {
        process.env.DIRECTOR_STRICT_PROMPT_QUALITY = previous;
      }
    }
  });

  it('flags multiple camera moves in one prompt', () => {
    const issues = runPromptQualityChecks(
      'The camera pans left then dollies in while tilting down.',
    );
    assert.ok(issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
    const move = issues.find((i) => i.code === 'prompt-quality-multiple-camera-moves');
    assert.equal(move?.severity, 'warn');
  });

  it('single camera move passes', () => {
    const issues = runPromptQualityChecks('Handheld camera follows the subject.');
    assert.ok(!issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
  });

  it('allows one shot type plus one camera move', () => {
    const issues = runPromptQualityChecks(
      'Wide shot, slow push-in as the chef lifts the plate.',
    );
    assert.ok(!issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
  });

  it('allows shot-size language without counting it as camera movement', () => {
    const issues = runPromptQualityChecks(
      'Wide shot to close-up framing as the chef holds the pan steady.',
    );
    assert.ok(!issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
  });

  it('treats locked-off and static as one camera move family', () => {
    const issues = runPromptQualityChecks(
      'Close-up, locked-off static camera as a hand turns the dial.',
    );
    assert.ok(!issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
  });

  it('flags multiple Seedance camera moves', () => {
    const issues = runPromptQualityChecks(
      'Slow push-in and orbit around the product on the counter.',
    );
    assert.ok(issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
  });

  it('promotes multiple-camera-moves to error under strict mode', () => {
    const previous = process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY = '1';
    try {
      const issues = runPromptQualityChecks(
        'The camera pans left then dollies in while tilting down.',
      );
      const move = issues.find((i) => i.code === 'prompt-quality-multiple-camera-moves');
      assert.equal(move?.severity, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
      } else {
        process.env.DIRECTOR_STRICT_PROMPT_QUALITY = previous;
      }
    }
  });

  it('flags multiple dominant actions in one clause', () => {
    const issues = runPromptQualityChecks(
      'A woman walks to the bar, orders a drink, sits down, and checks her phone.',
    );
    assert.ok(issues.some((i) => i.code === 'prompt-quality-multiple-actions'));
    const action = issues.find((i) => i.code === 'prompt-quality-multiple-actions');
    assert.equal(action?.severity, 'warn');
  });

  it('flags multiple actions as error under strict mode', () => {
    const previous = process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY = '1';
    try {
      const issues = runPromptQualityChecks(
        'A woman walks to the bar, orders a drink, sits down, and checks her phone.',
      );
      const action = issues.find((i) => i.code === 'prompt-quality-multiple-actions');
      assert.equal(action?.severity, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
      } else {
        process.env.DIRECTOR_STRICT_PROMPT_QUALITY = previous;
      }
    }
  });

  it('promotes adjective soup to error under DIRECTOR_STRICT_PROMPT_QUALITY=1', () => {
    const previous = process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY = '1';
    try {
      const issues = runPromptQualityChecks(
        'A tall, mysterious, charismatic, weathered, sun-kissed, stoic man walks.',
      );
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.severity, 'error');
    } finally {
      if (previous === undefined) {
        delete process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
      } else {
        process.env.DIRECTOR_STRICT_PROMPT_QUALITY = previous;
      }
    }
  });
});
