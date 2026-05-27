---
name: multi-shot-prompt
description: Generate multi-shot cinematic video prompts structured as timed shot sequences from a reference image, validated against the videoclaw cinematic-15s preset. Use for "multi-shot prompt", "shot sequence", "cinematic prompt", "video prompt from this image", or when targeting Seedance/Veo/Runway/Kling/Sora with a structured timecoded prompt.
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

## Workflow

1. Get a scaffold + suggested non-repeating camera grid:
   `vclaw video multi-shot --plan --shots <3-7>`
2. Analyze the reference image and gather the brief (character, action,
   location, time of day). Action and location are required.
3. Write cinematic prose into each shot slot, weaving in subject detail; end
   with the Location/Style/Audio metadata block.
4. Validate: pipe or save the prompt and run
   `vclaw video multi-shot --validate --file <path>` (exit 0 = clean).
5. Deliver inside a single fenced code block; add a 2–3 sentence note on the
   shot structure chosen and one tweak to try.

For the full framework rules, trim priority, and example, see
`vclaw video prompt-lib-show --name multi-shot-framework`.

## Fully automated path

`vclaw video multi-shot --auto --image <path> --action "<x>" --location "<x>" --time "<x>" [--project <slug>] [--raw]`
authors and validates in one step (requires a Gemini key pool, or
`VCLAW_MULTISHOT_AUTO_STUB` for offline/testing).
