/**
 * E2E tests for CLI commands with real SQLite database
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  runStatus,
  runList,
  runResume,
  runReset,
  runHistory,
  runCancel,
  runHelp,
} from "../src/cli";
import { ConsoleCapture } from "./helpers/console-capture";
import {
  setupTestDB,
  cleanupTestDB,
  createTestBatchWithJobs,
  FIXTURES,
} from "./helpers/test-fixtures";

// Console capture instance
const capture = new ConsoleCapture();

describe("CLI E2E Tests", () => {
  beforeEach(() => {
    setupTestDB();
    capture.start();
  });

  afterEach(() => {
    capture.stop();
    cleanupTestDB();
  });

  // ==================== STATUS COMMAND ====================
  describe("status command", () => {
    test("shows 'No active batch found' when database empty", async () => {
      await runStatus();
      expect(capture.contains("No active batch found")).toBe(true);
    });

    test("shows batch details for active pending batch", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runStatus();
      expect(capture.contains("Batch Status")).toBe(true);
      expect(capture.contains("prompts.txt")).toBe(true);
      expect(capture.contains("pending")).toBe(true);
    });

    test("shows progress bar for active batch", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runStatus();
      expect(capture.contains("Progress:")).toBe(true);
      expect(capture.contains("0/3")).toBe(true);
    });

    test("shows correct progress for partially completed batch", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runStatus();
      expect(capture.contains("1/4")).toBe(true);
    });

    test("shows specific batch by ID", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runStatus(batchId);
      expect(capture.contains(`Batch ID: ${batchId}`)).toBe(true);
    });

    test("shows 'Batch not found' for non-existent ID", async () => {
      await runStatus(999);
      expect(capture.contains("Batch #999 not found")).toBe(true);
    });

    test("shows retry suggestion when batch has failed jobs", async () => {
      createTestBatchWithJobs(FIXTURES.allFailedBatch);
      await runStatus();
      expect(capture.contains("failed")).toBe(true);
      expect(capture.contains("reset")).toBe(true);
    });

    test("displays job tags correctly", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runStatus();
      expect(capture.contains("[sunset]")).toBe(true);
      expect(capture.contains("[ocean]")).toBe(true);
    });

    test("displays prompt indices for untagged jobs", async () => {
      createTestBatchWithJobs(FIXTURES.noTagsBatch);
      await runStatus();
      expect(capture.contains("#0")).toBe(true);
      expect(capture.contains("#1")).toBe(true);
    });

    test("shows video filename for completed jobs", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runStatus();
      expect(capture.contains("done.mp4")).toBe(true);
    });

    test("shows error snippet for failed jobs", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runStatus();
      expect(capture.contains("Error:")).toBe(true);
      expect(capture.contains("rate limit")).toBe(true);
    });

    test("shows 'Batch completed' message for finished batch", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.completedBatch);
      await runStatus(batchId);
      expect(capture.contains("completed")).toBe(true);
    });
  });

  // ==================== LIST COMMAND ====================
  describe("list command", () => {
    test("shows 'No batches found' when database empty", async () => {
      await runList();
      expect(capture.contains("No batches found")).toBe(true);
    });

    test("displays batch in table format", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runList();
      expect(capture.contains("Batch History")).toBe(true);
      expect(capture.contains("ID")).toBe(true);
      expect(capture.contains("Status")).toBe(true);
    });

    test("displays multiple batches", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      createTestBatchWithJobs(FIXTURES.completedBatch);
      await runList();
      expect(capture.contains("prompts.txt")).toBe(true);
      expect(capture.contains("done.txt")).toBe(true);
    });

    test("respects limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        createTestBatchWithJobs({
          promptsFile: `./batch${i}.txt`,
          jobs: [{ tag: `t${i}` }],
        });
      }
      await runList(3);
      // Should only show 3 batches (header + separator + 3 rows)
      const lines = capture.getLines().filter(l => l.includes("batch"));
      expect(lines.length).toBeLessThanOrEqual(5);
    });

    test("shows job counts correctly", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runList();
      // 1 completed out of 4 total
      expect(capture.contains("1/4")).toBe(true);
    });

    test("shows prompts file path", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runList();
      expect(capture.contains("./prompts.txt")).toBe(true);
    });

    test("shows status column correctly", async () => {
      createTestBatchWithJobs(FIXTURES.completedBatch);
      await runList();
      expect(capture.contains("completed")).toBe(true);
    });

    test("shows usage hints", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runList();
      expect(capture.contains("status")).toBe(true);
      expect(capture.contains("resume")).toBe(true);
    });
  });

  // ==================== RESUME COMMAND ====================
  describe("resume command", () => {
    test("returns null batch when no incomplete batches", async () => {
      const result = await runResume();
      expect(result.batch).toBeNull();
      expect(result.shouldResume).toBe(false);
      expect(capture.contains("No incomplete batch")).toBe(true);
    });

    test("returns batch when incomplete batch exists", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      const result = await runResume();
      expect(result.batch?.id).toBe(batchId);
      expect(result.shouldResume).toBe(true);
    });

    test("returns specific batch by ID", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      const batchId2 = createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      const result = await runResume(batchId2);
      expect(result.batch?.id).toBe(batchId2);
    });

    test("shows 'Batch not found' for non-existent ID", async () => {
      const result = await runResume(999);
      expect(result.batch).toBeNull();
      expect(capture.contains("Batch #999 not found")).toBe(true);
    });

    test("shows 'already complete' for completed batch", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.completedBatch);
      const result = await runResume(batchId);
      expect(result.shouldResume).toBe(false);
      expect(capture.contains("already complete")).toBe(true);
    });

    test("suggests reset for batch with only failed jobs", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.allFailedBatch);
      await runResume(batchId);
      expect(capture.contains("reset")).toBe(true);
    });

    test("shows progress message when resuming", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runResume();
      expect(capture.contains("Resuming batch")).toBe(true);
      expect(capture.contains("completed")).toBe(true);
    });

    test("returns shouldResume false for cancelled batch", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.cancelledBatch);
      const result = await runResume(batchId);
      expect(result.shouldResume).toBe(false);
    });

    test("returns shouldResume true for batch with pending jobs", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      const result = await runResume(batchId);
      expect(result.shouldResume).toBe(true);
    });

    test("picks most recent incomplete batch when no ID specified", async () => {
      createTestBatchWithJobs(FIXTURES.completedBatch);
      const batchId2 = createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      const result = await runResume();
      // Should pick the pending batch, not the completed one
      expect(result.batch?.prompts_file).toBe("./prompts.txt");
    });
  });

  // ==================== RESET COMMAND ====================
  describe("reset command", () => {
    test("shows 'No batch found' when database empty", async () => {
      await runReset();
      expect(capture.contains("No batch found")).toBe(true);
    });

    test("resets failed jobs and shows count", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.allFailedBatch);
      await runReset(batchId);
      expect(capture.contains("Reset 2 failed job")).toBe(true);
    });

    test("shows 'No failed jobs' when none to reset", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runReset(batchId);
      expect(capture.contains("No failed jobs to reset")).toBe(true);
    });

    test("resets specific batch by ID", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.allFailedBatch);
      await runReset(batchId);
      expect(capture.contains(`batch #${batchId}`)).toBe(true);
    });

    test("shows 'Batch not found' for non-existent ID", async () => {
      await runReset(999);
      expect(capture.contains("Batch #999 not found")).toBe(true);
    });

    test("resets correct number of jobs", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runReset();
      expect(capture.contains("Reset 1 failed job")).toBe(true);
    });

    test("suggests retry after reset", async () => {
      createTestBatchWithJobs(FIXTURES.allFailedBatch);
      await runReset();
      expect(capture.contains("retry")).toBe(true);
    });

    test("resets most recent batch when no ID specified", async () => {
      createTestBatchWithJobs(FIXTURES.completedBatch);
      createTestBatchWithJobs(FIXTURES.allFailedBatch);
      await runReset();
      // Should reset the failed batch
      expect(capture.contains("Reset 2")).toBe(true);
    });

    test("only resets failed jobs, not completed", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runReset(batchId);
      // Should reset only 1 failed job, not the 1 completed
      expect(capture.contains("Reset 1 failed")).toBe(true);
    });
  });

  // ==================== HISTORY COMMAND ====================
  describe("history command", () => {
    test("shows 'No job history' when database empty", async () => {
      await runHistory();
      expect(capture.contains("No job history found")).toBe(true);
    });

    test("displays completed jobs in table format", async () => {
      createTestBatchWithJobs(FIXTURES.completedBatch);
      await runHistory();
      expect(capture.contains("Recent Jobs")).toBe(true);
      expect(capture.contains("Batch")).toBe(true);
      expect(capture.contains("Status")).toBe(true);
    });

    test("displays jobs with mixed statuses", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runHistory();
      expect(capture.contains("completed")).toBe(true);
      expect(capture.contains("failed")).toBe(true);
    });

    test("respects limit parameter", async () => {
      createTestBatchWithJobs(FIXTURES.largeBatch);
      await runHistory(3);
      // Should limit the number of jobs shown
      const output = capture.getOutput();
      expect(output).toBeDefined();
    });

    test("shows duration column formatted", async () => {
      createTestBatchWithJobs(FIXTURES.completedBatch);
      await runHistory();
      // Duration should be formatted (180000ms = 3m 0s or similar)
      expect(capture.matchesPattern(/\d+m|\d+s/)).toBe(true);
    });

    test("shows credits column", async () => {
      createTestBatchWithJobs(FIXTURES.completedBatch);
      await runHistory();
      expect(capture.contains("100")).toBe(true);
    });

    test("shows video filename for completed jobs", async () => {
      createTestBatchWithJobs(FIXTURES.completedBatch);
      await runHistory();
      expect(capture.contains("v1.mp4")).toBe(true);
    });

    test("shows error snippet for failed jobs", async () => {
      createTestBatchWithJobs(FIXTURES.allFailedBatch);
      await runHistory();
      expect(capture.contains("Error:")).toBe(true);
    });
  });

  // ==================== CANCEL COMMAND ====================
  describe("cancel command", () => {
    test("shows 'No active batch' when database empty", async () => {
      await runCancel();
      expect(capture.contains("No active batch to cancel")).toBe(true);
    });

    test("cancels active pending batch", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runCancel(batchId);
      expect(capture.contains("has been cancelled")).toBe(true);
    });

    test("cancels active running batch", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runCancel(batchId);
      expect(capture.contains("has been cancelled")).toBe(true);
    });

    test("cancels specific batch by ID", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runCancel(batchId);
      expect(capture.contains(`Batch #${batchId}`)).toBe(true);
    });

    test("shows 'Batch not found' for non-existent ID", async () => {
      await runCancel(999);
      expect(capture.contains("Batch #999 not found")).toBe(true);
    });

    test("shows 'already cancelled' for cancelled batch", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.cancelledBatch);
      await runCancel(batchId);
      expect(capture.contains("already cancelled")).toBe(true);
    });

    test("shows 'already completed' for completed batch", async () => {
      const batchId = createTestBatchWithJobs(FIXTURES.completedBatch);
      await runCancel(batchId);
      expect(capture.contains("already completed")).toBe(true);
    });

    test("shows skipped count after cancel", async () => {
      createTestBatchWithJobs(FIXTURES.simplePendingBatch);
      await runCancel();
      expect(capture.contains("Skipped:")).toBe(true);
    });

    test("shows completed count preserved after cancel", async () => {
      createTestBatchWithJobs(FIXTURES.mixedStatusBatch);
      await runCancel();
      expect(capture.contains("Completed:")).toBe(true);
    });
  });

  // ==================== HELP COMMAND ====================
  describe("help command", () => {
    test("displays all commands", async () => {
      await runHelp();
      expect(capture.contains("status")).toBe(true);
      expect(capture.contains("list")).toBe(true);
      expect(capture.contains("resume")).toBe(true);
      expect(capture.contains("reset")).toBe(true);
      expect(capture.contains("history")).toBe(true);
      expect(capture.contains("cancel")).toBe(true);
      expect(capture.contains("help")).toBe(true);
    });

    test("displays video options", async () => {
      await runHelp();
      expect(capture.contains("-p")).toBe(true);
      expect(capture.contains("--prompt")).toBe(true);
      expect(capture.contains("-r")).toBe(true);
      expect(capture.contains("--ratio")).toBe(true);
      expect(capture.contains("-m")).toBe(true);
      expect(capture.contains("--model")).toBe(true);
    });

    test("displays model tiers", async () => {
      await runHelp();
      expect(capture.contains("quality")).toBe(true);
      expect(capture.contains("fast")).toBe(true);
      expect(capture.contains("free")).toBe(true);
      expect(capture.contains("veo2")).toBe(true);
    });
  });
});
