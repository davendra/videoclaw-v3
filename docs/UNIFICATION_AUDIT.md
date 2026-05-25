# videoclaw-v2 Unification Audit

> **Status:** Phase A discovery output. Findings here feed into the Phase B
> unification design and Phase C implementation. No code changes yet.
>
> **Audit date:** 2026-05-25
> **Audit scope:** entrypoints · skills · provider routes · pipeline stages

## Executive summary

videoclaw-v2 today is **four loosely-coupled subsystems sharing a name**:

1. The TS core (`src/video/*` + `vclaw` CLI) operating on `projects/<slug>/` JSON
   artifacts.
2. A separate Bun package (`vclaw-cli/`) with its own CLI surface and SQLite
   job DB, kept alive because Node can't host the Puppeteer/CDP path to Google
   Flow.
3. A Python pipeline under `skills/video-replicator/scripts/` (~14 user-facing
   entrypoints) that produces stitched MP4s end-to-end **with zero code or
   artifact-format overlap** with the TS pipeline.
4. 52 skills, of which ~18 are user-facing video verbs and the rest are OMX
   harness plumbing not in scope for unification.

The four pain points the user named map cleanly to four findings:

| User pain | Root cause from audit |
|---|---|
| Too many entrypoints | 3 TS bins + 1 Bun CLI + ~14 Python entrypoints; ~40 env vars; no manifest. |
| Skill discovery | 6+ confirmed skill-merge candidates; no single "what should I run for X" registry. |
| Provider routing complexity | Only 3 of 5 routes are production-ready; router exists but ignores half the available signals; `veo-direct` is a phantom (production-marked, no transport). |
| Manual pipeline | 6 approval/decision gates in director mode; 3 already auto-able via flags; `vclaw video auto` already exists in dispatch but isn't surfaced. |

**The unification has a head start most users don't see**: there is already a
`vclaw video auto` primitive, a scoring router, route descriptors, and the
canonical `projects/<slug>/` layout. The gap is **not** "build a new
orchestrator" — it's "wire what exists into a single front door, retire what
duplicates it, and decide whether the Python pipeline gets folded in or stays
separate behind a stable contract."

---

## A. Entrypoints inventory

### A.1 TypeScript CLI binaries

| Binary | Source | Purpose | Status |
|---|---|---|---|
| `vclaw` | `src/cli/vclaw.ts` | Primary user-facing CLI. Hand-rolled argparser dispatching `video init/brief/storyboard/assets/review/publish/produce/execute/...`, readiness, plan, doctor, portfolio, review-ui, Obsidian, character/library, template/clone. | **Primary** |
| `omx` | `src/cli/omx.ts` | One-line legacy alias. Delegates to `vclaw.main()`, prints deprecation notice. Kept alive only by `check:omx-alias`. | **Dead weight** — 1-commit removal |
| `vclaw-provider-adapter` | `src/cli/provider-adapter.ts` | Built-in adapter binary spawned by `execution-runtime`. Reads JSON on stdin, dispatches to `..._SUBMIT_CMD`/`..._POLL_CMD`/`..._CANCEL_CMD` shims, returns JSON on stdout. | **Internal** (not a real "front door"; could become an internal module via `import()`) |

### A.2 Bun-based CLI (`vclaw-cli/`)

A separate `private: true` Bun package (`vclaw-cli@1.2.0`, engine `bun >=1.3.5`) driving Google Labs Flow via Puppeteer browser automation — a runtime the main Node package can't host (real-browser CDP, headful login, reCAPTCHA execution, FileChooser uploads). Single entry is `vclaw-cli/flow.ts`, invoked as `bun run flow.ts`.

It exposes **its own duplicate subcommand surface**: `status | list | history | resume | reset | cancel | help` (SQLite-backed batch tracking) + `useapi:accounts | captcha | health | image | image:upscale | gif | upscale` + `sync` (Convex migration). Backend selection via `--backend direct|useapi`.

`native-veo.ts` already bridges the two by spawning the Bun CLI as a subprocess. The 7+ standalone subcommands in `flow.ts` (status/list/history/resume/reset/cancel + useapi:*) duplicate functionality available through `vclaw` and could collapse into a single `vclaw veo:*` subtree.

### A.3 Python user-facing entrypoints (14)

All but two live under `skills/video-replicator/scripts/`. They are referenced from `bunty`, `davendra-presenter`, `nex-presenter` SKILL.mds **without a manifest** — discoverability is via grep.

| Script | Skill(s) | Purpose |
|---|---|---|
| `bunty_match_to_deck.py` | bunty | Match Bunty narration → slide pages |
| `bunty_narration_check.py` | bunty, presenters | Narration QA / linter |
| `bunty_image_filter_check.py` | bunty, presenters | Image-filter QA pass |
| `bunty_regen.py` | bunty | Regen intro/outro segments by location |
| `parallel_video_gen.py` | bunty, presenters | **Parallel video-gen runner** (the Bunty/Nex pipeline core) |
| `generate_tts.py` | bunty, presenters | Text-to-speech |
| `generate_music.py` | bunty, presenters | Background music |
| `generate_title_card.py` | bunty, nex-presenter | Title-card image |
| `stitch_bunty.py` | bunty | **Final stitch**: narration + slides + b-roll → MP4 |
| `bunty_animate_slides.py` | bunty, presenters | Animate static slides → motion clips |
| `extract_pdf_slides.py` | bunty, presenters | Extract slides from PDF deck |
| `nex_assemble.py` | nex-presenter, davendra-presenter | **Final assembly** for Nex/Davendra episodes |
| `brand_episode.py` | nex-presenter | One-shot brand-episode orchestrator |
| `search.py` | ui-ux-pro-max | Design-system reference search |

### A.4 Provider adapter env-var contract

Resolved in `execution-runtime.ts:19-32` and `provider-status.ts:49-59`. `..._ADAPTER` wins if set; otherwise built-in `vclaw-provider-adapter --route <id>` is spawned for the 3 routes that have a fallback.

| Env var | What it expects |
|---|---|
| `VCLAW_VEO_DIRECT_ADAPTER` | **Required** for `veo-direct` (no built-in fallback exists) |
| `VCLAW_VEO_USEAPI_ADAPTER` | Override; built-in fallback available |
| `VCLAW_SEEDANCE_DIRECT_ADAPTER` | Override; built-in fallback available |
| `VCLAW_RUNWAY_USEAPI_ADAPTER` | Override; built-in fallback available |
| `VCLAW_KLING_USEAPI_ADAPTER` | **Required** — no built-in (scaffold route) |
| `VCLAW_<ROUTE>_{SUBMIT,POLL,CANCEL}_CMD` (×3 routes) | Shell commands the built-in adapter pipes JSON in/out of |
| `VCLAW_VEO_BUN_BIN` | Path to local Bun binary for native-veo |

### A.5 Cross-cutting observations

- **Two parallel video-gen pipelines.** `vclaw video execute` (TS) and the Python Bunty/Nex chain (`parallel_video_gen.py` + `stitch_bunty.py` + `nex_assemble.py`) both produce stitched MP4s. **Zero shared code, zero shared artifact format.** Strongest unification candidate.
- **Two runtimes.** Node + Bun, kept apart only because Puppeteer/CDP needs Bun's faster startup + real-browser support. `native-veo.ts` already bridges. Bun CLI's standalone subcommands are duplication.
- **Three storage runtimes.** `projects/<slug>/` JSON (canonical), Bun SQLite `veo-cli.db` (job tracking), optional Convex (migration target). Pick one.
- **`omx` is dead weight.** 1-commit removal.
- **No skills entrypoint manifest.** 14 Python scripts, no `__entrypoints__.json`. A `scripts/cli.py` dispatcher (`python -m videoreplicator <verb>`) would collapse this to one addressable surface.

---

## B. Skills catalog audit (52 skills)

### B.1 Status breakdown (from `skills/catalog.json`)

- **18 user-facing video skills** (presenters, movie-director, creative-brief, ugc, character-creator, video-replicator, video-thumbnail-lab, video-post, studio-mode, video-framework, etc.)
- **20 orchestration-internal** (video-storyboard, video-clone-ad, video-analyze-template, video-portfolio-ops, ralph, autopilot, team, worker, pipeline, cancel — OMX harness plumbing, **out of scope for unification**)
- **9 utility/library** (trace, hud, doctor, skill, configure-notifications, git-master, omx-setup, skills-auditor — also out of scope)
- **5 redundant/alias** (bunty / davendra-presenter / nex-presenter → brand-presenter; movie-director vs director-video; video-replicator vs video-framework)
- **1 orphan**: `video-replicator-workspace/` on disk, **not** in catalog.json — vestigial, safe to delete

### B.2 High-value consolidations (ordered by ROI)

| # | Consolidation | Effort | Rationale |
|---|---|---|---|
| 1 | **Presenter family → parametric `brand-presenter`** | ~1 day | Catalog already declares 3 children as `alias`. Each child SKILL.md duplicates ~500 lines of workflow with only `character_id` + brand strings changing. Make `brand-presenter` parametric on `brand-profile.json`; reduce children to 20-line profile stubs. |
| 2 | **`video-framework` as sole front door; demote `video-replicator`** | ~half day | Both currently claim "front door" role; `video-replicator` self-describes as legacy 7-mode reference and says "use video-framework as front door". Keep video-framework, move video-replicator content to references. |
| 3 | **Fold `creative-brief` into `video-framework`** | ~half day | creative-brief is a 7-question intake; video-framework needs exactly that. Merge as the intake mode. |
| 4 | **Merge `movie-director` ← `director-video`** | ~half day | Same Director-mode pipeline, near-identical triggers. movie-director is richer (12 genres, interview/auto/hybrid). Fold director-video, alias it. |
| 5 | **Delete `video-replicator-workspace/` orphan** | 1 commit | Not in catalog.json. |
| 6 | **Merge `seedance-prompts` + `seedance-music-video-prompts`** | ~quarter day | Music-video is strict subset. Keep one with `--music-video` subsection. |
| 7 | **`character-creator` + `character-library` → `characters`** | ~quarter day | Clean halves. Consider merging into one skill with `create|list|audit|patch|delete` sub-actions, or keep split if intentional. |

### B.3 User-facing entry verbs (what unification front door should expose)

- "make me a video" → **video-framework** (intake + routing)
- "make a presenter / Bunty / Davendra / Nex video" → **brand-presenter** (parametric)
- "make me a short film / movie / cinematic ad" → **movie-director**
- "make me a UGC ad campaign" → **ugc**
- "clone / analyze this ad" → **video-clone-ad**, **video-analyze-template**
- "make a thumbnail / post-process / package" → **video-thumbnail-lab**, **video-post**
- "manage my characters" → **character-creator** (+ library)
- "studio mode (interview-driven)" → **studio-mode**
- "download from youtube" → **youtube-audio**

~10 verbs. Everything else is plumbing.

### B.4 Vestigial / drop

- `video-replicator-workspace/` (orphan)
- `video-replicator` SKILL (superseded; keep only if external docs name it)
- `bunty`, `davendra-presenter`, `nex-presenter` SKILL.md (collapse to brand-profile stubs after #1)
- `director-video` (superseded by movie-director)
- `creative-brief` (folded into video-framework)
- `seedance-music-video-prompts` (folded)

---

## C. Provider routes inventory

### C.1 Route status

| Provider | Route ID | Native? | Built-in adapter? | Tests/smoke? | Status |
|---|---|---|---|---|---|
| Veo | `veo-direct` | No | No | Routing tests only | ⚠️ **Phantom**: marked `production` but `execution-runtime.ts:34-40` excludes from builtin dispatch — throws unless `VCLAW_VEO_DIRECT_ADAPTER` set |
| Veo | `veo-useapi` | ✅ `native-veo.ts` (spawns Bun + `vclaw-cli/flow.ts`) | ✅ | `native-veo.test.ts`, `smoke:native-veo` | **Production-ready** (depends on Bun + Google Flow cookies) |
| Seedance | `seedance-direct` | ✅ `native-seedance.ts` (pure Node fetch) | ✅ | `native-seedance.test.ts`, `smoke:execution-cancel` | **Production-ready** |
| Runway | `runway-useapi` | ✅ `native-runway.ts` (pure Node fetch) | ✅ | `native-runway.test.ts`, `runway-useapi.test.ts` | **Production-ready** ⚠️ no real cancel — local state only |
| Kling | `kling-useapi` | No | No | Asserts `degraded` only | **Scaffold** |

**Only 3 of 5 routes are usable today**: `veo-useapi`, `seedance-direct`, `runway-useapi`.

### C.2 Env vars per route

| Route | Required | Optional |
|---|---|---|
| `veo-direct` | (none registered, but unusable without `_ADAPTER` shim) | — |
| `veo-useapi` | `USEAPI_API_TOKEN`, `USEAPI_ACCOUNT_EMAIL` | `VCLAW_VEO_CLI_ROOT`, `_OUTPUT_DIR`, `_BUN_BIN`, `_COMMAND_TIMEOUT_MS`, Flow cookies |
| `seedance-direct` | `SUTUI_API_KEY` | `VCLAW_SEEDANCE_BASE_URL` |
| `runway-useapi` | `USEAPI_API_TOKEN` | `VCLAW_RUNWAY_MODEL`, `VCLAW_RUNWAY_MODE` |
| `kling-useapi` | (declared but no transport reads them) | — |

Universal: `GEMINI_API_KEYS` / `GOOGLE_API_KEYS` / `GOOGLE_API_KEY` for analyze; not tied to a transport.

### C.3 Auto-routing potential

`router.ts` already scores routes by:
- Operation kind (T2V / I2V / F2V / I2gV / V2V / add-audio / extend / edit)
- Aspect ratio (`veo-useapi` +25 for portrait I2V/F2V — only auto-unlock today)
- Workflow tag (product-demo-spokesperson, ad-creative-variants, generic)
- Cost / latency preference
- Required controls (audio, lip-sync, multi-shot)
- Route health (offline/deprecated/degraded filter)

**Not yet used**: duration (Runway 5/8/10/15, Seedance ≤15s), input MIME (derived in execution-runtime but not surfaced to router), resolution, `generateAudio` flag. Wiring these would let the router auto-pick for ~all common cases.

### C.4 Merge candidates

- **`veo-direct` + `veo-useapi` → single `veo` provider**, transport auto-picked. Today `veo-direct` is unusable without an external shim — a smart `veo` provider would transparently fall through to `useapi` when no direct adapter exists.
- **Shared `useapi-client.ts`** for the 3 UseAPI routes (token + base URL + asset upload). Removes duplication in `native-runway.ts:140-161` + `providers/runway-useapi.ts`.
- **Extract `native-shared.ts`** before adding a 4th native transport — `native-seedance.ts` and `native-runway.ts` already share `readDotEnvLike`, `loadWorkspaceEnv`, `jobStateDir`, `classifyReferences`, `downloadToFile`.

### C.5 Open questions

- Downgrade `veo-direct` to `scaffold` until `vclaw-cli/flow.ts --backend google-flow` is wired in `native-veo.ts`?
- Surface `cancelSemantics: 'local-only' | 'server-side'` on the registry so operators don't expect a real cancel for Runway?
- `kling-useapi` declares `USEAPI_ACCOUNT_EMAIL` required but no code reads it — stale from Joey-Flags era? Drop?
- Only `smoke:native-veo` exercises a live transport. Add `smoke:native-seedance` + `smoke:native-runway` (gated on env vars) to catch transport regressions before release?

---

## D. Pipeline stages, artifacts, env vars

### D.1 Canonical stage order

Two modes (`storyboard`, `director`) share the order; director adds the `storyboard.md` gate.

| Stage | User invokes | Produces | Auto-advance? |
|---|---|---|---|
| init | `vclaw video init <slug> [--mode]` | `project.json` + dirs | ✅ Yes (pure scaffold) |
| brief | `vclaw video brief --project ... --title --intent ...` | `brief.json` + checkpoint | ✅ Yes if title+intent supplied |
| storyboard | `vclaw video storyboard --project ... --scene ... \| --template ...` | `storyboard.json` + checkpoint (director: also `storyboard.md`) | ✅ Yes if template+characters resolve |
| **director gate** | `vclaw video storyboard-review` → human edits `storyboard.md` → `vclaw video approve` | rewrites checkpoint status → `approved` | ❌ unless `VIDEOCLAW_APPROVE_STORYBOARD=1` |
| assets | `vclaw video assets --project --asset kind:path...` | `asset-manifest.json` | ✅ already `humanApprovalDefault: false` |
| readiness | `vclaw video readiness --project` | `readiness.json` | ✅ diagnostic only |
| plan | `vclaw video plan` (alias `execution-plan`) | `execution-plan.json` | ✅ derived from manifest |
| execute | `vclaw video execute --project [--dry-run]` (alias `produce`) | `execution-report.json` + events | ⚠️ Conditional — director blocks on stale review |
| execute-status | `vclaw video execute-status --project` | refresh `execution-report.json` | ✅ pure poll |
| review | `vclaw video review --verdict pass\|retry\|fail` (or `review-autopilot`) | `review-report.json` + checkpoint | 🟡 `review-autopilot` exists |
| publish | `vclaw video publish --status ready\|published\|blocked` | `publish-report.json` + checkpoint | 🟡 needs thin auto wrapper |

### D.2 Artifacts and schemas

All under `projects/<slug>/artifacts/`; schemas in `schemas/video/artifacts/`. Side files: `project.json`, `storyboard.md`, `checkpoints/<stage>.json` (×5), `events/events.jsonl`, `state/`, `characters/characters.json`.

13 artifact JSONs: brief, storyboard (+ scene-candidates, scene-selection, reference-sheets in director), asset-manifest, readiness (no schema), execution-plan, execution-report, review-report, publish-report, analyze-output, clone-plan, character-consistency.

### D.3 Approval gates — implication for creator mode

**6 decision points in director mode, 3 in storyboard mode.**

- 3 of 6 already auto-able via flags (brief, storyboard, assets).
- 1 has env-var bypass (director storyboard.md → `VIDEOCLAW_APPROVE_STORYBOARD=1`).
- 2 need thin auto wrappers (review-autopilot exists; publish needs `ready` vs `blocked` heuristic from review verdict + final-media presence).

**`vclaw video auto` already exists in dispatch** (`vclaw.ts:3090`) alongside `create`, `iterate`, `run-pipeline`. These are the existing primitives a unified creator-mode entrypoint should wrap.

### D.4 Env-var burden

**~40+ env vars** with no committed `.env.example`. Grouped:
- Director toggles (`DIRECTOR_PREFLIGHT`, `_STRICT_PROMPT_QUALITY`, `_STRICT_DIALOGUE_FIT`, `_AUTO_FIX_CONTENT`, `_GENRE_DEFAULTS`, `_INFERENCE_RULES`)
- Approval bypass (`VIDEOCLAW_APPROVE_STORYBOARD`)
- Provider keys (`USEAPI_*`, `SUTUI_API_KEY`, `GEMINI_*`, `GOOGLE_*`, `GO_BANANAS_*`)
- Veo transport (`VCLAW_VEO_*` × ~8 vars)
- Runway transport (`VCLAW_RUNWAY_*` × ~6 vars)
- Seedance transport (`VCLAW_SEEDANCE_*` × ~5 vars + `SEEDANCE_*`)
- Workspace (`VIDEOCLAW_ROOT`, `VCLAW_DEMO_PAUSE_MS`)

A committed `.env.example` + a `vclaw doctor env` subcommand listing what's set / missing per provider would meaningfully reduce setup friction.

---

## Cross-cutting findings → unification design inputs

The four audits converge on five concrete unification opportunities, ordered by ROI:

### F1. Single front door: `vclaw make "<intent>"`

**Foundation already exists**: `vclaw video auto`, `vclaw video create`, scoring router, pipeline manifests, project-state layout. Wire them behind one user-friendly command that:

1. Takes a natural-language intent.
2. Picks the right skill (video-framework / brand-presenter / movie-director / ugc) by intent classification.
3. Picks the right provider route via the existing router (after C.3 enhancements).
4. Walks the pipeline with all gates auto-cleared (`VIDEOCLAW_APPROVE_STORYBOARD=1` + `review-autopilot` + auto-publish).
5. Falls back to interactive prompts at any gate the user wants to inspect.

**Estimated effort**: 1-2 weeks.

### F2. Collapse the two video-gen pipelines (TS vs Python)

**The biggest seam in the system.** Two options:

- **F2a — Fold Python into TS**: rewrite the Bunty/Nex Python pipeline as TS modules calling the same providers via the existing router. ~3-4 weeks. Removes a whole runtime.
- **F2b — Stable contract**: keep Python as a peer pipeline behind a documented JSON-in/JSON-out contract, register it as a provider/skill, surface it through F1. ~1 week. Less ambitious but preserves working code.

Recommendation pending — **needs a decision call** in Phase B.

### F3. Collapse `vclaw-cli` Bun standalone surface into `vclaw veo:*`

Bun stays as a runtime (Puppeteer requirement) but its standalone subcommands (`status | list | history | resume | reset | cancel | useapi:*`) move under `vclaw veo:*` in the main TS CLI, which shells out to Bun as needed.

**Estimated effort**: ~1 week.

### F4. Skill consolidation (B.2 items 1-7)

Independent of the other lanes; can ship incrementally.

**Estimated effort**: ~3 days total across all 7 items.

### F5. Operator polish

- Delete `omx` alias (1 commit).
- Delete `video-replicator-workspace/` orphan (1 commit).
- Commit `.env.example`.
- Add `vclaw doctor env`.
- Downgrade `veo-direct` to scaffold or wire its native transport via `vclaw-cli/flow.ts --backend google-flow`.
- Add `smoke:native-seedance` and `smoke:native-runway`.

**Estimated effort**: ~2 days.

---

## Open questions for Phase B

1. **F2 decision: fold Python (F2a) or keep as peer (F2b)?** This shapes the whole unification.
2. **Front door command name**: `vclaw make`? `vclaw create`? Something else? Should the operator-mode `vclaw video *` flow stay or get hidden behind a `--operator` flag?
3. **Storage**: collapse to one (drop Bun SQLite + Convex) or three with a clear ownership boundary?
4. **`kling-useapi`**: invest in a real transport or drop the route entirely?
5. **Coverage tooling**: still nothing. Add c8 + per-module thresholds, or punt?

---

## Phase A complete. Next step: Phase B design.

This document is read-only output of Phase A. Phase B should:
- Resolve the 5 open questions above
- Write `docs/superpowers/specs/2026-05-25-videoclaw-v2-unification-design.md`
- Sequence F1–F5 into shippable slices
