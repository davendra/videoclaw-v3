/**
 * API utilities and project management for veo-cli
 */

import type { Cookie } from "rebrowser-puppeteer-core";
import type {
  Project,
  SearchUserProjectsOptions,
  SearchUserProjectsResponse,
  SearchProjectWorkflowsOptions,
  SearchProjectWorkflowsResponse,
  UserProject,
  Workflow,
  ProjectResponse,
} from "./types";
import type { VideoAspectRatio } from "./types";

// Constants
export const BASE_API_URL = "https://labs.google/fx/api/trpc";
export const TARGET_PAGE_URL = new URL("https://labs.google/fx/tools/flow");

/**
 * Build a descriptive error message with actionable guidance for common HTTP status codes.
 * Prepends context-specific advice while preserving the raw response body for debugging.
 */
function formatHttpError(context: string, status: number, statusText: string, body: string): string {
  let guidance = "";

  switch (status) {
    case 401:
      guidance =
        "Authentication failed. Session cookies expired.\n" +
        "  Re-login with: bun run flow.ts --visible\n\n";
      break;
    case 403:
      guidance =
        "Access denied. Your session may have expired. Try:\n" +
        "  1. Re-login: bun run flow.ts --visible\n" +
        "  2. Check account tier supports this model\n" +
        "  3. Verify project access\n\n";
      break;
    case 429:
      guidance =
        "Rate limited. Wait a few minutes and retry, or reduce --count.\n\n";
      break;
    case 500:
    case 502:
    case 503:
      guidance =
        "Google API server error. This is usually transient.\n" +
        "  Wait a moment and retry. If persistent, check https://status.cloud.google.com\n\n";
      break;
  }

  return `${context}: ${guidance}${status} ${statusText} - ${body}`;
}

// User agent (set from main module)
let userAgent = "";

/**
 * Set user agent for API requests
 */
export function setApiUserAgent(ua: string): void {
  userAgent = ua;
}

/**
 * Filter cookies by URL domain
 */
export function filterCookiesByUrlDomain(cookies: Cookie[], targetUrl: URL): Cookie[] {
  const host = targetUrl.hostname;

  return cookies.filter((cookie) => {
    const domain = cookie.domain.startsWith(".")
      ? cookie.domain.slice(1)
      : cookie.domain;

    // RFC: request-host === domain OR endsWith .domain
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/**
 * Convert cookies to header string
 */
export function toHeaderCookie(cookies: Cookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/**
 * Encode cursor for pagination
 */
function encodeCursor(cursor: string | null): string | null {
  if (cursor === null) return null;
  return encodeURIComponent(cursor).replace(/%20/g, "+");
}

/**
 * Create a timeout controller for fetch requests
 */
export function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

/**
 * Retry wrapper for resilient API calls with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;           // Initial delay (for backwards compatibility)
    initialDelayMs?: number;    // Preferred: initial delay before first retry
    maxDelayMs?: number;        // Cap on delay
    backoffMultiplier?: number; // Multiply delay each attempt (default: 2)
    retryOn?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = options.delayMs ?? 2000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    retryOn,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if we should retry this error
      if (retryOn && !retryOn(lastError)) {
        throw lastError;
      }

      // Don't retry on auth errors
      if (lastError.message.includes("401") || lastError.message.includes("403")) {
        throw lastError;
      }

      // Don't retry on known non-retriable errors
      if (lastError.message.includes("Direct image upload is not supported")) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        // Add jitter: random 0-1s to prevent thundering herd
        const jitter = Math.random() * 1000;
        const waitTime = Math.min(delay + jitter, maxDelayMs);
        console.log(`Attempt ${attempt} failed: ${lastError.message}. Retrying in ${(waitTime / 1000).toFixed(1)}s...`);
        await Bun.sleep(waitTime);
        // Exponential backoff for next attempt
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
      }
    }
  }
  throw lastError;
}

/**
 * Search user projects
 */
export async function searchUserProjects(
  cookies: Cookie[],
  options: SearchUserProjectsOptions = {}
) {
  const cookieHeader = toHeaderCookie(cookies);

  const cursor = options.cursor ?? null;
  const encodedCursor = encodeCursor(cursor);
  const input: Record<string, any> = {
    json: {
      pageSize: options.pageSize ?? 20,
      toolName: options.toolName ?? "PINHOLE",
      cursor: encodedCursor,
    },
  };

  if (cursor === null) {
    input["meta"] = {
      values: {
        cursor: ["undefined"],
      },
    };
  }

  const url = new URL(BASE_API_URL + "/project.searchUserProjects");
  url.searchParams.set("input", JSON.stringify(input));

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "*/*",
      cookie: cookieHeader,
      "user-agent": userAgent,
      referer: TARGET_PAGE_URL.href,
      origin: TARGET_PAGE_URL.origin,
      "content-type": "application/json",
    },
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpError("Failed to search projects", response.status, response.statusText, responseBody)
    );
  }

  const data = JSON.parse(responseBody) as SearchUserProjectsResponse;
  const result = data.result.data.json.result;

  return {
    raw: data,
    projects: result.projects,
    nextPageToken: result.nextPageToken ?? null,
  };
}

/**
 * Search all user projects (handles pagination)
 */
export async function searchAllUserProjects(
  cookies: Cookie[],
  options: SearchUserProjectsOptions = {}
): Promise<UserProject[]> {
  const projects: UserProject[] = [];

  let cursor = options.cursor ?? null;
  while (true) {
    const page = await searchUserProjects(cookies, { ...options, cursor });

    projects.push(...(page?.projects || []));

    if (!page.nextPageToken) break;
    cursor = page.nextPageToken;
  }

  return projects;
}

/**
 * Search project workflows
 */
export async function searchProjectWorkflows(
  cookies: Cookie[],
  project: Project,
  options: SearchProjectWorkflowsOptions = {}
) {
  const cookieHeader = toHeaderCookie(cookies);

  const cursor = options.cursor ?? null;
  const encodedCursor = encodeCursor(cursor);
  const input: Record<string, any> = {
    json: {
      pageSize: options.pageSize ?? 3,
      projectId: project.projectId,
      toolName: options.toolName ?? "PINHOLE",
      fetchBookmarked: options.fetchBookmarked ?? false,
      rawQuery: options.rawQuery ?? "",
      mediaType: options.mediaType ?? "MEDIA_TYPE_VIDEO",
      cursor: encodedCursor,
    },
  };

  if (cursor === null) {
    input["meta"] = {
      values: {
        cursor: ["undefined"],
      },
    };
  }

  const url = new URL(BASE_API_URL + "/project.searchProjectWorkflows");
  url.searchParams.set("input", JSON.stringify(input));

  const refererUrl = new URL(
    `/fx/tools/flow/project/${project.projectId}`,
    TARGET_PAGE_URL.href
  );

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "*/*",
      cookie: cookieHeader,
      "user-agent": userAgent,
      referer: refererUrl.href,
      origin: TARGET_PAGE_URL.origin,
      "content-type": "application/json",
    },
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpError("Failed to search workflows", response.status, response.statusText, responseBody)
    );
  }

  const data = JSON.parse(responseBody) as SearchProjectWorkflowsResponse;
  const result = data.result.data.json.result;
  const nextPageToken = result.nextPageToken ?? null;

  return {
    raw: data,
    nextPageToken,
    workflows: result.workflows,
  };
}

/**
 * Search all project workflows (handles pagination)
 */
export async function searchAllProjectWorkflows(
  cookies: Cookie[],
  project: Project,
  options: SearchProjectWorkflowsOptions = {}
): Promise<Workflow[]> {
  const workflows: Workflow[] = [];

  let cursor = options.cursor ?? null;
  while (true) {
    const page = await searchProjectWorkflows(cookies, project, {
      ...options,
      cursor,
    });

    workflows.push(...page.workflows);

    if (!page.nextPageToken) break;
    cursor = page.nextPageToken;
  }

  return workflows;
}

/**
 * Create a new project
 */
export async function createProject(
  cookies: Cookie[],
  projectTitle = new Date().toISOString(),
  toolName = "PINHOLE"
) {
  const cookieHeader = toHeaderCookie(cookies);

  const response = await fetch(BASE_API_URL + "/project.createProject", {
    method: "POST",
    headers: {
      accept: "*/*",
      cookie: cookieHeader,
      "user-agent": userAgent,
      referer: TARGET_PAGE_URL.href,
      origin: TARGET_PAGE_URL.origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ json: { toolName, projectTitle } }),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpError("Failed to create project", response.status, response.statusText, responseBody)
    );
  }

  const data = JSON.parse(responseBody) as ProjectResponse<Project>;

  return {
    raw: data,
    project: data.result.data.json.result,
  };
}

/**
 * Set last selected video model key
 */
export async function setLastSelectedVideoModelKey(
  cookies: Cookie[],
  project: Project,
  modelKey: string
) {
  const refererUrl = new URL(
    `/fx/tools/flow/project/${project.projectId}`,
    TARGET_PAGE_URL.href
  );

  const response = await fetch(
    BASE_API_URL + "/videoFx.setLastSelectedVideoModelKey",
    {
      method: "POST",
      headers: {
        referer: refererUrl.href,
        "user-agent": userAgent,
        origin: TARGET_PAGE_URL.origin,
        cookie: toHeaderCookie(cookies),
        "content-type": "application/json",
      },
      body: JSON.stringify({ json: { modelKey } }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      formatHttpError("Failed to set video model key", response.status, response.statusText, errorBody)
    );
  }

  const data = (await response.json()) as ProjectResponse<any>;
  return data.result.data.json;
}

/**
 * Set last selected video aspect ratio
 */
export async function setLastSelectedVideoAspectRatio(
  cookies: Cookie[],
  project: Project,
  videoAspectRatio: VideoAspectRatio
) {
  const refererUrl = new URL(
    `/fx/tools/flow/project/${project.projectId}`,
    TARGET_PAGE_URL.href
  );

  const response = await fetch(
    BASE_API_URL + "/videoFx.setLastSelectedVideoAspectRatio",
    {
      method: "POST",
      headers: {
        referer: refererUrl.href,
        "user-agent": userAgent,
        origin: TARGET_PAGE_URL.origin,
        cookie: toHeaderCookie(cookies),
        "content-type": "application/json",
      },
      body: JSON.stringify({ json: { videoAspectRatio } }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      formatHttpError("Failed to set aspect ratio", response.status, response.statusText, errorBody)
    );
  }

  const data = (await response.json()) as ProjectResponse<any>;
  return data.result.data.json;
}

/**
 * Last settings type
 */
export type LastSettings = {
  lastAcknowledgedChangeLogId?: string;
  lastSelectedVideoModelKey?: string;
  lastSelectedVideoAspectRatio?: VideoAspectRatio;
};

/**
 * Get user settings
 */
export async function getUserSettings(
  cookies: Cookie[],
  project: Project
): Promise<LastSettings> {
  const refererUrl = new URL(
    `/fx/tools/flow/project/${project.projectId}`,
    TARGET_PAGE_URL.href
  );

  const url = new URL(`${BASE_API_URL}/videoFx.getUserSettings`);
  url.searchParams.set(
    "input",
    JSON.stringify({ json: null, meta: { values: ["undefined"] } })
  );

  const response = await fetch(url, {
    headers: {
      referer: refererUrl.href,
      "user-agent": userAgent,
      origin: TARGET_PAGE_URL.origin,
      cookie: toHeaderCookie(cookies),
      "content-type": "application/json",
    },
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpError("Failed to get user settings", response.status, response.statusText, responseBody)
    );
  }

  const data = JSON.parse(responseBody) as ProjectResponse<LastSettings>;

  return data.result.data.json.result;
}

/**
 * Get video model configuration
 */
export async function getVideoModelConfig(
  cookies: Cookie[],
  project: Project
) {
  const refererUrl = new URL(
    `/fx/tools/flow/project/${project.projectId}`,
    TARGET_PAGE_URL.href
  );

  const url = new URL(`${BASE_API_URL}/videoFx.getVideoModelConfig`);
  url.searchParams.set(
    "input",
    JSON.stringify({ json: null, meta: { values: ["undefined"] } })
  );

  const response = await fetch(url, {
    headers: {
      referer: refererUrl.href,
      "user-agent": userAgent,
      origin: TARGET_PAGE_URL.origin,
      cookie: toHeaderCookie(cookies),
      "content-type": "application/json",
    },
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      formatHttpError("Failed to get video model config", response.status, response.statusText, responseBody)
    );
  }

  const data = JSON.parse(responseBody) as ProjectResponse<any>;
  return data.result.data.json.result;
}

/**
 * Check if cookies are valid for API access
 * Uses a lightweight API call to validate authentication
 */
export async function checkAuthValid(cookies: Cookie[]): Promise<boolean> {
  try {
    // Try a minimal searchUserProjects call
    await searchUserProjects(cookies, { pageSize: 1 });
    return true;
  } catch (error) {
    // 401/403 means cookies are invalid
    return false;
  }
}

/**
 * Fetch user's media history (images/videos uploaded to Flow)
 * Returns an array of mediaId strings
 */
export async function fetchUserMediaHistory(
  cookies: Cookie[],
  mediaType: "IMAGE" | "VIDEO" = "IMAGE",
  pageSize: number = 100
): Promise<string[]> {
  // Filter cookies for the target domain
  const filteredCookies = filterCookiesByUrlDomain(cookies, TARGET_PAGE_URL);
  const cookieHeader = toHeaderCookie(filteredCookies);

  const input = {
    json: {
      pageSize,
      mediaType,
      cursor: null,
    },
    meta: {
      values: {
        cursor: ["undefined"],
      },
    },
  };

  const url = new URL(BASE_API_URL + "/media.fetchUserHistoryDirectly");
  url.searchParams.set("input", JSON.stringify(input));

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "*/*",
        cookie: cookieHeader,
        "user-agent": userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        referer: TARGET_PAGE_URL.href,
        origin: TARGET_PAGE_URL.origin,
        "content-type": "application/json",
      },
    });

    if (!response.ok) {
      console.log(`fetchUserMediaHistory failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const responseBody = await response.text();

    // Extract all CAM IDs from the response
    const mediaIds = responseBody.match(/CAM[a-zA-Z0-9_-]{30,}/g) || [];
    return Array.from(new Set(mediaIds));
  } catch (e) {
    console.log(`fetchUserMediaHistory error: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * Get user paygate tier
 * Returns default tier if API call fails (graceful degradation)
 * Note: R2V models require PAYGATE_TIER_TWO
 */
export async function getUserPaygateTier(session: { accessToken: string }): Promise<{ userPaygateTier: string }> {
  try {
    const response = await fetch(
      "https://aisandbox-pa.googleapis.com/v1:getUserPaygateTier",
      {
        method: "POST",
        headers: {
          "user-agent": userAgent,
          "content-type": "text/plain",
          origin: TARGET_PAGE_URL.origin,
          referer: TARGET_PAGE_URL.origin + "/",
          authorization: "Bearer " + session.accessToken,
        },
        body: "{}",
      }
    );

    if (!response.ok) {
      console.log(`Warning: Could not get paygate tier (${response.status}), assuming TIER_TWO for R2V compatibility`);
      return { userPaygateTier: "PAYGATE_TIER_TWO" };
    }

    return response.json() as Promise<{ userPaygateTier: string }>;
  } catch (error) {
    console.log("Warning: Paygate tier API unavailable, assuming TIER_TWO for R2V compatibility");
    return { userPaygateTier: "PAYGATE_TIER_TWO" };
  }
}

/**
 * Health check results
 */
export interface HealthCheckResult {
  cookiesValid: boolean;
  cookieExpiringSoon: boolean;
  networkReachable: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Check if cookies will expire within the given threshold
 */
export function checkCookieExpiration(cookies: Cookie[], thresholdSeconds: number): boolean {
  const now = Date.now() / 1000;
  return cookies.some(c => {
    if (!c.expires || c.expires === -1) return false; // Session cookie or no expiry
    return c.expires - now < thresholdSeconds;
  });
}

/**
 * Perform health checks before starting video generation
 * Checks network connectivity, cookie validity, and cookie expiration
 */
export async function performHealthChecks(cookies: Cookie[]): Promise<HealthCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check network reachability
  let networkReachable = false;
  try {
    const controller = createTimeoutController(10000);
    const res = await fetch("https://labs.google/fx/tools/flow", {
      method: "HEAD",
      signal: controller.signal,
    }).finally(controller.cancel);
    // 200 = reachable and accessible, 401/403 = reachable but needs auth
    networkReachable = res.ok || res.status === 401 || res.status === 403;
  } catch {
    errors.push("Cannot reach labs.google - check your network connection");
  }

  // Check cookie validity (only if network is reachable)
  let cookiesValid = false;
  if (networkReachable && cookies.length > 0) {
    cookiesValid = await checkAuthValid(cookies);
    if (!cookiesValid) {
      errors.push("Cookies are invalid or expired - run with --visible to re-login");
    }
  } else if (cookies.length === 0) {
    errors.push("No cookies found - run with --visible to login first");
  }

  // Check cookie expiration (warn if expiring within 24 hours)
  const cookieExpiringSoon = checkCookieExpiration(cookies, 24 * 60 * 60);
  if (cookieExpiringSoon) {
    warnings.push("Cookies will expire within 24 hours - consider refreshing your session");
  }

  return {
    cookiesValid,
    cookieExpiringSoon,
    networkReachable,
    errors,
    warnings,
  };
}
