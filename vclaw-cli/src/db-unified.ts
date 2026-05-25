/**
 * Unified Database Layer for vclaw-cli
 *
 * Thin pass-through to the SQLite backend (`./db`). Job state lives in
 * a process-local `veo-cli.db` SQLite file; canonical project state is
 * the parent videoclaw CLI's `projects/<slug>/` JSON layout. Cloud
 * state is out of scope (see Phase 9c v3 design spec).
 *
 * Functions remain `async` to preserve call-site shape; the underlying
 * SQLite calls are synchronous and wrapped in `Promise.resolve(...)`.
 */

import * as sqlite from "./db";

export type BatchStatus = sqlite.BatchStatus;
export type JobStatus = sqlite.JobStatus;
export type Batch = sqlite.Batch;
export type Job = sqlite.Job;
export type BatchStats = sqlite.BatchStats;
export type UseApiHistoryStatus = sqlite.UseApiHistoryStatus;
export type UseApiHistoryEntry = sqlite.UseApiHistoryEntry;
export type { ImageCacheEntry } from "./db";

/**
 * Initialize the SQLite database (creates tables on first run).
 */
export async function initDB(_email?: string): Promise<void> {
  sqlite.initDB();
}

/**
 * Close the database connection.
 */
export function closeDB(): void {
  sqlite.closeDB();
}

/**
 * MD5 hash of prompts content (used for active-batch lookup).
 */
export function hashPrompts(content: string): string {
  return sqlite.hashPrompts(content);
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

export async function createBatch(
  promptsFile: string,
  promptsHash: string,
  totalJobs: number,
  _options?: {
    backend?: "direct" | "useapi";
    quality?: "free" | "fast" | "quality" | "veo2";
    aspectRatio?: "16:9" | "9:16" | "1:1";
  }
): Promise<number> {
  return sqlite.createBatch(promptsFile, promptsHash, totalJobs);
}

export async function getBatch(id: string | number): Promise<Batch | null> {
  return sqlite.getBatch(Number(id));
}

export async function getActiveBatch(
  promptsFile: string,
  promptsHash: string
): Promise<Batch | null> {
  return sqlite.getActiveBatch(promptsFile, promptsHash);
}

export async function getMostRecentIncompleteBatch(): Promise<Batch | null> {
  return sqlite.getMostRecentIncompleteBatch();
}

export async function updateBatchStatus(
  batchId: string | number,
  status: sqlite.BatchStatus,
  projectId?: string
): Promise<void> {
  sqlite.updateBatchStatus(Number(batchId), status, projectId);
}

export async function updateBatchCounts(batchId: string | number): Promise<void> {
  sqlite.updateBatchCounts(Number(batchId));
}

// ============================================================================
// JOB OPERATIONS
// ============================================================================

export async function createJobs(
  batchId: string | number,
  prompts: Array<{
    index: number;
    text: string;
    type: string;
    tag: string | null;
  }>
): Promise<void> {
  sqlite.createJobs(Number(batchId), prompts);
}

export async function getJob(id: string | number): Promise<Job | null> {
  return sqlite.getJob(Number(id));
}

export async function getBatchJobs(batchId: string | number): Promise<Job[]> {
  return sqlite.getBatchJobs(Number(batchId));
}

export async function getPendingJobs(batchId: string | number): Promise<Job[]> {
  return sqlite.getPendingJobs(Number(batchId));
}

export async function startJob(
  jobId: string | number,
  _useapiJobId?: string
): Promise<void> {
  sqlite.startJob(Number(jobId));
}

export async function completeJob(
  jobId: string | number,
  videoPath: string,
  durationMs: number,
  creditsUsed: number = 10,
  _options?: {
    videoUrl?: string;
    mediaId?: string;
    altVideoPath?: string;
    altVideoUrl?: string;
    altMediaId?: string;
    captchaCreditsUsed?: number;
  }
): Promise<void> {
  sqlite.completeJob(Number(jobId), videoPath, durationMs, creditsUsed);
}

export async function failJob(
  jobId: string | number,
  errorMessage: string
): Promise<void> {
  sqlite.failJob(Number(jobId), errorMessage);
}

export async function getBatchStats(
  batchId: string | number
): Promise<sqlite.BatchStats> {
  return sqlite.getBatchStats(Number(batchId));
}

export async function listBatches(limit: number = 20): Promise<Batch[]> {
  return sqlite.listBatches(limit);
}

export async function getJobHistory(
  limit: number = 20
): Promise<Array<Job & { batch_prompts_file: string }>> {
  return sqlite.getJobHistory(limit);
}

export async function resetFailedJobs(batchId: string | number): Promise<number> {
  return sqlite.resetFailedJobs(Number(batchId));
}

export async function cancelBatch(batchId: string | number): Promise<void> {
  sqlite.cancelBatch(Number(batchId));
}

export async function isBatchComplete(batchId: string | number): Promise<boolean> {
  return sqlite.isBatchComplete(Number(batchId));
}

export async function checkAndCompleteBatch(batchId: string | number): Promise<void> {
  sqlite.checkAndCompleteBatch(Number(batchId));
}

export async function getAverageJobDuration(defaultMs: number = 90_000): Promise<number> {
  return sqlite.getAverageJobDuration(defaultMs);
}

// ============================================================================
// useapi.net History Tracking
// ============================================================================

export async function recordUseApiHistory(
  entry: Omit<sqlite.UseApiHistoryEntry, "id" | "timestamp">
): Promise<number> {
  return sqlite.recordUseApiHistory(entry);
}

export async function getUseApiHistory(
  limit: number = 100
): Promise<UseApiHistoryEntry[]> {
  return sqlite.getUseApiHistory(limit);
}

export async function getUseApiStats(hours: number = 24): Promise<{
  success: number;
  failed: number;
  rateLimited: number;
  timeout: number;
  totalCost: number;
  avgDurationMs: number | null;
}> {
  return sqlite.getUseApiStats(hours);
}

export async function cleanupUseApiHistory(daysToKeep: number = 30): Promise<number> {
  return sqlite.cleanupUseApiHistory(daysToKeep);
}

// ============================================================================
// IMAGE UPLOAD CACHE  (SQLite-only, always was)
// ============================================================================

export function getImageCache(
  fileHash: string,
  aspectRatio: "landscape" | "portrait",
  backend: "direct" | "useapi"
): sqlite.ImageCacheEntry | null {
  return sqlite.getImageCache(fileHash, aspectRatio, backend);
}

export function setImageCache(
  entry: Omit<sqlite.ImageCacheEntry, "id" | "created_at" | "last_used_at">
): number {
  return sqlite.setImageCache(entry);
}

export function getImageCacheStats(): {
  totalEntries: number;
  directEntries: number;
  useapiEntries: number;
  totalSizeBytes: number;
} {
  return sqlite.getImageCacheStats();
}

export function cleanupImageCache(keepPerBackend: number = 500): number {
  return sqlite.cleanupImageCache(keepPerBackend);
}

export function hashFileContents(content: ArrayBuffer): string {
  return sqlite.hashFileContents(content);
}
