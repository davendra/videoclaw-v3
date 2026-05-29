# DHUAAN grid-learnings — follow-up plan (2026-05-29)

Consolidated work plan from the DHUAAN: Last Stand A/B run and the
grid-leakage / content-filter findings. Two tracks: the **DHUAAN
deliverable** (creative, in `~/Documents/dhuaan-spinoff-workspace`) and the
**vclaw-v3 product** (code/docs, this repo).

## Key finding driving this plan

In a clean A/B (A = single keyframe as `image_url`; B = keyframe + 3×3
storyboard grid as `reference_images`; same prompt/model/duration), **A beat
B on every scene.** B not only reproduced the panel layout as a moving
9-panel split-screen (the leakage bug) but diluted composition so badly the
subject vanished (scene 3B = empty door, scene 4B = empty sky). Conclusion:
**lead with one well-composed keyframe as `image_url`; the storyboard grid's
value is upstream (planning + seeding keyframes), not as a live reference to
the video model.** The committed grid-leakage guard treats the symptom;
keyframe-only is the better path. See memory `seedance-grid-leakage`.

## Identity / character-fidelity constraint (found 2026-05-29)

Faces drift from the locked characters because **the locked character ref
sheets are never available to the video model.** xskill/ARK's "real person"
filter rejects photoreal char sheets as `reference_images`, so neither pass
sent the real faces to Seedance — identity rode entirely on the per-scene
keyframe (`image_url`) and then drifted across the 15 s clip (worst at tight,
near-frontal, late-in-clip frames). Levers, since face refs can't be
uploaded: (1) regenerate keyframes with the locked char IDs (go-bananas
`generate_with_multiple_characters`, 288/286/287) for a tight likeness — the
keyframe is the only identity carrier the filter allows; (2) shorter clips
(5–8 s) to cut drift; (3) try UseAPI `startFrameAssetId`; (4) prefer
wide/back/profile framing for group shots. See memory
`seedance-identity-via-keyframe`.

## Vendor playbook (xskill tmall storyboard→video tutorial, read 2026-05-29)

xskill's own tutorial confirms and corrects our approach:
- **Grid-leakage guard is vendor-prescribed.** Their exact instruction: "don't
  show the storyboard paper/grid/timecodes/text; convert the panels into a real
  continuous ad — otherwise the model treats the storyboard as the subject
  ('camera moving over the storyboard')." Matches the committed guard.
- **Different model + reference field than we used.** Documented storyboard→video
  call: `model_id: st-ai/super-seed2-lite`, `model: seedance2.0_fast_direct`,
  `image_files: ["<storyboard URL>"]`. We used `ark/seedance-2.0` /
  `seedance_2.0` with `image_url` / `reference_images`. The earlier
  "unsupported model `seedance2.0_fast_direct`" error was from pairing it with
  the wrong `model_id` (ark). **`image_files` is the documented field; we never
  tried it.**
- **6-panel (2×3), not 9-panel.** Identity clause: "preserve the reference's
  color, material, pattern, and usage." Shot rhythm: establish → reveal →
  use → detail → climax → resolve.
- **Shorter clips on timeout** (they dropped 15 s → 10 s) — confirms the drift
  lever.
- Caveat: tutorial subject is a PRODUCT (no real-person filter). It does NOT
  prove human faces upload cleanly. Untested: whether `st-ai/super-seed2` +
  `image_files` is more lenient with faces AND holds identity better.

### ROOT CAUSE FOUND (st-ai/super-seed2 Omni Reference)
The real miss: we never used **Omni Reference mode**. Authoritative schema
(`xskill_api.py info st-ai/super-seed2`): `functionMode: omni_reference`
takes `image_files` (up to 9) where the Nth image maps to `@image_file_N`,
and you bind each to a role in the prompt. We used `ark/seedance-2.0` with a
flat `reference_images`/`image_url` dump and NO role binding — so identity
never locked. Corrected call (REST body `{model, params, channel:null}` →
`POST /api/v3/tasks/create`):
```json
{ "model": "st-ai/super-seed2",
  "params": { "model": "seedance_2.0", "functionMode": "omni_reference",
    "ratio": "16:9", "duration": 15,
    "image_files": ["<Meera sheet>","<Tara sheet>","<Rani sheet>","<grid>"],
    "prompt": "@image_file_1 is Meera ... @image_file_2 is Tara ... @image_file_3 is Rani ... use @image_file_4 as the storyboard for shot order. <grid-leakage guard> ..." } }
```

### A0-experiment
Run ONE trio scene (scene 5 or 3 — worst identity) with the corrected
Omni Reference call. Confirms (a) identity locks via `@image_file_N`, (b) the
content filter accepts the char sheets in this mode. Cost ≈ 900–1350 credits
(fast/standard × 15 s). If it holds, re-run the trio scenes; product-side,
wire Omni Reference into the Seedance packet (B2).

## Track A — DHUAAN: Last Stand (the video)

- [ ] **A0. Fix character fidelity (NEW, high priority).** Faces drift from
  the locked characters because the char ref sheets are never sent to the
  video model (real-person filter blocks them) — see the constraint section
  below. Regenerate identity-locked keyframes (go-bananas, char IDs
  288/286/287) and/or shorten clips, then re-generate the affected scenes.
  This is the main quality gap.
- [x] **A1. Re-stitch final from the A (keyframe-only) takes.** DONE
  2026-05-29 — rebuilt `final/dhuaan_LAST_STAND.mp4` (75.21s/24MB) from
  `scene{1..5}.mp4`; prior B-take cut preserved as
  `dhuaan_LAST_STAND_Btakes.mp4`. Script: `stitch_final_A.sh`.
- [ ] **A2. Update `preview.html`** to mark A as the chosen takes.
- [ ] **A3. (Decision)** Include Scene 0 (night fire camp)? Still queued at
  UseAPI explore; never added to the cut.
- [ ] **A4. (Decision)** Add audio/music? Final is currently silent (`-an`).

## Track B — vclaw-v3 product

- [ ] **B1. Reflect "keyframe-only wins" into docs** (multi-shot framework +
  CLAUDE.md): make keyframe-only the documented default; demote grid-bearing
  variants to "use sparingly." *(needs sign-off — reverses current design)*
- [ ] **B2. Change `filmmaking-prompts.ts` packet default**: lead with
  keyframe/start-frame as the primary reference; make the grid opt-in rather
  than auto-included. Update tests.
- [ ] **B3. Document `--no-faces`** in `docs/CLI_REFERENCE.md` (loose end).
- [ ] **B4. (Optional) Empirically validate the grid-leakage guard** — re-run
  one scene with the guarded grid, confirm single-frame output. Only worth it
  if the grid path is kept.
- [ ] **B5. `npm run check:release-readiness-lite`** before anything lands.

## Track C — housekeeping

- [ ] **C1.** Open a PR for `codex/review-delivery-portal`? Both commits
  (`051022b` grid fix, `240320c` studio) are pushed.

## Recommended sequence

1. A1 + A2 (cheap, fixes the deliverable) ← **starting here**
2. B1 (lock strategy in docs — needs sign-off)
3. B2 + B3 (code + CLI ref match strategy)
4. B5 (full pre-flight)
5. Resolve decisions: A3, A4, B4, C1

## Status

- 2026-05-29: plan created; starting A1.
