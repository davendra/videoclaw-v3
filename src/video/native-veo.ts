import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { VideoExecutionPayload, VideoExecutionPollResult } from './types.js';

interface VeoNativeJobState {
  externalJobId: string;
  routeId: 'veo-useapi';
  outputDir: string;
  createdAt: string;
  outputs: VideoExecutionPollResult['outputs'];
}

function readDotEnvLike(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    out[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function loadWorkspaceEnv(workspaceRoot: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const envLocalPath = join(workspaceRoot, '.env.local');
  if (!existsSync(envLocalPath)) return env;
  return {
    ...readDotEnvLike(await readFile(envLocalPath, 'utf-8')),
    ...env,
  };
}

function veoCliRoot(workspaceRoot: string, env: NodeJS.ProcessEnv): string {
  return env.VCLAW_VEO_CLI_ROOT || join(workspaceRoot, 'vclaw-cli');
}

function veoOutputDir(workspaceRoot: string, env: NodeJS.ProcessEnv): string {
  return env.VCLAW_VEO_OUTPUT_DIR || join(veoCliRoot(workspaceRoot, env), 'output-videos');
}

function veoBunBin(env: NodeJS.ProcessEnv): string {
  return env.VCLAW_VEO_BUN_BIN || 'bun';
}

function ensureVeoCliEntry(cliRoot: string): void {
  const entryPath = join(cliRoot, 'flow.ts');
  if (existsSync(entryPath)) return;
  throw new Error(
    `veo-useapi native transport could not find flow.ts at ${entryPath}. ` +
    'Set VCLAW_VEO_CLI_ROOT to your vclaw-cli directory (for example, /path/to/videoclaw-v2/vclaw-cli).',
  );
}

function veoCommandTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.VCLAW_VEO_COMMAND_TIMEOUT_MS;
  if (!raw) return 180_000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 180_000;
  return parsed;
}

function veoRatio(aspectRatio: VideoExecutionPayload['executionProfile']['aspectRatio']): 'landscape' | 'portrait' | 'square' {
  if (aspectRatio === '9:16') return 'portrait';
  if (aspectRatio === '1:1') return 'square';
  return 'landscape';
}

function isSessionRefreshFailure(detail: string): boolean {
  return /Failed to refresh session|Account status is \"error\"|setup-google-flow/i.test(detail);
}

function buildPrompt(task: VideoExecutionPayload['tasks'][number]): string {
  const tag = `[scene_${task.sceneIndex}]`;
  if (task.inputKind === 'image' && task.referencePaths[0]) {
    return `${tag} image:${task.referencePaths[0]} ${task.prompt}`.trim();
  }
  return `${tag} ${task.prompt}`.trim();
}

function jobStateDir(outputDir: string): string {
  return join(outputDir, '.vclaw-jobs');
}

function jobStatePath(outputDir: string, externalJobId: string): string {
  return join(jobStateDir(outputDir), `${externalJobId}.json`);
}

async function writeJobState(state: VeoNativeJobState): Promise<void> {
  await mkdir(jobStateDir(state.outputDir), { recursive: true });
  await writeFile(jobStatePath(state.outputDir, state.externalJobId), `${JSON.stringify(state, null, 2)}\n`);
}

async function readJobState(outputDir: string, externalJobId: string): Promise<VeoNativeJobState> {
  const path = jobStatePath(outputDir, externalJobId);
  if (!existsSync(path)) {
    throw new Error(`Veo native job state not found for ${externalJobId}.`);
  }
  return JSON.parse(await readFile(path, 'utf-8')) as VeoNativeJobState;
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).map((entry) => join(dir, entry));
}

async function runVeoCommand(
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): Promise<{ stdout: string; stderr: string }> {
  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
  }>((resolve, reject) => {
    const child = spawn(veoBunBin(options.env), args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      child.kill('SIGTERM');
    }, veoCommandTimeoutMs(options.env));
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      resolve({ stdout, stderr, code, signal, timedOut: didTimeout });
    });
  });
  if (result.timedOut) {
    const detail = result.stderr.trim() || result.stdout.trim();
    if (detail && isSessionRefreshFailure(detail)) {
      throw new Error(
        `veo-useapi native command timed out: session refresh failed. ` +
        `Update Google-flow cookies for the Veo CLI and retry (cookie hint: ${join(options.cwd, 'cookie.json')}, docs: https://useapi.net/docs/start-here/setup-google-flow). ` +
        `Original output: ${detail}`,
      );
    }
    throw new Error(
      `veo-native command timed out. ` +
      `Check Veo CLI runtime health and refresh Google-flow cookies if needed (cookie hint: ${join(options.cwd, 'cookie.json')}, docs: https://useapi.net/docs/start-here/setup-google-flow)` +
      `${detail ? `: ${detail}` : ''}`,
    );
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}${result.signal ? ` (${result.signal})` : ''}`;
    if (isSessionRefreshFailure(detail)) {
      throw new Error(
        `veo-useapi native command failed: session refresh failed. ` +
        `Update Google-flow cookies for the Veo CLI and retry (cookie hint: ${join(options.cwd, 'cookie.json')}, docs: https://useapi.net/docs/start-here/setup-google-flow). ` +
        `Original output: ${detail}`,
      );
    }
    throw new Error(`veo-useapi native command failed: ${detail}`);
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function captureNewOutputs(
  outputDir: string,
  before: string[],
  startedAt: number,
): Promise<string[]> {
  const after = await listFiles(outputDir);
  const beforeSet = new Set(before);
  const added = after.filter((path) => !beforeSet.has(path));
  if (added.length > 0) return added;

  const recent: string[] = [];
  for (const path of after) {
    const fileStat = await stat(path);
    if (fileStat.mtimeMs >= startedAt) {
      recent.push(path);
    }
  }
  return recent;
}

export async function submitVeoUseApiNative(
  payload: VideoExecutionPayload,
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{
  externalJobId: string;
  rawResult: unknown;
}> {
  const env = await loadWorkspaceEnv(payload.workspaceRoot, options.env ?? process.env);
  const cliRoot = veoCliRoot(payload.workspaceRoot, env);
  ensureVeoCliEntry(cliRoot);
  const outputDir = veoOutputDir(payload.workspaceRoot, env);
  await mkdir(outputDir, { recursive: true });
  const externalJobId = `veo-useapi-${Date.now()}`;
  const outputs: VideoExecutionPollResult['outputs'] = [];

  for (const task of payload.tasks) {
    const before = await listFiles(outputDir);
    const startedAt = Date.now();
    const commandResult = await runVeoCommand(
      [
        'run',
        'flow.ts',
        '-p',
        buildPrompt(task),
        '-n',
        String(payload.executionProfile.outputCount),
        '-r',
        veoRatio(payload.executionProfile.aspectRatio),
        '-m',
        payload.executionProfile.quality,
        '--backend',
        'useapi',
        '--yes',
      ],
      {
        cwd: cliRoot,
        env,
      },
    );
    const newOutputs = await captureNewOutputs(outputDir, before, startedAt);
    if (newOutputs.length === 0) {
      const stdout = commandResult.stdout.trim();
      const stderr = commandResult.stderr.trim();
      const detail = stderr || stdout;
      if (detail && isSessionRefreshFailure(detail)) {
        throw new Error(
          `veo-useapi native transport did not produce an output file for scene ${task.sceneIndex} because session refresh failed. ` +
          `Update Google-flow cookies for the Veo CLI and retry (cookie hint: ${join(cliRoot, 'cookie.json')}, docs: https://useapi.net/docs/start-here/setup-google-flow). ` +
          `Original output: ${detail}`,
        );
      }
      throw new Error(
        `veo-useapi native transport did not produce an output file for scene ${task.sceneIndex} (cliRoot=${cliRoot}, outputDir=${outputDir})${detail ? `; command output: ${detail}` : ''}.`,
      );
    }
    outputs.push({
      id: `generated-scene-${task.sceneIndex}`,
      kind: 'video',
      path: newOutputs[0],
      sceneIndex: task.sceneIndex,
      backend: 'veo-useapi',
    });
  }

  await writeJobState({
    externalJobId,
    routeId: 'veo-useapi',
    outputDir: payload.outputDir,
    createdAt: new Date().toISOString(),
    outputs,
  });

  return {
    externalJobId,
    rawResult: {
      externalJobId,
      outputs,
    },
  };
}

export async function pollVeoUseApiNative(
  input: {
    outputDir: string;
    externalJobId: string;
  },
): Promise<VideoExecutionPollResult> {
  const state = await readJobState(input.outputDir, input.externalJobId);
  return {
    status: 'completed',
    externalJobId: input.externalJobId,
    outputs: state.outputs,
    issues: [],
    rawResult: state,
  };
}
