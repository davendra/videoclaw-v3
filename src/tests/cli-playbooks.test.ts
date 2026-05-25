import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('vclaw playbook cli', () => {
  it('lists and shows bundled playbooks', async () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

    const listResult = spawnSync(process.execPath, [cliPath, 'video', 'playbook-list'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(listResult.status, 0);
    const listPayload = JSON.parse(listResult.stdout) as { playbooks?: string[] };
    assert.ok(listPayload.playbooks?.includes('seedance-ugc'));

    const showResult = spawnSync(process.execPath, [cliPath, 'video', 'playbook-show', '--name', 'seedance-ugc'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(showResult.status, 0);
    const showPayload = JSON.parse(showResult.stdout) as { playbook?: { name?: string; provider?: string } };
    assert.equal(showPayload.playbook?.name, 'seedance-ugc');
    assert.equal(showPayload.playbook?.provider, 'seedance');
  });
});
