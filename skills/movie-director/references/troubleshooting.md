# Troubleshooting Guide

Every failure mode we've seen during production, with root cause + fix. When the pipeline misbehaves, grep this file for the error message first.

## Preflight Errors

### `CHAR_COVERAGE_MISSING`
**Cause:** A proper noun appears in scene descriptions that isn't bound to a library character.
**Fix:**
- Auto-create: `echo '[{"name":"Name","description":"...","style":"..."}]' > /tmp/c.json && vclaw video character-auto-create --project <slug> --input /tmp/c.json`
- OR pass `--gb-character Name:ID` with an existing library ID
- OR if it's a generic class (like "Agents"), the preflight skips plurals — check you didn't singularize accidentally

### `CHAR_ID_NOT_FOUND`
**Cause:** You passed `--gb-character Name:999999` for an ID that doesn't exist.
**Fix:** `vclaw video library clean --name-regex "^Name$" --dry-run` to find the real ID

### `CHAR_NO_REF_IMAGE`
**Cause:** Library character exists but has no `reference_images[]`.
**Fix:** Delete + recreate via `vclaw video character-auto-create --project <slug> --input <json>`, OR upload a ref image via the Go Bananas UI

### `REF_IMAGE_UNREACHABLE`
**Cause:** Hydrated sheet image URL returns 404 (R2 CDN flake / stale library entry).
**Fix:** Re-fetch the character via the library CLI to refresh; if persistent, recreate

### `SCRIPT_STUB_DESCRIPTION`
**Cause:** Script LLM fell back to a stub template ("Scene N: continue <intent>").
**Fix:**
- Check `GOOGLE_API_KEY` is valid + not rate-limited
- Check for truncated-JSON error in log; Gemini occasionally returns partial
- Remove `VIDEOCLAW_ALLOW_STUB_SCRIPT=1` if accidentally set

### `SCRIPT_DESC_TOO_SHORT`
**Cause:** A scene description is <20 chars — too thin to decompose.
**Fix:** Enrich the intent prose; re-run script generation

### `BEATS_NOT_DISTINCT`
**Cause:** LLM decomposer produced 3 near-identical beats (Jaccard >0.7 on all 3 pairs).
**Fix:**
- Re-run decomposition (non-deterministic)
- Enrich the source scene description so there's more to decompose
- Raise LLM temperature (currently 0.4)

### `PRONOUN_DRIFT` (warning)
**Cause:** 2+ wrong-gender pronouns paired with a known-gender character.
**Fix:** Usually benign (character ref image wins). If it affects output, PATCH the character's `base_prompt` to explicitly include pronouns

### `CHAR_SPECIES_DRIFT` (error)
**Cause:** Organic character (bunny, dog) paired with synthetic descriptors (robotic, metallic) in the same sentence.
**Fix:**
- Tighten character description to emphasize organic nature
- Add redundant "NOT robotic" clause to the description
- Re-decompose (character locks should prevent this, but occasionally slips)

### `STYLE_ANCHOR_MISSING` (warning)
**Cause:** Decomposed clip doesn't mention the style directive.
**Fix:** `ensureStyleAnchor()` should auto-append. If warning persists, check styleBlob is being passed to runner

### `CONTENT_FILTER_RISK` (warning)
**Cause:** Clip prompt contains known Seedance-hazard phrases.
**Fix:** `DIRECTOR_AUTO_FIX_CONTENT=1` auto-substitutes. For un-covered phrases, manually soften source prose

## Runtime Errors (during Seedance)

### Clip fails with `content filter rejected`
**Seedance rejected the prompt outright.**
**Fix:**
- Confirm `DIRECTOR_AUTO_FIX_CONTENT=1`
- Soften climax verbs: "clashes" → "intertwine", "shatters" → "dissolves"
- Avoid explicit combat language
- Avoid naming real people
- For rejected climax clips specifically, re-run with the softer prompt

### Clip hits polling timeout (20 min)
**Seedance task queued but never completed.**
**Fix:**
- Accept the loss — normal ~5% flake rate
- OR retry only that scene: extract the prompt from `storyboard.md`, use `seedance_client.create_task` directly
- OR target N+2 scenes to land your desired N

### All clips from clip_N onward fail with "mixed URLs detected"
**Last-frame Asset upload failed for clip N-1, fell back to HTTP URL; mixing with Asset:// character refs trips Seedance's real-person filter.**
**Fix:** The runner now drops the chain for that one clip automatically. If the error still appears:
- Confirm `SUTUI_API_KEY` is set and valid
- Check SUTUI service availability
- Restart the run — chain re-establishes from the next successful clip

### `Gemini 429 RESOURCE_EXHAUSTED`
**Per-minute rate limit on single API key.**
**Fix:**
- Add more keys: `GEMINI_API_KEYS=k1,k2,k3` (different GCP projects)
- Key pool rotates automatically on 429
- If STILL 429 after 3+ keys, quota is genuinely exhausted — wait ~1 hour

### `Gemini 400 / model not available`
**Key's GCP project doesn't have access to the model.**
**Fix:**
- Use `gemini-flash-latest` instead of `gemini-2.0-flash` (new projects don't get the latter)
- Code already targets `gemini-flash-latest` — check your env isn't forcing a different model

### `Gemini empty response / MAX_TOKENS`
**`gemini-flash-latest` burns tokens on "thinking" internals.**
**Fix:** Decomposer already uses 8000 `maxOutputTokens` — should be sufficient. If still empty:
- Check `X-goog-api-key` header vs `?key=` query param (both supported, but quirky)
- Try a single clip to see full response body

### `Go Bananas 401 Unauthorized`
**API key missing or expired.**
**Fix:** Verify `GO_BANANAS_API_KEY` in `.env`

### `Go Bananas 404 on /characters/ID`
**Library entry deleted / ID wrong.**
**Fix:** `vclaw video library clean --dry-run` to enumerate what exists

## Stitch / Narration Errors

### `moov atom not found` on narrated final
**Narration bake race: output finalized before moov atom flushed.**
**Fix:**
```bash
cd <root>/projects/<slug> && \
  ls videos/ | grep narrated | sort | \
  awk -v D="$(pwd)/videos/" '{print "file \x27"D$0"\x27"}' > /tmp/concat.txt && \
  ffmpeg -y -f concat -safe 0 -i /tmp/concat.txt -c copy final/narrated-fixed.mp4
```

### TTS `silently skipped` / `non-fatal`
**`ELEVENLABS_API_KEY` missing or TTS request failed.**
**Fix:** Check key; look for ElevenLabs error lower in log

### Per-clip narration duration mismatch
**TTS audio longer than video clip.**
**Fix:** Pipeline extends the video via setpts (slow motion). If warnings persist, check `extendAndBakeNarration` logs

### Stitched video jumps cuts abruptly
**Last-frame Asset chain failed on a clip; next clip doesn't continue visually.**
**Fix:** Accept for that one cut; the surrounding clips still chain properly

## Build / Setup Errors

### `npm run build` TypeScript errors
**Usually stale imports after refactor.**
**Fix:** Check the specific error — imports are often the culprit. Re-run after fix

### Tests fail with `VIDEOCLAW_ALLOW_STUB_SCRIPT` required
**Test environment doesn't have full Gemini quota.**
**Fix:** Tests that use `planVideoProduction` should set `process.env.VIDEOCLAW_ALLOW_STUB_SCRIPT = '1'` in a `before()` hook

### CLI not found / `vclaw: command not found`
**Package not linked.**
**Fix:** `npm link` OR use `vclaw <subcommand>` directly

### `.env` not loaded
**Env loader not running.**
**Fix:** Check `src/video/env-loader.ts` is imported. In raw Node scripts, `import './env-loader.js'` before accessing env

## Recovery Playbooks

### Full restart after bad run (no Seedance credits spent if storyboard still gated)
```bash
rm -rf <root>/projects/<slug>
# Re-run original command
```

### Recover a mostly-good run where only 1 clip failed
1. Extract the failed clip's prompt from `storyboard.md`
2. Manually run `seedance_client.create_task(prompt=<prompt>, media_files=[previous_lastframe_asset, <char_assets>])`
3. When complete, download into `videos/clip_NN.mp4`
4. Re-run Phase 3 re-mux

### "I want to iterate on the storyboard without burning Seedance"
- Run Phase 1 again with a modified intent prose
- Storyboard.md updates for free (LLM tokens only)
- Only Phase 2 with `VIDEOCLAW_APPROVE_STORYBOARD=1` fires Seedance

### "Character looks wrong in all clips"
1. Delete the character: `vclaw video library clean --ids <id> --yes`
2. Recreate with a tighter description
3. Re-run storyboard → preflight will use the new ref image automatically

### "I ran out of Gemini quota mid-run"
- Storyboard gate should have stopped you before burn
- If mid-render: accept partial (clips already generated are saved)
- Add more keys to `GEMINI_API_KEYS`
- Retry remaining clips manually

## Log grep recipes

```bash
# Find all preflight issues
grep -E "preflight|✗|⚠" /tmp/run.log

# Find all Seedance failures
grep "ERROR: Task\|content filter\|timeout" /tmp/run.log

# Find clip completion order
grep "Progress:" /tmp/run.log

# Find which keys were used
grep "gemini-pool\|rotating to next" /tmp/run.log

# Find character ref resolution
grep "Hydrated\|Character ref" /tmp/run.log

# Find last-frame chain outcomes
grep "Last frame\|Chaining from" /tmp/run.log
```
