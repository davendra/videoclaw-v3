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
  it('--presets emits machine-readable preset metadata', () => {
    const res = run(['video', 'multi-shot', '--presets']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.deepEqual(
      parsed.presets.map((preset: any) => preset.name),
      ['cinematic-15s', 'seedance-10s', 'veo-8s', 'runway-10s'],
    );
    assert.equal(parsed.presets.find((preset: any) => preset.name === 'runway-10s').maxChars, 1000);
  });

  it('emits a plan whose shots total 15s', () => {
    const res = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.name, 'cinematic-15s');
    assert.equal(parsed.shots.length, 5);
    const total = parsed.shots.reduce((s: number, x: any) => s + (x.end - x.start), 0);
    assert.equal(total, 15);
  });

  it('accepts the known --preset cinematic-15s as a no-op', () => {
    const res = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7', '--preset', 'cinematic-15s']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).preset.name, 'cinematic-15s');
  });

  it('exits nonzero with a clear error for an unknown --preset', () => {
    const res = run(['video', 'multi-shot', '--plan', '--preset', 'bogus']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /unknown preset "bogus".*cinematic-15s.*seedance-10s.*veo-8s.*runway-10s/);
  });

  it('--preset seedance-10s emits a 10s plan within seedance bounds', () => {
    const res = run(['video', 'multi-shot', '--plan', '--preset', 'seedance-10s', '--seed', '7']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.name, 'seedance-10s');
    assert.equal(parsed.preset.totalSeconds, 10);
    assert.ok(parsed.shots.length >= 2 && parsed.shots.length <= 5);
  });

  it('--preset veo-8s emits an 8s plan within veo bounds', () => {
    const res = run(['video', 'multi-shot', '--plan', '--preset', 'veo-8s', '--seed', '7']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.name, 'veo-8s');
    assert.equal(parsed.preset.totalSeconds, 8);
    assert.ok(parsed.shots.length >= 2 && parsed.shots.length <= 4);
  });

  it('--preset runway-10s emits a plan with the runway 1000-char budget', () => {
    const res = run(['video', 'multi-shot', '--plan', '--preset', 'runway-10s', '--seed', '7']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.name, 'runway-10s');
    assert.equal(parsed.preset.maxChars, 1000);
  });

  it('--shots above preset.maxShots is rejected for veo-8s', () => {
    const res = run(['video', 'multi-shot', '--plan', '--preset', 'veo-8s', '--shots', '6']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /--shots 6 outside preset "veo-8s" window \[2, 4\]/);
  });

  it('--shots below preset.minShots is rejected for cinematic-15s', () => {
    const res = run(['video', 'multi-shot', '--plan', '--preset', 'cinematic-15s', '--shots', '2']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /--shots 2 outside preset "cinematic-15s" window \[3, 7\]/);
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

  it('--explain-issues adds stable repair guidance for validation failures', () => {
    const bad = VALID.replace('[00:12 - 00:15]', '[00:12 - 00:14]');
    const res = run(['video', 'multi-shot', '--validate', '--explain-issues'], bad);
    assert.notEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.explanations.some((i: any) => i.code === 'multi-shot-timecode-total'));
    assert.match(parsed.explanations[0].suggestedFix, /\S/);
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

  const VEO_STUB_PROMPT = [
    '[00:00 - 00:03] Wide, 24mm, low angle, static — Meera pulls Rani away from the rooftop edge.',
    '',
    '[00:03 - 00:06] Medium, 50mm, eye-level, push-in — lightning flashes behind them as they recover.',
    '',
    '[00:06 - 00:08] Close-up, 85mm, high angle, handheld — Rani looks back toward the skyline.',
    '',
    'Location: Rooftop Rescue, natural daylight.',
    'Style: Grounded realism. In the style of a Christopher Nolan movie.',
    'Audio: Diegetic sound only.',
  ].join('\n');

  it('--from-storyboard hydrates a plan from a project scene and provider route', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-ms-story-'));
    try {
      assert.equal(run(['video', 'init', 'ms-story', '--root', root]).status, 0);
      assert.equal(
        run([
          'video', 'brief',
          '--project', 'ms-story',
          '--root', root,
          '--title', 'Market Chase',
          '--intent', 'A kinetic rooftop chase.',
        ]).status,
        0,
      );
      assert.equal(
        run([
          'video', 'storyboard',
          '--project', 'ms-story',
          '--root', root,
          '--scene', 'Tara sprints across a crowded neon market while guards close in.',
          '--scene-character', '0:Tara',
        ]).status,
        0,
      );

      const res = run([
        'video', 'multi-shot',
        '--plan',
        '--from-storyboard',
        '--project', 'ms-story',
        '--root', root,
        '--scene', '0',
        '--route', 'seedance-direct',
        '--seed', '3',
      ]);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.preset.name, 'seedance-10s');
      assert.equal(parsed.source.kind, 'storyboard-scene');
      assert.equal(parsed.source.sceneIndex, 0);
      assert.equal(parsed.source.presetSource, 'provider-route');
      assert.equal(parsed.input.location, 'Market Chase');
      assert.equal(parsed.input.character, 'Tara');
      assert.match(parsed.input.action, /Tara sprints/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
      assert.equal(parsed.shots.length, 3);
      assert.equal(parsed.shots[1].movement, 'push-in');
      assert.equal(parsed.attempts.length, 1);

      const artifact = JSON.parse(
        await readFile(join(root, 'projects', 'ms-demo', 'artifacts', 'multi-shot-prompt.json'), 'utf-8'),
      );
      assert.equal(artifact.preset, 'cinematic-15s');
      assert.equal(artifact.location, 'Open field');
      assert.ok(artifact.promptText.includes('00:00 - 00:05'));
      assert.equal(artifact.shots.length, 3);
      assert.equal(artifact.shots[0].description, 'a figure stands in a field.');
      assert.equal(artifact.attempts.length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--dry-run prints the resolved auto contract without requiring an image or Gemini key', () => {
    const res = run([
      'video', 'multi-shot', '--auto', '--dry-run',
      '--image', '/tmp/does-not-exist.png',
      '--preset', 'veo-8s',
      '--location', 'Rooftop',
      '--time', 'night',
    ]);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.preset.name, 'veo-8s');
    assert.equal(parsed.input.imageExists, false);
    assert.deepEqual(parsed.validationContract.shotCount, [2, 4]);
  });

  it('--from-storyboard --auto persists source metadata and hydrated inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-ms-story-auto-'));
    try {
      assert.equal(run(['video', 'init', 'ms-story-auto', '--root', root]).status, 0);
      assert.equal(
        run([
          'video', 'brief',
          '--project', 'ms-story-auto',
          '--root', root,
          '--title', 'Rooftop Rescue',
          '--intent', 'A rescue scene on a rain-soaked rooftop.',
        ]).status,
        0,
      );
      assert.equal(
        run([
          'video', 'storyboard',
          '--project', 'ms-story-auto',
          '--root', root,
          '--scene', 'Meera pulls Rani away from the rooftop edge as lightning hits the skyline.',
          '--scene-character', '0:Meera',
          '--scene-character', '0:Rani',
        ]).status,
        0,
      );

      const stubFile = join(root, 'stub.txt');
      await writeFile(stubFile, VEO_STUB_PROMPT, 'utf-8');
      const res = spawnSync(
        process.execPath,
        [
          cliPath, 'video', 'multi-shot',
          '--auto',
          '--image', '/tmp/ref.png',
          '--from-storyboard',
          '--project', 'ms-story-auto',
          '--root', root,
          '--scene', '0',
          '--provider', 'veo',
        ],
        { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, VCLAW_MULTISHOT_AUTO_STUB: stubFile } },
      );
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.preset, 'veo-8s');
      assert.equal(parsed.source.projectSlug, 'ms-story-auto');
      assert.equal(parsed.source.characters.length, 2);
      assert.equal(parsed.location, 'Rooftop Rescue');

      const artifact = JSON.parse(
        await readFile(join(root, 'projects', 'ms-story-auto', 'artifacts', 'multi-shot-prompt.json'), 'utf-8'),
      );
      assert.equal(artifact.source.kind, 'storyboard-scene');
      assert.equal(artifact.source.sceneIndex, 0);
      assert.equal(artifact.source.presetSource, 'provider-route');
      assert.equal(artifact.location, 'Rooftop Rescue');
      assert.equal(artifact.timeOfDay, 'natural daylight');
      assert.equal(artifact.shots.length, 3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--retry-invalid retries stubbed invalid output and persists only the final attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-ms-retry-'));
    try {
      const init = run(['video', 'init', 'ms-retry', '--root', root]);
      assert.equal(init.status, 0, init.stderr);

      const badPrompt = STUB_PROMPT.replace('[00:10 - 00:15]', '[00:10 - 00:14]');
      const stubFile = join(root, 'stub-sequence.json');
      await writeFile(stubFile, JSON.stringify([badPrompt, STUB_PROMPT]), 'utf-8');

      const res = spawnSync(
        process.execPath,
        [cliPath, 'video', 'multi-shot', '--auto', '--image', '/tmp/ref.png',
         '--location', 'Open field', '--time', 'golden hour',
         '--retry-invalid', '1', '--project', 'ms-retry', '--root', root],
        { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, VCLAW_MULTISHOT_AUTO_STUB: stubFile } },
      );
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.valid, true);
      assert.equal(parsed.attempts.length, 2);
      assert.equal(parsed.attempts[0].valid, false);
      assert.equal(parsed.attempts[1].valid, true);

      const artifact = JSON.parse(
        await readFile(join(root, 'projects', 'ms-retry', 'artifacts', 'multi-shot-prompt.json'), 'utf-8'),
      );
      assert.equal(artifact.valid, true);
      assert.equal(artifact.attempts.length, 2);
      assert.ok(artifact.promptText.includes('[00:10 - 00:15]'));
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

describe('vclaw video multi-shot --fix', () => {
  it('adds missing metadata and returns a valid fixed prompt when deterministic inputs are supplied', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-ms-fix-'));
    try {
      const file = join(dir, 'prompt.txt');
      const missingMetadata = [
        '[00:00 - 00:05] Wide, 24mm, low angle, static — a figure stands in a field.',
        '',
        '[00:05 - 00:10] Medium, 50mm, eye-level, push-in — wind moves the grass.',
        '',
        '[00:10 - 00:15] Close-up, 85mm, high angle, handheld — the figure turns to camera.',
      ].join('\n');
      await writeFile(file, missingMetadata, 'utf-8');
      const res = run(['video', 'multi-shot', '--fix', '--file', file, '--location', 'Open field', '--time', 'golden hour']);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.original.valid, false);
      assert.equal(parsed.fixed.valid, true);
      assert.ok(parsed.appliedFixes.includes('added-metadata'));
      assert.equal(parsed.fixed.shots.length, 3);
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
