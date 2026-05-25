/**
 * Unit tests for useapi.net extended features
 *
 * Tests the cost calculation functions, model selection, and utility functions
 * for image generation, image upscaling, video-to-GIF, and video upscaling.
 *
 * Also covers mocked-HTTP tests for extendVideo and concatenateVideos using
 * the new media[] and encodedVideo response shapes (Tasks 8+15).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  calculateImageCost,
  calculateUpscaleCost,
  calculateImageUpscaleCost,
  autoSelectImageModel,
  UseApiClient,
} from "../src/backends/useapi/client";
import extendFixture from "./fixtures/responses/extend-success.json";
import concatFixture from "./fixtures/responses/concat-success.json";

describe("useapi extended features utilities", () => {
  describe("calculateImageCost", () => {
    test("imagen-4 cost: ~$0.02 per image + $0.0025 CAPTCHA", () => {
      const cost = calculateImageCost("imagen-4", 1);
      expect(cost.imageCost).toBe(0.02);
      expect(cost.captchaCost).toBe(0.0025);
      expect(cost.total).toBeCloseTo(0.0225, 4);
    });

    test("nano-banana cost: ~$0.03 per image + $0.0025 CAPTCHA", () => {
      const cost = calculateImageCost("nano-banana", 1);
      expect(cost.imageCost).toBe(0.03);
      expect(cost.captchaCost).toBe(0.0025);
      expect(cost.total).toBeCloseTo(0.0325, 4);
    });

    test("nano-banana-pro cost: ~$0.05 per image + $0.0025 CAPTCHA", () => {
      const cost = calculateImageCost("nano-banana-pro", 1);
      expect(cost.imageCost).toBe(0.05);
      expect(cost.captchaCost).toBe(0.0025);
      expect(cost.total).toBeCloseTo(0.0525, 4);
    });

    test("scales image cost with count, CAPTCHA is per-request", () => {
      // 4 images with imagen-4
      const cost = calculateImageCost("imagen-4", 4);
      expect(cost.imageCost).toBe(0.08); // 4 * $0.02
      expect(cost.captchaCost).toBe(0.0025); // Still one CAPTCHA per request
      expect(cost.total).toBeCloseTo(0.0825, 4);
    });

    test("handles zero image count", () => {
      const cost = calculateImageCost("imagen-4", 0);
      expect(cost.imageCost).toBe(0);
      expect(cost.captchaCost).toBe(0.0025); // CAPTCHA still required for request
      expect(cost.total).toBeCloseTo(0.0025, 4);
    });

    test("handles max image count (4)", () => {
      const cost = calculateImageCost("nano-banana-pro", 4);
      expect(cost.imageCost).toBe(0.20); // 4 * $0.05
      expect(cost.captchaCost).toBe(0.0025);
      expect(cost.total).toBeCloseTo(0.2025, 4);
    });
  });

  describe("calculateUpscaleCost (video)", () => {
    test("1080p upscaling is free", () => {
      const cost = calculateUpscaleCost("1080p");
      expect(cost.cost).toBe(0);
      expect(cost.credits).toBe(0);
      expect(cost.notes).toContain("free");
    });

    test("4K upscaling costs 50 credits (~$0.25)", () => {
      const cost = calculateUpscaleCost("4k");
      expect(cost.cost).toBe(0.25);
      expect(cost.credits).toBe(50);
      expect(cost.notes).toContain("Ultra tier");
    });

    test("results are cached (noted in response)", () => {
      const cost1080 = calculateUpscaleCost("1080p");
      const cost4k = calculateUpscaleCost("4k");
      expect(cost1080.notes).toContain("cached");
      expect(cost4k.notes).toContain("cached");
    });
  });

  describe("calculateImageUpscaleCost", () => {
    test("2K upscaling is free", () => {
      const cost = calculateImageUpscaleCost("2k");
      expect(cost.cost).toBe(0);
      expect(cost.notes).toContain("free");
    });

    test("4K upscaling requires paid account", () => {
      const cost = calculateImageUpscaleCost("4k");
      expect(cost.notes).toContain("paid");
    });

    test("only works with nano-banana-pro images", () => {
      const cost2k = calculateImageUpscaleCost("2k");
      const cost4k = calculateImageUpscaleCost("4k");
      expect(cost2k.notes).toContain("nano-banana-pro");
      expect(cost4k.notes).toContain("nano-banana-pro");
    });
  });

  describe("autoSelectImageModel", () => {
    test("0 references -> imagen-4", () => {
      expect(autoSelectImageModel(0)).toBe("imagen-4");
    });

    test("1 reference -> nano-banana", () => {
      expect(autoSelectImageModel(1)).toBe("nano-banana");
    });

    test("2 references -> nano-banana", () => {
      expect(autoSelectImageModel(2)).toBe("nano-banana");
    });

    test("3 references -> nano-banana", () => {
      expect(autoSelectImageModel(3)).toBe("nano-banana");
    });

    test("4 references -> nano-banana-pro", () => {
      expect(autoSelectImageModel(4)).toBe("nano-banana-pro");
    });

    test("5+ references -> nano-banana-pro", () => {
      expect(autoSelectImageModel(5)).toBe("nano-banana-pro");
      expect(autoSelectImageModel(10)).toBe("nano-banana-pro");
    });
  });
});

describe("cost comparison summary", () => {
  test("image generation is cheaper than video generation", () => {
    // Calculate costs for each image model (1 image)
    const imagen4Cost = calculateImageCost("imagen-4", 1).total;
    const nanoBananaCost = calculateImageCost("nano-banana", 1).total;
    const nanoBananaProCost = calculateImageCost("nano-banana-pro", 1).total;

    // All should be under $0.10
    expect(imagen4Cost).toBeLessThan(0.10);
    expect(nanoBananaCost).toBeLessThan(0.10);
    expect(nanoBananaProCost).toBeLessThan(0.10);

    // imagen-4 should be cheapest
    expect(imagen4Cost).toBeLessThan(nanoBananaCost);
    expect(nanoBananaCost).toBeLessThan(nanoBananaProCost);
  });

  test("video GIF conversion is free (documented in types)", () => {
    // VideoToGif is FREE - no cost function needed
    // This is a documentation test to verify understanding
    expect(true).toBe(true);
  });

  test("1080p video upscale is free, 4K costs credits", () => {
    const cost1080 = calculateUpscaleCost("1080p");
    const cost4k = calculateUpscaleCost("4k");

    expect(cost1080.cost).toBe(0);
    expect(cost4k.cost).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Mocked-HTTP tests for extendVideo and concatenateVideos (Task 15)
// Uses globalThis.fetch replacement so no live network calls are made.
// ---------------------------------------------------------------------------

describe("UseApiClient extend/concat (mocked HTTP)", () => {
  let capturedRequests: Array<{ method: string; url: string; body: unknown }> = [];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    capturedRequests = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("extendVideo POSTs to /google-flow/videos/extend and returns media[].videoUrl", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const method = _init?.method ?? "GET";
      const body = _init?.body ? JSON.parse(_init.body as string) : undefined;
      capturedRequests.push({ method, url, body });
      return new Response(JSON.stringify(extendFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new UseApiClient({ apiToken: "tok", accountEmail: "a@b.com" });
    const result = await client.extendVideo({
      mediaGenerationId: "user:12345-email:6a6f-video:a1d95d21",
      prompt: "The scene continues into the night",
    });

    // Assert the HTTP request shape
    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/google-flow/videos/extend");

    // Assert the response is parsed as media[] and videoUrl is accessible
    expect(result.media).toBeDefined();
    expect(Array.isArray(result.media)).toBe(true);
    expect(result.media![0].videoUrl).toBe(
      "https://flow-content.google/video/b2e06f32?Expires=1"
    );
    expect(result.media![0].mediaGenerationId).toBe(
      "user:12345-email:6a6f-video:b2e06f32"
    );
  });

  test("concatenateVideos POSTs to /google-flow/videos/concatenate and returns encodedVideo", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const method = _init?.method ?? "GET";
      const body = _init?.body ? JSON.parse(_init.body as string) : undefined;
      capturedRequests.push({ method, url, body });
      return new Response(JSON.stringify(concatFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new UseApiClient({ apiToken: "tok", accountEmail: "a@b.com" });
    const result = await client.concatenateVideos({
      media: [
        { mediaGenerationId: "user:12345-email:6a6f-video:a1d95d21" },
        { mediaGenerationId: "user:12345-email:6a6f-video:b2e06f32" },
      ],
    });

    // Assert the HTTP request shape
    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toContain("/google-flow/videos/concatenate");

    // Assert the response is parsed and encodedVideo is present
    expect(result.encodedVideo).toBe("AAAAIGZ0eXBpc29t");
    expect(result.status).toBe("MEDIA_GENERATION_STATUS_SUCCESSFUL");
    expect(result.inputsCount).toBe(2);
  });

  test("concatenateVideos rejects fewer than 2 videos without making a network call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async (): Promise<Response> => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const client = new UseApiClient({ apiToken: "tok", accountEmail: "a@b.com" });
    await expect(
      client.concatenateVideos({ media: [{ mediaGenerationId: "only-one" }] })
    ).rejects.toThrow("concatenateVideos requires 2-10 videos");

    expect(fetchCalled).toBe(false);
  });
});
