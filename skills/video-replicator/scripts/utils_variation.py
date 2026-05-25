#!/usr/bin/env python3
"""
Multi-variation support for video generation.

Extracted from utils.py — handles variation naming, detection, cost
estimation, and frame image lookup with variation support.
"""

import os
import re
from pathlib import Path

from config import COST_PER_CREDIT, CREDITS_PER_VIDEO, SEEDANCE_CREDITS_PER_MODE


def find_frame_image_variation(
    images_dir: str,
    scene_number: int,
    variation: int = 1,
    run_id: str | None = None,
    prefer_cropped: bool = False,
    project_path: str | None = None
) -> str | None:
    """
    Find frame image for a specific scene and variation.

    Search order (first match wins):
    1. New run structure: runs/{run_id}/images/scene_N_frame_vN.ext
    2. Legacy flat structure: images/{run_id}_scene_N_frame_vN.ext
    3. No run prefix: images/scene_N_frame_vN.ext
    """
    extensions = ["jpg", "jpeg", "png", "webp"]

    def build_patterns(base: str, variation: int, prefer_cropped: bool) -> list:
        patterns = []
        variation_suffix = f"_v{variation}" if variation > 1 else "_v1"

        if prefer_cropped:
            patterns.append(f"{base}{variation_suffix}_cropped")
            patterns.append(f"{base}_cropped{variation_suffix}")
        patterns.append(f"{base}{variation_suffix}")

        if variation == 1:
            if prefer_cropped:
                patterns.append(f"{base}_cropped")
            patterns.append(base)

        return patterns

    def try_patterns_in_dir(directory: str, patterns: list) -> str | None:
        if not os.path.exists(directory):
            return None
        for pattern in patterns:
            for ext in extensions:
                candidate = os.path.join(directory, f"{pattern}.{ext}")
                if os.path.exists(candidate):
                    return candidate
        return None

    base = f"scene_{scene_number}_frame"
    base_patterns = build_patterns(base, variation, prefer_cropped)

    # 1. Try new run structure
    if run_id and project_path:
        run_images_dir = os.path.join(project_path, "runs", run_id, "images")
        result = try_patterns_in_dir(run_images_dir, base_patterns)
        if result:
            return result

    # 2. Try legacy structure with run prefix
    if run_id:
        base_with_run = f"{run_id}_scene_{scene_number}_frame"
        patterns_with_run = build_patterns(base_with_run, variation, prefer_cropped)
        result = try_patterns_in_dir(images_dir, patterns_with_run)
        if result:
            return result

    # 3. Fallback: no run prefix
    result = try_patterns_in_dir(images_dir, base_patterns)
    if result:
        return result

    return None


def detect_variations(videos_dir: str, run_id: str | None = None) -> int:
    """
    Count how many variations exist for scene 1 (used as baseline).

    Returns:
        Number of variations detected (1-4), or 0 if no videos found
    """
    dir_path = Path(videos_dir)
    if not dir_path.exists():
        return 0

    prefix = f"{run_id}_scene_1" if run_id else "scene_1"

    variation_files = []
    for f in dir_path.iterdir():
        if f.is_file() and f.suffix.lower() == ".mp4" and f.name.startswith(prefix):
                match = re.search(r"_v(\d+)\.mp4$", f.name)
                if match:
                    variation_files.append(int(match.group(1)))

    if variation_files:
        return max(variation_files)

    for f in dir_path.iterdir():
        if f.is_file() and f.name == f"{prefix}.mp4":
            alt_path = dir_path / f"{prefix}_alt.mp4"
            if alt_path.exists():
                return 2
            return 1

    return 0


def get_variation_suffix(variation: int, total_variations: int) -> str:
    """
    Get the filename suffix for a variation.

    1 variation: "" (no suffix)
    2+ variations: "_v1", "_v2", etc.
    """
    if total_variations == 1:
        return ""
    return f"_v{variation}"


def estimate_generation_cost(
    num_scenes: int,
    variations: int,
    mode: str,
    quality: str = "fast",
    backend: str = "useapi"
) -> dict:
    """
    Estimate the cost of generating videos.

    Returns:
        Dict with go_bananas_images, veo_videos, veo_credits, estimated_cost_usd.
        When backend=="seedance", also includes seedance_credits and
        seedance_credits_per_scene.
    """
    result = {
        "go_bananas_images": 0,
        "veo_videos": 0,
        "veo_credits": 0,
        "estimated_cost_usd": 0.0
    }

    if mode == "frames-to-video":
        result["go_bananas_images"] = num_scenes * variations
        result["veo_videos"] = num_scenes * variations
    else:
        result["veo_videos"] = num_scenes * variations

    if backend == "seedance":
        mode_costs = SEEDANCE_CREDITS_PER_MODE.get(mode, {})
        credits_per_scene = mode_costs.get(quality, 19)
        total_credits = result["veo_videos"] * credits_per_scene
        result["seedance_credits"] = total_credits
        result["seedance_credits_per_scene"] = credits_per_scene
        # Keep veo_credits at 0 for backward compat
    else:
        credits_per_video = CREDITS_PER_VIDEO.get(quality, 10)
        result["veo_credits"] = result["veo_videos"] * credits_per_video
        result["estimated_cost_usd"] = result["veo_credits"] * COST_PER_CREDIT

    return result


def print_cost_estimate(
    num_scenes: int,
    variations: int,
    mode: str,
    quality: str = "fast",
    backend: str = "useapi"
) -> None:
    """Print a formatted cost estimate before generation."""
    estimate = estimate_generation_cost(num_scenes, variations, mode, quality, backend)

    print(f"\n{'='*50}")
    print("Cost Estimate")
    print(f"{'='*50}")

    if backend == "seedance":
        print(f"Backend: Seedance 2.0")
    print(f"Mode: {mode}")
    print(f"Scenes: {num_scenes}")
    print(f"Variations: {variations}")
    print(f"Quality: {quality}")
    print()

    if mode == "frames-to-video":
        print(f"Go Bananas: {estimate['go_bananas_images']} images ({num_scenes} scenes × {variations} variations)")

    if backend == "seedance":
        cps = estimate["seedance_credits_per_scene"]
        total = estimate["seedance_credits"]
        total_videos = estimate["veo_videos"]
        print(f"Seedance: {cps} credits/scene ({mode}, {quality})")
        print(f"Total: {total_videos} scenes × {cps} = {total} credits")
        if mode in ("motion-transfer", "camera-ref"):
            print(f"⚠ {mode} costs 2x standard credits ({cps} vs ~19)")
    else:
        credits_per_video = CREDITS_PER_VIDEO.get(quality, 10)
        print(f"veo-cli: {estimate['veo_videos']} videos × {credits_per_video} credits = {estimate['veo_credits']} credits")
        print(f"Estimated cost: ~${estimate['estimated_cost_usd']:.2f}")

    print(f"{'='*50}\n")
