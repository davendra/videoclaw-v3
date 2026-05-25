#!/usr/bin/env python3
"""
Project asset completeness dashboard.

Scans a project directory and reports which scenes have images, videos,
and TTS audio — useful for knowing what's done and what's missing before
starting a session.

Usage:
    python project_status.py --project my-project
    python project_status.py --project my-project --run run002
    python project_status.py --project my-project --json
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import PROJECT_BASE


# ---------------------------------------------------------------------------
# File detection helpers
# ---------------------------------------------------------------------------

_RUN_SCENE_PATTERN = re.compile(
    r"^(run\d{3})_scene_(\d+)"
)
_SCENE_TTS_PATTERN = re.compile(
    r"^scene_(\d+)_tts\.mp3$"
)


def _detect_highest_run(directory: str) -> str | None:
    """Return the highest run prefix found in *directory* (e.g. 'run002')."""
    if not os.path.isdir(directory):
        return None
    runs: set[str] = set()
    for name in os.listdir(directory):
        m = _RUN_SCENE_PATTERN.match(name)
        if m:
            runs.add(m.group(1))
    return sorted(runs)[-1] if runs else None


def _detect_run(images_dir: str, videos_dir: str) -> str | None:
    """Auto-detect run by checking images/ then videos/."""
    return _detect_highest_run(images_dir) or _detect_highest_run(videos_dir)


def _scene_numbers_for_run(directory: str, run_id: str) -> set[int]:
    """Return all scene numbers found for *run_id* in *directory*."""
    scenes: set[int] = set()
    if not os.path.isdir(directory):
        return scenes
    for name in os.listdir(directory):
        m = _RUN_SCENE_PATTERN.match(name)
        if m and m.group(1) == run_id:
            scenes.add(int(m.group(2)))
    return scenes


def _has_image(images_dir: str, run_id: str, scene: int) -> bool:
    """Check if any image exists for this scene+run."""
    if not os.path.isdir(images_dir):
        return False
    prefix = f"{run_id}_scene_{scene}"
    return any(
        name.startswith(prefix) and name.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
        for name in os.listdir(images_dir)
    )


def _has_video(videos_dir: str, run_id: str, scene: int) -> bool:
    """Check if any video exists for this scene+run."""
    if not os.path.isdir(videos_dir):
        return False
    prefix = f"{run_id}_scene_{scene}"
    return any(
        name.startswith(prefix) and name.lower().endswith(".mp4")
        for name in os.listdir(videos_dir)
    )


def _has_tts(tts_dir: str, scene: int) -> bool:
    """Check if scene_N_tts.mp3 exists."""
    if not os.path.isdir(tts_dir):
        return False
    return os.path.isfile(os.path.join(tts_dir, f"scene_{scene}_tts.mp3"))


# ---------------------------------------------------------------------------
# Project resolution
# ---------------------------------------------------------------------------

def _resolve_project_dir(project_arg: str) -> str:
    """Resolve --project to an absolute directory path.

    Supports:
      - Absolute path: /Users/.../projects/my-project
      - Relative with 'projects/' prefix: projects/my-project
      - Bare slug: my-project  (looked up under PROJECT_BASE)
    """
    # Already a directory?
    if os.path.isdir(project_arg):
        return os.path.abspath(project_arg)

    # Try under PROJECT_BASE (bare slug)
    candidate = os.path.join(PROJECT_BASE, project_arg)
    if os.path.isdir(candidate):
        return candidate

    # Try date-prefixed match: YYYY-MM-DD_NNN_{slug}
    if os.path.isdir(PROJECT_BASE):
        for entry in sorted(os.listdir(PROJECT_BASE), reverse=True):
            full = os.path.join(PROJECT_BASE, entry)
            if os.path.isdir(full) and entry.endswith(f"_{project_arg}"):
                return full

    return candidate  # fallback (will fail later with clear error)


# ---------------------------------------------------------------------------
# Status collection
# ---------------------------------------------------------------------------

def collect_status(project_dir: str, run_id: str | None = None) -> dict:
    """Collect asset status for every scene in *project_dir*.

    Returns a dict with keys: project_name, run_id, scenes (list of dicts),
    and summary counts.
    """
    images_dir = os.path.join(project_dir, "images")
    videos_dir = os.path.join(project_dir, "videos")
    tts_dir = os.path.join(project_dir, "audio", "tts")

    # Auto-detect run
    if run_id is None:
        run_id = _detect_run(images_dir, videos_dir)
    if run_id is None:
        run_id = "run001"

    # Discover all scene numbers across images + videos
    all_scenes = (
        _scene_numbers_for_run(images_dir, run_id)
        | _scene_numbers_for_run(videos_dir, run_id)
    )
    # Also include scenes from TTS (no run prefix)
    if os.path.isdir(tts_dir):
        for name in os.listdir(tts_dir):
            m = _SCENE_TTS_PATTERN.match(name)
            if m:
                all_scenes.add(int(m.group(1)))

    if not all_scenes:
        return {
            "project_name": os.path.basename(project_dir),
            "project_dir": project_dir,
            "run_id": run_id,
            "total_scenes": 0,
            "scenes": [],
            "summary": {"images": 0, "videos": 0, "tts": 0, "total": 0},
        }

    scenes_sorted = sorted(all_scenes)
    scene_rows: list[dict] = []
    img_count = vid_count = tts_count = 0

    for s in scenes_sorted:
        has_img = _has_image(images_dir, run_id, s)
        has_vid = _has_video(videos_dir, run_id, s)
        has_audio = _has_tts(tts_dir, s)

        missing: list[str] = []
        if not has_img:
            missing.append("image")
        if not has_vid:
            missing.append("video")
        if not has_audio:
            missing.append("TTS")

        notes = f"missing {' + '.join(missing)}" if missing else ""

        scene_rows.append({
            "scene": s,
            "image": has_img,
            "video": has_vid,
            "tts": has_audio,
            "notes": notes,
        })
        img_count += has_img
        vid_count += has_vid
        tts_count += has_audio

    total = len(scenes_sorted)
    return {
        "project_name": os.path.basename(project_dir),
        "project_dir": project_dir,
        "run_id": run_id,
        "total_scenes": total,
        "scenes": scene_rows,
        "summary": {
            "images": img_count,
            "videos": vid_count,
            "tts": tts_count,
            "total": total,
        },
    }


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

def print_table(status: dict) -> None:
    """Print a human-readable table to stdout."""
    total = status["total_scenes"]
    if total == 0:
        print(f"Project: {status['project_name']}  ({status['run_id']})")
        print("No scenes found.")
        return

    print(f"Project: {status['project_name']}  ({status['run_id']}, {total} scenes)")
    print(f"{'Scene':>5}  {'Image':>7}  {'Video':>7}  {'TTS':>5}  Notes")

    check = "+"
    cross = "-"

    for row in status["scenes"]:
        img = check if row["image"] else cross
        vid = check if row["video"] else cross
        tts = check if row["tts"] else cross
        notes = row["notes"]
        print(f"{row['scene']:>5}  {img:>7}  {vid:>7}  {tts:>5}  {notes}")

    s = status["summary"]
    print(
        f"\nSummary: {s['images']}/{s['total']} images, "
        f"{s['videos']}/{s['total']} videos, "
        f"{s['tts']}/{s['total']} TTS"
    )


def print_json(status: dict) -> None:
    """Print machine-readable JSON to stdout."""
    print(json.dumps(status, indent=2))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Project asset completeness dashboard"
    )
    parser.add_argument(
        "--project", required=True,
        help="Project slug or path (e.g. 'my-project' or 'projects/my-project')"
    )
    parser.add_argument(
        "--run", default=None,
        help="Specific run ID (e.g. run002). Auto-detected if omitted."
    )
    parser.add_argument(
        "--json", action="store_true", dest="json_output",
        help="Output as JSON for scripting"
    )
    args = parser.parse_args()

    project_dir = _resolve_project_dir(args.project)
    if not os.path.isdir(project_dir):
        print(f"Error: project directory not found: {project_dir}")
        sys.exit(1)

    status = collect_status(project_dir, run_id=args.run)

    if args.json_output:
        print_json(status)
    else:
        print_table(status)


if __name__ == "__main__":
    main()
