#!/usr/bin/env python3
"""
Unified Database Interface for Video Replicator
Automatically selects SQLite (local) or Convex (cloud) based on CONVEX_URL env var.

Usage:
    from db_unified import get_db, is_using_convex

    # Get database instance (auto-selects backend)
    db = get_db()
    db.create_project("my-project", "My Project")

    # Check which backend is active
    if is_using_convex():
        print("Using Convex cloud database")

Environment:
    - CONVEX_URL not set: Uses SQLite (default)
    - CONVEX_URL set: Uses Convex cloud
    - CONVEX_USER_EMAIL: Optional, for user tracking in Convex

Migration:
    python db_unified.py migrate  # Migrate SQLite data to Convex
"""

import contextlib
import os
import sys
from typing import TYPE_CHECKING, Union

# Import SQLite implementation
from db import DEFAULT_DB_PATH, VideoReplicatorDB

if TYPE_CHECKING:
    from db_convex import VideoReplicatorConvexDB

# Global database instance
_db_instance = None


def is_using_convex() -> bool:
    """Check if Convex backend is configured."""
    return bool(os.environ.get("CONVEX_URL"))


def get_db(force_sqlite: bool = False) -> Union["VideoReplicatorDB", "VideoReplicatorConvexDB"]:
    """
    Get database instance, auto-selecting backend based on environment.

    Args:
        force_sqlite: If True, always use SQLite regardless of CONVEX_URL

    Returns:
        Database instance (SQLite or Convex)
    """
    global _db_instance

    if _db_instance is not None:
        return _db_instance

    if not force_sqlite and is_using_convex():
        # Lazy import to avoid dependency issues
        from db_convex import VideoReplicatorConvexDB
        _db_instance = VideoReplicatorConvexDB()
    else:
        _db_instance = VideoReplicatorDB()

    return _db_instance


def close_db():
    """Close database connection and reset instance."""
    global _db_instance
    if _db_instance is not None:
        _db_instance.close()
        _db_instance = None


def get_backend_name() -> str:
    """Get name of active backend."""
    return "convex" if is_using_convex() else "sqlite"


def migrate_to_convex(dry_run: bool = False) -> dict[str, int]:
    """
    Migrate all data from SQLite to Convex.

    Args:
        dry_run: If True, only count records without migrating

    Returns:
        Dict with counts of migrated records
    """
    if not is_using_convex():
        raise OSError(
            "CONVEX_URL not set. Set it before migrating:\n"
            "  export CONVEX_URL=https://your-project.convex.cloud"
        )

    # Get both databases
    sqlite_db = VideoReplicatorDB()
    from db_convex import VideoReplicatorConvexDB
    convex_db = VideoReplicatorConvexDB()

    counts = {
        "projects": 0,
        "analyses": 0,
        "scenes": 0,
        "images": 0,
        "videos": 0,
        "learned_patterns": 0,
    }

    print(f"Migrating from SQLite ({sqlite_db.db_path}) to Convex...")

    # Migrate projects
    projects = sqlite_db.list_projects()
    print(f"  Found {len(projects)} projects")

    project_id_map = {}  # SQLite ID -> Convex ID

    for p in projects:
        counts["projects"] += 1
        if dry_run:
            continue

        # Check if project already exists in Convex
        existing = convex_db.get_project(p["slug"])
        if existing:
            project_id_map[p["id"]] = existing["id"]
            print(f"    Skipping existing project: {p['slug']}")
            continue

        # Create project in Convex
        convex_id = convex_db.create_project(
            slug=p["slug"],
            name=p["name"],
            description=p.get("description"),
            reference_url=p.get("reference_video_url")
        )
        project_id_map[p["id"]] = convex_id
        print(f"    Migrated project: {p['slug']}")

    # Migrate analyses and scenes
    analysis_id_map = {}  # SQLite ID -> Convex ID
    scene_id_map = {}  # SQLite ID -> Convex ID

    for sqlite_project_id, convex_project_id in project_id_map.items():
        # Get latest analysis for this project
        analysis = sqlite_db.get_latest_analysis(sqlite_project_id)
        if analysis:
            counts["analyses"] += 1
            if not dry_run:
                convex_analysis_id = convex_db.save_analysis(
                    project_id=convex_project_id,
                    analysis_json=analysis.get("analysis_json", {}),
                    gemini_model=analysis.get("gemini_model", "gemini-1.5-pro")
                )
                analysis_id_map[analysis["id"]] = convex_analysis_id

        # Get scenes for this project
        scenes = sqlite_db.get_scenes_for_project(sqlite_project_id)
        for scene in scenes:
            counts["scenes"] += 1
            if not dry_run and analysis and analysis["id"] in analysis_id_map:
                convex_scene_id = convex_db.save_scene(
                    analysis_id=analysis_id_map[analysis["id"]],
                    project_id=convex_project_id,
                    scene_data=scene
                )
                scene_id_map[scene["id"]] = convex_scene_id

        # Get images for this project
        images = sqlite_db.get_images_for_project(sqlite_project_id)
        for img in images:
            counts["images"] += 1
            if not dry_run:
                scene_convex_id = scene_id_map.get(img.get("scene_id"))
                if scene_convex_id:
                    convex_db.save_image(
                        scene_id=scene_convex_id,
                        project_id=convex_project_id,
                        scene_number=img.get("scene_number", 0),
                        file_path=img.get("file_path"),
                        prompt=img.get("prompt_used", ""),
                        go_bananas_id=img.get("go_bananas_image_id"),
                        image_type=img.get("image_type", "start"),
                        width=img.get("width"),
                        height=img.get("height"),
                        aspect_ratio=img.get("aspect_ratio")
                    )

        # Get videos for this project
        videos = sqlite_db.get_videos_for_project(sqlite_project_id)
        for video in videos:
            counts["videos"] += 1
            if not dry_run:
                scene_convex_id = scene_id_map.get(video.get("scene_id"))
                if scene_convex_id:
                    video_id = convex_db.start_video_generation(
                        scene_id=scene_convex_id,
                        project_id=convex_project_id,
                        scene_number=video.get("scene_number", 0),
                        image_id=None,
                        prompt=video.get("prompt_used", ""),
                        model=video.get("model", "veo"),
                        quality=video.get("quality", "fast"),
                        mode=video.get("mode", "i2v"),
                        aspect_ratio=video.get("aspect_ratio", "landscape")
                    )
                    if video.get("status") == "completed" and video.get("file_path"):
                        convex_db.complete_video(
                            video_id=video_id,
                            file_path=video["file_path"],
                            variant=video.get("variant", "primary"),
                            generation_time=video.get("generation_time_seconds"),
                            credits=video.get("credits_used")
                        )
                    elif video.get("status") == "failed":
                        convex_db.fail_video(
                            video_id=video_id,
                            error_message=video.get("error_message", "Unknown error")
                        )

    # Migrate learned patterns
    cursor = sqlite_db.conn.cursor()
    cursor.execute("SELECT * FROM learned_patterns")
    patterns = [dict(row) for row in cursor.fetchall()]

    for pattern in patterns:
        counts["learned_patterns"] += 1
        if dry_run:
            continue

        # Parse JSON fields
        import json
        effective_prompts = []
        if pattern.get("effective_prompts"):
            with contextlib.suppress(json.JSONDecodeError, TypeError, ValueError):
                effective_prompts = json.loads(pattern["effective_prompts"])

        for prompt in effective_prompts:
            settings = None
            if pattern.get("effective_settings"):
                with contextlib.suppress(json.JSONDecodeError, TypeError, ValueError):
                    settings = json.loads(pattern["effective_settings"])

            convex_db.learn_from_success(
                pattern_type=pattern.get("pattern_type", "unknown"),
                pattern_name=pattern.get("pattern_name", "unknown"),
                prompt_fragment=prompt,
                settings=settings,
                quality_score=pattern.get("avg_quality_score")
            )

        avoid_prompts = []
        if pattern.get("avoid_prompts"):
            with contextlib.suppress(json.JSONDecodeError, TypeError, ValueError):
                avoid_prompts = json.loads(pattern["avoid_prompts"])

        for prompt in avoid_prompts:
            convex_db.learn_from_failure(
                pattern_type=pattern.get("pattern_type", "unknown"),
                pattern_name=pattern.get("pattern_name", "unknown"),
                prompt_fragment=prompt
            )

    sqlite_db.close()
    convex_db.close()

    return counts


# ============================================================================
# Proxy functions for convenience (delegates to get_db())
# ============================================================================

def create_project(slug: str, name: str = None, **kwargs) -> int | str:
    """Create a new project."""
    return get_db().create_project(slug, name, **kwargs)


def get_project(slug: str) -> dict | None:
    """Get project by slug."""
    return get_db().get_project(slug)


def get_or_create_project(slug: str, name: str = None) -> dict:
    """Get existing project or create new one."""
    return get_db().get_or_create_project(slug, name)


def list_projects() -> list[dict]:
    """List all projects."""
    return get_db().list_projects()


def save_analysis(project_id: int | str, analysis_json: dict, **kwargs) -> int | str:
    """Save SEALCAM+ analysis."""
    return get_db().save_analysis(project_id, analysis_json, **kwargs)


def get_latest_analysis(project_id: int | str) -> dict | None:
    """Get the most recent analysis for a project."""
    return get_db().get_latest_analysis(project_id)


def save_scene(analysis_id: int | str, project_id: int | str, scene_data: dict) -> int | str:
    """Save a scene from analysis."""
    return get_db().save_scene(analysis_id, project_id, scene_data)


def get_scenes_for_project(project_id: int | str) -> list[dict]:
    """Get all scenes for a project."""
    return get_db().get_scenes_for_project(project_id)


def update_scene_prompts(scene_id: int | str, prompts: dict):
    """Update prompts for a scene."""
    get_db().update_scene_prompts(scene_id, prompts)


def save_image(scene_id: int | str, project_id: int | str, scene_number: int,
               file_path: str, prompt: str, **kwargs) -> int | str:
    """Save an image record."""
    return get_db().save_image(scene_id, project_id, scene_number, file_path, prompt, **kwargs)


def get_image_for_scene(scene_id: int | str, image_type: str = "start") -> dict | None:
    """Get image for a scene."""
    return get_db().get_image_for_scene(scene_id, image_type)


def get_images_for_project(project_id: int | str) -> list[dict]:
    """Get all images for a project."""
    return get_db().get_images_for_project(project_id)


def start_video_generation(scene_id: int | str, project_id: int | str,
                           scene_number: int, image_id: int | str, prompt: str,
                           **kwargs) -> int | str:
    """Start tracking a video generation."""
    return get_db().start_video_generation(scene_id, project_id, scene_number, image_id, prompt, **kwargs)


def complete_video(video_id: int | str, file_path: str, **kwargs):
    """Mark a video as completed."""
    get_db().complete_video(video_id, file_path, **kwargs)


def fail_video(video_id: int | str, error_message: str):
    """Mark a video as failed."""
    get_db().fail_video(video_id, error_message)


def rate_video(video_id: int | str, **kwargs):
    """Rate a video's quality."""
    get_db().rate_video(video_id, **kwargs)


def get_videos_for_project(project_id: int | str, status: str = None) -> list[dict]:
    """Get videos for a project."""
    return get_db().get_videos_for_project(project_id, status)


def learn_from_success(pattern_type: str, pattern_name: str, prompt_fragment: str, **kwargs):
    """Record a successful pattern."""
    get_db().learn_from_success(pattern_type, pattern_name, prompt_fragment, **kwargs)


def learn_from_failure(pattern_type: str, pattern_name: str, prompt_fragment: str):
    """Record a failed pattern."""
    get_db().learn_from_failure(pattern_type, pattern_name, prompt_fragment)


def get_effective_patterns(pattern_type: str, limit: int = 10) -> list[dict]:
    """Get patterns sorted by success rate."""
    return get_db().get_effective_patterns(pattern_type, limit)


def get_avoid_patterns(pattern_type: str) -> list[str]:
    """Get list of prompt fragments to avoid."""
    return get_db().get_avoid_patterns(pattern_type)


def get_project_stats(project_id: int | str) -> dict:
    """Get generation statistics for a project."""
    return get_db().get_project_stats(project_id)


def get_overall_stats() -> dict:
    """Get overall system statistics."""
    return get_db().get_overall_stats()


def get_best_performing_prompts(limit: int = 10) -> list[dict]:
    """Get prompts with highest quality scores."""
    return get_db().get_best_performing_prompts(limit)


# ============================================================================
# Screenplay & Film Character proxy functions (v2.37)
# ============================================================================

def save_screenplay(project_id, concept: str, **kwargs):
    """Create a screenplay."""
    return get_db().save_screenplay(project_id, concept, **kwargs)


def get_screenplay(project_id) -> dict | None:
    """Get the latest screenplay for a project."""
    return get_db().get_screenplay(project_id)


def update_screenplay(screenplay_id, **fields):
    """Update screenplay fields."""
    get_db().update_screenplay(screenplay_id, **fields)


def save_film_character(project_id, name: str, **kwargs):
    """Create a film character."""
    return get_db().save_film_character(project_id, name, **kwargs)


def get_film_characters(project_id) -> list[dict]:
    """Get all film characters for a project."""
    return get_db().get_film_characters(project_id)


def get_film_character_by_name(project_id, name: str) -> dict | None:
    """Get a film character by project and name."""
    return get_db().get_film_character_by_name(project_id, name)


def update_film_character(character_id, **fields):
    """Update film character fields."""
    get_db().update_film_character(character_id, **fields)


# CLI interface
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Video Replicator Unified Database")
    parser.add_argument("command", choices=["status", "migrate", "stats", "projects"])
    parser.add_argument("--dry-run", action="store_true", help="Preview migration without changes")
    parser.add_argument("--project", help="Project slug")
    args = parser.parse_args()

    if args.command == "status":
        backend = get_backend_name()
        print("\n=== Database Status ===")
        print(f"Backend: {backend}")
        if backend == "convex":
            print(f"Convex URL: {os.environ.get('CONVEX_URL')}")
        else:
            print(f"SQLite path: {DEFAULT_DB_PATH}")

        db = get_db()
        stats = db.get_overall_stats()
        print(f"\nProjects: {stats['projects']}")
        print(f"Videos: {stats['videos']['total']} ({stats['videos']['completed']} completed)")
        print(f"Learned patterns: {stats['learned_patterns']}")

    elif args.command == "migrate":
        if not is_using_convex():
            print("Error: CONVEX_URL not set.")
            print("Set the environment variable before migrating:")
            print("  export CONVEX_URL=https://your-project.convex.cloud")
            sys.exit(1)

        print("=== SQLite to Convex Migration ===")
        if args.dry_run:
            print("(Dry run - no changes will be made)\n")

        counts = migrate_to_convex(dry_run=args.dry_run)

        print(f"\nMigration {'preview' if args.dry_run else 'complete'}:")
        for table, count in counts.items():
            print(f"  {table}: {count}")

        if args.dry_run:
            print("\nRun without --dry-run to perform migration.")

    elif args.command == "stats":
        db = get_db()
        if args.project:
            project = db.get_project(args.project)
            if project:
                stats = db.get_project_stats(project["id"])
                print(f"\nProject: {project['name']} ({project['slug']})")
                print(f"  Scenes: {stats['scenes']['total_scenes']}")
                print(f"  Images: {stats['images']['total_images']}")
                print(f"  Videos: {stats['videos']['total_videos']}")
            else:
                print(f"Project not found: {args.project}")
        else:
            stats = db.get_overall_stats()
            print(f"\n=== Overall Stats ({get_backend_name()}) ===")
            print(f"Projects: {stats['projects']}")
            print(f"Videos: {stats['videos']['total']}")
            print(f"Learned patterns: {stats['learned_patterns']}")

    elif args.command == "projects":
        db = get_db()
        projects = db.list_projects()
        print(f"\n=== Projects ({get_backend_name()}) ===")
        for p in projects:
            print(f"  {p['slug']}: {p['name']}")

    close_db()
