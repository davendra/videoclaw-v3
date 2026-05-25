# Audio Presets Reference

Audio presets provide optimized volume settings for different content types. Use these presets in `generate_tts.py` and `stitch_video.py` for consistent audio quality.

## Named Presets

### Kids Narrated (`--preset kids-narrated`)
Optimized for children's content with clear, prominent narration.

| Setting | Value | Description |
|---------|-------|-------------|
| `tts_volume` | 2.0 | Voice very prominent |
| `sfx_volume` | 0.4 | SFX subtle in background |
| `music_volume` | 0.15 | Music barely audible |

**Best for:**
- Children's educational videos
- Bedtime stories
- Animated kids content
- Audiobook-style narration

### Narrator (`--preset narrator`)
Balanced settings for documentary-style narration.

| Setting | Value | Description |
|---------|-------|-------------|
| `tts_volume` | 1.5 | Clear narration |
| `sfx_volume` | 0.6 | Moderate SFX |
| `music_volume` | 0.20 | Subtle music |

**Best for:**
- Documentaries
- Educational content
- Explainer videos
- Corporate presentations

### Presenter (`--preset presenter`)
For talking-head or voice-over content where voice is primary.

| Setting | Value | Description |
|---------|-------|-------------|
| `tts_volume` | 1.0 | Natural voice level |
| `sfx_volume` | 0.85 | Full SFX |
| `music_volume` | 0.25 | Low background music |

**Best for:**
- Talking head videos
- Product demos
- Tutorials
- Interview-style content

### Narrated (`--preset narrated`)
For narrated content with preserved ambient sounds.

| Setting | Value | Description |
|---------|-------|-------------|
| `tts_volume` | 1.0 | Natural voice level |
| `sfx_volume` | 0.85 | Full ambient SFX |
| `music_volume` | 0.15 | Very subtle music |

**Best for:**
- Travel videos with ambient audio
- Nature documentaries
- Videos where scene sounds matter
- Cinematic narration

### Documentary (`--preset documentary`)
Cinematic feel with dramatic narration.

| Setting | Value | Description |
|---------|-------|-------------|
| `tts_volume` | 1.3 | Emphasized narration |
| `sfx_volume` | 0.7 | Moderate SFX |
| `music_volume` | 0.30 | Present but not overwhelming |

**Best for:**
- Documentary films
- Historical content
- Dramatic storytelling
- Cinematic presentations

### Ambient (`--preset ambient`)
For B-roll heavy content with minimal narration.

| Setting | Value | Description |
|---------|-------|-------------|
| `tts_volume` | 0.8 | Soft narration |
| `sfx_volume` | 1.0 | Full ambient sounds |
| `music_volume` | 0.50 | Prominent music |

**Best for:**
- Mood videos
- Travel montages
- B-roll compilations
- Atmospheric content

## Usage Examples

### In generate_tts.py (baking narration)

```bash
# Kids content - voice very prominent
python generate_tts.py \
  --bake-narration \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --scenes "1,2,3,4" \
  --preset kids-narrated \
  --yes

# Documentary - emphasized narration
python generate_tts.py \
  --bake-narration \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --scenes "1,2,3,4" \
  --preset documentary \
  --yes
```

### In stitch_video.py

```bash
# Narrated content preset
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/narrated.mp4" \
  --narrated

# Presenter preset
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/presenter.mp4" \
  --presenter
```

## Custom Volume Levels

Override preset values with explicit flags:

```bash
python generate_tts.py \
  --bake-narration \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --scenes "1,2,3" \
  --preset narrated \
  --tts-volume 1.5 \  # Override preset's tts_volume
  --sfx-volume 0.5 \  # Override preset's sfx_volume
  --yes
```

## Language-Specific Recommendations

Different languages may need volume adjustments due to speech patterns:

| Language | Recommended TTS Volume | Notes |
|----------|------------------------|-------|
| English | 1.0 | Baseline |
| Hindi | 1.2-1.5 | Longer words, softer consonants |
| Spanish | 1.0-1.2 | Generally clear |
| French | 1.1-1.3 | Softer endings |
| German | 1.0 | Clear consonants |
| Japanese | 1.2-1.5 | Softer overall |
| Korean | 1.1-1.3 | Moderate boost |
| Chinese | 1.0-1.2 | Tonal clarity important |

## Voice Type Calibration

Different ElevenLabs voice types may need calibration:

| Voice Type | Base TTS Volume | Notes |
|------------|-----------------|-------|
| Deep male | 0.9-1.0 | Naturally prominent |
| Soft female | 1.2-1.4 | May need boost |
| Child voice | 1.3-1.5 | Often softer |
| Narrator | 1.0-1.1 | Usually well-calibrated |

## Audio Normalization

Always use `--normalize` for consistent loudness across scenes:

```bash
# Generate TTS with normalization (default: -16 LUFS)
python generate_tts.py \
  --edit "editable_transcript.json" \
  --output-dir "audio/tts" \
  --voice-id "VoiceID" \
  --normalize \
  --yes

# Custom loudness target
python generate_tts.py \
  --edit "editable_transcript.json" \
  --output-dir "audio/tts" \
  --voice-id "VoiceID" \
  --normalize \
  --loudness-target -14 \  # Louder than default
  --yes
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Narration drowned by SFX | Increase `--tts-volume` to 1.3-1.5, decrease `--sfx-volume` to 0.4-0.5 |
| Voice too loud/clipped | Decrease `--tts-volume` to 0.8-0.9, use `--normalize` |
| Music overpowers speech | Use `--preset narrated` (15% music) instead of default (60%) |
| Inconsistent volume across scenes | Use `--normalize` flag during TTS generation |
| SFX too distracting | Use `--no-preserve-sfx` to remove video audio entirely |
| Need to re-adjust volumes | Use `--redo` flag to restore backups and re-bake |
