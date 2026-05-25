# Operations

## Canonical project flow

1. `video init`
2. `video brief`
3. `video storyboard`
4. `video assets`
5. `video review-ui` or `video review-autopilot` for production handoff; `video review --verdict pass` only when equivalent review evidence already exists
6. `video publish`

Publish handoff is canonical only when `review-report.json` has
`verdict: "pass"` and `metrics.publishReady: true`.

## Recommended maintenance loop

1. Run `vclaw video metrics`
2. Run `vclaw video next-actions`
3. Run `vclaw video doctor-portfolio`
4. Run `vclaw video report-snapshot`
5. Run `vclaw video sync-obsidian`
6. Run `npm run smoke:runtime` after meaningful runtime changes
7. Run `npm run smoke:native-veo` after changing the built-in `veo-direct` path
8. Run `npm run smoke:character-hydration` after changing create-time cast hydration or approval-gate cost behavior
9. Run `npm run smoke:execution-cancel` after changing adapter cancel behavior or the project-level cancel path
10. Run `npm run smoke:portfolio` after changing index/report/CSV visibility
11. Run `npm run check:omx-alias` after touching alias/deprecation behavior
12. Run `npm run check:movie-director-wrappers` after editing bundled Director helper scripts
13. Run `npm run check:cleanroom-docs` after editing clean-room-facing docs and skills
14. Run `npm run check:skill-frontdoor` after editing repo-local skill `SKILL.md` files
15. Run `npm run check:artifact-schema-coverage` after editing JSON Schemas under `schemas/video/` or canonical artifact contracts
16. Use `npm run check:release-readiness-lite` when you want the fast all-in-one local verification bundle, including the isolated image-storyboard E2E

## Management views

1. `metrics`: counts, rates, score averages
2. `workload`: owner-by-owner project load
3. `next-actions`: actionable queue ordered by urgency
4. `dependencies`: blocker graph
5. `report`: full machine-readable portfolio state
6. `report-diff`: compare portfolio snapshots
7. `trends`: historical trend points

## Health model

Use these commands together:

1. `doctor-project` for one project
2. `doctor-portfolio` for all projects
3. `readiness` to understand whether a project has the minimum artifacts required to move toward runtime execution
4. `plan` to confirm the selected provider route
5. `produce --dry-run` to validate the payload shape before live submission
6. `produce` with a configured adapter to submit live work while keeping the assets stage `pending`
7. `execute-status` to poll the adapter, ingest outputs, and advance the project to `review`
8. `execute-cancel` to attempt to cancel an in-flight live job and mark the assets stage failed with an explicit operator action trail
9. For `seedance-direct` and `veo-direct`, prefer the built-in adapter path first and configure only `..._SUBMIT_CMD` / `..._POLL_CMD` / `..._CANCEL_CMD` unless you need a full custom adapter override
10. For `seedance-direct`, you can now skip command shims entirely and rely on `SUTUI_API_KEY` plus the built-in native transport
11. `clone-execute` is the shortest path for template-driven text-to-video work when you want clone planning and runtime execution in one command
12. Use `set-execution-profile` when you need to retune ratio/quality/audio/outputs after the brief is already written
13. Use `status`, `report`, `export-csv`, and Obsidian sync to verify the active execution profile, prompt guidance, review verdict, and publish-ready truth before expensive runs
14. Use `cost-estimate` before live execution; it uses static defaults until completed Seedance USD telemetry exists, then reports `estimateSource: "historical-telemetry"`
15. Inspect `projects/<slug>/events/events.jsonl` for `generation.telemetry.recorded` events when debugging provider costs, timings, failed polls, or output-ingest counts

## Generation telemetry

Live and dry-run execution append `generation.telemetry.recorded` events to the
project event ledger. Submitted runs record route, task, prompt, duration, and
reference-count metadata. Poll refreshes record pending/completed/failed status,
output counts, provider cost fields, provider timing fields, and issues.

Only completed `seedance-direct` records with provider-reported USD are used as
cost-estimate samples. Credits are stored as telemetry but not converted to USD.

Full guide: [`docs/GENERATION_TELEMETRY.md`](./GENERATION_TELEMETRY.md).

`execution-plan` and `execute` remain available as compatibility aliases over
`plan` and `produce`.

## Project metadata expectations

Recommended project metadata:

1. `owner`
2. `priority`
3. `dueDate`
4. `tags`
5. `blockedBy`
6. `blockedReason`

## Reports and snapshots

1. `report` gives the current full state
2. `report` includes execution profile and prompt guidance when available
3. `report-snapshot` persists the current state to `reports/history/`
4. `report-history` lists snapshots
5. `report-diff` compares snapshots
6. `export-csv` writes spreadsheet-friendly exports

## Reproducible smoke

Use:

```bash
npm run smoke:runtime
npm run smoke:native-veo
npm run smoke:character-hydration
npm run smoke:execution-cancel
npm run smoke:portfolio
npm run smoke:reference-sheets
npm run smoke:scene-candidates
npm run check:omx-alias
npm run check:movie-director-wrappers
npm run check:cleanroom-docs
npm run check:skill-frontdoor
npm run check:artifact-schema-coverage
```

This validates the documented local happy path and prints the generated machine-readable
artifacts so runtime regressions are easier to spot than with tests alone.

For a packaged one-command pass that builds once, runs the Node suite once, and
then executes the main smokes, isolated image-storyboard E2E, and guardrails:

```bash
npm run check:release-readiness-lite
```
