import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[], input?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    input,
  });
}

describe('vclaw video multi-shot --plan', () => {
  it('emits a plan whose shots total 15s', () => {
    const res = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.name, 'cinematic-15s');
    assert.equal(parsed.shots.length, 5);
    const total = parsed.shots.reduce((s: number, x: any) => s + (x.end - x.start), 0);
    assert.equal(total, 15);
  });
});

describe('vclaw video multi-shot --validate', () => {
  const VALID = [
    '[00:00 - 00:04] Wide, 24mm, low angle, tracking — a man walks through a Tokyo alley.',
    '',
    '[00:04 - 00:07] Medium, 50mm, eye-level, handheld — he moves between food stalls.',
    '',
    '[00:07 - 00:09] Close-up, 85mm, high angle, static — his hand brushes a lantern.',
    '',
    '[00:09 - 00:12] Wide, 35mm, Dutch angle, push-in — he emerges into a broad street.',
    '',
    '[00:12 - 00:15] Medium close-up, 50mm, low angle, pull-out — he looks up at a sign.',
    '',
    'Location: Narrow Tokyo alley, night.',
    'Style: Cool shadows. In the style of a Christopher Nolan movie.',
    'Audio: Diegetic sound only.',
  ].join('\n');

  it('exits 0 for a valid prompt from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-ms-'));
    try {
      const file = join(dir, 'prompt.txt');
      await writeFile(file, VALID, 'utf-8');
      const res = run(['video', 'multi-shot', '--validate', '--file', file]);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.valid, true);
      assert.equal(parsed.issues.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits nonzero and reports issues for an invalid prompt via stdin', () => {
    const bad = VALID.replace('[00:12 - 00:15]', '[00:12 - 00:14]');
    const res = run(['video', 'multi-shot', '--validate'], bad);
    assert.notEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.issues.some((i: any) => i.code === 'multi-shot-timecode-total'));
  });
});
