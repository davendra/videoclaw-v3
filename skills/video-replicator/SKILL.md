---
name: video-replicator
description: |
  Reference-only documentation of the legacy 7-mode video-replicator
  surface. Do NOT use this skill to trigger work — use
  `video-framework` instead. This document is preserved as historical
  context for the modes and their parameters; the new user-facing entry
  point is `video-framework`.
---

> **DEPRECATED FOR USER-FACING USE.** This skill's auto-trigger has been
> disabled in Slice 2. The user-facing video front door is now
> [`video-framework`](../video-framework/SKILL.md). This file remains as
> reference documentation for the legacy 7-mode surface.

# Video Replicator

*Version 2.43*

Professional video production with 7 modes. Each mode has a detailed reference file — read the relevant one after selecting a mode.

## Positioning

Use `skills/video-framework/SKILL.md` as the generic front door when the user
just wants “a video” and mode selection is still part of the task.

Use `video-replicator` when:

1. the user already wants one of the detailed legacy production modes here
2. deep mode-specific reference material is useful
3. a compatibility workflow still names `video-replicator` explicitly

Treat this skill as the deep compatibility/reference surface, not the only
public entry point.

---

## CRITICAL: Go Bananas Pro Model Required

**ALWAYS use `model_id="gemini-pro-image"` when generating images with Go Bananas.**

| Model | Character Adherence | Quality | Use Case |
|-------|---------------------|---------|----------|
| **Pro** (`gemini-pro-image`) | Follows references well | High | **REQUIRED for production** |
| Standard (`gemini-flash-image`) | Ignores/distorts references | Low | Testing only |

The video production pipeline REQUIRES Pro for character and product reference adherence across scenes. The Standard model ignores references, which destroys cross-scene consistency. This override is intentional and critical.

Every `generate_image` call MUST include:
```python
model_id="gemini-pro-image"
```

---

## Mode Selection (Start Here)

**Present this choice when skill is triggered:**

| Mode | When to Use | Input Required |
|------|-------------|----------------|
| **COPY** | Have a reference video to replicate | Reference video URL/path + new subject |
| **CREATE** | Want to design original content | Product/character images + scene descriptions |
| **COPY NARRATED** | Replicate a narrated/documentary video | Reference video + narration script + voice selection |
| **PRESENTATION** | Have a slide-based video to restyle | Presentation video + style choice + animation preference |
| **LONG-FORM** | Extended video (10+ min, 20+ scenes) | Scene list + images + queue JSON |
| **FILM** | Full cinematic production from concept | Concept description OR reference video + backend choice |
| **UGC CAMPAIGN** | Belief-driven UGC marketing | Redirects to `skills/ugc/SKILL.md` |

**Auto-detect mode from user phrasing:**
- "copy this ad" / "replicate this video" / "clone this reel" → **COPY**
- "create a video" / "make something new" / "video from scratch" → **CREATE**
- "copy with narration" / "replicate with voiceover" / "explainer video" → **COPY NARRATED**
- "restyle presentation" / "animate my slides" / "PowerPoint video" → **PRESENTATION**
- "long video" / "10 minute video" / "batch generate" / "20+ scenes" → **LONG-FORM**
- "make a film" / "cinematic ad" / "screenplay to video" / "concept to film" → **FILM**

After selecting a mode, **read the corresponding reference file** for the detailed workflow:

| Mode | Reference File |
|------|---------------|
| COPY | `references/copy-mode.md` (includes full 6-phase pipeline, SEALCAM+ analysis, title cards, CTA banners) |
| CREATE | `references/create-mode.md` (includes interactive wizard, storyboard grid workflow) |
| COPY NARRATED | `references/narrated-mode.md` (includes scene classification, TTS, voice change pipeline) |
| PRESENTATION | `references/presentation-mode.md` (includes PDF extraction, animation styles, dual export) |
| LONG-FORM | `references/longform-mode.md` (includes batch orchestration, queue planning, overnight generation) |
| FILM | `references/film-mode.md` (includes screenplay generation, Seedance time-segments, cinematic quality flags) |

---

## Aspect Ratio Decision Tree

**Choose aspect ratio BEFORE generating images. All images in a project must share the same ratio.**

```
LANDSCAPE 16:9 (YouTube, Ads, Web)
  ✓ Use I2V mode (image-to-video) — works reliably
  → Go Bananas: aspect_ratio="16:9"
  → veo-cli: --ratio landscape

PORTRAIT 9:16 (TikTok, Reels, Shorts)
  ⚠ I2V API returns INVALID_ARGUMENT for portrait
  → Use T2V mode (text-to-video) instead
  → Or use Flow UI directly (I2V portrait works there, not via API)
  → Go Bananas: aspect_ratio="9:16"
  → veo-cli: --ratio portrait (T2V only)

SQUARE 1:1 (Instagram Feed)
  → Generate landscape, crop to square via FFmpeg
```

### Portrait I2V Limitation

The direct API returns `INVALID_ARGUMENT` for I2V with portrait aspect ratio. This is a known limitation — the Flow UI supports it but the API does not. Workarounds:

1. **T2V mode** with detailed prompts (recommended — no first-frame image needed)
2. **Flow UI** directly for I2V portrait (manual, not automatable)
3. **Landscape I2V** then crop to portrait via FFmpeg (loses framing control)

| Mode | Portrait Support |
|------|-----------------|
| **T2V** (text-to-video) | Yes |
| **I2V** (image-to-video) | No (API rejects it) |

---

## Pre-Flight Validation

Run before starting generation:

```bash
vclaw video create "{intent}" --project "{product}" --dry-run
```

**Checklist:**
- [ ] All input images accessible and same aspect ratio
- [ ] Image formats supported (PNG, JPG, WebP)
- [ ] `GO_BANANAS_API_KEY` set (if using REST upload)
- [ ] veo-cli `cookie.json` valid (run `--visible` if expired)
- [ ] Project directory exists (`vclaw video init "name"`)
- [ ] FFmpeg installed for stitching

---

## Common Pipeline Overview

All modes follow a variant of this 6-phase pipeline (COPY mode is the canonical version):

```
Phase 0: Input Collection (project setup, gather references)
Phase 1: Analysis (SEALCAM+ video breakdown OR scene design wizard)
Phase 2: Prompt Generation (rewrite/create prompts for each scene)
Phase 3: Image Generation (Go Bananas MCP — Pro model, character/product refs)
   ★ MANDATORY CHECKPOINT: Review images before proceeding
Phase 4: Video Generation (veo-cli or Seedance — I2V or T2V)
Phase 5: Audio (background music + optional TTS narration)
Phase 6: Assembly (stitch scenes + audio → final video)
```

### Before Generating Images — Ask the User:

1. **Product/character references**: "Do you have reference images for your product or model?"
2. **Aspect ratio**: Landscape (YouTube) or Portrait (TikTok)?
3. **Music preference**: What mood/style for the background track?
4. **Backend preference**: Veo (free/direct) or Seedance (paid, cinematic)?

These questions prevent wasted credits on the wrong pipeline configuration.

### Image Generation Rules

- **Always** `model_id="gemini-pro-image"` (Pro model, never Flash)
- **With character_id**: Describe pose/action/environment, NOT facial features (the reference handles the face)
- **With product_id**: Focus on scene context, the product appearance comes from the reference
- **Aspect ratio**: Must match the target video format (16:9, 9:16, etc.)
- **Review checkpoint**: STOP after image generation. Present all images to user for approval before video generation (video gen is expensive — catching issues here saves significant time and credits)

### Video Generation Rules

- **I2V prompts** describe MOTION ONLY (camera movement, subject action) — NOT what's in the image
- **T2V prompts** describe the FULL SCENE (subject, environment, action, lighting, camera, style)
- **Seedance time-segments**: Use `0-3s: ... 3-6s: ...` format for temporal control
- **Audio direction**: Add `"Sound: [specific SFX]. No music, no vocals, no background music."` to prevent unwanted audio
- **Negative tokens**: Append `"No text, no subtitles, no watermarks, no logos, no abrupt cuts."` to all prompts

---

## SEALCAM+ Framework

The analysis framework for breaking down video scenes:

| Letter | Element | What It Captures |
|--------|---------|-----------------|
| **S** | Subject | Pose, position, facing direction, appearance |
| **E** | Environment | Depth layers, ground plane, atmosphere |
| **A** | Action | Speed %, path, start/end pose, keyframes |
| **CH** | Choreography | Gaze, weight shifts, attack mechanics, reaction physics |
| **L** | Lighting | Setup, direction, quality, shadows |
| **C** | Camera | Shot type, angle, movement type/speed/direction |
| **A** | Audio | BPM, instruments, sync points |
| **M** | Metatokens | Visual style, era, quality, mood |

### Prompt Types Matrix

| Mode | Subject | Environment | Action | Camera | Style |
|------|---------|-------------|--------|--------|-------|
| **T2V** | Full | Full | Full | Full | Yes |
| **I2V** | Skip | Skip | Motion only | Movement only | Skip |
| **F2V** | Skip | Skip | Transition path | Movement only | Skip |

---

## Output Structure

**Project Naming**: `YYYY-MM-DD_NNN_{slug}`

```
projects/2026-01-23_001_summer-sandals/
├── manifest.json          # Run tracking & metadata
├── reference/             # Downloaded original video
├── analysis/              # SEALCAM+ JSON + rewritten prompts
├── images/                # First-frame images (run-prefixed)
│   └── run001_scene_1_frame.jpg
├── videos/                # Scene segments (run-prefixed, _v1/_v2 for variations)
│   ├── run001_scene_1_v1.mp4
│   └── run001_scene_1_v2.mp4
├── audio/                 # Background music + TTS
└── final/                 # Stitched output
    └── run001_replicated_ad_v1.mp4
```

### Run Versioning

| Command | Behavior |
|---------|----------|
| `vclaw video create ... --execute` | New run through the clean-room front door |
| `vclaw video create ... --dry-run` | Preview the full plan before provider spend |
| `vclaw video iterate ...` | Rework an existing project without re-entering from scratch |
| `vclaw video remix-narrated ...` | Rebuild the narrated output |
| `vclaw video verify-final ...` | Verify the packaged final output |

Create new project:
```bash
vclaw video init "brand-campaign"
```

---

## Required API Keys

```
GOOGLE_API_KEY=xxx         # Gemini for analysis (Phase 1)
KIE_API_KEY=xxx            # Suno AI for music (Phase 5)
ELEVENLABS_API_KEY=xxx     # ElevenLabs TTS for narration (Phase 5b)

# Optional — for useapi.net backend (Phase 4)
USEAPI_API_TOKEN=xxx
USEAPI_ACCOUNT_EMAIL=xxx
```

---

## Portfolio Tracking

```bash
vclaw video status --project {slug}            # Project status
vclaw video index                              # Portfolio index
vclaw video metrics                            # Portfolio metrics
vclaw video report                             # Report snapshot
```

---

## Clean-Room Command Surface

| Command | Purpose |
|--------|---------|
| `vclaw video init` | Create a project workspace |
| `vclaw video create` | Build brief + storyboard and optionally execute |
| `vclaw video iterate` | Revise an existing project cheaply |
| `vclaw video clone-ad` | Clone-ad workflow on the clean-room path |
| `vclaw video analyze` | Template/source analysis on the clean-room path |
| `vclaw video execute` | Provider execution for approved projects |
| `vclaw video execute-status` | Poll live executions |
| `vclaw video execute-cancel` | Cancel live executions when the route supports it |
| `vclaw video remix-narrated` | Post-process narrated outputs |
| `vclaw video verify-final` | Final file verification |

---

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `video-generator` | sonnet | Sub-agent for scene generation with error recovery |
| `review-orchestrator` | sonnet | Coordinates agent-assisted review workflow |
| `image-qa` | haiku | Pre-validates images with quality scores |
| `regeneration` | sonnet | Auto-executes Go Bananas for rejected images |
| `video-comparison` | haiku | Ranks primary vs alt video variants |

For interactive review mode and agent-assisted review, see `references/interactive-review.md`.

---

## Pro Tips

- **I2V prompts**: Describe MOTION only, not what's in the image
- **Generate ALL scenes first**: Never stitch until all scene videos exist
- **Character consistency**: Always use Go Bananas character references across all scenes
- **Percentage keyframes**: Use `"0%: state → 50%: state → 100%: state"` for any duration
- **Backend selection**: `--backend direct` (free) for dev, `--backend useapi` (paid) for production, `--backend seedance` for cinematic
- **Verify before stitching**: `ls videos/scene_*.mp4 | wc -l` should equal scenes × variations

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Motion doesn't match original | Use motion-only I2V prompts, not full scene descriptions |
| Character looks different across scenes | Use Go Bananas character reference with `character_id` |
| I2V portrait fails (INVALID_ARGUMENT) | Use T2V mode for portrait — I2V API doesn't support portrait |
| Auth issues with veo-cli | Run with `--visible` to manually log in |
| Veo generates unwanted music | Add audio direction: `"Sound: [SFX]. No music, no vocals."` |
| Mixed art styles in output | Use `--check-style-consistency` before generation |
| Single camera angle across scenes | Add `--camera-variety` to inject camera shot variety |
| Soft/low-res video output | Add `--upscale-4k` to upscale frames before submission |
| Characters move robotically | Use `--choreography` on `rewrite_prompts.py` for micro-movements |
| Seedance content moderation (2038) | Sanitize "frozen people" → "still figures in mid-motion" |
| Batch generation loses progress | `seedance_batch.py` checkpoints — re-run same command to resume |

See `references/troubleshooting.md` for comprehensive debugging guide.

---

## References

### Mode-Specific Workflows
- `references/copy-mode.md` — COPY mode: 6-phase pipeline, title cards, CTA banners
- `references/create-mode.md` — CREATE mode: interactive wizard, storyboard grid
- `references/narrated-mode.md` — COPY NARRATED: scene classification, TTS, voice pipeline
- `references/presentation-mode.md` — PRESENTATION: slide extraction, animation, dual export
- `references/longform-mode.md` — LONG-FORM: batch orchestration, queue planning
- `references/film-mode.md` — FILM: screenplay, Seedance time-segments, cinematic flags
- `references/interactive-review.md` — Interactive + agent-assisted review mode

### Content Libraries
- `references/scene-templates.md` — Pre-built scene structures for CREATE mode
- `references/prompt-templates.md` — Scene templates by category (includes Yeraflasher cinematic templates)
- `references/motion-templates.md` — Motion patterns library
- `references/style-tokens.md` — Metatoken library
- `references/camera-transitions.md` — ~30 AI camera transition prompts
- `references/storyboard-templates.md` — 8 narrative templates for storyboard grid
- `references/f2v-journey-templates.md` — Pre-built F2V camera motion templates
- `references/audio-presets.md` — Named audio presets for TTS/stitch

### Guides
- `references/style-transfer-workflow.md` — Style transfer via Go Bananas reference groups
- `references/examples.md` — Complete workflow examples
- `references/finding-ads.md` — How to find winning ads to copy
- `references/gobananas-guide.md` — Go Bananas MCP integration guide
- `references/character-prompts.md` — Prompt simplification rules for character refs
- `references/character-variants.md` — Character variant management
- `references/negative-prompts.md` — Standard negative prompts
- `references/cinematic-techniques.md` — Cinematic production techniques
- `references/content-safety-guide.md` — Content safety guidelines
- `references/sealcam-prompt.md` — Full SEALCAM+ Gemini system prompt
- `references/troubleshooting.md` — Comprehensive debugging guide
- `references/changelog.md` — Version history
