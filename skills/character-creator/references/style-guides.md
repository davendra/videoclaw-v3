# Character Style Guides

Detailed prompt patterns for creating consistent characters in popular visual styles.

## 3D Disney Pixar Animated

**Portrait prompt pattern:**
```
3D Disney Pixar animated character portrait of [NAME]. [AGE DESCRIPTION] with [SKIN TONE],
large expressive Pixar-style eyes, [EXPRESSION]. [OUTFIT DETAILS]. [BUILD/BODY TYPE].
[PROPS/ACCESSORIES]. Rich warm lighting, detailed Pixar 3D rendering with subsurface
scattering on skin. Clean studio background, character portrait framing.
```

**Negative prompt:** `realistic, photorealistic, 2D, flat, anime, multiple characters, text, watermark`

**Key rendering cues:**
- "subsurface scattering on skin" — gives Pixar's signature soft skin glow
- "large expressive Pixar-style eyes" — the hallmark of Pixar character design
- "detailed Pixar 3D rendering" — triggers the right rendering style
- "rich warm lighting" — Pixar's signature lighting warmth

**Example — heroic character:**
```
3D Disney Pixar animated character portrait of Lord Ram (Hindu deity Rama).
Young heroic prince in his early 20s with blue-tinted divine skin, large expressive
Pixar-style eyes, noble serene expression, soft smile. Wearing ornate golden crown
(mukut) with jewels, royal Indian silk dhoti and angavastra in saffron and gold,
sacred thread across chest. Athletic build. Holding an ornate golden bow. Rich warm
lighting, detailed Pixar 3D rendering with subsurface scattering on skin. Clean
studio background, character portrait framing.
```

**Example — villain character:**
```
3D Disney Pixar animated character portrait of Ravana (Ravn), the powerful demon king.
Mature imposing figure in his 40s with dark complexion, sharp angular features, thick
black eyebrows, intense fierce golden eyes, confident menacing smirk. Ten heads shown
subtly behind the main face as shadowy silhouettes. Wearing elaborate golden crown
with demon motifs, heavy ornate golden armor with ruby gemstones over dark royal robes.
Muscular broad-shouldered build. Rich dramatic lighting with warm golden rim light,
detailed Pixar 3D rendering. Clean studio background, character portrait framing.
```

## Anime / Manga Style

**Portrait prompt pattern:**
```
Anime character portrait of [NAME] in [ANIME STYLE REFERENCE] style. [AGE DESCRIPTION]
with [HAIR STYLE AND COLOR], [EYE COLOR AND STYLE], [EXPRESSION]. [OUTFIT DETAILS].
[BUILD/BODY TYPE]. [PROPS/ACCESSORIES]. Dynamic anime lighting with rim light,
detailed cel-shaded rendering. Clean gradient background, character portrait framing.
```

**Negative prompt:** `realistic, photorealistic, 3D render, CGI, text, watermark, blurry, low quality`

**Key rendering cues:**
- "cel-shaded rendering" — triggers anime flat-shading style
- "dynamic anime lighting with rim light" — anime's signature backlighting
- Reference specific anime styles: "Studio Ghibli", "Shonen Jump", "Makoto Shinkai"

**Example:**
```
Anime character portrait of Sakura in modern shonen anime style. Young woman in her
early 20s with long flowing cherry-blossom pink hair, bright emerald green eyes with
anime sparkle, determined confident expression. Wearing a sleek black combat outfit
with red accents, armored gauntlets, utility belt. Athletic toned build. Holding a
glowing katana. Dynamic anime lighting with golden rim light, detailed cel-shaded
rendering. Clean gradient background, character portrait framing.
```

## Photorealistic / Cinematic

**Portrait prompt pattern:**
```
Cinematic photorealistic character portrait of [NAME]. [AGE AND ETHNICITY], [SKIN DETAILS],
[EXPRESSION]. [HAIR DETAILS]. [OUTFIT DETAILS]. [BUILD]. [PROPS].
Shot on Arri Alexa, 85mm f/1.4 lens, shallow depth of field, professional studio
lighting with key light and fill. Clean dark background, character portrait framing.
```

**Negative prompt:** `cartoon, anime, 3D render, illustration, CGI, painting, text, watermark`

**Key rendering cues:**
- Camera/lens specs: "Shot on Arri Alexa, 85mm f/1.4 lens"
- "shallow depth of field" — cinematic bokeh
- "professional studio lighting with key light and fill"
- Skin detail cues: "visible pores", "natural skin texture"

## Children's Illustration / Storybook

**Portrait prompt pattern:**
```
Children's storybook illustration of [NAME]. [AGE] [ANIMAL/HUMAN] with [DISTINCTIVE FEATURES],
[EXPRESSION], [OUTFIT]. Soft watercolor textures, rounded friendly shapes, warm pastel
color palette. Clean white background, character portrait framing.
```

**Negative prompt:** `realistic, photorealistic, scary, dark, violent, anime, 3D render, text`

**Key rendering cues:**
- "soft watercolor textures" — storybook texture
- "rounded friendly shapes" — child-safe design language
- "warm pastel color palette" — gentle colors

## Comic Book / Graphic Novel

**Portrait prompt pattern:**
```
Comic book character portrait of [NAME] in [STYLE: Marvel/DC/indie] style.
[AGE AND BUILD], [COSTUME DETAILS], [EXPRESSION AND POSE]. Bold ink outlines,
dynamic comic book coloring with halftone dots, dramatic shadows.
Clean background, character portrait framing.
```

**Negative prompt:** `photorealistic, anime, 3D render, soft, watercolor, text, watermark`

## General Tips for All Styles

### Expression Vocabulary

| Mood | Prompt Words |
|------|-------------|
| Heroic | "noble, determined, confident, resolute" |
| Villain | "menacing, fierce, calculating, sinister smirk" |
| Friendly | "warm smile, kind eyes, approachable, gentle" |
| Mysterious | "enigmatic, half-smile, piercing gaze, hooded eyes" |
| Playful | "mischievous grin, sparkling eyes, cheeky" |
| Wise | "serene, knowing smile, calm steady gaze" |

### Build Vocabulary

| Type | Prompt Words |
|------|-------------|
| Athletic | "athletic build, toned, fit" |
| Muscular | "muscular, broad-shouldered, powerful build" |
| Slim | "slender, lean, graceful build" |
| Stocky | "stocky, compact, sturdy build" |
| Child | "small, youthful proportions" |
| Elderly | "aged, weathered, slightly stooped" |

### Age Indicators

| Age Range | Prompt Words |
|-----------|-------------|
| Child (5-12) | "young child, bright curious eyes, round face" |
| Teen (13-17) | "teenager, youthful features, lanky" |
| Young adult (18-25) | "young, fresh-faced, early twenties" |
| Adult (26-40) | "mature, confident, in their thirties" |
| Middle-aged (40-55) | "middle-aged, distinguished, some grey" |
| Elder (55+) | "elderly, wise, weathered features, white hair" |

### Tags for Organization

Common tag patterns for character organization:

```
["mythology", "hindu", "pixar", "3d-animated", "hero", "ramayana"]
["anime", "shonen", "warrior", "female", "fantasy"]
["realistic", "modern", "corporate", "male", "presenter"]
["storybook", "animal", "children", "friendly"]
```
