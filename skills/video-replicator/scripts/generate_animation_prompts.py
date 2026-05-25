#!/usr/bin/env python3
"""
Generate animation prompts for presentation slides using Gemini Vision.

Analyzes each restyled slide image and produces motion prompts appropriate
for the chosen animation style (Cinematic, Dynamic, or Subtle).

Usage:
    # Auto-generate prompts for all slides
    python generate_animation_prompts.py \
      --slides-json "projects/{slug}/analysis/slides.json" \
      --images-dir "projects/{slug}/images" \
      --output "projects/{slug}/analysis/animation_prompts.json" \
      --style dynamic

    # Dry-run (preview which images would be analyzed)
    python generate_animation_prompts.py \
      --slides-json "projects/{slug}/analysis/slides.json" \
      --images-dir "projects/{slug}/images" \
      --dry-run
"""

import argparse
import base64
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from logging_config import setup_logging

# Logger configured in main() with --verbose flag; default INFO for library use
logger = setup_logging(__name__)


CINEMATIC_SYSTEM_PROMPT = """You are a professional motion designer creating animation prompts for Veo 3 video generation (image-to-video mode).

You will be shown a single slide image from a presentation. Your task is to describe how the elements in this image should animate over 8 seconds.

Rules:
- Describe MOTION only — do not describe what's in the image (Veo already sees the image)
- Camera movements are allowed: slow push in, drift, pan, zoom
- Focus on element-specific animations: pulsing, glowing, rotating, flowing, breathing
- Identify key visual elements (icons, figures, text, charts, circuits, particles) and animate each
- Keep the animation professional and elegant — no chaotic movement
- Motion should build gradually over the 8 seconds
- Output ONLY the prompt text, no explanations or formatting

Example output:
Camera: very slow push in. Anatomical figure subtly breathes with chest expansion. Circuit traces pulse with traveling light signals. Icons glow and fade sequentially. Particles drift upward slowly."""

DYNAMIC_SYSTEM_PROMPT = """You are a professional motion designer creating animation prompts for Veo 3 video generation (frames-to-video mode with same start and end frame).

You will be shown a single slide image from a presentation. Your task is to describe how the elements should animate over 8 seconds AND RETURN to their starting positions, creating a seamless loop.

Rules:
- Camera MUST be static (no push in, zoom, pan, drift) — the start and end frames are identical
- Every motion must be cyclical: elements animate then return to original position
- Focus on: pulsing, breathing, orbiting, rotating (full cycles), flowing in loops
- Identify key visual elements and give each a cyclical animation
- Use phrases like "returns to original position", "completes one full rotation", "pulses then dims back"
- Keep motion smooth and continuous — designed for seamless looping
- Output ONLY the prompt text, no explanations or formatting

Example output:
Camera: static. Anatomical figure subtly breathes, chest expanding and contracting back. Circuit traces pulse with traveling light cycling continuously. DNA helix completes one full rotation back to start. Particles drift upward then fade and regenerate from below in cycle."""

SUBTLE_SYSTEM_PROMPT = """You are a professional motion designer creating minimal animation prompts for Veo 3 video generation (frames-to-video mode with same start and end frame).

You will be shown a single slide image from a presentation. Your task is to describe MINIMAL, barely perceptible motion over 8 seconds that returns to the starting position.

Rules:
- Camera MUST be absolutely static — no push in, zoom, pan, drift, or any camera movement
- Pick ONLY ONE subtle motion from this list: gentle ambient light shift, soft background color transition, very slow gradient hue drift, or faint background glow pulse
- 70-80% of the frame must remain COMPLETELY STILL — no movement at all
- Do NOT animate text, icons, figures, charts, diagrams, or any foreground elements
- Do NOT add sparkles, particles, parallax, organic motion, or floating elements
- Motion amplitude must be minimal — barely perceptible, almost like a static image
- The motion must loop seamlessly (return to original state)
- Output ONLY the prompt text, no explanations or formatting

Example output:
Camera: static. Background gradient subtly shifts hue over 8 seconds then returns. All text, icons, and foreground elements remain completely still."""


def find_slide_image(images_dir: str, slide_num: int) -> str | None:
    """Find the restyled image for a slide number."""
    patterns = [
        f"scene_{slide_num}_frame_landscape.jpg",
        f"scene_{slide_num}_frame.jpg",
        f"run*_scene_{slide_num}_frame_landscape.jpg",
        f"run*_scene_{slide_num}_frame.jpg",
        f"scene_{slide_num}_frame.png",
    ]
    for pattern in patterns:
        matches = glob.glob(os.path.join(images_dir, pattern))
        if matches:
            return sorted(matches)[-1]  # Latest match
    return None


import time as _time

# Generic fallback templates based on slide content type
FALLBACK_TEMPLATES = {
    "title": "Camera: static. Gentle ambient light shift across background. All text and foreground elements remain still.",
    "content": "Camera: static. Subtle background color transition over 8 seconds. All text and icons remain still.",
    "chart": "Camera: static. Very gentle background gradient shift. Chart and data elements remain still.",
    "diagram": "Camera: static. Soft ambient light slowly shifts across background. Diagram elements remain still.",
    "image": "Camera: static. Faint background glow pulse over 8 seconds. Image content remains still.",
    "default": "Camera: static. Very gentle ambient light breathing. All elements remain still.",
}


def generate_prompt_gemini(
    image_path: str,
    style: str,
    max_retries: int = 3,
    fallback_template: str | None = None,
) -> str | None:
    """Use Gemini Vision to generate an animation prompt for a slide image.

    Args:
        image_path: Path to the slide image
        style: Animation style ("cinematic" or "dynamic")
        max_retries: Max retry attempts for rate limit errors (default: 3)
        fallback_template: Fallback template type if API fails ("title", "content", etc.)

    Returns:
        Animation prompt string, or None on failure
    """
    try:
        import google.generativeai as genai
    except ImportError:
        logger.error("google-generativeai not installed. Run: pip install google-generativeai")
        return _get_fallback(fallback_template)

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("GOOGLE_API_KEY not set")
        return _get_fallback(fallback_template)

    genai.configure(api_key=api_key)

    if style == "dynamic":
        system_prompt = DYNAMIC_SYSTEM_PROMPT
    elif style == "subtle":
        system_prompt = SUBTLE_SYSTEM_PROMPT
    else:
        system_prompt = CINEMATIC_SYSTEM_PROMPT

    # Read image
    with open(image_path, "rb") as f:
        image_data = f.read()

    mime_type = "image/jpeg" if image_path.lower().endswith(".jpg") else "image/png"

    model = genai.GenerativeModel("gemini-3-flash-preview")

    # Retry with exponential backoff for rate limits
    for attempt in range(max_retries + 1):
        try:
            response = model.generate_content(
                [
                    {"text": system_prompt},
                    {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_data).decode()}},
                    {"text": "Generate the animation prompt for this slide image."},
                ],
                generation_config={"temperature": 0.7, "max_output_tokens": 300},
            )

            if response and response.text:
                return response.text.strip()
            return _get_fallback(fallback_template)

        except Exception as e:
            error_str = str(e)
            is_rate_limit = "429" in error_str or "quota" in error_str.lower() or "rate" in error_str.lower()

            if is_rate_limit and attempt < max_retries:
                wait_time = 30 * (2 ** attempt)  # 30s, 60s, 120s
                logger.warning(f"Rate limited, waiting {wait_time}s (attempt {attempt + 1}/{max_retries})...")
                _time.sleep(wait_time)
            else:
                logger.error(f"Gemini API error: {error_str[:200]}")
                return _get_fallback(fallback_template)

    return _get_fallback(fallback_template)


def _get_fallback(template_type: str | None) -> str | None:
    """Return a fallback template if specified, else None."""
    if template_type:
        prompt = FALLBACK_TEMPLATES.get(template_type, FALLBACK_TEMPLATES["default"])
        logger.info(f"Using fallback template: {template_type}")
        return prompt
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Generate animation prompts for presentation slides using Gemini Vision"
    )
    parser.add_argument("--slides-json", required=True, help="Path to slides.json from detect-slides")
    parser.add_argument("--images-dir", required=True, help="Directory with restyled slide images")
    parser.add_argument("--output", help="Output path for animation_prompts.json")
    parser.add_argument("--style", choices=["cinematic", "dynamic", "subtle"], default="dynamic",
                        help="Animation style: cinematic (camera moves), dynamic (seamless loop), or subtle (minimal motion for presentations)")
    parser.add_argument("--scenes", help="Comma-separated slide numbers to generate (default: all)")
    parser.add_argument("--max-retries", type=int, default=3,
                        help="Max retries for rate limit errors (default: 3)")
    parser.add_argument("--fallback-template",
                        choices=["title", "content", "chart", "diagram", "image", "default"],
                        default=None,
                        help="Use generic template when Gemini API is unavailable")
    parser.add_argument("--dry-run", action="store_true", help="Preview without calling Gemini API")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Reconfigure logger level with verbose flag
    if args.verbose:
        import logging
        logger.setLevel(logging.DEBUG)
        for handler in logger.handlers:
            handler.setLevel(logging.DEBUG)

    # Load slides.json
    with open(args.slides_json) as f:
        slides_data = json.load(f)

    slides = slides_data.get("slides", [])
    if not slides:
        logger.error("No slides found in slides.json")
        sys.exit(1)

    # Filter scenes if specified
    if args.scenes:
        scene_nums = [int(s.strip()) for s in args.scenes.split(",")]
        slides = [s for s in slides if s["slide"] in scene_nums]

    # Default output path
    output_path = args.output or os.path.join(
        os.path.dirname(args.slides_json), "animation_prompts.json"
    )

    logger.info("=" * 60)
    logger.info(f"Animation Prompt Generation ({args.style} style)")
    logger.info("=" * 60)
    logger.info(f"Slides: {len(slides)}")
    logger.info(f"Images: {args.images_dir}")
    logger.info(f"Style: {args.style}")

    # Load existing prompts for resume support
    prompts = {}
    if os.path.exists(output_path) and not args.dry_run:
        try:
            with open(output_path) as f:
                prompts = json.load(f)
            if prompts:
                logger.info(f"Resuming: {len(prompts)} existing prompts loaded from {output_path}")
        except (OSError, json.JSONDecodeError):
            prompts = {}

    for slide in slides:
        slide_num = slide["slide"]
        image_path = find_slide_image(args.images_dir, slide_num)

        if str(slide_num) in prompts:
            logger.debug(f"Slide {slide_num}: Already has prompt, skipping (resume)")
            continue

        if not image_path:
            logger.warning(f"Slide {slide_num}: No image found, skipping")
            continue

        if args.dry_run:
            logger.info(f"Slide {slide_num}: Would analyze {os.path.basename(image_path)}")
            continue

        logger.info(f"Slide {slide_num}: Analyzing {os.path.basename(image_path)}...")
        prompt = generate_prompt_gemini(
            image_path, args.style,
            max_retries=args.max_retries,
            fallback_template=args.fallback_template,
        )

        if prompt:
            prompts[str(slide_num)] = prompt
            logger.info(f"Slide {slide_num} prompt: {prompt[:80]}...")
            # Save progress incrementally so partial runs can be resumed
            os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
            with open(output_path, "w") as f:
                json.dump(prompts, f, indent=2)
        else:
            logger.error(f"FAILED to generate prompt for slide {slide_num}")

    if args.dry_run:
        logger.info(f"Dry run complete. Would generate {len(slides)} prompts.")
        return

    # Write output
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(prompts, f, indent=2)

    logger.info("=" * 60)
    logger.info(f"Generated {len(prompts)}/{len(slides)} animation prompts")
    logger.info(f"Output: {output_path}")
    logger.info("=" * 60)

    # Also update slides.json with prompts
    for slide in slides_data.get("slides", []):
        slide_key = str(slide["slide"])
        if slide_key in prompts:
            slide["animation_prompt"] = prompts[slide_key]

    with open(args.slides_json, "w") as f:
        json.dump(slides_data, f, indent=2)
    logger.info("Updated slides.json with animation prompts")


if __name__ == "__main__":
    main()
