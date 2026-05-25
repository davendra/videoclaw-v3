#!/usr/bin/env python3
"""
UGC-specific video stitching script.

Wraps stitch_video.py with UGC structure awareness: reads a belief script,
orders scenes by UGC canonical order (hook -> problem -> mechanism -> proof
-> offer -> cta), validates video files, and delegates to stitch_video.py.

Optionally auto-subtitles the output and updates the campaign manifest.

Usage:
    # Basic UGC stitch
    python ugc_stitch.py --project "myproject" --script-id "belief_1" --yes

    # With background music and auto-subtitles
    python ugc_stitch.py --project "myproject" --script-id "belief_1" \
        --audio "projects/myproject/audio/music.mp3" \
        --auto-subtitle --subtitle-style ugc-bold --yes

    # Dry-run to preview stitch plan
    python ugc_stitch.py --project "myproject" --script-id "belief_1" --dry-run

    # Custom output path and preset
    python ugc_stitch.py --project "myproject" --script-id "belief_1" \
        --output "projects/myproject/final/custom.mp4" \
        --preset presenter --yes
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from config import AUDIO_PRESETS, PROJECT_BASE, UGC_SCENE_TYPES
from exceptions import CampaignManifestError, ScriptValidationError, ValidationError
from ffmpeg_wrapper import FFmpegWrapper
from logging_config import setup_logging

logger = setup_logging(__name__)
_ff = FFmpegWrapper()

# Canonical UGC scene order
UGC_SCENE_ORDER = UGC_SCENE_TYPES  # ["hook", "problem", "mechanism", "proof", "offer", "cta"]

SCRIPTS_DIR = Path(__file__).resolve().parent


def load_belief_script(script_path: Path) -> dict:
    """Load and validate a belief script JSON file."""
    if not script_path.exists():
        raise ScriptValidationError(f"Belief script not found: {script_path}")

    with open(script_path) as f:
        script = json.load(f)

    # Validate required fields
    if "scenes" not in script:
        raise ScriptValidationError(
            f"Belief script missing 'scenes' key: {script_path}"
        )

    scenes = script["scenes"]
    if not isinstance(scenes, list) or len(scenes) == 0:
        raise ScriptValidationError(
            f"Belief script 'scenes' must be a non-empty list: {script_path}"
        )

    # Validate each scene has a type and scene_number
    for i, scene in enumerate(scenes):
        if "type" not in scene:
            raise ScriptValidationError(
                f"Scene {i} missing 'type' in {script_path}"
            )
        if "scene_number" not in scene:
            raise ScriptValidationError(
                f"Scene {i} missing 'scene_number' in {script_path}"
            )

    return script


def order_scenes_by_ugc(scenes: list[dict]) -> list[dict]:
    """Order scenes by canonical UGC structure."""
    # Build lookup: type -> list of scenes
    by_type: dict[str, list[dict]] = {}
    for scene in scenes:
        scene_type = scene["type"]
        by_type.setdefault(scene_type, []).append(scene)

    ordered = []
    for scene_type in UGC_SCENE_ORDER:
        if scene_type in by_type:
            # Sort scenes of the same type by scene_number
            sorted_scenes = sorted(by_type[scene_type], key=lambda s: s["scene_number"])
            ordered.extend(sorted_scenes)

    # Append any scenes with unknown types at the end
    known_types = set(UGC_SCENE_ORDER)
    for scene in scenes:
        if scene["type"] not in known_types and scene not in ordered:
            ordered.append(scene)

    return ordered


def find_video_file(videos_dir: Path, scene_number: int) -> Path | None:
    """Find a video file matching a scene number in the videos directory."""
    # Gather all candidate files across patterns
    patterns = [
        f"*scene_{scene_number}.mp4",
        f"*scene_{scene_number}_v1.mp4",
        f"*scene_{scene_number}_*.mp4",
    ]

    candidates: list[Path] = []
    seen: set[str] = set()
    for pattern in patterns:
        for m in sorted(videos_dir.glob(pattern)):
            if m.name not in seen:
                seen.add(m.name)
                candidates.append(m)

    if not candidates:
        return None

    # Prefer voice-changed files if available
    for m in candidates:
        if "_voice_changed" in m.name:
            return m
    return candidates[0]


def estimate_total_duration(video_files: list[Path]) -> float:
    """Estimate total duration from video files."""
    total = 0.0
    for vf in video_files:
        dur = _ff.get_duration(str(vf))
        if dur is not None:
            total += dur
    return total


def print_stitch_summary(
    script_id: str,
    ordered_scenes: list[dict],
    video_files: list[Path],
    output_path: Path,
    preset: str,
    audio_path: str | None,
    auto_subtitle: bool,
    subtitle_style: str | None,
) -> None:
    """Print a clear summary of the stitch plan."""
    print("\n=== UGC Stitch Plan ===")
    print(f"  Script:    {script_id}")
    print(f"  Preset:    {preset}")
    print(f"  Output:    {output_path}")
    if audio_path:
        print(f"  Music:     {audio_path}")
    if auto_subtitle:
        print(f"  Subtitles: {subtitle_style or 'ugc-bold'}")

    print(f"\n  Scene Order ({len(ordered_scenes)} scenes):")
    total_dur = 0.0
    for i, (scene, vf) in enumerate(zip(ordered_scenes, video_files), 1):
        dur = _ff.get_duration(str(vf))
        dur_str = f"{dur:.1f}s" if dur else "??s"
        if dur:
            total_dur += dur
        print(f"    {i}. [{scene['type']:>10}] scene_{scene['scene_number']} -> {vf.name} ({dur_str})")

    print(f"\n  Estimated total: {total_dur:.1f}s")
    print()


def run_stitch(
    videos_dir: Path,
    video_files: list[Path],
    output_path: Path,
    preset: str,
    audio_path: str | None,
    dry_run: bool,
    verbose: bool,
) -> bool:
    """Call stitch_video.py via subprocess."""
    stitch_script = SCRIPTS_DIR / "stitch_video.py"
    if not stitch_script.exists():
        logger.error("stitch_video.py not found at %s", stitch_script)
        return False

    # Build comma-separated scene list
    scenes_csv = ",".join(str(vf) for vf in video_files)

    cmd = [
        sys.executable, str(stitch_script),
        "--scenes", scenes_csv,
        "--output", str(output_path),
        "--videos-dir", str(videos_dir),
        "--variations", "1",
    ]

    # Apply audio preset
    if preset == "ugc":
        preset_config = AUDIO_PRESETS.get("ugc", AUDIO_PRESETS["default"])
        cmd.extend(["--music-volume", str(preset_config["music_volume"])])
        cmd.extend(["--video-volume", str(preset_config["video_volume"])])
        cmd.extend(["--music-fade-out", str(preset_config["music_fade_out"])])
    elif preset == "presenter":
        cmd.append("--presenter")
    elif preset == "narrated":
        cmd.append("--narrated")

    if audio_path:
        cmd.extend(["--audio", audio_path])

    if dry_run:
        cmd.append("--dry-run")

    if verbose:
        cmd.append("--verbose")

    logger.info("Running stitch_video.py...")
    logger.debug("Command: %s", " ".join(cmd))

    result = subprocess.run(cmd, cwd=str(SCRIPTS_DIR))
    return result.returncode == 0


def run_subtitles(
    video_path: Path,
    subtitle_style: str,
    verbose: bool,
) -> bool:
    """Call add_subtitles.py via subprocess on the stitched output."""
    subtitle_script = SCRIPTS_DIR / "add_subtitles.py"
    if not subtitle_script.exists():
        logger.warning("add_subtitles.py not found at %s — skipping subtitles", subtitle_script)
        return False

    cmd = [
        sys.executable, str(subtitle_script),
        "--input", str(video_path),
        "--style", subtitle_style,
        "--output", str(video_path),  # overwrite in-place
    ]

    if verbose:
        cmd.append("--verbose")

    logger.info("Adding subtitles with style '%s'...", subtitle_style)
    result = subprocess.run(cmd, cwd=str(SCRIPTS_DIR))
    return result.returncode == 0


def update_campaign_manifest(
    project_dir: Path,
    script_id: str,
    output_path: Path,
    success: bool,
) -> None:
    """Update campaign_manifest.json with the stitch result."""
    manifest_path = project_dir / "campaign_manifest.json"

    if not manifest_path.exists():
        raise CampaignManifestError(f"Campaign manifest not found: {manifest_path}")

    with open(manifest_path) as f:
        manifest = json.load(f)

    # Update the script entry — handle both list and dict formats
    scripts = manifest.get("scripts", {})
    if isinstance(scripts, list):
        # Convert list to dict keyed by script_id
        scripts_dict: dict = {}
        for s in scripts:
            if isinstance(s, dict) and "script_id" in s:
                scripts_dict[s["script_id"]] = s
        scripts = scripts_dict

    if script_id not in scripts:
        scripts[script_id] = {}

    scripts[script_id]["stitched"] = success
    scripts[script_id]["output_path"] = str(output_path) if success else None
    scripts[script_id]["status"] = "stitched" if success else "stitch_failed"

    manifest["scripts"] = scripts

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    logger.info("Updated campaign manifest: %s -> %s",
                script_id, "stitched" if success else "stitch_failed")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="UGC-specific video stitching with belief script awareness"
    )

    parser.add_argument("--project", required=True,
                        help="Project slug (required)")
    parser.add_argument("--script-id", required=True,
                        help="Belief script ID, e.g. 'belief_1' (required)")
    parser.add_argument("--videos-dir",
                        help="Override videos directory (default: projects/{slug}/videos)")
    parser.add_argument("--audio",
                        help="Background music file (optional)")
    parser.add_argument("--output",
                        help="Output path (default: projects/{slug}/final/{script_id}_ugc.mp4)")
    parser.add_argument("--subtitle-style",
                        choices=["ugc-bold", "ugc-minimal", "ugc-tiktok", "ugc-caption"],
                        default="ugc-bold",
                        help="Subtitle style (default: ugc-bold)")
    parser.add_argument("--auto-subtitle", action="store_true",
                        help="Automatically add subtitles after stitching")
    parser.add_argument("--update-manifest", action="store_true",
                        help="Update campaign manifest with completion status")
    parser.add_argument("--preset",
                        choices=["ugc", "presenter", "narrated"],
                        default="ugc",
                        help="Audio preset (default: ugc)")
    parser.add_argument("--yes", "-y", action="store_true",
                        help="Skip confirmation prompts")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be done without executing")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Re-initialize logger with verbose flag
    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    # Resolve project directory
    project_dir = Path(PROJECT_BASE) / args.project
    if not project_dir.exists():
        logger.error("Project directory not found: %s", project_dir)
        sys.exit(1)

    # Resolve videos directory
    videos_dir = Path(args.videos_dir) if args.videos_dir else project_dir / "videos"
    if not videos_dir.exists():
        logger.error("Videos directory not found: %s", videos_dir)
        sys.exit(1)

    # Resolve script path
    script_path = project_dir / "scripts" / f"{args.script_id}.json"
    script = load_belief_script(script_path)

    # Order scenes by UGC structure
    ordered_scenes = order_scenes_by_ugc(script["scenes"])
    logger.info("Ordered %d scenes by UGC structure", len(ordered_scenes))

    # Find video files for each scene
    video_files: list[Path] = []
    missing: list[int] = []
    for scene in ordered_scenes:
        scene_num = scene["scene_number"]
        vf = find_video_file(videos_dir, scene_num)
        if vf is None:
            missing.append(scene_num)
        else:
            video_files.append(vf)

    if missing:
        logger.error(
            "Missing video files for scenes: %s in %s",
            ", ".join(str(s) for s in missing),
            videos_dir,
        )
        sys.exit(1)

    # Resolve output path
    if args.output:
        output_path = Path(args.output)
    else:
        final_dir = project_dir / "final"
        final_dir.mkdir(parents=True, exist_ok=True)
        output_path = final_dir / f"{args.script_id}_ugc.mp4"

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Print summary
    print_stitch_summary(
        script_id=args.script_id,
        ordered_scenes=ordered_scenes,
        video_files=video_files,
        output_path=output_path,
        preset=args.preset,
        audio_path=args.audio,
        auto_subtitle=args.auto_subtitle,
        subtitle_style=args.subtitle_style,
    )

    # Confirm unless --yes or --dry-run
    if not args.yes and not args.dry_run:
        confirm = input("Proceed with stitch? [y/N] ").strip().lower()
        if confirm not in ("y", "yes"):
            print("Aborted.")
            sys.exit(0)

    # Run stitch
    stitch_ok = run_stitch(
        videos_dir=videos_dir,
        video_files=video_files,
        output_path=output_path,
        preset=args.preset,
        audio_path=args.audio,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )

    if args.dry_run:
        logger.info("Dry-run complete. No files were modified.")
        return

    if not stitch_ok:
        logger.error("Stitch failed")
        if args.update_manifest:
            update_campaign_manifest(project_dir, args.script_id, output_path, success=False)
        sys.exit(1)

    if not output_path.exists():
        logger.error("Stitch reported success but output not found: %s", output_path)
        if args.update_manifest:
            update_campaign_manifest(project_dir, args.script_id, output_path, success=False)
        sys.exit(1)

    logger.info("Stitched video: %s", output_path)

    # Auto-subtitle
    if args.auto_subtitle:
        subtitle_ok = run_subtitles(
            video_path=output_path,
            subtitle_style=args.subtitle_style,
            verbose=args.verbose,
        )
        if not subtitle_ok:
            logger.warning("Subtitle generation failed — stitched video still available")

    # Update manifest
    if args.update_manifest:
        update_campaign_manifest(project_dir, args.script_id, output_path, success=True)

    total_dur = estimate_total_duration(video_files)
    print(f"\nDone. Output: {output_path} ({total_dur:.1f}s)")


if __name__ == "__main__":
    main()
