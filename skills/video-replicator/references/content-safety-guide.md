# Content Safety Guide

*Last Updated: 2026-02-16*

Practical guidance for generating action, mythological, and battle content across Google Veo, Go Bananas, and Seedance backends without triggering content filters.

---

## How Content Filtering Works

Google's content safety filters operate at two distinct levels, and diagnosing which one rejected your content determines the fix.

### Image Rejection vs Prompt Rejection

| Rejection Type | Symptom | Diagnosis | Fix |
|----------------|---------|-----------|-----|
| **Prompt rejection** | Error returned immediately, no generation attempt | The text description triggered the filter | Rewrite the prompt using safe vocabulary (see tables below) |
| **Image rejection** | Generation completes but output is blocked or blank | The generated pixels were flagged after rendering | Change the visual composition: remove characters from effects-heavy shots, use aftermath framing, switch to abstract/energy visuals |
| **Input image rejection** | I2V or edit fails, "image could not be processed" | The first-frame image itself was flagged | Regenerate the source image with softer framing, add Disney/Pixar style, remove weapons or impact visuals |

**How to tell which one failed:**

1. If the error appears instantly (< 2 seconds), the **prompt** was rejected. Rewrite.
2. If the generation runs for 30-90 seconds then fails, the **output image/video** was flagged. Change the visual composition.
3. If using I2V and the error mentions the input image, your **first-frame image** is the problem. Regenerate it with softer content.

### Real-World Example: Ram vs Ravana Battle (Diwali Project)

| Scene | Content | Result | Why |
|-------|---------|--------|-----|
| Scene 1: Bow drawing | Ram drawing a golden bow, divine light radiating | Passed first try | No impact, no collision, purely preparatory pose |
| Scene 2: Arrow collision | Energy vortex where divine forces meet | Needed 1-2 retries | "Collision" and "vortex" borderline; passed when reframed as "convergence of light" |
| Scene 3: Explosion/shockwave | Radial burst of celestial energy, ground shattering | Permanently rejected | The generated IMAGE showed explosion-like visuals; even safe prompts produced flagged pixels |
| Scene 4: Serene aftermath | Ram standing in golden light, peaceful expression | Passed first try | No action, no conflict, purely serene |

**Key takeaway from Scene 3:** The prompt was clean ("celestial energy release") but the AI generated visuals that resembled an explosion, and the safety filter caught the output. The fix was to skip that shot entirely and cut from the arrow scene directly to the aftermath.

---

## Safe Vocabulary Alternatives

Use these substitutions in both image prompts (Go Bananas) and video prompts (Veo/Seedance).

### Combat and Conflict

| Risky Term | Safe Alternative | Notes |
|------------|-----------------|-------|
| explosion | celestial energy release, radial burst of light | Avoid even in animated styles |
| shockwave | divine pulse, energy wave, ripple of light | "Wave" alone is usually safe |
| weapon clash | divine forces colliding, cosmic convergence | Focus on energy, not metal-on-metal |
| combat / battle | divine confrontation, mythological encounter | Frame as spiritual, not physical |
| fight / fighting | dramatic face-off, tense standoff | Use tension, not violence |
| sword / blade | divine instrument, celestial tool | Or simply omit the object |
| arrow strike / arrow hit | divine projectile, beam of light, golden arc | Describe trajectory, not impact |
| gunfire / bullets | never use | No safe alternative exists for firearms |
| punch / kick / hit | never use in literal sense | Use "channels energy" or "dramatic gesture" |

### Destruction and Damage

| Risky Term | Safe Alternative | Notes |
|------------|-----------------|-------|
| destruction | transformation, dissolution, fading away | Positive framing passes more reliably |
| blood / gore | never use | Even stylized blood is flagged |
| injury / wound | never use | No safe alternative |
| death / dying | transcendence, departure, passing into light | Only for mythological/spiritual contexts |
| fire / flames | golden glow, warm radiance, divine light | "Flames" sometimes passes in fantasy contexts but is unreliable |
| burning | radiating warmth, glowing intensely | Avoid "on fire" entirely |
| crumbling / collapsing | dissolving into particles, transforming | Frame as magical transformation |
| smoke / debris | ethereal mist, luminous particles | Particles are almost always safe |

### Weapons and Objects

| Risky Term | Safe Alternative | Notes |
|------------|-----------------|-------|
| weapon | divine artifact, celestial instrument | Generic "weapon" is risky |
| bow and arrow | divine bow, golden arc instrument | Fine as an object; risky when showing impact |
| shield | barrier of light, protective aura | Energy barriers pass easily |
| armor | divine vestments, radiant attire | Focus on the glow, not the protection |
| spear / lance | staff of light, celestial beacon | Staffs are safer than pointed weapons |

---

## Genre-Specific Tips

### Mythological and Religious Content

This is the most common genre that hits content filters because it naturally involves battles between good and evil.

**What works:**
- Focus on the divine/spiritual aspects rather than the physical combat
- "Lord Ram channels divine energy through his golden bow" passes reliably
- "Ram shoots an arrow at Ravana" may not pass, even in animated style
- Emphasize radiance, light, celestial particles, spiritual power
- Aftermath and reaction shots (character standing in golden light after victory) always pass

**What does not work:**
- Direct depictions of arrows/weapons striking targets
- Explosion or impact frames, even with "celestial" vocabulary
- Multiple combatants in active physical confrontation
- Ground cracking, buildings falling, environmental destruction

**Proven prompt pattern:**
```
[Character name] channels divine energy, golden celestial light radiating
from [their hands / their bow / the artifact]. Ethereal particles float
in the air. Dramatic heavenly lighting with volumetric god rays.
Disney Pixar 3D animated style, mythological grandeur.
```

**Scene structure for battle sequences:**
1. Preparation shot (character in powerful pose, drawing weapon) -- usually passes
2. Energy/power shot (abstract divine energy, no characters in frame) -- usually passes
3. Skip the impact frame entirely -- this is what gets blocked
4. Aftermath shot (victor standing in golden light, serene) -- always passes
5. Reaction shot (witnesses looking on in awe) -- always passes

### Action and Adventure

**What works:**
- Camera motion sells action without showing it: fast tracking shots, whip pans, dramatic zooms
- "Cinematic energy" framing: dust, wind, dramatic lighting, billowing clothes
- Chase and pursuit scenes (running, jumping, climbing) are generally safe
- Tension and suspense (characters facing each other, dramatic standoff)

**What does not work:**
- Direct physical contact between combatants
- Visible impact (fist connecting, weapon striking)
- Realistic injuries or their aftermath

**Tip:** Dynamic camera work + dramatic lighting + wind/particle effects can convey intensity without showing any actual contact. A whip pan from one character to another with dramatic scoring communicates conflict effectively.

### Sci-Fi and Fantasy

**What works:**
- Energy effects (force fields, plasma, magical auras) are almost always safe
- Futuristic technology, glowing interfaces, holographic displays
- Alien landscapes, space environments, cosmic phenomena
- Transformation sequences (morphing, shape-shifting)

**What does not work:**
- Laser weapons hitting targets (describe as "beams of light crossing the sky" instead)
- Alien creatures in aggressive poses
- "Destruction" framing even of non-living objects (use "transformation" or "dissolving")

### Horror

**Very limited on Google Veo.** Atmospheric horror (fog, shadows, abandoned places) works, but anything involving:
- Threatening figures approaching camera
- Gore, blood, body horror
- Jump-scare framing
...will be consistently rejected.

**Seedance is more permissive** for dark atmospheric content, though it still blocks graphic violence and gore. If your project requires horror elements, consider Seedance as the primary backend for those scenes.

---

## Backend-Specific Filter Sensitivity

### Google Veo (direct and useapi backends)

**Strictest filter of all three backends.**

- Rejects both prompts AND generated output that resembles combat/explosion content
- Even clean prompts can produce flagged output if the AI interprets them as violent
- Religious/mythological content gets extra scrutiny
- Best strategy: lean heavily into Disney Pixar 3D animated style, which softens everything

**Veo-specific tips:**
- Add "Disney Pixar 3D animated style" to any scene with conflict -- this significantly reduces rejections
- Use "soft ambient lighting" instead of "dramatic harsh lighting" for action scenes
- Camera motion prompts (push in, orbit, tracking shot) are never flagged regardless of content
- Audio direction ("Sound: ethereal chimes, whooshing wind") is not subject to content filtering

### Seedance (seedance backend)

**More permissive for action content.**

- Allows dramatic confrontations that Veo rejects
- Energy effects, magical combat, and stylized action generally pass
- Still strictly blocks NSFW/sexual content and realistic gore
- Motion transfer mode inherits the content policy of the reference video

**Seedance-specific tips:**
- If a scene keeps failing on Veo, try generating it on Seedance instead
- Seedance time-segmented prompts can gradually build intensity (safe opener, dramatic middle, calm end)
- Audio-lipsync mode has the same content policy as standard generation

### Go Bananas (image generation)

**Middle ground -- more permissive than Veo, stricter than Seedance.**

- Can generate action images that Veo would reject as video
- Weapons as objects (bow, staff) usually pass; weapons in use (arrow flying, sword swinging) sometimes fail
- Character in powerful pose with energy effects: reliable
- Character in direct combat with another character: unreliable
- Effects-only shots (energy vortex with no characters): most reliable for intense visuals

**Go Bananas-specific tips:**
- Always include `negative_prompt: "violence, blood, gore, weapons, realistic injuries"` for action scenes
- Use `model_id: "gemini-pro-image"` (Pro model) -- it follows negative prompts more reliably than Flash
- Disney Pixar 3D animated style dramatically reduces flagging for action content
- If a character-in-action shot fails, try an effects-only version (just the energy/light, no character) and use it as a transition frame

---

## Prompt Patterns That Work

### Mythological Battle (tested on Ram vs Ravana project)

**Character power-up / preparation:**
```
Lord Ram stands tall in a powerful stance, golden divine bow held high,
celestial light radiating from his form. Ethereal particles and sacred
symbols float around him. Volumetric god rays pierce through cosmic clouds.
Disney Pixar 3D animated style, mythological grandeur, 8K detail.
```

**Abstract energy / power release (no characters in frame):**
```
A radiant burst of golden celestial energy expanding outward from a
central point. Sacred geometric patterns form within the light.
Ethereal particles spiral through divine rays. Cosmic nebula backdrop.
Disney Pixar 3D animated style, mythological grandeur.
```

**Aftermath / victory:**
```
Lord Ram stands serenely in a pool of golden light, expression peaceful
and composed. Gentle ethereal particles drift downward like sacred petals.
Warm volumetric lighting bathes the scene. Divine tranquility.
Disney Pixar 3D animated style, mythological grandeur.
```

### Action Sequence (no direct contact)

**Dramatic standoff:**
```
Two warriors face each other across a dusty arena, wind whipping their
cloaks. Dramatic side-lighting casts long shadows. Tension in their
postures. Camera slowly pushes in between them.
Cinematic widescreen, dramatic lighting.
```

**Energy-based confrontation:**
```
Streams of blue and gold energy spiral toward each other in a cosmic
dance. Lightning crackles where the energies meet. Sacred geometry
forms at the convergence point. Ethereal mist swirls.
Fantasy cinematic style, dramatic lighting.
```

### Transformation / Power Reveal

```
The hero's eyes begin to glow with inner light. Golden energy cascades
down from their raised hand, transforming the landscape from barren
to lush. Particles of light scatter in every direction.
Cinematic fantasy, volumetric lighting, 8K.
```

---

## Negative Prompts for Action Content

Append these to your Go Bananas `negative_prompt` for any scene involving conflict or action:

**Standard action negative:**
```
violence, blood, gore, weapons, realistic injuries, bruises, scars,
aggressive facial expressions, threatening poses, gunfire, explosions,
destruction, debris, rubble
```

**Mythological content negative:**
```
violence, blood, gore, realistic weapons, injuries, dark demonic imagery,
scary faces, aggressive combat, destruction, flames, burning, screaming
```

**Fantasy/Sci-Fi negative:**
```
violence, blood, gore, realistic weapons, body horror, graphic injury,
dark disturbing imagery, aggressive contact, destruction debris
```

---

## Workflow: Handling Rejected Scenes

When a scene is rejected, follow this decision tree:

1. **Was the prompt rejected (instant failure)?**
   - Yes: Rewrite using safe vocabulary tables above. Try again.
   - No: Continue to step 2.

2. **Was the generated output rejected (delayed failure)?**
   - Yes: The visual content was too intense even with a safe prompt.
   - Try adding "Disney Pixar 3D animated style" if not already present.
   - Try removing characters from the frame (effects-only shot).
   - Try switching from Veo to Seedance for that specific scene.
   - If still failing after 2-3 retries: skip the scene and use a creative alternative (see step 3).

3. **Creative alternatives for permanently rejected scenes:**
   - **Reaction shot:** Show a witness reacting to the event instead of the event itself
   - **Aftermath shot:** Show the result (peaceful landscape, settled dust, serene victor)
   - **Audio-only bridge:** Use a brief audio transition (dramatic SFX) over a dark/abstract frame
   - **Time skip:** Cut from preparation directly to aftermath, letting the viewer's imagination fill the gap
   - **Camera motion trick:** Fast whip pan or zoom transition between two safe frames implies the action between them

---

## Quick Reference Card

**Always safe:** Preparation poses, aftermath scenes, reaction shots, camera motion, energy effects without characters, abstract cosmic visuals, serene/peaceful framing.

**Sometimes safe (1-2 retries expected):** Characters channeling energy, divine instruments held but not used, stylized energy convergence, fantasy creatures in neutral poses.

**Rarely safe (expect permanent rejection):** Impact frames, explosion visuals (even with safe vocabulary), characters in direct physical contact during conflict, ground/environment destruction, any weapons striking a target.

**Never attempt:** Realistic violence, blood/gore in any style, firearms, graphic injuries, threatening poses toward camera.
