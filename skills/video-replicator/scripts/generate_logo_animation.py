#!/usr/bin/env python3
"""
Logo Candy — Generate animated logo intro/outro using Veo 3 I2V.

Phase 5.5 in the video-replicator pipeline.

Usage:
    python generate_logo_animation.py --logo "logo.png" --project "my-brand" --preset liquid-chrome --yes
    python generate_logo_animation.py --logo "logo.png" --project "my-brand" --preset custom --prompt "Pillars morph into {logo_description}" --direction reverse --yes
    python generate_logo_animation.py --logo "logo.png" --project "my-brand" --preset neon-powerup --dry-run
"""

import argparse
import contextlib
import glob
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from ffmpeg_wrapper import FFmpegWrapper
from logo_frame import pad_logo_to_ratio, prepare_logo_frame
from logo_presets import PRESETS, get_preset, get_prompt_template

_ff = FFmpegWrapper()

# Script is at: video-replicator-veo-cli/.claude/skills/video-replicator/scripts/
# Replicator root is 4 levels up, workspace root is 5 levels up
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


def build_veo_prompt(tag: str, frame_path: str, motion_prompt: str) -> str:
    """Build veo-cli I2V prompt string."""
    return f"[{tag}] image:{frame_path} {motion_prompt}"


def build_veo_r2v_prompt(tag: str, logo_path: str, motion_prompt: str) -> str:
    """Build veo-cli R2V (ingredients/reference) prompt string."""
    return f"[{tag}] ingredients:{logo_path} {motion_prompt}"


def build_ffmpeg_reverse_cmd(input_path: str, output_path: str) -> list[str]:
    """Build FFmpeg command to reverse video and audio."""
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
    fade_duration: float = 0.5,
) -> list[str]:
    """Build FFmpeg command to trim and add fade-in only (no fade-out for smooth transition)."""
    # Only fade-in, no fade-out - logo should end cleanly for smooth transition to content
    vf = f"fade=in:st=0:d={fade_duration}"
    af = f"afade=in:st=0:d={fade_duration}"
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


def add_hold_frame(video_path: str, hold_duration: float, output_path: str) -> tuple[bool, str]:
    """
    Extract last frame and append as freeze to guarantee clear logo visibility.

    Args:
        video_path: Path to the video to add hold frame to
        hold_duration: Duration in seconds to hold the final frame
        output_path: Path for the output video with hold frame

    Returns:
        Tuple of (success: bool, error_message: str or empty)
    """
    import tempfile

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            last_frame = os.path.join(tmpdir, "last_frame.jpg")
            freeze_video = os.path.join(tmpdir, "freeze.mp4")
            concat_list = os.path.join(tmpdir, "concat.txt")

            # 1. Extract last frame
            extract_cmd = [
                'ffmpeg', '-y', '-sseof', '-0.1', '-i', video_path,
                '-frames:v', '1', '-q:v', '2', last_frame
            ]
            proc = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=60)
            if proc.returncode != 0:
                return False, f"Failed to extract last frame: {proc.stderr[:200]}"

            # 2. Get frame rate from original video (parse "30/1" or "30000/1001" format)
            try:
                fps_str = _ff.probe(
                    video_path,
                    entries="stream=r_frame_rate",
                    select_streams="v:0",
                )
            except Exception:
                fps_str = ""
            if '/' in fps_str:
                num, denom = fps_str.split('/')
                fps = int(num) / int(denom)
            else:
                fps = float(fps_str) if fps_str else 30

            # 3. Create freeze video from frame (with silent audio to prevent
            #    audio/video duration mismatch when concatenated)
            freeze_cmd = [
                'ffmpeg', '-y', '-loop', '1', '-i', last_frame,
                '-f', 'lavfi', '-i', f'anullsrc=r=48000:cl=stereo',
                '-t', str(hold_duration), '-vf', f'fps={fps}',
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '192k',
                '-shortest', freeze_video
            ]
            proc = subprocess.run(freeze_cmd, capture_output=True, text=True, timeout=60)
            if proc.returncode != 0:
                return False, f"Failed to create freeze video: {proc.stderr[:200]}"

            # 4. Write concat list
            with open(concat_list, 'w') as f:
                f.write(f"file '{video_path}'\n")
                f.write(f"file '{freeze_video}'\n")

            # 5. Concatenate original + freeze
            concat_cmd = [
                'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_list,
                '-c', 'copy', output_path
            ]
            proc = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=120)
            if proc.returncode != 0:
                return False, f"Failed to concatenate: {proc.stderr[:200]}"

            return True, ""

    except Exception as e:
        return False, str(e)


def open_video_preview(video_path: str) -> None:
    """Open video in system default player."""
    import platform
    try:
        if platform.system() == 'Darwin':  # macOS
            subprocess.run(['open', video_path])
        elif platform.system() == 'Linux':
            subprocess.run(['xdg-open', video_path])
        elif platform.system() == 'Windows':
            os.startfile(video_path)
    except Exception as e:
        print(f"  Could not open preview: {e}")


def resolve_project_path(slug: str, projects_base: str) -> str | None:
    """Find project directory by slug (supports date-prefixed folders)."""
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
        manifest_path = os.path.join(full, "manifest.json")
        if os.path.exists(manifest_path):
            try:
                with open(manifest_path) as f:
                    m = json.load(f)
                if m.get("slug") == slug:
                    return full
            except (json.JSONDecodeError, KeyError):
                pass
    return None


def get_logo_manifest_path(assets_dir: str) -> str:
    return os.path.join(assets_dir, "logo_manifest.json")


def update_logo_manifest(manifest_path: str, updates: dict) -> dict:
    data = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            data = json.load(f)
    data.update(updates)
    os.makedirs(os.path.dirname(manifest_path) or ".", exist_ok=True)
    with open(manifest_path, "w") as f:
        json.dump(data, f, indent=2)
    return data


def describe_logo_with_gemini(logo_path: str) -> str | None:
    """Use Gemini Vision to auto-describe a logo image."""
    try:
        import google.generativeai as genai
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            print("  Warning: GOOGLE_API_KEY not set, cannot auto-describe logo")
            return None
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-3-flash-preview")
        img = genai.upload_file(logo_path)
        response = model.generate_content([
            img,
            "Describe this logo in 10-15 words for use in a video animation prompt. "
            "Focus on shape, colors, and text content. "
            "Example: 'red and white circular Coca-Cola script logo with ribbon flourish'. "
            "Return ONLY the description, no quotes or extra text.",
        ])
        return response.text.strip().strip('"').strip("'")
    except Exception as e:
        print(f"  Warning: Gemini logo description failed: {e}")
        return None


def get_current_run_id(assets_dir: str) -> str:
    existing = glob.glob(os.path.join(assets_dir, "run*_logo_*.mp4"))
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


def find_latest_video(output_dir: str, tag: str) -> str | None:
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


def generate_logo_animation(
    logo_path: str,
    project_path: str,
    preset_name: str = "liquid-chrome",
    custom_prompt: str = None,
    background: str = None,
    direction: str = None,
    duration: float = 6.0,
    ratio: str = "landscape",
    quality: str = "fast",
    variations: int = 1,
    logo_description: str = None,
    backend: str = "useapi",
    dry_run: bool = False,
    auto_confirm: bool = False,
    raw_logo: bool = False,
    hold_end: float = 0,
    preview: bool = False,
) -> dict:
    result = {
        "success": False,
        "assets_dir": None,
        "animation_paths": [],
        "run_id": None,
        "error": None,
    }

    preset = get_preset(preset_name)
    if not preset:
        result["error"] = f"Unknown preset: {preset_name}. Available: {', '.join(PRESETS.keys())}"
        print(f"Error: {result['error']}")
        return result

    if direction is None:
        direction = preset["direction"]
    if background is None:
        background = preset["background"]

    if preset_name == "custom" and not custom_prompt:
        result["error"] = "Custom preset requires --prompt"
        print(f"Error: {result['error']}")
        return result

    assets_dir = os.path.join(project_path, "assets")
    os.makedirs(assets_dir, exist_ok=True)
    result["assets_dir"] = assets_dir

    run_id = get_current_run_id(assets_dir)
    result["run_id"] = run_id

    print(f"\n{'=' * 50}")
    print("LOGO CANDY — Phase 5.5")
    print(f"{'=' * 50}")
    print(f"  Logo:       {logo_path}")
    print(f"  Preset:     {preset_name}")
    print(f"  Direction:  {direction}")
    print(f"  Background: {background}")
    print(f"  Ratio:      {ratio}")
    print(f"  Duration:   {duration}s")
    print(f"  Quality:    {quality}")
    print(f"  Variations: {variations}")
    print(f"  Run:        {run_id}")
    veo_mode = preset.get("veo_mode", "i2v")
    print(f"  Backend:    {backend}")
    print(f"  Veo Mode:   {veo_mode.upper()} ({'logo as first frame' if veo_mode == 'i2v' else 'logo as reference asset'})")
    if raw_logo and veo_mode == "i2v":
        print("  Frame Prep: Padded to ratio (--raw)")

    logo_ext = os.path.splitext(logo_path)[1]
    source_copy = os.path.join(assets_dir, f"logo_source{logo_ext}")
    if not os.path.exists(source_copy) or not os.path.samefile(logo_path, source_copy):
        shutil.copy2(logo_path, source_copy)
        print(f"\n  Copied logo -> {source_copy}")

    if not logo_description:
        print("\n  Describing logo with Gemini Vision...")
        logo_description = describe_logo_with_gemini(logo_path)
        if logo_description:
            print(f"  Description: {logo_description}")
        else:
            logo_description = "company logo"
            print(f"  Fallback description: {logo_description}")

    if preset_name == "custom":
        filled_prompt = custom_prompt.format(logo_description=logo_description)
    else:
        filled_prompt = get_prompt_template(preset_name, logo_description)

    print(f"\n  Prompt: {filled_prompt[:120]}...")

    for v in range(1, variations + 1):
        v_suffix = f"_v{v}" if variations > 1 else ""
        frame_path = os.path.join(assets_dir, f"{run_id}_logo_frame{v_suffix}.jpg")

        if veo_mode == "r2v":
            # R2V: logo used as reference ingredient, no frame compositing needed
            abs_logo = os.path.abspath(logo_path)
            print(f"\n  Using logo as R2V reference{v_suffix}: {abs_logo}")

            if dry_run:
                print("\n  [DRY RUN] Would run:")
                print(f'    bun run google.ts -p "[logo] ingredients:{abs_logo} {filled_prompt[:70]}..." -n 1 -r {ratio} -m {quality}')
                continue

            veo_prompt = build_veo_r2v_prompt("logo", abs_logo, filled_prompt)
        else:
            # I2V: logo composited as first frame
            if raw_logo:
                print(f"\n  Padding logo to {ratio} ratio{v_suffix}...")
                pad_logo_to_ratio(logo_path, ratio, frame_path)
                print(f"  Padded frame saved: {frame_path}")
            else:
                print(f"\n  Preparing frame{v_suffix}...")
                prepare_logo_frame(logo_path, background, ratio, frame_path)
                print(f"  Frame saved: {frame_path}")

            if dry_run:
                abs_frame = os.path.abspath(frame_path)
                print("\n  [DRY RUN] Would run:")
                print(f'    bun run google.ts -p "[logo] image:{abs_frame} {filled_prompt[:70]}..." -n 1 -r {ratio} -m {quality}')
                continue

            abs_frame = os.path.abspath(frame_path)
            veo_prompt = build_veo_prompt("logo", abs_frame, filled_prompt)

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

        mode_label = "R2V (reference)" if veo_mode == "r2v" else "I2V (first frame)"
        print(f"\n  Generating logo video{v_suffix} via Veo {mode_label}...")
        prefix = "ingredients" if veo_mode == "r2v" else "image"
        print(f'  Running: bun run google.ts -p "[logo] {prefix}:... {filled_prompt[:55]}..." -n 1 -r {ratio} -m {quality}', flush=True)

        proc = subprocess.run(cmd, cwd=VEO_CLI_PATH, capture_output=True, text=True, timeout=900)

        if proc.returncode != 0:
            result["error"] = f"veo-cli failed: {proc.stderr[:500]}"
            print(f"  FAILED: {proc.stderr[:200]}")
            return result

        output_dir = os.path.join(VEO_CLI_PATH, "output-videos")
        raw_video = find_latest_video(output_dir, "logo")
        if not raw_video:
            result["error"] = "No video found in veo-cli output after generation"
            print(f"  ERROR: {result['error']}")
            return result

        raw_dest = os.path.join(assets_dir, f"{run_id}_logo_raw{v_suffix}.mp4")
        shutil.copy2(raw_video, raw_dest)
        print(f"  Raw video: {raw_dest}")

        final_path = os.path.join(assets_dir, f"{run_id}_logo_animation{v_suffix}.mp4")

        if direction == "reverse":
            reversed_path = raw_dest.replace("_raw", "_reversed")
            print(f"  Reversing clip (preset={preset_name})...")
            rev_cmd = build_ffmpeg_reverse_cmd(raw_dest, reversed_path)
            rev_proc = subprocess.run(rev_cmd, capture_output=True, text=True, timeout=300)
            if rev_proc.returncode != 0:
                result["error"] = f"FFmpeg reverse failed: {rev_proc.stderr[:300]}"
                print(f"  ERROR: {result['error']}")
                return result
            source_for_trim = reversed_path
        else:
            source_for_trim = raw_dest

        print(f"  Trimming to {duration}s with fade...")
        trim_cmd = build_ffmpeg_trim_fade_cmd(source_for_trim, final_path, duration=duration)
        trim_proc = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=300)
        if trim_proc.returncode != 0:
            result["error"] = f"FFmpeg trim/fade failed: {trim_proc.stderr[:300]}"
            print(f"  ERROR: {result['error']}")
            return result

        # v2.27: Add hold frame at end if requested
        if hold_end > 0:
            print(f"  Adding {hold_end}s hold frame at end...")
            held_path = final_path.replace('.mp4', '_held.mp4')
            success, error = add_hold_frame(final_path, hold_end, held_path)
            if success:
                os.replace(held_path, final_path)
                print(f"  Hold frame added ({hold_end}s)")
            else:
                print(f"  WARNING: Could not add hold frame: {error}")

        print(f"  Final animation: {final_path}")
        result["animation_paths"].append(final_path)

    if dry_run:
        print("\n  [DRY RUN] Complete. No videos generated.")
        result["success"] = True
        return result

    manifest_path = get_logo_manifest_path(assets_dir)
    run_entry = {
        "run_id": run_id,
        "status": "completed",
        "frame": f"{run_id}_logo_frame.jpg",
        "final_video": f"{run_id}_logo_animation.mp4",
        "created_at": datetime.now().isoformat(),
    }

    manifest_data = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest_data = json.load(f)

    runs = manifest_data.get("runs", [])
    runs.append(run_entry)

    update_logo_manifest(manifest_path, {
        "logo_source": f"logo_source{logo_ext}",
        "logo_description": logo_description,
        "preset": preset_name,
        "direction": direction,
        "duration": duration,
        "ratio": ratio,
        "quality": quality,
        "variations": variations,
        "runs": runs,
    })
    print(f"\n  Manifest updated: {manifest_path}")

    result["success"] = True
    print(f"\n{'=' * 50}")
    print("Logo animation complete!")
    print(f'  Use with stitch: --logo-intro "{result["animation_paths"][0]}"')
    print(f"{'=' * 50}")

    # v2.27: Open preview if requested
    if preview and result["animation_paths"]:
        print("  Opening preview...")
        open_video_preview(result["animation_paths"][0])

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Logo Candy — Generate animated logo intro/outro using Veo 3 I2V (Phase 5.5)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Presets:
  liquid-chrome      Molten metal assembly (reverse)   - Luxury, tech
  particle-assemble  Glowing particles fuse (reverse)  - Gaming, software
  sketch-to-life     Pencil sketch fills color          - Design, consulting
  neon-powerup       Neon gas ignition                  - Nightlife, fashion
  organic-growth     Moss/flowers form logo (reverse)   - Eco, wellness
  ink-drop           Ink clouds form shape (reverse)    - Elegant, publishers
  fabric-weave       Silk threads interlock (reverse)   - Fashion, interior
  glitch-decode      Datamosh reveals logo              - Security, IT
  custom             User provides custom prompt         - Any
""",
    )

    parser.add_argument("--logo", help="Path to logo file (PNG/JPG)")
    parser.add_argument("--project", help="Project slug (e.g., 'my-brand')")
    parser.add_argument("--preset", default="liquid-chrome", choices=list(PRESETS.keys()),
                       help="Animation preset (default: liquid-chrome)")
    parser.add_argument("--prompt", help="Custom prompt template (required if preset=custom). Use {logo_description} placeholder.")
    parser.add_argument("--background", choices=["dark", "light", "brick", "water", "neutral", "noise", "green"],
                       help="Background type (default: auto from preset)")
    parser.add_argument("--direction", choices=["forward", "reverse"],
                       help="Animation direction (default: auto from preset)")
    parser.add_argument("--duration", type=float, default=6.0, help="Target duration in seconds (default: 6)")
    parser.add_argument("--ratio", default="landscape", choices=["landscape", "portrait"],
                       help="Aspect ratio (default: landscape)")
    parser.add_argument("--quality", default="fast", choices=["fast", "quality", "free"],
                       help="Veo quality tier (default: fast)")
    parser.add_argument("--variations", type=int, default=1, choices=[1, 2, 3, 4],
                       help="Number of variations (default: 1)")
    parser.add_argument("--logo-description", help="Manual text description of logo (skips Gemini auto-describe)")
    parser.add_argument("--backend", default="useapi", choices=["direct", "useapi"],
                       help="Veo backend (default: useapi)")
    parser.add_argument("--raw", action="store_true",
                       help="Pad logo to ratio using its own background (skip preset background). Veo handles the effect.")
    parser.add_argument("--hold-end", type=float, default=0,
                       help="Freeze final frame for N seconds at end (e.g., --hold-end 2) to ensure logo visibility")
    parser.add_argument("--preview", action="store_true",
                       help="Open animation in default video player after generation")
    parser.add_argument("--dry-run", action="store_true", help="Validate without generating")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompts")
    parser.add_argument("--list-presets", action="store_true", help="List all available presets and exit")

    args = parser.parse_args()

    if args.list_presets:
        print("\nAvailable Logo Candy Presets:\n")
        for name, p in PRESETS.items():
            icon = "<-" if p["direction"] == "reverse" else "->"
            mode = p.get("veo_mode", "i2v").upper()
            print(f"  {name:20s} {icon} {p['direction']:8s}  {mode:3s}  bg={p['background']:7s}  {p['best_for']}")
        return

    if not args.logo:
        parser.error("--logo is required (unless using --list-presets)")
    if not args.project:
        parser.error("--project is required (unless using --list-presets)")

    if not os.path.exists(args.logo):
        print(f"Error: Logo file not found: {args.logo}")
        sys.exit(1)

    project_path = resolve_project_path(args.project, PROJECTS_BASE)
    if not project_path:
        project_path = os.path.join(PROJECTS_BASE, args.project)
        if not os.path.isdir(project_path):
            print(f"Error: Project not found: {args.project}")
            print(f"  Searched in: {PROJECTS_BASE}")
            sys.exit(1)

    if not args.dry_run and not args.yes:
        preset = get_preset(args.preset)
        print(f"\nWill generate {args.preset} logo animation ({preset['direction']}) for project '{args.project}'")
        print(f"  Quality: {args.quality}, Ratio: {args.ratio}, Duration: {args.duration}s")
        resp = input("Proceed? [y/N] ").strip().lower()
        if resp not in ("y", "yes"):
            print("Cancelled.")
            return

    result = generate_logo_animation(
        logo_path=args.logo,
        project_path=project_path,
        preset_name=args.preset,
        custom_prompt=args.prompt,
        background=args.background,
        direction=args.direction,
        duration=args.duration,
        ratio=args.ratio,
        quality=args.quality,
        variations=args.variations,
        logo_description=args.logo_description,
        backend=args.backend,
        dry_run=args.dry_run,
        auto_confirm=args.yes,
        raw_logo=args.raw,
        hold_end=args.hold_end,
        preview=args.preview,
    )

    if not result["success"]:
        print(f"\nFailed: {result.get('error', 'Unknown error')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
