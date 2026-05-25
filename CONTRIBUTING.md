# Contributing to videoclaw-v2

Thanks for considering a contribution. Quick orientation:

## Before you start

Read these in order:

1. [`README.md`](./README.md) — what the product does
2. [`CLAUDE.md`](./CLAUDE.md) — conventions, build/test commands, agent-first orientation
3. [`AGENTS.md`](./AGENTS.md) — autonomy directive + commit/PR format
4. [`MERGE_PLAN.md`](./MERGE_PLAN.md) — why the architecture is the way it is
   (1900+ lines; read the TL;DR + skim Addenda)
5. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — layer map

## Local development

```bash
npm install                              # Node 20+
npm run build                            # tsc, chmod CLI bins
npm test                                 # 474+ tests via node:test
bash scripts/check-release-readiness-lite.sh   # full pre-flight (build + test + 7 smokes + 5 guardrails)
```

Run a single test:

```bash
node --test dist/tests/cli-create.test.js
```

## Project structure

- `src/cli/` — user-facing command entrypoints
- `src/video/` — domain logic (artifacts, checkpoints, runtime, providers)
- `src/video/provider-platform/` — route descriptors + router + telemetry
- `src/video/providers/` — per-provider HTTP adapters (with optional `fetchImpl` injection for tests)
- `src/video/native-*.ts` — native in-process transports
- `src/tests/` — `*.test.ts` files; flat layout
- `schemas/video/artifacts/` — JSON Schema contracts for every artifact
- `skills/` — 52 Claude Code skills (canonical: `skills/catalog.json`)
- `vclaw-cli/` — Bun sidecar (Google Flow + UseAPI multi-provider automation)
- `skills/video-replicator/scripts/` — opt-in Python 3.10+ pipeline (122 modules)

## Coding style

- **TypeScript strict, NodeNext ESM**. Relative imports MUST include the `.js`
  extension (NodeNext resolution requirement).
- **Filenames**: `kebab-case.ts`. Identifiers: `camelCase` for funcs/vars,
  `PascalCase` for types.
- **2-space indent**, modules small and single-purpose.
- **CLI output is machine-readable JSON by default**. Do not add silent
  fallbacks across provider routes.

## Tests

- Use `node:test` with `assert/strict`.
- Prefer `mkdtemp`/`tmpdir` for filesystem isolation.
- CLI E2E tests go in `src/tests/cli-*.test.ts`.
- Module-contract tests go in `src/tests/<module>.test.ts`.
- New provider adapters MUST accept an optional `fetchImpl` for test
  injection — see `src/video/providers/runway-useapi.ts` as the canonical
  example.

## Adding a new provider route

See [`docs/PROVIDER_PLATFORM.md`](./docs/PROVIDER_PLATFORM.md) §
"Adding a new route" — the 7-step recipe + reference to the Phase 5b
Runway port (`6e99443`) as the canonical example.

## Adding a new artifact / schema

When you add a `writeArtifact(workspace, '<name>', ...)` call:
1. Add the matching `schemas/video/artifacts/<name>.schema.json`
2. Run `npm run check:artifact-schema-coverage` (advisory; will surface drift)
3. Run `--strict` once the allowlist is empty

## Commit format

Conventional-commits-ish. Examples from this repo:
```
Phase 7: 3 tail-end polish items — delete legacy skill + slug validation + schema-coverage guardrail
fix(veo-cli): tighten Flow voice validator + actionable concat error + docs
feat(scripts): thread --voice and --ref-video through the Python orchestrator
```

Multi-paragraph body explaining the WHY and what was verified.
`Co-Authored-By:` trailer if relevant.

## PR checklist

Before opening a PR:

- [ ] `npm run build` — clean
- [ ] `npm test` — all green
- [ ] `bash scripts/check-release-readiness-lite.sh` — green (the lite
      check covers smokes + guardrails)
- [ ] If you added/changed a schema or artifact writer: schema-coverage
      guardrail still satisfied
- [ ] If you added a new CLI subcommand: `src/cli/vclaw.ts` updated,
      `src/video/*` module added, schema under `schemas/video/` if a new
      artifact, `cli-*.test.ts` added, `README.md` + `docs/CLI_REFERENCE.md`
      updated
- [ ] If you touched skill docs: `bash scripts/check-skill-frontdoor.sh`
      + `bash scripts/check-cleanroom-docs.sh` pass

## License

By contributing, you agree your contributions will be licensed under the
project's dual-license terms (see [`LICENSE`](./LICENSE)).
