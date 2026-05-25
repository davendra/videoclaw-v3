# Go Bananas Prompt Builder Guide

This guide explains how to leverage Go Bananas capabilities effectively when generating first-frame images for video replication.

## Core Principle

**When using character/product references, DON'T repeat appearance details in prompts.**

The character/product reference already contains appearance information. Instead, prompts should focus on:
- **scene_prompt**: Pose/action + environment
- **additional_details**: Lighting, mood, style tokens

### Before (Wrong)
```
Young adult male, fair skin, short dark hair, wearing sunglasses, an olive green hooded winter jacket,
matching leggings. Walking from left to right in profile view in snowy mountain backdrop.
```

### After (Correct)
```python
mcp__go-bananas__generate_image(
    prompt="Walking profile view, striding left to right through fresh snow. Snowy mountain backdrop with pine forest. Bright winter daylight, visible breath. Fashion editorial, cinematic, 8K.",
    character_id=27,
    aspect_ratio="9:16",
    model_id="gemini-pro-image"  # ALWAYS use Pro model
)
```

## Generation Methods

| Method | Use Case | Key Params |
|--------|----------|------------|
| `generate_image` | **ALWAYS USE THIS** - supports model selection | prompt, character_id/product_id, aspect_ratio, **model_id** |
| ~~`generate_with_character`~~ | REMOVED - use `generate_image` with `character_id` param | - |
| ~~`generate_with_multiple_characters`~~ | REMOVED - use `generate_image` with `character_ids` param | - |
| ~~`generate_with_product`~~ | REMOVED - use `generate_image` with `product_id` param | - |

**NOTE:** The old `generate_with_*` methods have been replaced. Always use `generate_image` with `character_id`/`product_id`/`character_ids` param and `model_id="gemini-pro-image"`.

## Model Selection

**ALWAYS use Pro model (`gemini-pro-image`) for production images.**

| Model ID | Type | Quality | Speed | Use Case |
|----------|------|---------|-------|----------|
| `gemini-pro-image` | **Pro** | High | Slower | Production, final images |
| `gemini-flash-image` | Standard | Medium | Faster | Testing, iteration |

**Important:** Use `generate_image` with `model_id` parameter to select the Pro model:
```python
mcp__go-bananas__generate_image(
    prompt="Scene description...",
    character_id=27,  # or product_id=42
    aspect_ratio="9:16",
    model_id="gemini-pro-image"  # ALWAYS use Pro
)
```

## Style Preset Mapping

Map your SEALCAM+ metatokens to Go Bananas style presets:

| SEALCAM+ Style Keywords | Go Bananas Preset |
|------------------------|-------------------|
| cinematic, luxury, editorial, fashion, high-end | Photo-Realistic Cinematic |
| lifestyle, natural, authentic, candid, casual | Lifestyle Photography |
| documentary, real, journalistic, raw | Documentary Photography |
| vibrant, bold, colorful, saturated, pop | Vibrant & Bold |
| product, commercial, ecommerce, catalog, hero shot | Product Showcase |
| organic, earthy, sustainable, eco | Natural & Organic |
| cyberpunk, neon, futuristic, sci-fi | Neon Noir Cyberpunk |
| watercolor, painted, illustration | Watercolor Art |
| pixar, animated, cartoon | Disney-Pixar Style |
| 3d | 3D Sticker Bomb |
| claymation, clay | Claymation Studio |
| papercut | Papercut Diorama |

### Available Style Presets (with IDs)

| ID | Style Preset Name |
|----|------------------|
| 9 | Photo-Realistic Cinematic |
| 3 | Lifestyle Photography |
| 10 | Documentary Photography |
| 5 | Vibrant & Bold |
| 2 | Product Showcase |
| 6 | Natural & Organic |
| 15 | Neon Noir Cyberpunk |
| 1 | Watercolor Art |
| 7 | Disney-Pixar Style |
| 12 | 3D Sticker Bomb |
| 13 | Claymation Studio |
| 14 | Papercut Diorama |
| 16 | Technical Blueprint |

## Structured Prompt Components

### scene_prompt (Required)

What's happening in the scene - pose, action, environment. NO appearance details when using refs.

**Structure:**
```
{pose_action}. {environment}.
```

**Examples:**
```
Walking profile view, striding left to right through fresh snow. Snowy mountain backdrop with pine forest.
```
```
Standing confidently, hands on hips. Modern minimalist studio with neutral backdrop.
```
```
Seated at cafe table, looking at phone. Parisian streetside cafe, golden hour light.
```

### additional_details (Optional)

Lighting, mood, and style tokens that enhance the scene.

**Structure:**
```
{lighting}. {mood}. {style_tokens}.
```

**Examples:**
```
Bright winter daylight, visible breath in cold air. Fashion editorial mood. Cinematic, 8K, shallow depth of field.
```
```
Soft diffused studio lighting, gentle shadows. Professional, confident. High-end fashion photography.
```

### negative_prompt (Optional)

What to avoid in generation.

**Default:**
```
no text, no logos, no watermarks, clean plate, anatomically correct
```

**Extended (for character generation):**
```
no text, no logos, no watermarks, clean plate, anatomically correct, no extra limbs, no distorted faces
```

## Reference Modes

When using reference images (via `reference_group_name` or `reference_images`):

| Mode | Effect | Use Case |
|------|--------|----------|
| `style` | Match colors, aesthetic, lighting | Brand consistency, mood boards |
| `add` | Include elements in composition | Specific objects, backgrounds |

**Example:**
```python
mcp__go-bananas__generate_image(
    prompt="Professional headshot with confident pose",
    reference_group_name="Brand Moodboard",
    reference_mode="style",
    aspect_ratio="1:1"
)
```

## Style Transfer from Extracted Frames (Phase 1.5)

After extracting reference frames with `extract_frames.py`, use Go Bananas to restyle them while preserving the original pose and composition.

### Upload and Edit Workflow

```python
# 1. Upload extracted reference frame
result = mcp__go-bananas__upload_image_for_editing(
    image_path="projects/{product}/reference/frames/scene_1_frame.jpg"
)

# 2. Edit with character reference and style transfer
edited = mcp__go-bananas__edit_uploaded_image(
    uploaded_image_id=result["id"],
    edit_prompt="Transform to luxury fashion editorial style, maintain exact pose and composition. Professional lighting.",
    character_id=27,
    model_id="gemini-pro-image"  # ALWAYS use Pro model
)

# 3. Download the edited image to images/ directory for video generation
# Save as: projects/{product}/images/run001_scene_1_frame.jpg
```

### Tips for Style Transfer

| Tip | Details |
|-----|---------|
| Keep pose instruction | "maintain exact pose" or "preserve composition" in edit_prompt |
| Don't over-describe | The frame already has the pose -- focus on style/character changes |
| Use character_id | Ensures face/body consistency with other scenes |
| Pro model required | Standard model ignores character references |
| Save to images/ | Edited images go to `images/` dir (not `reference/frames/`) for Phase 4 |

### When to Use Style Transfer vs Fresh Generation

| Approach | Best For | Fidelity |
|----------|----------|----------|
| **Style Transfer** (edit_uploaded_image) | Exact pose matching, product placement, faithful reproduction | High |
| **Fresh Generation** (generate_image) | Creative freedom, different characters, new compositions | Medium |
| **Direct Use** (extracted frame as-is) | Quick iteration, exact reference reproduction | Highest |

## Best Practices

### 1. Character Generation

**CRITICAL: Always use `model_id="gemini-pro-image"` - Standard model ignores character refs!**

```python
# Good - use generate_image with character_id and model_id
mcp__go-bananas__generate_image(
    prompt="Profile view walking left to right. Urban street at dusk. Golden hour backlighting. Fashion editorial, cinematic.",
    character_id=27,
    aspect_ratio="9:16",
    model_id="gemini-pro-image"  # REQUIRED - Standard ignores character refs!
)

# Bad - repeating character appearance in prompt
mcp__go-bananas__generate_image(
    prompt="Young man with dark hair wearing green jacket walking...",  # WRONG - don't repeat appearance
    character_id=27,
    ...
)
```

### 2. Multi-Character Scenes

```python
# Use generate_image with character_ids array for multi-character scenes
mcp__go-bananas__generate_image(
    prompt="Three friends laughing together at outdoor cafe. Mediterranean terrace. Warm afternoon light. Lifestyle photography, authentic.",
    character_ids=[27, 28, 29],
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
```

### 3. Product Shots

```python
mcp__go-bananas__generate_image(
    prompt="Hero shot, elevated angle, floating against backdrop. Clean studio setup. Soft diffused lighting, gentle shadows. Premium, luxury.",
    product_id=42,
    aspect_ratio="1:1",
    model_id="gemini-pro-image"
)
```

### 4. Standalone with Style Preset

```python
mcp__go-bananas__generate_image(
    prompt="Mountain landscape at sunrise with dramatic clouds. Wide establishing shot.",
    style_preset_name="Photo-Realistic Cinematic",
    negative_prompt="no people, no text, clean plate",
    aspect_ratio="16:9"
)
```

## Aspect Ratios

| Ratio | Dimensions | Use Case |
|-------|------------|----------|
| 9:16 | Portrait | Social media stories, TikTok, Reels |
| 16:9 | Landscape | YouTube, hero images, product videos |
| 1:1 | Square | Instagram posts, thumbnails |
| 4:3 | Standard | Presentations, traditional video |
| 3:4 | Portrait | Pinterest, some social formats |

## Integration with Video Replicator

The `gobananas_prompts.py` module automatically generates structured prompts from SEALCAM+ data:

```python
from gobananas_prompts import GoBananasPromptBuilder

builder = GoBananasPromptBuilder()
prompt = builder.build_character_prompt(scene_data, character_id=27)

# Access structured components
print(prompt.scene_prompt)
print(prompt.additional_details)
print(prompt.recommended_style_preset)

# Generate MCP command
print(prompt.to_mcp_command(character_id=27))

# Or get as dict for API calls
params = prompt.to_mcp_dict(character_id=27)
```

## Troubleshooting

### Images don't match character reference
- **Cause**: scene_prompt contains appearance details that conflict with reference
- **Fix**: Remove all appearance descriptions from scene_prompt, focus on pose/action only

### Character looks different between scenes (character drift)
- **Cause**: Dynamic poses ("walking with powerful stride", "running") override character reference
- **Fix**: Use static poses for first frames. See `character-prompts.md` "Pose Complexity and Character Drift" section

### Style not applied correctly
- **Cause**: Style keywords in prompt conflict with style preset
- **Fix**: Use `additional_details` for style hints, let preset handle the rest

### Aspect ratio ignored
- **Cause**: Some presets have default aspect ratios
- **Fix**: Explicitly set `aspect_ratio` parameter, it takes precedence

### Generation too slow
- **Cause**: Complex prompts with many references
- **Fix**: Simplify prompt, use single character/product ref, limit reference images
