import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UseApiClient } from "../src/backends/useapi/client";

describe("UseApiClient.uploadVideo", () => {
  // Smoke test — kept for surface-level coverage.
  test("uploadVideo is defined on the client", () => {
    const client = new UseApiClient({ apiToken: "t", accountEmail: "e@x.com" });
    expect(typeof client.uploadVideo).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Mocked-HTTP tests for uploadVideo — exercise the raw binary POST path.
// Uses globalThis.fetch replacement so no live network calls are made.
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string;
  url: string;
  contentType: string | null;
  authorization: string | null;
  bodyBytes: number;
  bodyKind: string;
}

describe("UseApiClient.uploadVideo (mocked HTTP)", () => {
  let captured: CapturedRequest[] = [];
  let originalFetch: typeof globalThis.fetch;
  let tmpMp4: string;

  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;

    // Write a small "fake MP4" — content doesn't need to be a real container,
    // uploadVideo only checks .mp4 extension + binary length.
    tmpMp4 = join(tmpdir(), `flow-upload-test-${Date.now()}.mp4`);
    writeFileSync(tmpMp4, Buffer.from("FAKE_MP4_BYTES_FOR_TEST".repeat(1024)));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (existsSync(tmpMp4)) unlinkSync(tmpMp4);
  });

  function mockFetch(responder: () => Response) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      const body = init?.body;
      let bodyBytes = 0;
      let bodyKind: string = typeof body;
      if (body instanceof Uint8Array) {
        bodyBytes = body.byteLength;
        bodyKind = "Uint8Array/Buffer";
      } else if (typeof body === "string") {
        bodyBytes = body.length;
      }
      captured.push({
        method: init?.method ?? "GET",
        url,
        contentType: headers.get("Content-Type"),
        authorization: headers.get("Authorization"),
        bodyBytes,
        bodyKind,
      });
      return responder();
    }) as unknown as typeof globalThis.fetch;
  }

  test("POSTs binary body to /google-flow/assets/{email} with video/mp4 and Bearer auth", async () => {
    mockFetch(() => new Response(JSON.stringify({
      mediaGenerationId: { mediaGenerationId: "user:1-email:6a-video:abc123" },
      durationSeconds: 11.94,
      width: 1280,
      height: 720,
      email: "jo***@gmail.com",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const client = new UseApiClient({ apiToken: "tok", accountEmail: "jo@x.com" });
    const res = await client.uploadVideo(tmpMp4);

    expect(captured).toHaveLength(1);
    const req = captured[0];
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/google-flow/assets/jo%40x.com");
    expect(req.contentType).toBe("video/mp4");
    expect(req.authorization).toBe("Bearer tok");
    expect(req.bodyKind).toBe("Uint8Array/Buffer");
    expect(req.bodyBytes).toBeGreaterThan(0);

    // Response parsing — both nested and flat mediaGenerationId shapes are accepted
    const flatId = typeof res.mediaGenerationId === "object"
      ? res.mediaGenerationId.mediaGenerationId
      : res.mediaGenerationId;
    expect(flatId).toBe("user:1-email:6a-video:abc123");
    expect(res.durationSeconds).toBe(11.94);
    expect(res.width).toBe(1280);
    expect(res.height).toBe(720);
  });

  test("rejects non-MP4 file extension before any network call", async () => {
    mockFetch(() => new Response("should not be hit", { status: 500 }));

    const wrongExt = join(tmpdir(), `flow-upload-test-${Date.now()}.mov`);
    writeFileSync(wrongExt, Buffer.from("x"));
    try {
      const client = new UseApiClient({ apiToken: "tok", accountEmail: "jo@x.com" });
      await expect(client.uploadVideo(wrongExt)).rejects.toThrow(/Unsupported video format/);
      expect(captured).toHaveLength(0);
    } finally {
      if (existsSync(wrongExt)) unlinkSync(wrongExt);
    }
  });

  test("rejects file-not-found before reading or hitting the network", async () => {
    mockFetch(() => new Response("should not be hit", { status: 500 }));

    const client = new UseApiClient({ apiToken: "tok", accountEmail: "jo@x.com" });
    await expect(
      client.uploadVideo("/tmp/does-not-exist-flow-1234.mp4")
    ).rejects.toThrow(/not found/);
    expect(captured).toHaveLength(0);
  });

  test("surfaces account-not-found (404) as a useful error", async () => {
    mockFetch(() => new Response(
      JSON.stringify({ error: "Google Flow account jo@x.com not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    ));

    const client = new UseApiClient({ apiToken: "tok", accountEmail: "jo@x.com" });
    await expect(client.uploadVideo(tmpMp4)).rejects.toThrow(/account.*not found/i);
    expect(captured.length).toBeGreaterThanOrEqual(1);
  });

  test("URL-encodes the account email in the asset path", async () => {
    mockFetch(() => new Response(JSON.stringify({
      mediaGenerationId: "user:1-email:x-video:def456",
      durationSeconds: 4,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const client = new UseApiClient({ apiToken: "tok", accountEmail: "name+tag@gmail.com" });
    await client.uploadVideo(tmpMp4);

    expect(captured[0].url).toContain("/google-flow/assets/name%2Btag%40gmail.com");
  });
});
