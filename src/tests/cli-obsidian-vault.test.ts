import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw scaffold-obsidian-vault cli', () => {
  it('creates a reusable Obsidian vault structure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-vault-'));
    const outputDir = join(root, 'vault');
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'scaffold-obsidian-vault', '--output-dir', outputDir],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { dashboardPath?: string; templatesDir?: string; viewsDir?: string };
      const dashboard = await readFile(payload.dashboardPath!, 'utf-8');
      const template = await readFile(join(payload.templatesDir!, 'Project Template.md'), 'utf-8');
      const runbook = await readFile(join(payload.viewsDir!, 'Operations Runbook.md'), 'utf-8');
      assert.match(dashboard, /Production Dashboard/);
      assert.match(template, /ops_status:/);
      assert.match(runbook, /Core workflow/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
