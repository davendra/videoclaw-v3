# Design — Commercial/Product Track + Quantified Prompt-Craft

**Date:** 2026-05-29
**Status:** approved design, pending implementation plan
**Source:** learnings from the `beshuaxian/higgsfield-seedance2-jineng` skill library + the Higgsfield cinema-worldbuilder / ai-filmmaking skills, validated against the proven `ark/seedance-2.0` + Asset Library pipeline.

## Goal

Extend videoclaw-v3 from a character/narrative-only prompt framework into one that also covers **commercial/product** video (ecommerce, product-360, brand, fashion, food, real-estate, motion-design, comic-to-video), and fold in **quantified prompt-craft** (numeric camera/lighting/grade/audio, hook beat, anti-metronome) across both. Keep the character/narrative path and the proven `ark/seedance-2.0` + Asset Library identity mechanism fully intact.

## Non-goals

- No change to the identity mechanism (Asset Library `Asset://` avatars stay; it is already subject-agnostic).
- No new provider/transport — still `native-seedance.ts` → `ark/seedance-2.0`.
- No replacement of the genre engine; it becomes one field inside a larger descriptor.
- Not building a UI; this is prompt-framework/CLI work.

## Architecture — the Category Descriptor (two-axis: subject × category)

A single new concept unifies both directions. A `CategoryDescriptor` declares:

```
CategoryDescriptor {
  id: string                 // e.g. 'cinematic', 'ecommerce-ad', 'product-360'
  label: string
  subjectType: 'character' | 'product'
  beatTemplate: 'three-act' | 'ad-hook-feature-cta' | 'turntable' | 'lookbook'
  cameraVocab: 'cinematic' | 'orbit' | 'handheld-social' | 'macro' | 'glide' | 'stylized'
  style: GenreStyle          // reuses the existing genre engine (filmmaking-prompts.ts)
  audioProfile: 'diegetic' | 'ad-mix'
  hookSeconds: number        // 0 for none; 2 for the scroll-stopping hook beat
}
```

- Lives in a new registry `src/video/category-registry.ts` (same pattern as `STUDIO_RECIPES` / `GENRE_STYLES`).
- `filmmaking-prompts.ts` and `multi-shot-prompt.ts` consume a `CategoryDescriptor` instead of a bare genre string.
- **Backward compatibility:** the current character path is the descriptor `{ subjectType:'character', beatTemplate:'three-act', cameraVocab:'cinematic', audioProfile:'diegetic', hookSeconds:0 }`. Existing tests (754) lock this as no-change.
- `subjectType:'product'` swaps the reference source (product references instead of character profiles) and selects ad/turntable/lookbook beat + orbit/macro camera vocab. **Identity still locks through `seedance-asset-library.ts`** unchanged — it already registers any image URL → `Asset://` URI.

## Commercial/product track

- **Product identity:** products become `Asset://` avatars exactly like the cast. go-bananas `create_product_reference` / `generate_with_product` generates the product imagery; `vclaw video seedance-register-assets` (already subject-agnostic) registers them and writes `artifacts/seedance-assets.json`.
- **Category set + templates:**

| Category | beatTemplate | cameraVocab | audioProfile |
|---|---|---|---|
| ecommerce-ad | ad-hook-feature-cta | cinematic | ad-mix |
| brand-story | ad-hook-feature-cta | cinematic | ad-mix |
| product-360 | turntable | orbit | ad-mix |
| fashion-lookbook | lookbook | cinematic + poses | ad-mix |
| food-beverage | ad-hook-feature-cta | macro/steam/condensation | ad-mix |
| real-estate | ad-hook-feature-cta | glide/flythrough | ad-mix |
| motion-design-ad | ad-hook-feature-cta | stylized | ad-mix |
| comic-to-video | ad-hook-feature-cta | stylized | ad-mix |

- **Shared devices:** mandatory 2s **hook** beat, **hero-angle** open/close bookend for product recognition, CTA tail beat.
- **Orbit grammar vocabulary:** distinguish product-rotation (object spins, camera static) vs camera-orbit vs parallax-orbit.

## Quantified prompt-craft module

- New shared module `src/video/cinematography.ts` exporting a quantified vocabulary:
  - camera velocity (ft/s), lens (mm + breathing), lighting (Kelvin + degree placement + intensity ratio), color grade (hue° + sat%, shadows/highlights split), audio mix (dB hierarchy + "silence-then-hit"), 2s hook, anti-metronome beat-sync (sync only to drops/peaks).
- Consumed by both `filmmaking-prompts.ts` (camera/light/grade emitters) and `multi-shot-prompt.ts` (per-shot lines + Audio line).
- **`--detail terse | standard | rich`** (default `standard`):
  - `terse` = today's evocative phrasing (no numbers).
  - `standard` = key quantified specs, kept within char budgets.
  - `rich` = full numeric stack.
- The multi-shot `≤1500` char guard still governs; `--detail` scales verbosity to fit.

## Additional adopted prompt-craft (full takeaway set)

These are the remaining net-new ideas from the Higgsfield cinema-worldbuilder /
banana-pro-director / higgsfield-seedance2 research, folded into the same
modules:

- **Five cinema modes** (the cinema-worldbuilder backbone) drive `cameraVocab`:
  **Narrative / Studio / Action / Performance / Atmospheric**, each with a
  canonical camera + lens + movement + filtration + grade block. A
  `CategoryDescriptor.cameraVocab` resolves to a cinema mode; the cinematic
  default = Narrative. Lives in `cinematography.ts`.
- **Named hook-pattern library** for the 2s hook beat (black-to-light burst,
  silence-to-sound, reverse motion, beat-drop particle explosion, …). The hook
  beat picks a pattern by category; selectable via `--hook <pattern>`.
- **Seedance-native paragraph format** as an output option: a single continuous
  paragraph with inline **Style & Mood / Dynamic Description / Static
  Description** labels + camera block + audio line (the cinema-worldbuilder
  shape). Selectable via `--format multishot | seedance-paragraph`; default
  stays the current timecoded multi-shot.
- **Per-genre color + lighting + cut-rate lookup table** — enriches each
  `GenreStyle` with concrete defaults (e.g. hip-hop/EDR/lo-fi grades, cut rates)
  so the quant-craft emitters have real numbers to start from.
- **Runtime stated in three places** (title line, in-prompt spec block,
  confirmation) and **aspect ratio + resolution + duration restated inside the
  prompt body** — belt-and-suspenders that the Higgsfield UI relies on and that
  is harmless on the Ark path.
- **Standing prompt rules codified** (not ad hoc): describe subjects by **visual
  descriptor, never proper name**; append **"no face morphing"** anti-drift
  token on character shots; diegetic-audio-only default. Centralized so every
  builder emits them consistently.

## Full-skill audit — eight additional adopted items

A second pass over every skill read this session (ai-filmmaking,
storyboard-prompt-builder, multi-shot-prompt-framework, cinema-worldbuilder,
banana-pro-director, higgsfield-seedance2) surfaced eight more items to adopt,
each routed to a phase:

1. **Brand-neutral / no-IP rule** — never emit real brand names or protected IP;
   use generic visual descriptors ("black three-stripe sneakers" not a brand).
   A standing rule, critical for the commercial track. → Phase A (standing rules).
2. **Dialogue support** — quoted lines in the timeline with emotion + micro-gesture
   fused in; a second speaker's line always opens `She replies:` / `He replies:`
   (the word "reply" signals consecutive speech and stops speaker-collapse). → Phase E (format) + character path.
3. **Per-shot video-prompt format** — `SHOT N — [NAME]`: shot size/angle/movement,
   scene direction, dialogue, SFX, camera-direction verb phrase, with the fixed
   `Audio: Diegetic sound only — …` footer line. A richer alternative output to
   the timecoded multi-shot. → Phase E (output format option).
4. **Reference material budget cap** — Seedance accepts ≤9 images + ≤3 videos
   (≤15s total) + ≤3 audio (≤12 items). Validate before submit. → Phase F (execution) + asset-library guard.
5. **Bilingual EN+ZH output** — optional `--lang en|zh|en+zh`; ZH block is a
   faithful translation preserving all camera/mode/audio specs (xskill is a
   Chinese platform). → Phase E (output).
6. **Image-asset build order** — when generating references: neutral
   white-seamless base reference first → 6-panel/multi-angle sheet → scene
   plates. Disciplines how we build character AND product references. → Phase D (reference build).
7. **Two-phase approval gate** — storyboard prompt delivered first; the video
   prompt is only produced after explicit approval (lighter, prompt-level gate
   complementing director-mode). → Phase E (workflow).
8. **Mode-stacking** — when a sequence intercuts cinema modes (e.g. studio void
   ↔ kitchen), write each shot's camera block per its own mode; don't average
   them. → Phase B (cinema modes).

## Build phases (one plan, six phases; each = tests + docs + commit)

- **Phase A — Quant-craft module + standing rules + `--detail`.** New `cinematography.ts` (numeric camera/lighting/grade/audio) + codified standing prompt rules (visual-descriptor not names, "no face morphing", diegetic-audio, runtime-in-3-places, ratio/resolution/duration in-body). Additive; instantly improves the character path (incl. DHUAAN). Lowest risk, ship first.
- **Phase B — Cinema modes + hook library + genre lookup.** Add the five cinema modes (Narrative/Studio/Action/Performance/Atmospheric) as `cameraVocab` resolvers, the named 2s-hook-pattern library, and the per-genre color/lighting/cut-rate lookup table — all in `cinematography.ts`, wired into the emitters.
- **Phase C — Category Descriptor registry**; refactor `filmmaking-prompts`/`multi-shot` to consume a descriptor. Character path = default descriptor → no behavior change (existing tests lock it).
- **Phase D — Commercial categories + product subject:** product-reference path (go-bananas + Asset Library), ad/turntable/lookbook beat templates, orbit grammar, hero-angle bookend.
- **Phase E — Output format + CLI surface:** Seedance-native paragraph format (`--format`), plus `--category`/`--detail`/`--hook` flags and product registration; schema updates, docs (CLI_REFERENCE, CLAUDE.md), tests.
- **Phase F — Execution end-to-end wiring:** auto-resolve `artifacts/seedance-assets.json` → per-scene cast → `Asset://` reference paths in `execution-runtime`, so a full cast/product set runs through `produce`/`execute` on `ark/seedance-2.0` without the manual submit scripts. Closes the loop on the proven Asset Library path.

## Testing & constraints

- Offline, deterministic `node:test` (stub fetch / injected deps), per repo convention.
- Existing 754 tests must stay green through Phase C (no-change proof for the character path after the descriptor refactor).
- New CLI commands register in `cli-schema.ts` COMMANDS + bump the count assertion.
- Docs: CLI_REFERENCE + CLAUDE.md; `check:cleanroom-docs` clean.
- The proven `ark/seedance-2.0` + Asset Library mechanism and the visual-descriptor / diegetic-audio / grid-leakage rules are preserved.

## Open items deferred to the plan

- Exact `--detail` char budgets per preset.
- Whether `--category` extends `filmmaking-prompts` or adds a sibling command.
- Product-reference artifact shape (mirror character profiles vs new `product-references.json`).
