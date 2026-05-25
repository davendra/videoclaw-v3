# Slice 5 — MCP Server + External Skills Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the v3 unification by (a) exposing videoclaw as an MCP server (`vclaw mcp serve`) offering read-only introspection of project state, and (b) scaffolding the external `videoclaw-skills` pack structure inside the repo (the actual separate-repo publish is a manual follow-up). Per the agent-integration research, this is the final piece that makes videoclaw a first-class target for MCP-aware agent hosts (Claude Code, Codex, Cursor, Antigravity).

**Architecture:** A new `src/mcp/` directory holds a minimal stdio MCP server using the official `@modelcontextprotocol/sdk`. The server exposes 5 read-only tools that wrap existing `src/video/*` functions (list projects, get status, get artifacts, get event log, list provider routes). NO write operations via MCP — agents use the CLI for those. A new `vclaw mcp serve` subcommand boots it. The skills pack is a `mcp/skills-pack/` template directory with 3 sample Claude Code skills demonstrating how to drive videoclaw.

**Tech Stack:** TypeScript NodeNext ESM, `@modelcontextprotocol/sdk` (new dep), stdio transport. Reuses existing `src/video/project-index.ts`, `status.ts`, `artifacts.ts`, `provider-status.ts`.

**Source spec:** [`docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`](../specs/2026-05-25-videoclaw-v3-unification-design.md) §4 Slice 5 + [`docs/AGENT_INTEGRATION_RESEARCH.md`](../../AGENT_INTEGRATION_RESEARCH.md).

**Effort target:** ~1 week, 6 commits.

---

## File Structure

**New files:**
- `src/mcp/server.ts` — the MCP server: registers 5 read-only tools, wires stdio transport
- `src/mcp/tools.ts` — the 5 tool implementations (thin wrappers over src/video/* functions)
- `src/mcp/index.ts` — re-exports + `startMcpServer()` entrypoint
- `src/tests/mcp-tools.test.ts` — unit tests for each tool's handler (no transport)
- `mcp/skills-pack/README.md` — explains the external skills pack
- `mcp/skills-pack/videoclaw-create-video/SKILL.md` — sample skill: drive a full video creation
- `mcp/skills-pack/videoclaw-check-status/SKILL.md` — sample skill: poll project status
- `mcp/skills-pack/videoclaw-portfolio-review/SKILL.md` — sample skill: portfolio dashboard

**Modified files:**
- `src/cli/vclaw.ts` — add `case 'mcp':` dispatch (subcommand `serve`)
- `src/video/cli-schema.ts` — add `mcp serve` to COMMANDS
- `package.json` — add `@modelcontextprotocol/sdk` dep; bump command count
- `docs/CLI_REFERENCE.md` — "MCP server" section
- `AGENTS.md` — note the MCP option
- `CHANGELOG.md` — Slice 5 entry
- `README.md` — quickstart note on `vclaw mcp serve`

---

## Commit Plan (6 commits)

### Task 1: MCP SDK dep + tool handlers (no transport yet)

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `src/tests/mcp-tools.test.ts`
- Modify: `package.json` (add dep)

- [ ] **Step 1.1: Add the SDK dependency**

Edit `package.json` dependencies:

```json
"@modelcontextprotocol/sdk": "^1.0.0"
```

Run `npm install`. Verify `npm run build` still green.

- [ ] **Step 1.2: Write failing test for the 5 tool handlers**

Create `src/tests/mcp-tools.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listProjectsTool,
  getProjectStatusTool,
  getArtifactsTool,
  getEventLogTool,
  listProviderRoutesTool,
} from '../mcp/tools.js';

describe('mcp tools', () => {
  it('listProjectsTool returns an array (empty workspace)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-mcp-'));
    const result = await listProjectsTool({ root });
    assert.ok(Array.isArray(result.projects));
  });

  it('listProviderRoutesTool returns the 4 production routes', async () => {
    const result = await listProviderRoutesTool({});
    const ids = result.routes.map((r) => r.routeId);
    assert.ok(ids.includes('veo-useapi'));
    assert.ok(ids.includes('seedance-direct'));
    assert.ok(ids.includes('runway-useapi'));
    // kling was removed in Phase 10c
    assert.ok(!ids.includes('kling-useapi'), 'kling-useapi should be gone');
  });

  it('getProjectStatusTool returns project_not_found shape for missing slug', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-mcp-'));
    const result = await getProjectStatusTool({ root, slug: 'does-not-exist' });
    assert.equal(result.found, false);
  });
});
```

- [ ] **Step 1.3: Implement the 5 tools**

Create `src/mcp/tools.ts`. Each tool is a thin async function wrapping an existing `src/video/*` function. READ the actual signatures of these modules first:

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
grep -n "^export" src/video/project-index.ts src/video/status.ts src/video/provider-status.ts | head -30
```

Then implement (adapt to actual signatures):

```typescript
/**
 * MCP tool implementations for videoclaw.
 *
 * All READ-ONLY. Agents use the CLI for writes. Each tool wraps an
 * existing src/video/* function and returns a plain-JSON-serializable
 * object (MCP tools return content as JSON).
 */

import { buildProjectIndex } from '../video/project-index.js';
import { buildProviderStatusReport } from '../video/provider-status.js';
// ... import status + artifacts readers per their actual exports

export interface ListProjectsInput { root?: string; }
export async function listProjectsTool(input: ListProjectsInput): Promise<{ projects: unknown[] }> {
  const root = input.root ?? process.cwd();
  const index = await buildProjectIndex(root);
  return { projects: index.projects ?? [] };
}

export interface GetProjectStatusInput { root?: string; slug: string; }
export async function getProjectStatusTool(input: GetProjectStatusInput): Promise<{ found: boolean; status?: unknown }> {
  // Wrap the existing status reader. Return { found: false } if the
  // project workspace doesn't exist rather than throwing.
  // ... implement using src/video/status.ts
  return { found: false };
}

export interface GetArtifactsInput { root?: string; slug: string; }
export async function getArtifactsTool(input: GetArtifactsInput): Promise<{ artifacts: Record<string, unknown> }> {
  // List + read the JSON artifacts under projects/<slug>/artifacts/.
  // ... implement using src/video/artifacts.ts
  return { artifacts: {} };
}

export interface GetEventLogInput { root?: string; slug: string; limit?: number; }
export async function getEventLogTool(input: GetEventLogInput): Promise<{ events: unknown[] }> {
  // Read projects/<slug>/events/events.jsonl, return last `limit` entries.
  return { events: [] };
}

export interface ListProviderRoutesInput { root?: string; }
export async function listProviderRoutesTool(input: ListProviderRoutesInput): Promise<{ routes: Array<{ routeId: string; availability: string }> }> {
  const report = buildProviderStatusReport({ root: input.root });
  return { routes: report.routes.map((r) => ({ routeId: r.routeId, availability: r.availability })) };
}
```

**IMPORTANT:** the exact wrapping depends on the real signatures of `buildProjectIndex`, `buildProviderStatusReport`, the status reader, etc. Read those modules and adapt. The tests above pin the observable behavior (returns arrays/shapes), so as long as those pass, the wrapping is correct.

- [ ] **Step 1.4: Verify**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && node --test dist/tests/mcp-tools.test.js
```

Expected: 3 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/mcp/tools.ts src/tests/mcp-tools.test.ts package.json package-lock.json
git commit -m "Slice 5: MCP tool handlers (5 read-only tools wrapping src/video/*)"
```

---

### Task 2: MCP server + stdio transport

**Files:**
- Create: `src/mcp/server.ts`, `src/mcp/index.ts`
- Create: `src/tests/mcp-server.test.ts`

- [ ] **Step 2.1: Implement the server**

Create `src/mcp/server.ts` using the MCP SDK. The exact API depends on the SDK version — consult the SDK docs via Context7 if unsure. Reference shape (adapt to actual SDK):

```typescript
/**
 * videoclaw MCP server — exposes read-only project introspection to
 * MCP-aware agent hosts (Claude Code, Codex, Cursor, Antigravity).
 *
 * Transport: stdio. Boot via `vclaw mcp serve`.
 *
 * Tools (all read-only):
 *  - list_projects
 *  - get_project_status
 *  - get_artifacts
 *  - get_event_log
 *  - list_provider_routes
 *
 * Writes go through the CLI, not MCP — per the agent-integration
 * research, the CLI is the deterministic action surface; MCP is for
 * live-state queries.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  listProjectsTool,
  getProjectStatusTool,
  getArtifactsTool,
  getEventLogTool,
  listProviderRoutesTool,
} from './tools.js';

export function buildMcpServer(): Server {
  const server = new Server(
    { name: 'videoclaw', version: '3.0.0-alpha.0' },
    { capabilities: { tools: {} } },
  );

  // Register the 5 tools with their JSON-schema input definitions +
  // handlers. The SDK's exact registration API (setRequestHandler vs
  // server.tool(...)) depends on the version — adapt accordingly.

  // ... tool registration ...

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes.
}
```

Create `src/mcp/index.ts`:

```typescript
export { buildMcpServer, startMcpServer } from './server.js';
export * from './tools.js';
```

- [ ] **Step 2.2: Test the server builds without connecting**

Create `src/tests/mcp-server.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpServer } from '../mcp/server.js';

describe('mcp server', () => {
  it('buildMcpServer constructs without throwing', () => {
    const server = buildMcpServer();
    assert.ok(server);
  });
});
```

- [ ] **Step 2.3: Verify**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && node --test dist/tests/mcp-server.test.js
```

- [ ] **Step 2.4: Commit**

```bash
git add src/mcp/server.ts src/mcp/index.ts src/tests/mcp-server.test.ts
git commit -m "Slice 5: MCP stdio server with 5 read-only tools registered"
```

---

### Task 3: `vclaw mcp serve` subcommand

**Files:**
- Modify: `src/cli/vclaw.ts` (add `case 'mcp':`)
- Modify: `src/video/cli-schema.ts` (add `mcp serve` command)
- Modify: `src/tests/cli-schema.test.ts` (bump command count to 69)

- [ ] **Step 3.1: Add the dispatch**

In `src/cli/vclaw.ts` main dispatch, add:

```typescript
case 'mcp': {
  const verb = args[0];
  if (verb !== 'serve') {
    throw new VclawError('unknown_subcommand', `vclaw mcp: unknown verb '${verb ?? ''}'. Only 'serve' is supported.`, { subcommand: `mcp ${verb ?? ''}` });
  }
  const { startMcpServer } = await import('../mcp/index.js');
  await startMcpServer();
  // startMcpServer runs until stdin closes; control returns then.
  return;
}
```

- [ ] **Step 3.2: Add to schema**

In `src/video/cli-schema.ts` COMMANDS, add:

```typescript
{ name: 'mcp serve', usage: 'vclaw mcp serve', description: 'Start the videoclaw MCP server (stdio) exposing read-only project introspection to MCP-aware agent hosts.' },
```

Bump `cli-schema.test.ts` commands count assertion to 69 (68 + 1).

- [ ] **Step 3.3: Verify**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
# Smoke the dispatch (will hang waiting for stdin — so just check it doesn't error on boot):
echo "" | timeout 2 node dist/cli/vclaw.js mcp serve 2>&1 | head -3 || echo "server booted + exited on stdin close (expected)"
```

- [ ] **Step 3.4: Commit**

```bash
git add src/cli/vclaw.ts src/video/cli-schema.ts src/tests/cli-schema.test.ts
git commit -m "Slice 5: vclaw mcp serve subcommand"
```

---

### Task 4: External skills pack scaffold

**Files:**
- Create: `mcp/skills-pack/README.md`
- Create: `mcp/skills-pack/videoclaw-create-video/SKILL.md`
- Create: `mcp/skills-pack/videoclaw-check-status/SKILL.md`
- Create: `mcp/skills-pack/videoclaw-portfolio-review/SKILL.md`

- [ ] **Step 4.1: Write the pack README**

Create `mcp/skills-pack/README.md`:

```markdown
# videoclaw skills pack

Sample Claude Code / Codex skills demonstrating how to drive videoclaw
as an external agent. These are TEMPLATES — copy them into your own
`.claude/skills/` directory (or publish them as a separate
`videoclaw-skills` repo for distribution).

Per the [agent-integration research](../../docs/AGENT_INTEGRATION_RESEARCH.md),
intent classification is the agent host's job. These skills show the
host HOW to call videoclaw's deterministic CLI surface — they don't
embed orchestration logic in videoclaw itself.

## Skills

| Skill | What it does |
|---|---|
| `videoclaw-create-video` | Drives a full video creation: init → brief → storyboard → assets → execute → assemble |
| `videoclaw-check-status` | Polls `vclaw video status` + `vclaw mcp` for project state |
| `videoclaw-portfolio-review` | Surfaces the portfolio dashboard via `vclaw video metrics` + `next-actions` |

## How agents discover videoclaw

1. `vclaw schema --json` — one call returns the full command tree, flags, artifact schemas, error codes, exit codes.
2. `vclaw mcp serve` — for hosts that prefer MCP, exposes read-only project introspection as MCP tools.

## Publishing as a separate repo

These live inside the videoclaw repo under `mcp/skills-pack/` for
reference. To distribute: copy this directory to a standalone
`videoclaw-skills` GitHub repo, add an install script, and point users
at it. (Manual follow-up — not automated in v3.0.)
```

- [ ] **Step 4.2: Write the 3 sample skills**

Create `mcp/skills-pack/videoclaw-create-video/SKILL.md`:

```markdown
---
name: videoclaw-create-video
description: |
  Drive videoclaw to create a video end-to-end from a creative intent.
  Use when the user wants to make a video and videoclaw is installed
  (`vclaw --version` to verify).
---

# videoclaw: create a video

You are driving the `vclaw` CLI to produce a video. videoclaw is a
deterministic toolkit — YOU do the intent reasoning, vclaw executes.

## First, learn the surface

```bash
vclaw schema --json
```

This returns every command, flag, artifact schema, exit code, and error
code. Parse it once.

## Then walk the pipeline

1. `vclaw video init <slug> --mode storyboard` (or `--mode director` for the approval-gated path)
2. `vclaw video brief --project <slug> --title "..." --intent "..." [--aspect-ratio 16:9|9:16|1:1]`
3. `vclaw video storyboard --project <slug> --scene "..." [--scene "..." ...]`
4. `vclaw video assets --project <slug> --asset image:path:0`
5. `vclaw video readiness --project <slug>` — check blockers
6. `vclaw video plan --project <slug>` — see the recommended provider route
7. `vclaw video execute --project <slug> [--dry-run]`
8. `vclaw video assemble --project <slug>` (Slice 3 — TTS/music/stitch into final MP4; only if the assemble pipeline has shipped)

## Read exit codes

- 0 = success
- 1 = your input was wrong (fix flags, retry)
- 2 = system/provider error (investigate, maybe retry)
- 3 = gate (e.g., director storyboard approval needed) — clear the gate first

On any non-zero exit, stdout has `{"code": "...", "message": "...", "details": {...}}`.

## Director-mode approval gate

If `vclaw video execute` exits 3 with `storyboard_approval_required`,
the storyboard.md must be approved. Either set
`VIDEOCLAW_APPROVE_STORYBOARD=1` (auto-approve) or run
`vclaw video approve --project <slug>` after review.
```

Create `mcp/skills-pack/videoclaw-check-status/SKILL.md`:

```markdown
---
name: videoclaw-check-status
description: |
  Check the status of a videoclaw project. Use when the user asks
  "where is my video", "is it done", or wants a progress update.
---

# videoclaw: check status

```bash
vclaw video status --project <slug>
```

Returns JSON with the current stage, checkpoint states, and the
`storyboardReviewState` (`missing|current|stale`). Pipe to `jq` to
extract specifics.

For a live MCP-based query (if the host supports MCP):
- Connect to the `videoclaw` MCP server (`vclaw mcp serve`)
- Call the `get_project_status` tool with `{ slug: "<slug>" }`

For the whole portfolio:

```bash
vclaw video list
vclaw video metrics
```
```

Create `mcp/skills-pack/videoclaw-portfolio-review/SKILL.md`:

```markdown
---
name: videoclaw-portfolio-review
description: |
  Review the videoclaw project portfolio — what's in flight, what's
  blocked, what needs attention. Use for "review my videos", "what's
  pending", "portfolio status".
---

# videoclaw: portfolio review

```bash
vclaw video metrics          # aggregate counters
vclaw video next-actions     # what needs doing per project
vclaw video doctor-portfolio # health check across all projects
vclaw video export-csv       # tabular export for spreadsheets
```

All emit JSON (when piped). Combine `metrics` + `next-actions` for a
prioritized worklist. The MCP `list_projects` tool gives the same data
to MCP-aware hosts.
```

- [ ] **Step 4.3: Verify nothing breaks**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm test 2>&1 | tail -5
npm run check:skill-frontdoor
npm run check:cleanroom-docs
```

Note: `mcp/skills-pack/` is NOT under `skills/` so `check:skill-frontdoor` (which scans `skills/*/SKILL.md`) won't touch it. And `mcp/` isn't in `check:cleanroom-docs` targets. If either guardrail DOES flag it, add `mcp/skills-pack/` to the appropriate ignore list (these are agent-authoring templates that legitimately contain CLI examples).

- [ ] **Step 4.4: Commit**

```bash
git add mcp/skills-pack/
git commit -m "Slice 5: external skills pack scaffold (3 sample Claude Code skills)"
```

---

### Task 5: Docs — CLI_REFERENCE + AGENTS + README

**Files:**
- Modify: `docs/CLI_REFERENCE.md`, `AGENTS.md`, `README.md`

- [ ] **Step 5.1: Add MCP section to CLI_REFERENCE.md**

```markdown
## MCP server

`vclaw mcp serve` starts a stdio MCP (Model Context Protocol) server
exposing read-only project introspection to MCP-aware agent hosts
(Claude Code, Codex, Cursor, Antigravity).

### Tools exposed (all read-only)

| Tool | Input | Returns |
|---|---|---|
| `list_projects` | `{ root? }` | All projects in the workspace |
| `get_project_status` | `{ slug, root? }` | Stage + checkpoint state for one project |
| `get_artifacts` | `{ slug, root? }` | The project's JSON artifacts |
| `get_event_log` | `{ slug, limit?, root? }` | Recent events from events.jsonl |
| `list_provider_routes` | `{ root? }` | Provider routes + availability |

**Writes go through the CLI, not MCP.** Per the agent-integration
research, the CLI is the deterministic action surface; MCP is for
live-state queries. To create/modify a project, an agent calls
`vclaw video *` commands directly.

### Configuring an MCP client

In a Claude Code / Codex / Cursor MCP config:

```json
{
  "mcpServers": {
    "videoclaw": {
      "command": "vclaw",
      "args": ["mcp", "serve"]
    }
  }
}
```
```

- [ ] **Step 5.2: Add to AGENTS.md**

In the agent-integration contract section, add a 6th bullet:

```markdown
6. **MCP option.** `vclaw mcp serve` exposes read-only project introspection (list_projects, get_project_status, get_artifacts, get_event_log, list_provider_routes) over stdio MCP. Writes still go through the CLI.
```

- [ ] **Step 5.3: Add README quickstart note**

In `README.md`, find the quickstart / usage section and add:

```markdown
### Agent integration

videoclaw is built as a target for agent hosts, not as an orchestrator.

- **One-call discovery:** `vclaw schema --json` returns the full command contract.
- **MCP server:** `vclaw mcp serve` exposes read-only state queries to MCP-aware hosts.
- **Sample skills:** see `mcp/skills-pack/` for Claude Code skill templates.

See [`docs/AGENT_INTEGRATION_RESEARCH.md`](docs/AGENT_INTEGRATION_RESEARCH.md) for the design rationale.
```

- [ ] **Step 5.4: Commit**

```bash
git add docs/CLI_REFERENCE.md AGENTS.md README.md
git commit -m "Slice 5: document MCP server + skills pack in CLI_REFERENCE + AGENTS + README"
```

---

### Task 6: CHANGELOG + final gate + push

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 6.1: CHANGELOG entry**

Add under the `## [3.0.0-alpha.0]` section's Added entries:

```markdown
### Added (Slice 5 — MCP server + skills pack, shipped)

- `vclaw mcp serve` — stdio MCP server exposing 5 read-only tools (list_projects, get_project_status, get_artifacts, get_event_log, list_provider_routes).
- `src/mcp/` — server + tool handlers wrapping existing src/video/* readers. No write ops via MCP.
- `mcp/skills-pack/` — 3 sample Claude Code skills (create-video, check-status, portfolio-review) demonstrating how agents drive videoclaw.
- Schema dump now includes `mcp serve` (`vclaw schema --json | jq '.commands | length'` → 69).
- `@modelcontextprotocol/sdk` runtime dependency.
```

- [ ] **Step 6.2: Final gate**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run check:release-readiness-lite 2>&1 | tail -10
```

Expected: `release-readiness-lite checks passed`.

- [ ] **Step 6.3: Commit + push**

```bash
git add CHANGELOG.md
git commit -m "Slice 5: CHANGELOG entry for MCP server + skills pack"
git push origin main
```

---

## Failure modes + rollback

- **MCP SDK API drift.** The `@modelcontextprotocol/sdk` API has changed across versions. If the reference code in Task 2 doesn't match the installed version, consult the SDK docs (via Context7 `mcp__claude_ai_Context7__query-docs` for "@modelcontextprotocol/sdk") and adapt. The tests pin behavior, not API shape.
- **stdio server hangs in tests.** NEVER call `startMcpServer()` in a unit test — it blocks on stdin. Tests only call `buildMcpServer()` (construction) + the tool handlers directly.
- **Tool wrapping signature mismatch.** The tools wrap existing src/video/* functions whose signatures you must read first. If `buildProjectIndex` takes different args than assumed, adapt the wrapper. Tests assert observable output shape.
- **Per-task rollback:** `git revert <sha>`.

---

## Test gates

After every commit:
- `npm run build` green
- `npm test` green
- After Task 6 only: `npm run check:release-readiness-lite` green

---

## What ships after Slice 5

- `vclaw mcp serve` — read-only MCP server
- `src/mcp/` — server + 5 tool handlers
- `mcp/skills-pack/` — 3 sample agent skills
- Schema dump at 69 commands
- `@modelcontextprotocol/sdk` dep
- Full agent-integration documentation (CLI_REFERENCE + AGENTS + README)

**This completes the planned v3 unification slices (1, 2, 4, 5 shipped; 3 planned).**

**Remaining v3 work after Slice 5:**
- Slice 3 (Python fold) — the big one, planned but not executed (`docs/superpowers/plans/2026-05-25-slice-3-python-fold.md`)
- Manual follow-up: publish `mcp/skills-pack/` as a standalone `videoclaw-skills` GitHub repo
- Incremental: migrate the remaining ~40 vclaw.ts handlers to VclawError (started in Slice 1 Task 4)
- Eventual: delete the legacy Bun standalone CLI surface (v4.0) + Python scripts (v4.0)
