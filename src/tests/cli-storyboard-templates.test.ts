import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('vclaw storyboard template cli', () => {
  it('lists and shows built-in storyboard templates', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

    const listResult = spawnSync(process.execPath, [cliPath, 'video', 'storyboard-template-list'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(listResult.status, 0, listResult.stderr);
    const listPayload = JSON.parse(listResult.stdout) as { templates?: Array<{ id?: string }> };
    assert.ok(listPayload.templates?.some((template) => template.id === 'dialogue-confrontation'));
    assert.ok(listPayload.templates?.some((template) => template.id === 'product-commercial-4'));
    assert.ok(listPayload.templates?.some((template) => template.id === 'food-tutorial-6'));

    const showResult = spawnSync(
      process.execPath,
      [cliPath, 'video', 'storyboard-template-show', '--name', 'product-commercial-4'],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );
    assert.equal(showResult.status, 0, showResult.stderr);
    const showPayload = JSON.parse(showResult.stdout) as { template?: { id?: string; panels?: unknown[] } };
    assert.equal(showPayload.template?.id, 'product-commercial-4');
    assert.equal(showPayload.template?.panels?.length, 4);
  });
});
