# Joey Cinematic-AI Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold Joey's "non-slop" cinematic techniques (anti-plastic physics prose, 10-block Seedance prompt contract, wider lighting/grade/hook registers, mid-gray/Rembrandt character path, per-clip cut-at-3s + letterbox post) into videoclaw-v3's existing craft layer — strictly additively — without disturbing the ark/Asset-Library identity lock or the 9/3/3 reference budget.

**Architecture:** Everything composes onto existing pure deterministic emitters in `src/video/cinematography.ts` and the prompt assembly in `src/video/filmmaking-prompts.ts` / `src/video/multi-shot-prompt.ts`. New work is new emitters + new data records + new opt-in options; existing defaults stay byte-stable EXCEPT the Seedance packet shape (WS6), which becomes the new default and updates golden tests + 2 smokes in one commit. One live ARK probe (WS0) gates the `@imageN` positional-binding decision for WS5/WS6; WS1–WS4 and the quick wins proceed in parallel regardless.

**Tech Stack:** TypeScript (strict, NodeNext ESM — relative imports MUST carry the emitted `.js` extension), `node:test` + `assert/strict` (offline, deterministic), `npm run build` then `node --test dist/tests/<name>.test.js`. FFmpeg for assembly.

**Source spec:** `docs/superpowers/specs/2026-05-29-joey-cinematic-adaptation-design.md`

---

## Conventions every task must follow

- Relative imports in `src/` include `.js` (e.g. `'./cinematography.js'`). Never drop it.
- Filenames `kebab-case.ts`; functions `camelCase`; types `PascalCase`; 2-space indent.
- Tests live in `src/tests/*.test.ts`; build emits `dist/tests/*.test.js`.
- Run one file: `npm run build && node --test dist/tests/<name>.test.js`.
- Per-task commit message footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- New CLI command → register in `src/video/cli-schema.ts` `COMMANDS` **and** bump the count in `src/tests/cli-schema.test.ts:12` (currently `82`).
- Keep `npm run check:cleanroom-docs` clean (update docs when you touch CLI surface).
- Do NOT touch the ark/Asset-Library path, `assertReferenceBudget`, or the 9/3/3 cap.

## File map (what each task touches)

| File | Responsibility | Workstreams |
|---|---|---|
| `src/video/cinematography.ts` | new emitters + data: captureRealismBlock, backgroundPlate, volumetricHaze, musicSyncLine, lighting/grade/hook registers, GradePreset lift/gamma/gain | WS1, WS2, WS3, WS4 |
| `src/video/filmmaking-prompts.ts` | de-hardcode richCinematographySuffix; mid-gray sheet prompts; 6-panel opt-in; 10-block seedancePromptText; subject-lock/frame-map/last-frame blocks; background-plate slot | WS1, WS3, WS5, WS6, WS7 |
| `src/video/multi-shot-prompt.ts` | genre-resolved styleLine | WS4 |
| `src/video/prompt-quality.ts` | checkNegativeDirection (7th checker) | rules |
| `src/video/prompt-rules.ts` | negativeToPositive standing rule | rules |
| `src/video/category-registry.ts` | (read-only) referenceBuildOrder consumed by WS7 | WS7 |
| `src/video/character-auto-create.ts` | mid-gray portrait default | WS3 |
| `src/video/outfit-prompts.ts` (new) | outfit-swap / outfit-build prompt emitters | WS8 |
| `src/video/assemble/ffmpeg.ts` | cut-at-3s trim arg, letterbox filter, optional Topaz shell-out | WS9 |
| `src/video/execution-runtime.ts` + `src/video/native-seedance.ts` | photoreal-face guard on seedance-direct | WS-guard |
| `docs/CLI_REFERENCE.md`, `references/video/multi-shot-framework.md`, `CLAUDE.md` | docs | all |

---

# PHASE 0 — Live ARK positional-binding probe (gate for WS5/WS6)

### Task 0.1: ARK `@imageN` positional-binding probe

**Files:**
- Create: `scripts/probes/ark-reference-order-probe.mjs`
- Create: `docs/superpowers/notes/ark-reference-order-result.md` (written by the operator after running)

This is the ONLY networked step in the plan. It is a manual operator probe, not a unit test. It determines whether `reference_images` array order maps to `@image1`/`@image2` subject-lock semantics on the ARK/Seedance route the DHUAAN project uses. WS5/WS6's Subject-Lock binding branches on the result.

- [ ] **Step 1: Write the probe script**

```js
// scripts/probes/ark-reference-order-probe.mjs
// Manual probe: does reference_images[0]/[1] bind to @image1/@image2?
// Submits one generation with two visually distinct, content-filter-safe
// reference images in a known order and a prompt that names @image1/@image2
// for different roles, so the rendered output reveals whether array order
// is honored. Reads creds from .env (USEAPI_API_TOKEN etc.). DRY-RUN by default.
import { readFileSync } from 'node:fs';

const DRY_RUN = !process.argv.includes('--live');
// Two stylized (non-photoreal-face) reference URLs the operator supplies:
const REF_A = process.env.PROBE_REF_A ?? '<stylized-ref-A-url>';
const REF_B = process.env.PROBE_REF_B ?? '<stylized-ref-B-url>';
const prompt =
  'Two stylized figures. @image1 wears a red cloak; @image2 wears a blue cloak. ' +
  'Render @image1 on the LEFT and @image2 on the RIGHT, full frame, single shot.';

const payload = {
  model: process.env.PROBE_MODEL ?? 'seedance-2.0',
  prompt,
  reference_images: [REF_A, REF_B], // order under test
};

if (DRY_RUN) {
  console.log(JSON.stringify({ dryRun: true, payload }, null, 2));
  process.exit(0);
}
// --live path left to the operator's existing native transport / curl shim.
console.log('Submit via the active Seedance route, then inspect: is red on the LEFT?');
```

- [ ] **Step 2: Run dry-run to verify the payload shape**

Run: `node scripts/probes/ark-reference-order-probe.mjs`
Expected: prints `{ dryRun: true, payload: { ... reference_images: [REF_A, REF_B] } }`.

- [ ] **Step 3: Operator runs `--live` once (credit-gated)**

Credit note: xskill ARK was previously at 80 credits (needs ≥1000). If ARK is unavailable, run the probe through the Dreamina/UseAPI Seedance route instead, or top up. If neither is available, SKIP the live run and record `binding: unknown` — WS5 then falls back to "guidance-only" automatically (see WS5 Task 5.0).

- [ ] **Step 4: Record the result**

Write `docs/superpowers/notes/ark-reference-order-result.md` with exactly one of:
`binding: positional` (red rendered LEFT == array order honored) /
`binding: ignored` / `binding: unknown`.

- [ ] **Step 5: Commit**

```bash
git add scripts/probes/ark-reference-order-probe.mjs docs/superpowers/notes/ark-reference-order-result.md
git commit -m "chore(probe): ARK @imageN positional-binding probe + recorded result"
```

---

# PHASE 1 — WS1 Keystone: captureRealismBlock + de-hardcode richCinematographySuffix

### Task 1.1: Anti-plastic physics clause helpers (cinematography.ts)

**Files:**
- Modify: `src/video/cinematography.ts` (append after `audioMix`, ~line 577)
- Test: `src/tests/cinematography-realism.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/cinematography-realism.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  specularKillClause,
  subsurfaceScatteringClause,
  strandHairClause,
  contrastCurveClause,
  moistureMatteClause,
  flatteringRealismClause,
} from '../video/cinematography.js';

test('specularKillClause names individual face zones (matte-skin alone is too weak)', () => {
  const s = specularKillClause();
  for (const zone of ['forehead', 'nose bridge', 'cheekbones', 'temples', 'chin']) {
    assert.ok(s.toLowerCase().includes(zone), `missing zone: ${zone}`);
  }
  assert.ok(/no oily|no shine|zero shine/i.test(s));
});

test('subsurfaceScatteringClause reads as translucent biology, never plastic', () => {
  const s = subsurfaceScatteringClause();
  assert.ok(/subsurface scattering/i.test(s));
  assert.ok(/never .*plastic|not .*plastic/i.test(s));
});

test('strandHairClause specifies strand-by-strand flyaways', () => {
  assert.ok(/strand by strand/i.test(strandHairClause()));
  assert.ok(/flyaway|baby hair/i.test(strandHairClause()));
});

test('contrastCurveClause states the curve three ways', () => {
  const s = contrastCurveClause();
  assert.ok(/lifted|shadows lifted/i.test(s));
  assert.ok(/roll(ed)? off|highlights/i.test(s));
  assert.ok(/nothing clip|no clip|not crush/i.test(s));
});

test('moistureMatteClause is damp-not-glossy', () => {
  assert.ok(/damp/i.test(moistureMatteClause()));
  assert.ok(/not glossy|never glossy|no .*hotspot/i.test(moistureMatteClause()));
});

test('flatteringRealismClause keeps anti-plastic from reading as dermatology macro', () => {
  const s = flatteringRealismClause();
  assert.ok(/no acne|no blemish/i.test(s));
  assert.ok(/flattering/i.test(s));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build` — expect TS errors: exports not found.

- [ ] **Step 3: Implement the clauses**

Append to `src/video/cinematography.ts`:

```ts
/**
 * Anti-plastic physics clauses (banana-pro-director). Each is a standalone
 * exported string helper so callers can compose them individually before the
 * full {@link captureRealismBlock} lands. Per-zone specular naming is required —
 * "matte skin" alone is too weak and gets overridden by the model default.
 */
export function specularKillClause(): string {
  return 'all specular highlights surgically removed from skin — zero shine on forehead, nose bridge, cheekbones, temples, and chin, no oily T-zone, skin matte and velvety';
}

export function subsurfaceScatteringClause(): string {
  return 'subsurface scattering at ear edges, nostrils, and around the eye sockets with warm undertone bleed, reading as semi-translucent biology never opaque plastic';
}

export function strandHairClause(): string {
  return 'hair rendered strand by strand with flyaways and baby hairs at the hairline, hair physics responding to the actual environment, matte by default never glossy';
}

export function contrastCurveClause(): string {
  return 'shadows lifted gently, highlights rolled off, nothing clipping or crushing — a low-contrast slightly-desaturated grade with warmth preserved';
}

export function moistureMatteClause(): string {
  return 'damp not beaded, wet not glossy — moisture mutes and saturates the surface without a single specular hotspot';
}

export function flatteringRealismClause(): string {
  return 'no acne, no blemishes, no enlarged or rough pores, no harsh clinical texture — fine flattering even skin';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && node --test dist/tests/cinematography-realism.test.js`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/video/cinematography.ts src/tests/cinematography-realism.test.ts
git commit -m "feat(cinematography): anti-plastic physics clause helpers (WS1)"
```

### Task 1.2: volumetricHaze emitter + captureRealismBlock

**Files:**
- Modify: `src/video/cinematography.ts`
- Test: `src/tests/cinematography-realism.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

```ts
import { volumetricHaze, captureRealismBlock } from '../video/cinematography.js';

test('volumetricHaze scales density and always names planes', () => {
  for (const k of ['thin', 'light', 'heavy'] as const) {
    const s = volumetricHaze(k, 'standard');
    assert.ok(/between (the )?camera, subject/i.test(s));
    assert.ok(/distant|background/i.test(s));
  }
  assert.ok(volumetricHaze('heavy', 'rich').length > volumetricHaze('thin', 'terse').length);
});

test('captureRealismBlock composes specular+SSS+hair+contrast+haze+grain', () => {
  const s = captureRealismBlock({}, 'rich');
  assert.ok(/specular/i.test(s) && /subsurface/i.test(s) && /strand/i.test(s));
  assert.ok(/haze|air density/i.test(s) && /grain/i.test(s));
});

test('captureRealismBlock emits moisture clause ONLY when wet', () => {
  assert.ok(!/damp/i.test(captureRealismBlock({ wet: false }, 'rich')));
  assert.ok(/damp/i.test(captureRealismBlock({ wet: true }, 'rich')));
});

test('captureRealismBlock terse is shorter than rich', () => {
  assert.ok(captureRealismBlock({}, 'terse').length < captureRealismBlock({}, 'rich').length);
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run build` → exports not found.

- [ ] **Step 3: Implement**

Append to `src/video/cinematography.ts`:

```ts
export type HazeDensity = 'thin' | 'light' | 'heavy';

const HAZE_WORDS: Record<HazeDensity, string> = {
  thin: 'a faint trace of atmosphere',
  light: 'light atmospheric haze',
  heavy: 'heavy volumetric haze and visible air density',
};

/**
 * Volumetric depth ("lighting the air") — the single biggest anti-plastic
 * depth lever. Exposed standalone; previously reachable only inside the
 * `atmospheric` cinema mode's filtration field.
 */
export function volumetricHaze(density: HazeDensity, d: DetailLevel): string {
  const words = HAZE_WORDS[density];
  if (d === 'terse') {
    return `${words} between the planes`;
  }
  const core =
    `${words} between the camera, subject, and background — distant planes rendered softer, ` +
    'desaturated, and lower-contrast than the foreground';
  if (d === 'standard') {
    return core;
  }
  return `${core}; real volumetric atmosphere, never a flat backdrop`;
}

export interface CaptureRealismOpts {
  /** Emit the moisture-matte clause (skipped when false/omitted). */
  wet?: boolean;
  /** Haze density for the depth clause (default 'light'). */
  haze?: HazeDensity;
  /** Film-grain stock descriptor (default '35mm'). */
  grainStock?: string;
}

/**
 * The keystone anti-AI-look block: physics-vs-hardware separation that does not
 * exist anywhere else in the codebase. Composes per-zone specular kill,
 * subsurface scattering, strand hair, contrast-curve-three-ways, volumetric
 * haze, optional moisture, the flattering-realism ceiling, and film grain.
 * Pure and deterministic; density scales with {@link DetailLevel}.
 */
export function captureRealismBlock(opts: CaptureRealismOpts, d: DetailLevel): string {
  const grain = opts.grainStock ?? '35mm';
  const haze = volumetricHaze(opts.haze ?? 'light', d);
  if (d === 'terse') {
    return `Matte anti-plastic skin, soft ${grain} grain, ${haze}.`;
  }
  const parts = [
    specularKillClause(),
    subsurfaceScatteringClause(),
    strandHairClause(),
    contrastCurveClause(),
    haze,
    flatteringRealismClause(),
  ];
  if (opts.wet) {
    parts.push(moistureMatteClause());
  }
  parts.push(`soft natural ${grain} film grain, photographed not generated`);
  return `Capture realism: ${parts.join('; ')}.`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && node --test dist/tests/cinematography-realism.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/video/cinematography.ts src/tests/cinematography-realism.test.ts
git commit -m "feat(cinematography): volumetricHaze + captureRealismBlock keystone emitter (WS1)"
```

### Task 1.3: De-hardcode richCinematographySuffix (byte-stable default)

**Files:**
- Modify: `src/video/filmmaking-prompts.ts:170-183`
- Test: `src/tests/filmmaking-rich-suffix.test.ts` (new)

`richCinematographySuffix()` currently takes no args and hardcodes `lightingSpec('neutral-studio')` + `gradeSpec('teal-orange')`. We add an optional opts arg whose defaults reproduce today's output exactly (so the 4 existing call sites at :181, :564, :678, :852 stay byte-identical), plus an opt-in realism block.

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/filmmaking-rich-suffix.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richCinematographySuffix } from '../video/filmmaking-prompts.js';

test('no-arg call is byte-identical to the legacy hardcoded suffix', () => {
  const legacy =
    'Cinematography: master, eye-level angle, 35mm, dolly at 3 ft/s, subtle lens breathing; ' +
    '5600K key at 45°, 2:1 ratio, gentle fill and crisp rim light, clean balanced studio light, even and neutral; ' +
    'shadows 190° 45% tint; highlights 30° 55% tint, cinematic teal-and-orange contrast.';
  assert.equal(richCinematographySuffix(), legacy);
});

test('lighting/grade ids are overridable', () => {
  assert.ok(richCinematographySuffix({ lightingId: 'night-fire' }).includes('2000K'));
});

test('realism opt-in appends the capture-realism block', () => {
  assert.ok(/Capture realism:/.test(richCinematographySuffix({ realism: {} })));
  assert.ok(!/Capture realism:/.test(richCinematographySuffix()));
});
```

Note: confirm the `legacy` string by running the old build once and copying actual output if the wording differs; the assertion must match byte-for-byte.

- [ ] **Step 2: Run to verify it fails** — export signature mismatch / not exported.

- [ ] **Step 3: Implement** — replace lines 177-183:

```ts
export function richCinematographySuffix(opts: {
  lightingId?: string;
  gradeId?: string;
  realism?: CaptureRealismOpts | false;
} = {}): string {
  const lightingId = opts.lightingId ?? 'neutral-studio';
  const gradeId = opts.gradeId ?? 'teal-orange';
  const base =
    `Cinematography: ${cameraSpec(RICH_CAMERA_MOVE, 'rich')}; ` +
    `${lightingSpec(lightingId, 'rich')}; ` +
    `${gradeSpec(gradeId, 'rich')}.`;
  if (opts.realism && opts.realism !== false) {
    return `${base} ${captureRealismBlock(opts.realism, 'rich')}`;
  }
  return base;
}
```

Add `captureRealismBlock`, `CaptureRealismOpts` to the existing `from './cinematography.js'` import. Make `richCinematographySuffix` `export`ed (it was file-private).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build && node --test dist/tests/filmmaking-rich-suffix.test.js`
Expected: PASS. Then run the full suite to confirm no existing golden moved:
`node --test dist/tests/*.test.js 2>&1 | grep -E "^# (pass|fail)"` — `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/video/filmmaking-prompts.ts src/tests/filmmaking-rich-suffix.test.ts
git commit -m "feat(filmmaking): de-hardcode richCinematographySuffix + realism opt-in (WS1)"
```

---

# PHASE 2 — WS2 Preset breadth + GradePreset lift/gamma/gain

### Task 2.1: Extend LIGHTING register

**Files:**
- Modify: `src/video/cinematography.ts:70-82` (LIGHTING + LIGHTING_WORDS)
- Test: `src/tests/cinematography-registers.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/cinematography-registers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightingSpec, gradeSpec } from '../video/cinematography.js';

const NEW_LIGHTS = ['moonlight','overcast','neon-split','chiaroscuro','silhouette','fluorescent','night-practical','night-urban-neon'];
test('new lighting ids resolve to non-fallback rich specs', () => {
  for (const id of NEW_LIGHTS) {
    const rich = lightingSpec(id, 'rich');
    assert.notEqual(rich, '5600K key at 45°, 2:1 ratio, neutral fill', `${id} fell back`);
    assert.ok(/K key at/.test(rich), `${id} missing Kelvin`);
  }
});
```

- [ ] **Step 2: Run to verify it fails** — new ids fall back.

- [ ] **Step 3: Implement** — add entries to `LIGHTING` and `LIGHTING_WORDS`:

```ts
  // appended to LIGHTING
  moonlight: { kelvin: 7000, keyDeg: 35, ratio: '6:1' },
  overcast: { kelvin: 6500, keyDeg: 60, ratio: '1.5:1' },
  'neon-split': { kelvin: 4500, keyDeg: 40, ratio: '3:1' },
  chiaroscuro: { kelvin: 3400, keyDeg: 20, ratio: '12:1' },
  silhouette: { kelvin: 5000, keyDeg: 10, ratio: '16:1' },
  fluorescent: { kelvin: 4300, keyDeg: 70, ratio: '1.2:1' },
  'night-practical': { kelvin: 2800, keyDeg: 25, ratio: '7:1' },
  'night-urban-neon': { kelvin: 5200, keyDeg: 30, ratio: '5:1' },
```

```ts
  // appended to LIGHTING_WORDS
  moonlight: 'cool blue moonlight, soft and directional with deep shadows',
  overcast: 'flat soft overcast daylight, low contrast and even',
  'neon-split': 'split warm/cool neon key, magenta-and-cyan separation',
  chiaroscuro: 'extreme chiaroscuro, a single hard source carving light from darkness',
  silhouette: 'strong backlight rendering the subject as a near-silhouette',
  fluorescent: 'flat green-tinged overhead fluorescent, institutional and even',
  'night-practical': 'warm practical pools against deep night, motivated sources only',
  'night-urban-neon': 'wet-street urban neon, mixed signage color spill at night',
```

- [ ] **Step 4: Verify pass** — `node --test dist/tests/cinematography-registers.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/video/cinematography.ts src/tests/cinematography-registers.test.ts
git commit -m "feat(cinematography): widen LIGHTING register (WS2)"
```

### Task 2.2: GradePreset lift/gamma/gain + extend GRADE register

**Files:**
- Modify: `src/video/cinematography.ts:39-44` (GradePreset), `:84-94` (GRADE/GRADE_WORDS), `:141-163` (gradeSpec rich output)
- Test: `src/tests/cinematography-registers.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

```ts
const NEW_GRADES = ['warm-nostalgia','cool-isolation','cyberpunk-neon','bleach-bypass','mono-accent'];
test('new grade ids resolve non-fallback', () => {
  for (const id of NEW_GRADES) {
    assert.ok(/tint/.test(gradeSpec(id, 'rich')), `${id} missing tint`);
  }
});
test('bleach-bypass rich output states lifted-black lift/gamma when present', () => {
  const s = gradeSpec('bleach-bypass', 'rich');
  assert.ok(/lift|gamma|lifted/i.test(s));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — extend the `GradePreset` interface with optional fields:

```ts
interface GradePreset {
  shadowHue: number;
  shadowSat: number;
  highlightHue: number;
  highlightSat: number;
  lift?: number;   // 0..1 black-point lift (prompt-prose only this pass)
  gamma?: number;  // midtone gamma
  gain?: number;   // highlight gain
}
```

Add to `GRADE`:

```ts
  'warm-nostalgia': { shadowHue: 35, shadowSat: 25, highlightHue: 40, highlightSat: 30, gamma: 1.05 },
  'cool-isolation': { shadowHue: 210, shadowSat: 30, highlightHue: 205, highlightSat: 20 },
  'cyberpunk-neon': { shadowHue: 280, shadowSat: 60, highlightHue: 320, highlightSat: 65 },
  'bleach-bypass': { shadowHue: 0, shadowSat: 6, highlightHue: 0, highlightSat: 4, lift: 0.12, gamma: 1.1, gain: 0.92 },
  'mono-accent': { shadowHue: 0, shadowSat: 0, highlightHue: 0, highlightSat: 8 },
```

Add to `GRADE_WORDS`:

```ts
  'warm-nostalgia': 'warm faded nostalgia, soft amber memory tone',
  'cool-isolation': 'cool desaturated isolation, blue-grey distance',
  'cyberpunk-neon': 'saturated magenta-and-cyan cyberpunk neon',
  'bleach-bypass': 'low-saturation high-density bleach-bypass with lifted blacks',
  'mono-accent': 'near-monochrome with a single restrained accent hue',
```

Extend the rich branch of `gradeSpec` (lines 159-162) to append lift/gamma/gain when present:

```ts
  const base =
    `shadows ${preset.shadowHue}° ${preset.shadowSat}% tint; ` +
    `highlights ${preset.highlightHue}° ${preset.highlightSat}% tint, ${words}`;
  const curve = [
    preset.lift !== undefined ? `lift ${preset.lift}` : '',
    preset.gamma !== undefined ? `gamma ${preset.gamma}` : '',
    preset.gain !== undefined ? `gain ${preset.gain}` : '',
  ].filter(Boolean).join(', ');
  return curve ? `${base}; ${curve}` : base;
```

- [ ] **Step 4: Verify pass** — run the register test + full suite (`fail 0`; legacy grades without lift/gamma stay byte-stable because `curve` is empty for them).

- [ ] **Step 5: Commit**

```bash
git add src/video/cinematography.ts src/tests/cinematography-registers.test.ts
git commit -m "feat(cinematography): GradePreset lift/gamma/gain + widen GRADE register (WS2)"
```

### Task 2.3: HOOK_PATTERNS 6 → 12

**Files:**
- Modify: `src/video/cinematography.ts:301-325` (HOOK_PATTERN_IDS + HOOK_PATTERNS)
- Test: `src/tests/cinematography-hooks.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/cinematography-hooks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOOK_PATTERN_IDS, resolveHookPattern } from '../video/cinematography.js';

test('twelve hook patterns, all resolvable', () => {
  assert.equal(HOOK_PATTERN_IDS.length, 12);
  for (const id of HOOK_PATTERN_IDS) {
    assert.ok(resolveHookPattern(id).length > 10, `${id} empty`);
  }
});
test('new hook ids present', () => {
  for (const id of ['speed-ramp','first-person-rush','impact-freeze','title-burn-in','slow-reveal','snap-zoom']) {
    assert.ok((HOOK_PATTERN_IDS as readonly string[]).includes(id), `missing ${id}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add 6 ids to `HOOK_PATTERN_IDS` and 6 entries to `HOOK_PATTERNS`:

```ts
// added to HOOK_PATTERN_IDS (after 'whip-reveal')
  'speed-ramp',
  'first-person-rush',
  'impact-freeze',
  'title-burn-in',
  'slow-reveal',
  'snap-zoom',
```

```ts
// added to HOOK_PATTERNS
  'speed-ramp':
    'Action ramps from slow-motion into real time on a single continuous move, time compressing as the hero subject commits.',
  'first-person-rush':
    'A first-person rush hurtles forward through the environment, motion close and visceral, before braking hard on the hero subject.',
  'impact-freeze':
    'The frame slams to a freeze on the exact instant of impact, debris suspended mid-air, then releases back into motion.',
  'title-burn-in':
    'A single word burns in from particulate or light, holds for a beat, then dissolves as the scene takes over.',
  'slow-reveal':
    'A slow tilt or pull gradually uncovers the hero subject from an obscuring foreground element, withholding then granting the full view.',
  'snap-zoom':
    'A fast snap-zoom punches from a wide to a tight frame on the hero subject, landing hard with no settle.',
```

- [ ] **Step 4: Verify pass** — run the hooks test + full suite (`fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/video/cinematography.ts src/tests/cinematography-hooks.test.ts
git commit -m "feat(cinematography): expand HOOK_PATTERNS 6->12 (WS2)"
```

---

# PHASE 3 — WS3 Mid-gray plate + Rembrandt close + identity-first portrait

### Task 3.1: backgroundPlate emitter + rembrandt-gray lighting key

**Files:**
- Modify: `src/video/cinematography.ts`
- Test: `src/tests/cinematography-plate.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/cinematography-plate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundPlate, lightingSpec } from '../video/cinematography.js';

test('mid-gray plate forbids seam/gradient/falloff', () => {
  const s = backgroundPlate('mid-gray', 'standard');
  assert.ok(/mid-gray/i.test(s));
  assert.ok(/no seam/i.test(s) && /no gradient/i.test(s) && /falloff/i.test(s));
});
test('white and black plates resolve distinctly', () => {
  assert.ok(/white/i.test(backgroundPlate('white', 'terse')));
  assert.ok(/black/i.test(backgroundPlate('black', 'terse')));
});
test('rembrandt-gray lighting has no rim/hair/kicker and preserves warmth', () => {
  const s = lightingSpec('rembrandt-gray', 'rich');
  assert.ok(/no rim/i.test(s) && /no hair light/i.test(s) && /no kicker/i.test(s));
  assert.ok(/warmth/i.test(s));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add `backgroundPlate`; add `rembrandt-gray` to `LIGHTING` + a special-cased rich string.

Append to cinematography.ts:

```ts
export type PlateKind = 'mid-gray' | 'white' | 'black';

const PLATE_WORDS: Record<PlateKind, string> = {
  'mid-gray':
    'even neutral mid-gray seamless background, no seam line, no gradient, no falloff to black or white',
  white: 'clean white seamless background, evenly lit, no gradient',
  black: 'deep matte black seamless background, no spill, no falloff edge',
};

/**
 * Backdrop plate spec. Mid-gray is Joey's locked default for ALL character work
 * — it lowers subject-to-background contrast so downstream video inherits
 * cleaner edges. White/black are explicit opt-ins.
 */
export function backgroundPlate(kind: PlateKind, d: DetailLevel): string {
  const words = PLATE_WORDS[kind];
  if (d === 'terse') {
    return words;
  }
  if (kind === 'mid-gray') {
    return `${words}; subject and wardrobe rendered at their true natural tone against the neutral gray`;
  }
  return words;
}
```

Add to `LIGHTING` (it needs the struct shape; rembrandt-gray is lit softly):

```ts
  'rembrandt-gray': { kelvin: 5200, keyDeg: 40, ratio: '3:1' },
```

Special-case `rembrandt-gray` inside `lightingSpec` rich branch (before the generic return at line 134) so it emits the lean close:

```ts
  if (id === 'rembrandt-gray' && d !== 'terse') {
    const lean =
      'one broad diffused source from camera-left and slightly above, a soft triangle of light on the shadow cheek, ' +
      'no hard shadow edges, no rim light, no hair light, no kicker; skin matte and velvety, warmth preserved and natural, never pale or cool-shifted';
    return d === 'standard' ? `5200K key at 40°, 3:1 ratio` : `5200K key at 40°, 3:1 ratio, ${lean}`;
  }
```

Add `LIGHTING_WORDS['rembrandt-gray'] = 'lean single-source Rembrandt close on a gray plate, matte and warm';`

- [ ] **Step 4: Verify pass** — run the plate test + full suite (`fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/video/cinematography.ts src/tests/cinematography-plate.test.ts
git commit -m "feat(cinematography): backgroundPlate + rembrandt-gray lighting (WS3)"
```

### Task 3.2: Mid-gray default in character-sheet + portrait prompts

**Files:**
- Modify: `src/video/filmmaking-prompts.ts:862-868` (characterSheetReferencePrompt / characterSheetDescriptionPrompt)
- Modify: `src/video/character-auto-create.ts:32-35` (buildPortraitPrompt)
- Test: `src/tests/filmmaking-midgray.test.ts` (new), `src/tests/character-portrait-midgray.test.ts` (new)

- [ ] **Step 1: Failing tests**

```ts
// src/tests/character-portrait-midgray.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterAutoCreateRequest } from '../video/character-auto-create.js'; // adjust to real export
test('portrait prompt now uses mid-gray seamless, not bare "neutral background"', () => {
  const req = buildCharacterAutoCreateRequest({ description: 'a weathered fisherman', style: 'live-action' } as any);
  assert.ok(/mid-gray seamless/i.test(req.prompt));
});
```

(Confirm the exact exported entry of `character-auto-create.ts` first — `buildPortraitPrompt` is file-private; test through the public request builder it feeds, or export `buildPortraitPrompt` for testability.)

```ts
// src/tests/filmmaking-midgray.test.ts — assert sheet prompts swap
// "clean neutral studio lighting / simple and not distracting" for mid-gray.
// (Tested via generateFilmmakingPrompts output OR by exporting the two
//  prompt builders. Prefer exporting them for a focused unit test.)
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — in `character-auto-create.ts` replace `neutral background` with `even neutral mid-gray seamless background, no seam line`:

```ts
  return `${stylePrefix} character portrait of ${input.description.trim()}, front-facing, even neutral mid-gray seamless background with no seam line, full-body composition, high detail, consistent character design. No text, no watermarks.`;
```

In `filmmaking-prompts.ts`, swap `Background should be simple and not distracting from character design.` for the mid-gray plate text in BOTH `characterSheetReferencePrompt` and `characterSheetDescriptionPrompt`, and `Use clean neutral studio lighting` stays (8-shot default keeps studio light — mid-gray is the backdrop change only):

```ts
  // both builders: replace the background sentence with
  `Background: even neutral mid-gray seamless, no seam line, no gradient, subject rendered at true natural tone against the neutral gray.`
```

- [ ] **Step 4: Verify pass** + full suite. Some existing golden tests that asserted the old background wording WILL move — update those goldens in THIS commit (grep for `simple and not distracting` and `neutral background` in `src/tests/`).

- [ ] **Step 5: Commit**

```bash
git add src/video/filmmaking-prompts.ts src/video/character-auto-create.ts src/tests/
git commit -m "feat(character): mid-gray seamless default for sheets + portraits (WS3)"
```

### Task 3.3: 6-panel mid-gray character sheet (opt-in)

**Files:**
- Modify: `src/video/filmmaking-prompts.ts` (add `sheetLayout?: '8-shot' | '6-panel'` to `GenerateFilmmakingPromptsOptions`; add `characterSheetSixPanelPrompt`; thread through `buildCharacterSheetPrompts`)
- Test: `src/tests/filmmaking-sixpanel.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/filmmaking-sixpanel.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterSheetSixPanelPrompt } from '../video/filmmaking-prompts.js';
test('6-panel sheet is a single 3x2 mid-gray frame, identity locked', () => {
  const s = characterSheetSixPanelPrompt('a weathered fisherman in oilskins', 'live-action photoreal', '16:9');
  assert.ok(/3-column.*2-row|3x2|six-panel|6-panel/i.test(s));
  assert.ok(/mid-gray/i.test(s));
  assert.ok(/identical|locked/i.test(s));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add the builder + the option. Default `sheetLayout` is `'8-shot'` so existing output is unchanged; `'6-panel'` selects the new builder in `buildCharacterSheetPrompts`.

```ts
export function characterSheetSixPanelPrompt(description: string, style: string, aspectRatio: string): string {
  return [
    `A 6-panel character reference sheet arranged as a 3-column by 2-row grid in a single ${aspectRatio} frame, thin clean white gutters between panels.`,
    `Each panel shows the same single character — ${description}.`,
    'Panel 1 (top-left): full body front. Panel 2 (top-center): side profile close headshot, left side. Panel 3 (top-right): full body back.',
    'Panel 4 (bottom-left): side profile close headshot, right side. Panel 5 (bottom-center): front face close headshot. Panel 6 (bottom-right): detail shot (hands / accessory / held prop).',
    'Even neutral mid-gray seamless backdrop applied uniformly across all six panels, no seam line, no gradient.',
    `Style: ${style}. Identical character identity locked across all six panels — same face, skin, hair, wardrobe, accessories, proportions in every cell.`,
  ].join(' ');
}
```

Thread `sheetLayout` into `buildCharacterSheetPrompts` (description-only mode picks the 6-panel builder when `sheetLayout === '6-panel'`).

- [ ] **Step 4: Verify pass** + full suite (`fail 0` — default path untouched).

- [ ] **Step 5: Commit**

```bash
git add src/video/filmmaking-prompts.ts src/tests/filmmaking-sixpanel.test.ts
git commit -m "feat(filmmaking): opt-in 6-panel mid-gray character sheet (WS3)"
```

---

# PHASE 4 — WS4 Genre-resolved styleLine + music-sync

### Task 4.1: Genre-resolved styleLine (Nolan as fallback)

**Files:**
- Modify: `src/video/multi-shot-prompt.ts` (add `resolveStyleLine`; thread an optional `genre` into the public generation entry)
- Test: `src/tests/multishot-styleline.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/multishot-styleline.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStyleLine } from '../video/multi-shot-prompt.js';

test('unknown/absent genre falls back to the Nolan style line', () => {
  assert.ok(/Christopher Nolan/.test(resolveStyleLine()));
  assert.ok(/Christopher Nolan/.test(resolveStyleLine('totally-unknown')));
});
test('music-video does NOT read as a Nolan narrative', () => {
  const s = resolveStyleLine('music-video');
  assert.ok(!/Christopher Nolan/.test(s));
  assert.ok(s.length > 0);
});
test('action resolves to its own line', () => {
  assert.ok(!/Christopher Nolan/.test(resolveStyleLine('action')));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add a small genre→styleLine map + resolver in `multi-shot-prompt.ts` (a local map avoids a circular import with filmmaking-prompts):

```ts
const GENRE_STYLE_LINES: ReadonlyMap<string, string> = new Map([
  ['music-video', 'Saturated stage color, rhythmic lighting, performance energy. Bold contrast, expressive grade, beat-driven cutting.'],
  ['action', 'Punchy high-contrast teal-and-orange, kinetic handheld, crushed shadows, aggressive coverage.'],
  ['anime', '2D anime cel-shading, clean line work, painterly backgrounds, vivid saturated palette.'],
  ['noir', 'High-contrast black and white, harsh chiaroscuro, deep shadow, 35mm grain.'],
  ['influencer', 'Bright clean social-first look, soft flattering key, natural skin, crisp and current.'],
  ['pixar', 'Stylized 3D render, soft global illumination, expressive proportions, warm inviting palette.'],
]);

/**
 * Resolve a preset style line for a genre. Falls back to the cinematic Nolan
 * line (today's hardcoded default) for unknown/absent genres.
 */
export function resolveStyleLine(genre?: string): string {
  if (!genre) return CINEMATIC_15S_PRESET.styleLine;
  return GENRE_STYLE_LINES.get(genre.toLowerCase()) ?? CINEMATIC_15S_PRESET.styleLine;
}
```

Thread an optional `genre` into the public multi-shot generation entry (find `generateMultiShotPromptText`/its options): when present, use `resolveStyleLine(genre)` in place of `preset.styleLine`. Default (no genre) → identical output.

- [ ] **Step 4: Verify pass** + full suite (`fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/video/multi-shot-prompt.ts src/tests/multishot-styleline.test.ts
git commit -m "feat(multi-shot): genre-resolved style line, Nolan fallback (WS4)"
```

### Task 4.2: musicSyncLine emitter + wire into music-video AUDIO line

**Files:**
- Modify: `src/video/cinematography.ts` (add `musicSyncLine`)
- Modify: `src/video/filmmaking-prompts.ts:853` (AUDIO/MOOD line — music-video genre)
- Test: `src/tests/cinematography-musicsync.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/cinematography-musicsync.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicSyncLine } from '../video/cinematography.js';
test('musicSync names beat alignment without negative tempo direction', () => {
  const s = musicSyncLine(120, 'standard');
  assert.ok(/beat|downbeat|on the beat/i.test(s));
  assert.ok(!/slow.?motion|no music/i.test(s)); // positive tempo phrasing only
});
test('rich includes BPM', () => {
  assert.ok(/120/.test(musicSyncLine(120, 'rich')));
});
```

(Honors `[[multi-shot-no-slow-motion-direction]]`: positive tempo phrasing, no negation.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `musicSyncLine`:

```ts
/**
 * Beat-aligned audio direction for music videos. Positive tempo phrasing only
 * (negative direction like "no slow motion" does not work on these models).
 */
export function musicSyncLine(bpm: number | undefined, d: DetailLevel): string {
  if (d === 'terse') {
    return 'cuts and motion land on the beat';
  }
  const tempo = bpm ? ` at ${bpm} BPM` : '';
  const core = `cuts, accents, and subject motion land on the downbeat${tempo}, edited to the music's rhythm`;
  if (d === 'standard') {
    return core;
  }
  return `${core}; energy builds into each drop and holds through the bar`;
}
```

In `seedancePromptText`, when `genreStyle.genre === 'music-video'`, replace the `AUDIO / MOOD: No music...` line with a music-sync line:

```ts
    genreStyle.genre === 'music-video'
      ? `AUDIO / MOOD: Music-driven — ${musicSyncLine(undefined, detail)}.`
      : `AUDIO / MOOD: No music. Natural ambience and subject-driven sound only.${detail === 'rich' ? ` ${richAudioSuffix()}` : ''}`,
```

Note: the existing `seedance-music-default` warning is pushed unconditionally in `buildSeedancePackets`; gate it so music-video genre does NOT emit the "defaults to NO MUSIC" warning.

- [ ] **Step 4: Verify pass** + full suite. Update any golden asserting the music-video AUDIO line.

- [ ] **Step 5: Commit**

```bash
git add src/video/cinematography.ts src/video/filmmaking-prompts.ts src/tests/cinematography-musicsync.test.ts
git commit -m "feat(filmmaking): music-sync AUDIO line for music-video genre (WS4)"
```

---

# PHASE 5 — Standing prompt-rules additions

### Task 5r.1: checkNegativeDirection (7th prompt-quality checker)

**Files:**
- Modify: `src/video/prompt-quality.ts` (add checker; call from `runPromptQualityChecks` at :427)
- Test: `src/tests/prompt-quality-negative.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/prompt-quality-negative.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPromptQualityChecks } from '../video/prompt-quality.js';

test('flags negative tempo/motion direction as a warning', () => {
  const issues = runPromptQualityChecks('A hero shot, no slow motion, dont make it blurry.');
  assert.ok(issues.some((i) => /negative direction/i.test(i.message)));
});
test('sanctioned suppressions (on-screen text, specular) are NOT flagged', () => {
  const issues = runPromptQualityChecks('Hero shot. No on-screen text, no captions. Specular highlights removed from skin.');
  assert.ok(!issues.some((i) => /negative direction/i.test(i.message)));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add a checker that warns on negated motion/tempo/quality direction but allow-lists the three sanctioned suppressions (on-screen text, per-zone specular kill, anti-plastic). Match the existing checker signature/return shape used by the other 6 (PromptQualityIssue with code/severity/message). Use `currentSeverity()`. Add a new code value to the `PromptQualityIssue` `code` union (e.g. `'negative-direction'`). Wire the call into `runPromptQualityChecks` and include in its returned array.

```ts
const SANCTIONED_NEGATIONS = [
  /no on-?screen text/i, /no captions?/i, /no signage/i, /no rendered text/i,
  /specular[^.]*removed/i, /no .*shine/i, /no oily/i, /never .*plastic/i, /no acne|no blemish/i,
];
const NEGATIVE_DIRECTION = /\b(no|dont|don't|avoid|without|never)\b[^.]*\b(slow[- ]?motion|blur|fast|motion|movement|camera shake|zoom)\b/i;

function checkNegativeDirection(prompt: string, severity: PromptQualitySeverity): PromptQualityIssue | null {
  for (const s of prompt.split(/(?<=[.!?])\s+/)) {
    if (NEGATIVE_DIRECTION.test(s) && !SANCTIONED_NEGATIONS.some((re) => re.test(s))) {
      return {
        code: 'negative-direction',
        severity,
        message: `negative direction ("${s.trim().slice(0, 60)}") — these models ignore negated motion/tempo; rephrase as positive ("smooth controlled push-in", "crisp focus"). Negatives are only sanctioned for on-screen text, specular kill, and anti-plastic.`,
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: Verify pass** + full suite (`fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/video/prompt-quality.ts src/tests/prompt-quality-negative.test.ts
git commit -m "feat(prompt-quality): checkNegativeDirection warn-lint (rules)"
```

### Task 5r.2: negativeToPositive standing-rule helper

**Files:**
- Modify: `src/video/prompt-rules.ts` (add `negativeToPositive`)
- Test: `src/tests/prompt-rules-negative.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { negativeToPositive } from '../video/prompt-rules.js';
test('rewrites identity-drift prohibition into a positional lock', () => {
  const out = negativeToPositive('Keep the character. No identity drift.');
  assert.ok(/identical|stays|locked|same/i.test(out));
  assert.ok(!/no identity drift/i.test(out));
});
test('leaves sanctioned on-screen-text negation intact', () => {
  assert.ok(/no on-screen text/i.test(negativeToPositive('Hero shot. No on-screen text.')));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** a small deterministic rewrite map (prohibition → positive lock), leaving the three sanctioned negations untouched.

```ts
const NEGATIVE_TO_POSITIVE: ReadonlyArray<[RegExp, string]> = [
  [/no identity drift\.?/gi, 'face, hair, wardrobe, and silhouette stay identical throughout.'],
  [/no face morphing\.?/gi, 'facial features stay stable across all frames.'],
  [/don'?t move (the )?feet\.?/gi, 'boots stay planted on the same ground marks.'],
];

/** Rewrite known prohibitions into positive positional/behavioral locks. */
export function negativeToPositive(text: string): string {
  let out = text;
  for (const [re, replacement] of NEGATIVE_TO_POSITIVE) {
    out = out.replace(re, replacement);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}
```

- [ ] **Step 4: Verify pass** + full suite.

- [ ] **Step 5: Commit**

```bash
git add src/video/prompt-rules.ts src/tests/prompt-rules-negative.test.ts
git commit -m "feat(prompt-rules): negativeToPositive standing-rule helper (rules)"
```

---

# PHASE 6 — WS5 Subject Lock / Frame Map / Cross-Frame / Last Frame emitters

### Task 5.0: Resolve the binding mode from the WS0 probe

Read `docs/superpowers/notes/ark-reference-order-result.md`. Set a module constant in the new emitter file:
`const POSITIONAL_BINDING = <true if 'binding: positional', else false>;`
If `binding: ignored` or `unknown` → `false` (emit `@imageN` as guidance only).

### Task 5.1: Block emitters (frameMap / subjectLock / crossFrame / lastFrame)

**Files:**
- Create: `src/video/seedance-blocks.ts`
- Test: `src/tests/seedance-blocks.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/seedance-blocks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameMapBlock, subjectLockBlock, crossFrameBlock, lastFrameBlock } from '../video/seedance-blocks.js';

test('subjectLockBlock binds @imageN per character', () => {
  const s = subjectLockBlock([{ label: 'a weathered fisherman', slot: '@image1' }]);
  assert.ok(/@image1/.test(s));
  assert.ok(/a weathered fisherman/.test(s));
});
test('frameMapBlock lists ordered beats with timecodes', () => {
  const s = frameMapBlock([{ t: '0:00-0:03', beat: 'establish' }, { t: '0:03-0:06', beat: 'develop' }]);
  assert.ok(/0:00-0:03/.test(s) && /0:03-0:06/.test(s));
});
test('crossFrameBlock locks identity across cuts', () => {
  assert.ok(/identical|same .*across/i.test(crossFrameBlock()));
});
test('lastFrameBlock suppresses on-screen text', () => {
  assert.ok(/no on-screen text|no captions|no rendered text/i.test(lastFrameBlock('resolved hero frame')));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `src/video/seedance-blocks.ts`:

```ts
export interface SubjectLockEntry {
  label: string;   // visual descriptor, NOT a proper name
  slot: string;    // e.g. '@image1'
}

export interface FrameMapEntry {
  t: string;       // timecode range
  beat: string;
}

/** FRAME MAP — ordered beats with timecodes. */
export function frameMapBlock(entries: FrameMapEntry[]): string {
  const lines = entries.map((e) => `  ${e.t}: ${e.beat}`).join('\n');
  return `FRAME MAP:\n${lines}`;
}

/** SUBJECT LOCK — per-character identity binding to @imageN slots. */
export function subjectLockBlock(entries: SubjectLockEntry[]): string {
  if (entries.length === 0) {
    return 'SUBJECT LOCK: preserve the primary subject identical across every frame.';
  }
  const lines = entries.map((e) => `  ${e.slot}: ${e.label} — lock this identity, do not alter.`).join('\n');
  return `SUBJECT LOCK:\n${lines}`;
}

/** CROSS-FRAME RULES — identity/geography stability across cuts. */
export function crossFrameBlock(): string {
  return 'CROSS-FRAME RULES: face, hair, wardrobe, silhouette, palette, and geography stay identical across every cut; lighting logic and lens language established once and held.';
}

/** LAST FRAME — closing composition lock + sanctioned text suppression. */
export function lastFrameBlock(closing: string): string {
  return `LAST FRAME: ${closing}. No on-screen text, no captions, no signage typography, no rendered text in the frame.`;
}
```

- [ ] **Step 4: Verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/video/seedance-blocks.ts src/tests/seedance-blocks.test.ts
git commit -m "feat(seedance): Subject Lock / Frame Map / Cross-Frame / Last Frame block emitters (WS5)"
```

---

# PHASE 7 — WS6 10-block Seedance master-prompt (NEW DEFAULT)

> **Largest blast radius.** This reorganizes `seedancePromptText` (filmmaking-prompts.ts:783) into Joey's 10-block order and makes it the default. Golden packet tests + `smoke:multi-shot` + filmmaking-prompts smokes move to the new format **in this commit boundary**.

### Task 6.1: Reorder text-driven seedance packet into the 10-block contract

**Files:**
- Modify: `src/video/filmmaking-prompts.ts:783-860` (`seedancePromptText` variant A / text-driven branch)
- Modify: existing golden tests under `src/tests/` that assert the text-driven packet
- Test: `src/tests/filmmaking-tenblock.test.ts` (new)

- [ ] **Step 1: Write the new-format test**

```ts
// src/tests/filmmaking-tenblock.test.ts — assert block presence + order
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js'; // use the real entry + a tmp fixture

test('text-driven packet emits the 10 blocks in Joey order', async () => {
  // Build a minimal project fixture via the existing test helpers (mkdtemp),
  // generate prompts, take the first text-driven packet's promptText.
  const text = '<packet promptText from fixture>';
  const order = ['SCENE & MOOD', 'FRAME MAP', 'SUBJECT LOCK', 'CROSS-FRAME', 'MOVEMENT', 'LAST FRAME', 'WORLD PLATE', 'SOUND BED', 'CAPTURE REALISM', 'CAMERA CAPTURE'];
  let last = -1;
  for (const block of order) {
    const idx = text.indexOf(block);
    assert.ok(idx > last, `block ${block} out of order or missing`);
    last = idx;
  }
});
```

(Use the existing filmmaking-prompts test fixture pattern — find a current `cli-*`/`filmmaking*` test that builds a tmp project and reuse its setup.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — rewrite the text-driven return (lines 847-859) to assemble the 10 blocks using `seedance-blocks.ts` emitters + `captureRealismBlock` + the genre style line + `audioMix`/`musicSyncLine`. Keep `withGridGuard` semantics for grid-bearing variants (the two grid variants keep their structure but ALSO adopt the block labels). Preserve the existing `noFaceLine`, character-context descriptions, and the GRID_SINGLE_FRAME_GUARD invariant.

Pseudocode of the new text-driven body (real strings drawn from existing data):

```ts
return [
  `SCENE & MOOD: ${duration} ${genreStyle.formatTone} at ${aspectRatio}. ${cleanSentence(input.brief?.intent ?? input.scene.description)}`,
  '',
  frameMapBlock(threeBeatFrameMap(input.durationSeconds, action, aspectRatio)),
  '',
  subjectLockBlock(subjectLockEntriesFromContext(input)),  // binds @imageN per POSITIONAL_BINDING
  '',
  crossFrameBlock(),
  '',
  `MOVEMENT: ${cameraSpec(RICH_CAMERA_MOVE, detail)}.`,
  '',
  lastFrameBlock('resolved final beat, clean composition'),
  '',
  `WORLD PLATE: ${input.brief?.title ?? input.scene.description}.`,
  '',
  genreStyle.genre === 'music-video'
    ? `SOUND BED: ${musicSyncLine(undefined, detail)}.`
    : `SOUND BED: ${audioMix(detail)}.`,
  '',
  `CAPTURE REALISM: ${captureRealismBlock({}, detail)}`,
  '',
  `CAMERA CAPTURE: ${genreStyle.gridStyleDescriptors}, ${aspectRatio} held across every shot.${detail === 'rich' ? ` ${richCinematographySuffix({ realism: {} })}` : ''}`,
  noFaceLine,
].filter(Boolean).join('\n');
```

Add the small private helpers `threeBeatFrameMap()` and `subjectLockEntriesFromContext()` in filmmaking-prompts.ts. `subjectLockEntriesFromContext` emits `@imageN` slots only when `POSITIONAL_BINDING` (imported from seedance-blocks.ts as a const, or read once) is true; otherwise emits descriptor-only guidance lines.

- [ ] **Step 4: Run to verify it passes** — new test PASS. Then run the FULL suite and FIX every moved golden in this same commit:
`node --test dist/tests/*.test.js 2>&1 | grep -E "not ok"` → update each failing golden's expected string to the new block format.

- [ ] **Step 5: Update the two smokes**

Run `npm run smoke:multi-shot` and the filmmaking-prompts smoke; update their expected fixtures to the new default format.

- [ ] **Step 6: Commit (single boundary — code + goldens + smokes together)**

```bash
git add src/video/filmmaking-prompts.ts src/tests/ scripts/ docs/
git commit -m "feat(filmmaking)!: 10-block Seedance master-prompt as the new default (WS6)"
```

### Task 6.2: Extend the QA-pass to validate block presence/order

**Files:**
- Modify: `src/video/prompt-quality.ts` (add `checkSeedanceBlockOrder` usable on a full packet) OR add a validator in filmmaking-prompts issues
- Test: `src/tests/filmmaking-tenblock.test.ts` (extend)

- [ ] **Step 1–4:** Add a check that emits a `FilmmakingPromptIssue` (warning) when a text-driven packet is missing a block or has them out of order; test a deliberately broken string fails the check and a good one passes.

- [ ] **Step 5: Commit**

```bash
git add src/video/prompt-quality.ts src/video/filmmaking-prompts.ts src/tests/filmmaking-tenblock.test.ts
git commit -m "feat(prompt-quality): validate 10-block Seedance packet order (WS6)"
```

---

# PHASE 8 — WS7 Background-plate slot + wire referenceBuildOrder

### Task 7.1: Add 'background-plate' reference role

**Files:**
- Modify: `src/video/filmmaking-prompts.ts:42-50` (`FilmmakingReferenceSlot.role` union)
- Test: `src/tests/filmmaking-bgplate-role.test.ts` (new)

- [ ] **Step 1: Failing test** — assert a slot with `role: 'background-plate'` type-checks and round-trips through the artifact.

- [ ] **Step 2–4:** Add `'background-plate'` to the role union; ensure any exhaustive switches over `role` handle it.

- [ ] **Step 5: Commit**

```bash
git add src/video/filmmaking-prompts.ts src/tests/filmmaking-bgplate-role.test.ts
git commit -m "feat(filmmaking): add background-plate reference role (WS7)"
```

### Task 7.2: Consult referenceBuildOrder in buildReferenceMap

**Files:**
- Modify: `src/video/filmmaking-prompts.ts:575-607` (`buildReferenceMap` — import + use `referenceBuildOrder`)
- Test: `src/tests/filmmaking-buildorder.test.ts` (new)

- [ ] **Step 1: Failing test** — assert that when a base-ref and a scene-plate both exist, the emitted reference map orders base-ref → sheet → scene-plate (activating the previously-orphaned discipline), and the canonical sheet is never replaced by a scene plate.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — import `referenceBuildOrder, ReferenceBuildStep` from `./category-registry.js`; sort/group the emitted slots by the build-order sequence; document `@imageN == array order` per WS0. This is the task that gives `referenceBuildOrder` its first non-test caller.

- [ ] **Step 4: Verify pass** + full suite (existing single-character projects: base-ref→sheet only, order unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/video/filmmaking-prompts.ts src/tests/filmmaking-buildorder.test.ts
git commit -m "feat(filmmaking): wire referenceBuildOrder discipline into buildReferenceMap (WS7)"
```

---

# PHASE 9 — WS8 Outfit-swap / outfit-build prompt emitters

### Task 8.1: outfit-prompts.ts (prompt-emitter only, no runtime gen)

**Files:**
- Create: `src/video/outfit-prompts.ts`
- Test: `src/tests/outfit-prompts.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/outfit-prompts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outfitSwapPrompt, outfitBuildPrompt } from '../video/outfit-prompts.js';

test('outfitSwap is a lean two-reference prompt with fixed @image1=outfit/@image2=identity order', () => {
  const s = outfitSwapPrompt();
  assert.ok(/@image1/.test(s) && /@image2/.test(s));
  assert.ok(/outfit and pose from @image1/i.test(s));
  assert.ok(/face.*body.*from @image2/i.test(s) || /from @image2/.test(s));
  assert.ok(/mid-gray/i.test(s));
});
test('outfitBuild step builds wardrobe on a bland model first', () => {
  const s = outfitBuildPrompt('a charcoal wool overcoat');
  assert.ok(/bland|generic|slim model/i.test(s));
  assert.ok(/charcoal wool overcoat/.test(s));
  assert.ok(/mid-gray/i.test(s));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — Joey's locked lean strings:

```ts
/**
 * Two-reference outfit swap. Order is FIXED: @image1 = outfit/pose,
 * @image2 = character/identity. Reversing breaks the swap. Lean prompt only —
 * NO cinema stack appended (the references carry the photographic register).
 * Prompt-emitter only: the operator pastes this into the external image tool.
 */
export function outfitSwapPrompt(): string {
  return 'Replace the character in @image1 with the character in @image2. Keep the outfit and pose from @image1 exactly. Match the face, bone structure, body type, skin tone, and hair from @image2. Even neutral mid-gray seamless background, soft large-source studio lighting, skin and outfit at their true natural tone against the neutral gray, natural film grain, full body framing.';
}

/** Step 1 of the two-step build: design the outfit on a bland generic model. */
export function outfitBuildPrompt(outfit: string): string {
  return `Build this outfit on a bland generic slim model (no specific identity): ${outfit}. The outfit is the only subject. Even neutral mid-gray seamless background, soft studio lighting, full body framing, natural film grain.`;
}
```

- [ ] **Step 4: Verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/video/outfit-prompts.ts src/tests/outfit-prompts.test.ts
git commit -m "feat(outfit): outfit-swap + two-step outfit-build prompt emitters (WS8)"
```

---

# PHASE 10 — WS-guard: photoreal-face guard on seedance-direct

### Task g.1: Block photoreal-face references on the seedance-direct route

**Files:**
- Modify: `src/video/native-seedance.ts` (or `execution-runtime.ts` `buildExecutionPayload` where seedance-direct references are resolved) — add a guard
- Test: `src/tests/seedance-face-guard.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
// src/tests/seedance-face-guard.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoPhotorealFaceRefs } from '../video/native-seedance.js'; // new export

test('rejects a reference flagged as a photoreal face on seedance-direct', () => {
  assert.throws(
    () => assertNoPhotorealFaceRefs([{ path: '/x/face.png', kind: 'photoreal-face' } as any]),
    /photoreal face|content filter|no-faces/i,
  );
});
test('allows Asset:// and non-face references', () => {
  assert.doesNotThrow(() => assertNoPhotorealFaceRefs([{ assetUri: 'Asset://abc' } as any, { path: '/x/plate.png' } as any]));
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add `assertNoPhotorealFaceRefs(refs)` that throws a clear error pointing the operator to `filmmaking-prompts --no-faces` / Asset Library, and call it in the seedance-direct submit path BEFORE `assertReferenceBudget`. A reference is "photoreal-face" only when explicitly tagged as such (don't heuristically block legitimate Asset:// avatars or silhouette plates). Keep it scoped to the seedance-direct route — do not touch Dreamina/Runway.

- [ ] **Step 4: Verify pass** + full suite. (Preserve the ark/Asset-Library path; the guard runs before budget preflight, not replacing it.)

- [ ] **Step 5: Commit**

```bash
git add src/video/native-seedance.ts src/tests/seedance-face-guard.test.ts
git commit -m "feat(seedance): guard photoreal-face refs off the seedance-direct route (WS-guard)"
```

---

# PHASE 11 — WS9 Post-production: cut-at-3s trim, letterbox, gated Topaz

### Task 9.1: Per-clip cut-at-3s tail trim

**Files:**
- Modify: `src/video/assemble/ffmpeg.ts` (add a trim arg builder)
- Test: `src/tests/assemble-trim.test.ts` (new)

- [ ] **Step 1: Failing test** (pure arg-builder, no real ffmpeg):

```ts
// src/tests/assemble-trim.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimTailArgs } from '../video/assemble/ffmpeg.js';

test('trimTailArgs cuts to maxSeconds with -t', () => {
  const args = trimTailArgs(3);
  assert.deepEqual(args, ['-t', '3']);
});
test('zero/undefined means no trim', () => {
  assert.deepEqual(trimTailArgs(0), []);
  assert.deepEqual(trimTailArgs(undefined), []);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `trimTailArgs(maxSeconds?: number): string[]` returning `['-t', String(maxSeconds)]` when `maxSeconds > 0`, else `[]`; thread it into the per-clip ffmpeg invocation in the stitch path (find where each scene clip is normalized before concat). Confirm the exact arg position against the existing ffmpeg builder pattern in `ffmpeg.ts`.

- [ ] **Step 4: Verify pass** + `npm run smoke:assemble` (dry).

- [ ] **Step 5: Commit**

```bash
git add src/video/assemble/ffmpeg.ts src/tests/assemble-trim.test.ts
git commit -m "feat(assemble): per-clip cut-at-3s tail trim (WS9)"
```

### Task 9.2: Letterbox normalization filter

**Files:**
- Modify: `src/video/assemble/ffmpeg.ts` (add `letterboxFilter`)
- Test: `src/tests/assemble-letterbox.test.ts` (new)

- [ ] **Step 1: Failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterboxFilter } from '../video/assemble/ffmpeg.js';
test('letterbox to 2.39:1 produces a pad filter', () => {
  const f = letterboxFilter('2.39:1', 1920, 1080);
  assert.ok(/pad=/.test(f) && /black/.test(f));
});
test('no ratio = empty filter', () => {
  assert.equal(letterboxFilter(undefined, 1920, 1080), '');
});
```

- [ ] **Step 2–4:** Implement `letterboxFilter(ratio?, w, h)` returning an ffmpeg `scale,pad` filter string (mirror the DHUAAN TITLEFIT pattern: `scale=W:-2,pad=W:H:0:(oh-ih)/2:black`); empty string when no ratio. Verify via `smoke:assemble`.

- [ ] **Step 5: Commit**

```bash
git add src/video/assemble/ffmpeg.ts src/tests/assemble-letterbox.test.ts
git commit -m "feat(assemble): letterbox normalization filter (WS9)"
```

### Task 9.3: Gated Topaz upscale shell-out (opt-in env flag, no-op if absent)

**Files:**
- Modify: `src/video/assemble/ffmpeg.ts` or new `src/video/assemble/upscale.ts`
- Test: `src/tests/assemble-upscale.test.ts` (new)

- [ ] **Step 1: Failing test** (no real CLI invoked):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topazUpscalePlan } from '../video/assemble/upscale.js';
test('disabled when env flag unset', () => {
  assert.equal(topazUpscalePlan('/in.mp4', '/out.mp4', { enabled: false, cliPath: undefined }).run, false);
});
test('disabled (with reason) when enabled but CLI absent', () => {
  const p = topazUpscalePlan('/in.mp4', '/out.mp4', { enabled: true, cliPath: undefined });
  assert.equal(p.run, false);
  assert.ok(/not installed|absent|missing/i.test(p.reason ?? ''));
});
test('planned when enabled and CLI present', () => {
  const p = topazUpscalePlan('/in.mp4', '/out.mp4', { enabled: true, cliPath: '/usr/local/bin/topaz' });
  assert.equal(p.run, true);
  assert.ok(p.command.includes('/usr/local/bin/topaz'));
});
```

- [ ] **Step 2–4:** Implement a PURE planner `topazUpscalePlan(input, output, opts)` returning `{ run: boolean; reason?: string; command: string[] }`. The flag is `VCLAW_TOPAZ_UPSCALE=1` and CLI path `VCLAW_TOPAZ_CLI`; the actual shell-out (separate thin wrapper) runs only when `plan.run`. Keep the planner pure/deterministic and offline-testable; the real exec stays untested (external dependency).

- [ ] **Step 5: Commit**

```bash
git add src/video/assemble/upscale.ts src/tests/assemble-upscale.test.ts
git commit -m "feat(assemble): gated opt-in Topaz upscale planner (WS9)"
```

---

# PHASE 12 — CLI surface, schema, docs

### Task 12.1: Wire new opt-in flags onto filmmaking-prompts / multi-shot

**Files:**
- Modify: `src/cli/vclaw.ts` (filmmaking-prompts + multi-shot handlers)
- Modify: `src/video/cli-schema.ts` (`COMMANDS`) IF a new subcommand is added
- Modify: `src/tests/cli-schema.test.ts:12` (bump count) IF COMMANDS changed
- Test: `src/tests/cli-joey-flags.test.ts` (new)

New flags (route through EXISTING commands where possible — no new subcommand needed if so):
- `filmmaking-prompts`: `--realism`, `--wet`, `--haze thin|light|heavy`, `--background mid-gray|white|black`, `--sheet 8-shot|6-panel`, `--lighting <id>`, `--grade <id>`
- `multi-shot`: `--genre <id>` (drives `resolveStyleLine`)

- [ ] **Step 1: Failing test** — invoke the handler (or `cli-schema` dump) and assert the flags are parsed and threaded into options (e.g. `--sheet 6-panel` yields a 6-panel prompt; `--genre music-video` yields a non-Nolan style line).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — parse the flags in the hand-rolled argparser, pass into `GenerateFilmmakingPromptsOptions` / multi-shot options. If you add NO new subcommand, do NOT change the COMMANDS count. If you DO add one (e.g. `video outfit-prompt`), append to `COMMANDS` and bump `cli-schema.test.ts:12` from `82` to the new total in the SAME commit.

- [ ] **Step 4: Verify pass** + full suite + `npm run check:omx-alias`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/vclaw.ts src/video/cli-schema.ts src/tests/
git commit -m "feat(cli): Joey-adaptation opt-in flags on filmmaking-prompts + multi-shot (CLI)"
```

### Task 12.2: Docs — CLI_REFERENCE + framework Anti-patterns + CLAUDE.md

**Files:**
- Modify: `docs/CLI_REFERENCE.md`, `references/video/multi-shot-framework.md`, `CLAUDE.md`

- [ ] **Step 1:** Document the new flags + emitters: captureRealismBlock, backgroundPlate/mid-gray, volumetricHaze, wider lighting/grade/hook registers, 6-panel sheet, 10-block default packet, music-sync, negative-direction lint, outfit-swap, cut-at-3s/letterbox/Topaz, the photoreal-face guard, and the trigger-word map (mid-gray → backgroundPlate; haze → volumetricHaze; anti-plastic → captureRealismBlock; wet → moisture; bleach-bypass/lifted-blacks → lift/gamma; no-on-screen-text → Last Frame suppression).

- [ ] **Step 2: Verify docs guardrail**

Run: `npm run check:cleanroom-docs` — expect clean.

- [ ] **Step 3: Commit**

```bash
git add docs/CLI_REFERENCE.md references/video/multi-shot-framework.md CLAUDE.md
git commit -m "docs: Joey cinematic adaptation — flags, emitters, trigger-word map"
```

---

# FINAL — full no-change gate

### Task F.1: Release-readiness pre-flight

- [ ] **Step 1:** `npm run build`
- [ ] **Step 2:** `node --test dist/tests/*.test.js 2>&1 | grep -E "^# (pass|fail)"` → `fail 0`
- [ ] **Step 3:** `npm run check:release-readiness-lite` (build + tests + main smokes + guardrails)
- [ ] **Step 4:** `npm run check:cleanroom-docs`, `npm run check:omx-alias`, `npm run check:artifact-schema-coverage`
- [ ] **Step 5:** Dispatch the final whole-branch code review (subagent-driven-development final reviewer), then finish the branch per `superpowers:finishing-a-development-branch`.

---

## Self-review (against the spec)

**Spec coverage:** WS0→Phase0; WS1→Phase1; WS2→Phase2; WS3→Phase3; WS4→Phase4; standing rules→Phase5; WS5→Phase6; WS6→Phase7; WS7→Phase8; WS8→Phase9; WS-guard→Phase10; WS9→Phase11; CLI/schema/docs→Phase12; final gate→F.1. All 7 locked decisions are reflected (10-block default = Phase7 commit boundary moves goldens+smokes; face guard = Phase10; 8-shot default + 6-panel opt-in = Task 3.3; @imageN gated on WS0 = Task 5.0/6.1; lift/gamma prose-only = Task 2.2; Topaz gated = Task 9.3; one full spec end-to-end).

**Type consistency:** `captureRealismBlock(opts: CaptureRealismOpts, d)` / `CaptureRealismOpts {wet?,haze?,grainStock?}` used identically in Tasks 1.2, 1.3, 6.1. `backgroundPlate(kind: PlateKind, d)` consistent in 3.1/3.2/8.1. `volumetricHaze(density: HazeDensity, d)` consistent. `resolveStyleLine(genre?)`, `musicSyncLine(bpm, d)`, the `seedance-blocks.ts` emitter signatures, and `trimTailArgs`/`letterboxFilter`/`topazUpscalePlan` are each defined once and reused.

**Known verification steps the executor MUST do (not placeholders — explicit instructions):** confirm the byte-exact legacy `richCinematographySuffix()` string in Task 1.3 Step 1 by reading current build output; confirm `character-auto-create.ts`'s public test entry in Task 3.2; reuse an existing filmmaking-prompts tmp-project fixture for Tasks 6.1/7.2; confirm the per-clip ffmpeg invocation site in `assemble/ffmpeg.ts` for Task 9.1.
