import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeTextFileAtomic } from '../atomic-write.js';
import { appendPreviewPortalAuditEvent } from './audit.js';
import { discoverPreviewPortalPortfolio, discoverPreviewPortalProject } from './discovery.js';
import { renderPreviewPortalHtml, renderPreviewPortalIndexHtml } from './render.js';
import type { PreviewPortalSurface } from './types.js';

export interface GeneratePreviewPortalSurfacesOptions {
  root: string;
  projectSlug: string;
  runId?: string;
  client?: string | null;
  surfaces?: PreviewPortalSurface[];
}

export interface GeneratePreviewPortalSurfacesResult {
  projectSlug: string;
  outputs: Array<{ surface: PreviewPortalSurface; path: string }>;
}

export interface GeneratePreviewPortalIndexOptions {
  root: string;
  client?: string | null;
  outputPath?: string;
  linkMode?: 'local' | 'published-run';
}

export interface GeneratePreviewPortalIndexResult {
  client?: string | null;
  projectCount: number;
  outputPath: string;
}

export async function generatePreviewPortalSurfaces(
  options: GeneratePreviewPortalSurfacesOptions,
): Promise<GeneratePreviewPortalSurfacesResult> {
  const project = await discoverPreviewPortalProject(options);
  const surfaces = options.surfaces ?? ['edit', 'review', 'client-review', 'preview'];
  const outputs: Array<{ surface: PreviewPortalSurface; path: string }> = [];
  for (const surface of surfaces) {
    const html = renderPreviewPortalHtml({ surface, project });
    const outputPath = join(project.projectDir, fileNameForSurface(surface));
    await writeTextFileAtomic(outputPath, html);
    outputs.push({ surface, path: outputPath });
    await appendPreviewPortalAuditEvent(join(project.projectDir, 'project-audit.jsonl'), {
      timestamp: new Date().toISOString(),
      event: 'surface.generated',
      client: project.client,
      project: project.slug,
      run: project.run.runId,
      surface,
      template: project.template,
      output: fileNameForSurface(surface),
      assetCount: project.assets.length,
      status: project.status,
    });
  }
  return { projectSlug: project.slug, outputs };
}

export async function generatePreviewPortalIndex(
  options: GeneratePreviewPortalIndexOptions,
): Promise<GeneratePreviewPortalIndexResult> {
  const projects = await discoverPreviewPortalPortfolio({
    root: options.root,
    ...(options.client ? { client: options.client } : {}),
  });
  const outputPath = options.outputPath ?? defaultIndexPath(options.root, options.client);
  const html = renderPreviewPortalIndexHtml({
    projects,
    client: options.client ?? null,
    title: options.client ? `${options.client} Review Index` : 'Videoclaw Review Index',
    linkPrefix: options.client ? '../../' : '',
    linkMode: options.linkMode ?? 'local',
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeTextFileAtomic(outputPath, html);
  return {
    client: options.client ?? null,
    projectCount: projects.length,
    outputPath,
  };
}

function fileNameForSurface(surface: PreviewPortalSurface): string {
  if (surface === 'edit') return 'edit.html';
  if (surface === 'client-review') return 'client-review.html';
  if (surface === 'review') return 'review.html';
  if (surface === 'compare') return 'compare.html';
  if (surface === 'index') return 'index.html';
  return 'preview.html';
}

function defaultIndexPath(root: string, client: string | null | undefined): string {
  if (!client) return join(root, 'projects', 'index.html');
  return join(root, 'projects', 'clients', slugifyClient(client), 'index.html');
}

function slugifyClient(client: string): string {
  return client
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'client';
}
