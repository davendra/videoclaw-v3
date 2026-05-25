import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpServer } from '../mcp/server.js';

describe('mcp server', () => {
  it('buildMcpServer constructs without throwing', () => {
    const server = buildMcpServer();
    assert.ok(server);
  });
});
