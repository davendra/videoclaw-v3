/**
 * Mock HTTP Client for testing useapi.net backend
 *
 * Provides utilities for:
 * - Simulating API responses
 * - Testing error scenarios (429, timeout, invalid responses)
 * - Rate limit simulation
 */

import type {
  UseApiVideoResponse,
  UseApiImageResponseRaw,
  UseApiJobResponse,
  UseApiAccountsResponse,
  UseApiCaptchaProvidersResponse,
} from "../../src/backends/types";

/**
 * Mock response factory for different scenarios
 */
export class MockResponseFactory {
  /**
   * Create a successful video generation response
   */
  static videoSuccess(options: {
    jobId?: string;
    mediaGenerationId?: string;
    prompt?: string;
  } = {}): UseApiVideoResponse {
    return {
      jobId: options.jobId || `mock-job-${Date.now()}`,
      operations: [
        {
          operation: {
            name: `operations/${options.jobId || "mock-job"}/video`,
            metadata: {
              "@type": "type.googleapis.com/VideoGenerationMetadata",
              video: {
                seed: 12345,
                mediaGenerationId: options.mediaGenerationId || `user:mock-${Date.now()}`,
                prompt: options.prompt || "Test prompt",
                fifeUrl: "https://lh3.googleusercontent.com/mock-video",
                servingBaseUri: "https://lh3.googleusercontent.com",
                model: "veo_3_1_fast_ultra",
                isLooped: false,
                aspectRatio: "LANDSCAPE",
              },
            },
          },
          sceneId: "scene-1",
          mediaGenerationId: options.mediaGenerationId || `user:mock-${Date.now()}`,
          status: "COMPLETED",
        },
      ],
      captcha: {
        service: "ezcaptcha",
        taskId: "mock-captcha-task",
        durationMs: 1234,
      },
    };
  }

  /**
   * Create a video error response
   */
  static videoError(message: string = "Video generation failed"): UseApiVideoResponse {
    return {
      jobId: `mock-error-job-${Date.now()}`,
      operations: [],
      error: message,
    };
  }

  /**
   * Create a raw image generation response (before transformation)
   */
  static imageSuccessRaw(options: {
    jobId?: string;
    count?: number;
  } = {}): UseApiImageResponseRaw {
    const count = options.count || 1;
    const media = Array.from({ length: count }, (_, i) => ({
      name: `image-${i + 1}`,
      workflowId: `workflow-${i + 1}`,
      image: {
        generatedImage: {
          seed: Math.floor(Math.random() * 1000000),
          mediaGenerationId: `user:mock-image-${Date.now()}-${i}`,
        },
      },
    }));

    return {
      jobId: options.jobId || `mock-image-job-${Date.now()}`,
      media,
      captcha: {
        service: "ezcaptcha",
        durationMs: 987,
      },
    };
  }

  /**
   * Create an image error response
   */
  static imageErrorRaw(message: string = "Image generation failed"): UseApiImageResponseRaw {
    return {
      jobId: `mock-image-error-${Date.now()}`,
      media: [],
      error: message,
    };
  }

  /**
   * Create a 429 rate limit response
   */
  static rateLimited(retryAfter: number = 60): {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  } {
    return {
      status: 429,
      statusText: "Too Many Requests",
      headers: {
        "Retry-After": String(retryAfter),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Rate limit exceeded. Please wait before retrying.",
        retryAfter,
      }),
    };
  }

  /**
   * Create a timeout scenario config
   */
  static timeout(delayMs: number = 200000): {
    shouldTimeout: true;
    delayMs: number;
  } {
    return {
      shouldTimeout: true,
      delayMs,
    };
  }

  /**
   * Create an invalid/malformed response
   */
  static malformedJson(): {
    status: number;
    body: string;
  } {
    return {
      status: 200,
      body: "{ invalid json response",
    };
  }

  /**
   * Create a response with missing required fields
   */
  static missingFields(): {
    status: number;
    body: string;
  } {
    return {
      status: 200,
      body: JSON.stringify({
        // Missing jobId and operations
        someOtherField: "value",
      }),
    };
  }

  /**
   * Create accounts list response
   */
  static accountsList(emails: string[] = ["test@example.com"]): UseApiAccountsResponse {
    const accounts: UseApiAccountsResponse = {};
    for (const email of emails) {
      accounts[email] = {
        health: "OK",
        created: new Date().toISOString(),
        sessionData: {
          expires: new Date(Date.now() + 86400000).toISOString(),
        },
        project: {
          projectId: "mock-project",
          projectTitle: "Mock Project",
        },
      };
    }
    return accounts;
  }

  /**
   * Create CAPTCHA providers response
   */
  static captchaProviders(options: {
    freeCredits?: number;
    providers?: string[];
  } = {}): UseApiCaptchaProvidersResponse {
    const response: UseApiCaptchaProvidersResponse = {};

    if (options.freeCredits !== undefined) {
      response.freeCaptchaCredits = options.freeCredits;
    }

    if (options.providers) {
      for (const provider of options.providers) {
        if (provider === "EzCaptcha" || provider === "CapSolver" || provider === "YesCaptcha") {
          response[provider] = "********masked";
        }
      }
    }

    return response;
  }

  /**
   * Create a job polling response
   */
  static jobStatus(status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED", options: {
    jobId?: string;
    progress?: number;
    error?: string;
  } = {}): UseApiJobResponse {
    return {
      jobId: options.jobId || `mock-job-${Date.now()}`,
      status,
      progress: options.progress,
      error: status === "FAILED" ? (options.error || "Job failed") : undefined,
    };
  }
}

/**
 * Mock fetch implementation for testing
 */
export function createMockFetch(responses: Map<string, any>): typeof fetch {
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method || "GET";
    const key = `${method}:${new URL(url).pathname}`;

    const mockResponse = responses.get(key);

    if (!mockResponse) {
      throw new Error(`No mock response configured for ${key}`);
    }

    // Handle timeout scenario
    if (mockResponse.shouldTimeout) {
      await new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), mockResponse.delayMs)
      );
    }

    // Handle rate limit
    if (mockResponse.status === 429) {
      return new Response(mockResponse.body, {
        status: mockResponse.status,
        statusText: mockResponse.statusText,
        headers: new Headers(mockResponse.headers),
      });
    }

    // Handle malformed response
    if (typeof mockResponse.body === "string" && mockResponse.status) {
      return new Response(mockResponse.body, {
        status: mockResponse.status,
      });
    }

    // Normal JSON response
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
    });
  };
  return mockFetch as typeof fetch;
}

/**
 * Simulate network conditions
 */
export const NetworkConditions = {
  /**
   * Simulate slow network with delay
   */
  slow: (delayMs: number = 5000) => ({
    delay: delayMs,
    jitter: 500,
  }),

  /**
   * Simulate flaky network with random failures
   */
  flaky: (failureRate: number = 0.3) => ({
    failureRate,
    retryAfter: 1000,
  }),

  /**
   * Simulate offline state
   */
  offline: () => ({
    error: new Error("Network request failed"),
  }),
};

export default {
  MockResponseFactory,
  createMockFetch,
  NetworkConditions,
};
