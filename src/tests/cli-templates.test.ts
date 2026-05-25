import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw template and clone-plan cli', () => {
  it('saves, lists, shows, and uses templates from analyze output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-template-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root],
        ['video', 'analyze', '--project', 'alpha', '--root', root, '--source', 'https://example.com/ref.mp4', '--title', 'Reference Ad', '--pacing', 'fast', '--motion', 'motion-clips', '--beat', 'hook', '--beat', 'demo', '--beat', 'cta', '--keep', 'hook energy', '--change', 'topic', '--var', 'product'],
        ['video', 'template-create', '--project', 'alpha', '--root', root, '--name', 'launch-template'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const listResult = spawnSync(process.execPath, [cliPath, 'video', 'template-list', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(listResult.status, 0);
      const listPayload = JSON.parse(listResult.stdout) as { templates?: string[] };
      assert.deepEqual(listPayload.templates, ['launch-template']);

      const showResult = spawnSync(process.execPath, [cliPath, 'video', 'template-show', '--name', 'launch-template', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(showResult.status, 0);
      const showPayload = JSON.parse(showResult.stdout) as { template?: { name?: string } };
      assert.equal(showPayload.template?.name, 'launch-template');

      const validateResult = spawnSync(process.execPath, [cliPath, 'video', 'template-validate', '--name', 'launch-template', '--root', root], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      assert.equal(validateResult.status, 0);
      const validatePayload = JSON.parse(validateResult.stdout) as { validation?: { templateName?: string; valid?: boolean } };
      assert.equal(validatePayload.validation?.templateName, 'launch-template');
      assert.equal(validatePayload.validation?.valid, true);

      const cloneResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'clone-plan', '--template', 'launch-template', '--project', 'beta', '--intent', 'Make a launch teaser for a smart bottle.', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(cloneResult.status, 0);
      const clonePayload = JSON.parse(cloneResult.stdout) as { templateName?: string; projectSlug?: string; beats?: string[] };
      assert.equal(clonePayload.templateName, 'launch-template');
      assert.equal(clonePayload.projectSlug, 'beta');
      assert.deepEqual(clonePayload.beats, ['hook', 'demo', 'cta']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
