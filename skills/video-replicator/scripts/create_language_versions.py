#!/usr/bin/env python3
"""
Create Language Versions - Batch Multi-Language Video Generation

Generate TTS narration and final videos for multiple languages in one pass.
Auto-translates from source language if requested.

Usage:
    # Generate Hindi and Spanish versions from English source
    python create_language_versions.py \
      --project "{slug}" \
      --source-language "en" \
      --languages "hi:oHNJagRZ2LQEfZb2CEkb,es:pNInz6obpgDQGcFmaJgB" \
      --translate \
      --tts-volume 1.5 \
      --yes

    # Use existing translated transcripts (no auto-translation)
    python create_language_versions.py \
      --project "{slug}" \
      --languages "hi:VoiceID1,fr:VoiceID2" \
      --yes

    # Dry-run to see what would be generated
    python create_language_versions.py \
      --project "{slug}" \
      --languages "hi:VoiceID" \
      --dry-run

Environment:
    GOOGLE_API_KEY - For translation (Gemini API)
    ELEVENLABS_API_KEY - For TTS generation

Output:
    For each language, creates:
    - audio/tts_{lang}/scene_*.mp3 - Per-scene TTS
    - audio/tts_{lang}/narration.mp3 - Combined narration
    - final/run001_{slug}_{lang}.mp4 - Final stitched video
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ValidationError

# Compute paths relative to this script
_SCRIPT_DIR = Path(__file__).resolve().parent
_REPLICATOR_ROOT = _SCRIPT_DIR.parent.parent.parent.parent

# Default project base
DEFAULT_PROJECT_BASE = os.environ.get(
    "VIDEO_REPLICATOR_PROJECTS",
    str(_REPLICATOR_ROOT / "projects")
)

# Language code to name mapping for common languages
LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "ar": "Arabic",
    "ru": "Russian",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "pa": "Punjabi",
    "kn": "Kannada",
    "ml": "Malayalam",
}


def parse_languages(languages_str: str) -> list[tuple[str, str]]:
    """
    Parse language specifications from CLI argument.

    Format: "lang1:voiceId1,lang2:voiceId2"
    Example: "hi:oHNJagRZ2LQEfZb2CEkb,es:pNInz6obpgDQGcFmaJgB"

    Args:
        languages_str: Comma-separated language:voiceId pairs

    Returns:
        List of (language_code, voice_id) tuples
    """
    result = []
    for pair in languages_str.split(","):
        pair = pair.strip()
        if ":" not in pair:
            raise ValidationError(f"Invalid language format: '{pair}'. Use 'lang:voiceId'")
        parts = pair.split(":", 1)
        lang_code = parts[0].strip().lower()
        voice_id = parts[1].strip()
        result.append((lang_code, voice_id))
    return result


def get_source_transcript(project_path: str) -> str | None:
    """
    Find the source editable transcript.

    Looks for:
    1. audio/tts/editable_transcript.json (default)
    2. analysis/transcript.json (raw Whisper output)

    Args:
        project_path: Path to project directory

    Returns:
        Path to transcript file or None
    """
    candidates = [
        os.path.join(project_path, "audio", "tts", "editable_transcript.json"),
        os.path.join(project_path, "analysis", "transcript.json"),
    ]

    for path in candidates:
        if os.path.exists(path):
            return path

    return None


def translate_transcript(
    source_path: str,
    target_language: str,
    output_path: str,
    translation_model: str = "gemini-3-flash-preview",
    verbose: bool = True
) -> bool:
    """
    Translate transcript to target language using generate_tts.py --translate.

    Args:
        source_path: Path to source transcript
        target_language: Target language code (e.g., "hi", "es")
        output_path: Path to output translated transcript
        translation_model: Gemini model for translation
        verbose: Print progress

    Returns:
        True if successful, False otherwise
    """
    if verbose:
        lang_name = LANGUAGE_NAMES.get(target_language, target_language)
        print(f"  Translating to {lang_name}...", flush=True)

    # Use generate_tts.py --translate
    cmd = [
        sys.executable,
        str(_SCRIPT_DIR / "generate_tts.py"),
        "--edit", source_path,
        "--translate", target_language,
        "--translation-model", translation_model,
        "--output-dir", os.path.dirname(output_path),
        "--dry-run",  # Just translate, don't generate TTS
        "--yes"
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f"  ERROR: Translation failed: {result.stderr[:200]}")
            return False

        # The translated file is saved as editable_transcript_{lang}.json
        # Move it to the expected output path if needed
        expected_output = os.path.join(
            os.path.dirname(output_path),
            f"editable_transcript_{target_language}.json"
        )
        if os.path.exists(expected_output) and expected_output != output_path:
            os.rename(expected_output, output_path)

        return os.path.exists(output_path)

    except subprocess.TimeoutExpired:
        print("  ERROR: Translation timed out")
        return False
    except Exception as e:
        print(f"  ERROR: Translation failed: {e}")
        return False


def generate_tts_for_language(
    transcript_path: str,
    output_dir: str,
    voice_id: str,
    tts_volume: float = 1.0,
    normalize: bool = True,
    verbose: bool = True
) -> bool:
    """
    Generate TTS audio for a language.

    Args:
        transcript_path: Path to (translated) transcript
        output_dir: Directory for TTS output
        voice_id: ElevenLabs voice ID
        tts_volume: TTS volume multiplier
        normalize: Whether to normalize audio
        verbose: Print progress

    Returns:
        True if successful
    """
    if verbose:
        print(f"  Generating TTS (voice: {voice_id})...", flush=True)

    cmd = [
        sys.executable,
        str(_SCRIPT_DIR / "generate_tts.py"),
        "--edit", transcript_path,
        "--output-dir", output_dir,
        "--voice-id", voice_id,
        "--tts-volume", str(tts_volume),
        "--yes"
    ]

    if normalize:
        cmd.append("--normalize")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            print(f"  ERROR: TTS generation failed: {result.stderr[:200]}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print("  ERROR: TTS generation timed out")
        return False
    except Exception as e:
        print(f"  ERROR: TTS generation failed: {e}")
        return False


def stitch_video_for_language(
    project_path: str,
    language: str,
    videos_dir: str,
    audio_path: str | None,
    narration_path: str,
    output_path: str,
    preset: str = "narrated",
    verbose: bool = True
) -> bool:
    """
    Stitch final video for a language version.

    Args:
        project_path: Path to project directory
        language: Language code for output naming
        videos_dir: Directory with scene videos
        audio_path: Background music path (optional)
        narration_path: Path to narration audio
        output_path: Output video path
        preset: Audio preset (narrated, presenter)
        verbose: Print progress

    Returns:
        True if successful
    """
    if verbose:
        lang_name = LANGUAGE_NAMES.get(language, language)
        print(f"  Stitching {lang_name} video...", flush=True)

    cmd = [
        sys.executable,
        str(_SCRIPT_DIR / "stitch_video.py"),
        "--videos-dir", videos_dir,
        "--narration", narration_path,
        "--output", output_path,
        f"--{preset}"
    ]

    if audio_path and os.path.exists(audio_path):
        cmd.extend(["--audio", audio_path])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            print(f"  ERROR: Stitching failed: {result.stderr[:200]}")
            return False
        return os.path.exists(output_path)
    except subprocess.TimeoutExpired:
        print("  ERROR: Stitching timed out")
        return False
    except Exception as e:
        print(f"  ERROR: Stitching failed: {e}")
        return False


def create_language_versions(
    project_name: str,
    languages: list[tuple[str, str]],
    source_language: str = "en",
    translate: bool = False,
    tts_volume: float = 1.0,
    normalize: bool = True,
    audio_preset: str = "narrated",
    project_base: str = DEFAULT_PROJECT_BASE,
    dry_run: bool = False,
    verbose: bool = True
) -> dict[str, bool]:
    """
    Generate video versions for multiple languages.

    Args:
        project_name: Project/product name
        languages: List of (language_code, voice_id) tuples
        source_language: Source language code (for translation)
        translate: Whether to auto-translate
        tts_volume: TTS volume multiplier
        normalize: Whether to normalize TTS audio
        audio_preset: Audio preset for stitching (narrated, presenter)
        project_base: Base path for projects
        dry_run: Preview without generating
        verbose: Print progress

    Returns:
        Dict mapping language code to success status
    """
    project_path = os.path.join(project_base, project_name)
    results = {}

    if not os.path.exists(project_path):
        print(f"ERROR: Project not found: {project_path}")
        return {lang: False for lang, _ in languages}

    # Find source transcript
    source_transcript = get_source_transcript(project_path)
    if not source_transcript:
        print(f"ERROR: No transcript found in {project_path}")
        print("  Create editable_transcript.json first using generate_tts.py --dry-run")
        return {lang: False for lang, _ in languages}

    # Find videos directory
    videos_dir = os.path.join(project_path, "videos")
    if not os.path.exists(videos_dir):
        print(f"ERROR: Videos directory not found: {videos_dir}")
        return {lang: False for lang, _ in languages}

    # Find background audio (optional)
    audio_candidates = [
        os.path.join(project_path, "audio", "background.mp3"),
        os.path.join(project_path, "audio", "music.mp3"),
    ]
    audio_path = next((p for p in audio_candidates if os.path.exists(p)), None)

    # Get run_id for output naming
    try:
        from utils_project import get_current_run_id
        run_id = get_current_run_id(project_path) or "run001"
    except ImportError:
        run_id = "run001"

    print(f"\n{'='*60}")
    print("CREATE LANGUAGE VERSIONS")
    print(f"{'='*60}")
    print(f"Project: {project_name}")
    print(f"Source transcript: {source_transcript}")
    print(f"Videos: {videos_dir}")
    print(f"Background audio: {audio_path or 'None'}")
    print(f"Languages: {', '.join([LANGUAGE_NAMES.get(lang, lang) for lang, _ in languages])}")
    print(f"Translate: {translate}")
    print(f"TTS volume: {tts_volume}")
    print(f"Normalize: {normalize}")
    print(f"Audio preset: {audio_preset}")
    print(f"{'='*60}")

    if dry_run:
        print("\nDRY RUN - No files will be created")
        print("\nWould generate:")
        for lang, _voice_id in languages:
            lang_name = LANGUAGE_NAMES.get(lang, lang)
            print(f"  - {lang_name}:")
            print(f"    - Transcript: audio/tts_{lang}/editable_transcript.json")
            print(f"    - TTS output: audio/tts_{lang}/narration.mp3")
            print(f"    - Final video: final/{run_id}_{project_name}_{lang}.mp4")
        return {lang: True for lang, _ in languages}

    # Process each language
    for lang, voice_id in languages:
        lang_name = LANGUAGE_NAMES.get(lang, lang)
        print(f"\n--- {lang_name} ({lang}) ---")

        # Create language-specific directories
        tts_dir = os.path.join(project_path, "audio", f"tts_{lang}")
        os.makedirs(tts_dir, exist_ok=True)

        final_dir = os.path.join(project_path, "final")
        os.makedirs(final_dir, exist_ok=True)

        # Step 1: Translate if needed
        transcript_path = os.path.join(tts_dir, "editable_transcript.json")
        if translate and lang != source_language:
            if not translate_transcript(source_transcript, lang, transcript_path):
                results[lang] = False
                continue
        else:
            # Copy source transcript if not translating
            if not os.path.exists(transcript_path):
                import shutil
                shutil.copy(source_transcript, transcript_path)
                print("  Copied source transcript")

        # Step 2: Generate TTS
        if not generate_tts_for_language(
            transcript_path, tts_dir, voice_id,
            tts_volume=tts_volume, normalize=normalize, verbose=verbose
        ):
            results[lang] = False
            continue

        # Step 3: Stitch video
        narration_path = os.path.join(tts_dir, "narration.mp3")
        output_path = os.path.join(final_dir, f"{run_id}_{project_name}_{lang}.mp4")

        if not stitch_video_for_language(
            project_path, lang, videos_dir, audio_path, narration_path,
            output_path, preset=audio_preset, verbose=verbose
        ):
            results[lang] = False
            continue

        results[lang] = True
        print(f"  ✓ {lang_name} complete: {output_path}")

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    successful = sum(1 for v in results.values() if v)
    print(f"Successful: {successful}/{len(languages)}")
    for lang, success in results.items():
        status = "✓" if success else "✗"
        lang_name = LANGUAGE_NAMES.get(lang, lang)
        print(f"  {status} {lang_name}")
    print(f"{'='*60}\n")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Generate video versions for multiple languages"
    )
    parser.add_argument("--project", required=True, help="Project name")
    parser.add_argument(
        "--languages", required=True,
        help="Language:VoiceID pairs, comma-separated. Example: 'hi:VoiceID1,es:VoiceID2'"
    )
    parser.add_argument(
        "--source-language", default="en",
        help="Source language code (default: en)"
    )
    parser.add_argument(
        "--translate", action="store_true",
        help="Auto-translate from source language using Gemini"
    )
    parser.add_argument(
        "--tts-volume", type=float, default=1.0,
        help="TTS volume multiplier (default: 1.0)"
    )
    parser.add_argument(
        "--normalize", action="store_true", default=True,
        help="Normalize TTS audio to -16 LUFS (default: enabled)"
    )
    parser.add_argument(
        "--no-normalize", action="store_true",
        help="Disable audio normalization"
    )
    parser.add_argument(
        "--preset", choices=["narrated", "presenter"], default="narrated",
        help="Audio preset for stitching (default: narrated)"
    )
    parser.add_argument(
        "--project-base", default=DEFAULT_PROJECT_BASE,
        help="Base path for projects"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview without generating"
    )
    parser.add_argument(
        "--yes", "-y", action="store_true",
        help="Skip confirmation prompts"
    )

    args = parser.parse_args()

    # Parse languages
    try:
        languages = parse_languages(args.languages)
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    if not languages:
        print("ERROR: No languages specified")
        sys.exit(1)

    # Handle normalize flag
    normalize = args.normalize and not args.no_normalize

    # Run
    results = create_language_versions(
        project_name=args.project,
        languages=languages,
        source_language=args.source_language,
        translate=args.translate,
        tts_volume=args.tts_volume,
        normalize=normalize,
        audio_preset=args.preset,
        project_base=args.project_base,
        dry_run=args.dry_run,
        verbose=True
    )

    # Exit with error if any failed
    if not all(results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
