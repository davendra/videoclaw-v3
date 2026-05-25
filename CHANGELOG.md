# Changelog

All notable changes to `videoclaw-v2` (npm: `videoclaw`).

Format loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The repo follows [Semantic Versioning](https://semver.org/).

## [3.0.0-alpha.0] — 2026-05-25 (unreleased)

The **v3 unification line**. Same repo, major-version cutover. Pre-cutover
snapshot tagged as `v2.x-final` (npm 0.12.0). Full design at
[`docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`](./docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md).

**Reframe:** intent classification is the host's job (Claude Code / Codex /
Antigravity / Cursor / Warp), not the CLI's. videoclaw becomes a narrow,
deterministic, agent-friendly toolkit. No NL front door, no in-CLI
orchestration layer. Research that resolved this question:
[`docs/AGENT_INTEGRATION_RESEARCH.md`](./docs/AGENT_INTEGRATION_RESEARCH.md).

### Added (Slice 1 — agent-friendly polish, shipped)

- `vclaw schema --json` — single-call introspection bundle (commands, flags, artifact schemas, error codes, exit codes)
- Exit-code taxonomy (0=success, 1=user error, 2=system error, 3=gate). Documented in CLI_REFERENCE.md.
- Stable string error codes in JSON output. Catalog at `schemas/video/errors.json`.
- JSON default on non-TTY stdout via `writeOutput()` helper.
- TTY-safe progress: spinners/colors to stderr only.
- Noun-verb command aliases (e.g., `vclaw video character list` ↔ `vclaw video character-list`).

### Changed (Slice 2 — skill consolidations, shipped)

- Presenter family made parametric: `bunty`, `davendra-presenter`, `nex-presenter` reduced from ~560/820/842-line workflow duplicates to ~25-line stubs driven by per-skill `brand-profile.json` (~2126 lines removed). New `schemas/video/brand-profile.schema.json`.
- `video-framework` is now the sole video front door; `video-replicator` demoted to reference-only (auto-trigger disabled).
- `director-video` merged into `movie-director` (deleted — was a strict subset).
- `creative-brief` 7-question intake folded into `video-framework` intake mode (deleted; reference files moved to `video-framework/references/`).
- `seedance-music-video-prompts` merged into `seedance-prompts` as a music-video subsection (deleted; reference file moved).

### Added (Slice 4 — Bun standalone surface collapse, shipped)

- `vclaw veo {status|list|history|resume|reset|cancel}` — 6 standard verbs bridging to the Bun CLI via `spawnVeo()`.
- `vclaw veo useapi:*` — 7 UseAPI verbs (accounts, captcha, health, image, image:upscale, gif, upscale).
- `src/video/veo-subprocess.ts` — shared `spawnVeo()` helper for the Bun bridge.
- Schema dump now includes 13 new `veo *` entries (`vclaw schema --json | jq '.commands | length'` → 68).
- Bun runtime is now an explicit requirement for Veo / Google Flow access (documented in CLI_REFERENCE).
- Legacy `bun run vclaw-cli/flow.ts <verb>` still works in v3.0 (soft-deprecation; banner in `vclaw-cli/CLAUDE.md`).

### Added (Slice 5 — MCP server + skills pack, shipped)

- `vclaw mcp serve` — stdio MCP server exposing 5 read-only tools (list_projects, get_project_status, get_artifacts, get_event_log, list_provider_routes).
- `src/mcp/` — server + tool handlers wrapping existing src/video/* readers. No write ops via MCP.
- `mcp/skills-pack/` — 3 sample Claude Code skills (create-video, check-status, portfolio-review) demonstrating how agents drive videoclaw.
- Schema dump now includes `mcp serve` (`vclaw schema --json | jq '.commands | length'` → 69).
- `@modelcontextprotocol/sdk` runtime dependency.

### Removed (breaking)

- **`omx` deprecation alias** — `src/cli/omx.ts`, the `omx` bin entry in
  `package.json`, the `check:omx-alias` guardrail, and `scripts/check-omx-alias.sh`.
  Use `vclaw` directly.
- **`kling-useapi` provider route** — never had a working transport
  (scaffold-only since merger). Removed from registry, router, schemas
  (`execution-plan.schema.json`, `execution-report.schema.json`),
  `provider-status`, `execution-runtime`, and provider-status tests.
  `VCLAW_KLING_USEAPI_ADAPTER` env var no longer consumed.
- **Convex cloud-DB code** in `vclaw-cli/` — removed from `src/db-unified.ts`,
  `src/index.ts`, and `CLAUDE.md`. Convex was a deployment-target experiment
  that v3 doesn't pursue.

### Changed

- **`skills/video-replicator-workspace/`** → **`docs/evals/video-replicator/`**.
  Was orphan (not in `catalog.json`); contents are eval data, not a skill.
  Moved to docs where reference material belongs.

### Coming in v3 (per [unification spec](./docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md))

- Slice 1 — Agent-friendly polish: `vclaw schema --json`, JSON default
  when stdout is not a TTY, stable string error codes, exit-code taxonomy.
- Slice 2 — Skill consolidations (presenter family → parametric
  `brand-presenter`; `video-framework` as sole front door; etc.).
- Slice 3 — Python pipeline fold into TS (single `npm install -g videoclaw`).
- Slice 4 — Collapse `vclaw-cli` standalone surface into `vclaw veo:*`.
- Slice 5 — Optional MCP server + external `videoclaw-skills` pack.

---

## [0.12.0] — 2026-05-25

The **merged successor** of the original `videoclaw` package (v0.11.x) and the
clean-room `vclaw-video-core` rebuild. See [`MERGE_PLAN.md`](./MERGE_PLAN.md)
for the full rationale and per-phase architecture decisions.

### Added

- **Multi-provider video transport layer** — 5 routes (`veo-direct`,
  `veo-useapi`, `seedance-direct`, `runway-useapi` production; `kling-useapi`
  scaffold). Rich provider descriptors with `controls`, `operationSupport`
  per aspect ratio, `routingHints`, and `escapeHatches`. Router selects routes
  by capability + policy (`trust-first` / `capability-first` / `balanced`).
- **Native in-process transports** — `native-veo.ts` (Bun + Puppeteer Google
  Flow via `vclaw-cli`), `native-seedance.ts` (`SUTUI_API_KEY`),
  `native-runway.ts` (UseAPI bearer, pure-Node fetch). Bypass the adapter
  subprocess hop for built-in providers.
- **Browser-based Review UI** — `vclaw video review-ui` boots an HTTP server
  on port 4317. Single-page storyboard review station bundled in
  `tmp/review-station/index.html`. Companion `vclaw video review-autopilot`
  for agent-driven runs.
- **Per-project on-disk contract** — `projects/<slug>/{project.json,
  artifacts/, checkpoints/, characters/, events/events.jsonl, ...}`. Strict
  separation of canonical (committed) vs derived (gitignored) directories.
  Slug validation enforced at `vclaw video init` time (3-64 chars, reserved
  names blocked, argv-as-slug bug guarded).
- **`vclaw-cli/` Bun sidecar** — multi-provider video automation (Google
  Labs Flow + UseAPI for Veo/Seedance/Runway/Kling). Renamed from `veo-cli`
  to reflect its multi-backend reach. SQLite job tracking; Convex cloud-DB
  support intentionally dropped.
- **Python pipeline sidecar** — 122 modules in
  `skills/video-replicator/scripts/`, opt-in. Seedance Prompt Director,
  bunty/cricket-recap pipeline, character sheet generation, video
  assembly, audio utilities, Omni Flash V2V + voice-narration kwargs.
- **52 skills** in `skills/` — including the presenter family
  (`brand-presenter` canonical + `bunty`/`davendra-presenter`/`nex-presenter`
  brand profiles + `ui-ux-pro-max`), the video-production family
  (`video-framework` canonical + 19 specialists), workflow skills
  (ralph/ralplan/team/autopilot/...), and meta skills.
- **Pre-flight gates** — `bunty_narration_check.py` +
  `bunty_image_filter_check.py` are presenter-agnostic Gemini Vision checks
  that catch off-by-one beats and Veo content-filter rejections BEFORE
  paying for TTS/Veo. Cross-pollinated to `davendra-presenter` and
  `nex-presenter` SKILL.md docs.
- **Release-readiness pre-flight** — `bash scripts/check-release-readiness-lite.sh`
  runs build + 474-test suite + 7 smoke harnesses + 5 guardrails
  (`check-omx-alias`, `check-movie-director-wrappers`, `check-cleanroom-docs`,
  `check-skill-frontdoor`, `check-artifact-schema-coverage`).
- **Documentation** — `docs/MERGE_PLAN.md` (1900+ line plan),
  `docs/ARCHITECTURE.md`, `docs/PROVIDER_PLATFORM.md`,
  `docs/PROJECT_LAYOUT.md`, `docs/PYTHON_PIPELINE.md`,
  `docs/DIAGRAMS_SOURCE.md` (Mermaid source for the 3 brand-aligned JPGs
  in `docs/assets/`), plus 17 other operator/reference docs.
- **GitHub Actions CI** — `ci.yml` runs build + tests + smokes on every push.

### Changed

- **CLI surface** — primary binary is `vclaw`. `omx` remains as a
  deprecation alias that prints a stderr notice (enforced by
  `check:omx-alias`).
- **Provider descriptor schema** — upgraded from the flat
  `supportedOperations[]` shape (vclaw-video-core's) to the rich
  `operationSupport[].{operation, aspectRatios, notes, maxReferenceImages}`
  shape (from videoclaw). Consumer code in `provider-status.ts` and
  `execution-plan.ts` migrated to the new shape; status report API
  unchanged.
- **License** — dual-license model preserved from vclaw-video-core: free
  for personal/non-commercial/eval/internal use; paid commercial license
  required for revenue-generating production use.

### Removed

- **Orchestration layer** from the legacy `videoclaw` — `src/team/`,
  `src/ralph/`, `src/ralplan/`, `src/mcp/`, `src/hooks/`,
  `src/autoresearch/`, `src/hud/`, `src/visual/`, `src/openclaw/`,
  `src/sparkshell/`, `src/runtime/`, `src/subagents/`,
  `src/notifications/`, `src/verification/`. Claude Code's native
  subagents + OMC's plugin ecosystem cover the same workflows.
- **Convex cloud-DB integration** from vclaw-cli — `db-convex.ts`
  deleted (704 lines); `db-unified.ts` rewritten as a SQLite-only
  pass-through preserving the async API shape so callers don't
  break. `syncToConvex` and `runSync` removed from the CLI.
- **`presenter-video` legacy-parent skill** — superseded by
  `brand-presenter` as the canonical generic entry; per-brand profiles
  (bunty/davendra-presenter/nex-presenter) alias off it.
- **`docs-site/` VitePress** from the legacy `videoclaw` — 73 pages of
  orchestration-flavored docs replaced by the flat `docs/*.md` surface.

### Fixed

- `vclaw video init --project foo` previously accepted `--project` as
  the slug due to missing argv validation. Phase 7 added
  `validateInitSlug()` with regex enforcement + reserved-name guard.
- Stale `bun run google.ts` references throughout the Python pipeline
  (10 instances in `parallel_video_gen.py`) were left over from the
  vclaw-cli rename in Phase 1a. Fixed in Phase 8b — Python now correctly
  invokes `bun run flow.ts` and checks for `flow.ts` existence.
- README's Mermaid provider-routing diagram referenced 2 providers
  pre-Runway (`veo-direct · seedance-direct`); now correctly enumerates
  all 5 routes including post-Phase-5b runway-useapi.

### Synced from upstream `videoclaw` PRs (Phase 8 + 8b)

- **PR #25** (`ae9d1145`) — Flow voice validator + actionable concat
  error + docs. Already in Phase 1a foundation.
- **PR #26** (`854a0d2b`) — Documented Google bug **b/515000564** that
  blocks Omni Flash V2V via the public API. Diagnosed via 34 live API
  attempts; cross-referenced against Josh Woodward's acknowledgement.
- **PR #27** (`d52adb3b`) — Python orchestrator gains `voice` and
  `ref_video` kwargs in `generate_scene()` so scene specs constructed
  in Python can activate omni-flash voice narration and V2V edit without
  bypassing the orchestrator. v2's surgical port adds the kwargs
  without backporting the unrelated `model`/`duration` cascade.
- **PR #28** (`92289eca`) — Mocked-HTTP coverage for `uploadVideo` binary
  POST path (+143 test lines). Surfaces 404 account-not-found readably;
  URL-encodes the account email in the asset path.
- **PR #29** (`c1d8b3fc`) — CostEstimate field rename USD → credits
  (values were always credits; only field names were stale). Pure
  rename + cascade through 3 callers.
