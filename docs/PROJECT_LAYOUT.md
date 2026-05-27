# Project Layout

This doc describes the canonical on-disk structure of a `videoclaw`
project — the unit `vclaw video init <slug>` creates and every
downstream stage operates on.

## Slug rules

Enforced at `vclaw video init` time:

| Rule | Constraint |
|---|---|
| Allowed chars | `[a-z0-9-]` |
| Must start with | `[a-z0-9]` (not `-`) |
| Must end with | `[a-z0-9]` (not `-`) |
| Length | 3–64 chars |
| Disallowed substrings | `--`, leading `.`, reserved names (`history`, `artifacts`, `checkpoints`, `events`, `state`, `outputs`, `assets`, `obsidian`, `characters`, `notes`, `tmp`) |
| Argv guard | Reject anything that looks like a flag (`^-`). Prevents the historical bug where `vclaw video init --project foo` parsed `--project` as the slug. |

Recommended slug template when the user doesn't provide one:
`<yyyy-mm-dd>-<noun>-<noun>` (e.g., `2026-05-25-disco-monster`).

## Canonical layout

```
projects/<slug>/
│
├── project.json                # MANIFEST (see "project.json v2" below)
├── storyboard.md               # Director-mode human-readable approval doc
│                                 (absent in storyboard-mode until storyboard
│                                 stage)
│
├── artifacts/                  # CANONICAL machine-readable outputs.
│   │                             JSON only. Every file MUST have a schema
│   │                             in schemas/video/artifacts/.
│   ├── brief.json
│   ├── storyboard.json
│   ├── asset-manifest.json
│   ├── scene-candidates.json
│   ├── scene-selection.json
│   ├── reference-sheets.json
│   ├── execution-plan.json
│   ├── execution-report.json
│   ├── review-report.json
│   ├── publish-report.json
│   ├── analyze-output.json
│   ├── clone-plan.json
│   ├── multi-shot-prompt.json  # Written only when `vclaw video multi-shot
│   │                             --project <slug>` is used; absent for
│   │                             standalone (no --project) invocations.
│   └── history/                # Snapshots of artifacts/ files on overwrite.
│                                 Append-only. One subdir per artifact:
│                                 history/brief/<ts>.json.
│
├── checkpoints/                # ONE FILE per stage. Tracks approval state,
│   ├── brief.json                who approved when, retry count, verdict.
│   ├── storyboard.json
│   ├── assets.json
│   ├── review.json
│   └── publish.json
│
├── characters/                 # CANONICAL identity store for this project.
│   └── characters.json
│
├── events/                     # Append-only timeline. JSONL.
│   └── events.jsonl              Payloads use project-relative paths only.
│
├── notes/                      # Human-authored or model-authored MD.
│   │                             Free-form. Anything NOT a canonical
│   │                             JSON artifact lives here.
│   └── (markdown files)
│
├── outputs/                    # DERIVED. Final encoded media only.
│   ├── final/<slug>-<mode>.mp4   Created by publish stage.
│   ├── scene-0.mp4               Per-scene renders.
│   ├── scene-1.mp4
│   └── ...                       (Gitignored at project level.)
│
├── assets/                     # DERIVED. Intermediate visual assets.
│   ├── storyboard/               Per-scene stills.
│   ├── upscaled/                 Upscaled variants.
│   └── ...                       (Gitignored.)
│
├── obsidian/                   # DERIVED. Mirror of canonical artifacts
│                                 in Obsidian-friendly MD. Created by
│                                 `vclaw video obsidian-export`.
│                                 (Gitignored.)
│
└── .vclaw/                     # HIDDEN. Everything ephemeral/cache/runtime.
    ├── cache/
    │   └── upload-cache.json
    ├── jobs/
    │   └── seedance-<ts>.json
    └── state/
                                  (Gitignored.)
```

## Directory disposition

| Directory | Always-present on init | Schema-enforced | Gitignored at project level |
|---|---|---|---|
| `project.json` | yes | yes | no (commit) |
| `storyboard.md` | director-mode only | n/a (free-form) | no |
| `artifacts/` | yes (empty) | **yes — every file** | no |
| `artifacts/history/` | on first overwrite | yes | no |
| `checkpoints/` | yes (empty) | yes (per-stage shape) | no |
| `characters/` | yes (empty) | yes (characters.json shape) | no |
| `events/` | yes (empty `events.jsonl`) | line shape enforced | no |
| `notes/` | on demand | no (MD) | no |
| `outputs/` | on demand | n/a (media) | **yes** |
| `assets/` | on demand | n/a (media) | **yes** |
| `obsidian/` | opt-in command | n/a (MD mirror) | **yes** |
| `.vclaw/` | on demand | internal | **yes** |

## Project-level `.gitignore` template

`vclaw video init` writes this `.gitignore` inside each new project:

```gitignore
# Derived media — re-generable from canonical artifacts
/outputs/
/assets/
/obsidian/

# Ephemeral / cache / runtime state
/.vclaw/

# OS noise
.DS_Store
```

`artifacts/`, `checkpoints/`, `characters/`, `events/`, `notes/`,
`project.json`, `storyboard.md` are **committed by design** so a
project is reproducible from its canonical state.

## `project.json` v2 shape

```json
{
  "schemaVersion": 2,
  "slug": "fresh-proof",
  "productionMode": "director",
  "pipelineRef": "director@1.0.0",
  "createdAt": "2026-05-06T02:20:19.421Z",
  "updatedAt": "2026-05-07T02:08:17.235Z",
  "createdBy": {
    "cli": "vclaw",
    "version": "0.12.0"
  },
  "currentStage": null,
  "lastCompletedStage": "publish",
  "lastCheckpointStatus": "completed",
  "tags": ["proof", "internal-test"],
  "metadata": {}
}
```

Notable v2 changes from the older `videoclaw` shape:

- `schemaVersion: 2` — explicit version marker so migration code knows
  what it's reading.
- `pipelineRef: "director@1.0.0"` — references a named pipeline manifest
  in `src/video/pipeline-manifests/` instead of embedding the full
  ~80-line pipeline spec in every project.json. A project can re-run
  against a new pipeline version by bumping the ref.
- `createdBy` — captures the CLI version that scaffolded the project.
  `vclaw video doctor`-style commands can use this to flag projects
  created with older CLI versions that may benefit from migration.
- `tags` + `metadata` — promoted from informal fields to first-class
  schema fields for `vclaw video index` filtering.

## Event log v2 shape

`events.jsonl` lines follow this envelope:

```jsonl
{"id":"01HK7Z...","type":"artifact.review-report.written","recordedAt":"2026-05-06T21:54:52.404Z","source":"review-ui","payload":{"artifactPath":"artifacts/review-report.json","verdict":"pass"}}
```

Key rules:

1. `id` — a ULID per event. Used for de-dup on read.
2. `source` — always in the envelope, never inside payload.
3. `payload.artifactPath` — **project-relative only.** Never absolute.
   A reader that sees an absolute path is reading a v1 event and
   should migrate-on-read.

## Migrating a v1 project to v2

```bash
vclaw video migrate-project --project <slug>
```

The migrator:

1. Reads the v1 `project.json` and hashes the embedded pipeline
   definition against the canonical pipelines in
   `src/video/pipeline-manifests/`.
2. If it matches a canonical (e.g., `director@1.0.0`), writes back the
   v2 shape with the matching `pipelineRef`.
3. If it doesn't match, writes the embedded pipeline to
   `src/video/pipeline-manifests/<slug>-custom.json` with a warning
   that the project uses a custom pipeline.
4. Adds `schemaVersion: 2`, `createdBy: { cli: "vclaw", version: "0.12.0" }`,
   `tags: []`, `metadata: {}` if absent.
5. Migrates `events.jsonl` lines: ensures every line has `id` (generates
   ULIDs for legacy lines that lack one), rewrites absolute
   `payload.artifactPath` to project-relative.

## Artifact schema coverage guardrail

The build pipeline includes `check:artifact-schema-coverage`
(`scripts/check-artifact-schema-coverage.mjs`), which asserts:

1. Every artifact name passed to `writeArtifact(workspace, '<name>', ...)`
   in `src/video/**/*.ts` has a matching
   `schemas/video/artifacts/<name>.schema.json`.
2. Every schema in `schemas/video/artifacts/` has either a matching
   `writeArtifact()` call OR is in the script's
   `KNOWN_ALTERNATE_WRITERS` allowlist (audit-pending; some artifacts
   are written via specialized helpers rather than the typed
   `writeArtifact()` shim).

**Modes:**

- Default (advisory) — prints any drift but always exits 0. This is
  what `check:release-readiness-lite` invokes, so the guardrail
  reports status inline without blocking the release-readiness
  pre-flight while the allowlist is being burned down.
- `--strict` — exits 1 on drift. Wire into CI gates / pre-commit hooks
  when you want hard enforcement. Currently zero unexpected drift
  with the allowlist applied.

Current allowlist (9 schemas needing per-artifact audit): `analyze-output`,
`clone-plan`, `execution-plan`, `multi-shot-prompt`, `publish-report`,
`reference-sheets`, `review-report`, `scene-candidates`, `scene-selection`.
The audit work is tracked in `MERGE_PLAN.md` §A2.

## Slug validation implementation

The slug rules above are enforced by `validateInitSlug()` in
`src/cli/vclaw.ts`, called from the `init` command before any
filesystem operation. Test coverage in
`src/tests/cli-init-slug-validation.test.ts` (6 cases):

1. rejects `--project` as the slug (the historical argv-as-slug bug)
2. rejects uppercase / whitespace / dots / underscores / leading dots / leading dashes
3. rejects reserved per-project directory names
4. rejects consecutive `--`
5. rejects too-short / too-long
6. accepts a well-formed slug (`2026-05-25-disco-monster`)

Each failure mode has a distinct error message; the argv-as-slug case
explicitly names the bug to make the fix discoverable.
