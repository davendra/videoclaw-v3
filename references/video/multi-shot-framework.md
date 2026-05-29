# Multi-Shot Cinematic Prompt Framework (cinematic-15s preset)

> The values below (15s total, 2–5s shots, ≤1500 chars, the Style and Audio
> lines) are the **`cinematic-15s` preset** — the default. They are
> parametrizable per provider/project via `vclaw video multi-shot`
> (`--total-seconds`, `--max-chars`, `--style-line`, `--audio-line`). The hard
> rules are enforced by `runMultiShotChecks`; author prose with the
> `multi-shot-prompt` skill or `vclaw video multi-shot --auto`.

---

## Overview

This framework turns a reference image and a scene brief into a ready-to-paste
timecoded multi-shot cinematic video prompt — a sequence of shots with precise
camera direction, designed for AI video generators (Seedance, Veo, Runway,
Kling, Sora, and similar tools).

**Hard rule: the final prompt must stay under the resolved preset's `maxChars`.**
For the default `cinematic-15s` preset that is 1,500 characters. The format is
deliberately compressed to fit within provider prompt-length limits. The Style
and Audio lines account for ~280 chars — plan the shot descriptions around the
remaining budget.

---

## Presets

| Preset | totalSeconds | shot range | shot count | maxChars | When to pick |
|---|---|---|---|---|---|
| `cinematic-15s` *(default)* | 15 s | 2–5 s | 3–7 | 1500 | Hand-authored cinematic clip not bound to one provider's clip duration |
| `seedance-10s` | 10 s | 2–5 s | 2–5 | 1500 | Target Seedance 2.0 clips |
| `veo-8s` | 8 s | 2–4 s | 2–4 | 1500 | Target Veo 3.x clips (standard 8 s output) |
| `runway-10s` | 10 s | 2–5 s | 2–5 | 1000 | Target Runway clips (durations enum'd to `5\|8\|10\|15`) |

All four presets share the same Nolan styleLine and diegetic audioLine — only
the hard provider constraints differ. Override the lines with `--style-line` /
`--audio-line` on the CLI if you want a different look.

For machine-readable discovery, use:

```
vclaw video multi-shot --presets
vclaw schema --json
```

The schema dump embeds the same preset registry and stable repair guidance for
multi-shot validation issue codes.

For existing videoclaw projects, hydrate the prompt request from a storyboard
scene instead of retyping context:

```
vclaw video multi-shot --plan --from-storyboard \
  --project <slug> --scene <sceneIndex> --route seedance-direct

vclaw video multi-shot --auto --image ref.png --from-storyboard \
  --project <slug> --scene <sceneIndex> --provider veo
```

This reads the project brief and storyboard artifact, carries scene characters
into the request, uses the scene description as the default action, and records
`source` metadata on generated `multi-shot-prompt` artifacts.

---

## 5-Step Workflow

### Step 1 — Analyze the reference image

Study the uploaded image and extract a compact visual description of the subject
— enough that another model could recreate the character or object without seeing
the source. Cover:

- **Identifying features** — hair, facial hair, skin tone, age range, build,
  distinguishing marks
- **Clothing and accessories** — garments, colors, textures, layering, hats,
  glasses, held objects
- **Overall vibe** — mood, posture energy, stylistic era

Be concrete but tight. This description will be woven into shot descriptions and
counts against the 1,500-char budget. Aim for 60–120 characters of subject
description spread across the shots — not dumped in one place.

If no image has been uploaded, ask the user to upload one. The reference image is
the visual anchor for the entire sequence.

### Step 2 — Gather the scene brief

Collect four pieces of information. Ask for all four in a single message unless
the user already provided them:

1. **Character** — who is the subject? (default: infer from reference image)
2. **Action** — what is the subject doing? (required — no default; the action
   drives the edit)
3. **Location** — where is this set? (required — always ask explicitly if not
   provided; populates the Location metadata line)
4. **Time of day** — e.g. golden hour, overcast midday, blue hour, night
   (default: infer from image mood or use "natural daylight")

If the user provides these inline with their request, skip the questions and
proceed directly.

### Step 3 — Design the shot sequence

Build a sequence of shots that totals **exactly 15 seconds** (`cinematic-15s`
preset), following these constraints:

- Each shot is a **minimum of 2 seconds** and a **maximum of 5 seconds**
- Choose the shot count freely — anywhere from **3 shots** (longer,
  contemplative beats) to **7 shots** (fast, punchy cutting)
- **Vary the shot count** each time so results feel fresh — do not default to
  the same structure repeatedly
- Each shot opens with a **timecode stamp** in the format `[MM:SS - MM:SS]`
  (e.g. `[00:00 - 00:04]` for a 4-second opening shot)

The shot count should serve the action. A slow, atmospheric scene wants fewer,
longer shots. A high-energy action beat wants more, shorter shots. A reveal or
transformation might use graduated acceleration — long establishing shot cutting
to rapid close-ups.

For **each shot**, specify all four technical parameters:

| Parameter | Options |
|---|---|
| **Shot size** | wide, medium, medium close-up, close-up, macro |
| **Lens** | 24mm (environment/scale), 35mm, 50mm, 85mm (intimacy/compression) |
| **Camera angle** | low angle, high angle, eye-level, over-the-shoulder, Dutch angle |
| **Camera movement** | push in, pull out, track, orbit, pan, tilt, handheld, static |

**Vary all four parameters across the sequence.** Do not repeat the same shot
size, lens, angle, or movement in consecutive shots. The sequence should feel
edited by someone who understands visual rhythm — each cut should shift the
viewer's perspective meaningfully.

To scaffold a non-repeating camera grid automatically:

```
vclaw video multi-shot --plan --shots <3-7>
```

### Step 4 — Write the prompt

Output the sequence as **separate paragraphs inside a single fenced code block**
— one paragraph per shot, separated by a blank line. Each paragraph begins with
its timecode stamp followed by the shot description. No lists, no markdown
formatting, no headers, no numbered shots. Each shot reads as continuous
cinematic direction within its paragraph.

Weave the subject description from Step 1 naturally into the shots — mention
identifying details where visible (e.g. reference clothing in a wide shot,
facial features in a close-up) rather than front-loading a description block.

**Always end the prompt with three metadata lines** after a blank line following
the final shot. The three lines sit together as a block with no blank lines
between them:

1. **Location:** — location and time of day from the scene brief (e.g.
   `Location: Narrow Tokyo alley, night.`)
2. **Style:** — `cinematic-15s` preset fixed line:
   `Style: Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.`
3. **Audio:** — `cinematic-15s` preset fixed line:
   `Audio: Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.`

These three lines are non-negotiable and count against the character budget.
The Style and Audio lines are fixed at ~280 chars — plan around the remaining
~1,170 chars for shots. Override them per-project with `--style-line` and
`--audio-line`.

### Step 5 — Count and deliver

**Count the final prompt.** If it exceeds 1,500 characters, apply the trim
priority in this order:

1. **Compress adjectives and adverbs** — cut atmospheric padding first.
   "Warm golden light spills across" → "golden light across."
2. **Merge shot descriptions** — if two consecutive shots share a location
   element, state it once.
3. **Shorten subject references** — after the first shot establishes the
   character, subsequent shots can use shorter identifiers ("he", "she",
   "they", "the figure").
4. **Simplify camera specs** — drop the lens mm if the shot size already
   implies it (a macro shot is obviously a long lens). Only do this as a last
   resort — the lens spec adds real value.
5. **Never cut**: the timecode stamps, the shot size/angle/movement specs, or
   the Location/Style/Audio metadata block.

Output the prompt in a **single fenced code block** with no commentary inside
it. Below the code block, add a brief note (2–3 sentences) covering the shot
structure chosen and one tweak to try if the first generation doesn't land.

To validate a finished prompt against the `cinematic-15s` preset rules:

```
vclaw video multi-shot --validate --file <path> --explain-issues
```

Exit 0 = clean. Issues are returned as structured JSON with `code`, `severity`,
and `message` fields. With `--explain-issues`, the JSON also includes stable
`summary` / `suggestedFix` guidance for each unique issue code.

For conservative deterministic repair:

```
vclaw video multi-shot --fix --file <path> --location "Tokyo alley" --time "night"
```

The fix path normalizes spacing and can append missing Location/Style/Audio
metadata. It intentionally does not rewrite shot prose or timecodes.

---

## Worked Example — Tokyo Alley

**Brief:** A bearded man in a backwards cap and oversized white tee, walking
through a neon-lit Tokyo alley at night.

```
[00:00 - 00:04] Wide, 24mm, low angle, tracking — a bearded man in backwards cap and white tee walks toward camera through a Tokyo alley, neon reflecting off wet asphalt.

[00:04 - 00:07] Medium, 50mm, eye-level, handheld — he moves between food stalls, warm light on his face, steam from a ramen counter beside him.

[00:07 - 00:09] Close-up, 85mm, high angle, static — his hand brushes a paper lantern, fingers lit red and gold.

[00:09 - 00:12] Wide, 35mm, Dutch angle, push in — he emerges into a broader street, neon skyline opening behind him.

[00:12 - 00:15] Medium close-up, 50mm, low angle, pull out — he stops, looks up at a flickering sign, light across his face.

Location: Narrow Tokyo alley, night.
Style: Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.
Audio: Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.
```

5 shots, graduated pacing — starts wide to establish the world, tightens to a
tactile close-up at the midpoint, then opens back up for the reveal. If the neon
reflections overpower the subject, try adding "subject isolated in shallow depth
of field" after the lens spec on the medium shots.

**Validation:**

```
vclaw video multi-shot --validate --file tokyo-alley.txt
# → { "valid": true, "charCount": 952, "issues": [] }
```

---

## Variation Guidance

**No action specified.** Default to movement through the space — walking,
exploring, arriving. Movement gives the edit something to cut around. Ask if
unsure, but don't block on it.

**Multiple characters.** Distribute character introductions across shots rather
than cramming everyone into shot one. Use over-the-shoulder angles to establish
spatial relationships between characters.

**Slow / contemplative scenes.** Lean toward 3–4 longer shots (4–5 seconds
each). Favor static or slow push-in movements. Use wider lenses and more
negative space.

**Fast / high-energy scenes.** Lean toward 6–7 shorter shots (2–3 seconds
each). Favor handheld, tracking, and quick pans. Use tighter shot sizes and more
aggressive angles (low, Dutch).

**Interior vs exterior.** Interiors benefit from tighter lenses (50mm, 85mm)
and closer shot sizes — there's less environment to establish. Exteriors can
open with wider lenses (24mm, 35mm) to sell the space before cutting in.

**Abstract or surreal scenes.** The framework still applies — surreal content
benefits from grounded camera language. Use Dutch angles and macro shots more
freely, but keep the technical specs precise. Dreamlike ≠ vague.

**Parametrizing the preset.** The `cinematic-15s` values are defaults.
Override them for a specific provider or project:

```
# 10-second sequence with a tighter character budget
vclaw video multi-shot --plan --total-seconds 10 --max-chars 1200

# Custom style for a different visual register
vclaw video multi-shot --auto --image ref.png --location "Paris rooftop" \
  --time "blue hour" \
  --style-line "Warm analogue grain, shallow depth of field. In the style of Wong Kar-wai." \
  --audio-line "Diegetic sound only — street noise and distant traffic."
```

---

## Anti-patterns (production-learned)

These are prompt-side mistakes that pass the structural validator but
produce unwanted output. The validator can't catch them — they're
authoring failures the video model interprets too literally.

### Negative direction doesn't work

The video models (Runway, Seedance, Veo) treat negation as ambiguous and
often honor the negated token anyway. **Do not write:**

- ❌ `"no slow-motion"` → model still applies slow-mo
- ❌ `"avoid handheld"` → may still come back handheld
- ❌ `"not in slow motion"` → still slow

**Use positive direction instead:**

- ✅ `"natural real-time pace, decisive movement"`
- ✅ `"locked-off camera, no rig motion"`
- ✅ `"crisp tempo, action-forward"`

Combining works too: `"natural real-time pace, decisive movement, no slow-motion"`
(positive first, negation second).

### Slow-motion creep

If you do NOT want slow motion, scan the prompt for every instance of
`slow-mo`, `slow motion`, `slow-motion`. Including these tokens — even
inside the Style line — biases the output toward slow motion. The
default `cinematic-15s` preset's `styleLine` contains "Slow-motion,
handheld grit" — keep it for the cinematic look, override it via
`--style-line` when the segment calls for natural pace.

### Vague camera direction

`"camera moves"` and `"dynamic shot"` and `"cinematic angle"` are
under-specified — the model picks something average. **Use the
framework's vocabulary**: a specific `shotSize`, a specific `lens`
(24mm / 35mm / 50mm / 85mm), a specific `angle`, a specific
`movement` (push-in / pull-out / dolly / handheld / locked-off / tilt /
pan / track). The validator's repeated-parameter check enforces variety
across shots; under-specification defeats it.

### Over-stuffed shot lines

Going much past ~120 chars per shot bleeds the budget and the model
starts ignoring later words. If a shot needs more detail than that, it
probably wants to be two shots.

### "Cinematic" without anchor

`"cinematic lighting, cinematic composition, cinematic mood"` — three
words doing no work. Anchor instead: `"IMAX-scale composition, deep
focus, practical lighting, high contrast"` (the default cinematic-15s
styleLine does this).

### Forgetting the metadata block

A common drift in `--auto` Gemini output: the model writes shots fine,
then drops the `Location:` / `Style:` / `Audio:` line labels at the end.
The validator catches this as `multi-shot-missing-metadata`. Re-add the
three labels exactly.

### Real-person content filter rejects photoreal references

Provider content filters (notably xskill / ARK Seedance — "may contain
real person") reject **photorealistic human faces** supplied as
`reference_images`. This silently kills the whole submission, not just
one image. Production-learned escape hatches, in order of preference:

- **Make reference art faceless.** Backlit silhouettes, figures shot from
  behind, or at distance — no clear frontal facial features — pass the
  filter. This is why per-scene storyboard grids destined for
  `reference_images` should be rendered in a silhouette / no-face register
  (see the `--no-faces` flag on `filmmaking-prompts`).
- **Prefer a single `image_url` (first-frame role) over the
  `reference_images` array.** The first-frame slot is materially more
  lenient than the multi-reference array for the same image.
- **Back-view / distance / hood** beats front-facing for any shot that
  must include a recognizable cast member.

A photoreal six-panel character sheet will almost always be rejected as a
`reference_image`; keep those as the *identity source* for image
generation, not as a video-provider reference.

### Grid leakage — the model animates the storyboard layout

When a 3×3 storyboard grid is passed as a `reference_image`, the video
model will happily **reproduce the grid itself** — the output becomes a
moving 9-panel split-screen instead of a single full-frame shot. "Read
the panels as sequential shots, not as one image" is **not enough**; the
model treats the collage as the composition to render.

Use explicit positive direction for single-frame output:

- ✅ `"Output a single full-frame cinematic shot that fills the entire frame edge to edge."`
- ✅ `"The storyboard grid is reference ONLY — perform its panels as consecutive moments over time."`
- ✅ `"No 3x3 grid, no split-screen, no panel borders, no collage, no multi-panel montage."`

The generated Seedance packets in `filmmaking-prompts.ts` now embed this
guard for both grid-bearing variants; preserve it if you touch
`seedancePromptText`.

---

## Validator Issue Codes

`runMultiShotChecks` returns structured issues for the following conditions:

| Code | Meaning |
|---|---|
| `multi-shot-timecode-parse` | No parseable `[MM:SS - MM:SS]` stamps found |
| `multi-shot-timecode-start` | First shot does not start at 00:00 |
| `multi-shot-timecode-gap` | Gap or overlap between consecutive shots |
| `multi-shot-timecode-total` | Sequence total does not match preset `totalSeconds` |
| `multi-shot-shot-duration` | A shot is shorter than `minShotSeconds` or longer than `maxShotSeconds` |
| `multi-shot-overlong` | Prompt exceeds `maxChars` |
| `multi-shot-repeated-parameter` | Consecutive shots repeat a shot size, lens, angle, or movement |
| `multi-shot-missing-metadata` | One or more of Location/Style/Audio lines is absent |
