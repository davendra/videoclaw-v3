# .claude/skills/video-replicator/scripts/split_grid.py
"""
Grid Splitting Utility - Split 3x3 storyboard grids into individual panels.

Handles:
- Grid validation (minimum size, grid line detection)
- Uniform 3x3 splitting
- Panel resizing to target aspect ratio (16:9, 9:16, 1:1)
- Output file naming
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ImageProcessingError, ValidationError
from PIL import Image

# Standard output dimensions
LANDSCAPE_SIZE = (1280, 720)  # 16:9
PORTRAIT_SIZE = (504, 896)   # 9:16
SQUARE_SIZE = (720, 720)     # 1:1

# Minimum grid size for quality (800px allows Go Bananas variable output)
MIN_GRID_SIZE = 800


def validate_grid_image(image_path: str) -> tuple[bool, str]:
    """
    Validate that an image is suitable as a 3x3 storyboard grid.

    Checks:
    - File exists
    - Minimum dimensions (1500px shortest side)
    - Can be opened as image

    Returns (valid, reason).
    """
    if not os.path.exists(image_path):
        return False, f"File not found: {image_path}"

    try:
        img = Image.open(image_path)
        width, height = img.size

        if min(width, height) < MIN_GRID_SIZE:
            return False, f"Image too small: {width}x{height}. Minimum {MIN_GRID_SIZE}px on shortest side."

        return True, "Valid grid image"

    except Exception as e:
        return False, f"Cannot open image: {e}"


def calculate_panel_dimensions(grid_width: int, grid_height: int) -> dict:
    """
    Calculate panel dimensions for a 3x3 grid.

    Returns dict with panel_width, panel_height, total_panels.
    """
    panel_width = grid_width // 3
    panel_height = grid_height // 3

    return {
        "panel_width": panel_width,
        "panel_height": panel_height,
        "grid_width": grid_width,
        "grid_height": grid_height,
        "total_panels": 9,
    }


def resize_panel_to_aspect(
    input_path: str,
    output_path: str,
    aspect_ratio: str,
    quality: int = 95,
) -> str:
    """
    Resize a panel image to the target aspect ratio.

    Args:
        input_path: Source panel image
        output_path: Destination path
        aspect_ratio: "16:9", "9:16", or "1:1"
        quality: JPEG quality (default 95)

    Returns output_path.
    """
    target_sizes = {
        "16:9": LANDSCAPE_SIZE,
        "9:16": PORTRAIT_SIZE,
        "1:1": SQUARE_SIZE,
    }

    if aspect_ratio not in target_sizes:
        raise ValidationError(f"Unsupported aspect ratio: {aspect_ratio}. Use 16:9, 9:16, or 1:1")

    target_width, target_height = target_sizes[aspect_ratio]
    target_ratio = target_width / target_height

    img = Image.open(input_path)
    orig_width, orig_height = img.size
    orig_ratio = orig_width / orig_height

    # Crop to target aspect ratio (center crop)
    if orig_ratio > target_ratio:
        # Original is wider - crop sides
        new_width = int(orig_height * target_ratio)
        left = (orig_width - new_width) // 2
        img = img.crop((left, 0, left + new_width, orig_height))
    elif orig_ratio < target_ratio:
        # Original is taller - crop top/bottom
        new_height = int(orig_width / target_ratio)
        top = (orig_height - new_height) // 2
        img = img.crop((0, top, orig_width, top + new_height))

    # Resize to exact target dimensions
    img = img.resize((target_width, target_height), Image.Resampling.LANCZOS)

    # Save
    img.save(output_path, "JPEG", quality=quality)

    return output_path


def split_grid_image(
    grid_path: str,
    output_dir: str,
    aspect_ratio: str = "16:9",
    prefix: str = "panel",
) -> list[str]:
    """
    Split a 3x3 grid image into 9 individual panels.

    Args:
        grid_path: Path to the 3x3 grid image
        output_dir: Directory to save panels
        aspect_ratio: Target aspect ratio for panels ("16:9", "9:16", "1:1")
        prefix: Filename prefix (default "panel")

    Returns list of 9 panel paths in order (1-9, left-to-right, top-to-bottom).
    """
    # Validate
    valid, reason = validate_grid_image(grid_path)
    if not valid:
        raise ImageProcessingError(f"Invalid grid image: {reason}")

    # Create output directory
    os.makedirs(output_dir, exist_ok=True)

    # Open and get dimensions
    img = Image.open(grid_path)
    dims = calculate_panel_dimensions(img.width, img.height)

    panel_w = dims["panel_width"]
    panel_h = dims["panel_height"]

    panel_paths = []

    # Extract 9 panels (left-to-right, top-to-bottom)
    for row in range(3):
        for col in range(3):
            panel_num = row * 3 + col + 1  # 1-9

            # Calculate crop box
            left = col * panel_w
            top = row * panel_h
            right = left + panel_w
            bottom = top + panel_h

            # Crop panel
            panel = img.crop((left, top, right, bottom))

            # Save raw panel temporarily
            raw_path = os.path.join(output_dir, f"{prefix}_{panel_num}_raw.jpg")
            panel.save(raw_path, "JPEG", quality=95)

            # Resize to target aspect ratio
            final_path = os.path.join(output_dir, f"{prefix}_{panel_num}.jpg")
            resize_panel_to_aspect(raw_path, final_path, aspect_ratio)

            # Clean up raw
            os.remove(raw_path)

            panel_paths.append(final_path)

    return panel_paths


def split_grid_to_scene_images(
    grid_path: str,
    output_dir: str,
    aspect_ratio: str = "16:9",
    run_id: str = "run001",
) -> list[str]:
    """
    Split grid and name files for video-replicator scene convention.

    Returns list of paths like:
    - run001_scene_1_frame.jpg
    - run001_scene_2_frame.jpg
    - ...
    """
    # First split to panel_N.jpg
    panel_paths = split_grid_image(grid_path, output_dir, aspect_ratio, prefix="panel")

    # Rename to scene naming convention
    scene_paths = []
    for i, panel_path in enumerate(panel_paths, 1):
        scene_name = f"{run_id}_scene_{i}_frame.jpg"
        scene_path = os.path.join(output_dir, scene_name)
        os.rename(panel_path, scene_path)
        scene_paths.append(scene_path)

    return scene_paths
