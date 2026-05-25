#!/usr/bin/env python3
"""
Extend an existing video using Seedance 2.0 API.

Standalone script that takes an existing video and generates a continuation,
maintaining the original style, camera motion, and visual quality.

Usage:
    python extend_video.py \
      --video "projects/test/videos/run001_scene_3.mp4" \
      --duration 8 \
      --prompt "continue the aerial view, maintaining style and camera motion" \
      --output "projects/test/videos/run001_scene_3_extended.mp4"

    # Minimal — auto-generates continuation prompt
    python extend_video.py --video scene_3.mp4

    # Dry-run — show what would happen
    python extend_video.py --video scene_3.mp4 --dry-run

Requires: SUTUI_API_KEY environment variable
"""

import argparse
import os
import sys

from logging_config import setup_logging

logger = setup_logging(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extend an existing video using Seedance 2.0",
    )
    parser.add_argument("--video", required=True, help="Path to existing video to extend")
    parser.add_argument("--duration", type=int, default=8,
                        help="Extension duration in seconds (4-15, default: 8)")
    parser.add_argument("--prompt", default="",
                        help="Guidance for the continuation (default: auto-continue)")
    parser.add_argument("--output", default=None,
                        help="Output file path (default: {video}_extended.mp4)")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast",
                        help="Generation quality: fast (default) or quality")
    parser.add_argument("--genre", default=None,
                        help="Genre for style tokens and negative prompts")
    parser.add_argument("--direction", default="forward",
                        choices=["forward", "backward"],
                        help="Extension direction: forward (continue) or backward (prequel)")
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
        output_path = f"{base}_extended{ext}"

    # Resolve project path for caching
    project_path = None
    if args.project:
        from config import PROJECT_BASE
        project_path = os.path.join(PROJECT_BASE, args.project)

    # Show plan
    file_size = os.path.getsize(args.video) / 1024 / 1024
    logger.info("=" * 60)
    logger.info("EXTEND VIDEO — Seedance 2.0")
    logger.info("=" * 60)
    logger.info("  Input:    %s (%.1fMB)", args.video, file_size)
    logger.info("  Output:   %s", output_path)
    logger.info("  Duration: %ds", args.duration)
    logger.info("  Quality:  %s", args.quality)
    logger.info("  Prompt:   %s", args.prompt or "(auto-continue)")
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
    from seedance_backend import extend_video

    try:
        result_path = extend_video(
            video_path=args.video,
            duration=args.duration,
            prompt=args.prompt,
            output_path=output_path,
            quality=args.quality,
            project_path=project_path,
            genre=args.genre,
            direction=args.direction,
        )
        logger.info("Extended video saved: %s", result_path)
    except Exception as e:
        logger.error("Extension failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
