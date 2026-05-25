"""
Overlay Module for Video Replicator.

Provides unified video overlay capabilities including:
- Smart overlay positioning and scaling
- Timing-based overlay application
- FFmpeg filter generation
- Preset overlays (logo-intro, cta-banner, watermark)
"""

from .ffmpeg_filters import (
    build_colorchannelmixer_opacity,
    build_complete_overlay_filter,
    build_enable_expression,
    build_fade_filter,
    build_filter_chain,
    build_format_filter,
    build_multi_overlay_graph,
    build_overlay_filter,
    build_overlay_position,
    build_scale_filter as build_ffmpeg_scale,
)
from .overlay_engine import (
    OverlayConfig,
    Position,
    apply_multiple_overlays,
    apply_overlay,
    build_scale_filter,
    build_timing_expression,
    calculate_position,
    get_image_dimensions,
    get_video_dimensions,
)
from .overlay_presets import (
    OVERLAY_PRESETS,
    OverlayPreset,
    apply_preset,
    get_preset,
    list_presets,
    parse_timing,
    preset_to_config,
    print_presets,
)

__all__ = [
    # Core types
    "OverlayConfig",
    "OverlayPreset",
    "Position",
    # Main functions
    "apply_overlay",
    "apply_multiple_overlays",
    "apply_preset",
    # Utilities
    "get_video_dimensions",
    "get_image_dimensions",
    "calculate_position",
    "build_scale_filter",
    "build_timing_expression",
    # Presets
    "OVERLAY_PRESETS",
    "get_preset",
    "preset_to_config",
    "parse_timing",
    "list_presets",
    "print_presets",
    # FFmpeg filters
    "build_ffmpeg_scale",
    "build_fade_filter",
    "build_overlay_position",
    "build_enable_expression",
    "build_overlay_filter",
    "build_colorchannelmixer_opacity",
    "build_format_filter",
    "build_filter_chain",
    "build_complete_overlay_filter",
    "build_multi_overlay_graph",
]
