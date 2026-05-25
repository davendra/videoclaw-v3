# Review UI Storyboard Workflow

This guide is the operator runbook for the human-in-the-loop storyboard review station. It is designed for the still-image phase only: characters, references, storyboard stills, 4k still handoff, and motion planning. It does not generate final videos.

Reference method: `docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md`.

## Start The Review Station

```bash
vclaw video review-ui --project <slug> --root .
```

Open:

```text
http://127.0.0.1:4317/review-ui?project=<slug>
```

The UI loads the project inventory from `/api/review-inventory?project=<slug>`
and saves decisions through `/api/review-decision?project=<slug>`.

## Let The Agent Do It

When the project already has storyboard still candidates, use the autopilot handoff:

```bash
vclaw video review-autopilot --project <slug> --root .
```

The autopilot path is for "just do it" operation. It selects the best available
completed still per scene, locks those stills, creates artifact-backed upscaled
handoff candidates from local still assets when possible, fills the Seedance
reference roles, approves the assembly checks, and writes the same artifacts as
the browser review station. It does not submit video jobs.

Use the browser afterward only to inspect or override the agent's choices.

## What The User Provides

The user should provide:

- Project slug, for example `launch-teaser`.
- Character choice, either an existing saved character or a Go Bananas character iteration request.
- Reference intent: which references control identity, pose, lookdev, background, prop, start frame, and end frame.
- Storyboard template, for example `product-commercial-4`.
- Generated storyboard still URLs or local image paths returned by Go Bananas or another image provider.
- Upscaled 4k still URLs or local paths for every locked scene.
- Final assembly approvals: voiceover fit, continuity cuts, retiming polish, logo/payoff reveal, and review report readiness.

The UI handles the sequence, gate checks, artifact writing, and handoff summaries.

## Step-By-Step Operator Flow

1. Inventory
   Check that the project, saved characters, templates, prompt references, schemas, and media assets are visible. This gate confirms the local project context is loaded.

2. Characters
   Select a saved character such as `Proofy`, or queue a Go Bananas character iteration request. For reusable character identity, prefer a saved Go Bananas character ID over one-off image prompts.

3. References
   Assign each reference one job. Identity should point to the character, lookdev/background/prop/UI structure can point to prompt references, and start/end frame roles should point to locked still candidates.

4. Storyboard
   Pick a template, then work scene by scene. For each scene:

   - Queue or create a Go Bananas still prompt.
   - Paste the returned image URL or local image path.
   - Review all candidates.
   - Reject wrong-character or placeholder candidates.
   - Lock the best generated still.
   - Attach the artifact-backed 4k/upscaled still.

5. Motion Plan
   Confirm the plan only. The review pass records Seedance instructions such as `control-pass`, `control-plus-short-variant`, `start-end-frame-chain`, and `bridge-hard-actions`. It does not prove video clips exist yet.

6. Assembly
   Approve pacing and final handoff checks. A completed review should show:

   ```text
   pass · locked 4/4 · character mismatches 0 · 4k assets 4/4 · publish ready
   ```

## Go Bananas Usage

Use Go Bananas for two distinct jobs:

- Character iterations: create or refine reusable character identity, then save it as a character profile.
- Storyboard stills: generate scene images with the saved character, using `16:9` still-image prompts.

For the checked-in Proofy example, the canonical character is:

```text
Proofy, Go Bananas character ID 249
```

Komo is a separate existing character identity and should not be reused for Proofy scenes.

## Repeatable Image-Only E2E

Use the packaged E2E when you need to replay the storyboard image workflow without
submitting video jobs:

```bash
npm run e2e:image-storyboard:examples
```

When `npm` is not on `PATH`, run the same steps manually:

```bash
node -e "const fs=require('fs'); fs.rmSync('dist',{recursive:true,force:true});"
./node_modules/.bin/tsc
node -e "require('fs').chmodSync('dist/cli/omx.js', 0o755); require('fs').chmodSync('dist/cli/vclaw.js', 0o755); require('fs').chmodSync('dist/cli/provider-adapter.js', 0o755)"
node scripts/e2e-image-storyboard-workflow.mjs --project e2e-proofy-image-storyboard --run-id 2026-05-06-proofy-image-e2e --include-examples --verify-server --port 4322
```

The default manifest is
`examples/image-storyboard/proofy-e2e-stills.json`. It records the four Go Bananas
image IDs and prompts used for the current Proofy storyboard test:

- Scene 0: `6657`
- Scene 1: `6658`
- Scene 2: `6659`
- Scene 3: `6660`

The script downloads those images into the project, adds them as storyboard still
candidates, selects one candidate per scene, chains scenes 1-3 from the previous
scene, binds a Proofy identity reference sheet, runs readiness, director preflight,
plan, storyboard review, doctor, status, and Obsidian export.

With `--verify-server`, it also starts the Review UI server and exercises the
human-in-the-loop API surfaces that the browser uses:

- `/api/review-inventory`
- `/api/media-proxy`
- `/api/storyboard-still-request`
- `/api/storyboard-still-candidate`
- `/api/character-iteration-request`
- `/api/upscaled-still-candidate`
- `/api/review-decision`

The server check must finish with `review-report.json` verdict `pass`,
`publishReady: true`, four locked stills, and four artifact-backed upscaled still
candidates. It intentionally stops before `produce`, `execute`, provider
submission, post-production, or final-video checks.

By default, the script creates a temporary root outside the repository so repeat
runs do not dirty the tracked example project. The JSON output prints the exact
history paths. Pass `--root "$PWD" --reset` only when you intentionally want to
refresh the checked-in example project.

Run history is stored under the chosen root:

```text
projects/e2e-proofy-image-storyboard/artifacts/e2e-image-storyboard-history/
```

Use `latest.md` for the human-readable command and prompt ledger, or the timestamped
JSON file for automation evidence.

## Saved Artifacts

Saving the review writes:

- `review-ui-ledger.json`
- `reference-board.json`
- `director-seedance-plan.json`
- `storyboard-stills-plan.json`
- `scene-selection.json`
- `gobananas-character-brief.json`
- `post-plan.json`
- `review-report.json`
- `asset-manifest.json`

For a completed image handoff, `asset-manifest.json` must promote the artifact-backed `upscaled-storyboard-still` assets, not the original source still URLs.

## Completion Criteria

A storyboard handoff is ready when:

- The review ledger has `activeGate: assembly`.
- `review-report.json` has `verdict: pass`.
- `review-report.json` has `metrics.publishReady: true`.
- Every scene has a locked still.
- Every locked still has an artifact-backed `*-4k` still.
- `characterMismatchCount` is `0`.
- `rejectedCandidateCount` is `0` in the current handoff artifacts.
- Browser UI shows `0` open gates and `Ready for publish handoff.` from the
  saved publish-ready `review-report.json`, not from local gate completion
  alone.

## Proofy Example State

As of the current verified handoff:

- Character: `Proofy`
- Locked stills: `scene-0-take-5`, `scene-1-take-3`, `scene-2-take-2`, `scene-3-take-2`
- 4k stills: `scene-0-take-5-4k`, `scene-1-take-3-4k`, `scene-2-take-2-4k`, `scene-3-take-2-4k`
- Review verdict: `pass`
- Publish readiness: `true`
- Video generation: not run yet
