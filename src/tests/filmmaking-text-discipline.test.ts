import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import {
  buildPositionalDescriptorLine,
  buildIdentityLockLine,
  SINGLE_FULL_FRAME_GUARD,
} from '../video/seedance-blocks.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

// A three-character scene so the positional descriptor line exercises
// Center / Left / Right placement, each carrying a stored visual descriptor.
async function setupTrioProject(slug: string, root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace(slug, root);
  await addCharacterProfile(workspace, {
    name: 'Meera',
    description: 'late twenties Indian woman, long braid, charcoal tactical jacket',
    referenceAssets: ['characters/meera-sheet.jpg'],
  });
  await addCharacterProfile(workspace, {
    name: 'Arjun',
    description: 'broad-shouldered man, shaved head, olive field coat',
    referenceAssets: ['characters/arjun-sheet.jpg'],
  });
  await addCharacterProfile(workspace, {
    name: 'Lila',
    description: 'slim woman, silver-streaked bob, crimson scarf',
    referenceAssets: ['characters/lila-sheet.jpg'],
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Trio Probe', intent: 'Three operatives regroup.', productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: slug,
    productionMode: 'director',
    scenes: [{
      sceneIndex: 0,
      description: 'Meera, Arjun, and Lila regroup in a smoky hall',
      characters: ['Meera', 'Arjun', 'Lila'],
      durationSeconds: 12,
      scenePrompt: { animationPrompt: 'They advance together through the smoke.' },
    }],
  }));
}

describe('seedance-blocks text-discipline helpers', () => {
  it('buildPositionalDescriptorLine places descriptors at Center/Left/Right, never names', () => {
    const line = buildPositionalDescriptorLine([
      { label: 'late twenties Indian woman, long braid', slot: '@image1' },
      { label: 'broad-shouldered man, shaved head', slot: '@image2' },
      { label: 'slim woman, silver-streaked bob', slot: '@image3' },
    ]);
    assert.match(line, /Center: late twenties Indian woman, long braid\./);
    assert.match(line, /Left: broad-shouldered man, shaved head\./);
    assert.match(line, /Right: slim woman, silver-streaked bob\./);
  });

  it('buildPositionalDescriptorLine falls back when a descriptor is missing', () => {
    const line = buildPositionalDescriptorLine([{ label: '', slot: '@image1' }]);
    assert.match(line, /Center: as established in the reference image\./);
  });

  it('buildIdentityLockLine emits the canonical no-face-morph discipline line', () => {
    const line = buildIdentityLockLine();
    assert.match(line, /Keep each character identical to her reference image, no face morphing\./);
  });

  it('SINGLE_FULL_FRAME_GUARD forbids the grid/split-screen collage', () => {
    assert.match(SINGLE_FULL_FRAME_GUARD, /single full-frame cinematic shot/);
    assert.match(SINGLE_FULL_FRAME_GUARD, /no split-screen/);
  });
});

describe('filmmaking text discipline (opt-in)', () => {
  it('default output is byte-identical with textDiscipline off vs omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-td-default-'));
    await setupTrioProject('td-default', root);
    const omitted = await generateFilmmakingPrompts({ root, projectSlug: 'td-default' });
    const explicitOff = await generateFilmmakingPrompts({ root, projectSlug: 'td-default', textDiscipline: false });
    assert.equal(
      explicitOff.artifact.seedancePackets[0]?.promptText,
      omitted.artifact.seedancePackets[0]?.promptText,
    );
    // And the off path must NOT contain any of the discipline-only lines.
    const off = omitted.artifact.seedancePackets[0]?.promptText ?? '';
    assert.doesNotMatch(off, /Center: /);
    assert.doesNotMatch(off, /Keep each character identical to her reference image/);
  });

  it('textDiscipline emits positional descriptors, identity lock, and single-frame guard with no proper names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-td-on-'));
    await setupTrioProject('td-on', root);
    const result = await generateFilmmakingPrompts({ root, projectSlug: 'td-on', textDiscipline: true });
    const text = result.artifact.seedancePackets[0]?.promptText ?? '';
    // (a) positional visual descriptors derived from stored descriptions
    assert.match(text, /Center: late twenties Indian woman, long braid/);
    assert.match(text, /Left: broad-shouldered man, shaved head/);
    assert.match(text, /Right: slim woman, silver-streaked bob/);
    // (a) never proper names
    assert.doesNotMatch(text, /\bMeera\b/);
    assert.doesNotMatch(text, /\bArjun\b/);
    assert.doesNotMatch(text, /\bLila\b/);
    // (b) explicit identity-lock / no-face-morph line
    assert.match(text, /Keep each character identical to her reference image, no face morphing\./);
    // (c) single-full-frame guard present even though this scene has no storyboard grid
    assert.match(text, /single full-frame cinematic shot/);
    assert.match(text, /no split-screen/);
  });

  it('textDiscipline emits a diegetic soundscape line when generateAudio is on, no-music line otherwise', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-td-audio-'));
    await setupTrioProject('td-audio', root);

    const silent = await generateFilmmakingPrompts({ root, projectSlug: 'td-audio', textDiscipline: true });
    const silentText = silent.artifact.seedancePackets[0]?.promptText ?? '';
    // Case-insensitive: grid variants emit "NO MUSIC", the text-driven SOUND BED emits "No music".
    assert.match(silentText, /no music/i);
    assert.doesNotMatch(silentText, /Diegetic soundscape/);

    const audible = await generateFilmmakingPrompts({
      root,
      projectSlug: 'td-audio',
      textDiscipline: true,
      generateAudio: true,
    });
    const audibleText = audible.artifact.seedancePackets[0]?.promptText ?? '';
    assert.match(audibleText, /Diegetic soundscape/);
    assert.doesNotMatch(audibleText, /no music/i);
  });

  it('textDiscipline applies the single-frame guard to grid-bearing packets too', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-td-grid-'));
    await setupTrioProject('td-grid', root);
    const result = await generateFilmmakingPrompts({
      root,
      projectSlug: 'td-grid',
      textDiscipline: true,
      storyboardGridPath: 'assets/storyboard-grid.png',
    });
    const text = result.artifact.seedancePackets[0]?.promptText ?? '';
    assert.match(text, /single full-frame cinematic shot/);
    assert.match(text, /Keep each character identical to her reference image, no face morphing\./);
    assert.match(text, /Center: /);
  });
});
