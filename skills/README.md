# Skills Catalog

This repo now includes the legacy `videoclaw/skills` set, imported into the
clean-room tree so the workflow surface is available locally instead of only in
the old repo.

## Start Here

The imported library is no longer treated as a flat bag of equally-preferred
entry points.

Use these canonical surfaces first:

| Goal | Start With | Then Specialize Into |
|---|---|---|
| Generic video request | `video-framework` | `video-storyboard`, `video-analyze-template`, `video-clone-ad`, `video-replicator`, `movie-director`, `video-production-handoff`, `video-review-ui-qa`, `video-portfolio-ops`, `video-release-readiness`, `higgsfield-generate`, `ugc` |
| Narrated presenter / host-led deck video | `brand-presenter` | `davendra-presenter`, `nex-presenter`, `bunty` |

Compatibility/deep-reference surfaces remain available, but the preferred UX is:

1. start at a canonical entry point
2. specialize only when the mode is clearly known
3. keep personal or legacy names as aliases rather than first-choice workflows

## Video Production Skills

- `video-framework`
- `video-replicator`
- `video-storyboard`
- `video-analyze-template`
- `video-clone-ad`
- `video-production-handoff`
- `video-review-ui-qa`
- `video-portfolio-ops`
- `video-release-readiness`
- `movie-director`
- `higgsfield-generate`
- `seedance-prompts`
- `ugc`
- `character-library`
- `character-creator`
- `video-post`
- `youtube-audio`
- `brand-presenter`
- compatibility aliases:
  - `davendra-presenter`
  - `nex-presenter`
  - `bunty`

## OMX / Workflow Skills

- `autopilot`
- `build-fix`
- `cancel`
- `code-review`
- `deep-interview`
- `deepsearch`
- `doctor`
- `git-master`
- `help`
- `hud`
- `note`
- `omx-setup`
- `pipeline`
- `ralph`
- `ralph-init`
- `ralplan`
- `review`
- `security-review`
- `skill`
- `studio-mode`
- `team`
- `trace`
- `web-clone`
- `worker`
- `configure-notifications`
- `ai-slop-cleaner`

## Import Notes

1. The imported skill tree preserves legacy names for compatibility.
2. Personal/brand-specific presenter skills are kept as aliases over the shared
   `brand-presenter` surface so the repo stays generic while preserving
   discoverability.
3. `video-framework` and `brand-presenter` are the canonical entry points for
   broad video and presenter requests; deeper skills now sit underneath them as
   specialist or compatibility surfaces.
4. `character-library` is the hygiene and repair companion to
   `character-creator`; creation stays on the creator skill while audit, patch,
   and delete operations live in the library lane.
5. `video-post` closes the loop after render with verification, platform
   variants, thumbnails, and archive helpers.
6. `video-production-handoff` is the operator handoff lane for Review UI,
   review-autopilot, canonical `review-report.json` truth, and release-ready
   verification before publish.
7. `video-review-ui-qa`, `video-portfolio-ops`, and
   `video-release-readiness` split the production surface into browser QA,
   slate management, and release handoff so advanced commands remain intact but
   operators get clear workflows.
8. `higgsfield-generate` is an external bridge over Higgsfield's MIT-licensed
   public skills and official CLI. Keep it optional and thin; do not vendor the
   upstream setup script or make Higgsfield a required runtime dependency.
9. Local repo paths should be preferred over old `.claude/...` path assumptions
   when adapting or extending these skills further.

## Machine-Readable Catalog

For tooling and maintenance, the repo now also carries:

1. `skills/catalog.json`

It records the imported skill ids, rough category, alias relationships, and the
new canonical-entry/specialization structure so the skill surface can be
audited without scraping markdown.
