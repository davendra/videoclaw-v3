#!/usr/bin/env python3
"""
Style Transfer Automation — Go Bananas reference_images + reference_mode workflow.

Automates the process of applying a visual style from reference images onto
generated scene images using Go Bananas reference groups. Ideal for:
- Matching architectural renders (exterior/interior)
- Consistent illustration or art direction
- Brand style consistency across scenes

Workflow:
1. Host reference images (local paths → catbox.moe/imgbb/freeimage)
2. Create Go Bananas reference_group with hosted URLs
3. For each scene, output a generate_image MCP command with reference_group_id
4. Optionally download results and save with correct run prefix naming

Usage:
    # Output MCP commands for style-transferred scenes
    python style_transfer.py \
      --project "5bhk-villa" \
      --reference-images "renders/exterior.jpg,renders/interior.jpg" \
      --reference-mode style \
      --scenes-json "projects/5bhk-villa/analysis/sealcam_analysis.json" \
      --output-dir "projects/5bhk-villa/images"

    # With existing reference group (skip hosting/creation)
    python style_transfer.py \
      --project "5bhk-villa" \
      --reference-group-id 42 \
      --reference-mode style \
      --scenes-json "projects/5bhk-villa/analysis/sealcam_analysis.json" \
      --output-dir "projects/5bhk-villa/images"

    # Dry-run to preview commands
    python style_transfer.py \
      --project "5bhk-villa" \
      --reference-images "renders/exterior.jpg" \
      --scenes-json "projects/5bhk-villa/analysis/sealcam_analysis.json" \
      --dry-run

    # From scene prompts dict (no analysis file)
    python style_transfer.py \
      --project "5bhk-villa" \
      --reference-group-id 42 \
      --scene-prompts '{"1":"Villa exterior at sunset","2":"Modern living room"}' \
      --aspect-ratio "16:9" \
      --output-dir "projects/5bhk-villa/images"

Requirements:
    pip install requests
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from gobananas_prompts import GoBananasPromptBuilder
from upload_to_gobananas import host_image


# ============================================================================
# Reference Group Management
# ============================================================================


def host_reference_images(image_paths: list[str]) -> list[str]:
    """
    Host local reference images and return public URLs.

    Args:
        image_paths: List of local image paths

    Returns:
        List of hosted URLs (only successful uploads)
    """
    hosted_urls = []

    for i, path in enumerate(image_paths, 1):
        path = path.strip()
        if not path:
            continue

        # Already a URL
        if path.startswith("http://") or path.startswith("https://"):
            print(f"  [{i}/{len(image_paths)}] Already hosted: {path}")
            hosted_urls.append(path)
            continue

        # Local file
        if not os.path.exists(path):
            print(f"  [{i}/{len(image_paths)}] WARNING: File not found: {path}")
            continue

        print(f"  [{i}/{len(image_paths)}] Hosting: {path}")
        url = host_image(path)
        if url:
            hosted_urls.append(url)
        else:
            print(f"  WARNING: Failed to host {path}")

    return hosted_urls


def output_create_reference_group_command(
    group_name: str,
    hosted_urls: list[str],
) -> str:
    """
    Output MCP command to create a Go Bananas reference group.

    Args:
        group_name: Name for the reference group
        hosted_urls: List of hosted image URLs

    Returns:
        Formatted MCP command string
    """
    urls_str = json.dumps(hosted_urls)
    return (
        f"mcp__go-bananas__create_reference_group(\n"
        f'    name="{group_name}",\n'
        f"    reference_images={urls_str}\n"
        f")"
    )


def output_scene_commands(
    scenes: dict[str, str],
    reference_group_id: int,
    reference_mode: str,
    aspect_ratio: str,
    project: str,
) -> list[str]:
    """
    Output MCP generate_image commands for each scene.

    Args:
        scenes: Dict of {scene_number: prompt}
        reference_group_id: Go Bananas reference group ID
        reference_mode: "style" or "add_to_image"
        aspect_ratio: Target aspect ratio
        project: Project name for output naming

    Returns:
        List of MCP command strings
    """
    commands = []

    for scene_num in sorted(scenes.keys(), key=lambda x: int(x)):
        prompt = scenes[scene_num]
        cmd = (
            f"# Scene {scene_num}\n"
            f"mcp__go-bananas__generate_image(\n"
            f'    prompt="{prompt}",\n'
            f"    reference_group_id={reference_group_id},\n"
            f'    reference_mode="{reference_mode}",\n'
            f'    aspect_ratio="{aspect_ratio}",\n'
            f'    model_id="gemini-pro-image"\n'
            f")"
        )
        commands.append(cmd)

    return commands


def output_scene_commands_from_analysis(
    analysis: dict,
    reference_group_id: int,
    reference_mode: str,
    aspect_ratio: str,
) -> list[str]:
    """
    Output MCP commands using SEALCAM+ analysis data.

    Uses GoBananasPromptBuilder.build_style_transfer_prompt() for structured
    prompt generation from SEALCAM+ scene data.

    Args:
        analysis: SEALCAM+ analysis JSON
        reference_group_id: Go Bananas reference group ID
        reference_mode: "style" or "add_to_image"
        aspect_ratio: Target aspect ratio

    Returns:
        List of MCP command strings
    """
    builder = GoBananasPromptBuilder(default_aspect_ratio=aspect_ratio)
    commands = []

    scenes = analysis.get("scenes", [])
    for scene in scenes:
        scene_num = scene.get("scene_number", 0)

        gb_prompt = builder.build_style_transfer_prompt(
            scene=scene,
            reference_group_id=reference_group_id,
            reference_mode=reference_mode,
            aspect_ratio=aspect_ratio,
        )

        # Build full prompt
        full_prompt = gb_prompt.scene_prompt
        if gb_prompt.additional_details:
            full_prompt += f" {gb_prompt.additional_details}"

        cmd = (
            f"# Scene {scene_num}: {scene.get('description', '')[:60]}\n"
            f"mcp__go-bananas__generate_image(\n"
            f'    prompt="{full_prompt}",\n'
            f"    reference_group_id={reference_group_id},\n"
            f'    reference_mode="{reference_mode}",\n'
            f'    aspect_ratio="{aspect_ratio}",\n'
            f'    model_id="gemini-pro-image"\n'
            f")"
        )
        commands.append(cmd)

    return commands


# ============================================================================
# Main
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Style transfer automation using Go Bananas reference groups",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Host images and output MCP commands
  python style_transfer.py \\
    --project my-villa \\
    --reference-images "render1.jpg,render2.jpg" \\
    --scene-prompts '{"1":"Villa exterior","2":"Living room"}' \\
    --aspect-ratio 16:9

  # Use existing reference group
  python style_transfer.py \\
    --project my-villa \\
    --reference-group-id 42 \\
    --scenes-json analysis/sealcam_analysis.json

  # Dry-run to preview
  python style_transfer.py \\
    --project my-villa \\
    --reference-images "render.jpg" \\
    --scene-prompts '{"1":"Exterior shot"}' \\
    --dry-run
        """,
    )

    parser.add_argument(
        "--project", required=True,
        help="Project name/slug",
    )

    # Reference source (one of these required)
    ref_group = parser.add_mutually_exclusive_group(required=True)
    ref_group.add_argument(
        "--reference-images",
        help="Comma-separated list of reference image paths or URLs",
    )
    ref_group.add_argument(
        "--reference-group-id", type=int,
        help="Existing Go Bananas reference group ID (skip hosting/creation)",
    )

    parser.add_argument(
        "--reference-mode", default="style",
        choices=["style", "add_to_image"],
        help="Reference mode: 'style' for style transfer, 'add_to_image' for composition (default: style)",
    )
    parser.add_argument(
        "--group-name",
        help="Name for the reference group (default: '{project}_style_ref')",
    )

    # Scene source (one of these required)
    scene_group = parser.add_mutually_exclusive_group(required=True)
    scene_group.add_argument(
        "--scenes-json",
        help="Path to SEALCAM+ analysis JSON with scene data",
    )
    scene_group.add_argument(
        "--scene-prompts",
        help='JSON dict of scene prompts: \'{"1":"Villa exterior","2":"Living room"}\'',
    )

    parser.add_argument(
        "--aspect-ratio", default="16:9",
        help="Target aspect ratio (default: 16:9)",
    )
    parser.add_argument(
        "--output-dir",
        help="Output directory for downloaded images (default: projects/{project}/images)",
    )
    parser.add_argument(
        "--output-commands",
        help="Save MCP commands to file instead of printing",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview commands without hosting images or creating groups",
    )
    parser.add_argument(
        "--yes", "-y", action="store_true",
        help="Skip confirmation prompts",
    )

    args = parser.parse_args()

    # Defaults
    group_name = args.group_name or f"{args.project}_style_ref"
    output_dir = args.output_dir or f"projects/{args.project}/images"

    print(f"\n{'='*60}")
    print(f"  Style Transfer: {args.project}")
    print(f"  Reference mode: {args.reference_mode}")
    print(f"  Aspect ratio: {args.aspect_ratio}")
    print(f"{'='*60}")

    # ====================================================================
    # Step 1: Handle reference group
    # ====================================================================

    reference_group_id = args.reference_group_id
    hosted_urls = []

    if args.reference_images:
        image_paths = [p.strip() for p in args.reference_images.split(",") if p.strip()]

        if not image_paths:
            print("ERROR: No valid reference images provided.")
            sys.exit(1)

        print(f"\n[Step 1] Hosting {len(image_paths)} reference image(s)...")

        if args.dry_run:
            print("  (dry-run) Would host:")
            for p in image_paths:
                print(f"    - {p}")
            hosted_urls = [f"https://example.com/{Path(p).name}" for p in image_paths]
        else:
            hosted_urls = host_reference_images(image_paths)
            if not hosted_urls:
                print("ERROR: Failed to host any reference images.")
                sys.exit(1)

        print(f"\n  Hosted {len(hosted_urls)}/{len(image_paths)} images")

        # Output create_reference_group command
        print(f"\n[Step 2] Create reference group: {group_name}")
        create_cmd = output_create_reference_group_command(group_name, hosted_urls)
        print(f"\n{create_cmd}")

        if not args.dry_run:
            print(
                "\n  *** Execute the command above in Claude to create the reference group. ***"
                "\n  Then re-run with --reference-group-id <ID> to generate scene commands."
            )

            if not reference_group_id:
                # If user doesn't have the ID yet, they need to run the MCP command first
                print(
                    f"\n  After creating the group, re-run:\n"
                    f"    python style_transfer.py \\\n"
                    f"      --project {args.project} \\\n"
                    f"      --reference-group-id <GROUP_ID> \\\n"
                    f"      --reference-mode {args.reference_mode} \\\n"
                    f"      {'--scenes-json ' + args.scenes_json if args.scenes_json else '--scene-prompts ...'} \\\n"
                    f"      --aspect-ratio {args.aspect_ratio}"
                )

                # In dry-run mode, continue with a placeholder ID
                if args.dry_run:
                    reference_group_id = 999
                    print("\n  (dry-run) Using placeholder reference_group_id=999")
                else:
                    return
    else:
        print(f"\n[Step 1-2] Using existing reference group ID: {reference_group_id}")

    # ====================================================================
    # Step 2: Load scenes
    # ====================================================================

    print(f"\n[Step 3] Loading scenes...")

    use_analysis = False

    if args.scenes_json:
        if not os.path.exists(args.scenes_json):
            print(f"ERROR: Scenes file not found: {args.scenes_json}")
            sys.exit(1)

        with open(args.scenes_json) as f:
            analysis = json.load(f)

        scene_count = len(analysis.get("scenes", []))
        use_analysis = True
        print(f"  Loaded {scene_count} scenes from SEALCAM+ analysis")

    elif args.scene_prompts:
        try:
            scenes = json.loads(args.scene_prompts)
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON in --scene-prompts: {e}")
            sys.exit(1)

        scene_count = len(scenes)
        print(f"  Loaded {scene_count} scene prompts")

    # ====================================================================
    # Step 3: Generate MCP commands
    # ====================================================================

    print(f"\n[Step 4] Generating MCP commands...")

    if use_analysis:
        commands = output_scene_commands_from_analysis(
            analysis=analysis,
            reference_group_id=reference_group_id,
            reference_mode=args.reference_mode,
            aspect_ratio=args.aspect_ratio,
        )
    else:
        commands = output_scene_commands(
            scenes=scenes,
            reference_group_id=reference_group_id,
            reference_mode=args.reference_mode,
            aspect_ratio=args.aspect_ratio,
            project=args.project,
        )

    # Output commands
    print(f"\n{'='*60}")
    print(f"  Generated {len(commands)} MCP commands")
    print(f"{'='*60}\n")

    all_commands = "\n\n".join(commands)

    if args.output_commands:
        os.makedirs(os.path.dirname(args.output_commands) or ".", exist_ok=True)
        with open(args.output_commands, "w") as f:
            f.write(all_commands)
        print(f"  Commands saved to: {args.output_commands}")
    else:
        print(all_commands)

    # Output summary
    print(f"\n{'='*60}")
    print(f"  Style Transfer Summary")
    print(f"{'='*60}")
    print(f"  Project: {args.project}")
    print(f"  Reference group: {reference_group_id}")
    print(f"  Reference mode: {args.reference_mode}")
    print(f"  Scenes: {len(commands)}")
    print(f"  Aspect ratio: {args.aspect_ratio}")
    print(f"  Output dir: {output_dir}")

    if args.dry_run:
        print(f"\n  (dry-run) No images were hosted or groups created.")

    print(f"\n  Next steps:")
    print(f"  1. Execute the MCP commands above in Claude")
    print(f"  2. Download generated images to: {output_dir}")
    print(f"  3. Name images as: run001_scene_N_frame.jpg")
    print(f"  4. Run parallel_video_gen.py for video generation")
    print()


if __name__ == "__main__":
    main()
