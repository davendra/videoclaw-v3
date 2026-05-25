/**
 * MCP tool implementations for videoclaw.
 *
 * All READ-ONLY. Agents use the CLI for writes. Each tool wraps an
 * existing src/video/* function and returns a plain-JSON-serializable
 * object (MCP tools return content as JSON).
 *
 * Signatures wrapped (real, verified):
 *  - buildProjectIndex(root, productionMode) -> VideoProjectIndex
 *  - buildProjectStatusReport(slug, root, productionMode) -> VideoProjectStatusReport
 *  - buildProviderStatusReport({ workspaceRoot }) -> VideoProviderStatusReport
 *  - readProjectEvents(workspace) -> VideoProjectEvent[]
 *  - resolveProjectWorkspace(slug, root) -> VideoProjectWorkspace
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { buildProjectIndex } from '../video/project-index.js';
import { buildProjectStatusReport } from '../video/status.js';
import { buildProviderStatusReport } from '../video/provider-status.js';
import { readProjectEvents } from '../video/events.js';
import { resolveProjectWorkspace } from '../video/workspace.js';

export interface ListProjectsInput {
  root?: string;
}

export async function listProjectsTool(
  input: ListProjectsInput,
): Promise<{ projects: unknown[] }> {
  const root = input.root ?? process.cwd();
  const index = await buildProjectIndex(root);
  return { projects: index.projects ?? [] };
}

export interface GetProjectStatusInput {
  root?: string;
  slug: string;
}

export async function getProjectStatusTool(
  input: GetProjectStatusInput,
): Promise<{ found: boolean; status?: unknown }> {
  const root = input.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(input.slug, root);
  if (!existsSync(workspace.projectDir)) {
    return { found: false };
  }
  const status = await buildProjectStatusReport(input.slug, root);
  return { found: status.projectExists, status };
}

export interface GetArtifactsInput {
  root?: string;
  slug: string;
}

export async function getArtifactsTool(
  input: GetArtifactsInput,
): Promise<{ found: boolean; artifacts: Record<string, unknown> }> {
  const root = input.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(input.slug, root);
  if (!existsSync(workspace.projectDir)) {
    return { found: false, artifacts: {} };
  }
  // Use the status report's discovered artifact file list (absolute paths)
  // to avoid duplicating directory-scan logic.
  const status = await buildProjectStatusReport(input.slug, root);
  const artifacts: Record<string, unknown> = {};
  for (const filePath of status.artifactFiles) {
    const name = basename(filePath).replace(/\.json$/i, '');
    try {
      artifacts[name] = JSON.parse(await readFile(filePath, 'utf-8'));
    } catch {
      // Skip unreadable / non-JSON artifact files rather than throwing.
    }
  }
  return { found: true, artifacts };
}

export interface GetEventLogInput {
  root?: string;
  slug: string;
  limit?: number;
}

export async function getEventLogTool(
  input: GetEventLogInput,
): Promise<{ found: boolean; events: unknown[] }> {
  const root = input.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(input.slug, root);
  if (!existsSync(workspace.projectDir)) {
    return { found: false, events: [] };
  }
  const events = await readProjectEvents(workspace);
  const limit = input.limit;
  const sliced =
    typeof limit === 'number' && limit > 0 && limit < events.length
      ? events.slice(events.length - limit)
      : events;
  return { found: true, events: sliced };
}

export interface ListProviderRoutesInput {
  root?: string;
}

export async function listProviderRoutesTool(
  input: ListProviderRoutesInput,
): Promise<{ routes: Array<{ routeId: string; availability: string }> }> {
  const report = buildProviderStatusReport(
    input.root ? { workspaceRoot: input.root } : {},
  );
  return {
    routes: report.routes.map((route) => ({
      routeId: route.routeId,
      availability: route.availability,
    })),
  };
}
