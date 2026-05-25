# Operator Handoff

Use this when handing `videoclaw` to someone who needs to run the video
workflow, review work, or understand whether a project is safe to publish.

Installed CLI examples use `vclaw`. In a source checkout, run `npm run build`
first and replace `vclaw` with `node dist/cli/vclaw.js`.

## The Four Workflows

1. `video-production-handoff` moves one project from intent to review and
   publish handoff.
2. `video-review-ui-qa` checks browser review, mobile/desktop behavior, and CLI
   alignment.
3. `video-portfolio-ops` manages multiple projects, reports, CSV, and Obsidian
   dashboards.
4. `video-release-readiness` proves the repo/package is ready for handoff.

These are workflow skills, not replacements for CLI commands. The command
surface stays the same; the skills tell operators which commands to use and in
what order.

## 1. Start A Project

```bash
vclaw video create "A 20s product story for ..." --project <slug> --production-mode director
vclaw video status --project <slug>
vclaw video plan --project <slug>
```

The expected result is a project with canonical JSON artifacts under
`projects/<slug>/artifacts/` and a clear next stage. If `plan` is blocked, use
the blocker text directly; do not switch provider routes silently.

## 2. Review The Work

Use the browser station when a human needs to inspect stills, references, 4K
handoff assets, or final assembly checks:

```bash
vclaw video review-ui --project <slug>
```

Use the non-interactive path only when completed storyboard still candidates
already exist:

```bash
vclaw video review-autopilot --project <slug>
```

After either path, verify CLI truth:

```bash
vclaw video status --project <slug>
vclaw video next-actions
vclaw video doctor-project --project <slug>
```

Publish handoff is ready only when `review-report.json` has both:

1. `verdict: "pass"`
2. `metrics.publishReady: true`

A stale checkpoint, marker-only 4K flag, or legacy pass report without
`metrics.publishReady: true` is still review work.

## 3. Manage The Portfolio

```bash
vclaw video metrics
vclaw video next-actions
vclaw video doctor-portfolio
vclaw video report
vclaw video export-csv
vclaw video sync-obsidian
```

The CSV and Obsidian handoff should expose the same review truth as `status`:
`reviewReportVerdict` and `reviewPublishReady`. If portfolio output disagrees
with `doctor-project` or the Review UI, treat that as a product bug before
spending provider time.

## 4. Release Check

Before handing off a repo build or package candidate:

```bash
npm run check:release-readiness-lite
npm pack --dry-run --json
git diff --check
```

The package dry-run must include docs, schemas, `dist/cli/`, `dist/video/`, the
bundled Review UI, and shipped skills. It must exclude `projects/`, test output,
generated verification artifacts, and `.tgz` archives.

## What To Report

For a clean handoff, report:

1. project slug and current next action
2. review verdict and `reviewPublishReady` value
3. any doctor blockers
4. portfolio export location if produced
5. verification commands run and whether they passed

Do not publish externally, delete projects, clear outputs, or run paid provider
work unless that action is explicitly approved for the current handoff.
