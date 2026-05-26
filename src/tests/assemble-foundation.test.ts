import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ALL_ERROR_CODES } from '../video/errors.js';

describe('assemble foundation', () => {
  it('new assemble error codes are in catalog', () => {
    const expected = ['tts_failed', 'music_gen_failed', 'pdf_parse_failed', 'ffmpeg_failed', 'audio_sync_drift'];
    for (const code of expected) {
      assert.ok((ALL_ERROR_CODES as readonly string[]).includes(code), `${code} should be in ALL_ERROR_CODES`);
    }
  });

  it('assemble-report.schema.json is parseable JSON', async () => {
    const raw = await readFile(
      join(process.cwd(), 'schemas', 'video', 'artifacts', 'assemble-report.schema.json'),
      'utf-8',
    );
    const schema = JSON.parse(raw) as { title: string; required: string[] };
    assert.equal(schema.title, 'assemble-report');
    assert.ok(schema.required.includes('manifest'));
  });

  it('sharp module loads without error', async () => {
    const sharp = (await import('sharp')).default;
    assert.equal(typeof sharp, 'function');
  });

  it('pdfjs-dist module loads', async () => {
    const pdfjs = await import('pdfjs-dist');
    assert.ok(pdfjs.getDocument);
  });
});
