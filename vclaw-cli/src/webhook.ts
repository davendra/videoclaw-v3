/**
 * Webhook notification module for veo-cli
 *
 * Sends notifications to configured webhook URLs when jobs complete or fail.
 * Webhook calls are non-blocking - failures don't affect the main workflow.
 */

import { log, debug, warn } from "./config";
import { createHmac } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";

export interface WebhookPayload {
  event: "job.completed" | "job.failed" | "batch.completed" | "batch.failed";
  timestamp: string;
  batchId: string | number;
  jobId?: string | number;
  jobIndex?: number;
  tag?: string;
  prompt?: string;
  videoPath?: string;
  videoUrl?: string;
  durationMs?: number;
  error?: string;
  stats?: {
    completed: number;
    failed: number;
    pending: number;
    total: number;
  };
}

export interface WebhookConfig {
  url: string;
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  secret?: string; // HMAC secret for signing webhook payloads
}

/**
 * Check if a URL points to an internal/private network address (SSRF protection)
 * Blocks: localhost, 127.0.0.1, ::1, private IP ranges (10.x, 172.16-31.x, 192.168.x),
 * link-local addresses (169.254.x.x), and cloud metadata endpoints
 */
export function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    // Note: IPv6 addresses in URLs use brackets [::1] but URL.hostname strips them
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
      return true;
    }

    // Block private IP ranges (RFC 1918)
    // 10.0.0.0 - 10.255.255.255
    if (/^10\./.test(hostname)) {
      return true;
    }

    // 172.16.0.0 - 172.31.255.255
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) {
      return true;
    }

    // 192.168.0.0 - 192.168.255.255
    if (/^192\.168\./.test(hostname)) {
      return true;
    }

    // Block link-local addresses (169.254.x.x) and AWS/cloud metadata endpoint
    if (/^169\.254\./.test(hostname)) {
      return true;
    }

    // Block common cloud metadata hostnames
    if (hostname === "metadata.google.internal" || hostname === "metadata") {
      return true;
    }

    return false;
  } catch {
    // Invalid URL - treat as internal to be safe
    return true;
  }
}

/**
 * Check whether an IPv4 or IPv6 address is private/loopback/link-local.
 * Used by runtime DNS checks to defend against hostname → private-IP SSRF.
 */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return true;

  if (kind === 4) {
    if (/^127\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true;
    if (ip === "0.0.0.0") return true;
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    return isPrivateIp(v4);
  }
  return false;
}

/**
 * Resolve the hostname of a URL and check every returned address. Rejects if
 * any resolved IP is private/loopback/link-local — the gap `isInternalUrl`
 * misses when an attacker points a public hostname at an internal network.
 */
export async function resolveAndValidateHost(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL format";
  }

  const hostname = parsed.hostname;
  if (isIP(hostname) !== 0) {
    return isPrivateIp(hostname) ? "Resolved address is private" : null;
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        return `Resolved address ${address} is private`;
      }
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `DNS resolution failed: ${message}`;
  }
}

/**
 * Validate a webhook URL is safe and well-formed
 * Returns null if valid, or an error message if invalid
 */
export function validateWebhookUrl(url: string): string | null {
  if (!url || url.trim() === "") {
    return "Webhook URL cannot be empty";
  }

  try {
    const parsed = new URL(url);

    // Must be http or https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `Invalid protocol '${parsed.protocol}' - must be http or https`;
    }

    // Check for internal URLs (SSRF protection)
    if (isInternalUrl(url)) {
      return "Webhook URL cannot point to internal/private network addresses";
    }

    return null; // Valid
  } catch {
    return "Invalid URL format";
  }
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 2;

/**
 * Send a webhook notification
 * Returns true if successful, false if failed (non-blocking)
 */
export async function sendWebhook(
  config: WebhookConfig,
  payload: WebhookPayload
): Promise<boolean> {
  const { url, retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, secret } = config;

  // Build request headers
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "veo-cli/1.0",
    "X-Webhook-Event": payload.event,
    ...headers,
  };

  // Add HMAC signature if secret is configured
  const body = JSON.stringify(payload);
  if (secret) {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    requestHeaders["X-Webhook-Signature"] = `sha256=${signature}`;
  }

  const dnsError = await resolveAndValidateHost(url);
  if (dnsError) {
    warn(`Webhook blocked by DNS check: ${dnsError}`);
    return false;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers: requestHeaders,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        debug(`Webhook sent successfully: ${payload.event} -> ${url}`);
        return true;
      }

      const errorText = await response.text().catch(() => "");
      debug(
        `Webhook failed (attempt ${attempt + 1}/${retries + 1}): ${response.status} ${errorText.substring(0, 100)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debug(`Webhook error (attempt ${attempt + 1}/${retries + 1}): ${message}`);
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s...)
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  // Don't log loudly - webhook failures shouldn't alarm users
  debug(`Webhook delivery failed after ${retries + 1} attempts: ${url}`);
  return false;
}

/**
 * Create a job completion webhook payload
 */
export function createJobCompletedPayload(params: {
  batchId: string | number;
  jobId: string | number;
  jobIndex: number;
  tag?: string;
  prompt?: string;
  videoPath?: string;
  videoUrl?: string;
  durationMs: number;
}): WebhookPayload {
  return {
    event: "job.completed",
    timestamp: new Date().toISOString(),
    batchId: params.batchId,
    jobId: params.jobId,
    jobIndex: params.jobIndex,
    tag: params.tag,
    prompt: params.prompt,
    videoPath: params.videoPath,
    videoUrl: params.videoUrl,
    durationMs: params.durationMs,
  };
}

/**
 * Create a job failure webhook payload
 */
export function createJobFailedPayload(params: {
  batchId: string | number;
  jobId: string | number;
  jobIndex: number;
  tag?: string;
  prompt?: string;
  error: string;
}): WebhookPayload {
  return {
    event: "job.failed",
    timestamp: new Date().toISOString(),
    batchId: params.batchId,
    jobId: params.jobId,
    jobIndex: params.jobIndex,
    tag: params.tag,
    prompt: params.prompt,
    error: params.error,
  };
}

/**
 * Create a batch completion webhook payload
 */
export function createBatchCompletedPayload(params: {
  batchId: string | number;
  stats: {
    completed: number;
    failed: number;
    pending: number;
    total: number;
  };
}): WebhookPayload {
  return {
    event: "batch.completed",
    timestamp: new Date().toISOString(),
    batchId: params.batchId,
    stats: params.stats,
  };
}

/**
 * Create a batch failure webhook payload
 */
export function createBatchFailedPayload(params: {
  batchId: string | number;
  error: string;
  stats?: {
    completed: number;
    failed: number;
    pending: number;
    total: number;
  };
}): WebhookPayload {
  return {
    event: "batch.failed",
    timestamp: new Date().toISOString(),
    batchId: params.batchId,
    error: params.error,
    stats: params.stats,
  };
}

/**
 * WebhookManager - manages webhook notifications for a batch
 */
export class WebhookManager {
  private url: string | null;
  private config: WebhookConfig | null;
  private validationError: string | null = null;

  constructor(webhookUrl?: string, secret?: string) {
    if (!webhookUrl) {
      this.url = null;
      this.config = null;
      return;
    }

    // Validate the URL for SSRF protection
    const error = validateWebhookUrl(webhookUrl);
    if (error) {
      warn(`Webhook URL rejected: ${error}`);
      this.validationError = error;
      this.url = null;
      this.config = null;
      return;
    }

    this.url = webhookUrl;
    this.config = {
      url: webhookUrl,
      secret,
    };
  }

  /** Get validation error if URL was rejected */
  getValidationError(): string | null {
    return this.validationError;
  }

  /** Check if webhooks are enabled */
  isEnabled(): boolean {
    return this.url !== null;
  }

  /** Send job completed notification (non-blocking) */
  async notifyJobCompleted(params: {
    batchId: string | number;
    jobId: string | number;
    jobIndex: number;
    tag?: string;
    prompt?: string;
    videoPath?: string;
    videoUrl?: string;
    durationMs: number;
  }): Promise<void> {
    if (!this.config) return;
    const payload = createJobCompletedPayload(params);
    // Fire and forget - don't await
    sendWebhook(this.config, payload).catch(() => {});
  }

  /** Send job failed notification (non-blocking) */
  async notifyJobFailed(params: {
    batchId: string | number;
    jobId: string | number;
    jobIndex: number;
    tag?: string;
    prompt?: string;
    error: string;
  }): Promise<void> {
    if (!this.config) return;
    const payload = createJobFailedPayload(params);
    // Fire and forget - don't await
    sendWebhook(this.config, payload).catch(() => {});
  }

  /** Send batch completed notification (waits for delivery) */
  async notifyBatchCompleted(params: {
    batchId: string | number;
    stats: {
      completed: number;
      failed: number;
      pending: number;
      total: number;
    };
  }): Promise<boolean> {
    if (!this.config) return true;
    const payload = createBatchCompletedPayload(params);
    return sendWebhook(this.config, payload);
  }

  /** Send batch failed notification (waits for delivery) */
  async notifyBatchFailed(params: {
    batchId: string | number;
    error: string;
    stats?: {
      completed: number;
      failed: number;
      pending: number;
      total: number;
    };
  }): Promise<boolean> {
    if (!this.config) return true;
    const payload = createBatchFailedPayload(params);
    return sendWebhook(this.config, payload);
  }
}
