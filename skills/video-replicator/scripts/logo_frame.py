#!/usr/bin/env python3
"""Logo frame preparation — composite logo onto background for Veo I2V input."""

import os

from logo_presets import get_background_color, get_target_dims
from PIL import Image

LOGO_SCALE_FACTOR = 0.50
RAW_LOGO_SCALE = 0.65  # Logo takes 65% of canvas when padding to ratio


def prepare_logo_frame(
    logo_path: str,
    background: str,
    ratio: str,
    output_path: str,
    logo_scale: float = LOGO_SCALE_FACTOR,
) -> str:
    """Composite logo centered on a solid background at target dimensions."""
    target_w, target_h = get_target_dims(ratio)
    bg_color = get_background_color(background)

    canvas = Image.new("RGB", (target_w, target_h), bg_color)
    logo = Image.open(logo_path)

    max_logo_w = int(target_w * logo_scale)
    max_logo_h = int(target_h * logo_scale)
    logo.thumbnail((max_logo_w, max_logo_h), Image.LANCZOS)

    paste_x = (target_w - logo.width) // 2
    paste_y = (target_h - logo.height) // 2

    if logo.mode == "RGBA":
        canvas.paste(logo, (paste_x, paste_y), logo)
    else:
        logo_rgb = logo.convert("RGB")
        canvas.paste(logo_rgb, (paste_x, paste_y))

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    canvas.save(output_path, "JPEG", quality=95)
    return output_path


def _detect_bg_color(img: Image.Image) -> tuple[int, int, int]:
    """Detect background color by sampling the top-left region of the image.

    Logos often have text extending to the right/bottom edges, so the
    top-left corner is the most reliable indicator of background color.
    Samples a small patch and snaps to white/black if close.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    samples = []
    # Sample top-left 10x10 patch (safest area away from text)
    patch = min(10, w, h)
    for x in range(patch):
        for y in range(patch):
            samples.append(rgb.getpixel((x, y)))
    avg_r = sum(c[0] for c in samples) // len(samples)
    avg_g = sum(c[1] for c in samples) // len(samples)
    avg_b = sum(c[2] for c in samples) // len(samples)
    # Snap to pure white or black if close
    if avg_r > 220 and avg_g > 220 and avg_b > 220:
        return (255, 255, 255)
    if avg_r < 35 and avg_g < 35 and avg_b < 35:
        return (0, 0, 0)
    return (avg_r, avg_g, avg_b)


def pad_logo_to_ratio(
    logo_path: str,
    ratio: str,
    output_path: str,
    logo_scale: float = RAW_LOGO_SCALE,
) -> str:
    """Pad logo to target aspect ratio using the logo's own background color.

    Unlike prepare_logo_frame, this preserves the logo's natural look
    (no preset background) while ensuring it fits the target dimensions
    so Veo doesn't crop it.
    """
    target_w, target_h = get_target_dims(ratio)
    logo = Image.open(logo_path)
    bg_color = _detect_bg_color(logo)

    canvas = Image.new("RGB", (target_w, target_h), bg_color)

    max_logo_w = int(target_w * logo_scale)
    max_logo_h = int(target_h * logo_scale)
    logo.thumbnail((max_logo_w, max_logo_h), Image.LANCZOS)

    paste_x = (target_w - logo.width) // 2
    paste_y = (target_h - logo.height) // 2

    if logo.mode == "RGBA":
        canvas.paste(logo, (paste_x, paste_y), logo)
    else:
        logo_rgb = logo.convert("RGB")
        canvas.paste(logo_rgb, (paste_x, paste_y))

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    canvas.save(output_path, "JPEG", quality=95)
    return output_path
