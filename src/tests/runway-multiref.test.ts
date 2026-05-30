import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  submitRunwayJob,
  RUNWAY_MAX_IMAGE_REFS,
  type RunwayFetchLike,
} from '../video/providers/runway-useapi.js';
import { submitRunwayUseApiNative } from '../video/native-runway.js';
import type { VideoExecutionPayload } from '../video/types.js';

/**
 * Minimal fetch capture that records every request body and returns a canned
 * task id from the submit endpoint. No real network calls.
 */
function captureSubmitFetch(): { fetchImpl: RunwayFetchLike; bodies: Array<Record<string, unknown>>; urls: string[] } {
  const bodies: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  const fetchImpl: RunwayFetchLike = async (url, init) => {
    urls.push(url);
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ task: { taskId: 'user:1-runwayml:e@x:task:uuid-1' } }),
    };
  };
  return { fetchImpl, bodies, urls };
}

test('submitRunwayJob seedance-2 multi-ref emits imageAssetId1..N and NO startFrameAssetId', async () => {
  const { fetchImpl, bodies } = captureSubmitFetch();
  await submitRunwayJob({
    apiToken: 'tok',
    model: 'seedance-2.0',
    textPrompt: 'two stylized characters facing off',
    mode: 'explore',
    seconds: 8,
    aspectRatio: '16:9',
    imageAssetIds: ['asset-a', 'asset-b', 'asset-c'],
    fetchImpl,
  });
  const body = bodies[0];
  assert.equal(body.imageAssetId1, 'asset-a');
  assert.equal(body.imageAssetId2, 'asset-b');
  assert.equal(body.imageAssetId3, 'asset-c');
  assert.equal(body.imageAssetId4, undefined);
  assert.ok(!('startFrameAssetId' in body), 'multi-ref must NOT set startFrameAssetId');
  assert.equal(body.model, 'seedance-2');
});

test('submitRunwayJob seedance-2 with exactly one explicit startFrameAssetId is unchanged (single keyframe)', async () => {
  const { fetchImpl, bodies } = captureSubmitFetch();
  await submitRunwayJob({
    apiToken: 'tok',
    model: 'seedance-2.0',
    textPrompt: 'single character',
    mode: 'explore',
    seconds: 8,
    startFrameAssetId: 'kf-1',
    fetchImpl,
  });
  const body = bodies[0];
  assert.equal(body.startFrameAssetId, 'kf-1');
  assert.ok(!('imageAssetId1' in body), 'single keyframe must NOT emit imageAssetId1');
});

test('submitRunwayJob seedance-2 with a single imageAssetId routes to startFrameAssetId (no multi-ref fields)', async () => {
  const { fetchImpl, bodies } = captureSubmitFetch();
  await submitRunwayJob({
    apiToken: 'tok',
    model: 'seedance-2.0',
    textPrompt: 'single character',
    mode: 'explore',
    seconds: 8,
    imageAssetIds: ['only-one'],
    fetchImpl,
  });
  const body = bodies[0];
  assert.equal(body.startFrameAssetId, 'only-one');
  assert.ok(!('imageAssetId1' in body), 'one image must NOT emit imageAssetId1');
});

test('submitRunwayJob seedance-2 multi-ref maps videos to videoAssetId/2/3', async () => {
  const { fetchImpl, bodies } = captureSubmitFetch();
  await submitRunwayJob({
    apiToken: 'tok',
    model: 'seedance-2.0',
    textPrompt: 'refs',
    mode: 'explore',
    seconds: 8,
    imageAssetIds: ['a', 'b'],
    videoAssetIds: ['v1', 'v2', 'v3'],
    fetchImpl,
  });
  const body = bodies[0];
  assert.equal(body.videoAssetId, 'v1');
  assert.equal(body.videoAssetId2, 'v2');
  assert.equal(body.videoAssetId3, 'v3');
});

test('submitRunwayJob rejects >11 image refs with a preflight error', async () => {
  const { fetchImpl } = captureSubmitFetch();
  const tooMany = Array.from({ length: RUNWAY_MAX_IMAGE_REFS + 1 }, (_, i) => `a${i}`);
  await assert.rejects(
    () =>
      submitRunwayJob({
        apiToken: 'tok',
        model: 'seedance-2.0',
        textPrompt: 'too many',
        mode: 'explore',
        seconds: 8,
        imageAssetIds: tooMany,
        fetchImpl,
      }),
    /at most 11 image refs/,
  );
});

test('submitRunwayJob rejects >3 video refs in multi-ref mode', async () => {
  const { fetchImpl } = captureSubmitFetch();
  await assert.rejects(
    () =>
      submitRunwayJob({
        apiToken: 'tok',
        model: 'seedance-2.0',
        textPrompt: 'too many videos',
        mode: 'explore',
        seconds: 8,
        imageAssetIds: ['a', 'b'],
        videoAssetIds: ['v1', 'v2', 'v3', 'v4'],
        fetchImpl,
      }),
    /at most 3 video refs/,
  );
});

// ---- native-runway integration (injected fetch; no network) ----

interface NativeFetchState {
  uploadCount: number;
  submitBodies: Array<Record<string, unknown>>;
}

function nativeFetch(state: NativeFetchState) {
  return async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }> => {
    if (url.includes('/runwayml/assets')) {
      state.uploadCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ assetId: `uploaded-${state.uploadCount}` }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    if (url.includes('/runwayml/videos/create')) {
      state.submitBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ task: { taskId: `task-${state.submitBodies.length}` } }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    throw new Error(`unexpected fetch url in test: ${url}`);
  };
}

async function makePayload(referencePaths: string[]): Promise<{ payload: VideoExecutionPayload; refDir: string }> {
  const refDir = await mkdtemp(join(tmpdir(), 'runway-refs-'));
  const outDir = await mkdtemp(join(tmpdir(), 'runway-out-'));
  // Write the referenced local image files so readReferenceBytes resolves them.
  const { writeFile } = await import('node:fs/promises');
  for (const p of referencePaths) {
    if (!p.startsWith('Asset://')) await writeFile(p, Buffer.from('img'));
  }
  const payload = {
    workspaceRoot: refDir,
    outputDir: outDir,
    executionProfile: { aspectRatio: '16:9' },
    tasks: [
      { sceneIndex: 0, prompt: 'two characters', referencePaths, durationSeconds: 8 },
    ],
  } as unknown as VideoExecutionPayload;
  return { payload, refDir };
}

test('native: multiple image referencePaths => N uploads => imageAssetId1..N and NO startFrameAssetId', async () => {
  const refDir = await mkdtemp(join(tmpdir(), 'runway-in-'));
  const a = join(refDir, 'a.png');
  const b = join(refDir, 'b.png');
  const c = join(refDir, 'c.png');
  const { payload } = await makePayload([a, b, c]);
  const state: NativeFetchState = { uploadCount: 0, submitBodies: [] };
  await submitRunwayUseApiNative(payload, {
    env: { USEAPI_API_TOKEN: 'tok', VCLAW_RUNWAY_MODEL: 'seedance-2.0' },
    fetchImpl: nativeFetch(state),
  });
  assert.equal(state.uploadCount, 3, 'all three images uploaded');
  const body = state.submitBodies[0];
  assert.equal(body.imageAssetId1, 'uploaded-1');
  assert.equal(body.imageAssetId2, 'uploaded-2');
  assert.equal(body.imageAssetId3, 'uploaded-3');
  assert.ok(!('startFrameAssetId' in body), 'multi-ref must NOT set startFrameAssetId');
});

test('native: exactly one image referencePath => single upload => startFrameAssetId only (unchanged)', async () => {
  const refDir = await mkdtemp(join(tmpdir(), 'runway-in1-'));
  const a = join(refDir, 'a.png');
  const { payload } = await makePayload([a]);
  const state: NativeFetchState = { uploadCount: 0, submitBodies: [] };
  await submitRunwayUseApiNative(payload, {
    env: { USEAPI_API_TOKEN: 'tok', VCLAW_RUNWAY_MODEL: 'seedance-2.0' },
    fetchImpl: nativeFetch(state),
  });
  assert.equal(state.uploadCount, 1);
  const body = state.submitBodies[0];
  assert.equal(body.startFrameAssetId, 'uploaded-1');
  assert.ok(!('imageAssetId1' in body));
});

test('native: Asset:// references are skipped (not uploaded) for Runway', async () => {
  const refDir = await mkdtemp(join(tmpdir(), 'runway-inA-'));
  const a = join(refDir, 'a.png');
  const { payload } = await makePayload(['Asset://avatar-1', a]);
  const state: NativeFetchState = { uploadCount: 0, submitBodies: [] };
  const result = await submitRunwayUseApiNative(payload, {
    env: { USEAPI_API_TOKEN: 'tok', VCLAW_RUNWAY_MODEL: 'seedance-2.0' },
    fetchImpl: nativeFetch(state),
  });
  assert.equal(state.uploadCount, 1, 'only the real file uploaded; Asset:// skipped');
  const body = state.submitBodies[0];
  // One usable image => single keyframe path.
  assert.equal(body.startFrameAssetId, 'uploaded-1');
  const raw = result.rawResult as { warnings?: string[] };
  assert.ok((raw.warnings ?? []).some((w) => w.includes('Asset://')), 'skip note recorded');
});

test('native: >11 image referencePaths => preflight error (no submit)', async () => {
  const refDir = await mkdtemp(join(tmpdir(), 'runway-in12-'));
  const paths: string[] = [];
  for (let i = 0; i < 12; i += 1) paths.push(join(refDir, `r${i}.png`));
  const { payload } = await makePayload(paths);
  const state: NativeFetchState = { uploadCount: 0, submitBodies: [] };
  await assert.rejects(
    () =>
      submitRunwayUseApiNative(payload, {
        env: { USEAPI_API_TOKEN: 'tok', VCLAW_RUNWAY_MODEL: 'seedance-2.0' },
        fetchImpl: nativeFetch(state),
      }),
    /exceed the Runway cap of 11/,
  );
  assert.equal(state.submitBodies.length, 0, 'must not submit when over budget');
  // Touch unused imports so lint/strict stays clean.
  void readFile;
  void readdir;
});
