#!/usr/bin/env python3
"""
Character Variant Management for Go Bananas

Analyze scenes for character/age mismatches and help create character variants.

When using Go Bananas character references, the model cannot reconcile
mismatches between reference appearance and prompt requirements. For example,
if your character reference is a 20-year-old but the scene requires a
"father in his 50s", you'll get inconsistent results.

This script helps:
1. Analyze scenes to detect age/appearance mismatches
2. Suggest which character variants to create
3. Generate MCP commands to create those variants

Usage:
    # Analyze scenes and suggest variants
    python character_variants.py --analyze \
        --analysis "projects/{slug}/analysis/rewritten_prompts.json" \
        --character-id 27 \
        --character-base-prompt "18 year old Ram Patel Indian man..."

    # Output variant creation commands to JSON
    python character_variants.py --analyze \
        --analysis "projects/{slug}/analysis/rewritten_prompts.json" \
        --character-id 27 \
        --output "variants.json"

    # Suggest a single variant creation (interactive)
    python character_variants.py --suggest-variant \
        --character-id 27 \
        --character-name "Ram Patel" \
        --target-age 50

    # List all characters (via Go Bananas - outputs MCP command)
    python character_variants.py --list-characters
"""

import argparse
import json
import os
import sys
from typing import Any

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from exceptions import ManifestError, ProjectError
from gobananas_prompts import (
    analyze_all_scenes_character_match,
    print_character_match_report,
)

# ============================================================================
# Constants
# ============================================================================

PROJECTS_BASE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "..", "..", "projects"
)


# ============================================================================
# Scene Loading (duplicated from generate_images.py for standalone use)
# ============================================================================

def load_scene_data(analysis_path: str) -> dict:
    """Load scene data from analysis file."""
    if not os.path.exists(analysis_path):
        raise ProjectError(f"Analysis file not found: {analysis_path}")

    with open(analysis_path) as f:
        data = json.load(f)

    return data


def extract_scenes(data: dict) -> list[dict]:
    """Extract scenes array from analysis data."""
    if "scenes" in data:
        return data["scenes"]

    if "sealcam_analysis" in data:
        analysis = data["sealcam_analysis"]
        if "scenes" in analysis:
            return analysis["scenes"]

    if isinstance(data, list):
        return data

    for _key, value in data.items():
        if isinstance(value, dict) and "scenes" in value:
            return value["scenes"]

    raise ManifestError("Could not find scenes in analysis data")


# ============================================================================
# Variant Suggestion
# ============================================================================

def generate_variant_prompt(
    character_name: str,
    target_age: int,
    additional_features: list[str] | None = None,
) -> str:
    """
    Generate a prompt for creating a character variant.

    IMPORTANT: Keep prompts SIMPLE. The character reference already contains
    all facial features - we just need to tell the model the age change.

    Working pattern: "[name] when his [age]" or "[name] at [age]"

    Don't over-describe - the model maintains character likeness automatically
    when using character_id reference.

    Args:
        character_name: Base character name
        target_age: Target age for the variant
        additional_features: Additional features to add (e.g., ["beard", "gray hair"])

    Returns:
        Variant prompt string - kept intentionally simple
    """
    # Simple is better - "ram when his 45" works perfectly
    # The character reference handles facial features
    prompt = f"{character_name} when his {target_age}"

    # Only add features if explicitly requested
    if additional_features:
        prompt += ", " + ", ".join(additional_features)

    return prompt


def generate_variant_mcp_commands(
    character_name: str,
    character_id: int,
    target_age: int,
    additional_features: list[str] | None = None,
) -> dict[str, str]:
    """
    Generate MCP commands for creating a character variant.

    Args:
        character_name: Base character name
        character_id: Original character ID
        target_age: Target age for the variant
        additional_features: Additional features to add

    Returns:
        Dict with "generate" and "create" commands
    """
    variant_name = f"{character_name} {target_age}"
    variant_prompt = generate_variant_prompt(character_name, target_age, additional_features)

    generate_cmd = f"""mcp__go-bananas__generate_image(
    prompt="{variant_prompt}",
    character_id={character_id},
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)"""

    create_cmd = f"""mcp__go-bananas__create_character(
    character_name="{variant_name}",
    base_prompt="{variant_prompt}",
    reference_image_ids=[<GENERATED_IMAGE_ID>],  # Replace with actual ID from step 1
    description="Aged variant of {character_name} at {target_age} years old"
)"""

    return {
        "variant_name": variant_name,
        "variant_prompt": variant_prompt,
        "step1_generate": generate_cmd,
        "step2_create": create_cmd,
    }


def print_variant_commands(
    character_name: str,
    character_id: int,
    target_age: int,
    additional_features: list[str] | None = None,
) -> None:
    """Print formatted MCP commands for creating a variant."""
    cmds = generate_variant_mcp_commands(
        character_name, character_id, target_age, additional_features
    )

    print("\n" + "=" * 60)
    print(f"CREATE VARIANT: {cmds['variant_name']}")
    print("=" * 60)

    print(f"\nVariant prompt: {cmds['variant_prompt']}")

    print("\n" + "-" * 60)
    print("STEP 1: Generate aged version (execute in Claude)")
    print("-" * 60)
    print(cmds['step1_generate'])

    print("\n" + "-" * 60)
    print("STEP 2: Create new character from result")
    print("-" * 60)
    print("After executing Step 1, note the generated image_id, then run:")
    print(cmds['step2_create'])

    print("\n" + "-" * 60)
    print("STEP 3: Use new character_id for scenes")
    print("-" * 60)
    print(f"""After creating the character, use the new character_id in your scene generation:

mcp__go-bananas__generate_image(
    prompt="Scene description...",
    character_id=<NEW_CHARACTER_ID>,  # {cmds['variant_name']}
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)""")

    print("\n" + "=" * 60)


# ============================================================================
# Analysis Report Export
# ============================================================================

def export_analysis_to_json(
    analysis: dict[str, Any],
    character_id: int,
    output_path: str,
) -> None:
    """
    Export analysis results to JSON file.

    Args:
        analysis: Analysis results from analyze_all_scenes_character_match
        character_id: Original character ID
        output_path: Output file path
    """
    # Add character_id to variant commands
    for variant in analysis.get('variant_commands', []):
        variant['source_character_id'] = character_id
        variant['mcp_generate'] = f"""mcp__go-bananas__generate_image(
    prompt="{variant['prompt']}",
    character_id={character_id},
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)"""
        variant['mcp_create'] = f"""mcp__go-bananas__create_character(
    character_name="{variant['name']}",
    base_prompt="{variant['prompt']}",
    reference_image_ids=[<GENERATED_IMAGE_ID>],
    description="Variant for scenes {variant['for_scenes']}"
)"""

    output = {
        "source_character_id": character_id,
        "analysis": analysis,
        "summary": {
            "total_scenes": analysis['total_scenes'],
            "matches": analysis['matches'],
            "mismatches": analysis['mismatches'],
            "variants_needed": len(analysis['needed_variants']),
        },
    }

    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\nAnalysis exported to: {output_path}")


# ============================================================================
# Main CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Character Variant Management for Go Bananas",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze scenes for character mismatches
  python character_variants.py --analyze \\
    --analysis "projects/prada/analysis/rewritten_prompts.json" \\
    --character-id 27 \\
    --character-base-prompt "18 year old Ram Patel Indian man"

  # Suggest variant for specific age
  python character_variants.py --suggest-variant \\
    --character-id 27 \\
    --character-name "Ram Patel" \\
    --target-age 50

  # List characters (prints MCP command)
  python character_variants.py --list-characters
        """
    )

    # Mode selection
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument(
        "--analyze",
        action="store_true",
        help="Analyze scenes for character/age mismatches"
    )
    mode_group.add_argument(
        "--suggest-variant",
        action="store_true",
        help="Suggest MCP commands to create a specific variant"
    )
    mode_group.add_argument(
        "--list-characters",
        action="store_true",
        help="Print MCP command to list all characters"
    )

    # Analysis mode options
    parser.add_argument(
        "--analysis", "-a",
        help="Path to analysis or rewritten_prompts.json file"
    )
    parser.add_argument(
        "--project", "-p",
        help="Project slug (auto-detects analysis file)"
    )

    # Character options
    parser.add_argument(
        "--character-id", "-c",
        type=int,
        help="Source character ID"
    )
    parser.add_argument(
        "--character-name",
        help="Character name (for variant naming)"
    )
    parser.add_argument(
        "--character-base-prompt",
        help="Character's base prompt describing their appearance"
    )

    # Variant options
    parser.add_argument(
        "--target-age",
        type=int,
        help="Target age for the variant"
    )
    parser.add_argument(
        "--additional-features",
        nargs="+",
        help="Additional features for variant (e.g., 'beard' 'gray hair')"
    )

    # Output options
    parser.add_argument(
        "--output", "-o",
        help="Output JSON file for analysis results"
    )

    args = parser.parse_args()

    # Handle list-characters mode
    if args.list_characters:
        print("\n" + "=" * 60)
        print("LIST ALL CHARACTERS")
        print("=" * 60)
        print("\nExecute this MCP command in Claude to list all characters:")
        print("""
mcp__go-bananas__list_characters()
""")
        print("This will show all characters with their IDs and base prompts.")
        print("=" * 60)
        return

    # Handle suggest-variant mode
    if args.suggest_variant:
        if not args.character_id:
            print("Error: --suggest-variant requires --character-id")
            sys.exit(1)
        if not args.character_name:
            print("Error: --suggest-variant requires --character-name")
            sys.exit(1)
        if not args.target_age:
            print("Error: --suggest-variant requires --target-age")
            sys.exit(1)

        print_variant_commands(
            character_name=args.character_name,
            character_id=args.character_id,
            target_age=args.target_age,
            additional_features=args.additional_features,
        )
        return

    # Handle analyze mode
    if args.analyze:
        # Resolve analysis path
        analysis_path = args.analysis
        if not analysis_path and args.project:
            # Auto-detect from project
            projects_dir = os.path.abspath(PROJECTS_BASE)
            matching = [
                d for d in os.listdir(projects_dir)
                if args.project in d
            ]
            if matching:
                project_path = os.path.join(projects_dir, sorted(matching)[-1])
            else:
                project_path = os.path.join(projects_dir, args.project)

            analysis_dir = os.path.join(project_path, "analysis")
            for candidate in ["rewritten_prompts.json", "sealcam_analysis.json"]:
                candidate_path = os.path.join(analysis_dir, candidate)
                if os.path.exists(candidate_path):
                    analysis_path = candidate_path
                    break

        if not analysis_path or not os.path.exists(analysis_path):
            print("Error: Analysis file not found. Specify with --analysis or --project")
            sys.exit(1)

        if not args.character_id:
            print("Error: --analyze requires --character-id")
            sys.exit(1)

        print(f"\n{'='*60}")
        print("CHARACTER VARIANT ANALYSIS")
        print(f"{'='*60}")
        print(f"Analysis file: {analysis_path}")
        print(f"Character ID: {args.character_id}")

        # Load scenes
        data = load_scene_data(analysis_path)
        scenes = extract_scenes(data)
        print(f"Scenes found: {len(scenes)}")

        # Build character info
        character_info = {
            "name": args.character_name or f"Character {args.character_id}",
            "character_id": args.character_id,
            "base_prompt": args.character_base_prompt or "",
            "description": "",
        }

        if not args.character_base_prompt:
            print("\nNote: No --character-base-prompt provided.")
            print("For best results, fetch it from Go Bananas:")
            print(f"  mcp__go-bananas__get_character(character_id={args.character_id})")
            print("Then provide it with: --character-base-prompt '...'")

        # Run analysis
        analysis = analyze_all_scenes_character_match(scenes, character_info)

        # Print report
        print_character_match_report(analysis)

        # Export to JSON if requested
        if args.output:
            export_analysis_to_json(analysis, args.character_id, args.output)

        # Summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Total scenes: {analysis['total_scenes']}")
        print(f"Matches: {analysis['matches']}")
        print(f"Mismatches: {analysis['mismatches']}")

        if analysis['mismatches'] > 0:
            print(f"\nVariants needed: {', '.join(analysis['needed_variants'])}")
            print("\nNext steps:")
            print("1. Execute the MCP commands above to create each variant")
            print("2. Note the new character_id for each variant")
            print("3. Use the appropriate character_id for each scene")
        else:
            print("\n✓ No variants needed - all scenes match the character reference.")

        print("=" * 60)
        return


if __name__ == "__main__":
    main()
