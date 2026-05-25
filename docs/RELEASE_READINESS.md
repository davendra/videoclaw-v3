# Release Readiness

## Purpose

This document captures the current go-live evidence for `videoclaw` and
the remaining non-blocking gaps before it is treated as the default runtime lane.

## Current evidence

Latest verification on 2026-05-09:

1. `npm run check:release-readiness-lite` passed, including the isolated
   image-storyboard E2E.
2. `npm run e2e:image-storyboard` passed from an isolated temporary project root
   as a targeted replay.
3. Review readiness is now canonical across `status`, `next-actions`,
   `doctor-project`, and the Review UI: publish handoff is allowed only when
   `review-report.json` has `verdict: "pass"` and `metrics.publishReady: true`.
4. The image-storyboard E2E no longer mutates the tracked
   `projects/e2e-proofy-image-storyboard` fixture unless a caller explicitly
   passes `--root`.
5. The release-readiness-lite guard checks that generated verification paths
   such as local `outputs/`, `.playwright-mcp/`, nested project `outputs/`, and
   Review UI screenshots remain ignored.
6. Package dry-run evidence confirms release docs, demo assets, the bundled
   Review UI, CLI output, schemas, and skills ship while project workspaces,
   tests, generated verification artifacts, and nested tarballs remain excluded.
7. Browser verification of the Review UI passed on desktop and mobile with zero
   console warnings/errors after the first-blocking-gate and artifact-backed 4K
   changes.
8. Repo-local workflow skills now expose the production operator lanes:
   `video-production-handoff`, `video-review-ui-qa`, `video-portfolio-ops`, and
   `video-release-readiness`.

Verified on 2026-04-20:

1. `vclaw` is the primary CLI surface.
2. `omx` works as a temporary compatibility alias and writes its notice to `stderr`.
3. The lifecycle surface exposes:
   - `brief`
   - `plan`
   - `produce`
   - `review`
   - `publish`
4. Compatibility aliases still work:
   - `execution-plan`
   - `execute`
5. Workflow aliases now exist for:
   - `analyze-template`
   - `clone-ad`
6. Canonical artifact contracts, provider status reporting, execution runtime,
   prompt guidance, playbooks, Obsidian sync, and character consistency checks
   are all present in the clean-room repo.
7. Repo-local workflow skills now exist for:
   - `video-analyze-template`
   - `video-clone-ad`
   - `video-storyboard`
   - `video-production-handoff`
   - `video-review-ui-qa`
   - `video-portfolio-ops`
   - `video-release-readiness`
8. Workspace video context bootstraps at `.omx/video-context.md` and mirrors
   into `.vclaw/video-context.md` when that path already exists.

## Verification state

Latest full-suite verification:

```bash
npm test
```

Result:

1. all `node:test` cases passing
2. `0` failing

Additional focused checks passed during the same implementation sequence:

1. alias and lifecycle CLI checks
2. video context bootstrap checks
3. runtime and native Veo smoke checks
4. portfolio visibility plus template/workflow alias checks
5. end-to-end `omx` alias lifecycle smoke
6. latest-HEAD runtime plus alias/workflow reruns

Release smoke commands:

1. `npm run smoke:runtime`
2. `npm run smoke:native-veo`
3. `npm run smoke:portfolio`

Most recent smoke evidence from this branch:

1. `npm run smoke:runtime`
   - `plan` selected `seedance-direct`
   - normalized execution profile surfaced as `9:16`, `quality`, `1080p`, audio off, outputs `2`
   - prompt guidance surfaced in both execution-plan and project status
   - dry-run advanced the sample project to `review`
   - Obsidian export completed successfully
2. `npm run smoke:native-veo`
   - built-in `veo-direct` submission succeeded
   - polling completed successfully
   - generated output ingested into the canonical asset manifest
   - project status advanced to `review`
   - captured Veo command still reflected the normalized settings: `-n 2`, `-r landscape`, `-m quality`
3. `npm run smoke:portfolio`
   - `plan` surfaced the expected blocked state when `asset-manifest` and a viable route were absent
   - portfolio index/report/export-csv completed successfully
   - project-facing report data still surfaced execution profile and prompt guidance
4. targeted CLI checks
   - `analyze-template` path passed
   - `clone-ad` path passed
   - `omx` alias help/provider checks passed
   - template create/show/validate flow passed
5. direct `omx` alias lifecycle smoke
   - `omx video init|brief|storyboard|assets|plan|produce --dry-run|status` completed successfully on a sample workspace
   - deprecation notices remained on `stderr`
   - `plan` selected `seedance-direct`
   - `produce --dry-run` returned `dry-run-complete`
   - `status` advanced the sample project to `review`
6. direct `vclaw` workflow-alias smoke
   - `vclaw video analyze-template` created the expected analyze artifact with title `Clone Reference`
   - `vclaw video template-create` plus `template-validate` succeeded and reported `valid: true`
   - `vclaw video clone-ad --dry-run` completed successfully
   - the clone flow selected `seedance-direct`
   - the clone dry-run emitted a canonical seed asset manifest path
7. direct `omx` workflow-alias smoke
   - `omx video analyze-template` created the expected analyze artifact with title `OMX Clone Reference`
   - `omx video template-create` plus `template-validate` succeeded and reported `valid: true`
   - `omx video clone-ad --dry-run` completed successfully
   - the clone flow selected `seedance-direct`
   - every compatibility-path command kept its deprecation notice on `stderr`
8. latest `HEAD` reruns
   - `npm run smoke:runtime` passed again on the current branch tip
   - the rerun again selected `seedance-direct`, preserved the `9:16 quality 1080p audio-off outputs-2` execution profile, and advanced the sample project to `review`
   - the focused alias/workflow test bundle passed again: `cli-init-analyze`, `cli-clone-execute`, `cli-providers`, and `cli-templates`
9. latest `HEAD` native Veo reruns
   - `npm run smoke:native-veo` passed again on the current branch tip
   - built-in `veo-direct` submit, poll, and asset ingestion completed successfully
   - the rerun again advanced the sample project to `review`
   - captured Veo command still reflected the normalized settings: `-n 2`, `-r landscape`, `-m quality`
   - the focused native-Veo plus `execute-status` test bundle passed again
10. latest `HEAD` all-up reruns
   - `npm test` passed again on the current branch tip with all `node:test` cases passing and `0` failing
   - `npm run smoke:portfolio` passed again on the current branch tip
   - the portfolio rerun again showed the expected blocked `plan` state when `asset-manifest` and a viable route were absent
   - index/report/export-csv still completed successfully and continued surfacing execution profile plus prompt guidance
11. latest `HEAD` Seedance-path reruns
   - the focused Seedance bundle passed again: `native-seedance`, `executeProject`, and `cli-execution-plan`
   - the rerun again confirmed built-in Seedance submit/poll support
   - the rerun again confirmed `executeProject` can fall back to the built-in Seedance adapter path
   - the rerun again confirmed `video plan` and the blocked-plan gate behavior on incomplete projects
12. latest `HEAD` stage-flow reruns
   - the focused stage-flow bundle passed again: `cli-full-flow`, `cli-storyboard`, and `cli-brief`
   - a direct stage-flow smoke run completed `init -> brief -> storyboard -> assets -> review -> publish`
   - the resulting project status had `completedStages` of `brief`, `storyboard`, `assets`, `review`, `publish`
   - the resulting project status had `pendingStages: []` and `nextStage: null`
13. latest `HEAD` operations-layer reruns
   - the focused ops bundle passed again: `cli-obsidian-export`, `cli-index-sync`, and `cli-doctor-portfolio`
   - a direct ops smoke run successfully exported an Obsidian note for a sample project into a temp vault
   - the branch-tip operations surface still supports export, sync, and doctor workflows without breaking the clean-room project model
14. latest `HEAD` metadata/reporting reruns
   - the focused metadata/reporting bundle passed again: `cli-set-meta`, `cli-report-history`, `cli-report-csv`, and `cli-workload`
   - a direct metadata/reporting smoke run successfully produced a report snapshot history entry
   - the same smoke run also produced an owner workload bucket after metadata assignment
15. latest `HEAD` health-surface reruns
   - the focused health bundle passed again: `cli-readiness`, `cli-doctor-portfolio`, `cli-dependencies`, and `cli-next-actions`
   - a direct health smoke run again showed the expected blocked readiness state for an incomplete project
   - the same smoke run also produced next-action guidance after metadata assignment
16. latest `HEAD` prompt/reference reruns
   - the focused prompt/reference bundle passed again: `cli-playbooks`, `cli-prompt-library`, `playbooks`, `prompt-guidance`, and `prompt-library`
   - direct prompt/reference CLI checks confirmed that `prompt-lib-show` resolves `veo-prompting-guide`
   - the same checks confirmed that playbook listing still returns `2` bundled playbooks and that `seedance-ugc` resolves with provider `seedance`
17. latest `HEAD` history/diff reruns
   - the focused history bundle passed again: `cli-artifact-history`, `cli-report-diff`, `cli-report-history`, `artifact-history`, `report-diff`, and `report-history`
   - a direct history smoke run wrote a `brief` artifact history file under `artifacts/history/brief/`
   - the same smoke run wrote report snapshots under `reports/history/`
   - `report-diff` produced a non-zero `averageScoreDelta` after a metadata change, proving the diff surface remains live
18. latest `HEAD` character/bootstrap reruns
   - the focused character/bootstrap bundle passed again: `cli-character-consistency`, `character-consistency`, `characters`, and `video-context`
   - a direct character smoke run again showed the expected continuity failure when a storyboard references `Nova` without reference assets
   - the same smoke run again showed readiness blocking on both missing `asset-manifest` and missing character reference assets
   - the same smoke run confirmed that `.omx/video-context.md` exists on the workflow path
19. latest `HEAD` provider-status and metrics reruns
   - the focused provider/metrics bundle passed again: `cli-providers`, `provider-status`, `cli-metrics`, and `metrics`
   - a direct provider smoke run again reported `veo-direct`, `veo-useapi`, `seedance-direct`, and `runway-useapi` as available production routes
   - the same smoke run again reported `kling-useapi` as a degraded scaffold route
   - the same smoke run produced a metrics report with `totalProjects: 1` and the expected `byOpsStatus` breakdown
20. latest `HEAD` template-bridge and import reruns
   - the focused template/import bundle passed again: `cli-import-legacy`, `cli-storyboard-from-clone`, `cli-templates`, and `template-store`
   - a direct smoke run again created a canonical `clone-plan.json` and seeded `brief.json`
   - the same smoke run again materialized a storyboard with `2` scenes in `storyboard` mode from the saved clone plan
21. latest `HEAD` timeline and scorecard reruns
   - the focused timeline/scorecard bundle passed again: `events`, `scorecard`, `cli-next-actions`, and `cli-report`
   - a direct report smoke run produced `totalProjects: 1`, `averageScore: 48`, and a `critical` priority bucket after metadata assignment
   - the same smoke run kept the project indexed with `owner: timeline-owner`, `scoreBand: fair`, and a `nextStage` of `storyboard`
   - the same smoke run produced a next-action entry telling the operator to draft the storyboard artifact
22. latest `HEAD` artifact-validation and doctor reruns
   - the focused artifact/doctor/scaffold bundle passed again: `artifact-validation`, `cli-ops`, `cli-doctor-portfolio`, and `cli-obsidian-vault`
   - a direct doctor smoke run again reported `ok: false` for a malformed project after corrupting `brief.json`
   - the same smoke run reported `issueCount: 4` and included a brief-specific validation issue, proving malformed-artifact detection remains live
23. latest `HEAD` migration and vault-bootstrap reruns
   - the focused migration/vault bundle passed again: `cli-import-legacy`, `cli-index-sync`, and `cli-obsidian-vault`
   - a direct smoke run again imported `legacy-one` from a simulated legacy project root into the clean-room repo
   - the same smoke run again scaffolded an Obsidian vault with a dashboard plus `Templates/` and `Views/` directories
24. latest `HEAD` publish-gate reruns
   - the focused full stage-flow bundle passed again, including the publish-blocking case
   - a direct negative-path smoke run again confirmed that `publish` is blocked when review remains in `retry`
   - the same smoke run emitted an error containing the expected review/publish gate context
25. latest `HEAD` execution-profile propagation reruns
   - the focused execution-profile/report bundle passed again: `cli-execution-profile` and `cli-report-csv`
   - a direct profile smoke run again showed the same overridden execution profile in both `status` and `report`
   - the profile remained `9:16`, `quality`, `1080p`, audio off, outputs `2` across those surfaces
26. latest `HEAD` director-mode template-bridge reruns
   - the focused director/template bridge bundle passed again: `cli-clone-init`, `cli-storyboard-from-clone`, and `pipeline-manifests`
   - a direct director smoke run kept `productionMode: director` through clone-init, storyboard-from-clone, and status
   - the same smoke run advanced the director-mode project to `assets`
27. latest `HEAD` character-profile management reruns
   - the focused character-profile bundle passed again: `cli-characters` and `characters`
   - a direct smoke run successfully added, listed, and showed the `Nova` profile
   - the same smoke run preserved the expected reference asset path and note content on the shown profile
28. latest `HEAD` snapshot/diff reruns
   - the focused snapshot bundle passed again: `cli-report-history`, `cli-report-diff`, `report-history`, and `report-diff`
   - a direct smoke run again produced `2` report snapshots for the sample workspace
   - the same smoke run again produced a non-zero `averageScoreDelta` between those snapshots
29. latest `HEAD` CSV export reruns
   - the focused report/export/metrics bundle passed again: `cli-report-csv`, `cli-report-history`, and `metrics`
   - a direct CSV smoke run again wrote both `projects.csv` and `timeline.csv`
   - the same smoke run again produced non-empty CSV files, including the expected `projects.csv` header row
30. latest `HEAD` omx reporting reruns
   - the focused reporting/metrics bundle passed again while the `omx` compatibility path remained covered by the CLI compatibility tests
   - a direct `omx` smoke run successfully executed `report`, `metrics`, and `export-csv`
   - the same smoke run again produced valid report and CSV output paths and kept all compatibility notices on `stderr`
31. latest `HEAD` omx health and ops reruns
   - the focused health/ops bundle passed again: `cli-readiness`, `cli-next-actions`, `cli-obsidian-export`, `cli-doctor-portfolio`, and the `omx` compatibility CLI checks
   - a direct `omx` smoke run successfully executed `readiness`, `next-actions`, `export-obsidian`, and `doctor-portfolio`
   - the same smoke run again produced the expected blocked readiness state, a next-action entry, an exported Obsidian note path, and kept all compatibility notices on `stderr`
32. latest `HEAD` omx director-mode bridge reruns
   - the focused template-bridge bundle passed again: `cli-clone-init`, `cli-storyboard-from-clone`, and `cli-templates`
   - a direct `omx` director smoke run kept `productionMode: director` through clone-init, storyboard-from-clone, and status
   - the same smoke run again advanced the director-mode project to `assets` and kept all compatibility notices on `stderr`
33. latest `HEAD` provider-adapter binary reruns
   - the focused Seedance runtime bundle passed again: `native-seedance` and `cli-execution-status`
   - a direct `provider-adapter.js --route seedance-direct` smoke run submitted successfully and returned `externalJobId: adapter-job-1`
   - the same smoke run polled to `completed` and returned an output with backend `seedance-direct`
   - the submit payload captured by the adapter command still carried `routeId: seedance-direct` and `action: submit`
34. latest `HEAD` positive omx full-flow reruns
   - the focused full-flow plus compatibility bundle passed again: `cli-full-flow` and `cli-providers`
   - a direct `omx` stage-flow smoke run again completed `brief`, `storyboard`, `assets`, `review`, and `publish`
   - the same smoke run ended with `pendingStages: []`, `nextStage: null`, and kept all compatibility notices on `stderr`
35. latest `HEAD` omx history and CSV reruns
   - the focused history/export/compatibility bundle passed again: `cli-report-history`, `cli-report-diff`, `cli-report-csv`, and the `omx` compatibility CLI checks
   - a direct `omx` smoke run again produced `2` snapshots, a non-zero `averageScoreDelta`, and both `projects.csv` and `timeline.csv`
   - the same smoke run kept all compatibility notices on `stderr`
36. latest `HEAD` omx character-surface reruns
   - the focused character bundle passed again: `cli-characters`, `cli-character-consistency`, `characters`, and `character-consistency`
   - a direct `omx` smoke run again added, listed, and showed the `Nova` profile successfully
   - the same smoke run again reported `consistencyOk: true` with no missing reference assets and kept all compatibility notices on `stderr`
37. latest `HEAD` omx context/bootstrap reruns
   - the focused context/bootstrap bundle passed again: `video-context`, `cli-init-analyze`, and `cli-brief`
   - a direct `omx` smoke run again created `.omx/video-context.md` with the expected section structure
   - the same smoke run again wrote both the analyze and brief changelog entries and kept all compatibility notices on `stderr`
38. latest `HEAD` Veo provider-adapter reruns
   - the focused Veo runtime bundle passed again: `native-veo`, `cli-execution-status`, and `cli-providers`
   - a direct `provider-adapter.js --route veo-direct` smoke run submitted successfully and returned `externalJobId: veo-adapter-job-1`
   - the same smoke run polled to `completed` and returned an output with backend `veo-direct`
   - the submit payload captured by the adapter command still carried `routeId: veo-direct` and `action: submit`
39. latest `HEAD` omx migration and vault-bootstrap reruns
   - the focused migration/vault bundle passed again: `cli-import-legacy`, `cli-index-sync`, and `cli-obsidian-vault`
   - a direct `omx` smoke run again imported `legacy-omx` from a simulated legacy project root
   - the same smoke run again scaffolded an Obsidian vault with `Dashboard.md`, `Templates/`, and `Views/`
   - the same smoke run again synced the vault and exported the imported project note while keeping all compatibility notices on `stderr`
40. latest `HEAD` negative omx publish-gate reruns
   - the focused full-flow plus compatibility bundle passed again, including the publish-blocking case
   - a direct `omx` negative-path smoke run again confirmed that `publish` is blocked when review remains in `retry`
   - the same smoke run again emitted both the expected review/publish gate context and the compatibility notice on `stderr`
41. latest `HEAD` omx prompt/reference reruns
   - the focused prompt/reference bundle passed again: `cli-playbooks`, `cli-prompt-library`, `playbooks`, and `prompt-library`
   - a direct `omx` smoke run again resolved the `veo-prompting-guide` reference
   - the same smoke run again listed `2` bundled playbooks and resolved `seedance-ugc` with provider `seedance`
   - the same smoke run kept all compatibility notices on `stderr`
42. latest `HEAD` all-up full-suite rerun
   - `npm test` passed again on the current branch tip
   - current full-suite result is all `node:test` cases passing and `0` failing
43. latest `HEAD` paired runtime and portfolio reruns
   - `npm run smoke:runtime` passed again on the current branch tip
   - the runtime rerun again selected `seedance-direct`, preserved the `9:16 quality 1080p audio-off outputs-2` profile, and advanced the sample project to `review`
   - `npm run smoke:portfolio` passed again on the current branch tip
   - the portfolio rerun again showed the expected blocked `plan` state when `asset-manifest` and a viable route were absent while preserving project-facing execution profile and prompt guidance visibility
44. latest `HEAD` paired reruns repeated again
   - `npm run smoke:runtime` passed again on the current branch tip with the same `seedance-direct` route selection, `9:16 quality 1080p audio-off outputs-2` profile, and `review` next stage
   - `npm run smoke:portfolio` passed again on the current branch tip with the same blocked-plan behavior and the same execution-profile plus prompt-guidance visibility in the reporting layer
45. latest `HEAD` primary health and ops reruns
   - the focused `vclaw` health/ops bundle passed again: `cli-readiness`, `cli-next-actions`, `cli-obsidian-export`, and `cli-doctor-portfolio`
   - a direct `vclaw` smoke run again produced the expected blocked readiness state for an incomplete project
   - the same smoke run again produced a next-action entry and an exported Obsidian note path on the primary command surface
46. latest `HEAD` primary management-surface reruns
   - the focused management bundle passed again: `cli-set-meta`, `status`, and `report`
   - a direct `vclaw` smoke run again showed `nextStage: storyboard` after brief creation
   - the same smoke run again kept `owner: manager` and `priority: critical` visible in the report index, and produced a next-action entry to draft the storyboard artifact
46. latest `HEAD` primary prompt/reference reruns
   - the focused prompt/reference bundle passed again: `cli-playbooks`, `cli-prompt-library`, `playbooks`, and `prompt-library`
   - a direct `vclaw` smoke run now lists `9` bundled prompt references
   - the same smoke run again resolved `veo-prompting-guide`, listed `2` playbooks, and resolved `seedance-ugc` with provider `seedance`
47. latest `HEAD` primary provider-selection and guidance reruns
   - the focused provider-selection bundle passed again: `cli-providers`, `provider-status`, `cli-execution-plan`, and `prompt-guidance`
   - a direct `vclaw` smoke run again reported `veo-direct`, `veo-useapi`, and `seedance-direct` as available production routes
   - the same smoke run again selected `seedance-direct` in `plan` and surfaced the expected guidance set, now including telemetry and dialogue-duration references alongside checkpoint, stage, style-template, Seedance, and Veo guidance
48. latest `HEAD` primary migration and vault-bootstrap reruns
   - the focused primary migration/vault bundle passed again: `cli-import-legacy`, `cli-index-sync`, and `cli-obsidian-vault`
   - a direct `vclaw` smoke run again imported `legacy-primary` from a simulated legacy project root
   - the same smoke run again scaffolded an Obsidian vault dashboard and synced/exported `1` imported project note
49. latest `HEAD` primary paired stage-flow reruns
   - the focused full stage-flow bundle passed again on the current branch tip
   - a direct positive-path smoke run again completed `brief`, `storyboard`, `assets`, `review`, and `publish` with no pending stages
   - a direct negative-path smoke run again confirmed that `publish` is blocked when review remains in `retry`
50. latest `HEAD` portfolio aggregation reruns
   - the focused aggregation bundle passed again: `cli-index-sync`, `cli-workload`, `cli-dependencies`, `cli-metrics`, `dependencies`, and `workload`
   - a direct aggregation smoke run again produced an index with `2` projects
   - the same smoke run again produced workload buckets for both `alice` and `bob`
   - the same smoke run again emitted a dependency graph with `2` nodes and `1` edge (`agg-a` -> `agg-b`)
51. latest `HEAD` portfolio management reruns
   - the focused management aggregation bundle passed again: `cli-metrics`, `cli-workload`, and `cli-dependencies`
   - a direct smoke run again produced `totalProjects: 2` and a report index with `2` projects
   - the same smoke run again produced owner buckets for `alice` and `bob` plus one dependency edge
69. latest `HEAD` score and timeline reruns
   - the focused score/timeline bundle passed again: `metrics`, `next-actions`, `events`, and `scorecard`
   - a direct smoke run again produced `totalProjects: 1`, `averageScore: 48`, and `scoreBand: fair` for the sample project
   - the same smoke run again showed timeline ordering with `artifact.brief.written` ahead of `project.initialized` and produced the expected next-action guidance
51. latest `HEAD` adapter-plus-report-output reruns
   - the focused adapter/report bundle passed again: `native-seedance`, `native-veo`, `cli-report-history`, and `cli-report-csv`
   - a direct smoke run again submitted through both standalone adapter routes and received `seed-job-3` plus `veo-job-3`
   - the same smoke run again wrote a report snapshot plus both `projects.csv` and `timeline.csv`
52. latest `HEAD` telemetry, dialogue, and clone-workflow reruns
   - full `npm test` passed with all `node:test` cases passing and `0` failures
   - targeted telemetry/cost/preflight/template tests passed before the full suite
   - prompt library now includes generation telemetry, dialogue-duration preflight, character-reference-sheet, and clone-ad-template workflow references
   - `cost-estimate` remains static by default and switches to historical Seedance USD telemetry only when completed provider-reported USD samples exist
52. latest `HEAD` full-suite reran again
   - `npm test` passed again on the current branch tip
   - current full-suite result is all `node:test` cases passing and `0` failing
53. latest `HEAD` runtime and portfolio pair reran again
   - `npm run smoke:runtime` passed again on the current branch tip and again selected `seedance-direct` with the same `9:16 quality 1080p audio-off outputs-2` profile, advancing the sample project to `review`
   - `npm run smoke:portfolio` passed again on the current branch tip and again showed the expected blocked-plan behavior while preserving execution-profile and prompt-guidance visibility in the reporting layer
51. latest `HEAD` primary full-flow plus reference reruns
   - the focused primary bundle passed again: `cli-full-flow`, `cli-playbooks`, and `cli-prompt-library`
   - a direct `vclaw` smoke run again completed the positive lifecycle through `publish` with `status: ready`
   - the same smoke run now lists `9` prompt references and `2` playbooks on the same branch tip
54. latest `HEAD` primary discovery and export reruns
   - the focused discovery/export bundle passed again: `cli-playbooks`, `cli-prompt-library`, `cli-report-history`, and `cli-report-csv`
   - a direct `vclaw` smoke run now lists `9` bundled prompt references and `2` playbooks
   - the same smoke run again wrote `1` report snapshot and exported both `projects.csv` and `timeline.csv`
67. latest `HEAD` runtime plus prompt/reference reruns
   - `npm run smoke:runtime` passed again on the current branch tip with the same `seedance-direct` route selection, `9:16 quality 1080p audio-off outputs-2` profile, and `review` next stage
   - the same runtime rerun again surfaced the expected prompt-guidance set in both `execution-plan` and `status`
   - the focused prompt/reference bundle also passed again: `cli-playbooks`, `cli-prompt-library`, and `prompt-guidance`
68. latest `HEAD` persisted-ops reran again
   - the focused import/snapshot/vault bundle passed again: `cli-import-legacy`, `cli-report-history`, `cli-obsidian-vault`, and `cli-index-sync`
   - a direct smoke run again imported `legacy-two`, wrote a report snapshot, scaffolded a vault dashboard, and synced/exported `1` project note
69. latest `HEAD` omx storyboard-template reruns
   - the focused storyboard-template plus compatibility bundle passed again: `cli-storyboard-templates`, `cli-storyboard`, and the `omx` CLI compatibility checks
   - a direct `omx` smoke run again listed `4` built-in storyboard templates, resolved `product-story`, and generated a `9`-scene storyboard from the template
   - the same smoke run again kept the `omx` compatibility notices on `stderr`
69. latest `HEAD` storyboard-template migration reruns
   - the focused storyboard-template bundle passed again: `storyboard-templates`, `cli-storyboard-templates`, and `cli-storyboard`
   - a direct smoke run again listed `4` built-in storyboard templates and resolved `product-story`
   - the same smoke run again generated a `9`-scene storyboard from the built-in template with the expected templated first-scene description
70. latest `HEAD` template lifecycle reruns
   - the focused template lifecycle bundle passed again: `template-store`, `cli-templates`, and `cli-storyboard-templates`
   - a direct smoke run again created and validated `launch-template`
   - the same smoke run again produced a clone plan with `recommendedPacing: mixed`, `recommendedMotionMode: unknown`, and `2` beats
69. latest `HEAD` reporting-pack reruns
   - the focused reporting-pack bundle passed again: `cli-set-meta`, `cli-report-history`, `cli-report-diff`, and `cli-report-csv`
   - a direct smoke run again produced a non-zero `averageScoreDelta`
   - the same smoke run again wrote both `projects.csv` and `timeline.csv`
55. latest `HEAD` vclaw vs omx readiness/export parity reruns
   - the focused readiness/export/compatibility bundle passed again: `cli-readiness`, `cli-obsidian-export`, and the `omx` CLI compatibility checks
   - a direct parity smoke run again showed that `vclaw` and `omx` returned the same readiness result on the same workspace
   - the same smoke run again wrote the same exported Obsidian note path for both command surfaces while keeping the `omx` deprecation notices on `stderr`
55. latest `HEAD` full-suite plus paired smokes reran again
   - `npm test` passed again on the current branch tip with all `node:test` cases passing and `0` failing
   - `npm run smoke:native-veo` passed again on the current branch tip with the same `veo-direct` submit/poll/ingest behavior and `-n 2`, `-r landscape`, `-m quality` command normalization
   - `npm run smoke:portfolio` passed again on the current branch tip with the same blocked-plan behavior and the same execution-profile plus prompt-guidance visibility in the reporting layer
55. latest `HEAD` execution-status ingestion reruns
   - the focused provider-backed bundle passed again: `cli-execution-status`, `native-seedance`, and `native-veo`
   - a direct `vclaw` smoke run again submitted `job-cli-2`, polled to `completed`, and ingested `1` output
   - the same smoke run again advanced the sample project to `review` with `brief`, `storyboard`, and `assets` completed
56. latest `HEAD` vclaw vs omx execution-status parity reruns
   - the focused provider-backed bundle passed again: `cli-execution-status`, `native-seedance`, and `native-veo`
   - a direct same-workspace smoke run again showed `vclaw` and `omx` polling to the same status, ingesting the same number of outputs, and advancing to the same `nextStage`
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
56. latest `HEAD` primary standalone adapter submits reruns
   - the focused native-provider bundle passed again: `native-seedance` and `native-veo`
   - a direct standalone adapter smoke run again submitted `seed-job-4` through `seedance-direct` and `veo-job-4` through `veo-direct`
   - the captured submit payloads again preserved the expected route ids for both providers
56. latest `HEAD` vclaw vs omx provider/guidance parity reruns
   - the focused provider-selection bundle passed again: `cli-providers`, `cli-execution-plan`, `provider-status`, and `prompt-guidance`
   - a direct parity smoke run again showed that `vclaw` and `omx` selected the same route: `seedance-direct`
   - the same smoke run again showed that both surfaces emitted the same prompt-guidance set, including checkpoint, stage, style-template, telemetry, Seedance, Veo, and dialogue-duration guidance where applicable
   - the same parity smoke again kept the `omx` compatibility notice on `stderr`
57. latest `HEAD` imported-project provider/guidance reruns
   - the focused import/providers/plan bundle passed again: `cli-import-legacy`, `cli-providers`, and `cli-execution-plan`
   - a direct smoke run again imported `legacy-flow` into the clean-room repo
   - the same smoke run again reported `veo-direct`, `veo-useapi`, and `seedance-direct` as available routes for the imported workspace
   - the same smoke run again selected `seedance-direct` and emitted the expected guidance set for the imported project
58. latest `HEAD` provider report plus standalone adapter submits reruns
   - the focused provider-layer bundle passed again: `cli-providers`, `provider-status`, `native-seedance`, and `native-veo`
   - a direct smoke run again reported `veo-direct`, `veo-useapi`, and `seedance-direct` as available routes
   - the same smoke run again returned standalone submit ids `seed-job-6` and `veo-job-6`
58. latest `HEAD` vclaw vs omx report/export parity reruns
   - the focused report-history/report-csv plus compatibility bundle passed again on the current branch tip
   - a direct parity smoke run again showed `vclaw` and `omx` writing the same snapshot root and the same `projects.csv` and `timeline.csv` paths on the same workspace
   - the same smoke run again kept the `omx` compatibility notices on `stderr`
59. latest `HEAD` vclaw vs omx full positive flow parity reruns
   - the focused full-flow plus compatibility bundle passed again on the current branch tip
   - a direct same-workspace smoke run again showed `vclaw` and `omx` completing the positive lifecycle with the same completed stages, pending stages, and `nextStage`
   - the same smoke run again ended with `publish` status `ready` for both surfaces and kept the `omx` compatibility notices on `stderr`
60. latest `HEAD` vclaw vs omx storyboard-template parity reruns
   - the focused storyboard-template plus compatibility bundle passed again on the current branch tip
   - a direct same-workspace smoke run again showed `vclaw` and `omx` returning the same template list and the same `product-story` template payload
   - the same smoke run again generated the same scene count and the same first scene from the template, while `omx` kept its compatibility notices on `stderr`
60. latest `HEAD` mixed vclaw positive and omx negative lifecycle reruns
   - the focused full-flow plus compatibility bundle passed again on the current branch tip
   - a direct same-workspace smoke run again showed `vclaw` completing the positive lifecycle to `publish: ready` with no pending stages
   - the same smoke run again showed `omx` blocking `publish` on the negative path with both the gate context and the compatibility notice present
60. latest `HEAD` vclaw vs omx character-surface parity reruns
   - the focused character bundle passed again: `cli-characters`, `cli-character-consistency`, `characters`, and `character-consistency`
   - a direct same-workspace smoke run again showed `vclaw` and `omx` returning the same `Nova` profile data and the same continuity result
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
61. latest `HEAD` vclaw vs omx continuity-gate parity reruns
   - the focused continuity bundle passed again: `cli-character-consistency`, `cli-readiness`, `characters`, and `character-consistency`
   - a direct same-workspace smoke run again showed `vclaw` and `omx` returning the same missing-reference-asset list for `Nova`
   - the same smoke run again showed both surfaces blocking readiness in the same way, while `omx` kept its compatibility notices on `stderr`
61. latest `HEAD` vclaw vs omx migration/vault parity reruns
   - the focused migration/vault bundle passed again: `cli-import-legacy`, `cli-index-sync`, and `cli-obsidian-vault`
   - a direct same-workspace smoke run again showed `vclaw` and `omx` importing the same legacy slug, writing the same vault dashboard path, and exporting the same project-note set
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
62. latest `HEAD` vclaw vs omx report-output parity reruns
   - the focused report-history/report-csv plus compatibility bundle passed again on the current branch tip
   - a direct same-workspace smoke run again showed `vclaw` and `omx` writing the same `projects.csv` and `timeline.csv` output paths
   - the same smoke run showed that `report-snapshot` still creates distinct timestamped snapshot files per invocation, which is expected behavior rather than drift
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
62. latest `HEAD` compact adapter and persisted-output reruns
   - the focused compact bundle passed again: `cli-report-history`, `cli-report-csv`, and `native-seedance`
   - a direct smoke run again submitted `seed-job-5` through the standalone Seedance adapter path
   - the same smoke run again wrote a report snapshot plus both `projects.csv` and `timeline.csv`
62. latest `HEAD` vclaw vs omx execution-profile parity reruns
   - the focused execution-profile/status/report plus compatibility bundle passed again on the current branch tip
   - a direct same-workspace smoke run again showed `vclaw` and `omx` surfacing the same execution-profile override in both `status` and `report`
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
63. latest `HEAD` vclaw vs omx prompt/reference parity reruns
   - the focused prompt/reference plus compatibility bundle passed again on the current branch tip
   - a direct same-root parity smoke run again showed `vclaw` and `omx` returning the same prompt-library list and prompt reference payload
   - the same smoke run again showed `vclaw` and `omx` returning the same playbook list and playbook payload
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
64. latest `HEAD` vclaw vs omx status/next-actions parity reruns
   - the focused status/next-actions plus compatibility bundle passed again on the current branch tip
   - a direct same-workspace parity smoke run again showed `vclaw` and `omx` returning the same `nextStage`, the same completed stages, and the same next-action payload
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
64. latest `HEAD` vclaw vs omx provider-report parity reruns
   - the focused providers bundle passed again: `cli-providers` and `provider-status`
   - a direct same-workspace parity smoke run again showed `vclaw` and `omx` returning the same route list, env sources, and runtime dependency status
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
64. latest `HEAD` full-suite plus paired provider/reporting reruns
   - `npm test` passed again on the current branch tip with all `node:test` cases passing and `0` failing
   - `npm run smoke:native-veo` passed again on the current branch tip with the same `veo-direct` submit/poll/ingest behavior and `-n 2`, `-r landscape`, `-m quality` command normalization
   - `npm run smoke:portfolio` passed again on the current branch tip with the same blocked-plan behavior and the same execution-profile plus prompt-guidance visibility in the reporting layer
65. latest `HEAD` mixed provider/continuity/history reruns
   - the focused mixed bundle passed again: `provider-status`, `cli-character-consistency`, and `cli-artifact-history`
   - a direct smoke run again reported `veo-direct`, `veo-useapi`, and `seedance-direct` as available routes
   - the same smoke run again showed the expected missing-reference-asset blocker for `Nova`
   - the same smoke run again showed one persisted history file for the `brief` artifact
66. latest `HEAD` omx provider plus persisted-report reruns
   - the focused compatibility/report bundle passed again: `cli-providers`, `cli-report-history`, and `cli-report-csv`
   - a direct `omx` smoke run again reported `veo-direct`, `veo-useapi`, and `seedance-direct` as available routes
   - the same smoke run again wrote a report snapshot plus both `projects.csv` and `timeline.csv`
   - the same smoke run again kept the compatibility notices on `stderr`
66. latest `HEAD` current-state and current-health reruns
   - the focused current-state/current-health bundle passed again: `status`, `cli-readiness`, and `cli-doctor-portfolio`
   - a direct `vclaw` smoke run again showed `nextStage: storyboard` and `completedStages: [\"brief\"]` after brief creation
   - the same smoke run again showed readiness blocked with one blocker and produced a valid doctor-portfolio payload
67. latest `HEAD` mixed provider/state/snapshot reruns
   - the focused mixed bundle passed again: `cli-providers`, `cli-readiness`, `cli-report-history`, and `status`
   - a direct `vclaw` smoke run again reported `veo-direct`, `veo-useapi`, and `seedance-direct` as available routes
   - the same smoke run again showed `nextStage: storyboard`, `completedStages: [\"brief\"]`, and a persisted report snapshot path
67. latest `HEAD` persisted-ops reruns
   - the focused persisted-ops bundle passed again: `cli-artifact-history`, `cli-report-history`, and `cli-obsidian-vault`
   - a direct `vclaw` smoke run again wrote one persisted history file for the `brief` artifact and one report snapshot
   - the same smoke run again scaffolded an Obsidian vault with `Dashboard.md`, `Templates/`, and `Views/`
66. latest `HEAD` provider + next-action + snapshot reruns
   - the focused provider/next-action/history bundle passed again: `cli-providers`, `cli-next-actions`, and `cli-report-history`
   - a direct smoke run again reported `veo-direct`, `veo-useapi`, and `seedance-direct` as available routes
   - the same smoke run again produced one next-action entry (`Draft the storyboard artifact.`) and a persisted report snapshot path
63. latest `HEAD` vclaw vs omx management-view parity reruns
   - the focused management/compatibility bundle passed again: `cli-set-meta`, `status`, `report`, and the `omx` CLI checks
   - a direct same-workspace smoke run again showed `vclaw` and `omx` returning the same `nextStage`, the same completed stages, and the same `owner`/`priority` values in the report layer
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`
61. latest `HEAD` state and artifact-history reruns
   - the focused state/history bundle passed again: `artifact-history`, `cli-artifact-history`, and `status`
   - a direct `vclaw` smoke run again showed `nextStage: storyboard` and `completedStages: [\"brief\"]` after brief creation
   - the same smoke run again showed one persisted history file for the `brief` artifact
60. latest `HEAD` primary director-mode full-flow reruns
   - the focused director bridge/manifest bundle passed again: `cli-clone-init`, `cli-storyboard-from-clone`, and `pipeline-manifests`
   - a direct `vclaw` director-mode smoke run again completed `brief`, `storyboard`, `assets`, `review`, and `publish`
   - the same smoke run again ended with `productionMode: director`, `pendingStages: []`, and `nextStage: null`
59. latest `HEAD` vclaw vs omx director-bridge parity reruns
   - the focused bridge/compatibility bundle passed again: `cli-clone-init`, `cli-storyboard-from-clone`, and the `omx` CLI compatibility checks
   - a direct parity smoke run again showed `vclaw` and `omx` preserving `productionMode: director` through clone-init and storyboard-from-clone on the same workspace
   - the same smoke run again produced the same storyboard scene count and kept the `omx` compatibility notices on `stderr`
68. latest `HEAD` vclaw vs omx history parity reruns
   - the focused artifact-history/report-history plus compatibility bundle passed again on the current branch tip
   - a direct same-workspace smoke run again showed `vclaw` and `omx` reporting the same artifact-history file count for `brief`
   - the same smoke run also confirmed the expected `report-history` behavior: the later `omx` invocation increased the snapshot count because it created an additional timestamped snapshot on the shared workspace
   - the same parity smoke again kept the `omx` compatibility notices on `stderr`

## Go-live criteria status

Satisfied:

1. clean-room repo lane exists
2. `vclaw` primary naming exists
3. temporary `omx` alias exists
4. lifecycle command path exists
5. provider status surface exists
6. canonical artifact and stage model exists
7. migration and deprecation docs exist
8. full automated test suite is green

Still iterative polish, not release blockers:

1. richer provider-specific option surfaces can still improve
2. smoke cadence should continue on real provider-backed scenarios
3. operator education and migration comms can keep improving

## Recommended release checklist

Fast path:

```bash
npm run check:release-readiness-lite
```

This bundled check performs a single clean build, then runs the Node test suite;
the runtime, native-Veo, character-hydration, execution-cancel, portfolio,
reference-sheet, and scene-candidate smokes; the isolated image-storyboard E2E;
and the clean-room wrapper plus doc guardrails, including the `omx`
compatibility alias check.

Expanded checklist:

1. run `npm test`
2. run `npm run smoke:runtime`
3. run `npm run smoke:native-veo`
4. run `npm run smoke:character-hydration`
5. run `npm run smoke:execution-cancel`
6. run `npm run smoke:portfolio`
7. run `npm run smoke:reference-sheets`
8. run `npm run smoke:scene-candidates`
9. run `npm run e2e:image-storyboard`
10. run `npm run check:omx-alias`
11. run `npm run check:movie-director-wrappers`
12. run `npm run check:cleanroom-docs`
13. run `npm run check:skill-frontdoor`
14. run `npm run check:artifact-schema-coverage`
15. from a source checkout, confirm `node dist/cli/vclaw.js video plan --project <slug>` works on a sample workspace; installed-package users should run the same check as `vclaw video plan --project <slug>`
16. confirm `vclaw video sync-obsidian` still reflects current project state for a sampled workspace
17. update migration/deprecation notes if alias or lifecycle policy changes
