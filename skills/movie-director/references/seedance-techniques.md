# Seedance 2.0 Prompt Engineering — techniques distilled from production

Every pattern here has been battle-tested through the Komo thriller runs AND sourced from the Higgsfield 15-skill production-grade library. Use these to tune intent prose and decomposed beats.

## The 2-Second Hook Rule

Seedance clips open strongest when the first 2 seconds grab attention. Build your scene 1 beat around one of these openers:

| Hook pattern | When to use | Example |
|---|---|---|
| **Extreme close-up → pull back reveal** | drama, fashion, ecommerce | "Extreme close-up of the jade pendant, camera slowly pulls back to reveal Komo asleep" |
| **Black to burst of light** | cinematic, drama, action | "Complete darkness, then a burst of light reveals the cityscape" |
| **Silhouette reveal** | cinematic, fashion, drama | "Dramatic backlit silhouette, light gradually shifts to reveal Hiro" |
| **Direct eye contact** | portrait, drama, social | "Direct intense eye contact with camera, commanding attention" |
| **Particle materialization** | product, 3D, magical | "Particles swirl and coalesce, slowly materializing into Hiro's staff" |
| **Spotlight snap** | product, fashion | "Darkness, then a single dramatic spotlight snaps on to illuminate" |
| **Slow-motion wind** | fashion, cinematic | "Slow-motion wind catches fabric and hair, billowing dramatically" |
| **Impact shockwave** | action, fight | "Explosive impact creates shockwave ripple, camera shakes" |
| **Speed ramp** | action | "Ultra-fast motion suddenly shifts to dramatic slow-motion as..." |
| **Splash freeze** | food, ecommerce | "Dynamic liquid splash frozen in mid-air, droplets suspended" |
| **Steam rise** | food | "Wisps of steam rise from the bowl, catching warm light" |
| **Reverse then snap forward** | action, fight | "Reverse motion of the fall, then snaps forward to normal speed" |

Platform tuning: TikTok 0.3s hook (faster), YouTube 2s hook (standard), Instagram 1s hook. Short-form loses viewers without a hook in the first 0.5 seconds.

## Camera Movement — Use Specific Phrases + Speeds

Vague: "fast pan", "zoom in", "camera moves". Seedance renders generically.
Specific: "slow dolly forward at 2 ft/s", "30°/s orbital", "10°/s tilt up". Seedance renders precisely.

### Dolly / Track
- `slow dolly forward` (2 ft/s) — reveal, approach, detail
- `slow dolly backward` (2 ft/s) — reveal, establish, pullback
- `smooth lateral tracking shot` (3 ft/s) — walk, movement
- `camera pushes in steadily` — tension, focus, drama
- `camera pulls back to reveal` — establish, product hero

### Pan / Tilt
- `slow horizontal pan left/right` (15°/s) — environment, scene
- `camera tilts upward` (10°/s) — reveal, scale, architecture
- `camera tilts downward` (10°/s) — reveal, product, detail

### Orbit / Rotation
- `smooth 360-degree orbital shot` (30°/s) — hero product, showcase
- `smooth 180-degree arc` (25°/s) — reveal, fashion
- `slow continuous orbital movement` (15°/s) — luxury, cinematic

### Crane / Boom
- `crane rises smoothly upward` — reveal, establish, epic
- `crane descends smoothly` — approach, intimate
- `boom up with rotation` — epic reveal

### Special
- `whip pan` — quick transition between actions
- `rack focus` (foreground to background) — attention shift
- `dolly zoom` (vertigo effect) — tension, disorientation
- `dutch tilt` (canted angle) — unease, chaos
- `aerial descend` — establish, reveal

## Lighting — Kelvin Temperatures Matter

Don't say "warm light". Say "3200K warm tungsten light". Seedance honors color temps.

| Preset | Kelvin | Mood |
|---|---|---|
| `golden_hour` | 3200K | Warm diffused, flattering, late afternoon |
| `studio_flash` | 5600K | Hard and crisp, commercial |
| `three_point` | 4000K | Classic portrait (key + fill + back) |
| `chiaroscuro` | 3500K | High-contrast dramatic light/shadow |
| `neon_night` | mixed | Saturated neons (teal, magenta, cyan) |
| `moonlit_cool` | 6500K | Cool blue night ambient |
| `volumetric_rays` | 4500K | Light shafts through fog/haze |
| `soft_diffused` | 4000K | Overcast, flat, even |
| `dramatic_backlight` | variable | Rim light separating subject from bg |
| `cool_clinical` | 5600K | Sterile, hospital, lab |
| `warm_ambient` | 3200K | Cozy, interior, intimate |
| `rim_light` | variable | Subject edge glow, silhouette |

Pair with director style for consistency:
- Villeneuve → moonlit_cool + volumetric_rays
- Miyazaki → golden_hour + soft_diffused
- Fincher → cool_clinical + chiaroscuro
- Spielberg → golden_hour + volumetric_rays
- Kubrick → cool_clinical + rim_light

## Timeline Templates (beat structure per clip)

### 5-second micro
`[0-1s] Hook / establishing beat`
`[1-3s] Development / reaction`
`[3-5s] Payoff / hand-off`

Good for: social hook clips, UGC testimonials, intercut montages.

### 8-second standard
`[0-2s] Hook`
`[2-5s] Development (action + mid)`
`[5-8s] Climax (reaction + cut ready)`

Good for: platform-optimized short-form, music video beats.

### 10-second narrative
`[0-2s] Hook`
`[2-5s] Setup / context`
`[5-8s] Development`
`[8-10s] Resolution beat`

Good for: ad units, documentary clips.

### 15-second Director default
`[0-5s] Establishing beat with continuity lead-in`
`[5-10s] Action development`
`[10-15s] Climax / hand-off to next clip`

This is what `buildTimestampedPrompt` generates. The LLM decomposer targets this 3-beat shape by default.

## Seedance 2.0 Three Control Levels

Seedance supports three prompt structures. Our Director defaults to FULL for chained continuity; LOOSE and IDEA are available for variants.

### FULL control (our default)
- Explicit timestamps
- "Cut to" between shots
- Image labels (@image_file_1 for first frame / chain anchor)
- Character sheet refs mandatory
- Example:
  ```
  @image_file_1 Continuing from the neon alley, Komo ducks into a lantern-lit shrine.
  [0-5s] Komo leans against a stone lantern, catching her breath.
  [5-10s] Mochi hops up to her shoulder; pendant starts glowing faintly.
  [10-15s] The pendant flares, scrollwork on the wall begins to light up.
  STYLE ANCHOR: Villeneuve cinematic style, neon-noir. No subtitles.
  ```

### LOOSE control (narrative)
- "Cut to" between shots but no timestamps
- Story-driven beat description
- Image labels still preferred
- Use when: pure narrative, no precise action timing

### IDEA control (high-level)
- No timestamps, no Cut to
- Single conceptual description
- Use when: abstract, mood-driven, experimental

## Anti-Patterns (auto-fixer catches these)

| Anti-pattern | Seedance response | Fix |
|---|---|---|
| Keyword soup: "beautiful, stunning, amazing, epic" | Averages to bland | Remove qualitative adjectives, use concrete visual nouns |
| Vague lighting: "nice lighting" | Default flat key | Specify Kelvin + direction: "3200K warm key from camera left" |
| Discrete actions: "she walks. she stops. she looks." | Choppy editing | Merge into continuous motion: "she walks in, stops, gaze drifts" |
| Weapon violence: "katana clashes, blood, impact" | Content filter REJECT | Soften: "energies intertwine, sparks fly, slow-motion ripple" |
| Body disintegration: "body shatters, breaks apart" | Content filter REJECT | Soften: "dissolves peacefully into starlight" |
| Real-person naming: "looks like Tom Cruise" | Content filter REJECT | Describe by attributes only |
| Cybernetic modifications on organic chars | Character drift | Use CHARACTER LOCKS in decomposer sys-prompt |

## Image Label Convention (Seedance 2.0)

Seedance resolves image references by position:
- `@image_file_1` — first frame / chain anchor (auto-inserted by Director)
- `@image_file_2`, `@image_file_3`, ... — character reference sheets
- Next — prop / environment refs

When chaining: `@image_file_1` is ALWAYS the previous clip's last frame (uploaded as Asset URI). Character refs follow.

## Character Reference Sheets (Anchor & Master)

Mandatory when human characters appear. Format:

```
Characters: {Name1} shown in image 2, {Name2} shown in image 3.
Anchor & Master: {Name1} is a {age + ethnicity + defining feature + outfit}.
{Name2} is a {age + ethnicity + defining feature + outfit}.
Maintain high character consistency — same facial features, same proportions, same outfit throughout.
```

Our Director `buildTimestampedPrompt` auto-injects this via `characterLocks` param.

## Material Library (40+ materials across 8 categories)

Include material keywords to trigger texture-aware rendering:

- **Metals:** brushed aluminum, polished chrome, weathered bronze, oxidized copper, gold leaf, steel
- **Glass:** frosted, crystal, tempered, stained glass, iridescent
- **Fabric:** silk, velvet, linen, denim, chiffon, leather, suede, wool, satin
- **Organic:** wood grain, bark, moss, lichen, bone, ivory, coral
- **Food:** buttery, syrupy, crusty, flaky, crisp, juicy, creamy, glossy glaze
- **Tech:** matte circuit board, OLED glow, brushed titanium, carbon fiber
- **Atmospheric:** volumetric fog, smoke tendrils, mist, steam, dust motes, embers
- **Stone:** marble veining, granite speckle, sandstone, concrete, river rock

Spec: "Glass decanter filled with amber liquid, crystal refractions, soft volumetric light through the glass" — Seedance will render the specific refraction pattern.

## Platform Optimizations

| Platform | Aspect | Hook timing | Pacing |
|---|---|---|---|
| TikTok | 9:16 | 0.3s hook | Fast — cut every 1–2s |
| Instagram Reels | 9:16 | 1s hook | Fast-medium — cut every 1.5–3s |
| YouTube Shorts | 9:16 | 1s hook | Medium — 2–4s |
| YouTube standard | 16:9 | 2s hook | Cinematic — 4–8s |
| LinkedIn | 1:1 / 16:9 | 3s hook | Slow — 5–10s |
| Twitter/X | 16:9 / 1:1 | 2s hook | Medium |
| Vimeo | 16:9 | 5s hook | Slow cinematic |

Set via `--platform` flag; production-executor routes to the right aspect + pacing defaults.

## Scene Continuation Tactics (chain manager)

When clip N→N+1, three approaches:

1. **Match-on-action** — clip N ends mid-action, clip N+1 picks up mid-action. Seedance reads last-frame → feels continuous.
2. **Match-on-location** — clip N ends with wide establishing of same space clip N+1 continues in. Feels like a single unbroken shot.
3. **Match-on-object** — clip N ends with close-up of object, clip N+1 opens wider on same object in different position.

Our Director's continuity lead-in phrases ("Continuing from…", "In the same instant…") cue Seedance to use technique #1 by default. Specify "location unchanged from previous" for #2.

## Sound Design Hints (audio direction)

Even though Seedance renders video only, the TTS narration pipeline picks up these cues for audio mixing:

- `[SFX: rain, distant thunder]` — ambient layer
- `[MUSIC: slow tension strings, 60 BPM]` — score instruction
- `[FOLEY: footsteps on wet stone, close]` — foley hint
- `[DIALOGUE: whisper, urgent]` — line-reading direction

Add to intent prose when tone is critical. ElevenLabs TTS honors the DIALOGUE cues; music/SFX run through Suno.

## Genre-Specific Sourcebooks (15 Higgsfield skills available)

Reference sourcebooks from the legacy Seedance skill pack (ported concepts, not a local script directory):

| File | Use for |
|---|---|
| `01-cinematic.md` | Short film, thriller, drama |
| `02-3d-cgi.md` | Product viz, VFX-heavy |
| `03-cartoon.md` | Animated shorts, kids |
| `04-comic-to-video.md` | Panel-to-motion |
| `05-fight-scenes.md` | Action combat (content-filter careful) |
| `06-motion-design-ad.md` | Motion graphics + typography |
| `07-ecommerce-ad.md` | Product ads |
| `08-anime-action.md` | Anime style |
| `09-product-360.md` | Hero product spin |
| `10-music-video.md` | Rhythm-driven, mood-heavy |
| `11-social-hook.md` | TikTok / Reels openers |
| `12-brand-story.md` | Narrative brand ads |
| `13-fashion-lookbook.md` | Editorial fashion |
| `14-food-beverage.md` | Culinary + beverage |
| `15-real-estate.md` | Property showcase |

These Markdown files contain full prompt templates per genre with 20+ reusable patterns each.
