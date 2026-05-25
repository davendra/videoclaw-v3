#!/usr/bin/env python3
"""
Audio Utilities for Video Stitching Pipeline

Provides audio stream detection, metadata extraction, and speech detection
for the video stitching workflow.

Functions:
    has_audio_stream(video_path) - Check if video has audio track
    get_audio_info(video_path) - Get audio metadata (codec, duration, channels)
    detect_speech(video_path) - Detect speech using FFmpeg voice-frequency analysis
    validate_video_audio(video_path) - Combined validation for pre-stitch checks
    strip_audio(video_path) - Remove audio from video file

Usage:
    from audio_utils import has_audio_stream, detect_speech, validate_video_audio

    # Check for audio stream
    if has_audio_stream("video.mp4"):
        print("Video has audio")

    # Detect speech
    result = detect_speech("video.mp4")
    if result["has_speech"]:
        print(f"Speech detected with {result['confidence']:.0%} confidence")

    # Pre-stitch validation
    validation = validate_video_audio("video.mp4")
    if validation["has_speech"]:
        print("Warning: Video contains speech")
"""

import json
import os
import re
import subprocess

from exceptions import MissingDependencyError, VideoProcessingError
from ffmpeg_wrapper import FFmpegWrapper

_ff = FFmpegWrapper()


def has_audio_stream(video_path: str) -> bool:
    """
    Check if video has an audio track.

    Args:
        video_path: Path to the video file

    Returns:
        True if video has audio stream, False otherwise

    Raises:
        VideoProcessingError: If video file doesn't exist or ffprobe fails
    """
    if not os.path.exists(video_path):
        raise VideoProcessingError(f"Video file not found: {video_path}")

    try:
        output = _ff.probe(
            video_path,
            entries="stream=codec_type",
            select_streams="a:0",
        )
    except MissingDependencyError:
        raise
    except VideoProcessingError:
        raise

    # Returns "audio" if stream exists, empty otherwise
    return output.strip() == "audio"


def get_audio_info(video_path: str) -> dict | None:
    """
    Get audio stream metadata from video.

    Args:
        video_path: Path to the video file

    Returns:
        Dict with audio info:
        {
            "has_audio": bool,
            "codec": str,          # e.g., "aac", "mp3"
            "channels": int,       # e.g., 1 (mono), 2 (stereo)
            "sample_rate": int,    # e.g., 44100, 48000
            "duration": float,     # seconds
            "bitrate": int,        # bits per second
        }
        Returns None if ffprobe fails.

    Raises:
        FileNotFoundError: If video file doesn't exist
    """
    if not os.path.exists(video_path):
        raise VideoProcessingError(f"Video file not found: {video_path}")

    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,channels,sample_rate,duration,bit_rate",
        "-of", "json",
        video_path
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return None
    except FileNotFoundError:
        return None

    if result.returncode != 0:
        return {"has_audio": False}

    try:
        data = json.loads(result.stdout)
        streams = data.get("streams", [])

        if not streams:
            return {"has_audio": False}

        stream = streams[0]
        return {
            "has_audio": True,
            "codec": stream.get("codec_name", "unknown"),
            "channels": int(stream.get("channels", 0)),
            "sample_rate": int(stream.get("sample_rate", 0)),
            "duration": float(stream.get("duration", 0)),
            "bitrate": int(stream.get("bit_rate", 0)) if stream.get("bit_rate") else 0,
        }
    except (json.JSONDecodeError, KeyError, ValueError):
        return {"has_audio": False}


def detect_speech(video_path: str, threshold: float = -30.0) -> dict:
    """
    Detect speech in video using FFmpeg voice-frequency energy analysis.

    Uses a bandpass filter to isolate human voice frequencies (85-255Hz for
    fundamental frequency) and measures energy levels. Higher energy in this
    band suggests speech presence.

    Args:
        video_path: Path to the video file
        threshold: Volume threshold in dB. Values above this indicate speech.
                   Default -30 dB is conservative (catches most speech).
                   Use -25 for more strict detection (less false positives).

    Returns:
        {
            "has_speech": bool,
            "confidence": float,     # 0.0 to 1.0
            "voice_energy": float,   # dB level in voice frequency band
            "mean_volume": float,    # Overall audio mean volume (dB)
            "max_volume": float,     # Peak volume (dB)
            "method": str,           # "energy" - detection method used
        }

    Raises:
        FileNotFoundError: If video file doesn't exist
    """
    if not os.path.exists(video_path):
        raise VideoProcessingError(f"Video file not found: {video_path}")

    # First check if video has audio at all
    if not has_audio_stream(video_path):
        return {
            "has_speech": False,
            "confidence": 0.0,
            "voice_energy": -100.0,
            "mean_volume": -100.0,
            "max_volume": -100.0,
            "method": "no_audio",
        }

    # Analyze voice frequency band (85-255Hz - human voice fundamental)
    # This bandpass isolates speech frequencies
    voice_cmd = [
        "ffmpeg",
        "-i", video_path,
        "-af", "highpass=f=85,lowpass=f=255,volumedetect",
        "-f", "null",
        "-"
    ]

    # Also get overall audio levels for comparison
    full_cmd = [
        "ffmpeg",
        "-i", video_path,
        "-af", "volumedetect",
        "-f", "null",
        "-"
    ]

    try:
        # Get voice band energy
        voice_result = subprocess.run(
            voice_cmd,
            capture_output=True,
            text=True,
            timeout=60
        )
        voice_output = voice_result.stderr

        # Get overall audio energy
        full_result = subprocess.run(
            full_cmd,
            capture_output=True,
            text=True,
            timeout=60
        )
        full_output = full_result.stderr

    except subprocess.TimeoutExpired:
        return {
            "has_speech": False,
            "confidence": 0.0,
            "voice_energy": -100.0,
            "mean_volume": -100.0,
            "max_volume": -100.0,
            "method": "timeout",
        }
    except FileNotFoundError:
        return {
            "has_speech": False,
            "confidence": 0.0,
            "voice_energy": -100.0,
            "mean_volume": -100.0,
            "max_volume": -100.0,
            "method": "ffmpeg_not_found",
        }

    # Parse volumedetect output for voice band
    voice_mean = _parse_volume(voice_output, "mean_volume")
    _voice_max = _parse_volume(voice_output, "max_volume")

    # Parse overall audio levels
    full_mean = _parse_volume(full_output, "mean_volume")
    full_max = _parse_volume(full_output, "max_volume")

    # Use voice band mean as primary indicator
    voice_energy = voice_mean if voice_mean is not None else -100.0

    # Calculate confidence based on voice energy level
    # Scale: -60dB = 0%, -20dB = 100%
    if voice_energy <= -60:
        confidence = 0.0
    elif voice_energy >= -20:
        confidence = 1.0
    else:
        # Linear scale between -60 and -20
        confidence = (voice_energy + 60) / 40.0

    # Determine if speech is present based on threshold
    has_speech = voice_energy > threshold

    return {
        "has_speech": has_speech,
        "confidence": confidence,
        "voice_energy": voice_energy,
        "mean_volume": full_mean if full_mean is not None else -100.0,
        "max_volume": full_max if full_max is not None else -100.0,
        "method": "energy",
    }


def _parse_volume(output: str, key: str) -> float | None:
    """Parse volume value from FFmpeg volumedetect output."""
    # Look for: mean_volume: -25.3 dB or max_volume: -12.1 dB
    pattern = rf"{key}:\s*([-\d.]+)\s*dB"
    match = re.search(pattern, output)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def validate_video_audio(video_path: str, check_speech: bool = True) -> dict:
    """
    Combined audio validation for pre-stitch checks.

    Args:
        video_path: Path to the video file
        check_speech: Whether to run speech detection

    Returns:
        {
            "path": str,
            "has_audio": bool,
            "audio_info": dict,       # From get_audio_info()
            "speech_detection": dict, # From detect_speech() if check_speech=True
            "has_speech": bool,       # Convenience field
            "recommendation": str,    # "preserve", "mute", or "silent"
        }

    Raises:
        FileNotFoundError: If video file doesn't exist
    """
    if not os.path.exists(video_path):
        raise VideoProcessingError(f"Video file not found: {video_path}")

    result = {
        "path": video_path,
        "has_audio": False,
        "audio_info": None,
        "speech_detection": None,
        "has_speech": False,
        "recommendation": "silent",
    }

    # Get audio info
    audio_info = get_audio_info(video_path)
    result["audio_info"] = audio_info
    result["has_audio"] = audio_info.get("has_audio", False) if audio_info else False

    if not result["has_audio"]:
        result["recommendation"] = "silent"
        return result

    # Run speech detection if requested
    if check_speech:
        speech = detect_speech(video_path)
        result["speech_detection"] = speech
        result["has_speech"] = speech.get("has_speech", False)

        if result["has_speech"]:
            result["recommendation"] = "mute"
        else:
            result["recommendation"] = "preserve"
    else:
        result["recommendation"] = "preserve"

    return result


def strip_audio(video_path: str, output_path: str | None = None) -> str:
    """
    Remove audio from video file.

    Args:
        video_path: Path to the source video
        output_path: Path for output (default: adds _muted suffix)

    Returns:
        Path to the muted video file

    Raises:
        FileNotFoundError: If video file doesn't exist
        RuntimeError: If FFmpeg fails
    """
    if not os.path.exists(video_path):
        raise VideoProcessingError(f"Video file not found: {video_path}")

    if output_path is None:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_muted{ext}"

    try:
        _ff.run(
            ["-i", video_path, "-an", "-c:v", "copy", output_path],
            timeout=120,
        )
    except MissingDependencyError:
        raise
    except VideoProcessingError:
        raise

    return output_path


def analyze_videos_for_speech(video_paths: list, verbose: bool = True) -> dict:
    """
    Analyze multiple videos for speech detection.

    Args:
        video_paths: List of video file paths
        verbose: Print progress messages

    Returns:
        {
            "videos": [
                {
                    "path": str,
                    "has_speech": bool,
                    "voice_energy": float,
                    "recommendation": str,
                }
            ],
            "speech_count": int,
            "clean_count": int,
            "no_audio_count": int,
        }
    """
    result = {
        "videos": [],
        "speech_count": 0,
        "clean_count": 0,
        "no_audio_count": 0,
    }

    for i, video_path in enumerate(video_paths):
        if verbose:
            print(f"  Analyzing audio ({i+1}/{len(video_paths)}): {os.path.basename(video_path)}")

        try:
            validation = validate_video_audio(video_path, check_speech=True)

            video_info = {
                "path": video_path,
                "has_audio": validation["has_audio"],
                "has_speech": validation["has_speech"],
                "voice_energy": validation["speech_detection"]["voice_energy"] if validation["speech_detection"] else -100.0,
                "recommendation": validation["recommendation"],
            }

            result["videos"].append(video_info)

            if not validation["has_audio"]:
                result["no_audio_count"] += 1
            elif validation["has_speech"]:
                result["speech_count"] += 1
                if verbose:
                    print(f"    Warning: Speech detected (energy: {video_info['voice_energy']:.1f} dB)")
            else:
                result["clean_count"] += 1
                if verbose:
                    print(f"    Clean audio (energy: {video_info['voice_energy']:.1f} dB)")

        except Exception as e:
            if verbose:
                print(f"    Error: {e}")
            result["videos"].append({
                "path": video_path,
                "has_audio": False,
                "has_speech": False,
                "voice_energy": -100.0,
                "recommendation": "error",
                "error": str(e),
            })

    return result


def normalize_audio(
    input_path: str,
    output_path: str | None = None,
    target_lufs: float = -16.0,
    verbose: bool = True,
) -> str | None:
    """
    Normalize audio to target loudness using FFmpeg loudnorm filter (EBU R128).

    Args:
        input_path: Path to input audio file
        output_path: Path for normalized output (default: adds _normalized suffix)
        target_lufs: Target loudness in LUFS (default: -16.0, EBU R128 standard)
        verbose: Print progress messages

    Returns:
        Path to normalized audio file on success, None on failure

    Raises:
        FileNotFoundError: If input file doesn't exist
    """
    if not os.path.exists(input_path):
        raise VideoProcessingError(f"Audio file not found: {input_path}")

    if output_path is None:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_normalized{ext}"

    # Two-pass loudnorm for accurate normalization
    # Pass 1: Analyze audio to get current loudness
    analyze_cmd = [
        "ffmpeg",
        "-i", input_path,
        "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11:print_format=json",
        "-f", "null",
        "-"
    ]

    try:
        if verbose:
            print("  Analyzing audio loudness...")

        result = subprocess.run(
            analyze_cmd,
            capture_output=True,
            text=True,
            timeout=120
        )

        # Parse loudnorm output from stderr
        stderr = result.stderr
        # Find the JSON block in the output
        json_start = stderr.rfind('{')
        json_end = stderr.rfind('}') + 1

        if json_start == -1 or json_end == 0:
            if verbose:
                print("  Warning: Could not parse loudnorm analysis, using single-pass")
            # Fall back to single-pass normalization
            normalize_cmd = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
                "-c:a", "libmp3lame",
                "-b:a", "192k",
                output_path,
            ]
            result = subprocess.run(normalize_cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                return output_path
            return None

        # Parse the JSON
        json_str = stderr[json_start:json_end]
        loudness_data = json.loads(json_str)

        input_i = loudness_data.get("input_i", "-24.0")
        input_tp = loudness_data.get("input_tp", "-1.0")
        input_lra = loudness_data.get("input_lra", "11.0")
        input_thresh = loudness_data.get("input_thresh", "-34.0")
        target_offset = loudness_data.get("target_offset", "0.0")

        if verbose:
            print(f"    Input loudness: {input_i} LUFS")
            print(f"    Target loudness: {target_lufs} LUFS")

        # Pass 2: Apply normalization with measured values
        af_filter = (
            f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11:"
            f"measured_I={input_i}:measured_TP={input_tp}:"
            f"measured_LRA={input_lra}:measured_thresh={input_thresh}:"
            f"offset={target_offset}:linear=true"
        )

        normalize_cmd = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-af", af_filter,
            "-c:a", "libmp3lame",
            "-b:a", "192k",
            output_path,
        ]

        if verbose:
            print("  Normalizing audio...")

        result = subprocess.run(normalize_cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            if verbose:
                print(f"  Normalization failed: {result.stderr[:200]}")
            return None

        if verbose:
            print(f"  Normalized: {output_path}")

        return output_path

    except subprocess.TimeoutExpired:
        if verbose:
            print("  Normalization timed out")
        return None
    except json.JSONDecodeError as e:
        if verbose:
            print(f"  Failed to parse loudnorm output: {e}")
        return None
    except Exception as e:
        if verbose:
            print(f"  Normalization error: {e}")
        return None


def get_audio_loudness(audio_path: str) -> float | None:
    """
    Get the integrated loudness (LUFS) of an audio file.

    Args:
        audio_path: Path to audio file

    Returns:
        Loudness in LUFS on success, None on failure
    """
    if not os.path.exists(audio_path):
        return None

    cmd = [
        "ffmpeg",
        "-i", audio_path,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
        "-f", "null",
        "-"
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        stderr = result.stderr
        json_start = stderr.rfind('{')
        json_end = stderr.rfind('}') + 1

        if json_start == -1 or json_end == 0:
            return None

        data = json.loads(stderr[json_start:json_end])
        return float(data.get("input_i", 0))

    except Exception:
        return None


if __name__ == "__main__":
    # Simple CLI for testing
    import argparse

    parser = argparse.ArgumentParser(description="Audio utilities for video stitching")
    parser.add_argument("video", help="Video file to analyze")
    parser.add_argument("--check-speech", action="store_true", help="Run speech detection")
    parser.add_argument("--strip-audio", action="store_true", help="Remove audio from video")
    parser.add_argument("--output", help="Output path for strip-audio")
    args = parser.parse_args()

    if args.strip_audio:
        output = strip_audio(args.video, args.output)
        print(f"Muted video saved to: {output}")
    else:
        validation = validate_video_audio(args.video, check_speech=args.check_speech)

        print(f"\nAudio Analysis: {args.video}")
        print("=" * 50)
        print(f"  Has Audio: {validation['has_audio']}")

        if validation['audio_info'] and validation['audio_info'].get('has_audio'):
            info = validation['audio_info']
            print(f"  Codec: {info.get('codec', 'unknown')}")
            print(f"  Channels: {info.get('channels', 0)}")
            print(f"  Sample Rate: {info.get('sample_rate', 0)} Hz")
            print(f"  Duration: {info.get('duration', 0):.2f}s")

        if validation['speech_detection']:
            speech = validation['speech_detection']
            print("\n  Speech Detection:")
            print(f"    Has Speech: {speech['has_speech']}")
            print(f"    Confidence: {speech['confidence']:.0%}")
            print(f"    Voice Energy: {speech['voice_energy']:.1f} dB")
            print(f"    Mean Volume: {speech['mean_volume']:.1f} dB")
            print(f"    Max Volume: {speech['max_volume']:.1f} dB")

        print(f"\n  Recommendation: {validation['recommendation']}")
        print("=" * 50)
