---
name: seedance-prompts
description: >
  Browse the clean-room Seedance prompt reference library and apply the current
  provider guidance to Seedance-targeted scene writing. Use when you need
  Seedance formulas, examples, prompt structure guidance, or prompt-library
  references that actually exist in this repo.
triggers:
  - "seedance prompt"
  - "generate seedance prompt"
  - "expand prompt for seedance"
  - "search seedance prompts"
  - "find seedance examples"
  - "seed prompts"
  - "prompt quality"
  - "seedance music video"
  - "music video prompt"
  - "lip sync prompt"
  - "beat sync prompt"
  - "mira style seedance"
---

# Seedance Prompts

Use this skill to inspect and apply the clean-room Seedance prompt references
that ship with `vclaw-video-core`.

## Current Scope

This repo currently supports a **reference-first** Seedance workflow, not the
older Python prompt-database workflow.

What exists now:

1. `vclaw video prompt-lib-list`
2. `vclaw video prompt-lib-show --name seedance-ugc-formulas`
3. `vclaw video execution-plan --project <slug>`
4. `vclaw video storyboard-review --project <slug>`

What does not exist in this repo:

1. `scripts/video/seedance_prompt_db.py`
2. `scripts/video/seed_skill_prompts.py`
3. a local SQLite prompt database under `scripts/video/data/`

Do not tell users to run those old paths from this clean-room repo.

## Canonical Commands

### List prompt references

```bash
vclaw video prompt-lib-list
```

### Show the Seedance reference

```bash
vclaw video prompt-lib-show --name seedance-ugc-formulas
```

### Get project-specific prompt guidance

```bash
vclaw video execution-plan --project <slug> [--root <path>] [--mode storyboard|director]
```

This returns the current prompt-guidance set chosen for the project, including
Seedance-specific references when the route or mode calls for them.

## Workflow

When the user asks for Seedance prompting help:

1. Inspect the current library:
   `vclaw video prompt-lib-list`
2. Read the Seedance reference:
   `vclaw video prompt-lib-show --name seedance-ugc-formulas`
3. If the prompt needs project context, inspect:
   `vclaw video execution-plan --project <slug>`
4. Apply the reference patterns to the user’s scene prose or storyboard beats.

## Output Expectations

A good answer or workflow result should give the user:

1. a concise Seedance-ready scene prompt
2. camera and pacing guidance grounded in the reference docs
3. negative / exclusion language when useful
4. any relevant warning about duration, continuity, or character consistency

## Notes

- Seedance prompting in this repo is currently **doc-and-guidance driven**.
- The canonical Seedance reference is `seedance-ugc-formulas` in the prompt library.
- When a user needs a full project-aware recommendation, prefer the execution
  plan and storyboard review outputs over freehand prompt invention.

## Music-video prompts (formerly seedance-music-video-prompts)

When the user wants a music video specifically — beat-synced visuals,
lyric-driven scene changes, performance shots — use the music-video
prompt patterns below in addition to the general Seedance prompt
patterns above.

<!-- Folded in from skills/seedance-music-video-prompts/SKILL.md in Slice 2 (2026-05-25). -->

Create prompt packs for Seedance music videos that use a reference artist
image (`@Image1`, `@Image2`) and a music/audio track (`@Audio1`). This
section is narrower than the general Seedance guidance above: it is for
music-video shot design, not general scene prompting.

### When to use the music-video patterns

- The user wants prompts for a music video using Seedance.
- The prompt needs lip sync, beat sync, artist performance, or audio-native generation.
- The user wants a reusable prompt pack with character sheets and multiple performance/world-building shots.
- The user references Mira-style Seedance/Suno prompt examples.

### Music-video workflow

1. Identify the song context:
   - genre, tempo, mood, vocal style, runtime target
   - lead artist count and whether there is a love interest, dancers, band, or crowd
   - desired aspect ratio and platform
2. Create or request artist reference images:
   - one character sheet per lead artist or recurring character
   - consistent wardrobe anchors and distinctive features
   - neutral background, multiple views, close-ups
3. Build 6-12 Seedance video prompts:
   - mix tight lip-sync performance shots, walking/track shots, and world-building shots
   - keep each prompt one shot, one location, one primary action
   - include exact references such as `@Image1` and `@Audio1`
4. Add motion constraints:
   - state what should remain still or restrained
   - block unwanted subtitles, sudden zooms, excessive dance, background clutter, or identity drift
5. Deliver a production-ready pack:
   - character sheet prompts first
   - Seedance video prompts next
   - a short continuity checklist at the end

### Music-video prompt structure

Use this structure for every Seedance music-video prompt:

```text
[Shot size and subject] of [artist/reference] performing @Audio1 in [location].
[Lip-sync or beat-sync instruction] throughout the entire shot.
[Wardrobe, lighting, color palette, production design].
[Movement: artist movement + camera movement + rhythm relationship to @Audio1].
[Constraints: no subtitles, no extra actions, no sudden motion, no identity drift].
[Aesthetic: genre, lens/film language, texture, mood].
10 second duration. Audio-native generation; sync lip movement, body motion, and camera rhythm to @Audio1.
```

### Shot mix

- **Character sheet**: build the visual identity before video generation.
- **Tight lip sync**: extreme close-up or medium close-up for vocal precision.
- **Beat-sync walk**: slow walk, track backward, steps locked to the beat.
- **World-building performance**: artist performs inside a cinematic location while atmosphere moves around them.
- **Secondary character scene**: include another character only when the relationship matters to the song.
- **Chorus energy shot**: restrained dancers, crowd motion, rain, neon, or lights synced to the track.

### Music-video reference

For Mira-style patterns, read `references/mira-style-seedance-pack.md`.

### Music-video output format

```markdown
# Seedance Music Video Prompt Pack

## Inputs
- Audio: @Audio1
- Artist refs: @Image1, @Image2
- Style:
- Runtime/clip count:

## Character Sheet Prompts
...

## Seedance Video Prompts
### Prompt 1 - [shot purpose]
Model: Seedance 2.0 (Video)
...

## Continuity Checklist
- Same artist identity across clips
- Wardrobe continuity intentional
- Lip-sync shots explicitly say active singing/rapping
- Movement is restrained and beat-aware
- No subtitles
```
