---
name: movie-director
description: Create any short film via VideoClaw Director mode — interview-driven, auto-mode, or CLI-hybrid. Covers 12 genres (action-thriller, storybook, documentary, UGC-ad, music-video, romance, horror, sci-fi, fantasy, western, short-film, custom). Handles cast building with Go Bananas library lookup or auto-creation, 10 style presets × 9 color gradings, Seedance-safe prompt engineering with content-filter auto-fix, multi-key Gemini rate-limit rotation, and the storyboard-review gate that never burns Seedance credits until user approves. Includes scripts for verification, interview, auto-mode, cost estimation, iteration, and narrated re-mux.
---

# Movie Director Skill

End-to-end movie production via VideoClaw Director mode. Drives the pipeline (script LLM → Go Bananas character refs → Gemini-batched beat decomposition → chained Seedance clips → TTS narration → stitched final) with structured UX for any genre.

## Positioning

Use `skills/video-framework/SKILL.md` as the generic front door for broad video
requests.

Use `movie-director` when:

1. the request is explicitly cinematic, narrative, or multi-genre film work
2. the user benefits from the structured interview/auto/hybrid entry modes here
3. the task needs the deeper genre/style/reference material bundled with this
   skill

## Value Proposition

Seedance credits cost real money (~$0.40/clip). Character-identity drift is the #1 failure mode. This skill is the insurance policy:

- **Preflight gate** catches character/script issues before the LLM decomposes
- **Storyboard gate** writes human-readable audit before any Seedance burn
- **Cost estimator** surfaces dollar amounts before approval
- **Iteration flow** lets you regenerate the storyboard cheaply (~$0.03 LLM tokens) until it reads right
- **3-key Gemini pool** eliminates 429 rate-limit failures
- **Content-filter auto-fix** prevents Seedance rejection cascades

In short: you never pay Seedance for a bad storyboard.

## When to Use

Trigger on:
- "make me a movie / video / short film / ad"
- Multi-scene narrative (2+ characters, story beats)
- Any of 12 genres: action-thriller, storybook, documentary, UGC, music-video, romance, horror, sci-fi, fantasy, western, short-film, custom
- Runtime targets >30s
- "director mode", "chained clips"
- Explicit story-driven creative work

Skip for:
- Single-image portrait generation (use `go-bananas` skill)
- Real-time video editing (out of scope)
- Parallel per-scene I2V / Storyboard mode (different workflow)

## Core Invariant

**Never run Seedance before the user approves `storyboard.md`.** The gate is the product.

## Three Operation Modes

### Mode A — Step-by-Step Interview (default for first-time / uncertain users)

```bash
bash skills/movie-director/scripts/interview.sh
```

Asks 10 structured questions, offers menus + defaults, assembles `project.yaml`, runs Phase 1 → approval → Phase 2 → mop-up.

Question order:
1. Premise (one-liner)
2. Genre (12 options, each with defaults)
3. Runtime → scene count via 15s/clip
4. Platform (YouTube 16:9, TikTok 9:16, Reels, Shorts, LinkedIn)
5. Visual style (filtered by genre)
6. Color grading (filtered by style)
7. Cast (loop — library lookup OR auto-create each)
8. Setting (optional)
9. Story shape (auto / scene-by-scene / 3-act)
10. Review draft intent prose

### Mode B — Auto (power users / one-liner to finished storyboard)

```bash
bash skills/movie-director/scripts/auto.sh "A lonely astronaut discovers an alien flower on Mars"
```

Infers genre from premise keywords, fills all other fields with defaults, runs through to storyboard gate. User only confirms at approval.

### Mode C — Hybrid CLI (scripted / CI-ready)

```bash
VIDEOCLAW_APPROVE_STORYBOARD=1 DIRECTOR_AUTO_FIX_CONTENT=1 \
  vclaw video create "<premise>" \
  --scenes 14 --production-mode director \
  --style villeneuve --color-grading neon-noir --platform youtube \
  --gb-character "Name1:ID1" --gb-character "Name2:ID2" --execute
```

Direct invocation. Good for automation or experienced users who know exactly what they want.

## Scripts Included

| Script | Purpose |
|---|---|
| `scripts/verify.sh` | API pings + env check before starting (30 seconds) |
| `scripts/interview.sh` | Interactive step-by-step movie builder |
| `scripts/auto.sh` | One-liner → storyboard via genre inference |
| `scripts/run-pipeline.sh` | Three-phase runner (storyboard → approve → render → mop-up) |
| `scripts/iterate.sh` | Cheap storyboard regeneration after prose edit (no Seedance cost) |
| `scripts/list-library.sh` | Browse Go Bananas character library |
| `scripts/remix-narrated.sh` | Fix `moov atom not found` on narrated final |
| `scripts/cost-estimate.sh` | Dollar-amount estimator before render |

## Reference Documentation

Deep reference docs in `references/`:

| File | Content |
|---|---|
| `references/genres.yaml` | 12 genres × (style presets, grading, scene count, tone, act structure, platforms, adversary type) |
| `references/styles.md` | 10 director styles × 9 color gradings + compatibility matrix |
| `references/seedance-techniques.md` | Hooks, cameras, lighting, timelines, 3-control-levels, anti-patterns |
| `references/advanced-prompting.md` | Shot framing, camera grammar, lighting grammar, materials, genre hook recipes |
| `references/character-archetypes.md` | Templates by archetype (child, adult, elder, animal, spectral, tech) |
| `references/prompt-recipes.md` | Per-genre intent prose templates |
| `references/character-creation.md` | 8-field description template + creation commands |
| `references/cheatsheet.md` | Quick reference for experienced users |
| `references/troubleshooting.md` | Every failure mode with root cause + fix |
| `references/memory-learnings.md` | 30+ production runs distilled into rules |
| `references/examples/*.yaml` | 9 fully-filled example projects |

## Example Projects (ready-to-run templates)

| File | Genre | Demonstrates |
|---|---|---|
| `komo-thriller.yaml` | action-thriller | Full 14-scene arc with content-filter-safe climax |
| `riley-storybook.yaml` | storybook | Miyazaki watercolor, 2 new characters, gentle pacing |
| `docufilm-portrait.yaml` | documentary | Day-in-the-life, single subject, 10 scenes |
| `music-video.yaml` | music-video | Wong Kar-wai mood-over-plot, no dialogue |
| `horror.yaml` | horror | Dread buildup with content-filter-safe language |
| `sci-fi.yaml` | sci-fi | Villeneuve epic world-building |
| `ugc-ad.yaml` | UGC | TikTok vertical, testimonial format |
| `fantasy.yaml` | fantasy | Miyazaki quest, magical companion |
| `western.yaml` | western | Tarantino retro, showdown arc |
| `romance.yaml` | romance | Wes Anderson symmetric, meet-cute |
| `brand-story.yaml` | brand narrative | Product-secondary heritage story |

## Character Preflight (always runs before Phase 1)

For every named character in the user's story:

1. **Library check** — `vclaw video library clean --name-regex "^<Name>$" --dry-run`
2. **Archetype match** — reject if library entry's archetype contradicts user's intent
3. **Auto-create option** — generate 50-80 word description from the 8-field template, then run `vclaw video character-auto-create --project <slug> --input <json>`
4. **Track IDs** — accumulate into `--gb-character` flags

See `references/character-archetypes.md` for the 8-field template and examples per archetype.

## Required Environment

Run `scripts/verify.sh` to validate:

| Variable | Purpose | If missing |
|---|---|---|
| `GOOGLE_API_KEY` | Script LLM | HARD FAIL — script gen can't run |
| `GEMINI_API_KEYS` | Decomposer pool (3+ keys from different GCP projects) | Fallback to single `GOOGLE_API_KEY`; 429s possible |
| `GO_BANANAS_API_KEY` | Character library + image gen | Character refs can't hydrate |
| `SUTUI_API_KEY` | Asset Library (last-frame chaining) | Chain breaks → clip identity drifts |
| `ELEVENLABS_API_KEY` | TTS narration | Narration silently skipped (non-fatal) |

## Control Flags

| Flag | Effect |
|---|---|
| `VIDEOCLAW_APPROVE_STORYBOARD=1` | Skip gate → fire Seedance |
| `DIRECTOR_AUTO_FIX_CONTENT=1` | Auto-substitute hazards (enabled by default in scripts) |
| `SKIP_DIRECTOR_PREFLIGHT=1` | Bypass preflight — NOT recommended |
| `SEEDANCE_CLIP_DURATION_SEC=N` | Override clip duration (5–60s) |
| `GEMINI_RPM_THROTTLE_MS=N` | Inter-scene throttle (default 4500ms, single-key fallback) |

## Cost Expectation

Estimate before approval via `scripts/cost-estimate.sh`:

```
$ scripts/cost-estimate.sh 14 15 0 true

=== Movie Director — Cost Estimate ===
  Seedance:          $0.40 × 14 = $5.60
  Gemini (all):      $0.03
  Go Bananas chars:  $0.00 (no new)
  ElevenLabs TTS:    $0.14
  ────
  Total:             ~$5.77
  Wall time:         ~61 min
```

Pricing by genre (typical):

| Genre | Scenes | Total |
|---|---|---|
| UGC-ad (1:30) | 10 × 9s | ~$2.65 |
| Documentary (2:30) | 10 × 15s | ~$4.17 |
| Romance / horror (3:00) | 12 × 15s | ~$5.00 |
| Thriller / sci-fi (3:30) | 14 × 15s | ~$5.77 |
| Fantasy / short-film | 14 × 15s | ~$5.87 |
| Music video (2:48) | 14 × 12s | ~$4.60 |

## Iteration Feedback Map

After rendering, map user complaints to cheap fixes (LLM tokens only, no Seedance burn):

| Complaint | Fix |
|---|---|
| Middle drags | Tighten beats 5-9 in intent prose; add location variety |
| Character inconsistent | PATCH library base_prompt OR delete+recreate character |
| Style drifts clip-to-clip | Verify character refs all Asset://; re-run |
| Emotion unearned | Add a beat that sets up the emotion (near-miss before cost) |
| Pronouns mixed | Add explicit pronouns to character's base_prompt |
| Climax flat | Soften content-filter hazards; use "intertwine" not "clash" |
| Wrong character in wrong scene | Adjust intent prose so names appear in correct beats |
| Seedance rejected N clips | Write more defensively; check auto-fix coverage |

Re-run `iterate.sh` with modified prose → new storyboard → re-approve → render.

## Gotchas (top 10 — see `troubleshooting.md` for full)

1. **Seedance has ~5-10% per-clip failure rate.** Target N+2 scenes to land N.
2. **`moov atom not found` on narrated.mp4** — run `remix-narrated.sh`.
3. **Single-key Gemini 429 on 14-scene run.** Add 3+ keys to `GEMINI_API_KEYS`.
4. **Content-filter hazards** (weapons/combat) reject clips. `DIRECTOR_AUTO_FIX_CONTENT=1` substitutes; write defensively.
5. **HTTP last-frame + Asset:// character refs = filter cascade.** Runner drops chain for that clip; accept visual-continuity hit.
6. **Plural adversaries** ("Agents") don't need library entries — preflight skips them.
7. **Character descriptions must be 50-80 words** covering 8 fields; vague bases drift.
8. **Species drift** — use NOT clauses ("organic living creature, NOT robotic") to prevent LLM re-interpretation.
9. **Style must match character style.** Miyazaki video + photoreal character = visual mismatch.
10. **Storyboard gate is non-negotiable.** Always write + review before approving.

## Output Format

```
MOVIE DIRECTOR REPORT
=====================

Project:         <slug>
Genre:           <genre>
Premise:         <one-line>
Runtime target:  <mm:ss>  |  Actual: <mm:ss>
Scenes landed:   <N>/<total>
Style:           <style> + <grading>
Platform:        <platform>
Cast:
  - <name> (<id>, <role>) [new | existing]
  - ...

Preflight:       pre-render <PASS|FAIL> (<e>e/<w>w) · post-decomposition <PASS|FAIL>
Storyboard:      <path to storyboard.md>
Final (raw):     <path>
Final (narrated): <path>

Cost (est):      ~$<amount>
Wall time:       <hh:mm>

Failures:
  - <clip_NN>: <classification>

Next: watch → iterate on storyboard prose cheaply if anything drifts.
```

## Files the Skill Coordinates (do NOT re-invent)

| File | Role |
|---|---|
| `src/video/director-mode/runner.ts` | Director mode runner — 7 pipeline steps |
| `src/video/director-mode/storyboard-md.ts` | Storyboard markdown writer + approval gate |
| `src/video/director-preflight.ts` | 7 preflight check functions (pre-render + post-decomp) |
| `src/video/gemini-key-pool.ts` | Multi-key 429 rotation |
| `src/video/library/clean.ts` | Character library CRUD CLI |
| `vclaw video character-auto-create` | Character creation from description |
| legacy Seedance hook sourcebooks | 18 hooks, 22 cameras, 12 lighting presets, 4 timeline templates (ported as reference guidance, not local scripts) |
| legacy Seedance prompt-director patterns | 3-control-level prompt composer ideas carried into the clean-room workflow docs |
| legacy Seedance chain-manager patterns | Scene continuation ideas now expressed through the clean-room execution/runtime layer |

## Best Practices

- **Always write storyboard first, even in auto mode.** The gate is non-negotiable.
- **Offer presets before asking for custom input.** Menus > freeform typing.
- **Validate character descriptions before creation.** Use the 8-field template.
- **Show cost before approval.** Numbers make the decision easy.
- **Map complaints to cheap fixes.** Iteration uses LLM tokens only (~$0.03/run).
- **Run verify.sh before every new project.** 30 seconds to catch missing env vars.
- **Watch the storyboard prompts verbatim.** If a clip reads wrong in prose, it'll render wrong.

## Scenario Examples

**Good:** User says "make a documentary about a potter". Skill infers `documentary` genre, offers Nolan + desaturated, asks for character name/description, writes 10-scene storyboard, user approves, renders.

**Good:** User uses auto mode with one line; 9 defaults filled; 2 confirmations total (cost preview + storyboard approval). ~55 min to final.

**Good:** User iterates 3 times on storyboard (too short → add scenes, wrong tone → change grading, weak ending → rewrite beat 14) before approving. Zero Seedance burn until final approve.

**Bad:** Skill jumps to render because user says "just go". Storyboard not reviewed. ~$5 wasted. Always insist on Phase 1.

**Bad:** Character created with vague `base_prompt: "a bunny"`. Seedance drifts every clip. Use 8-field template.

## Use with Other Skills

- **`/oh-my-claudecode:plan`** — plan structured beats before the interview fills them
- **`/oh-my-claudecode:verify`** — post-render, verify character consistency via keyframe comparison
- **`video-marketing`** — optimize final for platform delivery
- **`youtube-uploader`** — publish with title/description/tags
- **`youtube-thumbnail-design`** — custom thumbnail from best keyframe

## Installation

Skill is self-contained under `skills/movie-director/`. To use:

1. Verify environment: `bash skills/movie-director/scripts/verify.sh`
2. For interactive: `bash skills/movie-director/scripts/interview.sh`
3. For auto: `bash skills/movie-director/scripts/auto.sh "your premise"`
4. For CLI: see Mode C above

All scripts expect `VIDEOCLAW_ROOT` or should be run from the current repo root.

## Version

v1.0 — initial comprehensive release (2026-04-21). Encodes 30+ production runs of learning. See `references/memory-learnings.md` for the distilled rules.

Roadmap (planned):
- Ref-image preview (pre-Phase-1 character sanity check)
- Resumable interview state (`state/session-*.yaml` carries mid-interview)
- Schema validator for character descriptions
- Skill self-test (`scripts/test-skill.sh` runs a hello-world project)
- Provider abstraction (when Runway/Luma support lands in VideoClaw)
- Branch to Storyboard mode (when parallel per-scene I2V is a better fit)
