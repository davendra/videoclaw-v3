# Cinematic Techniques for AI Video Generation

## Shot Types and When to Use Them

### By Distance
| Shot | Description | Use For |
|------|-------------|---------|
| Extreme Wide (EWS) | Entire landscape, tiny figures | Establishing location |
| Wide Shot (WS) | Full body, environment visible | Setting the scene |
| Medium Wide (MWS) | Knees up | Walking, body language |
| Medium Shot (MS) | Waist up | Conversation, general action |
| Medium Close-Up (MCU) | Chest up | Dialogue, emotion |
| Close-Up (CU) | Face only | Emotion, reaction, intensity |
| Extreme Close-Up (ECU) | Eyes, hands, object | Detail, tension, revelation |

### By Angle
| Angle | Effect | Prompt Keywords |
|-------|--------|----------------|
| Eye Level | Neutral, relatable | "eye level shot" |
| Low Angle | Power, dominance | "low angle, looking up at" |
| High Angle | Vulnerability, overview | "high angle, looking down at" |
| Dutch Angle | Unease, disorientation | "tilted angle, dutch angle" |
| Bird's Eye | Overview, isolation | "overhead shot, bird's eye view" |
| Worm's Eye | Dramatic, imposing | "ground level, extreme low angle" |

## Camera Movements

Include these in video generation prompts:

| Movement | Description | Prompt Phrasing |
|----------|-------------|-----------------|
| Static | No movement | "static shot, locked camera" |
| Pan | Horizontal rotation | "camera pans left/right" |
| Tilt | Vertical rotation | "camera tilts up/down" |
| Dolly In | Move toward subject | "slow dolly in, camera moves forward" |
| Dolly Out | Move away from subject | "dolly out, camera pulls back" |
| Tracking | Follow subject movement | "tracking shot following character" |
| Crane Up | Rise vertically | "crane shot rising upward" |
| Crane Down | Descend vertically | "crane shot descending" |
| Handheld | Slight shake | "handheld camera, slight shake" |
| Steadicam | Smooth follow | "steadicam, smooth following shot" |

## Lighting Descriptions for Prompts

| Lighting | Mood | Prompt Keywords |
|----------|------|----------------|
| High key | Happy, open | "bright, even lighting, high key" |
| Low key | Dramatic, mysterious | "dramatic shadows, low key lighting" |
| Backlit | Ethereal, silhouette | "backlit, silhouette, rim lighting" |
| Side lit | Dramatic, revealing | "side lighting, strong shadows on face" |
| Golden hour | Warm, nostalgic | "golden hour, warm sunlight" |
| Blue hour | Melancholic, calm | "blue hour, cool twilight" |
| Neon | Urban, cyberpunk | "neon lights, colorful reflections" |
| Candlelight | Intimate, warm | "candlelight, warm flickering glow" |
| Overcast | Neutral, somber | "overcast, soft diffused light" |
| Harsh sun | Stark, intense | "harsh midday sun, strong shadows" |

## Transitions Between Shots

| Transition | When to Use | FFmpeg Implementation |
|------------|------------|----------------------|
| Hard cut | Same scene, different angle | No transition needed |
| Crossfade | Scene change, time passing | `xfade=transition=fade:duration=0.5` |
| Fade to black | End of sequence, time jump | `fade=t=out:st=END:d=1` |
| Fade from black | Beginning, new sequence | `fade=t=in:d=1` |
| Wipe | Energetic transition | `xfade=transition=wipeleft` |
| Dissolve | Dream sequences, memory | `xfade=transition=dissolve:duration=1` |

## Composition Rules for Prompts

### Rule of Thirds
- Place subject at 1/3 intersections, not center
- Prompt: "rule of thirds composition, subject positioned left third"

### Leading Lines
- Use architecture, roads, fences to guide eye
- Prompt: "leading lines drawing eye to subject"

### Depth Layers
- Foreground, midground, background elements
- Prompt: "layered composition, foreground elements framing subject"

### Negative Space
- Empty space creates mood and focus
- Prompt: "negative space, minimalist composition, subject isolated"

## Color Palette by Genre

| Genre | Primary Colors | Color Temperature | Saturation |
|-------|---------------|-------------------|------------|
| Drama | Earth tones, blues | Warm to neutral | Medium |
| Thriller | Cool blues, greens | Cool | Desaturated |
| Comedy | Bright, varied | Warm | High |
| Sci-Fi | Blues, teals, purples | Cool | Medium |
| Horror | Greens, reds, blacks | Cool with warm accents | Low |
| Romance | Warm golds, pinks | Warm | Medium-high |
| Action | High contrast, reds | Neutral | High |

## Cinematic Prompt Template

```
[SHOT TYPE], [SUBJECT DESCRIPTION with character details],
[ACTION/POSE], [SETTING with time of day],
[LIGHTING], [CAMERA ANGLE], [CAMERA MOVEMENT],
[MOOD/ATMOSPHERE], [STYLE: cinematic/filmic/etc],
[TECHNICAL: shallow depth of field, film grain, etc]
```

**Example:**
```
Medium close-up, a weathered man in his 50s with silver beard and
brown leather jacket looks through a rain-streaked window.
Interior of a dimly lit diner at night. Side lighting from neon
signs outside casting colored shadows. Eye level, slow dolly in.
Melancholic, contemplative atmosphere. Cinematic, shallow depth
of field, subtle film grain.
```
