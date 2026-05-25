import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw verify-env cli', () => {
  it('prints a machine-readable environment report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-verify-env-cli-'));
    try {
      await writeFile(join(root, '.env'), [
        'GOOGLE_API_KEY=test-google',
        'GO_BANANAS_API_KEY=test-gb',
        'SUTUI_API_KEY=test-sutui',
      ].join('\n'));
      await mkdir(join(root, 'dist', 'cli'), { recursive: true });
      await writeFile(join(root, 'dist', 'cli', 'vclaw.js'), '#!/usr/bin/env node\n');

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'verify-env', '--root', root],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ELEVENLABS_API_KEY: 'test-eleven',
            GEMINI_API_KEYS: 'key-one,key-two,key-three',
          },
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        workspaceRoot?: string;
        geminiKeyPool?: { count?: number };
        envVars?: Array<{ name?: string; present?: boolean }>;
        build?: { exists?: boolean };
        providers?: { routes?: Array<{ routeId?: string }> };
      };

      assert.equal(payload.workspaceRoot, root);
      assert.equal(payload.geminiKeyPool?.count, 4);
      assert.equal(payload.build?.exists, true);
      assert.ok(payload.envVars?.some((item) => item.name === 'GOOGLE_API_KEY' && item.present));
      assert.ok(payload.providers?.routes?.some((route) => route.routeId === 'seedance-direct'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
