import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { PREVIEW_PORTAL_TEMPLATE_REGISTRY } from './templates.js';
import type {
  PreviewPortalAsset,
  PreviewPortalCard,
  PreviewPortalProject,
  PreviewPortalStatus,
  PreviewPortalTemplateId,
} from './types.js';

export interface DiscoverPreviewPortalProjectOptions {
  root: string;
  projectSlug: string;
  runId?: string;
  client?: string | null;
  template?: PreviewPortalTemplateId;
  status?: PreviewPortalStatus;
}

export interface DiscoverPreviewPortalPortfolioOptions {
  root: string;
  client?: string | null;
  limit?: number;
}

export async function discoverPreviewPortalProject(
  options: DiscoverPreviewPortalProjectOptions,
): Promise<PreviewPortalProject> {
  const projectDir = join(options.root, 'projects', options.projectSlug);
  const manifest = await readProjectJson(projectDir);
  const template = options.template ?? templateFromManifest(manifest) ?? 'generic-video';
  const now = new Date().toISOString();
  const assets = await discoverAssets(projectDir);
  const status = options.status ?? 'draft';
  const summary = stringValue(manifest?.summary) ?? stringValue(manifest?.intent);
  const client = options.client ?? clientFromManifest(manifest);
  return {
    client,
    slug: options.projectSlug,
    title: stringValue(manifest?.title) ?? titleFromSlug(options.projectSlug),
    template,
    status,
    projectDir,
    run: {
      runId: options.runId ?? 'run-001',
      label: options.runId ?? 'run-001',
      status,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      approvedAt: null,
      declinedAt: null,
    },
    ...(summary ? { summary } : {}),
    assets,
    cards: buildCards(assets),
  };
}

export async function discoverPreviewPortalPortfolio(
  options: DiscoverPreviewPortalPortfolioOptions,
): Promise<PreviewPortalProject[]> {
  const projectsDir = join(options.root, 'projects');
  if (!existsSync(projectsDir)) return [];
  const entries = await readdir(projectsDir, { withFileTypes: true });
  const projects: PreviewPortalProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'clients') continue;
    try {
      const project = await discoverPreviewPortalProject({
        root: options.root,
        projectSlug: entry.name,
      });
      if (options.client && normalizeClient(project.client) !== normalizeClient(options.client)) continue;
      projects.push(project);
    } catch {
      // A portfolio index should skip broken folders instead of blocking every other project.
    }
  }
  return projects
    .sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt) || a.title.localeCompare(b.title))
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

async function readProjectJson(projectDir: string): Promise<Record<string, unknown> | null> {
  const path = join(projectDir, 'project.json');
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

async function discoverAssets(projectDir: string): Promise<PreviewPortalAsset[]> {
  const dirs = ['final', 'videos', 'images', 'characters', 'audio', 'prompts', 'variants'];
  const out: PreviewPortalAsset[] = [];
  for (const dir of dirs) {
    const absoluteDir = join(projectDir, dir);
    if (!existsSync(absoluteDir)) continue;
    for (const path of await listFiles(absoluteDir)) {
      const info = await stat(path);
      const rel = relative(projectDir, path).replaceAll('\\', '/');
      out.push({
        id: rel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, ''),
        path: rel,
        kind: kindFromPath(rel),
        label: labelFromPath(rel),
        section: dir,
        sizeBytes: info.size,
        exists: true,
      });
    }
  }
  out.push(...await discoverGenerationInputAssets(projectDir));
  out.push(...await discoverPromptPacketAssets(projectDir));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function discoverPromptPacketAssets(projectDir: string): Promise<PreviewPortalAsset[]> {
  const path = join(projectDir, 'artifacts', 'filmmaking-prompts.json');
  if (!existsSync(path)) return [];
  const info = await stat(path);
  return [{
    id: 'filmmaking-prompts',
    path: 'artifacts/filmmaking-prompts.json',
    kind: 'json',
    label: 'Filmmaking Prompt Packet',
    section: 'prompt-packets',
    sizeBytes: info.size,
    exists: true,
  }];
}

async function discoverGenerationInputAssets(projectDir: string): Promise<PreviewPortalAsset[]> {
  const manifestPath = join(projectDir, 'artifacts', 'asset-manifest.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as {
    assets?: Array<{
      id?: unknown;
      kind?: unknown;
      path?: unknown;
      sceneIndex?: unknown;
      backend?: unknown;
    }>;
  };
  const projectRoot = resolve(projectDir);
  const out: PreviewPortalAsset[] = [];
  for (const asset of manifest.assets ?? []) {
    if (asset.kind !== 'image' || typeof asset.path !== 'string' || !asset.path.trim()) continue;
    const localPath = resolveAssetPath(projectRoot, asset.path);
    if (!localPath || !existsSync(localPath)) continue;
    const rel = relative(projectRoot, localPath).replaceAll('\\', '/');
    const info = await stat(localPath);
    const sceneLabel = typeof asset.sceneIndex === 'number' ? `Scene ${asset.sceneIndex}` : 'Scene input';
    const backend = typeof asset.backend === 'string' && asset.backend.trim() ? asset.backend.trim() : null;
    out.push({
      id: `generation-inputs-${String(asset.id ?? rel).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      path: rel,
      kind: 'image',
      label: backend?.includes('seedance')
        ? `${sceneLabel} · Seedance input`
        : `${sceneLabel} · Generation input`,
      section: 'generation-inputs',
      sizeBytes: info.size,
      exists: true,
    });
  }
  return out;
}

function resolveAssetPath(projectRoot: string, value: string): string | null {
  const projectSlug = basename(projectRoot);
  const normalized = value.replaceAll('\\', '/');
  const projectScopedPrefix = `projects/${projectSlug}/`;
  const localValue = normalized.startsWith(projectScopedPrefix)
    ? normalized.slice(projectScopedPrefix.length)
    : normalized;
  const path = isAbsolute(localValue) ? resolve(localValue) : resolve(projectRoot, localValue);
  const rel = relative(projectRoot, path);
  if (rel.startsWith('..') || rel === '' || rel.startsWith('/')) return null;
  return path;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    if (entry.isFile()) out.push(path);
  }
  return out;
}

function buildCards(assets: PreviewPortalAsset[]): PreviewPortalCard[] {
  const finals = assets.filter((asset) => asset.section === 'final' && asset.kind === 'video');
  const scenes = assets.filter((asset) => asset.section === 'videos' && asset.kind === 'video');
  const images = assets.filter((asset) => asset.section === 'images' && asset.kind === 'image');
  return [
    ...finals.map((asset, index) => ({
      id: asset.id,
      kind: 'final' as const,
      title: index === 0 ? 'Final cut' : labelFromPath(asset.path),
      subtitle: asset.path,
      assetIds: [asset.id],
      reviewable: true,
    })),
    ...scenes.map((asset) => ({
      id: asset.id,
      kind: 'scene' as const,
      title: labelFromPath(asset.path),
      subtitle: asset.path,
      assetIds: [asset.id],
      reviewable: true,
    })),
    ...images.map((asset) => ({
      id: asset.id,
      kind: 'asset' as const,
      title: labelFromPath(asset.path),
      subtitle: asset.path,
      assetIds: [asset.id],
      reviewable: false,
    })),
  ];
}

function kindFromPath(path: string): PreviewPortalAsset['kind'] {
  const lower = path.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)$/.test(lower)) return 'image';
  if (/\.(mp4|mov|webm)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a|aac)$/.test(lower)) return 'audio';
  if (/\.html$/.test(lower)) return 'html';
  if (/\.json$/.test(lower)) return 'json';
  if (/\.(txt|md)$/.test(lower)) return 'text';
  return 'other';
}

function templateFromManifest(manifest: Record<string, unknown> | null): PreviewPortalTemplateId | null {
  const raw = stringValue(manifest?.template) ?? stringValue(manifest?.previewTemplate);
  if (!raw) return null;
  // Validate against the template registry (single source of truth) so a newly
  // added template is recognized here automatically instead of being silently
  // downgraded to 'generic-video' by a stale hardcoded allowlist.
  if (Object.prototype.hasOwnProperty.call(PREVIEW_PORTAL_TEMPLATE_REGISTRY, raw)) {
    return raw as PreviewPortalTemplateId;
  }
  return null;
}

function clientFromManifest(manifest: Record<string, unknown> | null): string | null {
  return stringValue(manifest?.client)
    ?? stringValue(manifest?.clientName)
    ?? stringValue(manifest?.owner)
    ?? null;
}

function normalizeClient(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function labelFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
