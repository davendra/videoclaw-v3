/**
 * veo-cli modules - Entry point for modular imports
 *
 * This file re-exports all modules for easy importing.
 *
 * Usage:
 *   import { parsePromptLine, validatePrompts } from "./src";
 *   import { loadConfig, log, mapModelKey } from "./src";
 *   import { download, setUserAgent } from "./src";
 *   import { getRecaptchaToken, checkLoggedIn } from "./src";
 *   import { searchAllUserProjects, createProject } from "./src";
 */

// Type exports
export type {
  Config,
  VideoAspectRatio,
  Session,
  ParsedPrompt,
  ImageUploadResult,
  VideoGenerationOptions,
} from "./types";

// Error class exports
export {
  VeoCliError,
  AuthenticationError,
  RateLimitError,
  VideoGenerationError,
  ImageUploadError,
  ConfigurationError,
  PromptParseError,
} from "./types";

// Re-export from type.ts via types module
export type {
  Project,
  Operation,
  VideoModel,
  Workflow,
  UserProject,
} from "./types";

// Config module exports
export {
  DEFAULT_CONFIG,
  MODEL_CREDITS,
  loadConfig,
  log,
  debug,
  info,
  warn,
  error,
  setQuietMode,
  setLogLevel,
  getLogLevel,
  mapAspectRatio,
  mapModelKey,
  getModelCredits,
  getModelDisplayName,
  resolvePath,
} from "./config";
export type { LogLevel } from "./config";

// Prompts module exports
export {
  parsePromptLine,
  validatePrompts,
  extractTag,
  filterPrompts,
} from "./prompts";
export type { PromptValidation, ValidationStats } from "./prompts";

// Download module exports
export { download, setUserAgent } from "./download";

// Provider platform exports
export * from "./provider-platform";

// Auth module exports
export {
  extractRecaptchaSiteKey,
  getRecaptchaToken,
  checkLoggedIn,
  clearCachedSiteKey,
  validateSession,
} from "./auth";

// API module exports
export {
  BASE_API_URL,
  TARGET_PAGE_URL,
  setApiUserAgent,
  filterCookiesByUrlDomain,
  toHeaderCookie,
  createTimeoutController,
  withRetry,
  searchUserProjects,
  searchAllUserProjects,
  searchProjectWorkflows,
  searchAllProjectWorkflows,
  createProject,
  setLastSelectedVideoModelKey,
  setLastSelectedVideoAspectRatio,
  getUserSettings,
  getVideoModelConfig,
  getUserPaygateTier,
  checkAuthValid,
  checkCookieExpiration,
  performHealthChecks,
} from "./api";
export type { LastSettings, HealthCheckResult } from "./api";

// Upload module exports
export { uploadImageViaFlow, uploadMultipleIngredientsViaFlow } from "./upload";

// Generation module exports
export {
  genSeed,
  setGenerationUserAgent,
  createVideoText,
  createVideoImage,
  createVideoFrames,
  createVideoIngredients,
} from "./generation";
export type {
  VideoModelKey,
  Veo3Options,
  ImageVideoOptions,
  ReferenceVideoOptions,
} from "./generation";

// Database module exports (SQLite)
export {
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
  recordUseApiHistory,
  getUseApiHistory,
  getUseApiStats,
  cleanupUseApiHistory,
} from "./db-unified";
export type {
  BatchStatus,
  JobStatus,
  Batch,
  Job,
  BatchStats,
  UseApiHistoryStatus,
  UseApiHistoryEntry,
} from "./db-unified";

// Webhook module exports
export {
  sendWebhook,
  createJobCompletedPayload,
  createJobFailedPayload,
  createBatchCompletedPayload,
  createBatchFailedPayload,
  WebhookManager,
  isInternalUrl,
  validateWebhookUrl,
} from "./webhook";
export type { WebhookPayload, WebhookConfig } from "./webhook";

// Image cache exports (SQLite-only, from db-unified)
export {
  getImageCache,
  setImageCache,
  getImageCacheStats,
  cleanupImageCache,
  hashFileContents,
  getAverageJobDuration,
} from "./db-unified";
export type { ImageCacheEntry } from "./db-unified";
