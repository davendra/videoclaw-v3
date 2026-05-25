#!/usr/bin/env python3
"""
Generate narration script for PDF slides using Gemini Vision.

Analyzes each slide image and writes presenter-style narration text.
Outputs editable_transcript.json in the format consumed by generate_tts.py --edit.

Usage:
    # Generate narration for all slides
    python generate_narration_script.py \
      --slides-json "projects/{slug}/analysis/slides.json" \
      --slides-dir "projects/{slug}/slides" \
      --output "projects/{slug}/audio/tts/editable_transcript.json"

    # Custom style
    python generate_narration_script.py \
      --slides-json "projects/{slug}/analysis/slides.json" \
      --slides-dir "projects/{slug}/slides" \
      --output "projects/{slug}/audio/tts/editable_transcript.json" \
      --style professional

    # Dry-run (preview without calling API)
    python generate_narration_script.py \
      --slides-json "projects/{slug}/analysis/slides.json" \
      --slides-dir "projects/{slug}/slides" \
      --dry-run
"""

import argparse
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

NARRATION_STYLES = {
    "professional": "You are a professional presenter giving a business presentation. Speak clearly and confidently. Use transition phrases between points.",
    "casual": "You are giving a relaxed, conversational presentation. Speak naturally as if talking to a colleague. Keep it engaging and approachable.",
    "educational": "You are a teacher explaining concepts to students. Be clear, methodical, and use examples. Build understanding step by step.",
    "pitch": "You are pitching to investors or clients. Be enthusiastic, highlight key benefits, and create urgency. Keep energy high.",
}

SYSTEM_PROMPT_TEMPLATE = """You are writing narration for a slide-based presentation video. You will see each slide image and write what a presenter would SAY for that slide.

Style: {style_description}

Rules:
- Write what the presenter SAYS, not a description of the slide
- DO NOT say "this slide shows" or "as you can see" — narrate the CONTENT
- Keep narration natural and conversational
- Target approximately {words_per_slide} words per slide (~{seconds_per_slide} seconds of speech at 2.5 words/second)
- Use transition phrases to connect to the previous slide's topic when provided
- Include natural pauses with "..." for emphasis
- Output ONLY the narration text, no formatting or labels

{previous_context}"""


def find_slide_image(slides_dir: str, slide_num: int) -> str | None:
    """Find the slide image for a given slide number."""
    import glob
    patterns = [
        f"slide_{slide_num:03d}.jpg",
        f"slide_{slide_num:03d}.png",
        f"scene_{slide_num}_frame.jpg",
    ]
    for pattern in patterns:
        matches = glob.glob(os.path.join(slides_dir, pattern))
        if matches:
            return matches[0]
    return None


def generate_narration_gemini(
    image_path: str,
    style: str,
    duration: float,
    previous_narration: str | None = None,
) -> str | None:
    """Use Gemini Vision to generate narration text for a slide."""
    try:
        import google.generativeai as genai
    except ImportError:
        print("  Error: google-generativeai not installed. Run: pip install google-generativeai")
        return None

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("  Error: GOOGLE_API_KEY not set")
        return None

    genai.configure(api_key=api_key)

    words_per_slide = int(duration * 2.5)
    style_description = NARRATION_STYLES.get(style, NARRATION_STYLES["professional"])

    previous_context = ""
    if previous_narration:
        # Truncate to last sentence for context
        last_sentence = previous_narration.rstrip(".").rsplit(".", 1)[-1].strip()
        previous_context = f"The previous slide's narration ended with: \"{last_sentence}.\"\nConnect smoothly to this new topic."

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        style_description=style_description,
        words_per_slide=words_per_slide,
        seconds_per_slide=int(duration),
        previous_context=previous_context,
    )

    with open(image_path, "rb") as f:
        image_data = f.read()

    mime_type = "image/jpeg" if image_path.lower().endswith(".jpg") else "image/png"

    model = genai.GenerativeModel("gemini-3-flash-preview")

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = model.generate_content(
                [
                    {"text": system_prompt},
                    {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_data).decode()}},
                    {"text": "Write the presenter narration for this slide."},
                ],
                generation_config={"temperature": 0.7, "max_output_tokens": 500},
            )

            if response and response.text:
                return response.text.strip()
            return None
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "ResourceExhausted" in error_str:
                wait = 40 * (attempt + 1)
                print(f"    Rate limited, waiting {wait}s (attempt {attempt + 1}/{max_retries})...")
                time.sleep(wait)
            else:
                print(f"    Error: {error_str[:200]}")
                return None

    print("    Max retries exceeded")
    return None


def estimate_duration(text: str, words_per_second: float = 2.5) -> float:
    """Estimate speech duration from text (at ~2.5 words/second)."""
    word_count = len(text.split())
    return word_count / words_per_second


def build_editable_transcript(
    slides_data: dict,
    narrations: dict[str, str],
) -> list[dict]:
    """Build editable_transcript.json format for generate_tts.py --edit."""
    transcript = []
    for slide in slides_data.get("slides", []):
        slide_num = str(slide["slide"])
        text = narrations.get(slide_num, "")
        if not text:
            continue

        est_duration = estimate_duration(text)

        transcript.append({
            "scene": int(slide_num),
            "text": text,
            "estimated_duration": round(est_duration, 1),
            "original_duration": slide.get("duration", 8.0),
        })

    return transcript


def main():
    parser = argparse.ArgumentParser(
        description="Generate narration script for PDF slides using Gemini Vision"
    )
    parser.add_argument("--slides-json", required=True, help="Path to slides.json")
    parser.add_argument("--slides-dir", required=True,
                        help="Directory with slide images (from extract_pdf_slides.py)")
    parser.add_argument("--output", help="Output path for editable_transcript.json")
    parser.add_argument("--style", choices=list(NARRATION_STYLES.keys()),
                        default="professional",
                        help="Narration style (default: professional)")
    parser.add_argument("--scenes", help="Comma-separated slide numbers (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview without calling Gemini API")

    args = parser.parse_args()

    # Load slides.json
    with open(args.slides_json) as f:
        slides_data = json.load(f)

    slides = slides_data.get("slides", [])
    if not slides:
        print("Error: No slides found in slides.json")
        sys.exit(1)

    # Filter scenes if specified
    if args.scenes:
        scene_nums = [int(s.strip()) for s in args.scenes.split(",")]
        slides = [s for s in slides if s["slide"] in scene_nums]

    # Default output path
    output_path = args.output or os.path.join(
        os.path.dirname(args.slides_json), "..", "audio", "tts", "editable_transcript.json"
    )

    print(f"\n{'='*60}")
    print(f"Narration Script Generation ({args.style})")
    print(f"{'='*60}")
    print(f"Slides: {len(slides)}")
    print(f"Source: {args.slides_dir}")
    print(f"Style: {args.style}")
    print()

    narrations = {}
    previous_narration = None
    total_words = 0

    for slide in slides:
        slide_num = slide["slide"]
        duration = slide.get("duration", 8.0)
        image_path = find_slide_image(args.slides_dir, slide_num)

        if not image_path:
            print(f"  Slide {slide_num}: No image found, skipping")
            continue

        if args.dry_run:
            target_words = int(duration * 2.5)
            print(f"  Slide {slide_num}: Would analyze {os.path.basename(image_path)} "
                  f"(~{target_words} words for {duration:.1f}s)")
            total_words += target_words
            continue

        print(f"  Slide {slide_num}: Analyzing {os.path.basename(image_path)}...")
        text = generate_narration_gemini(
            image_path, args.style, duration,
            previous_narration=previous_narration,
        )

        if text:
            narrations[str(slide_num)] = text
            word_count = len(text.split())
            est_dur = estimate_duration(text)
            total_words += word_count
            print(f"    -> {word_count} words (~{est_dur:.1f}s): {text[:60]}...")
            previous_narration = text
            # Brief delay to avoid rate limiting
            time.sleep(2)
        else:
            print("    FAILED to generate narration")

    if args.dry_run:
        est_total = total_words / 2.5
        print(f"\nDry run complete. Would generate ~{total_words} words "
              f"(~{est_total:.0f}s of narration) for {len(slides)} slides.")
        return

    # Build editable transcript
    transcript = build_editable_transcript(slides_data, narrations)

    # Write output
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(transcript, f, indent=2)

    total_est = sum(t["estimated_duration"] for t in transcript)
    print(f"\n{'='*60}")
    print(f"Generated narration for {len(narrations)}/{len(slides)} slides")
    print(f"Total: ~{total_words} words (~{total_est:.0f}s estimated)")
    print(f"Output: {output_path}")
    print(f"{'='*60}")
    print("\nNext steps:")
    print(f"  1. Review and edit: {output_path}")
    print("  2. Generate TTS:")
    print("     python generate_tts.py \\")
    print("       --transcript <original_transcript> \\")
    print("       --output-dir <tts_dir> \\")
    print(f"       --edit \"{output_path}\" \\")
    print("       --voice-name \"Rachel\" --yes")


if __name__ == "__main__":
    main()
