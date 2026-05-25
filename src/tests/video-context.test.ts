import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendVideoContextChangelog, ensureVideoContext, resolveVideoContextPaths } from '../video/video-context.js';

describe('video context', () => {
  it('bootstraps the .omx video context with the required sections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-video-context-'));
    try {
      const paths = await ensureVideoContext(root);
      assert.equal(existsSync(paths.omxPath), true);
      const content = await readFile(paths.omxPath, 'utf-8');
      assert.match(content, /## Provider defaults/);
      assert.match(content, /## Winning prompts/);
      assert.match(content, /## Failed prompt patterns/);
      assert.match(content, /## Style presets by brand/);
      assert.match(content, /## Cost\/time benchmarks/);
      assert.match(content, /## Dated changelog/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('seeds .omx from an existing .vclaw context and mirrors changelog updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-video-context-'));
    try {
      const paths = resolveVideoContextPaths(root);
      await mkdir(paths.vclawDir, { recursive: true });
      await writeFile(paths.vclawPath, '# Video Context\n\n## Dated changelog\n- Existing legacy entry.\n');

      await appendVideoContextChangelog(root, '2026-04-20T23:59:00.000Z produce: dry-run-complete for project alpha via seedance-direct.');

      const omxContent = await readFile(paths.omxPath, 'utf-8');
      const vclawContent = await readFile(paths.vclawPath, 'utf-8');
      assert.match(omxContent, /Existing legacy entry/);
      assert.match(omxContent, /produce: dry-run-complete/);
      assert.equal(omxContent, vclawContent);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
