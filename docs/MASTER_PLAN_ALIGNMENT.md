# Master Plan Alignment

## v3 status (2026-05-25) — what ships today + honest gaps

videoclaw is at **3.0.0-alpha.0**, the v3 unification line. Read this
section first; the legacy alignment tracking below is historical context
for the v2 merge.

**Shipped and production-ready now (build green, 499 tests, `npm run check:release-readiness-lite` green, npm-publishable):**

- **Agent-friendly CLI contract** (Slice 1): `vclaw schema --json` single-call
  discovery; exit-code taxonomy (0/1/2/3); 23 stable string error codes;
  JSON-default-on-non-TTY; noun-verb command aliases.
- **Consolidated skills** (Slice 2): presenter family parametric via
  `brand-profile.json`; `video-framework` as sole video front door;
  `director-video`/`creative-brief`/`seedance-music-video-prompts` folded
  into their canonical homes.
- **Veo bridge** (Slice 4): `vclaw veo {status|list|history|resume|reset|cancel}`
  + `vclaw veo useapi:*` wrap the Bun `vclaw-cli` as a subprocess.
- **MCP server** (Slice 5): `vclaw mcp serve` exposes 5 read-only
  introspection tools; `mcp/skills-pack/` ships 3 sample agent skills.
- **Core video lifecycle**: init → brief → storyboard → assets → readiness →
  plan → execute, with 4 production provider routes (`veo-direct`,
  `veo-useapi`, `seedance-direct`, `runway-useapi`).

**The one remaining feature gap — Slice 3 (Python fold), NOT yet shipped:**

The final-assembly pipeline (TTS · music · slide animation · title cards ·
FFmpeg stitch) still lives in the **Python scripts** under
`skills/video-replicator/scripts/` (~9.2K LOC). Until Slice 3 lands, a
pure `npm install -g videoclaw` does NOT give you the assemble stage
without a working Python environment. The TS port is planned in 9
sub-slices at `docs/superpowers/plans/2026-05-25-slice-3-python-fold.md`
and is estimated at 2-3 months — it requires human video-quality review
(eyeballing stitched output) and so is deliberately not executed
autonomously. **`vclaw video assemble` does not exist yet.**

Practical impact: v3 today is production-ready as a **provider-dispatch +
project-state + agent-integration toolkit**. The end-to-end
"deck/script → final narrated MP4" path still depends on the Python
sidecar until Slice 3 completes.

---

Source plan:

- `videoclaw/docs/superpowers/plans/2026-04-19-vclaw-video-unification-master-plan.md`
  in the legacy planning workspace.

This document tracks what parts of the master plan are already implemented in
`videoclaw`.

## Implemented

1. New clean implementation lane
2. `vclaw`-first command surface with temporary `omx` compatibility alias
3. Provider capability/status reporting
4. Built-in pipeline manifests for `storyboard` and `director`
5. Canonical artifact contracts
6. Machine-readable analyze output
7. Stage checkpoints and status derivation
8. Governance through stage guards and tests
9. Project metadata:
   - owner
   - priority
   - due date
   - tags
   - blockers
10. Portfolio operations:
   - index
   - metrics
   - health
   - next actions
   - workload
   - dependencies
   - readiness
11. Reporting:
   - report
   - snapshot
   - history
   - diff
   - trends
   - CSV export
12. Obsidian layer:
   - scaffold
   - export
   - sync
   - dashboards
   - metrics/health/timeline/changes/dependencies/workload notes
13. Character consistency subsystem:
    - project character profiles
    - storyboard scene character mapping
    - consistency diagnostics
    - readiness / doctor / execution-plan enforcement
14. Adapter-backed execution runtime:
    - execution payload generation from storyboard + assets
    - route-specific adapter submission
    - dry-run validation and live submission reports
    - honest `pending` asset-stage state after live submission
    - adapter polling via `execute-status`
    - output ingestion back into the canonical asset manifest
    - built-in adapter resolution for `seedance-direct` and `veo-direct`
    - native `seedance-direct` transport behind the built-in adapter
    - native `veo-direct` transport behind the built-in adapter
    - normalized execution profiles for ratio, quality, resolution, audio, and output count
15. Direct clone execution runtime:
    - `clone-execute`
    - storyboard-seeded text-to-video execution scaffolding
    - template -> storyboard -> execution -> review handoff
16. Prompt-library and skill ingestion:
    - imported prompt/reference assets
    - `prompt-lib-list`
    - `prompt-lib-show`
    - `analyze-template` alias
    - provider and framework references available in the clean repo
    - execution-plan guidance derived from prompt-library references
    - repo-local skill docs for analyze-template, clone-ad, and storyboard workflows
    - adapted legacy skill imports for character-library hygiene and video post-production
17. Template bridge:
    - `clone-ad` alias
    - template-create
    - template-save
    - template-list
    - template-show
    - template-validate
    - clone-plan
    - clone-init
    - storyboard-from-clone
18. Storyboard template registry:
    - built-in storyboard templates
    - template listing/showing CLI
    - template-driven storyboard generation
19. Go Bananas library hygiene surface:
    - `video library clean`
    - dry-run candidate discovery
    - prompt patching for existing character records
    - `video list-library` browse alias over the library surface
20. Director storyboard approval gate:
    - `storyboard.md` review export
    - character binding table in review export
    - explicit `storyboard-review` CLI surface
    - `storyboard-review` drives `awaiting-approval` state directly
    - `VIDEOCLAW_APPROVE_STORYBOARD` execution gate
    - `awaiting-approval` checkpoint support in live execution
21. Approval queue ops visibility:
    - `awaiting-approval` maps to `needs-review` in index/metrics/dashboard surfaces
    - stale approval reviews counted in portfolio metrics
    - unreviewed storyboard-review debt counted in portfolio metrics
    - explicit `byReviewState` summary in portfolio metrics
22. Project-facing character binding visibility:
    - referenced character bindings in `status`
    - stored Go Bananas ids surfaced alongside reference assets
23. Storyboard review path visibility:
    - `storyboardReviewPath` surfaced in `status`
    - `storyboardReviewPath` surfaced in project index
24. Storyboard review freshness visibility:
    - `storyboardReviewState` surfaced in `status`
    - `storyboardReviewState` surfaced in project index
    - `storyboardReviewExists` surfaced in `status`
    - `storyboardReviewExists` surfaced in project index
    - `storyboardReviewGeneratedAt` surfaced in `status`
    - `storyboardReviewGeneratedAt` surfaced in project index
    - `storyboardReviewGeneratedAt` carried into report/export/dashboard surfaces
    - stale review detection from storyboard-vs-review event ordering
25. Review-path export visibility:
    - `storyboardReviewPath` carried into report output
    - `storyboardReviewPath` exported to CSV
    - `storyboardReviewPath` exported to Obsidian notes
    - `storyboardReviewPath` linked from grouped dashboard views
    - stale-review signal carried with review links in exports/dashboards
    - review-existence signal carried with review metadata in exports/dashboards
    - normalized `storyboardReviewState` carried into exports/dashboards
26. Review-artifact doctor checks:
    - doctor flags missing `storyboard.md` while approval is pending
    - doctor-portfolio counts missing approval-time review artifacts
    - doctor flags stale review files while approval is pending
    - doctor-portfolio counts stale approval-time review artifacts
27. Runtime stale-review enforcement:
    - `execute` blocks stale approval-time review artifacts
    - `execute-status` blocks stale approval-time review artifacts
28. Review-event timeline visibility:
    - `storyboard-review` appends a machine-readable project event
    - review generation appears in timeline/history surfaces
    - stale-review runtime blocks append a machine-readable project event
    - review-state transitions appear in report diffs
29. Next-action review visibility:
    - `storyboardReviewPath` surfaced in next-actions
    - `storyboardReviewGeneratedAt` surfaced in next-actions
    - `storyboardReviewState` surfaced in next-actions
    - stale review prompts refresh-before-approve guidance
    - awaiting-approval action points directly at storyboard review
    - `Next Actions.md` links directly to the current review file
30. Ops/export character binding visibility:
    - bindings carried into report/index output
    - bindings exported to CSV
    - bindings exported to Obsidian notes
    - bindings shown in grouped Obsidian dashboard views
31. Director preflight guards:
    - content hazard detection before provider submission
    - stored Go Bananas id validation
    - remote reference probe checks
    - pronoun drift warnings
    - repeated-scene warnings
    - `DIRECTOR_AUTO_FIX_CONTENT=1` storyboard substitutions
    - `SKIP_DIRECTOR_PREFLIGHT=1` bypass control
    - explicit `director-preflight` / `preflight` CLI surface
32. Gemini key-pool foundation:
    - `GEMINI_API_KEYS` / `GOOGLE_API_KEYS` / `GOOGLE_API_KEY` discovery
    - round-robin key rotation
    - per-key cooldown on retryable failures
33. Gemini-backed analyze path:
    - `analyze-template --auto`
    - endpoint override for local or alternative Gemini-compatible HTTP targets
34. Legacy import bridge
35. Video context bootstrap:
    - `.omx/video-context.md`
    - `.vclaw/video-context.md` mirroring when present
36. Release-readiness checklist
37. Initial `video create` front door parity:
    - `vclaw video create "<intent>"`
    - `vclaw video auto "<intent>"` lightweight director auto-mode wrapper
    - `vclaw video iterate "<intent>"` cheap storyboard-regeneration wrapper that stops at the approval gate
    - `vclaw video approve --project <slug>` native approval wrapper over the execute path
    - auto-init + canonical brief/storyboard creation
    - storyboard-seed asset scaffolding for execution planning
    - Go Bananas character profile seeding from `--gb-character`
    - automatic `storyboard.md` generation for `director` mode
    - optional handoff into the existing `execute` path via `--execute`
    - `video auto --execute` reaches the same storyboard approval gate as `video create --execute`
    - genre-aware defaults for director-mode create:
      - inferred or explicit genre
      - default style, color grading, platform, and scene count
      - runtime-to-scene-count mapping via `--runtime`
      - clip-duration override via `--clip-duration` / `SEEDANCE_CLIP_DURATION_SEC`
      - act-structure-informed scene shaping
      - machine-readable `resolvedDefaults` returned from create/auto output
      - target runtime persisted through brief metadata, status, and storyboard review
      - target runtime carried through project index, CSV export, Obsidian note export, and synced dashboard views
      - clip duration carried through status, project index, CSV export, Obsidian note export, and synced dashboard views
      - target runtime and clip duration changes surfaced in report diffs and synced `Changes.md`
      - brief-written event payloads carry target runtime and clip duration into timeline/history surfaces
    - genre surfaced in `storyboard.md` and `status`
    - genre carried through portfolio/index/export surfaces:
      - project index
      - report JSON
      - CSV export
      - Obsidian project notes
      - synced dashboard views
38. Director cost-estimate utility:
    - native `vclaw video cost-estimate`
    - direct flag-based estimation
    - project-derived defaults from storyboard durations and character records
    - legacy-style Seedance / Gemini / Go Bananas / ElevenLabs breakdown
39. Approval-gate cost visibility:
    - `video create` returns a project cost estimate
    - `storyboard.md` includes the same cost and wall-time estimate before approval
    - `video create` / `video auto` return explicit review and approval handoff commands
    - `video create` / `video auto` also return the exact `verify-env` command for the project root
    - `storyboard.md` includes the same refresh and approval commands
    - blocked director `execute` reports now include the explicit approval command as well
    - stale-review director `execute` blocks now include the explicit refresh command as well
40. Director environment verification:
    - native `vclaw video verify-env`
    - required env-var checks for Google, Go Bananas, and SUTUI
    - Gemini pool-size guidance
    - local binary checks plus build freshness
    - provider-route readiness surfaced in one machine-readable report
41. Narrated final recovery utility:
    - native `vclaw video remix-narrated`
    - re-muxes per-clip narrated mp4 files into `final/narrated-fixed.mp4`
42. Final-output verification utility:
    - native `vclaw video verify-final`
    - probes codec, resolution, duration, audio presence, and midpoint frame extraction
43. Project archival utility:
    - native `vclaw video archive-project`
    - archives a project into `archives/<slug>-<timestamp>.tar.gz`
    - optional `--cleanup` to remove the project after archiving
44. Native Go Bananas library discovery and project hydration:
    - `vclaw video find-library --intent "<text>"`
    - `vclaw video library find --intent "<text>"`
    - `vclaw video character-import-library --project <slug> --intent "<text>"`
    - exact-name library reuse written into the canonical project character store
45. Native Go Bananas character auto-creation:
    - `vclaw video character-auto-create --project <slug> --input <json>`
    - reuses exact-name matches when present
    - creates missing references through the clean-room REST flow
    - writes created or reused refs into the canonical project character store
46. Create-time character hydration parity:
    - `video create --import-library-characters`
    - `video create --auto-create-characters <json>`
    - imported and auto-created casts merge with explicit `--gb-character` bindings
    - create response exposes `characterHydration`
    - create-time auto-created cast count feeds approval-gate cost estimation
47. Cast provenance visibility:
    - per-source notes preserved on stored character profiles
    - `status` exposes `characterProfiles`
    - `status` exposes `characterHydrationSummary`
    - project index carries profile counts and hydration summary
    - CSV/report export carries hydration counts
    - portfolio metrics aggregate explicit/imported/auto-created character profile totals
    - Obsidian dashboard and metrics note show cast provenance counts
    - `character.hydrated` project event appears in timeline/history surfaces
48. Cheap integrated verification surfaces:
    - `scripts/smoke-character-hydration.mjs`
    - `npm run smoke:character-hydration`
    - `scripts/check-movie-director-wrappers.sh`
    - `npm run check:movie-director-wrappers`
    - `scripts/check-cleanroom-docs.sh`
    - `npm run check:cleanroom-docs`
49. Director helper-script clean-room retargeting:
    - `skills/movie-director/scripts/auto.sh`
    - `skills/movie-director/scripts/iterate.sh`
    - `skills/movie-director/scripts/run-pipeline.sh`
    - `skills/movie-director/scripts/interview.sh`
    - `skills/movie-director/scripts/verify.sh`
    - `skills/movie-director/scripts/list-library.sh`
    - all now target the native `vclaw.js` JSON surface rather than legacy `omx.js` / Python helper assumptions
50. Director long-tail doc cleanup:
    - stale legacy Python character-creation references removed from primary Director refs
    - stale transport-era `GO_BANANAS_GENERATION_TRANSPORT=mcp` examples removed from clean-room-facing Director docs
    - dead local `seedance_*` file references removed from the Movie Director skill inventory
    - `seedance-prompts` skill rewritten around the actual clean-room prompt-library surface
51. Packaged release-readiness bundle:
    - `scripts/check-release-readiness-lite.sh`
    - `npm run check:release-readiness-lite`
    - single-build execution of:
      - Node test suite
      - runtime smoke
      - native Veo smoke
      - character-hydration smoke
      - execution-cancel smoke
      - portfolio smoke
      - `omx` compatibility-alias check
      - wrapper syntax checks
      - clean-room doc stale-reference scan
52. Live execution cancel surface:
    - `vclaw video execute-cancel --project <slug>`
    - adapter/runtime `action: "cancel"` support
    - built-in `seedance-direct` cancel using stored task ids
    - explicit `execution.cancelled` project event
    - assets-stage checkpoint/report state updated after operator cancellation
53. Cancellation smoke coverage:
    - `scripts/smoke-execution-cancel.mjs`
    - `npm run smoke:execution-cancel`
    - packaged operator verification for submit -> cancel -> failed assets-stage state
54. Reference sheets subsystem:
    - five typed sheets (`identity`, `outfit-material`, `environment`, `motion-camera`, `palette-mood`) with closed role vocabularies
    - extended `outfit-material` vocabulary for product work (`product-hero`, `product-variant`, `product-in-use`, `packaging`)
    - `ReferenceEntry` supports both path-backed refs and Go Bananas refs (`character`, `product`, `scene`, `style-preset`, `reference-group`)
    - five CLI commands: `reference-sheet-add`, `reference-sheet-list`, `reference-sheet-show`, `reference-sheet-bind`, `reference-sheet-validate`
    - on-disk artifact at `projects/<slug>/references/reference-sheets.json` with schema-versioned JSON
    - identity-per-character-bound-scene enforcement in director-mode `readiness`
    - four reference-sheet preflight checks in `director-preflight`: `unassigned-role`, `role-vocabulary-violation`, `role-collision`, `reference-sheet-orphan-gb-ref`
    - `referenceSheets` summary surfaced through `status`, `project-index`, `report`, `csv-export`, and Obsidian export/sync
    - Reference sheets section added to the director-mode `storyboard.md` approval review
    - doctor and doctor-portfolio flag missing identity sheets and role collisions
    - packaged smoke: `scripts/smoke-reference-sheets.mjs` + `npm run smoke:reference-sheets`
    - public re-exports on `src/index.ts` for the core, store, and types
    - full operator guide at `docs/REFERENCE_SHEETS.md`
56. Prompt-quality preflight:
    - six mechanical Seedance-handbook anti-pattern checks in `src/video/prompt-quality.ts`
    - warnings by default; `DIRECTOR_STRICT_PROMPT_QUALITY=1` promotes to blocking errors
    - catches adjective soup, multiple actions, multiple camera moves, style-word overload, literary emotion language, and overlong prompts
    - wired into `director-preflight` without a new CLI command or smoke
    - public surface re-exported from `src/index.ts`
    - operator guide at `docs/PROMPT_QUALITY.md`
57. Beat-structure storyboard templates:
    - two new built-in templates (`beat-structure-3`, `beat-structure-6`) in `src/video/storyboard-templates.ts`
    - canonical Establish → Develop → Payoff arc from the Seedance handbook page-12 beat structure
    - 3-scene variant for short-form ads, social cuts, and punchlines
    - 6-scene variant (two shots per beat) for explainers, transformations, and product launches
    - discoverable via existing `storyboard-template-list` / `storyboard-template-show` CLI commands
58. Arcads-codebase takeaway adoption, phases 4-8:
    - generation telemetry ledger recorded as `generation.telemetry.recorded` project events
    - completed Seedance provider-reported USD samples feed `cost-estimate` as historical telemetry
    - prompt-library references added for generation telemetry, dialogue duration, character reference sheets, and clone-ad workflow
    - Seedance UGC playbook expanded with dialogue budget, image-to-video separation, identity-sheet, and telemetry checklist items
    - director preflight now emits `DIALOGUE_DURATION_OVERFLOW` for dialogue that cannot fit the clip duration
    - director readiness now warns on thin or mismatched Identity Sheet coverage while keeping the hard no-Identity-Sheet blocker
    - analyze/template/clone artifacts now preserve style layers, beat compression, technical notes, dialogue notes, and workflow checklists
    - operator guide added at `docs/GENERATION_TELEMETRY.md`
55. Scene candidates and selection subsystem:
    - two canonical artifacts (append-only candidates + mutable selection)
    - 9 CLI commands + --scene partial-rerun flag on produce/execute
    - execute runtime writes candidates (not direct assets) with legacy-fallback protection
    - chain-from-prev resolution with hard-fail on missing upstream selection
    - readiness + review/publish stage guards on selection coverage
    - ops-surface integration: status, project-index, report, CSV, Obsidian, storyboard.md review
    - per-scene Obsidian notes at Projects/<slug>/Scenes/<i>.md
    - doctor diagnostics for missing selection, stale selection, pending reroll, stale chain upstream
    - migration helper from legacy single-generation projects
    - packaged smoke coverage via scripts/smoke-scene-candidates.mjs

## Current status

- `npm test` passes in `videoclaw`
- Current result: all `node:test` cases passing, `0` failing
- `npm run check:release-readiness-lite` passes in `videoclaw`
- The repo is stable and green
- Character continuity is now enforced before execution planning
- Adapter-backed live submission now exists in the clean repo
- Adapter-backed polling and output ingestion now exist in the clean repo
- Built-in adapter resolution now exists for `seedance-direct` and `veo-direct`
- Native `seedance-direct` transport now exists in the clean repo
- Native `veo-direct` transport now exists in the clean repo
- Provider-specific execution profile normalization now exists in the clean repo
- Direct clone execution runtime now exists in the clean repo
- Prompt-library and reference ingestion now exist in the clean repo
- Prompt-library guidance now feeds execution planning in the clean repo
- `plan` and `produce` now exist as lifecycle aliases over `execution-plan` and `execute`
- `omx` compatibility alias now exists in the clean repo
- Video context bootstrap now exists in the clean repo
- Migration and deprecation docs now exist in the clean repo
- Release-readiness checklist now exists in the clean repo
- create-time cast hydration now exists in the clean repo
- cast provenance now flows through create/status/index/report/csv/metrics/obsidian/timeline surfaces
- cheap smoke and doc/wrapper guardrails now exist in the clean repo
- a packaged single-build release-readiness command now exists in the clean repo
- main Director shell wrappers now target the clean-room CLI contract
- The major planned platform gaps are closed; remaining work is iterative polish

## Remaining gaps

The clean-room repo is strong on lifecycle state, ops visibility, execution
planning, and provider-backed stage execution. The main remaining work is now
about closing the last feature gaps between the imported legacy workflow
surfaces and the clean-room product surface.

1. The clean-room `video create` front door is now meaningfully closer to the
   imported Director/movie workflow, but it still stops short of full
   high-touch production parity.
   - Storyboard-first approval, style/grading defaults, `--gb-character`,
     library import, auto-create, cost visibility, and execute handoff now
     exist directly on the clean-room surface.
   - What still remains is deeper parity around higher-order orchestration:
     richer decomposition controls, more explicit provider- and genre-specific
     tuning surfaces, and a stronger bridge from the imported Director/movie
     skill inputs into canonical clean-room artifacts without relying on shell
     wrappers.
2. Historical project migration is still shallow.
   - Evidence: `src/video/legacy-import.ts` currently infers state from file
     counts and writes `legacy-import-summary.json`, but it does not yet
     normalize run lineage, reconcile nested output roots, repair queue-vs-file
     drift, or generate structured run notes from historical telemetry.
3. Provider-contract hardening is not fully finished.
   - Capability/status reporting, submit, poll, cancel, and profile normalization now exist.
   - Remaining master-plan parity work is about a fuller shared error-taxonomy,
     richer recovery guidance, and broader provider-specific control surfaces on
     the clean-room CLI.

## Recommended next execution order

Since the 50+ core items landed, two major Seedance-handbook-driven additions
have shipped (items 54 and 55 above). The execution order below reflects the
post-ship lanes: both the original parity gaps and the new high-leverage
follow-ons unlocked by reference sheets + scene candidates.

### Tier 1 — Legacy parity (original plan, still relevant)

1. Deepen the new `vclaw video create` front door from "strong initial parity"
   to "primary production lane."
   - Keep mapping the legacy create mental model onto canonical artifacts
     instead of reviving the old loose-file runtime.
   - Focus the next parity work on richer decomposition/tuning controls rather
     than on the already-landed cast hydration and approval-gate mechanics.
2. Continue collapsing imported Director/movie wrapper expectations into the
   native runtime surface.
   - Prefer first-class CLI flags and artifact-backed state over shell-only
     helper behavior.
   - Reuse the existing clean-room modules for preflight, review generation,
     execution profiles, provider status, and execution runtime rather than
     embedding a second orchestration path.
3. Deepen historical project normalization.
   - Extend `import-legacy` from a stage guesser into a reconciler that can:
     derive run lineage, detect nested output-root duplication, compare queue
     files with actual outputs, and emit structured run summaries.
4. Finish provider-contract parity.
   - Expose normalized provider failure categories and richer recovery guidance
     through CLI/runtime status so operators can recover without reading raw
     adapter payloads.

### Tier 2 — Seedance-handbook-driven follow-ons (unlocked by items 54–55)

These are the highest-leverage additions that build directly on reference
sheets + scene candidates, mapped to the Seedance 2.0 Handbook principles.

5. **Candidate thumbnail previews in Obsidian** (scene-candidates follow-on).
   Bridge `video-thumbnail-lab` with the per-scene Obsidian notes so each
   candidate row shows an inline thumbnail. Closes the "I have to click into
   the file to see what a candidate actually looks like" gap.

6. **Auto-seed Identity Sheet from `character-creator`** (reference-sheets
   follow-on). When `character-creator` produces multi-view refs, emit an
   Identity Sheet alongside the Character record so operators don't need a
   second CLI call. Single sheet per character with `identity`, `silhouette`,
   `wardrobe` roles pre-tagged.

7. **Prompt-structure schema.** Turn the handbook's 10-step prompt schema
   (Format/Goal · Asset Roles · Scene · Action · Camera · Lighting/Color ·
   Sound · Timeline · Constraints · Continuity) into
   `schemas/video/scene-prompt.schema.json` and score scene prompts against it
   at preflight time.

### Tier 3 — Nice-to-haves (no rush)

9. Parallel candidate generation within a round (scene-candidates follow-on).
10. Reusable sheet library across projects (reference-sheets follow-on).
11. Automatic candidate scoring (CLIP similarity against Identity Sheet refs).
12. Candidate comparison view (side-by-side HTML generated from selected set).
13. Visual preview cards for sheets via `video-thumbnail-lab`.
14. Promote `palette-mood` / `outfit-material` / `environment` / `motion-camera`
    to blocking readiness where applicable (currently only `identity` blocks).

### Sequencing note

Tier 1 items are about closing the last legacy-parity gaps. Tier 2 items are
about compounding on the two Seedance-driven features just shipped. They are
independent lanes — either tier can be worked first without blocking the
other. Pick based on whether the near-term need is migration depth (Tier 1)
or operator quality-of-life on the new surfaces (Tier 2).
