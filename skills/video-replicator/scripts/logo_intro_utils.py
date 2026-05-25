#!/usr/bin/env python3
"""
Logo Intro Overlay Utilities

Creates a professional logo intro overlay with:
- Semi-transparent background (white or dark based on logo)
- Logo centered and proportionally sized
- Proper margins/padding

Used by stitch_video.py for the --logo-intro-overlay feature.
"""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import MissingDependencyError, VideoProcessingError

try:
    from PIL import Image, ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def get_video_dimensions(video_path: str) -> tuple[int, int]:
    """Get video width and height using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise VideoProcessingError(f"ffprobe failed: {result.stderr}")

    dims = result.stdout.strip().split(",")
    return int(dims[0]), int(dims[1])


def detect_logo_background(logo_path: str) -> str:
    """
    Detect if logo has dark or light background/content.
    Returns 'light' or 'dark' to suggest overlay background color.
    """
    if not HAS_PIL:
        return "light"  # Default to white overlay

    try:
        img = Image.open(logo_path).convert("RGBA")
        # Sample pixels from the logo
        pixels = list(img.getdata())

        # Calculate average brightness of non-transparent pixels
        total_brightness = 0
        count = 0
        for r, g, b, a in pixels:
            if a > 128:  # Only count non-transparent pixels
                brightness = (r + g + b) / 3
                total_brightness += brightness
                count += 1

        if count == 0:
            return "light"

        avg_brightness = total_brightness / count
        # If logo is mostly dark, use light (white) background
        # If logo is mostly light, use dark background
        return "light" if avg_brightness < 128 else "dark"
    except Exception:
        return "light"


def create_logo_intro_composite(
    logo_path: str,
    video_width: int,
    video_height: int,
    output_path: str,
    logo_scale: float = 0.35,
    bg_opacity: float = 0.75,
    bg_color: str = "auto",
) -> str:
    """
    Create a composite overlay image with logo on semi-transparent background.

    Args:
        logo_path: Path to logo image (PNG or other)
        video_width: Target video width
        video_height: Target video height
        output_path: Where to save the composite PNG
        logo_scale: Logo width as fraction of video width (default: 0.35)
        bg_opacity: Background opacity 0.0-1.0 (default: 0.75)
        bg_color: 'light' (white), 'dark' (black), or 'auto' (detect from logo)

    Returns:
        Path to the created composite image
    """
    if not HAS_PIL:
        raise MissingDependencyError("PIL not installed. Run: pip install Pillow")

    # Load logo
    logo = Image.open(logo_path).convert("RGBA")
    logo_w, logo_h = logo.size

    # Calculate scaled logo size (maintain aspect ratio)
    target_logo_width = int(video_width * logo_scale)
    scale_factor = target_logo_width / logo_w
    target_logo_height = int(logo_h * scale_factor)

    # Ensure logo isn't too tall (max 60% of video height)
    max_height = int(video_height * 0.6)
    if target_logo_height > max_height:
        scale_factor = max_height / logo_h
        target_logo_height = max_height
        target_logo_width = int(logo_w * scale_factor)

    # Resize logo
    logo_resized = logo.resize((target_logo_width, target_logo_height), Image.LANCZOS)

    # Determine background color
    if bg_color == "auto":
        bg_color = detect_logo_background(logo_path)

    # Create background with semi-transparency
    if bg_color == "light":
        bg_rgba = (255, 255, 255, int(255 * bg_opacity))
    else:
        bg_rgba = (0, 0, 0, int(255 * bg_opacity))

    # Create canvas
    canvas = Image.new("RGBA", (video_width, video_height), (0, 0, 0, 0))

    # Draw semi-transparent background
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, 0, video_width, video_height], fill=bg_rgba)

    # Calculate centered position for logo
    x = (video_width - target_logo_width) // 2
    y = (video_height - target_logo_height) // 2

    # Paste logo onto canvas (using logo's alpha as mask)
    canvas.paste(logo_resized, (x, y), logo_resized)

    # Save composite
    canvas.save(output_path, "PNG")
    print(f"  Created logo composite: {output_path}")
    print(f"    Video: {video_width}x{video_height}, Logo: {target_logo_width}x{target_logo_height}")
    print(f"    Background: {bg_color} @ {int(bg_opacity*100)}% opacity")

    return output_path


def create_logo_intro_composite_ffmpeg(
    logo_path: str,
    video_width: int,
    video_height: int,
    output_path: str,
    logo_scale: float = 0.35,
    bg_opacity: float = 0.75,
    bg_color: str = "white",
) -> str:
    """
    Create composite using FFmpeg (fallback if PIL not available).

    Uses FFmpeg's lavfi to create a colored background and overlay the logo.
    """
    # Calculate logo dimensions
    probe_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        logo_path
    ]
    result = subprocess.run(probe_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise VideoProcessingError(f"Cannot read logo dimensions: {result.stderr}")

    logo_dims = result.stdout.strip().split(",")
    logo_w, logo_h = int(logo_dims[0]), int(logo_dims[1])

    # Calculate scaled size
    target_width = int(video_width * logo_scale)
    scale_factor = target_width / logo_w
    target_height = int(logo_h * scale_factor)

    # Cap height at 60% of video
    max_height = int(video_height * 0.6)
    if target_height > max_height:
        scale_factor = max_height / logo_h
        target_height = max_height
        target_width = int(logo_w * scale_factor)

    # Background color
    hex_color = "FFFFFF" if bg_color == "white" else "000000"
    # FFmpeg filter to create composite
    _filter_str = (
        f"color=c=#{hex_color}@{bg_opacity}:s={video_width}x{video_height}:d=1[bg];"
        f"[1:v]scale={target_width}:{target_height}[logo];"
        f"[bg][logo]overlay=(W-w)/2:(H-h)/2"
    )

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=#{hex_color}:s={video_width}x{video_height}:d=1",
        "-i", logo_path,
        "-filter_complex", f"[1:v]scale={target_width}:{target_height}[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2",
        "-frames:v", "1",
        output_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise VideoProcessingError(f"FFmpeg composite failed: {result.stderr}")

    return output_path


if __name__ == "__main__":
    # Test
    import sys
    if len(sys.argv) < 4:
        print("Usage: python logo_intro_utils.py <logo_path> <video_path> <output_path>")
        sys.exit(1)

    logo = sys.argv[1]
    video = sys.argv[2]
    output = sys.argv[3]

    width, height = get_video_dimensions(video)
    create_logo_intro_composite(logo, width, height, output)
    print(f"Created: {output}")
