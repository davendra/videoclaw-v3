import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeBilingual } from '../video/multi-shot-prompt.js';

// Fixture carries technical spec tokens (ft/s, Kelvin) so we can assert that the
// ZH block preserves the numeric/unit specs verbatim through the translator.
const TEXT =
  'Slow push-in at 4.2 ft/s, key light 5600K, 35mm lens, 24fps, exposure -0.5 stop.';

function countFences(text: string): number {
  return text.split('```').length - 1;
}

test('composeBilingual: en renders exactly one fenced code block', () => {
  const out = composeBilingual(TEXT, 'en');
  assert.equal(countFences(out), 2, 'one fenced block === two ``` fences');
  assert.ok(out.includes(TEXT), 'English text preserved');
});

test('composeBilingual: en+zh renders exactly two fenced code blocks, both preserving spec tokens', () => {
  const out = composeBilingual(TEXT, 'en+zh');
  assert.equal(countFences(out), 4, 'two fenced blocks === four ``` fences');
  // Default translator is identity, so both blocks must carry the same spec tokens.
  const ftMatches = out.split('4.2 ft/s').length - 1;
  const kelvinMatches = out.split('5600K').length - 1;
  assert.equal(ftMatches, 2, '4.2 ft/s appears in both EN and ZH blocks');
  assert.equal(kelvinMatches, 2, '5600K appears in both EN and ZH blocks');
});

test('composeBilingual: zh uses the injected translator', () => {
  const out = composeBilingual(TEXT, 'zh', { translate: (t) => 'ZH:' + t });
  assert.equal(countFences(out), 2, 'single fenced block for zh');
  assert.ok(out.includes('ZH:' + TEXT), 'translated content present');
});

test('composeBilingual: deterministic — identical calls produce identical output', () => {
  assert.equal(composeBilingual(TEXT, 'en+zh'), composeBilingual(TEXT, 'en+zh'));
  assert.equal(composeBilingual(TEXT, 'en'), composeBilingual(TEXT, 'en'));
});
