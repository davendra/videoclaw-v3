import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw filmmaking-prompts cli', () => {
  it('writes a prompt packet artifact for the ai-filmmaking workflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-filmmaking-cli-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await addCharacterProfile(workspace, {
        name: 'Rani',
        description: 'early thirties Indian woman, compact muscular build, cropped black hair, focused dark eyes, navy tactical vest, black boots, curved blade at hip',
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
          description: 'Rani pivots under rain as city lights flare behind her',
          characters: ['Rani'],
          scenePrompt: {
            animationPrompt: 'Rani pivots, draws the blade, and holds a defensive stance',
          },
        }],
      }));

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'filmmaking-prompts',
        '--project',
        'alpha',
        '--root',
        root,
        '--storyboard-grid',
        'assets/storyboard-grid.png',
        '--write',
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        artifactPath?: string;
        artifact?: {
          referenceMap?: Array<{ role?: string; status?: string; path?: string }>;
          seedancePackets?: Array<{ durationSeconds?: number; promptText?: string }>;
        };
      };
      assert.ok(payload.artifactPath?.endsWith('artifacts/filmmaking-prompts.json'));
      assert.equal(payload.artifact?.seedancePackets?.[0]?.durationSeconds, 15);
      assert.match(payload.artifact?.seedancePackets?.[0]?.promptText ?? '', /NO TEXT ON SCREEN, NO MUSIC/);
      assert.equal(payload.artifact?.referenceMap?.some((slot) => (
        slot.role === 'storyboard-grid'
        && slot.status === 'ready'
        && slot.path === 'assets/storyboard-grid.png'
      )), true);

      const saved = await readFile(join(root, 'projects', 'alpha', 'artifacts', 'filmmaking-prompts.json'), 'utf-8');
      assert.match(saved, /character-sheets-plus-storyboard-grid/);
      assert.match(saved, /@image1/);
      assert.match(saved, /assets\/storyboard-grid\.png/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
