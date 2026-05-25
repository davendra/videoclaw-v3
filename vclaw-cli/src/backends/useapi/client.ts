/**
 * HTTP Client for useapi.net REST API
 * Handles authentication, requests, and response parsing
 * Includes caching layer for image uploads
 */

import { readFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import { isQuietMode, log } from "../../config";
import { getImageCache, setImageCache, hashFileContents } from "../../db-unified";
import type {
  FlowVideoModel,
  FlowDuration,
  FlowAspectRatio,
  UseApiVideoParams,
  UseApiVideoResponse,
  UseApiJobResponse,
  UseApiAccountsResponse,
  UseApiImageUploadResponse,
  UseApiVideoUploadResponse,
  UseApiCaptchaConfig,
  UseApiCaptchaProvidersResponse,
  AccountTier,
  // Extended features types
  UseApiImageParams,
  UseApiImageResponse,
  UseApiImageResponseRaw,
  UseApiImageUpscaleParams,
  UseApiImageUpscaleResponse,
  UseApiVideoGifParams,
  UseApiVideoGifResponse,
  UseApiVideoUpscaleParams,
  UseApiVideoUpscaleResponse,
  UseApiVideoExtendParams,
  UseApiVideoConcatParams,
  UseApiVideoConcatResponse,
} from "../types";

// Timeout configuration
const TIMEOUT = {
  generation: 600_000,  // 10 minutes for video generation (I2V takes longer)
  polling: 600_000,     // 10 minutes max polling time
  upload: 60_000,       // 1 minute for image upload
  account: 180_000,     // 3 minutes for account operations (registration requires Google OAuth validation)
  imageGen: 120_000,    // 2 minutes for image generation
  upscale: 300_000,     // 5 minutes for live upscaling operations
  gif: 60_000,          // 1 minute for GIF conversion (no CAPTCHA, faster)
  other: 15_000,        // 15 seconds for other calls
};

// Polling configuration
const POLL_INTERVAL = 3_000;  // 3 seconds between polls

// Retry configuration for rate limiting (429) and service unavailable (503)
// Based on useapi.net docs: "wait 5-10 seconds before retrying"
const RETRY = {
  maxAttempts: 5,           // Maximum retry attempts
  initialDelayMs: 5_000,    // Initial delay: 5 seconds (as recommended by useapi.net)
  maxDelayMs: 120_000,      // Maximum delay: 2 minutes (increased for heavy rate limiting)
  backoffMultiplier: 1.5,   // Exponential backoff multiplier
  jitterMs: 1_000,          // Random jitter to avoid thundering herd
};

// Sliding window configuration for adaptive rate limiting
const SLIDING_WINDOW = {
  windowMs: 5 * 60 * 1000,  // 5 minute window
  thresholds: {
    light: 3,               // 3+ rate limits = light throttling
    moderate: 6,            // 6+ rate limits = moderate throttling
    heavy: 10,              // 10+ rate limits = heavy throttling
  },
  multipliers: {
    light: 1.5,             // 1.5x delay for light throttling
    moderate: 2.5,          // 2.5x delay for moderate throttling
    heavy: 4.0,             // 4x delay for heavy throttling
  },
};

/**
 * Retryable HTTP status codes
 * 429 = Rate Limited (temporary capacity)
 * 503 = Service Unavailable (temporary capacity)
 */
const RETRYABLE_STATUS_CODES = [429, 503];

/**
 * Sliding window rate limit tracker
 * Tracks rate limit events to adaptively adjust backoff delays
 */
class RateLimitTracker {
  private events: number[] = [];

  /**
   * Record a rate limit event
   */
  recordEvent(): void {
    this.events.push(Date.now());
    this.cleanup();
  }

  /**
   * Remove events outside the sliding window
   */
  private cleanup(): void {
    const cutoff = Date.now() - SLIDING_WINDOW.windowMs;
    this.events = this.events.filter(t => t > cutoff);
  }

  /**
   * Get count of rate limit events in the window
   */
  getEventCount(): number {
    this.cleanup();
    return this.events.length;
  }

  /**
   * Get delay multiplier based on recent rate limit frequency
   */
  getDelayMultiplier(): number {
    const count = this.getEventCount();

    if (count >= SLIDING_WINDOW.thresholds.heavy) {
      return SLIDING_WINDOW.multipliers.heavy;
    } else if (count >= SLIDING_WINDOW.thresholds.moderate) {
      return SLIDING_WINDOW.multipliers.moderate;
    } else if (count >= SLIDING_WINDOW.thresholds.light) {
      return SLIDING_WINDOW.multipliers.light;
    }

    return 1.0; // No throttling
  }

  /**
   * Get throttling level name for logging
   */
  getThrottleLevel(): string {
    const count = this.getEventCount();

    if (count >= SLIDING_WINDOW.thresholds.heavy) {
      return "heavy";
    } else if (count >= SLIDING_WINDOW.thresholds.moderate) {
      return "moderate";
    } else if (count >= SLIDING_WINDOW.thresholds.light) {
      return "light";
    }

    return "none";
  }
}

// Global rate limit tracker (shared across all requests)
const rateLimitTracker = new RateLimitTracker();

/**
 * Sleep for a specified number of milliseconds
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for retry attempt with exponential backoff, jitter, and adaptive throttling
 */
function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = RETRY.initialDelayMs * Math.pow(RETRY.backoffMultiplier, attempt - 1);
  const jitter = Math.random() * RETRY.jitterMs;

  // Apply sliding window multiplier for adaptive throttling
  const multiplier = rateLimitTracker.getDelayMultiplier();
  const adaptiveDelay = (exponentialDelay + jitter) * multiplier;

  return Math.min(adaptiveDelay, RETRY.maxDelayMs);
}

/**
 * useapi.net HTTP Client
 */
export class UseApiClient {
  private baseUrl: string;
  private apiToken: string;
  private accountEmail: string;

  constructor(config: { apiToken: string; accountEmail: string; baseUrl?: string }) {
    this.apiToken = config.apiToken;
    this.accountEmail = config.accountEmail;
    this.baseUrl = config.baseUrl || "https://api.useapi.net/v1";
  }

  /**
   * Make an authenticated request to useapi.net with automatic retry for rate limiting
   *
   * Retry behavior (based on useapi.net docs):
   * - 429 (Rate Limited) and 503 (Service Unavailable) are automatically retried
   * - Initial wait: 5 seconds, exponential backoff up to 60 seconds
   * - Maximum 5 retry attempts before failing
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: any,
    timeoutMs: number = TIMEOUT.other
  ): Promise<T> {
    let lastError: Error | null = null;
    let consecutiveRateLimits = 0;

    for (let attempt = 1; attempt <= RETRY.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = `${this.baseUrl}${path}`;
        const headers: Record<string, string> = {
          "Authorization": `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        };

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const responseText = await response.text();

        if (!response.ok) {
          // Try to parse error message from response
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = JSON.parse(responseText);
            if (errorData.error) {
              // Handle both string and object error formats
              errorMessage = typeof errorData.error === "string"
                ? errorData.error
                : JSON.stringify(errorData.error);
            } else if (errorData.message) {
              errorMessage = typeof errorData.message === "string"
                ? errorData.message
                : JSON.stringify(errorData.message);
            }
          } catch {
            if (responseText) {
              errorMessage = responseText.substring(0, 200);
            }
          }

          // Check for retryable status codes (429, 503)
          if (RETRYABLE_STATUS_CODES.includes(response.status)) {
            consecutiveRateLimits++;
            rateLimitTracker.recordEvent(); // Track for adaptive throttling
            const delay = calculateRetryDelay(attempt);
            const throttleLevel = rateLimitTracker.getThrottleLevel();

            // Log retry attempt (respects quiet mode)
            if (!isQuietMode()) {
              const throttleInfo = throttleLevel !== "none"
                ? ` [${throttleLevel} throttling: ${rateLimitTracker.getEventCount()} events in 5min]`
                : "";
              console.log(
                `⏳ ${response.status === 429 ? "Rate limited" : "Service unavailable"} ` +
                `(attempt ${attempt}/${RETRY.maxAttempts}). Retrying in ${(delay / 1000).toFixed(1)}s...${throttleInfo}`
              );

              // If heavy throttling, warn about cool-off
              if (throttleLevel === "heavy") {
                console.log(
                  `⚠️  Heavy rate limiting detected. Delays automatically increased.`
                );
              }
            }

            lastError = new Error(
              `Rate limited: ${errorMessage}. Attempt ${attempt}/${RETRY.maxAttempts}.`
            );

            // Wait before retry (only if not the last attempt)
            if (attempt < RETRY.maxAttempts) {
              await sleep(delay);
              continue;
            }
          }

          // Non-retryable errors - fail immediately
          if (response.status === 401) {
            throw new Error(`Authentication failed: Invalid API token. Check USEAPI_API_TOKEN.`);
          }
          if (response.status === 403) {
            throw new Error(`Access denied: ${errorMessage}. Check your useapi.net subscription.`);
          }
          if (response.status === 402) {
            throw new Error(`Payment required: ${errorMessage}. Check your useapi.net balance.`);
          }

          throw new Error(errorMessage);
        }

        // Success - reset rate limit counter
        consecutiveRateLimits = 0;

        // Parse response
        try {
          return JSON.parse(responseText) as T;
        } catch {
          throw new Error(`Invalid JSON response from useapi.net: ${responseText.substring(0, 200)}`);
        }
      } catch (error) {
        // Handle abort/timeout separately
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
        }

        // If it's a retryable error we just set, continue to next iteration
        if (lastError && attempt < RETRY.maxAttempts) {
          continue;
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    // All retries exhausted
    throw lastError || new Error(
      `All ${RETRY.maxAttempts} retry attempts failed. ` +
      `The API may be experiencing high load. Try again later or use a longer cool-off period.`
    );
  }

  /**
   * List all accounts registered with useapi.net
   * GET /google-flow/accounts
   *
   * Returns a map keyed by email address with account summaries.
   * Returns empty object {} if no accounts configured.
   *
   * Response includes for each account:
   * - health: "OK" or error description
   * - error: Error message if health check failed
   * - created: ISO 8601 creation timestamp
   * - sessionData.expires: Session expiration
   * - project.projectId/projectTitle: Auto-created project info
   * - nextRefresh.scheduledFor: Next session refresh time
   *
   * @throws Error 401 if API token is invalid
   */
  async getAccounts(): Promise<UseApiAccountsResponse> {
    return this.request<UseApiAccountsResponse>("GET", "/google-flow/accounts");
  }

  /**
   * Get health status of a specific account
   * Uses the accounts endpoint and extracts health for the specified email
   */
  async getAccountHealth(email: string): Promise<{
    status: string;
    tier: AccountTier;
    captchaCredits?: number;
    message?: string;
  }> {
    // Get all accounts and find the one matching the email
    const accounts = await this.getAccounts();
    const accountInfo = accounts[email];

    if (!accountInfo) {
      return {
        status: "not_found",
        tier: "unknown",
        message: `Account ${email} not registered with useapi.net`,
      };
    }

    // Get CAPTCHA credits from captcha-providers endpoint
    let captchaCredits: number | undefined;
    try {
      const captchaResponse = await this.getCaptchaProviders();
      if (typeof captchaResponse.freeCaptchaCredits === "number") {
        captchaCredits = captchaResponse.freeCaptchaCredits;
      }
    } catch {
      // Ignore captcha credits errors
    }

    // Determine status from health field
    const healthStatus = accountInfo.health === "OK" ? "active" : "error";

    return {
      status: healthStatus,
      tier: "unknown", // Tier is not available in API response
      captchaCredits,
      message: accountInfo.health !== "OK" ? accountInfo.health : undefined,
    };
  }

  /**
   * Add a new Google account using cookies
   * POST /google-flow/accounts
   *
   * Registers a Google account for use with useapi.net video generation.
   * Each account auto-creates an associated Google Flow project.
   * Session tokens are automatically refreshed 1 hour prior to expiration.
   *
   * @param cookiesPath - Path to cookies file (JSON from Puppeteer or tab-separated from Chrome DevTools)
   * @param dryRun - If true, validate cookies without actually registering
   *
   * @returns Success indicator and message
   *
   * @throws Error with specific message for common failures:
   *   - 400: Invalid or missing cookies
   *   - 401: Invalid API token
   *   - 402: Subscription expired or insufficient credits
   */
  async addAccount(cookiesPath: string, dryRun: boolean = false): Promise<{ success: boolean; message: string }> {
    if (!existsSync(cookiesPath)) {
      throw new Error(`Cookie file not found: ${cookiesPath}`);
    }

    const cookiesContent = await readFile(cookiesPath, "utf-8");
    let cookiesTable: string;

    // Check if it's JSON format (Puppeteer) or tab-separated (Chrome DevTools)
    const trimmed = cookiesContent.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      // JSON format - convert to tab-separated
      const cookiesJson = JSON.parse(cookiesContent);
      cookiesTable = cookiesJson
        .map((c: {
          name: string;
          value: string;
          domain: string;
          path: string;
          expires?: number;
          size?: number;
          httpOnly?: boolean;
          secure?: boolean;
          sameSite?: string;
          priority?: string;
        }) => {
          const expires = c.expires && c.expires > 0
            ? new Date(c.expires * 1000).toISOString()
            : "Session";
          return [
            c.name,
            c.value,
            c.domain,
            c.path,
            expires,
            c.size || c.value.length,
            c.httpOnly ? "✓" : "",
            c.secure ? "✓" : "",
            c.sameSite || "None",
            "", // Partition Key
            c.priority || "Medium",
          ].join("\t");
        })
        .join("\n");
    } else {
      // Already tab-separated format from Chrome DevTools - use as-is
      cookiesTable = cookiesContent;
    }

    try {
      const response = await this.request<Record<string, any>>(
        "POST",
        "/google-flow/accounts",
        { cookies: cookiesTable, dryRun },
        TIMEOUT.account
      );

      // API returns { accountCookies, sessionCookies } on success (200 OK)
      // Normalize to { success, message } for callers
      if (response.accountCookies || response.sessionCookies) {
        const numAccount = Array.isArray(response.accountCookies) ? response.accountCookies.length : 0;
        const numSession = Array.isArray(response.sessionCookies) ? response.sessionCookies.length : 0;
        return {
          success: true,
          message: `Parsed ${numAccount} account cookies and ${numSession} session cookies`,
        };
      }

      // Fallback: check for explicit success/message fields
      if ('success' in response) {
        return {
          success: Boolean(response.success),
          message: response.message || response.error || "",
        };
      }

      // Unknown response format - throw with details for debugging
      throw new Error(
        `Unexpected API response format. Keys: ${Object.keys(response).join(', ')}. ` +
        `Response: ${JSON.stringify(response).substring(0, 300)}`
      );
    } catch (error) {
      // Enhance error message for common OAuth issues
      const errMsg = error instanceof Error ? error.message : String(error);

      if (errMsg.includes("OAuth stuck") || errMsg.includes("login page") || errMsg.includes("signin/identifier")) {
        throw new Error(
          `Cookie registration failed: OAuth flow stuck on login page.

This usually means the cookies weren't exported correctly. Follow these steps:

1. Clear ALL browser cookies first
2. Login to https://labs.google/fx/tools/flow FIRST
3. During 2FA, CHECK "Don't ask again on this device"
4. Then navigate to https://myaccount.google.com
5. Export cookies from accounts.google.com domain:
   - Open DevTools (F12) > Application > Cookies > accounts.google.com
   - Select all cookies (Ctrl/Cmd+A) and copy (Ctrl/Cmd+C)
   - Save as tab-separated text file
6. Run this command again with the new cookies file

Original error: ${errMsg}`
        );
      }

      if (errMsg.includes("Session") || errMsg.includes("expired") || errMsg.includes("invalid")) {
        throw new Error(
          `Cookie registration failed: Session appears to be invalid or expired.

Your cookies may be stale. Please:
1. Clear browser cookies
2. Log in to Google Flow again
3. Export fresh cookies
4. Try registration again

Original error: ${errMsg}`
        );
      }

      throw error;
    }
  }

  /**
   * Configure CAPTCHA provider for all accounts
   * POST /google-flow/accounts/captcha-providers
   *
   * Providers are specified by their exact API names:
   * - "EzCaptcha" - Best success rate, ~$2.50/1000
   * - "CapSolver" - Good alternative, ~$3.00/1000
   * - "YesCaptcha" - Also supported
   *
   * Set apiKey to empty string "" to remove a provider.
   *
   * @param config.provider - Provider name (EzCaptcha, CapSolver, YesCaptcha)
   * @param config.apiKey - API key for the provider, or "" to remove
   *
   * @returns Response with configured/masked keys
   *
   * @throws Error with specific message for common failures:
   *   - 400: Invalid provider name
   *   - 401: Invalid API token
   */
  async configureCaptcha(
    config: UseApiCaptchaConfig
  ): Promise<UseApiCaptchaProvidersResponse> {
    try {
      const body = {
        [config.provider]: config.apiKey,
      };
      return await this.request<UseApiCaptchaProvidersResponse>(
        "POST",
        `/google-flow/accounts/captcha-providers`,
        body
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 400 means invalid provider name
      if (errMsg.includes("400") || errMsg.includes("Bad Request")) {
        throw new Error(
          `CAPTCHA configuration failed: Invalid provider "${config.provider}".\n` +
          `  Reason: ${errMsg}\n` +
          `  Valid providers are: EzCaptcha, CapSolver, YesCaptcha.`
        );
      }

      throw error;
    }
  }

  /**
   * List configured CAPTCHA providers
   * GET /google-flow/accounts/captcha-providers
   *
   * Returns currently configured providers with masked API keys,
   * and/or remaining free CAPTCHA credits.
   *
   * Response variants:
   * - If providers configured: { "EzCaptcha": "xxxx...xxxx", "CapSolver": "xxxx...xxxx" }
   * - If no providers (new account): { "freeCaptchaCredits": 100 }
   * - Mixed (some credits + provider): { "freeCaptchaCredits": 50, "EzCaptcha": "xxxx...xxxx" }
   *
   * @returns Object with masked provider keys and/or freeCaptchaCredits
   *
   * @throws Error 401 if API token is invalid
   */
  async getCaptchaProviders(): Promise<UseApiCaptchaProvidersResponse> {
    return this.request<UseApiCaptchaProvidersResponse>(
      "GET",
      `/google-flow/accounts/captcha-providers`
    );
  }

  /**
   * Upload an image for use in video generation
   * POST /google-flow/assets/{email}
   *
   * Uploads an image for use in I2V, frames, or R2V video generation modes.
   * Returns mediaGenerationId for use in startImage/endImage/referenceImage params.
   *
   * Constraints:
   * - Supported formats: PNG, JPEG only (NOT webp)
   * - Maximum file size: 20MB
   * - Email is optional in path - auto-selects via load balancing if omitted
   *
   * @param imagePath - Local file path to upload
   *
   * @returns Response with mediaGenerationId (may be nested), width, height, email
   *
   * @throws Error with specific message for common failures:
   *   - 400: Invalid request (empty, unsupported type, oversized, or content policy)
   *   - 401: Invalid API token
   *   - 404: Account not configured
   *   - 429: Rate limited (retry after 5-10 seconds)
   *   - 596: Session error (reconfigure account)
   */
  async uploadImage(
    imagePath: string
  ): Promise<UseApiImageUploadResponse> {
    if (!existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    // Read image as raw binary
    const imageBuffer = await readFile(imagePath);

    // Check file size (max 20MB)
    const maxSize = 20 * 1024 * 1024;
    if (imageBuffer.length > maxSize) {
      throw new Error(
        `Image file too large: ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB. ` +
        `Maximum allowed: 20MB.`
      );
    }

    // Determine mime type from extension (only PNG and JPEG supported)
    const ext = imagePath.toLowerCase().split(".").pop();
    let mimeType: "image/png" | "image/jpeg";
    if (ext === "png") {
      mimeType = "image/png";
    } else if (ext === "jpg" || ext === "jpeg") {
      mimeType = "image/jpeg";
    } else {
      throw new Error(
        `Unsupported image format: .${ext}. ` +
        `Only PNG and JPEG are supported.`
      );
    }

    // Retry loop for rate limiting (429/503)
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= RETRY.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT.upload);

      try {
        const url = `${this.baseUrl}/google-flow/assets/${encodeURIComponent(this.accountEmail)}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiToken}`,
            "Content-Type": mimeType,
          },
          body: imageBuffer,
          signal: controller.signal,
        });

        const responseText = await response.text();

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = JSON.parse(responseText);
            // v2.11: Handle both string and object error formats
            // This fixes the "[object Object]" error message issue
            if (errorData.error) {
              errorMessage = typeof errorData.error === "string"
                ? errorData.error
                : JSON.stringify(errorData.error);
            } else if (errorData.message) {
              errorMessage = typeof errorData.message === "string"
                ? errorData.message
                : JSON.stringify(errorData.message);
            }
          } catch {
            if (responseText) errorMessage = responseText.substring(0, 200);
          }

          // Check for retryable status codes (429, 503)
          if (RETRYABLE_STATUS_CODES.includes(response.status)) {
            rateLimitTracker.recordEvent(); // Track for adaptive throttling
            const delay = calculateRetryDelay(attempt);
            const throttleLevel = rateLimitTracker.getThrottleLevel();

            if (!isQuietMode()) {
              const throttleInfo = throttleLevel !== "none"
                ? ` [${throttleLevel} throttling]`
                : "";
              console.log(
                `⏳ Image upload ${response.status === 429 ? "rate limited" : "service unavailable"} ` +
                `(attempt ${attempt}/${RETRY.maxAttempts}). Retrying in ${(delay / 1000).toFixed(1)}s...${throttleInfo}`
              );
            }

            lastError = new Error(
              `Image upload rate limited: ${errorMessage}. Attempt ${attempt}/${RETRY.maxAttempts}.`
            );

            if (attempt < RETRY.maxAttempts) {
              clearTimeout(timeout);
              await sleep(delay);
              continue;
            }
          }

          // Non-retryable errors
          if (response.status === 404) {
            throw new Error(
              `Image upload failed: Account "${this.accountEmail}" not configured.\n` +
              `  Reason: ${errorMessage}`
            );
          }
          if (response.status === 596) {
            throw new Error(
              `Image upload failed: Session error.\n` +
              `  Reason: ${errorMessage}\n` +
              `  Reconfigure account - see useapi.net setup docs.`
            );
          }

          throw new Error(`Image upload failed: ${errorMessage}`);
        }

        // Success
        return JSON.parse(responseText) as UseApiImageUploadResponse;
      } finally {
        clearTimeout(timeout);
      }
    }

    // All retries exhausted
    throw lastError || new Error(
      `Image upload failed after ${RETRY.maxAttempts} attempts. ` +
      `The API may be experiencing high load.`
    );
  }

  /**
   * Upload a local MP4 video file to the Google Flow asset library.
   *
   * The returned mediaGenerationId can be passed as `referenceVideo_1` on a
   * POST /videos request with `model: "omni-flash"` to perform a V2V edit.
   *
   * Endpoint: POST /google-flow/assets/{email}
   * Content-Type: video/mp4 (max 100 MB)
   *
   * Response shape (spec §3.4):
   *   { mediaGenerationId: { mediaGenerationId: "user:NNN-email:HEX-video:UUID" },
   *     durationSeconds: 11.94, width: 1280, height: 720, email: "jo***@gmail.com" }
   *
   * Timeout note: we use 5 minutes (300 s) instead of the 1-minute TIMEOUT.upload
   * used for images, because a 100 MB MP4 over a slow connection can take several
   * minutes to transfer to the useapi.net edge node before the response arrives.
   *
   * @param videoPath - Local filesystem path to the MP4 file
   * @returns Parsed UseApiVideoUploadResponse
   *
   * @throws If the file is missing, exceeds 100 MB, or the API returns an error:
   *   - 400: Invalid request (empty, unsupported type, oversized, content policy)
   *   - 401: Invalid API token
   *   - 404: Account not configured
   *   - 413: Payload too large (exceeds server's 100 MB limit)
   *   - 429: Rate limited (retry after 5-10 seconds)
   *   - 596: Session error (reconfigure account)
   */
  async uploadVideo(
    videoPath: string
  ): Promise<UseApiVideoUploadResponse> {
    if (!existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    // Read video as raw binary
    const videoBuffer = await readFile(videoPath);

    // Check file size (max 100 MB per spec §3.4)
    const maxSize = 100 * 1024 * 1024;
    if (videoBuffer.length > maxSize) {
      throw new Error(
        `Video file too large: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB. ` +
        `Maximum allowed: 100MB.`
      );
    }

    // Only MP4 is accepted by the Google Flow asset endpoint
    const ext = videoPath.toLowerCase().split(".").pop();
    if (ext !== "mp4") {
      throw new Error(
        `Unsupported video format: .${ext}. ` +
        `Only MP4 is supported for V2V asset upload.`
      );
    }

    // 5-minute timeout for large video uploads (vs 1-minute for images)
    const VIDEO_UPLOAD_TIMEOUT = 300_000;

    // Retry loop for rate limiting (429/503)
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= RETRY.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VIDEO_UPLOAD_TIMEOUT);

      try {
        const url = `${this.baseUrl}/google-flow/assets/${encodeURIComponent(this.accountEmail)}`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiToken}`,
            "Content-Type": "video/mp4",
          },
          body: videoBuffer,
          signal: controller.signal,
        });

        const responseText = await response.text();

        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorData = JSON.parse(responseText);
            if (errorData.error) {
              errorMessage = typeof errorData.error === "string"
                ? errorData.error
                : JSON.stringify(errorData.error);
            } else if (errorData.message) {
              errorMessage = typeof errorData.message === "string"
                ? errorData.message
                : JSON.stringify(errorData.message);
            }
          } catch {
            if (responseText) errorMessage = responseText.substring(0, 200);
          }

          // Check for retryable status codes (429, 503)
          if (RETRYABLE_STATUS_CODES.includes(response.status)) {
            rateLimitTracker.recordEvent();
            const delay = calculateRetryDelay(attempt);
            const throttleLevel = rateLimitTracker.getThrottleLevel();

            if (!isQuietMode()) {
              const throttleInfo = throttleLevel !== "none"
                ? ` [${throttleLevel} throttling]`
                : "";
              console.log(
                `⏳ Video upload ${response.status === 429 ? "rate limited" : "service unavailable"} ` +
                `(attempt ${attempt}/${RETRY.maxAttempts}). Retrying in ${(delay / 1000).toFixed(1)}s...${throttleInfo}`
              );
            }

            lastError = new Error(
              `Video upload rate limited: ${errorMessage}. Attempt ${attempt}/${RETRY.maxAttempts}.`
            );

            if (attempt < RETRY.maxAttempts) {
              clearTimeout(timeout);
              await sleep(delay);
              continue;
            }
          }

          // Non-retryable errors
          if (response.status === 404) {
            throw new Error(
              `Video upload failed: Account "${this.accountEmail}" not configured.\n` +
              `  Reason: ${errorMessage}`
            );
          }
          if (response.status === 413) {
            throw new Error(
              `Video upload failed: File exceeds server's 100 MB limit.\n` +
              `  Reason: ${errorMessage}`
            );
          }
          if (response.status === 596) {
            throw new Error(
              `Video upload failed: Session error.\n` +
              `  Reason: ${errorMessage}\n` +
              `  Reconfigure account - see useapi.net setup docs.`
            );
          }

          throw new Error(`Video upload failed: ${errorMessage}`);
        }

        // Success
        return JSON.parse(responseText) as UseApiVideoUploadResponse;
      } finally {
        clearTimeout(timeout);
      }
    }

    // All retries exhausted
    throw lastError || new Error(
      `Video upload failed after ${RETRY.maxAttempts} attempts. ` +
      `The API may be experiencing high load.`
    );
  }

  /**
   * Upload image with caching - checks cache before uploading
   * Returns cached mediaId if available, otherwise uploads and caches result
   *
   * @param imagePath - Local file path to upload
   * @param aspectRatio - Target aspect ratio (for cache key)
   * @returns Upload response with fromCache indicator
   */
  async uploadImageWithCache(
    imagePath: string,
    aspectRatio: "landscape" | "portrait" = "landscape"
  ): Promise<UseApiImageUploadResponse & { fromCache: boolean }> {
    if (!existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    // Read file and compute hash
    const fileContent = await readFile(imagePath);
    const fileHash = hashFileContents(fileContent.buffer as ArrayBuffer);
    const fileSize = statSync(imagePath).size;

    // Check cache
    const cached = getImageCache(fileHash, aspectRatio, "useapi");
    if (cached) {
      if (!isQuietMode()) {
        log(`  📦 Using cached mediaId for ${imagePath.split("/").pop()} (hash: ${fileHash.substring(0, 8)}...)`);
      }
      return {
        mediaGenerationId: cached.media_id,
        fromCache: true,
      } as UseApiImageUploadResponse & { fromCache: boolean };
    }

    // Upload image
    if (!isQuietMode()) {
      log(`  ⬆️ Uploading ${imagePath.split("/").pop()} (hash: ${fileHash.substring(0, 8)}...)`);
    }
    const response = await this.uploadImage(imagePath);

    // Extract mediaId (may be nested)
    const mediaId = extractMediaId(response);

    // Store in cache
    setImageCache({
      file_hash: fileHash,
      media_id: mediaId,
      file_path: imagePath,
      file_size: fileSize,
      aspect_ratio: aspectRatio,
      backend: "useapi",
    });

    if (!isQuietMode()) {
      log(`  ✅ Cached mediaId for future use`);
    }

    return { ...response, fromCache: false };
  }

  /**
   * Generate a video using useapi.net
   * POST /google-flow/videos
   *
   * Generation modes:
   * - T2V: Just prompt (text-to-video)
   * - I2V: startImage only (image-to-video)
   * - I2V-FL: startImage + endImage (frames)
   * - R2V: referenceImage_1..3 on Veo (not veo-3.1-quality); _1..7 on omni-flash
   * - V2V: referenceVideo_1 + frame indices (omni-flash only)
   *
   * CONSTRAINTS:
   * - Cannot mix R2V (referenceImage_*) and I2V (startImage/endImage)
   * - endImage requires startImage
   * - I2V/I2V-FL only available on Veo models
   * - veo-3.1-quality does not support R2V
   *
   * Timing: Generation typically takes 60-180 seconds
   *
   * @param params.prompt - Required text description
   * @param params.model - Default: veo-3.1-fast
   * @param params.aspectRatio - "landscape" (default) or "portrait"
   * @param params.count - 1-4 variations, default: 1
   * @param params.seed - For reproducibility
   * @param params.startImage - mediaGenerationId for I2V mode
   * @param params.endImage - mediaGenerationId for I2V-FL mode
   * @param params.referenceImage_1 to _3 - For R2V mode
   * @param params.async - Fire-and-forget mode (returns 201)
   * @param params.captchaRetry - 1-10, default: 3
   *
   * @returns Video with signed URLs (fifeUrl ~24h valid)
   *
   * @throws Error with specific message for common failures:
   *   - 400: Mode conflict or content policy
   *   - 402: Insufficient credits
   *   - 403: Google rejection - increase captchaRetry
   *   - 408: Generation timeout (10 min)
   *   - 429: Rate limit - wait 5-10 seconds
   *   - 596: Session error - reconfigure account
   */
  async generateVideo(params: UseApiVideoParams): Promise<UseApiVideoResponse> {
    const validation = validateFlowVideoRequest(params);
    if (!validation.ok) {
      throw new Error(
        `Video generation request is invalid:\n  - ${validation.errors.join("\n  - ")}`
      );
    }
    for (const w of validation.warnings) {
      console.warn(`[useapi] warning: ${w}`);
    }

    try {
      return await this.request<UseApiVideoResponse>(
        "POST",
        `/google-flow/videos`,
        params,
        TIMEOUT.generation
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 400 often means mode conflict or content policy violation
      if (errMsg.includes("400") || errMsg.includes("Bad Request")) {
        throw new Error(
          `Video generation failed: Validation error or content policy violation. ${errMsg}`
        );
      }

      // 408 means timeout
      if (errMsg.includes("408") || errMsg.includes("timeout")) {
        throw new Error(
          `Video generation timed out after 10 minutes.\n` +
          `  Reason: ${errMsg}\n` +
          `  Try again or use async mode with polling.`
        );
      }

      // 429 means rate limit
      if (errMsg.includes("429") || errMsg.includes("Rate limited")) {
        throw new Error(
          `Video generation rate limited.\n` +
          `  Reason: ${errMsg}\n` +
          `  Wait 5-10 seconds and retry.`
        );
      }

      // 403 means Google rejected
      if (errMsg.includes("403") || errMsg.includes("Access denied")) {
        throw new Error(
          `Video generation failed: Google rejected the request.\n` +
          `  Reason: ${errMsg}\n` +
          `  Try increasing captchaRetry (current: ${params.captchaRetry ?? 3}, max: 10) or re-registering cookies.`
        );
      }

      // 596 means session error
      if (errMsg.includes("596") || errMsg.includes("Session")) {
        throw new Error(
          `Video generation failed: Session error.\n` +
          `  Reason: ${errMsg}\n` +
          `  Reconfigure account - see useapi.net setup docs.`
        );
      }

      throw error;
    }
  }

  /**
   * Get job status
   * GET /google-flow/jobs/{jobId}
   *
   * Retrieves status and details of image or video generation jobs.
   * Video jobs return signed URLs valid for ~24 hours.
   * Jobs are retained for 7 days.
   *
   * Status values:
   * - "created": Job created, not yet started
   * - "started": Job in progress
   * - "completed": Job finished successfully
   * - "failed": Job failed
   *
   * @param jobId - Unique job identifier from POST requests
   *
   * @throws Error with specific message for common failures:
   *   - 400: Invalid job ID format
   *   - 401: Invalid API token
   *   - 403: Access denied (different user's job)
   *   - 404: Job not found
   *   - 410: Job expired (7-day retention)
   */
  async getJobStatus(jobId: string): Promise<UseApiJobResponse> {
    try {
      return await this.request<UseApiJobResponse>(
        "GET",
        `/google-flow/jobs/${jobId}`
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 403 means access denied (different user's job)
      if (errMsg.includes("403") || errMsg.includes("Access denied")) {
        throw new Error(
          `Job status failed: Access denied.\n` +
          `  Reason: ${errMsg}\n` +
          `  Job "${jobId}" may belong to a different user.`
        );
      }

      // 404 means job not found
      if (errMsg.includes("404") || errMsg.includes("Not Found")) {
        throw new Error(
          `Job status failed: Job "${jobId}" not found.\n` +
          `  Reason: ${errMsg}`
        );
      }

      // 410 means job expired
      if (errMsg.includes("410") || errMsg.includes("Gone")) {
        throw new Error(
          `Job status failed: Job "${jobId}" has expired (7-day retention).\n` +
          `  Reason: ${errMsg}`
        );
      }

      throw error;
    }
  }

  /**
   * Poll job until completion or timeout
   * Uses GET /google-flow/jobs/{jobId} repeatedly
   *
   * @param jobId - Job ID to poll
   * @param onProgress - Optional callback for progress updates
   */
  async pollJob(
    jobId: string,
    onProgress?: (status: string, progress?: number) => void
  ): Promise<UseApiJobResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < TIMEOUT.polling) {
      const job = await this.getJobStatus(jobId);

      if (onProgress) {
        onProgress(job.status, job.progress);
      }

      // Check for completion (API may use different casing)
      const status = job.status.toLowerCase();
      if (status === "completed") {
        return job;
      }

      if (status === "failed") {
        const errorMsg = job.error || job.result?.error || "Job failed";
        throw new Error(errorMsg);
      }

      // Wait before next poll
      await Bun.sleep(POLL_INTERVAL);
    }

    throw new Error(`Job polling timed out after ${TIMEOUT.polling / 1000}s`);
  }

  /**
   * Get session status for a specific account
   * Uses GET /google-flow/accounts and extracts session expiry info
   *
   * @param email - Account email to check session for
   * @returns Session status with expiry details
   */
  async getSessionStatus(email: string): Promise<{
    status: "active" | "expiring_soon" | "expired" | "unknown";
    expiresAt: string | null;
    hoursRemaining: number | null;
    nextRefresh: string | null;
  }> {
    const accounts = await this.getAccounts();
    const accountInfo = accounts[email];

    if (!accountInfo) {
      return { status: "unknown", expiresAt: null, hoursRemaining: null, nextRefresh: null };
    }

    const nextRefresh = accountInfo.nextRefresh?.scheduledFor ?? null;

    if (!accountInfo.sessionData?.expires) {
      return { status: "unknown", expiresAt: null, hoursRemaining: null, nextRefresh };
    }

    const expiresAt = accountInfo.sessionData.expires;
    const expiresDate = new Date(expiresAt);
    const now = new Date();
    const msRemaining = expiresDate.getTime() - now.getTime();
    const hoursRemaining = Math.round((msRemaining / (1000 * 60 * 60)) * 10) / 10;

    if (msRemaining <= 0) {
      return { status: "expired", expiresAt, hoursRemaining: 0, nextRefresh };
    }

    // Less than 6 hours remaining = expiring soon
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (msRemaining < SIX_HOURS_MS) {
      return { status: "expiring_soon", expiresAt, hoursRemaining, nextRefresh };
    }

    return { status: "active", expiresAt, hoursRemaining, nextRefresh };
  }

  /**
   * Get account email configured for this client
   */
  getAccountEmail(): string {
    return this.accountEmail;
  }

  // ============================================================================
  // Extended Features - Image Generation
  // ============================================================================

  /**
   * Generate images using Imagen-4, nano-banana, or nano-banana-pro models
   * POST /google-flow/images
   *
   * Model selection:
   * - imagen-4: Best for text-to-image, max 3 references
   * - nano-banana: Character consistency, max 3 references
   * - nano-banana-pro: Maximum references (10), upscale-able, Ultra tier only
   *
   * Timing: Generation typically completes within 10-20 seconds
   * Concurrency: 3-20 parallel generations depending on capacity
   *
   * @param params.prompt - Required text description
   * @param params.model - Default: imagen-4
   * @param params.aspectRatio - "landscape" (default) or "portrait"
   * @param params.count - 1-4 images, default: 4
   * @param params.seed - For reproducible results
   * @param params.reference_1 to reference_10 - mediaGenerationId values
   * @param params.replyUrl - Webhook URL for callbacks
   * @param params.captchaRetry - 1-10, default: 3
   *
   * @throws Error with specific message for common failures:
   *   - 400: Content policy violation
   *   - 402: Insufficient credits
   *   - 403: Google rejection - increase captchaRetry
   *   - 429: Rate limit - wait 5-10 seconds
   *   - 500: Content moderation - retry or modify prompt
   *   - 596: Session error - cookie refresh required
   */
  async generateImage(params: UseApiImageParams): Promise<UseApiImageResponse> {
    try {
      const rawResponse = await this.request<UseApiImageResponseRaw>(
        "POST",
        `/google-flow/images`,
        params,
        TIMEOUT.imageGen
      );

      // Transform raw response to normalized format
      return transformImageResponse(rawResponse);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 500 often means content moderation - suggest retry
      if (errMsg.includes("500") || errMsg.includes("Internal Server")) {
        throw new Error(
          `Image generation failed: Content may have been moderated.\n` +
          `  Reason: ${errMsg}\n` +
          `  Try retrying with the same prompt (moderation decisions vary) or modify the prompt.`
        );
      }

      // 429 means rate limit - suggest waiting
      if (errMsg.includes("429") || errMsg.includes("Rate limited")) {
        throw new Error(
          `Image generation rate limited.\n` +
          `  Reason: ${errMsg}\n` +
          `  Wait 5-10 seconds and retry. Dynamic concurrency is 3-20 parallel generations depending on capacity.`
        );
      }

      // 403 means Google rejected - suggest captchaRetry
      if (errMsg.includes("403") || errMsg.includes("Access denied")) {
        throw new Error(
          `Image generation failed: Google rejected the request.\n` +
          `  Reason: ${errMsg}\n` +
          `  Try increasing captchaRetry (current: ${params.captchaRetry ?? 3}, max: 10) or re-registering cookies.`
        );
      }

      // 596 means session error
      if (errMsg.includes("596") || errMsg.includes("Session")) {
        throw new Error(
          `Image generation failed: Session error.\n` +
          `  Reason: ${errMsg}\n` +
          `  Cookie refresh required - see useapi.net setup docs.`
        );
      }

      throw error;
    }
  }

  /**
   * Upscale an image generated with nano-banana-pro
   * POST /google-flow/images/upscale
   *
   * IMPORTANT: Only images generated with nano-banana-pro model support upscaling!
   *
   * @param params.mediaGenerationId - Must be from nano-banana-pro model
   * @param params.resolution - "2k" (default) or "4k" (requires paid Google account)
   * @param params.captchaRetry - Retry attempts 1-10 (default: 3)
   * @param params.captchaOrder - Comma-separated captcha provider sequence
   *
   * @returns Base64-encoded upscaled image in encodedImage field
   *
   * @throws Error with specific message for common failures:
   *   - 429: "Only nano-banana-pro images can be upscaled"
   *   - 403: "Google rejected request - try increasing captchaRetry"
   *   - 404: "Image not found"
   */
  async upscaleImage(params: UseApiImageUpscaleParams): Promise<UseApiImageUpscaleResponse> {
    try {
      return await this.request<UseApiImageUpscaleResponse>(
        "POST",
        `/google-flow/images/upscale`,
        params,
        TIMEOUT.upscale
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 429 for upscaling means unsupported image model, not rate limiting
      if (errMsg.includes("429") || errMsg.includes("Rate limited")) {
        throw new Error(
          `Image upscaling failed: Only images generated with nano-banana-pro model can be upscaled.\n` +
          `  Reason: ${errMsg}\n` +
          `  The image with mediaGenerationId "${params.mediaGenerationId}" was not created with nano-banana-pro.`
        );
      }

      // 403 means Google rejected - suggest increasing captchaRetry
      if (errMsg.includes("403") || errMsg.includes("Access denied")) {
        throw new Error(
          `Image upscaling failed: Google rejected the request.\n` +
          `  Reason: ${errMsg}\n` +
          `  Try increasing captchaRetry (current: ${params.captchaRetry ?? 3}, max: 10) or re-registering cookies.`
        );
      }

      throw error;
    }
  }

  // ============================================================================
  // Extended Features - Video Processing
  // ============================================================================

  /**
   * Convert a video to GIF format
   * POST /google-flow/videos/gif
   *
   * IMPORTANT: This endpoint does NOT require CAPTCHA! (Free to use)
   *
   * Processing time: Up to 90 seconds
   * Operation: Synchronous (returns immediately upon completion)
   *
   * @param params.mediaGenerationId - Video ID from POST /videos
   *
   * @returns Base64-encoded GIF in encodedGif field
   *
   * @throws Error with specific message for common failures:
   *   - 400: Invalid mediaGenerationId or incorrect reference type
   *   - 404: Video not found
   */
  async videoToGif(params: UseApiVideoGifParams): Promise<UseApiVideoGifResponse> {
    try {
      return await this.request<UseApiVideoGifResponse>(
        "POST",
        `/google-flow/videos/gif`,
        params,
        TIMEOUT.gif
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 400 means invalid mediaGenerationId
      if (errMsg.includes("400") || errMsg.includes("Bad Request")) {
        throw new Error(
          `GIF conversion failed: Invalid mediaGenerationId or incorrect reference type.\n` +
          `  Reason: ${errMsg}\n` +
          `  The mediaGenerationId "${params.mediaGenerationId}" may be invalid.`
        );
      }

      // 404 means video not found
      if (errMsg.includes("404") || errMsg.includes("Not Found")) {
        throw new Error(
          `GIF conversion failed: Video not found.\n` +
          `  Reason: ${errMsg}\n` +
          `  The mediaGenerationId "${params.mediaGenerationId}" may be invalid or expired.`
        );
      }

      throw error;
    }
  }

  /**
   * Upscale a video to higher resolution
   * POST /google-flow/videos/upscale
   *
   * Timing:
   * - 1080p: 30-60 seconds
   * - 4K: a few minutes
   *
   * Cost:
   * - 1080p: Free for all accounts
   * - 4K: 50 credits (~$0.25), Ultra tier only
   *
   * Caching: Re-upscaling identical video returns cached result (free)
   *
   * @param params.mediaGenerationId - Video media ID from POST /videos
   * @param params.resolution - "1080p" (default) or "4k"
   * @param params.async - Fire-and-forget mode (returns 201)
   * @param params.replyUrl - Webhook URL for callbacks
   * @param params.captchaRetry - 1-10, default: 3
   *
   * @returns Upscaled video with signed URLs (fifeUrl ~24h valid)
   *
   * @throws Error with specific message for common failures:
   *   - 403: Google rejected - increase captchaRetry
   *   - 404: Video not found
   *   - 408: Polling timeout (10 min)
   */
  async upscaleVideo(params: UseApiVideoUpscaleParams): Promise<UseApiVideoUpscaleResponse> {
    try {
      return await this.request<UseApiVideoUpscaleResponse>(
        "POST",
        `/google-flow/videos/upscale`,
        params,
        TIMEOUT.upscale
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // 408 means timeout
      if (errMsg.includes("408") || errMsg.includes("timeout")) {
        throw new Error(
          `Video upscaling timed out after 10 minutes.\n` +
          `  Reason: ${errMsg}\n` +
          `  Try again or use async mode with polling.`
        );
      }

      // 404 means video not found
      if (errMsg.includes("404") || errMsg.includes("Not Found")) {
        throw new Error(
          `Video upscaling failed: Video not found.\n` +
          `  Reason: ${errMsg}\n` +
          `  The mediaGenerationId "${params.mediaGenerationId}" may be invalid or expired.`
        );
      }

      // 403 means Google rejected
      if (errMsg.includes("403") || errMsg.includes("Access denied")) {
        throw new Error(
          `Video upscaling failed: Google rejected the request (reCAPTCHA failed).\n` +
          `  Reason: ${errMsg}\n` +
          `  Try increasing captchaRetry (current: ${params.captchaRetry ?? 3}, max: 10) or re-registering cookies.`
        );
      }

      throw error;
    }
  }

  /**
   * Extend a previously generated video with a new prompt.
   * POST /google-flow/videos/extend — CAPTCHA required. Response uses media[].
   */
  async extendVideo(params: UseApiVideoExtendParams): Promise<UseApiVideoResponse> {
    return this.request<UseApiVideoResponse>(
      "POST",
      `/google-flow/videos/extend`,
      params,
      TIMEOUT.generation
    );
  }

  /**
   * Concatenate 2-10 previously generated videos into one.
   * POST /google-flow/videos/concatenate — no CAPTCHA. Returns base64 MP4.
   */
  async concatenateVideos(params: UseApiVideoConcatParams): Promise<UseApiVideoConcatResponse> {
    if (params.media.length < 2 || params.media.length > 10) {
      throw new Error("concatenateVideos requires 2-10 videos.");
    }
    try {
      return await this.request<UseApiVideoConcatResponse>(
        "POST",
        `/google-flow/videos/concatenate`,
        params,
        TIMEOUT.generation
      );
    } catch (error) {
      // The API returns a generic "Concatenation failed" on most rejections.
      // Add an actionable hint: omni-flash videos cannot be concatenated —
      // only Veo-lineage videos can. Confirmed by live-API testing 2026-05-24.
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Concatenation failed") || msg.includes("MEDIA_GENERATION_STATUS_FAILED")) {
        throw new Error(
          `Video concatenation failed. The API rejected the request.\n` +
          `  Common cause: one or more inputs are omni-flash outputs. ` +
          `/videos/concatenate only accepts Veo-lineage videos ` +
          `(veo-3.1-quality / -fast / -lite / -lite-low-priority) and their extensions.\n` +
          `  Original: ${msg}`
        );
      }
      throw error;
    }
  }
}

/**
 * Validate a Google Flow video request against the model x mode x duration
 * matrix BEFORE it is sent — failing fast avoids spending a CAPTCHA credit on a
 * request Google will reject. Returns blocking `errors` and non-blocking
 * `warnings` (e.g. tier requirements that cannot be checked client-side).
 */
export function validateFlowVideoRequest(
  params: UseApiVideoParams
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const model: FlowVideoModel = (params.model as FlowVideoModel) ?? "veo-3.1-fast";
  const VALID_MODELS: FlowVideoModel[] = [
    "veo-3.1-quality", "veo-3.1-fast", "veo-3.1-lite",
    "veo-3.1-lite-low-priority", "omni-flash",
  ];
  if (params.model !== undefined && !VALID_MODELS.includes(model)) {
    errors.push(`Unknown model "${params.model}"; valid values are ${VALID_MODELS.join(", ")}.`);
  }
  const isOmni = model === "omni-flash";
  const duration = params.duration ?? 8;

  const hasStart = !!params.startImage;
  const hasEnd = !!params.endImage;
  const refImages = [
    params.referenceImage_1, params.referenceImage_2, params.referenceImage_3,
    params.referenceImage_4, params.referenceImage_5, params.referenceImage_6,
    params.referenceImage_7,
  ];
  const hasRefImg = refImages.some(Boolean);
  const hasHighRefImg = [
    params.referenceImage_4, params.referenceImage_5,
    params.referenceImage_6, params.referenceImage_7,
  ].some(Boolean);
  const hasRefVideo = !!params.referenceVideo_1;
  const hasVoice1 = !!params.referenceAudio_1;
  const hasHighVoice = [
    params.referenceAudio_2, params.referenceAudio_3,
    params.referenceAudio_4, params.referenceAudio_5,
  ].some(Boolean);

  // Mode conflicts
  if (hasEnd && !hasStart) {
    errors.push("endImage requires startImage (end-frame-only is not supported).");
  }
  if ((hasStart || hasEnd) && hasRefImg) {
    errors.push("Cannot combine I2V (startImage/endImage) with R2V (referenceImage_*).");
  }
  if ((hasStart || hasEnd) && hasRefVideo) {
    errors.push("Cannot combine startImage/endImage with referenceVideo_1 (V2V edit).");
  }
  if (hasRefImg && hasRefVideo) {
    errors.push("Cannot combine referenceImage_* with referenceVideo_1 (V2V edit).");
  }

  // Model x feature rules
  if (isOmni && (hasStart || hasEnd)) {
    errors.push("omni-flash does not support startImage/endImage (frames mode coming soon).");
  }
  if (!isOmni && hasRefVideo) {
    errors.push("referenceVideo_1 (V2V edit) is omni-flash only.");
  }
  if (!isOmni && hasHighRefImg) {
    errors.push("referenceImage_4..7 are omni-flash only; Veo supports referenceImage_1..3.");
  }
  if (!isOmni && hasHighVoice) {
    errors.push("referenceAudio_2..5 are omni-flash only; Veo supports referenceAudio_1 only.");
  }
  if (model === "veo-3.1-quality" && hasRefImg) {
    errors.push("veo-3.1-quality does not support R2V (referenceImage_*).");
  }
  // Voice narration (any slot) requires either an image reference (R2V) or a
  // video reference (omni-flash V2V edit). The real API enforces this for both
  // Veo R2V and omni-flash — confirmed by live-API testing on 2026-05-24.
  if ((hasVoice1 || hasHighVoice) && !hasRefImg && !hasRefVideo) {
    errors.push("referenceAudio_* requires at least one referenceImage_* (R2V) or referenceVideo_1 (omni-flash V2V edit).");
  }

  // Duration rules
  if (![4, 6, 8, 10].includes(duration)) {
    errors.push(`Invalid duration ${duration}; supported values are 4, 6, 8, 10.`);
  }
  if (duration === 10 && !isOmni) {
    errors.push("duration 10 is omni-flash only.");
  }
  if (model === "veo-3.1-quality" && duration !== 8) {
    errors.push("veo-3.1-quality supports 8-second output only.");
  }
  if (!isOmni && hasRefImg && duration !== 8) {
    errors.push("Veo R2V supports 8-second output only.");
  }
  if (isOmni && hasRefVideo && params.duration !== undefined) {
    errors.push("duration is not accepted for omni-flash V2V edit; omit it and control output length via endFrameIndex_1 - startFrameIndex_1 (24fps timeline).");
  }
  if (!isOmni && (duration === 4 || duration === 6)) {
    warnings.push("duration 4/6 on Veo requires a Google AI Ultra subscription.");
  }

  // V2V frame indices
  if ((params.startFrameIndex_1 !== undefined || params.endFrameIndex_1 !== undefined) && !hasRefVideo) {
    errors.push("startFrameIndex_1/endFrameIndex_1 require referenceVideo_1.");
  }
  if (params.startFrameIndex_1 !== undefined &&
      (params.startFrameIndex_1 < 0 || params.startFrameIndex_1 > 239)) {
    errors.push("startFrameIndex_1 must be between 0 and 239.");
  }
  if (params.endFrameIndex_1 !== undefined &&
      (params.endFrameIndex_1 < 1 || params.endFrameIndex_1 > 240)) {
    errors.push("endFrameIndex_1 must be between 1 and 240.");
  }
  if (params.startFrameIndex_1 !== undefined && params.endFrameIndex_1 !== undefined &&
      params.endFrameIndex_1 <= params.startFrameIndex_1) {
    errors.push("endFrameIndex_1 must be greater than startFrameIndex_1.");
  }

  // Tier hint
  if (model === "veo-3.1-lite-low-priority") {
    warnings.push("veo-3.1-lite-low-priority is available only to Google AI Ultra $200 subscribers.");
  }

  // Numeric bounds
  if (params.count !== undefined && (params.count < 1 || params.count > 4)) {
    errors.push("count must be between 1 and 4.");
  }
  if (params.captchaRetry !== undefined && (params.captchaRetry < 1 || params.captchaRetry > 10)) {
    errors.push("captchaRetry must be between 1 and 10.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Map a friendly or qualified model name to a Google Flow v1 model identifier. */
export function mapModelToUseApi(model: string): FlowVideoModel {
  switch (model.toLowerCase()) {
    case "quality":
    case "veo-3.1-quality":
      return "veo-3.1-quality";
    case "lite":
    case "veo-3.1-lite":
      return "veo-3.1-lite";
    case "free":
    case "relaxed":
    case "lite-low-priority":
    case "veo-3.1-lite-low-priority":
      return "veo-3.1-lite-low-priority";
    case "omni":
    case "omni-flash":
      return "omni-flash";
    case "fast":
    case "veo-3.1-fast":
    default:
      return "veo-3.1-fast";
  }
}

/**
 * Map a friendly aspect ratio to a Google Flow v1 aspectRatio value.
 *
 * `auto` is only meaningful for image generation (see UseApiImageParams);
 * video generation has no "let the backend pick" mode, so it collapses to
 * `landscape` along with `16:9` and any unrecognised input.
 */
export function mapAspectRatioToUseApi(aspectRatio: string): FlowAspectRatio {
  const a = aspectRatio.toLowerCase();
  if (a === "1:1") return "1:1";
  if (a === "4:3") return "4:3";
  if (a === "3:4") return "3:4";
  if (a.includes("portrait") || a === "9:16") return "portrait";
  return "landscape";
}

/**
 * Estimate the credit cost of a video generation request, using Google's
 * official Flow credit table. omni-flash cost depends on duration.
 * Credits are the real billing unit; USD varies by subscription tier.
 */
export function calculateCost(
  model: FlowVideoModel,
  videoCount: number,
  durationSeconds: FlowDuration = 8
): { credits: number; perVideoCredits: number; videoCount: number } {
  let perVideoCredits: number;
  switch (model) {
    case "veo-3.1-quality":
      perVideoCredits = 100;
      break;
    case "veo-3.1-fast":
      perVideoCredits = 20;
      break;
    case "veo-3.1-lite":
      perVideoCredits = 10;
      break;
    case "veo-3.1-lite-low-priority":
      perVideoCredits = 0;
      break;
    case "omni-flash":
      perVideoCredits = { 4: 15, 6: 20, 8: 25, 10: 30 }[durationSeconds] ?? 25;
      break;
    default: {
      // Compile-time exhaustiveness check: if FlowVideoModel gains a member,
      // this line will fail to typecheck until calculateCost handles it.
      const _exhaustive: never = model;
      void _exhaustive;
      perVideoCredits = 20;
      break;
    }
  }
  return { credits: perVideoCredits * videoCount, perVideoCredits, videoCount };
}

// ============================================================================
// Extended Features - Cost Calculation
// ============================================================================

/**
 * Calculate estimated cost for image generation
 *
 * @param model - Image model to use
 * @param imageCount - Number of images (1-4)
 * @returns Cost breakdown in USD
 */
export function calculateImageCost(
  model: "imagen-4" | "nano-banana" | "nano-banana-2" | "nano-banana-pro",
  imageCount: number
): { imageCost: number; captchaCost: number; total: number } {
  const modelCosts: Record<string, number> = {
    "imagen-4": 0.02,
    "nano-banana": 0.03,
    "nano-banana-2": 0.03,
    "nano-banana-pro": 0.05,
  };
  const captchaCostPerRequest = 0.0025;
  const imageCost = (modelCosts[model] ?? 0.02) * imageCount;
  return { imageCost, captchaCost: captchaCostPerRequest, total: imageCost + captchaCostPerRequest };
}

/**
 * Calculate cost for video upscaling
 *
 * @param resolution - Target resolution
 * @returns Cost in USD (0 for 1080p, ~$0.25 for 4K)
 */
export function calculateUpscaleCost(
  resolution: "1080p" | "4k"
): { cost: number; credits: number; notes: string } {
  if (resolution === "4k") {
    return {
      cost: 0.25,
      credits: 50,
      notes: "4K upscaling requires Ultra tier. Results are cached - re-upscaling is free.",
    };
  }
  return {
    cost: 0,
    credits: 0,
    notes: "1080p upscaling is free. Results are cached.",
  };
}

/**
 * Calculate cost for image upscaling
 * POST /google-flow/images/upscale
 *
 * Note: Upscaling requires CAPTCHA (~$0.0025 per request)
 * Note: Only nano-banana-pro images can be upscaled
 *
 * @param resolution - Target resolution ("2k" default, "4k" requires paid Google account)
 * @returns Cost info including CAPTCHA cost
 */
export function calculateImageUpscaleCost(
  resolution: "2k" | "4k"
): { cost: number; captchaCost: number; total: number; notes: string } {
  const captchaCost = 0.0025; // CAPTCHA cost per upscale request

  if (resolution === "4k") {
    return {
      cost: 0,
      captchaCost,
      total: captchaCost,
      notes: "4K upscaling requires paid Google account subscription. Only works with nano-banana-pro images.",
    };
  }
  return {
    cost: 0,
    captchaCost,
    total: captchaCost,
    notes: "2K upscaling available for free accounts. Only works with nano-banana-pro images.",
  };
}

/**
 * Auto-select image model based on number of reference images
 *
 * @param refCount - Number of reference images (0-10)
 * @returns Recommended model
 */
export function autoSelectImageModel(
  refCount: number
): "imagen-4" | "nano-banana" | "nano-banana-pro" {
  if (refCount === 0) {
    return "imagen-4";
  } else if (refCount <= 3) {
    return "nano-banana";
  } else {
    return "nano-banana-pro";
  }
}

// ============================================================================
// Response Transformers
// ============================================================================

/**
 * Transform raw image generation API response to normalized format
 *
 * Raw API format:
 * {
 *   "jobId": "...",
 *   "media": [{
 *     "name": "...",
 *     "workflowId": "...",
 *     "image": {
 *       "generatedImage": {
 *         "seed": 182811941,
 *         "mediaGenerationId": "user:2305-..."
 *       }
 *     }
 *   }]
 * }
 *
 * Normalized format:
 * {
 *   "jobId": "...",
 *   "images": [{
 *     "mediaGenerationId": "user:2305-...",
 *     "seed": 182811941
 *   }]
 * }
 */
export function transformImageResponse(
  raw: UseApiImageResponseRaw
): UseApiImageResponse {
  const images = (raw.media || [])
    .map((mediaItem) => {
      const generatedImage = mediaItem.image?.generatedImage;
      if (!generatedImage?.mediaGenerationId) {
        return null;
      }
      return {
        mediaGenerationId: generatedImage.mediaGenerationId,
        seed: generatedImage.seed,
        name: mediaItem.name,
        workflowId: generatedImage.workflowId || mediaItem.workflowId,
        fifeUrl: generatedImage.fifeUrl,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    jobId: raw.jobId,
    images,
    model: raw.model,
    captcha: raw.captcha,
    error: raw.error,
  };
}

/**
 * Extract mediaId from upload response (may be nested)
 * Handles both formats:
 * - { mediaGenerationId: "..." }
 * - { generatedImage: { mediaGenerationId: "..." } }
 */
export function extractMediaId(response: UseApiImageUploadResponse): string {
  // Direct format
  if (response.mediaGenerationId) {
    return typeof response.mediaGenerationId === "string"
      ? response.mediaGenerationId
      : response.mediaGenerationId.mediaGenerationId;
  }

  // Nested format (from some API versions)
  const nested = (response as any).generatedImage?.mediaGenerationId;
  if (nested) {
    return nested;
  }

  throw new Error(
    `Failed to extract mediaGenerationId from upload response: ${JSON.stringify(response)}`
  );
}
