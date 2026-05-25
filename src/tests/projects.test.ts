import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isProjectSlug, listProjects } from '../video/projects.js';

describe('project listing', () => {
  it('lists only valid project slugs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-projects-'));
    try {
      await mkdir(join(root, 'projects', 'fresh-proof'), { recursive: true });
      await mkdir(join(root, 'projects', 'alpha-2'), { recursive: true });
      await mkdir(join(root, 'projects', '--project'), { recursive: true });
      await mkdir(join(root, 'projects', 'Bad_Slug'), { recursive: true });
      await writeFile(join(root, 'projects', 'README.md'), 'not a project');

      assert.equal(isProjectSlug('fresh-proof'), true);
      assert.equal(isProjectSlug('alpha-2'), true);
      assert.equal(isProjectSlug('--project'), false);
      assert.equal(isProjectSlug('Bad_Slug'), false);
      assert.deepEqual(await listProjects(root), ['alpha-2', 'fresh-proof']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
