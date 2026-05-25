#!/usr/bin/env python3
"""
Generate title card and credits videos using PIL + FFmpeg.

Creates professional title cards and scrolling credits as MP4 videos
with silent audio tracks, compatible with FFmpeg concat for stitching.

Usage:
    # Title card (static text on background)
    python generate_title_credits.py \
        --type title \
        --text "LEGENDS OF THE ELEMENTS" \
        --subtitle "Extended Director's Cut" \
        --duration 20 \
        --output "projects/{slug}/videos/run001_scene_0_title.mp4"

    # Credits (scrolling text)
    python generate_title_credits.py \
        --type credits \
        --text "Created with Seedance 2.0\\nDirected by AI" \
        --duration 35 \
        --scroll \
        --output "projects/{slug}/videos/run001_scene_99_credits.mp4"
"""

import argparse
import os
import subprocess
import sys
import tempfile

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


# Default dimensions (1080p landscape)
DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080
DEFAULT_FPS = 30


def _find_font(size: int) -> ImageFont.FreeTypeFont:
    """Find a suitable system font or fall back to default."""
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in font_paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert hex color (#RRGGBB) to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def _render_title_frame(
    text: str,
    subtitle: str | None = None,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    bg_color: str = "#000000",
    text_color: str = "#FFFFFF",
    font_size: int = 80,
    subtitle_size: int = 40,
) -> Image.Image:
    """Render a title card as a PIL Image."""
    bg_rgb = _hex_to_rgb(bg_color)
    text_rgb = _hex_to_rgb(text_color)

    img = Image.new("RGB", (width, height), bg_rgb)
    draw = ImageDraw.Draw(img)

    font = _find_font(font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Center the title
    total_h = text_h
    if subtitle:
        sub_font = _find_font(subtitle_size)
        sub_bbox = draw.textbbox((0, 0), subtitle, font=sub_font)
        sub_h = sub_bbox[3] - sub_bbox[1]
        total_h += sub_h + 30  # 30px gap between title and subtitle

    y = (height - total_h) // 2
    x = (width - text_w) // 2
    draw.text((x, y), text, fill=text_rgb, font=font)

    if subtitle:
        sub_font = _find_font(subtitle_size)
        sub_bbox = draw.textbbox((0, 0), subtitle, font=sub_font)
        sub_w = sub_bbox[2] - sub_bbox[0]
        sub_x = (width - sub_w) // 2
        sub_y = y + text_h + 30
        # Subtitle slightly dimmer
        sub_rgb = tuple(min(255, int(c * 0.7)) for c in text_rgb)
        draw.text((sub_x, sub_y), subtitle, fill=sub_rgb, font=sub_font)

    return img


def _render_credits_frame(
    text: str,
    scroll_offset: int = 0,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    bg_color: str = "#000000",
    text_color: str = "#FFFFFF",
    font_size: int = 36,
    line_spacing: int = 20,
) -> Image.Image:
    """Render a credits frame with scroll offset."""
    bg_rgb = _hex_to_rgb(bg_color)
    text_rgb = _hex_to_rgb(text_color)

    img = Image.new("RGB", (width, height), bg_rgb)
    draw = ImageDraw.Draw(img)
    font = _find_font(font_size)

    lines = text.split("\n")
    y = height - scroll_offset  # Start below screen, scroll up

    for line in lines:
        stripped = line.strip()
        if not stripped:
            y += font_size + line_spacing
            continue

        bbox = draw.textbbox((0, 0), stripped, font=font)
        text_w = bbox[2] - bbox[0]
        x = (width - text_w) // 2

        if -font_size < y < height + font_size:  # Only draw visible lines
            draw.text((x, y), stripped, fill=text_rgb, font=font)

        y += font_size + line_spacing

    return img


def generate_title_video(
    text: str,
    output_path: str,
    subtitle: str | None = None,
    duration: int = 10,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    bg_color: str = "#000000",
    text_color: str = "#FFFFFF",
    font_size: int = 80,
    fps: int = DEFAULT_FPS,
) -> str:
    """Generate a title card video with static text and silent audio."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        img = _render_title_frame(
            text=text, subtitle=subtitle,
            width=width, height=height,
            bg_color=bg_color, text_color=text_color,
            font_size=font_size,
        )
        img.save(tmp_path)

        cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-i", tmp_path,
            "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
            "-c:v", "libx264", "-t", str(duration),
            "-pix_fmt", "yuv420p", "-r", str(fps),
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            output_path,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            print(f"FFmpeg error: {result.stderr[:500]}")
            sys.exit(1)

        print(f"Title card generated: {output_path} ({duration}s)")
        return output_path

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def generate_credits_video(
    text: str,
    output_path: str,
    duration: int = 30,
    scroll: bool = True,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    bg_color: str = "#000000",
    text_color: str = "#FFFFFF",
    font_size: int = 36,
    fps: int = DEFAULT_FPS,
) -> str:
    """Generate a credits video with optional scrolling text and silent audio."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    if not scroll:
        # Static credits (same as title card)
        return generate_title_video(
            text=text, output_path=output_path, duration=duration,
            width=width, height=height, bg_color=bg_color,
            text_color=text_color, font_size=font_size, fps=fps,
        )

    # Scrolling credits: render frame sequence
    with tempfile.TemporaryDirectory() as tmp_dir:
        total_frames = duration * fps
        lines = text.split("\n")
        line_height = font_size + 20
        total_text_height = len(lines) * line_height
        # Scroll distance: from bottom of screen to above screen
        scroll_distance = height + total_text_height
        pixels_per_frame = scroll_distance / total_frames

        for frame_num in range(total_frames):
            offset = int(frame_num * pixels_per_frame)
            img = _render_credits_frame(
                text=text, scroll_offset=offset,
                width=width, height=height,
                bg_color=bg_color, text_color=text_color,
                font_size=font_size,
            )
            img.save(os.path.join(tmp_dir, f"frame_{frame_num:06d}.png"))

        # Encode frames to video with silent audio
        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", os.path.join(tmp_dir, "frame_%06d.png"),
            "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-t", str(duration),
            output_path,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f"FFmpeg error: {result.stderr[:500]}")
            sys.exit(1)

        print(f"Credits video generated: {output_path} ({duration}s, scrolling)")
        return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate title card or credits video")
    parser.add_argument("--type", choices=["title", "credits"], required=True,
                        help="Type of video to generate")
    parser.add_argument("--text", required=True,
                        help="Main text content (use \\n for line breaks)")
    parser.add_argument("--subtitle", default=None,
                        help="Subtitle text (title cards only)")
    parser.add_argument("--duration", type=int, default=10,
                        help="Video duration in seconds (default: 10)")
    parser.add_argument("--output", required=True,
                        help="Output video file path")
    parser.add_argument("--bg-color", default="#000000",
                        help="Background color hex (default: #000000)")
    parser.add_argument("--text-color", default="#FFFFFF",
                        help="Text color hex (default: #FFFFFF)")
    parser.add_argument("--font-size", type=int, default=None,
                        help="Font size (default: 80 for title, 36 for credits)")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH,
                        help=f"Video width (default: {DEFAULT_WIDTH})")
    parser.add_argument("--height", type=int, default=DEFAULT_HEIGHT,
                        help=f"Video height (default: {DEFAULT_HEIGHT})")
    parser.add_argument("--scroll", action="store_true",
                        help="Enable scrolling credits (credits type only)")
    parser.add_argument("--fps", type=int, default=DEFAULT_FPS,
                        help=f"Frame rate (default: {DEFAULT_FPS})")

    args = parser.parse_args()

    # Process escape sequences in text
    text = args.text.replace("\\n", "\n")

    font_size = args.font_size
    if font_size is None:
        font_size = 80 if args.type == "title" else 36

    if args.type == "title":
        generate_title_video(
            text=text,
            output_path=args.output,
            subtitle=args.subtitle,
            duration=args.duration,
            width=args.width,
            height=args.height,
            bg_color=args.bg_color,
            text_color=args.text_color,
            font_size=font_size,
            fps=args.fps,
        )
    else:
        generate_credits_video(
            text=text,
            output_path=args.output,
            duration=args.duration,
            scroll=args.scroll,
            width=args.width,
            height=args.height,
            bg_color=args.bg_color,
            text_color=args.text_color,
            font_size=font_size,
            fps=args.fps,
        )


if __name__ == "__main__":
    main()
