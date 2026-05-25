---
name: ugc
description: |
  UGC Campaign Generator — belief-driven marketing video creation pipeline.

  This skill should be used when:
  - User asks to "create a UGC campaign", "make UGC ads", "belief-driven ads"
  - User provides a product URL and wants marketing videos
  - User mentions "E5 method", "belief journey", "unique mechanism"
  - User wants multi-video ad campaigns with strategy research

  Output: N belief-targeted UGC videos (30-60s each) with subtitles + campaign report.
---

# UGC Campaign Generator

*Product URL to belief-driven marketing video campaign.*

## Positioning

Use `skills/video-framework/SKILL.md` as the generic front door for broad video
requests.

Use `ugc` when:

1. the user explicitly wants UGC ads or belief-driven campaign work
2. the task is campaign-scale rather than a single video
3. the E5/belief-method workflow is the right specialization

## Overview

The UGC skill creates belief-driven User-Generated Content style marketing videos. Starting from just a product URL, it autonomously researches the market, crafts belief-targeted scripts using the E5 methodology, and produces N production-ready videos with subtitles.

**Philosophy**: Every marketing campaign is about taking the prospect on a journey to a belief that pre-sells them before the offer is introduced. We craft arguments, not just copy.

## Pipeline: 6 Phases

```
Phase 0: Setup      — Product refs, character creation via Go Bananas
Phase 1: Strategy   — Autonomous market research → 4 strategy docs (ugc-strategy agent)
Phase 2: Scripts    — Belief-driven copywriting → N scripts + storyboards (ugc-brand agent)
Phase 3: Production — Images → Videos → TTS → Stitch (N ugc-production agents, PARALLEL)
Phase 4: Subtitles  — Whisper transcription → ASS → FFmpeg burn-in
Phase 5: Report     — Campaign manifest → HTML report
```

## Quick Start

```bash
# The user says: "Create a UGC campaign for [product URL]"
# Claude Code reads this SKILL.md and orchestrates the full pipeline.
```

## Agent Architecture

| Phase | Agent | Model | Purpose |
|-------|-------|-------|---------|
| 0 | Direct (Claude Code) | — | Go Bananas MCP for product/character refs |
| 1 | `ugc-strategy` | Opus | Autonomous web research → 4 strategy docs |
| 2 | `ugc-brand` | Opus | Belief-driven scripts + storyboards |
| 3 | `ugc-production` (×N) | Sonnet | Video production per script (parallel) |
| 4-5 | Direct (Claude Code) | — | Subtitles + campaign report |

## Phase 0: Setup

### 0.1 Create Project

```bash
vclaw video init "{slug}" --mode storyboard
vclaw video set-meta --project "{slug}" --tag ugc --tag belief-campaign
```

### 0.5 Create Product Reference (if physical product)

```python
mcp__go-bananas__generate_image(
    prompt="Professional studio photography of [product], clean white background, commercial quality",
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)
```

### 0.75 Create Character Reference

```python
mcp__go-bananas__generate_image(
    prompt="Portrait of [character description from avatar], neutral expression, plain background",
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)
# Then create persistent character:
mcp__go-bananas__create_character(
    character_name="{Campaign}_{Name}",
    base_prompt="[Full physical description]",
    negative_prompt="different hair color, different eye color, cartoon, anime"
)
```

Update campaign manifest with character_id.

## Phase 1: Strategy Research

**Agent**: `ugc-strategy` (Opus)

Spawn the strategy agent with the product name and URL. It will:

1. Fetch and analyze the product website (WebFetch)
2. Conduct market research (WebSearch): competitors, pain points, trends
3. Create 4 strategy documents:
   - `projects/{slug}/strategy/research.md` — Market analysis (6+ pages)
   - `projects/{slug}/strategy/avatar.json` — Customer avatar profile
   - `projects/{slug}/strategy/offer.json` — Product positioning + unique mechanism
   - `projects/{slug}/strategy/beliefs.json` — Necessary beliefs ("I believe that...")
4. Review the resulting strategy docs with the user before production
5. Present summary and wait for user approval

```bash
# The clean-room repo does not ship the old UGC strategy helper scripts.
# Write the research outputs directly under projects/{slug}/strategy/ and keep
# the production execution on the vclaw CLI surface.
```

## Phase 2: Belief-Driven Scripts

**Agent**: `ugc-brand` (Opus)

Spawn the brand agent with the strategy documents. It will:

1. Read all strategy documents
2. Invoke the E5 copywriting methodology (see `references/e5-method.md`)
3. Create N belief scripts (default 3), each targeting a different necessary belief
4. Each script follows: Hook → Problem → Mechanism → Proof → Offer → CTA
5. Validate word counts against duration limits
6. Save to `projects/{slug}/scripts/belief_N.json`

```bash
# Store each approved belief script under projects/{slug}/scripts/ and use it
# as the input source for the current create / iterate / execute flow.
vclaw video create "Belief 1 UGC script" --project "{slug}" --platform tiktok --aspect-ratio 9:16
```

### Belief Script JSON Format

```json
{
  "script_id": "belief_1",
  "belief_targeted": "I need a better solution for X",
  "duration_target": 30,
  "scenes": [
    {
      "scene_number": 1,
      "type": "hook",
      "duration": 8,
      "dialogue": "Speaking text...",
      "visual": "Visual description...",
      "camera": "Camera motion...",
      "veo_prompt": "Full Veo prompt..."
    }
  ],
  "cta": {"text": "Call to action", "url": "https://..."}
}
```

### Word Count Limits (CRITICAL)

| Duration | Max Words | Sentences |
|----------|-----------|-----------|
| 4 seconds | 8-12 | 1 short |
| 8 seconds | 15-25 | 1-2 short |
| 12 seconds | 25-35 | 2-3 sentences |

## Phase 3: Video Production

**Agent**: `ugc-production` (Sonnet) — spawned once per belief script, runs in parallel.

For each belief script:

### 3.1 Generate First-Frame Images

```python
# For each scene in the script
mcp__go-bananas__generate_image(
    prompt="WIDE HORIZONTAL. [scene visual description]. UGC selfie aesthetic.",
    character_id={character_id_from_manifest},
    aspect_ratio="16:9",  # or "9:16" for portrait UGC
    model_id="gemini-pro-image"
)
```

### 3.2 Generate Videos

```bash
vclaw video create "Belief 1 UGC production pass" \
  --project "{slug}" \
  --platform tiktok \
  --aspect-ratio 9:16 \
  --quality fast \
  --audio on \
  --execute
```

### 3.3 Generate TTS Narration

```bash
# Keep the transcript in projects/{slug}/audio/tts/ and run the current
# narration / post-production pass after the base execution succeeds.
vclaw video status --project "{slug}"
vclaw video remix-narrated --project "{slug}"
```

### 3.4 Stitch Final Video

```bash
vclaw video remix-narrated --project "{slug}"
vclaw video verify-final --project "{slug}"
```

## Phase 4: Subtitles

Handle subtitles in the post-production lane after the verified render:

```bash
vclaw video verify-final --project "{slug}"
```

### Subtitle Style Presets

| Style | Description | Best For |
|-------|-------------|----------|
| `ugc-bold` | Large white text, thick black outline | Social media (Instagram, TikTok) |
| `ugc-minimal` | Smaller white, subtle shadow | YouTube, professional content |
| `ugc-tiktok` | Word-by-word yellow highlight | TikTok, short-form content |
| `ugc-caption` | Standard broadcast captions | YouTube, accessibility |

See `references/subtitle-styles.md` for detailed ASS style definitions.

## Phase 5: Campaign Report

```bash
vclaw video report --root projects
vclaw video metrics --root projects
```

## Project Output Structure

```
projects/{slug}/
├── campaign_manifest.json        # Campaign tracking
├── strategy/                     # Phase 1
│   ├── research.md
│   ├── avatar.json
│   ├── offer.json
│   ├── beliefs.json
│   └── hooks.json
├── scripts/                      # Phase 2
│   ├── belief_1.json
│   ├── belief_2.json
│   └── belief_3.json
├── veo_specs/                    # Phase 2.5
│   ├── belief_1_scene_1.json
│   └── campaign_overview.html
├── images/                       # Phase 3.1
│   └── run001_scene_N_frame.jpg
├── videos/                       # Phase 3.2
│   └── run001_scene_N.mp4
├── audio/                        # Phase 3.3
│   ├── tts/
│   │   ├── editable_transcript.json
│   │   └── scene_N_tts.mp3
│   └── background.mp3
├── subtitles/                    # Phase 4
│   └── belief_1.ass
└── final/                        # Phase 3.4 + 4 + 5
    ├── belief_1_ugc.mp4
    ├── belief_1_ugc_subtitled.mp4
    ├── belief_2_ugc.mp4
    ├── belief_2_ugc_subtitled.mp4
    ├── belief_3_ugc.mp4
    ├── belief_3_ugc_subtitled.mp4
    └── campaign_report.html
```

## Orchestration Flow (for Claude Code)

When a user says "Create a UGC campaign for [product]":

### Step 1: Collect Minimal Input
Ask only:
- Product/brand name
- Website or sales page URL
- (Optional) Number of scripts (default: 3)
- (Optional) Target country/accent

### Step 2: Phase 0 — Setup
1. Create project: `vclaw video init`
2. Scaffold strategy docs manually under `projects/{slug}/strategy/`
3. Create character reference via Go Bananas MCP (if product has a presenter)

### Step 3: Phase 1 — Strategy
Spawn `ugc-strategy` agent with product name + URL.
Wait for completion. Present strategy summary to user. Get approval.

### Step 4: Phase 2 — Scripts
Spawn `ugc-brand` agent with strategy docs path.
Wait for completion. Present scripts to user. Get approval.

### Step 5: Phase 3 — Production (PARALLEL)
For each belief script (1..N), spawn a `ugc-production` agent.
All agents run in parallel for N× speedup.
Wait for all to complete.

### Step 6: Phase 4 — Subtitles
For each final video, run `add_subtitles.py` with chosen style.

### Step 7: Phase 5 — Report
Run `vclaw video report` to generate the current clean-room portfolio snapshot.
Present final deliverables to user.

## Configuration

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ELEVENLABS_API_KEY` | For TTS | Narration generation |
| `GOOGLE_API_KEY` | For analysis | Video/image analysis |

### Campaign Manifest Fields

| Field | Type | Description |
|-------|------|-------------|
| `product_name` | string | Product display name |
| `product_url` | string | Product website URL |
| `slug` | string | URL-safe project identifier |
| `scripts_count` | int | Number of belief scripts (default: 3) |
| `target_duration` | int | Target per-video duration in seconds (default: 30) |
| `character_reference` | object | Go Bananas character details |
| `product_reference` | object | Go Bananas product details |
| `localization` | object | Country, accent, presenter prefs |
| `phases_completed` | array | List of completed phase numbers |

## Reused Infrastructure

This skill reuses the proven video-replicator infrastructure:

| Script | UGC Usage |
|--------|-----------|
| `vclaw video create` | Base UGC generation and project scaffolding |
| `vclaw video execute` | Provider submission for approved runs |
| `vclaw video remix-narrated` | Post-production narrated remix |
| `generate_music.py` | Background music |
| `generate_logo_animation.py` | Brand intro/outro |
| `ffmpeg_wrapper.py` | All FFmpeg operations |
| `transcribe_audio.py` | Whisper transcription (used by add_subtitles.py) |
| `gobananas_prompts.py` | Go Bananas prompt building |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Strategy agent takes too long | WebSearch may be slow; agent auto-retries |
| Script word count exceeds limit | Re-cut the belief script before running `vclaw video create` |
| Character looks different across scenes | Always use Go Bananas `character_id` with `model_id="gemini-pro-image"` |
| Subtitles out of sync | Use `--transcript` to provide pre-validated transcript instead of Whisper |
| Whisper not installed | `brew install openai-whisper` |
| TTS generated for lip-sync scenes | Keep lip-sync scenes isolated in the approved script before the narration pass |
| Videos stitch in wrong order | ugc_stitch.py auto-orders by scene type (hook→problem→...→cta) |
| Campaign manifest missing | Run `vclaw video init` first |
| Need to re-run one script's videos | Spawn a single ugc-production agent with that script_id |

## References

- `references/e5-method.md` — E5 belief-driven copywriting methodology
- `references/ugc-prompt-templates.md` — UGC Veo prompt patterns
- `references/subtitle-styles.md` — ASS subtitle style presets
- `templates/strategy_schema.json` — Strategy document JSON schema
- `templates/script_schema.json` — Belief script JSON schema
