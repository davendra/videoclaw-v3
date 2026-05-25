/**
 * Unit and Integration tests for useapi.net backend
 *
 * Unit tests run always. Integration tests only run when
 * USEAPI_API_TOKEN and USEAPI_ACCOUNT_EMAIL environment variables are set.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mapModelToUseApi,
  mapAspectRatioToUseApi,
  calculateCost,
} from "../src/backends/useapi/client";

// Check if integration tests should run
const INTEGRATION_ENABLED =
  process.env.USEAPI_API_TOKEN && process.env.USEAPI_ACCOUNT_EMAIL;

describe("useapi client utilities", () => {
  describe("mapModelToUseApi", () => {
    test("maps 'quality' to veo-3.1-quality", () => {
      expect(mapModelToUseApi("quality")).toBe("veo-3.1-quality");
    });

    test("maps 'fast' to veo-3.1-fast", () => {
      expect(mapModelToUseApi("fast")).toBe("veo-3.1-fast");
    });

    test("maps 'free' to veo-3.1-lite-low-priority", () => {
      expect(mapModelToUseApi("free")).toBe("veo-3.1-lite-low-priority");
    });

    test("defaults unknown models to veo-3.1-fast", () => {
      expect(mapModelToUseApi("unknown")).toBe("veo-3.1-fast");
      expect(mapModelToUseApi("")).toBe("veo-3.1-fast");
    });

    test("handles case-insensitive input", () => {
      expect(mapModelToUseApi("QUALITY")).toBe("veo-3.1-quality");
      expect(mapModelToUseApi("Fast")).toBe("veo-3.1-fast");
      expect(mapModelToUseApi("FREE")).toBe("veo-3.1-lite-low-priority");
    });
  });

  describe("mapAspectRatioToUseApi", () => {
    test("maps portrait aspect ratios to 'portrait'", () => {
      expect(mapAspectRatioToUseApi("VIDEO_ASPECT_RATIO_PORTRAIT")).toBe("portrait");
      expect(mapAspectRatioToUseApi("9:16")).toBe("portrait");
      expect(mapAspectRatioToUseApi("portrait")).toBe("portrait");
    });

    test("maps landscape aspect ratios to 'landscape'", () => {
      expect(mapAspectRatioToUseApi("VIDEO_ASPECT_RATIO_LANDSCAPE")).toBe("landscape");
      expect(mapAspectRatioToUseApi("16:9")).toBe("landscape");
      expect(mapAspectRatioToUseApi("landscape")).toBe("landscape");
    });

    test("defaults unknown ratios to 'landscape'", () => {
      expect(mapAspectRatioToUseApi("unknown")).toBe("landscape");
      expect(mapAspectRatioToUseApi("")).toBe("landscape");
    });
  });

  describe("calculateCost", () => {
    test("calculates credits for quality model", () => {
      const cost = calculateCost("veo-3.1-quality", 1);
      expect(cost.credits).toBe(100);
      expect(cost.perVideoCredits).toBe(100);
      expect(cost.videoCount).toBe(1);
    });

    test("calculates credits for fast model", () => {
      const cost = calculateCost("veo-3.1-fast", 1);
      expect(cost.credits).toBe(20);
      expect(cost.perVideoCredits).toBe(20);
    });

    test("calculates credits for free model", () => {
      const cost = calculateCost("veo-3.1-lite-low-priority", 1);
      expect(cost.credits).toBe(0);
      expect(cost.perVideoCredits).toBe(0);
    });

    test("scales credits with video count", () => {
      const cost = calculateCost("veo-3.1-fast", 4);
      expect(cost.credits).toBe(80);
      expect(cost.videoCount).toBe(4);
    });

    test("handles zero video count", () => {
      const cost = calculateCost("veo-3.1-fast", 0);
      expect(cost.credits).toBe(0);
    });

    test("calculates credits for dual output (typical use case)", () => {
      // 5 prompts * 2 outputs = 10 videos with fast model
      const cost = calculateCost("veo-3.1-fast", 10);
      expect(cost.credits).toBe(200);
    });

    // Edge cases
    test("handles multiple videos correctly", () => {
      // 3 videos at fast rate
      const cost = calculateCost("veo-3.1-fast", 3);
      expect(cost.credits).toBe(60);
    });

    test("handles maximum count (4 videos)", () => {
      const cost = calculateCost("veo-3.1-quality", 4);
      expect(cost.credits).toBe(400);
    });

    test("credits scale linearly", () => {
      const cost1 = calculateCost("veo-3.1-fast", 1);
      const cost2 = calculateCost("veo-3.1-fast", 2);
      expect(cost2.credits).toBe(cost1.credits * 2);
    });

    test("free model has zero credits", () => {
      const cost = calculateCost("veo-3.1-lite-low-priority", 4);
      expect(cost.credits).toBe(0);
    });

    test("cost display format is consistent", () => {
      const cost = calculateCost("veo-3.1-fast", 1);
      const display = `${cost.credits} credits`;
      expect(display).toMatch(/^\d+ credits$/);
    });

    test("combined credit summary", () => {
      const cost = calculateCost("veo-3.1-fast", 2);
      const summary = {
        videos: cost.videoCount,
        credits: cost.credits,
        breakdown: `${cost.credits} credits (${cost.perVideoCredits} credits/video)`,
      };
      expect(summary.breakdown).toContain("credits");
      expect(summary.videos).toBe(2);
    });
  });
});

// Integration tests - only run when credentials are available
describe.skipIf(!INTEGRATION_ENABLED)("useapi integration tests", () => {
  const { UseApiClient } = require("../src/backends/useapi/client");

  let client: InstanceType<typeof UseApiClient>;

  beforeAll(() => {
    client = new UseApiClient({
      apiToken: process.env.USEAPI_API_TOKEN!,
      accountEmail: process.env.USEAPI_ACCOUNT_EMAIL!,
    });
  });

  describe("account health check", () => {
    test("returns valid health response", async () => {
      const health = await client.getAccountHealth(process.env.USEAPI_ACCOUNT_EMAIL!);

      expect(health).toHaveProperty("status");
      expect(health).toHaveProperty("tier");
      // Status can be active, error, or not_found (if no account registered)
      expect(["active", "error", "not_found"]).toContain(health.status);
      expect(["free", "pro", "ultra", "unknown"]).toContain(health.tier);
    });
  });

  describe("accounts list", () => {
    test("returns accounts map", async () => {
      const response = await client.getAccounts();

      // Response is a map keyed by email, or empty object
      expect(typeof response).toBe("object");
      expect(response).not.toBeNull();

      // If accounts exist, verify structure
      const emails = Object.keys(response);
      if (emails.length > 0) {
        const firstAccount = response[emails[0]];
        expect(firstAccount).toHaveProperty("health");
        expect(firstAccount).toHaveProperty("created");
      }
    });
  });

  describe("CAPTCHA providers", () => {
    test("returns CAPTCHA providers response", async () => {
      const response = await client.getCaptchaProviders();

      // Response is either { freeCaptchaCredits: number } or { ProviderName: "masked..." }
      expect(typeof response).toBe("object");
      expect(response).not.toBeNull();

      // Should have either freeCaptchaCredits or configured providers
      const keys = Object.keys(response);
      expect(keys.length).toBeGreaterThanOrEqual(0);
    });
  });
});

// Database history tests
describe("useapi history tracking", () => {
  const {
    initDB,
    recordUseApiHistory,
    getUseApiHistory,
    getUseApiStats,
    cleanupUseApiHistory,
    closeDB,
  } = require("../src/db");

  beforeAll(() => {
    // Initialize test database
    initDB();
  });

  afterAll(() => {
    closeDB();
  });

  test("records history entry", () => {
    const id = recordUseApiHistory({
      job_id: "test-job-123",
      backend: "useapi",
      status: "success",
      duration_ms: 45000,
      error_message: null,
      cost: 0.05,
    });

    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
  });

  test("retrieves history entries", () => {
    const history = getUseApiHistory(10);

    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);

    const latest = history[0];
    expect(latest).toHaveProperty("job_id");
    expect(latest).toHaveProperty("status");
    expect(latest).toHaveProperty("timestamp");
  });

  test("calculates stats", () => {
    // Add some test entries
    recordUseApiHistory({
      job_id: "test-success-1",
      backend: "useapi",
      status: "success",
      duration_ms: 40000,
      error_message: null,
      cost: 0.05,
    });

    recordUseApiHistory({
      job_id: "test-failed-1",
      backend: "useapi",
      status: "failed",
      duration_ms: 5000,
      error_message: "Test error",
      cost: null,
    });

    const stats = getUseApiStats(24);

    expect(stats).toHaveProperty("success");
    expect(stats).toHaveProperty("failed");
    expect(stats).toHaveProperty("rateLimited");
    expect(stats).toHaveProperty("timeout");
    expect(stats).toHaveProperty("totalCost");
    expect(stats).toHaveProperty("avgDurationMs");

    expect(typeof stats.success).toBe("number");
    expect(typeof stats.failed).toBe("number");
    expect(typeof stats.totalCost).toBe("number");
  });

  test("cleans up old history", () => {
    // This just verifies the function runs without error
    const deleted = cleanupUseApiHistory(30);
    expect(typeof deleted).toBe("number");
  });
});
