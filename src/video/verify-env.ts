import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { buildProviderStatusReport } from './provider-status.js';

interface EnvVarStatus {
  name: string;
  required: boolean;
  present: boolean;
  source: 'process' | '.env.local' | '.env' | 'missing';
}

interface DependencyStatus {
  name: string;
  available: boolean;
  path?: string;
}

export interface VideoEnvironmentReport {
  generatedAt: string;
  workspaceRoot: string;
  envSources: string[];
  envVars: EnvVarStatus[];
  geminiKeyPool: {
    count: number;
    recommended: number;
    ok: boolean;
  };
  localDependencies: DependencyStatus[];
  build: {
    path: string;
    exists: boolean;
    ageHours?: number;
    fresh?: boolean;
  };
  providers: ReturnType<typeof buildProviderStatusReport>;
  blockingIssues: string[];
  warnings: string[];
  ok: boolean;
}

interface BuildVideoEnvironmentReportOptions {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  probeExecutable?: (name: string) => string | undefined;
}

function readDotEnvLikeFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  const raw = readFileSync(path, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    out[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function findExecutable(name: string): string | undefined {
  try {
    const resolved = execFileSync('which', [name], { encoding: 'utf-8' }).trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

function countGeminiKeys(env: Record<string, string | undefined>): number {
  const sources = [
    env.GEMINI_API_KEYS,
    env.GOOGLE_API_KEYS,
    env.GOOGLE_API_KEY,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const seen = new Set<string>();
  for (const source of sources) {
    for (const raw of source.split(/[,;\n\s]+/)) {
      const key = raw.trim();
      if (!key) continue;
      seen.add(key);
    }
  }
  return seen.size;
}

export function buildVideoEnvironmentReport(
  options: BuildVideoEnvironmentReportOptions = {},
): VideoEnvironmentReport {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const now = options.now ?? new Date();
  const probe = options.probeExecutable ?? findExecutable;
  const envPath = join(workspaceRoot, '.env');
  const envLocalPath = join(workspaceRoot, '.env.local');
  const envFile = readDotEnvLikeFile(envPath);
  const envLocalFile = readDotEnvLikeFile(envLocalPath);
  const mergedEnv = {
    ...envFile,
    ...envLocalFile,
    ...(options.env ?? process.env),
  };

  const envSources = [envPath, envLocalPath].filter((path) => existsSync(path));
  const requiredEnvVars = ['GOOGLE_API_KEY', 'GO_BANANAS_API_KEY', 'SUTUI_API_KEY'];
  const optionalEnvVars = ['GEMINI_API_KEYS', 'GOOGLE_API_KEYS', 'ELEVENLABS_API_KEY'];
  const envVars: EnvVarStatus[] = [...requiredEnvVars, ...optionalEnvVars].map((name) => {
    const present = Boolean(mergedEnv[name]?.trim());
    let source: EnvVarStatus['source'] = 'missing';
    if (present) {
      if ((options.env ?? process.env)[name]) {
        source = 'process';
      } else if (Object.prototype.hasOwnProperty.call(envLocalFile, name)) {
        source = '.env.local';
      } else if (Object.prototype.hasOwnProperty.call(envFile, name)) {
        source = '.env';
      }
    }
    return {
      name,
      required: requiredEnvVars.includes(name),
      present,
      source,
    };
  });

  const geminiKeyPoolCount = countGeminiKeys(mergedEnv);
  const localDependencyNames = ['node', 'npm', 'python3', 'ffmpeg', 'ffprobe', 'curl', 'bun'];
  const localDependencies: DependencyStatus[] = localDependencyNames.map((name) => ({
    name,
    available: Boolean(probe(name)),
    path: probe(name),
  }));

  const buildPath = join(workspaceRoot, 'dist', 'cli', 'vclaw.js');
  const buildExists = existsSync(buildPath);
  const buildAgeHours = buildExists
    ? Math.max(0, Math.floor((now.getTime() - statSync(buildPath).mtime.getTime()) / 3_600_000))
    : undefined;
  const buildFresh = buildAgeHours !== undefined ? buildAgeHours < 24 : undefined;

  const providers = buildProviderStatusReport({
    workspaceRoot,
    env: mergedEnv,
    now,
    probeExecutable: (name) => probe(name),
  });

  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  for (const envVar of envVars) {
    if (envVar.required && !envVar.present) {
      blockingIssues.push(`Missing required environment variable: ${envVar.name}`);
    }
  }

  for (const dependency of localDependencies) {
    if (['node', 'npm', 'python3', 'ffmpeg', 'ffprobe', 'curl'].includes(dependency.name) && !dependency.available) {
      blockingIssues.push(`Missing required local dependency: ${dependency.name}`);
    }
  }

  if (!buildExists) {
    blockingIssues.push('Build output missing: dist/cli/vclaw.js');
  } else if (buildFresh === false) {
    warnings.push(`Build output is ${buildAgeHours}h old; run npm run build if the code changed.`);
  }

  if (geminiKeyPoolCount === 0) {
    warnings.push('No Gemini key pool detected; director decomposition will rely on GOOGLE_API_KEY only.');
  } else if (geminiKeyPoolCount < 3) {
    warnings.push(`Gemini key pool size is ${geminiKeyPoolCount}; recommend 3+ keys for longer director runs.`);
  }

  for (const route of providers.routes) {
    if (route.availability === 'unavailable' && route.routeId === 'seedance-direct') {
      blockingIssues.push(`Route ${route.routeId} unavailable: ${route.issues.join('; ')}`);
    } else if (route.availability !== 'available') {
      warnings.push(`Route ${route.routeId} is ${route.availability}: ${route.issues.join('; ') || route.notes.join('; ')}`);
    }
  }

  return {
    generatedAt: now.toISOString(),
    workspaceRoot,
    envSources,
    envVars,
    geminiKeyPool: {
      count: geminiKeyPoolCount,
      recommended: 3,
      ok: geminiKeyPoolCount >= 3,
    },
    localDependencies,
    build: {
      path: buildPath,
      exists: buildExists,
      ...(buildAgeHours !== undefined ? { ageHours: buildAgeHours } : {}),
      ...(buildFresh !== undefined ? { fresh: buildFresh } : {}),
    },
    providers,
    blockingIssues,
    warnings,
    ok: blockingIssues.length === 0,
  };
}
