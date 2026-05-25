---
name: creative-brief
description: >
  Filmmaker intake for the video-replicator pipeline. Use when a user
  describes a video idea in creative terms ("I want a luxury resort ad",
  "make something like a Nike spot") rather than technical pipeline commands.
  Translates 7-question creative brief into exact CLI commands.
triggers:
  - "I want to make a video"
  - "create a video ad"
  - "film idea"
  - "video concept"
  - "make something like"
  - "short film"
  - "brand video"
---

# Creative Brief — Filmmaker Intake

> **Hard Rule**: Do NOT generate any video, image, or audio until the user has reviewed and approved the full plan. Show the complete command set first.

## Purpose

Translate creative intent → pipeline commands. The user thinks in story beats and vibes; we translate to `--backend`, `--mode`, `--scenes`, `--quality`, and `--transitions`.

## The 7 Questions

Ask these one at a time. Stop after each answer before proceeding to the next.

### Q1 — What is this for?
"What are we making? (e.g. product ad, brand film, social reel, explainer, short film)"

**Maps to**: pipeline mode selection, scene count

### Q2 — What's the feeling / vibe?
"Describe the vibe in 3 words or less. Or name a reference (brand, film, director)."

**Maps to**: SEALCAM Metatokens, Go Bananas style, color grade preset
**Reference**: `references/visual-styles.md`

### Q3 — What assets do you have?
"Do you have: product images, character references, a logo, a reference video to copy, or starting from scratch?"

**Maps to**:
- Product images → `--backend seedance --mode frames-to-video` + product_ref
- Character refs → Go Bananas character_id + `--chained`
- Reference video → COPY mode (`analyze_video.py` → `rewrite_prompts.py`)
- Scratch → `--mode text-to-video` or `generate_storyboard.py`

### Q4 — How long and how fast?
"Total duration? Pacing: slow/medium/fast?"

**Maps to**: scene count, quality flag, backend
**Reference**: `references/pacing-guide.md`

### Q5 — Camera style?
"Camera energy: Steady & cinematic / Fluid & handheld / Dynamic & whippy / Intimate close-ups / Epic & sweeping"

**Maps to**: journey-template, SEALCAM C-layer, transitions
**Reference**: `references/camera-archetypes.md`

### Q6 — Audio?
"Audio plan: narration (voiceover) / presenter talking to camera / background music only / sound effects only / no audio"

**Maps to**: `--lip-sync`, `--voiceover`, `vclaw video create`, `--audio-ref`
**Reference**: `references/audio-strategy.md`

### Q7 — Backend preference?
"Speed vs quality: Fast (`veo-3.1-fast`, default) / Quality (`veo-3.1-quality`, 8s-only) / Lite (`veo-3.1-lite`, cheapest) / Free (`veo-3.1-lite-low-priority`, Ultra plan only) / Omni Flash (`omni-flash`, audio-native voice narration)"

**Maps to**: `--quality fast|quality|lite|free|omni-flash`, `--backend useapi|direct|seedance`
**Credit reference**: `vclaw-cli/docs/GOOGLE-FLOW-V1.md` for the full model/credit matrix

---

## Backend Decision Table

| Situation | Backend | Mode |
|-----------|---------|------|
| Product ad, has product images | `seedance` | `frames-to-video` |
| Character-driven, has character refs | `useapi` | `frames-to-video` + `--chained` |
| Copy a reference video | `useapi` | COPY mode |
| Lip-sync / talking presenter | `seedance` | `audio-lipsync` |
| BGM clone from audio reference | `seedance` | `omni_reference` + `--audio-ref` |
| Pure concept, no assets | `useapi` | `text-to-video` or `seedance_omni.py` |
| Audio-native / voice narration brief | `useapi` | `omni-flash` (see `vclaw-cli/docs/GOOGLE-FLOW-V1.md` for voice preset names) |
| Budget-sensitive / development | `direct` | any |

---

## After All 7 Answers: Generate the Plan

Present this structure before ANY generation:

```
## Your Video Brief

**Concept**: [1-sentence summary]
**Duration**: [N]s across [N] scenes
**Style**: [vibe words] → [metatokens]
**Camera**: [archetype] → [journey-template or SEALCAM C-layer]
**Audio**: [plan] → [TTS/lipsync/music flags]
**Backend**: [backend] ([reason])

## Scene Breakdown
Scene 1: [description + camera move]
Scene 2: [description + camera move]
...

## Commands

### Phase 3: Generate images
[Go Bananas MCP calls if needed]

### Phase 4: Generate videos
vclaw video create "[intent expanded into scene prompts]" \
  --project "{slug}" \
  --platform [platform] \
  --aspect-ratio [16:9|9:16|1:1] \
  --quality [fast|quality] \
  --audio [on|off] \
  --execute

### Phase 5: Audio
[Narration / post-production pass if needed]

### Phase 6: Stitch
vclaw video remix-narrated --project "{slug}"
```

**Then ask**: "Does this plan look right? Shall I proceed?"

---

## Sound Direction (REQUIRED)

Every scene prompt must end with a sound direction following the mandatory format:

```
Sound: [specific SFX matching the visual]. [No music/No background music.]
```

Examples:
- `"Sound: ocean waves crashing, distant seagulls. No music."`
- `"Sound: product unboxing crinkle, soft tap sounds. No background music."`
- `"Sound: crowd cheering, sneaker squeak on court. No background music."`

Generic instructions like "ambient sounds" are insufficient — be specific.

---

## Reference Files

- `references/visual-styles.md` — vibe/style → SEALCAM Metatokens + Go Bananas presets
- `references/camera-archetypes.md` — 5 camera archetypes → CLI flags + transition IDs
- `references/pacing-guide.md` — duration × pace → scene count + quality heuristics
- `references/audio-strategy.md` — voice type decision tree → TTS/lipsync/music flags
