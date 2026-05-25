# videoclaw v3 Unification Design

> **Status:** Phase B unification design. Draft v1 — pending user review.
>
> **Date:** 2026-05-25
> **Phase A input:** `docs/UNIFICATION_AUDIT.md`
> **Phase 9b input:** `docs/AGENT_INTEGRATION_RESEARCH.md`
> **Next phase:** Phase C — implementation, per-slice impl plans via
> writing-plans skill.

---

## 1. Executive summary

videoclaw v3 is **the same codebase as v2.x, cut at a clean major-version
boundary and stripped of the orchestration scaffolding the v2 work happened
to leave behind.** Not a fresh repo. Not a smart orchestrator. A
deliberately narrow, agent-friendly CLI toolkit, shipped as a single
`npm install -g videoclaw`, with a stable contract for agents to drive.

The reframe that makes this small: **intent classification is the host's
job (Claude Code / Codex / Antigravity / Cursor / Warp), not the CLI's
job.** Every successful 2026 data point in the LSP/MCP era confirms this.
The cited token-cost penalty for getting it wrong is **10-32×**.
Reference: `docs/AGENT_INTEGRATION_RESEARCH.md`.

**What changes in v3:** five independent slices, sequenced over ~6 weeks.

**What stays:** the canonical `projects/<slug>/` layout, the 13 artifact
schemas, the provider router (`router.ts`), the three working native
transports (`native-veo` / `native-seedance` / `native-runway`), the
checkpoint model, the event log, the Obsidian/portfolio exports. All
already match modern best practice.

---

## 2. Out of scope (deliberate non-goals)

The audit + research surfaced several attractive-sounding features that
v3 explicitly **does not** build:

1. **No intent classifier / NL front door.** No `vclaw make "video about
   my dog"`. Agents already do this better, and putting an LLM inside the
   CLI couples it to a model provider, adds prompt-injection surface, and
   pays a 10-32× token penalty per the cited benchmark.
2. **No smart skill router inside the binary.** Claude Code's skill
   description-matching already handles this. Codex plugins likewise.
3. **No multi-runtime story.** One Node 20 codebase. Bun stays only as a
   subprocess `native-veo` calls into (Puppeteer/CDP requirement); its
   standalone subcommands move under `vclaw veo:*`.
4. **No second-system rewrite.** The 8 phases of v2 work were the right
   work; v3 builds on them.
5. **No new artifact formats.** The 13 existing schemas stay canonical.

---

## 3. Architectural shape (v3)

```
                            ┌─────────────────────────┐
                            │  agent host             │
                            │  (Claude Code / Codex   │
                            │   / Cursor / Warp /     │
                            │   Antigravity / ...)    │
                            └────────────┬────────────┘
                                         │
                            shells out + reads JSON
                                         │
                                         ▼
                          ┌───────────────────────────┐
                          │  vclaw  (single TS CLI)   │
                          │  ─────────────────────    │
                          │   noun-verb namespace     │
                          │   JSON output by default  │
                          │   vclaw schema --json     │
                          │   stable error codes      │
                          │   exit-code taxonomy      │
                          └────┬──────────────────┬───┘
                               │                  │
              ┌────────────────┴────────┐    ┌────┴──────────────┐
              ▼                         ▼    ▼                   ▼
   ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────┐
   │ projects/<slug>/     │  │ provider-platform    │  │ assemble    │
   │ canonical state      │  │ router + 3 transports│  │ TTS/music/  │
   │ JSON artifacts       │  │ (veo / seedance /    │  │ stitch      │
   │ checkpoints + events │  │  runway)             │  │ (TS port    │
   └──────────────────────┘  └──────────┬───────────┘  │  from .py)  │
                                        │              └─────────────┘
                              ┌─────────┴──────────┐
                              ▼                    ▼
                     ┌────────────────┐  ┌─────────────────┐
                     │ vclaw-cli/Bun  │  │ HTTP fetch      │
                     │ subprocess     │  │ (seedance,      │
                     │ (Google Flow,  │  │  runway)        │
                     │  Puppeteer)    │  │                 │
                     └────────────────┘  └─────────────────┘

Optional capstone:
                          ┌───────────────────────────┐
                          │ vclaw mcp serve           │
                          │ stdio MCP server          │
                          │ exposes list_projects,    │
                          │ get_status, get_artifacts │
                          └───────────────────────────┘

External (separate repo):
                          ┌───────────────────────────┐
                          │ videoclaw-skills          │
                          │ .claude/skills/*.md       │
                          │ Codex plugin manifest     │
                          │ community-maintained      │
                          └───────────────────────────┘
```

---

## 4. The five slices

Independent enough to ship in parallel where they don't conflict;
sequenced for compounding leverage where they do.

### Slice 1 — Agent-friendly polish (1-2 weeks)

The contract foundation. Establish the v3 surface before any other
work depends on it.

- **`vclaw schema --json`** — dumps the full command tree + per-verb
  flags + per-artifact JSON schemas, in one read. Agents introspect
  once, then drive the CLI deterministically.
- **`--json` default when stdout is not a TTY.** Existing JSON output
  stays; the change is making it implicit when piped.
- **Exit-code taxonomy.** 0 = success. 1 = user error (bad flag, missing
  arg, validation failure). 2 = system error (provider down, disk full,
  permission denied). 3 = gate (director approval pending). Documented
  in `docs/CLI_REFERENCE.md`.
- **Stable string error codes.** `{"code": "image_not_found", "message":
  "..."}` instead of freeform messages. Catalogue in
  `schemas/video/errors.json`.
- **Noun-verb consistency pass.** Audit every existing `vclaw video *`
  subcommand for shape inconsistency. Examples to align: `vclaw video
  export-csv` → `vclaw video export csv`; `vclaw video review-ui` →
  `vclaw video review ui`. Backwards-compatible aliases retained for
  the v3 cycle, marked deprecated in v3.1.
- **TTY-safe progress.** Spinners / colors to stderr only; stdout stays
  pure JSON / NDJSON.

### Slice 2 — Skill consolidations (~3 days)

Independent of slice 1, can ship in parallel.

- **Presenter family → parametric `brand-presenter`.** `bunty`,
  `davendra-presenter`, `nex-presenter` SKILL.mds collapse to ~20-line
  profile stubs (character_id, voice, brand assets). `brand-presenter`
  becomes parametric on `brand-profile.json`.
- **`video-framework` as sole video front door.** `video-replicator` SKILL
  demoted to a reference document (no description trigger), or deleted if
  no external doc names it.
- **`movie-director` ← `director-video`.** Merge into the richer
  movie-director; alias director-video.
- **Fold `creative-brief` into `video-framework`** as its intake mode.
- **Merge `seedance-prompts` + `seedance-music-video-prompts`.**
- **Delete `video-replicator-workspace/` orphan** (not in catalog.json).

**Skills count after slice 2:** ~46 (down from 52, with 4 of those being
profile stubs that don't trigger independently).

### Slice 3 — Python fold (F2a) (3-4 weeks)

The substantive engineering slice. Eliminates the second runtime.

**What gets ported from `skills/video-replicator/scripts/`:**

| Python script | TS replacement | Notes |
|---|---|---|
| `parallel_video_gen.py` | DELETE — supplant with `vclaw video execute` parallel scene generation | Already duplicates `execute.ts`'s provider dispatch. |
| `generate_tts.py` | `src/video/assemble/tts.ts` — HTTP to ElevenLabs / OpenAI TTS | Pure HTTP; language-agnostic. |
| `generate_music.py` | `src/video/assemble/music.ts` — HTTP to whichever music API is used today (Suno?) | Audit which API and how today. |
| `generate_title_card.py` | `src/video/assemble/title-card.ts` — `sharp` for image composition or HTTP to Go Bananas | Pick one approach. |
| `extract_pdf_slides.py` | `src/video/assemble/pdf.ts` — `pdf-parse` or `pdfjs-dist` | Mature npm packages exist. |
| `bunty_animate_slides.py` | `src/video/assemble/animate-slides.ts` — `sharp` + FFmpeg for slide motion | FFmpeg via `child_process.spawn`. |
| `stitch_bunty.py` | `src/video/assemble/stitch.ts` — FFmpeg filter graphs | Largest port; FFmpeg args identical regardless of host language. |
| `nex_assemble.py` | Folded into `assemble/stitch.ts` with a brand-profile parameter | |
| `bunty_narration_check.py` | `src/video/assemble/qa-narration.ts` | |
| `bunty_image_filter_check.py` | `src/video/assemble/qa-image-filter.ts` | |
| `bunty_match_to_deck.py` | `src/video/assemble/match-to-deck.ts` | |
| `bunty_regen.py` | `vclaw video regenerate-segment --project ... --segment ...` subcommand | |
| `db.py` + `config.py` + `logging_config.py` + `utils_*` | Replaced by existing `projects/<slug>/` JSON state | Python's local state goes away. |

**New `vclaw video assemble` subcommand** wires the assembly steps as a
post-execution stage:

```
vclaw video execute --project foo     # produces raw scene clips
vclaw video assemble --project foo    # TTS + music + slides + stitch → final MP4
```

Both auto-callable in sequence by the agent walking the pipeline.

**Out of scope for slice 3:** `nex-presenter/scripts/brand_episode.py`,
`ui-ux-pro-max/scripts/search.py`. Different domains, can stay Python or
become separate npm packages later. They aren't part of the video
pipeline.

### Slice 4 — Collapse Bun standalone surface into `vclaw veo:*` (~1 week)

Bun stays as a runtime (Puppeteer requirement), but its duplicate
standalone subcommands move under the main TS CLI.

- `bun run flow.ts status` → `vclaw veo status` (shells out to Bun)
- `bun run flow.ts list` → `vclaw veo list`
- `bun run flow.ts history` → `vclaw veo history`
- `bun run flow.ts resume` → `vclaw veo resume`
- `bun run flow.ts reset` → `vclaw veo reset`
- `bun run flow.ts cancel` → `vclaw veo cancel`
- `bun run flow.ts useapi:*` → `vclaw veo useapi:*` (subset; some
  obsolete commands dropped)
- `bun run flow.ts sync` (Convex) → **dropped**. Convex was a deployment
  target experiment; v3 doesn't have a server-side ambition.

The Bun SQLite `veo-cli.db` is downgraded to a job-cache file local to
the Bun subprocess; canonical job state lives in `projects/<slug>/` via
`native-veo`.

### Slice 5 — Optional MCP server + external skills pack (~1 week)

Capstone slice; ships after slices 1-4 stabilize.

- **`vclaw mcp serve`** — stdio MCP server exposing read-only queries:
  `list_projects`, `get_project_status`, `get_artifacts`,
  `get_event_log`, `list_provider_routes`. **No write ops** via MCP —
  agents call the CLI for those.
- **`videoclaw-skills` external package** — separate GitHub repo with
  `.claude/skills/videoclaw-*.md` for Claude Code users; Codex plugin
  manifest when Codex's plugin marketplace stabilizes; Antigravity
  integration when its tool-discovery spec is documented. Community
  PRs welcome; not in the main repo.

---

## 5. Resolved decisions from Phase A's 5 open questions

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | F2 fold or peer? | **F2a — fold Python into TS** | Agent context (per research): single `npm install` is the win, not multi-runtime elegance. |
| 2 | Front-door command name? | **None — no NL front door** | Agents drive the noun-verb namespace. `vclaw` itself is the front door. |
| 3 | Storage runtimes — one or three? | **Collapse to `projects/<slug>/` JSON only** | Bun SQLite downgraded to a subprocess-local job cache. Convex dropped. |
| 4 | `kling-useapi` — invest or drop? | **Drop from registry** | Never had a transport; not asked for. Removes 1 phantom route. Can re-add when there's a real demand + adapter. |
| 5 | Coverage tooling — add or punt? | **Add c8 with conservative thresholds** | v3 is the clean-break opportunity. 60% lines / 70% functions initially, tighten quarterly. Add `npm run test:coverage` and a CI gate in `check:release-readiness-lite`. |

---

## 6. Cutover: v2.x → v3.0

1. **Tag current state**: `git tag v2.x-final && git push --tags`.
2. **Bump `package.json` to `3.0.0-alpha.0`** and `vclaw-cli/package.json`
   to the same.
3. **Add `CHANGELOG.md`** with a `## 3.0.0 (in progress)` section listing
   breaking changes (below).
4. **One commit marks the v3 line**: `Phase 10: cut v3.0 line —
   deprecation removals + agent-target reframe`. This commit deletes:
   - `src/cli/omx.ts` (1-line passthrough; remove `check:omx-alias`)
   - `skills/video-replicator-workspace/` (orphan)
   - Convex sync code in `vclaw-cli/`
   - `kling-useapi` route from registry

   **Note:** `vclaw video auto` is **kept** as a thin happy-path
   sequencer (calls `init → brief → storyboard → assets → execute →
   review → publish` in order, ~50 LOC). It is not "orchestration"
   in the research's bad sense — no LLM, no intent classification —
   it's a `Makefile`-style convenience that humans and agents both
   benefit from. Analogous to `git pull` over `git fetch && git
   merge`.
5. **All subsequent work** is slice 1-5, each its own commit / PR.
6. **Release v3.0.0** when all 5 slices land + smoke suite green + docs
   rewritten (slice 1 includes docs rewrite for `CLI_REFERENCE.md`,
   `ARCHITECTURE.md`, `README.md`; standalone work for the rest).

### Breaking changes inventory (v3.0)

- `omx` alias removed
- `kling-useapi` route removed
- Convex sync removed from `vclaw-cli`
- Several Python scripts under `skills/video-replicator/scripts/`
  deprecated, then removed once slice 3 ships (will warn during v3.0-alpha)
- `bunty` / `davendra-presenter` / `nex-presenter` SKILL.mds reduced to
  brand-profile stubs (their auto-trigger descriptions change shape)
- `director-video` skill merged into `movie-director` (auto-trigger
  changes)
- `creative-brief` skill folded into `video-framework` (auto-trigger
  changes)
- `vclaw-cli`'s standalone subcommands (`status|list|history|resume|reset|cancel`)
  removed in favor of `vclaw veo:*`
- Exit codes change shape (0/1/2/3 taxonomy enforced) — agents that
  parsed only exit=0/!=0 unaffected; anything that assumed specific non-
  zero codes needs to update

---

## 7. Success criteria

v3.0.0 ships when:

- [ ] All 5 slices landed
- [ ] `check:release-readiness-lite` green
- [ ] `vclaw schema --json` returns the full command tree + artifact
      schemas; an external integration test can drive a full project
      lifecycle from the catalog alone
- [ ] Single `npm install -g videoclaw` produces a working CLI on a clean
      Node 20 box, no Python, no venv, no Bun required (Bun only
      required for Veo Direct/Flow path; transparently spawned)
- [ ] `c8` coverage: ≥60% lines, ≥70% functions on `src/video/**`
- [ ] At least one end-to-end smoke per production route
      (`smoke:native-veo`, `smoke:native-seedance`, `smoke:native-runway`)
- [ ] README + CLI_REFERENCE + ARCHITECTURE rewritten for v3
- [ ] `videoclaw-skills` external repo exists with at least 3 sample
      Claude Code skills
- [ ] **Agent-host integration tests**: at least one CI smoke that
      drives videoclaw end-to-end from a real agent host. Minimum:
      a Claude Code session (via Claude Agent SDK in headless mode)
      that asks "create a 30s presenter video about X" and watches
      the agent traverse `vclaw schema --json` → init → brief →
      storyboard → assets → execute → assemble → publish without
      human intervention. Verifies the noun-verb namespace + JSON
      contracts hold up under real agent traversal, not just
      synthetic CLI tests.

---

## 8. Sequence and parallelism

```
Week 1:        cutover commit (Phase 10) + Slice 1 start (polish)
Week 2:        Slice 1 finish + Slice 2 (skill consolidation) start
Week 3:        Slice 2 finish + Slice 3 (Python fold) start, Slice 4 in parallel
Week 4-5:      Slice 3 main work + Slice 4 finish
Week 6:        Slice 5 (MCP + external skills pack)
Week 7:        Stabilization, docs polish, v3.0.0 release
```

Slices 2, 4, 5 are independent of slice 3 and can ship in parallel
where calendar allows.

---

## 9. Implementation plan handoff

This spec defines WHAT and WHY. The HOW (per-slice impl plans) is the
next phase. After user approval, invoke the writing-plans skill once per
slice to produce executable impl plans. Each impl plan should:

- Cite this spec (specifically the slice it implements)
- Break the slice into 3-10 concrete commits
- Identify the test strategy per commit
- Identify failure modes / rollback path
- Cite the docs that need updating

Recommended order to plan first: **Slice 1 (polish)** — it establishes
the v3 contract every subsequent slice depends on.

---

## 10. Open items for user review

Before invoking writing-plans for slice 1, confirm:

1. The 5 resolved decisions in §5. Especially: are you OK with dropping
   `kling-useapi` from the registry? It removes a route that's never
   worked but advertises a future-Veo-competitor we may want back.
2. The breaking-changes inventory in §6. Anything you want kept for
   backwards-compat beyond v3.0?
3. The success criteria in §7. Anything to add (e.g., specific
   benchmark / latency target / install-size target)?
4. The sequence in §8. Want to do slice 3 (Python fold) earlier or
   later than week 3-5?
