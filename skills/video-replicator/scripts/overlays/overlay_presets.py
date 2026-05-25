#!/usr/bin/env python3
"""
Overlay Presets for Video Replicator.

Provides pre-configured overlay settings for common use cases:
- logo-intro: Animated logo intro with fade
- cta-banner: Call-to-action banner at bottom
- watermark: Semi-transparent logo watermark
"""

from dataclasses import dataclass
from typing import Any

from .overlay_engine import OverlayConfig, Position


@dataclass
class OverlayPreset:
    """Definition of an overlay preset."""
    name: str
    description: str
    default_position: Position
    default_scale: float | None = None
    default_opacity: float = 1.0
    default_margin: int = 20
    fade_in: float = 0.0
    fade_out: float = 0.0
    # Timing: "entire", "first-Ns", "last-Ns", or (start, end) tuple
    default_timing: str = "entire"


# Pre-defined overlay presets
OVERLAY_PRESETS: dict[str, OverlayPreset] = {
    "logo-intro": OverlayPreset(
        name="logo-intro",
        description="Centered logo intro with fade in/out, first 5 seconds",
        default_position=Position.CENTER,
        default_scale=0.3,
        default_opacity=0.9,
        fade_in=0.5,
        fade_out=0.5,
        default_timing="first-5s",
    ),
    "cta-banner": OverlayPreset(
        name="cta-banner",
        description="Full-width banner at bottom, last 5-10 seconds",
        default_position=Position.BOTTOM_CENTER,
        default_scale=None,  # Full width
        default_opacity=1.0,
        fade_in=0.3,
        fade_out=0.0,
        default_timing="last-5s",
        default_margin=0,
    ),
    "watermark": OverlayPreset(
        name="watermark",
        description="Semi-transparent logo in corner, entire video",
        default_position=Position.BOTTOM_RIGHT,
        default_scale=0.15,
        default_opacity=0.5,
        fade_in=0.0,
        fade_out=0.0,
        default_timing="entire",
        default_margin=20,
    ),
    "logo-outro": OverlayPreset(
        name="logo-outro",
        description="Centered logo outro with fade, last 5 seconds",
        default_position=Position.CENTER,
        default_scale=0.3,
        default_opacity=0.9,
        fade_in=0.5,
        fade_out=0.5,
        default_timing="last-5s",
    ),
    "corner-logo": OverlayPreset(
        name="corner-logo",
        description="Small logo in top-right corner, entire video",
        default_position=Position.TOP_RIGHT,
        default_scale=0.12,
        default_opacity=0.8,
        fade_in=0.3,
        fade_out=0.0,
        default_timing="entire",
        default_margin=15,
    ),
}


def get_preset(name: str) -> OverlayPreset | None:
    """
    Get an overlay preset by name.

    Args:
        name: Preset name (logo-intro, cta-banner, watermark, etc.)

    Returns:
        OverlayPreset or None if not found
    """
    return OVERLAY_PRESETS.get(name)


def parse_timing(timing: str, video_duration: float) -> tuple[float, float]:
    """
    Parse timing string into (start, end) tuple.

    Args:
        timing: "entire", "first-Ns", "last-Ns", or "N-M"
        video_duration: Total video duration in seconds

    Returns:
        Tuple of (start_time, end_time)
    """
    if timing == "entire":
        return (0.0, video_duration)

    if timing.startswith("first-"):
        duration = float(timing.replace("first-", "").replace("s", ""))
        return (0.0, min(duration, video_duration))

    if timing.startswith("last-"):
        duration = float(timing.replace("last-", "").replace("s", ""))
        return (max(0, video_duration - duration), video_duration)

    if "-" in timing:
        parts = timing.split("-")
        start = float(parts[0])
        end = float(parts[1])
        return (start, min(end, video_duration))

    return (0.0, video_duration)


def preset_to_config(
    preset_name: str,
    source: str,
    video_duration: float,
    overrides: dict[str, Any] | None = None
) -> OverlayConfig:
    """
    Convert a preset to an OverlayConfig.

    Args:
        preset_name: Name of the preset
        source: Path to overlay file
        video_duration: Total video duration for timing calculation
        overrides: Optional dict of settings to override

    Returns:
        OverlayConfig ready for use

    Raises:
        ValueError: If preset not found
    """
    preset = get_preset(preset_name)
    if not preset:
        raise ValueError(f"Unknown preset: {preset_name}")

    overrides = overrides or {}

    # Parse timing
    timing_str = overrides.get("timing", preset.default_timing)
    start_time, end_time = parse_timing(timing_str, video_duration)

    return OverlayConfig(
        source=source,
        position=overrides.get("position", preset.default_position),
        scale=overrides.get("scale", preset.default_scale),
        opacity=overrides.get("opacity", preset.default_opacity),
        margin=overrides.get("margin", preset.default_margin),
        start_time=overrides.get("start_time", start_time),
        end_time=overrides.get("end_time", end_time),
        fade_in=overrides.get("fade_in", preset.fade_in),
        fade_out=overrides.get("fade_out", preset.fade_out),
    )


def apply_preset(
    preset_name: str,
    source: str,
    base_video: str,
    output_path: str,
    overrides: dict[str, Any] | None = None
) -> bool:
    """
    Apply a preset overlay to a video.

    Args:
        preset_name: Name of the preset
        source: Path to overlay file
        base_video: Path to base video
        output_path: Path for output video
        overrides: Optional settings to override preset defaults

    Returns:
        True if successful, False otherwise
    """
    import subprocess

    from .overlay_engine import apply_overlay

    try:
        # Get video duration
        duration_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            base_video
        ]
        result = subprocess.run(duration_cmd, capture_output=True, text=True)
        duration = float(result.stdout.strip())

        # Convert preset to config
        config = preset_to_config(preset_name, source, duration, overrides)

        # Apply overlay
        return apply_overlay(base_video, config, output_path)

    except Exception as e:
        print(f"Error applying preset {preset_name}: {e}")
        return False


def list_presets() -> dict[str, str]:
    """
    List all available presets with descriptions.

    Returns:
        Dict of preset_name -> description
    """
    return {name: preset.description for name, preset in OVERLAY_PRESETS.items()}


def print_presets() -> None:
    """Print all available presets in a formatted table."""
    print("\nAvailable Overlay Presets:")
    print("-" * 60)
    for name, preset in OVERLAY_PRESETS.items():
        print(f"  {name:<15} {preset.description}")
        print(f"    Position: {preset.default_position.value}")
        print(f"    Scale: {preset.default_scale or 'auto'}")
        print(f"    Opacity: {preset.default_opacity}")
        print(f"    Timing: {preset.default_timing}")
        print()


if __name__ == "__main__":
    print_presets()
