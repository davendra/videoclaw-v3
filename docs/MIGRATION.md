# Migration Guide

This guide is for moving from either of the predecessor codebases
(the original `videoclaw` package OR the clean-room `vclaw-video-core`
rebuild) to **`videoclaw-v2`** — the merged successor that combines
the best of both. The npm package name remains `videoclaw`; only the
repository name changed (the v2 suffix is intentional to distinguish
the merged repo from the older one during the transition).

## Why migrate

`videoclaw-v2` (npm: `videoclaw`) is now the safer execution surface because it has:

1. canonical artifacts
2. explicit stage checkpoints
3. character consistency enforcement
4. native `seedance-direct` transport
5. native `veo-direct` transport
6. direct clone execution runtime
7. imported prompt/reference library assets

The old repo still matters as:

1. reference implementation
2. script source
3. migration source for older project folders

## Repo roles

Use the repos like this:

1. `videoclaw` (legacy v0.11.x)
   - legacy runtime
   - archive/reference source
   - migration input
2. `vclaw-video-core` (intermediate clean-room rebuild)
   - intermediate rebuild that became this repo's foundation
   - now retired in favor of `videoclaw-v2`
3. `videoclaw-v2` (current — npm package: `videoclaw`)
   - active product surface
   - canonical CLI
   - current execution/runtime lane

## What migrates cleanly

You can already move these workflows:

1. project initialization
2. initial `video create` front-door flow
3. brief/storyboard/assets/review/publish stage tracking
4. template save/list/show
5. clone plan / clone init / storyboard-from-clone
6. clone execute
7. provider status / readiness / plan / produce / execute-status
8. Obsidian export and sync
9. legacy project folder import via `import-legacy`

## What still stays partially legacy

These areas still need product polish or richer parity work:

1. deeper legacy `video create` / Director parity on the clean-room CLI beyond the current character-hydration and approval-gate surface
2. richer provider-specific option surfaces
3. deeper historical-project normalization beyond file-count inference
4. old-repo migration comms and deprecation rollout
5. higher-level automatic prompt guidance during execution

Most important near-term gap:

1. richer provider-specific execution controls and advanced orchestration ergonomics still live more fully in the legacy workflow docs than in the clean-room CLI

## Command migration

Use `vclaw` in the clean repo as the primary command surface. `omx` currently works
as a compatibility alias and prints a deprecation notice to `stderr`.

Examples:

```bash
# old mental model
omx video ...

# new primary surface
vclaw video ...
```

Compatibility check:

```bash
npm run check:omx-alias
```

This confirms the temporary `omx` alias still resolves to the clean-room CLI
and emits the expected deprecation notice.

Recommended clean-room flow:

```bash
vclaw video create "Create a short product teaser." --project demo --production-mode director --import-library-characters
# review projects/demo/storyboard.md
VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video create "Create a short product teaser." --project demo --production-mode director --execute --dry-run
```

If the project needs a new cast member, seed it directly into the create flow:

```bash
cat >/tmp/cast.json <<'JSON'
[
  {
    "name": "Nova",
    "description": "A determined spaceship captain with a silver jacket.",
    "style": "cinematic sci-fi still"
  }
]
JSON

vclaw video create "Komo and Mochi recruit Nova for a neon sci-fi corridor escape." \
  --project hydration-demo \
  --production-mode director \
  --import-library-characters \
  --auto-create-characters /tmp/cast.json
```

Template-driven flow:

```bash
vclaw video analyze --project ref --source <url-or-path> --title "Reference"
vclaw video template-save --project ref --name launch-template
vclaw video clone-execute --template launch-template --project launch-variant --intent "Make a launch teaser for a smart bottle."
```

## Project migration

If you have historical folders under the legacy repo, import them into the
clean repo:

```bash
vclaw video import-legacy --source <legacy-videoclaw>/projects --root <videoclaw>
```

Then verify them:

```bash
vclaw video doctor-portfolio --root <videoclaw>
vclaw video metrics --root <videoclaw>
vclaw video sync-obsidian --root <videoclaw>
```

## Provider migration

### Seedance direct

Minimum native path:

```bash
SUTUI_API_KEY=...
```

Optional:

```bash
VCLAW_SEEDANCE_BASE_URL=...
```

### Veo direct

Minimum native path:

1. local `vclaw-cli` workspace
2. `cookie.json`
3. `bun`

Optional:

```bash
VCLAW_VEO_CLI_ROOT=...
VCLAW_VEO_BUN_BIN=...
VCLAW_VEO_OUTPUT_DIR=...
```

## Suggested cutover sequence

1. Freeze new feature work in the old runtime lane.
2. Run `npm test` in `videoclaw`.
3. Validate provider readiness with `vclaw video providers`.
4. Import historical projects if needed.
5. Move template and clone workflows first.
6. Move direct execution workflows next.
7. Move Obsidian and reporting consumers last.

## Rollback rule

If a production job fails in the clean repo for a case the old repo still handles better:

1. keep the artifacts in `videoclaw`
2. note the gap explicitly
3. use the old repo only as a temporary execution fallback
4. port the missing behavior back into the clean repo

Do not re-expand the old repo as the primary product surface.

## Cheap smoke checks

The clean-room repo now includes a local mock-backed smoke for create-time
character hydration:

```bash
npm run build
node scripts/smoke-character-hydration.mjs
```

Equivalent packaged entry point:

```bash
npm run smoke:character-hydration
```

This verifies one `video create` run that:

1. reuses exact-name library matches from the story intent
2. auto-creates a missing character from a JSON seed
3. carries the full cast into `brief.json`, `storyboard.md`, and the project character store
