# Runtime Architecture — what actually happens when you hit Enter

Reference for developers who want to understand or extend the pipeline.

## The 9 Steps (in order)

```
1. CLI parse                        (src/cli/video.ts)
2. Plan video production             (src/video/pipeline.ts)
3. Script LLM                        (src/video/script/llm-generator.ts)
4. Hydrate library chars             (src/video/director-mode/runner.ts step 0)
5. Pre-render preflight              (src/video/director-preflight.ts)
6. Batched LLM decomposition         (runner.ts step 1 + buildAllTimestampedPromptsBatch)
7. Resolve char refs to Asset URIs   (runner.ts step 2)
8. Post-decomposition preflight      (director-preflight.ts)
9. Write storyboard.md + gate        (runner.ts step 2.75 + storyboard-md.ts)
─────────────── APPROVAL GATE ───────────────
10. Sequential clip generation       (runner.ts step 3: per-clip loop)
     a. Build media_files             (last-frame + char refs)
     b. Create Seedance task          (seedance_client.create_task)
     c. Poll for completion           (seedance_client.poll_task)
     d. Download video                (curl)
     e. Extract last frame            (ffmpeg -sseof)
     f. Upload to Asset Library       (seedance_assets.upload)
11. Stitch clips                     (runner.ts step 4: concat demuxer)
12. Generate narration               (runner.ts step 5: TTS + bake)
13. Final output                     (finalize.ts)
```

## File → Responsibility

```
src/cli/video.ts              entry point, parse flags, dispatch
src/video/pipeline.ts         plan + classify + script LLM
src/video/script/
  llm-generator.ts            Gemini script gen, truncated-JSON hard-fail
  generator.ts                stub-check regex, legacy fallback (test-only)
  contract.ts                 script structure validator
  critic.ts                   script critique (unused in director mode)
src/video/director-mode/
  runner.ts                   executeDirectorMode — orchestrates steps 4–13
  storyboard-md.ts            renders storyboard.md, isStoryboardApproved
src/video/director-preflight.ts   7 preflight checks (see below)
src/video/gemini-key-pool.ts  multi-key 429 rotation
src/video/library/
  clean.ts                    character library CRUD
src/video/narration/
  orchestrator.ts             TTS + bake + reconcile
src/video/finalize.ts         resolve final path + verification
skills/video-replicator/scripts/
  generate_gobananas.py       image gen (REST + MCP)
  seedance_client.py          create_task / poll_task / extract_video_url
  seedance_assets.py          upload to Asset Library
  seedance_prompt_director.py 3-control-level composer (unused in chained director mode)
  seedance_hooks.py           hook/camera/lighting library
  bunty_helpers.py            identity-lock kwargs builder pattern (canonical ref)

# Character creation is the `vclaw video character-auto-create` typed CLI surface.
```

## 7 Preflight Checks

Executed by `runDirectorPreflight()` and `runPreRenderPreflight()`:

| Check | Severity | What it catches |
|---|---|---|
| `CHAR_COVERAGE_MISSING` | error | Named character in script with no `--gb-character` binding |
| `CHAR_ID_NOT_FOUND` | error | `--gb-character Name:ID` where ID returns 404 from Go Bananas |
| `CHAR_NO_REF_IMAGE` | error | Library character exists but has no `reference_images[]` |
| `REF_IMAGE_UNREACHABLE` | error | Hydrated sheet image URL 404s |
| `PRONOUN_DRIFT` | warn | 2+ wrong-gender pronouns paired with known-gender character |
| `BEATS_NOT_DISTINCT` | error | Decomposed 3 beats have Jaccard >0.7 on all pairs |
| `CONTENT_FILTER_RISK` | warn | Prompt contains known Seedance-hazard phrase |
| `CHAR_SPECIES_DRIFT` | error | Organic character paired with synthetic descriptors in same sentence |
| `STYLE_ANCHOR_MISSING` | warn | Decomposed clip doesn't contain style directive |
| `SCRIPT_STUB_DESCRIPTION` | error | Scene description matches stub-filler pattern |
| `SCRIPT_DESC_TOO_SHORT` | error | <20 chars — too thin to decompose |
| `SCRIPT_CONTENT_FILTER_RISK` | warn | Script itself contains hazard phrase |

## Batched Decomposition (single Gemini call for all scenes)

`buildAllTimestampedPromptsBatch` in `runner.ts`:

- Builds one system prompt with all N scene descriptions, character locks, style context
- Single `fetchGeminiWithPool` call to `gemini-flash-latest`
- Parses response by `=== Scene N ===` block markers
- Falls back to deterministic template per-scene if block is missing or malformed
- `maxOutputTokens: 8000` to absorb Gemini 2.5's "thinking" overhead
- Retries with exponential backoff (2s → 30s → 60s) on 429/503

Why batched: 14 sequential calls hit rate limit in seconds. One call + rotation = rate-limit-friendly.

## Gemini Key Pool Rotation

`src/video/gemini-key-pool.ts`:

- Parses `GEMINI_API_KEYS` env (comma/semicolon/newline separated)
- Round-robin picks next non-cooling key
- On 429 → mark current key cooling for 60s (or honor `retry-after` header)
- If all cooling → wait for soonest
- Returns real `Response` object so caller code is unchanged

Result: 3+ keys from different GCP projects effectively eliminates 429s.

## Asset Library Chain (SUTUI)

Last-frame chaining flow:

1. After each clip downloads, ffmpeg extracts last frame as JPG
2. JPG uploaded to CDN via `utils_upload.ensure_urls` (gets HTTP URL)
3. HTTP URL uploaded to SUTUI Asset Library via `upload_character_asset` (gets `Asset://` URI)
4. `Asset://` URI is the `media_files[0]` for the NEXT clip
5. If Asset upload fails and we fall back to HTTP URL → BUT character refs are Asset://, runner DROPS the chain (prevents Seedance real-person filter cascade)

When all works: each clip sees `[asset://last_frame, asset://komo, asset://mochi, asset://hiro]` → reference_images mode → Seedance honors all 4.

## Content-Filter Auto-Fix

`DIRECTOR_AUTO_FIX_CONTENT=1` applies substitutions from `CONTENT_FILTER_HAZARDS` in `director-preflight.ts` AFTER decomposition, BEFORE Seedance submit:

```typescript
const CONTENT_FILTER_HAZARDS = [
  { pattern: /\bspectral\s+blade\b/gi, replacement: 'radiant staff of light', reason: 'weapon+spectral combo trips policy' },
  { pattern: /\bkatana\s+clash(es|ed|ing)?\b/gi, replacement: 'energies intertwine', ... },
  // ... 8 patterns total
];
```

## Narration Bake (4-step pipeline)

Per-scene `extendAndBakeNarration`:

1. Probe video + TTS audio durations
2. If TTS > video: apply `setpts=N*PTS` slow-motion to extend video
3. Mix: `amix` of (TTS * 1.0, music * 0.15 + fade, ambient * 0.30)
4. Combine: silent video + premix audio into final with `-c:v copy -c:a aac`

Per-clip narrated files live in `videos/clip_NN_narrated.mp4`. Final stitch concats them.

Known flake: `moov atom not found` on the master narrated — `remix-narrated.sh` re-muxes from the per-clip narrated files.

## Cost Flow

```
Script LLM (1 call):           ~$0.01
Decomposition LLM (1 batched): ~$0.02
Pre-render preflight:          $0 (local + 1 GB check)
Character hydration:           $0 (cached)
Post-decomp preflight:         $0 (local)
Storyboard gate:               $0 (just write)
────── GATE ──────
Seedance per clip:             ~$0.27–0.53 (scales with duration)
Asset uploads per clip:        ~$0.001
Stitch:                        $0 (local ffmpeg)
TTS per scene:                 ~$0.01
Narration bake:                $0 (local)
Final:                         $0

Typical 14-scene 15s clips:    ~$5.77
```

## Data Flow Diagram

```
┌─────────────┐  premise   ┌────────┐
│   CLI args  │──────────→│ Script │
└─────────────┘            │  LLM   │
                           └───┬────┘
                               ↓ scenes[]
                        ┌──────────────┐
                        │ Hydrate chars│ ─→ sheetImage URLs
                        └──────┬───────┘
                               ↓
                        ┌──────────────┐
                        │  Preflight 1 │ ─→ block on error
                        └──────┬───────┘
                               ↓
                        ┌──────────────┐
                        │  Decomposer  │ ─→ clipPrompts[]
                        └──────┬───────┘
                               ↓
                        ┌──────────────┐
                        │  Preflight 2 │ ─→ block on error
                        └──────┬───────┘
                               ↓
                        ┌──────────────┐
                        │ Auto-fix ?   │ ─→ sanitize prompts
                        └──────┬───────┘
                               ↓
                        ┌──────────────┐
                        │ Storyboard.md│ ─→ WRITE + EXIT
                        └──────┬───────┘
                  APPROVE ──────┤
                               ↓
                  for each clip:
                      ┌─────────────────┐
                      │ Seedance create │ ─→ task_id
                      └────────┬────────┘
                               ↓
                      ┌─────────────────┐
                      │ Poll until done │ ─→ video URL
                      └────────┬────────┘
                               ↓
                      ┌─────────────────┐
                      │ Download clip   │ ─→ clip_NN.mp4
                      └────────┬────────┘
                               ↓
                      ┌─────────────────┐
                      │ Extract lastfrm │ ─→ clip_NN_lastframe.jpg
                      └────────┬────────┘
                               ↓
                      ┌─────────────────┐
                      │ Upload Asset    │ ─→ Asset://... (next clip chain)
                      └─────────────────┘

                  after all clips:
                      ┌──────────────┐
                      │ Stitch silent│ ─→ stitched_silent.mp4
                      └──────┬───────┘
                             ↓
                      ┌──────────────┐
                      │ TTS + bake   │ ─→ clip_NN_narrated.mp4
                      └──────┬───────┘
                             ↓
                      ┌──────────────┐
                      │ Combine final│ ─→ final/*_director_narrated.mp4
                      └──────────────┘
```

## Extension Points

To add a new genre, only touch these files:
- `references/genres.yaml` — add entry
- `references/examples/<genre>.yaml` — add full example
- `references/prompt-recipes.md` — add template

To add a new style preset:
- `references/styles.md` — add description + pairings
- `references/genres.yaml` — add to applicable genre `style_presets` lists

To add a new script:
- `scripts/<name>.sh`
- `scripts/test-skill.sh` — register for self-test
- `SKILL.md` + `README.md` — document

To add a new preflight check:
- `src/video/director-preflight.ts` — add `check<Name>` function
- `src/video/director-preflight.ts` — include in `runDirectorPreflight` or `runPreRenderPreflight`
- `src/video/__tests__/director-preflight.test.ts` — add tests
- `references/troubleshooting.md` — document the new error code
