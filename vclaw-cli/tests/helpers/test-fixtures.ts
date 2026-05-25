/**
 * Test fixtures and database setup utilities for E2E tests
 */

import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import {
  initDB,
  closeDB,
  createBatch,
  createJobs,
  startJob,
  completeJob,
  failJob,
  updateBatchStatus,
  getBatchJobs,
  type BatchStatus,
  type JobStatus,
} from "../../src/db";

// Database file path. Keep E2E tests away from the user's working DB.
const DB_PATH = process.env.VEO_CLI_DB_PATH || join(process.cwd(), ".test-veo-cli.db");

/**
 * Clean up test database
 */
export function cleanupTestDB(): void {
  closeDB();
  if (existsSync(DB_PATH)) {
    try {
      unlinkSync(DB_PATH);
    } catch {
      // Ignore if file doesn't exist or can't be deleted
    }
  }
}

/**
 * Set up fresh test database
 */
export function setupTestDB(): void {
  cleanupTestDB();
  initDB();
}

/**
 * Job configuration for test fixtures
 */
export interface TestJobConfig {
  text?: string;
  type?: string;
  tag?: string | null;
  status?: JobStatus;
  videoPath?: string;
  errorMessage?: string;
  durationMs?: number;
  creditsUsed?: number;
}

/**
 * Create a test batch with jobs
 */
export function createTestBatchWithJobs(options: {
  promptsFile?: string;
  status?: BatchStatus;
  projectId?: string;
  jobs: TestJobConfig[];
}): number {
  const batchId = createBatch(
    options.promptsFile || "./prompts.txt",
    "testhash" + Date.now() + Math.random(),
    options.jobs.length
  );

  if (options.status) {
    updateBatchStatus(batchId, options.status, options.projectId);
  }

  // Create jobs
  createJobs(
    batchId,
    options.jobs.map((job, index) => ({
      index,
      text: job.text || `[test${index}] Test prompt ${index}`,
      type: job.type || "text",
      tag: job.tag !== undefined ? job.tag : `test${index}`,
    }))
  );

  // Apply job statuses
  const createdJobs = getBatchJobs(batchId);
  for (let i = 0; i < options.jobs.length; i++) {
    const config = options.jobs[i];
    const job = createdJobs[i];

    if (config.status === "running") {
      startJob(job.id);
    } else if (config.status === "completed") {
      startJob(job.id);
      completeJob(
        job.id,
        config.videoPath || `/videos/test${i}.mp4`,
        config.durationMs || 120000,
        config.creditsUsed || 10
      );
    } else if (config.status === "failed") {
      startJob(job.id);
      failJob(job.id, config.errorMessage || "Test error");
    } else if (config.status === "skipped") {
      // Directly update job status to skipped via raw SQL
      const db = initDB();
      db.prepare("UPDATE jobs SET status = 'skipped' WHERE id = ?").run(job.id);
    }
    // "pending" requires no additional action (pending is default)
  }

  return batchId;
}

/**
 * Pre-defined test fixtures
 */
export const FIXTURES = {
  /**
   * Simple batch with 3 pending jobs
   */
  simplePendingBatch: {
    promptsFile: "./prompts.txt",
    jobs: [
      { tag: "sunset", text: "[sunset] A beautiful sunset" },
      { tag: "ocean", text: "[ocean] Ocean waves crashing" },
      { tag: "forest", text: "[forest] Forest scene with birds" },
    ],
  },

  /**
   * Batch with mixed job statuses
   */
  mixedStatusBatch: {
    promptsFile: "./test-prompts.txt",
    status: "running" as BatchStatus,
    jobs: [
      { tag: "done", status: "completed" as JobStatus, videoPath: "/videos/done.mp4", creditsUsed: 100 },
      { tag: "error", status: "failed" as JobStatus, errorMessage: "API rate limit exceeded" },
      { tag: "waiting", status: "pending" as JobStatus },
      { tag: "active", status: "running" as JobStatus },
    ],
  },

  /**
   * Fully completed batch
   */
  completedBatch: {
    promptsFile: "./done.txt",
    status: "completed" as BatchStatus,
    jobs: [
      { tag: "v1", status: "completed" as JobStatus, videoPath: "/videos/v1.mp4", creditsUsed: 100, durationMs: 180000 },
      { tag: "v2", status: "completed" as JobStatus, videoPath: "/videos/v2.mp4", creditsUsed: 100, durationMs: 150000 },
    ],
  },

  /**
   * Batch with all failed jobs
   */
  allFailedBatch: {
    promptsFile: "./failed.txt",
    status: "running" as BatchStatus,
    jobs: [
      { tag: "f1", status: "failed" as JobStatus, errorMessage: "Content policy violation" },
      { tag: "f2", status: "failed" as JobStatus, errorMessage: "Generation timeout after 750 seconds" },
    ],
  },

  /**
   * Cancelled batch (jobs are skipped, not pending)
   */
  cancelledBatch: {
    promptsFile: "./cancelled.txt",
    status: "cancelled" as BatchStatus,
    jobs: [
      { tag: "c1", status: "completed" as JobStatus, videoPath: "/videos/c1.mp4" },
      { tag: "c2", status: "skipped" as JobStatus },
    ],
  },

  /**
   * Large batch for pagination tests
   */
  largeBatch: {
    promptsFile: "./large.txt",
    jobs: Array.from({ length: 10 }, (_, i) => ({
      tag: `item${i}`,
      text: `[item${i}] Test prompt number ${i}`,
    })),
  },

  /**
   * Batch with no tags (uses prompt indices)
   */
  noTagsBatch: {
    promptsFile: "./notags.txt",
    jobs: [
      { tag: null, text: "First prompt without tag" },
      { tag: null, text: "Second prompt without tag" },
    ],
  },
};
