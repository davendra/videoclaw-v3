#!/usr/bin/env python3
"""Generate a title card image and hold video for Nex Presenter videos.

Two-phase workflow:
  Phase 1 (--generate): Outputs Go Bananas MCP command for image generation.
  Phase 2 (--process):  Downloads/processes raw image → PIL text overlay → FFmpeg hold video.

Examples:
  # Phase 1: Get Go Bananas MCP command
  python generate_title_card.py --project projects/kinetic-shift \\
    --title "THE KINETIC SHIFT" \\
    --subtitle "Agents, Vibe Coding & the Infrastructure War" \\
    --character-id 98

  # Phase 2: Process downloaded image into hold video
  python generate_title_card.py --project projects/kinetic-shift \\
    --process --raw-image projects/kinetic-shift/assets/title_card_raw.jpg \\
    --title "THE KINETIC SHIFT" \\
    --subtitle "Agents, Vibe Coding & the Infrastructure War"

  # Auto-extract title from PDF (Phase 1)
  python generate_title_card.py --project projects/kinetic-shift \\
    --pdf projects/kinetic-shift/reference/slides.pdf \\
    --character-id 98

  # Dry-run (preview without generating)
  python generate_title_card.py --project projects/kinetic-shift \\
    --title "MY TITLE" --dry-run
"""

import argparse
import json
import os
import subprocess
import sys

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_DIR)

from config import (
    GEMINI_FLASH_MODEL,
    LANDSCAPE_HEIGHT,
    LANDSCAPE_WIDTH,
    TITLE_CARD_BAND_OPACITY,
    TITLE_CARD_BAND_TOP,
    TITLE_CARD_DURATION,
    TITLE_CARD_FONT,
    TITLE_CARD_FONT_FALLBACK,
    TITLE_CARD_FPS,
    TITLE_CARD_HEIGHT,
    TITLE_CARD_SUBTITLE_COLOR,
    TITLE_CARD_SUBTITLE_FONT_SIZE,
    TITLE_CARD_TITLE_COLOR,
    TITLE_CARD_TITLE_FONT_SIZE,
    TITLE_CARD_TITLE_OUTLINE_WIDTH,
    TITLE_CARD_WIDTH,
)
from logging_config import setup_logging

logger = setup_logging(__name__)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate title card image and hold video for Nex Presenter",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  # Phase 1: Output Go Bananas MCP command
  python generate_title_card.py --project projects/my-deck \\
    --title "MY PRESENTATION" --subtitle "A Great Subtitle" \\
    --character-id 98

  # Phase 2: Process raw image into hold video
  python generate_title_card.py --project projects/my-deck \\
    --process --raw-image assets/title_card_raw.jpg \\
    --title "MY PRESENTATION" --subtitle "A Great Subtitle"
""",
    )
    parser.add_argument("--project", required=True, help="Project directory")
    parser.add_argument("--title", help="Title text (large, white, upper area of dark band)")
    parser.add_argument("--subtitle", help="Subtitle text (smaller, light blue, below title)")
    parser.add_argument("--pdf", help="Extract title from first page of PDF (requires Gemini)")
    parser.add_argument("--character-id", type=int, default=98, help="Go Bananas character ID (default: 98 = Nex)")
    parser.add_argument("--duration", type=int, default=TITLE_CARD_DURATION, help="Hold video duration in seconds (default: %d)" % TITLE_CARD_DURATION)
    parser.add_argument("--process", action="store_true", help="Phase 2: process raw image into final title card + hold video")
    parser.add_argument("--raw-image", help="Path to raw Go Bananas image (for --process)")
    parser.add_argument("--image-url", help="URL to download raw image from (for --process)")
    parser.add_argument("--no-text", action="store_true", help="Skip text overlay (image-only title card)")
    parser.add_argument("--style", choices=["dark", "light", "gradient"], default="dark",
                        help="Text band style (default: dark)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without generating")
    parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    return parser.parse_args()


def extract_title_from_pdf(pdf_path):
    """Extract title and subtitle from PDF first page using Gemini Vision."""
    try:
        import google.genai as genai

        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            logger.warning("GOOGLE_API_KEY not set — cannot extract title from PDF")
            return None, None

        client = genai.Client(api_key=api_key)

        pdf_size = os.path.getsize(pdf_path)
        max_pdf_bytes = 15 * 1024 * 1024  # 15 MB inline limit
        if pdf_size > max_pdf_bytes:
            logger.warning(
                "PDF too large for inline API (%d MB > 15 MB limit) — cannot extract title",
                pdf_size // (1024 * 1024),
            )
            return None, None

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        response = client.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=[
                {"mime_type": "application/pdf", "data": pdf_bytes},
                "Extract the main title and subtitle from the first page of this presentation. "
                "Return JSON: {\"title\": \"...\", \"subtitle\": \"...\"}. "
                "Title should be the main heading. Subtitle is the secondary line. "
                "If no subtitle exists, set subtitle to null.",
            ],
        )

        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        data = json.loads(text)
        return data.get("title"), data.get("subtitle")

    except Exception as e:
        logger.warning("PDF title extraction failed: %s", e)
        return None, None


def build_gobananas_prompt(title, subtitle, character_id):
    """Build Go Bananas MCP command for title card image generation."""
    scene_desc = "professional YouTube thumbnail composition"
    if subtitle:
        scene_desc += f" for a presentation about {subtitle}"

    prompt = (
        "WIDE HORIZONTAL cinematic YouTube thumbnail composition. "
        f"Professional person on the RIGHT side of frame, facing camera, confident pose, "
        f"business attire, studio-quality lighting. "
        f"LEFT side: dramatic visualization of technology, abstract data flows, "
        f"glowing circuit patterns, holographic displays. "
        f"Rich dark background with blue and purple accent lighting. "
        f"Cinematic depth of field, 8K quality. "
        f"NO TEXT anywhere in the image. No words, no letters, no numbers, no captions."
    )

    mcp_command = {
        "tool": "mcp__go-bananas__generate_image",
        "params": {
            "prompt": prompt,
            "character_id": character_id,
            "aspect_ratio": "16:9",
            "model_id": "gemini-pro-image",
        },
    }

    return mcp_command


def download_image(url, output_path):
    """Download image from URL using curl (handles R2 URLs better than urllib)."""
    cmd = [
        "curl", "-L", "-s",
        "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "-o", output_path,
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Download failed: {result.stderr}")
    if not os.path.exists(output_path) or os.path.getsize(output_path) < 1000:
        raise RuntimeError(f"Downloaded file too small or missing: {output_path}")
    return output_path


def process_image(raw_image_path, output_path, title=None, subtitle=None, style="dark", no_text=False):
    """Process raw Go Bananas image: center-crop to 16:9, resize, add text overlay."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.open(raw_image_path)
    orig_w, orig_h = img.size
    logger.info("  Raw image: %dx%d", orig_w, orig_h)

    # Center-crop to exact 16:9 ratio
    target_ratio = TITLE_CARD_WIDTH / TITLE_CARD_HEIGHT  # 1.778
    current_ratio = orig_w / orig_h

    if current_ratio > target_ratio:
        # Too wide — crop horizontally
        new_w = int(orig_h * target_ratio)
        left = (orig_w - new_w) // 2
        img = img.crop((left, 0, left + new_w, orig_h))
    elif current_ratio < target_ratio:
        # Too tall — crop vertically
        new_h = int(orig_w / target_ratio)
        top = (orig_h - new_h) // 2
        img = img.crop((0, top, orig_w, top + new_h))

    # Resize to target dimensions
    img = img.resize((TITLE_CARD_WIDTH, TITLE_CARD_HEIGHT), Image.LANCZOS)
    logger.info("  Resized to: %dx%d", TITLE_CARD_WIDTH, TITLE_CARD_HEIGHT)

    if not no_text and (title or subtitle):
        # Create overlay for text band
        overlay = Image.new("RGBA", (TITLE_CARD_WIDTH, TITLE_CARD_HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Semi-transparent dark band at bottom
        band_color = {
            "dark": (0, 0, 0, TITLE_CARD_BAND_OPACITY),
            "light": (255, 255, 255, TITLE_CARD_BAND_OPACITY),
            "gradient": (0, 0, 0, TITLE_CARD_BAND_OPACITY),
        }.get(style, (0, 0, 0, TITLE_CARD_BAND_OPACITY))

        draw.rectangle(
            [(0, TITLE_CARD_BAND_TOP), (TITLE_CARD_WIDTH, TITLE_CARD_HEIGHT)],
            fill=band_color,
        )

        # Load fonts
        title_font = _load_font(TITLE_CARD_TITLE_FONT_SIZE)
        subtitle_font = _load_font(TITLE_CARD_SUBTITLE_FONT_SIZE)

        # Text colors based on style
        if style == "light":
            title_color = "black"
            subtitle_color = "#333366"
            outline_color = "white"
        else:
            title_color = TITLE_CARD_TITLE_COLOR
            subtitle_color = TITLE_CARD_SUBTITLE_COLOR
            outline_color = "black"

        # Draw title text (centered in band)
        if title:
            title_upper = title.upper()
            bbox = draw.textbbox((0, 0), title_upper, font=title_font)
            text_w = bbox[2] - bbox[0]
            title_x = (TITLE_CARD_WIDTH - text_w) // 2
            title_y = TITLE_CARD_BAND_TOP + 30

            # Outline for legibility
            for dx in range(-TITLE_CARD_TITLE_OUTLINE_WIDTH, TITLE_CARD_TITLE_OUTLINE_WIDTH + 1):
                for dy in range(-TITLE_CARD_TITLE_OUTLINE_WIDTH, TITLE_CARD_TITLE_OUTLINE_WIDTH + 1):
                    if dx != 0 or dy != 0:
                        draw.text((title_x + dx, title_y + dy), title_upper, font=title_font, fill=outline_color)
            draw.text((title_x, title_y), title_upper, font=title_font, fill=title_color)

        # Draw subtitle text
        if subtitle:
            bbox = draw.textbbox((0, 0), subtitle, font=subtitle_font)
            text_w = bbox[2] - bbox[0]
            sub_x = (TITLE_CARD_WIDTH - text_w) // 2
            sub_y = TITLE_CARD_BAND_TOP + 95
            draw.text((sub_x, sub_y), subtitle, font=subtitle_font, fill=subtitle_color)

        # Composite overlay onto image
        img = img.convert("RGBA")
        img = Image.alpha_composite(img, overlay)
        img = img.convert("RGB")

    img.save(output_path, quality=95)
    logger.info("  Saved: %s", output_path)
    return output_path


def _load_font(size):
    """Load font with fallback chain."""
    from PIL import ImageFont

    for font_name in [TITLE_CARD_FONT, TITLE_CARD_FONT_FALLBACK, "DejaVu Sans Bold"]:
        try:
            return ImageFont.truetype(font_name, size)
        except (OSError, IOError):
            continue

    # System font paths on macOS
    for path in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
    ]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except (OSError, IOError):
                continue

    logger.warning("  No TrueType font found, using PIL default")
    return ImageFont.load_default()


def create_hold_video(image_path, output_path, duration, fps=TITLE_CARD_FPS):
    """Create a hold video from a static image with silent audio."""
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", image_path,
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
        "-c:v", "libx264", "-t", str(duration),
        "-pix_fmt", "yuv420p", "-r", str(fps),
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg hold video failed: {result.stderr[-500:]}")

    logger.info("  Hold video: %s (%ds, %dfps)", output_path, duration, fps)
    return output_path


def main():
    args = parse_args()
    global logger
    logger = setup_logging("title_card", verbose=args.verbose)

    project = args.project
    # Resolve project path: try as-is first, then prepend "projects/"
    if not os.path.isdir(project):
        candidate = os.path.join("projects", project)
        if os.path.isdir(candidate):
            project = candidate
            logger.info("Resolved project path: %s", project)
    assets_dir = os.path.join(project, "assets")
    os.makedirs(assets_dir, exist_ok=True)

    # Extract title from PDF if requested
    title = args.title
    subtitle = args.subtitle

    if args.pdf and not title:
        logger.info("Extracting title from PDF: %s", args.pdf)
        title, subtitle = extract_title_from_pdf(args.pdf)
        if title:
            logger.info("  Title: %s", title)
            if subtitle:
                logger.info("  Subtitle: %s", subtitle)
        else:
            logger.error("Could not extract title from PDF. Use --title manually.")
            sys.exit(1)

    # Phase 2: Process raw image
    if args.process:
        raw_image = args.raw_image

        # Download from URL if provided
        if args.image_url and not raw_image:
            raw_image = os.path.join(assets_dir, "title_card_raw.jpg")
            logger.info("Downloading raw image...")
            download_image(args.image_url, raw_image)

        if not raw_image or not os.path.exists(raw_image):
            logger.error("--raw-image path required for --process (or --image-url)")
            sys.exit(1)

        if not title and not args.no_text:
            logger.error("--title required for text overlay (or use --no-text)")
            sys.exit(1)

        final_image = os.path.join(assets_dir, "title_card_final.jpg")
        hold_video = os.path.join(assets_dir, f"title_card_{args.duration}s.mp4")

        if args.dry_run:
            logger.info("DRY RUN — would process:")
            logger.info("  Raw image: %s", raw_image)
            logger.info("  Title: %s", title)
            logger.info("  Subtitle: %s", subtitle)
            logger.info("  Output image: %s", final_image)
            logger.info("  Output video: %s (%ds)", hold_video, args.duration)
            return

        logger.info("=== Phase 2: Processing title card ===")

        # Step 1: Process image (crop, resize, text overlay)
        logger.info("Step 1: Image processing")
        process_image(raw_image, final_image, title=title, subtitle=subtitle,
                      style=args.style, no_text=args.no_text)

        # Step 2: Create hold video
        logger.info("Step 2: Creating hold video")
        create_hold_video(final_image, hold_video, args.duration)

        logger.info("")
        logger.info("Title card ready:")
        logger.info("  Image: %s", final_image)
        logger.info("  Video: %s", hold_video)
        logger.info("")
        logger.info("Use with nex_assemble.py:")
        logger.info("  --title-card %s", hold_video)
        return

    # Phase 1: Generate Go Bananas MCP command
    if not title:
        logger.error("--title is required (or use --pdf to auto-extract)")
        sys.exit(1)

    logger.info("=== Phase 1: Generate title card image ===")
    logger.info("  Title: %s", title)
    if subtitle:
        logger.info("  Subtitle: %s", subtitle)
    logger.info("  Character ID: %d", args.character_id)

    mcp_cmd = build_gobananas_prompt(title, subtitle, args.character_id)

    if args.dry_run:
        logger.info("\nDRY RUN — Go Bananas MCP command:")
        print(json.dumps(mcp_cmd, indent=2))
        return

    logger.info("")
    logger.info("Execute this Go Bananas MCP command:")
    logger.info("")
    print(f"mcp__go-bananas__generate_image(")
    print(f'    prompt="{mcp_cmd["params"]["prompt"]}",')
    print(f'    character_id={mcp_cmd["params"]["character_id"]},')
    print(f'    aspect_ratio="{mcp_cmd["params"]["aspect_ratio"]}",')
    print(f'    model_id="{mcp_cmd["params"]["model_id"]}",')
    print(f")")
    logger.info("")
    logger.info("After downloading the image, run Phase 2:")
    logger.info("  python generate_title_card.py --project %s \\", project)
    logger.info("    --process --raw-image %s/title_card_raw.jpg \\", assets_dir)
    logger.info('    --title "%s" \\', title)
    if subtitle:
        logger.info('    --subtitle "%s"', subtitle)


if __name__ == "__main__":
    main()
