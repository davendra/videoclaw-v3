import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { submitDreaminaUseApiNative } from '../video/native-dreamina.js';
import type { VideoExecutionPayload } from '../video/types.js';

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

function makeFetchImpl(captured: CapturedRequest[]) {
  let assetCounter = 0;
  return async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ) => {
    const method = init?.method ?? 'GET';
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
    captured.push({ url, method, body: parsedBody });

    if (url.includes('/dreamina/assets/')) {
      assetCounter += 1;
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ assetRef: `asset-ref-${assetCounter}`, width: 1024, height: 576 }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    // POST /dreamina/videos → submit
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ jobid: 'job-multi', status: 'created' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
}

const ENV = {
  USEAPI_API_TOKEN: 'user:1-sk-test',
  VCLAW_DREAMINA_ACCOUNT: 'CA:ai@example.com',
} as NodeJS.ProcessEnv;

function basePayload(
  workspaceRoot: string,
  outputDir: string,
  referencePaths: string[],
): VideoExecutionPayload {
  return {
    workspaceRoot,
    projectSlug: 'dreamina-multiref',
    productionMode: 'storyboard',
    routeId: 'dreamina-useapi',
    operationKind: 'image-to-video',
    executionProfile: {
      aspectRatio: '16:9',
      quality: 'quality',
      resolution: '1080p',
      generateAudio: false,
      outputCount: 1,
    },
    generatedAt: new Date().toISOString(),
    outputDir,
    tasks: [
      {
        sceneIndex: 0,
        prompt: 'Three stylized warriors stand together @image1 @image2 @image3',
        inputKind: 'image',
        referencePaths,
        sourceAssetIds: [],
        backendHints: [],
        characters: [],
        durationSeconds: 5,
      },
    ],
    promptGuidance: [],
  } as unknown as VideoExecutionPayload;
}

async function writeRefImages(dir: string, count: number): Promise<string[]> {
  const refs: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const p = join(dir, `ref-${i}.jpg`);
    await writeFile(p, Buffer.from([0xff, 0xd8, 0xff, i & 0xff]));
    refs.push(p);
  }
  return refs;
}

describe('dreamina-useapi Omni Reference multi-ref', () => {
  it('emits omni_1_imageRef..omni_N_imageRef for multiple images and NO firstFrameRef', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-dreamina-multi-'));
    try {
      const refs = await writeRefImages(root, 3);
      const captured: CapturedRequest[] = [];
      const result = await submitDreaminaUseApiNative(
        basePayload(root, join(root, 'outputs'), refs),
        { env: ENV, fetchImpl: makeFetchImpl(captured) as never },
      );

      const uploads = captured.filter((c) => c.url.includes('/dreamina/assets/'));
      assert.equal(uploads.length, 3, 'expected one upload per image ref (N uploads)');

      const createReq = captured.find((c) => c.url.endsWith('/dreamina/videos'));
      assert.ok(createReq, 'expected a video create request');
      const body = createReq!.body as Record<string, unknown>;
      assert.equal(body.omni_1_imageRef, 'asset-ref-1');
      assert.equal(body.omni_2_imageRef, 'asset-ref-2');
      assert.equal(body.omni_3_imageRef, 'asset-ref-3');
      assert.equal('firstFrameRef' in body, false, 'multi-ref must NOT send firstFrameRef');
      assert.equal('ratio' in body, false, 'multi-ref must NOT send ratio');
      assert.equal(result.externalJobId.startsWith('dreamina-useapi-'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the single firstFrameRef path for exactly one image (unchanged)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-dreamina-one-'));
    try {
      const refs = await writeRefImages(root, 1);
      const captured: CapturedRequest[] = [];
      await submitDreaminaUseApiNative(basePayload(root, join(root, 'outputs'), refs), {
        env: ENV,
        fetchImpl: makeFetchImpl(captured) as never,
      });

      const uploads = captured.filter((c) => c.url.includes('/dreamina/assets/'));
      assert.equal(uploads.length, 1);
      const createReq = captured.find((c) => c.url.endsWith('/dreamina/videos'));
      const body = createReq!.body as Record<string, unknown>;
      assert.equal(body.firstFrameRef, 'asset-ref-1');
      assert.equal('omni_1_imageRef' in body, false, 'single ref must NOT use omni_N fields');
      assert.equal('ratio' in body, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits omni video and audio refs alongside images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-dreamina-av-'));
    try {
      const refs: string[] = [];
      for (let i = 1; i <= 2; i += 1) {
        const p = join(root, `img-${i}.jpg`);
        await writeFile(p, Buffer.from([0xff, 0xd8, 0xff, i]));
        refs.push(p);
      }
      const vid = join(root, 'clip.mp4');
      await writeFile(vid, Buffer.from([0x00, 0x00, 0x00, 0x18]));
      refs.push(vid);
      const aud = join(root, 'voice.mp3');
      await writeFile(aud, Buffer.from([0x49, 0x44, 0x33, 0x03]));
      refs.push(aud);

      const captured: CapturedRequest[] = [];
      await submitDreaminaUseApiNative(basePayload(root, join(root, 'outputs'), refs), {
        env: ENV,
        fetchImpl: makeFetchImpl(captured) as never,
      });

      const createReq = captured.find((c) => c.url.endsWith('/dreamina/videos'));
      const body = createReq!.body as Record<string, unknown>;
      assert.equal(body.omni_1_imageRef, 'asset-ref-1');
      assert.equal(body.omni_2_imageRef, 'asset-ref-2');
      assert.equal(body.omni_1_videoRef, 'asset-ref-3');
      assert.equal(body.omni_1_audioRef, 'asset-ref-4');
      assert.equal('firstFrameRef' in body, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preflight-rejects >9 image references with a clear error before any upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-dreamina-cap-'));
    try {
      const refs = await writeRefImages(root, 10);
      const captured: CapturedRequest[] = [];
      await assert.rejects(
        () =>
          submitDreaminaUseApiNative(basePayload(root, join(root, 'outputs'), refs), {
            env: ENV,
            fetchImpl: makeFetchImpl(captured) as never,
          }),
        /image references exceed the Dreamina cap of 9/,
      );
      const uploads = captured.filter((c) => c.url.includes('/dreamina/assets/'));
      assert.equal(uploads.length, 0, 'preflight must reject before any upload');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips Asset:// references with a warning (ARK avatar, not a Dreamina assetRef)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-dreamina-asset-'));
    try {
      const img = join(root, 'real.jpg');
      await writeFile(img, Buffer.from([0xff, 0xd8, 0xff, 0x01]));
      const refs = ['Asset://ark-avatar-123', img];

      const captured: CapturedRequest[] = [];
      const result = await submitDreaminaUseApiNative(
        basePayload(root, join(root, 'outputs'), refs),
        { env: ENV, fetchImpl: makeFetchImpl(captured) as never },
      );

      const uploads = captured.filter((c) => c.url.includes('/dreamina/assets/'));
      assert.equal(uploads.length, 1, 'Asset:// must be skipped; only the real image uploads');
      const createReq = captured.find((c) => c.url.endsWith('/dreamina/videos'));
      const body = createReq!.body as Record<string, unknown>;
      // Only one uploadable image remains → single firstFrameRef path.
      assert.equal(body.firstFrameRef, 'asset-ref-1');
      assert.equal('omni_1_imageRef' in body, false);
      const raw = result.rawResult as { warnings?: string[] };
      assert.ok(Array.isArray(raw.warnings), 'expected warnings for skipped Asset://');
      assert.ok(
        raw.warnings!.some((w) => w.includes('Asset://')),
        'expected an Asset:// skip warning',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
