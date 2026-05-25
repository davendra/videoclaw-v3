## FILM MODE — Cinematic Production Pipeline

### When to Use

- Creating original films, ads, or branded content from a one-line concept
- Reproducing a reference video with different subjects or visual style
- Building multi-scene narratives with character consistency and voice assignments
- Need time-segmented prompts for Seedance or flat SEALCAM prompts for Veo
- Want AI-generated screenplays with per-scene keyframes and camera direction

### Two Entry Points

| Entry | Command | Flow |
|-------|---------|------|
| **Top-Down** | `--concept "..."` | Concept → Screenplay → Characters → Breakdown → Videos |
| **COPY-to-Film** | `--reference-video "..."` | Analyze video → Auto-screenplay → Reproduce on any backend |

### Backend Selection

The same screenplay produces **different prompts** depending on backend:

| Backend | Prompts Generated | Modes Available |
|---------|-------------------|-----------------|
| `seedance` (default) | Time-segmented (`0-3s:`, `3-6s:` format) | T2V, I2V, audio-lipsync, motion-transfer |
| `useapi` | Flat SEALCAM (T2V full desc / I2V motion-only) | T2V, I2V, prompt-based lip-sync |
| `direct` | Flat SEALCAM (T2V full desc / I2V motion-only) | T2V, I2V, prompt-based lip-sync |

### Pipeline Phases

```
Phase 0: Concept    — Save concept, detect genre, create project dirs
Phase 0a: Analysis  — (COPY-to-Film only) SEALCAM+ analysis of reference video
Phase 1: Screenplay — Generate screenplay with keyframes (or convert from analysis)
Phase 2: Characters — Extract characters, create Go Bananas refs, assign voices
Phase 3: Breakdown  — Backend-aware prompts (Seedance time-segments OR Veo flat SEALCAM)
Phase 4: Images     → existing Phase 3 (Go Bananas generate_image with character_ids)
Phase 5: Videos     → existing Phase 4 (parallel_video_gen.py with backend flag)
Phase 6: Audio      → existing Phase 5 (TTS narration + background music)
Phase 7: Stitch     → existing Phase 6 (stitch_video.py)
Phase 8: Complete   — Mark pipeline complete, update DB
```

### CLI Commands

```bash
# Top-down: concept → full film (Seedance backend, default)
python skills/video-replicator/scripts/film_pipeline.py \
  --concept "30s luxury watch ad with elegant close-ups" \
  --project test-film --duration 30 --scenes 6 --backend seedance --dry-run

# Top-down: concept → full film (Veo backend via useapi)
python skills/video-replicator/scripts/film_pipeline.py \
  --concept "30s luxury watch ad" --project test-veo \
  --duration 30 --scenes 6 --backend useapi --dry-run

# COPY-to-Film: reference video → auto-screenplay → reproduce
python skills/video-replicator/scripts/film_pipeline.py \
  --reference-video "input.mp4" --project test-copy \
  --backend seedance --new-subject "A young woman in red dress"

# Resume from any phase
python skills/video-replicator/scripts/film_pipeline.py \
  --project test-film --resume-from breakdown

# Check pipeline status
python skills/video-replicator/scripts/film_pipeline.py \
  --project test-film --status

# Bottom-up enhance with existing frames
python skills/video-replicator/scripts/film_pipeline.py \
  --project test-film --enhance-with-frames "projects/test-film/images"
```

### Standalone Script Commands

```bash
# Screenplay Generator (standalone)
python skills/video-replicator/scripts/screenplay_generator.py \
  --concept "A love story in Paris" --duration 60 --scenes 8

# Story Engine: 3 modes (standalone, bottom-up)
python skills/video-replicator/scripts/story_engine.py story \
  --concept "Martial arts duel between deities" --shots 8
python skills/video-replicator/scripts/story_engine.py transitions \
  --frames-dir "projects/test/images"
python skills/video-replicator/scripts/story_engine.py enhance \
  --scenes "projects/test/analysis/f2v_scenes.json"

# Scene Breakdown (backend-aware, standalone)
python skills/video-replicator/scripts/scene_breakdown.py \
  --screenplay "projects/test/analysis/screenplay.json" \
  --backend seedance --genre cinematic

# Character Designer (standalone)
python skills/video-replicator/scripts/character_designer.py \
  extract --screenplay "projects/test/analysis/screenplay.json"
python skills/video-replicator/scripts/character_designer.py \
  references --screenplay "screenplay.json" --style "Disney Pixar 3D"
python skills/video-replicator/scripts/character_designer.py \
  save-ids --screenplay "screenplay.json" --ids 95,96 --project test
```

### Dashboard

```bash
# Start dashboard server (port 8766)
python skills/video-replicator/scripts/film_dashboard_server.py

# View in VitePress doc-site
cd doc-site && npm run docs:dev
# Navigate to /film-dashboard?project=test-film
```

The dashboard shows:
- **Pipeline Progress**: Phase stepper with pending/active/complete states
- **Screenplay Panel**: Concept, acts, expandable scenes with keyframe details
- **Character Gallery**: Cards with portraits, voice assignments, Go Bananas IDs
- **Scene Timeline**: Duration bars color-coded by mode, expandable prompt preview

### Workflow Pattern 1: Quick Concept Film (Seedance)

```
1. film_pipeline.py --concept "30s smartwatch ad" --project watch --duration 30 --scenes 6 --backend seedance
   → Generates screenplay with keyframes → extracts characters → creates time-segmented prompts
2. Pipeline pauses for Go Bananas character creation (MCP commands printed)
3. Execute Go Bananas commands → save character IDs
4. Pipeline resumes: generates images, videos (Seedance), audio, stitches
```

### Workflow Pattern 2: Reference Video Reproduction (COPY-to-Film)

```
1. film_pipeline.py --reference-video "original.mp4" --project copy --backend useapi
   → Runs SEALCAM+ analysis → converts to screenplay with keyframes → flat Veo prompts
2. Pipeline pauses for Go Bananas character creation
3. Resume: --resume-from images → generates images, videos (Veo), audio, stitches
```

### Workflow Pattern 3: Bottom-Up Enhance

```
1. Generate frames with Go Bananas (existing workflow)
2. story_engine.py transitions --frames-dir "images/"
   → Gemini Vision analyzes frame pairs → generates smooth transition prompts
3. story_engine.py enhance --scenes "f2v_scenes.json" --frames-dir "images/"
   → Enhances existing prompts with visual context
4. Continue with parallel_video_gen.py using enhanced prompts
```

### Key Concepts

**Keyframes**: Each screenplay scene contains 2-5 keyframes (~3s segments) with camera, action, lighting, audio, and pacing. Seedance uses these directly as time-segments. Veo collapses them into flat prose.

**Hero Subject**: Extracted from scene 1 and injected into all scenes for visual consistency (StoryGen pattern).

**Sliding Window**: Each scene receives context from its neighbors (A→B, B→C) to maintain continuity.

**Backend-Aware Breakdown**:
- **Seedance**: `"0-3s: Camera pushes in, hero picks up sword, backlight silhouette\n3-6s: Whip pan, clash of blades, strobe flashes"` + style tokens + negative prompts
- **Veo T2V**: `"Hero picks up sword in backlit arena. Camera pushes in as blades clash. Cinematic quality."` (flat, no time segments, no duration)
- **Veo I2V**: `"Camera pushes in. Subtle sword movement, clash of blades."` (motion-only, start frame has the visual)

> **Pro Tip**: For quick video-from-concept without the full film pipeline, use `story_engine.py story --concept "..."` which generates `f2v_scenes.json` directly (no screenplay, no characters).

### v2.43 Cinematic Quality Flags (Seedance)

These flags improve visual quality and consistency when using the Seedance backend. They work with both `film_pipeline.py` (via `parallel_video_gen.py`) and standalone `parallel_video_gen.py` calls.

#### Camera Shot Block (`--camera-variety`)

Appends `CAMERA_VARIETY_BLOCK` — a standardized list of camera angles — to every Seedance prompt. Prevents single-angle monotony across scenes.

```bash
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"Warrior approaches the throne","2":"King rises slowly"}' \
  --camera-variety --quality fast --yes
```

The block adds directives for extreme wide, wide, medium, close-up, tracking, crane, arc, high/low/Dutch angle, and top-down bird's-eye shots. Seedance selects the most contextually appropriate angle per scene.

#### 4K Pre-Flight Upscale (`--upscale-4k`)

Upscales all frame images to 4K via Go Bananas REST API before submitting to Seedance. Produces significantly sharper video output because Seedance starts from a higher-resolution first frame.

```bash
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"Slow push in","2":"Orbital pan"}' \
  --upscale-4k --quality fast --yes

# Custom upscale prompt
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"Slow push in"}' \
  --upscale-4k \
  --upscale-4k-prompt "upscale image, ultra sharp, 4K, preserve cinematic color grade" \
  --quality fast --yes
```

Upscaled images are auto-named with `_4k` suffix. `find_frame_image()` checks for the 4K variant first. Original images are preserved.

#### Style Consistency Check (`--check-style-consistency`)

Runs Gemini Vision over all frame images before generation, classifying each into a style category (`photorealistic`, `3d_animated`, `anime`, `sketch`, `illustration`, `mixed`). Warns when mixed styles are detected (the "Version 12 failure pattern"). Use `--style-consistency-fail` to abort instead of warn.

```bash
# Warn on mixed styles (default — continues anyway)
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"Push in","2":"Wide shot"}' \
  --check-style-consistency --quality fast --yes

# Abort if mixed styles detected (prevents wasted Seedance credits)
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"Push in","2":"Wide shot"}' \
  --check-style-consistency --style-consistency-fail --quality fast --yes
```

#### Storyboard Panels as Seedance References (`--storyboard-panels`)

Injects each scene's split storyboard panel as an extra Seedance image reference (`@image_file_N`). This constrains Seedance to match the intended composition from the storyboard.

```bash
# generate_storyboard.py auto-exports storyboard_panels.json after splitting
python skills/video-replicator/scripts/generate_storyboard.py \
  --project "{slug}" --grid-image "projects/{slug}/storyboard/grid.jpg"
# → outputs: projects/{slug}/storyboard/storyboard_panels.json

# Use panels as composition references during video generation
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"Slow push in","2":"Pan right"}' \
  --storyboard-panels "projects/{slug}/storyboard/storyboard_panels.json" \
  --quality fast --yes
```

#### Combined Quality Stack (recommended for cinematic productions)

```bash
python skills/video-replicator/scripts/parallel_video_gen.py \
  --product "{slug}" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"...","2":"...","3":"..."}' \
  --upscale-4k \
  --camera-variety \
  --check-style-consistency \
  --storyboard-panels "projects/{slug}/storyboard/storyboard_panels.json" \
  --prompt-enhance --genre cinematic \
  --quality fast --yes
```

### SEALCAM+ Choreography Layer (`--choreography` on rewrite_prompts.py)

The `--choreography` flag adds a CH (Choreography) dimension to SEALCAM+ rewrites. It generates 2-3 sentences describing micro-movement mechanics: gaze direction, weight/stance shifts, movement mechanics, reaction physics, and recovery states.

```bash
# Standard rewrite (no choreography)
python skills/video-replicator/scripts/rewrite_prompts.py \
  --analysis "projects/{slug}/analysis/sealcam_analysis.json" \
  --subject "A warrior monk in white robes" \
  --output "projects/{slug}/analysis/rewritten_prompts.json" \
  --mode i2v

# With choreography layer (adds CH micro-movement descriptions to each scene)
python skills/video-replicator/scripts/rewrite_prompts.py \
  --analysis "projects/{slug}/analysis/sealcam_analysis.json" \
  --subject "A warrior monk in white robes" \
  --output "projects/{slug}/analysis/rewritten_prompts.json" \
  --mode i2v \
  --choreography
```

**What CH adds per scene:**
- Preparatory beats: what the character does BEFORE the main action
- Speed/timing descriptors: "suddenly", "slowly", "at full speed", "pause then"
- Physics response: "stumbles back", "slides across floor", "dust cloud on impact"
- Recovery: what happens AFTER the action (stands up, brushes off, reacts)

**Example output (without CH):** `"Camera pushes in. Character raises sword."`

**Example output (with CH):** `"Camera pushes in. Character looks left, then right, cracks knuckles, then raises sword slowly with trembling arms before suddenly launching forward at full speed. On impact, sparks fly and the character slides three paces back, recovers, breathes hard."`

The CH layer integrates directly into T2V, I2V, and R2V prompts, making it compatible with all backends.

---

