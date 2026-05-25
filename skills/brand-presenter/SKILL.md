---
name: brand-presenter
description: Generic narrated presenter-video workflow for turning a slide deck or structured topic into an intro/slides/outro presentation using a branded host profile.
---

# Brand Presenter

Create a narrated presentation-style video from a PDF or slide deck using a
branded presenter profile for intro and outro scenes.

## When To Use

Use this workflow when:

1. a slide deck or PDF needs to become a narrated video
2. the workflow should include a recurring host character or presenter
3. a legacy presenter-specific skill such as `davendra-presenter` or
   `nex-presenter` was requested and should map to one shared implementation

## Generic Flow

1. extract slides
2. generate narration for each slide
3. generate intro and outro presenter dialogue
4. prepare presenter images or bundled assets
5. animate slides
6. generate presenter video segments
7. synthesize narration / voice-change presenter scenes
8. assemble final video with music and transitions

## Brand Profile Inputs

Each brand/presenter profile should provide:

1. presenter name
2. Go Bananas character id when applicable
3. default intro/outro assets
4. preferred voice id / TTS settings
5. any brand-specific title-card or overlay assets

## Current Bundled Profiles

1. `skills/davendra-presenter/` — business/strategic briefing presenter (Pixar `character_id=109`)
2. `skills/nex-presenter/` — tech briefing presenter (Pixar `character_id=98`)
3. `skills/bunty/` — cricket match-recap presenter (Pixar `character_id=97`) — the most actively-developed; canonical source for the shared patterns in the next section

Use those directories as brand-profile overlays on top of this generic
workflow.

## Guardrails

1. Prefer repo-local skill paths over old `.claude/...` assumptions.
2. Keep presenter-specific constants in the brand-profile directories instead of
   duplicating the whole workflow.
3. Treat the compatibility presenter skills as aliases, not as the canonical
   place to evolve the workflow.

## Shared learnings from Bunty (cross-pollination hub)

`skills/bunty/` is the most actively-developed presenter and the canonical
source for the following battle-tested patterns. **Every new presenter profile
should adopt these where applicable:**

| Pattern | Purpose | Status in davendra/nex | Cost to add |
|---|---|---|---|
| Pre-flight gates (`bunty_narration_check.py`, `bunty_image_filter_check.py`) | Catch off-by-one beats + Veo filter rejections BEFORE paying for TTS/Veo | added 2026-05-25 | $0.01 + 30s per run |
| Identity-lock helper pattern (`bunty_helpers.build_*_image_kwargs()`) | Stop character drift on Go Bananas Pro (clean-shaven, wrong hair, etc.) | documented, helpers not yet needed | ~30 LOC per character |
| Correction-loop recovery (`facts_corrected.txt` → NLM source re-upload) | Fix slides where wrong facts are burned into the PNG | added 2026-05-25 | 1 NLM regen cycle |
| Render-exactly-once guards in focus prompt | Stop NLM rendering the same slide in 2 different visual styles | bunty-only (cricket-specific examples) | 1 prompt line |
| Env auto-load at pipeline top | Avoid "forgot to source .env" debugging | bunty-only | 5 LOC |
| Failed-artifact skip on re-run | Don't re-pay for completed scenes | bunty-only | resume-aware checks |
| Interactive preview pages (HTML) | Review per-scene assets without scrubbing the final MP4 | bunty-only | 1 HTML template |
| Surgical re-generation (per-scene TTS / loop / segment regen) | Fix one bad beat without re-running the whole pipeline | added to nex (Phase 10); not in davendra | port from nex Phase 10 |
| AV parity / frame-aligned concat (`apad=whole_dur` + `-frames:v`) | Stop concat-demuxer DTS drift over 8+ segments | already in davendra + nex via `stitch_bunty.py` reference | inherited |

When a new bunty pattern proves out in production, the cycle is:

1. Land it in `skills/bunty/SKILL.md` + relevant helpers in
   `skills/video-replicator/scripts/`.
2. Update this table.
3. Open a one-paragraph cross-pollination note in the affected
   presenter SKILL.md files (the "Cross-pollination notes" section at the
   bottom of `davendra-presenter/SKILL.md` and `nex-presenter/SKILL.md`).
4. Only port the helper code into a presenter when that presenter
   actually hits the same problem — speculative ports are noise.
