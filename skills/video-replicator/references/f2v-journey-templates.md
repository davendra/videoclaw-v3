# F2V Journey Templates

Pre-built transition prompt templates for chained F2V (frames-to-video) generation. Each template provides a sequence of camera motion prompts optimized for continuous video flow.

## Available Templates

| Template ID | Name | Scenes | Best For |
|------------|------|--------|----------|
| `property_tour` | Property Tour (Exterior to Interior) | 8 | Real estate, architecture, home tours |
| `building_ascent` | Building Ascent (Ground to Sky) | 6 | Multi-story buildings, hotels, penthouses |
| `nature_walk` | Nature Walk (Path Through Landscape) | 6 | Gardens, parks, trails, outdoor spaces |
| `product_reveal` | Product Reveal (Approach to Hero Shot) | 5 | Product launches, commercials, brand videos |
| `architectural_walkthrough` | Architectural Walkthrough (Room to Room) | 7 | Interior design, hospitality, showrooms |

## Usage

### With `--chained` mode (recommended)

```bash
# Use template prompts directly
python parallel_video_gen.py \
  --product "my-villa" \
  --chained \
  --journey-template property_tour \
  --images-dir "projects/my-villa/images" \
  --ratio landscape --quality fast

# Override specific scenes
python parallel_video_gen.py \
  --product "my-villa" \
  --chained \
  --journey-template property_tour \
  --scenes '{"3":"Camera pushes through ornate wooden doors into marble foyer"}' \
  --images-dir "projects/my-villa/images" \
  --ratio landscape --quality fast
```

### List templates

```bash
python parallel_video_gen.py --list-journey-templates
```

### Without chaining (standard F2V)

Templates work without `--chained` too — each scene generates independently:

```bash
python parallel_video_gen.py \
  --product "my-villa" \
  --mode frames-to-video \
  --journey-template nature_walk \
  --images-dir "projects/my-villa/images" \
  --ratio landscape --quality fast --variations 1
```

## Template Details

### property_tour (8 scenes)

Exterior-to-interior walkthrough for real estate and architecture:

| Scene | Type | Motion | Description |
|-------|------|--------|-------------|
| 1 | `aerial_descend` | Descending crane | Aerial establishing → street level |
| 2 | `forward_approach` | Forward dolly | Approach entrance along path |
| 3 | `push_through` | Forward push | Cross threshold into foyer |
| 4 | `pan_reveal` | Horizontal pan | Pan to reveal living space |
| 5 | `forward_glide` | Low dolly | Glide through living area |
| 6 | `push_in` | Slow zoom | Push in on key feature |
| 7 | `tracking_lateral` | Sideways track | Lateral tracking through room |
| 8 | `pullback_reveal` | Reverse dolly | Pull back to show full property |

### building_ascent (6 scenes)

Vertical journey from ground to sky:

| Scene | Type | Motion | Description |
|-------|------|--------|-------------|
| 1 | `ground_entry` | Forward dolly | Street level approach |
| 2 | `push_interior` | Forward push | Enter ground floor |
| 3 | `tilt_ascend` | Vertical pan | Look up through atrium |
| 4 | `floor_reveal` | Forward dolly | Upper floor room reveal |
| 5 | `push_to_terrace` | Forward push | Push out to terrace |
| 6 | `aerial_ascend` | Crane up | Rise to aerial view |

### nature_walk (6 scenes)

Path through natural environment:

| Scene | Type | Motion | Description |
|-------|------|--------|-------------|
| 1 | `aerial_descend` | Descending crane | Descend to trail entrance |
| 2 | `forward_walk` | Forward dolly | Walk along path |
| 3 | `pan_environment` | Horizontal pan | Pan to reveal environment |
| 4 | `forward_clearing` | Forward dolly | Move into clearing |
| 5 | `push_detail` | Slow push | Push in on natural detail |
| 6 | `pullback_wide` | Reverse crane | Pull back to wide vista |

### product_reveal (5 scenes)

Dramatic product showcase:

| Scene | Type | Motion | Description |
|-------|------|--------|-------------|
| 1 | `approach_dark` | Forward dolly | Approach in dramatic lighting |
| 2 | `orbit_reveal` | 180° arc | Orbit to reveal angles |
| 3 | `push_detail` | Macro push | Extreme close-up on detail |
| 4 | `pullback_hero` | Reverse dolly | Pull back to hero shot |
| 5 | `final_flourish` | Gentle drift | Final dramatic composition |

### architectural_walkthrough (7 scenes)

Room-to-room interior journey:

| Scene | Type | Motion | Description |
|-------|------|--------|-------------|
| 1 | `entrance_push` | Forward push | Enter through main entrance |
| 2 | `room_pan` | 180° pan | Pan across first room |
| 3 | `forward_corridor` | Forward dolly | Move through corridor |
| 4 | `room_enter` | Doorway reveal | Enter second room |
| 5 | `detail_push` | Slow push | Push in on design detail |
| 6 | `lateral_track` | Sideways track | Track along feature wall |
| 7 | `final_pullback` | Reverse dolly | Grand reveal of final space |

## Camera Motion Language

Effective F2V prompts use specific motion vocabulary that Veo understands:

| Motion | Keyword | Example |
|--------|---------|---------|
| Forward | `forward dolly`, `push in`, `moving forward` | "Camera pushing forward through the doorway" |
| Backward | `pullback`, `reverse dolly`, `pull back` | "Camera pulling back to reveal the full room" |
| Lateral | `tracking left/right`, `lateral dolly` | "Camera tracking laterally along the wall" |
| Up | `crane up`, `ascending`, `tilt up` | "Camera ascending from ground to aerial" |
| Down | `descending`, `crane down`, `tilt down` | "Camera descending through the canopy" |
| Rotation | `pan left/right`, `orbit`, `arc` | "Camera panning right to reveal the garden" |

### Key Rules

1. **Always say "smooth cinematic camera"** — anchors Veo to steady motion
2. **Specify direction explicitly** — "forward", "right", "upward", not "moving"
3. **Say "continuous motion"** — prevents Veo from inserting cuts
4. **Avoid mentioning "cut"** — Veo may interpret as an actual cut
5. **Keep prompts under 50 words** — Veo ignores overly long prompts

## Customizing Templates

Templates are starting points. Override any scene:

```python
from f2v_journey_templates import get_template, merge_template_with_scenes

template = get_template("property_tour")
overrides = {
    "3": "Camera pushes through ornate carved wooden doors into a grand marble foyer with chandelier",
    "6": "Camera slowly zooms into the infinity pool reflecting the sunset sky",
}
scenes = merge_template_with_scenes(template, overrides)
```
