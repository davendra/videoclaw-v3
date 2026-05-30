/**
 * Gated, opt-in Topaz Video AI upscale planner for the assemble stage (WS9).
 *
 * This module is a PURE planner: `topazUpscalePlan` decides whether an upscale
 * pass should run and, if so, builds the exact CLI command — but it NEVER spawns
 * a process. The actual shell-out is a separate thin wrapper that runs only when
 * `plan.run` is true, so the gate stays fully unit-testable and offline.
 *
 * The pass is opt-in via two knobs (both must be satisfied to run):
 *  - enabled: the operator opted in (env flag VCLAW_TOPAZ_UPSCALE=1).
 *  - cliPath: the Topaz CLI is installed / located (env path VCLAW_TOPAZ_CLI).
 * When `enabled`/`cliPath` are omitted the planner falls back to those env vars,
 * so a project without the flag set behaves as a no-op (run:false).
 */

/** Topaz CLI gate inputs. Explicit fields win over the env fallbacks. */
export interface TopazUpscaleOptions {
  /** Whether the operator opted in. Falls back to VCLAW_TOPAZ_UPSCALE === '1'. */
  enabled?: boolean;
  /** Path to the Topaz CLI binary. Falls back to VCLAW_TOPAZ_CLI. */
  cliPath?: string;
  /** Upscale factor (default 2). */
  scale?: number;
  /** Topaz model name (default 'prob-4'). */
  model?: string;
}

/** The planner output. `run` gates the (separate) shell-out. */
export interface TopazUpscalePlan {
  /** True iff an upscale pass should actually run. */
  run: boolean;
  /** When run is false, why (so callers can log/skip clearly). */
  reason?: string;
  /** The CLI command to execute when run is true; `[]` when run is false. */
  command: string[];
}

/**
 * Plan a Topaz upscale pass for `input` -> `output`. PURE — never spawns.
 *
 * Resolution order for the two gate knobs: explicit option > env var. The pass
 * runs only when it is BOTH enabled AND the CLI path is known; otherwise it
 * returns `run:false` with a `reason` and an empty `command`.
 */
export function topazUpscalePlan(
  input: string,
  output: string,
  opts: TopazUpscaleOptions = {},
): TopazUpscalePlan {
  const enabled = opts.enabled ?? process.env.VCLAW_TOPAZ_UPSCALE === '1';
  const cliPath = opts.cliPath ?? process.env.VCLAW_TOPAZ_CLI;

  if (!enabled) {
    return { run: false, reason: 'Topaz upscale not enabled (VCLAW_TOPAZ_UPSCALE!=1)', command: [] };
  }
  if (!cliPath) {
    return {
      run: false,
      reason: 'Topaz CLI not installed (VCLAW_TOPAZ_CLI absent)',
      command: [],
    };
  }

  const scale = opts.scale ?? 2;
  const model = opts.model ?? 'prob-4';
  return {
    run: true,
    command: [
      cliPath,
      '-i',
      input,
      '-o',
      output,
      '--scale',
      String(scale),
      '--model',
      model,
    ],
  };
}
