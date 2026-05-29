# Commercial Track + Quantified Prompt-Craft — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend videoclaw-v3 from a character/narrative prompt framework into one that also covers commercial/product video, and fold quantified prompt-craft (numeric camera/lighting/grade/audio, cinema modes, hooks) across both — without changing the proven character path or the `ark/seedance-2.0` + Asset Library identity mechanism.

**Architecture:** A two-axis `CategoryDescriptor` (subject × category) consumed by the existing prompt builders; a shared `cinematography.ts` quant-craft module; products lock identity through the same subject-agnostic Asset Library. Six phases A–F, each its own tests + docs + commit.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import extensions), `node:test` + `assert/strict`, offline/deterministic tests (injected `fetchImpl`/`sleep`), `sharp` for grids, xskill REST for Seedance.

**Spec:** `docs/superpowers/specs/2026-05-29-commercial-track-and-quant-craft-design.md`

---

## Conventions (apply to every task)

- Build before running tests: `npm run build`; run one file: `node --test dist/tests/<name>.test.js`.
- Strict NodeNext ESM — relative imports MUST end in `.js`. `kebab-case.ts` files, `camelCase`/`PascalCase` ids, 2-space indent.
- New CLI subcommand ⇒ register in `src/video/cli-schema.ts` `COMMANDS` AND bump the count assertion in `src/tests/cli-schema.test.ts`.
- Keep prompts within budgets (multi-shot ≤1500 chars). Diegetic-audio-only default. Describe subjects by visual descriptor, never proper name.
- Each task ends in a commit. Keep the existing 754 tests green through Phase C.

## File-structure map

| File | Phase | Responsibility |
|---|---|---|
| `src/video/cinematography.ts` (new) | A,B | Quant-craft vocabulary: camera/lighting/grade/audio emitters at a detail level; cinema modes; hook-pattern library; standing prompt rules; genre lookup table |
| `src/video/prompt-rules.ts` (new) | A | Centralized standing rules: visual-descriptor enforcement, "no face morphing", brand-neutral/no-IP scrub, diegetic-audio line |
| `src/video/category-registry.ts` (new) | C,D | `CategoryDescriptor` type + registry (character + 8 commercial categories) |
| `src/video/filmmaking-prompts.ts` (modify) | A,C,D | Consume `CategoryDescriptor` + cinematography; product subject branch |
| `src/video/multi-shot-prompt.ts` (modify) | A,B,E | Quant-craft detail in shot lines + audio; native-paragraph format; dialogue; bilingual |
| `src/video/seedance-asset-library.ts` (modify) | D,F | Product-reference registration helper; material-budget cap |
| `src/video/execution-runtime.ts` (modify) | F | Auto-resolve `seedance-assets.json` → per-scene `Asset://` refs |
| `src/cli/vclaw.ts` (modify) | A,D,E | Flags: `--detail --category --hook --format --lang`; product-register command |
| `schemas/video/artifacts/*.json` (modify/new) | D,E,F | Category fields; `product-references.json`; `seedance-assets.json` |

---

## Phase A — Quant-craft module + standing rules + `--detail`

Additive; improves the character path immediately. No `CategoryDescriptor` yet — wire by direct params, refactor to descriptor in Phase C.

### Task A1: `DetailLevel` + camera/lighting/grade emitters

**Files:** Create `src/video/cinematography.ts`; Test `src/tests/cinematography.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cameraSpec, lightingSpec, gradeSpec, type DetailLevel } from '../video/cinematography.js';

describe('cinematography emitters', () => {
  it('terse omits numbers, rich includes them', () => {
    const move = { shot: 'wide', lens: 35, angle: 'low', movement: 'push-in' as const };
    assert.doesNotMatch(cameraSpec(move, 'terse'), /ft\/s|mm/);
    assert.match(cameraSpec(move, 'rich'), /35mm/);
    assert.match(cameraSpec(move, 'rich'), /ft\/s/);
  });
  it('standard lighting carries Kelvin + ratio', () => {
    assert.match(lightingSpec('hard-dawn', 'standard'), /\d{3,5}K/);
    assert.match(lightingSpec('hard-dawn', 'standard'), /\d:\d/);
  });
  it('grade carries hue + saturation at rich', () => {
    assert.match(gradeSpec('desaturated-earth', 'rich'), /\d+°/);
    assert.match(gradeSpec('desaturated-earth', 'rich'), /\d+%/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test dist/tests/cinematography.test.js` → FAIL (module missing). (Build first.)
- [ ] **Step 3: Implement** `cinematography.ts` exporting:

```ts
export type DetailLevel = 'terse' | 'standard' | 'rich';
export interface CameraMove { shot: string; lens: number; angle: string; movement: 'push-in'|'pull-out'|'dolly'|'orbit'|'pan'|'tilt'|'track'|'handheld'|'locked-off'; velocityFtPerSec?: number }
// terse: "wide, low angle, push-in"
// standard: "wide, 35mm, low angle, slow push-in"
// rich: "wide, 35mm, low angle, push-in at 2 ft/s, subtle lens breathing"
export function cameraSpec(m: CameraMove, d: DetailLevel): string { /* compose per level */ }
// lighting presets keyed by id -> { kelvin, keyDeg, ratio }; standard+ emit "<K>K key at <deg>°, <ratio> ratio"
export function lightingSpec(id: string, d: DetailLevel): string { /* ... */ }
// grade presets -> { shadowHue, shadowSat, highlightHue, highlightSat }; rich emits "shadows <hue>° <sat>%; highlights ..."
export function gradeSpec(id: string, d: DetailLevel): string { /* ... */ }
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(cinematography): detail-leveled camera/lighting/grade emitters`

### Task A2: audio-mix hierarchy + standing rules module

**Files:** Create `src/video/prompt-rules.ts`; extend `cinematography.ts` with `audioMix`; Test `src/tests/prompt-rules.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripProperNames, brandNeutralize, noFaceMorphTag, diegeticAudioLine } from '../video/prompt-rules.js';

describe('standing prompt rules', () => {
  it('replaces a known proper name with its descriptor', () => {
    const out = stripProperNames('Meera raises her pistol', [{ name: 'Meera', descriptor: 'the woman with the long dark braid' }]);
    assert.match(out, /the woman with the long dark braid raises/);
    assert.doesNotMatch(out, /Meera/);
  });
  it('scrubs a brand token to a generic descriptor', () => {
    assert.doesNotMatch(brandNeutralize('wearing Nike shoes', ['Nike']), /Nike/);
  });
  it('emits the no-face-morphing tag and a diegetic audio line', () => {
    assert.match(noFaceMorphTag(), /no face morphing/i);
    assert.match(diegeticAudioLine(), /Diegetic sound only/);
  });
});
```

- [ ] **Step 2–4:** implement `prompt-rules.ts` (`stripProperNames(text, cast)`, `brandNeutralize(text, brands)`, `noFaceMorphTag()`, `diegeticAudioLine()`) + `audioMix(level)` in cinematography (dB hierarchy + silence-then-hit at rich); run tests green.
- [ ] **Step 5: Commit** — `feat(prompt-rules): visual-descriptor, brand-neutral, no-face-morph, diegetic audio`

### Task A3: wire `--detail` into multi-shot + filmmaking-prompts

**Files:** Modify `src/video/multi-shot-prompt.ts`, `src/video/filmmaking-prompts.ts`, `src/cli/vclaw.ts`; Tests extend `multi-shot*.test.ts`, `filmmaking-prompts.test.ts`

- [ ] **Step 1: Failing test** — assert a generated shot line at `detail:'rich'` contains `mm` + `ft/s`, and at `terse` does not; assert filmmaking packet honors `--detail`.
- [ ] **Step 2–4:** thread `detail?: DetailLevel` through `buildShotPlan`/compose + `GenerateFilmmakingPromptsOptions`; default `standard`; parse `--detail` in `handleVideoMultiShot` + `handleVideoFilmmakingPrompts`; emitters from `cinematography.ts`. Keep ≤1500 guard.
- [ ] **Step 5: Commit** — `feat(prompts): --detail terse|standard|rich quantified output`

### Task A4: docs + full suite

- [ ] Update `docs/CLI_REFERENCE.md` (+`--detail`) and `CLAUDE.md` (cinematography module). Run `npm test` (expect 754 + new green), `npm run check:cleanroom-docs`. Commit `docs: --detail + cinematography module`.

---

## Phase B — Cinema modes + hook library + genre lookup + mode-stacking

**Files:** extend `src/video/cinematography.ts`; Test `src/tests/cinema-modes.test.ts`

- [ ] **Task B1 — Five cinema modes.** Add `CINEMA_MODES: Record<'narrative'|'studio'|'action'|'performance'|'atmospheric', ModeSpec>` where `ModeSpec = { camera, lens, movement, filtration, grade }`. Test: `cinemaMode('action').movement` is kinetic; `resolveCameraVocab('orbit')` returns an orbit ModeSpec. Commit.
- [ ] **Task B2 — Hook-pattern library.** `HOOK_PATTERNS` (black-to-light, silence-to-sound, reverse-motion, beat-drop, …); `hookBeat(pattern, hookSeconds)` → a `[00:00 - 00:02]` opening beat string. Test: known pattern renders a 2s beat; unknown throws. Commit.
- [ ] **Task B3 — Genre lookup table.** Extend each `GenreStyle` (in `filmmaking-prompts.ts`) or a parallel map with `{ paletteHue, cutRatePerSec, keyLightId }`; `genreDefaults(genre)`. Test: `genreDefaults('music-video').cutRatePerSec` defined. Commit.
- [ ] **Task B4 — Mode-stacking.** `stackModes(shots)` keeps each shot's own mode block when modes differ (no averaging). Test: two shots with different modes keep distinct camera blocks. Commit + docs.

---

## Phase C — Category Descriptor registry + builder refactor (no behavior change)

**Files:** Create `src/video/category-registry.ts`; Test `src/tests/category-registry.test.ts`; modify `filmmaking-prompts.ts`, `multi-shot-prompt.ts`.

- [ ] **Task C1 — Descriptor type + character default.** Define `CategoryDescriptor` (per spec). Registry seeded with `cinematic`/character default = `{subjectType:'character', beatTemplate:'three-act', cameraVocab:'cinematic', audioProfile:'diegetic', hookSeconds:0, style: live-action}`. Test: `resolveCategory(undefined)` returns the character default; `resolveCategory('cinematic')` equals it. Commit.
- [ ] **Task C2 — Builders consume descriptor.** Refactor `buildStoryboardGridPrompt`/`buildSeedancePackets`/`seedancePromptText` to take a `CategoryDescriptor` (genre becomes `descriptor.style`). The CLI maps `--genre`→descriptor.style for now. **Critical:** run the full existing suite — all 754 stay green (no character-path behavior change). Commit.
- [ ] **Task C3 — multi-shot consumes descriptor** for beatTemplate (three-act default) + cameraVocab. Existing multi-shot tests green. Commit + docs.

---

## Phase D — Commercial categories + product subject

**Files:** modify `category-registry.ts`, `seedance-asset-library.ts`, `filmmaking-prompts.ts`; new `schemas/video/artifacts/product-references.schema.json`; Tests `category-registry.test.ts`, `seedance-asset-library.test.ts`.

- [ ] **Task D1 — Register 8 commercial descriptors** (ecommerce-ad, brand-story, product-360, fashion-lookbook, food-beverage, real-estate, motion-design-ad, comic-to-video) with their beatTemplate/cameraVocab/audioProfile/hookSeconds per the spec table. Test: each resolves; `product-360.beatTemplate==='turntable'`. Commit.
- [ ] **Task D2 — Beat templates.** `beats(template, durationSeconds, hookSeconds)` → ordered beats for `three-act | ad-hook-feature-cta | turntable | lookbook`; ad template includes hook + feature + CTA; turntable includes hero-angle open/close bookend. Test per template. Commit.
- [ ] **Task D3 — Orbit grammar** vocab in `cinematography.ts` (`product-rotation`/`camera-orbit`/`parallax-orbit`). Test distinct strings. Commit.
- [ ] **Task D4 — Product subject branch** in `filmmaking-prompts.ts`: when `subjectType:'product'`, read product references (artifact `product-references.json`) instead of character profiles; emit product packets with ad/turntable beats + hero-angle. Test: product category yields product-subject packets, no character-sheet prompts. Commit.
- [ ] **Task D5 — Image-asset build order** helper documented + a `referenceBuildOrder(subjectType)` returning `['base-ref','sheet','scene-plate']`. Test. Commit + docs.

---

## Phase E — Output format + dialogue + bilingual + CLI surface

**Files:** modify `multi-shot-prompt.ts`, `cli/vclaw.ts`, `cli-schema.ts`, `cli-schema.test.ts`; Tests `multi-shot*.test.ts`, new `cli-*.test.ts`.

- [ ] **Task E1 — Seedance-native paragraph format.** `composeSeedanceParagraph(plan, descriptor)` → single paragraph w/ inline `Style & Mood:` / `Dynamic Description:` / `Static Description:` + camera block + `Audio:` footer. Test asserts the three labels + footer. Commit.
- [ ] **Task E2 — Dialogue support.** `withDialogue(shotLine, {speaker, line, emotion, secondSpeaker})` — second speaker line opens `She replies:`/`He replies:`. Test: two-speaker timeline contains exactly one `replies:` opener. Commit.
- [ ] **Task E3 — Per-shot video-prompt format** (`SHOT N — NAME`: size/angle/movement, scene direction, dialogue, SFX, camera-direction + fixed Audio footer) as a `--format per-shot` option. Test labels present. Commit.
- [ ] **Task E4 — Bilingual.** `--lang en|zh|en+zh`; `en+zh` emits two code blocks, ZH preserving specs (translation via existing Gemini plumbing or a passthrough stub in tests). Test: `en+zh` returns two blocks. Commit.
- [ ] **Task E5 — Two-phase gate** flag `--phase storyboard|video` on filmmaking-prompts (storyboard-only vs video packets). Test. Commit.
- [ ] **Task E6 — CLI surface + schema.** Wire `--category --hook --format --lang --phase`; register any new command in `cli-schema.ts` COMMANDS + bump count assertion; update `CLI_REFERENCE.md` + `CLAUDE.md`. Run `check:cleanroom-docs`. Commit.

---

## Phase F — Execution end-to-end wiring + reference budget cap

**Files:** modify `src/video/execution-runtime.ts`, `seedance-asset-library.ts`; new `schemas/video/artifacts/seedance-assets.schema.json`; Tests `execute.test.ts`, `seedance-asset-library.test.ts`.

- [ ] **Task F1 — Reference budget cap.** `assertReferenceBudget(refs)` throws if >9 images or >3 videos or >3 audio. Test boundary + over-limit. Wire into `seedanceReferenceParams`/submit. Commit.
- [ ] **Task F2 — `seedance-assets.json` schema + reader.** Add schema; `readSeedanceAssets(workspace)` → map characterName/productName → `Asset://` URI. Test reads the artifact. Commit.
- [ ] **Task F3 — Auto-resolve in execution-runtime.** In `buildExecutionPayload`, when a scene's cast/products have registered Assets, set each scene's `referencePaths` to the matching `Asset://` URIs (cap-checked). Test: a project with `seedance-assets.json` produces tasks whose `referencePaths` are the per-scene `Asset://` URIs. **No regression** in existing execute tests. Commit.
- [ ] **Task F4 — Docs + full suite.** `CLI_REFERENCE.md` + `CLAUDE.md` (end-to-end ark Asset Library flow). `npm test` all green; `check:cleanroom-docs` + `check:artifact-schema-coverage`. Commit.

---

## Self-review notes

- **Spec coverage:** A↔quant-craft+standing rules; B↔cinema modes/hook/lookup/mode-stacking; C↔descriptor refactor; D↔commercial categories+product subject+orbit+hero-angle+build-order; E↔native format+dialogue+per-shot+bilingual+two-phase+CLI; F↔execution wiring+budget cap. All 8 audit items mapped (brand-neutral A2, dialogue E2, per-shot E3, cap F1, bilingual E4, build-order D5, two-phase E5, mode-stacking B4).
- **No-change guarantee:** Phase C runs the full suite as the proof gate; character path = default descriptor.
- **Identity mechanism:** untouched — products reuse `seedance-asset-library.ts`; execution feeds `Asset://` via Phase F.
