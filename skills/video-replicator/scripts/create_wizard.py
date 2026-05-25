#!/usr/bin/env python3
"""
CREATE Mode Wizard - Interactive scene builder for video-replicator.
Builds SEALCAM+ JSON from user input without requiring a reference video.

Usage:
    python create_wizard.py --project "summer-sandals" --output "projects/summer-sandals/analysis/sealcam_analysis.json"
    python create_wizard.py --project "brand-launch" --interactive
    python create_wizard.py --config "scene_config.json" --output "sealcam_analysis.json"

The wizard can be run interactively or with a pre-filled config JSON.

Requirements:
    pip install google-generativeai  # Optional, for AI-assisted scene descriptions
"""

import argparse
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    from db import VideoReplicatorDB
except ImportError:
    VideoReplicatorDB = None


# ============================================================================
# Scene Templates by Video Type
# ============================================================================

SCENE_TEMPLATES = {
    "product_ad": {
        "name": "Product Ad",
        "description": "Classic product showcase with hero shots and lifestyle context",
        "default_scenes": 4,
        "default_duration": 15,
        "structure": [
            {
                "type": "hero_shot",
                "name": "Product Hero",
                "description": "Close-up product shot with dramatic lighting",
                "camera": {"movement_type": "push_in", "shot_type": "close-up"},
                "lighting": {"setup": "studio", "quality": "dramatic"},
            },
            {
                "type": "lifestyle",
                "name": "Product in Context",
                "description": "Product being used in real-world setting",
                "camera": {"movement_type": "tracking", "shot_type": "medium"},
                "lighting": {"setup": "natural", "quality": "soft"},
            },
            {
                "type": "character_interaction",
                "name": "Model Interaction",
                "description": "Character/model interacting with product",
                "camera": {"movement_type": "tracking", "shot_type": "medium"},
                "lighting": {"setup": "mixed", "quality": "flattering"},
            },
            {
                "type": "final_shot",
                "name": "Final Branding",
                "description": "Product with brand moment, logo-safe composition",
                "camera": {"movement_type": "static", "shot_type": "wide"},
                "lighting": {"setup": "studio", "quality": "clean"},
            },
        ],
    },
    "fashion_lifestyle": {
        "name": "Fashion/Lifestyle",
        "description": "Model-focused content with outfit reveals and poses",
        "default_scenes": 5,
        "default_duration": 30,
        "structure": [
            {
                "type": "establishing",
                "name": "Location Reveal",
                "description": "Wide establishing shot of location",
                "camera": {"movement_type": "pan", "shot_type": "wide"},
                "lighting": {"setup": "natural", "quality": "atmospheric"},
            },
            {
                "type": "entrance",
                "name": "Model Entrance",
                "description": "Model enters frame or walks into scene",
                "camera": {"movement_type": "tracking", "shot_type": "full"},
                "lighting": {"setup": "natural", "quality": "flattering"},
            },
            {
                "type": "detail",
                "name": "Outfit Details",
                "description": "Close-ups of outfit, accessories, fabric",
                "camera": {"movement_type": "static", "shot_type": "close-up"},
                "lighting": {"setup": "rim", "quality": "dramatic"},
            },
            {
                "type": "hero_pose",
                "name": "Hero Pose",
                "description": "Model in confident, styled pose",
                "camera": {"movement_type": "orbit", "shot_type": "medium"},
                "lighting": {"setup": "golden_hour", "quality": "warm"},
            },
            {
                "type": "exit",
                "name": "Exit/Fade",
                "description": "Model walks away or scene fades",
                "camera": {"movement_type": "pull_out", "shot_type": "wide"},
                "lighting": {"setup": "natural", "quality": "soft"},
            },
        ],
    },
    "brand_story": {
        "name": "Brand Story",
        "description": "Narrative-driven content telling a brand or product story",
        "default_scenes": 6,
        "default_duration": 45,
        "structure": [
            {
                "type": "hook",
                "name": "Opening Hook",
                "description": "Attention-grabbing opening shot",
                "camera": {"movement_type": "crane", "shot_type": "wide"},
                "lighting": {"setup": "cinematic", "quality": "dramatic"},
            },
            {
                "type": "context",
                "name": "Setting Context",
                "description": "Establish the situation or problem",
                "camera": {"movement_type": "dolly", "shot_type": "medium"},
                "lighting": {"setup": "natural", "quality": "realistic"},
            },
            {
                "type": "introduction",
                "name": "Subject Introduction",
                "description": "Introduce main character or product",
                "camera": {"movement_type": "push_in", "shot_type": "medium"},
                "lighting": {"setup": "mixed", "quality": "flattering"},
            },
            {
                "type": "action",
                "name": "Main Action",
                "description": "Core action or transformation",
                "camera": {"movement_type": "tracking", "shot_type": "full"},
                "lighting": {"setup": "dynamic", "quality": "energetic"},
            },
            {
                "type": "result",
                "name": "Result/Benefit",
                "description": "Show the outcome or benefit",
                "camera": {"movement_type": "orbit", "shot_type": "medium"},
                "lighting": {"setup": "uplifting", "quality": "bright"},
            },
            {
                "type": "cta",
                "name": "Call to Action",
                "description": "Final shot with implied CTA",
                "camera": {"movement_type": "static", "shot_type": "wide"},
                "lighting": {"setup": "studio", "quality": "clean"},
            },
        ],
    },
    "social_reel": {
        "name": "Social Reel",
        "description": "Fast-paced, vertical content for TikTok/Reels",
        "default_scenes": 3,
        "default_duration": 15,
        "default_ratio": "9:16",
        "structure": [
            {
                "type": "hook",
                "name": "Scroll-Stopper",
                "description": "Immediate attention-grabber (first 1-2 seconds)",
                "camera": {"movement_type": "static", "shot_type": "close-up"},
                "lighting": {"setup": "punchy", "quality": "vibrant"},
            },
            {
                "type": "content",
                "name": "Main Content",
                "description": "Core message or product showcase",
                "camera": {"movement_type": "handheld", "shot_type": "medium"},
                "lighting": {"setup": "trendy", "quality": "high-contrast"},
            },
            {
                "type": "payoff",
                "name": "Payoff/Reveal",
                "description": "Satisfying conclusion or reveal",
                "camera": {"movement_type": "zoom", "shot_type": "varies"},
                "lighting": {"setup": "dynamic", "quality": "impactful"},
            },
        ],
    },
}

# ============================================================================
# Default Values
# ============================================================================

LIGHTING_PRESETS = {
    "golden_hour": {
        "setup": "natural",
        "direction": "side-back",
        "quality": "soft, warm",
        "shadows": "long, dramatic",
    },
    "studio": {
        "setup": "3-point",
        "direction": "front with fill",
        "quality": "controlled, even",
        "shadows": "minimal",
    },
    "natural": {
        "setup": "available light",
        "direction": "varies",
        "quality": "soft, diffused",
        "shadows": "soft",
    },
    "dramatic": {
        "setup": "single source",
        "direction": "side",
        "quality": "hard, directional",
        "shadows": "deep, defined",
    },
    "soft": {
        "setup": "diffused",
        "direction": "front",
        "quality": "even, flattering",
        "shadows": "minimal",
    },
}

CAMERA_MOVEMENTS = {
    "static": {"movement_type": "static", "movement_speed": "none", "movement_direction": "none"},
    "push_in": {"movement_type": "dolly", "movement_speed": "slow", "movement_direction": "forward"},
    "pull_out": {"movement_type": "dolly", "movement_speed": "slow", "movement_direction": "backward"},
    "pan": {"movement_type": "pan", "movement_speed": "medium", "movement_direction": "left-to-right"},
    "track": {"movement_type": "tracking", "movement_speed": "matches subject", "movement_direction": "parallel"},
    "orbit": {"movement_type": "arc", "movement_speed": "slow", "movement_direction": "circular"},
    "crane": {"movement_type": "crane", "movement_speed": "smooth", "movement_direction": "up-down"},
    "handheld": {"movement_type": "handheld", "movement_speed": "subtle", "movement_direction": "organic"},
}

MUSIC_PRESETS = {
    "upbeat_energetic": {
        "style": "upbeat electronic",
        "tempo_bpm": 120,
        "instruments": ["synths", "drums", "bass"],
        "mood": "energetic, motivating",
    },
    "chill_relaxed": {
        "style": "lo-fi chill",
        "tempo_bpm": 85,
        "instruments": ["soft piano", "ambient pads", "gentle percussion"],
        "mood": "relaxed, warm",
    },
    "dramatic": {
        "style": "cinematic orchestral",
        "tempo_bpm": 100,
        "instruments": ["strings", "brass", "percussion"],
        "mood": "epic, emotional",
    },
    "elegant": {
        "style": "minimal elegant",
        "tempo_bpm": 95,
        "instruments": ["piano", "strings", "subtle electronic"],
        "mood": "sophisticated, refined",
    },
    "trendy_modern": {
        "style": "modern pop/electronic",
        "tempo_bpm": 110,
        "instruments": ["trap beats", "synth bass", "vocal chops"],
        "mood": "current, fresh",
    },
}


# ============================================================================
# Data Collection Functions
# ============================================================================


def collect_project_info(interactive: bool = True) -> dict:
    """Collect basic project information."""
    if interactive:
        print("\n" + "=" * 60)
        print("  PROJECT SETUP")
        print("=" * 60)

        name = input("\nProject name (slug, e.g., 'summer-sandals'): ").strip()
        if not name:
            name = "untitled-project"

        print("\nVideo type options:")
        print("  1. Product Ad - Classic product showcase")
        print("  2. Fashion/Lifestyle - Model-focused content")
        print("  3. Brand Story - Narrative-driven")
        print("  4. Social Reel - Fast-paced vertical")

        type_choice = input("\nSelect video type [1-4]: ").strip()
        type_map = {
            "1": "product_ad",
            "2": "fashion_lifestyle",
            "3": "brand_story",
            "4": "social_reel",
        }
        video_type = type_map.get(type_choice, "product_ad")

        return {"name": name, "type": video_type}
    else:
        return {"name": "untitled", "type": "product_ad"}


def collect_assets(interactive: bool = True) -> dict:
    """Collect product and character assets."""
    assets = {"products": [], "characters": []}

    if not interactive:
        return assets

    print("\n" + "=" * 60)
    print("  ASSET COLLECTION")
    print("=" * 60)

    # Product
    has_product = input("\nDo you have a product to feature? [y/n]: ").strip().lower()
    if has_product == "y":
        product_image = input("Product image path or URL: ").strip()
        product_desc = input("Describe your product in detail: ").strip()
        product_name = input("Product name (for Go Bananas): ").strip() or "main_product"

        assets["products"].append({
            "name": product_name,
            "image": product_image,
            "description": product_desc,
        })

    # Characters
    char_count = input("\nHow many characters/models? [0-3]: ").strip()
    try:
        char_count = int(char_count)
    except ValueError:
        char_count = 0

    for i in range(min(char_count, 3)):
        print(f"\n--- Character {i + 1} ---")
        char_image = input("Reference image path or URL: ").strip()
        char_desc = input("Describe this character (appearance, style, vibe): ").strip()
        char_name = input("Character name (for Go Bananas): ").strip() or f"character_{i + 1}"

        assets["characters"].append({
            "name": char_name,
            "image": char_image,
            "description": char_desc,
        })

    return assets


def collect_video_format(video_type: str, interactive: bool = True) -> dict:
    """Collect video format specifications."""
    template = SCENE_TEMPLATES.get(video_type, SCENE_TEMPLATES["product_ad"])

    defaults = {
        "aspect_ratio": template.get("default_ratio", "16:9"),
        "duration": template.get("default_duration", 15),
        "scene_count": template.get("default_scenes", 4),
    }

    if not interactive:
        return defaults

    print("\n" + "=" * 60)
    print("  VIDEO FORMAT")
    print("=" * 60)

    print("\nAspect ratio options:")
    print("  1. Landscape 16:9 (YouTube, Web)")
    print("  2. Portrait 9:16 (Reels, TikTok)")
    print("  3. Square 1:1 (Instagram Feed)")

    ratio_choice = input(f"\nSelect aspect ratio [1-3] (default: {'2' if defaults['aspect_ratio'] == '9:16' else '1'}): ").strip()
    ratio_map = {"1": "16:9", "2": "9:16", "3": "1:1"}
    aspect_ratio = ratio_map.get(ratio_choice, defaults["aspect_ratio"])

    duration = input(f"\nTarget duration in seconds [default: {defaults['duration']}]: ").strip()
    try:
        duration = int(duration) if duration else defaults["duration"]
    except ValueError:
        duration = defaults["duration"]

    scene_count = input(f"\nNumber of scenes [default: {defaults['scene_count']}]: ").strip()
    try:
        scene_count = int(scene_count) if scene_count else defaults["scene_count"]
    except ValueError:
        scene_count = defaults["scene_count"]

    return {
        "aspect_ratio": aspect_ratio,
        "duration": duration,
        "scene_count": scene_count,
    }


def collect_scene_details(
    scene_num: int,
    template_scene: dict | None = None,
    assets: dict = None,
    interactive: bool = True,
) -> dict:
    """Collect details for a single scene."""
    if template_scene is None:
        template_scene = {}

    if not interactive:
        return build_default_scene(scene_num, template_scene, assets)

    print(f"\n--- Scene {scene_num}: {template_scene.get('name', 'Custom Scene')} ---")
    if template_scene.get("description"):
        print(f"Suggested: {template_scene['description']}")

    # Environment/Setting
    setting = input("\nDescribe the setting/environment: ").strip()
    if not setting:
        setting = "minimalist studio with neutral backdrop"

    # Action
    print("\nAction type options:")
    print("  1. Static pose")
    print("  2. Walking/Movement")
    print("  3. Product interaction")
    print("  4. Reveal/Transition")
    print("  5. Custom action")

    action_choice = input("Select action type [1-5]: ").strip()
    if action_choice == "5":
        action_desc = input("Describe the action: ").strip()
    else:
        action_map = {
            "1": "holds pose, minimal movement",
            "2": "walks through frame left to right",
            "3": "interacts with product, examining and showcasing",
            "4": "product/subject revealed with dramatic lighting",
        }
        action_desc = action_map.get(action_choice, "natural movement")

    # Lighting
    print("\nLighting mood options:")
    print("  1. Golden hour (warm, soft)")
    print("  2. Studio (controlled, even)")
    print("  3. Natural (available light)")
    print("  4. Dramatic (high contrast)")
    print("  5. Soft (flattering, minimal shadows)")

    lighting_choice = input("Select lighting mood [1-5]: ").strip()
    lighting_map = {
        "1": "golden_hour",
        "2": "studio",
        "3": "natural",
        "4": "dramatic",
        "5": "soft",
    }
    lighting_key = lighting_map.get(lighting_choice, "natural")
    lighting = LIGHTING_PRESETS[lighting_key].copy()

    # Camera
    print("\nCamera movement options:")
    print("  1. Static (no movement)")
    print("  2. Push in (dolly forward)")
    print("  3. Pull out (dolly backward)")
    print("  4. Pan (horizontal sweep)")
    print("  5. Track (follow subject)")
    print("  6. Orbit (arc around)")
    print("  7. Handheld (organic, subtle)")

    camera_choice = input("Select camera movement [1-7]: ").strip()
    camera_map = {
        "1": "static",
        "2": "push_in",
        "3": "pull_out",
        "4": "pan",
        "5": "track",
        "6": "orbit",
        "7": "handheld",
    }
    camera_key = camera_map.get(camera_choice, "static")
    camera = CAMERA_MOVEMENTS[camera_key].copy()

    # Add shot type from template or default
    template_camera = template_scene.get("camera", {})
    camera["shot_type"] = template_camera.get("shot_type", "medium")
    camera["angle"] = "eye level"
    camera["focus"] = "follow focus"

    return {
        "scene_number": scene_num,
        "template_type": template_scene.get("type", "custom"),
        "setting": setting,
        "action_description": action_desc,
        "lighting": lighting,
        "camera": camera,
    }


def collect_music_mood(interactive: bool = True) -> dict:
    """Collect music preferences."""
    if not interactive:
        return MUSIC_PRESETS["elegant"].copy()

    print("\n" + "=" * 60)
    print("  MUSIC & MOOD")
    print("=" * 60)

    print("\nMusic style options:")
    print("  1. Upbeat/Energetic")
    print("  2. Chill/Relaxed")
    print("  3. Dramatic")
    print("  4. Elegant")
    print("  5. Trendy/Modern")

    music_choice = input("\nSelect music style [1-5]: ").strip()
    music_map = {
        "1": "upbeat_energetic",
        "2": "chill_relaxed",
        "3": "dramatic",
        "4": "elegant",
        "5": "trendy_modern",
    }
    music_key = music_map.get(music_choice, "elegant")
    music = MUSIC_PRESETS[music_key].copy()

    custom_vibe = input("\nAny specific vibe? (e.g., 'Indian fusion', 'acoustic', leave blank to skip): ").strip()
    if custom_vibe:
        music["custom_vibe"] = custom_vibe
        music["style"] = f"{music['style']}, {custom_vibe}"

    return music


# ============================================================================
# SEALCAM+ JSON Building
# ============================================================================


def build_default_scene(scene_num: int, template: dict, assets: dict) -> dict:
    """Build a default scene from template."""
    return {
        "scene_number": scene_num,
        "template_type": template.get("type", "custom"),
        "setting": "minimalist studio",
        "action_description": "natural movement",
        "lighting": LIGHTING_PRESETS["studio"].copy(),
        "camera": CAMERA_MOVEMENTS["static"].copy(),
    }


def build_sealcam_scene(
    scene_data: dict,
    scene_num: int,
    total_scenes: int,
    duration: int,
    assets: dict,
) -> dict:
    """Convert collected scene data to SEALCAM+ format."""
    scene_duration = duration / total_scenes

    # Build subject from assets
    subject = {"appearance": "as specified in reference images", "pose": "natural", "position_in_frame": "center", "facing_direction": "camera"}

    if assets.get("characters"):
        char = assets["characters"][0]
        subject["appearance"] = char.get("description", subject["appearance"])
        subject["go_bananas_ref"] = char.get("name")

    if assets.get("products"):
        prod = assets["products"][0]
        subject["product"] = prod.get("description", "")
        subject["product_ref"] = prod.get("name")

    # Build environment
    environment = {
        "setting": scene_data.get("setting", "studio"),
        "depth_layers": {"foreground": "empty", "midground": "subject", "background": "backdrop"},
        "ground_plane": "neutral surface",
        "atmospheric_elements": None,
    }

    # Build action with keyframes
    action_desc = scene_data.get("action_description", "natural movement")
    action = {
        "primary": action_desc,
        "secondary": [],
        "speed": "medium (50%)",
        "path": "within frame",
        "start_pose": "initial position",
        "end_pose": "final position",
        "keyframes": [
            {"time": "0.0s", "percentage": "0%", "description": "scene start"},
            {"time": f"{scene_duration/2:.1f}s", "percentage": "50%", "description": "midpoint"},
            {"time": f"{scene_duration:.1f}s", "percentage": "100%", "description": "scene end"},
        ],
    }

    # Build camera
    camera_data = scene_data.get("camera", {})
    camera = {
        "shot_type": camera_data.get("shot_type", "medium"),
        "angle": camera_data.get("angle", "eye level"),
        "movement_type": camera_data.get("movement_type", "static"),
        "movement_speed": camera_data.get("movement_speed", "none"),
        "movement_direction": camera_data.get("movement_direction", "none"),
        "focus": camera_data.get("focus", "follow focus"),
    }

    # Build lighting
    lighting_data = scene_data.get("lighting", {})
    lighting = {
        "setup": lighting_data.get("setup", "studio"),
        "direction": lighting_data.get("direction", "front"),
        "quality": lighting_data.get("quality", "soft"),
        "shadows": lighting_data.get("shadows", "minimal"),
    }

    # Micromotion defaults
    micromotion = {"breathing": "subtle", "fabric": "natural movement", "hair": "slight sway" if any(assets.get("characters", [])) else None, "weight_shifts": "natural"}

    # Metatokens
    metatokens = {"visual_style": "cinematic, professional", "era": "modern", "quality": "8K", "mood": "sophisticated"}

    return {
        "scene_number": scene_num,
        "timestamp": f"{(scene_num-1)*scene_duration:.0f}s-{scene_num*scene_duration:.0f}s",
        "duration_seconds": scene_duration,
        "subject": subject,
        "environment": environment,
        "action": action,
        "micromotion": micromotion,
        "lighting": lighting,
        "camera": camera,
        "audio": None,  # Set at top level
        "metatokens": metatokens,
    }


def build_sealcam_json(project: dict, assets: dict, format_spec: dict, scenes: list, music: dict) -> dict:
    """Build complete SEALCAM+ JSON from collected data."""
    total_scenes = len(scenes)
    duration = format_spec.get("duration", 15)

    # Build scene list
    sealcam_scenes = []
    for i, scene_data in enumerate(scenes, 1):
        sealcam_scene = build_sealcam_scene(scene_data, i, total_scenes, duration, assets)
        sealcam_scenes.append(sealcam_scene)

    # Build music prompt
    music_prompt = f"{music.get('style', 'elegant')}, {music.get('tempo_bpm', 95)} BPM, "
    music_prompt += f"instruments: {', '.join(music.get('instruments', ['piano', 'strings']))}, "
    music_prompt += f"mood: {music.get('mood', 'sophisticated')}"

    # Build continuity notes
    continuity = {"subject_consistency": "Maintain consistent subject appearance across all scenes using Go Bananas character/product references", "scene_transitions": []}

    for i in range(1, total_scenes):
        continuity["scene_transitions"].append({
            "from": i,
            "to": i + 1,
            "transition_type": "cut",
            "continuity_concern": "subject position and lighting",
        })

    result = {
        "video_analysis": {
            "overall_vibe": f"{SCENE_TEMPLATES.get(project['type'], {}).get('name', 'Custom')} video",
            "total_duration": duration,
            "scene_count": total_scenes,
            "pacing": "even scene distribution",
            "brand_category": project.get("type", "general"),
            "aspect_ratio": format_spec.get("aspect_ratio", "16:9"),
        },
        "scenes": sealcam_scenes,
        "music_prompt": music_prompt,
        "continuity_notes": continuity,
        "assets": assets,
        "_metadata": {
            "source": "create_wizard",
            "mode": "CREATE",
            "project_name": project.get("name", "untitled"),
            "video_type": project.get("type", "custom"),
            "framework": "SEALCAM+",
        },
    }

    return result


# ============================================================================
# Config File Support
# ============================================================================


def load_config(config_path: str) -> dict:
    """Load configuration from JSON file."""
    with open(config_path) as f:
        return json.load(f)


def build_from_config(config: dict) -> dict:
    """Build SEALCAM+ JSON from config file."""
    project = config.get("project", {"name": "untitled", "type": "product_ad"})
    assets = config.get("assets", {"products": [], "characters": []})
    format_spec = config.get("format", {"aspect_ratio": "16:9", "duration": 15, "scene_count": 4})
    scenes = config.get("scenes", [])
    music = config.get("music", MUSIC_PRESETS["elegant"])

    # If scenes not provided, build from template
    if not scenes:
        template = SCENE_TEMPLATES.get(project.get("type", "product_ad"), SCENE_TEMPLATES["product_ad"])
        for i, template_scene in enumerate(template["structure"][: format_spec["scene_count"]], 1):
            scenes.append(build_default_scene(i, template_scene, assets))

    return build_sealcam_json(project, assets, format_spec, scenes, music)


# ============================================================================
# Database Integration
# ============================================================================


def save_to_database(result: dict, project_slug: str) -> dict:
    """Save analysis results to database."""
    if not VideoReplicatorDB:
        print("Warning: Database module not available, skipping DB save")
        return result

    db = VideoReplicatorDB()

    # Get or create project
    project = db.get_or_create_project(project_slug, project_slug)
    project_id = project["id"]

    # Save analysis
    analysis_id = db.save_analysis(project_id, result, gemini_model="create_wizard")

    # Save each scene
    scenes = result.get("scenes", [])
    for scene in scenes:
        db.save_scene(analysis_id, project_id, scene)

    print(f"Saved to database: project_id={project_id}, analysis_id={analysis_id}")
    print(f"  Saved {len(scenes)} scenes")

    result["_database"] = {"project_id": project_id, "analysis_id": analysis_id, "scenes_saved": len(scenes)}

    db.close()
    return result


# ============================================================================
# Main Interactive Flow
# ============================================================================


def run_interactive_wizard(project_slug: str = None) -> dict:
    """Run the full interactive wizard."""
    print("\n" + "=" * 60)
    print("  VIDEO REPLICATOR - CREATE MODE")
    print("  Interactive Scene Builder")
    print("=" * 60)

    # Phase 0: Project Setup
    project = collect_project_info(interactive=True)
    if project_slug:
        project["name"] = project_slug

    # Phase 1: Asset Collection
    assets = collect_assets(interactive=True)

    # Phase 2: Video Format
    format_spec = collect_video_format(project["type"], interactive=True)

    # Phase 3: Scene-by-Scene Design
    print("\n" + "=" * 60)
    print("  SCENE DESIGN")
    print("=" * 60)

    template = SCENE_TEMPLATES.get(project["type"], SCENE_TEMPLATES["product_ad"])
    template_structure = template["structure"]

    print(f"\nSuggested structure for {template['name']}:")
    for i, ts in enumerate(template_structure[: format_spec["scene_count"]], 1):
        print(f"  Scene {i}: {ts['name']} - {ts['description']}")

    use_template = input("\nUse this structure? [y/n]: ").strip().lower()

    scenes = []
    for i in range(1, format_spec["scene_count"] + 1):
        template_scene = template_structure[i - 1] if i <= len(template_structure) else {}

        if use_template == "y":
            # Quick mode with template defaults
            print(f"\n--- Scene {i}: {template_scene.get('name', 'Scene')} ---")
            customize = input("Customize this scene? [y/n]: ").strip().lower()
            if customize == "y":
                scene = collect_scene_details(i, template_scene, assets, interactive=True)
            else:
                scene = build_default_scene(i, template_scene, assets)
                scene["setting"] = input("Setting (or Enter for default): ").strip() or "minimalist studio"
        else:
            scene = collect_scene_details(i, template_scene, assets, interactive=True)

        scenes.append(scene)

    # Phase 4: Music
    music = collect_music_mood(interactive=True)

    # Build final JSON
    result = build_sealcam_json(project, assets, format_spec, scenes, music)

    # Summary
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"\nProject: {project['name']}")
    print(f"Type: {template['name']}")
    print(f"Format: {format_spec['aspect_ratio']}, {format_spec['duration']}s, {format_spec['scene_count']} scenes")
    print(f"Assets: {len(assets['products'])} products, {len(assets['characters'])} characters")
    print(f"Music: {music['style']}")

    return result


# ============================================================================
# Main Entry Point
# ============================================================================


def main():
    parser = argparse.ArgumentParser(description="CREATE mode wizard for video-replicator")
    parser.add_argument("--project", help="Project slug name")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--config", help="Load from config JSON instead of interactive")
    parser.add_argument("--interactive", action="store_true", help="Force interactive mode")
    parser.add_argument("--save-to-db", action="store_true", help="Save to SQLite database")
    args = parser.parse_args()

    if args.config and not args.interactive:
        # Load from config file
        print(f"Loading configuration from: {args.config}")
        config = load_config(args.config)
        result = build_from_config(config)
    else:
        # Run interactive wizard
        result = run_interactive_wizard(args.project)

    # Save to database if requested
    if args.save_to_db and args.project:
        result = save_to_database(result, args.project)

    # Ensure output directory exists
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write output
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  SEALCAM+ JSON saved to: {args.output}")
    print(f"{'='*60}")

    # Print next steps
    print("\nNext steps:")
    print("  1. Create Go Bananas references for characters/products")
    print("  2. Generate first-frame images with Go Bananas")
    print("  3. Generate videos with veo-cli")
    print("  4. Generate music (optional)")
    print("  5. Stitch final video")
    print(f"\nContinue with: python scripts/parallel_video_gen.py --product \"{result['_metadata']['project_name']}\" ...")


if __name__ == "__main__":
    main()
