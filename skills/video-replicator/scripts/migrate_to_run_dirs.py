#!/usr/bin/env python3
"""
Migrate existing projects to the new run subdirectory structure.

This script moves files from the flat structure:
    images/run001_scene_1_frame_v1.jpg
    videos/run001_scene_1_v1.mp4
    final/run001_replicated_ad_v1.mp4

To the new run-isolated structure:
    runs/run001/images/scene_1_frame_v1.jpg
    runs/run001/videos/scene_1_v1.mp4
    runs/run001/final/replicated_ad_v1.mp4

Usage:
    # Dry-run (preview changes)
    python migrate_to_run_dirs.py --project "2026-01-23_003_prada-family-ad" --dry-run

    # Execute migration
    python migrate_to_run_dirs.py --project "2026-01-23_003_prada-family-ad"

    # Migrate all projects in directory
    python migrate_to_run_dirs.py --all --dry-run
"""

import argparse
import os
import re
import shutil
import sys
from pathlib import Path

# Script location for computing default paths
_SCRIPT_DIR = Path(__file__).resolve().parent
_REPLICATOR_ROOT = _SCRIPT_DIR.parent.parent.parent.parent  # video-replicator-veo-cli/

# Default project base directory
DEFAULT_PROJECT_BASE = os.environ.get("VIDEO_REPLICATOR_PROJECTS", str(_REPLICATOR_ROOT / "projects"))


def detect_run_files(project_path: str) -> dict[str, list[tuple[str, str, str]]]:
    """
    Detect files with run prefixes in the flat structure.

    Returns:
        Dict with keys 'images', 'videos', 'final', each containing
        list of (original_path, run_id, new_filename) tuples
    """
    results = {
        "images": [],
        "videos": [],
        "final": [],
    }

    # Pattern: run###_rest_of_filename.ext
    run_pattern = re.compile(r'^(run\d{3})_(.+)$')

    for subdir in ["images", "videos", "final"]:
        dir_path = os.path.join(project_path, subdir)
        if not os.path.exists(dir_path):
            continue

        for filename in os.listdir(dir_path):
            match = run_pattern.match(filename)
            if match:
                run_id = match.group(1)
                new_filename = match.group(2)
                original_path = os.path.join(dir_path, filename)
                results[subdir].append((original_path, run_id, new_filename))

    return results


def migrate_project(project_path: str, dry_run: bool = True) -> dict:
    """
    Migrate a single project to run subdirectory structure.

    Args:
        project_path: Full path to the project directory
        dry_run: If True, only preview changes without moving files

    Returns:
        Dict with migration statistics
    """
    project_name = os.path.basename(project_path)
    print(f"\n{'='*60}")
    print(f"{'[DRY RUN] ' if dry_run else ''}Migrating: {project_name}")
    print(f"{'='*60}")

    # Check if already migrated
    runs_dir = os.path.join(project_path, "runs")
    if os.path.exists(runs_dir) and os.listdir(runs_dir):
        print("  Already has runs/ structure - checking for remaining flat files...")

    # Detect files to migrate
    files_to_migrate = detect_run_files(project_path)

    total_files = sum(len(files) for files in files_to_migrate.values())
    if total_files == 0:
        print("  No run-prefixed files found in flat structure.")
        return {"project": project_name, "migrated": 0, "skipped": 0}

    # Group files by run_id
    run_ids = set()
    for subdir_files in files_to_migrate.values():
        for _, run_id, _ in subdir_files:
            run_ids.add(run_id)

    print(f"  Found {total_files} files across runs: {sorted(run_ids)}")

    migrated = 0
    skipped = 0

    for subdir in ["images", "videos", "final"]:
        if not files_to_migrate[subdir]:
            continue

        print(f"\n  {subdir}/")

        for original_path, run_id, new_filename in files_to_migrate[subdir]:
            # Destination path
            dest_dir = os.path.join(project_path, "runs", run_id, subdir)
            dest_path = os.path.join(dest_dir, new_filename)

            # Check if destination exists
            if os.path.exists(dest_path):
                print(f"    SKIP (exists): {os.path.basename(original_path)}")
                skipped += 1
                continue

            # Show the move operation
            rel_original = os.path.relpath(original_path, project_path)
            rel_dest = os.path.relpath(dest_path, project_path)
            print(f"    {rel_original} -> {rel_dest}")

            if not dry_run:
                os.makedirs(dest_dir, exist_ok=True)
                shutil.move(original_path, dest_path)

            migrated += 1

    print(f"\n  Summary: {migrated} migrated, {skipped} skipped")

    return {
        "project": project_name,
        "migrated": migrated,
        "skipped": skipped,
        "run_ids": sorted(run_ids),
    }


def find_projects(base_path: str) -> list[str]:
    """Find all project directories in the base path."""
    projects = []

    if not os.path.exists(base_path):
        return projects

    for entry in os.listdir(base_path):
        entry_path = os.path.join(base_path, entry)
        if os.path.isdir(entry_path):
            # Check if it looks like a project (has manifest.json or expected subdirs)
            is_project = (
                os.path.exists(os.path.join(entry_path, "manifest.json")) or
                os.path.exists(os.path.join(entry_path, "images")) or
                os.path.exists(os.path.join(entry_path, "videos"))
            )
            if is_project:
                projects.append(entry_path)

    return sorted(projects)


def main():
    parser = argparse.ArgumentParser(
        description="Migrate projects to run subdirectory structure",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Preview migration for a single project
  python migrate_to_run_dirs.py --project "prada-family-ad" --dry-run

  # Execute migration
  python migrate_to_run_dirs.py --project "prada-family-ad"

  # Preview migration for all projects
  python migrate_to_run_dirs.py --all --dry-run

  # Execute migration for all projects
  python migrate_to_run_dirs.py --all
        """
    )

    parser.add_argument(
        "--project", "-p",
        help="Project slug or full path to migrate"
    )
    parser.add_argument(
        "--all", "-a",
        action="store_true",
        help="Migrate all projects in the projects directory"
    )
    parser.add_argument(
        "--base",
        default=DEFAULT_PROJECT_BASE,
        help=f"Base path for projects (default: {DEFAULT_PROJECT_BASE})"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without moving files"
    )

    args = parser.parse_args()

    if not args.project and not args.all:
        parser.error("Specify --project or --all")

    # Gather projects to migrate
    projects = []

    if args.all:
        projects = find_projects(args.base)
        if not projects:
            print(f"No projects found in: {args.base}")
            return
        print(f"Found {len(projects)} projects to check")
    else:
        # Single project
        if os.path.isabs(args.project) or os.path.exists(args.project):
            project_path = args.project
        else:
            # Look for project by slug
            matching = [
                d for d in os.listdir(args.base)
                if args.project in d
            ]
            if matching:
                project_path = os.path.join(args.base, sorted(matching)[-1])
            else:
                project_path = os.path.join(args.base, args.project)

        if not os.path.exists(project_path):
            print(f"Project not found: {project_path}")
            sys.exit(1)

        projects = [project_path]

    # Run migrations
    results = []
    for project_path in projects:
        result = migrate_project(project_path, dry_run=args.dry_run)
        results.append(result)

    # Summary
    total_migrated = sum(r["migrated"] for r in results)
    total_skipped = sum(r["skipped"] for r in results)

    print(f"\n{'='*60}")
    print(f"{'[DRY RUN] ' if args.dry_run else ''}Migration Complete")
    print(f"{'='*60}")
    print(f"Projects processed: {len(results)}")
    print(f"Files migrated: {total_migrated}")
    print(f"Files skipped: {total_skipped}")

    if args.dry_run and total_migrated > 0:
        print("\nRun without --dry-run to execute the migration.")


if __name__ == "__main__":
    main()
