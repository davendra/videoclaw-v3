---
name: videoclaw-create-video
description: |
  Drive videoclaw to create a video end-to-end from a creative intent.
  Use when the user wants to make a video and videoclaw is installed
  (`vclaw --version` to verify).
---

# videoclaw: create a video

You are driving the `vclaw` CLI to produce a video. videoclaw is a
deterministic toolkit — YOU do the intent reasoning, vclaw executes.

## First, learn the surface

```bash
vclaw schema --json
```

This returns every command, flag, artifact schema, exit code, and error
code. Parse it once.

## Then walk the pipeline

1. `vclaw video init <slug> --mode storyboard` (or `--mode director` for the approval-gated path)
2. `vclaw video brief --project <slug> --title "..." --intent "..." [--aspect-ratio 16:9|9:16|1:1]`
3. `vclaw video storyboard --project <slug> --scene "..." [--scene "..." ...]`
4. `vclaw video assets --project <slug> --asset image:path:0`
5. `vclaw video readiness --project <slug>` — check blockers
6. `vclaw video plan --project <slug>` — see the recommended provider route
7. `vclaw video execute --project <slug> [--dry-run]`
8. `vclaw video assemble --project <slug>` (Slice 3 — TTS/music/stitch into final MP4; only if the assemble pipeline has shipped)

## Read exit codes

- 0 = success
- 1 = your input was wrong (fix flags, retry)
- 2 = system/provider error (investigate, maybe retry)
- 3 = gate (e.g., director storyboard approval needed) — clear the gate first

On any non-zero exit, stdout has `{"code": "...", "message": "...", "details": {...}}`.

## Director-mode approval gate

If `vclaw video execute` exits 3 with `storyboard_approval_required`,
the storyboard.md must be approved. Either set
`VIDEOCLAW_APPROVE_STORYBOARD=1` (auto-approve) or run
`vclaw video approve --project <slug>` after review.
