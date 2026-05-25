#!/usr/bin/env python3
"""
Image Review and Auto-Regeneration Script.

Phase 3b: Reviews generated images for quality issues and automatically
regenerates failures using Go Bananas MCP.

This script:
1. Analyzes all scene images using Gemini Vision API
2. Auto-approves high-quality images (>= 0.85 score)
3. Flags medium-quality images for manual review (0.65-0.84)
4. Auto-regenerates low-quality images (< 0.65) with retry loop
5. Preserves character/product context for consistent regeneration

Usage:
    # Review all images (dry-run)
    python review_images.py --project "{slug}" --dry-run

    # Review and auto-regenerate failures
    python review_images.py --project "{slug}" --auto-regenerate

    # With character reference
    python review_images.py --project "{slug}" --auto-regenerate --character-id 27

    # Custom thresholds
    python review_images.py --project "{slug}" --approve-threshold 0.9 --regen-threshold 0.7

Requirements:
    pip install google-genai Pillow requests

Environment:
    GOOGLE_API_KEY - Required for Gemini Vision analysis
    GO_BANANAS_API_KEY - Required for regeneration (optional if --mcp-output)

Output:
    Creates/updates projects/{slug}/review_state.json with:
    - Individual image scores
    - Regeneration history
    - Overall status (approved/pending_review/pending_regeneration)
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# Script directory for relative imports
SCRIPT_DIR = Path(__file__).parent
PROJECT_BASE = SCRIPT_DIR.parent.parent.parent.parent / "projects"

sys.path.insert(0, str(SCRIPT_DIR))

from image_analyzer import ImageAnalyzer, QualityScore, print_quality_report
from regenerate_images import (
    load_review_state,
    print_mcp_command,
    print_structured_mcp_command,
    regenerate_scene,
    save_review_state,
)
from utils_project import get_project_dirs

try:
    from gobananas_prompts import GoBananasPromptBuilder
except ImportError:
    GoBananasPromptBuilder = None


# ============================================================================
# Configuration
# ============================================================================

# Realistic thresholds for AI-generated images
# - Anatomy issues are the main concern (50% weight)
# - Prompt adherence often low due to prompt mismatch (10% weight)
DEFAULT_APPROVE_THRESHOLD = 0.75
DEFAULT_REGEN_THRESHOLD = 0.50
DEFAULT_MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 5


# ============================================================================
# Image Discovery
# ============================================================================


def find_scene_images(images_dir: str) -> dict[int, str]:
    """
    Find all scene frame images in directory.

    Returns:
        Dict mapping scene number to image path
    """
    images = {}
    images_path = Path(images_dir)

    if not images_path.exists():
        return images

    # Look for scene_N_frame.* pattern (with optional _portrait suffix)
    patterns = [
        r"scene_(\d+)_frame(_portrait)?\.(?:jpg|jpeg|png|webp)",
        r"scene_(\d+)\.(?:jpg|jpeg|png|webp)",
    ]

    for file in images_path.iterdir():
        if not file.is_file():
            continue

        for pattern in patterns:
            match = re.match(pattern, file.name, re.IGNORECASE)
            if match:
                scene_num = int(match.group(1))
                # Prefer portrait version if exists
                if scene_num in images and "_portrait" not in file.name:
                    continue
                images[scene_num] = str(file)
                break

    return images


def load_prompts_from_state(state: dict) -> dict[int, str]:
    """
    Extract prompts from review state.

    Args:
        state: Review state dictionary

    Returns:
        Dict mapping scene number to prompt
    """
    prompts = {}
    data = state.get("data", {})

    # Try different prompt locations
    if "prompts" in data:
        prompts = {int(k): v for k, v in data["prompts"].items()}
    elif "scenes" in data:
        for scene in data["scenes"]:
            scene_num = scene.get("scene_number")
            if scene_num and "prompt" in scene:
                prompts[scene_num] = scene["prompt"]

    return prompts


def load_prompts_from_analysis(project_name: str) -> dict[int, str]:
    """
    Load prompts from SEALCAM analysis file.

    Falls back to rewritten prompts if available.
    """
    project_dir = PROJECT_BASE / project_name
    prompts = {}

    # Try rewritten prompts first
    rewritten_path = project_dir / "analysis" / "rewritten_prompts.json"
    if rewritten_path.exists():
        with open(rewritten_path) as f:
            data = json.load(f)
            if "prompts" in data:
                prompts = {int(k): v for k, v in data["prompts"].items()}
                return prompts

    # Fall back to SEALCAM analysis
    analysis_path = project_dir / "analysis" / "sealcam_analysis.json"
    if analysis_path.exists():
        with open(analysis_path) as f:
            data = json.load(f)
            for scene in data.get("scenes", []):
                scene_num = scene.get("scene_number")
                if scene_num:
                    # Build prompt from SEALCAM data
                    subject = scene.get("subject", {})
                    action = scene.get("action", {})
                    prompt_parts = []

                    if isinstance(subject, dict):
                        prompt_parts.append(subject.get("appearance", ""))
                    if isinstance(action, dict):
                        prompt_parts.append(action.get("primary", ""))

                    prompts[scene_num] = " ".join(filter(None, prompt_parts))

    return prompts


# ============================================================================
# Review State Management
# ============================================================================


def create_review_state(
    project_name: str,
    image_scores: dict[int, QualityScore],
    prompts: dict[int, str],
    target_ratio: str,
) -> dict:
    """
    Create or update review state with analysis results.

    Args:
        project_name: Project slug
        image_scores: Dict mapping scene number to QualityScore
        prompts: Dict mapping scene number to prompt
        target_ratio: Target aspect ratio

    Returns:
        Review state dictionary
    """
    # Load existing state or create new
    state = load_review_state(project_name) or {
        "project": project_name,
        "created_at": datetime.now().isoformat(),
        "data": {}
    }

    state["updated_at"] = datetime.now().isoformat()
    state["phase"] = "3b_review"

    # Store prompts
    state["data"]["prompts"] = {str(k): v for k, v in prompts.items()}
    state["data"]["target_ratio"] = target_ratio

    # Store image analysis results
    state["data"]["images"] = []
    approved = []
    needs_review = []
    needs_regeneration = []

    for scene_num in sorted(image_scores.keys()):
        score = image_scores[scene_num]
        image_data = score.to_dict()

        if score.approved:
            approved.append(scene_num)
            image_data["status"] = "approved"
        elif score.needs_review:
            needs_review.append(scene_num)
            image_data["status"] = "needs_review"
        else:
            needs_regeneration.append(scene_num)
            image_data["status"] = "needs_regeneration"

        state["data"]["images"].append(image_data)

    # Store categorized lists
    state["approved_scenes"] = approved
    state["review_scenes"] = needs_review
    state["regenerate_scenes"] = needs_regeneration

    # Determine overall status
    if needs_regeneration:
        state["status"] = "pending_regeneration"
        state["message"] = f"{len(needs_regeneration)} scenes need regeneration"
    elif needs_review:
        state["status"] = "pending_review"
        state["message"] = f"{len(needs_review)} scenes need manual review"
    else:
        state["status"] = "approved"
        state["message"] = "All images approved"

    return state


def update_regeneration_history(state: dict, scene_num: int, attempt: int, success: bool) -> dict:
    """
    Track regeneration attempts in state.

    Args:
        state: Review state dictionary
        scene_num: Scene number
        attempt: Attempt number (1-based)
        success: Whether regeneration succeeded
    """
    if "regeneration_history" not in state:
        state["regeneration_history"] = {}

    scene_key = str(scene_num)
    if scene_key not in state["regeneration_history"]:
        state["regeneration_history"][scene_key] = []

    state["regeneration_history"][scene_key].append({
        "attempt": attempt,
        "timestamp": datetime.now().isoformat(),
        "success": success
    })

    return state


# ============================================================================
# Review Workflow
# ============================================================================


def review_images(
    project_name: str,
    target_ratio: str = "portrait",
    approve_threshold: float = DEFAULT_APPROVE_THRESHOLD,
    regen_threshold: float = DEFAULT_REGEN_THRESHOLD,
    dry_run: bool = False,
) -> tuple[dict[int, QualityScore], dict]:
    """
    Run image quality review.

    Args:
        project_name: Project slug
        target_ratio: Target aspect ratio
        approve_threshold: Minimum score for auto-approval
        regen_threshold: Maximum score for auto-regeneration
        dry_run: If True, don't save state

    Returns:
        Tuple of (image_scores dict, review_state dict)
    """
    print(f"\n{'='*60}")
    print(f"IMAGE QUALITY REVIEW - {project_name}")
    print(f"{'='*60}")
    print(f"Target ratio: {target_ratio}")
    print(f"Approve threshold: {approve_threshold}")
    print(f"Regenerate threshold: {regen_threshold}")

    # Check API key
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("\nError: GOOGLE_API_KEY environment variable not set")
        sys.exit(1)

    # Find images
    project_dirs = get_project_dirs(str(PROJECT_BASE), project_name)
    images_dir = project_dirs["images"]
    scene_images = find_scene_images(images_dir)

    if not scene_images:
        print(f"\nNo scene images found in {images_dir}")
        sys.exit(1)

    print(f"Found {len(scene_images)} scene images")

    # Load prompts
    state = load_review_state(project_name) or {}
    prompts = load_prompts_from_state(state)

    if not prompts:
        prompts = load_prompts_from_analysis(project_name)

    if not prompts:
        print("\nWarning: No prompts found. Quality analysis may be limited.")
        prompts = dict.fromkeys(scene_images.keys(), "Scene image")

    # Run analysis
    print(f"\n{'='*60}")
    print("ANALYZING IMAGES")
    print(f"{'='*60}")

    analyzer = ImageAnalyzer(api_key=api_key)
    image_paths = list(scene_images.values())
    image_scores = analyzer.analyze_batch(image_paths, prompts, target_ratio)

    # Print report
    print_quality_report(image_scores)

    # Create review state
    review_state = create_review_state(project_name, image_scores, prompts, target_ratio)

    # Save state
    if not dry_run:
        save_review_state(project_name, review_state)
        print(f"\nState saved to: projects/{project_name}/review_state.json")
    else:
        print("\n[DRY RUN] State not saved")

    return image_scores, review_state


def regeneration_loop(
    project_name: str,
    image_scores: dict[int, QualityScore],
    target_ratio: str = "portrait",
    character_id: int | None = None,
    product_id: int | None = None,
    max_retries: int = DEFAULT_MAX_RETRIES,
    api_key: str | None = None,
    mcp_output: bool = False,
    dry_run: bool = False,
) -> dict:
    """
    Run regeneration loop for failed images.

    Args:
        project_name: Project slug
        image_scores: Dict mapping scene number to QualityScore
        target_ratio: Target aspect ratio
        character_id: Go Bananas character ID
        product_id: Go Bananas product ID
        max_retries: Maximum regeneration attempts per scene
        api_key: Go Bananas API key
        mcp_output: Output MCP commands instead of calling API
        dry_run: Don't actually regenerate

    Returns:
        Result dict with regeneration stats
    """
    # Get scenes to regenerate
    to_regenerate = [
        scene_num for scene_num, score in image_scores.items()
        if score.should_regenerate
    ]

    if not to_regenerate:
        print("\nNo images need regeneration")
        return {"success": True, "regenerated": [], "failed": []}

    print(f"\n{'='*60}")
    print("REGENERATION LOOP")
    print(f"{'='*60}")
    print(f"Scenes to regenerate: {to_regenerate}")
    print(f"Max retries per scene: {max_retries}")

    if mcp_output:
        print("\n[MCP OUTPUT MODE] Printing MCP commands for Claude to execute\n")

    # Load state for prompts
    state = load_review_state(project_name) or {"data": {}}
    prompts = state.get("data", {}).get("prompts", {})

    # Load gobananas structured prompts if available
    gobananas_prompts = state.get("data", {}).get("gobananas_prompts", {})

    # Try to load from rewritten_prompts.json if not in state
    if not gobananas_prompts:
        rewritten_path = PROJECT_BASE / project_name / "analysis" / "rewritten_prompts.json"
        if rewritten_path.exists():
            with open(rewritten_path) as f:
                rewritten_data = json.load(f)
                for scene in rewritten_data.get("scenes", []):
                    scene_num = scene.get("scene_number")
                    if scene_num and "gobananas" in scene:
                        gobananas_prompts[str(scene_num)] = scene["gobananas"]

    # Normalize aspect ratio for MCP
    aspect_ratio_map = {
        "portrait": "9:16",
        "landscape": "16:9",
        "square": "1:1",
    }
    aspect_ratio = aspect_ratio_map.get(target_ratio.lower(), target_ratio)

    # Track results
    results = {
        "success": True,
        "regenerated": [],
        "failed": [],
        "attempts": {}
    }

    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")

    for scene_num in to_regenerate:
        print(f"\n--- Scene {scene_num} ---")
        prompt = prompts.get(str(scene_num), "")
        gb_prompt = gobananas_prompts.get(str(scene_num), {})

        if not prompt and not gb_prompt:
            print(f"  Warning: No prompt found for scene {scene_num}")
            results["failed"].append(scene_num)
            continue

        success = False
        attempts = 0

        for attempt in range(1, max_retries + 1):
            attempts = attempt
            print(f"\n  Attempt {attempt}/{max_retries}")

            if mcp_output:
                # Prefer structured gobananas output for MCP commands
                if gb_prompt:
                    print_structured_mcp_command(
                        gobananas_config=gb_prompt,
                        aspect_ratio=aspect_ratio,
                        character_id=character_id,
                        product_id=product_id,
                        scene_num=scene_num
                    )
                else:
                    # Fallback to legacy prompt format
                    print_mcp_command(prompt, aspect_ratio, character_id, product_id, scene_num)
                print("  [MCP] Execute the above command, then re-run review")
                break

            if dry_run:
                print(f"  [DRY RUN] Would regenerate with prompt: {prompt[:60]}...")
                break

            # Regenerate
            regen_result = regenerate_scene(
                project_name=project_name,
                scene_num=scene_num,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                character_id=character_id,
                product_id=product_id,
                api_key=api_key,
                dry_run=False
            )

            if regen_result:
                # Re-analyze the new image
                print("  Re-analyzing regenerated image...")
                analyzer = ImageAnalyzer()
                new_score = analyzer.analyze_image(
                    regen_result.get("path", ""),
                    prompt,
                    target_ratio,
                    scene_num
                )

                if new_score.approved:
                    print(f"  SUCCESS: New score {new_score.weighted_score:.2f} (approved)")
                    success = True
                    image_scores[scene_num] = new_score
                    break
                elif new_score.needs_review:
                    print(f"  IMPROVED: New score {new_score.weighted_score:.2f} (needs review)")
                    image_scores[scene_num] = new_score
                    # Continue trying to get approved quality
                else:
                    print(f"  STILL FAILING: New score {new_score.weighted_score:.2f}")

                # Delay before next attempt
                if attempt < max_retries:
                    print(f"  Waiting {RETRY_DELAY_SECONDS}s before next attempt...")
                    time.sleep(RETRY_DELAY_SECONDS)
            else:
                print("  Regeneration failed")
                if attempt < max_retries:
                    time.sleep(RETRY_DELAY_SECONDS)

            # Update state with attempt
            state = update_regeneration_history(state, scene_num, attempt, success)
            save_review_state(project_name, state)

        results["attempts"][scene_num] = attempts

        if success:
            results["regenerated"].append(scene_num)
        else:
            results["failed"].append(scene_num)
            results["success"] = False

    # Summary
    print(f"\n{'='*60}")
    print("REGENERATION SUMMARY")
    print(f"{'='*60}")
    print(f"  Regenerated successfully: {len(results['regenerated'])} {results['regenerated']}")
    print(f"  Failed after retries:     {len(results['failed'])} {results['failed']}")

    if results["failed"]:
        print(f"\n  WARNING: {len(results['failed'])} scenes still failing")
        print("  Manual intervention required for these scenes")

    # Update final state
    if not dry_run and not mcp_output:
        final_state = create_review_state(project_name, image_scores,
                                          {int(k): v for k, v in prompts.items()},
                                          target_ratio)
        final_state["regeneration_history"] = state.get("regeneration_history", {})
        save_review_state(project_name, final_state)

    print(f"{'='*60}\n")

    return results


# ============================================================================
# Main Entry Point
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Review generated images and auto-regenerate failures",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Review all images (dry-run)
    python review_images.py --project prada-rampatel --dry-run

    # Review and auto-regenerate failures
    python review_images.py --project prada-rampatel --auto-regenerate

    # With character reference for consistent regeneration
    python review_images.py --project prada-rampatel --auto-regenerate --character-id 27

    # Output MCP commands for Claude to execute
    python review_images.py --project prada-rampatel --auto-regenerate --mcp-output

    # Custom thresholds
    python review_images.py --project prada-rampatel \\
        --approve-threshold 0.9 --regen-threshold 0.7
        """
    )

    parser.add_argument("--project", "-p", required=True,
                        help="Project name/slug")
    parser.add_argument("--ratio", "-r", default="portrait",
                        choices=["portrait", "landscape", "square"],
                        help="Target aspect ratio (default: portrait)")
    parser.add_argument("--approve-threshold", type=float, default=DEFAULT_APPROVE_THRESHOLD,
                        help=f"Minimum score for auto-approval (default: {DEFAULT_APPROVE_THRESHOLD})")
    parser.add_argument("--regen-threshold", type=float, default=DEFAULT_REGEN_THRESHOLD,
                        help=f"Maximum score for auto-regeneration (default: {DEFAULT_REGEN_THRESHOLD})")
    parser.add_argument("--auto-regenerate", "-a", action="store_true",
                        help="Automatically regenerate failed images")
    parser.add_argument("--max-retries", type=int, default=DEFAULT_MAX_RETRIES,
                        help=f"Maximum regeneration attempts per scene (default: {DEFAULT_MAX_RETRIES})")
    parser.add_argument("--character-id", "-c", type=int,
                        help="Go Bananas character ID for regeneration")
    parser.add_argument("--product-id", type=int,
                        help="Go Bananas product ID for regeneration")
    parser.add_argument("--api-key",
                        help="Go Bananas API key (or set GO_BANANAS_API_KEY env)")
    parser.add_argument("--mcp-output", "-m", action="store_true",
                        help="Output MCP commands for Claude instead of calling API")
    parser.add_argument("--dry-run", "-n", action="store_true",
                        help="Show what would be done without making changes")

    args = parser.parse_args()

    # Run review
    image_scores, review_state = review_images(
        project_name=args.project,
        target_ratio=args.ratio,
        approve_threshold=args.approve_threshold,
        regen_threshold=args.regen_threshold,
        dry_run=args.dry_run,
    )

    # Check if regeneration needed
    if args.auto_regenerate and review_state.get("regenerate_scenes"):
        regen_result = regeneration_loop(
            project_name=args.project,
            image_scores=image_scores,
            target_ratio=args.ratio,
            character_id=args.character_id,
            product_id=args.product_id,
            max_retries=args.max_retries,
            api_key=args.api_key,
            mcp_output=args.mcp_output,
            dry_run=args.dry_run,
        )

        if not regen_result["success"]:
            print("\nSome images still need manual intervention")
            sys.exit(1)
    elif review_state.get("regenerate_scenes"):
        print(f"\nNote: {len(review_state['regenerate_scenes'])} scenes need regeneration")
        print("Run with --auto-regenerate to fix them automatically")

    # Final status
    if review_state.get("status") == "approved":
        print("\nAll images approved! Ready for Phase 4 (video generation)")
        sys.exit(0)
    elif review_state.get("status") == "pending_review":
        print(f"\n{len(review_state.get('review_scenes', []))} scenes need manual review")
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
