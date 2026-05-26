/**
 * Title-card image generation for the assemble stage (sub-slice 3d).
 *
 * Source of truth: `skills/video-replicator/scripts/generate_title_card.py`
 * (the `process_image` / text-overlay path). The Python pipeline composes a
 * 16:9 card (1280x720), draws a semi-transparent dark band across the bottom,
 * then renders an upper-cased title (58px, white, with a 2px outline) and an
 * optional subtitle (28px, light blue #C8DCFF) centered in that band.
 *
 * We reproduce that purely in-process with `sharp`: build a base layer (a solid
 * colour, or a center-cropped/resized background image), then composite an SVG
 * holding the band + text on top. SVG-via-sharp is the most portable text path
 * here — no native font installation step, generic-family fallbacks
 * (sans-serif) resolve on every platform, and the geometry is declarative so it
 * matches the Python layout 1:1.
 *
 * Pure module: no CLI wiring (that lands in sub-slice 3i), no network, no
 * FFmpeg hold-video step (the Python Phase-2 `create_hold_video` is a separate
 * concern handled by the stitch sub-slice).
 */
import sharp from 'sharp';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VclawError } from '../errors.js';

export interface GenerateTitleCardInput {
  /** Main heading text. Rendered upper-cased to match the Python pipeline. */
  title: string;
  /** Optional secondary line below the title. */
  subtitle?: string;
  /** Where to write the composed PNG. */
  outputPath: string;
  /** Card width in pixels (default: 1280, matching LANDSCAPE_WIDTH). */
  width?: number;
  /** Card height in pixels (default: 720, matching LANDSCAPE_HEIGHT). */
  height?: number;
  /**
   * Background: a hex colour (e.g. `#101018`) for a solid fill, or a path to an
   * image to center-crop + resize to the card dimensions. Default: solid
   * `#101018` (a dark slate consistent with the Python "dark" style band).
   */
  background?: string;
  /** Title colour (default: white, matching TITLE_CARD_TITLE_COLOR). */
  textColor?: string;
  /** Title font size in px (default: 58, matching TITLE_CARD_TITLE_FONT_SIZE). */
  fontSize?: number;
  /** Skip composition + file write; return dimensions only. */
  dryRun?: boolean;
}

export interface GenerateTitleCardResult {
  /** Path written to (empty string on dry-run). */
  path: string;
  width: number;
  height: number;
}

// Python config defaults (skills/.../config.py).
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_TITLE_FONT_SIZE = 58;
const SUBTITLE_FONT_SIZE = 28;
const DEFAULT_TITLE_COLOR = 'white';
const SUBTITLE_COLOR = '#C8DCFF';
const TITLE_OUTLINE_COLOR = 'black';
const TITLE_OUTLINE_WIDTH = 2;
// Band spans from BAND_TOP to the bottom edge in the Python 720px layout; we
// express it as a fraction so non-default heights keep the same proportion.
const BAND_TOP_FRACTION = 560 / 720;
const BAND_OPACITY = 160 / 255; // 0..1 alpha for the SVG fill.
// Text baselines are offset from the band top (Python: +30 title, +95 subtitle,
// measured against the 720px layout). Keep them proportional to height.
const TITLE_OFFSET_FRACTION = 30 / 720;
const SUBTITLE_OFFSET_FRACTION = 95 / 720;
const FONT_FAMILY = "'Arial', 'Helvetica', sans-serif";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Minimal XML escaping for text injected into the SVG. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Compose a title-card PNG.
 *
 * Throws `VclawError('invalid_video_format', ...)` for non-positive dimensions
 * and `VclawError('unexpected_internal_error', ...)` if sharp composition or
 * the file write fails.
 */
export async function generateTitleCard(
  input: GenerateTitleCardInput,
): Promise<GenerateTitleCardResult> {
  const width = input.width ?? DEFAULT_WIDTH;
  const height = input.height ?? DEFAULT_HEIGHT;

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new VclawError(
      'invalid_video_format',
      `Title-card dimensions must be positive integers (got ${width}x${height}).`,
      { width, height },
    );
  }

  if (input.dryRun) {
    return { path: '', width, height };
  }

  const titleColor = input.textColor ?? DEFAULT_TITLE_COLOR;
  const titleFontSize = input.fontSize ?? DEFAULT_TITLE_FONT_SIZE;
  const subtitleFontSize = Math.round(
    SUBTITLE_FONT_SIZE * (titleFontSize / DEFAULT_TITLE_FONT_SIZE),
  );

  const bandTop = Math.round(height * BAND_TOP_FRACTION);
  const bandHeight = height - bandTop;
  const titleY = bandTop + Math.round(height * TITLE_OFFSET_FRACTION) + titleFontSize;
  const subtitleY =
    bandTop + Math.round(height * SUBTITLE_OFFSET_FRACTION) + subtitleFontSize;
  const centerX = width / 2;

  const titleText = escapeXml(input.title.toUpperCase());
  const subtitleText = input.subtitle ? escapeXml(input.subtitle) : undefined;

  // SVG overlay: band rectangle + outlined title + optional subtitle. Text is
  // center-anchored so it lands centered like the Python textbbox math.
  const titleNode = `<text x="${centerX}" y="${titleY}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${titleFontSize}" font-weight="bold" fill="${titleColor}" stroke="${TITLE_OUTLINE_COLOR}" stroke-width="${TITLE_OUTLINE_WIDTH}" paint-order="stroke fill">${titleText}</text>`;
  const subtitleNode = subtitleText
    ? `<text x="${centerX}" y="${subtitleY}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${subtitleFontSize}" fill="${SUBTITLE_COLOR}">${subtitleText}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="${bandTop}" width="${width}" height="${bandHeight}" fill="black" fill-opacity="${BAND_OPACITY}" />
  ${titleNode}
  ${subtitleNode}
</svg>`;

  let base: sharp.Sharp;
  const background = input.background ?? '#101018';
  if (HEX_RE.test(background)) {
    base = sharp({
      create: {
        width,
        height,
        channels: 4,
        background,
      },
    });
  } else {
    // Treat as an image path: center-crop + resize to the card (cover fit).
    try {
      await stat(background);
    } catch {
      throw new VclawError(
        'image_not_found',
        `Title-card background image not found: "${background}".`,
        { background },
      );
    }
    base = sharp(background).resize(width, height, { fit: 'cover', position: 'center' });
  }

  try {
    const composed = await base
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toBuffer();

    await mkdir(dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, composed);
  } catch (err) {
    if (err instanceof VclawError) throw err;
    throw new VclawError(
      'unexpected_internal_error',
      `Failed to generate title card at "${input.outputPath}": ${(err as Error).message}`,
      { outputPath: input.outputPath },
    );
  }

  return { path: input.outputPath, width, height };
}
