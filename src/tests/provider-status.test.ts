import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProviderStatusReport } from '../video/provider-status.js';

describe('buildProviderStatusReport', () => {
  it('reports available production routes and degraded scaffold routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-video-core-'));
    try {
      const report = buildProviderStatusReport({
        workspaceRoot: root,
        env: {
          USEAPI_API_TOKEN: 'token',
          USEAPI_ACCOUNT_EMAIL: 'email@example.com',
          SUTUI_API_KEY: 'sutui',
        } as NodeJS.ProcessEnv,
        probeExecutable: (name) => `/mock/bin/${name}`,
        now: new Date('2026-04-20T00:00:00.000Z'),
      });

      assert.equal(report.generatedAt, '2026-04-20T00:00:00.000Z');
      assert.ok(report.routes.some((route) => route.routeId === 'veo-useapi' && route.availability === 'available'));
      assert.ok(report.routes.some((route) => route.routeId === 'seedance-direct' && route.availability === 'available'));
      assert.ok(report.routes.some((route) => route.routeId === 'runway-useapi' && route.availability === 'available'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks routes unavailable when prerequisites are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-video-core-'));
    try {
      const report = buildProviderStatusReport({
        workspaceRoot: root,
        env: {} as NodeJS.ProcessEnv,
        probeExecutable: () => undefined,
      });

      const veoUseApi = report.routes.find((route) => route.routeId === 'veo-useapi');
      const seedance = report.routes.find((route) => route.routeId === 'seedance-direct');
      assert.equal(veoUseApi?.availability, 'unavailable');
      assert.equal(seedance?.availability, 'unavailable');
      assert.ok(veoUseApi?.issues.some((issue) => issue.includes('USEAPI_API_TOKEN')));
      assert.ok(seedance?.issues.some((issue) => issue.includes('SUTUI_API_KEY')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps provider status strict unless an execution override is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-video-core-'));
    try {
      const strictReport = buildProviderStatusReport({
        workspaceRoot: root,
        env: {
          USEAPI_API_TOKEN: 'token',
          USEAPI_ACCOUNT_EMAIL: 'email@example.com',
        } as NodeJS.ProcessEnv,
        probeExecutable: (name) => (name === 'python3' ? '/mock/bin/python3' : undefined),
      });
      const strictVeo = strictReport.routes.find((route) => route.routeId === 'veo-useapi');
      assert.equal(strictVeo?.availability, 'unavailable');
      assert.ok(strictVeo?.missingDependencies.includes('bun'));
      assert.ok(strictVeo?.missingDependencies.includes('ffmpeg'));

      const overrideReport = buildProviderStatusReport({
        workspaceRoot: root,
        env: {
          USEAPI_API_TOKEN: 'token',
          USEAPI_ACCOUNT_EMAIL: 'email@example.com',
          VCLAW_VEO_USEAPI_SUBMIT_CMD: 'cat >/dev/null',
        } as NodeJS.ProcessEnv,
        probeExecutable: (name) => (name === 'python3' ? '/mock/bin/python3' : undefined),
      });
      const overrideVeo = overrideReport.routes.find((route) => route.routeId === 'veo-useapi');
      assert.equal(overrideVeo?.availability, 'available');
      assert.deepEqual(overrideVeo?.missingDependencies, []);
      assert.ok(overrideVeo?.notes.some((note) => note.includes('Execution override configured')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
