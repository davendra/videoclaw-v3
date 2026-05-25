---
name: video-production-handoff
description: Production handoff workflow for vclaw-video-core projects. Use when a video project needs to move from create/storyboard/assets into Review UI, review-autopilot, status, doctor-project, publish readiness, or operator handoff with canonical review-report truth.
---

# Video Production Handoff

Use this skill when the operator or agent needs to decide whether a VideoClaw
project is ready for execution, review, publish, or the next human handoff.

This is a workflow skill, not a command wrapper. Prefer it after
`video-framework`, `director-video`, or `video-storyboard` has created or
updated a project.

## Core Rule

Publish handoff is ready only when `review-report.json` has:

1. `verdict: "pass"`
2. `metrics.publishReady: true`

Do not infer readiness from local UI checkboxes, a stale checkpoint, a publish
artifact, or a legacy pass verdict without `metrics.publishReady`.

## Standard Flow

```bash
vclaw video status --project <slug> [--root <path>]
vclaw video next-actions [--root <path>]
vclaw video doctor-project --project <slug> [--root <path>]
```

If the project needs visual handoff decisions:

```bash
vclaw video review-ui --project <slug> [--root <path>]
```

If completed storyboard still candidates already exist and the operator wants an
agent-driven handoff:

```bash
vclaw video review-autopilot --project <slug> [--root <path>]
```

Then verify the same truth from the CLI:

```bash
vclaw video status --project <slug> [--root <path>]
vclaw video doctor-project --project <slug> [--root <path>]
vclaw video plan --project <slug> [--root <path>]
```

## Review Path Selection

- Use `review-ui` when a human needs to inspect or fix storyboard stills,
  character references, artifact-backed 4K handoff assets, or final assembly
  checks.
- Use `review-autopilot` only when completed storyboard still candidates already
  exist and an agent should lock the best available handoff.
- Use `video review --verdict pass` only when equivalent review evidence already
  exists outside the browser station.

## Expected Outputs

Successful production handoff should leave:

1. `projects/<slug>/artifacts/review-ui-ledger.json`
2. `projects/<slug>/artifacts/scene-selection.json`
3. `projects/<slug>/artifacts/post-plan.json`
4. `projects/<slug>/artifacts/review-report.json`
5. checkpoint state that makes `status` and `doctor-project` agree

For portfolio handoff, also use:

```bash
vclaw video metrics [--root <path>]
vclaw video report [--root <path>]
vclaw video export-csv [--root <path>]
vclaw video sync-obsidian [--root <path>]
```

CSV and Obsidian surfaces should expose the same `reviewReportVerdict` and
`reviewPublishReady` truth as `status`.

## Verification

Before reporting production readiness, run the smallest proof that covers the
change:

```bash
npm run check:release-readiness-lite
```

For docs-only or skill-only edits, also run:

```bash
npm run check:cleanroom-docs
npm pack --dry-run --json
git diff --check
```

Keep generated verification artifacts separate from source changes. Local
`outputs/`, `.playwright-mcp/`, Review UI screenshots, nested project outputs,
and `.tgz` package archives should stay ignored unless a fixture refresh is
explicitly intentional.

## Stop Conditions

Stop and report a blocker only when:

1. `doctor-project` reports malformed or missing canonical artifacts that cannot
   be repaired from local context.
2. provider execution would require external production action or credentials.
3. the next step is destructive, such as deleting a project, clearing outputs, or
   publishing to npm/Homebrew.
