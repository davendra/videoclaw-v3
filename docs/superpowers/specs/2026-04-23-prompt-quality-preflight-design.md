# Prompt-quality preflight — design

**Status:** Draft for review (defaults applied; `go` to execute)
**Date:** 2026-04-23
**Owner:** Davendra Patel
**Tier:** 2 (Seedance-handbook-driven follow-on)
**Sibling:** [`2026-04-22-reference-sheets-design.md`](./2026-04-22-reference-sheets-design.md) · [`2026-04-22-scene-candidates-design.md`](./2026-04-22-scene-candidates-design.md)
**Scope estimate:** ~200–300 LOC across ~10 files, 1 focused session

---

## Problem

The Seedance 2.0 Handbook lists six "biggest beginner mistakes" (page 3) and eight "common anti-patterns" (page 14). The repo's existing `director-preflight` catches only content-filter hazards, reference problems, pronoun drift, and repeated scenes. It does not yet catch the most common *prompt-quality* failure modes:

- **Adjective soup** — too many modifiers, no focus
- **Too many actions** per shot (violates "one shot = one dominant readable action")
- **Too many camera moves** per shot (violates "camera is not decoration")
- **Too many style words** / unbalanced style weights
- **Literary emotion language** instead of visible on-screen behavior
- **Overall prompt length** (proxy for prompt overload / no hierarchy)

These are mechanically detectable from the scene prompt text. Catching them at preflight saves real provider credits and operator time — the handbook explicitly flags them as the root cause of most first-round failures.

## Goal

Add a `prompt-quality` check suite to `director-preflight.ts` that scans every storyboard scene's prompt and emits warnings (or blockers, operator-configurable) for the six mechanical anti-patterns above.

## Non-goals

1. **LLM-based prompt scoring.** v1 is pure-heuristic. No Gemini/OpenAI round-trips.
2. **Auto-fix.** Reports issues; does not rewrite prompts (unlike existing `DIRECTOR_AUTO_FIX_CONTENT` for hazards).
3. **Contradictory-identity detection.** Requires cross-prompt semantic analysis; deferred.
4. **Variable-change tracking across scenes** ("changing too many variables at once"). Requires scene-diff; deferred.
5. **Continuity without start lock.** Already covered by scene-candidates `chain-from-prev-source-missing`.
6. **Storyboard mode blocking.** v1 runs in director mode only, matching existing preflight semantics.

## Approach

One new pure module + one hook into existing preflight.

- `src/video/prompt-quality.ts` — pure-function module with six check functions and a runner.
- `src/video/director-preflight.ts` — extend `runDirectorPreflight` to invoke the runner for each scene's prompt.

Each check takes a prompt string and returns zero or more issues. Issues carry a code, severity (`warn` by default), and a message describing what was found. Thresholds are hardcoded in v1 with well-named constants so they can be tuned later without API churn.

## Checks (v1)

| Code | Description | Default severity | Threshold |
|---|---|---|---|
| `prompt-quality-adjective-soup` | Too many adjectives per clause | `warn` | >4 adjectives in a single clause (`.` or `;` delimited) |
| `prompt-quality-multiple-actions` | More than one dominant verb in the main clause | `warn` | >1 action verb outside of subordinate clauses |
| `prompt-quality-multiple-camera-moves` | More than one camera-move directive | `warn` | >1 match against the camera-vocabulary list |
| `prompt-quality-style-word-overload` | More than N style/aesthetic modifiers | `warn` | >3 matches against the style-vocabulary list |
| `prompt-quality-literary-emotion` | Literary "feels X" / "seems Y" language instead of visible behavior | `warn` | any match against emotion-language patterns |
| `prompt-quality-overlong` | Prompt exceeds a reasonable length | `warn` | >120 words per scene |

All checks emit warnings by default. Setting `DIRECTOR_STRICT_PROMPT_QUALITY=1` in the environment promotes them to blocking errors (mirrors the existing `SKIP_DIRECTOR_PREFLIGHT=1` / `DIRECTOR_AUTO_FIX_CONTENT=1` pattern).

## Vocabulary lists (hardcoded, readable constants)

Pulled from the handbook's page-16 "Practical Language That Helps":

- **Camera verbs:** `dolly`, `track`, `crane`, `pan`, `tilt`, `zoom`, `handheld`, `steadicam`, `establishing shot`, `close-up`, `wide shot`, `medium shot` *(matched as whole words, case-insensitive)*
- **Style words:** `cinematic`, `epic`, `atmospheric`, `ethereal`, `hyperrealistic`, `photorealistic`, `surreal`, `dramatic`, `moody`, `vibrant`, `nostalgic`, `gritty`, `dreamy`, `stylized` *(extensible list)*
- **Emotion-language patterns:** `\b(feels|seems|appears|looks|evokes|conveys)\s+\w+`, plus a short explicit list of adjectives like `ethereal feeling`, `profound sadness`, `deep joy`

## Data flow

```
storyboard.json.scenes[]
  └─→ scene.prompt (string)
       └─→ runPromptQualityChecks(prompt)
            └─→ returns PromptQualityIssue[]
                 ├─ code
                 ├─ severity
                 └─ message
```

The issues are merged into the existing preflight result in the same shape as content-hazard issues — matching the repo's existing `VideoPreflightIssue` record.

## CLI impact

No new commands. The existing `director-preflight` CLI surfaces new issue codes. `storyboard-review` picks them up automatically via the shared preflight call. Environment toggle:

```bash
DIRECTOR_STRICT_PROMPT_QUALITY=1 vclaw video director-preflight --project my-project
```

## Integration points

- `src/video/director-preflight.ts` — extend `runDirectorPreflight` with one new block that loops scenes and invokes `runPromptQualityChecks`.
- `src/video/storyboard-markdown.ts` — warning rendering already handled by the existing "Preflight issues" section; new codes surface automatically.

## Docs

- Append a `## Prompt-quality checks` section to `docs/ARCHITECTURE.md` under the existing preflight bullet.
- Add one row per new issue code to `docs/REFERENCE_SHEETS.md` or a new `docs/PROMPT_QUALITY.md`. Use `docs/PROMPT_QUALITY.md` because this is a standalone concept not tied to reference sheets.
- Update README's "What's shipped" themes block.
- Bump `docs/MASTER_PLAN_ALIGNMENT.md` items: move prompt-quality preflight out of Tier 2 into the implemented list (new item 56).

## Testing

- **Module contracts:** `src/tests/prompt-quality.test.ts` — one test per check function. Known-good prompt passes; each anti-pattern triggers its own code.
- **Integration:** `src/tests/director-preflight.test.ts` extend — a storyboard with an "adjective soup" prompt produces a preflight result carrying `prompt-quality-adjective-soup`.
- **Environment flag:** verify that `DIRECTOR_STRICT_PROMPT_QUALITY=1` promotes severity to `error`.

## Risks

| Risk | Mitigation |
|---|---|
| False positives annoy operators | Default severity is `warn`, not `error`. Flag, don't block, unless operator opts in. |
| Hardcoded thresholds don't fit all workflows | Named constants at the top of the module; easy to tune. Future task: expose via project config. |
| Vocabulary lists drift from Seedance reality | Centralize in the module, keep short; easy to update in follow-ups. |
| Heuristics flag prompts that are actually fine | Each check is independent. If one proves noisy, can disable by promoting only others to blocking or by dropping its threshold. |

## Follow-on work (out of v1)

1. Operator-configurable thresholds per project (`prompt-quality.config.json`)
2. LLM-backed semantic checks (contradictory identity, variable-change tracking across scenes)
3. Auto-fix ("suggested rewrite" output alongside each issue)
4. Apply to asset-manifest scene-prompt overrides, not just storyboard.json
5. Integrate with the prompt-structure schema follow-on (Tier 2 item 5) to score prompts against the 10-step handbook schema

## Decisions record

**P1 — All 6 checks in v1, not a minimal slice.** Rationale: the checks are independent and cheap. Shipping them together is the same total work as shipping one well, and each covers a distinct handbook anti-pattern.

**P2 — Default severity is `warn`, not `error`.** Rationale: first-landing of heuristic checks should not break existing projects. Operator opts in to blocking via `DIRECTOR_STRICT_PROMPT_QUALITY=1`.

**P3 — Hardcoded thresholds in v1.** Rationale: project-level config is follow-on (#1 above). Named constants keep tuning trivial.

**P4 — Director mode only.** Rationale: matches existing preflight semantics. Storyboard mode is for iteration; quality gates belong behind the director approval gate.

**P5 — Docs land under `docs/PROMPT_QUALITY.md` (new).** Rationale: standalone concept; not a subsection of reference-sheets or scene-candidates.

All defaults locked. No open decisions blocking implementation.

## File list

### New
- `src/video/prompt-quality.ts`
- `src/tests/prompt-quality.test.ts`
- `docs/PROMPT_QUALITY.md`

### Modified
- `src/video/director-preflight.ts`
- `src/tests/director-preflight.test.ts`
- `src/index.ts` (re-export)
- `docs/ARCHITECTURE.md`
- `docs/MASTER_PLAN_ALIGNMENT.md`
- `README.md`

## Shipping checklist

1. `npm test` green
2. `npm run check:release-readiness-lite` green
3. `npm run check:cleanroom-docs` green
