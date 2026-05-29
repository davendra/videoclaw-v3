import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSeedanceAssets } from '../video/seedance-asset-library.js';

async function makeProject(slug: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vclaw-seedance-assets-'));
  await mkdir(join(root, 'projects', slug, 'artifacts'), { recursive: true });
  return root;
}

describe('readSeedanceAssets', () => {
  it('resolves a characterName to its Asset:// URI from the artifact', async () => {
    const slug = 'demo';
    const root = await makeProject(slug);
    const artifact = {
      schemaVersion: 1,
      projectSlug: slug,
      groupName: 'demo-cast',
      generatedAt: '2026-05-29T00:00:00.000Z',
      assets: [
        { name: 'Aanya', assetId: 'a-1', assetUri: 'Asset://aanya-uri', intlAssetUri: 'asset://aanya-uri' },
        { name: 'Vikram', assetId: 'a-2', assetUri: 'Asset://vikram-uri', intlAssetUri: 'asset://vikram-uri' },
      ],
    };
    await writeFile(
      join(root, 'projects', slug, 'artifacts', 'seedance-assets.json'),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );

    const result = await readSeedanceAssets(root, slug);
    assert.equal(result.assetUriByName.get('Aanya'), 'Asset://aanya-uri');
    assert.equal(result.assetUriByName.get('Vikram'), 'Asset://vikram-uri');
    assert.equal(result.assets.length, 2);
    assert.equal(result.assets[0]?.assetId, 'a-1');
  });

  it('returns an empty graceful result when the artifact is absent', async () => {
    const slug = 'no-assets';
    const root = await makeProject(slug);
    const result = await readSeedanceAssets(root, slug);
    assert.equal(result.assets.length, 0);
    assert.equal(result.assetUriByName.size, 0);
    assert.equal(result.assetUriByName.get('Anyone'), undefined);
  });
});
