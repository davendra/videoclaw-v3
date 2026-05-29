# Studio

`vclaw studio` is the human-friendly planning front door for VideoClaw.

It does not replace the low-level CLI. It builds a production plan from a goal,
then shows the exact commands and artifacts that will be used.

## Start With A Dry Run

```bash
vclaw studio --dry-run --goal create-video --project demo --intent "Create a 30 second product ad"
```

The Phase 1 Studio command is plan-only. It does not call providers, run FFmpeg,
or spend credits.

## Goals

| Goal | Use When |
|---|---|
| `create-video` | Original video from a brief |
| `copy-reference` | Adapt a reference video or ad |
| `presenter-video` | Bunty, Nex, Davendra, or generic presenter episode |
| `music-video` | Multi-shot cinematic or music video planning |
| `ugc-campaign` | Belief-driven UGC campaign |
| `existing-project` | Continue a project and get next actions |
| `review-regenerate` | Review, reroll, or approve scenes |
| `publish-deliver` | Build and publish a portal |

## Examples

```bash
vclaw studio --dry-run --goal presenter-video --project demo --input deck.pdf --client "Acme"
vclaw studio --dry-run --goal music-video --project dhuaan --duration 60
vclaw studio --dry-run --goal existing-project --project demo
vclaw studio --dry-run --goal publish-deliver --project demo --client "Acme"
```

Use `--write-session` to persist the planned handoff under the project:

```bash
vclaw studio --dry-run --goal presenter-video --project demo --input deck.pdf --write-session
```

This writes `projects/<slug>/artifacts/studio-session.json`.

## Agent Contract

When stdout is piped, Studio outputs JSON. Progress and warnings stay out of
stdout. Provider execution is not performed by the dry-run planner.
