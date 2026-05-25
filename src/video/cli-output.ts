/**
 * I/O boundary helpers for the vclaw CLI.
 *
 * Three responsibilities:
 *  1. ExitCode taxonomy (0=success, 1=user error, 2=system error, 3=gate)
 *  2. writeOutput() — JSON when stdout is piped, human-readable when TTY
 *  3. progressLog() — progress chatter always goes to stderr
 *
 * No subcommand handler should call process.stdout.write or process.exit
 * directly; route through these helpers so agent-callers get a uniform
 * contract.
 */

import { VclawError, errorResponse, exitCodeFor, type ErrorResponse } from './errors.js';

export const ExitCode = {
  SUCCESS: 0,
  USER_ERROR: 1,
  SYSTEM_ERROR: 2,
  GATE: 3,
} as const;
export type ExitCode = typeof ExitCode[keyof typeof ExitCode];

/**
 * Maps an error to its CLI ExitCode.
 *
 * VclawError → uses the EXIT_CODES map from errors.ts (1/2/3).
 * Anything else (plain Error, throw 'string', etc.) → SYSTEM_ERROR.
 *
 * Delegates the mapping to Task 1's exitCodeFor() so there's a single
 * source of truth for code → exit code (kept in sync with the JSON
 * catalog by the cli-errors.test).
 */
export function exitCodeForError(err: unknown): ExitCode {
  if (err instanceof VclawError) {
    // exitCodeFor returns 1 | 2 | 3 which are all valid ExitCode values.
    return exitCodeFor(err.code) as ExitCode;
  }
  return ExitCode.SYSTEM_ERROR;
}

export interface WriteOutputOptions {
  /** Force JSON regardless of TTY (useful for `--json` flags). */
  json?: boolean;
  /** Override TTY detection (test hook). */
  isTTY?: boolean;
  /** Override stream (test hook). */
  stream?: NodeJS.WritableStream;
}

export function writeOutput(payload: unknown, options: WriteOutputOptions = {}): void {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.isTTY ?? (stream as NodeJS.WriteStream).isTTY ?? false;
  const useJson = options.json ?? !isTTY;
  if (useJson) {
    stream.write(`${JSON.stringify(payload)}\n`);
  } else {
    // TTY: pretty-print for humans. JSON.stringify with 2-space indent is
    // already a reasonable "human" form for our shape-stable payloads.
    stream.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

/**
 * Progress chatter. Always stderr — stdout stays pure JSON for agents.
 */
export function progressLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Top-level catch helper. Converts an unknown error into a JSON
 * ErrorResponse on stdout (so agents can parse it), human message on
 * stderr, and the appropriate process.exit code.
 *
 * Never returns; types as `never`.
 */
export function exitWith(err: unknown, options: WriteOutputOptions = {}): never {
  const code = exitCodeForError(err);
  if (err instanceof VclawError) {
    const response = errorResponse(err.code, err.message, err.details);
    writeOutput(response, options);
    progressLog(`[${err.code}] ${err.message}`);
  } else {
    const message = err instanceof Error ? err.message : String(err);
    const response: ErrorResponse = {
      code: 'unexpected_internal_error',
      message,
    };
    writeOutput(response, options);
    progressLog(`[unexpected_internal_error] ${message}`);
  }
  process.exit(code);
}
