#!/usr/bin/env python3
"""
Audio Transcription Script using OpenAI Whisper CLI.

Phase 1.5T of the video-replicator pipeline: transcribe audio from videos
for dialogue reference, narration capture, or accessibility.

Usage:
    # Standalone transcription
    python transcribe_audio.py --video "projects/{slug}/reference/original.mp4" \
      --output "projects/{slug}/analysis/transcript.json"

    # With scene alignment (maps speech to SEALCAM+ scenes)
    python transcribe_audio.py --video "projects/{slug}/reference/original.mp4" \
      --analysis "projects/{slug}/analysis/sealcam_analysis.json" \
      --output "projects/{slug}/analysis/transcript.json"

    # Dry-run (check Whisper installed, detect audio, preview)
    python transcribe_audio.py --video "projects/{slug}/reference/original.mp4" --dry-run

    # Specify model and language
    python transcribe_audio.py --video "..." --model large --language en

Requirements:
    brew install openai-whisper
    (or: pip install openai-whisper)
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils_video import parse_sealcam_timestamp


def check_whisper_installed() -> bool:
    """Check if OpenAI Whisper CLI is installed and available."""
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


def print_install_instructions():
    """Print Whisper installation instructions."""
    print("\nWhisper CLI not found. Install with:")
    print("  brew install openai-whisper")
    print("  (or: pip install openai-whisper)")
    print("\nWhisper models (downloaded on first use):")
    print("  tiny    - 39M params, ~1GB RAM, fastest")
    print("  base    - 74M params, ~1GB RAM, fast")
    print("  small   - 244M params, ~2GB RAM, balanced")
    print("  medium  - 769M params, ~5GB RAM, recommended")
    print("  large   - 1550M params, ~10GB RAM, best quality")


def extract_audio_track(video_path: str, output_path: str) -> bool:
    """
    Extract audio from video as 16kHz mono WAV (Whisper's optimal format).

    Args:
        video_path: Path to the source video
        output_path: Path for the output WAV file

    Returns:
        True if extraction succeeded, False otherwise
    """
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i", video_path,
                "-vn",
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                output_path,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            print(f"  FFmpeg audio extraction failed: {result.stderr[:300]}")
            return False
        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except FileNotFoundError:
        print("  FFmpeg not found. Install with: brew install ffmpeg")
        return False
    except subprocess.TimeoutExpired:
        print("  FFmpeg timed out during audio extraction")
        return False


def run_whisper(
    audio_path: str,
    output_dir: str,
    model: str = "medium",
    language: str | None = None,
) -> dict | None:
    """
    Run Whisper CLI on an audio file and parse the JSON output.

    Args:
        audio_path: Path to the audio WAV file
        output_dir: Directory for Whisper output files
        model: Whisper model name (tiny/base/small/medium/large)
        language: Optional language code (e.g., "en", "hi", "es")

    Returns:
        Parsed Whisper JSON result, or None on failure
    """
    os.makedirs(output_dir, exist_ok=True)

    cmd = [
        "whisper",
        audio_path,
        "--model", model,
        "--output_format", "json",
        "--output_dir", output_dir,
    ]

    if language:
        cmd.extend(["--language", language])

    print(f"  Running Whisper (model: {model})...")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1800,  # 30 min timeout (includes model download on first run)
        )

        if result.returncode != 0:
            print(f"  Whisper failed: {result.stderr[:500]}")
            return None

    except FileNotFoundError:
        print("  Whisper CLI not found")
        print_install_instructions()
        return None
    except subprocess.TimeoutExpired:
        print("  Whisper timed out (>30 minutes)")
        return None

    # Find and parse the output JSON
    audio_stem = Path(audio_path).stem
    json_path = os.path.join(output_dir, f"{audio_stem}.json")

    if not os.path.exists(json_path):
        print(f"  Whisper output not found: {json_path}")
        return None

    with open(json_path) as f:
        return json.load(f)


def align_transcript_to_scenes(
    whisper_result: dict,
    analysis: dict,
) -> list[dict]:
    """
    Map Whisper transcript segments to SEALCAM+ scene timestamps.

    Uses overlap detection: a segment belongs to a scene if
    seg_start < scene_end AND seg_end > scene_start.

    Args:
        whisper_result: Parsed Whisper JSON output
        analysis: SEALCAM+ analysis JSON

    Returns:
        List of scene transcript objects with aligned segments
    """
    scenes = analysis.get("scenes", [])
    segments = whisper_result.get("segments", [])
    scene_transcripts = []

    for scene in scenes:
        scene_num = scene.get("scene_number", 0)
        timestamp_str = scene.get("timestamp", "")

        if not timestamp_str:
            scene_transcripts.append({
                "scene_number": scene_num,
                "text": "",
                "segments": [],
                "has_speech": False,
            })
            continue

        try:
            scene_start = parse_sealcam_timestamp(timestamp_str, "start")
            scene_end = parse_sealcam_timestamp(timestamp_str, "end")
        except (ValueError, AttributeError):
            scene_transcripts.append({
                "scene_number": scene_num,
                "text": "",
                "segments": [],
                "has_speech": False,
            })
            continue

        # Find overlapping segments
        matched_segments = []
        for seg in segments:
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)

            # Overlap test
            if seg_start < scene_end and seg_end > scene_start:
                matched_segments.append({
                    "start": seg_start,
                    "end": seg_end,
                    "text": seg.get("text", "").strip(),
                    "avg_logprob": seg.get("avg_logprob"),
                    "no_speech_prob": seg.get("no_speech_prob"),
                })

        scene_text = " ".join(s["text"] for s in matched_segments).strip()

        scene_transcripts.append({
            "scene_number": scene_num,
            "text": scene_text,
            "segments": matched_segments,
            "has_speech": len(matched_segments) > 0 and len(scene_text) > 0,
        })

    return scene_transcripts


def build_transcript_output(
    whisper_result: dict,
    aligned_scenes: list[dict] | None,
    video_path: str,
    model: str,
) -> dict:
    """
    Build the final transcript JSON structure.

    Args:
        whisper_result: Parsed Whisper JSON output
        aligned_scenes: Optional scene-aligned transcripts
        video_path: Path to the source video
        model: Whisper model used

    Returns:
        Complete transcript output dict
    """
    # Extract full text from segments
    segments = whisper_result.get("segments", [])
    full_text = whisper_result.get("text", "").strip()
    if not full_text:
        full_text = " ".join(s.get("text", "").strip() for s in segments).strip()

    # Get language info
    language = whisper_result.get("language", "unknown")

    # Calculate duration from last segment
    duration = 0.0
    if segments:
        duration = max(s.get("end", 0) for s in segments)

    output = {
        "transcript": {
            "full_text": full_text,
            "language": language,
            "duration": duration,
            "model": model,
            "segments": [
                {
                    "start": s.get("start", 0),
                    "end": s.get("end", 0),
                    "text": s.get("text", "").strip(),
                    "avg_logprob": s.get("avg_logprob"),
                    "no_speech_prob": s.get("no_speech_prob"),
                }
                for s in segments
            ],
        },
        "_metadata": {
            "source_video": video_path,
            "whisper_model": model,
            "generated_at": datetime.now().isoformat(),
        },
    }

    if aligned_scenes is not None:
        output["scene_transcripts"] = aligned_scenes

    return output


def dry_run(
    video_path: str,
    analysis_path: str | None,
    model: str,
) -> None:
    """
    Preview transcription without running Whisper.

    Checks: Whisper installed, audio stream exists, speech detected.
    """
    # Import audio_utils for detection
    try:
        from audio_utils import detect_speech, has_audio_stream
    except ImportError:
        has_audio_stream = None
        detect_speech = None

    print(f"\n{'='*60}")
    print("DRY RUN - Audio Transcription Preview")
    print(f"{'='*60}")
    print(f"Video: {video_path}")
    print(f"Model: {model}")
    print()

    # Check Whisper
    whisper_ok = check_whisper_installed()
    print(f"Whisper CLI: {'✓ installed' if whisper_ok else '✗ NOT installed'}")
    if not whisper_ok:
        print_install_instructions()

    # Check audio stream
    if has_audio_stream:
        try:
            has_audio = has_audio_stream(video_path)
            print(f"Audio stream: {'✓ found' if has_audio else '✗ no audio track'}")
            if not has_audio:
                print("  → Video has no audio. Transcription would produce empty result.")
                print(f"{'='*60}\n")
                return
        except Exception as e:
            print(f"Audio stream: ? (check failed: {e})")
    else:
        print("Audio stream: ? (audio_utils not available)")

    # Check for speech
    if detect_speech:
        try:
            speech = detect_speech(video_path)
            has_speech = speech.get("has_speech", False)
            confidence = speech.get("confidence", 0)
            print(f"Speech detected: {'✓ yes' if has_speech else '✗ no'} (confidence: {confidence:.2f})")
            if not has_speech:
                print("  → No speech detected. Transcription may produce minimal/empty results.")
        except Exception as e:
            print(f"Speech detection: ? (failed: {e})")
    else:
        print("Speech detection: ? (audio_utils not available)")

    # Analysis info
    if analysis_path:
        if os.path.exists(analysis_path):
            with open(analysis_path) as f:
                analysis = json.load(f)
            scene_count = len(analysis.get("scenes", []))
            print(f"\nSEALCAM+ analysis: {analysis_path}")
            print(f"Scenes for alignment: {scene_count}")
        else:
            print(f"\nSEALCAM+ analysis: NOT FOUND ({analysis_path})")

    print(f"\n{'='*60}")
    if whisper_ok:
        print("Ready to transcribe. Remove --dry-run to proceed.")
    else:
        print("Install Whisper first, then remove --dry-run.")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe video audio using OpenAI Whisper CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Standalone transcription
  python transcribe_audio.py --video ref.mp4 --output transcript.json

  # With scene alignment
  python transcribe_audio.py --video ref.mp4 --analysis sealcam.json --output transcript.json

  # Specify model
  python transcribe_audio.py --video ref.mp4 --model large --output transcript.json

  # Dry-run
  python transcribe_audio.py --video ref.mp4 --dry-run
        """,
    )

    parser.add_argument("--video", required=True, help="Path to video file")
    parser.add_argument("--analysis", help="Path to SEALCAM+ analysis JSON (for scene alignment)")
    parser.add_argument("--output", help="Output transcript JSON path (auto-generated if omitted)")
    parser.add_argument(
        "--model",
        default="medium",
        choices=["tiny", "base", "small", "medium", "large"],
        help="Whisper model size (default: medium)",
    )
    parser.add_argument("--language", help="Force language code (e.g., en, hi, es). Auto-detects if omitted.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without running Whisper")

    args = parser.parse_args()

    # Validate video exists
    if not os.path.exists(args.video):
        print(f"Error: Video not found: {args.video}")
        sys.exit(1)

    # Dry run
    if args.dry_run:
        dry_run(args.video, args.analysis, args.model)
        return

    # Check Whisper
    if not check_whisper_installed():
        print("Error: Whisper CLI not installed.")
        print_install_instructions()
        sys.exit(1)

    # Determine output path
    output_path = args.output
    if not output_path:
        video_dir = os.path.dirname(args.video)
        # Try to save alongside analysis or in same dir as video
        output_path = os.path.join(video_dir, "transcript.json")

    # Extract audio to temp WAV
    print(f"Extracting audio from: {args.video}")
    with tempfile.TemporaryDirectory() as temp_dir:
        wav_path = os.path.join(temp_dir, "audio.wav")

        if not extract_audio_track(args.video, wav_path):
            print("Error: Failed to extract audio track. Video may have no audio.")
            sys.exit(1)

        wav_size = os.path.getsize(wav_path)
        print(f"  Audio extracted: {wav_size / 1024:.0f} KB (16kHz mono WAV)")

        # Run Whisper
        whisper_output_dir = os.path.join(temp_dir, "whisper_output")
        whisper_result = run_whisper(wav_path, whisper_output_dir, args.model, args.language)

    if whisper_result is None:
        print("Error: Whisper transcription failed.")
        sys.exit(1)

    # Align to scenes if analysis provided
    aligned_scenes = None
    if args.analysis:
        if os.path.exists(args.analysis):
            print(f"Aligning transcript to scenes: {args.analysis}")
            with open(args.analysis) as f:
                analysis = json.load(f)
            aligned_scenes = align_transcript_to_scenes(whisper_result, analysis)
            speech_scenes = sum(1 for s in aligned_scenes if s["has_speech"])
            print(f"  {speech_scenes}/{len(aligned_scenes)} scenes have speech")
        else:
            print(f"Warning: Analysis file not found: {args.analysis}")

    # Build output
    result = build_transcript_output(whisper_result, aligned_scenes, args.video, args.model)

    # Save
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    # Summary
    transcript = result["transcript"]
    print(f"\nTranscript saved to: {output_path}")
    print(f"Language: {transcript['language']}")
    print(f"Duration: {transcript['duration']:.1f}s")
    print(f"Segments: {len(transcript['segments'])}")

    full_text = transcript["full_text"]
    if full_text:
        preview = full_text[:200] + ("..." if len(full_text) > 200 else "")
        print(f"\nPreview:\n  {preview}")
    else:
        print("\nNo speech detected in video.")

    if aligned_scenes:
        print("\n--- Scene Transcripts ---")
        for scene in aligned_scenes:
            status = "✓" if scene["has_speech"] else "–"
            text_preview = scene["text"][:80] + ("..." if len(scene["text"]) > 80 else "")
            print(f"  Scene {scene['scene_number']}: {status} {text_preview}")


if __name__ == "__main__":
    main()
