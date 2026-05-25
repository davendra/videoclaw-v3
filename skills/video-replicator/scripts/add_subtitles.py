#!/usr/bin/env python3
"""
Add animated subtitle overlays to videos using Whisper + ASS + FFmpeg.

Transcribes video audio with Whisper (or loads a pre-existing transcript),
generates an ASS (Advanced SubStation Alpha) subtitle file with the selected
style preset, and burns the subtitles into the video with FFmpeg.

Usage:
    # Basic usage (auto-transcribe + burn subtitles)
    python add_subtitles.py --video "projects/{slug}/videos/scene_1.mp4"

    # With a specific style
    python add_subtitles.py --video "video.mp4" --style ugc-tiktok

    # Pre-existing transcript (skip Whisper)
    python add_subtitles.py --video "video.mp4" --transcript "transcript.json"

    # Dry-run preview
    python add_subtitles.py --video "video.mp4" --dry-run

    # Custom output path
    python add_subtitles.py --video "video.mp4" --output "video_with_subs.mp4"

Requirements:
    brew install openai-whisper   (or: pip install openai-whisper)
    brew install ffmpeg
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import UGC_SUBTITLE_FONT_SIZE, UGC_SUBTITLE_WORDS_PER_LINE
from exceptions import SubtitleError
from ffmpeg_wrapper import FFmpegWrapper, run_ffmpeg
from logging_config import setup_logging

# ============================================================================
# Style Presets
# ============================================================================

# ASS style format fields:
# Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,
# Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,
# BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding

STYLE_PRESETS = {
    "ugc-bold": {
        "name": "UGCBold",
        "definition": (
            "Style: UGCBold,Arial Black,{font_size},"
            "&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
            "-1,0,0,0,100,100,0,0,"
            "1,3,0,2,10,10,50,1"
        ),
        "description": "Large white text with thick black outline, bottom third",
    },
    "ugc-minimal": {
        "name": "UGCMinimal",
        "definition": (
            "Style: UGCMinimal,Arial,{font_size},"
            "&H00FFFFFF,&H000000FF,&H00000000,&H40000000,"
            "0,0,0,0,100,100,0,0,"
            "1,1.5,0,2,10,10,30,1"
        ),
        "description": "Smaller white text with subtle shadow, bottom-centered",
    },
    "ugc-tiktok": {
        "name": "UGCTikTok",
        "definition": (
            "Style: UGCTikTok,Arial Black,{font_size},"
            "&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
            "-1,0,0,0,100,100,0,0,"
            "1,3,0,5,10,10,10,1"
        ),
        "highlight_definition": (
            "Style: UGCTikTokHL,Arial Black,{font_size},"
            "&H0000FFFF,&H000000FF,&H00000000,&H80000000,"
            "-1,0,0,0,100,100,0,0,"
            "1,3,0,5,10,10,10,1"
        ),
        "description": "Word-by-word highlight (yellow current word), center screen",
    },
    "ugc-caption": {
        "name": "UGCCaption",
        "definition": (
            "Style: UGCCaption,Arial,{font_size},"
            "&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,"
            "0,0,0,0,100,100,0,0,"
            "3,0,0,2,10,10,40,1"
        ),
        "description": "Standard broadcast captions, white on semi-transparent black box",
    },
}


# ============================================================================
# Whisper Integration
# ============================================================================


def check_whisper_installed() -> bool:
    """Check if OpenAI Whisper CLI is available."""
    try:
        result = subprocess.run(
            ["whisper", "--help"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def transcribe_video(
    video_path: str,
    model: str = "base",
    logger=None,
) -> dict:
    """
    Transcribe video audio using Whisper CLI.

    Extracts audio to a temp WAV, runs Whisper, and returns the parsed JSON
    result including word-level timestamps.

    Args:
        video_path: Path to the input video.
        model: Whisper model size (tiny/base/small/medium/large).
        logger: Optional logger instance.

    Returns:
        Parsed Whisper JSON dict with segments and word timestamps.

    Raises:
        SubtitleError: If transcription fails.
    """
    log = logger or setup_logging(__name__)

    if not check_whisper_installed():
        raise SubtitleError(
            "Whisper CLI not found. Install with: brew install openai-whisper"
        )

    ff = FFmpegWrapper()

    with tempfile.TemporaryDirectory() as temp_dir:
        # Extract audio as 16kHz mono WAV
        wav_path = os.path.join(temp_dir, "audio.wav")
        log.info("Extracting audio from video...")

        ff.run(
            ["-i", video_path, "-vn", "-acodec", "pcm_s16le",
             "-ar", "16000", "-ac", "1", wav_path],
            timeout=120,
        )

        if not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
            raise SubtitleError("Failed to extract audio from video")

        # Run Whisper with word timestamps
        whisper_dir = os.path.join(temp_dir, "whisper_out")
        os.makedirs(whisper_dir, exist_ok=True)

        cmd = [
            "whisper", wav_path,
            "--model", model,
            "--output_format", "json",
            "--output_dir", whisper_dir,
            "--word_timestamps", "True",
        ]

        log.info("Running Whisper (model: %s)...", model)

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1800,
            )
        except FileNotFoundError as err:
            raise SubtitleError(
                "Whisper CLI not found. Install with: brew install openai-whisper"
            ) from err
        except subprocess.TimeoutExpired as err:
            raise SubtitleError("Whisper timed out (>30 minutes)") from err

        if result.returncode != 0:
            stderr_snippet = (result.stderr or "").strip()[:500]
            raise SubtitleError(f"Whisper failed: {stderr_snippet}")

        # Parse output JSON
        json_path = os.path.join(whisper_dir, "audio.json")
        if not os.path.exists(json_path):
            raise SubtitleError(f"Whisper output not found: {json_path}")

        with open(json_path) as f:
            return json.load(f)


def load_transcript(transcript_path: str) -> dict:
    """
    Load a pre-existing transcript JSON file.

    Supports two formats:
    1. Whisper-style: {"segments": [...], "text": "..."}
    2. Video-replicator style: {"transcript": {"segments": [...]}}

    Args:
        transcript_path: Path to the transcript JSON.

    Returns:
        Normalized dict with "segments" key.

    Raises:
        SubtitleError: If the file cannot be read or parsed.
    """
    if not os.path.exists(transcript_path):
        raise SubtitleError(f"Transcript not found: {transcript_path}")

    try:
        with open(transcript_path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as err:
        raise SubtitleError(f"Failed to read transcript: {err}") from err

    # Normalize to Whisper format
    if "transcript" in data and "segments" in data["transcript"]:
        return data["transcript"]

    if "segments" in data:
        return data

    raise SubtitleError(
        "Transcript must contain 'segments' key with timestamped entries"
    )


# ============================================================================
# ASS Generation
# ============================================================================


def _format_ass_time(seconds: float) -> str:
    """Convert seconds to ASS timestamp format H:MM:SS.cc."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _chunk_text(text: str, words_per_line: int) -> list[str]:
    """Split text into chunks of N words."""
    words = text.split()
    chunks = []
    for i in range(0, len(words), words_per_line):
        chunk = " ".join(words[i:i + words_per_line])
        if chunk:
            chunks.append(chunk)
    return chunks


def generate_ass_standard(
    segments: list[dict],
    style_key: str,
    font_size: int,
    words_per_line: int,
) -> str:
    """
    Generate ASS subtitle content for standard styles (ugc-bold, ugc-minimal, ugc-caption).

    Groups words into lines of `words_per_line` and creates dialogue events.

    Args:
        segments: Whisper segments with start/end/text.
        style_key: Style preset key.
        font_size: Font size override.
        words_per_line: Words per subtitle line.

    Returns:
        Complete ASS file content as string.
    """
    preset = STYLE_PRESETS[style_key]
    style_name = preset["name"]
    style_def = preset["definition"].format(font_size=font_size)

    # Build dialogue events from segments, chunking text
    events = []
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue

        start = seg.get("start", 0)
        end = seg.get("end", 0)
        duration = end - start

        chunks = _chunk_text(text, words_per_line)
        if not chunks:
            continue

        # Distribute time evenly across chunks
        chunk_duration = duration / len(chunks) if chunks else duration

        for i, chunk in enumerate(chunks):
            chunk_start = start + i * chunk_duration
            chunk_end = start + (i + 1) * chunk_duration

            # Escape ASS special characters
            safe_text = chunk.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")

            events.append(
                f"Dialogue: 0,{_format_ass_time(chunk_start)},"
                f"{_format_ass_time(chunk_end)},{style_name},,0,0,0,,{safe_text}"
            )

    return _build_ass_file(style_def, events)


def generate_ass_tiktok(
    segments: list[dict],
    font_size: int,
    words_per_line: int,
) -> str:
    """
    Generate ASS subtitle content for ugc-tiktok style.

    Creates word-by-word highlight effect: current word in yellow, rest in white.
    Uses ASS inline color overrides for per-word highlighting.

    Args:
        segments: Whisper segments with word-level timestamps.
        font_size: Font size override.
        words_per_line: Words per subtitle group.

    Returns:
        Complete ASS file content as string.
    """
    preset = STYLE_PRESETS["ugc-tiktok"]
    style_def = preset["definition"].format(font_size=font_size)

    # Collect all words with timestamps
    all_words = []
    for seg in segments:
        words = seg.get("words", [])
        if words:
            for w in words:
                word_text = w.get("word", "").strip()
                if word_text:
                    all_words.append({
                        "word": word_text,
                        "start": w.get("start", 0),
                        "end": w.get("end", 0),
                    })
        else:
            # Fallback: split segment text evenly if no word timestamps
            text = seg.get("text", "").strip()
            if not text:
                continue
            seg_words = text.split()
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            seg_dur = seg_end - seg_start
            word_dur = seg_dur / len(seg_words) if seg_words else seg_dur
            for i, w in enumerate(seg_words):
                all_words.append({
                    "word": w,
                    "start": seg_start + i * word_dur,
                    "end": seg_start + (i + 1) * word_dur,
                })

    if not all_words:
        return _build_ass_file(style_def, [])

    # Group words into lines
    events = []
    for group_start_idx in range(0, len(all_words), words_per_line):
        group = all_words[group_start_idx:group_start_idx + words_per_line]
        group_text_words = [w["word"] for w in group]

        # For each word in the group, create an event where that word is highlighted
        for highlight_idx, highlighted_word in enumerate(group):
            w_start = highlighted_word["start"]
            w_end = highlighted_word["end"]

            # Build the line with inline ASS color overrides
            # Yellow = {\c&H0000FFFF&}, White = {\c&H00FFFFFF&}
            parts = []
            for j, word_text in enumerate(group_text_words):
                safe_word = word_text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
                if j == highlight_idx:
                    parts.append(r"{\c&H0000FFFF&}" + safe_word + r"{\c&H00FFFFFF&}")
                else:
                    parts.append(safe_word)

            line = " ".join(parts)
            events.append(
                f"Dialogue: 0,{_format_ass_time(w_start)},"
                f"{_format_ass_time(w_end)},UGCTikTok,,0,0,0,,{line}"
            )

    return _build_ass_file(style_def, events)


def _build_ass_file(style_definition: str, events: list[str]) -> str:
    """
    Assemble a complete ASS file from a style definition and dialogue events.

    Args:
        style_definition: The ASS style line.
        events: List of ASS Dialogue lines.

    Returns:
        Complete ASS file content.
    """
    header = (
        "[Script Info]\n"
        "Title: UGC Subtitles\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1280\n"
        "PlayResY: 720\n"
        "WrapStyle: 0\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,"
        "OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,"
        "ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,"
        "Alignment,MarginL,MarginR,MarginV,Encoding\n"
        f"{style_definition}\n"
        "\n"
        "[Events]\n"
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
    )

    return header + "\n".join(events) + "\n"


def generate_ass(
    transcript: dict,
    style: str,
    font_size: int,
    words_per_line: int,
) -> str:
    """
    Generate ASS subtitle content from a transcript.

    Dispatches to the appropriate generator based on style preset.

    Args:
        transcript: Whisper transcript dict with segments.
        style: Style preset key.
        font_size: Font size.
        words_per_line: Words per subtitle line.

    Returns:
        Complete ASS file content string.

    Raises:
        SubtitleError: If the style is unknown.
    """
    if style not in STYLE_PRESETS:
        raise SubtitleError(
            f"Unknown style '{style}'. Available: {', '.join(STYLE_PRESETS)}"
        )

    segments = transcript.get("segments", [])
    if not segments:
        raise SubtitleError("Transcript has no segments")

    if style == "ugc-tiktok":
        return generate_ass_tiktok(segments, font_size, words_per_line)
    else:
        return generate_ass_standard(segments, style, font_size, words_per_line)


# ============================================================================
# Burn-in
# ============================================================================


def burn_subtitles(
    video_path: str,
    ass_path: str,
    output_path: str,
    logger=None,
) -> str:
    """
    Burn ASS subtitles into video using FFmpeg.

    Args:
        video_path: Input video path.
        ass_path: Path to the ASS subtitle file.
        output_path: Output video path.
        logger: Optional logger instance.

    Returns:
        Path to the output video.

    Raises:
        SubtitleError: If FFmpeg burn-in fails.
    """
    log = logger or setup_logging(__name__)
    log.info("Burning subtitles into video...")

    # Escape the ASS path for FFmpeg filter (colons and backslashes)
    escaped_ass = ass_path.replace("\\", "\\\\").replace(":", "\\:")
    # Also escape single quotes that could break the filter
    escaped_ass = escaped_ass.replace("'", "'\\''")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    try:
        run_ffmpeg([
            "-i", video_path,
            "-vf", f"ass={escaped_ass}",
            "-c:a", "copy",
            output_path,
        ])
    except Exception as err:
        raise SubtitleError(f"FFmpeg subtitle burn-in failed: {err}") from err

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise SubtitleError(f"Output video not created: {output_path}")

    log.info("Subtitled video saved: %s", output_path)
    return output_path


# ============================================================================
# Dry Run
# ============================================================================


def dry_run(args, logger) -> None:
    """Show what would be done without executing."""
    logger.info("=" * 60)
    logger.info("DRY RUN - Subtitle Generation Preview")
    logger.info("=" * 60)
    logger.info("Video:          %s", args.video)
    logger.info("Style:          %s (%s)", args.style, STYLE_PRESETS[args.style]["description"])
    logger.info("Font size:      %d", args.font_size)
    logger.info("Words/line:     %d", args.words_per_line)
    logger.info("Whisper model:  %s", args.whisper_model)

    if args.transcript:
        logger.info("Transcript:     %s (pre-existing)", args.transcript)
        if os.path.exists(args.transcript):
            logger.info("  File exists: yes")
        else:
            logger.warning("  File NOT FOUND: %s", args.transcript)
    else:
        logger.info("Transcript:     (will auto-transcribe with Whisper)")
        whisper_ok = check_whisper_installed()
        logger.info("  Whisper CLI:  %s", "installed" if whisper_ok else "NOT installed")
        if not whisper_ok:
            logger.warning("  Install with: brew install openai-whisper")

    output = args.output
    if not output:
        stem = Path(args.video).stem
        ext = Path(args.video).suffix
        output = str(Path(args.video).parent / f"{stem}_subtitled{ext}")
    logger.info("Output:         %s", output)

    logger.info("=" * 60)
    logger.info("Remove --dry-run to proceed.")


# ============================================================================
# Main
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Add animated subtitle overlays to videos",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Auto-transcribe and burn bold subtitles
  python add_subtitles.py --video scene.mp4

  # TikTok-style word highlights
  python add_subtitles.py --video scene.mp4 --style ugc-tiktok

  # Use pre-existing transcript
  python add_subtitles.py --video scene.mp4 --transcript transcript.json

  # Custom font size and output
  python add_subtitles.py --video scene.mp4 --font-size 56 --output final.mp4

  # Dry-run preview
  python add_subtitles.py --video scene.mp4 --dry-run

Style presets:
  ugc-bold     Large white text, thick black outline (default)
  ugc-minimal  Smaller white text, subtle shadow
  ugc-tiktok   Word-by-word yellow highlight, center screen
  ugc-caption  Broadcast-style, white on dark background box
        """,
    )

    parser.add_argument("--video", required=True, help="Input video path")
    parser.add_argument("--output", help="Output video path (default: adds _subtitled suffix)")
    parser.add_argument(
        "--style",
        default="ugc-bold",
        choices=list(STYLE_PRESETS.keys()),
        help="Subtitle style preset (default: ugc-bold)",
    )
    parser.add_argument(
        "--font-size",
        type=int,
        default=UGC_SUBTITLE_FONT_SIZE,
        help=f"Font size (default: {UGC_SUBTITLE_FONT_SIZE})",
    )
    parser.add_argument(
        "--words-per-line",
        type=int,
        default=UGC_SUBTITLE_WORDS_PER_LINE,
        help=f"Words per subtitle line (default: {UGC_SUBTITLE_WORDS_PER_LINE})",
    )
    parser.add_argument("--transcript", help="Pre-existing transcript JSON (skip Whisper)")
    parser.add_argument(
        "--whisper-model",
        default="base",
        choices=["tiny", "base", "small", "medium", "large"],
        help="Whisper model size (default: base)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompts")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    logger = setup_logging(__name__, verbose=args.verbose)

    # Validate input video
    if not os.path.exists(args.video):
        logger.error("Video not found: %s", args.video)
        sys.exit(1)

    # Validate style
    if args.style not in STYLE_PRESETS:
        logger.error("Unknown style: %s", args.style)
        sys.exit(1)

    # Dry run
    if args.dry_run:
        dry_run(args, logger)
        return

    # Determine output path
    output_path = args.output
    if not output_path:
        stem = Path(args.video).stem
        ext = Path(args.video).suffix
        output_path = str(Path(args.video).parent / f"{stem}_subtitled{ext}")

    # Confirmation
    if not args.yes:
        logger.info("Will add '%s' subtitles to: %s", args.style, args.video)
        logger.info("Output: %s", output_path)
        confirm = input("Proceed? [y/N] ").strip().lower()
        if confirm not in ("y", "yes"):
            logger.info("Aborted.")
            return

    # Step 1: Get transcript
    if args.transcript:
        logger.info("Loading transcript: %s", args.transcript)
        transcript = load_transcript(args.transcript)
        seg_count = len(transcript.get("segments", []))
        logger.info("Loaded %d segments from transcript", seg_count)
    else:
        logger.info("Transcribing video with Whisper (model: %s)...", args.whisper_model)
        transcript = transcribe_video(args.video, model=args.whisper_model, logger=logger)
        seg_count = len(transcript.get("segments", []))
        logger.info("Transcribed %d segments", seg_count)

    # Step 2: Generate ASS subtitle file
    logger.info("Generating ASS subtitles (style: %s)...", args.style)
    ass_content = generate_ass(
        transcript,
        style=args.style,
        font_size=args.font_size,
        words_per_line=args.words_per_line,
    )

    # Write ASS to a temp file next to the video (easier FFmpeg path handling)
    video_dir = os.path.dirname(os.path.abspath(args.video))
    ass_path = os.path.join(video_dir, f"_subtitles_{os.getpid()}.ass")

    try:
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_content)
        logger.debug("ASS file written: %s", ass_path)

        # Step 3: Burn subtitles into video
        burn_subtitles(args.video, ass_path, output_path, logger=logger)

    finally:
        # Step 4: Cleanup temp ASS file
        if os.path.exists(ass_path):
            os.remove(ass_path)
            logger.debug("Cleaned up ASS file: %s", ass_path)

    # Summary
    ff = FFmpegWrapper()
    duration = ff.get_duration(output_path)
    output_size = os.path.getsize(output_path)

    logger.info("")
    logger.info("Subtitled video: %s", output_path)
    logger.info("Style: %s", args.style)
    if duration:
        logger.info("Duration: %.1fs", duration)
    logger.info("Size: %.1f MB", output_size / (1024 * 1024))


if __name__ == "__main__":
    main()
