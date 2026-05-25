# Prompt Recipes — user-intent templates that render well

Tested intent prose shapes that produce coherent 14-scene Director runs. Copy the structure; swap the specifics.

## Action thriller (Komo: Jade Cipher template)

```
<Story N>: <Protagonist> <artifact>—<setting> <genre>. <Antagonist> <inciting action toward protagonist>. <Protagonist> wakes to <companion>'s warning, escapes through <location 1>, <action beat 1>. <Stakes raise>: <near-miss moment>, <protagonist action/choice>. <Companion> leads <protagonist> through <location 2> to <location 3> where <artifact awakens> and <mentor materialises translucent>, wordlessly offering a choice: surrender <artifact> or accept <mentor's gift>. <Protagonist> chooses to fight. <Protagonist + mentor> walk <new location> side-by-side to face <antagonists>. <Climactic encounter>; rain/light/particle effect. <Last antagonist surrenders>. <Mentor dissolves peacefully into starlight> as <artifact dims>—victory has a cost. <Dawn/resolution>. <Protagonist on <vantage point> with <companion>, <artifact quiet>>. <Final sensory note>.
```

**Why it works:** 14 explicit beats, each maps cleanly to one scene. Contains: stakes-setup, escape, near-miss, choice, clash, cost, resolution. The three-act arc is baked in.

**Example filled in:**
- Komo + jade pendant + Neo-Tokyo thriller
- Agents with HUD visors rappel toward her apartment
- Companion = Mochi the bunny
- Mentor = Hiro the samurai (translucent)
- Artifact gift = "radiant staff of light" (content-filter safe; avoid "spectral blade" / "katana")
- Climactic encounter = "radiant staff energies intertwine in slow-motion"
- Dissolves = "peacefully into starlight" (safer than "body shatters into mist")

## Storybook (Miyazaki template)

```
<Story N>: A <age> <character> named <Name> finds <object/creature> in <natural setting> and learns <lesson>. <Opening image: wide establishing>. <Character discovers object>. <Curiosity beat>. <Challenge>. <Helper arrives>. <Lesson moment>. <Trial>. <Near-failure>. <Realization>. <Resolution with object>. <Reflection>. <Return home>. <Final beat — warm, circular>.
```

**Style:** `--style miyazaki --color-grading pastel-dream`
**Scene count:** 14 (1 story act per scene is natural for this form)

## Documentary / character portrait

```
<Story N>: A day in the life of <subject>. Establishing shot of <location>. <Subject> at work. Detail of <tool/skill>. Interaction with <person/object>. Quiet moment. Main task begins. Challenge arises. Subject adapts. Resolution. Reflection. Wide hero shot. Closing.
```

**Style:** `--style villeneuve --color-grading desaturated` or `nolan --color-grading teal-orange`

## UGC / product testimonial

```
<Story N>: <User> discovers <product> after <problem>. Hook — <user> struggling with <problem>. Realization moment. First use. Surprise delight. Key feature in action. Before/after beat. Unboxing detail. Testimonial direct-to-camera. Social proof (friends reacting). Use in context. Benefit payoff. Call-to-action. Logo/resolution.
```

**Style:** `--style spielberg --color-grading golden-hour --platform tiktok`
**Scenes:** 12 (tighter for short-form)

## Gotchas to bake into every intent

1. **Front-load the genre.** "<Story>: Komo Jade Cipher — Neo-Tokyo action thriller." tells the script LLM the tone + genre in the first 8 words.

2. **One proper-noun character per beat, max.** "Komo and Mochi run from agents toward the shrine" = fine. "Komo and Mochi and Hiro and Yuki and Ren and Akira..." = LLM drops half, scenes render wrong characters.

3. **Use content-filter-safe verbs for climax.** `DIRECTOR_AUTO_FIX_CONTENT=1` auto-substitutes the common ones, but write defensively:
   - ❌ "katana clashes", "spectral blade", "shatters", "body breaks apart"
   - ✅ "energies intertwine", "radiant staff of light", "dissolves peacefully into starlight"

4. **Name the location changes.** "rooftop", "neon hallway", "subway tunnel", "shrine alley" — location variety reads as scene variety. Stuck in one location for 4 consecutive scenes → audience feels the drag.

5. **End with resolution, not cliffhanger.** Seedance's closing clips need a grounded final frame. "Dawn breaks over the city. Komo stands on a rooftop edge with Mochi in her arms" works. "Komo sees a new threat approaching — to be continued" leaves the last clip confused.

## Scene-count ↔ runtime cheat sheet

| Scenes | Target runtime | Use case |
|---|---|---|
| 8 | 2:00 | Quick ad, product demo |
| 10 | 2:30 | Short UGC testimonial |
| 12 | 3:00 | Standard storybook / ad |
| 14 | 3:30 | Action thriller, full story arc |
| 16 | 4:00 | Extended narrative, documentary |

Clip duration default is 15s. Override via `SEEDANCE_CLIP_DURATION_SEC=N` (5–60 allowed).
