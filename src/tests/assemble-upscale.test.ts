/**
 * Unit tests for the gated, opt-in Topaz upscale planner (WS9 Task 9.3).
 *
 * Scope: PURE planner only. No real CLI is ever invoked — `topazUpscalePlan`
 * returns a { run, reason?, command } plan; the actual shell-out (a separate
 * thin wrapper) runs only when plan.run is true. These tests pass the gate
 * inputs explicitly so they are deterministic and offline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topazUpscalePlan } from '../video/assemble/upscale.js';

test('disabled when env flag unset', () => {
  const p = topazUpscalePlan('/in.mp4', '/out.mp4', { enabled: false, cliPath: undefined });
  assert.equal(p.run, false);
  assert.deepEqual(p.command, []);
});

test('disabled (with reason) when enabled but CLI absent', () => {
  const p = topazUpscalePlan('/in.mp4', '/out.mp4', { enabled: true, cliPath: undefined });
  assert.equal(p.run, false);
  assert.ok(/not installed|absent|missing/i.test(p.reason ?? ''));
  assert.deepEqual(p.command, []);
});

test('planned when enabled and CLI present', () => {
  const p = topazUpscalePlan('/in.mp4', '/out.mp4', {
    enabled: true,
    cliPath: '/usr/local/bin/topaz',
  });
  assert.equal(p.run, true);
  assert.ok(p.command.includes('/usr/local/bin/topaz'));
  assert.ok(p.command.includes('/in.mp4'));
  assert.ok(p.command.includes('/out.mp4'));
});
