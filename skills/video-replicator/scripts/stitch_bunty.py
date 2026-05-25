#!/usr/bin/env python3
"""Centralized Bunty lip-sync stitch script.

Combines lip-synced intro/outro videos with TTS-narrated slide segments
into a final Match Day Analysis video.

Supports:
- Simple (1+1): single intro + single outro scene
- Chained (2+2): two chained intro + two chained outro scenes
- Fade-through-black transitions at section boundaries
- Voice-changed file preference (_vc.mp4 over plain .mp4)

Usage:
  python stitch_bunty.py --project projects/wicc-vs-werrington --num-slides 16 \\
    --intro-scenes 17,19 --outro-scenes 20,21 --fade 0.75

  python stitch_bunty.py --project projects/stony-vs-overstone-u19 --num-slides 15 \\
    --intro-scenes 19 --outro-scenes 20 --fade 0
"""
import argparse
import os
import shlex
import subprocess
import sys

# Add scripts dir to path so ffmpeg_wrapper can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REENCODE_OPTS = (
    '-vf "scale=1280:720:force_original_aspect_ratio=decrease,'
    'pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p" '
    '-r 24 -c:v libx264 -preset fast -crf 20 '
    '-c:a aac -ar 44100 -ac 2'
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Stitch Bunty lip-sync video: intro + slides + outro",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  # Chained 2+2 with fades (most common)
  python stitch_bunty.py --project projects/wicc-vs-werrington \\
    --num-slides 16 --intro-scenes 17,19 --outro-scenes 20,21

  # Simple 1+1, no fades
  python stitch_bunty.py --project projects/stony-vs-overstone-u19 \\
    --num-slides 15 --intro-scenes 19 --outro-scenes 20 --fade 0

  # Custom output path
  python stitch_bunty.py --project projects/my-match \\
    --num-slides 12 --intro-scenes 17,19 --outro-scenes 20,21 \\
    --output projects/my-match/final/custom_name.mp4
""",
    )
    parser.add_argument(
        "--project", required=True,
        help="Project directory (e.g., projects/wicc-vs-werrington)"
    )
    parser.add_argument(
        "--num-slides", type=int, required=True,
        help="Number of slides (1 to N)"
    )
    parser.add_argument(
        "--intro-scenes", required=True,
        help="Comma-separated intro scene numbers (e.g., '19' or '17,19')"
    )
    parser.add_argument(
        "--outro-scenes", required=True,
        help="Comma-separated outro scene numbers (e.g., '20' or '20,21')"
    )
    parser.add_argument(
        "--fade", type=float, default=0.75,
        help="Fade-through-black duration in seconds (0 = no fades, default: 0.75)"
    )
    parser.add_argument(
        "--output",
        help="Output file path (default: {project}/final/{slug}_BUNTY.mp4)"
    )
    parser.add_argument(
        "--animated", action="store_true",
        help="Use animated slide segments from final/segments_animated/ "
             "(produced by bunty_animate_slides.py). Falls back to static slide "
             "encoding for any scene whose animated segment is missing."
    )
    parser.add_argument(
        "--copy-to-documents", action="store_true",
        help="After stitching, copy final video to ~/Documents/WICC Bunty Videos/ "
             "with auto-generated filename: 'Match Day Analysis - {teams} - {date}"
             "{ - ANIMATED}.mp4'. Teams + date are parsed from "
             "reference/match_facts.txt. Skipped silently if match_facts.txt missing."
    )
    parser.add_argument(
        "--no-open", action="store_true",
        help="Don't auto-open the final video after stitching (paired with --copy-to-documents)"
    )
    parser.add_argument(
        "--no-preview", action="store_true",
        help="Skip auto-generating projects/<slug>/preview.html after stitching. "
             "By default, every stitch produces an interactive review page with "
             "Approve/Regenerate toggles + Copy Review Decisions HUD."
    )
    return parser.parse_args()


# WICC team-name parsing helpers for --copy-to-documents
import re as _re
from pathlib import Path as _Path

_WICC_TEAM_PATTERNS = [
    (_re.compile(r"Wellingborough Indians CC.*?-\s*(\d+(?:st|nd|rd|th) XI)", _re.IGNORECASE), lambda m: f"WICC {m.group(1)}"),
    (_re.compile(r"Wellingborough Indians CC", _re.IGNORECASE), lambda m: "WICC"),
    (_re.compile(r"WICC U(\d+)", _re.IGNORECASE), lambda m: f"WICC U{m.group(1)}"),
]
_DATE_PATTERN = _re.compile(r"Date\s+(.*?(?:\d{4}|2026|2025))", _re.IGNORECASE)


def _parse_match_facts(facts_path: _Path) -> tuple[str | None, str | None]:
    """Return (matchup_label, short_date) parsed from match_facts.txt or (None, None)
    if anything's missing. matchup_label looks like 'WICC 2nd XI vs Wellingborough OGs'.
    short_date looks like '9 May 2026'."""
    if not facts_path.is_file():
        return (None, None)
    text = facts_path.read_text(encoding="utf-8", errors="replace")[:2000]

    # Match the first line "Team A Vs Team B" — that's the canonical matchup line
    first_line = text.split("\n", 1)[0].strip()
    teams = None

    def _strip_team(side: str) -> tuple[str, str | None]:
        """Strip ' CC - <XI suffix>' from a team side. Returns (short_team_name, xi_suffix)."""
        m = _re.search(r"-\s*(\d+(?:st|nd|rd|th) XI|U\d+|Under \d+)", side, _re.IGNORECASE)
        xi = m.group(1) if m else None
        clean = _re.sub(r"\s*CC\b.*$", "", side).strip()
        if xi and "U" in xi.upper():  # normalise "Under 13" → "U13"
            xi = xi.replace("Under ", "U").replace("under ", "U")
        return clean, xi

    if " Vs " in first_line or " vs " in first_line:
        parts = _re.split(r"\s+[Vv]s\s+", first_line, maxsplit=1)
        if len(parts) == 2:
            # Prefer WICC-leaning layout when one of the teams is WICC (so the
            # filename reads "WICC <suffix> vs Opponent"). For non-WICC matches,
            # fall back to literal "Team A vs Team B" order from the scorecard.
            wicc_side = next((p for p in parts if "indians" in p.lower()), None)
            opp_side = next((p for p in parts if "indians" not in p.lower()), None)
            if wicc_side and opp_side:
                _, wicc_xi = _strip_team(wicc_side)
                wicc_label = f"WICC {wicc_xi}" if wicc_xi else "WICC"
                opp_clean, _ = _strip_team(opp_side)
                teams = f"{wicc_label} vs {opp_clean}"
            else:
                # Non-WICC match — keep the scorecard's literal team order.
                a_clean, a_xi = _strip_team(parts[0])
                b_clean, b_xi = _strip_team(parts[1])
                a_label = f"{a_clean} {a_xi}" if a_xi else a_clean
                b_label = f"{b_clean} {b_xi}" if b_xi else b_clean
                teams = f"{a_label} vs {b_label}"

    # Parse date — look for "Date   Saturday 9th May 2026" → "9 May 2026"
    date_str = None
    dm = _re.search(r"Date\s+\w+\s+(\d+)(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})", text)
    if dm:
        date_str = f"{dm.group(1)} {dm.group(2)} {dm.group(3)}"

    return (teams, date_str)


def _copy_to_documents(final_video: str, project: str, animated: bool, open_after: bool) -> None:
    """Auto-copy final video to ~/Documents/WICC Bunty Videos/ with a parsed filename."""
    import shutil
    facts_path = _Path(project) / "reference" / "match_facts.txt"
    teams, date_str = _parse_match_facts(facts_path)
    if not (teams and date_str):
        print(f"  [copy-to-documents] could not parse teams+date from {facts_path} — skipping auto-copy")
        return
    suffix = " - ANIMATED" if animated else ""
    dest_dir = _Path.home() / "Documents" / "WICC Bunty Videos"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"Match Day Analysis - {teams} - {date_str}{suffix}.mp4"
    shutil.copy2(final_video, dest)
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"\n  Copied → {dest} ({size_mb:.1f} MB)")
    if open_after:
        import subprocess as _sp
        _sp.run(["open", str(dest)], check=False)
        print(f"  Opened in default player")


def run(cmd, desc=""):
    """Run a shell command, exit on failure."""
    print(f"  {desc}..." if desc else f"  Running: {cmd[:80]}...")
    args = shlex.split(cmd)
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  ERROR: {r.stderr[:500]}")
        sys.exit(1)
    return r


def get_duration(filepath):
    """Get media file duration in seconds via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        filepath,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return float(result.stdout.strip())


def find_video(videos_dir, scene_num):
    """Find video for a scene, preferring voice-changed (_vc) files.

    Search order (latest run prefix first):
    1. *_scene_{N}_vc.mp4 (voice-changed)
    2. *_scene_{N}.mp4 (plain)
    """
    vc_match = None
    plain_match = None
    for f in sorted(os.listdir(videos_dir), reverse=True):
        if f"scene_{scene_num}" not in f or not f.endswith(".mp4"):
            continue
        path = os.path.join(videos_dir, f)
        if f"scene_{scene_num}_vc.mp4" in f:
            vc_match = vc_match or path
        elif f"scene_{scene_num}.mp4" in f or f.endswith(f"scene_{scene_num}.mp4"):
            plain_match = plain_match or path
    return vc_match or plain_match


def _concat_via_demuxer(segs, output, segments_dir):
    """Concatenate via ffmpeg -f concat -c copy. Requires all segments share encoding params (codec, fps, sample rate). Lighter than concat filter — single ffmpeg invocation regardless of segment count, so it survives the Claude Code sandbox's per-session FFmpeg limit."""
    os.makedirs(segments_dir, exist_ok=True)
    concat_list = os.path.join(segments_dir, "concat.txt")
    with open(concat_list, "w") as f:
        for seg in segs:
            f.write(f"file '{os.path.abspath(seg)}'\n")
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", output]
    return subprocess.run(cmd, capture_output=True, text=True).returncode == 0


def encode_lipsync_segment(video_path, output_path, scene_num, fade_duration,
                           apply_fade_in=False, apply_fade_out=False):
    """Re-encode a lip-sync video segment with optional fades.

    Duration is rounded UP to the nearest 24fps frame boundary so video and
    audio end at the same exact timestamp. Audio is padded with silence via
    apad=whole_dur to that aligned duration, then -t caps both streams.
    Without this alignment, AAC encoder pads audio to native length while
    H.264 rounds video up to next frame — the resulting +11ms mismatch
    compounds across concat boundaries into audible drift (seen on Match 6,
    2026-05-12).
    """
    import math
    src_dur = get_duration(video_path)
    dur = math.ceil(src_dur * 24) / 24

    # Build video filter chain
    vf_parts = [
        "scale=1280:720:force_original_aspect_ratio=decrease",
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "format=yuv420p",
    ]
    # Build audio filter chain. apad first so faders work on the padded length.
    af_parts = [f"apad=whole_dur={dur:.3f}"]

    if apply_fade_in:
        vf_parts.append(f"fade=t=in:st=0:d={fade_duration}")
        af_parts.append(f"afade=t=in:st=0:d={fade_duration}")

    if apply_fade_out:
        fade_start = dur - fade_duration
        vf_parts.append(f"fade=t=out:st={fade_start:.3f}:d={fade_duration}")
        af_parts.append(f"afade=t=out:st={fade_start:.3f}:d={fade_duration}")

    vf_str = ",".join(vf_parts)
    af_str = f'-af "{",".join(af_parts)}" '

    fade_desc = ""
    if apply_fade_in:
        fade_desc += " + fade-in"
    if apply_fade_out:
        fade_desc += " + fade-out"

    run(
        f'ffmpeg -y -i "{video_path}" '
        f'-vf "{vf_str}" '
        f'{af_str}'
        f'-r 24 -c:v libx264 -preset fast -crf 20 '
        f'-c:a aac -ar 44100 -ac 2 '
        f'-t {dur:.3f} '
        f'"{output_path}"',
        f"Encoding scene {scene_num} (24fps{fade_desc})"
    )


def encode_slide_segment(slide_img, tts_file, output_path, slide_num,
                         num_slides, fade_duration):
    """Create a slide segment from static image + TTS audio.

    Duration is rounded UP to the nearest 24fps frame boundary for AV parity
    (see encode_lipsync_segment for the rationale)."""
    import math
    tts_dur = get_duration(tts_file)
    duration = math.ceil(tts_dur * 24) / 24

    # Build fade filters for boundary slides
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

    fade_desc = ""
    if slide_num == 1 and fade_duration > 0:
        fade_desc += " + fade-in"
    if slide_num == num_slides and fade_duration > 0:
        fade_desc += " + fade-out"

    # apad=whole_dur ensures audio is padded with silence to exactly `duration`
    # seconds — AV stream lengths match precisely, no per-segment drift across
    # concat boundaries. See encode_lipsync_segment for the same fix.
    run(
        f'ffmpeg -y -loop 1 -i "{slide_img}" -i "{tts_file}" '
        f'-filter_complex "'
        f'[0:v]scale=1280:720:force_original_aspect_ratio=decrease,'
        f'pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p{vfade_str}[v];'
        f'[1:a]aresample=44100,aformat=channel_layouts=stereo,'
        f'apad=whole_dur={duration:.3f}{afade_str}[a]" '
        f'-map [v] -map [a] '
        f'-r 24 -c:v libx264 -preset fast -crf 20 '
        f'-c:a aac -ar 44100 -ac 2 '
        f'-t {duration:.3f} '
        f'"{output_path}"',
        f"Slide {slide_num} ({duration:.1f}s{fade_desc})"
    )


def main():
    args = parse_args()

    # Parse scene numbers
    intro_scenes = [int(x.strip()) for x in args.intro_scenes.split(",")]
    outro_scenes = [int(x.strip()) for x in args.outro_scenes.split(",")]

    # Derive paths from project dir
    project = os.path.abspath(args.project)
    videos_dir = os.path.join(project, "videos")
    slides_dir = os.path.join(project, "slides")
    tts_dir = os.path.join(project, "audio", "tts")
    segments_dir = os.path.join(project, "final", "segments")
    animated_segments_dir = os.path.join(project, "final", "segments_animated")
    slug = os.path.basename(os.path.normpath(project))
    default_output_name = f"{slug}_BUNTY_animated.mp4" if args.animated else f"{slug}_BUNTY.mp4"
    output = args.output or os.path.join(project, "final", default_output_name)

    fade = args.fade
    num_slides = args.num_slides

    # Validate directories exist
    for d, name in [(videos_dir, "videos"), (slides_dir, "slides"), (tts_dir, "audio/tts")]:
        if not os.path.isdir(d):
            print(f"ERROR: {name} directory not found: {d}")
            sys.exit(1)

    os.makedirs(segments_dir, exist_ok=True)
    os.makedirs(os.path.dirname(output), exist_ok=True)

    # Print configuration
    intro_pattern = "chained" if len(intro_scenes) > 1 else "simple"
    outro_pattern = "chained" if len(outro_scenes) > 1 else "simple"
    print(f"Bunty Stitch — {os.path.basename(project)}")
    print(f"  Intro: scenes {intro_scenes} ({intro_pattern})")
    print(f"  Slides: 1-{num_slides}")
    print(f"  Outro: scenes {outro_scenes} ({outro_pattern})")
    print(f"  Fades: {fade}s" if fade > 0 else "  Fades: disabled")
    print()

    # === Step 1: Intro segments ===
    print("=== Step 1: Preparing intro segments (lip-synced, Veo audio) ===")
    intro_segs = []
    for idx, scene_num in enumerate(intro_scenes):
        video = find_video(videos_dir, scene_num)
        seg_file = os.path.join(segments_dir, f"seg_intro_{idx}.mp4")
        if not video:
            print(f"  ERROR: No video found for scene {scene_num} in {videos_dir}")
            sys.exit(1)
        vc_tag = " (voice-changed)" if "_vc.mp4" in video else ""
        print(f"  Scene {scene_num}: {os.path.basename(video)}{vc_tag}")

        is_last = idx == len(intro_scenes) - 1
        encode_lipsync_segment(
            video, seg_file, scene_num, fade,
            apply_fade_out=(is_last and fade > 0),
        )
        intro_segs.append(seg_file)

    # === Step 2: Slide segments ===
    slide_mode = "animated" if args.animated else "static image"
    print(f"\n=== Step 2: Creating {num_slides} slide segments ({slide_mode} + Bunty TTS) ===")
    slide_segs = []
    animated_hits = 0
    static_fallbacks = 0
    for i in range(1, num_slides + 1):
        slide_img = os.path.join(slides_dir, f"slide_{i:03d}.jpg")
        tts_file = os.path.join(tts_dir, f"scene_{i}_tts.mp3")
        seg_file = os.path.join(segments_dir, f"seg_slide_{i:02d}.mp4")
        animated_seg = os.path.join(animated_segments_dir, f"seg_slide_{i:02d}.mp4")

        if args.animated and os.path.exists(animated_seg):
            # Reuse the pre-encoded animated segment as-is (bunty_animate_slides
            # already loop-baked TTS and applied boundary fades).
            print(f"  Slide {i}: reusing animated segment ({os.path.basename(animated_seg)})")
            slide_segs.append(animated_seg)
            animated_hits += 1
            continue

        if not os.path.exists(slide_img):
            print(f"  WARNING: Missing slide {slide_img}")
            continue
        if not os.path.exists(tts_file):
            print(f"  WARNING: Missing TTS {tts_file}")
            continue

        if args.animated:
            print(f"  Slide {i}: animated segment missing — falling back to static image")
            static_fallbacks += 1
        encode_slide_segment(slide_img, tts_file, seg_file, i, num_slides, fade)
        slide_segs.append(seg_file)

    if args.animated:
        print(f"  Animated slides: {animated_hits}/{num_slides} (static fallbacks: {static_fallbacks})")

    # === Step 3: Outro segments ===
    print("\n=== Step 3: Preparing outro segments (lip-synced, Veo audio) ===")
    outro_segs = []
    for idx, scene_num in enumerate(outro_scenes):
        video = find_video(videos_dir, scene_num)
        seg_file = os.path.join(segments_dir, f"seg_outro_{idx}.mp4")
        if not video:
            print(f"  ERROR: No video found for scene {scene_num} in {videos_dir}")
            sys.exit(1)
        vc_tag = " (voice-changed)" if "_vc.mp4" in video else ""
        print(f"  Scene {scene_num}: {os.path.basename(video)}{vc_tag}")

        is_first = idx == 0
        encode_lipsync_segment(
            video, seg_file, scene_num, fade,
            apply_fade_in=(is_first and fade > 0),
        )
        outro_segs.append(seg_file)

    # === Step 4: Concatenate ===
    print("\n=== Step 4: Concatenating all segments ===")
    all_segs = [s for s in intro_segs + slide_segs + outro_segs if os.path.exists(s)]

    print(
        f"  Total segments: {len(all_segs)} "
        f"({len(intro_segs)} intro + {len(slide_segs)} slides + {len(outro_segs)} outro)"
    )

    # Demuxer-first concat: -c copy preserves exact packet timing, no re-encoding.
    # Concat filter (re-encodes) accumulates per-segment AV duration mismatches
    # across boundaries (intro audio is +11ms longer than video, slide audio is
    # -19ms shorter — these compound across 17+ segments into audible drift).
    # Demuxer concat avoids the issue entirely because each segment is already
    # encoded with matching params (24fps h264 + 44100Hz aac stereo).
    #
    # Filter is a fallback for the rare case where a segment has incompatible
    # codec params and demuxer rejects it.
    print(f"  Using demuxer concat (segments={len(all_segs)}) — preserves exact AV timing")
    ok = _concat_via_demuxer(all_segs, output, segments_dir)
    if not ok:
        print("  WARNING: demuxer concat failed (likely incompatible codec params between segments). Falling back to concat filter (will re-encode, may accumulate AV drift).")
        from ffmpeg_wrapper import concat_via_filter as _concat_filter
        ok = _concat_filter(all_segs, output)
        if not ok:
            print("  ERROR: both demuxer and concat filter failed")
            sys.exit(1)
        print(f"  Concat filter fallback succeeded — concatenated {len(all_segs)} segments via re-encode")

    # === Summary ===
    total_dur = get_duration(output)
    intro_dur = sum(get_duration(s) for s in intro_segs)
    outro_dur = sum(get_duration(s) for s in outro_segs)
    slide_dur = total_dur - intro_dur - outro_dur
    file_size = os.path.getsize(output) / (1024 * 1024)

    print(f"\n{'=' * 60}")
    print(f"DONE! {output}")
    print(f"{'=' * 60}")
    print(f"  Duration:  {total_dur:.1f}s ({total_dur / 60:.1f} min)")
    print(f"  File size: {file_size:.1f} MB")
    print(f"  Intro:     {len(intro_segs)} clips ({intro_dur:.1f}s, Veo audio)")
    print(f"  Slides:    {len(slide_segs)} slides ({slide_dur:.1f}s, Bunty TTS)")
    print(f"  Outro:     {len(outro_segs)} clips ({outro_dur:.1f}s, Veo audio)")
    if fade > 0:
        print(f"  Fades:     {fade}s fade-through-black at section boundaries")

    # Optional: auto-copy to Documents with team-name parsed filename
    if args.copy_to_documents:
        _copy_to_documents(output, project, args.animated, open_after=not args.no_open)

    # Auto-generate the interactive review preview (Approve/Regen + Copy Decisions).
    # Defensive: a preview-render failure must NOT fail the stitch — the user already
    # has their MP4. Best-effort, prints a hint on failure.
    if not args.no_preview:
        preview_script = os.path.join(os.path.dirname(__file__), "bunty_preview.py")
        try:
            subprocess.run(
                [sys.executable, preview_script, "--project", project, "--mode", "edit"],
                check=True, capture_output=True, text=True,
            )
            print(f"  Preview:   {os.path.join(project, 'preview.html')} (open in browser to review + copy decisions)")
        except subprocess.CalledProcessError as e:
            print(f"  Preview generation failed (skip with --no-preview):\n    {e.stderr.strip()[:400]}")
        except Exception as e:
            print(f"  Preview generation skipped: {e!r}")


if __name__ == "__main__":
    main()
