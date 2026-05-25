import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('vclaw prompt library cli', () => {
  it('lists and shows bundled prompt references', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

    const listResult = spawnSync(process.execPath, [cliPath, 'video', 'prompt-lib-list'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(listResult.status, 0, listResult.stderr);
    const listPayload = JSON.parse(listResult.stdout) as { references?: Array<{ name?: string }> };
    assert.ok(listPayload.references?.some((reference) => reference.name === 'stage-directors'));

    const showResult = spawnSync(process.execPath, [cliPath, 'video', 'prompt-lib-show', '--name', 'veo-prompting-guide'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(showResult.status, 0, showResult.stderr);
    const showPayload = JSON.parse(showResult.stdout) as { reference?: { name?: string; content?: string } };
    assert.equal(showPayload.reference?.name, 'veo-prompting-guide');
    assert.match(showPayload.reference?.content ?? '', /Veo Prompting Guide/i);
  });
});
