# Video Storyboard

## When To Use

Use this workflow when a brief or clone plan needs to become an explicit scene-by-scene
storyboard artifact with optional character-to-scene bindings.

Typical triggers:

1. storyboard this brief
2. turn this plan into scenes
3. assign characters to storyboard scenes

## Input Contract

Required:

1. project slug
2. one or more scene descriptions

Optional:

1. mode (`storyboard` or `director`)
2. repeated `--scene-character <sceneIndex:name>` bindings

Canonical commands:

```bash
vclaw video storyboard --project <slug> --scene <text> [--scene <text> ...] [--scene-character <sceneIndex:name> ...]
vclaw video storyboard-from-clone --project <slug> [--mode storyboard|director]
```

## Output Artifact Contract

Writes `storyboard.json` containing:

1. project slug
2. production mode
3. ordered scene array
4. optional scene-character mapping

Successful storyboard creation also advances stage state toward `assets`.

## Error And Retry Handling

1. If `brief` has not completed, create the brief first.
2. If character continuity is required, add character profiles and reference assets before moving toward readiness or execution planning.
3. If the clone flow is the source of truth, prefer `storyboard-from-clone` over rewriting the storyboard manually.

## Example

```bash
vclaw video storyboard \
  --project launch-teaser \
  --scene "Cold open on product silhouette." \
  --scene "Tight feature reveal with motion streaks." \
  --scene "Final CTA with packshot." \
  --scene-character 1:Nova
```
