#!/usr/bin/env python3
"""
veo-cli Video Generation Wrapper
Generates videos using veo-cli (Google Veo via browser automation).

Usage:
    # Text-to-video
    python generate_video_flow.py \
        --prompt "A polar bear sitting in a studio" \
        --output "output_video.mp4"

    # Image-to-video (frames-to-video)
    python generate_video_flow.py \
        --image "path/to/first_frame.png" \
        --prompt "Camera slowly dollies in, subject turns head" \
        --output "output_video.mp4"

Prerequisites:
    - veo-cli installed: /Users/davendrapatel/Documents/GitHub/video-creation-projects/veo-cli
    - Bun runtime installed: brew install oven-sh/bun/bun
    - Google account authenticated (first run requires manual login with --visible)

Environment:
    VEO_CLI_PATH - Optional custom path to veo-cli
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys

# Default path to veo-cli
from config import VEO_CLI_PATH as DEFAULT_VEO_PATH
from exceptions import MissingDependencyError, VeoCliError


def run_veo_generator(
    prompt: str,
    output_path: str,
    veo_path: str = None,
    image_path: str = None,
    quality: str = "fast",
    ratio: str = "landscape",
    tag: str = "video"
) -> dict:
    """
    Run veo-cli to generate a video.

    Args:
        prompt: Video generation prompt
        output_path: Where to save the output video
        veo_path: Path to veo-cli directory
        image_path: Optional image for image-to-video mode
        quality: "fast" or "quality"
        ratio: "landscape" or "portrait"
        tag: Tag for output filename (used by veo-cli)

    Returns:
        Dict with success status, paths, and any errors
    """
    veo_path = veo_path or os.environ.get("VEO_CLI_PATH", DEFAULT_VEO_PATH)

    if not os.path.exists(os.path.join(veo_path, "google.ts")):
        raise MissingDependencyError(f"veo-cli not found at: {veo_path}/google.ts")

    # Ensure output directory exists
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    # Build veo-cli prompt format
    veo_prompt = f"[{tag}] image:{image_path} {prompt}" if image_path else f"[{tag}] {prompt}"

    # Build command
    cmd = [
        "bun", "run", "google.ts",
        "-p", veo_prompt,
        "-n", "1",          # Single output for this wrapper
        "-r", ratio,
        "-m", quality,
    ]

    print("Running veo-cli...")
    print(f"Prompt: {veo_prompt[:100]}{'...' if len(veo_prompt) > 100 else ''}")
    print(f"Mode: {'image-to-video' if image_path else 'text-to-video'}")
    print(f"Quality: {quality}, Ratio: {ratio}")

    # Run the generator
    result = subprocess.run(
        cmd,
        cwd=veo_path,
        capture_output=True,
        text=True,
        timeout=900  # 15 minute timeout
    )

    if result.returncode != 0:
        print(f"Error: {result.stderr[:500]}")
        raise VeoCliError(f"veo-cli failed: {result.stderr[:500]}")

    print(result.stdout)

    # Find the generated video in veo-cli's output directory
    veo_output_dir = os.path.join(veo_path, "output-videos")
    if os.path.exists(veo_output_dir):
        # Get files matching the tag (most recent first)
        pattern = os.path.join(veo_output_dir, f"*_{tag}*.mp4")
        mp4_files = sorted(
            glob.glob(pattern),
            key=os.path.getmtime,
            reverse=True
        )
        if mp4_files:
            source_video = mp4_files[0]
            # Copy to output path
            shutil.copy2(source_video, output_path)
            print(f"Video saved to: {output_path}")
            return {
                "success": True,
                "output_path": output_path,
                "source_path": source_video,
                "prompt": prompt
            }

    return {
        "success": False,
        "error": "No video file found in output-videos",
        "prompt": prompt
    }


def generate_from_image(image_path: str, motion_prompt: str, output_path: str, **kwargs) -> dict:
    """
    Generate video from an image using veo-cli's image-to-video mode.

    Args:
        image_path: Path to the starting frame image
        motion_prompt: Prompt describing the motion/action
        output_path: Where to save the output video
        **kwargs: Additional arguments passed to run_veo_generator

    Returns:
        Dict with success status, paths, and any errors
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")

    print(f"Using image-to-video mode with: {image_path}")
    return run_veo_generator(
        prompt=motion_prompt,
        output_path=output_path,
        image_path=image_path,
        **kwargs
    )


def main():
    parser = argparse.ArgumentParser(description="Generate video using veo-cli")
    parser.add_argument("--prompt", required=True, help="Video generation prompt")
    parser.add_argument("--image", help="Optional: Starting frame image for image-to-video mode")
    parser.add_argument("--output", required=True, help="Output video path")
    parser.add_argument("--veo-path", help="Path to veo-cli directory")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast",
                        help="Video quality: fast (10 credits) or quality (100 credits)")
    parser.add_argument("--ratio", choices=["landscape", "portrait"], default="landscape",
                        help="Aspect ratio: landscape (16:9) or portrait (9:16)")
    parser.add_argument("--tag", default="video", help="Tag for output filename")
    args = parser.parse_args()

    try:
        if args.image:
            result = generate_from_image(
                image_path=args.image,
                motion_prompt=args.prompt,
                output_path=args.output,
                veo_path=args.veo_path,
                quality=args.quality,
                ratio=args.ratio,
                tag=args.tag
            )
        else:
            result = run_veo_generator(
                prompt=args.prompt,
                output_path=args.output,
                veo_path=args.veo_path,
                quality=args.quality,
                ratio=args.ratio,
                tag=args.tag
            )

        if result["success"]:
            print(f"\nSuccess! Video saved to: {result['output_path']}")
        else:
            print(f"\nFailed: {result.get('error', 'Unknown error')}")
            sys.exit(1)

    except subprocess.TimeoutExpired:
        print("Error: Generation timed out after 15 minutes")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
