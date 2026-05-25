import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw archive-project cli', () => {
  it('archives a project directory into a tarball', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-archive-project-'));
    try {
      const projectDir = join(root, 'projects', 'alpha');
      await mkdir(join(projectDir, 'artifacts'), { recursive: true });
      await writeFile(join(projectDir, 'artifacts', 'brief.json'), '{"ok":true}\n');

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'archive-project', '--project', 'alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        archivePath?: string;
        cleanedUp?: boolean;
      };

      assert.equal(payload.cleanedUp, false);
      assert.ok(existsSync(payload.archivePath ?? ''));
      const listResult = spawnSync('tar', ['-tzf', payload.archivePath!], { encoding: 'utf-8' });
      assert.equal(listResult.status, 0, listResult.stderr);
      assert.match(listResult.stdout, /alpha\/artifacts\/brief\.json/);
      assert.equal(existsSync(projectDir), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
