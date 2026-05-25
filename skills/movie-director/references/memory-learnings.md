# Memory — Learnings distilled from 30+ production runs

Every insight below is grounded in a real run that failed, taught something, and now feeds forward. Don't re-learn these the hard way.

## Character Consistency (the #1 failure class)

> **Always use `generate_with_character(character_id)`, NOT standalone `generate_image`.**
> — Reason: standalone image gen produces a fresh character every call. The character_id path anchors to the library's reference images, preserving identity across clips.

### Consequences:
- Before running: every named human/animal character MUST have a library entry
- Director mode auto-hydrates characters via `--gb-character Name:ID` flag
- If a character isn't in the library, Phase-0.2 auto-creates — but only if the Phase-0.1b name-extraction finds them
- Preflight catches missing characters (`CHAR_COVERAGE_MISSING` error)

### Also:
- Phase-0.1b library lookup uses `search=<name>&exact=true` to avoid fuzzy mis-matches
- Multi-character scenes (2+ chars) should use `generate_with_multiple_characters` MCP tool
- Single-character scenes use `generate_with_character`

## Script LLM Failure Modes

> **Script generator can return truncated JSON on Gemini network flakes.** The runtime now has a `VIDEOCLAW_ALLOW_STUB_SCRIPT` escape hatch for tests, but production runs HARD-FAIL on truncated output — don't silently fall through to a stub.

### Why:
If the script LLM returns only 3 of 14 scenes (partial), silently falling to a minimal-draft stub produces "Scene N: continue <intent>" filler for the remaining 11 scenes. Every filler renders identically. Entire video becomes unusable.

### Applied fix:
- Parse LLM output strictly
- If any required field is missing → throw (no silent fallback)
- `VIDEOCLAW_ALLOW_STUB_SCRIPT=1` only for test environments with a fake key

## Narration Pipeline

Canonical 4-step pipeline (do NOT deviate):

1. **Slow-motion extend** — if TTS is longer than video, extend video via `setpts=N*PTS` to match TTS duration
2. **Concat silent stitched** — all extended clips concatenated via ffmpeg concat demuxer
3. **3-way mix** — master_narration + background_music (20% volume, fade in/out) + video_ambient (30%) via `amix`
4. **Combine** — silent_stitched.mp4 + final_premix.m4a via `ffmpeg -c:v copy -c:a aac -b:a 192k -t <duration>`

### Gotchas:
- Per-scene narration baked into each clip BEFORE stitch (so the final concat already has audio)
- Master narration mode (legacy) mixes one long narration track over silent stitched — less flexible
- `moov atom not found` on final: flush/close race; fix with concat re-mux from per-clip narrated files

## Output Paths

> **Never write output to `/tmp`. Always use `<root>/projects/<slug>/`.**

### Why:
- `/tmp` gets cleared on reboot
- Re-runs need artifacts (clips, images, manifests)
- Final videos live at `<root>/projects/<slug>/final/`

### Related:
- Slug is generated from the intent prose (first 50 chars, normalized)
- Different "Story N:" prefixes produce different slugs → useful for iteration

## Executor Pattern

> **Always use `executeVideoProduction(plan)`, never manually invoke stages.**

### Why:
- Executor orchestrates: script → hydration → preflight → decomposition → render → stitch → narration bake → finalize
- Manual invocation misses the narration + stitch flow
- Test runs that only do images stop before stitch; that's a conscious short-circuit, not a workaround

## Backend (UseAPI, Seedance, Veo)

### Current state:
- **Seedance** (via xskill.ai): primary I2V backend. Uses `image_file_N` named keys, not array
- **Veo I2V**: BROKEN since April 2026 — MEDIA_GENERATION_STATUS_FAILED on every request. Do not use
- **Kling**: alternative, not default
- **Go Bananas**: image generation, not video

### Seedance-specific:
- xskill.ai Starter plan: $199.99 for 150K points (paid via crypto)
- xskill.ai single-image mode preferred — multi-image Omni stalls/fails
- Webhook mode available (pyngrok tunnel) for cleaner async polling vs default polling

## Go Bananas Integration

> **Go Bananas MCP is the ONLY image source. Imagen removed, direct REST deprecated.**

### Settings:
- API key in `.env` as `GO_BANANAS_API_KEY`
- Clean-room repo uses the native exact-name lookup and REST character-management path directly
- Cloudflare UA workaround no longer required (BIC disabled on `/api/*` and `/mcp*` server-side 2026-04-17)
- Kept as defense-in-depth

### Character operations:
- `/api/characters` — list, create
- `/api/characters/:id` — get, PATCH (partial update), DELETE
- `?search=X&exact=true` — strict name match (exact=true avoids fuzzy drift)
- `override_environment: true` on generate — reuse character identity but with scene-specified env

## Test Discipline

> **Never ship untested code.** Every feature requires a regression test before merge.

### What counts as tested:
- Unit test runs and passes
- Manual smoke test documented with actual command + expected output
- Contract test if touching a prompt template (e.g. prompt-guidance-contract.test.ts)

### Test fixtures:
- Use VIDEOCLAW_ALLOW_STUB_SCRIPT=1 in LLM-dependent tests
- Don't burn Seedance credits in CI — use recorded fixtures or mock the backend

## The Higgsfield 15-Skill Library

Pulled from `beshuaxian/higgsfield-seedance2-jineng` GitHub repo. Contains:
- 18 2-second hooks across 7 genres
- 22 camera moves with Seedance-specific phrasing and speeds (e.g. "2 ft/s", "30°/s")
- 12 lighting presets with Kelvin temperatures
- 4 timeline templates (5s, 8s, 10s, 15s) with beat structures
- 15 genre sourcebooks with 20+ reusable patterns each

### Lessons from the library:
- **2-second hook principle**: every video must grab attention in first 2 seconds
- **Camera precision**: use specific speeds ("2 ft/s"), not vague words ("fast")
- **Kelvin temperatures**: specify exact color temp, not "warm" / "cold"
- **@image_file_N convention**: Seedance 2.0 material reference style matches our image-label system
- **Platform hook timing**: TikTok 0.3s vs YouTube 2s vs Instagram 1s — different cadence

## Director Mode (sequential chained clips)

> **Director mode is NOT parallel.** Each clip depends on the previous clip's last frame as the chain anchor. Sequential generation only.

### Why:
- Smooth cinematic flow between clips
- Visual continuity across the entire video
- Last-frame uploaded as Asset URI and injected as `@image_file_1` for next clip
- Character refs passed as `reference_images` (not `image_url`)

### Trade-off vs Storyboard mode:
- Director: better flow, sequential (~1h for 14 clips)
- Storyboard: parallel (~20 min), slideshow-feel cuts

### Configuration:
- `--mode director` or `--production-mode director`
- Default clip duration 15s (can override via `SEEDANCE_CLIP_DURATION_SEC`)
- Lock location in every clip's prompt — Seedance changes environments otherwise unless explicitly anchored

## Pipeline Gaps (known + tracked)

These are issues surfaced in production that have NOT yet been fully resolved:

1. **Go Bananas → Director character bridge** — partial; Phase-0.1b library lookup works, but `generate_with_multiple_characters` isn't always auto-selected
2. **Chain manager** — works but lacks advanced continuation tactics (match-on-object, match-on-action)
3. **Character sheet generator** — 4-angle sheet auto-gen exists; doesn't always produce well-aligned angles
4. **Reference validator** — Tier 1 heuristic + Tier 2 Gemini vision exists; Tier 2 sometimes over-rejects
5. **Auto-fix prompt critique** — anti-pattern replacements work, but keyword-soup detection is fuzzy
6. **Full production completion** — narration/music/intro/outro only works when executeVideoProduction runs the FULL pipeline (no manual stages)

## Content Filter Rejection Patterns

Seedance rejects (not always consistently):
- Combat/violence: "clashes", "strikes", "blood", "impact with motion blur"
- Weapons: "sword", "katana", "knife", "gun" (auto-fix substitutes)
- Real-person naming: "looks like <celebrity>"
- NSFW suggestion: "seductively", "intimately"
- Brand-trademark conflicts: "Apple logo", "Nike swoosh"

Safe alternatives encoded in `CONTENT_FILTER_HAZARDS` array in `director-preflight.ts`.

## "Pipeline Bugs Apr 12" — 7 bugs, all fixed

Reference list for future regression-hunting:
1. Slug collision (rapid runs producing same dir) — fixed by adding "Story N:" prefix convention
2. QA regeneration loop (infinite retry on flaky Gemini) — bounded to 1 retry
3. Narration fallback silently skipping if TTS failed — now hard-warns
4. `--mode` flag leak between Veo / Seedance invocations — separated
5. Hooks library KeyError on missing genre — defaultdict fix
6. Character names with special chars (Komo—Mochi em-dash) — now normalized
7. Final video copy stage wrote to wrong dir on Windows — paths.posix()

## Summary: Rules to Always Follow

1. Characters must be in library before render. Preflight enforces.
2. Scripts must be complete. Truncated JSON hard-fails.
3. Storyboard gate is non-negotiable. Don't burn Seedance without review.
4. Output to `<root>/projects/`, not `/tmp`.
5. Use `executeVideoProduction`, not manual stages.
6. Seedance via xskill.ai single-image mode, not multi-image Omni.
7. Gemini key pool with 3+ keys for reliability.
8. `DIRECTOR_AUTO_FIX_CONTENT=1` by default.
9. Never ship untested code.
10. Log carefully — grep recipes in `troubleshooting.md`.
