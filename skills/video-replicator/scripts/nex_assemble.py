#!/usr/bin/env python3
"""Single-command final assembly for presenter-style videos.

Automates the 5 manual steps between "all videos generated" and "final output":
  1. Loop slide F2V videos to match TTS duration
  2. Bake TTS narration onto looped slides (skipped for lipsync scenes)
  3. Normalize all segments (mono→stereo, 1280x720, 24fps, fades)
  4. Concat via filter (drift-free for 8+ segments)
  5. Add background music (optional)

Backend-aware: Use --backend seedance to skip TTS bake for lipsync scenes
(Seedance audio-lipsync produces videos with baked-in audio).

Usage:
  python nex_assemble.py \\
    --project "projects/elite-ai-commodity-pricing" \\
    --num-slides 16 \\
    --intro-scenes 17,18 \\
    --outro-scenes 19,20 \\
    --music "projects/elite-ai-commodity-pricing/audio/background.mp3" \\
    --yes

  # Seedance backend — skip TTS bake for lipsync intro/outro scenes
  python nex_assemble.py \\
    --project "projects/revision-stack" \\
    --num-slides 16 --intro-scenes 17,18 --outro-scenes 19,20 \\
    --backend seedance --lipsync-scenes 17,18,19,20 \\
    --music "projects/revision-stack/audio/background.mp3" --yes
"""
import argparse
import json
import os
import sys

# Add scripts dir to path so modules can be imported
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from assembly_utils import (  # noqa: F401 — re-exported for backward compat
    add_background_music,
    bake_tts_onto_video,
    find_video,
    loop_video_to_duration,
    normalize_segment,
    probe_channels,
    relieve_memory,
)
from ffmpeg_wrapper import FFmpegWrapper, concat_via_filter
from logging_config import setup_logging

_ff = FFmpegWrapper()
logger = None  # Set in main()


def parse_args():
    parser = argparse.ArgumentParser(
        description="Assemble final video from generated assets",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  # Full assembly with music
  python nex_assemble.py \\
    --project projects/elite-ai-commodity-pricing \\
    --num-slides 16 --intro-scenes 17,18 --outro-scenes 19,20 \\
    --music projects/elite-ai-commodity-pricing/audio/background.mp3

  # No music, custom volumes
  python nex_assemble.py \\
    --project projects/my-deck \\
    --num-slides 10 --intro-scenes 11,12 --outro-scenes 13,14 \\
    --tts-volume 2.0 --sfx-volume 0.2 --fade 0.5

  # Seedance backend — skip TTS bake for lipsync scenes
  python nex_assemble.py \\
    --project projects/revision-stack \\
    --num-slides 16 --intro-scenes 17,18 --outro-scenes 19,20 \\
    --backend seedance --lipsync-scenes 17,18,19,20 \\
    --music projects/revision-stack/audio/background.mp3

  # Assembly + Nex Brief branding (title card image + logo intro)
  python nex_assemble.py \\
    --project projects/my-deck \\
    --num-slides 16 --intro-scenes 17,18 --outro-scenes 19,20 \\
    --music projects/my-deck/audio/background.mp3 \\
    --brand-title-card projects/my-deck/assets/title_card_final.jpg
""",
    )
    parser.add_argument("--project", required=True, help="Project directory")
    parser.add_argument("--num-slides", type=int, required=True, help="Number of slides (1 to N)")
    parser.add_argument("--intro-scenes", required=True, help="Comma-separated intro scene numbers")
    parser.add_argument("--outro-scenes", required=True, help="Comma-separated outro scene numbers")
    parser.add_argument("--music", help="Background music file path")
    parser.add_argument("--music-volume", type=float, default=0.05, help="Music mix level (default: 0.05)")
    parser.add_argument("--tts-volume", type=float, default=2.5, help="TTS narration level during bake (default: 2.5)")
    parser.add_argument("--sfx-volume", type=float, default=0.15, help="Video SFX level during bake (default: 0.15)")
    parser.add_argument("--fade", type=float, default=0.75, help="Fade-through-black at section boundaries (0=off, default: 0.75)")
    parser.add_argument("--output", help="Output path (default: {project}/final/{slug}_nex.mp4)")
    parser.add_argument("--backend", choices=["veo", "seedance"], default="veo",
                        help="Video backend (default: veo). Seedance skips TTS bake for lipsync scenes")
    parser.add_argument("--run", help="Run prefix to use (e.g., run003). Default: auto-detect latest")
    parser.add_argument("--lipsync-scenes", help="Comma-separated scene numbers with native audio (skip TTS bake)")
    parser.add_argument("--title-card", help="Title card video to prepend before intro (from generate_title_card.py)")
    parser.add_argument("--brand-title-card",
                        help="Title card IMAGE for Nex Brief branding. After assembly, "
                             "runs brand_episode.py to prepend title card (4s) + logo intro (6s)")
    parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    return parser.parse_args()


def main():
    global logger
    args = parse_args()
    logger = setup_logging("nex_assemble", verbose=args.verbose)

    # Parse scene numbers
    intro_scenes = [int(x.strip()) for x in args.intro_scenes.split(",")]
    outro_scenes = [int(x.strip()) for x in args.outro_scenes.split(",")]
    num_slides = args.num_slides
    fade = args.fade
    run_id = args.run

    # Parse lipsync scenes (scenes with native audio — skip TTS bake)
    lipsync_scenes = set()
    if args.lipsync_scenes:
        lipsync_scenes = {int(x.strip()) for x in args.lipsync_scenes.split(",")}

    # Derive paths
    project = os.path.abspath(args.project)
    videos_dir = os.path.join(project, "videos")
    tts_dir = os.path.join(project, "audio", "tts")
    manifest_path = os.path.join(project, "audio", "narration_manifest.json")
    segments_dir = os.path.join(project, "final", "segments")
    slug = os.path.basename(project)
    output = args.output or os.path.join(project, "final", f"{slug}_nex.mp4")

    # Validate directories
    if not os.path.isdir(videos_dir):
        logger.error("videos directory not found: %s", videos_dir)
        sys.exit(1)

    # TTS dir is optional if all scenes are lipsync
    all_scene_nums = set(range(1, num_slides + 1)) | set(intro_scenes) | set(outro_scenes)
    needs_tts = all_scene_nums - lipsync_scenes
    slides_needing_tts = set(range(1, num_slides + 1)) - lipsync_scenes

    if slides_needing_tts and not os.path.isdir(tts_dir):
        logger.error("audio/tts directory not found: %s", tts_dir)
        sys.exit(1)

    # Load narration manifest for TTS durations (only needed for slides with TTS)
    tts_durations = {}
    if slides_needing_tts:
        if not os.path.exists(manifest_path):
            logger.error("Narration manifest not found: %s", manifest_path)
            sys.exit(1)

        with open(manifest_path) as f:
            manifest = json.load(f)

        for scene in manifest.get("scenes", []):
            tts_durations[scene["scene_number"]] = scene["duration"]

    os.makedirs(segments_dir, exist_ok=True)
    os.makedirs(os.path.dirname(output), exist_ok=True)

    # Validate title card if provided
    title_card_path = None
    if args.title_card:
        if not os.path.exists(args.title_card):
            logger.error("Title card not found: %s", args.title_card)
            sys.exit(1)
        title_card_path = args.title_card

    # Print configuration
    has_title_card = title_card_path is not None
    total_segments = (1 if has_title_card else 0) + len(intro_scenes) + num_slides + len(outro_scenes)
    logger.info("Nex Assemble — %s", slug)
    logger.info("  Backend: %s", args.backend)
    if has_title_card:
        logger.info("  Title:  %s", title_card_path)
    logger.info("  Intro:  scenes %s", intro_scenes)
    logger.info("  Slides: 1-%d (%d scenes)", num_slides, num_slides)
    logger.info("  Outro:  scenes %s", outro_scenes)
    logger.info("  Total:  %d segments", total_segments)
    if lipsync_scenes:
        logger.info("  Lipsync: scenes %s (skip TTS bake)", sorted(lipsync_scenes))
    logger.info("  Fades:  %ss" % fade if fade > 0 else "  Fades:  disabled")
    logger.info("  TTS vol=%s, SFX vol=%s", args.tts_volume, args.sfx_volume)
    if run_id:
        logger.info("  Run:    %s", run_id)
    if args.music:
        logger.info("  Music:  %s (vol=%s)", args.music, args.music_volume)
    logger.info("")

    if not args.yes:
        response = input("Proceed? [Y/n] ").strip().lower()
        if response and response != "y":
            logger.info("Aborted.")
            sys.exit(0)

    # ================================================================
    # Step 1: Loop slide videos to TTS duration
    # ================================================================
    logger.info("=== Step 1: Loop slide videos to TTS duration ===")
    looped_dir = os.path.join(segments_dir, "looped")
    os.makedirs(looped_dir, exist_ok=True)

    for i in range(1, num_slides + 1):
        video = find_video(videos_dir, i, run_id=run_id)
        if not video:
            logger.error("  No video found for slide scene %d", i)
            sys.exit(1)

        if i in lipsync_scenes:
            # Lipsync scenes have native audio — just copy, no loop needed
            looped_path = os.path.join(looped_dir, f"looped_{i}.mp4")
            import shutil
            shutil.copy2(video, looped_path)
            dur = _ff.get_duration(video)
            logger.info("  [%d/%d] Scene %d: %.1fs (lipsync, no loop)", i, num_slides, i, dur)
            continue

        tts_dur = tts_durations.get(i)
        if not tts_dur:
            logger.error("  No TTS duration for scene %d in manifest", i)
            sys.exit(1)

        looped_path = os.path.join(looped_dir, f"looped_{i}.mp4")
        loop_video_to_duration(video, tts_dur, looped_path)
        logger.info("  [%d/%d] Scene %d: %.1fs", i, num_slides, i, tts_dur)
        relieve_memory()

    # ================================================================
    # Step 2: Bake TTS onto looped slides (skip lipsync scenes)
    # ================================================================
    logger.info("\n=== Step 2: Bake TTS onto %d looped slides ===", num_slides)
    baked_dir = os.path.join(segments_dir, "baked")
    os.makedirs(baked_dir, exist_ok=True)

    for i in range(1, num_slides + 1):
        looped_path = os.path.join(looped_dir, f"looped_{i}.mp4")
        baked_path = os.path.join(baked_dir, f"baked_{i}.mp4")

        if i in lipsync_scenes:
            # Lipsync scenes already have audio baked in — just copy
            import shutil
            shutil.copy2(looped_path, baked_path)
            logger.info("  [%d/%d] Scene %d (lipsync, skip bake)", i, num_slides, i)
            continue

        tts_path = os.path.join(tts_dir, f"scene_{i}_tts.mp3")
        if not os.path.exists(tts_path):
            logger.error("  Missing TTS file: %s", tts_path)
            sys.exit(1)

        bake_tts_onto_video(looped_path, tts_path, baked_path,
                            args.tts_volume, args.sfx_volume)
        logger.info("  [%d/%d] Baked scene %d", i, num_slides, i)
        relieve_memory()

    # ================================================================
    # Step 3: Normalize all segments (mono→stereo, fades)
    # ================================================================
    logger.info("\n=== Step 3: Normalize all %d segments ===", total_segments)
    norm_dir = os.path.join(segments_dir, "normalized")
    os.makedirs(norm_dir, exist_ok=True)
    all_normalized = []
    seg_idx = 0

    # --- Title card (optional, prepended before intro) ---
    if title_card_path:
        seg_idx += 1
        norm_path = os.path.join(norm_dir, f"norm_{seg_idx:03d}_title_card.mp4")
        normalize_segment(title_card_path, norm_path)
        tc_dur = _ff.get_duration(title_card_path)
        logger.info("  [%d/%d] Title card (%.1fs)", seg_idx, total_segments, tc_dur)
        all_normalized.append(norm_path)
        relieve_memory()

    # --- Intro segments ---
    for idx, scene_num in enumerate(intro_scenes):
        seg_idx += 1
        video = find_video(videos_dir, scene_num, run_id=run_id)
        if not video:
            logger.error("  No video found for intro scene %d", scene_num)
            sys.exit(1)
        vc_tag = " (vc)" if "_vc.mp4" in video else ""
        is_last_intro = idx == len(intro_scenes) - 1
        norm_path = os.path.join(norm_dir, f"norm_{seg_idx:03d}_intro_{scene_num}.mp4")
        normalize_segment(
            video, norm_path,
            fade_out=(is_last_intro and fade > 0),
            fade_dur=fade,
        )
        ch = probe_channels(video)
        mono_tag = " mono→stereo" if ch == 1 else ""
        fade_tag = " +fade-out" if is_last_intro and fade > 0 else ""
        logger.info("  [%d/%d] Intro scene %d%s%s%s", seg_idx, total_segments, scene_num, vc_tag, mono_tag, fade_tag)
        all_normalized.append(norm_path)
        relieve_memory()

    # --- Slide segments (baked) ---
    for i in range(1, num_slides + 1):
        seg_idx += 1
        baked_path = os.path.join(baked_dir, f"baked_{i}.mp4")
        is_first_slide = i == 1
        is_last_slide = i == num_slides
        norm_path = os.path.join(norm_dir, f"norm_{seg_idx:03d}_slide_{i}.mp4")
        normalize_segment(
            baked_path, norm_path,
            fade_in=(is_first_slide and fade > 0),
            fade_out=(is_last_slide and fade > 0),
            fade_dur=fade,
        )
        fade_tag = ""
        if is_first_slide and fade > 0:
            fade_tag += " +fade-in"
        if is_last_slide and fade > 0:
            fade_tag += " +fade-out"
        logger.info("  [%d/%d] Slide %d%s", seg_idx, total_segments, i, fade_tag)
        all_normalized.append(norm_path)
        relieve_memory()

    # --- Outro segments ---
    for idx, scene_num in enumerate(outro_scenes):
        seg_idx += 1
        video = find_video(videos_dir, scene_num, run_id=run_id)
        if not video:
            logger.error("  No video found for outro scene %d", scene_num)
            sys.exit(1)
        vc_tag = " (vc)" if "_vc.mp4" in video else ""
        is_first_outro = idx == 0
        norm_path = os.path.join(norm_dir, f"norm_{seg_idx:03d}_outro_{scene_num}.mp4")
        normalize_segment(
            video, norm_path,
            fade_in=(is_first_outro and fade > 0),
            fade_dur=fade,
        )
        ch = probe_channels(video)
        mono_tag = " mono→stereo" if ch == 1 else ""
        fade_tag = " +fade-in" if is_first_outro and fade > 0 else ""
        logger.info("  [%d/%d] Outro scene %d%s%s%s", seg_idx, total_segments, scene_num, vc_tag, mono_tag, fade_tag)
        all_normalized.append(norm_path)
        relieve_memory()

    # ================================================================
    # Step 4: Concat via filter
    # ================================================================
    logger.info("\n=== Step 4: Concat %d segments via filter ===", len(all_normalized))

    if args.music:
        concat_output = os.path.join(segments_dir, "concat_no_music.mp4")
    else:
        concat_output = output

    ok = concat_via_filter(all_normalized, concat_output, crf=20)
    if not ok:
        logger.error("  Concat filter failed!")
        sys.exit(1)

    concat_dur = _ff.get_duration(concat_output)
    logger.info("  Concatenated: %.1fs (%.1f min)", concat_dur, concat_dur / 60)

    # ================================================================
    # Step 5: Add background music (optional)
    # ================================================================
    if args.music:
        logger.info("\n=== Step 5: Add background music (%.0f%% volume) ===", args.music_volume * 100)
        if not os.path.exists(args.music):
            logger.error("  Music file not found: %s", args.music)
            sys.exit(1)

        add_background_music(
            concat_output, args.music, output,
            volume=args.music_volume,
            fade_out=3.0,
        )
        logger.info("  Music added with 3s fade-out")

    # ================================================================
    # Summary
    # ================================================================
    total_dur = _ff.get_duration(output)
    tc_offset = 1 if has_title_card else 0
    tc_dur = _ff.get_duration(all_normalized[0]) if has_title_card else 0.0
    intro_dur = sum(_ff.get_duration(p) for p in all_normalized[tc_offset:tc_offset + len(intro_scenes)])
    outro_dur = sum(_ff.get_duration(p) for p in all_normalized[-len(outro_scenes):])
    slide_dur = total_dur - tc_dur - intro_dur - outro_dur
    file_size = os.path.getsize(output) / (1024 * 1024)

    logger.info("\n%s", "=" * 60)
    logger.info("DONE! %s", output)
    logger.info("%s", "=" * 60)
    logger.info("  Duration:  %.1fs (%.1f min)", total_dur, total_dur / 60)
    logger.info("  File size: %.1f MB", file_size)
    if has_title_card:
        logger.info("  Title:     1 card (%.1fs)", tc_dur)
    logger.info("  Intro:     %d clips (%.1fs)", len(intro_scenes), intro_dur)
    logger.info("  Slides:    %d slides (%.1fs)", num_slides, slide_dur)
    logger.info("  Outro:     %d clips (%.1fs)", len(outro_scenes), outro_dur)
    if lipsync_scenes:
        logger.info("  Lipsync:   scenes %s (native audio)", sorted(lipsync_scenes))
    if fade > 0:
        logger.info("  Fades:     %ss at section boundaries", fade)
    if args.music:
        logger.info("  Music:     %.0f%% volume, 3s fade-out", args.music_volume * 100)

    # ================================================================
    # Step 6: Nex Brief branding (optional)
    # ================================================================
    if args.brand_title_card:
        logger.info("\n=== Step 6: Nex Brief branding ===")
        if not os.path.exists(args.brand_title_card):
            logger.error("  Brand title card not found: %s", args.brand_title_card)
            sys.exit(1)

        # Import brand_episode from nex-presenter skill
        nex_presenter_scripts = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),  # video-replicator/scripts/
            os.pardir, os.pardir,  # .claude/skills/
            "nex-presenter", "scripts",
        )
        nex_presenter_scripts = os.path.normpath(nex_presenter_scripts)

        if not os.path.isdir(nex_presenter_scripts):
            logger.error("  Nex presenter scripts not found: %s", nex_presenter_scripts)
            sys.exit(1)

        sys.path.insert(0, nex_presenter_scripts)
        from brand_episode import (
            probe_video,
            make_title_card_video,
            reencode_logo_audio,
            reencode_episode,
            concat_segments,
            LOGO_INTRO_PATH,
        )

        if not os.path.exists(LOGO_INTRO_PATH):
            logger.error("  Logo intro not found: %s", LOGO_INTRO_PATH)
            sys.exit(1)

        branded_output = output.replace(".mp4", "_branded.mp4")
        ep_info = probe_video(output)
        logo_info = probe_video(LOGO_INTRO_PATH)

        logger.info("  Episode:  %dx%d, %sfps, %sHz, %.1fs",
                     ep_info["width"], ep_info["height"],
                     ep_info["fps"], ep_info["sample_rate"], ep_info["duration"])
        logger.info("  Logo:     %.1fs at %sHz", logo_info["duration"], logo_info["sample_rate"])
        logger.info("  Title:    %s (4s hold)", args.brand_title_card)

        work_dir = os.path.join(segments_dir, "brand_work")
        os.makedirs(work_dir, exist_ok=True)

        sr = ep_info["sample_rate"]
        fps_val = ep_info["fps"]
        w = ep_info["width"]
        h = ep_info["height"]

        tc_vid = os.path.join(work_dir, "title_card.mp4")
        make_title_card_video(args.brand_title_card, tc_vid, 4, sr, fps_val, w, h)
        logger.info("  Created 4s title card")

        logo_re = os.path.join(work_dir, "logo_intro.mp4")
        reencode_logo_audio(LOGO_INTRO_PATH, logo_re, sr, fps_val, w, h)
        logger.info("  Re-encoded logo intro")

        ep_re = os.path.join(work_dir, "episode.mp4")
        reencode_episode(output, ep_re, fps_val, w, h, sr)
        logger.info("  Prepared episode")

        concat_segments([tc_vid, logo_re, ep_re], branded_output)

        branded_dur = _ff.get_duration(branded_output)
        branded_size = os.path.getsize(branded_output) / (1024 * 1024)
        logger.info("  Branded:   %.1fs (%.1f min), %.1f MB", branded_dur, branded_dur / 60, branded_size)
        logger.info("  Output:    %s", branded_output)

        # Clean up work dir
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
