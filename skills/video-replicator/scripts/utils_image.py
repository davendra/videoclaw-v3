#!/usr/bin/env python3
"""
Image processing functions — crop, resize, and dimension queries.

Extracted from utils.py — handles portrait/landscape conversions,
dimension detection, and aspect ratio checks for individual images.
"""

import os
import subprocess

from config import (
    LANDSCAPE_HEIGHT,
    LANDSCAPE_WIDTH,
    PORTRAIT_HEIGHT,
    PORTRAIT_WIDTH,
)


def get_image_dimensions(path: str) -> tuple[int, int] | None:
    """
    Get image dimensions (width, height).

    Uses sips (macOS) or PIL as fallback.
    """
    try:
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")
            width = height = None
            for line in lines:
                if "pixelWidth" in line:
                    width = int(line.split()[-1])
                elif "pixelHeight" in line:
                    height = int(line.split()[-1])
            if width and height:
                return (width, height)
    except Exception:
        pass

    try:
        from PIL import Image
        with Image.open(path) as img:
            return img.size
    except Exception:
        pass

    return None


def get_aspect_ratio_type(width: int, height: int) -> str:
    """
    Determine aspect ratio type from dimensions.

    Returns:
        "portrait" (9:16), "landscape" (16:9), or "square" (1:1)
    """
    ratio = width / height
    if ratio > 1.2:
        return "landscape"
    elif ratio < 0.8:
        return "portrait"
    return "square"


def get_aspect_ratio_string(width: int, height: int) -> str:
    """Get aspect ratio as string (e.g., '16:9', '9:16', '1:1')."""
    ratio = width / height
    if 1.7 <= ratio <= 1.8:
        return "16:9"
    elif 0.55 <= ratio <= 0.6:
        return "9:16"
    elif 0.9 <= ratio <= 1.1:
        return "1:1"
    elif 1.3 <= ratio <= 1.4:
        return "4:3"
    elif 0.7 <= ratio <= 0.8:
        return "3:4"
    return f"{width}:{height}"


def crop_landscape_to_portrait(
    image_path: str,
    output_path: str | None = None,
    width: int = PORTRAIT_WIDTH,
    height: int = PORTRAIT_HEIGHT
) -> str | None:
    """
    Convert any image to portrait (9:16) at exactly 504x896 pixels.

    Uses Sharp (via Node.js script) with PIL fallback.
    """
    if not os.path.exists(image_path):
        print(f"  Error: Image not found: {image_path}")
        return None

    dims = get_image_dimensions(image_path)
    if not dims:
        print(f"  Error: Could not read image dimensions: {image_path}")
        return None

    w, h = dims

    if w == width and h == height:
        print(f"  Image already {width}x{height}, skipping resize")
        return image_path

    if output_path is None:
        base, ext = os.path.splitext(image_path)
        output_path = f"{base}_cropped{ext}"

    if os.path.exists(output_path):
        out_dims = get_image_dimensions(output_path)
        if out_dims and out_dims[0] == width and out_dims[1] == height:
            print(f"  Cropped version already exists at {width}x{height}: {output_path}")
            return output_path

    ratio_type = get_aspect_ratio_type(w, h)
    print(f"  Converting {ratio_type} image ({w}x{h}) to portrait ({width}x{height})")

    sharp_script = os.path.join(os.path.dirname(__file__), "crop_to_portrait.js")
    if os.path.exists(sharp_script):
        try:
            result = subprocess.run(
                ["node", sharp_script, image_path, output_path,
                 "--width", str(width), "--height", str(height)],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode == 0 and os.path.exists(output_path):
                print(f"  Processed (Sharp): {image_path} -> {output_path}")
                return output_path
            else:
                print(f"  Sharp processing failed: {result.stderr[:200]}")
        except Exception as e:
            print(f"  Sharp not available: {e}")

    return _crop_with_pil(image_path, output_path, width, height)


def _crop_with_pil(
    image_path: str,
    output_path: str,
    target_width: int = PORTRAIT_WIDTH,
    target_height: int = PORTRAIT_HEIGHT
) -> str | None:
    """Crop image to portrait using PIL (fallback method)."""
    try:
        from PIL import Image
    except ImportError:
        print("  Error: PIL not installed. Run: pip install Pillow")
        return None

    try:
        with Image.open(image_path) as img:
            w, h = img.size
            target_ratio = target_width / target_height

            if w / h > target_ratio:
                new_width = int(h * target_ratio)
                left = (w - new_width) // 2
                box = (left, 0, left + new_width, h)
            else:
                new_height = int(w / target_ratio)
                top = (h - new_height) // 2
                box = (0, top, w, top + new_height)

            cropped = img.crop(box)

            if cropped.size != (target_width, target_height):
                cropped = cropped.resize((target_width, target_height), Image.Resampling.LANCZOS)

            cropped.save(output_path, quality=95)
            print(f"  Cropped (PIL): {image_path} -> {output_path}")
            return output_path

    except Exception as e:
        print(f"  Error cropping with PIL: {e}")
        return None


def resize_to_landscape(
    image_path: str,
    output_path: str | None = None,
    width: int = LANDSCAPE_WIDTH,
    height: int = LANDSCAPE_HEIGHT
) -> str | None:
    """
    Resize any image to landscape (16:9) at exactly 1280x720 pixels.

    Uses sips (macOS native, fast) with PIL fallback.
    """
    if not os.path.exists(image_path):
        print(f"  Error: Image not found: {image_path}")
        return None

    dims = get_image_dimensions(image_path)
    if not dims:
        print(f"  Error: Could not read image dimensions: {image_path}")
        return None

    w, h = dims

    if w == width and h == height:
        print(f"  Image already {width}x{height}, skipping resize")
        return image_path

    if output_path is None:
        base, ext = os.path.splitext(image_path)
        output_path = f"{base}_landscape{ext}"

    if os.path.exists(output_path):
        out_dims = get_image_dimensions(output_path)
        if out_dims and out_dims[0] == width and out_dims[1] == height:
            print(f"  Landscape version already exists at {width}x{height}: {output_path}")
            return output_path

    current_ratio = w / h
    target_ratio = width / height

    print(f"  Converting ({w}x{h}, ratio {current_ratio:.2f}) to landscape ({width}x{height})")

    try:
        if abs(current_ratio - target_ratio) / target_ratio < 0.05:
            result = subprocess.run(
                ["sips", "-z", str(height), str(width), image_path, "--out", output_path],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0 and os.path.exists(output_path):
                print(f"  Resized (sips): {image_path} -> {output_path}")
                return output_path
    except Exception as e:
        print(f"  sips not available or failed: {e}")

    return _resize_landscape_with_pil(image_path, output_path, width, height)


def _resize_landscape_with_pil(
    image_path: str,
    output_path: str,
    target_width: int = LANDSCAPE_WIDTH,
    target_height: int = LANDSCAPE_HEIGHT
) -> str | None:
    """Resize image to landscape using PIL (handles cropping if needed)."""
    try:
        from PIL import Image
    except ImportError:
        print("  Error: PIL not installed. Run: pip install Pillow")
        return None

    try:
        with Image.open(image_path) as img:
            w, h = img.size
            target_ratio = target_width / target_height

            if w / h > target_ratio:
                new_width = int(h * target_ratio)
                left = (w - new_width) // 2
                box = (left, 0, left + new_width, h)
            else:
                new_height = int(w / target_ratio)
                top = (h - new_height) // 2
                box = (0, top, w, top + new_height)

            cropped = img.crop(box)

            if cropped.size != (target_width, target_height):
                cropped = cropped.resize((target_width, target_height), Image.Resampling.LANCZOS)

            cropped.save(output_path, quality=95)
            print(f"  Resized (PIL): {image_path} -> {output_path}")
            return output_path

    except Exception as e:
        print(f"  Error resizing with PIL: {e}")
        return None


def get_aspect_ratio_prompt_hint(ratio: str) -> str:
    """
    Return a prompt hint string to reinforce the desired aspect ratio.

    Go Bananas sometimes ignores the ``aspect_ratio`` parameter, especially
    for portrait images (outputting near-square 928x1152 instead of true 9:16
    at 504x896).  Including an explicit textual hint in the prompt
    significantly increases compliance.

    Args:
        ratio: One of "portrait", "landscape", or "square".

    Returns:
        A short directive string to prepend/append to the generation prompt.

    Examples:
        >>> get_aspect_ratio_prompt_hint("portrait")
        'TALL VERTICAL portrait orientation, 9:16 aspect ratio'
        >>> get_aspect_ratio_prompt_hint("landscape")
        'WIDE HORIZONTAL landscape orientation, 16:9 widescreen'
    """
    hints = {
        "portrait": "TALL VERTICAL portrait orientation, 9:16 aspect ratio",
        "landscape": "WIDE HORIZONTAL landscape orientation, 16:9 widescreen",
        "square": "PERFECT SQUARE 1:1 aspect ratio",
    }
    key = ratio.lower().strip()
    return hints.get(key, "")


def validate_aspect_ratios(image_paths: list[str]) -> dict:
    """
    Check aspect ratio consistency across images.

    Returns:
        Dict with consistent, detected_ratio, images, and errors fields
    """
    result = {
        "consistent": True,
        "detected_ratio": None,
        "images": {},
        "errors": []
    }

    ratios = set()
    for path in image_paths:
        if not os.path.exists(path):
            result["errors"].append(f"File not found: {path}")
            continue

        dims = get_image_dimensions(path)
        if not dims:
            result["errors"].append(f"Could not read dimensions: {path}")
            continue

        ratio_type = get_aspect_ratio_type(dims[0], dims[1])
        ratios.add(ratio_type)
        result["images"][path] = {"dims": dims, "ratio": ratio_type}

    if len(ratios) > 1:
        result["consistent"] = False
        result["errors"].append(f"Mixed aspect ratios: {', '.join(ratios)}")
    elif len(ratios) == 1:
        result["detected_ratio"] = list(ratios)[0]

    return result
