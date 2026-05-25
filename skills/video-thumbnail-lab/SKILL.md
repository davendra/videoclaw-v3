# Video Thumbnail Lab

## When To Use

Use this workflow when a finished render needs a click-driving still image or a
platform-specific packaging pass.

Typical triggers:

1. generate a thumbnail for this render
2. make square and vertical promo cuts
3. package this final video for YouTube, Shorts, or social handoff

## Input Contract

Required:

1. a final render via `--project <slug>` or `--file <path>`

Optional:

1. `--text <title>` for a simple overlay thumbnail
2. `--output <path>` for explicit delivery locations
3. post variants:
   - `make-vertical`
   - `make-square`
   - `make-loop`

Canonical commands:

```bash
vclaw video thumbnail --project <slug> [--root <path>] [--text <title>] [--output <path>]
vclaw video make-vertical --project <slug> [--root <path>] [--output <path>]
vclaw video make-square --project <slug> [--root <path>] [--output <path>]
vclaw video make-loop --project <slug> [--root <path>] [--output <path>]
```

## Output Contract

Produces one or more delivery assets next to the final render by default:

1. `*-thumbnail.jpg`
2. `*-vertical.mp4`
3. `*-square.mp4`
4. `*-loop.mp4`

Each CLI command returns machine-readable JSON with source and output paths so
downstream review or publishing flows can consume the result.

## Error And Retry Handling

1. If the project does not yet have a final `.mp4`, run `vclaw video verify-final` first and confirm the output path.
2. If `drawtext` is unavailable, `thumbnail` falls back to a clean extracted frame instead of failing the run.
3. If packaging variants look wrong, rerun with explicit `--output` paths so you can compare iterations without overwriting earlier assets.

## Example

```bash
vclaw video thumbnail --project launch-teaser --text "See It In Motion"
vclaw video make-vertical --project launch-teaser
vclaw video make-square --project launch-teaser
```
