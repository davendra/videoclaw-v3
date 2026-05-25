#!/usr/bin/env python3
"""
ElevenLabs Voice Design Script.

Design custom AI voices from text descriptions using ElevenLabs Voice Design API.
Supports interactive questionnaires, preset archetypes, and browser-based preview selection.

Usage:
    # List available presets
    python voice_designer.py --list-presets

    # Design voice using preset
    python voice_designer.py --design-voice --preset-voice professional-narrator

    # Design voice with simple questionnaire (4 questions)
    python voice_designer.py --design-voice --questionnaire simple

    # Design voice with detailed questionnaire (8 questions)
    python voice_designer.py --design-voice --questionnaire detailed

    # Design voice with custom description
    python voice_designer.py --design-voice --description "A warm female voice..."

    # Use preview text from transcript
    python voice_designer.py --design-voice --preset-voice friendly-presenter \
      --transcript audio/tts/editable_transcript.json

    # Save selected voice to library
    python voice_designer.py --design-voice --preset-voice professional-narrator \
      --save-voice --voice-name "My Narrator"

    # Dry-run (show API payload without calling)
    python voice_designer.py --design-voice --preset-voice professional-narrator --dry-run

Requirements:
    pip install requests
    ELEVENLABS_API_KEY environment variable set
"""

import argparse
import base64
import json
import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

# Import from sibling modules
try:
    from voice_presets import (
        CONVERSATIONAL_PRESETS,
        CONVERSATIONAL_QUESTIONNAIRE,
        DELIVERY_TAGS,
        DETAILED_QUESTIONNAIRE_EXTRA,
        EMOTION_PALETTES,
        SIMPLE_QUESTIONNAIRE,
        VOICE_DESIGN_PRESETS,
        build_conversational_description,
        build_description_from_attributes,
        get_emotion_palette,  # noqa: F401
        get_preset,
        get_preset_description,  # noqa: F401
        is_conversational_preset,  # noqa: F401
        list_conversational_presets,  # noqa: F401
        list_presets,  # noqa: F401
    )
except ImportError:
    # Running from different directory
    script_dir = Path(__file__).parent
    sys.path.insert(0, str(script_dir))
    from voice_presets import (
        CONVERSATIONAL_PRESETS,
        CONVERSATIONAL_QUESTIONNAIRE,
        DELIVERY_TAGS,
        DETAILED_QUESTIONNAIRE_EXTRA,
        EMOTION_PALETTES,
        SIMPLE_QUESTIONNAIRE,
        VOICE_DESIGN_PRESETS,
        build_conversational_description,
        build_description_from_attributes,
        get_preset,
    )


# ElevenLabs API base URL
ELEVENLABS_API_BASE = "https://api.elevenlabs.io"

# Default preview text if none provided
DEFAULT_PREVIEW_TEXT = (
    "Welcome to our demonstration video. In this presentation, we'll explore "
    "the key features and benefits that set our solution apart. Let's begin "
    "by looking at how this technology can transform your workflow."
)

# Maximum characters for preview text
MAX_PREVIEW_CHARS = 500


def get_api_key() -> str:
    """Get ElevenLabs API key from environment."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("Error: ELEVENLABS_API_KEY not set.")
        print("\nSet it in .claude/settings.local.json:")
        print('  {"env": {"ELEVENLABS_API_KEY": "sk_..."}}')
        print("\nOr export it:")
        print("  export ELEVENLABS_API_KEY=sk_...")
        sys.exit(1)
    return api_key


def _api_request(method: str, endpoint: str, api_key: str, **kwargs):
    """Make an authenticated request to the ElevenLabs API."""
    import requests

    url = f"{ELEVENLABS_API_BASE}{endpoint}"
    headers = {"xi-api-key": api_key}
    if "headers" in kwargs:
        headers.update(kwargs.pop("headers"))

    response = requests.request(method, url, headers=headers, timeout=120, **kwargs)
    return response


def design_voice(
    voice_description: str,
    api_key: str,
    preview_text: str | None = None,
    guidance_scale: float = 5.0,
    seed: int | None = None,
) -> dict:
    """
    Design a new voice using ElevenLabs Voice Design API.

    This generates 3 preview audio samples that can be listened to before saving.

    Args:
        voice_description: Text description of the desired voice characteristics
        api_key: ElevenLabs API key
        preview_text: Text to speak in the preview (max 500 chars)
        guidance_scale: How closely to follow the description (1-10, default 5)
        seed: Random seed for reproducibility

    Returns:
        Dict with 'previews' list containing generated voice previews, or 'error' on failure
    """
    text = preview_text or DEFAULT_PREVIEW_TEXT
    if len(text) > MAX_PREVIEW_CHARS:
        text = text[:MAX_PREVIEW_CHARS]

    payload = {
        "voice_description": voice_description,
        "text": text,
        "guidance_scale": guidance_scale,
    }
    if seed is not None:
        payload["seed"] = seed

    # Use create-previews endpoint to generate 3 voice options
    resp = _api_request(
        "POST",
        "/v1/text-to-voice/create-previews",
        api_key,
        json=payload,
        headers={"Content-Type": "application/json"},
    )

    if resp.status_code != 200:
        error_text = resp.text[:500] if resp.text else "Unknown error"
        return {"error": f"API error {resp.status_code}: {error_text}"}

    return resp.json()


def save_designed_voice(
    generated_voice_id: str,
    voice_name: str,
    voice_description: str,
    api_key: str,
    labels: dict[str, str] | None = None,
) -> dict:
    """
    Save a designed voice to the user's ElevenLabs library.

    Args:
        generated_voice_id: The temporary voice ID from design_voice() preview
        voice_name: Name to save the voice as
        voice_description: Description of the voice
        api_key: ElevenLabs API key
        labels: Optional dict of labels (e.g., {"accent": "american", "age": "middle-aged"})

    Returns:
        Dict with 'voice_id' on success, or 'error' on failure
    """
    payload = {
        "voice_name": voice_name,
        "voice_description": voice_description,
        "generated_voice_id": generated_voice_id,
    }
    if labels:
        payload["labels"] = labels

    # Use create-voice-from-preview endpoint (not create-voice)
    resp = _api_request(
        "POST",
        "/v1/text-to-voice/create-voice-from-preview",
        api_key,
        json=payload,
        headers={"Content-Type": "application/json"},
    )

    if resp.status_code != 200:
        error_text = resp.text[:500] if resp.text else "Unknown error"
        return {"error": f"API error {resp.status_code}: {error_text}"}

    return resp.json()


def extract_preview_text_from_transcript(
    transcript_path: str,
    max_chars: int = MAX_PREVIEW_CHARS,
) -> str:
    """
    Extract preview text from a transcript JSON file.

    Args:
        transcript_path: Path to transcript JSON (editable_transcript.json format)
        max_chars: Maximum characters to extract

    Returns:
        Combined text from first N scenes up to max_chars
    """
    try:
        with open(transcript_path, encoding="utf-8") as f:
            data = json.load(f)

        # Handle different transcript formats
        scenes = data.get("scenes", data if isinstance(data, list) else [])

        texts = []
        total_chars = 0
        for scene in scenes:
            text = scene.get("text", "").strip()
            if text:
                if total_chars + len(text) > max_chars:
                    remaining = max_chars - total_chars
                    if remaining > 50:  # Only add if meaningful amount
                        texts.append(text[:remaining])
                    break
                texts.append(text)
                total_chars += len(text) + 1  # +1 for space

        return " ".join(texts) if texts else DEFAULT_PREVIEW_TEXT

    except (json.JSONDecodeError, FileNotFoundError) as e:
        print(f"Warning: Could not read transcript: {e}")
        return DEFAULT_PREVIEW_TEXT


def run_simple_questionnaire() -> dict[str, str]:
    """
    Run the simple 4-question voice design questionnaire.

    Returns:
        Dict with gender, age, accent, tone values
    """
    print("\n  VOICE DESIGN - Simple Questionnaire\n")
    print("  " + "=" * 50)

    answers = {}
    for key, config in SIMPLE_QUESTIONNAIRE.items():
        print(f"\n  {config['question']}")
        for i, option in enumerate(config["options"], 1):
            print(f"    [{i}] {option}")

        while True:
            try:
                choice = input("\n  Enter choice (1-{}): ".format(len(config["options"])))
                idx = int(choice) - 1
                if 0 <= idx < len(config["values"]):
                    answers[key] = config["values"][idx]
                    print(f"  Selected: {config['options'][idx]}")
                    break
                print("  Invalid choice, try again.")
            except (ValueError, KeyboardInterrupt):
                print("\n  Cancelled.")
                sys.exit(0)

    return answers


def run_detailed_questionnaire() -> dict[str, str]:
    """
    Run the detailed 8-question voice design questionnaire.

    Returns:
        Dict with all voice attributes
    """
    # Start with simple questions
    answers = run_simple_questionnaire()

    print("\n  DETAILED OPTIONS\n")
    print("  " + "-" * 50)

    # Add detailed questions
    for key, config in DETAILED_QUESTIONNAIRE_EXTRA.items():
        print(f"\n  {config['question']}")
        for i, option in enumerate(config["options"], 1):
            print(f"    [{i}] {option}")

        while True:
            try:
                choice = input("\n  Enter choice (1-{}): ".format(len(config["options"])))
                idx = int(choice) - 1
                if 0 <= idx < len(config["values"]):
                    value = config["values"][idx]
                    if value is not None:
                        answers[key] = value
                    print(f"  Selected: {config['options'][idx]}")
                    break
                print("  Invalid choice, try again.")
            except (ValueError, KeyboardInterrupt):
                print("\n  Cancelled.")
                sys.exit(0)

    return answers


def run_conversational_questionnaire() -> dict[str, str]:
    """
    Run the conversational character voice design questionnaire.

    This questionnaire is optimized for creating character voices for
    dialogue and storytelling, with focus on emotional state and personality.

    Returns:
        Dict with character voice attributes
    """
    print("\n  CONVERSATIONAL CHARACTER VOICE DESIGN\n")
    print("  " + "=" * 50)
    print("  Design a voice for dialogue and character acting.")
    print("  " + "=" * 50)

    answers = {}

    for key, config in CONVERSATIONAL_QUESTIONNAIRE.items():
        print(f"\n  {config['question']}")

        # Handle free text input (personality field)
        if config.get("free_text"):
            print(f"    Example: {config.get('examples', '')}")
            try:
                value = input("\n  Enter traits: ").strip()
                if value:
                    answers[key] = value
                    print(f"  Traits: {value}")
                else:
                    print("  Skipped (no traits entered)")
            except KeyboardInterrupt:
                print("\n  Cancelled.")
                sys.exit(0)
        else:
            # Multiple choice
            for i, option in enumerate(config["options"], 1):
                print(f"    [{i}] {option}")

            while True:
                try:
                    choice = input("\n  Enter choice (1-{}): ".format(len(config["options"])))
                    idx = int(choice) - 1
                    if 0 <= idx < len(config["values"]):
                        answers[key] = config["values"][idx]
                        print(f"  Selected: {config['options'][idx]}")
                        break
                    print("  Invalid choice, try again.")
                except (ValueError, KeyboardInterrupt):
                    print("\n  Cancelled.")
                    sys.exit(0)

    return answers


def print_conversational_presets():
    """Print available conversational character presets."""
    print("\n  CONVERSATIONAL CHARACTER PRESETS\n")
    print("  " + "=" * 70)
    print("  These presets are optimized for dialogue and character acting.")
    print("  They include emotion_palette for V3 emotion tagging.")
    print("  " + "=" * 70)

    for name, preset in CONVERSATIONAL_PRESETS.items():
        print(f"\n  {name}")
        print("  " + "-" * 50)
        print(f"    Gender: {preset.get('gender', 'N/A')}")
        print(f"    Age: {preset.get('age', 'N/A')}")
        print(f"    Tone: {preset.get('tone', 'N/A')}")
        print(f"    Emotion palette: {', '.join(preset.get('emotion_palette', [])[:5])}...")
        print(f"    Best for: {preset.get('best_for', 'Dialogue')}")

    print(f"\n  Total: {len(CONVERSATIONAL_PRESETS)} conversational presets")
    print("\n  Tip: Use --conversational --preset-voice <name> to use these")
    print()


def print_emotion_palettes():
    """Print available emotion palettes for V3 tagging."""
    print("\n  EMOTION PALETTES FOR V3 TAGGING\n")
    print("  " + "=" * 70)
    print("  Use these tags in brackets before text: [exhausted][desperate] Hello...")
    print("  " + "=" * 70)

    for emotion, tags in EMOTION_PALETTES.items():
        print(f"\n  {emotion.upper()}")
        print(f"    Tags: {', '.join(tags)}")

    print("\n  DELIVERY TAGS (pacing/volume):")
    print(f"    {', '.join(DELIVERY_TAGS)}")
    print()


def generate_preview_html(
    previews: list[dict],
    audio_paths: list[str],
    voice_description: str,
) -> str:
    """
    Generate HTML page with audio players for preview selection.

    Args:
        previews: List of preview dicts from design_voice()
        audio_paths: List of paths to saved audio files
        voice_description: The voice description used

    Returns:
        HTML content string
    """
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Voice Design Preview</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            padding: 40px 20px;
            color: #e0e0e0;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
        }}
        h1 {{
            text-align: center;
            color: #fff;
            margin-bottom: 10px;
            font-size: 2em;
        }}
        .subtitle {{
            text-align: center;
            color: #888;
            margin-bottom: 30px;
        }}
        .description {{
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
            border: 1px solid rgba(255,255,255,0.1);
        }}
        .description h3 {{
            color: #4ecdc4;
            margin-bottom: 10px;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }}
        .description p {{
            color: #ccc;
            line-height: 1.6;
            font-size: 0.95em;
        }}
        .preview-card {{
            background: rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
            border: 1px solid rgba(255,255,255,0.1);
            transition: transform 0.2s, box-shadow 0.2s;
        }}
        .preview-card:hover {{
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }}
        .preview-header {{
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }}
        .preview-number {{
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 1.2em;
            color: #fff;
            margin-right: 15px;
        }}
        .preview-title {{
            font-size: 1.1em;
            color: #fff;
        }}
        audio {{
            width: 100%;
            height: 50px;
            border-radius: 8px;
        }}
        audio::-webkit-media-controls-panel {{
            background: rgba(255,255,255,0.1);
        }}
        .instructions {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 12px;
            padding: 20px;
            margin-top: 30px;
            text-align: center;
        }}
        .instructions h3 {{
            color: #fff;
            margin-bottom: 10px;
        }}
        .instructions p {{
            color: rgba(255,255,255,0.9);
            font-size: 0.95em;
        }}
        .instructions code {{
            background: rgba(0,0,0,0.2);
            padding: 2px 8px;
            border-radius: 4px;
            font-family: 'SF Mono', Consolas, monospace;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Voice Design Preview</h1>
        <p class="subtitle">Listen to each option and note your preference (1, 2, or 3)</p>

        <div class="description">
            <h3>Voice Description</h3>
            <p>{voice_description}</p>
        </div>
"""

    for i, (preview, audio_path) in enumerate(zip(previews, audio_paths, strict=False), 1):
        _voice_id = preview.get("generated_voice_id", "unknown")
        # Use just the filename since HTML and MP3 are in the same directory
        audio_filename = os.path.basename(audio_path)
        html += f"""
        <div class="preview-card">
            <div class="preview-header">
                <div class="preview-number">{i}</div>
                <div class="preview-title">Voice Option {i}</div>
            </div>
            <audio controls preload="auto">
                <source src="./{audio_filename}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
        </div>
"""

    html += """
        <div class="instructions">
            <h3>Next Steps</h3>
            <p>Return to your terminal and enter your preferred voice number (1, 2, or 3).</p>
        </div>
    </div>
</body>
</html>
"""
    return html


def open_audio_previews(
    previews: list[dict],
    output_dir: str,
    voice_description: str,
    auto_open: bool = True,
) -> tuple[list[str], str]:
    """
    Save preview audio files and open HTML preview page in browser.

    Args:
        previews: List of preview dicts with 'audio_base_64' and 'generated_voice_id'
        output_dir: Directory to save audio files
        voice_description: The voice description used
        auto_open: Whether to auto-open browser

    Returns:
        Tuple of (list of audio paths, HTML path)
    """
    os.makedirs(output_dir, exist_ok=True)

    audio_paths = []
    for i, preview in enumerate(previews, 1):
        audio_b64 = preview.get("audio_base_64", "")
        if not audio_b64:
            print(f"  Warning: Preview {i} has no audio data")
            continue

        audio_bytes = base64.b64decode(audio_b64)
        audio_path = os.path.join(output_dir, f"voice_preview_{i}.mp3")
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)
        audio_paths.append(audio_path)
        print(f"  Saved: {audio_path}")

    # Generate and save HTML
    html_content = generate_preview_html(previews, audio_paths, voice_description)
    html_path = os.path.join(output_dir, "voice_preview.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"  Preview page: {html_path}")

    # Open in browser
    if auto_open:
        system = platform.system()
        try:
            if system == "Darwin":
                subprocess.run(["open", html_path], check=True)
            elif system == "Windows":
                os.startfile(html_path)
            else:  # Linux
                subprocess.run(["xdg-open", html_path], check=True)
            print("  Opened preview in browser")
        except Exception as e:
            print(f"  Could not auto-open browser: {e}")
            print(f"  Please open manually: {html_path}")

    return audio_paths, html_path


def print_presets():
    """Print all available voice presets."""
    print("\n  VOICE DESIGN PRESETS\n")
    print("  " + "=" * 70)

    for name, preset in VOICE_DESIGN_PRESETS.items():
        print(f"\n  {name}")
        print("  " + "-" * 50)
        print(f"    Gender: {preset.get('gender', 'N/A')}")
        print(f"    Age: {preset.get('age', 'N/A')}")
        print(f"    Accent: {preset.get('accent', 'N/A')}")
        print(f"    Tone: {preset.get('tone', 'N/A')}")
        print(f"    Best for: {preset.get('best_for', 'General use')}")

    print(f"\n  Total: {len(VOICE_DESIGN_PRESETS)} presets\n")


def main() -> int:
    """Main entry point for voice designer CLI."""
    parser = argparse.ArgumentParser(
        description="Design custom AI voices using ElevenLabs Voice Design API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List presets
  python voice_designer.py --list-presets

  # Design with preset
  python voice_designer.py --design-voice --preset-voice professional-narrator

  # Design with questionnaire
  python voice_designer.py --design-voice --questionnaire simple

  # Design with custom description
  python voice_designer.py --design-voice --description "A warm female voice..."

  # Save selected voice
  python voice_designer.py --design-voice --preset-voice friendly-presenter \\
    --save-voice --voice-name "My Voice"
""",
    )

    # Mode flags
    parser.add_argument(
        "--design-voice",
        action="store_true",
        help="Launch voice design mode",
    )
    parser.add_argument(
        "--list-presets",
        action="store_true",
        help="List all available voice presets",
    )

    # Voice specification options
    parser.add_argument(
        "--preset-voice",
        metavar="NAME",
        help="Use a preset voice archetype (e.g., professional-narrator)",
    )
    parser.add_argument(
        "--questionnaire",
        choices=["simple", "detailed", "conversational"],
        help="Run interactive questionnaire (simple=4, detailed=8, conversational=5 character-focused)",
    )
    parser.add_argument(
        "--description",
        metavar="TEXT",
        help="Custom voice description text",
    )

    # Conversational mode options
    parser.add_argument(
        "--conversational",
        action="store_true",
        help="Design a conversational character voice (auto-adds 'Natural conversational dialogue')",
    )
    parser.add_argument(
        "--gender",
        choices=["male", "female"],
        help="Character gender (for --conversational mode)",
    )
    parser.add_argument(
        "--age",
        metavar="AGE",
        help="Character age range, e.g., 'late 20s', 'early 30s' (for --conversational mode)",
    )
    parser.add_argument(
        "--accent",
        metavar="ACCENT",
        help="Character accent, e.g., 'american', 'british', 'creole' (for --conversational mode)",
    )
    parser.add_argument(
        "--primary-emotion",
        metavar="EMOTION",
        help="Primary emotional state: frustrated, desperate, fearful, hopeful, weary, sarcastic, angry, resolute",
    )
    parser.add_argument(
        "--personality",
        metavar="TRAITS",
        help="Comma-separated personality traits, e.g., 'strict, tense, weary, slightly annoyed'",
    )
    parser.add_argument(
        "--list-conversational",
        action="store_true",
        help="List conversational character presets only",
    )
    parser.add_argument(
        "--list-emotions",
        action="store_true",
        help="List emotion palettes for V3 tagging",
    )

    # Preview options
    parser.add_argument(
        "--preview-text",
        metavar="TEXT",
        help="Custom text to speak in preview (max 500 chars)",
    )
    parser.add_argument(
        "--transcript",
        metavar="PATH",
        help="Extract preview text from transcript JSON file",
    )
    parser.add_argument(
        "--guidance-scale",
        type=float,
        default=5.0,
        metavar="N",
        help="How closely to follow description (1-10, default: 5.0)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        metavar="N",
        help="Random seed for reproducibility",
    )

    # Save options
    parser.add_argument(
        "--save-voice",
        action="store_true",
        help="Save selected voice to ElevenLabs library",
    )
    parser.add_argument(
        "--voice-name",
        metavar="NAME",
        help="Name for saved voice (required with --save-voice)",
    )

    # Output options
    parser.add_argument(
        "--output-dir",
        metavar="PATH",
        help="Directory to save preview files (default: temp directory)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't auto-open browser for preview",
    )

    # Utility flags
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show API payload without making calls",
    )
    parser.add_argument(
        "-y", "--yes",
        action="store_true",
        help="Skip confirmation prompts",
    )

    args = parser.parse_args()

    # Handle list commands (no --design-voice required)
    if args.list_presets:
        print_presets()
        return 0

    if args.list_conversational:
        print_conversational_presets()
        return 0

    if args.list_emotions:
        print_emotion_palettes()
        return 0

    # Require --design-voice for design operations
    if not args.design_voice:
        parser.print_help()
        return 1

    # Determine voice description
    voice_description = None
    is_conversational = args.conversational

    # Option 1: Direct description
    if args.description:
        voice_description = args.description
        # Auto-append conversational suffix if in conversational mode
        if is_conversational and "Natural conversational dialogue" not in voice_description:
            voice_description += " Natural conversational dialogue."

    # Option 2: Preset voice
    elif args.preset_voice:
        preset = get_preset(args.preset_voice)
        if not preset:
            print(f"Error: Unknown preset '{args.preset_voice}'")
            print("Use --list-presets or --list-conversational to see available options")
            return 1
        voice_description = preset["description"]
        is_conversational = preset.get("conversational", False) or is_conversational
        print(f"\n  Using preset: {args.preset_voice}")
        if is_conversational:
            print("  Mode: Conversational character voice")
            if preset.get("emotion_palette"):
                print(f"  Emotion palette: {', '.join(preset['emotion_palette'][:5])}...")

    # Option 3: Conversational mode with individual attributes
    elif is_conversational and args.gender and args.age and args.primary_emotion:
        voice_description = build_conversational_description(
            gender=args.gender,
            age=args.age,
            accent=args.accent or "neutral",
            primary_emotion=args.primary_emotion,
            personality=args.personality,
        )
        print("\n  Building conversational character voice:")
        print(f"    Gender: {args.gender}")
        print(f"    Age: {args.age}")
        print(f"    Accent: {args.accent or 'neutral'}")
        print(f"    Primary emotion: {args.primary_emotion}")
        if args.personality:
            print(f"    Personality: {args.personality}")

    # Option 4: Questionnaire
    elif args.questionnaire:
        if args.questionnaire == "simple":
            answers = run_simple_questionnaire()
            voice_description = build_description_from_attributes(**answers)
        elif args.questionnaire == "detailed":
            answers = run_detailed_questionnaire()
            voice_description = build_description_from_attributes(**answers)
        elif args.questionnaire == "conversational":
            answers = run_conversational_questionnaire()
            voice_description = build_conversational_description(
                gender=answers.get("gender", "female"),
                age=answers.get("age", "late 20s"),
                accent=answers.get("accent", "neutral"),
                primary_emotion=answers.get("primary_emotion", "frustrated"),
                personality=answers.get("personality"),
            )
            is_conversational = True

    # Option 5: Conversational mode without enough info
    elif is_conversational:
        print("Error: --conversational requires either:")
        print("  - --preset-voice <conversational-preset>")
        print("  - --gender, --age, and --primary-emotion")
        print("  - --questionnaire conversational")
        return 1
    else:
        print("Error: Specify --preset-voice, --questionnaire, --description, or --conversational with attributes")
        return 1

    print(f"\n  Voice Description:\n  {voice_description}\n")

    # Determine preview text
    preview_text = None
    if args.preview_text:
        preview_text = args.preview_text
    elif args.transcript:
        if os.path.exists(args.transcript):
            preview_text = extract_preview_text_from_transcript(args.transcript)
            print(f"  Preview text from transcript: {preview_text[:100]}...")
        else:
            print(f"  Warning: Transcript not found: {args.transcript}")
            print("  Using default preview text")

    # Dry-run mode
    if args.dry_run:
        print("\n  DRY RUN - API Payload:\n")
        payload = {
            "voice_description": voice_description,
            "text": preview_text or DEFAULT_PREVIEW_TEXT,
            "guidance_scale": args.guidance_scale,
        }
        if args.seed:
            payload["seed"] = args.seed
        print(json.dumps(payload, indent=2))
        print("\n  No API call made (dry-run mode)\n")
        return 0

    # Get API key
    api_key = get_api_key()

    # Design voice
    print("\n  Designing voice (this may take 15-30 seconds)...")
    result = design_voice(
        voice_description=voice_description,
        api_key=api_key,
        preview_text=preview_text,
        guidance_scale=args.guidance_scale,
        seed=args.seed,
    )

    if "error" in result:
        print(f"\n  Error: {result['error']}")
        return 1

    previews = result.get("previews", [])
    if not previews:
        print("\n  Error: No preview voices generated")
        return 1

    print(f"\n  Generated {len(previews)} voice previews")

    # Determine output directory
    output_dir = args.output_dir or tempfile.mkdtemp(prefix="voice_design_")
    os.makedirs(output_dir, exist_ok=True)

    # Save and open previews
    audio_paths, html_path = open_audio_previews(
        previews=previews,
        output_dir=output_dir,
        voice_description=voice_description,
        auto_open=not args.no_browser,
    )

    # Get user selection
    print("\n  " + "=" * 50)
    print("  Listen to the previews in your browser,")
    print("  then enter your preferred voice number below.")
    print("  " + "=" * 50)

    selected_preview = None
    while True:
        try:
            choice = input("\n  Enter preferred voice (1-3), or 'q' to quit: ").strip()
            if choice.lower() == "q":
                print("  Cancelled.")
                return 0
            idx = int(choice) - 1
            if 0 <= idx < len(previews):
                selected_preview = previews[idx]
                print(f"  Selected: Voice {choice}")
                break
            print(f"  Invalid choice. Enter 1-{len(previews)}")
        except (ValueError, KeyboardInterrupt):
            print("\n  Cancelled.")
            return 0

    # Save voice if requested
    if args.save_voice:
        if not args.voice_name:
            args.voice_name = input("  Enter name for this voice: ").strip()
            if not args.voice_name:
                print("  Error: Voice name is required")
                return 1

        generated_voice_id = selected_preview.get("generated_voice_id")
        if not generated_voice_id:
            print("  Error: No voice ID in selected preview")
            return 1

        print(f"\n  Saving voice as '{args.voice_name}'...")

        # Build labels from preset or CLI arguments
        labels = {}
        if args.preset_voice:
            preset = get_preset(args.preset_voice)
            if preset:
                labels = {
                    k: v for k, v in preset.items()
                    if k in ["gender", "age", "accent", "tone"] and v
                }
                labels["preset"] = args.preset_voice
                if preset.get("conversational"):
                    labels["type"] = "conversational"
        elif is_conversational:
            # Build labels from CLI args for conversational mode
            if args.gender:
                labels["gender"] = args.gender
            if args.age:
                labels["age"] = args.age
            if args.accent:
                labels["accent"] = args.accent
            if args.primary_emotion:
                labels["tone"] = args.primary_emotion
            labels["type"] = "conversational"

        save_result = save_designed_voice(
            generated_voice_id=generated_voice_id,
            voice_name=args.voice_name,
            voice_description=voice_description,
            api_key=api_key,
            labels=labels if labels else None,
        )

        if "error" in save_result:
            print(f"\n  Error saving voice: {save_result['error']}")
            return 1

        voice_id = save_result.get("voice_id")
        print("\n  Voice saved successfully!")
        print(f"  Voice ID: {voice_id}")
        print(f"  Voice Name: {args.voice_name}")
        print("\n  Use this voice in TTS generation:")
        print(f"    python generate_tts.py --voice-id \"{voice_id}\" ...")
        print(f"    python generate_tts.py --voice-name \"{args.voice_name}\" ...")

    else:
        # Just show the selected voice info
        generated_voice_id = selected_preview.get("generated_voice_id")
        print(f"\n  Selected Voice ID: {generated_voice_id}")
        print("\n  To save this voice to your library, run again with --save-voice:")
        print("    python voice_designer.py --design-voice ... --save-voice --voice-name \"My Voice\"")

    print("\n  Preview files saved to:", output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
