import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('vclaw library clean cli', () => {
  it('supports dry-run patch mode for Go Bananas library cleanup', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'video',
        'library',
        'clean',
        '--patch',
        '247',
        '--base-prompt',
        'Mochi is a small fluffy white rabbit with clean concise prompt text.',
        '--dry-run',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        env: {
          ...process.env,
          GO_BANANAS_API_KEY: 'token',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /PATCH \/characters\/247 base_prompt/);
    assert.match(result.stdout, /\(dry-run\)/);
  });

  it('shows library help when the subcommand is missing', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
    const result = spawnSync(process.execPath, [cliPath, 'video', 'library'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown video library subcommand/);
    assert.match(result.stderr, /vclaw video library clean \[options\]/);
  });
});
