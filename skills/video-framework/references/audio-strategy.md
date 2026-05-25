# Audio Strategy Reference

Maps Q6 (audio plan) to the right CLI commands, TTS flags, and sound direction templates.

## Decision Tree

```
Q6 answer
├── "Narration / voiceover"
│   ├── presenter on-screen (lip sync) → Seedance audio-lipsync
│   │   └── --backend seedance --mode audio-lipsync --tts-dir-lipsync "audio/tts"
│   └── voiceover off-screen → ElevenLabs TTS + bake
│       └── generate_tts.py --edit transcript.json --voice-name "Rachel"
│           then: generate_tts.py --bake-narration --preserve-sfx
├── "Background music only"
│   └── generate_music.py --prompt "vibe description" --duration Ns
│       then: stitch_video.py --audio music.mp3
├── "BGM from reference audio" (audio clone)
│   └── seedance_omni.py --audio-ref "reference.mp3"
├── "Sound effects only"
│   └── Direct sound in scene prompts: "Sound: [SFX]. No music, no vocals."
└── "No audio"
    └── stitch_video.py --no-preserve-audio (omit --audio flag)
```

## Voice Selection Guide

| Use Case | Recommended Voice | ElevenLabs ID |
|----------|-------------------|---------------|
| Luxury brand | Rachel | `21m00Tcm4TlvDq8ikWAM` |
| Professional/corporate | Liam | `TX3LPaxmHKxFdv7VOQHJ` |
| Bunty presenter | Bunty voice | `nwj0s2LU9bDWRKND5yzA` |
| Nex presenter | Liam | `TX3LPaxmHKxFdv7VOQHJ` |
| Davendra presenter | Davendra | `0vPMop5s0QLJlWyI0lJn` |
| Dev presenter (youth) | Dev | `qJ7m4GcMB4xUvRmdrrlk` |

## Sound Direction Templates by Scene Type

Append to the END of each scene prompt:

| Scene Type | Sound Direction |
|------------|----------------|
| Product reveal | `Sound: soft material texture, gentle tap. No music, no vocals.` |
| Nature/outdoor | `Sound: wind rustling leaves, distant birds. No background music.` |
| Urban/street | `Sound: city ambience, distant traffic, footsteps. No background music.` |
| Food/beverage | `Sound: sizzling, pouring liquid, utensil clink. No music.` |
| Fashion/beauty | `Sound: fabric swish, subtle movement. No music, no vocals.` |
| Sports/action | `Sound: crowd energy, impact sounds, sneaker squeak. No background music.` |
| Baby/kids | `Sound: baby giggles, soft toy sounds, gentle cooing. No music.` |
| Presenter speaking | `[omit Sound: — use lip-sync audio instead]` |

## Audio Mixing Volumes (stitch_video.py)

| Content Type | Music Vol | Video/SFX Vol | Flag |
|-------------|-----------|---------------|------|
| B-roll product | 0.6 | 0.3 | (default) |
| Narrated content | 0.15 | 0.85 | `--narrated` |
| Presenter voice-over | 0.25 | 0.85 | `--presenter` |
| Music video / no speech | 0.8 | 0.2 | `--music-volume 0.8 --video-volume 0.2` |

## Multi-Voice Workflow (2+ characters)

For videos with narrator + character voices:
```bash
# Generate per-character TTS
generate_tts.py --voice-map '{"narrator":"Rachel","character1":"Adam"}' \
  --transcript transcript.json --output-dir "audio/tts"
```
