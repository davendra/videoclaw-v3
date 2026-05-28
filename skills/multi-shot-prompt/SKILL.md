---
name: multi-shot-prompt
description: Generate multi-shot cinematic video prompts structured as timed shot sequences from a reference image, validated against a videoclaw preset (cinematic-15s, seedance-10s, veo-8s, or runway-10s). Use for "multi-shot prompt", "shot sequence", "cinematic prompt", "video prompt from this image", or when targeting Seedance/Veo/Runway/Kling/Sora with a structured timecoded prompt.
triggers:
  - "multi-shot prompt"
  - "shot sequence"
  - "cinematic prompt"
  - "video prompt from this image"
  - "shot breakdown"
  - "describe this scene as shots"
---

# Multi-Shot Cinematic Prompt Builder

Turns a reference image + scene brief into a copy-paste timecoded multi-shot
prompt, validated by videoclaw's `runMultiShotChecks`.

## Preset selection

Pick the preset that matches your target provider's clip duration:

- `seedance-10s` → Seedance 2.0 clips (10 s / 2–5 shots / 1500 chars)
- `veo-8s` → Veo 3.x clips (8 s / 2–4 shots / 1500 chars)
- `runway-10s` → Runway clips (10 s / 2–5 shots / 1000 chars)
- `cinematic-15s` (default) → hand-authored cinematic clips not bound to one provider's clip duration (15 s / 3–7 shots / 1500 chars)

The CLI enforces each preset's char budget, per-shot duration bounds, and
shot-count window. `--shots N` overrides must lie within the preset's
`[minShots, maxShots]` window or the command fails fast.

## Workflow

1. Get a scaffold + suggested non-repeating camera grid:
   `vclaw video multi-shot --plan --preset <preset> [--shots <N>]`
2. Analyze the reference image and gather the brief (character, action,
   location, time of day). Action and location are required.
3. Write cinematic prose into each shot slot, weaving in subject detail; end
   with the Location/Style/Audio metadata block.
4. Validate: pipe or save the prompt and run
   `vclaw video multi-shot --validate --preset <preset> --file <path>`
   (exit 0 = clean).
5. Deliver inside a single fenced code block; add a 2–3 sentence note on the
   shot structure chosen and one tweak to try.

For the full framework rules, trim priority, and example, see
`vclaw video prompt-lib-show --name multi-shot-framework`.

## Fully automated path

`vclaw video multi-shot --auto --image <path> --action "<x>" --location "<x>" --time "<x>" [--project <slug>] [--raw]`
authors and validates in one step (requires a Gemini key pool, or
`VCLAW_MULTISHOT_AUTO_STUB` for offline/testing).
