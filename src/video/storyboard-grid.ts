import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import { VclawError } from './errors.js';
import type {
  FilmmakingPromptsArtifact,
  FilmmakingReferenceSlot,
  FilmmakingStoryboardPanel,
} from './filmmaking-prompts.js';
import { resolveProjectWorkspace } from './workspace.js';

export interface RenderStoryboardGridOptions {
  root?: string;
  projectSlug: string;
  output?: string;
  width?: number;
  height?: number;
  dryRun?: boolean;
}

export interface RenderStoryboardGridResult {
  projectSlug: string;
  outputPath: string;
  artifactReferencePath: string;
  artifactPath: string;
  width: number;
  height: number;
  panelCount: number;
  dryRun: boolean;
}

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const FONT_FAMILY = "'Arial', 'Helvetica', sans-serif";

export async function renderStoryboardGrid(
  options: RenderStoryboardGridOptions,
): Promise<RenderStoryboardGridResult> {
  const root = options.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(options.projectSlug, root);
  const artifactPath = artifactPathFor(workspace, 'filmmaking-prompts');
  if (!existsSync(artifactPath)) {
    throw new VclawError(
      'asset_not_found',
      `storyboard-grid requires artifacts/filmmaking-prompts.json. Run vclaw video filmmaking-prompts --project ${options.projectSlug} --write first.`,
      { artifactPath },
    );
  }

  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new VclawError(
      'invalid_video_format',
      `Storyboard-grid dimensions must be positive integers (got ${width}x${height}).`,
      { width, height },
    );
  }

  const artifact = JSON.parse(await readFile(artifactPath, 'utf-8')) as FilmmakingPromptsArtifact;
  const gridPrompt = artifact.storyboardGridPrompt;
  const panels = gridPrompt?.panels ?? [];
  if (panels.length === 0) {
    throw new VclawError(
      'asset_not_found',
      `storyboard-grid requires a storyboardGridPrompt with panels in artifacts/filmmaking-prompts.json (found ${panels.length}). Run vclaw video filmmaking-prompts --project ${options.projectSlug} --write first.`,
      { artifactPath, panelCount: panels.length },
    );
  }
  // Layout from the artifact when present (variable panel counts), else derive a
  // near-square grid so older 9-panel artifacts still render as 3×3.
  const cols = gridPrompt?.cols ?? Math.ceil(Math.sqrt(panels.length));
  const rows = gridPrompt?.rows ?? Math.ceil(panels.length / cols);

  const outputPath = resolveOutputPath(workspace.projectDir, options.output);
  const artifactReferencePath = artifactPathForOutput(workspace.projectDir, outputPath);

  if (!options.dryRun) {
    const png = await renderGridPng({
      panels,
      title: artifact.projectSlug,
      width,
      height,
      rows,
      cols,
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(png).png().toFile(outputPath);
    await writeArtifact(workspace, 'filmmaking-prompts', markGridReady(artifact, artifactReferencePath));
  }

  return {
    projectSlug: options.projectSlug,
    outputPath,
    artifactReferencePath,
    artifactPath,
    width,
    height,
    panelCount: panels.length,
    dryRun: !!options.dryRun,
  };
}

function resolveOutputPath(projectDir: string, output: string | undefined): string {
  if (!output) return join(projectDir, 'assets', 'storyboard-grid.png');
  return isAbsolute(output) ? output : join(projectDir, output);
}

function artifactPathForOutput(projectDir: string, outputPath: string): string {
  const rel = relative(projectDir, outputPath);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    return rel.split(sep).join('/');
  }
  return outputPath;
}

function markGridReady(
  artifact: FilmmakingPromptsArtifact,
  gridPath: string,
): FilmmakingPromptsArtifact {
  const gridSlot = ensureGridSlot(artifact.referenceMap, gridPath);
  const issues = artifact.issues.filter((issue) => (
    issue.code !== 'storyboard-grid-pending'
    && !(issue.code === 'reference-slot-pending' && issue.message.includes(gridSlot.slot))
  ));
  return {
    ...artifact,
    generatedAt: new Date().toISOString(),
    referenceMap: artifact.referenceMap.map((slot) => (
      slot.slot === gridSlot.slot ? { ...slot, path: gridPath, status: 'ready' } : slot
    )),
    seedancePackets: artifact.seedancePackets.map((packet) => ({
      ...packet,
      references: packet.references.map((reference) => (
        reference.slot === gridSlot.slot ? { ...reference, path: gridPath, status: 'ready' } : reference
      )),
      warnings: packet.warnings.filter((warning) => !warning.includes(gridSlot.slot)),
    })),
    issues,
  };
}

function ensureGridSlot(
  referenceMap: FilmmakingReferenceSlot[],
  gridPath: string,
): FilmmakingReferenceSlot {
  const existing = referenceMap.find((slot) => slot.role === 'storyboard-grid');
  if (existing) return existing;
  const slot = `@image${referenceMap.length + 1}`;
  const created: FilmmakingReferenceSlot = {
    slot,
    role: 'storyboard-grid',
    label: '9-panel storyboard grid',
    path: gridPath,
    status: 'ready',
  };
  referenceMap.push(created);
  return created;
}

async function renderGridPng(input: {
  panels: FilmmakingStoryboardPanel[];
  title: string;
  width: number;
  height: number;
  rows: number;
  cols: number;
}): Promise<Buffer> {
  const { rows, cols } = input;
  const margin = Math.round(input.width * 0.028);
  const gap = Math.round(input.width * 0.01);
  const headerHeight = Math.round(input.height * 0.085);
  const footerHeight = Math.round(input.height * 0.025);
  const gridWidth = input.width - margin * 2;
  const gridHeight = input.height - headerHeight - footerHeight - margin;
  const cellWidth = Math.floor((gridWidth - gap * (cols - 1)) / cols);
  const cellHeight = Math.floor((gridHeight - gap * (rows - 1)) / rows);

  const panelNodes = input.panels.map((panel, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = margin + col * (cellWidth + gap);
    const y = headerHeight + row * (cellHeight + gap);
    return renderPanel(panel, x, y, cellWidth, cellHeight);
  }).join('\n');

  const title = escapeXml(input.title.replaceAll('-', ' ').toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}">
  <rect width="100%" height="100%" fill="#111317"/>
  <rect x="0" y="0" width="${input.width}" height="${headerHeight}" fill="#f2efe6"/>
  <text x="${margin}" y="${Math.round(headerHeight * 0.62)}" font-family="${FONT_FAMILY}" font-size="${Math.round(headerHeight * 0.32)}" font-weight="700" fill="#111317">${title}</text>
  <text x="${input.width - margin}" y="${Math.round(headerHeight * 0.62)}" text-anchor="end" font-family="${FONT_FAMILY}" font-size="${Math.round(headerHeight * 0.22)}" font-weight="700" fill="#3d4a57">${input.panels.length}-PANEL STORYBOARD GRID</text>
  ${panelNodes}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function renderPanel(
  panel: FilmmakingStoryboardPanel,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const stripHeight = Math.round(height * 0.28);
  const imageHeight = height - stripHeight;
  const pad = Math.round(width * 0.045);
  const titleSize = Math.max(18, Math.round(width * 0.045));
  const bodySize = Math.max(16, Math.round(width * 0.034));
  const noteSize = Math.max(13, Math.round(width * 0.026));
  const lines = wrapWords(panel.beat, 46, 3);
  const lineNodes = lines.map((line, index) => (
    `<text x="${x + pad}" y="${y + pad + titleSize + 28 + index * (bodySize + 7)}" font-family="${FONT_FAMILY}" font-size="${bodySize}" fill="#f6f3ea">${escapeXml(line)}</text>`
  )).join('\n');
  const noteY = y + imageHeight + Math.round(stripHeight * 0.32);

  return `<g>
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="#20252b" stroke="#f2efe6" stroke-width="3"/>
  <rect x="${x}" y="${y}" width="${width}" height="${imageHeight}" rx="10" fill="#242b33"/>
  <rect x="${x}" y="${y + imageHeight}" width="${width}" height="${stripHeight}" fill="#f2efe6"/>
  <text x="${x + pad}" y="${y + pad + titleSize}" font-family="${FONT_FAMILY}" font-size="${titleSize}" font-weight="800" fill="#f2efe6">PANEL ${panel.panel} ${escapeXml((panel.timecode ?? '').toUpperCase())}</text>
  ${lineNodes}
  <text x="${x + pad}" y="${noteY}" font-family="${FONT_FAMILY}" font-size="${noteSize}" font-weight="800" fill="#111317">CAM: ${escapeXml(panel.cam.toUpperCase())}</text>
  <text x="${x + pad}" y="${noteY + noteSize + 7}" font-family="${FONT_FAMILY}" font-size="${noteSize}" font-weight="800" fill="#111317">MOVE: ${escapeXml(panel.move.toUpperCase())}</text>
  <text x="${x + pad}" y="${noteY + (noteSize + 7) * 2}" font-family="${FONT_FAMILY}" font-size="${noteSize}" font-weight="800" fill="#111317">MOOD: ${escapeXml(panel.mood.toUpperCase())}</text>
</g>`;
}

function wrapWords(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\s+\S+$/, '')}...`;
  }
  return lines;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
