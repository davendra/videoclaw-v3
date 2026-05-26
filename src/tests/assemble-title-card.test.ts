import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { generateTitleCard } from '../video/assemble/title-card.js';
import { VclawError } from '../video/errors.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('generateTitleCard', () => {
  it('writes a valid PNG at the requested dimensions (title + subtitle)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-title-'));
    try {
      const out = join(dir, 'card.png');
      const result = await generateTitleCard({
        title: 'The Kinetic Shift',
        subtitle: 'Agents, Vibe Coding & the Infrastructure War',
        outputPath: out,
        width: 1280,
        height: 720,
      });

      assert.equal(result.path, out);
      assert.equal(result.width, 1280);
      assert.equal(result.height, 720);

      const bytes = await readFile(out);
      assert.ok(bytes.length > 0, 'image should be non-empty');
      assert.ok(bytes.subarray(0, 4).equals(PNG_MAGIC), 'should be a valid PNG');

      const meta = await sharp(bytes).metadata();
      assert.equal(meta.format, 'png');
      assert.equal(meta.width, 1280);
      assert.equal(meta.height, 720);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders a title-only card at custom dimensions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-title-only-'));
    try {
      const out = join(dir, 'card.png');
      const result = await generateTitleCard({
        title: 'Solo Title',
        outputPath: out,
        width: 800,
        height: 450,
      });

      assert.equal(result.width, 800);
      assert.equal(result.height, 450);

      const meta = await sharp(await readFile(out)).metadata();
      assert.equal(meta.format, 'png');
      assert.equal(meta.width, 800);
      assert.equal(meta.height, 450);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('dry-run returns dimensions without writing a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-title-dry-'));
    try {
      const out = join(dir, 'card.png');
      const result = await generateTitleCard({
        title: 'No Output',
        outputPath: out,
        dryRun: true,
      });

      assert.equal(result.path, '');
      // Defaults match the Python LANDSCAPE config.
      assert.equal(result.width, 1280);
      assert.equal(result.height, 720);
      assert.deepEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws invalid_video_format for non-positive dimensions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-title-bad-'));
    try {
      await assert.rejects(
        () =>
          generateTitleCard({
            title: 'Bad',
            outputPath: join(dir, 'card.png'),
            width: 0,
            height: -10,
          }),
        (err: unknown) => {
          assert.ok(err instanceof VclawError);
          assert.equal(err.code, 'invalid_video_format');
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws image_not_found for a missing background image path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-title-bg-'));
    try {
      await assert.rejects(
        () =>
          generateTitleCard({
            title: 'BG',
            outputPath: join(dir, 'card.png'),
            background: join(dir, 'does-not-exist.png'),
          }),
        (err: unknown) => {
          assert.ok(err instanceof VclawError);
          assert.equal(err.code, 'image_not_found');
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
