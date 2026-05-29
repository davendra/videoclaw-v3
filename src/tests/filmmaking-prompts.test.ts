import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('filmmaking prompt packets', () => {
  it('generates character sheets, storyboard grid prompt, reference map, and Seedance packets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-prompts-'));
    const workspace = await ensureProjectWorkspace('alpha', root);
    await addCharacterProfile(workspace, {
      name: 'Meera',
      description: 'late twenties Indian woman, athletic build, sharp brown eyes, shoulder-length black hair, charcoal tactical jacket, black cargo trousers, compact radio clipped to harness',
      referenceAssets: ['characters/meera-sheet.jpg'],
    });
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Dhuaan Warehouse',
      intent: 'A tactical music video scene in a smoky warehouse.',
      productionMode: 'director',
    }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: 'alpha',
      productionMode: 'director',
      scenes: [
        {
          sceneIndex: 0,
          description: 'Meera enters through smoke with squad lights behind her',
          characters: ['Meera'],
          durationSeconds: 15,
          scenePrompt: {
            animationPrompt: 'Meera steps through smoke, raises radio, and locks eyes with camera',
          },
        },
      ],
    }));
    await writeArtifact(workspace, 'asset-manifest', {
      projectSlug: 'alpha',
      assets: [{
        id: 'scene-0-start',
        kind: 'image',
        path: 'assets/upscaled/scene-0.jpg',
        sceneIndex: 0,
        backend: 'seedance-direct',
      }],
    });

    const result = await generateFilmmakingPrompts({
      root,
      projectSlug: 'alpha',
      write: true,
    });

    assert.equal(result.artifact.durationDefaultSeconds, 15);
    assert.equal(result.artifact.characterSheetPrompts.length, 1);
    assert.equal(result.artifact.characterSheetPrompts[0]?.mode, 'reference-image');
    assert.match(result.artifact.characterSheetPrompts[0]?.promptText ?? '', /neutral studio lighting/);
    assert.equal(result.artifact.storyboardGridPrompt?.panelCount, 9);
    assert.equal(result.artifact.storyboardGridPrompt?.panels.length, 9);
    assert.ok(result.artifact.referenceMap.some((slot) => slot.slot === '@image1' && slot.role === 'character-sheet'));
    assert.ok(result.artifact.referenceMap.some((slot) => slot.role === 'storyboard-grid' && slot.status === 'pending'));
    assert.ok(result.artifact.referenceMap.some((slot) => slot.role === 'start-frame' && slot.path === 'assets/upscaled/scene-0.jpg'));
    assert.equal(result.artifact.seedancePackets[0]?.variant, 'character-sheets-plus-storyboard-grid');
    assert.equal(result.artifact.seedancePackets[0]?.durationSeconds, 15);
    assert.match(result.artifact.seedancePackets[0]?.promptText ?? '', /NO TEXT ON SCREEN, NO MUSIC/);
    // Grid-leakage guard: the packet must force single-full-frame output so the
    // model performs the panels over time instead of animating the 3x3 collage.
    assert.match(result.artifact.seedancePackets[0]?.promptText ?? '', /single full-frame cinematic shot/);
    assert.match(result.artifact.seedancePackets[0]?.promptText ?? '', /no split-screen/);
    assert.ok(result.artifactPath?.endsWith('artifacts/filmmaking-prompts.json'));

    const saved = JSON.parse(await readFile(result.artifactPath!, 'utf-8')) as typeof result.artifact;
    assert.equal(saved.sourceSkill, 'ai-filmmaking');
  });

  it('marks an attached storyboard grid image as ready for Seedance packets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-prompts-grid-ready-'));
    const workspace = await ensureProjectWorkspace('grid-ready', root);
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Grid Ready',
      intent: 'A compact action scene.',
      productionMode: 'director',
    }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: 'grid-ready',
      productionMode: 'director',
      scenes: [{
        sceneIndex: 0,
        description: 'A courier runs through a neon tunnel',
        scenePrompt: {
          animationPrompt: 'Courier sprints forward as lights streak past.',
        },
      }],
    }));

    const result = await generateFilmmakingPrompts({
      root,
      projectSlug: 'grid-ready',
      storyboardGridPath: 'assets/storyboard-grid.png',
    });

    const gridSlot = result.artifact.referenceMap.find((slot) => slot.role === 'storyboard-grid');
    assert.equal(gridSlot?.status, 'ready');
    assert.equal(gridSlot?.path, 'assets/storyboard-grid.png');
    assert.equal(result.artifact.issues.some((issue) => issue.code === 'storyboard-grid-pending'), false);
    assert.equal(result.artifact.seedancePackets[0]?.references.some((reference) => (
      reference.role === 'storyboard-grid'
      && reference.status === 'ready'
      && reference.path === 'assets/storyboard-grid.png'
    )), true);
  });

  it('renders the storyboard grid prompt in a no-face register and tags packets for content-filter safety when --no-faces is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-prompts-nofaces-'));
    const workspace = await ensureProjectWorkspace('nofaces', root);
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Silhouette Run',
      intent: 'A gritty war-thriller scene.',
      productionMode: 'director',
    }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: 'nofaces',
      productionMode: 'director',
      scenes: [{
        sceneIndex: 0,
        description: 'Three operatives breach a ruined doorway in heavy backlight',
        scenePrompt: { animationPrompt: 'Operatives storm through the breach as dust swirls.' },
      }],
    }));

    const plain = await generateFilmmakingPrompts({ root, projectSlug: 'nofaces' });
    assert.doesNotMatch(plain.artifact.storyboardGridPrompt?.promptText ?? '', /backlit silhouettes/);

    const result = await generateFilmmakingPrompts({ root, projectSlug: 'nofaces', noFaces: true });
    assert.match(result.artifact.storyboardGridPrompt?.promptText ?? '', /backlit silhouettes/);
    assert.match(result.artifact.storyboardGridPrompt?.promptText ?? '', /NO clear frontal facial features/);
    assert.match(result.artifact.seedancePackets[0]?.promptText ?? '', /faces obscured \(content-filter safe\)/);
    // The single-frame guard is unconditional — present with or without --no-faces.
    assert.match(result.artifact.seedancePackets[0]?.promptText ?? '', /single full-frame cinematic shot/);
  });

  it('falls back to text-driven Seedance packets when storyboard grid context is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-prompts-fallback-'));
    const workspace = await ensureProjectWorkspace('beta', root);
    await writeFile(workspace.manifestPath, JSON.stringify({
      slug: 'beta',
      productionMode: 'storyboard',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pipeline: { name: 'storyboard', version: '1', productionMode: 'storyboard', stages: [] },
    }));

    const result = await generateFilmmakingPrompts({
      root,
      projectSlug: 'beta',
    });

    assert.equal(result.artifact.storyboardGridPrompt, null);
    assert.deepEqual(result.artifact.seedancePackets, []);
    assert.ok(result.artifact.issues.some((issue) => issue.code === 'storyboard-missing'));
  });
});
