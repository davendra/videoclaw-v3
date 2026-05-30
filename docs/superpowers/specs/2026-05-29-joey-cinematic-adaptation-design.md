# Joey Cinematic-AI Adaptation — Design Spec

**Date:** 2026-05-29
**Status:** Approved decisions captured; awaiting user spec review before plan.
**Source:** `joey-vs-videoclaw-gap-audit` workflow (run `wf_11504b70-665`, 7 agents) —
read both of Joey's SKILL.md files (`banana-pro-director-2.0`, `cinema-worldbuilder-pro-2.0`)
in full (48 techniques extracted) and audited the videoclaw-v3 craft layer across
cinematography/prompt-rules, character/reference, image/provider, and post-production.

---

## Goal

Fold the "non-slop" cinematic techniques from Joey's masterclass into videoclaw-v3's
**existing** craft layer — strictly additively — so generated prompts and assembled cuts
carry the anti-plastic physics prose, the 10-block Seedance prompt contract, broader
lighting/grade/hook registers, a mid-gray/Rembrandt character path, and per-clip
cut-at-3s + match-grade post — without disturbing the proven `ark/seedance-2.0` +
Asset-Library identity-lock path or the 9/3/3 reference budget.

## Guiding principle

**The architecture is not the gap.** videoclaw-v3 already has the hard parts:
the detail-leveled emitter system (`cinematography.ts` — typed `CameraMove`/`LIGHTING`/
`GRADE`/`CINEMA_MODES`/`HOOK_PATTERNS`/`audioMix`), standing scrubbers (`prompt-rules.ts`),
the multi-shot planner + validator with seedable non-repeating grids and provider presets
(`multi-shot-prompt.ts` / `prompt-quality.ts`), the reference-sheet artifact store
(`reference-sheets.ts`), the ark/Asset-Library identity lock with a hard 9/3/3 budget
(`seedance-asset-library.ts` / `native-seedance.ts`), and a real FFmpeg assembly pipeline
(`assemble/`, `post-production.ts`). Joey's edge is **prose and presets we have not
written yet**, plus one **latent payload-binding bug** — not systems we lack.

**Gap matrix (53 techniques mapped): 10 have · 27 partial · 16 missing.**

## Approved decisions (locked with user, 2026-05-29)

1. **10-block Seedance prompt → new default.** Reshapes every Seedance packet to Joey's
   block order. Golden packet tests + the multi-shot/filmmaking-prompts smokes move to the
   new expected output (expected work, not a regression). The byte-stable safety net now
   protects the *new* format.
2. **Photoreal faces → image-generator prompts only, plus a guard.** WS3/WS8 emit prompts
   for the image generators (Go Bananas / GPT-image / Soul-Cinema-style), where faces are
   allowed. Add a guard that **blocks photoreal face references from the `seedance-direct`
   route** (ARK content-filters real faces; our no-faces silhouette register stays the ARK
   path). See `[[seedance-identity-via-keyframe]]`, `[[no-suitui-ai-mcp]]`.
3. **Character sheet — 8-shot stays default; 6-panel mid-gray is opt-in.** No change to
   existing projects' sheet prompts.
4. **@imageN positional binding → live ARK probe first (Phase-0 gate).** Confirm whether the
   ARK/Seedance endpoint honors `reference_images` array order == `@imageN` before WS5/WS6
   rely on it; then wire per result. (Credit note below.)
5. **Grade lift/gamma/gain → prompt prose now; real ffmpeg color math deferred.** The new
   `GradePreset` fields emit as descriptors; an actual `eq=`/LUT match-grade step is a later
   increment with an external `.cube`.
6. **Topaz/VEAI upscale → gated opt-in behind an env flag**, no-op if the CLI is absent.
7. **Delivery → one full spec → execute end-to-end** via subagent-driven-development.

## The keystone

A single new `captureRealismBlock(opts, d)` emitter in `cinematography.ts` closes ~7 of the
anti-plastic gaps at once: per-zone specular kill, subsurface scattering, strand-hair
physics, volumetric haze, contrast-curve-stated-three-ways, moisture-without-shine (gated),
and 35mm grain. It also **de-hardcodes `richCinematographySuffix()`** (verified at
`filmmaking-prompts.ts:177` to take no args and hardcode `neutral-studio` + `teal-orange`,
ignoring caller genre/lighting/grade). Everything else composes on top of it.

---

## Workstreams

Each workstream is additive: new opt-in options/fields with existing defaults preserved
(except WS6's packet shape, which the user elected to make the new default — golden tests
update accordingly). Files cited were verified by the audit with line numbers.

### WS0 — Phase-0 ARK positional-binding probe (gate for WS5/WS6)
- **What:** A minimal live probe against the same ARK/Seedance endpoint the DHUAAN project
  uses, submitting 2 reference images in a known order and checking whether
  `reference_images[0]`/`[1]` map to `@image1`/`@image2` subject-lock semantics, or whether
  array order is ignored.
- **Branch:** If honored → WS5 Subject Lock binds `@imageN` to array order and we document
  the contract + fix the payload binding. If ignored → emit `@imageN` as **prompt-text
  guidance only**, do not claim hard positional binding, and still fix the
  `buildReferenceMap` payload bug (labels currently never reach the API payload;
  Dreamina/Runway silently drop refs beyond `images[0]`).
- **Credit note:** xskill ARK was previously out of credits (`[[seedance-identity-via-keyframe]]`);
  the probe may need the Dreamina/UseAPI Seedance route or a credit top-up. Probe is the first
  task and gates only WS5/WS6 — WS1–WS4 and quick wins proceed in parallel regardless.

### WS1 — Keystone: `captureRealismBlock` + de-hardcode `richCinematographySuffix` `[M / high]`
- New physics-only emitter in `cinematography.ts`: per-zone specular kill (names each zone —
  "forehead, nose bridge, cheekbones, temples, chin, collarbones"; "matte skin" alone is too
  weak and gets overridden), subsurface scattering, strand-hair physics, contrast-curve-×3,
  35mm grain, and a `wet`-gated moisture-matte clause.
- Bundle a **flattering-realism ceiling** ("no acne/blemishes/enlarged pores/clinical
  texture — fine flattering even skin") so anti-plastic never reads as dermatology-macro.
- Refactor `richCinematographySuffix()` to accept genre/lighting/grade and to compose the
  new block — defaults preserve current output unless callers opt into the realism block.

### WS2 — Preset breadth + `GradePreset` lift/gamma/gain `[M / med]`
- Extend `LIGHTING` (4→ add moonlight, overcast, neon-split, chiaroscuro, silhouette,
  fluorescent, night-practical, night-urban-neon) and `GRADE` (3→ add warm-nostalgia,
  cool-isolation, cyberpunk-neon, bleach-bypass, mono-accent) as **pure data** behind the
  existing emitters with safe fallbacks.
- Add `lift`/`gamma`/`gain` fields to the `GradePreset` struct (prompt-prose only this pass;
  consumed by WS1's contrast-curve and WS6).
- Fill `HOOK_PATTERNS` 6→12 (pure data behind the working `hookBeat` emitter).

### WS3 — Mid-gray plate + Rembrandt close + identity-first portrait `[M / high]`
- `backgroundPlate('mid-gray'|'white'|'black', d)` emitter; mid-gray ("even neutral mid-gray
  seamless, no seam line, no gradient, no falloff") becomes the **default** for
  `characterSheetReferencePrompt` / `characterSheetDescriptionPrompt` / `buildPortraitPrompt`
  (`character-auto-create.ts`); white/black explicit opt-in.
- `rembrandt-gray` LIGHTING key: single broad diffused source, soft triangle on shadow
  cheek, **no rim/hair/kicker**, warmth-preserved.
- 6-panel mid-gray canonical layout as an **opt-in** sheet mode (8-shot stays default).
- **Face boundary:** these prompts target the image generators only; pair with the
  WS-guard (below) so they never feed photoreal faces to `seedance-direct`.

### WS4 — Genre-resolved styleLine + music-sync `[M / high]`
- Replace the hardcoded Nolan styleLine shared by all four multi-shot presets
  (`multi-shot-prompt.ts:31`, reused at :45/:57/:69) with a resolver pulling from the
  existing 7 `GENRE_STYLES` in `filmmaking-prompts`; **Nolan kept as fallback**.
- `musicSync` emitter for music-video genre (today: "No music. Natural ambience"); pairs
  with the existing `assemble/music.ts` bed. Honors `[[multi-shot-no-slow-motion-direction]]`
  (positive tempo phrasing, no negation).

### WS5 — Subject Lock / Cross-Frame / Frame Map / Last Frame emitters `[M / high]`
- Additive prose emitters for the multi-character identity-stability blocks. Binding of
  `@imageN` to payload order is **branched on WS0's result**.
- Last Frame block carries the sanctioned on-screen-text suppression ("no captions, no
  signage typography, no rendered text").

### WS6 — 10-block Seedance master-prompt template (NEW DEFAULT) `[L / high]`
- Reorganize `seedancePromptText` (`filmmaking-prompts.ts:783`) + `composeSeedanceParagraph`
  into Joey's hard-locked order: Scene & Mood → Frame Map → Subject Lock(s) → Cross-Frame →
  Movement → Last Frame → World Plate → Sound Bed → Capture Realism → Camera Capture.
- **This becomes the default packet shape** (user decision). Update golden packet tests and
  the `smoke:multi-shot` / filmmaking-prompts smokes to the new expected output. Extend the
  QA-pass (`prompt-quality.ts`) to validate block presence/order.

### WS7 — Background-plate slot + wire orphaned `referenceBuildOrder` `[M / med]`
- Add a `'background-plate'` role to `FilmmakingReferenceSlot`.
- Consult `referenceBuildOrder` (`category-registry.ts:124`, **verified zero non-test
  callers**) inside `buildReferenceMap` to activate the documented plates-first /
  base-ref→sheet→scene-plate / canonical-never-substituted-by-plate discipline.

### WS8 — Outfit-swap / two-step outfit-build prompt recipe `[M / med]`
- **Prompt-emitter only** (user decision — videoclaw has no image-gen runtime; operator
  pastes into the external tool). Emit Joey's locked lean two-reference text
  (`@image1=outfit`, `@image2=identity`, fixed order) and the optional bland-model
  outfit-build first step. Reuse the `outfit-material` `ReferenceSheetType` store.

### WS9 — Post: cut-at-3s trim, LUT match-grade hook, letterbox `[M / high]`
- Per-clip **cut-at-3s tail trim** before stitch (kills the dead/freeze artifact frames AI
  generators append) — additive ffmpeg-arg in `assemble/ffmpeg.ts` / `post-production.ts`.
- Letterbox normalization; match-grade as a **prompt/LUT-handoff hook** (real `eq=` color
  math deferred per decision 5).
- **Topaz** gated opt-in behind an env flag, no-op if CLI absent (decision 6).

### WS-guard — photoreal-face guard on `seedance-direct`
- Block photoreal face references from the `seedance-direct` route (decision 2), with the
  no-faces silhouette register as the sanctioned ARK path. Belongs with WS3/WS8.

---

## Standing prompt-rules additions (`prompt-rules.ts` / `prompt-quality.ts`)
- `checkNegativeDirection` warn-lint in `runPromptQualityChecks` (the negative-direction
  anti-pattern is doc-only today). Negatives reserved for the three sanctioned suppressions
  only: on-screen text, per-zone specular kill, anti-plastic.
- Negative-to-positive rewrite as a standing authoring rule (prohibitions → positional/
  behavioral locks: "boots stay planted on the same ground marks").
- Trigger-word map onto new levers: `mid-gray`/`gray plate`→`backgroundPlate('mid-gray')`+
  `rembrandt-gray`; `haze`/`atmospheric depth`/`lighting the air`→`volumetricHaze`;
  `matte skin`/`no plastic`/`anti-plastic`→`captureRealismBlock`; `wet`/`rain`/`damp`→
  moisture-matte; `bleach bypass`/`low contrast`/`lifted blacks`→lift/gamma path;
  `no on-screen text`→Last Frame suppression.

## CLI / schema / docs surface
- New opt-in flags route through the existing `multi-shot` / `filmmaking-prompts` commands
  where possible (`--realism`, `--background mid-gray|white|black`, `--haze`,
  `--sheet 6-panel`, `--outfit-swap`, post flags). Any **new** subcommand must register in
  `src/video/cli-schema.ts` `COMMANDS` and bump the count assertion in `cli-schema.test.ts`.
- Update `docs/CLI_REFERENCE.md`, `references/video/multi-shot-framework.md` (Anti-patterns),
  `CLAUDE.md`, and keep `check:cleanroom-docs` clean.

## Testing strategy
- Offline, deterministic `node:test` per workstream; new emitters get golden-string tests.
- WS6 updates existing golden packet tests + smokes to the new default format.
- WS9 cut-at-3s/letterbox validated via the `smoke:assemble`/`assemble-render` path.
- WS0 is the only live/networked step; it is a gate, not a unit test.
- Full no-change gate: `npm run check:release-readiness-lite` before merge.

## Out of scope
- Real ffmpeg color-math match-grade (deferred), live image-gen runtime wiring, any change
  to the ark/Asset-Library/budget-cap mechanism, the storyboard-grid shot-spec sheet's
  near-black canvas (it is the layout contract, not a character plate).

## Open risks
- WS0 credit availability on the ARK route (may need Dreamina route or top-up).
- WS6 default-format change is the largest blast radius — golden tests + 2 smokes must move
  together in one commit boundary to keep the suite green.
