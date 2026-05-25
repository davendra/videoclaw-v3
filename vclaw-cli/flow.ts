import { join } from "path";
import { mkdir } from "fs/promises";
import type { Cookie } from "rebrowser-puppeteer-core";
import { connect, type PageWithCursor } from "puppeteer-real-browser";
import { existsSync } from "fs";
import ora from "ora";

// ============================================================================
// Parallel Processing Helper
// ============================================================================

/**
 * Process items in parallel with a concurrency limit (semaphore pattern)
 * @param items - Array of items to process
 * @param concurrency - Maximum concurrent operations (default: 1 for sequential)
 * @param processor - Async function to process each item
 * @returns Results in order of completion
 */
async function processInParallel<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<Array<{ item: T; index: number; result?: R; error?: Error }>> {
  const results: Array<{ item: T; index: number; result?: R; error?: Error }> = [];
  let activeCount = 0;
  let nextIndex = 0;

  return new Promise((resolve) => {
    const processNext = () => {
      // Start new tasks while under concurrency limit and items remain
      while (activeCount < concurrency && nextIndex < items.length) {
        const currentIndex = nextIndex++;
        const item = items[currentIndex];
        activeCount++;

        processor(item, currentIndex)
          .then((result) => {
            results.push({ item, index: currentIndex, result });
          })
          .catch((error) => {
            results.push({ item, index: currentIndex, error: error instanceof Error ? error : new Error(String(error)) });
          })
          .finally(() => {
            activeCount--;
            if (results.length === items.length) {
              resolve(results);
            } else {
              processNext();
            }
          });
      }
    };

    if (items.length === 0) {
      resolve([]);
    } else {
      processNext();
    }
  });
}

// Video model option type
type VideoModelOption = {
  label: string;
  value: string;
  icon?: string;
  disabled?: boolean;
  tag?: string;
  keys?: string[];
  supportedAspectRatios?: string[];
};

// Filter and process video models into options
function getVideoModelOptions(videoModels: any): VideoModelOption[] {
  // Handle various response shapes
  const models = Array.isArray(videoModels)
    ? videoModels
    : videoModels?.models || videoModels?.videoModels || [];

  if (!Array.isArray(models) || models.length === 0) {
    // Return a default model option if API returned invalid data
    console.log("Warning: Could not get video models from API, using defaults");
    return [{
      label: "Veo 3.1 - Fast",
      value: "Veo 3.1 - Fast",
      icon: "radio_button_checked",
      keys: ["veo_3_1_t2v_fast_ultra"],
      supportedAspectRatios: ["VIDEO_ASPECT_RATIO_LANDSCAPE", "VIDEO_ASPECT_RATIO_PORTRAIT"],
    }];
  }

  const filtered = models.filter((m) => {
    if (!m) return false;
    if (m.modelStatus === "MODEL_STATUS_DEPRECATED") return false;
    const caps = m.capabilities || [];
    return !caps.includes("VIDEO_MODEL_CAPABILITY_UPSCALING");
  });

  // Dedupe by displayName
  const seen = new Set<string>();
  const deduped = filtered.filter((m) => {
    const name = m?.displayName;
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  return deduped.map((model) => {
    const available = !model?.modelAccessInfo?.paygateAccessBlocked;
    return {
      label: model?.displayName || "Veo 3.1 - Fast",
      value: model?.displayName || "Veo 3.1 - Fast",
      icon: available ? "radio_button_checked" : undefined,
      disabled: !available,
      tag: model?.modelMetadata?.veoModelName,
      keys: model?.key ? [model.key] : [],
      supportedAspectRatios: model?.supportedAspectRatios,
    };
  });
}

// Import types from src modules
import type {
  Project,
  Workflow,
  UserProject,
  Operation,
  VideoModel,
  Config,
  VideoAspectRatio,
  Session,
  ParsedPrompt,
} from "./src/types";

// Import from src modules
import {
  DEFAULT_CONFIG,
  log,
  debug,
  warn,
  setQuietMode,
  setLogLevel,
  mapAspectRatio,
  mapModelKey,
  getModelCredits,
  getModelDisplayName,
  resolvePath,
  loadConfig,
} from "./src/config";

import { parsePromptLine, validatePrompts } from "./src/prompts";
import { download, setUserAgent } from "./src/download";
import { getRecaptchaToken, checkLoggedIn, validateSession } from "./src/auth";

import {
  TARGET_PAGE_URL,
  setApiUserAgent,
  filterCookiesByUrlDomain,
  toHeaderCookie,
  withRetry,
  searchAllUserProjects,
  createProject,
  setLastSelectedVideoModelKey,
  setLastSelectedVideoAspectRatio,
  getUserSettings,
  getVideoModelConfig,
  getUserPaygateTier,
  performHealthChecks,
} from "./src/api";

import { uploadImageViaFlow, uploadMultipleIngredientsViaFlow } from "./src/upload";

import {
  genSeed,
  setGenerationUserAgent,
  createVideoText,
  createVideoImage,
  createVideoFrames,
  createVideoIngredients,
} from "./src/generation";
import {
  parseCommand,
  runStatus,
  runList,
  runResume,
  runReset,
  runHistory,
  runCancel,
  runHelp,
  runUseApiAccounts,
  runUseApiCaptcha,
  runUseApiHealth,
  runUseApiDryRun,
  // Extended features handlers
  runUseApiImage,
  runUseApiImageUpscale,
  runUseApiGif,
  runUseApiVideoUpscale,
  runUseApiUploadVideo,
  runUseApiExtend,
  runUseApiConcat,
  type CLIOptions,
} from "./src/cli";
import {
  initDB,
  hashPrompts,
  createBatch,
  getActiveBatch,
  updateBatchStatus,
  createJobs,
  getPendingJobs,
  startJob,
  completeJob,
  failJob,
  checkAndCompleteBatch,
  getAverageJobDuration,
  getBatchStats,
  type Job,
} from "./src/db-unified";
import { WebhookManager } from "./src/webhook";

// Backend abstraction
import { createBackend, type VideoBackend, type VideoRequest } from "./src/backends";

// Global quiet mode flag (used for ora spinner)
let quietMode = false;

// User agent - set from browser and propagated to modules
let USER_AGENT = "";

function setAllUserAgents(ua: string) {
  USER_AGENT = ua;
  setUserAgent(ua);
  setApiUserAgent(ua);
  setGenerationUserAgent(ua);
}

// Alias for backwards compatibility with existing code
const checkLogined = checkLoggedIn;

/**
 * Format duration in milliseconds to human-readable string
 * e.g., 90000 -> "1m 30s", 3600000 -> "1h 0m"
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Display estimated completion time based on pending jobs and historical average
 */
async function displayETA(pendingCount: number, concurrency: number = 1): Promise<void> {
  if (quietMode || pendingCount === 0) return;

  const avgDuration = await getAverageJobDuration(90_000); // Default 90s per video
  // With parallel processing, jobs run concurrently, so divide by concurrency
  const effectivePending = Math.ceil(pendingCount / concurrency);
  const totalMs = avgDuration * effectivePending;
  const eta = formatDuration(totalMs);

  if (concurrency > 1) {
    console.log(`📊 Estimated time: ${eta} (${pendingCount} jobs ÷ ${concurrency} workers × ${formatDuration(avgDuration)}/job)`);
  } else {
    console.log(`📊 Estimated time: ${eta} (${pendingCount} jobs × ${formatDuration(avgDuration)}/job)`);
  }
}

/**
 * Progress tracker for batch jobs
 * Provides visual feedback on job completion status
 */
class ProgressTracker {
  private jobStates: Map<number, "pending" | "running" | "completed" | "failed"> = new Map();
  private startTime: number = Date.now();
  private totalJobs: number = 0;

  constructor(jobs: Array<{ prompt_index: number }>) {
    this.totalJobs = jobs.length;
    for (const job of jobs) {
      this.jobStates.set(job.prompt_index, "pending");
    }
  }

  markRunning(index: number): void {
    this.jobStates.set(index, "running");
  }

  markCompleted(index: number): void {
    this.jobStates.set(index, "completed");
  }

  markFailed(index: number): void {
    this.jobStates.set(index, "failed");
  }

  /**
   * Get progress summary string
   * Format: "✅ 3 | ❌ 1 | ⏳ 2 | 📊 50%"
   */
  getSummary(): string {
    let completed = 0;
    let failed = 0;
    let pending = 0;

    for (const state of this.jobStates.values()) {
      if (state === "completed") completed++;
      else if (state === "failed") failed++;
      else pending++;
    }

    const percent = Math.round((completed / this.totalJobs) * 100);
    const elapsed = formatDuration(Date.now() - this.startTime);

    return `✅ ${completed} | ❌ ${failed} | ⏳ ${pending} | ${percent}% | ${elapsed}`;
  }

  /**
   * Display progress bar
   * Format: "[████████░░░░░░░░] 50% (3/6)"
   * Width adapts to terminal size (min 10, max 40)
   */
  getProgressBar(): string {
    let completed = 0;
    for (const state of this.jobStates.values()) {
      if (state === "completed") completed++;
    }

    // Calculate dynamic bar width based on terminal size
    const termWidth = process.stdout.columns || 80;
    // Reserve space for brackets, percent, and count - roughly 20 chars
    const availableWidth = termWidth - 20;
    const barWidth = Math.max(10, Math.min(40, Math.floor(availableWidth / 2)));

    const percent = completed / this.totalJobs;
    const filledWidth = Math.round(percent * barWidth);
    const filled = "█".repeat(filledWidth);
    const empty = "░".repeat(barWidth - filledWidth);

    return `[${filled}${empty}] ${Math.round(percent * 100)}% (${completed}/${this.totalJobs})`;
  }

  /**
   * Display final summary
   */
  displayFinalSummary(): void {
    if (quietMode) return;

    let completed = 0;
    let failed = 0;

    for (const state of this.jobStates.values()) {
      if (state === "completed") completed++;
      else if (state === "failed") failed++;
    }

    const elapsed = formatDuration(Date.now() - this.startTime);

    console.log("\n" + "─".repeat(50));
    console.log("📊 Batch Summary");
    console.log("─".repeat(50));
    console.log(`   Total:     ${this.totalJobs}`);
    console.log(`   Completed: ${completed} ✅`);
    if (failed > 0) {
      console.log(`   Failed:    ${failed} ❌`);
    }
    console.log(`   Duration:  ${elapsed}`);
    console.log("─".repeat(50));
  }
}

// ============================================================================
// Dry Run and Main Functions
// ============================================================================

async function runDryRun(config: Config, inlinePrompt?: string, cliOptions?: CLIOptions): Promise<void> {
  console.log("\n=== DRY RUN MODE ===\n");

  const cookiePath = resolvePath(config.paths.cookies);

  // Get prompts from inline or file
  let prompts: string[];

  if (inlinePrompt) {
    console.log(`Prompt source: inline`);
    console.log(`  "${inlinePrompt.substring(0, 60)}${inlinePrompt.length > 60 ? '...' : ''}"\n`);
    prompts = [inlinePrompt];
  } else {
    const promptPath = resolvePath(config.paths.prompts);
    console.log(`Prompts file: ${config.paths.prompts}`);
    if (!existsSync(promptPath)) {
      console.log("  ERROR: Prompts file not found!");
      console.log("  Use --prompt flag to pass a prompt directly.\n");
      return;
    }
    console.log("  OK\n");

    // Read prompts from file
    const promptFile = Bun.file(promptPath);
    const promptRaw = await promptFile.text();
    prompts = promptRaw
      .trim()
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("#"));

    if (prompts.length === 0) {
      console.log("No prompts found in file.\n");
      return;
    }
  }

  // Show video settings
  console.log("Video Settings:");
  const ratio = config.video.preferredAspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE";
  const ratioDisplay = ratio === "VIDEO_ASPECT_RATIO_PORTRAIT" ? "portrait (9:16)" : "landscape (16:9)";
  console.log(`  Aspect ratio: ${ratioDisplay}`);

  const model = config.video.preferredModel || "fast";
  console.log(`  Model: ${getModelDisplayName(model)}`);

  console.log(`  Outputs per prompt: ${config.video.outputsPerPrompt}`);

  if (config.video.seed !== null) {
    console.log(`  Seed: ${config.video.seed} (locked)`);
  } else {
    console.log(`  Seed: random`);
  }

  console.log(`  Audio: ${config.video.audioEnabled ? "enabled" : "disabled"}`);
  console.log();

  console.log(`Cookies file: ${config.paths.cookies}`);
  if (!existsSync(cookiePath)) {
    console.log("  WARNING: Cookie file not found. Login will be required.\n");
  } else {
    console.log("  OK\n");
  }

  console.log(`Output dir: ${config.paths.outputDir}`);
  console.log(`Headless: ${config.browser.headless}\n`);

  console.log(`Validating ${prompts.length} prompt(s)...\n`);

  const { validations, stats } = validatePrompts(prompts);

  // Display each prompt with validation status
  for (const v of validations) {
    const tagDisplay = v.tag ? `[${v.tag}]` : "[no-tag]";
    const typeLabel = v.parsed.type.toUpperCase();
    const truncatedPrompt = v.line.length > 60 ? v.line.substring(0, 57) + "..." : v.line;

    if (v.valid) {
      // Show type-specific info
      let extraInfo = "";
      switch (v.parsed.type) {
        case "image":
          extraInfo = "(image)";
          break;
        case "frames":
          extraInfo = "(start+end frames)";
          break;
        case "ingredients":
          extraInfo = `(${(v.parsed as any).imagePaths?.length || 0} refs)`;
          break;
      }
      console.log(`  ✓ ${truncatedPrompt}`);
      console.log(`    Type: ${typeLabel} ${extraInfo}`);
    } else {
      console.log(`  ✗ ${truncatedPrompt}`);
      console.log(`    Type: ${typeLabel}`);
      for (const err of v.errors) {
        console.log(`    ERROR: ${err}`);
      }
    }
    console.log();
  }

  // Summary
  console.log("─".repeat(50));
  console.log("Summary:");
  console.log(`  Total prompts: ${stats.total}`);
  console.log(`  Valid: ${stats.valid}`);
  if (stats.invalid > 0) {
    console.log(`  Invalid: ${stats.invalid}`);
  }
  console.log();
  console.log("  By type:");
  console.log(`    Text-to-Video: ${stats.byType.text}`);
  console.log(`    Image-to-Video: ${stats.byType.image}`);
  console.log(`    Frames-to-Video: ${stats.byType.frames}`);
  console.log(`    Ingredients/Refs: ${stats.byType.ingredients}`);
  console.log();

  // Credit estimation based on selected model
  const creditsPerVideo = getModelCredits(model);

  const t2vCount = stats.byType.text;
  const i2vCount = stats.byType.image + stats.byType.frames + stats.byType.ingredients;
  const totalVideos = (t2vCount + i2vCount) * config.video.outputsPerPrompt;

  const estimatedCredits = totalVideos * creditsPerVideo;

  console.log(`Credit Estimation (${getModelDisplayName(model).split(' ')[0]} ${getModelDisplayName(model).split(' ')[1]}):`);
  if (t2vCount > 0) {
    console.log(`  T2V: ${t2vCount} prompt(s) × ${config.video.outputsPerPrompt} output(s) × ${creditsPerVideo} credits = ${t2vCount * config.video.outputsPerPrompt * creditsPerVideo}`);
  }
  if (i2vCount > 0) {
    console.log(`  I2V: ${i2vCount} prompt(s) × ${config.video.outputsPerPrompt} output(s) × ${creditsPerVideo} credits = ${i2vCount * config.video.outputsPerPrompt * creditsPerVideo}`);
  }
  console.log(`  Total: ~${estimatedCredits} credits`);
  console.log();

  if (stats.invalid > 0) {
    console.log("⚠️  Fix the errors above before running generation.\n");
  } else {
    console.log("✓ All prompts validated. Ready to generate!\n");
    console.log("Run without --dry-run to start generation.\n");
  }
}

// ============================================================================
// UseAPI Backend Generation
// ============================================================================

async function runWithUseApiBackend(
  config: Config,
  prompts: string[],
  cliOptions: CLIOptions
): Promise<void> {
  console.log("\n=== Using useapi.net Backend ===\n");

  // Initialize database
  await initDB();

  // Initialize webhook manager (if webhook URL provided)
  const webhookManager = new WebhookManager(cliOptions.webhookUrl, cliOptions.webhookSecret);
  if (webhookManager.isEnabled()) {
    console.log(`Webhook notifications enabled: ${cliOptions.webhookUrl}`);
  }

  // Create backend
  const backend = await createBackend("useapi", {
    config: {
      type: "useapi",
      useapi: {
        apiToken: process.env.USEAPI_API_TOKEN || "",
        accountEmail: process.env.USEAPI_ACCOUNT_EMAIL || "",
      },
    },
    skipConfirmation: cliOptions.yes,
    webhookUrl: cliOptions.webhookUrl,
  });

  try {
    await backend.initialize();

    // Check health
    const health = await backend.checkHealth();
    if (!health.healthy) {
      console.error(`Backend health check failed: ${health.message}`);
      return;
    }
    console.log(`Account: ${health.accountEmail}`);
    if (health.captchaCredits !== undefined) {
      console.log(`CAPTCHA credits: ${health.captchaCredits}`);
    }
    console.log();

    // Parse prompts and create batch
    const promptRaw = prompts.join("\n");
    const promptsHash = hashPrompts(promptRaw);
    let batch = await getActiveBatch("(useapi)", promptsHash);

    if (!batch) {
      const parsedPrompts = prompts.map((line, index) => {
        const parsed = parsePromptLine(line);
        // Extract tag from prompt line [tag] prefix - same as direct backend
        const tagMatch = line.match(/^\[([^\]]+)\]/);
        return {
          index: index + 1,
          text: line,
          type: parsed.type,
          tag: tagMatch ? tagMatch[1] : `scene${index + 1}`,
        };
      });
      const batchId = await createBatch("(useapi)", promptsHash, parsedPrompts.length);
      batch = { id: batchId } as any;
      await createJobs(batchId, parsedPrompts);
      console.log(`Created new batch #${batchId} with ${parsedPrompts.length} job(s)`);
    } else {
      console.log(`Resuming batch #${batch.id}...`);
    }
    if (!batch) {
      throw new Error("Failed to create or resume useapi batch");
    }
    const batchId = batch.id;
    await updateBatchStatus(batchId, "running", "useapi");

    // Get pending jobs
    let pendingJobs = await getPendingJobs(batchId);

    // Filter by --from-job if specified (1-based index)
    if (cliOptions.fromJob && cliOptions.fromJob > 0) {
      const fromIndex = cliOptions.fromJob;
      const originalCount = pendingJobs.length;
      const maxIndex = pendingJobs.length > 0
        ? Math.max(...pendingJobs.map(j => j.prompt_index))
        : 0;

      if (fromIndex > maxIndex && maxIndex > 0) {
        console.warn(`⚠️  --from-job ${fromIndex} is beyond batch size (max index: ${maxIndex}). No jobs to process.`);
      }

      pendingJobs = pendingJobs.filter(job => job.prompt_index >= fromIndex);
      if (pendingJobs.length < originalCount && pendingJobs.length > 0) {
        console.log(`Skipping jobs 1-${fromIndex - 1} (--from-job ${fromIndex})`);
      }
    }

    if (pendingJobs.length === 0) {
      console.log("No pending jobs. Batch already completed.");
      return;
    }

    const totalJobs = pendingJobs.length;
    const concurrency = cliOptions.concurrency || 1;
    console.log(`Processing ${totalJobs} pending job(s)${concurrency > 1 ? ` with ${concurrency} parallel workers` : ""}...`);
    await displayETA(totalJobs, concurrency);
    console.log("");

    // Initialize progress tracker
    const progress = new ProgressTracker(pendingJobs);

    // Ensure output directory exists
    const videoDir = resolvePath(config.paths.outputDir);
    await mkdir(videoDir, { recursive: true });

    // Job processor function
    const processJob = async (job: Job) => {
      progress.markRunning(job.prompt_index);
      const promptLine = job.prompt_text;
      const parsed = parsePromptLine(promptLine);

      // Use spinner only for sequential processing (concurrency === 1)
      const useSpinner = !quietMode && concurrency === 1;
      const spinner = useSpinner
        ? ora({
            text: "Starting video generation...",
            prefixText: `[${job.prompt_index}/${totalJobs}]`,
          })
        : null;

      const startTime = Date.now();
      let elapsedInterval: ReturnType<typeof setInterval> | null = null;

      try {
        if (spinner) {
          spinner.start();
          elapsedInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            spinner.text = `Generating video... (${elapsed}s)`;
          }, 1000);
        } else if (!quietMode && concurrency > 1) {
          // For parallel mode, just log the start
          console.log(`  [${job.prompt_index}] Starting: ${parsed.prompt.substring(0, 50)}...`);
        }

        await startJob(job.id);

        // Build video request based on prompt type
        const aspectRatio = config.video.preferredAspectRatio || "VIDEO_ASPECT_RATIO_LANDSCAPE";
        const model = config.video.preferredModel || "fast";

        // Flow v1 extensions: thread CLI flags into every request shape.
        // Validated in src/backends/useapi/client.ts:validateFlowVideoRequest.
        const flowExtras = {
          duration: cliOptions.duration as 4 | 6 | 8 | 10 | undefined,
          voice: cliOptions.voice,
          refVideo: cliOptions.refVideo,
        };

        let request: VideoRequest;
        switch (parsed.type) {
          case "image":
            if (!quietMode && concurrency === 1) console.log(`  Mode: Image-to-Video (useapi.net supports portrait!)`);
            request = {
              type: "image",
              prompt: parsed.prompt,
              aspectRatio,
              model,
              outputsPerPrompt: config.video.outputsPerPrompt,
              seed: config.video.seed ?? undefined,
              startImagePath: parsed.imagePath,
              ...flowExtras,
            };
            break;

          case "frames":
            if (!quietMode && concurrency === 1) console.log(`  Mode: Frames-to-Video`);
            request = {
              type: "frames",
              prompt: parsed.prompt,
              aspectRatio,
              model,
              outputsPerPrompt: config.video.outputsPerPrompt,
              seed: config.video.seed ?? undefined,
              startImagePath: parsed.startPath,
              endImagePath: parsed.endPath,
              ...flowExtras,
            };
            break;

          case "ingredients":
            if (!quietMode && concurrency === 1) console.log(`  Mode: Ingredients/References (${parsed.imagePaths.length} images)`);
            request = {
              type: "ingredients",
              prompt: parsed.prompt,
              aspectRatio,
              model,
              outputsPerPrompt: config.video.outputsPerPrompt,
              seed: config.video.seed ?? undefined,
              referenceImagePaths: parsed.imagePaths,
              ...flowExtras,
            };
            break;

          case "text":
          default:
            request = {
              type: "text",
              prompt: parsed.prompt,
              aspectRatio,
              model,
              outputsPerPrompt: config.video.outputsPerPrompt,
              seed: config.video.seed ?? undefined,
              ...flowExtras,
            };
        }

        // Generate video
        const result = await backend.generateVideo(request);

        if (elapsedInterval) {
          clearInterval(elapsedInterval);
          elapsedInterval = null;
        }

        if (spinner) {
          spinner.text = "Downloading videos...";
        }

        // Download videos
        const tag = job.tag || undefined;
        await download(result.operations, videoDir, config.timing.downloadTimeoutMs, tag);

        const durationMs = Date.now() - startTime;
        const totalSeconds = Math.round(durationMs / 1000);

        // Get video filename
        const videoFileName = result.operations[0]?.operation?.metadata?.video?.fifeUrl
          ? `${new Date().toISOString().slice(0, 10)}_${new Date().toTimeString().slice(0, 5).replace(":", "-")}_${tag || "video"}.mp4`
          : null;

        await completeJob(job.id, videoFileName || "", durationMs, result.estimatedCredits || 0);
        progress.markCompleted(job.prompt_index);

        // Send webhook notification for job completion
        const videoUrl = result.operations[0]?.operation?.metadata?.video?.fifeUrl;
        webhookManager.notifyJobCompleted({
          batchId,
          jobId: job.id,
          jobIndex: job.prompt_index,
          tag,
          prompt: parsed.prompt,
          videoPath: videoFileName || undefined,
          videoUrl,
          durationMs,
        });

        if (spinner) {
          spinner.succeed(`Video ready (${totalSeconds}s) - ${tag || "video"}.mp4`);
        } else if (!quietMode && concurrency > 1) {
          console.log(`  ✅ [${job.prompt_index}] Done (${totalSeconds}s) - ${tag || "video"}.mp4`);
        }

        // Show progress after each job
        if (!quietMode) {
          console.log(`   ${progress.getProgressBar()}`);
        }

        return { success: true, durationMs };
      } catch (error) {
        if (elapsedInterval) {
          clearInterval(elapsedInterval);
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        progress.markFailed(job.prompt_index);

        if (spinner) {
          spinner.fail(`Generation failed: ${errorMessage.substring(0, 60)}`);
        } else if (!quietMode && concurrency > 1) {
          console.log(`  ❌ [${job.prompt_index}] Failed: ${errorMessage.substring(0, 60)}`);
        }

        await failJob(job.id, errorMessage);

        // Send webhook notification for job failure
        webhookManager.notifyJobFailed({
          batchId,
          jobId: job.id,
          jobIndex: job.prompt_index,
          tag: job.tag || undefined,
          prompt: parsed.prompt,
          error: errorMessage,
        });

        throw error; // Re-throw for parallel processor to catch
      }
    };

    // Process jobs with concurrency limit
    if (concurrency > 1) {
      await processInParallel(pendingJobs, concurrency, processJob);
    } else {
      // Sequential processing for backwards compatibility
      for (const job of pendingJobs) {
        await processJob(job).catch(() => {}); // Errors already handled in processJob
      }
    }

    // Show final summary
    progress.displayFinalSummary();

    // Check if batch is complete
    await checkAndCompleteBatch(batchId);

    // Send batch completion webhook
    if (webhookManager.isEnabled()) {
      const stats = await getBatchStats(batchId);
      await webhookManager.notifyBatchCompleted({
        batchId,
        stats: {
          completed: stats.completed,
          failed: stats.failed,
          pending: stats.pending,
          total: stats.total,
        },
      });
    }

  } finally {
    await backend.shutdown();
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  // Parse CLI command
  const cliOptions = parseCommand(process.argv.slice(2));

  // Handle CLI subcommands
  switch (cliOptions.command) {
    case "help":
      runHelp();
      return;
    case "status":
      await runStatus(cliOptions.batchId);
      return;
    case "list":
      await runList(cliOptions.limit);
      return;
    case "reset":
      await runReset(cliOptions.batchId);
      return;
    case "history":
      await runHistory(cliOptions.limit);
      return;
    case "cancel":
      await runCancel(cliOptions.batchId);
      return;
    // useapi.net subcommands
    case "useapi:accounts":
      await runUseApiAccounts(cliOptions);
      return;
    case "useapi:captcha":
      await runUseApiCaptcha(cliOptions);
      return;
    case "useapi:health":
      await runUseApiHealth(cliOptions);
      return;
    // useapi.net extended features
    case "useapi:image":
      await runUseApiImage(cliOptions);
      return;
    case "useapi:image:upscale":
      await runUseApiImageUpscale(cliOptions);
      return;
    case "useapi:gif":
      await runUseApiGif(cliOptions);
      return;
    case "useapi:upscale":
      await runUseApiVideoUpscale(cliOptions);
      return;
    case "useapi:upload-video":
      await runUseApiUploadVideo(cliOptions);
      return;
    case "useapi:extend":
      await runUseApiExtend(cliOptions);
      return;
    case "useapi:concat":
      await runUseApiConcat(cliOptions);
      return;
  }

  // Load configuration
  const config = await loadConfig();

  // Apply logging options
  if (cliOptions.quiet) {
    setQuietMode(true);
    quietMode = true;
  }
  if (cliOptions.debug) {
    setLogLevel('debug');
  }

  // Apply CLI options to config
  if (cliOptions.headless) {
    config.browser.headless = true;
  }
  if (cliOptions.visible) {
    config.browser.headless = false;
  }
  if (cliOptions.promptsPath) {
    config.paths.prompts = cliOptions.promptsPath;
  }
  if (cliOptions.cookiesPath) {
    config.paths.cookies = cliOptions.cookiesPath;
  }
  if (cliOptions.outputPath) {
    config.paths.outputDir = cliOptions.outputPath;
  }

  // Apply video generation options
  if (cliOptions.aspectRatio) {
    config.video.preferredAspectRatio = mapAspectRatio(cliOptions.aspectRatio);
  }
  if (cliOptions.model) {
    config.video.preferredModel = cliOptions.model;
  }
  if (cliOptions.seed !== undefined) {
    config.video.seed = cliOptions.seed;
    config.video.isSeedLocked = true;
  }
  if (cliOptions.count) {
    config.video.outputsPerPrompt = Math.min(4, Math.max(1, cliOptions.count));
  }
  if (cliOptions.noAudio) {
    config.video.audioEnabled = false;
    // Force Veo 2 if audio is disabled
    if (!cliOptions.model) {
      config.video.preferredModel = "veo2";
    }
  }

  // Check for dry-run mode
  if (cliOptions.dryRun) {
    // Use useapi-specific dry-run if that backend is selected
    if (cliOptions.backend === "useapi") {
      // Get prompts for validation
      let prompts: string[];
      if (cliOptions.inlinePrompt) {
        prompts = [cliOptions.inlinePrompt];
      } else {
        const promptPath = resolvePath(config.paths.prompts);
        if (!existsSync(promptPath)) {
          console.error(`Error: Prompts file not found: ${promptPath}`);
          console.log("Use --prompt flag to pass a prompt directly, or create a prompts.txt file.");
          return;
        }
        const promptFile = Bun.file(promptPath);
        const promptRaw = await promptFile.text();
        prompts = promptRaw
          .trim()
          .split("\n")
          .map((p) => p.trim())
          .filter((p) => p && !p.startsWith("#"));
      }

      await runUseApiDryRun(prompts, {
        ...cliOptions,
        model: config.video.preferredModel || cliOptions.model,
        aspectRatio: config.video.preferredAspectRatio || cliOptions.aspectRatio,
        outputsPerPrompt: config.video.outputsPerPrompt,
      });
      return;
    }

    // Direct backend dry-run (existing)
    await runDryRun(config, cliOptions.inlinePrompt, cliOptions);
    return;
  }

  // Check for resume command
  if (cliOptions.command === "resume") {
    const { batch, shouldResume } = await runResume(cliOptions.batchId);
    if (!shouldResume) {
      return;
    }
    // Continue with generation using the resumed batch
  }

  // Initialize database
  await initDB();

  // Get prompts from inline flag or file
  let prompts: string[];
  let promptRaw: string;
  let promptSource: string;

  if (cliOptions.inlinePrompt) {
    // Use inline prompt
    promptRaw = cliOptions.inlinePrompt;
    prompts = [cliOptions.inlinePrompt];
    promptSource = "(inline)";
    console.log(`Using inline prompt: ${cliOptions.inlinePrompt.substring(0, 60)}...`);
  } else {
    // Load from file
    const promptPath = resolvePath(config.paths.prompts);
    const promptFile = Bun.file(promptPath);

    if (!await promptFile.exists()) {
      console.error(`Error: Prompts file not found: ${promptPath}`);
      console.log("Use --prompt flag to pass a prompt directly, or create a prompts.txt file.");
      return;
    }

    promptRaw = await promptFile.text();
    prompts = promptRaw
      .trim()
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("#"));
    promptSource = config.paths.prompts;
  }

  // Check if useapi backend is requested - skip browser and use REST API
  if (cliOptions.backend === "useapi") {
    await runWithUseApiBackend(config, prompts, cliOptions);
    return;
  }

  // Direct backend - warn about concurrency limitation
  if (cliOptions.concurrency && cliOptions.concurrency > 1) {
    console.warn(`⚠️  --concurrency flag is only supported with useapi backend. Using sequential processing.`);
    console.warn(`   Use --backend useapi for parallel video generation.\n`);
  }

  // Direct backend - launch browser
  const { page, browser } = await connect({
    headless: config.browser.headless,
    connectOption: {
      defaultViewport: null,
    },
  });

  const cookiePath = join(process.cwd(), config.paths.cookies);
  const cookieFile = Bun.file(cookiePath);

  const cookieFileExists = await cookieFile.exists();
  if (!cookieFileExists) throw new Error(`Cookie file not found: ${config.paths.cookies}`);

  let jsonCookie = await cookieFile.json();
  if (typeof jsonCookie === "object" && "cookies" in jsonCookie) {
    jsonCookie = jsonCookie.cookies;
  }

  await browser.setCookie(...jsonCookie);

  await page.goto(TARGET_PAGE_URL.href, { waitUntil: "load" });

  // Step 1: Check if page shows logged in (UI check)
  const pageShowsLoggedIn = await checkLogined(page);

  // Step 2: If page shows logged in, validate cookies actually work with API
  let cookiesValid = false;
  if (pageShowsLoggedIn) {
    const browserCookies = await browser.cookies();
    const testCookies = filterCookiesByUrlDomain(browserCookies, TARGET_PAGE_URL);
    log("Validating session...");
    cookiesValid = await validateSession(testCookies);
    if (!cookiesValid) {
      log("Session expired - cookies invalid for API access");
    }
  }

  // Step 3: Only force login if UI shows not logged in OR cookies are invalid
  if (!pageShowsLoggedIn || !cookiesValid) {
    console.log(`Please log in within ${config.timing.loginWaitMs / 1000} seconds`);
    await Bun.sleep(config.timing.loginWaitMs);
    const cookies = await browser.cookies();
    const pageCookies = filterCookiesByUrlDomain(cookies, TARGET_PAGE_URL);
    await cookieFile.write(JSON.stringify(pageCookies));
    console.log("Restart to continue");
    await page.close();
    await browser.close();
    return;
  }

  // Get browser user agent and propagate to all modules
  const browserUA = await page.evaluate(() => navigator.userAgent);
  setAllUserAgents(browserUA);

  const browserCookies = await browser.cookies();
  const pageCookies = filterCookiesByUrlDomain(browserCookies, TARGET_PAGE_URL);

  await cookieFile.write(JSON.stringify(pageCookies));

  // Perform health checks
  debug("Running health checks...");
  const health = await performHealthChecks(pageCookies);

  // Display warnings (non-fatal)
  for (const warning of health.warnings) {
    warn(warning);
  }

  // Display cookie expiration warning prominently
  if (health.cookieExpiringSoon) {
    console.log("\n⚠️  Warning: Your cookies will expire within 24 hours.");
    console.log("   Run with --visible to refresh your session.\n");
  }

  let projects = await searchAllUserProjects(pageCookies);

  // Look for an existing PINHOLE project first (required for some batch endpoints)
  let project = projects.find(p => p.projectInfo.toolName === "PINHOLE");

  if (!project) {
    log("    No PINHOLE project found, creating fresh one...");
    const { project: newProject } = await createProject(
      pageCookies,
      `[Veo CLI] ${new Date().toLocaleDateString()}`,
      "PINHOLE"
    );
    project = newProject;
  }

  console.log(
    `Using project: [${project.projectInfo.projectTitle}] ${project.projectId}\n`
  );

  // Create or resume batch
  const promptsHash = hashPrompts(promptRaw);
  let batch = await getActiveBatch(promptSource, promptsHash);

  if (batch) {
    console.log(`Resuming batch #${batch.id}...`);
    await updateBatchStatus(batch.id, "running", project.projectId);
  } else {
    // Parse prompts for job creation
    const parsedPrompts = prompts.map((line, index) => {
      const parsed = parsePromptLine(line);
      const tagMatch = line.match(/^\[([^\]]+)\]/);
      return {
        index: index + 1,
        text: line,
        type: parsed.type,
        tag: tagMatch ? tagMatch[1] : null,
      };
    });

    const batchId = await createBatch(promptSource, promptsHash, parsedPrompts.length);
    await createJobs(batchId, parsedPrompts);
    await updateBatchStatus(batchId, "running", project.projectId);
    batch = { id: batchId } as any;
    console.log(`Created new batch #${batchId} with ${parsedPrompts.length} job(s)`);
  }
  if (!batch) {
    throw new Error("Failed to create or resume batch");
  }
  const batchId = batch.id;

  const startProjectUrl = `${TARGET_PAGE_URL.href}/project/${project.projectId}`;
  await page.goto(startProjectUrl, { waitUntil: "load" });

  // const configXPath =
  //   '//*[@id="__next"]/div[2]/div/div/div[2]/div/div[1]/div[2]/div/div/div[1]/div[2]/button[2]';

  // const configButton = await page.waitForSelector(`xpath=${configXPath}`, {
  //   timeout: 5_000,
  // });

  // await page.click(`xpath=${configXPath}`, { delay: 20 });

  const videoDir = join(process.cwd(), config.paths.outputDir);

  // Get access_token
  const session: Session = await page.$eval(
    "#__NEXT_DATA__",
    (el) => JSON.parse(el.textContent).props.pageProps.session
  );

  const paygateTier = await getUserPaygateTier(session);
  const lastSettings = await getUserSettings(pageCookies, project);
  const videoModels = await getVideoModelConfig(pageCookies, project);

  const modelOptions = getVideoModelOptions(videoModels);

  // Select video model with priority: last used > Veo 3.x Fast > any available
  const videoModel =
    (lastSettings.lastSelectedVideoModelKey &&
      modelOptions.find((o) => o.keys?.includes(lastSettings.lastSelectedVideoModelKey!))) ||
    modelOptions.find((o) => o.keys?.includes("veo_3_1_t2v_fast_ultra")) ||
    modelOptions.find((o) => o.keys?.some(k => k.includes("_fast_"))) ||
    modelOptions.find((o) => o.icon === "radio_button_checked");

  if (!videoModel) {
    throw new Error("No compatible video model found for this account");
  }

  // Determine model key: prefer CLI option, otherwise use detected model
  let videoModelKey = videoModel.keys?.[0];
  const defaultAspectRatio = videoModel.supportedAspectRatios?.[0] as
    | VideoAspectRatio
    | undefined;

  // Use preferred aspect ratio from CLI, or default from model
  const aspectRatio = config.video.preferredAspectRatio ?? defaultAspectRatio;

  if (!videoModelKey || !aspectRatio) {
    throw new Error("Video model not available for this account");
  }

  // Override video model key if user specified a model preference
  if (config.video.preferredModel) {
    videoModelKey = mapModelKey(config.video.preferredModel, "text", aspectRatio);
    console.log(`Using model: ${getModelDisplayName(config.video.preferredModel)} (${videoModelKey})`);
  }

  await setLastSelectedVideoModelKey(pageCookies, project, videoModelKey);
  await setLastSelectedVideoAspectRatio(pageCookies, project, aspectRatio);

  // Get pending jobs from database
  let pendingJobs = await getPendingJobs(batchId);
  const totalJobs = prompts.length;

  // Filter by --from-job if specified (1-based index)
  if (cliOptions?.fromJob && cliOptions.fromJob > 0) {
    const fromIndex = cliOptions.fromJob;
    const originalCount = pendingJobs.length;
    const maxIndex = pendingJobs.length > 0
      ? Math.max(...pendingJobs.map(j => j.prompt_index))
      : 0;

    if (fromIndex > maxIndex && maxIndex > 0) {
      console.warn(`⚠️  --from-job ${fromIndex} is beyond batch size (max index: ${maxIndex}). No jobs to process.`);
    }

    pendingJobs = pendingJobs.filter(job => job.prompt_index >= fromIndex);
    if (pendingJobs.length < originalCount && pendingJobs.length > 0) {
      console.log(`Skipping jobs 1-${fromIndex - 1} (--from-job ${fromIndex})`);
    }
  }

  if (pendingJobs.length === 0) {
    console.log("All jobs in this batch are already complete!");
    await checkAndCompleteBatch(batchId);
    await page.close();
    await browser.close();
    return;
  }

  console.log(`Processing ${pendingJobs.length} pending job(s)...`);
  await displayETA(pendingJobs.length);
  console.log("");

  // Initialize webhook manager for direct backend
  const webhookManager = new WebhookManager(cliOptions?.webhookUrl);
  if (webhookManager.isEnabled()) {
    console.log(`Webhook notifications enabled: ${cliOptions?.webhookUrl}`);
  }

  // Initialize progress tracker
  const progress = new ProgressTracker(pendingJobs);

  for (const job of pendingJobs) {
    progress.markRunning(job.prompt_index);
    const promptLine = job.prompt_text;

    // Mark job as running
    await startJob(job.id);

    // Create spinner for progress (disabled in quiet mode)
    const spinner = quietMode
      ? null
      : ora({
        text: "Starting video generation...",
        prefixText: `[${job.prompt_index}/${totalJobs}]`,
      });

    // Track elapsed time
    let elapsedInterval: ReturnType<typeof setInterval> | null = null;
    const startTime = Date.now();

    try {
      const start = performance.now();
      const parsed = parsePromptLine(promptLine);

      if (spinner) {
        spinner.start();
        // Update spinner with elapsed time every second
        elapsedInterval = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          spinner.text = `Generating video... (${elapsed}s)`;
        }, 1000);
      } else {
        console.log(`[${job.prompt_index}/${totalJobs}] Generating video: ${promptLine}`);
      }

      const baseOptions = {
        project,
        aspectRatio: config.video.preferredAspectRatio ?? aspectRatio,
        videoModelKey,
        isSeedLocked: config.video.isSeedLocked,
        outputsPerPrompt: config.video.outputsPerPrompt,
        requestTimeoutMs: config.timing.requestTimeoutMs,
        userPaygateTier: paygateTier.userPaygateTier,
      };
      log(`Using model key for generation: ${videoModelKey}`);

      let result: Operation[];

      // Helper to check if a string is a mediaGenerationId (not a file path)
      const isMediaId = (s: string) => !s.includes("/") && !s.includes("\\") && !s.startsWith(".");

      // Helper to get I2V/R2V model key based on config
      const getI2VModelKey = (mode: "image" | "frames" | "ingredients") => {
        // Ingredients mode uses R2V models (veo_3_1_r2v_*), different from I2V (veo_3_1_i2v_*)
        if (mode === "ingredients") {
          // R2V models are aspect-ratio-specific: veo_3_1_r2v_fast_landscape_ultra / veo_3_1_r2v_fast_portrait_ultra
          const modelPref = config.video.preferredModel || "fast";
          return mapModelKey(modelPref, mode, baseOptions.aspectRatio);
        }

        let baseKey = config.video.preferredModel
          ? mapModelKey(config.video.preferredModel, mode, baseOptions.aspectRatio)
          : "veo_3_1_i2v_s"; // Base I2V model - _s suffix is required

        // Frames mode (First-Last) uses a specific model variant
        if (mode === "frames") {
          // If already has _fl, don't double it
          if (baseKey.endsWith("_fl")) return baseKey;
          // If ends in _ultra, append _fl
          if (baseKey.endsWith("_ultra")) return baseKey + "_fl";
          // Otherwise append _fl anyway if it's frames mode
          return baseKey + "_fl";
        }
        return baseKey;
      };

      // Helper to get crop aspect from aspect ratio
      const cropAspect = baseOptions.aspectRatio === "VIDEO_ASPECT_RATIO_PORTRAIT" ? "portrait" : "landscape";

      // Helper to resolve image path to mediaId (uploads if needed)
      // uploadMode: "frames" for I2V/Frames mode, "ingredients" for R2V/Ingredients mode
      const resolveMediaId = async (imagePath: string, label?: string, uploadMode: "frames" | "ingredients" = "frames"): Promise<string> => {
        if (isMediaId(imagePath)) return imagePath;
        // Only join with cwd if path is not already absolute
        const fullPath = imagePath.startsWith('/') ? imagePath : join(process.cwd(), imagePath);
        if (label) log(`    Uploading ${label}: ${imagePath}`);
        return uploadImageViaFlow(page, fullPath, pageCookies, cropAspect, baseOptions.project, uploadMode);
      };

      // Use retry wrapper for video generation with fresh reCAPTCHA token on each attempt
      result = await withRetry(
        async () => {
          const recaptchaToken = await getRecaptchaToken(page);
          const opts = { ...baseOptions, recaptchaToken };

          switch (parsed.type) {
            case "image": {
              console.log(`  Mode: Image-to-Video (Start Frame: ${parsed.imagePath.substring(0, 30)}...)`);
              const i2vModelKey = getI2VModelKey("image");
              console.log(`  Using I2V model: ${i2vModelKey}`);
              // I2V portrait API returns INVALID_ARGUMENT - verified Jan 19, 2026. Force landscape until API supports it.
              if (opts.aspectRatio === "VIDEO_ASPECT_RATIO_PORTRAIT") {
                console.log(`  Note: I2V API only supports landscape. Using landscape aspect ratio.`);
              }
              const i2vOpts = { ...opts, videoModelKey: i2vModelKey, aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE" as const, mediaIngestionDelayMs: 5000 };
              const mediaId = await resolveMediaId(parsed.imagePath);
              return createVideoImage(session, parsed.prompt, { ...i2vOpts, startImageId: mediaId });
            }

            case "frames": {
              console.log(`  Mode: Frames-to-Video (${parsed.startPath.substring(0, 20)}... -> ${parsed.endPath.substring(0, 20)}...)`);
              const framesModelKey = getI2VModelKey("frames");
              console.log(`  Using I2V model: ${framesModelKey}`);
              // I2V/Frames portrait API returns INVALID_ARGUMENT - verified Jan 19, 2026. Force landscape until API supports it.
              if (opts.aspectRatio === "VIDEO_ASPECT_RATIO_PORTRAIT") {
                console.log(`  Note: I2V API only supports landscape. Using landscape aspect ratio.`);
              }
              const framesOpts = { ...opts, videoModelKey: framesModelKey, aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE" as const, mediaIngestionDelayMs: 5000 };
              const startMediaId = await resolveMediaId(parsed.startPath, "start frame");
              const endMediaId = await resolveMediaId(parsed.endPath, "end frame");
              return createVideoFrames(session, parsed.prompt, {
                ...framesOpts,
                startImageId: startMediaId,
                endImageId: endMediaId,
              });
            }

            case "ingredients": {
              console.log(`  Mode: Ingredients/References (${parsed.imagePaths.length} images)`);
              const ingredientsModelKey = getI2VModelKey("ingredients");
              console.log(`  Using R2V model: ${ingredientsModelKey}`);
              // R2V now supports both landscape and portrait (Veo 3.1 Jan 2026 update)
              const ingredientsOpts = { ...opts, videoModelKey: ingredientsModelKey, mediaIngestionDelayMs: 5000 };

              // Upload each image individually and collect mediaIds
              // Upload images using Ingredients to Video mode
              const mediaIds: string[] = [];
              for (let i = 0; i < parsed.imagePaths.length; i++) {
                const imgPath = parsed.imagePaths[i];
                const id = await resolveMediaId(imgPath, `ingredient ${i + 1}/${parsed.imagePaths.length}`, "ingredients");
                mediaIds.push(id);
              }

              return createVideoIngredients(session, parsed.prompt, {
                ...ingredientsOpts,
                referenceImageIds: mediaIds,
              });
            }

            case "text":
            default:
              return createVideoText(session, parsed.prompt, opts);
          }
        },
        { maxRetries: 3, delayMs: 5000 }
      );

      // Stop the elapsed time interval
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }

      if (spinner) {
        spinner.text = "Downloading videos...";
      } else {
        console.log(`[${job.prompt_index}/${totalJobs}] Downloading videos`);
      }

      // Extract tag from prompt line for filename (e.g., [sunset] -> "sunset")
      const tag = job.tag || undefined;
      await download(result, videoDir, config.timing.downloadTimeoutMs, tag);

      const end = performance.now();
      const durationMs = Math.round(end - start);
      const totalSeconds = Math.round(durationMs / 1000);

      // Get video path from the result
      const videoFileName = result[0]?.operation?.metadata?.video?.fifeUrl
        ? `${new Date().toISOString().slice(0, 10)}_${new Date().toTimeString().slice(0, 5).replace(":", "-")}_${tag || "video"}.mp4`
        : null;

      // Mark job as completed
      await completeJob(job.id, videoFileName || "", durationMs, 10);
      progress.markCompleted(job.prompt_index);

      // Send webhook notification for job completion
      const videoUrl = result[0]?.operation?.metadata?.video?.fifeUrl;
      webhookManager.notifyJobCompleted({
        batchId,
        jobId: job.id,
        jobIndex: job.prompt_index,
        tag,
        prompt: parsed.prompt,
        videoPath: videoFileName || undefined,
        videoUrl,
        durationMs,
      });

      if (spinner) {
        spinner.succeed(`Video ready (${totalSeconds}s) - ${tag || "video"}.mp4`);
      } else {
        console.log(`[${job.prompt_index}/${totalJobs}] Completed in: ${totalSeconds} seconds\n`);
      }

      // Show progress after each job
      if (!quietMode) {
        console.log(`   ${progress.getProgressBar()}`);
      }
    } catch (error) {
      // Stop the elapsed time interval
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      progress.markFailed(job.prompt_index);

      if (spinner) {
        spinner.fail(`Generation failed: ${errorMessage.substring(0, 60)}`);
      } else {
        console.log(`[${job.prompt_index}/${totalJobs}] Video generation failed: ${errorMessage}\n`);
      }

      // Mark job as failed
      await failJob(job.id, errorMessage);

      // Send webhook notification for job failure
      webhookManager.notifyJobFailed({
        batchId,
        jobId: job.id,
        jobIndex: job.prompt_index,
        tag: job.tag || undefined,
        prompt: job.prompt_text || "",
        error: errorMessage,
      });
    } finally {
      // Ensure interval is cleared
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
      }
      await Bun.sleep(config.timing.interPromptDelayMs);
    }
  }

  // Show final summary
  progress.displayFinalSummary();

  // Check if batch is complete
  await checkAndCompleteBatch(batchId);

  // Send batch completion webhook
  if (webhookManager.isEnabled()) {
    const stats = await getBatchStats(batchId);
    await webhookManager.notifyBatchCompleted({
      batchId,
      stats: {
        completed: stats.completed,
        failed: stats.failed,
        pending: stats.pending,
        total: stats.total,
      },
    });
  }

  await Bun.sleep(5_000);

  await page.close();

  await browser.close();
}

main().then().catch(console.error);
