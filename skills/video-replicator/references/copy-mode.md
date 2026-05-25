## COPY MODE - Analysis Workflow

### Workflow Modes

Present to user at start:

| Mode | Flow | Best For |
|------|------|----------|
| **Fully Automated** | Analyze → Images → Videos → Stitch → Music | Quick turnaround |
| **Semi-Automated** | Analyze → Images → Videos → User stitches | Quality control |
| **Analysis Only** | Output SEALCAM+ JSON | Manual generation |

> **Pro Tip**: For advanced reproduction with time-segmented prompts, character consistency, and screenplay tracking, use **FILM MODE** with `--reference-video`:
> ```bash
> python film_pipeline.py --reference-video "input.mp4" --project my-copy --backend seedance
> ```
> This runs SEALCAM+ analysis → auto-generates screenplay with keyframes → produces backend-optimized prompts for either Seedance or Veo.

## 6-Phase Pipeline (Enhanced)

### Phase 0: Input Collection

Gather from user:
1. **Reference Video**: URL or local path
2. **Subject Image**: Product photo or character reference
3. **Swap Instructions**: What to replace
4. **Style Overrides** (optional): Background, color grading changes
5. **Generation Mode** (optional): T2V, I2V, F2V, or R2V

### Phase 1: Video Analysis (SEALCAM+)

```bash
python scripts/analyze_video.py \
  --video "path/or/url" \
  --output "projects/{product}/analysis/sealcam_analysis.json" \
  --project "{product}" \
  --save-to-db
```

Enhanced analysis includes:
- **Structured action**: primary, secondary, speed, path, start/end pose, keyframes
- **Micromotion**: breathing, fabric, hair, weight shifts
- **Camera detail**: shot type, angle, movement type/speed/direction, focus
- **Continuity notes**: Scene transition concerns

See `references/sealcam-prompt.md` for full SEALCAM+ system prompt.

> **Available features:** `--transcribe` adds audio transcription during analysis (requires Whisper), `extract_frames.py` extracts reference frames at scene timestamps for style transfer, `--save-to-db` tracks analysis in database for pattern learning.

### Phase 1.5: Frame Extraction (NEW)

Extract reference frames from the analyzed video at scene timestamps. These frames can be used for:
- **Style Transfer**: Upload to Go Bananas `edit_uploaded_image` to restyle while preserving pose/composition
- **Visual Reference**: Use as inspiration for fresh image generation with `generate_image`

```bash
# Batch: extract one frame per scene from analysis
python scripts/extract_frames.py \
  --video "projects/{product}/reference/original.mp4" \
  --analysis "projects/{product}/analysis/sealcam_analysis.json" \
  --output-dir "projects/{product}/reference/frames" \
  --position start       # start | middle | end of each scene

# Single scene
python scripts/extract_frames.py \
  --video "projects/{product}/reference/original.mp4" \
  --analysis "projects/{product}/analysis/sealcam_analysis.json" \
  --scene 3 \
  --output-dir "projects/{product}/reference/frames"

# Arbitrary timestamp
python scripts/extract_frames.py \
  --video "projects/{product}/reference/original.mp4" \
  --timestamp "0:15" \
  --output "projects/{product}/reference/frames/custom_frame.jpg"

# Auto keyframe detection (no analysis needed)
python scripts/extract_frames.py \
  --video "projects/{product}/reference/original.mp4" \
  --keyframes --threshold 0.4 \
  --output-dir "projects/{product}/reference/frames"

# Dry-run preview
python scripts/extract_frames.py \
  --video "..." --analysis "..." --dry-run
```

**Output structure:**
```
projects/{product}/reference/frames/
├── scene_1_frame.jpg
├── scene_2_frame.jpg
└── scene_3_frame.jpg
```

#### Workflow A: Style Transfer (exact pose/composition)

Use extracted frames as input for Go Bananas `edit_uploaded_image` to apply your character/style while preserving the original pose and composition:

```python
# 1. Upload extracted frame
result = mcp__go-bananas__upload_image_for_editing(
    image_path="projects/{product}/reference/frames/scene_1_frame.jpg"
)

# 2. Edit with character/style transfer
edited = mcp__go-bananas__edit_uploaded_image(
    uploaded_image_id=result["id"],
    edit_prompt="Transform to luxury fashion editorial style, maintain exact pose and composition",
    character_id=27,
    model_id="gemini-pro-image"
)

# 3. Download edited image to images dir for video generation
# Save as: projects/{product}/images/run001_scene_1_frame.jpg
```

#### Workflow B: Visual Reference (creative freedom)

Use extracted frames as composition/pose reference when generating fresh images:

```python
# 1. Review extracted frame for pose/composition reference
# 2. Generate fresh image inspired by the frame
mcp__go-bananas__generate_image(
    prompt="[describe pose and composition from reference frame] ...",
    character_id=27,
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
```

**When to use each workflow:**

| Workflow | Best For | Fidelity |
|----------|----------|----------|
| **A: Style Transfer** | Exact pose matching, product placement | High (same composition) |
| **B: Visual Reference** | Creative reinterpretation, different characters | Medium (inspired by) |

### Phase 1.5T: Audio Transcription (Optional)

**Ask the user:** "Would you like to transcribe the video audio? This captures speech/dialogue for reference."

If yes, run transcription using OpenAI Whisper CLI:

```bash
# Standalone transcription with scene alignment
python scripts/transcribe_audio.py \
  --video "projects/{product}/reference/original.mp4" \
  --analysis "projects/{product}/analysis/sealcam_analysis.json" \
  --output "projects/{product}/analysis/transcript.json"

# Or inline with analysis (adds transcript to SEALCAM+ JSON)
python scripts/analyze_video.py \
  --video "projects/{product}/reference/original.mp4" \
  --output "projects/{product}/analysis/sealcam_analysis.json" \
  --transcribe --whisper-model medium

# Dry-run (check Whisper installed, detect audio/speech)
python scripts/transcribe_audio.py \
  --video "projects/{product}/reference/original.mp4" --dry-run
```

**Whisper model selection:**

| Model | Params | RAM | Speed | Quality | Best For |
|-------|--------|-----|-------|---------|----------|
| `tiny` | 39M | ~1GB | Fastest | Low | Quick preview |
| `base` | 74M | ~1GB | Fast | Fair | Testing |
| `small` | 244M | ~2GB | Moderate | Good | Short clips |
| `medium` | 769M | ~5GB | Slow | High | **Recommended** |
| `large` | 1550M | ~10GB | Slowest | Best | Final quality |

**Requirements:** `brew install openai-whisper` (local, free, runs on CPU/GPU)

**Use cases:**
- Narrated ads: capture voice-over text for rewriting
- Dialogue reference: preserve spoken content when replicating
- Accessibility: generate subtitles for reference
- Lip-sync awareness: know which scenes have speech (affects video generation)

### Phase 2: Prompt Rewriting (4 Modes)

```bash
python scripts/rewrite_prompts.py \
  --analysis "projects/{product}/analysis/sealcam_analysis.json" \
  --subject "Description of new subject" \
  --output "projects/{product}/analysis/rewritten_prompts.json" \
  --mode i2v \
  --project "{product}"
```

Generates optimized prompts for each mode:

| Mode | Content | When to Use |
|------|---------|-------------|
| **T2V** | Full scene (subject, env, action, lighting, camera, style) | No reference image |
| **I2V** | Motion only (camera movement, subject action, micromotion) | Have first-frame image |
| **F2V** | Transition instructions (interpolate start→end) | Have both start AND end frames |
| **R2V** | New scene + reference adherence | Have reference images for consistency |

**Key Rule for I2V**: Don't re-describe what's in the image - only describe HOW it moves.

Rules:
- Keep Environment, Action, Lighting, Camera, Metatokens structure
- Only swap Subject
- Remove text overlays from prompts
- Use motion-only prompts for I2V mode
- **Speech enforcement**: When adding dialogue to presenter/speaking scenes, use this exact pattern:
  `he speaks exactly these words and nothing else: "[dialogue]". He stops speaking after finishing the line. No additional speech.`
  This prevents Veo from ad-libbing or generating extra speech beyond the scripted line.

> **Available features:** `--create-characters` for Go Bananas character references (keeps faces consistent across scenes), `--transitions` for AI camera transitions between scenes, `--mode i2v` / `--mode r2v` for different prompt strategies.

### Phase 2.5: Transition Selection (Optional)

AI camera transitions create organic in-camera transitions during Veo generation, eliminating post-production effects. Transitions are **outgoing only** — they append to the END of Scene N's prompt.

**When to use**: Multi-scene videos where hard cuts feel jarring. Skip for single scenes or intentional hard-cut style.

**How to assign**:
```bash
# Pass transitions as JSON dict: scene_number → transition_id
python parallel_video_gen.py \
  --product "{slug}" \
  --scenes '{"1":"prompt1","2":"prompt2","3":"prompt3"}' \
  --transitions '{"1":"zoom_crash","2":"atmo_fog"}'
```

**Quick reference** — choose by vibe:

| Vibe | Transitions | IDs |
|------|------------|-----|
| High energy | Whip pan, Crash zoom, Barrel roll | `wipe_whip_pan`, `zoom_crash`, `roll_barrel` |
| Dreamy/ethereal | Fog roll, Slow roll, Light flare | `atmo_fog`, `roll_slow`, `atmo_light` |
| Documentary | Lateral slide, Tilt+fade, Object wipe | `dolly_lateral`, `combo_tilt_fade`, `wipe_object` |
| Product reveal | Shape match, Snap zoom, Zoom pull | `match_shape`, `zoom_snap`, `zoom_pull` |
| Dramatic | Vertigo, Eye zoom, Dutch roll | `dolly_vertigo`, `match_eye`, `roll_dutch` |
| Surreal | Infinite zoom, Dolly through, Portal tunnel | `zoom_infinite`, `dolly_through`, `portal_tunnel` |

**Mode compatibility**: T2V and R2V support all transitions. I2V supports most (except full orbits, barrel rolls, and through-object moves). F2V does not support transitions (both endpoints fixed).

**Disable transitions**: Use `--no-transitions` to skip any analysis-recommended transitions.

See `references/camera-transitions.md` for the full library of ~30 transitions with detailed descriptions.

### Phase 3: Image Generation (Go Bananas MCP)

**Step 3a: Upload Reference Images (required for characters/products)**

Go Bananas requires hosted images (not local paths). Follow this workflow:

1. **Host the image** (if local file):
   - Use freeimage.host, imgbb.com, or similar service
   - Get the direct image URL (must end in .jpg/.png or be direct link)

2. **Upload to Go Bananas**:
```
mcp__go-bananas__upload_image_for_editing
  image_url: "https://hosted-url.com/image.jpg"
```
Returns: `image_id` (e.g., "abc123xyz")

**Step 3b: Create References (first time only)**

For character (model/person):
```
mcp__go-bananas__create_character
  character_name: "{product}_presenter"
  base_prompt: "{detailed appearance description}"
  reference_image_ids: ["{image_id from upload}"]
```

For product:
```
mcp__go-bananas__create_product_reference
  product_name: "{product}"
  product_url: "https://product-page-url.com"  # or hosted image URL
```

#### Prompt Simplification for Character References

**CRITICAL:** When using `character_id`, the reference image handles the face/body.
Prompts should focus on **pose, action, environment** only.

| Include in Prompt | Exclude from Prompt |
|-------------------|---------------------|
| Pose/gesture | Character name |
| Action/movement | Facial expressions (smile, frown) |
| Environment/setting | Body descriptions |
| Clothing | Age descriptors |
| Lighting/mood | Hair descriptions |
| Camera angle | Skin tone |

**Example Transformation:**

Over-described (character ignored):
```
Ram Patel, warm genuine smile, greeting gesture with hands together
in namaste. Young Indian man with confident expression...
```

Action-focused (character followed):
```
Man doing namaste greeting gesture. Desert sand dunes background.
Black traditional kurta. Medium shot, cinematic 8K.
```

The `character_id=27` handles Ram's face - don't re-describe it.

See `references/character-prompts.md` for more examples and the full pattern detection guide.

**Step 3c: Generate First Frames**

**⚠️ MANDATORY: Use Pro model (`gemini-pro-image`) - Standard model ignores character references!**

The Standard model (`gemini-flash-image`) does NOT properly follow character/product references.
You MUST include `model_id="gemini-pro-image"` in EVERY generate_image call.

For character-based scenes:
```
mcp__go-bananas__generate_image
  prompt: "{image_prompt from rewritten prompts}"
  character_id: {character_id}
  aspect_ratio: "16:9"  # or "9:16" for portrait
  model_id: "gemini-pro-image"  # ⚠️ REQUIRED - Standard ignores character refs!
```

For product-based scenes:
```
mcp__go-bananas__generate_image
  prompt: "{image_prompt}"
  product_id: {product_id}
  aspect_ratio: "16:9"
  model_id: "gemini-pro-image"  # ⚠️ REQUIRED - Standard ignores product refs!
```

Save images to `projects/{product}/images/run001_scene_{N}_frame.png` (run prefix required for freshness validation)

**Step 3d: Analyze Start Frames (Optional but recommended)**

```bash
python scripts/analyze_start_frame.py \
  --image "projects/{product}/images/scene_1_frame.png" \
  --scene-data "projects/{product}/analysis/scene_1.json" \
  --generate-prompt
```

This validates frame matches scene expectations and generates accurate continuation prompts.

---

### ⚠️ MANDATORY CHECKPOINT: Image Review Before Video Generation

**STOP HERE. DO NOT proceed to Phase 4 without user approval.**

Video generation is expensive (~$0.05/video) and time-consuming (~100s/scene). Always pause for user review after generating images.

**Present images to user:**
```
┌─────────────────────────────────────────────────────┐
│  📸 IMAGE REVIEW CHECKPOINT                         │
├─────────────────────────────────────────────────────┤
│  Please review the generated images before I        │
│  proceed to video generation.                       │
│                                                     │
│  Scene 1: [URL]                                     │
│  Scene 2: [URL]                                     │
│  Scene 3: [URL]                                     │
│  ...                                                │
│                                                     │
│  ✓ Approve all - proceed to video generation       │
│  ✗ Reject scenes [N,N] - regenerate specific scenes│
│  ⟲ Start over - regenerate all images              │
└─────────────────────────────────────────────────────┘
```

**If user rejects scenes:**
1. Regenerate only the rejected scenes
2. Show updated images
3. Ask for approval again
4. Only proceed when ALL scenes are approved

**Why this matters:**
- Video generation costs ~70 credits per 7 scenes (~$0.35)
- Each scene takes ~100 seconds to generate
- Wrong images = wasted time and money
- Catching issues here saves significant resources

> **Available features:** `--check-character-match` detects scenes needing character age/style variants, `--dry-run` on `generate_images.py` shows cost preview without generating, `review_images.py --auto-regenerate` auto-fixes low-quality images.

---

**Go Bananas Quick Reference**

| Task | Tool | Key Parameters |
|------|------|----------------|
| Upload image | `upload_image_for_editing` | `image_url` |
| Create character | `create_character` | `character_name`, `base_prompt`, `reference_image_ids` |
| Create product ref | `create_product_reference` | `product_name`, `product_url` |
| **Generate image** | `generate_image` | `prompt`, `character_id`/`product_id`, `aspect_ratio`, **`model_id="gemini-pro-image"`** |
| List characters | `list_characters` | (none) |
| List products | `list_product_references` | (none) |

**Model Selection:**
- **Always use `model_id: "gemini-pro-image"` (Pro)** for production images
- Pro model offers better quality, detail, and consistency
- Standard model (`gemini-flash-image`) is faster but lower quality

**Ready-to-Copy Examples (with Pro model):**

Single character portrait:
```python
mcp__go-bananas__generate_image(
    prompt="Woman standing in a snowy forest, wearing elegant winter coat, looking at camera, soft natural lighting, cinematic composition",
    character_id=27,
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)
```

Single character landscape:
```python
mcp__go-bananas__generate_image(
    prompt="Man walking along beach at sunset, casual summer style, golden hour lighting, wide shot showing environment",
    character_id=42,
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
```

Multiple characters:
```python
mcp__go-bananas__generate_image(
    prompt="Family gathered around dining table, warm interior lighting, festive atmosphere, medium shot",
    character_ids=[27, 28, 29],
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
```

Product shot:
```python
mcp__go-bananas__generate_image(
    prompt="Luxury handbag on marble surface, soft studio lighting, product photography style, clean background",
    product_id=15,
    aspect_ratio="1:1",
    model_id="gemini-pro-image"
)
```

### Phase 3b: Image Quality Review (NEW)

**Automated quality validation before video generation.**

Generated images from Go Bananas can have quality issues (anatomical problems, composition issues) that should be caught before the expensive video generation step.

```bash
# Review all images (dry-run first)
python scripts/review_images.py \
  --project "{product}" \
  --dry-run

# Review and auto-regenerate failures
python scripts/review_images.py \
  --project "{product}" \
  --auto-regenerate \
  --max-retries 3

# With character reference for consistent regeneration
python scripts/review_images.py \
  --project "{product}" \
  --auto-regenerate \
  --character-id 27
```

**Quality Scoring (Gemini Vision API):**

| Check | Weight | Description |
|-------|--------|-------------|
| Anatomy | **50%** | Limbs, hands, face, proportions (dealbreaker) |
| Aspect Ratio | **20%** | Matches target ratio (critical for video) |
| Composition | 20% | Framing, subject placement |
| Prompt Adherence | 10% | Required elements (often N/A due to prompt mismatch) |

**Score Thresholds (realistic for AI images):**

| Score | Action |
|-------|--------|
| >= 0.75 | Auto-approve |
| 0.50-0.74 | Flag for manual review |
| < 0.50 | Auto-regenerate |

**Workflow:**
```
Phase 3: Go Bananas generates images
    ↓
Phase 3b: review_images.py analyzes quality
    ↓
All pass (>= 0.85)? → Phase 4: Video Generation
    ↓
Failures (< 0.65)? → Auto-regenerate with same character
    ↓
Loop up to 3 times
    ↓
Still failing? → Stop and flag for manual review
```

**Output MCP commands for Claude to regenerate:**
```bash
python scripts/review_images.py \
  --project "{product}" \
  --auto-regenerate \
  --mcp-output
```

### Phase 3b.5: Character Variant Evaluation (NEW)

**Check if scenes require character appearances different from existing references.**

When using character references with Go Bananas, the model CANNOT reconcile mismatches between reference appearance and prompt requirements. For example, if your character reference is a 20-year-old but the scene requires a "father in his 50s", you'll get inconsistent results.

**Decision Flow:**
```
Scene Analysis
     ↓
Does scene require appearance different from reference?
     ↓
  NO → Use existing character_id
     ↓
  YES → Does variant already exist?
          ↓
    YES → Use variant character_id
          ↓
    NO → Create variant:
         1. Generate with original char + aging prompt
         2. Create new character from result
         3. Use new character_id
```

**Run character match check before image generation:**
```bash
python scripts/generate_images.py \
  --project "{product}" \
  --character-id 27 \
  --check-character-match \
  --dry-run
```

**Output example:**
```
=== CHARACTER MATCH ANALYSIS ===

Character: Ram Patel (ID: 27)
Base prompt: "18 year old Ram Patel Indian..."

Scene 1: ✓ MATCH - No age specified
Scene 2: ✗ MISMATCH - Scene requires "father in his 50s"
  → Suggested: Create "Ram Patel 50" variant
  → Variant prompt: "Ram Patel at 50 years old, distinguished, gray at temples"
Scene 3: ✗ MISMATCH - Scene requires "elderly grandfather"
  → Suggested: Create "Ram Patel 70" variant
```

**Creating an aged variant:**
```python
# Step 1: Generate aged version using original character
mcp__go-bananas__generate_image(
    prompt="Ram Patel at 50 years old, distinguished Indian man, gray at temples, mature features, portrait headshot",
    character_id=27,  # Original young character
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)

# Step 2: Create new character from the result
mcp__go-bananas__create_character(
    character_name="Ram Patel 50",
    base_prompt="Ram Patel at 50 years old, distinguished, mature features",
    reference_image_ids=[generated_image_id],
    description="Aged variant of Ram Patel for father/mature scenes"
)

# Step 3: Use new character_id for relevant scenes
mcp__go-bananas__generate_image(
    prompt="Family walking in snowy forest...",
    character_ids=[28, 25, 24],  # Ram Patel 50 + other family members
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)
```

**Variant naming convention:**
| Pattern | Example | Use Case |
|---------|---------|----------|
| `{Name} {Age}` | "Ram Patel 50" | Age variants |
| `{Name} {Style}` | "Ram Patel Formal" | Style variants |
| `{Name} Young` | "Ram Patel Young" | Explicitly young version |

**When to create variants vs when to use existing:**
| Change Type | Action |
|-------------|--------|
| Age change (20s→50s) | **Create variant** |
| Hair color/style | **Create variant** |
| Facial hair (beard/clean-shaven) | **Create variant** |
| Clothing only | Use existing (clothing in prompt) |
| Different pose | Use existing |
| Different environment | Use existing |
| Different lighting | Use existing |

See `references/character-variants.md` for detailed workflow and examples.

### Phase 4: Video Generation (veo-cli)

#### Backend Selection

Choose between two backends for video generation:

| Backend | Cost | Speed | Best For |
|---------|------|-------|----------|
| `direct` (default) | Free | ~100s/scene | Development, debugging |
| `useapi` | $0.05-0.50/video | ~100s/scene | Production, automation |

```bash
# Default: fresh run + clean old videos (recommended)
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --scenes '{"1":"prompt"}'
# Creates run001 (or next run#), cleans old videos

# Continue existing run (e.g., regenerate failed scene)
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --scenes '{"3":"fixed prompt"}' \
  --continue
# Adds to current run without cleaning

# Backend selection (direct=free, useapi=paid)
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --scenes '{"1":"prompt"}' \
  --backend useapi
# Requires: USEAPI_API_TOKEN and USEAPI_ACCOUNT_EMAIL env vars
```

#### Recommended: Frames-to-Video with I2V Prompts

```bash
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --mode frames-to-video \
  --images-dir "projects/{product}/images" \
  --scenes '{
    "1": "{I2V motion prompt}",
    "3": "{I2V motion prompt}"
  }'
```

**I2V Prompt Example** (motion-only):
```
Camera: tracking left-to-right, matches subject speed, eye level.
Subject: walks slowly in profile view (30% pace).
Also: minimal arm swing, neutral expression.
Subtle details: fabric: catches light on movement; hair: slight sway.
Motion: 0%: enters frame left → 50%: crosses center → 100%: exits right.
Maintain exact appearance from start frame. Smooth continuous motion.
```

**NOT This** (re-describing image - wrong for I2V):
```
Female model in snow-white Prada jacket in infinite white void walking left to right...
```

**Speech/Dialogue Prompt** (for presenter scenes with spoken lines):
```
young man leaning forward at wooden table holding lit incense, warm low-key
cinematic lighting, dark studio. He speaks exactly these words and nothing else:
"Sanatana Dharma is not just a religion, it is a way of life."
He stops speaking after finishing the line. No additional speech.
Subtle incense smoke drifting upward, intimate documentary style.
```

**Speech Enforcement Rules:**
- Always wrap dialogue in quotes after "speaks exactly these words and nothing else:"
- Always end with "He/She stops speaking after finishing the line. No additional speech."
- Keep dialogue concise (1-2 sentences max per ~8s clip)
- Place the speech instruction AFTER the visual scene description
- Veo 3 `fast` and `quality` modes both support audio generation including speech
- Without enforcement, Veo may ad-lib additional words after the scripted line

#### Audio Direction in Video Prompts (v2.38)

Control Veo 3's generated audio by appending sound design instructions to each prompt:

**Pattern:**
```
[Visual prompt]. Sound: [specific SFX]. No music, no vocals, no narration, no background music.
```

**Rules:**
1. Be **specific** -- "baby giggles, toy rattles" works; "ambient sounds" produces silence
2. Request **different SFX per scene** matching the visual content
3. **Always suppress** unwanted audio -- without "No music, no vocals", Veo may add random music/vocals
4. Combine with TTS + background music in post-production (three-layer mix)

**Three-layer audio mix (post-production):**

| Layer | Volume | Source |
|-------|--------|--------|
| Video SFX (directed) | 30% | Veo prompt audio direction |
| TTS narration | 120% + 500ms delay | ElevenLabs |
| Background music | 10-12% with 3s fade-out | Kie.ai |

**Example prompt with audio direction:**
```
Baby sleeping peacefully in soft-lit nursery, warm golden light.
Sound: soft breathing, gentle heartbeat monitor beeping.
No music, no vocals, no narration, no background music.
```

**Audio direction works with all video modes** (T2V, I2V, F2V, R2V) and carries through extend chain segments.

#### Options

**Dry-Run Mode** (validate before running):
```bash
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --mode frames-to-video \
  --images-dir "projects/{product}/images" \
  --scenes '{"1":"test"}' \
  --dry-run
```

**Quality Options**:
- `--quality fast` (default) - 10 credits, ~100s per scene
- `--quality quality` - 100 credits, ~210s per scene

**Aspect Ratio**:
- `--ratio landscape` (default) - 16:9
- `--ratio portrait` - 9:16

**Quality Shortcuts (v2.31):**

| Flag | Equivalent To | Use Case |
|------|--------------|----------|
| `--draft` | `--quality fast --variations 1` | Quick iteration, testing |
| `--final` | `--quality quality --variations 2` | Production output |

**Image Run Decoupling (v2.31):**
- `--image-run run001` — Use images from a specific run prefix, even when generating videos for a different run
- Useful when storyboard grid was split in run001 but videos target run002

> **Available features:** `--draft` (fast quality, 1 variation) for quick iteration, `--final` (quality, 2 variations) for production, `--preflight` validates images before generating, `--fallback-quality` auto-downgrades on failure, `--auto-simplify` progressively simplifies prompts on retry, `--image-run run001` uses images from a different run prefix, `--chained` for sequential scene chaining, `--journey-template` for pre-built camera motion templates.

#### F2V Chained Generation (Smooth Transitions)

**Problem**: Standard F2V generates each scene independently. Veo doesn't perfectly land on the target end frame, so scene N's end ≠ scene N+1's start, causing visible jumps between scenes.

**Solution**: `--chained` mode generates scenes sequentially — extracting the last frame of each scene's output video as the start frame for the next scene. Each scene literally begins where the previous one ended.

```bash
# Full chained generation (property tour)
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --chained \
  --images-dir "projects/{product}/images" \
  --scenes '{"1":"Aerial descend","2":"Forward approach","3":"Push through door"}' \
  --ratio landscape --quality fast

# Resume from scene 5 (scenes 1-4 already done)
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --chained --chain-from 5 \
  --images-dir "projects/{product}/images" \
  --scenes '{"5":"Pan right","6":"Pullback reveal"}' \
  --ratio landscape --quality fast

# Chained + journey template (pre-built camera motions)
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --chained \
  --journey-template property_tour \
  --images-dir "projects/{product}/images" \
  --ratio landscape --quality fast
```

**Chained mode constraints:**
- Forces `--mode frames-to-video` and `--variations 1`
- Disables `--parallel` (must be sequential)
- Breaks chain on permanent failure (can't continue past failed scene)
- Chain frames saved to `{project}/images/chained_frames/chain_frame_NN.jpg`

**CLI arguments:**
| Flag | Default | Description |
|------|---------|-------------|
| `--chained` | false | Enable sequential chained F2V generation |
| `--chain-from N` | 1 | Resume chain from scene N (skip earlier scenes) |
| `--chain-retries N` | 2 | Max retries per scene in chain mode |
| `--chain-retry-delay N` | 10 | Seconds between retries |

#### F2V Journey Templates

Pre-built camera motion prompt templates for common video journeys:

```bash
# List available templates
python scripts/parallel_video_gen.py --list-journey-templates

# Use template with chained mode
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --chained \
  --journey-template property_tour \
  --images-dir "projects/{product}/images" \
  --ratio landscape --quality fast

# Override specific scenes in a template
python scripts/parallel_video_gen.py \
  --product "{product}" \
  --chained \
  --journey-template property_tour \
  --scenes '{"3":"Camera pushes through ornate wooden doors into marble foyer"}' \
  --images-dir "projects/{product}/images" \
  --ratio landscape --quality fast
```

**Available templates:**

| Template | Scenes | Best For |
|----------|--------|----------|
| `property_tour` | 8 | Real estate, architecture, home tours |
| `building_ascent` | 6 | Multi-story buildings, hotels, penthouses |
| `nature_walk` | 6 | Gardens, parks, trails, outdoor spaces |
| `product_reveal` | 5 | Product launches, commercials, brand videos |
| `architectural_walkthrough` | 7 | Interior design, hospitality, showrooms |

See `references/f2v-journey-templates.md` for full template details and camera motion language guide.

#### Style Transfer via Reference Groups

Automate Go Bananas `reference_images` + `reference_mode: "style"` for matching architectural renders:

```bash
# Host reference images and get MCP commands
python scripts/style_transfer.py \
  --project "{product}" \
  --reference-images "renders/exterior.jpg,renders/interior.jpg" \
  --reference-mode style \
  --scenes-json "projects/{product}/analysis/sealcam_analysis.json"

# Use existing reference group
python scripts/style_transfer.py \
  --project "{product}" \
  --reference-group-id 42 \
  --scene-prompts '{"1":"Villa exterior","2":"Living room"}' \
  --aspect-ratio 16:9
```

#### Extend Chain -- Continuous Video Extension (v2.38)

Create long continuous videos by chaining extensions via useapi.net:

```bash
# T2V + 3 extensions (~29s total)
python scripts/extend_chain.py \
  --product "{product}" \
  --prompt "Sunset over ocean" \
  --extend-prompts '["Camera pans right","Zoom into waves","Pull back wide"]' \
  --quality fast --ratio landscape --yes

# I2V start + auto-repeat
python scripts/extend_chain.py \
  --product "{product}" \
  --prompt "Slow push in" \
  --start-image "projects/{product}/images/hero.jpg" \
  --extend-count 3 --quality fast --yes

# R2V start (reference images for style)
python scripts/extend_chain.py \
  --product "{product}" \
  --prompt "Product rotating on turntable" \
  --reference-images "ref1.jpg,ref2.jpg" \
  --extend-count 2 --quality fast --yes

# Resume broken chain
python scripts/extend_chain.py --product "{product}" --resume

# Dry-run with cost estimate
python scripts/extend_chain.py --product "{product}" --prompt "Test" --extend-count 2 --dry-run
```

**Key features:**
- Server-side concat with frame-accurate overlap removal (no stutter)
- Resume via `--resume` on CAPTCHA failure or network error
- Supports T2V, I2V (`--start-image`), R2V (`--reference-images`)
- Audio direction in prompts carries through all segments
- Cost: ~10 credits per segment (fast), ~100 (quality)
- Duration: `8 + (N x 7)` seconds (N = number of extensions, ~1s overlap removed per join)

**CLI arguments:**

| Flag | Description |
|------|-------------|
| `--prompt` | Prompt for initial video segment |
| `--extend-prompts '["p1","p2"]'` | Per-extension prompts (JSON array) |
| `--extend-count N` | Number of extensions (alternative to `--extend-prompts`) |
| `--start-image PATH` | Start image for I2V initial segment |
| `--reference-images "a.jpg,b.jpg"` | Reference images for R2V initial segment |
| `--quality fast\|quality` | Generation quality (default: fast) |
| `--ratio landscape\|portrait` | Aspect ratio (default: landscape) |
| `--resume` | Resume from `extend_chain_metadata.json` |
| `--dry-run` | Preview plan with cost estimate |
| `--yes` | Skip confirmation prompts |

**Audio direction example:**
```bash
python scripts/extend_chain.py \
  --product "{product}" \
  --prompt "Baby sleeping in crib. Sound: soft breathing. No music, no vocals." \
  --extend-prompts '["Baby wakes. Sound: cooing, yawn. No music.","Parent lifts baby. Sound: giggles. No music."]' \
  --quality fast --ratio landscape --yes
```

#### Generate Video Prompts Automatically

```bash
python scripts/generate_video_prompts.py \
  --prompts "projects/{product}/analysis/rewritten_prompts.json" \
  --mode i2v \
  --output "projects/{product}/analysis/video_prompts.json"
```

### Phase 5: Music Generation

```bash
python scripts/generate_music.py \
  --prompt "{music_prompt from analysis}" \
  --duration 30 \
  --output "projects/{product}/audio/background.mp3"
```

### Phase 5b: Narration / TTS Generation (Optional)

Generate narration audio from transcripts using ElevenLabs TTS. Requires Phase 1.5T transcript and `ELEVENLABS_API_KEY`.

**Step 1: Dry-run — preview transcript text and generate editable file**
```bash
python scripts/generate_tts.py \
  --transcript "projects/{product}/analysis/transcript.json" \
  --output-dir "projects/{product}/audio/tts" \
  --dry-run
# Generates editable_transcript.json for review
```

**Step 2: MANDATORY — Review and correct transcript text**

Whisper transcription often contains errors. Claude MUST review the editable transcript and fix:
- **Misheard words**: e.g. "ball view" → "world view", "plant a scene" → "plant a seed"
- **Proper nouns**: e.g. "Sanatantharma" → "Sanatan Dharma"
- **Garbled phrases**: e.g. "Creature own synthesis" → "Create your own synthesis"
- **Wrong homophones**: e.g. "to infinite" → "too infinite"
- **Meaning-changing errors**: e.g. "is in the religion" → "isn't a religion"
- **Missing punctuation**: Add em-dashes, periods, commas for natural TTS pacing

Edit `projects/{product}/audio/tts/editable_transcript.json` — fix scene text, then pass with `--edit` in Step 3.

> **This step is NOT optional.** Whisper (especially tiny/base models) introduces transcription errors
> that TTS will faithfully reproduce. Always proofread before generating narration audio.

**Step 3: Generate TTS audio (with corrected text)**
```bash
python scripts/generate_tts.py \
  --transcript "projects/{product}/analysis/transcript.json" \
  --output-dir "projects/{product}/audio/tts" \
  --edit "projects/{product}/audio/tts/editable_transcript.json" \
  --voice-id "21m00Tcm4TlvDq8ikWAM" \
  --yes
# Outputs: per-scene audio + combined narration.mp3
```

**Known ElevenLabs voice IDs (premade, no voices_read permission needed):**

| Voice | ID | Style |
|-------|----|-------|
| Rachel | `21m00Tcm4TlvDq8ikWAM` | Calm female narrator |
| Adam | `pNInz6obpgDQGcFmaJgB` | Deep male narrator |
| Antoni | `ErXwobaYiN019PkySvjV` | Warm male |
| Domi | `AZnzlk1XvdvUeBnXmlld` | Strong female |
| Elli | `MF3mGyEYCl7XYWbV9V6O` | Young female |
| Josh | `TxGEqnHWrfWFTfGW9XjX` | Deep young male |

**Multi-Voice TTS (v2.31):**
- Scenes can contain speaker-tagged segments: `[{"speaker":"narrator","text":"..."},{"speaker":"Ram","text":"..."}]`
- Use `--voice-map '{"narrator":"Daniel","Ram":"Leo"}'` to assign ElevenLabs voices per speaker
- Auto-concatenates per-segment TTS into scene audio
- Plain string scenes continue to work (backward compatible)

**Extended Video (v2.31):**
- `--extend-video` on `--bake-narration` freezes the last video frame when TTS is longer than the video
- Without this flag, narration is truncated to video length

**Custom TTS Pattern (v2.31):**
- `--tts-pattern "scene_{N}_combined.mp3"` — specify custom filename pattern for TTS files
- Auto-detection tries: `scene_{N}_tts.mp3`, `scene_{N}_combined.mp3`, `scene_{N}.mp3`

**Step 4: Stitch with narration (Phase 6)**
```bash
python scripts/stitch_video.py \
  --videos-dir "projects/{product}/videos" \
  --audio "projects/{product}/audio/background.mp3" \
  --narration "projects/{product}/audio/narration.mp3" \
  --output "projects/{product}/final/replicated_ad.mp4" \
  --presenter
```

> **Available features:** `--voice-map '{"narrator":"Daniel","Ram":"Leo"}'` for multi-speaker scenes, `--extend-video` freezes last frame when TTS exceeds video duration, `--sync-to-slides` pads TTS to match slide timing, `voice_designer.py --list-presets` to design a custom voice before TTS.

### Phase 6: Assembly (Dual Output)

**Pre-flight Check**: Ensure ALL scenes exist before stitching:
```bash
ls projects/{product}/videos/run*_scene_*.mp4 | wc -l
```

Create **TWO final videos** (auto-picks latest run):

```bash
python scripts/stitch_video.py \
  --videos-dir "projects/{product}/videos" \
  --audio "projects/{product}/audio/background.mp3" \
  --output "projects/{product}/final/replicated_ad.mp4" \
  --variations 2
# Auto-detects latest run (e.g., run002), outputs run002_replicated_ad_v1.mp4, run002_replicated_ad_v2.mp4
```

**Stitch specific run** (if needed):
```bash
python scripts/stitch_video.py \
  --videos-dir "projects/{product}/videos" \
  --audio "projects/{product}/audio/background.mp3" \
  --output "projects/{product}/final/replicated_ad.mp4" \
  --run run001 \
  --variations 2
# Uses only run001_scene_*.mp4 files
```

**Auto-Narration Offset (v2.27)**: When using `--logo-intro` with `--narration`, the narration is automatically offset by the logo duration. No manual FFmpeg preprocessing needed. The stitch script detects the logo duration and prepends matching silence to the narration track.

**Logo Animation Notes (v2.27)**:
- `--background light` now uses pure white (#FFFFFF) instead of cream
- Logo animations no longer fade to black at the end (only fade-in, no fade-out)
- Default `--hold-end` is 0 (natural animation ending)

**Music Mood Hint (v2.31):**
- `--music-mood "epic orchestral"` prints a `generate_music.py` command with auto-calculated duration
- Does NOT generate music — outputs the command for you to run separately

> **Available features:** `--dry-run` previews stitch plan without generating, `--mix "run001:2 run002:*"` cherry-picks scenes across runs, `--music-mood "epic orchestral"` prints a music generation command, `--logo-intro` / `--logo-outro` adds animated logo clips, `--overlay logo.png` adds watermark overlay.

### Title Card Generation (v2.38)

Generate a professional YouTube-thumbnail-style title card and prepend it to any video. Works standalone or integrated into the Nex Presenter / stitch pipeline.

```
┌─────────────────────────────────────────────────────┐
│  TITLE CARD PIPELINE                                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Phase 1: Generate Go Bananas image                 │
│    - Character + cinematic scene, NO TEXT in image   │
│    - Veo mangles text — overlay with PIL instead    │
│    - Auto-extracts title/subtitle from PDF          │
│                                                     │
│  Phase 2: Process image + create hold video         │
│    - Center-crop to true 16:9 (1280×720)            │
│    - PIL text overlay: title + subtitle on          │
│      semi-transparent dark band at bottom           │
│    - FFmpeg hold video (default 4s) with silent     │
│      audio track for seamless concat                │
│                                                     │
│  Integration options:                               │
│    A. nex_assemble.py --title-card (prepend)        │
│    B. stitch_video.py --logo-intro (prepend)        │
│    C. FFmpeg concat (standalone)                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Two-Phase Workflow

**Phase 1: Generate image (outputs Go Bananas MCP command)**

```bash
# Auto-extract title from PDF + generate Go Bananas command
python scripts/generate_title_card.py \
  --project "{slug}" \
  --pdf "projects/{slug}/reference/slides.pdf" \
  --character-id 98 \
  --yes

# Manual title/subtitle
python scripts/generate_title_card.py \
  --project "{slug}" \
  --title "My Video Title" \
  --subtitle "A compelling subtitle" \
  --character-id 98 \
  --yes
```

Phase 1 outputs a Go Bananas `generate_image` MCP command. Execute it, then download the image.

**Phase 2: Process image + create hold video**

```bash
# Process downloaded image (crop, text overlay, hold video)
python scripts/generate_title_card.py \
  --project "{slug}" \
  --process \
  --raw-image "projects/{slug}/assets/title_card_raw.jpg" \
  --title "My Video Title" \
  --subtitle "A compelling subtitle" \
  --duration 4 \
  --yes
```

Phase 2 outputs:
- `projects/{slug}/assets/title_card_final.jpg` — processed image with text overlay
- `projects/{slug}/assets/title_card_4s.mp4` — hold video (4s, 24fps, silent audio)

#### Integration with Nex Assemble

```bash
# Prepend title card to Nex Presenter video
python scripts/nex_assemble.py \
  --project "projects/{slug}" \
  --num-slides 17 \
  --intro-scenes 18,19 --outro-scenes 20,21 \
  --music "projects/{slug}/audio/background.mp3" \
  --title-card "projects/{slug}/assets/title_card_4s.mp4" \
  --yes
```

The title card is normalized (fps, resolution, audio channels) and inserted before the intro segments.

#### Integration with Stitch

```bash
# Use as logo-intro in stitch_video.py
python scripts/stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/video.mp4" \
  --logo-intro "projects/{slug}/assets/title_card_4s.mp4"
```

#### Standalone Usage (Outside Video Replicator)

```bash
# Generate title card for any project — just provide title and image
python scripts/generate_title_card.py \
  --project "my-standalone-project" \
  --title "Epic Documentary" \
  --subtitle "Episode 1: The Beginning" \
  --style dark \
  --duration 5 \
  --yes

# Then concat with any video using FFmpeg
ffmpeg -f concat -safe 0 -i <(echo "file 'title_card_5s.mp4'"; echo "file 'main_video.mp4'") \
  -c copy output.mp4
```

#### CLI Reference

| Flag | Default | Description |
|------|---------|-------------|
| `--project` | (required) | Project slug or path |
| `--title` | (from PDF) | Title text for overlay |
| `--subtitle` | (from PDF) | Subtitle text for overlay |
| `--pdf` | none | PDF to auto-extract title/subtitle from (uses Gemini Vision) |
| `--character-id` | none | Go Bananas character ID for the image |
| `--process` | false | Phase 2 mode: process raw image instead of generating MCP command |
| `--raw-image` | none | Path to raw Go Bananas image (Phase 2) |
| `--image-url` | none | URL to download raw image from (Phase 2) |
| `--no-text` | false | Skip text overlay (image only) |
| `--style` | dark | Text overlay style: `dark` (semi-transparent band) |
| `--duration` | 4 | Hold video duration in seconds |
| `--dry-run` | false | Preview without generating |
| `--yes` / `-y` | false | Skip confirmation prompts |

#### Design Rules

1. **No text in the Go Bananas image** — Veo mangles text during animation. Always overlay with PIL.
2. **Character on the RIGHT side** — prompt places character on right, leaving left clear for text.
3. **Semi-transparent dark band** — RGBA(0,0,0,160) band from y=560 to bottom for text readability.
4. **Font fallback chain** — Arial Bold → Helvetica → DejaVu Sans Bold → macOS system fonts → PIL default.
5. **Silent audio track** — hold video includes `anullsrc` for seamless concat with audio-containing segments.
6. **Center-crop before resize** — Go Bananas "16:9" outputs ultrawide (1584×672); crop to true 16:9 then resize to 1280×720.

#### Config Constants (config.py)

| Constant | Value | Description |
|----------|-------|-------------|
| `TITLE_CARD_DURATION` | 4 | Default hold duration (seconds) |
| `TITLE_CARD_WIDTH` | 1280 | Output width (pixels) |
| `TITLE_CARD_HEIGHT` | 720 | Output height (pixels) |
| `TITLE_CARD_FPS` | 24 | Frame rate |
| `TITLE_CARD_BAND_TOP` | 560 | Dark band starts at y=560 |
| `TITLE_CARD_BAND_OPACITY` | 160 | Band alpha (0-255) |
| `TITLE_CARD_TITLE_FONT_SIZE` | 58 | Title font size |
| `TITLE_CARD_TITLE_COLOR` | white | Title text color |
| `TITLE_CARD_SUBTITLE_FONT_SIZE` | 28 | Subtitle font size |
| `TITLE_CARD_SUBTITLE_COLOR` | #C8DCFF | Subtitle text color (light blue) |

### Phase 7: CTA Banner Overlay (Optional)

Add an animated call-to-action banner with logo, phone number, and QR code to your video. The banner is rendered using Remotion and overlaid at the bottom of the video.

```bash
# Generate CTA banner (interactive mode)
python scripts/generate_cta_banner.py --project "{product}"

# Generate CTA banner (non-interactive)
python scripts/generate_cta_banner.py --project "{product}" \
  --logo "logo.png" \
  --phone "555-123-4567" \
  --cta-text "Call {phone} today!" \
  --qr-url "https://example.com" \
  --timing "last-10s" \
  --animation "slide-fade" \
  --theme "light" \
  --ratio landscape \
  --yes

# Stitch video with CTA banner overlay
python scripts/stitch_video.py \
  --videos-dir "projects/{product}/videos" \
  --audio "projects/{product}/audio/background.mp3" \
  --output "projects/{product}/final/replicated_ad.mp4" \
  --cta-banner "projects/{product}/banner/cta_banner_landscape.webm" \
  --cta-banner-timing "last-10s"
```

**CTA Banner Options:**

| Option | Values | Description |
|--------|--------|-------------|
| `--timing` | entire, last-5s, last-10s, custom-N | When to show banner |
| `--animation` | slide, fade, slide-fade, static | Animation style |
| `--theme` | light, dark, transparent, custom | Color theme |
| `--ratio` | landscape, portrait, both | Aspect ratio |

**Banner Timing:**
- `entire` - Show banner throughout video
- `last-5s` - Show in final 5 seconds
- `last-10s` - Show in final 10 seconds (default)
- `custom-30` - Show from 30 seconds until end

**Stitch CTA Banner Flags:**
- `--cta-banner PATH` - Path to rendered banner (WebM with transparency)
- `--cta-banner-timing` - When to show (same format as generation)


