# Davendra Presenter

*Last Updated: 2026-05-14*

Create a professional narrated video from a PDF (or pre-animated MP4) slide deck, featuring **Davendra** — a 3D Pixar-style executive presenter — as the host for intro and outro segments. Slides are animated with subtle motion and narrated with AI-generated commentary. Soft subtitles are baked into the final container.

**Input**: A PDF file OR a pre-animated slide MP4 + PDF source for narration
**Output**: A complete MP4 with Davendra intro (2 scenes) -> narrated animated slides -> Davendra outro (2 scenes) + optional background music + soft subtitle track

---

## ⚠️ READ FIRST — Character ID + Veo Content Filter

**Use ONLY `character_id=109` (Davendra Pixar)** for all Veo I2V lip-sync. The photorealistic variant `character_id=118` (Davendra Cinematic) is **rejected by Veo's first-frame content filter every time** — confirmed on the Reapit Strategic Briefing project, 2026-05-13. Same dialogue, same composition, different stylisation -> different filter outcome.

| character_id | Style | Veo I2V filter |
|---|---|---|
| `109` | 3D Pixar (canonical) | ✅ Reliable |
| `168` | 3D Pixar (Indian kurta) | ✅ Reliable |
| `118` | Photorealistic / cinematic | ❌ Always rejected |

**If the user insists on photorealistic Davendra**, switch backends:
- **Seedance audio-lipsync** (`--backend seedance --mode audio-lipsync`) — different filter, accepts photorealistic faces. Requires `SUTUI_API_KEY`. Generates TTS-driven lip-sync in 1 step (no voice-change post-process needed).
- **Hybrid**: photorealistic still as 2-3s title card, then cut to animated Pixar Davendra for dialogue.

Full memory file: `~/.claude/projects/-Users-davendrapatel-Documents-GitHub-video-creation-projects/memory/veo-photorealistic-character-filter.md`

### Identity-lock pattern (cross-pollinated from `skills/bunty/SKILL.md`)

If Davendra starts drifting on Pro (clean-shaven young guy, wrong hair, etc. — confirmed common pattern on `character_id=97/Bunty`), copy bunty's helper pattern: write a `davendra_helpers.build_davendra_image_kwargs()` function that prepends a canonical visual-anchor prompt + a negative prompt blocking the observed drift modes, and **always call through the helper** instead of `mcp__go-bananas__generate_image` with just `character_id=109` + a vibe description. See `skills/video-replicator/scripts/bunty_helpers.py` as the reference implementation. Davendra has been stable enough on Pro to not need this yet — but it's the proven fix the moment drift starts.

---

## Quick Start

When this skill is triggered, ask the user:

```
+-----------------------------------------------------+
|  DAVENDRA PRESENTER                                  |
+-----------------------------------------------------+
|                                                      |
|  Please provide:                                     |
|  1. PDF file path (slides + narration source)        |
|  2. Topic/subject (1 sentence)                       |
|                                                      |
|  Optional:                                           |
|  - Pre-animated slide MP4? (otherwise we F2V-loop)   |
|  - Custom Davendra images? [No, use defaults]        |
|  - Project name? [auto from PDF filename]            |
|  - Quality tier? [fast = 10 cr / quality = 100 cr]   |
|  - Burn-in or soft subtitles? [soft, mov_text]       |
|                                                      |
+-----------------------------------------------------+
```

---

## Mandatory User-Approval Gates

Three gates govern every Davendra run. Do not proceed past any gate without explicit user approval, even when the user has previously approved a similar plan.

| Gate | When | What to show |
|---|---|---|
| **GATE 1 — Script review** | After Phase 2 | All slide narration scripts + 4 intro/outro dialogue lines + total word/duration estimate |
| **GATE 2 — Image review** | After Phase 3 | The Davendra first-frame images (intro 1, intro 2, outro 1, outro 2). User confirms before paying for Veo I2V. |
| **GATE 3 — Final review** | After Phase 8 | The final MP4 opened in player. Offer surgical regen (Phase 10) for any scene the user wants changed. |

Per project memory rules (see `memory/MEMORY.md` — "NEVER proceed to video generation without explicit user approval").

---

## Constants

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Davendra Character ID** | `109` | Go Bananas character reference — Pixar only |
| **Voice** | `0vPMop5s0QLJlWyI0lJn` | ElevenLabs — used for ALL audio (TTS + voice change) |
| **TTS Model** | `eleven_flash_v2_5` | Fast, good quality |
| **Voice Change Model** | `eleven_multilingual_sts_v2` | Speech-to-speech |
| **Voice Change Seed** | `42` | Deterministic output |
| **Slide Animation** | Subtle, professional | 80% still, one gentle ambient effect |
| **Default Video Quality** | `fast` | 10 credits / scene. Use `quality` (100 cr) for hero intros. |
| **Background Music** | 5% volume | Auto-generated per topic |
| **TTS Bake Volumes** | TTS=2.5, SFX=0.15 | Narration-forward mix |
| **Davendra Scene Count** | 4 (2 intro + 2 outro) | Scenes numbered N+1 to N+4 where N = slide count |
| **Subtitle Codec** | `mov_text` (soft) | FFmpeg on macOS has NO libass — burn-in subs fail. Soft mov_text + sidecar `.srt` is the standard. |
| **Title Card Duration** | 4s | Hold time for episode title card (optional) |

---

## Pipeline Overview

```
Phase 1:  Extract slides from PDF (or skip if user provided pre-animated MP4)
Phase 2:  AI-generate narration script (slides) + Davendra dialogue (intro/outro)
          ----- GATE 1: script review -----
Phase 3:  Prepare Davendra images (defaults or fresh Go Bananas)
          ----- GATE 2: image review -----
Phase 4a: Generate F2V videos for slides (subtle animation)   ← skip if --slides-mp4
Phase 4b: Generate I2V videos for Davendra scenes (with speech)
Phase 5a: Generate TTS for slides (Davendra voice)
Phase 5b: Voice-change Davendra scenes (Davendra voice)
Phase 5c: Loop slide videos to match TTS duration             ← skip if --slides-mp4
Phase 5d: Bake TTS onto looped slides (or onto pre-animated MP4 — see 4a-alt)
Phase 6:  Generate background music
Phase 7:  Normalize all scenes
Phase 8:  Concat + add music
Phase 9:  Generate SRT + mux soft subtitles
          ----- GATE 3: final review -----
Phase 10: Surgical re-generation (optional — fix specific scenes)
Phase 11: Copy to ~/Documents and open
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
- Auto-resize landscape images to 1280x720 via the `parallel_video_gen.py --dry-run` trick (see existing pattern)

---

## Phase 2: AI-Generate All Scripts

### 2a: Slide Narration

Read each `slide_NNN.jpg` and write narration.

**Rules:**
- 25-30 words per scene (fills ~10-14s of executive-tone TTS — slower than B2C)
- Warm executive tone — like a trusted strategic advisor, not a YouTube creator
- Reference specific details visible on the slide (numbers, names, structural elements)
- No filler phrases ("as you can see", "let me tell you")
- Numbers as words for TTS ("twenty twenty-six" not "2026")

**Output**: `projects/{slug}/audio/tts/slides_transcript.json`

```json
{
  "_instructions": "Davendra slide narration. 25-30 words per scene, warm executive tone.",
  "scenes": {
    "1": "Slide one narration text...",
    "2": "Slide two narration text..."
  }
}
```

### 2b: Davendra Intro/Outro Dialogue

Scene numbering: scenes 17, 19 (intro chained pair) and 20, 21 (outro chained pair) — same convention as Bunty for visual continuity scripts. If slide count differs, adjust accordingly (N+1..N+4 also acceptable; the scene-number choice is local to the project).

**Intro pattern (chained — scene 17 -> scene 19):**
- Scene 17: Hook/attention grabber — what is this about, why it matters now
- Scene 19: Setup — what we're about to cover (the chained shot lets Davendra finish a beat)

**Outro pattern (chained — scene 20 -> scene 21):**
- Scene 20: Key takeaway — the strategic conclusion
- Scene 21: Call to action / sign-off — `"I'm Davendra, and I'll see you in the next one. Take care."`

**Dialogue length**: 25-35 words per 8s scene. Outro sign-off (scene 21) = **15-20 words only** — dramatic pacing needs room for pauses; >20 words gets cut off.

**Critical — Speech enforcement pattern** (every Davendra prompt MUST include all four):

1. `"Character's eyes are wide open from the very first frame."` — prevents closed-eye start
2. `"He speaks exactly these words and nothing else: \"...\""` — prevents ad-libbing
3. `"He stops speaking after finishing the line. No additional speech."` — prevents extra words
4. `"After finishing speaking, he becomes completely still and frozen in place for the final 1 second."` — clean ending

For the chained intro: scene 17 begins still then speaks; scene 19 starts from scene 17's last frame and continues. Use the same still-frame enforcement on both ends.

**Output**: `projects/{slug}/davendra_scenes.json` (full scene prompts) + `projects/{slug}/dialogue_pair1.json` + `dialogue_pair2.json` (just the spoken lines).

**STOP at GATE 1.** Present the full narration plan + dialogue + word counts and wait for explicit "go".

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

## Phase 3: Prepare Davendra Images

### Default images (recommended)

Copy from skill assets directory:

```bash
SKILL_DIR="skills/davendra-presenter/assets"
IMAGES_DIR="projects/{slug}/images"

# Intro chained pair (scene 17 first frame; scene 19 will be the last-frame of scene 17 — extracted in Step 6)
cp "$SKILL_DIR/davendra_intro_1.jpg" "$IMAGES_DIR/run001_scene_17_frame.jpg"
cp "$SKILL_DIR/davendra_intro_1.jpg" "$IMAGES_DIR/run001_scene_17_frame_landscape.jpg"

# Outro chained pair (scene 20 first frame)
cp "$SKILL_DIR/davendra_outro_1.jpg" "$IMAGES_DIR/run001_scene_20_frame.jpg"
cp "$SKILL_DIR/davendra_outro_1.jpg" "$IMAGES_DIR/run001_scene_20_frame_landscape.jpg"
```

### Custom images (if user requests)

Generate fresh Davendra images via Go Bananas — **always character_id=109, always gemini-pro-image**:

```python
mcp__go-bananas__generate_image(
    prompt="Cartoon 3D Pixar-style 45-year-old South Asian Indian man named Davendra in a beige polo shirt, warm brown skin, dark gray-black swept hair, kind brown eyes, gentle confident smile. He stands in {scene_specific_setting}. {pose}. Photorealistic 3D Pixar-style. Cinematic lighting, high detail. WIDE HORIZONTAL shot.",
    character_id=109,
    aspect_ratio="16:9",
    model_id="gemini-pro-image",   # REQUIRED — flash ignores character refs
)
```

**Pose bank**:
| Scene | Pose |
|---|---|
| Intro 1 (17) | Leaning forward slightly, energetic hand gestures, excited expression |
| Intro 2 (19) | Tracks slightly to the right, continues thoughtful gesture |
| Outro 1 (20) | Reflective leaning back, making a measured point |
| Outro 2 (21) | Holds still, warm sign-off smile, slight nod |

**Setting bank** (match to topic — quiet office is the executive default):
- Modern professional home office with warm wood tones and bookshelf (default)
- Glass-walled executive briefing room with city skyline in background (Reapit-style strategic content)
- Premium consulting boardroom with abstract art (corporate audiences)

Download the URLs into `images/run001_scene_{17,20}_frame.jpg` (and `_landscape.jpg` duplicates).

**STOP at GATE 2.** Show the user the rendered intro+outro images. Confirm before paying for Veo.

### Cache hygiene (Reapit session learning)

Before running Veo, **clear veo-cli's local cache** if you have regenerated images for a scene that previously generated:

```bash
rm -f /Users/davendrapatel/Documents/GitHub/video-creation-projects/veo-cli/output-videos/davendra-*scene_{17,19,20,21}*.mp4
```

If you skip this, Veo's CLI can silently reuse a stale generated video that was tagged with the old (overwritten) image. Confirmed regression on Reapit Strategic Briefing 2026-05-13: a regenerated premium-office Davendra image returned the prior home-office video output because the cache key matched the tag, not the image hash. Always clear the cache when you regenerate Davendra images mid-project.

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
- Subtle data visualization shimmer

**Per-slide Gemini Vision drafting (recommended)** — use the Bunty-proven helper:
```bash
python3 skills/video-replicator/scripts/bunty_animate_slides.py \
  --project projects/{slug} --draft-prompts --style minimal --yes
```
`--style minimal` produces the calmest executive-grade motion vocab. The helper auto-recovers from Veo content-filter rejection with a `SAFE_FALLBACK_PROMPT` and warns on high-risk vocab.

**Vocab guard**: avoid `burst`, `explosion`, `blast`, `smash`, `destroyer`, `dramatic`, `intense`, `violent`, `crash`, `shatter` — these trip Veo's content filter when paired with dense corporate slide imagery. The helper lints these tokens before submission.

---

## Phase 4a-alt: Pre-Animated MP4 Source (Reapit pattern)

When the user supplies their own animated slide video (e.g. from Figma/After Effects/a custom HyperFrame export), skip F2V generation entirely.

### Step 1 — Probe + plan

```bash
ANIM=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "{user_provided_anim.mp4}")
TTS_TOTAL=$(python3 -c "
import json, subprocess
m = json.load(open('projects/{slug}/audio/narration_manifest.json'))
total = sum(v['duration'] for v in m['scenes'].values())
print(f'{total:.3f}')
")
PTS=$(python3 -c "print($TTS_TOTAL / $ANIM)")
echo "Animation: ${ANIM}s | TTS total: ${TTS_TOTAL}s | PTS factor: ${PTS}"
```

### Step 2 — Slow (or speed) the animation to match TTS duration

```bash
ffmpeg -y -i "{user_provided_anim.mp4}" \
  -filter:v "setpts=${PTS}*PTS" \
  -an \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  "projects/{slug}/final/slides_slow.mp4"
```

`setpts` does a frame-aware time stretch without re-rendering content. PTS=1.024 means slow 2.4%; PTS=0.95 means speed up 5%. Acceptable range: 0.85-1.20 — outside that, the visual feel breaks down and you should adjust TTS instead.

### Step 3 — Build narration track + mux

```bash
# Concat all per-scene TTS into a single track
NARR_LIST=$(python3 -c "
import json
m = json.load(open('projects/{slug}/audio/narration_manifest.json'))
for i in range(1, len(m['scenes']) + 1):
    print(f\"file 'audio/tts/scene_{i}_tts.mp3'\")
" > projects/{slug}/_narration_list.txt)
ffmpeg -y -f concat -safe 0 -i projects/{slug}/_narration_list.txt \
  -c:a aac -b:a 192k projects/{slug}/audio/narration_track.m4a

# Mux slowed video + narration into one segment
ffmpeg -y \
  -i "projects/{slug}/final/slides_slow.mp4" \
  -i "projects/{slug}/audio/narration_track.m4a" \
  -c:v copy -c:a aac -b:a 192k \
  -map 0:v -map 1:a \
  "projects/{slug}/final/segments/seg_slides.mp4"
```

That `seg_slides.mp4` is the drop-in replacement for all the per-slide baked clips. The intro and outro segments (5 total: title? + intro + slides + outro + credits?) get concatenated as usual.

### Tested on Reapit Strategic Briefing v3 (2026-05-14)
- Animation source: 196.0s pre-rendered MP4 (HyperFrame export)
- TTS total: 200.76s (16 Davendra scenes at 25-30 words each)
- PTS factor: 1.024 (slowed 2.4%)
- Result: drift-free 200.78s slide segment, 3:53 final video including intro+outro

---

## Phase 4b: Generate Davendra Videos (I2V with Speech)

Chained pair generation, same convention as Bunty. Use `--quality quality` for hero intro/outro on premium projects (Reapit etc.); `--quality fast` is fine for regular run-of-the-mill content.

### Step 1 — Generate the first frames of each chained pair (scenes 17 + 20)

```bash
python3 skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --mode frames-to-video \
  --scenes '{"17":"<intro1 prompt>","20":"<outro1 prompt>"}' \
  --lip-sync \
  --dialogue '{"17":"<intro1 dialogue>","20":"<outro1 dialogue>"}' \
  --image-run run001 --ratio landscape --quality quality \
  --variations 1 --allow-stale --continue --yes
```

### Step 2 — Extract last frames for chained continuations (scene 19, 21)

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

### Step 3 — Generate the chained continuations (scenes 19, 21)

Same `parallel_video_gen.py` invocation as Step 1, but with scenes 19 and 21 dialogue.

---

## Phase 5a: Generate TTS for Slides

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --edit "projects/{slug}/audio/tts/slides_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --voice-id "0vPMop5s0QLJlWyI0lJn" \
  --yes
```

Outputs `scene_N_tts.mp3` per scene + `narration_manifest.json` with durations.

### Per-scene regeneration (Reapit pattern)

When the user says "regen audio for slide 10, 14, and 15", do not regenerate the whole transcript:

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --edit "projects/{slug}/audio/tts/slides_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --scenes "10,14,15" \
  --voice-id "0vPMop5s0QLJlWyI0lJn" \
  --yes
```

The `--scenes` flag regenerates only the listed scene MP3s and refreshes their entries in `narration_manifest.json` — much cheaper than a full re-run, and the only thing that changes is the per-scene timing for the listed scenes.

If you used Phase 4a-alt (pre-animated MP4), **you must re-run the slow + mux steps** after a per-scene regen, because the total TTS duration has changed and so has the PTS factor.

---

## Phase 5b: Voice-Change Davendra Scenes

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --voice-change \
  --videos-dir "projects/{slug}/videos" \
  --scenes "17,19,20,21" \
  --voice-id "0vPMop5s0QLJlWyI0lJn" \
  --seed 42 \
  --remove-bg-noise \
  --yes
```

Output: `run001_scene_{17,19,20,21}_vc.mp4`. The voice change is **mandatory** — Veo generates a different voice for each clip; without normalisation the four Davendra scenes sound like four different people.

---

## Phase 5c, 5d: Loop + Bake (skip if using Phase 4a-alt)

When using F2V slides (Phase 4a), `nex_assemble.py` handles loop + bake + normalize + concat + music in one command. See Phase 8.

When using pre-animated MP4 (Phase 4a-alt), this is already done in that phase's Step 3.

---

## Phase 6: Background Music (optional)

```bash
python3 skills/video-replicator/scripts/generate_music.py \
  --prompt "{topic-appropriate music prompt}" \
  --duration {round_up_30s(total_duration)} \
  --output "projects/{slug}/audio/background.mp3"
```

Music prompt pattern for executive content:
`"Calm corporate strategic background, soft piano + light strings, 80 BPM, contemplative, no vocals, clean mix"`

---

## Phase 7, 8: Normalize + Concat

### Path A — F2V slides (Phase 4a)

```bash
python3 skills/video-replicator/scripts/nex_assemble.py \
  --project "projects/{slug}" \
  --num-slides {N} \
  --intro-scenes "17,19" \
  --outro-scenes "20,21" \
  --music "projects/{slug}/audio/background.mp3" \
  --yes
```

Handles loop + bake (TTS=2.5, SFX=0.15) + normalize (auto mono->stereo) + concat + music (5%, 3s fade-out).

### Path B — Pre-animated MP4 slide segment (Phase 4a-alt)

Concat the 5 segments manually with demuxer + frame-aligned AV parity (Bunty pattern — prevents AV drift over many segments):

```bash
# Build concat list:
#   title.mp4 (optional)
#   intro_17_vc.mp4
#   intro_19_vc.mp4
#   seg_slides.mp4   <-- the pre-animated + narration segment from Phase 4a-alt
#   outro_20_vc.mp4
#   outro_21_vc.mp4

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

Before concat, normalise each per-scene Davendra segment with `apad=whole_dur` + `-frames:v` for AV parity (math.ceil(dur*24)/24 = frame-aligned duration). See `stitch_bunty.py` for the proven implementation pattern.

---

## Phase 9: Soft Subtitles (Reapit pattern)

FFmpeg on macOS Homebrew ships **without `--enable-libass`** so `subtitles=...` burn-in fails. The reliable substitute is the `mov_text` codec — soft subtitles muxed into the MP4 container, toggleable in QuickTime/VLC and exportable as a sidecar `.srt`.

### Step 1 — Build the SRT from TTS manifest

```python
# generate_srt.py — keep this snippet in the project as a one-off
import json
from pathlib import Path

p = Path("projects/{slug}")
manifest = json.load(open(p / "audio/narration_manifest.json"))
transcript = json.load(open(p / "audio/tts/slides_transcript.json"))

# Davendra intro adds ~16s (2 chained clips). Adjust for your offset.
INTRO_OFFSET = 16.0

cursor = INTRO_OFFSET
lines = []
for i, scene_idx in enumerate(sorted(manifest["scenes"], key=int), start=1):
    dur = manifest["scenes"][scene_idx]["duration"]
    text = transcript["scenes"][scene_idx]
    start = cursor
    end = cursor + dur
    lines.append(f"{i}\n{fmt_srt(start)} --> {fmt_srt(end)}\n{text}\n")
    cursor = end

# fmt_srt: HH:MM:SS,mmm
def fmt_srt(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int((s % 1) * 1000):03d}"

Path(p / "final/subtitles.srt").write_text("\n".join(lines))
```

Also generate cues for the Davendra intro (scenes 17 + 19, ~16s) and outro (scenes 20 + 21, ~16s) lines — use the dialogue from `dialogue_pair{1,2}.json` and the per-clip durations from the voice-changed MP4s.

### Step 2 — Mux SRT into MP4 as soft subtitle stream

```bash
ffmpeg -y \
  -i "projects/{slug}/final/{slug}_no-subs.mp4" \
  -i "projects/{slug}/final/subtitles.srt" \
  -map 0:v -map 0:a -map 1:0 \
  -c:v copy -c:a copy \
  -c:s mov_text -metadata:s:s:0 language=eng -metadata:s:s:0 title="English" \
  "projects/{slug}/final/{slug}.mp4"
```

The original SRT travels as a sidecar at `projects/{slug}/final/subtitles.srt` — useful for VLC users who prefer external `.srt` files.

### Why not burn-in?

Burn-in via `subtitles=` filter requires libass. FFmpeg 8.x on macOS Homebrew is built **without** it (`--enable-libass` flag missing). Don't waste time trying to rebuild — soft `mov_text` is industry-standard, exports cleanly to YouTube/Vimeo, and lets viewers toggle them off. Confirmed on Reapit Strategic Briefing v3 (2026-05-13).

**If you absolutely need burn-in** (e.g., for social posts where soft subs don't render), use a separate FFmpeg machine with libass, or run subtitles burn-in through HandBrake/Adobe Media Encoder as a post-step.

**STOP at GATE 3.** Open the final video, share with user, offer surgical regen.

---

## Phase 10: Surgical Re-Generation (Bunty pattern)

When the user says "the audio on slide 14 sounds off" or "redo the intro", do not regenerate everything. Re-generate only the affected segment + re-concat.

### Single TTS scene regen

```bash
# 1. Re-generate just that scene's TTS
python3 skills/video-replicator/scripts/generate_tts.py \
  --edit "projects/{slug}/audio/tts/slides_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --scenes "14" --voice-id "0vPMop5s0QLJlWyI0lJn" --yes

# 2a. If using Path A (F2V): re-run nex_assemble.py with --resume (or simply re-run; segments are idempotent)
# 2b. If using Path B (pre-animated MP4): re-compute PTS, re-slow, re-mux narration track, re-concat
```

### Davendra intro/outro regen

```bash
# 1. (Optional) Regenerate the Davendra image with a softer prompt or different setting
mcp__go-bananas__generate_image(... character_id=109 ...)
# Download to images/run001_scene_17_frame.jpg + _landscape.jpg duplicate

# 2. Clear veo-cli cache for that scene (cache-hygiene rule from Phase 3)
rm -f /Users/davendrapatel/Documents/GitHub/video-creation-projects/veo-cli/output-videos/*scene_17*.mp4
rm -f /Users/davendrapatel/Documents/GitHub/video-creation-projects/veo-cli/output-videos/*scene_19*.mp4

# 3. Re-run Veo I2V on the intro chained pair
python3 skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --mode frames-to-video \
  --scenes '{"17":"<prompt>"}' \
  --lip-sync --dialogue '{"17":"<dialogue>"}' \
  --image-run run001 --ratio landscape --quality quality \
  --variations 1 --allow-stale --continue --yes

# Re-extract last frame -> scene 19 — re-run for scene 19

# 4. Voice-change just those scenes
python3 skills/video-replicator/scripts/generate_tts.py \
  --voice-change --videos-dir "projects/{slug}/videos" \
  --scenes "17,19" --voice-id "0vPMop5s0QLJlWyI0lJn" --seed 42 --remove-bg-noise --yes

# 5. Re-encode only the two affected segments, then demuxer-concat the unchanged + new segments
```

The principle (from Bunty's `bunty_re_encode_segments.py` and `bunty_regen.py`): preserve segment files that didn't change, replace the ones that did, demuxer-concat. Avoids re-encoding the long slide segment (the expensive bit).

---

## Phase 11: Copy to Documents

```bash
mkdir -p "$HOME/Documents/{Topic} Bumpers"
cp "projects/{slug}/final/{slug}.mp4" \
   "$HOME/Documents/{Topic} Bumpers/{Topic} - {Quality tier} - {timestamp}.mp4"
cp "projects/{slug}/final/subtitles.srt" \
   "$HOME/Documents/{Topic} Bumpers/{Topic}-subtitles.srt"
open "$HOME/Documents/{Topic} Bumpers/{Topic} - {Quality tier} - {timestamp}.mp4"
```

Optionally also copy the individual TTS MP3s into a `Slide TTS Files/` subfolder so the user has the raw narration if they want to re-edit externally:

```bash
mkdir -p "$HOME/Documents/{Topic} Bumpers/Slide TTS Files"
cp projects/{slug}/audio/tts/scene_*_tts.mp3 "$HOME/Documents/{Topic} Bumpers/Slide TTS Files/"
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
|   +-- run001_scene_17_frame.jpg             # Davendra intro 1
|   +-- run001_scene_19_frame.jpg             # Extracted last frame of scene 17
|   +-- run001_scene_20_frame.jpg             # Davendra outro 1
|   +-- run001_scene_21_frame.jpg             # Extracted last frame of scene 20
+-- videos/
|   +-- run001_scene_17.mp4 + _vc.mp4         # Veo + voice-changed
|   +-- run001_scene_19.mp4 + _vc.mp4
|   +-- run001_scene_20.mp4 + _vc.mp4
|   +-- run001_scene_21.mp4 + _vc.mp4
|   +-- looped/, baked/, normalized/          # Path A only
+-- audio/
|   +-- tts/
|   |   +-- slides_transcript.json
|   |   +-- scene_{1..N}_tts.mp3
|   +-- narration_manifest.json
|   +-- narration_track.m4a                   # Path B: concatenated TTS
|   +-- background.mp3                        # Optional
+-- davendra_scenes.json                      # Veo prompts (full)
+-- dialogue_pair1.json                       # Just spoken lines (17, 20)
+-- dialogue_pair2.json                       # Just spoken lines (19, 21)
+-- final/
|   +-- segments/
|   |   +-- seg_intro_17.mp4
|   |   +-- seg_intro_19.mp4
|   |   +-- seg_slides.mp4                    # Path A: from nex_assemble. Path B: slowed MP4 + narration
|   |   +-- seg_outro_20.mp4
|   |   +-- seg_outro_21.mp4
|   +-- subtitles.srt
|   +-- {slug}_no-subs.mp4                    # Before mux
|   +-- {slug}.mp4                            # Final, soft subs included
```

---

## Cost & Wall Time

Typical run for a 16-slide deck with 4 Davendra chained scenes:

| Step | Cost | Time |
|---|---|---|
| PDF extract + slide narration draft (Gemini Vision) | ~$0.02 | 1 min |
| 16 TTS scenes (~25 words each, ElevenLabs flash) | ~$0.05 | 90s |
| 4 Davendra images (Go Bananas Pro, character_id=109) | ~$0.04 | 30s |
| 4 Veo I2V lip-sync `fast` | 40 credits (~$0.05) | 6-8 min |
| 4 Veo I2V lip-sync `quality` (hero option) | 400 credits (~$0.50) | 12-15 min |
| Voice change x4 | included | 30s |
| 16 F2V slide loops `fast` (Path A only) | 160 credits (~$0.20) | 12-15 min |
| Music generation (~3-4 min track) | ~$0.10 | 60s |
| Stitch + mux subtitles | free | 2-3 min |
| **Path A: F2V slides, fast Davendra** | **~$0.26 + 200 credits** | **~25 min** |
| **Path B: pre-animated MP4 slides, quality Davendra** | **~$0.61 + 400 credits** | **~22 min** |

Reapit Strategic Briefing v3 (2026-05-13) — Path B + quality Davendra + 16 slide regens: ~$5.30 total over the full session including iteration cycles.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Veo rejects Davendra image with "content filter blocking first-frame image" | Photorealistic character (e.g. character_id=118) | Switch to character_id=109 (Pixar). No prompt rewording fixes this. See memory file. |
| Davendra voice silent in final video | Mono->stereo pan filter wrong | Use `pan=stereo\|FL=c0\|FR=c0` for mono VC files (see `nex_assemble.py`) |
| Stale Davendra video reuses old image | veo-cli cache hit on tag, not image hash | Clear `veo-cli/output-videos/*scene_NN*.mp4` before regen (Phase 3 cache hygiene) |
| Wrong video shown to user during preview | Cached output from previous run | Clear veo-cli cache + re-run; confirm timestamp on output file matches the run |
| Narration cut off mid-sentence | Video shorter than TTS | Loop video (Phase 5c) — `ffmpeg -stream_loop -1 -t {tts_dur}` |
| Narration drift across many segments | Concat demuxer DTS errors over 8+ segments | Use frame-aligned AV parity: `apad=whole_dur=N` + `-frames:v N` + `math.ceil(dur*24)/24` (see `stitch_bunty.py`) |
| AV mismatch +/- 41ms across stitched output | Concat filter re-encoding at boundaries | Switch to demuxer concat + per-segment AV-parity normalisation |
| Voice sounds different per Davendra clip | Veo gives different voice each clip | Voice-change ALL Davendra scenes with `--seed 42 --remove-bg-noise` |
| TTS too quiet vs Davendra voice | Bake volume too low | TTS=2.5, SFX=0.15 |
| Background music too loud | Music volume too high | 5% (`--music-volume 0.05`) |
| Davendra ad-libs extra words | Missing speech enforcement | Include full pattern: eyes wide open + speaks exactly + stops speaking + becomes completely still |
| Burn-in subtitles fail with parser error | FFmpeg built without libass on macOS | Use soft `mov_text` subtitles + sidecar `.srt` (Phase 9). Don't fight libass. |
| QuickTime won't play final MP4 | yuv444p output from color/fade filters | Always re-encode with `-pix_fmt yuv420p -profile:v high` after color grade or stitch |
| Animation video and narration durations don't match (Path B) | Pre-animated MP4 and total TTS differ | Compute PTS factor and apply `setpts={PTS}*PTS` filter (keep PTS in 0.85-1.20 range) |
| User asks to regen one slide's audio after final stitch | Manual full rerun is wasteful | `generate_tts.py --scenes "N"` then re-mux only the affected segment (Phase 10) |
| Davendra image looks "wrong" / different person | Go Bananas character_id sometimes drifts on Pro | Re-run `mcp__go-bananas__generate_image` with same character_id=109 — try 2-3 times if needed |

---

## Davendra Character Reference

- **Go Bananas Character ID**: `109` (Pixar — REQUIRED. Never use `118` for Veo.)
- **Description**: 3D Pixar-style animated South Asian Indian man, aged 45, beige polo shirt, warm brown skin, dark gray-black swept hair, kind brown eyes
- **Default setting**: Modern professional home office with warm wood tones, bookshelf, soft daylight
- **Strategic setting** (Reapit-style): Glass-walled executive briefing room with city skyline
- **Style register**: Warm executive — like a trusted strategic advisor. Slower, more measured cadence than B2C tone. Not slang-heavy.
- **Signature sign-off**: `"I'm Davendra, and I'll see you in the next one. Take care."`
- **ElevenLabs Voice ID**: `0vPMop5s0QLJlWyI0lJn` (used for BOTH TTS narration AND voice change)
- **Voice change seed**: `42` (deterministic)
- **Reference image presets** (Go Bananas IDs in case you need fresh refs): Profile `#3069`, Reference sheet `#3070`

**Pose bank (chained pairs)**:
- Intro 1 (scene 17): Begins still then speaks. Leaning forward, energetic hand gestures, excited expression.
- Intro 2 (scene 19): Camera tracks slightly right; continues thoughtful gesture, eyes engaging the camera.
- Outro 1 (scene 20): Static camera. Reflective leaning back, making a measured point.
- Outro 2 (scene 21): Holds still, warm sign-off smile, slight nod. Last 2 seconds completely still.

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

Confirmed effective on bunty's Match 6 — the v2 deck used corrected facts and produced a richer narrative. The same pattern applies to any presenter deck where NotebookLM burned the wrong info into a slide image.

---

## Cross-pollination notes (Bunty patterns to consider)

These are battle-tested in `skills/bunty/SKILL.md` and may be useful here:

1. **Env auto-load** — at the top of long pipelines, auto-load `.env.local` so API keys are always present. Avoids "why is my TTS call failing — oh, I forgot to source the env" debugging.
2. **Failed-artifact skip** — when re-running after a partial failure, skip scenes whose artifacts already exist on disk. Don't re-pay for completed work.
3. **Interactive preview pages** — for high-cost workflows, write an HTML preview alongside the final MP4 so you can review per-scene assets without scrubbing the video.
4. **Render-exactly-once guards** — when a model can render a slide twice in different visual styles (e.g. summary slide once as chart, once as photo), add an explicit "RENDER X EXACTLY ONCE — do NOT split / re-render / append a duplicate" instruction to the focus prompt. Cite a real incident as the example to make the point stick.

If you encounter the same problems Bunty hit, these are the proven fixes — port from `skills/video-replicator/scripts/bunty_helpers.py` and friends.
