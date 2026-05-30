import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { ensureProjectWorkspace, writeProjectManifest, resolveProjectWorkspace } from '../video/workspace.js';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: process.cwd(), encoding: 'utf-8' });
}

async function seedProject(root: string, slug: string, genre = 'live-action') {
  const workspace = await ensureProjectWorkspace(slug, root);
  // A minimal manifest so updateProjectManifestCinemaProfile has something to patch.
  await writeProjectManifest(workspace, {
    slug,
    productionMode: 'director',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pipeline: { name: 'director', version: '1', productionMode: 'director', stages: [] } as never,
  });
  await addCharacterProfile(workspace, {
    name: 'Rani',
    description: 'early thirties Indian woman, compact muscular build, cropped black hair, navy tactical vest',
    referenceAssets: ['characters/rani-sheet.jpg'],
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({ title: 'Rani', intent: 'a beat.', productionMode: 'director' }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: slug,
    productionMode: 'director',
    scenes: [{ sceneIndex: 0, description: `${genre} scene`, characters: ['Rani'], scenePrompt: { animationPrompt: 'Rani pivots' } }],
  }));
  return workspace;
}

describe('vclaw video cinema-profile', () => {
  it('writes the cinema-profile block to the project manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cinemaprof-'));
    try {
      await seedProject(root, 'cp1');
      const res = run(['video', 'cinema-profile', '--project', 'cp1', '--root', root, '--detail', 'standard', '--register', 'numeric', '--no-realism', '--capture', 'phone']);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.cinemaProfile.detail, 'standard');
      assert.equal(payload.cinemaProfile.register, 'numeric');
      assert.equal(payload.cinemaProfile.realism, false);
      assert.equal(payload.cinemaProfile.captureRegister, 'phone');
      // persisted on disk
      const ws = resolveProjectWorkspace('cp1', root);
      const manifest = JSON.parse(await readFile(ws.manifestPath, 'utf-8'));
      assert.equal(manifest.cinemaProfile.detail, 'standard');
      assert.equal(manifest.cinemaProfile.realism, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an unknown --register value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cinemaprof-bad-'));
    try {
      await seedProject(root, 'cp2');
      const res = run(['video', 'cinema-profile', '--project', 'cp2', '--root', root, '--register', 'bogus']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr + res.stdout, /--register must be one of prose, numeric/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires at least one field to set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cinemaprof-empty-'));
    try {
      await seedProject(root, 'cp3');
      const res = run(['video', 'cinema-profile', '--project', 'cp3', '--root', root]);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr + res.stdout, /requires at least one of/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('a written cinema-profile dials down a later filmmaking-prompts run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cinemaprof-dial-'));
    try {
      await seedProject(root, 'cp4');
      // Default (no profile yet) is the rich+prose photoreal treatment.
      const before = run(['video', 'filmmaking-prompts', '--project', 'cp4', '--root', root]);
      assert.equal(before.status, 0, before.stderr);
      const beforeGrid = JSON.parse(before.stdout).artifact.storyboardGridPrompt.promptText as string;
      assert.match(beforeGrid, /Capture realism:/);
      assert.match(beforeGrid, /wide-latitude cinema capture/);

      // Persist a dial-down, then re-run: the rich+realism treatment drops off.
      const setRes = run(['video', 'cinema-profile', '--project', 'cp4', '--root', root, '--detail', 'standard', '--no-realism']);
      assert.equal(setRes.status, 0, setRes.stderr);
      const after = run(['video', 'filmmaking-prompts', '--project', 'cp4', '--root', root]);
      assert.equal(after.status, 0, after.stderr);
      const afterGrid = JSON.parse(after.stdout).artifact.storyboardGridPrompt.promptText as string;
      assert.doesNotMatch(afterGrid, /Capture realism:/);
      assert.doesNotMatch(afterGrid, /wide-latitude cinema capture/);
      assert.notEqual(afterGrid, beforeGrid);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
