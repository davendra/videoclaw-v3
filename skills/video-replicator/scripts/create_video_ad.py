#!/usr/bin/env python3
"""
End-to-end video ad creation from local assets.

Orchestrates the full video creation pipeline:
1. Upload assets to Go Bananas (characters, products)
2. Generate first-frame images
3. Download images locally
4. Generate videos with veo-cli
5. Stitch final video with audio

This script is designed for CREATE mode where you're building
a video from scratch (no reference video to copy).

Usage:
    # Full pipeline with characters and product
    python create_video_ad.py \
        --project "summer-sandals" \
        --product "./input/sandals.jpg:Gold strappy sandals with rhinestone details" \
        --characters "./input/model.jpg:Sofia:Young blonde woman, beach casual" \
        --scenes "product hero shot" "Sofia walking on beach" "close-up sandals" "sunset pose" \
        --prompts "slow push in on product" "tracking shot, walking left" "static detail" "orbit around" \
        --aspect landscape \
        --audio "./audio/background.mp3"

    # Dry-run to see what would happen
    python create_video_ad.py \
        --project "test-ad" \
        --scenes "scene 1" "scene 2" \
        --dry-run

    # From config file
    python create_video_ad.py --config "./project_config.json"

Requirements:
    pip install requests pillow

Environment:
    GO_BANANAS_API_KEY - For REST API (optional, uses MCP if not set)
    GOOGLE_API_KEY - For Gemini analysis (if using analyze mode)
    VEO_CLI_PATH - Path to veo-cli (default: auto-detected)
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from logging_config import setup_logging

# Logger configured in main() with --verbose flag; default INFO for library use
logger = setup_logging(__name__)

# ============================================================================
# Configuration
# ============================================================================
from config import PROJECT_BASE as DEFAULT_PROJECT_BASE, VEO_CLI_PATH as DEFAULT_VEO_PATH
from upload_to_gobananas import (
    upload_and_create_character,
    upload_and_create_product,
)
from utils_preflight import print_preflight_results, validate_preflight
from utils_project import ensure_project_dirs
from utils_video import count_scene_videos

# ============================================================================
# Asset Upload Phase
# ============================================================================


def upload_assets(
    characters: list[dict],
    product: dict | None,
    api_key: str | None = None
) -> dict:
    """
    Upload all assets to Go Bananas and create references.

    Args:
        characters: List of {"path": str, "name": str, "description": str}
        product: {"path": str, "name": str, "description": str} or None
        api_key: Go Bananas API key

    Returns:
        {
            "success": bool,
            "characters": [{"name": str, "character_id": int, "hosted_url": str}],
            "product": {"name": str, "product_id": int, "hosted_url": str} or None,
            "errors": [str]
        }
    """
    result = {
        "success": True,
        "characters": [],
        "product": None,
        "errors": []
    }

    logger.info("=" * 60)
    logger.info("Phase 1: Asset Upload")
    logger.info("=" * 60)

    # Upload characters
    for char in characters:
        logger.info(f"Uploading character: {char['name']}")
        char_result = upload_and_create_character(
            image_path=char["path"],
            name=char["name"],
            base_prompt=char.get("base_prompt", char["description"]),
            description=char["description"],
            api_key=api_key
        )
        if char_result.get("success"):
            result["characters"].append({
                "name": char["name"],
                "character_id": char_result.get("character_id"),
                "hosted_url": char_result.get("hosted_url"),
            })
        else:
            result["errors"].append(f"Character '{char['name']}': {char_result.get('error')}")

    # Upload product
    if product:
        logger.info(f"Uploading product: {product['name']}")
        prod_result = upload_and_create_product(
            image_path=product["path"],
            name=product["name"],
            description=product["description"],
            api_key=api_key
        )
        if prod_result.get("success"):
            result["product"] = {
                "name": product["name"],
                "product_id": prod_result.get("product_id"),
                "hosted_url": prod_result.get("hosted_url"),
            }
        else:
            result["errors"].append(f"Product '{product['name']}': {prod_result.get('error')}")

    result["success"] = len(result["errors"]) == 0

    return result


# ============================================================================
# Image Generation Phase (Placeholder - requires MCP)
# ============================================================================


def generate_scene_images_instructions(
    scenes: list[str],
    refs: dict,
    aspect: str,
    output_dir: str
) -> dict:
    """
    Generate instructions for creating scene images with Go Bananas MCP.

    Note: This function returns instructions since Go Bananas image generation
    requires MCP tools (not REST API). The actual generation should be done
    via Claude's MCP tools.

    Returns:
        {
            "instructions": [str],
            "mcp_calls": [{"tool": str, "params": dict}]
        }
    """
    result = {
        "instructions": [],
        "mcp_calls": [],
    }

    # Determine which tool to use
    has_character = bool(refs.get("characters"))
    has_product = bool(refs.get("product"))

    for i, scene_prompt in enumerate(scenes, 1):
        params = {
            "prompt": scene_prompt,
            "aspect_ratio": aspect,
            "model_id": "gemini-pro-image",
        }
        if has_character:
            char = refs["characters"][0]
            params["character_id"] = char.get("character_id")
            result["instructions"].append(
                f"Scene {i}: Use generate_image with "
                f"character_id={char.get('character_id')}, prompt='{scene_prompt}', "
                f"aspect_ratio='{aspect}', model_id='gemini-pro-image'"
            )
        elif has_product:
            prod = refs["product"]
            params["product_id"] = prod.get("product_id")
            result["instructions"].append(
                f"Scene {i}: Use generate_image with "
                f"product_id={prod.get('product_id')}, prompt='{scene_prompt}', "
                f"aspect_ratio='{aspect}', model_id='gemini-pro-image'"
            )
        else:
            result["instructions"].append(
                f"Scene {i}: Use generate_image with "
                f"prompt='{scene_prompt}', aspect_ratio='{aspect}', "
                f"model_id='gemini-pro-image'"
            )
        result["mcp_calls"].append({
            "tool": "mcp__go-bananas__generate_image",
            "params": params,
        })

    return result


# ============================================================================
# Video Generation Phase
# ============================================================================


def generate_videos(
    output_dir: str,
    scenes_prompts: dict[str, str],
    aspect: str,
    veo_path: str = DEFAULT_VEO_PATH,
    quality: str = "fast",
    dry_run: bool = False
) -> dict:
    """
    Generate videos via veo-cli.

    Args:
        output_dir: Project output directory (with images/ and videos/ subdirs)
        scenes_prompts: Dict mapping scene number to motion prompt
        aspect: "landscape" or "portrait"
        veo_path: Path to veo-cli
        quality: "fast" or "quality"
        dry_run: If True, just validate without generating

    Returns:
        {"success": bool, "videos": [str], "errors": [str]}
    """
    images_dir = os.path.join(output_dir, "images")
    videos_dir = os.path.join(output_dir, "videos")
    os.makedirs(videos_dir, exist_ok=True)

    # Convert scenes to JSON string
    scenes_json = json.dumps(scenes_prompts)

    cmd = [
        "python",
        os.path.join(Path(__file__).parent, "parallel_video_gen.py"),
        "--product", Path(output_dir).name,
        "--project-base", str(Path(output_dir).parent),
        "--mode", "frames-to-video",
        "--images-dir", images_dir,
        "--scenes", scenes_json,
        "--ratio", aspect,
        "--quality", quality,
        "--veo-path", veo_path,
    ]

    if dry_run:
        cmd.append("--dry-run")

    logger.info("=" * 60)
    logger.info("Phase 4: Video Generation")
    logger.info("=" * 60)
    logger.info("Running: parallel_video_gen.py")
    logger.info("Mode: frames-to-video")
    logger.info(f"Scenes: {list(scenes_prompts.keys())}")
    logger.info(f"Quality: {quality}")
    logger.info(f"Aspect: {aspect}")

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1800  # 30 minute timeout for all scenes
        )

        # Log output
        if proc.stdout:
            for line in proc.stdout.rstrip().split("\n"):
                logger.info(line)
        if proc.stderr:
            for line in proc.stderr.rstrip().split("\n"):
                logger.warning(line)

        if proc.returncode == 0:
            # Count generated videos
            video_count = count_scene_videos(videos_dir)
            return {
                "success": True,
                "videos_dir": videos_dir,
                "count": video_count["total"],
                "errors": []
            }
        else:
            return {
                "success": False,
                "videos_dir": videos_dir,
                "count": 0,
                "errors": [f"parallel_video_gen.py failed with exit code {proc.returncode}"]
            }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "videos_dir": videos_dir,
            "count": 0,
            "errors": ["Video generation timed out after 30 minutes"]
        }
    except Exception as e:
        return {
            "success": False,
            "videos_dir": videos_dir,
            "count": 0,
            "errors": [str(e)]
        }


# ============================================================================
# Stitch Phase
# ============================================================================


def stitch_video(
    output_dir: str,
    audio_path: str | None = None,
    output_filename: str = "final_ad.mp4",
    dual: bool = True
) -> dict:
    """
    Stitch final video from scene videos.

    Args:
        output_dir: Project output directory
        audio_path: Path to background music file
        output_filename: Name for final video
        dual: If True, create both primary and alt versions

    Returns:
        {"success": bool, "output": str, "errors": [str]}
    """
    videos_dir = os.path.join(output_dir, "videos")
    final_dir = os.path.join(output_dir, "final")
    os.makedirs(final_dir, exist_ok=True)

    output_path = os.path.join(final_dir, output_filename)

    cmd = [
        "python",
        os.path.join(Path(__file__).parent, "stitch_video.py"),
        "--videos-dir", videos_dir,
        "--output", output_path,
    ]

    if audio_path and os.path.exists(audio_path):
        cmd.extend(["--audio", audio_path])

    if dual:
        cmd.append("--dual")

    logger.info("=" * 60)
    logger.info("Phase 6: Stitch Final Video")
    logger.info("=" * 60)
    logger.info("Running: stitch_video.py")
    logger.info(f"Videos dir: {videos_dir}")
    logger.info(f"Audio: {audio_path or 'None'}")
    logger.info(f"Dual output: {dual}")

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )

        if proc.stdout:
            for line in proc.stdout.rstrip().split("\n"):
                logger.info(line)
        if proc.stderr:
            for line in proc.stderr.rstrip().split("\n"):
                logger.warning(line)

        if proc.returncode == 0:
            return {
                "success": True,
                "output": output_path,
                "errors": []
            }
        else:
            return {
                "success": False,
                "output": output_path,
                "errors": [f"stitch_video.py failed with exit code {proc.returncode}"]
            }
    except Exception as e:
        return {
            "success": False,
            "output": output_path,
            "errors": [str(e)]
        }


# ============================================================================
# Config File Support
# ============================================================================


def load_config(config_path: str) -> dict:
    """Load project configuration from JSON file."""
    with open(config_path) as f:
        return json.load(f)


def parse_asset_string(asset_str: str, asset_type: str = "character") -> dict:
    """
    Parse asset string from command line.

    Format: "path:name:description" or "path:description" (for products)

    Returns:
        {"path": str, "name": str, "description": str}
    """
    parts = asset_str.split(":", 2)
    if asset_type == "character":
        if len(parts) >= 3:
            return {"path": parts[0], "name": parts[1], "description": parts[2]}
        elif len(parts) == 2:
            return {"path": parts[0], "name": Path(parts[0]).stem, "description": parts[1]}
        else:
            return {"path": parts[0], "name": Path(parts[0]).stem, "description": ""}
    else:  # product
        if len(parts) >= 2:
            return {"path": parts[0], "name": Path(parts[0]).stem, "description": parts[1]}
        else:
            return {"path": parts[0], "name": Path(parts[0]).stem, "description": ""}


# ============================================================================
# Main Orchestration
# ============================================================================


def run_full_pipeline(
    project_name: str,
    characters: list[dict],
    product: dict | None,
    scenes: list[str],
    motion_prompts: list[str],
    aspect: str = "landscape",
    audio_path: str | None = None,
    veo_path: str = DEFAULT_VEO_PATH,
    project_base: str = DEFAULT_PROJECT_BASE,
    quality: str = "fast",
    dry_run: bool = False,
    skip_upload: bool = False,
    skip_images: bool = False,
    skip_videos: bool = False,
    skip_stitch: bool = False,
) -> dict:
    """
    Run the full video creation pipeline.

    Pipeline phases:
    1. Pre-flight validation
    2. Asset upload (characters, products)
    3. Image generation (instructions for MCP)
    4. Video generation (veo-cli)
    5. Stitch final video

    Returns:
        {
            "success": bool,
            "project_dir": str,
            "phases": {phase_name: phase_result},
            "errors": [str]
        }
    """
    result = {
        "success": False,
        "project_dir": None,
        "phases": {},
        "errors": []
    }

    api_key = os.environ.get("GO_BANANAS_API_KEY")

    logger.info("=" * 60)
    logger.info(f"CREATE VIDEO AD: {project_name}")
    logger.info("=" * 60)
    logger.info(f"Characters: {len(characters)}")
    logger.info(f"Product: {product['name'] if product else 'None'}")
    logger.info(f"Scenes: {len(scenes)}")
    logger.info(f"Aspect: {aspect}")
    logger.info(f"Dry run: {dry_run}")

    # Phase 0: Create project directories
    dirs = ensure_project_dirs(project_base, project_name)
    result["project_dir"] = dirs["root"]

    # Phase 0.5: Pre-flight validation
    preflight = validate_preflight(
        project_base=project_base,
        product_name=project_name,
        mode="t2v" if skip_images else "i2v",
        check_images=not skip_images,
        check_veo=not skip_videos,
        veo_path=veo_path
    )
    result["phases"]["preflight"] = preflight
    print_preflight_results(preflight)

    if not preflight["passed"] and not dry_run:
        result["errors"].append("Pre-flight validation failed")
        return result

    # Phase 1: Upload assets
    if not skip_upload:
        upload_result = upload_assets(characters, product, api_key)
        result["phases"]["upload"] = upload_result
        if not upload_result["success"]:
            result["errors"].extend(upload_result["errors"])
            logger.warning("Some assets failed to upload. Continue with MCP tools.")

    # Phase 2-3: Image generation (instructions only)
    refs = result["phases"].get("upload", {})
    image_instructions = generate_scene_images_instructions(
        scenes=scenes,
        refs={
            "characters": refs.get("characters", []),
            "product": refs.get("product"),
        },
        aspect="16:9" if aspect == "landscape" else "9:16",
        output_dir=dirs["images"]
    )
    result["phases"]["image_instructions"] = image_instructions

    if not skip_images:
        logger.info("=" * 60)
        logger.info("Phase 2-3: Image Generation")
        logger.info("=" * 60)
        logger.info("Use Go Bananas MCP tools to generate first-frame images:")
        for instr in image_instructions["instructions"]:
            logger.info(f"  - {instr}")
        logger.info(f"Save images to: {dirs['images']}")
        logger.info("Naming: scene_1_frame.png, scene_2_frame.png, etc.")

        if not dry_run:
            logger.info("[Waiting for images to be generated via MCP...]")
            logger.info("Run the MCP commands above, then re-run with --skip-images")

            # Check if images already exist
            existing_images = list(Path(dirs["images"]).glob("scene_*_frame.*"))
            if existing_images:
                logger.info(f"Found {len(existing_images)} existing images:")
                for img in existing_images:
                    logger.info(f"  - {img.name}")

    # Phase 4: Video generation
    if not skip_videos and not skip_images:
        # Build scene prompts dict
        scenes_prompts = {}
        for i, prompt in enumerate(motion_prompts, 1):
            scenes_prompts[str(i)] = prompt

        if dry_run:
            logger.info("[DRY RUN] Would generate videos:")
            for scene_num, prompt in scenes_prompts.items():
                logger.info(f"  Scene {scene_num}: {prompt[:50]}...")
            video_result = {"success": True, "dry_run": True}
        else:
            video_result = generate_videos(
                output_dir=dirs["root"],
                scenes_prompts=scenes_prompts,
                aspect=aspect,
                veo_path=veo_path,
                quality=quality,
                dry_run=dry_run
            )
        result["phases"]["video_generation"] = video_result

        if not video_result.get("success"):
            result["errors"].extend(video_result.get("errors", []))

    # Phase 5: Stitch
    if not skip_stitch and not skip_videos and not skip_images:
        if dry_run:
            logger.info("[DRY RUN] Would stitch final video:")
            logger.info(f"Output: {dirs['final']}/final_ad.mp4")
            stitch_result = {"success": True, "dry_run": True}
        else:
            stitch_result = stitch_video(
                output_dir=dirs["root"],
                audio_path=audio_path,
                output_filename="final_ad.mp4",
                dual=True
            )
        result["phases"]["stitch"] = stitch_result

        if not stitch_result.get("success"):
            result["errors"].extend(stitch_result.get("errors", []))

    # Final status
    result["success"] = len(result["errors"]) == 0

    logger.info("=" * 60)
    logger.info("Pipeline Complete")
    logger.info("=" * 60)
    logger.info(f"Project: {result['project_dir']}")
    logger.info(f"Success: {result['success']}")
    if result["errors"]:
        logger.error("Errors:")
        for err in result["errors"]:
            logger.error(f"  - {err}")
    logger.info("=" * 60)

    return result


# ============================================================================
# CLI Entry Point
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="End-to-end video ad creation from local assets",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Full pipeline
    python create_video_ad.py \\
        --project "summer-sandals" \\
        --product "./sandals.jpg:Gold strappy sandals" \\
        --characters "./model.jpg:Sofia:Young blonde woman" \\
        --scenes "product hero" "Sofia walking" "detail shot" "final pose" \\
        --prompts "push in" "tracking left" "static" "orbit" \\
        --aspect landscape \\
        --audio "./music.mp3"

    # Dry run
    python create_video_ad.py \\
        --project "test" \\
        --scenes "scene 1" "scene 2" \\
        --prompts "motion 1" "motion 2" \\
        --dry-run

    # From config file
    python create_video_ad.py --config "./project.json"
        """
    )

    # Project settings
    parser.add_argument("--project", required=True, help="Project name (slug)")
    parser.add_argument("--project-base", default=DEFAULT_PROJECT_BASE,
                        help="Base directory for projects")

    # Assets
    parser.add_argument("--product", help="Product: path:description")
    parser.add_argument("--characters", nargs="+",
                        help="Characters: path:name:description (can specify multiple)")

    # Scenes
    parser.add_argument("--scenes", nargs="+", required=True,
                        help="Scene descriptions for image generation")
    parser.add_argument("--prompts", nargs="+",
                        help="Motion prompts for video generation (one per scene)")

    # Video settings
    parser.add_argument("--aspect", choices=["landscape", "portrait"], default="landscape",
                        help="Video aspect ratio")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast",
                        help="Video quality")
    parser.add_argument("--audio", help="Path to background music file")

    # veo-cli
    parser.add_argument("--veo-path", default=DEFAULT_VEO_PATH, help="Path to veo-cli")

    # Pipeline control
    parser.add_argument("--skip-upload", action="store_true", help="Skip asset upload phase")
    parser.add_argument("--skip-images", action="store_true", help="Skip image generation phase")
    parser.add_argument("--skip-videos", action="store_true", help="Skip video generation phase")
    parser.add_argument("--skip-stitch", action="store_true", help="Skip final stitch phase")
    parser.add_argument("--dry-run", action="store_true", help="Validate without running")

    # Config file
    parser.add_argument("--config", help="Load settings from JSON config file")

    # Output
    parser.add_argument("--output", "-o", help="Output JSON file for results")

    # Logging
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Reconfigure logger level with verbose flag
    if args.verbose:
        import logging
        logger.setLevel(logging.DEBUG)
        for handler in logger.handlers:
            handler.setLevel(logging.DEBUG)

    # Parse assets from command line
    characters = []
    if args.characters:
        for char_str in args.characters:
            characters.append(parse_asset_string(char_str, "character"))

    product = None
    if args.product:
        product = parse_asset_string(args.product, "product")

    # Default motion prompts to scene descriptions if not provided
    motion_prompts = args.prompts or args.scenes

    # Run pipeline
    result = run_full_pipeline(
        project_name=args.project,
        characters=characters,
        product=product,
        scenes=args.scenes,
        motion_prompts=motion_prompts,
        aspect=args.aspect,
        audio_path=args.audio,
        veo_path=args.veo_path,
        project_base=args.project_base,
        quality=args.quality,
        dry_run=args.dry_run,
        skip_upload=args.skip_upload,
        skip_images=args.skip_images,
        skip_videos=args.skip_videos,
        skip_stitch=args.skip_stitch,
    )

    # Save results
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2, default=str)
        logger.info(f"Results saved to: {args.output}")

    # Exit code
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
