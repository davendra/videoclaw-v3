/**
 * CLI Command Parser and Handlers for veo-cli
 * Provides subcommands: status, list, resume, reset, history, cancel
 */

import {
  initDB,
  getBatch,
  getBatchJobs,
  getBatchStats,
  listBatches,
  getJobHistory,
  resetFailedJobs,
  cancelBatch,
  getMostRecentIncompleteBatch,
  getUseApiStats,
  type Batch,
  type Job,
  type BatchStats,
} from "./db-unified";

// CLI command types
export type Command =
  | "generate"
  | "status"
  | "list"
  | "resume"
  | "reset"
  | "history"
  | "cancel"
  | "help"
  // useapi.net subcommands
  | "useapi:accounts"
  | "useapi:captcha"
  | "useapi:health"
  // useapi.net extended features
  | "useapi:image"
  | "useapi:image:upscale"
  | "useapi:gif"
  | "useapi:upscale"
  | "useapi:upload-video"
  | "useapi:extend"
  | "useapi:concat";

// Backend types
export type BackendType = "direct" | "useapi";

export interface CLIOptions {
  command: Command;
  batchId?: number;
  limit?: number;
  headless?: boolean;
  visible?: boolean;    // Show browser window (override headless default)
  dryRun?: boolean;
  quiet?: boolean;      // Suppress non-essential output
  debug?: boolean;      // Enable debug-level logging
  configPath?: string;
  promptsPath?: string;
  cookiesPath?: string;
  outputPath?: string;
  inlinePrompt?: string;  // Single prompt passed via --prompt flag
  // Video generation options
  aspectRatio?: string;   // landscape, portrait, 16:9, 9:16
  model?: string;         // quality, fast, free, veo2
  seed?: number;          // 0-32767 for reproducibility
  count?: number;         // 1-4 outputs per prompt
  noAudio?: boolean;      // Disable audio (use Veo 2)
  tag?: string;           // Override tag for inline prompt
  // Backend options
  backend?: BackendType;  // direct (default) or useapi
  yes?: boolean;          // Skip confirmation prompts
  webhookUrl?: string;    // Webhook URL for job completion notifications
  webhookSecret?: string; // HMAC secret for signing webhook payloads
  // Resume options
  fromJob?: number;       // Skip jobs before this index (1-based)
  // Parallel processing options
  concurrency?: number;   // Number of parallel video generations (1-5, default: 1)
  // useapi:accounts subcommand options
  useapiSubcommand?: "list" | "add" | "export-help";  // For useapi:accounts
  // useapi:captcha subcommand options
  captchaProvider?: string;  // ezcaptcha, 2captcha, capsolver
  captchaKey?: string;       // API key for CAPTCHA provider
  // useapi.net extended features options
  imagePrompt?: string;       // Image generation prompt (for useapi:image)
  imageCount?: number;        // Number of images to generate (1-4)
  imageModel?: string;        // imagen-4, nano-banana, nano-banana-pro
  mediaId?: string;           // Media ID for upscale/gif operations
  resolution?: string;        // 2k, 4k for image upscale; 1080p, 4k for video upscale
  outputFile?: string;        // Output file path (for GIF)
  referenceImages?: string[]; // Reference image URLs/IDs for image generation
  file?: string;              // Local file path (for useapi:upload-video)
  // Flow v1 / Omni Flash flags (Task 10)
  duration?: number;          // Output duration in seconds: 4 | 6 | 8 | 10
  voice?: string;             // Voice narration preset (stored as referenceAudio_1)
  refVideo?: string;          // Reference video media ID (stored as referenceVideo_1)
  // useapi:concat flag
  mediaIds?: string;          // Comma-separated media IDs for useapi:concat
}

/**
 * Parse CLI arguments and determine command
 */
export function parseCommand(args: string[]): CLIOptions {
  const options: CLIOptions = {
    command: "generate",
    limit: 20,
  };

  // Check for subcommand as first argument
  const firstArg = args[0];
  if (firstArg && !firstArg.startsWith("-")) {
    switch (firstArg) {
      case "status":
        options.command = "status";
        // Check for batch ID
        if (args[1] && !args[1].startsWith("-")) {
          options.batchId = parseInt(args[1], 10);
        }
        break;
      case "list":
        options.command = "list";
        break;
      case "resume":
        options.command = "resume";
        if (args[1] && !args[1].startsWith("-")) {
          options.batchId = parseInt(args[1], 10);
        }
        break;
      case "reset":
        options.command = "reset";
        if (args[1] && !args[1].startsWith("-")) {
          options.batchId = parseInt(args[1], 10);
        }
        break;
      case "history":
        options.command = "history";
        break;
      case "cancel":
        options.command = "cancel";
        if (args[1] && !args[1].startsWith("-")) {
          options.batchId = parseInt(args[1], 10);
        }
        break;
      case "help":
        options.command = "help";
        break;
      // useapi.net subcommands
      case "useapi:accounts":
        options.command = "useapi:accounts";
        // Check for subcommand: list, add, or export-help
        if (args[1] && !args[1].startsWith("-")) {
          if (args[1] === "list" || args[1] === "add" || args[1] === "export-help") {
            options.useapiSubcommand = args[1];
          }
        } else {
          options.useapiSubcommand = "list"; // Default to list
        }
        break;
      case "useapi:captcha":
        options.command = "useapi:captcha";
        // Check for 'list' subcommand
        if (args[1] && !args[1].startsWith("-")) {
          if (args[1] === "list") {
            options.useapiSubcommand = "list";
          }
        }
        break;
      case "useapi:health":
        options.command = "useapi:health";
        break;
      // useapi.net extended features
      case "useapi:image":
        options.command = "useapi:image";
        break;
      case "useapi:image:upscale":
        options.command = "useapi:image:upscale";
        break;
      case "useapi:gif":
        options.command = "useapi:gif";
        break;
      case "useapi:upscale":
        options.command = "useapi:upscale";
        break;
      case "useapi:upload-video":
        options.command = "useapi:upload-video";
        break;
      case "useapi:extend":
        options.command = "useapi:extend";
        break;
      case "useapi:concat":
        options.command = "useapi:concat";
        break;
      default:
        // Not a subcommand, treat as generate
        options.command = "generate";
    }
  }

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--headless":
        options.headless = true;
        break;
      case "--visible":
        options.visible = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--quiet":
      case "-q":
        options.quiet = true;
        break;
      case "--debug":
        options.debug = true;
        break;
      case "--config":
        options.configPath = args[++i] ?? "";
        break;
      case "--prompts":
        options.promptsPath = args[++i] ?? "";
        break;
      case "--cookies":
        options.cookiesPath = args[++i] ?? "";
        break;
      case "--output":
        options.outputPath = args[++i] ?? "";
        break;
      case "--limit":
        options.limit = parseInt(args[++i] ?? "", 10) || 20;
        break;
      case "--prompt":
      case "-p":
        options.inlinePrompt = args[++i] ?? "";
        break;
      case "--ratio":
      case "-r":
        options.aspectRatio = args[++i] ?? "";
        break;
      case "--model":
      case "-m":
        options.model = args[++i] ?? "";
        break;
      case "--seed":
      case "-s":
        options.seed = parseInt(args[++i] ?? "", 10);
        break;
      case "--count":
      case "-n":
        options.count = parseInt(args[++i] ?? "", 10);
        break;
      case "--no-audio":
        options.noAudio = true;
        break;
      case "--tag":
      case "-t":
        options.tag = args[++i] ?? "";
        break;
      // Backend options
      case "--backend":
        const backendValue = args[++i];
        if (backendValue === "direct" || backendValue === "useapi") {
          options.backend = backendValue;
        } else {
          console.error(`Invalid backend: ${backendValue}. Use 'direct' or 'useapi'.`);
        }
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--webhook":
        options.webhookUrl = args[++i] ?? "";
        break;
      case "--webhook-secret":
        options.webhookSecret = args[++i] ?? "";
        break;
      // Resume options
      case "--from-job":
        options.fromJob = parseInt(args[++i] ?? "", 10);
        break;
      // Parallel processing options
      case "--concurrency":
      case "-c":
        options.concurrency = parseInt(args[++i] ?? "", 10);
        if (isNaN(options.concurrency) || options.concurrency < 1) options.concurrency = 1;
        if (options.concurrency > 10) options.concurrency = 10; // Hard cap to avoid rate limits
        break;
      // useapi:captcha options
      case "--provider":
        options.captchaProvider = args[++i] ?? "";
        break;
      case "--key":
        options.captchaKey = args[++i] ?? "";
        break;
      // useapi.net extended features options
      case "--image-prompt":
        options.imagePrompt = args[++i] ?? "";
        break;
      case "--image-count":
        options.imageCount = parseInt(args[++i] ?? "", 10);
        break;
      case "--image-model":
        options.imageModel = args[++i] ?? "";
        break;
      case "--media-id":
        options.mediaId = args[++i] ?? "";
        break;
      case "--resolution":
        options.resolution = args[++i] ?? "";
        break;
      case "--output-file":
        options.outputFile = args[++i] ?? "";
        break;
      case "--reference":
      case "--ref":
        // Collect reference images (can be used multiple times)
        if (!options.referenceImages) {
          options.referenceImages = [];
        }
        options.referenceImages.push(args[++i] ?? "");
        break;
      case "--file":
        options.file = args[++i] ?? "";
        break;
      // Flow v1 / Omni Flash flags (Task 10)
      case "--duration": {
        const d = parseInt(args[++i] ?? "", 10);
        if ([4, 6, 8, 10].includes(d)) {
          options.duration = d as 4 | 6 | 8 | 10;
        } else {
          console.error(`Invalid --duration ${d}; valid values are 4, 6, 8, 10.`);
        }
        break;
      }
      case "--voice":
        options.voice = args[++i] ?? "";
        break;
      case "--ref-video":
        options.refVideo = args[++i] ?? "";
        break;
      case "--media-ids":
        options.mediaIds = args[++i] ?? "";
        break;
    }
  }

  // Environment variable fallbacks
  if (!options.webhookUrl && process.env.WEBHOOK_URL) {
    options.webhookUrl = process.env.WEBHOOK_URL;
  }
  if (!options.webhookSecret && process.env.WEBHOOK_SECRET) {
    options.webhookSecret = process.env.WEBHOOK_SECRET;
  }

  return options;
}

/**
 * Format duration in milliseconds to human readable string
 */
function formatDuration(ms: number | null): string {
  if (!ms) return "--";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format date string to readable format
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Create progress bar
 */
function progressBar(completed: number, total: number, width: number = 20): string {
  const percent = total > 0 ? completed / total : 0;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/**
 * Status icon for job status
 */
function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "\u2713"; // checkmark
    case "failed":
      return "\u2717"; // X
    case "running":
      return "\u25B6"; // play
    case "pending":
      return "\u23F3"; // hourglass
    case "skipped":
      return "\u23ED"; // skip
    default:
      return "?";
  }
}

/**
 * Run status command - show current batch status
 */
export async function runStatus(batchId?: number): Promise<void> {
  await initDB();

  let batch: Batch | null;

  if (batchId) {
    batch = await getBatch(batchId);
    if (!batch) {
      console.log(`Batch #${batchId} not found.`);
      return;
    }
  } else {
    batch = await getMostRecentIncompleteBatch();
    if (!batch) {
      console.log("No active batch found.");
      console.log("\nRun `bun run flow.ts` to start a new batch.");
      return;
    }
  }

  const stats = await getBatchStats(batch.id);
  const jobs = await getBatchJobs(batch.id);

  console.log("\n=== Batch Status ===");
  console.log(`Batch ID: ${batch.id}`);
  console.log(`Prompts: ${batch.prompts_file} (${stats.total} jobs)`);
  if (batch.project_id) {
    console.log(`Project: ${batch.project_id}`);
  }
  console.log(`Status: ${batch.status}`);
  console.log(`Created: ${formatDate(batch.created_at)}`);
  console.log();

  const percent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  console.log(`Progress: ${progressBar(stats.completed, stats.total)} ${stats.completed}/${stats.total} (${percent}%)`);
  console.log();

  // Show job list
  for (const job of jobs) {
    const icon = statusIcon(job.status);
    const tagDisplay = job.tag ? `[${job.tag}]` : `#${job.prompt_index}`;
    const statusDisplay = job.status.padEnd(10);

    let details = "";
    if (job.status === "completed" && job.video_path) {
      details = job.video_path.split("/").pop() || "";
    } else if (job.status === "failed" && job.error_message) {
      details = `Error: ${job.error_message.substring(0, 40)}...`;
    }

    console.log(`  ${icon} ${tagDisplay.padEnd(15)} ${statusDisplay} ${details}`);
  }

  console.log();

  if (stats.pending > 0 || stats.running > 0) {
    console.log(`Run \`bun run flow.ts\` to continue generation.`);
  } else if (stats.failed > 0) {
    console.log(`${stats.failed} job(s) failed. Run \`bun run flow.ts reset\` to retry.`);
  } else {
    console.log(`Batch completed!`);
  }
  console.log();
}

/**
 * Run list command - show all batches
 */
export async function runList(limit: number = 20): Promise<void> {
  await initDB();

  const batches = await listBatches(limit);

  if (batches.length === 0) {
    console.log("\nNo batches found.");
    console.log("Run `bun run flow.ts` to start a new batch.\n");
    return;
  }

  console.log("\n=== Batch History ===\n");
  console.log("ID".padEnd(6) + "Status".padEnd(12) + "Jobs".padEnd(10) + "Created".padEnd(18) + "Prompts");
  console.log("-".repeat(70));

  for (const batch of batches) {
    const id = String(batch.id).padEnd(6);
    const status = batch.status.padEnd(12);
    const jobs = `${batch.completed_jobs}/${batch.total_jobs}`.padEnd(10);
    const created = formatDate(batch.created_at).padEnd(18);
    const prompts = batch.prompts_file;

    console.log(`${id}${status}${jobs}${created}${prompts}`);
  }

  console.log();
  console.log("Use `bun run flow.ts status <id>` to view batch details.");
  console.log("Use `bun run flow.ts resume <id>` to resume a batch.\n");
}

/**
 * Run resume command - resume a specific batch
 */
export async function runResume(batchId?: number): Promise<{ batch: Batch | null; shouldResume: boolean }> {
  await initDB();

  let batch: Batch | null;

  if (batchId) {
    batch = await getBatch(batchId);
    if (!batch) {
      console.log(`Batch #${batchId} not found.`);
      return { batch: null, shouldResume: false };
    }
  } else {
    batch = await getMostRecentIncompleteBatch();
    if (!batch) {
      console.log("No incomplete batch to resume. Starting fresh...");
      return { batch: null, shouldResume: false };
    }
  }

  const stats = await getBatchStats(batch.id);

  if (stats.pending === 0 && stats.running === 0) {
    console.log(`Batch #${batch.id} is already complete.`);
    if (stats.failed > 0) {
      console.log(`Run \`bun run flow.ts reset ${batch.id}\` to retry failed jobs.`);
    }
    return { batch, shouldResume: false };
  }

  console.log(`Resuming batch #${batch.id} (${stats.completed}/${stats.total} completed)...`);
  return { batch, shouldResume: true };
}

/**
 * Run reset command - reset failed jobs to pending
 */
export async function runReset(batchId?: number): Promise<void> {
  await initDB();

  let batch: Batch | null;

  if (batchId) {
    batch = await getBatch(batchId);
    if (!batch) {
      console.log(`Batch #${batchId} not found.`);
      return;
    }
  } else {
    batch = await getMostRecentIncompleteBatch();
    if (!batch) {
      // Try to get the most recent batch overall
      const batches = await listBatches(1);
      batch = batches[0] || null;
    }
    if (!batch) {
      console.log("No batch found to reset.");
      return;
    }
  }

  const resetCount = await resetFailedJobs(batch.id);

  if (resetCount === 0) {
    console.log(`No failed jobs to reset in batch #${batch.id}.`);
  } else {
    console.log(`Reset ${resetCount} failed job(s) to pending in batch #${batch.id}.`);
    console.log(`Run \`bun run flow.ts\` to retry.`);
  }
}

/**
 * Run history command - show recent job history
 */
export async function runHistory(limit: number = 20): Promise<void> {
  await initDB();

  const jobs = await getJobHistory(limit);

  if (jobs.length === 0) {
    console.log("\nNo job history found.\n");
    return;
  }

  console.log("\n=== Recent Jobs ===\n");
  console.log(
    "Batch".padEnd(7) +
    "Job".padEnd(6) +
    "Tag".padEnd(12) +
    "Status".padEnd(12) +
    "Duration".padEnd(10) +
    "Credits".padEnd(9) +
    "Video/Error"
  );
  console.log("-".repeat(90));

  for (const job of jobs) {
    const batchId = String(job.batch_id).padEnd(7);
    const jobId = String(job.id).padEnd(6);
    const tag = (job.tag || `#${job.prompt_index}`).padEnd(12);
    const status = job.status.padEnd(12);
    const duration = formatDuration(job.duration_ms).padEnd(10);
    const credits = (job.credits_used ? String(job.credits_used) : "--").padEnd(9);

    let details = "";
    if (job.status === "completed" && job.video_path) {
      details = job.video_path.split("/").pop() || "";
    } else if (job.status === "failed" && job.error_message) {
      details = `Error: ${job.error_message.substring(0, 30)}`;
    }

    console.log(`${batchId}${jobId}${tag}${status}${duration}${credits}${details}`);
  }

  console.log();
}

/**
 * Run cancel command - cancel a batch
 */
export async function runCancel(batchId?: number): Promise<void> {
  await initDB();

  let batch: Batch | null;

  if (batchId) {
    batch = await getBatch(batchId);
    if (!batch) {
      console.log(`Batch #${batchId} not found.`);
      return;
    }
  } else {
    batch = await getMostRecentIncompleteBatch();
    if (!batch) {
      console.log("No active batch to cancel.");
      return;
    }
  }

  if (batch.status === "completed" || batch.status === "cancelled") {
    console.log(`Batch #${batch.id} is already ${batch.status}.`);
    return;
  }

  await cancelBatch(batch.id);
  console.log(`Batch #${batch.id} has been cancelled.`);

  const stats = await getBatchStats(batch.id);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Skipped: ${stats.skipped}`);
}

/**
 * Run help command - show available commands
 */
export function runHelp(): void {
  console.log(`
=== veo-cli - Batch AI Video Generation ===

Usage: bun run flow.ts [command] [options]

Commands:
  (default)          Start or resume video generation
  status [id]        Show batch status (current or specific batch)
  list               List all batches
  resume [id]        Resume a specific batch
  reset [id]         Reset failed jobs to pending
  history            Show recent job history
  cancel [id]        Cancel a batch
  help               Show this help message

useapi.net Commands:
  useapi:accounts list              List useapi.net accounts + health
  useapi:accounts add               Add account (uses cookie.json)
  useapi:accounts add --cookies ./other.json
  useapi:accounts add --dry-run     Validate cookies without registering
  useapi:accounts export-help       Show cookie export instructions
  useapi:captcha --provider <name> --key <key>  Configure CAPTCHA provider
  useapi:captcha list               Show configured CAPTCHA providers
  useapi:health                     Full health check + history

useapi.net Extended Features:
  useapi:image         Generate images with Imagen-4/Gemini models
  useapi:image:upscale Upscale nano-banana-pro images to 2K/4K
  useapi:gif           Convert video to GIF (FREE - no CAPTCHA!)
  useapi:upscale       Upscale video to 1080p/4K
  useapi:upload-video  Upload MP4 for Omni Flash V2V edit (--file <path>)

Video Options:
  -p, --prompt <text>   Single prompt (no file needed)
  -r, --ratio <ratio>   Aspect ratio: landscape, portrait, 16:9, 9:16
  -m, --model <model>   Model: quality, fast, free, veo2
  -s, --seed <number>   Seed for reproducibility (0-32767)
  -n, --count <number>  Outputs per prompt (1-4)
  -t, --tag <tag>       Override tag for inline prompt
  --no-audio            Disable audio (uses Veo 2)

Backend Options:
  --backend <type>      Backend: direct (default) or useapi
  -y, --yes             Skip confirmation prompts (for scripting)
  --webhook <url>       Webhook URL for job completion notifications
  --from-job <n>        Skip jobs before index n (1-based, for partial resume)
  -c, --concurrency <n> Parallel video generations (1-10, useapi backend only)

Extended Features Options:
  --image-prompt <text> Image generation prompt (for useapi:image)
  --image-count <n>     Number of images (1-4)
  --image-model <model> imagen-4, nano-banana, nano-banana-pro
  --media-id <id>       Media ID for upscale/gif operations
  --resolution <res>    2k/4k (images) or 1080p/4k (videos)
  --output-file <path>  Output file path (for GIF)
  --ref <url>           Reference image (can use multiple times)

General Options:
  --visible             Show browser window (for login/debug)
  --headless            Run headless (default)
  --dry-run             Validate prompts without generating
  -q, --quiet           Suppress non-essential output (for scripting)
  --debug               Enable debug-level logging (verbose output)
  --config <path>       Custom config file
  --prompts <path>      Custom prompts file
  --cookies <path>      Custom cookies file
  --output <path>       Custom output directory
  --limit <n>           Limit results (for list/history)

Models:
  quality    Veo 3.1 Quality - 100 credits/$0.50, ~3.5 min, best quality + audio
  fast       Veo 3.1 Fast - 10 credits/$0.05, ~1.5 min, good quality + audio
  free       Veo 3.1 Free - 0 credits/$0, ~1.5 min, lower priority + audio
  veo2       Veo 2.0 - 100 credits, ~5 min, no audio

Examples (direct backend - default):
  bun run flow.ts -p "[sunset] Golden sunset" -r landscape -m fast
  bun run flow.ts -p "[tiktok] Dancing cat" -r portrait -m free
  bun run flow.ts -p "[test] Mountain" --seed 12345 --count 2
  bun run flow.ts --dry-run -p "test" -r 16:9 -m fast

Examples (useapi.net backend):
  # Set environment variables first:
  # export USEAPI_API_TOKEN=your_token
  # export USEAPI_ACCOUNT_EMAIL=your_email@gmail.com

  bun run flow.ts useapi:health                    # Check setup
  bun run flow.ts --backend useapi -p "[test] A sunset" -m fast --dry-run
  bun run flow.ts --backend useapi -p "[test] A sunset" -m fast
  bun run flow.ts --backend useapi -p "[test] A sunset" -m fast --yes
  bun run flow.ts --backend useapi -p "[test] A cat" --webhook https://myapp.com/hook

Examples (useapi.net extended features):
  # Image generation
  bun run flow.ts useapi:image --image-prompt "A cat" --image-count 2 -r landscape
  bun run flow.ts useapi:image --image-prompt "Portrait" --image-model nano-banana-pro --yes

  # Image upscaling (nano-banana-pro only)
  bun run flow.ts useapi:image:upscale --media-id CAMaJD... --resolution 2k

  # Video to GIF (FREE - no CAPTCHA!)
  bun run flow.ts useapi:gif --media-id CAMaJD... --output-file ./preview.gif

  # Video upscaling
  bun run flow.ts useapi:upscale --media-id CAMaJD... --resolution 1080p
  bun run flow.ts useapi:upscale --media-id CAMaJD... --resolution 4k --yes

Cost Summary (useapi.net extended):
  Image (imagen-4)      ~$0.02 + $0.0025 CAPTCHA
  Image (nano-banana)   ~$0.03 + $0.0025 CAPTCHA
  Image (nano-banana-pro) ~$0.05 + $0.0025 CAPTCHA
  Video to GIF          FREE (no CAPTCHA!)
  Video Upscale 1080p   FREE
  Video Upscale 4K      50 credits (~$0.25), Ultra tier
  Image Upscale 2K      FREE
  Image Upscale 4K      Paid accounts only

Database:
  The CLI uses a local SQLite database (vclaw-cli.db) for batch/job tracking.
`);
}

// ============================================================================
// useapi.net Subcommand Handlers
// ============================================================================

/**
 * Run useapi:accounts command
 */
export async function runUseApiAccounts(options: CLIOptions): Promise<void> {
  // export-help does not require API token or client
  if (options.useapiSubcommand === "export-help") {
    const { showCookieExportGuide } = await import("./backends/useapi/accounts");
    showCookieExportGuide();
    return;
  }

  const { UseApiClient } = await import("./backends/useapi/client");
  const {
    listAccounts,
    addAccount,
  } = await import("./backends/useapi/accounts");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL || "";

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    console.log("Get your API token from https://useapi.net/dashboard");
    return;
  }

  const client = new UseApiClient({ apiToken, accountEmail });

  switch (options.useapiSubcommand) {
    case "add":
      const cookiesPath = options.cookiesPath || "./cookie.json";
      await addAccount(client, cookiesPath, options.dryRun || false);
      break;
    case "list":
    default:
      await listAccounts(client);
      break;
  }
}

/**
 * Run useapi:captcha command
 */
export async function runUseApiCaptcha(options: CLIOptions): Promise<void> {
  const { UseApiClient } = await import("./backends/useapi/client");
  const {
    configureCaptcha,
    listCaptchaProviders,
  } = await import("./backends/useapi/accounts");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    console.log("Get your API token from https://useapi.net/dashboard");
    return;
  }

  const client = new UseApiClient({ apiToken, accountEmail: accountEmail || "" });

  if (options.useapiSubcommand === "list") {
    await listCaptchaProviders(client);
    return;
  }

  // Configure CAPTCHA provider
  if (!options.captchaProvider || !options.captchaKey) {
    console.error("Error: --provider and --key are required to configure CAPTCHA.");
    console.log("Usage: bun run flow.ts useapi:captcha --provider capsolver --key YOUR_KEY");
    console.log("Valid providers: EzCaptcha, CapSolver, YesCaptcha");
    console.log("Use --key \"\" to remove a provider.");
    return;
  }

  await configureCaptcha(client, options.captchaProvider, options.captchaKey);
}

/**
 * Run useapi:health command
 */
export async function runUseApiHealth(options: CLIOptions): Promise<void> {
  const { UseApiClient } = await import("./backends/useapi/client");
  const { runFullHealthCheck } = await import("./backends/useapi/accounts");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    console.log("Get your API token from https://useapi.net/dashboard");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    console.log("This should be the Google account email registered with useapi.net");
    return;
  }

  const client = new UseApiClient({ apiToken, accountEmail });

  // Get recent stats from database (async)
  const getRecentStats = async () => {
    try {
      const stats = await getUseApiStats(24); // Last 24 hours
      return {
        success: stats.success,
        failed: stats.failed,
        rateLimited: stats.rateLimited,
      };
    } catch {
      return { success: 0, failed: 0, rateLimited: 0 };
    }
  };

  await runFullHealthCheck(client, accountEmail, getRecentStats);
}

/**
 * Run dry-run for useapi.net backend
 * Validates credentials, account health, CAPTCHA, and shows cost estimate
 */
export async function runUseApiDryRun(
  prompts: string[],
  options: CLIOptions & {
    model?: string;
    aspectRatio?: string;
    outputsPerPrompt?: number;
  }
): Promise<{ valid: boolean; errors: string[] }> {
  const { UseApiClient, mapModelToUseApi, calculateCost } = await import("./backends/useapi/client");
  const { validatePrompts } = await import("./prompts");

  console.log("\n=== USEAPI DRY RUN MODE ===\n");

  const errors: string[] = [];
  let allValid = true;

  // Step 1: Validate prompts (existing validation)
  console.log("1. Validating prompts...");
  const { validations, stats } = validatePrompts(prompts);

  for (const v of validations) {
    const truncatedPrompt = v.line.length > 60 ? v.line.substring(0, 57) + "..." : v.line;
    if (v.valid) {
      console.log(`   ✓ ${truncatedPrompt}`);
    } else {
      console.log(`   ✗ ${truncatedPrompt}`);
      for (const err of v.errors) {
        console.log(`     ERROR: ${err}`);
        errors.push(err);
      }
      allValid = false;
    }
  }
  console.log(`   Total: ${stats.valid}/${stats.total} valid\n`);

  // Step 2: Check USEAPI_API_TOKEN env var exists
  console.log("2. Checking environment variables...");
  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.log("   ✗ USEAPI_API_TOKEN not set");
    errors.push("USEAPI_API_TOKEN environment variable is required");
    allValid = false;
  } else {
    console.log("   ✓ USEAPI_API_TOKEN is set");
  }

  if (!accountEmail) {
    console.log("   ✗ USEAPI_ACCOUNT_EMAIL not set");
    errors.push("USEAPI_ACCOUNT_EMAIL environment variable is required");
    allValid = false;
  } else {
    console.log(`   ✓ USEAPI_ACCOUNT_EMAIL: ${accountEmail}`);
  }
  console.log();

  // If credentials missing, can't continue with API checks
  if (!apiToken || !accountEmail) {
    console.log("Cannot continue without credentials.\n");
    return { valid: false, errors };
  }

  // Step 3: Verify credentials by calling GET /accounts
  console.log("3. Verifying API credentials...");
  const client = new UseApiClient({ apiToken, accountEmail });

  let accountTier: string = "unknown";
  let captchaCredits: number | undefined;

  try {
    const health = await client.getAccountHealth(accountEmail);
    accountTier = health.tier;
    captchaCredits = health.captchaCredits;

    if (health.status === "active" || health.status === "ok") {
      console.log(`   ✓ API credentials valid`);
      console.log(`   ✓ Account status: ${health.status}`);
    } else {
      console.log(`   ⚠ Account status: ${health.status}`);
      if (health.message) {
        console.log(`     Message: ${health.message}`);
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`   ✗ API credential check failed: ${errMsg}`);
    errors.push(`API credential check failed: ${errMsg}`);
    allValid = false;
  }
  console.log();

  // Step 4: Check account health and tier
  console.log("4. Checking account tier...");
  console.log(`   Account tier: ${accountTier}`);

  // Check if 'free' model is selected but account is not Ultra tier
  const selectedModel = options.model || "fast";
  const useapiModel = mapModelToUseApi(selectedModel);

  if (useapiModel === "veo-3.1-lite-low-priority" && accountTier !== "ultra") {
    console.log(`   ✗ Free model requires Ultra tier (your tier: ${accountTier})`);
    errors.push(`Free model (veo-3.1-lite-low-priority) requires Ultra tier account. Your tier: ${accountTier}`);
    allValid = false;
  } else {
    console.log(`   ✓ Model '${selectedModel}' compatible with tier '${accountTier}'`);
  }
  console.log();

  // Step 5: Verify CAPTCHA provider configured
  console.log("5. Checking CAPTCHA configuration...");
  if (captchaCredits !== undefined) {
    if (captchaCredits > 0) {
      console.log(`   ✓ CAPTCHA credits available: ${captchaCredits}`);
    } else {
      console.log(`   ⚠ CAPTCHA credits low: ${captchaCredits}`);
      console.log("     You may need to add credits to continue generating videos.");
    }
  } else {
    console.log("   ⚠ CAPTCHA credits: unknown (could not retrieve)");
  }

  try {
    const captchaResponse = await client.getCaptchaProviders();
    const configuredProviders = (["EzCaptcha", "CapSolver", "YesCaptcha"] as const)
      .filter((provider) => typeof captchaResponse[provider] === "string");

    if (configuredProviders.length > 0) {
      console.log(`   ✓ CAPTCHA providers configured: ${configuredProviders.join(", ")}`);
    } else {
      console.log("   ⚠ No CAPTCHA providers configured");
      console.log("     Run: bun run flow.ts useapi:captcha --provider ezcaptcha --key YOUR_KEY");
    }
  } catch (error) {
    console.log("   ⚠ Could not check CAPTCHA providers");
  }
  console.log();

  // Step 6: Show cost estimate
  console.log("6. Cost estimate...");
  const videoCount = (options.outputsPerPrompt || 1) * stats.valid;
  const cost = calculateCost(useapiModel, videoCount, (options.duration ?? 8) as 4 | 6 | 8 | 10);

  console.log(`   Model: ${useapiModel}`);
  console.log(`   Videos: ${videoCount} (${stats.valid} prompts × ${options.outputsPerPrompt || 1} outputs)`);
  console.log(`   Cost: ${cost.credits} credits (${cost.perVideoCredits} credits/video)`);
  console.log();

  // Step 7: Summary
  console.log("─".repeat(50));
  if (allValid && stats.invalid === 0) {
    console.log("✓ All checks passed. Ready to generate!");
    console.log("\nRun without --dry-run to start generation.");
    console.log("Use --yes/-y to skip the cost confirmation prompt.\n");
  } else {
    console.log("⚠ Issues found:");
    for (const err of errors) {
      console.log(`  • ${err}`);
    }
    console.log("\nFix the issues above before running generation.\n");
  }

  return { valid: allValid && stats.invalid === 0, errors };
}

// ============================================================================
// useapi.net Extended Features Handlers
// ============================================================================

/**
 * Run useapi:image command - Generate images using Imagen-4/nano-banana models
 */
export async function runUseApiImage(options: CLIOptions): Promise<void> {
  const { UseApiClient, calculateImageCost, autoSelectImageModel, mapAspectRatioToUseApi } = await import("./backends/useapi/client");
  const { writeFile } = await import("fs/promises");
  const { join } = await import("path");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    console.log("Get your API token from https://useapi.net/dashboard");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    return;
  }

  if (!options.imagePrompt) {
    console.error("Error: --image-prompt is required.");
    console.log("Usage: bun run flow.ts useapi:image --image-prompt \"A cat\" --image-count 2");
    return;
  }

  const client = new UseApiClient({ apiToken, accountEmail });

  // Determine model based on reference count
  const refCount = options.referenceImages?.length || 0;
  const model = (options.imageModel as "imagen-4" | "nano-banana" | "nano-banana-pro") || autoSelectImageModel(refCount);
  const imageCount = Math.min(4, Math.max(1, options.imageCount || 1));
  const aspectRatio = mapAspectRatioToUseApi(options.aspectRatio || "landscape");

  // Show cost estimate
  const cost = calculateImageCost(model, imageCount);
  console.log("\n=== Image Generation ===\n");
  console.log(`Prompt: ${options.imagePrompt.substring(0, 60)}${options.imagePrompt.length > 60 ? "..." : ""}`);
  console.log(`Model: ${model}`);
  console.log(`Count: ${imageCount} images`);
  console.log(`Aspect ratio: ${aspectRatio}`);
  if (refCount > 0) {
    console.log(`References: ${refCount} images`);
  }
  console.log(`\nEstimated cost: $${cost.total.toFixed(4)} (images: $${cost.imageCost.toFixed(4)}, CAPTCHA: $${cost.captchaCost.toFixed(4)})`);

  // Confirm unless --yes
  if (!options.yes) {
    console.log("\nUse --yes to skip this confirmation.");
    console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");
    await Bun.sleep(5000);
  }

  console.log("Generating images...");

  try {
    // Build params with references
    const params: any = {
      email: accountEmail,
      prompt: options.imagePrompt,
      model,
      aspectRatio,
      count: imageCount,
    };

    // Add reference images if provided
    if (options.referenceImages) {
      options.referenceImages.forEach((ref, i) => {
        if (i < 10) {
          params[`reference_${i + 1}`] = ref;
        }
      });
    }

    const response = await client.generateImage(params);

    if (response.error) {
      console.error(`Error: ${response.error}`);
      return;
    }

    console.log(`\n✓ Generated ${response.images?.length || 0} image(s)\n`);

    // Display results
    if (response.images) {
      for (const [i, img] of response.images.entries()) {
        console.log(`Image ${i + 1}:`);
        console.log(`  Media ID: ${img.mediaGenerationId}`);
        if (img.url || img.fifeUrl) {
          console.log(`  URL: ${img.url || img.fifeUrl}`);
        }
        if (img.width && img.height) {
          console.log(`  Size: ${img.width}x${img.height}`);
        }
        console.log();
      }
    }

    if (response.captcha) {
      console.log(`CAPTCHA: ${response.captcha.service || "useapi"} (${response.captcha.durationMs || 0}ms)`);
    }

    console.log("\nTo upscale (nano-banana-pro images only):");
    console.log(`  bun run flow.ts useapi:image:upscale --media-id <id> --resolution 2k`);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nImage generation failed: ${errMsg}`);
  }
}

/**
 * Run useapi:image:upscale command - Upscale nano-banana-pro images
 */
export async function runUseApiImageUpscale(options: CLIOptions): Promise<void> {
  const { UseApiClient, calculateImageUpscaleCost } = await import("./backends/useapi/client");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    return;
  }

  if (!options.mediaId) {
    console.error("Error: --media-id is required.");
    console.log("Usage: bun run flow.ts useapi:image:upscale --media-id CAMaJD... --resolution 2k");
    return;
  }

  const resolution = (options.resolution as "2k" | "4k") || "2k";
  const cost = calculateImageUpscaleCost(resolution);

  console.log("\n=== Image Upscaling ===\n");
  console.log(`Media ID: ${options.mediaId.substring(0, 30)}...`);
  console.log(`Resolution: ${resolution}`);
  console.log(`Note: ${cost.notes}`);

  const client = new UseApiClient({ apiToken, accountEmail });

  console.log("\nUpscaling image...");

  try {
    const response = await client.upscaleImage({
      email: accountEmail,
      mediaGenerationId: options.mediaId,
      resolution,
    });

    if (response.error) {
      console.error(`Error: ${response.error}`);
      return;
    }

    console.log("\n✓ Image upscaled successfully!\n");
    console.log(`Media ID: ${response.mediaGenerationId}`);
    if (response.url || response.fifeUrl) {
      console.log(`URL: ${response.url || response.fifeUrl}`);
    }
    if (response.width && response.height) {
      console.log(`Size: ${response.width}x${response.height}`);
    }
    if (response.resolution) {
      console.log(`Resolution: ${response.resolution}`);
    }

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nImage upscaling failed: ${errMsg}`);
  }
}

/**
 * Run useapi:gif command - Convert video to GIF (FREE - no CAPTCHA!)
 */
export async function runUseApiGif(options: CLIOptions): Promise<void> {
  const { UseApiClient } = await import("./backends/useapi/client");
  const { writeFile } = await import("fs/promises");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    return;
  }

  if (!options.mediaId) {
    console.error("Error: --media-id is required.");
    console.log("Usage: bun run flow.ts useapi:gif --media-id CAMaJD... --output-file ./preview.gif");
    return;
  }

  const outputFile = options.outputFile || "./output.gif";

  console.log("\n=== Video to GIF Conversion ===\n");
  console.log(`Media ID: ${options.mediaId.substring(0, 30)}...`);
  console.log(`Output: ${outputFile}`);
  console.log(`Cost: FREE (no CAPTCHA required!)`);

  const client = new UseApiClient({ apiToken, accountEmail });

  console.log("\nConverting to GIF...");

  try {
    const response = await client.videoToGif({
      mediaGenerationId: options.mediaId,
    });

    if (response.error) {
      console.error(`Error: ${typeof response.error === "string" ? response.error : JSON.stringify(response.error)}`);
      return;
    }

    if (!response.encodedGif) {
      console.error("Error: No GIF data in response");
      return;
    }

    // Decode base64 and save to file
    const gifBuffer = Buffer.from(response.encodedGif, "base64");
    await writeFile(outputFile, gifBuffer);

    console.log(`\n✓ GIF saved to ${outputFile}`);
    console.log(`  Size: ${(gifBuffer.length / 1024).toFixed(1)} KB`);
    if (response.width && response.height) {
      console.log(`  Dimensions: ${response.width}x${response.height}`);
    }

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nGIF conversion failed: ${errMsg}`);
  }
}

/**
 * Run useapi:upscale command - Upscale video to 1080p or 4K
 */
export async function runUseApiVideoUpscale(options: CLIOptions): Promise<void> {
  const { UseApiClient, calculateUpscaleCost } = await import("./backends/useapi/client");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    return;
  }

  if (!options.mediaId) {
    console.error("Error: --media-id is required.");
    console.log("Usage: bun run flow.ts useapi:upscale --media-id CAMaJD... --resolution 1080p");
    return;
  }

  const resolution = (options.resolution as "1080p" | "4k") || "1080p";
  const cost = calculateUpscaleCost(resolution);

  console.log("\n=== Video Upscaling ===\n");
  console.log(`Media ID: ${options.mediaId.substring(0, 30)}...`);
  console.log(`Resolution: ${resolution}`);
  console.log(`Cost: ${cost.cost === 0 ? "FREE" : `${cost.credits} credits (~$${cost.cost.toFixed(2)})`}`);
  console.log(`Note: ${cost.notes}`);

  // Confirm for 4K unless --yes
  if (resolution === "4k" && !options.yes) {
    console.log("\n4K upscaling requires Ultra tier and costs 50 credits.");
    console.log("Use --yes to skip this confirmation.");
    console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");
    await Bun.sleep(5000);
  }

  const client = new UseApiClient({ apiToken, accountEmail });

  console.log("\nUpscaling video...");

  try {
    const response = await client.upscaleVideo({
      mediaGenerationId: options.mediaId,
      resolution,
    });

    if (response.error) {
      console.error(`Error: ${typeof response.error === "string" ? response.error : JSON.stringify(response.error)}`);
      return;
    }

    console.log(`\n✓ Video upscaled successfully!`);
    if (response.cached) {
      console.log(`  (Cached result - no additional cost)`);
    }
    console.log();

    const firstOperation = response.operations?.[0];
    const firstMedia = response.media?.[0];
    const videoMetadata = firstOperation?.operation?.metadata?.video;
    const upscaledMediaId = firstOperation?.mediaGenerationId
      || videoMetadata?.mediaGenerationId
      || firstMedia?.mediaGenerationId;
    const videoUrl = firstMedia?.videoUrl || videoMetadata?.fifeUrl;
    const thumbnailUrl = firstMedia?.thumbnailUrl || videoMetadata?.servingBaseUri;

    if (upscaledMediaId) {
      console.log(`Media ID: ${upscaledMediaId}`);
    }
    if (videoUrl) {
      console.log(`URL: ${videoUrl}`);
    }
    if (thumbnailUrl) {
      console.log(`Thumbnail: ${thumbnailUrl}`);
    }
    if (videoMetadata?.model) {
      console.log(`Model: ${videoMetadata.model}`);
    }
    if (response.status || firstOperation?.status) {
      console.log(`Status: ${response.status || firstOperation?.status}`);
    }

    if (response.captcha) {
      console.log(`\nCAPTCHA: ${response.captcha.service || "useapi"} (${response.captcha.durationMs || 0}ms)`);
    }

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nVideo upscaling failed: ${errMsg}`);
  }
}

/**
 * Run useapi:upload-video command - Upload an MP4 for Omni Flash V2V edit.
 *
 * Uploads a local MP4 to the Google Flow asset library via useapi.net and
 * prints the resulting mediaGenerationId, which can then be passed as
 * `referenceVideo_1` when calling POST /videos with model "omni-flash".
 */
export async function runUseApiUploadVideo(options: CLIOptions): Promise<void> {
  const { UseApiClient } = await import("./backends/useapi/client");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    return;
  }

  if (!options.file) {
    console.error("Error: --file is required.");
    console.log("Usage: bun run flow.ts useapi:upload-video --file ./clip.mp4");
    return;
  }

  console.log("\n=== Video Asset Upload (Omni Flash V2V) ===\n");
  console.log(`File: ${options.file}`);

  const client = new UseApiClient({ apiToken, accountEmail });

  console.log("\nUploading video...");

  try {
    const response = await client.uploadVideo(options.file);

    // Extract flat mediaGenerationId string from nested-or-flat response
    const mgId =
      typeof response.mediaGenerationId === "string"
        ? response.mediaGenerationId
        : response.mediaGenerationId?.mediaGenerationId ?? "(unknown)";

    console.log(`\n✓ Video uploaded successfully!`);
    console.log(`  mediaGenerationId: ${mgId}`);
    if (response.durationSeconds !== undefined) {
      console.log(`  durationSeconds:   ${response.durationSeconds}`);
    }
    if (response.width && response.height) {
      console.log(`  Dimensions: ${response.width}x${response.height}`);
    }
    console.log(
      `\n  Hint: Use as referenceVideo_1 on POST /videos with model: "omni-flash"`
    );

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nVideo upload failed: ${errMsg}`);
  }
}

/**
 * Run useapi:extend command — extend a previously generated video with a new prompt.
 * Mirrors the shape of runUseApiVideoUpscale / runUseApiUploadVideo.
 */
export async function runUseApiExtend(options: CLIOptions): Promise<void> {
  const { UseApiClient } = await import("./backends/useapi/client");
  const { writeFile } = await import("fs/promises");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    return;
  }

  if (!options.mediaId) {
    console.error("Error: --media-id is required.");
    console.log("Usage: bun run flow.ts useapi:extend --media-id CAMaJD... --prompt \"What happens next\"");
    return;
  }

  const prompt = options.inlinePrompt;
  if (!prompt) {
    console.error("Error: --prompt is required.");
    console.log("Usage: bun run flow.ts useapi:extend --media-id CAMaJD... --prompt \"What happens next\"");
    return;
  }

  console.log("\n=== Video Extend ===\n");
  console.log(`Source media ID: ${options.mediaId.substring(0, 30)}...`);
  console.log(`Prompt: ${prompt.substring(0, 60)}${prompt.length > 60 ? "..." : ""}`);

  const client = new UseApiClient({ apiToken, accountEmail });

  console.log("\nExtending video...");

  try {
    const response = await client.extendVideo({
      mediaGenerationId: options.mediaId,
      prompt,
    });

    if (response.error) {
      console.error(`Error: ${response.error}`);
      return;
    }

    console.log(`\n✓ Video extended! Job ID: ${response.jobId}`);

    // Download extended video if a URL is available
    const firstMedia = response.media?.[0];
    const videoUrl = firstMedia?.videoUrl;
    const mediaId = firstMedia?.mediaGenerationId;

    if (mediaId) {
      console.log(`  mediaGenerationId: ${mediaId}`);
    }

    if (videoUrl) {
      const outputFile = options.outputFile || `./extended-${response.jobId}.mp4`;
      console.log(`\nDownloading to ${outputFile}...`);
      const resp = await fetch(videoUrl);
      if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      await writeFile(outputFile, buf);
      console.log(`✓ Saved to ${outputFile} (${(buf.length / (1024 * 1024)).toFixed(2)} MB)`);
    } else {
      console.log("\n  No video URL in response — video may still be processing.");
      console.log(`  Poll with: bun run flow.ts status`);
    }

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nVideo extend failed: ${errMsg}`);
  }
}

/**
 * Run useapi:concat command — concatenate 2-10 videos into one MP4.
 * Decodes the base64 encodedVideo from the response to an .mp4 file.
 */
export async function runUseApiConcat(options: CLIOptions): Promise<void> {
  const { UseApiClient } = await import("./backends/useapi/client");
  const { writeFile } = await import("fs/promises");

  const apiToken = process.env.USEAPI_API_TOKEN;
  const accountEmail = process.env.USEAPI_ACCOUNT_EMAIL;

  if (!apiToken) {
    console.error("Error: USEAPI_API_TOKEN environment variable is required.");
    return;
  }

  if (!accountEmail) {
    console.error("Error: USEAPI_ACCOUNT_EMAIL environment variable is required.");
    return;
  }

  if (!options.mediaIds) {
    console.error("Error: --media-ids is required.");
    console.log("Usage: bun run flow.ts useapi:concat --media-ids id1,id2,id3");
    return;
  }

  const ids = options.mediaIds.split(",").map((id) => id.trim()).filter(Boolean);

  if (ids.length < 2) {
    console.error("Error: --media-ids requires at least 2 comma-separated IDs.");
    return;
  }

  if (ids.length > 10) {
    console.error("Error: --media-ids accepts at most 10 IDs.");
    return;
  }

  console.log("\n=== Video Concatenation ===\n");
  console.log(`Videos: ${ids.length} clips`);
  for (const [i, id] of ids.entries()) {
    console.log(`  ${i + 1}. ${id.substring(0, 40)}${id.length > 40 ? "..." : ""}`);
  }
  console.log(`Cost: FREE (no CAPTCHA required)`);

  const client = new UseApiClient({ apiToken, accountEmail });

  console.log("\nConcatenating...");

  try {
    const response = await client.concatenateVideos({
      media: ids.map((id) => ({ mediaGenerationId: id })),
    });

    if (response.error) {
      const errStr = typeof response.error === "string"
        ? response.error
        : JSON.stringify(response.error);
      console.error(`Error: ${errStr}`);
      return;
    }

    if (!response.encodedVideo) {
      console.error("Error: No video data in response");
      console.log("Response:", JSON.stringify(response, null, 2));
      return;
    }

    // Decode base64 → MP4
    const jobId = response.jobId ?? Date.now().toString();
    const outputFile = options.outputFile || `./concatenated-${jobId}.mp4`;
    const videoBuffer = Buffer.from(response.encodedVideo, "base64");
    await writeFile(outputFile, videoBuffer);

    console.log(`\n✓ Concatenated MP4 saved to ${outputFile}`);
    console.log(`  Size: ${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB`);
    if (response.inputsCount !== undefined) {
      console.log(`  Inputs: ${response.inputsCount} clips`);
    }
    if (response.status) {
      console.log(`  Status: ${response.status}`);
    }

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\nVideo concatenation failed: ${errMsg}`);
  }
}
