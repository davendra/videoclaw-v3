/**
 * Unit tests for src/db.ts
 * Tests SQLite database operations for batch/job tracking
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import {
  initDB,
  closeDB,
  hashPrompts,
  createBatch,
  getBatch,
  getActiveBatch,
  getMostRecentIncompleteBatch,
  updateBatchStatus,
  updateBatchCounts,
  createJobs,
  getJob,
  getBatchJobs,
  getPendingJobs,
  startJob,
  completeJob,
  failJob,
  getBatchStats,
  listBatches,
  getJobHistory,
  resetFailedJobs,
  cancelBatch,
  isBatchComplete,
  checkAndCompleteBatch,
  type Batch,
  type Job,
  type BatchStats,
} from "../src/db";

// Database file path for cleanup. Keep tests away from the user's working DB.
const DB_PATH = process.env.VEO_CLI_DB_PATH || join(process.cwd(), ".test-veo-cli.db");

// Helper to clean up database between tests
function cleanupDB() {
  closeDB();
  if (existsSync(DB_PATH)) {
    try {
      unlinkSync(DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

describe("hashPrompts", () => {
  test("returns MD5 hash of content", () => {
    const hash = hashPrompts("Hello World");
    expect(hash).toBe("b10a8db164e0754105b7a99be72e3fe5");
  });

  test("returns same hash for same content", () => {
    const hash1 = hashPrompts("test content");
    const hash2 = hashPrompts("test content");
    expect(hash1).toBe(hash2);
  });

  test("returns different hash for different content", () => {
    const hash1 = hashPrompts("content1");
    const hash2 = hashPrompts("content2");
    expect(hash1).not.toBe(hash2);
  });

  test("handles empty string", () => {
    const hash = hashPrompts("");
    expect(hash).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  test("handles unicode content", () => {
    const hash = hashPrompts("Hello \u4e16\u754c");
    expect(hash).toHaveLength(32); // MD5 is always 32 hex chars
  });
});

describe("initDB and closeDB", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("creates database file", () => {
    initDB();
    expect(existsSync(DB_PATH)).toBe(true);
  });

  test("returns database instance", () => {
    const db = initDB();
    expect(db).toBeDefined();
  });

  test("returns same instance on multiple calls", () => {
    const db1 = initDB();
    const db2 = initDB();
    expect(db1).toBe(db2);
  });

  test("closeDB closes connection", () => {
    initDB();
    closeDB();
    // After close, a new init should create new instance
    const db = initDB();
    expect(db).toBeDefined();
  });
});

describe("createBatch and getBatch", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("creates batch and returns ID", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    expect(batchId).toBeGreaterThan(0);
  });

  test("getBatch returns created batch", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    const batch = getBatch(batchId);
    expect(batch).not.toBeNull();
    expect(batch?.id).toBe(batchId);
    expect(batch?.prompts_file).toBe("./prompts.txt");
    expect(batch?.prompts_hash).toBe("abc123");
    expect(batch?.total_jobs).toBe(5);
    expect(batch?.status).toBe("pending");
  });

  test("getBatch returns null for non-existent ID", () => {
    initDB();
    const batch = getBatch(999);
    expect(batch).toBeNull();
  });

  test("creates multiple batches with incrementing IDs", () => {
    const id1 = createBatch("./p1.txt", "h1", 3);
    const id2 = createBatch("./p2.txt", "h2", 5);
    expect(id2).toBe(id1 + 1);
  });

  test("batch has correct default values", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    const batch = getBatch(batchId);
    expect(batch?.completed_jobs).toBe(0);
    expect(batch?.failed_jobs).toBe(0);
    expect(batch?.project_id).toBeNull();
  });
});

describe("getActiveBatch", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns active batch for matching file and hash", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    const active = getActiveBatch("./prompts.txt", "abc123");
    expect(active).not.toBeNull();
    expect(active?.id).toBe(batchId);
  });

  test("returns null for non-matching file", () => {
    createBatch("./prompts.txt", "abc123", 5);
    const active = getActiveBatch("./other.txt", "abc123");
    expect(active).toBeNull();
  });

  test("returns null for non-matching hash", () => {
    createBatch("./prompts.txt", "abc123", 5);
    const active = getActiveBatch("./prompts.txt", "xyz789");
    expect(active).toBeNull();
  });

  test("returns null for completed batch", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    updateBatchStatus(batchId, "completed");
    const active = getActiveBatch("./prompts.txt", "abc123");
    expect(active).toBeNull();
  });

  test("returns running batch as active", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    updateBatchStatus(batchId, "running");
    const active = getActiveBatch("./prompts.txt", "abc123");
    expect(active).not.toBeNull();
    expect(active?.status).toBe("running");
  });
});

describe("getMostRecentIncompleteBatch", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns most recent incomplete batch", () => {
    const id1 = createBatch("./p1.txt", "h1", 3);
    const id2 = createBatch("./p2.txt", "h2", 5);
    const recent = getMostRecentIncompleteBatch();
    expect(recent).not.toBeNull();
    // Both batches have same timestamp, so either can be returned
    expect([id1, id2]).toContain(recent!.id);
  });

  test("returns null when no incomplete batches", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    updateBatchStatus(batchId, "completed");
    const recent = getMostRecentIncompleteBatch();
    expect(recent).toBeNull();
  });

  test("skips cancelled batches", () => {
    const id1 = createBatch("./p1.txt", "h1", 3);
    const id2 = createBatch("./p2.txt", "h2", 5);
    updateBatchStatus(id2, "cancelled");
    const recent = getMostRecentIncompleteBatch();
    expect(recent?.id).toBe(id1);
  });
});

describe("updateBatchStatus", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("updates batch status", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    updateBatchStatus(batchId, "running");
    const batch = getBatch(batchId);
    expect(batch?.status).toBe("running");
  });

  test("updates batch status with project ID", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    updateBatchStatus(batchId, "running", "project-123");
    const batch = getBatch(batchId);
    expect(batch?.status).toBe("running");
    expect(batch?.project_id).toBe("project-123");
  });

  test("can set status to completed", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    updateBatchStatus(batchId, "completed");
    const batch = getBatch(batchId);
    expect(batch?.status).toBe("completed");
  });

  test("can set status to cancelled", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    updateBatchStatus(batchId, "cancelled");
    const batch = getBatch(batchId);
    expect(batch?.status).toBe("cancelled");
  });
});

describe("createJobs and getBatchJobs", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("creates jobs for batch", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "[sunset] Beautiful sunset", type: "text", tag: "sunset" },
      { index: 1, text: "[ocean] Ocean waves", type: "text", tag: "ocean" },
    ]);
    const jobs = getBatchJobs(batchId);
    expect(jobs).toHaveLength(2);
  });

  test("jobs are ordered by prompt_index", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 1, text: "Second", type: "text", tag: "b" },
      { index: 0, text: "First", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    expect(jobs[0].prompt_index).toBe(0);
    expect(jobs[1].prompt_index).toBe(1);
  });

  test("jobs have correct properties", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "[sunset] Sunset", type: "image", tag: "sunset" },
    ]);
    const jobs = getBatchJobs(batchId);
    expect(jobs[0].prompt_text).toBe("[sunset] Sunset");
    expect(jobs[0].prompt_type).toBe("image");
    expect(jobs[0].tag).toBe("sunset");
    expect(jobs[0].status).toBe("pending");
  });

  test("jobs with null tag are created correctly", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "No tag prompt", type: "text", tag: null },
    ]);
    const jobs = getBatchJobs(batchId);
    expect(jobs[0].tag).toBeNull();
  });

  test("returns empty array for batch with no jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 0);
    const jobs = getBatchJobs(batchId);
    expect(jobs).toEqual([]);
  });
});

describe("getJob", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns job by ID", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "Test prompt", type: "text", tag: "test" },
    ]);
    const jobs = getBatchJobs(batchId);
    const job = getJob(jobs[0].id);
    expect(job).not.toBeNull();
    expect(job?.prompt_text).toBe("Test prompt");
  });

  test("returns null for non-existent ID", () => {
    initDB();
    const job = getJob(999);
    expect(job).toBeNull();
  });
});

describe("getPendingJobs", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns only pending jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 3);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
      { index: 2, text: "P3", type: "text", tag: "c" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);
    completeJob(jobs[0].id, "/path/video.mp4", 1000, 10);

    const pending = getPendingJobs(batchId);
    expect(pending).toHaveLength(2);
    expect(pending[0].prompt_index).toBe(1);
    expect(pending[1].prompt_index).toBe(2);
  });

  test("returns empty array when no pending jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);
    completeJob(jobs[0].id, "/path/video.mp4", 1000, 10);

    const pending = getPendingJobs(batchId);
    expect(pending).toEqual([]);
  });
});

describe("startJob", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("updates job status to running", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);

    const job = getJob(jobs[0].id);
    expect(job?.status).toBe("running");
  });

  test("sets started_at timestamp", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);

    const job = getJob(jobs[0].id);
    expect(job?.started_at).not.toBeNull();
  });
});

describe("completeJob", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("updates job to completed status", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);
    completeJob(jobs[0].id, "/path/video.mp4", 5000, 10);

    const job = getJob(jobs[0].id);
    expect(job?.status).toBe("completed");
  });

  test("sets video path, duration, and credits", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/output/sunset.mp4", 120000, 100);

    const job = getJob(jobs[0].id);
    expect(job?.video_path).toBe("/output/sunset.mp4");
    expect(job?.duration_ms).toBe(120000);
    expect(job?.credits_used).toBe(100);
  });

  test("sets completed_at timestamp", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/path/video.mp4", 5000, 10);

    const job = getJob(jobs[0].id);
    expect(job?.completed_at).not.toBeNull();
  });

  test("updates batch counts", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/path/video.mp4", 5000, 10);

    const batch = getBatch(batchId);
    expect(batch?.completed_jobs).toBe(1);
  });

  test("uses default credits value of 10", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/path/video.mp4", 5000);

    const job = getJob(jobs[0].id);
    expect(job?.credits_used).toBe(10);
  });
});

describe("failJob", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("updates job to failed status", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);
    failJob(jobs[0].id, "API error");

    const job = getJob(jobs[0].id);
    expect(job?.status).toBe("failed");
  });

  test("sets error message", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    failJob(jobs[0].id, "Rate limit exceeded");

    const job = getJob(jobs[0].id);
    expect(job?.error_message).toBe("Rate limit exceeded");
  });

  test("sets completed_at timestamp", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    failJob(jobs[0].id, "Error");

    const job = getJob(jobs[0].id);
    expect(job?.completed_at).not.toBeNull();
  });

  test("updates batch counts", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    failJob(jobs[0].id, "Error");

    const batch = getBatch(batchId);
    expect(batch?.failed_jobs).toBe(1);
  });
});

describe("getBatchStats", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns correct initial stats", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 3);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
      { index: 2, text: "P3", type: "text", tag: "c" },
    ]);

    const stats = getBatchStats(batchId);
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(3);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.skipped).toBe(0);
  });

  test("counts running jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);

    const stats = getBatchStats(batchId);
    expect(stats.running).toBe(1);
    expect(stats.pending).toBe(1);
  });

  test("counts completed jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/path/v.mp4", 1000, 10);

    const stats = getBatchStats(batchId);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1);
  });

  test("counts failed jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    failJob(jobs[0].id, "Error");

    const stats = getBatchStats(batchId);
    expect(stats.failed).toBe(1);
    expect(stats.pending).toBe(1);
  });

  test("returns zeros for empty batch", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 0);
    const stats = getBatchStats(batchId);
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
  });
});

describe("listBatches", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns batches (all batches included)", () => {
    createBatch("./p1.txt", "h1", 1);
    createBatch("./p2.txt", "h2", 2);
    createBatch("./p3.txt", "h3", 3);

    const batches = listBatches();
    expect(batches).toHaveLength(3);
    // Verify all batches are present (order depends on timestamp)
    const files = batches.map(b => b.prompts_file);
    expect(files).toContain("./p1.txt");
    expect(files).toContain("./p2.txt");
    expect(files).toContain("./p3.txt");
  });

  test("respects limit parameter", () => {
    createBatch("./p1.txt", "h1", 1);
    createBatch("./p2.txt", "h2", 2);
    createBatch("./p3.txt", "h3", 3);

    const batches = listBatches(2);
    expect(batches).toHaveLength(2);
  });

  test("returns empty array when no batches", () => {
    initDB();
    const batches = listBatches();
    expect(batches).toEqual([]);
  });

  test("uses default limit of 20", () => {
    for (let i = 0; i < 25; i++) {
      createBatch(`./p${i}.txt`, `h${i}`, 1);
    }
    const batches = listBatches();
    expect(batches).toHaveLength(20);
  });
});

describe("getJobHistory", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns jobs across batches", () => {
    const b1 = createBatch("./p1.txt", "h1", 1);
    const b2 = createBatch("./p2.txt", "h2", 1);
    createJobs(b1, [{ index: 0, text: "P1", type: "text", tag: "a" }]);
    createJobs(b2, [{ index: 0, text: "P2", type: "text", tag: "b" }]);

    const jobs1 = getBatchJobs(b1);
    const jobs2 = getBatchJobs(b2);
    completeJob(jobs1[0].id, "/v1.mp4", 1000, 10);
    completeJob(jobs2[0].id, "/v2.mp4", 2000, 10);

    const history = getJobHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  test("includes batch_prompts_file in result", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [{ index: 0, text: "P1", type: "text", tag: "a" }]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/v.mp4", 1000, 10);

    const history = getJobHistory();
    expect(history[0].batch_prompts_file).toBe("./prompts.txt");
  });

  test("respects limit parameter", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 5);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
      { index: 2, text: "P3", type: "text", tag: "c" },
      { index: 3, text: "P4", type: "text", tag: "d" },
      { index: 4, text: "P5", type: "text", tag: "e" },
    ]);
    const jobs = getBatchJobs(batchId);
    for (const job of jobs) {
      completeJob(job.id, `/v${job.id}.mp4`, 1000, 10);
    }

    const history = getJobHistory(2);
    expect(history).toHaveLength(2);
  });
});

describe("resetFailedJobs", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("resets failed jobs to pending", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    failJob(jobs[0].id, "Error");

    const count = resetFailedJobs(batchId);
    expect(count).toBe(1);

    const job = getJob(jobs[0].id);
    expect(job?.status).toBe("pending");
  });

  test("clears error message on reset", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    failJob(jobs[0].id, "Original error");
    resetFailedJobs(batchId);

    const job = getJob(jobs[0].id);
    expect(job?.error_message).toBeNull();
  });

  test("clears timestamps on reset", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);
    failJob(jobs[0].id, "Error");
    resetFailedJobs(batchId);

    const job = getJob(jobs[0].id);
    expect(job?.started_at).toBeNull();
    expect(job?.completed_at).toBeNull();
  });

  test("returns 0 when no failed jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);

    const count = resetFailedJobs(batchId);
    expect(count).toBe(0);
  });

  test("only resets failed jobs, not completed", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/v.mp4", 1000, 10);
    failJob(jobs[1].id, "Error");

    resetFailedJobs(batchId);

    const job0 = getJob(jobs[0].id);
    const job1 = getJob(jobs[1].id);
    expect(job0?.status).toBe("completed");
    expect(job1?.status).toBe("pending");
  });
});

describe("cancelBatch", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("sets batch status to cancelled", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);

    cancelBatch(batchId);

    const batch = getBatch(batchId);
    expect(batch?.status).toBe("cancelled");
  });

  test("sets pending jobs to skipped", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);

    cancelBatch(batchId);

    const stats = getBatchStats(batchId);
    expect(stats.skipped).toBe(2);
    expect(stats.pending).toBe(0);
  });

  test("sets running jobs to skipped", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);

    cancelBatch(batchId);

    const job = getJob(jobs[0].id);
    expect(job?.status).toBe("skipped");
  });

  test("does not affect completed jobs", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/v.mp4", 1000, 10);

    cancelBatch(batchId);

    const job = getJob(jobs[0].id);
    expect(job?.status).toBe("completed");
  });
});

describe("isBatchComplete", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("returns false when pending jobs exist", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);

    expect(isBatchComplete(batchId)).toBe(false);
  });

  test("returns false when running jobs exist", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    startJob(jobs[0].id);

    expect(isBatchComplete(batchId)).toBe(false);
  });

  test("returns true when all jobs completed", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/v1.mp4", 1000, 10);
    completeJob(jobs[1].id, "/v2.mp4", 2000, 10);

    expect(isBatchComplete(batchId)).toBe(true);
  });

  test("returns true when all jobs failed", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    failJob(jobs[0].id, "Error");

    expect(isBatchComplete(batchId)).toBe(true);
  });

  test("returns true when jobs are mix of completed and failed", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/v.mp4", 1000, 10);
    failJob(jobs[1].id, "Error");

    expect(isBatchComplete(batchId)).toBe(true);
  });

  test("returns true when jobs are skipped", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    cancelBatch(batchId);

    expect(isBatchComplete(batchId)).toBe(true);
  });
});

describe("checkAndCompleteBatch", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("marks batch as completed when all jobs done", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 1);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/v.mp4", 1000, 10);

    checkAndCompleteBatch(batchId);

    const batch = getBatch(batchId);
    expect(batch?.status).toBe("completed");
  });

  test("does not change batch status when jobs pending", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    updateBatchStatus(batchId, "running");
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);
    const jobs = getBatchJobs(batchId);
    completeJob(jobs[0].id, "/v.mp4", 1000, 10);

    checkAndCompleteBatch(batchId);

    const batch = getBatch(batchId);
    expect(batch?.status).toBe("running");
  });
});

describe("updateBatchCounts", () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  test("updates completed_jobs count", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 3);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
      { index: 2, text: "P3", type: "text", tag: "c" },
    ]);

    // Manually update job status via DB
    const db = initDB();
    db.prepare("UPDATE jobs SET status = 'completed' WHERE prompt_index = 0").run();
    db.prepare("UPDATE jobs SET status = 'completed' WHERE prompt_index = 1").run();

    updateBatchCounts(batchId);

    const batch = getBatch(batchId);
    expect(batch?.completed_jobs).toBe(2);
  });

  test("updates failed_jobs count", () => {
    const batchId = createBatch("./prompts.txt", "abc123", 2);
    createJobs(batchId, [
      { index: 0, text: "P1", type: "text", tag: "a" },
      { index: 1, text: "P2", type: "text", tag: "b" },
    ]);

    const db = initDB();
    db.prepare("UPDATE jobs SET status = 'failed' WHERE prompt_index = 0").run();

    updateBatchCounts(batchId);

    const batch = getBatch(batchId);
    expect(batch?.failed_jobs).toBe(1);
  });
});
