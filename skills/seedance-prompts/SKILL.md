---
name: seedance-prompts
description: >
  Browse the clean-room Seedance prompt reference library and apply the current
  provider guidance to Seedance-targeted scene writing. Use when you need
  Seedance formulas, examples, prompt structure guidance, or prompt-library
  references that actually exist in this repo.
triggers:
  - "seedance prompt"
  - "generate seedance prompt"
  - "expand prompt for seedance"
  - "search seedance prompts"
  - "find seedance examples"
  - "seed prompts"
  - "prompt quality"
---

# Seedance Prompts

Use this skill to inspect and apply the clean-room Seedance prompt references
that ship with `vclaw-video-core`.

## Current Scope

This repo currently supports a **reference-first** Seedance workflow, not the
older Python prompt-database workflow.

What exists now:

1. `vclaw video prompt-lib-list`
2. `vclaw video prompt-lib-show --name seedance-ugc-formulas`
3. `vclaw video execution-plan --project <slug>`
4. `vclaw video storyboard-review --project <slug>`

What does not exist in this repo:

1. `scripts/video/seedance_prompt_db.py`
2. `scripts/video/seed_skill_prompts.py`
3. a local SQLite prompt database under `scripts/video/data/`

Do not tell users to run those old paths from this clean-room repo.

## Canonical Commands

### List prompt references

```bash
vclaw video prompt-lib-list
```

### Show the Seedance reference

```bash
vclaw video prompt-lib-show --name seedance-ugc-formulas
```

### Get project-specific prompt guidance

```bash
vclaw video execution-plan --project <slug> [--root <path>] [--mode storyboard|director]
```

This returns the current prompt-guidance set chosen for the project, including
Seedance-specific references when the route or mode calls for them.

## Workflow

When the user asks for Seedance prompting help:

1. Inspect the current library:
   `vclaw video prompt-lib-list`
2. Read the Seedance reference:
   `vclaw video prompt-lib-show --name seedance-ugc-formulas`
3. If the prompt needs project context, inspect:
   `vclaw video execution-plan --project <slug>`
4. Apply the reference patterns to the user’s scene prose or storyboard beats.

## Output Expectations

A good answer or workflow result should give the user:

1. a concise Seedance-ready scene prompt
2. camera and pacing guidance grounded in the reference docs
3. negative / exclusion language when useful
4. any relevant warning about duration, continuity, or character consistency

## Notes

- Seedance prompting in this repo is currently **doc-and-guidance driven**.
- The canonical Seedance reference is `seedance-ugc-formulas` in the prompt library.
- When a user needs a full project-aware recommendation, prefer the execution
  plan and storyboard review outputs over freehand prompt invention.
