# Repository Guidelines

## Agent integration contract (v3)

videoclaw v3 is designed as a target for external agents (Claude Code,
Codex, Antigravity, Cursor, Warp), not as an orchestrator itself. The
contract:

1. **Stdout is JSON when piped.** Pretty-printed when TTY. Progress goes to stderr.
2. **Exit codes follow a 0/1/2/3 taxonomy** — see `docs/CLI_REFERENCE.md` § Agent-friendly surface.
3. **Errors carry stable string codes** in their JSON envelope. The catalog: `schemas/video/errors.json`.
4. **One-call discovery: `vclaw schema --json`** dumps the full contract — commands, flags, artifact schemas, exit codes, error codes.

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

# [videoclaw] recent context, 2026-05-18 4:52pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,625t read) | 1,200,363t work | 98% savings

### May 7, 2026
5963 9:43a 🟣 New Project "davendra-disco-monster" Created with Custom Storyboard
5992 10:20a 🟣 Human-in-the-Loop HTML Dashboard with Image Display Requested
5994 10:24a ⚖️ Video Production Technique Research & Documentation Plan
5995 " 🔵 videoclaw Project Structure: davendra-disco-monster Video Project
6004 12:32p 🔵 Review Station UI Gate Logic and API Surface
6005 12:33p 🔵 Review Station Action Dispatch, Ledger Schema, and nextAction Decision Tree
6006 " 🟣 Visual Handoff Strip CSS Components Added to Review Station UI
6007 " 🟣 visualStoryboardStrip() Function Added to Handoff Summary
6008 " 🟣 Compact Visual Strip Embedded in Agent Handoff Side Panel
6009 " 🔵 Review UI Test Suite Passes 14/14 After Visual Strip Changes
6010 12:34p 🔵 Review UI Loads with 1 Console Error After Visual Strip Addition
6011 " 🔴 Null Candidate Crash in visualStoryboardStrip() via imageOutput()
6012 " 🔴 imageOutput() Null Guard Added to Fix visualStoryboardStrip Crash
6013 " 🔴 Review UI Loads Clean After imageOutput() Null Guard Fix
6014 12:35p 🟣 Review Station Visual Storyboard Strip Confirmed Working in Live UI
6015 12:36p ⚖️ Video Storyboard Technique Research and Documentation Initiative
6016 " 🔵 vclaw Review UI State: 4 Mini-Shots Present, 0 Visual-Handoff Shots
6017 " 🔵 videoclaw Git State: Modified AGENTS.md and Review Station HTML, New Project Directory
### May 8, 2026
6086 8:12a 🟣 UK AI Contractor Roles Excel Sheet Generation Initiated
6089 8:13a 🔵 Codex Runtime Environment Paths Confirmed for Spreadsheet Build
6090 " 🔵 @oai/artifact-tool Module Resolution Fails Due to CWD Mismatch
6091 8:14a 🔵 @oai/artifact-tool Resolves Correctly from /tmp/uk-ai-roles Workdir
6106 8:23a 🟣 UK AI Contractor Roles Excel Workbook Generated
6157 8:50a 🔵 Gmail Draft Creation via MCP Tool Confirmed Working
6188 9:12a 🟣 UK AI Contract Roles Workbook Enriched with Direct Job URLs and Public Contact Emails
6189 " 🟣 UK AI Contract Roles Workbook Enriched with LinkedIn Profiles for Direct Messaging
6190 " 🔵 @oai/artifact-tool Node Scripts Must Run from tmp/ Directory to Resolve Package
6204 9:16a 🟣 UK AI Contract Roles Workbook Enriched with Full Job Post Source Text (Columns AD–AF)
6205 " 🔵 UK AI Job Board Link Expiry Patterns by Platform
6214 9:18a 🔵 Six AI Job Application Email Drafts Already Created on 2026-05-08
6215 " 🔵 AI Contract Role Outreach Emails Sent on 2026-05-08 — Full Sent Log
6216 9:19a 🔵 Subject Access Request Filed Against Alter Domus — Case No. 2200569/2026, Response Due 28 May 2026
6217 " 🔵 AI Contract Job Search History — Applications Sent Before 2026-05-08
6218 9:20a ✅ 5 AI Job Application Gmail Drafts Trashed After Confirming Sent Status
6219 " ✅ Fruition Group "Contract AI Engineer" Application Sent — All Today's AI Role Drafts Now Cleared
6220 " 🔵 Two Notable Unsent Drafts Remain: Alter Domus Reply (Nov 2025) and Wilton Bain IA Manager (Mar 2026)
6297 10:28a 🔵 videoclaw: Full Repository Assessment (Structure, Capabilities, Live State)
6298 " 🔵 davendra-disco-monster Project: Genre Mismatch and Stale Review Blocking Progress
6299 " 🔵 publishReady Logic: Both Upscale Asset Completeness AND 5 Assembly Approvals Required
6300 " 🔵 Portfolio State: 3 Director Projects — 1 Complete, 1 Needs Upscale+Publish, 1 Active Awaiting Publish
6301 10:29a 🔵 Documented Remaining Gaps in videoclaw vs. Legacy VideoClaw Feature Parity
6307 10:30a 🔵 storyboardReviewState and nextAction Signals Propagate Across All Portfolio Surfaces
6308 10:31a ⚖️ Production-Readiness Goal Established: Unify Review Truth and Polish UI/UX
6312 10:32a 🔴 Review Artifact publishReady and nextAction Unified to Single Composite Truth
6314 " 🔵 Review Station Browser UI: Auto-Save Triggers and Stage Machine Behavior
6316 10:33a 🔵 Review Station UI Distinguishes Upscale Markers from Artifact-Backed 4K Stills
6318 " 🔴 next-actions Improved: Stale Review and Specific Review Checkpoint Action Now Surfaced
6320 " 🔴 Review Station HTML: reviewComplete() and isSceneUpscaled() Now Use Artifact-Backed Truth
6321 " 🔴 Review Station: "Mark 4K" Button Removed — Operator Must Use Attach Form for 4K Stills
6323 10:34a 🔵 Test Failure After publishReady Unification: postPlan.publishReady Now False Without Upscale Assets

Access 1200k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
