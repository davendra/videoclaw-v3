---
name: seedance-music-video-prompts
description: Create Seedance music-video prompt packs for audio-native performance clips, lip sync, beat-synced movement, artist character sheets, and cinematic world-building shots.
---

# Seedance Music Video Prompts

Create prompt packs for Seedance music videos that use a reference artist image (`@Image1`, `@Image2`) and a music/audio track (`@Audio1`). This skill is narrower than `seedance-prompts`: it is for music-video shot design, not general scene prompting.

## When To Use

- The user wants prompts for a music video using Seedance.
- The prompt needs lip sync, beat sync, artist performance, or audio-native generation.
- The user wants a reusable prompt pack with character sheets and multiple performance/world-building shots.
- The user references Mira-style Seedance/Suno prompt examples.

## Workflow

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

## Prompt Structure

Use this structure for every Seedance video prompt:

```text
[Shot size and subject] of [artist/reference] performing @Audio1 in [location].
[Lip-sync or beat-sync instruction] throughout the entire shot.
[Wardrobe, lighting, color palette, production design].
[Movement: artist movement + camera movement + rhythm relationship to @Audio1].
[Constraints: no subtitles, no extra actions, no sudden motion, no identity drift].
[Aesthetic: genre, lens/film language, texture, mood].
10 second duration. Audio-native generation; sync lip movement, body motion, and camera rhythm to @Audio1.
```

## Shot Mix

- **Character sheet**: build the visual identity before video generation.
- **Tight lip sync**: extreme close-up or medium close-up for vocal precision.
- **Beat-sync walk**: slow walk, track backward, steps locked to the beat.
- **World-building performance**: artist performs inside a cinematic location while atmosphere moves around them.
- **Secondary character scene**: include another character only when the relationship matters to the song.
- **Chorus energy shot**: restrained dancers, crowd motion, rain, neon, or lights synced to the track.

## Reference

For Mira-style patterns, read `references/mira-style-seedance-pack.md`.

## Output Format

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
