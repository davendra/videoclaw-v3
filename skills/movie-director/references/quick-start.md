# Quick Start — from idea to finished movie in 3 commands

For experienced users: the shortest path from premise to final.

## Zero → Movie (3 commands)

```bash
# 1. Verify env (30s)
bash skills/movie-director/scripts/verify.sh

# 2. Auto-mode with your premise
bash skills/movie-director/scripts/auto.sh "A lonely potter teaches his apprentice the secret of the perfect bowl"

# 3. When storyboard.md opens, review. If OK:
#    Type 'y' at the approval prompt.
#    Seedance runs for ~1 hour.
#    Final opens automatically.
```

Cost: ~$5. Wall time: ~1 hour.

## Interactive Interview (for uncertain users)

```bash
bash skills/movie-director/scripts/interview.sh
```

Walks through 10 questions. Default = genre-inferred value. Skip with Enter.

## Scripted Control (for power users)

```bash
# Phase 1 — storyboard only
GO_BANANAS_GENERATION_TRANSPORT=mcp DIRECTOR_AUTO_FIX_CONTENT=1 \
  vclaw video create "A solo astronaut discovers an alien flower on Mars" \
  --scenes 14 --production-mode director \
  --style villeneuve --color-grading teal-orange --platform youtube \
  --gb-character "Astronaut:ID" \
  --execute

# Review storyboard.md. When ready:

# Phase 2 — render
VIDEOCLAW_APPROVE_STORYBOARD=1 GO_BANANAS_GENERATION_TRANSPORT=mcp DIRECTOR_AUTO_FIX_CONTENT=1 \
  vclaw video create "<same premise>" \
  --scenes 14 --production-mode director \
  --style villeneuve --color-grading teal-orange --platform youtube \
  --gb-character "Astronaut:ID" \
  --execute

# Phase 3 — re-mux narrated if moov atom broken
bash skills/movie-director/scripts/remix-narrated.sh
```

## Cheap iteration (no Seedance burn)

If the storyboard reads wrong, iterate cheaply:

```bash
# Regenerate storyboard with modified prose
bash skills/movie-director/scripts/iterate.sh "<refined premise>" \
  --scenes 14 --production-mode director \
  --style villeneuve --color-grading teal-orange \
  --gb-character "Astronaut:ID"
```

Cost: $0.03 (LLM tokens only). Repeat until the storyboard reads perfectly, THEN approve.

## Decision tree

```
"I want to make a movie"
 │
 ├─ "I don't know what I want"       → interview.sh (10 questions)
 ├─ "I have a one-liner premise"     → auto.sh "premise"
 ├─ "I know exactly what I want"     → CLI direct
 └─ "I need characters first"        → bash skills/character-library/scripts/list.sh
                                         → bash skills/character-library/scripts/create.sh
                                         → then one of the above

After render:
 ├─ "Watch the final"                 → auto-opens
 ├─ "Middle drags"                    → iterate.sh with new prose
 ├─ "Need vertical for TikTok"        → bash skills/video-post/scripts/make-vertical.sh
 └─ "Upload to YouTube"               → bash youtube_upload.py (see post-production.md)
```

## The Golden Rules

1. **Storyboard first, always.** Even in auto-mode, review the markdown before approving.
2. **Cheap iteration beats expensive re-render.** Use iterate.sh as many times as needed.
3. **Verify environment before first run.** `verify.sh` catches missing keys in 30s.
4. **Rich character descriptions.** 50-80 words covering 8 fields. Vague → drift.
5. **Match character style to video style.** Photoreal character in Miyazaki = wrong.

Everything else is detail.
