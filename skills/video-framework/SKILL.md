---
name: video-framework
description: Unified OMX-native front door for creating videos by routing across copy, create, narrated, presentation, long-form, film, and UGC workflows while reusing proven legacy engines behind adapters.
---

<Purpose>
Video Framework is the flagship OMX-native video production surface. It gives users one place to start — “make me a video” — and then internally routes to the appropriate workflow mode while keeping the public experience inside OMX.
</Purpose>

<Use_When>
- The user wants to make a video, copy an ad, generate a product video, create a narrated explainer, restyle a presentation, or run a longer-form cinematic workflow
- The user wants a unified OMX-native experience instead of raw Python/Bun scripts
- The task should reuse legacy `veo-cli` and `vclaw-video-core` capabilities behind adapters
</Use_When>

<Do_Not_Use_When>
- The user only wants a single static image
- The user wants low-level backend debugging on a specific legacy script without the OMX product surface
- The user is asking for a generic non-video orchestration task
</Do_Not_Use_When>

<Current_Product_Boundary>
This skill is the new front door. It should:
- classify requests into internal modes such as COPY, CREATE, COPY NARRATED, PRESENTATION, LONG-FORM, FILM, and UGC
- gather missing inputs and preferences
- prefer OMX-native orchestration and `.omx/` state
- reuse legacy engines behind wrappers instead of exposing raw scripts directly

Initial migration direction:
- `veo-cli` is treated as a backend/service adapter source
- the imported `skills/video-replicator/` tree is treated as the legacy
  workflow/phase-engine reference set
- the public UX should not leak `.claude` path assumptions, printed MCP commands, or raw Python/Bun entrypoints

Reference guides:
- `references/checkpoint-protocol.md`
- `references/stage-directors.md`
- repo-local follow-on skills:
  - `skills/video-analyze-template/SKILL.md`
  - `skills/video-clone-ad/SKILL.md`
  - `skills/video-storyboard/SKILL.md`
</Current_Product_Boundary>

<Example_Requests>
- "make me a product ad video from these assets"
- "copy this ad with a new subject"
- "create a narrated explainer video"
- "turn this presentation into an animated video"
- "start a cinematic film workflow for this concept"
</Example_Requests>

## Intake mode (formerly `creative-brief`)

When the user's request is too vague to route directly — they describe
the video in creative terms ("I want a luxury resort ad", "make
something like a Nike spot", "short film about loneliness") rather than
in pipeline / CLI terms — drop into intake mode and ask the 7 questions
below. Ask one at a time, stop after each answer, and skip questions
whose answer is already clear from the original request.

> **Hard rule:** do NOT generate any video, image, or audio until the
> user has reviewed and approved the full plan that comes out of intake.
> Show the complete command set first, then ask "Does this plan look
> right? Shall I proceed?" before any execution.

<!-- Folded in from skills/creative-brief/SKILL.md in Slice 2 (2026-05-25). -->

### The 7 questions

1. **What is this for?** "What are we making? (e.g. product ad, brand
   film, social reel, explainer, short film)" — maps to pipeline mode
   selection and scene count.
2. **What's the feeling / vibe?** "Describe the vibe in 3 words or
   less. Or name a reference (brand, film, director)." — maps to
   SEALCAM Metatokens, Go Bananas style, color-grade preset. See
   `references/visual-styles.md` (was folded from creative-brief).
3. **What assets do you have?** "Do you have: product images, character
   references, a logo, a reference video to copy, or starting from
   scratch?" — maps to:
   - Product images → `--backend seedance --mode frames-to-video` + product_ref
   - Character refs → Go Bananas `character_id` + `--chained`
   - Reference video → COPY mode (analyze → rewrite prompts)
   - Scratch → `--mode text-to-video` or generated storyboard
4. **How long and how fast?** "Total duration? Pacing: slow / medium /
   fast?" — maps to scene count, quality flag, backend. See
   `references/pacing-guide.md`.
5. **Camera style?** "Camera energy: steady & cinematic / fluid &
   handheld / dynamic & whippy / intimate close-ups / epic & sweeping" —
   maps to journey-template, SEALCAM C-layer, and transitions. See
   `references/camera-archetypes.md`.
6. **Audio?** "Audio plan: narration (voiceover) / presenter talking to
   camera / background music only / sound effects only / no audio" —
   maps to `--lip-sync`, `--voiceover`, `vclaw video create`,
   `--audio-ref`. See `references/audio-strategy.md`.
7. **Backend preference?** "Speed vs quality: Fast (`veo-3.1-fast`,
   default) / Quality (`veo-3.1-quality`, 8s-only) / Lite
   (`veo-3.1-lite`, cheapest) / Free (`veo-3.1-lite-low-priority`,
   Ultra plan only) / Omni Flash (`omni-flash`, audio-native voice
   narration)" — maps to `--quality fast|quality|lite|free|omni-flash`
   and `--backend useapi|direct|seedance`. Credit reference:
   `vclaw-cli/docs/GOOGLE-FLOW-V1.md`.

### Backend decision table

| Situation | Backend | Mode |
|-----------|---------|------|
| Product ad, has product images | `seedance` | `frames-to-video` |
| Character-driven, has character refs | `useapi` | `frames-to-video` + `--chained` |
| Copy a reference video | `useapi` | COPY mode |
| Lip-sync / talking presenter | `seedance` | `audio-lipsync` |
| BGM clone from audio reference | `seedance` | `omni_reference` + `--audio-ref` |
| Pure concept, no assets | `useapi` | `text-to-video` or `seedance_omni.py` |
| Audio-native / voice narration brief | `useapi` | `omni-flash` |
| Budget-sensitive / development | `direct` | any |

### After all 7 answers: present the plan, then dispatch

Map the answers onto a concrete `vclaw video brief` invocation along
the lines of:

```
vclaw video brief \
  --project <slug> \
  --title "<concept>" \
  --intent "<one-sentence brief>" \
  --aspect-ratio <16:9|9:16|1:1> \
  --quality <fast|quality|lite|free|omni-flash>
```

Then show the user the full plan in this shape:

```
## Your Video Brief

**Concept**: [1-sentence summary]
**Duration**: [N]s across [N] scenes
**Style**: [vibe words] → [metatokens]
**Camera**: [archetype] → [journey-template or SEALCAM C-layer]
**Audio**: [plan] → [TTS / lipsync / music flags]
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

Ask **"Does this plan look right? Shall I proceed?"** and only then
hand off to the regular video-framework dispatch (COPY / CREATE /
NARRATED / PRESENTATION / LONG-FORM / FILM / UGC).

### Sound direction (required for every scene)

Every scene prompt must end with a sound direction in the mandatory
format:

```
Sound: [specific SFX matching the visual]. [No music / No background music.]
```

Examples:
- `"Sound: ocean waves crashing, distant seagulls. No music."`
- `"Sound: product unboxing crinkle, soft tap sounds. No background music."`
- `"Sound: crowd cheering, sneaker squeak on court. No background music."`

Generic instructions like "ambient sounds" are insufficient — be
specific to the visual.

### Intake reference files

The intake question set is backed by reference notes (originally under
`skills/creative-brief/references/`, fold them into video-framework's
`references/` directory as you build them out):

- `references/visual-styles.md` — vibe/style → SEALCAM Metatokens + Go Bananas presets
- `references/camera-archetypes.md` — 5 camera archetypes → CLI flags + transition IDs
- `references/pacing-guide.md` — duration × pace → scene count + quality heuristics
- `references/audio-strategy.md` — voice type decision tree → TTS / lipsync / music flags
