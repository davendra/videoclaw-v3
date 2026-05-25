import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function runVclaw(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8' });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe('noun-verb aliases', () => {
  it('vclaw video character list (noun-verb form) resolves, not unknown_subcommand', () => {
    // Should fail with missing --project (not unknown_subcommand)
    const r = runVclaw(['video', 'character', 'list']);
    if (r.status !== 0) {
      let payload: { code?: string } = {};
      try { payload = JSON.parse(r.stdout); } catch { /* might not be JSON */ }
      assert.notEqual(payload.code, 'unknown_subcommand',
        `noun-verb form should resolve, not fail as unknown subcommand. Got: ${JSON.stringify(payload)}, stderr: ${r.stderr}`);
    }
  });

  it('vclaw video character-list (kebab form) still works (backwards compat)', () => {
    const r = runVclaw(['video', 'character-list']);
    if (r.status !== 0) {
      let payload: { code?: string } = {};
      try { payload = JSON.parse(r.stdout); } catch { /* */ }
      assert.notEqual(payload.code, 'unknown_subcommand',
        `kebab form should still work. Got: ${JSON.stringify(payload)}, stderr: ${r.stderr}`);
    }
  });

  it('vclaw video init (single-word subcommand) still works (not broken by resolver)', () => {
    const r = runVclaw(['video', 'init']);
    // Should fail with missing slug, NOT unknown_subcommand
    if (r.status !== 0) {
      let payload: { code?: string } = {};
      try { payload = JSON.parse(r.stdout); } catch { /* */ }
      assert.notEqual(payload.code, 'unknown_subcommand',
        `single-word subcommand should still dispatch. Got: ${JSON.stringify(payload)}, stderr: ${r.stderr}`);
    }
  });
});
