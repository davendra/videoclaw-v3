# Skills

`videoclaw` ships a curated library of **skills** — reusable, agent-invokable workflows that
either produce a video (the *video* category) or orchestrate the work around it (the *workflow* category).
This doc is the comprehensive per-skill reference. For the machine-readable index see
[`skills/catalog.json`](../skills/catalog.json); for the full how-to of any individual skill, follow the
linked `SKILL.md` for that skill.

---

## Ecosystem map

<p align="center"><img src="./assets/diagram-skills-ecosystem.jpg" alt="Skills ecosystem map showing video-framework and brand-presenter as canonical entry points with specialist children, plus a grid of workflow skills" width="100%" /></p>

### How skills relate

The library is **not** a flat bag of equally-preferred entry points. It uses a small hierarchy:

| Role | Examples | When you reach for it |
|---|---|---|
| **Canonical entry** | `video-framework`, `brand-presenter` | Generic or unspecified video request — the entry skill routes into a specialist. |
| **Specialist** | `video-storyboard`, `video-clone-ad`, `director-video`, `video-post`, ... | The mode is clearly known up front (e.g. "clone this ad", "storyboard these 6 scenes"). |
| **Compatibility alias** | `davendra-presenter`, `nex-presenter`, `bunty` | Personal/brand presets that exist for discoverability — they all delegate into `brand-presenter`. |
| **Workflow** | `autopilot`, `ralph`, `team`, `doctor`, `pipeline`, ... | Orchestration, debugging, and ops — independent of any one production mode. |

**Rule of thumb:** start at a canonical entry, specialize only when the mode is clearly known, and treat
aliases as discovery handles rather than first-choice workflows.

---

## Skill index

| Group | Skill | Status | One-liner |
|---|---|---|---|
| 🎯 Canonical | [`video-framework`](#video-framework) | imported | OMX-native front door that routes across copy/create/narrated/presentation/long-form/film/UGC. |
| 🎯 Canonical | [`brand-presenter`](#brand-presenter) | native generic | Generic narrated presenter-video workflow over a branded host profile. |
| 🎬 Video | [`video-storyboard`](#video-storyboard) | native clean-room | Brief or clone plan → scene-by-scene storyboard artifact. |
| 🎬 Video | [`video-analyze-template`](#video-analyze-template) | native clean-room | Reference video → reusable template packet. |
| 🎬 Video | [`video-clone-ad`](#video-clone-ad) | native clean-room | Saved template → new product/brand using `clone-execute`. |
| 🎬 Video | [`video-thumbnail-lab`](#video-thumbnail-lab) | native clean-room | Final render → thumbnail + platform variants. |
| 🎬 Video | [`director-video`](#director-video) | imported | Character-consistent multi-scene Director-mode production with two-phase approval. |
| 🎬 Video | [`movie-director`](#movie-director) | imported | Short-film production across 12 genres with interview/auto/hybrid entry modes. |
| 🎬 Video | [`video-replicator`](#video-replicator) | imported (deep-surface) | 7-mode professional pipeline: COPY/CREATE/NARRATED/PRESENTATION/LONG-FORM/FILM/UGC. |
| 🎬 Video | [`video-post`](#video-post) | imported | Post-render verify, social variants, thumbnails, archival. |
| 🎭 Cast | [`character-creator`](#character-creator) | imported | Create Go Bananas characters with profile + multi-view reference sheets. |
| 🎭 Cast | [`character-library`](#character-library) | imported | Audit, list, patch, and delete entries in the shared Go Bananas library. |
| 📝 Brief | [`creative-brief`](#creative-brief) | imported | 7-question filmmaker intake → exact CLI commands. |
| 🎞️ Prompts | [`seedance-prompts`](#seedance-prompts) | imported | Browse and apply the clean-room Seedance prompt reference library. |
| 📺 Audio | [`youtube-audio`](#youtube-audio) | imported | Download audio (MP3) or video (MP4) from YouTube using `yt-dlp` + FFmpeg. |
| 📣 UGC | [`ugc`](#ugc) | imported | Belief-driven UGC campaign generator (E5 method) with multi-video output. |
| 🎤 Aliases | `davendra-presenter` · `nex-presenter` · `bunty` | aliases | All delegate into `brand-presenter` with a personal/brand profile. |
| ⚙️ Workflow | [`autopilot`](#autopilot) · [`ralph`](#ralph) · [`ralplan`](#ralplan) · [`ralph-init`](#ralph-init) | imported | Long-running autonomous execution loops. |
| ⚙️ Workflow | [`team`](#team) · [`worker`](#worker) · [`pipeline`](#pipeline) · [`studio-mode`](#studio-mode) | imported | Multi-agent orchestration and stage sequencing. |
| ⚙️ Workflow | [`doctor`](#doctor) · [`trace`](#trace) · [`build-fix`](#build-fix) · [`deepsearch`](#deepsearch) · [`deep-interview`](#deep-interview) | imported | Diagnostics, exploration, and structured deep-dive. |
| ⚙️ Workflow | [`code-review`](#code-review) · [`review`](#review) · [`security-review`](#security-review) · [`git-master`](#git-master) | imported | Review, governance, and version-control assist. |
| ⚙️ Workflow | [`ai-slop-cleaner`](#ai-slop-cleaner) · [`configure-notifications`](#configure-notifications) · [`cancel`](#cancel) · [`skill`](#skill) · [`note`](#note) · [`help`](#help) · [`hud`](#hud) · [`omx-setup`](#omx-setup) · [`web-clone`](#web-clone) | imported | Operational utilities. |

---

## 🎯 Canonical entries

### video-framework

**Role:** OMX-native front door for any "make a video" request.
**What it does:** Routes the request across the seven established workflows — COPY, CREATE, NARRATED,
PRESENTATION, LONG-FORM, FILM, UGC — by classifying the intent and reusing proven legacy engines behind
clean adapter boundaries. Picks the right specialist instead of forcing the user to.
**Key features:**
- Single intake surface for both clone-style and from-scratch video requests
- Adapter pattern preserves legacy engine quality without inheriting legacy mess
- Hands off to a specialist (storyboard, clone-ad, director-video, replicator, ugc, ...) once the mode is decided
- Useful as the default first-touch when the user's intent is ambiguous

**When to reach for it:** Any open-ended video request — *"I want to make a video"*, *"can you do a video for X?"* —
where the production mode hasn't been picked yet.

**Full guide:** [`skills/video-framework/SKILL.md`](../skills/video-framework/SKILL.md)

---

### brand-presenter

**Role:** Canonical (generic) presenter-video workflow.
**What it does:** Turns a slide deck or structured topic into an intro/slides/outro narrated presentation
using a branded host profile (avatar + voice + intro/outro framing). Personal/brand presenter skills
(`davendra-presenter`, `nex-presenter`, `bunty`) all delegate here with a different host profile.
**Key features:**
- One generic workflow with swappable brand profiles (no copy-paste forks)
- Slide-deck-aware framing (cover slide → body → call-to-action)
- Lip-synced intro/outro plus TTS narration over body slides
- Works for product explainers, internal updates, social-first brand cuts

**When to reach for it:** Anything narrated and host-led — explainers, demos, brand intros, presentation videos.
Pick a personal alias instead if a specific host identity is required.

**Full guide:** [`skills/brand-presenter/SKILL.md`](../skills/brand-presenter/SKILL.md)

---

## 🎬 Video specialists

### video-storyboard

**Role:** Brief or clone plan → explicit scene-by-scene storyboard artifact.
**What it does:** Generates a `storyboard.json` artifact with optional character-to-scene bindings.
Scenes can come from raw `--scene` strings or from a registered storyboard template; characters can be
bound per-scene with `--scene-character <sceneIndex:name>`.
**Key features:**
- Mode-aware (`storyboard` vs `director`) so the right pipeline manifest applies
- Storyboard-template aware — supports parameterised templates (environment, character A/B)
- Per-scene character binding flows into character-consistency enforcement
- Output is canonical JSON and validates against `schemas/video/`

**When to reach for it:** *"storyboard this brief"*, *"turn this plan into scenes"*, *"assign characters to scenes"*.

**Full guide:** [`skills/video-storyboard/SKILL.md`](../skills/video-storyboard/SKILL.md)

---

### video-analyze-template

**Role:** Reference video → reusable template packet.
**What it does:** Analyzes a source video (path or URL) and writes a normalized `analyze-output.json`
that can be saved as a reusable template via `template-save`. With `--auto`, drives the analysis through
the Gemini key pool to fill pacing, beats, keep/change guidance, and reusable variables automatically.
**Key features:**
- Manual mode (operator-driven beats/keeps/changes) and auto mode (Gemini-backed)
- Round-robin Gemini key rotation with per-key cooldown for resilient analysis
- Endpoint override via `VCLAW_GEMINI_API_ENDPOINT` for local Gemini-compatible targets
- Output composes directly into `template-save` → `clone-plan` → `storyboard-from-clone`

**When to reach for it:** *"analyze this video style"*, *"break this ad into reusable structure"*, *"turn this reference into a template"*.

**Full guide:** [`skills/video-analyze-template/SKILL.md`](../skills/video-analyze-template/SKILL.md)

---

### video-clone-ad

**Role:** Saved template → new product/brand via the canonical clone-execute flow.
**What it does:** Adapts a known template to a new intent while preserving execution structure
(scene count, motion, pacing). Drives the `clone-plan` → `storyboard-from-clone` → execution-seed →
`execute` chain in one logical workflow.
**Key features:**
- Template-driven so structural quality is reused, not re-derived per project
- Mode-aware (`storyboard` for fast iteration; `director` for full approval-gated runs)
- Execution-profile carrier (aspect-ratio, quality, resolution, audio, outputs) flows into the brief
- `--dry-run` lets you validate the payload shape before any provider submission

**When to reach for it:** *"clone this ad"*, *"adapt this launch ad to a new product"*, *"reuse this template for a new campaign"*.

**Full guide:** [`skills/video-clone-ad/SKILL.md`](../skills/video-clone-ad/SKILL.md)

---

### video-thumbnail-lab

**Role:** Final render → click-driving still + platform packaging pass.
**What it does:** Generates thumbnails and platform-specific variants for a finished render. Drives
`make-vertical`, `make-square`, `make-loop`, and `thumbnail` over a finished `--project` or stand-alone `--file`.
**Key features:**
- Project-aware (works against the canonical asset trail) and file-mode (works against any local mp4)
- Optional `--text <title>` for a simple overlay thumbnail
- Bundled vertical/square/loop variant helpers for cross-platform delivery
- Output naming and locations follow the canonical project layout

**When to reach for it:** *"generate a thumbnail for this render"*, *"make square and vertical promo cuts"*, *"package this final video for YouTube/Shorts/social"*.

**Full guide:** [`skills/video-thumbnail-lab/SKILL.md`](../skills/video-thumbnail-lab/SKILL.md)

---

### director-video

**Role:** Character-consistent multi-scene Director-mode production with two-phase approval.
**What it does:** Produces a multi-scene video by chaining Seedance clips with Go Bananas character refs
and an LLM scene decomposer. Always writes `storyboard.md` for review **before** burning Seedance credits;
renders only on explicit approval.
**Key features:**
- Two-phase gate: storyboard review then render (no surprise credit burn)
- Go Bananas character anchoring for identity consistency across scenes
- LLM-driven scene decomposition aware of provider safety constraints
- Produces canonical clean-room artifacts at every stage

**When to reach for it:** When the request is explicitly cinematic / multi-scene and identity consistency matters.

**Full guide:** [`skills/director-video/SKILL.md`](../skills/director-video/SKILL.md)

---

### movie-director

**Role:** Short-film production across 12 genres with structured entry modes.
**What it does:** End-to-end movie production via VideoClaw Director mode. Supports interview-driven,
auto-mode, or CLI-hybrid entry. Covers action-thriller, storybook, documentary, UGC-ad, music-video,
romance, horror, sci-fi, fantasy, western, short-film, and custom. Bundles cast building, style/color
presets, Seedance-safe prompt engineering with content-filter auto-fix, multi-key Gemini rotation, and
the storyboard-review gate.
**Key features:**
- 10 style presets × 9 color gradings × 12 genres
- Cast building via Go Bananas library lookup or auto-creation from a JSON seed
- Content-filter auto-fix for Seedance-safe prompts
- Bundled scripts: verification, interview, auto-mode, cost estimation, iteration, narrated re-mux

**When to reach for it:** Cinematic, narrative, or multi-genre film work where the bundled genre material
and entry-mode structure pays off.

**Full guide:** [`skills/movie-director/SKILL.md`](../skills/movie-director/SKILL.md)

---

### video-replicator

**Role:** Deep-reference 7-mode professional video production pipeline.
**What it does:** The legacy comprehensive pipeline: COPY (replicate/clone with subject swap),
CREATE (original from scratch), COPY NARRATED (replicate with continuous voiceover), PRESENTATION (slides
to animated video), LONG-FORM (10+ minute, 20+ scene batches), FILM (full cinematic with screenplay),
or UGC CAMPAIGN. Kept as a deep-surface reference behind `video-framework`.
**Key features:**
- 7 distinct production modes covering most real-world video asks
- SEALCAM+ video analysis for COPY workflows
- Long-form batch generation across 20+ scenes
- Image-to-video and text-to-video both supported through the same surface

**When to reach for it:** When the canonical entry has routed you here, or when an existing legacy workflow
needs the deeper reference. Otherwise prefer `video-framework` first.

**NOT for:** single image generation, FFmpeg-only scripts without the pipeline, video-player debugging,
or static slide deck creation without video output.

**Full guide:** [`skills/video-replicator/SKILL.md`](../skills/video-replicator/SKILL.md)

---

### video-post

**Role:** Post-render verification, variants, thumbnails, and archival for clean-room outputs.
**What it does:** Closes the loop after render. Verifies final outputs (codec/resolution/duration/audio
presence/midpoint frame), creates social variants (vertical / square / loop), extracts thumbnails, and
archives finished projects into a tarball with optional cleanup.
**Key features:**
- `verify-final` probes structural correctness of the render
- `make-vertical` / `make-square` / `make-loop` for platform variants
- `thumbnail` with optional `--text` overlay
- `archive-project` packages a finished project as `archives/<slug>-<timestamp>.tar.gz`

**When to reach for it:** Anything that happens **after** render — verification, packaging, distribution prep, archival.

**Full guide:** [`skills/video-post/SKILL.md`](../skills/video-post/SKILL.md)

---

### character-creator

**Role:** New Go Bananas character creation with reference sheets.
**What it does:** Creates Go Bananas characters with profile images and multi-view reference sheets so
the same character can be regenerated consistently across scenes. Inputs feed the character-consistency
subsystem and the per-project `characters/characters.json` store.
**Key features:**
- Profile image plus multi-view (front / 3/4 / side / back) reference sheet generation
- Output binds into project character profiles for downstream scene-character mapping
- Companion to `character-library` (creator owns creation; library owns audit/patch/delete)
- Triggers on natural-language asks like *"create a character"*, *"new character with reference sheet"*

**When to reach for it:** *"create a character"*, *"design a character"*, *"build a character reference"*, *"set up characters"*, *"new character with reference sheet"*.

**Full guide:** [`skills/character-creator/SKILL.md`](../skills/character-creator/SKILL.md)

---

### character-library

**Role:** Audit and hygiene for the shared Go Bananas character library.
**What it does:** Browses the library, flags polluted entries, patches base prompts in place, and deletes
bad anchors — without leaving the repo-local skill surface. Companion to `character-creator`.
**Key features:**
- `library find` for exact-name discovery from intent text
- `library clean` with dry-run candidate discovery (by ids, name regex, or bloated prompt size)
- In-place prompt patching for a single character without recreating it
- Drives the `vclaw video library` CLI surface

**When to reach for it:** *"list my characters"*, *"audit the character library"*, *"patch this drifting character"*, *"delete polluted characters"*, *"fix library hygiene before a director run"*.

**Full guide:** [`skills/character-library/SKILL.md`](../skills/character-library/SKILL.md)

---

### creative-brief

**Role:** 7-question filmmaker intake that translates creative language into exact CLI commands.
**What it does:** Bridges *"I want a luxury resort ad"* and *"make something like a Nike spot"* into the
correct `vclaw` command sequence. Asks a structured 7-question brief and emits the matching execution plan.
**Key features:**
- Filmmaker-language interview rather than CLI-language
- Output is concrete CLI commands the user can copy/paste or hand to an executor
- Triggers on creative intent ("video idea", "brand video", "short film", "make something like")
- Pairs naturally with `video-framework` as the routing layer below

**When to reach for it:** When the user describes a video in creative terms rather than as CLI commands.

**Full guide:** [`skills/creative-brief/SKILL.md`](../skills/creative-brief/SKILL.md)

---

### seedance-prompts

**Role:** Reference library and prompt-quality assistant for Seedance-targeted scene writing.
**What it does:** Browses the clean-room Seedance prompt reference library and applies current provider
guidance to Seedance prompt writing. Built on the actual `prompt-lib-list` / `prompt-lib-show` surface.
**Key features:**
- Searchable Seedance formulas, examples, and prompt-structure guidance
- Backed by prompt-library references that actually exist in this repo (no hallucinated examples)
- Triggers on *"seedance prompt"*, *"expand prompt for seedance"*, *"prompt quality"*
- Output composes into `storyboard` and `execute` flows

**When to reach for it:** When you need Seedance-specific prompt help, formulas, or examples.

**Full guide:** [`skills/seedance-prompts/SKILL.md`](../skills/seedance-prompts/SKILL.md)

---

### youtube-audio

**Role:** YouTube → MP3 audio or MP4 video using `yt-dlp` + FFmpeg.
**What it does:** Downloads audio or video from YouTube videos and playlists. Supports trimming, resolution
selection, and audio quality settings.
**Key features:**
- Single videos, playlists, or batch URLs
- Audio-only, video-only, or both in one pass
- Trim to clip ranges
- Requires `yt-dlp` and `ffmpeg`

**When to reach for it:** *"download audio from this YouTube video"*, *"grab the MP4"*, *"extract music from a playlist"*.

**Full guide:** [`skills/youtube-audio/SKILL.md`](../skills/youtube-audio/SKILL.md)

---

### ugc

**Role:** Belief-driven UGC campaign generator using the E5 method.
**What it does:** Generates a multi-video belief-targeted UGC campaign (30–60s each) from a product URL
and intent. Produces N videos with subtitles plus a campaign report.
**Key features:**
- Belief-journey decomposition (E5 method: Examine, Educate, Emote, Evidence, Empower)
- Multi-video campaign output rather than single-clip
- Per-video subtitles and aggregate campaign report
- Triggers on *"UGC campaign"*, *"belief-driven ads"*, *"E5 method"*

**When to reach for it:** When the goal is a marketing campaign rather than a single creative video.

**Full guide:** [`skills/ugc/SKILL.md`](../skills/ugc/SKILL.md)

---

## 🎤 Video aliases

These exist for discoverability and personal/brand handoff — they all delegate into `brand-presenter`
with a different host profile. Treat them as compatibility surfaces; the canonical workflow lives in
`brand-presenter`.

| Alias | Profile | Trigger |
|---|---|---|
| [`davendra-presenter`](../skills/davendra-presenter/SKILL.md) | Davendra (asset/voice) | *"davendra video"*, *"davendra presenter"* |
| [`nex-presenter`](../skills/nex-presenter/SKILL.md) | Nex (asset/voice) | *"nex video"*, *"nex presenter"* |
| [`bunty`](../skills/bunty/SKILL.md) | Bunty — cricket commentator (orange blazer) | *"bunty thing"*, *"match day analysis"*, *"cricket scorecard video"* |

---

## ⚙️ Workflow skills

Workflow skills are independent of any one production mode. They orchestrate, debug, review, or
operate on top of the production layer.

### Long-running execution loops

#### autopilot
Full autonomous execution from idea to working code. Routes through interview → plan → execution
without per-step approvals. Good for end-to-end automation when the goal is clear.
[Full guide](../skills/autopilot/SKILL.md)

#### ralph
Self-referential loop until task completion with architect verification. Iterates until the verifier
agent signs off. The boulder never stops.
[Full guide](../skills/ralph/SKILL.md)

#### ralph-init
Initializes a Product Requirements Document (PRD) for structured `ralph-loop` execution. Use this
**before** kicking off a long ralph run.
[Full guide](../skills/ralph-init/SKILL.md)

#### ralplan
Alias for `$plan --consensus`. Consensus-mode planning that gates vague autopilot/ralph requests.
[Full guide](../skills/ralplan/SKILL.md)

### Multi-agent orchestration

#### team
N coordinated agents on a shared task list using tmux-based orchestration.
[Full guide](../skills/team/SKILL.md)

#### worker
Team-worker protocol (ACK, mailbox, task lifecycle) for tmux-based teams. Pairs with `team`.
[Full guide](../skills/worker/SKILL.md)

#### pipeline
Configurable pipeline orchestrator for sequencing stages — useful when you need explicit per-stage
control rather than full autopilot.
[Full guide](../skills/pipeline/SKILL.md)

#### studio-mode
Agent-driven video production with interview → consensus plan → user approval → credit spend.
Slower-but-safer alternative to the fast one-shot `vclaw video create`. Triggered by *"$studio"* requests.
[Full guide](../skills/studio-mode/SKILL.md)

### Diagnostics & exploration

#### doctor
Diagnose and fix oh-my-codex installation issues.
[Full guide](../skills/doctor/SKILL.md)

#### trace
Show agent flow trace timeline and summary. Useful for understanding what an autopilot/team/ralph run
actually did.
[Full guide](../skills/trace/SKILL.md)

#### build-fix
Fix build and TypeScript errors with minimal changes. Conservative — does not refactor.
[Full guide](../skills/build-fix/SKILL.md)

#### deepsearch
Thorough codebase search. Use when grep/glob isn't enough and you need an agent to actually understand
the codebase as it searches.
[Full guide](../skills/deepsearch/SKILL.md)

#### deep-interview
Socratic deep interview with mathematical ambiguity gating before execution. Forces requirements
clarity before any work begins.
[Full guide](../skills/deep-interview/SKILL.md)

### Review & governance

#### code-review
Comprehensive code review pass.
[Full guide](../skills/code-review/SKILL.md)

#### review
Reviewer-only pass for `/plan --review` and cleanup artifact review.
[Full guide](../skills/review/SKILL.md)

#### security-review
Comprehensive security review on code (OWASP, secrets, unsafe patterns).
[Full guide](../skills/security-review/SKILL.md)

#### git-master
Git expert for atomic commits, rebasing, and history management.
[Full guide](../skills/git-master/SKILL.md)

### Operational utilities

#### ai-slop-cleaner
Run an anti-slop cleanup/refactor/deslop workflow. Removes the kinds of half-baked artifacts that
unsupervised agents leave behind.
[Full guide](../skills/ai-slop-cleaner/SKILL.md)

#### configure-notifications
Configure OMX notifications — unified entry point for all notification platforms.
[Full guide](../skills/configure-notifications/SKILL.md)

#### cancel
Cancel any active OMX mode (autopilot, ralph, ultrawork, ecomode, ultraqa, swarm, ultrapilot, pipeline, team).
[Full guide](../skills/cancel/SKILL.md)

#### skill
Manage local skills — list, add, remove, search, edit, setup wizard.
[Full guide](../skills/skill/SKILL.md)

#### note
Save notes to `notepad.md` for compaction resilience across long agent runs.
[Full guide](../skills/note/SKILL.md)

#### help
Guide on using VideoClaw — the in-product help surface.
[Full guide](../skills/help/SKILL.md)

#### hud
Show or configure the OMX HUD (two-layer statusline).
[Full guide](../skills/hud/SKILL.md)

#### omx-setup
Setup and configure oh-my-codex using current CLI behavior.
[Full guide](../skills/omx-setup/SKILL.md)

#### web-clone
URL-driven website cloning with visual + functional verification.
[Full guide](../skills/web-clone/SKILL.md)

---

## Adding or modifying a skill

The skill set is curated, not auto-generated. To add or modify a skill:

1. Add or edit `skills/<name>/SKILL.md` — the canonical guide for the skill
2. Update `skills/catalog.json` with the skill's id, category, status, and any
   `specializes` / `aliasOf` / `specializations` relationships
3. Add a section here in `docs/SKILLS.md` and link it from the index table
4. Run `npm run check:skill-frontdoor` to verify the repo-local skill front door stays consistent
5. Run `npm run check:cleanroom-docs` to verify clean-room-facing docs and skills don't reference stale paths

---

## See also

- [`README.md`](../README.md) — repo front door
- [`docs/CLI_REFERENCE.md`](./CLI_REFERENCE.md) — full CLI surface
- [`docs/OBSIDIAN.md`](./OBSIDIAN.md) — Obsidian operator workspace deep guide
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — layer map
- [`skills/catalog.json`](../skills/catalog.json) — machine-readable skill index
