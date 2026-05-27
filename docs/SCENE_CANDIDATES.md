# Scene candidates

`videoclaw` treats **scene candidates** as the canonical way to capture
the output side of video generation — every take the runtime produces for every
scene, plus the operator's selection state on top of it. This is the
output-layer counterpart to the input-layer
[reference sheets](./REFERENCE_SHEETS.md) subsystem.

> **One scene can have many takes. One take per scene is the winner.**
> Choreo-inspired: the director's job is picking the good one, not pretending
> the first generation is always final.

The subsystem is deliberately small: two canonical artifacts, one append-only
candidate registry + one mutable selection ledger, nine CLI commands, and a
`--scene` partial-rerun flag on `produce` / `execute`.

---

## Why scene candidates exist

Without a per-scene candidate registry, long-form and multi-scene video
production drifts in predictable ways:

- **Overwrite amnesia** — each re-run of `produce` replaces the only asset for
  a scene, so you cannot compare "take 1" to "take 2" after the fact.
- **All-or-nothing reruns** — fixing one bad scene means re-running every
  scene, burning budget.
- **Lost approvals** — the operator approves a specific frame but the runtime
  doesn't know which take was approved, so the next submission re-rolls it.
- **Unauditable selection** — "which video did we actually ship?" is
  answerable only by reading file mtimes.

Scene candidates fix this by making three decisions explicit:

1. **Every take is kept.** The candidates artifact is append-only; rounds 1,
   2, 3 coexist with distinct ids.
2. **Selection is its own state.** A separate selection artifact records
   `selectedCandidateId`, `rejectedCandidateIds`, `pendingCandidateIds`,
   `rerollRequested`, and `chainFromPrev` per scene.
3. **Partial reruns are first-class.** `produce --scene <n>` reruns only the
   scenes that need it, producing a new round under the same sceneIndex.

---

## Data model

Two canonical artifacts live under `projects/<slug>/artifacts/`:

| Artifact | Mutability | What it captures |
|---|---|---|
| `scene-candidates.json` | **append-only** | every take the runtime produced, grouped by scene |
| `scene-selection.json` | **mutable** | operator's pick, rejections, pending ids, reroll flag, chain-from-prev flag per scene |

### `scene-candidates.json` shape

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
          "prompt": "open on product",
          "route": "veo-direct",
          "submittedAt": "2026-04-22T10:00:00.000Z",
          "completedAt": "2026-04-22T10:00:30.000Z",
          "status": "completed",
          "outputs": [
            { "kind": "video", "path": "artifacts/outputs/scene-0-take-1.mp4" }
          ],
          "source": {
            "executionRound": 1,
            "adapter": "builtin",
            "chainedFromCandidateId": null
          }
        }
      ]
    }
  ]
}
```

Candidate ids are globally unique with the shape `scene-<sceneIndex>-take-<n>`.
`status` is one of `pending | completed | failed | cancelled`.

### `scene-selection.json` shape

```json
{
  "schemaVersion": 1,
  "scenes": [
    {
      "sceneIndex": 0,
      "selectedCandidateId": "scene-0-take-1",
      "rejectedCandidateIds": [],
      "pendingCandidateIds": [],
      "rerollRequested": false,
      "chainFromPrev": false,
      "notes": "first take was perfect"
    }
  ]
}
```

Selection mutates freely — operators can pick, reject, re-pick, request a
reroll, or flip the chain flag. The `selectedCandidateId`,
`rejectedCandidateIds`, and `pendingCandidateIds` are pairwise disjoint per
scene (enforced by `validateSelection`).

---

## Setup — first candidates and first winner

```bash
vclaw video init demo --mode director
vclaw video brief      --project demo --title "Demo" --intent "A 15s product tease"
vclaw video storyboard --project demo \
    --scene "open on product" --scene "close on logo"

# Run the pipeline. On the first successful round the execute runtime writes
# scene-candidates.json, one candidate per scene.
vclaw video plan    --project demo
vclaw video produce --project demo

# Inspect what came back.
vclaw video candidates-list --project demo

# Pick the winners.
vclaw video select-candidate --project demo --scene 0 --candidate-id scene-0-take-1
vclaw video select-candidate --project demo --scene 1 --candidate-id scene-1-take-1
```

Once both scenes have a selected candidate, the readiness layer will let
`review` and `publish` advance.

---

## Commands

Nine CLI commands cover the full lifecycle. All write JSON to stdout and
participate in the standard exit-code contract: `0` = ok, non-zero = validation
or lookup error.

### 1. `candidates-list`

List all candidates, optionally filtered to one scene.

```bash
vclaw video candidates-list --project <slug> [--scene <sceneIndex>] [--root <path>]
```

Without `--scene`, returns `{ scenes, summary }`. With `--scene`, returns
`{ sceneIndex, candidates, summary }` (summary is still portfolio-wide).

```json
{
  "scenes": [
    {
      "sceneIndex": 0,
      "candidates": [
        { "id": "scene-0-take-1", "generationRound": 1, "status": "completed", "... ": "..." }
      ]
    }
  ],
  "summary": {
    "totalCandidates": 1,
    "sceneCount": 1,
    "completedCount": 1,
    "pendingCount": 0,
    "failedCount": 0
  }
}
```

### 2. `candidates-show`

Look up one candidate by id across all scenes.

```bash
vclaw video candidates-show --project <slug> --candidate-id <id> [--root <path>]
```

Returns `{ sceneIndex, candidate }`. Exits non-zero on unknown id.

### 3. `select-candidate`

Mark a candidate as the operator's pick for a scene. Pulls the id out of
`rejectedCandidateIds` / `pendingCandidateIds` and clears `rerollRequested`.

```bash
vclaw video select-candidate \
    --project <slug> \
    --scene <sceneIndex> \
    --candidate-id <id> \
    [--notes <text>] \
    [--root <path>]
```

### 4. `reject-candidate`

Record a rejection. If the id was the current selection, clears it; removes
the id from `pendingCandidateIds` if present.

```bash
vclaw video reject-candidate \
    --project <slug> \
    --scene <sceneIndex> \
    --candidate-id <id> \
    [--notes <text>] \
    [--root <path>]
```

### 5. `reroll-scene`

Mark a scene as needing a fresh generation. Clears `selectedCandidateId` so
the operator has to re-pick once the next round produces a new candidate.
Optionally sets `chainFromPrev`.

```bash
vclaw video reroll-scene \
    --project <slug> \
    --scene <sceneIndex> \
    [--chain-from-prev on|off] \
    [--root <path>]
```

### 6. `chain-from`

Turn on the **chain-from-prev** flag. **v1 only supports chain-from-prev**, so
`--from` must equal `--scene - 1`. Any other source raises
`chain-from-unsupported`.

```bash
vclaw video chain-from \
    --project <slug> \
    --scene <sceneIndex> \
    --from <sourceSceneIndex> \
    [--root <path>]
```

### 7. `unchain`

Turn off the `chainFromPrev` flag for a scene.

```bash
vclaw video unchain --project <slug> --scene <sceneIndex> [--root <path>]
```

### 8. `candidates-migrate-from-assets`

One-shot migration from legacy single-generation projects. Reads the existing
`asset-manifest.json`, synthesizes one completed candidate per scene at
`generationRound: 1` with id `scene-<i>-take-1`, and pre-selects that
candidate in `scene-selection.json`. Refuses if `scene-candidates.json`
already exists (no `--force` in v1).

```bash
vclaw video candidates-migrate-from-assets \
    --project <slug> \
    [--dry-run] \
    [--root <path>]
```

### 9. `--scene` flag on `produce` / `execute`

`produce` and `execute` accept one or more `--scene <sceneIndex>` flags to
restrict execution to a subset of scenes. Scenes you don't pass stay on their
current candidate. Scenes you do pass get a new generation round appended to
their candidate list.

```bash
vclaw video produce --project <slug> --scene 2                   # one scene
vclaw video produce --project <slug> --scene 1 --scene 3         # two specific scenes
```

---

## Chain-from-prev semantics

Some providers (most notably Seedance 2.0) accept a "continuing from this
clip" hint that preserves character identity, environment, and motion
continuity into the next scene. Scene selection captures that intent via the
`chainFromPrev` flag.

**Resolution rule:** when the execute runtime generates scene `n` with
`chainFromPrev: true`, it reads `scene-selection.json` for scene `n - 1` and
uses that scene's `selectedCandidateId` as the upstream clip.

**Hard-fail cases:**

- If scene `n - 1` has no `selectedCandidateId`, the runtime fails with
  `chain-from-prev-source-missing` rather than silently dropping the chain.
- If scene `n - 1`'s selected candidate has `status !== 'completed'`, the
  runtime fails with `scene-chain-upstream-stale` rather than chaining off a
  failed take.

**v1 limit.** Only chain-from-prev (source equals `sceneIndex - 1`) is
supported. `vclaw video chain-from --from <n> --scene <m>` with `n !== m - 1`
returns `chain-from-unsupported`. A later version may add longer-range chains.

---

## Migration workflow

For a legacy project that was generated before the scene-candidates subsystem
existed:

```bash
# Inspect first.
vclaw video candidates-migrate-from-assets --project <slug> --dry-run

# Apply.
vclaw video candidates-migrate-from-assets --project <slug>
```

The migration walks `asset-manifest.json`, groups assets by `sceneIndex`, and
creates one synthetic `completed` candidate per scene at round 1. The
companion `scene-selection.json` is written with each candidate pre-selected.
One `scene-candidate.migrated` event is appended per scene so the timeline
has a clear "this project was migrated" marker.

If `scene-candidates.json` already exists, the command refuses with
`migrate-refused`. Remove the file manually before retrying — there is no
`--force` in v1 on purpose.

---

## Readiness and stage-guard semantics

### Readiness

`vclaw video readiness --project <slug>` refuses to advance when any scene
has candidates but no `selectedCandidateId`. The error code is
**`scene-selection-missing`** and is raised per-scene.

### Stage guards: review and publish

Both `review` and `publish` refuse to run when selection is incomplete:

- **`review`** — requires a selected candidate for every scene that has
  candidates. Blocks with `scene-selection-missing`.
- **`publish`** — same guard. In addition, the publish stage derives a
  canonical `asset-manifest.json` view from `deriveAssetManifestFromSelection`
  so the shipped assets match exactly what was selected.

### Execute runtime

A stale director review + any `rerollRequested: true` combination is
treated as "the approved storyboard no longer matches what's being executed"
and blocks `execute-status` until either the review is refreshed or the
reroll is cleared.

---

## Integration with other subsystems

### Characters

Scene candidates are character-agnostic — they don't care which characters
are in a scene. But the execute runtime passes the storyboard's character
bindings through to the provider, and `chainFromPrev` preserves identity
across the cut by routing the previous take as a reference.

### Reference sheets

Reference sheets (input layer) and scene candidates (output layer) are
deliberately parallel subsystems. A single scene's generation draws from the
reference sheets bound to it; every generated take is recorded as a
candidate. The two artifacts never cross-reference each other — they just
both point at the same `sceneIndex`.

### Obsidian

`export-obsidian` and `sync-obsidian` write one note per scene under
`Projects/<slug>/Scenes/<i>.md` containing candidate counts, selected take id
and link, rejected-count, pending-count, reroll flag, and `chainFromPrev`
state. Project-level Obsidian frontmatter gains:

- `sceneCandidateCount` — total candidates across all scenes.
- `sceneSelectionCoverage` — integer `withSelection / sceneCount`.
- `sceneRerollPending` — boolean; `true` when any scene has
  `rerollRequested: true`.

### `storyboard.md` review

Director mode's `storyboard.md` approval review gains a **Candidates &
selection** section. Per scene, it lists the take id, status, round, and
which take is currently selected. This is what the human approver reads
before setting `VIDEOCLAW_APPROVE_STORYBOARD=1`.

### Doctor

`doctor-project` and `doctor-portfolio` elevate four conditions to portfolio
health issues:

- **`scene-selection-missing`** — a scene has candidates but no
  `selectedCandidateId`.
- **`scene-selection-stale`** — the selected candidate is no longer the
  newest `completed` take in that scene.
- **`scene-reroll-pending`** — `rerollRequested: true` is still set, blocking
  review/publish.
- **`scene-chain-upstream-stale`** — `chainFromPrev: true` but the upstream
  scene's selected candidate is missing or not `completed`.

---

## Common workflows

### Rerun just one scene

```bash
# Scene 2 looked off. Reject it, request a reroll, regenerate only that scene.
vclaw video reject-candidate --project demo --scene 2 --candidate-id scene-2-take-1
vclaw video reroll-scene     --project demo --scene 2
vclaw video produce          --project demo --scene 2
vclaw video candidates-list  --project demo --scene 2
vclaw video select-candidate --project demo --scene 2 --candidate-id scene-2-take-2
```

### Give me three takes of scene 4

```bash
vclaw video reroll-scene --project demo --scene 4 && \
  vclaw video produce    --project demo --scene 4
vclaw video reroll-scene --project demo --scene 4 && \
  vclaw video produce    --project demo --scene 4
# Inspect all three.
vclaw video candidates-list --project demo --scene 4
# Pick the winner.
vclaw video select-candidate --project demo --scene 4 --candidate-id scene-4-take-3
```

### Chain scene 5 from scene 4

```bash
# Lock scene 4's winner first — chain resolution reads scene 4's selection.
vclaw video select-candidate --project demo --scene 4 --candidate-id scene-4-take-2

# Turn on chain-from-prev for scene 5.
vclaw video chain-from       --project demo --scene 5 --from 4
vclaw video produce          --project demo --scene 5
vclaw video candidates-list  --project demo --scene 5
```

If scene 4's selection is missing or still pending, the execute runtime will
surface `chain-from-prev-source-missing` or `scene-chain-upstream-stale`
instead of silently dropping the chain.

---

## Troubleshooting

**`chain-from-prev-source-missing` from execute.**
A scene has `chainFromPrev: true` but the previous scene has no
`selectedCandidateId`. Fix: `select-candidate` on the previous scene, or
`unchain` on the downstream scene.

**`chain-from-unsupported` from `chain-from`.**
You passed `--from <n>` where `n !== --scene - 1`. v1 only supports
chain-from-prev. Re-run with `--from <scene - 1>`.

**`scene-selection-missing` from readiness / review / publish / doctor.**
At least one scene has candidates but no selection. Run `candidates-list` to
find the uncovered scene, then `select-candidate` or `reject-candidate` +
`reroll-scene` as appropriate.

**`scene-selection-stale` from doctor.**
A newer completed take exists for a scene whose selection is pinned to an
older take. Review the newer candidate with `candidates-show` and either
`select-candidate` the newer one or leave it as-is (the warning is advisory,
not blocking).

**`scene-chain-upstream-stale` from doctor / execute.**
`chainFromPrev: true` but the upstream scene's selected candidate is missing
or its status is not `completed`. Fix the upstream selection, or `unchain`
the downstream scene.

**`scene-reroll-pending` from doctor.**
A scene still has `rerollRequested: true`. Run `produce --scene <n>` to
produce the new round, then `select-candidate` to clear the reroll flag
(selection automatically resets the reroll).

**`migrate-refused` from `candidates-migrate-from-assets`.**
The project already has a `scene-candidates.json`. Migration is one-shot — if
you genuinely want to re-migrate, remove
`projects/<slug>/artifacts/scene-candidates.json` and
`projects/<slug>/artifacts/scene-selection.json` first.

---

## Where to read next

- [`docs/CLI_REFERENCE.md`](./CLI_REFERENCE.md) — full command reference, including the scene-candidates commands in the lifecycle.
- [`vclaw video multi-shot`](./CLI_REFERENCE.md#multi-shot-prompt) — standalone timecoded multi-shot prompt authoring aid (the `cinematic-15s` preset). Today it runs independently of a project; **Phase 2 will wire it into the per-scene flow** so a scene candidate can carry a multi-shot prompt directly. See [`docs/PROMPT_QUALITY.md`](./PROMPT_QUALITY.md) for the enforcement rules.
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — where scene candidates sit in the layered flow.
- [`docs/REFERENCE_SHEETS.md`](./REFERENCE_SHEETS.md) — the input-layer counterpart.
- [`docs/OBSIDIAN.md`](./OBSIDIAN.md) — how the Obsidian vault exposes candidate counts, per-scene notes, and selection-coverage.
- [`src/video/scene-candidates.ts`](../src/video/scene-candidates.ts) — the pure core for the candidates registry.
- [`src/video/scene-selection.ts`](../src/video/scene-selection.ts) — the pure core for the selection ledger.
- [`src/video/scene-candidate-store.ts`](../src/video/scene-candidate-store.ts) — candidates disk I/O.
- [`src/video/scene-selection-store.ts`](../src/video/scene-selection-store.ts) — selection disk I/O.
- [`src/video/candidate-migrate.ts`](../src/video/candidate-migrate.ts) — legacy-project migration helper.
