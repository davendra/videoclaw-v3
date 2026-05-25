import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const VCLAW = fileURLToPath(new URL('../cli/vclaw.js', import.meta.url));

function runInit(slug: string, root: string): { status: number; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [VCLAW, 'video', 'init', slug, '--root', root], {
    encoding: 'utf-8',
  });
  return {
    status: result.status ?? -1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

describe('video init slug validation (Addendum B4)', () => {
  it('rejects --project as the slug (the historical argv-as-slug bug)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-init-slug-'));
    try {
      const { status, stderr } = runInit('--project', root);
      assert.notEqual(status, 0);
      assert.match(stderr, /slug cannot start with '-'/);
      assert.match(stderr, /argv-as-slug bug/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects uppercase / whitespace / dots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-init-slug-'));
    try {
      for (const bad of ['Foo', 'foo bar', 'foo.bar', 'foo_bar', '.foo', '-foo']) {
        const { status, stderr } = runInit(bad, root);
        assert.notEqual(status, 0, `expected ${JSON.stringify(bad)} to be rejected, got status=${status}`);
        assert.ok(stderr.includes('video init:'), `expected slug-validation error for ${JSON.stringify(bad)}, got: ${stderr}`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects reserved per-project directory names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-init-slug-'));
    try {
      for (const reserved of ['artifacts', 'checkpoints', 'events', 'outputs', 'assets', 'obsidian', 'characters', 'notes', 'tmp']) {
        const { status, stderr } = runInit(reserved, root);
        assert.notEqual(status, 0, `expected reserved ${JSON.stringify(reserved)} to be rejected`);
        assert.match(stderr, /reserved per-project directory name/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects consecutive hyphens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-init-slug-'));
    try {
      const { status, stderr } = runInit('foo--bar', root);
      assert.notEqual(status, 0);
      assert.match(stderr, /consecutive hyphens/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects too-short / too-long slugs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-init-slug-'));
    try {
      const tooShort = runInit('ab', root);
      assert.notEqual(tooShort.status, 0);
      assert.match(tooShort.stderr, /3-64 chars/);

      const tooLong = runInit('a'.repeat(65), root);
      assert.notEqual(tooLong.status, 0);
      assert.match(tooLong.stderr, /3-64 chars/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a well-formed slug', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-init-slug-'));
    try {
      const { status, stderr } = runInit('2026-05-25-disco-monster', root);
      assert.equal(status, 0, `expected success, got status=${status}, stderr=${stderr}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
