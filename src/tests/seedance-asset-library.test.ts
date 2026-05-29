import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureAssetGroup,
  registerImageAsset,
  registerCharacterAssets,
  type FetchLike,
} from '../video/seedance-asset-library.js';

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface StubOptions {
  existingGroups?: Array<{ name: string; group_id: string }>;
  // Number of GET /assets polls before the created asset flips to "active".
  pollsUntilActive?: number;
}

function makeStub(opts: StubOptions = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  let assetPolls = 0;
  let createdAssetId = '';
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (url.includes('/api/v3/assets/groups') && method === 'GET') {
      return jsonResponse({ items: opts.existingGroups ?? [] });
    }
    if (url.includes('/api/v3/assets/groups') && method === 'POST') {
      return jsonResponse({ group_id: `group-new-${(body as { name: string }).name}` });
    }
    if (url.includes('/api/v3/assets') && method === 'POST') {
      createdAssetId = 'asset-xyz-123';
      return jsonResponse({
        asset_id: createdAssetId,
        asset_uri: `Asset://${createdAssetId}`,
        intl_asset_uri: `asset://${createdAssetId}`,
        sync_status: 'processing',
      });
    }
    if (url.includes('/api/v3/assets') && method === 'GET') {
      assetPolls += 1;
      const active = assetPolls >= (opts.pollsUntilActive ?? 1);
      return jsonResponse({
        items: [{ asset_id: createdAssetId, sync_status: active ? 'active' : 'processing' }],
      });
    }
    return jsonResponse({});
  };
  return { fetchImpl, calls };
}

const baseOpts = { apiKey: 'sk-test', sleep: async () => {}, pollIntervalMs: 1, maxSyncAttempts: 5 };

describe('seedance asset library', () => {
  it('reuses an existing group by name (no create call)', async () => {
    const { fetchImpl, calls } = makeStub({ existingGroups: [{ name: 'dhuaan-cast', group_id: 'group-existing' }] });
    const id = await ensureAssetGroup('dhuaan-cast', { ...baseOpts, fetchImpl });
    assert.equal(id, 'group-existing');
    assert.equal(calls.filter((c) => c.url.includes('/assets/groups') && c.method === 'POST').length, 0);
  });

  it('creates a group when none matches the name', async () => {
    const { fetchImpl, calls } = makeStub({ existingGroups: [{ name: 'other', group_id: 'g-other' }] });
    const id = await ensureAssetGroup('dhuaan-cast', { ...baseOpts, fetchImpl });
    assert.equal(id, 'group-new-dhuaan-cast');
    assert.equal(calls.filter((c) => c.url.includes('/assets/groups') && c.method === 'POST').length, 1);
  });

  it('registers an image asset and waits for sync to become active', async () => {
    const { fetchImpl, calls } = makeStub({ pollsUntilActive: 2 });
    const asset = await registerImageAsset(
      { groupId: 'g1', name: 'Meera', imageUrl: 'https://r2.example/meera.jpg' },
      { ...baseOpts, fetchImpl },
    );
    assert.equal(asset.assetUri, 'Asset://asset-xyz-123');
    assert.equal(asset.intlAssetUri, 'asset://asset-xyz-123');
    assert.equal(asset.syncStatus, 'active');
    // Create body carries the asset contract fields.
    const createCall = calls.find((c) => c.url.endsWith('/api/v3/assets') && c.method === 'POST');
    assert.deepEqual(createCall?.body, {
      group_id: 'g1', name: 'Meera', asset_type: 'Image',
      image_url: 'https://r2.example/meera.jpg', media_url: 'https://r2.example/meera.jpg',
    });
    // It polled at least twice (processing -> active).
    assert.ok(calls.filter((c) => c.url.includes('page_size=600')).length >= 2);
  });

  it('throws when the asset never reaches active within maxSyncAttempts', async () => {
    const { fetchImpl } = makeStub({ pollsUntilActive: 999 });
    await assert.rejects(
      registerImageAsset({ groupId: 'g1', name: 'Stuck', imageUrl: 'https://r2.example/x.jpg' }, { ...baseOpts, fetchImpl, maxSyncAttempts: 3 }),
      /did not reach sync_status "active"/,
    );
  });

  it('registers a full cast end-to-end (group + each character) returning Asset:// URIs', async () => {
    const { fetchImpl } = makeStub({ pollsUntilActive: 1 });
    const out = await registerCharacterAssets(
      { groupName: 'dhuaan-cast', characters: [
        { name: 'Meera', imageUrl: 'https://r2.example/meera.jpg' },
        { name: 'Tara', imageUrl: 'https://r2.example/tara.jpg' },
      ] },
      { ...baseOpts, fetchImpl },
    );
    assert.equal(out.length, 2);
    assert.ok(out.every((a) => a.assetUri.startsWith('Asset://') && a.syncStatus === 'active'));
  });

  it('requires an API key', async () => {
    await assert.rejects(ensureAssetGroup('x', { apiKey: '' }), /requires an API key/);
  });
});
