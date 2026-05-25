#!/usr/bin/env python3
"""Brand a finished Nex episode with title card + logo intro.

Takes a finished episode video and an episode-specific title card image,
produces a branded output: title card (4s) -> logo intro (6s) -> episode.

Usage:
  python brand_episode.py \
    --episode "projects/{slug}/final/episode_nex.mp4" \
    --title-card "projects/{slug}/assets/title_card_final.jpg" \
    --output "projects/{slug}/final/episode_branded.mp4" \
    --yes

Pipeline:
  1. Probe episode to detect sample rate, fps, resolution
  2. Title card — convert image to 4s video with anullsrc at episode's sample rate
  3. Re-encode logo intro audio to match episode's sample rate (video stream copy)
  4. Concat — FFmpeg concat demuxer for all 3 segments
"""
import argparse
import os
import subprocess
import sys

# Resolve paths relative to THIS script's location
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)  # skills/nex-presenter/
ASSETS_DIR = os.path.join(SKILL_DIR, "assets")

# Add video-replicator scripts to path for shared imports
REPLICATOR_SCRIPTS = os.path.join(
    os.path.dirname(SKILL_DIR),  # skills/
    "video-replicator", "scripts",
)
if os.path.isdir(REPLICATOR_SCRIPTS):
    sys.path.insert(0, REPLICATOR_SCRIPTS)

from ffmpeg_wrapper import FFmpegWrapper

_ff = FFmpegWrapper()

# Default branding assets
LOGO_INTRO_PATH = os.path.join(ASSETS_DIR, "nex_brief_intro.mp4")
DEFAULT_TITLE_DURATION = 4


def probe_video(path: str) -> dict:
    """Probe video for sample rate, fps, resolution, and duration."""
    info = {}

    # Sample rate
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=sample_rate",
            "-of", "csv=p=0", path,
        ], text=True).strip()
        info["sample_rate"] = int(out) if out else 44100
    except Exception:
        info["sample_rate"] = 44100

    # FPS
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "csv=p=0", path,
        ], text=True).strip()
        if "/" in out:
            num, den = out.split("/")
            info["fps"] = round(int(num) / int(den), 2)
        else:
            info["fps"] = float(out)
    except Exception:
        info["fps"] = 24.0

    # Resolution
    try:
        out = subprocess.check_output([
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0", path,
        ], text=True).strip()
        w, h = out.split(",")
        info["width"] = int(w)
        info["height"] = int(h)
    except Exception:
        info["width"] = 1280
        info["height"] = 720

    # Duration
    info["duration"] = _ff.get_duration(path)

    return info


def make_title_card_video(
    image_path: str,
    output_path: str,
    duration: int,
    sample_rate: int,
    fps: float,
    width: int,
    height: int,
):
    """Convert a title card image to a video with silent audio."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    _ff.run([
        "-loop", "1",
        "-i", image_path,
        "-f", "lavfi", "-i", f"anullsrc=r={sample_rate}:cl=stereo",
        "-t", str(duration),
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
               f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-r", str(int(fps)),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        output_path,
    ])


def reencode_logo_audio(
    logo_path: str,
    output_path: str,
    sample_rate: int,
    fps: float,
    width: int,
    height: int,
):
    """Re-encode logo intro to match episode's specs.

    Re-encodes both video (to match fps/resolution) and audio (to match
    sample rate) so concat demuxer can stream-copy the final concat.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    _ff.run([
        "-i", logo_path,
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
               f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-r", str(int(fps)),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-ar", str(sample_rate),
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        output_path,
    ])


def reencode_episode(
    episode_path: str,
    output_path: str,
    fps: float,
    width: int,
    height: int,
    sample_rate: int,
):
    """Re-encode episode to match branding specs (only if needed)."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    _ff.run([
        "-i", episode_path,
        "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
               f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-r", str(int(fps)),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-ar", str(sample_rate),
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        output_path,
    ])


def concat_segments(segments: list[str], output_path: str):
    """Concat segments using FFmpeg concat demuxer (fast stream copy)."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Write concat list
    concat_list = output_path + ".concat.txt"
    with open(concat_list, "w") as f:
        for seg in segments:
            f.write(f"file '{os.path.abspath(seg)}'\n")

    _ff.run([
        "-f", "concat", "-safe", "0",
        "-i", concat_list,
        "-c", "copy",
        "-movflags", "+faststart",
        output_path,
    ])

    # Clean up
    if os.path.exists(concat_list):
        os.remove(concat_list)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Brand a Nex episode: title card (4s) + logo intro (6s) + episode",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  # Basic branding
  python brand_episode.py \\
    --episode "projects/my-ep/final/episode_nex.mp4" \\
    --title-card "projects/my-ep/assets/title_card_final.jpg" \\
    --yes

  # Custom output path and title duration
  python brand_episode.py \\
    --episode "projects/my-ep/final/episode_nex.mp4" \\
    --title-card "projects/my-ep/assets/title_card_final.jpg" \\
    --output "projects/my-ep/final/branded.mp4" \\
    --title-duration 5 \\
    --yes

  # Dry-run to preview plan
  python brand_episode.py \\
    --episode "projects/my-ep/final/episode_nex.mp4" \\
    --title-card "projects/my-ep/assets/title_card_final.jpg" \\
    --dry-run
""",
    )
    parser.add_argument("--episode", required=True, help="Path to finished episode video")
    parser.add_argument("--title-card", required=True, help="Path to episode title card image (jpg/png)")
    parser.add_argument("--output", help="Output path (default: {episode}_branded.mp4)")
    parser.add_argument("--title-duration", type=int, default=DEFAULT_TITLE_DURATION,
                        help=f"Title card hold in seconds (default: {DEFAULT_TITLE_DURATION})")
    parser.add_argument("--logo-intro", default=LOGO_INTRO_PATH,
                        help=f"Logo intro video (default: skill assets)")
    parser.add_argument("--dry-run", action="store_true", help="Preview plan without executing")
    parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    return parser.parse_args()


def main():
    args = parse_args()

    # Validate inputs
    if not os.path.exists(args.episode):
        print(f"ERROR: Episode not found: {args.episode}")
        sys.exit(1)
    if not os.path.exists(args.title_card):
        print(f"ERROR: Title card not found: {args.title_card}")
        sys.exit(1)
    if not os.path.exists(args.logo_intro):
        print(f"ERROR: Logo intro not found: {args.logo_intro}")
        sys.exit(1)

    # Derive output path
    if args.output:
        output = args.output
    else:
        base, ext = os.path.splitext(args.episode)
        output = f"{base}_branded{ext}"

    # Step 1: Probe episode
    print("Step 1: Probing episode...")
    ep_info = probe_video(args.episode)
    logo_info = probe_video(args.logo_intro)

    print(f"  Episode:    {ep_info['width']}x{ep_info['height']}, "
          f"{ep_info['fps']}fps, {ep_info['sample_rate']}Hz, "
          f"{ep_info['duration']:.1f}s")
    print(f"  Logo intro: {logo_info['width']}x{logo_info['height']}, "
          f"{logo_info['fps']}fps, {logo_info['sample_rate']}Hz, "
          f"{logo_info['duration']:.1f}s")
    print(f"  Title card: {args.title_card} ({args.title_duration}s hold)")
    print()

    total_dur = args.title_duration + logo_info["duration"] + ep_info["duration"]
    print(f"Plan: title ({args.title_duration}s) + logo ({logo_info['duration']:.1f}s) "
          f"+ episode ({ep_info['duration']:.1f}s) = {total_dur:.1f}s")
    print(f"Output: {output}")
    print()

    if args.dry_run:
        print("DRY RUN — no files written.")
        return

    if not args.yes:
        response = input("Proceed? [Y/n] ").strip().lower()
        if response and response != "y":
            print("Aborted.")
            sys.exit(0)

    # Work in a temp directory next to the output
    work_dir = os.path.join(os.path.dirname(output) or ".", ".brand_work")
    os.makedirs(work_dir, exist_ok=True)

    # Use episode specs as the standard
    sr = ep_info["sample_rate"]
    fps = ep_info["fps"]
    w = ep_info["width"]
    h = ep_info["height"]

    # Step 2: Create title card video
    print("Step 2: Creating title card video...")
    tc_video = os.path.join(work_dir, "title_card.mp4")
    make_title_card_video(args.title_card, tc_video, args.title_duration, sr, fps, w, h)
    print(f"  Created {args.title_duration}s title card at {sr}Hz")

    # Step 3: Re-encode logo intro to match episode specs
    print("Step 3: Re-encoding logo intro...")
    logo_reencoded = os.path.join(work_dir, "logo_intro.mp4")
    reencode_logo_audio(args.logo_intro, logo_reencoded, sr, fps, w, h)
    print(f"  Re-encoded logo intro to {sr}Hz, {int(fps)}fps, {w}x{h}")

    # Step 4: Re-encode episode to match (in case of any mismatch)
    print("Step 4: Preparing episode...")
    ep_reencoded = os.path.join(work_dir, "episode.mp4")
    reencode_episode(args.episode, ep_reencoded, fps, w, h, sr)
    print(f"  Episode prepared at {sr}Hz, {int(fps)}fps, {w}x{h}")

    # Step 5: Concat all three segments
    print("Step 5: Concatenating segments...")
    concat_segments([tc_video, logo_reencoded, ep_reencoded], output)

    # Verify output
    out_dur = _ff.get_duration(output)
    out_size = os.path.getsize(output) / (1024 * 1024)

    print()
    print("=" * 50)
    print(f"DONE: {output}")
    print("=" * 50)
    print(f"  Duration: {out_dur:.1f}s ({out_dur / 60:.1f} min)")
    print(f"  Size:     {out_size:.1f} MB")
    print(f"  Segments: title ({args.title_duration}s) + "
          f"logo ({logo_info['duration']:.1f}s) + "
          f"episode ({ep_info['duration']:.1f}s)")

    # Clean up work directory
    import shutil
    shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
