# Prompt-quality preflight

Six mechanical anti-pattern checks driven by the Seedance 2.0 Handbook. They
run inside `director-preflight` against every storyboard scene's text. They are
**warnings by default** and promote to blocking **errors** when
`DIRECTOR_STRICT_PROMPT_QUALITY=1` is set in the environment.

The module (`src/video/prompt-quality.ts`) is pure: no disk I/O, no global
state beyond reading the severity env var at runtime. The checks surface
through the existing `director-preflight` JSON output — there is no new CLI
command and no new smoke.

## Issue codes

| Code | What it catches | Threshold |
|---|---|---|
| `prompt-quality-adjective-soup` | A single clause piling up comma-separated modifiers | `> ADJECTIVE_SOUP_THRESHOLD` (default 4) |
| `prompt-quality-multiple-actions` | Serial third-person-present actions in one clause | `> 1` |
| `prompt-quality-multiple-camera-moves` | More than one camera-move family per prompt | `> 1` movement family |
| `prompt-quality-style-word-overload` | Stacked "cinematic/epic/atmospheric" style words | `> STYLE_WORDS_THRESHOLD` (default 3) |
| `prompt-quality-literary-emotion` | Inner-state language (`feels`, `profound sadness`) instead of visible behavior | any match |
| `prompt-quality-overlong` | Prompt word count above the single-shot budget | `> OVERLONG_WORDS_THRESHOLD` (default 120) |

Vocabularies live in `CAMERA_MOVE_VOCABULARY`, `SHOT_TYPE_VOCABULARY`, and
`STYLE_VOCABULARY` in `src/video/prompt-quality.ts` and are deliberately short
and conservative.

Camera movement is checked separately from shot size. Movement families include
`push-in`, `pull-out`, `tracking`, `orbit`, `static` / `locked-off`, `crane reveal`,
`pan`, `tilt`, `zoom`, `handheld`, and `steadicam`. Shot-size terms such as
`wide shot`, `medium shot`, `close-up`, and `establishing shot` do not count as
movement conflicts, so `wide shot, slow push-in` is valid while `push-in and orbit`
still raises `prompt-quality-multiple-camera-moves`.

For Seedance image-to-video work, keep imported still-image guidance separate
from motion prompting. The still image should carry composition, identity,
wardrobe, props, lighting, and framing. The Seedance prompt should preserve the
source image and add one visible action plus one camera move for a short clip.

## Dialogue duration fit

`director-preflight` also runs a dialogue timing check from `dialogue-fit.ts`.
It is separate from the six prompt-quality anti-pattern checks because it uses a
duration budget rather than prompt wording alone.

Default behavior:

1. scenes without `durationSeconds` use a 15-second target
2. spoken dialogue is estimated at about 2.5 words per second
3. `DIALOGUE_DURATION_OVERFLOW` is emitted when the estimated spoken duration
   exceeds the scene target
4. the issue is a warning by default
5. `DIRECTOR_STRICT_DIALOGUE_FIT=1` promotes it to a blocking error

This check catches scripts that look fine as text but cannot be delivered
naturally inside the clip duration.

## Sample output

A scene with adjective soup and a second camera move produces
`director-preflight` JSON like:

```json
{
  "pass": true,
  "warnings": [
    {
      "severity": "warn",
      "code": "prompt-quality-adjective-soup",
      "scope": "scene:0",
      "message": "Scene 1: clause has 6 adjectives (threshold: 4): ...",
      "suggestion": "Tighten scene wording before approval; see docs/PROMPT_QUALITY.md."
    }
  ],
  "errors": []
}
```

Under `DIRECTOR_STRICT_PROMPT_QUALITY=1` the same issues appear on `errors`,
`pass` flips to `false`, and `execute`/`produce` is blocked (director-mode
preflight failures gate provider submission).

## Promoting to blocking

```bash
DIRECTOR_STRICT_PROMPT_QUALITY=1 vclaw video director-preflight --project <slug>
```

Team workflows that want prompt-quality to be a release gate can export the
variable in CI so every run treats handbook violations the same as content
hazards. Teams still iterating can leave it unset and treat the warnings as
review cues.

## Integration points

- Emitted by `checkPromptQuality` in `src/video/director-preflight.ts`.
- Surfaces in the existing `vclaw video director-preflight` JSON payload.
- Flows into `director-preflight`'s `result.warnings` / `result.errors`
  buckets, so all downstream consumers (tests, CI checks, storyboard.md
  approval review) see them automatically.

## Multi-shot cinematic prompt validation

`runMultiShotChecks(prompt, preset)` enforces the structural rules for
multi-shot cinematic prompts. It lives in the same module as
`runPromptQualityChecks` (`src/video/prompt-quality.ts`) and is invoked
via:

```bash
vclaw video multi-shot --validate
```

Unlike the six anti-pattern checks above, all issues from
`runMultiShotChecks` are **always `error` severity** — they are
structural requirements of the multi-shot format, not stylistic
guidelines, so they cannot be downgraded to warnings by omitting
`DIRECTOR_STRICT_PROMPT_QUALITY`.

### Preset: `cinematic-15s`

The `cinematic-15s` preset defines:

- total duration: **15 s**
- per-shot duration range: **2–5 s**
- character budget: **≤ 1500** characters total

### Issue codes

| Code | What it catches |
|---|---|
| `multi-shot-timecode-parse` | A timecode in the prompt cannot be parsed |
| `multi-shot-timecodes-not-contiguous` | Timecodes have gaps or are not in order |
| `multi-shot-must-start-at-zero` | First timecode is not `00:00` |
| `multi-shot-duration-mismatch` | Timecodes do not sum to the preset total (15 s for `cinematic-15s`) |
| `multi-shot-shot-duration-out-of-range` | A shot's duration falls outside the preset bounds (2–5 s) |
| `multi-shot-character-budget-exceeded` | Total prompt character count exceeds the preset budget (1500) |
| `multi-shot-consecutive-shot-repeat` | A consecutive pair of shots shares the same shot size, lens, angle, or camera movement |
| `multi-shot-missing-metadata-block` | The required `Location / Style / Audio` metadata block is absent |

Matching for consecutive-shot-repeat checks is hyphen/space-insensitive,
so `push in` and `push-in` are treated as the same value.

### Canonical vocabularies

The shot-parameter vocabularies used for consecutive-repeat detection are
defined in `src/video/prompt-quality.ts` and are now canonical for the
entire module:

- `SHOT_SIZE_VOCABULARY` — e.g. `wide shot`, `medium shot`, `close-up`
- `LENS_VOCABULARY` — e.g. `wide angle`, `telephoto`, `macro`
- `ANGLE_VOCABULARY` — e.g. `eye level`, `low angle`, `bird's eye`
- `CAMERA_MOVE_VOCABULARY` — movement families shared with `runPromptQualityChecks`

### Smoke

```bash
npm run smoke:multi-shot
```

Builds the project, runs `vclaw video multi-shot --plan`, then validates
a fixture at `references/video/.fixtures/multi-shot-valid.txt` — a
no-network plan → validate round-trip.

## Follow-on roadmap

- Per-project threshold overrides (today: hardcoded constants).
- LLM-backed checks for subtler anti-patterns ("show don't tell", beat
  structure).
- Auto-fix suggestions, analogous to `DIRECTOR_AUTO_FIX_CONTENT=1` for
  content hazards.
- Tie into the Tier-2 prompt-structure schema (item 9 in
  `MASTER_PLAN_ALIGNMENT.md`) so each check points at the matching schema
  section.
