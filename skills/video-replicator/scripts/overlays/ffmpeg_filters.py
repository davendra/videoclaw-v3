#!/usr/bin/env python3
"""
FFmpeg Filter Utilities for Overlay Engine.

Provides functions for building complex FFmpeg filter graphs for overlays.
Handles timing, positioning, scaling, fading, and composition.
"""



def build_scale_filter(
    scale: float | None = None,
    width: int | None = None,
    height: int | None = None,
    maintain_aspect: bool = True
) -> str | None:
    """
    Build FFmpeg scale filter string.

    Args:
        scale: Scale factor (e.g., 0.5 for half size)
        width: Target width (use -1 for auto)
        height: Target height (use -1 for auto)
        maintain_aspect: Whether to maintain aspect ratio

    Returns:
        Scale filter string or None
    """
    if scale is not None:
        return f"scale=iw*{scale}:ih*{scale}"
    elif width is not None and height is not None:
        if maintain_aspect:
            return f"scale={width}:{height}:force_original_aspect_ratio=decrease"
        return f"scale={width}:{height}"
    elif width is not None:
        return f"scale={width}:-1"
    elif height is not None:
        return f"scale=-1:{height}"
    return None


def build_fade_filter(
    fade_type: str,
    start_time: float,
    duration: float,
    alpha: bool = True
) -> str:
    """
    Build FFmpeg fade filter string.

    Args:
        fade_type: "in" or "out"
        start_time: Start time in seconds
        duration: Fade duration in seconds
        alpha: Whether to fade alpha channel (for transparent overlays)

    Returns:
        Fade filter string
    """
    alpha_str = ":alpha=1" if alpha else ""
    return f"fade=t={fade_type}:st={start_time}:d={duration}{alpha_str}"


def build_overlay_position(
    position: str,
    margin: int = 20
) -> tuple[str, str]:
    """
    Build FFmpeg overlay position expressions.

    Args:
        position: Named position (top-left, center, bottom-right, etc.)
        margin: Margin from edges in pixels

    Returns:
        Tuple of (x_expression, y_expression)
    """
    positions = {
        "top-left": (f"{margin}", f"{margin}"),
        "top-center": ("(W-w)/2", f"{margin}"),
        "top-right": (f"W-w-{margin}", f"{margin}"),
        "center-left": (f"{margin}", "(H-h)/2"),
        "center": ("(W-w)/2", "(H-h)/2"),
        "center-right": (f"W-w-{margin}", "(H-h)/2"),
        "bottom-left": (f"{margin}", f"H-h-{margin}"),
        "bottom-center": ("(W-w)/2", f"H-h-{margin}"),
        "bottom-right": (f"W-w-{margin}", f"H-h-{margin}"),
    }
    return positions.get(position, ("(W-w)/2", "(H-h)/2"))


def build_enable_expression(
    start_time: float | None = None,
    end_time: float | None = None,
    duration: float | None = None
) -> str:
    """
    Build FFmpeg enable expression for timed overlays.

    Args:
        start_time: Start time in seconds
        end_time: End time in seconds
        duration: Duration (alternative to end_time)

    Returns:
        Enable expression string (without the :enable= prefix)
    """
    conditions = []

    if start_time is not None and start_time > 0:
        conditions.append(f"gte(t,{start_time})")

    if end_time is not None:
        conditions.append(f"lte(t,{end_time})")
    elif duration is not None and start_time is not None:
        conditions.append(f"lte(t,{start_time + duration})")

    if conditions:
        return "*".join(conditions)
    return "1"  # Always enabled


def build_overlay_filter(
    x: str,
    y: str,
    enable_expr: str | None = None,
    shortest: bool = False,
    format: str = "auto"
) -> str:
    """
    Build FFmpeg overlay filter string.

    Args:
        x: X position expression
        y: Y position expression
        enable_expr: Optional enable expression for timing
        shortest: End when shortest input ends
        format: Overlay format (auto, rgb, yuv420, etc.)

    Returns:
        Overlay filter string
    """
    parts = [f"x={x}", f"y={y}"]

    if format != "auto":
        parts.append(f"format={format}")

    if shortest:
        parts.append("shortest=1")

    if enable_expr:
        parts.append(f"enable='{enable_expr}'")

    return "overlay=" + ":".join(parts)


def build_colorchannelmixer_opacity(opacity: float) -> str:
    """
    Build FFmpeg colorchannelmixer filter for opacity.

    Args:
        opacity: Opacity value (0.0 to 1.0)

    Returns:
        Colorchannelmixer filter string
    """
    return f"colorchannelmixer=aa={opacity}"


def build_format_filter(pixel_format: str = "rgba") -> str:
    """
    Build FFmpeg format filter for pixel format conversion.

    Args:
        pixel_format: Target pixel format (rgba, yuva420p, etc.)

    Returns:
        Format filter string
    """
    return f"format={pixel_format}"


def build_filter_chain(*filters: str) -> str:
    """
    Chain multiple filters together.

    Args:
        *filters: Filter strings to chain

    Returns:
        Combined filter string
    """
    return ",".join(f for f in filters if f)


def build_complete_overlay_filter(
    input_labels: tuple[str, str],
    output_label: str,
    position: str = "center",
    margin: int = 20,
    scale: float | None = None,
    opacity: float = 1.0,
    start_time: float | None = None,
    end_time: float | None = None,
    fade_in: float = 0.0,
    fade_out: float = 0.0
) -> str:
    """
    Build a complete overlay filter graph section.

    Args:
        input_labels: Tuple of (base_label, overlay_label)
        output_label: Output stream label
        position: Named position for overlay
        margin: Margin from edges
        scale: Scale factor for overlay
        opacity: Opacity of overlay
        start_time: Start time in seconds
        end_time: End time in seconds
        fade_in: Fade in duration
        fade_out: Fade out duration

    Returns:
        Complete filter graph section
    """
    base_label, overlay_label = input_labels
    filter_parts = []

    # Pre-process overlay: scale, format, opacity, fades
    overlay_filters = []

    if scale:
        overlay_filters.append(build_scale_filter(scale=scale))

    # Convert to RGBA for alpha channel operations
    overlay_filters.append(build_format_filter("rgba"))

    if opacity < 1.0:
        overlay_filters.append(build_colorchannelmixer_opacity(opacity))

    if fade_in > 0 and start_time is not None:
        overlay_filters.append(build_fade_filter("in", 0, fade_in, alpha=True))

    if fade_out > 0 and end_time is not None:
        fade_start = (end_time - start_time - fade_out) if start_time else (end_time - fade_out)
        overlay_filters.append(build_fade_filter("out", fade_start, fade_out, alpha=True))

    # Build overlay pre-processing chain
    if overlay_filters:
        preprocess_label = f"{overlay_label.strip('[]')}_prep"
        filter_parts.append(f"{overlay_label}{build_filter_chain(*overlay_filters)}[{preprocess_label}]")
        overlay_ref = f"[{preprocess_label}]"
    else:
        overlay_ref = overlay_label

    # Build main overlay filter
    x_expr, y_expr = build_overlay_position(position, margin)
    enable_expr = build_enable_expression(start_time, end_time)

    overlay_filter = build_overlay_filter(x_expr, y_expr, enable_expr if start_time else None)
    filter_parts.append(f"{base_label}{overlay_ref}{overlay_filter}{output_label}")

    return ";".join(filter_parts)


def build_multi_overlay_graph(
    overlays: list[dict],
    base_label: str = "[0:v]",
    output_label: str = "[out]"
) -> str:
    """
    Build filter graph for multiple overlays.

    Args:
        overlays: List of overlay configs with keys:
            - input_label: Input stream label (e.g., "[1:v]")
            - position: Named position
            - scale: Optional scale factor
            - opacity: Opacity (0-1)
            - start_time: Optional start time
            - end_time: Optional end time
            - fade_in: Fade in duration
            - fade_out: Fade out duration
        base_label: Label for base video stream
        output_label: Label for final output

    Returns:
        Complete filter graph string
    """
    if not overlays:
        return ""

    filter_sections = []
    current_base = base_label

    for i, overlay in enumerate(overlays):
        is_last = (i == len(overlays) - 1)
        temp_output = output_label if is_last else f"[tmp{i}]"

        section = build_complete_overlay_filter(
            input_labels=(current_base, overlay["input_label"]),
            output_label=temp_output,
            position=overlay.get("position", "center"),
            margin=overlay.get("margin", 20),
            scale=overlay.get("scale"),
            opacity=overlay.get("opacity", 1.0),
            start_time=overlay.get("start_time"),
            end_time=overlay.get("end_time"),
            fade_in=overlay.get("fade_in", 0.0),
            fade_out=overlay.get("fade_out", 0.0),
        )
        filter_sections.append(section)
        current_base = temp_output

    return ";".join(filter_sections)


if __name__ == "__main__":
    # Example usage
    print("Example: Build watermark overlay filter")
    filter_graph = build_complete_overlay_filter(
        input_labels=("[0:v]", "[1:v]"),
        output_label="[out]",
        position="bottom-right",
        margin=20,
        scale=0.15,
        opacity=0.5,
    )
    print(f"Filter: {filter_graph}\n")

    print("Example: Build logo intro overlay filter")
    filter_graph = build_complete_overlay_filter(
        input_labels=("[0:v]", "[1:v]"),
        output_label="[out]",
        position="center",
        scale=0.3,
        opacity=0.9,
        start_time=0,
        end_time=5,
        fade_in=0.5,
        fade_out=0.5,
    )
    print(f"Filter: {filter_graph}\n")

    print("Example: Multi-overlay graph")
    overlays = [
        {"input_label": "[1:v]", "position": "center", "scale": 0.3, "start_time": 0, "end_time": 5, "fade_in": 0.5, "fade_out": 0.5},
        {"input_label": "[2:v]", "position": "bottom-right", "scale": 0.1, "opacity": 0.5},
    ]
    filter_graph = build_multi_overlay_graph(overlays)
    print(f"Filter: {filter_graph}")
