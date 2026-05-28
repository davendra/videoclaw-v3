import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { PreviewPortalSurface } from './types.js';
import { discoverPreviewPortalPortfolio } from './discovery.js';
import { renderPreviewPortalIndexHtml } from './render.js';

const execFileAsync = promisify(execFile);

export interface BuildPreviewPortalPublishPlanOptions {
  projectDir: string;
  client: string;
  projectSlug: string;
  runId: string;
  surface: PreviewPortalSurface;
  bucket: string;
  publicBaseUrl?: string | null;
}

export interface PreviewPortalPublishItem {
  localPath: string;
  remoteKey: string;
  contentType: string;
  sha256: string;
  publicUrl?: string;
}

export interface PreviewPortalPublishPlan {
  bucket: string;
  publicPrefix: string;
  surface: PreviewPortalSurface;
  publicUrl?: string;
  items: PreviewPortalPublishItem[];
}

export interface PublishPreviewPortalOptions extends BuildPreviewPortalPublishPlanOptions {
  dryRun?: boolean;
  wranglerBin?: string;
}

export interface PublishPreviewPortalIndexOptions {
  root: string;
  bucket: string;
  client?: string | null;
  publicBaseUrl?: string | null;
  dryRun?: boolean;
  wranglerBin?: string;
}

export interface PreviewPortalPublishResult {
  dryRun: boolean;
  plan: PreviewPortalPublishPlan;
  uploaded: Array<{ remoteKey: string; localPath: string }>;
}

export async function buildPreviewPortalPublishPlan(
  options: BuildPreviewPortalPublishPlanOptions,
): Promise<PreviewPortalPublishPlan> {
  const htmlFile = surfaceFileName(options.surface);
  const htmlPath = join(options.projectDir, htmlFile);
  const html = await readFile(htmlPath, 'utf-8');
  const refs = [...new Set([htmlFile, ...extractLocalRefs(html)])];
  const projectRoot = resolve(options.projectDir);
  const publicPrefix = `clients/${slugify(options.client)}/${slugify(options.projectSlug)}/runs/${slugify(options.runId)}`;
  const items: PreviewPortalPublishItem[] = [];
  for (const ref of refs) {
    const cleanRef = ref.replace(/^\.\//, '');
    const localPath = resolve(projectRoot, cleanRef);
    const rel = relative(projectRoot, localPath);
    if (rel.startsWith('..') || rel === '' || rel.startsWith('/') || !existsSync(localPath)) continue;
    const remoteKey = `${publicPrefix}/${rel.replaceAll('\\', '/')}`;
    items.push({
      localPath,
      remoteKey,
      contentType: contentTypeForPath(rel),
      sha256: await sha256File(localPath),
      ...(options.publicBaseUrl ? { publicUrl: publicUrlFor(options.publicBaseUrl, remoteKey) } : {}),
    });
  }
  const htmlRemoteKey = `${publicPrefix}/${htmlFile}`;
  return {
    bucket: options.bucket,
    publicPrefix,
    surface: options.surface,
    ...(options.publicBaseUrl ? { publicUrl: publicUrlFor(options.publicBaseUrl, htmlRemoteKey) } : {}),
    items,
  };
}

export async function publishPreviewPortal(
  options: PublishPreviewPortalOptions,
): Promise<PreviewPortalPublishResult> {
  const plan = await buildPreviewPortalPublishPlan(options);
  if (options.dryRun) {
    return { dryRun: true, plan, uploaded: [] };
  }
  const uploaded = await uploadPreviewPortalPlan(plan, options.wranglerBin);
  return { dryRun: false, plan, uploaded };
}

export async function publishPreviewPortalIndex(
  options: PublishPreviewPortalIndexOptions,
): Promise<PreviewPortalPublishResult> {
  const projects = await discoverPreviewPortalPortfolio({
    root: options.root,
    ...(options.client ? { client: options.client } : {}),
  });
  const html = renderPreviewPortalIndexHtml({
    projects,
    client: options.client ?? null,
    title: options.client ? `${options.client} Review Index` : 'Videoclaw Review Index',
    linkMode: 'published-run',
  });
  const tempDir = await mkdtemp(join(tmpdir(), 'vclaw-portal-index-'));
  const localPath = join(tempDir, 'index.html');
  await writeFile(localPath, html, 'utf-8');
  const remoteKey = options.client ? `clients/${slugify(options.client)}/index.html` : 'index.html';
  const plan: PreviewPortalPublishPlan = {
    bucket: options.bucket,
    publicPrefix: options.client ? `clients/${slugify(options.client)}` : '',
    surface: 'index',
    ...(options.publicBaseUrl ? { publicUrl: publicUrlFor(options.publicBaseUrl, remoteKey) } : {}),
    items: [{
      localPath,
      remoteKey,
      contentType: 'text/html; charset=utf-8',
      sha256: await sha256File(localPath),
      ...(options.publicBaseUrl ? { publicUrl: publicUrlFor(options.publicBaseUrl, remoteKey) } : {}),
    }],
  };
  if (options.dryRun) {
    return { dryRun: true, plan, uploaded: [] };
  }
  const uploaded = await uploadPreviewPortalPlan(plan, options.wranglerBin);
  return { dryRun: false, plan, uploaded };
}

function extractLocalRefs(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const raw = match[1]?.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('data:')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    refs.push(raw.split('#')[0]?.split('?')[0] ?? raw);
  }
  return refs;
}

function surfaceFileName(surface: PreviewPortalSurface): string {
  if (surface === 'edit') return 'edit.html';
  if (surface === 'review') return 'review.html';
  if (surface === 'client-review') return 'client-review.html';
  if (surface === 'compare') return 'compare.html';
  if (surface === 'index') return 'index.html';
  return 'preview.html';
}

async function uploadPreviewPortalPlan(
  plan: PreviewPortalPublishPlan,
  wranglerBin?: string,
): Promise<Array<{ remoteKey: string; localPath: string }>> {
  const uploaded: Array<{ remoteKey: string; localPath: string }> = [];
  for (const item of plan.items) {
    await execFileAsync(wranglerBin ?? 'wrangler', [
      'r2',
      'object',
      'put',
      `${plan.bucket}/${item.remoteKey}`,
      '--file',
      item.localPath,
      '--content-type',
      item.contentType,
      '--remote',
    ], { encoding: 'utf-8' });
    uploaded.push({ remoteKey: item.remoteKey, localPath: item.localPath });
  }
  return uploaded;
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function publicUrlFor(baseUrl: string, remoteKey: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${remoteKey.split('/').map(encodeURIComponent).join('/')}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}
