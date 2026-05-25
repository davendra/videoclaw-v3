# Sound Design — audio direction for the narration + music + SFX pipeline

Seedance renders video only — audio comes from downstream pipelines. Understanding how to guide them produces richer finals.

## The 3-track audio model

Every finished movie has three audio layers, mixed by the narration pipeline:

| Track | Source | Default volume | Role |
|---|---|---|---|
| Narration (TTS) | ElevenLabs | 1.0 | Voice-over, dialogue, internal monologue |
| Music | Suno AI | 0.15 (15%) | Score, mood, rhythm |
| Ambient | generated / library | 0.30 (30%) | Room tone, location, atmosphere |

The 4-step pipeline (`extendAndBakeNarration`):
1. Slow-motion extend video to match TTS length (if TTS > video)
2. Concat silent stitched clips
3. 3-way mix with fade in/out on music
4. Combine silent video + premix audio

## Writing sound-aware intent prose

Include these cue formats in scene descriptions for the pipeline to pick up:

```
[SFX: rain drumming on rooftop, distant thunder]
[MUSIC: slow tension strings, 60 BPM, minor key]
[FOLEY: footsteps on wet stone, close]
[DIALOGUE: Komo whispers urgently, breath audible]
[AMBIENT: rooftop wind, city hum beneath]
```

The production-executor parses these hints and routes:
- `[SFX:]` + `[FOLEY:]` + `[AMBIENT:]` → Suno SFX generation or library lookup
- `[MUSIC:]` → Suno music track generation
- `[DIALOGUE:]` → ElevenLabs TTS with voice direction

## Genre-specific audio guidelines

### Action thriller
- Music: cinematic orchestral + electronic hybrid, 90-120 BPM, rising tension
- SFX: rain/wind/footsteps; avoid combat SFX (content filter); use "energy hum" for climax
- Dialogue: breath-heavy, urgent, whispered
- Mix: music loud in chase, drop for dialogue beats

### Storybook
- Music: acoustic guitar + ukulele + triangle, major key, 70-80 BPM
- SFX: bird ambience, wind in leaves, soft rain
- Dialogue: warm narrator voice, child-appropriate pace
- Mix: music soft and constant, ambient layer warm

### Documentary
- Music: minimal piano or solo cello, understated, 50-60 BPM
- SFX: real-world sounds of the subject's craft (pottery wheel, brush strokes)
- Dialogue: subject voiceover, reflective and unhurried
- Mix: music only at reflection beats, otherwise natural ambience

### UGC ad
- Music: upbeat acoustic pop-folk, 90 BPM, bright major key
- SFX: product sounds — coffee brewing, button clicks, packaging unwrap
- Dialogue: authentic direct-to-camera, genuine warmth
- Mix: music bright and consistent, duck under dialogue

### Music video
- Music: THE song is the track — everything syncs to it
- SFX: none or minimal (rain drops, footsteps punctuating)
- Dialogue: usually none
- Mix: music at 100%, SFX at 20% accent only

### Horror
- Music: silence-heavy, occasional low-frequency rumble, sparse piano notes
- SFX: subtle wrongness — door creak, distant thump, wind through eaves
- Dialogue: minimal, often whispered
- Mix: silence is the most powerful layer; music only at reveals

### Sci-fi
- Music: ambient synths, drone, occasional string swell
- SFX: technological hum, distant alarms, space silence
- Dialogue: reflective voiceover, dry intelligent delivery
- Mix: music omnipresent and textural; dialogue clear through

### Fantasy
- Music: orchestral with flute or horn, heroic major key
- SFX: magical chimes on reveals, footsteps on stone, wind in leaves
- Dialogue: soft narration, reverent
- Mix: music crescendos on hero beats

### Romance
- Music: gentle piano + string quartet, warm key, 60-70 BPM
- SFX: ambient (café, bookshop, outdoor), soft
- Dialogue: sparse, warm, with genuine pause
- Mix: music soft and continuous; let dialogue breathe

### Western
- Music: Morricone-style harmonica, whistle, slow percussion build
- SFX: wind, hoofbeats, spurs, distant gunshot (imply only)
- Dialogue: very sparse, laconic delivery
- Mix: music at key beats only, otherwise silence + wind

## Voice direction cues (for ElevenLabs)

Include these in `[DIALOGUE:]` cues for better TTS:

- `urgent, breath audible` — fast, breathy
- `whispered, close-mic` — intimate
- `reflective, slow cadence` — voiceover
- `authoritative, measured` — leader character
- `warm, storybook narrator` — kids content
- `laconic, pause-heavy` — western stranger
- `awestruck, hushed` — sci-fi reveal
- `bittersweet, wistful` — romance / drama

## Music BPM by scene type

| Scene type | BPM target |
|---|---|
| Calm establishing | 50-70 |
| Exposition / dialogue | 70-90 |
| Building tension | 90-110 |
| Active chase / action | 110-140 |
| Peak climax | 120-160 |
| Resolution / dénouement | 60-80 |

Seedance's Suno music generation picks up BPM hints from the `[MUSIC:]` cue.

## Content-filter-safe SFX language

Some sound effects trip Suno's content filter (violence-suggestive). Alternatives:

| Bad | Safe |
|---|---|
| "gunshots" | "impact booms" |
| "screaming" | "cries out" or omit |
| "stabbing sound" | "sharp metallic clang" |
| "blood dripping" | NEVER |
| "body hitting ground" | "heavy thud" |

## Audio-visual sync tactics

### Musical cut points
Request music to have clear hits at scene transitions:
```
[MUSIC: orchestral build with percussion hit on beat 14 second mark, sustained strings after]
```

### Quiet beats for emotion
Request a "music drop" at your emotional climax:
```
[MUSIC: full orchestral up until scene 10, drop to solo piano for scene 11, rebuild scene 12]
```

### Silence for impact
Sometimes the best audio is none:
```
[AUDIO: silence except for character's breathing, 5 seconds, then music re-enters]
```

## Known limitations

1. **No lip-sync.** TTS + video are generated independently. Use voiceover narration, not dialogue visible on-screen.
2. **Music is per-project, not per-scene.** Suno generates one continuous track; scene-level cues are guidance only.
3. **Ambient track is simple.** No dynamic positional audio; just a stereo bed.
4. **No foley variety.** Unless explicitly requested, pipeline uses library generic foley.
5. **ElevenLabs voice consistency.** If multiple characters speak, they all use the same voice unless you assign different voice IDs (requires extra setup).

## Audio quality post-check

After render, verify via:
```bash
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,bit_rate,channels,sample_rate \
  -of default=noprint_wrappers=1 final/narrated-fixed.mp4
```

Expect:
- `codec_name=aac`
- `bit_rate=192000` or higher
- `channels=2` (stereo)
- `sample_rate=48000`
