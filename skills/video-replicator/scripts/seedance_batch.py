#!/usr/bin/env python3
"""
Seedance 2.0 batch orchestrator.

Reads a queue JSON file, dispatches scenes to the Seedance API, polls
concurrently, downloads videos, and checkpoints progress.  Reuses existing
primitives from seedance_backend.py — no API code duplication.

Queue JSON format:
{
  "projects": {
    "my-project": {
      "aspect_ratio": "16:9",
      "scenes": [
        {
          "scene_number": 1,
          "seedance_prompt": "@image1 Camera push in...",
          "seedance_duration": 8,
          "image_url": "https://...",
          "status": "pending",       // pending | submitted | completed | failed
          "task_id": null,
          "video_path": null,
          "error": null
        }
      ]
    }
  }
}

Usage:
    python seedance_batch.py --queue queue.json --all                    # All pending
    python seedance_batch.py --queue queue.json --project jack-street    # One project
    python seedance_batch.py --queue queue.json --project jack --scene 3 # One scene
    python seedance_batch.py --queue queue.json --all --dry-run          # Preview only
    python seedance_batch.py --queue queue.json --all --submit-only      # Submit, don't poll
    python seedance_batch.py --queue queue.json --all --retry-failed     # Retry failures
    python seedance_batch.py --queue queue.json --status                 # Status report
    python seedance_batch.py --queue queue.json --all --concurrent 5     # Concurrent polling
"""

import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import (
    SEEDANCE_BATCH_CHECKPOINT_INTERVAL,
    SEEDANCE_BATCH_MAX_WORKERS,
    SEEDANCE_BATCH_POLL_TIMEOUT,
    SEEDANCE_BATCH_SUBMIT_DELAY,
    SEEDANCE_RATIO_MAP,
)
from exceptions import SeedanceError
from logging_config import setup_logging
from seedance_backend import (
    _create_task,
    _download_video,
    _extract_video_url,
    _poll_task,
)
import telemetry as _telemetry
from utils_upload import ensure_urls

logger = setup_logging(__name__)


# ============================================================================
# Veo Fallback Helper (v2.45 — mixed-backend queue)
# ============================================================================

def _run_veo_fallback(
    scene: dict,
    proj_name: str,
    project_data: dict,
    base_path: str,
    quality: str,
    aspect_ratio: str,
) -> dict | None:
    """Attempt to generate a scene via Veo/useapi as a fallback (v2.45).

    Strips Seedance @imageN/@videoN/@audioN references from the prompt since
    Veo uses a different format. Uses parallel_video_gen.generate_scene() which
    handles both direct and useapi backends.

    Args:
        scene: Scene data dict from queue
        proj_name: Project name
        project_data: Project-level data
        base_path: Base projects directory
        quality: Quality level ("fast" or "quality")
        aspect_ratio: Aspect ratio string (e.g. "16:9")

    Returns:
        Result dict from generate_scene() if successful, None on failure
    """
    import re as _re

    try:
        from parallel_video_gen import generate_scene
    except ImportError:
        logger.warning("  Cannot import parallel_video_gen for Veo fallback")
        return None

    fb_backend = scene.get("fallback_backend", "useapi")
    prompt = scene.get("seedance_prompt", "")
    scene_num = scene.get("scene_number", 0)

    # Strip Seedance-specific @refs
    fb_prompt = _re.sub(r"@(?:image|video|audio)(?:_file)?_?\d+", "", prompt)
    fb_prompt = _re.sub(r"\s{2,}", " ", fb_prompt).strip()

    if not fb_prompt:
        logger.warning("  Fallback prompt is empty after stripping refs — skipping")
        return None

    logger.info("  Attempting Veo fallback via %s backend...", fb_backend)

    # Record telemetry
    if trun := _telemetry.get_current_run():
        trun.record_backend_fallback(scene_num, "seedance", fb_backend,
                                     reason=scene.get("error", "")[:120])

    # Determine mode — image_url presence means I2V, else T2V
    image_url = scene.get("image_url", "")
    mode = "frames-to-video" if image_url else "text-to-video"

    # Determine ratio key from aspect_ratio
    ratio = "landscape"
    if aspect_ratio in ("9:16",):
        ratio = "portrait"
    elif aspect_ratio in ("1:1",):
        ratio = "square"
    elif aspect_ratio in SEEDANCE_RATIO_MAP:
        ratio = aspect_ratio

    # Build output path
    dir_name = proj_name
    if project_data.get("directory"):
        dir_name = project_data["directory"]
    vid_dir = os.path.join(base_path, dir_name, "videos", "seedance")
    os.makedirs(vid_dir, exist_ok=True)

    # Resolve images_dir for I2V
    images_dir = None
    if mode == "frames-to-video" and image_url and os.path.isfile(image_url):
        images_dir = os.path.dirname(image_url)

    # veo_path is the veo-cli directory
    veo_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ))), "veo-cli")

    result = generate_scene(
        scene_number=scene_num,
        prompt=fb_prompt,
        product_name=proj_name,
        veo_path=veo_path,
        project_base=base_path,
        mode=mode,
        images_dir=images_dir,
        quality=quality,
        ratio=ratio,
        backend=fb_backend,
        videos_dir=vid_dir,
        variations=1,
        # PR #27: thread omni-flash voice + ref_video kwargs through
        # so scene specs constructed in Python can activate voice
        # narration and V2V edit without bypassing the orchestrator.
        voice=scene.get("voice"),
        ref_video=scene.get("ref_video"),
    )

    return result if result.get("success") else None


# ============================================================================
# Queue I/O
# ============================================================================

def load_queue(path: str) -> dict:
    """Load queue JSON, validate structure.

    Supports two formats:
    - Dict format: {"projects": {"name": {"scenes": [...]}}}
    - List format: {"projects": [{"slug": "name", "scenes": [...]}]}

    The list format is auto-normalized to dict format for uniform processing.

    Args:
        path: Path to queue JSON file

    Returns:
        Parsed queue dict with "projects" as a dict keyed by project name

    Raises:
        FileNotFoundError: If queue file doesn't exist
        ValueError: If JSON is invalid or missing required structure
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Queue file not found: {path}")

    with open(path) as f:
        queue = json.load(f)

    if "projects" not in queue:
        raise ValueError("Queue JSON must have a 'projects' key")

    # Normalize list format → dict format
    if isinstance(queue["projects"], list):
        projects_dict = {}
        for proj in queue["projects"]:
            name = proj.get("slug") or proj.get("directory") or proj.get("name", "unknown")
            projects_dict[name] = proj
        queue["projects"] = projects_dict
        queue["_was_list"] = True  # Track for save_queue to restore format

    for proj_name, proj_data in queue["projects"].items():
        if "scenes" not in proj_data:
            raise ValueError(f"Project '{proj_name}' missing 'scenes' array")

    return queue


def save_queue(path: str, queue: dict) -> None:
    """Atomic write — write to temp file then rename.

    If the queue was originally in list format, restores it before saving.

    Args:
        path: Target path for queue JSON
        queue: Queue dict to save
    """
    # Restore list format if that's what was loaded
    save_data = dict(queue)
    if save_data.pop("_was_list", False):
        save_data["projects"] = list(save_data["projects"].values())

    dir_name = os.path.dirname(os.path.abspath(path))
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(save_data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except Exception:
        # Clean up temp file on failure
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


# ============================================================================
# Work item collection
# ============================================================================

def collect_pending(
    queue: dict,
    project: str | None = None,
    scene: int | None = None,
    retry_failed: bool = False,
) -> list[dict]:
    """Filter scenes needing work.

    Args:
        queue: Loaded queue dict
        project: Filter to specific project (substring match)
        scene: Filter to specific scene number
        retry_failed: If True, also include scenes with status "failed"

    Returns:
        List of work item dicts: {project_name, project_data, scene_data, scene_idx}
    """
    target_statuses = {"pending"}
    if retry_failed:
        target_statuses.add("failed")

    work_items = []
    for proj_name, proj_data in queue["projects"].items():
        # Filter by project name (substring match)
        if project and project.lower() not in proj_name.lower():
            continue

        for idx, scene_data in enumerate(proj_data["scenes"]):
            status = scene_data.get("status", "pending")

            # Filter by scene number
            if scene is not None and scene_data.get("scene_number") != scene:
                continue

            if status in target_statuses:
                work_items.append({
                    "project_name": proj_name,
                    "project_data": proj_data,
                    "scene_data": scene_data,
                    "scene_idx": idx,
                })

    return work_items


# ============================================================================
# Output path builder
# ============================================================================

def build_output_path(project_name: str, scene_number: int, base_path: str,
                      project_data: dict | None = None) -> str:
    """Build output video path: {base_path}/{dir}/videos/seedance/scene_N.mp4

    Uses the project's "directory" field if available (e.g., "2026-02-06_004_jack"),
    falling back to project_name.

    Args:
        project_name: Project slug or name
        scene_number: Scene number
        base_path: Base projects directory
        project_data: Optional project data dict with "directory" field

    Returns:
        Full output file path
    """
    dir_name = project_name
    if project_data and project_data.get("directory"):
        dir_name = project_data["directory"]
    return os.path.join(
        base_path, dir_name, "videos", "seedance", f"scene_{scene_number}.mp4"
    )


# ============================================================================
# Sequential processing (default mode)
# ============================================================================

def process_sequential(
    work_items: list[dict],
    queue: dict,
    queue_path: str,
    base_path: str,
    quality: str = "fast",
    dry_run: bool = False,
) -> dict:
    """Submit, poll, and download scenes one by one.

    Args:
        work_items: List of work items from collect_pending()
        queue: Queue dict (mutated in place for checkpointing)
        queue_path: Path to save queue checkpoints
        base_path: Base projects directory
        quality: "fast" or "quality"
        dry_run: Preview without API calls

    Returns:
        Summary dict with counts: {submitted, completed, failed, skipped}
    """
    summary = {"submitted": 0, "completed": 0, "failed": 0, "skipped": 0}

    for i, item in enumerate(work_items, 1):
        proj_name = item["project_name"]
        scene = item["scene_data"]
        scene_num = scene.get("scene_number", "?")
        prompt = scene.get("seedance_prompt", "")
        image_url = scene.get("image_url", "")
        duration = scene.get("seedance_duration", 8)
        aspect_ratio = item["project_data"].get("aspect_ratio", "16:9")

        logger.info("[%d/%d] %s scene %s", i, len(work_items), proj_name, scene_num)

        if dry_run:
            logger.info("  DRY RUN — prompt: %s", prompt[:80])
            logger.info("  DRY RUN — image_url: %s", (image_url or "(none)")[:80])
            logger.info("  DRY RUN — duration: %ds, ratio: %s", duration, aspect_ratio)
            summary["skipped"] += 1
            continue

        if not prompt:
            logger.warning("  SKIP — no seedance_prompt")
            summary["skipped"] += 1
            continue

        media_files = []
        if image_url and "@image1" in prompt:
            # Rehost if on a domain inaccessible from Seedance (R2, catbox)
            media_files = ensure_urls([image_url], rehost_risky=True)

        try:
            # Submit
            task_id = _create_task(
                prompt=prompt,
                media_files=media_files,
                quality=quality,
                ratio=_ratio_key(aspect_ratio),
                duration=duration,
            )
            scene["task_id"] = task_id
            scene["status"] = "submitted"
            summary["submitted"] += 1

            # Poll
            task_result = _poll_task(task_id)
            video_url = _extract_video_url(task_result)

            # Download
            output_path = build_output_path(proj_name, scene_num, base_path, item["project_data"])
            _download_video(video_url, output_path)

            scene["status"] = "completed"
            scene["video_path"] = output_path
            scene["error"] = None
            summary["completed"] += 1
            logger.info("  DONE — %s", output_path)

        except (SeedanceError, TimeoutError) as e:
            scene["status"] = "failed"
            scene["error"] = str(e)
            summary["failed"] += 1
            logger.error("  FAILED — %s", e)

        except Exception as e:
            scene["status"] = "failed"
            scene["error"] = f"Unexpected: {e}"
            summary["failed"] += 1
            logger.error("  ERROR — %s", e)

        # v2.45: Auto-fallback to alternative backend on failure
        if scene.get("status") == "failed" and scene.get("fallback_backend"):
            fb_result = _run_veo_fallback(
                scene, proj_name, item["project_data"], base_path,
                quality, aspect_ratio,
            )
            if fb_result:
                output_path = (fb_result.get("videos") or [""])[0]
                scene["status"] = "completed"
                scene["video_path"] = output_path
                scene["error"] = None
                scene["backend_used"] = scene["fallback_backend"]
                summary["failed"] -= 1
                summary["completed"] += 1
                logger.info("  FALLBACK OK — %s via %s", output_path, scene["fallback_backend"])
            else:
                scene["backend_used"] = "seedance"
                logger.warning("  Fallback to %s also failed", scene["fallback_backend"])

        # Record backend used for audit trail
        if "backend_used" not in scene and scene.get("status") == "completed":
            scene["backend_used"] = scene.get("preferred_backend", "seedance")

        # Checkpoint after each scene
        save_queue(queue_path, queue)

        # Delay between submissions
        if i < len(work_items):
            time.sleep(SEEDANCE_BATCH_SUBMIT_DELAY)

    return summary


# ============================================================================
# Two-phase: submit all, then poll concurrently
# ============================================================================

def submit_all(
    work_items: list[dict],
    queue: dict,
    queue_path: str,
    quality: str = "fast",
) -> dict:
    """Phase 1: submit all tasks, return {item_index: task_id} map.

    Args:
        work_items: List of work items
        queue: Queue dict for checkpointing
        queue_path: Path to save checkpoints
        quality: "fast" or "quality"

    Returns:
        Dict mapping work_item index to task_id
    """
    task_map = {}

    for i, item in enumerate(work_items):
        proj_name = item["project_name"]
        scene = item["scene_data"]
        scene_num = scene.get("scene_number", "?")
        prompt = scene.get("seedance_prompt", "")
        image_url = scene.get("image_url", "")
        duration = scene.get("seedance_duration", 8)
        aspect_ratio = item["project_data"].get("aspect_ratio", "16:9")

        if not prompt:
            logger.warning("[Submit %d] %s scene %s — SKIP (no prompt)", i + 1, proj_name, scene_num)
            continue

        media_files = []
        if image_url and "@image1" in prompt:
            # Rehost if on a domain inaccessible from Seedance (R2, catbox)
            media_files = ensure_urls([image_url], rehost_risky=True)

        try:
            task_id = _create_task(
                prompt=prompt,
                media_files=media_files,
                quality=quality,
                ratio=_ratio_key(aspect_ratio),
                duration=duration,
            )
            scene["task_id"] = task_id
            scene["status"] = "submitted"
            task_map[i] = task_id
            logger.info("[Submit %d/%d] %s scene %s → %s",
                       i + 1, len(work_items), proj_name, scene_num, task_id)

        except (SeedanceError, TimeoutError) as e:
            scene["status"] = "failed"
            scene["error"] = str(e)
            logger.error("[Submit %d] %s scene %s — FAILED: %s",
                        i + 1, proj_name, scene_num, e)
        except Exception as e:
            scene["status"] = "failed"
            scene["error"] = f"Unexpected: {e}"
            logger.error("[Submit %d] %s scene %s — ERROR: %s",
                        i + 1, proj_name, scene_num, e)

        # Checkpoint
        save_queue(queue_path, queue)

        # Small delay to avoid rate limits
        time.sleep(SEEDANCE_BATCH_SUBMIT_DELAY)

    logger.info("Submitted %d / %d tasks", len(task_map), len(work_items))
    return task_map


def poll_concurrent(
    task_map: dict,
    work_items: list[dict],
    queue: dict,
    queue_path: str,
    base_path: str,
    max_workers: int = SEEDANCE_BATCH_MAX_WORKERS,
) -> dict:
    """Phase 2: poll all submitted tasks concurrently.

    Args:
        task_map: Dict of {item_index: task_id} from submit_all()
        work_items: Original work items list
        queue: Queue dict for checkpointing
        queue_path: Path to save checkpoints
        base_path: Base projects directory
        max_workers: Max concurrent polling threads

    Returns:
        Summary dict with counts
    """
    summary = {"completed": 0, "failed": 0}
    completed_count = 0

    def _poll_and_download(item_idx: int, task_id: str) -> tuple[int, bool, str]:
        """Poll a single task and download the result. Returns (idx, success, msg)."""
        item = work_items[item_idx]
        proj_name = item["project_name"]
        scene = item["scene_data"]
        scene_num = scene.get("scene_number", "?")

        try:
            task_result = _poll_task(task_id)
            video_url = _extract_video_url(task_result)
            output_path = build_output_path(proj_name, scene_num, base_path, item["project_data"])
            _download_video(video_url, output_path)
            return item_idx, True, output_path
        except (SeedanceError, TimeoutError) as e:
            return item_idx, False, str(e)
        except Exception as e:
            return item_idx, False, f"Unexpected: {e}"

    workers = min(max_workers, len(task_map))
    logger.info("Polling %d tasks with %d workers...", len(task_map), workers)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_poll_and_download, idx, tid): idx
            for idx, tid in task_map.items()
        }

        for future in as_completed(futures):
            item_idx, success, msg = future.result()
            item = work_items[item_idx]
            scene = item["scene_data"]
            proj_name = item["project_name"]
            scene_num = scene.get("scene_number", "?")

            if success:
                scene["status"] = "completed"
                scene["video_path"] = msg
                scene["error"] = None
                summary["completed"] += 1
                logger.info("[Done] %s scene %s → %s", proj_name, scene_num, msg)
            else:
                scene["status"] = "failed"
                scene["error"] = msg
                summary["failed"] += 1
                logger.error("[Fail] %s scene %s — %s", proj_name, scene_num, msg)

            # Checkpoint
            completed_count += 1
            if completed_count % SEEDANCE_BATCH_CHECKPOINT_INTERVAL == 0:
                save_queue(queue_path, queue)

    # Final checkpoint
    save_queue(queue_path, queue)
    return summary


# ============================================================================
# Status report
# ============================================================================

def print_status(queue: dict) -> None:
    """Print summary table of all projects and scenes.

    Args:
        queue: Loaded queue dict
    """
    totals = {"pending": 0, "submitted": 0, "completed": 0, "failed": 0}

    print(f"\n{'Project':<30} {'Pend':>5} {'Sub':>5} {'Done':>5} {'Fail':>5} {'Total':>6}")
    print("-" * 82)

    for proj_name, proj_data in sorted(queue["projects"].items()):
        counts = {"pending": 0, "submitted": 0, "completed": 0, "failed": 0}
        for scene in proj_data["scenes"]:
            status = scene.get("status", "pending")
            if status in counts:
                counts[status] += 1
            else:
                counts["pending"] += 1

        total = sum(counts.values())
        print(f"{proj_name:<30} {counts['pending']:>5} {counts['submitted']:>5} "
              f"{counts['completed']:>5} {counts['failed']:>5} {total:>6}")

        for k in totals:
            totals[k] += counts[k]

    grand_total = sum(totals.values())
    print("-" * 82)
    print(f"{'TOTAL':<30} {totals['pending']:>5} {totals['submitted']:>5} "
          f"{totals['completed']:>5} {totals['failed']:>5} {grand_total:>6}")
    print()


# ============================================================================
# Prompt Enhancement (v2.35)
# ============================================================================

def enhance_queue_prompts(
    work_items: list[dict],
    queue: dict,
    queue_path: str,
    genre: str = "cinematic",
) -> int:
    """Enhance seedance_prompt for each work item using the cinematic prompt engine.

    Original prompts are preserved as seedance_prompt_original.

    Args:
        work_items: Work items from collect_pending()
        queue: Queue dict (mutated in place)
        queue_path: Path to save queue checkpoint
        genre: Style genre for enhancement

    Returns:
        Number of prompts enhanced
    """
    from seedance_prompt_builder import build_cinematic_prompt

    enhanced_count = 0
    for item in work_items:
        scene = item["scene_data"]
        raw_prompt = scene.get("seedance_prompt", "")
        if not raw_prompt:
            continue

        # Skip already-enhanced prompts (idempotent)
        if scene.get("seedance_prompt_original"):
            continue

        duration = scene.get("seedance_duration", 8)

        # Strip @image1 prefix for enhancement, re-add after
        has_image_ref = raw_prompt.startswith("@image1 ")
        clean_prompt = raw_prompt[len("@image1 "):] if has_image_ref else raw_prompt

        enhanced = build_cinematic_prompt(
            description=clean_prompt,
            duration=duration,
            genre=genre,
        )

        # Re-add @image1 prefix if it was present
        if has_image_ref:
            enhanced = f"@image1 {enhanced}"

        scene["seedance_prompt_original"] = raw_prompt
        scene["seedance_prompt"] = enhanced
        enhanced_count += 1

        logger.info("[Enhance] scene %s: %s... → %s...",
                    scene.get("scene_number", "?"),
                    raw_prompt[:40], enhanced[:60])

    if enhanced_count:
        save_queue(queue_path, queue)
        logger.info("Enhanced %d prompt(s) with genre=%s", enhanced_count, genre)

    return enhanced_count


# ============================================================================
# Queue Generation (from parallel_video_gen-style inputs)
# ============================================================================

def generate_queue(
    project: str,
    scenes: dict[str, str],
    output_path: str,
    images_dir: str | None = None,
    ratio: str = "landscape",
    duration: int = 8,
    mode: str = "frames-to-video",
    tts_dir: str | None = None,
    run_id: str | None = None,
    quality: str = "fast",
) -> dict:
    """Create a queue JSON file from parallel_video_gen-style inputs.

    Converts a scenes dict (scene_number → prompt) and optional images
    directory into the queue format that seedance_batch.py expects.

    Args:
        project: Project slug (e.g. "my-project")
        scenes: Dict of scene_number (str) → prompt text
        output_path: Where to write the queue JSON
        images_dir: Directory containing scene images (for F2V / audio-lipsync)
        ratio: Aspect ratio — "landscape", "portrait", or "square"
        duration: Video duration in seconds (4-15)
        mode: Generation mode — "text-to-video", "frames-to-video", "audio-lipsync"
        tts_dir: TTS audio directory (for audio-lipsync mode)
        run_id: Optional run ID for image lookup (e.g. "run001")
        quality: "fast" or "quality"

    Returns:
        The generated queue dict

    Raises:
        FileNotFoundError: If images_dir doesn't exist (when mode needs images)
        ValueError: If scenes dict is empty
    """
    if not scenes:
        raise ValueError("scenes dict must not be empty")

    needs_images = mode in ("frames-to-video", "audio-lipsync")
    if needs_images and images_dir and not os.path.exists(images_dir):
        raise FileNotFoundError(f"Images directory not found: {images_dir}")

    # Map ratio name to aspect_ratio string
    aspect_ratio = SEEDANCE_RATIO_MAP.get(ratio, ratio)

    queue_scenes = []
    for scene_num_str, prompt in sorted(scenes.items(), key=lambda x: int(x[0])):
        scene_num = int(scene_num_str)
        scene_entry = {
            "scene_number": scene_num,
            "seedance_prompt": prompt,
            "seedance_duration": duration,
            "image_url": "",
            "audio_url": "",
            "preferred_backend": "seedance",
            "fallback_backend": None,
            "status": "pending",
            "task_id": None,
            "video_path": None,
            "backend_used": None,
            "error": None,
        }

        # Find and attach image URL for F2V / audio-lipsync modes
        if needs_images and images_dir:
            image_path = _find_scene_image(images_dir, scene_num, ratio, run_id)
            if image_path:
                scene_entry["image_url"] = image_path
                # Prepend @image1 to prompt if not already present
                if not prompt.startswith("@image1 "):
                    scene_entry["seedance_prompt"] = f"@image1 {prompt}"
            else:
                logger.warning("Scene %d: no image found in %s", scene_num, images_dir)

        # Find and attach TTS audio for audio-lipsync mode
        if mode == "audio-lipsync" and tts_dir:
            audio_path = _find_tts_audio(tts_dir, scene_num)
            if audio_path:
                scene_entry["audio_url"] = audio_path
            else:
                logger.warning("Scene %d: no TTS audio found in %s", scene_num, tts_dir)

        queue_scenes.append(scene_entry)

    queue = {
        "projects": {
            project: {
                "aspect_ratio": aspect_ratio,
                "quality": quality,
                "mode": mode,
                "scenes": queue_scenes,
            }
        }
    }

    # Ensure output directory exists
    out_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(out_dir, exist_ok=True)

    save_queue(output_path, queue)
    logger.info("Queue generated: %d scenes → %s", len(queue_scenes), output_path)
    return queue


def _find_scene_image(
    images_dir: str,
    scene_number: int,
    ratio: str = "landscape",
    run_id: str | None = None,
) -> str | None:
    """Find a scene image file path, matching parallel_video_gen.py patterns.

    Args:
        images_dir: Directory containing scene images
        scene_number: Scene number to find
        ratio: "landscape" or "portrait" (affects suffix preference)
        run_id: Optional run ID prefix (e.g. "run001")

    Returns:
        Absolute path to found image, or None
    """
    extensions = ["jpg", "jpeg", "png", "webp"]
    prefer_landscape = ratio == "landscape"
    prefer_cropped = ratio == "portrait"

    patterns = []
    if run_id:
        if prefer_landscape:
            patterns.append(f"{run_id}_scene_{scene_number}_frame_landscape")
        if prefer_cropped:
            patterns.append(f"{run_id}_scene_{scene_number}_frame_cropped")
        patterns.append(f"{run_id}_scene_{scene_number}_frame")

    if prefer_landscape:
        patterns.append(f"scene_{scene_number}_frame_landscape")
    if prefer_cropped:
        patterns.append(f"scene_{scene_number}_frame_cropped")
    patterns.append(f"scene_{scene_number}_frame")

    for pattern in patterns:
        for ext in extensions:
            candidate = os.path.join(images_dir, f"{pattern}.{ext}")
            if os.path.exists(candidate):
                return os.path.abspath(candidate)

    return None


def _find_tts_audio(tts_dir: str, scene_number: int) -> str | None:
    """Find TTS audio file for a scene.

    Checks multiple naming conventions:
    - scene_N_tts.mp3
    - scene_N_combined.mp3
    - scene_N.mp3

    Args:
        tts_dir: Directory containing TTS audio files
        scene_number: Scene number to find

    Returns:
        Absolute path to found audio file, or None
    """
    patterns = [
        f"scene_{scene_number}_tts.mp3",
        f"scene_{scene_number}_combined.mp3",
        f"scene_{scene_number}.mp3",
    ]

    for pattern in patterns:
        candidate = os.path.join(tts_dir, pattern)
        if os.path.exists(candidate):
            return os.path.abspath(candidate)

    return None


# ============================================================================
# Helpers
# ============================================================================

def _ratio_key(aspect_ratio: str) -> str:
    """Convert aspect ratio string to ratio key for _create_task().

    Args:
        aspect_ratio: e.g. "16:9", "9:16", "1:1", or "landscape"/"portrait"

    Returns:
        Ratio key: "landscape", "portrait", or "square"
    """
    # If already a key name, return as-is
    if aspect_ratio in SEEDANCE_RATIO_MAP:
        return aspect_ratio
    # Reverse lookup from SEEDANCE_RATIO_MAP values
    for key, val in SEEDANCE_RATIO_MAP.items():
        if val == aspect_ratio:
            return key
    # Default
    return "landscape"


# ============================================================================
# CLI
# ============================================================================

def _build_batch_parser(subparsers) -> None:
    """Add the batch processing subcommand (default behavior)."""
    batch = subparsers.add_parser(
        "run", help="Submit, poll, and download videos from a queue (default)"
    )
    batch.add_argument("--queue", required=True, help="Path to queue JSON file")

    # Scope
    scope = batch.add_mutually_exclusive_group()
    scope.add_argument("--all", action="store_true", help="Process all pending scenes")
    scope.add_argument("--project", help="Process scenes for a specific project (substring match)")
    scope.add_argument("--status", action="store_true", help="Print status report and exit")

    batch.add_argument("--scene", type=int, help="Process a specific scene number (with --project)")

    # Modes
    batch.add_argument("--dry-run", action="store_true", help="Preview without API calls")
    batch.add_argument("--submit-only", action="store_true",
                       help="Submit tasks but don't poll (use with --concurrent later)")
    batch.add_argument("--retry-failed", action="store_true", help="Include failed scenes")
    batch.add_argument("--poll-only", action="store_true",
                       help="Only poll already-submitted tasks (skip submission)")

    # Settings
    batch.add_argument("--concurrent", type=int, default=0,
                       help="Concurrent polling workers (0 = sequential, default)")
    batch.add_argument("--quality", choices=["fast", "quality"], default="fast",
                       help="Generation quality (default: fast)")
    batch.add_argument("--base-path", default=None,
                       help="Base projects directory (default: queue file's directory)")

    # Prompt enhancement (v2.35)
    batch.add_argument("--prompt-enhance", action="store_true",
                       help="Auto-enhance prompts with cinematic camera vocab, style tokens, "
                            "time segments, and negative prompts before submission")
    batch.add_argument("--genre", default="cinematic",
                       help="Style genre for prompt enhancement (default: cinematic)")
    batch.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")


def _build_genqueue_parser(subparsers) -> None:
    """Add the generate-queue subcommand."""
    gq = subparsers.add_parser(
        "generate-queue",
        help="Create a queue JSON from scenes dict + images dir",
    )
    gq.add_argument("--project", required=True, help="Project slug")
    gq.add_argument("--scenes", help="Scenes JSON dict: '{\"1\":\"prompt\",\"2\":\"prompt\"}'")
    gq.add_argument("--scenes-file", help="Path to JSON file with scenes dict (alternative to --scenes)")
    gq.add_argument("--images-dir", help="Directory containing scene images")
    gq.add_argument("--tts-dir-lipsync", help="TTS audio directory (for audio-lipsync mode)")
    gq.add_argument("--ratio", default="landscape",
                     choices=["landscape", "portrait", "square"],
                     help="Aspect ratio (default: landscape)")
    gq.add_argument("--duration", type=int, default=8, help="Video duration in seconds (default: 8)")
    gq.add_argument("--mode", default="frames-to-video",
                     choices=["text-to-video", "frames-to-video", "audio-lipsync"],
                     help="Generation mode (default: frames-to-video)")
    gq.add_argument("--run-id", help="Run ID for image lookup (e.g. run001)")
    gq.add_argument("--quality", choices=["fast", "quality"], default="fast",
                     help="Generation quality (default: fast)")
    gq.add_argument("--output", required=True, help="Output path for queue JSON")
    gq.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")


def _run_batch(args) -> None:
    """Execute batch processing (the original main() logic)."""
    # Load queue
    try:
        queue = load_queue(args.queue)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
        logger.error("Failed to load queue: %s", e)
        sys.exit(1)

    # Status report
    if args.status:
        print_status(queue)
        return

    # Validate scope
    if not args.all and not args.project:
        logger.error("Specify --all, --project, or --status")
        sys.exit(1)

    if args.scene and not args.project:
        logger.error("--scene requires --project")
        sys.exit(1)

    base_path = args.base_path or os.path.dirname(os.path.abspath(args.queue))

    # Poll-only mode: find submitted scenes and poll them
    if args.poll_only:
        work_items = []
        for proj_name, proj_data in queue["projects"].items():
            if args.project and args.project.lower() not in proj_name.lower():
                continue
            for idx, scene_data in enumerate(proj_data["scenes"]):
                if scene_data.get("status") == "submitted" and scene_data.get("task_id"):
                    work_items.append({
                        "project_name": proj_name,
                        "project_data": proj_data,
                        "scene_data": scene_data,
                        "scene_idx": idx,
                    })

        if not work_items:
            logger.info("No submitted tasks to poll")
            return

        task_map = {i: item["scene_data"]["task_id"] for i, item in enumerate(work_items)}
        workers = args.concurrent or SEEDANCE_BATCH_MAX_WORKERS
        summary = poll_concurrent(task_map, work_items, queue, args.queue, base_path, workers)
        logger.info("Poll complete: %d completed, %d failed", summary["completed"], summary["failed"])
        return

    # Collect work items
    work_items = collect_pending(
        queue,
        project=args.project if not args.all else None,
        scene=args.scene,
        retry_failed=args.retry_failed,
    )

    if not work_items:
        logger.info("No pending scenes to process")
        print_status(queue)
        return

    logger.info("Found %d scene(s) to process", len(work_items))

    # Prompt enhancement (v2.35)
    if args.prompt_enhance:
        enhance_queue_prompts(work_items, queue, args.queue, genre=args.genre)

    # Dry run
    if args.dry_run:
        for i, item in enumerate(work_items, 1):
            scene = item["scene_data"]
            logger.info("[%d] %s scene %s — %s",
                       i, item["project_name"],
                       scene.get("scene_number", "?"),
                       (scene.get("seedance_prompt", "")[:60] or "(no prompt)"))
        logger.info("DRY RUN — %d scenes would be processed", len(work_items))
        return

    # Concurrent mode (submit all, then poll concurrently)
    if args.concurrent > 0 or args.submit_only:
        # Phase 1: Submit all
        task_map = submit_all(work_items, queue, args.queue, args.quality)

        if args.submit_only:
            logger.info("Submit-only mode: %d tasks submitted. Poll later with --poll-only", len(task_map))
            return

        if not task_map:
            logger.warning("No tasks were submitted successfully")
            return

        # Phase 2: Poll concurrently
        workers = args.concurrent or SEEDANCE_BATCH_MAX_WORKERS
        summary = poll_concurrent(task_map, work_items, queue, args.queue, base_path, workers)
        logger.info("Batch complete: %d completed, %d failed", summary["completed"], summary["failed"])

    else:
        # Sequential mode (default)
        summary = process_sequential(
            work_items, queue, args.queue, base_path, args.quality
        )
        logger.info("Batch complete: %d submitted, %d completed, %d failed, %d skipped",
                    summary["submitted"], summary["completed"],
                    summary["failed"], summary["skipped"])

    # Final status
    print_status(queue)


def _run_generate_queue(args) -> None:
    """Execute the generate-queue subcommand."""
    # Parse scenes from JSON string or file
    if args.scenes_file:
        if not os.path.exists(args.scenes_file):
            logger.error("Scenes file not found: %s", args.scenes_file)
            sys.exit(1)
        with open(args.scenes_file) as f:
            scenes = json.load(f)
    elif args.scenes:
        try:
            scenes = json.loads(args.scenes)
        except json.JSONDecodeError as e:
            logger.error("Invalid scenes JSON: %s", e)
            sys.exit(1)
    else:
        logger.error("Provide --scenes or --scenes-file")
        sys.exit(1)

    # Ensure scenes is a dict with string keys
    if not isinstance(scenes, dict):
        logger.error("Scenes must be a JSON object (dict), got %s", type(scenes).__name__)
        sys.exit(1)

    try:
        queue = generate_queue(
            project=args.project,
            scenes=scenes,
            output_path=args.output,
            images_dir=args.images_dir,
            ratio=args.ratio,
            duration=args.duration,
            mode=args.mode,
            tts_dir=args.tts_dir_lipsync,
            run_id=args.run_id,
            quality=args.quality,
        )
    except (FileNotFoundError, ValueError) as e:
        logger.error("Queue generation failed: %s", e)
        sys.exit(1)

    # Print summary
    proj = queue["projects"][args.project]
    scenes_list = proj["scenes"]
    with_images = sum(1 for s in scenes_list if s.get("image_url"))
    with_audio = sum(1 for s in scenes_list if s.get("audio_url"))
    print(f"\nQueue generated: {args.output}")
    print(f"  Project: {args.project}")
    print(f"  Scenes: {len(scenes_list)}")
    print(f"  Mode: {args.mode}")
    print(f"  Ratio: {args.ratio} ({proj['aspect_ratio']})")
    print(f"  Duration: {args.duration}s")
    if with_images:
        print(f"  Images: {with_images}/{len(scenes_list)} scenes have images")
    if with_audio:
        print(f"  Audio: {with_audio}/{len(scenes_list)} scenes have TTS audio")
    print(f"\nNext step:")
    print(f"  python seedance_batch.py run --queue {args.output} --all --concurrent 5")


def main() -> None:
    # Backward compatibility: if first non-flag arg is not a known subcommand
    # (e.g. `--queue Q --all`), route to legacy CLI before subparser parsing.
    known_subcommands = {"run", "generate-queue"}
    first_positional = None
    for arg in sys.argv[1:]:
        if not arg.startswith("-"):
            first_positional = arg
            break

    if first_positional not in known_subcommands:
        # Legacy invocation: `seedance_batch.py --queue Q --all`
        _run_legacy_cli()
        return

    parser = argparse.ArgumentParser(
        description="Seedance 2.0 batch orchestrator — submit, poll, download videos"
    )
    subparsers = parser.add_subparsers(dest="command")

    # Subcommands
    _build_batch_parser(subparsers)
    _build_genqueue_parser(subparsers)

    args = parser.parse_args()

    global logger

    if args.command == "generate-queue":
        if args.verbose:
            logger = setup_logging(__name__, verbose=True)
        _run_generate_queue(args)
    elif args.command == "run":
        if args.verbose:
            logger = setup_logging(__name__, verbose=True)
        _run_batch(args)
    else:
        parser.print_help()
        sys.exit(1)


def _run_legacy_cli() -> None:
    """Backward-compatible CLI: `seedance_batch.py --queue Q --all`."""
    parser = argparse.ArgumentParser(
        description="Seedance 2.0 batch orchestrator — submit, poll, download videos"
    )
    parser.add_argument("--queue", required=True, help="Path to queue JSON file")

    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--all", action="store_true", help="Process all pending scenes")
    scope.add_argument("--project", help="Process scenes for a specific project")
    scope.add_argument("--status", action="store_true", help="Print status report and exit")

    parser.add_argument("--scene", type=int, help="Specific scene number (with --project)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without API calls")
    parser.add_argument("--submit-only", action="store_true", help="Submit but don't poll")
    parser.add_argument("--retry-failed", action="store_true", help="Include failed scenes")
    parser.add_argument("--poll-only", action="store_true", help="Only poll submitted tasks")
    parser.add_argument("--concurrent", type=int, default=0, help="Concurrent workers")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast")
    parser.add_argument("--base-path", default=None)
    parser.add_argument("--prompt-enhance", action="store_true")
    parser.add_argument("--genre", default="cinematic")
    parser.add_argument("--verbose", "-v", action="store_true")

    args = parser.parse_args()
    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)
    _run_batch(args)


if __name__ == "__main__":
    main()
