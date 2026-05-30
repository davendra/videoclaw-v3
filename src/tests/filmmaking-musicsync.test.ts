import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import {
  generateFilmmakingPrompts,
  resolveGenreStyle,
  seedancePromptText,
} from '../video/filmmaking-prompts.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

// Helper: build a minimal scene for use in seedancePromptText calls.
function minimalScene(): Parameters<typeof seedancePromptText>[0]['scene'] {
  return {
    sceneIndex: 0,
    description: 'Performer moves with the beat',
    durationSeconds: 10,
    scenePrompt: { animationPrompt: 'Performer moves with the beat, lights flash.' },
  };
}

test('text-driven music-video packet contains music-sync phrase and omits "No music. Natural ambience"', () => {
  const text = seedancePromptText({
    scene: minimalScene(),
    brief: undefined,
    references: [],
    variant: 'text-driven',
    durationSeconds: 10,
    genreStyle: resolveGenreStyle('music-video'),
  });

  // Music-sync phrase must be present
  assert.match(
    text,
    /downbeat|on the beat|beat-driven|music's rhythm/i,
    'expected music-sync phrase in text-driven music-video packet',
  );

  // "No music. Natural ambience" must NOT appear
  assert.doesNotMatch(
    text,
    /No music\. Natural ambience/,
    'music-video text-driven packet must not contain the default "No music. Natural ambience" line',
  );
});

test('text-driven non-music-video packet retains "No music. Natural ambience" line', () => {
  const text = seedancePromptText({
    scene: minimalScene(),
    brief: undefined,
    references: [],
    variant: 'text-driven',
    durationSeconds: 10,
    genreStyle: resolveGenreStyle('live-action'),
  });

  assert.match(
    text,
    /No music\. Natural ambience/,
    'non-music-video text-driven packet must contain the default "No music. Natural ambience" line',
  );
});

test('generateFilmmakingPrompts: music-video genre omits seedance-music-default warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-musicsync-'));
  const workspace = await ensureProjectWorkspace('mv-test', root);

  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Rhythm Run',
    intent: 'A music video scene.',
    productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'mv-test',
    productionMode: 'director',
    scenes: [
      {
        sceneIndex: 0,
        description: 'Performer centre stage, lights pulse with the beat',
        durationSeconds: 10,
        scenePrompt: {
          animationPrompt: 'Performer moves with the beat, lights flash.',
        },
      },
    ],
  }));

  const result = await generateFilmmakingPrompts({
    root,
    projectSlug: 'mv-test',
    genre: 'music-video',
    write: false,
  });

  const warningCodes = result.artifact.issues.map((i) => i.code);
  assert.ok(
    !warningCodes.includes('seedance-music-default'),
    `music-video genre should not emit seedance-music-default warning; got: ${warningCodes.join(', ')}`,
  );
});

test('generateFilmmakingPrompts: non-music-video genre emits seedance-music-default warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-musicsync-live-'));
  const workspace = await ensureProjectWorkspace('liveaction-test', root);

  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Cinematic Scene',
    intent: 'A live-action scene.',
    productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'liveaction-test',
    productionMode: 'director',
    scenes: [
      {
        sceneIndex: 0,
        description: 'Character walks through a corridor',
        durationSeconds: 10,
        scenePrompt: { animationPrompt: 'Character strides forward.' },
      },
    ],
  }));

  const result = await generateFilmmakingPrompts({
    root,
    projectSlug: 'liveaction-test',
    write: false,
  });

  const warningCodes = result.artifact.issues.map((i) => i.code);
  assert.ok(
    warningCodes.includes('seedance-music-default'),
    `non-music-video genre should emit seedance-music-default warning; got: ${warningCodes.join(', ')}`,
  );
});
