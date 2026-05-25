#!/usr/bin/env python3
"""
Video Prompt Generator
Generates optimized prompts for different video generation modes:
- T2V (Text-to-Video): Full scene description
- I2V (Image-to-Video): Motion instructions only
- F2V (Frames-to-Video): Transition between start/end frames
- R2V (Reference-to-Video): New scene with reference consistency

Usage:
    # Generate prompts for all scenes in a project
    python generate_video_prompts.py --project prada-snow

    # Generate for specific scene with mode
    python generate_video_prompts.py --scene-data scene.json --mode i2v --output prompt.txt

    # Batch generate from rewritten prompts
    python generate_video_prompts.py --prompts rewritten_prompts.json --mode i2v --output prompts.json

Requirements:
    pip install google-generativeai
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ManifestError, MissingDependencyError, ProjectError

try:
    from db import VideoReplicatorDB
except ImportError:
    VideoReplicatorDB = None


# ==================== Camera Transition Library ====================

CAMERA_TRANSITIONS = {
    # Arc transitions
    "arc_180": {
        "id": "arc_180", "name": "Half Arc", "category": "arc",
        "prompt_fragment": "Camera arcs 180 degrees around the subject as the scene fades to motion blur",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["reveals", "perspective shifts"],
    },
    "arc_360": {
        "id": "arc_360", "name": "Full Orbit", "category": "arc",
        "prompt_fragment": "Camera orbits 360 degrees around subject, accelerating into a spiral blur",
        "modes": ["t2v", "r2v"],
        "best_for": ["high energy", "product reveals"],
    },
    "arc_overhead": {
        "id": "arc_overhead", "name": "Overhead Arc", "category": "arc",
        "prompt_fragment": "Camera arcs overhead in a sweeping crane move, scene dissolving below",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["grand reveals", "location transitions"],
    },
    # Roll transitions
    "roll_barrel": {
        "id": "roll_barrel", "name": "Barrel Roll", "category": "roll",
        "prompt_fragment": "Camera barrel rolls as the scene spirals into the next",
        "modes": ["t2v", "r2v"],
        "best_for": ["action", "energy bursts"],
    },
    "roll_dutch": {
        "id": "roll_dutch", "name": "Dutch Tilt Roll", "category": "roll",
        "prompt_fragment": "Camera tilts into a dutch angle then continues rolling, scene streaking into blur",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["tension", "unease", "drama"],
    },
    "roll_slow": {
        "id": "roll_slow", "name": "Slow Roll", "category": "roll",
        "prompt_fragment": "Camera slowly rolls clockwise, scene gently rotating away",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["dream sequences", "ethereal moments"],
    },
    # Wipe transitions
    "wipe_subject": {
        "id": "wipe_subject", "name": "Subject Wipe", "category": "wipe",
        "prompt_fragment": "Subject walks past camera filling the frame completely, wiping the scene",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["character-driven transitions"],
    },
    "wipe_whip_pan": {
        "id": "wipe_whip_pan", "name": "Whip Pan", "category": "wipe",
        "prompt_fragment": "Camera whip pans rapidly to the right, scene streaking into horizontal motion blur",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["fast pace", "energy", "comedy"],
    },
    "wipe_whip_tilt": {
        "id": "wipe_whip_tilt", "name": "Whip Tilt", "category": "wipe",
        "prompt_fragment": "Camera whip tilts upward rapidly, scene streaking into vertical motion blur",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["reveals", "upward energy"],
    },
    "wipe_object": {
        "id": "wipe_object", "name": "Object Wipe", "category": "wipe",
        "prompt_fragment": "A foreground element passes across the lens, momentarily blocking the view",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["natural", "organic cuts"],
    },
    # Portal transitions
    "portal_doorway": {
        "id": "portal_doorway", "name": "Doorway Push", "category": "portal",
        "prompt_fragment": "Camera pushes through a doorway into darkness",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["interior/exterior shifts"],
    },
    "portal_tunnel": {
        "id": "portal_tunnel", "name": "Tunnel Through", "category": "portal",
        "prompt_fragment": "Camera rushes forward through a dark tunnel toward a bright opening",
        "modes": ["t2v", "r2v"],
        "best_for": ["dramatic reveals", "journeys"],
    },
    "portal_frame": {
        "id": "portal_frame", "name": "Frame Within Frame", "category": "portal",
        "prompt_fragment": "Camera pushes through a frame-within-frame element, passing into a new space",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["artistic", "composed transitions"],
    },
    # Match cut transitions
    "match_shape": {
        "id": "match_shape", "name": "Shape Match", "category": "match_cut",
        "prompt_fragment": "Camera zooms into a circular element in frame until it fills the screen",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["graphic", "editorial"],
    },
    "match_color": {
        "id": "match_color", "name": "Color Match", "category": "match_cut",
        "prompt_fragment": "Scene gradually shifts to a single dominant color, filling the frame",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["mood shifts", "stylized"],
    },
    "match_eye": {
        "id": "match_eye", "name": "Eye Zoom", "category": "match_cut",
        "prompt_fragment": "Camera pushes into extreme close-up of the subject's eye, pupil filling the frame",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["intimate", "psychological"],
    },
    # Zoom transitions
    "zoom_crash": {
        "id": "zoom_crash", "name": "Crash Zoom", "category": "zoom",
        "prompt_fragment": "Camera crash zooms forward at extreme speed, scene rushing into blur",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["impact", "surprise", "action"],
    },
    "zoom_pull": {
        "id": "zoom_pull", "name": "Zoom Pull", "category": "zoom",
        "prompt_fragment": "Camera rapidly pulls back, scene shrinking to a point in the center",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["reveals", "scale shifts"],
    },
    "zoom_infinite": {
        "id": "zoom_infinite", "name": "Infinite Zoom", "category": "zoom",
        "prompt_fragment": "Camera zooms deeper and deeper into the scene, fractal-like layers emerging",
        "modes": ["t2v", "r2v"],
        "best_for": ["surreal", "psychedelic"],
    },
    "zoom_snap": {
        "id": "zoom_snap", "name": "Snap Zoom", "category": "zoom",
        "prompt_fragment": "Camera snaps to extreme close-up on a detail, filling the frame",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["product focus", "detail reveal"],
    },
    # Atmospheric transitions
    "atmo_fog": {
        "id": "atmo_fog", "name": "Fog Roll", "category": "atmospheric",
        "prompt_fragment": "Thick fog rolls across the frame, gradually obscuring the entire scene",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["mystery", "mood change"],
    },
    "atmo_dust": {
        "id": "atmo_dust", "name": "Dust Storm", "category": "atmospheric",
        "prompt_fragment": "A gust of wind kicks up dust and particles, filling the frame completely",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["outdoor", "rugged transitions"],
    },
    "atmo_light": {
        "id": "atmo_light", "name": "Light Flare", "category": "atmospheric",
        "prompt_fragment": "Bright light flares across the lens, washing the scene to white",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["ethereal", "time shifts"],
    },
    "atmo_dark": {
        "id": "atmo_dark", "name": "Fade to Dark", "category": "atmospheric",
        "prompt_fragment": "Scene gradually darkens as shadows creep in from the edges, fading to black",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["endings", "somber moments"],
    },
    "atmo_rain": {
        "id": "atmo_rain", "name": "Rain Blur", "category": "atmospheric",
        "prompt_fragment": "Rain intensifies on the lens, droplets blurring the scene away",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["melancholy", "weather shifts"],
    },
    # Dolly transitions
    "dolly_through": {
        "id": "dolly_through", "name": "Dolly Through", "category": "dolly",
        "prompt_fragment": "Camera dollies forward through the subject, passing through to the other side",
        "modes": ["t2v", "r2v"],
        "best_for": ["surreal", "through-object"],
    },
    "dolly_vertigo": {
        "id": "dolly_vertigo", "name": "Vertigo Effect", "category": "dolly",
        "prompt_fragment": "Camera dollies backward while zooming in, creating a disorienting vertigo effect",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["suspense", "realization"],
    },
    "dolly_lateral": {
        "id": "dolly_lateral", "name": "Lateral Slide", "category": "dolly",
        "prompt_fragment": "Camera slides laterally behind a wall or surface, scene disappearing edge-first",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["clean", "architectural"],
    },
    # Combined transitions
    "combo_orbit_zoom": {
        "id": "combo_orbit_zoom", "name": "Orbit + Zoom", "category": "combined",
        "prompt_fragment": "Camera orbits the subject while simultaneously zooming in, spiraling closer",
        "modes": ["t2v", "r2v"],
        "best_for": ["high energy", "climactic"],
    },
    "combo_tilt_fade": {
        "id": "combo_tilt_fade", "name": "Tilt + Fade", "category": "combined",
        "prompt_fragment": "Camera tilts upward toward the sky as the scene gradually fades to white",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["hopeful endings", "time passing"],
    },
    "combo_pan_blur": {
        "id": "combo_pan_blur", "name": "Pan + Speed Blur", "category": "combined",
        "prompt_fragment": "Camera pans right while accelerating, scene streaking into directional blur",
        "modes": ["t2v", "i2v", "r2v"],
        "best_for": ["momentum", "travel sequences"],
    },
}


def get_transition_fragment(transition_id: str) -> str | None:
    """Get the prompt fragment for a transition ID. Returns None if not found."""
    transition = CAMERA_TRANSITIONS.get(transition_id)
    if transition:
        return transition["prompt_fragment"]
    return None


def is_transition_compatible(transition_id: str, mode: str) -> bool:
    """Check if a transition is compatible with a generation mode.

    Args:
        transition_id: The transition ID (e.g., 'zoom_crash')
        mode: The generation mode ('t2v', 'i2v', 'f2v', 'r2v')

    Returns:
        True if compatible, False otherwise (including unknown transitions)
    """
    transition = CAMERA_TRANSITIONS.get(transition_id)
    if not transition:
        return False
    return mode in transition["modes"]


def get_transitions_by_category(category: str) -> list[dict]:
    """Get all transitions in a category."""
    return [t for t in CAMERA_TRANSITIONS.values() if t["category"] == category]


def list_transition_ids() -> list[str]:
    """Return all valid transition IDs."""
    return list(CAMERA_TRANSITIONS.keys())


# ==================== Prompt Flattening Functions ====================

def flatten_t2v_prompt(scene: dict, transition_id: str | None = None) -> str:
    """
    Text-to-Video: Include EVERYTHING.
    Used when generating video from scratch without any reference image.

    Args:
        scene: Scene data dict with SEALCAM fields
        transition_id: Optional camera transition ID to append at end
    """
    parts = []

    # Subject (full description)
    subject = scene.get("subject", "")
    if isinstance(subject, dict):
        subject = subject.get("appearance", str(subject))
    parts.append(subject)

    # Environment
    env = scene.get("environment", "")
    if isinstance(env, dict):
        setting = env.get("setting", "")
        if setting:
            parts.append(f"in {setting}")
    elif env:
        parts.append(f"in {env}")

    # Action
    action = scene.get("action", {})
    if isinstance(action, dict):
        primary = action.get("primary", "")
        if primary:
            parts.append(primary)
        secondary = action.get("secondary", [])
        if secondary:
            if isinstance(secondary, list):
                parts.append(f"with {', '.join(secondary)}")
            else:
                parts.append(f"with {secondary}")
    elif action:
        parts.append(action)

    # Lighting
    lighting = scene.get("lighting", "")
    if isinstance(lighting, dict):
        setup = lighting.get("setup", "")
        direction = lighting.get("direction", "")
        quality = lighting.get("quality", "")
        lighting_parts = [p for p in [setup, direction, quality] if p]
        if lighting_parts:
            parts.append(f"Lighting: {', '.join(lighting_parts)}")
    elif lighting:
        parts.append(f"Lighting: {lighting}")

    # Camera (full description for T2V)
    camera = scene.get("camera", "")
    if isinstance(camera, dict):
        shot = camera.get("shot_type", "")
        angle = camera.get("angle", "")
        movement = camera.get("movement_type", "")
        cam_parts = [p for p in [shot, angle, movement] if p]
        if cam_parts:
            parts.append(f"Camera: {', '.join(cam_parts)}")
    elif camera:
        parts.append(f"Camera: {camera}")

    # Metatokens
    metatokens = scene.get("metatokens", "")
    if isinstance(metatokens, dict):
        style = metatokens.get("visual_style", "")
        quality = metatokens.get("quality", "")
        mood = metatokens.get("mood", "")
        meta_parts = [p for p in [style, quality, mood] if p]
        if meta_parts:
            parts.append(", ".join(meta_parts))
    elif metatokens:
        parts.append(metatokens)

    # Negative prompt
    parts.append("No text, no logos, no watermarks, clean plate")

    # Camera transition (appended at end, outgoing only)
    if transition_id and is_transition_compatible(transition_id, "t2v"):
        fragment = get_transition_fragment(transition_id)
        if fragment:
            parts.append(fragment)

    return ". ".join(filter(None, parts))


def flatten_i2v_prompt(scene: dict, transition_id: str | None = None) -> str:
    """
    Image-to-Video: Motion instructions ONLY.
    DON'T re-describe what's already in the start frame image.
    Focus entirely on HOW things move, not WHAT things are.

    Args:
        scene: Scene data dict with SEALCAM fields
        transition_id: Optional camera transition ID to append at end
    """
    parts = []

    # Camera movement (always include)
    camera = scene.get("camera", {})
    if isinstance(camera, dict):
        movement_type = camera.get("movement_type", "static")
        if movement_type == "static":
            parts.append("Camera: static, locked off")
        else:
            cam_desc = f"Camera: {movement_type}"
            direction = camera.get("movement_direction", "")
            if direction:
                cam_desc += f" {direction}"
            speed = camera.get("movement_speed", "")
            if speed:
                cam_desc += f", {speed}"
            angle = camera.get("angle", "")
            if angle:
                cam_desc += f", {angle}"
            parts.append(cam_desc)
    else:
        # Legacy format - extract what we can
        cam_str = str(camera).lower()
        if "static" in cam_str or "still" in cam_str:
            parts.append("Camera: static, locked off")
        elif camera:
            parts.append(f"Camera: {camera}")

    # Subject motion (the key part for I2V)
    action = scene.get("action", {})
    if isinstance(action, dict):
        primary = action.get("primary", "")
        speed = action.get("speed", "")
        if primary:
            subj_desc = f"Subject: {primary}"
            if speed:
                subj_desc += f", {speed}"
            parts.append(subj_desc)

        secondary = action.get("secondary", [])
        if secondary:
            if isinstance(secondary, list):
                parts.append(f"Also: {', '.join(secondary)}")
            else:
                parts.append(f"Also: {secondary}")
    elif action:
        parts.append(f"Subject: {action}")

    # Keyframes/timing
    if isinstance(action, dict):
        keyframes = action.get("keyframes", [])
        if keyframes:
            kf_parts = []
            for kf in keyframes:
                time_str = kf.get("percentage", kf.get("time", ""))
                desc = kf.get("description", "")
                if time_str and desc:
                    kf_parts.append(f"{time_str}: {desc}")
            if kf_parts:
                parts.append(f"Motion: {' → '.join(kf_parts)}")

    # Micromotion (important for I2V realism)
    micromotion = scene.get("micromotion", {})
    if micromotion:
        micro_parts = []
        for key in ["breathing", "fabric", "hair", "weight_shifts"]:
            val = micromotion.get(key)
            if val:
                micro_parts.append(f"{key}: {val}")
        if micro_parts:
            parts.append(f"Subtle details: {'; '.join(micro_parts)}")

    # Constraints (critical for I2V)
    parts.append("Maintain exact appearance from start frame")
    parts.append("Smooth continuous motion, no jump cuts")

    # Camera transition (appended at end, outgoing only)
    if transition_id and is_transition_compatible(transition_id, "i2v"):
        fragment = get_transition_fragment(transition_id)
        if fragment:
            parts.append(fragment)

    return ". ".join(filter(None, parts)) + "."


def flatten_f2v_prompt(scene: dict, duration: float = 3.0) -> str:
    """
    Frames-to-Video: Transition instructions between start and end frames.
    Used when you have both a start frame AND an end frame image.
    """
    parts = []

    parts.append(f"Smooth {duration:.0f}-second transition between start and end frames")

    # Camera movement during transition
    camera = scene.get("camera", {})
    if isinstance(camera, dict):
        movement_type = camera.get("movement_type", "")
        if movement_type and movement_type != "static":
            parts.append(f"Camera: {movement_type} from start position to end")
        else:
            parts.append("Camera: minimal movement, maintains framing")

    # Subject transition (what changes between start and end)
    action = scene.get("action", {})
    if isinstance(action, dict):
        start_pose = action.get("start_pose", "")
        end_pose = action.get("end_pose", "")
        if start_pose and end_pose:
            parts.append(f"Subject transitions from '{start_pose}' to '{end_pose}'")
        elif action.get("primary"):
            parts.append(f"Subject: {action['primary']}")

    # Interpolation style
    parts.append("Linear interpolation, ease-in-out motion")

    # Constraints
    parts.append("Maintain consistent lighting and environment throughout")
    parts.append("No morphing artifacts, natural motion path between frames")

    return ". ".join(filter(None, parts)) + "."


def flatten_r2v_prompt(scene: dict, transition_id: str | None = None) -> str:
    """
    Reference-to-Video: New scene with reference image consistency.
    Used when you have 1-3 reference images to maintain subject/style consistency.

    Args:
        scene: Scene data dict with SEALCAM fields
        transition_id: Optional camera transition ID to append at end
    """
    parts = []

    # Reference instruction
    parts.append("Match subject appearance exactly from reference images")

    # Scene description (this IS needed for R2V unlike I2V)
    subject = scene.get("subject", "")
    if isinstance(subject, dict):
        parts.append(f"Subject (match reference): {subject.get('appearance', '')}")
    elif subject:
        parts.append(f"Subject (match reference): {subject}")

    # Environment (NEW scene, not from reference)
    env = scene.get("environment", "")
    if isinstance(env, dict):
        setting = env.get("setting", "")
        if setting:
            parts.append(f"New scene environment: {setting}")
    elif env:
        parts.append(f"New scene environment: {env}")

    # Action
    action = scene.get("action", {})
    if isinstance(action, dict):
        primary = action.get("primary", "")
        if primary:
            parts.append(f"Action: {primary}")
    elif action:
        parts.append(f"Action: {action}")

    # Camera
    camera = scene.get("camera", {})
    if isinstance(camera, dict):
        movement = camera.get("movement_type", "")
        direction = camera.get("movement_direction", "")
        cam_parts = [p for p in [movement, direction] if p]
        if cam_parts:
            parts.append(f"Camera: {', '.join(cam_parts)}")

    # Style consistency with reference
    parts.append("Maintain reference style, color grade, and visual quality")

    # Metatokens
    metatokens = scene.get("metatokens", "")
    if isinstance(metatokens, dict):
        style = metatokens.get("visual_style", "")
        if style:
            parts.append(style)
    elif metatokens:
        parts.append(metatokens)

    parts.append("No text, no logos")

    # Camera transition (appended at end, outgoing only)
    if transition_id and is_transition_compatible(transition_id, "r2v"):
        fragment = get_transition_fragment(transition_id)
        if fragment:
            parts.append(fragment)

    return ". ".join(filter(None, parts)) + "."


# ==================== Motion Brief Generation ====================

def generate_motion_brief(scene: dict) -> dict:
    """
    Generate a structured motion brief from scene data.
    This intermediate format can be flattened to any mode.
    """
    action = scene.get("action", {})
    camera = scene.get("camera", {})

    # Handle both dict and string formats
    if isinstance(action, str):
        action = {"primary": action}
    if isinstance(camera, str):
        camera = {"description": camera}

    return {
        "camera_motion": {
            "type": camera.get("movement_type", "static"),
            "direction": camera.get("movement_direction", ""),
            "speed": camera.get("movement_speed", ""),
            "angle": camera.get("angle", "eye level"),
            "easing": "linear"
        },
        "subject_motion": {
            "primary": action.get("primary", ""),
            "secondary": action.get("secondary", []),
            "speed": action.get("speed", ""),
            "path": action.get("path", ""),
            "start_pose": action.get("start_pose", ""),
            "end_pose": action.get("end_pose", "")
        },
        "micromotion": scene.get("micromotion", {}),
        "timing": {
            "duration": f"{scene.get('duration_seconds', 3)} seconds",
            "keyframes": action.get("keyframes", [])
        }
    }


# ==================== Batch Processing ====================

def generate_prompts_for_scene(scene: dict, mode: str = "i2v") -> dict:
    """
    Generate all prompt variants for a single scene.
    """
    motion_brief = generate_motion_brief(scene)

    return {
        "scene_number": scene.get("scene_number"),
        "mode": mode,
        "motion_brief": motion_brief,
        "prompts": {
            "t2v": flatten_t2v_prompt(scene),
            "i2v": flatten_i2v_prompt(scene),
            "f2v": flatten_f2v_prompt(scene, scene.get("duration_seconds", 3)),
            "r2v": flatten_r2v_prompt(scene)
        },
        "selected_prompt": {
            "t2v": flatten_t2v_prompt,
            "i2v": flatten_i2v_prompt,
            "f2v": flatten_f2v_prompt,
            "r2v": flatten_r2v_prompt
        }[mode](scene)
    }


def batch_generate_prompts(scenes: list[dict], mode: str = "i2v") -> list[dict]:
    """
    Generate prompts for all scenes.
    """
    results = []
    for scene in scenes:
        result = generate_prompts_for_scene(scene, mode)
        results.append(result)
    return results


def process_project(project_slug: str, mode: str = "i2v", db: Optional["VideoReplicatorDB"] = None) -> list[dict]:
    """
    Generate prompts for all scenes in a project from database.
    """
    if not db:
        if VideoReplicatorDB:
            db = VideoReplicatorDB()
        else:
            raise MissingDependencyError("Database module not available")

    project = db.get_project(project_slug)
    if not project:
        raise ProjectError(f"Project not found: {project_slug}")

    scenes = db.get_scenes_for_project(project["id"])
    if not scenes:
        raise ManifestError(f"No scenes found for project: {project_slug}")

    results = []
    for scene in scenes:
        result = generate_prompts_for_scene(scene, mode)

        # Update database with new prompts
        db.update_scene_prompts(scene["id"], {
            "enhanced_video_prompt": result["selected_prompt"],
            "motion_brief_json": result["motion_brief"]
        })

        results.append(result)

    return results


# ==================== Main CLI ====================

def main():
    parser = argparse.ArgumentParser(description="Generate video prompts for different modes")
    parser.add_argument("--project", help="Project slug (reads from database)")
    parser.add_argument("--prompts", help="Rewritten prompts JSON file")
    parser.add_argument("--scene-data", help="Single scene data JSON file")
    parser.add_argument("--mode", choices=["t2v", "i2v", "f2v", "r2v"], default="i2v",
                        help="Generation mode: t2v (text), i2v (image), f2v (frames), r2v (reference)")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--all-modes", action="store_true", help="Generate all mode variants")
    args = parser.parse_args()

    # Determine input source
    if args.project:
        if not VideoReplicatorDB:
            print("Error: Database module not available")
            sys.exit(1)
        results = process_project(args.project, args.mode)

    elif args.prompts:
        with open(args.prompts) as f:
            data = json.load(f)
        scenes = data.get("scenes", [])
        results = batch_generate_prompts(scenes, args.mode)

    elif args.scene_data:
        with open(args.scene_data) as f:
            scene = json.load(f)
        results = [generate_prompts_for_scene(scene, args.mode)]

    else:
        print("Error: Provide --project, --prompts, or --scene-data")
        sys.exit(1)

    # Output
    output_data = {
        "mode": args.mode,
        "scene_count": len(results),
        "scenes": results
    }

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(output_data, f, indent=2)
        print(f"Prompts saved to: {args.output}")
    else:
        # Print summary to stdout
        print(f"\n=== Generated {args.mode.upper()} Prompts ===\n")
        for result in results:
            print(f"Scene {result['scene_number']}:")
            print(f"  {result['selected_prompt'][:100]}...")
            print()

    # Print all modes if requested
    if args.all_modes and results:
        print("\n=== All Mode Variants (Scene 1) ===\n")
        for mode_name, prompt in results[0]["prompts"].items():
            print(f"[{mode_name.upper()}]")
            print(f"  {prompt[:150]}...")
            print()


if __name__ == "__main__":
    main()
