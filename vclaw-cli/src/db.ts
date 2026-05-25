/**
 * SQLite Database Layer for veo-cli
 * Tracks batches and jobs for resume/checkpoint functionality
 */

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { join } from "path";

// Default to cwd for backward compatibility with existing batches and tests.
// Users who want a stable, working-directory-independent location can set
// VEO_CLI_DB_PATH (e.g. ~/.local/share/veo-cli/veo-cli.db) — see Codex audit #14.
function resolveDbPath(): string {
  const override = process.env.VEO_CLI_DB_PATH;
  if (override && override.trim() !== "") return override;
  if (process.env.NODE_ENV === "test") return join(process.cwd(), ".test-veo-cli.db");
  return join(process.cwd(), "veo-cli.db");
}

const DB_PATH = resolveDbPath();

// Types
export type BatchStatus = "pending" | "running" | "completed" | "cancelled";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface Batch {
  id: number;
  prompts_file: string;
  prompts_hash: string;
  project_id: string | null;
  status: BatchStatus;
  created_at: string;
  updated_at: string;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
}

export interface Job {
  id: number;
  batch_id: number;
  prompt_index: number;
  prompt_text: string;
  prompt_type: string;
  tag: string | null;
  status: JobStatus;
  video_path: string | null;
  error_message: string | null;
  credits_used: number | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface BatchStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
}

// Database singleton
let db: Database | null = null;

/**
 * Initialize database and create tables if needed
 */
export function initDB(): Database {
  if (db) return db;

  db = new Database(DB_PATH);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompts_file TEXT NOT NULL,
      prompts_hash TEXT NOT NULL,
      project_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_jobs INTEGER DEFAULT 0,
      completed_jobs INTEGER DEFAULT 0,
      failed_jobs INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      prompt_index INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      prompt_type TEXT NOT NULL,
      tag TEXT,
      status TEXT DEFAULT 'pending',
      video_path TEXT,
      error_message TEXT,
      credits_used INTEGER,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (batch_id) REFERENCES batches(id)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
  `);

  return db;
}

/**
 * Close database connection
 */
export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Generate MD5 hash of prompts content
 */
export function hashPrompts(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

/**
 * Create a new batch
 */
export function createBatch(promptsFile: string, promptsHash: string, totalJobs: number): number {
  const database = initDB();
  const stmt = database.prepare(`
    INSERT INTO batches (prompts_file, prompts_hash, total_jobs, status)
    VALUES (?, ?, ?, 'pending')
  `);
  const result = stmt.run(promptsFile, promptsHash, totalJobs);
  return Number(result.lastInsertRowid);
}

/**
 * Get batch by ID
 */
export function getBatch(id: number): Batch | null {
  const database = initDB();
  const stmt = database.prepare("SELECT * FROM batches WHERE id = ?");
  return stmt.get(id) as Batch | null;
}

/**
 * Get active (running or pending) batch for a prompts file
 */
export function getActiveBatch(promptsFile: string, promptsHash: string): Batch | null {
  const database = initDB();
  const stmt = database.prepare(`
    SELECT * FROM batches
    WHERE prompts_file = ?
      AND prompts_hash = ?
      AND status IN ('pending', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get(promptsFile, promptsHash) as Batch | null;
}

/**
 * Get the most recent incomplete batch (any prompts file)
 */
export function getMostRecentIncompleteBatch(): Batch | null {
  const database = initDB();
  const stmt = database.prepare(`
    SELECT * FROM batches
    WHERE status IN ('pending', 'running')
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  return stmt.get() as Batch | null;
}

/**
 * Update batch status
 */
export function updateBatchStatus(batchId: number, status: BatchStatus, projectId?: string): void {
  const database = initDB();
  if (projectId) {
    const stmt = database.prepare(`
      UPDATE batches
      SET status = ?, project_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(status, projectId, batchId);
  } else {
    const stmt = database.prepare(`
      UPDATE batches
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(status, batchId);
  }
}

/**
 * Update batch job counts
 */
export function updateBatchCounts(batchId: number): void {
  const database = initDB();
  const stmt = database.prepare(`
    UPDATE batches SET
      completed_jobs = (SELECT COUNT(*) FROM jobs WHERE batch_id = ? AND status = 'completed'),
      failed_jobs = (SELECT COUNT(*) FROM jobs WHERE batch_id = ? AND status = 'failed'),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(batchId, batchId, batchId);
}

/**
 * Create jobs for a batch
 */
export function createJobs(
  batchId: number,
  prompts: Array<{
    index: number;
    text: string;
    type: string;
    tag: string | null;
  }>
): void {
  const database = initDB();
  const stmt = database.prepare(`
    INSERT INTO jobs (batch_id, prompt_index, prompt_text, prompt_type, tag)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((jobs: typeof prompts) => {
    for (const job of jobs) {
      stmt.run(batchId, job.index, job.text, job.type, job.tag);
    }
  });

  insertMany(prompts);
}

/**
 * Get job by ID
 */
export function getJob(id: number): Job | null {
  const database = initDB();
  const stmt = database.prepare("SELECT * FROM jobs WHERE id = ?");
  return stmt.get(id) as Job | null;
}

/**
 * Get all jobs for a batch
 */
export function getBatchJobs(batchId: number): Job[] {
  const database = initDB();
  const stmt = database.prepare("SELECT * FROM jobs WHERE batch_id = ? ORDER BY prompt_index");
  return stmt.all(batchId) as Job[];
}

/**
 * Get pending jobs for a batch
 */
export function getPendingJobs(batchId: number): Job[] {
  const database = initDB();
  const stmt = database.prepare(`
    SELECT * FROM jobs
    WHERE batch_id = ? AND status = 'pending'
    ORDER BY prompt_index
  `);
  return stmt.all(batchId) as Job[];
}

/**
 * Update job status to running
 */
export function startJob(jobId: number): void {
  const database = initDB();
  const stmt = database.prepare(`
    UPDATE jobs
    SET status = 'running', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(jobId);
}

/**
 * Mark job as completed
 */
export function completeJob(
  jobId: number,
  videoPath: string,
  durationMs: number,
  creditsUsed: number = 10
): void {
  const database = initDB();
  const stmt = database.prepare(`
    UPDATE jobs
    SET status = 'completed',
        video_path = ?,
        duration_ms = ?,
        credits_used = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(videoPath, durationMs, creditsUsed, jobId);

  // Get batch ID and update counts
  const job = getJob(jobId);
  if (job) {
    updateBatchCounts(job.batch_id);
  }
}

/**
 * Mark job as failed
 */
export function failJob(jobId: number, errorMessage: string): void {
  const database = initDB();
  const stmt = database.prepare(`
    UPDATE jobs
    SET status = 'failed',
        error_message = ?,
        completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(errorMessage, jobId);

  // Get batch ID and update counts
  const job = getJob(jobId);
  if (job) {
    updateBatchCounts(job.batch_id);
  }
}

/**
 * Get batch statistics
 */
export function getBatchStats(batchId: number): BatchStats {
  const database = initDB();
  const stmt = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
    FROM jobs WHERE batch_id = ?
  `);
  const result = stmt.get(batchId) as any;
  if (!result) {
    return { total: 0, pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 };
  }
  return {
    total: result.total || 0,
    pending: result.pending || 0,
    running: result.running || 0,
    completed: result.completed || 0,
    failed: result.failed || 0,
    skipped: result.skipped || 0,
  };
}

/**
 * List all batches
 */
export function listBatches(limit: number = 20): Batch[] {
  const database = initDB();
  const stmt = database.prepare(`
    SELECT * FROM batches
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Batch[];
}

/**
 * Get job history across all batches
 */
export function getJobHistory(limit: number = 20): Array<Job & { batch_prompts_file: string }> {
  const database = initDB();
  const stmt = database.prepare(`
    SELECT j.*, b.prompts_file as batch_prompts_file
    FROM jobs j
    JOIN batches b ON j.batch_id = b.id
    ORDER BY j.completed_at DESC, j.created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Array<Job & { batch_prompts_file: string }>;
}

/**
 * Reset failed jobs in a batch to pending
 */
export function resetFailedJobs(batchId: number): number {
  const database = initDB();
  const stmt = database.prepare(`
    UPDATE jobs
    SET status = 'pending', error_message = NULL, started_at = NULL, completed_at = NULL
    WHERE batch_id = ? AND status = 'failed'
  `);
  const result = stmt.run(batchId);
  updateBatchCounts(batchId);
  return result.changes;
}

/**
 * Cancel a batch and all pending jobs
 */
export function cancelBatch(batchId: number): void {
  const database = initDB();

  // Cancel pending jobs
  const jobStmt = database.prepare(`
    UPDATE jobs
    SET status = 'skipped'
    WHERE batch_id = ? AND status IN ('pending', 'running')
  `);
  jobStmt.run(batchId);

  // Update batch status
  const batchStmt = database.prepare(`
    UPDATE batches
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  batchStmt.run(batchId);

  updateBatchCounts(batchId);
}

/**
 * Get average job duration from completed jobs (for ETA estimates)
 * Returns average in milliseconds, or default if no data available
 */
export function getAverageJobDuration(defaultMs: number = 90_000): number {
  const database = initDB();

  const stmt = database.prepare(`
    SELECT AVG(duration_ms) as avg_duration
    FROM jobs
    WHERE status = 'completed' AND duration_ms > 0
  `);

  const result = stmt.get() as { avg_duration: number | null } | undefined;
  return result?.avg_duration || defaultMs;
}

/**
 * Check if all jobs in a batch are complete
 */
export function isBatchComplete(batchId: number): boolean {
  const stats = getBatchStats(batchId);
  return stats.pending === 0 && stats.running === 0;
}

/**
 * Mark batch as completed if all jobs are done
 */
export function checkAndCompleteBatch(batchId: number): void {
  if (isBatchComplete(batchId)) {
    updateBatchStatus(batchId, "completed");
  }
}

// ============================================================================
// useapi.net History Tracking
// ============================================================================

/**
 * Status types for useapi history
 */
export type UseApiHistoryStatus = "success" | "failed" | "rate_limited" | "timeout";

/**
 * useapi.net history entry
 */
export interface UseApiHistoryEntry {
  id?: number;
  timestamp: string;
  job_id: string;
  backend: string;
  status: UseApiHistoryStatus;
  duration_ms: number | null;
  error_message: string | null;
  cost: number | null;
}

/**
 * Initialize useapi_history table
 */
function initUseApiHistoryTable(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS useapi_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      job_id TEXT NOT NULL,
      backend TEXT DEFAULT 'useapi',
      status TEXT NOT NULL,
      duration_ms INTEGER,
      error_message TEXT,
      cost REAL
    )
  `);
}

/**
 * Record a useapi.net job result
 */
export function recordUseApiHistory(entry: Omit<UseApiHistoryEntry, "id" | "timestamp">): number {
  const database = initDB();
  initUseApiHistoryTable(database);

  const stmt = database.prepare(`
    INSERT INTO useapi_history (job_id, backend, status, duration_ms, error_message, cost)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    entry.job_id,
    entry.backend || "useapi",
    entry.status,
    entry.duration_ms,
    entry.error_message,
    entry.cost
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get recent useapi.net history entries
 */
export function getUseApiHistory(limit: number = 100): UseApiHistoryEntry[] {
  const database = initDB();
  initUseApiHistoryTable(database);

  const stmt = database.prepare(`
    SELECT * FROM useapi_history
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  return stmt.all(limit) as UseApiHistoryEntry[];
}

/**
 * Get useapi.net history stats for last N hours
 */
export function getUseApiStats(hours: number = 24): {
  success: number;
  failed: number;
  rateLimited: number;
  timeout: number;
  totalCost: number;
  avgDurationMs: number | null;
} {
  const database = initDB();
  initUseApiHistoryTable(database);

  const stmt = database.prepare(`
    SELECT
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited,
      SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) as timeout,
      SUM(COALESCE(cost, 0)) as total_cost,
      AVG(duration_ms) as avg_duration
    FROM useapi_history
    WHERE timestamp >= datetime('now', '-' || ? || ' hours')
  `);

  const result = stmt.get(hours) as any;

  return {
    success: result?.success || 0,
    failed: result?.failed || 0,
    rateLimited: result?.rate_limited || 0,
    timeout: result?.timeout || 0,
    totalCost: result?.total_cost || 0,
    avgDurationMs: result?.avg_duration || null,
  };
}

/**
 * Clean up old useapi.net history entries (keep last N days)
 */
export function cleanupUseApiHistory(daysToKeep: number = 30): number {
  const database = initDB();
  initUseApiHistoryTable(database);

  const stmt = database.prepare(`
    DELETE FROM useapi_history
    WHERE timestamp < datetime('now', '-' || ? || ' days')
  `);

  const result = stmt.run(daysToKeep);
  return result.changes;
}

// ============================================================================
// Image Upload Cache
// ============================================================================

/**
 * Image upload cache entry
 */
export interface ImageCacheEntry {
  id?: number;
  file_hash: string;
  media_id: string;
  file_path: string;
  file_size: number;
  aspect_ratio: "landscape" | "portrait";
  backend: "direct" | "useapi";
  created_at: string;
  last_used_at: string;
}

/**
 * Initialize image_cache table
 */
function initImageCacheTable(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS image_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_hash TEXT NOT NULL,
      media_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      aspect_ratio TEXT DEFAULT 'landscape',
      backend TEXT DEFAULT 'direct',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(file_hash, aspect_ratio, backend)
    )
  `);

  // Create index for faster lookups
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_image_cache_hash
    ON image_cache(file_hash, aspect_ratio, backend)
  `);
}

/**
 * Get cached mediaId for an image file hash
 */
export function getImageCache(
  fileHash: string,
  aspectRatio: "landscape" | "portrait",
  backend: "direct" | "useapi"
): ImageCacheEntry | null {
  const database = initDB();
  initImageCacheTable(database);

  const stmt = database.prepare(`
    SELECT * FROM image_cache
    WHERE file_hash = ? AND aspect_ratio = ? AND backend = ?
  `);

  const entry = stmt.get(fileHash, aspectRatio, backend) as ImageCacheEntry | undefined;

  if (entry) {
    // Update last_used_at
    const updateStmt = database.prepare(`
      UPDATE image_cache SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    if (entry.id !== undefined) {
      updateStmt.run(entry.id);
    }
  }

  return entry || null;
}

/**
 * Store a mediaId in the image cache
 */
export function setImageCache(entry: Omit<ImageCacheEntry, "id" | "created_at" | "last_used_at">): number {
  const database = initDB();
  initImageCacheTable(database);

  // Use INSERT OR REPLACE to handle duplicates
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO image_cache
    (file_hash, media_id, file_path, file_size, aspect_ratio, backend, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);

  const result = stmt.run(
    entry.file_hash,
    entry.media_id,
    entry.file_path,
    entry.file_size,
    entry.aspect_ratio,
    entry.backend
  );

  return Number(result.lastInsertRowid);
}

/**
 * Get image cache statistics
 */
export function getImageCacheStats(): {
  totalEntries: number;
  directEntries: number;
  useapiEntries: number;
  totalSizeBytes: number;
} {
  const database = initDB();
  initImageCacheTable(database);

  const stmt = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN backend = 'direct' THEN 1 ELSE 0 END) as direct,
      SUM(CASE WHEN backend = 'useapi' THEN 1 ELSE 0 END) as useapi,
      SUM(file_size) as total_size
    FROM image_cache
  `);

  const result = stmt.get() as {
    total: number;
    direct: number;
    useapi: number;
    total_size: number;
  } | undefined;

  return {
    totalEntries: result?.total || 0,
    directEntries: result?.direct || 0,
    useapiEntries: result?.useapi || 0,
    totalSizeBytes: result?.total_size || 0,
  };
}

/**
 * Clean up old image cache entries (keep most recent N entries per backend)
 */
export function cleanupImageCache(keepPerBackend: number = 500): number {
  const database = initDB();
  initImageCacheTable(database);

  // Delete entries beyond the keep limit for each backend
  const stmt = database.prepare(`
    DELETE FROM image_cache
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY backend
          ORDER BY last_used_at DESC
        ) as rn
        FROM image_cache
      )
      WHERE rn > ?
    )
  `);

  const result = stmt.run(keepPerBackend);
  return result.changes;
}

/**
 * Hash a file's contents for cache lookup
 * Uses MD5 for speed (not cryptographic security)
 */
export function hashFileContents(content: ArrayBuffer): string {
  return createHash("md5").update(Buffer.from(content)).digest("hex");
}
