#!/usr/bin/env python3
"""bunty_finish.py — Run the full lip-sync → voice-change → stitch tail in one command.

This is the back half of the Bunty pipeline, after the narration/TTS/intro/outro/bumper
images are already in place. It collapses the ~7 hand-typed Bash calls (which is where
flag mismatches and skipped steps creep in) into a single invocation:

  1. Veo lip-sync for the first intro scene (from images/run001_scene_<A>_frame.jpg)
  2. Extract its last frame → Veo lip-sync the chained second intro scene
  3. Same chained pair for the outro scenes
  4. Voice-change all four clips into Bunty's ElevenLabs voice
  5. stitch_bunty.py (auto-builds the bumper from images/bumper_frame.jpg + jingle,
     re-encodes segments with fades, demuxer-concats, copies to ~/Documents, writes preview.html)

Prerequisites (this wrapper does NOT create them):
  - images/run001_scene_<introA>_frame.jpg     (intro Bunty image, + _landscape variant)
  - images/run001_scene_<outroA>_frame.jpg      (outro Bunty image, + _landscape variant)
  - images/bumper_frame.jpg                      (composite for the opening bumper)
  - audio/tts/scene_*_tts.mp3                     (narration for all slides)
  - slides/                                       (rendered slide images)

Usage:
  python3 bunty_finish.py --product 2026-05-27_wicc-7687375 --num-slides 15 \\
      --lipsync-json projects/2026-05-27_wicc-7687375/lipsync.json

  # lipsync.json maps each lip-sync scene to its Veo prompt + spoken dialogue:
  #   {
  #     "17": {"prompt": "...", "dialogue": "..."},
  #     "19": {"prompt": "...", "dialogue": "..."},
  #     "20": {"prompt": "...", "dialogue": "..."},
  #     "21": {"prompt": "...", "dialogue": "..."}
  #   }

Notes:
  - Default scenes: intro=17,19  outro=20,21 (the established Bunty layout)
  - If --lipsync-json omits a scene's "prompt", the default prompt from bunty_regen is used.
  - To regenerate only ONE segment after a fix, use bunty_regen.py instead.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Allow imports from the same scripts dir, and inherit bunty_regen's repo-root chdir.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bunty_regen import (  # noqa: E402  (import after sys.path insert + chdir side-effect)
    run,
    extract_last_frame,
    write_json,
    find_project_root,
    INTRO_PROMPTS,
    OUTRO_PROMPTS,
    BUNTY_VOICE_ID,
    DEFAULT_INTRO_SCENES,
    DEFAULT_OUTRO_SCENES,
    FADE,
)

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Run the Bunty lip-sync → voice-change → stitch tail in one command.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--project", help="Project directory (e.g., projects/<slug>)")
    p.add_argument("--product", help="Project slug (e.g., 2026-05-27_wicc-7687375). One of --project/--product required.")
    p.add_argument("--num-slides", type=int, required=True, help="Number of narrated slides (1..N)")
    p.add_argument("--intro-scenes", default=",".join(map(str, DEFAULT_INTRO_SCENES)),
                   help=f"Comma-separated intro lip-sync scenes (default {','.join(map(str, DEFAULT_INTRO_SCENES))})")
    p.add_argument("--outro-scenes", default=",".join(map(str, DEFAULT_OUTRO_SCENES)),
                   help=f"Comma-separated outro lip-sync scenes (default {','.join(map(str, DEFAULT_OUTRO_SCENES))})")
    p.add_argument("--lipsync-json", help="JSON file mapping scene -> {prompt, dialogue}. dialogue is required per scene.")
    p.add_argument("--fade", type=float, default=FADE, help=f"Fade-through-black seconds (default {FADE})")
    p.add_argument("--no-copy", action="store_true", help="Skip copying the final video to ~/Documents/WICC Bunty Videos/")
    p.add_argument("--skip-veo", action="store_true", help="Reuse existing scene clips; jump straight to voice-change + stitch.")
    return p.parse_args()


def resolve_slug(args: argparse.Namespace) -> str:
    if args.product:
        return args.product if os.path.sep not in args.product else os.path.basename(os.path.normpath(args.product))
    if args.project:
        return os.path.basename(os.path.normpath(args.project))
    sys.exit("ERROR: one of --project or --product is required")


def veo_pair(slug: str, project_dir: Path, scenes: list[int], lipsync: dict[int, dict]) -> None:
    """Generate a chained 2-clip (or 1-clip) lip-sync segment. First scene drives from its
    pre-staged frame; the second scene chains off the first's last frame."""
    images_dir = project_dir / "images"
    videos_dir = project_dir / "videos"
    vr_root = project_dir.parent.parent

    for idx, scene in enumerate(scenes):
        if idx == 1:
            # Chain: extract last frame of the previous scene as this scene's start frame.
            prev_video = videos_dir / f"run001_scene_{scenes[0]}.mp4"
            chained_frame = images_dir / f"run001_scene_{scene}_frame.jpg"
            print(f"\n[chain] {prev_video.name} last frame → {chained_frame.name}", file=sys.stderr)
            extract_last_frame(prev_video, chained_frame)

        info = lipsync.get(scene, {})
        prompt = info.get("prompt") or INTRO_PROMPTS.get(scene) or OUTRO_PROMPTS.get(scene)
        dialogue = info.get("dialogue")
        if not prompt:
            sys.exit(f"ERROR: no Veo prompt for scene {scene} (provide one in --lipsync-json)")
        if not dialogue:
            sys.exit(f"ERROR: no dialogue for scene {scene} (provide one in --lipsync-json)")

        scenes_json = project_dir / f"scenes_lipsync_{scene}.json"
        dialogue_json = project_dir / f"dialogue_lipsync_{scene}.json"
        write_json(scenes_json, {str(scene): prompt})
        write_json(dialogue_json, {str(scene): dialogue})

        print(f"\n[veo] lip-sync scene {scene}", file=sys.stderr)
        run([
            sys.executable, os.path.join(SCRIPTS_DIR, "parallel_video_gen.py"),
            "--product", slug, "--mode", "frames-to-video",
            "--images-dir", str(images_dir),
            "--scenes", scenes_json.read_text(),
            "--lip-sync", "--dialogue", dialogue_json.read_text(),
            "--image-run", "run001", "--ratio", "landscape", "--quality", "fast",
            "--variations", "1", "--allow-stale", "--continue", "--yes",
        ], cwd=str(vr_root))


def main() -> None:
    args = parse_args()
    slug = resolve_slug(args)
    project_dir = find_project_root(slug)
    intro_scenes = [int(x) for x in args.intro_scenes.split(",")]
    outro_scenes = [int(x) for x in args.outro_scenes.split(",")]
    all_scenes = intro_scenes + outro_scenes

    lipsync: dict[int, dict] = {}
    if args.lipsync_json:
        raw = json.loads(Path(args.lipsync_json).read_text())
        lipsync = {int(k): v for k, v in raw.items()}

    vr_root = project_dir.parent.parent

    if not args.skip_veo:
        print("\n=== Veo lip-sync: intro segment ===", file=sys.stderr)
        veo_pair(slug, project_dir, intro_scenes, lipsync)
        print("\n=== Veo lip-sync: outro segment ===", file=sys.stderr)
        veo_pair(slug, project_dir, outro_scenes, lipsync)

    # Voice-change all lip-sync clips into Bunty's voice.
    print(f"\n=== Voice-change scenes {','.join(map(str, all_scenes))} ===", file=sys.stderr)
    run([
        sys.executable, os.path.join(SCRIPTS_DIR, "generate_tts.py"),
        "--voice-change",
        "--videos-dir", str(project_dir / "videos"),
        "--scenes", ",".join(map(str, all_scenes)),
        "--voice-id", BUNTY_VOICE_ID,
        "--seed", "42", "--remove-bg-noise", "--yes",
    ], cwd=str(vr_root))

    # Stitch (auto bumper + preview). stitch_bunty.py now accepts --product directly.
    print("\n=== Stitch (bumper + slides + outro + preview) ===", file=sys.stderr)
    stitch_cmd = [
        sys.executable, os.path.join(SCRIPTS_DIR, "stitch_bunty.py"),
        "--product", slug,
        "--num-slides", str(args.num_slides),
        "--intro-scenes", ",".join(map(str, intro_scenes)),
        "--outro-scenes", ",".join(map(str, outro_scenes)),
        "--fade", str(args.fade),
    ]
    if not args.no_copy:
        stitch_cmd.append("--copy-to-documents")
    run(stitch_cmd, cwd=str(vr_root))


if __name__ == "__main__":
    main()
