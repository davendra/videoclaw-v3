# AI Camera Transition Prompts

*Last Updated: 2026-01-31*

In-camera transition prompts that instruct Veo 3 to create organic transitions **during generation**, eliminating post-production effects. Append these fragments to the END of a scene's prompt (outgoing transitions only).

**Design principle**: Transitions attach to the outgoing scene (Scene N), not the incoming scene (Scene N+1). This is because I2V mode's start frame constrains the opening of each scene.

## How to Use

1. Choose a transition from the library below
2. Pass via `--transitions '{"1":"zoom_crash","3":"atmo_fog"}'` to `parallel_video_gen.py`
3. The fragment is automatically appended after the scene prompt, separated by `. `

**Mode compatibility**: Most transitions work with T2V, I2V, and R2V. They do NOT apply to F2V (both endpoints are fixed).

---

## Arc Transitions

Circular camera movements that create dynamic scene exits.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `arc_180` | Half Arc | `Camera arcs 180 degrees around the subject as the scene fades to motion blur` | t2v, i2v, r2v | Reveals, perspective shifts |
| `arc_360` | Full Orbit | `Camera orbits 360 degrees around subject, accelerating into a spiral blur` | t2v, r2v | High energy, product reveals |
| `arc_overhead` | Overhead Arc | `Camera arcs overhead in a sweeping crane move, scene dissolving below` | t2v, i2v, r2v | Grand reveals, location transitions |

## Roll Transitions

Camera rotation along the lens axis for disorienting, stylish exits.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `roll_barrel` | Barrel Roll | `Camera barrel rolls as the scene spirals into the next` | t2v, r2v | Action, energy bursts |
| `roll_dutch` | Dutch Tilt Roll | `Camera tilts into a dutch angle then continues rolling, scene streaking into blur` | t2v, i2v, r2v | Tension, unease, drama |
| `roll_slow` | Slow Roll | `Camera slowly rolls clockwise, scene gently rotating away` | t2v, i2v, r2v | Dream sequences, ethereal moments |

## Wipe Transitions

Subject or camera movement that naturally wipes the frame.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `wipe_subject` | Subject Wipe | `Subject walks past camera filling the frame completely, wiping the scene` | t2v, i2v, r2v | Character-driven transitions |
| `wipe_whip_pan` | Whip Pan | `Camera whip pans rapidly to the right, scene streaking into horizontal motion blur` | t2v, i2v, r2v | Fast pace, energy, comedy |
| `wipe_whip_tilt` | Whip Tilt | `Camera whip tilts upward rapidly, scene streaking into vertical motion blur` | t2v, i2v, r2v | Reveals, upward energy |
| `wipe_object` | Object Wipe | `A foreground element passes across the lens, momentarily blocking the view` | t2v, i2v, r2v | Natural, organic cuts |

## Portal Transitions

Moving through openings that frame the transition.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `portal_doorway` | Doorway Push | `Camera pushes through a doorway into darkness` | t2v, i2v, r2v | Interior/exterior shifts |
| `portal_tunnel` | Tunnel Through | `Camera rushes forward through a dark tunnel toward a bright opening` | t2v, r2v | Dramatic reveals, journeys |
| `portal_frame` | Frame Within Frame | `Camera pushes through a frame-within-frame element, passing into a new space` | t2v, i2v, r2v | Artistic, composed transitions |

## Match Cut Transitions

Visual matching between outgoing and incoming elements.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `match_shape` | Shape Match | `Camera zooms into a circular element in frame until it fills the screen` | t2v, i2v, r2v | Graphic, editorial |
| `match_color` | Color Match | `Scene gradually shifts to a single dominant color, filling the frame` | t2v, i2v, r2v | Mood shifts, stylized |
| `match_eye` | Eye Zoom | `Camera pushes into extreme close-up of the subject's eye, pupil filling the frame` | t2v, i2v, r2v | Intimate, psychological |

## Zoom Transitions

Speed-based zoom movements for dynamic energy.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `zoom_crash` | Crash Zoom | `Camera crash zooms forward at extreme speed, scene rushing into blur` | t2v, i2v, r2v | Impact, surprise, action |
| `zoom_pull` | Zoom Pull | `Camera rapidly pulls back, scene shrinking to a point in the center` | t2v, i2v, r2v | Reveals, scale shifts |
| `zoom_infinite` | Infinite Zoom | `Camera zooms deeper and deeper into the scene, fractal-like layers emerging` | t2v, r2v | Surreal, psychedelic |
| `zoom_snap` | Snap Zoom | `Camera snaps to extreme close-up on a detail, filling the frame` | t2v, i2v, r2v | Product focus, detail reveal |

## Atmospheric Transitions

Environmental effects that obscure the scene naturally.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `atmo_fog` | Fog Roll | `Thick fog rolls across the frame, gradually obscuring the entire scene` | t2v, i2v, r2v | Mystery, mood change |
| `atmo_dust` | Dust Storm | `A gust of wind kicks up dust and particles, filling the frame completely` | t2v, i2v, r2v | Outdoor, rugged transitions |
| `atmo_light` | Light Flare | `Bright light flares across the lens, washing the scene to white` | t2v, i2v, r2v | Ethereal, heavenly, time shifts |
| `atmo_dark` | Fade to Dark | `Scene gradually darkens as shadows creep in from the edges, fading to black` | t2v, i2v, r2v | Endings, somber moments |
| `atmo_rain` | Rain Blur | `Rain intensifies on the lens, droplets blurring the scene away` | t2v, i2v, r2v | Melancholy, weather shifts |

## Dolly Transitions

Forward/backward camera travel through space.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `dolly_through` | Dolly Through | `Camera dollies forward through the subject, passing through to the other side` | t2v, r2v | Surreal, through-object |
| `dolly_vertigo` | Vertigo Effect | `Camera dollies backward while zooming in, creating a disorienting vertigo effect` | t2v, i2v, r2v | Suspense, realization |
| `dolly_lateral` | Lateral Slide | `Camera slides laterally behind a wall or surface, scene disappearing edge-first` | t2v, i2v, r2v | Clean, architectural |

## Combined Transitions

Multi-movement transitions that layer techniques.

| ID | Name | Prompt Fragment | Modes | Best For |
|----|------|----------------|-------|----------|
| `combo_orbit_zoom` | Orbit + Zoom | `Camera orbits the subject while simultaneously zooming in, spiraling closer` | t2v, r2v | High energy, climactic |
| `combo_tilt_fade` | Tilt + Fade | `Camera tilts upward toward the sky as the scene gradually fades to white` | t2v, i2v, r2v | Hopeful endings, time passing |
| `combo_pan_blur` | Pan + Speed Blur | `Camera pans right while accelerating, scene streaking into directional blur` | t2v, i2v, r2v | Momentum, travel sequences |

---

## Selection Guide

Use this table to choose the right transition based on the scene-pair context:

| Scene Pair Context | Recommended Transitions | Why |
|--------------------|------------------------|-----|
| Close-up → Wide | `zoom_pull`, `arc_overhead` | Naturally expands field of view |
| Wide → Close-up | `zoom_crash`, `zoom_snap` | Drives focus inward |
| Same location, time skip | `atmo_light`, `atmo_fog` | Suggests passage of time |
| Interior → Exterior | `portal_doorway`, `dolly_through` | Physical transition through space |
| Exterior → Interior | `portal_frame`, `dolly_lateral` | Moving into enclosed space |
| High energy → High energy | `wipe_whip_pan`, `roll_barrel` | Maintains momentum |
| Calm → Calm | `roll_slow`, `atmo_fog` | Preserves tranquility |
| Calm → High energy | `zoom_crash`, `wipe_whip_pan` | Dramatic energy shift |
| High energy → Calm | `atmo_light`, `combo_tilt_fade` | Releases tension |
| Product reveal | `match_shape`, `zoom_snap` | Focuses attention on product |
| Character entrance | `wipe_subject`, `portal_doorway` | Natural character-driven reveal |
| Dream/surreal | `zoom_infinite`, `dolly_through` | Creates otherworldly feel |
| Dramatic moment | `dolly_vertigo`, `match_eye` | Builds psychological tension |
| Travel/journey | `combo_pan_blur`, `portal_tunnel` | Conveys movement and distance |

## Mode Compatibility Reference

| Mode | Compatible | Notes |
|------|-----------|-------|
| T2V (text-to-video) | All transitions | Full creative freedom |
| I2V (image-to-video) | Most transitions | Start frame is fixed; transition happens at END |
| R2V (reference-to-video) | All transitions | Same as T2V with reference consistency |
| F2V (frames-to-video) | None | Both endpoints fixed, no room for transitions |

### T2V-Only Transitions

These transitions are too disruptive for I2V mode (they may conflict with maintaining the start frame):

- `arc_360` (full orbit changes perspective too much)
- `roll_barrel` (barrel roll conflicts with start frame stability)
- `zoom_infinite` (fractal zoom too abstract for frame preservation)
- `dolly_through` (passing through subjects conflicts with appearance maintenance)
- `portal_tunnel` (forward rush too aggressive for start-frame mode)
- `combo_orbit_zoom` (combined movement too complex for I2V)
