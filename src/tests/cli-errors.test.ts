import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ErrorCode,
  VclawError,
  errorResponse,
  ALL_ERROR_CODES,
  EXIT_CODES,
} from '../video/errors.js';

describe('error catalog', () => {
  it('every ErrorCode in TS appears in schemas/video/errors.json catalog', async () => {
    const catalogRaw = await readFile(
      join(process.cwd(), 'schemas', 'video', 'errors.json'),
      'utf-8',
    );
    const catalog = JSON.parse(catalogRaw) as { codes: Array<{ code: string }> };
    const jsonCodes = new Set(catalog.codes.map((c) => c.code));
    for (const code of ALL_ERROR_CODES) {
      assert.ok(
        jsonCodes.has(code),
        `Error code '${code}' is in TS but missing from schemas/video/errors.json`,
      );
    }
    for (const entry of catalog.codes) {
      assert.ok(
        (ALL_ERROR_CODES as readonly string[]).includes(entry.code),
        `Catalog has '${entry.code}' but no matching ErrorCode in TS`,
      );
    }
  });

  it('errorResponse produces a stable {code, message, details?} shape', () => {
    const r1 = errorResponse('project_not_found', 'Project foo does not exist');
    assert.deepEqual(r1, {
      code: 'project_not_found',
      message: 'Project foo does not exist',
    });

    const r2 = errorResponse('image_not_found', 'Missing scene-1', { sceneIndex: 1 });
    assert.deepEqual(r2, {
      code: 'image_not_found',
      message: 'Missing scene-1',
      details: { sceneIndex: 1 },
    });
  });

  it('VclawError captures the code on .code', () => {
    const err = new VclawError('invalid_slug', 'Bad slug: --project');
    assert.equal(err.code, 'invalid_slug');
    assert.equal(err.message, 'Bad slug: --project');
    assert.ok(err instanceof Error);
  });

  it('EXIT_CODES TS map matches schemas/video/errors.json exitCode per entry', async () => {
    const catalogRaw = await readFile(
      join(process.cwd(), 'schemas', 'video', 'errors.json'),
      'utf-8',
    );
    const catalog = JSON.parse(catalogRaw) as {
      codes: Array<{ code: string; exitCode: 1 | 2 | 3 }>;
    };
    for (const entry of catalog.codes) {
      assert.equal(
        EXIT_CODES[entry.code as ErrorCode],
        entry.exitCode,
        `EXIT_CODES['${entry.code}'] should be ${entry.exitCode} per JSON catalog`,
      );
      assert.ok([1, 2, 3].includes(entry.exitCode), `exitCode for ${entry.code} should be 1/2/3`);
    }
  });
});
