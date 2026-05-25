#!/usr/bin/env python3
"""bunty_animate_slides.py — Animate Bunty slide images into F2V loops.

Replaces the default static-image slide segments in a Bunty match-recap with
F2V seamless loops (subtle ambient motion that respects the slide composition).
Outputs `final/segments_animated/seg_slide_NN.mp4` segments compatible with
`stitch_bunty.py --animated`.

Pipeline:
  1. Stage slide images as F2V frames at `images/run001_scene_N_frame.jpg`
     (skipped if image already present; landscape variant duplicated)
  2. Build `scenes_animated_slides.json` with per-style subtle-motion prompts
     (or load user-provided prompts via --prompts-json)
  3. Drive `parallel_video_gen.py --f2v-loop` to generate one F2V per scene
  4. For each scene, encode a slide segment at `final/segments_animated/
     seg_slide_NN.mp4`: loops the F2V to TTS duration via `-stream_loop -1`,
     bakes the TTS, applies boundary fades (slide 1 fade-in, slide N fade-out)

Usage:
  python bunty_animate_slides.py --project projects/<slug> --num-slides 12 --style tabloid --yes

  # Use existing custom prompts (skip auto-templates)
  python bunty_animate_slides.py --project projects/<slug> --num-slides 12 \\
      --prompts-json projects/<slug>/scenes_animated_slides.json --yes

  # Skip Veo generation (segments-only re-encode from existing videos)
  python bunty_animate_slides.py --project projects/<slug> --num-slides 12 \\
      --segments-only --yes
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if Path.cwd() != REPO_ROOT:
    os.chdir(REPO_ROOT)

SCRIPTS_DIR = Path(__file__).resolve().parent

# Per-style subtle-motion prompt templates. Each is a single Veo F2V prompt
# applied across all slides in that style — the slide image carries the
# content, the prompt only needs to specify the ambient motion vocabulary.
#
# DESIGN RULE: templates describe motion OVERLAY only, never re-describe what
# the slide already shows. Avoid vocab that doubles content-filter risk on
# slides whose imagery is already dramatic (broken stumps, explosions,
# "destroyer" headlines). High-risk tokens to avoid: burst, explosion, blast,
# smash, destroyer, dramatic, intense, violent, crash, collide, shatter.
STYLE_ANIMATION_PROMPTS = {
    "broadcast": (
        "Camera static. Soft luminance drift across overlay elements, "
        "subtle accent-colour breath, gentle ambient light sheen. "
        "Very minimal motion, 80 percent of frame completely still. "
        "No camera movement. Atmospheric only."
    ),
    "tabloid": (
        "Camera static. Newsprint paper texture shimmers, ink splatter pulses subtly, "
        "halftone dots drift slowly, red accent elements have gentle glow shift. "
        "Very minimal motion, 80 percent of frame completely still. "
        "No camera movement. Atmospheric only."
    ),
    "minimal": (
        "Camera static. Single accent-colour element has slow luminance breath, "
        "negative space is completely still, hero stat number has subtle weight shimmer. "
        "Very minimal motion, 90 percent of frame completely still. "
        "No camera movement. Atmospheric only."
    ),
    "comic": (
        "Camera static. Halftone Ben-Day dots drift slowly, ambient line work has "
        "subtle motion, panel edges have gentle colour breath. "
        "Very minimal motion, 80 percent of frame completely still. "
        "No camera movement. Atmospheric only."
    ),
    "indian-tv": (
        "Camera static. Slow chrome shimmer across metallic elements, "
        "gentle gold and saffron accent pulse, soft warm light bloom. "
        "Very minimal motion, 80 percent of frame completely still. "
        "No camera movement. Atmospheric only."
    ),
}

# Ultra-safe motion prompt used when a scene gets rejected by Google's content
# filter. Applied per-scene during the auto-recovery loop. Generic enough to
# pass on any slide imagery, motion-only vocab.
SAFE_FALLBACK_PROMPT = (
    "Camera static. Gentle ambient light shift, soft warm glow drift, subtle particle motion. "
    "Very minimal motion, 90 percent of frame completely still. "
    "No camera movement. Atmospheric only."
)

# Tokens in an animation prompt that materially raise content-filter risk
# when the underlying slide already shows dramatic imagery. The vocab linter
# warns when any of these appear in a per-scene prompt.
#
# Match 13 (2026-05-17) added the electricity/lightning family after slide 11
# (FINISHING TOUCH — Shibam Jena 54*) tripped the filter on first run even
# with the safe-fallback prompt. The slide had lightning-bolt overlay
# imagery; the linter previously had no tokens for that motif.
HIGH_RISK_VOCAB = (
    "burst", "explosion", "blast", "smash", "destroyer", "dramatic",
    "intense", "violent", "crash", "collide", "shatter", "explode",
    "bombard", "annihilate",
    # Electricity / lightning / spark family (added Match 13)
    "lightning", "electricity", "electric", "bolt", "spark", "sparkle",
    "shock", "shocking", "fireworks", "flash", "flashing", "ignite",
    "scorch", "sear", "blaze", "blazing", "thunder", "thunderbolt",
)

DEFAULT_STYLE = "broadcast"


def run(cmd, *, check: bool = True, capture: bool = True):
    """Run a command (list or string) with sensible defaults."""
    if isinstance(cmd, str):
        printable = cmd[:120]
        args = shlex.split(cmd)
    else:
        printable = " ".join(cmd)[:120]
        args = cmd
    print(f"  $ {printable}", file=sys.stderr)
    r = subprocess.run(args, capture_output=capture, text=True)
    if check and r.returncode != 0:
        detail = (r.stderr or r.stdout or "")[:500]
        print(f"  ERROR (exit {r.returncode}){': ' + detail if detail else ' (no captured output)'}", file=sys.stderr)
        sys.exit(r.returncode)
    return r


def get_duration(filepath: str) -> float:
    cmd = ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filepath]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0


def find_f2v_video(videos_dir: Path, scene_num: int) -> Path | None:
    """Find the F2V loop for a slide scene. Prefers the latest run prefix."""
    matches = []
    for f in sorted(videos_dir.glob(f"*scene_{scene_num}.mp4"), reverse=True):
        # Exclude variation suffixes (_v1.mp4 etc.) and _vc files
        name = f.name
        if "_vc.mp4" in name or "_v1.mp4" in name or "_v2.mp4" in name:
            continue
        matches.append(f)
    return matches[0] if matches else None


def stage_slide_images(slides_dir: Path, images_dir: Path, num_slides: int, run_id: str = "run001") -> int:
    """Copy slides/slide_NNN.jpg → images/{run}_scene_N_frame.jpg (+ _landscape).
    Returns number staged. Skips slides already present."""
    images_dir.mkdir(parents=True, exist_ok=True)
    staged = 0
    for n in range(1, num_slides + 1):
        src = slides_dir / f"slide_{n:03d}.jpg"
        dst = images_dir / f"{run_id}_scene_{n}_frame.jpg"
        dst_landscape = images_dir / f"{run_id}_scene_{n}_frame_landscape.jpg"
        if not src.exists():
            print(f"  WARNING: missing slide {src.name}", file=sys.stderr)
            continue
        if not dst.exists():
            shutil.copy2(src, dst)
            staged += 1
        if not dst_landscape.exists():
            shutil.copy2(src, dst_landscape)
    return staged


def write_prompts_json(prompts: dict, prompts_path: Path) -> None:
    prompts_path.parent.mkdir(parents=True, exist_ok=True)
    with prompts_path.open("w") as f:
        json.dump({str(k): v for k, v in prompts.items()}, f, indent=2)


def build_style_prompts(style: str, num_slides: int, custom: dict | None) -> dict:
    """Build per-scene prompts. If custom provided, use those; otherwise apply
    the style template to all slides."""
    if custom:
        return {int(k): v for k, v in custom.items()}
    template = STYLE_ANIMATION_PROMPTS[style]
    return {n: template for n in range(1, num_slides + 1)}


def draft_prompts_via_gemini(project: Path, style: str, num_slides: int) -> dict:
    """Use generate_animation_prompts.py (Gemini Vision) to draft a bespoke
    per-slide subtle-motion prompt. Each prompt is then prefixed with the
    style-vocab keywords (e.g. tabloid → newsprint/halftone, indian-tv →
    chrome/saffron) so the slide-aware motion blends with the deck style.

    Returns per-scene prompt dict (int-keyed). Raises on hard failure."""
    slides_json = project / "analysis" / "slides.json"
    images_dir = project / "slides"
    if not slides_json.is_file():
        raise FileNotFoundError(f"slides.json not found at {slides_json} — "
                                "run bunty_match_to_deck.py first")

    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tf:
        tmp_out = Path(tf.name)
    try:
        cmd = [
            sys.executable, str(SCRIPTS_DIR / "generate_animation_prompts.py"),
            "--slides-json", str(slides_json),
            "--images-dir", str(images_dir),
            "--style", "subtle",
            "--output", str(tmp_out),
        ]
        r = run(cmd, capture=True, check=False)
        if r.returncode != 0 or not tmp_out.is_file():
            raise RuntimeError(f"generate_animation_prompts.py failed (exit {r.returncode}): "
                               f"{(r.stderr or r.stdout or '')[:300]}")
        with tmp_out.open() as f:
            data = json.load(f)
    finally:
        try:
            tmp_out.unlink()
        except FileNotFoundError:
            pass

    # generate_animation_prompts.py emits {"prompts": {"1": "...", "2": "..."}}
    # or sometimes {"1": "..."} directly. Normalize both.
    raw = data.get("prompts") if isinstance(data, dict) and "prompts" in data else data
    drafted = {int(k): str(v) for k, v in raw.items() if str(k).isdigit()}

    # Catch the silent-fallback bug surfaced by Match 13 (2026-05-17): Gemini
    # returns a successful response but with NO per-slide entries, or with all
    # entries identical (helper hit its own internal generic fallback). In
    # either case the downstream blend defaulted every scene to the same flat
    # style template, eliminating per-slide variety with no warning. Raise
    # loudly here so main() can surface the failure to the user.
    if not drafted:
        raise RuntimeError(
            f"Gemini drafted zero per-slide prompts (helper returned empty/malformed "
            f"output, parsed keys={list(raw.keys()) if isinstance(raw, dict) else type(raw).__name__})"
        )
    if len(drafted) < num_slides:
        missing = [n for n in range(1, num_slides + 1) if n not in drafted]
        raise RuntimeError(
            f"Gemini drafted only {len(drafted)}/{num_slides} prompts — missing scenes {missing}"
        )
    unique_drafts = {v.strip() for v in drafted.values()}
    if len(unique_drafts) == 1:
        sample = next(iter(unique_drafts))[:80]
        raise RuntimeError(
            f"Gemini drafted {num_slides} IDENTICAL prompts — likely an internal helper fallback, "
            f"not real per-slide Vision output. Sample: {sample!r}…"
        )

    # Blend style vocab into each drafted prompt by appending the style template
    # as a stylistic anchor. The Gemini draft brings slide-specific motion,
    # the style template brings the visual texture palette.
    style_anchor = STYLE_ANIMATION_PROMPTS[style]
    style_keyword = style_anchor.split(". ", 1)[1].split(". ", 1)[0] if ". " in style_anchor else ""
    blended = {}
    for n in range(1, num_slides + 1):
        draft = drafted.get(n) or STYLE_ANIMATION_PROMPTS[style]
        if style_keyword and style_keyword not in draft:
            draft = f"{draft.rstrip('.')}. {style_keyword}."
        blended[n] = draft
    return blended


def _submit_f2v_batch(slug: str, scenes: dict, quality: str) -> int:
    """Submit one parallel_video_gen.py --f2v-loop batch. Returns exit code.
    Non-zero is non-fatal at this layer — caller decides whether to retry."""
    cmd = [
        sys.executable, str(SCRIPTS_DIR / "parallel_video_gen.py"),
        "--product", slug,
        "--mode", "frames-to-video",
        "--f2v-loop",
        "--scenes", json.dumps(scenes),
        "--image-run", "run001",
        "--ratio", "landscape",
        "--quality", quality,
        "--variations", "1",
        "--allow-stale", "--continue", "--yes",
    ]
    r = run(cmd, capture=False, check=False)
    return r.returncode


def generate_f2v_videos(slug: str, prompts: dict, project: Path, quality: str = "fast") -> int:
    """Drive parallel_video_gen.py --f2v-loop to generate one F2V per scene.
    Auto-recovers from content-filter rejections: any scene without an output
    after the first batch is re-submitted using SAFE_FALLBACK_PROMPT.
    Returns 0 on full success, 1 if any scene still missing after recovery."""
    videos_dir = project / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)

    def _pending(scenes_to_check):
        out = {}
        for n in scenes_to_check:
            existing = find_f2v_video(videos_dir, int(n))
            if existing and existing.stat().st_size > 100_000:
                continue
            out[str(n)] = prompts[int(n)]
        return out

    pending = _pending(prompts.keys())
    if not pending:
        print("  All F2V videos already present — skipping Veo generation.", file=sys.stderr)
        return 0

    print(f"  Generating {len(pending)} F2V loops via Veo (quality={quality})...", file=sys.stderr)
    _submit_f2v_batch(slug, pending, quality)

    # Detect any scenes that didn't produce a video — those are recovery candidates.
    still_missing = _pending(pending.keys())
    if not still_missing:
        return 0

    failed_scenes = sorted(int(n) for n in still_missing)
    print(f"\n  Content-filter recovery: {len(failed_scenes)} scene(s) missing — "
          f"retrying {failed_scenes} with safe-fallback prompt", file=sys.stderr)
    retry = {str(n): SAFE_FALLBACK_PROMPT for n in failed_scenes}
    _submit_f2v_batch(slug, retry, quality)

    still_missing = _pending(retry.keys())
    if still_missing:
        print(f"  WARNING: {len(still_missing)} scene(s) still missing after recovery: "
              f"{sorted(int(n) for n in still_missing)}", file=sys.stderr)
        return 1
    print(f"  Recovery succeeded — all {len(failed_scenes)} scene(s) generated with fallback prompt.", file=sys.stderr)
    return 0


def lint_animation_prompts(prompts: dict) -> list[tuple[int, list[str]]]:
    """Scan per-scene prompts for HIGH_RISK_VOCAB tokens. Returns list of
    (scene_num, matched_tokens) for any scene with at least one hit."""
    findings = []
    for n, p in prompts.items():
        lower = p.lower()
        hits = [tok for tok in HIGH_RISK_VOCAB if tok in lower]
        if hits:
            findings.append((int(n), hits))
    return findings


def encode_animated_slide_segment(
    f2v_video: Path,
    tts_file: Path,
    output_path: Path,
    slide_num: int,
    num_slides: int,
    fade_duration: float,
) -> None:
    """Loop F2V to TTS duration, bake TTS, apply boundary fades. Mirrors
    stitch_bunty.encode_slide_segment but with -stream_loop -1 on the video."""
    import math
    tts_dur = get_duration(str(tts_file))
    # Round duration UP to the next 24fps frame boundary so both video and audio
    # end at the same exact timestamp. Without alignment, H.264 rounds video up
    # to the next frame (~22-40ms longer than the TTS file) while apad pads
    # audio to exactly tts_dur — the resulting mismatch compounds across concat
    # boundaries into audible drift. With alignment, video and audio are
    # byte-exact AV-locked.
    duration = math.ceil(tts_dur * 24) / 24

    vfades = []
    afades = []
    if slide_num == 1 and fade_duration > 0:
        vfades.append(f"fade=t=in:st=0:d={fade_duration}")
        afades.append(f"afade=t=in:st=0:d={fade_duration}")
    if slide_num == num_slides and fade_duration > 0:
        fade_start = duration - fade_duration
        vfades.append(f"fade=t=out:st={fade_start:.3f}:d={fade_duration}")
        afades.append(f"afade=t=out:st={fade_start:.3f}:d={fade_duration}")

    vfade_str = "," + ",".join(vfades) if vfades else ""
    afade_str = "," + ",".join(afades) if afades else ""

    # AV-lock strategy:
    # - duration is rounded UP to nearest 24fps frame (see above)
    # - apad whole_dur pads audio with silence past the aligned duration so the
    #   AAC encoder always has a full frame to emit (no partial-frame drop)
    # - -frames:v caps video at the exact aligned frame count
    # Net: per-segment AV duration mismatch reduced from ±41ms (Match 5/6)
    # to within ±5ms on most segments; with demuxer-first concat the residual
    # is well below perceptual drift.
    frame_count = int(round(duration * 24))
    safety_pad = duration + 0.5
    cmd = (
        f'ffmpeg -y -stream_loop -1 -i {shlex.quote(str(f2v_video))} '
        f'-i {shlex.quote(str(tts_file))} '
        f'-filter_complex "'
        f'[0:v]scale=1280:720:force_original_aspect_ratio=decrease,'
        f'pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p{vfade_str}[v];'
        f'[1:a]aresample=44100,aformat=channel_layouts=stereo,'
        f'apad=whole_dur={safety_pad:.6f}{afade_str}[a]" '
        f'-map "[v]" -map "[a]" '
        f'-r 24 -frames:v {frame_count} '
        f'-c:v libx264 -preset fast -crf 20 '
        f'-c:a aac -ar 44100 -ac 2 '
        f'-t {duration:.6f} '
        f'{shlex.quote(str(output_path))}'
    )
    r = subprocess.run(shlex.split(cmd), capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  ERROR encoding seg_slide_{slide_num:02d}: {r.stderr[:400]}", file=sys.stderr)
        sys.exit(1)
    print(f"  seg_slide_{slide_num:02d}.mp4 ({duration:.1f}s)", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Animate Bunty slides into F2V loops",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  # Default tabloid style (matches Match 4 — Wollaston U13)
  python bunty_animate_slides.py --project projects/2026-05-11_wicc-match-7498226 \\
      --num-slides 12 --style tabloid --yes

  # Broadcast style with custom per-scene prompts
  python bunty_animate_slides.py --project projects/<slug> --num-slides 14 \\
      --prompts-json projects/<slug>/scenes_animated_slides.json --yes

  # List available styles
  python bunty_animate_slides.py --list-styles
""",
    )
    ap.add_argument("--list-styles", action="store_true", help="List available animation style presets and exit")
    ap.add_argument("--project", help="Project directory (e.g. projects/<slug>)")
    ap.add_argument("--num-slides", type=int, help="Number of slides (auto-detected from analysis/deck_meta.json if absent)")
    ap.add_argument("--style", default=None, choices=sorted(STYLE_ANIMATION_PROMPTS.keys()),
                    help=f"Animation style preset (auto-detected from analysis/deck_meta.json if absent; "
                         f"otherwise '{DEFAULT_STYLE}')")
    ap.add_argument("--prompts-json", default=None,
                    help="Optional path to a JSON file with custom per-scene prompts {\"1\":\"...\"}. Overrides --style template.")
    ap.add_argument("--overwrite-prompts", action="store_true",
                    help="Overwrite existing scenes_animated_slides.json in the project. "
                         "By default, an existing file is preserved and used as the source of truth.")
    ap.add_argument("--draft-prompts", action="store_true",
                    help="Use Gemini Vision (via generate_animation_prompts.py) to draft a "
                         "slide-specific subtle-motion prompt per slide, then blend with the "
                         "--style vocab. Recommended over the flat template — adds variety + "
                         "respects each slide's actual imagery.")
    ap.add_argument("--skip-lint", action="store_true",
                    help="Skip the high-risk vocab linter (use only if you know what you're doing).")
    ap.add_argument("--quality", default="fast", choices=["fast", "quality", "lite"],
                    help="Veo quality tier for F2V loops (default: fast; ~10 credits per slide)")
    ap.add_argument("--fade", type=float, default=0.75,
                    help="Fade-through-black on slide 1 / slide N (default: 0.75)")
    ap.add_argument("--segments-only", action="store_true",
                    help="Skip Veo generation; re-encode segments from existing F2V videos only")
    ap.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompts")
    args = ap.parse_args()

    if args.list_styles:
        print("Available animation style presets for --style:\n")
        for name, prompt in STYLE_ANIMATION_PROMPTS.items():
            marker = " (default)" if name == DEFAULT_STYLE else ""
            print(f"  {name}{marker}\n    {prompt}\n")
        return 0

    if not args.project:
        ap.error("--project is required (unless using --list-styles)")

    project = Path(args.project).resolve()
    if not project.is_dir():
        print(f"ERROR: project directory not found: {project}", file=sys.stderr)
        return 1

    # Sidecar: read analysis/deck_meta.json for --style and --num-slides defaults.
    # Lets the operator skip those flags after running bunty_match_to_deck.py.
    meta_path = project / "analysis" / "deck_meta.json"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text())
            if args.style is None and "style" in meta and meta["style"] in STYLE_ANIMATION_PROMPTS:
                args.style = meta["style"]
                print(f"[plan] style auto-detected from deck_meta.json: {args.style}", file=sys.stderr)
            if args.num_slides is None and "num_slides" in meta:
                args.num_slides = int(meta["num_slides"])
                print(f"[plan] num_slides auto-detected from deck_meta.json: {args.num_slides}", file=sys.stderr)
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            print(f"[plan] deck_meta.json present but unparseable ({e!r}); ignoring", file=sys.stderr)

    if args.style is None:
        args.style = DEFAULT_STYLE
    if not args.num_slides:
        ap.error("--num-slides is required (and not found in analysis/deck_meta.json)")

    slug = project.name
    slides_dir = project / "slides"
    images_dir = project / "images"
    tts_dir = project / "audio" / "tts"
    videos_dir = project / "videos"
    segments_dir = project / "final" / "segments_animated"
    prompts_path = project / "scenes_animated_slides.json"

    for d, label in [(slides_dir, "slides"), (tts_dir, "audio/tts")]:
        if not d.is_dir():
            print(f"ERROR: {label} directory not found: {d}", file=sys.stderr)
            return 1

    # Load or build prompts. Precedence:
    #   1. --prompts-json explicit path
    #   2. --draft-prompts (Gemini Vision per-slide drafting, blended with --style vocab)
    #   3. existing scenes_animated_slides.json in the project (preserved by default)
    #   4. fall back to the --style template applied to every slide
    custom = None
    custom_source: str | None = None
    if args.prompts_json:
        custom_path = Path(args.prompts_json)
        if not custom_path.is_file():
            print(f"ERROR: --prompts-json not found: {custom_path}", file=sys.stderr)
            return 1
        with custom_path.open() as f:
            custom = json.load(f)
        custom_source = str(custom_path)
    elif args.draft_prompts:
        print("[plan] drafting per-slide prompts via Gemini Vision...", file=sys.stderr)
        try:
            custom = {str(k): v for k, v in draft_prompts_via_gemini(project, args.style, args.num_slides).items()}
            custom_source = "Gemini Vision draft (--draft-prompts)"
        except Exception as e:
            print(f"  WARNING: --draft-prompts failed ({e!r}); falling back to --style template", file=sys.stderr)
    elif prompts_path.is_file() and not args.overwrite_prompts:
        with prompts_path.open() as f:
            custom = json.load(f)
        custom_source = f"{prompts_path} (existing; pass --overwrite-prompts to regenerate)"
    if custom_source:
        print(f"[plan] using custom prompts from {custom_source}", file=sys.stderr)
    prompts = build_style_prompts(args.style, args.num_slides, custom)

    # High-risk vocab linter — warn on tokens that have historically tripped
    # Google's content filter when paired with dramatic slide imagery.
    if not args.skip_lint:
        findings = lint_animation_prompts(prompts)
        if findings:
            print("\n  ⚠️  Vocab linter — high-risk tokens detected (may trip content filter):", file=sys.stderr)
            for scene_num, hits in findings:
                print(f"    scene {scene_num}: {', '.join(hits)}", file=sys.stderr)
            print("  Auto-recovery will retry with safe-fallback prompt if Veo rejects.\n", file=sys.stderr)

    print(f"[plan] slug         = {slug}", file=sys.stderr)
    print(f"[plan] num_slides   = {args.num_slides}", file=sys.stderr)
    style_note = ""
    if custom:
        style_note = " (overridden by --prompts-json)" if args.prompts_json else " (overridden by existing prompts file)"
    print(f"[plan] style        = {args.style}{style_note}", file=sys.stderr)
    print(f"[plan] segments     = {segments_dir}", file=sys.stderr)
    print(f"[plan] cost est.    = ~{args.num_slides * 10} Veo credits (quality={args.quality})", file=sys.stderr)

    if not args.yes:
        resp = input("\nProceed? [y/N] ").strip().lower()
        if resp != "y":
            print("Aborted.", file=sys.stderr)
            return 0

    # Step 1: stage slide images as F2V frames
    print("\n=== Step 1: Staging slide images as F2V frames ===", file=sys.stderr)
    staged = stage_slide_images(slides_dir, images_dir, args.num_slides)
    print(f"  Staged {staged} new images (existing skipped)", file=sys.stderr)

    # Step 2: write prompts JSON for reference / debugging — only when no
    # custom prompts were loaded (i.e. user is genuinely seeding a fresh
    # project) or --overwrite-prompts was passed.
    if not custom or args.overwrite_prompts:
        write_prompts_json(prompts, prompts_path)
        print(f"  Wrote {prompts_path}", file=sys.stderr)
    else:
        print(f"  Preserved existing {prompts_path}", file=sys.stderr)

    # Step 3: drive Veo generation (unless --segments-only)
    veo_failed_partial = False
    if not args.segments_only:
        print("\n=== Step 2: Generating F2V loops via Veo ===", file=sys.stderr)
        rc = generate_f2v_videos(slug, prompts, project, quality=args.quality)
        if rc != 0:
            # Partial failure (Match 13 reference: slide 11 tripped content filter
            # even with safe-fallback). Previously we aborted before baking, which
            # meant the user lost ~14 successful scenes if any 1 failed. Now we
            # warn, mark the run as partial, and continue to bake what we have.
            # stitch_bunty.py --animated falls back to static-image encoding for
            # any slide whose animated segment is missing, so the partial coverage
            # still produces a watchable video.
            veo_failed_partial = True
            missing = [
                n for n in range(1, args.num_slides + 1)
                if not find_f2v_video(videos_dir, n)
            ]
            print(
                f"\n  ⚠️  Veo partial failure (exit {rc}). Missing scenes: {missing}.\n"
                f"  Continuing to bake the {args.num_slides - len(missing)} successful slide(s); "
                f"missing slides will be skipped in segments_animated/ and will fall back to "
                f"static-image encoding when stitch_bunty.py --animated runs.\n"
                f"  To recover the missing scenes later, re-run this script "
                f"(it skips slides whose F2V video already exists).",
                file=sys.stderr,
            )

    # Step 4: encode segments (loop + bake)
    print("\n=== Step 3: Encoding animated slide segments ===", file=sys.stderr)
    segments_dir.mkdir(parents=True, exist_ok=True)
    encoded = 0
    for n in range(1, args.num_slides + 1):
        f2v = find_f2v_video(videos_dir, n)
        tts = tts_dir / f"scene_{n}_tts.mp3"
        seg = segments_dir / f"seg_slide_{n:02d}.mp4"
        if not f2v:
            print(f"  WARNING: no F2V for scene {n} — skipping", file=sys.stderr)
            continue
        if not tts.is_file():
            print(f"  WARNING: no TTS for scene {n} — skipping", file=sys.stderr)
            continue
        encode_animated_slide_segment(f2v, tts, seg, n, args.num_slides, args.fade)
        encoded += 1

    print(f"\nDone. Encoded {encoded}/{args.num_slides} animated slide segments.", file=sys.stderr)
    print(f"  Segments: {segments_dir}", file=sys.stderr)
    print(f"  Next: python stitch_bunty.py --project {project} --num-slides {args.num_slides} \\", file=sys.stderr)
    print(f"        --intro-scenes 17,19 --outro-scenes 20,21 --animated", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
