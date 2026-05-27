# Multi-Shot Prompt Framework — Integration Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Source skill:** `multi-shot-prompt-framework.md` (compressed cinematic multi-shot prompt builder)

## Summary

Integrate the multi-shot cinematic prompt framework into `videoclaw-v3` across
three coordinated layers: a **reference doc** (source of truth), a repo **skill**
(authors the cinematic prose), and a **code module** (deterministically scaffolds,
enforces the hard rules, and persists an artifact). A new standalone
`vclaw video multi-shot` command exposes the code layer. The framework's
opinionated values (15s total, 2–5s shots, ≤1500 chars, fixed Nolan/IMAX Style
line, diegetic-only Audio) ship as the **default `cinematic-15s` preset** and are
parametrizable per provider/project.

## Decisions (locked during brainstorming)

1. **All three layers** — reference doc as source of truth, a skill that authors
   prose, and a code module that enforces the rules.
2. **Standalone now, scene-aware later** — Phase 1 ships a standalone
   `vclaw video multi-shot` command independent of a full project; Phase 2 wires
   it into the per-scene flow.
3. **Parametrize, framework defaults** — duration, char-limit, shot-length bounds,
   Style line, and Audio line are configurable; the framework's values are the
   default `cinematic-15s` preset.
4. **Authoring split A+C** — the code module owns the deterministic timecode plan,
   provider preset, validator, and artifact; the **skill** writes the cinematic
   prose; an optional `--auto` flag calls Gemini (mirroring the existing
   `analyze` / `analyze --auto` pattern) to author prose end-to-end.

## Rationale

`videoclaw-v3` already separates *guidance* (skills + `references/video/*`) from
*enforcement* (code in `src/video/*`, validated by `prompt-quality.ts`, contracted
by `schemas/video/`). The framework is fundamentally a prompt-formatting strategy
for a single 15s clip, so it maps cleanly onto these layers:

- Creative shot prose ("neon reflecting off wet asphalt") is non-deterministic and
  belongs to the skill / Gemini — not to TypeScript.
- The hard rules (char budget, contiguous timecodes totaling exactly the preset
  duration, non-repeating camera parameters, required metadata block) are
  deterministic and belong to a pure, unit-testable validator.

The `--auto` path reuses the repo's established `analyze` vs `analyze --auto` dual
pattern, so it is idiomatic rather than novel.

## Architecture

### Layer 1 — Reference doc (source of truth)

- **File:** `references/video/multi-shot-framework.md`
- Adapted from the source skill, reframed so the hard-coded values are presented as
  the **`cinematic-15s` preset** (the default) rather than universal law. The
  workflow, shot-design constraints, trim priority, example, and variation guidance
  are preserved.
- **Registration:** add to `REFERENCE_REGISTRY` in `src/video/prompt-library.ts`:
  ```
  { name: 'multi-shot-framework', category: 'framework',
    summary: 'Compressed timecoded multi-shot cinematic prompt builder (cinematic-15s preset).',
    file: 'multi-shot-framework.md' }
  ```
- **Surfaced via:** `vclaw video prompt-lib-show --name multi-shot-framework`.

### Layer 2 — Skill (authors prose)

- **File:** `skills/multi-shot-prompt/SKILL.md`
- Adapted from the source file; frontmatter (`name`, `description`) and trigger
  phrases preserved. The workflow is re-anchored to the code layer:
  1. `vclaw video multi-shot --plan` → timecode scaffold + preset + suggested
     non-repeating camera grid.
  2. Author cinematic prose into each shot slot (the skill's existing creative work).
  3. `vclaw video multi-shot --validate` → confirm the hard rules pass.
- References a **real command**, so it passes `check:skill-frontdoor` without being
  added to the ignore list. (Do not modify the ignore list — it is load-bearing.)

### Layer 3 — Code module (enforces)

**`src/video/multi-shot-prompt.ts`**

- `MultiShotPreset` interface:
  `{ name: string; totalSeconds: number; minShotSeconds: number; maxShotSeconds: number; maxChars: number; styleLine: string; audioLine: string }`
- Default export preset `cinematic-15s`:
  `{ totalSeconds: 15, minShotSeconds: 2, maxShotSeconds: 5, maxChars: 1500,
     styleLine: 'Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.',
     audioLine: 'Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.' }`
- `buildShotPlan(preset, opts?)` → picks a shot count in **3–7** (seedable so it
  varies between calls), assigns per-shot durations that sum to `totalSeconds` with
  each within `[minShotSeconds, maxShotSeconds]`, and returns:
  - per-shot slots `{ index, start, end, timecode }`
  - a suggested **non-repeating** `{ shotSize, lens, angle, movement }` grid drawn
    from the vocabularies already exported by `prompt-quality.ts`.
- `assembleMetadataBlock(preset, location, timeOfDay)` → the 3-line
  Location/Style/Audio block (no blank lines between the three).
- `formatTimecode(seconds)` → `MM:SS`.

**Extend `src/video/prompt-quality.ts`**

- `runMultiShotChecks(prompt: string, preset: MultiShotPreset): PromptQualityIssue[]`
  — reuses the existing `PromptQualityIssue` type and `CAMERA_MOVE_VOCABULARY` /
  `SHOT_TYPE_VOCABULARY` exports. Checks:
  - timecodes parse, are contiguous, start at `00:00`, end exactly at `totalSeconds`;
  - each shot duration within `[minShotSeconds, maxShotSeconds]`;
  - total character count ≤ `maxChars`;
  - no repeated shot-size / lens / angle / movement in **consecutive** shots;
  - Location/Style/Audio metadata block present.
- New `PromptQualityIssueCode` values are added for the multi-shot-specific checks.

### Layer 4 — Artifact + schema

- **Schema:** `schemas/video/artifacts/multi-shot-prompt.schema.json`
- **Shape:**
  ```
  {
    preset: string,
    location: string,
    timeOfDay: string,
    shots: [{ timecode, start, end, shotSize, lens, angle, movement, description }],
    promptText: string,
    charCount: number,
    valid: boolean,
    issues: PromptQualityIssue[]
  }
  ```
- Persisted under `projects/<slug>/artifacts/` (via the existing artifact-store
  conventions) **only when `--project` is supplied**; standalone runs emit to stdout
  without persisting.

### CLI — `vclaw video multi-shot`

Dispatched from `src/cli/vclaw.ts` via the existing hand-rolled
`command === 'video' && subcommand === 'multi-shot'` pattern.

Modes:

- `--plan` → emit timecode scaffold + preset + suggested camera grid (JSON) for the
  skill/operator to fill.
- `--validate (--file <path> | stdin)` → run `runMultiShotChecks`, emit issues JSON,
  **exit nonzero on any `error`-severity issue**.
- `--auto --image <path> [--character <t>] [--action <t>] [--location <t>] [--time <t>]`
  → Gemini (`gemini-analyze.ts` + the Gemini key pool) analyzes the image and authors
  prose into the plan, then validates → finished prompt. (The "C" half.)

Overrides / flags: `--preset <name>`, `--shots <N>`, `--max-chars <N>`,
`--total-seconds <N>`, `--style-line <t>`, `--audio-line <t>`, `--project <slug>`
(persist artifact), `--raw` (print just the prompt code block).

Output is machine-readable JSON by default; `--raw` prints the copy-paste prompt
block only.

## Data flow

```
operator/skill ──▶ vclaw video multi-shot --plan ──▶ {preset, shots[], grid}
       │                                                     │
       │ (author prose into slots)                           │
       ▼                                                     │
prompt text ──▶ vclaw video multi-shot --validate ──▶ PromptQualityIssue[]
                                                  └─▶ (exit 0 ok / nonzero on error)

--auto path:  image + brief ──▶ gemini-analyze ──▶ plan filled ──▶ validate ──▶ prompt
--project:    finished result ──▶ multi-shot-prompt artifact (schema-validated)
```

## Error handling

- Invalid preset name / out-of-range override (e.g. `minShotSeconds > maxShotSeconds`,
  or no valid shot-count partition for the requested `--shots`/`--total-seconds`) →
  fail fast with a clear message, nonzero exit.
- `--validate` with unparseable timecodes → reported as an `error` issue, nonzero exit.
- `--auto` Gemini failure (no key, API error) → surface the error; do **not** silently
  fall back to an empty/template prompt (consistent with the repo's no-silent-fallback
  rule).
- Missing `--image` for `--auto`, or missing prompt input for `--validate` → usage error.

## Testing

- `src/tests/multi-shot-prompt.test.ts` (module-contract): `buildShotPlan` durations
  sum to `totalSeconds` and stay within bounds across many seeds; shot count varies;
  validator catches char overflow, non-contiguous / over-budget timecodes,
  consecutive-parameter repeats, and missing metadata; preset overrides apply.
- `src/tests/cli-multi-shot.test.ts` (end-to-end): `--plan` output shape;
  `--validate` pass (exit 0) and fail (nonzero) paths; `--auto` with a **stubbed**
  Gemini adapter (no network); `--project` persistence writes a schema-valid artifact.
  Use `mkdtemp`/`tmpdir` for isolation.

## Docs & guardrails (per CLAUDE.md conventions)

- Add the command to `README.md` and `docs/CLI_REFERENCE.md`.
- Add the `prompt-library.ts` registry entry (above).
- Nice-to-have: `smoke:multi-shot` npm script doing a plan→validate round-trip with
  no network.
- `check:skill-frontdoor` and `check:cleanroom-docs` must stay green; the new skill
  references the real `vclaw video multi-shot` command, so no ignore-list change.

## Out of scope (Phase 2, separate spec)

- Scene-aware integration: expose multi-shot as a per-scene prompt format inside
  `scene-candidates` / `storyboard-markdown`.
- Provider-specific presets (`seedance-*`, `veo-*`, `runway-*`) with their real
  char-length and duration limits.

## Build sequence (Phase 1)

1. `multi-shot-prompt.ts` module (preset + `buildShotPlan` + metadata/timecode helpers).
2. Extend `prompt-quality.ts` with `runMultiShotChecks` + new issue codes.
3. `schemas/video/artifacts/multi-shot-prompt.schema.json` + artifact-store wiring.
4. `vclaw video multi-shot` CLI command (`--plan`, `--validate`, then `--auto`).
5. Tests: `multi-shot-prompt.test.ts`, then `cli-multi-shot.test.ts`.
6. `references/video/multi-shot-framework.md` + `prompt-library.ts` registry entry.
7. `skills/multi-shot-prompt/SKILL.md`.
8. Docs (`README.md`, `docs/CLI_REFERENCE.md`) + optional `smoke:multi-shot`.
