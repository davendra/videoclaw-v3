# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Repository status (2026-05-25):** This is `videoclaw-v3`, the current repo —
> unified from `videoclaw-v2`, itself the merged successor of the older `videoclaw`
> package and the clean-room `vclaw-video-core` rebuild. (The
> npm package is `videoclaw`; "videoclaw-v3" is just the repo name.) Foundation
> copied from `vclaw-video-core`; presenter skills synced from
> `video-creation-projects/video-replicator-veo-cli/.claude/skills/`; Runway
> transport ported from `videoclaw/src/video/providers/runway-useapi.ts`.
> The full merge plan, decisions, and remaining phases are in `MERGE_PLAN.md` —
> **read it before starting any non-trivial work.** It is the source of truth for
> the architecture and what's coming.

## Repository purpose

`videoclaw` is a TypeScript/Node.js 20 multi-provider video CLI (`vclaw`, with legacy `omx` alias). It targets Veo (Google Flow + UseAPI, including Omni Flash), Seedance, Runway, and Kling. Every pipeline stage is explicit, every artifact is machine-readable JSON, and provider routes never silently fall back across materially different paths. The on-disk per-project layout (`projects/<slug>/{project.json, artifacts/, checkpoints/, characters/, events/, ...}`) is the source of truth; the CLI is a thin operator over it. A browser-based Review UI (`vclaw video review-ui`) handles human-in-the-loop storyboard approval.

## Build, test, and smoke commands

```bash
npm install                              # Node 20+
npm run build                            # clean dist/, tsc, chmod +x the CLI bins
npm run dev                              # tsc --watch
npm test                                 # rebuild, then node --test dist/tests/*.test.js
npm run test:node                        # rerun compiled tests without rebuilding
```

Run a single test file after `npm run build` (or `npm run dev`):

```bash
node --test dist/tests/cli-full-flow.test.js
```

End-to-end smokes (each runs `npm run build` first) and local guardrails:

```bash
npm run smoke:runtime                    # init → brief → storyboard → assets → plan → produce --dry-run → status → report → Obsidian
npm run smoke:native-veo                 # native veo-direct path
npm run smoke:character-hydration        # create-time cast hydration + approval-gate cost
npm run smoke:execution-cancel           # adapter + project-level cancel
npm run smoke:portfolio                  # index → report → export-csv visibility
npm run check:omx-alias                  # omx deprecation wrapper
npm run check:movie-director-wrappers    # bundled Director helper scripts
npm run check:cleanroom-docs             # clean-room docs + skills
npm run check:skill-frontdoor            # repo-local skill front door
npm run check:artifact-schema-coverage   # writers vs schemas drift (advisory; --strict to fail)
npm run check:release-readiness-lite     # one-shot: build + tests + main smokes + guardrails
```

`npm run check:release-readiness-lite` is the preferred local pre-flight before non-trivial changes land.

## Big-picture architecture

### Layers (read top-down)

1. `src/cli/vclaw.ts` — the single user-facing entrypoint. It argparses by hand and dispatches into `src/video/*` modules. `src/cli/omx.ts` is a deprecation wrapper that delegates to the same handlers and prints a notice to stderr. `src/cli/provider-adapter.ts` is the built-in adapter binary for `seedance-direct` / `veo-direct`.
2. `src/video/` — the core domain. Each file is small and single-purpose, e.g. `artifacts.ts`, `artifact-store.ts`, `checkpoints.ts`, `workspace.ts`, `projects.ts`, `status.ts`, `doctor.ts`, `doctor-portfolio.ts`, `readiness.ts`, `execution-plan.ts`, `execute.ts`, `execution-runtime.ts`, `execution-status.ts`, `execution-cancel.ts`, `director-preflight.ts`, `report.ts`, `csv-export.ts`, `obsidian-export.ts`, `project-index.ts`, `metrics.ts`, `next-actions.ts`, `template-store.ts`, `provider-status.ts`, `native-seedance.ts`, `native-veo.ts`.
3. `src/video/provider-platform/` — route descriptors (Veo / Seedance / Runway / Kling direct and useapi flavors).
4. `src/video/pipeline-manifests/` — built-in stage definitions for the two production modes.
5. `schemas/video/` — canonical JSON Schema contracts for artifacts and pipeline manifests. Treat these as the source of truth for artifact shapes.
6. `src/tests/` — `node:test` files named `*.test.ts`. `dist/tests/**.test.js` runs via `node --test`.
7. `src/index.ts` — the public library surface; re-exports the subset of `src/video/*` that should be callable from outside the CLI.

### Project lifecycle (per project, on disk)

After `vclaw video init <slug>`, a project lives at `projects/<slug>/` under the workspace root and is the unit of everything else:

```
projects/<slug>/
  project.json                 # manifest: slug, mode, state, metadata, execution profile
  artifacts/                   # canonical JSON: brief, storyboard, asset-manifest, review-report, publish-report, analyze-output, clone-plan, execution-plan, execution-report, readiness, character-consistency, ...
    history/                   # artifact snapshots (append-only)
  checkpoints/                 # one file per stage: brief, storyboard, assets, review, publish; tracks approval states
  events/events.jsonl          # append-only timeline
  state/                       # derived state cache
  characters/characters.json   # optional character profiles with GB identity anchors
  storyboard.md                # director-mode approval review file (human-readable)
```

Canonical stage order: **init → brief → storyboard → assets → review → publish**. `readiness`, `plan`/`execution-plan`, `produce`/`execute`, `execute-status`, `execute-cancel` are the runtime-execution layer that sits between assets and review.

### Two production modes

Every command accepts `--mode storyboard|director`. Pipeline manifests under `src/video/pipeline-manifests/` define the stage contract per mode. `director` mode adds a storyboard-approval gate: `produce`/`execute` export `storyboard.md` and block before provider submission unless `VIDEOCLAW_APPROVE_STORYBOARD=1` is set. `storyboard-review` (no-execution) can perform preflight + transition the project into `awaiting-approval` without starting a run.

### Review-state ladder

The ops layer tracks a normalized `storyboardReviewState` of `missing | current | stale`. This flows through status, index, report, CSV export, Obsidian export, dashboards, next-actions, snapshot diffs, and the doctor layer. A stale director review blocks `execute`/`execute-status` at runtime even if approval is set. When touching review/approval logic, keep this ladder consistent across all surfaces.

### Provider routes and adapters

Live execution calls route-specific adapters. A custom adapter is set via one of:

```
VCLAW_VEO_DIRECT_ADAPTER
VCLAW_VEO_USEAPI_ADAPTER
VCLAW_SEEDANCE_DIRECT_ADAPTER
VCLAW_RUNWAY_USEAPI_ADAPTER
VCLAW_KLING_USEAPI_ADAPTER
```

Adapters receive JSON on stdin and must return JSON on stdout (`externalJobId` for submit, `pending|completed|failed` for poll).

For `seedance-direct`, `veo-useapi`, and `runway-useapi`, `vclaw` ships a built-in adapter binary (`dist/cli/provider-adapter.js`) used automatically unless the full `..._ADAPTER` override is set. The built-in adapters read route-specific `..._SUBMIT_CMD` / `..._POLL_CMD` / `..._CANCEL_CMD` command shims. Routes also have native in-process transports: `native-seedance.ts` (uses `SUTUI_API_KEY`), `native-veo.ts` (drives the local `vclaw-cli` Bun package), `native-runway.ts` (pure Node fetch + fs, UseAPI bearer auth). `kling-useapi` remains scaffold-only until an adapter is written.

### Gemini key pool

`src/video/gemini-key-pool.ts` provides round-robin selection with per-key cooldown across `GEMINI_API_KEYS`, `GOOGLE_API_KEYS`, `GOOGLE_API_KEY`. `analyze-template --auto` and `analyze --auto` use it via `src/video/gemini-analyze.ts`. `VCLAW_GEMINI_API_ENDPOINT` overrides the endpoint.

### Compatibility aliases (preserve on changes)

- `execution-plan` ↔ `plan`
- `execute` ↔ `produce`
- `omx` ↔ `vclaw` (prints deprecation notice)

`npm run check:omx-alias` enforces the wrapper behavior.

## Conventions that are not obvious

- TypeScript is `strict` with **NodeNext** ESM. Relative imports in `src/` must include the emitted `.js` extension (e.g. `'../video/projects.js'`) — required by NodeNext ESM resolution. Don't "fix" these to drop the extension.
- `dist/` is generated — never edit it, never commit it. Edit `src/` and rebuild.
- Filenames: `kebab-case.ts`. Identifiers: `camelCase` for functions/variables, `PascalCase` for types.
- 2-space indent; modules stay small and single-purpose.
- CLI output is machine-readable JSON by default; do not add silent fallbacks across provider routes.
- Tests use `node:test` with `assert/strict`. Prefer `mkdtemp`/`tmpdir` for temp-directory isolation. Put CLI end-to-end tests under `src/tests/cli-*.test.ts` and module-contract tests under `src/tests/*.test.ts`.
- When adding a new CLI subcommand: update `src/cli/vclaw.ts`, the relevant `src/video/*` module(s), a schema under `schemas/video/` if it introduces or changes an artifact, add a `cli-*.test.ts`, and update `README.md` + `docs/CLI_REFERENCE.md`. The `check:cleanroom-docs` guardrail watches docs drift.
- Project slugs are validated by `isProjectSlug` (`src/video/projects.ts`); both `parseProjectSlug` and `handleVideoInit` (`validateInitSlug`) enforce it so flag-looking values (e.g. `--project`) cannot be silently accepted as slugs. Preserve this guard when adding new slug-accepting commands.
- Architecture diagrams under `docs/assets/*.jpg` are generated from Mermaid sources in `docs/DIAGRAMS_SOURCE.md`. Edit the Mermaid blocks there and regenerate the images via the Go Bananas Pro model — never hand-edit the JPGs.
- `check:skill-frontdoor` deliberately ignores `skills/seedance-prompts/SKILL.md` and the three presenter skills (`bunty`, `davendra-presenter`, `nex-presenter`) because their docs legitimately reference the legacy Python pipeline scripts. Don't "fix" the ignore list — it's load-bearing.
- Do not commit secrets, `.env.local`, provider cookies, or `.omx/` state (already gitignored).

## Autonomy directive (from AGENTS.md)

Proceed by default on obvious next steps. Keep work scoped to this repository and its generated `projects/<slug>/` folders. If a blocker is local and solvable, solve it; if it's external, note it and continue with the next meaningful lane rather than pausing for confirmation.

## Recommended reading order

`docs/ARCHITECTURE.md` → `docs/CLI_REFERENCE.md` → `docs/OPERATIONS.md` → `docs/OBSIDIAN.md` → `docs/TEMPLATES.md` → `docs/MIGRATION.md` → `docs/DEPRECATION.md` → `docs/RELEASE_READINESS.md` → `docs/MASTER_PLAN_ALIGNMENT.md` → `docs/DIAGRAMS_SOURCE.md`.
