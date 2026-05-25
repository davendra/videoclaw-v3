import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExitCode,
  writeOutput,
  progressLog,
  exitCodeForError,
} from '../video/cli-output.js';
import { VclawError } from '../video/errors.js';

describe('cli-output', () => {
  it('ExitCode enum uses the 0/1/2/3 taxonomy', () => {
    assert.equal(ExitCode.SUCCESS, 0);
    assert.equal(ExitCode.USER_ERROR, 1);
    assert.equal(ExitCode.SYSTEM_ERROR, 2);
    assert.equal(ExitCode.GATE, 3);
  });

  it('exitCodeForError maps VclawError codes to the right ExitCode (via Task 1 EXIT_CODES map)', () => {
    assert.equal(exitCodeForError(new VclawError('invalid_slug', 'x')), ExitCode.USER_ERROR);
    assert.equal(exitCodeForError(new VclawError('provider_unreachable', 'x')), ExitCode.SYSTEM_ERROR);
    assert.equal(exitCodeForError(new VclawError('storyboard_approval_required', 'x')), ExitCode.GATE);
    // Non-VclawError -> SYSTEM_ERROR (unexpected)
    assert.equal(exitCodeForError(new Error('plain error')), ExitCode.SYSTEM_ERROR);
  });

  it('writeOutput emits JSON when stdout is not a TTY (default in spawned child)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-output-'));
    const script = join(root, 'probe.mjs');
    await writeFile(
      script,
      `import { writeOutput } from '${join(process.cwd(), 'dist/video/cli-output.js')}';
       writeOutput({ ok: true, count: 3 });
      `,
    );
    const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; count: number };
    assert.deepEqual(parsed, { ok: true, count: 3 });
  });

  it('progressLog writes to stderr only — stdout stays clean', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-output-'));
    const script = join(root, 'probe.mjs');
    await writeFile(
      script,
      `import { progressLog, writeOutput } from '${join(process.cwd(), 'dist/video/cli-output.js')}';
       progressLog('working on it');
       writeOutput({ final: true });
      `,
    );
    const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '{"final":true}');
    assert.match(result.stderr, /working on it/);
  });
});
