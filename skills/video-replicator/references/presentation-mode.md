## PRESENTATION MODE - Slide Restyling Pipeline

Restyle slide-based presentation videos (PowerPoint recordings, educational content, explainer videos) OR convert PDF slide decks into animated videos with professional animations.

### Input Types

| Input | Source | Audio |
|-------|--------|-------|
| **Video** | Presentation recording (URL or path) | Extract from video |
| **PDF** | Slide deck (.pdf file) | AI narration or custom |

### Interactive Flow

Claude collects ALL decisions upfront via a structured questionnaire, then executes autonomously without further questions.

```
┌─────────────────────────────────────────────────────┐
│  PRESENTATION MODE - INTERACTIVE FLOW               │
├─────────────────────────────────────────────────────┤
│                                                     │
│  STEP 1: UPFRONT QUESTIONNAIRE (ask everything)     │
│    Q1. Input type (PDF / Video)                     │
│    Q2. Slide editing needed? (PDF only)             │
│    Q3. Restyle method (Skip / Reference / Fresh)    │
│    Q4. Content type (Medical / Business /           │
│        Educational / Creative)                      │
│    Q5. Animation style (Subtle / Dynamic /          │
│        Cinematic) — default from content type       │
│    Q6. Slide transitions (None / Dissolve / Fade /  │
│        Wipe) + duration                             │
│    Q7. Intro/outro (None / Custom Go Bananas cards) │
│    Q8. Audio source (Original / Custom / TTS /      │
│        AI Narration) + voice settings               │
│    Q9. Background music (None / Generate / Custom)  │
│        + mood if generating                         │
│                                                     │
│  STEP 2: EXECUTION PLAN PREVIEW                     │
│    - Show slide count, total duration               │
│    - Batching strategy (5 scenes per batch)         │
│    - Music duration (calculated from slides.json)   │
│    - Cost estimate                                  │
│    - Wait for user confirmation                     │
│                                                     │
│  STEP 3: AUTOMATED EXECUTION (no more questions)    │
│    Phase -1: Intro/outro cards (if custom)          │
│    Phase 0:  Slide editing (if requested)           │
│    Phase 1:  Extract slides                         │
│    Phase 5:  Audio (EARLY — narration + music)      │
│    Phase 3:  Restyle slides (if requested)          │
│    Phase 4:  Generate videos (AUTO-BATCHED)         │
│    Phase 6:  Stitch final video                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Content-Aware Defaults

Based on Q4 (content type), auto-set defaults for Q5, Q6, and music mood:

| Content Type | Default Animation | Default Transition | Music Mood Hint |
|---|---|---|---|
| Medical/Science | Subtle | Dissolve 0.5s | Ambient, meditative, gentle piano |
| Business | Subtle | Dissolve 0.5s | Corporate, upbeat, professional |
| Educational | Dynamic | Slide 0.5s | Energetic, engaging, modern |
| Creative | Cinematic | Fade 1.0s | Atmospheric, dramatic |

Present these defaults to the user in the questionnaire. They can override any default.

### Auto-Batching Rules

For presentations with 10+ slides, auto-batch video generation:

1. Split scenes into batches of 5
2. First batch: fresh run (`--fresh`, no `--continue`)
3. Subsequent batches: `--continue`
4. Always use `--parallel 2` within each batch
5. Always use `--fallback-quality --auto-simplify` for reliability
6. Write scene prompts to `projects/{slug}/f2v_scenes.json` (avoids CLI argument length limits)

```bash
# Batch 1 (scenes 1-5): fresh run
python parallel_video_gen.py --product "{slug}" --mode frames-to-video --f2v-loop \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"prompt1","2":"prompt2","3":"prompt3","4":"prompt4","5":"prompt5"}' \
  --ratio landscape --quality fast --variations 1 --parallel 2 \
  --fallback-quality --auto-simplify --allow-stale --yes

# Batch 2 (scenes 6-10): continue
python parallel_video_gen.py --product "{slug}" --mode frames-to-video --f2v-loop \
  --images-dir "projects/{slug}/images" \
  --scenes '{"6":"prompt6","7":"prompt7","8":"prompt8","9":"prompt9","10":"prompt10"}' \
  --ratio landscape --quality fast --variations 1 --parallel 2 \
  --fallback-quality --auto-simplify --continue --allow-stale --yes
```

### Music Duration Calculation

After Phase 1 extracts `slides.json`, calculate total video duration before generating music:

```
total_duration = sum(slide["duration"] for slide in slides.json["slides"])
              + intro_duration (if custom intro, typically 5-8s)
              + outro_duration (if custom outro, typically 5-8s)
music_duration = round_up(total_duration, 30)  # nearest 30s
```

Pass calculated duration to `generate_music.py --duration {music_duration}`.

**Gotcha**: Suno API may ignore the duration param and generate ~4 min clips. If music is shorter than video, stitch will loop it. If longer, stitch will fade out at video end.

### Custom Intro/Outro Workflow

Execute BEFORE the main pipeline (Phase -1):

1. Generate intro card with Go Bananas (`generate_image` matching presentation theme/style)
2. Generate outro card with Go Bananas (closing message + branding)
3. Animate both with `generate_logo_animation.py` (organic-growth or liquid-chrome preset)
4. Save to `projects/{slug}/assets/`
5. Pass to stitch via `--logo-intro` and `--logo-outro`

```python
# Example: Medical presentation intro card
mcp__go-bananas__generate_image(
    prompt="Elegant title card, parchment texture, ornate border, text reads 'Dr. Morse's Hydraulic Brain'. Medical illustration style, warm amber lighting.",
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
```

### Transition Options

Ask Q6 with these choices:

| Transition | FFmpeg Filter | Effect | Best For |
|---|---|---|---|
| `dissolve` (DEFAULT) | `xfade=transition=dissolve` | Smooth crossfade | General purpose |
| `fade` | `xfade=transition=fade` | Fade through black | Section breaks |
| `fadewhite` | `xfade=transition=fadewhite` | Fade through white | Clean, professional |
| `wipeleft` | `xfade=transition=wipeleft` | Directional wipe | Content flow |
| `slideleft` | `xfade=transition=slideleft` | Slide in from edge | Dynamic feel |
| None | (no filter) | Hard cut | Fast-paced content |

Default transition duration: 0.5s. Range: 0.3s - 1.0s.

### Example Conversation

Full example for a 15-slide medical PDF:

```
USER: I have a PDF of Dr. Morse's Hydraulic Brain lecture. Make it a video.

CLAUDE: I'll help create a presentation video. Let me ask a few questions upfront:

**Q1. Input**: PDF ✓ (provided)
**Q2. Slide editing**: Do you want to edit any slides before we start?
**Q3. Restyle**: Skip (use original slides), Reference (style transfer), or Fresh (new images)?
**Q4. Content type**: This looks like Medical/Science content — correct?
**Q5. Animation**: For medical content I recommend Subtle (minimal motion). Override?
**Q6. Transitions**: Dissolve 0.5s is default for medical. Override?
**Q7. Intro/outro**: Want custom title/closing cards? (Go Bananas)
**Q8. Audio**: AI Narration (Gemini writes script + ElevenLabs TTS), Custom MP3, or None?
   → If TTS: Voice preference? (default: "Rachel" professional female)
**Q9. Music**: Generate ambient background music, provide custom, or none?

USER: No editing, skip restyle, yes medical, subtle is fine, dissolve ok,
      yes make an intro card, AI narration with Rachel, generate ambient music.

CLAUDE: Here's the execution plan:

  📊 15 slides, ~6 min total duration
  🎬 Video generation: 3 batches of 5 (--parallel 2, ~15 min)
  🎵 Music: 390s → generate 7 min ambient track
  🎤 Narration: AI script + Rachel TTS
  🎨 Intro card: Go Bananas parchment style
  💰 Cost: ~15 × 10 credits = 150 credits (fast quality)

  Proceed?

USER: Yes

CLAUDE: [Executes entire pipeline autonomously — no more questions]
  Phase -1: Generate + animate intro card
  Phase 1:  Extract 15 slides → slides.json
  Phase 5:  Generate narration script → TTS → synced audio + background music
  Phase 4:  Batch 1 (scenes 1-5) → Batch 2 (6-10) → Batch 3 (11-15)
  Phase 6:  Stitch with dissolve transitions + intro + narrated preset
```

### Presenter Character + Slides Pattern (v2.32)

**"The Bunty Pattern"** — A character (cartoon/animated/real) hosts the video with lip-synced intro/outro, while slides play with TTS narration in between.

```
┌─────────────────────────────────────────────────────┐
│  PRESENTER CHARACTER WORKFLOW                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Phase A: Create character (Go Bananas)             │
│    1. Upload reference → create_character            │
│    2. Generate intro image (golden hour, excited)   │
│    3. Generate outro image (twilight, farewell)     │
│                                                     │
│  Phase B: Write dialogue for lip-sync scenes        │
│    - Write to dialogue.json (avoid shell escaping)  │
│    - ~25-35 words per 8s clip                       │
│    - For extended intro/outro: 2 scenes each        │
│                                                     │
│  Phase C: Generate lip-sync videos                  │
│    1. Generate first pair (intro 1 + outro 1)       │
│    2. Extract last frames (ffmpeg -sseof -0.1)      │
│    3. Generate chained pair (intro 2 + outro 2)     │
│    → Videos flow seamlessly within each pair        │
│                                                     │
│  Phase D: Extract slides + generate TTS             │
│    1. Extract slides from PDF → slides.json         │
│    2. Write narration script (per slide)            │
│    3. Generate TTS (skip lip-sync scenes)           │
│                                                     │
│  Phase E: Stitch with custom script                 │
│    1. Re-encode all segments to 1280x720 24fps      │
│    2. Concatenate: intros + slides + outros          │
│    3. Lip-sync segments keep Veo audio              │
│    4. Slide segments use image + TTS                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key rules for chained lip-sync:**
- Write dialogue to `.json` files, pass via `$(cat file.json)` to avoid shell escaping
- Extract last frame with `ffmpeg -sseof -0.1` — outputs 1280x720 from Veo video
- Copy extracted frame as both `_frame.jpg` and `_frame_landscape.jpg`
- Use `--image-run run002` for chained pair (images have run002 prefix)
- Custom stitch script handles mixed audio (Veo lip-sync + TTS slides)
- Use different camera movements per chained video for visual variety

**Camera prompt progression for chained videos:**

| Video | Camera | Effect |
|-------|--------|--------|
| Intro 1 | `slow push in` | Draws viewer in |
| Intro 2 | `tracking right` | Energy, movement |
| Outro 1 | `slow zoom out` | Reveals scene, wind-down |
| Outro 2 | `static` | Stability for sign-off |

**Dialogue writing tips:**
- Energetic commentary can fit ~35 words in 8s
- Calm/dramatic fits ~20-25 words in 8s
- End dialogue on a strong hook to flow into next video
- Each video's dialogue should be self-contained but build on the previous

### PDF Input Modes

**Equal duration**: User specifies total video duration, divided equally among slides.
```bash
python presentation_mode.py \
  --pdf "slides.pdf" --project "{slug}" \
  --total-duration 120 --animation subtle --yes
```

**Narration-driven**: AI analyzes each slide, writes narration, generates TTS, uses TTS duration per slide. Auto-syncs narration to slide durations (v2.25).
```bash
python presentation_mode.py \
  --pdf "slides.pdf" --project "{slug}" \
  --narration-driven --voice-name "Rachel" \
  --narration-style professional --animation subtle
```

**Individual PDF steps**:
```bash
# Extract slides from PDF
python extract_pdf_slides.py \
  --pdf "slides.pdf" \
  --output-dir "projects/{slug}/slides" \
  --output-json "projects/{slug}/analysis/slides.json" \
  --total-duration 120

# Generate AI narration script
python generate_narration_script.py \
  --slides-json "projects/{slug}/analysis/slides.json" \
  --slides-dir "projects/{slug}/slides" \
  --output "projects/{slug}/audio/tts/editable_transcript.json" \
  --style professional
```

### Animation Styles

| Style | Method | Behavior | Best For |
|-------|--------|----------|----------|
| **Subtle** (default) | F2V same start+end frame + loop | Minimal motion — one gentle ambient effect, 70-80% still | Presentations, narrated content, professional decks |
| **Cinematic** | I2V + freeze-first padding | Still slide displayed, animation plays at end of segment | Dramatic reveals, builds anticipation |
| **Dynamic** | F2V same start+end frame + loop | Continuous smooth animation throughout | Dynamic feel, keeps visual interest |

**Subtle**: Camera static. Only ONE gentle ambient motion (light shift, gradient drift, or soft glow). No sparkles, particles, parallax, or element animation. 70-80% of frame completely still. Best for presentations where content readability matters.

**Cinematic**: Extract first frame from animation → create freeze video → concat freeze + animation. The slide appears still while narration plays, then comes alive at the end.

**Dynamic**: Generate with F2V (same image as start AND end frame) → loop to fill target duration. Elements animate and naturally return to starting position for seamless loops.

> **Available features:** `--skip-restyle` uses original slides as-is (skips Go Bananas Phase 3), `--narration-driven` auto-generates narration script and syncs TTS timing to slides, `--edit-slides` enables pre-pipeline PDF text/image editing, `--animation both` produces Cinematic and Dynamic outputs from a single Veo run.

### Pipeline Commands

```bash
# Full interactive orchestrator (video input)
python presentation_mode.py \
  --video "path/to/presentation.mp4" \
  --project "{slug}"

# Full orchestrator (PDF input, equal duration)
python presentation_mode.py \
  --pdf "slides.pdf" --project "{slug}" \
  --total-duration 120 --animation subtle --yes

# Full orchestrator (PDF input, narration-driven, auto-synced audio)
python presentation_mode.py \
  --pdf "slides.pdf" --project "{slug}" \
  --narration-driven --voice-name "Rachel" --animation subtle

# Non-interactive with all options (video)
python presentation_mode.py \
  --video "path/to/presentation.mp4" \
  --project "{slug}" \
  --animation dynamic \
  --audio original \
  --threshold 0.3 \
  --yes

# Phase 0: Edit PDF slides before pipeline (optional)
python presentation_mode.py \
  --pdf "slides.pdf" --project "{slug}" --edit-slides

# Phase 0 (nano-pdf text edit, standalone)
nano-pdf edit "projects/{slug}/reference/deck.pdf" 3 "Change heading to 'Our Growth'" --output "projects/{slug}/reference/edited_slides.pdf"
```

### Phase 0: PDF Pre-Processing (Optional)

After receiving the PDF, ask:

> "Do you want to edit any slides before we proceed?
> I can fix text directly in the PDF, replace images using AI, or both."

**If yes:**
1. Extract slides as preview images (low-res, fast)
2. Present numbered slide list to user
3. Collect all edit instructions in conversation
4. Process edits:
   - **Text**: `nano-pdf edit deck.pdf {page} "{instruction}" --output edited_slides.pdf`
   - **Images**: Go Bananas `generate_image` / `edit_image` → replace slide image
   - **Combined**: nano-pdf first → re-extract → Go Bananas for image regions
5. Show edited slides for approval
6. Loop until approved, then proceed to Phase 1

**If no:** Skip to Phase 1.

**Edit type routing:**

| Edit Type | Tool | Example |
|-----------|------|---------|
| Fix typo / change text | nano-pdf edit | `nano-pdf edit deck.pdf 3 "Change 'Revnue' to 'Revenue'"` |
| Change heading | nano-pdf edit | `nano-pdf edit deck.pdf 1 "Change title to 'Q4 Results'"` |
| Update numbers/stats | nano-pdf edit | `nano-pdf edit deck.pdf 5 "Change 25% to 32%"` |
| Replace chart/image | Go Bananas | `generate_image(prompt="Bar chart showing...", aspect_ratio="16:9")` |
| Restyle slide visual | Go Bananas | `edit_image(image_id=..., prompt="Make background dark blue")` |
| Add new slide | nano-pdf add | `nano-pdf add deck.pdf 3 "New slide with title 'Roadmap'"` |

**Go Bananas slide editing example:**
```python
# Replace a chart or image region on a slide
mcp__go-bananas__generate_image(
    prompt="Professional bar chart showing Q1=25%, Q2=32%, Q3=41%, Q4=48% growth. Clean white background, modern style.",
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
# Then overlay or replace in the slide image
```

```bash
# Phase 1: Detect slides (from video)
python extract_frames.py \
  --video "input.mp4" \
  --detect-slides \
  --threshold 0.3 \
  --output-dir "projects/{slug}/slides" \
  --output-json "projects/{slug}/analysis/slides.json"

# Phase 1: Extract slides (from PDF)
python extract_pdf_slides.py \
  --pdf "slides.pdf" \
  --output-dir "projects/{slug}/slides" \
  --output-json "projects/{slug}/analysis/slides.json" \
  --total-duration 120

# Phase 4a: Auto-generate animation prompts (Gemini Vision)
python generate_animation_prompts.py \
  --slides-json "projects/{slug}/analysis/slides.json" \
  --images-dir "projects/{slug}/images" \
  --output "projects/{slug}/analysis/animation_prompts.json" \
  --style dynamic  # or cinematic

# Phase 4b: Generate videos with F2V loop (Dynamic)
python parallel_video_gen.py \
  --product "{slug}" \
  --mode frames-to-video \
  --f2v-loop \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"animation prompt"}' \
  --ratio landscape --quality fast --variations 1

# Phase 6: Stitch with timing sync
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --narration "projects/{slug}/audio/original.mp3" \
  --output "projects/{slug}/final/presentation.mp4" \
  --sync-timestamps "projects/{slug}/analysis/slides.json" \
  --loop-fill \
  --narration-volume 0.9

# Resume from specific phase
python presentation_mode.py \
  --project "{slug}" --resume-from 4 --animation dynamic

# Regenerate specific scenes
python presentation_mode.py \
  --project "{slug}" --regenerate-scenes "3,7,12" --animation dynamic

# Check status
python presentation_mode.py --project "{slug}" --status
```

### Dual Export

Generate F2V clips once, produce both outputs from a single Veo run:
- **Dynamic**: Loop clips to fill duration
- **Cinematic**: Extract first frame, freeze-pad, append clip (FFmpeg only, no extra Veo cost)

```bash
python presentation_mode.py \
  --video "presentation.mp4" \
  --project "{slug}" \
  --animation both
```

### Data Contract: slides.json

Central data structure produced by Phase 1 and consumed by all subsequent phases.

**Video input** sets `source_video` and `detection_threshold`. **PDF input** sets `source_type: "pdf"` and `source_file`.

```json
{
  "total_slides": 19,
  "source_type": "pdf",
  "source_file": "/path/to/slides.pdf",
  "source_duration": 383.5,
  "slides": [
    {
      "slide": 1,
      "timestamp": 0,
      "duration": 16.0,
      "original_image": "slides/slide_01.jpg",
      "restyled_image": "images/scene_1_frame.jpg",
      "animation_prompt": "Camera: static. Running figure animates...",
      "video": "videos/run001_scene_1.mp4",
      "status": "complete"
    }
  ],
  "settings": {
    "animation_style": "subtle",
    "audio_source": "original",
    "audio_path": "audio/original.mp3"
  }
}
```

Status progression: `detected` -> `restyled` -> `prompted` -> `generated` -> `complete`

---

