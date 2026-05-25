# Prompt-quality preflight implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch six Seedance-handbook anti-patterns (adjective soup, multiple actions, multiple camera moves, style-word overload, literary emotion language, overlong prompts) at director-preflight time.

**Architecture:** One pure module `src/video/prompt-quality.ts` + one hook into `src/video/director-preflight.ts`. Warnings by default; `DIRECTOR_STRICT_PROMPT_QUALITY=1` promotes to blocking errors.

**Tech Stack:** TypeScript strict NodeNext ESM, Node 20, `node:test`.

**Spec:** [`2026-04-23-prompt-quality-preflight-design.md`](../specs/2026-04-23-prompt-quality-preflight-design.md)

---

## File structure

### New
| File | Responsibility |
|---|---|
| `src/video/prompt-quality.ts` | Six pure check functions + `runPromptQualityChecks` runner + hardcoded vocabulary constants |
| `src/tests/prompt-quality.test.ts` | One test per check function, one integration test for the runner |
| `docs/PROMPT_QUALITY.md` | Operator guide: what the checks do, how to tune thresholds, how to promote to blocking |

### Modified
- `src/video/director-preflight.ts` — extend runner to invoke prompt-quality on each scene
- `src/tests/director-preflight.test.ts` — integration tests
- `src/index.ts` — re-export public surface
- `docs/ARCHITECTURE.md` — new bullet under preflight
- `docs/MASTER_PLAN_ALIGNMENT.md` — item 56 (new implemented feature)
- `README.md` — mention in "What's shipped"

---

## Task 1: Module scaffolding + types

**Files:** Create `src/video/prompt-quality.ts`, `src/tests/prompt-quality.test.ts`

- [ ] Write a minimal failing test that imports `PromptQualityIssue` and `runPromptQualityChecks`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runPromptQualityChecks,
  type PromptQualityIssue,
} from '../video/prompt-quality.js';

test('runPromptQualityChecks returns empty array for a clean prompt', () => {
  const issues = runPromptQualityChecks(
    'A woman walks through a market at dusk. Handheld camera. Warm light.',
  );
  assert.deepEqual(issues, []);
});
```

- [ ] Run: `npm run build 2>&1 | tail -5` — expect module-not-found.

- [ ] Create `src/video/prompt-quality.ts`:

```typescript
export type PromptQualitySeverity = 'warn' | 'error';

export type PromptQualityIssueCode =
  | 'prompt-quality-adjective-soup'
  | 'prompt-quality-multiple-actions'
  | 'prompt-quality-multiple-camera-moves'
  | 'prompt-quality-style-word-overload'
  | 'prompt-quality-literary-emotion'
  | 'prompt-quality-overlong';

export interface PromptQualityIssue {
  code: PromptQualityIssueCode;
  severity: PromptQualitySeverity;
  message: string;
}

export const ADJECTIVE_SOUP_THRESHOLD = 4;
export const STYLE_WORDS_THRESHOLD = 3;
export const OVERLONG_WORDS_THRESHOLD = 120;

export const CAMERA_MOVE_VOCABULARY = [
  'dolly', 'track', 'crane', 'pan', 'tilt', 'zoom',
  'handheld', 'steadicam', 'establishing shot', 'close-up',
  'wide shot', 'medium shot',
] as const;

export const STYLE_VOCABULARY = [
  'cinematic', 'epic', 'atmospheric', 'ethereal', 'hyperrealistic',
  'photorealistic', 'surreal', 'dramatic', 'moody', 'vibrant',
  'nostalgic', 'gritty', 'dreamy', 'stylized',
] as const;

export const EMOTION_LANGUAGE_PATTERNS = [
  /\b(feels|seems|appears|looks|evokes|conveys)\s+\w+/gi,
  /\b(profound|deep|overwhelming|ethereal)\s+(sadness|joy|longing|feeling)\b/gi,
];

export function runPromptQualityChecks(prompt: string): PromptQualityIssue[] {
  const severity: PromptQualitySeverity =
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY === '1' ? 'error' : 'warn';
  return [];  // Individual checks added in later tasks
}
```

- [ ] Run: `npm run build && node --test dist/tests/prompt-quality.test.js` — expect PASS.

- [ ] Commit:
  ```
  git add src/video/prompt-quality.ts src/tests/prompt-quality.test.ts
  git commit -m "Scaffold prompt-quality module and types"
  ```

---

## Task 2: Adjective-soup check

- [ ] Write failing test:

```typescript
test('detects adjective soup', () => {
  const issues = runPromptQualityChecks(
    'A tall, mysterious, charismatic, weathered, sun-kissed, stoic man walks.',
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'prompt-quality-adjective-soup');
});

test('clean sentence with few adjectives passes', () => {
  const issues = runPromptQualityChecks('A tall man walks through the market.');
  assert.deepEqual(issues, []);
});
```

- [ ] Implement inside `runPromptQualityChecks`:

```typescript
const clauses = prompt.split(/[.;]/);
for (const clause of clauses) {
  const adjectives = countAdjectives(clause);
  if (adjectives > ADJECTIVE_SOUP_THRESHOLD) {
    issues.push({
      code: 'prompt-quality-adjective-soup',
      severity,
      message: `clause has ${adjectives} adjectives (threshold: ${ADJECTIVE_SOUP_THRESHOLD}): "${clause.trim()}"`,
    });
    break; // one flag per prompt is enough
  }
}
```

Helper `countAdjectives`: count comma-separated modifiers before a noun. Simple heuristic — split on commas, count items that are single words ending in common adjective suffixes (`-y`, `-ed`, `-ing`, `-ous`, `-ful`, `-less`) OR that are in a small hardcoded whitelist of common adjectives. Don't over-engineer — this is a warning, not an error.

- [ ] Run tests, commit: `Add adjective-soup prompt-quality check`.

---

## Task 3: Multiple-actions check

- [ ] Write failing test:

```typescript
test('flags multiple dominant actions in one clause', () => {
  const issues = runPromptQualityChecks(
    'A woman walks to the bar, orders a drink, sits down, and checks her phone.',
  );
  assert.ok(issues.some((i) => i.code === 'prompt-quality-multiple-actions'));
});
```

- [ ] Implement: count main-clause verbs. Use a simple heuristic — count commas inside the first clause preceded by an `-s` verb ending or a verb from a small common-verb list (`walks`, `runs`, `sits`, `stands`, `opens`, `closes`, `picks`, `places`, `turns`). Threshold: >1.

- [ ] Run, commit: `Add multiple-actions prompt-quality check`.

---

## Task 4: Multiple-camera-moves check

- [ ] Write failing test:

```typescript
test('flags multiple camera moves in one prompt', () => {
  const issues = runPromptQualityChecks(
    'The camera pans left then dollies in while tilting down.',
  );
  assert.ok(issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
});

test('single camera move passes', () => {
  const issues = runPromptQualityChecks('Handheld camera follows the subject.');
  assert.ok(!issues.some((i) => i.code === 'prompt-quality-multiple-camera-moves'));
});
```

- [ ] Implement: count case-insensitive whole-word matches against `CAMERA_MOVE_VOCABULARY`. Threshold: >1.

- [ ] Run, commit: `Add multiple-camera-moves prompt-quality check`.

---

## Task 5: Style-word-overload check

- [ ] Test:

```typescript
test('flags style-word overload', () => {
  const issues = runPromptQualityChecks(
    'A cinematic, epic, atmospheric, ethereal, moody scene at dusk.',
  );
  assert.ok(issues.some((i) => i.code === 'prompt-quality-style-word-overload'));
});
```

- [ ] Implement: count matches against `STYLE_VOCABULARY`. Threshold: >3.

- [ ] Run, commit: `Add style-word-overload prompt-quality check`.

---

## Task 6: Literary-emotion check

- [ ] Test:

```typescript
test('flags literary emotion language', () => {
  const issues = runPromptQualityChecks(
    'She feels overwhelmed by a profound sadness that seems to linger.',
  );
  assert.ok(issues.some((i) => i.code === 'prompt-quality-literary-emotion'));
});

test('visible behavior passes', () => {
  const issues = runPromptQualityChecks(
    'She wipes tears, puts the photo down, walks away.',
  );
  assert.ok(!issues.some((i) => i.code === 'prompt-quality-literary-emotion'));
});
```

- [ ] Implement: iterate `EMOTION_LANGUAGE_PATTERNS`; if any match, emit the issue.

- [ ] Run, commit: `Add literary-emotion prompt-quality check`.

---

## Task 7: Overlong-prompt check

- [ ] Test:

```typescript
test('flags overlong prompt', () => {
  const longPrompt = 'A man walks. '.repeat(60).trim(); // 120 words
  const issues = runPromptQualityChecks(longPrompt + ' Extra.');
  assert.ok(issues.some((i) => i.code === 'prompt-quality-overlong'));
});
```

- [ ] Implement: split on whitespace, count words, flag if >`OVERLONG_WORDS_THRESHOLD`.

- [ ] Run, commit: `Add overlong-prompt quality check`.

---

## Task 8: Director-preflight integration

**Files:** Modify `src/video/director-preflight.ts`, `src/tests/director-preflight.test.ts`

- [ ] Find the existing `runDirectorPreflight` function. Study how it pushes existing issues into `result.errors` / `result.warnings`.

- [ ] Add a new block after existing scene-iteration checks:

```typescript
// Prompt-quality checks (warnings by default; DIRECTOR_STRICT_PROMPT_QUALITY=1 promotes to errors)
for (const [i, scene] of storyboard.scenes.entries()) {
  const promptIssues = runPromptQualityChecks(scene.prompt ?? '');
  for (const issue of promptIssues) {
    const bucket = issue.severity === 'error' ? result.errors : result.warnings;
    bucket.push({
      severity: issue.severity,
      code: issue.code,
      scope: `scene-${i}`,
      message: issue.message,
    });
  }
}
```

(Match the actual existing issue-pushing shape in `director-preflight.ts` — the code above is illustrative. If the field names differ, adapt.)

- [ ] Integration test:

```typescript
test('director-preflight flags adjective-soup in storyboard prompts', async () => {
  // create project + storyboard where one scene has adjective soup
  // call director-preflight
  // assert result.warnings contains prompt-quality-adjective-soup
});
```

Follow the mkdtemp + spawnSync pattern used by existing preflight tests.

- [ ] Another integration test: with `DIRECTOR_STRICT_PROMPT_QUALITY=1`, the same input surfaces as a blocking error, not a warning.

- [ ] Run, commit: `Wire prompt-quality checks into director-preflight`.

---

## Task 9: Public re-export

- [ ] Append to `src/index.ts`:

```typescript
export {
  runPromptQualityChecks,
  ADJECTIVE_SOUP_THRESHOLD,
  STYLE_WORDS_THRESHOLD,
  OVERLONG_WORDS_THRESHOLD,
  CAMERA_MOVE_VOCABULARY,
  STYLE_VOCABULARY,
} from './video/prompt-quality.js';

export type {
  PromptQualityIssue,
  PromptQualityIssueCode,
  PromptQualitySeverity,
} from './video/prompt-quality.js';
```

- [ ] Run `npm run build` to verify.

- [ ] Commit: `Re-export prompt-quality public surface`.

---

## Task 10: Documentation

**Files:** Create `docs/PROMPT_QUALITY.md`. Modify `docs/ARCHITECTURE.md`, `docs/MASTER_PLAN_ALIGNMENT.md`, `README.md`.

- [ ] Create `docs/PROMPT_QUALITY.md` — operator guide covering:
  - What the feature is (Seedance-handbook rationale)
  - All 6 issue codes with descriptions + sample outputs
  - Thresholds + constant names (`ADJECTIVE_SOUP_THRESHOLD` etc.)
  - How to promote to blocking (`DIRECTOR_STRICT_PROMPT_QUALITY=1`)
  - Integration: where it runs (director-preflight), what surfaces show the issues (storyboard.md review)
  - Follow-on roadmap (config file, LLM-backed, auto-fix)

- [ ] `docs/ARCHITECTURE.md`: add a bullet under the existing preflight description mentioning the 6 prompt-quality checks.

- [ ] `docs/MASTER_PLAN_ALIGNMENT.md`: add item 56:
  ```
  56. Prompt-quality preflight:
      - six mechanical Seedance-handbook anti-pattern checks
      - warnings by default; DIRECTOR_STRICT_PROMPT_QUALITY=1 to block
      - directly catches adjective soup, multiple actions,
        multiple camera moves, style-word overload, literary emotion,
        and overlong prompts
  ```
  Move prompt-quality preflight out of the Tier 2 "next up" list.

- [ ] `README.md`: one bullet in "What's shipped" about prompt-quality preflight; add `docs/PROMPT_QUALITY.md` to the Documentation map.

- [ ] Commit: `Document prompt-quality preflight feature`.

---

## Task 11: Final verification

- [ ] `npm test` — green
- [ ] `npm run check:release-readiness-lite` — green (no smoke changes, existing preflight smoke picks up the new checks automatically)
- [ ] `npm run check:cleanroom-docs` — green
- [ ] Push

---

## Self-review

**Spec coverage:** all 6 checks shipped (Tasks 2-7), integration (Task 8), public surface (Task 9), docs (Task 10). All 5 P-decisions honored (warn-default, 6-checks-together, hardcoded thresholds, director-mode-only, standalone docs).

**Placeholder scan:** no TBDs. Every step has concrete code or concrete file updates.

**Type consistency:** `PromptQualityIssue`, `PromptQualityIssueCode`, `PromptQualitySeverity`, `runPromptQualityChecks` — names used consistently across tasks.

---

## Execution note

Small enough for **one subagent batch** — 11 tasks, ~200-300 LOC, all in one module except for the director-preflight hook. Dispatch one implementer covering all tasks 1-11, same pattern as reference-sheets Batch 1-5.
