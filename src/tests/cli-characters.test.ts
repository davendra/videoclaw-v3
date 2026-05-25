import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw character cli', () => {
  it('adds, lists, and shows project character profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-characters-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const initResult = spawnSync(process.execPath, [cliPath, 'video', 'init', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(initResult.status, 0);

      const addResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'character-add',
          '--project',
          'alpha',
          '--root',
          root,
          '--name',
          'Nova',
          '--gb-id',
          '170',
          '--description',
          'A determined spaceship captain.',
          '--ref',
          'refs/nova-sheet.png',
          '--note',
          'Keep the silver jacket.'
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(addResult.status, 0);

      const listResult = spawnSync(process.execPath, [cliPath, 'video', 'character-list', '--project', 'alpha', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(listResult.status, 0);
      const listPayload = JSON.parse(listResult.stdout) as { characters?: Array<{ name?: string }> };
      assert.equal(listPayload.characters?.[0]?.name, 'Nova');

      const showResult = spawnSync(process.execPath, [cliPath, 'video', 'character-show', '--project', 'alpha', '--root', root, '--name', 'Nova'], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(showResult.status, 0);
      const showPayload = JSON.parse(showResult.stdout) as { character?: { id?: string; goBananasId?: number; referenceAssets?: string[] } };
      assert.equal(showPayload.character?.id, 'nova');
      assert.equal(showPayload.character?.goBananasId, 170);
      assert.deepEqual(showPayload.character?.referenceAssets, ['refs/nova-sheet.png']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
