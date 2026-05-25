#!/usr/bin/env python3
"""
Image downloading functions.

Extracted from utils.py — handles downloading images from URLs
and Go Bananas with correct naming conventions.
"""

import os
from pathlib import Path

import requests


def download_image(url: str, output_path: str, timeout: int = 60) -> bool:
    """
    Download image from URL to local path.

    Returns:
        True on success, False on failure.
    """
    try:
        response = requests.get(url, timeout=timeout, stream=True)
        response.raise_for_status()

        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        print(f"  Warning: Failed to download {url}: {e}")
        return False


def download_images(image_urls: list[str], output_dir: str, prefix: str = "scene") -> list[str]:
    """
    Download multiple images to local directory.

    Args:
        image_urls: List of image URLs
        output_dir: Directory to save images
        prefix: Filename prefix (default: "scene")

    Returns:
        List of local file paths (in same order as input URLs)
    """
    os.makedirs(output_dir, exist_ok=True)
    local_paths = []

    for i, url in enumerate(image_urls, 1):
        ext = Path(url).suffix.lower()
        if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
            ext = ".jpg"

        filename = f"{prefix}_{i}_frame{ext}"
        local_path = os.path.join(output_dir, filename)

        print(f"  Downloading scene {i}: {url[:60]}...")
        if download_image(url, local_path):
            local_paths.append(local_path)
            print(f"    Saved: {local_path}")
        else:
            local_paths.append(None)
            print("    FAILED")

    return local_paths


def download_gobananas_images(image_urls: list[str], output_dir: str) -> list[str]:
    """Download Go Bananas generated images to project folder."""
    return download_images(image_urls, output_dir, prefix="scene")


def download_scene_images(
    urls: dict[int, str],
    images_dir: str,
    run_id: str | None = None,
    variation: int | None = None,
    expected_ratio: str | None = None,
) -> dict[int, str]:
    """
    Download scene images with correct naming convention for video-replicator.

    Args:
        urls: Dict mapping scene_number (int) to image URL
        images_dir: Directory to save images
        run_id: Optional run ID prefix (e.g., "run001")
        variation: Optional variation number for multi-variation I2V
        expected_ratio: Optional expected aspect ratio name (e.g. "portrait",
            "landscape"). When set, each downloaded image is validated and
            a WARNING is logged if the ratio deviates by more than 10%.

    Returns:
        Dict mapping scene_number to local file path
    """
    os.makedirs(images_dir, exist_ok=True)
    results = {}

    for scene_num, url in urls.items():
        ext = Path(url).suffix.lower()
        if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
            ext = ".jpg"

        variation_suffix = f"_v{variation}" if variation and variation > 1 else ""

        if run_id:
            filename = f"{run_id}_scene_{scene_num}_frame{variation_suffix}{ext}"
        else:
            filename = f"scene_{scene_num}_frame{variation_suffix}{ext}"

        local_path = os.path.join(images_dir, filename)

        print(f"  Downloading scene {scene_num}: {url[:60]}...")
        if download_image(url, local_path):
            results[scene_num] = local_path
            print(f"    Saved: {local_path}")

            # Post-download aspect ratio validation
            if expected_ratio:
                _warn_if_wrong_ratio(local_path, expected_ratio, scene_num)
        else:
            results[scene_num] = None
            print("    FAILED")

    return results


def _warn_if_wrong_ratio(
    image_path: str,
    expected_ratio: str,
    scene_num: int,
) -> None:
    """
    Log a WARNING if *image_path* does not match *expected_ratio*.

    This is a best-effort check -- import failures are silently ignored
    so that the download workflow is never blocked.
    """
    try:
        from utils_validation import validate_aspect_ratio

        result = validate_aspect_ratio(image_path, expected_ratio)
        if not result["valid"]:
            print(
                f"  WARNING: Scene {scene_num} aspect ratio mismatch -- "
                f"{result['width']}x{result['height']} "
                f"(ratio {result['actual_ratio']:.3f}, "
                f"expected {result['expected_ratio']:.4f} {expected_ratio}). "
                f"Deviation {result['deviation']:.1%}. "
                f"Consider re-generating with stronger aspect ratio hints."
            )
    except Exception:
        # Never block downloads due to validation import issues
        pass
