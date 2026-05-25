/**
 * Configuration module for veo-cli
 * Handles config loading, CLI argument parsing, and model mappings
 */

import { join } from "path";
import { existsSync } from "fs";
import type { Config, VideoAspectRatio } from "./types";

// Default configuration
export const DEFAULT_CONFIG: Config = {
  paths: {
    prompts: "./prompts.txt",
    cookies: "./cookie.json",
    outputDir: "./output-videos",
  },
  browser: {
    headless: true,
  },
  quiet: false,
  timing: {
    pollIntervalMs: 3000,
    maxPollAttempts: 250,
    requestTimeoutMs: 30000,
    downloadTimeoutMs: 300000,
    interPromptDelayMs: 30000,
    loginWaitMs: 60000,
  },
  video: {
    outputsPerPrompt: 1,
    isSeedLocked: false,
    seed: null,
    preferredAspectRatio: null,
    preferredModel: null,
    audioEnabled: true,
  },
};

// Credit costs per model (approximate)
export const MODEL_CREDITS: Record<string, number> = {
  "veo_3_1_t2v_quality_ultra": 100,
  "veo_3_1_t2v_fast_ultra": 10,
  "veo_3_1_t2v_fast_ultra_free": 0,
  "veo_2_t2v_quality_ultra": 100,
  "veo_3_1_i2v_s_fast_ultra": 10,
  "veo_3_1_i2v_s_quality_ultra": 100,
};

// Logging configuration
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = 'info';
let quietMode = false;

/**
 * Set the minimum log level to display
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

/**
 * Set quiet mode flag (suppresses all but error messages)
 */
export function setQuietMode(value: boolean): void {
  quietMode = value;
}

/**
 * Check if quiet mode is enabled
 */
export function isQuietMode(): boolean {
  return quietMode;
}

/**
 * Log helper that respects quiet mode and log levels
 */
export function log(message: string, level: LogLevel = 'info'): void {
  // In quiet mode, only show errors
  if (quietMode && level !== 'error') return;
  // Check log level threshold
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLogLevel]) return;

  const prefix = level === 'warn' ? 'Warning: ' : level === 'error' ? 'Error: ' : '';
  console.log(`${prefix}${message}`);
}

// Convenience logging functions
export const debug = (msg: string): void => log(msg, 'debug');
export const info = (msg: string): void => log(msg, 'info');
export const warn = (msg: string): void => log(msg, 'warn');
export const error = (msg: string): void => log(msg, 'error');

/**
 * Map CLI aspect ratio to API value
 */
export function mapAspectRatio(ratio: string): VideoAspectRatio {
  switch (ratio.toLowerCase()) {
    case "portrait":
    case "9:16":
      return "VIDEO_ASPECT_RATIO_PORTRAIT";
    case "landscape":
    case "16:9":
    default:
      return "VIDEO_ASPECT_RATIO_LANDSCAPE";
  }
}

/**
 * Map CLI model to actual model key
 * Note: R2V mode uses veo_3_1_r2v_* models with aspect-ratio-specific keys
 */
export function mapModelKey(
  model: string,
  mode: "text" | "image" | "frames" | "ingredients",
  aspectRatio: VideoAspectRatio
): string {
  const isPortrait = aspectRatio === "VIDEO_ASPECT_RATIO_PORTRAIT";
  // T2V and R2V models have _portrait/_landscape variants
  const t2vSuffix = isPortrait ? "_portrait" : "";
  const r2vAspect = isPortrait ? "_portrait" : "_landscape";

  switch (model.toLowerCase()) {
    case "quality":
      if (mode === "text") return `veo_3_1_t2v${t2vSuffix}`;
      if (mode === "ingredients") return `veo_3_1_r2v_fast${r2vAspect}_ultra`; // R2V with aspect ratio
      return `veo_3_1_i2v_s`; // I2V uses base model; aspectRatio in request determines orientation
    case "fast":
      if (mode === "text") return `veo_3_1_t2v_fast${t2vSuffix}_ultra`;
      if (mode === "ingredients") return `veo_3_1_r2v_fast${r2vAspect}_ultra`; // R2V fast with aspect ratio
      return `veo_3_1_i2v_s`; // I2V uses base model (no _fast_ultra variant)
    case "free":
      if (mode === "text") return `veo_3_1_t2v_fast${t2vSuffix}_ultra_relaxed`;
      if (mode === "ingredients") return `veo_3_1_r2v_fast${r2vAspect}_ultra_relaxed`; // R2V relaxed with aspect ratio
      return `veo_3_1_i2v_s`; // I2V uses base model (no _relaxed variant)
    case "veo2":
      if (mode === "text") return "veo_2_0_t2v";
      if (mode === "ingredients") return `veo_3_1_r2v_fast${r2vAspect}_ultra`; // No veo2 R2V, use 3.1
      return "veo_2_0_i2v";
    default: {
      const isFrames = mode === "frames";
      const flSuffix = isFrames ? "_fl" : "";
      return model + flSuffix; // Pass through if already a full model name, adding _fl if in frames mode
    }
  }
}

/**
 * Get credits for a model preference
 */
export function getModelCredits(model: string): number {
  switch (model.toLowerCase()) {
    case "quality":
    case "veo2":
      return 100;
    case "fast":
      return 10;
    case "free":
      return 0;
    default:
      return 10; // Default to fast tier
  }
}

/**
 * Get model display name
 */
export function getModelDisplayName(model: string): string {
  switch (model.toLowerCase()) {
    case "quality":
      return "Veo 3.1 Quality (100 credits)";
    case "fast":
      return "Veo 3.1 Fast (10 credits)";
    case "free":
      return "Veo 3.1 Free (0 credits)";
    case "veo2":
      return "Veo 2.0 (100 credits, no audio)";
    default:
      return model;
  }
}

/**
 * Parse CLI arguments (for loadConfig internal use)
 */
function parseArgs(): Partial<Config> & { configPath?: string; dryRun?: boolean } {
  const args = process.argv.slice(2);
  const result: Partial<Config> & { configPath?: string; dryRun?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--headless":
        result.browser = { headless: true };
        break;
      case "--config":
        result.configPath = args[++i];
        break;
      case "--prompts":
        result.paths = { ...result.paths, prompts: args[++i] } as Config["paths"];
        break;
      case "--cookies":
        result.paths = { ...result.paths, cookies: args[++i] } as Config["paths"];
        break;
      case "--output":
        result.paths = { ...result.paths, outputDir: args[++i] } as Config["paths"];
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
    }
  }
  return result;
}

/**
 * Load and merge configuration
 */
export async function loadConfig(): Promise<Config> {
  const cliArgs = parseArgs();
  const configPath = cliArgs.configPath ?? join(process.cwd(), "config.json");

  let fileConfig: Partial<Config> = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = await Bun.file(configPath).json();
      log(`Loaded config from: ${configPath}`);
    } catch (err) {
      console.log(`Warning: Could not parse config file: ${configPath}`);
    }
  }

  // Deep merge: defaults <- file config <- CLI args
  return {
    paths: {
      ...DEFAULT_CONFIG.paths,
      ...fileConfig.paths,
      ...cliArgs.paths,
    },
    browser: {
      ...DEFAULT_CONFIG.browser,
      ...fileConfig.browser,
      ...cliArgs.browser,
    },
    quiet: fileConfig.quiet ?? DEFAULT_CONFIG.quiet,
    timing: {
      ...DEFAULT_CONFIG.timing,
      ...fileConfig.timing,
    },
    video: {
      ...DEFAULT_CONFIG.video,
      ...fileConfig.video,
    },
  };
}

/**
 * Resolve path relative to CWD
 */
export function resolvePath(filePath: string): string {
  if (filePath.startsWith("/") || filePath.startsWith("~")) {
    return filePath;
  }
  return join(process.cwd(), filePath);
}
