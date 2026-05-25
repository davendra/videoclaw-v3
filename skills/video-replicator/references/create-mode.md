## CREATE MODE - Interactive Workflow

### Scene Building Options

When CREATE mode is selected, choose how to build scenes:

```
┌─────────────────────────────────────────────────────┐
│  SCENE BUILDING METHOD                              │
├─────────────────────────────────────────────────────┤
│  How would you like to design your scenes?          │
│                                                     │
│  [A] Scene-by-scene wizard                          │
│      Design each scene individually                 │
│      Full control over every detail                 │
│                                                     │
│  [B] Storyboard grid (NEW - v2.29)                  │
│      Generate 9 cinematic panels in one image       │
│      AI maintains character consistency             │
│      Choose from 8 narrative templates              │
│      Full dialogue/narration integration            │
└─────────────────────────────────────────────────────┘
```

| Option | Best For | Output |
|--------|----------|--------|
| **Scene-by-scene** | Custom scenes, precise control, non-narrative content | Individual first-frame images |
| **Storyboard grid** | Narrative arcs, character-driven stories, faster iteration | 3x3 grid → 9 panels |

**If Storyboard Grid selected** → Jump to [Storyboard Grid Workflow](#storyboard-grid-workflow) below.

**If Scene-by-scene selected** → Continue with Phase 0 below.

---

### Phase 0: Project Setup

Ask user:
1. **Project name**: Slug for folder (e.g., "summer-sandals")
2. **Video type**: Product Ad | Fashion/Lifestyle | Brand Story | Social Reel

### Phase 1: Asset Collection

**Product Questions:**
```
- "Do you have a product to feature?" [Yes | No]
- If yes: "Please provide product image (path or URL)"
- "Describe your product in detail" (for Go Bananas reference)
```

**Character Questions:**
```
- "How many characters/models?" [0 | 1 | 2 | 3+]
- For each character:
  - "Provide reference image (path or URL)"
  - "Describe this character" (appearance, style, vibe)
  - "Give them a name" (for Go Bananas reference)
```

**Go Bananas Integration:**
1. Host images (if needed) via freeimage.host or similar
2. Upload via `mcp__go-bananas__upload_image_for_editing`
3. Create `product_reference` for products
4. Create `character` for each person with reference images

### Phase 2: Video Format

Ask user:
```
- "Video aspect ratio?" [Portrait 9:16 (Reels/TikTok) | Landscape 16:9 (YouTube) | Square 1:1]
- "Target duration?" [15s | 30s | 60s]
- "How many scenes?" [3 | 4 | 5 | 6]
```

### Phase 3: Scene Design

Present scene templates based on video type (see `references/scene-templates.md`), then for each scene:

```
Scene {N}:
- "What happens?" [Product shot | Character action | Lifestyle moment | Detail/close-up]
- "Describe the setting/environment"
- "What's the action/movement?" (walking, posing, reveal, etc.)
- "Lighting mood?" [Golden hour | Studio | Natural | Dramatic | Soft]
- "Camera movement?" [Static | Push in | Pan | Track | Orbit]
```

Build SEALCAM+ JSON from answers (no reference video needed).

### Phase 4: Music & Mood

```
- "Music style?" [Upbeat/Energetic | Chill/Relaxed | Dramatic | Elegant | Trendy/Modern]
- "Any specific vibe?" (Indian fusion, electronic, acoustic, etc.)
```

### Phase 5: Generate (Same Pipeline as COPY)

1. Generate first-frame images with Go Bananas
2. Generate videos with veo-cli
3. Generate music (or use existing)
4. Stitch final video

> **Available features:** `--draft` for quick test iterations, `--final` for production quality, `--transitions` for AI camera transitions between scenes, `--allow-stale` to reuse previously approved images.

### CREATE Mode Commands

```bash
# Interactive wizard (builds SEALCAM+ JSON from questions)
python scripts/create_wizard.py \
  --project "{product}" \
  --output "projects/{product}/analysis/sealcam_analysis.json"

# Then continue with standard pipeline (Phase 3-6)
```

---


## Storyboard Grid Workflow

**Version 2.29** - Generate 9 cinematic panels in a single image with AI-maintained character consistency across all angles.

### Overview

The Storyboard Grid generates a 3×3 grid image where each cell represents one scene of a narrative arc. Go Bananas maintains character consistency across all 9 panels in a single generation, eliminating the need to generate scenes individually.

```
┌─────────────────────────────────────────────────────┐
│  STORYBOARD GRID PIPELINE                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. Choose Template    → 8 narrative templates      │
│  2. Define Characters  → Upload references          │
│  3. Set Premise        → Story context              │
│  4. Generate Grid      → Go Bananas (Pro model)     │
│  5. Review Grid        → User approval checkpoint   │
│  6. Split Panels       → 9 individual images        │
│  7. Generate Videos    → Standard Phase 4 pipeline  │
│  8. Add Dialogue/TTS   → Optional narration         │
│  9. Stitch Final       → 9-scene video              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Step 1: Template Selection

Present 8 narrative templates to user:

```
┌─────────────────────────────────────────────────────┐
│  NARRATIVE TEMPLATES                                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [1] Dialogue/Confrontation                         │
│      Arc: Tension → Breaking point → Resolution     │
│      Best for: Arguments, negotiations, ultimatums  │
│                                                     │
│  [2] Chase/Pursuit                                  │
│      Arc: Urgency → Escalation → Climax            │
│      Best for: Escapes, races, time pressure        │
│                                                     │
│  [3] Discovery/Reveal                               │
│      Arc: Mystery → Investigation → Revelation      │
│      Best for: Plot twists, secrets uncovered       │
│                                                     │
│  [4] Journey/Transformation                         │
│      Arc: Beginning → Struggle → Arrival            │
│      Best for: Travel, personal growth              │
│                                                     │
│  [5] Romance/Connection                             │
│      Arc: Distant → Drawing closer → Together       │
│      Best for: Meeting, bonding, intimacy           │
│                                                     │
│  [6] Comedy/Surprise                                │
│      Arc: Setup → Complication → Punchline          │
│      Best for: Mishaps, visual gags                 │
│                                                     │
│  [7] Horror/Suspense                                │
│      Arc: Calm → Unease → Terror                    │
│      Best for: Dread, threat, survival              │
│                                                     │
│  [8] Product Story                                  │
│      Arc: Problem → Discovery → Transformation      │
│      Best for: Product demos, testimonials          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Template suggestion**: Use `storyboard_templates.py --suggest "premise"` to get AI-recommended templates.

### Step 2: Character Setup

Same as standard CREATE mode - upload character references to Go Bananas:

```python
# Create character reference (required for consistency)
mcp__go-bananas__create_character(
    character_name="Alex",
    base_prompt="Young man with dark hair, casual style",
    reference_image_ids=["uploaded_image_id"]
)
```

**Minimum characters by template:**
- Dialogue/Confrontation: 2 characters
- Romance/Connection: 2 characters
- All others: 1+ characters

### Step 3: Configure Storyboard

Gather from user:
1. **Project name**: Slug for folder
2. **Premise**: 1-2 sentence story description
3. **Environment**: Setting description (e.g., "Harsh desert badlands at sunset")
4. **Aspect ratio**: 16:9 | 9:16 | 1:1
5. **Dialogue beats** (optional): Key lines per panel

### Step 4: Generate Grid Image

Generate the 3×3 grid using Go Bananas with the template's panel definitions:

```python
# Build grid prompt from template
from storyboard_templates import get_template, get_panel_prompt_hints

template = get_template("dialogue-confrontation")

# Generate 3x3 storyboard grid
mcp__go-bananas__generate_image(
    prompt=f"""Create a 3x3 cinematic storyboard grid.
    Story: {premise}
    Environment: {environment}

    Panel layout (left-to-right, top-to-bottom):
    1: {template.panels[0].shot_type} - {template.panels[0].purpose}
    2: {template.panels[1].shot_type} - {template.panels[1].purpose}
    ...
    9: {template.panels[8].shot_type} - {template.panels[8].purpose}

    Emotional arc: {template.emotional_arc}
    Maintain character consistency across all panels.
    Each panel should be clearly separated.
    Cinematic film stills, professional cinematography.""",
    character_ids=[27, 28],  # Both characters for consistency
    aspect_ratio="1:1",  # Grid is always square
    model_id="gemini-pro-image"  # REQUIRED for character consistency
)
```

### Step 5: Review Grid (Checkpoint)

**⚠️ MANDATORY CHECKPOINT** - User must approve grid before splitting.

Present the generated grid image and ask:
- Does the narrative arc flow correctly?
- Are characters consistent across panels?
- Does the environment match the premise?

Options: `[Approve]` `[Regenerate]` `[Adjust prompt and retry]`

### Step 6: Split Grid into Panels

Use `split_grid.py` to extract 9 individual panel images:

```bash
# Split grid and name for video pipeline
python scripts/split_grid.py \
  --grid "projects/{slug}/storyboard/grid.jpg" \
  --output-dir "projects/{slug}/images" \
  --aspect-ratio "16:9" \
  --run-id "run001"
```

**Output**: `run001_scene_1_frame.jpg` through `run001_scene_9_frame.jpg`

> **Available features:** `--create-characters` + `--save-character-ids` creates Go Bananas character refs for consistent faces across scenes (Phase 2.5), `--generate-scene-images` outputs richer MCP commands from storyboard metadata.

### Step 7: Generate Videos

Standard Phase 4 pipeline with I2V mode:

```bash
python scripts/parallel_video_gen.py \
  --product "{slug}" \
  --mode frames-to-video \
  --images-dir "projects/{slug}/images" \
  --scenes '{"1":"Camera: slow push in...","2":"Tracking shot..."}' \
  --ratio landscape \
  --quality fast \
  --variations 1
```

**Motion prompts**: Each template panel has `default_motion` hints. Use these as starting points for I2V prompts.

### Step 8: Add Dialogue/Narration (Optional)

If dialogue beats were provided, generate TTS:

```bash
# Generate narration from dialogue beats
python scripts/generate_tts.py \
  --edit "projects/{slug}/audio/tts/editable_transcript.json" \
  --output-dir "projects/{slug}/audio/tts" \
  --voice-name "Adam" --yes

# Bake narration onto videos
python scripts/generate_tts.py \
  --bake-narration \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --scenes "1,2,3,4,5,6,7,8,9" \
  --preserve-sfx --yes
```

### Step 9: Stitch Final Video

```bash
python scripts/stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background.mp3" \
  --output "projects/{slug}/final/storyboard_video.mp4" \
  --narrated  # If using dialogue/narration
```

> **Available features:** `--voice-map` for multi-character dialogue voices, `--mix "run001:3 run002:*"` to cherry-pick best scenes across runs, `--logo-intro` to prepend an animated logo clip.

### Storyboard Grid Commands

```bash
# List available templates
python scripts/storyboard_templates.py --list

# Show template details
python scripts/storyboard_templates.py --show dialogue-confrontation

# Suggest templates for a premise
python scripts/storyboard_templates.py --suggest "Two survivors argue about leaving"

# Interactive storyboard wizard
python scripts/generate_storyboard.py --project "{slug}"

# Non-interactive with all options
python scripts/generate_storyboard.py \
  --project "{slug}" \
  --template dialogue-confrontation \
  --premise "Two survivors face a critical decision" \
  --character-ids 27,28 \
  --environment "Harsh desert badlands at sunset" \
  --aspect-ratio 16:9 \
  --yes

# Dry-run to preview configuration
python scripts/generate_storyboard.py \
  --project "{slug}" \
  --template discovery-reveal \
  --premise "Detective finds the missing evidence" \
  --dry-run
```

**Enhanced Scene Generation (v2.31):**
- `--generate-scene-images` on `generate_storyboard.py` outputs richer Go Bananas MCP commands from `storyboard_metadata.json`
- Includes character_ids, style, environment context, and panel-specific composition notes

### Template Reference

See `references/storyboard-templates.md` for complete documentation of all 8 templates including:
- Full 9-panel structure tables
- Shot types and camera movements per panel
- Dialogue hints for each panel
- Python API examples

---

