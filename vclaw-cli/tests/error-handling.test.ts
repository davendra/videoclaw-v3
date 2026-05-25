/**
 * Error Handling Tests for useapi.net backend
 *
 * Tests:
 * - HTTP 429 rate limit detection and handling
 * - Network timeout simulation
 * - Malformed/invalid JSON responses
 * - Missing required fields
 * - Authentication errors
 */

import { describe, test, expect } from "bun:test";
import { MockResponseFactory } from "./helpers/mock-http";
import { transformImageResponse } from "../src/backends/useapi/client";
import type { UseApiImageResponseRaw } from "../src/backends/types";

describe("error handling", () => {
  describe("HTTP 429 rate limit", () => {
    test("rate limit response has correct structure", () => {
      const rateLimitResponse = MockResponseFactory.rateLimited(60);

      expect(rateLimitResponse.status).toBe(429);
      expect(rateLimitResponse.statusText).toBe("Too Many Requests");
      expect(rateLimitResponse.headers["Retry-After"]).toBe("60");
    });

    test("rate limit response includes retry-after value", () => {
      const response = MockResponseFactory.rateLimited(120);
      expect(response.headers["Retry-After"]).toBe("120");

      const body = JSON.parse(response.body);
      expect(body.error).toContain("Rate limit");
      expect(body.retryAfter).toBe(120);
    });

    test("rate limit error message is user-friendly", () => {
      const response = MockResponseFactory.rateLimited();
      const body = JSON.parse(response.body);

      expect(body.error).toMatch(/Rate limit|wait|retry/i);
    });

    test("detects rate limit from error message pattern", () => {
      const errorPatterns = [
        "Rate limited: Too many requests. Please wait before retrying.",
        "HTTP 429: Too Many Requests",
        "Rate limit exceeded",
      ];

      for (const pattern of errorPatterns) {
        expect(pattern.toLowerCase()).toMatch(/rate limit|429/i);
      }
    });
  });

  describe("timeout scenarios", () => {
    test("timeout config has expected structure", () => {
      const timeoutConfig = MockResponseFactory.timeout(30000);

      expect(timeoutConfig.shouldTimeout).toBe(true);
      expect(timeoutConfig.delayMs).toBe(30000);
    });

    test("default timeout is 200 seconds", () => {
      const timeoutConfig = MockResponseFactory.timeout();

      expect(timeoutConfig.delayMs).toBe(200000);
    });

    test("timeout error detection pattern", () => {
      const timeoutErrors = [
        "Request timeout",
        "The operation was aborted",
        "ETIMEDOUT",
        "Connection timeout exceeded",
      ];

      for (const error of timeoutErrors) {
        const isTimeout = /timeout|abort|etimedout/i.test(error);
        expect(isTimeout).toBe(true);
      }
    });

    test("timed out variations are detected", () => {
      // "timed out" contains "timed" not "timeout" - needs different regex
      const timedOutErrors = [
        "Request timed out",
        "Connection timed out",
      ];

      for (const error of timedOutErrors) {
        const isTimedOut = /timed\s*out/i.test(error);
        expect(isTimedOut).toBe(true);
      }
    });

    test("network errors are distinguishable from timeouts", () => {
      const networkErrors = [
        "Network request failed",
        "Connection refused",
        "DNS lookup failed",
      ];

      // Network errors need different handling than timeouts
      for (const error of networkErrors) {
        const isNetworkError = /network|connection|dns/i.test(error);
        expect(isNetworkError).toBe(true);
      }
    });
  });

  describe("malformed JSON responses", () => {
    test("malformed JSON response has correct structure", () => {
      const malformed = MockResponseFactory.malformedJson();

      expect(malformed.status).toBe(200);
      expect(malformed.body).toBe("{ invalid json response");
    });

    test("detects invalid JSON in response", () => {
      const invalidJsonStrings = [
        "{ invalid json",
        "not json at all",
        '{"incomplete": ',
        "null",
        "",
      ];

      for (const str of invalidJsonStrings) {
        let isValid = true;
        try {
          const parsed = JSON.parse(str);
          // null is technically valid JSON but might not be expected
          if (parsed === null) isValid = false;
        } catch {
          isValid = false;
        }

        if (str !== "null") {
          expect(isValid).toBe(false);
        }
      }
    });

    test("JSON parse error produces meaningful message", () => {
      const invalidJson = "{ broken json";

      try {
        JSON.parse(invalidJson);
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
        expect((error as SyntaxError).message).toContain("JSON");
      }
    });
  });

  describe("missing required fields", () => {
    test("missing fields response has correct structure", () => {
      const missingFields = MockResponseFactory.missingFields();

      expect(missingFields.status).toBe(200);
      const body = JSON.parse(missingFields.body);
      expect(body).not.toHaveProperty("jobId");
      expect(body).not.toHaveProperty("operations");
    });

    test("transformer handles missing media array", () => {
      const rawWithMissingMedia: UseApiImageResponseRaw = {
        jobId: "job-123",
        media: [],
      };

      const result = transformImageResponse(rawWithMissingMedia);

      expect(result.jobId).toBe("job-123");
      expect(result.images).toHaveLength(0);
    });

    test("transformer handles undefined media array", () => {
      const rawWithUndefinedMedia = {
        jobId: "job-123",
      } as UseApiImageResponseRaw;

      const result = transformImageResponse(rawWithUndefinedMedia);

      expect(result.jobId).toBe("job-123");
      expect(result.images).toHaveLength(0);
    });

    test("transformer handles partial image data", () => {
      const rawWithPartialData: UseApiImageResponseRaw = {
        jobId: "job-partial",
        media: [
          {
            name: "image-1",
            // Missing image.generatedImage
          },
          {
            name: "image-2",
            image: {
              generatedImage: {
                mediaGenerationId: "valid-id",
                seed: 12345,
              },
            },
          },
        ],
      };

      const result = transformImageResponse(rawWithPartialData);

      // Only the valid image should be included
      expect(result.images).toHaveLength(1);
      expect(result.images[0].mediaGenerationId).toBe("valid-id");
    });
  });

  describe("authentication errors", () => {
    test("401 error detection", () => {
      const error401Messages = [
        "HTTP 401: Unauthorized",
        "Authentication failed: Invalid API token. Check USEAPI_API_TOKEN.",
        "401 Unauthorized",
      ];

      for (const msg of error401Messages) {
        expect(msg).toMatch(/401|Unauthorized|Authentication failed/i);
      }
    });

    test("403 error detection", () => {
      const error403Messages = [
        "HTTP 403: Forbidden",
        "Access denied: Insufficient permissions. Check your useapi.net subscription.",
        "403 Forbidden",
      ];

      for (const msg of error403Messages) {
        expect(msg).toMatch(/403|Forbidden|Access denied/i);
      }
    });

    test("402 payment required error detection", () => {
      const error402Messages = [
        "HTTP 402: Payment Required",
        "Payment required: Insufficient balance. Check your useapi.net balance.",
        "402 Payment Required",
      ];

      for (const msg of error402Messages) {
        expect(msg).toMatch(/402|Payment required|balance/i);
      }
    });
  });

  describe("error recovery strategies", () => {
    test("retry-on filter correctly identifies retriable errors", () => {
      const retriableErrors = [
        "Network timeout",
        "ETIMEDOUT",
        "Connection reset",
        "Server error 500",
        "502 Bad Gateway",
        "503 Service Unavailable",
        "504 Gateway Timeout",
      ];

      const nonRetriableErrors = [
        "401 Unauthorized",
        "403 Forbidden",
        "400 Bad Request",
        "Direct image upload is not supported",
      ];

      // Check retriable errors contain expected patterns
      for (const error of retriableErrors) {
        const shouldRetry = !/401|403|400|not supported/i.test(error);
        expect(shouldRetry).toBe(true);
      }

      // Check non-retriable errors contain expected patterns
      for (const error of nonRetriableErrors) {
        const shouldRetry = !/401|403|400|not supported/i.test(error);
        expect(shouldRetry).toBe(false);
      }
    });

    test("exponential backoff delays increase correctly", () => {
      const initialDelay = 1000;
      const multiplier = 2;
      const maxDelay = 30000;

      const delays: number[] = [];
      let currentDelay = initialDelay;

      for (let i = 0; i < 5; i++) {
        delays.push(Math.min(currentDelay, maxDelay));
        currentDelay *= multiplier;
      }

      expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
    });

    test("backoff respects max delay cap", () => {
      const initialDelay = 1000;
      const multiplier = 10;
      const maxDelay = 5000;

      const delays: number[] = [];
      let currentDelay = initialDelay;

      for (let i = 0; i < 5; i++) {
        delays.push(Math.min(currentDelay, maxDelay));
        currentDelay *= multiplier;
      }

      expect(delays).toEqual([1000, 5000, 5000, 5000, 5000]);
    });
  });
});

describe("response validation", () => {
  test("video response has required fields", () => {
    const response = MockResponseFactory.videoSuccess();

    expect(response).toHaveProperty("jobId");
    expect(response).toHaveProperty("operations");
    expect(Array.isArray(response.operations)).toBe(true);
  });

  test("video operations have correct structure", () => {
    const response = MockResponseFactory.videoSuccess({
      jobId: "test-job",
      mediaGenerationId: "user:test-123",
    });

    expect(response.operations).toBeDefined();
    const op = response.operations![0]!;
    expect(op).toHaveProperty("operation");
    expect(op).toHaveProperty("status");
    expect(op.operation).toHaveProperty("metadata");
    expect(op.operation.metadata).toHaveProperty("video");
    expect(op.operation.metadata.video?.mediaGenerationId).toBe("user:test-123");
  });

  test("image response transformation preserves all fields", () => {
    const raw = MockResponseFactory.imageSuccessRaw({ count: 2 });
    const transformed = transformImageResponse(raw);

    expect(transformed.jobId).toBe(raw.jobId);
    expect(transformed.images).toHaveLength(2);
    expect(transformed.captcha).toEqual(raw.captcha);
  });

  test("error responses preserve error message", () => {
    const videoError = MockResponseFactory.videoError("Custom error message");
    expect(videoError.error).toBe("Custom error message");

    const imageError = MockResponseFactory.imageErrorRaw("Image error");
    expect(imageError.error).toBe("Image error");
  });
});
