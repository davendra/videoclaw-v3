---
name: bunty
description: |
  "Match Day Analysis with Bunty" — cricket scorecard or play-cricket URL to a narrated video with Bunty (cartoon Indian commentator in orange blazer, character_id=97). Triggers on:
  - Cricket scorecard PDF or play-cricket URL
  - "do the Bunty thing", "Bunty match recap", "scorecard video", "match day analysis"
  - Any cricket result expecting the Bunty pipeline
  Output: ~2:30 narrated MP4 with Bunty lip-synced intro+outro and 12-15 NotebookLM-generated slides with TTS commentary.
---

# Bunty — Match Day Analysis Skill

## Trigger patterns

- User shares a `play-cricket.com/.../results/{id}` URL
- User shares a cricket scorecard PDF
- User says "do the Bunty thing", "make a Bunty video", "match day analysis", "Bunty recap"
- User mentions "wbindians" + a result

## ⚠️ READ FIRST — Bunty character drift

Bunty (Go Bananas `character_id=97`) drifts on the Pro model. Two known modes:
1. **Clean-shaven slim young guy** — Pro discards the character ref when the scene description shifts mood. Confirmed ~2 of 3 generations without anchoring.
2. **Curly hair instead of slicked-back combover** — Pro generalises "curly" from the canonical "thick black curly moustache" line and applies it to the hair. All 3 official reference images for character_id=97 show slicked-back combover; any curly-hair Bunty is drift, not canon.

**ALWAYS use `bunty_helpers.build_bunty_image_kwargs()`** (helper at `skills/video-replicator/scripts/bunty_helpers.py`). It prepends the canonical hair-locked prompt and a negative prompt that blocks both drift modes. Never call `mcp__go-bananas__generate_image` with just `character_id=97` + a vibe description.

If intro and outro Bunty look like different people after generation, regen with the same helper. `python3 bunty_regen.py --segment intro|outro --location <preset> --print-prompt` emits the current canonical kwargs ready to spread into the MCP call.

## What this skill produces

A `~2:30` MP4 in `projects/{slug}/final/match_day_analysis_BUNTY.mp4`:
- Chained Bunty intro (16s, 2× lip-sync clips with voice change)
- 13–16 NotebookLM-generated stat cards (incl. team-sheet, final-scorecards × 2, and league-table closer) with Bunty TTS narration
- Chained Bunty outro (16s, 2× lip-sync clips with voice change)
- Fade-through-black at section boundaries

## Pipeline (URL → final video)

The flow is implemented as scripts in `skills/video-replicator/scripts/`. Run them from the `videoclaw-v2` repo root.

`cd` there first — all paths below are relative to that root, including `projects/<slug>/...`.

### Step 1 — URL → NotebookLM deck

```bash
python3 skills/video-replicator/scripts/bunty_match_to_deck.py \
  --url "https://wbindians.play-cricket.com/website/results/<id>" \
  --slug "YYYY-MM-DD_wicc-vs-<opponent>"
```

⚠️ **Always pass the play-cricket URL ID** — the script auto-appends `/print` (the bare URL only returns the result summary; `/print` returns the full scorecard with player names, bowling figures, and fall of wickets, which is what NotebookLM needs to produce a useful deck with named heroes).

What this does:
- Playwright fetches the URL → captures **8 assets** from both /print AND the live page:
  - `match.pdf` (print PDF — NLM source)
  - `match_branding.png` (full-page /print screenshot)
  - `scorecard_screenshot.png` (live page, **icons preserved** — captain shield + keeper gloves visible)
  - `ball_by_ball_screenshot.png` (live page, Ball by Ball tab — captures key wickets and final-over drama)
  - `division_table_screenshot.png` (live page → follow `/division/{id}` link — current league standings for the closing slide)
  - `match_hero.png` (live page viewport at scroll-top — the splash card with both team logos + "WON BY X WICKETS" result banner; title-card source for the deck)
  - `home_logo.png` + `away_logo.png` (badge_image PNGs extracted from `.team-cov` / `.team-att` `<img>` srcs on the result hero — authentic club crests for slides)
- `nlm notebook create` + `nlm source add --wait` — uploads **9 sources** (PDF + 4 screenshots + hero + 2 logos + URL)
- `nlm slides create --format presenter_slides` with focus prompt that explicitly tells NLM the scorecard screenshot is the authoritative source of truth for captain/keeper roles
- Polls until ready (~90-180s)
- Downloads `deck.pdf`, extracts slide images
- Writes `analysis/deck_meta.json` sidecar (style + num_slides for `bunty_animate_slides.py`)

Output:
- `projects/<slug>/reference/{match.pdf, match_branding.png, scorecard_screenshot.png, ball_by_ball_screenshot.png, division_table_screenshot.png, notebook_id.txt, match_facts.txt}`
- `projects/<slug>/slides/{deck.pdf, slide_001.jpg ... slide_NNN.jpg}`
- `projects/<slug>/analysis/{slides.json, deck_meta.json}`

**Why the screenshots matter**: `pdftotext --layout` strips inline glyphs (shield 🛡, gloves 🧤). Without screenshots, NotebookLM has no way to tell which player is captain vs keeper — confirmed on Match 6 (2026-05-12) where the deck called the keeper's 49 a "captain's knock". The live-page screenshot preserves these icons; NLM's vision-capable slide generator can read them.

**Stop here for user review of the deck.** Do NOT proceed without explicit approval.

### Step 2 — Read each slide and draft Bunty narration (TWO PASSES)

**Load Bunty's voice guide first**: `/Users/davendrapatel/.claude/projects/-Users-davendrapatel-Documents-GitHub-video-creation-projects/memory/bunty-voice-guide.md`. This codifies catchphrases (`Shabash!`, `Kya baat hai!`, `Hai Ram!`), tone registers (hype / mock-outrage / affection / sympathy), and cultural metaphors. Without it, drafts come out generic Sky Sports — competent but not Bunty.

**Cross-check facts**: `projects/<slug>/reference/match_facts.txt` contains the full scorecard text (auto-extracted from the /print PDF). Every player name, score, and bowling figure in the narration MUST match this file. The captain's name in particular — the deck sometimes generalises to "the skipper", but the scorecard has the real name (asterisk-marked).

**Tone-check the deck**: NotebookLM sometimes produces harsh language ("humiliation", "embarrassment", "domination complete"). Bunty is generous. When you read each slide, SOFTEN harsh phrasings in your narration draft — "to avoid total humiliation" becomes "to put up a fight, dignity restored". The deck is data; Bunty is the voice. Don't let the deck's tone leak into the narration.

**Detect win-vs-loss early**: After reading `match_facts.txt`, check the result line ("Wellingborough Indians CC - Won" vs "Thurleigh CC - Won"). If WICC LOST, switch entire voice register to **TEAM-LOST** (see voice guide). No hype, no triumphant sign-off. Loss-register lines like "the Indians took a beating", "credit where it's due", "lesson learned". Match 3 (2026-05-11 Thurleigh loss) is the reference example.

**Pass 1 — Facts**: Read each `slide_NNN.jpg` and draft ~20-25 word lines with the right numbers, names, arc beats. Boring but correct.

**Pass 2 — Bunty-fy**: Rewrite each line per the voice guide. Inject catchphrases, cultural metaphors, direct address ("my friends", "boys"), tone shifts (hype on big knocks, mock-outrage on collapses, sympathy on opposition heroes, affection on home stars).

**Team-sheet slide narration (beat #2)**: The deck now generates a team-sheet slide right after the title card showing both teams' playing XIs with captain (shield) + keeper (gloves) icons. Bunty's narration on this slide should:
- Name the captain and keeper of each team explicitly ("Captain X and keeper Y for the home side; Captain A and keeper B for the visitors")
- Highlight 1-2 players to watch per team (top scorers / hero bowlers from `match_facts.txt` — Bunty's "watch for" intuition)
- Keep it under 30 seconds spoken (~70-80 words max)
- Avoid reading every player name (tedious — pick the storytellers)

Example: *"And here are the playing elevens, my friends! For the Indians — Captain Elina Patel leading, Het Patel behind the stumps, with Karina Patel and Rishi Shahani ready to roll the arm over. For the OGs — Captain Anya Khagram, with Kishan Patel and Krina Patel as the danger batters. Twenty-two players, ONE story. Let's go!"*

**Final-scorecard slide narration (last 2 beats)**: The deck now ends with two scorecard slides — one per team — showing the full batting figures (name / how out / runs / balls / innings total). Bunty's narration on each scorecard should:
- Recap the top 2-3 contributors with their figures ("Nagarkar's 137 not out, Jena's 57, captain Jiga's 59")
- Mention the bowling hero / top performer relative to the slide (e.g. the team that BATTED owes its total to those batters; the team that BOWLED earlier doesn't go on this slide — its bowling already had a dedicated slide)
- Keep under 30 seconds spoken
- Treat both scorecards equally — even on a big WICC win, acknowledge the opposition's top scorer with affection. The data is on screen, so Bunty doesn't need to read every figure — just frame the story

Example: *"There's the Indians' scorecard, my friends — Nagarkar one-thirty-seven not out, Jena fifty-seven, captain Jiga fifty-nine. Three-forty for five in fifty overs. What a batting effort!"* followed by *"And Weldon's scorecard — Economon a bold forty-seven, Khan thirty-eight, but Joshi's six-fer ended them at one-sixty all out. Well fought, lads."*

**League-table slide narration (FINAL beat)**: The deck now closes with a division-table slide pulled from the play-cricket league standings page (the `/division/{id}` link from the match header). It shows position, team name, played, won, lost, and points — with WICC's row visually highlighted. Bunty's narration on this slide should:
- State WICC's current position in plain language ("top of the table", "second place", "ninth out of twelve" etc.) — the position is the headline
- Reference points + games played to give the standing context ("twenty points from three games", "sixty points clear at the top")
- Cite 1-2 of the chasers / rivals to set up the season narrative ("Barby breathing down our necks on forty-seven", "Long Buckby still in the hunt")
- Close with a forward-looking sign-off — what's next, what to defend, what to chase ("plenty to play for, my friends; we go again next week")
- Keep under 25 seconds spoken — the table speaks for itself, Bunty just narrates the headline
- If WICC LOST this match, the league-table tone changes: acknowledge the slip ("dropped to fourth"), credit the team ahead, set up the bounce-back ("long season, my friends, plenty of cricket left")

Example (WICC top of table after a win): *"And there it is on the table, boys — Wellingborough Indians, position ONE, three from three, sixty points. Sixty points clear at the top of Division Eleven West! Barby in the rear view on forty-seven, but the Indians are flying. What a start to the season. Onwards."*

Write the final Bunty-fied version to `projects/<slug>/audio/tts/editable_transcript.json`:

```json
{
  "scenes": {
    "1": "Saturday afternoon at Memorial Sports Ground...",
    "2": "...",
    ...
    "NN": "..."
  }
}
```

⚠️ **Format gotcha**: `scenes` is a DICT keyed by scene number string, NOT a list.

Also draft 4 Bunty lip-sync lines (intro 17, intro 19 chained, outro 20, outro 21 chained). Outro 21 (sign-off) capped at 15-20 words for dramatic pacing.

**Show the user the full narration plan and wait for explicit approval before generating any videos.**

### Step 2.5 — Pre-flight gates (NEW, recommended)

Two cheap Gemini Vision checks catch issues before paying for TTS / Veo:

```bash
# Verify each slide's narration actually describes that slide's image.
# Catches off-by-one beats (e.g. NLM compresses toss into title slide).
python3 skills/video-replicator/scripts/bunty_narration_check.py \
  --project "projects/<slug>"

# Predict which slides will trip Veo's image content filter (warriors/swords).
# Saves ~$0.50 per rejected scene at quality tier.
python3 skills/video-replicator/scripts/bunty_image_filter_check.py \
  --project "projects/<slug>"
```

Both gates exit non-zero on issues. Fix the transcript / regenerate problematic slides BEFORE proceeding to Step 3. Cost: ~$0.01 + 30s for both gates.

### Step 3 — Generate TTS

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --edit "projects/<slug>/audio/tts/editable_transcript.json" \
  --output-dir "projects/<slug>/audio/tts" \
  --voice-id "nwj0s2LU9bDWRKND5yzA" --yes
```

Bunty's voice ID is `nwj0s2LU9bDWRKND5yzA` for both narration AND voice change. Cost: ~$0.05 for 13 scenes.

### Step 4 — Generate the 2 Bunty source images (intro + outro)

**Pick a location for the match first.** Bunty doesn't have to report from the cricket boundary — variety across the catalog keeps the videos fresh. Intro + outro of the same match should share a location for visual continuity.

**Recommended: `--auto-ground`** (May 18 addition) — anchors Bunty to the *actual* match ground parsed from `match_facts.txt` (e.g. "Avenue Road", "Bernard Weston Pavilion") instead of the generic Memorial Sports Ground baked into the `cricket-ground` preset. Pick this when you want the visual to match the venue the match was actually played at; pick `--location <preset>` when you want a non-cricket setting (tropical beach, food truck, etc.).

```bash
# Option A: auto-ground (anchored to the real venue from match_facts.txt)
python3 skills/video-replicator/scripts/bunty_regen.py \
  --project projects/<slug> --segment intro --auto-ground --print-prompt
python3 skills/video-replicator/scripts/bunty_regen.py \
  --project projects/<slug> --segment outro --auto-ground --print-prompt

# Option B: manual ground override (when auto-parse fails or you want a different label)
python3 skills/video-replicator/scripts/bunty_regen.py \
  --project projects/<slug> --segment intro --ground "Avenue Road" --print-prompt

# Option C: location preset (variety / non-cricket setting)
python3 skills/video-replicator/scripts/bunty_regen.py --list-locations
python3 skills/video-replicator/scripts/bunty_regen.py --segment intro --location tropical-beach --print-prompt
python3 skills/video-replicator/scripts/bunty_regen.py --segment outro --location tropical-beach --print-prompt
```

Precedence: `--auto-ground` > `--ground <name>` > `--location <preset>`. `--auto-ground` soft-fails to the `--location` preset if the regex can't parse a ground from `match_facts.txt` (logged to stderr). `--print-prompt` logs `scene_source` provenance to stderr so you can confirm which path was taken.

Available presets (each pairs an energetic-daytime intro with a reflective-dusk outro at the same setting):

| Location | Vibe |
|---|---|
| `cricket-ground` (default) | Northamptonshire boundary, golden hour, Memorial Sports Ground vibe |
| `tropical-beach` | White-sand beach, palm trees, turquoise ocean / twilight bonfire |
| `fancy-car` | Vintage British convertible on a scenic country road / dusk overlook |
| `indian-restaurant` | Upscale Indian restaurant with brass lanterns / after-hours candle glow |
| `mumbai-rooftop` | Marine Drive skyline / Queen's Necklace lights at twilight |
| `food-truck` | Mumbai chaat stall with neon signage / evening neon blaze |
| `london-cab` | Black cab with London skyline / lit-up dusk skyline |
| `mountain-hike` | Himalayan peaks with prayer flags / alpenglow + campfire |
| `tea-plantation` | Darjeeling tea fields, misty hills / evening hill light |
| `cricket-museum` | Vintage cricket memorabilia gallery / after-hours picture lights |

Each `--print-prompt` outputs a JSON dict ready to spread into `mcp__go-bananas__generate_image`. Run those MCP calls. Save the returned URLs.

See the **READ FIRST — Bunty character drift** callout at the top of this skill. The helper above wraps the canonical hair-locked prompt; never bypass it.

Download the URLs into `projects/<slug>/images/run001_scene_17_frame.jpg` (intro) and `run001_scene_20_frame.jpg` (outro).

### Step 5 — Bunty Veo I2V intro pair (scenes 17, 20)

```bash
python3 skills/video-replicator/scripts/parallel_video_gen.py \
  --product "<slug>" --mode frames-to-video \
  --scenes '{"17":"<intro1 prompt>","20":"<outro1 prompt>"}' \
  --lip-sync \
  --dialogue '{"17":"<intro1 dialogue>","20":"<outro1 dialogue>"}' \
  --image-run run001 --ratio landscape --quality fast \
  --variations 1 --allow-stale --continue --yes
```

Note: `--images-dir` now defaults to `projects/<slug>/images`. Cost: 20 Veo credits.

### Step 6 — Extract last frames for chained scenes 19, 21

```bash
ffmpeg -y -sseof -0.1 -i projects/<slug>/videos/run001_scene_17.mp4 \
  -frames:v 1 -q:v 2 projects/<slug>/images/run001_scene_19_frame.jpg
cp projects/<slug>/images/run001_scene_19_frame.jpg \
   projects/<slug>/images/run001_scene_19_frame_landscape.jpg
# repeat for 20→21
```

### Step 7 — Bunty Veo I2V chained pair (scenes 19, 21)

Same `parallel_video_gen.py` invocation as step 5 but with scenes 19, 21.

### Step 8 — Voice-change all 4 Bunty clips

```bash
python3 skills/video-replicator/scripts/generate_tts.py \
  --voice-change --videos-dir "projects/<slug>/videos" \
  --scenes "17,19,20,21" --voice-id "nwj0s2LU9bDWRKND5yzA" \
  --seed 42 --remove-bg-noise --yes
```

### Step 9 — Stitch

```bash
python3 skills/video-replicator/scripts/stitch_bunty.py \
  --project "projects/<slug>" --num-slides <N> \
  --intro-scenes 17,19 --outro-scenes 20,21 --fade 0.75 \
  --copy-to-documents
```

`--copy-to-documents` parses teams + date from `reference/match_facts.txt` and copies the final video to `~/Documents/WICC Bunty Videos/Match Day Analysis - {teams} - {date}{ - ANIMATED}.mp4`, then opens it. Use `--no-open` to skip the auto-open.

If concat-filter fails (13+ segments hit FFmpeg sandbox limit), the script auto-falls back to demuxer concat.

### Step 9b (optional) — Animated slides

Replace the default static slide segments with F2V seamless loops (subtle ambient motion: newsprint shimmer, halftone drift, chrome sheen — varies by style). Roughly doubles the polish of the slide stretch; costs ~10 Veo credits per slide.

```bash
# 1. Generate F2V loops + bake TTS into per-slide segments
#    --style and --num-slides auto-detect from analysis/deck_meta.json sidecar
#    (written by bunty_match_to_deck.py), so you can omit both flags.
#    --draft-prompts uses Gemini Vision to write a slide-specific subtle-motion
#    prompt per slide (much better variety than the flat template — strongly
#    recommended). Falls back to the style template if Gemini is unavailable.
python3 skills/video-replicator/scripts/bunty_animate_slides.py \
  --project "projects/<slug>" --draft-prompts --yes

# 2. Stitch with --animated + --copy-to-documents
python3 skills/video-replicator/scripts/stitch_bunty.py \
  --project "projects/<slug>" --num-slides <N> \
  --intro-scenes 17,19 --outro-scenes 20,21 --animated --copy-to-documents
```

Animation styles (one preset per deck style — match the style passed to `bunty_match_to_deck.py`):

| Style | Motion vocabulary |
|---|---|
| `broadcast` (default) | Soft luminance drift, subtle accent-colour breath, ambient light sheen |
| `tabloid` | Newsprint shimmer, ink-splatter pulse, halftone drift, red glow |
| `minimal` | Slow accent-colour luminance breath, hero-stat weight shimmer |
| `comic` | Halftone Ben-Day dot drift, ambient line work motion, panel colour breath |
| `indian-tv` | Slow chrome shimmer, gentle gold/saffron pulse, soft warm light bloom |

**Prompt source precedence** (helper picks the highest available):
1. `--prompts-json <path>` — explicit per-scene prompts JSON
2. `--draft-prompts` — Gemini Vision drafts a unique per-slide prompt, blends with `--style` vocab (recommended)
3. Existing `projects/<slug>/scenes_animated_slides.json` (preserved across re-runs)
4. `--style` template applied to every slide (least variety, last resort)

**Auto-recovery on Google content filter**: if a scene's animation prompt trips Veo's content filter (the slide imagery + prompt vocab together get flagged), the helper auto-retries that scene with `SAFE_FALLBACK_PROMPT` ("gentle ambient light shift, soft warm glow drift, subtle particle motion"). No manual recovery needed for typical failures.

**Vocab linter**: before submission, the helper warns when any per-scene prompt contains high-risk tokens. Current `HIGH_RISK_VOCAB` (extended Match 13):
- Force/violence family: `burst`, `explosion`, `blast`, `smash`, `destroyer`, `dramatic`, `intense`, `violent`, `crash`, `collide`, `shatter`, `explode`, `bombard`, `annihilate`
- Electricity / lightning family (added Match 13 after Jena 54* slide kept tripping the filter): `lightning`, `electricity`, `electric`, `bolt`, `spark`, `sparkle`, `shock`, `fireworks`, `flash`, `thunder`, `blaze`

These often pair badly with slides that already show dramatic imagery. Suppress with `--skip-lint` if you're sure.

**Gemini draft validation** (Match 13 retro): `--draft-prompts` now hard-errors when Gemini returns 0 drafts, fewer drafts than slides, or all-identical drafts. Previously these silently fell back to the flat style template for every slide, killing per-slide variety with no warning.

**Partial Veo failure no longer aborts** (Match 13 retro): if one slide trips the content filter even after the safe-fallback retry, the bake step warns + lists missing scenes + continues with the rest. `stitch_bunty.py --animated` falls back to static-image encoding for any missing animated segment, so a single rejection no longer kills the whole animated run.

Notes:
- `bunty_animate_slides.py` defaults `--quality fast` (~10 credits per slide, 8s F2V loop). Use `--quality quality` for higher fidelity if needed.
- The helper skips Veo for slides whose F2V video already exists — safe to re-run.
- `--segments-only` re-encodes segments without calling Veo (use after manually swapping F2V videos in `videos/`).
- `--overwrite-prompts` forces a fresh prompts file (useful after switching `--style`).
- `stitch_bunty.py --animated` falls back to static-image encoding for any slide whose animated segment is missing — partial coverage works.
- Output filename auto-suffixes `_animated.mp4` to A/B against the static version.

## Recovery — when a slide has the wrong fact burned in

If the deck (slide image itself) misattributes a role or stat — e.g. "captain's knock" on what's actually the keeper's innings — the audio narration alone can't fix it because the wrong text is rendered into the slide PNG. **Fix upstream by re-prompting NotebookLM with an authoritative facts source**:

```bash
# 1. Write a corrections file at projects/<slug>/reference/match_facts_corrected.txt
#    explicitly stating: "Player X is the captain. Player Y is the wicket-keeper.
#    Player Y's 49 is THE KEEPER'S KNOCK, not the captain's knock." Include the
#    line: "THIS DOCUMENT IS THE AUTHORITATIVE SOURCE FOR PLAYER ROLES."

# 2. Upload the corrections as a new source to the existing notebook:
nlm source add <notebook-id> --wait --wait-timeout 180 \
  --file projects/<slug>/reference/match_facts_corrected.txt \
  --title "CORRECTED facts (authoritative roles)"

# 3. Regenerate the deck with a focus prompt that explicitly cites the corrections
#    source as the source of truth:
nlm slides create <notebook-id> --format presenter_slides --length default --confirm \
  --focus "...your normal style focus... CRITICAL ACCURACY: The source titled 'CORRECTED facts (authoritative roles)' is the source of truth for player roles..."

# 4. Once status=completed:
nlm download slide-deck <notebook-id> --format pdf -o projects/<slug>/slides/deck_v2.pdf
python3 skills/video-replicator/scripts/extract_pdf_slides.py \
  --pdf projects/<slug>/slides/deck_v2.pdf \
  --output-dir projects/<slug>/slides_v2 \
  --output-json projects/<slug>/analysis/slides_v2.json --dpi 200

# 5. Verify v2 slides look correct, then swap:
mv slides slides_v1 && mv slides_v2 slides
mv analysis/slides.json analysis/slides_v1.json && mv analysis/slides_v2.json analysis/slides.json
# Update analysis/deck_meta.json num_slides if count changed.

# 6. Rewrite narration to match the new (better) beats, regen TTS, regen F2V loops
#    with --draft-prompts --overwrite-prompts, re-stitch.
```

Confirmed effective on Match 6 (2026-05-12): the v2 deck used the corrected facts and produced a richer 13-beat narrative including dedicated Ram Patel "Vice Grip" slide + ball-by-ball final-over drama slides.

## Recovery — when Bunty drifts

If the user says "Bunty looks wrong" / "redo intro/outro" / "this isn't Bunty":

```bash
# 1. Get the canonical prompt
python3 skills/video-replicator/scripts/bunty_regen.py --segment intro --print-prompt
# (or --segment outro)

# 2. Run mcp__go-bananas__generate_image with the printed kwargs

# 3. Run the regen with the URL the MCP call returned
python3 skills/video-replicator/scripts/bunty_regen.py \
  --project projects/<slug> --segment intro --image-url "https://..."
```

`bunty_regen.py` wraps everything: wipes stale outputs, runs Veo for both scenes, voice-changes, re-encodes only the 2 affected segment files (preserves slide segments), and demuxer-concats into the final video.

## Optional polish (Tier 3 — wire when needed)

These features are already supported by existing scripts but not yet integrated into the default Bunty flow. Wire them in when you want to push polish further:

### Background music (Kie.ai/Suno → stitch overlay)

```bash
# 1. Generate background music (~160s for a Bunty video)
python3 skills/video-replicator/scripts/generate_music.py \
    --prompt "Calm cricket highlights bed, light tabla rhythm, 90 BPM" \
    --duration 170 --output projects/<slug>/audio/background.mp3

# 2. Pass to stitch_bunty.py — currently the script doesn't take --audio, so use stitch_video.py instead OR add post-stitch FFmpeg overlay:
ffmpeg -y -i projects/<slug>/final/<slug>_BUNTY.mp4 \
    -i projects/<slug>/audio/background.mp3 \
    -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.10,afade=t=out:st=160:d=4[a1];[a0][a1]amix=inputs=2:duration=first[aout]" \
    -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k \
    projects/<slug>/final/<slug>_BUNTY_with_music.mp4
```
Memory recommends music at 10% volume (`0.10`) and 3-4s fade-out for a professional close.

### Title card (4s slate before intro)

```bash
# Generate a Bunty-style title card (uses Go Bananas + PIL text overlay)
python3 skills/video-replicator/scripts/generate_title_card.py \
    --project projects/<slug> \
    --title "WICC vs Stony Stratford" \
    --subtitle "9 May 2026 · Memorial Sports Ground" \
    --duration 4 --yes
# Outputs: projects/<slug>/assets/title_card_4s.mp4

# Prepend via concat list in bunty_re_encode_segments.py output, or assemble via:
python3 skills/video-replicator/scripts/nex_assemble.py \
    --project projects/<slug> --num-slides <N> \
    --intro-scenes 17,19 --outro-scenes 20,21 \
    --title-card projects/<slug>/assets/title_card_4s.mp4 --yes
```

### Club watermark overlay (logo bottom-right)

```bash
# Re-encode the final stitched video with a corner watermark
ffmpeg -y -i projects/<slug>/final/<slug>_BUNTY.mp4 \
    -i wicc_logo.png \
    -filter_complex "[1]scale=iw*0.15:-1[wm];[0][wm]overlay=W-w-20:H-h-20:format=auto:alpha=0.8" \
    -c:a copy projects/<slug>/final/<slug>_BUNTY_watermarked.mp4
```

Or use stitch_video.py's built-in `--overlay` if you switch from stitch_bunty.py.

### Soft subtitles (mov_text — Reapit/Davendra pattern, ported 2026-05-14)

FFmpeg on macOS Homebrew ships **without `--enable-libass`** so the `subtitles=...` burn-in filter fails. The reliable alternative is the `mov_text` codec — soft subtitles muxed into the MP4 container, toggleable in QuickTime/VLC.

For Bunty match recaps where the venue is noisy or accents are thick, soft captions are a polish win.

```python
# generate_bunty_srt.py — one-off snippet
import json
from pathlib import Path

p = Path("projects/<slug>")
manifest = json.load(open(p / "audio/narration_manifest.json"))
transcript = json.load(open(p / "audio/tts/editable_transcript.json"))

# Bunty intro adds ~16s (scenes 17 + 19 chained lip-sync)
INTRO_OFFSET = 16.0

def fmt_srt(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int((s % 1) * 1000):03d}"

cursor = INTRO_OFFSET
lines = []
for i, scene_idx in enumerate(sorted(manifest["scenes"], key=int), start=1):
    dur = manifest["scenes"][scene_idx]["duration"]
    text = transcript["scenes"][scene_idx]
    lines.append(f"{i}\n{fmt_srt(cursor)} --> {fmt_srt(cursor + dur)}\n{text}\n")
    cursor += dur

# Also append cues for outro scenes 20 + 21 (use dialogue_pair2.json + VC clip durations)
Path(p / "final/subtitles.srt").write_text("\n".join(lines))
```

```bash
# Mux SRT as soft subtitle stream
ffmpeg -y \
  -i "projects/<slug>/final/<slug>_BUNTY.mp4" \
  -i "projects/<slug>/final/subtitles.srt" \
  -map 0:v -map 0:a -map 1:0 \
  -c:v copy -c:a copy \
  -c:s mov_text -metadata:s:s:0 language=eng -metadata:s:s:0 title="English" \
  "projects/<slug>/final/<slug>_BUNTY_subs.mp4"
```

Sidecar SRT lives at `projects/<slug>/final/subtitles.srt` for users who want external `.srt` files. Don't waste time fighting libass — soft `mov_text` exports cleanly to YouTube/Vimeo and lets viewers toggle them off.

### Pre-animated slide deck source (Reapit pattern, ported 2026-05-14)

If a user already has a slide animation (e.g. exported from Figma / After Effects / a custom HyperFrame render) and wants Bunty narration over the top instead of the NotebookLM deck path, skip the deck + F2V pipeline entirely.

```bash
# Probe + plan
ANIM=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "{user_provided_anim.mp4}")
TTS_TOTAL=$(python3 -c "
import json
m = json.load(open('projects/<slug>/audio/narration_manifest.json'))
print(f\"{sum(v['duration'] for v in m['scenes'].values()):.3f}\")
")
PTS=$(python3 -c "print($TTS_TOTAL / $ANIM)")
echo "Animation: ${ANIM}s | TTS total: ${TTS_TOTAL}s | PTS factor: ${PTS}"

# Keep PTS in 0.85 - 1.20 range. Outside that, adjust narration length instead.

# Slow (or speed) the animation to match
ffmpeg -y -i "{user_provided_anim.mp4}" \
  -filter:v "setpts=${PTS}*PTS" -an \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  "projects/<slug>/final/slides_slow.mp4"

# Build concatenated narration track from per-scene TTS
python3 -c "
import json
m = json.load(open('projects/<slug>/audio/narration_manifest.json'))
for i in range(1, len(m['scenes']) + 1):
    print(f\"file 'audio/tts/scene_{i}_tts.mp3'\")
" > projects/<slug>/_narration_list.txt
ffmpeg -y -f concat -safe 0 -i projects/<slug>/_narration_list.txt \
  -c:a aac -b:a 192k projects/<slug>/audio/narration_track.m4a

# Mux slowed video + narration → drop-in seg_slides.mp4
ffmpeg -y \
  -i "projects/<slug>/final/slides_slow.mp4" \
  -i "projects/<slug>/audio/narration_track.m4a" \
  -c:v copy -c:a aac -b:a 192k -map 0:v -map 1:a \
  "projects/<slug>/final/segments_animated/seg_slides.mp4"
```

Then `stitch_bunty.py --animated` picks up `segments_animated/` as usual. Note: `setpts` does frame-aware time stretch without re-rendering content. PTS=1.024 means slow 2.4%; outside 0.85-1.20 the visual feel breaks.

This bypasses the NotebookLM deck path entirely — useful for non-cricket sports recaps where the user already has a designed motion graphics deck and just wants Bunty as the voice + presenter bumpers.

## Helpers

| Script | Purpose |
|---|---|
| `bunty_match_to_deck.py` | URL → NotebookLM deck → slide images + match_facts.txt. Auto-appends `/print`. Writes `analysis/deck_meta.json` sidecar (read by `bunty_animate_slides.py`). `--list-styles` to see visual style options. `--style {broadcast,tabloid,minimal,comic,indian-tv}` |
| `bunty_dialogue_lint.py` | Word-count linter for dialogue files. Run BEFORE Veo gen to catch >28-word lip-sync risks. `--strict` for pre-Veo gate. |
| `bunty_helpers.py` | Canonical Bunty image kwargs (hair-locked since 2026-05-12) + `BUNTY_LOCATIONS` registry (10 location presets pairing intro+outro) + `build_intro_line()` / `build_signoff_line()` + `parse_ground_from_match_facts()` / `build_match_ground_scene_description()` (May 18 — anchors Bunty to the real match venue parsed from match_facts.txt) |
| `bunty_regen.py` | Full segment redo (intro or outro). Flags: `--auto-ground` (anchor to real match ground from `match_facts.txt`, requires `--project`), `--ground <name>` (manual venue override), `--location <preset>` (pick from `--list-locations`), `--segment intro\|outro`, `--print-prompt` (preview kwargs without running; logs `scene_source` provenance to stderr). |
| `bunty_re_encode_segments.py` | Surgical re-encode + demuxer concat. Use when only a subset of segments changed (e.g. one dialogue shortened). Avoids re-encoding all 18 segments. |
| `bunty_animate_slides.py` | Optional Step 9b. Stages slide images → drives `parallel_video_gen.py --f2v-loop` → loops + TTS-bakes → `final/segments_animated/seg_slide_NN.mp4`. 5 style presets (`--list-styles`). Flags: `--draft-prompts` (Gemini Vision per-slide drafting), `--skip-lint` (suppress vocab warnings), `--overwrite-prompts`, `--segments-only`. Auto-recovers from content-filter rejections with safe-fallback prompt. Pairs with `stitch_bunty.py --animated`. |
| `bunty_narration_check.py` | Pre-TTS gate. Gemini Vision verifies each slide's narration matches the slide image. Catches off-by-one beats (e.g. NLM compressing toss into title) before paying for TTS. Run BEFORE `generate_tts.py`. Exit 1 on mismatch, exit 1 on partial unless `--allow-partial`. |
| `bunty_image_filter_check.py` | Pre-F2V gate. Gemini Vision predicts which slides will trip Veo's content filter (warriors/swords/supernatural figures). Run BEFORE `bunty_animate_slides.py` to flag at-risk slides. Saves ~$0.50 per rejected scene at quality tier. Verdicts: safe / risky / likely-blocked. |
| `bunty_correct_deck.py` | NLM deck correction loop. When a deck has wrong facts burned in, upload a corrections .txt + regen the whole deck in one command. Replaces 8 manual `nlm` invocations. Reports per-slide diff hashes so you know which slides changed. |
| `stitch_bunty.py` | Full stitch from scratch. Output: `{slug}_BUNTY.mp4` (or `{slug}_BUNTY_animated.mp4` with `--animated`). Demuxer fallback handles 13+ segment concat. |

## Reference

- **Bunty character**: Go Bananas `character_id=97`, voice ID `nwj0s2LU9bDWRKND5yzA`, both intro/outro Veo lip-sync use `--lip-sync --dialogue` flags.
- **Canonical features**: Round face, thick black handlebar moustache (curly only at the tips — moustache only; the helper guards against "curly" bleeding into hair via the negative prompt), chubby cheeks, **slicked-back combover (NOT curly hair)**, slightly chubby middle-aged build. See `bunty_helpers.BUNTY_CANONICAL_PROMPT`.
- **Scene numbers (convention)**: 17 = Intro 1, 19 = Intro 2 (chained), 20 = Outro 1, 21 = Outro 2 (chained). Slides are 1..N.
- **Style focus prompt for NotebookLM** lives in `bunty_match_to_deck.py:STYLE_PROMPT` — bold Sky Sports broadcast aesthetic, hero-sized stats, team-colour accents.

## Cost & wall time

| Step | Cost | Time |
|---|---|---|
| URL → deck (NotebookLM via `nlm`) | free | 3-5 min |
| 2 Bunty Pro images | ~$0.04 | 30s |
| 13 TTS clips | ~$0.05 | 90s |
| 4 Veo I2V `fast` lip-sync clips | 40 credits (~$0.05) | 6-8 min |
| Voice change × 4 | included | 30s |
| Stitch | free | 1-2 min |
| **Total — static slides** | **~$0.15 + 40 credits** | **~15 min** |
| Step 9b animated slides (optional, 12-15 F2V loops at `fast`) | +120-150 credits (~$0.60) | +10-15 min |
| **Total — animated slides** | **~$0.15 + 160-190 credits** | **~25-30 min** |

## Mandatory user-approval gates

Per project memory rules — **two gates** govern every Bunty run:

1. **GATE 1: deck review** — after Step 1 completes, show the user the slide deck and wait for approval before drafting narration.
2. **GATE 2: narration review** — after Step 2 completes, show all 12-15 slide narration scripts + the 4 lip-sync lines and wait for an explicit "go" before generating videos.

Enforcement: never proceed past either gate without confirmation, even when the user has previously approved a similar plan.
