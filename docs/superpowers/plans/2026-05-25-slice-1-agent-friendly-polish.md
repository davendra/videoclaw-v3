# Slice 1 — Agent-Friendly Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make videoclaw v3's existing CLI surface deterministic, introspectable, and agent-friendly per the modern best-practice contract (LSP/MCP era). No new behavior; just shape the existing surface so external agents (Claude Code / Codex / Antigravity / Cursor / Warp) can drive it without re-deriving knowledge each call.

**Architecture:** Five thin layers added beside the existing `src/cli/vclaw.ts` dispatch table — error catalog, exit-code taxonomy, TTY-aware output helper, machine-readable schema dump, and a noun-verb alias map. None of them touch the underlying `src/video/*` handlers. Existing JSON output stays; behavior changes only at the I/O boundary (stdout TTY detection) and the error boundary (typed errors replacing freeform `throw new Error`).

**Tech Stack:** TypeScript NodeNext ESM (existing), `node:test` + `assert/strict` (existing), zero new runtime deps. Reuses `process.stdout.isTTY` + `process.exit` from Node 20.

**Source spec:** [`docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`](../specs/2026-05-25-videoclaw-v3-unification-design.md) §4 Slice 1.

**Effort target:** 1-2 weeks, 6 commits.

---

## File Structure

**New files:**

- `schemas/video/errors.json` — JSON Schema for the error-response envelope + the canonical catalog of stable error codes (~30-50 codes). One source of truth.
- `src/video/errors.ts` — `ErrorCode` union type, `VclawError` class (carries code + http-like classification), `errorResponse(code, message, details?)` helper. Pure TS, no I/O.
- `src/video/cli-output.ts` — `ExitCode` enum, `writeOutput(payload)` (JSON when stdout not a TTY, human-readable otherwise), `exitWith(code, error?)` helper, `progressLog(msg)` (always stderr). Centralizes the I/O boundary.
- `src/video/cli-schema.ts` — `buildSchemaDump()` produces the full v3 introspection bundle: commands, flags, artifact schemas, error codes, exit codes. Stateless function, no fs writes.
- `src/tests/cli-errors.test.ts` — catalog uniqueness + envelope shape + JSON-schema-validation tests.
- `src/tests/cli-output.test.ts` — `writeOutput` TTY-vs-non-TTY behavior + `exitWith` payload shape + `progressLog` goes to stderr.
- `src/tests/cli-schema.test.ts` — `vclaw schema --json` returns valid JSON; required top-level keys present; spot-checks against actual artifact schemas.
- `src/tests/cli-exit-codes.test.ts` — exit-code-per-scenario coverage (success / user error / system error / gate).
- `src/tests/cli-noun-verb-aliases.test.ts` — both old kebab form and new noun-verb form dispatch to the same handler.

**Modified files:**

- `src/cli/vclaw.ts` — wire new layers in. Specifically: import the new helpers, add `schema` subcommand to dispatch (~line 165 help block + the dispatch switch at the bottom of the file), wrap top-level main() catch in `exitWith`, replace high-traffic `throw new Error(...)` calls at validation entry points with `throw new VclawError(code, ...)`, add the alias dispatch map for noun-verb consistency.
- `docs/CLI_REFERENCE.md` — new top-level sections: "Exit codes", "Error codes", "`vclaw schema --json`", "JSON output on non-TTY", "Noun-verb command conventions". The skills-hygiene tests guard parts of this file — read their patterns before editing.
- `AGENTS.md` — add a "Agent integration contract" section at the top describing the four guarantees (deterministic command tree, JSON-on-non-TTY, stable error codes, exit-code taxonomy) and pointing at CLI_REFERENCE for detail.

**Tests that must stay green throughout:** every test under `src/tests/*.test.ts` compiled to `dist/tests/`, plus `check:release-readiness-lite`. None of Slice 1's changes should require deleting or skipping a single existing test.

---

## Commit Plan (6 commits)

### Task 1: Error code catalog + envelope (Commit 1)

**Goal:** Establish the canonical list of error codes and the response envelope shape. Pure module — no CLI wiring yet. Unblocks Task 3.

**Files:**
- Create: `schemas/video/errors.json`
- Create: `src/video/errors.ts`
- Create: `src/tests/cli-errors.test.ts`

- [ ] **Step 1.1: Write the failing test for the catalog + envelope**

Create `src/tests/cli-errors.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ErrorCode,
  VclawError,
  errorResponse,
  ALL_ERROR_CODES,
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
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `npm run build && node --test dist/tests/cli-errors.test.js`

Expected: FAIL with "Cannot find module '../video/errors.js'" (errors.ts doesn't exist yet).

- [ ] **Step 1.3: Create the errors module**

Create `src/video/errors.ts`:

```typescript
/**
 * Stable error codes for vclaw CLI output.
 *
 * The TS enum + the JSON catalog at schemas/video/errors.json are kept in
 * sync by a test in cli-errors.test.ts. Add codes here AND in the JSON.
 *
 * Conventions:
 * - snake_case
 * - Specific over generic (prefer "image_not_found" over "not_found")
 * - Stable: never rename a code once shipped; deprecate and add a new one
 */
export const ALL_ERROR_CODES = [
  // User-input errors (exit code 1)
  'invalid_slug',
  'project_not_found',
  'missing_required_flag',
  'unknown_subcommand',
  'invalid_mode',
  'invalid_aspect_ratio',
  'image_not_found',
  'asset_not_found',
  'template_not_found',
  'character_not_found',
  'duplicate_project',
  'directory_not_writable',

  // System errors (exit code 2)
  'provider_unreachable',
  'adapter_command_failed',
  'env_var_missing',
  'native_transport_failed',
  'schema_validation_failed',
  'workspace_corrupt',
  'unexpected_internal_error',

  // Gates (exit code 3)
  'storyboard_approval_required',
  'storyboard_review_stale',
  'execution_blocked_by_readiness',
] as const;

export type ErrorCode = typeof ALL_ERROR_CODES[number];

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  const out: ErrorResponse = { code, message };
  if (details !== undefined) out.details = details;
  return out;
}

/**
 * Throwable error that carries an ErrorCode. The top-level main() catch in
 * vclaw.ts unwraps VclawError into an ErrorResponse + appropriate ExitCode.
 */
export class VclawError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'VclawError';
    this.code = code;
    this.details = details;
  }
}
```

- [ ] **Step 1.4: Create the JSON catalog**

Create `schemas/video/errors.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "vclaw error response",
  "description": "Stable error-code catalog for vclaw CLI JSON output. The TS source-of-truth is src/video/errors.ts ALL_ERROR_CODES.",
  "type": "object",
  "required": ["code", "message"],
  "properties": {
    "code": { "type": "string", "enum": [] },
    "message": { "type": "string" },
    "details": { "type": "object", "additionalProperties": true }
  },
  "codes": [
    { "code": "invalid_slug", "exitCode": 1, "description": "Slug is missing or fails isProjectSlug validation." },
    { "code": "project_not_found", "exitCode": 1, "description": "Referenced project slug has no workspace on disk." },
    { "code": "missing_required_flag", "exitCode": 1, "description": "A flag required by the subcommand was not provided." },
    { "code": "unknown_subcommand", "exitCode": 1, "description": "The subcommand is not in the dispatch table." },
    { "code": "invalid_mode", "exitCode": 1, "description": "--mode value is not 'storyboard' or 'director'." },
    { "code": "invalid_aspect_ratio", "exitCode": 1, "description": "Aspect ratio is not 16:9 / 9:16 / 1:1." },
    { "code": "image_not_found", "exitCode": 1, "description": "Referenced image file (asset or reference) is not on disk." },
    { "code": "asset_not_found", "exitCode": 1, "description": "Referenced asset (image/video/audio) is not on disk." },
    { "code": "template_not_found", "exitCode": 1, "description": "Referenced template name is not registered." },
    { "code": "character_not_found", "exitCode": 1, "description": "Referenced character name is not in the project's characters/." },
    { "code": "duplicate_project", "exitCode": 1, "description": "vclaw video init on a slug whose workspace already exists." },
    { "code": "directory_not_writable", "exitCode": 1, "description": "Workspace root is not writable." },
    { "code": "provider_unreachable", "exitCode": 2, "description": "Provider HTTP / native transport returned a non-recoverable error." },
    { "code": "adapter_command_failed", "exitCode": 2, "description": "User-provided ..._ADAPTER command exited non-zero." },
    { "code": "env_var_missing", "exitCode": 2, "description": "Required env var (e.g. USEAPI_API_TOKEN) is not set for the chosen route." },
    { "code": "native_transport_failed", "exitCode": 2, "description": "native-veo / native-seedance / native-runway hit an internal error." },
    { "code": "schema_validation_failed", "exitCode": 2, "description": "Artifact failed its JSON-Schema validation." },
    { "code": "workspace_corrupt", "exitCode": 2, "description": "projects/<slug>/ has missing or malformed canonical files." },
    { "code": "unexpected_internal_error", "exitCode": 2, "description": "Catch-all for unanticipated exceptions; always a bug." },
    { "code": "storyboard_approval_required", "exitCode": 3, "description": "Director-mode execute requires storyboard.md approval." },
    { "code": "storyboard_review_stale", "exitCode": 3, "description": "Director storyboard review state is 'stale'; re-run storyboard-review." },
    { "code": "execution_blocked_by_readiness", "exitCode": 3, "description": "readiness check reported blockers; resolve before plan/execute." }
  ]
}
```

- [ ] **Step 1.5: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/cli-errors.test.js`

Expected: PASS (3 tests).

- [ ] **Step 1.6: Commit**

```bash
git add schemas/video/errors.json src/video/errors.ts src/tests/cli-errors.test.ts
git commit -m "Slice 1: error code catalog + VclawError envelope (foundation)"
```

---

### Task 2: Exit codes + TTY-aware output (Commit 2)

**Goal:** Add the I/O-boundary helpers. Still pure modules — no CLI wiring yet. Unblocks Tasks 3-6.

**Files:**
- Create: `src/video/cli-output.ts`
- Create: `src/tests/cli-output.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/tests/cli-output.test.ts`:

```typescript
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

  it('exitCodeForError maps VclawError codes to the right ExitCode', () => {
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
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/cli-output.test.js`

Expected: FAIL with "Cannot find module '../video/cli-output.js'".

- [ ] **Step 2.3: Create the cli-output module**

Create `src/video/cli-output.ts`:

```typescript
/**
 * I/O boundary helpers for the vclaw CLI.
 *
 * Three responsibilities:
 *  1. ExitCode taxonomy (0=success, 1=user error, 2=system error, 3=gate)
 *  2. writeOutput() — JSON when stdout is piped, human-readable when TTY
 *  3. progressLog() — progress chatter always goes to stderr
 *
 * No subcommand handler should call process.stdout.write or process.exit
 * directly; route through these helpers so agent-callers get a uniform
 * contract.
 */

import { VclawError, errorResponse, type ErrorResponse, type ErrorCode } from './errors.js';

export const ExitCode = {
  SUCCESS: 0,
  USER_ERROR: 1,
  SYSTEM_ERROR: 2,
  GATE: 3,
} as const;
export type ExitCode = typeof ExitCode[keyof typeof ExitCode];

const USER_ERROR_CODES = new Set<ErrorCode>([
  'invalid_slug',
  'project_not_found',
  'missing_required_flag',
  'unknown_subcommand',
  'invalid_mode',
  'invalid_aspect_ratio',
  'image_not_found',
  'asset_not_found',
  'template_not_found',
  'character_not_found',
  'duplicate_project',
  'directory_not_writable',
]);

const GATE_CODES = new Set<ErrorCode>([
  'storyboard_approval_required',
  'storyboard_review_stale',
  'execution_blocked_by_readiness',
]);

export function exitCodeForError(err: unknown): ExitCode {
  if (err instanceof VclawError) {
    if (USER_ERROR_CODES.has(err.code)) return ExitCode.USER_ERROR;
    if (GATE_CODES.has(err.code)) return ExitCode.GATE;
    return ExitCode.SYSTEM_ERROR;
  }
  return ExitCode.SYSTEM_ERROR;
}

export interface WriteOutputOptions {
  /** Force JSON regardless of TTY (useful for `--json` flags). */
  json?: boolean;
  /** Override TTY detection (test hook). */
  isTTY?: boolean;
  /** Override stream (test hook). */
  stream?: NodeJS.WritableStream;
}

export function writeOutput(payload: unknown, options: WriteOutputOptions = {}): void {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.isTTY ?? (stream as NodeJS.WriteStream).isTTY ?? false;
  const useJson = options.json ?? !isTTY;
  if (useJson) {
    stream.write(`${JSON.stringify(payload)}\n`);
  } else {
    // TTY: pretty-print for humans. JSON.stringify with 2-space indent is
    // already a reasonable "human" form for our shape-stable payloads.
    stream.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

/**
 * Progress chatter. Always stderr — stdout stays pure JSON for agents.
 */
export function progressLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Top-level catch helper. Converts an unknown error into a JSON
 * ErrorResponse on stdout (so agents can parse it), human message on
 * stderr, and the appropriate process.exit code.
 *
 * Never returns; types as `never`.
 */
export function exitWith(err: unknown, options: WriteOutputOptions = {}): never {
  const code = exitCodeForError(err);
  if (err instanceof VclawError) {
    const response = errorResponse(err.code, err.message, err.details);
    writeOutput(response, options);
    progressLog(`[${err.code}] ${err.message}`);
  } else {
    const message = err instanceof Error ? err.message : String(err);
    const response: ErrorResponse = {
      code: 'unexpected_internal_error',
      message,
    };
    writeOutput(response, options);
    progressLog(`[unexpected_internal_error] ${message}`);
  }
  process.exit(code);
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/cli-output.test.js`

Expected: PASS (4 tests).

- [ ] **Step 2.5: Commit**

```bash
git add src/video/cli-output.ts src/tests/cli-output.test.ts
git commit -m "Slice 1: ExitCode + writeOutput/progressLog/exitWith helpers"
```

---

### Task 3: `vclaw schema --json` subcommand (Commit 3)

**Goal:** The single biggest agent-discoverability deliverable. One command returns the entire v3 contract: every subcommand, every flag, every artifact schema, every error code, every exit code. Agents call this once on first contact, then drive the CLI deterministically.

**Files:**
- Create: `src/video/cli-schema.ts`
- Create: `src/tests/cli-schema.test.ts`
- Modify: `src/cli/vclaw.ts` (add `schema` dispatch case)

- [ ] **Step 3.1: Write the failing test**

Create `src/tests/cli-schema.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildSchemaDump } from '../video/cli-schema.js';

describe('cli-schema', () => {
  it('buildSchemaDump returns the v3 contract envelope', () => {
    const dump = buildSchemaDump();
    assert.equal(typeof dump.version, 'string', 'version present');
    assert.ok(Array.isArray(dump.commands), 'commands is an array');
    assert.ok(dump.commands.length >= 30, 'at least 30 commands documented');
    assert.ok(Array.isArray(dump.errorCodes), 'errorCodes is an array');
    assert.ok(dump.errorCodes.length >= 20, 'at least 20 error codes');
    assert.deepEqual(Object.keys(dump.exitCodes).sort(), ['GATE', 'SUCCESS', 'SYSTEM_ERROR', 'USER_ERROR']);
    assert.equal(typeof dump.artifactSchemas, 'object');
    assert.ok('brief' in dump.artifactSchemas, 'brief schema embedded');
    assert.ok('storyboard' in dump.artifactSchemas, 'storyboard schema embedded');
  });

  it('every command has at least a name and a usage string', () => {
    const dump = buildSchemaDump();
    for (const cmd of dump.commands) {
      assert.equal(typeof cmd.name, 'string', `command missing name: ${JSON.stringify(cmd)}`);
      assert.equal(typeof cmd.usage, 'string', `command ${cmd.name} missing usage`);
    }
  });

  it('`vclaw schema --json` end-to-end returns parseable JSON', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
    const result = spawnSync(process.execPath, [cliPath, 'schema', '--json'], {
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as { version: string; commands: unknown[] };
    assert.equal(typeof parsed.version, 'string');
    assert.ok(Array.isArray(parsed.commands));
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npm run build 2>&1 | head -5`

Expected: TypeScript compilation error on the missing `cli-schema.ts` module.

- [ ] **Step 3.3: Create cli-schema.ts**

Create `src/video/cli-schema.ts`:

```typescript
/**
 * vclaw schema --json — the v3 introspection bundle.
 *
 * Returns the full CLI contract in one call: commands, flags, artifact
 * schemas, error codes, exit codes. Agents call this once to learn the
 * surface, then drive the CLI without further introspection.
 *
 * Stateless function — no fs writes, no env reads, no network. Pure
 * read of bundled JSON + reflection of the dispatch table.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ERROR_CODES } from './errors.js';
import { ExitCode } from './cli-output.js';

export interface CommandFlag {
  name: string;
  /** "value" if it takes an argument, "boolean" if it's a switch. */
  kind: 'value' | 'boolean';
  description?: string;
}

export interface CommandSpec {
  name: string;
  usage: string;
  description?: string;
  flags?: CommandFlag[];
  /** Backwards-compat aliases that dispatch to this command. */
  aliases?: string[];
}

export interface SchemaDump {
  version: string;
  generatedAt: string;
  exitCodes: Record<string, number>;
  errorCodes: ReadonlyArray<string>;
  commands: CommandSpec[];
  artifactSchemas: Record<string, unknown>;
}

/**
 * Hand-curated list of subcommands. Mirrors the dispatch switch at the
 * bottom of src/cli/vclaw.ts. Keeping these in sync is a test (see
 * cli-schema.test.ts — it spot-checks count > 30).
 *
 * Future improvement: generate this from the dispatch table at build time.
 * For v3.0.0-alpha, hand-curation is fine — there are ~50 commands and
 * they don't change often.
 */
const COMMANDS: CommandSpec[] = [
  // --- core lifecycle ---
  { name: 'video providers', usage: 'vclaw video providers [--workspace-root <path>]' },
  { name: 'video verify-env', usage: 'vclaw video verify-env [--root <path>] [--workspace-root <path>]' },
  { name: 'video init', usage: 'vclaw video init <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video brief', usage: 'vclaw video brief --project <slug> --title <title> --intent <intent> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]' },
  { name: 'video storyboard', usage: 'vclaw video storyboard --project <slug> (--scene <text> [--scene <text> ...] | --template <template-id>) [--root <path>] [--mode storyboard|director]' },
  { name: 'video assets', usage: 'vclaw video assets --project <slug> --asset <kind:path[:sceneIndex][:backend]> [--asset ...] [--root <path>]' },
  { name: 'video review', usage: 'vclaw video review --project <slug> --verdict pass|retry|fail [--finding <text> ...] [--root <path>]' },
  { name: 'video publish', usage: 'vclaw video publish --project <slug> --status ready|published|blocked [--final-output <path>] [--note <text> ...] [--root <path>]' },

  // --- creator-mode pipeline drivers ---
  { name: 'video create', usage: 'vclaw video create "<intent>" [--project <slug>] [...]' },
  { name: 'video auto', usage: 'vclaw video auto "<intent>" [--project <slug>] [...]' },
  { name: 'video iterate', usage: 'vclaw video iterate "<intent>" [--project <slug>] [...]' },
  { name: 'video run-pipeline', usage: 'vclaw video run-pipeline "<intent>" [--project <slug>] [...]' },
  { name: 'video approve', usage: 'vclaw video approve --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run]' },

  // --- readiness + execution ---
  { name: 'video readiness', usage: 'vclaw video readiness --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video plan', usage: 'vclaw video plan --project <slug> [--root <path>] [--mode storyboard|director]', aliases: ['video execution-plan'] },
  { name: 'video produce', usage: 'vclaw video produce --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run] [--scene <sceneIndex> ...]', aliases: ['video execute'] },
  { name: 'video execute-status', usage: 'vclaw video execute-status --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video execute-cancel', usage: 'vclaw video execute-cancel --project <slug> [--root <path>] [--mode storyboard|director]' },

  // --- director gate ---
  { name: 'video director-preflight', usage: 'vclaw video director-preflight --project <slug> [--root <path>] [--apply-content-fixes]' },
  { name: 'video storyboard-review', usage: 'vclaw video storyboard-review --project <slug> [--root <path>] [--mode storyboard|director] [--apply-content-fixes]' },

  // --- review UI ---
  { name: 'video review-ui', usage: 'vclaw video review-ui --project <slug> [--root <path>] [--host <host>] [--port <port>] [--ui-path <path>] [--dry-run]' },
  { name: 'video review-autopilot', usage: 'vclaw video review-autopilot --project <slug> [--root <path>] [--template <template-id>] [--character <name>] [--run-id <id>]' },

  // --- character management ---
  { name: 'video character-add', usage: 'vclaw video character-add --project <slug> --name <name> [--gb-id <id>] [...] [--root <path>]' },
  { name: 'video character-auto-create', usage: 'vclaw video character-auto-create --project <slug> --input <json-path> [--root <path>] [--api-url <url>] [--dry-run]' },
  { name: 'video character-import-library', usage: 'vclaw video character-import-library --project <slug> --intent "<text>" [--root <path>] [--api-url <url>]' },
  { name: 'video character-list', usage: 'vclaw video character-list --project <slug> [--root <path>]' },
  { name: 'video character-show', usage: 'vclaw video character-show --project <slug> --name <name> [--root <path>]' },
  { name: 'video character-consistency', usage: 'vclaw video character-consistency --project <slug> [--root <path>]' },

  // --- reference sheets ---
  { name: 'video reference-sheet-add', usage: 'vclaw video reference-sheet-add --project <slug> --type <type> --name <name> [...]' },
  { name: 'video reference-sheet-list', usage: 'vclaw video reference-sheet-list --project <slug> [--type <sheet-type>] [--root <path>]' },
  { name: 'video reference-sheet-show', usage: 'vclaw video reference-sheet-show --project <slug> --id <sheet-id> [--root <path>]' },
  { name: 'video reference-sheet-bind', usage: 'vclaw video reference-sheet-bind --project <slug> --id <sheet-id> --scene <sceneIndex> [...]' },
  { name: 'video reference-sheet-validate', usage: 'vclaw video reference-sheet-validate --project <slug> [--root <path>]' },

  // --- candidates ---
  { name: 'video candidates-list', usage: 'vclaw video candidates-list --project <slug> [--scene <sceneIndex>] [--root <path>]' },
  { name: 'video candidates-show', usage: 'vclaw video candidates-show --project <slug> --candidate-id <id> [--root <path>]' },
  { name: 'video select-candidate', usage: 'vclaw video select-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]' },
  { name: 'video reject-candidate', usage: 'vclaw video reject-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]' },
  { name: 'video reroll-scene', usage: 'vclaw video reroll-scene --project <slug> --scene <sceneIndex> [...]' },
  { name: 'video chain-from', usage: 'vclaw video chain-from --project <slug> --scene <sceneIndex> --source-scene <sceneIndex> [...]' },
  { name: 'video unchain', usage: 'vclaw video unchain --project <slug> --scene <sceneIndex> [...]' },

  // --- templates + clone ---
  { name: 'video template-list', usage: 'vclaw video template-list [--root <path>]' },
  { name: 'video template-show', usage: 'vclaw video template-show --name <template-name> [--root <path>]' },
  { name: 'video clone-plan', usage: 'vclaw video clone-plan --template <template-name> --project <slug> --intent <text> [--root <path>]' },

  // --- portfolio + status ---
  { name: 'video list', usage: 'vclaw video list [--root <path>]' },
  { name: 'video index', usage: 'vclaw video index [--root <path>] [--output <path>]' },
  { name: 'video metrics', usage: 'vclaw video metrics [--root <path>] [--mode storyboard|director]' },
  { name: 'video next-actions', usage: 'vclaw video next-actions [--root <path>] [--mode storyboard|director]' },
  { name: 'video report', usage: 'vclaw video report [--root <path>] [--mode storyboard|director]' },
  { name: 'video status', usage: 'vclaw video status --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video doctor-project', usage: 'vclaw video doctor-project --project <slug> [--root <path>] [--mode storyboard|director]' },
  { name: 'video doctor-portfolio', usage: 'vclaw video doctor-portfolio [--root <path>] [--mode storyboard|director]' },

  // --- export + obsidian ---
  { name: 'video export-csv', usage: 'vclaw video export-csv [--root <path>] [--output-dir <path>] [--mode storyboard|director]' },
  { name: 'video export-obsidian', usage: 'vclaw video export-obsidian --project <slug> [--root <path>] [--output-dir <path>] [--mode storyboard|director]' },
  { name: 'video sync-obsidian', usage: 'vclaw video sync-obsidian [--root <path>] [--output-dir <path>] [--mode storyboard|director]' },

  // --- introspection ---
  { name: 'schema', usage: 'vclaw schema [--json]', description: 'Dump the full v3 contract (commands, flags, artifact schemas, error codes, exit codes) for agent introspection.' },
];

function loadArtifactSchemas(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/video/cli-schema.ts compiles to dist/video/cli-schema.js — schemas
  // live at <repo-root>/schemas/video/. Walk up two levels from dist/video.
  const schemasDir = join(here, '..', '..', 'schemas', 'video', 'artifacts');
  const out: Record<string, unknown> = {};
  try {
    for (const file of readdirSync(schemasDir)) {
      if (!file.endsWith('.schema.json')) continue;
      const name = file.replace(/\.schema\.json$/, '');
      const raw = readFileSync(join(schemasDir, file), 'utf-8');
      out[name] = JSON.parse(raw);
    }
  } catch {
    // Schemas dir might not exist in some test envs — leave empty.
  }
  return out;
}

export function buildSchemaDump(): SchemaDump {
  return {
    version: '3.0.0-alpha.0',
    generatedAt: new Date().toISOString(),
    exitCodes: { ...ExitCode },
    errorCodes: ALL_ERROR_CODES,
    commands: COMMANDS,
    artifactSchemas: loadArtifactSchemas(),
  };
}
```

- [ ] **Step 3.4: Wire `schema` into vclaw.ts dispatch**

Open `src/cli/vclaw.ts`. Find the dispatch switch (around line ~3000+; grep for `case 'video':`).

Add a top-level case BEFORE the `video` case:

```typescript
// (somewhere near the top of the main switch, before `case 'video':`)
case 'schema': {
  const { buildSchemaDump } = await import('../video/cli-schema.js');
  const { writeOutput } = await import('../video/cli-output.js');
  // schema is always JSON, regardless of TTY — agents are the audience.
  writeOutput(buildSchemaDump(), { json: true });
  return;
}
```

(If the existing dispatch uses a different pattern — e.g., a top-level if/else — adapt accordingly. The point is: `vclaw schema [--json]` should resolve to `buildSchemaDump()` printed as JSON.)

- [ ] **Step 3.5: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/cli-schema.test.js`

Expected: PASS (3 tests).

- [ ] **Step 3.6: Smoke-check the command by hand**

Run: `node dist/cli/vclaw.js schema --json | head -20`

Expected: valid JSON starting with `{"version":"3.0.0-alpha.0",...`

- [ ] **Step 3.7: Commit**

```bash
git add src/video/cli-schema.ts src/cli/vclaw.ts src/tests/cli-schema.test.ts
git commit -m "Slice 1: vclaw schema --json — agent-discoverable contract dump"
```

---

### Task 4: Migrate top-level main() catch to exitWith (Commit 4)

**Goal:** Wire the new error/exit helpers into the actual CLI's top-level error handling. Subcommand handlers can still `throw new Error(...)` — those become `unexpected_internal_error` with exit code 2 — but anything wrapped in `VclawError` now gets the proper code + exit code.

**Files:**
- Modify: `src/cli/vclaw.ts` (top-level `main()` function)
- Create: `src/tests/cli-exit-codes.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `src/tests/cli-exit-codes.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('cli exit codes', () => {
  it('exits 0 on success (vclaw schema)', () => {
    const r = spawnSync(process.execPath, [cliPath, 'schema'], { encoding: 'utf-8' });
    assert.equal(r.status, 0);
  });

  it('exits 1 (USER_ERROR) on unknown subcommand', () => {
    const r = spawnSync(process.execPath, [cliPath, 'this-subcommand-does-not-exist'], {
      encoding: 'utf-8',
    });
    assert.equal(r.status, 1, r.stderr);
    const payload = JSON.parse(r.stdout) as { code: string };
    assert.equal(payload.code, 'unknown_subcommand');
  });

  it('exits 1 (USER_ERROR) on missing required slug', () => {
    const r = spawnSync(process.execPath, [cliPath, 'video', 'init'], {
      encoding: 'utf-8',
    });
    assert.equal(r.status, 1, r.stderr);
    const payload = JSON.parse(r.stdout) as { code: string };
    // Either missing_required_flag or invalid_slug is acceptable here.
    assert.ok(['missing_required_flag', 'invalid_slug'].includes(payload.code));
  });
});
```

- [ ] **Step 4.2: Run to verify it fails (or partially fails)**

Run: `npm run build && node --test dist/tests/cli-exit-codes.test.js`

Expected: at least the `unknown_subcommand` test fails (vclaw currently doesn't catch and tag this with a code).

- [ ] **Step 4.3: Update main() catch + unknown-subcommand handler in vclaw.ts**

In `src/cli/vclaw.ts`, find the top-level `main()` function. Wrap its try/catch:

```typescript
// Near the top of main() or just above where dispatch happens:
import { exitWith } from '../video/cli-output.js';
import { VclawError } from '../video/errors.js';

export async function main(): Promise<void> {
  try {
    // ... existing argv parsing + dispatch ...

    // For the unknown-subcommand fall-through (where vclaw currently throws
    // or prints "Unknown command"), replace with:
    throw new VclawError(
      'unknown_subcommand',
      `Unknown subcommand: ${subcommand}. Run \`vclaw schema --json\` for the full command list.`,
      { subcommand },
    );
  } catch (err) {
    exitWith(err);
  }
}
```

Also: convert `if (!slug) throw new Error('video init requires a project slug');` patterns at the entry points of `handleVideoInit`, `handleVideoBrief`, etc. to `VclawError('missing_required_flag', ...)`. **Scope-limit for this commit:** only touch the 5 most-used entry points (init, brief, storyboard, assets, execute). The remaining ~40 handlers stay on freeform errors — that gets cleaned up incrementally in v3.x alphas.

- [ ] **Step 4.4: Run all tests to verify**

Run: `npm test 2>&1 | tail -30`

Expected: green. The exit-code tests now pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-exit-codes.test.ts
git commit -m "Slice 1: wire exitWith + VclawError into main() + 5 entry points"
```

---

### Task 5: Noun-verb consistency alias map (Commit 5)

**Goal:** Don't break existing scripts/agents that learned the kebab-case forms, but give the v3 noun-verb shape a clear path forward. Add bidirectional aliases for the most common cases.

**Files:**
- Modify: `src/cli/vclaw.ts` (add alias table near dispatch)
- Create: `src/tests/cli-noun-verb-aliases.test.ts`

- [ ] **Step 5.1: Decide the alias map**

Edit `src/cli/vclaw.ts`. Add this near the top of `main()` (after argv parsing, before dispatch):

```typescript
// v3 noun-verb consistency. Both forms dispatch to the same handler.
// The kebab form is treated as the canonical name internally; the
// noun-verb form is the user-facing v3 preference. `vclaw schema --json`
// lists the canonical name; aliases are documented in CLI_REFERENCE.md.
const NOUN_VERB_ALIASES: Record<string, string> = {
  // user types -> canonical
  'export csv': 'export-csv',
  'character add': 'character-add',
  'character list': 'character-list',
  'character show': 'character-show',
  'character auto-create': 'character-auto-create',
  'character import-library': 'character-import-library',
  'character consistency': 'character-consistency',
  'reference-sheet add': 'reference-sheet-add',
  'reference-sheet list': 'reference-sheet-list',
  'reference-sheet show': 'reference-sheet-show',
  'reference-sheet bind': 'reference-sheet-bind',
  'reference-sheet validate': 'reference-sheet-validate',
  'candidates list': 'candidates-list',
  'candidates show': 'candidates-show',
  'storyboard review': 'storyboard-review',
  'storyboard still-add': 'storyboard-still-add',
  'review ui': 'review-ui',
  'review autopilot': 'review-autopilot',
  'execute status': 'execute-status',
  'execute cancel': 'execute-cancel',
  'doctor project': 'doctor-project',
  'doctor portfolio': 'doctor-portfolio',
  'export obsidian': 'export-obsidian',
  'sync obsidian': 'sync-obsidian',
  'verify env': 'verify-env',
  'verify final': 'verify-final',
};

// argv[2..] is the subcommand. Try the 2-word form first; fall back to 1.
function resolveSubcommand(args: string[]): { canonical: string; rest: string[] } {
  if (args.length >= 2) {
    const twoWord = `${args[0]} ${args[1]}`;
    if (NOUN_VERB_ALIASES[twoWord]) {
      return { canonical: NOUN_VERB_ALIASES[twoWord], rest: args.slice(2) };
    }
  }
  return { canonical: args[0] ?? '', rest: args.slice(1) };
}
```

Then route the dispatch through `resolveSubcommand(args)` instead of `args[0]` directly.

- [ ] **Step 5.2: Write the test**

Create `src/tests/cli-noun-verb-aliases.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function runVclaw(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8' });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe('noun-verb aliases', () => {
  it('vclaw video character list works (noun-verb form)', () => {
    // Should fail with missing --project (not unknown_subcommand)
    const r = runVclaw(['video', 'character', 'list']);
    if (r.status !== 0) {
      const payload = JSON.parse(r.stdout) as { code?: string };
      assert.notEqual(payload.code, 'unknown_subcommand',
        'noun-verb form should resolve, not fail as unknown subcommand');
    }
  });

  it('vclaw video character-list (kebab form) still works (backwards compat)', () => {
    const r = runVclaw(['video', 'character-list']);
    if (r.status !== 0) {
      const payload = JSON.parse(r.stdout) as { code?: string };
      assert.notEqual(payload.code, 'unknown_subcommand');
    }
  });
});
```

- [ ] **Step 5.3: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/cli-noun-verb-aliases.test.js`

Expected: PASS (2 tests).

- [ ] **Step 5.4: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-noun-verb-aliases.test.ts
git commit -m "Slice 1: noun-verb aliases for backwards-compat dispatch"
```

---

### Task 6: Documentation update + AGENTS contract section (Commit 6)

**Goal:** Document the new v3 contract. Anything an agent or operator needs to know about the agent-friendly surface lives in `docs/CLI_REFERENCE.md` and `AGENTS.md`.

**Files:**
- Modify: `docs/CLI_REFERENCE.md` (add 4 new sections at the top)
- Modify: `AGENTS.md` (add "Agent integration contract" section at the top)
- Modify: `CHANGELOG.md` (update the v3.0.0-alpha.0 section)

- [ ] **Step 6.1: Read existing CLI_REFERENCE.md structure**

Run: `head -60 /Users/davendrapatel/Documents/GitHub/videoclaw-v3/docs/CLI_REFERENCE.md`

Note: there's a top section about command surface. The new sections insert BEFORE that — they're contract-level, not command-level.

- [ ] **Step 6.2: Add the four new sections to CLI_REFERENCE.md**

Insert at the top of `docs/CLI_REFERENCE.md`, after the title and intro paragraph but before the "Commands" or "Subcommands" section:

````markdown
## Agent-friendly surface (v3)

These four properties hold across every `vclaw` subcommand. They are the
contract external agents (Claude Code / Codex / Antigravity / Cursor) can
rely on.

### 1. JSON on non-TTY

When `stdout` is not a TTY (i.e., piped to another command or captured
by an agent), every subcommand writes JSON to stdout. Human-readable
formatting is reserved for interactive TTY use. Progress chatter
(spinners, status updates) always goes to `stderr`.

```bash
# TTY (human): pretty-printed
vclaw video providers

# Non-TTY (agent / pipe): newline-terminated JSON
vclaw video providers | jq '.routes[].routeId'
```

### 2. Exit-code taxonomy

| Code | Name | Meaning |
|---:|---|---|
| 0 | SUCCESS | Command completed without errors. |
| 1 | USER_ERROR | Bad input — invalid flag, missing argument, validation failure. **Retrying with the same input will fail the same way.** |
| 2 | SYSTEM_ERROR | Environmental failure — provider down, disk full, missing env var. **Retry may succeed.** |
| 3 | GATE | Gated by an approval / readiness check (e.g., director storyboard.md not approved yet). **The command CAN succeed once the gate clears.** |

Agents decide retry strategy from the exit code. Code 1 means "fix the
input and retry"; code 2 means "investigate the system and try later";
code 3 means "do the gate-clearing work first, then retry."

### 3. Stable error codes

On any non-zero exit, stdout contains a JSON envelope with a stable
string `code` field. The full catalog lives at
[`schemas/video/errors.json`](../schemas/video/errors.json) and the
TS source-of-truth is `src/video/errors.ts` `ALL_ERROR_CODES`.

```json
{
  "code": "project_not_found",
  "message": "No workspace at projects/foo/",
  "details": { "slug": "foo" }
}
```

Codes are **stable** — once shipped, they never change name. New codes
get added; old ones may get a deprecation note but the string stays
working for old agents.

### 4. Single-call discovery: `vclaw schema --json`

Returns the full v3 contract in one call:

- `version`: the v3 release this dump comes from
- `commands`: array of `{name, usage, flags, aliases?}`
- `exitCodes`: the 0/1/2/3 taxonomy
- `errorCodes`: the full ALL_ERROR_CODES list
- `artifactSchemas`: every `schemas/video/artifacts/*.schema.json` embedded by name

Agents should call this once on first contact, then drive the CLI from
the dump without further introspection. Cheaper than per-command
`--help` parsing.

```bash
vclaw schema --json | jq '.commands | map(.name)'
```

## Noun-verb command conventions

v3 prefers noun-verb command shape (`vclaw video character list`) over
hyphenated forms (`vclaw video character-list`). Both work — every
kebab form has a noun-verb alias registered. The canonical name in
`vclaw schema --json` is the kebab form for now (backwards compat); v3.1
will switch the canonical form and alias the kebab.

Aliased pairs (selected): see `vclaw schema --json | jq '.commands[] | {name, aliases}'` for the complete list.

---

````

(Then the existing command-list content continues unchanged below.)

- [ ] **Step 6.3: Add the AGENTS.md section**

Insert at the top of `AGENTS.md`, after the title:

```markdown
## Agent integration contract (v3)

videoclaw v3 is designed as a target for external agents (Claude Code,
Codex, Antigravity, Cursor, Warp), not as an orchestrator itself. The
contract:

1. **Stdout is JSON when piped.** Pretty-printed when TTY. Progress goes to stderr.
2. **Exit codes follow a 0/1/2/3 taxonomy** — see `docs/CLI_REFERENCE.md` § Agent-friendly surface.
3. **Errors carry stable string codes** in their JSON envelope. The catalog: `schemas/video/errors.json`.
4. **One-call discovery: `vclaw schema --json`** dumps the full contract — commands, flags, artifact schemas, exit codes, error codes.

If you are an agent author wiring videoclaw into your tool: call
`vclaw schema --json` once, then drive the CLI deterministically.
Don't try to do natural-language intent classification inside videoclaw
— that's your job.
```

- [ ] **Step 6.4: Update CHANGELOG.md's v3.0.0-alpha.0 entry**

In `CHANGELOG.md`, find the `## [3.0.0-alpha.0] — 2026-05-25 (unreleased)` section. Under "Coming in v3", update the Slice 1 bullet from "(planned)" to mark it shipped:

```markdown
### Added (Slice 1 — agent-friendly polish, shipped)

- `vclaw schema --json` — single-call introspection bundle (commands, flags, artifact schemas, error codes, exit codes)
- Exit-code taxonomy (0=success, 1=user error, 2=system error, 3=gate). Documented in CLI_REFERENCE.md.
- Stable string error codes in JSON output. Catalog at `schemas/video/errors.json`.
- JSON default on non-TTY stdout via `writeOutput()` helper.
- TTY-safe progress: spinners/colors to stderr only.
- Noun-verb command aliases (e.g., `vclaw video character list` ↔ `vclaw video character-list`).
```

- [ ] **Step 6.5: Run all docs/skills tests to verify nothing broke**

Run: `npm test 2>&1 | tail -20`

Expected: green. Especially `skills-hygiene.test.js` and `package-scripts.test.js` (they enforce doc conventions).

- [ ] **Step 6.6: Run check:release-readiness-lite as a final gate**

Run: `npm run check:release-readiness-lite 2>&1 | tail -15`

Expected: `release-readiness-lite checks passed`.

- [ ] **Step 6.7: Commit**

```bash
git add docs/CLI_REFERENCE.md AGENTS.md CHANGELOG.md
git commit -m "Slice 1: document the v3 agent-friendly contract"
```

---

## Failure modes + rollback paths

### Per-task rollbacks

Every task is a single commit. To roll back any task: `git revert <sha>` produces a clean inverse without touching subsequent commits. Tasks are sequenced so later commits only ADD layers — none of them MODIFY the layers introduced by earlier commits — so reverts compose cleanly.

### Specific gotchas to watch for

- **Task 3 dispatch wiring**: if the schema dispatch case is placed AFTER the `case 'video':` block (which uses an early-return pattern), it will never fire. Make sure it's placed BEFORE the `video` block in the switch.
- **Task 3 `loadArtifactSchemas` path math**: `dist/video/cli-schema.js` is two levels deep from the schemas directory. If the build output changes layout in a future TS config update, this path will break. The test asserts `'brief' in dump.artifactSchemas` — that'll catch it.
- **Task 4 entry-point coverage**: the plan limits VclawError migration to 5 handlers. Resist the temptation to convert all ~50 — that's slice-1.5 work. Each handler migration is an isolated commit later.
- **Task 5 alias collision**: if a future contributor adds a 2-word kebab-case subcommand (`vclaw video new-thing`), the resolver might mis-match `'new thing'` against an alias. The dispatch order (2-word lookup THEN 1-word) guards against this for current commands but should be re-audited per new command.
- **Task 6 docs guards**: `package-scripts.test.ts` greps `CLI_REFERENCE.md` for specific strings. Adding sections at the top is safe; reordering existing content is NOT. Diff-check before committing.

### Test gates that must stay green

After every commit:
- `npm run build` — green
- `npm test` — green (all suites)
- After Task 6 only: `npm run check:release-readiness-lite` — green

If any of these go red between tasks, **STOP** and re-evaluate before continuing. Do not push through with broken tests.

---

## What ships after Slice 1

After this plan completes:
- `vclaw schema --json` returns the v3 contract
- Stdout is JSON when piped, human-readable when TTY
- Exit codes follow 0/1/2/3 taxonomy at the top level + at 5 high-traffic entry points
- ~22 stable error codes catalogued
- Backwards-compat noun-verb aliases dispatch correctly
- Documentation reflects all the above

What does NOT ship:
- Migration of all ~50 subcommand handlers to VclawError (incremental v3.x alpha work)
- The Python fold (Slice 3)
- Skill consolidations (Slice 2)
- MCP server (Slice 5)
- Bun standalone surface collapse (Slice 4)

Next slice to plan: **Slice 2 — Skill consolidations** (~3 days, parallel-shippable with Slice 3).
