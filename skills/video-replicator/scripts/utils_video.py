#!/usr/bin/env python3
"""
FFmpeg/ffprobe helpers and video information functions.

Extracted from utils.py — handles video duration, dimensions,
frame extraction, and scene counting.
"""

import os
import re

from exceptions import ValidationError
from ffmpeg_wrapper import FFmpegWrapper
from utils_image import get_aspect_ratio_string

_ff = FFmpegWrapper()


def parse_sealcam_timestamp(timestamp_str: str, position: str = "start") -> float:
    """
    Parse SEALCAM+ timestamp range string to seconds.

    Handles formats:
    - "0:03-0:06" -> start=3.0, middle=4.5, end=6.0
    - "1:02-1:15" -> start=62.0, middle=68.5, end=75.0
    - "0:03" -> 3.0 (single timestamp)
    - "1:02:15" -> 3735.0 (h:m:s)

    Args:
        timestamp_str: Timestamp string from SEALCAM+ analysis
        position: "start", "middle", or "end"

    Returns:
        Time in seconds as float

    Raises:
        ValueError: If timestamp format is not recognized
    """
    def _parse_single(ts: str) -> float:
        ts = ts.strip()
        parts = ts.split(":")
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        else:
            raise ValidationError(f"Unrecognized timestamp format: {ts}")

    if "-" in timestamp_str:
        start_str, end_str = timestamp_str.split("-", 1)
        start_sec = _parse_single(start_str)
        end_sec = _parse_single(end_str)

        if position == "start":
            return start_sec
        elif position == "end":
            return end_sec
        elif position == "middle":
            return (start_sec + end_sec) / 2.0
        else:
            raise ValidationError(f"Invalid position: {position}. Use 'start', 'middle', or 'end'")
    else:
        return _parse_single(timestamp_str)


def extract_frame_ffmpeg(video_path: str, seconds: float, output_path: str) -> bool:
    """
    Extract a single frame from a video at the given timestamp using FFmpeg.

    Returns:
        True if extraction succeeded and output file exists with non-zero size
    """
    return _ff.extract_frame(video_path, seconds, output_path)


def extract_last_frame(video_path: str, output_path: str) -> bool:
    """
    Extract the last frame of a video using ffmpeg -sseof -0.1.

    Useful for chained F2V generation where the last frame of scene N
    becomes the start frame for scene N+1.

    Returns:
        True if extraction succeeded and output file exists with non-zero size
    """
    return _ff.extract_last_frame(video_path, output_path)


def get_video_duration(video_path: str) -> float | None:
    """Get video duration in seconds using ffprobe."""
    return _ff.get_duration(video_path)


def get_video_dimensions(video_path: str) -> tuple[int, int] | None:
    """Get video dimensions (width, height) using ffprobe."""
    return _ff.get_dimensions(video_path)


def get_video_info(video_path: str) -> dict:
    """
    Get comprehensive video information.

    Returns:
        Dict with duration, width, height, aspect_ratio, file_size_mb
    """
    info = {
        "duration": None,
        "width": None,
        "height": None,
        "aspect_ratio": None,
        "file_size_mb": None,
    }

    info["duration"] = get_video_duration(video_path)

    dims = get_video_dimensions(video_path)
    if dims:
        info["width"] = dims[0]
        info["height"] = dims[1]
        info["aspect_ratio"] = get_aspect_ratio_string(dims[0], dims[1])

    if os.path.exists(video_path):
        info["file_size_mb"] = os.path.getsize(video_path) / (1024 * 1024)

    return info


def count_scene_videos(videos_dir: str) -> dict:
    """
    Count scene videos in directory.

    Returns:
        Dict with total count and per-scene primary/alt status
    """
    result = {"total": 0, "scenes": {}}

    for filename in os.listdir(videos_dir):
        if not filename.endswith(".mp4"):
            continue

        match = re.match(r"scene_(\d+)(_alt)?\.mp4", filename)
        if match:
            scene_num = int(match.group(1))
            is_alt = bool(match.group(2))

            if scene_num not in result["scenes"]:
                result["scenes"][scene_num] = {"primary": False, "alt": False}

            if is_alt:
                result["scenes"][scene_num]["alt"] = True
            else:
                result["scenes"][scene_num]["primary"] = True

            result["total"] += 1

    return result
