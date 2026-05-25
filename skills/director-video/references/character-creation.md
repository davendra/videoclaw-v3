# Character Creation — description templates that keep Seedance on-model

Vague `base_prompt`s are the #1 cause of identity drift across clips. Before creating a character in Go Bananas, draft a 50–80 word description that locks ALL of these:

- **Age + build** ("6-year-old girl, petite", "40-year-old man, lean athletic")
- **Ethnicity / skin tone** ("Japanese", "warm brown skin", "pale freckled")
- **Hair** (color, length, style — "shoulder-length brown, loose")
- **Eyes** (color + shape — "round black eyes", "narrow green eyes")
- **Distinctive feature** (scar, freckles, jewelry, accessory)
- **Outfit essentials** ("light blue dress", "tactical black jumpsuit with HUD visor")
- **Species/archetype anchors** ("human girl", "fluffy white rabbit", "spectral samurai in traditional armor")
- **Art/render style** ("Villeneuve cinematic photograph, neon-noir color grading")

## Templates by archetype

### Human protagonist (child)

```
{Name} is a {age}-year-old {ethnicity} {girl|boy} with {hair length + color + style}, {eye color + shape}, {skin feature — rosy cheeks / freckles}, wearing {specific outfit — colour + garment + detail}, {build — petite / lean}, in {style — Villeneuve cinematic photograph, neon-noir color grading}.
```

**Example (Komo):**
> Komo is a 6-year-old Japanese girl with shoulder-length brown hair, round black eyes, rosy pink cheeks, wearing a light blue dress, petite build, in Villeneuve cinematic photograph, neon-noir color grading.

### Organic companion (animal)

```
{Name} is a small fluffy {species} with {ear style}, {nose color}, {eye color + expression}, the loyal companion of {protagonist}. {Rendering style}. {Size anchor — "companion-scale, fits in a child's arms"}. {Key non-negotiable — NOT a robot, NOT metallic}.
```

**Example (Mochi):**
> Mochi is a small fluffy white rabbit with long soft ears, pink nose, intelligent dark eyes, loyal companion of a young girl. Cinematic neon-noir aesthetic, rim lighting, 35mm anamorphic rendering, photorealistic fur detail, companion-scale (fits in a child's arms). Organic living creature, NOT robotic, NOT metallic.

**Why the "NOT" clauses:** The LLM decomposer will re-interpret species based on surrounding scene context (cyberpunk scenes made Mochi "a small robotic creature with a metallic paw" in an earlier run). The character-lock block in `buildTimestampedPrompt` enforces this — but a redundant NOT clause in the base_prompt adds belt-and-braces.

### Spectral / mystical mentor

```
{Name} is a {age + archetype — e.g. "young samurai boy, 7-8"} with {face / features}, appearing as a {translucent / spectral / ethereal} figure, {distinguishing visual — neon-blue energy glow / starlight particles / soft focus aura}. {Art style}. {Behavioral note — stoic, silent, points with hand}.
```

**Example (Hiro):**
> Hiro is a young samurai boy, approximately 7-8 years old, fair skin tone, round face with slightly chubby cheeks, appearing as a translucent spectral figure, flickering with soft neon-blue energy. Traditional samurai armor. Silent, stoic. Villeneuve cinematic photograph, neon-noir color grading.

### Adversary class (plural — "Agents", "Hunters")

Do NOT create a library character for plural adversaries. The preflight's coverage check skips plurals intentionally — they're role classes, not individuals. Let Seedance generate them fresh from the scene prompt. They'll look consistent enough across clips because they share the setting + style anchor.

## Creation command

```bash
cat > /tmp/char_input.json <<'EOF'
[
  {
    "name": "<Name>",
    "description": "<50-80 word description — follow template above>",
    "style": "<matches video style — e.g. 'Villeneuve cinematic photograph, neon-noir color grading'>"
  }
]
EOF

vclaw video character-auto-create \
  --project <slug> \
  --input /tmp/char_input.json

# Output JSON contains the created or reused Go Bananas ids
```

## Editing an existing character's description

If the character exists but the description is too vague:

```bash
# PATCH via the library-clean CLI
vclaw video library clean \
  --patch <id> \
  --base-prompt "<new 50-80 word description>"
```

## Gotchas

1. **Age matters for scale.** "6-year-old girl" vs "young woman" → Seedance renders Komo differently even if everything else is identical. Be specific.

2. **Don't mix style registers.** If the video is Miyazaki watercolor, don't put "photorealistic" in the character description. The character ref image gets generated in the described style; mismatch = weird final frames.

3. **Every character references its art style.** Both the video style (in the description) AND the `style` field passed to `vclaw video character-auto-create`. Redundant but keeps the reference image aligned.

4. **Verify the reference image before production.** After creation, look at the Go Bananas library entry. If the auto-generated reference image doesn't look like what you imagined, PATCH the description and regenerate BEFORE burning Seedance on 14 clips that anchor to a wrong ref.

5. **Character IDs are permanent.** Once created, the ID stays. Don't delete unless you're SURE it's polluted.
