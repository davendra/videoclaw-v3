---
name: video-review-ui-qa
description: Review UI QA workflow for vclaw-video-core. Use when changing or validating the local Review UI, storyboard handoff, review-autopilot, browser behavior, mobile/desktop layout, or CLI alignment for review-report publish readiness.
---

# Video Review UI QA

Use this skill when the Review UI, review ledger, storyboard still selection, 4K
handoff assets, or browser review workflow changes.

## Canonical Truth

The UI must agree with CLI truth:

1. `review-report.json` with `verdict: "pass"`
2. `review-report.json` with `metrics.publishReady: true`
3. artifact-backed scene candidates for selected/upscaled stills
4. final assembly approvals when publish readiness requires them

Do not treat UI-only markers or stale checkpoints as publish readiness.

## Local Review Flow

```bash
vclaw video review-ui --project <slug> [--root <path>]
```

Use `--dry-run` to verify server configuration without starting the browser
station:

```bash
vclaw video review-ui --project <slug> [--root <path>] --dry-run
```

Use the non-interactive path only when completed storyboard still candidates
already exist:

```bash
vclaw video review-autopilot --project <slug> [--root <path>]
```

## QA Matrix

Verify representative states:

1. no review report yet
2. stale storyboard review
3. failed or retry review
4. passed review without `metrics.publishReady`
5. passed review with publish readiness

For each state, compare:

```bash
vclaw video status --project <slug> [--root <path>]
vclaw video next-actions [--root <path>]
vclaw video doctor-project --project <slug> [--root <path>]
```

The visible Review UI action, CLI `nextStage`, doctor findings, and portfolio
report fields should all describe the same next step.

## Visual Verification

After frontend changes, verify desktop and mobile:

1. no console errors
2. no overlapping controls or clipped labels
3. first blocking gate is clear
4. selected stills, rejected stills, and artifact-backed 4K assets are visually
   distinguishable
5. the handoff side panel reflects the same `review-report.json` status as the
   CLI

When the change touches the generated portal surfaces (`vclaw video portal
--surface edit|review|client-review|preview`), also verify:

6. clicking any production image opens it full screen (lightbox), and `Esc`/
   click-outside closes it — every production `<img>` must carry
   `data-lightbox-group`
7. on the `preview` surface, a discovered project soundtrack renders an inline
   `<audio>` player, and a project with no audio renders no player (no broken
   element)
8. per-video download controls work and point at the correct asset

Keep screenshots and browser session files as generated verification artifacts;
do not add them to the source diff unless intentionally updating fixtures.

## Regression Checks

Run the focused checks first when possible:

```bash
npm run build
node --test dist/tests/review-ui.test.js dist/tests/cli-review-ui.test.js
```

Before release handoff, run:

```bash
npm run check:release-readiness-lite
git diff --check
```
