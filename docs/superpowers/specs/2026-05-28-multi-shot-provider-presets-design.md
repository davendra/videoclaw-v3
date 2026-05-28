# Multi-Shot Provider Presets — Phase 2 (first slice)

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Parent spec:** [`2026-05-27-multi-shot-prompt-framework-design.md`](./2026-05-27-multi-shot-prompt-framework-design.md)

## Summary

Add three provider-tuned `MultiShotPreset` constants — `seedance-10s`,
`veo-8s`, `runway-10s` — that encode each route's real clip duration, a viable
shot-count window, and a conservative char budget. They inherit the
`cinematic-15s` Nolan styleLine and diegetic audioLine; only the hard
constraints differ. `cinematic-15s` stays the default. Shot-count bounds become
explicit, declared fields on the preset interface rather than a hardcoded
`3–7` in `buildShotPlan`.

## Scope

**In scope:**

- New `MultiShotPreset` fields: `minShots`, `maxShots`.
- Three new preset constants and a central registry.
- Validator support for a new "shot count outside preset range" error.
- Parameterized tests across all four presets.
- Smoke round-trip across all four presets.
- Docs/skill/reference updates.

**Explicitly out of scope** (deferred to later Phase 2 rounds):

- Scene-candidates / storyboard-markdown integration.
- Structured `shots[]` parsing from `--auto` prose.
- The Veo-Omni-Flash variant as its own preset.

## Decisions (locked during brainstorming)

1. **All three core providers in one round** — `seedance-10s`, `veo-8s`,
   `runway-10s`. The cost difference between one and three is marginal.
2. **Explicit shot-count fields** on the preset — not derived from durations.
   The "3+ shots feels cinematic" floor is an opinion, not a derivation.
3. **Inherit cinematic style + audio defaults** — presets encode only
   provider-determined constraints; editorial choices remain on the
   `--style-line`/`--audio-line` overrides.

## Architecture

### Interface change

```ts
interface MultiShotPreset {
  name: string;
  totalSeconds: number;
  minShotSeconds: number;
  maxShotSeconds: number;
  minShots: number;      // NEW
  maxShots: number;      // NEW
  maxChars: number;
  styleLine: string;
  audioLine: string;
}
```

`buildShotPlan` stops hardcoding `3–7` and reads
`preset.minShots`/`preset.maxShots`. No external consumers of this interface
exist outside `src/video/multi-shot-prompt.ts` and `src/cli/vclaw.ts`, so the
new fields are added as required (not optional) — no compatibility shim.

`CINEMATIC_15S_PRESET` is updated to declare `minShots: 3, maxShots: 7`
explicitly — the today-behavior, now made first-class.

### Preset constants

| preset          | totalSeconds | shot range | shot count | maxChars | rationale                                                                       |
|-----------------|--------------|------------|------------|----------|---------------------------------------------------------------------------------|
| `cinematic-15s` | 15           | 2–5s       | 3–7        | 1500     | Existing framework default (unchanged behavior, fields now explicit)            |
| `seedance-10s`  | 10           | 2–5s       | 2–5        | 1500     | Sweet spot under Seedance's max-15s registry note; long prompts accepted        |
| `veo-8s`        | 8            | 2–4s       | 2–4        | 1500     | Veo 3 standard clip = 8s; tighter shot bound matches the shorter total          |
| `runway-10s`    | 10           | 2–5s       | 2–5        | 1000     | Runway durations are an enum `5\|8\|10\|15`; quality best at ≤1000 chars        |

`styleLine` and `audioLine` for all new presets are inherited from
`CINEMATIC_15S_PRESET` (same string constants).

### Preset registry

A single in-module `Map<string, MultiShotPreset>` keyed by name, with a
`resolvePreset(name?: string): MultiShotPreset` helper that defaults to
`cinematic-15s` when `name` is omitted and throws a clear error for unknown
names. `vclaw.ts`'s existing `--preset` validator (added in Phase 1 Task 8) is
re-pointed at this registry so it stays a single source of truth.

### Validator extension

`runMultiShotChecks` in `src/video/prompt-quality.ts` gains one new check:

- **Shot count outside preset range.** If parsed `shots.length` is `< preset.minShots` or `> preset.maxShots`, emit a
  `multi-shot-shot-count-out-of-range` issue (severity `error`) with a message
  branched on under vs over so operators see which direction is wrong.

`PromptQualityIssueCode` gains the new `multi-shot-shot-count-out-of-range`
value.

## Data flow

No data-flow change. The CLI surface is identical to Phase 1; only the
constants and validator coverage broaden:

```
operator/skill ──▶ vclaw video multi-shot --preset <name> --plan ──▶ {preset, shots[], grid}
                                                  (registry lookup)
prompt text ──▶ vclaw video multi-shot --preset <name> --validate ──▶ PromptQualityIssue[]
                                                  (shot-count check now active)
```

## Error handling

- `--preset <unknown>` continues to fail fast with a clear message (Phase 1
  Task 8 behavior). The set of valid names just grows.
- `--validate` on a prompt with shot count outside `[minShots, maxShots]`
  returns a nonzero exit and the new error issue.
- `--shots N` override interaction: when the operator supplies `--shots N`
  explicitly, `N` must lie within `[preset.minShots, preset.maxShots]` —
  out-of-range overrides fail fast at flag-parse time with a clear message
  naming the preset. The preset window is a hard constraint, not a default.
- `buildShotPlan` cannot produce an out-of-range count by construction — the
  partitioner already respects bounds — so no runtime guard is added there.

## Testing

`src/tests/multi-shot-prompt.test.ts`:

- Parameterized over all four presets:
  - `partitionDurations` sums to `totalSeconds`,
  - each shot duration within `[minShotSeconds, maxShotSeconds]`,
  - shot count within `[minShots, maxShots]`,
  - no consecutive camera-param repeats,
  - run ≥30 random seeds per preset (catches edge-of-range partitions).
- New validator test: `multi-shot-shot-count-out-of-range` fires for each
  preset at one-under-min and one-over-max boundaries; does not fire at the
  boundaries themselves.

`src/tests/cli-multi-shot.test.ts`:

- `--plan --preset seedance-10s`, `--preset veo-8s`, `--preset runway-10s`
  each produce a schema-valid `multi-shot-prompt` artifact when combined with
  `--project`.
- `--validate` round-trip per preset using a fixture under
  `references/video/.fixtures/` (one valid per preset).

## Docs and skill updates

- `references/video/multi-shot-framework.md`: new "Presets" section reproducing
  the table above with the rationale column.
- `skills/multi-shot-prompt/SKILL.md`: short paragraph on picking the preset
  that matches the target provider.
- `docs/CLI_REFERENCE.md`: enumerate the four valid `--preset` values under
  `vclaw video multi-shot`.
- `docs/PROMPT_QUALITY.md`: list the new `multi-shot-shot-count-out-of-range`
  issue code.

## Guardrails

- `npm run smoke:multi-shot` extends to a plan→validate round-trip across **all
  four** presets (still no network, no Gemini); fixture-driven.
- `npm run check:cleanroom-docs` and `npm run check:skill-frontdoor` must stay
  green. The new skill section continues to reference the real CLI command, so
  no ignore-list change.
- `npm run check:artifact-schema-coverage` is unaffected — the artifact schema
  did not change (the `preset` field stays a free `string`).

## Build sequence

1. Extend `MultiShotPreset` interface; update `CINEMATIC_15S_PRESET` with
   explicit `minShots: 3, maxShots: 7`; teach `buildShotPlan` to read these
   fields. Update existing tests that depend on the hardcoded `3–7`.
2. Add the three new preset constants and the central registry; export
   `resolvePreset`.
3. Add `multi-shot-shot-count-out-of-range` to `PromptQualityIssueCode`; teach
   `runMultiShotChecks` to emit it.
4. Re-point `vclaw.ts`'s `--preset` validator at the registry (single source of
   truth).
5. Parameterized tests across all presets + validator boundary tests + CLI
   per-preset persistence tests.
6. Extend `scripts/smoke-multi-shot.*` to round-trip all four presets;
   add per-preset fixtures under `references/video/.fixtures/`.
7. Doc + skill + reference-doc updates.

## Risks

- **Char-limit numbers are heuristic.** The 1500/1000 split reflects practical
  experience, not vendor-documented caps. If a provider tightens its real
  budget later, the preset constant is one-line-to-change.
- **Shot-count window is opinionated.** For `veo-8s` the math allows up to 4
  shots; some operators may want 5. They can override with `--shots 5` and the
  validator will reject — by design. The presets encode the framework's
  cinematic opinion; the override flags exist for the corner cases.
