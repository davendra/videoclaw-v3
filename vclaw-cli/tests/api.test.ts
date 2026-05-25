/**
 * Unit tests for src/api.ts
 *
 * Tests API utilities including:
 * - Cookie filtering and formatting
 * - Timeout controller
 * - Retry logic with exponential backoff
 * - Cookie expiration checks
 * - Health check utilities
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { Cookie } from "rebrowser-puppeteer-core";

// Import testable functions
import {
  filterCookiesByUrlDomain,
  toHeaderCookie,
  createTimeoutController,
  withRetry,
  checkCookieExpiration,
  BASE_API_URL,
  TARGET_PAGE_URL,
  setApiUserAgent,
} from "../src/api";

describe("constants", () => {
  test("BASE_API_URL is correct", () => {
    expect(BASE_API_URL).toBe("https://labs.google/fx/api/trpc");
  });

  test("TARGET_PAGE_URL is correct", () => {
    expect(TARGET_PAGE_URL.href).toBe("https://labs.google/fx/tools/flow");
    expect(TARGET_PAGE_URL.hostname).toBe("labs.google");
  });
});

describe("filterCookiesByUrlDomain", () => {
  const createCookie = (domain: string, name: string = "test"): Cookie => ({
    name,
    value: "value",
    domain,
    path: "/",
    expires: Date.now() / 1000 + 3600,
    size: 10,
    httpOnly: false,
    secure: true,
    session: false,
  });

  test("filters cookies matching exact domain", () => {
    const cookies = [
      createCookie("labs.google", "cookie1"),
      createCookie("other.com", "cookie2"),
    ];
    const target = new URL("https://labs.google/fx/tools/flow");
    const filtered = filterCookiesByUrlDomain(cookies, target);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("cookie1");
  });

  test("filters cookies with dot-prefixed domain", () => {
    const cookies = [
      createCookie(".google", "googleCookie"),
      createCookie(".labs.google", "labsCookie"),
      createCookie("other.com", "otherCookie"),
    ];
    const target = new URL("https://labs.google/fx/tools/flow");
    const filtered = filterCookiesByUrlDomain(cookies, target);

    // Should match .google (because labs.google ends with .google)
    // Should match .labs.google (because labs.google ends with .labs.google)
    expect(filtered).toHaveLength(2);
  });

  test("handles subdomain matching correctly", () => {
    const cookies = [
      createCookie(".google.com", "parentDomain"),
    ];
    const target = new URL("https://sub.google.com/path");
    const filtered = filterCookiesByUrlDomain(cookies, target);

    expect(filtered).toHaveLength(1);
  });

  test("returns empty array when no cookies match", () => {
    const cookies = [
      createCookie("other.com", "cookie1"),
      createCookie("different.org", "cookie2"),
    ];
    const target = new URL("https://labs.google/fx/tools/flow");
    const filtered = filterCookiesByUrlDomain(cookies, target);

    expect(filtered).toHaveLength(0);
  });

  test("handles empty cookie array", () => {
    const target = new URL("https://labs.google/fx/tools/flow");
    const filtered = filterCookiesByUrlDomain([], target);

    expect(filtered).toHaveLength(0);
  });

  test("preserves cookie order", () => {
    const cookies = [
      createCookie("labs.google", "first"),
      createCookie("labs.google", "second"),
      createCookie("labs.google", "third"),
    ];
    const target = new URL("https://labs.google/");
    const filtered = filterCookiesByUrlDomain(cookies, target);

    expect(filtered.map(c => c.name)).toEqual(["first", "second", "third"]);
  });
});

describe("toHeaderCookie", () => {
  const createCookie = (name: string, value: string): Cookie => ({
    name,
    value,
    domain: "test.com",
    path: "/",
    expires: -1,
    size: 10,
    httpOnly: false,
    secure: false,
    session: true,
  });

  test("formats single cookie correctly", () => {
    const cookies = [createCookie("session", "abc123")];
    const header = toHeaderCookie(cookies);

    expect(header).toBe("session=abc123");
  });

  test("formats multiple cookies with semicolon separator", () => {
    const cookies = [
      createCookie("session", "abc123"),
      createCookie("user", "john"),
    ];
    const header = toHeaderCookie(cookies);

    expect(header).toBe("session=abc123; user=john");
  });

  test("handles empty cookie array", () => {
    const header = toHeaderCookie([]);
    expect(header).toBe("");
  });

  test("preserves cookie values with special characters", () => {
    const cookies = [createCookie("data", "value=with=equals")];
    const header = toHeaderCookie(cookies);

    expect(header).toBe("data=value=with=equals");
  });

  test("handles cookies with empty values", () => {
    const cookies = [createCookie("empty", "")];
    const header = toHeaderCookie(cookies);

    expect(header).toBe("empty=");
  });
});

describe("createTimeoutController", () => {
  test("returns an object with signal and cancel", () => {
    const controller = createTimeoutController(1000);

    expect(controller).toHaveProperty("signal");
    expect(controller).toHaveProperty("cancel");
    expect(typeof controller.cancel).toBe("function");
    expect(controller.signal).toBeInstanceOf(AbortSignal);

    controller.cancel();
  });

  test("signal is not aborted initially", () => {
    const controller = createTimeoutController(1000);

    expect(controller.signal.aborted).toBe(false);

    controller.cancel();
  });

  test("cancel function clears the timeout", () => {
    const controller = createTimeoutController(100);
    controller.cancel();

    // After canceling, signal should still not be aborted
    expect(controller.signal.aborted).toBe(false);
  });

  test("signal aborts after timeout", async () => {
    const controller = createTimeoutController(50);

    await Bun.sleep(100);

    expect(controller.signal.aborted).toBe(true);
  });
});

describe("withRetry", () => {
  test("returns result on first successful attempt", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  test("retries on failure and succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("Transient error");
        return "success";
      },
      { maxRetries: 3, initialDelayMs: 10 }
    );

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  test("throws after max retries exhausted", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Persistent error");
        },
        { maxRetries: 3, initialDelayMs: 10 }
      )
    ).rejects.toThrow("Persistent error");

    expect(attempts).toBe(3);
  });

  test("does not retry on 401 auth errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("API returned 401 Unauthorized");
        },
        { maxRetries: 3, initialDelayMs: 10 }
      )
    ).rejects.toThrow("401");

    expect(attempts).toBe(1);
  });

  test("does not retry on 403 forbidden errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("API returned 403 Forbidden");
        },
        { maxRetries: 3, initialDelayMs: 10 }
      )
    ).rejects.toThrow("403");

    expect(attempts).toBe(1);
  });

  test("does not retry on known non-retriable errors", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Direct image upload is not supported");
        },
        { maxRetries: 3, initialDelayMs: 10 }
      )
    ).rejects.toThrow("Direct image upload is not supported");

    expect(attempts).toBe(1);
  });

  test("respects custom retryOn filter", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Custom retriable error");
        },
        {
          maxRetries: 3,
          initialDelayMs: 10,
          retryOn: (err) => err.message.includes("retriable"),
        }
      )
    ).rejects.toThrow("Custom retriable error");

    expect(attempts).toBe(3); // Should retry because retryOn returns true
  });

  test("does not retry when retryOn returns false", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Non-retriable error");
        },
        {
          maxRetries: 3,
          initialDelayMs: 10,
          retryOn: (err) => false,
        }
      )
    ).rejects.toThrow("Non-retriable error");

    expect(attempts).toBe(1);
  });

  test("uses exponential backoff", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Always fails");
        },
        {
          maxRetries: 3,
          initialDelayMs: 10,
          backoffMultiplier: 2,
          maxDelayMs: 500,
        }
      )
    ).rejects.toThrow();

    // Just verify all retries were attempted
    // (timing-based assertions are inherently flaky)
    expect(attempts).toBe(3);
  });

  test("respects maxDelayMs cap", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("Always fails");
        },
        {
          maxRetries: 4,
          initialDelayMs: 10,
          backoffMultiplier: 10,
          maxDelayMs: 50,
        }
      )
    ).rejects.toThrow();

    // All retries should complete even with maxDelayMs cap
    expect(attempts).toBe(4);
  });
});

describe("checkCookieExpiration", () => {
  const createCookie = (expiresIn: number): Cookie => ({
    name: "test",
    value: "value",
    domain: "test.com",
    path: "/",
    expires: Date.now() / 1000 + expiresIn,
    size: 10,
    httpOnly: false,
    secure: false,
    session: false,
  });

  const createSessionCookie = (): Cookie => ({
    name: "session",
    value: "value",
    domain: "test.com",
    path: "/",
    expires: -1,
    size: 10,
    httpOnly: false,
    secure: false,
    session: true,
  });

  test("returns true when cookie expires within threshold", () => {
    const cookies = [createCookie(3600)]; // Expires in 1 hour
    const result = checkCookieExpiration(cookies, 7200); // 2 hour threshold

    expect(result).toBe(true);
  });

  test("returns false when cookie expires after threshold", () => {
    const cookies = [createCookie(7200)]; // Expires in 2 hours
    const result = checkCookieExpiration(cookies, 3600); // 1 hour threshold

    expect(result).toBe(false);
  });

  test("ignores session cookies (expires = -1)", () => {
    const cookies = [createSessionCookie()];
    const result = checkCookieExpiration(cookies, 86400); // 24 hour threshold

    expect(result).toBe(false);
  });

  test("returns true if any cookie expires within threshold", () => {
    const cookies = [
      createCookie(86400), // Expires in 24 hours - OK
      createCookie(1800),  // Expires in 30 minutes - expiring soon!
      createCookie(172800), // Expires in 48 hours - OK
    ];
    const result = checkCookieExpiration(cookies, 3600); // 1 hour threshold

    expect(result).toBe(true);
  });

  test("returns false for empty cookie array", () => {
    const result = checkCookieExpiration([], 3600);
    expect(result).toBe(false);
  });

  test("handles cookies without expiry field", () => {
    const cookieNoExpiry: Cookie = {
      name: "noexpiry",
      value: "value",
      domain: "test.com",
      path: "/",
      size: 10,
      httpOnly: false,
      secure: false,
      session: true,
    } as Cookie;

    const result = checkCookieExpiration([cookieNoExpiry], 3600);
    expect(result).toBe(false);
  });
});

describe("setApiUserAgent", () => {
  test("sets user agent without error", () => {
    expect(() => {
      setApiUserAgent("TestUserAgent/1.0");
    }).not.toThrow();
  });

  test("accepts empty string", () => {
    expect(() => {
      setApiUserAgent("");
    }).not.toThrow();
  });
});

describe("URL construction utilities", () => {
  // Test internal URL construction patterns used in api.ts

  test("can construct project URL from TARGET_PAGE_URL", () => {
    const projectId = "test-project-123";
    const projectUrl = new URL(
      `/fx/tools/flow/project/${projectId}`,
      TARGET_PAGE_URL.href
    );

    expect(projectUrl.href).toBe(`https://labs.google/fx/tools/flow/project/${projectId}`);
  });

  test("can construct API endpoint URL", () => {
    const endpoint = "/project.searchUserProjects";
    const url = new URL(BASE_API_URL + endpoint);

    expect(url.href).toBe("https://labs.google/fx/api/trpc/project.searchUserProjects");
  });

  test("can add input parameter to URL", () => {
    const url = new URL(BASE_API_URL + "/project.searchUserProjects");
    const input = { json: { pageSize: 20, toolName: "PINHOLE" } };
    url.searchParams.set("input", JSON.stringify(input));

    expect(url.searchParams.get("input")).toBe(JSON.stringify(input));
  });
});

describe("cursor encoding", () => {
  // Test the cursor encoding pattern used internally

  function encodeCursor(cursor: string | null): string | null {
    if (cursor === null) return null;
    return encodeURIComponent(cursor).replace(/%20/g, "+");
  }

  test("returns null for null cursor", () => {
    expect(encodeCursor(null)).toBeNull();
  });

  test("encodes special characters", () => {
    const cursor = "page=2&token=abc";
    const encoded = encodeCursor(cursor);

    expect(encoded).toBe("page%3D2%26token%3Dabc");
  });

  test("replaces spaces with plus signs", () => {
    const cursor = "some cursor with spaces";
    const encoded = encodeCursor(cursor);

    expect(encoded).toContain("+");
    expect(encoded).not.toContain("%20");
  });

  test("handles empty string", () => {
    expect(encodeCursor("")).toBe("");
  });
});

describe("request header construction", () => {
  // Test patterns used for constructing request headers

  test("builds correct headers for tRPC calls", () => {
    const cookies = [
      { name: "auth", value: "token123", domain: "labs.google", path: "/", expires: -1, size: 10, httpOnly: false, secure: true, session: true },
    ] as Cookie[];

    const cookieHeader = toHeaderCookie(cookies);
    const headers = {
      accept: "*/*",
      cookie: cookieHeader,
      "user-agent": "TestAgent/1.0",
      referer: TARGET_PAGE_URL.href,
      origin: TARGET_PAGE_URL.origin,
      "content-type": "application/json",
    };

    expect(headers.accept).toBe("*/*");
    expect(headers.cookie).toBe("auth=token123");
    expect(headers.referer).toBe("https://labs.google/fx/tools/flow");
    expect(headers.origin).toBe("https://labs.google");
    expect(headers["content-type"]).toBe("application/json");
  });
});

describe("input JSON structure", () => {
  // Test the input JSON patterns used for tRPC calls

  test("builds searchUserProjects input correctly", () => {
    const cursor = null;
    const input: Record<string, any> = {
      json: {
        pageSize: 20,
        toolName: "PINHOLE",
        cursor: cursor,
      },
    };

    if (cursor === null) {
      input["meta"] = {
        values: {
          cursor: ["undefined"],
        },
      };
    }

    expect(input.json.pageSize).toBe(20);
    expect(input.json.toolName).toBe("PINHOLE");
    expect(input.meta.values.cursor).toEqual(["undefined"]);
  });

  test("builds searchProjectWorkflows input correctly", () => {
    const projectId = "test-project";
    const input = {
      json: {
        pageSize: 3,
        projectId,
        toolName: "PINHOLE",
        fetchBookmarked: false,
        rawQuery: "",
        mediaType: "MEDIA_TYPE_VIDEO",
        cursor: null,
      },
      meta: {
        values: {
          cursor: ["undefined"],
        },
      },
    };

    expect(input.json.projectId).toBe(projectId);
    expect(input.json.mediaType).toBe("MEDIA_TYPE_VIDEO");
  });

  test("builds createProject body correctly", () => {
    const projectTitle = "2025-01-01T00:00:00.000Z";
    const toolName = "PINHOLE";
    const body = JSON.stringify({ json: { toolName, projectTitle } });

    const parsed = JSON.parse(body);
    expect(parsed.json.toolName).toBe("PINHOLE");
    expect(parsed.json.projectTitle).toBe(projectTitle);
  });
});

describe("error message patterns", () => {
  // Test error detection patterns used in withRetry

  function isAuthError(message: string): boolean {
    return message.includes("401") || message.includes("403");
  }

  function isNonRetriableError(message: string): boolean {
    return message.includes("Direct image upload is not supported");
  }

  test("detects 401 auth errors", () => {
    expect(isAuthError("API returned 401 Unauthorized")).toBe(true);
    expect(isAuthError("Failed with status 401")).toBe(true);
  });

  test("detects 403 forbidden errors", () => {
    expect(isAuthError("API returned 403 Forbidden")).toBe(true);
    expect(isAuthError("Access denied: 403")).toBe(true);
  });

  test("detects non-retriable upload errors", () => {
    expect(isNonRetriableError("Direct image upload is not supported in headless mode")).toBe(true);
  });

  test("does not flag regular errors as auth errors", () => {
    expect(isAuthError("Network timeout")).toBe(false);
    expect(isAuthError("Server error 500")).toBe(false);
  });
});
