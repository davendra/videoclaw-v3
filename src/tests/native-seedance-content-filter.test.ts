import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { submitSeedanceDirectNative } from '../video/native-seedance.js';
import { sanitizePrompt } from '../video/seedance-content-filter.js';
import type { VideoExecutionPayload } from '../video/types.js';

interface CapturedCreate {
  url: string;
  body: { params?: { prompt?: string } };
}

interface FakeFetchResult {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function successResponse(taskId: string): FakeFetchResult {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ data: { task_id: taskId } }),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function violationResponse(): FakeFetchResult {
  // xskill returns a non-2xx HTTP with a body carrying error code 2038. postJson
  // turns this into a thrown Error whose message contains the body text, which
  // isContentViolation() detects.
  return {
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ code: 400, message: 'content violates regulations, error code: 2038' }),
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function buildPayload(root: string, outputDir: string, prompt: string): VideoExecutionPayload {
  return {
    workspaceRoot: root,
    routeId: 'seedance-direct',
    projectSlug: 'alpha',
    executionProfile: {
      aspectRatio: '9:16',
      quality: 'quality',
      resolution: '1080p',
      generateAudio: false,
    },
    outputDir,
    tasks: [
      {
        sceneIndex: 0,
        prompt,
        referencePaths: [],
      },
    ],
    promptGuidance: [],
  } as unknown as VideoExecutionPayload;
}

describe('seedance-direct content-filter retry-with-sanitization', () => {
  it('retries with a level-1 sanitized prompt after a 2038 content violation, then succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-seedance-cf-retry-'));
    const outputDir = join(root, 'out');
    try {
      // A prompt that the level-1 sanitizer will actually change (celebrity/IP +
      // marketing superlative), so we can assert the resubmission carried the
      // sanitized text rather than the original.
      const originalPrompt = 'Cinematic shot of Spider-Man in a revolutionary premium scene, dolly in';
      const creates: CapturedCreate[] = [];
      let createCalls = 0;

      const fakeFetch = (async (url: string, init?: { body?: string }) => {
        if (url.endsWith('/api/v3/tasks/create')) {
          createCalls += 1;
          const body = init?.body ? (JSON.parse(init.body) as CapturedCreate['body']) : {};
          creates.push({ url, body });
          // First create attempt fails with a 2038 content violation; the
          // sanitized retry succeeds.
          if (createCalls === 1) {
            return violationResponse();
          }
          return successResponse('task-after-sanitize');
        }
        throw new Error(`unexpected fetch to ${url}`);
      }) as unknown as NonNullable<Parameters<typeof submitSeedanceDirectNative>[1]>['fetchImpl'];

      const env = { ...process.env, SUTUI_API_KEY: 'test-key' };
      const result = await submitSeedanceDirectNative(buildPayload(root, outputDir, originalPrompt), {
        env,
        fetchImpl: fakeFetch,
      });

      // Two create POSTs: the original (rejected) and the sanitized retry.
      assert.equal(createCalls, 2, 'expected exactly two create attempts');
      assert.equal(creates[0]?.body.params?.prompt, originalPrompt, 'first attempt uses the original prompt unchanged');

      const expectedSanitized = sanitizePrompt(originalPrompt, 1);
      assert.notEqual(expectedSanitized, originalPrompt, 'sanitizer must materially change this prompt');
      assert.equal(
        creates[1]?.body.params?.prompt,
        expectedSanitized,
        'retry re-submits with the level-1 sanitized prompt',
      );

      // The job ultimately submitted (task id from the successful retry).
      const raw = result.rawResult as { submittedScenes?: Array<{ taskId?: string }> };
      assert.equal(raw.submittedScenes?.[0]?.taskId, 'task-after-sanitize');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('escalates to a level-2 sanitized prompt when the level-1 retry also violates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-seedance-cf-escalate-'));
    const outputDir = join(root, 'out');
    try {
      const originalPrompt = 'Spider-Man child stands in a premium room, slow dolly push in across the table';
      const creates: CapturedCreate[] = [];
      let createCalls = 0;

      const fakeFetch = (async (url: string, init?: { body?: string }) => {
        if (url.endsWith('/api/v3/tasks/create')) {
          createCalls += 1;
          const body = init?.body ? (JSON.parse(init.body) as CapturedCreate['body']) : {};
          creates.push({ url, body });
          // First two attempts (original + level-1) both violate; level-2 succeeds.
          if (createCalls <= 2) {
            return violationResponse();
          }
          return successResponse('task-after-level2');
        }
        throw new Error(`unexpected fetch to ${url}`);
      }) as unknown as NonNullable<Parameters<typeof submitSeedanceDirectNative>[1]>['fetchImpl'];

      const env = { ...process.env, SUTUI_API_KEY: 'test-key' };
      const result = await submitSeedanceDirectNative(buildPayload(root, outputDir, originalPrompt), {
        env,
        fetchImpl: fakeFetch,
      });

      assert.equal(createCalls, 3, 'expected three create attempts (original + L1 + L2)');
      assert.equal(creates[1]?.body.params?.prompt, sanitizePrompt(originalPrompt, 1));
      assert.equal(creates[2]?.body.params?.prompt, sanitizePrompt(originalPrompt, 2));

      const raw = result.rawResult as { submittedScenes?: Array<{ taskId?: string }> };
      assert.equal(raw.submittedScenes?.[0]?.taskId, 'task-after-level2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('submits a clean prompt exactly once, unchanged (no behavior change without a violation)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-seedance-cf-clean-'));
    const outputDir = join(root, 'out');
    try {
      const cleanPrompt = 'Wide cinematic shot of a windswept ridge at golden hour, slow dolly push in';
      const creates: CapturedCreate[] = [];
      let createCalls = 0;

      const fakeFetch = (async (url: string, init?: { body?: string }) => {
        if (url.endsWith('/api/v3/tasks/create')) {
          createCalls += 1;
          const body = init?.body ? (JSON.parse(init.body) as CapturedCreate['body']) : {};
          creates.push({ url, body });
          return successResponse('task-clean');
        }
        throw new Error(`unexpected fetch to ${url}`);
      }) as unknown as NonNullable<Parameters<typeof submitSeedanceDirectNative>[1]>['fetchImpl'];

      const env = { ...process.env, SUTUI_API_KEY: 'test-key' };
      await submitSeedanceDirectNative(buildPayload(root, outputDir, cleanPrompt), {
        env,
        fetchImpl: fakeFetch,
      });

      assert.equal(createCalls, 1, 'clean prompt submits exactly once');
      assert.equal(creates[0]?.body.params?.prompt, cleanPrompt, 'clean prompt is submitted unchanged');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not retry on a non-content-violation submit failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-seedance-cf-nonviolation-'));
    const outputDir = join(root, 'out');
    try {
      const prompt = 'Wide cinematic shot of a windswept ridge at golden hour';
      let createCalls = 0;

      const fakeFetch = (async (url: string) => {
        if (url.endsWith('/api/v3/tasks/create')) {
          createCalls += 1;
          return {
            ok: false,
            status: 500,
            text: async () => 'internal server error',
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          } as FakeFetchResult;
        }
        throw new Error(`unexpected fetch to ${url}`);
      }) as unknown as NonNullable<Parameters<typeof submitSeedanceDirectNative>[1]>['fetchImpl'];

      const env = { ...process.env, SUTUI_API_KEY: 'test-key' };
      await assert.rejects(
        submitSeedanceDirectNative(buildPayload(root, outputDir, prompt), { env, fetchImpl: fakeFetch }),
        /HTTP 500/,
      );
      assert.equal(createCalls, 1, 'a non-content-violation failure is not retried');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
