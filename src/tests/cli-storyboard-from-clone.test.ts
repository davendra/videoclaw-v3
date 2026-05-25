import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw storyboard-from-clone cli', () => {
  it('materializes a storyboard artifact from a saved clone plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-clone-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'analyze', '--project', 'alpha', '--root', root, '--source', 'https://example.com/ref.mp4', '--title', 'Reference Ad', '--pacing', 'fast', '--motion', 'motion-clips', '--beat', 'hook', '--beat', 'demo', '--beat', 'cta', '--keep', 'hook energy', '--change', 'topic', '--var', 'product'],
        ['video', 'template-save', '--project', 'alpha', '--root', root, '--name', 'launch-template'],
        ['video', 'clone-init', '--template', 'launch-template', '--project', 'beta', '--intent', 'Make a launch teaser for a smart bottle.', '--root', root],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const storyboardResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'storyboard-from-clone', '--project', 'beta', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(storyboardResult.status, 0);
      const payload = JSON.parse(storyboardResult.stdout) as { artifactPath?: string };
      const storyboard = JSON.parse(await readFile(payload.artifactPath!, 'utf-8')) as { scenes?: Array<{ description?: string }> };
      assert.equal(storyboard.scenes?.length, 3);
      assert.match(String(storyboard.scenes?.[0]?.description), /hook/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
