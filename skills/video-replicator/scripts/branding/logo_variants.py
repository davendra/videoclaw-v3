#!/usr/bin/env python3
"""
Logo Variant Generation.

Handles creating different logo variants (horizontal, icon, white) through:
1. Auto-crop for simple logos
2. Go Bananas AI generation for complex logos
"""

from dataclasses import dataclass

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


# Go Bananas prompt templates for logo variants
LOGO_PROMPTS = {
    "horizontal": (
        "Redesign this logo in a HORIZONTAL layout suitable for a thin banner. "
        "Place the icon/symbol on the LEFT, company name on the RIGHT. "
        "Keep exact colors and style. Transparent background. PNG."
    ),
    "icon_only": (
        "Extract ONLY the icon/symbol from this logo. No text. "
        "Clean edges, transparent background. PNG."
    ),
    "white_version": (
        "Recreate this exact logo in SOLID WHITE color. "
        "Transparent background. Keep all details. PNG."
    ),
    "cleanup": (
        "Clean up this logo: remove background, sharpen edges, "
        "increase resolution. Keep exact design. Transparent PNG."
    ),
}


@dataclass
class LogoQualityAnalysis:
    """Results of logo quality analysis."""
    issues: list[str]
    needs_enhancement: bool
    width: int = 0
    height: int = 0
    has_transparency: bool = False
    is_stacked: bool = False  # Height > width * 1.5


def analyze_logo_quality(logo_path: str) -> LogoQualityAnalysis:
    """
    Analyze logo quality and detect issues that need fixing.

    Checks:
    - Resolution (< 500px is low)
    - Background (solid background needs removal)
    - Layout (stacked layout may need horizontal variant)

    Args:
        logo_path: Path to logo file

    Returns:
        LogoQualityAnalysis with issues list and enhancement flag
    """
    if not HAS_PIL:
        return LogoQualityAnalysis(
            issues=["PIL not installed - cannot analyze"],
            needs_enhancement=True
        )

    issues = []

    try:
        img = Image.open(logo_path)
        width, height = img.size

        # Check resolution
        if width < 500 or height < 500:
            issues.append("low_resolution")

        # Check for transparency
        has_transparency = img.mode in ("RGBA", "LA") or (
            img.mode == "P" and "transparency" in img.info
        )

        if not has_transparency:
            issues.append("no_transparency")

        # Check for solid background (sample corners)
        if img.mode in ("RGBA", "LA"):
            img_rgba = img.convert("RGBA")
            corners = [
                img_rgba.getpixel((0, 0)),
                img_rgba.getpixel((width - 1, 0)),
                img_rgba.getpixel((0, height - 1)),
                img_rgba.getpixel((width - 1, height - 1)),
            ]
            # If corners are opaque and similar, likely has background
            if all(c[3] > 200 for c in corners):  # Alpha > 200
                avg_r = sum(c[0] for c in corners) / 4
                avg_g = sum(c[1] for c in corners) / 4
                avg_b = sum(c[2] for c in corners) / 4
                variance = sum(
                    abs(c[0] - avg_r) + abs(c[1] - avg_g) + abs(c[2] - avg_b)
                    for c in corners
                ) / 4
                if variance < 50:  # Corners are similar
                    issues.append("needs_transparency")

        # Check if stacked layout
        is_stacked = height > width * 1.5
        if is_stacked:
            issues.append("stacked_layout")

        return LogoQualityAnalysis(
            issues=issues,
            needs_enhancement=len(issues) > 0,
            width=width,
            height=height,
            has_transparency=has_transparency,
            is_stacked=is_stacked,
        )

    except Exception as e:
        return LogoQualityAnalysis(
            issues=[f"analysis_error: {str(e)}"],
            needs_enhancement=True
        )


def auto_crop_to_horizontal(logo_path: str, output_path: str) -> bool:
    """
    Attempt to auto-crop logo to horizontal layout.

    Works best for logos that are already mostly horizontal.
    For stacked layouts, returns False (needs AI).

    Args:
        logo_path: Path to source logo
        output_path: Path to save cropped logo

    Returns:
        True if successful, False if AI generation needed
    """
    if not HAS_PIL:
        return False

    try:
        img = Image.open(logo_path).convert("RGBA")
        width, height = img.size

        # If already horizontal or square-ish, just copy
        if width >= height * 0.8:
            img.save(output_path, "PNG")
            return True

        # For stacked layouts, auto-crop won't work well
        return False

    except Exception:
        return False


def auto_extract_icon(logo_path: str, output_path: str) -> bool:
    """
    Attempt to auto-extract icon from logo.

    Uses simple heuristics to find the icon portion.

    Args:
        logo_path: Path to source logo
        output_path: Path to save icon

    Returns:
        True if successful, False if AI generation needed
    """
    if not HAS_PIL:
        return False

    try:
        img = Image.open(logo_path).convert("RGBA")
        width, height = img.size

        # Simple approach: if square-ish, assume it's already icon-like
        if 0.8 <= width / height <= 1.2:
            img.save(output_path, "PNG")
            return True

        # For horizontal logos, try to extract left portion
        if width > height:
            icon_size = min(width, height)
            # Crop square from left side
            cropped = img.crop((0, 0, icon_size, height))
            cropped.save(output_path, "PNG")
            return True

        return False

    except Exception:
        return False


def convert_to_white(logo_path: str, output_path: str) -> bool:
    """
    Convert logo to solid white color.

    Args:
        logo_path: Path to source logo
        output_path: Path to save white version

    Returns:
        True if successful, False if AI generation needed
    """
    if not HAS_PIL:
        return False

    try:
        img = Image.open(logo_path).convert("RGBA")
        data = img.getdata()

        # Replace non-transparent pixels with white
        new_data = []
        for item in data:
            if item[3] > 0:  # If not fully transparent
                new_data.append((255, 255, 255, item[3]))
            else:
                new_data.append(item)

        img.putdata(new_data)
        img.save(output_path, "PNG")
        return True

    except Exception:
        return False


def remove_background(logo_path: str, output_path: str, threshold: int = 240) -> bool:
    """
    Remove solid background from logo (simple approach).

    Args:
        logo_path: Path to source logo
        output_path: Path to save transparent version
        threshold: Brightness threshold for background detection (0-255)

    Returns:
        True if successful, False if AI generation needed
    """
    if not HAS_PIL:
        return False

    try:
        img = Image.open(logo_path).convert("RGBA")
        data = img.getdata()

        # Detect background color from corners
        width, height = img.size
        corners = [
            img.getpixel((0, 0)),
            img.getpixel((width - 1, 0)),
            img.getpixel((0, height - 1)),
            img.getpixel((width - 1, height - 1)),
        ]

        # Average corner color
        avg_r = int(sum(c[0] for c in corners) / 4)
        avg_g = int(sum(c[1] for c in corners) / 4)
        avg_b = int(sum(c[2] for c in corners) / 4)

        # Remove pixels similar to background
        new_data = []
        for item in data:
            diff = abs(item[0] - avg_r) + abs(item[1] - avg_g) + abs(item[2] - avg_b)
            if diff < 50:  # Similar to background
                new_data.append((0, 0, 0, 0))  # Transparent
            else:
                new_data.append(item)

        img.putdata(new_data)
        img.save(output_path, "PNG")
        return True

    except Exception:
        return False


def needs_go_bananas_enhancement(analysis: LogoQualityAnalysis) -> bool:
    """
    Determine if logo needs AI enhancement via Go Bananas.

    Args:
        analysis: LogoQualityAnalysis from analyze_logo_quality()

    Returns:
        True if AI enhancement recommended
    """
    # Stacked layout definitely needs AI for horizontal variant
    if analysis.is_stacked:
        return True

    # Multiple issues likely need AI
    if len(analysis.issues) >= 2:
        return True

    # Specific issues that need AI
    ai_needed_issues = {"stacked_layout", "needs_transparency"}
    return bool(set(analysis.issues) & ai_needed_issues)


def get_go_bananas_prompt(variant_type: str) -> str:
    """
    Get the Go Bananas prompt for a logo variant type.

    Args:
        variant_type: One of "horizontal", "icon_only", "white_version", "cleanup"

    Returns:
        Prompt string for Go Bananas
    """
    return LOGO_PROMPTS.get(variant_type, LOGO_PROMPTS["cleanup"])


def print_quality_report(analysis: LogoQualityAnalysis, logo_path: str) -> None:
    """Print a quality report for a logo."""
    print(f"\nLogo Quality Analysis: {logo_path}")
    print(f"  Dimensions: {analysis.width}x{analysis.height}")
    print(f"  Has transparency: {analysis.has_transparency}")
    print(f"  Is stacked: {analysis.is_stacked}")
    print(f"  Issues found: {', '.join(analysis.issues) if analysis.issues else 'None'}")
    print(f"  Needs AI enhancement: {analysis.needs_enhancement}")
