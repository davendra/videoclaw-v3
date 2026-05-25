# Motion Templates Library

*Last Updated: 2026-01-16*

Reusable motion patterns for video generation prompts. Use these templates to ensure consistent, accurate motion descriptions across scenes.

## Human Movement Patterns

### Walking Styles

| Style | Speed (1-10) | Characteristics | Micromotion | Prompt Fragment |
|-------|--------------|-----------------|-------------|-----------------|
| Runway | 3 | One foot in front of other, minimal arm swing, elongated stride | Subtle hip sway, controlled breathing, chin elevated | `walks slowly in runway style, one foot in front of other, minimal arm swing` |
| Casual | 5-6 | Natural pace, relaxed arms, slight body sway | Normal breathing, gentle arm swing | `walks casually with natural gait and relaxed posture` |
| Power | 7-8 | Brisk, purposeful, strong arm swing, leaning slightly forward | Visible breathing, determined expression, quick foot strikes | `strides purposefully with strong arm swing and confident posture` |
| Slow-mo | 1-2 | Exaggerated slow motion effect, extended movements | Hair/fabric float, extended gestures, gravity-defying elements | `moves in slow motion, fabric and hair flowing weightlessly` |
| Model Turn | 4 | Pivot on ball of foot, weight transfer, hold at end | Hair swing follows head, fabric catches momentum | `turns slowly on the spot, weight shifting from left to right leg` |

### Direction of Movement

| Direction | Camera Consideration | Prompt Fragment |
|-----------|----------------------|-----------------|
| Left to Right | Subject crosses frame, standard reading direction | `walks from left to right across frame` |
| Right to Left | Counter to reading direction, often used for tension | `walks from right to left across frame` |
| Toward Camera | Creates intimacy, face becomes more visible | `walks toward camera, approaching from background` |
| Away from Camera | Creates mystery, reveals environment | `walks away from camera toward background` |
| Diagonal L→R | Dynamic composition, depth perception | `walks diagonally from lower left toward upper right` |

### Head & Face Movements

| Action | Duration | Sequence | Micromotion | Prompt Fragment |
|--------|----------|----------|-------------|-----------------|
| Slow Look-back | 2-3s | Eyes → head → shoulders | Eyebrows may lift slightly, eyes lead | `slowly turns head to look back over shoulder, eyes leading the motion` |
| Quick Glance | 0.3-0.5s | Head snap only | Returns to original position | `quick glance to the side, head snaps back` |
| Smile Onset | 0.5-1s | Corners up → eyes crinkle | Duchenne smile includes eye involvement | `smile gradually spreads, eyes crinkling slightly` |
| Neutral Hold | Any | Minimal movement | Subtle breathing, occasional micro-blinks | `maintains neutral expression with subtle natural movement` |
| Head Tilt | 0.5s | Gentle lateral tilt | Often paired with eye movement | `tilts head slightly to one side` |

### Body Poses

| Type | Stance | Weight Distribution | Expression | Prompt Fragment |
|------|--------|---------------------|------------|-----------------|
| Hero | Wide, grounded | Evenly distributed (50-50) | Confident, horizon gaze | `stands in hero pose, wide stance, looking toward horizon` |
| Relaxed | Hip-shifted | 70-30 split | Soft, approachable | `stands relaxed with weight shifted to one hip` |
| Dynamic | Mid-movement | Transitioning | Suggests continuation | `captured mid-motion, suggesting ongoing movement` |
| Contemplative | Closed stance | Centered | Thoughtful, introspective | `stands still in contemplative pose, slightly inward` |
| Editorial | Elongated | On one leg | Fashion-forward | `poses in editorial stance, elongated lines` |

### Hand & Arm Movements

| Action | Duration | Details | Prompt Fragment |
|--------|----------|---------|-----------------|
| Natural swing | Continuous | Opposite arm to leg | `arms swing naturally with walking rhythm` |
| Touch face | 1-2s | Gentle contact with cheek or chin | `hand gently touches face` |
| Adjust clothing | 0.5-1s | Functional movement | `adjusts jacket collar` |
| Gesture | Varies | Emphasizes speech/thought | `gestures expressively with hands` |
| Rest at sides | Hold | Relaxed but intentional | `arms rest naturally at sides` |

---

## Camera Movement Patterns

### Movement Types

| Movement | Speed | Use Case | Easing | Prompt Fragment |
|----------|-------|----------|--------|-----------------|
| Static | 0 | Product focus, emotion, dialogue | N/A | `camera is static, locked off` |
| Slow Pan | 10-15°/s | Reveals, establishing shots | Ease-in-out | `camera slowly pans left to right` |
| Fast Pan | 30-45°/s | Action, energy, transition | Linear | `camera quickly pans to follow action` |
| Track Left | Match subject | Following subject walking left | Linear | `camera tracks left, matching subject speed` |
| Track Right | Match subject | Following subject walking right | Linear | `camera tracks right, following subject` |
| Dolly In | 0.3-0.5m/s | Dramatic emphasis, reveal detail | Ease-in | `camera slowly dollies in toward subject` |
| Dolly Out | 0.3-0.5m/s | Reveal context, ending shot | Ease-out | `camera pulls back, revealing environment` |
| Push In | Slow zoom | Increasing intensity | Gradual | `camera slowly pushes in on subject` |
| Pull Out | Slow zoom | Decreasing intensity | Gradual | `camera pulls out from subject` |
| Crane Up | Vertical | Reveal from above | Smooth | `camera rises vertically, revealing scene from above` |
| Crane Down | Vertical | Descend to subject | Smooth | `camera descends toward subject` |

### Camera Angles

| Angle | Effect | Use Case | Prompt Fragment |
|-------|--------|----------|-----------------|
| Eye Level | Neutral, relatable | Standard shots | `camera at eye level` |
| Low Angle | Power, dominance | Hero shots, products | `low angle shot looking up at subject` |
| High Angle | Vulnerability, overview | Context, scale | `high angle shot looking down at subject` |
| Dutch Angle | Tension, unease | Dramatic moments | `dutch angle, tilted horizon` |
| Bird's Eye | Overview, pattern | Establishing, abstract | `bird's eye view looking straight down` |
| Worm's Eye | Extreme power | Dramatic, unusual | `extreme low angle from ground level` |

### Shot Types

| Type | Framing | Use Case | Prompt Fragment |
|------|---------|----------|-----------------|
| Extreme Wide | Full environment + subject small | Establishing, scale | `extreme wide shot showing full environment` |
| Wide | Full body + environment | Context, movement | `wide shot capturing full body and surroundings` |
| Medium Wide | Knees up | Fashion, movement | `medium wide shot from knees up` |
| Medium | Waist up | Conversation, detail | `medium shot from waist up` |
| Medium Close-up | Chest up | Emotion, product | `medium close-up framing chest up` |
| Close-up | Face only | Emotion, detail | `close-up on face` |
| Extreme Close-up | Feature (eyes, lips) | Drama, texture | `extreme close-up on eyes` |

---

## Fabric & Material Physics

| Material | Movement Behavior | Light Behavior | Prompt Fragment |
|----------|-------------------|----------------|-----------------|
| Technical fabric | Minimal flutter, holds shape | Matte with subtle sheen | `technical fabric holds shape with subtle light catch` |
| Silk/satin | Flows, drapes, billows | High specular reflection | `silk fabric flows and catches light dramatically` |
| Wool/knit | Subtle stretch, maintains form | Absorbs light, soft shadows | `wool fabric moves subtly, absorbing light` |
| Leather | Stiff, creases at joints | Reflects, highlights edges | `leather creases with movement, catching highlights` |
| Denim | Limited movement, structured | Matte, minimal reflection | `denim moves minimally, structured and stiff` |
| Chiffon | Floats, billows dramatically | Translucent, diffuses light | `chiffon floats weightlessly with movement` |
| Cotton | Natural drape, moderate movement | Absorbs light evenly | `cotton fabric moves naturally with body` |

---

## Environment Motion

### Particles & Atmosphere

| Element | Behavior | Speed | Prompt Fragment |
|---------|----------|-------|-----------------|
| Snow falling | Gentle drift, random paths | Slow | `snow particles drift gently through frame` |
| Dust motes | Float in light beams | Very slow | `dust particles catch light, floating slowly` |
| Rain | Vertical streaks | Fast | `rain falls steadily through frame` |
| Fog/mist | Slow roll, obscures | Very slow | `mist drifts slowly across scene` |
| Smoke | Rising curl | Slow to medium | `smoke curls upward and dissipates` |
| Leaves | Tumbling, wind-driven | Variable | `leaves drift and tumble in the breeze` |

### Background Elements

| Element | Motion | Prompt Fragment |
|---------|--------|-----------------|
| Clouds | Slow drift | `clouds drift slowly in background` |
| Water | Ripples, reflection | `water ripples gently, reflections shimmer` |
| Curtains | Gentle sway | `curtains sway gently with breeze` |
| Plants | Subtle movement | `plants move subtly in ambient air` |

---

## Motion Speed Scale (1-10)

Use this scale for consistent speed descriptions:

| Level | Description | Real-world Reference | % of Normal |
|-------|-------------|----------------------|-------------|
| 1 | Nearly static | Minimal micro-movements only | 10% |
| 2 | Very slow | Meditation pace | 20% |
| 3 | Slow | Slow runway walk | 30% |
| 4 | Deliberate | Contemplative stroll | 40% |
| 5 | Normal slow | Relaxed walking | 50% |
| 6 | Normal | Conversational pace | 60% |
| 7 | Brisk | Purposeful walking | 70% |
| 8 | Quick | Hurried but not running | 80% |
| 9 | Fast | Running pace | 90% |
| 10 | Very fast | Sprint, rapid action | 100% |

---

## Keyframe Timing Templates

Use percentages for duration-agnostic timing:

### Enter → Center → Exit

```
0%:   Subject enters frame [direction]
50%:  Subject at frame center
100%: Subject exits frame [direction]
```

### Hold → Action → Hold

```
0%:   Subject holds starting pose
30%:  Action begins
70%:  Action completes
100%: Subject holds ending pose
```

### Approach → Focus → Retreat

```
0%:   Subject in background
40%:  Subject approaches camera
60%:  Subject at closest point
100%: Subject retreats or holds
```

### Turn/Reveal

```
0%:   Subject facing [direction A]
40%:  Turn begins
60%:  Turn completes
100%: Subject holds new position facing [direction B]
```

---

## Motion-Specific Negative Prompts

### For All Video Generation

```
no sudden movements, no jump cuts, no morphing artifacts, no unnatural poses,
no frozen frames, smooth continuous motion, no duplicate frames, no reverse motion,
maintain consistent appearance throughout
```

### For Image-to-Video (I2V)

```
no changing subject appearance, no altering clothing, no shifting background,
no lighting changes, exact preservation of start frame elements,
no morphing of face or body, maintain exact proportions
```

### For Frames-to-Video (F2V)

```
no jumping between poses, smooth interpolation only, no teleporting,
natural motion path between keyframes, consistent timing throughout
```

---

## Combining Templates

### Example: Fashion Walk Scene

```
Mode: I2V (Image-to-Video)
Camera: tracking shot, left-to-right, matching subject speed, eye level
Subject: walks slowly in runway style (speed 3), one foot in front of other
Secondary: minimal arm swing, neutral expression, chin slightly elevated
Micromotion: technical fabric catches light on movement, subtle hip sway
Timing: 0%: enters frame left → 50%: crosses frame center → 100%: exits frame right
Negative: no sudden movements, maintain exact appearance from start frame
```

### Example: Product Hero Shot

```
Mode: I2V (Image-to-Video)
Camera: slow dolly in, eye level, ease-in motion
Subject: stands in hero pose, wide stance
Secondary: maintains neutral expression, slight breathing motion
Micromotion: fabric subtle movement from ambient air, weight shifts subtly
Timing: 0%: wide shot establishes → 100%: medium close-up final frame
Negative: no changing background, maintain lighting consistency
```

### Example: Dramatic Reveal

```
Mode: I2V (Image-to-Video)
Camera: static, locked off, medium shot
Subject: slowly turns head to look back over shoulder
Secondary: eyes lead the motion, expression transitions to slight smile
Micromotion: hair follows head turn with slight delay, fabric settles after motion
Timing: 0%: facing away → 40%: turn begins → 60%: turn completes → 100%: holds pose
Negative: no body position change, head turn only, smooth motion
```
