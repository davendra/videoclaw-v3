## LONG-FORM MODE - Extended Video Pipeline

### When to Use

- Videos longer than 2 minutes with 10+ scenes
- Movie-style content with acts or chapters
- Mass recreation of multiple existing videos in a single batch
- Multi-project batches (e.g., 12 properties × 8 scenes each)
- Overnight batch generation with submit-then-poll workflow

### Pipeline Overview

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Phase 1:     │──▶│ Phase 2:     │──▶│ Phase 3:     │
│ Plan scenes  │   │ Generate     │   │ Batch video  │
│ (queue JSON) │   │ images       │   │ generation   │
└──────────────┘   └──────────────┘   └──────────────┘
                                             │
┌──────────────┐   ┌──────────────┐          │
│ Phase 6:     │◀──│ Phase 5:     │◀──┌──────┘
│ Final review │   │ Stitch with  │   │ Phase 4:
│              │   │ reorder +    │◀──│ Generate
└──────────────┘   │ music loop   │   │ audio (TTS
                   └──────────────┘   │ + music)
                                      └──────────────┘
```

### Phase 1: Queue Planning

Create a queue JSON file that defines all scenes across one or more projects:

```json
{
  "projects": {
    "villa-tour": {
      "aspect_ratio": "16:9",
      "scenes": [
        {
          "scene_number": 1,
          "seedance_prompt": "@image1 Aerial descend toward villa, golden hour",
          "seedance_duration": 8,
          "image_url": "https://cdn.example.com/villa_exterior.jpg",
          "status": "pending",
          "task_id": null,
          "video_path": null,
          "error": null
        },
        {
          "scene_number": 2,
          "seedance_prompt": "@image1 Push through front entrance",
          "seedance_duration": 8,
          "image_url": "https://cdn.example.com/villa_entrance.jpg",
          "status": "pending"
        }
      ]
    }
  }
}
```

**Key rules:**
- `@image1` prefix = image-to-video mode (uses `image_url` as start frame)
- No prefix = text-to-video mode (generates from scratch)
- `seedance_duration`: 4–15 seconds per scene
- `status`: `pending` → `submitted` → `completed` | `failed`
- Calculate total duration: sum of all `seedance_duration` values
- Multi-project: add multiple keys under `"projects"`

### Phase 2: Image Generation

Generate first-frame images for all I2V scenes using Go Bananas:

```python
mcp__go-bananas__generate_image(
    prompt="Villa exterior at golden hour, WIDE HORIZONTAL...",
    character_ids=[97],       # Optional: character consistency
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
```

After downloading images, set `image_url` in the queue JSON. The `ensure_urls()` function in `utils_upload.py` auto-rehosts images when needed (handles R2/catbox accessibility issues for Seedance's China-based infrastructure).

### Phase 3: Batch Video Generation

Use `seedance_batch.py` for large-scale generation:

```bash
# Dry-run first — preview what will be submitted
python seedance_batch.py --queue queue.json --all --dry-run

# Submit all pending scenes (sequential)
python seedance_batch.py --queue queue.json --all --quality fast

# Submit for one project only
python seedance_batch.py --queue queue.json --project villa-tour

# Submit a single scene
python seedance_batch.py --queue queue.json --project villa-tour --scene 3

# Concurrent polling (5 workers)
python seedance_batch.py --queue queue.json --all --concurrent 5

# Submit-only (don't wait for results — overnight batch)
python seedance_batch.py --queue queue.json --all --submit-only

# Poll-only (check results later)
python seedance_batch.py --queue queue.json --all --poll-only

# Retry failed scenes
python seedance_batch.py --queue queue.json --all --retry-failed

# Check status
python seedance_batch.py --queue queue.json --status
```

**Checkpointing:** The queue JSON is saved after each scene completes, so crashes don't lose progress. Resume by re-running the same command — completed scenes are skipped.

### Phase 4: Audio Generation

Generate narration and music while videos are processing:

```bash
# TTS narration
python generate_tts.py \
  --edit "projects/{slug}/audio/tts/editable_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --voice-name "Liam" --yes

# Background music (calculate duration from scene total)
python generate_music.py \
  --prompt "Cinematic orchestral, 85 BPM, building energy" \
  --duration 180 \
  --output "projects/{slug}/audio/background.mp3"
```

For long videos with multiple music segments, generate separate tracks and use `--audio-files` at stitch time (see Phase 5).

### Phase 5: Stitch with Advanced Features

Long-form videos benefit from scene reordering, music looping, and extended fade-outs:

```bash
# Basic stitch with music loop (auto-repeats music to match video)
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/long_form.mp4" \
  --music-loop

# Custom scene ordering (insert title=scene 0, credits=scene 99)
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --output "projects/{slug}/final/long_form.mp4" \
  --audio "projects/{slug}/audio/background.mp3" \
  --scene-order "0,35,1,2,3,4,5,36,6,7,8,99" \
  --music-loop

# Concatenate multiple audio files before mixing
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --output "projects/{slug}/final/long_form.mp4" \
  --audio-files bg_part1.mp3 bg_part2.mp3 bg_part3.mp3 \
  --music-loop

# Extended music fade-out (up to 30 seconds)
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/long_form.mp4" \
  --music-loop --music-fade-out 10

# With narration + logo intro/outro
python stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --narration "projects/{slug}/audio/tts/narration.mp3" \
  --output "projects/{slug}/final/long_form.mp4" \
  --logo-intro "projects/{slug}/videos/logo_intro.mp4" \
  --logo-outro "projects/{slug}/videos/logo_outro.mp4" \
  --music-loop --narrated
```

**FPS normalization** is automatic — mixed sources (24fps Veo + 25fps slides + 30fps Seedance) are normalized before concat.

### Phase 6: Final Review

1. Play the stitched video end-to-end
2. Check scene transitions for visible jumps (use `--chained` on parallel_video_gen.py if needed)
3. Verify audio sync across the full duration
4. Re-stitch with different `--scene-order` if needed (non-destructive)

### CLI Quick Reference

#### seedance_batch.py

| Flag | Description |
|------|-------------|
| `--queue FILE` | Path to queue JSON file (required) |
| `--all` | Process all pending scenes |
| `--project NAME` | Process scenes for one project (substring match) |
| `--scene N` | Process specific scene number (with `--project`) |
| `--status` | Print status report and exit |
| `--dry-run` | Preview without API calls |
| `--submit-only` | Submit tasks but don't poll |
| `--poll-only` | Only poll already-submitted tasks |
| `--retry-failed` | Include failed scenes |
| `--concurrent N` | Concurrent polling workers (0 = sequential) |
| `--quality fast\|quality` | Generation quality (default: fast) |
| `--prompt-enhance` | Auto-enhance prompts with cinematic style (v2.35) |
| `--genre GENRE` | Style genre for enhancement (default: cinematic) |
| `--base-path DIR` | Base projects directory |
| `--verbose` | Verbose logging |

#### parallel_video_gen.py (v2.43 Seedance quality flags)

| Flag | Description |
|------|-------------|
| `--camera-variety` | Append `CAMERA_VARIETY_BLOCK` to every Seedance prompt (Seedance only) |
| `--upscale-4k` | Upscale frame images to 4K via Go Bananas before submitting (Seedance only) |
| `--upscale-4k-prompt TEXT` | Custom prompt for 4K upscale (default: 'upscale image, high detail, 4K, preserve all details, cinematic quality') |
| `--check-style-consistency` | Gemini Vision style check across all frame images before generation (Seedance only) |
| `--style-consistency-fail` | Abort generation if mixed styles detected (default: warn only) |
| `--storyboard-panels FILE` | Path to `storyboard_panels.json` — injects each scene's panel as a Seedance image reference (Seedance only) |

#### stitch_video.py (long-form flags)

| Flag | Description |
|------|-------------|
| `--scene-order "0,1,2,3,99"` | Custom scene sequence (comma-separated numbers) |
| `--music-loop` | Auto-loop music to match total video duration |
| `--audio-files f1.mp3 f2.mp3` | Concatenate multiple audio files before mixing |
| `--music-fade-out N` | Fade out music over last N seconds (max 30, default 3) |

### Queue JSON Reference

```json
{
  "projects": {
    "project-name": {
      "aspect_ratio": "16:9",
      "scenes": [
        {
          "scene_number": 1,
          "seedance_prompt": "@image1 Camera description...",
          "seedance_duration": 8,
          "image_url": "https://...",
          "status": "pending",
          "task_id": null,
          "video_path": null,
          "error": null
        }
      ]
    }
  }
}
```

**Status states:** `pending` → `submitted` (task_id set) → `completed` (video_path set) | `failed` (error set)

**Also supports list format:**
```json
{
  "projects": [
    { "slug": "project-name", "aspect_ratio": "16:9", "scenes": [...] }
  ]
}
```

### Workflow Patterns

#### Pattern 1: Single Long Video (1 project, 20+ scenes)

1. Write queue JSON with 20+ scenes for one project
2. Generate images with Go Bananas (character_ids for consistency)
3. `seedance_batch.py --queue q.json --all --quality fast`
4. Generate TTS narration + background music
5. `stitch_video.py --videos-dir ... --music-loop --narrated`

#### Pattern 2: Mass Recreation (multiple projects, many scenes)

1. Write queue JSON with multiple projects (e.g., 12 properties × 8 scenes)
2. Generate images per project
3. `seedance_batch.py --queue q.json --all --concurrent 5` — batch all projects
4. Stitch each project independently

#### Pattern 3: Submit-Only + Poll-Later (overnight batch)

1. Submit during the evening:
   `seedance_batch.py --queue q.json --all --submit-only`
2. Check status next morning:
   `seedance_batch.py --queue q.json --status`
3. Download completed results:
   `seedance_batch.py --queue q.json --all --poll-only`

#### Pattern 4: Resume After Failure

1. Run fails mid-batch (network error, API timeout, etc.)
2. Check status: `seedance_batch.py --queue q.json --status`
3. Re-run same command — completed scenes are auto-skipped
4. Retry failures explicitly: `seedance_batch.py --queue q.json --all --retry-failed`

### Prompt Enhancement Engine (v2.35)

The `--prompt-enhance` flag auto-enhances Seedance prompts with cinematic techniques. Works on both `seedance_batch.py` and `parallel_video_gen.py`.

```bash
# Batch: enhance all prompts in queue before submission
python seedance_batch.py --queue q.json --all --prompt-enhance --genre cinematic

# Per-scene: enhance during generation
python parallel_video_gen.py --product "villa" --backend seedance \
  --prompt-enhance --genre luxury \
  --scenes '{"1":"Villa exterior"}' --quality fast
```

**What it adds:**

| Enhancement | Example |
|---|---|
| Camera vocabulary | "push_in" → "Camera slowly pushes forward toward..." |
| Time segments (8s+) | "0-4s: Establishing shot. 5-8s: Detail reveal" |
| Style tokens | "cinematic quality, shallow depth of field, film grain" |
| Negative prompts | "No text, no watermarks, no logos, no abrupt cuts" |

**Before:** `@image1 Villa exterior at golden hour`
**After:** `@image1 0-4s: Villa exterior at golden hour. 5-8s: Villa exterior at golden hour. cinematic quality, shallow depth of field, film grain, anamorphic widescreen, 24fps filmic motion. No text, no subtitles, no watermarks, no logos, no abrupt cuts.`

**Available genres:**

| Genre | Style Tokens |
|---|---|
| `cinematic` (default) | Shallow DOF, film grain, anamorphic, 24fps |
| `commercial` | Bright lighting, product-focused, clean composition |
| `documentary` | Natural lighting, observational camera, authentic |
| `dramatic` | High contrast, volumetric light, intense atmosphere |
| `luxury` | Golden hour, premium feel, Vogue aesthetic |
| `action` | Dynamic energy, motion blur, high contrast |
| `nature` | Natural beauty, organic palette, ambient light |
| `horror` | Desaturated cold tones, deep shadows, suspense |
| `romantic` | Soft warm glow, dreamy bokeh, pastel tones |
| `sci_fi` | Futuristic neon, cyberpunk lighting, atmospheric haze |

**Original preserved:** In batch mode, the original prompt is saved as `seedance_prompt_original` — enhancement is idempotent and non-destructive.

### Camera Reference Video (v2.35)

Use `--camera-ref` to replicate camera movement from a reference video. The reference video's camera work (pan, dolly, orbit, etc.) is applied to your generated scene.

```bash
# I2V with camera reference — scene inherits camera motion from ref video
python parallel_video_gen.py --product "villa" --backend seedance \
  --mode frames-to-video \
  --images-dir "projects/villa/images" \
  --camera-ref "projects/villa/reference/dolly_shot.mp4" \
  --scenes '{"1":"Villa exterior at golden hour"}' \
  --quality fast

# T2V with camera reference
python parallel_video_gen.py --product "villa" --backend seedance \
  --mode text-to-video \
  --camera-ref "reference/crane_shot.mp4" \
  --scenes '{"1":"Sunset over mountains"}' \
  --quality fast
```

**Mode compatibility:**

| Mode | Camera Ref | Notes |
|------|-----------|-------|
| `text-to-video` | Yes | Adds `@video1` reference |
| `frames-to-video` | Yes | Adds `@video1` alongside `@image1` |
| `motion-transfer` | Ignored | Already uses `@video1` for motion reference |
| `audio-lipsync` | Ignored | Lip-sync doesn't support camera refs |

**How it works:** The reference video is uploaded and added as `@video1` in the Seedance prompt with the instruction "Fully reference @video1's camera movements." Seedance replicates the camera trajectory while generating new content.

**Native audio:** Seedance 2.0 always generates synchronized audio natively — there is no toggle to disable it. All generated videos include ambient audio.

---

