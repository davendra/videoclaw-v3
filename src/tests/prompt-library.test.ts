import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listPromptReferences, readPromptReference } from '../video/prompt-library.js';

describe('prompt library', () => {
  it('lists bundled prompt references and reads them by name', async () => {
    const references = listPromptReferences();
    assert.ok(references.some((reference) => reference.name === 'seedance-ugc-formulas'));
    assert.ok(references.some((reference) => reference.name === 'veo-prompting-guide'));
    assert.ok(references.some((reference) => reference.name === 'generation-telemetry'));
    assert.ok(references.some((reference) => reference.name === 'dialogue-duration-preflight'));
    assert.ok(references.some((reference) => reference.name === 'character-reference-sheet'));
    assert.ok(references.some((reference) => reference.name === 'clone-ad-template-workflow'));

    const seedance = await readPromptReference('seedance-ugc-formulas', process.cwd());
    assert.ok(seedance);
    assert.equal(seedance?.category, 'provider');
    assert.match(seedance?.content ?? '', /Seedance UGC Formulas/i);
  });
});
