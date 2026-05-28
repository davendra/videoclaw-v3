import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw preview portal cli', () => {
  it('generates local edit, review, client review, and preview pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-cli-'));
    try {
      const projectDir = join(root, 'projects', 'alpha');
      await mkdir(join(projectDir, 'final'), { recursive: true });
      await writeFile(join(projectDir, 'project.json'), JSON.stringify({ title: 'Alpha', template: 'story-film' }));
      await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'portal',
        '--project',
        'alpha',
        '--root',
        root,
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { outputs?: Array<{ surface?: string }> };
      assert.deepEqual(payload.outputs?.map((output) => output.surface), ['edit', 'review', 'client-review', 'preview']);
      assert.match(await readFile(join(projectDir, 'edit.html'), 'utf-8'), /VIDEOCLAW_REVIEW_DECISIONS/);
      assert.match(await readFile(join(projectDir, 'review.html'), 'utf-8'), /VIDEOCLAW_REVIEW_DECISIONS/);
      assert.match(await readFile(join(projectDir, 'client-review.html'), 'utf-8'), /VIDEOCLAW_CLIENT_FEEDBACK/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('generates a client-filtered portal index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-cli-index-'));
    try {
      const alphaDir = join(root, 'projects', 'alpha');
      const betaDir = join(root, 'projects', 'beta');
      await mkdir(join(alphaDir, 'final'), { recursive: true });
      await mkdir(join(betaDir, 'final'), { recursive: true });
      await writeFile(join(alphaDir, 'project.json'), JSON.stringify({ title: 'Alpha', client: 'Acme', template: 'story-film' }));
      await writeFile(join(betaDir, 'project.json'), JSON.stringify({ title: 'Beta', client: 'Other', template: 'story-film' }));
      await writeFile(join(alphaDir, 'final', 'alpha.mp4'), 'video');
      await writeFile(join(betaDir, 'final', 'beta.mp4'), 'video');

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'portal-index',
        '--root',
        root,
        '--client',
        'Acme',
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { projectCount?: number; outputPath?: string };
      assert.equal(payload.projectCount, 1);
      assert.match(payload.outputPath ?? '', /projects\/clients\/acme\/index\.html$/);
      const html = await readFile(join(root, 'projects', 'clients', 'acme', 'index.html'), 'utf-8');
      assert.match(html, /Alpha/);
      assert.doesNotMatch(html, /Beta/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prints a dry-run publish plan without uploading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-cli-publish-'));
    try {
      const projectDir = join(root, 'projects', 'alpha');
      await mkdir(join(projectDir, 'final'), { recursive: true });
      await writeFile(join(projectDir, 'preview.html'), '<video src="final/alpha.mp4"></video>');
      await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'publish-preview',
        '--project',
        'alpha',
        '--root',
        root,
        '--client',
        'Acme',
        '--bucket',
        'videoclaw-reviews',
        '--public-base-url',
        'https://reviews.example.test',
        '--dry-run',
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        dryRun?: boolean;
        uploaded?: unknown[];
        plan?: { publicUrl?: string; items?: Array<{ remoteKey?: string }> };
      };
      assert.equal(payload.dryRun, true);
      assert.deepEqual(payload.uploaded, []);
      assert.equal(payload.plan?.publicUrl, 'https://reviews.example.test/clients/acme/alpha/runs/run-001/preview.html');
      assert.ok(payload.plan?.items?.some((item) => item.remoteKey === 'clients/acme/alpha/runs/run-001/final/alpha.mp4'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uploads through wrangler and records a publish audit event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-cli-upload-'));
    try {
      const projectDir = join(root, 'projects', 'alpha');
      const binDir = join(root, 'bin');
      const wranglerBin = join(binDir, 'wrangler');
      const wranglerLog = join(root, 'wrangler.log');
      await mkdir(join(projectDir, 'final'), { recursive: true });
      await mkdir(binDir, { recursive: true });
      await writeFile(join(projectDir, 'preview.html'), '<video src="final/alpha.mp4"></video>');
      await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');
      await writeFile(wranglerBin, `#!/bin/sh\nprintf '%s\\n' \"$*\" >> '${wranglerLog}'\n`);
      await chmod(wranglerBin, 0o755);

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'publish-preview',
        '--project',
        'alpha',
        '--root',
        root,
        '--client',
        'Acme',
        '--bucket',
        'videoclaw-reviews',
        '--public-base-url',
        'https://reviews.example.test',
        '--wrangler-bin',
        wranglerBin,
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { dryRun?: boolean; uploaded?: Array<{ remoteKey?: string }> };
      assert.equal(payload.dryRun, false);
      assert.equal(payload.uploaded?.length, 2);
      const log = await readFile(wranglerLog, 'utf-8');
      assert.match(log, /r2 object put videoclaw-reviews\/clients\/acme\/alpha\/runs\/run-001\/preview\.html/);
      assert.match(log, /--content-type text\/html; charset=utf-8 --remote/);
      const audit = await readFile(join(projectDir, 'project-audit.jsonl'), 'utf-8');
      assert.match(audit, /surface.published/);
      assert.match(audit, /https:\/\/reviews\.example\.test\/clients\/acme\/alpha\/runs\/run-001\/preview\.html/);
      assert.match(audit, /"htmlHash":"[a-f0-9]{64}"/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prints a dry-run client index publish plan with Cloudflare run links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-cli-index-publish-'));
    try {
      const alphaDir = join(root, 'projects', 'alpha');
      const betaDir = join(root, 'projects', 'beta');
      await mkdir(join(alphaDir, 'final'), { recursive: true });
      await mkdir(join(betaDir, 'final'), { recursive: true });
      await writeFile(join(alphaDir, 'project.json'), JSON.stringify({ title: 'Alpha', client: 'Acme', template: 'story-film' }));
      await writeFile(join(betaDir, 'project.json'), JSON.stringify({ title: 'Beta', client: 'Acme', template: 'story-film' }));
      await writeFile(join(alphaDir, 'final', 'alpha.mp4'), 'video');
      await writeFile(join(betaDir, 'final', 'beta.mp4'), 'video');

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'publish-portal-index',
        '--root',
        root,
        '--client',
        'Acme',
        '--bucket',
        'videoclaw-reviews',
        '--public-base-url',
        'https://reviews.example.test',
        '--dry-run',
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        dryRun?: boolean;
        uploaded?: unknown[];
        plan?: { publicUrl?: string; items?: Array<{ remoteKey?: string; localPath?: string }> };
      };
      assert.equal(payload.dryRun, true);
      assert.deepEqual(payload.uploaded, []);
      assert.equal(payload.plan?.publicUrl, 'https://reviews.example.test/clients/acme/index.html');
      assert.equal(payload.plan?.items?.[0]?.remoteKey, 'clients/acme/index.html');
      const html = await readFile(payload.plan?.items?.[0]?.localPath ?? '', 'utf-8');
      assert.match(html, /alpha\/runs\/run-001\/preview\.html/);
      assert.match(html, /beta\/runs\/run-001\/preview\.html/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
