# Scene Candidates and Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add per-scene candidate registry + selection state + partial rerun + chain-from-prev so operators can generate N takes per scene, pick winners, rerun single scenes, and control seed chaining.

**Architecture:** Two new artifacts live beside the existing execution report. `scene-candidates.json` is an append-only log of every generation; `scene-selection.json` is mutable operator state. The existing execute runtime is extended to write candidates (not overwrite assets), honor `--scene <n>` partial-rerun scope, and resolve chain-from-prev seeds from the prior scene's selected candidate. Review/publish gates now require a selected candidate per storyboard scene.

**Tech Stack:** TypeScript strict NodeNext ESM, Node 20, `node:test` + `assert/strict`, JSON Schema artifacts.

**Spec:** [`docs/superpowers/specs/2026-04-22-scene-candidates-design.md`](../specs/2026-04-22-scene-candidates-design.md) — S1–S5 defaults assumed (two artifacts · `--scene` flag · scene-level chain · migration in v1 · blocking selection gate).

**Sequences behind:** [Reference sheets plan](./2026-04-22-reference-sheets.md) (shipped)

---

## File structure

### New
| File | Responsibility |
|---|---|
| `schemas/video/artifacts/scene-candidates.schema.json` | Candidates contract |
| `schemas/video/artifacts/scene-selection.schema.json` | Selection contract |
| `src/video/scene-candidates.ts` | Pure functions: candidate id generation, append, lookup, summary |
| `src/video/scene-candidate-store.ts` | Disk read/write for candidates artifact |
| `src/video/scene-selection.ts` | Pure functions: select / reject / reroll / chain mutations, validation |
| `src/video/scene-selection-store.ts` | Disk read/write for selection artifact |
| `src/video/candidate-migrate.ts` | Seed candidates+selection from an existing `asset-manifest.json` |
| `src/tests/scene-candidates.test.ts` | Module contract tests |
| `src/tests/scene-selection.test.ts` | Module contract tests |
| `src/tests/cli-scene-candidates.test.ts` | CLI E2E for candidate-list/show + produce --scene |
| `src/tests/cli-scene-selection.test.ts` | CLI E2E for select/reject/reroll/chain commands |
| `src/tests/cli-candidates-migrate.test.ts` | CLI E2E for migration helper |
| `scripts/smoke-scene-candidates.mjs` | End-to-end smoke |
| `docs/SCENE_CANDIDATES.md` | Operator guide |

### Modified
- `src/cli/vclaw.ts` — 9 new subcommands + `--scene` flag on `produce`/`execute`
- `src/video/types.ts` — new types
- `src/video/execute.ts` + `execution-runtime.ts` + `execution-status.ts` — candidate writes, partial-rerun scope, chain-from-prev
- `src/video/readiness.ts` — scene-selection-missing blocker
- `src/video/stage-guards.ts` — review/publish gate
- `src/video/storyboard-markdown.ts` — Candidates & selection section
- `src/video/doctor.ts` + `doctor-portfolio.ts`
- `src/video/status.ts` + `project-index.ts` + `report.ts` + `csv-export.ts` + `obsidian-export.ts`
- `src/video/events.ts` — new event types
- `src/index.ts` — public re-exports
- `README.md`, `docs/CLI_REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/MASTER_PLAN_ALIGNMENT.md`
- `scripts/check-release-readiness-lite.sh`, `package.json` — smoke wiring

**Note to implementers:** The reference-sheets plan landed with several API deviations (real `ensureProjectWorkspace` signature, real CLI arg helpers `parseFlagValue`/`parseRepeatableFlag`, real blocker/issue shapes). Follow those same shapes — do not invent new helpers. When the plan text below says "plan code" but the reference-sheets-landed code has a concrete precedent, match the precedent.

---

## Phase 0 — Foundation

### Task 1: JSON Schemas + types

**Files:**
- Create: `schemas/video/artifacts/scene-candidates.schema.json`
- Create: `schemas/video/artifacts/scene-selection.schema.json`
- Modify: `src/video/types.ts`
- Test: `src/tests/scene-candidates.test.ts` (minimal type-compat asserts)

- [ ] Write minimal failing tests that import the new types and construct empty artifacts — confirms types compile.
- [ ] Add to `src/video/types.ts`:
  ```typescript
  export type SceneCandidateStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

  export interface SceneCandidateOutput {
    kind: 'video' | 'audio' | 'image';
    path: string;
    durationSec?: number;
  }

  export interface SceneCandidateSource {
    executionRound: number;
    adapter: 'builtin' | 'shim' | 'custom' | 'native';
    externalJobId?: string;
    chainedFromCandidateId: string | null;
  }

  export interface SceneCandidate {
    id: string;
    generationRound: number;
    prompt: string;
    route: string;
    submittedAt: string;
    completedAt?: string;
    status: SceneCandidateStatus;
    outputs: SceneCandidateOutput[];
    source: SceneCandidateSource;
  }

  export interface SceneCandidatesEntry {
    sceneIndex: number;
    candidates: SceneCandidate[];
  }

  export interface SceneCandidatesArtifact {
    schemaVersion: 1;
    scenes: SceneCandidatesEntry[];
  }

  export interface SceneSelectionEntry {
    sceneIndex: number;
    selectedCandidateId: string | null;
    rejectedCandidateIds: string[];
    pendingCandidateIds: string[];
    rerollRequested: boolean;
    chainFromPrev: boolean;
    notes?: string;
  }

  export interface SceneSelectionArtifact {
    schemaVersion: 1;
    scenes: SceneSelectionEntry[];
  }
  ```
- [ ] Write both JSON Schemas (mirror the TypeScript shapes — `const schemaVersion: 1`, `scenes[]` array, per-scene shapes). Use the reference-sheets schema as a structural template.
- [ ] Commit: `Add scene-candidates and scene-selection schemas and types`

---

## Phase 1 — Core modules

### Task 2: scene-candidates.ts pure functions

**Files:**
- Create: `src/video/scene-candidates.ts`
- Test: `src/tests/scene-candidates.test.ts` (extend)

- [ ] Write failing tests for:
  - `nextCandidateId(artifact, sceneIndex)` → produces `scene-<i>-take-<n>` using next free integer
  - `appendCandidate(artifact, sceneIndex, candidate)` → immutable append, creates scene entry if new
  - `findCandidate(artifact, candidateId)` → returns candidate + sceneIndex or null
  - `summarizeCandidates(artifact)` → `{ totalCandidates, sceneCount, completedCount, pendingCount, failedCount }`
  - `candidatesForScene(artifact, sceneIndex)` → filtered array
  - `maxRoundForScene(artifact, sceneIndex)` → highest `generationRound` seen or 0
- [ ] Implement each. All functions must be pure (no disk I/O).
- [ ] Key invariant: candidate IDs are unique across the entire artifact, not just within one scene entry.
- [ ] Commit: `Add scene-candidates pure functions`

### Task 3: scene-selection.ts pure functions

**Files:**
- Create: `src/video/scene-selection.ts`
- Test: `src/tests/scene-selection.test.ts`

- [ ] Write failing tests for:
  - `ensureSelectionEntry(artifact, sceneIndex)` → returns updated artifact with empty entry if missing, untouched if present
  - `selectCandidate(artifact, sceneIndex, candidateId)` → moves id to `selectedCandidateId`, pulls from `rejectedCandidateIds`/`pendingCandidateIds`, clears `rerollRequested`
  - `rejectCandidate(artifact, sceneIndex, candidateId)` → adds to `rejectedCandidateIds`, removes from selected/pending (clears `selectedCandidateId` if it was this id)
  - `markPending(artifact, sceneIndex, candidateIds)` → adds ids to `pendingCandidateIds`, skips already-selected/rejected
  - `requestReroll(artifact, sceneIndex, chainFromPrev?)` → sets `rerollRequested: true`, clears `selectedCandidateId`, sets chain if provided
  - `setChainFromPrev(artifact, sceneIndex, value)` → explicit toggle
  - `clearReroll(artifact, sceneIndex)` → sets `rerollRequested: false`
  - `validateSelection(artifact, candidatesArtifact)` → verifies all referenced ids exist and disjointness holds; returns `{ ok, errors[] }`
- [ ] Implement each. Pure functions. Key invariant: `selectedCandidateId`, `rejectedCandidateIds[]`, `pendingCandidateIds[]` must be pairwise disjoint.
- [ ] Commit: `Add scene-selection pure functions`

---

## Phase 2 — Disk stores

### Task 4: scene-candidate-store.ts

**Files:**
- Create: `src/video/scene-candidate-store.ts`
- Test: `src/tests/scene-candidate-store.test.ts`

- [ ] Mirror the reference-sheet-store pattern: `readSceneCandidatesArtifact(root, slug)`, `writeSceneCandidatesArtifact(root, slug, artifact)`, `sceneCandidatesPathFor(root, slug)`. Path: `projects/<slug>/artifacts/scene-candidates.json`.
- [ ] Read returns `{ schemaVersion: 1, scenes: [] }` when file missing.
- [ ] Test: round-trip preserves shape.
- [ ] Commit: `Add scene-candidates disk store`

### Task 5: scene-selection-store.ts

- [ ] Same shape as Task 4 for selection. Path: `projects/<slug>/artifacts/scene-selection.json`.
- [ ] Commit: `Add scene-selection disk store`

---

## Phase 3 — CLI commands (read-only first)

### Task 6: `candidates-list` + `candidates-show`

**Files:**
- Modify: `src/cli/vclaw.ts`
- Test: `src/tests/cli-scene-candidates.test.ts`

- [ ] `candidates-list --project <slug> [--scene <sceneIndex>]` → lists all candidates or just those for a scene. JSON stdout.
- [ ] `candidates-show --project <slug> --candidate-id <id>` → full candidate record. Errors with non-zero exit on unknown id.
- [ ] Use existing `parseFlagValue` / `parseRepeatableFlag` helpers (NOT `parseArgs`).
- [ ] Match the reference-sheet-list/show handler style exactly.
- [ ] Commit: `Add candidates-list and candidates-show CLI commands`

### Task 7: `select-candidate` + `reject-candidate`

- [ ] `select-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>]`
- [ ] `reject-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>]`
- [ ] Both validate that the candidate id exists in `scene-candidates.json` for that scene; error if not.
- [ ] Emit `scene-candidate.selected` / `scene-candidate.rejected` events via `appendProjectEvent`.
- [ ] Commit: `Add select-candidate and reject-candidate CLI commands`

### Task 8: `reroll-scene` + `chain-from` + `unchain`

- [ ] `reroll-scene --project <slug> --scene <sceneIndex> [--chain-from-prev on|off]` → sets `rerollRequested: true`, optionally sets chain.
- [ ] `chain-from --project <slug> --scene <sceneIndex> --from <sourceSceneIndex>` → records chain intent; enforces `from < sceneIndex` (cannot chain from a later scene).
- [ ] `unchain --project <slug> --scene <sceneIndex>` → sets `chainFromPrev: false`.
- [ ] Note: v1 supports chain-from-prev as the only form (source must be `sceneIndex - 1`). `chain-from --from <n>` with `n < sceneIndex - 1` is a non-goal warning for v1. Document this in the CLI help.
- [ ] Emit `scene-reroll.requested` / `scene-chain.configured` events.
- [ ] Commit: `Add reroll-scene, chain-from, and unchain CLI commands`

---

## Phase 4 — Execution runtime integration (highest risk)

### Task 9: Add `--scene` flag to `produce`/`execute` for partial rerun

**Files:**
- Modify: `src/cli/vclaw.ts` (existing `handleVideoProduce` / `handleVideoExecute`)
- Modify: `src/video/execute.ts` (add `sceneIndices?: number[]` option)
- Test: existing CLI produce/execute tests — extend

- [ ] Add `--scene <n>` repeatable flag to `produce` and `execute` handlers. Parse via `parseRepeatableFlag(args, '--scene').map(Number)`.
- [ ] Pass through to `executeProject` as a new optional `sceneIndices?: number[]` in its input. When present, the executor only submits those scenes.
- [ ] Behavior when present and candidate artifact does not yet exist: treat as "new project, submit only these scenes, create the candidate artifact." When absent, submit all storyboard scenes.
- [ ] Test: a project with 3 scenes — submit scene 0 only, verify only scene 0 gains a candidate; submit scenes 1+2, verify scenes 1 and 2 each get a candidate and scene 0 is unchanged.
- [ ] Commit: `Add --scene partial-rerun flag to produce and execute`

### Task 10: Execute writes candidates, not direct asset-manifest entries

**Files:**
- Modify: `src/video/execute.ts`, `src/video/execution-runtime.ts`, `src/video/execution-status.ts`

- [ ] On each successful scene submission, append a `SceneCandidate` (status=`pending`) to the candidates artifact. Use `nextCandidateId` for the id.
- [ ] `execute-status` polling: when a candidate completes, update its `status` to `completed`, populate `completedAt` and `outputs[]`. Append candidate id to `scene-selection.json` entry's `pendingCandidateIds[]`.
- [ ] **Backwards compat:** existing projects that have no candidate artifact continue to write directly to `asset-manifest.json` as today. Detection: if `scene-candidates.json` does not exist at submission time AND `--scene` was not passed, use the legacy path. Otherwise use the candidate path. Document this detection clearly in the code.
- [ ] Asset manifest derivation: add a new helper `deriveAssetManifestFromSelection(candidates, selection)` that rebuilds `asset-manifest.json` entries from the currently-selected candidates. Call after any selection change or after ingest of a new candidate.
- [ ] Test: submit a scene, verify candidate appears with `status: pending`; trigger `execute-status` with a mocked adapter reporting completion, verify candidate moves to `completed` and `pendingCandidateIds` updates; verify `asset-manifest.json` remains empty until a `select-candidate` call.
- [ ] Commit: `Execute runtime writes candidates instead of overwriting assets`

### Task 11: chain-from-prev resolution in payload build

**Files:**
- Modify: `src/video/execution-runtime.ts` (payload builder)

- [ ] In the payload builder, for each scene being submitted, check `scene-selection.json` for `chainFromPrev: true`. If true:
  - Read the `selectedCandidateId` of scene `sceneIndex - 1`.
  - Hard-fail with `chain-from-prev-source-missing` if scene N-1 has no selection.
  - Look up that candidate's first `output` (kind: video). Pass its path as the seed image/frame in the payload (field name provider-specific — see existing adapter payload code).
  - Set the new candidate's `source.chainedFromCandidateId` to the source candidate id.
- [ ] When chain is false, behavior is unchanged from today.
- [ ] Test: scene 0 gets submitted and selected; scene 1 has `chainFromPrev: true`; submit scene 1, verify payload includes scene 0's output path as seed and the new candidate's `chainedFromCandidateId` matches scene 0's selected candidate.
- [ ] Test the error path: scene 1 has `chainFromPrev: true` but scene 0 has no selection → submit scene 1 hard-fails.
- [ ] Commit: `Resolve chain-from-prev seeds from selected candidates`

---

## Phase 5 — Readiness + stage guards

### Task 12: Selection blocker for review stage

**Files:**
- Modify: `src/video/readiness.ts`, `src/video/stage-guards.ts`
- Test: existing readiness test file — extend

- [ ] Readiness for `review` stage fails when any storyboard scene with ≥1 candidate has no `selectedCandidateId`. Blocker code: `scene-selection-missing`.
- [ ] Stage guard for `review` and `publish` same check. Hard fail.
- [ ] Feature gated: if `scene-candidates.json` does not exist (legacy project), skip this check entirely.
- [ ] Commit: `Require scene selection before review and publish`

---

## Phase 6 — Ops surfaces

### Task 13: `sceneSelection` summary in status / index / report / CSV / Obsidian

**Files:**
- Modify: `src/video/status.ts`, `src/video/project-index.ts`, `src/video/report.ts`, `src/video/csv-export.ts`, `src/video/obsidian-export.ts`

- [ ] Per-project `sceneSelection` field:
  ```typescript
  interface SceneSelectionSummary {
    sceneCount: number;
    withSelection: number;
    withPending: number;
    withReroll: number;
    totalCandidates: number;
    rejectedCount: number;
  }
  ```
- [ ] CSV columns: `scene_selection_with_selection`, `scene_candidates_total`.
- [ ] Obsidian frontmatter: `sceneSelectionCoverage` (string like `3/5`), `sceneCandidatesTotal`.
- [ ] Extend the existing surface tests to assert these fields.
- [ ] Commit: `Surface scene-selection summary through ops surfaces`

### Task 14: Storyboard markdown Candidates & selection section

**Files:**
- Modify: `src/video/storyboard-markdown.ts`

- [ ] For each storyboard scene with ≥1 candidate, append a section:
  ```
  ### Scene N — candidates

  | Take | Round | Status | Selected? |
  |---|---|---|---|
  | scene-N-take-1 | 1 | completed | — |
  | scene-N-take-2 | 2 | completed | ✅ |

  Chain from prev: no
  Reroll requested: no
  ```
- [ ] Test: create a project with 2 candidates, 1 selected → assert markdown contains both takes and the check mark.
- [ ] Commit: `Add Candidates & selection section to storyboard.md review`

### Task 15: Obsidian per-scene notes

**Files:**
- Modify: `src/video/obsidian-export.ts`

- [ ] For each project with candidates, write `Projects/<slug>/Scenes/<i>.md` containing: scene prompt, linked characters, linked reference sheets, candidate table (id/round/status/path), selection state, reroll indicator, chain-from-prev indicator.
- [ ] Sync as part of `sync-obsidian`.
- [ ] Commit: `Add per-scene Obsidian notes for candidate state`

---

## Phase 7 — Doctor

### Task 16: Doctor findings for scene state

**Files:**
- Modify: `src/video/doctor.ts`, `src/video/doctor-portfolio.ts`

- [ ] Per-project findings (encode code as message prefix, same pattern as reference-sheets):
  - `scene-selection-missing` — project has candidates but ≥1 scene lacks a selection
  - `scene-selection-stale` — selected candidate's output file no longer exists on disk
  - `scene-reroll-pending` — `rerollRequested: true` but no new candidate has been added since request
  - `scene-chain-upstream-stale` — a scene has `chainedFromCandidateId` whose source candidate was later rejected or whose source scene was rerolled
- [ ] Portfolio rollup: `sceneCandidates: { projectsWithCandidates, projectsWithMissingSelection, projectsWithStaleSelection, projectsWithPendingReroll, projectsWithStaleChainUpstream }`.
- [ ] Commit: `Add scene-selection diagnostics to doctor and doctor-portfolio`

---

## Phase 8 — Migration helper

### Task 17: `candidates-migrate-from-assets` command

**Files:**
- Create: `src/video/candidate-migrate.ts`
- Modify: `src/cli/vclaw.ts`
- Test: `src/tests/cli-candidates-migrate.test.ts`

- [ ] `vclaw video candidates-migrate-from-assets --project <slug> [--dry-run]`
- [ ] Reads `asset-manifest.json`, for each per-scene entry creates a single synthetic candidate marked `status: completed` with `generationRound: 1`, writes `scene-candidates.json`.
- [ ] Writes `scene-selection.json` with that candidate marked `selectedCandidateId` per scene.
- [ ] Emits a `scene-candidate.migrated` event per scene.
- [ ] `--dry-run` prints what would be written without touching disk.
- [ ] Error: if `scene-candidates.json` already exists, refuse unless `--force` is passed (out of scope for v1 — just error and direct the operator to manual editing).
- [ ] Test: create a project with an asset manifest, run migration, verify candidate and selection artifacts appear with the expected shape.
- [ ] Commit: `Add candidates-migrate-from-assets helper`

---

## Phase 9 — Public API, smoke, docs, verify

### Task 18: Re-exports

**Files:**
- Modify: `src/index.ts`

- [ ] Re-export public functions from `scene-candidates.ts`, `scene-selection.ts`, `scene-candidate-store.ts`, `scene-selection-store.ts`, `candidate-migrate.ts`.
- [ ] Re-export types from `types.ts`.
- [ ] Verify build stays clean.
- [ ] Commit: `Re-export scene-candidates and scene-selection public surface`

### Task 19: Smoke script

**Files:**
- Create: `scripts/smoke-scene-candidates.mjs`
- Modify: `package.json` (add `smoke:scene-candidates`)
- Modify: `scripts/check-release-readiness-lite.sh` (add smoke to bundle)

- [ ] Smoke exercises: init → brief → storyboard (3 scenes) → produce (all scenes) → assert 3 candidates (one per scene) in pending state → mock-complete them via direct store writes → select-candidate for scene 0 → reject-candidate for scene 1 → reroll-scene 1 with chain-from-prev on → verify storyboard.md contains candidate table → verify `doctor-project` reports `scene-selection-missing` for scene 2.
- [ ] Do NOT include unrelated pre-existing package.json changes. Surgical add.
- [ ] Commit: `Wire scene-candidates smoke into release-readiness-lite`

### Task 20: Documentation

**Files:**
- Create: `docs/SCENE_CANDIDATES.md` (full operator guide: why, commands, common workflows, chain semantics, troubleshooting)
- Modify: `docs/CLI_REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/MASTER_PLAN_ALIGNMENT.md`, `README.md`

- [ ] Full operator guide: setup → generate first candidates → select a winner → reroll a weak scene → configure chain-from-prev → migrate an existing project.
- [ ] CLI reference: add the 9 new commands + the `--scene` flag extension.
- [ ] Architecture: new flow bullet mentioning candidates + selection artifacts.
- [ ] Master plan alignment: new top-level item `55. Scene candidates and selection subsystem:` summarizing what shipped.
- [ ] README: one bullet in "What's shipped", add `docs/SCENE_CANDIDATES.md` to the docs map.
- [ ] Commit: `Document scene-candidates feature`

### Task 21: Final verification

- [ ] `npm test` green
- [ ] `npm run check:release-readiness-lite` green (includes new smoke)
- [ ] `npm run check:cleanroom-docs` green
- [ ] If any check fails and the cause is this feature, fix + commit. If unrelated, note and move on.
- [ ] Push all commits.

---

## Self-review notes

1. **Spec coverage** — all 5 S-decisions from the spec are reflected: S1 (two artifacts) → Tasks 1, 4, 5; S2 (`--scene` flag) → Task 9; S3 (scene-level chain) → Task 8, 11; S4 (migration v1) → Task 17; S5 (blocking selection) → Task 12.
2. **Backwards compatibility** — legacy-single-generation path preserved in Task 10 via "no candidates artifact = legacy behavior" detection, and Task 12 feature-gates the review blocker on the same signal.
3. **Execute runtime changes are the highest risk** (Tasks 10, 11). They have explicit fallback paths and are testable with mocked adapters. The smoke (Task 19) exercises the full round-trip including chain-from-prev.
4. **Type consistency** — `SceneCandidate`, `SceneSelectionEntry`, `SceneCandidatesArtifact`, `SceneSelectionArtifact`, `SceneCandidateOutput`, `SceneCandidateSource` used consistently across tasks.
5. **No placeholders** — every task names the files, specifies the behavior, names the event, and has a testable assertion.

## Handoff

After approval, execute via subagent-driven-development in 5 batches:

- **Batch A:** Tasks 1–5 (foundation + stores) — pure TS, low risk
- **Batch B:** Tasks 6–8 (CLI commands) — integration with stores, standard risk
- **Batch C:** Tasks 9–11 (execute runtime — PARTIAL RERUN + CHAIN) — highest risk, deserves careful review
- **Batch D:** Tasks 12–16 (readiness, ops surfaces, doctor)
- **Batch E:** Tasks 17–21 (migration, re-exports, smoke, docs, verify)

Same cadence as reference-sheets: commit per task, push per batch, CI validates on each push (once billing unblocks).
