## COPY NARRATED MODE - Narrated Video Pipeline

COPY NARRATED produces narrated videos with continuous voiceover. It combines presenter scenes (lip-synced speech, voice-changed to consistent voice) with B-roll scenes (TTS narration baked per-scene).

### Pipeline Overview

```
Phase 1:   Analyze video (SEALCAM+) + Transcribe audio (Whisper)
Phase 1.5: Extract reference frames
Phase 2:   Rewrite prompts + Write narration script
Phase 3:   Generate images (Presenter: character refs, B-roll: ref groups/style)
Phase 4:   Generate videos (Presenter: with speech prompts, B-roll: visual only)
Phase 5a:  Music generation
Phase 5b:  TTS narration (all scenes)
Phase 5c:  Voice change presenter scenes (ElevenLabs STS)
Phase 5d:  Bake narration onto B-roll scenes (FFmpeg per-scene overlay)
Phase 5e:  Swap processed files to primary names
Phase 6:   Stitch with --presenter mode
```

### Scene Classification

**Every scene MUST be classified as Presenter or B-roll before proceeding:**

| Type | Definition | Audio Workflow |
|------|-----------|----------------|
| **Presenter** | On-camera talent speaking | Speech prompt in Veo → Voice Change (Phase 5c) |
| **B-roll** | Visual-only (no on-camera speech) | TTS narration → Bake onto video (Phase 5d) |

Classification drives the entire audio workflow. Get this right first.

### B-Roll Image Generation Choice (Phase 3)

**Present this choice for B-roll scenes:**

```
┌─────────────────────────────────────────────────────┐
│  B-ROLL IMAGE STYLE                                 │
├─────────────────────────────────────────────────────┤
│  How should B-roll images be generated?             │
│                                                     │
│  [A] Reference Group + "Add to Image" mode          │
│      Uses ref group images as composition guide     │
│      Best for: matching a specific visual style     │
│                                                     │
│  [B] Reference Group + "Style Transfer" mode        │
│      Transfers the artistic style from ref group    │
│      Best for: consistent illustration/art style    │
│                                                     │
│  [C] Character Reference (generate_image + char_id) │
│      Uses character ref for face/body consistency   │
│      Best for: presenter appears in B-roll too      │
│                                                     │
│  [D] Fresh Generation (no reference)                │
│      Generate from prompt only, no style constraint │
│      Best for: maximum creative freedom             │
└─────────────────────────────────────────────────────┘
```

- If A or B: Ask user for `reference_group_id` (list with `mcp__go-bananas__list_reference_groups`)
- Reference mode maps to Go Bananas `reference_mode`: `"add_to_image"` or `"style"`

### Voice Selection (before Phase 5b)

```bash
# List user's saved voices (My Voices)
python scripts/generate_tts.py --my-voices

# List all available voices (grouped: My Voices, Default, etc.)
python scripts/generate_tts.py --list-voices
```

User picks a voice for TTS AND voice changer (same voice = consistent narration).

### Voice Design Checkpoint (before Phase 5b TTS)

**If user wants a custom voice instead of existing voices, offer these options:**

```
┌─────────────────────────────────────────────────────────────┐
│  VOICE DESIGN                                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [A] Use existing voice (--voice-name or --voice-id)         │
│      → Skip to Phase 5b TTS with selected voice              │
│                                                              │
│  [B] Use a voice preset (professional, dramatic, etc.)       │
│      → python scripts/voice_designer.py --list-presets       │
│      → python scripts/voice_designer.py --design-voice       │
│          --preset-voice professional-narrator --save-voice   │
│                                                              │
│  [C] Design custom voice (simple - 4 questions)              │
│      → python scripts/voice_designer.py --design-voice       │
│          --questionnaire simple --save-voice                 │
│      Questions: Gender, Age, Accent, Tone                    │
│                                                              │
│  [D] Design custom voice (detailed - 8 questions)            │
│      → python scripts/voice_designer.py --design-voice       │
│          --questionnaire detailed --save-voice               │
│      Adds: Emotion, Pacing, Audio Quality, Special Quality   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Voice Design Workflow:**

1. Design generates 3 preview audio samples
2. Browser opens with audio players for A/B comparison
3. User selects preferred voice (1, 2, or 3)
4. Voice saved to ElevenLabs library with `--save-voice --voice-name "Name"`
5. Use saved voice in Phase 5b: `--voice-name "Name"`

**Available Voice Presets:**
| Preset | Best For |
|--------|----------|
| `professional-narrator` | Corporate, training, business |
| `documentary-narrator` | Documentaries, nature, history |
| `energetic-announcer` | Commercials, promos, sports |
| `friendly-presenter` | Tutorials, lifestyle, wellness |
| `storyteller` | Audiobooks, children's stories |
| `dramatic-narrator` | Movie trailers, game cinematics |
| `tech-explainer` | Tech tutorials, software demos |
| `podcast-host` | Podcasts, vlogs, social media |
| `indian-professional` | Indian market, tech corporate |
| `calm-meditation` | Meditation, sleep, wellness apps |

**Extract preview text from transcript (recommended):**
```bash
python scripts/voice_designer.py --design-voice \
  --preset-voice friendly-presenter \
  --transcript "projects/{slug}/audio/tts/editable_transcript.json" \
  --save-voice --voice-name "Demo Narrator"
```

### Audio Preferences Checkpoint (before Phase 5c)

**MUST ask the user these questions before proceeding with audio pipeline:**

```
┌─────────────────────────────────────────────────────┐
│  AUDIO PREFERENCES                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. B-roll sound effects:                           │
│     [A] Keep Veo ambient sounds mixed with          │
│         narration (--preserve-sfx, recommended)     │
│     [B] Clean narration only, no SFX                │
│         (--no-preserve-sfx)                         │
│                                                     │
│  2. Background music level:                         │
│     [A] Subtle 15% (--narrated, for narrated        │
│         content with SFX)                           │
│     [B] Low 25% (--presenter, for talking head)     │
│     [C] Balanced 60% (default, ambient B-roll)      │
│                                                     │
│  3. Narration boost (when keeping SFX):             │
│     [A] Standard 1.0x (--tts-volume 1.0)            │
│     [B] Boosted 1.3x (--tts-volume 1.3,            │
│         recommended when preserving SFX)            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Use answers to set flags in Phase 5d (bake) and Phase 6 (stitch).

### Phase 5c: Voice Change Presenter Scenes

Transform Veo-generated speech to a consistent voice via ElevenLabs Speech-to-Speech:

```bash
python scripts/generate_tts.py \
  --voice-change \
  --videos-dir "projects/{slug}/videos" \
  --scenes "1,5,7" \
  --voice-id "TxGEqnHWrfWFTfGW9XjX" \
  --seed 42 \
  --remove-bg-noise \
  --yes
```

- `--seed 42`: Deterministic output (same seed = same voice transformation)
- `--remove-bg-noise`: Clean Veo background noise before transformation
- Output: `run001_scene_1_vc.mp4` (original preserved)

### Phase 5d: Bake Narration onto B-roll

Overlay TTS narration per-scene onto B-roll videos:

```bash
# Default: mix TTS with video's ambient SFX (recommended)
python scripts/generate_tts.py \
  --bake-narration \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --scenes "2,3,4,6,8,9,10,11" \
  --preserve-sfx \
  --tts-volume 1.0 \
  --sfx-volume 0.7 \
  --yes

# Clean narration only (no video SFX, old behavior)
python scripts/generate_tts.py \
  --bake-narration \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --scenes "2,3,4,6,8,9,10,11" \
  --no-preserve-sfx \
  --yes

# Redo: restore originals from backups and re-bake
python scripts/generate_tts.py \
  --bake-narration --redo \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --scenes "2,3,4,6,8,9,10,11" \
  --preserve-sfx --tts-volume 1.3 --sfx-volume 0.5 \
  --yes
```

- `--preserve-sfx` (default): Mixes TTS narration with video's existing audio (ambient SFX) using FFmpeg amix
- `--no-preserve-sfx`: Replaces video audio with TTS only (old behavior)
- `--tts-volume`: TTS narration level (default 1.0, boost to 1.3 when mixing with SFX)
- `--sfx-volume`: Video SFX level (default 0.7, lower for quieter ambience)
- `--redo`: Auto-restores originals from `backups/` before re-baking (no manual file copying)
- Output: `run001_scene_2_narrated.mp4` (original preserved, or restored from backup with --redo)

### Phase 5e: Swap Processed Files

Rename processed files to primary filenames for stitching:

```bash
python scripts/generate_tts.py \
  --swap \
  --videos-dir "projects/{slug}/videos" \
  --scenes "1,2,3,4,5,6,7,8,9,10,11" \
  --yes
```

- Backs up originals to `backups/` subfolder
- `_vc` files swap for presenter scenes, `_narrated` for B-roll
- After swap, primary filenames contain processed audio

> **Available features:** `--redo` on bake-narration auto-restores backups for re-baking with different volumes, `--extend-video` freezes last frame when TTS exceeds video length, `--tts-pattern "scene_{N}_combined.mp3"` for custom TTS filename patterns.

### Phase 6: Stitch with Audio Preset

```bash
# Narrated content (recommended for narrated videos with SFX)
python scripts/stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/narrated.mp4" \
  --narrated

# Presenter/voice-over mode
python scripts/stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/narrated.mp4" \
  --presenter
```

| Preset | Music | Video | Use Case |
|--------|-------|-------|----------|
| (default) | 60% | 30% | Ambient B-roll, no speech |
| `--presenter` | 25% | 85% | Talking head, voice-over |
| `--narrated` | 15% | 85% | Narrated content with SFX |

- `--narrated` and `--presenter` are mutually exclusive
- Both preserve existing audio in each video (already baked)
- Use `--narrated` when B-roll has preserved SFX (music stays very subtle)

### Narration Script Writing (Phase 2)

After transcription and prompt rewriting, write narration text for ALL scenes in `editable_transcript.json`:

```json
{
  "scenes": {
    "1": "[passionately] Sanatana Dharma is not just a religion...",
    "2": "[gravely] While other traditions built their faiths...",
    "3": "The ancient sages sat in deep meditation...",
    "11": "[softly, warmly] Sit quietly. Breathe deeply..."
  }
}
```

**Emotional tags** (requires `--dialogue --model-id eleven_v3`):
- Emotions: `[sad]`, `[laughing]`, `[whispering]`, `[excited]`, `[reverently]`
- Audio events: `[leaves rustling]`, `[gentle footsteps]`
- Direction: `[auctioneer]`, `[storyteller]`, `[contemplatively]`

### Narration Presets

| Preset | stability | similarity | style | speed | Best For |
|--------|-----------|------------|-------|-------|----------|
| Dramatic | 0.3 | 0.75 | 0.5 | 0.9 | Spiritual, documentary, storytelling |
| Professional | 0.6 | 0.80 | 0.2 | 1.0 | Corporate, product, explainer |
| Energetic | 0.4 | 0.70 | 0.7 | 1.1 | Social media, ads, promos |
| Calm | 0.7 | 0.85 | 0.1 | 0.9 | Meditation, wellness, ASMR |

### Key Rules (Lessons Learned)

1. **Scene classification**: Presenter scenes have on-camera talent speaking. B-roll scenes are visual-only. Classification drives the entire audio workflow.

2. **Speech enforcement pattern**: When generating presenter scenes in Phase 4, use:
   `"He speaks exactly these words and nothing else: [dialogue]. He stops speaking after finishing the line. No additional speech."`
   This prevents Veo from ad-libbing extra words.

3. **Narration length rule**: ~20-25 words per 8-second scene fills audio properly. Shorter text leaves silence gaps.

4. **Per-scene audio baking**: Each scene's audio MUST be baked into the video individually BEFORE stitching. Never overlay a single narration track post-stitch (causes timing drift).

5. **Voice consistency**: Veo generates a different voice per clip. Voice Changer normalizes all presenter clips to one consistent voice.

6. **TTS padding**: TTS audio is padded with silence to exactly match video duration using FFmpeg concat+atrim filter before baking.

7. **File swap workflow**: Voice-changed files get `_vc` suffix, baked files get `_narrated` suffix. Must swap to primary filenames before stitching.

8. **Stitch preset selection**: Use `--narrated` (music=15%, video=85%) for narrated content with preserved SFX. Use `--presenter` (music=25%, video=85%) for talking head/voice-over. They are mutually exclusive.

9. **Speed as duration control**: If TTS at speed=1.0 produces 6s for an 8s video, either pad with silence (default) or slow speech via `--speed 0.75` to stretch closer to target duration.

10. **SFX mixing**: When baking narration with `--preserve-sfx`, video ambient sounds (wind, birds, crowd) blend with TTS. Boost `--tts-volume 1.3` to keep narration prominent over SFX. Lower `--sfx-volume 0.5` for quieter ambience.

11. **Redo workflow**: When re-baking narration (e.g., after adjusting volumes), use `--redo` to auto-restore originals from `backups/` instead of manually copying files back.

---

