#!/usr/bin/env python3
"""
Create a new project with date-prefixed folder naming.

Project Naming Convention:
    YYYY-MM-DD_NNN_slug

    - YYYY-MM-DD: Project creation date
    - NNN: Sequence number (auto-increment per day)
    - slug: Product/brand name (user-provided)

Example:
    projects/2026-01-23_001_seemanti-new/
    projects/2026-01-23_002_prada-campaign/
    projects/2026-01-22_001_modern-minimal/

Usage:
    # Create new project
    python create_project.py --slug "brand-campaign"

    # Create with custom base path
    python create_project.py --slug "brand-campaign" --base "custom/projects"

    # List existing projects
    python create_project.py --list
"""

import argparse
import json
import os
import re
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


def create_project(slug: str, base_path: str = DEFAULT_PROJECT_BASE) -> str:
    """
    Create new project folder with date prefix.

    Args:
        slug: Product/brand name (will be sanitized)
        base_path: Base directory for projects

    Returns:
        Full path to the created project directory
    """
    # Sanitize slug
    slug = re.sub(r'[^\w\-]', '-', slug.lower())
    slug = re.sub(r'-+', '-', slug).strip('-')

    if not slug:
        raise ValidationError("Slug cannot be empty after sanitization")

    today = datetime.now().strftime("%Y-%m-%d")

    # Ensure base path exists
    base = Path(base_path)
    base.mkdir(parents=True, exist_ok=True)

    # Find next sequence number for today
    existing = list(base.glob(f"{today}_*"))
    next_seq = len(existing) + 1

    project_name = f"{today}_{next_seq:03d}_{slug}"
    project_path = base / project_name

    # Check if project already exists
    if project_path.exists():
        raise ProjectError(f"Project already exists: {project_path}")

    # Create directory structure
    subdirs = ["analysis", "images", "videos", "audio", "final", "reference"]
    for subdir in subdirs:
        (project_path / subdir).mkdir(parents=True, exist_ok=True)

    # Create manifest
    manifest = {
        "slug": slug,
        "created_at": datetime.now().isoformat(),
        "current_run": 0,  # Will become 1 on first video generation
        "runs": []
    }
    (project_path / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"Created project: {project_path}")
    print(f"  Slug: {slug}")
    print(f"  Structure: {', '.join(subdirs)}")

    return str(project_path)


def list_projects(base_path: str = DEFAULT_PROJECT_BASE, limit: int = 20) -> list:
    """
    List existing projects, sorted by date (newest first).

    Args:
        base_path: Base directory for projects
        limit: Maximum number of projects to list

    Returns:
        List of project info dicts
    """
    base = Path(base_path)
    if not base.exists():
        print(f"Projects directory not found: {base}")
        return []

    projects = []

    for entry in base.iterdir():
        if not entry.is_dir():
            continue

        # Parse project name
        match = re.match(r"(\d{4}-\d{2}-\d{2})_(\d{3})_(.+)", entry.name)
        if match:
            date_str, seq, slug = match.groups()
            info = {
                "name": entry.name,
                "path": str(entry),
                "date": date_str,
                "sequence": int(seq),
                "slug": slug,
                "has_manifest": (entry / "manifest.json").exists()
            }
        else:
            # Legacy project (no date prefix)
            info = {
                "name": entry.name,
                "path": str(entry),
                "date": None,
                "sequence": None,
                "slug": entry.name,
                "has_manifest": (entry / "manifest.json").exists(),
                "legacy": True
            }

        # Check for content
        info["has_videos"] = any((entry / "videos").glob("*.mp4")) if (entry / "videos").exists() else False
        info["has_images"] = any((entry / "images").glob("*.*")) if (entry / "images").exists() else False
        info["has_final"] = any((entry / "final").glob("*.mp4")) if (entry / "final").exists() else False

        projects.append(info)

    # Sort by date (newest first), then by sequence (highest first)
    # Legacy projects (no date) go to the end
    def sort_key(p):
        if p.get("date"):
            return (0, p["date"], p.get("sequence", 0))
        return (1, "0000-00-00", 0)

    projects.sort(key=sort_key, reverse=True)

    return projects[:limit]


def print_project_list(projects: list) -> None:
    """Print formatted project list."""
    if not projects:
        print("No projects found.")
        return

    print(f"\n{'='*70}")
    print("Projects (newest first)")
    print(f"{'='*70}")

    for p in projects:
        status_icons = []
        if p.get("has_videos"):
            status_icons.append("V")  # Videos
        if p.get("has_images"):
            status_icons.append("I")  # Images
        if p.get("has_final"):
            status_icons.append("F")  # Final

        status = f"[{','.join(status_icons)}]" if status_icons else "[empty]"

        if p.get("legacy"):
            print(f"  {p['name']:40} {status:12} (legacy - needs migration)")
        else:
            print(f"  {p['name']:40} {status}")

    print(f"{'='*70}")
    print("Legend: V=videos, I=images, F=final output")
    print(f"{'='*70}\n")


def main():
    parser = argparse.ArgumentParser(description="Create a new video-replicator project")
    parser.add_argument("--slug", help="Product/brand name for the project")
    parser.add_argument("--base", default=DEFAULT_PROJECT_BASE, help="Base path for projects")
    parser.add_argument("--list", action="store_true", help="List existing projects")
    parser.add_argument("--limit", type=int, default=20, help="Max projects to list (default: 20)")

    args = parser.parse_args()

    if args.list:
        projects = list_projects(args.base, args.limit)
        print_project_list(projects)
        return

    if not args.slug:
        parser.error("--slug is required (or use --list to see existing projects)")

    try:
        project_path = create_project(args.slug, args.base)
        print("\nNext steps:")
        print(f"  1. Add reference video to: {project_path}/reference/")
        print(f"  2. Run analysis: python analyze_video.py --video <video> --output {project_path}/analysis/sealcam_analysis.json")
        print(f"  3. Or use CREATE mode: python create_wizard.py --project {Path(project_path).name}")
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
