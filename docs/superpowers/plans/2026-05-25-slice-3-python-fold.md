# Slice 3 — Python Fold (F2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **DO NOT execute this entire plan in one session.** Each of the 9 sub-slices below is itself a multi-day to multi-week effort. Treat each sub-slice as the equivalent of "Slice 1 in size." Execute one at a time, push, validate, then start the next.

**Goal:** Fold the videoclaw-v3 Python pipeline (122 files, ~9.2K LOC in the 15 core modules alone) into the main TypeScript CLI so a single `npm install -g videoclaw` produces a working tool — no Python, no venv, no pip required.

**Architecture:** Each Python entrypoint maps to a TS module under `src/video/assemble/`. A new `vclaw video assemble` subcommand wires them together as the post-execution stage (after raw scene clips are produced by `vclaw video execute`). FFmpeg orchestration via `child_process.spawn`; image manipulation via `sharp`; PDF parsing via `pdfjs-dist`; TTS / music / image-gen via HTTP fetches to the existing provider APIs.

**Tech Stack:** TypeScript NodeNext ESM (existing) + new runtime deps `sharp` (~10MB), `pdfjs-dist` (~5MB). FFmpeg stays as a runtime dependency the user must have installed on PATH (no change from Python pipeline).

**Source spec:** [`docs/superpowers/specs/2026-05-25-videoclaw-v3-unification-design.md`](../specs/2026-05-25-videoclaw-v3-unification-design.md) §4 Slice 3.

**Effort target (corrected):** 2-3 months, sub-divided into 9 sub-slices.

---

## Honest scope assessment

The v3 unification audit identified "14 user-facing Python entrypoints" and estimated 3-4 weeks. **Both numbers were optimistic.** The actual surface:

- **122 Python files** under `skills/video-replicator/scripts/`
- **~9,165 lines** across the 15 core modules this plan touches
- `generate_tts.py` alone is **3,143 lines** — bigger than `src/cli/vclaw.ts` (the whole CLI dispatcher)
- Helpers and internal modules (`bunty_helpers.py` 537 LOC, `assembly_utils.py` 436 LOC, `audio_utils.py` 657 LOC) are consumed by multiple entrypoints

Re-porting all 9.2K LOC literally would be expensive. The right approach is to:
1. Identify the **functional surface** each Python entrypoint exposes (its CLI flags + IO contract)
2. Re-implement that surface in TS using modern Node libraries (sharp, pdfjs-dist, fetch)
3. Skip Python-specific accidental complexity (Python's PIL boilerplate, manual ffmpeg subprocess wrangling, etc.)

Realistic TS LOC: ~3-4K total (less than half the Python because TS + sharp + spawn is more concise than Python + PIL + subprocess).

## Sub-slicing strategy

This plan breaks into **9 sub-slices**. Each sub-slice is the size of "Slice 1." Ship and validate each one before starting the next:

| Sub-slice | Scope | Effort | Risk |
|---|---|---|---|
| 3a | Foundation: `src/video/assemble/` dir, `assemble-report` artifact + schema, new error codes (tts_failed, ffmpeg_failed, etc.), sharp + pdfjs-dist deps | 3-5 days | Low |
| 3b | TTS port — `generate_tts.py` (3143 LOC) → `assemble/tts.ts` + tests | 1-2 weeks | High (3143 LOC is real) |
| 3c | PDF slide extraction — `extract_pdf_slides.py` (246 LOC) → `assemble/pdf.ts` | 3-4 days | Medium |
| 3d | Title cards — `generate_title_card.py` (445 LOC) → `assemble/title-card.ts` | 3-5 days | Medium |
| 3e | Slide animation — `bunty_animate_slides.py` (623 LOC) → `assemble/animate-slides.ts` | 1 week | High (FFmpeg filter graphs) |
| 3f | Music gen — `generate_music.py` (413 LOC) → `assemble/music.ts` | 3-4 days | Medium |
| 3g | QA modules — `bunty_narration_check.py` + `bunty_image_filter_check.py` + `bunty_dialogue_lint.py` (566 LOC combined) → `assemble/qa-*.ts` | 4-5 days | Low |
| 3h | **Stitch (the keystone)** — `stitch_bunty.py` + `nex_assemble.py` (1016 LOC) → `assemble/stitch.ts` with brand-profile parameter | 2 weeks | Critical — this is the integration test of every prior sub-slice |
| 3i | `vclaw video assemble` CLI wiring + presenter migration + Python deprecation | 1 week | Medium |

**Total: ~6-9 weeks of engineering** depending on how cleanly the ports go.

**Don't try to do this in one session.** Sub-slice 3b alone is bigger than the entire Slice 1.

---

## Sub-slice 3a: Foundation

**Goal:** Ground the rest of Slice 3. Land the structural scaffolding so each subsequent sub-slice just adds a file.

**Files:**
- Create: `src/video/assemble/index.ts` — re-exports + types
- Create: `src/video/assemble/types.ts` — shared types (`AssembleInput`, `AssembleResult`, `AssembleManifest`)
- Create: `schemas/video/artifacts/assemble-report.schema.json` — the per-project assemble report shape
- Modify: `src/video/errors.ts` — add 8 new error codes
- Modify: `schemas/video/errors.json` — match the new codes
- Modify: `package.json` — add `sharp` and `pdfjs-dist` dependencies
- Create: `src/tests/assemble-foundation.test.ts`

- [ ] **Step 3a.1: Add the 8 new error codes**

Edit `src/video/errors.ts`. Add to `ALL_ERROR_CODES` under appropriate sections:

```typescript
// User-input errors (1) — append:
'invalid_audio_format',
'invalid_video_format',
'unsupported_codec',

// System errors (2) — append:
'tts_failed',
'music_gen_failed',
'pdf_parse_failed',
'ffmpeg_failed',
'audio_sync_drift',
```

Also extend `EXIT_CODES` map with the same entries (3 → 1, 5 → 2).

Update `schemas/video/errors.json` `codes` array with matching entries (description fields).

The bidirectional sync test (`src/tests/cli-errors.test.ts`) will validate the mapping.

- [ ] **Step 3a.2: Define shared types**

Create `src/video/assemble/types.ts`:

```typescript
import type { ProjectWorkspace } from '../workspace.js';

export interface AssembleInput {
  workspace: ProjectWorkspace;
  /** Path to the brand-profile.json for the active presenter (Slice 2 output). */
  brandProfilePath?: string;
  /** Optional override of FFmpeg path. Defaults to `ffmpeg` on PATH. */
  ffmpegBin?: string;
  /** Dry run produces the report but skips actual generation. */
  dryRun?: boolean;
}

export interface AssembleManifestEntry {
  kind: 'narration' | 'music' | 'title-card' | 'slide-animation' | 'final-video';
  path: string;
  durationMs: number;
  sceneIndex?: number;
  sizeBytes: number;
  generator: string;
}

export interface AssembleResult {
  status: 'complete' | 'partial' | 'dry-run';
  outputPath: string;
  manifest: AssembleManifestEntry[];
  events: string[];
  warnings: string[];
}
```

- [ ] **Step 3a.3: Define the assemble-report artifact schema**

Create `schemas/video/artifacts/assemble-report.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "assemble-report",
  "description": "Per-project report from `vclaw video assemble` — manifest of generated assets + final stitched output.",
  "type": "object",
  "required": ["projectSlug", "generatedAt", "status", "manifest"],
  "properties": {
    "projectSlug": { "type": "string" },
    "generatedAt": { "type": "string", "format": "date-time" },
    "status": { "type": "string", "enum": ["complete", "partial", "dry-run", "failed"] },
    "brandProfile": { "type": ["string", "null"], "description": "Path to the brand-profile.json used for this run." },
    "outputPath": { "type": "string", "description": "Path to the final stitched MP4." },
    "manifest": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["kind", "path", "durationMs", "sizeBytes", "generator"],
        "properties": {
          "kind": { "type": "string", "enum": ["narration", "music", "title-card", "slide-animation", "final-video"] },
          "path": { "type": "string" },
          "durationMs": { "type": "number" },
          "sceneIndex": { "type": "integer" },
          "sizeBytes": { "type": "integer" },
          "generator": { "type": "string", "description": "Which assemble/*.ts module produced this entry." }
        }
      }
    },
    "warnings": { "type": "array", "items": { "type": "string" } },
    "events": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 3a.4: Add deps**

Edit `package.json`:

```json
"dependencies": {
  "sharp": "^0.33.0",
  "pdfjs-dist": "^4.0.0"
}
```

Run `npm install`. Verify lockfile updates and `npm run build` still green.

- [ ] **Step 3a.5: Foundation test**

Create `src/tests/assemble-foundation.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ALL_ERROR_CODES } from '../video/errors.js';

describe('assemble foundation', () => {
  it('new assemble error codes are in catalog', () => {
    const expected = ['tts_failed', 'music_gen_failed', 'pdf_parse_failed', 'ffmpeg_failed', 'audio_sync_drift'];
    for (const code of expected) {
      assert.ok((ALL_ERROR_CODES as readonly string[]).includes(code), `${code} should be in ALL_ERROR_CODES`);
    }
  });

  it('assemble-report.schema.json is parseable JSON', async () => {
    const raw = await readFile(
      join(process.cwd(), 'schemas', 'video', 'artifacts', 'assemble-report.schema.json'),
      'utf-8',
    );
    const schema = JSON.parse(raw) as { title: string; required: string[] };
    assert.equal(schema.title, 'assemble-report');
    assert.ok(schema.required.includes('manifest'));
  });

  it('sharp module loads without error', async () => {
    const sharp = (await import('sharp')).default;
    assert.equal(typeof sharp, 'function');
  });

  it('pdfjs-dist module loads', async () => {
    const pdfjs = await import('pdfjs-dist');
    assert.ok(pdfjs.getDocument);
  });
});
```

- [ ] **Step 3a.6: Commit**

```bash
git add src/video/assemble/ schemas/video/ src/video/errors.ts src/tests/assemble-foundation.test.ts package.json package-lock.json
git commit -m "Slice 3a: assemble foundation — types, schema, error codes, sharp + pdfjs-dist deps"
```

---

## Sub-slice 3b: TTS port (the biggest single port)

**Goal:** Re-implement `generate_tts.py` (3143 LOC) as `src/video/assemble/tts.ts`. Most of the Python is provider-API boilerplate that TS does more concisely with `fetch`. Realistic TS target: ~600-800 LOC.

**Reading list before starting:**
- `skills/video-replicator/scripts/generate_tts.py` (read in full)
- `skills/video-replicator/scripts/audio_utils.py` (657 LOC — TTS helpers)
- Identify the TTS providers it talks to (likely ElevenLabs, OpenAI, maybe Google). Each gets a TS adapter.

**File structure:**
- `src/video/assemble/tts.ts` — main entrypoint, dispatches to provider adapters
- `src/video/assemble/tts-elevenlabs.ts` — ElevenLabs adapter
- `src/video/assemble/tts-openai.ts` — OpenAI TTS adapter (if Python supports it)
- `src/video/assemble/audio-utils.ts` — pure audio helpers (no I/O)
- `src/tests/assemble-tts.test.ts` — unit tests with mocked HTTP

**Approach:**
1. Read `generate_tts.py` to identify: which providers, what request shapes, what output paths, what error cases.
2. Read `audio_utils.py` to identify the helpers (waveform analysis, duration probing, fade-in/out, etc.).
3. Build the TS adapters using `fetch` for HTTP. Use `child_process.spawn` for any `ffprobe` calls.
4. Wire `tts.ts` as the public entrypoint with a single `generateTts(input: TtsInput): Promise<TtsResult>` function.
5. Write unit tests that mock fetch and assert correct request bodies + response handling.
6. Add an integration smoke `scripts/smoke-tts.mjs` that hits a real TTS API in dry-run mode (env-var gated).

**Concrete steps:** see plan structure of Slice 1 Task 1. TDD pattern: write failing test → implement → pass → commit. Break into ~10-15 commits over 1-2 weeks. Each commit:
- One TS file or one provider adapter
- Tests stay green
- Smoke runs (if applicable)

**Test strategy:**
- Unit: mock `fetch`, assert request shape per provider, assert error handling
- Integration: env-gated smoke that calls real ElevenLabs (skipped in CI without `ELEVENLABS_API_KEY`)
- E2E: only after sub-slice 3i, drive `vclaw video assemble` against a fixture project

**Commit pattern for 3b:**
- 3b.1: scaffolding + TtsInput/TtsResult types + main dispatch shell
- 3b.2: ElevenLabs adapter + tests
- 3b.3: OpenAI adapter + tests (if applicable)
- 3b.4: audio-utils.ts (fade, duration probe, format conversion)
- 3b.5: tts.ts main wiring + integration smoke

Each commit independent + tests green.

---

## Sub-slice 3c: PDF slide extraction

**Goal:** Re-implement `extract_pdf_slides.py` (246 LOC) as `src/video/assemble/pdf.ts` using `pdfjs-dist`.

**File structure:**
- `src/video/assemble/pdf.ts`
- `src/tests/assemble-pdf.test.ts`

**Approach:**
- Read `extract_pdf_slides.py`: it likely opens a PDF, iterates pages, renders each to a PNG/JPG at a target resolution.
- Use `pdfjs-dist`'s `getDocument` + `getPage` + `render` API. The Python uses `pdf2image` which shells out to `pdftoppm` — `pdfjs-dist` is pure JS.
- For rendering, pdfjs-dist needs a canvas. In Node, use `@napi-rs/canvas` or `canvas` package. Or use `pdfjs-dist`'s built-in OffscreenCanvas polyfill.

**Test strategy:**
- Unit: render a fixture PDF (committed under `tests/fixtures/sample-3-page.pdf`), assert 3 PNGs are produced with expected dimensions.

**Commit pattern:** 3-5 commits. Foundation + render path + test fixture + integration.

---

## Sub-slice 3d: Title cards

**Goal:** Re-implement `generate_title_card.py` (445 LOC) as `src/video/assemble/title-card.ts`. Likely composes text + image overlays using PIL → port to `sharp`.

**File structure:**
- `src/video/assemble/title-card.ts`
- `src/tests/assemble-title-card.test.ts`
- Fixtures: title card templates if not loaded from brand-profile.json

**Approach:**
- Read `generate_title_card.py`: identify text-overlay logic, font choices, image composition.
- Use `sharp`'s `composite` API for image overlay + `text` operations.
- For font rendering, `sharp` uses libvips fontconfig. Font path comes from brand-profile or system default.

**Commit pattern:** 3-5 commits.

---

## Sub-slice 3e: Slide animation

**Goal:** Re-implement `bunty_animate_slides.py` (623 LOC) as `src/video/assemble/animate-slides.ts`. **This is the hardest sub-slice except for stitch (3h)** because of FFmpeg filter-graph complexity.

**File structure:**
- `src/video/assemble/animate-slides.ts`
- `src/video/assemble/ffmpeg-graphs.ts` — reusable FFmpeg filter-graph builders
- `src/tests/assemble-animate-slides.test.ts`

**Approach:**
- Read `bunty_animate_slides.py` to extract the FFmpeg invocation. It's probably a series of `subprocess.run(['ffmpeg', ...])` calls building Ken-Burns-style pan/zoom animations on static slides.
- Port the FFmpeg arg strings VERBATIM to TS. The args are language-agnostic — Python and TS both shell out the same way.
- Build a `buildAnimateGraph(slide: SlideInput): string[]` function returning the FFmpeg args array. Spawn FFmpeg via `child_process.spawn`.
- Test: assert the args array shape (without actually running FFmpeg) for a sample slide.

**Test strategy:**
- Unit: assert FFmpeg args structure matches Python's invocation
- Integration: env-gated smoke that actually runs FFmpeg against a fixture slide PNG

**Commit pattern:** 4-7 commits. The FFmpeg arg porting is the bulk.

---

## Sub-slice 3f: Music generation

**Goal:** Re-implement `generate_music.py` (413 LOC) as `src/video/assemble/music.ts`. Likely HTTP to a music-gen API (Suno? MusicGen via Replicate?).

**File structure:**
- `src/video/assemble/music.ts`
- `src/tests/assemble-music.test.ts`

**Approach:** same pattern as TTS (Sub-slice 3b but smaller): identify the provider, port the HTTP shape to fetch, mock in tests.

**Commit pattern:** 3-4 commits.

---

## Sub-slice 3g: QA modules

**Goal:** Re-implement the 3 QA scripts:
- `bunty_narration_check.py` (228 LOC) → `assemble/qa-narration.ts`
- `bunty_image_filter_check.py` (213 LOC) → `assemble/qa-image-filter.ts`
- `bunty_dialogue_lint.py` (125 LOC) → `assemble/qa-dialogue-lint.ts`

**Approach:** These are pure analysis modules (no provider calls). They inspect generated artifacts (audio waveforms, image colors, dialogue text) and emit warnings. Likely the easiest ports — mostly string + regex work + waveform stats.

**Commit pattern:** one commit per QA module + a final glue commit. 4 commits total.

---

## Sub-slice 3h: Stitch (the keystone)

**Goal:** Re-implement `stitch_bunty.py` (531 LOC) + `nex_assemble.py` (485 LOC) as a single parameterized `src/video/assemble/stitch.ts`. The brand-profile.json from Slice 2 supplies the per-presenter parameters (intro/outro paths, voice ID, stitching layout).

**This is the keystone — it integrates every prior sub-slice.** Tests for stitch verify that 3b (TTS) + 3c (PDF) + 3d (title-cards) + 3e (animate-slides) + 3f (music) all produce outputs that stitch into a coherent MP4.

**File structure:**
- `src/video/assemble/stitch.ts`
- `src/tests/assemble-stitch.test.ts`
- Fixtures: minimal test project with pre-generated narration/slides/music to assert stitch produces a valid MP4

**Approach:**
- Read both Python files carefully. Identify the difference between bunty's stitch and nex's assembly — these are the brand-profile knobs.
- Build one TS function: `stitch(input: StitchInput): Promise<StitchResult>` that consumes pre-generated assets (narration WAVs, slide MP4s, music MP3, title card PNG) and produces the final MP4.
- The FFmpeg filter graph for the final stitch is likely the most complex single FFmpeg invocation in the codebase. Port carefully; verify with `ffprobe` against the reference output from Python.

**Test strategy:**
- Integration: golden-file comparison — produce stitch output from a fixture project, compare to a reference MP4 produced by the Python version. Allow some tolerance (FFmpeg's H.264 encoder isn't bit-deterministic across versions) but assert duration, resolution, codec, and stream count.

**Commit pattern:** 6-10 commits over ~2 weeks. The bulk is FFmpeg arg porting + test fixture preparation.

---

## Sub-slice 3i: CLI wiring + migration + deprecation

**Goal:** Add `vclaw video assemble` subcommand, migrate the brand-presenter workflow to use it, and deprecate the Python scripts.

**Files:**
- Modify: `src/cli/vclaw.ts` — add `assemble` subcommand to dispatch
- Modify: `src/video/cli-schema.ts` — add `video assemble` to COMMANDS list
- Create: `scripts/smoke-assemble.mjs` — smoke test for the end-to-end pipeline
- Modify: `skills/brand-presenter/SKILL.md` — replace Python pipeline references with `vclaw video assemble`
- Modify: `skills/bunty/brand-profile.json`, `davendra-presenter/brand-profile.json`, `nex-presenter/brand-profile.json` — add any new fields the TS pipeline needs
- Modify: `package.json` — add `smoke:assemble` script
- Modify: `scripts/check-release-readiness-lite.sh` — add `smoke:assemble`
- (Deferred to next slice) Delete `skills/video-replicator/scripts/*.py` — leave for now, mark deprecated in a follow-up

**Approach:**

1. Wire `vclaw video assemble --project <slug>` into the dispatch. It reads the project's brand-profile (if any), runs through the 6 assemble modules in order (PDF → title card → slide animation → TTS → music → stitch), writes `assemble-report.json` artifact.

2. Update brand-presenter SKILL.md workflow steps from "python3 stitch_bunty.py ..." to "vclaw video assemble --project ...".

3. Add `smoke:assemble` to release-readiness-lite. The smoke runs `vclaw video init → brief → storyboard → assets (with a fixture deck) → execute --dry-run → assemble --dry-run` end-to-end.

4. Mark the Python pipeline as deprecated in `skills/video-replicator/SKILL.md` banner: "as of v3.x.0, the Python pipeline is superseded by `vclaw video assemble`. Scripts retained as historical reference until v4.0."

**Commit pattern:** 6-8 commits.

---

## Test gates (all sub-slices)

After every sub-slice commits:
- `npm run build` green
- `npm test` green (all suites)
- After sub-slice 3i only: `npm run check:release-readiness-lite` green (now includes smoke:assemble)

**Critical:** sub-slices 3b through 3h MUST NOT touch `src/cli/vclaw.ts` dispatch. Only sub-slice 3i wires them in. This keeps each sub-slice independently shippable.

---

## Failure modes + rollback

- **FFmpeg encoder drift.** Different FFmpeg versions encode H.264 differently. Golden-file tests for stitch must tolerate this — assert metadata (duration, resolution, stream count), not byte-equality.
- **TTS provider API changes.** ElevenLabs / OpenAI shift schemas. Pin to a specific API version in the adapter. If the provider deprecates, treat that as a separate ticket.
- **sharp native bindings.** sharp ships prebuilt binaries for common platforms but can fail on M1 vs x86 vs ARM Linux. CI must test on the actual deployment target.
- **pdfjs-dist Node compatibility.** Versions 4+ need Node 18+. We're on Node 20, so fine, but newer versions of pdfjs may move to ESM-only or browser-only — pin a known-good version.
- **Per-sub-slice rollback:** `git revert` the sub-slice's commits. Each sub-slice is independent except 3h (depends on 3b-3g) and 3i (depends on all).

---

## What ships after Slice 3

After all 9 sub-slices:
- TS implementations of 6 assembly modules (TTS, PDF, title-card, animate-slides, music, stitch) + 3 QA modules
- `vclaw video assemble --project <slug>` subcommand wired end-to-end
- `assemble-report.json` artifact per project
- 8 new error codes
- `sharp` + `pdfjs-dist` as runtime deps
- Brand-presenter family workflow migrated to TS pipeline
- Python pipeline marked deprecated but retained as historical reference
- `npm install -g videoclaw` produces a working tool — no Python, no venv, no pip required for the assemble path

**What does NOT ship:**
- Python script deletion (deferred to v4.0 — soft-deprecation window)
- Slice 4 (Bun standalone surface collapse)
- Slice 5 (MCP server + external skills pack)

**Next slice to plan after Slice 3:** Slice 4 — Collapse `vclaw-cli` Bun standalone surface into `vclaw veo:*` namespace (~1 week).

---

## Why this plan is plan-only

This plan is committed for future execution. It is NOT for in-session subagent dispatch in the session that wrote it. Reasons:

1. **9 sub-slices × 5-15 commits each = 50-100+ subagent dispatches.** Token cost is genuinely massive.
2. **Each sub-slice needs domain expertise** the executor should ramp into fresh (FFmpeg, sharp, TTS APIs). Context fatigue would degrade quality.
3. **Real video output needs human review.** Stitched MP4s should be eyeballed for quality regressions, which can't happen in a subagent loop.
4. **The Python pipeline currently works.** Replacing it incrementally with validation between sub-slices is safer than a single big-bang execution.

**Recommended execution model:** open a new Claude Code session (or codex, or antigravity) targeted at `/Users/davendrapatel/Documents/GitHub/videoclaw-v3`. Point it at this plan. Have it execute **one sub-slice at a time** with `subagent-driven-development`, pause for human review (especially the video-quality eyeball test), then start the next.

Budget: **2-3 months** of part-time engineering, or **3-4 weeks** of focused full-time effort.
