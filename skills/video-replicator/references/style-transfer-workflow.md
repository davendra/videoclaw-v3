# Style Transfer Workflow — Go Bananas Reference Groups

Restyle any set of images (PDF slides, screenshots, photos) into a consistent visual style using Go Bananas reference groups.

## Quick Start

```python
# 1. Upload original image
upload_image_for_editing(file_path="/path/to/slide.jpg")
# → image_id: 4326

# 2. Apply style transfer from reference group
generate_image(
    prompt='Using the visual style from the reference images (reference group(s) "My Style"), style transfer. Match the artistic style, color palette, lighting, mood, and visual aesthetic from the references.',
    image_to_edit_id=4326,
    reference_group_id=1,       # Your reference group ID
    reference_mode="style",
    aspect_ratio="16:9"
)
```

## The Prompt Template

Always use this exact prompt — abbreviated prompts produce inconsistent results:

```
Using the visual style from the reference images (reference group(s) "{group_name}"), style transfer. Match the artistic style, color palette, lighting, mood, and visual aesthetic from the references.
```

Available in code as `config.STYLE_TRANSFER_PROMPT_TEMPLATE.format(group_name="My Style")`.

## Workflow: PDF Slides to Styled Video

### Phase 1: Extract slides
```bash
python scripts/extract_pdf_slides.py \
  --pdf "slides.pdf" \
  --output-dir "projects/{slug}/slides" \
  --output-json "projects/{slug}/analysis/slides.json" \
  --total-duration 120
```

### Phase 2: Style transfer (via Go Bananas MCP)
For each slide:
1. `upload_image_for_editing(file_path=slide_path)` → `image_id`
2. `generate_image(prompt=TEMPLATE, image_to_edit_id=image_id, reference_group_id=N, reference_mode="style", aspect_ratio="16:9")`

### Phase 3: Download styled images
Save to `projects/{slug}/images/styled/` or `projects/{slug}/images/{style_name}/`

### Phase 4: Generate animated videos
```bash
python scripts/parallel_video_gen.py \
  --product "{slug}" --mode frames-to-video --f2v-loop \
  --images-dir "projects/{slug}/images/styled" \
  --scenes '{"1":"content-aware animation prompt for slide 1", ...}' \
  --ratio landscape --quality fast --variations 1 --allow-stale --yes
```

**Content-aware animation prompts**: Instead of generic "subtle light shift", describe what should actually move based on the slide's visual elements. Examples:
- Bar chart slide: "Bar charts animate upward one by one, counter ticks up"
- Network diagram: "Nodes light up connecting across the grid, data pulses flow"
- Layered architecture: "Each layer illuminates from bottom to top as data flows upward"

### Phase 5: Loop, bake narration, add music
```bash
# Auto-loop videos to match TTS duration (new --auto-loop flag)
python scripts/generate_tts.py \
  --bake-narration --auto-loop \
  --videos-dir "projects/{slug}/videos" \
  --tts-dir "projects/{slug}/audio/tts" \
  --preserve-sfx --tts-volume 1.5 --sfx-volume 0.3 --yes
```

### Phase 6: Stitch with music
```bash
python scripts/stitch_video.py \
  --videos-dir "projects/{slug}/videos" \
  --audio "projects/{slug}/audio/background_music.mp3" \
  --output "projects/{slug}/final/output.mp4" \
  --music-volume 0.05
```

## Multiple Style Variants

Generate multiple versions from the same source slides using different reference groups:

```
images/styled/          # Unstructure Heros style
images/indian-style/    # Indian Refs Images style
images/watercolor/      # Watercolor style
```

Each variant can be turned into a separate video with different narration tones.

## Creating Reference Groups

1. Find or generate 1-4 reference images that define your target style
2. In Go Bananas: create a reference group, add the images
3. Use the group ID in the style transfer workflow

## Character Reference Sheet Presets

After creating a character, generate reference sheets for consistency:

```python
# 2x4 grid (8 poses/angles)
generate_image(prompt="character name", character_id=N, style_preset_id=49, aspect_ratio="16:9", model_id="gemini-pro-image")

# Cinematic 7-view sheet
generate_image(prompt="character name", character_id=N, style_preset_id=55, aspect_ratio="16:9", model_id="gemini-pro-image")

# Add both to character
update_character(character_id=N, reference_image_ids=[portrait_id, sheet_49_id, sheet_55_id])
```

## Narration Tone

When generating narration for styled presentations, use `config.NARRATION_TONES`:

| Tone | When to Use |
|------|-------------|
| `conversational` | LinkedIn, social media, broad audience (default) |
| `corporate` | Board presentations, investor decks |
| `storytelling` | Case studies, journey narratives |
| `casual` | Internal team updates, podcast-style |

## Known Issues

- **Gemini aspect_ratio in edit mode**: Historically ignored by Gemini. Go Bananas fix deployed 2026-03-31 passes `imageConfig.aspectRatio` to API. If still producing wrong ratio, post-process with FFmpeg resize.
- **Style consistency**: Results can vary between generations. For best consistency, use reference groups with 3-4 diverse reference images rather than just 1.
