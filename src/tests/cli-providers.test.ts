import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw cli', () => {
  it('prints help text with the current command surface', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
    const result = spawnSync(process.execPath, [cliPath], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /set-execution-profile/);
    assert.match(result.stdout, /prompt-lib-list/);
    assert.match(result.stdout, /clone-execute/);
    assert.match(result.stdout, /video plan/);
    assert.match(result.stdout, /video produce/);
    assert.match(result.stdout, /execute-status/);
    assert.match(result.stdout, /execute-cancel/);
    assert.match(result.stdout, /review-ui --project/);
    assert.match(result.stdout, /review-autopilot --project/);
    assert.match(result.stdout, /verify-env/);
    assert.match(result.stdout, /video auto/);
    assert.match(result.stdout, /run-pipeline/);
    assert.match(result.stdout, /video approve/);
    assert.match(result.stdout, /remix-narrated/);
    assert.match(result.stdout, /verify-final/);
    assert.match(result.stdout, /make-vertical/);
    assert.match(result.stdout, /make-square/);
    assert.match(result.stdout, /make-loop/);
    assert.match(result.stdout, /thumbnail/);
    assert.match(result.stdout, /video iterate/);
    assert.match(result.stdout, /find-library/);
    assert.match(result.stdout, /character-auto-create/);
    assert.match(result.stdout, /character-import-library/);
    assert.match(result.stdout, /list-library/);
  });

  it('prints provider report JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      assert.equal(existsSync(cliPath), true);

      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'providers', '--workspace-root', root],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            USEAPI_API_TOKEN: 'token',
            USEAPI_ACCOUNT_EMAIL: 'email@example.com',
            SUTUI_API_KEY: 'sutui',
          },
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout) as { routes?: Array<{ routeId?: string }> };
      assert.ok(payload.routes?.some((route) => route.routeId === 'veo-useapi'));
      assert.ok(payload.routes?.some((route) => route.routeId === 'seedance-direct'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
