---
name: video-portfolio-ops
description: Portfolio operations workflow for vclaw-video-core. Use when managing multiple video projects, reporting blocked work, exporting CSV/Obsidian dashboards, assigning metadata, or checking portfolio-level review and publish readiness.
---

# Video Portfolio Ops

Use this skill when the question is about the whole production slate rather than
one project. It turns the advanced reporting commands into a repeatable operator
loop.

## Daily Operator Loop

```bash
vclaw video metrics [--root <path>]
vclaw video next-actions [--root <path>]
vclaw video doctor-portfolio [--root <path>]
vclaw video report [--root <path>]
vclaw video report-snapshot [--root <path>]
vclaw video sync-obsidian [--root <path>] [--output-dir <path>]
```

Use `metrics` for the headline, `next-actions` for the work queue,
`doctor-portfolio` for health, `report` for machine-readable state, snapshots
for history, and Obsidian sync for the human dashboard.

## Spreadsheet Handoff

```bash
vclaw video export-csv [--root <path>] [--output-dir <path>]
```

CSV exports must carry the same project truth as the CLI:

1. `reviewReportVerdict`
2. `reviewPublishReady`
3. stale review state
4. next stage
5. owner, priority, due date, tags, blockers, and blocked reason

Do not tell an operator that a project is ready to publish unless the exported
state agrees with `status` and `review-report.json`.

## Triage And Ownership

Use metadata to make the queue actionable:

```bash
vclaw video set-meta --project <slug> \
  --owner <name> \
  --priority high \
  --due YYYY-MM-DD \
  --tag <value> \
  --blocked-by <slug> \
  --blocked-reason "<reason>"
```

Then rerun:

```bash
vclaw video workload [--root <path>]
vclaw video dependencies [--root <path>]
vclaw video next-actions [--root <path>]
```

## History And Change Review

For portfolio reviews, create and compare snapshots:

```bash
vclaw video report-snapshot [--root <path>]
vclaw video report-history [--root <path>]
vclaw video report-diff [--root <path>] --from <snapshot-path> --to <snapshot-path>
vclaw video trends [--root <path>]
```

Use this when proving whether a release, cleanup pass, or production push
improved the slate instead of only changing one project.

## Blockers

Escalate only when the next action needs an external provider, irreversible
deletion/archive cleanup, or publishing outside the repo. Otherwise, repair the
local artifact, metadata, or docs path and rerun the loop.
