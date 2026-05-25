#!/usr/bin/env python3
"""
Aspect ratio validation, fixing, and prompt adjustments.

Extracted from utils.py — validates image aspect ratios against targets,
auto-fixes mismatches, and adjusts prompts for ratio compliance.
"""

import os
import re
from pathlib import Path

from config import PORTRAIT_HEIGHT, PORTRAIT_WIDTH
from utils_image import (
    crop_landscape_to_portrait,
    get_aspect_ratio_type,
    get_image_dimensions,
)


def validate_and_fix_aspect_ratios(
    images_dir: str,
    target_ratio: str,
    auto_fix: bool = False
) -> dict:
    """
    Validate all images match target aspect ratio, optionally auto-fix.

    Returns:
        Dict with valid, images, mismatches, fixed, and count fields
    """
    results = {
        "valid": True,
        "images": [],
        "mismatches": [],
        "fixed": [],
        "portrait_count": 0,
        "landscape_count": 0,
        "square_count": 0
    }

    target_type = _normalize_ratio_type(target_ratio)

    images_path = Path(images_dir)
    image_files = sorted(
        images_path.glob("scene_*_frame.*"),
        key=lambda p: int(re.search(r"scene_(\d+)", p.name).group(1)) if re.search(r"scene_(\d+)", p.name) else 0
    )

    for img_file in image_files:
        dims = get_image_dimensions(str(img_file))
        if not dims:
            results["images"].append({
                "path": str(img_file),
                "width": 0,
                "height": 0,
                "ratio": "unknown",
                "matches": False,
                "action": "error"
            })
            continue

        w, h = dims
        img_type = get_aspect_ratio_type(w, h)

        if img_type == "portrait":
            results["portrait_count"] += 1
        elif img_type == "landscape":
            results["landscape_count"] += 1
        else:
            results["square_count"] += 1

        if target_type == "portrait":
            matches = (w == PORTRAIT_WIDTH and h == PORTRAIT_HEIGHT)
        else:
            matches = (img_type == target_type)
        action = "ok" if matches else "needs_fix"

        scene_match = re.search(r"scene_(\d+)", img_file.name)
        scene_num = int(scene_match.group(1)) if scene_match else 0

        if not matches:
            results["valid"] = False
            results["mismatches"].append(scene_num)

            if auto_fix:
                if target_type == "portrait":
                    fixed_path = crop_landscape_to_portrait(str(img_file))
                else:
                    fixed_path = crop_to_ratio(str(img_file), target_ratio)

                if fixed_path:
                    results["fixed"].append(scene_num)
                    action = "fixed"
                    dims = get_image_dimensions(fixed_path)
                    if dims:
                        w, h = dims
                        img_type = get_aspect_ratio_type(w, h)
                else:
                    action = "fix_failed"

        final_path = str(img_file)
        if action == "fixed" and target_type == "portrait":
            base, ext = os.path.splitext(str(img_file))
            cropped_path = f"{base}_cropped{ext}"
            if os.path.exists(cropped_path):
                final_path = cropped_path

        results["images"].append({
            "path": final_path,
            "original_path": str(img_file),
            "width": w,
            "height": h,
            "ratio": img_type,
            "matches": matches or action == "fixed",
            "action": action,
            "scene_number": scene_num
        })

    if auto_fix and results["fixed"]:
        unfixed = [m for m in results["mismatches"] if m not in results["fixed"]]
        if not unfixed:
            results["valid"] = True

    return results


def _normalize_ratio_type(ratio: str) -> str:
    """Convert ratio string to type (portrait/landscape/square)."""
    ratio_lower = ratio.lower()
    if ratio_lower in ("portrait", "9:16", "2:3", "3:4", "4:5"):
        return "portrait"
    elif ratio_lower in ("landscape", "16:9", "3:2", "4:3", "5:4", "21:9"):
        return "landscape"
    elif ratio_lower in ("square", "1:1"):
        return "square"
    return "landscape"


def crop_to_ratio(image_path: str, target_ratio: str) -> str | None:
    """Crop image to target aspect ratio (center crop). Saves in place."""
    try:
        from PIL import Image
    except ImportError:
        print("  Warning: PIL not installed, cannot auto-fix aspect ratio")
        return None

    ratios = {
        "9:16": 9/16, "16:9": 16/9, "1:1": 1.0,
        "portrait": 9/16, "landscape": 16/9, "square": 1.0,
        "2:3": 2/3, "3:2": 3/2, "4:3": 4/3, "3:4": 3/4,
    }
    target = ratios.get(target_ratio.lower(), 9/16)

    try:
        with Image.open(image_path) as img:
            w, h = img.size
            current_ratio = w / h

            if abs(current_ratio - target) < 0.05:
                return image_path

            if current_ratio > target:
                new_w = int(h * target)
                left = (w - new_w) // 2
                img = img.crop((left, 0, left + new_w, h))
            else:
                new_h = int(w / target)
                top = (h - new_h) // 2
                img = img.crop((0, top, w, top + new_h))

            img.save(image_path)
            return image_path
    except Exception as e:
        print(f"  Warning: Failed to crop {image_path}: {e}")
        return None


def add_aspect_ratio_to_prompt(prompt: str, target_ratio: str) -> str:
    """Add explicit aspect ratio instruction to prompt."""
    ratio_instruction = {
        "portrait": "9:16 vertical portrait aspect ratio, tall and narrow composition",
        "9:16": "9:16 vertical portrait aspect ratio, tall and narrow composition",
        "landscape": "16:9 horizontal landscape aspect ratio, wide cinematic composition",
        "16:9": "16:9 horizontal landscape aspect ratio, wide cinematic composition",
        "square": "1:1 square aspect ratio, centered balanced composition",
        "1:1": "1:1 square aspect ratio, centered balanced composition",
    }

    instruction = ratio_instruction.get(target_ratio.lower(), "")
    if instruction:
        return f"{prompt}. {instruction}. Maintain exact {target_ratio} aspect ratio."
    return prompt


def get_scene_type(prompt: str) -> str:
    """
    Detect if prompt is for product, character, or mixed shot.

    Product shots tend to go landscape even when portrait requested.
    """
    product_keywords = [
        "product", "sneaker", "shoe", "close-up of",
        "detail shot", "hero shot", "item", "object",
        "bottle", "package", "device", "gadget"
    ]
    character_keywords = [
        "woman", "man", "person", "model", "walking",
        "posing", "standing", "sitting", "running",
        "dancing", "looking", "wearing", "dressed"
    ]

    prompt_lower = prompt.lower()

    has_product = any(kw in prompt_lower for kw in product_keywords)
    has_character = any(kw in prompt_lower for kw in character_keywords)

    if has_product and not has_character:
        return "product"
    elif has_character and not has_product:
        return "character"
    return "mixed"


def adjust_prompt_for_ratio(prompt: str, target_ratio: str) -> str:
    """Add ratio-specific instructions based on scene type."""
    scene_type = get_scene_type(prompt)
    target_type = _normalize_ratio_type(target_ratio)

    if target_type == "portrait":
        if scene_type == "product":
            return (
                f"{prompt}. IMPORTANT: Vertical 9:16 portrait orientation. "
                "Product positioned vertically in frame. Tall narrow composition."
            )
        else:
            return f"{prompt}. 9:16 portrait vertical composition."
    elif target_type == "landscape":
        return f"{prompt}. 16:9 landscape horizontal composition."
    else:
        return f"{prompt}. 1:1 square centered composition."


def print_aspect_ratio_summary(validation_result: dict) -> None:
    """Print a summary of aspect ratio validation results."""
    print(f"\n{'='*60}")
    print("Aspect Ratio Validation")
    print(f"{'='*60}")

    print(f"  Portrait:  {validation_result['portrait_count']}")
    print(f"  Landscape: {validation_result['landscape_count']}")
    print(f"  Square:    {validation_result['square_count']}")

    if validation_result["valid"]:
        print("\n  All images match target ratio")
    else:
        print(f"\n  MISMATCH: Scenes {validation_result['mismatches']} do not match target")

    if validation_result["fixed"]:
        print(f"  Fixed:     Scenes {validation_result['fixed']}")

    print(f"{'='*60}\n")
