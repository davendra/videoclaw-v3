#!/usr/bin/env python3
"""
Narration Conductor — composition-aware narration timing engine.

Replaces per-scene t=0 baking with a single master narration track
that has proper delays, gaps, fades, and speed adjustment.

Usage:
    # Standalone
    python narration_conductor.py \\
        --videos-dir "projects/{slug}/videos" \\
        --tts-dir "projects/{slug}/audio/tts" \\
        --output "projects/{slug}/audio/master_narration.mp3"

    # Via generate_tts.py
    python generate_tts.py --conductor --videos-dir ... --tts-dir ...

    # Via stitch_video.py
    python stitch_video.py --auto-narration --tts-dir ...
"""

from __future__ import annotations

import argparse
import glob
import json
import logging
import os
import re
import subprocess

from config import (
    CONDUCTOR_DELAY_S,
    CONDUCTOR_FADE_IN_S,
    CONDUCTOR_FADE_OUT_S,
    CONDUCTOR_GAP_S,
    CONDUCTOR_MAX_SPEED,
    CONDUCTOR_MIN_WINDOW_S,
)
from ffmpeg_wrapper import FFmpegWrapper

_ff = FFmpegWrapper()


def get_video_duration(path: str) -> float:
    """Get video duration in seconds."""
    return _ff.get_duration(path) or 0.0


def get_audio_duration(path: str) -> float:
    """Get audio duration in seconds."""
    return _ff.get_duration(path) or 0.0

logger = logging.getLogger(__name__)


def calculate_timeline(
    video_durations: list[float],
    tts_durations: list[float],
    *,
    delay: float = CONDUCTOR_DELAY_S,
    gap: float = CONDUCTOR_GAP_S,
    max_speed: float = CONDUCTOR_MAX_SPEED,
    min_window: float = CONDUCTOR_MIN_WINDOW_S,
) -> list[dict]:
    """
    Calculate narration placement for each scene on the stitched timeline.

    Args:
        video_durations: Duration of each video in seconds
        tts_durations: Duration of each TTS file in seconds
        delay: Silence before narration starts in each scene
        gap: Minimum silence between scenes
        max_speed: Maximum atempo speed-up factor
        min_window: Skip narration if window < this many seconds

    Returns:
        List of dicts with timing info per scene
    """
    if len(video_durations) != len(tts_durations):
        raise ValueError(
            f"Video/TTS count mismatch: {len(video_durations)} videos "
            f"vs {len(tts_durations)} TTS files"
        )

    # Build cumulative start times
    cumulative = []
    running = 0.0
    for dur in video_durations:
        cumulative.append(running)
        running += dur
    total_duration = running

    results = []
    for i, (vid_dur, tts_dur) in enumerate(zip(video_durations, tts_durations)):
        scene_start = cumulative[i]

        # Window: starts after delay, ends gap before next scene (or end)
        window_start = scene_start + delay
        if i < len(video_durations) - 1:
            window_end = cumulative[i + 1] - gap
        else:
            window_end = total_duration - gap

        available = window_end - window_start

        entry = {
            "scene": i + 1,
            "video_duration": vid_dur,
            "tts_duration": tts_dur,
            "window_start": window_start,
            "window_end": window_end,
            "available": available,
            "speed_factor": 1.0,
            "status": "ok",
        }

        if available < min_window:
            entry["status"] = "skipped"
            entry["note"] = f"Window {available:.1f}s < min {min_window}s"
            results.append(entry)
            continue

        if tts_dur <= available:
            entry["status"] = "ok"
        elif tts_dur / max_speed <= available:
            entry["speed_factor"] = tts_dur / available
            entry["status"] = "speed_adjusted"
            entry["note"] = (
                f"TTS {tts_dur:.1f}s -> {tts_dur / entry['speed_factor']:.1f}s "
                f"at {entry['speed_factor']:.2f}x"
            )
        else:
            entry["speed_factor"] = max_speed
            adjusted_dur = tts_dur / max_speed
            entry["status"] = "truncated"
            entry["note"] = (
                f"TTS {tts_dur:.1f}s -> {adjusted_dur:.1f}s at {max_speed}x "
                f"(still {adjusted_dur - available:.1f}s over, will be truncated)"
            )

        results.append(entry)

    return results


def build_conductor_filter(
    timeline: list[dict],
    *,
    fade_in: float = CONDUCTOR_FADE_IN_S,
    fade_out: float = CONDUCTOR_FADE_OUT_S,
) -> tuple[str, int]:
    """
    Build an FFmpeg filter_complex string that combines all TTS segments
    into a single master narration track.

    Args:
        timeline: Output from calculate_timeline()
        fade_in: Fade-in duration per segment
        fade_out: Fade-out duration per segment

    Returns:
        (filter_complex_string, number_of_active_inputs)
    """
    active = [t for t in timeline if t["status"] != "skipped"]
    if not active:
        return "", 0

    filters = []
    for idx, entry in enumerate(active):
        chain = []
        input_label = f"[{idx}:a]"
        out_label = f"[s{idx}]"

        # Speed adjustment
        if entry["speed_factor"] > 1.0:
            chain.append(f"atempo={entry['speed_factor']:.3f}")

        # Delay (adelay takes milliseconds)
        delay_ms = int(entry["window_start"] * 1000)
        chain.append(f"adelay={delay_ms}|{delay_ms}")

        # Fade in
        if fade_in > 0:
            chain.append(
                f"afade=t=in:st={entry['window_start']:.3f}:d={fade_in:.3f}"
            )

        # Fade out — placed at end of TTS within the window
        if fade_out > 0:
            tts_dur = entry["tts_duration"]
            if entry["speed_factor"] > 1.0:
                tts_dur = tts_dur / entry["speed_factor"]
            fade_out_start = (
                entry["window_start"]
                + min(tts_dur, entry["available"])
                - fade_out
            )
            if fade_out_start > entry["window_start"]:
                chain.append(
                    f"afade=t=out:st={fade_out_start:.3f}:d={fade_out:.3f}"
                )

        filters.append(f"{input_label}{','.join(chain)}{out_label}")

    # Mix all segments
    mix_inputs = "".join(f"[s{i}]" for i in range(len(active)))
    filters.append(
        f"{mix_inputs}amix=inputs={len(active)}:"
        f"duration=longest:dropout_transition=600[aout]"
    )

    return ";".join(filters), len(active)


def generate_master_narration(
    video_files: list[str],
    tts_files: list[str],
    output_path: str,
    *,
    report_path: str | None = None,
    delay: float = CONDUCTOR_DELAY_S,
    gap: float = CONDUCTOR_GAP_S,
    fade_in: float = CONDUCTOR_FADE_IN_S,
    fade_out: float = CONDUCTOR_FADE_OUT_S,
    max_speed: float = CONDUCTOR_MAX_SPEED,
) -> dict | None:
    """
    Generate a single master narration track aligned to the full video timeline.

    Args:
        video_files: Ordered list of video file paths
        tts_files: Matching TTS audio files (same order as videos)
        output_path: Path for the master narration MP3
        report_path: Optional path for conductor_report.json
        delay: Silence before narration in each scene
        gap: Silence between scenes
        fade_in: Fade-in per segment
        fade_out: Fade-out per segment
        max_speed: Max atempo factor

    Returns:
        dict with report, or None if all scenes skipped
    """
    # Probe durations
    video_durations = [get_video_duration(v) for v in video_files]
    tts_durations = [get_audio_duration(t) for t in tts_files]

    logger.info(
        "Conductor: %d scenes, total video %.1fs",
        len(video_files),
        sum(video_durations),
    )

    # Calculate timeline
    timeline = calculate_timeline(
        video_durations,
        tts_durations,
        delay=delay,
        gap=gap,
        max_speed=max_speed,
    )

    # Log per-scene status
    for entry in timeline:
        status = entry["status"]
        note = entry.get("note", "")
        logger.info(
            "  Scene %d: %.1fs TTS in %.1fs window -> %s %s",
            entry["scene"],
            entry["tts_duration"],
            entry["available"],
            status,
            note,
        )

    # Build FFmpeg filter
    filter_str, input_count = build_conductor_filter(
        timeline,
        fade_in=fade_in,
        fade_out=fade_out,
    )

    if input_count == 0:
        logger.warning("Conductor: all scenes skipped, no master track generated")
        return None

    # Build FFmpeg command
    active_tts = [
        tts_files[i] for i, t in enumerate(timeline) if t["status"] != "skipped"
    ]

    cmd = ["ffmpeg", "-y"]
    for tts in active_tts:
        cmd.extend(["-i", tts])
    cmd.extend([
        "-filter_complex",
        filter_str,
        "-map",
        "[aout]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        output_path,
    ])

    logger.info("Conductor: generating master track -> %s", output_path)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if result.returncode != 0:
        logger.error("Conductor FFmpeg error: %s", result.stderr[:500])
        return None

    # Normalize volume — amix crushes levels when mixing sparse segments
    # across a long timeline. loudnorm brings it to broadcast standard (-16 LUFS).
    normalized_path = output_path.replace(".mp3", "_norm.mp3")
    norm_cmd = [
        "ffmpeg", "-y",
        "-i", output_path,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "libmp3lame", "-b:a", "192k",
        normalized_path,
    ]
    norm_result = subprocess.run(norm_cmd, capture_output=True, text=True, timeout=120)
    if norm_result.returncode == 0:
        os.replace(normalized_path, output_path)
        logger.info("Conductor: normalized output to -16 LUFS")
    else:
        logger.warning("Conductor: loudnorm failed, using raw output: %s",
                        norm_result.stderr[:200])
        if os.path.exists(normalized_path):
            os.remove(normalized_path)

    # Write report
    report = {
        "total_duration": sum(video_durations),
        "scenes": timeline,
    }

    if report_path:
        os.makedirs(os.path.dirname(report_path) or ".", exist_ok=True)
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        logger.info("Conductor report saved: %s", report_path)

    return {
        "report": timeline,
        "output": output_path,
        "total_duration": sum(video_durations),
    }


def find_matching_files(
    videos_dir: str,
    tts_dir: str,
) -> tuple[list[str], list[str]]:
    """
    Find matching video and TTS files by scene number.

    Returns:
        (video_files, tts_files) — matched by scene number, same order
    """
    # Find videos: run*_scene_N.mp4 (prefer _narrated, then _vc, then plain)
    video_pattern = os.path.join(videos_dir, "run*_scene_*.mp4")
    all_videos = sorted(glob.glob(video_pattern))

    # Extract scene numbers, prefer narrated > vc > plain
    scene_videos: dict[int, str] = {}
    for v in all_videos:
        basename = os.path.basename(v)
        # Skip extended/backup files
        if "_extended" in basename or "backups" in v:
            continue
        m = re.search(r"scene_(\d+)", basename)
        if not m:
            continue
        scene_num = int(m.group(1))
        # Priority: narrated > vc > plain
        if "_narrated" in basename:
            scene_videos[scene_num] = v
        elif "_vc" in basename and scene_num not in scene_videos:
            scene_videos[scene_num] = v
        elif scene_num not in scene_videos:
            scene_videos[scene_num] = v

    # Find TTS: scene_N_tts.mp3 or scene_N_combined.mp3
    scene_tts: dict[int, str] = {}
    for pattern_name in [
        "scene_{}_tts.mp3",
        "scene_{}_combined.mp3",
        "scene_{}.mp3",
    ]:
        for scene_num in scene_videos:
            tts_path = os.path.join(tts_dir, pattern_name.format(scene_num))
            if os.path.exists(tts_path) and scene_num not in scene_tts:
                scene_tts[scene_num] = tts_path

    # Match: only include scenes that have both video and TTS
    matched_scenes = sorted(set(scene_videos.keys()) & set(scene_tts.keys()))

    videos = [scene_videos[s] for s in matched_scenes]
    tts_files = [scene_tts[s] for s in matched_scenes]

    return videos, tts_files


def build_parser() -> argparse.ArgumentParser:
    """Build argument parser for standalone conductor."""
    parser = argparse.ArgumentParser(
        description="Narration Conductor — composition-aware narration timing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--videos-dir",
        required=True,
        help="Directory containing scene videos",
    )
    parser.add_argument(
        "--tts-dir",
        required=True,
        help="Directory containing per-scene TTS files",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output path for master narration (default: <tts-dir>/master_narration.mp3)",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Output path for timing report JSON",
    )
    parser.add_argument(
        "--narration-delay",
        type=float,
        default=CONDUCTOR_DELAY_S,
        help=f"Delay before narration in each scene (default: {CONDUCTOR_DELAY_S}s)",
    )
    parser.add_argument(
        "--narration-gap",
        type=float,
        default=CONDUCTOR_GAP_S,
        help=f"Gap between scenes (default: {CONDUCTOR_GAP_S}s)",
    )
    parser.add_argument(
        "--narration-fade-in",
        type=float,
        default=CONDUCTOR_FADE_IN_S,
        help=f"Fade-in duration (default: {CONDUCTOR_FADE_IN_S}s)",
    )
    parser.add_argument(
        "--narration-fade-out",
        type=float,
        default=CONDUCTOR_FADE_OUT_S,
        help=f"Fade-out duration (default: {CONDUCTOR_FADE_OUT_S}s)",
    )
    parser.add_argument(
        "--narration-speed",
        default="auto",
        help=f"Speed mode: auto (max {CONDUCTOR_MAX_SPEED}x), none, or float",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show timing plan without generating",
    )
    parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Skip confirmation prompts",
    )
    return parser


def main() -> None:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args()

    output = args.output or os.path.join(args.tts_dir, "master_narration.mp3")
    report = args.report or output.replace(".mp3", "_report.json")

    max_speed = CONDUCTOR_MAX_SPEED
    if args.narration_speed == "none":
        max_speed = 1.0
    elif args.narration_speed != "auto":
        max_speed = float(args.narration_speed)

    # Find matching files
    videos, tts_files = find_matching_files(args.videos_dir, args.tts_dir)

    if not videos:
        logger.error(
            "No matching video/TTS pairs found in %s and %s",
            args.videos_dir,
            args.tts_dir,
        )
        return

    logger.info("Found %d matched scene pairs", len(videos))
    for v, t in zip(videos, tts_files):
        logger.info("  %s <-> %s", os.path.basename(v), os.path.basename(t))

    if args.dry_run:
        video_durations = [get_video_duration(v) for v in videos]
        tts_durations = [get_audio_duration(t) for t in tts_files]
        timeline = calculate_timeline(
            video_durations,
            tts_durations,
            delay=args.narration_delay,
            gap=args.narration_gap,
            max_speed=max_speed,
        )
        print("\n=== Conductor Dry Run ===")
        for entry in timeline:
            print(
                f"  Scene {entry['scene']}: {entry['tts_duration']:.1f}s TTS "
                f"in {entry['available']:.1f}s window -> {entry['status']} "
                f"{entry.get('note', '')}"
            )
        print(f"\nTotal video: {sum(video_durations):.1f}s")
        return

    result = generate_master_narration(
        video_files=videos,
        tts_files=tts_files,
        output_path=output,
        report_path=report,
        delay=args.narration_delay,
        gap=args.narration_gap,
        fade_in=args.narration_fade_in,
        fade_out=args.narration_fade_out,
        max_speed=max_speed,
    )

    if result:
        logger.info(
            "Master narration saved: %s (%.1fs)", output, result["total_duration"]
        )
    else:
        logger.error("Failed to generate master narration")


if __name__ == "__main__":
    from logging_config import setup_logging

    setup_logging()
    main()
