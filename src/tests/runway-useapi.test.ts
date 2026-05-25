import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitRunwayJob,
  pollRunwayJob,
  fetchRunwayResult,
  registerRunwayAccount,
} from '../video/providers/runway-useapi.js';

const realFetch = globalThis.fetch;

describe('submitRunwayJob', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POSTs to gen4_5/create with text_prompt, exploreMode, seconds for Gen-4.5', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ task: { id: 'uuid-abc', taskId: 'user:1-runwayml:e@x:task:uuid-abc' }, code: 200 }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await submitRunwayJob({
      apiToken: 'sk-test',
      model: 'gen-4.5',
      textPrompt: 'A test scene',
      mode: 'explore',
      seconds: 5,
      aspectRatio: '16:9',
    });

    assert.equal(result.taskId, 'user:1-runwayml:e@x:task:uuid-abc');
    assert.ok(captured!.url.endsWith('/runwayml/gen4_5/create'));
    const headers = captured!.init.headers as Record<string, string>;
    assert.equal(headers['Authorization'] ?? headers['authorization'], 'Bearer sk-test');
    const body = JSON.parse(captured!.init.body as string);
    assert.equal(body.text_prompt, 'A test scene');
    assert.equal(body.exploreMode, true);
    assert.equal(body.seconds, 5);
    assert.equal(body.aspect_ratio, '16:9');
    // gen4_5/create endpoint does NOT take the model in the body
    assert.equal(body.model, undefined);
  });

  it('falls back to task.id when task.taskId is missing', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ task: { id: 'just-id' }, code: 200 }), { status: 200 });
    }) as typeof fetch;

    const result = await submitRunwayJob({
      apiToken: 'sk-test',
      model: 'gen-4.5',
      textPrompt: 'A test scene',
      mode: 'explore',
    });

    assert.equal(result.taskId, 'just-id');
  });

  it('routes seedance-2.0 to /runwayml/videos/create with model=seedance-2 and duration field', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ task: { taskId: 'task-seed' }, code: 200 }), { status: 200 });
    }) as typeof fetch;

    await submitRunwayJob({
      apiToken: 'sk-test',
      model: 'seedance-2.0',
      textPrompt: 'A seedance scene',
      mode: 'explore',
      seconds: 8,
    });

    assert.ok(captured!.url.endsWith('/runwayml/videos/create'));
    const body = JSON.parse(captured!.init.body as string);
    assert.equal(body.model, 'seedance-2'); // unified name, no .0
    assert.equal(body.text_prompt, 'A seedance scene');
    // videos/create uses 'duration' not 'seconds'
    assert.equal(body.duration, 8);
    assert.equal(body.seconds, undefined);
  });

  it('throws with shape error when response has no task.id or task.taskId', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ code: 200 }), { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      () => submitRunwayJob({ apiToken: 'sk-test', model: 'gen-4.5', textPrompt: 'x', mode: 'explore' }),
      /unexpected shape/,
    );
  });
});

describe('pollRunwayJob', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('maps RUNNING to running and parses stringy progressRatio', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ status: 'RUNNING', progressRatio: '0.5', artifacts: [] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await pollRunwayJob({ apiToken: 'sk-test', taskId: 'task-123' });
    assert.equal(result.status, 'running');
    assert.equal(result.progress, 0.5);
    assert.deepEqual(result.artifacts, []);
  });

  it('maps COMPLETED to completed and surfaces artifacts', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: 'COMPLETED',
          progressRatio: '1',
          artifacts: [{ url: 'https://cdn.test/v.mp4', thumbnailUrl: 'https://cdn.test/t.jpg' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await pollRunwayJob({ apiToken: 'sk-test', taskId: 'task-123' });
    assert.equal(result.status, 'completed');
    assert.equal(result.progress, 1);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].url, 'https://cdn.test/v.mp4');
  });

  it('maps FAILED/ERROR to failed', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ status: 'FAILED' }), { status: 200 });
    }) as typeof fetch;

    const result = await pollRunwayJob({ apiToken: 'sk-test', taskId: 'task-123' });
    assert.equal(result.status, 'failed');
  });

  it('treats unknown status as pending', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 });
    }) as typeof fetch;

    const result = await pollRunwayJob({ apiToken: 'sk-test', taskId: 'task-123' });
    assert.equal(result.status, 'pending');
    assert.equal(result.progress, 0);
  });
});

describe('fetchRunwayResult', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('extracts url and previewUrls[0] from first artifact (real UseAPI shape)', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: 'SUCCEEDED',
          progressRatio: '1',
          artifacts: [{
            url: 'https://cdn.test/v.mp4',
            previewUrls: ['https://cdn.test/preview0.jpg', 'https://cdn.test/preview1.jpg'],
          }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await fetchRunwayResult({ apiToken: 'sk-test', taskId: 'task-123' });
    assert.equal(result.videoUrl, 'https://cdn.test/v.mp4');
    assert.equal(result.thumbnailUrl, 'https://cdn.test/preview0.jpg');
  });

  it('returns null thumbnailUrl when previewUrls is absent', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ status: 'SUCCEEDED', artifacts: [{ url: 'https://cdn.test/v.mp4' }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await fetchRunwayResult({ apiToken: 'sk-test', taskId: 'task-123' });
    assert.equal(result.videoUrl, 'https://cdn.test/v.mp4');
    assert.equal(result.thumbnailUrl, null);
  });

  it('returns null URLs when artifacts array is empty', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ status: 'SUCCEEDED', artifacts: [] }), { status: 200 });
    }) as typeof fetch;

    const result = await fetchRunwayResult({ apiToken: 'sk-test', taskId: 'task-123' });
    assert.equal(result.videoUrl, null);
    assert.equal(result.thumbnailUrl, null);
  });
});

describe('registerRunwayAccount', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POSTs credentials to /runwayml/accounts/{email} verbatim (no URL-encoding)', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          email: 'user@example.com',
          jwt: { token: 'jwt-abc', id: 12345, exp: 9999999999, iat: 1000000000 },
        }),
        { status: 201 },
      );
    }) as typeof fetch;

    const result = await registerRunwayAccount({
      apiToken: 'sk-test',
      email: 'user@example.com',
      password: 'pw',
      maxJobs: 5,
    });

    assert.equal(result.id, 12345);
    assert.equal(result.token, 'jwt-abc');
    // UseAPI requires raw email in the path (no %40 encoding of @)
    assert.ok(captured!.url.endsWith('/runwayml/accounts/user@example.com'));
    const body = JSON.parse(captured!.init.body as string);
    assert.equal(body.email, 'user@example.com');
    assert.equal(body.password, 'pw');
    assert.equal(body.maxJobs, 5);
  });

  it('accepts a top-level token/id response shape (no jwt wrapper)', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ token: 'top-level-jwt', id: 99, exp: 1, iat: 1 }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await registerRunwayAccount({
      apiToken: 'sk-test', email: 'a@b.com', password: 'p', maxJobs: 1,
    });
    assert.equal(result.token, 'top-level-jwt');
    assert.equal(result.id, 99);
  });

  it('throws when maxJobs is out of range', async () => {
    await assert.rejects(
      () => registerRunwayAccount({ apiToken: 'sk-test', email: 'a@b.com', password: 'p', maxJobs: 11 }),
      /maxJobs must be 1-10/,
    );
  });
});
