import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { generateFilmmakingPrompts, resolveGenreStyle } from '../video/filmmaking-prompts.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

async function setupGenreProject(slug: string, root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace(slug, root);
  await addCharacterProfile(workspace, {
    name: 'Meera',
    description: 'Indian woman operative, 30s, long braid, sharp jaw, dark eyes, long dark coat over tactical vest.',
    referenceAssets: ['characters/meera-sheet.jpg'],
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Genre Probe', intent: 'A scene.', productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: slug, productionMode: 'director',
    scenes: [{ sceneIndex: 0, description: 'Meera advances through smoke', characters: ['Meera'], durationSeconds: 15,
      scenePrompt: { animationPrompt: 'Meera steps through smoke.' } }],
  }));
}

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
    assert.equal(result.artifact.storyboardGridPrompt?.panelCount, 15);
    assert.equal(result.artifact.storyboardGridPrompt?.panels.length, 15);
    assert.equal(result.artifact.storyboardGridPrompt?.rows, 3);
    assert.equal(result.artifact.storyboardGridPrompt?.cols, 5);
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

  it('threads genre style + aspect ratio through every template (anime, 9:16)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-genre-anime-'));
    await setupGenreProject('anime-p', root);
    const result = await generateFilmmakingPrompts({ root, projectSlug: 'anime-p', genre: 'anime', aspectRatio: '9:16' });
    // Char sheet picks the anime style block + 9:16
    assert.match(result.artifact.characterSheetPrompts[0]?.promptText ?? '', /2D anime cel-shading/);
    assert.match(result.artifact.characterSheetPrompts[0]?.promptText ?? '', /Aspect ratio = 9:16/);
    // Storyboard grid carries the anime descriptors + 9:16 page layout
    assert.match(result.artifact.storyboardGridPrompt?.promptText ?? '', /2D anime cel-shading/);
    assert.match(result.artifact.storyboardGridPrompt?.promptText ?? '', /9:16 page layout/);
    // Seedance packet states the aspect ratio
    assert.match(result.artifact.seedancePackets[0]?.promptText ?? '', /9:16/);
  });

  it('substitutes the annotation third line by genre (influencer→VOICE, action→STYLE), MOOD by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-thirdline-'));
    await setupGenreProject('thirdline-p', root);

    const dflt = await generateFilmmakingPrompts({ root, projectSlug: 'thirdline-p' });
    assert.match(dflt.artifact.storyboardGridPrompt?.promptText ?? '', /CAM, MOVE, and MOOD/);
    assert.match(dflt.artifact.storyboardGridPrompt?.promptText ?? '', /\bMOOD: /);

    const vlog = await generateFilmmakingPrompts({ root, projectSlug: 'thirdline-p', genre: 'influencer' });
    assert.match(vlog.artifact.storyboardGridPrompt?.promptText ?? '', /CAM, MOVE, and VOICE/);
    assert.match(vlog.artifact.storyboardGridPrompt?.promptText ?? '', /\bVOICE: /);
    assert.match(vlog.artifact.characterSheetPrompts[0]?.promptText ?? '', /iPhone selfie-camera aesthetic/);

    const action = await generateFilmmakingPrompts({ root, projectSlug: 'thirdline-p', genre: 'martial-arts' });
    assert.match(action.artifact.storyboardGridPrompt?.promptText ?? '', /CAM, MOVE, and STYLE/);
    assert.match(action.artifact.storyboardGridPrompt?.promptText ?? '', /\bSTYLE: /);
  });

  it('flags a >100-word character description as an error (skill failure threshold)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-bloat-'));
    const workspace = await ensureProjectWorkspace('bloat-p', root);
    const bloated = Array.from({ length: 110 }, (_, i) => `trait${i}`).join(' ');
    await addCharacterProfile(workspace, { name: 'Bloaty', description: bloated, referenceAssets: [] });
    await writeArtifact(workspace, 'brief', createBriefArtifact({ title: 'B', intent: 'x', productionMode: 'director' }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: 'bloat-p', productionMode: 'director',
      scenes: [{ sceneIndex: 0, description: 'beat', characters: ['Bloaty'] }],
    }));
    const result = await generateFilmmakingPrompts({ root, projectSlug: 'bloat-p' });
    const issue = result.artifact.issues.find((i) => i.code === 'character-description-long');
    assert.equal(issue?.severity, 'error');
  });

  it('supports variable panel counts with adaptive grid + per-panel timecodes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-panels-'));
    await setupGenreProject('panels-p', root);

    // 20 panels horizontal -> 4x5
    const wide = await generateFilmmakingPrompts({ root, projectSlug: 'panels-p', panelCount: 20 });
    assert.equal(wide.artifact.storyboardGridPrompt?.panelCount, 20);
    assert.equal(wide.artifact.storyboardGridPrompt?.rows, 4);
    assert.equal(wide.artifact.storyboardGridPrompt?.cols, 5);
    assert.equal(wide.artifact.storyboardGridPrompt?.panels.length, 20);
    // Per-panel timecodes present
    assert.match(wide.artifact.storyboardGridPrompt?.panels[0]?.timecode ?? '', /^\[\d{2}:\d{2} - \d{2}:\d{2}\]$/);
    assert.match(wide.artifact.storyboardGridPrompt?.promptText ?? '', /4×5 grid/);

    // 15 panels vertical -> transposed to 5x3
    const tall = await generateFilmmakingPrompts({ root, projectSlug: 'panels-p', panelCount: 15, aspectRatio: '9:16' });
    assert.equal(tall.artifact.storyboardGridPrompt?.rows, 5);
    assert.equal(tall.artifact.storyboardGridPrompt?.cols, 3);

    // Invalid panel count rejected
    await assert.rejects(
      generateFilmmakingPrompts({ root, projectSlug: 'panels-p', panelCount: 7 }),
      /--panels must be one of/,
    );
  });

  it('resolveGenreStyle maps aliases and passes unknown genres through', () => {
    assert.equal(resolveGenreStyle('photoreal').genre, 'live-action');
    assert.equal(resolveGenreStyle('3d').genre, 'pixar');
    assert.equal(resolveGenreStyle('vlog').annotationThirdLine, 'VOICE');
    assert.equal(resolveGenreStyle('fight').annotationThirdLine, 'STYLE');
    assert.equal(resolveGenreStyle(undefined).genre, 'live-action');
    const unknown = resolveGenreStyle('claymation');
    assert.equal(unknown.genre, 'claymation');
    assert.equal(unknown.annotationThirdLine, 'MOOD');
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
