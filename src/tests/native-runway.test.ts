import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  submitRunwayUseApiNative,
  pollRunwayUseApiNative,
  cancelRunwayUseApiNative,
} from '../video/native-runway.js';

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

describe('runway-useapi native transport', () => {
  it('submits a seedance-2.0 job and writes resumable job state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-runway-submit-'));
    try {
      const script: MockResponseScript = {
        responses: [
          // submitRunwayJob → POST /runwayml/videos/create
          { json: { task: { taskId: 'user:1-runwayml:e@x:task:abc' }, code: 200 } },
        ],
        captured: [],
      };

      const result = await submitRunwayUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'runway-useapi',
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
            durationSeconds: 8,
          },
        ],
        promptGuidance: [],
      }, {
        env: { USEAPI_API_TOKEN: 'sk-test' },
        fetchImpl: makeFetchImpl(script),
      });

      assert.ok(result.externalJobId.startsWith('runway-useapi-'));
      // verify submit body shape
      const submitRequest = script.captured[0];
      assert.ok(submitRequest.url.endsWith('/runwayml/videos/create'));
      const body = submitRequest.body as Record<string, unknown>;
      assert.equal(body.model, 'seedance-2');
      assert.equal(body.text_prompt, 'A serene mountain at dawn.');
      assert.equal(body.duration, 8);
      assert.equal(body.aspect_ratio, '16:9');
      assert.equal(body.exploreMode, true);

      // verify state was persisted
      const statePath = join(root, 'outputs', '.vclaw-jobs', `${result.externalJobId}.json`);
      const state = JSON.parse(await readFile(statePath, 'utf-8'));
      assert.equal(state.routeId, 'runway-useapi');
      assert.equal(state.scenes.length, 1);
      assert.equal(state.scenes[0].taskId, 'user:1-runwayml:e@x:task:abc');
      assert.equal(state.scenes[0].status, 'submitted');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uploads a local image keyframe and passes startFrameAssetId for seedance-2.0', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-runway-keyframe-'));
    try {
      const imagePath = join(root, 'frame.jpg');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff]));

      const script: MockResponseScript = {
        responses: [
          // 1. upload asset
          { json: { assetId: 'user:1-runwayml:e@x:asset:keyframe-1' } },
          // 2. submit job
          { json: { task: { taskId: 'user:1-runwayml:e@x:task:xyz' }, code: 200 } },
        ],
        captured: [],
      };

      await submitRunwayUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'runway-useapi',
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
        env: { USEAPI_API_TOKEN: 'sk-test' },
        fetchImpl: makeFetchImpl(script),
      });

      // First call was asset upload
      assert.ok(script.captured[0].url.includes('/runwayml/assets/'));
      assert.equal(script.captured[0].method, 'POST');
      // Second call was submit with startFrameAssetId
      const submitBody = script.captured[1].body as Record<string, unknown>;
      assert.equal(submitBody.startFrameAssetId, 'user:1-runwayml:e@x:asset:keyframe-1');
      assert.equal(submitBody.aspect_ratio, '9:16');
      assert.equal(submitBody.duration, 5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('polls scenes, downloads completed videos, and reports completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-runway-poll-'));
    try {
      // First submit so state exists
      const submitScript: MockResponseScript = {
        responses: [
          { json: { task: { taskId: 'task-1' }, code: 200 } },
        ],
        captured: [],
      };
      const submitResult = await submitRunwayUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'runway-useapi',
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
        env: { USEAPI_API_TOKEN: 'sk-test' },
        fetchImpl: makeFetchImpl(submitScript),
      });

      // Now poll — first call: pollRunwayJob returns COMPLETED with artifact;
      // second call: fetchRunwayResult re-polls (extracts URL); third call:
      // downloads the video.
      const completedJson = {
        status: 'COMPLETED',
        progressRatio: '1',
        artifacts: [{ url: 'https://cdn.test/scene-0.mp4', previewUrls: ['https://cdn.test/p0.jpg'] }],
      };
      const pollScript: MockResponseScript = {
        responses: [
          { json: completedJson }, // pollRunwayJob
          { json: completedJson }, // fetchRunwayResult re-polls under the hood
          { arrayBuffer: new TextEncoder().encode('fake-mp4-bytes').buffer as ArrayBuffer }, // download
        ],
        captured: [],
      };

      const pollResult = await pollRunwayUseApiNative({
        outputDir: join(root, 'outputs'),
        externalJobId: submitResult.externalJobId,
        workspaceRoot: root,
      }, {
        env: { USEAPI_API_TOKEN: 'sk-test' },
        fetchImpl: makeFetchImpl(pollScript),
      });

      assert.equal(pollResult.status, 'completed');
      assert.equal(pollResult.outputs.length, 1);
      assert.equal(pollResult.outputs[0].kind, 'video');
      assert.equal(pollResult.outputs[0].backend, 'runway-useapi');
      assert.ok(pollResult.outputs[0].path.endsWith('scene-0.mp4'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cancel marks submitted scenes as failed locally and warns about remote tasks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-native-runway-cancel-'));
    try {
      const submitScript: MockResponseScript = {
        responses: [
          { json: { task: { taskId: 'task-c1' }, code: 200 } },
        ],
        captured: [],
      };
      const submitResult = await submitRunwayUseApiNative({
        workspaceRoot: root,
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        routeId: 'runway-useapi',
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
        env: { USEAPI_API_TOKEN: 'sk-test' },
        fetchImpl: makeFetchImpl(submitScript),
      });

      const result = await cancelRunwayUseApiNative({
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
