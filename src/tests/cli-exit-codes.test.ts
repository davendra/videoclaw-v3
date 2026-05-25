import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('cli exit codes', () => {
  it('exits 0 on success (vclaw schema)', () => {
    const r = spawnSync(process.execPath, [cliPath, 'schema'], { encoding: 'utf-8' });
    assert.equal(r.status, 0);
  });

  it('exits 1 (USER_ERROR) on unknown subcommand', () => {
    const r = spawnSync(process.execPath, [cliPath, 'this-subcommand-does-not-exist'], {
      encoding: 'utf-8',
    });
    assert.equal(r.status, 1, r.stderr);
    const payload = JSON.parse(r.stdout) as { code: string };
    assert.equal(payload.code, 'unknown_subcommand');
  });

  it('exits 1 (USER_ERROR) on missing required slug for video init', () => {
    const r = spawnSync(process.execPath, [cliPath, 'video', 'init'], {
      encoding: 'utf-8',
    });
    assert.equal(r.status, 1, r.stderr);
    const payload = JSON.parse(r.stdout) as { code: string };
    // Either missing_required_flag or invalid_slug is acceptable here.
    assert.ok(['missing_required_flag', 'invalid_slug'].includes(payload.code),
      `unexpected code: ${payload.code}`);
  });
});
