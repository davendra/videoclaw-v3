import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

async function seedProject(root: string): Promise<void> {
  const workspace = await ensureProjectWorkspace('alpha', root);
  await addCharacterProfile(workspace, {
    name: 'Rani',
    description: 'early thirties woman, compact muscular build, cropped black hair, navy tactical vest, black boots',
    referenceAssets: ['characters/rani-sheet.jpg'],
  });
  await writeArtifact(workspace, 'brief', createBriefArtifact({
    title: 'Rani Rooftop',
    intent: 'A cinematic rooftop action beat.',
    productionMode: 'director',
  }));
  await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
    projectSlug: 'alpha',
    productionMode: 'director',
    scenes: [{
      sceneIndex: 0,
      description: 'A lone figure pivots under rain as city lights flare behind',
      characters: ['Rani'],
      scenePrompt: { animationPrompt: 'The figure pivots and holds a defensive stance' },
    }],
  }));
}

function generateArtifact(root: string): void {
  const gen = spawnSync(process.execPath, [
    cliPath, 'video', 'filmmaking-prompts', '--project', 'alpha', '--root', root, '--write',
  ], { encoding: 'utf-8' });
  assert.equal(gen.status, 0, gen.stderr);
}

describe('vclaw prompt-lint cli', () => {
  it('lints a generated filmmaking-prompts artifact and reports machine-readable JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-prompt-lint-'));
    try {
      await seedProject(root);
      generateArtifact(root);

      const result = spawnSync(process.execPath, [
        cliPath, 'video', 'prompt-lint', '--project', 'alpha', '--root', root,
      ], { encoding: 'utf-8' });

      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        packets: Array<{ sceneIndex: number; issues: Array<{ code: string; severity: string }> }>;
      };
      assert.ok(Array.isArray(payload.packets), result.stderr);
      assert.equal(payload.packets.length, 1);
      assert.equal(payload.packets[0]!.sceneIndex, 0);
      // The default photoreal treatment may carry advisory warnings but no
      // error-severity issue, so exit 0 and ok:true.
      assert.equal(payload.ok, true, JSON.stringify(payload));
      assert.equal(result.status, 0, result.stderr);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exits non-zero and flags issues for a corrupt artifact passed via --file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-prompt-lint-file-'));
    try {
      const bad = join(root, 'bad.json');
      // A text-driven packet missing the required blocks AND the grid guard
      // while a grid ref is attached → two error-severity issues.
      await writeFile(bad, JSON.stringify({
        schemaVersion: 1,
        projectSlug: 'x',
        generatedAt: '2026-05-30T00:00:00.000Z',
        sourceSkill: 'ai-filmmaking',
        durationDefaultSeconds: 9,
        referenceMap: [],
        characterSheetPrompts: [],
        storyboardGridPrompt: null,
        seedancePackets: [{
          sceneIndex: 0,
          variant: 'text-driven',
          durationSeconds: 9,
          references: [{ slot: '@image1', role: 'storyboard-grid', label: 'grid', status: 'ready' }],
          promptText: 'Use the grid as reference only.',
          warnings: [],
        }],
        issues: [],
      }), 'utf-8');

      const result = spawnSync(process.execPath, [
        cliPath, 'video', 'prompt-lint', '--file', bad,
      ], { encoding: 'utf-8' });

      const payload = JSON.parse(result.stdout) as { ok: boolean; packets: Array<{ issues: Array<{ code: string }> }> };
      assert.equal(payload.ok, false);
      const codes = payload.packets[0]!.issues.map((i: { code: string }) => i.code);
      assert.ok(codes.includes('grid-guard-missing'));
      assert.ok(codes.includes('missing-required-block'));
      assert.equal(result.status, 1, 'non-ok lint exits 1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires exactly one of --project or --file', () => {
    const result = spawnSync(process.execPath, [cliPath, 'video', 'prompt-lint'], { encoding: 'utf-8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires --project <slug> or --file <path>/);
  });
});
