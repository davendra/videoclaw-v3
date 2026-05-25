#!/usr/bin/env python3
"""
Batch Image Generation via Go Bananas

Generates N images per scene for multi-variation video production.
Supports both interactive (MCP commands) and batch (URL download) modes.

This script:
1. Reads scene data from rewritten_prompts.json or sealcam_analysis.json
2. Builds prompts using gobananas_prompts.py
3. Either outputs MCP commands for Claude to execute (--output-commands)
   or downloads images from provided URLs (--download-from)

Usage:
    # Generate MCP commands for Claude to execute
    python generate_images.py \
        --project "brand-campaign" \
        --analysis "projects/.../analysis/rewritten_prompts.json" \
        --variations 3 \
        --character-id 27 \
        --output-commands

    # Download images from Go Bananas URLs (after generation)
    python generate_images.py \
        --project "brand-campaign" \
        --variations 3 \
        --download-from "urls.json"

    # Dry-run to see what would be generated
    python generate_images.py \
        --project "brand-campaign" \
        --analysis "projects/.../analysis/rewritten_prompts.json" \
        --variations 3 \
        --dry-run
"""

import argparse
import json
import os
import sys
from typing import Any

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from exceptions import ManifestError, ProjectError, ValidationError
from logging_config import setup_logging

# Logger configured in main() with --verbose flag; default INFO for library use
logger = setup_logging(__name__)

from gobananas_prompts import (
    analyze_all_scenes_character_match,
    build_gobananas_prompt,
    get_prompt_simplification_summary,
    print_character_match_report,
    simplify_prompt_for_character,
    validate_prompt_for_character,
)
from utils_download import download_image
from utils_image import (
    PORTRAIT_HEIGHT,
    PORTRAIT_WIDTH,
    crop_landscape_to_portrait,
    get_image_dimensions,
)
from utils_project import (
    get_current_run_id,
    get_project_dirs,
    get_run_subdir,
    increment_run,
)
from utils_variation import get_variation_suffix, print_cost_estimate

# ============================================================================
# Constants
# ============================================================================

PROJECTS_BASE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "..", "..", "projects"
)


# ============================================================================
# Prompt Building
# ============================================================================

def load_scene_data(analysis_path: str) -> dict:
    """
    Load scene data from analysis or rewritten prompts file.

    Args:
        analysis_path: Path to JSON file with scene data

    Returns:
        Dict with scenes data
    """
    if not os.path.exists(analysis_path):
        raise ProjectError(f"Analysis file not found: {analysis_path}")

    with open(analysis_path) as f:
        data = json.load(f)

    return data


def extract_scenes(data: dict) -> list[dict]:
    """
    Extract scenes array from analysis data.

    Handles both formats:
    - SEALCAM+ analysis: {"sealcam_analysis": {"scenes": [...]}}
    - Rewritten prompts: {"scenes": [...]}
    - Direct scenes array: [...]

    Args:
        data: Loaded JSON data

    Returns:
        List of scene dictionaries
    """
    # Handle rewritten_prompts.json format
    if "scenes" in data:
        return data["scenes"]

    # Handle SEALCAM+ analysis format
    if "sealcam_analysis" in data:
        analysis = data["sealcam_analysis"]
        if "scenes" in analysis:
            return analysis["scenes"]

    # Handle direct scenes array
    if isinstance(data, list):
        return data

    # Try to find scenes anywhere in the structure
    for _key, value in data.items():
        if isinstance(value, dict) and "scenes" in value:
            return value["scenes"]

    raise ManifestError("Could not find scenes in analysis data")


def build_prompts_for_scene(
    scene: dict,
    scene_number: int,
    character_id: int | None = None,
    character_ids: list[int] | None = None,
    product_id: int | None = None,
    aspect_ratio: str = "9:16",
) -> dict[str, Any]:
    """
    Build Go Bananas prompt for a single scene.

    Args:
        scene: Scene data dictionary
        scene_number: Scene number (1-based)
        character_id: Single character ID
        character_ids: Multiple character IDs (2-5)
        product_id: Product ID
        aspect_ratio: Target aspect ratio

    Returns:
        Dict with MCP parameters
    """
    # Add scene number to scene data
    scene["scene_number"] = scene_number

    # Build prompt using gobananas_prompts module
    prompt = build_gobananas_prompt(
        scene=scene,
        character_id=character_id,
        character_ids=character_ids,
        product_id=product_id,
        aspect_ratio=aspect_ratio,
    )

    # Get MCP-ready dict
    if character_ids and len(character_ids) >= 2:
        return prompt.to_mcp_dict()
    elif character_id:
        return prompt.to_mcp_dict(character_id=character_id)
    elif product_id:
        return prompt.to_mcp_dict(product_id=product_id)
    else:
        return prompt.to_mcp_dict()


# ============================================================================
# MCP Command Generation
# ============================================================================

def generate_mcp_commands(
    scenes: list[dict],
    variations: int,
    character_id: int | None = None,
    character_ids: list[int] | None = None,
    product_id: int | None = None,
    aspect_ratio: str = "9:16",
    run_id: str = "run001",
    use_run_dirs: bool = False,
    strict_prompts: bool = False,
) -> list[dict]:
    """
    Generate MCP commands for all scenes and variations.

    Args:
        scenes: List of scene data dictionaries
        variations: Number of variations per scene (1-4)
        character_id: Single character ID
        character_ids: Multiple character IDs
        product_id: Product ID
        aspect_ratio: Target aspect ratio
        run_id: Run ID prefix for file naming
        use_run_dirs: If True, don't include run prefix in filenames
        strict_prompts: If True, auto-simplify prompts for character refs

    Returns:
        List of command dictionaries with scene/variation info
    """
    commands = []

    for scene_num, scene in enumerate(scenes, 1):
        # Build base prompt for this scene
        prompt_dict = build_prompts_for_scene(
            scene=scene,
            scene_number=scene_num,
            character_id=character_id,
            character_ids=character_ids,
            product_id=product_id,
            aspect_ratio=aspect_ratio,
        )

        # Auto-simplify prompt if using character_id and strict_prompts enabled
        if strict_prompts and character_id and "prompt" in prompt_dict:
            original_prompt = prompt_dict["prompt"]
            simplified_prompt = simplify_prompt_for_character(original_prompt)
            prompt_dict["prompt"] = simplified_prompt

        # Generate command for each variation
        for v in range(1, variations + 1):
            suffix = get_variation_suffix(v, variations)
            # When use_run_dirs=True, files go in runs/{run_id}/images/ so don't need run prefix
            if use_run_dirs:
                filename = f"scene_{scene_num}_frame{suffix}.png"
            else:
                filename = f"{run_id}_scene_{scene_num}_frame{suffix}.png"

            command = {
                "scene_number": scene_num,
                "variation": v,
                "filename": filename,
                "mcp_params": prompt_dict,
                "mcp_command": format_mcp_command(prompt_dict),
            }
            commands.append(command)

    return commands


def format_mcp_command(params: dict[str, Any]) -> str:
    """
    Format MCP parameters as a callable command string.

    Args:
        params: MCP parameter dictionary

    Returns:
        Formatted MCP command string
    """
    lines = ["mcp__go-bananas__generate_image("]

    for key, value in params.items():
        if isinstance(value, str):
            # Escape quotes in strings
            escaped = value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ')
            lines.append(f'    {key}="{escaped}",')
        elif isinstance(value, list):
            lines.append(f'    {key}={value},')
        elif isinstance(value, bool):
            lines.append(f'    {key}={str(value).lower()},')
        elif value is not None:
            lines.append(f'    {key}={value},')

    lines.append(")")
    return "\n".join(lines)


def output_commands(commands: list[dict], output_file: str | None = None) -> None:
    """
    Output MCP commands to console or file.

    Args:
        commands: List of command dictionaries
        output_file: Optional output file path
    """
    output = {
        "total_images": len(commands),
        "commands": commands,
    }

    if output_file:
        with open(output_file, "w") as f:
            json.dump(output, f, indent=2)
        logger.info(f"Saved {len(commands)} commands to: {output_file}")
    else:
        logger.info("=" * 60)
        logger.info("MCP Commands for Image Generation")
        logger.info("=" * 60)

        for cmd in commands:
            logger.info(f"Scene {cmd['scene_number']}, Variation {cmd['variation']} | Filename: {cmd['filename']}")
            logger.debug(cmd["mcp_command"])

        logger.info("=" * 60)
        logger.info(f"Total: {len(commands)} images to generate")
        logger.info("=" * 60)


# ============================================================================
# Image Download
# ============================================================================

def download_images_from_urls(
    urls_file: str,
    output_dir: str,
    run_id: str,
    variations: int,
    auto_crop: bool = True,
    target_ratio: str = "portrait",
    use_run_dirs: bool = False,
) -> list[str]:
    """
    Download images from Go Bananas URLs.

    Expected JSON format:
    {
        "images": [
            {"scene": 1, "variation": 1, "url": "https://..."},
            {"scene": 1, "variation": 2, "url": "https://..."},
            ...
        ]
    }

    OR simple array:
    [
        {"scene": 1, "variation": 1, "url": "https://..."},
        ...
    ]

    Args:
        urls_file: Path to JSON file with image URLs
        output_dir: Directory to save images
        run_id: Run ID prefix for file naming
        variations: Expected number of variations
        auto_crop: Whether to auto-crop to portrait
        target_ratio: Target aspect ratio
        use_run_dirs: If True, don't include run prefix in filenames

    Returns:
        List of downloaded file paths
    """
    with open(urls_file) as f:
        data = json.load(f)

    # Handle both formats
    if isinstance(data, list):
        images = data
    elif "images" in data:
        images = data["images"]
    else:
        raise ValidationError("Expected 'images' array in URL file")

    os.makedirs(output_dir, exist_ok=True)
    downloaded = []

    for img_data in images:
        scene_num = img_data.get("scene", img_data.get("scene_number"))
        variation = img_data.get("variation", 1)
        url = img_data.get("url")

        if not url:
            logger.warning(f"No URL for scene {scene_num}, variation {variation}")
            continue

        suffix = get_variation_suffix(variation, variations)
        # When use_run_dirs=True, files go in runs/{run_id}/images/ so don't need run prefix
        if use_run_dirs:
            filename = f"scene_{scene_num}_frame{suffix}.png"
        else:
            filename = f"{run_id}_scene_{scene_num}_frame{suffix}.png"
        filepath = os.path.join(output_dir, filename)

        logger.info(f"Downloading scene {scene_num} v{variation}: {url[:60]}...")
        if download_image(url, filepath):
            downloaded.append(filepath)
            logger.info(f"Saved: {filepath}")

            # Post-download aspect ratio validation
            try:
                from utils_validation import validate_aspect_ratio

                ar_result = validate_aspect_ratio(filepath, target_ratio)
                if not ar_result["valid"]:
                    logger.warning(
                        f"Scene {scene_num} v{variation} aspect ratio mismatch: "
                        f"{ar_result['width']}x{ar_result['height']} "
                        f"(ratio {ar_result['actual_ratio']:.3f}, "
                        f"expected {ar_result['expected_ratio']:.4f} {target_ratio}). "
                        f"Deviation {ar_result['deviation']:.1%}. "
                        f"Consider re-generating with stronger aspect ratio hints."
                    )
            except Exception:
                pass  # Never block downloads due to validation issues

            # Auto-crop if needed
            if auto_crop and target_ratio == "portrait":
                dims = get_image_dimensions(filepath)
                if dims and (dims[0] != PORTRAIT_WIDTH or dims[1] != PORTRAIT_HEIGHT):
                    logger.info(f"Processing to portrait ({PORTRAIT_WIDTH}x{PORTRAIT_HEIGHT})...")
                    crop_landscape_to_portrait(filepath)
        else:
            logger.error(f"FAILED to download scene {scene_num} v{variation}")

    return downloaded


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Generate first-frame images via Go Bananas for multi-variation video production",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate MCP commands for 3 variations
  python generate_images.py --project brand-campaign --variations 3 --character-id 27 --output-commands

  # Dry-run to see cost estimate
  python generate_images.py --project brand-campaign --variations 3 --dry-run

  # Download images from URLs after generation
  python generate_images.py --project brand-campaign --variations 3 --download-from urls.json
        """
    )

    # Project/analysis
    parser.add_argument(
        "--project", "-p",
        required=True,
        help="Project slug or full path to project directory"
    )
    parser.add_argument(
        "--analysis", "-a",
        help="Path to analysis/rewritten_prompts.json (auto-detected if not specified)"
    )

    # Variation control
    parser.add_argument(
        "--variations", "-v",
        type=int,
        default=2,
        choices=[1, 2, 3, 4],
        help="Number of image variations per scene (default: 2)"
    )

    # Reference IDs
    parser.add_argument(
        "--character-id", "-c",
        type=int,
        help="Go Bananas character ID for character generation"
    )
    parser.add_argument(
        "--character-ids",
        type=str,
        help="Comma-separated character IDs for multi-character scenes (e.g., '27,42,56')"
    )
    parser.add_argument(
        "--product-id",
        type=int,
        help="Go Bananas product ID for product generation"
    )

    # Aspect ratio
    parser.add_argument(
        "--aspect-ratio", "-r",
        default="9:16",
        choices=["9:16", "16:9", "1:1", "portrait", "landscape", "square"],
        help="Target aspect ratio (default: 9:16)"
    )

    # Mode selection
    parser.add_argument(
        "--output-commands",
        action="store_true",
        help="Output MCP commands for Claude to execute"
    )
    parser.add_argument(
        "--commands-file",
        help="Save commands to JSON file instead of console"
    )
    parser.add_argument(
        "--download-from",
        help="Download images from URLs in specified JSON file"
    )

    # Processing options
    parser.add_argument(
        "--auto-crop",
        action="store_true",
        default=True,
        help="Auto-crop downloaded images to portrait (default: enabled)"
    )
    parser.add_argument(
        "--no-auto-crop",
        action="store_true",
        help="Disable auto-crop of downloaded images"
    )

    # Run control
    parser.add_argument(
        "--fresh",
        action="store_true",
        default=True,
        help="Start new run (default)"
    )
    parser.add_argument(
        "--continue",
        dest="continue_run",
        action="store_true",
        help="Continue current run"
    )
    parser.add_argument(
        "--run",
        help="Use specific run ID (e.g., 'run001')"
    )

    # Run isolation (new directory structure)
    parser.add_argument(
        "--use-run-dirs",
        action="store_true",
        help="Use new run subdirectory structure: runs/{run_id}/images/. "
             "Files don't have run prefix in names."
    )

    # Character match analysis
    parser.add_argument(
        "--check-character-match",
        action="store_true",
        help="Analyze scenes for character/age mismatches before generation. "
             "Requires --character-id and fetches character info from Go Bananas."
    )
    parser.add_argument(
        "--character-base-prompt",
        help="Base prompt describing the character (for character match analysis). "
             "If not provided, will attempt to fetch from Go Bananas."
    )

    # Prompt simplification for character references
    parser.add_argument(
        "--strict-prompts",
        action="store_true",
        help="Validate and auto-simplify prompts when using character_id. "
             "Removes appearance descriptions (names, expressions, age) that "
             "cause Go Bananas to ignore the character reference."
    )
    parser.add_argument(
        "--warn-verbose-prompts",
        action="store_true",
        default=True,
        help="Warn about verbose prompts that may override character refs (default: enabled)"
    )
    parser.add_argument(
        "--no-warn-verbose-prompts",
        action="store_true",
        help="Disable warnings about verbose prompts"
    )

    # Utility flags
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be generated without actually generating"
    )
    parser.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Skip confirmation prompts"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose/debug logging"
    )

    args = parser.parse_args()

    # Reconfigure logger level with verbose flag
    if args.verbose:
        import logging
        logger.setLevel(logging.DEBUG)
        for handler in logger.handlers:
            handler.setLevel(logging.DEBUG)

    # Resolve project path
    if os.path.isabs(args.project) or os.path.exists(args.project):
        project_path = args.project
    else:
        # Look for project in projects directory
        projects_dir = os.path.abspath(PROJECTS_BASE)
        matching = [
            d for d in os.listdir(projects_dir)
            if args.project in d
        ]
        if matching:
            project_path = os.path.join(projects_dir, sorted(matching)[-1])
        else:
            project_path = os.path.join(projects_dir, args.project)

    # Normalize aspect ratio
    aspect_map = {
        "portrait": "9:16",
        "landscape": "16:9",
        "square": "1:1",
    }
    aspect_ratio = aspect_map.get(args.aspect_ratio, args.aspect_ratio)

    # Parse character_ids if provided
    character_ids = None
    if args.character_ids:
        character_ids = [int(x.strip()) for x in args.character_ids.split(",")]

    # Handle auto-crop
    auto_crop = args.auto_crop and not args.no_auto_crop

    logger.info("=" * 60)
    logger.info("Go Bananas Image Generation")
    logger.info("=" * 60)
    logger.info(f"Project: {project_path}")
    logger.info(f"Variations: {args.variations}")
    logger.info(f"Aspect Ratio: {aspect_ratio}")

    if args.character_id:
        logger.info(f"Character ID: {args.character_id}")
    if character_ids:
        logger.info(f"Character IDs: {character_ids}")
    if args.product_id:
        logger.info(f"Product ID: {args.product_id}")

    # Download mode
    if args.download_from:
        logger.info("Download Mode")
        logger.info(f"URLs file: {args.download_from}")
        logger.debug(f"Use run dirs: {args.use_run_dirs}")

        # Get run ID
        run_id = args.run or get_current_run_id(project_path)

        # Determine images directory
        if args.use_run_dirs:
            # Use run subdirectory: runs/{run_id}/images/
            images_dir = get_run_subdir(project_path, run_id, "images")
        else:
            # Legacy flat structure: images/
            dirs = get_project_dirs(PROJECTS_BASE, os.path.basename(project_path))
            images_dir = dirs.get("images", os.path.join(project_path, "images"))

        if args.dry_run:
            logger.info(f"[DRY RUN] Would download to: {images_dir}")
            logger.info(f"[DRY RUN] Run ID: {run_id}")
            return

        downloaded = download_images_from_urls(
            urls_file=args.download_from,
            output_dir=images_dir,
            run_id=run_id,
            variations=args.variations,
            auto_crop=auto_crop,
            target_ratio="portrait" if aspect_ratio == "9:16" else "landscape",
            use_run_dirs=args.use_run_dirs,
        )

        logger.info(f"Downloaded {len(downloaded)} images to {images_dir}")
        return

    # Command generation mode - need analysis file
    analysis_path = args.analysis
    if not analysis_path:
        # Auto-detect analysis file
        analysis_dir = os.path.join(project_path, "analysis")
        for candidate in ["rewritten_prompts.json", "sealcam_analysis.json"]:
            candidate_path = os.path.join(analysis_dir, candidate)
            if os.path.exists(candidate_path):
                analysis_path = candidate_path
                break

    if not analysis_path or not os.path.exists(analysis_path):
        logger.error("Analysis file not found. Specify with --analysis or ensure it exists at:")
        logger.error(f"  {os.path.join(project_path, 'analysis', 'rewritten_prompts.json')}")
        logger.error(f"  {os.path.join(project_path, 'analysis', 'sealcam_analysis.json')}")
        sys.exit(1)

    logger.info(f"Analysis: {analysis_path}")

    # Load scene data
    data = load_scene_data(analysis_path)
    scenes = extract_scenes(data)
    num_scenes = len(scenes)

    logger.info(f"Scenes: {num_scenes}")

    # Character match analysis (explicit flag OR auto-detect during dry-run)
    # Auto-runs during --dry-run when --character-id is set so users always
    # see variant warnings before committing to image generation.
    run_character_match = args.check_character_match or (args.character_id and args.dry_run)

    if run_character_match:
        if not args.character_id:
            logger.error("--check-character-match requires --character-id")
            sys.exit(1)

        if args.check_character_match:
            logger.info("Character Match Analysis")
        else:
            logger.info("Character Match Analysis (auto-detected: --character-id with --dry-run)")

        # Build character info
        # Note: In production, you'd fetch this from Go Bananas via MCP
        # For now, use provided base_prompt or a placeholder
        character_info = {
            "name": f"Character {args.character_id}",
            "character_id": args.character_id,
            "base_prompt": getattr(args, 'character_base_prompt', '') or '',
            "description": "",
        }

        if not args.character_base_prompt:
            logger.info("Note: No --character-base-prompt provided.")
            logger.info("For accurate analysis, provide the character's base prompt.")
            logger.info("Example: --character-base-prompt '18 year old Ram Patel Indian...'")
            logger.info("Without it, analysis will only detect explicit age requirements in scenes.")

        try:
            # Run analysis
            analysis = analyze_all_scenes_character_match(scenes, character_info)

            # Print report
            print_character_match_report(analysis)

            # Check for mismatches
            if analysis['mismatches'] > 0:
                logger.warning("")
                logger.warning("Character variants may be needed for %d scene(s).", analysis['mismatches'])
                logger.warning("Recommended: Create variants before image generation.")
                logger.warning("Needed variants: %s", ', '.join(analysis['needed_variants']) or 'None detected')
                logger.warning("")
                logger.warning("Create variants with: python character_variants.py --analyze \\")
                logger.warning("  --analysis <analysis_file> --character-id %d", args.character_id)
                logger.warning("")

                if args.dry_run:
                    logger.info("[DRY RUN] Character match analysis complete.")
                    # Don't return here during auto-detect dry-run — continue to
                    # show the rest of the dry-run output (commands, cost estimate)
                    if args.check_character_match:
                        return

                if not args.dry_run and not args.yes:
                    response = input("\nContinue with image generation anyway? [y/N] ")
                    if response.lower() != "y":
                        logger.info("Aborted. Create variants first using the MCP commands above.")
                        return
            else:
                logger.info("Character match: All scenes compatible with character %d", args.character_id)

            if args.dry_run and args.check_character_match:
                return
        except ImportError:
            logger.debug("Character match analysis skipped: gobananas_prompts not available")
        except Exception as e:
            logger.debug("Character match check failed: %s", e)

    # Prompt validation for character references
    warn_verbose = args.warn_verbose_prompts and not args.no_warn_verbose_prompts
    if args.character_id and (warn_verbose or args.strict_prompts):
        logger.info("Prompt Validation for Character Reference")
        all_warnings = []
        scenes_with_issues = []

        for scene_num, scene in enumerate(scenes, 1):
            # Build the prompt that would be generated
            prompt_dict = build_prompts_for_scene(
                scene=scene,
                scene_number=scene_num,
                character_id=args.character_id,
                character_ids=character_ids,
                product_id=args.product_id,
                aspect_ratio=aspect_ratio,
            )
            prompt_text = prompt_dict.get("prompt", "")

            # Validate the prompt
            warnings = validate_prompt_for_character(prompt_text, args.character_id)
            if warnings:
                scenes_with_issues.append(scene_num)
                all_warnings.extend([(scene_num, w) for w in warnings])

                if args.strict_prompts:
                    # Auto-simplify the prompt
                    original = prompt_text
                    simplified = simplify_prompt_for_character(prompt_text)
                    summary = get_prompt_simplification_summary(original, simplified)
                    logger.info(f"Scene {scene_num}: {summary}")
                    logger.debug(f"Scene {scene_num} Original: {original[:100]}...")
                    logger.debug(f"Scene {scene_num} Simplified: {simplified[:100]}...")
                else:
                    logger.warning(f"Scene {scene_num}:")
                    for warning in warnings:
                        logger.warning(f"  {warning}")

        if all_warnings:
            logger.warning(f"Found {len(scenes_with_issues)} scene(s) with verbose prompts: {scenes_with_issues}")
            if args.strict_prompts:
                logger.info("Prompts will be auto-simplified before generation.")
            else:
                logger.info("Tip: Use --strict-prompts to auto-simplify, or see references/character-prompts.md")

            if not args.yes and not args.strict_prompts:
                response = input("\nContinue anyway? (Verbose prompts may cause character ref to be ignored) [y/N] ")
                if response.lower() != "y":
                    logger.info("Aborted. Review prompts and use --strict-prompts to auto-fix.")
                    return
        else:
            logger.info("All prompts are action-focused. Character reference should work correctly.")

    # Get or create run ID
    if args.run:
        run_id = args.run
    elif args.continue_run:
        run_id = get_current_run_id(project_path)
    else:
        # Fresh run
        if args.dry_run:
            run_id = "run001"  # Placeholder for dry run
        else:
            run_id = increment_run(project_path, {
                "type": "image_generation",
                "variations": args.variations,
            })

    logger.info(f"Run ID: {run_id}")

    # Cost estimate
    print_cost_estimate(
        num_scenes=num_scenes,
        variations=args.variations,
        mode="frames-to-video",  # Image generation is for I2V mode
        quality="fast"  # Go Bananas doesn't have quality tiers
    )

    if args.dry_run:
        logger.info("[DRY RUN] Would generate the following commands:")

    # Generate commands
    commands = generate_mcp_commands(
        scenes=scenes,
        variations=args.variations,
        character_id=args.character_id,
        character_ids=character_ids,
        product_id=args.product_id,
        aspect_ratio=aspect_ratio,
        run_id=run_id,
        use_run_dirs=args.use_run_dirs,
        strict_prompts=args.strict_prompts,
    )

    if args.dry_run:
        # Show first command as example
        if commands:
            logger.info("Example (Scene 1, Variation 1):")
            logger.info(commands[0]["mcp_command"])
            logger.info(f"... and {len(commands) - 1} more commands")
        logger.info(f"[DRY RUN] Total: {len(commands)} images would be generated")
        return

    # Confirmation prompt
    if not args.yes and not args.output_commands:
        response = input(f"\nGenerate {len(commands)} images? [y/N] ")
        if response.lower() != "y":
            logger.info("Aborted.")
            return

    # Output commands
    output_commands(commands, args.commands_file)

    # Instructions for Claude
    logger.info("=" * 60)
    logger.info("Next Steps")
    logger.info("=" * 60)
    logger.info("1. Copy the MCP commands above and execute them in Claude Code")
    logger.info("2. For each command, Claude will call mcp__go-bananas__generate_image")
    logger.info("3. Download the generated images to the project's images/ folder")
    logger.info("4. Use the image URLs to create a urls.json file")
    logger.info(f'5. Then run: python generate_images.py --project "{args.project}" --download-from urls.json')


if __name__ == "__main__":
    main()
