---
name: video-post
description: Post-production workflow for clean-room VideoClaw outputs. Verify final renders, create social variants, extract thumbnails, build loop-friendly cuts, and archive finished projects.
---

# Video Post

Use this skill after a project has produced a final render and needs packaging
for review, publishing, or archive.

## When To Use

Trigger on:

- "make a vertical version"
- "verify this final render"
- "generate a thumbnail"
- "archive this project"
- "what do I do after render"

## Scope

This skill is intentionally generic and repo-local.

- it works against any final `.mp4`
- it prefers `ffmpeg` and `ffprobe`
- it does not assume a fixed project root
- it complements `movie-director`, `director-video`, and `video-framework`

## Standard Sequence

1. Verify the source output.
2. Generate platform variants as needed.
3. Extract or annotate a thumbnail.
4. Archive the project once deliverables are stable.

## Verify

```bash
vclaw video verify-final --file /path/to/final.mp4
vclaw video verify-final --project <slug> --root <path>
```

This returns machine-readable metadata plus a midpoint review frame.

## Variants

### Vertical

```bash
vclaw video make-vertical --file input.mp4 [--output output-vertical.mp4]
vclaw video make-vertical --project <slug> [--root <path>] [--output output-vertical.mp4]
```

### Square

```bash
vclaw video make-square --file input.mp4 [--output output-square.mp4]
vclaw video make-square --project <slug> [--root <path>] [--output output-square.mp4]
```

### Loop

```bash
vclaw video make-loop --file input.mp4 [--output output-loop.mp4]
vclaw video make-loop --project <slug> [--root <path>] [--output output-loop.mp4]
```

## Thumbnail

```bash
vclaw video thumbnail --file input.mp4 [--output thumbnail.jpg]
vclaw video thumbnail --file input.mp4 --output thumbnail.jpg --text "Hook Line"
vclaw video thumbnail --project <slug> [--root <path>] [--text "Hook Line"]
```

If a title is supplied, the command attempts a simple `drawtext` overlay and
falls back to exporting a clean frame when that filter is unavailable.

## Archive

```bash
vclaw video archive-project --project <slug> [--root <path>]
vclaw video archive-project --project <slug> [--root <path>] [--archive-dir <path>] [--cleanup]
```

## Notes

1. Verify before generating variants so bad source renders do not propagate.
2. Keep post outputs next to the project or in a dedicated delivery folder.
3. Archive only once the project state and outputs are reproducible.

## Related Skills

- `skills/video-framework/SKILL.md`
- `skills/director-video/SKILL.md`
- `skills/movie-director/SKILL.md`
- `skills/video-thumbnail-lab/SKILL.md`
