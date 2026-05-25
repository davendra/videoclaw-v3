# Complete Workflow Examples

*Last Updated: 2026-01-13*

## Example 1: Luxury Jewelry Ad Replication

### User Input

- **Reference**: Instagram jewelry ad (Goldmark style)
- **Character**: Photo of user as presenter
- **Product**: Gold necklace product shot
- **Instructions**: "Replace the model with me, keep the luxury aesthetic"

### Step-by-Step Execution

```bash
# 1. ANALYZE VIDEO
python scripts/analyze_video.py \
  --video "https://instagram.com/p/xyz" \
  --output "projects/goldmark/analysis/sealcam.json"

# 2. REWRITE PROMPTS
python scripts/rewrite_prompts.py \
  --analysis "projects/goldmark/analysis/sealcam.json" \
  --subject "A 35-year-old man with short dark hair wearing a navy suit" \
  --output "projects/goldmark/analysis/rewritten.json"
```

### Go Bananas MCP Calls

```python
# 3. CREATE REFERENCES
mcp__go-bananas__create_character(
    character_name="goldmark_presenter",
    base_prompt="35-year-old man with short dark hair, navy suit, confident",
    reference_image_ids=[uploaded_id]
)

mcp__go-bananas__create_product_reference(
    product_name="gold_necklace",
    product_url="https://...",
    product_description="18K gold chain necklace"
)

# 4. GENERATE FIRST FRAMES (for each scene)
mcp__go-bananas__generate_with_character(
    character_name="goldmark_presenter",
    scene_prompt="{rewritten scene prompt}",
    aspect_ratio="16:9"
)
```

### Video and Audio Generation

```bash
# 5. GENERATE VIDEOS (for each scene)
python scripts/generate_video_flow.py \
  --prompt "35-year-old man in navy suit, in minimalist beige studio,
            turning toward camera. Camera slowly dollies in.
            High-key studio lighting. Luxury, commercial, 8K." \
  --output "projects/goldmark/videos/scene_1.mp4"

# 6. GENERATE MUSIC
python scripts/generate_music.py \
  --prompt "Elegant piano with soft strings, 80 BPM, luxury jewelry commercial" \
  --duration 30 \
  --output "projects/goldmark/audio/background.mp3"

# 7. STITCH FINAL VIDEO
python scripts/stitch_video.py \
  --pattern "projects/goldmark/videos/scene_*.mp4" \
  --audio "projects/goldmark/audio/background.mp3" \
  --output "projects/goldmark/final/replicated_ad.mp4"
```

---

## Example 2: Skincare Product Ad

### User Input

- **Reference**: TikTok skincare viral reel
- **Product**: New moisturizer bottle
- **Instructions**: "Keep the same aesthetic, swap product only"

### SEALCAM Analysis Output

```json
{
  "video_analysis": {
    "overall_vibe": "Clean beauty, minimalist, dewy aesthetic",
    "total_duration": "12 seconds",
    "scene_count": 4,
    "pacing": "Quick cuts, 3 seconds each"
  },
  "scenes": [
    {
      "scene_number": 1,
      "subject": "Glass skincare bottle with dropper",
      "environment": "White marble surface, soft morning light",
      "action": "Product rotating slowly",
      "lighting": "Soft diffused natural light from left",
      "camera": "Close-up, slight orbit",
      "metatokens": "Clean beauty, minimal, premium"
    },
    {
      "scene_number": 2,
      "subject": "Hand reaching for product",
      "environment": "Same marble surface",
      "action": "Picking up bottle gracefully",
      "lighting": "Same soft lighting",
      "camera": "Medium shot, static",
      "metatokens": "Lifestyle, elegant, authentic"
    }
  ],
  "music_prompt": "Soft acoustic guitar, 90 BPM, clean and fresh, spa vibes"
}
```

### Rewritten Prompts (Product Swap)

```json
{
  "scenes": [
    {
      "scene_number": 1,
      "subject": "White moisturizer jar with gold cap",
      "generation_prompt": "White moisturizer jar with gold cap, on white marble surface with soft morning light, rotating slowly, soft diffused natural light from left, close-up slight orbit, clean beauty minimal premium, no text no logos clean plate"
    }
  ]
}
```

---

## Example 3: Fashion/Streetwear Ad

### User Input

- **Reference**: Nike-style urban ad
- **Character**: Brand ambassador photo
- **Instructions**: "Same energy, different person, add our logo in post"

### Key Considerations

1. **Multiple outfit changes** → Create character reference without specific outfit
2. **Urban locations** → Keep environment descriptions generic enough to recreate
3. **Dynamic camera** → Note specific movements (tracking, handheld, etc.)

### Character Reference Setup

```python
mcp__go-bananas__create_character(
    character_name="streetwear_ambassador",
    base_prompt="Athletic 25-year-old man, confident stance, urban style",
    reference_image_ids=[uploaded_id],
    # Note: Don't include outfit in base_prompt if it changes per scene
)
```

### Per-Scene Generation

```python
# Scene with hoodie
mcp__go-bananas__generate_with_character(
    character_name="streetwear_ambassador",
    scene_prompt="wearing black hoodie and joggers, urban alley with graffiti walls, walking toward camera with confident stride, natural overcast lighting, wide angle tracking shot, streetwear hypebeast urban, no text no logos",
    aspect_ratio="9:16"  # Vertical for social
)

# Scene with jacket
mcp__go-bananas__generate_with_character(
    character_name="streetwear_ambassador",
    scene_prompt="wearing bomber jacket and cargo pants, rooftop at golden hour, looking over city skyline, warm golden hour lighting, medium shot slight dolly, cinematic urban aspirational, no text no logos",
    aspect_ratio="9:16"
)
```

---

## Common Patterns

### Pattern: BTS Opening

Many successful ads start with behind-the-scenes footage. This creates authenticity.

```json
{
  "scene_number": 1,
  "subject": "Production crew with cameras and lighting",
  "environment": "Professional studio with visible equipment",
  "action": "Camera panning across setup",
  "lighting": "Practical lights visible in frame",
  "camera": "Wide angle, slow pan",
  "metatokens": "Documentary, raw, authentic, BTS"
}
```

### Pattern: Hero Product Shot

Center the product for maximum impact.

```json
{
  "scene_number": 3,
  "subject": "Product centered, hero position",
  "environment": "Clean backdrop, minimal distractions",
  "action": "Slow rotation or static beauty shot",
  "lighting": "Three-point product lighting",
  "camera": "Eye-level, slow dolly in",
  "metatokens": "Commercial, premium, sharp focus, 8K"
}
```

### Pattern: Lifestyle Integration

Show product in natural use context.

```json
{
  "scene_number": 4,
  "subject": "Person naturally using product",
  "environment": "Relevant lifestyle setting",
  "action": "Authentic interaction with product",
  "lighting": "Natural or motivated lighting",
  "camera": "Medium shot, observational",
  "metatokens": "Lifestyle, authentic, relatable"
}
```
