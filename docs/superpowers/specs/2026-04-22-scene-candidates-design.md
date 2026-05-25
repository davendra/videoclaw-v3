# Scene candidates and selection — design

**Status:** Draft for review
**Date:** 2026-04-22
**Owner:** Davendra Patel
**Sibling of:** [`2026-04-22-reference-sheets-design.md`](./2026-04-22-reference-sheets-design.md)
**Inspired by:** [choreo-studio](https://github.com/mhplala/choreo-studio) — elements → shots → candidates object model, `chain_from_prev`, per-shot regeneration
**Scope estimate:** ~700–1000 LOC across ~22 files, 2 focused sessions

---

## Problem

The clean-room runtime today produces **one generation per scene**. That generation is ingested straight into `asset-manifest.json` and the stage advances. There is no notion of:

1. **Multiple candidates per scene** — "give me 3 takes of scene 4, I'll pick the winner."
2. **Per-scene selection state** — which of N candidates won, which were rejected, which are still pending.
3. **Rejected-candidate history** — ability to go back to a candidate you dismissed and re-promote it.
4. **Per-scene partial rerun** — "scene 6 is great, scene 7 is off. Regenerate only scene 7."
5. **Explicit chain-from-prev control** — "use scene 6's last frame as the seed for scene 7" as a first-class, operator-visible toggle, not implicit provider behavior.

The Choreo Studio repo the user referenced validates this object model: separating *inputs* (characters, styles, props, references) from *outputs* (shots, candidates, selection state) is the cleaner decomposition.

Reference sheets (sibling spec, shipping first) cover the *input* layer. This spec covers the *output* layer.

## Goal

Add a **scene candidates** artifact + **scene selection** artifact, plus CLI surface and ops-surface integration so the operator can:

- Generate N candidates per scene
- Mark candidates `selected` / `rejected` / `pending`
- Re-promote a previously rejected candidate
- Rerun a single scene without re-running others
- Toggle chain-from-prev per scene
- See candidate history across generation rounds in status / index / report / Obsidian

## Non-goals

Intentionally out of scope for v1 of this feature:

1. **Visual thumbnail rendering** of candidates in Obsidian. Links + metadata only; thumbnails can piggyback on `video-thumbnail-lab` later.
2. **Automatic scoring** of candidates (e.g. CLIP similarity against a reference). Pure operator selection in v1.
3. **Parallel candidate generation** — v1 submits candidates serially so provider rate limiting stays simple. Parallelism is a follow-on.
4. **Cross-project candidate reuse.** Candidates live per-project; no shared library.
5. **Non-video candidates** (audio / captions). Scope is video clips for now.
6. **Retroactive migration** of existing single-generation projects. New projects adopt candidates; existing projects keep working with the single-generation path.

## Approach

Two new canonical artifacts live beside the existing execution-report:

- `projects/<slug>/artifacts/scene-candidates.json` — N candidates per scene, append-only
- `projects/<slug>/artifacts/scene-selection.json` — per-scene selection + reroll + chain-from-prev toggles

The existing `execute` runtime is extended with two new responsibilities:

1. **Write candidates instead of overwriting assets.** Each provider response creates a new candidate entry; the asset manifest is derived from the selected candidate, not written directly.
2. **Respect partial-rerun + chain-from-prev flags.** `produce --scene <n>` submits only that scene; the provider payload uses the selected candidate from scene N-1 as seed when `chainFromPrev: true`.

Review state and readiness tighten accordingly: a scene without a `selected` candidate blocks `review` and `publish`.

## Data model

### Scene candidates artifact

`projects/<slug>/artifacts/scene-candidates.json`:

```json
{
  "schemaVersion": 1,
  "scenes": [
    {
      "sceneIndex": 0,
      "candidates": [
        {
          "id": "scene-0-take-1",
          "generationRound": 1,
          "prompt": "open on product…",
          "route": "veo-direct",
          "submittedAt": "2026-04-22T10:00:00.000Z",
          "completedAt": "2026-04-22T10:00:45.000Z",
          "status": "completed",
          "outputs": [
            { "kind": "video", "path": "artifacts/outputs/scene-0-take-1.mp4", "durationSec": 3.5 }
          ],
          "source": {
            "executionRound": 1,
            "adapter": "builtin",
            "externalJobId": "veo-xyz-123",
            "chainedFromCandidateId": null
          }
        }
      ]
    }
  ]
}
```

### Scene selection artifact

`projects/<slug>/artifacts/scene-selection.json`:

```json
{
  "schemaVersion": 1,
  "scenes": [
    {
      "sceneIndex": 0,
      "selectedCandidateId": "scene-0-take-2",
      "rejectedCandidateIds": ["scene-0-take-1"],
      "pendingCandidateIds": [],
      "rerollRequested": false,
      "chainFromPrev": false,
      "notes": "take-2 has better motion continuity"
    }
  ]
}
```

### Field definitions

**scene-candidates.json**

| Field | Required | Purpose |
|---|---|---|
| `schemaVersion` | yes | Starts at `1` |
| `scenes[].sceneIndex` | yes | Matches storyboard scene index |
| `scenes[].candidates[]` | yes | Append-only; may be empty |
| `candidates[].id` | yes | Stable id of the form `scene-<i>-take-<n>` |
| `candidates[].generationRound` | yes | 1-indexed; increments per scene on each rerun |
| `candidates[].prompt` | yes | Resolved prompt used at submission |
| `candidates[].route` | yes | Provider route used |
| `candidates[].submittedAt` / `completedAt` | yes/when-done | ISO timestamps |
| `candidates[].status` | yes | `pending` / `completed` / `failed` / `cancelled` |
| `candidates[].outputs[]` | when completed | Ingested outputs (mirrors asset-manifest entries) |
| `candidates[].source.executionRound` | yes | Matches the execution-report round |
| `candidates[].source.adapter` | yes | `builtin` / `shim` / `custom` / `native` |
| `candidates[].source.externalJobId` | optional | Adapter-assigned job id |
| `candidates[].source.chainedFromCandidateId` | yes | Null unless generated with chain-from-prev |

**scene-selection.json**

| Field | Required | Purpose |
|---|---|---|
| `scenes[].sceneIndex` | yes | Matches storyboard |
| `scenes[].selectedCandidateId` | nullable | Null = no winner chosen yet |
| `scenes[].rejectedCandidateIds[]` | yes (may be empty) | Explicitly dismissed candidates |
| `scenes[].pendingCandidateIds[]` | yes (may be empty) | Completed but not yet reviewed |
| `scenes[].rerollRequested` | yes | Operator wants another generation round |
| `scenes[].chainFromPrev` | yes | Use prior scene's selected candidate as seed |
| `scenes[].notes` | optional | Free-form operator notes |

### Validation rules

1. Every `candidates[].id` must be unique within a project.
2. `selectedCandidateId` / `rejectedCandidateIds[]` / `pendingCandidateIds[]` must be disjoint.
3. All three must reference candidate ids that actually exist in `scene-candidates.json` for that scene.
4. `generationRound` increments contiguously: round 1, round 2, round 3 — no gaps.
5. A scene with `rerollRequested: true` cannot have `selectedCandidateId` set (operator must un-reroll or un-select explicitly).

## CLI surface

Six new commands plus an existing-flag extension:

```bash
# Extended: existing produce gains --scene for partial rerun
vclaw video produce --project <slug> --scene <sceneIndex> [--scene <sceneIndex> ...] [--dry-run] [--root <path>]
vclaw video execute --project <slug> --scene <sceneIndex> [--scene <sceneIndex> ...] [--dry-run] [--root <path>]

# New: candidate inspection
vclaw video candidates-list --project <slug> [--scene <sceneIndex>] [--root <path>]
vclaw video candidates-show --project <slug> --candidate-id <id> [--root <path>]

# New: selection control
vclaw video select-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]
vclaw video reject-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]
vclaw video reroll-scene --project <slug> --scene <sceneIndex> [--chain-from-prev on|off] [--root <path>]

# New: chain control
vclaw video chain-from --project <slug> --scene <sceneIndex> --from <sourceSceneIndex> [--root <path>]
vclaw video unchain --project <slug> --scene <sceneIndex> [--root <path>]
```

Default output format is machine-readable JSON.

## Integration points

### Execution runtime (`src/video/execution-runtime.ts` + `execute.ts` + `execution-status.ts`)

1. **Write candidates on every completion.** Each submitted + polled scene becomes a new candidate entry in `scene-candidates.json` rather than overwriting existing state. The asset manifest is rebuilt from the current selection each time.
2. **Honor partial-rerun scope.** When `--scene <i>` is present on `produce`, only that scene (or list) is submitted. Other scenes keep their current candidates and selections.
3. **Honor chain-from-prev.** When a scene has `chainFromPrev: true` in selection, the payload builder reads scene N-1's `selectedCandidateId` and passes its last output as seed. If N-1 has no selection, hard-fail with `chain-from-prev-source-missing`.

### Readiness (`src/video/readiness.ts`)

Add a blocker for `review`:
- `scene-selection-missing` — any scene with ≥1 candidate but no `selectedCandidateId` blocks advancing past `assets`.

### Stage guards

Extend `review` and `publish` guards to require that every storyboard scene has a `selectedCandidateId`.

### Status, project-index, report, CSV, Obsidian export

Per-project: new `sceneSelection` summary field:

```json
{
  "sceneSelection": {
    "sceneCount": 5,
    "withSelection": 3,
    "withPending": 1,
    "withReroll": 0,
    "totalCandidates": 12,
    "rejectedCount": 2
  }
}
```

Obsidian gains a per-scene note at `Projects/<slug>/Scenes/<i>.md` with: scene prompt, linked characters, linked reference sheets, candidate list with status + path, selection state, reroll button (commented CLI invocation), chain-from-prev indicator.

### Storyboard markdown review

The `storyboard.md` director review gains a **Candidates & selection** section per scene (if candidates exist):

```
### Scene 0 — candidates

| Take | Round | Status | Selected? |
|---|---|---|---|
| scene-0-take-1 | 1 | completed | — |
| scene-0-take-2 | 2 | completed | ✅ |
| scene-0-take-3 | 3 | pending | — |

Chain from prev: no
Reroll requested: no
```

### Doctor

Add findings:
- `scene-selection-missing` (before review)
- `scene-selection-stale` (selected candidate's output file no longer exists)
- `scene-reroll-pending` (reroll requested but not yet executed)

### Event timeline

New event types emitted to `events/events.jsonl`:
- `scene-candidate.created`
- `scene-candidate.selected`
- `scene-candidate.rejected`
- `scene-reroll.requested`
- `scene-chain.configured`

## Backwards compatibility

- **Existing projects without candidate artifacts keep working.** The new artifacts are optional; when absent, the runtime falls back to the current single-generation behavior (ingest directly into asset manifest, no selection state).
- **A migration helper** `vclaw video candidates-migrate-from-assets --project <slug>` reads the existing `asset-manifest.json` and seeds a candidates artifact with one candidate per scene marked selected. This is a one-time backfill and is the cleanest way to adopt the new surface on existing projects. **Ships with v1.**

## Testing strategy

Mirrors the reference-sheets spec:

1. **Module contracts** for candidate-store + selection-store + pure analysis functions (uniqueness, disjointness, chain resolution)
2. **CLI end-to-end** covering all six new commands + the `--scene` partial-rerun flag
3. **Integration tests** against the execute runtime:
   - Submit one scene → one candidate appears
   - Partial rerun adds candidate to that scene only
   - Chain-from-prev reads N-1 selection correctly
   - Selection + rejection update the asset manifest appropriately
4. **Smoke** `scripts/smoke-scene-candidates.mjs` exercises: init → brief → storyboard → produce (3 scenes) → select 2, reject 1 for scene 0 → reroll scene 1 → verify artifact contents → verify storyboard.md review shows candidates. Added to `check:release-readiness-lite`.

## Documentation

- `docs/SCENE_CANDIDATES.md` — operator guide (why, commands, common workflows, troubleshooting)
- `docs/CLI_REFERENCE.md` — add the 6 new commands + the `--scene` flag extension
- `docs/ARCHITECTURE.md` — add a bullet in the implemented-flow list
- `docs/MASTER_PLAN_ALIGNMENT.md` — new top-level item after reference sheets
- `README.md` — one bullet in "What's shipped", add `docs/SCENE_CANDIDATES.md` to the doc map

## Risks

| Risk | Mitigation |
|---|---|
| Runtime behavior change breaks existing users | Feature gated on the presence of candidate artifacts; fallback preserves old behavior exactly |
| Candidate artifact grows unbounded over long projects | `generationRound` capped at 10 per scene (configurable); older candidates archivable to `artifacts/history/candidates/<round>.json` |
| Chain-from-prev failure modes are subtle | Explicit hard-fail with `chain-from-prev-source-missing` at payload build time; no silent fallback |
| Rerunning a scene whose downstream scenes chained from it invalidates their seeds | Reroll of scene N flags all N+k scenes with `chainedFromCandidateId === old-id` as `chain-upstream-stale`; operator must explicitly reroll or unchain those |
| Parallel writes from two CLIs corrupt artifacts | Writes go through the existing artifact-store atomic-write pattern; same contract as every other canonical artifact |

## Follow-on work (out of v1)

1. Visual candidate thumbnails in Obsidian via `video-thumbnail-lab`
2. Automatic candidate scoring (CLIP similarity against a reference sheet's identity references)
3. Parallel candidate generation within a round
4. Cross-project candidate reuse library
5. Candidate comparison view (HTML side-by-side generated from selected set)
6. Rollback helper (`vclaw video revert-selection --project <slug> --scene <i> --to-round <n>`)

## Decisions record (to confirm before implementation)

**S1 — Two artifacts (candidates + selection) vs one combined.**
- ✅ **Recommend two.** Candidates are append-only generation log; selection is mutable operator state. Splitting them makes the append-only history obvious and simplifies concurrency.
- Alternative: single artifact with nested `selectionState` per candidate. Simpler but conflates two concerns.

**S2 — `--scene <i>` on `produce` vs new `produce-scene` command.**
- ✅ **Recommend `--scene <i>`.** Operators already know `produce`; flag is discoverable via `--help`. Matches existing repeatable-flag patterns.
- Alternative: dedicated `produce-scene` command. Clearer but fragments the CLI.

**S3 — Chain-from-prev toggle at scene level vs global default.**
- ✅ **Recommend scene-level.** Different scenes in the same project have different chain semantics (cuts vs continuous takes). Scene-level lets operators set it per boundary.
- Alternative: project-level default with per-scene override. Only worth it if most operators use the same setting across a project.

**S4 — Migration helper ships in v1 vs follow-on.**
- ✅ **Recommend v1.** Without migration, existing projects can't use candidates without restarting. Cheap to write (read asset-manifest, emit single-candidate artifact).
- Alternative: defer. Creates two classes of project.

**S5 — Review stage gate (selection required) is blocking vs warning.**
- ✅ **Recommend blocking.** The whole point of candidates is explicit operator choice; letting review/publish advance without a selection defeats the feature.
- Alternative: warning only. Softer but undermines the design.

Defaults if confirmed: **S1=two artifacts, S2=--scene flag, S3=scene-level, S4=v1, S5=blocking.**

## File list (preview for the plan)

### New
- `schemas/video/artifacts/scene-candidates.schema.json`
- `schemas/video/artifacts/scene-selection.schema.json`
- `src/video/scene-candidates.ts`
- `src/video/scene-candidate-store.ts`
- `src/video/scene-selection.ts`
- `src/video/scene-selection-store.ts`
- `src/video/candidate-migrate.ts`
- `src/tests/scene-candidates.test.ts`
- `src/tests/scene-selection.test.ts`
- `src/tests/cli-scene-candidates.test.ts`
- `src/tests/cli-scene-selection.test.ts`
- `src/tests/cli-candidates-migrate.test.ts`
- `scripts/smoke-scene-candidates.mjs`
- `docs/SCENE_CANDIDATES.md`

### Modified
- `src/cli/vclaw.ts` — 9 new commands + `--scene` flag on produce/execute
- `src/video/types.ts` — new types
- `src/video/execute.ts` + `execution-runtime.ts` + `execution-status.ts` — candidate writes, partial-rerun scope, chain resolution
- `src/video/readiness.ts` — scene-selection-missing blocker
- `src/video/stage-guards.ts` — review/publish gate on selection
- `src/video/storyboard-markdown.ts` — Candidates & selection section
- `src/video/doctor.ts` + `doctor-portfolio.ts` — new findings
- `src/video/status.ts` + `project-index.ts` + `report.ts` + `csv-export.ts` + `obsidian-export.ts` — sceneSelection summary
- `src/video/events.ts` — new event types
- `src/index.ts` — public re-exports
- `README.md`, `docs/CLI_REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/MASTER_PLAN_ALIGNMENT.md`
- `scripts/check-release-readiness-lite.sh`, `package.json` — smoke wiring

## Shipping checklist

1. `npm test` green
2. `npm run check:release-readiness-lite` green (includes new smoke)
3. `npm run check:cleanroom-docs` green
4. CLAUDE.md / AGENTS.md mention the new concept where relevant
5. PR description links this spec

---

## Status for review

This spec captures the design, the 5 key decisions (S1–S5), the file list, testing and docs plan, and the risk register. It is **not yet paired with an implementation plan** — once the decisions are confirmed, the next step is `writing-plans` to produce the per-task TDD breakdown (estimated 20–25 tasks, same shape as the reference-sheets plan).

**Open question for the owner:** confirm S1–S5 defaults, then say "go" to produce the implementation plan.
