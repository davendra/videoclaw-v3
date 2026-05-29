import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCategory, CATEGORY_IDS, type CategoryDescriptor } from '../video/category-registry.js';

describe('category registry', () => {
  it('resolves the character default (cinematic) when id is omitted', () => {
    const d = resolveCategory(undefined);
    assert.equal(d.subjectType, 'character');
    assert.equal(d.beatTemplate, 'three-act');
    assert.equal(d.cameraVocab, 'cinematic');
    assert.equal(d.audioProfile, 'diegetic');
    assert.equal(d.hookSeconds, 0);
    assert.equal(d.genre, 'live-action');
  });
  it('resolves an explicit cinematic id to the same default', () => {
    assert.deepEqual(resolveCategory('cinematic'), resolveCategory(undefined));
  });
  it('exposes the registered ids and throws on an unknown id', () => {
    assert.ok(CATEGORY_IDS.includes('cinematic'));
    assert.throws(() => resolveCategory('ecommerce-ad'), /unknown category/i);
  });
});
