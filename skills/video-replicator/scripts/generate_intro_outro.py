#!/usr/bin/env python3
"""
Intro/Outro Generator — Animated movie poster intros and outros using Veo 3 I2V.

Phase 2.1 enhancement: Dedicated script for movie poster animations.

Usage:
    # Generate epic intro from movie poster
    python generate_intro_outro.py \
        --project "my-movie" \
        --intro-image "poster.jpg" \
        --animation-style epic \
        --ratio landscape --yes

    # Generate intro and reversed outro
    python generate_intro_outro.py \
        --project "my-movie" \
        --intro-image "poster.jpg" \
        --reverse-outro \
        --animation-style dramatic \
        --yes

    # Custom title overlay (requires poster with title space)
    python generate_intro_outro.py \
        --project "my-movie" \
        --intro-image "poster.jpg" \
        --title "Heart of Dharma" \
        --animation-style subtle \
        --yes

    # Dry-run to preview settings
    python generate_intro_outro.py \
        --project "my-movie" \
        --intro-image "poster.jpg" \
        --animation-style epic \
        --dry-run
"""

import argparse
import contextlib
import os
import shutil
import subprocess
import sys

# Script paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

# Compute paths
_REPLICATOR_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "..", ".."))
_WORKSPACE_ROOT = os.path.abspath(os.path.join(_REPLICATOR_ROOT, ".."))

VEO_CLI_PATH = os.environ.get(
    "VEO_CLI_PATH",
    os.path.join(_WORKSPACE_ROOT, "veo-cli"),
)
PROJECTS_BASE = os.environ.get(
    "VIDEO_REPLICATOR_PROJECTS",
    os.path.join(_REPLICATOR_ROOT, "projects"),
)

# Animation presets for movie poster intros
INTRO_PRESETS = {
    "epic": {
        "name": "Epic Reveal",
        "prompt": "Epic movie poster slowly comes to life. Characters begin to subtly breathe and move. "
                  "Magical particles float upward. Cinematic slow push-in. Dramatic lighting intensifies. "
                  "Atmospheric dust motes catch light. 8K, cinematic, dramatic reveal.",
        "direction": "forward",
        "duration": 6.0,
        "description": "Characters come alive with particles and dramatic lighting",
    },
    "subtle": {
        "name": "Subtle Motion",
        "prompt": "Movie poster with gentle ambient motion. Soft light particles drift slowly. "
                  "Very subtle character breathing. Camera holds steady with slight push. "
                  "Calm, dreamy atmosphere. Minimal motion, maximum elegance.",
        "direction": "forward",
        "duration": 5.0,
        "description": "Minimal motion with floating particles and soft light",
    },
    "dramatic": {
        "name": "Dramatic Reveal",
        "prompt": "Dramatic reveal with light rays emanating from characters. Intense wind effects. "
                  "Slow zoom toward center. Particles swirl dramatically. Epic orchestral energy. "
                  "Characters appear to channel power. Cinematic color grading.",
        "direction": "forward",
        "duration": 7.0,
        "description": "Light rays, wind, and dramatic character presence",
    },
    "mystical": {
        "name": "Mystical Awakening",
        "prompt": "Mystical poster awakening. Ancient energy swirls around characters. "
                  "Ethereal glow emanates from within. Subtle magical runes appear. "
                  "Characters' eyes glow faintly. Atmospheric mist flows. Sacred, otherworldly feel.",
        "direction": "forward",
        "duration": 6.0,
        "description": "Magical energy, glowing elements, ethereal atmosphere",
    },
    "action": {
        "name": "Action Ready",
        "prompt": "Action movie poster comes alive. Characters shift into ready stance. "
                  "Sparks and embers float upward. Dynamic camera push. Intense energy builds. "
                  "Dramatic shadows shift. High-octane atmosphere.",
        "direction": "forward",
        "duration": 5.0,
        "description": "Characters ready for action with sparks and energy",
    },
}

# Standard dimensions
LANDSCAPE_DIMS = (1280, 720)
PORTRAIT_DIMS = (504, 896)


def get_image_dimensions(image_path: str) -> tuple[int, int] | None:
    """Get image dimensions using sips (macOS) or PIL."""
    try:
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", image_path],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            width = height = None
            for line in result.stdout.strip().split("\n"):
                if "pixelWidth" in line:
                    width = int(line.split()[-1])
                elif "pixelHeight" in line:
                    height = int(line.split()[-1])
            if width and height:
                return (width, height)
    except Exception:
        pass

    try:
        from PIL import Image
        with Image.open(image_path) as img:
            return img.size
    except Exception:
        pass

    return None


def resize_image_to_dimensions(
    input_path: str,
    target_dims: tuple[int, int],
    output_path: str,
) -> bool:
    """Resize image to exact dimensions, center-cropping if needed."""
    try:
        from PIL import Image

        target_w, target_h = target_dims
        target_ratio = target_w / target_h

        with Image.open(input_path) as img:
            # Convert to RGB if needed
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

            src_w, src_h = img.size
            src_ratio = src_w / src_h

            # Calculate crop box to match target aspect ratio
            if src_ratio > target_ratio:
                # Image is wider - crop sides
                new_w = int(src_h * target_ratio)
                left = (src_w - new_w) // 2
                crop_box = (left, 0, left + new_w, src_h)
            else:
                # Image is taller - crop top/bottom
                new_h = int(src_w / target_ratio)
                top = (src_h - new_h) // 2
                crop_box = (0, top, src_w, top + new_h)

            cropped = img.crop(crop_box)
            resized = cropped.resize(target_dims, Image.Resampling.LANCZOS)
            resized.save(output_path, "JPEG", quality=95)

        return True

    except Exception as e:
        print(f"  Error resizing image: {e}")
        return False


def describe_poster_with_gemini(image_path: str) -> str | None:
    """Use Gemini Vision to describe a movie poster."""
    try:
        import google.generativeai as genai

        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            print("  Warning: GOOGLE_API_KEY not set, cannot auto-describe poster")
            return None

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-3-flash-preview")
        img = genai.upload_file(image_path)

        response = model.generate_content([
            img,
            "Describe this movie poster in 15-20 words for use in a video animation prompt. "
            "Focus on the characters, their poses, expressions, and overall mood. "
            "Example: 'warrior hero in dramatic pose with sword raised, mystical blue aura, dark stormy background'. "
            "Return ONLY the description, no quotes or extra text.",
        ])
        return response.text.strip().strip('"').strip("'")

    except Exception as e:
        print(f"  Warning: Gemini poster description failed: {e}")
        return None


def resolve_project_path(slug: str, projects_base: str) -> str | None:
    """Find project directory by slug."""
    direct = os.path.join(projects_base, slug)
    if os.path.isdir(direct):
        return direct
    if not os.path.isdir(projects_base):
        return None
    for entry in sorted(os.listdir(projects_base), reverse=True):
        full = os.path.join(projects_base, entry)
        if not os.path.isdir(full):
            continue
        if entry.endswith(f"_{slug}"):
            return full
    return None


def get_current_run_id(videos_dir: str) -> str:
    """Get next run ID based on existing files."""
    import glob
    existing = glob.glob(os.path.join(videos_dir, "run*_intro*.mp4"))
    existing += glob.glob(os.path.join(videos_dir, "run*_outro*.mp4"))
    if not existing:
        return "run001"
    nums = []
    for f in existing:
        base = os.path.basename(f)
        if base.startswith("run") and "_" in base:
            with contextlib.suppress(ValueError, IndexError):
                nums.append(int(base[3:6]))
    next_num = max(nums, default=0) + 1
    return f"run{next_num:03d}"


def build_ffmpeg_reverse_cmd(input_path: str, output_path: str) -> list[str]:
    """Build FFmpeg command to reverse video."""
    return [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vf", "reverse",
        "-af", "areverse",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k",
        output_path,
    ]


def build_ffmpeg_trim_fade_cmd(
    input_path: str,
    output_path: str,
    duration: float = 6.0,
    fade_in: float = 0.5,
    fade_out: float = 0.5,
) -> list[str]:
    """Build FFmpeg command to trim and add fades."""
    fade_out_start = max(0, duration - fade_out)
    vf = f"fade=in:st=0:d={fade_in},fade=out:st={fade_out_start}:d={fade_out}"
    af = f"afade=in:st=0:d={fade_in},afade=out:st={fade_out_start}:d={fade_out}"
    return [
        "ffmpeg", "-y",
        "-i", input_path,
        "-t", str(duration),
        "-vf", vf,
        "-af", af,
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k",
        output_path,
    ]


def find_latest_video(output_dir: str, tag: str) -> str | None:
    """Find the most recently modified video with given tag."""
    if not os.path.isdir(output_dir):
        return None
    candidates = []
    for f in os.listdir(output_dir):
        if f.endswith(".mp4") and tag in f.lower():
            full = os.path.join(output_dir, f)
            candidates.append((os.path.getmtime(full), full))
    if not candidates:
        for f in os.listdir(output_dir):
            if f.endswith(".mp4"):
                full = os.path.join(output_dir, f)
                candidates.append((os.path.getmtime(full), full))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


def generate_intro_outro(
    project: str,
    intro_image: str,
    outro_image: str | None = None,
    animation_style: str = "epic",
    reverse_outro: bool = False,
    title: str | None = None,
    ratio: str = "landscape",
    quality: str = "fast",
    backend: str = "useapi",
    dry_run: bool = False,
    auto_confirm: bool = False,
    preview: bool = False,
) -> dict:
    """
    Generate animated intro and optional outro from movie poster images.

    Args:
        project: Project name/slug
        intro_image: Path to intro poster image
        outro_image: Path to outro image (defaults to intro if not provided)
        animation_style: Animation preset (epic, subtle, dramatic, mystical, action)
        reverse_outro: If True, reverse the intro for outro
        title: Optional title text (for logging)
        ratio: Aspect ratio (landscape or portrait)
        quality: Video quality (fast or quality)
        backend: veo-cli backend (useapi or direct)
        dry_run: Preview without generating
        auto_confirm: Skip confirmation prompt
        preview: Open video after generation

    Returns:
        Dict with success status, paths to generated videos
    """
    result = {
        "success": False,
        "intro_path": None,
        "outro_path": None,
        "run_id": None,
        "error": None,
    }

    # Validate animation style
    if animation_style not in INTRO_PRESETS:
        result["error"] = f"Unknown animation style: {animation_style}"
        print(f"Error: {result['error']}")
        print(f"Available styles: {', '.join(INTRO_PRESETS.keys())}")
        return result

    preset = INTRO_PRESETS[animation_style]

    # Validate intro image
    if not os.path.exists(intro_image):
        result["error"] = f"Intro image not found: {intro_image}"
        print(f"Error: {result['error']}")
        return result

    # Resolve project path
    project_path = resolve_project_path(project, PROJECTS_BASE)
    if not project_path:
        # Create project directory
        project_path = os.path.join(PROJECTS_BASE, project)
        os.makedirs(project_path, exist_ok=True)

    videos_dir = os.path.join(project_path, "videos")
    os.makedirs(videos_dir, exist_ok=True)

    run_id = get_current_run_id(videos_dir)
    result["run_id"] = run_id

    # Get target dimensions
    target_dims = LANDSCAPE_DIMS if ratio == "landscape" else PORTRAIT_DIMS

    print(f"\n{'='*60}")
    print("INTRO/OUTRO GENERATOR")
    print(f"{'='*60}")
    print(f"  Project:     {project}")
    print(f"  Run ID:      {run_id}")
    print(f"  Intro:       {intro_image}")
    if outro_image:
        print(f"  Outro:       {outro_image}")
    elif reverse_outro:
        print("  Outro:       (reversed intro)")
    print(f"  Style:       {animation_style} - {preset['name']}")
    print(f"  Description: {preset['description']}")
    print(f"  Duration:    {preset['duration']}s")
    print(f"  Ratio:       {ratio} ({target_dims[0]}x{target_dims[1]})")
    print(f"  Quality:     {quality}")
    print(f"  Backend:     {backend}")
    if title:
        print(f"  Title:       {title}")
    print(f"{'='*60}")

    # Describe poster
    print("\n  Analyzing poster with Gemini Vision...")
    poster_desc = describe_poster_with_gemini(intro_image)
    if poster_desc:
        print(f"  Poster: {poster_desc[:80]}...")
    else:
        poster_desc = "movie poster characters in dramatic pose"
        print(f"  Fallback: {poster_desc}")

    # Build full prompt
    full_prompt = f"{poster_desc}. {preset['prompt']}"
    print(f"\n  Prompt: {full_prompt[:100]}...")

    if dry_run:
        print("\n  [DRY RUN] Would generate:")
        print(f"    Intro: {run_id}_intro.mp4")
        if reverse_outro or outro_image:
            print(f"    Outro: {run_id}_outro.mp4")
        result["success"] = True
        return result

    if not auto_confirm:
        confirm = input("\nProceed with generation? (y/n): ").strip().lower()
        if confirm not in ("y", "yes"):
            print("Cancelled.")
            return result

    # Prepare intro frame (resize to target dimensions)
    intro_frame = os.path.join(videos_dir, f"{run_id}_intro_frame.jpg")
    print("\n  Preparing intro frame...")
    dims = get_image_dimensions(intro_image)
    if dims:
        print(f"    Source: {dims[0]}x{dims[1]}")
    if not resize_image_to_dimensions(intro_image, target_dims, intro_frame):
        result["error"] = "Failed to prepare intro frame"
        return result
    print(f"    Resized to: {target_dims[0]}x{target_dims[1]}")

    # Generate intro video
    print("\n  Generating intro video...")
    abs_frame = os.path.abspath(intro_frame)
    veo_prompt = f"[intro] image:{abs_frame} {full_prompt}"

    cmd = [
        "bun", "run", "google.ts",
        "-p", veo_prompt,
        "-n", "1",
        "-r", ratio,
        "-m", quality,
    ]
    if backend and backend != "direct":
        cmd.extend(["--backend", backend])
        cmd.append("--yes")

    print(f'    Running: bun run google.ts -p "[intro] image:... {full_prompt[:50]}..." -n 1 -r {ratio} -m {quality}', flush=True)

    proc = subprocess.run(cmd, cwd=VEO_CLI_PATH, capture_output=True, text=True, timeout=900)

    if proc.returncode != 0:
        result["error"] = f"veo-cli failed: {proc.stderr[:500]}"
        print(f"  FAILED: {proc.stderr[:200]}")
        return result

    # Copy output
    output_dir = os.path.join(VEO_CLI_PATH, "output-videos")
    raw_video = find_latest_video(output_dir, "intro")
    if not raw_video:
        result["error"] = "No video found in veo-cli output"
        print(f"  ERROR: {result['error']}")
        return result

    raw_intro = os.path.join(videos_dir, f"{run_id}_intro_raw.mp4")
    shutil.copy2(raw_video, raw_intro)

    # Trim and add fades
    final_intro = os.path.join(videos_dir, f"{run_id}_intro.mp4")
    print(f"  Trimming intro to {preset['duration']}s with fades...")
    trim_cmd = build_ffmpeg_trim_fade_cmd(
        raw_intro, final_intro,
        duration=preset['duration'],
        fade_in=0.5,
        fade_out=0.3,  # Shorter fade out for smooth transition to content
    )
    trim_proc = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=300)
    if trim_proc.returncode != 0:
        result["error"] = f"FFmpeg trim failed: {trim_proc.stderr[:300]}"
        return result

    result["intro_path"] = final_intro
    print(f"  Intro saved: {final_intro}")

    # Generate outro if requested
    if reverse_outro or outro_image:
        if reverse_outro:
            # Reverse the intro for outro
            final_outro = os.path.join(videos_dir, f"{run_id}_outro.mp4")
            print("\n  Reversing intro for outro...")
            rev_cmd = build_ffmpeg_reverse_cmd(final_intro, final_outro)
            rev_proc = subprocess.run(rev_cmd, capture_output=True, text=True, timeout=300)
            if rev_proc.returncode != 0:
                print(f"  Warning: Failed to reverse intro: {rev_proc.stderr[:200]}")
            else:
                result["outro_path"] = final_outro
                print(f"  Outro saved: {final_outro}")
        else:
            # Generate outro from separate image
            outro_frame = os.path.join(videos_dir, f"{run_id}_outro_frame.jpg")
            print("\n  Preparing outro frame...")
            if not resize_image_to_dimensions(outro_image, target_dims, outro_frame):
                print("  Warning: Failed to prepare outro frame")
            else:
                print("\n  Generating outro video...")
                abs_outro_frame = os.path.abspath(outro_frame)
                outro_prompt = f"[outro] image:{abs_outro_frame} {full_prompt}"
                cmd[2] = outro_prompt

                proc = subprocess.run(cmd, cwd=VEO_CLI_PATH, capture_output=True, text=True, timeout=900)
                if proc.returncode == 0:
                    raw_video = find_latest_video(output_dir, "outro")
                    if raw_video:
                        raw_outro = os.path.join(videos_dir, f"{run_id}_outro_raw.mp4")
                        shutil.copy2(raw_video, raw_outro)
                        final_outro = os.path.join(videos_dir, f"{run_id}_outro.mp4")
                        trim_cmd = build_ffmpeg_trim_fade_cmd(
                            raw_outro, final_outro,
                            duration=preset['duration'],
                            fade_in=0.3,  # Shorter fade in for smooth transition from content
                            fade_out=0.5,
                        )
                        subprocess.run(trim_cmd, capture_output=True, text=True, timeout=300)
                        result["outro_path"] = final_outro
                        print(f"  Outro saved: {final_outro}")

    result["success"] = True

    print(f"\n{'='*60}")
    print("Generation Complete!")
    print(f"{'='*60}")
    print(f"  Intro: {result['intro_path']}")
    if result["outro_path"]:
        print(f"  Outro: {result['outro_path']}")
    print("\nUsage in stitch_video.py:")
    print(f"  --logo-intro \"{result['intro_path']}\"")
    if result["outro_path"]:
        print(f"  --logo-outro \"{result['outro_path']}\"")
    print(f"{'='*60}")

    # Preview if requested
    if preview and result["intro_path"]:
        import platform
        print("  Opening preview...")
        try:
            if platform.system() == "Darwin":
                subprocess.run(["open", result["intro_path"]])
            elif platform.system() == "Linux":
                subprocess.run(["xdg-open", result["intro_path"]])
        except Exception as e:
            print(f"  Could not open preview: {e}")

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Generate animated movie poster intro/outro videos",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Animation Styles:
  epic      - Characters come alive with particles and dramatic lighting
  subtle    - Minimal motion with floating particles and soft light
  dramatic  - Light rays, wind, and dramatic character presence
  mystical  - Magical energy, glowing elements, ethereal atmosphere
  action    - Characters ready for action with sparks and energy

Examples:
  # Epic intro from movie poster
  python generate_intro_outro.py --project "my-movie" --intro-image "poster.jpg" --animation-style epic --yes

  # Intro + reversed outro
  python generate_intro_outro.py --project "my-movie" --intro-image "poster.jpg" --reverse-outro --yes

  # Subtle style with preview
  python generate_intro_outro.py --project "my-movie" --intro-image "poster.jpg" --animation-style subtle --preview --yes
        """,
    )

    parser.add_argument("--project", required=True, help="Project name/slug")
    parser.add_argument("--intro-image", required=True, help="Path to intro poster image")
    parser.add_argument("--outro-image", help="Path to outro image (optional)")
    parser.add_argument("--animation-style", default="epic",
                       choices=list(INTRO_PRESETS.keys()),
                       help="Animation style preset (default: epic)")
    parser.add_argument("--reverse-outro", action="store_true",
                       help="Reverse the intro to create outro")
    parser.add_argument("--title", help="Movie/video title (for logging)")
    parser.add_argument("--ratio", choices=["landscape", "portrait"], default="landscape",
                       help="Aspect ratio (default: landscape)")
    parser.add_argument("--quality", choices=["fast", "quality"], default="fast",
                       help="Video quality (default: fast)")
    parser.add_argument("--backend", choices=["direct", "useapi"], default="useapi",
                       help="veo-cli backend (default: useapi)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without generating")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    parser.add_argument("--preview", action="store_true", help="Open video after generation")
    parser.add_argument("--list-styles", action="store_true", help="List animation styles and exit")

    args = parser.parse_args()

    if args.list_styles:
        print("\nAnimation Styles:\n")
        print(f"{'Style':<12} {'Name':<20} {'Duration':<10} {'Description'}")
        print("-" * 80)
        for key, preset in INTRO_PRESETS.items():
            print(f"{key:<12} {preset['name']:<20} {preset['duration']}s{'':<6} {preset['description']}")
        return

    result = generate_intro_outro(
        project=args.project,
        intro_image=args.intro_image,
        outro_image=args.outro_image,
        animation_style=args.animation_style,
        reverse_outro=args.reverse_outro,
        title=args.title,
        ratio=args.ratio,
        quality=args.quality,
        backend=args.backend,
        dry_run=args.dry_run,
        auto_confirm=args.yes,
        preview=args.preview,
    )

    if not result["success"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
