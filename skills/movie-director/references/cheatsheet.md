# Movie Director Cheat Sheet

Quick reference for experienced users. Full docs in `SKILL.md`.

## Two-command workflow

**Phase 1 — write storyboard.md (free):**
```bash
DIRECTOR_AUTO_FIX_CONTENT=1 \
  vclaw video create "<prose>" \
  --scenes 14 --production-mode director \
  --style villeneuve --color-grading neon-noir --platform youtube \
  --gb-character "Name1:ID1" --gb-character "Name2:ID2" --execute
```

**Phase 2 — approve + render:** prepend `VIDEOCLAW_APPROVE_STORYBOARD=1` to the SAME command.

**Phase 3 — re-mux narrated (if moov broken):**
```bash
cd <root>/projects/<slug> && \
  ls videos/ | grep narrated | sort | \
  awk -v D="$(pwd)/videos/" '{print "file \x27"D$0"\x27"}' > /tmp/concat.txt && \
  ffmpeg -y -f concat -safe 0 -i /tmp/concat.txt -c copy final/narrated-fixed.mp4
```

## Env vars quick-set

```bash
# .env file
GOOGLE_API_KEY=<script_llm_key>
GEMINI_API_KEYS=<key1>,<key2>,<key3>   # pool for 429 rotation
GO_BANANAS_API_KEY=<gb_key>
SUTUI_API_KEY=<asset_library_key>
ELEVENLABS_API_KEY=<tts_key>
```

## Control flag reference

| Flag | Effect |
|---|---|
| `VIDEOCLAW_APPROVE_STORYBOARD=1` | Skip gate → render |
| `DIRECTOR_AUTO_FIX_CONTENT=1` | Auto-substitute filter hazards |
| `SKIP_DIRECTOR_PREFLIGHT=1` | Bypass preflight ⚠️ |
| `SEEDANCE_CLIP_DURATION_SEC=N` | Override clip duration |
| `GEMINI_RPM_THROTTLE_MS=N` | Inter-scene throttle |

## Genre → style pairings (default)

| Genre | Style | Grading | Scenes |
|---|---|---|---|
| action-thriller | villeneuve | neon-noir | 14 |
| storybook | miyazaki | pastel-dream | 12 |
| documentary | nolan | desaturated | 10 |
| ugc-ad | spielberg | golden-hour | 10 |
| music-video | wong-kar-wai | neon-noir | 14 |
| short-film | villeneuve | teal-orange | 14 |
| romance | wes-anderson | pastel-dream | 12 |
| horror | fincher | ice-cold | 12 |
| sci-fi | villeneuve | teal-orange | 14 |
| fantasy | miyazaki | golden-hour | 14 |
| western | tarantino | desaturated | 12 |

## Character creation 1-liner

```bash
echo '[{"name":"Name","description":"<50-80 words>","style":"<matches video>"}]' > /tmp/c.json && \
  vclaw video character-auto-create --project <slug> --input /tmp/c.json
```

## Library operations

```bash
# List / filter
vclaw video library clean --name-regex "^Komo$" --dry-run

# Patch bloated base_prompt
vclaw video library clean --patch 244 --base-prompt "<new 50-80w>"

# Delete (requires confirmation, --yes to skip)
vclaw video library clean --ids 244,141,25
```

## Cost sanity check (approximate)

| Step | Per unit | Typical 14-scene |
|---|---|---|
| Seedance clip | ~$0.40 | ~$5.60 |
| Gemini decomposition (batched) | ~$0.01 | ~$0.01 |
| Gemini script gen | ~$0.01 | ~$0.01 |
| Go Bananas char creation (one-time) | ~$0.05 | $0.00–$0.15 |
| Go Bananas QA check (optional) | ~$0.003/scene | ~$0.04 |
| ElevenLabs TTS | ~$0.005/scene | ~$0.07 |
| **Total** | — | **~$5.75 per 3:30 video** |

## Hazard words (auto-fix catches these)

Bad | Safe
---|---
spectral blade | radiant staff of light
katana clashes | energies intertwine
body shatters / breaks apart | dissolves peacefully into starlight
stabs / slashes | deflects
taser | non-lethal pulse device
fires a gun | aims a non-lethal pulse device

## Debug failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `429 RESOURCE_EXHAUSTED` on decomposition | single key burst | add `GEMINI_API_KEYS` pool (3+ keys) |
| clip `ERROR: content filter` | weapon/violence language | `DIRECTOR_AUTO_FIX_CONTENT=1` or soften prose |
| clip N+ all fail after N succeeds | last-frame HTTP fallback polluting mix | check `SUTUI_API_KEY` is set; runner now drops chain automatically |
| narrated mp4 `moov atom not found` | narration bake race | run Phase 3 re-mux |
| 2+ clips polling timeout (20min) | Seedance queue | retry single scene via `seedance_client.create_task` or accept loss |
| Character looks inconsistent | species/gender drift in prompt | tighten library char `base_prompt` via PATCH; check `CHAR_SPECIES_DRIFT` warnings |
| All clips identical-looking | LLM fallback (no decomposition) | verify Gemini pool has unblocked keys; check `[director]   All N scenes decomposed by LLM` log |
| Storyboard gate doesn't fire | stale dist | `npm run build && retry` |

## 5-step sanity check before every run

1. `.env` has all 5 keys?
2. Characters exist in Go Bananas library (`vclaw video library clean --name-regex ... --dry-run`)?
3. `npm run build` succeeds?
4. Gemini pool has >1 key?
5. Content-filter auto-fix enabled?

Green on all 5 → run.
