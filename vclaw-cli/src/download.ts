/**
 * Video download module for veo-cli
 */

import { join } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import type { Operation } from "./types";
import { log } from "./config";
import { createTimeoutController } from "./api";

// User agent for downloads (set by main module)
let userAgent = "";

// Default concurrency for parallel downloads
const DEFAULT_CONCURRENCY = 3;

/**
 * Set user agent for download requests
 */
export function setUserAgent(ua: string): void {
  userAgent = ua;
}

/**
 * Run async tasks with limited concurrency
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      results.push(result);
    });

    const executingPromise = promise.then(() => {
      executing.splice(executing.indexOf(executingPromise), 1);
    });

    executing.push(executingPromise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Download a single video file
 */
async function downloadSingleVideo(
  downloadUrl: string,
  filePath: string,
  fileName: string,
  timeoutMs: number
): Promise<{ success: boolean; fileName: string; error?: string }> {
  try {
    const downloadController = createTimeoutController(timeoutMs);
    const response = await fetch(downloadUrl, {
      headers: { "user-agent": userAgent },
      signal: downloadController.signal,
    }).finally(downloadController.cancel);

    if (!response.ok || !response.body) {
      return {
        success: false,
        fileName,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const fileWriter = Bun.file(filePath).writer();
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileWriter.write(value);
    }
    fileWriter.end();

    return { success: true, fileName };
  } catch (error) {
    return {
      success: false,
      fileName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Download videos from completed operations (with parallel downloads)
 * @param operations - Array of completed operations with video URLs
 * @param videoDir - Directory to save videos
 * @param timeoutMs - Timeout per video download (default: 5 minutes)
 * @param tag - Optional tag to use in filename
 * @param concurrency - Number of parallel downloads (default: 3)
 */
export async function download(
  operations: Operation[],
  videoDir: string,
  timeoutMs = 5 * 60_000,
  tag?: string,
  concurrency = DEFAULT_CONCURRENCY
): Promise<void> {
  if (!existsSync(videoDir)) await mkdir(videoDir, { recursive: true });

  // Generate timestamp for filename: YYYY-MM-DD_HH-MM
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 5).replace(":", "-"); // HH-MM
  const timestamp = `${dateStr}_${timeStr}`;

  // Prepare download tasks
  const downloadTasks: { fileName: string; downloadUrl: string; filePath: string }[] = [];

  operations.forEach(({ operation }, index) => {
    const idx = index + 1;

    // Check if video metadata exists (generation may have failed)
    if (!operation.metadata?.video) {
      log(`  Skipping operation ${idx}: no video metadata (generation may have failed)`);
      return;
    }

    // Use provided tag, or extract from prompt [tag], or use operation name
    const baseName =
      tag ||
      operation.metadata.video.prompt?.match(/^\[(.*?)\]/)?.[1] ||
      operation.name?.split("/").pop() ||
      "video";

    // Build filename with timestamp
    let fileName = `${timestamp}_${baseName}`;

    // Add index suffix for multiple outputs
    if (operations.length > 1) {
      fileName += `_${idx}`;
    }
    fileName += ".mp4";

    const downloadUrl = operation.metadata.video.fifeUrl;
    const filePath = join(videoDir, fileName);

    downloadTasks.push({ fileName, downloadUrl, filePath });
  });

  if (downloadTasks.length === 0) {
    log("  No videos to download");
    return;
  }

  // For single video, download directly (no concurrency overhead)
  if (downloadTasks.length === 1) {
    const task = downloadTasks[0];
    if (!task) return;
    const result = await downloadSingleVideo(task.downloadUrl, task.filePath, task.fileName, timeoutMs);
    if (result.success) {
      log(`  Saved: ${result.fileName}`);
    } else {
      throw new Error(`Failed to download video ${result.fileName}: ${result.error}`);
    }
    return;
  }

  // Use parallel downloads for multiple videos
  log(`  Downloading ${downloadTasks.length} videos (${concurrency} parallel)...`);

  const tasks = downloadTasks.map((task) => () =>
    downloadSingleVideo(task.downloadUrl, task.filePath, task.fileName, timeoutMs)
  );

  const results = await runWithConcurrency(tasks, concurrency);

  // Report results
  const failed = results.filter((r) => !r.success);
  const succeeded = results.filter((r) => r.success);

  for (const result of succeeded) {
    log(`  Saved: ${result.fileName}`);
  }

  if (failed.length > 0) {
    const errors = failed.map((f) => `${f.fileName}: ${f.error}`).join("; ");
    throw new Error(`Failed to download ${failed.length} video(s): ${errors}`);
  }
}
