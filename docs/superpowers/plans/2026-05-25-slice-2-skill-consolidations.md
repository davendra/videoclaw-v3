# Slice 2 — Skill Consolidations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 5 sets of overlapping skills in videoclaw v3 to reduce duplication, sharpen the user-facing entry points, and keep the catalog honest about which skills are canonical vs alias.

**Architecture:** Skill-markdown surgery, not source code. Each consolidation is one self-contained commit: read the affected SKILL.md files, fold or stub or delete, update `skills/catalog.json`, run guardrails (`check:skill-frontdoor` + `check:cleanroom-docs` + `npm test`). The catalog already declares the alias structure (`bunty`, `davendra-presenter`, `nex-presenter` → `aliasOf: brand-presenter`); what's missing is the actual SKILL.md reduction.

**Tech Stack:** Markdown + JSON. No TS code changes. Existing guardrails:
- `check:skill-frontdoor` (bash, ignore-list driven)
- `check:cleanroom-docs` (bash, pattern-driven)
- `check:movie-director-wrappers` (bash, syntax-checks `skills/movie-director/scripts/*.sh` — unaffected)
- `src/tests/skills-hygiene.test.ts` (node:test — read assertions before editing skills)
- `src/tests/package-scripts.test.ts` (node:test — asserts `skills/davendra-presenter/assets/davendra_intro_1.jpg` + `skills/nex-presenter/assets/nex_intro_1.jpg` ship in the npm package; the asset directories must survive)

**Source spec:** [`docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`](../specs/2026-05-25-videoclaw-v3-unification-design.md) §4 Slice 2.

**Effort target:** ~3 days, 5 commits.

---

## File Structure

**Files to create:**
- `skills/bunty/brand-profile.json` — per-presenter parameters (character_id, voice, brand assets, intro/outro)
- `skills/davendra-presenter/brand-profile.json` — same
- `skills/nex-presenter/brand-profile.json` — same

**Files to modify:**
- `skills/brand-presenter/SKILL.md` — make parametric on `{{brand}}` placeholders that the child skill resolves from its brand-profile.json
- `skills/bunty/SKILL.md` — reduce ~560 lines → ~25-line stub that points at `brand-presenter` + names its brand-profile
- `skills/davendra-presenter/SKILL.md` — reduce ~820 lines → ~25-line stub
- `skills/nex-presenter/SKILL.md` — reduce ~842 lines → ~25-line stub
- `skills/video-framework/SKILL.md` — augment with creative-brief's 7-question intake
- `skills/movie-director/SKILL.md` — fold director-video's unique content (mostly already covered)
- `skills/seedance-prompts/SKILL.md` — add music-video subsection
- `skills/catalog.json` — remove deleted entries, update alias declarations
- `scripts/check-skill-frontdoor.sh` — REMOVE the 3 presenter SKILL.mds from `ignore_paths` (after Commit 1 they no longer invoke Python directly)

**Files to delete:**
- `skills/video-replicator/SKILL.md` (DEMOTE — strip description so it doesn't auto-trigger; keep the directory + references/ + scripts/ which other skills depend on)
- `skills/director-video/SKILL.md` (after content folded into movie-director; delete the whole directory if nothing else references it)
- `skills/creative-brief/SKILL.md` (after content folded into video-framework; delete the whole directory)
- `skills/seedance-music-video-prompts/SKILL.md` (after merged into seedance-prompts; delete the whole directory)

**Asset directories that MUST survive:** `skills/davendra-presenter/assets/`, `skills/nex-presenter/assets/` (asserted in package-scripts.test).

**Guardrails to keep green after every commit:**
- `npm test` (490+ tests)
- `npm run check:skill-frontdoor`
- `npm run check:cleanroom-docs`
- `npm run check:release-readiness-lite` at slice end

---

## Commit Plan (5 commits)

### Task 1: Presenter family — parametric brand-presenter + 3 stubs (Commit 1)

**Goal:** Eliminate ~2200 lines of duplicate workflow across `bunty` / `davendra-presenter` / `nex-presenter` SKILL.mds. Make `brand-presenter` the parametric base; reduce the children to thin profile stubs.

**Files:**
- Read: `skills/brand-presenter/SKILL.md`, `skills/bunty/SKILL.md`, `skills/davendra-presenter/SKILL.md`, `skills/nex-presenter/SKILL.md`, `skills/catalog.json`
- Create: `skills/bunty/brand-profile.json`, `skills/davendra-presenter/brand-profile.json`, `skills/nex-presenter/brand-profile.json`
- Modify: `skills/brand-presenter/SKILL.md`, `skills/bunty/SKILL.md`, `skills/davendra-presenter/SKILL.md`, `skills/nex-presenter/SKILL.md`, `skills/catalog.json`, `scripts/check-skill-frontdoor.sh`

- [ ] **Step 1.1: Read all four SKILL.md files end-to-end**

Run:
```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
wc -l skills/brand-presenter/SKILL.md skills/bunty/SKILL.md skills/davendra-presenter/SKILL.md skills/nex-presenter/SKILL.md
cat skills/brand-presenter/SKILL.md
```

Then read each presenter SKILL.md in full. The 3 children duplicate substantial workflow; the goal is to identify their **variation points** (what's different between bunty/davendra/nex) vs the **common workflow** (what they share).

Expected variation points (extract these per presenter):
- `presenter_name` — "Bunty" / "Davendra" / "Nex"
- `character_id` — bunty=97, davendra=?, nex=?
- `host_persona` — short description (e.g., "3D Pixar-style executive presenter")
- `intro_asset` — path to the intro image
- `outro_asset` — path to the outro image
- `voice_id` — TTS voice
- `subject_domains` — what the presenter typically covers (cricket / corporate / tech)
- `trigger_phrases` — what user inputs route to this presenter (e.g., "cricket scorecard", "exec presenter", "tech commentator")

Everything else is workflow that lives in `brand-presenter/SKILL.md`.

- [ ] **Step 1.2: Define the brand-profile.json schema**

Create `schemas/video/brand-profile.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "brand-profile",
  "description": "Per-brand parameters that specialize brand-presenter for a specific host (bunty/davendra/nex/...).",
  "type": "object",
  "required": ["presenterName", "characterId", "hostPersona", "triggerPhrases"],
  "properties": {
    "presenterName": { "type": "string", "description": "Human-facing host name (e.g., 'Bunty', 'Davendra', 'Nex')." },
    "characterId": { "type": ["integer", "string"], "description": "Go Bananas character ID for identity-locking generations." },
    "hostPersona": { "type": "string", "description": "Short descriptor of the host's visual + tonal style." },
    "subjectDomains": { "type": "array", "items": { "type": "string" }, "description": "Topics the presenter is typically used for." },
    "triggerPhrases": { "type": "array", "items": { "type": "string" }, "description": "Phrases in user input that should route to this brand profile." },
    "introAsset": { "type": "string", "description": "Relative path to the intro image inside this skill's assets/." },
    "outroAsset": { "type": "string", "description": "Relative path to the outro image inside this skill's assets/." },
    "voiceId": { "type": "string", "description": "TTS voice identifier (provider-specific)." },
    "voiceNotes": { "type": "string", "description": "Free-form notes about voice tone, pacing, accent." },
    "scriptStyle": { "type": "string", "description": "How the presenter's commentary script is shaped (e.g., 'cricket play-by-play', 'executive summary')." }
  },
  "additionalProperties": false
}
```

- [ ] **Step 1.3: Write the three brand-profile.json files**

For each presenter, extract the variation points identified in Step 1.1 into `brand-profile.json`.

Create `skills/bunty/brand-profile.json` (example shape — replace values with what bunty's SKILL.md actually documents):

```json
{
  "presenterName": "Bunty",
  "characterId": 97,
  "hostPersona": "Cartoon Indian commentator in an orange blazer; warm, excitable, deeply knowledgeable about cricket.",
  "subjectDomains": ["cricket", "play-cricket scorecards", "match-day analysis"],
  "triggerPhrases": [
    "Match Day Analysis with Bunty",
    "cricket scorecard",
    "play-cricket URL",
    "Bunty"
  ],
  "introAsset": "assets/bunty_intro.jpg",
  "outroAsset": "assets/bunty_outro.jpg",
  "voiceId": "EXTRACT_FROM_SKILL_MD",
  "voiceNotes": "EXTRACT_FROM_SKILL_MD — tone, accent, pacing notes",
  "scriptStyle": "Cricket play-by-play with English/Hindi colloquialisms; references batting averages, partnerships, run rates."
}
```

For `skills/davendra-presenter/brand-profile.json` — extract from davendra-presenter's SKILL.md:

```json
{
  "presenterName": "Davendra",
  "characterId": "EXTRACT_FROM_SKILL_MD",
  "hostPersona": "3D Pixar-style executive presenter; measured, professional, deck-style commentary.",
  "subjectDomains": ["corporate decks", "executive summaries", "investor updates"],
  "triggerPhrases": [
    "executive presenter",
    "exec deck",
    "Davendra",
    "corporate narrated video"
  ],
  "introAsset": "assets/davendra_intro_1.jpg",
  "outroAsset": "assets/davendra_outro_1.jpg",
  "voiceId": "EXTRACT_FROM_SKILL_MD",
  "voiceNotes": "EXTRACT_FROM_SKILL_MD",
  "scriptStyle": "Executive summary — concise, structured, slide-anchored narration."
}
```

For `skills/nex-presenter/brand-profile.json`:

```json
{
  "presenterName": "Nex",
  "characterId": "EXTRACT_FROM_SKILL_MD",
  "hostPersona": "3D Pixar-style tech commentator; technical depth with accessible delivery.",
  "subjectDomains": ["tech reviews", "product walkthroughs", "developer commentary"],
  "triggerPhrases": [
    "tech commentator",
    "tech review",
    "Nex",
    "product walkthrough video"
  ],
  "introAsset": "assets/nex_intro_1.jpg",
  "outroAsset": "assets/nex_outro_1.jpg",
  "voiceId": "EXTRACT_FROM_SKILL_MD",
  "voiceNotes": "EXTRACT_FROM_SKILL_MD",
  "scriptStyle": "Tech commentary — explanatory, concrete, with concrete code/spec references."
}
```

**`EXTRACT_FROM_SKILL_MD`** placeholders mean: open the corresponding SKILL.md and find the actual value. Don't ship literal `EXTRACT_FROM_SKILL_MD` strings; they're TODO markers.

- [ ] **Step 1.4: Update brand-presenter/SKILL.md to be parametric**

The current `skills/brand-presenter/SKILL.md` is 85 lines and likely already generic. Modify it to reference brand-profile.json explicitly. Add this section near the top (after the YAML frontmatter):

```markdown
## Brand profile

This skill is parametric. Each child skill (`bunty`, `davendra-presenter`,
`nex-presenter`, future presenters) provides a `brand-profile.json` that
specializes this workflow for a specific host.

Schema: [`schemas/video/brand-profile.schema.json`](../../schemas/video/brand-profile.schema.json).

When this skill is invoked via a child alias, the orchestrator should:
1. Load the child's `brand-profile.json`.
2. Substitute `{{presenterName}}`, `{{characterId}}`, `{{hostPersona}}`,
   `{{introAsset}}`, `{{outroAsset}}`, etc. throughout the workflow below.
3. Use `triggerPhrases` to confirm intent routing was correct.
```

Keep the rest of the workflow as-is.

- [ ] **Step 1.5: Reduce bunty/SKILL.md to a stub**

Replace the contents of `skills/bunty/SKILL.md` with this stub (about 25 lines):

```markdown
---
name: bunty
description: |
  "Match Day Analysis with Bunty" — cricket scorecard or play-cricket URL
  to a narrated video with Bunty (cartoon Indian commentator in orange
  blazer, character_id=97). Triggers on: cricket scorecards, play-cricket
  URLs, "Match Day Analysis", "Bunty".
aliasOf: brand-presenter
---

# Bunty (brand-presenter specialization)

Bunty is a `brand-presenter` specialization. The full workflow lives in
[`skills/brand-presenter/SKILL.md`](../brand-presenter/SKILL.md). This
stub provides the brand parameters that specialize the parent workflow.

**Brand profile:** [`brand-profile.json`](./brand-profile.json)

**Trigger:** When a user provides a cricket scorecard PDF, a play-cricket
URL, or asks for "Match Day Analysis", route to `brand-presenter` with
this profile loaded.

**Assets:** `assets/` holds Bunty's intro/outro reference images +
auxiliary character-sheet materials. The brand-profile.json points at
them.

**Why this stub exists:** prior to Slice 2 (2026-05-25 cutover), Bunty's
full workflow lived in this SKILL.md as a 560-line copy of the
brand-presenter pipeline. The duplication is now consolidated in
`brand-presenter` with this profile-driven specialization.
```

- [ ] **Step 1.6: Reduce davendra-presenter/SKILL.md to a stub**

Replace the contents of `skills/davendra-presenter/SKILL.md` with:

```markdown
---
name: davendra-presenter
description: |
  Create a professional narrated video from a PDF slide deck featuring
  **Davendra**, a 3D Pixar-style executive presenter. Triggers on:
  "executive presenter", "exec deck video", "Davendra", "corporate
  narrated video".
aliasOf: brand-presenter
---

# Davendra Presenter (brand-presenter specialization)

Davendra is a `brand-presenter` specialization. The full workflow lives
in [`skills/brand-presenter/SKILL.md`](../brand-presenter/SKILL.md).
This stub provides the brand parameters.

**Brand profile:** [`brand-profile.json`](./brand-profile.json)

**Trigger:** When a user wants a narrated corporate / executive video
with a 3D Pixar-style host, route to `brand-presenter` with this profile
loaded.

**Assets:** `assets/davendra_intro_1.jpg` and the corresponding outro
image. The brand-profile.json points at them.

**Why this stub exists:** prior to Slice 2, the full ~820-line workflow
duplicated brand-presenter. Now consolidated via `brand-profile.json`.
```

- [ ] **Step 1.7: Reduce nex-presenter/SKILL.md to a stub**

Same pattern. Replace `skills/nex-presenter/SKILL.md` with:

```markdown
---
name: nex-presenter
description: |
  Create a professional narrated video from a PDF slide deck featuring
  **Nex**, a 3D Pixar-style tech commentator. Triggers on: "tech
  commentator", "tech review video", "Nex", "product walkthrough".
aliasOf: brand-presenter
---

# Nex Presenter (brand-presenter specialization)

Nex is a `brand-presenter` specialization. The full workflow lives in
[`skills/brand-presenter/SKILL.md`](../brand-presenter/SKILL.md). This
stub provides the brand parameters.

**Brand profile:** [`brand-profile.json`](./brand-profile.json)

**Trigger:** When a user wants a narrated tech / product video with a
3D Pixar-style host, route to `brand-presenter` with this profile loaded.

**Assets:** `assets/nex_intro_1.jpg` and the corresponding outro image.
The brand-profile.json points at them.

**Why this stub exists:** prior to Slice 2, the full ~842-line workflow
duplicated brand-presenter. Now consolidated via `brand-profile.json`.
```

- [ ] **Step 1.8: Verify catalog.json already declares the alias structure**

Run:
```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
jq '.skills[] | select(.id == "bunty" or .id == "davendra-presenter" or .id == "nex-presenter" or .id == "brand-presenter")' skills/catalog.json
```

Expected: brand-presenter has `role: canonical-entry` and `specializations: [davendra-presenter, nex-presenter, bunty]`. The three children have `status: alias`, `aliasOf: brand-presenter`. If anything's missing or wrong, fix it.

- [ ] **Step 1.9: Remove the 3 presenter SKILL.mds from check-skill-frontdoor ignore list**

The ignore list at `scripts/check-skill-frontdoor.sh` lines 16-22 still lists `bunty`, `davendra-presenter`, `nex-presenter` as ignored because they invoked Python pipeline scripts directly. After this commit, the stubs no longer reference those scripts (the brand-presenter parent handles invocation). Remove them.

Edit `scripts/check-skill-frontdoor.sh`:

```bash
# Before:
ignore_paths=(
  "skills/seedance-prompts/SKILL.md"
  # Presenter skills legitimately invoke their bundled Python pipeline
  # under skills/video-replicator/scripts/ (ported in Phase 4a from the
  # canonical workspace). Those scripts ARE the implementation; calling
  # them is the right way. The scanner predates the pipeline import.
  "skills/bunty/SKILL.md"
  "skills/davendra-presenter/SKILL.md"
  "skills/nex-presenter/SKILL.md"
  # movie-director references the legacy script paths in its
  # references/ subdir; those docs are historical-reference-style.
  # The SKILL.md itself uses the vclaw CLI surface.
)

# After:
ignore_paths=(
  "skills/seedance-prompts/SKILL.md"
  # movie-director references the legacy script paths in its
  # references/ subdir; those docs are historical-reference-style.
  # The SKILL.md itself uses the vclaw CLI surface.
)
```

- [ ] **Step 1.10: Run guardrails**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
npm run check:skill-frontdoor
npm run check:cleanroom-docs
```

Expected: tests green (493 pass), skill-frontdoor passes (the stubs no longer reference Python directly), cleanroom-docs passes. If a test fails, the assertion is likely against old SKILL.md content — check and adapt.

- [ ] **Step 1.11: Commit**

```bash
git add skills/brand-presenter/ skills/bunty/ skills/davendra-presenter/ skills/nex-presenter/ schemas/video/brand-profile.schema.json scripts/check-skill-frontdoor.sh skills/catalog.json
git commit -m "Slice 2: presenter family parametric — brand-profile.json + 3 stubs (~2200 lines deleted)"
```

---

### Task 2: video-replicator demotion (Commit 2)

**Goal:** `video-framework` becomes the sole video front door; `video-replicator` stops auto-firing on user intent but stays as a reference document for the 7-mode legacy surface.

**Files:**
- Read: `skills/video-replicator/SKILL.md` (371 lines), `skills/video-framework/SKILL.md`, `skills/catalog.json`
- Modify: `skills/video-replicator/SKILL.md` (strip description), `skills/catalog.json`

- [ ] **Step 2.1: Read both SKILL.mds**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
cat skills/video-framework/SKILL.md
head -60 skills/video-replicator/SKILL.md
```

Confirm: video-replicator currently has a YAML frontmatter `description:` field that auto-triggers on "make me a video" type intents — same intents video-framework should handle.

- [ ] **Step 2.2: Strip video-replicator's description (demote to reference-only)**

Edit `skills/video-replicator/SKILL.md`. Modify the YAML frontmatter:

```yaml
---
name: video-replicator
description: |
  Reference-only documentation of the legacy 7-mode video-replicator
  surface. Do NOT use this skill to trigger work — use
  `video-framework` instead. This document is preserved as historical
  context for the modes and their parameters; the new user-facing entry
  point is `video-framework`.
---
```

The key change: the description explicitly says "Do NOT use this skill to trigger work" so Claude's auto-trigger matcher routes elsewhere. Add a banner at the top of the body content:

```markdown
> **DEPRECATED FOR USER-FACING USE.** This skill's auto-trigger has been
> disabled in Slice 2. The user-facing video front door is now
> [`video-framework`](../video-framework/SKILL.md). This file remains as
> reference documentation for the legacy 7-mode surface.
```

Leave the rest of the file content intact for reference.

- [ ] **Step 2.3: Update catalog.json**

Change `video-replicator`'s catalog entry from its current category to:

```json
{
  "id": "video-replicator",
  "category": "video",
  "status": "deprecated-reference",
  "role": "reference",
  "supersededBy": "video-framework"
}
```

- [ ] **Step 2.4: Run guardrails**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
npm run check:skill-frontdoor
npm run check:cleanroom-docs
```

Expected: green.

- [ ] **Step 2.5: Commit**

```bash
git add skills/video-replicator/SKILL.md skills/catalog.json
git commit -m "Slice 2: demote video-replicator to reference; video-framework is sole front door"
```

---

### Task 3: Merge director-video into movie-director (Commit 3)

**Goal:** Eliminate the director-video skill; movie-director is the richer of the two and absorbs anything director-video had that movie-director doesn't.

**Files:**
- Read: `skills/movie-director/SKILL.md`, `skills/director-video/SKILL.md`, `skills/catalog.json`
- Modify: `skills/movie-director/SKILL.md` (fold in additive content if any), `skills/catalog.json`
- Delete: `skills/director-video/` (entire directory after fold)

- [ ] **Step 3.1: Diff the two SKILL.mds**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
diff -u skills/director-video/SKILL.md skills/movie-director/SKILL.md | head -100
```

Identify content in `director-video/SKILL.md` that's NOT in `movie-director/SKILL.md`. Examples to look for:
- Triggers/keywords movie-director doesn't catch
- Workflow steps movie-director doesn't document
- References to scripts/assets only in director-video/

- [ ] **Step 3.2: Fold additive content into movie-director**

If anything's additive, add it to `skills/movie-director/SKILL.md` in the appropriate section. If director-video is a strict subset of movie-director (likely), no edits to movie-director needed — proceed to deletion.

If you ADD content, mark it with a brief comment line so future maintainers see the lineage:

```markdown
<!-- Folded in from skills/director-video/SKILL.md in Slice 2 (2026-05-25). -->
```

- [ ] **Step 3.3: Check if anything else references director-video**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
grep -rln "director-video" skills/ src/ scripts/ docs/ 2>/dev/null | grep -v "/director-video/" | head -10
```

If anything references it (e.g., other SKILL.mds linking to it), update those references to point to movie-director instead.

- [ ] **Step 3.4: Delete the director-video directory**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
rm -rf skills/director-video/
```

- [ ] **Step 3.5: Update catalog.json**

Remove the `director-video` entry entirely from `skills/catalog.json`. Also update `movie-director`'s `specializes` field — it currently says `specializes: director-video` which becomes stale.

```json
{
  "id": "movie-director",
  "category": "video",
  "status": "imported",
  "specializes": "video-framework",
  "role": "specialist"
}
```

(Or whatever specialization makes sense — pick `video-framework` as the parent since director-video is going away.)

- [ ] **Step 3.6: Run guardrails**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
npm run check:movie-director-wrappers
npm run check:skill-frontdoor
npm run check:cleanroom-docs
```

Expected: green. `check:movie-director-wrappers` syntax-checks files under `skills/movie-director/scripts/`; unaffected by director-video deletion.

- [ ] **Step 3.7: Commit**

```bash
git add skills/movie-director/SKILL.md skills/catalog.json
git rm -r skills/director-video/
git commit -m "Slice 2: merge director-video into movie-director (deleted)"
```

---

### Task 4: Fold creative-brief into video-framework (Commit 4)

**Goal:** creative-brief's 7-question intake becomes video-framework's intake mode. creative-brief skill goes away.

**Files:**
- Read: `skills/creative-brief/SKILL.md`, `skills/video-framework/SKILL.md`, `skills/catalog.json`
- Modify: `skills/video-framework/SKILL.md` (add intake section), `skills/catalog.json`
- Delete: `skills/creative-brief/` (entire directory)

- [ ] **Step 4.1: Read both files**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
cat skills/creative-brief/SKILL.md
cat skills/video-framework/SKILL.md
```

Identify creative-brief's 7-question intake structure. It's likely a numbered list of prompts the operator asks the user.

- [ ] **Step 4.2: Add an "Intake mode" section to video-framework/SKILL.md**

Append to `skills/video-framework/SKILL.md` (or insert in the appropriate location — read the file to decide):

```markdown
## Intake mode (formerly `creative-brief`)

When the user's request is too vague to route directly, drop into intake
mode and ask the 7 questions below. Skip questions whose answer is
already clear from the request.

<!-- Folded in from skills/creative-brief/SKILL.md in Slice 2 (2026-05-25). -->

1. [QUESTION 1 FROM creative-brief/SKILL.md]
2. [QUESTION 2 ...]
3. [QUESTION 3 ...]
4. [QUESTION 4 ...]
5. [QUESTION 5 ...]
6. [QUESTION 6 ...]
7. [QUESTION 7 ...]

After answers are collected, map them to `vclaw video brief --project
... --title ... --intent ... --aspect-ratio ... --quality ...` flags
and proceed with the regular video-framework dispatch.
```

Extract the actual 7 questions from creative-brief/SKILL.md. Don't ship literal placeholders.

- [ ] **Step 4.3: Check for references to creative-brief elsewhere**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
grep -rln "creative-brief" skills/ src/ scripts/ docs/ 2>/dev/null | grep -v "/creative-brief/" | head
```

Update any references to point at video-framework's intake mode.

- [ ] **Step 4.4: Delete creative-brief directory**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
rm -rf skills/creative-brief/
```

- [ ] **Step 4.5: Update catalog.json**

Remove the `creative-brief` entry from `skills/catalog.json`.

- [ ] **Step 4.6: Run guardrails**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
npm run check:skill-frontdoor
npm run check:cleanroom-docs
```

Expected: green.

- [ ] **Step 4.7: Commit**

```bash
git add skills/video-framework/SKILL.md skills/catalog.json
git rm -r skills/creative-brief/
git commit -m "Slice 2: fold creative-brief into video-framework intake mode (deleted)"
```

---

### Task 5: Merge seedance-prompts variants (Commit 5)

**Goal:** seedance-music-video-prompts is a strict subset of seedance-prompts. Fold its content into the parent and delete the variant.

**Files:**
- Read: `skills/seedance-prompts/SKILL.md`, `skills/seedance-music-video-prompts/SKILL.md`, `skills/catalog.json`
- Modify: `skills/seedance-prompts/SKILL.md` (add music-video subsection), `skills/catalog.json`
- Delete: `skills/seedance-music-video-prompts/` (entire directory)

- [ ] **Step 5.1: Read both files**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
cat skills/seedance-prompts/SKILL.md
cat skills/seedance-music-video-prompts/SKILL.md
```

Identify what music-video-prompts uniquely covers (genres, beat-sync, lyric-overlay considerations, etc.).

- [ ] **Step 5.2: Add a music-video subsection to seedance-prompts/SKILL.md**

Append (or insert at the appropriate section break) to `skills/seedance-prompts/SKILL.md`:

```markdown
## Music-video prompts (formerly seedance-music-video-prompts)

When the user wants a music video specifically — beat-synced visuals,
lyric-driven scene changes, performance shots — use the music-video
prompt patterns below in addition to the general Seedance prompt
patterns above.

<!-- Folded in from skills/seedance-music-video-prompts/SKILL.md in Slice 2 (2026-05-25). -->

[ACTUAL CONTENT EXTRACTED FROM seedance-music-video-prompts/SKILL.md]
```

Replace `[ACTUAL CONTENT EXTRACTED ...]` with the actual content. Don't ship the placeholder.

- [ ] **Step 5.3: Delete seedance-music-video-prompts directory**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
rm -rf skills/seedance-music-video-prompts/
```

- [ ] **Step 5.4: Update catalog.json**

Remove the `seedance-music-video-prompts` entry (if present).

- [ ] **Step 5.5: Run guardrails**

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run build && npm test 2>&1 | tail -5
npm run check:skill-frontdoor
npm run check:cleanroom-docs
```

Expected: green. Note: `seedance-prompts/SKILL.md` is in the cleanroom-docs ignore list — adding music-video content there won't trigger the guardrail.

- [ ] **Step 5.6: Commit**

```bash
git add skills/seedance-prompts/SKILL.md skills/catalog.json
git rm -r skills/seedance-music-video-prompts/
git commit -m "Slice 2: merge seedance-music-video-prompts into seedance-prompts (deleted)"
```

---

## Final gate: full release-readiness-lite

After all 5 commits land, run the slice-completion gate:

```bash
cd /Users/davendrapatel/Documents/GitHub/videoclaw-v3
npm run check:release-readiness-lite 2>&1 | tail -10
```

Expected: `release-readiness-lite checks passed`.

If any guardrail fails:
- `check:skill-frontdoor` — likely a presenter stub still references Python; re-check the stubs and either reword to avoid the patterns or add the file back to the ignore list (with comment justifying it).
- `check:cleanroom-docs` — unlikely; the ignore list already covers `docs/superpowers/` from Slice 1.
- `npm test` — likely a skills-hygiene test asserting a specific string in a SKILL.md you deleted/changed. Read the test, update the assertion to match v3 reality.

---

## Failure modes + rollback paths

- **Each commit is a single git revert.** If any of the 5 commits causes issues downstream, `git revert <sha>` restores cleanly.
- **Asset directories are sacred.** Tests assert `skills/davendra-presenter/assets/davendra_intro_1.jpg` + `skills/nex-presenter/assets/nex_intro_1.jpg` ship in the npm package. NEVER delete those directories — only reduce the SKILL.md files inside.
- **video-replicator's directory MUST survive.** Other skills (the presenters) reference `skills/video-replicator/scripts/...` Python pipeline. Task 2 strips its SKILL.md description but leaves the scripts intact.
- **catalog.json is hand-edited JSON.** A trailing comma or missing field breaks parsing. After every edit, run `jq . skills/catalog.json > /dev/null` to validate before committing.
- **Skill stubs use YAML frontmatter.** The `---` delimiters and `name:` / `description:` / `aliasOf:` fields must be exact for Claude's skill loader to pick them up. Test by running `vclaw schema --json | jq '.commands | length'` after each commit — number shouldn't drop (commands don't change in Slice 2; only skills do).

---

## What ships after Slice 2

After all 5 commits:
- 3 presenter SKILL.mds reduced from ~560/820/842 → ~25 lines each (~2150 lines deleted)
- video-replicator no longer auto-triggers on user intent
- director-video deleted
- creative-brief deleted (intake folded into video-framework)
- seedance-music-video-prompts deleted (folded into seedance-prompts)
- catalog.json cleaner: fewer canonical entries, alias structure honest
- check-skill-frontdoor ignore list shorter

**Skills count change:** 53 → ~49 (drops director-video, creative-brief, seedance-music-video-prompts; presenters stay as stubs).

**What does NOT ship:**
- Python pipeline fold (Slice 3) — `skills/video-replicator/scripts/` Python is still there
- Bun standalone surface collapse (Slice 4)
- MCP server + external skills pack (Slice 5)
- Migration of remaining ~40 vclaw.ts handlers to VclawError (incremental v3.x alpha work)

Next slice to plan: **Slice 3 — Python fold (F2a)** (3-4 weeks, biggest engineering piece).
