---
name: director-video
description: Produce a character-consistent multi-scene video via VideoClaw Director mode (chained Seedance clips + Go Bananas character refs + LLM decomposer). Two-phase gate — writes storyboard.md for review BEFORE burning any Seedance credits, then renders on approval.
---

# Director Video Skill

End-to-end workflow for the VideoClaw Director mode video pipeline: Go Bananas character refs → Gemini-batched beat decomposition → chained Seedance clips (last-frame continuity) → TTS narration bake → stitched final. Encodes every gotcha the pipeline surfaced through real production runs.

## Positioning

Use `skills/video-framework/SKILL.md` when the user needs a generic video
workflow and the system still has to decide whether Director mode is the right
lane.

Use `director-video` when:

1. Director mode is already clearly the intended lane
2. the user wants the chained multi-clip workflow specifically
3. the task is about the storyboard-review and approval-gated Director runtime

## When to Use

Trigger patterns (any of these in user messages):
- "create a video", "make me a video", "short film", "action thriller / storybook / ad"
- Multi-scene story with 2+ named characters
- "director mode", "chained 15s clips", "Seedance", "Villeneuve / Miyazaki / Wes Anderson style"
- User asks for a video longer than ~30s

Do NOT trigger for:
- Single-image / portrait generation (use `go-bananas` skill directly)
- Non-VideoClaw projects
- Pure storyboard mode (parallel per-scene I2V) — this skill is for Director chained mode specifically

## The Core Invariant

**Never run Seedance before the user approves `storyboard.md`.**

Seedance credits are real. The pipeline writes a human-readable audit file at
`<root>/projects/<slug>/storyboard.md` for free (LLM tokens only). The user
reads it. Only with explicit approval does Seedance fire.

## Two-Phase Workflow

### Phase 1 — Preflight + Storyboard (no Seedance)

```bash
DIRECTOR_AUTO_FIX_CONTENT=1 \
  vclaw video create \
  "<user intent prose>" \
  --scenes 14 \
  --production-mode director \
  --style <preset> \
  --color-grading <preset> \
  --platform youtube \
  --gb-character "Komo:170" \
  --gb-character "Mochi:247" \
  --gb-character "Hiro:206" \
  --execute
```

Flow: script LLM → character hydration → pre-render preflight → batched Gemini decomposition → post-decomposition preflight → write `storyboard.md` → exit.

Open the markdown. Verify:
1. Intent matches what the user asked for
2. Character bindings (ID, ref image URL, description) are correct
3. Each clip has 3 DISTINCT beats (not the repeat-template fallback)
4. Each clip after scene 1 opens with continuity language ("Continuing from...", "In the same instant...")
5. Style anchor ("<style> cinematic style, <grading> color grading") appended to every clip
6. Post-decomposition warnings are acceptable (pronoun drift on genderless characters is benign)

### Phase 2 — Approve and Render (Seedance credits spent)

Same command, prefixed with the approval env var:

```bash
VIDEOCLAW_APPROVE_STORYBOARD=1 DIRECTOR_AUTO_FIX_CONTENT=1 \
  vclaw video create \
  "<same prose>" \
  --scenes 14 --production-mode director --style <preset> --color-grading <preset> --platform youtube \
  --gb-character "Name:ID" ... \
  --execute
```

Wall time: ~4 min per clip × 14 clips ≈ ~1 hour. Plus stitch + narration bake (~3 min).

### Phase 3 — Mop up (usually needed)

The baked narrated final sometimes writes a broken moov atom. Re-mux from the per-clip narrated files:

```bash
cd <root>/projects/<slug> && \
  ls videos/ | grep narrated | sort | \
  awk -v D="$(pwd)/videos/" '{print "file \x27"D$0"\x27"}' > /tmp/concat.txt && \
  ffmpeg -y -f concat -safe 0 -i /tmp/concat.txt -c copy final/narrated-fixed.mp4
```

Open `final/narrated-fixed.mp4`.

## Character Preflight (run BEFORE Phase 1)

For every named character in the user's intent, confirm a Go Bananas library entry exists:

```bash
# Reuse exact-name library matches from the story intent
vclaw video create "<story intent>" --project <slug> --import-library-characters --api-url <url> --dry-run

# If a character is still missing, auto-create from a rich description seed
echo '[{"name":"<Name>","description":"<rich visual description including age, ethnicity, hair, eyes, clothing, style>","style":"<matches video style>"}]' > /tmp/char_input.json
vclaw video character-auto-create --project <slug> --input /tmp/char_input.json

# Or fold both steps into the main front door
vclaw video create "<story intent>" --project <slug> --import-library-characters --auto-create-characters /tmp/char_input.json
```

## Required Environment

Confirm these in the project `.env` (source `src/video/env-loader.ts` auto-loads them):

| Var | Purpose | What happens if missing |
|---|---|---|
| `GOOGLE_API_KEY` | Script LLM | Pipeline hard-fails on script gen |
| `GEMINI_API_KEYS` | Decomposer key pool (comma-separated, 3+ keys from different GCP projects) | Falls back to single `GOOGLE_API_KEY` → 429 on 14-scene decomposition burst |
| `GO_BANANAS_API_KEY` | Character library + image gen | Pipeline can't hydrate character refs |
| `SUTUI_API_KEY` | Asset Library (last-frame chaining anchor) | Without this, `reference_images` mode breaks → identity drift across clips |
| `ELEVENLABS_API_KEY` | TTS narration | Narration step silently skipped |

## Control Flags

| Env var / Flag | Effect |
|---|---|
| `VIDEOCLAW_APPROVE_STORYBOARD=1` | Skip storyboard gate, proceed to Seedance |
| `DIRECTOR_AUTO_FIX_CONTENT=1` | Auto-substitute content-filter hazards ("spectral blade" → "radiant staff of light", etc.) |
| `SKIP_DIRECTOR_PREFLIGHT=1` | Bypass preflight gates — NOT recommended, Seedance credits at risk |
| `SEEDANCE_CLIP_DURATION_SEC=N` | Override clip duration (5–60s, default 15) |
| `GEMINI_RPM_THROTTLE_MS=N` | Inter-scene Gemini throttle (default 4500ms, single-key fallback) |

## Style Presets That Work

Tested end-to-end:
- `villeneuve` + `neon-noir` → action thriller, wide anamorphic, desaturated blue-gray with neon
- `miyazaki` + `pastel-dream` → watercolor storybook, warm diffuse light
- `wes-anderson` + `pastel-dream` → symmetric flat-front framing, mint/coral/mustard
- `nolan` + `teal-orange` → IMAX-scale practical cinematography
- `fincher` + `desaturated` → clinical precision, crushed blacks, shallow DOF
- `spielberg` + `golden-hour` → god rays, wonder, warm amber

## Gotchas the Skill Must Proactively Handle

1. **Character coverage failure (`CHAR_COVERAGE_MISSING`).** Preflight flags a named character not bound to a library ID. Action: offer `vclaw video character-auto-create --project <slug> --input <json>` OR import exact-name matches via `vclaw video character-import-library --project <slug> --intent "<text>"`.

2. **Species drift (`CHAR_SPECIES_DRIFT`).** LLM decomposer described an organic character with synthetic descriptors (e.g. "Mochi, a small robotic creature, with a metallic paw"). Character locks prevent this — but if it fires, regenerate the storyboard.

3. **Style anchor missing.** Every clip must contain the style blob. `ensureStyleAnchor()` appends it automatically; warning means it wasn't detected.

4. **Gemini 429 during decomposition.** With only 1 key, single paid-tier account can't sustain 14-scene burst. Require `GEMINI_API_KEYS` with 3+ keys OR accept batched-call + retry-with-backoff.

5. **`moov atom not found` on narrated final.** Known flake in the narration-bake path. Run Phase 3 re-mux.

6. **Seedance polling timeouts.** ~5–10% of clips hit 20min polling cap. Target 14 scenes to land 12. If >3 clips fail, retry Phase 2 — character Asset URIs persist across runs via SUTUI cache.

7. **HTTP last-frame + Asset character refs → real-person filter cascade.** When SUTUI upload of a last-frame fails and falls back to an HTTP host, mixing with Asset:// character refs trips Seedance's filter from that clip onwards. Runner now drops the chain for that one clip rather than pollute the media_files array. Accept the visual-continuity hit for that scene.

## Checkpoint Prompts

At each decision point, the skill should:

**After character resolution:**
> "I found Komo (170), Hiro (206). Mochi isn't in the library. Want me to auto-create Mochi with this description: '<desc>'? Or do you have an existing ID?"

**After Phase 1 (before Seedance):**
> "Storyboard written to `<path>`. Review the verbatim Seedance prompts — especially: (1) middle scenes don't drag, (2) character descriptions aren't altered by the LLM, (3) continuity bridges read naturally. When ready, say 'approve' and I'll fire Seedance (~1hr wall time, ~14 credits)."

**After Phase 2:**
> "Render complete: <N>/14 clips successful, runtime <MM:SS>. <K> clips lost to Seedance polling (~normal rate). Opening final. If characters still look inconsistent, we iterate on the storyboard cheaply — no Seedance needed until next approval."

## Output Format

```
DIRECTOR VIDEO REPORT
=====================

Intent:           <1-line summary>
Scenes requested: 14
Scenes landed:    12
Runtime:          3:00
Style:            villeneuve + neon-noir
Characters:       Komo (170), Mochi (247), Hiro (206)

Preflight:        pre-render PASS (0e/1w) · post-decomposition PASS (0e/3w)
Storyboard:       <root>/projects/<slug>/storyboard.md
Final (raw):      <root>/projects/<slug>/final/*_director.mp4
Final (narrated): <root>/projects/<slug>/final/*-narrated-fixed.mp4

Failures:
  - clip_01: Seedance polling timeout (20min cap)
  - clip_04: Seedance polling timeout (20min cap)

Next: watch → iterate on storyboard prose if anything drifts (no Seedance burn
until re-approval).
```

## Files the Skill Coordinates

Core runtime (do not re-invent):
- `src/video/director-mode/runner.ts` — Director-mode entry point, owns all 7 steps
- `src/video/director-mode/storyboard-md.ts` — `storyboard.md` writer + `isStoryboardApproved()`
- `src/video/director-preflight.ts` — 7 preflight check functions + `runPreRenderPreflight` + `runDirectorPreflight`
- `src/video/gemini-key-pool.ts` — `fetchGeminiWithPool` + round-robin + 429 cooldown
- `src/video/library/clean.ts` — character library CRUD for preflight's auto-create suggestions
- `vclaw video character-auto-create` — creates or reuses Go Bananas characters from description + style

Read-before-writing reference:
- `references/prompt-recipes.md` (if present) — proven user-intent templates
- `references/character-creation.md` (if present) — description templates for organic, samurai, cyberpunk characters

## Best Practices

- **Always write storyboard first, even for repeat runs.** Prose drift is cheaper to catch pre-render than post.
- **Enrich character descriptions before creation.** Vague `base_prompt` → Seedance drift. Include age, ethnicity, hair, eyes, clothing, build, style. ~50–80 words.
- **Use `DIRECTOR_AUTO_FIX_CONTENT=1` by default.** Auto-substitutes known Seedance content-filter hazards. Only disable if debugging why a clip rejected.
- **Check `preflight` warnings, don't just glance at PASS.** A "3 warnings" run might have 3 benign pronoun drifts or 3 genuine style-anchor failures. The text of each warning matters.
- **When a scene rejects twice in a row, adjust the intent prose.** The content-filter auto-fix handles weapons/clash verbs; more creative adjustments (e.g. "samurai fight" → "radiant duel") need human touch.

## Scenario Examples

**Good:** User says "make me an action thriller with Komo". Skill confirms Komo (170) exists, asks for supporting characters (Mochi, Hiro), writes storyboard, user approves, renders, opens final.

**Good:** User says the middle drags after watching. Skill regenerates the storyboard with a tightened intent prose (no Seedance burn), user re-approves, re-renders.

**Bad:** Skill skips storyboard phase because user says "just make it now". Wastes 14 Seedance credits on a bad storyboard. Always insist on Phase 1 — the gate is the product.

**Bad:** Skill creates a character without a detailed description ("Mochi: a bunny"). Seedance drifts; every clip renders Mochi differently. Rich descriptions are non-negotiable.

## Use with Other Skills

**With `/oh-my-claudecode:plan`:** Plan the storyboard beats in structured form before running, then pass to Director.

**With `/oh-my-claudecode:verify`:** Post-render, verify character consistency across clips by comparing keyframes.

**With `video-marketing`:** Pipe the final into platform-optimized variants for TikTok / Shorts / Reels.
