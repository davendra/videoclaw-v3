import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[], input?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    input,
  });
}

describe('vclaw video multi-shot --hook / --dialogue', () => {
  it('--format per-shot --hook beat-drop prepends the hook directive text', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--format', 'per-shot', '--hook', 'beat-drop',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Opening hook — /);
    assert.match(res.stdout, /downbeat/);
  });

  it('without --hook the per-shot output has no hook directive', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--format', 'per-shot',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /Opening hook — /);
  });

  it('--format seedance-paragraph --dialogue renders the spoken line via withDialogue', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--format', 'seedance-paragraph', '--dialogue', 'Meera: We move at dawn.',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Meera says: "We move at dawn\."/);
  });

  it('--dialogue with a second speaker emits exactly one "replies:"', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--format', 'seedance-paragraph', '--dialogue', 'Ravi: Hold the line. || Meera: Not yet.',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Ravi says: "Hold the line\."/);
    const repliesCount = (res.stdout.match(/replies:/g) ?? []).length;
    assert.equal(repliesCount, 1, res.stdout);
    assert.match(res.stdout, /Meera replies: "Not yet\."/);
  });

  it('without --dialogue the seedance-paragraph output has no dialogue opener', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--format', 'seedance-paragraph',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, / says: "/);
  });

  it('rejects an unknown --hook with a clear error listing valid ids', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--format', 'per-shot', '--hook', 'bogus',
    ]);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /--hook must be one of/);
    assert.match(res.stdout + res.stderr, /beat-drop/);
  });

  it('rejects a malformed --dialogue (no colon) with a clear error', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--format', 'seedance-paragraph', '--dialogue', 'nocolon',
    ]);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /--dialogue/);
  });

  it('--hook/--dialogue are ignored on --format default (output unchanged)', () => {
    const base = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7']);
    const withFlags = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--hook', 'beat-drop', '--dialogue', 'Meera: We move at dawn.',
    ]);
    assert.equal(base.status, 0, base.stderr);
    assert.equal(withFlags.status, 0, withFlags.stderr);
    assert.equal(withFlags.stdout, base.stdout);
  });

  it('--format default explicitly remains byte-identical to omitted flags', () => {
    const omitted = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7']);
    const explicit = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7', '--format', 'default',
    ]);
    assert.equal(omitted.status, 0, omitted.stderr);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(explicit.stdout, omitted.stdout);
  });
});
