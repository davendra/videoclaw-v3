# Nex Presenter

*Last Updated: 2026-05-14*

Create a professional narrated video from a PDF (or pre-animated MP4) slide deck, featuring **Nex** — a 3D Pixar-style tech commentator — as the host for intro and outro segments. Slides are animated with subtle motion and narrated with AI-generated commentary. Soft subtitles are baked into the final container.

**Input**: A PDF file OR a pre-animated slide MP4 + PDF source for narration
**Output**: A complete MP4 with Nex intro (2 scenes) -> narrated animated slides -> Nex outro (2 scenes) + optional background music + soft subtitle track + optional "The Nex Brief" branding

---

## ⚠️ READ FIRST — Character ID + Veo Content Filter

**Use ONLY `character_id=98` (Nex Pixar)** for all Veo I2V lip-sync. Veo's first-frame content filter rejects photorealistic human faces — confirmed on the Davendra Cinematic test (character_id=118), 2026-05-13. Pixar/3D-stylized characters pass the filter reliably; photorealistic variants do not.

| character_id | Style | Veo I2V filter |
|---|---|---|
| `98` | 3D Pixar (Nex canonical) | ✅ Reliable |
| (hypothetical photorealistic Nex) | Cinematic / realistic | ❌ Would be rejected — don't try |

**If a photorealistic tech presenter is required**, switch backends:
- **Seedance audio-lipsync** (`--backend seedance --mode audio-lipsync`) — different filter, accepts photorealistic faces. Requires `SUTUI_API_KEY`. Generates TTS-driven lip-sync in 1 step (no voice-change post-process needed).

Full memory file: `~/.claude/projects/-Users-davendrapatel-Documents-GitHub-video-creation-projects/memory/veo-photorealistic-character-filter.md`

### Identity-lock pattern (cross-pollinated from `skills/bunty/SKILL.md`)

If Nex starts drifting on Pro (face shape mismatch, wrong jaw/hair, wrong skin tone — confirmed common pattern on `character_id=97/Bunty`), copy bunty's helper pattern: write a `nex_helpers.build_nex_image_kwargs()` function that prepends a canonical visual-anchor prompt + a negative prompt blocking the observed drift modes, and **always call through the helper** instead of `mcp__go-bananas__generate_image` with just `character_id=98` + a vibe description. See `skills/video-replicator/scripts/bunty_helpers.py` as the reference implementation. Nex has been stable enough on Pro to not need this yet — but it's the proven fix the moment drift starts.

---

## Quick Start

When this skill is triggered, ask the user:

```
+-----------------------------------------------------+
|  NEX PRESENTER                                       |
+-----------------------------------------------------+
|                                                      |
|  Please provide:                                     |
|  1. PDF file path (slides + narration source)        |
|  2. Topic/subject (1 sentence)                       |
|                                                      |
|  Optional:                                           |
|  - Pre-animated slide MP4? (otherwise we F2V-loop)   |
|  - Custom Nex images? [No, use defaults]             |
|  - Project name? [auto from PDF filename]            |
|  - Quality tier? [fast = 10 cr / quality = 100 cr]   |
|  - Soft subtitles? [yes, mov_text]                   |
|  - Add "The Nex Brief" branding? [optional]          |
|                                                      |
+-----------------------------------------------------+
```

---

## Mandatory User-Approval Gates

Three gates govern every Nex run. Do not proceed past any gate without explicit user approval, even when the user has previously approved a similar plan.

| Gate | When | What to show |
|---|---|---|
| **GATE 1 — Script review** | After Phase 2 | All slide narration scripts + 4 intro/outro dialogue lines + total word/duration estimate |
| **GATE 2 — Image review** | After Phase 3 | The Nex first-frame images (intro 1, intro 2, outro 1, outro 2). User confirms before paying for Veo I2V. |
| **GATE 3 — Final review** | After Phase 8 | The final MP4 opened in player. Offer surgical regen (Phase 10) for any scene the user wants changed. |

Per project memory rules — never proceed to video generation without explicit approval.

---

## Constants

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Nex Character ID** | `98` | Go Bananas character reference — Pixar only |
| **Voice** | Liam (`TX3LPaxmHKxFdv7VOQHJ`) | ElevenLabs — used for ALL audio (TTS + voice change) |
| **TTS Model** | `eleven_flash_v2_5` | Fast, good quality |
| **Voice Change Model** | `eleven_multilingual_sts_v2` | Speech-to-speech |
| **Voice Change Seed** | `42` | Deterministic output |
| **Slide Animation** | Subtle, terminal-themed | 80% still, one gentle ambient effect |
| **Default Video Quality** | `fast` | 10 credits / scene. Use `quality` (100 cr) for hero intros. |
| **Background Music** | 5% volume | Auto-generated per topic |
| **TTS Bake Volumes** | TTS=2.5, SFX=0.15 | Narration-forward mix |
| **Nex Scene Count** | 4 (2 intro + 2 outro) | Scenes numbered N+1 to N+4 where N = slide count |
| **Subtitle Codec** | `mov_text` (soft) | FFmpeg on macOS has NO libass — burn-in subs fail. Soft mov_text + sidecar `.srt` is the standard. |
| **Default Nex Images** | `assets/nex_intro_{1,2}.jpg`, `assets/nex_outro_{1,2}.jpg` | 1280x720 landscape |
| **Logo Intro** | `assets/nex_brief_intro.mp4` | 6s, 48kHz, 1280x720 |
| **Text Overlay** | `assets/text_overlay.png` | "THE NEX BRIEF" transparent PNG |
| **Title Card Duration** | 4s | Hold time for episode title card |

---

## Pipeline Overview

```
Phase 1:  Extract slides from PDF (or skip if user provided pre-animated MP4)
Phase 2:  AI-generate narration script (slides) + Nex dialogue (intro/outro)
          ----- GATE 1: script review -----
Phase 3:  Prepare Nex images (defaults or fresh Go Bananas)
          ----- GATE 2: image review -----
Phase 4a: Generate F2V videos for slides (subtle animation)   ← skip if --slides-mp4
Phase 4b: Generate I2V videos for Nex scenes (with speech)
Phase 5a: Generate TTS for slides (Liam voice)
Phase 5b: Voice-change Nex scenes (Liam voice)
Phase 5c: Loop slide videos to match TTS duration             ← skip if --slides-mp4
Phase 5d: Bake TTS onto looped slides (or onto pre-animated MP4 — see 4a-alt)
Phase 6:  Generate background music
Phase 7:  Normalize all scenes
Phase 8:  Concat + add music
Phase 9:  Generate SRT + mux soft subtitles
          ----- GATE 3: final review -----
Phase 10: Surgical re-generation (optional — fix specific scenes)
Phase 11: Branding (optional) + Copy to ~/Documents and open
```

---

## Phase 1: Extract Slides from PDF

```bash
python skills/video-replicator/scripts/extract_pdf_slides.py \
  --pdf "{pdf_path}" \
  --output-dir "projects/{slug}/slides" \
  --output-json "projects/{slug}/analysis/slides.json" \
  --total-duration 0
```

- `--total-duration 0` because duration is driven by TTS, not fixed timing
- Outputs: `slides/slide_001.jpg` through `slide_NNN.jpg`
- Copy slides to images dir: `scene_{N}_frame.jpg` for N = 1 to slide_count
- Auto-resize landscape images to 1280x720 (`parallel_video_gen.py --dry-run` triggers the resize step)

---

## Phase 2: AI-Generate All Scripts

### 2a: Slide Narration

Read each `slide_NNN.jpg` and write narration.

**Rules:**
- 20-25 words per scene (fills ~8-10s of TTS — tech-commentator cadence is brisker than executive)
- Conversational tech commentary tone — like a YouTube breakdown, smart but not stuffy
- Reference specific details visible on the slide (numbers, names, terminal output)
- No filler phrases ("as you can see", "let me tell you")
- Numbers as words for TTS ("twenty twenty-six" not "2026")

**Output**: `projects/{slug}/audio/tts/slides_transcript.json`

```json
{
  "_instructions": "Nex slide narration. 20-25 words per scene, conversational tech-commentary tone.",
  "scenes": {
    "1": "Slide one narration text...",
    "2": "Slide two narration text..."
  }
}
```

### 2b: Nex Intro/Outro Dialogue

Scene numbering: scenes 17, 19 (intro chained pair) and 20, 21 (outro chained pair) — same convention as Davendra/Bunty for cross-skill compatibility.

**Intro pattern (chained — scene 17 -> scene 19):**
- Scene 17: Hook — what dropped this week, why it matters
- Scene 19: Setup — what we're about to break down

**Outro pattern (chained — scene 20 -> scene 21):**
- Scene 20: Key takeaway — the headline insight
- Scene 21: Call to action / sign-off — `"I'm Nex, and I'll catch you in the next breakdown. Peace."`

**Dialogue length**: 25-35 words per 8s scene. Outro sign-off (scene 21) = **15-20 words only** for dramatic pacing.

**Critical — Speech enforcement pattern** (every Nex prompt MUST include all four):

1. `"Character's eyes are wide open from the very first frame."`
2. `"He speaks exactly these words and nothing else: \"...\""`
3. `"He stops speaking after finishing the line. No additional speech."`
4. `"After finishing speaking, he becomes completely still and frozen in place for the final 1 second."`

**Output**: `projects/{slug}/nex_scenes.json` + `projects/{slug}/dialogue_pair1.json` + `dialogue_pair2.json`.

**STOP at GATE 1.** Present narration plan + dialogue + word counts. Wait for "go".

---

## Phase 2.5: Pre-flight gates (recommended — Bunty pattern)

Two cheap Gemini Vision checks catch issues before paying for TTS / Veo:

```bash
# Verify each slide's narration actually describes that slide's image.
# Catches off-by-one beats and slide compression.
python3 skills/video-replicator/scripts/bunty_narration_check.py \
  --project "projects/<slug>"

# Predict which slides will trip Veo's image content filter.
# Saves ~$0.50 per rejected scene at quality tier.
python3 skills/video-replicator/scripts/bunty_image_filter_check.py \
  --project "projects/<slug>"
```

Both gates exit non-zero on issues. Fix the transcript / regenerate problematic slides BEFORE proceeding to Phase 3. Cost: ~$0.01 + 30s for both gates.

The check scripts are presenter-agnostic — they read the slide PNGs + narration JSON from your project root and don't require Bunty-specific config.

---

## Phase 3: Prepare Nex Images

### Default images (recommended)

```bash
SKILL_DIR="skills/nex-presenter/assets"
IMAGES_DIR="projects/{slug}/images"

cp "$SKILL_DIR/nex_intro_1.jpg" "$IMAGES_DIR/run001_scene_17_frame.jpg"
cp "$SKILL_DIR/nex_intro_1.jpg" "$IMAGES_DIR/run001_scene_17_frame_landscape.jpg"
cp "$SKILL_DIR/nex_outro_1.jpg" "$IMAGES_DIR/run001_scene_20_frame.jpg"
cp "$SKILL_DIR/nex_outro_1.jpg" "$IMAGES_DIR/run001_scene_20_frame_landscape.jpg"
```

### Custom images (if user requests)

Generate fresh Nex images — **always character_id=98, always gemini-pro-image**:

```python
mcp__go-bananas__generate_image(
    prompt="3D Pixar animated young tech commentator in modern gaming/streaming studio with RGB lighting and dual monitors. {pose}. Cinematic lighting, high detail. WIDE HORIZONTAL shot.",
    character_id=98,
    aspect_ratio="16:9",
    model_id="gemini-pro-image",   # REQUIRED — flash ignores character refs
)
```

**Pose bank**:
| Scene | Pose |
|---|---|
| Intro 1 (17) | Leaning forward, energetic hand gestures, excited expression |
| Intro 2 (19) | Continues thoughtful gesture, eyes engaging camera |
| Outro 1 (20) | Reflective leaning back, making a measured point |
| Outro 2 (21) | Casual wave, satisfied closing smile |

**Setting bank**:
- Modern gaming/streaming studio with RGB lighting and multiple monitors (default)
- Clean tech-podcast setup with neon accent lighting
- Server-room background with soft volumetric haze (for infrastructure topics)

**STOP at GATE 2.** Show rendered intro+outro images. Confirm before paying for Veo.

### Cache hygiene (Reapit session learning)

Before running Veo, **clear veo-cli's local cache** if you have regenerated images for a scene that previously generated:

```bash
rm -f /Users/davendrapatel/Documents/GitHub/video-creation-projects/veo-cli/output-videos/{slug}-*scene_{17,19,20,21}*.mp4
```

veo-cli caches outputs by tag, not by image hash. A regenerated image with the same scene number can silently reuse the prior generation. Confirmed regression on Reapit Strategic Briefing 2026-05-13. Always clear when regenerating mid-project.

---

## Phase 4a: Generate Slide Videos (F2V Loop)

Standard F2V loop generation. **Skip this phase entirely if the user provided a pre-animated MP4 (Phase 4a-alt below).**

```bash
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" \
  --mode frames-to-video \
  --f2v-loop \
  --images-dir "projects/{slug}/images" \
  --scenes "$(cat projects/{slug}/f2v_slides_batch1.json)" \
  --ratio landscape \
  --quality fast \
  --variations 1 \
  --parallel 2 \
  --fallback-quality \
  --auto-simplify \
  --allow-stale \
  --yes
```

**Animation prompt pattern**:
```
Camera static. {one_gentle_ambient_effect}. Very minimal motion, 80 percent of frame completely still.
```

Ambient effect bank (pick one per slide):
- Gentle ambient glow shifts across the dark interface
- Soft gradient light drift across the background
- Gentle upward light sweep across the chart/graphic
- Soft light pulse traveling along connecting lines
- Gentle cursor blink animation on terminal prompts
- Subtle data visualization shimmer

**Per-slide Gemini Vision drafting (recommended — Bunty pattern)**:
```bash
python3 skills/video-replicator/scripts/bunty_animate_slides.py \
  --project projects/{slug} --draft-prompts --style minimal --yes
```
`--style minimal` produces calm, tech-appropriate motion. Auto-recovers from Veo content-filter rejection with `SAFE_FALLBACK_PROMPT` and warns on high-risk vocab (`burst`, `explosion`, `crash`, etc.).

---

## Phase 4a-alt: Pre-Animated MP4 Source (Reapit pattern)

When the user supplies their own animated slide video (e.g. Figma/After Effects export), skip F2V generation entirely.

### Step 1 — Probe + plan

```bash
ANIM=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "{user_provided_anim.mp4}")
TTS_TOTAL=$(python3 -c "
import json
m = json.load(open('projects/{slug}/audio/narration_manifest.json'))
print(f\"{sum(v['duration'] for v in m['scenes'].values()):.3f}\")
")
PTS=$(python3 -c "print($TTS_TOTAL / $ANIM)")
echo "Animation: ${ANIM}s | TTS total: ${TTS_TOTAL}s | PTS factor: ${PTS}"
```

Keep PTS in **0.85 - 1.20** range. Outside that, the visual feel breaks down — adjust TTS instead.

### Step 2 — Slow (or speed) the animation

```bash
ffmpeg -y -i "{user_provided_anim.mp4}" \
  -filter:v "setpts=${PTS}*PTS" \
  -an \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  "projects/{slug}/final/slides_slow.mp4"
```

### Step 3 — Build narration track + mux

```bash
python3 -c "
import json
m = json.load(open('projects/{slug}/audio/narration_manifest.json'))
for i in range(1, len(m['scenes']) + 1):
    print(f\"file 'audio/tts/scene_{i}_tts.mp3'\")
" > projects/{slug}/_narration_list.txt
ffmpeg -y -f concat -safe 0 -i projects/{slug}/_narration_list.txt \
  -c:a aac -b:a 192k projects/{slug}/audio/narration_track.m4a

ffmpeg -y \
  -i "projects/{slug}/final/slides_slow.mp4" \
  -i "projects/{slug}/audio/narration_track.m4a" \
  -c:v copy -c:a aac -b:a 192k \
  -map 0:v -map 1:a \
  "projects/{slug}/final/segments/seg_slides.mp4"
```

`seg_slides.mp4` is the drop-in replacement for all the per-slide baked clips.

---

## Phase 4b: Generate Nex Videos (I2V with Speech)

Chained pair generation — same convention as Davendra/Bunty.

### Step 1 — First frames (scenes 17, 20)

```bash
python3 skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --mode frames-to-video \
  --scenes '{"17":"<intro1 prompt>","20":"<outro1 prompt>"}' \
  --lip-sync \
  --dialogue '{"17":"<intro1 dialogue>","20":"<outro1 dialogue>"}' \
  --image-run run001 --ratio landscape --quality fast \
  --variations 1 --allow-stale --continue --yes
```

### Step 2 — Extract last frames for chained continuations

```bash
ffmpeg -y -sseof -0.1 -i projects/{slug}/videos/run001_scene_17.mp4 \
  -frames:v 1 -q:v 2 projects/{slug}/images/run001_scene_19_frame.jpg
cp projects/{slug}/images/run001_scene_19_frame.jpg \
   projects/{slug}/images/run001_scene_19_frame_landscape.jpg

ffmpeg -y -sseof -0.1 -i projects/{slug}/videos/run001_scene_20.mp4 \
  -frames:v 1 -q:v 2 projects/{slug}/images/run001_scene_21_frame.jpg
cp projects/{slug}/images/run001_scene_21_frame.jpg \
   projects/{slug}/images/run001_scene_21_frame_landscape.jpg
```

### Step 3 — Chained continuations (scenes 19, 21)

Same `parallel_video_gen.py` invocation as Step 1, but with scenes 19 and 21 dialogue.

---

## Phase 5a: Generate TTS for Slides

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --edit "projects/{slug}/audio/tts/slides_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --voice-id "TX3LPaxmHKxFdv7VOQHJ" \
  --yes
```

### Per-scene regeneration (Reapit pattern)

When the user says "regen audio for slide 4", do not regenerate everything:

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --edit "projects/{slug}/audio/tts/slides_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --scenes "4" \
  --voice-id "TX3LPaxmHKxFdv7VOQHJ" \
  --yes
```

The `--scenes` flag refreshes only the listed scene MP3s + their entries in `narration_manifest.json`. Much cheaper than a full rerun.

If you used Phase 4a-alt (pre-animated MP4), **re-run the slow + mux steps** after a per-scene regen because total TTS duration has changed.

### CRITICAL: mono->stereo bug (FIXED 2026-02-20 but kept here for reference)

`generate_tts.py` now auto-detects mono audio via `_probe_audio_channels()` and prepends `pan=stereo|FL=c0|FR=c0`. Both `replace_audio_in_video()` and `bake_narration_to_video()` are fixed. No manual workaround needed any more — but if you ever see -91 dB silent output, that's the mono->stereo bug recurring.

---

## Phase 5b: Voice-Change Nex Scenes

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --voice-change \
  --videos-dir "projects/{slug}/videos" \
  --scenes "17,19,20,21" \
  --voice-id "TX3LPaxmHKxFdv7VOQHJ" \
  --seed 42 \
  --remove-bg-noise \
  --yes
```

Output: `run001_scene_{17,19,20,21}_vc.mp4`. Mandatory — Veo gives different voices per clip.

---

## Phase 5c, 5d: Loop + Bake (skip if using Phase 4a-alt)

When using F2V slides (Phase 4a), `nex_assemble.py` handles everything. See Phase 8.

When using pre-animated MP4 (Phase 4a-alt), done in that phase's Step 3.

---

## Phase 6: Background Music (optional)

```bash
python3 skills/video-replicator/scripts/generate_music.py \
  --prompt "{topic-appropriate music prompt}" \
  --duration {round_up_30s(total_duration)} \
  --output "projects/{slug}/audio/background.mp3"
```

Tech-commentary music prompt pattern:
`"Lofi tech ambient, soft synth pads, 90 BPM, focused/cerebral, no vocals, clean mix"`

---

## Phase 7, 8: Normalize + Concat

### Path A — F2V slides

```bash
python3 skills/video-replicator/scripts/nex_assemble.py \
  --project "projects/{slug}" \
  --num-slides {N} \
  --intro-scenes "17,19" \
  --outro-scenes "20,21" \
  --music "projects/{slug}/audio/background.mp3" \
  --yes
```

Handles loop + bake (TTS=2.5, SFX=0.15) + normalize (auto mono->stereo) + concat-via-filter (drift-free for 8+ segments) + music (5%, 3s fade-out).

### Path B — Pre-animated MP4 slide segment

Demuxer concat + frame-aligned AV parity (Bunty pattern):

```bash
cat > projects/{slug}/_concat.txt <<EOF
file 'final/segments/seg_intro_17.mp4'
file 'final/segments/seg_intro_19.mp4'
file 'final/segments/seg_slides.mp4'
file 'final/segments/seg_outro_20.mp4'
file 'final/segments/seg_outro_21.mp4'
EOF

ffmpeg -y -f concat -safe 0 -i projects/{slug}/_concat.txt \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 192k -movflags +faststart \
  "projects/{slug}/final/{slug}_no-subs.mp4"
```

Before concat, normalise each per-scene Nex segment with `apad=whole_dur` + `-frames:v` for AV parity (math.ceil(dur*24)/24 = frame-aligned duration). See `stitch_bunty.py` for the proven implementation.

### Concat filter vs demuxer threshold

`CONCAT_FILTER_THRESHOLD=8` in config.py — for 8+ segments, use concat FILTER (not demuxer) to prevent drift. `nex_assemble.py` handles this automatically. For Path B, demuxer is fine if you already pre-normalised AV parity per segment.

---

## Phase 9: Soft Subtitles (Reapit pattern)

FFmpeg on macOS Homebrew ships **without `--enable-libass`** so `subtitles=...` burn-in fails. The reliable substitute is the `mov_text` codec — soft subtitles muxed into the MP4 container.

### Step 1 — Build the SRT from TTS manifest

```python
# generate_srt.py — keep this snippet in the project
import json
from pathlib import Path

p = Path("projects/{slug}")
manifest = json.load(open(p / "audio/narration_manifest.json"))
transcript = json.load(open(p / "audio/tts/slides_transcript.json"))

INTRO_OFFSET = 16.0  # 2 chained Nex intro clips

def fmt_srt(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int((s % 1) * 1000):03d}"

cursor = INTRO_OFFSET
lines = []
for i, scene_idx in enumerate(sorted(manifest["scenes"], key=int), start=1):
    dur = manifest["scenes"][scene_idx]["duration"]
    text = transcript["scenes"][scene_idx]
    lines.append(f"{i}\n{fmt_srt(cursor)} --> {fmt_srt(cursor + dur)}\n{text}\n")
    cursor += dur

Path(p / "final/subtitles.srt").write_text("\n".join(lines))
```

Also generate cues for the Nex intro (scenes 17 + 19, ~16s) and outro (scenes 20 + 21, ~16s) lines.

### Step 2 — Mux SRT as soft subtitle stream

```bash
ffmpeg -y \
  -i "projects/{slug}/final/{slug}_no-subs.mp4" \
  -i "projects/{slug}/final/subtitles.srt" \
  -map 0:v -map 0:a -map 1:0 \
  -c:v copy -c:a copy \
  -c:s mov_text -metadata:s:s:0 language=eng -metadata:s:s:0 title="English" \
  "projects/{slug}/final/{slug}.mp4"
```

Sidecar SRT lives at `projects/{slug}/final/subtitles.srt` for VLC users.

### Why not burn-in?

Burn-in via `subtitles=` filter requires libass. FFmpeg 8.x on macOS Homebrew is built without it. Don't waste time rebuilding — soft `mov_text` exports cleanly to YouTube/Vimeo and lets viewers toggle off. Confirmed on Reapit Strategic Briefing v3 (2026-05-13).

**STOP at GATE 3.** Open final video, share with user, offer surgical regen.

---

## Phase 10: Surgical Re-Generation (Bunty pattern)

When the user says "the audio on slide 14 sounds off" or "redo the intro", don't rerun everything.

### Single TTS scene regen

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --edit "projects/{slug}/audio/tts/slides_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --scenes "14" --voice-id "TX3LPaxmHKxFdv7VOQHJ" --yes

# Path A: re-run nex_assemble.py (idempotent)
# Path B: recompute PTS, re-slow video, re-mux narration, re-concat
```

### Nex intro/outro regen

```bash
# 1. (Optional) Regenerate the Nex image with a fresh Go Bananas call
mcp__go-bananas__generate_image(... character_id=98 ...)

# 2. Clear veo-cli cache for that scene
rm -f /Users/davendrapatel/Documents/GitHub/video-creation-projects/veo-cli/output-videos/{slug}-*scene_17*.mp4
rm -f /Users/davendrapatel/Documents/GitHub/video-creation-projects/veo-cli/output-videos/{slug}-*scene_19*.mp4

# 3. Re-run Veo I2V on the intro chained pair
python3 skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --mode frames-to-video \
  --scenes '{"17":"<prompt>"}' \
  --lip-sync --dialogue '{"17":"<dialogue>"}' \
  --image-run run001 --ratio landscape --quality fast \
  --variations 1 --allow-stale --continue --yes
# Re-extract last frame, re-run for scene 19

# 4. Voice-change just those scenes
python3 skills/video-replicator/scripts/generate_tts.py \
  --voice-change --videos-dir "projects/{slug}/videos" \
  --scenes "17,19" --voice-id "TX3LPaxmHKxFdv7VOQHJ" --seed 42 --remove-bg-noise --yes

# 5. Re-encode only those segments, demuxer-concat with the unchanged segments
```

The principle: preserve segment files that didn't change, replace the ones that did, demuxer-concat. Avoids re-encoding the long slide segment.

---

## Phase 11: Branding (Optional) + Copy to Documents

### "The Nex Brief" branding

Add title card (4s) + logo intro (6s) + episode:

```bash
python skills/nex-presenter/scripts/brand_episode.py \
  --episode "projects/{slug}/final/{slug}.mp4" \
  --title-card "projects/{slug}/assets/title_card_final.jpg" \
  --output "projects/{slug}/final/{slug}_branded.mp4" \
  --yes
```

Or as part of `nex_assemble.py`:

```bash
python skills/video-replicator/scripts/nex_assemble.py \
  --project "projects/{slug}" --num-slides 16 \
  --intro-scenes 17,19 --outro-scenes 20,21 \
  --music "projects/{slug}/audio/background.mp3" \
  --brand-title-card "projects/{slug}/assets/title_card_final.jpg" \
  --yes
```

### Title card generation

```bash
# Phase 1: Generate Go Bananas command (auto-extract title from PDF)
python skills/video-replicator/scripts/generate_title_card.py \
  --project "{slug}" \
  --pdf "projects/{slug}/reference/slides.pdf" \
  --character-id 98 --yes

# Phase 2: Process downloaded image → title card with text overlay
python skills/video-replicator/scripts/generate_title_card.py \
  --project "{slug}" --process \
  --raw-image "projects/{slug}/assets/title_card_raw.jpg" \
  --title "Episode Title" --subtitle "The Nex Brief" \
  --duration 4 --yes
```

### Copy to Documents

```bash
mkdir -p "$HOME/Documents/The Nex Brief"
cp "projects/{slug}/final/{slug}_branded.mp4" \
   "$HOME/Documents/The Nex Brief/{Episode Title} - {timestamp}.mp4"
cp "projects/{slug}/final/subtitles.srt" \
   "$HOME/Documents/The Nex Brief/{Episode Title}-subtitles.srt"
open "$HOME/Documents/The Nex Brief/{Episode Title} - {timestamp}.mp4"
```

Optionally copy individual TTS MP3s for external editing:

```bash
mkdir -p "$HOME/Documents/The Nex Brief/Episode Audio Files"
cp projects/{slug}/audio/tts/scene_*_tts.mp3 "$HOME/Documents/The Nex Brief/Episode Audio Files/"
```

---

## Directory Structure

```
projects/{slug}/
+-- reference/
|   +-- {original}.pdf
|   +-- {user_provided_anim.mp4}              # Optional, Path B
+-- slides/
|   +-- slide_001.jpg ... slide_NNN.jpg
+-- analysis/
|   +-- slides.json
+-- images/
|   +-- run001_scene_1_frame.jpg              # Slide stills (Path A only)
|   +-- run001_scene_17_frame.jpg             # Nex intro 1
|   +-- run001_scene_19_frame.jpg             # Extracted last frame of scene 17
|   +-- run001_scene_20_frame.jpg             # Nex outro 1
|   +-- run001_scene_21_frame.jpg             # Extracted last frame of scene 20
+-- videos/
|   +-- run001_scene_{17,19,20,21}.mp4 + _vc.mp4
|   +-- looped/, baked/, normalized/          # Path A only
+-- audio/
|   +-- tts/
|   |   +-- slides_transcript.json
|   |   +-- scene_{1..N}_tts.mp3
|   +-- narration_manifest.json
|   +-- narration_track.m4a                   # Path B: concatenated TTS
|   +-- background.mp3                        # Optional
+-- nex_scenes.json                           # Veo prompts (full)
+-- dialogue_pair1.json                       # Spoken lines (17, 20)
+-- dialogue_pair2.json                       # Spoken lines (19, 21)
+-- final/
|   +-- segments/
|   |   +-- seg_intro_17.mp4
|   |   +-- seg_intro_19.mp4
|   |   +-- seg_slides.mp4
|   |   +-- seg_outro_20.mp4
|   |   +-- seg_outro_21.mp4
|   +-- subtitles.srt
|   +-- {slug}_no-subs.mp4                    # Before mux
|   +-- {slug}.mp4                            # Final with soft subs
|   +-- {slug}_branded.mp4                    # With "Nex Brief" branding (optional)
```

---

## Cost & Wall Time

Typical run for a 16-slide deck with 4 Nex chained scenes:

| Step | Cost | Time |
|---|---|---|
| PDF extract + slide narration draft (Gemini Vision) | ~$0.02 | 1 min |
| 16 TTS scenes (~22 words each, ElevenLabs flash) | ~$0.04 | 80s |
| 4 Nex images (Go Bananas Pro, character_id=98) | ~$0.04 | 30s |
| 4 Veo I2V lip-sync `fast` | 40 credits (~$0.05) | 6-8 min |
| 4 Veo I2V lip-sync `quality` (hero option) | 400 credits (~$0.50) | 12-15 min |
| Voice change x4 | included | 30s |
| 16 F2V slide loops `fast` (Path A only) | 160 credits (~$0.20) | 12-15 min |
| Music generation (~3-4 min track) | ~$0.10 | 60s |
| Stitch + mux subtitles | free | 2-3 min |
| Branding (title card + logo intro) | free | 1 min |
| **Path A: F2V slides, fast Nex** | **~$0.25 + 200 credits** | **~25 min** |
| **Path B: pre-animated MP4 slides, quality Nex** | **~$0.60 + 400 credits** | **~22 min** |

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Veo rejects Nex image with "content filter blocking first-frame image" | Photorealistic character variant | Use character_id=98 (Pixar). No prompt rewording fixes this. |
| Nex voice silent in final video | Mono->stereo pan filter wrong (regression) | Should be auto-fixed since 2026-02-20. If recurring, use `pan=stereo\|FL=c0\|FR=c0` for mono VC files |
| Stale Nex video reuses old image | veo-cli cache hit on tag, not image hash | Clear `veo-cli/output-videos/{slug}-*scene_NN*.mp4` before regen |
| Wrong video shown to user during preview | Cached output from previous run | Clear veo-cli cache + re-run; confirm timestamp on output file matches run start |
| Narration cut off mid-sentence | Video shorter than TTS | Loop video (Phase 5c) — `nex_assemble.py` handles automatically |
| Sync drift at end of video | Concat demuxer accumulates DTS errors over 8+ segments | Use concat-via-filter (`nex_assemble.py` handles via `CONCAT_FILTER_THRESHOLD=8`) |
| Voice sounds different per Nex clip | Veo gives different voice each clip | Voice-change ALL Nex scenes with `--seed 42 --remove-bg-noise` |
| Slides 16+ show wrong images | Image overwrite during Nex copy | Always copy Nex images AFTER slides are in place, use scenes 17+ |
| TTS too quiet vs Nex voice | Bake volume too low | TTS=2.5, SFX=0.15 |
| Background music too loud | Music volume too high | 5% (`--music-volume 0.05`) |
| Nex ad-libs extra words | Missing speech enforcement | Include full pattern: eyes wide open + speaks exactly + stops speaking + becomes completely still |
| Burn-in subtitles fail with parser error | FFmpeg built without libass on macOS | Use soft `mov_text` subtitles + sidecar `.srt` (Phase 9). Don't fight libass. |
| QuickTime won't play final MP4 | yuv444p output from color/fade filters | Always re-encode with `-pix_fmt yuv420p -profile:v high` |
| Animation video and narration durations don't match (Path B) | Pre-animated MP4 and total TTS differ | Compute PTS factor + `setpts={PTS}*PTS` (keep in 0.85-1.20 range) |
| User asks to regen one slide's audio after final stitch | Full rerun is wasteful | `generate_tts.py --scenes "N"` then re-mux only that segment (Phase 10) |
| Nex image looks "wrong" / different person | Go Bananas Pro drifts on character_id sometimes | Re-run `mcp__go-bananas__generate_image` with character_id=98 — try 2-3 times |
| Non-monotonic DTS warnings during branding concat | Expected and harmless | FFmpeg resolves internally |

---

## Nex Character Reference

- **Go Bananas Character ID**: `98` (Pixar — REQUIRED)
- **Description**: 3D Pixar-style animated young tech commentator
- **Setting**: Modern gaming/streaming studio with RGB lighting, multiple monitors
- **Style register**: Energetic, casual, relatable — like a tech YouTube creator. Conversational, brisker cadence than executive content.
- **Signature sign-off**: `"I'm Nex, and I'll catch you in the next breakdown. Peace."`
- **ElevenLabs Voice ID**: Liam `TX3LPaxmHKxFdv7VOQHJ` (used for BOTH TTS narration AND voice change)
- **Voice change seed**: `42` (deterministic)

**Pose bank (chained pairs)**:
- Intro 1 (scene 17): Begins still then speaks. Leaning forward, energetic hand gestures.
- Intro 2 (scene 19): Continues from scene 17 last frame, thoughtful expression, gesturing with one hand.
- Outro 1 (scene 20): Static camera. Reflective leaning back, making a measured point.
- Outro 2 (scene 21): Casual wave gesture, satisfied closing smile, holds still last 2s.

**Branding assets**:
| Asset | Path | Description |
|-------|------|-------------|
| Logo intro video | `assets/nex_brief_intro.mp4` | 6s animated holographic cube, 48kHz, 1280x720, 24fps |
| Text overlay | `assets/text_overlay.png` | "THE NEX BRIEF" transparent RGBA PNG, 1280x720 |
| Logo source image | `assets/logo_source.jpg` | Holographic cube source for re-generation |
| Logo manifest | `assets/logo_manifest.json` | Generation provenance (preset, runs, timestamps) |

---

## Recovery — when a slide has the wrong fact burned in (Bunty pattern)

If the deck (slide image itself) misattributes a fact — wrong name, wrong number, wrong quote rendered into the slide PNG — the audio narration alone can't fix it because the text is baked into the image. **Fix upstream by re-prompting NotebookLM with an authoritative corrections source**:

```bash
# 1. Write a corrections file at projects/<slug>/reference/facts_corrected.txt
#    explicitly stating the correct facts. End with:
#    "THIS DOCUMENT IS THE AUTHORITATIVE SOURCE."

# 2. Upload as a new source to the existing notebook:
nlm source add <notebook-id> --wait --wait-timeout 180 \
  --file projects/<slug>/reference/facts_corrected.txt \
  --title "CORRECTED facts (authoritative)"

# 3. Regenerate the deck with a focus prompt that cites the corrections
#    source as the source of truth:
nlm slides create <notebook-id> --format presenter_slides --length default --confirm \
  --focus "...your normal focus... CRITICAL ACCURACY: The source titled 'CORRECTED facts (authoritative)' is the source of truth..."

# 4. Once status=completed, download and swap:
nlm download slide-deck <notebook-id> --format pdf -o projects/<slug>/slides/deck_v2.pdf
python3 skills/video-replicator/scripts/extract_pdf_slides.py \
  --pdf projects/<slug>/slides/deck_v2.pdf \
  --output-dir projects/<slug>/slides_v2 \
  --output-json projects/<slug>/analysis/slides_v2.json --dpi 200

mv slides slides_v1 && mv slides_v2 slides
mv analysis/slides.json analysis/slides_v1.json && mv analysis/slides_v2.json analysis/slides.json

# 5. Rewrite narration to match the new beats, regen TTS, regen F2V loops
#    with --draft-prompts --overwrite-prompts, re-stitch.
```

Confirmed effective on bunty's Match 6 — the v2 deck used corrected facts and produced a richer narrative. The same pattern applies to any Nex briefing deck where NotebookLM burned wrong info into a slide image.

For per-scene surgical regen (already in this skill at Phase 10), use that. The correction-loop pattern above is when the slide IMAGE itself is wrong — Phase 10 only re-runs TTS for an existing slide.

---

## Cross-pollination notes (Bunty patterns to consider)

These are battle-tested in `skills/bunty/SKILL.md` and may be useful here:

1. **Env auto-load** — at the top of long pipelines, auto-load `.env.local` so API keys are always present. Avoids "why is my TTS call failing — oh, I forgot to source the env" debugging.
2. **Failed-artifact skip** — when re-running after a partial failure, skip scenes whose artifacts already exist on disk. Don't re-pay for completed work.
3. **Interactive preview pages** — for high-cost workflows, write an HTML preview alongside the final MP4 so you can review per-scene assets without scrubbing the video.
4. **Render-exactly-once guards** — when NotebookLM can render a slide twice in different visual styles, add an explicit "RENDER X EXACTLY ONCE — do NOT split / re-render / append a duplicate" instruction to the focus prompt. Cite a real incident as the example to make the point stick.

Already in this skill: **Surgical Re-Generation (Phase 10)** — also a Bunty pattern, but ported earlier. Combine with #2 (failed-artifact skip) for the full re-run loop.

If you encounter the same problems Bunty hit, these are the proven fixes — port from `skills/video-replicator/scripts/bunty_helpers.py` and friends.
