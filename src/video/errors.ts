/**
 * Stable error codes for vclaw CLI output.
 *
 * The TS enum + the JSON catalog at schemas/video/errors.json are kept in
 * sync by a test in cli-errors.test.ts. Add codes here AND in the JSON.
 *
 * Conventions:
 * - snake_case
 * - Specific over generic (prefer "image_not_found" over "not_found")
 * - Stable: never rename a code once shipped; deprecate and add a new one
 */
export const ALL_ERROR_CODES = [
  // User-input errors (exit code 1)
  'invalid_slug',
  'project_not_found',
  'missing_required_flag',
  'unknown_subcommand',
  'invalid_mode',
  'invalid_aspect_ratio',
  'image_not_found',
  'asset_not_found',
  'template_not_found',
  'character_not_found',
  'duplicate_project',
  'directory_not_writable',
  'invalid_role',

  // System errors (exit code 2)
  'provider_unreachable',
  'adapter_command_failed',
  'env_var_missing',
  'native_transport_failed',
  'schema_validation_failed',
  'workspace_corrupt',
  'unexpected_internal_error',

  // Gates (exit code 3)
  'storyboard_approval_required',
  'storyboard_review_stale',
  'execution_blocked_by_readiness',
] as const;

export type ErrorCode = typeof ALL_ERROR_CODES[number];

/**
 * Maps each ErrorCode to its CLI exit code (1=user, 2=system, 3=gate).
 * Stays in sync with schemas/video/errors.json via the catalog test.
 */
export const EXIT_CODES: Record<ErrorCode, 1 | 2 | 3> = {
  // User-input errors (1)
  invalid_slug: 1,
  project_not_found: 1,
  missing_required_flag: 1,
  unknown_subcommand: 1,
  invalid_mode: 1,
  invalid_aspect_ratio: 1,
  image_not_found: 1,
  asset_not_found: 1,
  template_not_found: 1,
  character_not_found: 1,
  duplicate_project: 1,
  directory_not_writable: 1,
  invalid_role: 1,
  // System errors (2)
  provider_unreachable: 2,
  adapter_command_failed: 2,
  env_var_missing: 2,
  native_transport_failed: 2,
  schema_validation_failed: 2,
  workspace_corrupt: 2,
  unexpected_internal_error: 2,
  // Gates (3)
  storyboard_approval_required: 3,
  storyboard_review_stale: 3,
  execution_blocked_by_readiness: 3,
};

export function exitCodeFor(code: ErrorCode): 1 | 2 | 3 {
  return EXIT_CODES[code];
}

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  const out: ErrorResponse = { code, message };
  if (details !== undefined) out.details = details;
  return out;
}

/**
 * Throwable error that carries an ErrorCode. The top-level main() catch in
 * vclaw.ts unwraps VclawError into an ErrorResponse + appropriate ExitCode.
 */
export class VclawError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'VclawError';
    this.code = code;
    this.details = details;
  }
}
