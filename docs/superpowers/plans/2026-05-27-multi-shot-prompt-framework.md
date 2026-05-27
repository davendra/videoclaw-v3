# Multi-Shot Prompt Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `vclaw video multi-shot` command that scaffolds, validates, and (optionally, via Gemini) authors compressed timecoded multi-shot cinematic prompts, integrated as a reference doc + skill + code module.

**Architecture:** A pure code module (`multi-shot-prompt.ts`) builds the deterministic timecode plan and metadata block from a parametrized preset; `prompt-quality.ts` is extended with a `runMultiShotChecks` validator reusing its existing vocabularies; a CLI command exposes `--plan`/`--validate`/`--auto`; a JSON Schema + artifact persist results when `--project` is given. The cinematic prose is authored by the repo skill (or Gemini under `--auto`); the code only scaffolds and enforces.

**Tech Stack:** TypeScript (strict, NodeNext ESM — relative imports MUST end in `.js`), `node:test` + `assert/strict`, hand-rolled CLI dispatch in `src/cli/vclaw.ts`, Gemini key pool via `src/video/gemini-analyze.ts`.

---

## Background notes for the engineer

- **Build/test loop:** `npm run build` compiles `src/` → `dist/`. Tests run compiled JS: module tests import siblings like `'../video/multi-shot-prompt.js'`; CLI tests `spawnSync(process.execPath, [join(process.cwd(),'dist','cli','vclaw.js'), ...args])`. Run a single test with `node --test dist/tests/<name>.test.js` **after** `npm run build`.
- **Never edit `dist/`.** Edit `src/` and rebuild.
- **CLI dispatch pattern** (in `src/cli/vclaw.ts`): each subcommand is an `if (command === 'video' && subcommand === '<name>') { await handleX(rest); return; }` block. Flags are read with the existing `parseFlagValue(args, '--flag')` helper (returns `string | undefined`). Output is machine-readable JSON written via `process.stdout.write(JSON.stringify(...))`.
- **Existing vocab to reuse** (already exported from `src/video/prompt-quality.ts`): `PromptQualityIssue`, `PromptQualitySeverity`, `CAMERA_MOVE_VOCABULARY`, `SHOT_TYPE_VOCABULARY`.
- **Commit after every task.** DRY, YAGNI, TDD.

---

## File structure

- **Create:** `src/video/multi-shot-prompt.ts` — preset type + default preset, `buildShotPlan`, `assembleMetadataBlock`, `formatTimecode`, `composePromptText`.
- **Modify:** `src/video/prompt-quality.ts` — add `MultiShotIssueCode` members + `runMultiShotChecks(prompt, preset)`.
- **Create:** `schemas/video/artifacts/multi-shot-prompt.schema.json` — artifact contract.
- **Modify:** `src/video/types.ts:49` — add `'multi-shot-prompt'` to `VideoStageArtifactName`.
- **Modify:** `src/cli/vclaw.ts` — `handleVideoMultiShot` handler + dispatch block + usage line.
- **Create:** `src/tests/multi-shot-prompt.test.ts` — module-contract tests.
- **Create:** `src/tests/cli-multi-shot.test.ts` — CLI end-to-end tests.
- **Create:** `references/video/multi-shot-framework.md` — reference doc.
- **Modify:** `src/video/prompt-library.ts` — registry entry.
- **Create:** `skills/multi-shot-prompt/SKILL.md` — repo skill.
- **Modify:** `README.md`, `docs/CLI_REFERENCE.md` — docs.
- **Modify:** `package.json` — `smoke:multi-shot` script (optional).

---

## Task 1: Core module — preset, timecode plan, metadata block

**Files:**
- Create: `src/video/multi-shot-prompt.ts`
- Test: `src/tests/multi-shot-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/multi-shot-prompt.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CINEMATIC_15S_PRESET,
  buildShotPlan,
  formatTimecode,
  assembleMetadataBlock,
} from '../video/multi-shot-prompt.js';

describe('multi-shot-prompt: buildShotPlan', () => {
  it('produces shots that sum to the preset total and stay within bounds', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const plan = buildShotPlan(CINEMATIC_15S_PRESET, { seed });
      const total = plan.shots.reduce((sum, s) => sum + (s.end - s.start), 0);
      assert.equal(total, CINEMATIC_15S_PRESET.totalSeconds, `seed ${seed} total`);
      assert.ok(plan.shots.length >= 3 && plan.shots.length <= 7, `seed ${seed} count`);
      assert.equal(plan.shots[0].start, 0);
      for (const s of plan.shots) {
        const dur = s.end - s.start;
        assert.ok(dur >= CINEMATIC_15S_PRESET.minShotSeconds, `seed ${seed} min`);
        assert.ok(dur <= CINEMATIC_15S_PRESET.maxShotSeconds, `seed ${seed} max`);
      }
    }
  });

  it('varies shot count across seeds', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 20; seed += 1) {
      counts.add(buildShotPlan(CINEMATIC_15S_PRESET, { seed }).shots.length);
    }
    assert.ok(counts.size > 1, 'expected varied shot counts across seeds');
  });

  it('respects an explicit shot count', () => {
    const plan = buildShotPlan(CINEMATIC_15S_PRESET, { shots: 5, seed: 1 });
    assert.equal(plan.shots.length, 5);
  });

  it('suggests a non-repeating camera grid for consecutive shots', () => {
    const plan = buildShotPlan(CINEMATIC_15S_PRESET, { shots: 5, seed: 3 });
    for (let i = 1; i < plan.shots.length; i += 1) {
      const prev = plan.shots[i - 1];
      const cur = plan.shots[i];
      assert.notEqual(cur.shotSize, prev.shotSize, `shot ${i} shotSize repeats`);
      assert.notEqual(cur.movement, prev.movement, `shot ${i} movement repeats`);
    }
  });
});

describe('multi-shot-prompt: formatTimecode', () => {
  it('formats seconds as MM:SS', () => {
    assert.equal(formatTimecode(0), '00:00');
    assert.equal(formatTimecode(4), '00:04');
    assert.equal(formatTimecode(65), '01:05');
  });
});

describe('multi-shot-prompt: assembleMetadataBlock', () => {
  it('emits the three-line Location/Style/Audio block', () => {
    const block = assembleMetadataBlock(CINEMATIC_15S_PRESET, 'Tokyo alley', 'night');
    const lines = block.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Location: Tokyo alley, night\.?$/);
    assert.match(lines[1], /^Style: .*Christopher Nolan/);
    assert.match(lines[2], /^Audio: Diegetic sound only/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL — `Cannot find module '../video/multi-shot-prompt.js'` / TS2307.

- [ ] **Step 3: Write the module**

Create `src/video/multi-shot-prompt.ts`:

```typescript
import { CAMERA_MOVE_VOCABULARY, SHOT_TYPE_VOCABULARY } from './prompt-quality.js';

export interface MultiShotPreset {
  name: string;
  totalSeconds: number;
  minShotSeconds: number;
  maxShotSeconds: number;
  maxChars: number;
  styleLine: string;
  audioLine: string;
}

export const CINEMATIC_15S_PRESET: MultiShotPreset = {
  name: 'cinematic-15s',
  totalSeconds: 15,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  maxChars: 1500,
  styleLine:
    'Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.',
  audioLine:
    'Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.',
};

// Suggested camera-grid vocabularies. Shot sizes/angles/lenses are local to the
// framework (prompt-quality's SHOT_TYPE_VOCABULARY is reused where it overlaps).
const SHOT_SIZES = ['wide', 'medium', 'medium close-up', 'close-up', 'macro'] as const;
const LENSES = ['24mm', '35mm', '50mm', '85mm'] as const;
const ANGLES = ['low angle', 'high angle', 'eye-level', 'over-the-shoulder', 'Dutch angle'] as const;
const MOVEMENTS = CAMERA_MOVE_VOCABULARY;

export interface ShotSlot {
  index: number;
  start: number;
  end: number;
  timecode: string;
  shotSize: string;
  lens: string;
  angle: string;
  movement: string;
}

export interface ShotPlan {
  preset: MultiShotPreset;
  shots: ShotSlot[];
}

export interface BuildShotPlanOptions {
  shots?: number;
  seed?: number;
}

// Deterministic, seedable PRNG so plans vary across calls but are reproducible in tests.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTimecode(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// Partition totalSeconds into `count` integer durations, each within [min, max].
function partitionDurations(
  total: number,
  count: number,
  min: number,
  max: number,
  rand: () => number,
): number[] {
  if (count * min > total || count * max < total) {
    throw new Error(
      `cannot partition ${total}s into ${count} shots within [${min}, ${max}]`,
    );
  }
  const durations = new Array(count).fill(min);
  let remaining = total - count * min;
  while (remaining > 0) {
    const i = Math.floor(rand() * count);
    if (durations[i] < max) {
      durations[i] += 1;
      remaining -= 1;
    }
  }
  return durations;
}

function pickNonRepeating<T>(pool: readonly T[], prev: T | undefined, rand: () => number): T {
  if (pool.length === 1) return pool[0];
  let choice = pool[Math.floor(rand() * pool.length)];
  let guard = 0;
  while (choice === prev && guard < 16) {
    choice = pool[Math.floor(rand() * pool.length)];
    guard += 1;
  }
  return choice;
}

export function buildShotPlan(
  preset: MultiShotPreset,
  options: BuildShotPlanOptions = {},
): ShotPlan {
  const rand = mulberry32(options.seed ?? Math.floor(Math.random() * 1e9));
  const minCount = Math.max(3, Math.ceil(preset.totalSeconds / preset.maxShotSeconds));
  const maxCount = Math.min(7, Math.floor(preset.totalSeconds / preset.minShotSeconds));
  let count = options.shots ?? minCount + Math.floor(rand() * (maxCount - minCount + 1));
  if (count < minCount) count = minCount;
  if (count > maxCount) count = maxCount;

  const durations = partitionDurations(
    preset.totalSeconds,
    count,
    preset.minShotSeconds,
    preset.maxShotSeconds,
    rand,
  );

  const shots: ShotSlot[] = [];
  let cursor = 0;
  let prevSize: string | undefined;
  let prevLens: string | undefined;
  let prevAngle: string | undefined;
  let prevMove: string | undefined;
  for (let i = 0; i < count; i += 1) {
    const start = cursor;
    const end = cursor + durations[i];
    cursor = end;
    const shotSize = pickNonRepeating(SHOT_SIZES, prevSize, rand);
    const lens = pickNonRepeating(LENSES, prevLens, rand);
    const angle = pickNonRepeating(ANGLES, prevAngle, rand);
    const movement = pickNonRepeating(MOVEMENTS, prevMove, rand);
    prevSize = shotSize;
    prevLens = lens;
    prevAngle = angle;
    prevMove = movement;
    shots.push({
      index: i,
      start,
      end,
      timecode: `[${formatTimecode(start)} - ${formatTimecode(end)}]`,
      shotSize,
      lens,
      angle,
      movement,
    });
  }
  return { preset, shots };
}

export function assembleMetadataBlock(
  preset: MultiShotPreset,
  location: string,
  timeOfDay: string,
): string {
  const loc = timeOfDay ? `${location}, ${timeOfDay}` : location;
  return [
    `Location: ${loc}.`,
    `Style: ${preset.styleLine}`,
    `Audio: ${preset.audioLine}`,
  ].join('\n');
}

// Compose a full prompt body from a plan whose shots already carry `description`.
export function composePromptText(
  plan: Array<Pick<ShotSlot, 'timecode'> & { line: string }>,
  metadataBlock: string,
): string {
  const body = plan.map((s) => `${s.timecode} ${s.line}`).join('\n\n');
  return `${body}\n\n${metadataBlock}`;
}

export { SHOT_SIZES, LENSES, ANGLES, MOVEMENTS, SHOT_TYPE_VOCABULARY };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/multi-shot-prompt.test.js`
Expected: PASS (all `buildShotPlan`, `formatTimecode`, `assembleMetadataBlock` cases).

- [ ] **Step 5: Commit**

```bash
git add src/video/multi-shot-prompt.ts src/tests/multi-shot-prompt.test.ts
git commit -m "feat: multi-shot prompt module — preset, shot plan, metadata block"
```

---

## Task 2: Validator — `runMultiShotChecks` in prompt-quality

**Files:**
- Modify: `src/video/prompt-quality.ts` (add issue codes near line 3–9; add validator at end of file)
- Test: `src/tests/multi-shot-prompt.test.ts` (append a new `describe`)

- [ ] **Step 1: Write the failing test**

Append to `src/tests/multi-shot-prompt.test.ts`:

```typescript
import { runMultiShotChecks, type PromptQualityIssue } from '../video/prompt-quality.js';

const VALID_PROMPT = [
  '[00:00 - 00:04] Wide, 24mm, low angle, tracking — a man walks through a Tokyo alley.',
  '',
  '[00:04 - 00:07] Medium, 50mm, eye-level, handheld — he moves between food stalls.',
  '',
  '[00:07 - 00:09] Close-up, 85mm, high angle, static — his hand brushes a lantern.',
  '',
  '[00:09 - 00:12] Wide, 35mm, Dutch angle, push-in — he emerges into a broad street.',
  '',
  '[00:12 - 00:15] Medium close-up, 50mm, low angle, pull-out — he looks up at a sign.',
  '',
  'Location: Narrow Tokyo alley, night.',
  'Style: Cool shadows, natural skin tones. In the style of a Christopher Nolan movie.',
  'Audio: Diegetic sound only — natural ambience.',
].join('\n');

function codes(issues: PromptQualityIssue[]): string[] {
  return issues.map((i) => i.code);
}

describe('multi-shot-prompt: runMultiShotChecks', () => {
  it('passes a well-formed prompt with no errors', () => {
    const issues = runMultiShotChecks(VALID_PROMPT, CINEMATIC_15S_PRESET);
    assert.equal(issues.filter((i) => i.severity === 'error').length, 0, JSON.stringify(issues));
  });

  it('flags timecodes that do not total the preset duration', () => {
    const bad = VALID_PROMPT.replace('[00:12 - 00:15]', '[00:12 - 00:14]');
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-timecode-total'));
  });

  it('flags non-contiguous timecodes', () => {
    const bad = VALID_PROMPT.replace('[00:04 - 00:07]', '[00:05 - 00:07]');
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-timecode-gap'));
  });

  it('flags a shot shorter than minShotSeconds', () => {
    const bad = [
      '[00:00 - 00:01] Wide, 24mm, low angle, tracking — too short.',
      '',
      '[00:01 - 00:15] Medium, 50mm, eye-level, handheld — too long.',
      '',
      'Location: X, night.',
      'Style: Nolan.',
      'Audio: Diegetic.',
    ].join('\n');
    const c = codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET));
    assert.ok(c.includes('multi-shot-shot-duration'));
  });

  it('flags exceeding the character budget', () => {
    const bad = VALID_PROMPT + ' '.repeat(1600);
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-overlong'));
  });

  it('flags a repeated camera parameter in consecutive shots', () => {
    const bad = VALID_PROMPT.replace(
      '[00:04 - 00:07] Medium, 50mm, eye-level, handheld',
      '[00:04 - 00:07] Wide, 50mm, eye-level, handheld',
    );
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-repeated-parameter'));
  });

  it('flags a missing metadata block', () => {
    const bad = VALID_PROMPT.split('\nLocation:')[0];
    assert.ok(codes(runMultiShotChecks(bad, CINEMATIC_15S_PRESET)).includes('multi-shot-missing-metadata'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: FAIL — `runMultiShotChecks` is not exported (TS2305).

- [ ] **Step 3: Extend the issue-code union**

In `src/video/prompt-quality.ts`, replace the `PromptQualityIssueCode` union (lines 3–9) with:

```typescript
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
  | 'multi-shot-overlong'
  | 'multi-shot-repeated-parameter'
  | 'multi-shot-missing-metadata';
```

- [ ] **Step 4: Add the validator**

Append to the end of `src/video/prompt-quality.ts`. Note the local vocab arrays (don't import from `multi-shot-prompt.ts` — that would create a cycle, since the module imports the vocab FROM here):

```typescript
import type { MultiShotPreset } from './multi-shot-prompt.js';

const MULTI_SHOT_SHOT_SIZES = ['macro', 'close-up', 'medium close-up', 'medium', 'wide'];
const MULTI_SHOT_LENSES = ['24mm', '35mm', '50mm', '85mm'];
const MULTI_SHOT_ANGLES = ['low angle', 'high angle', 'eye-level', 'over-the-shoulder', 'dutch angle'];

const TIMECODE_RE = /\[(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\]/g;

function toSeconds(mm: string, ss: string): number {
  return Number(mm) * 60 + Number(ss);
}

function firstMatch(haystack: string, pool: string[]): string | undefined {
  const lower = haystack.toLowerCase();
  // Longest-first so "medium close-up" wins over "medium".
  for (const term of [...pool].sort((a, b) => b.length - a.length)) {
    if (lower.includes(term)) return term;
  }
  return undefined;
}

export function runMultiShotChecks(
  prompt: string,
  preset: MultiShotPreset,
): PromptQualityIssue[] {
  const severity: PromptQualitySeverity = 'error';
  const issues: PromptQualityIssue[] = [];

  // Character budget.
  if (prompt.length > preset.maxChars) {
    issues.push({
      code: 'multi-shot-overlong',
      severity,
      message: `prompt is ${prompt.length} chars (max ${preset.maxChars})`,
    });
  }

  // Metadata block.
  const hasLocation = /^Location:\s*\S/m.test(prompt);
  const hasStyle = /^Style:\s*\S/m.test(prompt);
  const hasAudio = /^Audio:\s*\S/m.test(prompt);
  if (!hasLocation || !hasStyle || !hasAudio) {
    issues.push({
      code: 'multi-shot-missing-metadata',
      severity,
      message: `missing metadata line(s): ${[!hasLocation && 'Location', !hasStyle && 'Style', !hasAudio && 'Audio'].filter(Boolean).join(', ')}`,
    });
  }

  // Parse timecodes and per-shot lines.
  const shots: Array<{ start: number; end: number; line: string }> = [];
  const lines = prompt.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    TIMECODE_RE.lastIndex = 0;
    const m = TIMECODE_RE.exec(line);
    if (m) {
      shots.push({ start: toSeconds(m[1], m[2]), end: toSeconds(m[3], m[4]), line });
    }
  }

  if (shots.length === 0) {
    issues.push({
      code: 'multi-shot-timecode-parse',
      severity,
      message: 'no parseable timecode stamps found',
    });
    return issues;
  }

  if (shots[0].start !== 0) {
    issues.push({
      code: 'multi-shot-timecode-start',
      severity,
      message: `first shot starts at ${shots[0].start}s (must start at 0)`,
    });
  }

  for (let i = 0; i < shots.length; i += 1) {
    const dur = shots[i].end - shots[i].start;
    if (dur < preset.minShotSeconds || dur > preset.maxShotSeconds) {
      issues.push({
        code: 'multi-shot-shot-duration',
        severity,
        message: `shot ${i + 1} is ${dur}s (allowed ${preset.minShotSeconds}-${preset.maxShotSeconds}s)`,
      });
    }
    if (i > 0 && shots[i].start !== shots[i - 1].end) {
      issues.push({
        code: 'multi-shot-timecode-gap',
        severity,
        message: `shot ${i + 1} starts at ${shots[i].start}s but previous ended at ${shots[i - 1].end}s`,
      });
    }
  }

  const total = shots[shots.length - 1].end - shots[0].start;
  if (total !== preset.totalSeconds) {
    issues.push({
      code: 'multi-shot-timecode-total',
      severity,
      message: `sequence totals ${total}s (must be exactly ${preset.totalSeconds}s)`,
    });
  }

  // Consecutive-parameter repetition (size, lens, angle, movement).
  let prev: { size?: string; lens?: string; angle?: string; move?: string } = {};
  for (let i = 0; i < shots.length; i += 1) {
    const size = firstMatch(shots[i].line, MULTI_SHOT_SHOT_SIZES);
    const lens = firstMatch(shots[i].line, MULTI_SHOT_LENSES);
    const angle = firstMatch(shots[i].line, MULTI_SHOT_ANGLES);
    const move = firstMatch(shots[i].line, [...CAMERA_MOVE_VOCABULARY]);
    if (i > 0) {
      for (const [label, cur, was] of [
        ['shot size', size, prev.size],
        ['lens', lens, prev.lens],
        ['angle', angle, prev.angle],
        ['movement', move, prev.move],
      ] as const) {
        if (cur && was && cur === was) {
          issues.push({
            code: 'multi-shot-repeated-parameter',
            severity,
            message: `shot ${i + 1} repeats ${label} "${cur}" from the previous shot`,
          });
        }
      }
    }
    prev = { size, lens, angle, move };
  }

  return issues;
}
```

> **Cycle note:** `multi-shot-prompt.ts` imports vocab from `prompt-quality.ts`, and `prompt-quality.ts` imports only the **type** `MultiShotPreset` from `multi-shot-prompt.ts`. Type-only imports are erased at compile time, so there is no runtime cycle. Keep the `import type` form exactly as written.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/multi-shot-prompt.test.js`
Expected: PASS (all validator cases plus Task 1 cases).

- [ ] **Step 6: Commit**

```bash
git add src/video/prompt-quality.ts src/tests/multi-shot-prompt.test.ts
git commit -m "feat: runMultiShotChecks validator for multi-shot prompts"
```

---

## Task 3: Artifact schema + type union

**Files:**
- Create: `schemas/video/artifacts/multi-shot-prompt.schema.json`
- Modify: `src/video/types.ts:49` (`VideoStageArtifactName` union)

- [ ] **Step 1: Add the artifact name to the union**

In `src/video/types.ts`, change the `VideoStageArtifactName` union to include the new name:

```typescript
export type VideoStageArtifactName =
  | 'brief'
  | 'clone-plan'
  | 'storyboard'
  | 'asset-manifest'
  | 'execution-plan'
  | 'execution-report'
  | 'review-report'
  | 'publish-report'
  | 'analyze-output'
  | 'assemble-report'
  | 'multi-shot-prompt';
```

- [ ] **Step 2: Create the schema**

Create `schemas/video/artifacts/multi-shot-prompt.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "vclaw-video-core/video/artifacts/multi-shot-prompt",
  "type": "object",
  "required": ["preset", "location", "timeOfDay", "shots", "promptText", "charCount", "valid", "issues", "generatedAt"],
  "properties": {
    "preset": { "type": "string" },
    "location": { "type": "string" },
    "timeOfDay": { "type": "string" },
    "shots": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["timecode", "start", "end", "shotSize", "lens", "angle", "movement", "description"],
        "properties": {
          "timecode": { "type": "string" },
          "start": { "type": "number" },
          "end": { "type": "number" },
          "shotSize": { "type": "string" },
          "lens": { "type": "string" },
          "angle": { "type": "string" },
          "movement": { "type": "string" },
          "description": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "promptText": { "type": "string" },
    "charCount": { "type": "integer" },
    "valid": { "type": "boolean" },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "severity", "message"],
        "properties": {
          "code": { "type": "string" },
          "severity": { "type": "string", "enum": ["warn", "error"] },
          "message": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "generatedAt": { "type": "string" }
  },
  "additionalProperties": false
}
```

- [ ] **Step 3: Verify build still compiles**

Run: `npm run build`
Expected: PASS (no type errors from the union change).

- [ ] **Step 4: Commit**

```bash
git add src/video/types.ts schemas/video/artifacts/multi-shot-prompt.schema.json
git commit -m "feat: multi-shot-prompt artifact schema + type union entry"
```

---

## Task 4: CLI command `--plan` and `--validate`

**Files:**
- Modify: `src/cli/vclaw.ts` (add handler, dispatch block, usage line)
- Test: `src/tests/cli-multi-shot.test.ts`

- [ ] **Step 1: Write the failing CLI test**

Create `src/tests/cli-multi-shot.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[], input?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    input,
  });
}

describe('vclaw video multi-shot --plan', () => {
  it('emits a plan whose shots total 15s', () => {
    const res = run(['video', 'multi-shot', '--plan', '--shots', '5', '--seed', '7']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.preset.name, 'cinematic-15s');
    assert.equal(parsed.shots.length, 5);
    const total = parsed.shots.reduce((s: number, x: any) => s + (x.end - x.start), 0);
    assert.equal(total, 15);
  });
});

describe('vclaw video multi-shot --validate', () => {
  const VALID = [
    '[00:00 - 00:04] Wide, 24mm, low angle, tracking — a man walks through a Tokyo alley.',
    '',
    '[00:04 - 00:07] Medium, 50mm, eye-level, handheld — he moves between food stalls.',
    '',
    '[00:07 - 00:09] Close-up, 85mm, high angle, static — his hand brushes a lantern.',
    '',
    '[00:09 - 00:12] Wide, 35mm, Dutch angle, push-in — he emerges into a broad street.',
    '',
    '[00:12 - 00:15] Medium close-up, 50mm, low angle, pull-out — he looks up at a sign.',
    '',
    'Location: Narrow Tokyo alley, night.',
    'Style: Cool shadows. In the style of a Christopher Nolan movie.',
    'Audio: Diegetic sound only.',
  ].join('\n');

  it('exits 0 for a valid prompt from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-ms-'));
    try {
      const file = join(dir, 'prompt.txt');
      await writeFile(file, VALID, 'utf-8');
      const res = run(['video', 'multi-shot', '--validate', '--file', file]);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.equal(JSON.parse(res.stdout).valid, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits nonzero and reports issues for an invalid prompt via stdin', () => {
    const bad = VALID.replace('[00:12 - 00:15]', '[00:12 - 00:14]');
    const res = run(['video', 'multi-shot', '--validate'], bad);
    assert.notEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.issues.some((i: any) => i.code === 'multi-shot-timecode-total'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/cli-multi-shot.test.js`
Expected: FAIL — unknown subcommand `multi-shot` (nonzero exit / error JSON).

- [ ] **Step 3: Add imports at top of `src/cli/vclaw.ts`**

Near the other `../video/*` imports (e.g. after the `prompt-library` import on line 16), add:

```typescript
import {
  CINEMATIC_15S_PRESET,
  buildShotPlan,
  type MultiShotPreset,
} from '../video/multi-shot-prompt.js';
import { runMultiShotChecks } from '../video/prompt-quality.js';
import { readFile as readFileForMultiShot } from 'node:fs/promises';
```

> If `prompt-quality` is already imported in this file, merge `runMultiShotChecks` into that import instead of adding a second line. If `node:fs/promises` is already imported with a `readFile` binding, reuse it and skip the aliased import.

- [ ] **Step 4: Add the handler**

Add this handler near `handleVideoPromptLibShow`:

```typescript
function resolveMultiShotPreset(args: string[]): MultiShotPreset {
  const preset: MultiShotPreset = { ...CINEMATIC_15S_PRESET };
  const totalSeconds = parseFlagValue(args, '--total-seconds');
  const maxChars = parseFlagValue(args, '--max-chars');
  const styleLine = parseFlagValue(args, '--style-line');
  const audioLine = parseFlagValue(args, '--audio-line');
  if (totalSeconds) preset.totalSeconds = Number(totalSeconds);
  if (maxChars) preset.maxChars = Number(maxChars);
  if (styleLine) preset.styleLine = styleLine;
  if (audioLine) preset.audioLine = audioLine;
  return preset;
}

async function handleVideoMultiShot(args: string[]): Promise<void> {
  const preset = resolveMultiShotPreset(args);
  const isValidate = args.includes('--validate');
  const isPlan = args.includes('--plan');

  if (isValidate) {
    const file = parseFlagValue(args, '--file');
    let promptText: string;
    if (file) {
      promptText = await readFileForMultiShot(file, 'utf-8');
    } else {
      promptText = await new Promise<string>((resolve) => {
        let buf = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => (buf += chunk));
        process.stdin.on('end', () => resolve(buf));
      });
    }
    const issues = runMultiShotChecks(promptText, preset);
    const valid = issues.every((i) => i.severity !== 'error');
    process.stdout.write(`${JSON.stringify({ valid, charCount: promptText.length, issues }, null, 2)}\n`);
    if (!valid) process.exitCode = 1;
    return;
  }

  // Default: --plan (scaffold)
  void isPlan;
  const shotsFlag = parseFlagValue(args, '--shots');
  const seedFlag = parseFlagValue(args, '--seed');
  const plan = buildShotPlan(preset, {
    shots: shotsFlag ? Number(shotsFlag) : undefined,
    seed: seedFlag ? Number(seedFlag) : undefined,
  });
  process.stdout.write(`${JSON.stringify({ preset, shots: plan.shots }, null, 2)}\n`);
}
```

- [ ] **Step 5: Add the dispatch block**

Next to the `prompt-lib-show` dispatch block (around line 3388):

```typescript
  if (command === 'video' && subcommand === 'multi-shot') {
    await handleVideoMultiShot(rest);
    return;
  }
```

- [ ] **Step 6: Add the usage line**

In the usage string (the large `process.stdout.write` near line 169), add after the `prompt-lib-show` line:

```
  vclaw video multi-shot (--plan [--shots N] [--seed N] | --validate [--file <path>]) [--preset <name>] [--total-seconds N] [--max-chars N] [--style-line <t>] [--audio-line <t>] [--project <slug>] [--raw]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/cli-multi-shot.test.js`
Expected: PASS (`--plan` and both `--validate` cases).

- [ ] **Step 8: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-multi-shot.test.ts
git commit -m "feat: vclaw video multi-shot command (--plan, --validate)"
```

---

## Task 5: CLI `--auto` (Gemini-authored prose) + `--project` persistence + `--raw`

**Files:**
- Modify: `src/cli/vclaw.ts` (`handleVideoMultiShot`)
- Test: `src/tests/cli-multi-shot.test.ts` (append)

> **`--auto` design:** reuse the Gemini key pool the same way `analyze --auto` does. To keep tests network-free, the handler reads the prompt body from a stub when `VCLAW_MULTISHOT_AUTO_STUB` is set (a path to a text file). This mirrors how other commands allow adapter overrides for testability. The real path calls Gemini; the stub path is for tests and offline use.

- [ ] **Step 1: Write the failing test (append to `cli-multi-shot.test.ts`)**

```typescript
describe('vclaw video multi-shot --auto (stubbed) + --project', () => {
  const STUB_PROMPT = [
    '[00:00 - 00:05] Wide, 24mm, low angle, static — a figure stands in a field.',
    '',
    '[00:05 - 00:10] Medium, 50mm, eye-level, push-in — wind moves the grass.',
    '',
    '[00:10 - 00:15] Close-up, 85mm, high angle, handheld — the figure turns to camera.',
    '',
    'Location: Open field, golden hour.',
    'Style: Grounded realism. In the style of a Christopher Nolan movie.',
    'Audio: Diegetic sound only.',
  ].join('\n');

  it('authors via stub, validates, persists artifact under --project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-ms-proj-'));
    try {
      const init = run(['video', 'init', 'ms-demo', '--root', root]);
      assert.equal(init.status, 0, init.stderr);

      const stubFile = join(root, 'stub.txt');
      await writeFile(stubFile, STUB_PROMPT, 'utf-8');

      const res = spawnSync(
        process.execPath,
        [cliPath, 'video', 'multi-shot', '--auto', '--image', '/tmp/ref.png',
         '--location', 'Open field', '--time', 'golden hour',
         '--project', 'ms-demo', '--root', root],
        { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, VCLAW_MULTISHOT_AUTO_STUB: stubFile } },
      );
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.valid, true);

      const artifact = JSON.parse(
        await readFile(join(root, 'projects', 'ms-demo', 'artifacts', 'multi-shot-prompt.json'), 'utf-8'),
      );
      assert.equal(artifact.preset, 'cinematic-15s');
      assert.equal(artifact.location, 'Open field');
      assert.ok(artifact.promptText.includes('00:00 - 00:05'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('--raw prints only the prompt body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vclaw-ms-raw-'));
    try {
      const stubFile = join(dir, 'stub.txt');
      await writeFile(stubFile, STUB_PROMPT, 'utf-8');
      const res = spawnSync(
        process.execPath,
        [cliPath, 'video', 'multi-shot', '--auto', '--image', '/tmp/ref.png', '--location', 'Open field', '--time', 'golden hour', '--raw'],
        { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, VCLAW_MULTISHOT_AUTO_STUB: stubFile } },
      );
      assert.equal(res.status, 0, res.stderr);
      assert.ok(res.stdout.trimStart().startsWith('[00:00'));
      assert.ok(!res.stdout.includes('"valid"'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/cli-multi-shot.test.js`
Expected: FAIL — `--auto` not handled (falls through to `--plan`, no artifact written, no `valid` field).

- [ ] **Step 3: Add imports for auto + artifact persistence**

In `src/cli/vclaw.ts`, alongside the Task 4 imports add:

```typescript
import { generateMultiShotPromptText } from '../video/multi-shot-prompt.js';
import { loadVideoProjectWorkspace } from '../video/workspace.js';
import { writeArtifact } from '../video/artifact-store.js';
```

> If `loadVideoProjectWorkspace` is already imported in this file (it is used by other handlers), reuse the existing import and drop that line. Verify the exact exported name with `grep -n "export.*Workspace" src/video/workspace.js` against `dist` or `grep -n "export" src/video/workspace.ts`; if the loader has a different name (e.g. `loadWorkspace`), use that name consistently here.

- [ ] **Step 4: Add the Gemini-author helper to the module**

Append to `src/video/multi-shot-prompt.ts`:

```typescript
// Authors a finished prompt body. When VCLAW_MULTISHOT_AUTO_STUB points to a file,
// its contents are returned verbatim (test/offline path). Otherwise calls Gemini.
export async function generateMultiShotPromptText(input: {
  preset: MultiShotPreset;
  imagePath: string;
  character?: string;
  action?: string;
  location: string;
  timeOfDay: string;
}): Promise<string> {
  const stub = process.env.VCLAW_MULTISHOT_AUTO_STUB;
  if (stub) {
    const { readFile } = await import('node:fs/promises');
    return (await readFile(stub, 'utf-8')).trim();
  }
  // Real path: delegate to the shared Gemini analyze plumbing. The prompt instructs
  // Gemini to follow the cinematic-15s framework and return ONLY the prompt body.
  const { generateMultiShotWithGemini } = await import('./gemini-analyze.js');
  return generateMultiShotWithGemini({
    preset: input.preset,
    imagePath: input.imagePath,
    character: input.character,
    action: input.action,
    location: input.location,
    timeOfDay: input.timeOfDay,
  });
}
```

> **Real Gemini path (non-test):** add a `generateMultiShotWithGemini` export to `src/video/gemini-analyze.ts` modeled on the existing `generateAnalyzeOutputWithGemini` — same `fetchGeminiWithPool` usage, a text prompt that embeds the framework rules + preset + brief and asks for the bare prompt body, `responseMimeType: 'text/plain'`. This is only exercised when `VCLAW_MULTISHOT_AUTO_STUB` is unset, so it is not covered by the network-free tests; keep it minimal and document the env requirement (`GEMINI_API_KEYS`). If you prefer to defer the live call, throw a clear `Error('multi-shot --auto requires VCLAW_MULTISHOT_AUTO_STUB or a configured Gemini key pool')` from `generateMultiShotWithGemini` for now — the stub path and all tests still pass.

- [ ] **Step 5: Extend `handleVideoMultiShot` with the `--auto` branch**

Insert this branch in `handleVideoMultiShot` **before** the default `--plan` block:

```typescript
  if (args.includes('--auto')) {
    const image = parseFlagValue(args, '--image');
    if (!image) throw new Error('video multi-shot --auto requires --image <path>');
    const location = parseFlagValue(args, '--location') ?? '';
    const timeOfDay = parseFlagValue(args, '--time') ?? 'natural daylight';
    const promptText = await generateMultiShotPromptText({
      preset,
      imagePath: image,
      character: parseFlagValue(args, '--character'),
      action: parseFlagValue(args, '--action'),
      location,
      timeOfDay,
    });
    const issues = runMultiShotChecks(promptText, preset);
    const valid = issues.every((i) => i.severity !== 'error');

    if (args.includes('--raw')) {
      process.stdout.write(`${promptText}\n`);
      if (!valid) process.exitCode = 1;
      return;
    }

    const projectSlug = parseFlagValue(args, '--project');
    const result = {
      preset: preset.name,
      location,
      timeOfDay,
      shots: [] as unknown[],
      promptText,
      charCount: promptText.length,
      valid,
      issues,
      generatedAt: new Date().toISOString(),
    };
    if (projectSlug) {
      const root = parseFlagValue(args, '--root') ?? process.cwd();
      const workspace = await loadVideoProjectWorkspace(projectSlug, root);
      await writeArtifact(workspace, 'multi-shot-prompt', result);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!valid) process.exitCode = 1;
    return;
  }
```

> Confirm the workspace loader's exact name/signature (Step 3 note). `writeArtifact(workspace, 'multi-shot-prompt', value)` matches the signature in `src/video/artifact-store.ts`; `'multi-shot-prompt'` is now a valid `VideoStageArtifactName` (Task 3).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/cli-multi-shot.test.js`
Expected: PASS (auto+project persistence and `--raw`), and the Task 4 cases still pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/vclaw.ts src/video/multi-shot-prompt.ts src/video/gemini-analyze.ts
git commit -m "feat: multi-shot --auto (Gemini/stub) + --project persistence + --raw"
```

---

## Task 6: Reference doc + prompt-library registry

**Files:**
- Create: `references/video/multi-shot-framework.md`
- Modify: `src/video/prompt-library.ts` (`REFERENCE_REGISTRY`)
- Test: `src/tests/cli-multi-shot.test.ts` (append a registry check) — or extend `prompt-library.test.ts`

- [ ] **Step 1: Write the failing test (append to `cli-multi-shot.test.ts`)**

```typescript
describe('vclaw video prompt-lib-show multi-shot-framework', () => {
  it('lists and shows the multi-shot-framework reference', () => {
    const list = run(['video', 'prompt-lib-list']);
    assert.equal(list.status, 0, list.stderr);
    const names = JSON.parse(list.stdout).references.map((r: any) => r.name);
    assert.ok(names.includes('multi-shot-framework'));

    const show = run(['video', 'prompt-lib-show', '--name', 'multi-shot-framework']);
    assert.equal(show.status, 0, show.stderr);
    assert.ok(JSON.parse(show.stdout).reference.length > 100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/cli-multi-shot.test.js`
Expected: FAIL — `multi-shot-framework` not in registry / reference file missing.

- [ ] **Step 3: Create the reference doc**

Create `references/video/multi-shot-framework.md` — adapt the source framework, reframing the hard values as the `cinematic-15s` preset. Include: the 5-step workflow (analyze image, gather brief, design sequence, write prompt, count & deliver), the per-shot parameter list (shot size / lens / angle / movement), the trim priority, the worked example, and the variation guidance. Add a header note:

```markdown
# Multi-Shot Cinematic Prompt Framework (cinematic-15s preset)

> The values below (15s total, 2–5s shots, ≤1500 chars, the Style and Audio
> lines) are the **`cinematic-15s` preset** — the default. They are
> parametrizable per provider/project via `vclaw video multi-shot`
> (`--total-seconds`, `--max-chars`, `--style-line`, `--audio-line`). The hard
> rules are enforced by `runMultiShotChecks`; author prose with the
> `multi-shot-prompt` skill or `vclaw video multi-shot --auto`.

<!-- remainder: adapted workflow, shot-design constraints, trim priority,
     example, and variation guidance from the source framework -->
```

(Fill the remainder with the adapted source content — do not leave the comment as the only body.)

- [ ] **Step 4: Register the reference**

In `src/video/prompt-library.ts`, add to the `REFERENCE_REGISTRY` array (after the last `framework` entry):

```typescript
  {
    name: 'multi-shot-framework',
    category: 'framework',
    summary: 'Compressed timecoded multi-shot cinematic prompt builder (cinematic-15s preset).',
    file: 'multi-shot-framework.md',
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/cli-multi-shot.test.js`
Expected: PASS (registry list + show).

- [ ] **Step 6: Commit**

```bash
git add references/video/multi-shot-framework.md src/video/prompt-library.ts
git commit -m "feat: multi-shot-framework reference doc + prompt-library registry entry"
```

---

## Task 7: Repo skill

**Files:**
- Create: `skills/multi-shot-prompt/SKILL.md`

- [ ] **Step 1: Create the skill**

Create `skills/multi-shot-prompt/SKILL.md`, adapting the source framework's frontmatter and triggers, with the workflow re-anchored to the CLI:

```markdown
---
name: multi-shot-prompt
description: Generate multi-shot cinematic video prompts structured as timed shot sequences from a reference image, validated against the videoclaw cinematic-15s preset. Use for "multi-shot prompt", "shot sequence", "cinematic prompt", "video prompt from this image", or when targeting Seedance/Veo/Runway/Kling/Sora with a structured timecoded prompt.
triggers:
  - "multi-shot prompt"
  - "shot sequence"
  - "cinematic prompt"
  - "video prompt from this image"
  - "shot breakdown"
  - "describe this scene as shots"
---

# Multi-Shot Cinematic Prompt Builder

Turns a reference image + scene brief into a copy-paste timecoded multi-shot
prompt, validated by videoclaw's `runMultiShotChecks`.

## Workflow

1. Get a scaffold + suggested non-repeating camera grid:
   `vclaw video multi-shot --plan --shots <3-7>`
2. Analyze the reference image and gather the brief (character, action,
   location, time of day). Action and location are required.
3. Write cinematic prose into each shot slot, weaving in subject detail; end
   with the Location/Style/Audio metadata block.
4. Validate: pipe or save the prompt and run
   `vclaw video multi-shot --validate --file <path>` (exit 0 = clean).
5. Deliver inside a single fenced code block; add a 2–3 sentence note on the
   shot structure chosen and one tweak to try.

For the full framework rules, trim priority, and example, see
`vclaw video prompt-lib-show --name multi-shot-framework`.

## Fully automated path

`vclaw video multi-shot --auto --image <path> --action "<x>" --location "<x>" --time "<x>" [--project <slug>] [--raw]`
authors and validates in one step (requires a Gemini key pool, or
`VCLAW_MULTISHOT_AUTO_STUB` for offline/testing).
```

- [ ] **Step 2: Verify skill front door passes**

Run: `npm run check:skill-frontdoor`
Expected: PASS — the skill references the real `vclaw video multi-shot` command, so it does not need the ignore list.

- [ ] **Step 3: Commit**

```bash
git add skills/multi-shot-prompt/SKILL.md
git commit -m "feat: multi-shot-prompt repo skill"
```

---

## Task 8: Docs + optional smoke script + full guardrails

**Files:**
- Modify: `README.md`, `docs/CLI_REFERENCE.md`
- Modify: `package.json` (optional `smoke:multi-shot`)

- [ ] **Step 1: Document the command**

In `docs/CLI_REFERENCE.md`, add a `vclaw video multi-shot` section documenting the three modes (`--plan`, `--validate`, `--auto`), all flags, and a worked example (reuse the Tokyo-alley example). Add a one-line mention + link in `README.md`'s command list.

- [ ] **Step 2: (Optional) add a smoke script**

In `package.json` `scripts`, add:

```json
"smoke:multi-shot": "npm run build && node dist/cli/vclaw.js video multi-shot --plan --shots 5 --seed 1 > /tmp/ms-plan.json && node dist/cli/vclaw.js video multi-shot --validate --file references/video/.fixtures/multi-shot-valid.txt"
```

If you add this, also create `references/video/.fixtures/multi-shot-valid.txt` with the valid Tokyo-alley prompt from the tests so the round-trip has a fixture. Otherwise skip this step.

- [ ] **Step 3: Run the doc guardrail + full test suite**

Run: `npm run check:cleanroom-docs && npm test`
Expected: PASS — docs guardrail green, all tests (including `multi-shot-prompt.test.js` and `cli-multi-shot.test.js`) pass.

- [ ] **Step 4: Run the lite release pre-flight**

Run: `npm run check:release-readiness-lite`
Expected: PASS (build + tests + main smokes + guardrails).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/CLI_REFERENCE.md package.json references/video/.fixtures/multi-shot-valid.txt
git commit -m "docs: document vclaw video multi-shot + optional smoke"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Reference doc (Task 6), skill (Task 7), code module (Tasks 1–2), schema/artifact (Task 3), CLI `--plan`/`--validate`/`--auto` (Tasks 4–5), parametrized preset (Task 4 `resolveMultiShotPreset`), `--project` persistence (Task 5), tests (Tasks 1–6), docs/guardrails (Task 8). Phase 2 (scene-aware, provider presets) is intentionally out of scope.
- **Type consistency:** `MultiShotPreset`, `buildShotPlan`, `ShotSlot`, `runMultiShotChecks`, `generateMultiShotPromptText`, `assembleMetadataBlock`, `formatTimecode` are referenced with identical names across tasks. Issue codes added in Task 2 match the strings asserted in tests.
- **Verify-before-trust:** Two names need a one-line confirm against the actual source before use — the workspace loader export in `workspace.ts` (Step 3/5 of Task 5) and whether `node:fs/promises`/`prompt-quality` are already imported in `vclaw.ts` (Task 4 Step 3). Notes inline tell the implementer how to check.
```