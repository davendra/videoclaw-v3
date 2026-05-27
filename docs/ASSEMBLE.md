# `vclaw video assemble` — final video assembly

`vclaw video assemble` turns an approved project's storyboard + assets into a
finished narrated MP4: slides → title card → TTS narration → slide animation →
background music → stitched final video. It is the native-TypeScript successor
to the former Python assembly pipeline (`skills/video-replicator/scripts/`).

> **Status (v3.0.0-alpha.1):** code-complete and FFmpeg-validated. The pipeline
> runs end-to-end and produces structurally valid h264/aac MP4s. Aesthetic /
> content quality on real media has not yet been signed off — see
> [Validation status](#validation-status).

## Quick start

```bash
# 1. plan the whole pipeline without running anything (no keys needed)
vclaw video assemble --project my-project --dry-run

# 2. run for real (needs API keys + ffmpeg — see Requirements)
export ELEVENLABS_API_KEY=sk_...
export KIE_API_KEY=...
vclaw video assemble --project my-project
```

Output is JSON when piped (the v3 agent contract): the `assemble-report.json`
artifact path, the final MP4 `outputPath`, a per-stage `manifest`, and any QA
`warnings`.

## Flags

| Flag | Required | Meaning |
|---|---|---|
| `--project <slug>` | yes | The project to assemble. |
| `--root <path>` | no | Workspace root (default: cwd). |
| `--brand-profile <path>` | no | Path to a `brand-profile.json` (presenter parameters + optional assemble knobs). |
| `--dry-run` | no | Plan every step (FFmpeg commands + provider calls) without executing. No keys needed. |

## Requirements (for a real, non-dry-run render)

| Dependency | Why | Env var |
|---|---|---|
| **ffmpeg + ffprobe** on PATH | slide animation, stitch, music-mix, duration probing | override with `VCLAW_FFMPEG_BIN` / `VCLAW_FFPROBE_BIN` |
| **ElevenLabs API key** | TTS narration | `ELEVENLABS_API_KEY` |
| **Kie.ai/Suno API key** | background music (only if the brand profile enables a bed) | `KIE_API_KEY` |

`--dry-run` needs none of these — it plans the pipeline and is what the
`smoke:assemble` CI check exercises.

## Pipeline stages (the order `assembleProject` runs)

1. **PDF slide extraction** — if the project/brand defines a deck PDF, render
   each page to an image (pdfjs-dist + canvas).
2. **Title card** — if the brand profile defines one (sharp SVG-text composite).
3. **TTS narration** — per-scene narration audio via ElevenLabs. Computed before
   animation because narration length drives each slide segment's duration.
4. **Slide animation** — Ken-Burns pan/zoom per slide into a video segment
   (FFmpeg), AV-locked to the narration length, 1280×720 @ 24fps.
5. **Background music** — optional music bed via Kie.ai/Suno.
6. **Stitch** — concatenate segments into the final MP4. Uses the concat
   **demuxer** for <8 segments (single ffmpeg call, no re-encode, exact timing)
   and the concat **filter** for ≥8 (re-encode, drift-free). Music is mixed
   under the narration with ducking + fade-out.
7. **QA** — advisory local checks (dialogue lint, narration timing, image-filter
   risk). These return warnings; they don't block.

All segments share a uniform encoding (H.264 libx264 crf20, 24fps, 1280×720
yuv420p, AAC 44100 stereo) so the concat-demuxer path works cleanly.

## Reading the report

`assembleProject` writes `projects/<slug>/artifacts/assemble-report.json`
(schema: `schemas/video/artifacts/assemble-report.schema.json`):

- `status` — `complete` | `partial` | `dry-run` | `failed`
- `outputPath` — the final MP4
- `manifest` — one entry per generated asset (`kind`, `path`, `durationMs`,
  `sizeBytes`, `generator`)
- `warnings` — advisory QA findings
- `events` — ordered log of what ran (or what *would* run, in dry-run)

## Validation status

**What's proven:**
- Unit tests (arg-shape + dry-run planning) — `npm test`.
- `npm run smoke:assemble` — dry-run pipeline plan (CI-safe, no keys/ffmpeg).
- `npm run smoke:assemble-render` — **real ffmpeg** render on synthetic inputs
  (ffmpeg-generated sources + sharp PNGs, no API keys). Confirms animate / stitch
  (demuxer + filter) / music-mix all execute in ffmpeg and produce valid
  h264/aac 1280×720 MP4s with correct durations + stream counts. Skips cleanly
  if ffmpeg isn't installed.

**What still needs a human (the open checkpoint):**
- Render one real project with real keys and **watch + listen** to the result.
  The synthetic smoke uses silent audio + solid-color slides, so it proves the
  plumbing but not that the finished video looks/sounds *good* — fade timing,
  AV-lock feel, music mix levels, narration pacing on real content.

If something looks off on a real render, the fix is almost certainly aesthetic
tuning (fade durations, mix volume, pacing) rather than structural — the FFmpeg
command structure is ported verbatim from the proven Python and is render-tested.

## Migrating from the Python pipeline

The Python scripts under `skills/video-replicator/scripts/` (TTS, stitch, etc.)
are retained as the proven reference. Prefer `vclaw video assemble` going
forward; the Python path will be retired once the TS path is validated on real
renders. See `docs/MASTER_PLAN_ALIGNMENT.md` for the current honest status.
