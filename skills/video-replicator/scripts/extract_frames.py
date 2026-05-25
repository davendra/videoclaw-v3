#!/usr/bin/env python3
"""
Extract frames from a video at scene timestamps from SEALCAM+ analysis.

Phase 1.5 of the video-replicator pipeline: extract reference frames for
style transfer (Go Bananas edit_uploaded_image) or visual reference for
fresh image generation.

Modes:
  - Batch: Extract frames for ALL scenes from SEALCAM+ analysis JSON
  - Single scene: Extract frame for a specific scene number
  - Single timestamp: Extract frame at an arbitrary timestamp
  - Keyframes: Auto-detect scene changes via FFmpeg
  - Detect slides: Scene detection for presentation videos (slides.json output)

Usage:
    # Batch: all scenes from analysis
    python extract_frames.py \
      --video "projects/{slug}/reference/original.mp4" \
      --analysis "projects/{slug}/analysis/sealcam_analysis.json" \
      --output-dir "projects/{slug}/reference/frames" \
      --position start

    # Single scene by number
    python extract_frames.py \
      --video "projects/{slug}/reference/original.mp4" \
      --analysis "projects/{slug}/analysis/sealcam_analysis.json" \
      --scene 3 \
      --output-dir "projects/{slug}/reference/frames"

    # Single frame at timestamp
    python extract_frames.py \
      --video "projects/{slug}/reference/original.mp4" \
      --timestamp "00:03" \
      --output "projects/{slug}/reference/frames/custom_frame.jpg"

    # Auto keyframe extraction (scene-change detection)
    python extract_frames.py \
      --video "projects/{slug}/reference/original.mp4" \
      --keyframes \
      --output-dir "projects/{slug}/reference/frames"

    # Detect slides (PRESENTATION mode)
    python extract_frames.py \
      --video "projects/{slug}/input_videos/presentation.mp4" \
      --detect-slides \
      --threshold 0.3 \
      --output-dir "projects/{slug}/slides" \
      --output-json "projects/{slug}/analysis/slides.json"

    # Dry-run (preview without extracting)
    python extract_frames.py \
      --video "..." --analysis "..." --dry-run
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logging_config import setup_logging

# Logger configured in main() with --verbose flag; default INFO for library use
logger = setup_logging(__name__)

from utils_transitions import filter_content_scenes
from utils_video import extract_frame_ffmpeg, extract_last_frame, get_video_duration, parse_sealcam_timestamp

try:
    from utils_project import get_current_run_id
except ImportError:
    def get_current_run_id(project_path):
        return "run001"


def extract_frames_from_analysis(
    video_path: str,
    analysis_path: str,
    output_dir: str,
    position: str = "start",
    format: str = "jpg",
    scenes: list[int] | None = None,
    skip_transitions: bool = True,
) -> dict[int, str]:
    """
    Extract frames for scenes defined in a SEALCAM+ analysis JSON.

    Args:
        video_path: Path to the source video
        analysis_path: Path to SEALCAM+ analysis JSON
        output_dir: Directory for extracted frames
        position: Where in each scene to extract: "start", "middle", or "end"
        format: Output format: "jpg" or "png"
        scenes: Optional list of scene numbers to extract (None = all)
        skip_transitions: If True, skip scenes marked as transitions

    Returns:
        Dict mapping scene_number to output frame path
    """
    with open(analysis_path) as f:
        analysis = json.load(f)

    scene_list = analysis.get("scenes", [])
    if not scene_list:
        logger.error("No scenes found in analysis JSON")
        return {}

    # Filter transitions if requested
    if skip_transitions:
        content_scenes, skipped = filter_content_scenes(scene_list)
        if skipped:
            logger.info(f"Skipping {len(skipped)} transition scene(s): {skipped}")
        scene_list = content_scenes

    # Filter to specific scenes if requested
    if scenes is not None:
        scene_list = [s for s in scene_list if s.get("scene_number") in scenes]
        if not scene_list:
            logger.error(f"No matching scenes found for numbers: {scenes}")
            return {}

    os.makedirs(output_dir, exist_ok=True)
    results = {}

    for scene in scene_list:
        scene_num = scene.get("scene_number", 0)
        timestamp_str = scene.get("timestamp", "")

        if not timestamp_str:
            logger.warning(f"Scene {scene_num}: No timestamp found, skipping")
            continue

        try:
            seconds = parse_sealcam_timestamp(timestamp_str, position)
        except ValueError as e:
            logger.warning(f"Scene {scene_num}: Invalid timestamp '{timestamp_str}': {e}")
            continue

        output_path = os.path.join(output_dir, f"scene_{scene_num}_frame.{format}")

        logger.info(f"Scene {scene_num}: extracting at {seconds:.1f}s (timestamp: {timestamp_str}, position: {position})")
        success = extract_frame_ffmpeg(video_path, seconds, output_path)

        if success:
            file_size = os.path.getsize(output_path)
            logger.info(f"Saved: {output_path} ({file_size / 1024:.1f} KB)")
            results[scene_num] = output_path
        else:
            logger.error(f"FAILED to extract frame for scene {scene_num}")

    return results


def extract_keyframes(
    video_path: str,
    output_dir: str,
    threshold: float = 0.4,
    format: str = "jpg",
) -> list[str]:
    """
    Auto-detect scene changes and extract keyframes using FFmpeg.

    Uses FFmpeg's scene-change detection filter to find frames where
    significant visual changes occur.

    Args:
        video_path: Path to the source video
        output_dir: Directory for extracted keyframes
        threshold: Scene-change sensitivity (0.0-1.0, lower = more sensitive)
        format: Output format: "jpg" or "png"

    Returns:
        List of paths to extracted keyframe images
    """
    os.makedirs(output_dir, exist_ok=True)

    output_pattern = os.path.join(output_dir, f"keyframe_%03d.{format}")

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i", video_path,
                "-vf", f"select='gt(scene,{threshold})',showinfo",
                "-vsync", "vfr",
                "-q:v", "2",
                output_pattern,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            logger.error(f"FFmpeg keyframe extraction failed: {result.stderr[:300]}")
            return []

    except subprocess.TimeoutExpired:
        logger.error("FFmpeg timed out during keyframe extraction")
        return []
    except FileNotFoundError:
        logger.error("FFmpeg not found. Install with: brew install ffmpeg")
        return []

    # Collect output files
    output_files = sorted(
        [
            os.path.join(output_dir, f)
            for f in os.listdir(output_dir)
            if f.startswith("keyframe_") and f.endswith(f".{format}")
        ]
    )

    logger.info(f"Extracted {len(output_files)} keyframes (threshold: {threshold})")
    return output_files


def detect_slides(
    video_path: str,
    output_dir: str,
    output_json: str | None = None,
    threshold: float = 0.3,
    format: str = "jpg",
    dry_run: bool = False,
) -> dict:
    """
    Detect slides in a presentation video using FFmpeg scene detection.

    Extracts one frame per detected slide and produces a slides.json with
    timestamps, durations, and image paths for the PRESENTATION mode pipeline.

    Args:
        video_path: Path to the source presentation video
        output_dir: Directory for extracted slide images
        output_json: Path for slides.json output (default: output_dir/slides.json)
        threshold: Scene-change sensitivity (0.0-1.0, lower = more sensitive)
        format: Output format: "jpg" or "png"
        dry_run: Preview detection without extracting frames

    Returns:
        Dict with slides.json structure
    """
    # Get video duration
    video_duration = get_video_duration(video_path)
    if not video_duration:
        logger.error("Could not determine video duration")
        return {}

    # Run FFmpeg scene detection to get timestamps
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-i", video_path,
                "-vf", f"select='gt(scene,{threshold})',showinfo",
                "-vsync", "vfr",
                "-f", "null",
                "-",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        logger.error("FFmpeg timed out during scene detection")
        return {}
    except FileNotFoundError:
        logger.error("FFmpeg not found. Install with: brew install ffmpeg")
        return {}

    # Parse timestamps from showinfo output
    timestamps = [0.0]  # First slide always starts at 0
    for line in result.stderr.split("\n"):
        if "showinfo" in line and "pts_time:" in line:
            try:
                pts_part = line.split("pts_time:")[1].split()[0]
                ts = float(pts_part)
                timestamps.append(ts)
            except (IndexError, ValueError):
                continue

    # Remove duplicates and sort
    timestamps = sorted(set(timestamps))

    # Calculate durations
    slides = []
    for i, ts in enumerate(timestamps):
        duration = timestamps[i + 1] - ts if i < len(timestamps) - 1 else video_duration - ts
        slides.append({
            "slide": i + 1,
            "timestamp": round(ts, 1),
            "duration": round(duration, 1),
        })

    # Build slides.json structure
    slides_data = {
        "total_slides": len(slides),
        "source_video": os.path.abspath(video_path),
        "source_duration": round(video_duration, 1),
        "detection_threshold": threshold,
        "slides": slides,
    }

    # Print summary for user confirmation
    logger.info("=" * 60)
    logger.info(f"Detected {len(slides)} slides (threshold: {threshold})")
    logger.info("=" * 60)
    logger.info(f"Video duration: {video_duration:.1f}s ({int(video_duration//60)}:{video_duration%60:04.1f})")
    for s in slides:
        ts = s["timestamp"]
        dur = s["duration"]
        ts_fmt = f"{int(ts//60)}:{ts%60:04.1f}"
        end = ts + dur
        end_fmt = f"{int(end//60)}:{end%60:04.1f}"
        padded = f"{s['slide']:2d}"
        logger.info(f"Slide {padded}: {ts_fmt} - {end_fmt}  ({dur:.1f}s)")
    logger.info("=" * 60)

    if dry_run:
        logger.info("Dry run -- no frames extracted.")
        return slides_data

    # Extract frames
    os.makedirs(output_dir, exist_ok=True)
    logger.info(f"Extracting {len(slides)} slide frames...")

    for s in slides:
        padded_num = f"{s['slide']:02d}"
        output_path = os.path.join(output_dir, f"slide_{padded_num}.{format}")
        success = extract_frame_ffmpeg(video_path, s["timestamp"], output_path)
        if success:
            s["original_image"] = output_path
            file_size = os.path.getsize(output_path)
            logger.info(f"Slide {s['slide']}: {output_path} ({file_size / 1024:.1f} KB)")
        else:
            logger.error(f"Slide {s['slide']}: FAILED to extract frame")

    # Write slides.json
    if not output_json:
        output_json = os.path.join(output_dir, "slides.json")
    os.makedirs(os.path.dirname(os.path.abspath(output_json)), exist_ok=True)

    with open(output_json, "w") as f:
        json.dump(slides_data, f, indent=2)
    logger.info(f"Slides JSON: {output_json}")

    return slides_data


def dry_run_analysis(
    analysis_path: str,
    position: str = "start",
    scenes: list[int] | None = None,
    skip_transitions: bool = True,
) -> None:
    """
    Preview what frames would be extracted without actually extracting.

    Args:
        analysis_path: Path to SEALCAM+ analysis JSON
        position: Where in each scene to extract
        scenes: Optional list of scene numbers to extract
        skip_transitions: If True, skip transition scenes
    """
    with open(analysis_path) as f:
        analysis = json.load(f)

    scene_list = analysis.get("scenes", [])
    meta = analysis.get("metadata", {})

    logger.info("=" * 60)
    logger.info("DRY RUN - Frame Extraction Preview")
    logger.info("=" * 60)

    if meta:
        logger.info(f"Video: {meta.get('overall_vibe', 'N/A')}")
        logger.info(f"Duration: {meta.get('total_duration', 'N/A')}s")
        logger.info(f"Scenes: {meta.get('scene_count', len(scene_list))}")
    logger.info(f"Position: {position}")

    if skip_transitions:
        content_scenes, skipped = filter_content_scenes(scene_list)
        if skipped:
            logger.info(f"Transition scenes (skipped): {skipped}")
        scene_list = content_scenes

    if scenes is not None:
        scene_list = [s for s in scene_list if s.get("scene_number") in scenes]

    for scene in scene_list:
        scene_num = scene.get("scene_number", 0)
        timestamp_str = scene.get("timestamp", "N/A")
        duration = scene.get("duration_seconds", "?")

        try:
            seconds = parse_sealcam_timestamp(timestamp_str, position)
            extract_time = f"{seconds:.1f}s"
        except (ValueError, AttributeError):
            extract_time = "ERROR"

        # Get brief description
        subject = scene.get("subject", {})
        action = scene.get("action", {})
        desc = subject.get("appearance", "")[:50] or action.get("primary", "")[:50] or "N/A"

        logger.info(f"Scene {scene_num}: {timestamp_str} ({duration}s) -> extract at {extract_time}")
        logger.debug(f"Scene {scene_num}: {desc}")

    logger.info(f"Total frames to extract: {len(scene_list)}")
    logger.info("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Extract frames from video at SEALCAM+ scene timestamps",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Batch extraction from analysis
  python extract_frames.py --video ref.mp4 --analysis analysis.json --output-dir frames/

  # Single scene
  python extract_frames.py --video ref.mp4 --analysis analysis.json --scene 3 --output-dir frames/

  # Arbitrary timestamp
  python extract_frames.py --video ref.mp4 --timestamp "0:15" --output frame_15s.jpg

  # Auto keyframes
  python extract_frames.py --video ref.mp4 --keyframes --output-dir frames/

  # Dry run
  python extract_frames.py --video ref.mp4 --analysis analysis.json --dry-run
        """,
    )

    # Input
    parser.add_argument("--video", required=True, help="Path to source video file")
    parser.add_argument("--analysis", help="Path to SEALCAM+ analysis JSON (for batch/scene mode)")

    # Mode selection
    parser.add_argument("--scene", type=int, help="Extract frame for a single scene number")
    parser.add_argument("--timestamp", help="Extract frame at arbitrary timestamp (e.g., '0:15', '1:30')")
    parser.add_argument("--keyframes", action="store_true", help="Auto-detect and extract keyframes")
    parser.add_argument("--detect-slides", action="store_true",
                        help="Detect slides in a presentation video (outputs slides.json)")
    parser.add_argument("--output-json", help="Path for slides.json output (used with --detect-slides)")
    parser.add_argument("--last-frame", action="store_true",
                        help="Extract last frame of video (for chained F2V generation)")
    parser.add_argument("--video-dir",
                        help="Extract last frames from all videos in directory (use with --last-frame)")

    # Output
    parser.add_argument("--output-dir", help="Output directory for extracted frames")
    parser.add_argument("--output", help="Output path for single frame extraction")
    parser.add_argument("--copy-to-images", action="store_true",
                        help="Auto-copy extracted frames to images/ with run-prefixed naming (e.g., run001_scene_N_frame.jpg)")
    parser.add_argument("--project-dir",
                        help="Project directory (required with --copy-to-images, for images/ path and run ID)")

    # Options
    parser.add_argument(
        "--position",
        choices=["start", "middle", "end"],
        default="start",
        help="Where in each scene to extract the frame (default: start)",
    )
    parser.add_argument(
        "--format",
        choices=["jpg", "png"],
        default="jpg",
        help="Output image format (default: jpg)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.4,
        help="Keyframe detection threshold 0.0-1.0 (default: 0.4, lower=more frames)",
    )
    parser.add_argument(
        "--include-transitions",
        action="store_true",
        help="Include transition scenes (skipped by default)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview extraction without running FFmpeg")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Reconfigure logger level with verbose flag
    if args.verbose:
        import logging
        logger.setLevel(logging.DEBUG)
        for handler in logger.handlers:
            handler.setLevel(logging.DEBUG)

    # Validate video exists
    if not os.path.exists(args.video):
        logger.error(f"Video not found: {args.video}")
        sys.exit(1)

    # Mode: Detect slides (PRESENTATION mode)
    if args.detect_slides:
        output_dir = args.output_dir
        if not output_dir:
            logger.error("--output-dir required with --detect-slides")
            sys.exit(1)

        slides_data = detect_slides(
            video_path=args.video,
            output_dir=output_dir,
            output_json=args.output_json,
            threshold=args.threshold,
            format=args.format,
            dry_run=args.dry_run,
        )
        if slides_data:
            logger.info(f"Total: {slides_data.get('total_slides', 0)} slides detected")
        return

    # Mode: Extract last frame(s)
    if args.last_frame:
        if args.video_dir:
            # Extract last frames from all videos in a directory
            output_dir = args.output_dir
            if not output_dir:
                logger.error("--output-dir required with --video-dir")
                sys.exit(1)

            if not os.path.isdir(args.video_dir):
                logger.error("Video directory not found: %s", args.video_dir)
                sys.exit(1)

            os.makedirs(output_dir, exist_ok=True)

            import re
            video_files = sorted([
                f for f in os.listdir(args.video_dir)
                if f.endswith(".mp4") and re.match(r".*scene_\d+", f)
            ])

            if not video_files:
                logger.error("No scene video files found in %s", args.video_dir)
                sys.exit(1)

            if args.dry_run:
                logger.info("Would extract last frame from %d videos:", len(video_files))
                for vf in video_files:
                    logger.info("  %s -> last_frame_*.jpg", vf)
                return

            results = {}
            for vf in video_files:
                video_path = os.path.join(args.video_dir, vf)
                # Extract scene number from filename
                match = re.search(r"scene_(\d+)", vf)
                if not match:
                    continue
                scene_num = int(match.group(1))
                out_path = os.path.join(output_dir, f"chain_frame_{scene_num}.{args.format}")
                success = extract_last_frame(video_path, out_path)
                if success:
                    file_size = os.path.getsize(out_path)
                    logger.info("Scene %d: %s (%d KB)", scene_num, out_path, file_size // 1024)
                    results[scene_num] = out_path
                else:
                    logger.error("Scene %d: FAILED to extract last frame from %s", scene_num, vf)

            logger.info("Extracted last frames: %d/%d", len(results), len(video_files))
            return
        else:
            # Extract last frame from a single video
            if not args.output and not args.output_dir:
                logger.error("--output or --output-dir required with --last-frame")
                sys.exit(1)

            output_path = args.output
            if not output_path:
                os.makedirs(args.output_dir, exist_ok=True)
                base = os.path.splitext(os.path.basename(args.video))[0]
                output_path = os.path.join(args.output_dir, f"{base}_last_frame.{args.format}")

            if args.dry_run:
                logger.info("Would extract last frame from %s -> %s", args.video, output_path)
                return

            logger.info("Extracting last frame from %s", args.video)
            success = extract_last_frame(args.video, output_path)
            if success:
                file_size = os.path.getsize(output_path)
                logger.info("Saved: %s (%d KB)", output_path, file_size // 1024)
            else:
                logger.error("Failed to extract last frame")
                sys.exit(1)
            return

    # Mode: Single timestamp
    if args.timestamp:
        if not args.output:
            # Auto-generate output path
            if args.output_dir:
                os.makedirs(args.output_dir, exist_ok=True)
                args.output = os.path.join(args.output_dir, f"frame_at_{args.timestamp.replace(':', 'm')}s.{args.format}")
            else:
                logger.error("--output or --output-dir required with --timestamp")
                sys.exit(1)

        try:
            seconds = parse_sealcam_timestamp(args.timestamp)
        except ValueError as e:
            logger.error(f"Invalid timestamp '{args.timestamp}': {e}")
            sys.exit(1)

        if args.dry_run:
            logger.info(f"Would extract frame at {seconds:.1f}s -> {args.output}")
            return

        logger.info(f"Extracting frame at {seconds:.1f}s from {args.video}")
        success = extract_frame_ffmpeg(args.video, seconds, args.output)
        if success:
            file_size = os.path.getsize(args.output)
            logger.info(f"Saved: {args.output} ({file_size / 1024:.1f} KB)")
        else:
            logger.error("Failed to extract frame")
            sys.exit(1)
        return

    # Mode: Auto keyframes
    if args.keyframes:
        output_dir = args.output_dir
        if not output_dir:
            logger.error("--output-dir required with --keyframes")
            sys.exit(1)

        if args.dry_run:
            duration = get_video_duration(args.video)
            logger.info(f"Would extract keyframes from {args.video} (duration: {duration}s)")
            logger.info(f"Threshold: {args.threshold}")
            logger.info(f"Output: {output_dir}/keyframe_NNN.{args.format}")
            return

        logger.info(f"Extracting keyframes from {args.video} (threshold: {args.threshold})")
        frames = extract_keyframes(args.video, output_dir, args.threshold, args.format)
        if frames:
            logger.info(f"Extracted {len(frames)} keyframes:")
            for f in frames:
                logger.info(f"  {f}")
        else:
            logger.warning("No keyframes extracted")
        return

    # Mode: Batch or single scene from analysis
    if not args.analysis:
        logger.error("--analysis required for batch/scene extraction (or use --timestamp/--keyframes)")
        sys.exit(1)

    if not os.path.exists(args.analysis):
        logger.error(f"Analysis file not found: {args.analysis}")
        sys.exit(1)

    output_dir = args.output_dir
    if not output_dir:
        # Default: sibling 'frames' directory to the analysis file
        output_dir = os.path.join(os.path.dirname(os.path.dirname(args.analysis)), "reference", "frames")

    skip_transitions = not args.include_transitions

    # Dry run
    if args.dry_run:
        scene_filter = [args.scene] if args.scene else None
        dry_run_analysis(args.analysis, args.position, scene_filter, skip_transitions)
        return

    # Single scene
    scene_filter = [args.scene] if args.scene else None

    logger.info(f"Extracting frames from: {args.video}")
    logger.info(f"Analysis: {args.analysis}")
    logger.info(f"Output: {output_dir}")
    logger.info(f"Position: {args.position}")
    if scene_filter:
        logger.info(f"Scene: {args.scene}")

    results = extract_frames_from_analysis(
        video_path=args.video,
        analysis_path=args.analysis,
        output_dir=output_dir,
        position=args.position,
        format=args.format,
        scenes=scene_filter,
        skip_transitions=skip_transitions,
    )

    # Summary
    logger.info("=" * 60)
    logger.info("Extraction Complete")
    logger.info("=" * 60)
    logger.info(f"Extracted: {len(results)} frame(s)")
    logger.info(f"Output directory: {output_dir}")

    if results:
        for scene_num in sorted(results.keys()):
            logger.info(f"Scene {scene_num}: {os.path.basename(results[scene_num])}")

    logger.info("=" * 60)

    # Copy to images/ with run-prefixed naming
    if args.copy_to_images and results:
        if not args.project_dir:
            logger.error("--project-dir is required with --copy-to-images")
            sys.exit(1)

        project_dir = os.path.abspath(args.project_dir)
        run_id = get_current_run_id(project_dir)
        images_dir = os.path.join(project_dir, "images")
        os.makedirs(images_dir, exist_ok=True)

        copied = 0
        for scene_num in sorted(results.keys()):
            src = results[scene_num]
            ext = os.path.splitext(src)[1]  # e.g., .jpg or .png
            dest = os.path.join(images_dir, f"{run_id}_scene_{scene_num}_frame{ext}")
            shutil.copy2(src, dest)
            logger.info(f"Copied: {os.path.basename(src)} -> {os.path.basename(dest)}")
            copied += 1

        logger.info(f"Copied {copied} frames to images/ with run prefix '{run_id}'")


if __name__ == "__main__":
    main()
