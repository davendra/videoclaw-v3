#!/usr/bin/env python3
"""
I2V/F2V command building helpers.

Extracted from utils.py — formats prompts and builds veo-cli command
arrays for image-to-video and frames-to-video modes.
"""

import os


def format_i2v_prompt(image_path: str, prompt: str, tag: str) -> str:
    """
    Format a prompt for I2V (image-to-video) mode.

    Both direct and useapi backends require the image: prefix in the prompt text.

    Args:
        image_path: Absolute path to the first-frame image
        prompt: Motion/action prompt
        tag: Tag for the prompt (e.g., "scene_1")

    Returns:
        Formatted prompt string: "[tag] image:/path/to/image.jpg motion prompt"
    """
    abs_path = os.path.abspath(image_path)
    return f"[{tag}] image:{abs_path} {prompt}"


def format_f2v_prompt(start_image: str, end_image: str, prompt: str, tag: str) -> str:
    """
    Format a prompt for F2V (frames-to-video) mode with start and end frames.

    Returns:
        Formatted prompt string: "[tag] frames:/start.jpg,/end.jpg prompt"
    """
    abs_start = os.path.abspath(start_image)
    abs_end = os.path.abspath(end_image)
    return f"[{tag}] frames:{abs_start},{abs_end} {prompt}"


def build_veo_command(
    prompt: str,
    num_outputs: int = 1,
    ratio: str = "landscape",
    quality: str = "fast",
    backend: str = "useapi"
) -> list[str]:
    """
    Build a veo-cli command array suitable for subprocess.run().

    Args:
        prompt: Full formatted prompt (including [tag] and any image: prefix)
        num_outputs: Number of video outputs (1-4)
        ratio: "landscape" or "portrait"
        quality: "fast", "quality", or "free"
        backend: "direct" or "useapi"

    Returns:
        Command array for subprocess.run()
    """
    cmd = [
        "bun", "run", "google.ts",
        "-p", prompt,
        "-n", str(num_outputs),
        "-r", ratio,
        "-m", quality,
    ]

    if backend and backend != "direct":
        cmd.extend(["--backend", backend])
        cmd.append("--yes")

    return cmd
