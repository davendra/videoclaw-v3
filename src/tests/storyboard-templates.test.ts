import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryboardScenesFromTemplate, listStoryboardTemplates, readStoryboardTemplate } from '../video/storyboard-templates.js';

describe('storyboard templates', () => {
  it('lists the built-in storyboard templates', () => {
    const templates = listStoryboardTemplates();
    assert.ok(templates.length >= 11);
    assert.ok(templates.some((template) => template.id === 'product-story'));
    assert.ok(templates.some((template) => template.id === 'beat-structure-3'));
    assert.ok(templates.some((template) => template.id === 'beat-structure-6'));
    assert.ok(templates.some((template) => template.id === 'product-commercial-4'));
    assert.ok(templates.some((template) => template.id === 'food-tutorial-6'));
    assert.ok(templates.some((template) => template.id === 'dance-social-6'));
    assert.ok(templates.some((template) => template.id === 'dramatic-short-6'));
    assert.ok(templates.some((template) => template.id === 'action-short-6'));
  });

  it('materializes the minimal 3-scene beat structure', () => {
    const scenes = buildStoryboardScenesFromTemplate({
      templateId: 'beat-structure-3',
      environment: 'neon-lit alley',
      characterA: 'Jun',
    });
    assert.equal(scenes.length, 3);
    assert.match(scenes[0].description, /Establish/);
    assert.match(scenes[0].description, /Jun/);
    assert.match(scenes[0].description, /alley/);
    assert.match(scenes[1].description, /Develop/);
    assert.match(scenes[2].description, /Payoff/);
  });

  it('materializes the 6-scene beat structure with two shots per beat', () => {
    const scenes = buildStoryboardScenesFromTemplate({
      templateId: 'beat-structure-6',
      environment: 'quiet kitchen',
      characterA: 'Mira',
    });
    assert.equal(scenes.length, 6);
    assert.match(scenes[0].description, /Establish wide/);
    assert.match(scenes[1].description, /Establish detail/);
    assert.match(scenes[2].description, /Develop action/);
    assert.match(scenes[3].description, /Develop consequence/);
    assert.match(scenes[4].description, /Payoff reveal/);
    assert.match(scenes[5].description, /Payoff resolve/);
  });

  it('materializes the compact product commercial template', () => {
    const template = readStoryboardTemplate('product-commercial-4');
    assert.equal(template?.panels.length, 4);

    const scenes = buildStoryboardScenesFromTemplate({
      templateId: 'product-commercial-4',
      environment: 'sunny apartment counter',
      characterA: 'Ari',
    });
    assert.equal(scenes.length, 4);
    assert.match(scenes[0].description, /Problem hook/);
    assert.match(scenes[0].description, /Ari/);
    assert.match(scenes[0].description, /apartment counter/);
    assert.match(scenes[1].description, /Product reveal/);
    assert.match(scenes[2].description, /Usage proof/);
    assert.match(scenes[3].description, /Payoff hero/);
  });

  it('keeps guide-inspired templates at their intended scene counts', () => {
    assert.equal(readStoryboardTemplate('food-tutorial-6')?.panels.length, 6);
    assert.equal(readStoryboardTemplate('dance-social-6')?.panels.length, 6);
    assert.equal(readStoryboardTemplate('dramatic-short-6')?.panels.length, 6);
    assert.equal(readStoryboardTemplate('action-short-6')?.panels.length, 6);
  });

  it('reads a template and materializes ordered scenes', () => {
    const template = readStoryboardTemplate('dialogue-confrontation');
    assert.equal(template?.id, 'dialogue-confrontation');
    const scenes = buildStoryboardScenesFromTemplate({
      templateId: 'dialogue-confrontation',
      environment: 'storm-battered bridge',
      characterA: 'Kai',
      characterB: 'Lena',
    });
    assert.equal(scenes.length, 9);
    assert.equal(scenes[0].sceneIndex, 0);
    assert.match(scenes[0].description, /Kai/);
    assert.match(scenes[0].description, /Lena/);
    assert.match(scenes[0].description, /bridge/);
  });
});
