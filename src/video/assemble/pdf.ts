/**
 * PDF slide extraction for the assemble stage (sub-slice 3c).
 *
 * Source of truth: `skills/video-replicator/scripts/extract_pdf_slides.py`.
 *
 * The Python pipeline shells out to `pdf2image`/`pdftoppm` to rasterize each
 * PDF page to a JPEG at a target DPI. We do the equivalent in-process with
 * `pdfjs-dist`: open the PDF, render each page to a canvas, and encode the
 * canvas to PNG/JPG. No external binaries; no network.
 *
 * pdfjs-dist must be imported from its `legacy` build in Node.js — the default
 * (browser) build emits the "Please use the `legacy` build in Node.js
 * environments" warning and assumes browser globals. The legacy build is the
 * supported Node entry point.
 *
 * Rendering needs a canvas backend. `@napi-rs/canvas` is the canvas the
 * pdfjs-dist Node build itself relies on (it ships as pdfjs-dist's canvas
 * dependency), so no additional native dependency is introduced here; we just
 * declare it directly since we import it directly.
 */
// eslint-disable-next-line import/no-unresolved -- legacy entry resolved at runtime
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { VclawError } from '../errors.js';

export type SlideImageFormat = 'png' | 'jpg';

export interface ExtractPdfSlidesInput {
  /** Absolute or cwd-relative path to the source PDF. */
  pdfPath: string;
  /** Directory to write the rendered slide images into. */
  outputDir: string;
  /** Image encoding (default: 'png'). */
  format?: SlideImageFormat;
  /**
   * Render scale relative to the PDF's native point size (default: 2.0).
   *
   * pdfjs renders at 72 DPI when scale=1. The Python default of 200 DPI maps
   * to scale ≈ 2.78; we default to 2.0 (≈144 DPI) for a sensible balance of
   * fidelity vs. file size, overridable per call.
   */
  scale?: number;
  /** Skip rendering + file writes; return page metadata only. */
  dryRun?: boolean;
}

export interface ExtractedPdfPage {
  /** 1-based page index (mirrors the Python `slide_NNN` naming). */
  index: number;
  /** Path to the rendered image (empty string on dry-run). */
  path: string;
  /** Rendered pixel width (= native width × scale). */
  width: number;
  /** Rendered pixel height (= native height × scale). */
  height: number;
}

export interface ExtractPdfSlidesResult {
  pages: ExtractedPdfPage[];
}

const DEFAULT_SCALE = 2.0;

/** `slide_001.png` — zero-padded to 3 digits to match the Python pipeline. */
export function slideImageFilename(index: number, format: SlideImageFormat): string {
  return `slide_${String(index).padStart(3, '0')}.${format}`;
}

/**
 * Render each page of a PDF to an image. Returns per-page metadata.
 *
 * On `dryRun`, the PDF is still opened (so page count + dimensions are real),
 * but no canvas is rendered and no file is written; each page's `path` is the
 * empty string.
 *
 * Throws `VclawError('pdf_parse_failed', ...)` if the document cannot be
 * parsed or a page cannot be rendered.
 */
export async function extractPdfSlides(
  input: ExtractPdfSlidesInput,
): Promise<ExtractPdfSlidesResult> {
  const format: SlideImageFormat = input.format ?? 'png';
  const scale = input.scale && input.scale > 0 ? input.scale : DEFAULT_SCALE;

  let data: Buffer;
  try {
    const { readFile } = await import('node:fs/promises');
    data = await readFile(input.pdfPath);
  } catch (err) {
    throw new VclawError(
      'pdf_parse_failed',
      `Could not read PDF at "${input.pdfPath}": ${(err as Error).message}`,
      { pdfPath: input.pdfPath },
    );
  }

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    // `isEvalSupported: false` keeps us off `eval` in Node; `useSystemFonts`
    // lets the legacy build fall back to system fonts rather than failing.
    doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  } catch (err) {
    throw new VclawError(
      'pdf_parse_failed',
      `Failed to parse PDF "${input.pdfPath}": ${(err as Error).message}`,
      { pdfPath: input.pdfPath },
    );
  }

  const pageCount = doc.numPages;
  const pages: ExtractedPdfPage[] = [];

  try {
    if (!input.dryRun) {
      await mkdir(input.outputDir, { recursive: true });
    }

    for (let index = 1; index <= pageCount; index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);

      if (input.dryRun) {
        pages.push({ index, path: '', width, height });
        page.cleanup();
        continue;
      }

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      // The @napi-rs/canvas 2D context satisfies pdfjs's render contract;
      // pdfjs ships @napi-rs/canvas as its own Node canvas backend. pdfjs types
      // the field as the browser `CanvasRenderingContext2D`, which isn't in the
      // Node lib set, so we widen the render params to `unknown` first.
      const renderParams = {
        canvasContext: ctx,
        viewport,
      } as unknown as Parameters<typeof page.render>[0];
      await page.render(renderParams).promise;

      const filename = slideImageFilename(index, format);
      const path = join(input.outputDir, filename);
      const buffer =
        format === 'jpg' ? await canvas.encode('jpeg', 95) : await canvas.encode('png');
      await writeFile(path, buffer);

      pages.push({ index, path, width, height });
      page.cleanup();
    }
  } catch (err) {
    if (err instanceof VclawError) throw err;
    throw new VclawError(
      'pdf_parse_failed',
      `Failed to render PDF "${input.pdfPath}": ${(err as Error).message}`,
      { pdfPath: input.pdfPath },
    );
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  return { pages };
}
