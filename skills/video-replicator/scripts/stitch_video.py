#!/usr/bin/env python3
"""
Video Stitching Script
Combines multiple video segments into a single video with optional audio.

NEW: Audio preservation and speech detection features.
- Preserves natural video sounds (ambient, footsteps, nature) when adding background music
- Detects and auto-mutes videos with speech
- Overlays background music on top of video audio (mix, don't replace)

Usage:
    # Basic usage with explicit scenes
    python stitch_video.py \
        --scenes "videos/scene_1.mp4,videos/scene_2.mp4,videos/scene_3.mp4" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4"

    # Use glob pattern
    python stitch_video.py \
        --pattern "videos/scene_*.mp4" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4"

    # DUAL MODE: Auto-create both primary and alt versions
    python stitch_video.py \
        --videos-dir "videos" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4" \
        --dual

    # NEW: Presenter/voice-over mode (voice priority)
    python stitch_video.py \
        --videos-dir "videos" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4" \
        --presenter
    # Uses: music=0.25, video=0.85 (voice is prominent, music is subtle background)

    # Custom volume control (ambient/B-roll mode is default)
    python stitch_video.py \
        --videos-dir "videos" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4" \
        --music-volume 0.5 \
        --video-volume 0.6

    # Speech detection (auto-mute videos with speech)
    python stitch_video.py \
        --videos-dir "videos" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4" \
        --check-speech

    # NEW: With narration (Phase 5b TTS)
    python stitch_video.py \
        --videos-dir "videos" \
        --audio "audio/background.mp3" \
        --narration "audio/narration.mp3" \
        --output "final/replicated_ad.mp4" \
        --presenter

    # NEW: Replace video audio (old behavior)
    python stitch_video.py \
        --videos-dir "videos" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4" \
        --no-preserve-audio

    # NEW: CTA banner overlay (Phase 7)
    python stitch_video.py \
        --videos-dir "videos" \
        --audio "audio/background.mp3" \
        --output "final/replicated_ad.mp4" \
        --cta-banner "banner/cta_banner_landscape.webm" \
        --cta-banner-timing "last-10s"

Requirements:
    - FFmpeg installed: brew install ffmpeg
"""

import argparse
import contextlib
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from exceptions import (
    MissingDependencyError,
    StaleArtifactError,
    StitchError,
    ValidationError,
    VideoProcessingError,
)
from config import COLOR_GRADE_PRESETS, CONCAT_FILTER_THRESHOLD, GENRE_PRESETS
from ffmpeg_wrapper import FFmpegWrapper, concat_via_filter
from logging_config import setup_logging

# Module-level logger — verbose can be enabled via setup_logging(__name__, verbose=True)
logger = setup_logging(__name__)


def print_progress(current: int, total: int, label: str, start_time: float) -> None:
    """Print a simple terminal progress bar."""
    elapsed = time.time() - start_time
    if current > 0:
        eta = (elapsed / current) * (total - current)
        eta_str = f"~{eta/60:.1f}min remaining"
    else:
        eta_str = "calculating..."

    bar_width = 20
    filled = int(bar_width * current / total) if total > 0 else 0
    bar = "\u2588" * filled + "\u2591" * (bar_width - filled)
    pct = int(100 * current / total) if total > 0 else 0

    print(f"\rStitching {label} [{bar}] {pct}% ({current}/{total}) {eta_str}    ", end="", flush=True)


# Shared FFmpeg wrapper instance
_ff = FFmpegWrapper()

# Import audio utilities
try:
    from audio_utils import (
        analyze_videos_for_speech,
        has_audio_stream,
        strip_audio,
    )
    AUDIO_UTILS_AVAILABLE = True
except ImportError:
    AUDIO_UTILS_AVAILABLE = False

# Import run management utilities
try:
    from utils_project import (
        get_latest_run_id,
        list_versions,
        record_version_in_manifest,
        resolve_version_dir,
        scan_existing_versions,
    )
    from utils_prompt import parse_mix_spec
    from utils_validation import (
        get_run_start_timestamp,
        validate_videos_freshness,
    )
    from utils_variation import detect_variations, get_variation_suffix
    RUN_MANAGEMENT_AVAILABLE = True
    TIMESTAMP_VALIDATION_AVAILABLE = True
except ImportError:
    RUN_MANAGEMENT_AVAILABLE = False
    TIMESTAMP_VALIDATION_AVAILABLE = False

# Import branding module
try:
    from branding import get_brand_dir, list_brands, load_brand
    HAS_BRANDING = True
except ImportError:
    HAS_BRANDING = False

    def get_latest_run_id(project_path: str, subdir: str = "videos") -> str | None:
        """Fallback implementation - find highest run ID from files."""
        dir_path = Path(project_path) / subdir if subdir else Path(project_path)
        if not dir_path.exists():
            return None

        runs = set()
        for f in dir_path.iterdir():
            if f.is_file():
                match = re.match(r"(run\d{3})_", f.name)
                if match:
                    runs.add(match.group(1))

        return sorted(runs)[-1] if runs else None

    def detect_variations(videos_dir: str, run_id: str | None = None) -> int:
        """Fallback implementation - detect variation count from files."""
        dir_path = Path(videos_dir)
        if not dir_path.exists():
            return 0

        prefix = f"{run_id}_scene_1" if run_id else "scene_1"

        # Check for new variation naming (_v1, _v2, etc.)
        variation_files = []
        for f in dir_path.iterdir():
            if f.is_file() and f.suffix.lower() == ".mp4" and f.name.startswith(prefix):
                match = re.search(r"_v(\d+)\.mp4$", f.name)
                if match:
                    variation_files.append(int(match.group(1)))

        if variation_files:
            return max(variation_files)

        # Check for legacy _alt naming
        for f in dir_path.iterdir():
            if f.is_file() and f.name == f"{prefix}.mp4":
                alt_path = dir_path / f"{prefix}_alt.mp4"
                if alt_path.exists():
                    return 2
                return 1

        return 0

    def get_variation_suffix(variation: int, total_variations: int) -> str:
        """Get the filename suffix for a variation."""
        if total_variations == 1:
            return ""
        return f"_v{variation}"


def get_video_duration(video_path: str) -> float:
    """Get video duration in seconds using ffprobe.

    Returns:
        Duration in seconds, or 0.0 if duration cannot be determined.

    Raises:
        FileNotFoundError: If the video file does not exist.
        RuntimeError: If ffprobe fails to execute.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    from exceptions import VideoProcessingError

    try:
        output = _ff.probe(video_path, entries="format=duration")
    except MissingDependencyError as e:
        raise RuntimeError("ffprobe not found. Please install FFmpeg: brew install ffmpeg") from e
    except VideoProcessingError as e:
        raise RuntimeError(str(e)) from e

    if not output:
        raise RuntimeError(f"ffprobe returned empty duration for: {video_path}")

    try:
        return float(output)
    except ValueError as e:
        raise RuntimeError(f"ffprobe returned invalid duration '{output}' for: {video_path}") from e


def create_concat_file(video_files: list[str], output_path: str) -> str:
    """Create FFmpeg concat demuxer file."""
    concat_content = "\n".join([f"file '{os.path.abspath(f)}'" for f in video_files])

    with open(output_path, "w") as f:
        f.write(concat_content)

    return output_path


def check_videos_have_audio(video_files: list[str]) -> tuple[bool, bool, list[str]]:
    """Check audio streams across all videos.

    Returns:
        (all_have_audio, any_has_audio, files_missing_audio)
    """
    if not AUDIO_UTILS_AVAILABLE:
        # Assume videos might have audio
        return (True, True, [])

    has_audio = []
    missing_audio = []

    for video_path in video_files:
        try:
            if has_audio_stream(video_path):
                has_audio.append(video_path)
            else:
                missing_audio.append(video_path)
        except Exception:
            missing_audio.append(video_path)

    all_have = len(missing_audio) == 0 and len(has_audio) > 0
    any_have = len(has_audio) > 0

    return (all_have, any_have, missing_audio)


def validate_video_dimensions(video_files: list[str]) -> dict:
    """Check all videos have consistent dimensions.

    Groups videos by resolution and identifies mismatches against the
    majority resolution.

    Returns:
        {
            "valid": bool,              # True when all probed files share the same WxH
            "consistent": bool,         # Alias for valid (backward compat)
            "majority_dims": (width, height) or None,
            "dimensions": {(w,h): [paths...], ...},  # Videos grouped by resolution
            "mismatched": [(path, (w, h)), ...],
            "mismatched_files": [path, ...],          # Just the file paths
            "all_dims": {path: (w, h), ...}
        }
    """
    all_dims: dict[str, tuple[int, int]] = {}
    dim_counts: dict[tuple[int, int], int] = {}
    dim_groups: dict[tuple[int, int], list[str]] = {}

    for video_path in video_files:
        try:
            dims = _ff.get_dimensions(video_path)
            if dims:
                all_dims[video_path] = dims
                dim_counts[dims] = dim_counts.get(dims, 0) + 1
                dim_groups.setdefault(dims, []).append(video_path)
            else:
                logger.warning("Could not probe dimensions for %s, skipping", os.path.basename(video_path))
        except Exception as e:
            logger.warning("Error probing %s: %s, skipping", os.path.basename(video_path), e)

    if not dim_counts:
        return {
            "valid": True,
            "consistent": True,
            "majority_dims": None,
            "dimensions": {},
            "mismatched": [],
            "mismatched_files": [],
            "all_dims": all_dims,
        }

    # Find majority dimensions (most common w×h)
    majority_dims = max(dim_counts, key=dim_counts.get)

    mismatched = [
        (path, dims) for path, dims in all_dims.items()
        if dims != majority_dims
    ]

    is_valid = len(mismatched) == 0

    return {
        "valid": is_valid,
        "consistent": is_valid,
        "majority_dims": majority_dims,
        "dimensions": dim_groups,
        "mismatched": mismatched,
        "mismatched_files": [path for path, _ in mismatched],
        "all_dims": all_dims,
    }


def rescale_videos_to_resolution(
    video_files: list[str],
    target_width: int,
    target_height: int,
    temp_dir: str | None = None,
) -> tuple[list[str], list[str]]:
    """Rescale all videos to a specific resolution using FFmpeg scale filter.

    Videos already at the target resolution are passed through unchanged.
    Others are re-encoded with ``scale=W:H`` plus ``setsar=1`` to avoid
    aspect-ratio metadata issues.

    Args:
        video_files: List of video file paths.
        target_width: Target width in pixels.
        target_height: Target height in pixels.
        temp_dir: Directory for re-encoded files.  Created automatically
            when ``None``.

    Returns:
        Tuple of (processed_files, temp_files_to_cleanup).
    """
    if not video_files:
        return [], []

    if temp_dir is None:
        temp_dir = tempfile.mkdtemp(prefix="rescale_")

    result_files: list[str] = []
    temp_files: list[str] = []

    for i, f in enumerate(video_files):
        dims = _ff.get_dimensions(f)
        if dims and dims[0] == target_width and dims[1] == target_height:
            # Already at target resolution
            result_files.append(f)
            continue

        out_name = f"rescaled_{i:03d}_{os.path.basename(f)}"
        out_path = os.path.join(temp_dir, out_name)
        try:
            _ff.run([
                "-i", f,
                "-vf", f"scale={target_width}:{target_height}:force_original_aspect_ratio=disable,setsar=1",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                "-c:a", "copy",
                out_path,
            ])
            result_files.append(out_path)
            temp_files.append(out_path)
            current_w, current_h = dims if dims else (0, 0)
            logger.info(
                "  Rescaled %s: %dx%d -> %dx%d",
                os.path.basename(f), current_w, current_h, target_width, target_height,
            )
        except Exception as e:
            logger.warning("  Failed to rescale %s: %s — using original", os.path.basename(f), e)
            result_files.append(f)

    if temp_dir not in temp_files:
        temp_files.append(temp_dir)  # For cleanup

    return result_files, temp_files


def create_offset_narration(narration_path: str, offset_seconds: float, temp_dir: str) -> str:
    """Prepend silence to narration to offset for logo intro.

    Args:
        narration_path: Path to the original narration audio file
        offset_seconds: Number of seconds of silence to prepend
        temp_dir: Temporary directory for intermediate files

    Returns:
        Path to the offset narration file (or original if offset <= 0)
    """
    if offset_seconds <= 0:
        return narration_path

    silence_path = os.path.join(temp_dir, "silence.mp3")
    offset_path = os.path.join(temp_dir, "narration_offset.mp3")

    # Create silence file
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=mono",
        "-t", str(offset_seconds),
        silence_path
    ], capture_output=True, check=True)

    # Concatenate silence + narration
    subprocess.run([
        "ffmpeg", "-y",
        "-i", silence_path,
        "-i", narration_path,
        "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]",
        "-map", "[out]",
        offset_path
    ], capture_output=True, check=True)

    return offset_path


def validate_timing(video_duration: float, narration_duration: float, logo_duration: float = 0) -> bool:
    """Warn if narration duration doesn't match video content duration.

    Args:
        video_duration: Total video duration including logo
        narration_duration: Total narration duration (before offset)
        logo_duration: Duration of logo intro (if any)

    Returns:
        True if timing is acceptable, False if there's a significant mismatch
    """
    content_duration = video_duration - logo_duration
    diff = abs(narration_duration - content_duration)
    if diff > 2.0:  # More than 2 seconds off
        logger.warning("Narration (%.1fs) doesn't match video content (%.1fs). Difference: %.1fs",
                       narration_duration, content_duration, diff)
        return False
    return True


def preprocess_videos_for_speech(
    video_files: list[str],
    verbose: bool = True
) -> tuple[list[str], dict[str, Any]]:
    """
    Preprocess videos: detect speech and mute videos that have it.

    Args:
        video_files: List of video file paths
        verbose: Print progress messages

    Returns:
        (processed_files, speech_report) tuple where:
        - processed_files: List of paths (original or _muted versions)
        - speech_report: Dict with detection results
    """
    if not AUDIO_UTILS_AVAILABLE:
        if verbose:
            logger.warning("audio_utils not available, skipping speech detection")
        return video_files, {"skipped": True}

    if verbose:
        logger.info("Analyzing videos for speech...")

    speech_analysis = analyze_videos_for_speech(video_files, verbose=verbose)
    processed_files = []

    for video_info in speech_analysis["videos"]:
        path = video_info["path"]

        if video_info.get("has_speech", False):
            # Mute this video's audio
            if verbose:
                logger.warning("Muting speech in: %s", os.path.basename(path))

            try:
                muted_path = strip_audio(path)
                processed_files.append(muted_path)
            except Exception as e:
                if verbose:
                    logger.error("Error muting %s: %s", path, e)
                processed_files.append(path)  # Use original on failure
        else:
            processed_files.append(path)

    return processed_files, speech_analysis


VALID_XFADE_TRANSITIONS = [
    "fade", "fadeblack", "fadewhite",
    "wipeleft", "wiperight", "wipeup", "wipedown",
    "slideleft", "slideright", "slideup", "slidedown",
    "circlecrop", "rectcrop", "dissolve", "pixelize",
    "diagtl", "diagtr", "diagbl", "diagbr",
    "hlslice", "hrslice", "vuslice", "vdslice",
    "radial", "zoomin", "smoothleft", "smoothright",
]


def build_xfade_filter(video_files: list[str], transition: str, duration: float) -> tuple[str | None, str | None, str | None, str | None]:
    """
    Build FFmpeg filter_complex for xfade transitions between clips.

    Instead of concat demuxer (hard cuts), this uses multiple -i inputs
    with xfade filters to create smooth transitions between scenes.

    Args:
        video_files: List of video file paths
        transition: FFmpeg xfade transition name (e.g., 'dissolve', 'fade')
        duration: Transition duration in seconds

    Returns:
        (filter_string, video_out_label, audio_filter_string, audio_out_label)
        or (None, None, None, None) if transitions don't apply
    """
    if not transition or transition == "none" or len(video_files) < 2:
        return None, None, None, None

    # Get durations for offset calculation
    durations = []
    for v in video_files:
        dur = get_video_duration(v)
        durations.append(dur if dur > 0 else 8.0)

    video_filters = []
    audio_filters = []

    # Normalize each input to consistent resolution/fps
    for i in range(len(video_files)):
        video_filters.append(
            f"[{i}:v]scale=1280:720:force_original_aspect_ratio=decrease,"
            f"pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{i}]"
        )

    # Build xfade chain for video
    current_vlabel = "v0"
    for i in range(1, len(video_files)):
        # Offset = cumulative duration of previous segments minus accumulated transitions
        offset = sum(durations[:i]) - (duration * i)
        offset = max(0, offset)

        next_vlabel = f"v{i}"
        out_vlabel = f"x{i}" if i < len(video_files) - 1 else "vout"

        video_filters.append(
            f"[{current_vlabel}][{next_vlabel}]xfade=transition={transition}"
            f":duration={duration}:offset={offset:.3f}[{out_vlabel}]"
        )
        current_vlabel = out_vlabel

    # Build audio crossfade chain (mirrors the video xfade chain).
    # Uses acrossfade between adjacent pairs instead of per-clip afade,
    # which broke middle clips by chaining afade=t=out then afade=t=in.
    n = len(video_files)
    if n == 1:
        audio_filters.append("[0:a]anull[aout]")
    else:
        current_alabel = "0:a"
        for i in range(1, n):
            next_alabel = f"{i}:a"
            out_alabel = f"acf{i}" if i < n - 1 else "aout"
            audio_filters.append(
                f"[{current_alabel}][{next_alabel}]acrossfade=d={duration}[{out_alabel}]"
            )
            current_alabel = out_alabel

    video_filter_str = ";".join(video_filters)
    audio_filter_str = ";".join(audio_filters)

    return video_filter_str, "vout", audio_filter_str, "aout"


def prepare_timing_sync_videos(
    video_files: list[str],
    slides_json_path: str,
    mode: str,
    temp_dir: str,
) -> list[str]:
    """Extend video clips to match slide durations from slides.json.

    For PRESENTATION mode, each clip (~8s) needs to be extended to match
    the original slide's narration duration.

    Args:
        video_files: Sorted list of video file paths (one per slide).
        slides_json_path: Path to slides.json with per-slide timestamps/durations.
        mode: "freeze-first" (still frame then animation) or "loop-fill" (loop clip).
        temp_dir: Directory for temporary extended video files.

    Returns:
        List of paths to extended video files (same order as input).
    """
    with open(slides_json_path) as f:
        slides_data = json.load(f)

    slides = slides_data.get("slides", [])
    if not slides:
        logger.warning("No slides found in slides.json, returning original files")
        return video_files

    # Build a map of slide number -> target duration
    slide_durations = {}
    for slide in slides:
        slide_num = slide["slide"]
        duration = slide.get("duration", 0)
        if duration > 0:
            slide_durations[slide_num] = duration

    if not slide_durations:
        logger.warning("No slide durations found, returning original files")
        return video_files

    logger.info("=" * 60)
    logger.info("Timing Sync: %s mode", mode)
    logger.info("=" * 60)
    logger.info("Slides with durations: %d", len(slide_durations))
    logger.info("Video clips: %d", len(video_files))

    extended_files = []

    for i, video_path in enumerate(video_files):
        slide_num = i + 1  # 1-indexed
        target_duration = slide_durations.get(slide_num)

        if target_duration is None:
            logger.info("Slide %d: No duration found, using clip as-is", slide_num)
            extended_files.append(video_path)
            continue

        clip_duration = get_video_duration(video_path)
        basename = os.path.basename(video_path)
        output_path = os.path.join(temp_dir, f"synced_{basename}")

        if target_duration <= clip_duration:
            # Target is shorter than clip — trim the clip
            logger.info("Slide %d: %.1fs -> %.1fs (trim)", slide_num, clip_duration, target_duration)
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-t", str(target_duration),
                "-c", "copy",
                output_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode != 0:
                logger.warning("Trim failed, using original: %s", result.stderr[:200])
                extended_files.append(video_path)
            else:
                extended_files.append(output_path)
            continue

        if mode == "freeze-first":
            # Extract first frame -> create freeze video -> concat freeze + animation
            freeze_duration = target_duration - clip_duration
            frame_path = os.path.join(temp_dir, f"frame_{slide_num}.jpg")
            freeze_path = os.path.join(temp_dir, f"freeze_{slide_num}.mp4")

            logger.info("Slide %d: %.1fs -> %.1fs (freeze %.1fs + animation %.1fs)",
                       slide_num, clip_duration, target_duration, freeze_duration, clip_duration)

            # Extract first frame
            cmd_frame = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vframes", "1",
                "-q:v", "2",
                frame_path,
            ]
            result = subprocess.run(cmd_frame, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                logger.warning("Frame extraction failed, using original")
                extended_files.append(video_path)
                continue

            # Get video resolution and fps from original clip
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,r_frame_rate",
                "-of", "json",
                video_path,
            ]
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
            if probe_result.returncode != 0:
                logger.warning("ffprobe failed, using original")
                extended_files.append(video_path)
                continue

            probe_data = json.loads(probe_result.stdout)
            stream = probe_data.get("streams", [{}])[0]
            width = stream.get("width", 1280)
            height = stream.get("height", 720)
            fps_str = stream.get("r_frame_rate", "24/1")

            # Create freeze-frame video (silent — audio from original clip plays after)
            cmd_freeze = [
                "ffmpeg", "-y",
                "-loop", "1",
                "-i", frame_path,
                "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                "-t", str(freeze_duration),
                "-vf", f"scale={width}:{height},format=yuv420p",
                "-r", fps_str,
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-c:a", "aac", "-b:a", "128k",
                "-shortest",
                freeze_path,
            ]
            result = subprocess.run(cmd_freeze, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                logger.warning("Freeze video creation failed: %s", result.stderr[:200])
                extended_files.append(video_path)
                continue

            # Concatenate freeze + animation using concat demuxer
            concat_list_path = os.path.join(temp_dir, f"concat_{slide_num}.txt")
            with open(concat_list_path, "w") as cf:
                cf.write(f"file '{os.path.abspath(freeze_path)}'\n")
                cf.write(f"file '{os.path.abspath(video_path)}'\n")

            cmd_concat = [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_list_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-c:a", "aac", "-b:a", "128k",
                output_path,
            ]
            result = subprocess.run(cmd_concat, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                logger.warning("Concat failed: %s", result.stderr[:200])
                extended_files.append(video_path)
            else:
                extended_files.append(output_path)

        elif mode == "loop-fill":
            # Loop the clip to fill the target duration
            loops_needed = int(target_duration / clip_duration) + 1
            logger.info("Slide %d: %.1fs -> %.1fs (loop %dx, trim to %.1fs)",
                       slide_num, clip_duration, target_duration, loops_needed, target_duration)

            cmd_loop = [
                "ffmpeg", "-y",
                "-stream_loop", str(loops_needed - 1),  # -1 because 0 = play once
                "-i", video_path,
                "-t", str(target_duration),
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-c:a", "aac", "-b:a", "128k",
                output_path,
            ]
            result = subprocess.run(cmd_loop, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                logger.warning("Loop failed: %s", result.stderr[:200])
                extended_files.append(video_path)
            else:
                extended_files.append(output_path)
        else:
            logger.warning("Unknown mode '%s', using original", mode)
            extended_files.append(video_path)

    total_original = sum(get_video_duration(f) for f in video_files)
    total_extended = sum(get_video_duration(f) for f in extended_files)
    logger.info("Timing sync complete:")
    logger.info("  Original total: %.1fs", total_original)
    logger.info("  Extended total: %.1fs", total_extended)
    logger.info("=" * 60)

    return extended_files


def normalize_fps_if_needed(
    video_files: list[str],
    target_fps: float = 30.0,
    tolerance: float = 0.5,
    temp_dir: str | None = None,
) -> tuple[list[str], list[str]]:
    """
    Normalize frame rates across video segments before concat.

    If all videos have matching fps (within tolerance), returns originals unchanged.
    Otherwise, re-encodes mismatched files to target_fps.

    Args:
        video_files: List of video file paths
        target_fps: Target frame rate (default: 30.0)
        tolerance: Acceptable fps difference before re-encoding (default: 0.5)
        temp_dir: Directory for re-encoded files. Created if None.

    Returns:
        Tuple of (processed_files, temp_files_to_cleanup)
    """
    if len(video_files) <= 1:
        return video_files, []

    # Probe all fps values
    fps_values = []
    for f in video_files:
        fps = _ff.get_fps(f)
        fps_values.append(fps)

    # Check if all fps values could be determined
    valid_fps = [fps for fps in fps_values if fps is not None]
    if not valid_fps:
        logger.warning("Could not determine fps for any video, skipping normalization")
        return video_files, []

    # Check if all match (within tolerance)
    all_match = all(
        fps is not None and abs(fps - valid_fps[0]) <= tolerance
        for fps in fps_values
    )
    if all_match:
        logger.debug("All %d videos have matching fps (~%.2f), no normalization needed", len(video_files), valid_fps[0])
        return video_files, []

    # Fps mismatch detected — normalize
    fps_summary = ", ".join(
        f"{os.path.basename(f)}={fps:.2f}" if fps else f"{os.path.basename(f)}=?"
        for f, fps in zip(video_files, fps_values)
    )
    logger.warning("FPS mismatch detected: %s", fps_summary)
    logger.info("Normalizing all segments to %.1f fps", target_fps)

    if temp_dir is None:
        temp_dir = tempfile.mkdtemp(prefix="fps_norm_")

    result_files = []
    temp_files = []
    for i, (f, fps) in enumerate(zip(video_files, fps_values)):
        if fps is not None and abs(fps - target_fps) <= tolerance:
            # Already at target fps
            result_files.append(f)
        else:
            # Re-encode to target fps
            out_name = f"fps_norm_{i:03d}_{os.path.basename(f)}"
            out_path = os.path.join(temp_dir, out_name)
            try:
                _ff.run([
                    "-i", f,
                    "-vf", f"fps={target_fps}",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                    "-c:a", "copy",
                    out_path,
                ])
                result_files.append(out_path)
                temp_files.append(out_path)
                logger.info("  Re-encoded %s: %.2f fps -> %.1f fps",
                           os.path.basename(f), fps if fps else 0, target_fps)
            except Exception as e:
                logger.warning("  Failed to re-encode %s: %s — using original", os.path.basename(f), e)
                result_files.append(f)

    if temp_dir not in temp_files:
        temp_files.append(temp_dir)  # For cleanup

    return result_files, temp_files


def auto_scale_videos_if_needed(
    video_files: list[str],
    target_width: int | None = None,
    target_height: int | None = None,
    temp_dir: str | None = None,
) -> tuple[list[str], list[str]]:
    """
    Auto-scale videos to a consistent resolution before concat.

    If *target_width* and *target_height* are provided they are used directly
    (``--target-resolution`` override).  Otherwise the first video's dimensions
    are treated as the target and every subsequent file that differs is scaled
    to match.

    Scaling uses the **fit** approach (letterbox with black bars) so aspect
    ratios are never distorted.

    Args:
        video_files: Ordered list of video file paths.
        target_width: Explicit target width (``None`` = auto-detect from first file).
        target_height: Explicit target height (``None`` = auto-detect from first file).
        temp_dir: Directory for scaled files.  Created automatically when ``None``.

    Returns:
        Tuple of ``(processed_files, temp_files_to_cleanup)``.
        If no scaling was needed the original list is returned unchanged.
    """
    if len(video_files) <= 1:
        return video_files, []

    # Determine target dimensions
    if target_width is not None and target_height is not None:
        target = (target_width, target_height)
        logger.info("Target resolution (explicit): %dx%d", target[0], target[1])
    else:
        target = _ff.get_dimensions(video_files[0])
        if target is None:
            logger.warning("Could not probe dimensions for %s, skipping auto-scale",
                           os.path.basename(video_files[0]))
            return video_files, []
        logger.debug("Target resolution (from first file): %dx%d", target[0], target[1])

    # Check if any file differs
    needs_scaling = False
    file_dims: list[tuple[int, int] | None] = []
    for f in video_files:
        dims = _ff.get_dimensions(f)
        file_dims.append(dims)
        if dims is not None and dims != target:
            needs_scaling = True

    if not needs_scaling:
        logger.debug("All %d videos are %dx%d — no scaling needed",
                      len(video_files), target[0], target[1])
        return video_files, []

    # At least one mismatch — scale to target
    if temp_dir is None:
        temp_dir = tempfile.mkdtemp(prefix="auto_scale_")

    result_files: list[str] = []
    temp_files: list[str] = [temp_dir]  # dir itself for cleanup

    for i, (f, dims) in enumerate(zip(video_files, file_dims)):
        if dims is not None and dims == target:
            result_files.append(f)
        elif dims is None:
            # Could not probe — pass through and hope for the best
            logger.warning("  Could not probe %s — passing through unscaled",
                           os.path.basename(f))
            result_files.append(f)
        else:
            out_name = f"scaled_{i:03d}_{os.path.basename(f)}"
            out_path = os.path.join(temp_dir, out_name)
            try:
                _ff.auto_scale_video(f, target[0], target[1], out_path)
                result_files.append(out_path)
                temp_files.append(out_path)
                logger.info("  Scaled %s: %dx%d -> %dx%d",
                            os.path.basename(f), dims[0], dims[1], target[0], target[1])
            except Exception as e:
                logger.warning("  Failed to scale %s: %s — using original",
                               os.path.basename(f), e)
                result_files.append(f)

    return result_files, temp_files


def apply_color_grade(video_path: str, grade_name: str) -> bool:
    """Apply FFmpeg color grading filter to a video file in-place.

    Args:
        video_path: Path to the video file to grade.
        grade_name: Genre name (e.g., 'thriller') or preset name (e.g., 'nolan').

    Returns:
        True if grading was applied, False on error.
    """
    # Resolve filter string: check named presets first, then genre presets
    ffmpeg_filter = COLOR_GRADE_PRESETS.get(grade_name)
    if not ffmpeg_filter:
        genre = GENRE_PRESETS.get(grade_name, {})
        ffmpeg_filter = genre.get("color_grading_ffmpeg")
    if not ffmpeg_filter:
        logger.warning("Unknown color grade '%s' — skipping. Available: %s",
                       grade_name, list(COLOR_GRADE_PRESETS.keys()) + list(GENRE_PRESETS.keys()))
        return False

    import subprocess
    import tempfile

    tmp_path = video_path + ".graded.mp4"
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", ffmpeg_filter,
        "-c:v", "libx264", "-crf", "18", "-preset", "slow",
        "-pix_fmt", "yuv420p", "-profile:v", "high",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        tmp_path,
    ]
    logger.info("Applying color grade '%s': %s", grade_name, ffmpeg_filter)
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=300, check=True)
        os.replace(tmp_path, video_path)
        logger.info("Color grade applied successfully to %s", video_path)
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.error("Color grading failed: %s", e)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return False


def stitch_videos(
    video_files: list[str],
    output_path: str,
    audio_path: str | None = None,
    preserve_audio: bool = True,
    music_volume: float = 0.6,
    video_volume: float = 0.3,
    check_speech: bool = False,
    music_fade_out: float = 0.0,
    narration_path: str | None = None,
    narration_volume: float = 0.9,
    transition: str | None = None,
    transition_duration: float = 0.5,
    overlay_path: str | None = None,
    overlay_position: str = "bottom-right",
    overlay_scale: float = 0.15,
    overlay_opacity: float = 0.8,
    overlay_margin: int = 20,
    cta_banner_path: str | None = None,
    cta_banner_timing: str = "last-10s",
    logo_intro_overlay_path: str | None = None,
    logo_intro_overlay_duration: float = 5.0,
    logo_intro_overlay_opacity: float = 0.5,
    logo_intro_overlay_fade: float = 0.5,
    logo_intro_overlay_scale: float = 0.3,
    exclude_mismatched: bool = False,
    force_resolution: tuple[int, int] | None = None,
    no_auto_scale: bool = False,
) -> dict[str, Any]:
    """
    Stitch videos together with optional audio mixing and transitions.

    Args:
        video_files: List of video file paths to concatenate
        output_path: Path for the output video
        audio_path: Optional background music file
        preserve_audio: If True, mix video audio with background music
                       If False, replace video audio with background music (old behavior)
        music_volume: Volume level for background music (0.0-1.0)
        video_volume: Volume level for original video audio (0.0-1.0)
        check_speech: If True, detect and auto-mute videos with speech
        music_fade_out: Duration in seconds to fade out music at the end (0 = no fade)
        narration_path: Optional narration audio file (from Phase 5b TTS)
        narration_volume: Volume level for narration (0.0-1.0, default 0.9)
        transition: FFmpeg xfade transition type (e.g., 'dissolve', 'fade'). None = hard cuts.
        transition_duration: Duration of each transition in seconds (default 0.5)

    Returns:
        dict with result info:
        {
            "success": True,
            "output_path": str,
            "total_duration": float,
            "video_count": int,
            "file_size": int,
            "has_audio": bool,
            "audio_mode": str,  # "mixed", "music_only", "video_only", "silent",
                                # "narration_full_mix", "narration_music", "narration_only"
            "speech_muted": list,  # Videos that were muted due to speech
            "music_fade_out": float,  # Fade out duration used
            "transition": str,  # Transition type used (or None)
        }
    """
    if not video_files:
        raise ValueError("No video files provided")

    # Ensure output directory exists
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # Speech detection preprocessing
    speech_muted = []
    if check_speech and AUDIO_UTILS_AVAILABLE:
        video_files, speech_report = preprocess_videos_for_speech(video_files, verbose=True)
        if not speech_report.get("skipped"):
            for info in speech_report.get("videos", []):
                if info.get("has_speech"):
                    speech_muted.append(os.path.basename(info["path"]))

    # FPS normalization — re-encode mismatched segments before concat
    fps_temp_files = []
    video_files, fps_temp_files = normalize_fps_if_needed(video_files)

    # Force-resolution rescaling — rescale ALL videos to target WxH before concat
    rescale_temp_files = []
    if force_resolution:
        target_w, target_h = force_resolution
        logger.info("Force-rescaling all videos to %dx%d", target_w, target_h)
        video_files, rescale_temp_files = rescale_videos_to_resolution(
            video_files, target_w, target_h,
        )

    # Calculate total duration
    total_duration = sum(get_video_duration(f) for f in video_files)
    logger.info("Total video duration: %.2fs", total_duration)

    # Auto-scale or validate dimensions
    scale_temp_files: list[str] = []
    if len(video_files) > 1:
        dim_result = validate_video_dimensions(video_files)
        if not dim_result["consistent"]:
            majority = dim_result["majority_dims"]

            if no_auto_scale:
                # User explicitly disabled auto-scaling — hard fail on mismatch
                for path, dims in dim_result["mismatched"]:
                    logger.error("Dimension mismatch: %s is %dx%d (expected %dx%d)",
                                 os.path.basename(path), dims[0], dims[1],
                                 majority[0], majority[1])
                raise ValidationError(
                    f"Videos have inconsistent dimensions (--no-auto-scale). "
                    f"Majority: {majority[0]}x{majority[1]}, "
                    f"{len(dim_result['mismatched'])} mismatched."
                )

            if exclude_mismatched:
                mismatched_paths = {p for p, _ in dim_result["mismatched"]}
                video_files = [f for f in video_files if f not in mismatched_paths]
                logger.warning("Excluded %d mismatched videos, stitching %d remaining",
                               len(mismatched_paths), len(video_files))
                if not video_files:
                    raise ValidationError("No videos remaining after excluding mismatched dimensions")
                # Recalculate total duration
                total_duration = sum(get_video_duration(f) for f in video_files)
            else:
                # Auto-scale mismatched videos to match target resolution
                # Use force_resolution if set, otherwise the majority resolution
                if force_resolution:
                    scale_w, scale_h = force_resolution
                else:
                    scale_w, scale_h = majority
                logger.info("Auto-scaling %d mismatched video(s) to %dx%d",
                            len(dim_result["mismatched"]), scale_w, scale_h)
                video_files, scale_temp_files = auto_scale_videos_if_needed(
                    video_files,
                    target_width=scale_w,
                    target_height=scale_h,
                )
                # Recalculate total duration after scaling
                total_duration = sum(get_video_duration(f) for f in video_files)

    # Check audio conditions
    if preserve_audio:
        all_audio, any_audio, missing_audio_files = check_videos_have_audio(video_files)
        if any_audio and not all_audio:
            missing_names = [os.path.basename(f) for f in missing_audio_files]
            logger.warning("Some videos missing audio streams: %s — falling back to music_only mode", missing_names)
            has_video_audio = False  # force music_only to avoid concat [0:a] filter failure
        else:
            has_video_audio = all_audio
    else:
        has_video_audio = False
    has_background_music = audio_path and os.path.exists(audio_path)
    has_narration = narration_path and os.path.exists(narration_path)

    # Determine audio mode
    if has_narration and has_background_music and has_video_audio and preserve_audio:
        audio_mode = "narration_full_mix"  # 3-way: narration + music + video audio
    elif has_narration and has_background_music:
        audio_mode = "narration_music"  # narration + music (no video audio)
    elif has_narration:
        audio_mode = "narration_only"  # narration only
    elif has_video_audio and has_background_music and preserve_audio:
        audio_mode = "mixed"
    elif has_background_music:
        audio_mode = "music_only"
    elif has_video_audio and preserve_audio:
        audio_mode = "video_only"
    else:
        audio_mode = "silent"

    logger.info("Audio mode: %s", audio_mode)

    # ====== TRANSITION PATH: use xfade filter_complex instead of concat demuxer ======
    use_xfade = transition and transition != "none" and len(video_files) >= 2
    if use_xfade:
        logger.info("Transition: %s (%.1fs between each scene)", transition, transition_duration)
        vf_str, vlabel, af_str, alabel = build_xfade_filter(
            video_files, transition, transition_duration
        )

        # Adjusted total duration (transitions overlap)
        xfade_duration = total_duration - (transition_duration * (len(video_files) - 1))
        fade_start = max(0, xfade_duration - music_fade_out) if music_fade_out > 0 else 0

        # Build the ffmpeg command with all inputs
        cmd = ["ffmpeg", "-y"]
        for vf in video_files:
            cmd.extend(["-i", vf])

        # Combine video + audio filters
        if has_background_music and audio_path:
            music_input_idx = len(video_files)
            cmd.extend(["-i", audio_path])

            # Build music volume/fade filter
            if music_fade_out > 0:
                music_filter = f"[{music_input_idx}:a]volume={music_volume},afade=t=out:st={fade_start:.2f}:d={music_fade_out:.2f}[ma]"
            else:
                music_filter = f"[{music_input_idx}:a]volume={music_volume}[ma]"

            if preserve_audio and has_video_audio:
                # Mix crossfaded video audio + music
                full_filter = f"{vf_str};{af_str};[aout]volume={video_volume}[va];{music_filter};[va][ma]amix=inputs=2:duration=first:dropout_transition=600[finalout]"
                cmd.extend(["-filter_complex", full_filter])
                cmd.extend(["-map", f"[{vlabel}]", "-map", "[finalout]"])
            else:
                # Music only (no video audio)
                full_filter = f"{vf_str};{music_filter}"
                cmd.extend(["-filter_complex", full_filter])
                cmd.extend(["-map", f"[{vlabel}]", "-map", "[ma]"])
        elif has_video_audio and preserve_audio:
            # Video audio only (crossfaded)
            full_filter = f"{vf_str};{af_str}"
            cmd.extend(["-filter_complex", full_filter])
            cmd.extend(["-map", f"[{vlabel}]", "-map", f"[{alabel}]"])
        else:
            # No audio
            cmd.extend(["-filter_complex", vf_str])
            cmd.extend(["-map", f"[{vlabel}]", "-an"])

        cmd.extend([
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            output_path
        ])

        logger.info("Stitching %d videos with %s transitions (%.1fs total)...", len(video_files), transition, total_duration)
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            logger.error("FFmpeg error: %s", result.stderr[-500:])
            raise VideoProcessingError(f"FFmpeg xfade failed: {result.stderr[-200:]}")

        if result.stderr:
            logger.debug("FFmpeg stderr (xfade): %s", result.stderr[-500:])

        # Validate output file size
        MIN_OUTPUT_SIZE = 1024  # 1KB minimum for valid video
        try:
            xfade_file_size = os.path.getsize(output_path)
        except OSError:
            xfade_file_size = 0
        if xfade_file_size < MIN_OUTPUT_SIZE:
            raise StitchError(
                f"Output file too small ({xfade_file_size} bytes) — likely broken. "
                f"Expected at least {MIN_OUTPUT_SIZE} bytes. "
                f"Check FFmpeg stderr for filter chain errors."
            )

        # Apply overlay if requested (xfade path)
        if overlay_path:
            apply_overlay(
                output_path, overlay_path,
                position=overlay_position, scale=overlay_scale,
                opacity=overlay_opacity, margin=overlay_margin,
            )

        # Apply CTA banner if requested (xfade path)
        if cta_banner_path:
            apply_cta_banner_overlay(
                output_path, cta_banner_path,
                timing=cta_banner_timing,
            )

        # Apply logo intro overlay if requested (xfade path)
        if logo_intro_overlay_path:
            apply_logo_intro_overlay(
                output_path, logo_intro_overlay_path,
                duration=logo_intro_overlay_duration,
                opacity=logo_intro_overlay_opacity,
                fade_duration=logo_intro_overlay_fade,
                scale=logo_intro_overlay_scale,
            )

        file_size = os.path.getsize(output_path)
        logger.info("Output saved: %s (%.2f MB)", output_path, file_size / 1024 / 1024)

        return {
            "success": True,
            "output_path": output_path,
            "total_duration": xfade_duration,
            "video_count": len(video_files),
            "file_size": file_size,
            "has_audio": audio_mode != "silent",
            "audio_mode": audio_mode,
            "speech_muted": speech_muted,
            "music_fade_out": music_fade_out,
            "transition": transition,
        }

    # ====== STANDARD PATH: concat demuxer (hard cuts) ======
    # For 8+ segments, pre-concat via filter to prevent A/V drift accumulation.
    # The intermediate file is then fed into the audio mixing pipeline as a
    # single input, keeping the audio mode logic unchanged.
    use_concat_filter = len(video_files) >= CONCAT_FILTER_THRESHOLD
    preconcat_path = None

    if use_concat_filter:
        logger.info(
            "Using concat filter for %d segments (threshold=%d) to prevent A/V drift",
            len(video_files), CONCAT_FILTER_THRESHOLD,
        )
        preconcat_path = os.path.join(
            tempfile.gettempdir(),
            f"preconcat_{os.getpid()}.mp4",
        )
        if not concat_via_filter(video_files, preconcat_path):
            raise VideoProcessingError(
                f"Concat filter failed for {len(video_files)} segments. "
                "Falling back is not supported — check FFmpeg stderr."
            )
        # Build a concat list with just the single pre-concatenated file
        # so the rest of the pipeline works unchanged.
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as concat_file:
            concat_path = concat_file.name
            concat_file.write(f"file '{preconcat_path}'\n")
    else:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as concat_file:
            concat_path = concat_file.name
            create_concat_file(video_files, concat_path)

    try:
        # Calculate fade-out start time if enabled
        fade_start = max(0, total_duration - music_fade_out) if music_fade_out > 0 else 0

        if audio_mode == "narration_full_mix":
            # 3-way mix: video audio + background music + narration
            logger.info("Adding 3-way audio mix: video=%.0f%%, music=%.0f%%, narration=%.0f%%", video_volume*100, music_volume*100, narration_volume*100)

            # Build music filter (volume + optional fade-out)
            if music_fade_out > 0:
                logger.info("Music fade-out: %ss (starts at %.1fs)", music_fade_out, fade_start)
                music_filter = f"[1:a]volume={music_volume},afade=t=out:st={fade_start:.2f}:d={music_fade_out:.2f}[ma]"
            else:
                music_filter = f"[1:a]volume={music_volume}[ma]"

            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,       # input 0: videos
                "-i", audio_path,        # input 1: music
                "-i", narration_path,    # input 2: narration
                "-filter_complex",
                f"[0:a]volume={video_volume}[va];"
                f"{music_filter};"
                f"[2:a]volume={narration_volume}[na];"
                "[va][ma][na]amix=inputs=3:duration=longest:dropout_transition=600[aout]",
                "-map", "0:v:0",
                "-map", "[aout]",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                output_path
            ]
        elif audio_mode == "narration_music":
            # 2-way mix: background music + narration (no video audio)
            logger.info("Adding narration + music mix: music=%.0f%%, narration=%.0f%%", music_volume*100, narration_volume*100)

            if music_fade_out > 0:
                logger.info("Music fade-out: %ss (starts at %.1fs)", music_fade_out, fade_start)
                music_filter = f"[1:a]volume={music_volume},afade=t=out:st={fade_start:.2f}:d={music_fade_out:.2f}[ma]"
            else:
                music_filter = f"[1:a]volume={music_volume}[ma]"

            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,       # input 0: videos
                "-i", audio_path,        # input 1: music
                "-i", narration_path,    # input 2: narration
                "-filter_complex",
                f"{music_filter};"
                f"[2:a]volume={narration_volume}[na];"
                "[ma][na]amix=inputs=2:duration=longest:dropout_transition=600[aout]",
                "-map", "0:v:0",
                "-map", "[aout]",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                output_path
            ]
        elif audio_mode == "narration_only":
            # Narration only (no music, no video audio)
            logger.info("Adding narration: volume=%.0f%%", narration_volume*100)
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,
                "-i", narration_path,
                "-filter_complex",
                f"[1:a]volume={narration_volume}[aout]",
                "-map", "0:v:0",
                "-map", "[aout]",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                output_path
            ]
        elif audio_mode == "mixed":
            # Mix video audio with background music
            logger.info("Adding audio mix: video=%.0f%%, music=%.0f%%", video_volume*100, music_volume*100)

            # Build music filter chain (volume + optional fade-out)
            if music_fade_out > 0:
                logger.info("Music fade-out: %ss (starts at %.1fs)", music_fade_out, fade_start)
                music_filter = f"[1:a]volume={music_volume},afade=t=out:st={fade_start:.2f}:d={music_fade_out:.2f}[ma]"
            else:
                music_filter = f"[1:a]volume={music_volume}[ma]"

            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,
                "-i", audio_path,
                "-filter_complex",
                f"[0:a]volume={video_volume}[va];"
                f"{music_filter};"
                "[va][ma]amix=inputs=2:duration=first:dropout_transition=600[aout]",
                "-map", "0:v:0",
                "-map", "[aout]",
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "192k",
                output_path
            ]
        elif audio_mode == "music_only":
            # Replace video audio with background music
            logger.info("Adding audio: %s", audio_path)

            if music_fade_out > 0:
                logger.info("Music fade-out: %ss (starts at %.1fs)", music_fade_out, fade_start)
                # Use filter_complex for fade-out
                cmd = [
                    "ffmpeg", "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", concat_path,
                    "-i", audio_path,
                    "-filter_complex",
                    f"[1:a]afade=t=out:st={fade_start:.2f}:d={music_fade_out:.2f}[aout]",
                    "-map", "0:v:0",
                    "-map", "[aout]",
                    "-c:v", "libx264",
                    "-preset", "medium",
                    "-crf", "23",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
                    output_path
                ]
            else:
                # No fade-out, use simple mapping
                cmd = [
                    "ffmpeg", "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", concat_path,
                    "-i", audio_path,
                    "-c:v", "libx264",
                    "-preset", "medium",
                    "-crf", "23",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
                    "-map", "0:v:0",
                    "-map", "1:a:0",
                    output_path
                ]
        elif audio_mode == "video_only":
            # Keep only video audio (no background music)
            logger.info("Preserving original video audio")
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "192k",
                output_path
            ]
        else:
            # Silent output
            logger.info("No audio (silent output)")
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_path,
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-an",
                output_path
            ]

        logger.info("Stitching %d videos (%.1fs total)...", len(video_files), total_duration)
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            logger.error("FFmpeg error: %s", result.stderr)
            raise VideoProcessingError(f"FFmpeg failed: {result.stderr}")

        if result.stderr:
            logger.debug("FFmpeg stderr (concat): %s", result.stderr[-500:])

        # Validate output file size
        MIN_OUTPUT_SIZE = 1024  # 1KB minimum for valid video
        try:
            concat_file_size = os.path.getsize(output_path)
        except OSError:
            concat_file_size = 0
        if concat_file_size < MIN_OUTPUT_SIZE:
            raise StitchError(
                f"Output file too small ({concat_file_size} bytes) — likely broken. "
                f"Expected at least {MIN_OUTPUT_SIZE} bytes. "
                f"Check FFmpeg stderr for filter chain errors."
            )

        # Validate output duration (catch truncation bugs)
        try:
            output_duration = get_video_duration(output_path)
            if output_duration > 0 and total_duration > 0:
                duration_ratio = output_duration / total_duration
                if duration_ratio < 0.5:
                    logger.warning(
                        "Output duration (%.1fs) is <50%% of expected (%.1fs) — "
                        "possible audio truncation. Ratio: %.2f",
                        output_duration, total_duration, duration_ratio,
                    )
        except Exception:
            pass  # Duration check is best-effort, never block output

        # Apply overlay if requested
        if overlay_path:
            apply_overlay(
                output_path, overlay_path,
                position=overlay_position, scale=overlay_scale,
                opacity=overlay_opacity, margin=overlay_margin,
            )

        # Apply CTA banner if requested
        if cta_banner_path:
            apply_cta_banner_overlay(
                output_path, cta_banner_path,
                timing=cta_banner_timing,
            )

        # Apply logo intro overlay if requested
        if logo_intro_overlay_path:
            apply_logo_intro_overlay(
                output_path, logo_intro_overlay_path,
                duration=logo_intro_overlay_duration,
                opacity=logo_intro_overlay_opacity,
                fade_duration=logo_intro_overlay_fade,
                scale=logo_intro_overlay_scale,
            )

        # Get output file size
        file_size = os.path.getsize(output_path)
        logger.info("Output saved: %s (%.2f MB)", output_path, file_size / 1024 / 1024)

        return {
            "success": True,
            "output_path": output_path,
            "total_duration": total_duration,
            "video_count": len(video_files),
            "file_size": file_size,
            "has_audio": audio_mode != "silent",
            "audio_mode": audio_mode,
            "speech_muted": speech_muted,
            "music_fade_out": music_fade_out,
            "transition": None,
        }

    finally:
        # Cleanup temp files
        if os.path.exists(concat_path):
            os.remove(concat_path)
        if preconcat_path and os.path.exists(preconcat_path):
            os.remove(preconcat_path)
        # Cleanup FPS normalization temp files
        for tmp in fps_temp_files:
            with contextlib.suppress(Exception):
                if os.path.isdir(tmp):
                    import shutil
                    shutil.rmtree(tmp)
                elif os.path.isfile(tmp):
                    os.remove(tmp)
        # Cleanup rescale temp files
        for tmp in rescale_temp_files:
            with contextlib.suppress(Exception):
                if os.path.isdir(tmp):
                    import shutil
                    shutil.rmtree(tmp)
                elif os.path.isfile(tmp):
                    os.remove(tmp)
        # Cleanup auto-scale temp files
        for tmp in scale_temp_files:
            with contextlib.suppress(Exception):
                if os.path.isdir(tmp):
                    import shutil
                    shutil.rmtree(tmp)
                elif os.path.isfile(tmp):
                    os.remove(tmp)


def apply_cta_banner_overlay(
    video_path: str,
    banner_path: str,
    timing: str = "last-10s",
) -> bool:
    """
    Overlay animated CTA banner (WebM with transparency) onto video.

    The CTA banner is a Remotion-rendered video with alpha channel that
    appears at the bottom of the video during specified timing.

    Args:
        video_path: Path to the video to overlay (modified in-place)
        banner_path: Path to CTA banner video (WebM with transparency)
        timing: When to show banner - "entire", "last-5s", "last-10s", "custom-N"

    Returns:
        True on success
    """
    if not os.path.exists(banner_path):
        logger.warning("CTA banner not found: %s", banner_path)
        return False

    # Get video duration to calculate timing
    video_duration = get_video_duration(video_path)
    if video_duration <= 0:
        logger.warning("Could not get video duration")
        return False

    # Parse timing string into start time
    if timing == "entire":
        start_time = 0
    elif timing.startswith("last-"):
        seconds = int(timing.replace("last-", "").replace("s", ""))
        start_time = max(0, video_duration - seconds)
    elif timing.startswith("custom-"):
        start_time = int(timing.replace("custom-", ""))
    else:
        # Default: last 10 seconds
        start_time = max(0, video_duration - 10)

    logger.info("CTA banner timing: starts at %.1fs (video duration: %.1fs)", start_time, video_duration)

    temp_output = video_path + ".cta_tmp.mp4"

    # FFmpeg filter to overlay banner at bottom of video
    # - Scale banner to match video width
    # - Position at bottom (y = H - h)
    # - Enable only during specified timing window
    # - Preserve alpha channel from WebM
    filter_str = (
        f"[1:v]scale=iw:ih[banner];"
        f"[0:v][banner]overlay=x=(W-w)/2:y=H-h:enable='gte(t,{start_time})'"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", banner_path,
        "-filter_complex", filter_str,
        "-c:a", "copy",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        temp_output,
    ]

    logger.info("Applying CTA banner overlay...")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            logger.error("CTA banner overlay error: %s", result.stderr[:500])
            if os.path.exists(temp_output):
                os.remove(temp_output)
            return False

        # Replace original with overlaid version
        os.replace(temp_output, video_path)
        logger.info("CTA banner applied successfully")
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.error("CTA banner overlay error: %s", e)
        if os.path.exists(temp_output):
            os.remove(temp_output)
        return False


def apply_overlay(
    video_path: str,
    overlay_path: str,
    position: str = "bottom-right",
    scale: float = 0.15,
    opacity: float = 0.8,
    margin: int = 20,
) -> bool:
    """
    Apply a watermark/logo overlay to a video in-place.

    Args:
        video_path: Path to the video to overlay
        overlay_path: Path to overlay image (PNG with transparency)
        position: Position: bottom-right, bottom-left, top-right, top-left
        scale: Overlay width as fraction of video width (0.0-1.0)
        opacity: Overlay opacity (0.0-1.0)
        margin: Margin from edge in pixels

    Returns:
        True on success
    """
    if not os.path.exists(overlay_path):
        logger.warning("Overlay image not found: %s", overlay_path)
        return False

    temp_output = video_path + ".overlay_tmp.mp4"

    # Build position expression
    position_map = {
        "bottom-right": f"x=W-w-{margin}:y=H-h-{margin}",
        "bottom-left": f"x={margin}:y=H-h-{margin}",
        "top-right": f"x=W-w-{margin}:y={margin}",
        "top-left": f"x={margin}:y={margin}",
    }
    pos_expr = position_map.get(position, position_map["bottom-right"])

    # Build filter: scale overlay, set opacity, then overlay on video
    filter_str = (
        f"[1:v]scale=iw*{scale}/1:ih*{scale}/1,"
        f"format=rgba,colorchannelmixer=aa={opacity}[wm];"
        f"[0:v][wm]overlay={pos_expr}"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", overlay_path,
        "-filter_complex", filter_str,
        "-c:a", "copy",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        temp_output,
    ]

    logger.info("Applying overlay: %s (%s)", os.path.basename(overlay_path), position)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            logger.error("Overlay error: %s", result.stderr[:300])
            if os.path.exists(temp_output):
                os.remove(temp_output)
            return False

        # Replace original with overlaid version
        os.replace(temp_output, video_path)
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.error("Overlay error: %s", e)
        if os.path.exists(temp_output):
            os.remove(temp_output)
        return False


def apply_logo_intro_overlay(
    video_path: str,
    logo_path: str,
    duration: float = 5.0,
    opacity: float = 0.5,
    fade_duration: float = 0.5,
    scale: float = 0.3,
) -> bool:
    """
    Apply a centered logo overlay at the start of a video with fade in/out.

    This creates a "logo intro" effect where the logo appears centered,
    fades in, holds for the specified duration, then fades out.

    Args:
        video_path: Path to the video to overlay (modified in-place)
        logo_path: Path to logo image (PNG with transparency recommended)
        duration: How long to show the logo (seconds, default: 5.0)
        opacity: Maximum opacity of the logo (0.0-1.0, default: 0.5)
        fade_duration: Duration of fade in/out (seconds, default: 0.5)
        scale: Logo width as fraction of video width (0.0-1.0, default: 0.3)

    Returns:
        True on success
    """
    if not os.path.exists(logo_path):
        logger.warning("Logo image not found: %s", logo_path)
        return False

    temp_output = video_path + ".logo_intro_tmp.mp4"

    # Calculate timing:
    # - Fade in: 0 to fade_duration
    # - Hold at opacity: fade_duration to (duration - fade_duration)
    # - Fade out: (duration - fade_duration) to duration
    fade_in_end = fade_duration
    fade_out_start = max(fade_in_end, duration - fade_duration)

    # Build FFmpeg filter for timed, centered, fading overlay
    # The enable expression controls when the overlay is visible
    # The alpha fade is achieved by using colorchannelmixer with expression
    #
    # Timing logic:
    # - Enable from 0 to duration
    # - Alpha starts at 0, ramps to opacity during fade_in
    # - Holds at opacity
    # - Ramps from opacity to 0 during fade_out
    #
    # Alpha expression breakdown:
    # if(lt(t, fade_in_end), t/fade_in_end * opacity,                    <- fade in
    #    if(lt(t, fade_out_start), opacity,                              <- hold
    #       opacity * (duration - t) / fade_duration))                   <- fade out

    alpha_expr = (
        f"if(lt(t\\,{fade_in_end})\\,"
        f"t/{fade_in_end}*{opacity}\\,"
        f"if(lt(t\\,{fade_out_start})\\,"
        f"{opacity}\\,"
        f"{opacity}*(({duration}-t)/{fade_duration})))"
    )

    # Filter chain:
    # 1. Scale logo to fraction of video width (maintaining aspect ratio)
    # 2. Apply fading alpha using colorchannelmixer with expression
    # 3. Overlay at center with enable expression for timing
    filter_str = (
        f"[1:v]scale=iw*{scale}:-1,format=rgba[logo_scaled];"
        f"[logo_scaled]colorchannelmixer=aa='{alpha_expr}'[logo_faded];"
        f"[0:v][logo_faded]overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,0,{duration})'"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", logo_path,
        "-filter_complex", filter_str,
        "-c:a", "copy",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        temp_output,
    ]

    logger.info("Applying logo intro overlay: %s", os.path.basename(logo_path))
    logger.info("  Duration: %ss, Opacity: %s, Scale: %s, Fade: %ss", duration, opacity, scale, fade_duration)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            logger.error("Logo intro overlay error: %s", result.stderr[:500])
            if os.path.exists(temp_output):
                os.remove(temp_output)
            return False

        # Replace original with overlaid version
        os.replace(temp_output, video_path)
        logger.info("Logo intro overlay applied successfully")
        return True
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.error("Logo intro overlay error: %s", e)
        if os.path.exists(temp_output):
            os.remove(temp_output)
        return False


def get_scene_files(
    videos_dir: str,
    variation: int = 1,
    run_id: str | None = None,
    total_variations: int | None = None,
    use_run_dirs: bool = False
) -> list[str]:
    """Get scene files for a specific variation, sorted by scene number.

    Supports multiple naming conventions:
    - Legacy: scene_N.mp4, scene_N_alt.mp4
    - Run-prefixed: runNNN_scene_N.mp4, runNNN_scene_N_alt.mp4
    - Variations: runNNN_scene_N_v1.mp4, runNNN_scene_N_v2.mp4, etc.
    - Run subdirs: runs/{run_id}/videos/scene_N_v1.mp4 (no run prefix)

    Args:
        videos_dir: Directory containing scene files
        variation: Variation number (1-4). For legacy compatibility, 2 means _alt.
        run_id: Optional run ID to filter (e.g., "run001"). If None, auto-detects.
        total_variations: Total number of variations. If None, auto-detects.
        use_run_dirs: If True, files don't have run prefix in names.

    Returns:
        List of video file paths sorted by scene number
    """
    # Auto-detect run_id if not specified
    if run_id is None:
        detected_run = get_latest_run_id(videos_dir, subdir=None) if videos_dir else None
        if detected_run:
            run_id = detected_run
            logger.info("Auto-detected run: %s", run_id)

    # Auto-detect total_variations if not specified
    if total_variations is None:
        total_variations = detect_variations(videos_dir, run_id)
        if total_variations > 0:
            logger.info("Auto-detected variations: %d", total_variations)

    # Build prefix
    # When use_run_dirs=True, files are in runs/{run_id}/videos/ so no run prefix needed
    prefix = f"{run_id}_scene_" if run_id and not use_run_dirs else "scene_"

    # Determine suffix based on variation and total
    suffix = "" if total_variations == 1 else get_variation_suffix(variation, total_variations)

    # Find files matching this variation
    all_mp4s = glob.glob(os.path.join(videos_dir, f"{prefix}*.mp4"))
    matching_files = []

    for f in all_mp4s:
        basename = os.path.basename(f)

        # Extract scene number and check suffix
        if suffix == "":
            # Single variation: exclude _vN files (and legacy _alt)
            if "_alt.mp4" not in basename and not re.search(r"_v\d+\.mp4$", basename):
                matching_files.append(f)
        else:
            # Variation pattern: _v1, _v2, etc.
            if basename.endswith(f"{suffix}.mp4"):
                matching_files.append(f)

    # Sort by scene number
    def extract_scene_num(filepath: str) -> int:
        basename = os.path.basename(filepath)
        match = re.search(r'scene_(\d+)', basename)
        return int(match.group(1)) if match else 0

    sorted_files = sorted(matching_files, key=extract_scene_num)

    # FALLBACK: If run_id was auto-detected but no matching files found,
    # try again without the run prefix (for legacy/mixed projects)
    if not sorted_files and run_id is not None and not use_run_dirs:
        logger.warning("No files found with %s prefix, trying without run prefix...", run_id)
        return get_scene_files(videos_dir, variation=variation, run_id=None,
                               total_variations=total_variations, use_run_dirs=use_run_dirs)

    # Scene gap detection (v2.20): Warn about missing scenes in sequence
    if sorted_files:
        scene_nums = [extract_scene_num(f) for f in sorted_files]
        if scene_nums:
            min_scene = min(scene_nums)
            max_scene = max(scene_nums)
            expected_range = set(range(min_scene, max_scene + 1))
            found_set = set(scene_nums)
            missing = sorted(expected_range - found_set)
            if missing:
                logger.warning("Scene gap detected!")
                logger.warning("Found scenes: %s", sorted(found_set))
                logger.warning("Missing scenes: %s", missing)
                logger.warning("This may result in a shorter video than expected.")

    # Verbose file list for debugging
    if sorted_files:
        total_glob = len(all_mp4s)
        excluded = total_glob - len(matching_files)
        if excluded > 0:
            logger.debug("File discovery: %d .mp4 files found, %d excluded by suffix/pattern filter", total_glob, excluded)

    return sorted_files


# Legacy compatibility alias
def get_scene_files_legacy(videos_dir: str, alt: bool = False, run_id: str | None = None) -> list[str]:
    """Legacy wrapper for backwards compatibility with --dual flag."""
    variation = 2 if alt else 1
    return get_scene_files(videos_dir, variation=variation, run_id=run_id)


def get_mixed_scene_files(
    videos_dir: str,
    mix_spec: str,
    variation: int = 1,
    total_variations: int | None = None
) -> list[str]:
    """
    Get scene files by cherry-picking from different runs based on mix specification.

    Args:
        videos_dir: Directory containing scene videos
        mix_spec: Mix specification like "run001:2 run002:*"
        variation: Variation number (1-4)
        total_variations: Total number of variations (auto-detected if None)

    Returns:
        List of video file paths sorted by scene number
    """
    # First, detect the total number of scenes by finding all scene files
    all_mp4s = glob.glob(os.path.join(videos_dir, "run*_scene_*.mp4"))

    if not all_mp4s:
        logger.warning("No run-prefixed scene files found for mixing")
        return []

    # Extract scene numbers to find total
    scene_nums = set()
    for f in all_mp4s:
        match = re.search(r'scene_(\d+)', os.path.basename(f))
        if match:
            scene_nums.add(int(match.group(1)))

    if not scene_nums:
        logger.warning("Could not detect scene numbers from files")
        return []

    total_scenes = max(scene_nums)

    # Parse the mix spec
    try:
        scene_run_map = parse_mix_spec(mix_spec, total_scenes)
    except Exception as e:
        logger.error("Error parsing mix spec: %s", e)
        return []

    logger.info("Scene mix mapping: %s", scene_run_map)

    # Auto-detect total_variations if not specified
    if total_variations is None:
        # Use the first run_id in the map to detect variations
        first_run = list(scene_run_map.values())[0] if scene_run_map else None
        if first_run:
            total_variations = detect_variations(videos_dir, first_run)
            if total_variations > 0:
                logger.info("Auto-detected variations: %d", total_variations)
        if not total_variations:
            total_variations = 1

    # Determine suffix based on variation
    suffix = "" if total_variations == 1 else get_variation_suffix(variation, total_variations)

    # Build the mixed file list
    video_files = []
    missing_scenes = []

    for scene_num in sorted(scene_run_map.keys()):
        run_id = scene_run_map[scene_num]

        # Build pattern for this scene from the specified run
        if suffix:
            pattern = f"{run_id}_scene_{scene_num}{suffix}.mp4"
        else:
            # Single variation - exclude _vN files
            base_pattern = f"{run_id}_scene_{scene_num}.mp4"
            matches = glob.glob(os.path.join(videos_dir, base_pattern))
            if not matches:
                # Try without suffix but filter out _vN
                broader_pattern = f"{run_id}_scene_{scene_num}*.mp4"
                all_matches = glob.glob(os.path.join(videos_dir, broader_pattern))
                matches = [m for m in all_matches if not re.search(r'_v\d+\.mp4$', m)]

            if matches:
                video_files.append(sorted(matches)[0])
            else:
                missing_scenes.append((scene_num, run_id))
            continue

        matches = glob.glob(os.path.join(videos_dir, pattern))
        if matches:
            video_files.append(sorted(matches)[0])
        else:
            missing_scenes.append((scene_num, run_id))

    if missing_scenes:
        logger.warning("Missing videos for mix:")
        for scene_num, run_id in missing_scenes:
            logger.warning("  Scene %d from %s", scene_num, run_id)

    return video_files


def validate_videos_for_stitch(
    video_files: list[str],
    run_id: str,
    project_path: str,
    strict_mode: bool = False
) -> tuple[list[str], list[str], list[str]]:
    """
    Validate video files are from the current run (v2.8 freshness check).

    This prevents stale videos from previous runs being accidentally stitched
    together with new videos, which was the root cause of scene mixing bugs.

    Args:
        video_files: List of video file paths to validate
        run_id: Current run ID (e.g., "run001")
        project_path: Path to project directory (for manifest lookup)
        strict_mode: If True, raise ValueError when stale videos found

    Returns:
        Tuple of (valid_files, stale_files, warnings)
    """
    if not TIMESTAMP_VALIDATION_AVAILABLE:
        # Validation functions not available, return all files as valid
        return video_files, [], []

    # Get run start timestamp from manifest
    run_start = get_run_start_timestamp(project_path, run_id)

    if not run_start:
        # Could not find run in manifest - skip freshness check
        return video_files, [], [f"Could not find {run_id} in manifest - skipping freshness check"]

    # Validate each video's timestamp
    valid_files, stale_files, warnings = validate_videos_freshness(
        video_files, run_start, context=f"{run_id} started"
    )

    if stale_files and strict_mode:
        stale_names = [os.path.basename(f) for f in stale_files]
        raise StaleArtifactError(f"Stale videos detected: {', '.join(stale_names)}. Use --force to stitch anyway.")

    return valid_files, stale_files, warnings


def print_stale_video_warning(stale_files: list[str], warnings: list[str], run_id: str) -> None:
    """Print warning about stale videos found during validation."""
    if not stale_files:
        return

    logger.warning("=" * 60)
    logger.warning("Stale videos detected from previous run!")
    logger.warning("=" * 60)

    for warning in warnings:
        logger.warning("%s", warning)

    logger.warning("These videos were created BEFORE %s started.", run_id)
    logger.warning("They may not match your current first-frame images.")
    logger.warning("To fix: Run video generation again with --fresh")
    logger.warning("=" * 60)


def preprocess_mixed_audio_scenes(
    video_files: list[str],
    veo_audio_scenes: set[int],
    tts_dir: str,
    tts_volume: float = 1.0,
    sfx_volume: float = 0.7,
    preserve_sfx: bool = True,
    tts_pattern: str | None = None,
) -> tuple[list[str], list[str]]:
    """
    Preprocess video files for mixed audio source stitching.

    Scenes in veo_audio_scenes keep their original Veo audio (e.g. lip-synced
    dialogue). All other scenes get TTS audio baked in.

    Args:
        video_files: List of video file paths to process
        veo_audio_scenes: Set of scene numbers to keep Veo audio for
        tts_dir: Directory containing per-scene TTS files
        tts_volume: Volume for TTS narration (default: 1.0)
        sfx_volume: Volume for video SFX when mixing (default: 0.7)
        preserve_sfx: If True, mix TTS with video SFX. If False, replace.
        tts_pattern: Custom TTS filename pattern with {N} placeholder

    Returns:
        Tuple of (processed_files, temp_files_to_cleanup)
    """
    temp_dir = tempfile.mkdtemp(prefix="mixed_audio_")
    processed_files = []
    temp_files = [temp_dir]

    for video_path in video_files:
        basename = os.path.basename(video_path)
        match = re.search(r"scene_(\d+)", basename)

        if not match:
            # Not a scene file (e.g. logo intro) — keep as-is
            processed_files.append(video_path)
            continue

        scene_num = int(match.group(1))

        if scene_num in veo_audio_scenes:
            # Keep Veo's original audio (lip-synced or dialogue)
            logger.info("  Scene %d: keeping Veo audio (lip-sync)", scene_num)
            processed_files.append(video_path)
            continue

        # Find TTS file for this scene
        tts_path = _find_tts_for_scene(tts_dir, scene_num, tts_pattern)
        if not tts_path:
            logger.warning("  Scene %d: no TTS file found, keeping original audio", scene_num)
            processed_files.append(video_path)
            continue

        # Bake TTS onto this video
        out_path = os.path.join(temp_dir, f"mixed_{basename}")
        try:
            _bake_tts_onto_video(
                video_path, tts_path, out_path,
                tts_volume=tts_volume, sfx_volume=sfx_volume,
                preserve_sfx=preserve_sfx,
            )
            logger.info("  Scene %d: baked TTS (%s)", scene_num, os.path.basename(tts_path))
            processed_files.append(out_path)
            temp_files.append(out_path)
        except Exception as e:
            logger.warning("  Scene %d: TTS bake failed (%s), keeping original", scene_num, e)
            processed_files.append(video_path)

    return processed_files, temp_files


def _find_tts_for_scene(
    tts_dir: str, scene_num: int, tts_pattern: str | None = None
) -> str | None:
    """Find TTS audio file for a scene, checking multiple naming conventions."""
    if tts_pattern:
        filename = tts_pattern.replace("{N}", str(scene_num))
        path = os.path.join(tts_dir, filename)
        if os.path.exists(path):
            return path
        return None

    patterns = [
        f"scene_{scene_num}_tts.mp3",
        f"scene_{scene_num}_combined.mp3",
        f"scene_{scene_num}.mp3",
    ]
    for pattern in patterns:
        path = os.path.join(tts_dir, pattern)
        if os.path.exists(path):
            return path
    return None


def _bake_tts_onto_video(
    video_path: str,
    tts_path: str,
    output_path: str,
    tts_volume: float = 1.0,
    sfx_volume: float = 0.7,
    preserve_sfx: bool = True,
) -> None:
    """Bake TTS audio onto a single video using FFmpeg amix."""
    if preserve_sfx:
        # Mix TTS + video SFX
        _ff.run([
            "-i", video_path,
            "-i", tts_path,
            "-filter_complex",
            f"[0:a]volume={sfx_volume}[sfx];"
            f"[1:a]volume={tts_volume}[tts];"
            "[sfx][tts]amix=inputs=2:duration=first:dropout_transition=600[out]",
            "-map", "0:v:0",
            "-map", "[out]",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            output_path,
        ])
    else:
        # Replace video audio with TTS
        _ff.run([
            "-i", video_path,
            "-i", tts_path,
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            output_path,
        ])


def concat_audio_files(audio_files: list[str], output_path: str, bitrate: str = "192k") -> str:
    """Concatenate multiple audio files using FFmpeg filter_complex.

    Unlike the concat demuxer, the filter_complex concat works reliably
    across different container formats (MP3, M4A, AAC, WAV).

    Args:
        audio_files: List of audio file paths (at least 2)
        output_path: Output file path
        bitrate: Audio bitrate (default: 192k)

    Returns:
        output_path on success

    Raises:
        VideoProcessingError: If concat fails
    """
    if len(audio_files) < 2:
        raise VideoProcessingError("concat_audio_files requires at least 2 files")

    for f in audio_files:
        if not os.path.exists(f):
            raise VideoProcessingError(f"Audio file not found: {f}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Build filter_complex: [0:a][1:a][2:a]concat=n=3:v=0:a=1[aout]
    inputs = []
    filter_parts = []
    for i, af in enumerate(audio_files):
        inputs.extend(["-i", af])
        filter_parts.append(f"[{i}:a]")

    filter_str = "".join(filter_parts) + f"concat=n={len(audio_files)}:v=0:a=1[aout]"

    cmd = [
        *inputs,
        "-filter_complex", filter_str,
        "-map", "[aout]",
        "-c:a", "aac", "-b:a", bitrate,
        output_path,
    ]

    logger.info("Concatenating %d audio files → %s", len(audio_files), output_path)
    _ff.run(cmd)

    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1000:
        raise VideoProcessingError(f"Audio concat produced invalid output: {output_path}")

    return output_path


def reorder_scene_files(scene_files: list[str], scene_order: list[int]) -> list[str]:
    """Reorder scene files according to a custom scene sequence.

    Maps scene numbers from filenames to the desired order. Scenes not
    in scene_order are excluded. Scene numbers in scene_order not found
    in files are skipped with a warning.

    Args:
        scene_files: List of video file paths (with scene_N in filename)
        scene_order: Custom sequence of scene numbers (e.g., [0, 35, 1, 2, 3])

    Returns:
        Reordered list of file paths
    """
    # Build scene_number → file path mapping
    scene_map: dict[int, str] = {}
    for f in scene_files:
        basename = os.path.basename(f)
        match = re.search(r"scene_(\d+)", basename)
        if match:
            scene_map[int(match.group(1))] = f

    reordered = []
    for num in scene_order:
        if num in scene_map:
            reordered.append(scene_map[num])
        else:
            logger.warning("Scene %d in --scene-order not found in files, skipping", num)

    if not reordered:
        logger.warning("No files matched scene_order — returning original order")
        return scene_files

    return reordered


def loop_audio_to_duration(
    audio_path: str,
    target_duration: float,
    output_path: str | None = None,
) -> str:
    """Loop an audio file to match a target duration.

    Uses FFmpeg -stream_loop to repeat the audio, then trims to exact duration.

    Args:
        audio_path: Input audio file
        target_duration: Target duration in seconds
        output_path: Output file path (default: {audio}_looped.ext)

    Returns:
        Output file path
    """
    if not os.path.exists(audio_path):
        raise VideoProcessingError(f"Audio file not found: {audio_path}")

    if not output_path:
        base, ext = os.path.splitext(audio_path)
        output_path = f"{base}_looped{ext}"

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Get source duration to calculate loops needed
    src_duration = get_video_duration(audio_path)
    if src_duration <= 0:
        logger.warning("Cannot determine audio duration, copying as-is")
        import shutil
        shutil.copy2(audio_path, output_path)
        return output_path

    if src_duration >= target_duration:
        # Audio is already long enough — just trim
        _ff.run([
            "-i", audio_path,
            "-t", str(target_duration),
            "-c:a", "aac", "-b:a", "192k",
            output_path,
        ])
    else:
        # Loop and trim
        loops = int(target_duration / src_duration) + 1
        logger.info("Looping audio %.1fs → %.1fs (%dx loop)", src_duration, target_duration, loops)
        _ff.run([
            "-stream_loop", str(loops),
            "-i", audio_path,
            "-t", str(target_duration),
            "-c:a", "aac", "-b:a", "192k",
            output_path,
        ])

    return output_path


def stitch_variations(
    videos_dir: str,
    output_path: str,
    audio_path: str | None = None,
    preserve_audio: bool = True,
    music_volume: float = 0.6,
    video_volume: float = 0.3,
    check_speech: bool = False,
    music_fade_out: float = 0.0,
    run_id: str | None = None,
    variations: int | None = None,
    use_run_dirs: bool = False,
    project_path: str | None = None,
    narration_path: str | None = None,
    narration_volume: float = 0.9,
    expected_scenes: int | None = None,
    transition: str | None = None,
    transition_duration: float = 0.5,
    sync_timestamps: str | None = None,
    sync_mode: str | None = None,
    overlay_path: str | None = None,
    overlay_position: str = "bottom-right",
    overlay_scale: float = 0.15,
    overlay_opacity: float = 0.8,
    overlay_margin: int = 20,
    logo_intro: str | None = None,
    logo_outro: str | None = None,
    mix_spec: str | None = None,
    cta_banner_path: str | None = None,
    cta_banner_timing: str = "last-10s",
    logo_intro_overlay_path: str | None = None,
    logo_intro_overlay_duration: float = 5.0,
    logo_intro_overlay_opacity: float = 0.5,
    logo_intro_overlay_fade: float = 0.5,
    logo_intro_overlay_scale: float = 0.3,
    exclude_mismatched: bool = False,
    force_resolution: tuple[int, int] | None = None,
    no_auto_scale: bool = False,
    veo_audio_scenes: set[int] | None = None,
    tts_dir: str | None = None,
    tts_volume: float = 1.0,
    sfx_volume: float = 0.7,
    preserve_sfx: bool = True,
    tts_pattern: str | None = None,
    scene_order: list[int] | None = None,
) -> dict[str, Any]:
    """Create stitched videos for each variation (1-4).

    Auto-detects the number of variations from files if not specified.
    Supports legacy _alt naming (2 variations) and new _vN naming (1-4 variations).

    v2.8: Now includes freshness validation to warn about stale videos
    from previous runs that may have been mixed in accidentally.

    Args:
        videos_dir: Directory containing scene videos
        output_path: Base output path for the stitched video
        audio_path: Optional background music file
        preserve_audio: If True, mix video audio with background music
        music_volume: Volume level for background music (0.0-1.0)
        video_volume: Volume level for original video audio (0.0-1.0)
        check_speech: If True, detect and auto-mute videos with speech
        music_fade_out: Duration in seconds to fade out music at the end
        run_id: Optional run ID to filter (e.g., "run001"). If None, auto-detects.
        variations: Number of variations to stitch (1-4). If None, auto-detects.
        use_run_dirs: If True, files don't have run prefix in names.
        project_path: Optional project path for freshness validation.
        narration_path: Optional narration audio file (from Phase 5b TTS).
        transition: FFmpeg xfade transition type (e.g., 'dissolve', 'fade'). None = hard cuts.
        transition_duration: Duration of each transition in seconds (default 0.5).
        narration_volume: Volume level for narration (0.0-1.0, default 0.9).
        mix_spec: Cherry-pick scenes from different runs (e.g., "run001:2 run002:*").
                  Uses scene 2 from run001, rest from run002. Overrides run_id.

    Returns:
        dict with results for each variation (keys: 1, 2, 3, 4 or 'primary', 'alt' for legacy).
    """
    results = {}
    use_mix_mode = bool(mix_spec)

    # Auto-detect run_id if not provided
    if run_id is None:
        run_id = get_latest_run_id(videos_dir, subdir=None)
        if run_id:
            logger.info("Auto-detected run: %s", run_id)

    # Auto-detect variations if not specified
    if variations is None:
        variations = detect_variations(videos_dir, run_id)
        if variations > 0:
            logger.info("Auto-detected variations: %d", variations)
        else:
            # Default to 1 if nothing detected
            variations = 1

    base, ext = os.path.splitext(output_path)
    output_basename = os.path.basename(base)
    output_dir = os.path.dirname(output_path)

    # Add run prefix to output if needed
    # When use_run_dirs=True, output goes to runs/{run_id}/final/ so no prefix needed
    if run_id and not use_run_dirs and not output_basename.startswith(run_id):
        base_with_run = os.path.join(output_dir, f"{run_id}_{output_basename}")
    else:
        base_with_run = base

    logger.info("=" * 50)
    if use_mix_mode:
        logger.info("MIX MODE: Cherry-picking scenes across runs")
        logger.info("Mix spec: %s", mix_spec)
    else:
        logger.info("MULTI-VARIATION MODE: Creating %d version(s)", variations)
        if run_id:
            logger.info("Run: %s", run_id)
    logger.info("=" * 50)

    # v2.8: Collect all video files and validate freshness before stitching
    all_stale_files = []
    all_warnings = []
    if project_path and run_id and TIMESTAMP_VALIDATION_AVAILABLE:
        # Gather all scene files across all variations for validation
        all_scene_files = []
        for v in range(1, variations + 1):
            files = get_scene_files(
                videos_dir, variation=v, run_id=run_id, total_variations=variations,
                use_run_dirs=use_run_dirs
            )
            all_scene_files.extend(files)

        if all_scene_files:
            _, all_stale_files, all_warnings = validate_videos_for_stitch(
                all_scene_files, run_id, project_path
            )
            if all_stale_files:
                print_stale_video_warning(all_stale_files, all_warnings, run_id)

    # Auto-offset narration for logo intro (v2.27)
    offset_temp_dir = None
    effective_narration_path = narration_path
    logo_duration = 0.0

    if logo_intro and os.path.exists(logo_intro) and narration_path and os.path.exists(narration_path):
        logo_duration = get_video_duration(logo_intro)
        if logo_duration > 0:
            logger.info("Auto-offsetting narration by %.1fs for logo intro", logo_duration)
            offset_temp_dir = tempfile.mkdtemp(prefix="narration_offset_")
            try:
                effective_narration_path = create_offset_narration(
                    narration_path, logo_duration, offset_temp_dir
                )
                logger.info("Offset narration: %s", effective_narration_path)

                # Pre-flight timing validation (v2.27)
                narration_orig_duration = get_video_duration(narration_path)
                # Calculate expected total video duration (all scenes)
                sample_files = get_scene_files(
                    videos_dir, variation=1, run_id=run_id, total_variations=variations,
                    use_run_dirs=use_run_dirs
                )
                if sample_files:
                    content_duration = sum(get_video_duration(f) for f in sample_files)
                    validate_timing(content_duration + logo_duration, narration_orig_duration, logo_duration)
            except Exception as e:
                logger.warning("Failed to create offset narration: %s", e)
                logger.warning("Falling back to original narration (may be out of sync)")
                effective_narration_path = narration_path

    # Process each variation
    stitch_start_time = time.time()
    for v in range(1, variations + 1):
        print_progress(v - 1, variations, f"v{v}/{variations}", stitch_start_time)
        # Get scene files for this variation
        if use_mix_mode:
            # Mix mode: cherry-pick scenes from different runs
            scene_files = get_mixed_scene_files(
                videos_dir, mix_spec=mix_spec, variation=v, total_variations=variations
            )
        else:
            # Normal mode: use single run
            scene_files = get_scene_files(
                videos_dir, variation=v, run_id=run_id, total_variations=variations,
                use_run_dirs=use_run_dirs
            )

        # Apply scene reordering if requested
        if scene_order and scene_files:
            scene_files = reorder_scene_files(scene_files, scene_order)
            logger.info("Scene order applied: %d files reordered", len(scene_files))

        # Build output path for this variation
        if variations == 1:
            var_output = f"{base_with_run}{ext}"
            label = "SINGLE"
        elif variations == 2:
            # Legacy naming for backwards compatibility
            if v == 1:
                var_output = f"{base_with_run}{ext}"
                label = "PRIMARY"
            else:
                var_output = f"{base_with_run}_alt{ext}"
                label = "ALT"
        else:
            # New variation naming
            var_output = f"{base_with_run}_v{v}{ext}"
            label = f"V{v}"

        # Validate expected scene count (v2.20)
        if expected_scenes is not None and scene_files and len(scene_files) != expected_scenes:
                logger.error("[%s] Expected %d scenes but found %d", label, expected_scenes, len(scene_files))
                logger.error("Found files:")
                for f in scene_files:
                    logger.error("  - %s", os.path.basename(f))
                results[v] = {"success": False, "error": f"Expected {expected_scenes} scenes, found {len(scene_files)}"}
                continue

        if scene_files:
            logger.info("[%s] Found %d scene files:", label, len(scene_files))
            for f in scene_files:
                logger.info("  - %s", os.path.basename(f))

            try:
                # Apply timing sync preprocessing if enabled
                files_to_stitch = scene_files
                sync_temp_dir = None
                if sync_timestamps and sync_mode:
                    sync_temp_dir = tempfile.mkdtemp(prefix="timing_sync_")
                    files_to_stitch = prepare_timing_sync_videos(
                        scene_files, sync_timestamps, sync_mode, sync_temp_dir
                    )

                # Mixed audio preprocessing (v2.32): bake TTS for non-Veo scenes
                mixed_audio_temps = []
                if veo_audio_scenes and tts_dir:
                    logger.info("Mixed audio: keeping Veo audio for scenes %s, baking TTS for rest",
                               sorted(veo_audio_scenes))
                    files_to_stitch, mixed_audio_temps = preprocess_mixed_audio_scenes(
                        files_to_stitch,
                        veo_audio_scenes=veo_audio_scenes,
                        tts_dir=tts_dir,
                        tts_volume=tts_volume,
                        sfx_volume=sfx_volume,
                        preserve_sfx=preserve_sfx,
                        tts_pattern=tts_pattern,
                    )

                # Prepend/append logo animation clips
                if logo_intro and os.path.exists(logo_intro):
                    files_to_stitch = [logo_intro] + files_to_stitch
                    logger.info("Logo intro prepended: %s", os.path.basename(logo_intro))
                if logo_outro and os.path.exists(logo_outro):
                    files_to_stitch = files_to_stitch + [logo_outro]
                    logger.info("Logo outro appended: %s", os.path.basename(logo_outro))

                result = stitch_videos(
                    files_to_stitch,
                    var_output,
                    audio_path,
                    preserve_audio=preserve_audio,
                    music_volume=music_volume,
                    video_volume=video_volume,
                    check_speech=check_speech,
                    music_fade_out=music_fade_out,
                    narration_path=effective_narration_path,  # Use offset narration for logo intro
                    narration_volume=narration_volume,
                    transition=transition,
                    transition_duration=transition_duration,
                    overlay_path=overlay_path,
                    overlay_position=overlay_position,
                    overlay_scale=overlay_scale,
                    overlay_opacity=overlay_opacity,
                    overlay_margin=overlay_margin,
                    cta_banner_path=cta_banner_path,
                    cta_banner_timing=cta_banner_timing,
                    logo_intro_overlay_path=logo_intro_overlay_path,
                    logo_intro_overlay_duration=logo_intro_overlay_duration,
                    logo_intro_overlay_opacity=logo_intro_overlay_opacity,
                    logo_intro_overlay_fade=logo_intro_overlay_fade,
                    logo_intro_overlay_scale=logo_intro_overlay_scale,
                    exclude_mismatched=exclude_mismatched,
                    force_resolution=force_resolution,
                    no_auto_scale=no_auto_scale,
                )
                logger.info("[%s] Created: %s", label, var_output)
                results[v] = result

                # Legacy compatibility keys
                if variations == 2:
                    if v == 1:
                        results['primary'] = result
                    else:
                        results['alt'] = result
            except Exception as e:
                logger.error("[%s] Error: %s", label, e)
                results[v] = {"success": False, "error": str(e)}
            finally:
                # Cleanup mixed audio temp files
                for tmp in mixed_audio_temps:
                    with contextlib.suppress(Exception):
                        if os.path.isdir(tmp):
                            import shutil as _shutil
                            _shutil.rmtree(tmp)
                        elif os.path.isfile(tmp):
                            os.remove(tmp)
        else:
            logger.warning("[%s] No scene files found for variation %d", label, v)
            results[v] = {"success": False, "error": f"No scene files for variation {v}"}

    print_progress(variations, variations, "done", stitch_start_time)
    print()  # newline after progress bar

    # Cleanup offset narration temp directory
    if offset_temp_dir and os.path.isdir(offset_temp_dir):
        import shutil
        with contextlib.suppress(Exception):
            shutil.rmtree(offset_temp_dir)

    return results


def stitch_dual(
    videos_dir: str,
    output_path: str,
    audio_path: str | None = None,
    preserve_audio: bool = True,
    music_volume: float = 0.6,
    video_volume: float = 0.3,
    check_speech: bool = False,
    music_fade_out: float = 0.0,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Legacy function: Create both primary and alt versions.

    This is a wrapper around stitch_variations for backwards compatibility.
    """
    return stitch_variations(
        videos_dir=videos_dir,
        output_path=output_path,
        audio_path=audio_path,
        preserve_audio=preserve_audio,
        music_volume=music_volume,
        video_volume=video_volume,
        check_speech=check_speech,
        music_fade_out=music_fade_out,
        run_id=run_id,
        variations=2,  # Legacy dual mode = 2 variations
    )


def print_dry_run_preview(
    scene_files: list[str],
    output_path: str,
    audio_path: str | None = None,
    music_volume: float = 0.6,
    video_volume: float = 0.3,
    music_fade_out: float = 3.0,
    narration_path: str | None = None,
    narration_volume: float = 0.9,
    variations: int = 1,
    logo_intro: str | None = None,
    logo_outro: str | None = None,
    overlay_path: str | None = None,
    overlay_position: str = "bottom-right",
    overlay_scale: float = 0.15,
    overlay_opacity: float = 0.8,
    cta_banner_path: str | None = None,
    cta_banner_timing: str = "last-10s",
    transition: str | None = None,
    transition_duration: float = 0.5,
    preset_name: str | None = None,
) -> None:
    """Print a dry-run preview of the stitch plan without running FFmpeg."""
    sep = "=" * 60
    print(f"\n{sep}")
    print("STITCH DRY-RUN PREVIEW")
    print(sep)

    # Scene list with durations
    total_duration = 0.0
    print(f"\nScenes ({len(scene_files)} files):")
    for i, f in enumerate(scene_files, 1):
        basename = os.path.basename(f)
        try:
            dur = get_video_duration(f)
        except Exception:
            dur = 0.0
        total_duration += dur
        if dur > 0:
            print(f"  {i:>3}. {basename:<40s} [{dur:.1f}s]")
        else:
            print(f"  {i:>3}. {basename:<40s} [?.?s]")

    # Account for transitions shortening total duration
    if transition and transition != "none" and len(scene_files) > 1:
        overlap = transition_duration * (len(scene_files) - 1)
        effective_duration = total_duration - overlap
        print(f"\n  Raw total:       {total_duration:.1f}s")
        print(f"  Transitions:     -{overlap:.1f}s ({len(scene_files) - 1} x {transition_duration:.1f}s {transition})")
        print(f"  Effective total: {effective_duration:.1f}s")
    else:
        print(f"\n  Total duration: {total_duration:.1f}s")

    # Audio mix
    if audio_path or narration_path:
        print("\nAudio Mix:")
        if audio_path:
            print(f"  Background music: {audio_path}")
            preset_label = preset_name if preset_name else "default"
            print(f"  Preset: {preset_label} (music={int(music_volume * 100)}%, video={int(video_volume * 100)}%)")
            if music_fade_out > 0:
                print(f"  Fade-out: {music_fade_out:.1f}s")
        if narration_path:
            print(f"\n  Narration: {narration_path} (volume: {narration_volume})")

    # Extras
    extras = []
    if logo_intro:
        extras.append(f"  Logo intro: {logo_intro}")
    if logo_outro:
        extras.append(f"  Logo outro: {logo_outro}")
    if overlay_path:
        extras.append(f"  Overlay: {overlay_path} ({overlay_position}, {int(overlay_scale * 100)}%, opacity={overlay_opacity})")
    if cta_banner_path:
        extras.append(f"  CTA banner: {cta_banner_path} (timing: {cta_banner_timing})")
    if transition and transition != "none":
        extras.append(f"  Transition: {transition} ({transition_duration:.1f}s)")

    if extras:
        print("\nExtras:")
        for line in extras:
            print(line)

    # Output
    print(f"\nOutput: {output_path}")
    if variations > 1:
        base, ext = os.path.splitext(output_path)
        if variations == 2:
            print(f"  Variations: 2 (primary: {os.path.basename(base)}{ext}, alt: {os.path.basename(base)}_alt{ext})")
        else:
            suffixes = ", ".join(f"_v{v}{ext}" for v in range(1, variations + 1))
            print(f"  Variations: {variations} ({suffixes})")

    print(sep + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Stitch video segments together")

    # Input options
    parser.add_argument("--scenes", help="Comma-separated list of video files")
    parser.add_argument("--pattern", help="Glob pattern for video files (e.g., 'videos/scene_*.mp4')")
    parser.add_argument("--videos-dir", help="Directory containing scene videos (for --dual mode)")

    # Output options
    parser.add_argument("--output", required=True, help="Output video path")
    parser.add_argument("--variations", type=int, choices=[1, 2, 3, 4],
                       help="Number of variations to stitch (auto-detected if not specified)")
    parser.add_argument("--dual", action="store_true",
                       help="[DEPRECATED] Use --variations 2. Create both primary and alt versions (requires --videos-dir)")
    parser.add_argument("--version", type=str, default=None,
                       help="Version label for output (e.g., 'serious', 'comedy'). "
                            "Output goes to final/v{N}_{label}/ subdirectory. "
                            "Use 'list' to show existing versions and exit. "
                            "Also accepts explicit 'v3_remix' with number included.")

    # Audio options
    parser.add_argument("--audio", help="Optional audio file to add")
    parser.add_argument("--preserve-audio", action="store_true", default=True,
                       help="Preserve original video audio and mix with background music (default)")
    parser.add_argument("--no-preserve-audio", action="store_true",
                       help="Replace video audio with background music (old behavior)")
    parser.add_argument("--audio-preset", choices=["ambient", "presenter", "narrated"],
                       help="Audio volume preset: ambient (music=60%%, video=30%%), "
                            "presenter (music=25%%, video=85%%), narrated (music=15%%, video=85%%)")
    parser.add_argument("--presenter", action="store_true",
                       help="Presenter/voice-over mode: prioritize voice (music=0.25, video=0.85)")
    parser.add_argument("--narrated", action="store_true",
                       help="Narrated content mode: subtle music under narration (music=0.15, video=0.85)")
    parser.add_argument("--music-volume", type=float, default=None,
                       help="Background music volume (0.0-1.0, default: 0.6, or 0.25 with --presenter)")
    parser.add_argument("--video-volume", type=float, default=None,
                       help="Video audio/voice volume (0.0-1.0, default: 0.3, or 0.85 with --presenter)")
    parser.add_argument("--music-fade-out", type=float, default=3.0,
                       help="Fade out music at end (seconds, default: 3.0, 0=disabled)")
    parser.add_argument("--music-mood",
                       help="Print a generate_music.py command for the given mood (does NOT generate — outputs command only)")
    parser.add_argument("--check-speech", action="store_true",
                       help="Detect and auto-mute videos with speech")

    # Narration (Phase 5b TTS)
    parser.add_argument("--narration", dest="narration_path",
                       help="Narration audio file (from Phase 5b TTS, e.g., audio/narration.mp3)")
    parser.add_argument("--narration-volume", type=float, default=0.9,
                       help="Narration volume (0.0-1.0, default: 0.9)")

    # Conductor: auto-generate master narration from per-scene TTS
    parser.add_argument("--auto-narration", action="store_true",
                       help="Auto-generate master narration track using Narration Conductor "
                            "(requires --tts-dir). Replaces per-scene baking with composition-aware timing.")

    # Mixed audio sources (v2.32: keep Veo audio for some scenes, TTS for others)
    parser.add_argument("--veo-audio-scenes",
                       help="Comma-separated scene numbers that should keep Veo's original audio "
                            "(e.g. lip-synced dialogue scenes). Other scenes get TTS baked in.")
    parser.add_argument("--tts-dir",
                       help="Directory containing per-scene TTS files (required with --veo-audio-scenes)")

    # Transitions (xfade between scenes)
    parser.add_argument("--transition", default=None,
                       help="FFmpeg xfade transition between scenes (e.g., dissolve, fade, wipeleft, slideright). "
                            "Makes scenes blend together instead of hard cuts.")
    parser.add_argument("--transition-duration", type=float, default=0.5,
                       help="Duration of each transition in seconds (default: 0.5)")

    # Watermark / logo overlay
    parser.add_argument("--overlay",
                       help="Path to overlay image (transparent PNG for watermark/logo)")
    parser.add_argument("--overlay-position",
                       choices=["bottom-right", "bottom-left", "top-right", "top-left"],
                       default="bottom-right",
                       help="Position for overlay image (default: bottom-right)")
    parser.add_argument("--overlay-scale", type=float, default=0.15,
                       help="Overlay scale as fraction of video width (default: 0.15)")
    parser.add_argument("--overlay-opacity", type=float, default=0.8,
                       help="Overlay opacity 0.0-1.0 (default: 0.8)")
    parser.add_argument("--overlay-margin", type=int, default=20,
                       help="Overlay margin from edge in pixels (default: 20)")

    # Logo animation intro/outro (Phase 5.5)
    parser.add_argument("--logo-intro",
                       help="Path to logo animation video to prepend before first scene")
    parser.add_argument("--logo-outro",
                       help="Path to logo animation video to append after last scene")

    # CTA Banner overlay (Phase 7)
    parser.add_argument("--cta-banner",
                       help="Path to CTA banner video (WebM with transparency, from Remotion)")
    parser.add_argument("--cta-banner-timing", default="last-10s",
                       help="When to show CTA banner: entire, last-5s, last-10s, custom-N (default: last-10s)")

    # Logo intro overlay (v2.28) - centered logo with fade in/out
    parser.add_argument("--logo-intro-overlay",
                       help="Path to logo image to overlay at start of video (centered, with fade)")
    parser.add_argument("--logo-intro-overlay-duration", type=float, default=5.0,
                       help="How long to show logo intro overlay (seconds, default: 5.0)")
    parser.add_argument("--logo-intro-overlay-opacity", type=float, default=0.5,
                       help="Logo intro overlay opacity (0.0-1.0, default: 0.5)")
    parser.add_argument("--logo-intro-overlay-fade", type=float, default=0.5,
                       help="Fade in/out duration for logo overlay (seconds, default: 0.5)")
    parser.add_argument("--logo-intro-overlay-scale", type=float, default=0.3,
                       help="Logo intro overlay scale (fraction of video width, default: 0.3)")

    # Branding module integration (v2.28)
    parser.add_argument("--brand",
                       help="Load brand settings from library (logo, colors, animation preferences)")
    parser.add_argument("--list-brands", action="store_true",
                       help="List available brands in the library")

    # Presentation mode: timing sync
    parser.add_argument("--sync-timestamps",
                       help="Path to slides.json with per-scene durations for timing sync (PRESENTATION mode)")
    sync_group = parser.add_mutually_exclusive_group()
    sync_group.add_argument("--freeze-first", action="store_true",
                           help="Freeze on first frame before animation (Cinematic style). Requires --sync-timestamps.")
    sync_group.add_argument("--loop-fill", action="store_true",
                           help="Loop clip to fill target duration (Dynamic style). Requires --sync-timestamps.")

    # Validation
    parser.add_argument("--expected-scenes", type=int, default=None,
                       help="Expected number of scenes. Errors if found count doesn't match (e.g., --expected-scenes 7)")
    parser.add_argument("--exclude-mismatched", action="store_true",
                       help="Auto-exclude videos with different dimensions from majority")
    parser.add_argument("--force-resolution", type=str, default=None,
                       help="Rescale all videos to WxH before stitching (e.g., --force-resolution 1280x720)")
    parser.add_argument("--target-resolution", type=str, default=None,
                       help="Override auto-detected target resolution for auto-scaling (e.g., --target-resolution 1280x720). "
                            "By default the first video's resolution is used as target.")
    parser.add_argument("--no-auto-scale", action="store_true",
                       help="Disable automatic resolution scaling. Fail with error if videos have different dimensions.")

    # Run versioning
    parser.add_argument("--run", dest="run_id",
                       help="Specific run ID to stitch (e.g., 'run001'). If not specified, auto-detects latest run.")
    parser.add_argument("--mix", type=str, default=None,
                       help="Cherry-pick scenes across runs: 'run001:2 run002:*' uses scene 2 from run001, rest from run002")

    # Audio file concatenation
    parser.add_argument("--audio-files", nargs="+",
                       help="Multiple audio files to concatenate before mixing (e.g., bg1.mp3 bg2.mp3 bg3.mp3)")
    # Scene reordering
    parser.add_argument("--scene-order",
                       help="Custom scene sequence (comma-separated scene numbers, e.g., '0,35,1,2,3,36,4,5,99')")
    # Music looping
    parser.add_argument("--music-loop", action="store_true",
                       help="Auto-loop background music to match total video duration")

    # Run isolation (new directory structure)
    parser.add_argument("--use-run-dirs", action="store_true",
                       help="Use new run subdirectory structure: runs/{run_id}/videos/. "
                            "Files don't have run prefix in names.")
    parser.add_argument("--project-path",
                       help="Path to project directory (required for --use-run-dirs)")

    # Color grading (cherry-picked from short-movie-maker)
    parser.add_argument("--color-grade",
                       help="Apply FFmpeg color grading filter. Accepts a genre name (drama, thriller, comedy, "
                            "sci-fi, horror, romance, action) or a named preset (nolan, warm-cinematic, noir, pastel)")

    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose/debug logging")
    parser.add_argument("--dry-run", action="store_true",
                       help="Preview stitch plan without encoding (shows scene order, durations, audio mix)")

    args = parser.parse_args()

    # Re-initialize logger with verbose flag if requested
    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    # Resolve --audio-preset to existing flags
    if args.audio_preset:
        if args.presenter or args.narrated:
            logger.error("--audio-preset cannot be combined with --presenter or --narrated")
            sys.exit(1)
        if args.audio_preset == "presenter":
            args.presenter = True
        elif args.audio_preset == "narrated":
            args.narrated = True
        # "ambient" is the default, no flag needed

    # Handle --list-brands
    if args.list_brands:
        print("\nAvailable brands in library:")
        if HAS_BRANDING:
            brands = list_brands()
            if brands:
                for brand in brands:
                    print(f"  - {brand}")
            else:
                print("  (No saved brands)")
        else:
            print("  (Branding module not available)")
        return

    # Handle --version list
    if args.version == "list":
        output_dir_v = os.path.dirname(args.output) or "."
        project_path_for_list = output_dir_v
        candidate = output_dir_v
        for _ in range(4):
            if os.path.exists(os.path.join(candidate, "manifest.json")):
                project_path_for_list = candidate
                break
            parent = os.path.dirname(candidate)
            if parent == candidate:
                break
            candidate = parent

        if RUN_MANAGEMENT_AVAILABLE:
            versions = list_versions(project_path_for_list)
        else:
            versions = []

        final_dir_v = os.path.join(project_path_for_list, "final")
        if not os.path.isdir(final_dir_v):
            final_dir_v = output_dir_v

        if RUN_MANAGEMENT_AVAILABLE:
            dir_versions = scan_existing_versions(final_dir_v)
        else:
            dir_versions = []

        print(f"\n{'='*60}")
        print("PROJECT VERSIONS")
        print(f"{'='*60}")

        if versions:
            print(f"\n{'No.':<6}{'Label':<20}{'Output':<40}{'Created'}")
            print("-" * 80)
            for v in versions:
                print(
                    f"v{v['number']:<5}{v['label']:<20}"
                    f"{v['output']:<40}{v.get('created', 'N/A')}"
                )
        elif dir_versions:
            print(f"\n{'No.':<6}{'Label':<20}{'Directory'}")
            print("-" * 50)
            for v in dir_versions:
                print(f"v{v['number']:<5}{v['label']:<20}{v['dir']}")
        else:
            print("\n  No versions found.")
            print(f"  Checked: {final_dir_v}")

        print()
        return

    # Music mood hint
    if args.music_mood:
        # Calculate total duration from videos
        if args.videos_dir and os.path.isdir(args.videos_dir):
            total_dur = 0
            for f in sorted(os.listdir(args.videos_dir)):
                if f.endswith(('.mp4', '.mov', '.webm')):
                    try:
                        dur = get_video_duration(os.path.join(args.videos_dir, f))
                        if dur > 0:
                            total_dur += dur
                    except Exception:
                        pass
            duration = int(total_dur) if total_dur > 0 else 60
        else:
            duration = 60

        scripts_dir = os.path.dirname(os.path.abspath(__file__))
        # User-facing command hint (kept as print for copy-paste)
        print(f"\n{'='*60}")
        print("MUSIC COMMAND (copy & run separately)")
        print(f"{'='*60}")
        print("This flag does NOT generate music. Run this command first:")
        print(f"  python {os.path.join(scripts_dir, 'generate_music.py')} \\")
        print(f"    --prompt \"{args.music_mood}\" \\")
        print(f"    --duration {duration} \\")
        print("    --output music.mp3")
        print(f"\nTip: After generating music, re-run stitch with:")
        print(f"  --audio <path-to-generated-music.mp3>")
        print(f"{'='*60}\n")

        sys.exit(0)

    # Load brand settings if specified
    brand_config = None
    brand_dir = None
    if args.brand:
        if not HAS_BRANDING:
            logger.warning("Branding module not available, --brand ignored")
        else:
            brand_config = load_brand(args.brand)
            if brand_config:
                brand_dir = get_brand_dir(args.brand)
                logger.info("Loaded brand: %s", args.brand)
                # Auto-populate settings from brand
                if not args.overlay and brand_config.logos.icon:
                    args.overlay = str(brand_dir / brand_config.logos.icon)
                    logger.info("Using brand logo for watermark: %s", args.overlay)
                if not args.logo_intro and brand_config.animation.cached_intro:
                    args.logo_intro = str(brand_dir / brand_config.animation.cached_intro)
                    logger.info("Using brand cached intro: %s", args.logo_intro)
                if not args.logo_outro and brand_config.animation.cached_outro:
                    args.logo_outro = str(brand_dir / brand_config.animation.cached_outro)
                    logger.info("Using brand cached outro: %s", args.logo_outro)
                if not args.logo_intro_overlay and (brand_config.logos.full or brand_config.logos.horizontal):
                    logo_for_overlay = brand_config.logos.full or brand_config.logos.horizontal
                    args.logo_intro_overlay = str(brand_dir / logo_for_overlay)
                    logger.info("Using brand logo for intro overlay: %s", args.logo_intro_overlay)
            else:
                logger.warning("Brand '%s' not found in library", args.brand)

    # Handle preserve_audio flag
    preserve_audio = True
    if args.no_preserve_audio:
        preserve_audio = False

    # Mutual exclusivity check: --presenter and --narrated
    if args.presenter and args.narrated:
        logger.error("--presenter and --narrated are mutually exclusive. Choose one.")
        sys.exit(1)

    # Determine volume levels based on mode
    # --presenter mode: prioritize voice (low music, high voice)
    # --narrated mode: subtle music under narration (very low music, high voice)
    # Default mode: ambient/B-roll (balanced mix)
    if args.narrated:
        default_music = 0.15
        default_video = 0.85
        logger.info("Narrated mode: subtle music under narration")
    elif args.presenter:
        default_music = 0.25
        default_video = 0.85
        logger.info("Presenter mode: prioritizing voice over music")
    else:
        default_music = 0.6
        default_video = 0.3

    # Allow explicit overrides
    music_volume = args.music_volume if args.music_volume is not None else default_music
    video_volume = args.video_volume if args.video_volume is not None else default_video

    # Validate volume levels
    music_volume = max(0.0, min(1.0, music_volume))
    video_volume = max(0.0, min(1.0, video_volume))
    music_fade_out = max(0.0, min(30.0, args.music_fade_out))  # Cap at 30 seconds

    # Handle --audio-files: concatenate multiple audio files into one
    audio_files_temp = None
    if args.audio_files:
        if args.audio:
            logger.error("--audio-files and --audio are mutually exclusive")
            sys.exit(1)
        if len(args.audio_files) < 2:
            # Single file — just use it directly
            args.audio = args.audio_files[0]
        else:
            # Validate all files exist
            missing_af = [f for f in args.audio_files if not os.path.exists(f)]
            if missing_af:
                logger.error("Audio files not found: %s", missing_af)
                sys.exit(1)
            # Concatenate into temp file
            audio_files_temp = tempfile.mktemp(suffix=".m4a", prefix="concat_audio_")
            try:
                concat_audio_files(args.audio_files, audio_files_temp)
                args.audio = audio_files_temp
                logger.info("Concatenated %d audio files → %s", len(args.audio_files), audio_files_temp)
            except Exception as e:
                logger.error("Failed to concatenate audio files: %s", e)
                sys.exit(1)

    # Parse --scene-order
    scene_order = None
    if args.scene_order:
        try:
            scene_order = [int(s.strip()) for s in args.scene_order.split(",")]
            logger.info("Custom scene order: %s", scene_order)
        except ValueError:
            logger.error("--scene-order must be comma-separated integers (e.g., '0,35,1,2,3')")
            sys.exit(1)

    # Parse --force-resolution WxH
    force_resolution = None
    if args.force_resolution:
        try:
            parts = args.force_resolution.lower().split("x")
            if len(parts) != 2:
                raise ValueError("expected WxH format")
            force_resolution = (int(parts[0]), int(parts[1]))
            if force_resolution[0] <= 0 or force_resolution[1] <= 0:
                raise ValueError("width and height must be positive")
            logger.info("Force resolution: %dx%d", force_resolution[0], force_resolution[1])
        except ValueError as e:
            logger.error("Invalid --force-resolution '%s': %s. Expected format: WxH (e.g., 1280x720)",
                        args.force_resolution, e)
            sys.exit(1)

    # Parse --target-resolution WxH (override for auto-scale target)
    target_resolution = None
    if args.target_resolution:
        try:
            parts = args.target_resolution.lower().split("x")
            if len(parts) != 2:
                raise ValueError("expected WxH format")
            target_resolution = (int(parts[0]), int(parts[1]))
            if target_resolution[0] <= 0 or target_resolution[1] <= 0:
                raise ValueError("width and height must be positive")
            logger.info("Target resolution for auto-scale: %dx%d",
                        target_resolution[0], target_resolution[1])
        except ValueError as e:
            logger.error("Invalid --target-resolution '%s': %s. Expected format: WxH (e.g., 1280x720)",
                        args.target_resolution, e)
            sys.exit(1)

    # Handle --no-auto-scale
    no_auto_scale = getattr(args, "no_auto_scale", False)

    # Validate transition
    transition = args.transition
    transition_duration = max(0.1, min(3.0, args.transition_duration))
    if transition and transition != "none" and transition not in VALID_XFADE_TRANSITIONS:
        logger.error("Unknown transition '%s'", transition)
        logger.error("Valid transitions: %s", ', '.join(VALID_XFADE_TRANSITIONS))
        sys.exit(1)

    # Check if speech detection is available
    if args.check_speech and not AUDIO_UTILS_AVAILABLE:
        logger.warning("--check-speech requires audio_utils.py (not found)")
        logger.warning("Continuing without speech detection")

    # Validate timing sync flags
    sync_mode = None
    if args.freeze_first or args.loop_fill:
        if not args.sync_timestamps:
            logger.error("--freeze-first and --loop-fill require --sync-timestamps")
            sys.exit(1)
        sync_mode = "freeze-first" if args.freeze_first else "loop-fill"
    if args.sync_timestamps:
        if not os.path.exists(args.sync_timestamps):
            logger.error("Slides JSON not found: %s", args.sync_timestamps)
            sys.exit(1)
        if not sync_mode:
            # Default to freeze-first if no mode specified
            sync_mode = "freeze-first"
            logger.info("--sync-timestamps without --freeze-first or --loop-fill, defaulting to --freeze-first")

    # Handle --version: redirect output to versioned subdirectory
    version_info = None  # Will hold (number, label, dir, project_path) if active
    if args.version and args.version != "list" and RUN_MANAGEMENT_AVAILABLE:
        output_parent = os.path.dirname(args.output) or "."
        if os.path.basename(output_parent) == "final":
            final_dir_base = output_parent
        else:
            final_dir_base = output_parent

        version_project_path = getattr(args, "project_path", None)
        if not version_project_path:
            candidate = output_parent
            for _ in range(4):
                if os.path.exists(os.path.join(candidate, "manifest.json")):
                    version_project_path = candidate
                    break
                parent = os.path.dirname(candidate)
                if parent == candidate:
                    break
                candidate = parent

        ver_dir, ver_num, ver_label = resolve_version_dir(
            final_dir_base, args.version,
        )
        output_basename = os.path.basename(args.output)
        args.output = os.path.join(ver_dir, output_basename)
        version_info = (ver_num, ver_label, ver_dir, version_project_path)
        logger.info(
            "Version output: v%d_%s -> %s", ver_num, ver_label, ver_dir,
        )

    # Determine if we're in multi-variation mode
    # --dual is legacy shorthand for --variations 2
    # --variations N allows 1-4 variations
    # If neither specified but --videos-dir given, auto-detect
    variations_mode = args.variations is not None or args.dual or args.videos_dir

    if variations_mode:
        if not args.videos_dir:
            logger.error("--variations/--dual requires --videos-dir")
            sys.exit(1)

        if not os.path.isdir(args.videos_dir):
            logger.error("Videos directory not found: %s", args.videos_dir)
            sys.exit(1)

        # Determine variation count
        if args.variations is not None:
            num_variations = args.variations
        elif args.dual:
            # Legacy --dual flag = 2 variations
            logger.warning("--dual is deprecated. Use --variations 2 instead.")
            num_variations = 2
        else:
            # Auto-detect from files
            num_variations = None  # stitch_variations will auto-detect

        # Handle run directory structure
        use_run_dirs = getattr(args, "use_run_dirs", False)
        videos_dir = args.videos_dir
        output_path = args.output
        project_path = getattr(args, "project_path", None)

        if use_run_dirs:
            if not project_path:
                logger.error("--use-run-dirs requires --project-path")
                sys.exit(1)
            if args.run_id:
                # Use specified run
                videos_dir = os.path.join(project_path, "runs", args.run_id, "videos")
                output_dir = os.path.join(project_path, "runs", args.run_id, "final")
                os.makedirs(output_dir, exist_ok=True)
                output_path = os.path.join(output_dir, os.path.basename(args.output))
                logger.info("Using run subdirectories:")
                logger.info("  Videos: %s", videos_dir)
                logger.info("  Output: %s", output_dir)

        # v2.8: Infer project_path from videos_dir if not specified
        # This enables freshness validation for legacy usage without --project-path
        if not project_path and videos_dir:
            # videos_dir is usually projects/{slug}/videos or runs/{run}/videos
            parent_dir = os.path.dirname(videos_dir)
            if os.path.basename(parent_dir) == "runs":
                # New structure: projects/{slug}/runs/{run}/videos
                project_path = os.path.dirname(parent_dir)
            elif os.path.exists(os.path.join(parent_dir, "manifest.json")):
                # Legacy structure: projects/{slug}/videos
                project_path = parent_dir

        # Validate narration path
        narration_path = getattr(args, "narration_path", None)
        narration_volume = max(0.0, min(1.0, getattr(args, "narration_volume", 0.9)))
        if narration_path and not os.path.exists(narration_path):
            logger.error("Narration file not found: %s", narration_path)
            sys.exit(1)

        # Dry-run: preview stitch plan without encoding
        if args.dry_run:
            # Auto-detect run_id for file discovery
            dry_run_id = args.run_id
            if dry_run_id is None:
                dry_run_id = get_latest_run_id(videos_dir, subdir=None)

            # Auto-detect variation count
            dry_variations = num_variations
            if dry_variations is None:
                dry_variations = detect_variations(videos_dir, dry_run_id)
                if dry_variations <= 0:
                    dry_variations = 1

            # Determine preset name for display
            if args.narrated:
                preset_name = "narrated (music=15%, video=85%)"
            elif args.presenter:
                preset_name = "presenter (music=25%, video=85%)"
            else:
                preset_name = "default (music=60%, video=30%)"

            # Show preview for first variation (representative)
            mix_spec = getattr(args, "mix", None)
            if mix_spec:
                scene_files = get_mixed_scene_files(
                    videos_dir, mix_spec=mix_spec, variation=1, total_variations=dry_variations
                )
            else:
                scene_files = get_scene_files(
                    videos_dir, variation=1, run_id=dry_run_id,
                    total_variations=dry_variations, use_run_dirs=use_run_dirs
                )

            if not scene_files:
                logger.error("No scene files found for dry-run preview")
                sys.exit(1)

            print_dry_run_preview(
                scene_files=scene_files,
                output_path=output_path,
                audio_path=args.audio,
                music_volume=music_volume,
                video_volume=video_volume,
                music_fade_out=music_fade_out,
                narration_path=narration_path,
                narration_volume=narration_volume,
                variations=dry_variations,
                logo_intro=getattr(args, "logo_intro", None),
                logo_outro=getattr(args, "logo_outro", None),
                overlay_path=getattr(args, "overlay", None),
                overlay_position=getattr(args, "overlay_position", "bottom-right"),
                overlay_scale=getattr(args, "overlay_scale", 0.15),
                overlay_opacity=getattr(args, "overlay_opacity", 0.8),
                cta_banner_path=getattr(args, "cta_banner", None),
                cta_banner_timing=getattr(args, "cta_banner_timing", "last-10s"),
                transition=transition,
                transition_duration=transition_duration,
                preset_name=preset_name,
            )
            return

        # Parse --veo-audio-scenes or auto-detect from lip_sync_scenes.json
        veo_audio_scenes = None
        stitch_tts_dir = getattr(args, "tts_dir", None)
        if getattr(args, "veo_audio_scenes", None):
            veo_audio_scenes = {int(s.strip()) for s in args.veo_audio_scenes.split(",")}
        elif videos_dir:
            # Auto-detect from lip_sync_scenes.json metadata
            lip_sync_path = os.path.join(videos_dir, "lip_sync_scenes.json")
            if os.path.exists(lip_sync_path):
                try:
                    with open(lip_sync_path) as lf:
                        lip_sync_data = json.load(lf)
                    veo_audio_scenes = set(lip_sync_data.get("scenes", []))
                    if not stitch_tts_dir:
                        stitch_tts_dir = lip_sync_data.get("tts_dir")
                    if veo_audio_scenes:
                        logger.info("Auto-detected lip-sync scenes from metadata: %s", sorted(veo_audio_scenes))
                except (json.JSONDecodeError, KeyError):
                    pass

        if veo_audio_scenes and not stitch_tts_dir:
            logger.error("--veo-audio-scenes requires --tts-dir (or lip_sync_scenes.json must contain tts_dir)")
            sys.exit(1)

        # Handle --music-loop: loop audio to match total video duration
        music_loop_temp = None
        if args.music_loop and args.audio and os.path.exists(args.audio):
            # Calculate total video duration from scene files
            sample_files = get_scene_files(
                videos_dir, variation=1, run_id=args.run_id,
                total_variations=num_variations or 1, use_run_dirs=use_run_dirs
            )
            if sample_files:
                total_video_dur = sum(get_video_duration(f) for f in sample_files)
                # Add logo intro/outro durations
                if getattr(args, "logo_intro", None) and os.path.exists(args.logo_intro):
                    total_video_dur += get_video_duration(args.logo_intro)
                if getattr(args, "logo_outro", None) and os.path.exists(args.logo_outro):
                    total_video_dur += get_video_duration(args.logo_outro)

                audio_dur = get_video_duration(args.audio)
                if audio_dur < total_video_dur:
                    music_loop_temp = tempfile.mktemp(suffix=".m4a", prefix="music_looped_")
                    try:
                        loop_audio_to_duration(args.audio, total_video_dur, music_loop_temp)
                        args.audio = music_loop_temp
                        logger.info("Looped music %.1fs → %.1fs to match video", audio_dur, total_video_dur)
                    except Exception as e:
                        logger.warning("Music loop failed: %s — using original audio", e)
                else:
                    logger.info("Music (%.1fs) already covers video (%.1fs), no loop needed",
                               audio_dur, total_video_dur)

        results = stitch_variations(
            videos_dir,
            output_path,
            args.audio,
            preserve_audio=preserve_audio,
            music_volume=music_volume,
            video_volume=video_volume,
            run_id=args.run_id,
            check_speech=args.check_speech,
            music_fade_out=music_fade_out,
            variations=num_variations,
            use_run_dirs=use_run_dirs,
            project_path=project_path,
            narration_path=narration_path,
            narration_volume=narration_volume,
            expected_scenes=args.expected_scenes,
            transition=transition,
            transition_duration=transition_duration,
            sync_timestamps=args.sync_timestamps,
            sync_mode=sync_mode,
            overlay_path=getattr(args, "overlay", None),
            overlay_position=getattr(args, "overlay_position", "bottom-right"),
            overlay_scale=getattr(args, "overlay_scale", 0.15),
            overlay_opacity=getattr(args, "overlay_opacity", 0.8),
            overlay_margin=getattr(args, "overlay_margin", 20),
            logo_intro=getattr(args, "logo_intro", None),
            logo_outro=getattr(args, "logo_outro", None),
            mix_spec=getattr(args, "mix", None),
            cta_banner_path=getattr(args, "cta_banner", None),
            cta_banner_timing=getattr(args, "cta_banner_timing", "last-10s"),
            logo_intro_overlay_path=getattr(args, "logo_intro_overlay", None),
            logo_intro_overlay_duration=getattr(args, "logo_intro_overlay_duration", 5.0),
            logo_intro_overlay_opacity=getattr(args, "logo_intro_overlay_opacity", 0.5),
            logo_intro_overlay_fade=getattr(args, "logo_intro_overlay_fade", 0.5),
            logo_intro_overlay_scale=getattr(args, "logo_intro_overlay_scale", 0.3),
            exclude_mismatched=getattr(args, "exclude_mismatched", False),
            force_resolution=force_resolution or target_resolution,
            no_auto_scale=no_auto_scale,
            veo_audio_scenes=veo_audio_scenes,
            tts_dir=stitch_tts_dir,
            scene_order=scene_order,
        )

        # Apply color grading if requested
        if getattr(args, "color_grade", None):
            for _vk, _vr in results.items():
                if isinstance(_vr, dict) and _vr.get("success") and _vr.get("output_path"):
                    apply_color_grade(_vr["output_path"], args.color_grade)

        # Clean up temp files
        for tmp in [audio_files_temp, music_loop_temp]:
            if tmp and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

        # Record version in manifest and inject version_info into results
        if version_info:
            ver_num, ver_label, ver_dir, ver_proj_path = version_info
            for _vk, _vr in results.items():
                if isinstance(_vr, dict):
                    _vr["version"] = {
                        "number": ver_num,
                        "label": ver_label,
                        "dir": ver_dir,
                    }
            if ver_proj_path:
                for _vk, _vr in results.items():
                    if isinstance(_vr, dict) and _vr.get("success"):
                        record_version_in_manifest(
                            ver_proj_path, ver_num, ver_label,
                            _vr["output_path"],
                        )
                        break

        print("\n" + "=" * 50)
        print("SUMMARY")
        print("=" * 50)

        for version, result in results.items():
            # Skip legacy keys if we have numeric keys
            if version in ('primary', 'alt') and isinstance(list(results.keys())[0], int):
                continue

            label = str(version).upper() if isinstance(version, str) else f"V{version}"
            if result.get('success'):
                size_mb = result['file_size'] / 1024 / 1024
                audio_mode = result.get('audio_mode', 'unknown')
                print(f"[{label}] ✓ {result['output_path']} ({size_mb:.2f} MB, audio: {audio_mode})")
                if result.get('speech_muted'):
                    print(f"         Speech muted in: {', '.join(result['speech_muted'])}")
            else:
                print(f"[{label}] ✗ {result.get('error', 'Failed')}")

        # Exit with error if all failed
        numeric_results = [r for k, r in results.items() if isinstance(k, int)]
        if numeric_results and not any(r.get('success') for r in numeric_results):
            sys.exit(1)
        return

    # Standard mode - get video files
    if args.scenes:
        video_files = [f.strip() for f in args.scenes.split(",")]
    elif args.pattern:
        video_files = sorted(glob.glob(args.pattern))
    else:
        logger.error("Either --scenes, --pattern, or --dual with --videos-dir must be provided")
        sys.exit(1)

    # Validate files exist
    missing = [f for f in video_files if not os.path.exists(f)]
    if missing:
        logger.error("Missing video files: %s", missing)
        sys.exit(1)

    if not video_files:
        logger.error("No video files found")
        sys.exit(1)

    logger.info("Found %d video files:", len(video_files))
    for i, f in enumerate(video_files, 1):
        logger.info("  %d. %s", i, f)

    # Auto-narration: generate master track via Narration Conductor
    if getattr(args, "auto_narration", False):
        tts_dir = getattr(args, "tts_dir", None)
        if not tts_dir or not os.path.isdir(tts_dir):
            logger.error("--auto-narration requires --tts-dir with per-scene TTS files")
            sys.exit(1)

        from narration_conductor import find_matching_files, generate_master_narration

        conductor_videos, conductor_tts = find_matching_files(
            os.path.dirname(video_files[0]) if video_files else "",
            tts_dir,
        )
        if conductor_videos and conductor_tts:
            master_path = os.path.join(tts_dir, "master_narration.mp3")
            report_path = os.path.join(tts_dir, "conductor_report.json")
            logger.info("Conductor: generating master narration from %d scenes", len(conductor_videos))
            conductor_result = generate_master_narration(
                video_files=conductor_videos,
                tts_files=conductor_tts,
                output_path=master_path,
                report_path=report_path,
            )
            if conductor_result:
                logger.info("Conductor: master narration saved: %s", master_path)
                # Override narration_path to use the conductor output
                if not hasattr(args, "narration_path") or not args.narration_path:
                    args.narration_path = master_path
            else:
                logger.warning("Conductor: failed to generate master track, continuing without narration")
        else:
            logger.warning("Conductor: no matching video/TTS pairs found, skipping auto-narration")

    # Validate narration path for standard mode
    narration_path = getattr(args, "narration_path", None)
    narration_volume = max(0.0, min(1.0, getattr(args, "narration_volume", 0.9)))
    if narration_path and not os.path.exists(narration_path):
        logger.error("Narration file not found: %s", narration_path)
        sys.exit(1)

    # Dry-run: preview stitch plan without encoding (standard mode)
    if args.dry_run:
        if args.narrated:
            preset_name = "narrated (music=15%, video=85%)"
        elif args.presenter:
            preset_name = "presenter (music=25%, video=85%)"
        else:
            preset_name = "default (music=60%, video=30%)"

        print_dry_run_preview(
            scene_files=video_files,
            output_path=args.output,
            audio_path=args.audio,
            music_volume=music_volume,
            video_volume=video_volume,
            music_fade_out=music_fade_out,
            narration_path=narration_path,
            narration_volume=narration_volume,
            variations=1,
            logo_intro=getattr(args, "logo_intro", None),
            logo_outro=getattr(args, "logo_outro", None),
            overlay_path=getattr(args, "overlay", None),
            overlay_position=getattr(args, "overlay_position", "bottom-right"),
            overlay_scale=getattr(args, "overlay_scale", 0.15),
            overlay_opacity=getattr(args, "overlay_opacity", 0.8),
            cta_banner_path=getattr(args, "cta_banner", None),
            cta_banner_timing=getattr(args, "cta_banner_timing", "last-10s"),
            transition=transition,
            transition_duration=transition_duration,
            preset_name=preset_name,
        )
        return

    try:
        # Apply timing sync preprocessing if enabled
        files_to_stitch = video_files
        sync_temp_dir = None
        if args.sync_timestamps and sync_mode:
            sync_temp_dir = tempfile.mkdtemp(prefix="timing_sync_")
            files_to_stitch = prepare_timing_sync_videos(
                video_files, args.sync_timestamps, sync_mode, sync_temp_dir
            )

        # Prepend/append logo animation clips
        logo_intro = getattr(args, "logo_intro", None)
        logo_outro = getattr(args, "logo_outro", None)
        if logo_intro:
            if not os.path.exists(logo_intro):
                logger.error("Logo intro not found: %s", logo_intro)
                sys.exit(1)
            files_to_stitch = [logo_intro] + files_to_stitch
            logger.info("Logo intro prepended: %s", logo_intro)
        if logo_outro:
            if not os.path.exists(logo_outro):
                logger.error("Logo outro not found: %s", logo_outro)
                sys.exit(1)
            files_to_stitch = files_to_stitch + [logo_outro]
            logger.info("Logo outro appended: %s", logo_outro)

        result = stitch_videos(
            files_to_stitch,
            args.output,
            args.audio,
            preserve_audio=preserve_audio,
            music_volume=music_volume,
            video_volume=video_volume,
            check_speech=args.check_speech,
            music_fade_out=music_fade_out,
            narration_path=narration_path,
            narration_volume=narration_volume,
            transition=transition,
            transition_duration=transition_duration,
            overlay_path=getattr(args, "overlay", None),
            overlay_position=getattr(args, "overlay_position", "bottom-right"),
            overlay_scale=getattr(args, "overlay_scale", 0.15),
            overlay_opacity=getattr(args, "overlay_opacity", 0.8),
            overlay_margin=getattr(args, "overlay_margin", 20),
            cta_banner_path=getattr(args, "cta_banner", None),
            cta_banner_timing=getattr(args, "cta_banner_timing", "last-10s"),
            logo_intro_overlay_path=getattr(args, "logo_intro_overlay", None),
            logo_intro_overlay_duration=getattr(args, "logo_intro_overlay_duration", 5.0),
            logo_intro_overlay_opacity=getattr(args, "logo_intro_overlay_opacity", 0.5),
            logo_intro_overlay_fade=getattr(args, "logo_intro_overlay_fade", 0.5),
            logo_intro_overlay_scale=getattr(args, "logo_intro_overlay_scale", 0.3),
            exclude_mismatched=getattr(args, "exclude_mismatched", False),
            force_resolution=force_resolution or target_resolution,
            no_auto_scale=no_auto_scale,
        )
        # Record version in manifest and inject into result
        if version_info:
            ver_num, ver_label, ver_dir, ver_proj_path = version_info
            result["version"] = {
                "number": ver_num,
                "label": ver_label,
                "dir": ver_dir,
            }
            if ver_proj_path:
                record_version_in_manifest(
                    ver_proj_path, ver_num, ver_label,
                    result["output_path"],
                )

        # Apply color grading if requested
        if getattr(args, "color_grade", None) and result.get("success"):
            apply_color_grade(result["output_path"], args.color_grade)

        logger.info("Success!")
        logger.info("Output: %s", result['output_path'])
        logger.info("Duration: %.2fs", result['total_duration'])
        logger.info("Size: %.2f MB", result['file_size'] / 1024 / 1024)
        logger.info("Audio: %s", result.get('audio_mode', 'unknown'))
        if result.get('speech_muted'):
            logger.info("Speech muted: %s", ', '.join(result['speech_muted']))

    except Exception as e:
        logger.error("Error: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
