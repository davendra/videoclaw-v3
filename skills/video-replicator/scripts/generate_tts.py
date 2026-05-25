#!/usr/bin/env python3
"""
ElevenLabs Text-to-Speech, Voice Changer & Audio Baking Script.

Phase 5b/5c/5d/5e of the video-replicator pipeline:
- TTS: Generate narration audio from transcripts (Phase 5b)
- Voice Change: Transform Veo speech to consistent voice via STS (Phase 5c)
- Bake Narration: Overlay TTS audio per-scene onto videos (Phase 5d)
- Swap: Rename processed files to primary filenames for stitching (Phase 5e)

Usage:
    # --- TTS Mode (text → speech) ---

    # List available voices (grouped by type)
    python generate_tts.py --list-voices

    # List only your saved/personal voices
    python generate_tts.py --my-voices

    # Dry-run (preview scene texts, char counts, cost estimate)
    python generate_tts.py --transcript transcript.json --output-dir audio/tts --dry-run

    # Generate TTS for all scenes
    python generate_tts.py --transcript transcript.json --output-dir audio/tts \
      --voice-name "Rachel" --pad-to-duration

    # Generate with edited transcript
    python generate_tts.py --transcript transcript.json --output-dir audio/tts \
      --voice-name "Rachel" --edit editable_transcript.json

    # Generate with emotional tags (Eleven v3 dialogue mode)
    python generate_tts.py --transcript transcript.json --output-dir audio/tts \
      --voice-name "Rachel" --dialogue --model-id eleven_v3

    # Generate with timestamps for subtitle/alignment data
    python generate_tts.py --transcript transcript.json --output-dir audio/tts \
      --voice-name "Rachel" --with-timestamps

    # --- Voice Changer Mode (speech → speech) ---

    # Transform a single video's audio to a consistent voice
    python generate_tts.py --voice-change \
      --video videos/scene_1.mp4 \
      --voice-id "TxGEqnHWrfWFTfGW9XjX" \
      --output videos/scene_1_vc.mp4

    # Batch: transform all scene videos in a directory
    python generate_tts.py --voice-change \
      --videos-dir videos/ \
      --voice-id "TxGEqnHWrfWFTfGW9XjX" \
      --scenes 1,5,7 \
      --seed 42 --remove-bg-noise

    # Dry-run voice change (show what would be processed)
    python generate_tts.py --voice-change \
      --videos-dir videos/ --voice-id "TxGEqnHWrfWFTfGW9XjX" --dry-run

    # --- Bake Narration Mode (overlay TTS on videos) ---

    # Bake TTS narration onto B-roll scene videos
    python generate_tts.py --bake-narration \
      --videos-dir videos/ \
      --tts-dir audio/tts/ \
      --scenes 2,3,4,6,8

    # --- Swap Mode (rename processed files to primary names) ---

    # Swap _vc and _narrated files to primary filenames
    python generate_tts.py --swap \
      --videos-dir videos/ \
      --scenes 1,2,3,4,5

Requirements:
    pip install requests
    ELEVENLABS_API_KEY environment variable set
"""

import argparse
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path as _Path
from typing import Any

# Auto-load .env from the nearest parent containing one so this script works
# whether invoked from the repo root, a project dir, or via a wrapper. Doesn't
# override env vars already set in the shell (those win). No-op if python-dotenv
# is not installed — the prior manual `source .env` flow continues to work.
try:
    from dotenv import load_dotenv as _load_dotenv
    for _parent in _Path(__file__).resolve().parents:
        if (_parent / ".env").is_file():
            _load_dotenv(_parent / ".env", override=False)
            break
except ImportError:
    pass

from ffmpeg_wrapper import FFmpegWrapper
from logging_config import setup_logging

# Module-level logger — verbose can be enabled via setup_logging(__name__, verbose=True)
logger = setup_logging(__name__)

# Shared FFmpeg wrapper instance
_ff = FFmpegWrapper()

# ElevenLabs API base URL
ELEVENLABS_API_BASE = "https://api.elevenlabs.io"

# Google Gemini API for translation
GEMINI_DEFAULT_MODEL = "gemini-3-flash-preview"

# Supported languages for translation (ISO 639-1 codes)
SUPPORTED_LANGUAGES = {
    "en": "English",
    "hi": "Hindi",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese (Simplified)",
    "ar": "Arabic",
    "ru": "Russian",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi",
}

# Audio presets for different content types
AUDIO_PRESETS = {
    "kids-narrated": {
        "tts_volume": 2.0,      # Voice very prominent
        "sfx_volume": 0.4,      # SFX subtle
        "music_volume": 0.15,   # Music very subtle
        "description": "Clear narration for children's content",
    },
    "presenter": {
        "tts_volume": 1.0,
        "sfx_volume": 0.85,
        "music_volume": 0.25,
        "description": "Voice-over with moderate music",
    },
    "narrated": {
        "tts_volume": 1.0,
        "sfx_volume": 0.85,
        "music_volume": 0.15,
        "description": "Narration with preserved SFX",
    },
    "documentary": {
        "tts_volume": 1.5,
        "sfx_volume": 0.6,
        "music_volume": 0.2,
        "description": "Documentary-style narration",
    },
}

# Default TTS settings
DEFAULT_MODEL_ID = "eleven_flash_v2_5"
DEFAULT_STABILITY = 0.5
DEFAULT_SIMILARITY_BOOST = 0.75
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"

# Cost estimate (approximate, per character)
# ElevenLabs pricing varies by plan; this is a rough estimate
COST_PER_CHAR_ESTIMATE = 0.00003  # ~$0.03 per 1000 chars


def get_api_key() -> str:
    """Get ElevenLabs API key from environment."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        logger.error("ELEVENLABS_API_KEY not set.")
        logger.error("Set it in .claude/settings.local.json:")
        logger.error('  {"env": {"ELEVENLABS_API_KEY": "sk_..."}}')
        logger.error("Or export it:")
        logger.error("  export ELEVENLABS_API_KEY=sk_...")
        sys.exit(1)
    return api_key


def get_google_api_key() -> str | None:
    """Get Google API key for Gemini translation."""
    return os.environ.get("GOOGLE_API_KEY")


def translate_text(
    text: str,
    target_language: str,
    model_id: str = GEMINI_DEFAULT_MODEL,
) -> str | None:
    """
    Translate text to target language using Google Gemini.

    Args:
        text: The text to translate
        target_language: Target language code (e.g., "hi" for Hindi)
        model_id: Gemini model ID (default: gemini-3-flash-preview)

    Returns:
        Translated text on success, None on failure
    """
    api_key = get_google_api_key()
    if not api_key:
        logger.error("GOOGLE_API_KEY not set for translation.")
        return None

    if target_language not in SUPPORTED_LANGUAGES:
        logger.warning("Unknown language code '%s'. Attempting anyway.", target_language)

    lang_name = SUPPORTED_LANGUAGES.get(target_language, target_language)

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_id)

        prompt = f"""Translate the following text to {lang_name}.
Rules:
- Translate naturally, not word-for-word
- Preserve the tone and emotion
- Keep proper nouns, names, and technical terms
- Return ONLY the translated text, no explanations
- Do not add quotes around the translation

Text to translate:
{text}"""

        response = model.generate_content(prompt)
        translated = response.text.strip()

        # Remove any surrounding quotes the model might add
        if translated.startswith('"') and translated.endswith('"'):
            translated = translated[1:-1]
        if translated.startswith("'") and translated.endswith("'"):
            translated = translated[1:-1]

        return translated

    except ImportError:
        logger.error("google-generativeai not installed. Run: pip install google-generativeai")
        return None
    except Exception as e:
        logger.error("Translation error: %s", e)
        return None


def translate_transcript(
    transcript_scenes: list[dict[str, Any]],
    target_language: str,
    model_id: str = GEMINI_DEFAULT_MODEL,
    verbose: bool = True,
) -> list[dict[str, Any]]:
    """
    Translate all scene texts in a transcript to target language.

    Args:
        transcript_scenes: List of {"scene_number": int, "text": str, ...}
        target_language: Target language code
        model_id: Gemini model ID
        verbose: Print progress

    Returns:
        New list with translated texts
    """
    lang_name = SUPPORTED_LANGUAGES.get(target_language, target_language)

    if verbose:
        logger.info("Translating %d scenes to %s...", len(transcript_scenes), lang_name)

    translated_scenes = []
    for i, scene in enumerate(transcript_scenes):
        scene_num = scene.get("scene_number", i + 1)
        original_text = scene.get("text", "")

        if not original_text.strip():
            translated_scenes.append({**scene, "text": "", "original_text": ""})
            continue

        if verbose:
            preview = original_text[:50] + "..." if len(original_text) > 50 else original_text
            logger.info("Scene %d: \"%s\"", scene_num, preview)

        translated = translate_text(original_text, target_language, model_id)

        if translated:
            if verbose:
                trans_preview = translated[:50] + "..." if len(translated) > 50 else translated
                logger.info("  -> \"%s\"", trans_preview)
            translated_scenes.append({
                **scene,
                "text": translated,
                "original_text": original_text,
                "translated_to": target_language,
            })
        else:
            logger.warning("Scene %d: Translation failed, using original", scene_num)
            translated_scenes.append({**scene, "original_text": original_text})

    return translated_scenes


def _api_request(method: str, endpoint: str, api_key: str, **kwargs) -> Any:
    """Make an authenticated request to the ElevenLabs API."""
    import requests

    url = f"{ELEVENLABS_API_BASE}{endpoint}"
    headers = {"xi-api-key": api_key}
    if "headers" in kwargs:
        headers.update(kwargs.pop("headers"))

    response = requests.request(method, url, headers=headers, timeout=60, **kwargs)
    return response


def list_voices(api_key: str, voice_type: str | None = None) -> list[dict[str, Any]]:
    """
    List available ElevenLabs voices using v2 API.

    Args:
        api_key: ElevenLabs API key
        voice_type: Filter by type: "saved" (user's saved), "personal" (user-created),
                    "default" (ElevenLabs defaults), or None for all
    """
    params = {"page_size": 100}
    if voice_type:
        params["voice_type"] = voice_type
    resp = _api_request("GET", "/v2/voices", api_key, params=params)
    if resp.status_code != 200:
        # Fallback to v1 if v2 not available
        resp = _api_request("GET", "/v1/voices", api_key)
        if resp.status_code != 200:
            logger.error("Error listing voices: %d %s", resp.status_code, resp.text[:300])
            return []
    data = resp.json()
    return data.get("voices", [])


def list_my_voices(api_key: str) -> list[dict[str, Any]]:
    """List only user's saved and personal voices."""
    saved = list_voices(api_key, voice_type="saved")
    personal = list_voices(api_key, voice_type="personal")
    # Deduplicate by voice_id
    seen = set()
    result = []
    for v in saved + personal:
        vid = v.get("voice_id")
        if vid and vid not in seen:
            seen.add(vid)
            result.append(v)
    return result


def list_models(api_key: str) -> list[dict[str, Any]]:
    """List available ElevenLabs TTS models."""
    resp = _api_request("GET", "/v1/models", api_key)
    if resp.status_code != 200:
        logger.error("Error listing models: %d %s", resp.status_code, resp.text[:300])
        return []
    return resp.json() if isinstance(resp.json(), list) else []


_voice_cache: dict[str, list[dict[str, Any]]] = {}


def _get_voices_cached(api_key: str) -> list[dict[str, Any]]:
    """Return cached voice list for the given API key, fetching once if needed."""
    if api_key not in _voice_cache:
        _voice_cache[api_key] = list_voices(api_key)
    return _voice_cache[api_key]


def find_voice_by_name(api_key: str, name: str) -> str | None:
    """Search for a voice by name and return its voice_id.

    Matching priority:
      1. Case-insensitive exact match (e.g., "rachel" -> "Rachel")
      2. Case-insensitive partial/substring match (e.g., "josh" -> "Josh - Deep Male")

    If a partial match finds multiple candidates, logs a warning listing
    all matches and picks the first one alphabetically by name.

    Results are cached per API key so repeated lookups don't re-fetch.
    """
    voices = _get_voices_cached(api_key)
    name_lower = name.lower()

    # 1. Case-insensitive exact match
    for voice in voices:
        if voice.get("name", "").lower() == name_lower:
            return voice["voice_id"]

    # 2. Partial / substring match
    partial_matches = [
        voice
        for voice in voices
        if name_lower in voice.get("name", "").lower()
    ]

    if len(partial_matches) == 1:
        match = partial_matches[0]
        logger.info("Partial match: '%s' for query '%s'", match["name"], name)
        return match["voice_id"]

    if len(partial_matches) > 1:
        # Sort by name for deterministic selection
        partial_matches.sort(key=lambda v: v.get("name", ""))
        match_names = [v.get("name", "") for v in partial_matches]
        logger.warning(
            "Multiple voices match '%s': %s. Using '%s'.",
            name,
            ", ".join(match_names),
            match_names[0],
        )
        return partial_matches[0]["voice_id"]

    return None


def resolve_voice_map(
    voice_map_json: str,
    api_key: str,
) -> dict[str, str]:
    """
    Resolve a speaker-name-to-voice mapping from JSON string.

    Accepts voice names or voice IDs. Names are resolved via the API.

    Args:
        voice_map_json: JSON string like '{"narrator":"Daniel","Ram":"Leo"}'
        api_key: ElevenLabs API key

    Returns:
        Dict mapping speaker name to resolved voice_id
    """
    try:
        raw_map = json.loads(voice_map_json)
    except json.JSONDecodeError as e:
        logger.error("Invalid --voice-map JSON: %s", e)
        sys.exit(1)

    resolved = {}
    for speaker, voice_ref in raw_map.items():
        # If it looks like a voice ID (long alphanumeric), use directly
        if len(voice_ref) > 15 and voice_ref.isalnum():
            resolved[speaker] = voice_ref
            logger.info("%s -> %s (ID)", speaker, voice_ref)
        else:
            # Resolve by name
            vid = find_voice_by_name(api_key, voice_ref)
            if vid:
                resolved[speaker] = vid
                logger.info("%s -> %s (%s)", speaker, vid, voice_ref)
            else:
                logger.warning("Could not find voice '%s' for speaker '%s'", voice_ref, speaker)

    return resolved


def generate_multi_voice_scene(
    segments: list[dict[str, str]],
    voice_map: dict[str, str],
    api_key: str,
    output_path: str,
    model_id: str = DEFAULT_MODEL_ID,
    stability: float = DEFAULT_STABILITY,
    similarity_boost: float = DEFAULT_SIMILARITY_BOOST,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
    style: float = 0.0,
    speed: float = 1.0,
    speaker_boost: bool = True,
) -> str | None:
    """
    Generate TTS for a multi-voice scene by generating each segment
    separately and concatenating them.

    Args:
        segments: List of {"speaker": str, "text": str} dicts
        voice_map: Dict mapping speaker name to voice_id
        api_key: ElevenLabs API key
        output_path: Final output file path
        model_id: TTS model ID
        stability: Voice stability
        similarity_boost: Voice similarity boost
        output_format: Audio output format
        style: Style exaggeration
        speed: Speech speed
        speaker_boost: Boost similarity

    Returns:
        Output path on success, None on failure
    """
    import tempfile

    if not segments:
        return None

    temp_dir = tempfile.mkdtemp()
    segment_files = []

    for i, seg in enumerate(segments):
        speaker = seg.get("speaker", "narrator")
        text = seg.get("text", "").strip()
        if not text:
            continue

        voice_id = voice_map.get(speaker)
        if not voice_id:
            # Fallback: try case-insensitive match
            for k, v in voice_map.items():
                if k.lower() == speaker.lower():
                    voice_id = v
                    break
        if not voice_id:
            logger.warning("No voice mapped for speaker '%s', skipping segment", speaker)
            continue

        seg_path = os.path.join(temp_dir, f"seg_{i:03d}.mp3")
        audio_bytes = generate_speech(
            text=text,
            voice_id=voice_id,
            api_key=api_key,
            model_id=model_id,
            stability=stability,
            similarity_boost=similarity_boost,
            output_format=output_format,
            style=style,
            speed=speed,
            speaker_boost=speaker_boost,
        )

        if audio_bytes:
            with open(seg_path, "wb") as f:
                f.write(audio_bytes)
            segment_files.append(seg_path)
            dur = get_audio_duration(seg_path)
            logger.info("  [%s] %d chars -> %.1fs", speaker, len(text), dur)
        else:
            logger.error("  [%s] FAILED: %s...", speaker, text[:50])

    if not segment_files:
        return None

    # Concatenate segments
    concat_list = os.path.join(temp_dir, "concat.txt")
    with open(concat_list, "w") as f:
        for seg_file in segment_files:
            f.write(f"file '{os.path.abspath(seg_file)}'\n")

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list,
        "-c:a", "libmp3lame", "-b:a", "128k",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.error("Concat error: %s", result.stderr[:200])
            return None
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.error("Concat error: %s", e)
        return None

    # Cleanup temp files
    for f_path in segment_files:
        if os.path.exists(f_path):
            os.remove(f_path)
    if os.path.exists(concat_list):
        os.remove(concat_list)
    with contextlib.suppress(OSError):
        os.rmdir(temp_dir)

    if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
        return output_path
    return None


def generate_speech(
    text: str,
    voice_id: str,
    api_key: str,
    model_id: str = DEFAULT_MODEL_ID,
    stability: float = DEFAULT_STABILITY,
    similarity_boost: float = DEFAULT_SIMILARITY_BOOST,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
    style: float = 0.0,
    speed: float = 1.0,
    speaker_boost: bool = True,
    with_timestamps: bool = False,
    previous_text: str | None = None,
    next_text: str | None = None,
    dialogue: bool = False,
) -> bytes | tuple[bytes, dict] | None:
    """
    Generate speech audio from text using ElevenLabs TTS API.

    Args:
        text: The text to convert to speech
        voice_id: ElevenLabs voice ID
        api_key: API key
        model_id: TTS model ID
        stability: Voice stability (0.0-1.0)
        similarity_boost: Voice similarity boost (0.0-1.0)
        output_format: Audio output format
        style: Style exaggeration (0.0-1.0, default 0). Higher = more dramatic.
        speed: Speech speed (0.0+, default 1.0). <1.0 slower, >1.0 faster.
        speaker_boost: Boost similarity to original voice (default True).
        with_timestamps: If True, return (audio_bytes, alignment_data) tuple.
        previous_text: Previous scene text for prosody continuity.
        next_text: Next scene text for prosody continuity.
        dialogue: If True, use Eleven v3 dialogue endpoint for emotional tags.

    Returns:
        Audio bytes on success, None on failure.
        If with_timestamps=True, returns (audio_bytes, alignment_data) or None.
    """
    if not text.strip():
        return None

    voice_settings = {
        "stability": stability,
        "similarity_boost": similarity_boost,
        "style": style,
        "use_speaker_boost": speaker_boost,
    }

    # Dialogue mode: use text-to-dialogue endpoint (Eleven v3)
    if dialogue:
        endpoint = "/v1/text-to-dialogue/convert"
        payload = {
            "text": text,
            "voice_id": voice_id,
            "model_id": model_id,
            "voice_settings": voice_settings,
        }
        if speed != 1.0:
            payload["speed"] = speed
        resp = _api_request(
            "POST",
            endpoint,
            api_key,
            json=payload,
            headers={"Accept": "audio/mpeg", "Content-Type": "application/json"},
            params={"output_format": output_format},
        )
        if resp.status_code != 200:
            logger.error("Dialogue API error: %d %s", resp.status_code, resp.text[:300])
            return None
        return resp.content

    # Timestamps mode: use with-timestamps endpoint
    if with_timestamps:
        endpoint = f"/v1/text-to-speech/{voice_id}/with-timestamps"
    else:
        endpoint = f"/v1/text-to-speech/{voice_id}"

    payload = {
        "text": text,
        "model_id": model_id,
        "voice_settings": voice_settings,
    }
    if speed != 1.0:
        payload["speed"] = speed
    if previous_text:
        payload["previous_text"] = previous_text
    if next_text:
        payload["next_text"] = next_text

    resp = _api_request(
        "POST",
        endpoint,
        api_key,
        json=payload,
        headers={"Accept": "audio/mpeg", "Content-Type": "application/json"},
        params={"output_format": output_format},
    )

    if resp.status_code != 200:
        logger.error("TTS API error: %d %s", resp.status_code, resp.text[:300])
        return None

    if with_timestamps:
        try:
            data = resp.json()
            import base64
            audio_bytes = base64.b64decode(data.get("audio_base64", ""))
            alignment = data.get("alignment", {})
            return (audio_bytes, alignment)
        except Exception as e:
            logger.error("Timestamps parse error: %s", e)
            return None

    return resp.content


def load_transcript(path: str) -> dict[str, Any]:
    """
    Load transcript JSON — supports standalone transcript files
    and transcripts embedded in SEALCAM+ analysis JSON.

    Returns:
        dict with keys: "transcript" (full text info) and
        optionally "scene_transcripts" (per-scene aligned text)
    """
    with open(path) as f:
        data = json.load(f)

    # Standalone transcript file (from transcribe_audio.py)
    if "transcript" in data:
        return data

    # Embedded in SEALCAM+ analysis (from analyze_video.py --transcribe)
    if "scenes" in data:
        # Build scene_transcripts from SEALCAM+ scenes that have transcript data
        scene_transcripts = []
        for scene in data.get("scenes", []):
            scene_num = scene.get("scene_number", 0)
            transcript_data = scene.get("transcript", {})
            if isinstance(transcript_data, dict):
                text = transcript_data.get("text", "")
            elif isinstance(transcript_data, str):
                text = transcript_data
            else:
                text = ""
            scene_transcripts.append({
                "scene_number": scene_num,
                "text": text,
                "has_speech": bool(text.strip()),
            })

        return {
            "transcript": {
                "full_text": " ".join(s["text"] for s in scene_transcripts if s["text"]),
            },
            "scene_transcripts": scene_transcripts,
        }

    logger.warning("Could not find transcript data in %s", path)
    return {"transcript": {"full_text": ""}, "scene_transcripts": []}


def load_edited_transcript(path: str) -> dict[int, str | list]:
    """
    Load user-edited transcript overrides.

    Supports two formats (backward compatible):

    Simple (single voice):
    {
      "scenes": {
        "1": "Edited text for scene 1",
        "3": "Edited text for scene 3"
      }
    }

    Multi-voice:
    {
      "scenes": {
        "1": [{"speaker": "narrator", "text": "..."}, {"speaker": "Ram", "text": "..."}],
        "2": "Simple text (single voice, backward compatible)"
      }
    }

    Returns:
        Dict mapping scene_number (int) to edited text (str) or segments (list)
    """
    with open(path) as f:
        data = json.load(f)

    edits = {}
    scenes = data.get("scenes", {})
    for key, text in scenes.items():
        edits[int(key)] = text
    return edits


def detect_speakers(transcript_data: dict) -> list[str]:
    """
    Scan transcript for unique speaker names in multi-voice segments.

    Checks both scene_transcripts (from loaded transcript) and scenes dict
    (from editable_transcript.json format) for speaker-tagged segments.

    Args:
        transcript_data: Loaded transcript or editable transcript dict

    Returns:
        Sorted list of unique speaker names found, or empty list if no speaker tags.
    """
    speakers: set[str] = set()

    # Check scene_transcripts format (loaded transcript)
    scene_transcripts = transcript_data.get("scene_transcripts", [])
    for scene in scene_transcripts:
        text = scene.get("text", "")
        if isinstance(text, list):
            for segment in text:
                if isinstance(segment, dict) and "speaker" in segment:
                    speakers.add(segment["speaker"])

    # Check scenes dict format (editable_transcript.json)
    scenes = transcript_data.get("scenes", {})
    if isinstance(scenes, dict):
        for _key, text in scenes.items():
            if isinstance(text, list):
                for segment in text:
                    if isinstance(segment, dict) and "speaker" in segment:
                        speakers.add(segment["speaker"])

    return sorted(speakers)


def get_scene_texts(
    transcript: dict[str, Any],
    edit_overrides: dict[int, str | list] | None = None,
    skip_scenes: set[int] | None = None,
) -> list[dict[str, Any]]:
    """
    Extract per-scene text from transcript, applying any edits.

    Args:
        transcript: Loaded transcript dict
        edit_overrides: Optional dict of scene_number -> edited text (str)
                       or multi-voice segments (list of {"speaker": str, "text": str})
        skip_scenes: Optional set of scene numbers to exclude

    Returns:
        List of {"scene_number": int, "text": str or list, "edited": bool}
        When text is a list, it contains multi-voice segments.
    """
    scene_transcripts = transcript.get("scene_transcripts", [])
    if not scene_transcripts:
        # No per-scene data — use full text as single scene
        full_text = transcript.get("transcript", {}).get("full_text", "")
        if full_text:
            return [{"scene_number": 1, "text": full_text, "edited": False}]
        return []

    result = []
    for scene in scene_transcripts:
        scene_num = scene.get("scene_number", 0)

        if skip_scenes and scene_num in skip_scenes:
            continue

        text = scene.get("text", "")

        # Apply edit override if available
        edited = False
        if edit_overrides and scene_num in edit_overrides:
            text = edit_overrides[scene_num]
            edited = True

        result.append({
            "scene_number": scene_num,
            "text": text,
            "edited": edited,
        })

    return result


def build_editable_transcript(transcript: dict[str, Any], output_path: str) -> str:
    """
    Write an editable JSON file for user review/editing.

    Args:
        transcript: Loaded transcript dict
        output_path: Path to write the editable JSON

    Returns:
        Path to the written file
    """
    scene_texts = get_scene_texts(transcript)
    editable = {
        "_instructions": "Edit the 'text' field for any scene you want to change. "
                         "Save and pass this file with --edit flag.",
        "scenes": {},
    }
    for scene in scene_texts:
        editable["scenes"][str(scene["scene_number"])] = scene["text"]

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(editable, f, indent=2)

    return output_path


def get_audio_duration(audio_path: str) -> float:
    """Get audio file duration in seconds using ffprobe."""
    return _ff.get_duration(audio_path) or 0.0


def generate_silence(duration: float, output_path: str) -> bool:
    """Generate a silent audio file of the specified duration."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=stereo",
        "-t", f"{duration:.3f}",
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        output_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def concatenate_audio_files(
    files: list[str],
    output: str,
    scene_durations: list[float] | None = None,
    pad_to_duration: bool = False,
) -> bool:
    """
    Concatenate audio files into a single track, optionally padding
    each segment with silence to match scene video durations.

    Args:
        files: List of audio file paths (in scene order)
        output: Output file path
        scene_durations: Optional list of target durations per scene (seconds)
        pad_to_duration: If True, pad each scene's audio with silence
                        to match its scene_duration

    Returns:
        True on success
    """
    import tempfile

    if not files:
        return False

    if pad_to_duration and scene_durations:
        # Pad each audio file to match scene duration
        padded_files = []
        temp_dir = tempfile.mkdtemp()

        for i, audio_file in enumerate(files):
            if i < len(scene_durations):
                target_dur = scene_durations[i]
                actual_dur = get_audio_duration(audio_file)

                if actual_dur > 0 and target_dur > actual_dur:
                    # Generate silence for the gap
                    gap = target_dur - actual_dur
                    silence_path = os.path.join(temp_dir, f"silence_{i}.mp3")
                    padded_path = os.path.join(temp_dir, f"padded_{i}.mp3")

                    if generate_silence(gap, silence_path):
                        # Concat audio + silence
                        concat_list = os.path.join(temp_dir, f"concat_{i}.txt")
                        with open(concat_list, "w") as f:
                            f.write(f"file '{os.path.abspath(audio_file)}'\n")
                            f.write(f"file '{os.path.abspath(silence_path)}'\n")

                        cmd = [
                            "ffmpeg", "-y",
                            "-f", "concat", "-safe", "0",
                            "-i", concat_list,
                            "-c", "copy",
                            padded_path,
                        ]
                        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                        if result.returncode == 0:
                            padded_files.append(padded_path)
                            continue

                # No padding needed or padding failed — use original
                padded_files.append(audio_file)
            else:
                padded_files.append(audio_file)

        files = padded_files

    # Create concat list
    concat_list_path = output + ".concat.txt"
    with open(concat_list_path, "w") as f:
        for audio_file in files:
            f.write(f"file '{os.path.abspath(audio_file)}'\n")

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list_path,
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        output,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        success = result.returncode == 0
        if not success:
            logger.error("FFmpeg concat error: %s", result.stderr[:300])
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.error("FFmpeg error: %s", e)
        success = False
    finally:
        # Clean up concat list
        if os.path.exists(concat_list_path):
            os.remove(concat_list_path)

    return success


def sync_tts_to_slides(
    tts_files: list[str],
    slides_json_path: str,
    output_path: str,
) -> str | None:
    """
    Pad each TTS file with silence to match its slide duration from slides.json,
    then concatenate into a single synced narration track.

    Args:
        tts_files: List of per-scene TTS file paths (ordered by scene number)
        slides_json_path: Path to slides.json with per-slide durations
        output_path: Path for the synced narration output file

    Returns:
        Output path on success, None on failure
    """
    import tempfile

    # Load slide durations
    with open(slides_json_path) as f:
        slides_data = json.load(f)

    slides = slides_data.get("slides", [])
    if not slides:
        logger.warning("No slides found in slides.json, skipping sync")
        return None

    # Build scene_number -> duration map
    slide_durations = {}
    for slide in slides:
        slide_num = slide.get("slide")
        duration = slide.get("duration", 0)
        if slide_num and duration > 0:
            slide_durations[slide_num] = duration

    if not slide_durations:
        logger.warning("No slide durations found in slides.json, skipping sync")
        return None

    # Extract scene numbers from TTS filenames
    tts_by_scene = {}
    for tts_path in tts_files:
        basename = os.path.basename(tts_path)
        match = re.search(r"scene_(\d+)_tts", basename)
        if match:
            tts_by_scene[int(match.group(1))] = tts_path

    logger.info("Syncing TTS to slide durations (%d scenes)...", len(tts_by_scene))

    temp_dir = tempfile.mkdtemp()
    padded_files = []

    for scene_num in sorted(tts_by_scene.keys()):
        tts_path = tts_by_scene[scene_num]
        target_dur = slide_durations.get(scene_num)

        if target_dur is None:
            logger.info("Scene %d: No duration in slides.json, using TTS as-is", scene_num)
            padded_files.append(tts_path)
            continue

        actual_dur = get_audio_duration(tts_path)
        if actual_dur <= 0:
            logger.warning("Scene %d: Could not read TTS duration, skipping", scene_num)
            continue

        if target_dur <= actual_dur:
            logger.info("Scene %d: TTS %.1fs >= slide %.1fs (no padding)", scene_num, actual_dur, target_dur)
            padded_files.append(tts_path)
            continue

        gap = target_dur - actual_dur
        silence_path = os.path.join(temp_dir, f"silence_{scene_num}.mp3")
        padded_path = os.path.join(temp_dir, f"padded_{scene_num}.mp3")

        logger.info("Scene %d: TTS %.1fs + %.1fs silence = %.1fs", scene_num, actual_dur, gap, target_dur)

        if generate_silence(gap, silence_path):
            concat_list = os.path.join(temp_dir, f"concat_{scene_num}.txt")
            with open(concat_list, "w") as f:
                f.write(f"file '{os.path.abspath(tts_path)}'\n")
                f.write(f"file '{os.path.abspath(silence_path)}'\n")

            cmd = [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_list,
                "-c", "copy",
                padded_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                padded_files.append(padded_path)
            else:
                logger.warning("Scene %d: Padding failed, using original", scene_num)
                padded_files.append(tts_path)
        else:
            logger.warning("Scene %d: Silence generation failed, using original", scene_num)
            padded_files.append(tts_path)

    if not padded_files:
        logger.warning("No files to concatenate for synced narration")
        return None

    # Concatenate padded files
    success = concatenate_audio_files(padded_files, output_path)
    if success:
        synced_dur = get_audio_duration(output_path)
        expected_dur = sum(slide_durations.get(s, 0) for s in sorted(tts_by_scene.keys()))
        logger.info("Synced narration: %s (%.1fs, expected ~%.1fs)", output_path, synced_dur, expected_dur)
        return output_path
    else:
        logger.error("Failed to create synced narration")
        return None


def dry_run(
    transcript: dict[str, Any],
    edits: dict[int, str | list] | None,
    voice_id: str | None,
    model_id: str,
    output_dir: str,
    variant: str | None = None,
) -> None:
    """Preview TTS generation without calling the API."""
    scene_texts = get_scene_texts(transcript, edits)

    print(f"\n{'='*60}")
    print("DRY RUN - TTS Generation Preview")
    print(f"{'='*60}")
    print(f"Model: {model_id}")
    print(f"Voice ID: {voice_id or '(not specified)'}")
    print(f"Output dir: {output_dir}")
    print()

    total_chars = 0
    scenes_with_text = 0

    for scene in scene_texts:
        num = scene["scene_number"]
        text = scene["text"]
        edited = " [EDITED]" if scene.get("edited") else ""
        chars = len(text)
        total_chars += chars

        if text.strip():
            scenes_with_text += 1
            preview = text[:100] + ("..." if len(text) > 100 else "")
            print(f"  Scene {num}{edited}: {chars} chars")
            print(f"    \"{preview}\"")
        else:
            print(f"  Scene {num}: (empty — will be skipped)")

    print("\n--- Summary ---")
    print(f"Scenes with text: {scenes_with_text}/{len(scene_texts)}")
    print(f"Total characters: {total_chars:,}")
    cost = total_chars * COST_PER_CHAR_ESTIMATE
    print(f"Estimated cost: ~${cost:.4f}")

    # Write editable transcript (protect existing non-empty file)
    editable_filename = f"editable_transcript_{variant}.json" if variant else "editable_transcript.json"
    editable_path = os.path.join(output_dir, editable_filename)
    if os.path.exists(editable_path):
        # Check if existing file has non-empty scene text
        try:
            with open(editable_path) as f:
                existing = json.load(f)
            has_content = any(
                text.strip()
                for text in existing.get("scenes", {}).values()
                if isinstance(text, str)
            )
        except (OSError, json.JSONDecodeError):
            has_content = False

        if has_content:
            template_name = f"editable_transcript_{variant}_template.json" if variant else "editable_transcript_template.json"
            template_path = os.path.join(output_dir, template_name)
            build_editable_transcript(transcript, template_path)
            print(f"\nExisting transcript preserved: {editable_path}")
            print(f"  Template written to: {template_path}")
        else:
            build_editable_transcript(transcript, editable_path)
            print(f"\nEditable transcript: {editable_path}")
    else:
        build_editable_transcript(transcript, editable_path)
        print(f"\nEditable transcript: {editable_path}")
    print("  Edit scene texts, then re-run with --edit flag")

    print(f"\n{'='*60}")
    print("Remove --dry-run to generate TTS audio.")
    print(f"{'='*60}\n")


# ============================================================
# Voice Changer (Speech-to-Speech) Functions
# ============================================================

# STS model for voice changing
STS_MODEL_ID = "eleven_multilingual_sts_v2"


def extract_audio_from_video(video_path: str, output_audio_path: str) -> bool:
    """Extract audio track from a video file using FFmpeg."""
    try:
        _ff.run(
            ["-i", video_path, "-vn", "-acodec", "libmp3lame", "-b:a", "128k",
             output_audio_path],
            timeout=30,
        )
        return os.path.exists(output_audio_path) and os.path.getsize(output_audio_path) > 0
    except Exception as e:
        logger.error("FFmpeg error: %s", e)
        return False


def _probe_audio_channels(filepath: str) -> int:
    """Return audio channel count (1=mono, 2=stereo). Defaults to 2."""
    try:
        out = _ff.probe(filepath, entries="stream=channels", select_streams="a:0")
        return int(out.strip())
    except Exception:
        return 2


def replace_audio_in_video(
    video_path: str, audio_path: str, output_path: str
) -> bool:
    """Replace a video's audio track with a new audio file using FFmpeg."""
    # Detect mono audio (ElevenLabs STS can return mono) and convert to stereo
    channels = _probe_audio_channels(audio_path)
    pan_filter = "pan=stereo|FL=c0|FR=c0," if channels == 1 else ""
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", audio_path,
        "-filter_complex",
        f"[1:a]{pan_filter}apad=whole_dur={get_audio_duration(video_path) or 8}[aout]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-map", "0:v:0", "-map", "[aout]",
        output_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.error("FFmpeg replace error: %s", result.stderr[:200])
            return False
        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.error("FFmpeg error: %s", e)
        return False


def voice_change(
    audio_data: bytes,
    voice_id: str,
    api_key: str,
    model_id: str = STS_MODEL_ID,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
    seed: int | None = None,
    remove_background_noise: bool = False,
    voice_settings: str | None = None,
) -> bytes | None:
    """
    Transform audio using ElevenLabs Speech-to-Speech (Voice Changer) API.

    Args:
        audio_data: Source audio bytes (MP3)
        voice_id: Target voice ID
        api_key: ElevenLabs API key
        model_id: STS model ID
        output_format: Output audio format
        seed: Deterministic seed (0-4294967295). Same seed = same output.
        remove_background_noise: Clean audio before transformation.
        voice_settings: JSON string of voice settings (stability, similarity_boost, style).

    Returns:
        Transformed audio bytes on success, None on failure
    """
    from io import BytesIO

    import requests

    url = f"{ELEVENLABS_API_BASE}/v1/speech-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
    }
    files = {
        "audio": ("audio.mp3", BytesIO(audio_data), "audio/mpeg"),
    }
    data = {
        "model_id": model_id,
        "output_format": output_format,
    }
    if seed is not None:
        data["seed"] = str(seed)
    if remove_background_noise:
        data["remove_background_noise"] = "true"
    if voice_settings:
        data["voice_settings"] = voice_settings

    try:
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=120)
    except requests.exceptions.Timeout:
        logger.error("Voice Changer API timeout (120s)")
        return None

    if resp.status_code != 200:
        logger.error("Voice Changer API error: %d %s", resp.status_code, resp.text[:300])
        return None

    return resp.content


def voice_change_video(
    video_path: str,
    voice_id: str,
    api_key: str,
    output_path: str | None = None,
    model_id: str = STS_MODEL_ID,
    seed: int | None = None,
    remove_background_noise: bool = False,
    voice_settings: str | None = None,
) -> str | None:
    """
    Full pipeline: extract audio from video, transform voice, replace audio.

    Args:
        video_path: Path to source video with speech
        voice_id: Target ElevenLabs voice ID
        api_key: ElevenLabs API key
        output_path: Output video path (default: video_vc.mp4)
        model_id: STS model ID
        seed: Deterministic seed for reproducible output.
        remove_background_noise: Clean Veo background noise before transformation.
        voice_settings: JSON string of voice settings.

    Returns:
        Output video path on success, None on failure
    """
    import tempfile

    if not output_path:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_vc{ext}"

    temp_dir = tempfile.mkdtemp()
    extracted_audio = os.path.join(temp_dir, "extracted.mp3")
    transformed_audio = os.path.join(temp_dir, "transformed.mp3")

    # Step 1: Extract audio
    logger.info("Extracting audio from video...")
    if not extract_audio_from_video(video_path, extracted_audio):
        logger.error("Could not extract audio from %s", video_path)
        return None

    extracted_dur = get_audio_duration(extracted_audio)
    logger.info("Extracted: %.1fs", extracted_dur)

    # Step 2: Voice change via ElevenLabs STS
    logger.info("Transforming voice via ElevenLabs Speech-to-Speech...")
    with open(extracted_audio, "rb") as f:
        audio_bytes = f.read()

    transformed_bytes = voice_change(
        audio_data=audio_bytes,
        voice_id=voice_id,
        api_key=api_key,
        model_id=model_id,
        seed=seed,
        remove_background_noise=remove_background_noise,
        voice_settings=voice_settings,
    )

    if not transformed_bytes:
        logger.error("Voice change API returned no data")
        return None

    with open(transformed_audio, "wb") as f:
        f.write(transformed_bytes)

    transformed_dur = get_audio_duration(transformed_audio)
    logger.info("Transformed: %.1fs", transformed_dur)

    # Step 3: Replace audio in video
    logger.info("Replacing audio in video...")
    if not replace_audio_in_video(video_path, transformed_audio, output_path):
        logger.error("Could not replace audio in video")
        return None

    output_size = os.path.getsize(output_path) / 1024
    logger.info("Output: %s (%.0f KB)", output_path, output_size)

    # Cleanup temp files
    for f in [extracted_audio, transformed_audio]:
        if os.path.exists(f):
            os.remove(f)
    with contextlib.suppress(OSError):
        os.rmdir(temp_dir)

    return output_path


def run_voice_change(args: argparse.Namespace) -> None:
    """Run voice changer mode from CLI args."""
    api_key = get_api_key()
    voice_id = args.voice_id

    if not voice_id and args.voice_name:
        logger.info("Searching for voice: %s", args.voice_name)
        voice_id = find_voice_by_name(api_key, args.voice_name)
        if not voice_id:
            logger.error("Voice not found: %s", args.voice_name)
            sys.exit(1)
        logger.info("Found voice ID: %s", voice_id)

    if not voice_id:
        logger.error("--voice-id or --voice-name is required for voice change")
        sys.exit(1)

    # Collect video files to process
    videos = []

    if hasattr(args, "video") and args.video:
        # Single video mode
        if not os.path.exists(args.video):
            logger.error("Video not found: %s", args.video)
            sys.exit(1)
        videos.append(args.video)

    elif hasattr(args, "videos_dir") and args.videos_dir:
        # Batch mode - find scene videos
        vdir = args.videos_dir
        if not os.path.isdir(vdir):
            logger.error("Videos directory not found: %s", vdir)
            sys.exit(1)

        # Find all scene MP4 files
        import glob
        all_videos = sorted(glob.glob(os.path.join(vdir, "*scene_*.mp4")))

        # Filter to specific scenes if requested
        if args.scenes:
            scene_nums = {int(s.strip()) for s in args.scenes.split(",")}
            filtered = []
            for v in all_videos:
                basename = os.path.basename(v)
                for num in scene_nums:
                    if f"scene_{num}.mp4" in basename or f"scene_{num}_" in basename:
                        filtered.append(v)
                        break
            videos = filtered
        elif getattr(args, "skip_scenes", None):
            skip_nums = {int(s.strip()) for s in args.skip_scenes.split(",")}
            videos = []
            for v in all_videos:
                basename = os.path.basename(v)
                match = re.search(r"scene_(\d+)", basename)
                if match and int(match.group(1)) not in skip_nums:
                    videos.append(v)
        else:
            videos = all_videos

        # Exclude already voice-changed files
        videos = [v for v in videos if "_vc" not in os.path.basename(v)]

    if not videos:
        logger.error("No videos found to process.")
        sys.exit(1)

    # Dry-run
    if args.dry_run:
        logger.info("=" * 60)
        logger.info("DRY RUN - Voice Changer Preview")
        logger.info("=" * 60)
        logger.info("Voice ID: %s", voice_id)
        logger.info("Model: %s", getattr(args, 'sts_model_id', STS_MODEL_ID))
        logger.info("Videos to process: %d", len(videos))
        for v in videos:
            dur = get_audio_duration(v)
            logger.info("  %s (%.1fs)", os.path.basename(v), dur)
        logger.info("=" * 60)
        logger.info("Remove --dry-run to process.")
        logger.info("=" * 60)
        return

    # Confirmation
    logger.info("Voice Changer Plan:")
    logger.info("  Videos: %d", len(videos))
    logger.info("  Voice: %s", voice_id)
    logger.info("  Model: %s", getattr(args, 'sts_model_id', STS_MODEL_ID))

    if not args.yes:
        confirm = input("\nProceed? (y/n): ").strip().lower()
        if confirm not in ("y", "yes"):
            logger.info("Cancelled.")
            return

    # Process each video
    model_id = getattr(args, "sts_model_id", STS_MODEL_ID)
    seed = getattr(args, "seed", None)
    remove_bg = getattr(args, "remove_bg_noise", False)

    # Build voice_settings JSON if custom values provided
    vc_settings = None
    stability = getattr(args, "stability", DEFAULT_STABILITY)
    similarity = getattr(args, "similarity_boost", DEFAULT_SIMILARITY_BOOST)
    style = getattr(args, "style", 0.0)
    if stability != DEFAULT_STABILITY or similarity != DEFAULT_SIMILARITY_BOOST or style != 0.0:
        vc_settings = json.dumps({
            "stability": stability,
            "similarity_boost": similarity,
            "style": style,
        })

    results = []

    logger.info("Processing %d videos...", len(videos))

    for i, video_path in enumerate(videos, 1):
        basename = os.path.basename(video_path)
        output_path = getattr(args, "output", None) if len(videos) == 1 else None

        logger.info("[%d/%d] %s", i, len(videos), basename)

        result = voice_change_video(
            video_path=video_path,
            voice_id=voice_id,
            api_key=api_key,
            output_path=output_path,
            model_id=model_id,
            seed=seed,
            remove_background_noise=remove_bg,
            voice_settings=vc_settings,
        )

        if result:
            results.append(result)
            logger.info("  OK")
        else:
            logger.error("  FAILED")

    # Summary
    logger.info("=" * 60)
    logger.info("Voice Changer Complete")
    logger.info("=" * 60)
    logger.info("Processed: %d/%d", len(results), len(videos))
    for r in results:
        logger.info("  %s", r)
    logger.info("=" * 60)


# ============================================================
# Bake Narration Functions (Phase 5d)
# ============================================================


def get_video_duration(video_path: str) -> float:
    """Get video file duration in seconds using ffprobe."""
    return _ff.get_duration(video_path) or 0.0


def bake_narration_to_video(
    video_path: str,
    tts_path: str,
    output_path: str,
    target_duration: float | None = None,
    preserve_sfx: bool = True,
    tts_volume: float = 1.0,
    sfx_volume: float = 0.7,
) -> str | None:
    """
    Bake TTS narration onto a video by padding TTS with silence to match
    video duration, then mixing or replacing the video's audio track.

    Args:
        video_path: Path to source video
        tts_path: Path to TTS audio file (MP3)
        output_path: Output video path
        target_duration: Video duration (auto-detected if None)
        preserve_sfx: If True, mix TTS with video's existing audio (SFX).
                      If False, replace video audio with TTS only (old behavior).
        tts_volume: Volume level for TTS narration (0.0-2.0, default 1.0)
        sfx_volume: Volume level for video SFX audio (0.0-2.0, default 0.7)

    Returns:
        Output path on success, None on failure
    """
    import tempfile

    if target_duration is None:
        target_duration = get_video_duration(video_path)
    if target_duration <= 0:
        logger.error("Could not determine video duration for %s", video_path)
        return None

    tts_duration = get_audio_duration(tts_path)
    if tts_duration <= 0:
        logger.error("Could not determine TTS duration for %s", tts_path)
        return None

    temp_dir = tempfile.mkdtemp()
    padded_audio = os.path.join(temp_dir, "padded.aac")

    # Detect mono TTS (ElevenLabs voice-changed files can be mono) and convert
    # to stereo before concat with stereo anullsrc — mismatched channels break concat
    tts_channels = _probe_audio_channels(tts_path)
    pan_prefix = "pan=stereo|FL=c0|FR=c0," if tts_channels == 1 else ""

    # Step 1: Pad TTS with silence to match video duration using concat+atrim
    pad_cmd = [
        "ffmpeg", "-y",
        "-i", tts_path,
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-filter_complex",
        f"[0:a]{pan_prefix}aresample=44100[tts_s];[tts_s][1:a]concat=n=2:v=0:a=1[raw];[raw]atrim=0:{target_duration:.3f},asetpts=PTS-STARTPTS[aout]",
        "-map", "[aout]",
        "-c:a", "aac", "-b:a", "192k",
        padded_audio,
    ]

    try:
        result = subprocess.run(pad_cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.error("FFmpeg pad error: %s", result.stderr[:300])
            return None
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.error("FFmpeg error: %s", e)
        return None

    if preserve_sfx:
        # Step 2a: Mix padded TTS with video's existing audio (preserve SFX)
        logger.info("Mixing TTS (vol=%s) + video SFX (vol=%s)", tts_volume, sfx_volume)
        mux_cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", padded_audio,
            "-filter_complex",
            f"[0:a]volume={sfx_volume}[sfx];"
            f"[1:a]volume={tts_volume}[tts];"
            "[sfx][tts]amix=inputs=2:duration=shortest:dropout_transition=600[aout]",
            "-map", "0:v:0", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            output_path,
        ]
    else:
        # Step 2b: Replace video audio with TTS only (old behavior)
        mux_cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", padded_audio,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "aac",
            "-shortest",
            output_path,
        ]

    try:
        result = subprocess.run(mux_cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            logger.error("FFmpeg mux error: %s", result.stderr[:300])
            return None
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.error("FFmpeg error: %s", e)
        return None

    # Cleanup
    for f in [padded_audio]:
        if os.path.exists(f):
            os.remove(f)
    with contextlib.suppress(OSError):
        os.rmdir(temp_dir)

    if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
        return output_path
    return None


def _find_scene_videos(
    videos_dir: str,
    scenes: str | None = None,
    skip_scenes: str | None = None,
) -> list[dict[str, Any]]:
    """Find scene video files, optionally filtered by scene numbers.

    Args:
        videos_dir: Directory containing scene videos
        scenes: Comma-separated scene numbers to include (mutually exclusive with skip_scenes)
        skip_scenes: Comma-separated scene numbers to exclude (mutually exclusive with scenes)

    Returns list of dicts: {"scene_num": int, "path": str, "basename": str}
    """
    import glob

    all_videos = sorted(glob.glob(os.path.join(videos_dir, "*scene_*.mp4")))
    # Exclude already-processed files
    all_videos = [v for v in all_videos if "_vc" not in os.path.basename(v)
                  and "_narrated" not in os.path.basename(v)]

    scene_nums_filter = None
    if scenes:
        scene_nums_filter = {int(s.strip()) for s in scenes.split(",")}

    skip_nums = None
    if skip_scenes:
        skip_nums = {int(s.strip()) for s in skip_scenes.split(",")}

    results = []
    for v in all_videos:
        basename = os.path.basename(v)
        # Extract scene number from filename like run001_scene_3.mp4 or scene_3.mp4
        match = re.search(r"scene_(\d+)", basename)
        if not match:
            continue
        scene_num = int(match.group(1))
        if scene_nums_filter and scene_num not in scene_nums_filter:
            continue
        if skip_nums and scene_num in skip_nums:
            continue
        results.append({"scene_num": scene_num, "path": v, "basename": basename})

    return results


def _find_tts_file(tts_dir: str, scene_num: int, tts_pattern: str | None = None) -> str | None:
    """Find TTS audio file for a scene, checking multiple naming conventions.

    Args:
        tts_dir: Directory containing TTS files
        scene_num: Scene number to find
        tts_pattern: Custom filename pattern with {N} placeholder
                     (e.g. 'scene_{N}_combined.mp3')

    Returns:
        Path to existing TTS file, or None if not found
    """
    if tts_pattern:
        filename = tts_pattern.replace("{N}", str(scene_num))
        path = os.path.join(tts_dir, filename)
        if os.path.exists(path):
            return path
        return None

    # Check multiple patterns in order of preference
    patterns = [
        f"scene_{scene_num}_tts.mp3",       # Current default
        f"scene_{scene_num}_combined.mp3",   # Multi-voice workflow
        f"scene_{scene_num}.mp3",            # Simple fallback
    ]
    for pattern in patterns:
        path = os.path.join(tts_dir, pattern)
        if os.path.exists(path):
            return path
    return None


def _restore_backups_for_redo(videos_dir: str, scenes: str | None = None) -> int:
    """
    Restore original videos from backups/ before re-baking.

    Finds matching backup files, copies them over current files,
    and removes any _narrated variants.

    Args:
        videos_dir: Directory containing video files
        scenes: Comma-separated scene numbers (None = all)

    Returns:
        Number of files restored
    """
    import glob

    backup_dir = os.path.join(videos_dir, "backups")
    if not os.path.isdir(backup_dir):
        logger.warning("No backups/ directory found in %s", videos_dir)
        return 0

    scene_nums_filter = None
    if scenes:
        scene_nums_filter = {int(s.strip()) for s in scenes.split(",")}

    restored = 0
    backup_files = sorted(glob.glob(os.path.join(backup_dir, "*scene_*.mp4")))

    for backup_path in backup_files:
        basename = os.path.basename(backup_path)
        match = re.search(r"scene_(\d+)", basename)
        if not match:
            continue
        scene_num = int(match.group(1))
        if scene_nums_filter and scene_num not in scene_nums_filter:
            continue

        # Restore backup to videos dir
        target_path = os.path.join(videos_dir, basename)
        shutil.copy2(backup_path, target_path)
        logger.info("Restored: %s (from backups/)", basename)
        restored += 1

        # Remove _narrated variant if it exists
        base, ext = os.path.splitext(target_path)
        narrated_path = f"{base}_narrated{ext}"
        if os.path.exists(narrated_path):
            os.remove(narrated_path)
            logger.info("Removed: %s", os.path.basename(narrated_path))

    return restored


def run_conductor(args: argparse.Namespace) -> None:
    """Run conductor mode: generate master narration track with composition-aware timing."""
    from narration_conductor import (
        calculate_timeline,
        find_matching_files,
        generate_master_narration,
    )
    from config import (
        CONDUCTOR_DELAY_S,
        CONDUCTOR_GAP_S,
        CONDUCTOR_FADE_IN_S,
        CONDUCTOR_FADE_OUT_S,
        CONDUCTOR_MAX_SPEED,
    )

    videos_dir = args.videos_dir
    tts_dir = args.tts_dir

    if not videos_dir or not os.path.isdir(videos_dir):
        logger.error("--videos-dir is required and must be a valid directory")
        sys.exit(1)
    if not tts_dir or not os.path.isdir(tts_dir):
        logger.error("--tts-dir is required and must be a valid directory")
        sys.exit(1)

    # Parse conductor parameters
    delay = args.narration_delay if args.narration_delay is not None else CONDUCTOR_DELAY_S
    gap = args.narration_gap if args.narration_gap is not None else CONDUCTOR_GAP_S
    fade_in = args.narration_fade_in if args.narration_fade_in is not None else CONDUCTOR_FADE_IN_S
    fade_out = args.narration_fade_out if args.narration_fade_out is not None else CONDUCTOR_FADE_OUT_S

    max_speed = CONDUCTOR_MAX_SPEED
    if args.narration_speed == "none":
        max_speed = 1.0
    elif args.narration_speed != "auto":
        max_speed = float(args.narration_speed)

    # Find matching files
    videos, tts_files = find_matching_files(videos_dir, tts_dir)

    if not videos:
        logger.error("No matching video/TTS pairs found in %s and %s", videos_dir, tts_dir)
        sys.exit(1)

    logger.info("Found %d matched scene pairs", len(videos))
    for v, t in zip(videos, tts_files):
        logger.info("  %s <-> %s", os.path.basename(v), os.path.basename(t))

    # Dry-run mode
    if args.conductor_dry_run:
        from narration_conductor import get_video_duration as nc_get_video_duration
        from narration_conductor import get_audio_duration as nc_get_audio_duration

        video_durations = [nc_get_video_duration(v) for v in videos]
        tts_durations = [nc_get_audio_duration(t) for t in tts_files]
        timeline = calculate_timeline(
            video_durations, tts_durations,
            delay=delay, gap=gap, max_speed=max_speed,
        )
        print("\n=== Conductor Dry Run ===")
        for entry in timeline:
            print(
                f"  Scene {entry['scene']}: {entry['tts_duration']:.1f}s TTS "
                f"in {entry['available']:.1f}s window -> {entry['status']} "
                f"{entry.get('note', '')}"
            )
        print(f"\nTotal video: {sum(video_durations):.1f}s")
        return

    # Generate master narration
    output_path = os.path.join(tts_dir, "master_narration.mp3")
    report_path = os.path.join(tts_dir, "conductor_report.json")

    result = generate_master_narration(
        video_files=videos,
        tts_files=tts_files,
        output_path=output_path,
        report_path=report_path,
        delay=delay,
        gap=gap,
        fade_in=fade_in,
        fade_out=fade_out,
        max_speed=max_speed,
    )

    if result:
        logger.info("Master narration saved: %s (%.1fs)", output_path, result["total_duration"])
        logger.info("Report saved: %s", report_path)
    else:
        logger.error("Failed to generate master narration")
        sys.exit(1)


def run_bake_narration(args: argparse.Namespace) -> None:
    """Run bake-narration mode: overlay TTS audio per-scene onto videos."""
    videos_dir = args.videos_dir
    tts_dir = args.tts_dir

    if not videos_dir or not os.path.isdir(videos_dir):
        logger.error("Videos directory not found: %s", videos_dir)
        sys.exit(1)
    if not tts_dir or not os.path.isdir(tts_dir):
        logger.error("TTS directory not found: %s", tts_dir)
        sys.exit(1)

    # --redo: restore originals from backups before re-baking
    redo = getattr(args, "redo", False)
    if redo:
        logger.info("=" * 60)
        logger.info("REDO MODE - Restoring originals from backups")
        logger.info("=" * 60)
        restored = _restore_backups_for_redo(videos_dir, getattr(args, "scenes", None))
        if restored == 0:
            logger.info("No backups found to restore. Proceeding with current files.")
        else:
            logger.info("Restored %d file(s)", restored)
        logger.info("=" * 60)

    # Get preserve_sfx and volume settings from args
    preserve_sfx = getattr(args, "preserve_sfx", True)
    tts_volume = getattr(args, "tts_volume", 1.0)
    sfx_volume = getattr(args, "sfx_volume", 0.7)
    extend_video = getattr(args, "extend_video", False)
    auto_loop = getattr(args, "auto_loop", False)

    # Find scene videos
    scene_videos = _find_scene_videos(
        videos_dir,
        scenes=getattr(args, "scenes", None),
        skip_scenes=getattr(args, "skip_scenes", None),
    )
    if not scene_videos:
        logger.error("No scene videos found to process.")
        sys.exit(1)

    # Match videos with TTS files
    tts_pattern = getattr(args, "tts_pattern", None)
    matched = []
    for sv in scene_videos:
        tts_file = _find_tts_file(tts_dir, sv['scene_num'], tts_pattern)
        if tts_file:
            matched.append({**sv, "tts_path": tts_file})
        else:
            patterns = [tts_pattern.replace("{N}", str(sv['scene_num']))] if tts_pattern else [
                f"scene_{sv['scene_num']}_tts.mp3",
                f"scene_{sv['scene_num']}_combined.mp3",
                f"scene_{sv['scene_num']}.mp3",
            ]
            logger.warning("No TTS file for scene %d (checked: %s)", sv['scene_num'], ', '.join(patterns))

    if not matched:
        logger.error("No matching video+TTS pairs found.")
        sys.exit(1)

    # Dry-run
    if args.dry_run:
        logger.info("=" * 60)
        logger.info("DRY RUN - Bake Narration Preview")
        logger.info("=" * 60)
        logger.info("Videos dir: %s", videos_dir)
        logger.info("TTS dir: %s", tts_dir)
        sfx_mode = f"preserve SFX (tts={tts_volume}, sfx={sfx_volume})" if preserve_sfx else "replace audio"
        logger.info("Audio mode: %s", sfx_mode)
        logger.info("Scenes to process: %d", len(matched))
        for m in matched:
            video_dur = get_video_duration(m["path"])
            tts_dur = get_audio_duration(m["tts_path"])
            logger.info("  Scene %d: video=%.1fs, TTS=%.1fs", m['scene_num'], video_dur, tts_dur)
            if tts_dur > video_dur:
                overshoot = tts_dur - video_dur
                logger.warning("    TTS exceeds video by %.1fs", overshoot)
                if getattr(args, "extend_video", False):
                    logger.info("    -> Will extend video (freeze last frame)")
            base, ext = os.path.splitext(m["basename"])
            logger.info("    -> %s_narrated%s", base, ext)
        logger.info("=" * 60)
        logger.info("Remove --dry-run to process.")
        logger.info("=" * 60)
        return

    # Confirmation
    logger.info("Bake Narration Plan:")
    logger.info("  Videos: %d scenes", len(matched))
    logger.info("  TTS dir: %s", tts_dir)
    sfx_mode = f"preserve SFX (tts={tts_volume}, sfx={sfx_volume})" if preserve_sfx else "replace audio"
    logger.info("  Audio mode: %s", sfx_mode)

    if not args.yes:
        confirm = input("\nProceed? (y/n): ").strip().lower()
        if confirm not in ("y", "yes"):
            logger.info("Cancelled.")
            return

    # Pre-check: warn about TTS overshoots before encoding starts
    overshoot_scenes = []
    for m in matched:
        video_dur = get_video_duration(m["path"])
        tts_dur = get_audio_duration(m["tts_path"])
        if video_dur and tts_dur and tts_dur > video_dur:
            overshoot_scenes.append({
                "scene_num": m["scene_num"],
                "tts_dur": tts_dur,
                "video_dur": video_dur,
                "overshoot": tts_dur - video_dur,
            })
    if overshoot_scenes and not extend_video:
        logger.warning("=" * 60)
        logger.warning(
            "TTS exceeds video duration in %d scene(s):", len(overshoot_scenes)
        )
        for ov in overshoot_scenes:
            logger.warning(
                "  Scene %d: TTS=%.1fs, Video=%.1fs (overshoot: %.1fs)",
                ov["scene_num"], ov["tts_dur"], ov["video_dur"], ov["overshoot"],
            )
        logger.warning("")
        logger.warning("Options:")
        logger.warning(
            "  --extend-video    Freeze last frame to match TTS duration"
        )
        logger.warning(
            "  Edit transcript   Shorten text to fit within video duration"
            " (~20-25 words per 8s)"
        )
        logger.warning("")
        logger.warning("Proceeding with truncated narration...")
        logger.warning("=" * 60)

    # Process each scene
    results = []
    logger.info("Baking narration for %d scenes...", len(matched))

    for i, m in enumerate(matched, 1):
        base, ext = os.path.splitext(m["path"])
        output_path = f"{base}_narrated{ext}"

        logger.info("[%d/%d] Scene %d", i, len(matched), m['scene_num'])
        video_dur = get_video_duration(m["path"])
        tts_dur = get_audio_duration(m["tts_path"])
        logger.info("  Video: %.1fs, TTS: %.1fs", video_dur, tts_dur)

        # Warn if TTS exceeds video duration
        if tts_dur > video_dur:
            overshoot = tts_dur - video_dur
            logger.warning("TTS (%.1fs) exceeds video (%.1fs) by %.1fs - narration will be truncated", tts_dur, video_dur, overshoot)

        # Auto-loop or extend video if TTS exceeds video duration
        video_for_bake = m["path"]
        extended_path = None
        if auto_loop and tts_dur > video_dur:
            loop_dur = int(tts_dur) + 1
            logger.info("Auto-looping video to %ds (seamless F2V loop)...", loop_dur)
            looped_path = f"{base}_looped{ext}"
            loop_cmd = [
                "ffmpeg", "-y",
                "-stream_loop", "-1",
                "-i", m["path"],
                "-t", str(loop_dur),
                "-c", "copy",
                looped_path,
            ]
            try:
                result_loop = subprocess.run(loop_cmd, capture_output=True, text=True, timeout=60)
                if result_loop.returncode == 0 and os.path.exists(looped_path):
                    video_for_bake = looped_path
                    new_dur = get_video_duration(looped_path)
                    logger.info("Looped: %.1fs -> %.1fs", video_dur, new_dur)
                    video_dur = new_dur
                    extended_path = looped_path  # for cleanup
                else:
                    logger.warning("Failed to loop video, using original. Error: %s", result_loop.stderr[:200])
            except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                logger.warning("Failed to loop video: %s", e)
        elif extend_video and tts_dur > video_dur:
            extension = tts_dur - video_dur
            logger.info("Extending video by %.1fs (freeze last frame)...", extension)
            extended_path = f"{base}_extended{ext}"
            extend_cmd = [
                "ffmpeg", "-y",
                "-i", m["path"],
                "-vf", f"tpad=stop_mode=clone:stop_duration={extension:.3f}",
                "-c:v", "libx264", "-preset", "fast",
                "-c:a", "copy",
                extended_path,
            ]
            try:
                result_ext = subprocess.run(extend_cmd, capture_output=True, text=True, timeout=120)
                if result_ext.returncode == 0 and os.path.exists(extended_path):
                    video_for_bake = extended_path
                    new_dur = get_video_duration(extended_path)
                    logger.info("Extended: %.1fs -> %.1fs", video_dur, new_dur)
                    video_dur = new_dur
                else:
                    logger.warning("Failed to extend video, using original. Error: %s", result_ext.stderr[:200])
                    extended_path = None
            except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                logger.warning("Failed to extend video: %s", e)
                extended_path = None

        result = bake_narration_to_video(
            video_path=video_for_bake,
            tts_path=m["tts_path"],
            output_path=output_path,
            target_duration=video_dur,
            preserve_sfx=preserve_sfx,
            tts_volume=tts_volume,
            sfx_volume=sfx_volume,
        )

        # Clean up extended video temp file
        if extended_path and os.path.exists(extended_path):
            os.remove(extended_path)

        if result:
            output_size = os.path.getsize(result) / 1024
            logger.info("OK: %s (%.0f KB)", os.path.basename(result), output_size)
            results.append(result)
        else:
            logger.error("FAILED")

    # Summary
    logger.info("=" * 60)
    logger.info("Bake Narration Complete")
    logger.info("=" * 60)
    logger.info("Processed: %d/%d", len(results), len(matched))
    for r in results:
        logger.info("  %s", os.path.basename(r))
    logger.info("=" * 60)


# ============================================================
# Swap Processed Files (Phase 5e)
# ============================================================


def swap_processed_files(
    videos_dir: str,
    scenes: str | None = None,
    dry_run: bool = False,
) -> list[str]:
    """
    Swap processed files (_vc, _narrated) to primary filenames.
    Backs up originals to backups/ subfolder.

    Priority: _vc files for presenter scenes, _narrated for B-roll.

    Args:
        videos_dir: Directory containing video files
        scenes: Comma-separated scene numbers (None = all)
        dry_run: Preview without executing

    Returns:
        List of swapped file paths
    """
    import glob

    backup_dir = os.path.join(videos_dir, "backups")
    scene_nums_filter = None
    if scenes:
        scene_nums_filter = {int(s.strip()) for s in scenes.split(",")}

    # Find all processed files
    all_files = sorted(glob.glob(os.path.join(videos_dir, "*scene_*.mp4")))

    # Group by scene number
    scene_files: dict[int, dict] = {}
    for f in all_files:
        basename = os.path.basename(f)
        match = re.search(r"scene_(\d+)", basename)
        if not match:
            continue
        scene_num = int(match.group(1))
        if scene_nums_filter and scene_num not in scene_nums_filter:
            continue

        if scene_num not in scene_files:
            scene_files[scene_num] = {"original": None, "vc": None, "narrated": None}

        if "_vc" in basename and "_narrated" not in basename:
            scene_files[scene_num]["vc"] = f
        elif "_narrated" in basename:
            scene_files[scene_num]["narrated"] = f
        elif "_vc" not in basename and "_narrated" not in basename:
            scene_files[scene_num]["original"] = f

    swapped = []
    swap_plan = []

    for scene_num in sorted(scene_files.keys()):
        files = scene_files[scene_num]
        original = files["original"]
        # Priority: _vc first, then _narrated
        processed = files["vc"] or files["narrated"]

        if not processed or not original:
            continue

        swap_plan.append({
            "scene_num": scene_num,
            "original": original,
            "processed": processed,
            "type": "voice-changed" if files["vc"] else "narrated",
        })

    if dry_run or not swap_plan:
        logger.info("=" * 60)
        logger.info("Swap Plan%s", " (DRY RUN)" if dry_run else "")
        logger.info("=" * 60)
        if not swap_plan:
            logger.info("No files to swap.")
        for sp in swap_plan:
            logger.info("Scene %d (%s):", sp['scene_num'], sp['type'])
            logger.info("  %s -> backups/", os.path.basename(sp['original']))
            logger.info("  %s -> %s", os.path.basename(sp['processed']), os.path.basename(sp['original']))
        logger.info("=" * 60)
        if dry_run:
            return []

    if not swap_plan:
        return []

    # Execute swaps
    os.makedirs(backup_dir, exist_ok=True)

    for sp in swap_plan:
        original = sp["original"]
        processed = sp["processed"]
        original_basename = os.path.basename(original)
        backup_path = os.path.join(backup_dir, original_basename)

        try:
            # Move original to backup
            os.rename(original, backup_path)
            # Rename processed to original name
            os.rename(processed, original)
            logger.info("Scene %d: swapped (%s)", sp['scene_num'], sp['type'])
            swapped.append(original)
        except OSError as e:
            logger.error("Scene %d: FAILED - %s", sp['scene_num'], e)

    return swapped


def run_swap(args: argparse.Namespace) -> None:
    """Run swap mode: rename processed files to primary filenames."""
    videos_dir = args.videos_dir
    if not videos_dir or not os.path.isdir(videos_dir):
        logger.error("Videos directory not found: %s", videos_dir)
        sys.exit(1)

    scenes = getattr(args, "scenes", None)

    if args.dry_run:
        swap_processed_files(videos_dir, scenes, dry_run=True)
        return

    # Confirmation
    logger.info("Swap Plan:")
    swap_processed_files(videos_dir, scenes, dry_run=True)

    if not args.yes:
        confirm = input("Proceed with swap? (y/n): ").strip().lower()
        if confirm not in ("y", "yes"):
            logger.info("Cancelled.")
            return

    results = swap_processed_files(videos_dir, scenes, dry_run=False)

    logger.info("=" * 60)
    logger.info("Swap Complete")
    logger.info("=" * 60)
    logger.info("Swapped: %d files", len(results))
    logger.info("Backups: %s/", os.path.join(videos_dir, 'backups'))
    logger.info("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate narration audio using ElevenLabs TTS or Voice Changer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List voices
  python generate_tts.py --list-voices

  # Dry-run preview
  python generate_tts.py --transcript transcript.json --output-dir audio/tts --dry-run

  # Generate with voice name
  python generate_tts.py --transcript transcript.json --output-dir audio/tts \\
    --voice-name "Rachel" --pad-to-duration

  # Generate with edited text
  python generate_tts.py --transcript transcript.json --output-dir audio/tts \\
    --voice-name "Rachel" --edit editable_transcript.json

  # Specific scenes only
  python generate_tts.py --transcript transcript.json --output-dir audio/tts \\
    --voice-name "Rachel" --scenes 1,3,5
        """,
    )

    # Input
    parser.add_argument("--transcript", help="Path to transcript JSON (from Phase 1.5T)")
    parser.add_argument("--output-dir", help="Directory for per-scene audio files")
    parser.add_argument("--combined-output", help="Path for combined narration track (auto if omitted)")

    # Voice selection
    parser.add_argument("--voice-id", help="ElevenLabs voice ID")
    parser.add_argument("--voice-name", help="Search voice by name (e.g., 'Rachel')")
    parser.add_argument("--voice-map",
                       help='Multi-voice: JSON mapping speaker names to voice names/IDs '
                            '(e.g. \'{"narrator":"Daniel","Ram":"Leo","Meera":"Anika"}\')')
    parser.add_argument("--auto-voice-map", action="store_true",
                       help="Auto-assign default voices to detected speakers "
                            "(male=Daniel, female=Rachel, narrator=Adam)")

    # Model and settings
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID,
                       help=f"ElevenLabs model (default: {DEFAULT_MODEL_ID})")
    parser.add_argument("--stability", type=float, default=DEFAULT_STABILITY,
                       help=f"Voice stability 0.0-1.0 (default: {DEFAULT_STABILITY})")
    parser.add_argument("--similarity-boost", type=float, default=DEFAULT_SIMILARITY_BOOST,
                       help=f"Voice similarity 0.0-1.0 (default: {DEFAULT_SIMILARITY_BOOST})")
    parser.add_argument("--format", dest="output_format", default=DEFAULT_OUTPUT_FORMAT,
                       help=f"Audio output format (default: {DEFAULT_OUTPUT_FORMAT})")

    # Scene selection
    scene_selection = parser.add_mutually_exclusive_group()
    scene_selection.add_argument("--scenes", help="Comma-separated scene numbers to include (default: all)")
    scene_selection.add_argument("--skip-scenes", help="Comma-separated scene numbers to exclude")
    parser.add_argument("--edit", help="Path to edited transcript JSON")

    # Behavior flags
    parser.add_argument("--pad-to-duration", action="store_true",
                       help="Pad scene audio with silence to match video duration")
    parser.add_argument("--sync-to-slides",
                       help="Path to slides.json — pad each scene's TTS to match slide duration, "
                            "then concatenate into narration_synced.mp3")
    parser.add_argument("--list-voices", action="store_true", help="List voices and exit")
    parser.add_argument("--list-models", action="store_true", help="List models and exit")
    parser.add_argument("--dry-run", action="store_true", help="Preview without calling API")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")

    # Voice settings (extended)
    parser.add_argument("--style", type=float, default=0.0,
                       help="Style exaggeration 0.0-1.0 (default: 0). Higher = more dramatic/emotional.")
    parser.add_argument("--speed", type=float, default=1.0,
                       help="Speech speed (default: 1.0). <1.0 slower, >1.0 faster.")
    parser.add_argument("--speaker-boost", action="store_true", default=True,
                       help="Boost similarity to original voice (default: True)")
    parser.add_argument("--no-speaker-boost", action="store_true",
                       help="Disable speaker boost")

    # TTS enhancements
    parser.add_argument("--dialogue", action="store_true",
                       help="Use Eleven v3 dialogue endpoint for emotional tags in text")
    parser.add_argument("--with-timestamps", action="store_true",
                       help="Use timestamps API for character-level timing data (saves alignment JSON)")

    # Voice selection enhancements
    parser.add_argument("--my-voices", action="store_true",
                       help="List only your saved/personal voices")

    # Voice Changer mode
    parser.add_argument("--voice-change", action="store_true",
                       help="Voice Changer mode: transform video speech to consistent voice via ElevenLabs STS")
    parser.add_argument("--video", help="Single video file to voice-change")
    parser.add_argument("--videos-dir", help="Directory of scene videos (batch mode)")
    parser.add_argument("--output", help="Output path for voice-changed video (single mode only)")
    parser.add_argument("--sts-model-id", default=STS_MODEL_ID,
                       help=f"Speech-to-Speech model (default: {STS_MODEL_ID})")
    parser.add_argument("--seed", type=int, default=None,
                       help="Seed for deterministic voice change (0-4294967295)")
    parser.add_argument("--remove-bg-noise", action="store_true",
                       help="Remove background noise before voice change")

    # Bake Narration mode
    parser.add_argument("--bake-narration", action="store_true",
                       help="Bake TTS narration onto B-roll scene videos (Phase 5d)")
    parser.add_argument("--tts-dir",
                       help="Directory containing per-scene TTS files (scene_N_tts.mp3)")
    parser.add_argument("--preserve-sfx", action="store_true", default=True,
                       help="Mix TTS with video's existing audio/SFX (default: True)")
    parser.add_argument("--no-preserve-sfx", action="store_true",
                       help="Replace video audio with TTS only (old behavior)")
    parser.add_argument("--tts-volume", type=float, default=1.0,
                       help="TTS narration volume when mixing with SFX (0.0-2.0, default: 1.0)")
    parser.add_argument("--sfx-volume", type=float, default=0.7,
                       help="Video SFX volume when mixing with TTS (0.0-2.0, default: 0.7)")
    parser.add_argument("--redo", action="store_true",
                       help="Restore originals from backups/ before re-baking (use with --bake-narration)")
    parser.add_argument("--extend-video", action="store_true",
                       help="Extend video to match TTS duration when TTS is longer (freeze last frame)")
    parser.add_argument("--auto-loop", action="store_true",
                       help="Loop F2V-loop videos to match TTS duration when TTS is longer (seamless, no freeze)")
    parser.add_argument("--tts-pattern",
                       help="Custom TTS filename pattern with {N} placeholder (e.g. 'scene_{N}_combined.mp3')")

    # Conductor mode (composition-aware narration timing)
    parser.add_argument("--conductor", action="store_true",
                       help="Generate master narration track with composition-aware timing "
                            "(delays, gaps, fades, speed adjustment)")
    parser.add_argument("--narration-delay", type=float, default=None,
                       help="Delay before narration in each scene (default: 0.5s)")
    parser.add_argument("--narration-gap", type=float, default=None,
                       help="Gap between scenes (default: 0.3s)")
    parser.add_argument("--narration-fade-in", type=float, default=None,
                       help="Fade-in duration per segment (default: 0.15s)")
    parser.add_argument("--narration-fade-out", type=float, default=None,
                       help="Fade-out duration per segment (default: 0.25s)")
    parser.add_argument("--narration-speed", default="auto",
                       help="Speed mode: auto (max 1.15x), none, or float")
    parser.add_argument("--conductor-dry-run", action="store_true",
                       help="Show conductor timing plan without generating")

    # Swap mode
    parser.add_argument("--swap", action="store_true",
                       help="Swap processed files (_vc, _narrated) to primary filenames (Phase 5e)")

    # Multi-language translation (v2.28)
    parser.add_argument("--translate",
                       help="Translate text before TTS generation (language code: hi, es, fr, etc.)")
    parser.add_argument("--translation-model", default=GEMINI_DEFAULT_MODEL,
                       help=f"Gemini model for translation (default: {GEMINI_DEFAULT_MODEL})")
    parser.add_argument("--list-languages", action="store_true",
                       help="List supported languages and exit")

    # Audio normalization (v2.28)
    parser.add_argument("--normalize", action="store_true",
                       help="Normalize audio to -16 LUFS (EBU R128 standard) after generation")
    parser.add_argument("--loudness-target", type=float, default=-16.0,
                       help="Target loudness in LUFS for normalization (default: -16.0)")

    # TTS preview mode (v2.28)
    parser.add_argument("--preview-scene", type=int,
                       help="Generate and play single scene for testing before full generation")

    # Audio presets (v2.28)
    parser.add_argument("--preset", choices=list(AUDIO_PRESETS.keys()),
                       help="Use named audio preset for bake-narration "
                            "(kids-narrated, presenter, narrated, documentary)")
    parser.add_argument("--list-presets", action="store_true",
                       help="List available audio presets and exit")

    # Voice Design delegation (v2.28)
    parser.add_argument("--design-voice", action="store_true",
                       help="Launch Voice Design mode (delegates to voice_designer.py)")

    # Transcript variant management (v2.39)
    parser.add_argument("--variant",
                       help="Transcript variant name (e.g. 'comedy', 'serious'). "
                            "Auto-namespaces output dir to audio/tts_{variant}/, "
                            "editable transcript to editable_transcript_{variant}.json, "
                            "and combined narration to narration_{variant}.mp3")

    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Re-initialize logger with verbose flag if requested
    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    # --- Voice Design delegation (early exit) ---
    if args.design_voice:
        # Delegate to voice_designer.py, passing through remaining args
        from voice_designer import main as voice_designer_main
        sys.exit(voice_designer_main())

    # Handle --no-speaker-boost
    if args.no_speaker_boost:
        args.speaker_boost = False

    # Handle --no-preserve-sfx
    if args.no_preserve_sfx:
        args.preserve_sfx = False

    # Apply audio preset values if specified
    if args.preset:
        preset = AUDIO_PRESETS[args.preset]
        # Only override if not explicitly set via CLI
        if not any(arg.startswith("--tts-volume") for arg in sys.argv):
            args.tts_volume = preset["tts_volume"]
        if not any(arg.startswith("--sfx-volume") for arg in sys.argv):
            args.sfx_volume = preset["sfx_volume"]

    # --- Variant namespace (v2.39) ---
    # Auto-namespace output directory when --variant is set
    if args.variant:
        variant = args.variant.strip()
        if args.output_dir:
            # If --output-dir explicitly provided, append _{variant} to base name
            # e.g. "audio/tts" -> "audio/tts_comedy"
            # But only if it doesn't already end with the variant suffix
            if not args.output_dir.rstrip("/").endswith(f"_{variant}"):
                base = args.output_dir.rstrip("/")
                args.output_dir = f"{base}_{variant}"
        # If --combined-output not explicitly set, it will be auto-derived later
        # with variant suffix in the narration filename
        logger.info("Variant: %s → output dir: %s", variant, args.output_dir or "(not set)")

    # --- List languages ---
    if args.list_languages:
        print(f"\nSupported languages for translation ({len(SUPPORTED_LANGUAGES)}):\n")
        print(f"{'Code':<8} {'Language'}")
        print("-" * 30)
        for code, name in sorted(SUPPORTED_LANGUAGES.items(), key=lambda x: x[1]):
            print(f"{code:<8} {name}")
        print("\nUsage: --translate hi (for Hindi)")
        return

    # --- List presets ---
    if args.list_presets:
        print("\nAudio Presets for --bake-narration:\n")
        print(f"{'Preset':<15} {'TTS Vol':<10} {'SFX Vol':<10} {'Description'}")
        print("-" * 70)
        for name, preset in AUDIO_PRESETS.items():
            print(f"{name:<15} {preset['tts_volume']:<10.1f} {preset['sfx_volume']:<10.1f} {preset['description']}")
        print("\nUsage: --bake-narration --preset kids-narrated")
        return

    # --- List voices ---
    if args.list_voices or args.my_voices:
        api_key = get_api_key()

        if args.my_voices:
            voices = list_my_voices(api_key)
            if not voices:
                print("No saved/personal voices found (or API error)")
                sys.exit(1)
            print(f"\n=== My Voices ({len(voices)}) ===\n")
            print(f"{'Name':<25} {'Voice ID':<25} {'Labels'}")
            print("-" * 70)
            for v in sorted(voices, key=lambda x: x.get("name", "")):
                name = v.get("name", "?")
                vid = v.get("voice_id", "?")
                labels = v.get("labels", {})
                label_str = ", ".join(f"{k}={val}" for k, val in labels.items()) if labels else ""
                print(f"{name:<25} {vid:<25} {label_str}")
            return

        # Full voice listing grouped by category
        voices = list_voices(api_key)
        if not voices:
            print("No voices found (or API error)")
            sys.exit(1)

        # Group by category
        groups: dict[str, list] = {}
        for v in voices:
            cat = v.get("category", "unknown")
            groups.setdefault(cat, []).append(v)

        # Print saved/personal first, then others
        priority_order = ["saved", "personal", "cloned", "premade", "professional", "generated"]
        printed_cats = set()

        for cat in priority_order:
            if cat in groups:
                print(f"\n=== {cat.title()} Voices ({len(groups[cat])}) ===\n")
                print(f"{'Name':<25} {'Voice ID':<25} {'Labels'}")
                print("-" * 70)
                for v in sorted(groups[cat], key=lambda x: x.get("name", "")):
                    name = v.get("name", "?")
                    vid = v.get("voice_id", "?")
                    labels = v.get("labels", {})
                    label_str = ", ".join(f"{k}={val}" for k, val in labels.items()) if labels else ""
                    print(f"{name:<25} {vid:<25} {label_str}")
                printed_cats.add(cat)

        # Print remaining categories
        for cat, cat_voices in sorted(groups.items()):
            if cat not in printed_cats:
                print(f"\n=== {cat.title()} Voices ({len(cat_voices)}) ===\n")
                print(f"{'Name':<25} {'Voice ID':<25} {'Labels'}")
                print("-" * 70)
                for v in sorted(cat_voices, key=lambda x: x.get("name", "")):
                    name = v.get("name", "?")
                    vid = v.get("voice_id", "?")
                    labels = v.get("labels", {})
                    label_str = ", ".join(f"{k}={val}" for k, val in labels.items()) if labels else ""
                    print(f"{name:<25} {vid:<25} {label_str}")

        print(f"\nTotal: {len(voices)} voices")
        return

    # --- List models ---
    if args.list_models:
        api_key = get_api_key()
        models = list_models(api_key)
        if not models:
            print("No models found (or API error)")
            sys.exit(1)
        print(f"\nAvailable models ({len(models)}):\n")
        print(f"{'Model ID':<35} {'Name':<30} {'Can TTS'}")
        print("-" * 75)
        for m in models:
            mid = m.get("model_id", "?")
            name = m.get("name", "?")
            can_tts = m.get("can_do_text_to_speech", False)
            marker = "Yes" if can_tts else "No"
            print(f"{mid:<35} {name:<30} {marker}")
        return

    # --- Voice Changer mode ---
    if args.voice_change:
        run_voice_change(args)
        return

    # --- Conductor mode ---
    if args.conductor:
        run_conductor(args)
        return

    # --- Bake Narration mode ---
    if args.bake_narration:
        run_bake_narration(args)
        return

    # --- Swap mode ---
    if args.swap:
        run_swap(args)
        return

    # --- Validate required args for TTS generation ---
    if not args.transcript and not args.edit:
        logger.error("--transcript or --edit is required (unless using --list-voices/--list-models/--voice-change)")
        sys.exit(1)

    if not args.output_dir:
        logger.error("--output-dir is required")
        sys.exit(1)

    # Load edits if provided
    edits = None
    if args.edit:
        if not os.path.exists(args.edit):
            logger.error("Edit file not found: %s", args.edit)
            sys.exit(1)
        edits = load_edited_transcript(args.edit)
        logger.info("Loaded %d scene edits from: %s", len(edits), args.edit)

    # Load transcript — or build scaffold from edit file if --transcript not given
    if args.transcript:
        if not os.path.exists(args.transcript):
            logger.error("Transcript not found: %s", args.transcript)
            sys.exit(1)
        transcript = load_transcript(args.transcript)
    elif edits:
        # Build scaffold transcript from edit file scene keys
        logger.info("No --transcript provided; building scaffold from --edit file")
        scene_transcripts = []
        for scene_num in sorted(edits.keys()):
            scene_transcripts.append({
                "scene_number": scene_num,
                "text": edits[scene_num],
                "has_speech": bool(edits[scene_num].strip()),
            })
        transcript = {
            "transcript": {
                "full_text": " ".join(edits[s] for s in sorted(edits.keys()) if edits[s].strip()),
            },
            "scene_transcripts": scene_transcripts,
        }
    else:
        logger.error("--transcript or --edit is required")
        sys.exit(1)

    # --- Auto-detect multi-speaker transcripts ---
    # Detect from both transcript and edits data
    speakers = detect_speakers(transcript)
    if not speakers and edits:
        # Also check edits (editable_transcript format)
        speakers_from_edits: set[str] = set()
        for _key, text in edits.items():
            if isinstance(text, list):
                for segment in text:
                    if isinstance(segment, dict) and "speaker" in segment:
                        speakers_from_edits.add(segment["speaker"])
        speakers = sorted(speakers_from_edits)

    if speakers and getattr(args, 'auto_voice_map', False) and not getattr(args, 'voice_map', None):
        # Auto-assign default voices
        default_voices = {
            "narrator": "Adam",
            "default": "Daniel",  # fallback
        }
        auto_map = {}
        for speaker in speakers:
            lower = speaker.lower()
            if lower in default_voices:
                auto_map[speaker] = default_voices[lower]
            else:
                auto_map[speaker] = default_voices["default"]

        logger.info("Auto-assigned voice map: %s", json.dumps(auto_map))
        args.voice_map = json.dumps(auto_map)

    if speakers and not getattr(args, 'voice_map', None):
        logger.warning("=" * 60)
        logger.warning("MULTI-SPEAKER TRANSCRIPT DETECTED")
        logger.warning("=" * 60)
        logger.warning("Found %d speakers: %s", len(speakers), ", ".join(speakers))
        logger.warning("")
        logger.warning("To assign different voices per speaker, use:")
        logger.warning('  --voice-map \'{"' + '":"VoiceID","'.join(speakers) + '":"VoiceID"}\'')
        logger.warning("")
        logger.warning("Or auto-assign defaults: --auto-voice-map")
        logger.warning("To list available voices: --list-voices or --my-voices")
        logger.warning("Without --voice-map, all speakers will use the same voice.")
        logger.warning("=" * 60)

    # --- Dry run ---
    if args.dry_run:
        dry_run(transcript, edits, args.voice_id, args.model_id, args.output_dir,
               variant=getattr(args, "variant", None))
        return

    # --- Resolve voice ---
    api_key = get_api_key()
    voice_id = args.voice_id
    voice_map = None

    # Multi-voice mode: resolve voice map
    if args.voice_map:
        logger.info("Resolving multi-voice map...")
        voice_map = resolve_voice_map(args.voice_map, api_key)
        if not voice_map:
            logger.error("No voices resolved from --voice-map")
            sys.exit(1)
        logger.info("Resolved %d speaker(s)", len(voice_map))
        # Use first voice as default for single-voice scenes
        if not voice_id and not args.voice_name:
            voice_id = next(iter(voice_map.values()))

    if not voice_id and args.voice_name:
        logger.info("Searching for voice: %s", args.voice_name)
        voice_id = find_voice_by_name(api_key, args.voice_name)
        if not voice_id:
            logger.error("Voice not found: %s", args.voice_name)
            logger.error("Use --list-voices to see available voices")
            sys.exit(1)
        logger.info("Found voice ID: %s", voice_id)

    if not voice_id:
        logger.error("Either --voice-id, --voice-name, or --voice-map is required")
        sys.exit(1)

    # Get scene texts (with skip_scenes filtering at source)
    skip_set = None
    if getattr(args, "skip_scenes", None):
        skip_set = {int(s.strip()) for s in args.skip_scenes.split(",")}
    scene_texts = get_scene_texts(transcript, edits, skip_scenes=skip_set)

    # Filter to specific scenes if requested
    if args.scenes:
        scene_nums = {int(s.strip()) for s in args.scenes.split(",")}
        scene_texts = [s for s in scene_texts if s["scene_number"] in scene_nums]

    # Translate if requested (v2.28)
    if args.translate:
        lang_name = SUPPORTED_LANGUAGES.get(args.translate, args.translate)
        logger.info("=" * 60)
        logger.info("Translation: %s", lang_name)
        logger.info("=" * 60)

        scene_texts = translate_transcript(
            scene_texts,
            args.translate,
            model_id=args.translation_model,
            verbose=True,
        )

        # Save translated transcript
        translated_path = os.path.join(
            args.output_dir,
            f"editable_transcript_{args.translate}.json"
        )
        os.makedirs(args.output_dir, exist_ok=True)
        translated_editable = {
            "_instructions": f"Translated to {lang_name}. Edit 'text' fields as needed.",
            "_language": args.translate,
            "scenes": {str(s["scene_number"]): s["text"] for s in scene_texts},
        }
        with open(translated_path, "w", encoding="utf-8") as f:
            json.dump(translated_editable, f, indent=2, ensure_ascii=False)
        logger.info("Translated transcript saved: %s", translated_path)
        logger.info("=" * 60)

    # Filter out empty scenes (handle both str and list formats)
    def _scene_has_text(s: dict[str, Any]) -> bool:
        text = s["text"]
        if isinstance(text, list):
            return any(seg.get("text", "").strip() for seg in text)
        return bool(text.strip()) if isinstance(text, str) else False

    scenes_with_text = [s for s in scene_texts if _scene_has_text(s)]

    if not scenes_with_text:
        logger.warning("No scenes with text to generate TTS for.")
        sys.exit(0)

    # Preview mode: generate single scene for testing (v2.28)
    if args.preview_scene is not None:
        preview_scenes = [s for s in scenes_with_text if s["scene_number"] == args.preview_scene]
        if not preview_scenes:
            available = [s["scene_number"] for s in scenes_with_text]
            logger.error("Scene %d not found. Available: %s", args.preview_scene, available)
            sys.exit(1)
        scenes_with_text = preview_scenes
        logger.info("=" * 60)
        logger.info("PREVIEW MODE: Generating scene %d only", args.preview_scene)
        logger.info("=" * 60)

    # Count characters (handle both str and list formats)
    def _count_chars(text: str | list[dict[str, str]]) -> int:
        if isinstance(text, list):
            return sum(len(seg.get("text", "")) for seg in text)
        return len(text) if isinstance(text, str) else 0

    total_chars = sum(_count_chars(s["text"]) for s in scenes_with_text)
    cost = total_chars * COST_PER_CHAR_ESTIMATE

    # Detect multi-voice scenes
    has_multi_voice = any(isinstance(s["text"], list) for s in scenes_with_text)

    logger.info("TTS Generation Plan:")
    logger.info("  Scenes: %d", len(scenes_with_text))
    logger.info("  Total characters: %s", f"{total_chars:,}")
    logger.info("  Estimated cost: ~$%.4f", cost)
    logger.info("  Model: %s", args.model_id)
    if has_multi_voice and voice_map:
        logger.info("  Mode: Multi-voice (%d speakers)", len(voice_map))
        for speaker, vid in voice_map.items():
            logger.info("    %s: %s", speaker, vid)
    else:
        logger.info("  Voice: %s", voice_id)
    logger.info("  Output: %s", args.output_dir)

    if not args.yes:
        confirm = input("\nProceed? (y/n): ").strip().lower()
        if confirm not in ("y", "yes"):
            logger.info("Cancelled.")
            return

    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)

    # Generate per-scene TTS
    generated_files = []
    scene_durations_for_padding = []

    logger.info("Generating TTS for %d scenes...", len(scenes_with_text))

    for scene in scenes_with_text:
        scene_num = scene["scene_number"]
        text = scene["text"]
        output_file = os.path.join(args.output_dir, f"scene_{scene_num}_tts.mp3")

        # Multi-voice scene: text is a list of speaker segments
        if isinstance(text, list) and voice_map:
            char_count = sum(len(seg.get("text", "")) for seg in text)
            speakers = [seg.get("speaker", "?") for seg in text]
            logger.info("Scene %d: %d chars (multi-voice: %s)", scene_num, char_count, ", ".join(speakers))
            for seg in text:
                preview = seg.get("text", "")[:60]
                logger.info("  [%s] \"%s%s\"", seg.get("speaker", "?"), preview, "..." if len(seg.get("text", "")) > 60 else "")

            result_path = generate_multi_voice_scene(
                segments=text,
                voice_map=voice_map,
                api_key=api_key,
                output_path=output_file,
                model_id=args.model_id,
                stability=args.stability,
                similarity_boost=args.similarity_boost,
                output_format=args.output_format,
                style=args.style,
                speed=args.speed,
                speaker_boost=args.speaker_boost,
            )

            if result_path:
                duration = get_audio_duration(result_path)
                size_kb = os.path.getsize(result_path) / 1024
                logger.info("Saved: %s (%.1fs, %.0f KB)", result_path, duration, size_kb)
                generated_files.append(result_path)
                scene_durations_for_padding.append(duration)
            else:
                logger.error("FAILED: Could not generate multi-voice TTS for scene %d", scene_num)
            continue

        # Single-voice scene: text is a string
        text_str = text if isinstance(text, str) else str(text)
        logger.info("Scene %d: %d chars", scene_num, len(text_str))
        preview = text_str[:80] + ("..." if len(text_str) > 80 else "")
        logger.info('  "%s"', preview)

        # Build previous/next text for prosody continuity
        scene_idx = scenes_with_text.index(scene)
        prev_text = scenes_with_text[scene_idx - 1]["text"] if scene_idx > 0 else None
        nxt_text = scenes_with_text[scene_idx + 1]["text"] if scene_idx < len(scenes_with_text) - 1 else None
        # For prosody, flatten list texts to string
        if isinstance(prev_text, list):
            prev_text = " ".join(seg.get("text", "") for seg in prev_text)
        if isinstance(nxt_text, list):
            nxt_text = " ".join(seg.get("text", "") for seg in nxt_text)

        result = generate_speech(
            text=text_str,
            voice_id=voice_id,
            api_key=api_key,
            model_id=args.model_id,
            stability=args.stability,
            similarity_boost=args.similarity_boost,
            output_format=args.output_format,
            style=args.style,
            speed=args.speed,
            speaker_boost=args.speaker_boost,
            with_timestamps=args.with_timestamps,
            previous_text=prev_text if args.with_timestamps else None,
            next_text=nxt_text if args.with_timestamps else None,
            dialogue=args.dialogue,
        )

        # Handle timestamps mode (returns tuple)
        audio_bytes = None
        alignment_data = None
        if args.with_timestamps and isinstance(result, tuple):
            audio_bytes, alignment_data = result
        else:
            audio_bytes = result

        if audio_bytes:
            with open(output_file, "wb") as f:
                f.write(audio_bytes)
            # Save alignment data if available
            if alignment_data:
                align_file = os.path.join(args.output_dir, f"scene_{scene_num}_alignment.json")
                with open(align_file, "w") as f:
                    json.dump(alignment_data, f, indent=2)
                logger.info("Alignment: %s", align_file)
            duration = get_audio_duration(output_file)
            size_kb = len(audio_bytes) / 1024
            logger.info("Saved: %s (%.1fs, %.0f KB)", output_file, duration, size_kb)
            generated_files.append(output_file)
            scene_durations_for_padding.append(duration)
        else:
            logger.error("FAILED: Could not generate TTS for scene %d", scene_num)

    if not generated_files:
        logger.error("No TTS audio generated. Check API key and voice settings.")
        sys.exit(1)

    # Audio normalization (v2.28)
    if args.normalize:
        logger.info("=" * 60)
        logger.info("Normalizing audio to %s LUFS", args.loudness_target)
        logger.info("=" * 60)
        try:
            from audio_utils import normalize_audio
            normalized_files = []
            for audio_file in generated_files:
                normalized_path = normalize_audio(
                    audio_file,
                    target_lufs=args.loudness_target,
                    verbose=True,
                )
                if normalized_path:
                    # Replace original with normalized version
                    os.replace(normalized_path, audio_file)
                    normalized_files.append(audio_file)
            logger.info("Normalized %d/%d files", len(normalized_files), len(generated_files))
        except ImportError:
            logger.warning("audio_utils not available, skipping normalization")

    # Preview mode: play audio and ask for confirmation (v2.28)
    if args.preview_scene is not None and generated_files:
        import platform
        audio_file = generated_files[0]
        duration = get_audio_duration(audio_file)
        logger.info("=" * 60)
        logger.info("PREVIEW: Playing scene %s (%.1fs)", args.preview_scene, duration)
        logger.info("=" * 60)

        try:
            if platform.system() == "Darwin":  # macOS
                subprocess.run(["afplay", audio_file], timeout=duration + 5)
            elif platform.system() == "Linux":
                subprocess.run(["aplay", audio_file], timeout=duration + 5)
            elif platform.system() == "Windows":
                os.startfile(audio_file)
        except Exception as e:
            logger.warning("Could not play audio: %s", e)
            logger.info("File saved at: %s", audio_file)

        logger.info("Preview complete. To generate all scenes, run without --preview-scene")
        return

    # Write editable transcript for future edits
    variant = getattr(args, "variant", None)
    editable_filename = f"editable_transcript_{variant}.json" if variant else "editable_transcript.json"
    editable_path = os.path.join(args.output_dir, editable_filename)
    build_editable_transcript(transcript, editable_path)

    # Concatenate into combined narration track
    combined_output = args.combined_output
    if not combined_output:
        # Default: audio/narration.mp3 (sibling to tts/ dir)
        parent_dir = os.path.dirname(args.output_dir.rstrip("/"))
        narration_filename = f"narration_{variant}.mp3" if variant else "narration.mp3"
        combined_output = os.path.join(parent_dir, narration_filename)

    logger.info("Concatenating %d files into narration track...", len(generated_files))

    # For padding, we'd need scene video durations — not available here,
    # so pad_to_duration uses the TTS durations as-is (no-op unless scene_durations provided)
    concat_success = concatenate_audio_files(
        generated_files,
        combined_output,
        pad_to_duration=args.pad_to_duration,
    )

    if concat_success:
        combined_duration = get_audio_duration(combined_output)
        combined_size = os.path.getsize(combined_output) / 1024
        logger.info("Combined narration: %s (%.1fs, %.0f KB)", combined_output, combined_duration, combined_size)
    else:
        logger.warning("Failed to create combined narration track")

    # Sync to slide durations if --sync-to-slides provided
    synced_output = None
    if args.sync_to_slides:
        if not os.path.exists(args.sync_to_slides):
            logger.warning("Slides JSON not found: %s", args.sync_to_slides)
        else:
            synced_path = os.path.join(
                os.path.dirname(combined_output) if combined_output else args.output_dir,
                "narration_synced.mp3",
            )
            synced_output = sync_tts_to_slides(
                generated_files, args.sync_to_slides, synced_path
            )

    # Write manifest
    manifest = {
        "generated_at": datetime.now().isoformat(),
        "variant": variant if variant else None,
        "voice_id": voice_id,
        "model_id": args.model_id,
        "stability": args.stability,
        "similarity_boost": args.similarity_boost,
        "output_format": args.output_format,
        "scenes": [],
        "combined_output": combined_output if concat_success else None,
        "synced_output": synced_output,
        "translated_to": args.translate if args.translate else None,
        "normalized": args.normalize,
        "loudness_target": args.loudness_target if args.normalize else None,
    }

    for i, scene in enumerate(scenes_with_text):
        if i < len(generated_files):
            manifest["scenes"].append({
                "scene_number": scene["scene_number"],
                "text": scene["text"],
                "edited": scene.get("edited", False),
                "audio_file": generated_files[i],
                "duration": get_audio_duration(generated_files[i]),
            })

    manifest_filename = f"narration_manifest_{variant}.json" if variant else "narration_manifest.json"
    manifest_path = os.path.join(
        os.path.dirname(combined_output) if combined_output else args.output_dir,
        manifest_filename,
    )
    os.makedirs(os.path.dirname(manifest_path) or ".", exist_ok=True)
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    logger.info("Manifest: %s", manifest_path)

    # Summary
    print(f"\n{'='*60}")
    print("TTS Generation Complete")
    print(f"{'='*60}")
    print(f"  Scenes generated: {len(generated_files)}/{len(scenes_with_text)}")
    print(f"  Per-scene audio: {args.output_dir}/")
    if concat_success:
        print(f"  Combined narration: {combined_output}")
    if synced_output:
        print(f"  Synced narration: {synced_output}")
    print(f"  Editable transcript: {editable_path}")
    print(f"  Manifest: {manifest_path}")
    narration_to_use = synced_output or combined_output
    print("\nNext: Use --narration flag in stitch_video.py:")
    print("  python stitch_video.py --videos-dir <videos> --audio <music.mp3> \\")
    print(f"    --narration {narration_to_use} --output final.mp4")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
