#!/usr/bin/env python3
"""bunty_re_encode_segments.py — surgical re-encode + demuxer concat for partial Bunty fixes.

Used after a small fix (e.g. shortened dialogue, voice-changed a single scene) where you
DON'T want stitch_bunty.py to re-encode all 16-18 segments from scratch. Re-encodes only
the segments you specify, leaves the rest intact, then demuxer-concats everything into
the final video.

Used by:
  - Match 1 v1→v2: redo full intro AND outro (4 segments)
  - Match 2 v2→v3: redo only slide segments (TTS changed) — actually that case still uses
    stitch_bunty.py because all 14 slide segments need re-encoding
  - Match 3 v1→v2: redo only intro pair after dialogue shortened (2 segments)

Usage:
  python3 bunty_re_encode_segments.py --project projects/<slug> \\
      --intro 17,19 --num-slides 14 --outro 20,21 \\
      --re-encode intro     # re-encode only the 2 intro segments, reuse existing slide/outro

  python3 bunty_re_encode_segments.py --project projects/<slug> \\
      --intro 17,19 --num-slides 14 --outro 20,21 \\
      --re-encode outro     # re-encode only the 2 outro segments

  python3 bunty_re_encode_segments.py --project projects/<slug> \\
      --intro 17,19 --num-slides 14 --outro 20,21 \\
      --re-encode scenes:17,20   # re-encode specific scenes only

Notes:
  - Requires the OTHER segments to already exist in {project}/final/segments/
  - Uses _vc.mp4 (voice-changed) variants where available, falls back to .mp4
  - Mirrors stitch_bunty.py's encoding params for stream-compatible -c copy concat
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# cwd hardening — relative paths in subprocess calls
REPO_ROOT = Path(__file__).resolve().parents[4]
if Path.cwd() != REPO_ROOT:
    os.chdir(REPO_ROOT)

REENCODE_VF_BASE = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p"
REENCODE_ARGS = ["-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-ar", "44100", "-ac", "2"]


def get_duration(path: Path) -> float:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(res.stdout.strip())


def pick_video(videos_dir: Path, scene: int) -> Path:
    """Prefer _vc.mp4 over plain .mp4 (voice-changed)."""
    vc = videos_dir / f"run001_scene_{scene}_vc.mp4"
    plain = videos_dir / f"run001_scene_{scene}.mp4"
    if vc.exists():
        return vc
    if plain.exists():
        return plain
    raise FileNotFoundError(f"No video for scene {scene} in {videos_dir}")


def encode_lipsync(src: Path, dest: Path, *, fade_in: float = 0.0, fade_out: float = 0.0) -> None:
    """Re-encode a lip-sync scene with optional fade-in / fade-out at the boundaries."""
    dur = get_duration(src)
    vf = [REENCODE_VF_BASE]
    af = []
    if fade_in > 0:
        vf.append(f"fade=t=in:st=0:d={fade_in}")
        af.append(f"afade=t=in:st=0:d={fade_in}")
    if fade_out > 0:
        fade_start = dur - fade_out
        vf.append(f"fade=t=out:st={fade_start:.3f}:d={fade_out}")
        af.append(f"afade=t=out:st={fade_start:.3f}:d={fade_out}")

    cmd = ["ffmpeg", "-y", "-i", str(src), "-vf", ",".join(vf)]
    if af:
        cmd += ["-af", ",".join(af)]
    cmd += REENCODE_ARGS + [str(dest)]

    desc = f"Encoding {src.name}"
    if fade_in: desc += " + fade-in"
    if fade_out: desc += " + fade-out"
    print(f"  {desc}…", file=sys.stderr)
    subprocess.run(cmd, capture_output=True, text=True, check=True)


def encode_slide(slide_img: Path, tts_file: Path, dest: Path, *, fade_in: float = 0.0, fade_out: float = 0.0) -> None:
    """Re-encode a slide segment from static image + TTS audio."""
    tts_dur = get_duration(tts_file)
    vf = [REENCODE_VF_BASE]
    af = ["aresample=44100", "aformat=channel_layouts=stereo"]
    if fade_in > 0:
        vf.append(f"fade=t=in:st=0:d={fade_in}")
        af.append(f"afade=t=in:st=0:d={fade_in}")
    if fade_out > 0:
        fade_start = tts_dur - fade_out
        vf.append(f"fade=t=out:st={fade_start:.3f}:d={fade_out}")
        af.append(f"afade=t=out:st={fade_start:.3f}:d={fade_out}")

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", str(slide_img),
        "-i", str(tts_file),
        "-filter_complex", f"[0:v]{','.join(vf)}[v];[1:a]{','.join(af)}[a]",
        "-map", "[v]", "-map", "[a]",
        "-t", f"{tts_dur:.3f}", "-shortest",
    ] + REENCODE_ARGS + [str(dest)]

    print(f"  Encoding slide {slide_img.stem} ({tts_dur:.1f}s)…", file=sys.stderr)
    subprocess.run(cmd, capture_output=True, text=True, check=True)


def demuxer_concat(segments: list[Path], output: Path, segments_dir: Path) -> bool:
    """ffmpeg -f concat -c copy. Requires consistent encoding across segments."""
    concat_list = segments_dir / "concat.txt"
    with concat_list.open("w") as f:
        for seg in segments:
            f.write(f"file '{os.path.abspath(seg)}'\n")
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(output)]
    print(f"  Demuxer concat of {len(segments)} segments → {output.name}", file=sys.stderr)
    return subprocess.run(cmd, capture_output=True, text=True).returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="Project directory (e.g. projects/2026-05-09_wicc-vs-rothwell-town)")
    ap.add_argument("--intro", required=True, help="Comma-separated intro scene numbers (e.g. '17,19')")
    ap.add_argument("--num-slides", type=int, required=True, help="Total slide count")
    ap.add_argument("--outro", required=True, help="Comma-separated outro scene numbers (e.g. '20,21')")
    ap.add_argument("--re-encode", required=True, help="What to re-encode: 'intro' | 'outro' | 'all' | 'scenes:17,20' | 'slides:3,5'")
    ap.add_argument("--fade", type=float, default=0.75, help="Fade-through-black duration (default: 0.75)")
    ap.add_argument("--output", help="Output path (default: {project}/final/{slug}_BUNTY.mp4)")
    args = ap.parse_args()

    project = Path(args.project)
    if not project.is_dir():
        ap.error(f"--project not found: {project}")

    slug = project.name
    segments_dir = project / "final" / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)
    videos_dir = project / "videos"
    slides_dir = project / "slides"
    tts_dir = project / "audio" / "tts"

    intro_scenes = [int(s) for s in args.intro.split(",")]
    outro_scenes = [int(s) for s in args.outro.split(",")]

    # Determine which segments to re-encode
    spec = args.re_encode.strip().lower()
    re_intro = re_outro = False
    re_slides: set[int] = set()
    re_intro_scenes: set[int] = set()
    re_outro_scenes: set[int] = set()
    if spec == "all":
        re_intro = re_outro = True
        re_slides = set(range(1, args.num_slides + 1))
    elif spec == "intro":
        re_intro = True
        re_intro_scenes = set(intro_scenes)
    elif spec == "outro":
        re_outro = True
        re_outro_scenes = set(outro_scenes)
    elif spec.startswith("scenes:"):
        wanted = {int(s) for s in spec.split(":", 1)[1].split(",")}
        re_intro_scenes = wanted & set(intro_scenes)
        re_outro_scenes = wanted & set(outro_scenes)
    elif spec.startswith("slides:"):
        re_slides = {int(s) for s in spec.split(":", 1)[1].split(",")}
    else:
        ap.error(f"Unknown --re-encode spec: {args.re_encode}")

    # Encode intros if requested
    if re_intro or re_intro_scenes:
        for idx, scene in enumerate(intro_scenes):
            if re_intro_scenes and scene not in re_intro_scenes:
                continue
            src = pick_video(videos_dir, scene)
            dest = segments_dir / f"seg_intro_{idx}.mp4"
            is_last = idx == len(intro_scenes) - 1
            encode_lipsync(src, dest, fade_out=args.fade if is_last else 0.0)

    # Encode slides if requested
    for n in sorted(re_slides):
        img = slides_dir / f"slide_{n:03d}.jpg"
        tts = tts_dir / f"scene_{n}_tts.mp3"
        if not img.exists() or not tts.exists():
            print(f"  WARN: skipping slide {n} (missing image or TTS)", file=sys.stderr)
            continue
        dest = segments_dir / f"seg_slide_{n:02d}.mp4"
        is_first = n == 1
        is_last = n == args.num_slides
        encode_slide(img, tts, dest, fade_in=args.fade if is_first else 0.0, fade_out=args.fade if is_last else 0.0)

    # Encode outros if requested
    if re_outro or re_outro_scenes:
        for idx, scene in enumerate(outro_scenes):
            if re_outro_scenes and scene not in re_outro_scenes:
                continue
            src = pick_video(videos_dir, scene)
            dest = segments_dir / f"seg_outro_{idx}.mp4"
            is_first = idx == 0
            encode_lipsync(src, dest, fade_in=args.fade if is_first else 0.0)

    # Assemble concat order: intro_0..N, slide_01..N, outro_0..N
    order = []
    for idx in range(len(intro_scenes)):
        order.append(segments_dir / f"seg_intro_{idx}.mp4")
    for n in range(1, args.num_slides + 1):
        order.append(segments_dir / f"seg_slide_{n:02d}.mp4")
    for idx in range(len(outro_scenes)):
        order.append(segments_dir / f"seg_outro_{idx}.mp4")

    missing = [str(p) for p in order if not p.exists()]
    if missing:
        print("ERROR: cannot concat — missing segments:", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        return 1

    output = Path(args.output) if args.output else project / "final" / f"{slug}_BUNTY.mp4"
    if not demuxer_concat(order, output, segments_dir):
        print("ERROR: demuxer concat failed", file=sys.stderr)
        return 1

    dur = get_duration(output)
    size_mb = output.stat().st_size / 1_000_000
    print(f"\nDONE! {output}")
    print(f"  Duration: {dur:.1f}s ({dur/60:.1f} min)")
    print(f"  Size:     {size_mb:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
