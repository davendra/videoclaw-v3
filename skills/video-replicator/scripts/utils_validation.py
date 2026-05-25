#!/usr/bin/env python3
"""
Timestamp, freshness, and aspect ratio validation for images and videos.

Extracted from utils.py — prevents stale artifacts from previous runs
being mixed into the current run (v2.8/v2.9).

Aspect ratio validation (v2.39) catches Go Bananas outputting wrong
dimensions (e.g., near-square 928x1152 instead of true 9:16 portrait).
"""

import glob
import os
from datetime import datetime

from config import LANDSCAPE_RATIO, PORTRAIT_RATIO
from utils_image import get_image_dimensions
from utils_project import get_or_create_manifest


# ============================================================================
# Expected aspect ratio values for named ratios
# ============================================================================

EXPECTED_RATIOS: dict[str, float] = {
    "portrait": PORTRAIT_RATIO,     # 9/16 = 0.5625
    "landscape": LANDSCAPE_RATIO,   # 16/9 = 1.7778
    "square": 1.0,
    "9:16": PORTRAIT_RATIO,
    "16:9": LANDSCAPE_RATIO,
    "1:1": 1.0,
    "4:3": 4 / 3,
    "3:4": 3 / 4,
    "2:3": 2 / 3,
    "3:2": 3 / 2,
    "4:5": 4 / 5,
    "5:4": 5 / 4,
    "9:16": 9 / 16,
    "16:9": 16 / 9,
    "21:9": 21 / 9,
}


# ============================================================================
# Aspect Ratio Validation
# ============================================================================


def _resolve_expected_ratio(expected_ratio: float | str) -> float:
    """
    Resolve an expected ratio to a float value.

    Accepts either a numeric ratio (e.g. 0.5625, 1.778) or a named string
    (e.g. "portrait", "landscape", "16:9").
    """
    if isinstance(expected_ratio, (int, float)):
        return float(expected_ratio)
    if isinstance(expected_ratio, str) and expected_ratio in EXPECTED_RATIOS:
        return EXPECTED_RATIOS[expected_ratio]
    raise ValueError(
        f"Unknown aspect ratio '{expected_ratio}'. "
        f"Use a numeric value or one of: {', '.join(EXPECTED_RATIOS.keys())}"
    )


def validate_aspect_ratio(
    image_path: str,
    expected_ratio: float | str,
    tolerance: float = 0.1,
) -> dict:
    """
    Validate that an image's aspect ratio matches the expected value.

    Go Bananas sometimes outputs near-square portrait images (928x1152, ratio
    0.806) instead of proper portrait (504x896, ratio 0.5625). This function
    catches that mismatch before video generation.

    Args:
        image_path: Path to the image file.
        expected_ratio: Expected width/height ratio as a float (e.g. 0.5625
            for 9:16 portrait, 1.778 for 16:9 landscape) or a named string
            (e.g. "portrait", "landscape", "square", "16:9").
        tolerance: Fractional tolerance around the expected ratio. 0.1 means
            10% deviation is allowed (e.g. 0.5625 +/- 0.05625).

    Returns:
        Dict with keys:
            valid (bool): Whether the ratio is within tolerance.
            actual_ratio (float): Measured width/height.
            expected_ratio (float): The resolved expected ratio.
            width (int): Image width in pixels.
            height (int): Image height in pixels.
            deviation (float): Fractional deviation from expected
                (0.0 = exact match, 0.43 = 43% off).
            error (str | None): Human-readable error when invalid, else None.
    """
    expected = _resolve_expected_ratio(expected_ratio)

    if not os.path.exists(image_path):
        return {
            "valid": False,
            "actual_ratio": 0.0,
            "expected_ratio": expected,
            "width": 0,
            "height": 0,
            "deviation": 1.0,
            "error": f"File not found: {image_path}",
        }

    dims = get_image_dimensions(image_path)
    if dims is None:
        return {
            "valid": False,
            "actual_ratio": 0.0,
            "expected_ratio": expected,
            "width": 0,
            "height": 0,
            "deviation": 1.0,
            "error": f"Could not read dimensions: {image_path}",
        }

    width, height = dims
    actual = width / height
    deviation = abs(actual - expected) / expected
    # Round to 4 decimal places before comparing to avoid float precision issues
    # (e.g. 0.10000000000000003 should be treated as 0.1)
    is_valid = round(deviation, 4) <= tolerance

    error = None
    if not is_valid:
        ratio_name = _ratio_name(expected)
        error = (
            f"Image {os.path.basename(image_path)} has ratio {actual:.3f} "
            f"(expected {expected:.4f} {ratio_name}). "
            f"Deviation {deviation:.1%} exceeds tolerance {tolerance:.0%}. "
            f"Consider re-generating with stronger aspect ratio hints."
        )

    return {
        "valid": is_valid,
        "actual_ratio": round(actual, 4),
        "expected_ratio": round(expected, 4),
        "width": width,
        "height": height,
        "deviation": round(deviation, 4),
        "error": error,
    }


def validate_batch_aspect_ratio(
    image_dir: str,
    expected_ratio: float | str,
    pattern: str = "*.jpg",
    tolerance: float = 0.1,
) -> dict:
    """
    Validate aspect ratios for all images matching a pattern in a directory.

    Args:
        image_dir: Directory containing images.
        expected_ratio: Expected width/height ratio (float or named string).
        pattern: Glob pattern to match files (default "*.jpg").
        tolerance: Fractional tolerance (default 0.1 = 10%).

    Returns:
        Dict with keys:
            total (int): Number of images checked.
            valid (list[str]): Paths of images within tolerance.
            invalid (list[str]): Paths of images outside tolerance.
            results (dict[str, dict]): Per-image validation results keyed
                by filename.
            all_valid (bool): True if every image passed.
    """
    import fnmatch

    expected = _resolve_expected_ratio(expected_ratio)
    valid_paths: list[str] = []
    invalid_paths: list[str] = []
    results: dict[str, dict] = {}

    if not os.path.isdir(image_dir):
        return {
            "total": 0,
            "valid": [],
            "invalid": [],
            "results": {},
            "all_valid": True,
        }

    for entry in sorted(os.listdir(image_dir)):
        if not fnmatch.fnmatch(entry, pattern):
            continue
        full_path = os.path.join(image_dir, entry)
        if not os.path.isfile(full_path):
            continue

        result = validate_aspect_ratio(full_path, expected, tolerance)
        results[entry] = result
        if result["valid"]:
            valid_paths.append(full_path)
        else:
            invalid_paths.append(full_path)

    return {
        "total": len(results),
        "valid": valid_paths,
        "invalid": invalid_paths,
        "results": results,
        "all_valid": len(invalid_paths) == 0,
    }


def _ratio_name(ratio: float) -> str:
    """Return a human-friendly name for common aspect ratios."""
    for name, value in EXPECTED_RATIOS.items():
        if abs(ratio - value) < 0.001:
            return name
    return ""


# ============================================================================
# Timestamp / Freshness Validation
# ============================================================================


def validate_file_freshness(
    file_path: str,
    min_timestamp: float,
    context: str = "",
    grace_period_before: int = 600
) -> tuple[bool, str]:
    """
    Validate that a file was created within acceptable time bounds.

    Args:
        file_path: Path to file
        min_timestamp: Reference timestamp (usually run start time)
        context: Optional context for error message
        grace_period_before: Seconds before min_timestamp still acceptable (default: 600)

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not os.path.exists(file_path):
        return False, f"File not found: {file_path}"

    file_mtime = os.path.getmtime(file_path)
    effective_min = min_timestamp - grace_period_before

    if file_mtime < effective_min:
        file_time = datetime.fromtimestamp(file_mtime).strftime("%H:%M:%S")
        expected_time = datetime.fromtimestamp(min_timestamp).strftime("%H:%M:%S")
        context_str = f" ({context})" if context else ""
        return False, f"File is stale (created {file_time}, expected after {expected_time}{context_str})"

    return True, ""


def validate_video_freshness(
    video_path: str,
    min_timestamp: float,
    context: str = ""
) -> tuple[bool, str]:
    """Validate that a video file was created after the specified timestamp."""
    if not os.path.exists(video_path):
        return False, f"File not found: {video_path}"

    file_mtime = os.path.getmtime(video_path)

    if file_mtime < min_timestamp:
        file_time = datetime.fromtimestamp(file_mtime).strftime("%H:%M:%S")
        expected_time = datetime.fromtimestamp(min_timestamp).strftime("%H:%M:%S")
        context_str = f" ({context})" if context else ""
        return False, f"Video is stale (created {file_time}, expected after {expected_time}{context_str})"

    return True, ""


def get_run_start_timestamp(project_path: str, run_id: str) -> float | None:
    """Get the Unix timestamp when a run was created from manifest.json."""
    manifest = get_or_create_manifest(project_path)

    for run in manifest.get("runs", []):
        if run.get("run_id") == run_id:
            created_at = run.get("created_at") or run.get("started_at")
            if created_at:
                try:
                    if created_at.endswith("Z"):
                        created_at = created_at.replace("Z", "+00:00")
                    dt = datetime.fromisoformat(created_at)
                    return dt.timestamp()
                except (ValueError, TypeError):
                    pass

    return None


def validate_videos_freshness(
    video_paths: list[str],
    min_timestamp: float,
    context: str = ""
) -> tuple[list[str], list[str], list[str]]:
    """
    Validate multiple video files for freshness.

    Returns:
        Tuple of (valid_files, stale_files, warnings)
    """
    valid_files = []
    stale_files = []
    warnings = []

    for video_path in video_paths:
        is_fresh, error = validate_video_freshness(video_path, min_timestamp, context)
        if is_fresh:
            valid_files.append(video_path)
        else:
            stale_files.append(video_path)
            filename = os.path.basename(video_path)
            warnings.append(f"STALE VIDEO: {filename} - {error}")

    return valid_files, stale_files, warnings


def validate_image_freshness(
    image_path: str,
    min_timestamp: float,
    context: str = ""
) -> tuple[bool, str]:
    """Validate that an image file was created after the specified timestamp."""
    return validate_file_freshness(image_path, min_timestamp, context)


def validate_images_freshness(
    image_paths: list[str],
    min_timestamp: float,
    context: str = ""
) -> tuple[list[str], list[str], list[str]]:
    """
    Validate multiple image files for freshness.

    Returns:
        Tuple of (valid_files, stale_files, warnings)
    """
    valid_files = []
    stale_files = []
    warnings = []

    for image_path in image_paths:
        is_fresh, error = validate_image_freshness(image_path, min_timestamp, context)
        if is_fresh:
            valid_files.append(image_path)
        else:
            stale_files.append(image_path)
            filename = os.path.basename(image_path)
            warnings.append(f"STALE IMAGE: {filename} - {error}")

    return valid_files, stale_files, warnings


def clear_stale_veo_outputs(veo_path: str, tag: str) -> int:
    """
    Remove matching tag files from veo-cli output-videos/ before generation.

    Prevents stale videos from previous runs being picked up after a failed
    generation attempt. Called before each veo-cli invocation.

    Args:
        veo_path: Path to veo-cli directory
        tag: Scene tag to match (e.g., "scene_3")

    Returns:
        Number of files removed
    """
    output_dir = os.path.join(veo_path, "output-videos")
    if not os.path.exists(output_dir):
        return 0

    # Extract scene number from tag
    scene_num = tag.replace("scene_", "")

    patterns = [
        f"*_{tag}.mp4",
        f"*_{tag}_*.mp4",
        f"*_scene{scene_num}*.mp4",
        f"*_{scene_num}.mp4",
    ]

    removed = 0
    for pattern in patterns:
        for f in glob.glob(os.path.join(output_dir, pattern)):
            try:
                os.remove(f)
                removed += 1
            except OSError:
                pass

    return removed


def validate_video_output(
    video_path: str,
    generation_start: float,
    scene_number: int,
    min_size_bytes: int = 100_000,
) -> tuple[bool, str]:
    """
    Post-validate a video output after generation.

    Checks:
    1. File exists
    2. File size > min_size_bytes (reject empty/truncated files)
    3. File mtime >= generation_start (reject stale files from previous runs)

    Args:
        video_path: Path to the output video
        generation_start: Unix timestamp when generation started
        scene_number: Scene number for error messages
        min_size_bytes: Minimum acceptable file size (default: 100KB)

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not os.path.exists(video_path):
        return False, f"Scene {scene_number}: output file not found"

    file_size = os.path.getsize(video_path)
    if file_size < min_size_bytes:
        return False, f"Scene {scene_number}: file too small ({file_size} bytes, min {min_size_bytes})"

    file_mtime = os.path.getmtime(video_path)
    if file_mtime < generation_start:
        file_time = datetime.fromtimestamp(file_mtime).strftime("%H:%M:%S")
        start_time = datetime.fromtimestamp(generation_start).strftime("%H:%M:%S")
        return False, f"Scene {scene_number}: stale video (modified {file_time}, generation started {start_time})"

    return True, ""


def print_stale_images_warning(stale_files: list[str], warnings: list[str], run_id: str) -> None:
    """Print warning about stale images found during validation."""
    if not stale_files:
        return

    print(f"\n{'='*60}")
    print("WARNING: Stale images detected from previous run!")
    print(f"{'='*60}")

    for warning in warnings:
        print(f"  {warning}")

    print(f"\nThese images were created BEFORE {run_id} started.")
    print("They may not match your current prompts or character references.")
    print(f"\nTo fix: Regenerate images for {run_id} before video generation.")
    print(f"{'='*60}\n")
