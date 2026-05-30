import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

// WS7 / Task 7.2: buildReferenceMap consults referenceBuildOrder so the emitted
// referenceMap is grouped base-ref -> sheet -> scene-plate (the previously
// orphaned banana-pro-director discipline). The canonical character sheet must
// never be replaced by a scene plate; every reference survives, in build order,
// and @imageN == array order.

describe('WS7 referenceBuildOrder discipline in buildReferenceMap', () => {
  it('orders base-ref -> sheet -> scene-plate when all three exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-buildorder-'));
    const workspace = await ensureProjectWorkspace('beta', root);
    await addCharacterProfile(workspace, {
      name: 'Meera',
      description: 'late twenties Indian woman, athletic build, sharp brown eyes, shoulder-length black hair, charcoal tactical jacket',
      referenceAssets: ['characters/meera-sheet.jpg'],
    });
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Build Order Probe',
      intent: 'A scene that needs a base plate, a character sheet, and a scene plate.',
      productionMode: 'director',
    }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: 'beta',
      productionMode: 'director',
      scenes: [{
        sceneIndex: 0,
        description: 'Meera enters through smoke',
        characters: ['Meera'],
        durationSeconds: 15,
        scenePrompt: { animationPrompt: 'Meera steps through smoke.' },
      }],
    }));
    // Two image assets in the manifest:
    //  - a project-wide, scene-context-free BACKGROUND PLATE (base-ref step).
    //    It is declared AFTER the scene start frame in the manifest so that any
    //    order-preserving emission would (wrongly) place it last; the build-order
    //    discipline must lift it to the front.
    //  - an in-context scene start frame (scene-plate step).
    await writeArtifact(workspace, 'asset-manifest', {
      projectSlug: 'beta',
      assets: [
        {
          id: 'scene-0-start',
          kind: 'image',
          path: 'assets/upscaled/scene-0.jpg',
          sceneIndex: 0,
          backend: 'seedance-direct',
        },
        {
          id: 'warehouse-plate',
          kind: 'image',
          role: 'background-plate',
          path: 'assets/plates/warehouse.jpg',
          backend: 'openai-gpt-image-2',
        },
      ],
    });

    const result = await generateFilmmakingPrompts({ root, projectSlug: 'beta' });
    const map = result.artifact.referenceMap;

    const baseRefIndex = map.findIndex((slot) => slot.role === 'background-plate');
    const sheetIndex = map.findIndex((slot) => slot.role === 'character-sheet');
    const plateIndex = map.findIndex((slot) => slot.role === 'start-frame');

    assert.ok(baseRefIndex >= 0, 'background plate (base-ref) must be present');
    assert.ok(sheetIndex >= 0, 'canonical character sheet must be present');
    assert.ok(plateIndex >= 0, 'scene plate (start-frame) must be present');

    // base-ref -> sheet -> scene-plate, regardless of manifest declaration order.
    assert.ok(baseRefIndex < sheetIndex, `base-ref (idx ${baseRefIndex}) must precede sheet (idx ${sheetIndex})`);
    assert.ok(sheetIndex < plateIndex, `sheet (idx ${sheetIndex}) must precede scene plate (idx ${plateIndex})`);

    // The canonical sheet is never replaced by the scene plate — it survives with
    // its identity fields intact.
    const sheetSlot = map[sheetIndex]!;
    assert.equal(sheetSlot.characterName, 'Meera');
    assert.equal(sheetSlot.role, 'character-sheet');
    assert.equal(map[plateIndex]?.path, 'assets/upscaled/scene-0.jpg');
    assert.equal(map[baseRefIndex]?.path, 'assets/plates/warehouse.jpg');

    // @imageN == array order: the slot field tracks the final emitted position.
    assert.equal(map[baseRefIndex]?.slot, '@image1');
    assert.equal(map[sheetIndex]?.slot, '@image2');
    assert.equal(map[plateIndex]?.slot, '@image3');
  });

  it('leaves a default single-character project (sheet only) ordering unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-buildorder-default-'));
    const workspace = await ensureProjectWorkspace('gamma', root);
    await addCharacterProfile(workspace, {
      name: 'Meera',
      description: 'late twenties Indian woman, athletic build, sharp brown eyes',
      referenceAssets: ['characters/meera-sheet.jpg'],
    });
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Default Probe', intent: 'A scene.', productionMode: 'director',
    }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: 'gamma',
      productionMode: 'director',
      scenes: [{
        sceneIndex: 0, description: 'Meera enters', characters: ['Meera'], durationSeconds: 15,
        scenePrompt: { animationPrompt: 'Meera steps in.' },
      }],
    }));

    const result = await generateFilmmakingPrompts({ root, projectSlug: 'gamma' });
    const map = result.artifact.referenceMap;

    // No base-ref / scene-plate: the canonical sheet still leads the map at @image1.
    const sheet = map.find((slot) => slot.role === 'character-sheet');
    assert.ok(sheet, 'character sheet must be present');
    assert.equal(sheet?.slot, '@image1');
    assert.equal(map[0]?.role, 'character-sheet');
  });
});
