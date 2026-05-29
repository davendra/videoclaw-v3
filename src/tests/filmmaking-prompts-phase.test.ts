import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import type { FilmmakingPhase } from '../video/filmmaking-prompts.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

async function setupPhaseProject(slug: string, root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace(slug, root);
  await addCharacterProfile(workspace, {
    name: 'Meera',
    description: 'Indian woman operative, 30s, long braid, sharp jaw, dark eyes, long dark coat over tactical vest.',
    referenceAssets: ['characters/meera-sheet.jpg'],
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Phase Probe', intent: 'A scene.', productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: slug, productionMode: 'director',
    scenes: [{ sceneIndex: 0, description: 'Meera advances through smoke', characters: ['Meera'], durationSeconds: 15,
      scenePrompt: { animationPrompt: 'Meera steps through smoke.' } }],
  }));
}

describe('filmmaking prompts two-phase gate', () => {
  // The FilmmakingPhase type is exported and assignable from the two literals.
  it('exports a FilmmakingPhase type accepting storyboard|video', () => {
    const storyboard: FilmmakingPhase = 'storyboard';
    const video: FilmmakingPhase = 'video';
    assert.equal(storyboard, 'storyboard');
    assert.equal(video, 'video');
  });

  it('default (phase omitted) keeps full video packets present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-phase-default-'));
    await setupPhaseProject('phase-default', root);
    const dflt = await generateFilmmakingPrompts({ root, projectSlug: 'phase-default' });
    // Video packets present by default — this is the existing behavior.
    assert.ok(dflt.artifact.seedancePackets.length > 0);
    assert.ok(dflt.artifact.storyboardGridPrompt);
    assert.ok(dflt.artifact.characterSheetPrompts.length > 0);
  });

  it('phase:video equals the default output (no behavior change)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-phase-video-'));
    await setupPhaseProject('phase-video', root);
    const dflt = await generateFilmmakingPrompts({ root, projectSlug: 'phase-video' });
    const video = await generateFilmmakingPrompts({ root, projectSlug: 'phase-video', phase: 'video' });
    assert.deepEqual(video.artifact.seedancePackets, dflt.artifact.seedancePackets);
    assert.equal(
      video.artifact.storyboardGridPrompt?.promptText,
      dflt.artifact.storyboardGridPrompt?.promptText,
    );
    assert.deepEqual(video.artifact.characterSheetPrompts, dflt.artifact.characterSheetPrompts);
  });

  it('phase:storyboard omits the video packets but keeps the storyboard/camera-language portion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-phase-storyboard-'));
    await setupPhaseProject('phase-storyboard', root);
    const result = await generateFilmmakingPrompts({ root, projectSlug: 'phase-storyboard', phase: 'storyboard' });
    // Video-generation packets are gated to empty.
    assert.deepEqual(result.artifact.seedancePackets, []);
    // Storyboard / panel-layout / camera-language portion is present.
    assert.ok(result.artifact.storyboardGridPrompt);
    assert.equal(result.artifact.storyboardGridPrompt?.panels.length, 15);
    assert.ok(result.artifact.characterSheetPrompts.length > 0);
    assert.ok(result.artifact.referenceMap.length > 0);
    // The Seedance-only issues (no-packets means no music/grid-pending packet noise)
    // are not emitted when the packet builder is skipped.
    assert.equal(result.artifact.issues.some((i) => i.code === 'seedance-music-default'), false);
  });

  it('phase:storyboard is strictly smaller than phase:video on the packet axis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-phase-cmp-'));
    await setupPhaseProject('phase-cmp', root);
    const storyboard = await generateFilmmakingPrompts({ root, projectSlug: 'phase-cmp', phase: 'storyboard' });
    const video = await generateFilmmakingPrompts({ root, projectSlug: 'phase-cmp', phase: 'video' });
    assert.ok(storyboard.artifact.seedancePackets.length < video.artifact.seedancePackets.length);
    // The shared storyboard portion is identical across phases.
    assert.equal(
      storyboard.artifact.storyboardGridPrompt?.promptText,
      video.artifact.storyboardGridPrompt?.promptText,
    );
  });

  it('is deterministic: two identical storyboard-phase calls match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fp-phase-det-'));
    await setupPhaseProject('phase-det', root);
    const a = await generateFilmmakingPrompts({ root, projectSlug: 'phase-det', phase: 'storyboard' });
    const b = await generateFilmmakingPrompts({ root, projectSlug: 'phase-det', phase: 'storyboard' });
    assert.equal(
      a.artifact.storyboardGridPrompt?.promptText,
      b.artifact.storyboardGridPrompt?.promptText,
    );
    assert.deepEqual(a.artifact.characterSheetPrompts, b.artifact.characterSheetPrompts);
    assert.deepEqual(a.artifact.seedancePackets, b.artifact.seedancePackets);
  });
});
