# Python Pipeline (opt-in)

The `skills/video-replicator/scripts/` directory ships an **optional** Python pipeline for
Seedance-targeted prompt direction, character sheet generation, prompt
critique, scene chaining via last-frame injection, and Omni Flash specific
flows. It is **not** required for normal `vclaw` usage — the core CLI is
pure Node/TypeScript. Use this pipeline when you want the deeper
Seedance Prompt Director compose / chain / critique stack that originated
in the legacy `videoclaw` repo.

## Why it's opt-in

- The main `vclaw` binary is a Node 20+ CLI with zero runtime Python
  dependencies.
- The Python pipeline targets Python 3.10+ and depends on third-party
  packages (`google-genai`, `requests`, `yt-dlp`). Most users don't need
  these.
- Some files (notably `seedance_prompt_db.py`, 6.5k lines) carry forward
  the legacy curated-prompt database. Newer users should prefer the
  TypeScript surface (`vclaw video prompt-lib-list` / `prompt-lib-show`)
  documented in `docs/CLI_REFERENCE.md`.

## Setup

```bash
cd skills/video-replicator/scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Requirements (`skills/video-replicator/scripts/requirements.txt`):

- `google-genai>=1.0.0` — Gemini API for video analysis
- `requests>=2.31.0` — HTTP
- `yt-dlp>=2024.1.0` — Video downloading

## What's included

20 `.py` modules organized into four clusters:

### Seedance Prompt Director (core)

| Module | Role |
|---|---|
| `seedance_prompt_director.py` | 3-control-level prompt composer (foundation for the director workflow) |
| `seedance_prompt_builder.py` | Lower-level prompt assembly utilities |
| `seedance_prompt_critique.py` | Prompt critique with `auto_fix_prompt` rewrite suggestions |
| `seedance_chain_manager.py` | Multi-scene continuation via last-frame injection |
| `seedance_reference_validator.py` | Reference-image validation against scene needs |
| `seedance_hooks.py` | 18 director hooks + 22 camera moves + 12 lighting presets + 4 timeline templates |
| `seedance_consistency.py` | Character-consistency scoring across scenes |
| `seedance_material_library.py` | Reusable material assets |
| `seedance_platform_optimizer.py` | Target-platform aspect/duration tuning |
| `seedance_omni.py` | Omni Flash specific T2V/R2V/V2V helpers |
| `seedance_webhook.py` | Webhook receiver for async generation |
| `seedance_client.py` | HTTP client + content-safety validators |
| `seedance_prompt_db.py` | Curated prompt library (legacy; see note above) |

### Character pipeline

| Module | Role |
|---|---|
| `character_sheet_generator.py` | 8-field character sheet generation from descriptions |

### Shared utilities

| Module | Role |
|---|---|
| `config.py` | Centralized constants (timeouts, paths, model names) |
| `exceptions.py` | Shared exception types (`SeedanceError`, `SeedanceTimeoutError`, `VideoProcessingError`, `MissingDependencyError`) |
| `logging_config.py` | Logger initialization for the pipeline modules |
| `ffmpeg_wrapper.py` | Thin wrapper around `ffmpeg` / `ffprobe` subprocesses |
| `audio_utils.py` | Audio extraction, narration, mixing helpers |
| `assembly_utils.py` | Concat / encode / package helpers |

## Reference material

`references/video/seedance-skills/` contains 15 genre-specific Seedance
"skill" reference markdowns (cinematic, 3d-cgi, cartoon, comic-to-video,
fight-scenes, motion-design-ad, ecommerce-ad, anime-action, product-360,
music-video, social-hook, brand-story, fashion-lookbook, food-beverage,
real-estate). These document compose / camera / lighting recipes per
genre and are consumed by `seedance_prompt_director.py`.

## Invoking from the TypeScript CLI

The pipeline runs as subprocesses; nothing in `src/` imports Python.
Typical pattern:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const { stdout } = await exec(
  'python3',
  ['skills/video-replicator/scripts/seedance_prompt_director.py', '--compose', JSON.stringify(input)],
  { cwd: workspaceRoot, env: { ...process.env, PYTHONPATH: 'skills/video-replicator/scripts' } },
);
const result = JSON.parse(stdout);
```

A future Phase will surface this as a first-class `vclaw video
director:compose` subcommand. For now the modules are scriptable
end-to-end and can be invoked directly.

## What this directory does NOT include

Everything from `videoclaw/scripts/video/` that was either tightly
coupled to the legacy orchestration layer (which v2 dropped) or
duplicates functionality now in `vclaw-cli/`:

- `db.py`, `db_unified.py`, `db_convex.py` — legacy SQLite/Convex DB
  for the Python pipeline. The vclaw-cli SQLite store
  (`vclaw-cli.db`) is the single source of truth for batch/job tracking.
- `seedance_batch.py`, `seedance_backend.py` — overlap with vclaw-cli
  backends.
- `campaign_manifest.py`, `ugc_strategy.py`, `ugc_scripts.py` — the
  legacy UGC scripts that the `ugc` skill rewrite explicitly moved
  away from (`projects/<slug>/strategy/` directly + vclaw CLI now).
- ~80 other one-off `.py` files that didn't make the curated list.

If you need any of those, copy them in manually and add them here with
a one-line note in this doc.

## Tests

A focused subset of the original Python test harness will be ported in
a follow-up pass — the v2 plan defers `scripts/video/tests/` import to
a phase-specific commit once we've decided which tests still apply.

## Status

- All 20 modules: import-clean (verified with
  `python3 -c "import <module>"` for each).
- No runtime smoke yet — that requires real provider credentials.
- Subject to future cleanup: `seedance_prompt_db.py` will likely be
  retired in favor of the TypeScript `vclaw video prompt-lib-*` surface.
