import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnVeo, type VeoSpawnResult } from '../video/veo-subprocess.js';

describe('spawnVeo', () => {
  it('returns a VeoSpawnResult shape on dry-run', async () => {
    const result: VeoSpawnResult = await spawnVeo(['--help'], { dryRun: true });
    assert.equal(typeof result.exitCode, 'number');
    assert.equal(typeof result.stdout, 'string');
    assert.equal(typeof result.stderr, 'string');
    assert.equal(result.command, 'bun run vclaw-cli/flow.ts --help');
  });
});
