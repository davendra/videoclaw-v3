#!/usr/bin/env python3
"""
Prompt simplification and mix spec parsing.

Extracted from utils.py — progressively simplifies prompts for retry
logic and parses scene mix specifications for cherry-pick stitching.
"""

import contextlib
import re


def simplify_prompt(prompt: str, level: int) -> str:
    """
    Progressively simplify a prompt to increase generation success rate.

    Args:
        prompt: Original motion/action prompt
        level: Simplification level (0=original, 1=remove subtle, 2=camera+subject only, 3=minimal)

    Returns:
        Simplified prompt string
    """
    if level == 0:
        return prompt

    elif level == 1:
        simplified = re.sub(r'Subtle:[^.]*\.?\s*', '', prompt)
        simplified = re.sub(r'Ambient:[^.]*\.?\s*', '', simplified)
        simplified = re.sub(r'Also:[^.]*\.?\s*', '', simplified)
        return simplified.strip()

    elif level == 2:
        camera = re.search(r'Camera:[^.]+\.?', prompt)
        subject = re.search(r'Subject:[^.]+\.?', prompt)
        parts = []
        if camera:
            parts.append(camera.group().strip())
        if subject:
            parts.append(subject.group().strip())
        return ' '.join(parts) if parts else prompt

    else:  # level >= 3
        return "Gentle camera movement. Subject remains in frame. Smooth continuous motion."


def format_lipsync_prompt(
    character: str,
    dialogue: str,
    action: str = "",
    environment: str = "",
) -> str:
    """
    Format a Veo prompt for lip-synced dialogue using the proven pattern.

    Veo 3 generates lip-synced audio when dialogue is embedded in the prompt.
    This template ensures consistent results.

    Args:
        character: Character description (e.g. "commentator in a studio")
        dialogue: Spoken text (e.g. "Welcome to the show!")
        action: Physical actions (e.g. "gestures enthusiastically")
        environment: Scene setting (e.g. "modern TV studio with bright lights")

    Returns:
        Formatted prompt string
    """
    from config import LIP_SYNC_PROMPT_PATTERN

    return LIP_SYNC_PROMPT_PATTERN.format(
        character=character,
        dialogue=dialogue,
        action=action if action else "Natural gestures",
        environment=environment if environment else "Professional setting",
    )


def format_lipsync_prompt_from_scene(
    scene_prompt: str,
    dialogue: str,
) -> str:
    """
    Wrap an existing scene prompt with the lip-sync dialogue pattern.

    Prepends the "speaks directly to camera saying:" pattern to the
    existing prompt, which triggers Veo's lip-sync audio generation.

    Args:
        scene_prompt: Existing motion/scene prompt
        dialogue: Dialogue text to lip-sync

    Returns:
        Modified prompt with dialogue embedded
    """
    # Extract character info from the prompt (first sentence or clause)
    # Common patterns: "A man...", "The woman...", "Character name..."
    first_part = scene_prompt.split(".")[0].strip()

    return (
        f'{first_part} speaks directly to camera saying: "{dialogue}". '
        f"{scene_prompt}"
    )


def parse_mix_spec(mix_str: str, total_scenes: int) -> dict[int, str]:
    """
    Parse scene mix specification into {scene_num: run_id} mapping.

    Used by stitch_video.py --mix flag to cherry-pick scenes from different runs.

    Args:
        mix_str: Mix specification like "run001:2,4 run002:*"
        total_scenes: Total number of scenes in the video

    Returns:
        Dict mapping scene number to run ID

    Examples:
        >>> parse_mix_spec("run001:2,4 run002:*", 5)
        {1: "run002", 2: "run001", 3: "run002", 4: "run001", 5: "run002"}
    """
    scene_map = {}
    default_run = None

    parts = mix_str.strip().split()
    for part in parts:
        if ':' not in part:
            continue
        run_id, scenes_str = part.split(':', 1)

        if scenes_str == '*':
            default_run = run_id
        else:
            for scene in scenes_str.split(','):
                with contextlib.suppress(ValueError):
                    scene_map[int(scene.strip())] = run_id

    if default_run:
        for i in range(1, total_scenes + 1):
            if i not in scene_map:
                scene_map[i] = default_run

    return scene_map
