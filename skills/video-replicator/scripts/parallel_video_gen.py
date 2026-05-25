#!/usr/bin/env python3
"""
Video Generation using veo-cli
Sequential video generation with built-in retry logic and job tracking.

Usage:
    # Text-to-video mode (default)
    python parallel_video_gen.py --product my-product --scenes '{"1": "prompt", "3": "prompt"}'

    # Frames-to-video mode (recommended for consistency)
    python parallel_video_gen.py \
        --product my-product \
        --mode frames-to-video \
        --images-dir projects/my-product/images \
        --scenes '{"1": "motion prompt", "3": "motion prompt"}'

    # Interactive mode with review checkpoints
    python parallel_video_gen.py \
        --product my-product \
        --mode frames-to-video \
        --images-dir projects/my-product/images \
        --scenes '{"1": "motion prompt"}' \
        --interactive

    # Dry-run mode (validate without calling APIs)
    python parallel_video_gen.py \
        --product my-product \
        --mode frames-to-video \
        --images-dir projects/my-product/images \
        --scenes '{"1": "prompt"}' \
        --dry-run

    # useapi.net backend (REST API instead of browser automation)
    python parallel_video_gen.py \
        --product my-product \
        --scenes '{"1": "prompt"}' \
        --backend useapi

Environment:
    VEO_CLI_PATH - Path to veo-cli (default: computed relative to this script)
    VIDEO_REPLICATOR_PROJECTS - Path to projects directory (default: computed relative to this script)

    # For useapi backend:
    USEAPI_API_TOKEN - API token from useapi.net
    USEAPI_ACCOUNT_EMAIL - Google account email registered with useapi.net
"""

import argparse
import concurrent.futures
import contextlib
import glob
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path as _Path

# Auto-load .env from the nearest parent containing one so this script works
# whether invoked from the repo root, a project dir, or via a wrapper. Doesn't
# override env vars already set in the shell (those win). No-op if python-dotenv
# is not installed — the prior manual `source .env` flow continues to work.
try:
    from dotenv import load_dotenv as _load_dotenv
    for _parent in _Path(__file__).resolve().parents:
        if (_parent / ".env").is_file():
            _load_dotenv(_parent / ".env", override=False)
            break
except ImportError:
    pass
import threading
import time
from pathlib import Path
from typing import Any

from logging_config import setup_logging

# Module-level logger — verbose can be enabled via setup_logging(__name__, verbose=True)
logger = setup_logging(__name__)

import telemetry as _telemetry

# Seedance 2.0 backend (v2.33) — optional, only needed for --backend seedance
try:
    from seedance_backend import seedance_generate_scene, is_retryable_error as seedance_retryable, check_balance as seedance_check_balance
    SEEDANCE_AVAILABLE = True
except ImportError:
    SEEDANCE_AVAILABLE = False

# Module-level storage for Seedance-specific kwargs (set before generation loop)
_seedance_kwargs: dict = {}


def _build_storyboard_extra_refs(
    scene_number: int,
    seedance_kwargs: dict,
    project_path: str,
) -> list[tuple[str, str]] | None:
    """Build extra_reference_urls from storyboard panels for a given scene (v2.43).

    Returns a list of (url, prompt_note) tuples if a panel exists for this scene,
    or None if no panels data or no panel for this scene.
    """
    panels_data = seedance_kwargs.get("storyboard_panels")
    if not panels_data:
        return None

    panels = panels_data.get("panels", {})
    scene_key = str(scene_number)
    panel = panels.get(scene_key)
    if not panel:
        return None

    # Prefer URL if already uploaded, otherwise resolve local path
    panel_url = panel.get("image_url")
    panel_path = panel.get("image_path")

    if not panel_url and panel_path:
        # Resolve relative path against project
        abs_path = panel_path if os.path.isabs(panel_path) else os.path.join(project_path, panel_path)
        if not os.path.isfile(abs_path):
            logger.warning("[Storyboard] Panel image not found for scene %d: %s", scene_number, abs_path)
            return None
        # Upload via ensure_urls (imported from seedance_backend context)
        try:
            from utils_upload import ensure_urls
            urls = ensure_urls([abs_path], rehost_risky=True)
            if urls and urls[0]:
                panel_url = urls[0]
                # Cache the URL back into panels data to avoid re-upload
                panel["image_url"] = panel_url
            else:
                logger.warning("[Storyboard] Upload failed for scene %d panel", scene_number)
                return None
        except ImportError:
            logger.warning("[Storyboard] utils_upload not available — cannot upload panel for scene %d", scene_number)
            return None

    if not panel_url:
        return None

    note = f"[Storyboard ref for scene {scene_number}: use this panel as visual composition guide]"
    return [(panel_url, note)]


def print_progress(current: int, total: int, scene_num: int, start_time: float, label: str = "Generating") -> None:
    """Print a simple terminal progress bar."""
    elapsed = time.time() - start_time
    if current > 0:
        eta = (elapsed / current) * (total - current)
        eta_str = f"~{eta/60:.1f}min remaining"
    else:
        eta_str = "calculating..."

    bar_width = 20
    filled = int(bar_width * current / total) if total > 0 else 0
    bar = "\u2588" * filled + "\u2591" * (bar_width - filled)
    pct = int(100 * current / total) if total > 0 else 0

    print(f"\r{label} scene {scene_num} [{bar}] {pct}% ({current}/{total}) {eta_str}    ", end="", flush=True)

# Import review state management for interactive mode
try:
    from review_state import (
        create_checkpoint,
        get_regeneration_list,
        should_auto_fix,
        wait_for_approval,
    )
    from utils_aspect import (
        print_aspect_ratio_summary,
        validate_and_fix_aspect_ratios,
    )
    from utils_image import (
        LANDSCAPE_HEIGHT,
        LANDSCAPE_WIDTH,
        crop_landscape_to_portrait,
        resize_to_landscape,
    )
    from utils_project import (
        clean_artifacts,
        get_current_run_id,
        get_or_create_manifest,
        get_run_dir,
        increment_run,
        update_run_status,
    )
    from utils_prompt import simplify_prompt
    from utils_strict import (
        print_strict_validation,
        validate_images_strict,
    )
    from utils_validation import (
        get_run_start_timestamp,
        print_stale_images_warning,
        validate_image_freshness,
        validate_video_freshness,
    )
    from utils_validation import (  # noqa: F811 — augment existing import
        clear_stale_veo_outputs as _clear_stale_veo_outputs,
        validate_video_output,
    )
    from utils_video import extract_last_frame, get_video_duration
    CHAIN_AVAILABLE = True
    STALE_HARDENING_AVAILABLE = True
    from utils_variation import (
        estimate_generation_cost,
        find_frame_image_variation,
        get_variation_suffix,
        print_cost_estimate,
    )
    INTERACTIVE_AVAILABLE = True
    SIMPLIFY_AVAILABLE = True
    AUTO_CROP_AVAILABLE = True
    RUN_MANAGEMENT_AVAILABLE = True
    STRICT_VALIDATION_AVAILABLE = True
except ImportError:
    INTERACTIVE_AVAILABLE = False
    AUTO_CROP_AVAILABLE = False
    RUN_MANAGEMENT_AVAILABLE = False
    STRICT_VALIDATION_AVAILABLE = False
    SIMPLIFY_AVAILABLE = False
    CHAIN_AVAILABLE = False
    STALE_HARDENING_AVAILABLE = False

# Try to import just the crop/resize functions if review_state fails
if not AUTO_CROP_AVAILABLE:
    try:
        from utils_image import (
            LANDSCAPE_HEIGHT,
            LANDSCAPE_WIDTH,
            crop_landscape_to_portrait,
            resize_to_landscape,
        )
        AUTO_CROP_AVAILABLE = True
    except ImportError:
        pass

# Fallback constants if utils not available
try:
    from utils_image import LANDSCAPE_HEIGHT, LANDSCAPE_WIDTH
except ImportError:
    LANDSCAPE_WIDTH = 1280
    LANDSCAPE_HEIGHT = 720

# Try to import run management functions
if not RUN_MANAGEMENT_AVAILABLE:
    try:
        from utils_project import (
            clean_artifacts,
            get_current_run_id,
            get_or_create_manifest,
            increment_run,
            update_run_status,
        )
        from utils_variation import (
            estimate_generation_cost,
            find_frame_image_variation,
            get_variation_suffix,
            print_cost_estimate,
        )
        RUN_MANAGEMENT_AVAILABLE = True
    except ImportError:
        pass

# Define fallback functions if utils not available
VARIATION_HELPERS_AVAILABLE = RUN_MANAGEMENT_AVAILABLE

if not VARIATION_HELPERS_AVAILABLE:
    def find_frame_image_variation(images_dir: str, scene_number: int, variation: int = 1, run_id: str | None = None, prefer_cropped: bool = False) -> str | None:
        """Fallback: just use the original find_frame_image."""
        return find_frame_image(images_dir, scene_number, prefer_cropped=prefer_cropped, run_id=run_id)

    def get_variation_suffix(variation: int, total_variations: int) -> str:
        """Fallback: use consistent _v1, _v2 naming."""
        if total_variations <= 1:
            return ""
        return f"_v{variation}"

    def print_cost_estimate(num_scenes: int, variations: int, mode: str, quality: str = "fast", **kwargs) -> None:
        """Fallback: just print basic info."""
        logger.info("Generating %d scenes x %d variations = %d videos", num_scenes, variations, num_scenes * variations)

    def estimate_generation_cost(num_scenes: int, variations: int, mode: str, quality: str = "fast", backend: str = "useapi") -> dict:
        """Fallback: return empty estimate."""
        return {"seedance_credits": num_scenes * variations * 19, "veo_videos": num_scenes * variations}

# Import camera transition helpers
try:
    from generate_video_prompts import (
        CAMERA_TRANSITIONS,
        get_transition_fragment,
        is_transition_compatible,
    )
    TRANSITIONS_AVAILABLE = True
except ImportError:
    TRANSITIONS_AVAILABLE = False
    CAMERA_TRANSITIONS = {}

    def get_transition_fragment(transition_id: str) -> str | None:
        return None

    def is_transition_compatible(transition_id: str, mode: str) -> bool:
        return False


# Compute default paths relative to this script's location
# Script is at: video-replicator-veo-cli/.claude/skills/video-replicator/scripts/
# Workspace is at: ../../../../../ (5 levels up)
_SCRIPT_DIR = Path(__file__).resolve().parent
_WORKSPACE_ROOT = _SCRIPT_DIR.parent.parent.parent.parent.parent  # video-creation-projects/
_REPLICATOR_ROOT = _SCRIPT_DIR.parent.parent.parent.parent  # video-replicator-veo-cli/

# Default paths (can be overridden via environment variables)
DEFAULT_VEO_PATH = os.environ.get("VEO_CLI_PATH", str(_WORKSPACE_ROOT / "veo-cli"))
DEFAULT_PROJECT_BASE = os.environ.get("VIDEO_REPLICATOR_PROJECTS", str(_REPLICATOR_ROOT / "projects"))

# Config constants — imported from config.py with inline fallbacks for test isolation
try:
    from config import (
        GEMINI_FLASH_MODEL,
        IMAGE_DIAGNOSTIC_PROMPT,
        MAX_RETRIES,
        MIN_VIDEO_SIZE_BYTES,
        RETRY_DELAY_SECONDS,
    )
except ImportError:
    GEMINI_FLASH_MODEL = "gemini-2.0-flash"
    IMAGE_DIAGNOSTIC_PROMPT = "Slow camera push in, ambient light, cinematic"
    MAX_RETRIES = 2
    MIN_VIDEO_SIZE_BYTES = 100_000
    RETRY_DELAY_SECONDS = 30


def diagnose_image_rejection(
    scene_number: int,
    product_name: str,
    veo_path: str,
    project_base: str,
    images_dir: str,
    quality: str = "fast",
    ratio: str = "landscape",
    backend: str = "direct",
    run_id: str | None = None,
    variation: int | None = None,
    variations: int = 1,
    videos_dir: str | None = None,
    use_run_dirs: bool = False,
    project_path: str | None = None,
    allow_stale: bool = False,
    f2v_loop: bool = False,
    image_run_id: str | None = None,
) -> bool:
    """
    Diagnose whether a generation failure is caused by image content filter rejection.

    After all retry strategies (auto-simplify, fallback quality) have been exhausted,
    this function tests the SAME image with a minimal neutral prompt. If the neutral
    prompt also fails, the image itself is being rejected by Google's content filter.

    Args:
        scene_number: Scene number to diagnose.
        product_name, veo_path, project_base, images_dir, quality, ratio, backend,
        run_id, variation, variations, videos_dir, use_run_dirs, project_path,
        allow_stale, f2v_loop, image_run_id: Same parameters used for the original
            generation call (forwarded to generate_scene).

    Returns:
        True if the image is rejected (diagnostic prompt also failed).
        False if the image is fine (diagnostic prompt succeeded, meaning the
            original prompt was the problem).
    """
    logger.info(
        "[Scene %d] Running image rejection diagnostic with neutral prompt...",
        scene_number,
    )

    result = generate_scene(
        scene_number=scene_number,
        prompt=IMAGE_DIAGNOSTIC_PROMPT,
        product_name=product_name,
        veo_path=veo_path,
        project_base=project_base,
        mode="frames-to-video",
        images_dir=images_dir,
        quality=quality,
        ratio=ratio,
        backend=backend,
        run_id=run_id,
        variations=1,            # Single output is enough for the test
        variation=variation,
        videos_dir=videos_dir,
        use_run_dirs=use_run_dirs,
        project_path=project_path,
        allow_stale=allow_stale,
        f2v_loop=f2v_loop,
        image_run_id=image_run_id,
    )

    if result["success"]:
        logger.info(
            "[Scene %d] Diagnostic succeeded — the image is fine, "
            "the original prompt was the problem.",
            scene_number,
        )
        return False  # Image is NOT rejected

    logger.error(
        "[Scene %d] IMAGE REJECTED: Google's content filter is blocking the "
        "first-frame image, not the prompt. Regenerate the image with softer "
        "content (avoid explosions, weapons, combat imagery, graphic violence).",
        scene_number,
    )
    return True  # Image IS rejected


def clean_veo_output_directory(veo_path: str, scene_nums: list[str]) -> int:
    """
    Remove stale scene files from veo-cli output directory before generation.

    This prevents stale videos from previous runs being picked up by copy_and_rename_outputs().
    Must be called BEFORE starting video generation for the given scenes.

    v2.11: Added to fix video mixing bug where old videos polluted new generations.

    Args:
        veo_path: Path to veo-cli directory
        scene_nums: List of scene numbers (as strings) to clean

    Returns:
        Number of files deleted
    """
    output_dir = os.path.join(veo_path, "output-videos")
    if not os.path.exists(output_dir):
        return 0

    deleted_count = 0
    for scene_num in scene_nums:
        # Match various patterns: scene_1.mp4, scene_1_1.mp4, scene1.mp4, etc.
        patterns = [
            f"*_scene_{scene_num}.mp4",
            f"*_scene_{scene_num}_*.mp4",
            f"*_scene{scene_num}*.mp4",
            f"*_{scene_num}.mp4",
        ]

        for pattern in patterns:
            for f in glob.glob(os.path.join(output_dir, pattern)):
                try:
                    os.remove(f)
                    deleted_count += 1
                    logger.debug("Cleaned stale file: %s", os.path.basename(f))
                except OSError as e:
                    logger.warning("Could not delete %s: %s", os.path.basename(f), e)

    return deleted_count


def get_image_dimensions(image_path: str) -> tuple[int, int] | None:
    """Get image dimensions (width, height) using sips (macOS) or PIL."""
    try:
        # Try sips first (macOS native, fast)
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", image_path],
            capture_output=True, text=True, timeout=5
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

    # Fallback to PIL
    try:
        from PIL import Image
        with Image.open(image_path) as img:
            return img.size
    except Exception:
        pass

    return None


def get_aspect_ratio_type(width: int, height: int) -> str:
    """Determine if dimensions are portrait, landscape, or square."""
    if width > height:
        return "landscape"
    elif height > width:
        return "portrait"
    return "square"


def validate_image_aspect_ratios(
    images_dir: str,
    scenes: dict[str, str],
    expected_ratio: str | None = None,
    prefer_cropped: bool = False,
    prefer_landscape: bool = False,
    run_id: str | None = None
) -> dict:
    """
    Check aspect ratio consistency across all scene images.

    Args:
        images_dir: Directory containing scene images
        scenes: Dict mapping scene_number to prompt
        expected_ratio: Expected aspect ratio ("portrait" or "landscape")
        prefer_cropped: If True, look for _cropped versions first (portrait mode)
        prefer_landscape: If True, look for _landscape versions first (landscape mode, v2.15)
        run_id: Optional run ID for finding run-prefixed images (v2.10)

    Returns:
        {
            "consistent": bool,
            "detected_ratio": str or None (if consistent),
            "images": {scene_num: {"path": str, "dims": (w,h), "ratio": str}},
            "errors": [str],
            "warnings": [str]
        }
    """
    result = {
        "consistent": True,
        "detected_ratio": None,
        "images": {},
        "errors": [],
        "warnings": []
    }

    ratios_found = set()

    for scene_num in scenes:
        frame_path = find_frame_image(images_dir, int(scene_num), prefer_cropped=prefer_cropped, prefer_landscape=prefer_landscape, run_id=run_id)
        if not frame_path:
            result["errors"].append(f"Scene {scene_num}: No frame image found")
            continue

        dims = get_image_dimensions(frame_path)
        if not dims:
            result["errors"].append(f"Scene {scene_num}: Could not read image dimensions")
            continue

        ratio_type = get_aspect_ratio_type(dims[0], dims[1])
        ratios_found.add(ratio_type)

        result["images"][scene_num] = {
            "path": frame_path,
            "dims": dims,
            "ratio": ratio_type
        }

    # Check consistency
    if len(ratios_found) > 1:
        result["consistent"] = False
        result["errors"].append(
            f"MIXED ASPECT RATIOS: Found {', '.join(ratios_found)}. "
            "All images must have the same aspect ratio for video stitching."
        )
        # Show which scenes have which ratio
        for ratio in ratios_found:
            scenes_with_ratio = [s for s, info in result["images"].items() if info["ratio"] == ratio]
            result["errors"].append(f"  {ratio}: scenes {', '.join(scenes_with_ratio)}")
    elif len(ratios_found) == 1:
        result["detected_ratio"] = list(ratios_found)[0]

        # Check if expected ratio matches
        if expected_ratio and result["detected_ratio"] != expected_ratio:
            result["warnings"].append(
                f"WARNING: --ratio={expected_ratio} but images are {result['detected_ratio']}. "
                f"Using detected ratio: {result['detected_ratio']}"
            )

    return result


def find_frame_image(
    images_dir: str,
    scene_number: int,
    prefer_cropped: bool = False,
    prefer_landscape: bool = False,
    run_id: str | None = None
) -> str | None:
    """
    Find frame image for a scene in the images directory.

    Supports both legacy naming (scene_N_frame.jpg) and run-prefixed naming (runNNN_scene_N_frame.jpg).
    When run_id is provided, looks for run-prefixed files first.

    Args:
        images_dir: Directory containing scene images
        scene_number: Scene number to find
        prefer_cropped: If True, look for _cropped version first (portrait mode)
        prefer_landscape: If True, look for _landscape version first (landscape mode, v2.15)
        run_id: Optional run ID to look for (e.g., "run001")

    Returns:
        Path to the image file, or None if not found
    """
    extensions = ["jpg", "jpeg", "png", "webp"]

    # Build list of name patterns to try (in order of preference)
    patterns = []

    if run_id:
        # Run-prefixed patterns (preferred when run_id specified)
        # v2.43: Check for _4k variants first (created by --upscale-4k)
        if prefer_landscape:
            patterns.append(f"{run_id}_scene_{scene_number}_frame_landscape_4k")
        patterns.append(f"{run_id}_scene_{scene_number}_frame_4k")
        if prefer_cropped:
            patterns.append(f"{run_id}_scene_{scene_number}_frame_cropped")
        if prefer_landscape:
            patterns.append(f"{run_id}_scene_{scene_number}_frame_landscape")
        patterns.append(f"{run_id}_scene_{scene_number}_frame")

    # Legacy patterns (fallback)
    # v2.43: Check for _4k variants first (created by --upscale-4k)
    if prefer_landscape:
        patterns.append(f"scene_{scene_number}_frame_landscape_4k")
    patterns.append(f"scene_{scene_number}_frame_4k")
    if prefer_cropped:
        patterns.append(f"scene_{scene_number}_frame_cropped")
    if prefer_landscape:
        patterns.append(f"scene_{scene_number}_frame_landscape")
    patterns.append(f"scene_{scene_number}_frame")

    # Try each pattern with each extension
    for pattern in patterns:
        for ext in extensions:
            candidate = os.path.join(images_dir, f"{pattern}.{ext}")
            if os.path.exists(candidate):
                return candidate

    return None


def copy_and_rename_outputs(
    veo_path: str,
    project_base: str,
    product_name: str,
    scene_number: int,
    run_id: str | None = None,
    variation: int = 1,
    total_variations: int = 2,
    videos_dir: str | None = None,
    use_run_dirs: bool = False,
    min_timestamp: float | None = None
) -> dict:
    """
    Copy veo-cli outputs to project folder with standard naming.

    veo-cli outputs: YYYY-MM-DD_HH-MM_scene_N.mp4 (or _1, _2 suffix for multiple)

    Naming conventions (legacy):
    - 1 variation: runNNN_scene_N.mp4 (no suffix)
    - 2+ variations: runNNN_scene_N_v1.mp4, runNNN_scene_N_v2.mp4, etc.
    - Legacy (total_variations=2, via -n 2): runNNN_scene_N.mp4, runNNN_scene_N_alt.mp4

    Naming conventions (use_run_dirs=True):
    - 1 variation: scene_N.mp4 (no run prefix, stored in runs/{run_id}/videos/)
    - 2+ variations: scene_N_v1.mp4, scene_N_v2.mp4, etc.

    Args:
        veo_path: Path to veo-cli directory
        project_base: Base path for projects
        product_name: Product/project name
        scene_number: Scene number
        run_id: Optional run ID prefix (e.g., "run001")
        variation: Current variation number (1-4) - only used in I2V mode
        total_variations: Total variations being generated
        videos_dir: Optional override for output videos directory
        use_run_dirs: If True, don't add run_id prefix (files in run subdir)
        min_timestamp: Optional minimum acceptable mtime (Unix timestamp).
                       v2.11: Rejects files older than this to prevent stale video mixing.

    Returns:
        Dict with success status, video paths, and scene number
    """
    veo_output_dir = os.path.join(veo_path, "output-videos")

    # Determine output directory
    project_videos_dir = videos_dir or os.path.join(project_base, product_name, "videos")

    os.makedirs(project_videos_dir, exist_ok=True)

    # Try multiple patterns to find scene videos (handles different tag formats)
    patterns = [
        f"*_scene_{scene_number}.mp4",       # Standard: scene_3
        f"*_scene_{scene_number}_*.mp4",     # With suffix: scene_3_1
        f"*_scene{scene_number}*.mp4",       # No underscore: scene3
        f"*_{scene_number}.mp4",             # Just number
    ]

    files = []
    for pattern in patterns:
        matches = glob.glob(os.path.join(veo_output_dir, pattern))
        files.extend(matches)

    # Dedupe and sort by modification time (newest first)
    # For T2V with -n N, we get N files; for I2V with specific variation, we get 1
    files = sorted(set(files), key=os.path.getmtime, reverse=True)

    # v2.11: Filter by timestamp if provided (reject stale files)
    if min_timestamp is not None and files:
        valid_files = []
        stale_count = 0
        for f in files:
            if os.path.getmtime(f) >= min_timestamp:
                valid_files.append(f)
            else:
                stale_count += 1
        if stale_count > 0:
            logger.warning("Filtered out %d stale file(s) from previous run", stale_count)
        files = valid_files

    # Build output filename with optional run prefix
    # When use_run_dirs=True, files go in runs/{run_id}/videos/ so don't need run prefix
    if run_id and not use_run_dirs:
        base_name = f"{run_id}_scene_{scene_number}"
    else:
        base_name = f"scene_{scene_number}"

    videos = []

    # T2V mode: variation is None - copy N files from single veo-cli call
    # I2V mode: variation is 1-4 - copy 1 file per call (called N times)
    if variation is not None and total_variations > 1:
        # Multi-variation I2V mode: use _vN suffix
        files_to_process = files[:1]  # Just the first/newest file
        for _i, src in enumerate(files_to_process):
            suffix = get_variation_suffix(variation, total_variations)
            dst = os.path.join(project_videos_dir, f"{base_name}{suffix}.mp4")
            shutil.copy2(src, dst)
            videos.append(dst)
            logger.info("Saved: %s", dst)
    else:
        # T2V mode with -n N: multiple files from single call
        # Or legacy dual mode: use "" and "_alt"
        files_to_process = files[:total_variations]
        for i, src in enumerate(files_to_process):
            if total_variations == 1:
                suffix = ""
            elif total_variations == 2:
                # Legacy naming for backwards compatibility
                suffix = "" if i == 0 else "_alt"
            else:
                # New naming with _vN
                suffix = f"_v{i + 1}"
            dst = os.path.join(project_videos_dir, f"{base_name}{suffix}.mp4")
            shutil.copy2(src, dst)
            videos.append(dst)
            logger.info("Saved: %s", dst)

    return {
        "success": len(videos) > 0,
        "videos": videos,
        "scene_number": scene_number,
        "run_id": run_id,
        "variation": variation
    }


def verify_scene_outputs(
    project_videos_dir: str,
    scene_number: int,
    run_id: str | None = None,
    variations: int = 2,
    variation: int | None = None,
    use_run_dirs: bool = False,
    min_timestamp: float | None = None
) -> dict:
    """
    Verify video outputs exist and are valid.

    Supports multiple naming conventions:
    - Legacy: scene_N.mp4, scene_N_alt.mp4
    - Run-prefixed: runNNN_scene_N.mp4, runNNN_scene_N_alt.mp4
    - Variations: runNNN_scene_N_v1.mp4, runNNN_scene_N_v2.mp4, etc.
    - Run subdirs: runs/{run_id}/videos/scene_N_v1.mp4 (no run prefix)

    Args:
        project_videos_dir: Directory containing scene videos
        scene_number: Scene number to verify
        run_id: Optional run ID prefix (e.g., "run001")
        variations: Total number of variations expected
        variation: Specific variation to check (None = check all)
        use_run_dirs: If True, files don't have run prefix
        min_timestamp: Optional minimum acceptable mtime (Unix timestamp).
                       If provided, videos older than this are considered stale.

    Returns:
        {
            "complete": bool (all expected videos exist and valid),
            "found": int (number of valid videos found),
            "expected": int (number of videos expected),
            "videos": {1: bool, 2: bool, ...},
            "errors": [str]
        }
    """
    # Build base filename with optional run prefix
    # When use_run_dirs=True, files are in runs/{run_id}/videos/ so no run prefix needed
    if run_id and not use_run_dirs:
        base_name = f"{run_id}_scene_{scene_number}"
    else:
        base_name = f"scene_{scene_number}"

    result = {
        "complete": False,
        "found": 0,
        "expected": variations if variation is None else 1,
        "videos": {},
        "errors": [],
        # Legacy compatibility
        "primary": False,
        "alt": False
    }

    # Determine which variations to check
    variations_to_check = [variation] if variation is not None else range(1, variations + 1)

    for v in variations_to_check:
        # Build filename based on naming convention
        suffix = "" if variations == 1 else get_variation_suffix(v, variations)

        path = os.path.join(project_videos_dir, f"{base_name}{suffix}.mp4")

        if os.path.exists(path):
            size = os.path.getsize(path)
            if size > MIN_VIDEO_SIZE_BYTES:
                # v2.8: Validate freshness if min_timestamp provided
                if min_timestamp is not None:
                    try:
                        is_fresh, error = validate_video_freshness(path, min_timestamp)
                        if not is_fresh:
                            result["videos"][v] = False
                            result["errors"].append(f"v{v}: {error}")
                            continue
                    except NameError:
                        # validate_video_freshness not available, skip check
                        pass

                result["videos"][v] = True
                result["found"] += 1
                # Legacy compatibility
                if v == 1:
                    result["primary"] = True
                elif v == 2 and variations == 2:
                    result["alt"] = True
            else:
                result["videos"][v] = False
                result["errors"].append(f"v{v}: File too small ({size} bytes)")
        else:
            result["videos"][v] = False
            result["errors"].append(f"v{v}: File missing ({os.path.basename(path)})")

    result["complete"] = result["found"] == result["expected"]
    return result


def print_recovery_commands(
    failed_scenes: list[dict[str, Any]],
    veo_path: str,
    quality: str,
    ratio: str,
    backend: str = "direct"
) -> None:
    """Print exact veo-cli commands to manually retry failed scenes."""
    if not failed_scenes:
        return

    print(f"\n{'='*60}")
    print("RECOVERY COMMANDS")
    print("Copy and run these commands from the veo-cli directory:")
    print(f"cd {veo_path}")
    print(f"{'='*60}")

    # Add backend flag for non-direct backends
    backend_flag = f" --backend {backend} --yes" if backend and backend != "direct" else ""

    for scene in failed_scenes:
        scene_num = scene["scene_number"]
        image_path = scene.get("image_path", "")
        prompt = scene.get("prompt", "motion prompt here")

        # Truncate prompt for display
        prompt_short = prompt[:60] + "..." if len(prompt) > 60 else prompt

        print(f"\n# Scene {scene_num}: {scene.get('error', 'unknown error')}")
        if image_path:
            print(f'bun run flow.ts -p "[scene_{scene_num}] image:{image_path} {prompt_short}" -n 2 -r {ratio} -m {quality}{backend_flag}')
        else:
            print(f'bun run flow.ts -p "[scene_{scene_num}] {prompt_short}" -n 2 -r {ratio} -m {quality}{backend_flag}')

    print(f"\n{'='*60}")


def generate_scene(
    scene_number: int,
    prompt: str,
    product_name: str,
    veo_path: str,
    project_base: str,
    mode: str = "text-to-video",
    images_dir: str | None = None,
    quality: str = "fast",
    ratio: str = "landscape",
    backend: str = "direct",
    run_id: str | None = None,
    variations: int = 2,
    variation: int | None = None,
    videos_dir: str | None = None,
    use_run_dirs: bool = False,
    project_path: str | None = None,
    allow_stale: bool = False,
    f2v_loop: bool = False,
    image_run_id: str | None = None,
    reference_images: list[str] | None = None,
    voice: str | None = None,
    ref_video: str | None = None,
) -> dict:
    """
    Generate a single scene video using veo-cli.

    Mode-aware variation handling:
    - T2V mode: Single call with -n {variations} to get N outputs from AI randomness
    - I2V mode: Called once per variation, uses specific variation image
    - R2V mode: Uses 1-3 reference images as style/composition guidance

    Args:
        scene_number: Scene number for output naming
        prompt: Motion/generation prompt
        product_name: Project folder name
        veo_path: Path to veo-cli
        project_base: Base path for project outputs
        mode: "text-to-video", "frames-to-video", or "reference-to-video"
        images_dir: Directory with scene_N_frame.* files (required for frames-to-video)
        quality: "fast" or "quality"
        ratio: "landscape" or "portrait"
        backend: "direct" (default, browser automation) or "useapi" (REST API via useapi.net)
        run_id: Optional run ID for filename prefix (e.g., "run001")
        variations: Total number of variations to generate (T2V: controls -n flag)
        variation: Specific variation number (I2V only: which image to use, 1-4)
        videos_dir: Optional override for video output directory
        use_run_dirs: If True, use run subdirectory structure
        project_path: Optional project path for new run structure lookup
        reference_images: List of 1-3 image paths for R2V (reference-to-video) mode
    """
    result = {
        "scene_number": scene_number,
        "success": False,
        "videos": [],
        "error": None,
        "mode": mode,
        "prompt": prompt,  # Store for recovery commands
        "image_path": None,  # Store for recovery commands
        "run_id": run_id,
        "variation": variation,
        "variations": variations
    }

    tag = f"scene_{scene_number}"
    run_info = f" [{run_id}]" if run_id else ""
    variation_info = f" v{variation}" if variation else ""
    logger.info("[Scene %d]%s%s Starting generation (%s)...", scene_number, run_info, variation_info, mode)

    # ---- Seedance backend dispatch (v2.33) ----
    if backend == "seedance":
        if not SEEDANCE_AVAILABLE:
            result["error"] = "Seedance backend not available (import failed)"
            return result

        # Resolve image path using existing lookup logic
        image_path = None
        if mode in ("frames-to-video", "audio-lipsync", "motion-transfer") and images_dir:
            prefer_cropped = (ratio == "portrait")
            prefer_landscape = (ratio == "landscape")
            lookup_run_id = image_run_id if image_run_id else run_id
            if variation and variations > 1:
                image_path = find_frame_image_variation(
                    images_dir, scene_number, variation=variation,
                    run_id=lookup_run_id, prefer_cropped=prefer_cropped,
                    project_path=project_path
                )
            else:
                image_path = find_frame_image(
                    images_dir, scene_number, prefer_cropped=prefer_cropped,
                    prefer_landscape=prefer_landscape, run_id=lookup_run_id
                )
            result["image_path"] = image_path

        # Resolve output directory
        vid_dir = videos_dir or os.path.join(project_base, product_name, "videos")
        os.makedirs(vid_dir, exist_ok=True)

        # v2.43: Build extra_reference_urls from storyboard panels
        extra_refs = _build_storyboard_extra_refs(scene_number, _seedance_kwargs,
                                                  project_path or os.path.join(project_base, product_name))

        return seedance_generate_scene(
            scene_number=scene_number,
            prompt=prompt,
            mode=mode,
            image_path=image_path,
            quality=quality,
            ratio=ratio,
            output_dir=vid_dir,
            run_id=run_id,
            variation=variation,
            variations=variations,
            duration=_seedance_kwargs.get("duration"),
            f2v_loop=f2v_loop,
            audio_path=_seedance_kwargs.get("audio_path"),
            motion_ref_path=_seedance_kwargs.get("motion_ref_path"),
            camera_ref_path=_seedance_kwargs.get("camera_ref_path"),
            tts_dir=_seedance_kwargs.get("tts_dir_lipsync"),
            project_path=project_path or os.path.join(project_base, product_name),
            dry_run=_seedance_kwargs.get("dry_run", False),
            service_tier=_seedance_kwargs.get("service_tier", "default"),
            extra_reference_urls=extra_refs,
            pre_analyze_images=_seedance_kwargs.get("pre_analyze_images", False),
            risk_threshold=_seedance_kwargs.get("risk_threshold", "high"),
        )

    try:
        # Build veo-cli prompt format
        if mode == "frames-to-video":
            if not images_dir:
                result["error"] = "images_dir required for frames-to-video mode"
                return result

            # Prefer processed versions when generating videos
            # v2.15: Added prefer_landscape for landscape mode (1280x720)
            prefer_cropped = (ratio == "portrait")
            prefer_landscape = (ratio == "landscape")

            # Use variation-specific image lookup
            # v2.31: image_run_id overrides run_id for image lookup when --image-run is specified
            lookup_run_id = image_run_id if image_run_id else run_id
            if variation and variations > 1:
                frame_path = find_frame_image_variation(
                    images_dir, scene_number, variation=variation,
                    run_id=lookup_run_id, prefer_cropped=prefer_cropped,
                    project_path=project_path  # v2.12: Enable Tier 1 run-structure lookup
                )
            else:
                # Fallback to original function for backwards compatibility
                frame_path = find_frame_image(images_dir, scene_number, prefer_cropped=prefer_cropped, prefer_landscape=prefer_landscape, run_id=lookup_run_id)

            if not frame_path:
                variation_str = f" variation {variation}" if variation else ""
                result["error"] = f"No frame image found for scene {scene_number}{variation_str} in {images_dir}"
                logger.error("%s", result['error'])
                return result

            # v2.12: Validate image freshness to prevent stale image reuse
            if run_id and project_path:
                try:
                    run_start_ts = get_run_start_timestamp(project_path, run_id)
                    if run_start_ts is not None:
                        is_fresh, stale_error = validate_image_freshness(frame_path, run_start_ts, run_id)
                        filename = os.path.basename(frame_path)
                        has_run_prefix = filename.startswith(f"{run_id}_")

                        if not is_fresh or not has_run_prefix:
                            if not allow_stale:
                                issue = stale_error if not is_fresh else f"Missing run prefix '{run_id}_'"
                                result["error"] = f"STALE IMAGE: Scene {scene_number} - {issue}"
                                logger.error("%s", result['error'])
                                logger.error("Hint: Regenerate images for %s or use --allow-stale", run_id)
                                return result
                            else:
                                issue = stale_error if not is_fresh else "missing run prefix"
                                logger.warning("Using stale image (%s) - --allow-stale enabled", issue)
                except NameError:
                    # validate_image_freshness or get_run_start_timestamp not available
                    pass

            # Convert to absolute path - veo-cli runs from different directory
            abs_frame_path = os.path.abspath(frame_path)
            result["image_path"] = abs_frame_path  # Store for recovery commands
            logger.info("Using frame: %s", abs_frame_path)

            if f2v_loop:
                # F2V seamless loop: same image as start AND end frame
                # Veo animates elements and returns to starting position
                veo_prompt = f"[{tag}] frames:{abs_frame_path},{abs_frame_path} {prompt}"
                logger.info("Mode: F2V loop (same start+end frame)")
            else:
                # veo-cli image-to-video format: [tag] image:path prompt
                veo_prompt = f"[{tag}] image:{abs_frame_path} {prompt}"

            # I2V/F2V mode: always generate 1 video per call (we're called per variation)
            num_outputs = 1
        elif mode == "reference-to-video":
            # R2V mode: use 1-3 reference images as style/composition guidance
            if not reference_images:
                result["error"] = "reference_images required for reference-to-video mode"
                return result

            # Convert all paths to absolute
            abs_ref_paths = [os.path.abspath(p) for p in reference_images]
            for p in abs_ref_paths:
                if not os.path.exists(p):
                    result["error"] = f"Reference image not found: {p}"
                    return result

            # veo-cli ingredients format: [tag] ingredients:path1,path2,path3 prompt
            ref_paths_str = ",".join(abs_ref_paths)
            veo_prompt = f"[{tag}] ingredients:{ref_paths_str} {prompt}"
            logger.info("Mode: R2V with %d reference image(s)", len(abs_ref_paths))
            for i, p in enumerate(abs_ref_paths, 1):
                logger.info("  Reference %d: %s", i, p)

            # R2V: generate 1 video per call (like I2V)
            num_outputs = 1
        else:
            # veo-cli text-to-video format: [tag] prompt
            veo_prompt = f"[{tag}] {prompt}"
            # T2V mode: use -n flag to get multiple outputs from AI randomness
            num_outputs = variations

        # Build veo-cli command
        cmd = [
            "bun", "run", "flow.ts",
            "-p", veo_prompt,
            "-n", str(num_outputs),  # Number of outputs
            "-r", ratio,             # landscape or portrait
            "-m", quality,           # fast or quality
        ]

        # Add backend argument if not direct (default)
        if backend and backend != "direct":
            cmd.extend(["--backend", backend])
            # Skip confirmation for useapi backend (scripting mode)
            cmd.append("--yes")

        # PR #27: thread voice (omni-flash narration preset → referenceAudio_1) through to vclaw-cli.
        if voice:
            cmd.extend(["--voice", voice])

        # PR #27: thread ref-video (omni-flash V2V edit mediaGenerationId → referenceVideo_1) through.
        if ref_video:
            cmd.extend(["--ref-video", ref_video])

        backend_info = f" --backend {backend}" if backend and backend != "direct" else ""
        logger.debug("Running: bun run flow.ts -p \"[%s] ...\" -n %d -r %s -m %s%s", tag, num_outputs, ratio, quality, backend_info)

        # v2.11: Track generation start time for timestamp validation
        # Allow 60s tolerance for clock drift between systems
        generation_start_time = time.time() - 60

        # v2.33: Pre-clear stale outputs for this specific tag
        if STALE_HARDENING_AVAILABLE:
            cleared = _clear_stale_veo_outputs(veo_path, tag)
            if cleared:
                logger.debug("Pre-cleared %d stale file(s) for %s", cleared, tag)

        proc = subprocess.run(
            cmd,
            cwd=veo_path,
            capture_output=True,
            text=True,
            timeout=900  # 15 minute timeout per scene
        )

        if proc.returncode != 0:
            result["error"] = f"veo-cli failed: {proc.stderr[:500]}"
            logger.error("FAILED: %s", proc.stderr[:200])
            return result

        logger.info("Generation complete, copying outputs...")

        # Copy and rename outputs to project folder
        # Note: variation is None for T2V (copy N files), 1-4 for I2V (copy 1 file per call)
        # v2.11: Pass min_timestamp to reject stale files from previous runs
        copy_result = copy_and_rename_outputs(
            veo_path, project_base, product_name, scene_number,
            run_id=run_id, variation=variation, total_variations=variations,
            videos_dir=videos_dir, use_run_dirs=use_run_dirs,
            min_timestamp=generation_start_time
        )
        result["success"] = copy_result["success"]
        result["videos"] = copy_result["videos"]

        # v2.33: Post-validate each output video (freshness + size)
        if result["success"] and STALE_HARDENING_AVAILABLE and result["videos"]:
            for video_path in result["videos"]:
                is_valid, error = validate_video_output(
                    video_path, generation_start_time, scene_number
                )
                if not is_valid:
                    logger.error("Post-validation failed: %s", error)
                    result["success"] = False
                    result["error"] = f"Stale video detected: {error}"
                    break

        if not result["success"] and not result.get("error"):
            result["error"] = "No output videos found after generation"

    except subprocess.TimeoutExpired:
        result["error"] = "Generation timed out after 15 minutes"
        logger.error("TIMEOUT")
    except Exception as e:
        result["error"] = str(e)
        logger.error("ERROR: %s", e)

    return result


def generate_scene_with_retry(
    scene_number: int,
    prompt: str,
    product_name: str,
    veo_path: str,
    project_base: str,
    mode: str = "text-to-video",
    images_dir: str | None = None,
    quality: str = "fast",
    ratio: str = "landscape",
    backend: str = "direct",
    run_id: str | None = None,
    variations: int = 2,
    variation: int | None = None,
    videos_dir: str | None = None,
    use_run_dirs: bool = False,
    project_path: str | None = None,
    allow_stale: bool = False,
    f2v_loop: bool = False,
    fallback_quality: bool = False,
    auto_simplify: bool = False,
    image_run_id: str | None = None,
    reference_images: list[str] | None = None,
    no_image_diagnostic: bool = False,
) -> dict:
    """
    Generate a scene with automatic retry on failure.

    Retries up to MAX_RETRIES times with RETRY_DELAY_SECONDS between attempts.

    v2.27 enhancements:
    - fallback_quality: If quality="quality" fails, retry with quality="fast"
    - auto_simplify: Progressively simplify prompt on failure (levels 0-3)

    v2.39 enhancement:
    - Image rejection diagnostic: After all retry strategies are exhausted for
      frames-to-video mode, tests the image with a neutral prompt to determine
      if the image itself is being rejected by Google's content filter.
      Disable with no_image_diagnostic=True.
    """
    original_prompt = prompt
    original_quality = quality
    current_prompt = prompt
    current_quality = quality
    simplify_level = 0
    max_simplify_levels = 3

    # Build retry strategy: regular retries -> quality fallback -> prompt simplification
    for attempt in range(MAX_RETRIES + 1):
        result = generate_scene(
            scene_number=scene_number,
            prompt=current_prompt,
            product_name=product_name,
            veo_path=veo_path,
            project_base=project_base,
            mode=mode,
            images_dir=images_dir,
            quality=current_quality,
            ratio=ratio,
            backend=backend,
            run_id=run_id,
            variations=variations,
            variation=variation,
            videos_dir=videos_dir,
            use_run_dirs=use_run_dirs,
            project_path=project_path,
            allow_stale=allow_stale,
            f2v_loop=f2v_loop,
            image_run_id=image_run_id,
            reference_images=reference_images
        )

        if result["success"]:
            # Log if we succeeded with fallback/simplification
            if current_quality != original_quality:
                logger.info("Succeeded with fallback quality: %s", current_quality)
            if simplify_level > 0:
                logger.info("Succeeded with simplification level %d", simplify_level)
            return result

        # Seedance: skip retries for permanent errors (v2.33)
        if backend == "seedance" and SEEDANCE_AVAILABLE:
            error_msg = result.get("error", "")
            if error_msg and not seedance_retryable(error_msg):
                logger.error("Non-retryable Seedance error, skipping retries: %s", error_msg)

                # v2.45: Auto-fallback to alternative backend (e.g. useapi/Veo)
                fb_backend = _seedance_kwargs.get("fallback_backend")
                if fb_backend:
                    import re as _re
                    logger.warning(
                        "[Scene %d] Attempting fallback to %s backend...",
                        scene_number, fb_backend,
                    )
                    # Strip Seedance @imageN/@videoN/@audioN refs (Veo doesn't use them)
                    fb_prompt = _re.sub(r"@(?:image|video|audio)(?:_file)?_?\d+", "", current_prompt)
                    fb_prompt = _re.sub(r"\s{2,}", " ", fb_prompt).strip()

                    # Record telemetry
                    trun = _telemetry.get_current_run()
                    if trun:
                        trun.record_backend_fallback(
                            scene_number, "seedance", fb_backend,
                            reason=error_msg[:120],
                        )

                    fb_result = generate_scene(
                        scene_number=scene_number,
                        prompt=fb_prompt,
                        product_name=product_name,
                        veo_path=veo_path,
                        project_base=project_base,
                        mode="frames-to-video" if mode in ("frames-to-video", "audio-lipsync") else "text-to-video",
                        images_dir=images_dir,
                        quality=current_quality,
                        ratio=ratio,
                        backend=fb_backend,
                        run_id=run_id,
                        variations=variations,
                        variation=variation,
                        videos_dir=videos_dir,
                        use_run_dirs=use_run_dirs,
                        project_path=project_path,
                        allow_stale=allow_stale,
                        f2v_loop=f2v_loop,
                        image_run_id=image_run_id,
                        reference_images=reference_images,
                    )
                    if fb_result["success"]:
                        logger.info(
                            "[Scene %d] Fallback to %s succeeded!",
                            scene_number, fb_backend,
                        )
                        return fb_result
                    logger.warning(
                        "[Scene %d] Fallback to %s also failed: %s",
                        scene_number, fb_backend, fb_result.get("error", "unknown"),
                    )

                return result

        # Check if we should retry with same settings
        if attempt < MAX_RETRIES:
            logger.warning("Retry %d/%d in %d seconds...", attempt + 1, MAX_RETRIES, RETRY_DELAY_SECONDS)
            time.sleep(RETRY_DELAY_SECONDS)
            continue

        # All basic retries failed - try quality fallback
        if fallback_quality and current_quality == "quality":
            logger.warning("Quality mode failed, falling back to fast...")
            current_quality = "fast"
            time.sleep(5)  # Brief pause before fallback attempt
            result = generate_scene(
                scene_number=scene_number,
                prompt=current_prompt,
                product_name=product_name,
                veo_path=veo_path,
                project_base=project_base,
                mode=mode,
                images_dir=images_dir,
                quality=current_quality,
                ratio=ratio,
                backend=backend,
                run_id=run_id,
                variations=variations,
                variation=variation,
                videos_dir=videos_dir,
                use_run_dirs=use_run_dirs,
                project_path=project_path,
                allow_stale=allow_stale,
                f2v_loop=f2v_loop,
                reference_images=reference_images
            )
            if result["success"]:
                logger.info("Succeeded with fallback quality: fast")
                return result

        # Try prompt simplification
        if auto_simplify and SIMPLIFY_AVAILABLE and simplify_level < max_simplify_levels:
            simplify_level += 1
            current_prompt = simplify_prompt(original_prompt, simplify_level)
            logger.warning("Retrying with simplified prompt (level %d):", simplify_level)
            logger.debug("Simplified prompt: %s...", current_prompt[:80])
            time.sleep(10)  # Pause before simplified retry
            result = generate_scene(
                scene_number=scene_number,
                prompt=current_prompt,
                product_name=product_name,
                veo_path=veo_path,
                project_base=project_base,
                mode=mode,
                images_dir=images_dir,
                quality=current_quality,
                ratio=ratio,
                backend=backend,
                run_id=run_id,
                variations=variations,
                variation=variation,
                videos_dir=videos_dir,
                use_run_dirs=use_run_dirs,
                project_path=project_path,
                allow_stale=allow_stale,
                f2v_loop=f2v_loop,
                reference_images=reference_images
            )
            if result["success"]:
                logger.info("Succeeded with simplification level %d", simplify_level)
                return result

            # Try higher simplification levels
            while simplify_level < max_simplify_levels and not result["success"]:
                simplify_level += 1
                current_prompt = simplify_prompt(original_prompt, simplify_level)
                logger.warning("Retrying with simplified prompt (level %d):", simplify_level)
                logger.debug("Simplified prompt: %s...", current_prompt[:80])
                time.sleep(10)
                result = generate_scene(
                    scene_number=scene_number,
                    prompt=current_prompt,
                    product_name=product_name,
                    veo_path=veo_path,
                    project_base=project_base,
                    mode=mode,
                    images_dir=images_dir,
                    quality=current_quality,
                    ratio=ratio,
                    backend=backend,
                    run_id=run_id,
                    variations=variations,
                    variation=variation,
                    videos_dir=videos_dir,
                    use_run_dirs=use_run_dirs,
                    project_path=project_path,
                    allow_stale=allow_stale,
                    f2v_loop=f2v_loop,
                    reference_images=reference_images
                )
                if result["success"]:
                    logger.info("Succeeded with simplification level %d", simplify_level)
                    return result

        # v2.39: Image rejection diagnostic — only for frames-to-video with an image
        if (
            not no_image_diagnostic
            and mode == "frames-to-video"
            and images_dir
        ):
            image_rejected = diagnose_image_rejection(
                scene_number=scene_number,
                product_name=product_name,
                veo_path=veo_path,
                project_base=project_base,
                images_dir=images_dir,
                quality=current_quality,
                ratio=ratio,
                backend=backend,
                run_id=run_id,
                variation=variation,
                variations=variations,
                videos_dir=videos_dir,
                use_run_dirs=use_run_dirs,
                project_path=project_path,
                allow_stale=allow_stale,
                f2v_loop=f2v_loop,
                image_run_id=image_run_id,
            )
            if image_rejected:
                result["error"] = (
                    "IMAGE REJECTED: Google's content filter is blocking the "
                    "first-frame image, not the prompt. Regenerate the image "
                    "with softer content (avoid explosions, weapons, combat "
                    "imagery, graphic violence)."
                )
                result["image_rejected"] = True

        logger.error("All retry strategies exhausted")
        break

    return result  # Return the last failed result


def generate_chained_scenes(
    scenes: dict[str, str],
    product_name: str,
    veo_path: str = DEFAULT_VEO_PATH,
    project_base: str = DEFAULT_PROJECT_BASE,
    images_dir: str | None = None,
    quality: str = "fast",
    ratio: str = "landscape",
    backend: str = "useapi",
    run_id: str | None = None,
    videos_dir: str | None = None,
    project_path: str | None = None,
    allow_stale: bool = False,
    chain_from: int = 1,
    chain_retries: int = 2,
    chain_retry_delay: int = 10,
    image_run_id: str | None = None,
    progress_file: str | None = None,
) -> list[dict]:
    """
    Generate scenes in chained F2V mode: each scene starts from previous scene's last frame.

    In chained mode, scenes are generated sequentially. After each scene completes,
    the last frame of its output video is extracted and used as the start frame for
    the next scene. This creates smooth, continuous transitions between scenes.

    Args:
        scenes: Dict mapping scene_number (str) to prompt (sorted by scene number)
        product_name: Project name for output folder
        veo_path: Path to veo-cli
        project_base: Base path for project outputs
        images_dir: Directory with scene_N_frame.* images (start frames)
        quality: "fast" or "quality"
        ratio: "landscape" or "portrait"
        backend: "direct" or "useapi"
        run_id: Run ID for filename prefix
        videos_dir: Override for video output directory
        project_path: Project directory path
        allow_stale: Allow using stale images
        chain_from: Scene number to start chaining from (skip earlier scenes)
        chain_retries: Max retries per scene in chain mode
        chain_retry_delay: Seconds between retries
        image_run_id: Override run prefix for image lookup
        progress_file: Optional path to write progress.json

    Returns:
        List of result dicts for each scene
    """
    results = []
    sorted_scene_nums = sorted(scenes.keys(), key=lambda x: int(x))
    total = len(sorted_scene_nums)
    start_time = time.time()

    # Create chain frames directory
    chain_frames_dir = None
    if images_dir:
        chain_frames_dir = os.path.join(images_dir, "chained_frames")
        os.makedirs(chain_frames_dir, exist_ok=True)

    effective_videos_dir = videos_dir or os.path.join(project_base, product_name, "videos")
    os.makedirs(effective_videos_dir, exist_ok=True)

    # Determine effective run ID for image lookup
    effective_image_run_id = image_run_id if image_run_id else run_id

    logger.info("=" * 60)
    logger.info("Chained F2V Generation")
    logger.info("=" * 60)
    logger.info("Scenes: %s", sorted_scene_nums)
    logger.info("Chain from: scene %d", chain_from)
    logger.info("Retries per scene: %d (delay: %ds)", chain_retries, chain_retry_delay)
    logger.info("=" * 60)

    prev_video_path = None

    for idx, scene_num_str in enumerate(sorted_scene_nums):
        scene_num = int(scene_num_str)
        prompt = scenes[scene_num_str]

        print_progress(idx, total, scene_num, start_time, label="Chaining")

        # Determine the start frame for this scene
        if scene_num < chain_from:
            # Skip scenes before chain_from (use existing videos)
            # Check if existing video exists to chain from
            if run_id:
                existing = os.path.join(effective_videos_dir, f"{run_id}_scene_{scene_num}.mp4")
            else:
                existing = os.path.join(effective_videos_dir, f"scene_{scene_num}.mp4")

            if os.path.exists(existing):
                logger.info("[Scene %d] SKIP (chain-from=%d) — using existing video", scene_num, chain_from)
                prev_video_path = existing
                results.append({
                    "scene_number": scene_num,
                    "success": True,
                    "videos": [existing],
                    "error": None,
                    "mode": "frames-to-video",
                    "prompt": prompt,
                    "run_id": run_id,
                    "skipped": True,
                })
                continue
            else:
                logger.warning("[Scene %d] SKIP requested but no existing video found: %s", scene_num, existing)
                results.append({
                    "scene_number": scene_num,
                    "success": False,
                    "videos": [],
                    "error": f"Chain-from={chain_from} but no existing video for scene {scene_num}",
                    "mode": "frames-to-video",
                    "prompt": prompt,
                    "run_id": run_id,
                })
                continue

        # Determine start frame: chain frame from previous scene OR original image
        start_frame = None
        if prev_video_path and chain_frames_dir:
            # Extract last frame from previous scene's video
            chain_frame_path = os.path.join(chain_frames_dir, f"chain_frame_{scene_num}.jpg")
            logger.info("[Scene %d] Extracting chain frame from previous scene...", scene_num)

            if not CHAIN_AVAILABLE:
                logger.error("[Scene %d] extract_last_frame not available — cannot chain", scene_num)
                results.append({
                    "scene_number": scene_num,
                    "success": False,
                    "videos": [],
                    "error": "extract_last_frame not available",
                    "mode": "frames-to-video",
                    "prompt": prompt,
                    "run_id": run_id,
                })
                break

            success = extract_last_frame(prev_video_path, chain_frame_path)
            if success:
                start_frame = chain_frame_path
                logger.info("[Scene %d] Chain frame: %s", scene_num, chain_frame_path)
            else:
                logger.error("[Scene %d] Failed to extract chain frame from %s", scene_num, prev_video_path)
                results.append({
                    "scene_number": scene_num,
                    "success": False,
                    "videos": [],
                    "error": f"Failed to extract chain frame from {os.path.basename(prev_video_path)}",
                    "mode": "frames-to-video",
                    "prompt": prompt,
                    "run_id": run_id,
                })
                logger.error("Chain broken at scene %d — cannot continue", scene_num)
                break
        else:
            # First scene: use original image from images_dir
            if images_dir:
                prefer_landscape = (ratio == "landscape")
                prefer_cropped = (ratio == "portrait")
                start_frame = find_frame_image(
                    images_dir, scene_num,
                    prefer_cropped=prefer_cropped,
                    prefer_landscape=prefer_landscape,
                    run_id=effective_image_run_id,
                )

            if not start_frame:
                logger.error("[Scene %d] No start frame found in %s", scene_num, images_dir)
                results.append({
                    "scene_number": scene_num,
                    "success": False,
                    "videos": [],
                    "error": f"No start frame found for scene {scene_num}",
                    "mode": "frames-to-video",
                    "prompt": prompt,
                    "run_id": run_id,
                })
                logger.error("Chain broken at scene %d — cannot continue", scene_num)
                break

        # Find end frame (original image for this scene, if it exists)
        end_frame = None
        if images_dir:
            prefer_landscape = (ratio == "landscape")
            prefer_cropped = (ratio == "portrait")
            end_frame = find_frame_image(
                images_dir, scene_num,
                prefer_cropped=prefer_cropped,
                prefer_landscape=prefer_landscape,
                run_id=effective_image_run_id,
            )

        # Build prompt: use I2V (image:start) if no end frame, F2V (frames:start,end) if both exist
        abs_start = os.path.abspath(start_frame)
        tag = f"scene_{scene_num}"

        if end_frame and end_frame != start_frame:
            abs_end = os.path.abspath(end_frame)
            veo_prompt = f"[{tag}] frames:{abs_start},{abs_end} {prompt}"
            logger.info("[Scene %d] F2V: start=%s end=%s", scene_num, os.path.basename(start_frame), os.path.basename(end_frame))
        else:
            veo_prompt = f"[{tag}] image:{abs_start} {prompt}"
            logger.info("[Scene %d] I2V: start=%s", scene_num, os.path.basename(start_frame))

        # Build veo-cli command
        cmd = [
            "bun", "run", "flow.ts",
            "-p", veo_prompt,
            "-n", "1",
            "-r", ratio,
            "-m", quality,
        ]
        if backend and backend != "direct":
            cmd.extend(["--backend", backend])
            cmd.append("--yes")

        # Retry loop for this scene
        scene_success = False
        scene_result = None
        generation_start_time = time.time() - 60  # 60s clock drift tolerance

        for attempt in range(chain_retries + 1):
            if attempt > 0:
                logger.warning("[Scene %d] Retry %d/%d in %ds...", scene_num, attempt, chain_retries, chain_retry_delay)
                time.sleep(chain_retry_delay)

            # Pre-clear stale outputs
            clean_veo_output_directory(veo_path, [scene_num_str])

            try:
                proc = subprocess.run(
                    cmd, cwd=veo_path,
                    capture_output=True, text=True,
                    timeout=900,
                )

                if proc.returncode != 0:
                    logger.error("[Scene %d] veo-cli failed (attempt %d): %s", scene_num, attempt + 1, proc.stderr[:200])
                    continue

                # Copy output
                copy_result = copy_and_rename_outputs(
                    veo_path, project_base, product_name, scene_num,
                    run_id=run_id, variation=None, total_variations=1,
                    videos_dir=effective_videos_dir,
                    min_timestamp=generation_start_time,
                )

                if copy_result["success"] and copy_result["videos"]:
                    output_video = copy_result["videos"][0]

                    # Validate file size
                    if os.path.getsize(output_video) < MIN_VIDEO_SIZE_BYTES:
                        logger.error("[Scene %d] Output too small (%d bytes), retrying...", scene_num, os.path.getsize(output_video))
                        continue

                    scene_success = True
                    prev_video_path = output_video
                    scene_result = {
                        "scene_number": scene_num,
                        "success": True,
                        "videos": [output_video],
                        "error": None,
                        "mode": "frames-to-video",
                        "prompt": prompt,
                        "run_id": run_id,
                    }
                    logger.info("[Scene %d] SUCCESS: %s", scene_num, output_video)
                    break
                else:
                    logger.error("[Scene %d] No output found (attempt %d)", scene_num, attempt + 1)

            except subprocess.TimeoutExpired:
                logger.error("[Scene %d] Timeout (attempt %d)", scene_num, attempt + 1)
            except Exception as e:
                logger.error("[Scene %d] Error (attempt %d): %s", scene_num, attempt + 1, e)

        if not scene_success:
            scene_result = {
                "scene_number": scene_num,
                "success": False,
                "videos": [],
                "error": f"Failed after {chain_retries + 1} attempts",
                "mode": "frames-to-video",
                "prompt": prompt,
                "run_id": run_id,
            }
            logger.error("Chain broken at scene %d — cannot continue past failed scene", scene_num)
            results.append(scene_result)
            break

        results.append(scene_result)
        if progress_file:
            _write_progress(progress_file, results, scenes, start_time)

    print()  # newline after progress bar

    # Summary
    elapsed = time.time() - start_time
    successful = [r for r in results if r.get("success")]
    failed = [r for r in results if not r.get("success")]
    skipped = [r for r in results if r.get("skipped")]

    logger.info("=" * 60)
    logger.info("Chained Generation Complete")
    logger.info("=" * 60)
    logger.info("Total time: %.1fs", elapsed)
    logger.info("Successful: %d/%d (skipped: %d)", len(successful), total, len(skipped))

    if failed:
        logger.error("Failed: %d", len(failed))
        for r in failed:
            logger.error("  Scene %d: %s", r["scene_number"], r.get("error", "Unknown"))
        # Report remaining unchained scenes
        completed_nums = {r["scene_number"] for r in results}
        remaining = [int(s) for s in sorted_scene_nums if int(s) not in completed_nums]
        if remaining:
            logger.error("Unchained (not attempted): %s", remaining)

    logger.info("=" * 60)

    return results


def parse_lipsync_pairs(
    lipsync_pairs_json: str | None,
    scenes: dict[str, str],
    dialogue_map: dict[str, str],
    intro_count: int | None = None,
    outro_count: int | None = None,
) -> dict[str, list[str]]:
    """
    Parse and build lip-sync chain pairs from various input formats.

    Supports three input modes:
    1. Explicit JSON: --lipsync-pairs '{"intro":["17","18"],"outro":["19","20"]}'
    2. Auto from counts: --lipsync-intro-count 2 --lipsync-outro-count 2
       Auto-assigns the first N dialogue scenes to intro, last M to outro.
    3. Auto-detect: Groups consecutive dialogue scenes into chains.

    Args:
        lipsync_pairs_json: JSON string defining explicit chain pairs
        scenes: Full scenes dict (scene_num_str -> prompt)
        dialogue_map: Dict mapping scene_num_str -> dialogue text
        intro_count: Number of intro lip-sync clips (auto-assign mode)
        outro_count: Number of outro lip-sync clips (auto-assign mode)

    Returns:
        Dict mapping group name -> list of scene number strings in chain order.
        Example: {"intro": ["17", "18"], "outro": ["19", "20"]}
    """
    # Mode 1: Explicit JSON
    if lipsync_pairs_json:
        pairs = json.loads(lipsync_pairs_json)
        # Validate that all referenced scenes have dialogue
        for group_name, scene_list in pairs.items():
            for s in scene_list:
                if str(s) not in dialogue_map:
                    raise ValueError(
                        f"Scene {s} in group '{group_name}' has no dialogue. "
                        f"Available dialogue scenes: {sorted(dialogue_map.keys())}"
                    )
        return {k: [str(s) for s in v] for k, v in pairs.items()}

    # Sort dialogue scenes numerically
    dialogue_scenes = sorted(dialogue_map.keys(), key=lambda x: int(x))

    # Mode 2: Auto from intro/outro counts
    if intro_count is not None or outro_count is not None:
        pairs = {}
        remaining = list(dialogue_scenes)

        if intro_count and intro_count > 0:
            if intro_count > len(remaining):
                raise ValueError(
                    f"--lipsync-intro-count {intro_count} exceeds available "
                    f"dialogue scenes ({len(remaining)})"
                )
            pairs["intro"] = remaining[:intro_count]
            remaining = remaining[intro_count:]

        if outro_count and outro_count > 0:
            if outro_count > len(remaining):
                raise ValueError(
                    f"--lipsync-outro-count {outro_count} exceeds remaining "
                    f"dialogue scenes ({len(remaining)})"
                )
            pairs["outro"] = remaining[-outro_count:]
            remaining = remaining[:-outro_count]

        # Any remaining dialogue scenes become individual chains
        for i, s in enumerate(remaining):
            pairs[f"chain_{i+1}"] = [s]

        return pairs

    # Mode 3: Auto-detect consecutive groups
    if not dialogue_scenes:
        return {}

    pairs = {}
    current_group = [dialogue_scenes[0]]
    group_idx = 1

    for i in range(1, len(dialogue_scenes)):
        prev_num = int(dialogue_scenes[i - 1])
        curr_num = int(dialogue_scenes[i])
        if curr_num == prev_num + 1:
            # Consecutive — add to current group
            current_group.append(dialogue_scenes[i])
        else:
            # Gap — finalize current group and start new one
            pairs[f"chain_{group_idx}"] = current_group
            group_idx += 1
            current_group = [dialogue_scenes[i]]

    # Finalize last group
    pairs[f"chain_{group_idx}"] = current_group

    return pairs


def generate_chained_lipsync_scenes(
    scenes: dict[str, str],
    dialogue_map: dict[str, str],
    lipsync_pairs: dict[str, list[str]],
    product_name: str,
    veo_path: str = DEFAULT_VEO_PATH,
    project_base: str = DEFAULT_PROJECT_BASE,
    images_dir: str | None = None,
    quality: str = "fast",
    ratio: str = "landscape",
    backend: str = "useapi",
    run_id: str | None = None,
    videos_dir: str | None = None,
    project_path: str | None = None,
    allow_stale: bool = False,
    chain_retries: int = 2,
    chain_retry_delay: int = 10,
    image_run_id: str | None = None,
    progress_file: str | None = None,
) -> list[dict]:
    """
    Generate chained lip-sync video pairs for intro/outro sequences.

    For each chain group (e.g. intro=[17,18], outro=[19,20]):
    1. Generate first clip from character image with lip-sync dialogue
    2. Extract last frame from first clip
    3. Generate second clip from extracted frame with next dialogue
    4. Repeat for N clips in the chain

    This produces smooth, continuous lip-sync sequences longer than a
    single 8s Veo clip.

    Args:
        scenes: Dict mapping scene_number (str) to prompt
        dialogue_map: Dict mapping scene_number (str) to dialogue text
        lipsync_pairs: Dict mapping group_name to list of scene numbers in chain order
        product_name: Project name for output folder
        veo_path: Path to veo-cli
        project_base: Base path for project outputs
        images_dir: Directory with scene_N_frame.* images
        quality: "fast" or "quality"
        ratio: "landscape" or "portrait"
        backend: "direct", "useapi", or "seedance"
        run_id: Run ID for filename prefix
        videos_dir: Override for video output directory
        project_path: Project directory path
        allow_stale: Allow using stale images
        chain_retries: Max retries per clip
        chain_retry_delay: Seconds between retries
        image_run_id: Override run prefix for image lookup
        progress_file: Optional path to write progress.json

    Returns:
        List of result dicts for each scene
    """
    results = []
    start_time = time.time()
    total_clips = sum(len(chain) for chain in lipsync_pairs.values())

    # Create chain frames directory
    chain_frames_dir = None
    if images_dir:
        chain_frames_dir = os.path.join(images_dir, "lipsync_chain_frames")
        os.makedirs(chain_frames_dir, exist_ok=True)

    effective_videos_dir = videos_dir or os.path.join(project_base, product_name, "videos")
    os.makedirs(effective_videos_dir, exist_ok=True)

    effective_image_run_id = image_run_id if image_run_id else run_id

    logger.info("=" * 60)
    logger.info("Chained Lip-Sync Generation")
    logger.info("=" * 60)
    logger.info("Groups: %d (%s)", len(lipsync_pairs),
                ", ".join(f"{k}={len(v)} clips" for k, v in lipsync_pairs.items()))
    logger.info("Total clips: %d", total_clips)
    logger.info("Retries per clip: %d (delay: %ds)", chain_retries, chain_retry_delay)
    logger.info("=" * 60)

    clip_idx = 0

    for group_name, chain_scene_nums in lipsync_pairs.items():
        logger.info("")
        logger.info("--- Group: %s (scenes: %s) ---", group_name, chain_scene_nums)

        prev_video_path = None

        for chain_pos, scene_num_str in enumerate(chain_scene_nums):
            scene_num = int(scene_num_str)
            prompt = scenes.get(scene_num_str, "")
            dialogue = dialogue_map.get(scene_num_str, "")

            print_progress(clip_idx, total_clips, scene_num, start_time, label="LipSync Chain")
            clip_idx += 1

            if not dialogue:
                logger.error("[Scene %d] No dialogue text found — cannot generate lip-sync", scene_num)
                results.append({
                    "scene_number": scene_num,
                    "success": False,
                    "videos": [],
                    "error": f"No dialogue for scene {scene_num}",
                    "mode": "frames-to-video",
                    "prompt": prompt,
                    "run_id": run_id,
                    "group": group_name,
                })
                logger.error("Chain broken in group '%s' at scene %d", group_name, scene_num)
                break

            # Apply lip-sync prompt wrapping
            try:
                from utils_prompt import format_lipsync_prompt_from_scene
                lipsync_prompt = format_lipsync_prompt_from_scene(prompt, dialogue)
            except ImportError:
                logger.error("utils_prompt.py not found (required for lip-sync)")
                results.append({
                    "scene_number": scene_num,
                    "success": False,
                    "videos": [],
                    "error": "utils_prompt.py not available",
                    "mode": "frames-to-video",
                    "prompt": prompt,
                    "run_id": run_id,
                    "group": group_name,
                })
                break

            # Determine start frame
            start_frame = None
            if prev_video_path and chain_frames_dir:
                # Extract last frame from previous clip in this chain
                chain_frame_path = os.path.join(
                    chain_frames_dir, f"lipsync_chain_{group_name}_{scene_num}.jpg"
                )
                logger.info("[Scene %d] Extracting chain frame from previous clip...", scene_num)

                if not CHAIN_AVAILABLE:
                    logger.error("[Scene %d] extract_last_frame not available", scene_num)
                    results.append({
                        "scene_number": scene_num,
                        "success": False,
                        "videos": [],
                        "error": "extract_last_frame not available",
                        "mode": "frames-to-video",
                        "prompt": lipsync_prompt,
                        "run_id": run_id,
                        "group": group_name,
                    })
                    break

                success = extract_last_frame(prev_video_path, chain_frame_path)
                if success:
                    start_frame = chain_frame_path
                    logger.info("[Scene %d] Chain frame: %s", scene_num, chain_frame_path)

                    # Also copy as the expected frame name for this scene (for downstream tools)
                    if os.path.exists(chain_frame_path):
                        frame_copy_name = f"scene_{scene_num}_frame_landscape.jpg" if ratio == "landscape" else f"scene_{scene_num}_frame.jpg"
                        if run_id:
                            frame_copy_name = f"{run_id}_{frame_copy_name}"
                        frame_copy_path = os.path.join(images_dir, frame_copy_name)
                        shutil.copy2(chain_frame_path, frame_copy_path)
                        logger.info("[Scene %d] Frame copied: %s", scene_num, os.path.basename(frame_copy_path))
                else:
                    logger.error("[Scene %d] Failed to extract chain frame", scene_num)
                    results.append({
                        "scene_number": scene_num,
                        "success": False,
                        "videos": [],
                        "error": f"Failed to extract chain frame from {os.path.basename(prev_video_path)}",
                        "mode": "frames-to-video",
                        "prompt": lipsync_prompt,
                        "run_id": run_id,
                        "group": group_name,
                    })
                    logger.error("Chain broken in group '%s' at scene %d", group_name, scene_num)
                    break
            else:
                # First clip in chain: use original image from images_dir
                if images_dir:
                    prefer_landscape = (ratio == "landscape")
                    prefer_cropped = (ratio == "portrait")
                    start_frame = find_frame_image(
                        images_dir, scene_num,
                        prefer_cropped=prefer_cropped,
                        prefer_landscape=prefer_landscape,
                        run_id=effective_image_run_id,
                    )

                if not start_frame:
                    logger.error("[Scene %d] No start frame found in %s", scene_num, images_dir)
                    results.append({
                        "scene_number": scene_num,
                        "success": False,
                        "videos": [],
                        "error": f"No start frame for scene {scene_num}",
                        "mode": "frames-to-video",
                        "prompt": lipsync_prompt,
                        "run_id": run_id,
                        "group": group_name,
                    })
                    logger.error("Chain broken in group '%s' at scene %d", group_name, scene_num)
                    break

            # Build veo-cli command with lip-sync prompt
            abs_start = os.path.abspath(start_frame)
            tag = f"scene_{scene_num}"
            veo_prompt = f"[{tag}] image:{abs_start} {lipsync_prompt}"

            logger.info("[Scene %d] LipSync I2V: start=%s", scene_num, os.path.basename(start_frame))
            logger.info("[Scene %d] Dialogue: %.60s...", scene_num, dialogue[:60])

            # Seedance backend dispatch
            if backend == "seedance" and SEEDANCE_AVAILABLE:
                vid_dir = effective_videos_dir
                # v2.43: Build extra_reference_urls from storyboard panels
                extra_refs = _build_storyboard_extra_refs(scene_num, _seedance_kwargs,
                                                          project_path or os.path.join(project_base, product_name))
                scene_result = seedance_generate_scene(
                    scene_number=scene_num,
                    prompt=lipsync_prompt,
                    mode="frames-to-video",
                    image_path=abs_start,
                    quality=quality,
                    ratio=ratio,
                    output_dir=vid_dir,
                    run_id=run_id,
                    variation=None,
                    variations=1,
                    duration=_seedance_kwargs.get("duration"),
                    f2v_loop=False,
                    tts_dir=_seedance_kwargs.get("tts_dir_lipsync"),
                    project_path=project_path or os.path.join(project_base, product_name),
                    dry_run=_seedance_kwargs.get("dry_run", False),
                    service_tier=_seedance_kwargs.get("service_tier", "default"),
                    extra_reference_urls=extra_refs,
                    pre_analyze_images=_seedance_kwargs.get("pre_analyze_images", False),
                    risk_threshold=_seedance_kwargs.get("risk_threshold", "high"),
                )
                scene_result["group"] = group_name

                if scene_result.get("success") and scene_result.get("videos"):
                    prev_video_path = scene_result["videos"][0]
                    logger.info("[Scene %d] SUCCESS: %s", scene_num, prev_video_path)
                    results.append(scene_result)
                else:
                    logger.error("[Scene %d] Seedance failed: %s", scene_num, scene_result.get("error"))
                    results.append(scene_result)
                    logger.error("Chain broken in group '%s' at scene %d", group_name, scene_num)
                    break

                if progress_file:
                    _write_progress(progress_file, results, scenes, start_time)
                continue

            # veo-cli backend (direct/useapi)
            cmd = [
                "bun", "run", "flow.ts",
                "-p", veo_prompt,
                "-n", "1",
                "-r", ratio,
                "-m", quality,
            ]
            if backend and backend != "direct":
                cmd.extend(["--backend", backend])
                cmd.append("--yes")

            # Retry loop
            scene_success = False
            scene_result = None
            generation_start_time = time.time() - 60

            for attempt in range(chain_retries + 1):
                if attempt > 0:
                    logger.warning("[Scene %d] Retry %d/%d in %ds...",
                                   scene_num, attempt, chain_retries, chain_retry_delay)
                    time.sleep(chain_retry_delay)

                # Pre-clear stale outputs
                clean_veo_output_directory(veo_path, [scene_num_str])

                try:
                    proc = subprocess.run(
                        cmd, cwd=veo_path,
                        capture_output=True, text=True,
                        timeout=900,
                    )

                    if proc.returncode != 0:
                        logger.error("[Scene %d] veo-cli failed (attempt %d): %s",
                                     scene_num, attempt + 1, proc.stderr[:200])
                        continue

                    copy_result = copy_and_rename_outputs(
                        veo_path, project_base, product_name, scene_num,
                        run_id=run_id, variation=None, total_variations=1,
                        videos_dir=effective_videos_dir,
                        min_timestamp=generation_start_time,
                    )

                    if copy_result["success"] and copy_result["videos"]:
                        output_video = copy_result["videos"][0]

                        if os.path.getsize(output_video) < MIN_VIDEO_SIZE_BYTES:
                            logger.error("[Scene %d] Output too small (%d bytes)",
                                         scene_num, os.path.getsize(output_video))
                            continue

                        scene_success = True
                        prev_video_path = output_video
                        scene_result = {
                            "scene_number": scene_num,
                            "success": True,
                            "videos": [output_video],
                            "error": None,
                            "mode": "frames-to-video",
                            "prompt": lipsync_prompt,
                            "run_id": run_id,
                            "group": group_name,
                        }
                        logger.info("[Scene %d] SUCCESS: %s", scene_num, output_video)
                        break
                    else:
                        logger.error("[Scene %d] No output found (attempt %d)",
                                     scene_num, attempt + 1)

                except subprocess.TimeoutExpired:
                    logger.error("[Scene %d] Timeout (attempt %d)", scene_num, attempt + 1)
                except Exception as e:
                    logger.error("[Scene %d] Error (attempt %d): %s", scene_num, attempt + 1, e)

            if not scene_success:
                scene_result = {
                    "scene_number": scene_num,
                    "success": False,
                    "videos": [],
                    "error": f"Failed after {chain_retries + 1} attempts",
                    "mode": "frames-to-video",
                    "prompt": lipsync_prompt,
                    "run_id": run_id,
                    "group": group_name,
                }
                logger.error("Chain broken in group '%s' at scene %d", group_name, scene_num)
                results.append(scene_result)
                break

            results.append(scene_result)
            if progress_file:
                _write_progress(progress_file, results, scenes, start_time)

    print()  # newline after progress bar

    # Summary
    elapsed = time.time() - start_time
    successful = [r for r in results if r.get("success")]
    failed = [r for r in results if not r.get("success")]

    logger.info("=" * 60)
    logger.info("Chained Lip-Sync Generation Complete")
    logger.info("=" * 60)
    logger.info("Total time: %.1fs", elapsed)
    logger.info("Successful: %d/%d", len(successful), total_clips)

    if failed:
        logger.error("Failed: %d", len(failed))
        for r in failed:
            logger.error("  Scene %d (%s): %s",
                         r["scene_number"], r.get("group", "?"), r.get("error", "Unknown"))

    # Report by group
    for group_name, chain_scene_nums in lipsync_pairs.items():
        group_results = [r for r in results if r.get("group") == group_name]
        group_ok = sum(1 for r in group_results if r.get("success"))
        logger.info("  %s: %d/%d clips", group_name, group_ok, len(chain_scene_nums))

    logger.info("=" * 60)

    return results


def _write_progress(progress_file: str, results: list[dict[str, Any]], scenes: dict[str, str], start_time: float) -> None:
    """Write progress.json after each scene completes."""
    completed = len(results)
    total = len(scenes)
    successful = sum(1 for r in results if r.get("success"))
    current_scene = results[-1]["scene_number"] if results else None
    progress = {
        "completed": completed,
        "successful": successful,
        "total": total,
        "current_scene": current_scene,
        "elapsed": round(time.time() - start_time, 1),
        "scenes_done": [r["scene_number"] for r in results],
    }
    try:
        with open(progress_file, "w") as f:
            json.dump(progress, f, indent=2)
    except OSError:
        pass  # Non-critical, don't fail generation


def run_sequential_generation(
    scenes: dict[str, str],
    product_name: str,
    veo_path: str = DEFAULT_VEO_PATH,
    project_base: str = DEFAULT_PROJECT_BASE,
    mode: str = "text-to-video",
    images_dir: str | None = None,
    quality: str = "fast",
    ratio: str = "landscape",
    interactive: bool = False,
    agent_assisted: bool = False,
    auto_fix_ratio: bool = False,
    backend: str = "direct",
    continue_run: bool = False,
    resume_run: bool = False,
    variations: int = 2,
    strict: bool = False,
    use_run_dirs: bool = False,
    allow_stale: bool = False,
    transitions: dict[str, str] | None = None,
    f2v_loop: bool = False,
    progress_file: str | None = None,
    parallel: int = 1,
    fallback_quality: bool = False,
    auto_simplify: bool = False,
    image_run_id: str | None = None,
    target_duration: int | None = None,
    reference_images: list[str] | None = None,
    no_image_diagnostic: bool = False,
) -> list[dict]:
    """
    Run video generation for multiple scenes sequentially.
    Includes retry logic and outputs recovery commands for failed scenes.

    Multi-Variation Support:
        - T2V mode: Uses -n {variations} to get N outputs from AI randomness (single call per scene)
        - I2V mode: Generates N videos per scene, one per variation image (N calls per scene)
        - R2V mode: Uses 1-3 reference images as style/composition guidance

    Run Versioning:
        - Default (continue_run=False): Creates new run, cleans old videos
        - With --continue (continue_run=True): Continues current run, keeps existing videos

    Args:
        scenes: Dict mapping scene_number (str) to prompt
        product_name: Project name for output folder
        veo_path: Path to veo-cli
        project_base: Base path for project outputs
        mode: "text-to-video", "frames-to-video", or "reference-to-video"
        images_dir: Directory with scene_N_frame.* files (for frames-to-video mode)
        quality: "fast" or "quality"
        ratio: "landscape" or "portrait"
        interactive: Enable interactive review checkpoints
        agent_assisted: Enable AI agent pre-analysis at checkpoints
        auto_fix_ratio: Automatically crop images to fix aspect ratio
        backend: "direct" (default, browser automation) or "useapi" (REST API via useapi.net)
        continue_run: If True, continue existing run without cleaning. If False (default),
                      start fresh run and clean old videos.
        image_run_id: Optional override run prefix for image lookup (e.g. "run001").
                      When set, images are looked up with this prefix while videos
                      are output with the current run's prefix.
        variations: Number of video variations per scene (1-4, default: 2)
        strict: If True, fail immediately if expected images are missing (no fallback)
        use_run_dirs: If True, use new run subdirectory structure (runs/{run_id}/)
        progress_file: Optional path to write progress.json after each scene
        reference_images: List of 1-3 image paths for R2V (reference-to-video) mode

    Returns:
        List of result dicts for each scene
    """
    results = []
    effective_ratio = ratio
    project_dir = os.path.join(project_base, product_name)
    run_id = None
    effective_images_dir = images_dir
    effective_videos_dir = os.path.join(project_dir, "videos")

    # Handle run versioning
    if RUN_MANAGEMENT_AVAILABLE:
        if continue_run:
            # Continue existing run, no cleaning
            run_id = get_current_run_id(project_dir)
            logger.info("=" * 60)
            logger.info("Continuing %s...", run_id)
            logger.info("=" * 60)
        elif resume_run:
            # Resume last incomplete run if one exists
            manifest = get_or_create_manifest(project_dir)
            last_run = manifest.get("runs", [])[-1] if manifest.get("runs") else None
            if last_run and last_run.get("status") in ("in_progress", "failed", "partial"):
                run_id = last_run["run_id"]
                update_run_status(project_dir, run_id, "in_progress")
                logger.info("=" * 60)
                logger.info("Resuming incomplete %s (was: %s)...", run_id, last_run.get('status'))
                logger.info("=" * 60)
            else:
                # No incomplete run found, start fresh
                logger.info("No incomplete run found, starting fresh...")
                resume_run = False  # Fall through to fresh run below

        if not continue_run and not resume_run:
            # Default: new run + clean (safest)
            run_metadata = {
                "scenes": list(scenes.keys()),
                "mode": mode,
                "quality": quality,
                "ratio": ratio,
                "backend": backend,
                "variations": variations,
            }
            run_id = increment_run(project_dir, run_metadata)
            logger.info("=" * 60)
            logger.info("Starting fresh %s...", run_id)
            logger.info("=" * 60)

            # v2.8 FIX: Always clean old videos for fresh runs (regardless of directory structure)
            # This prevents stale videos from previous runs being mixed into the current run
            if use_run_dirs:
                # New structure: clean run-specific subdirectory
                run_videos_dir = os.path.join(get_run_dir(project_dir, run_id), "videos")
                if os.path.exists(run_videos_dir):
                    # Clean all files in the run's videos directory
                    clean_result = clean_artifacts(run_videos_dir, ["."])
                    if sum(clean_result.values()) > 0:
                        logger.info("Cleaned %d old videos from %s/videos/", sum(clean_result.values()), run_id)
            else:
                # Legacy structure: clean flat videos directory (only run-prefixed files)
                clean_result = clean_artifacts(project_dir, ["videos"], run_prefix=run_id)
                if sum(clean_result.values()) > 0:
                    logger.info("Cleaned %d old %s videos for fresh start", sum(clean_result.values()), run_id)

    # Set up effective directories based on run structure
    if use_run_dirs and run_id:
        # New run subdirectory structure: runs/{run_id}/images/, videos/, final/
        run_dir = get_run_dir(project_dir, run_id)
        effective_videos_dir = os.path.join(run_dir, "videos")
        # Images might be in run subdir or in the provided images_dir
        if images_dir:
            # Check if images are in run subdir
            run_images_dir = os.path.join(run_dir, "images")
            if os.path.exists(run_images_dir) and os.listdir(run_images_dir):
                effective_images_dir = run_images_dir
            else:
                effective_images_dir = images_dir
        logger.info("Using run subdirectory structure:")
        logger.info("  Videos: %s", effective_videos_dir)
        if effective_images_dir:
            logger.info("  Images: %s", effective_images_dir)

    # v2.31: Determine effective run ID for image lookup
    # When --image-run is specified, use that prefix for finding images
    # but keep the current run_id for video output naming
    effective_image_run_id = image_run_id if image_run_id else run_id
    if image_run_id and image_run_id != run_id:
        logger.info("Image lookup: %s (override via --image-run)", image_run_id)
        logger.info("Video output: %s", run_id)

    # v2.14: Sync image run prefixes if they don't match expected run
    # v2.20: Added confirmation before renaming (unless --yes is set)
    # v2.31: Skip sync when --image-run is set (user explicitly wants different prefix)
    if mode == "frames-to-video" and effective_images_dir and run_id and not image_run_id:
        try:
            from utils_project import detect_image_run_prefix, sync_image_run_prefix
            detected_run = detect_image_run_prefix(effective_images_dir)
            if detected_run and detected_run != run_id:
                # First do a dry run to show what would change
                would_rename = sync_image_run_prefix(effective_images_dir, run_id, dry_run=True)
                if would_rename:
                    logger.warning("Image run prefix mismatch: images have %s, expected %s", detected_run, run_id)
                    logger.warning("%d file(s) would be renamed", len(would_rename))
                    if not allow_stale:
                        # Actually perform the rename
                        sync_image_run_prefix(effective_images_dir, run_id)
                    else:
                        logger.info("Skipping rename (--allow-stale): using images as-is")
        except ImportError:
            pass  # Skip if functions not available

    # Strict validation for frames-to-video mode
    if strict and mode == "frames-to-video" and effective_images_dir:
        if not STRICT_VALIDATION_AVAILABLE:
            logger.warning("--strict requires utils.py validation functions (not available)")
            logger.warning("Proceeding without strict validation")
        else:
            prefer_cropped = (ratio == "portrait")
            # For new run dirs, files don't have run prefix
            validation_run_id = None if use_run_dirs else run_id
            # v2.9: Pass project_dir for freshness validation
            validation = validate_images_strict(
                images_dir=effective_images_dir,
                scenes=scenes,
                variations=variations,
                run_id=validation_run_id,
                prefer_cropped=prefer_cropped,
                project_path=project_dir,
                check_freshness=True
            )

            print_strict_validation(validation, run_id=run_id, mode=mode)

            # v2.9: Show warning about stale/unprefixed images
            if validation.get("stale"):
                stale_paths = [p for _, _, p, _ in validation["stale"]]
                print_stale_images_warning(stale_paths, [w for _, _, _, w in validation["stale"]], run_id or "current")

            if not validation["valid"]:
                logger.error("STRICT MODE: Aborting due to missing images.")
                logger.error("Generate missing images before running video generation.")
                return [{"scene_number": int(s), "success": False, "error": "Strict validation failed - missing images"} for s in scenes]

    # Print cost estimate
    print_cost_estimate(len(scenes), variations, mode, quality, backend=backend)

    # Seedance: pre-batch balance check
    if backend == "seedance" and SEEDANCE_AVAILABLE:
        balance_info = seedance_check_balance()
        if balance_info is not None:
            credits = balance_info.get("credits") or balance_info.get("balance") or balance_info.get("credit")
            if credits is not None:
                cost_est = estimate_generation_cost(len(scenes), variations, mode, quality, backend)
                needed = cost_est.get("seedance_credits", 0)
                try:
                    credits_num = float(credits)
                    if credits_num < needed:
                        logger.warning("Insufficient credits: have %.0f, need %d. Top up at https://www.xskill.ai",
                                       credits_num, needed)
                    else:
                        logger.info("Seedance balance: %.0f credits (need %d)", credits_num, needed)
                except (ValueError, TypeError):
                    logger.info("Seedance balance: %s", credits)

    # Interactive mode: Create checkpoint for image review before video generation
    if interactive and INTERACTIVE_AVAILABLE and mode == "frames-to-video" and images_dir:
        # Validate aspect ratios and create checkpoint if mismatches found
        validation = validate_and_fix_aspect_ratios(
            images_dir=images_dir,
            target_ratio=ratio,
            auto_fix=False  # Don't auto-fix yet, let user decide
        )

        print_aspect_ratio_summary(validation)

        if not validation["valid"]:
            # Create checkpoint for user to review mismatches
            logger.warning("=" * 60)
            logger.warning("ASPECT RATIO MISMATCH DETECTED")
            logger.warning("=" * 60)
            logger.warning("Mismatched scenes: %s", validation['mismatches'])

            create_checkpoint(
                project_dir=project_dir,
                stage="aspect_mismatch",
                data={
                    "images": validation["images"],
                    "target_ratio": ratio,
                    "mismatches": validation["mismatches"],
                    "portrait_count": validation["portrait_count"],
                    "landscape_count": validation["landscape_count"],
                    "square_count": validation["square_count"],
                },
                agent_assisted=agent_assisted
            )

            logger.info("Review at: http://localhost:5173/video-replicator/review/?project=%s", product_name)
            if agent_assisted:
                logger.info("Agent-assisted mode: AI will pre-analyze images and provide recommendations")
            logger.info("Waiting for approval...")

            try:
                wait_for_approval(project_dir)

                # Check if user requested auto-fix
                if should_auto_fix(project_dir):
                    logger.info("Auto-fixing aspect ratios...")
                    validation = validate_and_fix_aspect_ratios(
                        images_dir=images_dir,
                        target_ratio=ratio,
                        auto_fix=True
                    )
                    print_aspect_ratio_summary(validation)

                # Check if user wants to regenerate specific scenes
                regen_scenes = get_regeneration_list(project_dir)
                if regen_scenes:
                    logger.info("User requested regeneration of scenes: %s", regen_scenes)
                    # Return early - user needs to regenerate images first
                    return [{
                        "scene_number": s,
                        "success": False,
                        "error": "Regeneration requested",
                        "regenerate": True
                    } for s in regen_scenes]

            except TimeoutError:
                logger.warning("Review timeout - proceeding with generation")
            except ValueError as e:
                logger.error("User rejected: %s", e)
                return [{"scene_number": int(s), "success": False, "error": "User rejected"} for s in scenes]

    # Validate aspect ratios for frames-to-video mode
    # When portrait mode, use the cropped portrait images for validation
    # v2.15: When landscape mode, use the _landscape resized images
    if mode == "frames-to-video" and images_dir:
        prefer_cropped = (ratio == "portrait")
        prefer_landscape = (ratio == "landscape")
        ratio_check = validate_image_aspect_ratios(images_dir, scenes, ratio, prefer_cropped=prefer_cropped, prefer_landscape=prefer_landscape, run_id=effective_image_run_id)

        if not ratio_check["consistent"]:
            logger.error("=" * 60)
            logger.error("MIXED ASPECT RATIOS DETECTED")
            logger.error("=" * 60)
            for err in ratio_check["errors"]:
                logger.error("  %s", err)
            logger.error("Please regenerate images with consistent aspect ratios.")
            logger.error("=" * 60)
            return [{"scene_number": int(s), "success": False, "error": "Mixed aspect ratios"} for s in scenes]

        if ratio_check["detected_ratio"]:
            effective_ratio = ratio_check["detected_ratio"]
            if effective_ratio != ratio:
                logger.warning("Auto-detected ratio: %s (overriding --ratio=%s)", effective_ratio, ratio)

    logger.info("=" * 60)
    logger.info("Video Generation (veo-cli)")
    logger.info("=" * 60)
    logger.info("Product: %s", product_name)
    if run_id:
        logger.info("Run: %s", run_id)
    logger.info("Mode: %s", mode)
    logger.info("Quality: %s", quality)
    logger.info("Ratio: %s", effective_ratio)
    logger.info("Backend: %s", backend)
    logger.info("Variations: %d", variations)
    logger.info("Scenes: %s", list(scenes.keys()))
    if images_dir:
        logger.info("Images dir: %s", images_dir)
    if reference_images:
        logger.info("Reference images: %s", reference_images)
    logger.info("=" * 60)

    start_time = time.time()

    # Telemetry: start run (non-fatal)
    _telem = None
    try:
        _telem = _telemetry.start_run(
            project=product_name,
            run_id=run_id or "run000",
            backend=backend,
            quality=quality,
            num_scenes=len(scenes),
            jsonl_dir=Path(project_dir) / "telemetry",
        )
    except Exception:
        pass

    # v2.11: Clean veo-cli output directory BEFORE generation to prevent stale video mixing
    # This removes any leftover files from previous runs that could be mistakenly picked up
    cleaned_count = clean_veo_output_directory(veo_path, list(scenes.keys()))
    if cleaned_count > 0:
        logger.info("Pre-cleaned %d stale file(s) from veo-cli/output-videos/", cleaned_count)

    # Process scenes with retry logic
    # Use effective_videos_dir which may point to runs/{run_id}/videos/
    project_videos_dir = effective_videos_dir

    def _process_one_scene(scene_num: str, prompt: str) -> dict:
        """Generate a single scene (all variations). Thread-safe."""
        # Append camera transition fragment if specified for this scene
        effective_prompt = prompt
        if transitions and scene_num in transitions:
            transition_id = transitions[scene_num]
            prompt_mode = "i2v" if mode == "frames-to-video" else "t2v"
            if is_transition_compatible(transition_id, prompt_mode):
                fragment = get_transition_fragment(transition_id)
                if fragment:
                    effective_prompt = f"{prompt}. {fragment}"
                    logger.info("[Transition] Scene %s: +%s", scene_num, transition_id)
            else:
                logger.warning("[Transition] Scene %s: SKIPPED %s (incompatible with %s)", scene_num, transition_id, prompt_mode)

        if _telem:
            _telem.record_scene_start(int(scene_num))

        if mode in ("frames-to-video", "reference-to-video") and variations > 1:
            # I2V/R2V mode with multi-variation: Generate one video per variation
            scene_results = []
            for v in range(1, variations + 1):
                result = generate_scene_with_retry(
                    scene_number=int(scene_num),
                    prompt=effective_prompt,
                    product_name=product_name,
                    veo_path=veo_path,
                    project_base=project_base,
                    mode=mode,
                    images_dir=effective_images_dir,
                    quality=quality,
                    ratio=effective_ratio,
                    backend=backend,
                    run_id=run_id,
                    variations=variations,
                    variation=v,
                    videos_dir=effective_videos_dir,
                    use_run_dirs=use_run_dirs,
                    project_path=project_dir,
                    allow_stale=allow_stale,
                    f2v_loop=f2v_loop,
                    fallback_quality=fallback_quality,
                    auto_simplify=auto_simplify,
                    image_run_id=effective_image_run_id,
                    reference_images=reference_images,
                    no_image_diagnostic=no_image_diagnostic,
                )

                if result["success"]:
                    verify = verify_scene_outputs(
                        project_videos_dir, int(scene_num),
                        run_id=run_id, variations=variations, variation=v,
                        use_run_dirs=use_run_dirs
                    )
                    if not verify["complete"]:
                        result["success"] = False
                        result["error"] = f"Incomplete outputs: {', '.join(verify['errors'])}"
                        logger.warning("Verification failed for v%d: %s", v, verify['errors'])

                scene_results.append(result)

            combined = {
                "scene_number": int(scene_num),
                "success": all(r.get("success") for r in scene_results),
                "videos": [v for r in scene_results for v in r.get("videos", [])],
                "error": "; ".join([r["error"] for r in scene_results if r.get("error")]) or None,
                "mode": mode,
                "prompt": prompt,
                "run_id": run_id,
                "variations": variations,
                "variation_results": scene_results
            }
            if _telem:
                try:
                    _telem.record_scene_end(
                        scene_id=int(scene_num),
                        status="ok" if combined.get("success") else "fail",
                        cost=combined.get("credits_used", 0),
                        duration=combined.get("elapsed_s", 0.0),
                        quality=combined.get("quality", quality),
                        upload_service=combined.get("upload_service", ""),
                        failure_reason=combined.get("error", "") or "",
                    )
                except Exception:
                    pass
            return combined
        else:
            # T2V mode OR I2V/R2V with single variation: Single call per scene
            result = generate_scene_with_retry(
                scene_number=int(scene_num),
                prompt=effective_prompt,
                product_name=product_name,
                veo_path=veo_path,
                project_base=project_base,
                mode=mode,
                images_dir=effective_images_dir,
                quality=quality,
                ratio=effective_ratio,
                backend=backend,
                run_id=run_id,
                variations=variations,
                variation=None,
                videos_dir=effective_videos_dir,
                use_run_dirs=use_run_dirs,
                project_path=project_dir,
                allow_stale=allow_stale,
                f2v_loop=f2v_loop,
                fallback_quality=fallback_quality,
                auto_simplify=auto_simplify,
                image_run_id=effective_image_run_id,
                reference_images=reference_images,
                no_image_diagnostic=no_image_diagnostic,
            )

            if result["success"]:
                verify = verify_scene_outputs(
                    project_videos_dir, int(scene_num),
                    run_id=run_id, variations=variations,
                    use_run_dirs=use_run_dirs
                )
                if not verify["complete"]:
                    result["success"] = False
                    result["error"] = f"Incomplete outputs: {', '.join(verify['errors'])}"
                    logger.warning("Verification failed: %s", verify['errors'])

            if _telem:
                try:
                    _telem.record_scene_end(
                        scene_id=int(scene_num),
                        status="ok" if result.get("success") else "fail",
                        cost=result.get("credits_used", 0),
                        duration=result.get("elapsed_s", 0.0),
                        quality=result.get("quality", quality),
                        upload_service=result.get("upload_service", ""),
                        failure_reason=result.get("error", "") or "",
                    )
                except Exception:
                    pass
            return result

    # Execute generation: sequential or parallel
    total_scenes = len(scenes)
    gen_start_time = time.time()
    completed_count = 0

    if parallel > 1:
        logger.info("Parallel generation: %d concurrent scenes", parallel)
        results_lock = threading.Lock()
        with concurrent.futures.ThreadPoolExecutor(max_workers=parallel) as executor:
            future_to_scene = {
                executor.submit(_process_one_scene, sn, pr): sn
                for sn, pr in scenes.items()
            }
            for future in concurrent.futures.as_completed(future_to_scene):
                scene_num = future_to_scene[future]
                try:
                    scene_result = future.result()
                except Exception as e:
                    scene_result = {
                        "scene_number": int(scene_num),
                        "success": False,
                        "videos": [],
                        "error": str(e),
                        "mode": mode,
                        "prompt": scenes[scene_num],
                        "run_id": run_id,
                    }
                with results_lock:
                    results.append(scene_result)
                    completed_count += 1
                    print_progress(completed_count, total_scenes, int(scene_num), gen_start_time)
                    if progress_file:
                        _write_progress(progress_file, results, scenes, start_time)
        print()  # newline after progress bar
    else:
        cumulative_runtime = 0.0
        for scene_num, prompt in scenes.items():
            print_progress(completed_count, total_scenes, int(scene_num), gen_start_time)
            scene_result = _process_one_scene(scene_num, prompt)
            results.append(scene_result)
            completed_count += 1
            print_progress(completed_count, total_scenes, int(scene_num), gen_start_time)
            if progress_file:
                _write_progress(progress_file, results, scenes, start_time)
            # Per-scene runtime tracking (v2.34)
            if scene_result.get("success"):
                try:
                    for vp in scene_result.get("videos", []):
                        if os.path.exists(vp):
                            d = get_video_duration(vp)
                            if d:
                                cumulative_runtime += d
                    remaining = total_scenes - completed_count
                    avg_dur = cumulative_runtime / completed_count if completed_count > 0 else 0
                    est_total = cumulative_runtime + (remaining * avg_dur)
                    logger.info(
                        "Runtime: %.0fs so far (est. total: %.0fs / %.1f min)",
                        cumulative_runtime, est_total, est_total / 60,
                    )
                except Exception:
                    pass
        print()  # newline after progress bar

    elapsed = time.time() - start_time

    # Summary
    logger.info("=" * 60)
    logger.info("Generation Complete")
    logger.info("=" * 60)
    logger.info("Total time: %.1fs", elapsed)

    successful = [r for r in results if r.get("success")]
    failed = [r for r in results if not r.get("success")]

    logger.info("Successful: %d/%d", len(successful), len(results))

    for r in successful:
        logger.info("  Scene %d: %d videos", r['scene_number'], len(r.get('videos', [])))

    if failed:
        logger.error("Failed: %d", len(failed))
        for r in failed:
            logger.error("  Scene %d: %s", r['scene_number'], r.get('error', 'Unknown error'))

    # Runtime estimator: cumulative video duration (v2.34)
    cumulative_duration = 0.0
    try:
        for r in successful:
            for vpath in r.get("videos", []):
                if os.path.exists(vpath):
                    dur = get_video_duration(vpath)
                    if dur:
                        cumulative_duration += dur
    except Exception:
        pass  # get_video_duration may not be available

    if cumulative_duration > 0:
        logger.info("Total video runtime: %.0fs (%.1f min)", cumulative_duration, cumulative_duration / 60)
        if target_duration and cumulative_duration < target_duration:
            deficit = target_duration - cumulative_duration
            avg_scene_dur = cumulative_duration / max(len(successful), 1)
            extra_scenes = math.ceil(deficit / avg_scene_dur) if avg_scene_dur > 0 else 0
            logger.warning(
                "Total %.0fs is %.0fs short of %ds target. Need ~%d more scenes.",
                cumulative_duration, deficit, target_duration, extra_scenes,
            )

    logger.info("=" * 60)

    # Print recovery commands for failed scenes
    print_recovery_commands(failed, veo_path, quality, effective_ratio, backend)

    # Update run status if run management is available
    if RUN_MANAGEMENT_AVAILABLE and run_id:
        status = "completed" if all(r.get("success") for r in results) else "partial"
        update_run_status(project_dir, run_id, status, {
            "scenes_completed": len(successful),
            "scenes_failed": len(failed),
        })

    # Interactive mode: Create checkpoint for video review
    if interactive and INTERACTIVE_AVAILABLE and successful:
        videos_data = []
        for r in successful:
            scene_num = r["scene_number"]
            # Use run-prefixed filenames if run_id is set
            if run_id:
                primary = f"videos/{run_id}_scene_{scene_num}.mp4"
                alt = f"videos/{run_id}_scene_{scene_num}_alt.mp4"
            else:
                primary = f"videos/scene_{scene_num}.mp4"
                alt = f"videos/scene_{scene_num}_alt.mp4"
            videos_data.append({
                "scene_number": scene_num,
                "primary": primary,
                "alt": alt,
                "prompt": r.get("prompt", ""),
                "run_id": run_id,
            })

        create_checkpoint(
            project_dir=project_dir,
            stage="videos",
            data={
                "videos": videos_data,
                "project": product_name,
            },
            agent_assisted=agent_assisted
        )

        logger.info("Video review at: http://localhost:5173/video-replicator/review/?project=%s", product_name)
        if agent_assisted:
            logger.info("Agent-assisted mode: AI will compare primary vs alt variants")
        logger.info("Waiting for approval...")

        try:
            wait_for_approval(project_dir)

            # Check if user wants to regenerate specific scenes
            regen_scenes = get_regeneration_list(project_dir)
            if regen_scenes:
                logger.info("User requested regeneration of scenes: %s", regen_scenes)
                # Mark those scenes as needing regeneration
                for r in results:
                    if r["scene_number"] in regen_scenes:
                        r["regenerate"] = True

        except TimeoutError:
            logger.warning("Review timeout - videos approved by default")
        except ValueError as e:
            logger.error("User rejected: %s", e)

    # Telemetry: print report + flush to SQLite (non-fatal)
    if _telem:
        try:
            _telem.print_report()
            db_path = _REPLICATOR_ROOT / "video-replicator.db"
            _telem.flush_to_sqlite(db_path)
        except Exception:
            pass

    return results


def validate_preflight(
    scenes: dict[str, str],
    args: argparse.Namespace,
    transitions: dict[str, str] | None = None,
    check_videos: bool = False
) -> dict[str, Any]:
    """
    Pre-flight validation for video generation.

    Checks:
    - Missing scene images (for I2V mode)
    - Missing scene videos (if check_videos=True)
    - Stale files from previous runs
    - veo-cli availability
    - Bun installation

    Args:
        scenes: Dict mapping scene_number (str) to prompt
        args: CLI arguments
        transitions: Optional camera transitions dict
        check_videos: If True, also check for missing videos (for regeneration)

    Returns:
        {
            "valid": bool,
            "images": {
                "found": [{"scene": N, "path": str, "dims": (w,h), "ratio": str}],
                "missing": [int],  # scene numbers
                "stale": [{"scene": N, "path": str, "warning": str}]
            },
            "videos": {
                "found": [{"scene": N, "path": str, "variations": [int]}],
                "missing": [int],  # scene numbers
                "stale": [{"scene": N, "path": str, "warning": str}]
            },
            "errors": [str],
            "warnings": [str]
        }
    """
    result = {
        "valid": True,
        "images": {"found": [], "missing": [], "stale": []},
        "videos": {"found": [], "missing": [], "stale": []},
        "errors": [],
        "warnings": []
    }

    project_path = os.path.join(args.project_base, args.product)
    run_id = None
    if RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
        run_id = get_current_run_id(project_path)

    # Check veo-cli path
    veo_google_ts = os.path.join(args.veo_path, "flow.ts")
    if not os.path.exists(veo_google_ts):
        result["errors"].append(f"vclaw-cli not found: {args.veo_path}/flow.ts")
        result["valid"] = False

    # Check Bun is installed
    try:
        proc = subprocess.run(["bun", "--version"], capture_output=True, text=True, timeout=5)
        if proc.returncode != 0:
            result["errors"].append("Bun not working properly")
            result["valid"] = False
    except FileNotFoundError:
        result["errors"].append("Bun not installed. Run: brew install oven-sh/bun/bun")
        result["valid"] = False
    except Exception as e:
        result["errors"].append(f"Error checking Bun: {e}")
        result["valid"] = False

    # Check images for frames-to-video mode
    if args.mode == "frames-to-video" and args.images_dir:
        if not os.path.exists(args.images_dir):
            result["errors"].append(f"Images directory not found: {args.images_dir}")
            result["valid"] = False
        else:
            prefer_cropped = (args.ratio == "portrait")
            prefer_landscape = (args.ratio == "landscape")

            # Get run start timestamp for freshness validation
            run_start_ts = None
            if run_id and RUN_MANAGEMENT_AVAILABLE:
                with contextlib.suppress(NameError):
                    run_start_ts = get_run_start_timestamp(project_path, run_id)

            for scene_num in scenes:
                frame_path = find_frame_image(
                    args.images_dir, int(scene_num),
                    prefer_cropped=prefer_cropped,
                    prefer_landscape=prefer_landscape,
                    run_id=run_id
                )

                if not frame_path:
                    result["images"]["missing"].append(int(scene_num))
                else:
                    dims = get_image_dimensions(frame_path)
                    ratio_type = get_aspect_ratio_type(dims[0], dims[1]) if dims else "unknown"

                    image_info = {
                        "scene": int(scene_num),
                        "path": frame_path,
                        "dims": dims,
                        "ratio": ratio_type
                    }

                    # Check freshness if we have a run timestamp
                    is_stale = False
                    stale_warning = None
                    if run_start_ts is not None and run_id:
                        filename = os.path.basename(frame_path)
                        has_run_prefix = filename.startswith(f"{run_id}_")

                        # Check file modification time
                        file_mtime = os.path.getmtime(frame_path)
                        # Allow 2 minutes grace period before run start
                        if file_mtime < run_start_ts - 120:
                            is_stale = True
                            stale_warning = f"Image older than run start (created {int(run_start_ts - file_mtime)}s before)"
                        elif not has_run_prefix:
                            is_stale = True
                            stale_warning = f"Missing run prefix '{run_id}_'"

                    if is_stale:
                        image_info["warning"] = stale_warning
                        result["images"]["stale"].append(image_info)
                        result["warnings"].append(f"Scene {scene_num}: {stale_warning}")
                    else:
                        result["images"]["found"].append(image_info)

            if result["images"]["missing"]:
                result["valid"] = False

    # Check videos (for regeneration mode)
    if check_videos:
        videos_dir = os.path.join(project_path, "videos")
        if os.path.exists(videos_dir):
            variations = getattr(args, 'variations', 2)

            for scene_num in scenes:
                verify = verify_scene_outputs(
                    videos_dir, int(scene_num),
                    run_id=run_id, variations=variations
                )

                if verify["complete"]:
                    # Build list of found variation files
                    found_variations = [v for v, exists in verify["videos"].items() if exists]
                    # Find actual video path
                    if run_id:
                        video_path = os.path.join(videos_dir, f"{run_id}_scene_{scene_num}.mp4")
                    else:
                        video_path = os.path.join(videos_dir, f"scene_{scene_num}.mp4")

                    result["videos"]["found"].append({
                        "scene": int(scene_num),
                        "path": video_path,
                        "variations": found_variations
                    })
                else:
                    result["videos"]["missing"].append(int(scene_num))

    return result


def print_validation_report(validation: dict, run_id: str | None = None) -> None:
    """Print a formatted pre-flight validation report."""
    logger.info("=" * 60)
    logger.info("PRE-FLIGHT VALIDATION REPORT")
    if run_id:
        logger.info("Run: %s", run_id)
    logger.info("=" * 60)

    # Images section
    logger.info("Images:")
    for img in validation["images"]["found"]:
        dims_str = f"{img['dims'][0]}x{img['dims'][1]}" if img['dims'] else "unknown"
        logger.info("  Scene %d: %s (%s, %s)", img['scene'], os.path.basename(img['path']), dims_str, img['ratio'])

    for img in validation["images"]["stale"]:
        dims_str = f"{img['dims'][0]}x{img['dims'][1]}" if img['dims'] else "unknown"
        logger.warning("  Scene %d: %s - STALE (%s)", img['scene'], os.path.basename(img['path']), img.get('warning', 'outdated'))

    for scene_num in validation["images"]["missing"]:
        logger.error("  Scene %d: MISSING", scene_num)

    # Videos section (if checked)
    if validation["videos"]["found"] or validation["videos"]["missing"]:
        logger.info("Videos:")
        for vid in validation["videos"]["found"]:
            vars_str = ", ".join([f"v{v}" for v in vid["variations"]])
            logger.info("  Scene %d: %s (%s)", vid['scene'], os.path.basename(vid['path']), vars_str)

        for scene_num in validation["videos"]["missing"]:
            logger.error("  Scene %d: MISSING", scene_num)

    # Summary
    logger.info("=" * 60)
    missing_images = len(validation["images"]["missing"])
    stale_images = len(validation["images"]["stale"])
    missing_videos = len(validation["videos"]["missing"])

    summary_parts = []
    if missing_images:
        summary_parts.append(f"{missing_images} missing image(s)")
    if stale_images:
        summary_parts.append(f"{stale_images} stale image(s)")
    if missing_videos:
        summary_parts.append(f"{missing_videos} missing video(s)")

    if summary_parts:
        logger.info("Summary: %s", ', '.join(summary_parts))
        if not validation["valid"]:
            logger.error("Status: FAILED - Fix issues before generating")
    else:
        logger.info("Summary: All assets present")
        logger.info("Status: PASSED - Ready for generation")

    logger.info("=" * 60)


def run_preflight_validation(
    scenes: dict[str, str],
    args: argparse.Namespace,
    transitions: dict[str, str] | None = None,
) -> bool:
    """
    Comprehensive pre-flight validation for video generation.

    Checks all prerequisites before expensive Phase 4 video generation:
    - All scene images exist (for I2V/frames-to-video mode)
    - Image aspect ratios are consistent
    - Image freshness (not stale from previous runs)
    - Transition compatibility with generation mode
    - veo-cli path and Bun installation
    - Backend configuration (useapi tokens)

    Prints a formatted GO/NO-GO report and returns True if all checks pass.
    """
    issues = 0
    warnings = 0

    project_path = os.path.join(args.project_base, args.product)
    run_id = None
    if RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
        run_id = get_current_run_id(project_path)

    # v2.31: --image-run overrides for image lookup
    image_run_id = getattr(args, 'image_run', None) or run_id

    logger.info("=" * 60)
    logger.info("PRE-FLIGHT VALIDATION REPORT")
    logger.info("=" * 60)

    # ---- Images Section ----
    if args.mode == "frames-to-video" and args.images_dir:
        logger.info("Images:")
        if not os.path.exists(args.images_dir):
            logger.error("  Images directory not found: %s", args.images_dir)
            issues += 1
        else:
            prefer_cropped = (args.ratio == "portrait")
            prefer_landscape = (args.ratio == "landscape")

            found_ratios = []
            for scene_num in sorted(scenes.keys(), key=lambda x: int(x)):
                frame_path = find_frame_image(
                    args.images_dir, int(scene_num),
                    prefer_cropped=prefer_cropped,
                    prefer_landscape=prefer_landscape,
                    run_id=image_run_id,
                )
                if not frame_path:
                    logger.error("  Scene %s: MISSING -- no frame image found", scene_num)
                    issues += 1
                else:
                    dims = get_image_dimensions(frame_path)
                    if dims:
                        ratio_type = get_aspect_ratio_type(dims[0], dims[1])
                        found_ratios.append(ratio_type)
                        logger.info(
                            "  Scene %s: %s (%dx%d, %s)",
                            scene_num,
                            os.path.basename(frame_path),
                            dims[0], dims[1],
                            ratio_type,
                        )
                    else:
                        logger.warning(
                            "  Scene %s: %s (dimensions unknown)",
                            scene_num,
                            os.path.basename(frame_path),
                        )
                        found_ratios.append("unknown")

            # ---- Aspect Ratios Section ----
            logger.info("")
            logger.info("Aspect Ratios:")
            if found_ratios:
                unique_ratios = set(found_ratios) - {"unknown"}
                if len(unique_ratios) <= 1 and unique_ratios:
                    detected = unique_ratios.pop()
                    logger.info("  All images are %s", detected)
                    # Warn if detected ratio does not match --ratio flag
                    if args.ratio == "portrait" and detected != "portrait":
                        logger.warning(
                            "  Detected %s but --ratio portrait specified (auto-crop will fix)",
                            detected,
                        )
                        warnings += 1
                    elif args.ratio == "landscape" and detected != "landscape":
                        logger.warning(
                            "  Detected %s but --ratio landscape specified (auto-resize will fix)",
                            detected,
                        )
                        warnings += 1
                elif len(unique_ratios) > 1:
                    logger.warning("  Mixed aspect ratios detected: %s", ", ".join(sorted(unique_ratios)))
                    warnings += 1
                else:
                    logger.warning("  Could not determine aspect ratios")
                    warnings += 1
            else:
                logger.warning("  No images to check")

            # ---- Freshness Section ----
            logger.info("")
            logger.info("Freshness:")
            run_start_ts = None
            if image_run_id and RUN_MANAGEMENT_AVAILABLE:
                with contextlib.suppress(NameError):
                    run_start_ts = get_run_start_timestamp(project_path, image_run_id)

            stale_count = 0
            if run_start_ts is not None:
                for scene_num in sorted(scenes.keys(), key=lambda x: int(x)):
                    frame_path = find_frame_image(
                        args.images_dir, int(scene_num),
                        prefer_cropped=prefer_cropped,
                        prefer_landscape=prefer_landscape,
                        run_id=image_run_id,
                    )
                    if frame_path and os.path.exists(frame_path):
                        file_mtime = os.path.getmtime(frame_path)
                        filename = os.path.basename(frame_path)
                        has_run_prefix = filename.startswith(f"{image_run_id}_")
                        # Allow 2 minutes grace period
                        if file_mtime < run_start_ts - 120:
                            age_secs = int(run_start_ts - file_mtime)
                            logger.warning(
                                "  Scene %s: STALE -- image is %ds older than run start",
                                scene_num, age_secs,
                            )
                            stale_count += 1
                        elif not has_run_prefix:
                            logger.warning(
                                "  Scene %s: missing run prefix '%s_'",
                                scene_num, image_run_id,
                            )
                            stale_count += 1
                if stale_count == 0:
                    logger.info("  All images from current run (%s)", image_run_id or "no run")
                else:
                    if not getattr(args, 'allow_stale', False):
                        issues += stale_count
                    else:
                        logger.info("  --allow-stale is set, stale images permitted")
                        warnings += stale_count
            else:
                logger.info("  No run timestamp available -- skipping freshness check")

    elif args.mode == "text-to-video":
        logger.info("Images:")
        logger.info("  N/A (text-to-video mode -- no images needed)")
        logger.info("")
        logger.info("Aspect Ratios:")
        logger.info("  N/A")
        logger.info("")
        logger.info("Freshness:")
        logger.info("  N/A")

    # ---- Transitions Section ----
    logger.info("")
    logger.info("Transitions:")
    if transitions:
        for scene_num in sorted(transitions.keys(), key=lambda x: int(x)):
            tid = transitions[scene_num]
            t = CAMERA_TRANSITIONS.get(tid, {})
            t_name = t.get("name", tid)

            if TRANSITIONS_AVAILABLE:
                compatible = is_transition_compatible(tid, args.mode)
                if compatible:
                    logger.info("  Scene %s: %s (%s) -- compatible with %s", scene_num, t_name, tid, args.mode)
                else:
                    logger.warning(
                        "  Scene %s: %s (%s) -- INCOMPATIBLE with %s (will be skipped)",
                        scene_num, t_name, tid, args.mode,
                    )
                    warnings += 1
            else:
                logger.info("  Scene %s: %s (%s)", scene_num, t_name, tid)
    else:
        logger.info("  None configured")

    # ---- Backend Section ----
    logger.info("")
    logger.info("Backend:")

    # Check veo-cli
    veo_google_ts = os.path.join(args.veo_path, "flow.ts")
    if os.path.exists(veo_google_ts):
        logger.info("  veo-cli found at %s", args.veo_path)
    else:
        logger.error("  veo-cli NOT found at %s", args.veo_path)
        issues += 1

    # Check Bun
    try:
        proc = subprocess.run(["bun", "--version"], capture_output=True, text=True, timeout=5)
        if proc.returncode == 0:
            logger.info("  Bun installed: v%s", proc.stdout.strip())
        else:
            logger.error("  Bun not working properly")
            issues += 1
    except FileNotFoundError:
        logger.error("  Bun not installed. Run: brew install oven-sh/bun/bun")
        issues += 1
    except Exception as e:
        logger.error("  Error checking Bun: %s", e)
        issues += 1

    # Check backend-specific configuration
    backend = getattr(args, 'backend', 'useapi')
    if backend == "seedance":
        # Seedance backend: skip veo-cli/Bun checks, just need API key
        if not SEEDANCE_AVAILABLE:
            logger.error("  Backend: seedance -- module not available (import failed)")
            issues += 1
        elif os.environ.get("SUTUI_API_KEY"):
            logger.info("  Backend: seedance (SUTUI_API_KEY set)")
        else:
            logger.error("  Backend: seedance -- SUTUI_API_KEY not set")
            issues += 1
    elif backend == "useapi":
        token_set = bool(os.environ.get("USEAPI_API_TOKEN"))
        email_set = bool(os.environ.get("USEAPI_ACCOUNT_EMAIL"))
        if token_set and email_set:
            logger.info("  Backend: useapi (USEAPI_API_TOKEN and USEAPI_ACCOUNT_EMAIL set)")
        else:
            missing = []
            if not token_set:
                missing.append("USEAPI_API_TOKEN")
            if not email_set:
                missing.append("USEAPI_ACCOUNT_EMAIL")
            logger.error("  Backend: useapi -- missing env vars: %s", ", ".join(missing))
            issues += 1
    else:
        cookie_path = os.path.join(args.veo_path, "cookie.json")
        if os.path.exists(cookie_path):
            logger.info("  Backend: direct (cookie.json found)")
        else:
            logger.warning("  Backend: direct -- cookie.json missing (run veo-cli with --visible to log in)")
            warnings += 1

    # ---- Generation Config Section ----
    logger.info("")
    logger.info("Generation Config:")
    logger.info("  Mode: %s", args.mode)
    logger.info("  Quality: %s", args.quality)
    logger.info("  Ratio: %s", args.ratio)
    logger.info("  Variations: %d", args.variations)
    logger.info("  Scenes: %d", len(scenes))
    if run_id:
        logger.info("  Run: %s", run_id)
    if image_run_id and image_run_id != run_id:
        logger.info("  Image run: %s (decoupled)", image_run_id)

    # ---- Result ----
    logger.info("")
    logger.info("=" * 60)
    if issues == 0 and warnings == 0:
        logger.info("RESULT: All checks passed -- GO")
    elif issues == 0:
        logger.warning("RESULT: %d warning(s) -- GO WITH CAUTION", warnings)
    else:
        logger.error("RESULT: %d issue(s) found -- FIX BEFORE PROCEEDING", issues)
    logger.info("=" * 60)

    return issues == 0


def validate_dry_run(scenes: dict[str, str], args: argparse.Namespace, transitions: dict[str, str] | None = None) -> bool:
    """
    Validate inputs without calling APIs.
    Returns True if validation passes, False otherwise.
    """
    logger.info("=" * 60)
    logger.info("DRY RUN - Validating inputs")
    logger.info("=" * 60)

    errors = []

    # Get run_id for finding run-prefixed images (v2.10)
    project_path = os.path.join(args.project_base, args.product)
    run_id = None
    if RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
        run_id = get_current_run_id(project_path)

    # Check veo-cli path
    veo_google_ts = os.path.join(args.veo_path, "flow.ts")
    if not os.path.exists(veo_google_ts):
        errors.append(f"vclaw-cli not found: {args.veo_path}/flow.ts")
    else:
        logger.info("veo-cli found: %s", args.veo_path)

    # Check Bun is installed
    try:
        proc = subprocess.run(["bun", "--version"], capture_output=True, text=True, timeout=5)
        if proc.returncode == 0:
            logger.info("Bun installed: v%s", proc.stdout.strip())
        else:
            errors.append("Bun not working properly")
    except FileNotFoundError:
        errors.append("Bun not installed. Run: brew install oven-sh/bun/bun")
    except Exception as e:
        errors.append(f"Error checking Bun: {e}")

    # Check output directory is writable
    output_dir = os.path.join(args.project_base, args.product, "videos")
    try:
        os.makedirs(output_dir, exist_ok=True)
        logger.info("Output directory writable: %s", output_dir)
    except Exception as e:
        errors.append(f"Cannot create output directory: {e}")

    # Check frames-to-video mode requirements
    detected_ratio = None
    if args.mode == "frames-to-video":
        if not args.images_dir:
            errors.append("--images-dir required for frames-to-video mode")
        elif not os.path.exists(args.images_dir):
            errors.append(f"Images directory not found: {args.images_dir}")
        else:
            logger.info("Images directory found: %s", args.images_dir)

            # Validate aspect ratio consistency
            # v2.15: Pass prefer flags to use processed images for validation
            prefer_cropped = (args.ratio == "portrait")
            prefer_landscape = (args.ratio == "landscape")
            ratio_check = validate_image_aspect_ratios(args.images_dir, scenes, args.ratio, prefer_cropped=prefer_cropped, prefer_landscape=prefer_landscape, run_id=run_id)

            # Show each image with dimensions
            for scene_num, info in ratio_check["images"].items():
                dims = info["dims"]
                ratio = info["ratio"]
                logger.info("  Scene %s: %dx%d (%s)", scene_num, dims[0], dims[1], ratio)

            # Add errors for missing images
            for scene_num in scenes:
                if scene_num not in ratio_check["images"]:
                    frame_path = find_frame_image(args.images_dir, int(scene_num), run_id=run_id)
                    if not frame_path:
                        errors.append(f"No frame image for scene {scene_num} in {args.images_dir}")

            # Check aspect ratio consistency
            if not ratio_check["consistent"]:
                for err in ratio_check["errors"]:
                    errors.append(err)
            else:
                detected_ratio = ratio_check["detected_ratio"]
                if detected_ratio:
                    logger.info("Aspect ratio: All images are %s", detected_ratio)

            # Show warnings (ratio mismatch)
            for warn in ratio_check["warnings"]:
                logger.warning("%s", warn)

    # Check prompts
    logger.info("%d scenes to generate:", len(scenes))
    for scene_num, prompt in scenes.items():
        prompt_preview = prompt[:50] + "..." if len(prompt) > 50 else prompt
        transition_info = ""
        if transitions and scene_num in transitions:
            tid = transitions[scene_num]
            t = CAMERA_TRANSITIONS.get(tid, {})
            transition_info = f" [transition: {t.get('name', tid)}]"
        logger.info("  Scene %s: %s%s", scene_num, prompt_preview, transition_info)

    # Show veo-cli command preview (use detected ratio if available)
    effective_ratio = detected_ratio if detected_ratio else args.ratio
    prefer_cropped = (effective_ratio == "portrait")
    prefer_landscape = (effective_ratio == "landscape")
    logger.info("veo-cli command preview:")
    for scene_num, prompt in list(scenes.items())[:1]:  # Show first scene only
        tag = f"scene_{scene_num}"
        if args.mode == "frames-to-video" and args.images_dir:
            frame_path = find_frame_image(args.images_dir, int(scene_num), prefer_cropped=prefer_cropped, prefer_landscape=prefer_landscape, run_id=run_id) or "<frame>"
            veo_prompt = f"[{tag}] image:{frame_path} {prompt[:30]}..."
        else:
            veo_prompt = f"[{tag}] {prompt[:30]}..."
        logger.info("  bun run flow.ts -p \"%s\" -n 2 -r %s -m %s", veo_prompt, effective_ratio, args.quality)

    # Summary
    logger.info("=" * 60)
    if errors:
        logger.error("DRY RUN FAILED - Errors found:")
        for err in errors:
            logger.error("  %s", err)
        logger.info("=" * 60)
        return False
    else:
        logger.info("DRY RUN PASSED - All validations passed")
        logger.info("=" * 60)
        return True


# ============================================================================
# v2.43 Pre-Flight Helpers
# ============================================================================


def _run_style_consistency_check(
    scenes: dict[str, str],
    images_dir: str,
    fail_on_mismatch: bool = False,
) -> None:
    """
    Check visual style consistency across all frame images using Gemini Vision.

    Classifies each image into a style category (photorealistic, 3d_animated,
    anime, sketch, illustration, mixed) and warns if styles are mixed.

    Args:
        scenes: Scene number → prompt mapping (used to identify which scenes to check).
        images_dir: Directory containing frame images.
        fail_on_mismatch: If True, exit with error on mixed styles.
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[Style Check] GOOGLE_API_KEY not set — skipping style consistency check")
        return

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        logger.warning("[Style Check] google-genai not installed — skipping style consistency check")
        return

    client = genai.Client(api_key=api_key)
    styles: dict[str, str] = {}  # scene_num → style
    scene_images: dict[str, str] = {}  # scene_num → image_path

    # Collect image paths for each scene
    for scene_num in scenes:
        img = find_frame_image(images_dir, int(scene_num), prefer_landscape=True)
        if img and os.path.exists(img):
            scene_images[scene_num] = img

    if not scene_images:
        logger.warning("[Style Check] No frame images found — skipping style consistency check")
        return

    logger.info("[Style Check] Classifying visual style for %d scene images...", len(scene_images))

    classify_prompt = (
        "Classify this image's visual style into ONE of these categories: "
        "photorealistic, 3d_animated, anime, sketch, illustration, mixed. "
        "Reply with just the category name."
    )

    for scene_num, img_path in scene_images.items():
        try:
            with open(img_path, "rb") as f:
                image_bytes = f.read()

            mime = "image/jpeg"
            if img_path.lower().endswith(".png"):
                mime = "image/png"
            elif img_path.lower().endswith(".webp"):
                mime = "image/webp"

            response = client.models.generate_content(
                model=GEMINI_FLASH_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime),
                    classify_prompt,
                ],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=20,
                ),
            )
            style = response.text.strip().lower().replace(" ", "_")
            styles[scene_num] = style
            logger.debug("[Style Check] Scene %s: %s (%s)", scene_num, style, os.path.basename(img_path))
        except Exception as e:
            logger.warning("[Style Check] Failed to classify scene %s: %s", scene_num, e)
            styles[scene_num] = "unknown"

    # Analyze results
    known_styles = {s for s in styles.values() if s != "unknown"}
    if len(known_styles) <= 1:
        style_name = next(iter(known_styles)) if known_styles else "unknown"
        logger.info("[Style Check] Style consistency check passed: all %d scenes are '%s'",
                    len(styles), style_name)
        return

    # Mixed styles detected
    from collections import Counter
    style_counts = Counter(styles.values())
    logger.warning(
        "[Style Check] Style clash detected across %d scenes: %s. "
        "Mixing styles (e.g. sketch storyboard + photorealistic character) causes hybrid output. "
        "Recommend fixing reference images or using --style-consistency-fail to abort.",
        len(styles), dict(style_counts),
    )

    if fail_on_mismatch:
        logger.error("[Style Check] Aborting due to --style-consistency-fail")
        sys.exit(1)


def _run_4k_upscale_preflight(
    scenes: dict[str, str],
    images_dir: str,
    upscale_prompt: str,
    run_id: str | None = None,
    image_run_id: str | None = None,
    ratio: str = "landscape",
    variations: int = 1,
) -> None:
    """
    Upscale frame images to 4K via Go Bananas MCP before Seedance submission.

    For each scene's frame image, calls Go Bananas generate_image with the
    upscale prompt and the original image as a reference. Saves the upscaled
    result as {original_name}_4k.jpg in the same directory.

    If upscale fails for a scene, logs a warning and falls back to the original.

    Args:
        scenes: Scene number → prompt mapping.
        images_dir: Directory containing frame images.
        upscale_prompt: Prompt for the upscale generation.
        run_id: Current run ID for image lookup.
        image_run_id: Override run prefix for image lookup.
        ratio: Aspect ratio (landscape/portrait).
        variations: Number of variations (for image lookup).
    """
    logger.info("[4K Upscale] Starting 4K upscale pre-flight for %d scenes...", len(scenes))

    # Check for Go Bananas MCP availability — this is an MCP tool, so we can't
    # call it directly from Python. Instead, log the commands the user should run.
    # For automated upscale, we use Go Bananas REST API if GO_BANANAS_API_KEY is set.
    go_bananas_key = os.environ.get("GO_BANANAS_API_KEY")
    if not go_bananas_key:
        logger.warning(
            "[4K Upscale] GO_BANANAS_API_KEY not set. "
            "4K upscale requires Go Bananas REST API access. "
            "Set GO_BANANAS_API_KEY in environment or .claude/settings.local.json. "
            "Skipping upscale — using original images."
        )
        return

    try:
        import requests as _requests
    except ImportError:
        logger.warning("[4K Upscale] requests library not available — skipping upscale")
        return

    lookup_run_id = image_run_id or run_id
    prefer_landscape = (ratio == "landscape")
    prefer_cropped = (ratio == "portrait")
    upscaled_count = 0
    failed_count = 0

    for scene_num in scenes:
        scene_int = int(scene_num)
        img_path = find_frame_image(
            images_dir, scene_int,
            prefer_landscape=prefer_landscape,
            prefer_cropped=prefer_cropped,
            run_id=lookup_run_id,
        )
        if not img_path or not os.path.exists(img_path):
            logger.warning("[4K Upscale] Scene %s: no frame image found — skipping", scene_num)
            failed_count += 1
            continue

        # Check if already upscaled
        base, ext = os.path.splitext(img_path)
        upscaled_path = f"{base}_4k{ext}"
        if os.path.exists(upscaled_path) and os.path.getsize(upscaled_path) > 1000:
            logger.info("[4K Upscale] Scene %s: already upscaled — %s", scene_num, os.path.basename(upscaled_path))
            upscaled_count += 1
            continue

        try:
            # Upload image to Go Bananas
            logger.info("[4K Upscale] Scene %s: uploading %s...", scene_num, os.path.basename(img_path))

            # Step 1: Upload image to get a hosted URL
            with open(img_path, "rb") as f:
                upload_resp = _requests.post(
                    "https://api.gobananas.live/api/v1/images/upload",
                    headers={"Authorization": f"Bearer {go_bananas_key}"},
                    files={"file": (os.path.basename(img_path), f, "image/jpeg")},
                    timeout=60,
                )
            if upload_resp.status_code != 200:
                raise RuntimeError(f"Upload failed: HTTP {upload_resp.status_code}")
            upload_data = upload_resp.json()
            image_url = upload_data.get("url") or upload_data.get("data", {}).get("url")
            if not image_url:
                raise RuntimeError(f"No URL in upload response: {upload_resp.text[:200]}")

            # Step 2: Generate upscaled image
            logger.info("[4K Upscale] Scene %s: generating 4K upscale...", scene_num)
            gen_resp = _requests.post(
                "https://api.gobananas.live/api/v1/images/generate",
                headers={
                    "Authorization": f"Bearer {go_bananas_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "prompt": upscale_prompt,
                    "reference_images": [image_url],
                    "model_id": "gemini-pro-image",
                    "aspect_ratio": "16:9" if ratio == "landscape" else "9:16",
                },
                timeout=120,
            )
            if gen_resp.status_code != 200:
                raise RuntimeError(f"Generate failed: HTTP {gen_resp.status_code}")
            gen_data = gen_resp.json()
            result_url = gen_data.get("url") or gen_data.get("data", {}).get("url")
            if not result_url:
                raise RuntimeError(f"No URL in generate response: {gen_resp.text[:200]}")

            # Step 3: Download upscaled image
            dl_resp = _requests.get(result_url, timeout=60)
            dl_resp.raise_for_status()
            with open(upscaled_path, "wb") as f:
                f.write(dl_resp.content)

            logger.info("[4K Upscale] Scene %s: upscaled %s -> %s",
                        scene_num, os.path.basename(img_path), os.path.basename(upscaled_path))
            upscaled_count += 1

        except Exception as e:
            logger.warning("[4K Upscale] Scene %s: upscale failed (%s) — using original image", scene_num, e)
            failed_count += 1

    logger.info("[4K Upscale] Complete: %d upscaled, %d failed (using originals)", upscaled_count, failed_count)


def main() -> None:
    parser = argparse.ArgumentParser(description="Video generation using veo-cli")
    parser.add_argument("--product", required=True, help="Product/project name")
    parser.add_argument("--config", help="JSON config file with scene prompts")
    parser.add_argument("--scenes", help="Inline JSON: {\"1\": \"prompt\", \"3\": \"prompt\"}")
    parser.add_argument("--veo-path", default=DEFAULT_VEO_PATH, help="Path to veo-cli")
    parser.add_argument("--project-base", default=DEFAULT_PROJECT_BASE, help="Base path for projects")
    parser.add_argument("--mode", choices=["text-to-video", "frames-to-video", "reference-to-video", "audio-lipsync", "motion-transfer"],
                        default="text-to-video",
                        help="Generation mode: text-to-video (default), frames-to-video, "
                             "reference-to-video (R2V: 1-3 reference images as style/composition guide), "
                             "audio-lipsync (Seedance: TTS-driven lip sync), "
                             "motion-transfer (Seedance: replicate reference video motion)")
    parser.add_argument("--images-dir", help="Directory with scene_N_frame.* images (required for frames-to-video)")
    parser.add_argument("--reference-images",
                        help="Comma-separated paths to 1-3 reference images (required for reference-to-video). "
                             "Images guide style/composition without constraining the start frame. "
                             "Only works with fast quality (veo-3.1-fast). "
                             "Example: --reference-images hero.jpg,detail.jpg")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast",
                        help="Video quality: fast (default, 10 credits) or quality (100 credits)")
    parser.add_argument("--ratio", choices=["landscape", "portrait"], default="landscape",
                        help="Aspect ratio: landscape (16:9, default) or portrait (9:16)")
    parser.add_argument("--dry-run", action="store_true", help="Validate inputs without calling APIs")
    parser.add_argument("--preflight", action="store_true",
                        help="Run comprehensive pre-flight validation and print GO/NO-GO report")
    parser.add_argument("--interactive", action="store_true",
                        help="Enable interactive review checkpoints (requires review server)")
    parser.add_argument("--agent-assisted", action="store_true",
                        help="Enable AI agent pre-analysis at review checkpoints (QA scores, recommendations)")
    parser.add_argument("--auto-fix-ratio", action="store_true",
                        help="Automatically crop images to fix aspect ratio mismatches")
    parser.add_argument("--auto-crop", action="store_true", default=True,
                        help="Auto-crop landscape images to portrait when --ratio portrait (default: enabled)")
    parser.add_argument("--no-auto-crop", action="store_true",
                        help="Disable auto-crop (fail if landscape images found with --ratio portrait)")
    parser.add_argument("--f2v-loop", action="store_true",
                        help="F2V seamless loop: use same image as start AND end frame. "
                             "Veo animates elements and returns to starting position for seamless loops. "
                             "Requires --mode frames-to-video.")
    parser.add_argument("--backend", choices=["direct", "useapi", "seedance"], default="useapi",
                        help="Backend: useapi (REST API, default), direct (browser automation), "
                             "or seedance (Seedance 2.0 API, supports lip-sync/motion-transfer)")
    # Seedance-specific arguments (v2.33)
    parser.add_argument("--duration", type=int, default=None,
                        help="Video duration in seconds (Seedance only: 4-15, default: 8)")
    parser.add_argument("--motion-ref", default=None,
                        help="Reference video for motion transfer (Seedance --mode motion-transfer)")
    parser.add_argument("--camera-ref", default=None,
                        help="Reference video for camera movement replication (Seedance, any I2V/T2V mode). "
                             "The generated video will follow the camera work from the reference.")
    parser.add_argument("--tts-dir-lipsync", default=None,
                        help="TTS directory for audio lip-sync (Seedance --mode audio-lipsync). "
                             "Finds scene_N_tts.mp3 files automatically.")
    # Seedance v2.37 additions
    parser.add_argument("--check-balance", action="store_true",
                        help="Pre-flight Seedance balance check before generation (Seedance only)")
    parser.add_argument("--service-tier", choices=["default", "flex"], default="default",
                        help="Seedance service tier: default (full cost) or flex (50%% savings)")
    parser.add_argument("--estimate-cost", action="store_true",
                        help="Print Seedance cost estimate and exit without generating (Seedance only)")
    # Seedance v2.43: storyboard panel as extra image reference
    parser.add_argument("--storyboard-panels", default=None,
                        help="Path to storyboard_panels.json — each scene's panel is injected as an "
                             "extra Seedance image reference (Seedance only)")
    parser.add_argument("--extended-ratios", action="store_true",
                        help="Enable extended aspect ratios: 21:9, 4:3, 3:4, adaptive (Seedance only)")
    parser.add_argument("--one-take", action="store_true",
                        help="Generate one-take shot (一镜到底) across all scenes (Seedance only). "
                             "Produces continuous uncut video.")
    parser.add_argument("--prompt-enhance", action="store_true",
                        help="Auto-enhance prompts with cinematic camera vocab, style tokens, "
                             "time segments, and negative prompts (Seedance only)")
    parser.add_argument("--genre", default="cinematic",
                        help="Style genre for --prompt-enhance (default: cinematic). "
                             "Options: cinematic, commercial, documentary, dramatic, luxury, "
                             "action, nature, horror, romantic, sci_fi, fight, xianxia, "
                             "ecommerce, food, popscience, kpop, fantasy")
    parser.add_argument("--prompt-style", default=None,
                        help="DB-powered prompt enhancement style (v2.36). "
                             "Auto-detects genre from description if not specified. "
                             "Auto-enabled for seedance backend (use --no-prompt-style to disable). "
                             "Use --list-prompt-styles to see available styles. "
                             "Overrides --prompt-enhance when set.")
    parser.add_argument("--no-prompt-style", action="store_true",
                        help="Disable auto prompt enhancement for seedance backend")
    parser.add_argument("--list-prompt-styles", action="store_true",
                        help="List all available prompt styles from the DB and exit")

    # v2.43: Camera Variety Block
    parser.add_argument("--camera-variety", action="store_true",
                        help="Append standardized camera shot block to every Seedance prompt. "
                             "Improves dynamic camera angles (Seedance only).")
    # v2.43: 4K Upscale Pre-Flight
    parser.add_argument("--upscale-4k", action="store_true",
                        help="Upscale frame images to 4K via Go Bananas before submitting to Seedance. "
                             "Produces significantly better video quality (Seedance only).")
    parser.add_argument("--upscale-4k-prompt", type=str, default=None,
                        help="Custom prompt for 4K upscale (default: 'upscale image, high detail, "
                             "4K, preserve all details, cinematic quality')")
    # v2.43: Style Consistency Pre-Flight
    parser.add_argument("--check-style-consistency", action="store_true",
                        help="Check visual style consistency across all frame images before generation. "
                             "Uses Gemini Vision to detect mixed styles (Seedance only).")
    parser.add_argument("--style-consistency-fail", action="store_true",
                        help="Abort if style consistency check detects mixed styles (default: warn only)")

    parser.add_argument("--variations", type=int, default=2, choices=[1, 2, 3, 4],
                        help="Number of video variations per scene (1-4, default: 2). "
                             "T2V: uses -n flag for AI randomness. "
                             "I2V: expects N images per scene (scene_N_frame_v1.png, etc.)")

    # Quality shortcuts
    quality_shortcuts = parser.add_mutually_exclusive_group()
    quality_shortcuts.add_argument("--draft", action="store_true",
                                   help="Shortcut for --quality fast --variations 1 (quick iteration)")
    quality_shortcuts.add_argument("--final", action="store_true",
                                   help="Shortcut for --quality quality --variations 2 (production)")

    # Strict validation
    parser.add_argument("--strict", action="store_true",
                        help="Strict mode: fail immediately if expected images are missing (no fallback). "
                             "Shows pre-flight validation report before generation.")
    parser.add_argument("--allow-stale", action="store_true",
                        help="Allow using images from previous runs (v2.12: default is to fail on stale images)")

    # Pre-flight validation (Phase 3.1)
    parser.add_argument("--validate", action="store_true",
                        help="Pre-flight validation: check for missing images/videos without generating. "
                             "Outputs clear report showing what's present, missing, and stale.")
    parser.add_argument("--regenerate-missing", action="store_true",
                        help="Auto-detect and regenerate only missing scene videos. "
                             "Scans videos directory and generates only scenes that don't have videos.")
    parser.add_argument("--yes", "-y", action="store_true",
                        help="Skip confirmation prompts (for scripting/automation)")
    parser.add_argument("--progress",
                        help="Write progress.json to this path after each scene completes")
    parser.add_argument("--parallel", type=int, default=1,
                        help="Number of scenes to generate concurrently (default: 1, max: 5). "
                             "Use 3 for useapi backend, 1 for direct backend.")

    # v2.27: Reliability improvements
    parser.add_argument("--fallback-quality", action="store_true",
                        help="Auto-fallback from quality→fast on generation failure")
    parser.add_argument("--auto-simplify", action="store_true",
                        help="Auto-simplify prompt on failure (progressively removes details)")
    parser.add_argument("--no-image-diagnostic", action="store_true",
                        help="Skip image rejection diagnostic after all retries fail. "
                             "By default, when F2V mode exhausts all retries, a neutral prompt "
                             "is tested to determine if the image itself is being rejected.")

    # v2.45: Seedance resilience — auto-fallback + image analysis
    parser.add_argument("--fallback-backend", choices=["direct", "useapi"],
                        help="Auto-fallback to this backend when Seedance permanently fails "
                             "(e.g. content filter). Opt-in, not default.")
    parser.add_argument("--pre-analyze-images", action="store_true",
                        help="Analyze images with Gemini Vision before Seedance submission "
                             "to detect likely content filter triggers. Saves 30-120s per rejection.")
    parser.add_argument("--risk-threshold", choices=["low", "medium", "high"], default="high",
                        help="Risk level at which to block image submission (default: high)")

    # AI camera transitions
    parser.add_argument("--transitions",
                        help='JSON dict of scene transitions: {"1":"zoom_crash","3":"atmo_fog"}. '
                             'Appends in-camera transition prompts to scene ends.')
    parser.add_argument("--no-transitions", action="store_true",
                        help="Disable any analysis-recommended transitions")

    # Lip-sync dialogue mode (v2.32)
    parser.add_argument("--lip-sync", action="store_true",
                        help="Lip-sync mode: embed dialogue in prompts so Veo generates synced speech. "
                             "Requires --dialogue. Writes lip_sync_scenes.json for stitch auto-detection.")
    parser.add_argument("--dialogue",
                        help='JSON dict of scene dialogue: {"19":"Welcome!","20":"Goodbye!"}. '
                             'Each scene\'s prompt is wrapped with the lip-sync template.')
    parser.add_argument("--dialogue-file", type=str, default=None,
                        help="Path to JSON file with per-scene dialogue (alternative to --dialogue). "
                             'Format: {"19": "Hello!", "20": "Goodbye!"}')

    # Chained F2V generation (v2.33)
    parser.add_argument("--chained", action="store_true",
                        help="Chained F2V: generate scenes sequentially, each scene starts from "
                             "previous scene's last frame. Creates smooth transitions. "
                             "Forces --mode frames-to-video --variations 1.")
    parser.add_argument("--chain-from", type=int, default=1,
                        help="Continue chain from scene N (skip earlier scenes, use existing videos). Default: 1")
    parser.add_argument("--chain-retries", type=int, default=2,
                        help="Max retries per scene in chain mode (default: 2)")
    parser.add_argument("--chain-retry-delay", type=int, default=10,
                        help="Seconds between retries in chain mode (default: 10)")
    parser.add_argument("--journey-template",
                        help="Load F2V journey template prompts (e.g. property_tour, nature_walk). "
                             "Template prompts are used as defaults; --scenes overrides specific scenes.")
    parser.add_argument("--list-journey-templates", action="store_true",
                        help="List available F2V journey templates and exit")

    # Chained lip-sync generation (v2.39)
    parser.add_argument("--chained-lipsync", action="store_true",
                        help="Generate chained lip-sync video pairs for intro/outro. "
                             "Combines --chained with --lip-sync: generates first clip from "
                             "character image, extracts last frame, generates next clip from it. "
                             "Requires --dialogue. Forces --mode frames-to-video --variations 1.")
    parser.add_argument("--lipsync-pairs", type=str, default=None,
                        help='JSON defining lip-sync chain pairs. Format: '
                             '{"intro": ["17", "18"], "outro": ["19", "20"]}. '
                             'Scenes in each group are chained sequentially.')
    parser.add_argument("--lipsync-intro-count", type=int, default=None,
                        help="Number of chained intro lip-sync clips (e.g., 2 for ~16s). "
                             "Auto-assigns first N dialogue scenes to intro chain.")
    parser.add_argument("--lipsync-outro-count", type=int, default=None,
                        help="Number of chained outro lip-sync clips (e.g., 2 for ~16s). "
                             "Auto-assigns last M dialogue scenes to outro chain.")

    # Run isolation (new directory structure)
    parser.add_argument("--use-run-dirs", action="store_true",
                        help="Use new run subdirectory structure: runs/{run_id}/images/, videos/, final/. "
                             "Provides complete isolation between runs.")
    parser.add_argument("--legacy", action="store_true",
                        help="Use legacy flat structure: images/run001_scene_N.jpg. "
                             "Default behavior for backwards compatibility.")

    # Run versioning flags
    run_group = parser.add_mutually_exclusive_group()
    run_group.add_argument("--fresh", action="store_true",
                          help="Start fresh run (same as default - creates new run, cleans old videos)")
    run_group.add_argument("--continue", dest="continue_run", action="store_true",
                          help="Continue current run without cleaning (for partial regeneration)")
    run_group.add_argument("--resume", action="store_true",
                          help="Resume last incomplete run if one exists, otherwise start fresh")
    parser.add_argument("--image-run",
                        help="Use images from a different run prefix (e.g. --image-run run001). "
                             "Video output uses the current run, but image lookup uses this prefix.")
    parser.add_argument("--target-duration", type=int, default=None,
                        help="Target total video duration in seconds. Warns if under target after generation.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Re-initialize logger with verbose flag if requested
    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    # Default --images-dir to projects/{product}/images for image-based modes when not provided.
    # Saves the recurring "images_dir required for frames-to-video mode" footgun.
    if (
        not args.images_dir
        and args.product
        and args.mode in ("frames-to-video", "audio-lipsync", "motion-transfer")
    ):
        default_images_dir = os.path.join(args.project_base, args.product, "images")
        if os.path.isdir(default_images_dir):
            args.images_dir = default_images_dir
            logger.info("Defaulted --images-dir to %s", default_images_dir)

    # Resolve quality shortcuts (explicit --quality/--variations override)
    if args.draft:
        if args.quality == "fast" or "--quality" not in sys.argv:
            args.quality = "fast"
        if args.variations == 2 or "--variations" not in sys.argv:
            args.variations = 1
    elif args.final:
        if args.quality == "fast" or "--quality" not in sys.argv:
            args.quality = "quality"
        if args.variations == 2 or "--variations" not in sys.argv:
            args.variations = 2

    # Validate Seedance-only modes (v2.33)
    if args.mode in ("audio-lipsync", "motion-transfer") and args.backend != "seedance":
        logger.error("--mode %s requires --backend seedance", args.mode)
        sys.exit(1)

    # Validate R2V mode (v2.38)
    if args.mode == "reference-to-video":
        if args.backend == "seedance":
            logger.error("--mode reference-to-video requires --backend useapi or direct (not seedance)")
            sys.exit(1)
        if not args.reference_images:
            logger.error("--reference-images required for --mode reference-to-video")
            sys.exit(1)
        ref_paths = [p.strip() for p in args.reference_images.split(",")]
        if len(ref_paths) > 3:
            logger.error("R2V supports max 3 reference images, got %d", len(ref_paths))
            sys.exit(1)
        for p in ref_paths:
            if not os.path.exists(p):
                logger.error("Reference image not found: %s", p)
                sys.exit(1)
        if args.quality == "quality":
            logger.warning("R2V only supports fast quality (veo-3.1-fast). Overriding quality to 'fast'.")
            args.quality = "fast"
        # Store parsed paths for later use
        args._reference_image_paths = ref_paths

    if args.backend == "seedance":
        if not SEEDANCE_AVAILABLE:
            logger.error("Seedance backend not available (import failed). "
                         "Check that seedance_backend.py exists in scripts/")
            sys.exit(1)
        if not os.environ.get("SUTUI_API_KEY"):
            logger.error("SUTUI_API_KEY environment variable not set. "
                         "Get one at https://www.xskill.ai/#/v2/api-keys")
            sys.exit(1)

    # Extended ratios validation (v2.37)
    if getattr(args, "extended_ratios", False) and args.backend == "seedance":
        # Allow extended ratio values for seedance
        extended_choices = ["landscape", "portrait", "square", "ultrawide", "classic", "classic_portrait", "adaptive"]
        if args.ratio not in extended_choices:
            logger.error("Invalid ratio '%s' with --extended-ratios. Valid: %s", args.ratio, ", ".join(extended_choices))
            sys.exit(1)

    # Estimate cost and exit (v2.37)
    if getattr(args, "estimate_cost", False):
        if args.backend != "seedance":
            logger.error("--estimate-cost is only supported for --backend seedance")
            sys.exit(1)
        # Load scenes to count them
        est_scenes = {}
        if args.scenes:
            est_scenes = json.loads(args.scenes)
        elif args.config:
            with open(args.config) as f:
                est_scenes = json.load(f)
        num_scenes = max(1, len(est_scenes))
        from seedance_backend import estimate_cost as seedance_estimate_cost
        mode = args.mode or "text-to-video"
        per_scene = seedance_estimate_cost(
            mode=mode,
            duration=getattr(args, "duration", None) or 8,
            quality=args.quality,
            service_tier=getattr(args, "service_tier", "default"),
        )
        total_credits = per_scene["credits"] * num_scenes * args.variations
        total_usd = per_scene["usd"] * num_scenes * args.variations
        print(f"\n{'='*60}")
        print(f"  Seedance Cost Estimate")
        print(f"{'='*60}")
        print(f"  Mode:          {mode}")
        print(f"  Quality:       {args.quality}")
        print(f"  Service tier:  {per_scene['service_tier']}")
        print(f"  Duration:      {getattr(args, 'duration', None) or 8}s")
        print(f"  Per scene:     {per_scene['credits']} credits (${per_scene['usd']:.4f})")
        print(f"  Scenes:        {num_scenes}")
        print(f"  Variations:    {args.variations}")
        print(f"  Total:         {total_credits} credits (${total_usd:.4f})")
        print(f"{'='*60}\n")
        sys.exit(0)

    # Pre-flight balance check (v2.37)
    if getattr(args, "check_balance", False) and args.backend == "seedance" and SEEDANCE_AVAILABLE:
        est_scenes = {}
        if args.scenes:
            est_scenes = json.loads(args.scenes)
        elif args.config:
            with open(args.config) as f:
                est_scenes = json.load(f)
        num_scenes = max(1, len(est_scenes))
        from seedance_backend import estimate_cost as seedance_estimate_cost, check_balance_sufficient
        per_scene = seedance_estimate_cost(
            mode=args.mode or "text-to-video",
            duration=getattr(args, "duration", None) or 8,
            quality=args.quality,
            service_tier=getattr(args, "service_tier", "default"),
        )
        total_credits = per_scene["credits"] * num_scenes * args.variations
        sufficient, balance = check_balance_sufficient(total_credits)
        if not sufficient:
            logger.error("Insufficient Seedance balance: need %d credits, have %d. "
                         "Top up at https://www.xskill.ai", total_credits, balance)
            sys.exit(1)
        if balance >= 0:
            logger.info("[Seedance] Balance check passed: %d credits available, need %d", balance, total_credits)

    # List journey templates and exit
    if getattr(args, "list_journey_templates", False):
        try:
            from f2v_journey_templates import print_templates
            print_templates()
        except ImportError:
            logger.error("f2v_journey_templates module not found")
        sys.exit(0)

    # List prompt styles and exit (v2.36)
    if getattr(args, "list_prompt_styles", False):
        try:
            from seedance_prompt_builder import list_prompt_styles
            styles = list_prompt_styles()
            print(f"\n{'='*60}")
            print(f"  Available Prompt Styles ({len(styles)} total)")
            print(f"{'='*60}")
            for s in sorted(styles):
                print(f"  - {s}")
            print(f"\nUsage: --prompt-style <style>")
            print(f"       --prompt-style auto  (auto-detect from description)")
            print(f"{'='*60}\n")
        except ImportError:
            logger.error("seedance_prompt_builder module not found")
        sys.exit(0)

    # Check interactive mode dependencies
    if args.interactive and not INTERACTIVE_AVAILABLE:
        logger.warning("Interactive mode requested but review_state module not available")
        logger.warning("Running in non-interactive mode")
        args.interactive = False

    # Load scenes (from config, inline JSON, or journey template)
    scenes = {}

    if args.config:
        with open(args.config) as f:
            scenes = json.load(f)
    elif args.scenes:
        scenes = json.loads(args.scenes)
    elif getattr(args, "journey_template", None):
        # Load from journey template
        try:
            from f2v_journey_templates import get_template, merge_template_with_scenes
            template = get_template(args.journey_template)
            if not template:
                logger.error("Unknown journey template: %s", args.journey_template)
                logger.error("Use --list-journey-templates to see available templates")
                sys.exit(1)
            scenes = template.get_prompts_dict()
            logger.info("Loaded journey template: %s (%d scenes)", template.name, len(scenes))
        except ImportError:
            logger.error("f2v_journey_templates module not found")
            sys.exit(1)
    else:
        logger.error("Either --config, --scenes, or --journey-template must be provided")
        sys.exit(1)

    # Merge journey template with user scene overrides
    if getattr(args, "journey_template", None) and args.scenes:
        try:
            from f2v_journey_templates import get_template, merge_template_with_scenes
            template = get_template(args.journey_template)
            if template:
                user_overrides = json.loads(args.scenes)
                scenes = merge_template_with_scenes(template, user_overrides)
                logger.info("Merged %d user overrides with template", len(user_overrides))
        except (ImportError, json.JSONDecodeError):
            pass

    if not scenes:
        logger.error("No scenes to generate")
        sys.exit(1)

    # Pre-flight validation mode (--validate)
    if getattr(args, 'validate', False):
        validation = validate_preflight(
            scenes, args,
            transitions=None,  # Skip transition validation for now
            check_videos=True  # Also check for existing videos
        )

        # Get run_id for the report
        project_path = os.path.join(args.project_base, args.product)
        run_id = None
        if RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
            run_id = get_current_run_id(project_path)

        print_validation_report(validation, run_id=run_id)

        # Exit with appropriate code
        if validation["valid"]:
            sys.exit(0)
        else:
            sys.exit(1)

    # Auto-regenerate missing videos mode (--regenerate-missing)
    if getattr(args, 'regenerate_missing', False):
        validation = validate_preflight(
            scenes, args,
            transitions=None,
            check_videos=True
        )

        # Get run_id for the report
        project_path = os.path.join(args.project_base, args.product)
        run_id = None
        if RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
            run_id = get_current_run_id(project_path)

        print_validation_report(validation, run_id=run_id)

        # Filter scenes to only include missing videos
        missing_scene_nums = set(validation["videos"]["missing"])
        if not missing_scene_nums:
            logger.info("No missing videos detected. Nothing to regenerate.")
            sys.exit(0)

        # Filter scenes dict to only missing ones
        original_count = len(scenes)
        scenes = {k: v for k, v in scenes.items() if int(k) in missing_scene_nums}

        logger.info("=" * 60)
        logger.info("REGENERATE MISSING MODE")
        logger.info("=" * 60)
        logger.info("Total scenes in input: %d", original_count)
        logger.info("Missing videos: %d", len(scenes))
        logger.info("Scenes to regenerate: %s", list(scenes.keys()))
        logger.info("=" * 60)

        # Set continue_run to True since we're adding to existing run
        args.continue_run = True

    # Parse camera transitions
    transitions = {}
    if args.transitions and not args.no_transitions:
        try:
            transitions = json.loads(args.transitions)
            # Validate transition IDs
            invalid = [tid for tid in transitions.values() if tid not in CAMERA_TRANSITIONS]
            if invalid:
                logger.error("Unknown transition ID(s): %s", ', '.join(invalid))
                logger.error("Valid IDs: %s", ', '.join(sorted(CAMERA_TRANSITIONS.keys())))
                sys.exit(1)
            logger.info("Camera transitions: %d scene(s)", len(transitions))
            for scene_num, tid in sorted(transitions.items(), key=lambda x: int(x[0])):
                t = CAMERA_TRANSITIONS[tid]
                logger.info("  Scene %s: %s (%s)", scene_num, t['name'], tid)
        except json.JSONDecodeError as e:
            logger.error("Invalid --transitions JSON: %s", e)
            sys.exit(1)

    # Resolve --dialogue-file → --dialogue (v2.39)
    if getattr(args, "dialogue_file", None):
        if getattr(args, "dialogue", None):
            logger.error("Cannot use both --dialogue and --dialogue-file")
            sys.exit(1)
        dialogue_file_path = args.dialogue_file
        if not os.path.exists(dialogue_file_path):
            logger.error("--dialogue-file not found: %s", dialogue_file_path)
            sys.exit(1)
        try:
            with open(dialogue_file_path) as f:
                dialogue_from_file = json.load(f)
            if not isinstance(dialogue_from_file, dict):
                logger.error("--dialogue-file must contain a JSON object (dict), got %s",
                             type(dialogue_from_file).__name__)
                sys.exit(1)
            # Store as raw JSON string so downstream json.loads() works identically
            args.dialogue = json.dumps(dialogue_from_file)
            logger.info("Loaded dialogue from file: %s (%d scene(s))",
                        dialogue_file_path, len(dialogue_from_file))
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in --dialogue-file %s: %s", dialogue_file_path, e)
            sys.exit(1)

    # Parse dialogue map for both --lip-sync and --chained-lipsync
    dialogue_map = {}
    if getattr(args, "dialogue", None):
        try:
            dialogue_map = json.loads(args.dialogue)
        except json.JSONDecodeError as e:
            logger.error("Invalid --dialogue JSON: %s", e)
            sys.exit(1)

    # Chained lip-sync mode (v2.39) — validate + parse pairs BEFORE normal lip-sync wrapping
    _chained_lipsync_pairs = None
    if getattr(args, "chained_lipsync", False):
        if not dialogue_map:
            logger.error("--chained-lipsync requires --dialogue or --dialogue-file (JSON dict of scene dialogue)")
            sys.exit(1)

        if not args.images_dir:
            logger.error("--chained-lipsync requires --images-dir (need character start frames)")
            sys.exit(1)

        # Force constraints
        if args.mode != "frames-to-video":
            logger.warning("--chained-lipsync forces --mode frames-to-video")
            args.mode = "frames-to-video"
        if args.variations != 1:
            logger.warning("--chained-lipsync forces --variations 1")
            args.variations = 1

        # Parse lip-sync chain pairs
        try:
            _chained_lipsync_pairs = parse_lipsync_pairs(
                lipsync_pairs_json=getattr(args, "lipsync_pairs", None),
                scenes=scenes,
                dialogue_map=dialogue_map,
                intro_count=getattr(args, "lipsync_intro_count", None),
                outro_count=getattr(args, "lipsync_outro_count", None),
            )
        except (json.JSONDecodeError, ValueError) as e:
            logger.error("Invalid --lipsync-pairs: %s", e)
            sys.exit(1)

        if not _chained_lipsync_pairs:
            logger.error("No lip-sync chain pairs resolved. Check --dialogue scenes.")
            sys.exit(1)

        logger.info("Chained lip-sync pairs: %s",
                     {k: v for k, v in _chained_lipsync_pairs.items()})
        # NOTE: Actual dispatch happens later (after continue_run is resolved).
        # We do NOT apply lip-sync prompt wrapping here — generate_chained_lipsync_scenes
        # does it per-clip during chained generation.

    # Lip-sync dialogue mode (v2.32)
    lip_sync_scenes_set = set()
    if getattr(args, "lip_sync", False):
        if not dialogue_map:
            logger.error("--lip-sync requires --dialogue or --dialogue-file (JSON dict of scene dialogue)")
            sys.exit(1)

        # Import lip-sync prompt helper
        try:
            from utils_prompt import format_lipsync_prompt_from_scene
        except ImportError:
            logger.error("utils_prompt.py not found (required for --lip-sync)")
            sys.exit(1)

        # Wrap dialogue scene prompts with lip-sync template
        for scene_key, dialogue_text in dialogue_map.items():
            if scene_key in scenes:
                original_prompt = scenes[scene_key]
                scenes[scene_key] = format_lipsync_prompt_from_scene(original_prompt, dialogue_text)
                lip_sync_scenes_set.add(int(scene_key))
                logger.info("  Scene %s: lip-sync dialogue applied", scene_key)
            else:
                logger.warning("  Scene %s: not in scenes dict, skipping dialogue", scene_key)

        logger.info("Lip-sync: %d scene(s) will have embedded dialogue", len(lip_sync_scenes_set))

    # v2.40: Auto-detect image run prefix when --image-run not specified
    # Prevents "No frame image found" when images are e.g. run001 but --fresh created run006
    if (args.mode == "frames-to-video" and args.images_dir
            and not getattr(args, "image_run", None)):
        try:
            from utils_project import auto_detect_image_run
            detected = auto_detect_image_run(args.images_dir, scenes)
            if detected:
                project_path = os.path.join(args.project_base, args.product)
                current_run = None
                if RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
                    current_run = get_current_run_id(project_path)
                if current_run and detected != current_run:
                    # Count scene images for the log message
                    scene_count = 0
                    for f in os.listdir(args.images_dir):
                        if f.startswith(f"{detected}_scene_") and "_frame" in f:
                            scene_count += 1
                    logger.info("Auto-detected image run prefix: %s (%d scene image(s) found)",
                                detected, scene_count)
                    args.image_run = detected
        except ImportError:
            pass  # Skip if function not available

    # Handle --no-auto-crop flag
    auto_crop_enabled = args.auto_crop and not args.no_auto_crop

    # Auto-crop landscape images to portrait if needed
    if (auto_crop_enabled and args.ratio == "portrait" and
        args.mode == "frames-to-video" and args.images_dir):

        if not AUTO_CROP_AVAILABLE:
            logger.warning("Auto-crop requested but utils module not available")
            logger.warning("Install with: pip install Pillow")
        else:
            logger.info("=" * 60)
            logger.info("Auto-Crop: Checking images for portrait generation")
            logger.info("=" * 60)

            # Standard portrait dimensions
            PORTRAIT_WIDTH = 504
            PORTRAIT_HEIGHT = 896

            # Get current run_id for finding run-prefixed images (v2.10 fix)
            # v2.31: --image-run overrides for image lookup
            project_path = os.path.join(args.project_base, args.product)
            run_id = getattr(args, 'image_run', None)
            if not run_id and RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
                run_id = get_current_run_id(project_path)

            processed_count = 0
            for scene_num in scenes:
                frame_path = find_frame_image(args.images_dir, int(scene_num), run_id=run_id)
                if frame_path:
                    dims = get_image_dimensions(frame_path)
                    if dims:
                        w, h = dims
                        ratio_type = get_aspect_ratio_type(w, h)
                        # Check if already exact target dimensions
                        if w == PORTRAIT_WIDTH and h == PORTRAIT_HEIGHT:
                            logger.info("Scene %s: %dx%d - already 504x896, OK", scene_num, w, h)
                        else:
                            # Process ALL images to exactly 504x896
                            logger.info("Scene %s: %dx%d (%s) - converting to %dx%d...", scene_num, w, h, ratio_type, PORTRAIT_WIDTH, PORTRAIT_HEIGHT)
                            processed_path = crop_landscape_to_portrait(frame_path)
                            if processed_path:
                                processed_count += 1
                            else:
                                logger.error("Failed to process scene %s", scene_num)

            if processed_count > 0:
                logger.info("Processed %d images to %dx%d portrait", processed_count, PORTRAIT_WIDTH, PORTRAIT_HEIGHT)

            # Validate final dimensions after auto-crop (v2.10)
            dimension_warnings = []
            for scene_num in scenes:
                frame_path = find_frame_image(args.images_dir, int(scene_num), prefer_cropped=True, run_id=run_id)
                if frame_path:
                    dims = get_image_dimensions(frame_path)
                    if dims and dims != (PORTRAIT_WIDTH, PORTRAIT_HEIGHT):
                        dimension_warnings.append(f"  ⚠ Scene {scene_num}: {dims[0]}×{dims[1]} (expected {PORTRAIT_WIDTH}×{PORTRAIT_HEIGHT})")

            if dimension_warnings:
                logger.warning("Dimension Warnings:")
                for warning in dimension_warnings:
                    logger.warning("%s", warning)

            logger.info("=" * 60)

    # Auto-resize images to landscape (16:9 at 1280x720) if needed
    # v2.15: Go Bananas "16:9" outputs ultrawide (1584x672), but Veo expects 1280x720
    if (auto_crop_enabled and args.ratio == "landscape" and
        args.mode == "frames-to-video" and args.images_dir):

        if not AUTO_CROP_AVAILABLE:
            logger.warning("Auto-resize requested but utils module not available")
            logger.warning("Install with: pip install Pillow")
        else:
            logger.info("=" * 60)
            logger.info("Auto-Resize: Checking images for landscape generation (v2.15)")
            logger.info("=" * 60)

            # Get current run_id for finding run-prefixed images
            # v2.31: --image-run overrides for image lookup
            project_path = os.path.join(args.project_base, args.product)
            run_id = getattr(args, 'image_run', None)
            if not run_id and RUN_MANAGEMENT_AVAILABLE and os.path.exists(project_path):
                run_id = get_current_run_id(project_path)

            processed_count = 0
            for scene_num in scenes:
                frame_path = find_frame_image(args.images_dir, int(scene_num), run_id=run_id)
                if frame_path:
                    dims = get_image_dimensions(frame_path)
                    if dims:
                        w, h = dims
                        # Check if already exact target dimensions
                        if w == LANDSCAPE_WIDTH and h == LANDSCAPE_HEIGHT:
                            logger.info("Scene %s: %dx%d - already %dx%d, OK", scene_num, w, h, LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT)
                        else:
                            # Process to exactly 1280x720
                            logger.info("Scene %s: %dx%d - converting to %dx%d...", scene_num, w, h, LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT)
                            try:
                                processed_path = resize_to_landscape(frame_path)
                                if processed_path:
                                    processed_count += 1
                                else:
                                    logger.error("Failed to resize scene %s", scene_num)
                            except NameError:
                                logger.error("resize_to_landscape not available")

            if processed_count > 0:
                logger.info("Processed %d images to %dx%d landscape", processed_count, LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT)

            # Validate final dimensions after auto-resize
            dimension_warnings = []
            for scene_num in scenes:
                # Check for _landscape version first, then original
                frame_path = find_frame_image(args.images_dir, int(scene_num), run_id=run_id)
                if frame_path:
                    # Check if _landscape version exists
                    base, ext = os.path.splitext(frame_path)
                    landscape_path = f"{base}_landscape{ext}"
                    check_path = landscape_path if os.path.exists(landscape_path) else frame_path
                    dims = get_image_dimensions(check_path)
                    if dims and dims != (LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT):
                        dimension_warnings.append(f"  ⚠ Scene {scene_num}: {dims[0]}×{dims[1]} (expected {LANDSCAPE_WIDTH}×{LANDSCAPE_HEIGHT})")

            if dimension_warnings:
                logger.warning("Dimension Warnings:")
                for warning in dimension_warnings:
                    logger.warning("%s", warning)

            logger.info("=" * 60)

    # Pre-flight validation mode (--preflight)
    if args.preflight:
        passed = run_preflight_validation(scenes, args, transitions=transitions)
        sys.exit(0 if passed else 1)

    # Dry run mode - validate only
    if args.dry_run:
        # Telemetry: start run for dry-run (shows pending scenes in report)
        _main_telem = None
        try:
            _main_project_path = os.path.join(args.project_base, args.product)
            _main_telem = _telemetry.start_run(
                project=args.product,
                run_id="dry-run",
                backend=getattr(args, "backend", "useapi"),
                quality=getattr(args, "quality", "fast"),
                num_scenes=len(scenes),
                jsonl_dir=Path(_main_project_path) / "telemetry",
            )
        except Exception:
            pass
        passed = validate_dry_run(scenes, args, transitions=transitions)
        if _main_telem:
            try:
                _main_telem.print_report()
            except Exception:
                pass
        sys.exit(0 if passed else 1)

    # Run sequential generation
    # Default is fresh run (--fresh is the same as default, just explicit)
    # Use --continue to continue existing run without cleaning
    # Use --resume to resume last incomplete run if one exists
    continue_run = getattr(args, "continue_run", False)
    resume_run = getattr(args, "resume", False)

    # Determine if using new run directory structure
    use_run_dirs = getattr(args, "use_run_dirs", False) and not getattr(args, "legacy", False)

    # Seedance-specific kwargs (v2.33) — stored module-level for generate_scene() dispatch
    global _seedance_kwargs
    if args.backend == "seedance":
        _seedance_kwargs = {
            "duration": getattr(args, "duration", None),
            "motion_ref_path": getattr(args, "motion_ref", None),
            "camera_ref_path": getattr(args, "camera_ref", None),
            "tts_dir_lipsync": getattr(args, "tts_dir_lipsync", None),
            "dry_run": getattr(args, "dry_run", False),
            "service_tier": getattr(args, "service_tier", "default"),
            "fallback_backend": getattr(args, "fallback_backend", None),
            "pre_analyze_images": getattr(args, "pre_analyze_images", False),
            "risk_threshold": getattr(args, "risk_threshold", "high"),
        }

        # v2.43: Load storyboard panels for extra Seedance image references
        _storyboard_panels_path = getattr(args, "storyboard_panels", None)
        if _storyboard_panels_path and os.path.isfile(_storyboard_panels_path):
            try:
                with open(_storyboard_panels_path) as f:
                    _seedance_kwargs["storyboard_panels"] = json.load(f)
                logger.info("[Storyboard] Loaded panels from %s", _storyboard_panels_path)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("[Storyboard] Failed to load panels: %s — skipping", e)
        elif _storyboard_panels_path:
            logger.warning("[Storyboard] Panels file not found: %s — skipping", _storyboard_panels_path)

        # Prompt enhancement (v2.35/v2.36) — enhance all scene prompts before generation
        # Default to "auto" for seedance backend (v2.36 DB-powered) unless explicitly disabled
        prompt_style = getattr(args, "prompt_style", None)
        no_prompt_style = getattr(args, "no_prompt_style", False)
        if prompt_style is None and not no_prompt_style and not getattr(args, "prompt_enhance", False):
            prompt_style = "auto"  # Auto-enhance by default for seedance
        is_f2v_loop = getattr(args, "f2v_loop", False)
        if prompt_style:
            # v2.36 DB-powered enhancement (overrides --prompt-enhance)
            from seedance_prompt_builder import build_enhanced_prompt
            duration = getattr(args, "duration", None) or 8
            style_arg = None if prompt_style == "auto" else prompt_style
            for scene_num, prompt in scenes.items():
                enhanced = build_enhanced_prompt(
                    description=prompt,
                    duration=duration,
                    prompt_style=style_arg,
                    f2v_loop=is_f2v_loop,
                )
                logger.info("[PromptDB] scene %s: %s... → %s...",
                            scene_num, prompt[:40], enhanced[:60])
                scenes[scene_num] = enhanced
        elif getattr(args, "prompt_enhance", False):
            from seedance_prompt_builder import build_cinematic_prompt
            genre = getattr(args, "genre", "cinematic")
            duration = getattr(args, "duration", None) or 8
            for scene_num, prompt in scenes.items():
                enhanced = build_cinematic_prompt(
                    description=prompt,
                    duration=duration,
                    genre=genre,
                    f2v_loop=is_f2v_loop,
                )
                logger.info("[Enhance] scene %s: %s... → %s...",
                            scene_num, prompt[:40], enhanced[:60])
                scenes[scene_num] = enhanced

        # v2.43: Camera Variety Block — append standardized camera shot block to all Seedance prompts
        if getattr(args, "camera_variety", False):
            try:
                from config import CAMERA_VARIETY_BLOCK
            except ImportError:
                CAMERA_VARIETY_BLOCK = (
                    "a lot of camera shots: Extreme wide shot, wide shot, medium shot, "
                    "medium close-up, close-up, extreme close-up, over-the-shoulder, "
                    "point-of-view, insert shot, two-shot, tracking shot, push-in, "
                    "pull-back, crane shot, arc shot, high angle, low angle, "
                    "Dutch angle, and top-down bird's-eye shot."
                )
            for scene_num in scenes:
                scenes[scene_num] = scenes[scene_num] + "\n\n" + CAMERA_VARIETY_BLOCK
                logger.info("[Camera Variety] Appended camera shot block to scene %s", scene_num)

    # v2.43: Style Consistency Pre-Flight — detect mixed visual styles across frame images
    if (getattr(args, "check_style_consistency", False)
            and args.backend == "seedance"
            and args.images_dir
            and args.mode in ("frames-to-video", "audio-lipsync", "motion-transfer")):
        _run_style_consistency_check(
            scenes=scenes,
            images_dir=args.images_dir,
            fail_on_mismatch=getattr(args, "style_consistency_fail", False),
        )

    # v2.43: 4K Upscale Pre-Flight — upscale frame images before Seedance submission
    if (getattr(args, "upscale_4k", False)
            and args.backend == "seedance"
            and args.images_dir
            and args.mode in ("frames-to-video", "audio-lipsync", "motion-transfer")):
        upscale_prompt = getattr(args, "upscale_4k_prompt", None)
        try:
            from config import UPSCALE_4K_DEFAULT_PROMPT
        except ImportError:
            UPSCALE_4K_DEFAULT_PROMPT = "upscale image, high detail, 4K, preserve all details, cinematic quality"
        if not upscale_prompt:
            upscale_prompt = UPSCALE_4K_DEFAULT_PROMPT
        _run_4k_upscale_preflight(
            scenes=scenes,
            images_dir=args.images_dir,
            upscale_prompt=upscale_prompt,
            run_id=None,  # Will be set after run versioning
            image_run_id=getattr(args, "image_run", None),
            ratio=args.ratio,
            variations=args.variations,
        )

    # Chained lip-sync dispatch (v2.39) — runs after continue_run and _seedance_kwargs are set
    if _chained_lipsync_pairs is not None:
        project_dir = os.path.join(args.project_base, args.product)
        run_id = None
        effective_videos_dir = os.path.join(project_dir, "videos")

        if RUN_MANAGEMENT_AVAILABLE:
            if continue_run:
                run_id = get_current_run_id(project_dir)
                logger.info("Continuing %s for chained lip-sync...", run_id)
            else:
                run_metadata = {
                    "scenes": sorted(set(s for chain in _chained_lipsync_pairs.values() for s in chain)),
                    "mode": "frames-to-video",
                    "quality": args.quality,
                    "ratio": args.ratio,
                    "backend": args.backend,
                    "variations": 1,
                    "chained_lipsync": True,
                    "lipsync_pairs": _chained_lipsync_pairs,
                }
                run_id = increment_run(project_dir, run_metadata)
                logger.info("Starting fresh %s for chained lip-sync...", run_id)

        results = generate_chained_lipsync_scenes(
            scenes=scenes,
            dialogue_map=dialogue_map,
            lipsync_pairs=_chained_lipsync_pairs,
            product_name=args.product,
            veo_path=args.veo_path,
            project_base=args.project_base,
            images_dir=args.images_dir,
            quality=args.quality,
            ratio=args.ratio,
            backend=args.backend,
            run_id=run_id,
            videos_dir=effective_videos_dir,
            project_path=project_dir,
            allow_stale=args.allow_stale,
            chain_retries=getattr(args, "chain_retries", 2),
            chain_retry_delay=getattr(args, "chain_retry_delay", 10),
            image_run_id=getattr(args, "image_run", None),
            progress_file=getattr(args, "progress", None),
        )

        # Write lip_sync_scenes.json
        successful = [r for r in results if r.get("success")]
        if successful:
            all_lipsync_scenes = sorted(set(
                int(s) for chain in _chained_lipsync_pairs.values() for s in chain
            ))
            lip_sync_metadata = {
                "scenes": all_lipsync_scenes,
                "tts_dir": None,
                "lipsync_pairs": {k: [int(s) for s in v] for k, v in _chained_lipsync_pairs.items()},
                "_description": "Scenes with chained Veo lip-synced dialogue. "
                                "stitch_video.py auto-detects this file to keep Veo audio for these scenes.",
            }
            lip_sync_path = os.path.join(effective_videos_dir, "lip_sync_scenes.json")
            os.makedirs(effective_videos_dir, exist_ok=True)
            with open(lip_sync_path, "w") as f:
                json.dump(lip_sync_metadata, f, indent=2)
            logger.info("Lip-sync metadata written: %s", lip_sync_path)

        # Update run status
        if RUN_MANAGEMENT_AVAILABLE and run_id:
            status = "completed" if all(r.get("success") for r in results) else "partial"
            update_run_status(project_dir, run_id, status, {
                "scenes_completed": len([r for r in results if r.get("success")]),
                "scenes_failed": len([r for r in results if not r.get("success")]),
                "chained_lipsync": True,
            })

        if any(not r.get("success") for r in results):
            sys.exit(1)
        sys.exit(0)

    # Chained F2V mode (v2.33)
    if getattr(args, "chained", False):
        # Validate constraints
        if args.mode != "frames-to-video":
            logger.warning("--chained forces --mode frames-to-video")
            args.mode = "frames-to-video"
        if args.variations != 1:
            logger.warning("--chained forces --variations 1 (can't chain with multiple variations)")
            args.variations = 1
        if getattr(args, "parallel", 1) > 1:
            logger.warning("--chained disables --parallel (must be sequential)")
        if not args.images_dir:
            logger.error("--chained requires --images-dir (need start frames for first scene)")
            sys.exit(1)

        # Set up run versioning
        project_dir = os.path.join(args.project_base, args.product)
        run_id = None
        effective_videos_dir = os.path.join(project_dir, "videos")

        if RUN_MANAGEMENT_AVAILABLE:
            if continue_run or getattr(args, "chain_from", 1) > 1:
                run_id = get_current_run_id(project_dir)
                logger.info("Continuing %s for chained generation...", run_id)
            else:
                run_metadata = {
                    "scenes": list(scenes.keys()),
                    "mode": "frames-to-video",
                    "quality": args.quality,
                    "ratio": args.ratio,
                    "backend": args.backend,
                    "variations": 1,
                    "chained": True,
                }
                run_id = increment_run(project_dir, run_metadata)
                logger.info("Starting fresh %s for chained generation...", run_id)

        results = generate_chained_scenes(
            scenes=scenes,
            product_name=args.product,
            veo_path=args.veo_path,
            project_base=args.project_base,
            images_dir=args.images_dir,
            quality=args.quality,
            ratio=args.ratio,
            backend=args.backend,
            run_id=run_id,
            videos_dir=effective_videos_dir,
            project_path=project_dir,
            allow_stale=args.allow_stale,
            chain_from=getattr(args, "chain_from", 1),
            chain_retries=getattr(args, "chain_retries", 2),
            chain_retry_delay=getattr(args, "chain_retry_delay", 10),
            image_run_id=getattr(args, "image_run", None),
            progress_file=getattr(args, "progress", None),
        )

        # Update run status
        if RUN_MANAGEMENT_AVAILABLE and run_id:
            status = "completed" if all(r.get("success") for r in results) else "partial"
            update_run_status(project_dir, run_id, status, {
                "scenes_completed": len([r for r in results if r.get("success")]),
                "scenes_failed": len([r for r in results if not r.get("success")]),
                "chained": True,
            })

        # Exit with error if any failed
        if any(not r.get("success") for r in results):
            sys.exit(1)
        sys.exit(0)

    results = run_sequential_generation(
        scenes=scenes,
        product_name=args.product,
        veo_path=args.veo_path,
        project_base=args.project_base,
        mode=args.mode,
        images_dir=args.images_dir,
        quality=args.quality,
        ratio=args.ratio,
        interactive=args.interactive,
        agent_assisted=args.agent_assisted,
        auto_fix_ratio=args.auto_fix_ratio,
        backend=args.backend,
        continue_run=continue_run,
        resume_run=resume_run,
        variations=args.variations,
        strict=args.strict,
        use_run_dirs=use_run_dirs,
        allow_stale=args.allow_stale,
        transitions=transitions,
        f2v_loop=getattr(args, 'f2v_loop', False),
        progress_file=getattr(args, 'progress', None),
        parallel=min(getattr(args, 'parallel', 1), 5),
        fallback_quality=getattr(args, 'fallback_quality', False),
        auto_simplify=getattr(args, 'auto_simplify', False),
        image_run_id=getattr(args, 'image_run', None),
        target_duration=getattr(args, 'target_duration', None),
        reference_images=getattr(args, '_reference_image_paths', None),
        no_image_diagnostic=getattr(args, 'no_image_diagnostic', False),
    )

    # Write lip_sync_scenes.json metadata if lip-sync mode was used
    if lip_sync_scenes_set:
        successful = [r for r in results if r.get("success")]
        if successful:
            # Determine videos directory
            project_dir = os.path.join(args.project_base, args.product)
            videos_dir = os.path.join(project_dir, "videos")
            lip_sync_metadata = {
                "scenes": sorted(lip_sync_scenes_set),
                "tts_dir": None,  # Set by user when TTS is generated
                "_description": "Scenes with Veo lip-synced dialogue. "
                                "stitch_video.py auto-detects this file to keep Veo audio for these scenes.",
            }
            lip_sync_path = os.path.join(videos_dir, "lip_sync_scenes.json")
            os.makedirs(videos_dir, exist_ok=True)
            with open(lip_sync_path, "w") as f:
                json.dump(lip_sync_metadata, f, indent=2)
            logger.info("Lip-sync metadata written: %s", lip_sync_path)

    # Exit with error if any failed
    if any(not r.get("success") for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
