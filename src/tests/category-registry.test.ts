import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCategory, CATEGORY_IDS, referenceBuildOrder, type CategoryDescriptor, type ReferenceBuildStep } from '../video/category-registry.js';

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
    assert.throws(() => resolveCategory('totally-bogus'), /unknown category/i);
  });
});

describe('commercial categories', () => {
  const ids = ['ecommerce-ad','brand-story','product-360','fashion-lookbook','food-beverage','real-estate','motion-design-ad','comic-to-video'];
  it('registers all eight commercial categories', () => {
    for (const id of ids) assert.ok(CATEGORY_IDS.includes(id), `${id} registered`);
  });
  it('product-360 is a turntable/orbit product category', () => {
    const d = resolveCategory('product-360');
    assert.equal(d.subjectType, 'product');
    assert.equal(d.beatTemplate, 'turntable');
    assert.equal(d.cameraVocab, 'orbit');
  });
  it('ecommerce-ad uses ad beats + a 2s hook + ad-mix audio', () => {
    const d = resolveCategory('ecommerce-ad');
    assert.equal(d.beatTemplate, 'ad-hook-feature-cta');
    assert.equal(d.audioProfile, 'ad-mix');
    assert.equal(d.hookSeconds, 2);
  });
  it('each commercial descriptor is fully populated', () => {
    for (const id of ids) {
      const d = resolveCategory(id);
      assert.ok(d.label && d.subjectType && d.beatTemplate && d.cameraVocab && d.genre && d.audioProfile);
      assert.equal(typeof d.hookSeconds, 'number');
    }
  });
});

describe('reference build order', () => {
  it('returns the canonical 3-step order for a character subject', () => {
    assert.deepEqual(referenceBuildOrder('character'), ['base-ref', 'sheet', 'scene-plate']);
  });
  it('returns the same disciplined order for a product subject', () => {
    assert.deepEqual(referenceBuildOrder('product'), ['base-ref', 'sheet', 'scene-plate']);
  });
});
