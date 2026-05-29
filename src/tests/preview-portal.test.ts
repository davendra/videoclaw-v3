import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildPreviewPortalPublishPlan,
  discoverPreviewPortalPortfolio,
  discoverPreviewPortalProject,
  generatePreviewPortalIndex,
  generatePreviewPortalSurfaces,
  PREVIEW_PORTAL_STATUSES,
  PREVIEW_PORTAL_SURFACES,
  PREVIEW_PORTAL_TEMPLATE_REGISTRY,
  PREVIEW_PORTAL_TEMPLATES,
  publishPreviewPortalIndex,
  renderPreviewPortalHtml,
  renderPreviewPortalIndexHtml,
  resolvePreviewPortalTemplate,
} from '../video/preview-portal/index.js';

describe('preview portal contracts', () => {
  it('exposes stable surface, status, and template identifiers', () => {
    assert.deepEqual(PREVIEW_PORTAL_SURFACES, [
      'edit',
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
    assert.equal(resolvePreviewPortalTemplate('documentary').name, 'Documentary');
    assert.equal(PREVIEW_PORTAL_TEMPLATE_REGISTRY['product-ad'].sectionLabels.variants, 'Aspect Variants');
  });
});

describe('preview portal discovery', () => {
  it('discovers final videos, scene videos, images, audio, and prompts as portal assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-portal-'));
    const projectDir = join(root, 'projects', 'alpha');
    await mkdir(join(projectDir, 'final'), { recursive: true });
    await mkdir(join(projectDir, 'videos'), { recursive: true });
    await mkdir(join(projectDir, 'images'), { recursive: true });
    await mkdir(join(projectDir, 'assets', 'upscaled', 'storyboard'), { recursive: true });
    await mkdir(join(projectDir, 'audio'), { recursive: true });
    await mkdir(join(projectDir, 'prompts'), { recursive: true });
    await mkdir(join(projectDir, 'artifacts'), { recursive: true });
    await writeFile(join(projectDir, 'project.json'), JSON.stringify({
      title: 'Alpha Film',
      template: 'story-film',
      summary: 'A short narrative test.',
    }));
    await writeFile(join(projectDir, 'final', 'alpha_v1.mp4'), 'video');
    await writeFile(join(projectDir, 'videos', 'scene_01.mp4'), 'clip');
    await writeFile(join(projectDir, 'images', 'scene_01_frame.jpg'), 'image');
    await writeFile(join(projectDir, 'assets', 'upscaled', 'storyboard', 'scene_01_4k.jpg'), 'seedance-image');
    await writeFile(join(projectDir, 'audio', 'narration.mp3'), 'audio');
    await writeFile(join(projectDir, 'prompts', 'scene_01.txt'), 'prompt');
    await writeFile(join(projectDir, 'artifacts', 'asset-manifest.json'), JSON.stringify({
      projectSlug: 'alpha',
      assets: [{
        id: 'scene-1-start-frame',
        kind: 'image',
        path: 'assets/upscaled/storyboard/scene_01_4k.jpg',
        sceneIndex: 1,
        backend: 'seedance-direct',
      }],
    }));
    await writeFile(join(projectDir, 'artifacts', 'filmmaking-prompts.json'), JSON.stringify({
      schemaVersion: 1,
      projectSlug: 'alpha',
      seedancePackets: [],
    }));

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
    assert.ok(project.assets.some((asset) => (
      asset.path === 'assets/upscaled/storyboard/scene_01_4k.jpg'
      && asset.section === 'generation-inputs'
      && asset.label === 'Scene 1 · Seedance input'
    )));
    assert.ok(project.assets.some((asset) => (
      asset.path === 'artifacts/filmmaking-prompts.json'
      && asset.section === 'prompt-packets'
      && asset.label === 'Filmmaking Prompt Packet'
    )));
    assert.ok(project.assets.some((asset) => asset.path === 'audio/narration.mp3' && asset.kind === 'audio'));
    assert.ok(project.cards.some((card) => card.kind === 'final' && card.reviewable));
    assert.ok(project.cards.some((card) => card.kind === 'scene' && card.reviewable));
  });

  it('discovers a client-filtered portfolio from project manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-portfolio-'));
    await writeProjectFixture(root, 'alpha', 'Alpha', 'Acme');
    await writeProjectFixture(root, 'beta', 'Beta', 'BetaCo');
    await writeProjectFixture(root, 'gamma', 'Gamma', 'Acme');

    const projects = await discoverPreviewPortalPortfolio({ root, client: 'Acme' });

    assert.deepEqual(projects.map((project) => project.slug).sort(), ['alpha', 'gamma']);
    assert.ok(projects.every((project) => project.client === 'Acme'));
  });
});

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

  it('renders edit.html-compatible editor controls for edit surface', async () => {
    const project = await discoverPreviewPortalProjectFixture('story-film');
    const html = renderPreviewPortalHtml({ surface: 'edit', project });
    assert.match(html, /data-mode="editor"/);
    assert.match(html, /editor edit/);
    assert.match(html, /VIDEOCLAW_REVIEW_DECISIONS/);
    assert.match(html, /data-review-action="regenerate"/);
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
    assert.match(html, /music video review/);
    assert.match(html, /Performance Clips/);
    assert.match(html, /Seedance Input Frames/);
    assert.match(html, /Seedance Prompt Packets/);
    assert.match(html, /Track &amp; Mixes/);
    assert.match(html, /data-downloadable/);
    assert.match(html, /function initDownloads/);
    assert.doesNotMatch(html, /data-review-action=/);
    assert.doesNotMatch(html, /data-client-action=/);
  });

  it('uses template-specific section labels for story projects', async () => {
    const project = await discoverPreviewPortalProjectFixture('story-film');
    const html = renderPreviewPortalHtml({ surface: 'preview', project });
    assert.match(html, /story review/);
    assert.match(html, /Current cut/);
    assert.match(html, /Scenes/);
  });

  it('renders a soundtrack audio player in the preview surface when discovered', async () => {
    const project = await discoverPreviewPortalProjectFixture('music-video');
    assert.equal(project.soundtrack?.path, 'audio/fixture.mp3');
    const html = renderPreviewPortalHtml({ surface: 'preview', project });
    assert.match(html, /<audio controls preload="none"[^>]*src="audio\/fixture\.mp3"/);
  });

  it('omits the soundtrack player entirely when no soundtrack exists', async () => {
    const project = await discoverPreviewPortalProjectFixture('story-film', { soundtrack: false });
    assert.equal(project.soundtrack, undefined);
    const html = renderPreviewPortalHtml({ surface: 'preview', project });
    assert.doesNotMatch(html, /class="soundtrack-player"/);
  });

  it('marks production images in the preview surface as lightbox-enabled', async () => {
    const project = await discoverPreviewPortalProjectFixture('story-film');
    const html = renderPreviewPortalHtml({ surface: 'preview', project });
    // Strip the inlined <script> block (which contains an <img> string literal
    // inside the lightbox JS) so we only assert on rendered DOM markup.
    const body = html.replace(/<script>[\s\S]*?<\/script>/g, '');
    const imgTags = body.match(/<img\b[^>]*>/g) ?? [];
    assert.ok(imgTags.length > 0, 'expected at least one production image');
    for (const img of imgTags) {
      assert.match(img, /data-lightbox-group=/);
    }
  });

  it('renders an index with links to per-project portal pages', async () => {
    const project = await discoverPreviewPortalProjectFixture('music-video');
    const html = renderPreviewPortalIndexHtml({ projects: [project], client: 'Acme', linkPrefix: '../../' });
    assert.match(html, /Acme Review Index/);
    assert.match(html, /..\/..\/fixture\/preview\.html/);
    assert.match(html, /..\/..\/fixture\/client-review\.html/);
    assert.match(html, /..\/..\/fixture\/edit\.html/);
  });

  it('renders published index links into Cloudflare run folders', async () => {
    const project = await discoverPreviewPortalProjectFixture('music-video');
    const clientHtml = renderPreviewPortalIndexHtml({
      projects: [project],
      client: 'Acme',
      linkMode: 'published-run',
    });
    const globalHtml = renderPreviewPortalIndexHtml({
      projects: [{ ...project, client: 'Acme' }],
      linkMode: 'published-run',
    });
    assert.match(clientHtml, /fixture\/runs\/run-001\/preview\.html/);
    assert.match(globalHtml, /clients\/acme\/fixture\/runs\/run-001\/preview\.html/);
  });

  it('renders a compare surface across multiple project versions', async () => {
    const projectA = await discoverPreviewPortalProjectFixture('music-video');
    const projectB = await discoverPreviewPortalProjectFixture('music-video');
    const html = renderPreviewPortalHtml({ surface: 'compare', project: projectA, compareProjects: [projectA, projectB] });
    assert.match(html, /data-mode="compare"/);
    assert.match(html, /Run Comparison/);
    assert.match(html, /data-card-kind="run"/);
  });
});

describe('preview portal generation', () => {
  it('writes edit, review, client-review, and preview surfaces plus audit events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-portal-generate-'));
    const projectDir = join(root, 'projects', 'alpha');
    await mkdir(join(projectDir, 'final'), { recursive: true });
    await writeFile(join(projectDir, 'project.json'), JSON.stringify({ title: 'Alpha', template: 'music-video' }));
    await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');

    const result = await generatePreviewPortalSurfaces({
      root,
      projectSlug: 'alpha',
      runId: 'run-001',
    });

    assert.equal(result.outputs.length, 4);
    await access(join(projectDir, 'edit.html'));
    await access(join(projectDir, 'review.html'));
    await access(join(projectDir, 'client-review.html'));
    await access(join(projectDir, 'preview.html'));
    const audit = await readFile(join(projectDir, 'project-audit.jsonl'), 'utf-8');
    assert.match(audit, /surface.generated/);
    assert.match(audit, /"surface":"edit"/);
    assert.match(audit, /client-review/);
  });

  it('writes a client-scoped index under projects/clients/<client>/index.html', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-index-'));
    await writeProjectFixture(root, 'alpha', 'Alpha', 'Acme Studios');
    await writeProjectFixture(root, 'beta', 'Beta', 'Other Client');

    const result = await generatePreviewPortalIndex({ root, client: 'Acme Studios' });

    assert.equal(result.projectCount, 1);
    assert.match(result.outputPath, /projects\/clients\/acme-studios\/index\.html$/);
    const html = await readFile(result.outputPath, 'utf-8');
    assert.match(html, /Alpha/);
    assert.doesNotMatch(html, /Beta/);
    assert.match(html, /..\/..\/alpha\/preview\.html/);
  });

  it('builds a publishable client index plan with run-folder links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-index-publish-'));
    await writeProjectFixture(root, 'alpha', 'Alpha', 'Acme Studios');
    await writeProjectFixture(root, 'beta', 'Beta', 'Acme Studios');

    const result = await publishPreviewPortalIndex({
      root,
      client: 'Acme Studios',
      bucket: 'videoclaw-reviews',
      publicBaseUrl: 'https://reviews.example.test',
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.plan.publicUrl, 'https://reviews.example.test/clients/acme-studios/index.html');
    assert.equal(result.plan.items[0]?.remoteKey, 'clients/acme-studios/index.html');
    assert.equal(result.uploaded.length, 0);
    const html = await readFile(result.plan.items[0]!.localPath, 'utf-8');
    assert.match(html, /alpha\/runs\/run-001\/preview\.html/);
    assert.match(html, /beta\/runs\/run-001\/preview\.html/);
  });
});

describe('preview portal publish plan', () => {
  it('builds an R2 upload plan from local html references', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-publish-'));
    const projectDir = join(root, 'projects', 'alpha');
    await mkdir(join(projectDir, 'final'), { recursive: true });
    await writeFile(join(projectDir, 'preview.html'), '<video src="final/alpha.mp4"></video><img src="thumb.jpg"><a href="https://example.com/out">external</a>');
    await writeFile(join(projectDir, 'thumb.jpg'), 'image');
    await writeFile(join(projectDir, 'final', 'alpha.mp4'), 'video');

    const plan = await buildPreviewPortalPublishPlan({
      projectDir,
      client: 'Acme Studios',
      projectSlug: 'alpha',
      runId: 'run-001',
      surface: 'preview',
      bucket: 'videoclaw-reviews',
      publicBaseUrl: 'https://reviews.example.test',
    });

    assert.equal(plan.bucket, 'videoclaw-reviews');
    assert.equal(plan.publicPrefix, 'clients/acme-studios/alpha/runs/run-001');
    assert.equal(plan.publicUrl, 'https://reviews.example.test/clients/acme-studios/alpha/runs/run-001/preview.html');
    assert.ok(plan.items.some((item) => item.localPath.endsWith('preview.html') && item.contentType === 'text/html; charset=utf-8'));
    assert.ok(plan.items.some((item) => item.remoteKey === 'clients/acme-studios/alpha/runs/run-001/final/alpha.mp4' && item.contentType === 'video/mp4'));
    assert.ok(plan.items.some((item) => item.remoteKey === 'clients/acme-studios/alpha/runs/run-001/thumb.jpg' && item.contentType === 'image/jpeg'));
    assert.ok(plan.items.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
    assert.ok(plan.items.every((item) => !item.remoteKey.includes('https:')));
  });
});

async function discoverPreviewPortalProjectFixture(
  template: 'music-video' | 'story-film',
  options: { soundtrack?: boolean } = {},
) {
  const includeSoundtrack = options.soundtrack !== false;
  const root = await mkdtemp(join(tmpdir(), 'vclaw-preview-portal-fixture-'));
  const projectDir = join(root, 'projects', 'fixture');
  await mkdir(join(projectDir, 'final'), { recursive: true });
  await mkdir(join(projectDir, 'videos'), { recursive: true });
  await mkdir(join(projectDir, 'images'), { recursive: true });
  await mkdir(join(projectDir, 'assets', 'upscaled'), { recursive: true });
  await mkdir(join(projectDir, 'audio'), { recursive: true });
  await mkdir(join(projectDir, 'artifacts'), { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({
    title: 'Fixture Project',
    template,
    summary: 'Fixture summary.',
  }));
  await writeFile(join(projectDir, 'final', 'fixture.mp4'), 'video');
  await writeFile(join(projectDir, 'videos', 'scene_01.mp4'), 'clip');
  await writeFile(join(projectDir, 'images', 'scene_01.jpg'), 'image');
  await writeFile(join(projectDir, 'assets', 'upscaled', 'scene_01_4k.jpg'), 'seedance-image');
  if (includeSoundtrack) await writeFile(join(projectDir, 'audio', 'fixture.mp3'), 'audio');
  await writeFile(join(projectDir, 'artifacts', 'asset-manifest.json'), JSON.stringify({
    projectSlug: 'fixture',
    assets: [{
      id: 'fixture-scene-1-start',
      kind: 'image',
      path: 'projects/fixture/assets/upscaled/scene_01_4k.jpg',
      sceneIndex: 1,
      backend: 'seedance-direct',
    }],
  }));
  await writeFile(join(projectDir, 'artifacts', 'filmmaking-prompts.json'), JSON.stringify({
    schemaVersion: 1,
    projectSlug: 'fixture',
    seedancePackets: [],
  }));
  return discoverPreviewPortalProject({ root, projectSlug: 'fixture', runId: 'run-001' });
}

async function writeProjectFixture(root: string, slug: string, title: string, client: string): Promise<void> {
  const projectDir = join(root, 'projects', slug);
  await mkdir(join(projectDir, 'final'), { recursive: true });
  await writeFile(join(projectDir, 'project.json'), JSON.stringify({
    title,
    client,
    template: 'story-film',
    summary: `${title} summary.`,
  }));
  await writeFile(join(projectDir, 'final', `${slug}.mp4`), 'video');
}
