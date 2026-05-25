#!/usr/bin/env python3
"""
Edit an existing video's content using Seedance 2.0 API.

Standalone script for plot editing — modifies what happens in an existing
video while preserving visual style and quality.

Usage:
    python edit_video.py \
      --video "projects/test/videos/run001_scene_5.mp4" \
      --edit "change the character's shirt from blue to red" \
      --output "projects/test/videos/run001_scene_5_edited.mp4"

    # Dry-run — show what would happen
    python edit_video.py --video scene_5.mp4 --edit "add rain effect" --dry-run

Requires: SUTUI_API_KEY environment variable
"""

import argparse
import os
import sys

from logging_config import setup_logging

logger = setup_logging(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Edit an existing video's content using Seedance 2.0",
    )
    parser.add_argument("--video", required=True, help="Path to existing video to edit")
    parser.add_argument("--edit", required=True,
                        help="Description of desired changes (e.g. 'change shirt to red')")
    parser.add_argument("--output", default=None,
                        help="Output file path (default: {video}_edited.mp4)")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast",
                        help="Generation quality: fast (default) or quality")
    parser.add_argument("--duration", type=int, default=None,
                        help="Output duration in seconds (default: match source)")
    parser.add_argument("--edit-type", default="general",
                        choices=["color_change", "object_swap", "style_transfer",
                                 "lighting_change", "weather_change", "add_effect",
                                 "remove_element", "general"],
                        help="Edit template type (default: general)")
    parser.add_argument("--target", default="",
                        help="What to change (e.g. 'blue shirt', 'daytime lighting')")
    parser.add_argument("--replacement", default="",
                        help="What to change it to (e.g. 'red', 'sunset golden hour')")
    parser.add_argument("--genre", default=None,
                        help="Genre for style-aware negative prompts")
    parser.add_argument("--project", default=None,
                        help="Project name for upload caching")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would happen without calling API")
    parser.add_argument("--yes", "-y", action="store_true",
                        help="Skip confirmation prompt")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose logging")

    args = parser.parse_args()

    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    # Validate input
    if not os.path.exists(args.video):
        logger.error("Video not found: %s", args.video)
        sys.exit(1)

    if not os.environ.get("SUTUI_API_KEY"):
        logger.error("SUTUI_API_KEY not set. Get one at https://www.xskill.ai/#/v2/api-keys")
        sys.exit(1)

    # Resolve output path
    output_path = args.output
    if not output_path:
        base, ext = os.path.splitext(args.video)
        output_path = f"{base}_edited{ext}"

    # Resolve project path for caching
    project_path = None
    if args.project:
        from config import PROJECT_BASE
        project_path = os.path.join(PROJECT_BASE, args.project)

    # Show plan
    file_size = os.path.getsize(args.video) / 1024 / 1024
    logger.info("=" * 60)
    logger.info("EDIT VIDEO — Seedance 2.0")
    logger.info("=" * 60)
    logger.info("  Input:    %s (%.1fMB)", args.video, file_size)
    logger.info("  Output:   %s", output_path)
    logger.info("  Edit:     %s", args.edit)
    logger.info("  Quality:  %s", args.quality)
    if args.duration:
        logger.info("  Duration: %ds", args.duration)
    logger.info("=" * 60)

    if args.dry_run:
        logger.info("DRY RUN — no API calls made")
        sys.exit(0)

    if not args.yes:
        confirm = input("Proceed? [y/N] ").strip().lower()
        if confirm != "y":
            logger.info("Cancelled")
            sys.exit(0)

    # Generate
    from seedance_backend import edit_video

    try:
        result_path = edit_video(
            video_path=args.video,
            edit_prompt=args.edit,
            output_path=output_path,
            quality=args.quality,
            duration=args.duration,
            project_path=project_path,
            edit_type=args.edit_type,
            target=args.target,
            replacement=args.replacement,
            genre=args.genre,
        )
        logger.info("Edited video saved: %s", result_path)
    except Exception as e:
        logger.error("Edit failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
