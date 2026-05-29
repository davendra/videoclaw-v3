# Repository Guidelines

## Agent integration contract (v3)

videoclaw v3 is designed as a target for external agents (Claude Code,
Codex, Antigravity, Cursor, Warp), not as an orchestrator itself. The
contract:

1. **Stdout is JSON when piped.** Pretty-printed when TTY. Progress goes to stderr.
2. **Exit codes follow a 0/1/2/3 taxonomy** — see `docs/CLI_REFERENCE.md` § Agent-friendly surface.
3. **Errors carry stable string codes** in their JSON envelope. The catalog: `schemas/video/errors.json`.
4. **One-call discovery: `vclaw schema --json`** dumps the full contract — commands, flags, artifact schemas, exit codes, error codes.
5. **Veo (Google Flow) access requires Bun.** `vclaw veo *` subcommands bridge to `bun run vclaw-cli/flow.ts` as a subprocess. Bun must be on PATH (`bun --version` to verify).
6. **MCP option.** `vclaw mcp serve` exposes read-only project introspection (list_projects, get_project_status, get_artifacts, get_event_log, list_provider_routes) over stdio MCP. Writes still go through the CLI.

If you are an agent author wiring videoclaw into your tool: call
`vclaw schema --json` once, then drive the CLI deterministically.
Don't try to do natural-language intent classification inside videoclaw
— that's your job.

---

## Autonomy Directive
- Proceed by default. Do not stop to ask for confirmation on obvious next steps.
- Treat user intent here as: build continuously, keep going, and only ask if the next action is destructive outside the repo or genuinely ambiguous.
- Prefer making the change, running the verification, and continuing to the next slice rather than pausing for approval.
- Keep work scoped to this repository and its generated project folders unless the task explicitly requires touching something else.
- If a blocker is local and solvable, solve it. If a blocker is external and hard, note it in output/state and continue with the next meaningful lane.

## Project Structure & Module Organization
- `src/cli/` contains the `vclaw` CLI entrypoint and command parsing.
- `src/video/` holds the core video workflow modules: artifacts, checkpoints, provider status, workspace helpers, and built-in pipeline manifests.
- `src/tests/` contains Node test files; compiled tests run from `dist/tests/` after build.
- `schemas/video/` stores JSON Schema contracts for artifacts and pipeline manifests.
- `docs/ARCHITECTURE.md` explains the clean-room, video-first design. Treat `dist/` as generated output; edit `src/` instead.

## Build, Test, and Development Commands
- `npm install` — install the Node 20+ toolchain.
- `npm run build` — compile TypeScript to `dist/` and make `dist/cli/vclaw.js` executable.
- `npm run dev` — run `tsc --watch` for local iteration.
- `npm test` — full verification: rebuild, then run the Node test suite.
- `npm run test:node` — rerun compiled tests only when `dist/` is already current.
- Example CLI smoke check: `node dist/cli/vclaw.js video providers`.

## Coding Style & Naming Conventions
- Use TypeScript with `strict` settings and NodeNext ESM conventions.
- Match the existing 2-space indentation and keep modules small and single-purpose.
- Use `camelCase` for functions/variables, `PascalCase` for types/interfaces, and `kebab-case` for filenames (for example, `provider-status.ts`).
- Keep JSON artifacts machine-readable and deterministic; avoid silent fallback behavior across provider routes.
- In TypeScript imports, keep the emitted `.js` extension style used throughout `src/`.

## Testing Guidelines
- Tests use the built-in `node:test` runner with `assert/strict`.
- Name tests `*.test.ts` and colocate them in `src/tests/` by feature area, such as `cli-full-flow.test.ts`.
- Cover both module contracts and CLI flows, especially artifact writing, checkpoint transitions, and status/doctor behavior.
- Prefer temp-directory-based tests (`mkdtemp`, `tmpdir`) so runs stay isolated and repeatable.

## Commit & Pull Request Guidelines
- This repository has no published git history yet; use imperative, scope-aware commits that follow the repo Lore protocol.
- Start with why, then add trailers when useful, such as `Constraint:`, `Confidence:`, `Scope-risk:`, `Tested:`, and `Not-tested:`.
- PRs should summarize user-visible changes, list verification commands run, link related issues, and include sample CLI output when command behavior changes.

## Security & Configuration Tips
- Do not commit secrets, `.env.local`, provider cookies, or local OMX state; `.omx/` is intentionally ignored.
- Provider readiness depends on local tools like `python3`, `bun`, and `ffmpeg`, plus route-specific environment variables.


<claude-mem-context>
# Memory Context

# [videoclaw-v3] recent context, 2026-05-29 10:08am GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (16,958t read) | 396,779t work | 96% savings

### May 29, 2026
18480 8:51a 🟣 ark Asset Library + Scene-5 Submission Script Created at /tmp/ark_assetlib_scene5.py
18481 " 🔵 Asset Library Has Async Sync Step — Assets Must Finish Processing Before ark Submission
18482 8:52a 🔵 All Three DHUAAN Character Assets Synced to Active — Ready for ark Submission
18483 " 🟣 ark/seedance-2.0 Scene-5 Task Successfully Submitted with Asset:// Character URIs
18484 " 🟣 Background Poll Script Launched for ark Scene-5 Task
18485 8:56a 🔵 Mirchi Project Character Assets Already in Asset Library — Reusable Without Re-upload
S2072 Validate ark/seedance-2.0 Asset Library pipeline end-to-end for DHUAAN Scene-5 character consistency — confirm same Volcengine Ark endpoint as proven Mirchi recipe (May 29 at 8:56 AM)
18486 8:57a 🟣 ark/seedance-2.0 Scene-5 Asset Library Take Completed — 2,158 Credits, 5 Minutes, 6.7MB
S2073 Complete DHUAAN Scene-5 character consistency investigation — ark/seedance-2.0 Asset Library pipeline confirmed working with "perfect output," memory updated, two next moves proposed (May 29 at 8:57 AM)
18487 8:58a ✅ Memory Node Updated — ark Asset Library Pipeline Marked "CONFIRMED WORKING" with Perfect Output
S2074 Multi-scene video rendering for "dhuaan-last-stand" project — Scene 2 confirmed complete (May 29 at 8:58 AM)
18488 8:59a 🔵 native-seedance.ts Already Handles Asset:// URIs — classifyReferencePaths Routes Them as Images
18489 9:01a 🟣 seedance-asset-library.ts Created — Asset Library Helper Module for Character Consistency
18490 " 🟣 seedance-asset-library.test.ts Created — 6 Unit Tests for Asset Library Helper
18491 9:02a 🟣 seedance-asset-library.ts Builds and All 6 Tests Pass
18492 " 🔵 cli-schema.test.ts Has Hard-Coded Command Count of 78 — Must Update When Adding Asset Library Command
18493 9:03a 🟣 video seedance-register-assets Command Added to CLI Schema
18494 " ✅ CLI Schema Test Count Updated from 78 to 79
18495 " ✅ vclaw.ts Import Updated — writeFile Added for seedance-register-assets Handler
18496 " ✅ seedance-asset-library Imported in vclaw.ts — registerCharacterAssets Now Available in CLI
18497 9:26a 🔵 Scene 2 Video Render Completed and Downloaded
S2075 videoclaw-v3 design spec — Commercial track (Section 2), quant-craft module (Section 3), and build phases (Section 4) laid out for approval (May 29 at 9:26 AM)
S2076 videoclaw-v3 commercial track design spec written, self-reviewed, and committed — awaiting user approval before implementation plan (May 29 at 9:27 AM)
18498 9:28a 🟣 Commercial Track + Quant-Craft Design Spec Written
18499 " ✅ Design Spec Committed to videoclaw-v3 Repository
S2077 Expand the commercial track + quant-craft design spec with the full Higgsfield prompt-craft takeaway set and update build phases accordingly (May 29 at 9:28 AM)
18500 9:40a ✅ Design spec expanded with additional prompt-craft from Higgsfield research
18501 9:41a ✅ Build phases fully specified: four placeholder phases replaced with six detailed phases
18502 " ✅ Test continuity constraint updated to reflect Phase C as the regression gate
18503 " ✅ Design spec committed: full Higgsfield takeaway set + 6-phase plan
S2078 Audit of missed items from skills review — identifying gaps between existing spec and capabilities discovered across all skills (May 29 at 9:41 AM)
S2079 Complete design spec for videoclaw-v3 commercial track + quant-craft — finalized with full-skill audit and committed to git (May 29 at 9:49 AM)
18504 9:50a ✅ Full-skill audit section added to commercial track spec
18505 " ✅ Spec committed: full-skill audit with 8 adopted items
S2080 DHUAAN scene execution — confirmed six-panel reference sheet + multi-character asset binding mechanism for Seedance identity locking (May 29 at 9:50 AM)
18506 9:52a 🟣 DHUAAN Scene 3 (trio) submitted to Seedance
18507 9:54a 🟣 Implementation plan written for commercial track + quant-craft (Phases A–F)
18508 " ✅ Implementation plan committed to git as 4e44668
S2081 Implementation plan committed and execution approach decision — subagent-driven vs inline execution for Phase A–F build (May 29 at 9:54 AM)
18509 9:56a 🟣 Phase A Task A1: failing test written for cinematography emitters
18510 9:57a 🟣 Phase A Task A1: cinematography.ts implemented — detail-leveled camera/lighting/grade emitters
18511 " 🟣 Phase A Task A1 green: all 4 cinematography tests pass
18512 9:58a 🔵 Full test suite: 758/758 pass after adding cinematography.ts
18513 " ✅ Task A1 committed: cinematography emitters on branch codex/review-delivery-portal
18514 9:59a 🔵 Task A1 code review: APPROVED with three NITs noted
18515 10:00a 🟣 Phase A Task A2: failing test written for prompt-rules module
18516 " ✅ cinematography.test.ts updated to import audioMix — Task A2 co-locates audio in cinematography.ts
18517 " ✅ audioMix test added to cinematography.test.ts — dB hierarchy contract defined
18518 10:01a 🟣 Phase A Task A2: prompt-rules.ts implemented — standing prompt rules module
18519 " 🟣 audioMix() added to cinematography.ts — dB hierarchy at rich level
18520 " 🟣 Phase A Task A2 green: prompt-rules (4/4) and audioMix (1/1) all pass
18521 10:02a 🔵 Full suite: 763/763 pass after Task A2 — 9 new tests, zero regressions
18522 " ✅ Task A2 committed: prompt-rules + audioMix as e8b48c8
18523 10:03a 🔵 Task A2 code review: APPROVED — two future-awareness NITs noted
18524 10:05a 🔵 filmmaking-prompts.ts structure mapped for Task A3 --detail wiring
18525 " 🔵 Task A3 integration points fully mapped in vclaw.ts and test file
18526 " ✅ Task A3 started: cinematography module imported into filmmaking-prompts.ts
18527 " ✅ Task A3: detail?: DetailLevel threaded into GenerateFilmmakingPromptsOptions and buildStoryboardGridPrompt call
18528 10:06a ✅ Task A3: detail fully threaded through buildSeedancePackets and richStyleSuffix computed in buildStoryboardGridPrompt
18529 " ✅ Task A3: richStyleSuffix wired into storyboard Style line; detail fully threaded to seedancePromptText call

Access 397k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
