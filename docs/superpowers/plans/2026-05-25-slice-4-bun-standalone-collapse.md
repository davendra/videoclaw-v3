# Slice 4 — Bun Standalone Surface Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the `vclaw-cli/` Bun package's standalone subcommand surface (`status | list | history | resume | reset | cancel | useapi:*`) into the main TS CLI as `vclaw veo *`. The Bun runtime stays — it's still the only way to reach Google Flow via Puppeteer — but it stops being a user-facing standalone surface.

**Architecture:** Each new `vclaw veo <verb>` subcommand in `src/cli/vclaw.ts` shells out to `bun run vclaw-cli/flow.ts <verb>` via `child_process.spawn`, forwarding stdin/stdout/stderr. The Bun-side CLI surface stays functional for now (so anyone with scripts pinned to `bun run flow.ts ...` doesn't break), but the canonical path becomes `vclaw veo *`.

**Tech Stack:** TypeScript NodeNext ESM, `child_process.spawn`, existing `native-veo.ts` infrastructure as the template for subprocess invocation. No new runtime deps.

**Source spec:** [`docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`](../specs/2026-05-25-videoclaw-v3-unification-design.md) §4 Slice 4.

**Effort target:** ~1 week, 6 commits.

---

## File Structure

**New files:**
- `src/video/veo-subprocess.ts` — shared helper that spawns `bun run flow.ts <args>` with proper env + stdio forwarding. Returns exit code, captured stdout/stderr.
- `src/tests/cli-veo-subcommands.test.ts` — tests for `vclaw veo *` dispatch (mocked subprocess).

**Modified files:**
- `src/cli/vclaw.ts` — add `case 'veo':` dispatch handling 6+ verbs (status/list/history/resume/reset/cancel + useapi:* family)
- `src/video/cli-schema.ts` — add the new `video veo *` commands to the COMMANDS array (8-14 new entries)
- `src/cli/vclaw.ts` (alias section from Slice 1 Task 5) — add `veo` aliases if 2-word forms should also work (e.g., `vclaw veo useapi accounts` → `useapi:accounts`)
- `docs/CLI_REFERENCE.md` — new section "Veo subcommands (Bun bridge)"
- `vclaw-cli/CLAUDE.md` — add a note at the top that the standalone surface is being superseded by `vclaw veo *`
- `CHANGELOG.md` — Slice 4 entry under v3.0.0-alpha.0

---

## Commit Plan (6 commits)

### Task 1: Veo subprocess helper foundation

**Files:**
- Create: `src/video/veo-subprocess.ts`
- Create: `src/tests/veo-subprocess.test.ts`

- [ ] **Step 1.1: Write failing test**

Create `src/tests/veo-subprocess.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnVeo, type VeoSpawnResult } from '../video/veo-subprocess.js';

describe('spawnVeo', () => {
  it('returns a VeoSpawnResult shape on dry-run', async () => {
    const result = await spawnVeo(['--help'], { dryRun: true });
    assert.equal(typeof result.exitCode, 'number');
    assert.equal(typeof result.stdout, 'string');
    assert.equal(typeof result.stderr, 'string');
    assert.equal(result.command, 'bun run vclaw-cli/flow.ts --help');
  });
});
```

- [ ] **Step 1.2: Implement**

Create `src/video/veo-subprocess.ts`:

```typescript
/**
 * Subprocess bridge to the Bun-based vclaw-cli/flow.ts.
 *
 * The Bun runtime is required for Puppeteer + Google Flow access. The
 * main TS CLI shells out to it for `vclaw veo *` subcommands. This
 * helper centralises the spawn + stdio forwarding so each veo verb in
 * vclaw.ts is one line.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VclawError } from './errors.js';

export interface VeoSpawnOptions {
  /** When true, build the command but do not actually spawn. For tests + --dry-run. */
  dryRun?: boolean;
  /** Override the Bun binary path. Defaults to `VCLAW_VEO_BUN_BIN` env or `bun`. */
  bunBin?: string;
  /** Override the vclaw-cli flow.ts path. Defaults to <repo-root>/vclaw-cli/flow.ts. */
  flowEntry?: string;
  /** Pass env to the child process. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface VeoSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The full command string (helpful for tests + error messages). */
  command: string;
}

function resolveFlowEntry(override?: string): string {
  if (override) return override;
  // src/video/veo-subprocess.ts compiles to dist/video/veo-subprocess.js
  // — flow.ts lives at <repo-root>/vclaw-cli/flow.ts.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'vclaw-cli', 'flow.ts');
}

export async function spawnVeo(args: string[], options: VeoSpawnOptions = {}): Promise<VeoSpawnResult> {
  const bunBin = options.bunBin ?? process.env.VCLAW_VEO_BUN_BIN ?? 'bun';
  const flowEntry = resolveFlowEntry(options.flowEntry);
  const command = `${bunBin} run ${flowEntry} ${args.join(' ')}`;

  if (options.dryRun) {
    return { exitCode: 0, stdout: '', stderr: '', command };
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bunBin, ['run', flowEntry, ...args], {
      env: options.env ?? process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdoutBuf += text;
      process.stdout.write(text); // forward to parent stdout
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderrBuf += text;
      process.stderr.write(text); // forward to parent stderr
    });

    child.on('error', (err) => {
      reject(new VclawError('native_transport_failed', `Failed to spawn bun: ${err.message}`, { command }));
    });

    child.on('exit', (code) => {
      resolve({ exitCode: code ?? -1, stdout: stdoutBuf, stderr: stderrBuf, command });
    });
  });
}
```

- [ ] **Step 1.3: Verify test passes**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && node --test dist/tests/veo-subprocess.test.js
```

Expected: PASS.

- [ ] **Step 1.4: Commit**

```bash
git add src/video/veo-subprocess.ts src/tests/veo-subprocess.test.ts
git commit -m "Slice 4: spawnVeo subprocess helper (Bun bridge foundation)"
```

---

### Task 2: Wire `vclaw veo status|list|history|resume|reset|cancel`

**Files:**
- Modify: `src/cli/vclaw.ts` — add `case 'veo':` dispatch + 6 verb subdispatches
- Modify: `src/video/cli-schema.ts` — add 6 new commands to COMMANDS

- [ ] **Step 2.1: Add `veo` dispatch case in vclaw.ts**

In `src/cli/vclaw.ts`'s main dispatch (where other top-level cases like `'video'` and `'schema'` live), add a new case:

```typescript
case 'veo': {
  const { spawnVeo } = await import('../video/veo-subprocess.js');
  const verb = args[0];
  if (!verb) {
    throw new VclawError('missing_required_flag', 'vclaw veo requires a verb. Try: status, list, history, resume, reset, cancel, useapi:accounts, useapi:health.', { flag: '<verb>' });
  }
  const veoArgs = [verb, ...args.slice(1)];
  const result = await spawnVeo(veoArgs);
  process.exit(result.exitCode);
}
```

- [ ] **Step 2.2: Add the 6 standard verbs to cli-schema.ts COMMANDS**

In `src/video/cli-schema.ts`'s COMMANDS array, add after the existing `'schema'` entry (or in a new "Veo (Bun bridge)" section):

```typescript
// --- veo (Bun bridge for Google Flow) ---
{ name: 'veo status', usage: 'vclaw veo status [batchId]', description: 'Show status of current or specific Veo batch.' },
{ name: 'veo list', usage: 'vclaw veo list', description: 'List all Veo batches.' },
{ name: 'veo history', usage: 'vclaw veo history [--limit <n>]', description: 'Show recent Veo job history.' },
{ name: 'veo resume', usage: 'vclaw veo resume [batchId]', description: 'Resume a paused Veo batch.' },
{ name: 'veo reset', usage: 'vclaw veo reset', description: 'Reset failed Veo jobs to pending.' },
{ name: 'veo cancel', usage: 'vclaw veo cancel', description: 'Cancel current Veo batch.' },
```

- [ ] **Step 2.3: Test the dispatch shape**

Add a test to `src/tests/cli-veo-subcommands.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw veo dispatch', () => {
  it('vclaw veo (no verb) exits 1 with missing_required_flag', () => {
    const r = spawnSync(process.execPath, [cliPath, 'veo'], { encoding: 'utf-8' });
    assert.equal(r.status, 1);
    const payload = JSON.parse(r.stdout) as { code: string };
    assert.equal(payload.code, 'missing_required_flag');
  });

  it('schema lists all 6 standard veo verbs', () => {
    const r = spawnSync(process.execPath, [cliPath, 'schema', '--json'], { encoding: 'utf-8' });
    assert.equal(r.status, 0);
    const dump = JSON.parse(r.stdout) as { commands: Array<{ name: string }> };
    const names = new Set(dump.commands.map((c) => c.name));
    for (const verb of ['veo status', 'veo list', 'veo history', 'veo resume', 'veo reset', 'veo cancel']) {
      assert.ok(names.has(verb), `schema should list '${verb}'`);
    }
  });
});
```

- [ ] **Step 2.4: Verify**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
```

Update the `commands.length === 55` assertion in `cli-schema.test.ts` to the new count (likely 61 = 55 + 6).

- [ ] **Step 2.5: Commit**

```bash
git add src/cli/vclaw.ts src/video/cli-schema.ts src/tests/cli-veo-subcommands.test.ts src/tests/cli-schema.test.ts
git commit -m "Slice 4: vclaw veo {status|list|history|resume|reset|cancel} via Bun bridge"
```

---

### Task 3: Wire `vclaw veo useapi:*` family

**Files:**
- Modify: `src/cli/vclaw.ts` (the `veo` case from Task 2 already covers these because it passes the verb through; no further changes needed if it already handles `useapi:*` strings)
- Modify: `src/video/cli-schema.ts` — add 7 useapi commands

- [ ] **Step 3.1: Confirm the Task 2 dispatch handles `useapi:*` verbs**

The dispatch in Task 2 passes `args[0]` through as the verb. So `vclaw veo useapi:accounts list` becomes `bun run flow.ts useapi:accounts list` — which is what `vclaw-cli/flow.ts` already understands. No code change needed in vclaw.ts.

- [ ] **Step 3.2: Add useapi:* commands to schema**

In `src/video/cli-schema.ts` COMMANDS, append:

```typescript
{ name: 'veo useapi:accounts', usage: 'vclaw veo useapi:accounts list|add [--cookies <path>]', description: 'Manage useapi.net accounts (via Bun bridge).' },
{ name: 'veo useapi:captcha', usage: 'vclaw veo useapi:captcha list | --provider <name> --key <key>', description: 'Manage useapi.net CAPTCHA providers.' },
{ name: 'veo useapi:health', usage: 'vclaw veo useapi:health', description: 'useapi.net account health + history.' },
{ name: 'veo useapi:image', usage: 'vclaw veo useapi:image --image-prompt "<text>" [--image-model imagen-4|nano-banana|nano-banana-pro] [--ref <url> ...] [--yes]', description: 'Generate images via useapi.net (Imagen-4 / nano-banana family).' },
{ name: 'veo useapi:image:upscale', usage: 'vclaw veo useapi:image:upscale --media-id <id> --resolution 2k|4k', description: 'Upscale a nano-banana-pro image.' },
{ name: 'veo useapi:gif', usage: 'vclaw veo useapi:gif --media-id <id> --output-file <path>', description: 'Convert a Veo video to GIF (free, no CAPTCHA).' },
{ name: 'veo useapi:upscale', usage: 'vclaw veo useapi:upscale --media-id <id> --resolution 1080p|4k', description: 'Upscale a Veo video.' },
```

Update `cli-schema.test.ts` commands count assertion to 68 (55 + 6 + 7).

- [ ] **Step 3.3: Verify**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
```

- [ ] **Step 3.4: Commit**

```bash
git add src/video/cli-schema.ts src/tests/cli-schema.test.ts
git commit -m "Slice 4: register vclaw veo useapi:* commands in schema dump"
```

---

### Task 4: Update noun-verb alias map for veo

**Files:**
- Modify: `src/cli/vclaw.ts` (NOUN_VERB_ALIASES from Slice 1 Task 5)

- [ ] **Step 4.1: Add veo aliases**

The current alias map handles `video character list` → `video character-list`. For veo we DON'T want noun-verb aliasing on the verb itself (status/list/history are already single words), but we DO want `useapi accounts list` → `useapi:accounts list` if someone types space-separated.

Actually, the Bun CLI accepts `useapi:accounts` with the colon as a single token. Users likely won't try the space-separated form. **Skip aliasing for veo in v3.0** — re-evaluate in v3.1 if user feedback demands it.

This task becomes documentation-only.

- [ ] **Step 4.2: Document the no-alias decision**

In `docs/CLI_REFERENCE.md` § Noun-verb command conventions, add a note:

```markdown
**`vclaw veo *` subcommands** keep the Bun CLI's colon-separated form
(`useapi:accounts list`, not `useapi accounts list`). This matches the
underlying `bun run flow.ts` surface. Aliasing the colon to a space
would create confusion for users with existing scripts.
```

- [ ] **Step 4.3: Commit**

```bash
git add docs/CLI_REFERENCE.md
git commit -m "Slice 4: document no-alias decision for vclaw veo subcommands"
```

---

### Task 5: Deprecation banner on vclaw-cli/CLAUDE.md

**Files:**
- Modify: `vclaw-cli/CLAUDE.md`

- [ ] **Step 5.1: Add deprecation note**

Insert at the top of `vclaw-cli/CLAUDE.md`, after the title:

```markdown
> **As of videoclaw v3.0.0-alpha.0:** The standalone Bun CLI surface
> documented in this file (`bun run flow.ts <verb>`) is being superseded
> by `vclaw veo <verb>` in the main TS CLI. The Bun subprocess is still
> required for Google Flow / Puppeteer access — it's just wrapped now.
>
> **Prefer:** `vclaw veo status`, `vclaw veo list`, `vclaw veo useapi:health`, etc.
>
> **Legacy use:** `bun run flow.ts status` still works for now (no
> deletion in v3.0). Scheduled for soft-deprecation in v3.x and likely
> removal in v4.0.
```

- [ ] **Step 5.2: Commit**

```bash
git add vclaw-cli/CLAUDE.md
git commit -m "Slice 4: deprecation banner on vclaw-cli/CLAUDE.md pointing at vclaw veo *"
```

---

### Task 6: Docs + CHANGELOG + final gate

**Files:**
- Modify: `docs/CLI_REFERENCE.md` (add Veo section)
- Modify: `AGENTS.md` (add veo bridge note)
- Modify: `CHANGELOG.md` (Slice 4 entry under v3.0.0-alpha.0)
- Modify: `docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md` — mark Slice 4 as shipped (optional)

- [ ] **Step 6.1: Add Veo section to CLI_REFERENCE.md**

Insert after the Project lifecycle section (or wherever video commands are documented):

```markdown
## Veo (Bun bridge)

The `vclaw veo *` subcommand family bridges to the Bun-based
`vclaw-cli/flow.ts` for Google Flow access via Puppeteer. The Bun
runtime is required (install via `curl -fsSL https://bun.sh/install | bash`).

### Standard verbs

| Command | Purpose |
|---|---|
| `vclaw veo status [batchId]` | Show batch status. |
| `vclaw veo list` | List all batches. |
| `vclaw veo history [--limit <n>]` | Recent job history. |
| `vclaw veo resume [batchId]` | Resume a paused batch. |
| `vclaw veo reset` | Reset failed jobs to pending. |
| `vclaw veo cancel` | Cancel current batch. |

### UseAPI verbs

| Command | Purpose |
|---|---|
| `vclaw veo useapi:accounts list\|add` | Manage useapi.net accounts. |
| `vclaw veo useapi:captcha list \| --provider <name> --key <key>` | CAPTCHA providers. |
| `vclaw veo useapi:health` | Account health + history. |
| `vclaw veo useapi:image --image-prompt "..."` | Generate images. |
| `vclaw veo useapi:image:upscale --media-id <id> --resolution 2k\|4k` | Upscale images. |
| `vclaw veo useapi:gif --media-id <id> --output-file <path>` | Video → GIF (free). |
| `vclaw veo useapi:upscale --media-id <id> --resolution 1080p\|4k` | Upscale videos. |

See `vclaw schema --json | jq '.commands[] | select(.name | startswith("veo "))'` for the canonical list.

The legacy standalone form `bun run vclaw-cli/flow.ts <verb>` still
works in v3.0 but is being deprecated. Use `vclaw veo *` going forward.
```

- [ ] **Step 6.2: Add brief AGENTS.md note**

In `AGENTS.md` § Agent integration contract, add a 5th bullet:

```markdown
5. **Veo (Google Flow) access requires Bun.** `vclaw veo *` subcommands bridge to `bun run vclaw-cli/flow.ts` as a subprocess. Bun must be on PATH (`bun --version` to verify).
```

- [ ] **Step 6.3: CHANGELOG entry**

Append to the existing `## [3.0.0-alpha.0]` section, under "Added":

```markdown
### Added (Slice 4 — Bun standalone surface collapse, shipped)

- `vclaw veo {status|list|history|resume|reset|cancel}` — 6 standard verbs bridging to the Bun CLI
- `vclaw veo useapi:*` — 7 UseAPI verbs (accounts, captcha, health, image, image:upscale, gif, upscale)
- `src/video/veo-subprocess.ts` — shared `spawnVeo()` helper for Bun bridge
- Schema dump now includes 13 new `veo *` entries (`vclaw schema --json | jq '.commands | length'` → 68)
- Bun runtime now an explicit requirement for Veo / Google Flow access (documented in CLI_REFERENCE)
```

- [ ] **Step 6.4: Final gate**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run check:release-readiness-lite 2>&1 | tail -10
```

Expected: `release-readiness-lite checks passed`.

- [ ] **Step 6.5: Commit**

```bash
git add docs/CLI_REFERENCE.md AGENTS.md CHANGELOG.md
git commit -m "Slice 4: document vclaw veo * bridge in CLI_REFERENCE + AGENTS + CHANGELOG"
```

---

## Failure modes + rollback

- **Bun not installed on user machine.** `spawnVeo` will fail with `native_transport_failed`. The error message includes the command string so users see exactly what was attempted. Document Bun requirement in README quickstart.
- **flow.ts path resolution drift.** `resolveFlowEntry` assumes the relative path from `dist/video/veo-subprocess.js` to `vclaw-cli/flow.ts`. If the build output structure changes, update the relative path math. The test (`spawnVeo --dry-run`) catches it because it asserts the command string.
- **stdio forwarding edge cases.** Long-running Veo batches may produce >MB of stdout. The Buffer accumulation in `spawnVeo` should be fine for hours-long batches but could OOM on very long ones. If it becomes a problem, switch to NDJSON streaming.
- **Per-task rollback:** `git revert <sha>` per commit. Each is independent.

---

## Test gates

After every commit:
- `npm run build` green
- `npm test` green
- After Task 6 only: `npm run check:release-readiness-lite` green

---

## What ships after Slice 4

- 13 new `vclaw veo *` subcommands in the main CLI
- `src/video/veo-subprocess.ts` Bun bridge helper
- Schema dump includes the new commands (68 total)
- CLI_REFERENCE + AGENTS document the bridge
- `vclaw-cli/CLAUDE.md` carries a deprecation banner
- Legacy `bun run flow.ts <verb>` still works (no deletion)

**What does NOT ship:**
- Deletion of standalone Bun CLI surface (deferred to v3.x or v4.0)
- Python fold (Slice 3)
- MCP server (Slice 5)

**Next slice:** Slice 5 — MCP server + external skills pack.
