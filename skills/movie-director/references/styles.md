# Style presets — pairings that Seedance renders well

Each preset maps to a `--style` flag + recommended `--color-grading` options + what it looks like. Use as a menu for the interview step.

## Director / Style Presets

### `villeneuve` — Wide anamorphic cinematic
- Wide 35mm anamorphic, symmetrical framing, volumetric haze, cinematic photograph
- Best for: action thriller, sci-fi, drama
- Pairs well with: `neon-noir`, `teal-orange`, `desaturated`, `ice-cold`
- Example: Blade Runner 2049, Dune

### `nolan` — IMAX practical
- Wide 70mm IMAX feel, desaturated with warm accents, practical effects, grounded realism
- Best for: action thriller, sci-fi, short-film, documentary
- Pairs well with: `teal-orange`, `desaturated`
- Example: Interstellar, Dunkirk

### `miyazaki` — Watercolor storybook
- Hand-drawn watercolor illustration, soft pastels, warm diffuse light, painterly strokes
- Best for: storybook, fantasy, children's content
- Pairs well with: `pastel-dream`, `golden-hour`
- Example: Studio Ghibli films

### `wes-anderson` — Symmetric pastel
- Flat front-on framing, meticulously arranged, pastel palette (mint, coral, mustard), storybook geometry
- Best for: romance, storybook, quirky comedy
- Pairs well with: `pastel-dream`, `golden-hour`, `vintage-film`
- Example: Grand Budapest Hotel, Moonrise Kingdom

### `fincher` — Clinical precision
- Desaturated green-brown, crushed blacks, shallow depth of field, cold geometric composition
- Best for: horror, thriller, psychological drama
- Pairs well with: `desaturated`, `ice-cold`, `bleach-bypass`
- Example: Gone Girl, Se7en

### `spielberg` — Golden wonder
- Golden hour god rays, warm amber highlights, sense of wonder and adventure
- Best for: fantasy, family adventure, UGC ad
- Pairs well with: `golden-hour`, `pastel-dream`
- Example: E.T., Raiders of the Lost Ark

### `wong-kar-wai` — Neon handheld
- Handheld close-ups, step-printed slow motion, neon reflections, melancholic intimacy
- Best for: music video, romance, urban thriller
- Pairs well with: `neon-noir`, `vintage-film`
- Example: Chungking Express, In the Mood for Love

### `kubrick` — 35mm one-point
- One-point perspective, symmetrical tracking shots, cold sterile lighting, grounded realism
- Best for: horror, sci-fi, psychological drama
- Pairs well with: `ice-cold`, `desaturated`, `bleach-bypass`
- Example: The Shining, 2001, A Clockwork Orange

### `tarantino` — Retro film grain
- Saturated primaries, visible film grain, retro 1970s/80s aesthetic
- Best for: western, music video, crime comedy
- Pairs well with: `vintage-film`, `desaturated`, `golden-hour`
- Example: Pulp Fiction, Kill Bill

### `ridley-scott` — Epic bronze
- Epic scale, bronze/gold with steel blue, smoke and dust, historical grandeur
- Best for: sci-fi, fantasy, period epic
- Pairs well with: `teal-orange`, `golden-hour`
- Example: Gladiator, Blade Runner (1982)

## Color Grading Presets

### `neon-noir`
Deep blacks with vivid neon accents, wet reflections. Night urban. Pair with villeneuve, wong-kar-wai, fincher.

### `teal-orange`
Teal shadows, warm orange skin tones, high contrast. Blockbuster cinematic. Pair with villeneuve, nolan, ridley-scott.

### `pastel-dream`
Soft pastel highlights, lifted shadows, dreamy low contrast. Pair with miyazaki, wes-anderson, romance.

### `golden-hour`
Warm amber wash, long soft shadows, late afternoon. Pair with spielberg, miyazaki, tarantino.

### `desaturated`
Muted low-saturation colors, documentary feel. Pair with nolan, fincher, tarantino.

### `vintage-film`
Faded colors, warm yellow cast, nostalgia film grain. Pair with tarantino, wes-anderson, wong-kar-wai.

### `ice-cold`
Blue-white color shift, clinical sterile. Pair with fincher, kubrick, horror.

### `bleach-bypass`
Desaturated high contrast, silvery highlights. Pair with fincher, kubrick, war film.

### `anime-cel`
Flat colors with hard shadow edges, clean line art. Pair with miyazaki (alternative to watercolor).

## Interview Menu Shortcut

When the user picks a genre, the skill filters to the genre's recommended style_presets (from `genres.yaml`) and shows those as first options. Example for action-thriller:

```
Choose visual style:
  1. villeneuve (wide anamorphic — Blade Runner 2049)  [default]
  2. nolan (IMAX practical — Dunkirk)
  3. fincher (clinical desaturated — Se7en)
  4. custom (you specify)
```

User picks, skill filters grading_presets accordingly:

```
Choose color grading:
  1. neon-noir (deep blacks + neon accents)  [default for villeneuve]
  2. teal-orange (blockbuster)
  3. desaturated (muted / documentary)
  4. custom
```

## Known NOT-working combinations

- **miyazaki + ice-cold**: watercolor + clinical blue = visually jarring. Don't offer.
- **wes-anderson + bleach-bypass**: symmetric pastel doesn't survive desaturation. Don't offer.
- **tarantino + neon-noir**: retro film grain fights neon. Don't offer.

The interview should suppress these combos from menus.
