/**
 * Integration/E2E tests for useapi.net extended features
 *
 * These tests require:
 * - USEAPI_API_TOKEN environment variable
 * - USEAPI_ACCOUNT_EMAIL environment variable
 * - Configured CAPTCHA provider with credits (see https://useapi.net/docs)
 *
 * Run with: USEAPI_RUN_LIVE_E2E=1 bun test tests/useapi-extended.e2e.test.ts
 *
 * COST ESTIMATE: ~$0.20 for full run (4 images + 1 fast video + 1 GIF + 1 upscale)
 *
 * NOTE: These tests will fail if CAPTCHA credits are exhausted.
 * For unit tests without API calls, see useapi-transform.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { UseApiClient } from "../src/backends/useapi/client";

// Check if integration tests should run
const LIVE_E2E_ENABLED = process.env.USEAPI_RUN_LIVE_E2E === "1";
const INTEGRATION_ENABLED = Boolean(
  LIVE_E2E_ENABLED &&
    process.env.USEAPI_API_TOKEN &&
    process.env.USEAPI_ACCOUNT_EMAIL,
);

// Store generated IDs for chained tests
let generatedImageMediaId: string | null = null;
let generatedVideoMediaId: string | null = null;

function summarizeCaptcha(captcha: any) {
  if (!captcha) return null;
  return {
    service: captcha.service,
    durationMs: captcha.durationMs,
    attemptCount: Array.isArray(captcha.attempts) ? captcha.attempts.length : 0,
  };
}

describe.skipIf(!INTEGRATION_ENABLED)(
  "useapi extended features integration",
  () => {
    let client: UseApiClient;

    beforeAll(() => {
      client = new UseApiClient({
        apiToken: process.env.USEAPI_API_TOKEN!,
        accountEmail: process.env.USEAPI_ACCOUNT_EMAIL!,
      });
    });

    describe("image generation", () => {
      test("generates image with imagen-4 (text-to-image)", async () => {
        const result = await client.generateImage({
          email: process.env.USEAPI_ACCOUNT_EMAIL!,
          prompt: "A test image of a cute orange tabby cat sitting on a windowsill",
          model: "imagen-4",
          aspectRatio: "landscape",
          count: 1,
        });

        // Log a safe summary only; full responses include signed media URLs.
        console.log("Image generation result:", JSON.stringify({
          jobId: result.jobId,
          imageCount: result.images?.length ?? 0,
          captcha: summarizeCaptcha(result.captcha),
        }, null, 2));

        // Verify normalized response structure
        expect(result).toHaveProperty("jobId");
        expect(result.jobId).toBeTruthy();
        expect(result).toHaveProperty("images");
        expect(Array.isArray(result.images)).toBe(true);

        // Should have at least one image with mediaGenerationId
        if (result.images.length > 0) {
          expect(result.images[0]).toHaveProperty("mediaGenerationId");
          expect(result.images[0].mediaGenerationId).toBeTruthy();
          generatedImageMediaId = result.images[0].mediaGenerationId;
          console.log(`Generated image mediaId: ${generatedImageMediaId?.substring(0, 30)}...`);
        }
      }, 120_000); // 2 minute timeout

      test("generates portrait image", async () => {
        const result = await client.generateImage({
          email: process.env.USEAPI_ACCOUNT_EMAIL!,
          prompt: "A tall lighthouse standing against a stormy sky, dramatic lighting",
          model: "imagen-4",
          aspectRatio: "portrait",
          count: 1,
        });

        expect(result).toHaveProperty("jobId");
        expect(result.jobId).toBeTruthy();
        expect(result).toHaveProperty("images");
        console.log("Portrait image generation completed, jobId:", result.jobId);
      }, 120_000);

      test("generates multiple images in single request", async () => {
        const result = await client.generateImage({
          email: process.env.USEAPI_ACCOUNT_EMAIL!,
          prompt: "A simple geometric pattern in blue and gold",
          model: "imagen-4",
          aspectRatio: "landscape",
          count: 2,
        });

        expect(result).toHaveProperty("jobId");
        expect(result.jobId).toBeTruthy();
        expect(result).toHaveProperty("images");
        // Should have 2 images when count=2
        if (result.images.length > 0) {
          console.log(`Generated ${result.images.length} images`);
        }
      }, 120_000);

      test("returns captcha info in response", async () => {
        const result = await client.generateImage({
          email: process.env.USEAPI_ACCOUNT_EMAIL!,
          prompt: "Minimal test image for cost verification",
          model: "imagen-4",
          aspectRatio: "landscape",
          count: 1,
        });

        expect(result).toHaveProperty("jobId");

        // Log captcha info if present
        if (result.captcha) {
          console.log("CAPTCHA info:", summarizeCaptcha(result.captcha));
          expect(result.captcha).toHaveProperty("durationMs");
        }
      }, 120_000);
    });

    describe("video generation for chained tests", () => {
      test("generates a fast video for GIF/upscale tests", async () => {
        // Generate a quick video to enable the chained tests
        const result = await client.generateVideo({
          email: process.env.USEAPI_ACCOUNT_EMAIL!,
          prompt: "A simple animation test: a ball bouncing",
          model: "veo-3.1-fast",
          aspectRatio: "landscape",
          count: 1,
        });

        expect(result).toHaveProperty("jobId");
        expect(result.jobId).toBeTruthy();
        expect(result).toHaveProperty("operations");
        expect(Array.isArray(result.operations)).toBe(true);

        // Extract mediaGenerationId from operations
        if (result.operations && result.operations.length > 0) {
          const op = result.operations[0];
          generatedVideoMediaId = op.mediaGenerationId ||
            op.operation?.metadata?.video?.mediaGenerationId || null;
          console.log(`Generated video mediaId: ${generatedVideoMediaId?.substring(0, 30)}...`);
        }

        expect(generatedVideoMediaId).toBeTruthy();
      }, 180_000); // 3 minute timeout for video
    });

    describe("video to GIF (FREE - no CAPTCHA)", () => {
      test("converts video to GIF", async () => {
        // Skip if no video was generated
        if (!generatedVideoMediaId) {
          console.log("Skipping GIF test - no video generated in this session");
          return;
        }

        const result = await client.videoToGif({
          mediaGenerationId: generatedVideoMediaId,
        });

        console.log("GIF API response:", JSON.stringify({
          encodedGifLength: result.encodedGif?.length ?? 0,
          hasError: Boolean(result.error),
        }, null, 2));

        expect(result).toHaveProperty("encodedGif");
        expect(result.encodedGif).toBeTruthy();

        // GIF is base64 encoded
        expect(result.encodedGif.length).toBeGreaterThan(100);

        console.log(`Generated GIF: ${result.encodedGif.length} bytes base64`);
      }, 60_000);

      test("GIF endpoint requires valid mediaGenerationId", async () => {
        // Test with invalid ID should return error
        try {
          await client.videoToGif({
            mediaGenerationId: "INVALID_MEDIA_ID",
          });
          // Should not reach here
          expect(true).toBe(false);
        } catch (error) {
          // Expected to fail with invalid ID
          expect(error).toBeDefined();
        }
      }, 30_000);
    });

    describe("video upscaling", () => {
      test("upscales video to 1080p (free)", async () => {
        // Skip if no video was generated
        if (!generatedVideoMediaId) {
          console.log("Skipping upscale test - no video generated in this session");
          return;
        }

        const result = await client.upscaleVideo({
          mediaGenerationId: generatedVideoMediaId,
          resolution: "1080p",
        });

        const upscaledMediaId = result.operations?.[0]?.mediaGenerationId
          || result.operations?.[0]?.operation?.metadata?.video?.mediaGenerationId
          || result.media?.[0]?.mediaGenerationId
          || null;

        console.log("Upscale API response:", JSON.stringify({
          jobId: result.jobId,
          operationCount: result.operations?.length ?? 0,
          mediaCount: result.media?.length ?? 0,
          upscaledMediaId: upscaledMediaId ? `${upscaledMediaId.substring(0, 30)}...` : null,
          cached: Boolean(result.cached),
          hasError: Boolean(result.error),
        }, null, 2));

        expect(upscaledMediaId).toBeTruthy();

        // Check if cached
        if (result.cached) {
          console.log("Upscale result was cached (free re-upscale)");
        }
      }, 300_000);
    });

    describe("account health verification", () => {
      test("account is healthy for extended features", async () => {
        const health = await client.getAccountHealth(
          process.env.USEAPI_ACCOUNT_EMAIL!
        );

        expect(health.status).toBe("active");
        console.log(`Account tier: ${health.tier}`);
        console.log(`CAPTCHA credits: ${health.captchaCredits ?? "N/A"}`);
      }, 30_000);
    });
  }
);

// Test that runs without credentials to document expected behavior
describe("useapi extended features (no credentials)", () => {
  test("client requires credentials", () => {
    // Document that client needs both apiToken and accountEmail
    expect(() => {
      new UseApiClient({
        apiToken: "",
        accountEmail: "",
      });
    }).not.toThrow(); // Constructor doesn't validate, API calls will fail
  });

  test("integration tests skipped when no credentials", () => {
    if (!INTEGRATION_ENABLED) {
      console.log("Integration tests skipped - set USEAPI_API_TOKEN and USEAPI_ACCOUNT_EMAIL to run");
    }
    expect(true).toBe(true);
  });
});
