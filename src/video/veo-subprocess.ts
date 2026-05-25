/**
 * Subprocess bridge to the Bun-based vclaw-cli/flow.ts.
 *
 * The Bun runtime is required for Puppeteer + Google Flow access. The
 * main TS CLI shells out to it for `vclaw veo *` subcommands. This
 * helper centralises the spawn + stdio forwarding so each veo verb in
 * vclaw.ts is one line.
 */

import { spawn } from 'node:child_process';
import { VclawError } from './errors.js';

export interface VeoSpawnOptions {
  /** When true, build the command but do not actually spawn. For tests + --dry-run. */
  dryRun?: boolean;
  /** Override the Bun binary path. Defaults to `VCLAW_VEO_BUN_BIN` env or `bun`. */
  bunBin?: string;
  /** Override the vclaw-cli flow.ts path. Defaults to `vclaw-cli/flow.ts` (relative to cwd). */
  flowEntry?: string;
  /** Pass env to the child process. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface VeoSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The full command string (helpful for tests + error messages). */
  command: string;
}

function resolveFlowEntry(override?: string): string {
  if (override) return override;
  // Default to the repo-root-relative path. The main CLI is invoked
  // from the repo root in normal use; tests also run from cwd=repo-root.
  // If invoked from elsewhere, callers should pass `flowEntry` explicitly
  // or set `VCLAW_VEO_FLOW_ENTRY`.
  return process.env.VCLAW_VEO_FLOW_ENTRY ?? 'vclaw-cli/flow.ts';
}

export async function spawnVeo(args: string[], options: VeoSpawnOptions = {}): Promise<VeoSpawnResult> {
  const bunBin = options.bunBin ?? process.env.VCLAW_VEO_BUN_BIN ?? 'bun';
  const flowEntry = resolveFlowEntry(options.flowEntry);
  const command = `${bunBin} run ${flowEntry} ${args.join(' ')}`;

  if (options.dryRun) {
    return { exitCode: 0, stdout: '', stderr: '', command };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bunBin, ['run', flowEntry, ...args], {
      env: options.env ?? process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdoutBuf += text;
      process.stdout.write(text); // forward to parent stdout
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderrBuf += text;
      process.stderr.write(text); // forward to parent stderr
    });

    child.on('error', (err) => {
      reject(new VclawError('native_transport_failed', `Failed to spawn bun: ${err.message}`, { command }));
    });

    child.on('exit', (code) => {
      resolve({ exitCode: code ?? -1, stdout: stdoutBuf, stderr: stderrBuf, command });
    });
  });
}
