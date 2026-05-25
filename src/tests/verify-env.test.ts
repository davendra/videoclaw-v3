import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildVideoEnvironmentReport } from '../video/verify-env.js';

describe('verify env', () => {
  it('reports required vars, gemini pool size, dependencies, and build freshness', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-verify-env-'));
    try {
      await writeFile(join(root, '.env'), [
        'GOOGLE_API_KEY=test-google',
        'GO_BANANAS_API_KEY=test-gb',
        'SUTUI_API_KEY=test-sutui',
        'GEMINI_API_KEYS=key-one,key-two,key-three',
        'ELEVENLABS_API_KEY=test-eleven',
      ].join('\n'));
      await mkdir(join(root, 'dist', 'cli'), { recursive: true });
      await writeFile(join(root, 'dist', 'cli', 'vclaw.js'), '#!/usr/bin/env node\n');
      await mkdir(join(root, 'vclaw-cli'), { recursive: true });
      await writeFile(join(root, 'vclaw-cli', 'cookie.json'), '{"session":"ok"}');

      const report = buildVideoEnvironmentReport({
        workspaceRoot: root,
        env: {},
        now: new Date('2026-04-21T12:00:00.000Z'),
        probeExecutable: (name) => `/usr/local/bin/${name}`,
      });

      assert.equal(report.ok, true);
      assert.equal(report.geminiKeyPool.count, 4);
      assert.equal(report.geminiKeyPool.ok, true);
      assert.ok(report.envVars.some((item) => item.name === 'GOOGLE_API_KEY' && item.present));
      assert.ok(report.envVars.some((item) => item.name === 'GO_BANANAS_API_KEY' && item.present));
      assert.ok(report.envVars.some((item) => item.name === 'SUTUI_API_KEY' && item.present));
      assert.ok(report.localDependencies.every((item) => item.available));
      assert.equal(report.build.exists, true);
      assert.equal(report.build.fresh, true);
      assert.ok(report.providers.routes.some((route) => route.routeId === 'seedance-direct' && route.availability === 'available'));
      assert.ok(report.blockingIssues.length === 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags missing required inputs and stale build output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-verify-env-'));
    try {
      const report = buildVideoEnvironmentReport({
        workspaceRoot: root,
        env: {},
        now: new Date('2026-04-21T12:00:00.000Z'),
        probeExecutable: (name) => ['node', 'npm', 'python3', 'ffmpeg', 'ffprobe', 'curl'].includes(name) ? `/usr/local/bin/${name}` : undefined,
      });

      assert.equal(report.ok, false);
      assert.ok(report.blockingIssues.some((item) => item.includes('GOOGLE_API_KEY')));
      assert.ok(report.blockingIssues.some((item) => item.includes('GO_BANANAS_API_KEY')));
      assert.ok(report.blockingIssues.some((item) => item.includes('SUTUI_API_KEY')));
      assert.ok(report.blockingIssues.some((item) => item.includes('dist/cli/vclaw.js')));
      assert.ok(report.warnings.some((item) => item.includes('Gemini key pool')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
