import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
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

describe('vclaw video multi-shot --auto (stubbed) + --project', () => {
  const STUB_PROMPT = [
    '[00:00 - 00:05] Wide, 24mm, low angle, static — a figure stands in a field.',
    '',
    '[00:05 - 00:10] Medium, 50mm, eye-level, push-in — wind moves the grass.',
    '',
    '[00:10 - 00:15] Close-up, 85mm, high angle, handheld — the figure turns to camera.',
    '',
    'Location: Open field, golden hour.',
    'Style: Grounded realism. In the style of a Christopher Nolan movie.',
    'Audio: Diegetic sound only.',
  ].join('\n');

  it('authors via stub, validates, persists artifact under --project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-ms-proj-'));
    try {
      const init = run(['video', 'init', 'ms-demo', '--root', root]);
      assert.equal(init.status, 0, init.stderr);

      const stubFile = join(root, 'stub.txt');
      await writeFile(stubFile, STUB_PROMPT, 'utf-8');

      const res = spawnSync(
        process.execPath,
        [cliPath, 'video', 'multi-shot', '--auto', '--image', '/tmp/ref.png',
         '--location', 'Open field', '--time', 'golden hour',
         '--project', 'ms-demo', '--root', root],
        { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, VCLAW_MULTISHOT_AUTO_STUB: stubFile } },
      );
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.valid, true);

      const artifact = JSON.parse(
        await readFile(join(root, 'projects', 'ms-demo', 'artifacts', 'multi-shot-prompt.json'), 'utf-8'),
      );
      assert.equal(artifact.preset, 'cinematic-15s');
      assert.equal(artifact.location, 'Open field');
      assert.ok(artifact.promptText.includes('00:00 - 00:05'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--raw prints only the prompt body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-ms-raw-'));
    try {
      const stubFile = join(dir, 'stub.txt');
      await writeFile(stubFile, STUB_PROMPT, 'utf-8');
      const res = spawnSync(
        process.execPath,
        [cliPath, 'video', 'multi-shot', '--auto', '--image', '/tmp/ref.png', '--location', 'Open field', '--time', 'golden hour', '--raw'],
        { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, VCLAW_MULTISHOT_AUTO_STUB: stubFile } },
      );
      assert.equal(res.status, 0, res.stderr);
      assert.ok(res.stdout.trimStart().startsWith('[00:00'));
      assert.ok(!res.stdout.includes('"valid"'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('vclaw video prompt-lib-show multi-shot-framework', () => {
  it('lists and shows the multi-shot-framework reference', () => {
    const list = run(['video', 'prompt-lib-list']);
    assert.equal(list.status, 0, list.stderr);
    const names = JSON.parse(list.stdout).references.map((r: any) => r.name);
    assert.ok(names.includes('multi-shot-framework'));

    const show = run(['video', 'prompt-lib-show', '--name', 'multi-shot-framework']);
    assert.equal(show.status, 0, show.stderr);
    assert.ok(JSON.parse(show.stdout).reference.content.length > 100);
  });
});
