# Architecture

`videoclaw` (npm package: `videoclaw`) is a multi-provider video CLI
that grew out of two predecessor codebases:

- the original `videoclaw` package (v0.11.x) which had an orchestration
  layer (ralph / ralplan / team / MCP servers) on top of a video pipeline
- the clean-room `vclaw-video-core` rebuild which kept only the video
  pipeline with strict on-disk artifacts + approval gates

v2 takes `vclaw-video-core` as the foundation, drops the orchestration
layer (Claude Code / Codex now cover those concerns natively), and ports
forward selected pieces from `videoclaw`: the `vclaw-cli` Bun package
(formerly `veo-cli`), the Runway transport, a curated Python pipeline,
and the Google Flow v1 + Omni Flash backend additions.

## What's intentionally NOT here

The following subsystems from the original `videoclaw` v0.11.x are
deliberately dropped. See `MERGE_PLAN.md` §3 for the rationale:

- `src/team/` (tmux team coordination)
- `src/ralph/`, `src/ralplan/` (persistent loops + consensus planning)
- `src/mcp/` (state / memory / code-intel / team / trace MCP servers)
- `src/hooks/`, `src/autoresearch/`, `src/hud/`, `src/visual/`,
  `src/openclaw/`, `src/sparkshell/`, `src/runtime/`, `src/subagents/`,
  `src/notifications/`, `src/verification/`
- `crates/` (would have been Rust performance components if they had
  ever been checked in — they were referenced in CLAUDE.md but never
  existed in source)

Equivalents exist in Claude Code (native subagents), the OMC plugin
(ralph / team / autopilot skills), and similar host CLI tooling.

## Sidecars

The main repo is pure TypeScript Node 20+, but two opt-in sidecars
extend it:

- **`vclaw-cli/`** — Bun package (formerly `veo-cli`). Multi-provider
  video automation: Google Labs Flow (Veo 3.x direct + Omni Flash) via
  Puppeteer scraping, UseAPI (Veo / Seedance / Runway), local
  SQLite job tracking. The main repo's `native-veo.ts` invokes this
  package for the `veo-direct` transport.
- **`skills/video-replicator/scripts/`** — Python 3.10+ pipeline. 122
  modules covering the Seedance Prompt Director (compose / chain /
  critique / reference-validator / hooks), the bunty cricket pipeline,
  character sheet generation, presenter helpers, video assembly, and
  audio utilities. Documented at `docs/PYTHON_PIPELINE.md`.

## Current layers

1. `src/cli/`
   - user-facing command entrypoints
2. `src/video/provider-platform/`
   - provider route descriptors
3. `src/video/provider-status.ts`
   - environment, dependency, and route health reporting
4. `src/video/pipeline-manifests/`
   - built-in stage definitions for `storyboard` and `director`
5. `schemas/video/`
   - canonical machine-readable contracts
6. `src/video/*`
   - portfolio management, reporting, templates, readiness, character consistency, execution planning, adapter-backed execution runtime, and Obsidian export
   - native in-process transports: `native-veo.ts` (→ `vclaw-cli`/Bun), `native-seedance.ts` (SUTUI_API_KEY), `native-runway.ts` (UseAPI Bearer, pure-Node fetch)
   - `review-ui.ts` — HTTP server (port 4317) that drives the browser-based storyboard review station at `tmp/review-station/index.html`. See `docs/REVIEW_UI_STORYBOARD_WORKFLOW.md`.
   - `prompt-quality.ts` — six Seedance-handbook anti-pattern checks (adjective soup, multiple actions, multiple camera moves, style-word overload, literary emotion language, overlong prompts) wired into `director-preflight`, warnings by default and promotable to blocking errors via `DIRECTOR_STRICT_PROMPT_QUALITY=1`
   - `dialogue-fit.ts` — short-clip dialogue duration checks wired into `director-preflight`, warnings by default and promotable to blocking errors via `DIRECTOR_STRICT_DIALOGUE_FIT=1`
   - `generation-telemetry.ts` — route/task/config/cost/timing/output telemetry recorded into project event ledgers and used by cost estimates when completed Seedance USD samples exist
7. `src/video/providers/`
   - per-provider HTTP adapter code (currently `runway-useapi.ts`). Each adapter exports submit/poll/cancel functions that accept an optional `fetchImpl` for test injection. Wrapped by `src/video/native-*.ts` for production use.

## Principles

1. No silent fallback across materially different provider paths
2. Every stage should eventually have a canonical artifact
3. CLI output should be machine-readable by default
4. Architecture remains small until the contracts are stable

## Near-term roadmap

1. Add more review/publish automation around generated outputs
2. Keep tightening the transport contracts without widening orchestration complexity
3. Expand higher-level operator ergonomics on top of the current runtime
4. Keep docs/help output aligned with the actual product surface
5. Add selective provider-specific polish only where real runs justify it

## Current implemented flow

1. `video init`
   - creates canonical project workspace
2. `video brief`
   - writes `brief.json`
   - marks `brief` checkpoint complete
3. `video storyboard`
   - writes `storyboard.json`
   - marks `storyboard` checkpoint complete
4. `video assets`
   - writes `asset-manifest.json`
   - marks `assets` checkpoint complete
5. `video review`, `video review-ui`, or `video review-autopilot`
   - writes `review-report.json`
   - marks `review` checkpoint to completed, retry-required, or failed
   - allows publish handoff only when the saved report has `verdict: "pass"` and `metrics.publishReady: true`
6. `video publish`
   - writes `publish-report.json`
   - marks `publish` checkpoint complete or failed
7. `video status`
   - resolves next stage from manifest + checkpoints
8. `video doctor-project`
   - validates checkpoint/artifact consistency
9. `video doctor-portfolio`
   - validates the whole portfolio
10. `video metrics|workload|next-actions|dependencies`
   - portfolio management views
11. `video report|report-snapshot|report-history|report-diff|trends|export-csv`
   - reporting and snapshot history
12. `video export-obsidian|sync-obsidian|scaffold-obsidian-vault`
   - Obsidian operations layer
13. `video playbook-list|playbook-show`
   - bundled prompt/playbook registry
14. `video prompt-lib-list|prompt-lib-show`
   - imported prompt/reference library
15. `video template-save|template-list|template-show|clone-plan|clone-init|storyboard-from-clone`
   - reusable template / clone bridge
16. `video clone-execute`
   - template -> storyboard -> execution-seed -> runtime in one flow
17. `video readiness`
   - artifact, character-consistency, image-input, scene-selection, and director identity-sheet readiness before runtime execution
18. `video plan|produce|execute-status`
   - route selection, payload generation, dry-run validation, built-in or external adapter execution, polling, output ingestion, native Seedance direct transport, native Veo direct transport, and prompt-guided execution context
19. `video character-add|character-list|character-show|character-consistency`
   - character profile subsystem and continuity enforcement
20. `video reference-sheet-add|list|show|bind|validate`
21. `video candidates-list|candidates-show|select-candidate|reject-candidate|reroll-scene|chain-from|unchain|candidates-migrate-from-assets`
    - per-scene candidate registry + operator selection state + chain-from-prev
    - partial rerun via `produce --scene <n>`
    - role-tagged reference sheets with closed-vocabulary validation and per-scene binding
22. `video cost-estimate`
    - static default estimate with optional historical Seedance USD telemetry override

Compatibility aliases:

1. `video execution-plan` -> `video plan`
2. `video execute` -> `video produce`
