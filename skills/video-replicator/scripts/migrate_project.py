#!/usr/bin/env python3
"""
Migrate existing projects to new date-prefixed naming format.

Migration Process:
    1. Rename folder: seemanti-new -> 2026-01-23_001_seemanti-new
    2. Add run001_ prefix to images/videos/final files
    3. Create manifest.json

Usage:
    # Migrate single project (auto-detect date from folder mtime)
    python migrate_project.py --project "seemanti-new"

    # Migrate with specific date
    python migrate_project.py --project "prada-rampatel" --date "2026-01-20"

    # Dry-run to see what would happen
    python migrate_project.py --project "seemanti-new" --dry-run

    # Migrate all legacy projects
    python migrate_project.py --all

    # List projects that need migration
    python migrate_project.py --list
"""

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ProjectError, ValidationError

# Script location for computing default paths
_SCRIPT_DIR = Path(__file__).resolve().parent
_REPLICATOR_ROOT = _SCRIPT_DIR.parent.parent.parent.parent  # video-replicator-veo-cli/

# Default project base directory
DEFAULT_PROJECT_BASE = os.environ.get("VIDEO_REPLICATOR_PROJECTS", str(_REPLICATOR_ROOT / "projects"))


def is_legacy_project(project_name: str) -> bool:
    """Check if a project name is in legacy format (no date prefix)."""
    return not re.match(r"\d{4}-\d{2}-\d{2}_\d{3}_", project_name)


def get_legacy_projects(base_path: str = DEFAULT_PROJECT_BASE) -> list:
    """Get list of projects that need migration."""
    base = Path(base_path)
    if not base.exists():
        return []

    legacy = []
    for entry in base.iterdir():
        if entry.is_dir() and is_legacy_project(entry.name):
            legacy.append(entry.name)

    return sorted(legacy)


def migrate_project(
    project_name: str,
    base_path: str = DEFAULT_PROJECT_BASE,
    date_override: str = None,
    dry_run: bool = False
) -> str:
    """
    Migrate existing project to new format.

    Args:
        project_name: Name of the existing project folder
        base_path: Base directory for projects
        date_override: Optional date to use (YYYY-MM-DD)
        dry_run: If True, only print what would happen

    Returns:
        Path to the migrated project

    Raises:
        ValueError: If project not found or already migrated
    """
    base = Path(base_path)
    old_path = base / project_name

    if not old_path.exists():
        raise ProjectError(f"Project not found: {old_path}")

    if not is_legacy_project(project_name):
        raise ProjectError(f"Project already in new format: {project_name}")

    # Determine date (use override or folder mtime)
    if date_override:
        date_str = date_override
        # Validate date format
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError as exc:
            raise ValidationError(f"Invalid date format: {date_override} (expected YYYY-MM-DD)") from exc
    else:
        mtime = old_path.stat().st_mtime
        date_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")

    # Find next sequence number for this date
    existing = list(base.glob(f"{date_str}_*"))
    next_seq = len(existing) + 1

    new_name = f"{date_str}_{next_seq:03d}_{project_name}"
    new_path = base / new_name

    print(f"\n{'='*60}")
    print(f"Migrating: {project_name} -> {new_name}")
    print(f"{'='*60}")

    if dry_run:
        print("DRY RUN - No changes will be made")
        print()

    # Track files to rename
    files_to_rename = []

    # Find files in images/, videos/, final/ that need run prefix
    for subdir in ["images", "videos", "final"]:
        dir_path = old_path / subdir
        if dir_path.exists():
            for f in dir_path.iterdir():
                if f.is_file() and not f.name.startswith("run") and f.suffix.lower() in {".mp4", ".jpg", ".jpeg", ".png", ".webp"}:
                        new_file_name = f"run001_{f.name}"
                        files_to_rename.append((subdir, f.name, new_file_name))

    # Print plan
    print("\n1. Rename folder:")
    print(f"   {project_name} -> {new_name}")

    if files_to_rename:
        print(f"\n2. Add run001_ prefix to {len(files_to_rename)} files:")
        for subdir, old_name, new_name_file in files_to_rename[:5]:
            print(f"   {subdir}/{old_name} -> {subdir}/{new_name_file}")
        if len(files_to_rename) > 5:
            print(f"   ... and {len(files_to_rename) - 5} more")
    else:
        print("\n2. No files need run prefix (already prefixed or empty)")

    print("\n3. Create manifest.json")

    if dry_run:
        print(f"\n{'='*60}")
        print("DRY RUN COMPLETE - No changes made")
        print(f"{'='*60}\n")
        return str(new_path)

    # Execute migration
    print("\nExecuting migration...")

    # Step 1: Rename project folder
    shutil.move(str(old_path), str(new_path))
    print("  Renamed folder")

    # Step 2: Add run001_ prefix to files
    renamed_count = 0
    for subdir, old_name, new_name_file in files_to_rename:
        old_file = new_path / subdir / old_name
        new_file = new_path / subdir / new_name_file
        if old_file.exists():
            old_file.rename(new_file)
            renamed_count += 1

    if renamed_count > 0:
        print(f"  Renamed {renamed_count} files with run001_ prefix")

    # Step 3: Create manifest
    manifest = {
        "slug": project_name,
        "created_at": f"{date_str}T00:00:00",
        "migrated_from": project_name,
        "migrated_at": datetime.now().isoformat(),
        "current_run": 1,
        "runs": [
            {
                "run_id": "run001",
                "created_at": f"{date_str}T00:00:00",
                "status": "migrated",
                "migrated": True
            }
        ]
    }
    (new_path / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("  Created manifest.json")

    print(f"\n{'='*60}")
    print(f"Migration complete: {new_path}")
    print(f"{'='*60}\n")

    return str(new_path)


def migrate_all(base_path: str = DEFAULT_PROJECT_BASE, dry_run: bool = False) -> list:
    """
    Migrate all legacy projects.

    Args:
        base_path: Base directory for projects
        dry_run: If True, only print what would happen

    Returns:
        List of migrated project paths
    """
    legacy_projects = get_legacy_projects(base_path)

    if not legacy_projects:
        print("No legacy projects found to migrate.")
        return []

    print(f"\nFound {len(legacy_projects)} legacy projects to migrate:")
    for p in legacy_projects:
        print(f"  - {p}")

    migrated = []
    failed = []

    for project_name in legacy_projects:
        try:
            new_path = migrate_project(project_name, base_path, dry_run=dry_run)
            migrated.append(new_path)
        except Exception as e:
            print(f"ERROR migrating {project_name}: {e}")
            failed.append((project_name, str(e)))

    print(f"\n{'='*60}")
    print("Migration Summary")
    print(f"{'='*60}")
    print(f"  Migrated: {len(migrated)}")
    print(f"  Failed:   {len(failed)}")

    if failed:
        print("\nFailed projects:")
        for name, error in failed:
            print(f"  - {name}: {error}")

    print(f"{'='*60}\n")

    return migrated


def main():
    parser = argparse.ArgumentParser(description="Migrate projects to new naming format")
    parser.add_argument("--project", help="Project name to migrate")
    parser.add_argument("--date", help="Override date (YYYY-MM-DD)")
    parser.add_argument("--base", default=DEFAULT_PROJECT_BASE, help="Projects base path")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without making changes")
    parser.add_argument("--all", action="store_true", help="Migrate all legacy projects")
    parser.add_argument("--list", action="store_true", help="List projects that need migration")

    args = parser.parse_args()

    if args.list:
        legacy = get_legacy_projects(args.base)
        if legacy:
            print(f"\nLegacy projects needing migration ({len(legacy)}):")
            for p in legacy:
                print(f"  - {p}")
            print("\nRun with --all to migrate all, or --project <name> to migrate one")
        else:
            print("No legacy projects found.")
        return

    if args.all:
        migrate_all(args.base, args.dry_run)
        return

    if not args.project:
        parser.error("--project is required (or use --all or --list)")

    try:
        migrate_project(args.project, args.base, args.date, args.dry_run)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
