import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addCharacterProfile, listCharacterProfiles, readCharacterProfile } from '../video/characters.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('character profiles', () => {
  it('adds, lists, and reads project character profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-characters-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const character = await addCharacterProfile(workspace, {
        name: 'Nova',
        goBananasId: 170,
        description: 'A determined spaceship captain.',
        referenceAssets: ['refs/nova-sheet.png'],
        notes: ['Keep the silver jacket.'],
      });

      assert.equal(character.id, 'nova');

      const listed = await listCharacterProfiles(workspace);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.name, 'Nova');

      const readByName = await readCharacterProfile(workspace, 'Nova');
      assert.equal(readByName?.id, 'nova');
      assert.equal(readByName?.goBananasId, 170);
      assert.deepEqual(readByName?.referenceAssets, ['refs/nova-sheet.png']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
