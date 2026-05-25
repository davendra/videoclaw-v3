# Character Archetypes — description templates by role + species

Rich character descriptions (50–80 words) prevent identity drift across Seedance clips. Use these templates when creating via `vclaw video character-auto-create`.

## Required 8 fields

Every character description MUST cover:
1. **Age + build** — "6-year-old", "petite", "late 40s", "athletic lean"
2. **Ethnicity / species** — "Japanese", "South Asian", "white European", "fluffy white rabbit", "translucent spectral"
3. **Hair** — color, length, style — "shoulder-length brown, loose", "close-cropped silver"
4. **Eyes** — color, shape, expression — "round black eyes with rosy cheeks"
5. **Distinctive feature** — freckles, scar, jewelry, accessory — "antique pocket watch on chain"
6. **Outfit essentials** — "light blue cotton dress", "tactical black jumpsuit with HUD visor"
7. **Archetype anchor** — "human child", "organic animal — NOT robotic", "spectral samurai"
8. **Art/render style** — "Villeneuve cinematic photograph, neon-noir color grading"

## Templates by archetype

### Human — child (4-10 years)

```
{Name} is a {age}-year-old {ethnicity} {girl|boy} with {hair — length + color + style}, {eye color + shape}, {cheek/skin feature — rosy cheeks / freckles / soft olive skin}, wearing {specific outfit — color + garment + detail}, {build — petite / sturdy}, in {style — Villeneuve cinematic photograph, neon-noir color grading}.
```

**Examples:**
- `Komo is a 6-year-old Japanese girl with shoulder-length brown hair, round black eyes, rosy pink cheeks, wearing a light blue cotton dress, petite build, in Villeneuve cinematic photograph with neon-noir color grading.`
- `Riley is a 5-year-old mixed-race girl with curly light brown hair in two puffs, big hazel eyes, freckles across her nose, wearing a yellow dungaree over a white t-shirt and red canvas shoes, Miyazaki watercolor hand-painted aesthetic, pastel cheeks.`
- `Tam is a 10-year-old child with messy dark hair tied with a red ribbon, amber eyes, soft brown skin, wearing a patched blue tunic and travel satchel, carrying a small unlit bronze lantern, determined expression, Miyazaki watercolor, warm golden-hour lighting.`

### Human — young adult (15-30)

```
{Name} is a {age}s {ethnicity} {woman|man|person} with {hair — length + color + texture}, {eye color + shape + expression}, {skin quality + feature}, wearing {outfit — specific + layered + signature detail}, {build — lean / muscular / average}, {bearing — confident / watchful / casual}, in {style}.
```

**Examples:**
- `Elena is a late 20s woman with shoulder-length dark brown hair, pale skin, grey-blue eyes with slight dark circles, wearing a grey wool sweater and jeans, cautious observant expression, Fincher clinical-cold cinematography, desaturated palette.`
- `Cade is a late 30s man with weathered tan skin, sun-lined grey eyes, stubble, wearing a dusty long coat over a simple shirt and dark trousers, wide-brimmed hat, silent watchful expression, Tarantino retro-western with vintage film grain, saturated golden-hour palette.`
- `Wanderer is a late 20s androgynous figure with short black hair wet from rain, olive skin, soulful dark eyes, wearing a long black coat and red scarf, Wong Kar-wai intimate cinematography with neon reflection aesthetic, 35mm handheld feel.`

### Human — adult (30-60)

```
{Name} is a {age}s {ethnicity} {woman|man|person} with {hair — professional style + color}, {eyes — warmth + wisdom indicator}, {skin texture — smile lines / laugh lines / weathered}, wearing {outfit — professional / casual appropriate to role}, {bearing — authoritative / warm / focused}, {profession indicator if relevant}, in {style}.
```

**Examples:**
- `Dr-Rhea is a 40s woman with short grey-black hair, warm brown eyes, olive skin, wearing a grey utility jumpsuit with a NASA patch, kind thoughtful expression, Villeneuve epic cinematic aesthetic with teal-orange color grading.`
- `Sheriff-Ruiz is a 50s man with grey-streaked black hair, deep brown skin, silver mustache, piercing hazel eyes, wearing a tin star on a leather vest over a white shirt, calm authoritative presence, Tarantino retro-western.`
- `Sarah is a 30s mother with shoulder-length light brown hair in a casual ponytail, freckles, bright green eyes, wearing a white cotton pajama top, authentic warm expression, Spielberg golden-hour natural light aesthetic, photorealistic.`

### Human — elder (60+)

```
{Name} is a {age}s {ethnicity} {woman|man|person} with {hair — grey/white + remaining color}, {eyes — wisdom + warmth}, {skin — deep smile lines / weathered / dignified}, {signature feature — spectacles / beard / specific jewelry}, wearing {traditional or vocational outfit}, {bearing — patient / master-craftsman / wise}, in {style}.
```

**Examples:**
- `Master-Tan is a 70-year-old East Asian potter with deep smile lines, weathered hands, short grey hair neatly combed, wearing a grey linen apron over a simple blue shirt, gentle focused expression, natural light, Nolan cinematic realism, documentary photograph aesthetic.`
- `Baba-Nora is a 75-year-old Eastern European grandmother with silver hair in a bun, warm brown eyes with deep smile lines, wearing a wool shawl over a cotton dress, worn but clean, sitting by a woodstove, Spielberg golden-hour warmth.`

### Organic animal companion

```
{Name} is a {size} fluffy {species} with {ear style}, {nose feature}, {eye color + expression}, the loyal companion of {protagonist}. {Rendering style — aesthetic + lighting}. {Size anchor — companion-scale / fits in a child's arms}. {Key non-negotiable — organic living creature, NOT robotic, NOT metallic, NOT synthetic}.
```

**Why the "NOT" clauses:** LLM decomposer occasionally re-interprets species based on surrounding scene context (cyberpunk scene made Mochi "a small robotic creature with a metallic paw" in an earlier run). Explicit non-negotiables prevent drift.

**Examples:**
- `Mochi is a small fluffy white rabbit with long soft ears, pink nose, intelligent dark eyes, loyal companion of a young girl. Organic living creature, NOT robotic, NOT metallic. Cinematic neon-noir aesthetic, rim lighting, photorealistic fur detail, companion-scale (fits in a child's arms).`
- `Pip-Fox is a small red fox with bright intelligent amber eyes, white belly and chest, black-tipped ears, bushy tail with white tip, curious playful demeanor, the loyal companion of a young child. Organic wild creature, watercolor Miyazaki aesthetic with pastel palette, hand-painted details.`
- `Echo-Owl is a medium-sized snowy owl with pristine white feathers flecked with grey, piercing yellow eyes, solemn watchful bearing, companion of a fantasy wizard. Organic magical creature, Spielberg warm golden-hour lighting, cinematic close detail on feather texture.`

### Magical / spectral / spirit character

```
{Name} is a {base humanoid or creature description}, appearing as a {translucent | spectral | ethereal} figure, {distinguishing visual — glow / particle / aura}, {behavioral note — stoic / playful / mysterious}. {Primary rendering: style + lighting}. {Non-negotiable: {glow description stays consistent — e.g. soft neon-blue energy not shifting colors}}.
```

**Examples:**
- `Hiro is a young samurai boy, approximately 7-8 years old, fair skin tone, round face with soft slightly chubby cheeks, appearing as a translucent spectral figure flickering with soft neon-blue energy, traditional samurai armor with rope belt, silent and stoic. Villeneuve cinematic photograph with neon-noir color grading. Glow stays consistent neon-blue throughout.`
- `Pip-Spirit is a small mountain spirit with fox-like body made of glowing leaves and moss, two tiny antlers, large amber eyes, wispy green tail, hops with surprising grace. Miyazaki watercolor magical creature aesthetic, glows softly golden-green in dim light. Glow is warm organic, not harsh or mechanical.`
- `The Ferryman is a tall robed figure in dark grey hooded cloak obscuring face, holding a wooden pole, translucent mist wrapping around his feet, silent solemn bearing. Ridley-Scott epic cinematic with bronze-gold and steel-blue palette, backlit from behind with volumetric fog.`

### Robotic / android / tech-enhanced character

```
{Name} is a {age-equivalent adult} humanoid {robot | android | cyborg} with {primary material — brushed aluminum / chrome / matte titanium}, {facial feature — LED eyes / screen face / realistic bio-mesh}, wearing {minimal utility garment or exposed circuitry}, {behavioral — calculating / empathetic / evolving}. {Style}. {Non-negotiable: specify which tech markers to include — e.g., "circuit patterns on neck visible, not face"}.
```

**Examples:**
- `ARIA is a human-scale android with polished chrome chassis, cool blue LED eyes, minimalist matte black utility suit, precise economical movements, calculating but increasingly curious expression. Villeneuve cinematic, neon-noir lighting. Chrome finish stays consistent, no gold or copper.`
- `Ren-7 is a service robot with soft white matte-finish body, amber LED display face showing simple emoticons, compact 4-foot height with wheeled base, helpful eager bearing. Wes-Anderson symmetric pastel aesthetic, clean studio lighting.`

### Adversary class (plural — skip library entry)

Plural adversaries (Agents, Hunters, Guards, Shadows) don't get library entries. The preflight's coverage check correctly skips them. Seedance generates them fresh per clip.

For visual consistency across clips, describe them in the intent prose:

> "Three black-suited agents with glowing HUD visors rappel toward her apartment."

Key consistency hooks in the prose:
- Uniform color ("black-suited")
- Uniform feature ("HUD visors")
- Count ("three")

Seedance will render matching agents in each clip that mentions them.

### Singular antagonist (give library entry for consistency)

```
{Name} is a {age}s {ethnicity} {gender} with {hair — professional or menacing style}, {eyes — cold / intense / hidden}, {skin + feature — scar / tattoo / mark}, wearing {distinctive signature outfit}, {bearing — commanding / menacing / composed}, in {style}.
```

**Examples:**
- `Commander-Voss is a late 50s tall man with close-shaved grey hair, pale blue-grey eyes, prominent vertical scar through left eyebrow, wearing a dark military overcoat with silver rank insignia, commanding watchful presence, Villeneuve cinematic, teal-orange.`

## Rendering styles for characters

The character's style should match the video style. Use these combinations:

| Video style | Character description style line |
|---|---|
| villeneuve + neon-noir | "Villeneuve cinematic photograph, neon-noir color grading, 35mm anamorphic aesthetic" |
| villeneuve + teal-orange | "Villeneuve cinematic photograph, teal-orange color grading, epic wide-frame feel" |
| miyazaki + pastel-dream | "Miyazaki watercolor hand-painted illustration, pastel palette, soft warm diffused light" |
| miyazaki + golden-hour | "Miyazaki watercolor with warm golden-hour lighting, painterly storybook aesthetic" |
| nolan + desaturated | "Nolan IMAX practical photograph, desaturated with warm accents, grounded realism" |
| wes-anderson + pastel-dream | "Wes Anderson symmetric flat-front framing, pastel palette (mint/coral/mustard), meticulous composition" |
| spielberg + golden-hour | "Spielberg golden-hour god rays, warm amber highlights, sense of wonder" |
| fincher + ice-cold | "Fincher clinical precision, desaturated green-brown with ice-cold overlay, crushed blacks" |
| wong-kar-wai + neon-noir | "Wong Kar-wai handheld intimate cinematography, neon reflection aesthetic, step-printed slow-motion feel" |
| tarantino + vintage-film | "Tarantino retro film grain, saturated primaries, golden-hour palette, vintage aesthetic" |
| kubrick + ice-cold | "Kubrick 35mm one-point perspective, symmetrical tracking, cold sterile lighting" |
| ridley-scott + teal-orange | "Ridley Scott epic bronze-gold with steel-blue, smoke and dust atmosphere, historical grandeur" |

## Validation checklist before creating

Before running `vclaw video character-auto-create`:

- [ ] All 8 fields covered
- [ ] Description is 50–80 words (not 20, not 200)
- [ ] Species is locked with NOT clauses if organic
- [ ] Style matches the video's style + grading
- [ ] No placeholder words ("young", "person", "someone")
- [ ] Signature feature is specific (not "has a face")
- [ ] Outfit has color + garment type minimum
- [ ] Behavior/bearing hint included (not personality, just physical affect)

## After creation — verify the ref image

```bash
# View the character entry
vclaw video library clean --ids <id> --dry-run
# Opens: no direct preview, but ref URL is in output
```

If the auto-generated reference image doesn't match your imagination, PATCH the description:

```bash
vclaw video library clean --patch <id> --base-prompt "<refined description>"
```

Then regenerate the ref image by triggering a fresh character cache. (Library cache refreshes when character is re-fetched; happens automatically on next Director run.)

## Common mistakes

1. **Too vague.** "A bunny" — Seedance will produce a different bunny each clip. Fix: species + color + ear style + expression.
2. **No style line.** Character renders in Seedance's default photoreal style regardless of video style. Fix: include style explicitly.
3. **No archetype lock.** Character species drifts when surrounding context changes. Fix: "organic living creature, NOT robotic" for animals; "human child, NOT robot, NOT mannequin" for kids.
4. **Vague age.** "Young" → anything 8–35. Fix: specific age or tight range.
5. **No distinctive feature.** Character looks generic. Fix: one memorable detail per character.
6. **Description > 200 chars.** Too long; it becomes hard to inspect and maintain. Fix: tighten to 50–80 words.
7. **Description conflicts with art style.** "Photorealistic" in a Miyazaki video → reference image looks wrong. Fix: match character style to video style.
