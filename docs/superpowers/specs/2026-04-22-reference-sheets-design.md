# Reference sheets — design

**Status:** Draft for review
**Date:** 2026-04-22
**Owner:** Davendra Patel
**Scope estimate:** ~600–900 LOC across ~20 files, 1–2 focused sessions

---

## Problem

The Seedance 2.0 Handbook (read 2026-04-22) crystallizes a rule the repo
already half-implements: **every reference to a generator must have exactly
one job** — identity, wardrobe, palette, motion-rhythm, ambience, composition,
or similar. The handbook names this as anti-pattern #3 ("unassigned reference
stacks") and identifies role-less references as the most common cause of
character drift and style bleed.

The repo today only models **Identity** references (via
`projects/<slug>/characters/characters.json` and the `character-creator` /
`character-library` skills). Asset manifests hold file paths but do not tag a
reference with the job it is meant to do. Storyboard scenes can bind character
names, but cannot bind a palette sheet, a motion-rhythm reference, or an
environment reference.

The practical consequence:

1. A director-mode run can pass readiness + preflight with a bag of
   role-less reference images, and still produce drift.
2. The approval-gate review file (`storyboard.md`) cannot show reviewers what
   each reference is supposed to control.
3. Operators have no way to reuse, for example, a well-tuned palette/mood
   reference set across projects — references are implicitly one-shot.

## Goal

Add **reference sheets** as a first-class concept in the clean-room repo, with
five typed sheets, role-tagged references, per-scene bindings, validation,
preflight integration, and full ops-surface visibility.

## Non-goals

Deliberately out of scope for v1:

1. **Auto-generation of sheets from a brief.** The natural home is an
   extension to the Gemini-backed `analyze-template` path; this spec does not
   couple to that.
2. **Sheet template library** (reusable palette-mood sheets across projects).
   Follow-on after the data model is stable.
3. **Visual preview rendering** (HTML/PDF reference sheet cards). Can layer
   on top of `video-thumbnail-lab` later.
4. **Retroactive migration** of existing projects. New projects adopt sheets;
   existing projects keep working without them and only fail readiness if the
   operator opts in by creating a sheet.

## Approach

Reference sheets live **alongside** characters, not replacing them
(see **D1** in the decision record). This keeps the existing cast hydration,
character-consistency, and Go Bananas anchoring paths intact.

- Characters stay at `projects/<slug>/characters/characters.json`.
- Sheets live at `projects/<slug>/references/reference-sheets.json`.
- An Identity Sheet *can* reference a character by name, bridging the two
  systems without forcing a migration.

Five sheet types, with closed role vocabularies per type
(see **Data Model** below):

| Type | Purpose | Role vocabulary |
|---|---|---|
| `identity` | Who is in the scene | `identity` · `wardrobe` · `silhouette` · `age-reference` |
| `outfit-material` | What they wear and what it's made of (plus product showcase) | `outfit` · `material` · `accessory` · `texture` · `product-hero` · `product-variant` · `product-in-use` · `packaging` |
| `environment` | Where the scene happens | `location` · `set-dressing` · `weather` · `time-of-day` |
| `motion-camera` | How the camera and subject move | `motion-rhythm` · `camera-behavior` · `blocking` · `shot-framing` |
| `palette-mood` | The visual feel of the scene | `palette` · `composition` · `mood` · `lighting-reference` |

## Data model

### Canonical artifact

`projects/<slug>/references/reference-sheets.json`:

```json
{
  "schemaVersion": 1,
  "sheets": [
    {
      "id": "sheet-001",
      "type": "identity",
      "name": "Lead — Mochi",
      "description": "Primary cast lead across all scenes.",
      "characterName": "Mochi",
      "references": [
        { "path": "refs/mochi-identity.png", "role": "identity" },
        { "path": "refs/mochi-wardrobe.png", "role": "wardrobe", "note": "only this jacket" }
      ],
      "bindings": { "sceneIndices": [1, 2, 3, 4] },
      "createdAt": "2026-04-22T10:00:00.000Z",
      "updatedAt": "2026-04-22T10:00:00.000Z"
    },
    {
      "id": "sheet-002",
      "type": "palette-mood",
      "name": "Warm dusk palette",
      "description": "Golden-hour warmth across the opening act.",
      "references": [
        { "path": "refs/dusk-01.png", "role": "palette" },
        { "path": "refs/dusk-02.png", "role": "composition" }
      ],
      "bindings": { "sceneIndices": [1, 2] }
    }
  ]
}
```

### Field definitions

| Field | Required | Purpose |
|---|---|---|
| `schemaVersion` | yes | Contract version; starts at `1` |
| `sheets[]` | yes | Array of sheets |
| `sheets[].id` | yes | Stable id. Auto-generated as `sheet-<n>` (next free integer) when `--id` is omitted; operator-chosen when provided. |
| `sheets[].type` | yes | One of the five sheet types |
| `sheets[].name` | yes | Human-readable label |
| `sheets[].description` | no | Free-form note |
| `sheets[].characterName` | no (identity only) | Link to `characters/characters.json` entry |
| `sheets[].references[]` | yes (may be empty at creation) | Reference entries |
| `sheets[].references[].path` | yes | Local or remote reference path |
| `sheets[].references[].role` | yes | Must be in the role vocabulary for the sheet type |
| `sheets[].references[].note` | no | Free-form per-reference note |
| `sheets[].bindings.sceneIndices[]` | no | Scenes this sheet binds to (empty = unbound) |
| `sheets[].createdAt` / `updatedAt` | yes | ISO timestamps |

### Validation rules

1. **Role ∈ vocabulary for type.** An `identity` sheet cannot carry a
   `palette` role. Validated on `reference-sheet-add` and `reference-sheet-validate`.
2. **No role collisions within a scene.** A scene cannot have two bindings
   that supply the same role (e.g. two sheets both supplying `palette` for
   scene 3). Flagged by `reference-sheet-validate` as a collision.
3. **Unassigned references are errors, not warnings.** Every `references[]`
   entry must carry a role.
4. **Scene indices must exist.** Bindings to out-of-range scene indices
   fail validation.
5. **Unique sheet ids within a project.**

## CLI surface

Add five new subcommands under the existing `vclaw video` namespace:

```bash
vclaw video reference-sheet-add \
  --project <slug> \
  --type <identity|outfit-material|environment|motion-camera|palette-mood> \
  --name <name> \
  [--id <sheet-id>] \
  [--description <text>] \
  [--character-name <name>] \
  [--ref <path>:<role> ...] \
  [--binding <sceneIndex> ...] \
  [--root <path>]

vclaw video reference-sheet-list --project <slug> [--type <sheet-type>] [--root <path>]

vclaw video reference-sheet-show --project <slug> --id <sheet-id> [--root <path>]

vclaw video reference-sheet-bind \
  --project <slug> \
  --id <sheet-id> \
  --scene <sceneIndex> [--scene <sceneIndex> ...] \
  [--root <path>]

vclaw video reference-sheet-validate --project <slug> [--root <path>]
```

Output is machine-readable JSON by default, matching existing commands.

## Integration points

### Readiness (`src/video/readiness.ts`)

- Director-mode projects require **at least one Identity Sheet** bound per
  scene that has character references in the storyboard.
- Fail `readiness` with a new failure code `reference-sheet-missing-identity`.

### Director preflight (`src/video/director-preflight.ts`)

Three new checks:

1. `unassigned-role` — any sheet has a reference without a role.
2. `role-vocabulary-violation` — reference role not in the sheet-type vocabulary.
3. `role-collision` — two sheets bound to the same scene both supply the same
   role (e.g. two palette sources for scene 2).

All three are **blocking** errors for director-mode (matching current preflight
severity model). Storyboard-mode emits them as warnings.

### Doctor (`src/video/doctor.ts`) + portfolio (`src/video/doctor-portfolio.ts`)

- Per-project: count sheets, per-sheet reference-role assignment completeness,
  unbound sheets, role collisions.
- Portfolio rollup: projects with no sheets at all, projects with sheets but
  no bindings, projects with collisions.

### Status + project-index + report + CSV + Obsidian

Every ops surface grows a `referenceSheets` summary field:

```json
{
  "referenceSheets": {
    "count": 3,
    "byType": { "identity": 1, "palette-mood": 1, "environment": 1 },
    "boundSceneCount": 4,
    "unboundSheetIds": ["sheet-003"]
  }
}
```

### Storyboard markdown (`src/video/storyboard-markdown.ts`)

Director-mode review file gains a **Reference sheets** section showing, per
scene: which sheets are bound, what role each reference plays, and any linked
character. This answers the handbook's call for reviewable role clarity at the
approval gate.

### Obsidian export

The generated `Projects/<slug>.md` frontmatter gains:
`referenceSheetCount`, `referenceSheetTypes`, `referenceSheetCollisions`.
The `Health.md` rollup counts projects with unresolved collisions.

## Which sheet types enforce in v1 (D2)

Per the decision log: **all 5 sheet types ship in the schema and CLI; only
the Identity Sheet is wired into blocking readiness in v1.** All 5 types
participate in the three preflight validation checks (unassigned-role,
role-vocabulary-violation, role-collision) **when sheets are present**; none
of the non-Identity types are required to be present.

This gives the full data-model shape on day one without forcing existing
projects to backfill sheets. `palette-mood` was a candidate for v1 enforcement
(decision-log earlier noted both), but tightening to Identity-only keeps the
rollout additive — projects without a palette-mood sheet should not fail
readiness.

Subsequent PRs can promote `palette-mood`, `outfit-material`, `environment`,
and `motion-camera` to required-when-applicable enforcement once operators
have practice authoring them.

## Testing strategy

### Module contracts

`src/tests/reference-sheets.test.ts` covers:

1. Create / read / update / delete sheets
2. Role vocabulary enforcement per sheet type
3. Role-collision detection across sheets bound to the same scene
4. Scene-index range validation
5. Character-name linking (identity sheets only)
6. Schema round-trip (read-after-write preserves structure)

### CLI end-to-end

`src/tests/cli-reference-sheets.test.ts` covers:

1. `reference-sheet-add` with valid role → artifact written correctly
2. `reference-sheet-add` with invalid role → non-zero exit, readable error
3. `reference-sheet-list` filters by type
4. `reference-sheet-show` returns full sheet JSON
5. `reference-sheet-bind` updates bindings idempotently
6. `reference-sheet-validate` surfaces collisions and unassigned roles

### Smoke

New smoke `scripts/smoke-reference-sheets.mjs`:

1. `init` → `brief` → `storyboard` → `reference-sheet-add identity`
   → `reference-sheet-add palette-mood` → `reference-sheet-bind` → `readiness`
   → `director-preflight` → asserts both sheets appear in storyboard.md

Added to `scripts/check-release-readiness-lite.sh` so CI gates on it.

## Backwards compatibility

Fully additive:

- Existing projects without `references/reference-sheets.json` behave exactly
  as today. Readiness and preflight only reference-check when sheets exist.
- The one exception: **director-mode projects that have a storyboard with
  character bindings** must now carry an Identity Sheet per character. This
  is a deliberate tightening — the handbook is clear that identity without a
  role is the root cause of character drift.
- A migration helper `vclaw video reference-sheet-migrate-from-characters` is
  out of scope for v1 but noted in the follow-on list. Until then, operators
  create sheets manually; the cost is one CLI call per character.

## Documentation

- `docs/REFERENCE_SHEETS.md` — operator guide (what they are, why, commands,
  common workflows, failure-mode → fix mapping drawn from the handbook)
- `docs/CLI_REFERENCE.md` — five new commands in the lifecycle section
- `docs/ARCHITECTURE.md` — add a reference-sheet layer box to the flow
- `README.md` — two-line mention in "Why this exists" + the artifacts list
- `docs/MASTER_PLAN_ALIGNMENT.md` — add to the implemented-items list on landing

## Risks

| Risk | Mitigation |
|---|---|
| Schema churn: role vocabulary may prove wrong in practice | `schemaVersion` field in place from v1; role lists can extend additively |
| Operators feel forced to make sheets just to pass readiness | Readiness only enforces sheets when the project has character bindings; storyboard-mode never blocks |
| Existing character-consistency machinery drifts from sheet machinery | Identity Sheets carry `characterName` and consistency checks read both surfaces in a single pass |
| Smoke bloat (release-readiness-lite already runs 5 smokes) | New smoke is dry-run, completes in < 5s |
| Scope creep into "sheet templates" and "auto-generate sheets" | Explicitly deferred in non-goals; first-class mention in a follow-on list |

## Follow-on work (out of v1)

1. Promote `outfit-material`, `environment`, `motion-camera` to blocking enforcement
2. Auto-generate sheets from a brief via the Gemini `analyze-template` path
3. Reusable sheet library (`vclaw video reference-sheet-library` surface)
4. Sheet migration helper from existing characters
5. Visual preview cards via `video-thumbnail-lab`
6. Prompt-quality preflight that uses sheet bindings to score scene prompts
   (closes handbook anti-patterns #1 "adjective soup" and #6 "contradictory
   identity descriptions")

## Decisions record

**D1 — Reference sheets live beside characters, not replacing them.**
Rationale: keeps the existing cast-hydration, character-consistency, and
Go Bananas anchoring paths intact. An Identity Sheet can link to a character
by name to bridge the two systems.

**D2 — All 5 sheet types ship in v1; only Identity is wired into blocking
readiness. All 5 types participate in the three validation checks when
present.** Rationale: full data-model shape on day one, strictly additive for
existing projects, iterative promotion of remaining types to required-when-
applicable.

**D3 — Go Bananas references ship in v1.** References inside a sheet can be
either a local file path (`{ path, role }`) or a Go Bananas entity reference
(`{ gbRef: { kind, id }, role }`). Supported `kind` values: `character`,
`product`, `scene`, `style-preset`, `reference-group`. Rationale: the
`ReferenceEntry` union is ~10 LOC, CLI flag `--gb-ref` is another ~10, and
preflight already probes GB for characters — shipping without this would
force a v2 revision almost immediately.

**D4 — GB Products are modelled as extensions of the `outfit-material` role
vocabulary** (new roles: `product-hero`, `product-variant`, `product-in-use`,
`packaging`). Rationale: product shots are wardrobe-adjacent in practice; a
separate `product-showcase` sheet type would splinter the surface. Can promote
to its own sheet type later if UGC-campaign workflows grow into it.

**D5 — The repo keeps `environment` as the sheet type name; Go Bananas keeps
its `Scene` entity name.** Rationale: the naming collision is local (GB Scene
= reusable environment template; storyboard scene = beat-level unit). One GB
Scene can back N storyboard scenes. We document the distinction instead of
renaming either side.

## Addendum: Go Bananas integration

### The layer stack

```
Go Bananas record              ← canonical generation source of truth
       ▲ anchored by gbRef or gb-id
Character / Reference entry    ← repo-side anchor to a GB entity
       ▲ held inside
Reference Sheet                ← role-tagged bundle for a project
       ▲ bound to
Storyboard scene               ← beat-level unit with characters
```

### Entity mapping

| Repo sheet type | GB entity | Supported role(s) |
|---|---|---|
| `identity` | GB Character | `identity`, `wardrobe`, `silhouette`, `age-reference` |
| `outfit-material` | GB Product | `product-hero`, `product-variant`, `product-in-use`, `packaging` |
| `environment` | GB Scene | `location`, `set-dressing`, `weather`, `time-of-day` |
| `palette-mood` | GB Style Preset | `palette`, `composition`, `mood`, `lighting-reference` |
| *(any type)* | GB Reference Group | any role valid for the sheet type |

### ReferenceEntry union (revised)

```typescript
export type ReferenceEntry =
  | { path: string; role: ReferenceRole; note?: string }
  | { gbRef: GbRef; role: ReferenceRole; note?: string };

export type GbRef = {
  kind: 'character' | 'product' | 'scene' | 'style-preset' | 'reference-group';
  id: number;
};
```

Schema (JSON Schema) uses `oneOf` with two alternatives mirroring the union.

### CLI surface

Extend `reference-sheet-add` with an additional flag alongside `--ref`:

```bash
--gb-ref <kind>:<id>:<role>[:<note>]
```

Examples:

```bash
--gb-ref character:247:identity
--gb-ref scene:15:location
--gb-ref style-preset:3:palette
--gb-ref product:88:product-hero
--gb-ref reference-group:42:motion-rhythm
```

### Preflight resolution

When `GO_BANANAS_API_KEY` is set, `director-preflight` resolves every `gbRef`
in every sheet against the GB API:

- `kind: character` → uses the existing character-probe path
- `kind: product|scene|style-preset|reference-group` → uses the respective GB
  `get_*` surface
- Unresolved entities become a blocking preflight issue:
  `reference-sheet-orphan-gb-ref` with the sheet id, entry index, and GB kind/id

### No Go Bananas-side changes required

GB already exposes all five entity types with `create_*`, `list_*`, `get_*`
APIs. V1 is repo-side only.

## File list

### New

- `schemas/video/artifacts/reference-sheets.schema.json`
- `src/video/reference-sheets.ts`
- `src/video/reference-sheet-store.ts`
- `src/tests/reference-sheets.test.ts`
- `src/tests/cli-reference-sheets.test.ts`
- `scripts/smoke-reference-sheets.mjs`
- `docs/REFERENCE_SHEETS.md`

### Modified

- `src/cli/vclaw.ts` (add five subcommands + help text)
- `src/video/types.ts` (new types)
- `src/video/readiness.ts`
- `src/video/director-preflight.ts`
- `src/video/doctor.ts`
- `src/video/doctor-portfolio.ts`
- `src/video/status.ts`
- `src/video/project-index.ts`
- `src/video/report.ts`
- `src/video/csv-export.ts`
- `src/video/obsidian-export.ts`
- `src/video/storyboard-markdown.ts`
- `src/index.ts`
- `docs/ARCHITECTURE.md`
- `docs/CLI_REFERENCE.md`
- `docs/MASTER_PLAN_ALIGNMENT.md`
- `README.md`
- `package.json` (add `smoke:reference-sheets` script)
- `scripts/check-release-readiness-lite.sh` (add smoke)

## Shipping checklist

1. `npm test` green
2. `npm run check:release-readiness-lite` green (includes the new smoke)
3. `npm run check:cleanroom-docs` green
4. Agent-facing docs (`CLAUDE.md`, `AGENTS.md`) reference the new concept
   where relevant
5. PR description carries the design-doc link
