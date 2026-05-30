import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterSheetSixPanelPrompt } from '../video/filmmaking-prompts.js';
test('6-panel sheet is a single 3x2 mid-gray frame, identity locked', () => {
  const s = characterSheetSixPanelPrompt('a weathered fisherman in oilskins', 'live-action photoreal', '16:9');
  assert.ok(/3-column.*2-row|3x2|six-panel|6-panel/i.test(s));
  assert.ok(/mid-gray/i.test(s));
  assert.ok(/identical|locked/i.test(s));
});
