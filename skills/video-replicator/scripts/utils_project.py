#!/usr/bin/env python3
"""
Project directory management, run versioning, and manifest functions.

Extracted from utils.py — handles project structure, run IDs, manifests,
artifact cleaning, and image prefix synchronization.
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path

from exceptions import ManifestError


def ensure_project_dirs(project_base: str, product_name: str) -> dict[str, str]:
    """
    Create standard project directory structure.

    Returns:
        Dict with paths: root, reference, analysis, images, videos, audio, final
    """
    root = os.path.join(project_base, product_name)
    dirs = {
        "root": root,
        "reference": os.path.join(root, "reference"),
        "analysis": os.path.join(root, "analysis"),
        "images": os.path.join(root, "images"),
        "videos": os.path.join(root, "videos"),
        "audio": os.path.join(root, "audio"),
        "final": os.path.join(root, "final"),
    }

    for path in dirs.values():
        os.makedirs(path, exist_ok=True)

    return dirs


def get_project_dirs(project_base: str, product_name: str) -> dict[str, str]:
    """Get project directory paths without creating them."""
    root = os.path.join(project_base, product_name)
    return {
        "root": root,
        "reference": os.path.join(root, "reference"),
        "analysis": os.path.join(root, "analysis"),
        "images": os.path.join(root, "images"),
        "videos": os.path.join(root, "videos"),
        "audio": os.path.join(root, "audio"),
        "final": os.path.join(root, "final"),
    }


def get_run_dir(project_path: str, run_id: str, create: bool = True) -> str:
    """
    Get path to run directory with isolated subdirectories.

    Structure: projects/{slug}/runs/{run_id}/{images,videos,final}/
    """
    run_dir = os.path.join(project_path, "runs", run_id)

    if create:
        os.makedirs(os.path.join(run_dir, "images"), exist_ok=True)
        os.makedirs(os.path.join(run_dir, "videos"), exist_ok=True)
        os.makedirs(os.path.join(run_dir, "final"), exist_ok=True)

    return run_dir


def get_run_subdir(project_path: str, run_id: str, subdir: str, create: bool = True) -> str:
    """Get path to a specific subdirectory within a run."""
    run_dir = get_run_dir(project_path, run_id, create=create)
    path = os.path.join(run_dir, subdir)

    if create:
        os.makedirs(path, exist_ok=True)

    return path


def has_run_structure(project_path: str) -> bool:
    """Check if project uses the new run subdirectory structure."""
    runs_dir = os.path.join(project_path, "runs")
    if not os.path.exists(runs_dir):
        return False

    for entry in os.listdir(runs_dir):
        if re.match(r"run\d{3}$", entry):
            run_path = os.path.join(runs_dir, entry)
            if os.path.isdir(run_path):
                return True

    return False


def get_or_create_manifest(project_path: str) -> dict:
    """
    Get manifest or create one for legacy projects (auto-upgrade).

    The manifest tracks project metadata, current run number, and run history.
    """
    manifest_path = Path(project_path) / "manifest.json"
    if manifest_path.exists():
        try:
            return json.loads(manifest_path.read_text())
        except json.JSONDecodeError as exc:
            raise ManifestError(
                f"Invalid manifest.json at {manifest_path}; "
                "delete or fix the file to proceed"
            ) from exc

    project_name = Path(project_path).name
    slug_match = re.match(r"\d{4}-\d{2}-\d{2}_\d{3}_(.+)", project_name)
    slug = slug_match.group(1) if slug_match else project_name

    manifest = {
        "slug": slug,
        "created_at": datetime.now().isoformat(),
        "current_run": 0,
        "runs": []
    }
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"  Created manifest.json for project: {project_name}")
    return manifest


def get_current_run_id(project_path: str) -> str:
    """Get current run ID from manifest (e.g., 'run001')."""
    manifest = get_or_create_manifest(project_path)
    run_val = manifest.get("current_run", 0)
    if isinstance(run_val, str) and run_val.startswith("run"):
        return run_val
    run_num = run_val if run_val else 1
    return f"run{run_num:03d}"


def increment_run(project_path: str, metadata: dict | None = None) -> str:
    """Increment run counter and record full metadata. Returns new run ID."""
    manifest_path = Path(project_path) / "manifest.json"
    manifest = get_or_create_manifest(project_path)

    current = manifest.get("current_run", 0)
    if isinstance(current, str) and current.startswith("run"):
        current_num = int(current[3:])
    else:
        current_num = current if current else 0

    new_num = current_num + 1
    manifest["current_run"] = new_num
    run_id = f"run{new_num:03d}"

    run_entry = {
        "run_id": run_id,
        "created_at": datetime.now().isoformat(),
        "status": "in_progress",
        **(metadata or {})
    }
    manifest["runs"].append(run_entry)
    manifest_path.write_text(json.dumps(manifest, indent=2))

    return run_id


def update_run_status(project_path: str, run_id: str, status: str, metadata: dict | None = None) -> None:
    """Update the status of a specific run."""
    manifest_path = Path(project_path) / "manifest.json"
    manifest = get_or_create_manifest(project_path)

    for run in manifest["runs"]:
        if run["run_id"] == run_id:
            run["status"] = status
            run["updated_at"] = datetime.now().isoformat()
            if metadata:
                run.update(metadata)
            break

    manifest_path.write_text(json.dumps(manifest, indent=2))


def clean_artifacts(project_path: str, subdirs: list[str], run_prefix: str | None = None) -> dict[str, int]:
    """Clean files from specified subdirectories. Returns {subdir: count_deleted}."""
    results = {}

    for subdir in subdirs:
        dir_path = Path(project_path) / subdir
        if not dir_path.exists():
            results[subdir] = 0
            continue

        count = 0
        for f in dir_path.iterdir():
            if not f.is_file():
                continue
            if f.suffix.lower() not in {".mp4", ".jpg", ".jpeg", ".png", ".webp"}:
                continue
            if run_prefix and not f.name.startswith(run_prefix):
                continue

            f.unlink()
            count += 1

        results[subdir] = count
        if count > 0:
            if run_prefix:
                print(f"  Cleaned {count} {run_prefix} files from {subdir}/")
            else:
                print(f"  Cleaned {count} files from {subdir}/")

    return results


def get_latest_run_id(project_path: str, subdir: str = "videos") -> str | None:
    """Find the highest run ID from files in a directory."""
    dir_path = Path(project_path) / subdir if subdir else Path(project_path)
    if not dir_path.exists():
        return None

    runs = set()
    for f in dir_path.iterdir():
        if f.is_file():
            match = re.match(r"(run\d{3})_", f.name)
            if match:
                runs.add(match.group(1))

    if not runs:
        return None

    return sorted(runs)[-1]


def list_run_files(project_path: str, subdir: str, run_id: str) -> list[Path]:
    """List all files for a specific run in a subdirectory."""
    dir_path = Path(project_path) / subdir
    if not dir_path.exists():
        return []

    return sorted([f for f in dir_path.iterdir() if f.is_file() and f.name.startswith(f"{run_id}_")])


def sync_image_run_prefix(images_dir: str, expected_run: str, dry_run: bool = False) -> dict[str, str]:
    """Sync image file prefixes to match the expected run ID."""
    dir_path = Path(images_dir)
    if not dir_path.exists():
        return {}

    renamed = {}
    run_pattern = re.compile(r'^(run\d{3})_(.+)$')

    for f in dir_path.iterdir():
        if not f.is_file():
            continue

        match = run_pattern.match(f.name)
        if not match:
            continue

        current_run = match.group(1)
        rest_of_name = match.group(2)

        if current_run == expected_run:
            continue

        new_name = f"{expected_run}_{rest_of_name}"
        new_path = f.parent / new_name

        if dry_run:
            print(f"  Would rename: {f.name} → {new_name}")
        else:
            f.rename(new_path)
            print(f"  Synced: {f.name} → {new_name}")

        renamed[f.name] = new_name

    if renamed:
        action = "Would sync" if dry_run else "Synced"
        print(f"  {action} {len(renamed)} image(s) to {expected_run} prefix")

    return renamed


def detect_image_run_prefix(images_dir: str) -> str | None:
    """Detect the run prefix used in images directory."""
    dir_path = Path(images_dir)
    if not dir_path.exists():
        return None

    runs = set()
    run_pattern = re.compile(r'^(run\d{3})_')

    for f in dir_path.iterdir():
        if f.is_file():
            match = run_pattern.match(f.name)
            if match:
                runs.add(match.group(1))

    if not runs:
        return None

    return sorted(runs)[-1]


def auto_detect_image_run(images_dir: str, scenes: dict | None = None) -> str | None:
    """Auto-detect the best image run prefix for F2V mode.

    Scans *images_dir* for files matching ``run*_scene_*_frame*.(jpg|jpeg|png|webp)``
    and returns the run prefix that has the most matching scene files.

    When *scenes* is provided the function only counts images whose scene
    number appears in the scenes dict, giving a more accurate match.

    Args:
        images_dir: Directory containing scene frame images.
        scenes: Optional dict of scene numbers (keys as strings) to filter by.

    Returns:
        The best matching run prefix (e.g. ``"run001"``) or ``None`` if no
        scene images are found.
    """
    dir_path = Path(images_dir)
    if not dir_path.exists():
        return None

    # Pattern: run001_scene_3_frame.jpg  or  run002_scene_12_frame_landscape.png
    scene_pattern = re.compile(
        r'^(run\d{3})_scene_(\d+)_frame[^.]*\.(jpg|jpeg|png|webp)$',
        re.IGNORECASE,
    )

    # Collect: {run_prefix: set_of_scene_numbers}
    run_scenes: dict[str, set[int]] = {}

    for f in dir_path.iterdir():
        if not f.is_file():
            continue
        m = scene_pattern.match(f.name)
        if not m:
            continue
        run_prefix = m.group(1)
        scene_num = int(m.group(2))

        # If scenes filter is provided, only count matching scene numbers
        if scenes is not None and str(scene_num) not in scenes:
            continue

        run_scenes.setdefault(run_prefix, set()).add(scene_num)

    if not run_scenes:
        return None

    # Pick the run prefix with the most matching scene images.
    # Tie-break: highest run number (latest).
    best_run = max(
        run_scenes,
        key=lambda r: (len(run_scenes[r]), r),
    )
    return best_run


# ---------------------------------------------------------------------------
# Version output tracking
# ---------------------------------------------------------------------------

_VERSION_DIR_PATTERN = re.compile(r"^v(\d+)_(.+)$")


def parse_version_spec(version_str: str) -> tuple[int | None, str]:
    """Parse a version string into (number, label).

    If the string already starts with ``v<N>_``, the explicit number is used.
    Otherwise, ``None`` is returned as the number so that the caller can
    auto-increment.

    Examples::

        "comedy"    -> (None, "comedy")
        "v3_remix"  -> (3, "remix")
        "v10_final" -> (10, "final")
    """
    m = _VERSION_DIR_PATTERN.match(version_str)
    if m:
        return int(m.group(1)), m.group(2)
    return None, version_str


def scan_existing_versions(final_dir: str) -> list[dict]:
    """Scan ``final/`` for existing version subdirectories.

    Returns a sorted list (by version number) of dicts::

        [{"number": 1, "label": "serious", "dir": "final/v1_serious"}, ...]
    """
    final_path = Path(final_dir)
    if not final_path.exists():
        return []

    versions: list[dict] = []
    for entry in final_path.iterdir():
        if not entry.is_dir():
            continue
        m = _VERSION_DIR_PATTERN.match(entry.name)
        if m:
            versions.append({
                "number": int(m.group(1)),
                "label": m.group(2),
                "dir": str(entry),
            })

    return sorted(versions, key=lambda v: v["number"])


def next_version_number(final_dir: str) -> int:
    """Return the next available version number inside *final_dir*."""
    existing = scan_existing_versions(final_dir)
    if not existing:
        return 1
    return max(v["number"] for v in existing) + 1


def resolve_version_dir(final_dir: str, version_str: str) -> tuple[str, int, str]:
    """Resolve a ``--version`` value to an output directory.

    Returns ``(dir_path, version_number, label)``.

    * If *version_str* contains an explicit number (``v3_remix``), that is
      used directly.
    * Otherwise, the next available number is chosen automatically.
    """
    explicit_num, label = parse_version_spec(version_str)
    if explicit_num is not None:
        version_num = explicit_num
    else:
        version_num = next_version_number(final_dir)

    dirname = f"v{version_num}_{label}"
    dir_path = os.path.join(final_dir, dirname)
    os.makedirs(dir_path, exist_ok=True)
    return dir_path, version_num, label


def record_version_in_manifest(
    project_path: str,
    version_number: int,
    label: str,
    output_path: str,
) -> dict:
    """Append a version entry to the project manifest and persist it.

    Returns the new version entry dict.
    """
    manifest_path = Path(project_path) / "manifest.json"
    manifest = get_or_create_manifest(project_path)

    if "versions" not in manifest:
        manifest["versions"] = []

    entry = {
        "number": version_number,
        "label": label,
        "output": output_path,
        "created": datetime.now().isoformat(),
    }
    manifest["versions"].append(entry)
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return entry


def list_versions(project_path: str) -> list[dict]:
    """Return all recorded versions from the manifest."""
    manifest = get_or_create_manifest(project_path)
    return manifest.get("versions", [])
