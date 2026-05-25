# Reference sheets

`videoclaw` treats **reference sheets** as the canonical way to lock the
visual grammar of a project — identity, wardrobe, palette, environment, motion —
into role-tagged, per-scene bindings that the runtime, the approval gate, and
the ops surfaces all agree on.

> **Every reference should have one job.** That is the first rule from the
> Seedance 2.0 director handbook and it's the rule that shapes this subsystem.
> A reference sheet is not a folder of "whatever images describe the look." It
> is a typed collection of entries, each tagged with a single role from a
> closed vocabulary, bound to an explicit set of scene indices.

The subsystem is deliberately small: five sheet types, a bounded role
vocabulary per type, per-scene bindings, Go Bananas reference support, and a
validator that refuses to let two sheets claim the same role on the same scene.

---

## Why reference sheets exist

Without role-tagged references, long-form and multi-scene video production
drifts in predictable ways:

- **Identity drift** — the lead looks like a slightly different person each
  scene because no single reference is the anchor.
- **Palette bleed** — every scene grades itself because no palette reference
  owns the first half vs the second half of the film.
- **Reference soup** — 40 images in a folder, each one doing three jobs, so the
  provider averages them into something nobody asked for.

Reference sheets fix this by forcing three decisions up front:

1. **What is this sheet for?** — one of five types with strict role vocabularies.
2. **What exact role does each image play?** — path-or-GB-ref + single role.
3. **Which scenes does this sheet bind?** — explicit scene indices, not "all."

The validator then refuses role collisions on the same scene. The director
preflight refuses to submit when roles are unassigned or the vocabulary is
violated. The readiness layer refuses director-mode execution for any
character-bound scene that doesn't have an **Identity Sheet** bound to it.

---

## The five sheet types and their role vocabularies

| Sheet type | Allowed roles |
|---|---|
| `identity` | `identity` · `wardrobe` · `silhouette` · `age-reference` |
| `outfit-material` | `outfit` · `material` · `accessory` · `texture` · `product-hero` · `product-variant` · `product-in-use` · `packaging` |
| `environment` | `location` · `set-dressing` · `weather` · `time-of-day` |
| `motion-camera` | `motion-rhythm` · `camera-behavior` · `blocking` · `shot-framing` |
| `palette-mood` | `palette` · `composition` · `mood` · `lighting-reference` |

The **`outfit-material`** vocabulary is intentionally extended with
`product-hero`, `product-variant`, `product-in-use`, and `packaging` so that
product-centric ads can anchor their hero shots the same way character ads
anchor their leads. A `product-hero` role on an `outfit-material` sheet is how
you lock "this is the canonical product silhouette" across the scenes that
feature it.

Any role outside the type's vocabulary is rejected at `reference-sheet-add`
time with `role-vocabulary-violation`.

---

## Setup — creating the first sheet

Every sheet lives under `projects/<slug>/references/reference-sheets.json`. You
do not hand-edit that file; you drive the five CLI commands below and the file
is written for you.

```bash
# Start a director-mode project.
vclaw video init demo --mode director
vclaw video brief      --project demo --title "Demo" --intent "A 15s product tease"
vclaw video storyboard --project demo --scene "Open on product" --scene "Close on logo"

# Add an Identity Sheet and bind it to scenes 0 and 1.
vclaw video reference-sheet-add \
    --project demo \
    --type identity \
    --name "Lead identity" \
    --character-name "Mochi" \
    --ref refs/mochi-identity.png:identity:"primary face anchor" \
    --binding 0 --binding 1
```

The sheet is then visible to every downstream surface: `status`, `index`,
`report`, `export-csv`, `export-obsidian`, `storyboard.md`, `doctor-project`,
`doctor-portfolio`, and the director preflight.

---

## Commands

Five CLI commands cover the full lifecycle. Every command writes JSON to
stdout and participates in the repo's normal exit-code contract: `0` = ok,
non-zero = validation error.

### 1. `reference-sheet-add`

Adds a new sheet. Optionally adds initial references via `--ref` or `--gb-ref`,
and optionally binds initial scene indices via `--binding`.

```bash
vclaw video reference-sheet-add \
    --project demo \
    --type identity \
    --name "Lead identity" \
    [--id sheet-001] \
    [--description "primary face anchor for the hero"] \
    [--character-name "Mochi"] \
    [--ref <path>:<role>[:<note>] ...] \
    [--gb-ref <kind>:<id>:<role>[:<note>] ...] \
    [--binding <sceneIndex> ...] \
    [--root <path>]
```

Sample output (truncated):

```json
{
  "sheet": {
    "id": "sheet-001",
    "type": "identity",
    "name": "Lead identity",
    "characterName": "Mochi",
    "references": [
      { "path": "refs/mochi-identity.png", "role": "identity", "note": "primary face anchor" }
    ],
    "bindings": { "sceneIndices": [0, 1] },
    "createdAt": "2026-04-21T12:34:56.000Z",
    "updatedAt": "2026-04-21T12:34:56.000Z"
  },
  "summary": {
    "count": 1,
    "byType": { "identity": 1 },
    "boundSceneCount": 2,
    "unboundSheetIds": []
  }
}
```

### 2. `reference-sheet-list`

Lists all sheets. Optional `--type` filters to one sheet type.

```bash
vclaw video reference-sheet-list --project demo [--type identity] [--root <path>]
```

Returns `{ sheets, summary }`.

### 3. `reference-sheet-show`

Returns one sheet by id.

```bash
vclaw video reference-sheet-show --project demo --id sheet-001 [--root <path>]
```

Returns `{ sheet }`. Fails with a non-zero exit if the id is unknown.

### 4. `reference-sheet-bind`

Adds scene indices to an existing sheet. Bindings are a set, so repeating an
index is a no-op.

```bash
vclaw video reference-sheet-bind \
    --project demo \
    --id sheet-001 \
    --scene 0 --scene 2 \
    [--root <path>]
```

### 5. `reference-sheet-validate`

Runs the full structural + collision check on the artifact.

```bash
vclaw video reference-sheet-validate --project demo [--root <path>]
```

Sample output:

```json
{
  "ok": false,
  "errors": [],
  "collisions": [
    { "sceneIndex": 1, "role": "palette", "sheetIds": ["sheet-002", "sheet-004"] }
  ],
  "summary": {
    "count": 4,
    "byType": { "identity": 1, "palette-mood": 2, "outfit-material": 1 },
    "boundSceneCount": 2,
    "unboundSheetIds": []
  }
}
```

`errors` surfaces `unassigned-role`, `role-vocabulary-violation`,
`invalid-scene-index`, `duplicate-sheet-id`, and `unknown-sheet-type`.
`collisions` surfaces any `(sceneIndex, role)` pair claimed by more than one
sheet.

---

## Readiness and preflight semantics

### Readiness check: identity-per-character

`vclaw video readiness --project <slug> --mode director` refuses to advance
when a storyboard scene has character bindings but no Identity Sheet is bound
to it. The error code is **`reference-sheet-missing-identity`** and is raised
per-scene.

This is a hard readiness gate: it blocks the director-mode `execute` /
`execute-status` path before any provider submission.

Readiness also emits non-blocking `warnings` for weak identity coverage:

- `reference-sheet-character-mismatch` — a bound Identity Sheet names a
  character that is not listed on that storyboard scene.
- `reference-sheet-weak-identity` — a bound Identity Sheet has no `identity`
  role reference.
- `reference-sheet-thin-identity-coverage` — a bound Identity Sheet has only
  one `identity` role reference. The project can still execute, but continuity
  risk is higher for multi-scene character work.

### Director preflight: structural checks

`vclaw video director-preflight --project <slug>` runs reference-sheet checks
on top of content-hazard, prompt-quality, dialogue-fit, character, and repeated
scene checks:

| Code | Meaning |
|---|---|
| `unassigned-role` | A reference entry has no role. Fix: add a role to every `--ref` / `--gb-ref` entry. |
| `role-vocabulary-violation` | A reference entry uses a role outside the sheet type's vocabulary. Fix: use a role from the table above. |
| `role-collision` | Two or more sheets bound to the same scene supply the same role. Fix: unbind one, or split the role. |
| `reference-sheet-orphan-gb-ref` | A `gbRef` points at a Go Bananas id that no longer resolves. Fix: re-create or re-import the GB entry, or drop the reference. |

The preflight runs before the approval gate, so the failure is visible in the
storyboard-review file and in `doctor-project` output without spending any
provider budget.

---

## Integration points

Reference sheets don't live in isolation — they flow through the whole ops
surface.

### Characters

A sheet can carry an optional `characterName` (`--character-name`), which the
readiness layer uses to match Identity Sheets to character-bound scenes. This
is how the `reference-sheet-missing-identity` check knows whether the scene's
characters are covered by at least one identity sheet.

### Director-mode storyboard review (`storyboard.md`)

Director mode's `storyboard.md` review gains a **Reference sheets** section
that lists, per scene, which sheets cover it, what type they are, the roles
they supply, and any tied-in character. This is what the human approver reads
before setting `VIDEOCLAW_APPROVE_STORYBOARD=1`.

### Obsidian frontmatter

`sync-obsidian` / `export-obsidian` write three frontmatter fields per project
note:

- `referenceSheetCount` — total sheets for the project.
- `referenceSheetTypes` — comma-joined list of sheet types present.
- `referenceSheetCollisions` — boolean; `true` when validation detects any
  role collision.

These fields are queryable in the Obsidian Dataview sense so portfolio-wide
searches like "projects with any reference-sheet collisions" become trivial.

### Status, index, report, CSV export

`status` surfaces a `referenceSheets` summary block
(`count`, `byType`, `boundSceneCount`, `unboundSheetIds`). That block flows
through `project-index`, `report`, `csv-export`, and Obsidian so every ops
surface agrees on the same counts without re-reading the artifact.

### Doctor

`doctor-project` and `doctor-portfolio` elevate two conditions to portfolio
health issues:

- **`reference-sheet-missing-identity-when-approval-pending`** — a director
  scene has character bindings but no Identity Sheet, and approval is pending.
- **`reference-sheet-role-collision`** — the validator detects at least one
  `(sceneIndex, role)` claimed by multiple sheets.

Both appear in `Health.md` in the Obsidian vault.

---

## Common workflows

### Lock identity across scenes

```bash
vclaw video reference-sheet-add \
    --project my-project \
    --type identity \
    --name "Lead identity" \
    --character-name "Mochi" \
    --ref refs/mochi-identity.png:identity \
    --ref refs/mochi-wardrobe.png:wardrobe \
    --binding 0 --binding 1 --binding 2 --binding 3
```

A single `identity`-type sheet with both `identity` and `wardrobe` entries,
bound to every scene Mochi appears in.

### Bind one palette across the first half of the video

```bash
vclaw video reference-sheet-add \
    --project my-project \
    --type palette-mood \
    --name "Opening palette" \
    --ref refs/dusk-palette.png:palette \
    --ref refs/dusk-light.png:lighting-reference \
    --binding 0 --binding 1 --binding 2

vclaw video reference-sheet-add \
    --project my-project \
    --type palette-mood \
    --name "Climax palette" \
    --ref refs/neon-palette.png:palette \
    --binding 3 --binding 4
```

Two palette sheets, each bound to disjoint scene indices. The validator
remains clean because no scene is claimed by both.

### Fix a role collision

If validation reports:

```json
{ "sceneIndex": 1, "role": "palette", "sheetIds": ["sheet-002", "sheet-004"] }
```

…one of the two sheets is claiming `palette` on scene 1. The fix is to
un-bind one of them from that scene. Because `reference-sheet-bind` only adds
scene indices, the tactical fix is usually to re-create the sheet with the
intended bindings, or open the on-disk artifact and remove the unwanted
index. A follow-up `reference-sheet-validate` must then come back `ok: true`.

---

## Go Bananas integration

`--gb-ref <kind>:<id>:<role>[:<note>]` binds a Go Bananas reference to a sheet
entry. The five supported kinds are:

| Kind | What it points at |
|---|---|
| `character` | GB character profile with identity/consistency lineage |
| `product` | GB product reference — pair with `product-*` roles |
| `scene` | GB saved-scene reference |
| `style-preset` | GB style preset — pair with `palette-mood` roles |
| `reference-group` | GB reference group — pair with any role type-appropriate for the group |

The `product` kind pairs naturally with the extended **outfit-material**
vocabulary:

```bash
vclaw video reference-sheet-add \
    --project demo \
    --type outfit-material \
    --name "Hero product" \
    --gb-ref product:42:product-hero \
    --binding 0

vclaw video reference-sheet-add \
    --project demo \
    --type outfit-material \
    --name "Packaging variant" \
    --gb-ref product:42:packaging \
    --binding 2
```

If the GB id stops resolving (deleted, renamed, wrong environment), the
director preflight reports `reference-sheet-orphan-gb-ref` before any
submission happens.

---

## Troubleshooting

**`role-vocabulary-violation` at add-time.**
The role you passed is not in the sheet type's vocabulary. Consult the five
tables above and switch to a role the sheet type allows.

**`reference-sheet-missing-identity` from readiness.**
A director-mode scene has character bindings but no `identity` sheet is bound
to it. Add an Identity Sheet (with optional `--character-name`) and bind it
to that scene.

**`role-collision` from validate or preflight.**
Two sheets bound to the same scene supply the same role. Unbind one, split
the role, or rebind them to disjoint scene sets.

**`reference-sheet-orphan-gb-ref` from preflight.**
A `gbRef` in a sheet points at a Go Bananas id that no longer resolves.
Re-create the GB entry, re-import it into the project, or drop the reference.

**`unassigned-role` from validate.**
A reference entry has no role. This means the artifact on disk was hand-edited
into an invalid state — rerun `reference-sheet-add` with an explicit role
rather than editing the JSON directly.

**`duplicate-sheet-id` from validate.**
Two sheets share the same id. This can only happen if the artifact was
hand-edited. Fix the id collision on disk and rerun validate.

---

## Where to read next

- [`docs/CLI_REFERENCE.md`](./CLI_REFERENCE.md) — full command reference, including the reference-sheet commands in the lifecycle.
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — where reference sheets sit in the layered flow.
- [`docs/OBSIDIAN.md`](./OBSIDIAN.md) — how the Obsidian vault exposes reference-sheet counts and collisions.
- [`src/video/reference-sheets.ts`](../src/video/reference-sheets.ts) — the pure core (validation, vocabulary, mutation, summary, collision detection).
- [`src/video/reference-sheet-store.ts`](../src/video/reference-sheet-store.ts) — the on-disk I/O layer.
