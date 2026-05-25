#!/usr/bin/env python3
"""
Overlay Engine for Video Replicator.

Provides smart overlay positioning, scaling, and timing for video overlays.
Generates FFmpeg filter commands for overlay composition.
"""

import subprocess
from dataclasses import dataclass
from enum import Enum


class Position(Enum):
    """Named positions for overlays."""
    TOP_LEFT = "top-left"
    TOP_CENTER = "top-center"
    TOP_RIGHT = "top-right"
    CENTER_LEFT = "center-left"
    CENTER = "center"
    CENTER_RIGHT = "center-right"
    BOTTOM_LEFT = "bottom-left"
    BOTTOM_CENTER = "bottom-center"
    BOTTOM_RIGHT = "bottom-right"


@dataclass
class OverlayConfig:
    """Configuration for a single overlay."""
    source: str  # Path to overlay file (image or video)
    position: Position | tuple[int, int] = Position.CENTER
    scale: float | None = None  # Scale factor (1.0 = original size)
    scale_width: int | None = None  # Target width (maintains aspect)
    scale_height: int | None = None  # Target height (maintains aspect)
    opacity: float = 1.0  # 0.0 to 1.0
    start_time: float | None = None  # Start time in seconds
    end_time: float | None = None  # End time in seconds
    duration: float | None = None  # Alternative to end_time
    fade_in: float = 0.0  # Fade in duration in seconds
    fade_out: float = 0.0  # Fade out duration in seconds
    margin: int = 20  # Margin from edges for named positions


def get_video_dimensions(video_path: str) -> tuple[int, int]:
    """
    Get video dimensions using ffprobe.

    Args:
        video_path: Path to video file

    Returns:
        Tuple of (width, height)

    Raises:
        RuntimeError: If ffprobe fails
    """
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        video_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        parts = result.stdout.strip().split(",")
        return int(parts[0]), int(parts[1])
    except (subprocess.CalledProcessError, ValueError, IndexError) as e:
        raise RuntimeError(f"Failed to get video dimensions: {e}") from e


def get_image_dimensions(image_path: str) -> tuple[int, int]:
    """
    Get image dimensions using ffprobe.

    Args:
        image_path: Path to image file

    Returns:
        Tuple of (width, height)
    """
    return get_video_dimensions(image_path)  # ffprobe works for images too


def calculate_position(
    position: Position | tuple[int, int],
    base_width: int,
    base_height: int,
    overlay_width: int,
    overlay_height: int,
    margin: int = 20
) -> tuple[str, str]:
    """
    Calculate x,y position for overlay.

    Args:
        position: Named position or (x, y) tuple
        base_width: Width of base video
        base_height: Height of base video
        overlay_width: Width of overlay
        overlay_height: Height of overlay
        margin: Margin from edges

    Returns:
        Tuple of (x_expr, y_expr) for FFmpeg
    """
    if isinstance(position, tuple):
        return str(position[0]), str(position[1])

    # Named positions
    positions = {
        Position.TOP_LEFT: (f"{margin}", f"{margin}"),
        Position.TOP_CENTER: ("(W-w)/2", f"{margin}"),
        Position.TOP_RIGHT: (f"W-w-{margin}", f"{margin}"),
        Position.CENTER_LEFT: (f"{margin}", "(H-h)/2"),
        Position.CENTER: ("(W-w)/2", "(H-h)/2"),
        Position.CENTER_RIGHT: (f"W-w-{margin}", "(H-h)/2"),
        Position.BOTTOM_LEFT: (f"{margin}", f"H-h-{margin}"),
        Position.BOTTOM_CENTER: ("(W-w)/2", f"H-h-{margin}"),
        Position.BOTTOM_RIGHT: (f"W-w-{margin}", f"H-h-{margin}"),
    }
    return positions.get(position, ("(W-w)/2", "(H-h)/2"))


def build_scale_filter(config: OverlayConfig) -> str | None:
    """
    Build FFmpeg scale filter for overlay.

    Args:
        config: OverlayConfig with scale settings

    Returns:
        Scale filter string or None if no scaling needed
    """
    if config.scale is not None:
        return f"scale=iw*{config.scale}:ih*{config.scale}"
    elif config.scale_width is not None:
        return f"scale={config.scale_width}:-1"
    elif config.scale_height is not None:
        return f"scale=-1:{config.scale_height}"
    return None


def build_timing_expression(
    config: OverlayConfig,
    video_duration: float | None = None
) -> str:
    """
    Build FFmpeg timing expression for enable filter.

    Args:
        config: OverlayConfig with timing settings
        video_duration: Total video duration (for "last N seconds" style timing)

    Returns:
        Enable expression string for FFmpeg
    """
    conditions = []

    start = config.start_time or 0
    if config.end_time is not None:
        end = config.end_time
    elif config.duration is not None:
        end = start + config.duration
    elif video_duration is not None:
        end = video_duration
    else:
        end = None

    if start > 0:
        conditions.append(f"gte(t,{start})")
    if end is not None:
        conditions.append(f"lte(t,{end})")

    if conditions:
        return ":enable='" + "*".join(conditions) + "'"
    return ""


def build_fade_filter(
    config: OverlayConfig,
    video_duration: float | None = None
) -> list[str]:
    """
    Build FFmpeg fade filters for overlay.

    Args:
        config: OverlayConfig with fade settings
        video_duration: Total video duration

    Returns:
        List of fade filter strings
    """
    filters = []
    start = config.start_time or 0

    if config.end_time is not None:
        end = config.end_time
    elif config.duration is not None:
        end = start + config.duration
    elif video_duration is not None:
        end = video_duration
    else:
        end = None

    if config.fade_in > 0:
        filters.append(f"fade=t=in:st={start}:d={config.fade_in}")

    if config.fade_out > 0 and end is not None:
        fade_start = end - config.fade_out
        filters.append(f"fade=t=out:st={fade_start}:d={config.fade_out}")

    return filters


def build_overlay_filter(
    config: OverlayConfig,
    input_index: int,
    base_width: int,
    base_height: int,
    video_duration: float | None = None
) -> str:
    """
    Build complete FFmpeg overlay filter for a single overlay.

    Args:
        config: OverlayConfig for the overlay
        input_index: Input stream index (1 for first overlay, 2 for second, etc.)
        base_width: Width of base video
        base_height: Height of base video
        video_duration: Total video duration

    Returns:
        FFmpeg filter string
    """
    filters = []

    # Scale filter for overlay
    scale = build_scale_filter(config)
    if scale:
        filters.append(f"[{input_index}:v]{scale}[ov{input_index}]")
        overlay_ref = f"ov{input_index}"
    else:
        overlay_ref = f"{input_index}:v"

    # Calculate position
    x_expr, y_expr = calculate_position(
        config.position,
        base_width,
        base_height,
        0, 0,  # Actual overlay dimensions handled by FFmpeg
        config.margin
    )

    # Build overlay filter with timing
    timing = build_timing_expression(config, video_duration)
    overlay_filter = f"overlay=x={x_expr}:y={y_expr}{timing}"

    return overlay_filter, overlay_ref


def apply_overlay(
    base_video: str,
    overlay_config: OverlayConfig,
    output_path: str,
    copy_audio: bool = True
) -> bool:
    """
    Apply a single overlay to a video.

    Args:
        base_video: Path to base video
        overlay_config: Configuration for the overlay
        output_path: Path for output video
        copy_audio: Whether to copy audio stream

    Returns:
        True if successful, False otherwise
    """
    try:
        # Get base video dimensions and duration
        width, height = get_video_dimensions(base_video)

        # Get duration
        duration_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            base_video
        ]
        result = subprocess.run(duration_cmd, capture_output=True, text=True)
        duration = float(result.stdout.strip()) if result.stdout.strip() else None

        # Build filter
        overlay_filter, overlay_ref = build_overlay_filter(
            overlay_config, 1, width, height, duration
        )

        # Build FFmpeg command
        cmd = [
            "ffmpeg", "-y",
            "-i", base_video,
            "-i", overlay_config.source,
        ]

        # Build filter complex
        filter_parts = []

        # Scale overlay if needed
        scale = build_scale_filter(overlay_config)
        if scale:
            filter_parts.append(f"[1:v]{scale}[ov]")
            overlay_ref = "[ov]"
        else:
            overlay_ref = "[1:v]"

        # Calculate position
        x_expr, y_expr = calculate_position(
            overlay_config.position,
            width, height,
            0, 0,
            overlay_config.margin
        )

        # Build overlay with timing
        timing = build_timing_expression(overlay_config, duration)
        filter_parts.append(
            f"[0:v]{overlay_ref}overlay=x={x_expr}:y={y_expr}{timing}[out]"
        )

        cmd.extend(["-filter_complex", ";".join(filter_parts)])
        cmd.extend(["-map", "[out]"])

        if copy_audio:
            cmd.extend(["-map", "0:a?", "-c:a", "copy"])

        cmd.append(output_path)

        # Run FFmpeg
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.returncode == 0

    except Exception as e:
        print(f"Error applying overlay: {e}")
        return False


def apply_multiple_overlays(
    base_video: str,
    overlays: list[OverlayConfig],
    output_path: str,
    copy_audio: bool = True
) -> bool:
    """
    Apply multiple overlays to a video in sequence.

    Args:
        base_video: Path to base video
        overlays: List of OverlayConfig objects
        output_path: Path for output video
        copy_audio: Whether to copy audio stream

    Returns:
        True if successful, False otherwise
    """
    if not overlays:
        return False

    try:
        # Get base video dimensions and duration
        width, height = get_video_dimensions(base_video)

        duration_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            base_video
        ]
        result = subprocess.run(duration_cmd, capture_output=True, text=True)
        duration = float(result.stdout.strip()) if result.stdout.strip() else None

        # Build FFmpeg command
        cmd = ["ffmpeg", "-y", "-i", base_video]

        # Add all overlay inputs
        for overlay in overlays:
            cmd.extend(["-i", overlay.source])

        # Build filter complex
        filter_parts = []
        current_base = "[0:v]"

        for i, overlay in enumerate(overlays, 1):
            # Scale overlay if needed
            scale = build_scale_filter(overlay)
            if scale:
                filter_parts.append(f"[{i}:v]{scale}[ov{i}]")
                overlay_ref = f"[ov{i}]"
            else:
                overlay_ref = f"[{i}:v]"

            # Calculate position
            x_expr, y_expr = calculate_position(
                overlay.position,
                width, height,
                0, 0,
                overlay.margin
            )

            # Build overlay with timing
            timing = build_timing_expression(overlay, duration)
            output_label = f"[tmp{i}]" if i < len(overlays) else "[out]"

            filter_parts.append(
                f"{current_base}{overlay_ref}overlay=x={x_expr}:y={y_expr}{timing}{output_label}"
            )
            current_base = output_label

        cmd.extend(["-filter_complex", ";".join(filter_parts)])
        cmd.extend(["-map", "[out]"])

        if copy_audio:
            cmd.extend(["-map", "0:a?", "-c:a", "copy"])

        cmd.append(output_path)

        # Run FFmpeg
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.returncode == 0

    except Exception as e:
        print(f"Error applying overlays: {e}")
        return False


if __name__ == "__main__":
    # Example usage
    config = OverlayConfig(
        source="logo.png",
        position=Position.BOTTOM_RIGHT,
        scale=0.15,
        opacity=0.8,
        margin=30
    )
    print(f"Overlay config: {config}")
    print(f"Position expression: {calculate_position(config.position, 1920, 1080, 200, 100, config.margin)}")
