---
name: video-release-readiness
description: Release-readiness workflow for vclaw-video-core. Use when preparing a local source checkout, package dry-run, npm release handoff, or verification report for the video CLI, Review UI, skills, docs, and generated-artifact boundaries.
---

# Video Release Readiness

Use this skill when the repo needs a release handoff, packaging check, or
confidence report. This is a verification workflow, not a publish command.

Do not publish to npm, Homebrew, GitHub releases, or any external production
channel unless the user explicitly asks for that external action.

## Release Gate

Run the fast all-in-one local gate first:

```bash
npm run check:release-readiness-lite
```

That gate should build once, run the Node test suite, execute the main smoke
checks, run the isolated image-storyboard E2E, and verify release guardrails.

If the change is narrower, keep the focused checks as supporting evidence:

```bash
npm run build
npm test
npm run check:cleanroom-docs
npm run check:skill-frontdoor
npm pack --dry-run --json
git diff --check
```

## Package Shape

Before a handoff, prove the package ships:

1. `dist/cli/`
2. `dist/video/`
3. `tmp/review-station/index.html`
4. `docs/*.md` and `docs/assets/*`
5. `schemas/`
6. `skills/README.md`, `skills/catalog.json`, and `skills/*/SKILL.md`

Also prove it excludes:

1. `projects/`
2. `src/tests/`
3. `dist/tests/`
4. generated `.tgz` archives
5. local verification output such as `.playwright-mcp/` and `outputs/`

## Review Truth

Release readiness must preserve the same publish truth everywhere:

1. `review-report.json` has `verdict: "pass"`
2. `review-report.json` has `metrics.publishReady: true`
3. `status`, `doctor-project`, `next-actions`, Review UI, CSV, and Obsidian
   surfaces derive from that same truth

If a UI label, CLI next action, or report field disagrees, treat it as a release
blocker until the canonical artifact or derived surface is fixed.

## Source Checkout Vs Installed CLI

When verifying from this repo, use source checkout commands:

```bash
node dist/cli/vclaw.js video providers
node dist/cli/vclaw.js video plan --project <slug>
```

When writing installed-user handoff docs, use:

```bash
vclaw video providers
vclaw video plan --project <slug>
```

Do not mix these two contexts without explaining the difference.

## Evidence To Report

Report concise evidence:

1. changed files
2. checks run and pass/fail status
3. package dry-run inclusion/exclusion result
4. Review UI and CLI truth-alignment result when relevant
5. remaining risks or untested external-production paths
