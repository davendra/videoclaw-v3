import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  extractPdfSlides,
  slideImageFilename,
} from '../video/assemble/pdf.js';
import { VclawError } from '../video/errors.js';

// Committed fixture: a minimal, valid 2-page PDF.
//   page 1 MediaBox 612x792 (US Letter) -> 1224x1584 at scale 2
//   page 2 MediaBox 300x200             ->  600x 400 at scale 2
// The distinct dimensions prove per-page sizing is read from the PDF, not
// assumed. Compiled tests live in dist/tests/, so the repo-root fixture is two
// levels up from import.meta.url.
const FIXTURE_PDF = fileURLToPath(
  new URL('../../tests/fixtures/sample-slides.pdf', import.meta.url),
);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

describe('extractPdfSlides', () => {
  it('reports page count + per-page dimensions on dry-run (no files written)', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'vclaw-pdf-dry-'));
    try {
      const { pages } = await extractPdfSlides({
        pdfPath: FIXTURE_PDF,
        outputDir,
        dryRun: true,
      });

      assert.equal(pages.length, 2);
      assert.deepEqual(
        pages.map((p) => p.index),
        [1, 2],
      );
      // scale defaults to 2.0 -> native points doubled.
      assert.deepEqual(
        pages.map((p) => [p.width, p.height]),
        [
          [1224, 1584],
          [600, 400],
        ],
      );
      // dry-run writes nothing.
      assert.deepEqual(pages.map((p) => p.path), ['', '']);
      assert.deepEqual(await readdir(outputDir), []);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('honors a custom scale for dimensions', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'vclaw-pdf-scale-'));
    try {
      const { pages } = await extractPdfSlides({
        pdfPath: FIXTURE_PDF,
        outputDir,
        scale: 1,
        dryRun: true,
      });
      assert.deepEqual(
        pages.map((p) => [p.width, p.height]),
        [
          [612, 792],
          [300, 200],
        ],
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('rasterizes each page to a PNG with correct names + dimensions', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'vclaw-pdf-png-'));
    try {
      const { pages } = await extractPdfSlides({
        pdfPath: FIXTURE_PDF,
        outputDir,
        format: 'png',
      });

      assert.equal(pages.length, 2);
      assert.equal(pages[0].path, join(outputDir, 'slide_001.png'));
      assert.equal(pages[1].path, join(outputDir, 'slide_002.png'));

      for (const page of pages) {
        const bytes = await readFile(page.path);
        assert.ok(bytes.length > 0, 'image should be non-empty');
        assert.ok(
          bytes.subarray(0, 4).equals(PNG_MAGIC),
          `page ${page.index} should be a valid PNG`,
        );
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('rasterizes to JPG when format is jpg', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'vclaw-pdf-jpg-'));
    try {
      const { pages } = await extractPdfSlides({
        pdfPath: FIXTURE_PDF,
        outputDir,
        format: 'jpg',
      });
      assert.equal(pages[0].path, join(outputDir, 'slide_001.jpg'));
      const bytes = await readFile(pages[0].path);
      assert.ok(
        bytes.subarray(0, 3).equals(JPEG_MAGIC),
        'should be a valid JPEG',
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('throws pdf_parse_failed for a missing PDF', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'vclaw-pdf-missing-'));
    try {
      await assert.rejects(
        () =>
          extractPdfSlides({
            pdfPath: join(outputDir, 'does-not-exist.pdf'),
            outputDir,
          }),
        (err: unknown) => {
          assert.ok(err instanceof VclawError);
          assert.equal(err.code, 'pdf_parse_failed');
          return true;
        },
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('throws pdf_parse_failed for non-PDF bytes', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'vclaw-pdf-garbage-'));
    const garbage = join(outputDir, 'not-a.pdf');
    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(garbage, 'this is plainly not a pdf');
      await assert.rejects(
        () => extractPdfSlides({ pdfPath: garbage, outputDir }),
        (err: unknown) => {
          assert.ok(err instanceof VclawError);
          assert.equal(err.code, 'pdf_parse_failed');
          return true;
        },
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('derives zero-padded slide filenames', () => {
    assert.equal(slideImageFilename(1, 'png'), 'slide_001.png');
    assert.equal(slideImageFilename(42, 'jpg'), 'slide_042.jpg');
  });
});
