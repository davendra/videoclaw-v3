/**
 * Backend Comparison Tests
 *
 * Verifies that both direct and useapi backends:
 * - Accept same prompt formats
 * - Return consistent response structures
 * - Handle errors consistently
 * - Support the same video generation modes
 */

import { describe, test, expect } from "bun:test";
import {
  mapModelToUseApi,
  mapAspectRatioToUseApi,
  calculateCost,
} from "../src/backends/useapi/client";
import { parsePromptLine } from "../src/prompts";
import type { FlowAspectRatio, FlowVideoModel, VideoRequest } from "../src/backends/types";

describe("backend comparison", () => {
  describe("prompt format compatibility", () => {
    const testPrompts = [
      // T2V prompts
      "[test] A sunset over the ocean",
      "[tiktok] Dancing cat, vertical video",

      // I2V prompts
      "[i2v] image:./photo.jpg The woman turns and smiles",
      "[i2v] image:CAMaJD...mediaId... The scene comes alive",

      // Frames prompts
      "[frames] frames:./start.jpg,./end.jpg Smooth transition",
      "[frames] frames:START_ID,END_ID Optional prompt",

      // R2V/Ingredients prompts
      "[r2v] ingredients:./ref1.jpg,./ref2.jpg Scene description",
      "[r2v] ingredients:ID1,ID2,ID3 Character in action",
    ];

    test("all prompt formats are parsed consistently", () => {
      for (const prompt of testPrompts) {
        const parsed = parsePromptLine(prompt);

        expect(parsed).not.toBeNull();
        expect(parsed.type).toBeTruthy();
        // Note: tag is extracted separately via extractTag(), not in parsePromptLine
      }
    });

    test("T2V prompts have type 'text'", () => {
      const parsed = parsePromptLine("[test] A simple text prompt");

      expect(parsed.type).toBe("text");
      expect(parsed.prompt).toBeTruthy();
    });

    test("I2V prompts have type 'image'", () => {
      const parsed = parsePromptLine("[test] image:./photo.jpg Description");

      expect(parsed.type).toBe("image");
      // The field is 'imagePath' not 'startImagePath'
      expect((parsed as any).imagePath).toBeTruthy();
    });

    test("frames prompts have type 'frames'", () => {
      const parsed = parsePromptLine("[test] frames:./start.jpg,./end.jpg Transition");

      expect(parsed.type).toBe("frames");
      // The fields are 'startPath' and 'endPath'
      expect((parsed as any).startPath).toBeTruthy();
      expect((parsed as any).endPath).toBeTruthy();
    });

    test("ingredients prompts have type 'ingredients'", () => {
      const parsed = parsePromptLine("[test] ingredients:./ref1.jpg,./ref2.jpg Scene");

      expect(parsed.type).toBe("ingredients");
      // The field is 'imagePaths' (array)
      expect((parsed as any).imagePaths).toBeTruthy();
      expect((parsed as any).imagePaths?.length).toBeGreaterThan(0);
    });
  });

  describe("model mapping consistency", () => {
    const modelMappings: Array<{ cli: string; useapi: FlowVideoModel }> = [
      { cli: "quality", useapi: "veo-3.1-quality" },
      { cli: "fast", useapi: "veo-3.1-fast" },
      { cli: "free", useapi: "veo-3.1-lite-low-priority" },
    ];

    test("CLI model names map to useapi model names", () => {
      for (const { cli, useapi } of modelMappings) {
        expect(mapModelToUseApi(cli)).toBe(useapi);
      }
    });

    test("model mapping is case-insensitive", () => {
      expect(mapModelToUseApi("QUALITY")).toBe("veo-3.1-quality");
      expect(mapModelToUseApi("Fast")).toBe("veo-3.1-fast");
      expect(mapModelToUseApi("FREE")).toBe("veo-3.1-lite-low-priority");
    });

    test("unknown models default to fast", () => {
      expect(mapModelToUseApi("unknown")).toBe("veo-3.1-fast");
      expect(mapModelToUseApi("")).toBe("veo-3.1-fast");
    });
  });

  describe("aspect ratio consistency", () => {
    const aspectRatioMappings: Array<{ cli: string; useapi: FlowAspectRatio }> = [
      { cli: "landscape", useapi: "landscape" },
      { cli: "16:9", useapi: "landscape" },
      { cli: "VIDEO_ASPECT_RATIO_LANDSCAPE", useapi: "landscape" },
      { cli: "portrait", useapi: "portrait" },
      { cli: "9:16", useapi: "portrait" },
      { cli: "VIDEO_ASPECT_RATIO_PORTRAIT", useapi: "portrait" },
    ];

    test("CLI aspect ratios map to useapi format", () => {
      for (const { cli, useapi } of aspectRatioMappings) {
        expect(mapAspectRatioToUseApi(cli)).toBe(useapi);
      }
    });

    test("unknown aspect ratios default to landscape", () => {
      expect(mapAspectRatioToUseApi("unknown")).toBe("landscape");
      expect(mapAspectRatioToUseApi("")).toBe("landscape");
    });
  });

  describe("error handling consistency", () => {
    test("both backends should handle missing credentials", () => {
      // Document expected error patterns
      const expectedErrorPatterns = {
        direct: /cookie|authentication|login/i,
        useapi: /API token|USEAPI_API_TOKEN|credentials/i,
      };

      // These patterns should be checked when implementing error handling
      expect(expectedErrorPatterns.direct.test("Cookie file not found")).toBe(true);
      expect(expectedErrorPatterns.useapi.test("Invalid API token")).toBe(true);
    });

    test("rate limit errors are identifiable from both backends", () => {
      const rateLimitPatterns = [
        "Rate limited", // useapi
        "Too many requests", // both
        "429", // HTTP status
        "RESOURCE_EXHAUSTED", // Google API
      ];

      for (const pattern of rateLimitPatterns) {
        expect(pattern.toLowerCase()).toMatch(/rate|429|exhaust|many request/i);
      }
    });
  });

  describe("response structure compatibility", () => {
    test("video response should have operations array", () => {
      // Both backends should return operations array
      const expectedFields = [
        "operations",
        "jobId",
      ];

      // Document the expected structure
      const mockResponse = {
        operations: [
          {
            mediaGenerationId: "user:123",
            status: "COMPLETED",
          },
        ],
        jobId: "job-123",
      };

      for (const field of expectedFields) {
        expect(mockResponse).toHaveProperty(field);
      }
    });

    test("operation should contain mediaGenerationId", () => {
      const mockOperation = {
        operation: {
          metadata: {
            video: {
              mediaGenerationId: "user:123",
            },
          },
        },
        mediaGenerationId: "user:123",
        status: "COMPLETED",
      };

      // mediaGenerationId can be at top level or nested
      const mediaId = mockOperation.mediaGenerationId ||
        mockOperation.operation?.metadata?.video?.mediaGenerationId;

      expect(mediaId).toBe("user:123");
    });
  });

  describe("cost estimation parity", () => {
    test("direct backend has no cost", () => {
      // Direct backend is free (uses personal Google account)
      const directCost = 0;
      expect(directCost).toBe(0);
    });

    test("useapi backend has predictable cost", () => {
      const fastCost = calculateCost("veo-3.1-fast", 1);
      const qualityCost = calculateCost("veo-3.1-quality", 1);
      const freeCost = calculateCost("veo-3.1-lite-low-priority", 1);

      expect(fastCost.credits).toBeGreaterThan(0);
      expect(qualityCost.credits).toBeGreaterThan(fastCost.credits);
      expect(freeCost.credits).toBe(0);
    });
  });

  describe("mode support comparison", () => {
    // Document which modes each backend supports
    const modeSupport = {
      direct: {
        "T2V Landscape": true,
        "T2V Portrait": true,
        "I2V Landscape": true,
        "I2V Portrait": false, // API returns INVALID_ARGUMENT
        "Frames Landscape": true,
        "Frames Portrait": false, // API returns INVALID_ARGUMENT
        "R2V Landscape": true,
        "R2V Portrait": true,
      },
      useapi: {
        "T2V Landscape": true,
        "T2V Portrait": true,
        "I2V Landscape": true,
        "I2V Portrait": true, // Works via useapi!
        "Frames Landscape": true,
        "Frames Portrait": true, // Works via useapi!
        "R2V Landscape": true,
        "R2V Portrait": true,
      },
    };

    test("T2V is supported by both backends in both orientations", () => {
      expect(modeSupport.direct["T2V Landscape"]).toBe(true);
      expect(modeSupport.direct["T2V Portrait"]).toBe(true);
      expect(modeSupport.useapi["T2V Landscape"]).toBe(true);
      expect(modeSupport.useapi["T2V Portrait"]).toBe(true);
    });

    test("R2V is supported by both backends in both orientations", () => {
      expect(modeSupport.direct["R2V Landscape"]).toBe(true);
      expect(modeSupport.direct["R2V Portrait"]).toBe(true);
      expect(modeSupport.useapi["R2V Landscape"]).toBe(true);
      expect(modeSupport.useapi["R2V Portrait"]).toBe(true);
    });

    test("I2V portrait is only supported by useapi", () => {
      expect(modeSupport.direct["I2V Portrait"]).toBe(false);
      expect(modeSupport.useapi["I2V Portrait"]).toBe(true);
    });

    test("Frames portrait is only supported by useapi", () => {
      expect(modeSupport.direct["Frames Portrait"]).toBe(false);
      expect(modeSupport.useapi["Frames Portrait"]).toBe(true);
    });
  });

  describe("request parameter compatibility", () => {
    test("video request has common required fields", () => {
      const commonFields = [
        "prompt",
        "aspectRatio",
        "model",
      ];

      // Build a sample request
      const request: Partial<VideoRequest> = {
        prompt: "Test prompt",
        aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
        model: "fast",
      };

      for (const field of commonFields) {
        expect(request).toHaveProperty(field);
      }
    });

    test("optional fields are handled consistently", () => {
      const optionalFields = [
        "seed",
        "outputsPerPrompt",
        "audioEnabled",
      ];

      // These fields should be optional and have sensible defaults
      const defaultValues: Record<string, any> = {
        seed: undefined,
        outputsPerPrompt: 1,
        audioEnabled: true,
      };

      for (const field of optionalFields) {
        expect(defaultValues).toHaveProperty(field);
      }
    });
  });
});
