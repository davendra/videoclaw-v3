import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  submitDreaminaUseApiNative,
  pollDreaminaUseApiNative,
  cancelDreaminaUseApiNative,
} from '../video/native-dreamina.js';

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

interface MockResponseScript {
  responses: Array<{ status?: number; json?: unknown; arrayBuffer?: ArrayBuffer; text?: string }>;
  captured: CapturedRequest[];
}

function makeFetchImpl(script: MockResponseScript) {
  let i = 0;
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => {
    const next = script.responses[i++];
    if (!next) throw new Error(`fetch mock ran out of scripted responses for ${url}`);
    let parsedBody: unknown = null;
    if (init?.body !== undefined) {
      if (typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      } else {
        parsedBody = `<binary:${(init.body as Uint8Array).byteLength}>`;
      }
    }
    script.captured.push({ url, method: init?.method ?? 'GET', body: parsedBody });
    return {
      ok: (next.status ?? 200) >= 200 && (next.status ?? 200) < 300,
      status: next.status ?? 200,
      text: async () => next.text ?? '',
      json: async () => next.json ?? {},
      arrayBuffer: async () => next.arrayBuffer ?? new ArrayBuffer(0),
    };
  };
}

const DREAMINA_ENV = {
  USEAPI_API_TOKEN: 'user:1-sk-test',
  VCLAW_DREAMINA_ACCOUNT: 'CA:ai@3rdeye.co.uk',
  VCLAW_DREAMINA_REGION: 'CA',
} as NodeJS.ProcessEnv;

describe('dreamina-useapi native transport', () => {
  it('submits a seedance-2.0 text-to-video job to the dreamina videos endpoint and persists job state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-dreamina-submit-'));
    try {
      const script: MockResponseScript = {
        responses: [
          // submitDreaminaJob → POST /dreamina/videos
          { json: { jobid: 'j0223-u1-CA:ai@3rdeye.co.uk-bot:dreamina', status: 'created' } },
        ],
        captured: [],
      };

      const result = await submitDreaminaUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'dreamina-useapi',
        operationKind: 'text-to-video',
        executionProfile: {
          aspectRatio: '16:9',
          quality: 'quality',
          resolution: '1080p',
          generateAudio: false,
          outputCount: 1,
        },
        generatedAt: new Date().toISOString(),
        outputDir: join(root, 'outputs'),
        tasks: [
          {
            sceneIndex: 0,
            prompt: 'A serene mountain at dawn.',
            inputKind: 'text',
            referencePaths: [],
            sourceAssetIds: [],
            backendHints: [],
            characters: [],
            durationSeconds: 5,
          },
        ],
        promptGuidance: [],
      }, {
        env: DREAMINA_ENV,
        fetchImpl: makeFetchImpl(script),
      });

      assert.ok(result.externalJobId.startsWith('dreamina-useapi-'));

      // verify submit posted to the dreamina create URL with the right body
      const submitRequest = script.captured[0];
      assert.equal(submitRequest.method, 'POST');
      assert.ok(submitRequest.url.endsWith('/dreamina/videos'));
      const body = submitRequest.body as Record<string, unknown>;
      assert.equal(body.model, 'seedance-2.0');
      assert.equal(body.prompt, 'A serene mountain at dawn.');
      assert.equal(body.account, 'CA:ai@3rdeye.co.uk');
      assert.equal(body.ratio, '16:9');
      assert.equal(body.resolution, '1080p');
      assert.equal(body.duration, 5);
      // text-to-video must NOT carry a keyframe field
      assert.equal('firstFrameRef' in body, false);

      // verify state was persisted
      const statePath = join(root, 'outputs', '.vclaw-jobs', `${result.externalJobId}.json`);
      const state = JSON.parse(await readFile(statePath, 'utf-8'));
      assert.equal(state.routeId, 'dreamina-useapi');
      assert.equal(state.scenes.length, 1);
      assert.equal(state.scenes[0].jobid, 'j0223-u1-CA:ai@3rdeye.co.uk-bot:dreamina');
      assert.equal(state.scenes[0].status, 'submitted');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uploads a local image keyframe and wires it as firstFrameRef (image-to-video first_frame mode)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-dreamina-keyframe-'));
    try {
      const imagePath = join(root, 'frame.png');
      await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const script: MockResponseScript = {
        responses: [
          // 1. upload asset → POST /dreamina/assets/<account>
          { json: { assetRef: 'CA:ai@3rdeye.co.uk-image:w685:h900:s86866-uri:tos/abc123', width: 685, height: 900 } },
          // 2. submit job → POST /dreamina/videos
          { json: { jobid: 'j0223-u1-i2v-bot:dreamina', status: 'created' } },
        ],
        captured: [],
      };

      await submitDreaminaUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'dreamina-useapi',
        operationKind: 'image-to-video',
        executionProfile: {
          aspectRatio: '9:16',
          quality: 'quality',
          resolution: '1080p',
          generateAudio: false,
          outputCount: 1,
        },
        generatedAt: new Date().toISOString(),
        outputDir: join(root, 'outputs'),
        tasks: [
          {
            sceneIndex: 2,
            prompt: 'Continue from this frame.',
            inputKind: 'image',
            referencePaths: [imagePath],
            sourceAssetIds: [],
            backendHints: [],
            characters: [],
            durationSeconds: 5,
          },
        ],
        promptGuidance: [],
      }, {
        env: DREAMINA_ENV,
        fetchImpl: makeFetchImpl(script),
      });

      // First call was the asset upload to the account-scoped assets endpoint.
      const uploadRequest = script.captured[0];
      assert.equal(uploadRequest.method, 'POST');
      assert.ok(uploadRequest.url.includes('/dreamina/assets/'));
      // account is URL-encoded in the path
      assert.ok(uploadRequest.url.includes(encodeURIComponent('CA:ai@3rdeye.co.uk')));
      // raw binary body (not JSON)
      assert.match(String(uploadRequest.body), /^<binary:/);

      // Second call was the create-video submit wiring the uploaded assetRef
      // as firstFrameRef. In first_frame mode ratio is auto-detected, so we
      // must NOT send ratio.
      const submitRequest = script.captured[1];
      assert.ok(submitRequest.url.endsWith('/dreamina/videos'));
      const submitBody = submitRequest.body as Record<string, unknown>;
      assert.equal(submitBody.firstFrameRef, 'CA:ai@3rdeye.co.uk-image:w685:h900:s86866-uri:tos/abc123');
      assert.equal('ratio' in submitBody, false);
      assert.equal(submitBody.duration, 5);
      assert.equal(submitBody.resolution, '1080p');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('polls a completed job, downloads response.videoUrl, and reports completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-dreamina-poll-'));
    try {
      const submitScript: MockResponseScript = {
        responses: [
          { json: { jobid: 'job-poll-1', status: 'created' } },
        ],
        captured: [],
      };
      const submitResult = await submitDreaminaUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'dreamina-useapi',
        operationKind: 'text-to-video',
        executionProfile: {
          aspectRatio: '16:9',
          quality: 'quality',
          resolution: '720p',
          generateAudio: false,
          outputCount: 1,
        },
        generatedAt: new Date().toISOString(),
        outputDir: join(root, 'outputs'),
        tasks: [
          {
            sceneIndex: 0,
            prompt: 'A wave crashes.',
            inputKind: 'text',
            referencePaths: [],
            sourceAssetIds: [],
            backendHints: [],
            characters: [],
            durationSeconds: 5,
          },
        ],
        promptGuidance: [],
      }, {
        env: DREAMINA_ENV,
        fetchImpl: makeFetchImpl(submitScript),
      });

      // Poll: first call returns completed with response.videoUrl; second call
      // downloads the mp4.
      const pollScript: MockResponseScript = {
        responses: [
          {
            json: {
              jobid: 'job-poll-1',
              status: 'completed',
              response: { videoUrl: 'https://cdn.test/scene-0.mp4', coverUrl: 'https://cdn.test/cover0.jpg' },
            },
          },
          { arrayBuffer: new TextEncoder().encode('fake-mp4-bytes').buffer as ArrayBuffer },
        ],
        captured: [],
      };

      const pollResult = await pollDreaminaUseApiNative({
        outputDir: join(root, 'outputs'),
        externalJobId: submitResult.externalJobId,
        workspaceRoot: root,
      }, {
        env: DREAMINA_ENV,
        fetchImpl: makeFetchImpl(pollScript),
      });

      // poll hit GET /dreamina/videos/<jobid>
      assert.ok(pollScript.captured[0].url.endsWith('/dreamina/videos/job-poll-1'));
      assert.equal(pollScript.captured[0].method, 'GET');

      assert.equal(pollResult.status, 'completed');
      assert.equal(pollResult.outputs.length, 1);
      assert.equal(pollResult.outputs[0].kind, 'video');
      assert.equal(pollResult.outputs[0].backend, 'dreamina-useapi');
      assert.ok(pollResult.outputs[0].path.endsWith('scene-0.mp4'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports pending while the job status is still "created"', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-dreamina-pending-'));
    try {
      const submitScript: MockResponseScript = {
        responses: [{ json: { jobid: 'job-pending-1', status: 'created' } }],
        captured: [],
      };
      const submitResult = await submitDreaminaUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'dreamina-useapi',
        operationKind: 'text-to-video',
        executionProfile: {
          aspectRatio: '16:9',
          quality: 'quality',
          resolution: '720p',
          generateAudio: false,
          outputCount: 1,
        },
        generatedAt: new Date().toISOString(),
        outputDir: join(root, 'outputs'),
        tasks: [
          {
            sceneIndex: 0,
            prompt: 'Still cooking.',
            inputKind: 'text',
            referencePaths: [],
            sourceAssetIds: [],
            backendHints: [],
            characters: [],
            durationSeconds: 5,
          },
        ],
        promptGuidance: [],
      }, {
        env: DREAMINA_ENV,
        fetchImpl: makeFetchImpl(submitScript),
      });

      const pollScript: MockResponseScript = {
        responses: [{ json: { jobid: 'job-pending-1', status: 'created' } }],
        captured: [],
      };
      const pollResult = await pollDreaminaUseApiNative({
        outputDir: join(root, 'outputs'),
        externalJobId: submitResult.externalJobId,
        workspaceRoot: root,
      }, {
        env: DREAMINA_ENV,
        fetchImpl: makeFetchImpl(pollScript),
      });

      assert.equal(pollResult.status, 'pending');
      assert.equal(pollResult.outputs.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cancel marks submitted scenes failed locally and warns about remote jobs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-dreamina-cancel-'));
    try {
      const submitScript: MockResponseScript = {
        responses: [{ json: { jobid: 'job-c1', status: 'created' } }],
        captured: [],
      };
      const submitResult = await submitDreaminaUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'dreamina-useapi',
        operationKind: 'text-to-video',
        executionProfile: {
          aspectRatio: '16:9',
          quality: 'quality',
          resolution: '720p',
          generateAudio: false,
          outputCount: 1,
        },
        generatedAt: new Date().toISOString(),
        outputDir: join(root, 'outputs'),
        tasks: [
          {
            sceneIndex: 0,
            prompt: 'Cancel me.',
            inputKind: 'text',
            referencePaths: [],
            sourceAssetIds: [],
            backendHints: [],
            characters: [],
          },
        ],
        promptGuidance: [],
      }, {
        env: DREAMINA_ENV,
        fetchImpl: makeFetchImpl(submitScript),
      });

      const result = await cancelDreaminaUseApiNative({
        outputDir: join(root, 'outputs'),
        externalJobId: submitResult.externalJobId,
        workspaceRoot: root,
      });

      assert.equal(result.status, 'cancelled');
      assert.equal(result.externalJobId, submitResult.externalJobId);
      assert.ok(result.issues.some((issue) => issue.includes('no UseAPI cancel endpoint')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
