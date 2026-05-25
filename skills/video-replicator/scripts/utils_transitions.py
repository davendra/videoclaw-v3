#!/usr/bin/env python3
"""
Transition scene detection and content filtering.

Extracted from utils.py — identifies transition/blank scenes in SEALCAM+
analysis and filters them from content scenes.
"""



def is_transition_scene(scene: dict) -> bool:
    """
    Check if a scene is a transition/blank scene that should be skipped.

    Transition scenes have minimal or N/A content and are typically
    blank backgrounds (white, black) or text overlays.

    Args:
        scene: Scene dict from SEALCAM+ analysis

    Returns:
        True if scene appears to be a transition/blank scene
    """
    if scene.get("scene_type") == "transition":
        return True
    if scene.get("skip_recommended", False):
        return True

    subject = scene.get("subject", {})
    if subject.get("appearance") in ["N/A", None, ""]:
        return True
    if subject.get("pose") in ["N/A", None, ""]:
        return True

    action = scene.get("action", {})
    if action.get("primary") in ["N/A", None, ""]:
        return True

    duration = scene.get("duration_seconds", 0)
    return duration < 1.5 and action.get("primary") in ["N/A", None, ""]


def filter_content_scenes(scenes: list[dict]) -> tuple[list[dict], list[int]]:
    """
    Filter out transition scenes from a list of scenes.

    Args:
        scenes: List of scene dicts from SEALCAM+ analysis

    Returns:
        Tuple of (content_scenes, skipped_scene_numbers)
    """
    content_scenes = []
    skipped = []

    for scene in scenes:
        if is_transition_scene(scene):
            skipped.append(scene.get("scene_number", 0))
        else:
            content_scenes.append(scene)

    return content_scenes, skipped
