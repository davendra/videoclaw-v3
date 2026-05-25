#!/usr/bin/env python3
"""
Start Frame Analyzer
Analyzes a first-frame image to understand subject state before generating motion prompts.
Ensures I2V prompts accurately continue FROM the image state.

Usage:
    python analyze_start_frame.py --image "path/to/frame.jpg" --output "analysis.json"
    python analyze_start_frame.py --image "scene_1_frame.jpg" --scene-data "scene.json"

Requirements:
    pip install google-generativeai pillow

Environment:
    GOOGLE_API_KEY - Required for Gemini API access
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import google.generativeai as genai
except ImportError:
    print("Error: google-generativeai not installed. Run: pip install google-generativeai")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("Error: pillow not installed. Run: pip install pillow")
    sys.exit(1)


FRAME_ANALYSIS_PROMPT = """Analyze this image as a starting frame for video generation.
Your goal is to understand the exact state of the subject so we can generate accurate motion prompts.

Return JSON only with this structure:

{
  "subject": {
    "type": "person/object/animal",
    "description": "Brief description",
    "position_in_frame": {
      "horizontal": "left/center-left/center/center-right/right",
      "vertical": "top/middle/bottom",
      "depth": "foreground/midground/background"
    },
    "facing_direction": "left/right/camera/away/three-quarter-left/three-quarter-right",
    "pose": {
      "body": "standing/sitting/walking/running/etc",
      "details": "specific pose details (weight distribution, arm position)",
      "head": "straight/tilted/turned"
    },
    "expression": "neutral/happy/serious/contemplative/etc",
    "apparent_motion": {
      "is_moving": true/false,
      "direction": "left/right/toward-camera/away/stationary",
      "speed_estimate": "stationary/slow/medium/fast"
    }
  },
  "composition": {
    "shot_type": "extreme-wide/wide/medium-wide/medium/medium-close/close-up/extreme-close",
    "camera_angle": "eye-level/low/high/dutch/bird-eye/worm-eye",
    "depth_of_field": "shallow/medium/deep",
    "negative_space": {
      "location": "left/right/top/bottom/balanced/minimal",
      "amount": "large/medium/small/none"
    }
  },
  "environment": {
    "setting": "Brief description of background/setting",
    "lighting_direction": "front/side/back/top/ambient",
    "atmosphere": "Any particles, fog, effects visible"
  },
  "motion_potential": {
    "natural_continuation": "What action would naturally follow this pose",
    "movement_space": "Where subject can move (e.g., 'room to walk right')",
    "constraints": "What limits motion (e.g., 'edge of frame on left')"
  },
  "video_prompt_guidance": {
    "start_description": "Description of current state for prompt",
    "recommended_motion": "Suggested motion that continues naturally",
    "camera_suggestion": "Recommended camera behavior"
  }
}
"""


def analyze_start_frame(image_path: str, api_key: str) -> dict:
    """
    Analyze a first-frame image using Gemini Vision.

    Args:
        image_path: Path to the image file
        api_key: Google API key for Gemini

    Returns:
        Dictionary with structured analysis of the image
    """
    genai.configure(api_key=api_key)

    # Verify image exists and get dimensions
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")

    with Image.open(image_path) as img:
        width, height = img.size
        aspect_ratio = "landscape" if width > height else "portrait" if height > width else "square"

    print(f"Analyzing image: {image_path}")
    print(f"  Dimensions: {width}x{height} ({aspect_ratio})")

    # Upload image to Gemini
    image_file = genai.upload_file(image_path)

    # Create model and analyze
    model = genai.GenerativeModel("gemini-3-flash-preview")

    response = model.generate_content(
        [FRAME_ANALYSIS_PROMPT, image_file],
        generation_config=genai.GenerationConfig(
            temperature=0.1,
            max_output_tokens=4096,
        )
    )

    # Parse JSON response
    response_text = response.text.strip()

    # Remove markdown code blocks if present
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        response_text = "\n".join(lines[1:-1])

    try:
        analysis = json.loads(response_text)
    except json.JSONDecodeError as e:
        print(f"Warning: Failed to parse JSON: {e}")
        analysis = {"raw_response": response_text, "parse_error": str(e)}

    # Add image metadata
    analysis["image_metadata"] = {
        "path": image_path,
        "width": width,
        "height": height,
        "aspect_ratio": aspect_ratio
    }

    return analysis


def generate_continuation_prompt(
    frame_analysis: dict,
    scene_motion: dict | None = None
) -> str:
    """
    Generate an I2V prompt that correctly continues from the analyzed image state.

    Args:
        frame_analysis: Output from analyze_start_frame()
        scene_motion: Optional motion data from SEALCAM+ analysis

    Returns:
        String prompt for Image-to-Video generation
    """
    parts = []
    subject = frame_analysis.get("subject", {})
    motion_potential = frame_analysis.get("motion_potential", {})
    guidance = frame_analysis.get("video_prompt_guidance", {})

    # Start with current state acknowledgment
    apparent = subject.get("apparent_motion", {})
    if apparent.get("is_moving"):
        parts.append(f"Subject continues {apparent.get('direction', 'moving')}")
    else:
        # Use guidance for natural continuation
        if scene_motion:
            action = scene_motion.get("subject", {}).get("primary_action", "")
            parts.append(f"Subject begins to {action}" if action else "Subject begins moving")
        else:
            natural = motion_potential.get("natural_continuation", "moves naturally")
            parts.append(f"Subject {natural}")

    # Add motion details from scene data if available
    if scene_motion:
        subj = scene_motion.get("subject", {})
        if subj.get("speed"):
            parts.append(f"at {subj['speed']} pace")
        if subj.get("secondary"):
            secondaries = subj["secondary"]
            if isinstance(secondaries, list):
                parts.append(f"with {', '.join(secondaries)}")

    # Camera instructions
    if scene_motion:
        cam = scene_motion.get("camera", {})
        if cam.get("movement_type") == "static":
            parts.append("Camera remains static.")
        elif cam.get("movement_type"):
            cam_desc = f"Camera: {cam['movement_type']}"
            if cam.get("movement_direction"):
                cam_desc += f" {cam['movement_direction']}"
            if cam.get("movement_speed"):
                cam_desc += f", {cam['movement_speed']}"
            parts.append(cam_desc + ".")
    else:
        cam_suggestion = guidance.get("camera_suggestion", "")
        if cam_suggestion:
            parts.append(f"Camera: {cam_suggestion}.")

    # Micromotion from scene data
    if scene_motion:
        micro = scene_motion.get("micromotion", {})
        micro_parts = []
        for key in ["breathing", "fabric", "hair", "weight_shifts"]:
            if micro.get(key):
                micro_parts.append(f"{key}: {micro[key]}")
        if micro_parts:
            parts.append(f"Subtle details: {'; '.join(micro_parts)}.")

    # Timing/keyframes
    if scene_motion:
        timing = scene_motion.get("timing", {})
        keyframes = timing.get("keyframes", [])
        if keyframes:
            kf_descriptions = [f"{kf.get('percentage', kf.get('time', ''))}: {kf['description']}"
                              for kf in keyframes]
            parts.append(f"Motion: {' → '.join(kf_descriptions)}.")

    # Constraints
    parts.append("Maintain exact appearance from start frame.")
    parts.append("Smooth continuous motion, no jump cuts.")

    return " ".join(parts)


def merge_with_scene_data(frame_analysis: dict, scene_data: dict) -> dict:
    """
    Merge frame analysis with scene data to create complete motion context.

    Args:
        frame_analysis: Output from analyze_start_frame()
        scene_data: Scene data from SEALCAM+ analysis

    Returns:
        Merged dictionary with both frame state and intended motion
    """
    return {
        "frame_state": frame_analysis,
        "intended_motion": scene_data,
        "validated": {
            "position_match": _validate_position(frame_analysis, scene_data),
            "pose_match": _validate_pose(frame_analysis, scene_data),
            "warnings": _generate_warnings(frame_analysis, scene_data)
        },
        "continuation_prompt": generate_continuation_prompt(frame_analysis, scene_data)
    }


def _validate_position(frame: dict, scene: dict) -> bool:
    """Check if frame position matches scene start_pose expectations."""
    frame_pos = frame.get("subject", {}).get("position_in_frame", {})
    scene_action = scene.get("action", {})

    # If scene expects "entering frame left", frame should show subject at left
    start_pose = scene_action.get("start_pose", "").lower() if isinstance(scene_action, dict) else ""

    if "left" in start_pose:
        return frame_pos.get("horizontal", "") in ["left", "center-left"]
    if "right" in start_pose:
        return frame_pos.get("horizontal", "") in ["right", "center-right"]
    if "center" in start_pose:
        return frame_pos.get("horizontal", "") in ["center", "center-left", "center-right"]

    return True  # No specific requirement


def _validate_pose(frame: dict, scene: dict) -> bool:
    """Check if frame pose matches scene expectations."""
    frame_pose = frame.get("subject", {}).get("pose", {})
    scene_action = scene.get("action", {})

    if isinstance(scene_action, dict):
        primary = scene_action.get("primary", "").lower()
        frame_body = frame_pose.get("body", "").lower()

        # Walking scene should have standing/walking pose
        if "walk" in primary and frame_body not in ["standing", "walking"]:
            return False

    return True


def _generate_warnings(frame: dict, scene: dict) -> list:
    """Generate warnings about potential mismatches."""
    warnings = []

    frame_subject = frame.get("subject", {})
    scene_action = scene.get("action", {}) if isinstance(scene.get("action"), dict) else {}

    # Check direction mismatch
    frame_facing = frame_subject.get("facing_direction", "")
    motion_path = scene_action.get("path", "")

    if "left-to-right" in motion_path and frame_facing == "left":
        warnings.append("Subject faces left but motion is left-to-right. May cause unnatural start.")

    if "right-to-left" in motion_path and frame_facing == "right":
        warnings.append("Subject faces right but motion is right-to-left. May cause unnatural start.")

    # Check position constraints
    frame_pos = frame_subject.get("position_in_frame", {})
    _motion_potential = frame.get("motion_potential", {})

    if "entering frame left" in scene_action.get("start_pose", "") and frame_pos.get("horizontal") == "right":
        warnings.append("Start pose says 'entering left' but subject is on right side of frame.")

    # Check negative space
    neg_space = frame.get("composition", {}).get("negative_space", {})
    if "left-to-right" in motion_path and neg_space.get("location") == "left":
        warnings.append("Motion is left-to-right but negative space is on left. Subject may exit quickly.")

    return warnings


def main():
    parser = argparse.ArgumentParser(description="Analyze start frame for video generation")
    parser.add_argument("--image", required=True, help="Path to first-frame image")
    parser.add_argument("--output", help="Output JSON file path")
    parser.add_argument("--scene-data", help="Optional scene data JSON for comparison")
    parser.add_argument("--generate-prompt", action="store_true",
                        help="Generate continuation prompt")
    args = parser.parse_args()

    # Get API key
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GOOGLE_API_KEY environment variable not set")
        sys.exit(1)

    # Analyze frame
    analysis = analyze_start_frame(args.image, api_key)

    # Load scene data if provided
    scene_data = None
    if args.scene_data:
        with open(args.scene_data) as f:
            scene_data = json.load(f)

    # Merge with scene data if available
    result = merge_with_scene_data(analysis, scene_data) if scene_data else analysis

    # Generate prompt if requested
    if args.generate_prompt:
        prompt = generate_continuation_prompt(analysis, scene_data)
        result["generated_prompt"] = prompt
        print("\n--- Generated I2V Prompt ---")
        print(prompt)

    # Output
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\nAnalysis saved to: {args.output}")
    else:
        print("\n--- Frame Analysis ---")
        print(json.dumps(result, indent=2))

    # Print validation warnings
    if "validated" in result and result["validated"].get("warnings"):
        print("\n--- Warnings ---")
        for warning in result["validated"]["warnings"]:
            print(f"  ⚠️  {warning}")


if __name__ == "__main__":
    main()
