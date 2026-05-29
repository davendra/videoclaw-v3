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

## Build phases (one plan, four phases; each = tests + docs + commit)

- **Phase A — Quant-craft module + `--detail`.** Additive; instantly improves the character path (incl. DHUAAN). Lowest risk, ship first.
- **Phase B — Category Descriptor registry**; refactor `filmmaking-prompts`/`multi-shot` to consume a descriptor. Character path = default descriptor → no behavior change (existing tests lock it).
- **Phase C — Commercial categories + product subject:** product-reference path, ad/turntable/lookbook beat templates, orbit grammar.
- **Phase D — CLI surface** (`--category`, `--detail`, product registration), schema updates, docs (CLI_REFERENCE, CLAUDE.md), tests.

## Testing & constraints

- Offline, deterministic `node:test` (stub fetch / injected deps), per repo convention.
- Existing 754 tests must stay green through Phase B (no-change proof for the character path).
- New CLI commands register in `cli-schema.ts` COMMANDS + bump the count assertion.
- Docs: CLI_REFERENCE + CLAUDE.md; `check:cleanroom-docs` clean.
- The proven `ark/seedance-2.0` + Asset Library mechanism and the visual-descriptor / diegetic-audio / grid-leakage rules are preserved.

## Open items deferred to the plan

- Exact `--detail` char budgets per preset.
- Whether `--category` extends `filmmaking-prompts` or adds a sibling command.
- Product-reference artifact shape (mirror character profiles vs new `product-references.json`).
