# Videoclaw Review Delivery Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable review and delivery portal system that generates editor review, client review, final preview, comparison, index, audit, and Cloudflare/R2 publish surfaces for videoclaw projects.

**Architecture:** Add a focused TypeScript preview subsystem under `src/video/preview-portal/`. It will discover project media, normalize it into a generic portal model, render mode-specific static HTML surfaces from shared CSS/JS, write append-only audit events, and later publish those surfaces/assets to Cloudflare R2. Existing `review-ui` remains the live app; this plan creates portable project HTML files.

**Tech Stack:** TypeScript, Node 20 ESM, `node:test`, existing `writeTextFileAtomic`, existing project workspace helpers, optional `wrangler` CLI for Cloudflare/R2 publish.

---

## File Structure

- Create `src/video/preview-portal/types.ts`: stable data contracts for clients, projects, runs, surfaces, assets, cards, templates, audit events, publish reports, and feedback payloads.
- Create `src/video/preview-portal/discovery.ts`: filesystem discovery that reads a project directory and returns normalized media/assets without requiring a generated artifact.
- Create `src/video/preview-portal/templates.ts`: template registry for `music-video`, `story-film`, `documentary`, `product-ad`, `sports-recap`, and `generic-video`.
- Create `src/video/preview-portal/render.ts`: HTML renderer for `review.html`, `client-review.html`, `preview.html`, `compare.html`, and `index.html`.
- Create `src/video/preview-portal/shared-assets.ts`: shared CSS/JS strings for TOC, lightbox, downloads, editor review controls, client feedback controls, and timestamp comments.
- Create `src/video/preview-portal/audit.ts`: append-only JSONL event writer/reader.
- Create `src/video/preview-portal/publish.ts`: R2 publish manifest builder and `wrangler r2 object put` runner.
- Create `src/video/preview-portal/index.ts`: public functions used by CLI and tests.
- Modify `src/cli/vclaw.ts`: add CLI handlers for `video portal`, `video publish-preview`, and `client index`.
- Modify `src/video/cli-schema.ts`: expose the new agent-friendly commands in `vclaw schema --json`.
- Modify `src/index.ts`: export the preview portal API.
- Create `src/tests/preview-portal.test.ts`: unit tests for discovery/rendering/audit.
- Create `src/tests/cli-preview-portal.test.ts`: CLI dry-run and output tests.
- Update `docs/CLI_REFERENCE.md`: document commands and output contracts.
- Update `docs/PROJECT_LAYOUT.md`: document generated portal files and client manifest layout.

## Task 1: Define Portal Types

**Files:**
- Create: `src/video/preview-portal/types.ts`
- Test: `src/tests/preview-portal.test.ts`

- [ ] **Step 1: Write the failing type-level behavior test**

Add the test file with a minimal runtime assertion that the status and surface constants exist and are stable.

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREVIEW_PORTAL_STATUSES,
  PREVIEW_PORTAL_SURFACES,
  PREVIEW_PORTAL_TEMPLATES,
} from '../video/preview-portal/index.js';

describe('preview portal contracts', () => {
  it('exposes stable surface, status, and template identifiers', () => {
    assert.deepEqual(PREVIEW_PORTAL_SURFACES, [
      'review',
      'client-review',
      'preview',
      'compare',
      'index',
    ]);
    assert.ok(PREVIEW_PORTAL_STATUSES.includes('editor-review'));
    assert.ok(PREVIEW_PORTAL_STATUSES.includes('client-approved'));
    assert.ok(PREVIEW_PORTAL_TEMPLATES.includes('music-video'));
    assert.ok(PREVIEW_PORTAL_TEMPLATES.includes('story-film'));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: TypeScript compile fails because `src/video/preview-portal/index.ts` does not exist.

- [ ] **Step 3: Add `types.ts` and `index.ts`**

Create `src/video/preview-portal/types.ts`:

```ts
export const PREVIEW_PORTAL_SURFACES = [
  'review',
  'client-review',
  'preview',
  'compare',
  'index',
] as const;

export const PREVIEW_PORTAL_STATUSES = [
  'draft',
  'editor-review',
  'changes-requested',
  'client-review',
  'client-declined',
  'client-approved',
  'final',
  'published',
  'archived',
] as const;

export const PREVIEW_PORTAL_TEMPLATES = [
  'music-video',
  'story-film',
  'documentary',
  'product-ad',
  'sports-recap',
  'generic-video',
] as const;

export type PreviewPortalSurface = typeof PREVIEW_PORTAL_SURFACES[number];
export type PreviewPortalStatus = typeof PREVIEW_PORTAL_STATUSES[number];
export type PreviewPortalTemplateId = typeof PREVIEW_PORTAL_TEMPLATES[number];

export interface PreviewPortalAsset {
  id: string;
  path: string;
  kind: 'image' | 'video' | 'audio' | 'html' | 'json' | 'text' | 'other';
  label: string;
  section: string;
  sizeBytes?: number;
  exists: boolean;
}

export interface PreviewPortalCard {
  id: string;
  kind: 'character' | 'scene' | 'clip' | 'final' | 'version' | 'asset' | 'run';
  title: string;
  subtitle?: string;
  assetIds: string[];
  reviewable: boolean;
}

export interface PreviewPortalRun {
  runId: string;
  label: string;
  status: PreviewPortalStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | null;
  approvedAt?: string | null;
  declinedAt?: string | null;
}

export interface PreviewPortalProject {
  client?: string | null;
  slug: string;
  title: string;
  template: PreviewPortalTemplateId;
  status: PreviewPortalStatus;
  projectDir: string;
  run: PreviewPortalRun;
  summary?: string;
  assets: PreviewPortalAsset[];
  cards: PreviewPortalCard[];
}

export interface PreviewPortalRenderOptions {
  surface: PreviewPortalSurface;
  project: PreviewPortalProject;
  compareProjects?: PreviewPortalProject[];
}

export interface PreviewPortalAuditEvent {
  timestamp: string;
  event:
    | 'surface.generated'
    | 'surface.published'
    | 'client.feedback.copied'
    | 'editor.review.copied'
    | 'run.created'
    | 'run.promoted';
  client?: string | null;
  project: string;
  run: string;
  surface?: PreviewPortalSurface;
  template?: PreviewPortalTemplateId;
  output?: string;
  assetCount?: number;
  url?: string;
  htmlHash?: string;
  status?: PreviewPortalStatus;
}
```

Create `src/video/preview-portal/index.ts`:

```ts
export {
  PREVIEW_PORTAL_STATUSES,
  PREVIEW_PORTAL_SURFACES,
  PREVIEW_PORTAL_TEMPLATES,
} from './types.js';
export type {
  PreviewPortalAsset,
  PreviewPortalAuditEvent,
  PreviewPortalCard,
  PreviewPortalProject,
  PreviewPortalRenderOptions,
  PreviewPortalRun,
  PreviewPortalStatus,
  PreviewPortalSurface,
  PreviewPortalTemplateId,
} from './types.js';
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: PASS.

## Task 2: Discover Project Media

**Files:**
- Modify: `src/video/preview-portal/index.ts`
- Create: `src/video/preview-portal/discovery.ts`
- Modify: `src/tests/preview-portal.test.ts`

- [ ] **Step 1: Add a failing discovery test**

Append to `src/tests/preview-portal.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverPreviewPortalProject } from '../video/preview-portal/index.js';

describe('preview portal discovery', () => {
  it('discovers final videos, scene videos, images, audio, and prompts as portal assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-portal-'));
    const projectDir = join(root, 'projects', 'alpha');
    await mkdir(join(projectDir, 'final'), { recursive: true });
    await mkdir(join(projectDir, 'videos'), { recursive: true });
    await mkdir(join(projectDir, 'images'), { recursive: true });
    await mkdir(join(projectDir, 'audio'), { recursive: true });
    await mkdir(join(projectDir, 'prompts'), { recursive: true });
    await writeFile(join(projectDir, 'project.json'), JSON.stringify({
      title: 'Alpha Film',
      template: 'story-film',
      summary: 'A short narrative test.',
    }));
    await writeFile(join(projectDir, 'final', 'alpha_v1.mp4'), 'video');
    await writeFile(join(projectDir, 'videos', 'scene_01.mp4'), 'clip');
    await writeFile(join(projectDir, 'images', 'scene_01_frame.jpg'), 'image');
    await writeFile(join(projectDir, 'audio', 'narration.mp3'), 'audio');
    await writeFile(join(projectDir, 'prompts', 'scene_01.txt'), 'prompt');

    const project = await discoverPreviewPortalProject({
      root,
      projectSlug: 'alpha',
      runId: 'run-001',
    });

    assert.equal(project.slug, 'alpha');
    assert.equal(project.title, 'Alpha Film');
    assert.equal(project.template, 'story-film');
    assert.ok(project.assets.some((asset) => asset.path === 'final/alpha_v1.mp4' && asset.kind === 'video'));
    assert.ok(project.assets.some((asset) => asset.path === 'images/scene_01_frame.jpg' && asset.kind === 'image'));
    assert.ok(project.assets.some((asset) => asset.path === 'audio/narration.mp3' && asset.kind === 'audio'));
    assert.ok(project.cards.some((card) => card.kind === 'final' && card.reviewable));
    assert.ok(project.cards.some((card) => card.kind === 'scene' && card.reviewable));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: compile failure for missing `discoverPreviewPortalProject`.

- [ ] **Step 3: Implement discovery**

Create `src/video/preview-portal/discovery.ts`:

```ts
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
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

export async function discoverPreviewPortalProject(
  options: DiscoverPreviewPortalProjectOptions,
): Promise<PreviewPortalProject> {
  const projectDir = join(options.root, 'projects', options.projectSlug);
  const manifest = await readProjectJson(projectDir);
  const template = options.template ?? templateFromManifest(manifest) ?? 'generic-video';
  const now = new Date().toISOString();
  const assets = await discoverAssets(projectDir);
  return {
    client: options.client ?? null,
    slug: options.projectSlug,
    title: stringValue(manifest?.title) ?? titleFromSlug(options.projectSlug),
    template,
    status: options.status ?? 'draft',
    projectDir,
    run: {
      runId: options.runId ?? 'run-001',
      label: options.runId ?? 'run-001',
      status: options.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      approvedAt: null,
      declinedAt: null,
    },
    summary: stringValue(manifest?.summary) ?? stringValue(manifest?.intent),
    assets,
    cards: buildCards(assets),
  };
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
      const rel = relative(projectDir, path).replaceAll('\\\\', '/');
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
  return out.sort((a, b) => a.path.localeCompare(b.path));
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
  if (/\\.(jpg|jpeg|png|webp|gif)$/.test(lower)) return 'image';
  if (/\\.(mp4|mov|webm)$/.test(lower)) return 'video';
  if (/\\.(mp3|wav|m4a|aac)$/.test(lower)) return 'audio';
  if (/\\.html$/.test(lower)) return 'html';
  if (/\\.json$/.test(lower)) return 'json';
  if (/\\.(txt|md)$/.test(lower)) return 'text';
  return 'other';
}

function templateFromManifest(manifest: Record<string, unknown> | null): PreviewPortalTemplateId | null {
  const raw = stringValue(manifest?.template) ?? stringValue(manifest?.previewTemplate);
  if (!raw) return null;
  if (['music-video', 'story-film', 'documentary', 'product-ad', 'sports-recap', 'generic-video'].includes(raw)) {
    return raw as PreviewPortalTemplateId;
  }
  return null;
}

function titleFromSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function labelFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\\.[^.]+$/, '').replace(/[_-]+/g, ' ');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
```

Modify `src/video/preview-portal/index.ts`:

```ts
export { discoverPreviewPortalProject } from './discovery.js';
export type { DiscoverPreviewPortalProjectOptions } from './discovery.js';
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: PASS.

## Task 3: Render Shared HTML Surfaces

**Files:**
- Create: `src/video/preview-portal/shared-assets.ts`
- Create: `src/video/preview-portal/render.ts`
- Modify: `src/video/preview-portal/index.ts`
- Modify: `src/tests/preview-portal.test.ts`

- [ ] **Step 1: Add failing renderer tests**

Append to `src/tests/preview-portal.test.ts`:

```ts
import { renderPreviewPortalHtml } from '../video/preview-portal/index.js';

describe('preview portal renderer', () => {
  it('renders editor review controls only for review surface', async () => {
    const project = await discoverPreviewPortalProjectFixture('story-film');
    const html = renderPreviewPortalHtml({ surface: 'review', project });
    assert.match(html, /data-mode="editor"/);
    assert.match(html, /VIDEOCLAW_REVIEW_DECISIONS/);
    assert.match(html, /data-review-action="approve"/);
    assert.match(html, /data-review-action="regenerate"/);
    assert.match(html, /data-lightbox-group=/);
  });

  it('renders simple client controls for client-review surface', async () => {
    const project = await discoverPreviewPortalProjectFixture('story-film');
    const html = renderPreviewPortalHtml({ surface: 'client-review', project });
    assert.match(html, /data-mode="client"/);
    assert.match(html, /VIDEOCLAW_CLIENT_FEEDBACK/);
    assert.match(html, /data-client-action="approve"/);
    assert.match(html, /data-client-action="decline"/);
    assert.doesNotMatch(html, /data-review-action="regenerate"/);
  });

  it('renders final preview with downloads and without approval controls', async () => {
    const project = await discoverPreviewPortalProjectFixture('music-video');
    const html = renderPreviewPortalHtml({ surface: 'preview', project });
    assert.match(html, /data-mode="preview"/);
    assert.match(html, /data-downloadable/);
    assert.match(html, /function initDownloads/);
    assert.doesNotMatch(html, /data-review-action=/);
    assert.doesNotMatch(html, /data-client-action=/);
  });
});
```

Add this helper at the bottom of the test file:

```ts
async function discoverPreviewPortalProjectFixture(template: 'music-video' | 'story-film') {
  const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-portal-fixture-'));
  const projectDir = join(root, 'projects', 'fixture');
  await mkdir(join(projectDir, 'final'), { recursive: true });
  await mkdir(join(projectDir, 'videos'), { recursive: true });
  await mkdir(join(projectDir, 'images'), { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({
    title: 'Fixture Project',
    template,
    summary: 'Fixture summary.',
  }));
  await writeFile(join(projectDir, 'final', 'fixture.mp4'), 'video');
  await writeFile(join(projectDir, 'videos', 'scene_01.mp4'), 'clip');
  await writeFile(join(projectDir, 'images', 'scene_01.jpg'), 'image');
  return discoverPreviewPortalProject({ root, projectSlug: 'fixture', runId: 'run-001' });
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: compile failure for missing `renderPreviewPortalHtml`.

- [ ] **Step 3: Implement shared CSS/JS**

Create `src/video/preview-portal/shared-assets.ts` with dark Mirchi/Guardians-inspired shell, lightbox, download injection, editor controls, and client feedback.

```ts
export const PORTAL_CSS = `
:root{color-scheme:dark;--bg:#0a0a0d;--panel:#14141a;--panel2:#1a1a22;--line:#232330;--ink:#e8e6e1;--ink2:#b6b6c0;--ink3:#7a7a86;--accent:#ffb454;--good:#5fc792;--danger:#d8556a}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:radial-gradient(ellipse 1200px 600px at 50% -50px,rgba(255,180,84,.06),transparent 60%),var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:56px 32px 96px;max-width:1480px;margin:0 auto}
a{color:var(--accent);text-decoration:none}
nav.toc{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:rgba(10,10,13,.78);border-bottom:1px solid var(--line);padding:11px 16px;margin:-56px -32px 30px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;justify-content:center}
nav.toc:empty{display:none}
nav.toc a{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);padding:6px 12px;border-radius:6px}
header.hero{margin-bottom:28px}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3)}
h1{font-size:50px;font-weight:800;letter-spacing:-.02em;line-height:1.05;margin:10px 0 12px}
.sub{color:var(--ink2);font-size:16px;max-width:820px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
.stat .v{font-size:26px;font-weight:700}.stat .l{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin-top:4px}
section{margin-bottom:60px;scroll-margin-top:68px}.section-head{padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:26px}
h2{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);margin-bottom:7px}.section-title{font-size:26px;font-weight:700}.section-sub{color:var(--ink2);font-size:14px;margin-top:7px;max-width:820px}
.hero-video,.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.hero-video{padding:22px;margin:26px 0}.hero-video video{width:100%;aspect-ratio:16/9;display:block;background:#000;border-radius:12px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card video,.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#000}.card img{cursor:zoom-in}.meta{padding:12px 15px}.num{color:var(--accent);font-family:ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.12em}.title{font-size:14px;font-weight:600;margin-top:4px}.who{color:var(--ink3);font-size:11px;margin-top:5px}
.review-controls,.client-controls{padding:12px 16px;border-top:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.review-btn,.client-btn{background:#0c0c11;border:1px solid var(--line);color:var(--ink);padding:6px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer}
.review-btn[aria-pressed=true][data-review-action=approve],.client-btn[aria-pressed=true][data-client-action=approve]{background:rgba(95,199,146,.16);color:var(--good)}
.review-btn[aria-pressed=true][data-review-action=regenerate],.client-btn[aria-pressed=true][data-client-action=decline]{background:rgba(216,85,106,.16);color:var(--danger)}
.review-note,.client-note{flex:1;background:#0c0c11;border:1px solid var(--line);color:var(--ink);padding:6px 12px;border-radius:7px;font-size:11px;min-width:180px}
.hud{position:sticky;bottom:16px;margin-top:30px;background:var(--panel2);border:1px solid var(--line);border-radius:13px;padding:12px 18px;display:flex;gap:16px;align-items:center;box-shadow:0 12px 32px rgba(0,0,0,.55);font-size:13px}
.hud button{background:var(--accent);border:1px solid var(--accent);color:#0a0a0d;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;margin-left:auto}
.dl-btn{display:inline-block;margin-top:10px;padding:6px 12px;border:1px solid rgba(255,180,84,.3);border-radius:6px;color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out}.lb-stage{max-width:92vw;max-height:92vh;text-align:center}.lb-stage img{max-width:92vw;max-height:84vh;display:block;margin:auto;border-radius:8px}.lb-cap{color:var(--ink2);font-size:13px;margin-top:12px}
@media(max-width:1100px){.grid{grid-template-columns:repeat(2,1fr)}.stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){body{padding:42px 18px 80px}.grid{grid-template-columns:1fr}h1{font-size:36px}}
`;

export const PORTAL_JS = `
(function(){
function buildToc(){const toc=document.getElementById('toc');if(!toc)return;document.querySelectorAll('section[data-toc]').forEach(sec=>{if(!sec.id)return;const a=document.createElement('a');a.href='#'+sec.id;a.textContent=sec.dataset.toc;toc.appendChild(a);});}
function initLightbox(){document.querySelectorAll('img[data-lightbox-group]').forEach(img=>{img.addEventListener('click',()=>{const overlay=document.createElement('div');overlay.className='lb-overlay';overlay.innerHTML='<div class="lb-stage"><img src="'+img.src+'" alt=""><div class="lb-cap">'+(img.dataset.lbCaption||'')+'</div></div>';overlay.addEventListener('click',()=>overlay.remove());document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){overlay.remove();document.removeEventListener('keydown',esc);}});document.body.appendChild(overlay);});});}
function initDownloads(){document.querySelectorAll('[data-downloadable][src]').forEach(el=>{const src=el.getAttribute('src');if(!src)return;const cap=el.closest('.card,.hero-video')?.querySelector('.meta,.final-meta')||el.parentElement;const a=document.createElement('a');a.href=src;a.download='';a.className='dl-btn';a.textContent='Download';cap?.appendChild(a);});}
function setExclusive(btn,selector){const pressed=btn.getAttribute('aria-pressed')==='true';const card=btn.closest('[data-card-kind]');if(card)card.querySelectorAll(selector).forEach(b=>b.setAttribute('aria-pressed','false'));btn.setAttribute('aria-pressed',pressed?'false':'true');}
function initEditor(){document.querySelectorAll('.review-btn').forEach(btn=>btn.addEventListener('click',()=>{setExclusive(btn,'.review-btn');refreshEditorHud();}));const copy=document.getElementById('copy-decisions-btn');if(copy)copy.addEventListener('click',async()=>{const lines=[];document.querySelectorAll('[data-card-kind]').forEach(card=>{const action=card.querySelector('.review-btn[aria-pressed=true]');if(!action)return;const note=card.querySelector('.review-note');lines.push('- '+card.dataset.cardKind+'#'+card.dataset.cardId+': '+action.dataset.reviewAction+(note&&note.value?' — '+note.value:''));});const block='VIDEOCLAW_REVIEW_DECISIONS\\\\n'+(lines.join('\\\\n')||'(no decisions selected)')+'\\\\n';try{await navigator.clipboard.writeText(block);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy Review Decisions',1800);}catch{console.log(block);copy.textContent='See console';}});refreshEditorHud();}
function refreshEditorHud(){const a=document.getElementById('rs-approved');const r=document.getElementById('rs-regen');if(a)a.textContent=document.querySelectorAll('[data-review-action=approve][aria-pressed=true]').length+' approved';if(r)r.textContent=document.querySelectorAll('[data-review-action=regenerate][aria-pressed=true]').length+' to regenerate';}
function initClient(){document.querySelectorAll('.client-btn').forEach(btn=>btn.addEventListener('click',()=>{setExclusive(btn,'.client-btn');}));const copy=document.getElementById('copy-client-feedback-btn');if(copy)copy.addEventListener('click',async()=>{const lines=[];document.querySelectorAll('[data-card-kind]').forEach(card=>{const action=card.querySelector('.client-btn[aria-pressed=true]');const note=card.querySelector('.client-note');if(action||note?.value)lines.push('- '+card.dataset.cardKind+'#'+card.dataset.cardId+': '+(action?.dataset.clientAction||'comment')+(note&&note.value?' — '+note.value:''));});const block='VIDEOCLAW_CLIENT_FEEDBACK\\\\n'+(lines.join('\\\\n')||'(no feedback entered)')+'\\\\n';try{await navigator.clipboard.writeText(block);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy Feedback',1800);}catch{console.log(block);copy.textContent='See console';}});}
function init(){buildToc();initLightbox();initDownloads();if(document.body.dataset.mode==='editor')initEditor();if(document.body.dataset.mode==='client')initClient();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
`;
```

- [ ] **Step 4: Implement `render.ts`**

Create `src/video/preview-portal/render.ts`:

```ts
import type { PreviewPortalAsset, PreviewPortalRenderOptions, PreviewPortalSurface } from './types.js';
import { PORTAL_CSS, PORTAL_JS } from './shared-assets.js';

export function renderPreviewPortalHtml(options: PreviewPortalRenderOptions): string {
  const mode = modeForSurface(options.surface);
  const project = options.project;
  const final = project.assets.find((asset) => asset.section === 'final' && asset.kind === 'video');
  const stats = [
    [project.run.runId, 'run'],
    [project.template, 'template'],
    [String(project.assets.filter((asset) => asset.kind === 'video').length), 'videos'],
    [String(project.assets.filter((asset) => asset.kind === 'image').length), 'images'],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.title)}</title>
<style>${PORTAL_CSS}</style>
</head>
<body data-mode="${mode}">
<nav class="toc" id="toc" aria-label="Sections"></nav>
<header class="hero">
  <div class="eyebrow">${labelForSurface(options.surface)} · ${esc(project.template)}</div>
  <h1>${esc(project.title)}</h1>
  ${project.summary ? `<p class="sub">${esc(project.summary)}</p>` : ''}
  <div class="stats">${stats.map(([value, label]) => `<div class="stat"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`).join('')}</div>
</header>
${final ? renderHeroVideo(final) : ''}
${renderCardsSection('finals', 'Finals', project.assets.filter((asset) => asset.section === 'final' && asset.kind === 'video'), options.surface)}
${renderCardsSection('scenes', 'Scenes', project.assets.filter((asset) => asset.section === 'videos' && asset.kind === 'video'), options.surface)}
${renderCardsSection('images', 'Images', project.assets.filter((asset) => asset.kind === 'image'), options.surface)}
${renderCardsSection('audio', 'Audio', project.assets.filter((asset) => asset.kind === 'audio'), options.surface)}
${renderCardsSection('prompts', 'Prompts', project.assets.filter((asset) => asset.section === 'prompts'), options.surface)}
${renderHud(options.surface)}
<footer>Generated by videoclaw · ${esc(project.slug)} · ${esc(project.run.updatedAt)}</footer>
<script>${PORTAL_JS}</script>
</body>
</html>
`;
}

function renderHeroVideo(asset: PreviewPortalAsset): string {
  return `<div class="hero-video">
  <video controls preload="metadata" playsinline data-downloadable src="${escAttr(asset.path)}"></video>
  <div class="final-meta"><span class="num">Current final</span><span>${esc(asset.path)}</span></div>
</div>`;
}

function renderCardsSection(id: string, title: string, assets: PreviewPortalAsset[], surface: PreviewPortalSurface): string {
  if (assets.length === 0) return '';
  return `<section id="${id}" data-toc="${escAttr(title)}">
  <div class="section-head"><h2>${esc(title)}</h2><div class="section-title">${esc(title)}</div><div class="section-sub">${assets.length} item${assets.length === 1 ? '' : 's'} discovered.</div></div>
  <div class="grid">
    ${assets.map((asset) => renderAssetCard(asset, surface)).join('')}
  </div>
</section>`;
}

function renderAssetCard(asset: PreviewPortalAsset, surface: PreviewPortalSurface): string {
  const kind = asset.section === 'final' ? 'final' : asset.section === 'videos' ? 'scene' : 'asset';
  const media = asset.kind === 'video'
    ? `<video controls preload="metadata" data-downloadable src="${escAttr(asset.path)}"></video>`
    : asset.kind === 'image'
      ? `<img data-downloadable data-lightbox-group="${escAttr(asset.section)}" data-lb-caption="${escAttr(asset.label)}" src="${escAttr(asset.path)}" alt="${escAttr(asset.label)}">`
      : asset.kind === 'audio'
        ? `<div class="meta"><audio controls data-downloadable src="${escAttr(asset.path)}"></audio></div>`
        : `<div class="meta"><code>${esc(asset.path)}</code></div>`;
  return `<div class="card" data-card-kind="${kind}" data-card-id="${escAttr(asset.id)}">
    ${media}
    <div class="meta"><div class="num">${esc(asset.section)}</div><div class="title">${esc(asset.label)}</div><div class="who">${esc(asset.path)}</div></div>
    ${renderControls(surface)}
  </div>`;
}

function renderControls(surface: PreviewPortalSurface): string {
  if (surface === 'review') {
    return `<div class="review-controls">
      <button type="button" class="review-btn" data-review-action="approve" aria-pressed="false">Approve</button>
      <button type="button" class="review-btn" data-review-action="regenerate" aria-pressed="false">Regenerate</button>
      <input type="text" class="review-note" placeholder="why / what to change">
    </div>`;
  }
  if (surface === 'client-review') {
    return `<div class="client-controls">
      <button type="button" class="client-btn" data-client-action="approve" aria-pressed="false">Approve</button>
      <button type="button" class="client-btn" data-client-action="decline" aria-pressed="false">Decline</button>
      <input type="text" class="client-note" placeholder="comment">
    </div>`;
  }
  return '';
}

function renderHud(surface: PreviewPortalSurface): string {
  if (surface === 'review') {
    return `<div class="hud" id="review-hud" role="status"><span id="rs-approved">0 approved</span><span id="rs-regen">0 to regenerate</span><button type="button" id="copy-decisions-btn">Copy Review Decisions</button></div>`;
  }
  if (surface === 'client-review') {
    return `<div class="hud" id="client-hud" role="status"><span>Client feedback</span><button type="button" id="copy-client-feedback-btn">Copy Feedback</button></div>`;
  }
  return '';
}

function modeForSurface(surface: PreviewPortalSurface): 'editor' | 'client' | 'preview' | 'compare' {
  if (surface === 'review') return 'editor';
  if (surface === 'client-review') return 'client';
  if (surface === 'compare') return 'compare';
  return 'preview';
}

function labelForSurface(surface: PreviewPortalSurface): string {
  if (surface === 'review') return 'editor review';
  if (surface === 'client-review') return 'client review';
  if (surface === 'compare') return 'compare';
  if (surface === 'index') return 'index';
  return 'preview';
}

function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function escAttr(value: string): string {
  return esc(value);
}
```

Modify `src/video/preview-portal/index.ts`:

```ts
export { renderPreviewPortalHtml } from './render.js';
```

- [ ] **Step 5: Run renderer tests**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: PASS.

## Task 4: Generate Local Portal Files

**Files:**
- Create: `src/video/preview-portal/audit.ts`
- Create: `src/video/preview-portal/generate.ts`
- Modify: `src/video/preview-portal/index.ts`
- Modify: `src/tests/preview-portal.test.ts`

- [ ] **Step 1: Add failing generation/audit test**

Append:

```ts
import { access, readFile } from 'node:fs/promises';
import { generatePreviewPortalSurfaces } from '../video/preview-portal/index.js';

describe('preview portal generation', () => {
  it('writes review, client-review, and preview surfaces plus audit events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-portal-generate-'));
    const projectDir = join(root, 'projects', 'alpha');
    await mkdir(join(projectDir, 'final'), { recursive: true });
    await writeFile(join(projectDir, 'project.json'), JSON.stringify({ title: 'Alpha', template: 'music-video' }));
    await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');

    const result = await generatePreviewPortalSurfaces({
      root,
      projectSlug: 'alpha',
      runId: 'run-001',
      surfaces: ['review', 'client-review', 'preview'],
    });

    assert.equal(result.outputs.length, 3);
    await access(join(projectDir, 'review.html'));
    await access(join(projectDir, 'client-review.html'));
    await access(join(projectDir, 'preview.html'));
    const audit = await readFile(join(projectDir, 'project-audit.jsonl'), 'utf-8');
    assert.match(audit, /surface.generated/);
    assert.match(audit, /client-review/);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: compile failure for missing `generatePreviewPortalSurfaces`.

- [ ] **Step 3: Implement audit and generation**

Create `src/video/preview-portal/audit.ts`:

```ts
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { PreviewPortalAuditEvent } from './types.js';

export async function appendPreviewPortalAuditEvent(path: string, event: PreviewPortalAuditEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`);
}

export async function readPreviewPortalAuditEvents(path: string): Promise<PreviewPortalAuditEvent[]> {
  if (!existsSync(path)) return [];
  return (await readFile(path, 'utf-8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PreviewPortalAuditEvent);
}
```

Create `src/video/preview-portal/generate.ts`:

```ts
import { join } from 'node:path';
import { writeTextFileAtomic } from '../atomic-write.js';
import { appendPreviewPortalAuditEvent } from './audit.js';
import { discoverPreviewPortalProject } from './discovery.js';
import { renderPreviewPortalHtml } from './render.js';
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

export async function generatePreviewPortalSurfaces(
  options: GeneratePreviewPortalSurfacesOptions,
): Promise<GeneratePreviewPortalSurfacesResult> {
  const project = await discoverPreviewPortalProject(options);
  const surfaces = options.surfaces ?? ['review', 'client-review', 'preview'];
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

function fileNameForSurface(surface: PreviewPortalSurface): string {
  if (surface === 'client-review') return 'client-review.html';
  if (surface === 'review') return 'review.html';
  if (surface === 'compare') return 'compare.html';
  if (surface === 'index') return 'index.html';
  return 'preview.html';
}
```

Modify `src/video/preview-portal/index.ts`:

```ts
export { appendPreviewPortalAuditEvent, readPreviewPortalAuditEvents } from './audit.js';
export { generatePreviewPortalSurfaces } from './generate.js';
export type { GeneratePreviewPortalSurfacesOptions, GeneratePreviewPortalSurfacesResult } from './generate.js';
```

- [ ] **Step 4: Run generation tests**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: PASS.

## Task 5: Add CLI Commands

**Files:**
- Modify: `src/cli/vclaw.ts`
- Modify: `src/video/cli-schema.ts`
- Create: `src/tests/cli-preview-portal.test.ts`

- [ ] **Step 1: Add CLI tests**

Create `src/tests/cli-preview-portal.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw preview portal cli', () => {
  it('generates local review, client review, and preview pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-cli-'));
    try {
      const projectDir = join(root, 'projects', 'alpha');
      await mkdir(join(projectDir, 'final'), { recursive: true });
      await writeFile(join(projectDir, 'project.json'), JSON.stringify({ title: 'Alpha', template: 'story-film' }));
      await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'portal',
        '--project',
        'alpha',
        '--root',
        root,
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as { outputs?: Array<{ surface?: string }> };
      assert.deepEqual(payload.outputs?.map((output) => output.surface), ['review', 'client-review', 'preview']);
      assert.match(await readFile(join(projectDir, 'review.html'), 'utf-8'), /VIDEOCLAW_REVIEW_DECISIONS/);
      assert.match(await readFile(join(projectDir, 'client-review.html'), 'utf-8'), /VIDEOCLAW_CLIENT_FEEDBACK/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run build && node --test dist/tests/cli-preview-portal.test.js`

Expected: command fails because `video portal` does not exist.

- [ ] **Step 3: Wire CLI**

In `src/cli/vclaw.ts`, import:

```ts
import { generatePreviewPortalSurfaces } from '../video/preview-portal/index.js';
```

Add usage line:

```ts
process.stdout.write('  vclaw video portal --project <slug> [--root <path>] [--client <name>] [--run <id>] [--surface review|client-review|preview|compare|index]\n');
```

Add handler:

```ts
async function handleVideoPortal(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) throw new Error('video portal requires --project <slug>');
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const client = parseFlagValue(args, '--client') ?? undefined;
  const runId = parseFlagValue(args, '--run') ?? undefined;
  const surface = parseFlagValue(args, '--surface') as 'review' | 'client-review' | 'preview' | 'compare' | 'index' | undefined;
  const result = await generatePreviewPortalSurfaces({
    root,
    projectSlug,
    ...(client ? { client } : {}),
    ...(runId ? { runId } : {}),
    ...(surface ? { surfaces: [surface] } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
```

Add dispatch before other fallback routes:

```ts
if (command === 'video' && subcommand === 'portal') {
  await handleVideoPortal(rest);
  return;
}
```

Modify `src/video/cli-schema.ts` command list with:

```ts
{ name: 'video portal', usage: 'vclaw video portal --project <slug> [--root <path>] [--client <name>] [--run <id>] [--surface review|client-review|preview|compare|index]' },
```

- [ ] **Step 4: Run CLI test**

Run: `npm run build && node --test dist/tests/cli-preview-portal.test.js`

Expected: PASS.

## Task 6: Add Client/Project Index and Compare Surfaces

**Files:**
- Modify: `src/video/preview-portal/render.ts`
- Create: `src/video/preview-portal/client-index.ts`
- Modify: `src/video/preview-portal/index.ts`
- Modify: `src/tests/preview-portal.test.ts`

- [ ] **Step 1: Add failing tests for compare/index**

Add tests asserting `compare.html` includes multiple runs and client `index.html` lists projects with latest status.

```ts
import { renderClientIndexHtml } from '../video/preview-portal/index.js';

describe('preview portal index surfaces', () => {
  it('renders a client index with projects sorted by updated date', () => {
    const html = renderClientIndexHtml({
      client: 'acme',
      generatedAt: '2026-05-28T12:00:00.000Z',
      projects: [
        { slug: 'beta', title: 'Beta', template: 'story-film', status: 'client-review', updatedAt: '2026-05-28T11:00:00.000Z', url: 'beta/index.html' },
        { slug: 'alpha', title: 'Alpha', template: 'music-video', status: 'final', updatedAt: '2026-05-28T12:00:00.000Z', url: 'alpha/index.html' },
      ],
    });
    assert.match(html, /acme/);
    assert.ok(html.indexOf('Alpha') < html.indexOf('Beta'));
    assert.match(html, /client-review/);
    assert.match(html, /final/);
  });
});
```

- [ ] **Step 2: Implement index renderer**

Create `src/video/preview-portal/client-index.ts`:

```ts
import { PORTAL_CSS } from './shared-assets.js';
import type { PreviewPortalStatus, PreviewPortalTemplateId } from './types.js';

export interface ClientIndexProject {
  slug: string;
  title: string;
  template: PreviewPortalTemplateId;
  status: PreviewPortalStatus;
  updatedAt: string;
  url: string;
  thumbnail?: string;
}

export interface RenderClientIndexOptions {
  client: string;
  generatedAt: string;
  projects: ClientIndexProject[];
}

export function renderClientIndexHtml(options: RenderClientIndexOptions): string {
  const projects = [...options.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(options.client)} · Videoclaw Reviews</title><style>${PORTAL_CSS}</style></head><body data-mode="index">
<header class="hero"><div class="eyebrow">client portal</div><h1>${esc(options.client)}</h1><p class="sub">Generated ${esc(options.generatedAt)}.</p></header>
<section id="projects" data-toc="Projects"><div class="section-head"><h2>Projects</h2><div class="section-title">Projects and review links</div></div><div class="grid">
${projects.map((project) => `<a class="card" href="${escAttr(project.url)}"><div class="meta"><div class="num">${esc(project.status)}</div><div class="title">${esc(project.title)}</div><div class="who">${esc(project.template)} · ${esc(project.updatedAt)}</div></div></a>`).join('')}
</div></section></body></html>`;
}

function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function escAttr(value: string): string {
  return esc(value);
}
```

Modify `src/video/preview-portal/index.ts`:

```ts
export { renderClientIndexHtml } from './client-index.js';
export type { ClientIndexProject, RenderClientIndexOptions } from './client-index.js';
```

- [ ] **Step 3: Run tests**

Run: `npm run build && node --test dist/tests/preview-portal.test.js`

Expected: PASS.

## Task 7: Cloudflare/R2 Publish Dry-Run and Manifest

**Files:**
- Create: `src/video/preview-portal/publish.ts`
- Modify: `src/video/preview-portal/index.ts`
- Modify: `src/tests/preview-portal.test.ts`
- Modify: `src/cli/vclaw.ts`

- [ ] **Step 1: Add failing dry-run publish test**

Test should create `preview.html` plus assets and assert the publish plan includes HTML/assets, content types, remote keys, and no shell execution in dry-run mode.

```ts
import { buildPreviewPortalPublishPlan } from '../video/preview-portal/index.js';

describe('preview portal publish plan', () => {
  it('builds an R2 upload plan from local html references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-publish-'));
    const projectDir = join(root, 'projects', 'alpha');
    await mkdir(join(projectDir, 'final'), { recursive: true });
    await writeFile(join(projectDir, 'preview.html'), '<video src="final/alpha.mp4"></video><img src="thumb.jpg">');
    await writeFile(join(projectDir, 'thumb.jpg'), 'image');
    await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');

    const plan = await buildPreviewPortalPublishPlan({
      projectDir,
      client: 'acme',
      projectSlug: 'alpha',
      runId: 'run-001',
      surface: 'preview',
      bucket: 'videoclaw-reviews',
    });

    assert.ok(plan.items.some((item) => item.localPath.endsWith('preview.html') && item.contentType === 'text/html; charset=utf-8'));
    assert.ok(plan.items.some((item) => item.remoteKey === 'clients/acme/alpha/runs/run-001/final/alpha.mp4'));
    assert.ok(plan.items.some((item) => item.contentType === 'image/jpeg'));
  });
});
```

- [ ] **Step 2: Implement publish plan**

Create `src/video/preview-portal/publish.ts`:

```ts
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PreviewPortalSurface } from './types.js';

export interface BuildPreviewPortalPublishPlanOptions {
  projectDir: string;
  client: string;
  projectSlug: string;
  runId: string;
  surface: PreviewPortalSurface;
  bucket: string;
}

export interface PreviewPortalPublishItem {
  localPath: string;
  remoteKey: string;
  contentType: string;
}

export interface PreviewPortalPublishPlan {
  bucket: string;
  publicPrefix: string;
  items: PreviewPortalPublishItem[];
}

export async function buildPreviewPortalPublishPlan(
  options: BuildPreviewPortalPublishPlanOptions,
): Promise<PreviewPortalPublishPlan> {
  const htmlFile = surfaceFileName(options.surface);
  const htmlPath = join(options.projectDir, htmlFile);
  const html = await readFile(htmlPath, 'utf-8');
  const refs = [...new Set([htmlFile, ...extractLocalRefs(html)])];
  const prefix = `clients/${options.client}/${options.projectSlug}/runs/${options.runId}`;
  return {
    bucket: options.bucket,
    publicPrefix: prefix,
    items: refs
      .map((ref) => ({ ref, path: resolve(options.projectDir, ref) }))
      .filter((item) => item.path.startsWith(resolve(options.projectDir)) && existsSync(item.path))
      .map((item) => ({
        localPath: item.path,
        remoteKey: `${prefix}/${item.ref.replace(/^\\.\\//, '')}`,
        contentType: contentType(item.ref),
      })),
  };
}

function extractLocalRefs(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (!ref || ref.startsWith('http:') || ref.startsWith('https:') || ref.startsWith('#') || ref.startsWith('data:')) continue;
    refs.push(ref);
  }
  return refs;
}

function surfaceFileName(surface: PreviewPortalSurface): string {
  if (surface === 'review') return 'review.html';
  if (surface === 'client-review') return 'client-review.html';
  if (surface === 'compare') return 'compare.html';
  if (surface === 'index') return 'index.html';
  return 'preview.html';
}

function contentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
```

Export from `index.ts`:

```ts
export { buildPreviewPortalPublishPlan } from './publish.js';
export type { BuildPreviewPortalPublishPlanOptions, PreviewPortalPublishItem, PreviewPortalPublishPlan } from './publish.js';
```

- [ ] **Step 3: Add CLI dry-run**

Add `video publish-preview` handler that prints the publish plan when `--dry-run` is passed. Only execute `wrangler` in a later task after dry-run is verified.

- [ ] **Step 4: Run publish tests**

Run: `npm run build && node --test dist/tests/preview-portal.test.js dist/tests/cli-preview-portal.test.js`

Expected: PASS.

## Task 8: Documentation and Existing Example Audit

**Files:**
- Create: `docs/preview-portal-audit.md`
- Modify: `docs/CLI_REFERENCE.md`
- Modify: `docs/PROJECT_LAYOUT.md`

- [ ] **Step 1: Write `docs/preview-portal-audit.md`**

Include this matrix:

```md
| Example | Surface | Controls | Lightbox | Downloads | Notes |
|---|---|---:|---:|---:|---|
| guardians-of-the-dawn/review.html | editor review | yes | yes | partial | source for editor controls |
| guardians-of-the-dawn/client-review.html | client review | simplified | yes | partial | source for client mode |
| mirchi-mode/preview.html | final preview | no | no | yes | source for final showcase/downloads |
| dhuaan-music-video/preview.html | project preview | no | no | no | should migrate to generated music-video preview |
```

- [ ] **Step 2: Document commands in `docs/CLI_REFERENCE.md`**

Add examples:

```md
vclaw video portal --project dhuaan-music-video --template music-video
vclaw video portal --project guardians-of-the-dawn --surface client-review
vclaw video publish-preview --project dhuaan-music-video --client acme --surface client-review --dry-run
```

- [ ] **Step 3: Document layout in `docs/PROJECT_LAYOUT.md`**

Add:

```text
projects/<slug>/review.html
projects/<slug>/client-review.html
projects/<slug>/preview.html
projects/<slug>/compare.html
projects/<slug>/project-audit.jsonl
clients/<client>/manifest.json
clients/<client>/index.html
```

- [ ] **Step 4: Run documentation-adjacent verification**

Run: `npm run build && node --test dist/tests/preview-portal.test.js dist/tests/cli-preview-portal.test.js`

Expected: PASS.

## Task 9: Full Verification

**Files:**
- No new files unless failures require fixes.

- [ ] **Step 1: Run focused tests**

Run: `npm run build && node --test dist/tests/preview-portal.test.js dist/tests/cli-preview-portal.test.js`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Generate a local sample portal**

Run:

```bash
node dist/cli/vclaw.js video portal --project 2026-05-27_dhuaan-music-video --root /Users/davendrapatel/Documents/GitHub/video-creation-projects/video-replicator-veo-cli
```

Expected: JSON output with `review`, `client-review`, and `preview` output paths.

- [ ] **Step 4: Browser-check generated sample pages**

Open the generated files:

```text
/Users/davendrapatel/Documents/GitHub/video-creation-projects/video-replicator-veo-cli/projects/2026-05-27_dhuaan-music-video/review.html
/Users/davendrapatel/Documents/GitHub/video-creation-projects/video-replicator-veo-cli/projects/2026-05-27_dhuaan-music-video/client-review.html
/Users/davendrapatel/Documents/GitHub/video-creation-projects/video-replicator-veo-cli/projects/2026-05-27_dhuaan-music-video/preview.html
```

Verify:
- `review.html` shows approve/regenerate controls and copy decisions.
- `client-review.html` shows approve/decline/comment and copy feedback.
- `preview.html` has downloads and no approval controls.
- Images open in lightbox.
- Videos play from relative paths.

## Self-Review

Spec coverage:
- Three surfaces covered by Tasks 3-5.
- Template families represented by stable template IDs in Task 1 and used in discovery/rendering in Tasks 2-3.
- Editor review copy-out covered by Task 3.
- Client approval/decline/comment covered by Task 3.
- Final preview downloads covered by Task 3.
- Client/project index covered by Task 6.
- Multi-generation compare is represented as a surface and scheduled with index rendering in Task 6; detailed side-by-side playback can be expanded after the first pass without changing the data model.
- Audit trail covered by Task 4.
- Cloudflare/R2 publish plan covered by Task 7.
- Docs and current-example audit covered by Task 8.

Placeholder scan:
- No `TBD`, `TODO`, or "implement later" instructions are required to complete the first portal slice.
- Cloudflare execution is intentionally dry-run first; real `wrangler` execution should be a follow-up after the plan output is validated because it has external side effects.

Type consistency:
- `PreviewPortalSurface`, `PreviewPortalStatus`, and `PreviewPortalTemplateId` are defined once in Task 1.
- Later tasks import from `src/video/preview-portal/index.ts`.
- Surface filenames consistently map `review -> review.html`, `client-review -> client-review.html`, and `preview -> preview.html`.
