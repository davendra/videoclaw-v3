/**
 * Unit tests for useapi.net response transformation
 *
 * These tests verify the transformImageResponse function that converts
 * raw API responses to normalized format. No API calls or credentials needed.
 *
 * Run with: bun test tests/useapi-transform.test.ts
 */

import { describe, test, expect } from "bun:test";
import { transformImageResponse } from "../src/backends/useapi/client";
import type { UseApiImageResponseRaw } from "../src/backends/types";

describe("transformImageResponse", () => {
  test("transforms raw API response to normalized format", () => {
    const raw: UseApiImageResponseRaw = {
      jobId: "job-123",
      media: [
        {
          name: "image-1",
          workflowId: "workflow-1",
          image: {
            generatedImage: {
              seed: 182811941,
              mediaGenerationId: "user:2305-abc123",
            },
          },
        },
        {
          name: "image-2",
          workflowId: "workflow-2",
          image: {
            generatedImage: {
              seed: 123456789,
              mediaGenerationId: "user:2305-def456",
            },
          },
        },
      ],
      captcha: {
        service: "ezcaptcha",
        durationMs: 1234,
      },
    };

    const result = transformImageResponse(raw);

    expect(result.jobId).toBe("job-123");
    expect(result.images).toHaveLength(2);
    expect(result.images[0].mediaGenerationId).toBe("user:2305-abc123");
    expect(result.images[0].seed).toBe(182811941);
    expect(result.images[0].name).toBe("image-1");
    expect(result.images[1].mediaGenerationId).toBe("user:2305-def456");
    expect(result.captcha?.service).toBe("ezcaptcha");
  });

  test("handles empty media array", () => {
    const raw: UseApiImageResponseRaw = {
      jobId: "job-empty",
      media: [],
    };

    const result = transformImageResponse(raw);

    expect(result.jobId).toBe("job-empty");
    expect(result.images).toHaveLength(0);
  });

  test("handles missing nested properties gracefully", () => {
    const raw: UseApiImageResponseRaw = {
      jobId: "job-partial",
      media: [
        {
          name: "image-1",
          // Missing image.generatedImage
        },
        {
          name: "image-2",
          image: {
            // Missing generatedImage
          },
        },
        {
          name: "image-3",
          image: {
            generatedImage: {
              // Missing mediaGenerationId
              seed: 12345,
            },
          },
        },
        {
          name: "image-4",
          image: {
            generatedImage: {
              mediaGenerationId: "valid-id",
              seed: 67890,
            },
          },
        },
      ],
    };

    const result = transformImageResponse(raw);

    // Only the valid image should be included
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mediaGenerationId).toBe("valid-id");
    expect(result.images[0].seed).toBe(67890);
  });

  test("preserves error field from raw response", () => {
    const raw: UseApiImageResponseRaw = {
      jobId: "job-error",
      media: [],
      error: "Rate limit exceeded",
    };

    const result = transformImageResponse(raw);

    expect(result.error).toBe("Rate limit exceeded");
  });

  test("handles undefined media array", () => {
    const raw = {
      jobId: "job-no-media",
    } as UseApiImageResponseRaw;

    const result = transformImageResponse(raw);

    expect(result.jobId).toBe("job-no-media");
    expect(result.images).toHaveLength(0);
  });

  test("preserves captcha metadata", () => {
    const raw: UseApiImageResponseRaw = {
      jobId: "job-captcha",
      media: [],
      captcha: {
        service: "capsolver",
        durationMs: 5678,
      },
    };

    const result = transformImageResponse(raw);

    expect(result.captcha).toEqual({
      service: "capsolver",
      durationMs: 5678,
    });
  });
});
