import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw artifact-history cli', () => {
  it('shows snapshot history for a written artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-history-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'launch-teaser', '--root', root],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'First intent'],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Second intent']
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const historyResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'artifact-history', '--project', 'launch-teaser', '--artifact', 'brief', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(historyResult.status, 0);
      const payload = JSON.parse(historyResult.stdout) as { historyFiles?: string[] };
      assert.equal(payload.historyFiles?.length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
