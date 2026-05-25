import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listPlaybooks, readPlaybook } from '../video/playbooks.js';

describe('playbooks', () => {
  it('lists bundled playbooks and reads them by name', async () => {
    const playbooks = await listPlaybooks(process.cwd());
    assert.ok(playbooks.includes('seedance-ugc'));
    assert.ok(playbooks.includes('veo-generic'));

    const seedance = await readPlaybook('seedance-ugc', process.cwd());
    const veo = await readPlaybook('veo-generic', process.cwd());
    assert.equal(seedance?.provider, 'seedance');
    assert.equal(veo?.provider, 'veo');
  });
});
