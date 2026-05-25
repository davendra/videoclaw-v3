import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { buildCharacterConsistencyReport } from '../video/character-consistency.js';
import { addCharacterProfile } from '../video/characters.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('buildCharacterConsistencyReport', () => {
  it('reports missing profiles and missing reference assets from storyboard scenes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-character-consistency-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await addCharacterProfile(workspace, {
        name: 'Nova',
      });
      await addCharacterProfile(workspace, {
        name: 'Atlas',
        referenceAssets: ['refs/atlas.png'],
      });
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [
          { sceneIndex: 0, description: 'Scene one', characters: ['Nova', 'Atlas'] },
          { sceneIndex: 1, description: 'Scene two', characters: ['Ghost', 'atlas'] },
        ],
      }));

      const report = await buildCharacterConsistencyReport('alpha', root);
      assert.equal(report.ok, false);
      assert.deepEqual(report.referencedCharacters, ['Atlas', 'Ghost', 'Nova', 'atlas']);
      assert.deepEqual(report.missingProfiles, ['Ghost']);
      assert.deepEqual(report.missingReferenceAssets, ['Nova']);
      assert.ok(report.issues.some((item) => item.includes('Missing character profiles: Ghost')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
