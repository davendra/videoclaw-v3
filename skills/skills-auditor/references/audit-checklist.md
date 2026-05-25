# Skills Audit Checklist

## Required Structure

- Every immediate child under `skills/` is a skill folder.
- Every skill folder has `SKILL.md`.
- `SKILL.md` frontmatter has only `name` and `description`.
- Frontmatter `name` exactly matches the folder name.
- Large details live under `references/`.
- Executable helpers live under `scripts/`.
- Assets live under `assets/` or a clearly named canonical resource folder.
- No `README.md`, `INSTALL.md`, `QUICK_REFERENCE.md`, `CHANGELOG.md`, or `VERSION` files inside skill folders.

## Metadata

- Every skill has `agents/openai.yaml`.
- `display_name` is human-readable.
- `short_description` is concise and matches the skill.
- `default_prompt` tells the agent to follow the skill and verify results.
- The catalog includes every local installable skill.
- Alias or merged catalog entries do not have local folders unless marked internal.

## Duplicate And Alias Cleanup

- Presenter-specific wrappers should route through `presenter-video`.
- Reference teardown and clone-ad wrappers should route through canonical video skills.
- Keyword aliases should live in catalog/routing, not duplicate skill folders.
- Shared implementation resources should move to the canonical skill or repo-level script path.

## Portability

- No `/Users/...` absolute paths.
- No `.claude/skills/...` paths in active docs or commands.
- Scripts infer repo root from their own path or accept documented environment overrides.
- Benchmark/output workspaces are under `docs/`, `.omx/`, or another non-skill location.

## Verification

- `npm run check:skills`
- `npm run lint`
- `npm test` for broad changes
- `bash -n` for shell scripts
- `python3 -m py_compile` for moved Python helpers
- targeted tests for touched contracts
