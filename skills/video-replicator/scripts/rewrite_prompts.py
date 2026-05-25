#!/usr/bin/env python3
"""
Prompt Rewriter Script (Enhanced for SEALCAM+)
Takes SEALCAM+ analysis and rewrites prompts by swapping the subject.
Generates optimized prompts for each video generation mode (T2V, I2V, F2V, R2V).

Usage:
    python rewrite_prompts.py \
        --analysis "sealcam_analysis.json" \
        --subject "A 30-year-old Asian woman with short black hair wearing a red blazer" \
        --output "rewritten_prompts.json"

Optional:
    --style-overrides "background=gold studio, lighting=warm golden hour"
    --mode "i2v"  # Default mode for video_motion_prompt
    --project "slug"  # Save to database
"""

import argparse
import copy
import json
import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    from generate_video_prompts import (
        flatten_f2v_prompt,
        flatten_i2v_prompt,
        flatten_r2v_prompt,
        flatten_t2v_prompt,
        generate_motion_brief,
    )
except ImportError:
    # Fallback if generate_video_prompts not available
    def flatten_t2v_prompt(scene): return ""
    def flatten_i2v_prompt(scene): return ""
    def flatten_f2v_prompt(scene, d=3): return ""
    def flatten_r2v_prompt(scene): return ""
    def generate_motion_brief(scene): return {}

try:
    from db import VideoReplicatorDB
except ImportError:
    VideoReplicatorDB = None

try:
    from utils_aspect import adjust_prompt_for_ratio, get_scene_type
except ImportError:
    def adjust_prompt_for_ratio(prompt, ratio): return prompt
    def get_scene_type(prompt): return "mixed"

try:
    from gobananas_prompts import GoBananasPromptBuilder, scene_to_gobananas_dict
except ImportError:
    GoBananasPromptBuilder = None
    def scene_to_gobananas_dict(scene, **kwargs): return {}


def _aspect_ratio_to_mcp(ratio: str) -> str:
    """Convert human-readable aspect ratio to MCP format."""
    if not ratio:
        return "9:16"  # Default portrait
    ratio_map = {
        "portrait": "9:16",
        "landscape": "16:9",
        "square": "1:1",
    }
    return ratio_map.get(ratio.lower(), ratio)


def _generate_choreography(scene: dict) -> str:
    """
    Generate a CH (Choreography) section for a scene based on its action data.

    Produces explicit micro-movement descriptions covering gaze, weight/stance,
    movement mechanics, reaction physics, and recovery states.

    Args:
        scene: Scene dictionary with action, subject, and other SEALCAM+ fields.

    Returns:
        A 2-3 sentence choreography description, or empty string if no action data.
    """
    action = scene.get("action", {})
    if not action:
        return ""

    parts = []

    if isinstance(action, dict):
        primary = action.get("primary", "")
        secondary = action.get("secondary", [])
        speed = action.get("speed", "")
        start_pose = action.get("start_pose", "")
        end_pose = action.get("end_pose", "")
        keyframes = action.get("keyframes", [])

        # Build gaze/stance from subject data
        subject = scene.get("subject", {})
        facing = ""
        if isinstance(subject, dict):
            facing = subject.get("facing_direction", "")

        # Build choreography from available data
        if start_pose and end_pose:
            parts.append(f"Starting from {start_pose}, transitioning to {end_pose}")

        if primary:
            speed_desc = f" at {speed}" if speed else ""
            parts.append(f"{primary}{speed_desc}")

        if facing:
            parts.append(f"facing {facing}")

        if secondary and isinstance(secondary, list):
            parts.append(f"with {', '.join(secondary)}")

        # Add keyframe-derived timing if available
        if keyframes and len(keyframes) >= 2:
            first_kf = keyframes[0].get("description", "")
            last_kf = keyframes[-1].get("description", "")
            if first_kf and last_kf:
                parts.append(f"progressing from {first_kf} to {last_kf}")

        # Add micromotion details if available
        micromotion = scene.get("micromotion", {})
        if isinstance(micromotion, dict):
            weight = micromotion.get("weight_shifts", "")
            if weight:
                parts.append(f"weight shifts: {weight}")
    else:
        # Action is a plain string
        parts.append(str(action))

    if not parts:
        return ""

    return ". ".join(parts).rstrip(".") + "."


def rewrite_scene(scene: dict, new_subject: str, style_overrides: dict = None,
                  default_mode: str = "i2v", aspect_ratio: str = None,
                  choreography: bool = False) -> dict:
    """
    Rewrite a single scene with the new subject and optional overrides.
    Generates prompts for all video generation modes.

    Args:
        scene: Original scene dictionary from SEALCAM+ analysis
        new_subject: Description of the new subject to swap in
        style_overrides: Dict of style overrides (environment, lighting, etc.)
        default_mode: Default video generation mode (t2v, i2v, f2v, r2v)
        aspect_ratio: Target aspect ratio (portrait, landscape) - adds composition hints
        choreography: If True, generate CH (Choreography) micro-movement descriptions
    """
    rewritten = scene.copy()

    # Handle both dict and string formats for subject
    original_subject = scene.get("subject", "")
    if isinstance(original_subject, dict):
        rewritten["original_subject"] = original_subject.get("appearance", str(original_subject))
        # Create new subject dict with swapped appearance
        rewritten["subject"] = {
            **original_subject,
            "appearance": new_subject
        }
    else:
        rewritten["original_subject"] = original_subject
        rewritten["subject"] = {"appearance": new_subject}

    # Apply style overrides
    if style_overrides:
        for key, value in style_overrides.items():
            if key in rewritten:
                rewritten[f"original_{key}"] = copy.deepcopy(rewritten[key])
                # Handle dict fields
                if isinstance(rewritten[key], dict):
                    if key == "environment":
                        rewritten[key]["setting"] = value
                    elif key == "lighting":
                        rewritten[key]["setup"] = value
                    else:
                        rewritten[key] = value
                else:
                    rewritten[key] = value

    # Generate motion brief (structured intermediate format)
    motion_brief = generate_motion_brief(rewritten)
    rewritten["motion_brief"] = motion_brief

    # Generate prompts for all modes
    rewritten["prompts"] = {
        "t2v": flatten_t2v_prompt(rewritten),
        "i2v": flatten_i2v_prompt(rewritten),
        "f2v": flatten_f2v_prompt(rewritten, rewritten.get("duration_seconds", 3)),
        "r2v": flatten_r2v_prompt(rewritten)
    }

    # Generate CH (Choreography) section if enabled
    if choreography:
        ch_text = _generate_choreography(rewritten)
        if ch_text:
            rewritten["choreography"] = ch_text

            # Embed choreography into mode-specific prompts
            # T2V: append naturally into the full prompt
            if rewritten["prompts"]["t2v"]:
                rewritten["prompts"]["t2v"] += f" Choreography: {ch_text}"
            # I2V: append to motion-only prompt
            if rewritten["prompts"]["i2v"]:
                rewritten["prompts"]["i2v"] += f" Choreography: {ch_text}"
            # R2V: append to reference-based prompt
            if rewritten["prompts"]["r2v"]:
                rewritten["prompts"]["r2v"] += f" Choreography: {ch_text}"
            # F2V: skip — frame-to-frame interpolation doesn't benefit from choreography

    # Build the main generation prompt (legacy format for compatibility)
    prompt_parts = []

    # Subject
    subject_desc = new_subject
    prompt_parts.append(subject_desc)

    # Environment
    env = rewritten.get("environment", "")
    if isinstance(env, dict):
        setting = env.get("setting", "")
        if setting:
            prompt_parts.append(f"in {setting}")
    elif env:
        prompt_parts.append(f"in {env}")

    # Action
    action = rewritten.get("action", {})
    if isinstance(action, dict):
        primary = action.get("primary", "")
        if primary:
            prompt_parts.append(primary)
    elif action:
        prompt_parts.append(action)

    # Lighting
    lighting = rewritten.get("lighting", "")
    if isinstance(lighting, dict):
        setup = lighting.get("setup", "")
        direction = lighting.get("direction", "")
        light_parts = [p for p in [setup, direction] if p]
        if light_parts:
            prompt_parts.append(f"Lighting: {', '.join(light_parts)}")
    elif lighting:
        prompt_parts.append(f"Lighting: {lighting}")

    # Camera
    camera = rewritten.get("camera", "")
    if isinstance(camera, dict):
        shot = camera.get("shot_type", "")
        movement = camera.get("movement_type", "")
        cam_parts = [p for p in [shot, movement] if p]
        if cam_parts:
            prompt_parts.append(f"Camera: {', '.join(cam_parts)}")
    elif camera:
        prompt_parts.append(f"Camera: {camera}")

    # Metatokens
    metatokens = rewritten.get("metatokens", "")
    if isinstance(metatokens, dict):
        style = metatokens.get("visual_style", "")
        quality = metatokens.get("quality", "")
        meta_parts = [p for p in [style, quality] if p]
        if meta_parts:
            prompt_parts.append(", ".join(meta_parts))
    elif metatokens:
        prompt_parts.append(metatokens)

    prompt_parts.append("no text, no logos, no watermarks, clean plate")

    rewritten["generation_prompt"] = ", ".join(prompt_parts)

    # Build image-first prompt (for Go Bananas / first frame generation)
    image_prompt_parts = [subject_desc]

    if isinstance(env, dict) and env.get("setting"):
        image_prompt_parts.append(f"in {env['setting']}")
    elif env:
        image_prompt_parts.append(f"in {env}")

    if isinstance(lighting, dict):
        light_info = lighting.get("setup", "") or lighting.get("direction", "")
        if light_info:
            image_prompt_parts.append(f"Lighting: {light_info}")
    elif lighting:
        image_prompt_parts.append(f"Lighting: {lighting}")

    if isinstance(camera, dict):
        shot = camera.get("shot_type", "")
        angle = camera.get("angle", "")
        if shot or angle:
            cam_info = f"{shot}, {angle}".strip(", ")
            image_prompt_parts.append(f"Camera: {cam_info}")
    elif camera:
        # Extract just the angle/shot type for static image
        cam_parts = str(camera).split(",")
        if cam_parts:
            image_prompt_parts.append(f"Camera: {cam_parts[0].strip()}")

    if isinstance(metatokens, dict):
        style = metatokens.get("visual_style", "")
        quality = metatokens.get("quality", "")
        if style:
            image_prompt_parts.append(style)
        if quality:
            image_prompt_parts.append(quality)
    elif metatokens:
        image_prompt_parts.append(metatokens)

    image_prompt_parts.append("no text, no logos, no watermarks, clean plate, high quality")

    # Build the base image prompt
    image_prompt = ", ".join(image_prompt_parts)

    # Add aspect ratio instructions if specified
    if aspect_ratio:
        image_prompt = adjust_prompt_for_ratio(image_prompt, aspect_ratio)
        rewritten["target_aspect_ratio"] = aspect_ratio
        rewritten["scene_type"] = get_scene_type(image_prompt)

    rewritten["image_prompt"] = image_prompt

    # Build Go Bananas structured output (new format)
    # This separates scene_prompt (pose/action + environment) from additional_details (lighting/mood)
    # When using character/product refs, scene_prompt should NOT repeat appearance details
    if GoBananasPromptBuilder:
        builder = GoBananasPromptBuilder(default_aspect_ratio=_aspect_ratio_to_mcp(aspect_ratio))
        gb_prompt = builder.build_character_prompt(rewritten, character_id=0)  # Placeholder ID
        rewritten["gobananas"] = {
            "scene_prompt": gb_prompt.scene_prompt,
            "additional_details": gb_prompt.additional_details,
            "negative_prompt": gb_prompt.negative_prompt,
            "aspect_ratio": gb_prompt.aspect_ratio,
            "recommended_style_preset": gb_prompt.style_preset_name,
            "recommended_style_preset_id": gb_prompt.style_preset_id,
            "generation_method": "character",  # Default, can be overridden
        }
    else:
        # Fallback if gobananas_prompts not available
        rewritten["gobananas"] = {
            "scene_prompt": image_prompt,
            "additional_details": "",
            "negative_prompt": "no text, no logos, no watermarks, clean plate",
            "aspect_ratio": _aspect_ratio_to_mcp(aspect_ratio),
            "generation_method": "standalone",
        }

    # Set video_motion_prompt based on default mode
    rewritten["video_motion_prompt"] = rewritten["prompts"].get(default_mode, "")

    # Add enhanced video prompt (the mode-specific one)
    rewritten["enhanced_video_prompt"] = rewritten["prompts"].get(default_mode, "")

    return rewritten


def parse_style_overrides(override_string: str) -> dict:
    """Parse style overrides from string like 'background=gold, lighting=warm'."""
    if not override_string:
        return {}

    overrides = {}
    for pair in override_string.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            # Map common override names to SEALCAM fields
            key_map = {
                "background": "environment",
                "bg": "environment",
                "env": "environment",
                "light": "lighting",
                "cam": "camera",
                "style": "metatokens",
                "meta": "metatokens"
            }
            key = key.strip().lower()
            key = key_map.get(key, key)
            overrides[key] = value.strip()

    return overrides


def main():
    parser = argparse.ArgumentParser(description="Rewrite SEALCAM+ prompts with new subject")
    parser.add_argument("--analysis", required=True, help="Input SEALCAM+ analysis JSON")
    parser.add_argument("--subject", required=True, help="New subject description")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--style-overrides", help="Style overrides (e.g., 'background=gold studio')")
    parser.add_argument("--mode", choices=["t2v", "i2v", "f2v", "r2v"], default="i2v",
                        help="Default video generation mode")
    parser.add_argument("--ratio", choices=["portrait", "landscape"], default=None,
                        help="Target aspect ratio - adds composition hints to prompts")
    parser.add_argument("--project", help="Project slug for database storage")
    parser.add_argument("--choreography", action="store_true", default=False,
                        help="Generate CH (Choreography) micro-movement descriptions for each scene")
    args = parser.parse_args()

    # Load analysis
    if not os.path.exists(args.analysis):
        print(f"Error: Analysis file not found: {args.analysis}")
        sys.exit(1)

    with open(args.analysis) as f:
        analysis = json.load(f)

    # Parse style overrides
    style_overrides = parse_style_overrides(args.style_overrides)

    # Rewrite each scene
    rewritten_scenes = []
    for scene in analysis.get("scenes", []):
        rewritten = rewrite_scene(
            scene,
            args.subject,
            style_overrides,
            args.mode,
            aspect_ratio=args.ratio,
            choreography=args.choreography
        )
        rewritten_scenes.append(rewritten)

    # Build output
    output = {
        "original_analysis": analysis.get("video_analysis", {}),
        "new_subject": args.subject,
        "style_overrides": style_overrides,
        "default_mode": args.mode,
        "target_aspect_ratio": args.ratio,
        "choreography_enabled": args.choreography,
        "scenes": rewritten_scenes,
        "music_prompt": analysis.get("music_prompt", ""),
        "continuity_notes": analysis.get("continuity_notes", {})
    }

    # Save to database if project specified
    if args.project and VideoReplicatorDB:
        db = VideoReplicatorDB()
        project = db.get_or_create_project(args.project)

        # Update scenes with rewritten prompts
        for scene in rewritten_scenes:
            scene_num = scene.get("scene_number")
            scenes_in_db = db.get_scenes_for_project(project["id"])
            for db_scene in scenes_in_db:
                if db_scene.get("scene_number") == scene_num:
                    db.update_scene_prompts(db_scene["id"], {
                        "image_prompt": scene.get("image_prompt"),
                        "generation_prompt": scene.get("generation_prompt"),
                        "video_motion_prompt": scene.get("video_motion_prompt"),
                        "enhanced_video_prompt": scene.get("enhanced_video_prompt"),
                        "motion_brief_json": scene.get("motion_brief")
                    })
                    break

        print(f"Updated prompts in database for project: {args.project}")
        db.close()

    # Ensure output directory exists
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write output
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Rewritten prompts saved to: {args.output}")
    print(f"Processed {len(rewritten_scenes)} scenes")
    print(f"Default mode: {args.mode.upper()}")
    if args.choreography:
        print("Choreography (CH): ENABLED")
    if args.ratio:
        print(f"Target aspect ratio: {args.ratio}")

    # Print summary
    print("\n--- Scene Summary ---")
    for scene in rewritten_scenes:
        print(f"\nScene {scene['scene_number']} ({scene.get('duration_seconds', '?')}s):")
        print(f"  Image: {scene['image_prompt'][:80]}...")
        print(f"  {args.mode.upper()}: {scene['prompts'][args.mode][:80]}...")

        # Show choreography if enabled
        ch = scene.get("choreography", "")
        if ch:
            print(f"  CH: {ch[:80]}...")

        # Show Go Bananas structured output
        gb = scene.get("gobananas", {})
        if gb:
            print("  [Go Bananas]")
            print(f"    scene_prompt: {gb.get('scene_prompt', '')[:60]}...")
            print(f"    additional_details: {gb.get('additional_details', '')[:50]}...")
            if gb.get("recommended_style_preset"):
                print(f"    style_preset: {gb.get('recommended_style_preset')}")

        # Show motion brief summary if available
        brief = scene.get("motion_brief", {})
        if brief:
            cam = brief.get("camera_motion", {})
            subj = brief.get("subject_motion", {})
            print(f"  Camera: {cam.get('type', 'N/A')} {cam.get('direction', '')}")
            print(f"  Subject: {subj.get('primary', 'N/A')[:40]}")

    # Print all mode variants for first scene
    if rewritten_scenes:
        print("\n--- All Mode Variants (Scene 1) ---")
        first_scene = rewritten_scenes[0]
        for mode_name, prompt in first_scene.get("prompts", {}).items():
            marker = " [DEFAULT]" if mode_name == args.mode else ""
            print(f"\n[{mode_name.upper()}]{marker}")
            print(f"  {prompt[:120]}...")


if __name__ == "__main__":
    main()
