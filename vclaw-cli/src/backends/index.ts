/**
 * Backend abstraction for veo-cli
 * Provides a unified interface for different video generation backends
 */

import type {
  BackendConfig,
  BackendInitOptions,
  VideoBackend,
} from "./types";

// Re-export types
export * from "./types";

/**
 * Create a video backend instance
 *
 * @param type - Backend type to create
 * @param options - Backend initialization options
 * @returns Configured backend instance
 */
export async function createBackend(
  type: "direct" | "useapi",
  options: BackendInitOptions
): Promise<VideoBackend> {
  if (type === "useapi") {
    // Lazy load useapi backend to avoid importing when not needed
    const { UseApiBackend } = await import("./useapi");
    return new UseApiBackend(options);
  } else {
    // Lazy load direct backend (includes puppeteer)
    const { DirectBackend } = await import("./direct");
    return new DirectBackend(options);
  }
}

/**
 * Check if useapi backend is configured via environment variables
 */
export function isUseApiConfigured(): boolean {
  return !!(process.env.USEAPI_API_TOKEN && process.env.USEAPI_ACCOUNT_EMAIL);
}

/**
 * Get useapi configuration from environment variables
 */
export function getUseApiConfig() {
  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    throw new Error("USEAPI_API_TOKEN environment variable is required for useapi backend");
  }
  if (!accountEmail) {
    throw new Error("USEAPI_ACCOUNT_EMAIL environment variable is required for useapi backend");
  }

  return {
    apiToken,
    accountEmail,
    baseUrl: process.env.USEAPI_BASE_URL || "https://api.useapi.net/v1",
    webhookUrl: process.env.USEAPI_WEBHOOK_URL,
  };
}
