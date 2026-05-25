import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  sendWebhook,
  createJobCompletedPayload,
  createJobFailedPayload,
  createBatchCompletedPayload,
  createBatchFailedPayload,
  WebhookManager,
  isInternalUrl,
  validateWebhookUrl,
  type WebhookPayload,
  type WebhookConfig,
} from "../src/webhook";

function mockFetch<T extends (...args: any[]) => any>(fn: T): typeof fetch {
  return mock(fn) as unknown as typeof fetch;
}

describe("Webhook Module", () => {
  describe("SSRF Protection - isInternalUrl", () => {
    test("blocks localhost", () => {
      expect(isInternalUrl("http://localhost/webhook")).toBe(true);
      expect(isInternalUrl("https://localhost:3000/hook")).toBe(true);
    });

    test("blocks 127.0.0.1", () => {
      expect(isInternalUrl("http://127.0.0.1/webhook")).toBe(true);
      expect(isInternalUrl("https://127.0.0.1:8080/hook")).toBe(true);
    });

    test("blocks IPv6 loopback", () => {
      expect(isInternalUrl("http://[::1]/webhook")).toBe(true);
    });

    test("blocks 10.x.x.x (Class A private)", () => {
      expect(isInternalUrl("http://10.0.0.1/webhook")).toBe(true);
      expect(isInternalUrl("http://10.255.255.255/hook")).toBe(true);
    });

    test("blocks 172.16-31.x.x (Class B private)", () => {
      expect(isInternalUrl("http://172.16.0.1/webhook")).toBe(true);
      expect(isInternalUrl("http://172.31.255.255/hook")).toBe(true);
      // 172.15 and 172.32 should NOT be blocked
      expect(isInternalUrl("http://172.15.0.1/webhook")).toBe(false);
      expect(isInternalUrl("http://172.32.0.1/webhook")).toBe(false);
    });

    test("blocks 192.168.x.x (Class C private)", () => {
      expect(isInternalUrl("http://192.168.0.1/webhook")).toBe(true);
      expect(isInternalUrl("http://192.168.255.255/hook")).toBe(true);
    });

    test("blocks 169.254.x.x (link-local)", () => {
      expect(isInternalUrl("http://169.254.0.1/webhook")).toBe(true);
      expect(isInternalUrl("http://169.254.169.254/latest/meta-data")).toBe(true);
    });

    test("blocks cloud metadata hostnames", () => {
      expect(isInternalUrl("http://metadata.google.internal/webhook")).toBe(true);
      expect(isInternalUrl("http://metadata/webhook")).toBe(true);
    });

    test("allows public URLs", () => {
      expect(isInternalUrl("https://example.com/webhook")).toBe(false);
      expect(isInternalUrl("https://api.myapp.io/hook")).toBe(false);
      expect(isInternalUrl("https://hooks.slack.com/services/xxx")).toBe(false);
    });

    test("blocks invalid URLs", () => {
      expect(isInternalUrl("not-a-url")).toBe(true);
      expect(isInternalUrl("")).toBe(true);
    });
  });

  describe("SSRF Protection - validateWebhookUrl", () => {
    test("accepts valid public HTTPS URL", () => {
      expect(validateWebhookUrl("https://example.com/webhook")).toBeNull();
    });

    test("accepts valid public HTTP URL", () => {
      expect(validateWebhookUrl("http://example.com/webhook")).toBeNull();
    });

    test("rejects empty URL", () => {
      expect(validateWebhookUrl("")).toBe("Webhook URL cannot be empty");
      expect(validateWebhookUrl("   ")).toBe("Webhook URL cannot be empty");
    });

    test("rejects invalid URL format", () => {
      expect(validateWebhookUrl("not-a-url")).toBe("Invalid URL format");
    });

    test("rejects non-http protocols", () => {
      const error = validateWebhookUrl("ftp://example.com/file");
      expect(error).toContain("Invalid protocol");
    });

    test("rejects file protocol", () => {
      const error = validateWebhookUrl("file:///etc/passwd");
      expect(error).toContain("Invalid protocol");
    });

    test("rejects localhost URLs", () => {
      const error = validateWebhookUrl("http://localhost:3000/webhook");
      expect(error).toContain("internal/private network");
    });

    test("rejects private IP URLs", () => {
      const error = validateWebhookUrl("http://192.168.1.1/webhook");
      expect(error).toContain("internal/private network");
    });

    test("rejects AWS metadata endpoint", () => {
      const error = validateWebhookUrl("http://169.254.169.254/latest/meta-data");
      expect(error).toContain("internal/private network");
    });
  });

  describe("WebhookManager SSRF Protection", () => {
    test("rejects localhost webhook URL", () => {
      const manager = new WebhookManager("http://localhost:3000/hook");
      expect(manager.isEnabled()).toBe(false);
      expect(manager.getValidationError()).toContain("internal/private network");
    });

    test("rejects private network webhook URL", () => {
      const manager = new WebhookManager("http://192.168.1.100/webhook");
      expect(manager.isEnabled()).toBe(false);
      expect(manager.getValidationError()).toContain("internal/private network");
    });

    test("rejects metadata endpoint", () => {
      const manager = new WebhookManager("http://169.254.169.254/latest/meta-data");
      expect(manager.isEnabled()).toBe(false);
    });

    test("accepts valid public URL", () => {
      const manager = new WebhookManager("https://hooks.example.com/webhook");
      expect(manager.isEnabled()).toBe(true);
      expect(manager.getValidationError()).toBeNull();
    });

    test("accepts secret parameter", () => {
      const manager = new WebhookManager("https://example.com/hook", "my-secret");
      expect(manager.isEnabled()).toBe(true);
    });
  });

  describe("Payload Creators", () => {
    test("createJobCompletedPayload creates correct structure", () => {
      const payload = createJobCompletedPayload({
        batchId: "123",
        jobId: "456",
        jobIndex: 1,
        tag: "sunset",
        prompt: "A beautiful sunset",
        videoPath: "2026-01-23_10-30_sunset.mp4",
        videoUrl: "https://example.com/video.mp4",
        durationMs: 90000,
      });

      expect(payload.event).toBe("job.completed");
      expect(payload.batchId).toBe("123");
      expect(payload.jobId).toBe("456");
      expect(payload.jobIndex).toBe(1);
      expect(payload.tag).toBe("sunset");
      expect(payload.prompt).toBe("A beautiful sunset");
      expect(payload.videoPath).toBe("2026-01-23_10-30_sunset.mp4");
      expect(payload.videoUrl).toBe("https://example.com/video.mp4");
      expect(payload.durationMs).toBe(90000);
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test("createJobFailedPayload creates correct structure", () => {
      const payload = createJobFailedPayload({
        batchId: 123,
        jobId: 456,
        jobIndex: 2,
        tag: "test",
        prompt: "Test prompt",
        error: "Generation timeout",
      });

      expect(payload.event).toBe("job.failed");
      expect(payload.batchId).toBe(123);
      expect(payload.jobId).toBe(456);
      expect(payload.error).toBe("Generation timeout");
      expect(payload.timestamp).toBeDefined();
    });

    test("createBatchCompletedPayload creates correct structure", () => {
      const payload = createBatchCompletedPayload({
        batchId: "batch-123",
        stats: {
          completed: 8,
          failed: 2,
          pending: 0,
          total: 10,
        },
      });

      expect(payload.event).toBe("batch.completed");
      expect(payload.batchId).toBe("batch-123");
      expect(payload.stats?.completed).toBe(8);
      expect(payload.stats?.failed).toBe(2);
      expect(payload.stats?.pending).toBe(0);
      expect(payload.stats?.total).toBe(10);
    });

    test("createBatchFailedPayload creates correct structure", () => {
      const payload = createBatchFailedPayload({
        batchId: 999,
        error: "All jobs failed",
        stats: {
          completed: 0,
          failed: 5,
          pending: 0,
          total: 5,
        },
      });

      expect(payload.event).toBe("batch.failed");
      expect(payload.batchId).toBe(999);
      expect(payload.error).toBe("All jobs failed");
      expect(payload.stats?.failed).toBe(5);
    });
  });

  describe("WebhookManager", () => {
    test("isEnabled returns false when no URL provided", () => {
      const manager = new WebhookManager();
      expect(manager.isEnabled()).toBe(false);
    });

    test("isEnabled returns false for empty string URL", () => {
      const manager = new WebhookManager("");
      expect(manager.isEnabled()).toBe(false);
    });

    test("isEnabled returns true when URL provided", () => {
      const manager = new WebhookManager("https://example.com/webhook");
      expect(manager.isEnabled()).toBe(true);
    });

    test("notifyJobCompleted does nothing when disabled", async () => {
      const manager = new WebhookManager();
      // Should not throw
      await manager.notifyJobCompleted({
        batchId: 1,
        jobId: 1,
        jobIndex: 1,
        durationMs: 1000,
      });
    });

    test("notifyJobFailed does nothing when disabled", async () => {
      const manager = new WebhookManager();
      // Should not throw
      await manager.notifyJobFailed({
        batchId: 1,
        jobId: 1,
        jobIndex: 1,
        error: "test error",
      });
    });

    test("notifyBatchCompleted returns true when disabled", async () => {
      const manager = new WebhookManager();
      const result = await manager.notifyBatchCompleted({
        batchId: 1,
        stats: { completed: 1, failed: 0, pending: 0, total: 1 },
      });
      expect(result).toBe(true);
    });
  });

  describe("sendWebhook", () => {
    const mockPayload: WebhookPayload = {
      event: "job.completed",
      timestamp: new Date().toISOString(),
      batchId: "123",
      jobId: "456",
      jobIndex: 1,
      durationMs: 90000,
    };

    test("returns true on successful POST", async () => {
      // Mock fetch to return success
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response("OK", { status: 200 }))
      );

      try {
        const result = await sendWebhook(
          { url: "https://example.com/webhook", retries: 0 },
          mockPayload
        );
        expect(result).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("returns false after all retries fail", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response("Server Error", { status: 500 }))
      );

      try {
        const result = await sendWebhook(
          { url: "https://example.com/webhook", retries: 0, timeoutMs: 100 },
          mockPayload
        );
        expect(result).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("retries on failure", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve(new Response("Error", { status: 500 }));
        }
        return Promise.resolve(new Response("OK", { status: 200 }));
      });

      try {
        const result = await sendWebhook(
          { url: "https://example.com/webhook", retries: 2, timeoutMs: 100 },
          mockPayload
        );
        expect(result).toBe(true);
        expect(callCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("sends correct headers", async () => {
      let capturedHeaders: Headers | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch((url: string, options: RequestInit) => {
        capturedHeaders = new Headers(options.headers);
        return Promise.resolve(new Response("OK", { status: 200 }));
      });

      try {
        await sendWebhook(
          {
            url: "https://example.com/webhook",
            retries: 0,
            headers: { "X-Custom": "value" },
          },
          mockPayload
        );

        expect(capturedHeaders?.get("Content-Type")).toBe("application/json");
        expect(capturedHeaders?.get("User-Agent")).toBe("veo-cli/1.0");
        expect(capturedHeaders?.get("X-Webhook-Event")).toBe("job.completed");
        expect(capturedHeaders?.get("X-Custom")).toBe("value");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("sends correct body", async () => {
      let capturedBody: string | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch((url: string, options: RequestInit) => {
        capturedBody = options.body as string;
        return Promise.resolve(new Response("OK", { status: 200 }));
      });

      try {
        await sendWebhook(
          { url: "https://example.com/webhook", retries: 0 },
          mockPayload
        );

        expect(capturedBody).toBeDefined();
        const parsed = JSON.parse(capturedBody!);
        expect(parsed.event).toBe("job.completed");
        expect(parsed.batchId).toBe("123");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("handles network errors gracefully", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch(() =>
        Promise.reject(new Error("Network error"))
      );

      try {
        const result = await sendWebhook(
          { url: "https://example.com/webhook", retries: 0, timeoutMs: 100 },
          mockPayload
        );
        expect(result).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("includes HMAC signature when secret is provided", async () => {
      let capturedHeaders: Headers | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch((url: string, options: RequestInit) => {
        capturedHeaders = new Headers(options.headers);
        return Promise.resolve(new Response("OK", { status: 200 }));
      });

      try {
        await sendWebhook(
          {
            url: "https://example.com/webhook",
            retries: 0,
            secret: "test-secret-key",
          },
          mockPayload
        );

        expect(capturedHeaders?.get("X-Webhook-Signature")).toBeDefined();
        expect(capturedHeaders?.get("X-Webhook-Signature")).toMatch(/^sha256=/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("does not include signature when no secret", async () => {
      let capturedHeaders: Headers | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch((url: string, options: RequestInit) => {
        capturedHeaders = new Headers(options.headers);
        return Promise.resolve(new Response("OK", { status: 200 }));
      });

      try {
        await sendWebhook(
          { url: "https://example.com/webhook", retries: 0 },
          mockPayload
        );

        expect(capturedHeaders?.get("X-Webhook-Signature")).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("treats 201 as success", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response("Created", { status: 201 }))
      );

      try {
        const result = await sendWebhook(
          { url: "https://example.com/webhook", retries: 0 },
          mockPayload
        );
        expect(result).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("treats 202 as success", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response("Accepted", { status: 202 }))
      );

      try {
        const result = await sendWebhook(
          { url: "https://example.com/webhook", retries: 0 },
          mockPayload
        );
        expect(result).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("treats 204 as success", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch(() =>
        Promise.resolve(new Response(null, { status: 204 }))
      );

      try {
        const result = await sendWebhook(
          { url: "https://example.com/webhook", retries: 0 },
          mockPayload
        );
        expect(result).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
