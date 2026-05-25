# Video Clone Ad

## When To Use

Use this workflow when a known style or saved template should be adapted to a new
product, offer, or brand while preserving the execution structure.

Typical triggers:

1. clone this ad
2. adapt this launch ad to a new product
3. reuse this template for a new campaign

## Input Contract

Required:

1. template name
2. target project slug
3. new intent

Optional:

1. mode (`storyboard` or `director`)
2. platform
3. execution profile overrides for ratio, quality, resolution, audio, outputs

Canonical commands:

```bash
vclaw video clone-plan --template <template-name> --project <slug> --intent <text>
vclaw video clone-init --template <template-name> --project <slug> --intent <text> [--mode storyboard|director]
vclaw video clone-execute --template <template-name> --project <slug> --intent <text> [--mode storyboard|director] [--dry-run]
```

## Output Artifact Contract

Depending on the step used, this flow creates:

1. `clone-plan.json`
2. seeded `brief.json`
3. generated `storyboard.json`
4. execution artifacts and `execution-report.json` when runtime execution is invoked

## Error And Retry Handling

1. If the template does not exist, create it first with `template-save`.
2. If the clone needs a lighter touch, stop at `clone-plan` or `clone-init` and edit the brief/storyboard before running runtime execution.
3. If live execution blocks, use `plan`, `readiness`, and `execute-status`/`produce` to resolve the route or artifact issue before retrying.

## Example

```bash
vclaw video clone-execute \
  --template launch-template \
  --project smart-bottle-launch \
  --intent "Make a launch teaser for a smart bottle." \
  --mode storyboard \
  --quality quality \
  --outputs 2 \
  --dry-run
```
