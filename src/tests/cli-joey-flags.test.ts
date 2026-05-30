import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
}

// Joey cinematic-adaptation opt-in flags (Phase 12). These route through the
// EXISTING filmmaking-prompts and multi-shot commands; absent flags keep output
// byte-identical to today.

describe('vclaw video filmmaking-prompts Joey flags', () => {
  async function seedProject(root: string, slug: string) {
    const workspace = await ensureProjectWorkspace(slug, root);
    await addCharacterProfile(workspace, {
      name: 'Rani',
      description: 'early thirties Indian woman, compact muscular build, cropped black hair, navy tactical vest',
      referenceAssets: ['characters/rani-sheet.jpg'],
    });
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Rani Rooftop',
      intent: 'A cinematic rooftop action beat.',
      productionMode: 'director',
    }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: slug,
      productionMode: 'director',
      scenes: [{
        sceneIndex: 0,
        description: 'Rani pivots under rain as city lights flare behind her',
        characters: ['Rani'],
        scenePrompt: { animationPrompt: 'Rani pivots, draws the blade, holds a stance' },
      }],
    }));
    return workspace;
  }

  it('--sheet 6-panel yields the 6-panel character sheet prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-joey-sheet-'));
    try {
      await seedProject(root, 'sheet6');
      const res = run(['video', 'filmmaking-prompts', '--project', 'sheet6', '--root', root, '--sheet', '6-panel']);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      const sheet = payload.artifact.characterSheetPrompts.find((p: any) => p.characterName === 'Rani');
      assert.match(sheet.promptText, /6-panel character reference sheet/);
      assert.match(sheet.promptText, /3-column by 2-row grid/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--sheet defaults to the 8-shot sheet (unchanged) when omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-joey-sheet8-'));
    try {
      await seedProject(root, 'sheet8');
      const res = run(['video', 'filmmaking-prompts', '--project', 'sheet8', '--root', root]);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      const sheet = payload.artifact.characterSheetPrompts.find((p: any) => p.characterName === 'Rani');
      assert.match(sheet.promptText, /total of eight shots/);
      assert.doesNotMatch(sheet.promptText, /6-panel character reference sheet/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--sheet rejects an unknown layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-joey-sheetx-'));
    try {
      await seedProject(root, 'sheetx');
      const res = run(['video', 'filmmaking-prompts', '--project', 'sheetx', '--root', root, '--sheet', 'bogus']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr + res.stdout, /--sheet must be one of 8-shot, 6-panel/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--realism + --wet + --haze + --lighting + --grade enrich the rich-detail Style line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-joey-realism-'));
    try {
      await seedProject(root, 'realism');
      const res = run([
        'video', 'filmmaking-prompts', '--project', 'realism', '--root', root,
        '--detail', 'rich', '--realism', '--wet', '--haze', 'heavy',
        '--lighting', 'night-fire', '--grade', 'bleach-bypass',
      ]);
      assert.equal(res.status, 0, res.stderr);
      const grid = JSON.parse(res.stdout).artifact.storyboardGridPrompt;
      assert.match(grid.promptText, /Capture realism:/);
      assert.match(grid.promptText, /heavy volumetric haze/);
      assert.match(grid.promptText, /moisture mutes/);
      assert.match(grid.promptText, /2000K/); // night-fire lighting
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('without realism/lighting/grade flags the rich Style line stays the legacy default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-joey-rich-default-'));
    try {
      await seedProject(root, 'richdef');
      const res = run(['video', 'filmmaking-prompts', '--project', 'richdef', '--root', root, '--detail', 'rich']);
      assert.equal(res.status, 0, res.stderr);
      const grid = JSON.parse(res.stdout).artifact.storyboardGridPrompt;
      assert.doesNotMatch(grid.promptText, /Capture realism:/);
      assert.match(grid.promptText, /teal-and-orange/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--background rejects an unknown plate kind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-joey-bg-'));
    try {
      await seedProject(root, 'bgx');
      const res = run(['video', 'filmmaking-prompts', '--project', 'bgx', '--root', root, '--background', 'rainbow']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr + res.stdout, /--background must be one of mid-gray, white, black/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--haze rejects an unknown density', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-joey-haze-'));
    try {
      await seedProject(root, 'hazex');
      const res = run(['video', 'filmmaking-prompts', '--project', 'hazex', '--root', root, '--haze', 'medium']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr + res.stdout, /--haze must be one of thin, light, heavy/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('vclaw video multi-shot --genre', () => {
  function plan(args: string[]) {
    return run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7', ...args]);
  }

  it('--genre music-video resolves a non-Nolan style line into the plan', () => {
    const res = plan(['--genre', 'music-video']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.styleLine, 'Saturated stage color, rhythmic lighting, performance energy. Bold contrast, expressive grade, beat-driven cutting.');
    assert.doesNotMatch(parsed.preset.styleLine, /Christopher Nolan/);
  });

  it('omitting --genre keeps the cinematic Nolan style line (unchanged)', () => {
    const res = plan([]);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.match(parsed.preset.styleLine, /Christopher Nolan/);
  });

  it('--genre threads through the seedance-paragraph rendered format', () => {
    const res = plan(['--genre', 'noir', '--format', 'seedance-paragraph']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /chiaroscuro/);
  });
});
