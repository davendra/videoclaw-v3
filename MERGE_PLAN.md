# videoclaw-v2 Merge Plan

> Consolidates `videoclaw` (the original, v0.11.14) and `vclaw-video-core`
> (the clean-room v0.1.0 rebuild) into a single video CLI + skills library.
>
> **Author:** drafted 2026-05-24 from a side-by-side investigation of both repos.
> **Status:** the v2 merge described below has landed (foundation is now
> `videoclaw-v3`, the current repo). On top of it, the **Commercial Track +
> Quantified Prompt-Craft** programme — phases **A–F** — is **DONE and landed on
> `main`** (A–D and E–F merged). See the "Commercial Track + Quantified
> Prompt-Craft (phases A–F) — DONE" addendum at the end of this file for what
> shipped, and `docs/ARCHITECTURE.md` for the architecture-level write-up.

---

## 1. TL;DR

1. **Foundation = `vclaw-video-core`.** It's smaller (~20k LOC vs 83k), cleaner,
   has more skills (52 vs 36), has explicit artifact/checkpoint/stage contracts,
   has more recent Review-UI work, and was built specifically to escape the
   legacy pipeline. Its author (you) already made the "throw it away" call once.
   Don't relitigate it.
2. **Drop the orchestration layer** (ralph / ralplan / team / MCP servers /
   Rust crates / sparkshell / openclaw / hud / autoresearch / visual). Reasoning
   in §3. Claude Code and Codex already do this natively, and the OMC plugin
   you're running gives you `ralph` / `team` / `autopilot` / `deep-interview` /
   `ralplan` as first-class skills today.
3. **Port forward from `videoclaw`** only the pieces that *aren't* in core and
   that *are* video work: Google Flow v1 + Omni Flash backend support, the
   `veo-cli/` Bun package, a curated subset of `scripts/video/` Python (the
   Seedance Prompt Director compose/chain logic), and 3 unique skills.
4. **Skill library = union of both, deduplicated to the better version.** Net 55
   skills after merge (52 core + 3 ported).
5. **Phased migration.** Phase 0 sets up the new repo from core. Phase 1 ports
   backend adapters. Phase 2 ports Python pipeline. Phase 3 reconciles docs.
   Phase 4 retires the source repos.

---

## 2. Source repos at a glance

| | `videoclaw` | `vclaw-video-core` |
|---|---|---|
| Repo path | `/Users/davendrapatel/Documents/GitHub/videoclaw` | `/Users/davendrapatel/Documents/GitHub/vclaw-video-core` |
| Version | 0.11.14 | 0.1.0 |
| Self-description | "multi-agent orchestration layer for OpenAI Codex CLI" | "clean-room CLI for multi-provider AI video orchestration… deliberately does **not** inherit code from the legacy codebase" |
| TS LOC (`src/`) | 83,433 | 20,547 |
| `src/video/` TS files | 112 | 81 |
| Languages | TS + Rust (5 crates) + Python (133 scripts) + Bun (`veo-cli/`, 51 TS files) | TS only |
| Runtime deps | 3 (`@modelcontextprotocol/sdk`, `@iarna/toml`, `zod`) | **0** |
| Bins | `vclaw` | `vclaw`, `omx` (deprecation alias), `vclaw-provider-adapter` |
| Skills | 36 | 52 |
| Smoke tests | 1 (`smoke:packed-install`) + sparkshell tests | 7 (`runtime`, `native-veo`, `character-hydration`, `execution-cancel`, `portfolio`, `reference-sheets`, `scene-candidates`) + 5 guardrails |
| Coverage gates | yes (team-critical 78%/90%/70%/78%) | no |
| Docs site | VitePress (`docs-site/`, 73 pages) | `docs/*.md` flat |
| State path | `.omx/` | `projects/<slug>/` (per-project) + `.omx/` runtime |
| Recent (last 20 commits) | Google Flow v1, Omni Flash, useapi dispatch, veo-cli concat/extend | Review UI confirmations, storyboard image-review handoff, Seedance director runs |

---

## 3. The orchestration question

You asked whether the orchestration layer (ralph / ralplan / team / MCP / Rust)
is worth keeping given that "codex and Claude Code do all these things." **No,
and here's the honest case.**

### Why dropping it is correct

1. **Duplication with the host CLIs.** Claude Code's native plugin ecosystem
   (OMC, superpowers, ralph-loop) already ships `ralph` / `team` / `autopilot` /
   `ralplan` / `deep-interview` as first-class skills you can invoke today.
   `videoclaw`'s orchestration was built when those didn't exist or were
   weaker. They've caught up.

2. **63k of the 83k LOC in `videoclaw` is orchestration scaffolding.**
   `src/team/`, `src/ralph/`, `src/ralplan/`, `src/mcp/`, `src/hooks/`,
   `src/autoresearch/`, `src/hud/`, `src/visual/`, `src/openclaw/`,
   `src/sparkshell/`, `src/runtime/`, `src/subagents/`, plus 5 Rust crates
   (`omx-explore`, `omx-sparkshell`, `omx-mux`, `omx-runtime`, `omx-runtime-core`).
   Carrying that means: a Cargo workspace, `cargo build`/`cargo test`/`rustfmt`/
   `clippy` CI gates, 5 MCP server binaries to maintain, tmux-based team
   coordination, sparkshell build/test pipelines, and a 3,280-line
   `production-executor.ts` god-object that `vclaw-video-core` was explicitly
   built to replace.

3. **Your own product signal points away from it.** The last 20 commits in
   `videoclaw` are **100% video-backend work** (Google Flow, Omni Flash,
   Seedance, veo-cli). The last 20 in `vclaw-video-core` are **100% video-UX
   work** (Review UI, storyboard handoff). Nobody is investing in the
   orchestration layer anymore. That's not a coincidence — it's the codebase
   telling you which half is the actual product.

4. **It blocks distribution.** A pure-TS, zero-runtime-dep video CLI is `npm
   i -g videoclaw`. A TS + Rust + Python + Bun + MCP-servers + tmux package is
   a setup script with 8 failure modes. `vclaw-video-core` is already the
   former. `videoclaw` is the latter.

5. **The valuable parts of the orchestration layer can be re-expressed as
   skills.** The `ralph-init` skill that's *already* in `vclaw-video-core` is
   evidence of this direction: a skill bundles the loop, you don't need a
   bespoke runtime.

### What you give up

- Bespoke MCP servers for state / memory / code-intel / team / trace. Replace
  with: the Claude Code project memory + observation system you're already
  using (claude-mem) and any third-party MCPs you want at the host level, not
  shipped in this CLI.
- The HUD, visual-verdict, autoresearch features. None of these are video-CLI
  features — they were generic developer-loop tooling.
- The Rust `omx-explore` codebase-search crate. Use `grep`/`rg`/Claude Code's
  built-in Explore agent.
- The sparkshell shell-execution layer. Not needed for a video pipeline.

### What you keep that overlaps

- The video subsystem (entirely replaced by `vclaw-video-core`'s).
- Skills (consolidated — see §6).
- The `veo-cli/` Bun package (verbatim port).
- A curated subset of `scripts/video/` Python (Seedance Director compose/chain
  logic — see §5.3).

**Net result:** ~20-25k TS LOC + ~51 TS files in `veo-cli/` + ~20-30 curated
Python files + 55 skills. A real product, not a runtime.

---

## 4. Target architecture for `videoclaw-v2`

```
videoclaw-v2/
├── package.json                    # name: "videoclaw", bin: vclaw
├── tsconfig.json                   # NodeNext, strict, ESM
├── CLAUDE.md                       # written from this plan
├── AGENTS.md                       # autonomy directive, project structure
├── README.md                       # rewritten — video CLI positioning
├── LICENSE
├── biome.json                      # from videoclaw (linter config)
│
├── src/
│   ├── cli/
│   │   ├── vclaw.ts                # ← from vclaw-video-core (primary entry)
│   │   ├── omx.ts                  # ← deprecation alias, prints notice
│   │   └── provider-adapter.ts     # ← built-in adapter binary
│   ├── video/                      # ← from vclaw-video-core (81 files), with
│   │                               #   Flow v1 + Omni Flash route descriptors
│   │                               #   merged in from videoclaw/src/video/
│   ├── index.ts                    # ← public library surface (from core)
│   └── tests/                      # ← node:test, mkdtemp-based isolation
│
├── schemas/video/                  # ← from vclaw-video-core (JSON Schema)
│
├── skills/                         # ← 52 core + 3 unique from videoclaw = 55
│   └── (see §6 for full list)
│
├── prompts/                        # ← from videoclaw (only the agent prompts
│                                   #   used by surviving skills)
│
├── templates/                      # ← merge of both repos' templates
│
├── veo-cli/                        # ← from videoclaw verbatim (Bun, 51 files)
│
├── scripts/
│   ├── video/                      # ← CURATED subset of videoclaw's 133 .py
│   │   ├── seedance_director/      # compose, chain, prompt critique
│   │   ├── hooks/                  # director, lighting, color-grading
│   │   ├── character_sheet.py
│   │   ├── webhook_receiver.py
│   │   └── requirements.txt
│   ├── smoke/                      # ← from vclaw-video-core (7 smoke .mjs)
│   ├── guardrails/                 # ← from vclaw-video-core (5 check-*.sh)
│   └── demo-quickstart.mjs         # ← from vclaw-video-core
│
├── docs/                           # ← from vclaw-video-core (flat .md)
│   ├── ARCHITECTURE.md
│   ├── CLI_REFERENCE.md
│   ├── OPERATIONS.md
│   ├── OBSIDIAN.md
│   ├── TEMPLATES.md
│   ├── MIGRATION.md                # ← write new: from videoclaw → v2
│   ├── DEPRECATION.md
│   └── RELEASE_READINESS.md
│
└── .github/workflows/              # ← simplified from both
    ├── ci.yml                      # TS-only: biome + tsc + node:test + smokes
    └── (no Rust, no Python in CI by default; opt-in jobs for veo-cli + python)
```

**Deliberately absent:**
- `crates/` — no Rust.
- `src/team/`, `src/ralph/`, `src/ralplan/`, `src/mcp/`, `src/hooks/`,
  `src/autoresearch/`, `src/hud/`, `src/visual/`, `src/openclaw/`,
  `src/sparkshell/`, `src/runtime/`, `src/subagents/` — no orchestration.
- `docs-site/` — VitePress dropped in favor of flat `docs/*.md`. Resurrect
  later if you decide to publish docs.
- `src/config/generator.ts` for Codex `config.toml` — not needed if we're not
  shipping orchestration.

---

## 5. What to take from each repo

### 5.1 From `vclaw-video-core` — bulk copy

Take **almost everything** verbatim. This is the foundation.

```
KEEP AS-IS:
  src/cli/vclaw.ts
  src/cli/omx.ts
  src/cli/provider-adapter.ts
  src/video/                       (all 81 files)
  src/video/provider-platform/
  src/video/pipeline-manifests/
  src/index.ts
  src/tests/
  schemas/video/
  skills/                          (all 52, see §6)
  scripts/smoke-*.mjs              (7 smoke harnesses)
  scripts/check-*.sh               (5 guardrails)
  scripts/demo-quickstart.mjs
  docs/*.md                        (flat, ~20 files)
  AGENTS.md                        (autonomy directive)
  tsconfig.json                    (NodeNext, strict)
  package.json                     (as base; rename → "videoclaw"; bump → 0.12.0)
  tmp/review-station/index.html    (Review UI shipped via npm `files`)
```

**Do not take:**
- `node_modules/` (regenerate)
- `dist/` (regenerate)
- `.omx/` runtime state
- `archive/` (whatever was already deprecated stays deprecated)

### 5.2 From `videoclaw` — selective port

Only video-relevant, non-overlapping pieces:

```
VEO-CLI PACKAGE:
  veo-cli/                         verbatim (51 files, Bun, has Flow v1 +
                                   Omni Flash + voice/duration/ref-video,
                                   useapi:extend/concat — all shipped post
                                   vclaw-video-core fork)

PROVIDER ROUTE DESCRIPTORS:
  src/video/provider-platform/    diff against core's equivalent; port any
                                   Flow v1 + Omni Flash route descriptors that
                                   core doesn't have yet
  src/video/adapters.ts            review for Omni Flash V2V capability
                                   registration

PYTHON PIPELINE (CURATED):
  scripts/video/                   take the Seedance Director compose() /
                                   chain manager / reference validator /
                                   prompt critique with auto_fix_prompt /
                                   hooks library (director, lighting,
                                   color-grading) / character_sheet.py /
                                   webhook_receiver.py.
                                   SKIP: bulk batch operations that overlap
                                   with provider-adapter, anything tied to
                                   .omx/ orchestration state, the 405-test
                                   pytest harness in scripts/video/tests
                                   (port maybe 30-50 of the tests that
                                   exercise compose/chain/critique only)

SKILLS (3 UNIQUE):
  skills/presenter-video/
  skills/seedance-music-video-prompts/
  skills/skills-auditor/

PROMPTS (FILTERED):
  prompts/*.md                     only the agent prompts that surviving
                                   skills actually reference (likely <5 files
                                   after filtering)

DOCS WORTH READING (NOT COPYING):
  docs/prompt-guidance-contract.md      — extract the prompt rules into
                                           CLAUDE.md if still relevant
  scripts/video/requirements.txt        — copy verbatim
```

**Do not take:**

- `crates/` — Rust orchestration crates.
- `src/team/`, `src/ralph/`, `src/ralplan/`, `src/mcp/`, `src/hooks/`,
  `src/autoresearch/`, `src/hud/`, `src/visual/`, `src/openclaw/`,
  `src/sparkshell/`, `src/runtime/`, `src/subagents/`, `src/notifications/`,
  `src/verification/`, `src/state/`, `src/modes/`, `src/planning/`,
  `src/pipeline/`, `src/session-history/`, `src/config/`, `src/compat/`,
  `src/agents/` (unless skill-only agent definitions).
- `src/video/production-executor.ts` — the 3,280-line god-object; its
  responsibilities are decomposed cleanly across `vclaw-video-core`'s
  `src/video/*.ts` files already.
- `dist/`, `node_modules/`, `.omx/`, `.omx/`.
- `docs-site/` (VitePress).
- `coverage:team-critical` CI gates (no team subsystem to gate).

### 5.3 Python pipeline — be ruthless

`videoclaw/scripts/video/` has 133 `.py` files. Most are either (a) tightly
coupled to `production-executor.ts` state, (b) batch wrappers around the
provider-adapter pattern that `vclaw-video-core` solves natively in TS, or (c)
test infrastructure for the orchestration layer.

**Target import set (~20-30 files):**

- `seedance_director/compose.py` — the prompt composition logic
- `seedance_director/chain_manager.py` — reference image chaining
- `seedance_director/reference_validator.py`
- `seedance_director/prompt_critique.py` (with `auto_fix_prompt`)
- `hooks/director.py`, `hooks/lighting.py`, `hooks/color_grading.py`
- `character_sheet.py`
- `webhook_receiver.py`
- `requirements.txt`
- ~10-20 representative pytest files in `tests/` that exercise compose / chain /
  critique only

Treat this as an *optional* subsystem invoked from TS via `child_process` or
exposed as a CLI subcommand `vclaw director:compose`. Document in
`docs/PYTHON_PIPELINE.md` that this part is opt-in and requires `pip install
-r scripts/video/requirements.txt` in a venv.

---

## 6. Skills consolidation

Net target: **55 skills.** Each entry below indicates the source of truth.

### 6.1 Common (33) — take vclaw-video-core's copy

Both repos have these, and `vclaw-video-core`'s version is the more recent /
better-integrated one. Diff them during migration; if `videoclaw`'s version
has substantive additions (e.g., Google Flow / Omni Flash refs in
`character-creator`, `video-replicator`, `seedance-prompts`, `creative-brief`),
fold them in.

```
ai-slop-cleaner, autopilot, build-fix, cancel, character-creator,
character-library, code-review, configure-notifications, creative-brief,
deep-interview, doctor, help, hud, movie-director, note, omx-setup,
pipeline, ralph, ralplan, security-review, seedance-prompts, skill,
studio-mode, team, trace, ugc, video-framework, video-post,
video-replicator, web-clone, worker, youtube-audio
```

**Diff-check required (likely needs Flow/Omni merge from videoclaw):**
`character-creator`, `character-library`, `creative-brief`, `movie-director`,
`seedance-prompts`, `video-framework`, `video-post`, `video-replicator`.

### 6.2 Take from vclaw-video-core only (18)

These don't exist in `videoclaw`. Take verbatim.

```
brand-presenter, bunty, davendra-presenter, deepsearch, director-video,
git-master, nex-presenter, ralph-init, review, video-analyze-template,
video-clone-ad, video-portfolio-ops, video-production-handoff,
video-release-readiness, video-replicator-workspace, video-review-ui-qa,
video-storyboard, video-thumbnail-lab
```

### 6.3 Port from videoclaw only (3)

```
presenter-video                  — likely superseded by brand/davendra/nex/
                                   bunty presenter skills; review before
                                   porting, may be redundant
seedance-music-video-prompts     — port verbatim; specialization of
                                   seedance-prompts for music videos
skills-auditor                   — auditing tool for the skills library
                                   itself; useful for keeping 55 skills sane
```

### 6.4 Skills registry

After consolidation, regenerate `skills/catalog.json` (the format
`vclaw-video-core` already uses) and refresh `skills/SKILL_MAP.md` /
`skills/README.md`. Run `npm run check:skill-frontdoor` and the
`skills-auditor` skill itself as a one-shot validation.

---

## 7. What gets dropped — and the rationale

| Dropped | Reason |
|---|---|
| Rust crates (`omx-explore`, `omx-sparkshell`, `omx-mux`, `omx-runtime`, `omx-runtime-core`) | Performance-optimized infra for the Codex CLI host. Not part of a video CLI. Forces a Cargo toolchain on every user. |
| `src/team/` (tmux team coordination) | OMC's `team` skill + Claude Code's native subagent dispatch cover this. |
| `src/ralph/`, `src/ralplan/` (persistent loops + consensus planning) | Same — already first-class skills (`ralph`, `ralplan`) in the merged library and in OMC/superpowers. |
| `src/mcp/` (5 MCP servers: state/memory/code-intel/team/trace) | These were generic developer tooling, not video-specific. Use Claude Code's host MCP config + claude-mem for persistence. |
| `src/hooks/`, `src/autoresearch/`, `src/hud/`, `src/visual/`, `src/openclaw/`, `src/sparkshell/`, `src/runtime/`, `src/subagents/`, `src/notifications/`, `src/verification/` | Codex CLI host concerns. Not video-relevant. |
| `src/config/generator.ts` | Generated Codex `config.toml`. Not needed without orchestration. |
| `src/video/production-executor.ts` (3,280 lines) | Monolith. Its responsibilities are already decomposed cleanly across `vclaw-video-core`'s small single-purpose files. |
| `docs-site/` (VitePress) | Premature. Ship docs as flat MD; resurrect a site only when you actually want a public docs URL. |
| `scripts/video/tests/` bulk pytest (405 tests) | Most are orchestration-coupled. Port only the compose/chain/critique tests. |
| Coverage gates on `dist/team/` and `dist/state/` | No team/state subsystem to gate. Replace with smoke-suite gates from `vclaw-video-core` (`check:release-readiness-lite`). |
| `archive/` (legacy in `videoclaw`) | Already archived. Leave it. |
| `video-replicator.db` (SQLite at videoclaw root) | Unclear what it stores; almost certainly local dev state. Do not migrate without explicit identification. |
| `.impeccable.md` (videoclaw root) | Tool-specific config; reintroduce only if you use `impeccable` again. |

---

## 8. Phased migration

Each phase ends with a green `npm run check:release-readiness-lite`.

### Phase 0 — Foundation (1 commit)

- Copy `vclaw-video-core` into `videoclaw-v2/` as the base.
- Rename `package.json` `name` → `"videoclaw"`, bump version → `0.12.0`
  (continues `videoclaw`'s numbering so npm consumers don't downgrade).
- Keep both bins (`vclaw`, `omx` alias).
- Run `npm install && npm run build && npm test && npm run smoke:runtime`.
- Initial CLAUDE.md derived from `vclaw-video-core`'s + updated for v2 scope.
- Drop `.git` from the copy and `git init` fresh, OR cherry-pick history with
  `git subtree` — see §9 for the decision.

### Phase 1 — veo-cli + Flow/Omni backend (2-3 commits)

- Copy `videoclaw/veo-cli/` verbatim to `videoclaw-v2/veo-cli/`.
- Add `test:veo-cli` script back to `package.json`.
- Diff `videoclaw/src/video/provider-platform/` against
  `vclaw-video-core/src/video/provider-platform/`; port any Flow v1 + Omni
  Flash route descriptors core doesn't have yet.
- Diff `videoclaw/src/video/adapters.ts` for Omni Flash V2V capability
  registration; port deltas into the v2 equivalent.
- Smoke-test: `npm run smoke:native-veo` should still pass.

### Phase 2 — Curated Python pipeline (2 commits)

- Create `scripts/video/` (separate namespace from TS `src/video/`).
- Copy the ~20-30 curated `.py` files (§5.3) + `requirements.txt`.
- Add `test:video:python` script (optional CI job, not blocking).
- Document in `docs/PYTHON_PIPELINE.md` as opt-in.
- Wire a `vclaw director:compose` subcommand that shells out to the Python
  composer, returning JSON.

### Phase 3 — Skill consolidation (1-2 commits)

- For the 33 common skills, diff each pair, take the better, fold in
  Flow/Omni references where applicable.
- Copy the 3 unique-to-videoclaw skills (§6.3).
- Regenerate `skills/catalog.json` + `skills/SKILL_MAP.md`.
- Run `npm run check:skill-frontdoor` and the `skills-auditor` skill.

### Phase 4 — Docs reconciliation (1 commit)

- Rewrite `README.md` for the merged scope (drop orchestration claims).
- Write `docs/MIGRATION.md` covering: `videoclaw` → `videoclaw-v2` migration
  for existing users (binary still `vclaw`, `omx` still aliased, state path
  unchanged where possible).
- Update `docs/ARCHITECTURE.md` to reflect dropped subsystems.
- Add `docs/PYTHON_PIPELINE.md`.

### Phase 5 — Retire sources (after a soft-launch period)

- Tag `videoclaw` v0.11.x final, archive the repo with a README banner
  pointing at `videoclaw-v2`.
- Same for `vclaw-video-core` (last release was 0.1.0 — archive with banner).
- Publish `videoclaw-v2` to npm under the name `videoclaw` (continues the
  package).

---

## 9. Open questions to resolve before Phase 0

1. **Git history.** Three options:
   - (a) Fresh `git init` — clean history, lose blame.
   - (b) `git subtree add` both repos as subtrees, preserve history.
   - (c) `git filter-repo` to graft + rewrite.
   Recommendation: **(a) fresh init**, since neither source repo's history is
   load-bearing now that the rebuild has happened. Note both source commit
   SHAs in `CHANGELOG.md` for traceability.

2. **`production-executor.ts` audit.** I assert its responsibilities are
   already decomposed in `vclaw-video-core/src/video/*.ts`. Worth one targeted
   pass to confirm before deletion — there may be 1-2 edge-case behaviors
   (e.g., Omni Flash V2V branching, joey-flags handling, retry logic) that
   aren't replicated in core. A side-by-side audit of `execute.ts` in both
   repos is the lightest-weight check.

3. **`prompt-guidance-contract.md`.** `videoclaw` has a contract enforced by
   regression tests (`src/hooks/__tests__/prompt-guidance-*.test.ts`) about
   what AGENTS.md and `prompts/*.md` must contain. Without `src/hooks/`, the
   contract isn't enforced. Decide: (a) re-encode the rules in a CLAUDE.md
   convention, or (b) port the regression tests over (small TS lift).
   Recommendation: **(a)** — the contract was protecting orchestration-side
   prompt behaviors; if orchestration leaves, most of it lapses.

4. **`video-replicator.db`** at `videoclaw` root. SQLite, 100 KB, last
   modified 2026-04-18. Identify what writes it before merge (likely a local
   dev seed for the `video-replicator` skill?). If it's content the skill
   needs at runtime, port it; if it's developer-machine state, leave it.

5. **`SUTUI_API_KEY` and Asset Library upload.** `videoclaw` auto-uploads
   image manifests when this env var is present. `vclaw-video-core` has
   `native-seedance.ts` using `SUTUI_API_KEY`. Verify the behavior is
   equivalent; if videoclaw does extra (e.g., manifest dedup, hash-keying),
   port the delta.

6. **`presenter-video` skill.** `vclaw-video-core` has 4 presenter-family
   skills (`brand-presenter`, `bunty`, `davendra-presenter`, `nex-presenter`).
   Read the `videoclaw/skills/presenter-video/` SKILL.md to determine if it's
   a generic version that's been specialized, or a different thing entirely.
   May not need to port.

7. **Coverage targets.** `vclaw-video-core` has none. `videoclaw` has CI
   gates on `dist/team/` and `dist/state/` (which are dropped). Decide
   whether to add coverage gates on the merged `src/video/` — recommended,
   but pick conservative targets initially (e.g., 60% lines, 70% functions)
   and tighten as the test suite grows.

8. **Asset Library / Obsidian export.** Both repos touch Obsidian. Confirm
   `vclaw-video-core/src/video/obsidian-export.ts` covers the use cases that
   any videoclaw-side Obsidian logic was solving.

---

## 10. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `production-executor.ts` has edge-case logic not in core | Medium | §9 item 2 — targeted audit before deletion. |
| Flow v1 / Omni Flash routes already in core (work duplicated) | Low-Medium | First step of Phase 1 is a diff, not a port. |
| Python pipeline dependencies break in venv | Medium | Treat Python as opt-in subsystem; smoke it in a separate CI job. |
| Skill diffs are large (the 8 common skills with Flow/Omni refs in §6.1) | Medium | Phase 3 is its own commit; allow up to 1 day. |
| Users of `videoclaw` v0.11.x rely on orchestration features (ralph/team) | Low | Drop is intentional; document in MIGRATION.md and recommend the OMC/superpowers plugins as the replacement. |
| `omx` alias breaks downstream tooling | Low | Keep the alias; `check:omx-alias` guardrail already exists in core. |
| Loss of VitePress docs site | Low | Flat `docs/*.md` is sufficient pre-1.0; resurrect VitePress under `docs-site/` later if needed. |

---

## 11. Definition of done for this merge

- [ ] `videoclaw-v2/` builds, tests, and passes all 7 smoke harnesses + 5
      guardrails inherited from `vclaw-video-core`.
- [ ] `npm run test:veo-cli` passes (Bun).
- [ ] `npm run test:video:python` passes when the venv is set up (optional CI
      gate).
- [ ] 55 skills present; `npm run check:skill-frontdoor` + skills-auditor
      both clean.
- [ ] `vclaw` binary works end-to-end on a fresh project: `vclaw video init →
      brief → storyboard → assets → review → publish` with both `storyboard`
      and `director` modes.
- [ ] `omx` alias still works, prints deprecation notice.
- [ ] CLAUDE.md + AGENTS.md + README.md + docs/*.md reflect the merged scope.
- [ ] Both source repos archived with banner pointing at `videoclaw-v2`.

---

## 12. Estimated effort

| Phase | Effort |
|---|---|
| Phase 0 (foundation) | 30-60 min |
| Phase 1 (veo-cli + backend) | 2-4 h (depends on Flow/Omni delta) |
| Phase 2 (Python curation) | 2-3 h |
| Phase 3 (skill consolidation) | 4-6 h (33 diffs are the long pole) |
| Phase 4 (docs) | 2-3 h |
| Phase 5 (retire sources) | 30 min |
| **Total active work** | **~1.5-2.5 working days** |

Real wall-clock with verification, smoke runs, and the §9 open questions
resolved: **3-5 working days**.

---

---

# Addendum (drafted same session, supersedes §6 where they conflict)

This addendum incorporates a deeper second-pass investigation that covered the
transporter layer, the `veo-cli` rename, the templates/playbooks/references
inventory, the schemas, and a *verified* (not length-based) diff of the skills
that look like they need merging.

## A1. Verified skill verdicts — supersedes §6

The §6.1 table assumed the 33 common skills were near-identical and that
length differences hinted at which version to take. A direct content diff
proves that assumption wrong for the disputed ones. **The pattern is
consistent: A (videoclaw) is the older form that calls Python scripts and
bash helpers directly; B (vclaw-video-core) was rewritten to call the native
`vclaw video <command>` surface.** Longer ≠ better — longer usually meant
"more legacy bash."

### A1.1 Re-decided "A vs B" skills

| Skill | Earlier (wrong) | **Verified** | Reason |
|---|---|---|---|
| `seedance-prompts` | TAKE_A | **TAKE_B** | B explicitly says "Do not tell users to run those old paths from this clean-room repo." A still calls `python3 scripts/video/seedance_prompt_db.py`. B uses `vclaw video prompt-lib-list` / `vclaw video prompt-lib-show`. |
| `video-post` | TAKE_A | **TAKE_B** | A hardcodes `cd ~/videoclaw/projects/<slug>` + ships bespoke `scripts/verify-quality.sh` / `make-vertical.sh` etc. B uses `vclaw video verify-final --file ... --project ...`. B is "intentionally generic and repo-local". |
| `ugc` | TAKE_A | **TAKE_B** | A calls `python scripts/video/campaign_manifest.py` and `python scripts/video/ugc_strategy.py`. B says "The clean-room repo does not ship the old UGC strategy helper scripts" and uses `vclaw video init`/`set-meta`/`character-creator` flow. B also has a structured `triggers:` block and a `Positioning` section that defers to `video-framework` for generic requests. |
| `movie-director` | TAKE_A | **MERGE — B's SKILL.md + A's reference assets** | A uses `node dist/cli/omx.js video create` and `python scripts/video/auto_create_characters.py`. B uses `vclaw video create` + `vclaw video character-auto-create`. **However**, A has 9 unique reference files worth porting (see A1.3). |
| `character-library` | TAKE_A | **TAKE_B (small merge)** | B has clearer separation-of-concerns prose (defers creation to `character-creator`). A has a slightly richer "8-Field Description Template" walkthrough — port that one section into B if not already covered there. |
| `creative-brief` | "EITHER" | **MERGE — A's backend matrix into B's structure** | **Critical**: A has the **Omni Flash + Google Flow V1 + Veo 3.1 model lineup** (`veo-3.1-fast`, `veo-3.1-quality`, `veo-3.1-lite`, `veo-3.1-lite-low-priority`, `omni-flash`) + pointer to `veo-cli/docs/GOOGLE-FLOW-V1.md`. B's version is older and only knows "Fast draft / Quality final / Free". Take B's frontmatter (`triggers:` block) and structure, fold A's quality/backend matrix in. **This is the only Flow-V1 / Omni Flash content that lives in a skill SKILL.md.** |

### A1.2 Status of the other "TAKE_A" candidates flagged earlier

The earlier table flagged `character-library`, `movie-director`,
`seedance-prompts`, `ugc`, `video-post`, `youtube-audio`, `studio-mode` as
TAKE_A. All five of the inspected ones flipped to TAKE_B or MERGE. By the
same pattern, **assume `youtube-audio` and `studio-mode` are also TAKE_B
unless a content diff proves otherwise.** Diff them as the first step of
Phase 3 to confirm.

### A1.3 `movie-director` reference assets to port from A → B

Files present under `videoclaw/skills/movie-director/` but missing from
`vclaw-video-core/skills/movie-director/`. All look like genuinely useful
content, not legacy plumbing:

```
references/character-creation.md
references/examples/anime-action.yaml
references/examples/children-cartoon.yaml
references/examples/comedy-sitcom.yaml
references/examples/period-drama.yaml
references/examples/travel-vlog.yaml
references/prompt-recipes.md
references/quick-start.md
references/runtime-architecture.md
references/sound-design.md
agents/openai.yaml          ← drop; orchestration-flavored
scripts/diff-storyboards.sh ← drop; legacy bash
scripts/setup.sh            ← drop; legacy bash
scripts/test-skill.sh       ← drop; legacy bash
```

Port the 5 example YAMLs + 5 reference docs (10 files). Drop the
agents/openai.yaml (orchestration-flavored) and the 3 bash scripts (legacy
plumbing).

### A1.4 Update to the §6 verdict count

Net target after verified merge: **still 55 skills**, but the per-skill effort
is heavier than implied. Budget 8-10 h for Phase 3, not 4-6 h. Most of the
work is in `creative-brief` (model matrix merge) and `movie-director`
(reference-asset port).

---

## A2. Provider / transporter merge plan

The biggest gap in the original §5 was treating providers as "just port the
Flow/Omni route descriptors." That undersells what's there.

### A2.1 What each repo actually has

**`videoclaw/src/video/provider-platform/`** (6 files):

```
index.ts        — public exports
registry.ts     — DEFAULT_PROVIDER_REGISTRY with 2 routes shown
                  (veo-direct, veo-useapi). Likely also seedance-direct,
                  seedance-useapi, kling-useapi, runway-useapi below.
                  Each route has: controls[], operationSupport[] with
                  aspectRatios/notes/maxReferenceImages, routingHints
                  {latency, cost, trust, preferredWorkflows},
                  escapeHatches[]. RICH SCHEMA.
router.ts       — route-selection logic
security.ts     — credential handling / API key isolation
telemetry.ts    — provider call telemetry
types.ts        — VideoProviderDescriptor, ProviderRoutingPolicy,
                  ProviderRouteId, etc.
```

**`vclaw-video-core/src/video/provider-platform/`** (2 files):

```
registry.ts     — DEFAULT_PROVIDER_REGISTRY with 4 routes:
                  veo-useapi, seedance-direct, runway-useapi (scaffold only),
                  kling-useapi (scaffold only). Each has: id, provider,
                  displayName, path, supportedOperations, notes. FLAT SCHEMA.
types.ts        — VideoProviderDescriptor (the flat shape above)
```

Plus the **adapter runtime** in `vclaw-video-core/src/video/`:

```
native-seedance.ts          — native in-process Seedance via SUTUI_API_KEY
native-veo.ts               — native in-process Veo via local veo-cli
provider-adapter-runner.ts  — generic adapter dispatcher (stdin/stdout JSON)
provider-status.ts          — provider health/status surface
```

### A2.2 Merge call

| Concern | Take from | Reasoning |
|---|---|---|
| Descriptor **schema** (controls, operationSupport[].aspectRatios/notes/maxReferenceImages, routingHints, escapeHatches) | **videoclaw** | Richer, future-proof, captures real-world quirks (e.g., "Portrait I2V regresses on direct Flow"). Worth the extra fields. |
| **Route inventory** (veo-direct + veo-useapi + seedance-direct + seedance-useapi + runway-useapi + kling-useapi) | **union** | videoclaw has the polished veo-direct/veo-useapi entries with operational notes; vclaw-video-core has the Runway + Kling scaffolds. Take both. |
| **Router** (`router.ts`) | **videoclaw** | No equivalent in core. Needed once you have >2 routes. |
| **Security** (`security.ts`) | **videoclaw** | Credential isolation; transferable. |
| **Telemetry** (`telemetry.ts`) | **videoclaw** | Useful for cost/latency tracking; complements core's `generation-telemetry.ts`. |
| **Native transports** (`native-seedance.ts`, `native-veo.ts`) | **vclaw-video-core** | Native in-process paths bypassing the adapter shell. Core's design. |
| **Adapter dispatch** (`provider-adapter-runner.ts`, `provider-adapter.ts` bin) | **vclaw-video-core** | Clean stdin/stdout JSON adapter protocol; pluggable via `..._ADAPTER` env vars. Core's design. |
| **Status surface** (`provider-status.ts`) | **vclaw-video-core** | Doctor/status integration; already wired. |

**Net result**: `src/video/provider-platform/` becomes 6 files (videoclaw's
shape) with vclaw-video-core's 4-provider scaffold inventory expanded to
match. The adapter runtime (native + dispatcher) stays as it is in
vclaw-video-core. Total: `src/video/provider-platform/` (6) +
`src/video/native-*.ts` (2) + `src/video/provider-adapter-runner.ts` (1) +
`src/video/provider-status.ts` (1) = 10 files for the full transporter
layer.

### A2.3 Provider/route inventory after merge

```
veo-direct       — Google Veo via direct browser/Flow path
                   (Veo 3.1 fast/quality/lite/lite-low-priority + Omni Flash)
veo-useapi       — Google Veo via UseAPI aggregator
seedance-direct  — Seedance via SUTUI_API_KEY (native in-process)
seedance-useapi  — Seedance via UseAPI (port from videoclaw if present)
runway-useapi    — Runway via UseAPI (currently scaffold; needs implementation)
kling-useapi     — Kling via UseAPI (currently scaffold; needs implementation)
```

Open question: should `omni-flash` be a separate descriptor or a model
variant within `veo-direct`? Right now videoclaw treats it as a model
selection within the Veo provider (per the Omni Flash V2V advertising in
`adapters.ts`). Keep it as a model variant, surface it through
`operationSupport[].notes` + `escapeHatches.videoModelKey`. Don't create a
top-level `omni-direct` descriptor unless the provider boundary materially
differs (it does not — same backend, same auth).

### A2.4 Schemas

`vclaw-video-core/schemas/video/` has **13 schemas** (asset-manifest, brief,
storyboard, analyze-output, clone-plan, execution-plan, execution-report,
publish-report, reference-sheets, review-report, scene-candidates,
scene-selection, pipeline-manifest). `videoclaw/schemas/video/` has **7**
(asset-manifest, brief, storyboard, analyze-output, publish-report,
review-report, pipeline-manifest).

**Take vclaw-video-core's `schemas/video/` verbatim.** It is a strict
superset and represents the more elaborated pipeline.

---

## A3. `veo-cli` → `vclaw-cli` rename

The `veo-cli/` directory is no longer just a Veo wrapper. Its actual surface:

```
veo-cli/
├── google.ts                       ← top-level Google Labs Flow entry
├── src/
│   ├── api.ts                      ← provider-agnostic API layer
│   ├── auth.ts                     ← Google account auth (cookie-based)
│   ├── cli.ts                      ← CLI dispatch
│   ├── generation.ts               ← generation orchestration
│   ├── download.ts                 ← asset download
│   ├── upload.ts                   ← asset upload
│   ├── webhook.ts                  ← webhook listener
│   ├── prompts.ts                  ← prompt handling
│   ├── types.ts                    ← shared types
│   ├── config.ts                   ← config loader
│   ├── index.ts                    ← public exports
│   ├── db.ts                       ← SQLite local DB
│   ├── db-convex.ts                ← Convex cloud DB adapter
│   ├── db-unified.ts               ← unified DB façade (chooses SQLite or Convex)
│   ├── backends/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── direct/index.ts         ← direct backend (Flow scraping)
│   │   └── useapi/
│   │       ├── client.ts           ← UseAPI HTTP client
│   │       ├── accounts.ts         ← UseAPI account rotation
│   │       └── index.ts
│   └── provider-platform/
│       ├── index.ts                ← RE-EXPORTS from root src/video/provider-platform
│       ├── benchmark.ts
│       └── benchmark-smoke.ts
├── benchmarks/                     ← perf comparison data
├── tests/
├── docs/                           ← includes GOOGLE-FLOW-V1.md (canonical)
├── examples/
├── config.json
├── cookie.json                     ← committed; **DO NOT carry over**
├── google-account-cookies.json     ← committed; **DO NOT carry over**
├── veo-cli.db                      ← local SQLite; **DO NOT carry over**
├── package.json                    ← name: "veo-cli"; bun >= 1.3.5
└── bun.lock
```

It supports **Google Labs Flow (direct) + UseAPI (Veo / Seedance /
extend / concat / Omni Flash V2V)** with two storage backends (SQLite local
or Convex cloud). The name `veo-cli` is a misnomer.

### A3.1 Rename plan

```
veo-cli/                             → vclaw-cli/
veo-cli/src/                         → vclaw-cli/src/
veo-cli/google.ts                    → vclaw-cli/flow.ts
                                       (rename top-level entry; google.ts
                                       wasn't accurate either — it's Flow-specific)
package.json name: "veo-cli"         → "vclaw-cli"
package.json description             → "Multi-provider video automation CLI:
                                        Google Labs Flow (Veo 3.x + Omni Flash),
                                        UseAPI aggregator (Veo, Seedance, Runway,
                                        Kling), with optional Convex storage."
package.json keywords                → add: ["multi-provider", "useapi",
                                              "seedance", "runway", "kling",
                                              "omni-flash", "flow"]
bin reference (in root package.json) → "vclaw-cli": "vclaw-cli/dist/cli.js"
                                       (currently absent — was invoked via
                                       `cd veo-cli && bun run google.ts`)

DO NOT CARRY OVER from veo-cli/:
  cookie.json
  google-account-cookies.json
  veo-cli.db
  node_modules/
  output-videos/
  prompts-omtex-cricket-bags.txt    ← stray dataset file
  .DS_Store files
```

Update all imports across the merged repo that reference `veo-cli/...`:

```
grep -r 'veo-cli' /Users/davendrapatel/Documents/GitHub/videoclaw/src \
                  /Users/davendrapatel/Documents/GitHub/videoclaw/scripts \
                  /Users/davendrapatel/Documents/GitHub/videoclaw/skills
```

The most important references to update:

```
src/video/native-veo.ts           ← invokes veo-cli; update path
src/video/adapters.ts             ← `buildVeoCliCommand()`; rename to
                                    `buildVclawCliCommand()` and update binary name
skills/creative-brief/SKILL.md    ← references `veo-cli/docs/GOOGLE-FLOW-V1.md`;
                                    update to `vclaw-cli/docs/GOOGLE-FLOW-V1.md`
package.json test:veo-cli script  ← rename → test:vclaw-cli
```

### A3.2 Convex decision

`veo-cli` ships a `convex/` integration with `npm run convex:dev` /
`convex:deploy`. This is **cloud video state in Convex**, separate from the
project-on-disk model that `vclaw-video-core` is built around.

**Two paths:**

- **(a) Drop Convex.** Make `vclaw-cli` SQLite-only. Use the project-on-disk
  layout from core (`projects/<slug>/artifacts/...`) as canonical storage.
  Convex becomes deprecated path. Simplest, ships fastest, aligns with
  core's philosophy.
- **(b) Keep Convex as an optional adapter.** `db-unified.ts` already
  abstracts. Keep it; document Convex as opt-in for users who want hosted
  state. No CI gate.

**Recommendation: (a) drop Convex** for v2. Reasoning: the `projects/<slug>/`
model is the source of truth in vclaw-video-core; carrying a second cloud
store is a maintenance tax with no clear user. If you want cloud state
later, add an `obsidian-export`-style sync layer that mirrors `projects/`
to Convex on demand, not a live alternative DB.

### A3.3 puppeteer-real-browser

`veo-cli` uses `puppeteer-real-browser` (a fork loaded from a Git URL!) to
scrape Google Labs Flow. This is fragile (selectors break when Google
updates Flow). **Keep it** because Flow scraping is the only path to
Veo 3.x direct without an enterprise contract — but document it as a
"best-effort path that may break on Flow UI changes" in
`vclaw-cli/README.md`. Confirm UseAPI fallback works for everything Flow
scraping does, so users have a non-fragile path.

---

## A4. Templates / playbooks / references — final inventory

Earlier sections were vague on what to do with these. Here's the final
disposition:

### A4.1 `templates/` (top-level)

| Source path | Contents | Disposition |
|---|---|---|
| `videoclaw/templates/AGENTS.md` | Orchestration AGENTS.md template | **DROP** — orchestration-specific |
| `videoclaw/templates/catalog-manifest.json` | Skills catalog with `category: execution` / `core: true` style metadata | **DROP** — the schema concept is fine but `vclaw-video-core/skills/catalog.json` already supplies the merged equivalent |
| `vclaw-video-core` (no top-level `templates/`) | per-skill `templates/` dirs only (e.g., `skills/ugc/templates/`) | **KEEP** the per-skill template pattern |

`videoclaw-v2/templates/` need not exist as a top-level directory. Templates
live inside the skills that use them (already the case in core).

### A4.2 `playbooks/`

| Source path | Contents | Disposition |
|---|---|---|
| `videoclaw/playbooks/video/seedance-ugc.json` | UGC playbook | **TAKE from either** (identical files in both) |
| `videoclaw/playbooks/video/veo-generic.json` | Veo generic playbook | **TAKE from either** (identical files in both) |
| `vclaw-video-core/playbooks/seedance-ugc.json` | Same | (same as above) |
| `vclaw-video-core/playbooks/veo-generic.json` | Same | (same as above) |

Flatten to `videoclaw-v2/playbooks/` (no `video/` subdir, matching core's
shape). 2 files total.

### A4.3 `references/`

`vclaw-video-core/references/video/` has **9 files** — these are
high-value canonical reference docs:

```
references/video/seedance-ugc-formulas.md
references/video/generation-telemetry.md
references/video/stage-directors.md
references/video/dialogue-duration-preflight.md
references/video/checkpoint-protocol.md
references/video/style-template-schema.md
references/video/clone-ad-template-workflow.md
references/video/veo-prompting-guide.md
references/video/character-reference-sheet.md
```

`videoclaw/references/` mirrors only the `video/` subdir but with the same
files (verify during port). **Take vclaw-video-core's `references/video/`
verbatim.** Add it to `package.json` `files:` list so it ships with the
npm package.

### A4.4 `prompts/`

`videoclaw/prompts/` has 19 *agent-role* prompt files (executor.md,
architect.md, planner.md, etc.) — all orchestration. **DROP all 19**, since
the orchestration layer is dropped. If you ever want one of these as a
standalone skill, re-encode it as a SKILL.md.

`vclaw-video-core` has no top-level `prompts/`. Confirmed by absence in §X
earlier.

### A4.5 `agents/`

`videoclaw/agents/` is the orchestration agent definitions — **DROP**.

### A4.6 `projects/`

`vclaw-video-core/projects/` has 3 test/proof projects:

```
projects/--project/                       ← parses as a flag; likely test artifact
projects/davendra-disco-monster/
projects/e2e-proofy-image-storyboard/
projects/fresh-proof/
```

**DROP all of these from `videoclaw-v2/`.** They're working directories
from local test runs, not source artifacts. The `projects/` directory will
be re-created by users running `vclaw video init <slug>`. Add `projects/`
to `.gitignore` (already the case in core; confirm during Phase 0).

`videoclaw/projects/` exists but is similar local state — drop.

---

## A5. Updated effort + risk

The earlier estimate of **3-5 working days** assumed all 33 "common" skills
were near-identical. The verified diff shows 1 critical merge
(`creative-brief` with the Flow V1 / Omni Flash matrix) and 1 reference-asset
port (`movie-director`'s 10 unique files). Adjusted:

| Phase | Earlier | **Updated** |
|---|---|---|
| Phase 0 (foundation) | 30-60 min | 30-60 min |
| Phase 1 (vclaw-cli rename + provider merge) | 2-4 h | **5-7 h** (rename touches more than expected; provider schema merge is real work) |
| Phase 2 (Python curation) | 2-3 h | 2-3 h |
| Phase 3 (skill consolidation — corrected) | 4-6 h | **8-10 h** (creative-brief + movie-director + diff-check on ~6 remaining "uncertain" skills) |
| Phase 4 (docs) | 2-3 h | 3-4 h (need to write `docs/PROVIDER_PLATFORM.md` explaining the new merged schema + route inventory) |
| Phase 5 (retire sources) | 30 min | 30 min |
| **Total active work** | ~1.5-2.5 days | **~2.5-3.5 days** |

Wall clock with verification, smokes, and §9 resolution: **4-7 working days.**

---

## A6. New open questions

These joined the §9 list from the deeper investigation:

9. **`seedance-useapi` route.** vclaw-video-core only has `seedance-direct`.
    Does videoclaw have a `seedance-useapi` descriptor + adapter implementation
    worth porting? Diff the full `registry.ts` arrays as part of Phase 1.

10. **Runway & Kling scaffolds.** vclaw-video-core has them as `scaffold
    only`. Do you want v2 to ship them as working adapters, or keep them
    as scaffolds with a "coming soon" note? If working, this is its own
    sub-phase (adapter implementation + smoke tests per provider).

11. **Convex.** Confirmed drop (A3.2) — but verify there's no user state in
    Convex cloud that needs to migrate to local SQLite/`projects/` first.

12. **`movie-director` references port.** Confirm the 5 example YAMLs +
    5 reference docs (A1.3) aren't already covered by core's
    `references/video/` content (e.g., does `references/video/stage-directors.md`
    obsolete `movie-director/references/runtime-architecture.md`?).

13. **`youtube-audio` and `studio-mode`.** Diff-check needed before Phase 3 —
    likely TAKE_B by pattern, but not verified.

14. **Skill catalog format.** vclaw-video-core uses `skills/catalog.json`.
    videoclaw uses `templates/catalog-manifest.json` with richer metadata
    (`category`, `core`, `internalRequired`). Decide whether to enrich
    core's catalog with those fields, or keep core's format unchanged.
    Recommendation: enrich — `category` is useful for filtering, and
    `core: true` matters for distinguishing must-ship-with-CLI skills from
    optional ones.

---

# Addendum B — Projects folder: the canonical per-project layout

Second deep-pass investigation, this time on `projects/` in both repos. The
goal: lock in the on-disk contract for the merged repo based on what
actually shipped, what broke, and what we want going forward.

## B1. What exists today, and what's wrong with it

### B1.1 `videoclaw/projects/` — the unstructured legacy

Single project: `2026-05-18_001_mirchi-mode-ai-pop-group`.

**Total file inventory:** 127 jpg + 37 mp4 + 15 json + 13 url + 4 md + 3 mjs
+ 2 txt + 1 py + 1 mp3 + 1 .DS_Store.

**What's there (project root, not a subdir):**

```
approved-video-production-plan.json
approved-video-production-plan.with-characters.json
characters-input.json
characters-output.json
xskill-character-assets.json
scene-images-manifest.json
production-result.json
action-analysis-and-rewrite.md
delivery-notes.md
preproduction.md
execute-approved-plan.mjs              ← code at project root
run-production.mjs                     ← code at project root
run-runway-seedance.mjs                ← code at project root
build-fallback-production.py           ← code at project root
xskill-seedance/                       ← per-backend output dir
runway-seedance/                       ← per-backend output dir
fallback/{clips,images,audio,final}/   ← per-backend output dir
renders/3-04-action-packed-bollywood-k-pop-ai-po/   ← truncated dir name (FS max)
analysis/                              ← contact sheets, frame samples
reference/{spicy-reference.mp4, frames/, frames_mp4/}
```

**Diagnosis: ad-hoc project = ad-hoc filesystem.** No manifest, no schemas,
no stage contract, no events log, no separation of canonical vs derived
assets. Code (`.mjs`, `.py`) **co-mingled with data**. Three parallel
backend output trees (`xskill-seedance/`, `runway-seedance/`, `fallback/`)
suggesting the author was re-running the same content through different
providers because there was no single source of truth for "the storyboard"
or "the render." This is exactly what vclaw-video-core was rebuilt to fix.

**Disposition: drop entirely.** Do not import into `videoclaw-v2/projects/`.
Add a one-line MIGRATION.md entry pointing legacy users at `vclaw video
init` to re-scaffold.

### B1.2 `vclaw-video-core/projects/` — the canonical-ish layout

Four projects. Three real, one a CLI bug artifact.

| Project | Has project.json? | Top-level subdirs |
|---|---|---|
| `--project` | no | artifacts, characters, state |
| `davendra-disco-monster` | yes | artifacts, characters, checkpoints, events, state |
| `e2e-proofy-image-storyboard` | yes | artifacts, **assets**, characters, checkpoints, events, **obsidian**, **references**, state |
| `fresh-proof` | yes | artifacts, **assets**, characters, checkpoints, events, **outputs**, **references**, state |

### B1.3 Defects worth fixing in v2

**1. CLI argparse bug → project named `--project`.**

```
projects/--project/                # this exists. it shouldn't.
```

Someone ran something like `vclaw video init --project foo` and the slug
parser took the flag name as the value. The slug `--project` was then
treated as a real project and got its skeleton scaffolded.

> **Fix:** slug validation regex `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`,
> rejects leading `-`. CLI errors out before any directory creation.

**2. Top-level subdirectory shape drifts across projects.**

The CLAUDE.md spec lists `project.json + artifacts/ + checkpoints/ +
events/ + state/ + characters/ + storyboard.md` as canonical. But real
projects add **assets/**, **obsidian/**, **outputs/**, **references/**
ad-hoc, some have them, some don't.

> **Fix:** decide for each directory whether it's *always-present*,
> *create-on-demand*, or *derived* (gitignored). See B2.

**3. `state/` is always empty.**

Across all three real projects, `state/` contains zero files. Dead
convention.

> **Fix:** drop `state/` from the canonical layout. If derived state ever
> needs to live somewhere, put it under `.vclaw/state/` (hidden), not at
> project top-level.

**4. Schema vs actual artifact drift (worst defect).**

`schemas/video/artifacts/` defines **12** schemas. Projects write **19**
distinct artifact files. Specifically:

**Artifacts written with NO schema (7):**
```
director-seedance-plan.json
gobananas-character-brief.json
gobananas-character-iteration-requests.json
image-smoke-test.json
post-plan.json
reference-board.json
review-ui-ledger.json
storyboard-still-generation-requests.json
storyboard-stills-plan.json
```

**Schemas defined but artifact never written (1):**
```
clone-plan.schema.json
```

**Schema lives, artifact lives in DIFFERENT directory:**
```
reference-sheets.schema.json  ← only written as references/reference-sheets.json
                                 never as artifacts/reference-sheets.json
analyze-output.schema.json    ← no instance in any of the 3 projects
```

> **Fix:** add a CI guardrail (`check:artifact-schema-coverage`) that:
> 1. grep-finds every `artifacts/*.json` file path emitted by `src/video/`
> 2. asserts a matching `schemas/video/artifacts/<name>.schema.json` exists
> 3. errors if a schema exists without a writer (orphan schema)
> The drift listed above is the first task this guardrail will surface.

**5. Markdown in artifacts/ — schema violation by file type.**

```
artifacts/review-ui-image-prompt-log.md
```

The cleanroom rule is "artifacts/ is canonical machine-readable JSON."
A `.md` file in `artifacts/` cannot have a JSON schema and breaks
downstream tooling that expects to enumerate `*.json` only.

> **Fix:** route MD into a sibling `notes/` directory (or
> `artifacts/_logs/` if you want it co-located but namespaced). Update
> writers to emit there.

**6. events.jsonl embeds absolute paths.**

```jsonl
{"type":"artifact.review-report.written", ...,
 "payload":{"artifactPath":"/Users/davendrapatel/Documents/GitHub/vclaw-video-core/projects/fresh-proof/artifacts/review-report.json"}}
```

Consequences:
- Projects are **not portable** between machines (path is wrong on import).
- Project folders **leak the user's home directory** (privacy/audit).
- Moving a project to a different parent breaks the event log.

> **Fix:** events.jsonl payloads use **project-relative paths**
> (`artifacts/review-report.json`). Add a `recordedFrom: { cwd, machine, vclawVersion }`
> envelope field if you want machine context (separate field, not embedded
> in path strings). Add a smoke test that loads a project, moves it to a
> different absolute path, and verifies events still resolve.

**7. events.jsonl has duplicate events.**

`fresh-proof` has three back-to-back identical `review-report.written`
events at `2026-05-07T00:48:04.939Z`, `.940Z`, and a third at `:08.892Z`.
Either a UI button double-fired or the writer has no idempotency.

> **Fix:** events should be idempotent on `(type, payload-content-hash)`
> within a 5s window. Or write `event.id: <ulid>` and de-dup on read. Pick
> one — currently neither.

**8. Pipeline definition embedded in every project.json.**

Each project.json carries the full 5-stage pipeline spec (~80 lines of
duplicated config: stage names, requiredArtifactsIn, produces,
checkpointRequired, humanApprovalDefault, successCriteria).

```json
"pipeline": {
  "name": "director",
  "version": "1.0.0",
  "stages": [ ...80 lines... ]
}
```

This means:
- Updating a pipeline definition requires touching every existing project.
- A project locked to v1.0.0 of "director" can't be re-run against v1.1.0
  without manual JSON surgery.
- New stages added in `src/video/pipeline-manifests/` don't propagate.

> **Fix:** `project.json` carries `pipelineRef: "director@1.0.0"` (or
> `pipelineRef: "director"` for "track HEAD"). Canonical definitions live
> in `src/video/pipeline-manifests/director-v1.json`. CLI resolves at
> runtime and warns if the requested pipeline ref version is missing.

**9. Naming drift in artifact history directories.**

`fresh-proof` and `davendra-disco-monster` use `artifacts/history/`.
`e2e-proofy-image-storyboard` uses both `artifacts/history/` **and**
`artifacts/e2e-image-storyboard-history/`. The second name appears to be a
one-off per-project-prefixed history dir — likely a writer that
inadvertently took `<slug>-history` as the directory name.

> **Fix:** canonical name is `artifacts/history/`. Add an
> ESLint/grep guardrail or simple integration test that rejects writers
> creating any other `*-history/` directory.

**10. `upload_cache.json` at project root.**

```
fresh-proof/upload_cache.json   (915 bytes, root-level)
```

Loose cache file at project root. Not in artifacts/ (it's not canonical),
not under a hidden dir.

> **Fix:** move to `.vclaw/cache/upload-cache.json`. The `.vclaw/` hidden
> dir is the canonical home for everything derived/cache/ephemeral.
> Gitignore `.vclaw/`.

**11. `outputs/.vclaw-jobs/` — partial credit.**

```
fresh-proof/outputs/.vclaw-jobs/seedance-1778117982213.json
```

Job tracking is hidden under `outputs/.vclaw-jobs/`. Good instinct
(hidden), wrong location (it's not an output, it's runtime state).

> **Fix:** move to `.vclaw/jobs/seedance-<ts>.json`. `outputs/` is for
> final renders only.

**12. `obsidian/` only present in one project; `outputs/` only in another.**

Inconsistent — both are post-publish artifacts.

> **Fix:** both are *derived* directories created on demand by their
> respective commands (`vclaw video publish` creates `outputs/`,
> `vclaw video obsidian-export` creates `obsidian/`). Neither is part of
> the always-present skeleton; both must be gitignored.

---

## B2. Canonical per-project layout for v2

After all the above, here is what `vclaw video init <slug>` should
scaffold and what other commands are allowed to add:

```
projects/<slug>/
│
├── project.json                # MANIFEST — see B3 for shape
├── storyboard.md               # Director-mode human-readable approval doc
│                                 (created during storyboard stage; absent in
│                                 storyboard-mode projects until then)
│
├── artifacts/                  # CANONICAL machine-readable outputs.
│   │                             JSON only. Every file MUST have a schema
│   │                             in schemas/video/artifacts/.
│   ├── brief.json
│   ├── storyboard.json
│   ├── asset-manifest.json
│   ├── scene-candidates.json
│   ├── scene-selection.json
│   ├── reference-sheets.json   # ← move from references/ subdir (see B1.3 #4)
│   ├── execution-plan.json
│   ├── execution-report.json
│   ├── review-report.json
│   ├── publish-report.json
│   ├── analyze-output.json     # ← currently orphan schema; either gain a writer or drop schema
│   ├── clone-plan.json         # ← currently orphan schema; same
│   │
│   └── history/                # Snapshots of artifacts/ files on
│                                 overwrite. Append-only. One subdir
│                                 per artifact: history/brief/<ts>.json.
│
├── checkpoints/                # ONE FILE per stage. Tracks approval
│   ├── brief.json                state, who approved when, retry count,
│   ├── storyboard.json           verdict.
│   ├── assets.json
│   ├── review.json
│   └── publish.json
│
├── characters/                 # CANONICAL identity store for this project.
│   └── characters.json
│
├── events/                     # Append-only timeline. JSONL.
│   └── events.jsonl              Payloads use project-relative paths only.
│
├── notes/                      # Human-authored or model-authored MD.
│   ├── review-ui-image-prompt-log.md   ← moved out of artifacts/
│   └── (any free-form .md the workflow needs)
│
├── outputs/                    # DERIVED. Final encoded media only.
│   ├── final/<slug>-<mode>.mp4   Created by publish stage.
│   ├── scene-0.mp4               Per-scene renders.
│   ├── scene-1.mp4               Gitignored at the project level.
│   └── ...
│
├── assets/                     # DERIVED. Intermediate visual assets.
│   ├── storyboard/               Per-scene stills.
│   ├── upscaled/                 Upscaled variants.
│   └── (other backend-specific scratch)
│                                 Gitignored.
│
├── obsidian/                   # DERIVED. Mirror of canonical artifacts
│                                 in Obsidian-friendly MD. Created by
│                                 `vclaw video obsidian-export`. Gitignored.
│
└── .vclaw/                     # HIDDEN. Everything ephemeral/cache/runtime.
    ├── cache/
    │   └── upload-cache.json     ← moved out of project root
    ├── jobs/
    │   └── seedance-<ts>.json    ← moved out of outputs/.vclaw-jobs/
    └── state/                    Per-machine runtime state if needed.
                                 Gitignored.
```

### B2.1 Directory disposition table

| Directory | Always-present | Schema-enforced | Gitignored? | Created by |
|---|---|---|---|---|
| `project.json` | yes (on init) | yes | no (commit) | `vclaw video init` |
| `storyboard.md` | director-mode only | n/a (free-form) | no | storyboard stage |
| `artifacts/` | yes (empty on init) | **yes — every file** | no | every stage |
| `artifacts/history/` | created on first overwrite | yes | no | artifact-store |
| `checkpoints/` | yes (empty on init) | yes (per-stage shape) | no | stage transitions |
| `characters/` | yes (empty on init) | yes (characters.json shape) | no | character commands |
| `events/` | yes (empty `events.jsonl`) | line shape enforced | no | every event writer |
| `notes/` | no (on demand) | no (MD) | no | model + human writers |
| `outputs/` | no (on demand) | n/a (media) | **yes** | publish/execute |
| `assets/` | no (on demand) | n/a (media) | **yes** | asset/storyboard stages |
| `obsidian/` | no (opt-in command) | n/a (MD mirror) | **yes** | `obsidian-export` |
| `.vclaw/` | no (on demand) | internal | **yes** | various |

The "Gitignored" column drives the project-level `.gitignore` template
that `vclaw video init` lays down.

### B2.2 Project-level `.gitignore` template (laid down by `vclaw video init`)

```gitignore
# Derived media — re-generable from canonical artifacts
/outputs/
/assets/
/obsidian/

# Ephemeral / cache / runtime state
/.vclaw/

# OS noise
.DS_Store
```

`artifacts/`, `checkpoints/`, `characters/`, `events/`, `notes/`,
`project.json`, `storyboard.md` are **committed by design** so the project
is reproducible from its canonical state.

---

## B3. `project.json` v2 shape

Current shape: ~80 lines because pipeline is embedded. v2 shape: ~15
lines with a pipeline reference.

```json
{
  "schemaVersion": 2,
  "slug": "fresh-proof",
  "productionMode": "director",
  "pipelineRef": "director@1.0.0",
  "createdAt": "2026-05-06T02:20:19.421Z",
  "updatedAt": "2026-05-07T02:08:17.235Z",
  "createdBy": {
    "cli": "vclaw",
    "version": "0.12.0"
  },
  "currentStage": null,
  "lastCompletedStage": "publish",
  "lastCheckpointStatus": "completed",
  "tags": ["proof", "internal-test"],
  "metadata": {}
}
```

**What's new vs v1:**

- `schemaVersion` — explicit version marker so migration code knows what
  it's reading.
- `pipelineRef` instead of embedded `pipeline.stages[]` — resolves at
  runtime via `src/video/pipeline-manifests/<name>-v<version>.json`.
- `createdBy` — captures the CLI version that scaffolded the project.
  Useful for `vclaw doctor`-style "this project was created with an older
  CLI, you may want to migrate."
- `tags` + `metadata` — already used informally; promote to first-class
  schema fields for `vclaw video index` filtering.

**Migration path for v1 projects:**

`vclaw video migrate-project --project <slug>` reads v1 `project.json`,
identifies the embedded pipeline (by hashing it against known canonical
pipelines), writes back the v2 shape with the matching `pipelineRef`. If
the pipeline doesn't match any canonical, it's written to
`src/video/pipeline-manifests/<slug>-custom.json` with a warning.

---

## B4. Slug rules

Currently no validation visible. Real `vclaw video init` should enforce:

| Rule | Regex / Limit |
|---|---|
| Allowed chars | `[a-z0-9-]` only |
| Must start with | `[a-z0-9]` (not `-`) |
| Must end with | `[a-z0-9]` (not `-`) |
| Length | 3-64 chars |
| Disallowed substrings | `--`, leading dot, reserved names (`history`, `artifacts`, `checkpoints`, `events`, `state`, `outputs`, `assets`, `obsidian`, `characters`, `notes`, `tmp`) |
| Reserved special-case | reject any argv that looks like a flag (`^-`) |

Recommended slug template if the user doesn't provide one:
`<yyyy-mm-dd>-<auto-noun>-<auto-noun>` (e.g., `2026-05-24-disco-monster`).
This avoids the legacy videoclaw style (`2026-05-18_001_<theme>`) — the
`_001` sequence requires global state to maintain and the underscore
violates the slug regex.

---

## B5. Event log v2 shape

Current line:
```jsonl
{"type":"artifact.review-report.written","recordedAt":"2026-05-06T21:54:52.404Z","payload":{"source":"review-ui","artifactPath":"/Users/davendrapatel/Documents/GitHub/vclaw-video-core/projects/fresh-proof/artifacts/review-report.json","verdict":"pass"}}
```

v2 line:
```jsonl
{"id":"01HK7Z...","type":"artifact.review-report.written","recordedAt":"2026-05-06T21:54:52.404Z","source":"review-ui","payload":{"artifactPath":"artifacts/review-report.json","verdict":"pass"}}
```

Changes:
1. `id: <ulid>` — explicit event ID for de-dup on read.
2. `source` promoted out of payload into envelope (always-present).
3. `payload.artifactPath` is **project-relative** ("artifacts/review-report.json"),
   not absolute.

Reader contract: when consuming `events.jsonl`, resolve paths against the
project root. Never trust an absolute path in an event line — if you see
one, it's a v1 event and should be migrated on read.

---

## B6. Artifact schema-coverage guardrail

Add to `package.json`:

```json
"check:artifact-schema-coverage": "node scripts/check-artifact-schema-coverage.mjs"
```

The script:
1. Greps `src/video/**/*.ts` for every literal artifact filename written
   (e.g., `artifacts/${name}.json`, hard-coded `artifacts/brief.json`,
   etc.). Use AST parsing if regex is brittle.
2. For each, asserts `schemas/video/artifacts/<name>.schema.json` exists.
3. Walks `schemas/video/artifacts/` and asserts every schema has at least
   one writer in `src/video/`.
4. Exits non-zero on either drift direction.

Add to `check:release-readiness-lite`.

**First-run output (today) would surface:**

- **7 writers without schemas:** add schemas for `director-seedance-plan`,
  `gobananas-character-brief`, `gobananas-character-iteration-requests`,
  `image-smoke-test`, `post-plan`, `reference-board`, `review-ui-ledger`,
  `storyboard-still-generation-requests`, `storyboard-stills-plan`. (Or
  consolidate those that should be one artifact.)
- **2 orphan schemas:** `clone-plan` (no writer in core; maybe in
  videoclaw legacy?), `analyze-output` (writer exists per
  `analyze-output.ts` but no project has produced one — verify writer
  is reachable from CLI).
- **1 location drift:** `reference-sheets.json` written to
  `references/` instead of `artifacts/`. Decide canonical location and
  fix.

---

## B7. What this means for the merge

This material slots into the existing plan as follows:

- **Phase 0 (foundation):** when copying `vclaw-video-core/projects/` in,
  **skip the `projects/` directory entirely.** Don't migrate any of the
  4 existing projects. Add the gitignore template from B2.2 at repo
  level under `videoclaw-v2/.gitignore` and have `vclaw video init`
  scaffold the per-project version.
- **Phase 0:** add slug validation (B4) to `src/cli/vclaw.ts` `init`
  command before any directory is created. Add a unit test that asserts
  `vclaw video init --project foo` errors out cleanly.
- **Phase 3 (after skill consolidation):** add the schema-coverage
  guardrail (B6) and let it surface the drift list. Fix the easy ones
  (location drift for `reference-sheets`; rename `outputs/.vclaw-jobs/`
  to `.vclaw/jobs/`); leave the larger schema additions as follow-up
  issues since they need product input on canonical shape.
- **Phase 4 (docs):** write `docs/PROJECT_LAYOUT.md` from B2 + B3 as
  the canonical contract. Update `docs/MIGRATION.md` to point legacy
  videoclaw users at `vclaw video init` (their old `projects/<slug>/`
  layout is too far off to mechanically migrate).
- **New Phase 1.5 (between vclaw-cli rename and Python curation):**
  ship the `project.json` v2 shape (B3) + the `vclaw video
  migrate-project` command for any existing v1 projects users want to
  bring forward.

---

## B8. Updated effort impact

| Phase | Previous estimate | **Updated** | Delta reason |
|---|---|---|---|
| Phase 0 | 30-60 min | 30-60 min | unchanged |
| Phase 1 (vclaw-cli + providers) | 5-7 h | 5-7 h | unchanged |
| **Phase 1.5 (project.json v2 + migrate)** | — | **3-4 h** | new |
| Phase 2 (Python) | 2-3 h | 2-3 h | unchanged |
| Phase 3 (skills + schema guardrail) | 8-10 h | **10-12 h** | +2h for schema guardrail + fix easy drift |
| Phase 4 (docs) | 3-4 h | **4-5 h** | +1h for PROJECT_LAYOUT.md |
| Phase 5 (retire) | 30 min | 30 min | unchanged |
| **Total active work** | ~2.5-3.5 days | **~3.5-4.5 days** | +1 day for projects-layer hardening |

Wall clock with verification: **5-8 working days.**

---

## B9. Open question

15. **Schema additions vs consolidations.** The 7 currently-schemaless
    artifacts (`director-seedance-plan`, `gobananas-character-brief`,
    `gobananas-character-iteration-requests`, `image-smoke-test`,
    `post-plan`, `reference-board`, `review-ui-ledger`,
    `storyboard-still-generation-requests`, `storyboard-stills-plan`)
    look like they fall into two camps:

    - Writers that should each grow a schema: `director-seedance-plan`,
      `post-plan`, `reference-board`, `review-ui-ledger`,
      `storyboard-stills-plan`.
    - Writers that are probably noise / debugging output that shouldn't
      be in `artifacts/` at all: `image-smoke-test` (sounds like a test
      asset), `storyboard-still-generation-requests` and
      `gobananas-character-iteration-requests` (sound like request
      payload logs that belong in `notes/` or `.vclaw/`).

    Need a per-artifact judgement call before Phase 3's guardrail can
    pass green. Plan to defer this decision to a focused "artifact
    triage" pass at the start of Phase 3.

---

# Addendum C — Final corrections + missed pieces

Third-pass verification surfaced several plan errors and three under-covered
areas (Review UI, CI workflows, veo-cli docs). Corrections below override
earlier sections where they conflict.

## C1. Plan corrections (things the earlier sections got wrong)

### C1.1 Rust crates **do not exist in the repo**

Earlier sections (§3, §5.2, §7) repeatedly list "5 Rust crates" to drop:
`omx-explore`, `omx-sparkshell`, `omx-mux`, `omx-runtime`, `omx-runtime-core`.
**They are not in the checked-in source tree.** Verification:

```
$ find /Users/davendrapatel/Documents/GitHub/videoclaw -name 'Cargo.toml' \
    -not -path '*/target/*' -not -path '*/node_modules/*'
(no output)
```

Zero `Cargo.toml` files. Zero `crates/` directory. The repo's own CLAUDE.md
admits it: *"The root Cargo.toml workspace **may not be checked in** — CI
references individual crate manifests directly."* The `npm run build:full`
script chains `npm run build:sparkshell` which is **a TypeScript build**
(`dist/scripts/build-sparkshell.js` and `dist/cli/sparkshell.js` are
compiled JS, not Rust). The "rustfmt + clippy" CI gate, `cargo build`,
`cargo test`, and `test:compat:rust` in `package.json` all reference code
that isn't present.

**What this changes:**

- §3 ("63k of the 83k LOC is orchestration scaffolding") still stands — but
  it's all TypeScript, not TS+Rust. The "drop 5 Rust crates + Cargo
  workspace + rustfmt/clippy CI" framing is wrong; there's nothing
  Rust-shaped to drop.
- §5.2 / §7: remove "Rust crates" from the drop tables.
- §4 (target architecture): "Deliberately absent: `crates/`" is technically
  correct but not informative — better worded as "no Rust toolchain at
  all" since none was actually present.
- The argument for dropping orchestration is **strengthened**, not
  weakened: the orchestration layer is *purely TypeScript*, so the cost
  isn't even "removing a Cargo toolchain"; it's just deleting TS
  directories.

**Open question** (replaces former item 8 in §9): the `sparkshell` source
location. `dist/cli/sparkshell.js` exists but `src/` lists `autoresearch,
hud, openclaw, runtime, visual` — no `src/sparkshell/`. The TS source must
live somewhere (likely `src/cli/sparkshell.ts` or under `src/runtime/`).
Confirm during Phase 0 walkthrough; either way it's being dropped, so this
is informational only.

### C1.2 `.env` is safely gitignored, never committed

Earlier note suggested treating `.env` as a security carry-over concern.
Verification:

```
$ cd videoclaw && git log --all --oneline -- .env
(no output — never tracked)

$ git ls-files | grep .env
scripts/video/.env.example     ← only the template is tracked
```

The `.env` exists on local disk only and is properly in `.gitignore`. **No
git-history-purge needed.** The first line is just a comment header.
Confirm during Phase 0 by checking the cleanroom copy has no `.env` at all.

### C1.3 Python test count was 27, not 405

The first orchestration investigation cited "405 pytest tests" in
`scripts/video/tests/`. That number was hallucinated. Actual:

```
$ find videoclaw/scripts/video/tests -name '*.py' | wc -l
27
```

Real per-language test counts:

| Repo | TS test files | Python test files |
|---|---|---|
| videoclaw | 271 (across 34 `__tests__/` dirs) | 27 |
| vclaw-video-core | 118 (flat `src/tests/`) | 0 |

**What this changes:** §5.3 said "the 405-test pytest harness" — replace
with "the 27-test pytest harness." The triage is easier than implied —
port the ~15-20 that exercise compose/chain/critique only and drop the
rest. Phase 2 effort estimate (2-3 h) remains valid; if anything it's
faster now.

### C1.4 `agents/` directory does not exist in videoclaw

Earlier text (§5.2 "Do not take" list) included
`src/agents/` from videoclaw. There is no top-level `agents/` directory in
videoclaw at all — the agent persona prompts live in `prompts/` (19 files,
all orchestration-flavored, all confirmed dropped). Nothing to remove from
the plan; just don't list `agents/` as something we're skipping since it's
not there.

---

## C2. Review UI — promote to first-class capability

The Review UI deserves its own section. It is the active development
surface in `vclaw-video-core` (last 10 commits are 100% about it) and is
how an *operator* actually drives the project through the still-image
review gate.

### C2.1 What it is

- **Server**: `vclaw video review-ui --project <slug> --root .` boots an
  HTTP server on `127.0.0.1:4317`.
- **UI**: single-file `tmp/review-station/index.html` (4194 lines, vanilla
  HTML/CSS/JS). Listed in `package.json` `files:` so it ships in the npm
  package.
- **Backend**: `src/video/review-ui.ts` implements the HTTP server +
  REST endpoints (`GET /api/review-inventory?project=<slug>`,
  `POST /api/review-decision?project=<slug>`).
- **Companion command**: `vclaw video review-autopilot --project <slug>
  --root .` does an agent-driven run through the same workflow — selects
  best stills, locks them, fills Seedance reference roles, writes the
  same artifacts. "Just do it" mode.

### C2.2 What it does

Reviews the **still-image phase only** (characters, references, storyboard
stills, 4k still handoff, motion planning). It does **not** generate final
videos. Workflow:

```
1. Inventory      — verify project/characters/templates/refs are loaded
2. Characters     — pick saved character OR queue Go Bananas iteration
3. References     — assign each reference a job (identity / lookdev /
                    background / prop / start-frame / end-frame)
4. Storyboard     — per scene: queue prompt → paste URL → review →
                    reject bad candidates → lock best → attach 4k upscale
5. Motion Plan    — confirm Seedance instructions (control-pass,
                    start-end-frame-chain, bridge-hard-actions, etc.)
6. Assembly       — approve pacing + final handoff checks

Final gate format:
pass · locked 4/4 · character mismatches 0 · 4k assets 4/4 · publish ready
```

### C2.3 What this means for the merge

The original plan mentions `tmp/review-station/index.html` once in §5.1
("KEEP AS-IS"). That undersells it. Updates:

1. **§4 architecture diagram**: add `tmp/review-station/index.html` and
   `src/video/review-ui.ts` as a first-class line item, not a side note.
2. **Phase 0 smoke**: after the foundation copy, verify
   `vclaw video review-ui --project <test-slug>` starts the server,
   `curl http://127.0.0.1:4317/api/review-inventory?project=<test-slug>`
   returns valid JSON, and the HTML loads in a browser. Add this to the
   release-readiness-lite check.
3. **§4 docs**: add `docs/REVIEW_UI_STORYBOARD_WORKFLOW.md` and
   `docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md` to the
   recommended-reading list. Both are operator-facing runbooks for this
   surface.
4. **§11 "definition of done"** add: "`vclaw video review-ui` and
   `vclaw video review-autopilot` both complete a full Inventory →
   Assembly cycle on a test project."
5. **package.json `files:` array** must include `tmp/review-station/**`
   (or relocate to a less ambiguous path — `tmp/` is a weird home for
   shipped assets; consider `assets/review-station/index.html`).
6. **The 4194-line single-file HTML** is large but manageable. Don't
   refactor it during the merge — preserve verbatim. If it ever needs to
   become multi-file, do that in a separate change after v2 is shipped.

---

## C3. CI workflow port-list

Earlier §4 says "simplified from both" but doesn't enumerate. Concrete
inventory:

| Source | Workflow | What it does | Disposition |
|---|---|---|---|
| videoclaw | `ci.yml` | Biome lint + tsc + node:test + Rust(absent) + coverage gates + sparkshell | **PORT** — strip Rust + sparkshell + coverage:team-critical gates; keep biome/tsc/node:test/coverage:ts:full. |
| videoclaw | `docs.yml` | Build + deploy VitePress docs-site to GitHub Pages | **DEFER** — docs-site is dropped in v2 per §4; resurrect this workflow if/when docs-site comes back. |
| videoclaw | `pr-check.yml` | Lightweight PR gate (lint + typecheck only, no full test) | **PORT** — fast-feedback loop on PRs is valuable. |
| videoclaw | `release.yml` | npm publish + tag/release automation | **PORT** — adapt for the renamed package (still `videoclaw` on npm) and v0.12.0 starting version. |
| vclaw-video-core | `ci.yml` | Build + test + smoke harnesses + guardrails | **MERGE INTO PORTED ci.yml** — core's smoke suite (7 smokes + 5 check-* guardrails) replaces videoclaw's now-deleted sparkshell/Rust gates. |

**Net CI surface for v2** = 3 workflows: `ci.yml` (full build+test+smoke
on Node 20 + 22), `pr-check.yml` (fast lint+typecheck), `release.yml`
(publish on tag). Total complexity well under videoclaw's current 4-file
setup.

---

## C4. `veo-cli/docs/` — 5 docs that must port with the rename

Earlier §A3 mentioned `veo-cli/docs/GOOGLE-FLOW-V1.md` as the canonical
Flow V1 reference but didn't inventory the rest. Full list:

```
veo-cli/docs/API-REFERENCE.md              — internal API surface
veo-cli/docs/GOOGLE-FLOW-V1.md (241 lines) — Flow V1 + Omni Flash model lineup,
                                              cost matrix, voice presets
veo-cli/docs/PROVIDER-PLATFORM-ROLLOUT.md  — provider rollout history/decisions
veo-cli/docs/USEAPI-BACKEND.md             — UseAPI backend internals
veo-cli/docs/USEAPI-SETUP.md               — UseAPI setup runbook
```

**Action:** all 5 port verbatim to `vclaw-cli/docs/` during the rename.
Update the `creative-brief` skill's reference from
`veo-cli/docs/GOOGLE-FLOW-V1.md` → `vclaw-cli/docs/GOOGLE-FLOW-V1.md`.
Grep the merged repo for other references after the rename:

```bash
grep -rn 'veo-cli/docs' videoclaw-v2/ --include='*.md' --include='*.ts'
```

---

## C5. Linter / TS config consolidation

| Concern | Source | Take from | Notes |
|---|---|---|---|
| `biome.json` | only in **videoclaw** | videoclaw | core has no biome config; videoclaw's is the only one. Copy verbatim. |
| `tsconfig.json` | both | core (base) | Diff: videoclaw adds `"exclude": ["node_modules", "dist"]`. Port the `exclude` line — more robust than relying on tsc defaults. |
| `tsconfig.no-unused.json` | only in **videoclaw** | videoclaw | Used by `npm run check:no-unused` (separate gate for unused-variable lint). Useful — port. |

---

## C6. `.impeccable.md` — brand/design contract

Located at `videoclaw/.impeccable.md`. 2 KB. Defines the brand identity
(Criterion Collection meets Stripe documentation, fox mascot "Vix", warm
paper / ink black palette, vermilion accent, signal blue links).

**Disposition:** port if you plan to resurrect the docs-site or want
README visuals to follow a consistent style. **Skip** if v2 ships purely
as a TS package without marketing surface.

Recommendation: port. The brand work was done; not preserving it means
re-doing it later when you decide you want docs. It's 2 KB.

---

## C7. Test strategy for v2 (replaces §5.3 and parts of §11)

Real per-repo counts:

| Repo | TS tests | Python tests | Smokes / e2e |
|---|---|---|---|
| videoclaw | 271 across 34 `__tests__/` dirs | 27 in `scripts/video/tests/` | 1 packed-install + sparkshell tests |
| vclaw-video-core | 118 in flat `src/tests/` | 0 | 7 smokes + 5 guardrails |

### C7.1 Inheritance

- **Take core's 118 TS tests verbatim.** They follow the convention
  `cli-<name>.test.ts` for CLI E2E + `<module>.test.ts` for module
  contracts. Sample: `cli-archive-project, cli-artifact-history, cli-brief,
  cli-candidates-migrate, cli-character-auto-create, cli-character-consistency,
  cli-character-import-library, cli-characters, cli-clone-execute,
  cli-clone-init, cli-cost-estimate, cli-create, ...` — strong coverage of
  the CLI surface.
- **Take core's 7 smokes + 5 guardrails verbatim.** Already documented in
  §5.1.
- **From videoclaw's 271 TS tests, port only:** any tests under
  `src/video/__tests__/` that exercise behaviors core doesn't yet test
  (Google Flow / Omni Flash specifics, the `production-executor.ts`
  edge cases that get ported to v2). Drop everything under `src/team/`,
  `src/ralph/`, `src/ralplan/`, `src/mcp/`, `src/hooks/`, `src/state/`,
  `src/sparkshell/` — orchestration tests.
- **From videoclaw's 27 Python tests, port ~10-15** that exercise the
  curated subset from §5.3 (compose / chain / critique / hooks). Drop the
  rest.

**Estimated v2 test inventory at end of merge:** ~140-160 TS tests + 10-15
Python tests + 7 smokes + 5 guardrails. Healthy starting point.

### C7.2 Coverage gates for v2

Earlier plan §A6 open-question #7 asked about coverage thresholds. Now
decided:

| Subsystem | Threshold | Reporter |
|---|---|---|
| `dist/video/` (the core domain) | 70% lines, 80% functions, 60% branches | text-summary + lcov + json-summary |
| `dist/cli/` (entrypoints) | 60% lines, 70% functions | same |
| Full `dist/` | 60% lines (advisory, non-blocking) | same |

Lower than videoclaw's 78%/90%/70% (which targeted `dist/team/` +
`dist/state/`). The video domain has more provider-specific code that's
hard to unit-test (network, external APIs); 70% is achievable.

Script: `npm run coverage:video-core` (gating) +
`npm run coverage:ts:full` (advisory).

---

## C8. Updated plan summary after all addenda

The merge plan now has three corrective addenda. Pick-list summary:

| Topic | Where | Decision |
|---|---|---|
| Foundation | §4 | vclaw-video-core, verbatim |
| Orchestration | §3 | Drop (no Rust to drop either — TS only) |
| Providers (transporters) | A2 | videoclaw's rich schema + core's adapter runtime + Runway/Kling scaffolds |
| veo-cli → vclaw-cli | A3 | Rename, drop Convex, keep puppeteer-real-browser, port 5 docs (C4) |
| Skills (33 common) | A1 | TAKE_B for all disputed except creative-brief (MERGE for Flow V1 / Omni Flash matrix) and movie-director (MERGE for 10 reference assets) |
| Skills (18 core-only) | §6.2 | Take verbatim |
| Skills (3 videoclaw-only) | §6.3 | Port (re-verify presenter-video isn't redundant with 4 core presenter skills) |
| Schemas | A2.4 | Core's 13 verbatim; add 7 new schemas for the schemaless artifacts (B6) |
| Templates / playbooks / references / prompts / agents | A4 | Drop top-level templates + prompts + agents; keep core's playbooks + references/video/ |
| Projects layout | B2 | Empty `projects/` in v2; canonical contract enforced by init |
| `project.json` v2 | B3 | schemaVersion 2 + pipelineRef + createdBy + tags |
| Review UI | C2 | First-class; smoke-tested in Phase 0; ships via package.json `files` |
| CI | C3 | 3 workflows (ci.yml, pr-check.yml, release.yml); no Rust, no docs.yml |
| Linter / tsconfig | C5 | videoclaw's biome.json + tsconfig.no-unused.json; core's tsconfig.json + exclude line |
| Brand | C6 | Port `.impeccable.md` if keeping docs surface |
| Tests | C7 | Core's 118 TS + 7 smokes + 5 guardrails as base; cherry-pick ~25-35 from videoclaw |
| Coverage gates | C7.2 | 70/80/60 on dist/video/; 60/70 on dist/cli/; full-dist 60 advisory |

**Final effort estimate:** unchanged from B8 — **3.5-4.5 days active /
5-8 days wall clock.** C-series corrections don't add work; they simplify
some (no Rust to drop) and clarify others (Review UI was already in §5.1's
KEEP list).

---

## C9. Open questions resolved in this pass

- ~~Q8 (sparkshell source location)~~ → informational only; dropped either
  way; minor pre-Phase-0 grep to confirm.
- ~~Q11 (Convex migration check)~~ → no user state in Convex per the
  veo-cli code structure; safe to drop without migration. Confirm by
  asking the user if they have a Convex deployment in use.

Still open from earlier:
- Q1 (git history strategy — recommend fresh init)
- Q2 (`production-executor.ts` audit — must do before Phase 1)
- Q9 (`seedance-useapi` route — diff during Phase 1)
- Q10 (Runway/Kling: working adapters or stay scaffolds?)
- Q12 (`movie-director` references overlap with `references/video/`)
- Q13 (`youtube-audio` and `studio-mode` diff-check)
- Q14 (skill catalog format — enrich with `category` + `core` fields?)
- Q15 (artifact triage — 7 schemaless artifacts: schema, drop, or relocate)

---

# Addendum — Commercial Track + Quantified Prompt-Craft (phases A–F) — DONE

> **Status: DONE / landed on `main`** (phases A–D and E–F merged). This
> programme sits on top of the merged foundation above and is the current
> production-facing prompt-craft surface. The architecture-level write-up lives
> in `docs/ARCHITECTURE.md`; this addendum is the merge-plan ledger of what
> shipped.

This programme generalised the prompt-craft layer from "cinematic character
video" to a quantified, category-driven surface that also covers commercial /
product work, and locked Seedance character/product identity through the
official Asset Library. All six phases are implemented and on `main`.

- **Phase A — Standing prompt rules + quantified cinematography (DONE).**
  `src/video/prompt-rules.ts` (pure scrubbers: `stripProperNames`,
  `brandNeutralize`, `noFaceMorphTag`, `diegeticAudioLine`) and
  `src/video/cinematography.ts` (detail-leveled emitters `cameraSpec` /
  `lightingSpec` / `gradeSpec` / `audioMix` at `terse | standard | rich`).

- **Phase B — Cinema modes + hook library (DONE).** In `cinematography.ts`:
  five `CINEMA_MODE_IDS` (`narrative`, `studio`, `action`, `performance`,
  `atmospheric`) via `cinemaMode` / `stackModes` (intercut shots never merged),
  `resolveCameraVocab`, six named 2-second `HOOK_PATTERN_IDS`
  (`resolveHookPattern` / `hookBeat`, throw-on-unknown), per-genre
  `genreDefaults`, beat-template `beats()`, and `orbitGrammar` (3 `ORBIT_KINDS`).

- **Phase C — Category Descriptor registry (DONE).**
  `src/video/category-registry.ts`: nine `CATEGORY_IDS` each with a
  `subjectType` of `character` or `product`, a `beatTemplate`, `cameraVocab`,
  `genre`, `audioProfile`, and `hookSeconds`. `resolveCategory` (default
  `cinematic`) drives which branch `filmmaking-prompts` takes. `referenceBuildOrder`
  fixes the identity-reference build order (`base-ref → sheet → scene-plate`).

- **Phase D — Commercial / product track (DONE).**
  `src/video/product-references.ts` reads `artifacts/product-references.json`
  (degrades to description-only when absent). `filmmaking-prompts.ts` branches
  on `descriptor.subjectType === 'product'` into a product path (no character
  sheets / no grid lock; text-driven Seedance packets following the descriptor's
  beat template, with orbit grammar for orbit/turntable vocabularies).

- **Phase E — Multi-shot output formats + two-phase gate (DONE).**
  `multi-shot-prompt.ts` adds `composeSeedanceParagraph` (Seedance native
  paragraph), `composePerShotFormat` (per-shot blocks), `withDialogue` /
  `parseDialogueLine` (two-speaker dialogue), and `composeBilingual`
  (`en | zh | en+zh`). Surfaced through `vclaw video multi-shot --plan` flags
  `--format default|seedance-paragraph|per-shot`, `--lang en|zh|en+zh`,
  `--hook <patternId>`, `--dialogue "<speaker>: <line> [|| <speaker>: <line>]"`,
  `--category <id>`. `filmmaking-prompts` gains a two-phase gate
  `--phase storyboard|video` (storyboard phase gates `seedancePackets` to `[]`).

- **Phase F — Seedance Asset Library end-to-end (DONE).**
  `src/video/seedance-asset-library.ts` (`vclaw video seedance-register-assets`)
  registers character images as managed Asset Library avatars, waits for
  international-profile sync, and writes `artifacts/seedance-assets.json`
  (schema `schemas/video/artifacts/seedance-assets.schema.json`). At runtime
  `execution-runtime.ts` reads it (only for `recommendedRouteId ===
  'seedance-direct'`) and auto-resolves each scene's cast names to `Asset://`
  URIs as that scene's reference set; `native-seedance.ts` routes `Asset://`
  references into `reference_images` and enforces the reference budget
  (`assertReferenceBudget`: ≤9 image, ≤3 video, ≤3 audio) before any submit.

*End of plan.*



