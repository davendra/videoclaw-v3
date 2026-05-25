#!/usr/bin/env node
import { spawn } from 'node:child_process';
import type { ProviderRouteId } from '../video/provider-platform/types.js';
import { runBuiltinProviderAdapter } from '../video/provider-adapter-runner.js';

function parseFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function routeCommandEnvVars(routeId: ProviderRouteId): { submit: string; poll: string; cancel: string } {
  switch (routeId) {
    case 'seedance-direct':
      return {
        submit: 'VCLAW_SEEDANCE_DIRECT_SUBMIT_CMD',
        poll: 'VCLAW_SEEDANCE_DIRECT_POLL_CMD',
        cancel: 'VCLAW_SEEDANCE_DIRECT_CANCEL_CMD',
      };
    case 'veo-useapi':
      return {
        submit: 'VCLAW_VEO_USEAPI_SUBMIT_CMD',
        poll: 'VCLAW_VEO_USEAPI_POLL_CMD',
        cancel: 'VCLAW_VEO_USEAPI_CANCEL_CMD',
      };
    case 'runway-useapi':
      return {
        submit: 'VCLAW_RUNWAY_USEAPI_SUBMIT_CMD',
        poll: 'VCLAW_RUNWAY_USEAPI_POLL_CMD',
        cancel: 'VCLAW_RUNWAY_USEAPI_CANCEL_CMD',
      };
    default:
      throw new Error(`No built-in adapter is implemented for route ${routeId}.`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function runCommand(command: string, input: unknown): Promise<string> {
  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn('sh', ['-lc', command], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `adapter command exited with code ${result.code}`);
  }
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const route = parseFlagValue(args, '--route') as ProviderRouteId | undefined;
  if (!route) {
    throw new Error('provider-adapter requires --route <route-id>');
  }

  const rawInput = await readStdin();
  const input = rawInput.trim() ? JSON.parse(rawInput) as Record<string, unknown> : {};
  const envVars = routeCommandEnvVars(route);
  const action = input.action === 'poll' ? 'poll' : input.action === 'cancel' ? 'cancel' : 'submit';
  const command = process.env[action === 'poll' ? envVars.poll : action === 'cancel' ? envVars.cancel : envVars.submit];
  if (command) {
    const stdout = await runCommand(command, input);
    process.stdout.write(stdout ? `${stdout}\n` : '\n');
    return;
  }

  const result = await runBuiltinProviderAdapter(route, input, { env: process.env });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
