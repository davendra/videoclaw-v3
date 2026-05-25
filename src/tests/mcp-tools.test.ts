import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listProjectsTool,
  getProjectStatusTool,
  getArtifactsTool,
  getEventLogTool,
  listProviderRoutesTool,
} from '../mcp/tools.js';

describe('mcp tools', () => {
  it('listProjectsTool returns an array (empty workspace)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-mcp-'));
    const result = await listProjectsTool({ root });
    assert.ok(Array.isArray(result.projects));
    assert.equal(result.projects.length, 0);
  });

  it('listProviderRoutesTool returns the production routes', async () => {
    const result = await listProviderRoutesTool({});
    const ids = result.routes.map((r) => r.routeId);
    assert.ok(ids.includes('veo-useapi'));
    assert.ok(ids.includes('seedance-direct'));
    assert.ok(ids.includes('runway-useapi'));
    // kling was removed in Phase 10c
    assert.ok(!ids.includes('kling-useapi'), 'kling-useapi should be gone');
    for (const route of result.routes) {
      assert.equal(typeof route.availability, 'string');
    }
  });

  it('getProjectStatusTool returns found:false for a missing slug', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-mcp-'));
    const result = await getProjectStatusTool({ root, slug: 'does-not-exist' });
    assert.equal(result.found, false);
    assert.equal(result.status, undefined);
  });

  it('getArtifactsTool returns found:false for a missing slug', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-mcp-'));
    const result = await getArtifactsTool({ root, slug: 'does-not-exist' });
    assert.equal(result.found, false);
    assert.deepEqual(result.artifacts, {});
  });

  it('getEventLogTool returns found:false + empty events for a missing slug', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-mcp-'));
    const result = await getEventLogTool({ root, slug: 'does-not-exist' });
    assert.equal(result.found, false);
    assert.ok(Array.isArray(result.events));
    assert.equal(result.events.length, 0);
  });
});
