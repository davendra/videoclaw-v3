---
name: character-creator
description: |
  Create Go Bananas characters with profile images and multi-view reference sheets for consistent
  character generation across scenes. This skill should be used when the user asks to "create a character",
  "create characters", "make a new character", "design a character", "build a character reference",
  "character for my video", "set up characters", "new character with reference sheet",
  "character reference", or mentions needing consistent characters across scenes.
---

# Character Creator

Create Go Bananas characters with the **Input Triad** (3 reference images) and multi-view character
reference sheets for maximum consistency across scenes.

## When to Use

- Creating new Go Bananas characters for video projects
- Setting up character consistency before scene generation
- Building character references with multiple views (profile + close-up + cinematic + reference sheet)
- Any request involving "create character", "new character", "character reference"

## The Input Triad

For maximum character consistency across scenes, always generate 3 reference images per character:

| Image | Purpose | Aspect |
|-------|---------|--------|
| **Full Body Portrait** | Locks style, costume, outfit, and body proportions | Square |
| **Extreme Close-Up** | Locks facial features, accessories (glasses, jewelry, scars) | Square |
| **Supporting Cinematic** | Locks lighting vibe, 16:9 composition, environment style | 16:9 |

**Why this matters**: The "Sunglasses Error" — if a character wears sunglasses but you only have a wide-shot reference, the AI sees them as too small to replicate. The extreme close-up forces the model to memorize facial accessories. Similarly, the cinematic shot trains the model on the correct aspect ratio and lighting style for scene generation.

## Workflow Overview

The character creation workflow has 5 steps per character:

1. **Generate profile portrait** — Square full body reference, studio background, detailed Pixar/style rendering (Input Triad Image 1)
2. **Create Go Bananas character** — Register with portrait as initial reference
3. **Generate extreme close-up** — Square face-only shot with all facial details and accessories (Input Triad Image 2)
4. **Generate supporting cinematic shot** — 16:9 environmental shot locking lighting and vibe (Input Triad Image 3)
5. **Update character** — Add close-up, cinematic, and reference sheet images to the character

## Step-by-Step Process

### Step 1: Gather Character Details

Collect from the user (or infer from context):

| Field | Required | Example |
|-------|----------|---------|
| Name | Yes | "Lord Ram", "Ravn" |
| Style | Yes | "3D Disney Pixar animated", "anime", "realistic" |
| Physical appearance | Yes | Age, skin tone, build, hair, distinguishing features |
| Outfit/clothing | Yes | Crown, armor, casual wear, etc. |
| Expression/mood | No | Serene, fierce, playful |
| Props/accessories | No | Bow and arrows, sword, staff |

If the user provides minimal details, ask for clarification on style and key visual features.

### Step 2: Generate Profile Portrait (Input Triad Image 1: Full Body Reference)

Generate a square profile portrait for each character using `generate_image`. This is the **Full Body Reference** — it locks the character's style, costume, outfit, and body proportions.

```
mcp__go-bananas__generate_image(
    prompt="[STYLE] character portrait of [NAME]. [DETAILED APPEARANCE DESCRIPTION].
            Clean studio background, character portrait framing.",
    aspect_ratio="square",
    model_id="gemini-pro-image",
    negative_prompt="[style-appropriate negatives]"
)
```

**Key rules:**
- Always use `model_id="gemini-pro-image"` (Pro model)
- Always use `aspect_ratio="square"` for portraits
- Include rendering style cues: "subsurface scattering", "warm lighting", "detailed rendering"
- End with "Clean studio background, character portrait framing"

### Step 3: Create the Character

Register the character in Go Bananas with the portrait as the initial reference:

```
mcp__go-bananas__create_character(
    character_name="[Name] [Style Tag]",
    base_prompt="[FULL STYLE AND APPEARANCE DESCRIPTION]",
    description="[SHORT DESCRIPTION]",
    reference_image_ids=[portrait_id],
    negative_prompt="[style-appropriate negatives]",
    system_instruction="Maintain consistent [STYLE] with [KEY FEATURES] across all scenes.",
    tags=["relevant", "tags"]
)
```

**Key rules:**
- Include style tag in name (e.g., "Lord Ram 3D Pixar") for disambiguation
- `base_prompt` should be the full reusable appearance description
- `system_instruction` should emphasize consistency of key visual features

### Step 4a: Generate Extreme Close-Up (Input Triad Image 2: Facial Identity)

Generate a square extreme close-up of the character's face only. This is the **Extreme Close-Up** — it locks facial features and accessories (glasses, jewelry, scars, tattoos).

```
mcp__go-bananas__generate_image(
    prompt="[STYLE] extreme close-up portrait of [NAME]. [FACE DESCRIPTION - eyes, skin tone,
            hair at face level, any accessories like glasses/jewelry/piercings/scars].
            Fill the entire frame with the face. Ultra-detailed facial rendering,
            subsurface scattering, [LIGHTING]. Clean studio background.",
    aspect_ratio="square",
    model_id="gemini-pro-image",
    character_id=[ID from create_character],
    negative_prompt="full body, hands, torso, background elements, [style-appropriate negatives]"
)
```

**Key rules:**
- Always use `character_id` from Step 3 to maintain consistency with the portrait
- The prompt must focus entirely on facial features: eyes, eyebrows, nose, mouth, skin texture, facial hair, accessories
- Add "Fill the entire frame with the face" to ensure tight framing
- Add specific accessory details: glasses style, earrings, facial piercings, scars, birthmarks
- Negative prompt must exclude full body / torso to force face-only composition

### Step 4b: Generate Supporting Cinematic Shot (Input Triad Image 3: Lighting/Vibe)

Generate a 16:9 cinematic shot of the character in an environment. This is the **Supporting Cinematic Shot** — it locks the lighting vibe, aspect ratio composition, and environmental style.

```
mcp__go-bananas__generate_image(
    prompt="WIDE HORIZONTAL [STYLE] cinematic shot of [NAME] in a [ENVIRONMENT].
            [COSTUME/OUTFIT DESCRIPTION]. [MOOD/VIBE DESCRIPTION].
            Cinematic lighting, film grain, shallow depth of field.",
    aspect_ratio="16:9",
    model_id="gemini-pro-image",
    character_id=[ID from create_character],
    negative_prompt="[style-appropriate negatives]"
)
```

**Key rules:**
- Always use `aspect_ratio="16:9"` and add "WIDE HORIZONTAL" in prompt for reliable landscape
- Always use `character_id` from Step 3 to maintain consistency
- Choose an environment that matches the project's scenes (urban, nature, studio, etc.)
- Include mood/atmosphere cues: "golden hour warmth", "moody blue tones", "bright cheerful daylight"
- This shot trains the model on how the character looks in actual scene conditions (not just studio)

### Step 4c: Generate Character Reference Sheet (Optional but Recommended)

Generate a multi-view reference sheet using style preset ID 49:

```
mcp__go-bananas__generate_image(
    prompt="[NAME], [STYLE]. [APPEARANCE DESCRIPTION].",
    style_preset_id=49,
    character_id=[ID from create_character],
    model_id="gemini-pro-image",
    negative_prompt="[style-appropriate negatives]"
)
```

**Key rules:**
- Always include `style_preset_id=49` (the "character reference sheet" preset)
- Include `character_id` from Step 3 to maintain consistency
- The style preset auto-prepends layout instructions (7 views, hero portrait + 6 angles)

### Step 5: Update Character with All Reference Images

After generating all images (Steps 2, 4a, 4b, and optionally 4c), update the character to include them all:

```
mcp__go-bananas__update_character(
    character_id=[CHARACTER_ID],
    reference_image_ids=[portrait_id, closeup_id, cinematic_id, reference_sheet_id]
)
```

**Key rules:**
- Include all generated image IDs — the more references, the better consistency
- Order: portrait first, then close-up, then cinematic, then reference sheet
- If the reference sheet was skipped, omit its ID: `[portrait_id, closeup_id, cinematic_id]`
- Existing characters with only 2 images still work — the update adds new references alongside old ones

## Execution Order

When creating multiple characters, process them in parallel where possible:

1. Generate ALL profile portraits in parallel (one `generate_image` call per character)
2. Create ALL characters in parallel (one `create_character` call per character, with portrait as initial reference)
3. Generate ALL extreme close-ups AND supporting cinematic shots in parallel (both use `character_id` from step 2)
4. Optionally generate ALL reference sheets in parallel (using `character_id` + `style_preset_id=49`)
5. Update ALL characters in parallel (one `update_character` call per character, adding all reference image IDs)

This minimizes round trips — 4-5 parallel batches instead of N sequential workflows. Steps 3 and 4 can run concurrently since they are independent.

## Negative Prompt Guide

Match negative prompts to the character's style:

| Style | Negative Prompt |
|-------|----------------|
| 3D Pixar | "realistic, photorealistic, 2D, flat, anime, text, watermark" |
| Anime | "realistic, photorealistic, 3D render, CGI, text, watermark" |
| Realistic | "cartoon, anime, 3D render, illustration, text, watermark" |
| Illustration | "photorealistic, 3D render, anime, text, watermark" |

Add character-specific negatives as needed (e.g., "dark mood, scary" for a hero, "cute, friendly" for a villain).

## Output Summary

After completing all characters, present a summary table:

```markdown
| Character | ID | Profile | Close-Up | Cinematic | Ref Sheet |
|-----------|-----|---------|----------|-----------|-----------|
| Name 1    | ID  | #img_id | #img_id  | #img_id   | #img_id   |
| Name 2    | ID  | #img_id | #img_id  | #img_id   | #img_id   |
```

Include a usage example:
```python
generate_image(
    prompt="Scene description...",
    character_ids=[ID1, ID2],
    model_id="gemini-pro-image",
    aspect_ratio="16:9"
)
```

## Additional Resources

### Reference Files
- **`references/style-guides.md`** — Detailed prompt patterns for popular character styles (Pixar, anime, realistic, etc.)

## Important Notes

- **Pro model is mandatory**: `model_id="gemini-pro-image"` — the flash/standard model ignores character references
- **Always generate all 3 Input Triad images before creating scenes** — the extreme close-up is especially critical for characters with glasses, jewelry, or distinctive facial features
- **Style preset 49**: The "character reference sheet" preset creates a cinematic multi-view layout — always use it for the reference sheet step
- **Character duplication**: When using multiple `character_ids` in scenes, add "Only N people in frame" to prevent duplication
- **Existing characters**: Check `list_characters` before creating to avoid duplicates
- **Backward compatible**: Existing characters with only 2 images (portrait + reference sheet) still work — the Input Triad adds a third image for improved consistency
