# Video Analyze Template

## When To Use

Use this workflow when a reference video needs to become a reusable template packet
before clone or storyboard work begins.

Typical triggers:

1. analyze this video style
2. break this ad into reusable structure
3. turn this reference into a template

## Input Contract

Required:

1. project slug
2. source path or URL

Optional:

1. title
2. pacing hint
3. motion classification
4. repeated `--beat`
5. repeated `--keep`
6. repeated `--change`
7. repeated `--var`

Canonical command:

```bash
vclaw video analyze --project <slug> --source <path-or-url> [--title <title>] [--beat <text> ...] [--keep <text> ...] [--change <text> ...] [--var <text> ...]
```

## Output Artifact Contract

Writes `analyze-output.json` with:

1. reference summary
2. pacing classification
3. structural beats
4. motion classification
5. keep/change guidance
6. reusable variables

The output is designed to feed:

1. `template-save`
2. `clone-plan`
3. downstream storyboard authoring

## Error And Retry Handling

1. If the project is missing, initialize it first with `vclaw video init`.
2. If the source is wrong, rerun with the corrected source path or URL.
3. If the output needs refinement, rerun `analyze` with more explicit beats, keep/change lists, or variables rather than editing unrelated runtime files.

## Example

```bash
vclaw video analyze \
  --project ref-launch \
  --source https://example.com/ref.mp4 \
  --title "Reference Launch Ad" \
  --beat "cold open" \
  --beat "feature reveal" \
  --keep "pace" \
  --change "product" \
  --var "offer"
```
