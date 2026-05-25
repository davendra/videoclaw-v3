#!/usr/bin/env python3
"""bunty_regen.py — Regenerate one segment (intro or outro) of a Bunty match recap.

Wraps the painful 10-step manual flow into one command:
  1. Replace the first scene's source image (from --image-url or --image-file)
  2. Wipe stale artifacts (scene videos, _vc clips, segment encodings, chained frame)
  3. Veo lip-sync for first scene (parallel_video_gen.py)
  4. Extract last frame → start frame for chained second scene
  5. Veo lip-sync for second scene
  6. Voice-change all new clips
  7. Re-encode segment files with proper fades
  8. Demuxer-concat with existing intro/slide/outro segments → final video

Usage:
  # Step 1: get the canonical Bunty image prompt (paste into mcp__go-bananas__generate_image)
  python3 bunty_regen.py --print-prompt --segment outro

  # Step 2: run the regen with the URL Go Bananas returned
  python3 bunty_regen.py --project projects/2026-05-09_wicc-vs-rothwell-town \\
      --segment outro --image-url "https://pub-...r2.dev/.../bunty.jpg"

Notes:
  - Default scenes: intro=17,19  outro=20,21 (matches the established Bunty layout)
  - Slide segments are NOT touched — only the segment you specify is regenerated
  - The final video is rebuilt by demuxer-concat of all segments (intro + slides + outro),
    so the segments NOT being regenerated must already exist in projects/<slug>/final/segments/
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

# Allow imports from the same scripts dir
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# cwd hardening — the script uses relative paths in subprocess calls
# (parallel_video_gen.py expects `projects/<slug>/...`), so anchor to the
# video-replicator-veo-cli repo root regardless of where the caller invoked us.
REPO_ROOT = Path(__file__).resolve().parents[4]
if Path.cwd() != REPO_ROOT:
    os.chdir(REPO_ROOT)

from bunty_helpers import (
    build_bunty_image_kwargs,
    build_match_ground_scene_description,
    get_location_scene,
    get_location_ambient,
    list_locations,
    parse_ground_from_match_facts,
    BUNTY_LOCATIONS,
    DEFAULT_LOCATION,
)

DEFAULT_INTRO_SCENES = [17, 19]
DEFAULT_OUTRO_SCENES = [20, 21]
BUNTY_VOICE_ID = "nwj0s2LU9bDWRKND5yzA"
FADE = 0.75

# Scene descriptions for the default cricket-ground location, kept for backward
# compatibility with any caller importing them directly. Use get_location_scene()
# for new code — supports the full BUNTY_LOCATIONS registry.
INTRO_SCENE_DESC = get_location_scene(DEFAULT_LOCATION, "intro")
OUTRO_SCENE_DESC = get_location_scene(DEFAULT_LOCATION, "outro")

INTRO_PROMPTS = {
    17: (
        "Cartoon Indian cricket commentator Bunty in bright orange blazer holding microphone "
        "at the boundary of a green Northamptonshire cricket ground. Memorial Sports Ground "
        "in golden-hour light. Bunty has a thick black curly moustache, chubby cheeks, "
        "slicked back black hair, slightly chubby middle-aged build. Camera slowly pushes in "
        "toward his face. He begins completely still, pauses for a beat, then speaks "
        "energetically with big animated gestures. Photorealistic 3D Pixar-style. Sound: "
        "cricket ground ambience, distant crowd murmur, light wind. No music, no vocals "
        "beyond the speaker."
    ),
    19: (
        "Cartoon Indian cricket commentator Bunty in bright orange blazer holding microphone "
        "at the boundary of a green Northamptonshire cricket ground, golden-hour light. "
        "Bunty has a thick black curly moustache, chubby cheeks, slicked back black hair, "
        "slightly chubby middle-aged build. Camera tracks smoothly to the RIGHT across the "
        "boundary. Bunty continues with high energy, big animated hand gestures, eyes wide "
        "and focused, making strong eye contact with the camera. Photorealistic 3D Pixar-"
        "style. Sound: cricket ground ambience, distant crowd murmur, light wind. No music, "
        "no vocals beyond the speaker."
    ),
}
OUTRO_PROMPTS = {
    20: (
        "Cartoon Indian cricket commentator Bunty in orange blazer holding microphone at "
        "twilight on the cricket pitch. Memorial Sports Ground stadium lights glowing "
        "softly behind him. Bunty has a thick black curly moustache, chubby cheeks, "
        "slicked back black hair, slightly chubby middle-aged build. Camera slowly zooms "
        "out as he speaks reflectively, hand raised in gentle salute. He finishes "
        "speaking, returns to a still pose, and holds completely still for the final "
        "moment. Photorealistic 3D Pixar-style. Sound: evening cricket ground ambience, "
        "distant crowd, soft wind. No music, no vocals beyond the speaker."
    ),
    21: (
        "Cartoon Indian cricket commentator Bunty in orange blazer holding microphone at "
        "twilight on the cricket pitch, Memorial Sports Ground stadium lights glowing "
        "softly behind him. Bunty has a thick black curly moustache, chubby cheeks, "
        "slicked back black hair, slightly chubby middle-aged build. Camera is STATIC, "
        "locked off, holds the frame steady. Bunty delivers a dramatic, reflective sign-"
        "off with measured pauses. He finishes speaking, returns to a still pose, and "
        "holds completely still for the final two seconds. Photorealistic 3D Pixar-style. "
        "Sound: evening cricket ground ambience, distant crowd, soft wind. No music, no "
        "vocals beyond the speaker."
    ),
}


def run(cmd: list[str], cwd: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(cmd)}", file=sys.stderr)
    return subprocess.run(cmd, cwd=cwd, check=check)


def find_project_root(slug_or_path: str) -> Path:
    candidates = [
        Path(slug_or_path),
        Path("projects") / slug_or_path,
        Path("video-replicator-veo-cli/projects") / slug_or_path,
    ]
    for c in candidates:
        if c.is_dir():
            return c.resolve()
    sys.exit(f"ERROR: could not locate project: {slug_or_path}")


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)


def write_json(path: Path, data: dict) -> None:
    import json
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(data, f, indent=2)


def extract_last_frame(video: Path, frame_out: Path) -> None:
    frame_out.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-sseof", "-0.1", "-i", str(video),
        "-frames:v", "1", "-q:v", "2", str(frame_out)
    ])
    # Match the *_landscape.jpg convention so parallel_video_gen.py finds it
    landscape = frame_out.with_name(frame_out.stem + "_landscape" + frame_out.suffix)
    landscape.write_bytes(frame_out.read_bytes())


def encode_segment(
    video_path: Path, output_path: Path, fade_duration: float,
    apply_fade_in: bool = False, apply_fade_out: bool = False,
) -> None:
    vf_parts = [
        "scale=1280:720:force_original_aspect_ratio=decrease",
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "format=yuv420p",
    ]
    af_parts = []
    if apply_fade_in:
        vf_parts.append(f"fade=t=in:st=0:d={fade_duration}")
        af_parts.append(f"afade=t=in:st=0:d={fade_duration}")
    if apply_fade_out:
        # Probe duration
        dur = float(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", str(video_path)
        ]).decode().strip())
        fade_start = dur - fade_duration
        vf_parts.append(f"fade=t=out:st={fade_start:.3f}:d={fade_duration}")
        af_parts.append(f"afade=t=out:st={fade_start:.3f}:d={fade_duration}")
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", ",".join(vf_parts),
    ]
    if af_parts:
        cmd += ["-af", ",".join(af_parts)]
    cmd += [
        "-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-c:a", "aac", "-ar", "44100", "-ac", "2", str(output_path),
    ]
    run(cmd)


def demuxer_concat(seg_paths: list[Path], output: Path, segments_dir: Path) -> None:
    concat_list = segments_dir / "concat.txt"
    with concat_list.open("w") as f:
        for seg in seg_paths:
            f.write(f"file '{seg.resolve()}'\n")
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c", "copy", str(output)
    ])


def regenerate_segment(
    project_dir: Path,
    segment: str,             # "intro" or "outro"
    scenes: list[int],
    image_url: str | None,
    image_file: Path | None,
    dialogue: dict[int, str] | None,
    veo_prompts: dict[int, str],
) -> None:
    images_dir = project_dir / "images"
    videos_dir = project_dir / "videos"
    segments_dir = project_dir / "final" / "segments"
    final_output = project_dir / "final" / "match_day_analysis_BUNTY.mp4"

    if len(scenes) not in (1, 2):
        sys.exit(f"ERROR: --scenes must be 1 or 2 numbers, got {scenes}")

    first_scene = scenes[0]

    # Step 1: replace first scene's source image
    first_image = images_dir / f"run001_scene_{first_scene}_frame.jpg"
    print(f"\n[step 1] Replacing source image: {first_image}", file=sys.stderr)
    if image_url:
        download(image_url, first_image)
    elif image_file:
        first_image.write_bytes(image_file.read_bytes())
    else:
        sys.exit("ERROR: provide --image-url or --image-file")
    landscape = first_image.with_name(first_image.stem + "_landscape" + first_image.suffix)
    if landscape.exists():
        landscape.unlink()

    # Step 2: wipe stale artifacts for these scenes
    print("\n[step 2] Wiping stale artifacts", file=sys.stderr)
    for scene in scenes:
        for name in [
            f"run001_scene_{scene}.mp4",
            f"run001_scene_{scene}_vc.mp4",
        ]:
            (videos_dir / name).unlink(missing_ok=True)
            (videos_dir / "backups" / name).unlink(missing_ok=True)
    # Wipe chained frame for scene 2 (will be re-extracted)
    if len(scenes) == 2:
        chained_scene = scenes[1]
        for stem in [f"run001_scene_{chained_scene}_frame.jpg", f"run001_scene_{chained_scene}_frame_landscape.jpg"]:
            (images_dir / stem).unlink(missing_ok=True)
    # Wipe segment encodings
    for idx in range(len(scenes)):
        (segments_dir / f"seg_{segment}_{idx}.mp4").unlink(missing_ok=True)

    # Step 3: Veo lip-sync for first scene
    print(f"\n[step 3] Veo lip-sync scene {first_scene}", file=sys.stderr)
    scenes_json = project_dir / f"scenes_{segment}_{first_scene}.json"
    dialogue_json = project_dir / f"dialogue_{segment}_{first_scene}.json"
    write_json(scenes_json, {str(first_scene): veo_prompts[first_scene]})
    write_json(dialogue_json, {str(first_scene): dialogue[first_scene]})
    project_slug = project_dir.name
    veo_cmd = [
        sys.executable,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "parallel_video_gen.py"),
        "--product", project_slug,
        "--mode", "frames-to-video",
        "--images-dir", str(images_dir),
        "--scenes", scenes_json.read_text(),
        "--lip-sync",
        "--dialogue", dialogue_json.read_text(),
        "--image-run", "run001",
        "--ratio", "landscape",
        "--quality", "fast",
        "--variations", "1",
        "--allow-stale", "--continue", "--yes",
    ]
    # parallel_video_gen.py resolves project from cwd / projects/<slug>, so cwd must be the
    # video-replicator-veo-cli root.
    vr_root = project_dir.parent.parent
    run(veo_cmd, cwd=str(vr_root))

    # Step 4 + 5: chained second scene
    if len(scenes) == 2:
        chained_scene = scenes[1]
        first_video = videos_dir / f"run001_scene_{first_scene}.mp4"
        chained_frame = images_dir / f"run001_scene_{chained_scene}_frame.jpg"
        print(f"\n[step 4] Extracting last frame of scene {first_scene} → {chained_frame.name}", file=sys.stderr)
        extract_last_frame(first_video, chained_frame)

        print(f"\n[step 5] Veo lip-sync scene {chained_scene}", file=sys.stderr)
        scenes2_json = project_dir / f"scenes_{segment}_{chained_scene}.json"
        dialogue2_json = project_dir / f"dialogue_{segment}_{chained_scene}.json"
        write_json(scenes2_json, {str(chained_scene): veo_prompts[chained_scene]})
        write_json(dialogue2_json, {str(chained_scene): dialogue[chained_scene]})
        veo_cmd2 = list(veo_cmd)
        # Replace scenes/dialogue args
        for i, tok in enumerate(veo_cmd2):
            if tok == "--scenes":
                veo_cmd2[i + 1] = scenes2_json.read_text()
            elif tok == "--dialogue":
                veo_cmd2[i + 1] = dialogue2_json.read_text()
        run(veo_cmd2, cwd=str(vr_root))

    # Step 6: voice-change new clips
    print(f"\n[step 6] Voice-changing scenes {','.join(str(s) for s in scenes)}", file=sys.stderr)
    vc_cmd = [
        sys.executable,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "generate_tts.py"),
        "--voice-change",
        "--videos-dir", str(videos_dir),
        "--scenes", ",".join(str(s) for s in scenes),
        "--voice-id", BUNTY_VOICE_ID,
        "--seed", "42",
        "--remove-bg-noise",
        "--yes",
    ]
    run(vc_cmd, cwd=str(vr_root))

    # Step 7: re-encode segment files with proper fades
    # Convention from stitch_bunty.py:
    #   intro_0: no fades    intro_1: fade-out  (last intro fades into slide_01 fade-in)
    #   outro_0: fade-in     outro_1: no fades  (slide_N has fade-out into outro_0 fade-in)
    print("\n[step 7] Re-encoding segment files", file=sys.stderr)
    segments_dir.mkdir(parents=True, exist_ok=True)
    for idx, scene in enumerate(scenes):
        vc_video = videos_dir / f"run001_scene_{scene}_vc.mp4"
        plain_video = videos_dir / f"run001_scene_{scene}.mp4"
        source = vc_video if vc_video.exists() else plain_video
        seg_out = segments_dir / f"seg_{segment}_{idx}.mp4"
        is_first = idx == 0
        is_last = idx == len(scenes) - 1
        if segment == "intro":
            apply_fade_in = False
            apply_fade_out = is_last and len(scenes) > 0  # last intro fades out
        else:
            apply_fade_in = is_first  # first outro fades in
            apply_fade_out = False
        encode_segment(source, seg_out, FADE, apply_fade_in=apply_fade_in, apply_fade_out=apply_fade_out)

    # Step 8: demuxer-concat all segments → final video
    print("\n[step 8] Demuxer-concat → final video", file=sys.stderr)
    all_segs = sorted(segments_dir.glob("seg_intro_*.mp4")) \
        + sorted(segments_dir.glob("seg_slide_*.mp4")) \
        + sorted(segments_dir.glob("seg_outro_*.mp4"))
    if not all_segs:
        sys.exit(f"ERROR: no segments found in {segments_dir}")
    demuxer_concat(all_segs, final_output, segments_dir)
    size_mb = final_output.stat().st_size / 1024 / 1024
    dur = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(final_output)
    ]).decode().strip())
    print(f"\nDone. {final_output} — {size_mb:.1f} MB, {dur:.1f}s ({dur/60:.1f} min)")


def main() -> int:
    ap = argparse.ArgumentParser(description="Regenerate one segment of a Bunty match recap end-to-end")
    ap.add_argument("--project", help="Project slug or path (e.g. 2026-05-09_wicc-vs-rothwell-town)")
    ap.add_argument("--segment", choices=["intro", "outro"], help="Which segment to regenerate")
    ap.add_argument("--image-url", help="URL of the new Bunty source image (Go Bananas R2 URL)")
    ap.add_argument("--image-file", type=Path, help="Local path to the new Bunty source image")
    ap.add_argument("--scenes", help="Comma-separated scene numbers (default: intro=17,19  outro=20,21)")
    ap.add_argument("--print-prompt", action="store_true",
                    help="Print the canonical Bunty image-gen prompt for the chosen segment, then exit")
    ap.add_argument("--dialogue-file", type=Path,
                    help="Optional JSON file overriding default dialogue. Format: {\"scene_num\": \"text\", ...}")
    ap.add_argument("--location", default=DEFAULT_LOCATION, choices=sorted(BUNTY_LOCATIONS.keys()),
                    help=f"Location preset for the Bunty hero shot (default: {DEFAULT_LOCATION}). "
                         "Use --list-locations to see all options. Intro and outro share the same "
                         "location for visual continuity within a single match.")
    ap.add_argument("--list-locations", action="store_true",
                    help="List available Bunty location presets and exit")
    ap.add_argument("--auto-ground", action="store_true",
                    help="Parse the actual match ground from <project>/reference/match_facts.txt "
                         "and build a Bunty image prompt anchored to it (instead of the cricket-ground "
                         "preset). Requires --project. Overrides --location.")
    ap.add_argument("--ground", default=None,
                    help="Manual ground-name override for the Bunty image prompt (e.g. 'Avenue Road', "
                         "'Bernard Weston Pavilion'). Use when --auto-ground can't parse or you want "
                         "a different name than the scorecard has. Overrides --location.")
    args = ap.parse_args()

    if args.list_locations:
        print("Available Bunty location presets for --location:\n")
        for name, summary in list_locations():
            marker = " (default)" if name == DEFAULT_LOCATION else ""
            print(f"  {name}{marker}\n    {summary}\n")
        return 0

    if not args.segment:
        ap.error("--segment is required (unless using --list-locations)")

    # Resolve scene description with this precedence:
    #   1. --ground <name>            (manual override)
    #   2. --auto-ground + --project  (parse from match_facts.txt)
    #   3. --location <preset>        (default cricket-ground or user-picked preset)
    ground_name: str | None = None
    if args.ground:
        ground_name = args.ground.strip()
        scene_desc = build_match_ground_scene_description(ground_name, args.segment)
        scene_source = f"--ground={ground_name!r}"
    elif args.auto_ground:
        if not args.project:
            ap.error("--auto-ground requires --project (needs the project's match_facts.txt)")
        project_dir = find_project_root(args.project)
        facts_path = project_dir / "reference" / "match_facts.txt"
        ground_name = parse_ground_from_match_facts(facts_path)
        if not ground_name:
            print(f"  WARNING: --auto-ground could not parse Ground from {facts_path}; "
                  f"falling back to --location={args.location}", file=sys.stderr)
            scene_desc = get_location_scene(args.location, args.segment)
            scene_source = f"--location={args.location} (auto-ground fallback)"
        else:
            scene_desc = build_match_ground_scene_description(ground_name, args.segment)
            scene_source = f"--auto-ground (parsed {ground_name!r} from match_facts.txt)"
    else:
        scene_desc = get_location_scene(args.location, args.segment)
        scene_source = f"--location={args.location}"

    if args.print_prompt:
        kwargs = build_bunty_image_kwargs(scene_desc)
        import json
        print(json.dumps(kwargs, indent=2))
        print(f"\n# scene_source: {scene_source}", file=sys.stderr)
        return 0

    if not args.project:
        ap.error("--project is required (unless using --print-prompt)")

    project_dir = find_project_root(args.project)
    if args.scenes:
        scenes = [int(x.strip()) for x in args.scenes.split(",")]
    else:
        scenes = DEFAULT_INTRO_SCENES if args.segment == "intro" else DEFAULT_OUTRO_SCENES

    veo_prompts = INTRO_PROMPTS if args.segment == "intro" else OUTRO_PROMPTS
    dialogue = (
        {17: "What a day at the cricket! It's your boy Bunty, here with the full match-day analysis. Stick around — we've got numbers, performances, and a complete breakdown of today's game.",
         19: "We've got a top-order story, key performances with bat and ball, and a result that matters. Let's break this match down beat by beat — here we go!"}
        if args.segment == "intro"
        else
        {20: "What a match! The numbers tell the story. Standout performances all over the field — that's how cricket is meant to be played!",
         21: "Until next time — keep it Indian, keep it cricket. Bunty out!"}
    )
    if args.dialogue_file:
        import json
        override = json.loads(args.dialogue_file.read_text())
        dialogue = {int(k): v for k, v in override.items()}

    regenerate_segment(
        project_dir=project_dir,
        segment=args.segment,
        scenes=scenes,
        image_url=args.image_url,
        image_file=args.image_file,
        dialogue=dialogue,
        veo_prompts=veo_prompts,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
