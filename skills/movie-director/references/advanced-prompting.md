# Advanced Prompting — production-grade patterns for Seedance 2.0

Reference for users who want deeper control than the interview provides. Every pattern is tested in production.

## The 3-Beat Grammar

Every 15s Director clip decomposes into 3 beats that PROGRESS (not repeat). The LLM decomposer enforces this; understanding it helps write intent prose that decomposes well.

### The progression pattern

```
[0-5s]  ESTABLISH + LEAD-IN      — continuity reference + scene establishing
[5-10s] DEVELOP                  — action complication or new detail
[10-15s] CLIMAX / HAND-OFF       — beat payoff + soft transition to next clip
```

### Write intent prose that decomposes well

Good (decomposable):
> "Komo slips on wet tile, catches a ledge, then drops to a lower roof."
> → 3 clear beats: slip / catch / drop.

Bad (one-note, LLM padding):
> "Komo falls."
> → LLM has nothing to decompose; produces filler.

Rule: name 3 distinct actions per scene in the intent prose, even briefly. Give the LLM raw material.

### Continuity lead-in phrases (for scene N > 1)

- `Continuing from the [previous scene location]...`
- `After the [previous beat]...`
- `In the same instant...`
- `Still in the [location]...`
- `Moments later...`
- `As [previous action] ends...`

The decomposer auto-picks one. For manual control, explicitly include it in the intent prose for that scene.

## Shot Framing Vocabulary

Seedance respects specific shot types. Use these words, not generic ones:

| Word | Effect |
|---|---|
| `extreme close-up` | eye, hand, detail — 1-5% of frame |
| `close-up` | face, object — 10-30% of frame |
| `medium close-up` | shoulders to head |
| `medium shot` | waist up |
| `wide shot` | full body in environment |
| `extreme wide shot` / `establishing shot` | landscape scale |
| `over-the-shoulder` | behind subject looking at something |
| `POV shot` | from character's eyes |
| `insert shot` | cutaway detail |
| `reaction shot` | response to another action |
| `tracking shot` | camera following subject |
| `handheld shot` | organic, shakier |
| `locked-off shot` | tripod, static |
| `Dutch angle` | canted, unease |
| `low angle` | looking up — heroic, dominating |
| `high angle` | looking down — vulnerable, small |
| `bird's eye view` | straight down |
| `worm's eye view` | straight up |

## Camera Movement Grammar

Combine verb + object + speed + modifier:

`[verb] [subject/target] at [speed], [modifier]`

Examples:
- `slow dolly forward toward Komo at 2 ft/s, keeping her centered`
- `orbit 180° around the pendant at 25°/s, revealing Hiro behind`
- `whip-pan from Komo to the agent, 60°/s, motion blur`
- `slow tilt up from boots to face at 10°/s, revealing her determination`

Avoid: `the camera moves cool`, `zooms in fast`, `shakes around`. These are too vague.

## Lighting Grammar

Combine direction + type + temperature + intensity:

`[direction] [type] light at [Kelvin]K, [modifier]`

Examples:
- `back-lit silhouette from 5600K studio flash, harsh edge rim`
- `soft top-down from 4000K three-point key, filled from camera-right`
- `volumetric god rays from 4500K backlit window, dust motes visible`
- `golden-hour side light from 3200K warm tungsten, long shadows toward camera`

## Material + Texture Triggers

To make Seedance render specific textures, name them:

| Trigger | Effect |
|---|---|
| `brushed aluminum` | visible brush lines, cool metallic |
| `polished chrome` | mirror-bright, reflective |
| `weathered bronze` | oxidized patina, green-brown |
| `silk` | subtle sheen, drape |
| `velvet` | plush, light-absorbing |
| `linen` | matte, slightly coarse weave |
| `denim` | visible warp, indigo fade |
| `chiffon` | translucent, floaty |
| `frosted glass` | diffused, soft refraction |
| `buttery leather` | soft gloss, supple |
| `wood grain` | visible rings + knots |
| `volumetric fog` | visible light shafts |
| `smoke tendrils` | wispy upward curls |
| `dust motes` | backlit floating particles |

Include in prose: "She runs her hand along the brushed aluminum handle" — Seedance will render the brush marks.

## Sound Design Cues (for narration + mix pipeline)

Include in scene descriptions to guide ElevenLabs TTS + Suno music + post ffmpeg mix:

```
[SFX: rain drumming on rooftop, distant thunder]
[MUSIC: slow tension strings, 60 BPM, minor key]
[FOLEY: footsteps on wet stone, close]
[DIALOGUE: Komo whispers urgently, breath audible]
```

The production-executor parses these and routes them through the correct audio pipelines.

## Character Reference Anchoring

When a character appears, include their 1-line anchor in the scene description:

> "Komo — 6yo Japanese girl, shoulder-length brown hair, light blue dress — slips on wet tile at the rooftop edge."

The LLM decomposer's character-lock block already includes these, but redundancy is OK. Seedance pays attention to the prose even beyond the media_files refs.

## Filter-Safe Rewrites

| Prose idea | Safe phrasing |
|---|---|
| "katana clashes with sword" | "radiant energies intertwine in slow-motion" |
| "body shatters into pieces" | "dissolves peacefully into starlight" |
| "stabs the enemy" | "deflects the attack" |
| "fires a gun" | "aims a non-lethal pulse device" |
| "blood spurts" | NEVER — always imply cost through reaction shots |
| "taser" | "non-lethal pulse device" |
| "corpse on ground" | "fallen figure" or cut away |
| "strangles" | "restrains" |
| "explodes" | "erupts in a burst of light" (fire-only, not gore) |

## Sequence-Level Tactics

### Match-on-action (chain manager default)

Clip N ends mid-action; clip N+1 picks up at the same action. Seedance interprets the last-frame as the continuation anchor.

Use when: chase, dance, fight, gesture, motion-through-frame.

### Match-on-location

Clip N ends with establishing wide of the space. Clip N+1 opens in the same space from a different angle. Feels like one unbroken location.

Use when: dialogue scene, slow exploration, environment reveal.

### Match-on-object

Clip N ends with close-up of object. Clip N+1 opens with different framing of the same object.

Use when: object handoff, magic artifact, product showcase.

### Contrast cut

Clip N ends on one emotion/environment. Clip N+1 opens with the opposite — intentional rupture.

Use when: surprise, reveal, tonal shift. Skip the continuity lead-in for this clip.

## Genre-Specific Hook Recipes

### Action thriller cold open
> Extreme close-up of the target object, pulls back to reveal city scale, then shift to protagonist asleep — tension in peace.

### Storybook opening
> Wide watercolor establishing, camera slowly descends through clouds or window, settles on the small protagonist's ordinary moment.

### Documentary day-in-life
> Static wide of empty location. Door opens. Subject enters with routine gesture. No cut.

### UGC ad hook
> Direct eye contact with the camera, messy hair, yawn, laugh. First 0.3s must have movement.

### Music video drop
> Extreme close-up of detail (eye, skin, reflected neon). Hold 1 beat. Music drops → whip-pan to wider mood.

### Horror opening
> Long static wide of normalcy. Small anomaly in corner of frame the audience may or may not notice. Hold.

### Sci-fi world-establish
> Epic wide of alien landscape. Slowly descending camera. Single human figure dwarfed by scale.

### Fantasy quest
> Over-the-shoulder of protagonist looking at distant horizon. Wind in their hair. Music swells.

### Western arrival
> Extreme wide of horizon. Single dot approaching. Dust cloud grows. Hat emerges.

### Romance meet-cute
> Hands reach for the same object. Eye contact. Held beat. One pulls back smiling.

## Debugging a Bad Clip

When one clip renders wrong:

1. **Check the prompt** — grep storyboard.md for the clip. Verify beats are distinct.
2. **Check media_files** — was character ref or last-frame missing? Check runner log for Asset URIs.
3. **Check style anchor** — is it present at the end of the prompt?
4. **Check content-filter risk** — any hazardous verbs? Auto-fix should have caught; if not, soften manually.
5. **Check character coverage** — is a named character referenced but not bound?

If storyboard.md is clean, the failure is Seedance-side — polling timeout, content filter, or rate limit. Accept or retry manually.

## When to Use Each Seedance Control Level

| Level | When | Example |
|---|---|---|
| FULL (timestamps + Cut to + image labels) | default for all Director-mode clips | everything from the Komo thriller |
| LOOSE (Cut to, no timestamps) | narrative-heavy, no precise timing needed | conversation scenes, mood pieces |
| IDEA (conceptual) | abstract/experimental; Seedance has full creative license | art film, dream sequences, transitions |

Director mode defaults to FULL for continuity. For a mood-driven music video, consider passing `SEEDANCE_CONTROL_LEVEL=loose` (not yet implemented in the control flags, but in the roadmap).

## Performance Tips

- **Keep prompts under ~500 chars per clip.** Longer prompts confuse Seedance.
- **Don't repeat character descriptions across every beat.** The character_lock handles it.
- **Color + lighting + camera once per clip, not per beat.** Anchor them in the style line.
- **Explicit > implicit.** "3200K warm tungsten" beats "soft warm light".
- **Specific verbs > general verbs.** "Slips" beats "falls". "Whip-pans" beats "moves fast".
- **Name locations.** "neon-lit market alley" beats "a street".

## Example — tight, well-decomposable 15s clip

Bad (too vague):
> Scene 5: A chase happens.

Better:
> Scene 5: Komo leaps across a wet rooftop gap.

Best (rich, decomposable, specific):
> Scene 5: After the hallway sprint, Komo leaps across a gap between two rain-slicked rooftops high above Neo-Tokyo's neon. [0-5s: preparation — crouches at edge] [5-10s: mid-leap — arms extended, coat billowing] [10-15s: lands and rolls — grit on hands]. Villeneuve wide anamorphic, neon-noir, moonlit cool 6500K, rain 3200K neon reflections. [SFX: wind rushing, distant siren] [MUSIC: tension strings build].

The decomposer takes the mid section verbatim and produces:

```
[0-5s] Continuing from the hallway sprint, Komo crouches at the edge of the rain-slicked rooftop, sizing up the gap to the next building.
[5-10s] Wide symmetrical shot — Komo mid-leap across the gap, arms extended, coat billowing against Neo-Tokyo's neon backdrop, rain streaking in the anamorphic frame.
[10-15s] Komo lands hard on the opposite rooftop and rolls forward, palms scraping wet concrete, pendant swinging.
STYLE ANCHOR: villeneuve cinematic style, neon-noir color grading. No subtitles, no watermarks, no on-screen text.
```

That's what Seedance sees. Three distinct beats. Anchored style. Clear continuity.
