#!/usr/bin/env python3
"""
Character Clip Generator — produce a single lip-sync video clip from a
Go Bananas character reference.

Automates the 5-step manual workflow:
  1. Output Go Bananas MCP command (or accept --image)
  2. Resize image to 1280x720
  3. Generate lip-sync video via parallel_video_gen.py
  4. Voice-change (optional, if --voice-id provided)
  5. Print final output path

Usage:
    # Generate intro clip
    python generate_character_clip.py \\
      --project "my-brand" --character-id 97 \\
      --dialogue "Welcome to our presentation!" \\
      --clip-name "intro" --quality fast --ratio landscape --yes

    # With pre-existing image (skip MCP step)
    python generate_character_clip.py \\
      --project "my-brand" --character-id 97 \\
      --dialogue "Hello everyone!" --clip-name "intro" \\
      --image "projects/my-brand/presenter/intro_character.jpg" \\
      --quality fast --yes

    # With voice change to match narrator
    python generate_character_clip.py \\
      --project "my-brand" --character-id 97 \\
      --dialogue "Thanks for watching!" --clip-name "outro" \\
      --voice-id "TX3LPaxmHKxFdv7VOQHJ" --quality fast --yes

    # Dry-run (show plan, no execution)
    python generate_character_clip.py \\
      --project "my-brand" --character-id 97 \\
      --dialogue "Hello!" --clip-name "intro" --dry-run
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from config import LANDSCAPE_HEIGHT, LANDSCAPE_WIDTH, LIP_SYNC_PROMPT_PATTERN

# Path resolution
_REPLICATOR_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "..", ".."))
DEFAULT_PROJECT_BASE = os.environ.get(
    "VIDEO_REPLICATOR_PROJECTS", os.path.join(_REPLICATOR_ROOT, "projects")
)


# ============================================================================
# Step 1: Go Bananas MCP command
# ============================================================================

def build_mcp_command(character_id: int, clip_name: str, ratio: str = "landscape") -> str:
    """
    Build a Go Bananas MCP command string for the user to execute.

    Returns the MCP call as a formatted string.
    """
    if ratio == "landscape":
        aspect = "16:9"
        hint = "WIDE HORIZONTAL shot, cinematic widescreen."
    else:
        aspect = "9:16"
        hint = "TALL VERTICAL portrait shot."

    prompt = (
        f"{hint} Character standing facing camera, neutral expression, "
        f"professional studio background, centered framing, "
        f"ready to speak, eyes looking directly at viewer"
    )

    lines = [
        "mcp__go-bananas__generate_image(",
        f'    prompt="{prompt}",',
        f"    character_id={character_id},",
        f'    aspect_ratio="{aspect}",',
        '    model_id="gemini-pro-image"',
        ")",
    ]
    return "\n".join(lines)


def print_mcp_step(character_id: int, clip_name: str, ratio: str = "landscape") -> None:
    """Print the MCP command for the user to execute."""
    cmd = build_mcp_command(character_id, clip_name, ratio)
    print()
    print("=" * 60)
    print("STEP 1: Generate character image")
    print("=" * 60)
    print()
    print("Execute this Go Bananas MCP call:")
    print()
    print(cmd)
    print()
    print("After executing, provide the downloaded image path via --image flag.")
    print()


# ============================================================================
# Step 2: Resize image
# ============================================================================

def resize_image(image_path: str, output_dir: str, clip_name: str, ratio: str = "landscape") -> str | None:
    """
    Resize character image for Veo.

    Returns the path to the resized image, or None on failure.
    """
    from utils_image import resize_to_landscape, crop_landscape_to_portrait

    os.makedirs(output_dir, exist_ok=True)

    ext = os.path.splitext(image_path)[1] or ".jpg"
    base_name = f"{clip_name}_character{ext}"
    dest_path = os.path.join(output_dir, base_name)

    # Copy source image to presenter directory
    if os.path.abspath(image_path) != os.path.abspath(dest_path):
        shutil.copy2(image_path, dest_path)
        print(f"  Copied image to {dest_path}")

    if ratio == "landscape":
        resized = resize_to_landscape(dest_path)
    else:
        resized = crop_landscape_to_portrait(dest_path)

    return resized


# ============================================================================
# Step 3: Generate lip-sync video
# ============================================================================

def build_lipsync_command(
    project: str,
    clip_name: str,
    dialogue: str,
    images_dir: str,
    quality: str = "fast",
    ratio: str = "landscape",
    backend: str = "useapi",
) -> list[str]:
    """
    Build the subprocess command for lip-sync video generation.

    Returns the command as a list of strings.
    """
    scene_prompt = (
        f"Character speaks directly to camera, professional background, "
        f"subtle ambient lighting, neutral pose"
    )
    scenes_json = json.dumps({clip_name: scene_prompt})
    dialogue_json = json.dumps({clip_name: dialogue})

    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, "parallel_video_gen.py"),
        "--product", project,
        "--mode", "frames-to-video",
        "--lip-sync",
        "--dialogue", dialogue_json,
        "--scenes", scenes_json,
        "--images-dir", images_dir,
        "--quality", quality,
        "--ratio", ratio,
        "--variations", "1",
        "--backend", backend,
        "--yes",
    ]
    return cmd


def run_lipsync_generation(
    project: str,
    clip_name: str,
    dialogue: str,
    images_dir: str,
    quality: str = "fast",
    ratio: str = "landscape",
    backend: str = "useapi",
) -> bool:
    """
    Run lip-sync video generation via parallel_video_gen.py subprocess.

    Returns True on success, False on failure.
    """
    cmd = build_lipsync_command(project, clip_name, dialogue, images_dir, quality, ratio, backend)

    print()
    print("=" * 60)
    print("STEP 3: Generate lip-sync video")
    print("=" * 60)
    print(f"  Command: {' '.join(cmd)}")
    print()

    result = subprocess.run(cmd, cwd=_REPLICATOR_ROOT)
    return result.returncode == 0


# ============================================================================
# Step 4: Voice change
# ============================================================================

def build_voice_change_command(
    videos_dir: str,
    clip_name: str,
    voice_id: str,
    seed: int = 42,
    remove_bg_noise: bool = True,
) -> list[str]:
    """
    Build the subprocess command for voice change.

    Returns the command as a list of strings.
    """
    cmd = [
        sys.executable,
        os.path.join(SCRIPT_DIR, "generate_tts.py"),
        "--voice-change",
        "--videos-dir", videos_dir,
        "--scenes", clip_name,
        "--voice-id", voice_id,
        "--seed", str(seed),
        "--yes",
    ]
    if remove_bg_noise:
        cmd.append("--remove-bg-noise")
    return cmd


def run_voice_change(
    videos_dir: str,
    clip_name: str,
    voice_id: str,
    seed: int = 42,
    remove_bg_noise: bool = True,
) -> bool:
    """
    Run voice change via generate_tts.py subprocess.

    Returns True on success, False on failure.
    """
    cmd = build_voice_change_command(videos_dir, clip_name, voice_id, seed, remove_bg_noise)

    print()
    print("=" * 60)
    print("STEP 4: Voice change")
    print("=" * 60)
    print(f"  Command: {' '.join(cmd)}")
    print()

    result = subprocess.run(cmd, cwd=_REPLICATOR_ROOT)
    return result.returncode == 0


# ============================================================================
# Step 5: Output final path
# ============================================================================

def find_output_video(videos_dir: str, clip_name: str) -> str | None:
    """
    Find the generated video file for the given clip name.

    Searches for common naming patterns (run-prefixed and plain).
    """
    import glob as globmod

    patterns = [
        f"run*_{clip_name}.mp4",
        f"run*_{clip_name}_voice_changed.mp4",
        f"{clip_name}.mp4",
        f"{clip_name}_voice_changed.mp4",
    ]
    for pattern in patterns:
        matches = sorted(globmod.glob(os.path.join(videos_dir, pattern)))
        if matches:
            return matches[-1]  # latest match
    return None


# ============================================================================
# Presenter config metadata
# ============================================================================

def save_presenter_config(
    presenter_dir: str,
    character_id: int,
    clip_name: str,
    dialogue: str,
    voice_id: str | None = None,
    image_path: str | None = None,
) -> str:
    """Save presenter configuration metadata as JSON."""
    config_path = os.path.join(presenter_dir, "presenter_config.json")

    config: dict = {}
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)

    config[clip_name] = {
        "character_id": character_id,
        "dialogue": dialogue,
        "voice_id": voice_id,
        "image_path": image_path,
    }

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    return config_path


# ============================================================================
# Main
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a character lip-sync clip (intro/outro) from a Go Bananas character"
    )
    parser.add_argument("--project", required=True, help="Project slug")
    parser.add_argument("--character-id", type=int, required=True, help="Go Bananas character ID")
    parser.add_argument("--dialogue", required=True, help="Spoken dialogue for the clip")
    parser.add_argument("--clip-name", required=True, help="Clip identifier (e.g., intro, outro)")
    parser.add_argument("--image", default=None, help="Path to existing character image (skip MCP step)")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast", help="Video quality")
    parser.add_argument("--ratio", choices=["landscape", "portrait"], default="landscape", help="Aspect ratio")
    parser.add_argument("--backend", choices=["direct", "useapi", "seedance"], default="useapi",
                        help="Video generation backend")
    parser.add_argument("--voice-id", default=None, help="ElevenLabs voice ID for voice change")
    parser.add_argument("--seed", type=int, default=42, help="Voice change seed for consistency")
    parser.add_argument("--no-remove-bg-noise", action="store_true", help="Skip background noise removal")
    parser.add_argument("--project-base", default=DEFAULT_PROJECT_BASE, help="Base path for projects")
    parser.add_argument("--dry-run", action="store_true", help="Show plan without executing")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompts")

    args = parser.parse_args()

    # Resolve project directory
    project_dir = os.path.join(args.project_base, args.project)
    presenter_dir = os.path.join(project_dir, "presenter")
    images_dir = os.path.join(project_dir, "images")
    videos_dir = os.path.join(project_dir, "videos")

    os.makedirs(presenter_dir, exist_ok=True)
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(videos_dir, exist_ok=True)

    print(f"Character Clip Generator")
    print(f"  Project:      {args.project}")
    print(f"  Character ID: {args.character_id}")
    print(f"  Clip name:    {args.clip_name}")
    print(f"  Dialogue:     {args.dialogue}")
    print(f"  Quality:      {args.quality}")
    print(f"  Ratio:        {args.ratio}")
    print(f"  Backend:      {args.backend}")
    print(f"  Voice change: {'yes (' + args.voice_id + ')' if args.voice_id else 'no'}")
    print()

    # --- Dry-run mode ---
    if args.dry_run:
        print("[DRY-RUN] Plan:")
        if not args.image:
            print("  1. Generate character image via Go Bananas MCP")
            print_mcp_step(args.character_id, args.clip_name, args.ratio)
        else:
            print(f"  1. Use existing image: {args.image}")

        print(f"  2. Resize image to {LANDSCAPE_WIDTH}x{LANDSCAPE_HEIGHT}")

        lipsync_cmd = build_lipsync_command(
            args.project, args.clip_name, args.dialogue, images_dir,
            args.quality, args.ratio, args.backend,
        )
        print(f"  3. Generate lip-sync video:")
        print(f"     {' '.join(lipsync_cmd)}")

        if args.voice_id:
            vc_cmd = build_voice_change_command(
                videos_dir, args.clip_name, args.voice_id,
                args.seed, not args.no_remove_bg_noise,
            )
            print(f"  4. Voice change:")
            print(f"     {' '.join(vc_cmd)}")
        else:
            print("  4. Voice change: skipped (no --voice-id)")

        print(f"  5. Output: {videos_dir}/run*_{args.clip_name}.mp4")
        print()
        print("[DRY-RUN] No actions taken.")
        return

    # --- Step 1: Get character image ---
    if args.image:
        if not os.path.exists(args.image):
            print(f"Error: Image not found: {args.image}")
            sys.exit(1)
        image_path = args.image
        print(f"Step 1: Using existing image: {image_path}")
    else:
        print_mcp_step(args.character_id, args.clip_name, args.ratio)
        print("Re-run this command with --image <path> after generating the image.")
        sys.exit(0)

    # --- Step 2: Resize image ---
    print()
    print("=" * 60)
    print("STEP 2: Resize image")
    print("=" * 60)
    resized = resize_image(image_path, presenter_dir, args.clip_name, args.ratio)
    if not resized:
        print("Error: Failed to resize image")
        sys.exit(1)
    print(f"  Resized image: {resized}")

    # Copy resized image to images dir for parallel_video_gen.py
    # The script expects: images_dir/{clip_name}_frame.jpg or {clip_name}_frame_landscape.jpg
    frame_name = f"{args.clip_name}_frame.jpg"
    frame_dest = os.path.join(images_dir, frame_name)
    shutil.copy2(resized, frame_dest)
    print(f"  Copied to images dir: {frame_dest}")

    if args.ratio == "landscape":
        landscape_name = f"{args.clip_name}_frame_landscape.jpg"
        landscape_dest = os.path.join(images_dir, landscape_name)
        shutil.copy2(resized, landscape_dest)
        print(f"  Copied landscape version: {landscape_dest}")

    # --- Step 3: Generate lip-sync video ---
    if not args.yes:
        resp = input("Proceed with video generation? [y/N] ").strip().lower()
        if resp not in ("y", "yes"):
            print("Aborted.")
            sys.exit(0)

    success = run_lipsync_generation(
        args.project, args.clip_name, args.dialogue, images_dir,
        args.quality, args.ratio, args.backend,
    )
    if not success:
        print("Error: Lip-sync video generation failed")
        sys.exit(1)

    # --- Step 4: Voice change (optional) ---
    if args.voice_id:
        vc_success = run_voice_change(
            videos_dir, args.clip_name, args.voice_id,
            args.seed, not args.no_remove_bg_noise,
        )
        if not vc_success:
            print("Warning: Voice change failed, using original video")

    # --- Step 5: Output and metadata ---
    output_video = find_output_video(videos_dir, args.clip_name)

    # Save metadata
    save_presenter_config(
        presenter_dir, args.character_id, args.clip_name,
        args.dialogue, args.voice_id, image_path,
    )

    print()
    print("=" * 60)
    print("COMPLETE")
    print("=" * 60)
    if output_video:
        print(f"  Output video: {output_video}")
    else:
        print(f"  Warning: Could not locate output video in {videos_dir}")
        print(f"  Check for run*_{args.clip_name}.mp4 files manually")
    print(f"  Presenter config: {os.path.join(presenter_dir, 'presenter_config.json')}")
    print()


if __name__ == "__main__":
    main()
