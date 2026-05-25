#!/usr/bin/env python3
"""
Prompt Template System — structured prompt assembly for video generation.

Ensures every prompt includes character descriptions, style tags, and voice
direction in a consistent order.  Used by scene_breakdown.py to build
backend-specific prompts from screenplay data + style bible.

Usage:
    from prompt_template import build_shot_prompt, build_character_tag

    prompt = build_shot_prompt(
        visual_prompt="Camera pushes in on two figures in a dark alley",
        character_tags=["weathered detective in trench coat", "young informant in hoodie"],
        style_tag="taut thriller, desaturated teal grade",
        voice_prompt="Sound: distant sirens, rain on pavement. No music.",
    )
"""

from __future__ import annotations


def build_shot_prompt(
    visual_prompt: str,
    character_tags: list[str] | None = None,
    style_tag: str | None = None,
    voice_prompt: str | None = None,
) -> str:
    """Assemble a complete shot prompt from components.

    Order: VISUAL + CHARACTER_TAGS + STYLE_TAG + VOICE

    Args:
        visual_prompt: Core visual description (camera, action, environment).
        character_tags: Character description fragments to include.
        style_tag: Style bible tag (e.g., "cinematic drama, naturalistic color palette").
        voice_prompt: Audio direction (e.g., "Sound: footsteps on gravel. No music.").

    Returns:
        Assembled prompt string.
    """
    parts: list[str] = [visual_prompt.rstrip(". ")]

    if character_tags:
        for tag in character_tags:
            tag = tag.strip()
            if tag and tag.lower() not in visual_prompt.lower():
                parts.append(tag.rstrip(". "))

    if style_tag:
        style_tag = style_tag.strip()
        if style_tag and style_tag.lower() not in visual_prompt.lower():
            parts.append(style_tag.rstrip(". "))

    if voice_prompt:
        voice_prompt = voice_prompt.strip()
        if voice_prompt:
            parts.append(voice_prompt.rstrip(". "))

    return ". ".join(parts) + "."


def build_character_tag(character_dict: dict) -> str:
    """Extract a prompt-ready character tag from a character bible entry.

    Looks for ``prompt_tag``, ``base_prompt``, or falls back to
    ``name`` + ``description``.

    Args:
        character_dict: Character definition dict (from characters.json).

    Returns:
        Short character description string for prompt inclusion.
    """
    # Prefer explicit prompt_tag
    if character_dict.get("prompt_tag"):
        return character_dict["prompt_tag"]

    # Fall back to base_prompt (Go Bananas character)
    if character_dict.get("base_prompt"):
        return character_dict["base_prompt"]

    # Build from name + description
    name = character_dict.get("name", "")
    desc = character_dict.get("description", "")
    if name and desc:
        return f"{name}, {desc}"
    return name or desc or ""
