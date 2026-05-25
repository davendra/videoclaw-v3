import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DEFAULT_PROVIDER_REGISTRY } from './provider-platform/registry.js';
import type { ProviderRouteId } from './provider-platform/types.js';
import type {
  VideoProviderRouteStatusReport,
  VideoProviderRuntimeDependencyStatus,
  VideoProviderStatusReport,
} from './types.js';

type ExecutableName = VideoProviderRuntimeDependencyStatus['name'];

interface BuildProviderStatusReportOptions {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  probeExecutable?: (name: ExecutableName) => string | undefined;
  ignoreRuntimeDependencyIssues?: boolean;
}

const ROUTE_REQUIRED_ENV_VARS: Record<ProviderRouteId, string[]> = {
  'veo-direct': [],
  'veo-useapi': ['USEAPI_API_TOKEN', 'USEAPI_ACCOUNT_EMAIL'],
  'seedance-direct': ['SUTUI_API_KEY'],
  'runway-useapi': ['USEAPI_API_TOKEN', 'USEAPI_ACCOUNT_EMAIL'],
};

const ROUTE_REQUIRED_DEPENDENCIES: Record<ProviderRouteId, ExecutableName[]> = {
  'veo-direct': ['bun', 'ffmpeg'],
  'veo-useapi': ['python3', 'bun', 'ffmpeg'],
  'seedance-direct': ['python3', 'ffmpeg'],
  // runway-useapi native transport is pure Node (fetch + fs), no python/bun
  // shell-outs. ffmpeg is still useful for downstream stitching/post but is
  // not strictly required for the route itself to deliver mp4s.
  'runway-useapi': ['ffmpeg'],
};

const ROUTE_MATURITY: Record<ProviderRouteId, 'production' | 'scaffold'> = {
  'veo-direct': 'production',
  'veo-useapi': 'production',
  'seedance-direct': 'production',
  'runway-useapi': 'production',
};

const ROUTE_ADAPTER_ENV_VAR: Record<ProviderRouteId, string> = {
  'veo-direct': 'VCLAW_VEO_DIRECT_ADAPTER',
  'veo-useapi': 'VCLAW_VEO_USEAPI_ADAPTER',
  'seedance-direct': 'VCLAW_SEEDANCE_DIRECT_ADAPTER',
  'runway-useapi': 'VCLAW_RUNWAY_USEAPI_ADAPTER',
};

const ROUTE_COMMAND_ENV_VARS: Partial<Record<ProviderRouteId, string[]>> = {
  'veo-useapi': ['VCLAW_VEO_USEAPI_SUBMIT_CMD', 'VCLAW_VEO_USEAPI_POLL_CMD', 'VCLAW_VEO_BUN_BIN'],
  'seedance-direct': ['VCLAW_SEEDANCE_DIRECT_SUBMIT_CMD', 'VCLAW_SEEDANCE_DIRECT_POLL_CMD'],
  'runway-useapi': ['VCLAW_RUNWAY_USEAPI_SUBMIT_CMD', 'VCLAW_RUNWAY_USEAPI_POLL_CMD', 'VCLAW_RUNWAY_USEAPI_CANCEL_CMD'],
};

function findExecutable(command: ExecutableName): string | undefined {
  try {
    const resolved = execFileSync('which', [command], { encoding: 'utf-8' }).trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

function readDotEnvLikeFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  const raw = readFileSync(path, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    out[key.trim()] = value;
  }
  return out;
}

function hasRouteExecutionOverride(routeId: ProviderRouteId, env: Record<string, string | undefined>): boolean {
  const names = [
    ROUTE_ADAPTER_ENV_VAR[routeId],
    ...(ROUTE_COMMAND_ENV_VARS[routeId] ?? []),
  ];
  return names.some((name) => {
    const value = env[name];
    return Boolean(value && value.trim() !== '');
  });
}

export function buildProviderStatusReport(
  options: BuildProviderStatusReportOptions = {},
): VideoProviderStatusReport {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const envLocalPath = `${workspaceRoot}/.env.local`;
  const env = {
    ...readDotEnvLikeFile(envLocalPath),
    ...(options.env ?? process.env),
  };
  const now = options.now ?? new Date();
  const probe = options.probeExecutable ?? findExecutable;
  const ignoreRuntimeDependencyIssues = options.ignoreRuntimeDependencyIssues ?? false;

  const dependencyNames: ExecutableName[] = ['python3', 'bun', 'ffmpeg'];
  const runtimeDependencies: VideoProviderRuntimeDependencyStatus[] = dependencyNames.map((name) => ({
    name,
    available: Boolean(probe(name)),
    path: probe(name),
  }));
  const availableDependencies = runtimeDependencies.filter((item) => item.available).map((item) => item.name);

  const envSources: string[] = [];
  if (existsSync(envLocalPath)) {
    envSources.push(envLocalPath);
  }

  const workspaceIssues: string[] = [];
  const workspaceOk = existsSync(workspaceRoot);
  if (!workspaceOk) {
    workspaceIssues.push('Workspace root does not exist.');
  }

  const routes: VideoProviderRouteStatusReport[] = DEFAULT_PROVIDER_REGISTRY.map((route) => {
    const requiredEnvVars = ROUTE_REQUIRED_ENV_VARS[route.id];
    const availableEnvVars = requiredEnvVars.filter((name) => {
      const value = env[name];
      return Boolean(value && value.trim() !== '');
    });
    const missingEnvVars = requiredEnvVars.filter((name) => !availableEnvVars.includes(name));
    const requiredDependencies = ROUTE_REQUIRED_DEPENDENCIES[route.id];
    const executionOverride = hasRouteExecutionOverride(route.id, env);
    const dependencyOverride = executionOverride || ignoreRuntimeDependencyIssues;
    const presentDependencies = dependencyOverride
      ? [...requiredDependencies]
      : requiredDependencies.filter((name) => availableDependencies.includes(name));
    const missingDependencies = dependencyOverride
      ? []
      : requiredDependencies.filter((name) => !presentDependencies.includes(name));
    const issues: string[] = [];
    const notes = [...(route.notes ?? [])];

    if (missingEnvVars.length > 0) {
      issues.push(`Missing environment variables: ${missingEnvVars.join(', ')}`);
    }
    if (missingDependencies.length > 0) {
      issues.push(`Missing runtime dependencies: ${missingDependencies.join(', ')}`);
    }
    if (executionOverride) {
      notes.push('Execution override configured; adapter command owns route-specific runtime checks.');
    } else if (ignoreRuntimeDependencyIssues) {
      notes.push('Runtime dependency probes ignored for this explicit execution environment.');
    }
    let availability: VideoProviderRouteStatusReport['availability'] = 'available';
    if (issues.length > 0) {
      availability = 'unavailable';
    } else if (ROUTE_MATURITY[route.id] === 'scaffold') {
      availability = 'degraded';
      notes.push('Scaffold path only; keep out of default production routing.');
    }

    return {
      routeId: route.id,
      provider: route.provider,
      displayName: route.displayName,
      path: route.path,
      availability,
      maturity: ROUTE_MATURITY[route.id],
      summary: route.summary,
      supportedOperations: Array.from(
        new Set(route.operationSupport.map((support) => support.operation)),
      ),
      requiredEnvVars,
      availableEnvVars,
      missingEnvVars,
      requiredDependencies,
      availableDependencies: presentDependencies,
      missingDependencies,
      issues,
      notes,
    };
  });

  return {
    generatedAt: now.toISOString(),
    workspace: {
      root: workspaceRoot,
      ok: workspaceOk,
      issues: workspaceIssues,
    },
    envSources,
    runtimeDependencies,
    routes,
  };
}
