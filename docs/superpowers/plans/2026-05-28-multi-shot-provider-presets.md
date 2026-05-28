# Multi-Shot Provider Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `seedance-10s`, `veo-8s`, `runway-10s` presets to the multi-shot framework, with explicit `minShots`/`maxShots` declared on the preset interface and a validator that catches shot counts outside the preset's range.

**Architecture:** Extend the `MultiShotPreset` interface with two required fields (`minShots`, `maxShots`); update the default preset and `buildShotPlan` to honor them; add a central registry map with a `resolvePreset(name?)` helper; re-point the CLI `--preset` validator at the registry; extend `runMultiShotChecks` with a shot-count range check; cover all four presets in parameterized invariant tests and the smoke round-trip.

**Tech Stack:** TypeScript strict NodeNext ESM (`.js` extensions required on relative imports), `node:test` with `assert/strict`, npm Node 20.

**Spec:** [`docs/superpowers/specs/2026-05-28-multi-shot-provider-presets-design.md`](../specs/2026-05-28-multi-shot-provider-presets-design.md)

---

## File map

- **Modify** `src/video/multi-shot-prompt.ts` — interface change, 3 new presets, registry + `resolvePreset`, `buildShotPlan` reads `preset.minShots`/`preset.maxShots`.
- **Modify** `src/video/prompt-quality.ts` — add `multi-shot-shot-count-out-of-range` to `PromptQualityIssueCode`; teach `runMultiShotChecks` to emit it.
- **Modify** `src/cli/vclaw.ts` — point `resolveMultiShotPreset` at the registry; range-check `--shots` against the preset.
- **Modify** `src/tests/multi-shot-prompt.test.ts` — parameterize invariants over all four presets; add validator boundary tests.
- **Modify** `src/tests/cli-multi-shot.test.ts` — per-preset persistence tests; `--shots` out-of-range rejection test.
- **Create** `references/video/.fixtures/multi-shot-seedance-10s.txt` — valid seedance-10s prompt fixture.
- **Create** `references/video/.fixtures/multi-shot-veo-8s.txt` — valid veo-8s prompt fixture.
- **Create** `references/video/.fixtures/multi-shot-runway-10s.txt` — valid runway-10s prompt fixture.
- **Modify** `package.json` — extend `smoke:multi-shot` to round-trip all four presets.
- **Modify** `docs/CLI_REFERENCE.md` — enumerate the four `--preset` values.
- **Modify** `docs/PROMPT_QUALITY.md` — list the new issue code.
- **Modify** `references/video/multi-shot-framework.md` — new "Presets" section.
- **Modify** `skills/multi-shot-prompt/SKILL.md` — preset-picking guidance.

---

## Task 1: Add `minShots`/`maxShots` to the preset interface and switch `buildShotPlan` to read them

**Files:**
- Modify: `src/video/multi-shot-prompt.ts` (lines 10-30, 111-122)
- Modify: `src/tests/multi-shot-prompt.test.ts` (any existing test that asserts shot-count bounds)

- [ ] **Step 1: Write the failing test**

Append to `src/tests/multi-shot-prompt.test.ts`:

```ts
test('CINEMATIC_15S_PRESET declares explicit shot-count bounds', () => {
  assert.equal(CINEMATIC_15S_PRESET.minShots, 3);
  assert.equal(CINEMATIC_15S_PRESET.maxShots, 7);
});

test('buildShotPlan respects preset.minShots / preset.maxShots when --shots not given', () => {
  // A narrowed preset must produce counts strictly inside its declared window.
  const narrowed: MultiShotPreset = {
    ...CINEMATIC_15S_PRESET,
    name: 'narrowed-test',
    minShots: 4,
    maxShots: 4,
  };
  for (let seed = 1; seed <= 30; seed += 1) {
    const plan = buildShotPlan(narrowed, { seed });
    assert.equal(plan.shots.length, 4, `seed=${seed}`);
  }
});
```

(Add `type MultiShotPreset` to the existing import from `'../video/multi-shot-prompt.js'` if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build
node --test dist/tests/multi-shot-prompt.test.js
```

Expected: FAIL — `MultiShotPreset` has no `minShots`/`maxShots` field.

- [ ] **Step 3: Add the fields to the interface and the default preset**

In `src/video/multi-shot-prompt.ts`, replace the interface and `CINEMATIC_15S_PRESET`:

```ts
export interface MultiShotPreset {
  name: string;
  totalSeconds: number;
  minShotSeconds: number;
  maxShotSeconds: number;
  minShots: number;
  maxShots: number;
  maxChars: number;
  styleLine: string;
  audioLine: string;
}

export const CINEMATIC_15S_PRESET: MultiShotPreset = {
  name: 'cinematic-15s',
  totalSeconds: 15,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  minShots: 3,
  maxShots: 7,
  maxChars: 1500,
  styleLine:
    'Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.',
  audioLine:
    'Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.',
};
```

- [ ] **Step 4: Switch `buildShotPlan` to read `preset.minShots` / `preset.maxShots`**

In `src/video/multi-shot-prompt.ts`, replace the `minCount`/`maxCount` computation in `buildShotPlan` (currently lines 116-117):

```ts
  const arithMin = Math.ceil(preset.totalSeconds / preset.maxShotSeconds);
  const arithMax = Math.floor(preset.totalSeconds / preset.minShotSeconds);
  const minCount = Math.max(preset.minShots, arithMin);
  const maxCount = Math.min(preset.maxShots, arithMax);
  if (minCount > maxCount) {
    throw new Error(
      `preset "${preset.name}": shot-count window [${preset.minShots}, ${preset.maxShots}] cannot satisfy duration partition [${arithMin}, ${arithMax}]`,
    );
  }
  let count = options.shots ?? minCount + Math.floor(rand() * (maxCount - minCount + 1));
  if (count < minCount) count = minCount;
  if (count > maxCount) count = maxCount;
```

(Keeps the arithmetic floor/ceiling so an infeasible preset surfaces at construction rather than producing a silent partition error.)

- [ ] **Step 5: Update any pre-existing test that depended on the hardcoded 3–7**

Run the existing test file to find dependants:

```bash
npm run build && node --test dist/tests/multi-shot-prompt.test.js 2>&1 | grep -E "ℹ (tests|pass|fail)|not ok"
```

If any existing test asserts shot count outside `cinematic-15s`'s `3–7`, update it to use a narrowed/widened ad-hoc preset object the way the new test does (don't change the default preset). If no failures appear, skip to Step 6.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run build && node --test dist/tests/multi-shot-prompt.test.js 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all pass, including the two new assertions.

- [ ] **Step 7: Commit**

```bash
git add src/video/multi-shot-prompt.ts src/tests/multi-shot-prompt.test.ts
git commit -m "feat(multi-shot): declare shot-count bounds on the preset interface

Adds required minShots/maxShots to MultiShotPreset; CINEMATIC_15S_PRESET
declares the 3-7 window explicitly. buildShotPlan reads the preset's
window instead of hardcoding 3-7."
```

---

## Task 2: Add the three provider presets and a central registry

**Files:**
- Modify: `src/video/multi-shot-prompt.ts` (after `CINEMATIC_15S_PRESET`)
- Modify: `src/tests/multi-shot-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/multi-shot-prompt.test.ts`:

```ts
import {
  SEEDANCE_10S_PRESET,
  VEO_8S_PRESET,
  RUNWAY_10S_PRESET,
  resolvePreset,
} from '../video/multi-shot-prompt.js';

test('SEEDANCE_10S_PRESET constants', () => {
  assert.equal(SEEDANCE_10S_PRESET.name, 'seedance-10s');
  assert.equal(SEEDANCE_10S_PRESET.totalSeconds, 10);
  assert.equal(SEEDANCE_10S_PRESET.minShotSeconds, 2);
  assert.equal(SEEDANCE_10S_PRESET.maxShotSeconds, 5);
  assert.equal(SEEDANCE_10S_PRESET.minShots, 2);
  assert.equal(SEEDANCE_10S_PRESET.maxShots, 5);
  assert.equal(SEEDANCE_10S_PRESET.maxChars, 1500);
  assert.equal(SEEDANCE_10S_PRESET.styleLine, CINEMATIC_15S_PRESET.styleLine);
  assert.equal(SEEDANCE_10S_PRESET.audioLine, CINEMATIC_15S_PRESET.audioLine);
});

test('VEO_8S_PRESET constants', () => {
  assert.equal(VEO_8S_PRESET.name, 'veo-8s');
  assert.equal(VEO_8S_PRESET.totalSeconds, 8);
  assert.equal(VEO_8S_PRESET.minShotSeconds, 2);
  assert.equal(VEO_8S_PRESET.maxShotSeconds, 4);
  assert.equal(VEO_8S_PRESET.minShots, 2);
  assert.equal(VEO_8S_PRESET.maxShots, 4);
  assert.equal(VEO_8S_PRESET.maxChars, 1500);
});

test('RUNWAY_10S_PRESET constants', () => {
  assert.equal(RUNWAY_10S_PRESET.name, 'runway-10s');
  assert.equal(RUNWAY_10S_PRESET.totalSeconds, 10);
  assert.equal(RUNWAY_10S_PRESET.minShotSeconds, 2);
  assert.equal(RUNWAY_10S_PRESET.maxShotSeconds, 5);
  assert.equal(RUNWAY_10S_PRESET.minShots, 2);
  assert.equal(RUNWAY_10S_PRESET.maxShots, 5);
  assert.equal(RUNWAY_10S_PRESET.maxChars, 1000);
});

test('resolvePreset defaults to cinematic-15s when name is undefined', () => {
  assert.strictEqual(resolvePreset(), CINEMATIC_15S_PRESET);
  assert.strictEqual(resolvePreset(undefined), CINEMATIC_15S_PRESET);
});

test('resolvePreset returns the registered preset for each known name', () => {
  assert.strictEqual(resolvePreset('cinematic-15s'), CINEMATIC_15S_PRESET);
  assert.strictEqual(resolvePreset('seedance-10s'), SEEDANCE_10S_PRESET);
  assert.strictEqual(resolvePreset('veo-8s'), VEO_8S_PRESET);
  assert.strictEqual(resolvePreset('runway-10s'), RUNWAY_10S_PRESET);
});

test('resolvePreset throws on unknown names with the full known list', () => {
  assert.throws(
    () => resolvePreset('bogus-99s'),
    /unknown preset "bogus-99s".*cinematic-15s.*seedance-10s.*veo-8s.*runway-10s/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build
```

Expected: compile errors — `SEEDANCE_10S_PRESET`, `VEO_8S_PRESET`, `RUNWAY_10S_PRESET`, `resolvePreset` are not exported.

- [ ] **Step 3: Add the three presets and the registry**

In `src/video/multi-shot-prompt.ts`, after the existing `CINEMATIC_15S_PRESET` block, add:

```ts
export const SEEDANCE_10S_PRESET: MultiShotPreset = {
  name: 'seedance-10s',
  totalSeconds: 10,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  minShots: 2,
  maxShots: 5,
  maxChars: 1500,
  styleLine: CINEMATIC_15S_PRESET.styleLine,
  audioLine: CINEMATIC_15S_PRESET.audioLine,
};

export const VEO_8S_PRESET: MultiShotPreset = {
  name: 'veo-8s',
  totalSeconds: 8,
  minShotSeconds: 2,
  maxShotSeconds: 4,
  minShots: 2,
  maxShots: 4,
  maxChars: 1500,
  styleLine: CINEMATIC_15S_PRESET.styleLine,
  audioLine: CINEMATIC_15S_PRESET.audioLine,
};

export const RUNWAY_10S_PRESET: MultiShotPreset = {
  name: 'runway-10s',
  totalSeconds: 10,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  minShots: 2,
  maxShots: 5,
  maxChars: 1000,
  styleLine: CINEMATIC_15S_PRESET.styleLine,
  audioLine: CINEMATIC_15S_PRESET.audioLine,
};

const PRESET_REGISTRY: ReadonlyMap<string, MultiShotPreset> = new Map([
  [CINEMATIC_15S_PRESET.name, CINEMATIC_15S_PRESET],
  [SEEDANCE_10S_PRESET.name, SEEDANCE_10S_PRESET],
  [VEO_8S_PRESET.name, VEO_8S_PRESET],
  [RUNWAY_10S_PRESET.name, RUNWAY_10S_PRESET],
]);

export function knownPresetNames(): readonly string[] {
  return Array.from(PRESET_REGISTRY.keys());
}

export function resolvePreset(name?: string): MultiShotPreset {
  if (name === undefined) return CINEMATIC_15S_PRESET;
  const preset = PRESET_REGISTRY.get(name);
  if (!preset) {
    throw new Error(
      `unknown preset "${name}" (known: ${knownPresetNames().join(', ')})`,
    );
  }
  return preset;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build && node --test dist/tests/multi-shot-prompt.test.js 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/video/multi-shot-prompt.ts src/tests/multi-shot-prompt.test.ts
git commit -m "feat(multi-shot): add seedance-10s, veo-8s, runway-10s presets

Three provider-tuned presets registered in PRESET_REGISTRY with a
resolvePreset(name?) helper. Style/audio lines inherit from
cinematic-15s; only the hard provider constraints differ."
```

---

## Task 3: Parameterize `buildShotPlan` invariants across all four presets

**Files:**
- Modify: `src/tests/multi-shot-prompt.test.ts`

- [ ] **Step 1: Add the parameterized test**

Append to `src/tests/multi-shot-prompt.test.ts`:

```ts
const ALL_PRESETS: readonly MultiShotPreset[] = [
  CINEMATIC_15S_PRESET,
  SEEDANCE_10S_PRESET,
  VEO_8S_PRESET,
  RUNWAY_10S_PRESET,
];

for (const preset of ALL_PRESETS) {
  test(`buildShotPlan invariants — ${preset.name}`, () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const plan = buildShotPlan(preset, { seed });
      const n = plan.shots.length;

      assert.ok(
        n >= preset.minShots && n <= preset.maxShots,
        `${preset.name} seed=${seed}: shot count ${n} outside [${preset.minShots}, ${preset.maxShots}]`,
      );

      let cursor = 0;
      let prevSize: string | undefined;
      let prevLens: string | undefined;
      let prevAngle: string | undefined;
      let prevMove: string | undefined;
      for (const shot of plan.shots) {
        const dur = shot.end - shot.start;
        assert.ok(
          dur >= preset.minShotSeconds && dur <= preset.maxShotSeconds,
          `${preset.name} seed=${seed} shot ${shot.index}: duration ${dur}s outside [${preset.minShotSeconds}, ${preset.maxShotSeconds}]`,
        );
        assert.equal(shot.start, cursor, `${preset.name} seed=${seed} shot ${shot.index}: gap/overlap`);
        cursor = shot.end;
        assert.notStrictEqual(shot.shotSize, prevSize, `${preset.name} seed=${seed} shot ${shot.index}: shotSize repeats prev`);
        assert.notStrictEqual(shot.lens, prevLens, `${preset.name} seed=${seed} shot ${shot.index}: lens repeats prev`);
        assert.notStrictEqual(shot.angle, prevAngle, `${preset.name} seed=${seed} shot ${shot.index}: angle repeats prev`);
        assert.notStrictEqual(shot.movement, prevMove, `${preset.name} seed=${seed} shot ${shot.index}: movement repeats prev`);
        prevSize = shot.shotSize;
        prevLens = shot.lens;
        prevAngle = shot.angle;
        prevMove = shot.movement;
      }
      assert.equal(cursor, preset.totalSeconds, `${preset.name} seed=${seed}: total ${cursor}s != ${preset.totalSeconds}s`);
    }
  });
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm run build && node --test dist/tests/multi-shot-prompt.test.js 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all pass. If a preset's count window is genuinely infeasible against its duration window, the test fails and the constants in Task 2 are wrong — fix the preset rather than the test.

- [ ] **Step 3: Commit**

```bash
git add src/tests/multi-shot-prompt.test.ts
git commit -m "test(multi-shot): parameterize buildShotPlan invariants over all presets"
```

---

## Task 4: Add the `multi-shot-shot-count-out-of-range` validator check

**Files:**
- Modify: `src/video/prompt-quality.ts` (`PromptQualityIssueCode` union and `runMultiShotChecks` body)
- Modify: `src/tests/multi-shot-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/multi-shot-prompt.test.ts`:

```ts
import { runMultiShotChecks } from '../video/prompt-quality.js';

function buildPromptFromPlan(plan: ShotPlan, lineText: string): string {
  const metadata = assembleMetadataBlock(plan.preset, 'Test Location', 'evening');
  return composePromptText(
    plan.shots.map((s) => ({ timecode: s.timecode, line: lineText })),
    metadata,
  );
}

test('runMultiShotChecks emits shot-count-out-of-range when too few shots (veo-8s)', () => {
  // veo-8s requires minShots=2; synthesize a 1-shot prompt that totals 8s.
  const text = [
    `[00:00 - 00:08] Single static shot spanning the full duration.`,
    '',
    `Location: Test, evening`,
    `Style: ${VEO_8S_PRESET.styleLine}`,
    `Audio: ${VEO_8S_PRESET.audioLine}`,
  ].join('\n');
  const issues = runMultiShotChecks(text, VEO_8S_PRESET);
  const match = issues.find((i) => i.code === 'multi-shot-shot-count-out-of-range');
  assert.ok(match, `expected shot-count-out-of-range issue, got: ${JSON.stringify(issues)}`);
  assert.equal(match.severity, 'error');
  assert.match(match.message, /too few/i);
});

test('runMultiShotChecks emits shot-count-out-of-range when too many shots (veo-8s)', () => {
  // veo-8s requires maxShots=4; build a 5-shot prompt that still totals 8s and stays within shot-duration bounds.
  // Use 2s+2s+2s+1s+1s — but 1s < minShotSeconds=2 would trip a different check. Instead alternate to 2s+2s+2s+1s+1s.
  // Simpler: use unequal-but-in-range durations that sum to a value > totalSeconds is also wrong. We want shot count high,
  // so let the partition be valid: 5 shots × ~1.6s. But minShotSeconds=2, so 5 shots × 2s = 10s ≠ 8s.
  // For *this* check we want shot count to fail while OTHER checks may also fire — we only assert shot-count-out-of-range is present.
  const lines: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const start = i * 2;
    const end = (i + 1) * 2;
    const mm = (n: number) => String(Math.floor(n / 60)).padStart(2, '0');
    const ss = (n: number) => String(n % 60).padStart(2, '0');
    lines.push(`[${mm(start)}:${ss(start)} - ${mm(end)}:${ss(end)}] Shot ${i}.`);
    lines.push('');
  }
  lines.push(`Location: Test, evening`);
  lines.push(`Style: ${VEO_8S_PRESET.styleLine}`);
  lines.push(`Audio: ${VEO_8S_PRESET.audioLine}`);
  const issues = runMultiShotChecks(lines.join('\n'), VEO_8S_PRESET);
  const match = issues.find((i) => i.code === 'multi-shot-shot-count-out-of-range');
  assert.ok(match, `expected shot-count-out-of-range issue, got: ${JSON.stringify(issues)}`);
  assert.equal(match.severity, 'error');
  assert.match(match.message, /too many/i);
});

test('runMultiShotChecks does NOT emit shot-count-out-of-range at the exact boundaries', () => {
  // cinematic-15s minShots=3, maxShots=7. Build at the min (3 shots × 5s) and max (7 shots: 2+2+2+2+2+2+3).
  const mkPrompt = (durations: number[]) => {
    let cursor = 0;
    const lines: string[] = [];
    for (let i = 0; i < durations.length; i += 1) {
      const start = cursor;
      const end = cursor + durations[i];
      cursor = end;
      const mm = (n: number) => String(Math.floor(n / 60)).padStart(2, '0');
      const ss = (n: number) => String(n % 60).padStart(2, '0');
      lines.push(`[${mm(start)}:${ss(start)} - ${mm(end)}:${ss(end)}] Shot ${i}.`);
      lines.push('');
    }
    lines.push(`Location: Test, evening`);
    lines.push(`Style: ${CINEMATIC_15S_PRESET.styleLine}`);
    lines.push(`Audio: ${CINEMATIC_15S_PRESET.audioLine}`);
    return lines.join('\n');
  };
  for (const durs of [[5, 5, 5], [2, 2, 2, 2, 2, 2, 3]]) {
    const issues = runMultiShotChecks(mkPrompt(durs), CINEMATIC_15S_PRESET);
    const match = issues.find((i) => i.code === 'multi-shot-shot-count-out-of-range');
    assert.equal(match, undefined, `boundary count ${durs.length}: unexpected issue ${JSON.stringify(match)}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build && node --test dist/tests/multi-shot-prompt.test.js 2>&1 | grep -E "ℹ (tests|pass|fail)|not ok"
```

Expected: FAIL with "expected shot-count-out-of-range issue" — the code doesn't exist yet.

- [ ] **Step 3: Add the issue code and the check**

In `src/video/prompt-quality.ts`, add `'multi-shot-shot-count-out-of-range'` to the `PromptQualityIssueCode` union (insert it between `'multi-shot-shot-duration'` and `'multi-shot-overlong'`):

```ts
export type PromptQualityIssueCode =
  | 'prompt-quality-adjective-soup'
  | 'prompt-quality-multiple-actions'
  | 'prompt-quality-multiple-camera-moves'
  | 'prompt-quality-style-word-overload'
  | 'prompt-quality-literary-emotion'
  | 'prompt-quality-overlong'
  | 'multi-shot-timecode-parse'
  | 'multi-shot-timecode-start'
  | 'multi-shot-timecode-gap'
  | 'multi-shot-timecode-total'
  | 'multi-shot-shot-duration'
  | 'multi-shot-shot-count-out-of-range'
  | 'multi-shot-overlong'
  | 'multi-shot-repeated-parameter'
  | 'multi-shot-missing-metadata';
```

In `runMultiShotChecks`, immediately AFTER the `'multi-shot-timecode-total'` block (the `if (total !== preset.totalSeconds) { ... }` block around line 472-478) and BEFORE the `// Consecutive-parameter repetition` comment, insert:

```ts
  // Shot-count window check. Branched message so operators see direction.
  if (shots.length < preset.minShots) {
    issues.push({
      code: 'multi-shot-shot-count-out-of-range',
      severity,
      message: `too few shots: ${shots.length} < preset.minShots=${preset.minShots} (preset "${preset.name}")`,
    });
  } else if (shots.length > preset.maxShots) {
    issues.push({
      code: 'multi-shot-shot-count-out-of-range',
      severity,
      message: `too many shots: ${shots.length} > preset.maxShots=${preset.maxShots} (preset "${preset.name}")`,
    });
  }
```

Notes for the implementer: the parsed array is the local `shots` (not `parsedShots`); `severity` is the local severity variable already in scope (always `'error'` for multi-shot checks). The early-return for `shots.length === 0` above guards against the empty case, so no extra zero-guard is needed here.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build && node --test dist/tests/multi-shot-prompt.test.js 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/video/prompt-quality.ts src/tests/multi-shot-prompt.test.ts
git commit -m "feat(prompt-quality): validate shot count against preset's minShots/maxShots

Adds multi-shot-shot-count-out-of-range issue code and emits a
direction-branched error message when a hand-authored prompt's parsed
shot count falls outside the preset's declared window."
```

---

## Task 5: Wire `vclaw video multi-shot --preset` to the registry; range-check `--shots`

**Files:**
- Modify: `src/cli/vclaw.ts` (`resolveMultiShotPreset`, `handleVideoMultiShot`)
- Modify: `src/tests/cli-multi-shot.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/cli-multi-shot.test.ts`. Use the same helper pattern as existing tests in the file (spawn the built CLI in a tmpdir).

```ts
test('--preset seedance-10s --plan emits a 10s plan within seedance bounds', async () => {
  const out = await runCli(['video', 'multi-shot', '--plan', '--preset', 'seedance-10s', '--seed', '7']);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.preset.name, 'seedance-10s');
  assert.equal(parsed.preset.totalSeconds, 10);
  assert.ok(parsed.shots.length >= 2 && parsed.shots.length <= 5);
});

test('--preset veo-8s --plan emits an 8s plan', async () => {
  const out = await runCli(['video', 'multi-shot', '--plan', '--preset', 'veo-8s', '--seed', '7']);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.preset.name, 'veo-8s');
  assert.equal(parsed.preset.totalSeconds, 8);
  assert.ok(parsed.shots.length >= 2 && parsed.shots.length <= 4);
});

test('--preset runway-10s --plan emits a 10s plan', async () => {
  const out = await runCli(['video', 'multi-shot', '--plan', '--preset', 'runway-10s', '--seed', '7']);
  const parsed = JSON.parse(out.stdout);
  assert.equal(parsed.preset.name, 'runway-10s');
  assert.equal(parsed.preset.maxChars, 1000);
});

test('--preset bogus fails fast with the full known list', async () => {
  const out = await runCli(['video', 'multi-shot', '--plan', '--preset', 'bogus-99s'], { allowFailure: true });
  assert.notEqual(out.exitCode, 0);
  assert.match(out.stderr, /unknown preset "bogus-99s".*cinematic-15s.*seedance-10s.*veo-8s.*runway-10s/);
});

test('--shots above preset.maxShots is rejected', async () => {
  const out = await runCli(['video', 'multi-shot', '--plan', '--preset', 'veo-8s', '--shots', '6'], { allowFailure: true });
  assert.notEqual(out.exitCode, 0);
  assert.match(out.stderr, /--shots 6 outside preset "veo-8s" window \[2, 4\]/);
});

test('--shots below preset.minShots is rejected', async () => {
  const out = await runCli(['video', 'multi-shot', '--plan', '--preset', 'cinematic-15s', '--shots', '2'], { allowFailure: true });
  assert.notEqual(out.exitCode, 0);
  assert.match(out.stderr, /--shots 2 outside preset "cinematic-15s" window \[3, 7\]/);
});
```

If `runCli` helper does not support `allowFailure`, look at how existing tests in the file handle expected-failure invocations and copy that pattern; if none exist, extend `runCli` to allow non-zero exits. Add the helper extension as part of this task.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build && node --test dist/tests/cli-multi-shot.test.ts 2>&1 | grep -E "ℹ (tests|pass|fail)|not ok"
```

Expected: FAIL — the CLI still uses the Phase-1 hardcoded string check that rejects all preset names except `cinematic-15s`.

- [ ] **Step 3: Re-point `resolveMultiShotPreset` at the registry and range-check `--shots`**

In `src/cli/vclaw.ts`:

a. Update the import:

```ts
import {
  CINEMATIC_15S_PRESET,
  buildShotPlan,
  generateMultiShotPromptText,
  resolvePreset,
  type MultiShotPreset,
} from '../video/multi-shot-prompt.js';
```

b. Replace `resolveMultiShotPreset` (currently around line 1975):

```ts
function resolveMultiShotPreset(args: string[]): MultiShotPreset {
  const presetName = parseFlagValue(args, '--preset');
  let preset: MultiShotPreset;
  try {
    preset = { ...resolvePreset(presetName) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`video multi-shot: ${message}`);
  }
  const totalSeconds = parsePositiveIntegerFlag(args, '--total-seconds');
  const maxChars = parsePositiveIntegerFlag(args, '--max-chars');
  const styleLine = parseFlagValue(args, '--style-line');
  const audioLine = parseFlagValue(args, '--audio-line');
  if (totalSeconds !== undefined) preset.totalSeconds = totalSeconds;
  if (maxChars !== undefined) preset.maxChars = maxChars;
  if (styleLine !== undefined) preset.styleLine = styleLine;
  if (audioLine !== undefined) preset.audioLine = audioLine;
  return preset;
}
```

c. In `handleVideoMultiShot`, after parsing `--shots` via `parsePositiveIntegerFlag(args, '--shots')` (currently line 2077), add the range check before passing it to `buildShotPlan`:

```ts
  const shots = parsePositiveIntegerFlag(args, '--shots');
  if (shots !== undefined && (shots < preset.minShots || shots > preset.maxShots)) {
    throw new Error(
      `video multi-shot: --shots ${shots} outside preset "${preset.name}" window [${preset.minShots}, ${preset.maxShots}]`,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run build && node --test dist/tests/cli-multi-shot.test.ts 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-multi-shot.test.ts
git commit -m "feat(cli): wire video multi-shot --preset to the registry, range-check --shots

resolveMultiShotPreset now delegates to the shared registry. --shots
must lie within the preset's [minShots, maxShots] window or the
command fails fast at flag-parse time."
```

---

## Task 6: Per-preset fixtures and extend `smoke:multi-shot`

**Files:**
- Create: `references/video/.fixtures/multi-shot-seedance-10s.txt`
- Create: `references/video/.fixtures/multi-shot-veo-8s.txt`
- Create: `references/video/.fixtures/multi-shot-runway-10s.txt`
- Modify: `package.json` (`smoke:multi-shot` script)

- [ ] **Step 1: Create the seedance-10s fixture**

Write `references/video/.fixtures/multi-shot-seedance-10s.txt`. The fixture must total exactly 10s, have 2–5 shots each within 2–5s, ≤1500 chars, no consecutive camera-param repeats, and include the Location/Style/Audio metadata block with the preset's exact styleLine and audioLine. Example body (timecodes must sum to 10s):

```
[00:00 - 00:03] Wide low-angle of the dancer mid-spin, 24mm anamorphic, slow push-in. Stage lights wash the floor in cobalt.

[00:03 - 00:06] Medium 50mm three-quarter angle, locked-off, smoke catches the side-spot.

[00:06 - 00:10] Close 85mm eye-line tilt-up, slow track-out as the figure stills, ambient hush.

Location: Empty warehouse stage, late night
Style: Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.
Audio: Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.
```

- [ ] **Step 2: Create the veo-8s fixture**

Write `references/video/.fixtures/multi-shot-veo-8s.txt`. Must total exactly 8s, 2–4 shots each within 2–4s, ≤1500 chars. Example:

```
[00:00 - 00:03] Wide 24mm low-angle, slow dolly forward. Neon reflections on wet asphalt.

[00:03 - 00:05] Medium 35mm three-quarter, handheld, character turns into the light.

[00:05 - 00:08] Close 85mm eye-line, locked-off, breath visible in the cold air.

Location: Tokyo back-alley, rain
Style: Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.
Audio: Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.
```

- [ ] **Step 3: Create the runway-10s fixture**

Write `references/video/.fixtures/multi-shot-runway-10s.txt`. Must total exactly 10s, 2–5 shots each within 2–5s, ≤**1000** chars. Keep the body terser than the seedance fixture to stay under the lower budget. Example:

```
[00:00 - 00:03] Wide 24mm low-angle, slow push-in. Cobalt wash.

[00:03 - 00:06] Medium 50mm three-quarter, locked-off, smoke crosses the side-spot.

[00:06 - 00:10] Close 85mm eye-line tilt-up, slow track-out. Figure stills.

Location: Warehouse stage, late night
Style: Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.
Audio: Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.
```

- [ ] **Step 4: Confirm each fixture validates clean**

```bash
npm run build
for p in cinematic-15s seedance-10s veo-8s runway-10s; do
  case $p in
    cinematic-15s) f=references/video/.fixtures/multi-shot-valid.txt ;;
    *)             f=references/video/.fixtures/multi-shot-$p.txt ;;
  esac
  echo "--- $p ---"
  node dist/cli/vclaw.js video multi-shot --validate --preset $p --file $f
done
```

Expected: each invocation prints `{"valid": true, ...}` and exits 0. If any returns nonzero, edit the fixture (most commonly: char count over the budget, or a shot duration outside `[minShotSeconds, maxShotSeconds]`).

- [ ] **Step 5: Extend `smoke:multi-shot` to cover all four presets**

In `package.json`, replace the `smoke:multi-shot` script:

```json
"smoke:multi-shot": "npm run build && for p in cinematic-15s seedance-10s veo-8s runway-10s; do case $p in cinematic-15s) f=references/video/.fixtures/multi-shot-valid.txt;; *) f=references/video/.fixtures/multi-shot-$p.txt;; esac; node dist/cli/vclaw.js video multi-shot --plan --preset $p --seed 1 > /tmp/ms-plan-$p.json && node dist/cli/vclaw.js video multi-shot --validate --preset $p --file $f || exit 1; done",
```

- [ ] **Step 6: Run the smoke**

```bash
npm run smoke:multi-shot
```

Expected: exits 0; `/tmp/ms-plan-*.json` exist for all four presets.

- [ ] **Step 7: Commit**

```bash
git add references/video/.fixtures/multi-shot-seedance-10s.txt \
        references/video/.fixtures/multi-shot-veo-8s.txt \
        references/video/.fixtures/multi-shot-runway-10s.txt \
        package.json
git commit -m "test(multi-shot): per-preset smoke round-trip across all four presets

Adds seedance-10s/veo-8s/runway-10s fixtures and extends smoke:multi-shot
to plan→validate every registered preset."
```

---

## Task 7: Doc updates

**Files:**
- Modify: `docs/CLI_REFERENCE.md`
- Modify: `docs/PROMPT_QUALITY.md`
- Modify: `references/video/multi-shot-framework.md`
- Modify: `skills/multi-shot-prompt/SKILL.md`

- [ ] **Step 1: Update `docs/CLI_REFERENCE.md`**

Find the `## Multi-shot prompt` section (line 663). In the `--preset` flag description, list the four valid names. Locate the existing `--preset <name>` line and replace it with:

```
`--preset <name>` — one of `cinematic-15s` (default), `seedance-10s`, `veo-8s`, `runway-10s`. Each preset declares its own clip duration, shot-count window, per-shot duration bounds, and char budget; the Nolan styleLine and diegetic audioLine are shared. Use `--style-line` / `--audio-line` to override.
```

- [ ] **Step 2: Update `docs/PROMPT_QUALITY.md`**

Find the multi-shot section added during Phase 1 (search for `multi-shot-timecode-parse`). Add `multi-shot-shot-count-out-of-range` to the list of issue codes with a one-line description:

```
- `multi-shot-shot-count-out-of-range` — parsed shot count falls outside the preset's declared `[minShots, maxShots]` window. Severity `error`. Message branches on under vs over.
```

- [ ] **Step 3: Update `references/video/multi-shot-framework.md`**

Add a new `## Presets` section near the top (after the framework overview, before the workflow detail). Reproduce the spec table:

```markdown
## Presets

| preset | totalSeconds | shot range | shot count | maxChars | when to pick |
|---|---|---|---|---|---|
| `cinematic-15s` *(default)* | 15s | 2–5s | 3–7 | 1500 | Hand-authored cinematic clip not bound to a specific provider's clip-duration |
| `seedance-10s` | 10s | 2–5s | 2–5 | 1500 | Target Seedance 2.0 clips |
| `veo-8s` | 8s | 2–4s | 2–4 | 1500 | Target Veo 3.x clips (standard 8s output) |
| `runway-10s` | 10s | 2–5s | 2–5 | 1000 | Target Runway clips (durations enum'd to 5\|8\|10\|15) |

All four share the same Nolan styleLine and diegetic audioLine. Override with `--style-line` / `--audio-line` if you want a different look.
```

- [ ] **Step 4: Update `skills/multi-shot-prompt/SKILL.md`**

Add a short paragraph in the "Workflow" or "Building a plan" section (wherever `--preset` is first mentioned):

```markdown
**Preset selection.** Pick the preset that matches your target provider's clip
duration: `seedance-10s` for Seedance, `veo-8s` for Veo, `runway-10s` for
Runway. Use the default `cinematic-15s` only for hand-authored clips not bound
to a single provider's clip-duration. The CLI enforces each preset's char
budget and shot-count window.
```

- [ ] **Step 5: Verify guardrails pass**

```bash
npm run check:cleanroom-docs
npm run check:skill-frontdoor
```

Expected: both print "passed stale-reference scan".

- [ ] **Step 6: Commit**

```bash
git add docs/CLI_REFERENCE.md docs/PROMPT_QUALITY.md references/video/multi-shot-framework.md skills/multi-shot-prompt/SKILL.md
git commit -m "docs(multi-shot): document seedance-10s, veo-8s, runway-10s presets

CLI_REFERENCE enumerates the four --preset values; PROMPT_QUALITY lists
the new shot-count-out-of-range issue code; the reference doc gains a
Presets table; skill adds preset-selection guidance."
```

---

## Final verification

After Task 7, run the full guardrail suite:

```bash
npm run build
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run smoke:multi-shot
npm run check:cleanroom-docs
npm run check:skill-frontdoor
npm run check:artifact-schema-coverage
```

Expected: build clean, tests all pass, smoke exits 0, all three checks "passed". If any fails, do NOT paper over with `--no-verify`; diagnose and fix the underlying issue.
