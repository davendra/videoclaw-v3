import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[], input?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    input,
  });
}

describe('vclaw video multi-shot --format / --lang', () => {
  it('--format default (omitted) emits the original JSON plan unchanged', () => {
    const res = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.name, 'cinematic-15s');
    assert.equal(parsed.shots.length, 5);
  });

  it('--format default explicitly matches the omitted-flag JSON output', () => {
    const omitted = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7']);
    const explicit = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7', '--format', 'default']);
    assert.equal(omitted.status, 0, omitted.stderr);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(explicit.stdout, omitted.stdout);
  });

  it('--format per-shot renders the structured per-shot composer', () => {
    const res = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7', '--format', 'per-shot']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /SHOT 1 — /);
    assert.match(res.stdout, /Audio: /);
  });

  it('--format seedance-paragraph renders a single labeled paragraph', () => {
    const res = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7', '--format', 'seedance-paragraph']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Style & Mood:/);
    assert.match(res.stdout, /Dynamic Description:/);
  });

  it('--lang en+zh wraps the rendered prompt in TWO fenced code blocks', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--format', 'per-shot', '--lang', 'en+zh',
    ]);
    assert.equal(res.status, 0, res.stderr);
    const fenceCount = (res.stdout.match(/```/g) ?? []).length;
    assert.equal(fenceCount, 4, res.stdout);
    assert.match(res.stdout, /EN/);
    assert.match(res.stdout, /中文/);
  });

  it('--lang en (default) wraps the rendered prompt in ONE fenced code block', () => {
    const res = run([
      'video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7',
      '--format', 'seedance-paragraph',
    ]);
    assert.equal(res.status, 0, res.stderr);
    const fenceCount = (res.stdout.match(/```/g) ?? []).length;
    assert.equal(fenceCount, 2, res.stdout);
  });

  it('rejects an unknown --format with a clear error', () => {
    const res = run(['video', 'multi-shot', '--plan', '--format', 'bogus']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /--format must be one of default, seedance-paragraph, per-shot/);
  });
});

describe('vclaw video filmmaking-prompts --phase', () => {
  async function seedProject(root: string, slug: string) {
    const workspace = await ensureProjectWorkspace(slug, root);
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Phase Demo',
      intent: 'A cinematic rooftop action beat.',
      productionMode: 'director',
    }));
    await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
      projectSlug: slug,
      productionMode: 'director',
      scenes: [{
        sceneIndex: 0,
        description: 'A figure pivots under rain as city lights flare behind',
        characters: [],
        scenePrompt: { animationPrompt: 'A figure pivots and holds a defensive stance' },
      }],
    }));
  }

  it('--phase storyboard gates seedancePackets to [] while storyboard fields remain present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fmp-phase-'));
    try {
      await seedProject(root, 'phase-sb');
      const res = run(['video', 'filmmaking-prompts', '--project', 'phase-sb', '--root', root, '--phase', 'storyboard']);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      assert.deepEqual(payload.artifact.seedancePackets, []);
      assert.ok(Array.isArray(payload.artifact.referenceMap));
      assert.ok('storyboardGridPrompt' in payload.artifact);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('default (no --phase) still emits non-empty seedancePackets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-fmp-default-'));
    try {
      await seedProject(root, 'phase-default');
      const res = run(['video', 'filmmaking-prompts', '--project', 'phase-default', '--root', root]);
      assert.equal(res.status, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      assert.ok(payload.artifact.seedancePackets.length > 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an unknown --phase with a clear error', () => {
    const res = run(['video', 'filmmaking-prompts', '--project', 'x', '--phase', 'bogus']);
    assert.notEqual(res.status, 0);
    assert.match(res.stdout + res.stderr, /--phase must be one of storyboard, video/);
  });
});
