#!/usr/bin/env python3
"""
Strict image validation and pre-flight checks.

Extracted from utils.py — validates all expected images exist with
correct dimensions, run prefixes, and freshness before video generation.
"""

import os

from config import PORTRAIT_HEIGHT, PORTRAIT_WIDTH
from utils_image import get_image_dimensions
from utils_validation import get_run_start_timestamp, validate_image_freshness
from utils_variation import find_frame_image_variation, get_variation_suffix


def validate_images_strict(
    images_dir: str,
    scenes: dict[str, str],
    variations: int,
    run_id: str | None = None,
    prefer_cropped: bool = True,
    project_path: str | None = None,
    check_freshness: bool = True,
    expected_ratio: str | None = None
) -> dict:
    """
    Validate all expected images exist in strict mode.

    Returns detailed report of found/missing images suitable for
    pre-flight checks before video generation.
    """
    result = {
        "valid": True,
        "found": [],
        "missing": [],
        "stale": [],
        "missing_run_prefix": [],
        "dimension_warnings": [],
        "total_expected": len(scenes) * variations,
        "total_found": 0,
        "images": {}
    }

    run_start_ts = None
    if check_freshness and run_id and project_path:
        run_start_ts = get_run_start_timestamp(project_path, run_id)

    for scene_str in scenes:
        scene_num = int(scene_str)
        result["images"][scene_num] = {}

        for v in range(1, variations + 1):
            path = find_frame_image_variation(
                images_dir, scene_num,
                variation=v,
                run_id=run_id,
                prefer_cropped=prefer_cropped
            )

            if path and os.path.exists(path):
                dims = get_image_dimensions(path)
                filename = os.path.basename(path)

                has_run_prefix = run_id is None or filename.startswith(f"{run_id}_")

                is_fresh = True
                stale_warning = None
                if run_start_ts is not None:
                    is_fresh, stale_warning = validate_image_freshness(path, run_start_ts, f"{run_id} started")

                result["images"][scene_num][v] = {
                    "exists": True,
                    "path": path,
                    "dimensions": dims,
                    "has_run_prefix": has_run_prefix,
                    "is_fresh": is_fresh
                }
                result["found"].append((scene_num, v, path))
                result["total_found"] += 1

                if not has_run_prefix and run_id:
                    result["missing_run_prefix"].append((scene_num, v, path))

                if not is_fresh and stale_warning:
                    result["stale"].append((scene_num, v, path, stale_warning))

                if expected_ratio == "portrait" and dims and dims != (PORTRAIT_WIDTH, PORTRAIT_HEIGHT):
                        warning = f"{dims[0]}x{dims[1]} (expected {PORTRAIT_WIDTH}x{PORTRAIT_HEIGHT})"
                        result["dimension_warnings"].append((scene_num, v, path, warning))
            else:
                suffix = get_variation_suffix(v, variations)
                expected = f"scene_{scene_num}_frame{suffix}.png"
                if run_id:
                    expected = f"{run_id}_{expected}"

                result["images"][scene_num][v] = {
                    "exists": False,
                    "path": None,
                    "dimensions": None,
                    "has_run_prefix": False,
                    "is_fresh": False
                }
                result["missing"].append((scene_num, v, expected))
                result["valid"] = False

    return result


def print_strict_validation(result: dict, run_id: str | None = None, mode: str = "frames-to-video") -> None:
    """Print strict validation report."""
    print(f"\n{'='*60}")
    print("PRE-FLIGHT CHECK (STRICT MODE)")
    print(f"{'='*60}")
    if run_id:
        print(f"Run: {run_id}")
    print(f"Mode: {mode}")
    print(f"Expected: {result['total_expected']} images")
    print(f"Found: {result['total_found']} images")
    print()

    for scene_num in sorted(result["images"].keys()):
        scene_data = result["images"][scene_num]
        print(f"Scene {scene_num}:")

        for v in sorted(scene_data.keys()):
            img_info = scene_data[v]
            if img_info["exists"]:
                dims = img_info["dimensions"]
                dim_str = f"({dims[0]}x{dims[1]})" if dims else ""
                path_short = os.path.basename(img_info["path"])

                status_flags = []
                if not img_info.get("has_run_prefix", True):
                    status_flags.append("NO RUN PREFIX")
                if not img_info.get("is_fresh", True):
                    status_flags.append("STALE")

                if status_flags:
                    status_str = f" [{', '.join(status_flags)}]"
                    print(f"  v{v}: {path_short} ! {dim_str}{status_str}")
                else:
                    print(f"  v{v}: {path_short} OK {dim_str}")
            else:
                print(f"  v{v}: MISSING")

        print()

    if result.get("missing_run_prefix"):
        print(f"WARNING: {len(result['missing_run_prefix'])} image(s) missing run prefix:")
        for scene_num, v, path in result["missing_run_prefix"]:
            expected = f"{run_id}_scene_{scene_num}_frame"
            actual = os.path.basename(path)
            print(f"  Scene {scene_num}, v{v}: {actual}")
            print(f"    Expected: {expected}...")
        print()
        print("Images without run prefix may be stale from previous runs.")
        print(f"Regenerate with: --run {run_id}")
        print()

    if result.get("stale"):
        print(f"WARNING: {len(result['stale'])} image(s) are stale (older than run start):")
        for scene_num, v, _path, warning in result["stale"]:
            print(f"  Scene {scene_num}, v{v}: {warning}")
        print()
        print("Stale images may not match your current prompts.")
        print(f"Regenerate images for {run_id} before video generation.")
        print()

    if result.get("dimension_warnings"):
        print(f"WARNING: {len(result['dimension_warnings'])} image(s) have wrong dimensions:")
        for scene_num, v, _path, warning in result["dimension_warnings"]:
            print(f"  Scene {scene_num}, v{v}: {warning}")
        print()
        print("Images will be auto-cropped to 504x896 during generation.")
        print("For best results, regenerate images at correct dimensions.")
        print()

    if result["valid"]:
        has_warnings = (result.get("missing_run_prefix") or result.get("stale") or
                        result.get("dimension_warnings"))
        if has_warnings:
            print("! All images found but with warnings - review before proceeding")
        else:
            print("OK All images found - ready for generation")
    else:
        print(f"ABORT: {len(result['missing'])} missing images")
        print("\nMissing:")
        for scene_num, v, expected in result["missing"]:
            print(f"  - Scene {scene_num}, v{v}: {expected}")

    print(f"{'='*60}\n")
