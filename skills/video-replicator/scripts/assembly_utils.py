"""Shared assembly utilities for video post-production.

Provides reusable functions for the loop → bake → normalize → concat → music
pipeline used by nex_assemble.py and project-specific assembly scripts.

All functions include gc.collect() + time.sleep() between heavy FFmpeg operations
to prevent SIGKILL (-9) on memory-constrained systems (observed with 16 GB RAM).

FADE SAFETY:
  FFmpeg ``fade=t=out`` sets ALL frames after ``st+d`` to solid black permanently.
  Chaining ``fade=t=out`` + ``fade=t=in`` mid-video therefore produces an
  all-black tail — the fade-in receives black input and fades UP from black to
  black. Bitrate drops to ~7 kbps and the video looks broken.

  Safe pattern: apply fade-in only at the VERY START (st=0) of a segment and
  fade-out only at the VERY END (st = dur - d). Never chain multiple fades on a
  single already-concatenated video. For transitions between clips, use FFmpeg
  ``xfade`` (see ``stitch_video.build_xfade_filter``).
"""
import gc
import logging
import os
import re
import time
import warnings

from ffmpeg_wrapper import FFmpegWrapper

logger = logging.getLogger(__name__)

_ff = FFmpegWrapper()

# Memory relief between heavy FFmpeg operations — prevents SIGKILL (-9).
INTER_FFMPEG_SLEEP = 3.0  # seconds


def relieve_memory(sleep: float = INTER_FFMPEG_SLEEP):
    """Force garbage collection and brief pause to let OS reclaim memory."""
    gc.collect()
    time.sleep(sleep)


# ---------------------------------------------------------------------------
# Fade filter safety helpers
# ---------------------------------------------------------------------------

def safe_fade_filter(
    duration: float,
    total_duration: float,
    position: str = "start",
) -> tuple[str, str]:
    """Build a safe video + audio fade filter for a SINGLE segment boundary.

    This function enforces that fades are only applied at the very start or
    very end of a segment, never in the middle. For transitions between
    separate clips, use ``xfade`` instead.

    Args:
        duration: Fade duration in seconds (e.g., 0.75).
        total_duration: Total duration of the video segment in seconds.
        position: ``"start"`` for fade-in at t=0, ``"end"`` for fade-out
            ending at the last frame.

    Returns:
        (video_filter, audio_filter) tuple. Each string is a single FFmpeg
        filter expression (e.g., ``"fade=t=in:st=0:d=0.75"``).

    Raises:
        ValueError: If *position* is not ``"start"`` or ``"end"``, or if
            *duration* exceeds *total_duration*.
    """
    if position not in ("start", "end"):
        raise ValueError(
            f"position must be 'start' or 'end', got {position!r}. "
            "Mid-video fades are unsafe — use xfade for between-clip transitions."
        )

    if duration <= 0:
        raise ValueError(f"Fade duration must be > 0, got {duration}")

    if total_duration is not None and duration > total_duration:
        raise ValueError(
            f"Fade duration ({duration}s) exceeds total duration ({total_duration}s)"
        )

    if position == "start":
        vf = f"fade=t=in:st=0:d={duration}"
        af = f"afade=t=in:st=0:d={duration}"
    else:
        fade_start = total_duration - duration
        vf = f"fade=t=out:st={fade_start:.3f}:d={duration}"
        af = f"afade=t=out:st={fade_start:.3f}:d={duration}"

    return vf, af


def validate_fade_filters(filter_string: str) -> list[str]:
    """Detect dangerous mid-video fade chaining in an FFmpeg filter string.

    Scans *filter_string* for patterns where a ``fade=t=out`` is followed by a
    ``fade=t=in`` on the **same** filter chain (comma- or semicolon-separated).
    This combination blackens all frames after the out-fade and makes the
    subsequent in-fade invisible.

    Safe patterns (single start + single end on one segment) are allowed.
    The function only warns about **chained** out→in sequences that indicate
    mid-video fade attempts.

    Args:
        filter_string: An FFmpeg ``-vf`` or ``-filter_complex`` value.

    Returns:
        A list of warning messages. Empty if the filter is safe.
    """
    problems: list[str] = []

    if not filter_string:
        return problems

    # Find all VIDEO fade directives with their start times.
    # Use negative lookbehind (?<!a) to exclude afade (audio fade) —
    # audio fades produce silence, not black frames, so they are safe.
    fade_pattern = re.compile(
        r"(?<!a)fade=t=(in|out):st=([\d.]+):d=([\d.]+)"
    )
    fades = fade_pattern.findall(filter_string)

    if len(fades) <= 1:
        return problems

    # Check for dangerous out→in chaining.
    # Safe: in(st=0) then out(st=end) on a single segment.
    # Dangerous: out(st=X) followed by in(st=Y) where Y > 0, meaning
    #   the in-fade starts after the out-fade has already zeroed frames.
    for i in range(len(fades) - 1):
        current_type, current_st, current_d = fades[i]
        next_type, next_st, _next_d = fades[i + 1]

        current_st = float(current_st)
        current_d = float(current_d)
        next_st = float(next_st)

        if current_type == "out" and next_type == "in":
            # This is the dangerous pattern: fade-out then fade-in.
            # After fade-out ends at current_st + current_d, all subsequent
            # frames are BLACK. A fade-in starting after that receives
            # black input — the video is permanently destroyed.
            out_end = current_st + current_d
            problems.append(
                f"DANGEROUS: fade=t=out ends at {out_end:.3f}s, then "
                f"fade=t=in starts at {next_st:.3f}s. All frames after "
                f"{out_end:.3f}s will be permanently black. Use xfade "
                f"for between-clip transitions instead of chained fades."
            )

    # Also warn about multiple fade-outs (each one extends the black region)
    fade_outs = [(float(st), float(d)) for t, st, d in fades if t == "out"]
    if len(fade_outs) > 1:
        problems.append(
            f"Multiple fade=t=out filters detected ({len(fade_outs)}). "
            f"Each subsequent fade-out operates on already-faded frames, "
            f"compounding the black region. Use at most one fade-out per segment."
        )

    if problems:
        for p in problems:
            logger.warning("Fade safety: %s", p)
            warnings.warn(p, stacklevel=2)

    return problems


def probe_channels(filepath: str) -> int:
    """Return audio channel count (1=mono, 2=stereo)."""
    try:
        out = _ff.probe(filepath, entries="stream=channels", select_streams="a:0")
        return int(out.strip())
    except Exception:
        return 2  # default to stereo


def find_video(videos_dir: str, scene_num: int, run_id: str | None = None) -> str | None:
    """Find video for a scene, preferring voice-changed (_vc) files.

    Search order (latest run prefix first):
    1. *_scene_{N}_vc.mp4
    2. *_scene_{N}.mp4

    If run_id is provided, only match files with that run prefix.
    """
    vc_match = None
    plain_match = None
    for f in sorted(os.listdir(videos_dir), reverse=True):
        if f"scene_{scene_num}" not in f or not f.endswith(".mp4"):
            continue
        if run_id and not f.startswith(run_id):
            continue
        path = os.path.join(videos_dir, f)
        if f"scene_{scene_num}_vc.mp4" in f:
            vc_match = vc_match or path
        elif f.endswith(f"scene_{scene_num}.mp4"):
            plain_match = plain_match or path
    return vc_match or plain_match


def loop_video_to_duration(video_path: str, target_duration: float, output_path: str):
    """Loop video with stream_loop to match target duration. No re-encode."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    _ff.run([
        "-stream_loop", "-1",
        "-i", video_path,
        "-t", f"{target_duration:.3f}",
        "-c", "copy",
        output_path,
    ])
    logger.debug("  Looped %s → %.1fs", os.path.basename(video_path), target_duration)


def bake_tts_onto_video(
    video_path: str,
    tts_path: str,
    output_path: str,
    tts_vol: float = 1.5,
    sfx_vol: float = 0.3,
):
    """Mix TTS narration with video SFX using amix.

    Pads TTS with silence to match video duration, then mixes at specified levels.
    dropout_transition=600 prevents early audio cutoff on silent sections.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    video_dur = _ff.get_duration(video_path)

    # Step a: Pad TTS with silence to match video duration
    padded_tts = output_path.replace(".mp4", "_padded_tts.wav")
    _ff.run([
        "-i", tts_path,
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-filter_complex",
        f"[0:a][1:a]concat=n=2:v=0:a=1[r];[r]atrim=0:{video_dur:.3f}[a]",
        "-map", "[a]",
        "-c:a", "pcm_s16le",
        padded_tts,
    ])

    # Step b: Mix padded TTS + video SFX (handle silent videos gracefully)
    try:
        has_audio = bool(_ff.probe(video_path, entries="stream=codec_type", select_streams="a:0").strip())
    except Exception:
        has_audio = False

    if has_audio:
        _ff.run([
            "-i", video_path,
            "-i", padded_tts,
            "-filter_complex",
            f"[0:a]volume={sfx_vol}[s];[1:a]volume={tts_vol}[t];"
            f"[s][t]amix=inputs=2:duration=shortest:dropout_transition=600[a]",
            "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            output_path,
        ])
    else:
        # No audio in video — just mux TTS directly
        _ff.run([
            "-i", video_path,
            "-i", padded_tts,
            "-filter_complex",
            f"[1:a]volume={tts_vol}[a]",
            "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            output_path,
        ])

    # Clean up temp file
    if os.path.exists(padded_tts):
        os.remove(padded_tts)

    logger.debug("  Baked TTS onto %s", os.path.basename(video_path))


def normalize_segment(
    video_path: str,
    output_path: str,
    fade_in: bool = False,
    fade_out: bool = False,
    fade_dur: float = 0.75,
    target_width: int = 1280,
    target_height: int = 720,
    target_fps: int = 24,
):
    """Normalize to standard resolution, fps, stereo 44100Hz. Auto-fix mono.

    Fades are applied using :func:`safe_fade_filter` which guarantees that
    fade-in is only at the very start (st=0) and fade-out only at the very
    end (st = dur - fade_dur). This prevents the chained-fade bug where
    ``fade=t=out`` followed by ``fade=t=in`` mid-video destroys all
    subsequent frames (bitrate drops to ~7 kbps).

    Includes PTS timestamp reset to prevent cumulative A/V drift during
    concat. Seedance videos often have mismatched start timestamps
    (video: 0.083s, audio: 0.036s) which compound across segments.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    channels = probe_channels(video_path)
    dur = _ff.get_duration(video_path)

    # Probe source FPS and log if Seedance 60fps detected (v2.45 observability)
    try:
        from config import SEEDANCE_OUTPUT_FPS
        source_fps = _ff.get_fps(video_path)
        if source_fps and abs(source_fps - SEEDANCE_OUTPUT_FPS) < 1:
            logger.debug(
                "  Seedance %dfps detected in %s — normalizing to %dfps",
                SEEDANCE_OUTPUT_FPS, os.path.basename(video_path), target_fps,
            )
    except Exception:
        pass  # Non-critical — get_fps may not exist in all FFmpegWrapper versions

    # Detect whether the source has an audio stream at all
    try:
        has_audio = bool(
            _ff.probe(video_path, entries="stream=codec_type", select_streams="a:0").strip()
        )
    except Exception:
        has_audio = False

    # Video filter chain — setpts resets timestamps to prevent concat drift
    vf_parts = [
        "setpts=PTS-STARTPTS",
        f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease",
        f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2",
        "format=yuv420p",
    ]
    # Audio filter chain — asetpts resets audio timestamps to match video
    pan = "pan=stereo|FL=c0|FR=c0" if channels == 1 else "anull"
    af_parts = ["asetpts=PTS-STARTPTS", pan, "aresample=44100"]

    if fade_in and fade_dur > 0:
        vf, af = safe_fade_filter(fade_dur, dur, position="start")
        vf_parts.append(vf)
        af_parts.append(af)

    if fade_out and fade_dur > 0 and dur:
        vf, af = safe_fade_filter(fade_dur, dur, position="end")
        vf_parts.append(vf)
        af_parts.append(af)

    # Validate the assembled filter chain before running FFmpeg
    full_vf = ",".join(vf_parts)
    problems = validate_fade_filters(full_vf)
    if problems:
        # Log but do not abort — the current normalize_segment only applies
        # start/end fades on individual segments, which is safe. This guard
        # catches future misuse or if someone combines both on a very short
        # clip where the regions overlap.
        logger.warning(
            "Fade safety issues detected in %s: %s",
            os.path.basename(video_path), "; ".join(problems),
        )

    if has_audio:
        _ff.run([
            "-i", video_path,
            "-vf", full_vf,
            "-af", ",".join(af_parts),
            "-r", str(target_fps),
            "-async", "1",
            "-threads", "2",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
            "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
            "-movflags", "+faststart",
            output_path,
        ])
    else:
        # No audio stream — generate silent stereo audio to ensure concat compatibility
        logger.warning(
            "  %s has no audio stream — adding silent audio track",
            os.path.basename(video_path),
        )
        af_str = ",".join(af_parts)
        _ff.run([
            "-i", video_path,
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-filter_complex",
            f"[0:v]{full_vf}[outv];[1:a]{af_str}[outa]",
            "-map", "[outv]", "-map", "[outa]",
            "-r", str(target_fps),
            "-t", str(dur),
            "-threads", "2",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
            "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "192k",
            "-movflags", "+faststart",
            output_path,
        ])

    mono_tag = " (mono→stereo)" if channels == 1 else ""
    fade_tag = ""
    if fade_in:
        fade_tag += " +fade-in"
    if fade_out:
        fade_tag += " +fade-out"
    logger.debug("  Normalized %s%s%s", os.path.basename(video_path), mono_tag, fade_tag)


def add_background_music(
    video_path: str,
    music_path: str,
    output_path: str,
    volume: float = 0.05,
    fade_out: float = 3.0,
):
    """Overlay background music at low volume with fade-out.

    dropout_transition=600 prevents early audio cutoff on silent sections.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    total_dur = _ff.get_duration(video_path)
    fade_start = max(0, total_dur - fade_out)

    _ff.run([
        "-i", video_path,
        "-stream_loop", "-1", "-i", music_path,
        "-filter_complex",
        f"[0:a]volume=1.0[v];"
        f"[1:a]volume={volume},afade=t=out:st={fade_start:.2f}:d={fade_out}[m];"
        f"[v][m]amix=inputs=2:duration=first:dropout_transition=600:normalize=0[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        "-t", f"{total_dur:.3f}",
        output_path,
    ])
    logger.debug("  Added music (%.0f%% vol, %.1fs fade-out)", volume * 100, fade_out)
