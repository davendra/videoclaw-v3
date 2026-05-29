# CLI Reference

## Agent-friendly surface (v3)

These four properties hold across every `vclaw` subcommand. They are the
contract external agents (Claude Code / Codex / Antigravity / Cursor) can
rely on.

### 1. JSON on non-TTY

When `stdout` is not a TTY (i.e., piped to another command or captured
by an agent), every subcommand writes JSON to stdout. Human-readable
formatting is reserved for interactive TTY use. Progress chatter
(spinners, status updates) always goes to `stderr`.

```bash
# TTY (human): pretty-printed
vclaw video providers

# Non-TTY (agent / pipe): newline-terminated JSON
vclaw video providers | jq '.routes[].routeId'
```

### 2. Exit-code taxonomy

| Code | Name | Meaning |
|---:|---|---|
| 0 | SUCCESS | Command completed without errors. |
| 1 | USER_ERROR | Bad input — invalid flag, missing argument, validation failure. **Retrying with the same input will fail the same way.** |
| 2 | SYSTEM_ERROR | Environmental failure — provider down, disk full, missing env var. **Retry may succeed.** |
| 3 | GATE | Gated by an approval / readiness check (e.g., director storyboard.md not approved yet). **The command CAN succeed once the gate clears.** |

Agents decide retry strategy from the exit code. Code 1 means "fix the
input and retry"; code 2 means "investigate the system and try later";
code 3 means "do the gate-clearing work first, then retry."

### 3. Stable error codes

On any non-zero exit, stdout contains a JSON envelope with a stable
string `code` field. The full catalog lives at
[`schemas/video/errors.json`](../schemas/video/errors.json) and the
TS source-of-truth is `src/video/errors.ts` `ALL_ERROR_CODES`.

```json
{
  "code": "project_not_found",
  "message": "No workspace at projects/foo/",
  "details": { "slug": "foo" }
}
```

Codes are **stable** — once shipped, they never change name. New codes
get added; old ones may get a deprecation note but the string stays
working for old agents.

### 4. Single-call discovery: `vclaw schema --json`

Returns the full v3 contract in one call:

- `version`: the v3 release this dump comes from
- `commands`: array of `{name, usage, flags, aliases?}`
- `exitCodes`: the 0/1/2/3 taxonomy
- `errorCodes`: the full ALL_ERROR_CODES list
- `artifactSchemas`: every `schemas/video/artifacts/*.schema.json` embedded by name

Agents should call this once on first contact, then drive the CLI from
the dump without further introspection. Cheaper than per-command
`--help` parsing.

```bash
vclaw schema --json | jq '.commands | map(.name)'
```

## Noun-verb command conventions

v3 prefers noun-verb command shape (`vclaw video character list`) over
hyphenated forms (`vclaw video character-list`). Both work — every
kebab form has a noun-verb alias registered. The canonical name in
`vclaw schema --json` is the kebab form for now (backwards compat); v3.1
will switch the canonical form and alias the kebab.

See `vclaw schema --json | jq '.commands[] | {name, aliases}'` for the complete list.

**`vclaw veo *` subcommands** keep the Bun CLI's colon-separated form
(`useapi:accounts list`, not `useapi accounts list`). This matches the
underlying `bun run flow.ts` surface. Aliasing the colon to a space
would create confusion for users with existing scripts.

---

## Studio Planner

`vclaw studio` is the human-friendly planning front door. It maps goals such as
presenter video, UGC campaign, music video, copy-reference, review, and publish
to deterministic CLI commands.

```bash
vclaw studio --dry-run [--goal <goal>] [--project <slug>] [--intent <text>] [--input <path-or-url>] [--client <name>] [--duration <seconds>] [--write-session]
```

Supported goals:

- `create-video`
- `copy-reference`
- `presenter-video`
- `music-video`
- `ugc-campaign`
- `existing-project`
- `review-regenerate`
- `publish-deliver`

Studio is plan-only in Phase 1. It returns a command plan and optional
`studio-session.json` artifact, but it does not run provider generation.

---

## Veo (Bun bridge)

The `vclaw veo *` subcommand family bridges to the Bun-based
`vclaw-cli/flow.ts` for Google Flow access via Puppeteer. The Bun
runtime is required (install via `curl -fsSL https://bun.sh/install | bash`).

### Standard verbs

| Command | Purpose |
|---|---|
| `vclaw veo status [batchId]` | Show batch status. |
| `vclaw veo list` | List all batches. |
| `vclaw veo history [--limit <n>]` | Recent job history. |
| `vclaw veo resume [batchId]` | Resume a paused batch. |
| `vclaw veo reset` | Reset failed jobs to pending. |
| `vclaw veo cancel` | Cancel current batch. |

### UseAPI verbs

| Command | Purpose |
|---|---|
| `vclaw veo useapi:accounts list\|add` | Manage useapi.net accounts. |
| `vclaw veo useapi:captcha list \| --provider <name> --key <key>` | CAPTCHA providers. |
| `vclaw veo useapi:health` | Account health + history. |
| `vclaw veo useapi:image --image-prompt "..."` | Generate images. |
| `vclaw veo useapi:image:upscale --media-id <id> --resolution 2k\|4k` | Upscale images. |
| `vclaw veo useapi:gif --media-id <id> --output-file <path>` | Video → GIF (free). |
| `vclaw veo useapi:upscale --media-id <id> --resolution 1080p\|4k` | Upscale videos. |

See `vclaw schema --json | jq '.commands[] | select(.name | startswith("veo "))'` for the canonical list.

The legacy standalone form `bun run vclaw-cli/flow.ts <verb>` still
works in v3.0 but is being deprecated. Use `vclaw veo *` going forward.

---

## Project lifecycle

```bash
vclaw video init <slug> [--root <path>] [--mode storyboard|director]
vclaw video create "<intent>" [--project <slug>] [--root <path>] [--production-mode storyboard|director] [--title <title>] [--scenes <count>] [--style <preset>] [--color-grading <preset>] [--platform <name>] [--gb-character <Name:ID> ...] [--import-library-characters] [--auto-create-characters <json-path>] [--api-url <url>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--apply-content-fixes] [--execute] [--dry-run]
vclaw video brief --project <slug> --title <title> --intent <intent> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]
vclaw video storyboard-template-list
vclaw video storyboard-template-show --name <template-id>
vclaw video storyboard --project <slug> (--scene <text> [--scene <text> ...] | --template <template-id> [--environment <text>] [--character-a <name>] [--character-b <name>]) [--scene-character <sceneIndex:name> ...] [--root <path>]
vclaw video assets --project <slug> --asset <kind:path[:sceneIndex][:backend]> [--asset ...] [--root <path>]
vclaw video review-ui --project <slug> [--root <path>] [--host <host>] [--port <port>] [--ui-path <path>] [--dry-run]
vclaw video review-autopilot --project <slug> [--root <path>] [--template <template-id>] [--character <name>] [--run-id <id>]
vclaw video storyboard-grid --project <slug> [--root <path>] [--output <path>] [--width <px>] [--height <px>] [--dry-run]
vclaw video portal --project <slug> [--root <path>] [--client <name>] [--run <id>] [--surface edit|review|client-review|preview|compare|index]
vclaw video portal-index [--root <path>] [--client <name>] [--output <path>]
vclaw video publish-preview --project <slug> --client <name> --bucket <bucket> [--root <path>] [--run <id>] [--surface edit|review|client-review|preview|compare|index] [--public-base-url <url>] [--wrangler-bin <path>] [--dry-run]
vclaw video publish-portal-index --bucket <bucket> [--root <path>] [--client <name>] [--public-base-url <url>] [--wrangler-bin <path>] [--dry-run]
vclaw video review --project <slug> --verdict pass|retry|fail [--finding <text> ...] [--root <path>]
vclaw video publish --project <slug> --status ready|published|blocked [--final-output <path>] [--note <text> ...] [--root <path>]
```

For production image-to-video handoff, prefer `review-ui` or
`review-autopilot`. The simple `review --verdict pass` path is for projects
that already have equivalent review evidence outside the browser station.
Publishing remains blocked unless the saved `review-report.json` has
`verdict: "pass"` and `metrics.publishReady: true`.

## Preview review and delivery portal

The preview portal is the standardized static HTML layer for generated video
projects. It replaces one-off `preview.html`/`review.html` variants with
repeatable surfaces:

Portal rendering reads `template` or `previewTemplate` from `project.json` and
uses the built-in registry for `music-video`, `story-film`, `documentary`,
`product-ad`, `sports-recap`, and `generic-video` labels/section ordering.
It also reads project-scoped image entries from `artifacts/asset-manifest.json`
and renders them as generation inputs; Seedance-backed images appear under
`Seedance Input Frames` for music-video projects so reviewers can inspect the
exact start/upscaled frame being sent to Seedance 2.

| Command | Output |
|---|---|
| `vclaw video portal --project <slug>` | Writes `edit.html`, `review.html`, `client-review.html`, and `preview.html` in the project directory. |
| `vclaw video portal --project <slug> --surface compare` | Writes `compare.html` for version/run comparison. |
| `vclaw video portal-index` | Writes `projects/index.html` across all projects. |
| `vclaw video portal-index --client <name>` | Writes `projects/clients/<client>/index.html` for that client only. |
| `vclaw video publish-preview --dry-run ...` | Prints the Cloudflare R2 upload plan without side effects. |
| `vclaw video publish-preview ...` | Uploads referenced files with `wrangler r2 object put` and records a publish audit event. |
| `vclaw video publish-portal-index --client <name> ...` | Uploads a client index to `clients/<client>/index.html` with links into each uploaded run folder. |

Example local generation:

```bash
vclaw video portal \
  --project 2026-05-27_dhuaan-music-video \
  --root /path/to/video-workspace \
  --client "Acme Studios" \
  --run run-002
```

Example publish dry-run:

```bash
vclaw video publish-preview \
  --project 2026-05-27_dhuaan-music-video \
  --root /path/to/video-workspace \
  --client "Acme Studios" \
  --run run-002 \
  --surface preview \
  --bucket videoclaw-reviews \
  --public-base-url https://reviews.example.com \
  --dry-run
```

The publish plan includes the HTML file plus local `src`/`href` references,
content types, R2 keys, SHA-256 hashes, and public URLs when a base URL is
provided. Running without `--dry-run` requires `wrangler` to be installed and
authenticated. `--wrangler-bin` can point to a specific Wrangler executable
when running from automation.

Project surfaces publish under
`clients/<client>/<project>/runs/<run>/<surface>.html`. Published client
indexes link to those run folders, so a client with six generations can open
`clients/<client>/index.html` and choose among all six project/run previews.

`vclaw video create` is the clean-room front door for the legacy “one command
to start a project” mental model. In its current form it:

- initializes the project when needed
- writes canonical `brief` and `storyboard` artifacts
- scaffolds storyboard-seed assets for execution planning
- records Go Bananas character bindings as project character profiles
- can import exact-name Go Bananas matches from the story intent when `--import-library-characters` is present
- can auto-create missing Go Bananas characters from a JSON seed file via `--auto-create-characters <json-path>`
- carries execution-profile overrides (`aspect-ratio`, `quality`, `resolution`,
  `audio`, `outputs`) into the canonical brief and status surfaces
- generates `storyboard.md` automatically for `director` mode
- optionally hands off to the existing `execute` path when `--execute` is present

For `director` mode, this means the first-run path now supports the same
storyboard-first approval pattern as the older workflow surface, while still
writing canonical clean-room artifacts underneath.

## Analysis and templates

```bash
vclaw video analyze --project <slug> --source <path-or-url> [--title <title>] [--beat <text> ...] [--keep <text> ...] [--change <text> ...] [--var <text> ...] [--auto]
vclaw video analyze-template --project <slug> --source <path-or-url> [options] [--auto]
vclaw video prompt-lib-list
vclaw video prompt-lib-show --name <reference-name> [--root <path>]
vclaw video template-create --project <slug> --name <template-name> [--root <path>]
vclaw video template-save --project <slug> --name <template-name> [--root <path>]
vclaw video template-list [--root <path>]
vclaw video template-show --name <template-name> [--root <path>]
vclaw video template-validate --name <template-name> [--root <path>]
vclaw video clone-ad --template <template-name> --project <slug> --intent <text> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--dry-run]
vclaw video clone-plan --template <template-name> --project <slug> --intent <text> [--root <path>]
vclaw video clone-init --template <template-name> --project <slug> --intent <text> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]
vclaw video storyboard-from-clone --project <slug> [--root <path>] [--mode storyboard|director]
vclaw video clone-execute --template <template-name> --project <slug> --intent <text> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--dry-run]
```

When `--auto` is present on `analyze` / `analyze-template`, the clean-room repo
uses the Gemini HTTP path to fill the analyze artifact automatically. It reads
keys from `GEMINI_API_KEYS`, `GOOGLE_API_KEYS`, or `GOOGLE_API_KEY`, and you can
override the endpoint with `VCLAW_GEMINI_API_ENDPOINT`.

Analyze artifacts can now carry optional clone-planning fields:

- `styleLayers`
- `beatCompression`
- `technicalNotes`
- `dialogueNotes`

Saved templates preserve those fields and clone plans copy them forward with a
`workflowChecklist` so operators can keep the reusable mechanism while replacing
brand, product, audience, proof, and offer details.

## Project management

```bash
vclaw video set-meta --project <slug> [--root <path>] [--owner <name>] [--priority low|medium|high|critical] [--due YYYY-MM-DD] [--tag <value> ...] [--blocked-by <slug> ...] [--blocked-reason <text>]
vclaw video set-execution-profile --project <slug> [--root <path>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]
vclaw video character-add --project <slug> --name <name> [--gb-id <id>] [--description <text>] [--ref <path> ...] [--note <text> ...] [--root <path>]
vclaw video character-auto-create --project <slug> --input <json-path> [--root <path>] [--api-url <url>] [--dry-run]
vclaw video character-import-library --project <slug> --intent "<text>" [--root <path>] [--api-url <url>]
vclaw video character-list --project <slug> [--root <path>]
vclaw video character-show --project <slug> --name <name> [--root <path>]
vclaw video character-consistency --project <slug> [--root <path>]
vclaw video find-library --intent "<text>" [--api-url <url>]
vclaw video library find --intent "<text>" [--api-url <url>]
vclaw video library clean [--ids <csv>] [--name-regex <pattern>] [--bloated] [--max-prompt-chars <n>] [--dry-run] [--yes]
vclaw video library clean --patch <id> --base-prompt <text> [--dry-run]
vclaw video status --project <slug> [--root <path>] [--mode storyboard|director]
vclaw video readiness --project <slug> [--root <path>] [--mode storyboard|director]
vclaw video plan --project <slug> [--root <path>] [--mode storyboard|director]
vclaw video execution-plan --project <slug> [--root <path>] [--mode storyboard|director]
vclaw video produce --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run]
vclaw video execute --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run]
vclaw video execute-status --project <slug> [--root <path>] [--mode storyboard|director]
vclaw video execute-cancel --project <slug> [--root <path>] [--mode storyboard|director]
vclaw video assemble --project <slug> [--root <path>] [--brand-profile <path>] [--dry-run]
vclaw video review-ui --project <slug> [--root <path>] [--host <host>] [--port <port>] [--ui-path <path>] [--dry-run]
vclaw video review-autopilot --project <slug> [--root <path>] [--template <template-id>] [--character <name>] [--run-id <id>]
vclaw video artifact-history --project <slug> --artifact <name> [--root <path>]
vclaw video doctor-project --project <slug> [--root <path>] [--mode storyboard|director]
```

Primary lifecycle names are now `plan` and `produce`. `execution-plan` and `execute`
remain supported as compatibility aliases over the same handlers.

`vclaw video review-ui` starts the local human-in-the-loop review station. It
serves the bundled Review UI asset by default, exposes project inventory at
`/api/review-inventory`, and lets the operator save the current decision ledger
to `projects/<slug>/artifacts/review-ui-ledger.json`. Saving also derives
`reference-board.json`, `director-seedance-plan.json`,
`storyboard-stills-plan.json`, `scene-selection.json`,
`gobananas-character-brief.json`, `post-plan.json`, and `review-report.json` so the next agent has
concrete production artifacts rather than a loose UI note. Publish handoff is
canonical only when that saved `review-report.json` has `verdict: "pass"` and
`metrics.publishReady: true`; stale checkpoints or legacy pass reports without
that metric remain review work. Use it when a project needs storyboard,
reference, character, motion-plan, or final assembly choices before the next
agent step. Use `--ui-path <path>` only when testing a local replacement UI.

The review station is explicitly aligned to
`docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md`. Its director defaults
record the expected professional workflow in the saved ledger: script/voiceover
first, role-tagged references, still-frame lock, upscaled Seedance inputs,
start/end frame chaining, control plus short-variant motion prompts, bridge poses
for hard actions, continuity-frame extraction, and post retiming.

`vclaw video review --verdict pass` remains the simple artifact-stage approval
command for projects that were already reviewed outside the browser station. It
writes `review-report.json` with `metrics.publishReady: true`, so use it only
when the operator has equivalent evidence. For director image handoffs, prefer
`review-ui` or `review-autopilot`; those paths derive `publishReady` from locked
scene candidates, artifact-backed 4K stills, character-match checks, and final
assembly approvals.

For the operator-facing step-by-step workflow, see
`docs/REVIEW_UI_STORYBOARD_WORKFLOW.md`.

`vclaw video review-autopilot` is the non-interactive counterpart for projects
that already have storyboard still candidates. It selects and locks the best
completed still per scene, creates artifact-backed upscaled handoff candidates
from local still assets where possible, fills the final approval checks, and
writes the same `review-report.json` readiness truth as the browser station. It
does not submit video generation jobs.

## Go Bananas library cleanup

`vclaw video library clean` is the clean-room port of the legacy character
library hygiene tool. It supports:

- listing cleanup candidates by explicit IDs, name regex, or bloated prompt size
- dry-run review before deletion
- prompt patching for a single library character without deleting it

`vclaw video find-library` and `vclaw video library find` provide the
exact-name intent lookup used by the migrated Director lane. They extract
capitalized candidate names from the intent and call the Go Bananas
`exact=true` search path so reuse stays conservative.

## Reference sheets

```bash
vclaw video reference-sheet-add --project <slug> --type <identity|outfit-material|environment|motion-camera|palette-mood> --name <name> [--id <id>] [--description <text>] [--character-name <name>] [--ref <path>:<role>[:<note>] ...] [--gb-ref <kind>:<id>:<role>[:<note>] ...] [--binding <sceneIndex> ...] [--root <path>]
vclaw video reference-sheet-list --project <slug> [--type <sheet-type>] [--root <path>]
vclaw video reference-sheet-show --project <slug> --id <sheet-id> [--root <path>]
vclaw video reference-sheet-bind --project <slug> --id <sheet-id> --scene <sceneIndex> [--scene <sceneIndex> ...] [--root <path>]
vclaw video reference-sheet-validate --project <slug> [--root <path>]
```

Reference sheets are role-tagged, per-scene-bound references that the
readiness, preflight, and ops surfaces treat as first-class state. Every
sheet has one of five types, each with a closed role vocabulary:

- `identity` — `identity`, `wardrobe`, `silhouette`, `age-reference`
- `outfit-material` — `outfit`, `material`, `accessory`, `texture`, `product-hero`, `product-variant`, `product-in-use`, `packaging`
- `environment` — `location`, `set-dressing`, `weather`, `time-of-day`
- `motion-camera` — `motion-rhythm`, `camera-behavior`, `blocking`, `shot-framing`
- `palette-mood` — `palette`, `composition`, `mood`, `lighting-reference`

`--gb-ref` accepts the five Go Bananas kinds: `character`, `product`,
`scene`, `style-preset`, and `reference-group`. The `product` kind pairs
with the extended `product-*` roles on `outfit-material` sheets.

Full operator guide: [`docs/REFERENCE_SHEETS.md`](./REFERENCE_SHEETS.md).

## Scene candidates and selection

```bash
vclaw video candidates-list --project <slug> [--scene <sceneIndex>] [--root <path>]
vclaw video candidates-show --project <slug> --candidate-id <id> [--root <path>]
vclaw video storyboard-still-add --project <slug> --scene <sceneIndex> --image-url <url> [--image-id <id>] [--prompt <text>] [--notes <text>] [--root <path>]
vclaw video select-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]
vclaw video reject-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]
vclaw video reroll-scene --project <slug> --scene <sceneIndex> [--chain-from-prev on|off] [--root <path>]
vclaw video chain-from --project <slug> --scene <sceneIndex> --from <sourceSceneIndex> [--root <path>]
vclaw video unchain --project <slug> --scene <sceneIndex> [--root <path>]
vclaw video candidates-migrate-from-assets --project <slug> [--dry-run] [--root <path>]
```

Scene candidates are the output-layer counterpart to reference sheets. The
execute runtime writes every generated take into
`projects/<slug>/artifacts/scene-candidates.json` (append-only) and records
operator selection, rejections, pending ids, reroll state, and chain-from-prev
into `projects/<slug>/artifacts/scene-selection.json` (mutable).

`storyboard-still-add` records generated storyboard still images, such as Go
Bananas still outputs, into the same scene-candidate artifact with `kind:
image`. This lets the image/storyboard review loop reuse the existing
candidate-selection commands before any video generation happens.

`produce` and `execute` also accept one or more `--scene <sceneIndex>` flags
for partial reruns: only the listed scenes get a new generation round, every
other scene stays on its currently-selected candidate.

`chain-from` is v1-limited to chain-from-prev, so `--from` must equal
`--scene - 1`. Any other source returns `chain-from-unsupported`.

Full operator guide: [`docs/SCENE_CANDIDATES.md`](./SCENE_CANDIDATES.md).

## Director approval gate

For `director` mode, `vclaw video produce` and `vclaw video execute` now export
`projects/<slug>/storyboard.md` and block before provider submission unless
`VIDEOCLAW_APPROVE_STORYBOARD=1` is present in the environment. This preserves
the legacy two-step storyboard-review flow without requiring the long smoke path.

When a live job is already in flight, `vclaw video execute-cancel` attempts to
cancel it through the configured adapter surface and records the cancellation
into the project execution report and event timeline.

At the moment, the built-in native cancel path exists for `seedance-direct`.
Other routes may return an explicit `unsupported` cancellation result rather
than silently pretending the job was cancelled.

That review file now includes a character-binding table for referenced scene
characters, including any stored Go Bananas ids and reference assets.

## Assemble stage

`vclaw video assemble --project <slug>` runs the post-execution assembly
pipeline in order: (optional) PDF slide extraction, (optional) branded title
card, per-slide animation, per-scene TTS narration, (optional) background-music
bed, and the final FFmpeg stitch — then advisory QA (dialogue/narration/image
filter) whose findings land in the report `warnings`. It writes a typed
`assemble-report.json` artifact (schema: `schemas/video/artifacts/assemble-report.schema.json`).

`--dry-run` plans the entire pipeline (every FFmpeg command + provider call,
recorded into the manifest and `events`) WITHOUT executing anything or needing
ffmpeg or any API key — this is the agent-safe planning surface. `--brand-profile <path>`
supplies the presenter knobs (voice, intro/outro segments, optional deck/music/
title-card config). Real (non-dry-run) assembly spawns FFmpeg and calls the TTS
and music providers; verifying the rendered MP4 looks/sounds correct is a human
integration checkpoint.

The JSON returned by `vclaw video status` now also includes referenced
`characterBindings` so project-facing status surfaces can show the same identity
anchors without reparsing `storyboard.md`.

`vclaw video readiness` now also includes a `warnings` array. Current warnings
include image-input aspect/size problems and non-blocking identity-sheet quality
signals such as `reference-sheet-thin-identity-coverage`.

`vclaw video status` now also includes:

- `characterProfiles`
- `characterHydrationSummary`

so a later inspection can still show how the cast was assembled after the
initial `video create` response is gone.

When a review file has been generated, `status` and the project index also carry
the `storyboardReviewPath` so review tooling can link directly to the current
artifact.

The same `storyboardReviewPath` now flows through:

- `vclaw video report`
- `vclaw video export-csv`
- `vclaw video export-obsidian`
- `vclaw video sync-obsidian` dashboard views
- `vclaw video next-actions` when approval is waiting on storyboard review

The `Next Actions.md` note generated by `sync-obsidian` now includes the same
review link when a project is waiting on storyboard approval.

When present, `next-actions` also carries `storyboardReviewGeneratedAt`, and the
generated note includes that freshness inline with the review link.

`vclaw video doctor-project` now also flags projects whose storyboard checkpoint
is `awaiting-approval` but whose `storyboard.md` review artifact is missing.

`vclaw video doctor-portfolio` now also reports a portfolio-level
`missingStoryboardReviewProjects` count for the same workflow invariant.

It now also reports `staleStoryboardReviewProjects` when approval is pending but
the storyboard changed after the last generated review.

`vclaw video storyboard-review` now also appends a `storyboard.review.generated`
event, so the review workflow shows up in timeline-style exports and history.

When stale review blocks execution, the runtime now emits a
`storyboard.review.stale.blocked` event so timeline/history surfaces capture the
enforcement step as well.

When review events exist, `status` and `index` now also expose
`storyboardReviewGeneratedAt` alongside `storyboardReviewPath`.

The same surfaces now also expose `storyboardReviewExists`, so tooling can tell
whether a review has ever been generated before trying to reason about freshness.

They now also expose a normalized `storyboardReviewState` field with one of:

- `missing`
- `current`
- `stale`

The same `storyboardReviewState` now flows through:

- `vclaw video report`
- `vclaw video export-csv`
- `vclaw video export-obsidian`
- `vclaw video sync-obsidian` dashboard views
- `vclaw video next-actions`

`vclaw video report-diff` now also exposes:

- `reviewStateChanged` when the review-state ladder changes between snapshots
- `platformChanged` when the stored project platform changes between snapshots
- `executionProfileChanged` when the normalized execution profile changes between snapshots
- `legacyImportChanged` when captured legacy import diagnostics change between snapshots

Its top-line summary now also carries deltas for:

- `legacyImportedProjectsDelta`
- `legacyQueueDriftProjectsDelta`
- `legacyNestedOutputProjectsDelta`

The same `storyboardReviewExists` now flows through:

- `vclaw video report`
- `vclaw video export-csv`
- `vclaw video export-obsidian`
- `vclaw video sync-obsidian` dashboard views

The same `storyboardReviewGeneratedAt` now flows through:

- `vclaw video report`
- `vclaw video export-csv`
- `vclaw video export-obsidian`
- `vclaw video sync-obsidian` dashboard views

When the storyboard changes after the latest review generation, `status` now
marks the review stale and `next-actions` prioritizes refreshing the review
artifact before approval.

The same stale-review signal now flows through:

- `vclaw video report`
- `vclaw video export-csv`
- `vclaw video export-obsidian`
- `vclaw video sync-obsidian` dashboard views

That same stale-review signal now gates director runtime operations as well:

- `vclaw video execute`
- `vclaw video execute-status`

The same referenced `characterBindings` now flow through:

- `vclaw video report`
- `vclaw video export-csv`
- `vclaw video export-obsidian`
- `vclaw video index`
- `vclaw video sync-obsidian`

The same cast provenance now also flows through:

- `vclaw video status`
- `vclaw video index`
- `vclaw video report`
- `vclaw video export-csv`

The same review file now includes a focused director preflight result. Current
preflight coverage includes:

- provider-risk content hazard detection
- stored Go Bananas id resolution and reference-image presence checks
- remote reference-asset probe failures
- pronoun drift warnings against known character descriptions
- repeated adjacent-scene warnings
- prompt-quality warnings/errors from `docs/PROMPT_QUALITY.md`
- dialogue duration fit warnings/errors (`DIALOGUE_DURATION_OVERFLOW`)
- reference-sheet validation and Go Bananas reference checks

Supported env controls for this flow:

- `DIRECTOR_AUTO_FIX_CONTENT=1`
  auto-rewrites known provider-risk phrases before preflight re-checks the storyboard
- `SKIP_DIRECTOR_PREFLIGHT=1`
  bypasses the preflight step and goes straight to the storyboard approval gate
- `DIRECTOR_STRICT_PROMPT_QUALITY=1`
  promotes prompt-quality warnings to blocking errors
- `DIRECTOR_STRICT_DIALOGUE_FIT=1`
  promotes dialogue duration warnings to blocking errors

Direct CLI surface:

```bash
vclaw video director-preflight --project <slug> [--root <path>] [--apply-content-fixes]
vclaw video preflight --project <slug> [--root <path>] [--apply-content-fixes]
vclaw video storyboard-review --project <slug> [--root <path>] [--mode storyboard|director] [--apply-content-fixes]
```

For `director` mode, `storyboard-review` now writes `storyboard.md` and, when
preflight passes, marks the storyboard checkpoint `awaiting-approval` without
starting execution.

Projects in `awaiting-approval` now surface as `needs-review` across the index,
dashboard, and metrics layer instead of generic `active`.

Portfolio metrics now also expose `staleStoryboardReviewProjects` so stale
approval reviews are visible in the summary layer.

They also expose `unreviewedStoryboardProjects`, which counts projects that have
not generated a storyboard review yet.

They now also expose `byReviewState` with explicit `missing`, `current`, and
`stale` counts.

## Live execution adapters

`vclaw video produce` submits a JSON payload to a route-specific adapter command
via `stdin`. Configure one of:

```bash
VCLAW_VEO_DIRECT_ADAPTER
VCLAW_VEO_USEAPI_ADAPTER
VCLAW_SEEDANCE_DIRECT_ADAPTER
VCLAW_RUNWAY_USEAPI_ADAPTER
```

The adapter should print JSON to `stdout`. If `produce` returns `externalJobId`,
`vclaw` records that in the execution report and leaves the assets stage `pending`.
`execute-status` then sends a poll request to the same adapter and, on completion,
merges generated outputs into the canonical asset manifest and advances the project
to `review`.

For built-in core-route adapters:

```bash
VCLAW_SEEDANCE_DIRECT_SUBMIT_CMD
VCLAW_SEEDANCE_DIRECT_POLL_CMD
VCLAW_VEO_DIRECT_SUBMIT_CMD
VCLAW_VEO_DIRECT_POLL_CMD
```

If `VCLAW_SEEDANCE_DIRECT_ADAPTER` or `VCLAW_VEO_DIRECT_ADAPTER` is unset,
`vclaw` automatically falls back to the built-in adapter binary for that route.

Every produce and execute-status path appends `generation.telemetry.recorded`
events to `projects/<slug>/events/events.jsonl`. These records capture route,
operation, task count, prompt/reference summary, external job id, provider cost
fields, timing fields, issues, and output-ingest count when available.

For `seedance-direct`, if `VCLAW_SEEDANCE_DIRECT_SUBMIT_CMD` / `VCLAW_SEEDANCE_DIRECT_POLL_CMD`
are also unset, the built-in adapter can talk directly to the Seedance API using:

```bash
SUTUI_API_KEY
VCLAW_SEEDANCE_BASE_URL   # optional, defaults to https://api.xskill.ai
```

For `veo-direct`, if `VCLAW_VEO_DIRECT_SUBMIT_CMD` / `VCLAW_VEO_DIRECT_POLL_CMD`
are unset, the built-in adapter can run the local `vclaw-cli` workspace using:

```bash
VCLAW_VEO_CLI_ROOT        # optional, defaults to <workspace>/vclaw-cli
VCLAW_VEO_BUN_BIN         # optional, defaults to bun
VCLAW_VEO_OUTPUT_DIR      # optional, defaults to <vclaw-cli>/output-videos
```

## Execution profile normalization

`plan` now emits a normalized execution profile and the runtime uses it.

Supported fields:

1. `aspectRatio`
2. `quality`
3. `resolution`
4. `generateAudio`
5. `outputCount`

You can override them through brief metadata:

```json
{
  "executionProfile": {
    "aspectRatio": "9:16",
    "quality": "quality",
    "resolution": "1080p",
    "generateAudio": false,
    "outputCount": 2
  }
}
```

The same profile can now be set directly from the CLI through:

1. `brief`
2. `clone-init`
3. `clone-execute`
4. `set-execution-profile`

## Cost estimates

```bash
vclaw video cost-estimate [--project <slug>] [--root <path>] [--scenes <count>] [--clip-duration <seconds>] [--new-characters <count>] [--narration on|off]
```

Direct flag estimates use the static model. Project estimates infer scene count,
average duration, narration, and new-character count from project artifacts when
possible. If completed `seedance-direct` telemetry with provider-reported USD is
available under the same root, the estimate reports `historical-telemetry` in
`estimateSource` and includes a `telemetry` summary. Otherwise it reports
`static-default`.

## Compatibility aliases

1. `omx` works as a temporary alias for `vclaw`
2. `execution-plan` remains an alias for `plan`
3. `execute` remains an alias for `produce`
4. deprecation notices are written to `stderr` so JSON `stdout` stays machine-readable

## Multi-shot prompt

```bash
vclaw video multi-shot (--presets | --plan | --validate | --fix | --auto) [flags]
```

Scaffolds, validates, and (via Gemini) authors **compressed timecoded multi-shot
cinematic prompts** — structured shot sequences targeting a fixed duration (default
15 s) with enforced non-repeating camera parameters and a Location/Style/Audio
metadata block.

### Modes

| Flag | Purpose |
|---|---|
| `--presets` | List the registered preset contracts as JSON for agents and UIs. |
| `--plan` | Scaffold a shot grid (timecodes + suggested camera parameters) without prose. |
| `--validate` | Check an existing prompt text against the preset rules. Reads from `--file <path>` or stdin. Exits `0` if valid, `1` if errors are found. |
| `--fix` | Apply conservative deterministic fixes and return a before/after validation report. Reads from `--file <path>` or stdin. |
| `--auto` | Author the full prompt via Gemini (requires `--image <path>` and a configured Gemini key pool, or `VCLAW_MULTISHOT_AUTO_STUB` for offline/testing). |

### Flags

| Flag | Default | Description |
|---|---|---|
| `--preset <name>` | `cinematic-15s` | One of `cinematic-15s` (default, 15 s / 3–7 shots / 1500 chars), `seedance-10s` (10 s / 2–5 shots / 1500 chars), `veo-8s` (8 s / 2–4 shots / 1500 chars), `runway-10s` (10 s / 2–5 shots / 1000 chars). Each preset declares its own clip duration, shot-count window, per-shot duration bounds, and char budget; the Nolan `styleLine` and diegetic `audioLine` are shared. Override with `--style-line` / `--audio-line`. Unknown names fail fast. |
| `--provider <name>` / `--route <name>` | — | Provider hint used when `--preset` is omitted. `seedance*` resolves to `seedance-10s`, `veo` / `flow` resolves to `veo-8s`, and `runway*` resolves to `runway-10s`. |
| `--from-storyboard` | false | Hydrate `--plan` or `--auto` from a project storyboard scene. Requires `--project <slug>` and `--scene <sceneIndex>`. |
| `--shots <n>` | auto (preset window) | Exact shot count for `--plan`. Must fall within the resolved preset's `[minShots, maxShots]`; out-of-range values fail fast. |
| `--seed <n>` | random | PRNG seed for reproducible plans. |
| `--total-seconds <n>` | 15 | Total clip duration in seconds. |
| `--max-chars <n>` | 1500 | Character budget enforced by `--validate`. |
| `--style-line <text>` | cinematic-15s default | Override the `Style:` metadata line. |
| `--audio-line <text>` | cinematic-15s default | Override the `Audio:` metadata line. |
| `--image <path>` | — | Reference image path; required for `--auto`. |
| `--location <text>` | — | Scene location written into `Location:` block. |
| `--time <text>` | `natural daylight` | Time of day written into `Location:` block. |
| `--character <text>` | — | Character description hint passed to Gemini. |
| `--action <text>` | — | Action description hint passed to Gemini. |
| `--dry-run` | false | With `--auto`: print the resolved request and validation contract without reading the image or calling Gemini. |
| `--explain-issues` | false | With `--validate`: add stable repair guidance for each unique issue code. |
| `--retry-invalid <n>` | `0` | With `--auto`: retry validation failures up to `n` extra times, feeding the previous issue codes/messages back into the authoring request. |
| `--project <slug>` | — | Persist the result as a `multi-shot-prompt` artifact under the named project. |
| `--root <path>` | `cwd` | Workspace root (used with `--project`). |
| `--raw` | false | With `--auto`: print only the prompt body, no JSON envelope. |

### Output

`--presets` emits JSON: `{ presets[] }` with every registered preset and its duration, shot-count, per-shot-duration, character-budget, style, and audio contract.

`--plan` emits JSON: `{ preset, shots[] }`. The `preset` object carries `name`, `totalSeconds`, `minShotSeconds`, `maxShotSeconds`, `minShots`, `maxShots`, `maxChars`, `styleLine`, and `audioLine`. Each shot has `index`, `start`, `end`, `timecode`, `shotSize`, `lens`, `angle`, `movement`. With `--from-storyboard`, output also includes `source` and resolved `input` so agents can see exactly which scene, characters, action, location, and time of day were used.

`--validate` emits JSON: `{ valid, charCount, issues[] }` where each issue has `code`, `severity`, `message`. With `--explain-issues`, it also emits `explanations[]` containing `code`, `summary`, and `suggestedFix`. Exit code `1` when any issue has `severity: "error"`.

`--fix` emits JSON: `{ original, fixed, appliedFixes[] }`. The first version is deliberately conservative: it normalizes whitespace and can add missing metadata from the resolved preset plus `--location` / `--time`. It does not creatively rewrite shot prose or timecodes.

`--auto` emits JSON: `{ preset, location, timeOfDay, shots, promptText, charCount, valid, issues, attempts, generatedAt }`. The `shots[]` array is parsed from the authored prompt so project artifacts are usable by downstream review and execution code. `attempts[]` records every validation attempt when `--retry-invalid` is used. With `--from-storyboard`, output and persisted artifacts also include `source`. With `--raw`, prints only `promptText`. With `--dry-run`, it emits `{ mode, dryRun, preset, source?, input, validationContract }` and makes no model call.

> **Note:** When `--project` is supplied, the artifact is persisted to disk even when validation fails (`valid: false`); the issues array is recorded and the process exits with code `1`. A persisted artifact does **not** imply the prompt passed validation — always check the `valid` field.

Project `status` and `readiness` surfaces summarize the latest `multi-shot-prompt` artifact with preset, validity, shot count, issue count, generation time, and storyboard source metadata. Invalid multi-shot artifacts are warnings, not hard readiness blockers, because the artifact is optional until a workflow explicitly chooses to render from it.

### Worked example

```bash
# 0. Discover preset contracts
vclaw video multi-shot --presets

# 1. Generate a 5-shot plan (reproducible with --seed)
vclaw video multi-shot --plan --shots 5 --seed 42

# 1b. Generate a provider-shaped plan from storyboard scene 0
vclaw video multi-shot --plan --from-storyboard \
  --project my-project --scene 0 --route seedance-direct

# 2. Validate an existing prompt file — exits 0 if clean
vclaw video multi-shot --validate --file my-prompt.txt --explain-issues

# 3. Validate from stdin
cat my-prompt.txt | vclaw video multi-shot --validate

# 4. Apply conservative deterministic fixes
vclaw video multi-shot --fix --file my-prompt.txt --location "Tokyo alley" --time "night"

# 5. Author and validate via Gemini (requires GEMINI_API_KEYS)
vclaw video multi-shot --auto \
  --image /path/to/ref.png \
  --location "Tokyo back alley" \
  --time "night" \
  --retry-invalid 2 \
  --project my-project

# 5b. Author from storyboard scene context and persist source metadata
vclaw video multi-shot --auto \
  --image /path/to/ref.png \
  --from-storyboard \
  --project my-project \
  --scene 0 \
  --provider veo

# 6. Print only the raw prompt body (no JSON wrapper)
vclaw video multi-shot --auto --image /path/to/ref.png \
  --location "Tokyo back alley" --time "night" --raw
```

**Tokyo-alley example** (5-shot, 15 s, cinematic-15s preset):

```
[00:00 - 00:04] Wide, 24mm, low angle, tracking — a man walks through a Tokyo alley.

[00:04 - 00:07] Medium, 50mm, eye-level, handheld — he moves between food stalls.

[00:07 - 00:09] Close-up, 85mm, high angle, static — his hand brushes a lantern.

[00:09 - 00:12] Wide, 35mm, Dutch angle, push-in — he emerges into a broad street.

[00:12 - 00:15] Medium close-up, 50mm, low angle, pull-out — he looks up at a sign.

Location: Narrow Tokyo alley, night.
Style: Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.
Audio: Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.
```

Validation rules enforced by `--validate` / `--auto`:
- Timecodes must start at `00:00`, be contiguous (no gaps), and total exactly `--total-seconds`.
- Each shot duration must be within `[minShotSeconds, maxShotSeconds]` (default 2–5 s).
- No camera parameter (shot size, lens, angle, movement) may repeat in consecutive shots.
- Prompt must not exceed `--max-chars`.
- A `Location:` / `Style:` / `Audio:` metadata block must be present.

Full framework rules and the variation guide: `vclaw video prompt-lib-show --name multi-shot-framework`.

## Filmmaking prompt packets

```bash
vclaw video filmmaking-prompts --project <slug> [--root <path>] [--duration <seconds>] [--panels 9|12|15|20] [--detail terse|standard|rich] [--storyboard-grid <path>] [--genre live-action|pixar|anime|noir|influencer|action|music-video] [--aspect-ratio 16:9|9:16] [--no-faces] [--write]
```

Generates the first-class prompt packet layer derived from the
`ai-filmmaking` workflow. This command is deterministic: it reads existing
project artifacts and writes no model output unless `--write` is provided.

`--genre` is a swappable style parameter (the skill is genre-agnostic): it sets
the character-sheet STYLE block, the storyboard grid style descriptors, and the
Seedance FORMAT tone, and selects the annotation third line (MOOD by default,
VOICE for `influencer`/vlog, STYLE for `action`/martial-arts). Aliases like
`photoreal`→`live-action`, `3d`→`pixar`, `vlog`→`influencer` resolve
automatically; an unknown value passes through as a free-form descriptor.
`--aspect-ratio` (default `16:9`; use `9:16` for vertical/social) is stated in
every template and every shot. `--no-faces` renders the storyboard grid in a
silhouette / no-frontal-face register so it survives real-person content
filters when used as a provider `reference_image`. `--detail terse|standard|rich`
(default `standard`) sets cinematography language density: `terse`/`standard`
emit today's phrasing unchanged, while `rich` appends a quantified suffix
(lens mm, Kelvin + key-angle, color-grade hue°/sat%, audio dB hierarchy, move
velocity in ft/s) from the shared `src/video/cinematography.ts` emitters.

The packet includes:

- `characterSheetPrompts[]` — 8-view character reference sheet prompts. When a
  character already has reference assets, the prompt uses reference-image mode
  and avoids re-describing the image; otherwise it uses a concise description.
  Descriptions over 60 words warn; over 100 words are flagged as an error
  (the skill's bloat/scene-contamination failure threshold).
- `storyboardGridPrompt` — a multi-panel cinematic storyboard grid prompt.
  `--panels` (9/12/15/20, default 15) sets the adaptive grid layout
  (3×3 / 3×4 / 3×5 / 4×5, transposed for vertical `--aspect-ratio`), each panel
  carries a per-panel timecode and a CAM / MOVE / (MOOD|VOICE|STYLE)
  production-note strip, and beats follow a three-act progression
  (setup → inciting → rising → climax → denouement). `rows`/`cols` are recorded
  on the prompt for the deterministic `storyboard-grid` renderer.
- `referenceMap[]` — stable `@image1`, `@image2`, ... slots for character
  sheets, storyboard grid, and per-scene start frames.
- `seedancePackets[]` — per-scene Seedance prompt packets. If character sheets
  and a storyboard grid are available, the packet uses the higher-fidelity
  character-sheets-plus-storyboard-grid variant; otherwise it falls back toward
  grid-only or text-driven prompting.
- `issues[]` — prompt-authoring warnings such as missing character
  descriptions, pending storyboard-grid images, or the default `NO MUSIC`
  policy.

By default Seedance packets use `15` seconds, matching the ai-filmmaking rule
that Seedance 2.0 generations should use the full available runtime unless the
operator explicitly requests a shorter duration.

Use `--storyboard-grid <path>` after the 9-panel board image has been generated
from `storyboardGridPrompt.promptText`. That path marks the storyboard-grid slot
as `ready`, removes the pending-grid warning, and makes the grid eligible for
Seedance execution. Without it, the slot remains reserved but pending.

To generate a deterministic local review board from the packet panels:

```bash
vclaw video storyboard-grid \
  --project 2026-05-27_dhuaan-music-video \
  --root /path/to/video-workspace
```

This writes `projects/<slug>/assets/storyboard-grid.png`, updates the
storyboard-grid slot in `filmmaking-prompts.json` to `ready`, removes the
pending-grid warnings, and snapshots the updated artifact. The rendered board is
not a replacement for an image-model-generated cinematic grid; it is the
reviewable production-board fallback and a stable attachment point for the
Seedance reference workflow.

## Seedance Asset Library (character consistency)

```bash
vclaw video seedance-register-assets --project <slug> --character <name>:<imageUrl> [--character ...] [--group <name>] [--root <path>]
```

Registers character reference images as **xskill Asset Library avatars** and
returns their `Asset://` URIs — the official `ark/seedance-2.0` mechanism for
locking character identity across shots. Passing raw photoreal image URLs in
`reference_images` trips the "real person" content filter and does not lock
identity; managed assets pass the filter and lock the character (validated
2026-05-29: identical to the proven endpoint `ep-…`).

- Each `--character` is `<name>:<publicImageUrl>` (the image must be a public
  http(s) URL). `--group` defaults to `<slug>-cast`.
- Requires `SUTUI_API_KEY` in the environment.
- Ensures the Asset group, creates each asset, waits for it to sync to the
  international Ark profile (`sync_status: active`), and writes
  `projects/<slug>/artifacts/seedance-assets.json` (name → `Asset://` URI).
- Feed the resulting `Asset://` URIs into execution as scene reference paths —
  `native-seedance.ts` already routes `Asset://` references into
  `reference_images` on `ark/seedance-2.0`.

Example:

```bash
vclaw video filmmaking-prompts \
  --project 2026-05-27_dhuaan-music-video \
  --root /path/to/video-workspace \
  --storyboard-grid projects/2026-05-27_dhuaan-music-video/assets/storyboard-grid.png \
  --write
```

With `--write`, the packet is saved to
`projects/<slug>/artifacts/filmmaking-prompts.json` and snapshotted in artifact
history. This artifact is intended to feed the preview portal and Seedance
execution layer so the operator can inspect exactly which prompt variant,
reference slots, duration, and start frames are being used.

During execution, videoclaw only consumes Seedance packets whose references are
all marked `ready` and have concrete paths. Ready packets override the scene
animation prompt, duration, and reference list; pending packets are ignored and
execution falls back to the normal storyboard plus asset manifest inputs. This
prevents incomplete prompts such as `@image3` storyboard-grid references from
being submitted before the matching image exists.

## Prompt library

`prompt-lib-list` and `prompt-lib-show` expose imported reference assets for:

1. Seedance formulas
2. Veo prompting guidance
3. style template schema
4. stage directors
5. checkpoint protocol
6. generation telemetry
7. dialogue duration preflight
8. character reference sheets
9. clone-ad template workflow
10. multi-shot cinematic prompt framework

## Portfolio operations

```bash
vclaw video list [--root <path>]
vclaw video index [--root <path>] [--output <path>]
vclaw video metrics [--root <path>] [--mode storyboard|director]
vclaw video workload [--root <path>] [--mode storyboard|director]
vclaw video next-actions [--root <path>] [--mode storyboard|director]
vclaw video dependencies [--root <path>] [--mode storyboard|director]
vclaw video doctor-portfolio [--root <path>] [--mode storyboard|director]
vclaw video report [--root <path>] [--mode storyboard|director]
vclaw video report-snapshot [--root <path>] [--mode storyboard|director]
vclaw video report-history [--root <path>]
vclaw video report-diff [--root <path>] [--from <snapshot-path>] [--to <snapshot-path>]
vclaw video trends [--root <path>]
vclaw video export-csv [--root <path>] [--output-dir <path>] [--mode storyboard|director]
```

## Obsidian

```bash
vclaw video scaffold-obsidian-vault [--output-dir <path>]
vclaw video export-obsidian --project <slug> [--root <path>] [--output-dir <path>] [--mode storyboard|director]
vclaw video sync-obsidian [--root <path>] [--output-dir <path>] [--mode storyboard|director]
```

## Migration

```bash
vclaw video import-legacy --source <path> [--root <path>]
```

## MCP server

`vclaw mcp serve` starts a stdio MCP (Model Context Protocol) server
exposing read-only project introspection to MCP-aware agent hosts
(Claude Code, Codex, Cursor, Antigravity).

### Tools exposed (all read-only)

| Tool | Input | Returns |
|---|---|---|
| `list_projects` | `{ root? }` | All projects in the workspace |
| `get_project_status` | `{ slug, root? }` | Stage + checkpoint state for one project |
| `get_artifacts` | `{ slug, root? }` | The project's JSON artifacts |
| `get_event_log` | `{ slug, limit?, root? }` | Recent events from events.jsonl |
| `list_provider_routes` | `{ root? }` | Provider routes + availability |

**Writes go through the CLI, not MCP.** Per the agent-integration
research, the CLI is the deterministic action surface; MCP is for
live-state queries. To create/modify a project, an agent calls
`vclaw video *` commands directly.

### Configuring an MCP client

In a Claude Code / Codex / Cursor MCP config:

```json
{
  "mcpServers": {
    "videoclaw": {
      "command": "vclaw",
      "args": ["mcp", "serve"]
    }
  }
}
```
