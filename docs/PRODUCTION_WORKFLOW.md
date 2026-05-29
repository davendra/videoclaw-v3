# Production Workflow

VideoClaw should feel like one reliable production workflow, not a catalog of
commands. Keep the advanced command surface available, but introduce users
through these three doors.

For human operators, start with `vclaw studio --dry-run`. It maps goals like
presenter video, UGC campaign, music video, copy-reference, review, and publish
to the deterministic CLI commands described below.

The matching workflow skills are:

1. `video-production-handoff` for one project from creation into review and
   publish handoff.
2. `video-review-ui-qa` for browser review, mobile/desktop QA, and Review UI to
   CLI truth alignment.
3. `video-portfolio-ops` for multi-project reports, CSV/Obsidian handoff, and
   operator queues.
4. `video-release-readiness` for package-shape, generated-artifact, and release
   verification evidence.

For a short runbook that can be handed to an operator, use
[`OPERATOR_HANDOFF.md`](./OPERATOR_HANDOFF.md).

## 1. Make A Campaign Video

Use this when the operator has an intent and needs a reviewed, provider-ready
short-form video project.

```bash
vclaw video create "A 20s product story for ..." --project <slug> --production-mode director

# Choose one review path.
vclaw video review-ui --project <slug>

# Or, when completed storyboard still candidates already exist:
vclaw video review-autopilot --project <slug>

vclaw video status --project <slug>
```

`review-ui` serves the packaged Review UI by default, so installed CLI users do
not need a source checkout or a project-local `tmp/review-station/index.html`.
Reserve `--ui-path` for testing a local replacement UI. `review-autopilot` is
the non-interactive counterpart: use it instead of browser review only when the
project already has completed storyboard still candidates and the operator wants
the agent to lock the handoff.

The expected result is a project with a brief, storyboard, locked stills,
artifact-backed 4K handoff assets, a passing review report, and one clear next
action. The system must not claim a publish handoff until `review-report.json`
has `verdict: "pass"` and `metrics.publishReady: true`.

## 2. Review And Fix A Project

Use this when a project exists but the operator is unsure whether it is safe to
continue.

```bash
vclaw video status --project <slug>
vclaw video next-actions
vclaw video doctor-project --project <slug>
vclaw video review-ui --project <slug>
```

Trust order:

1. `status` tells the current stage and stale review state.
2. `next-actions` tells the highest-priority human or agent action.
3. `doctor-project` verifies artifacts and checkpoints.
4. `review-ui` is the visual station for fixing images, references, 4K assets,
   and final assembly checks.

If these disagree, treat it as a product bug and fix the canonical artifact or
derived next-action logic before continuing.

## 3. Manage A Portfolio

Use this when multiple video projects are in flight.

```bash
vclaw video metrics
vclaw video report
vclaw video export-csv
vclaw video sync-obsidian
```

Portfolio views should communicate production truth for non-technical operators:
what is blocked, what needs review, what is stale, what is ready to publish, and
where spend or provider risk is accumulating. CSV exports include
`reviewReportVerdict` and `reviewPublishReady` so spreadsheet handoffs can filter
on the same review truth as the CLI and Review UI.

For release handoff, keep source checkout commands and installed CLI commands
separate. In this repository, use `node dist/cli/vclaw.js ...` only after
building. Installed users should see `vclaw ...` examples.

## Authoring aid: multi-shot prompts

For a compressed cinematic clip, `vclaw video multi-shot` scaffolds a timecoded,
non-repeating-camera shot plan (`cinematic-15s`, `seedance-10s`, `veo-8s`, or
`runway-10s`), validates the hard rules (char budget, contiguous timecodes,
metadata block), and can author prose end-to-end with `--auto`:

```bash
vclaw video multi-shot --plan                       # timecode scaffold + camera grid
vclaw video multi-shot --validate --file prompt.txt # enforce the rules (nonzero exit on error)
vclaw video multi-shot --plan --from-storyboard --project demo --scene 0 --route seedance-direct
```

It can run standalone, or hydrate action/characters/location defaults from a
project storyboard scene with `--from-storyboard`. Project status/readiness
summarize the latest persisted `multi-shot-prompt` artifact for review.
Full reference: [`docs/CLI_REFERENCE.md`](./CLI_REFERENCE.md#multi-shot-prompt).

## Production Readiness Rules

- One source of truth: review handoff readiness comes from `review-report.json`.
- Simple review command rule: `video review --verdict pass` is for projects that
  already have equivalent review evidence outside the Review UI. Director image
  handoffs should use `review-ui` or `review-autopilot` so publish readiness is
  derived from locked stills, artifact-backed 4K assets, and final approvals.
- No stale approval: if storyboard content changed after `storyboard.md`, refresh
  the storyboard review before execution.
- No marker-only handoff: a 4K/upscaled still must be an artifact-backed scene
  candidate, not just a browser marker.
- Keep verification output separate from source: local `outputs/`,
  `.playwright-mcp/`, nested project `outputs/`, and Review UI screenshots
  should remain ignored unless a fixture update is explicitly intentional.
- No hidden provider switch: provider routes fail hard instead of silently
  falling back.
- Every user-facing surface should give the same next action for the same
  project state.
