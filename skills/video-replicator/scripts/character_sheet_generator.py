#!/usr/bin/env python3
"""
Character Sheet Generator — 4-angle reference sheets for Seedance 2.0.

Generates "Nano Banana Pro" format character reference sheets via Go Bananas
REST API: 4 vertical columns (front, left profile, right profile, back view),
full-body on top, close-up portrait below.

Output integrates with:
  - SeedanceCharacterRef (TypeScript: src/video/pipeline.ts)
  - CharacterRef (Python: seedance_prompt_director.py)

Usage:
    python3 character_sheet_generator.py \\
        --name "Hero" \\
        --description "tall warrior with armor" \\
        --output-dir ./images

    python3 character_sheet_generator.py \\
        --name "Villain" \\
        --description "dark sorceress with glowing eyes" \\
        --output-dir ./images \\
        --style "anime" \\
        --aspect-ratio portrait

Environment:
    GO_BANANAS_API_KEY  - API key (required). Sent as X-API-Key to the REST API.
    GO_BANANAS_API_URL  - REST API base URL (default: https://gobananasai.com/api)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Bootstrap: add scripts/video to path so sibling modules are importable
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from generate_gobananas import (
        download_image,
        is_valid_image,
        GB_REST_BASE_URL,
        NO_TEXT_SUFFIX,
        setup_logging,
    )
except ImportError:
    # Minimal fallbacks if generate_gobananas is not available
    GB_REST_BASE_URL = os.environ.get(
        "GO_BANANAS_API_URL", "https://gobananasai.com/api"
    )
    NO_TEXT_SUFFIX = "No text, no titles, no writing, no watermarks"

    def setup_logging(verbose: bool = False) -> None:
        level = logging.DEBUG if verbose else logging.INFO
        logging.basicConfig(
            level=level,
            format="%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%H:%M:%S",
        )

    def is_valid_image(data: bytes) -> bool:
        if len(data) < 1_000:
            return False
        return data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n"

    def download_image(url: str, output_path: str, timeout: int = 60) -> bool:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "videoclaw/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
        except urllib.error.URLError:
            return False
        if not is_valid_image(data):
            return False
        dest = Path(output_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

SHEET_PROMPT_TEMPLATE = (
    "Create a professional character reference sheet of {description}. "
    "CRITICAL: Preserve all outfit details, colors, accessories, hairstyle, and "
    "proportions exactly as written in the description above — do not substitute "
    "or add clothing items that were not specified (no chef whites, no athletic "
    "gear, no uniforms unless the description explicitly says so). "
    "Render as a photorealistic cinematic photograph by default — real human "
    "skin with visible pores and texture, real fabric, real lighting. Only use "
    "an illustrated, anime, watercolor, 3D-render or cartoon style if the "
    "description ABOVE explicitly names that style; never default to "
    "illustration or cartoon for a human character. "
    "Arrange into four vertical columns: front view, left profile, right profile, back view. "
    "Each column: full-body on top, close-up portrait below. "
    "Maintain identical character identity (same face, same outfit, same hair, "
    "same accessories) across all four angles. "
    "Clean neutral background. "
    "Photorealistic cinematic photograph, shot on 35mm film, realistic skin "
    "texture and fabric, natural color grade, sharp focus. Absolutely no "
    "illustration, no anime, no cartoon, no 3D render, no painting. "
    "No text, no labels."
)

# Joey's banana-pro-director 6-panel grid (--character-sheet single-grid).
# Single 16:9 image arranged as a 3-column × 2-row layout. Identity locked
# once at the top; each panel describes only what's different (stance,
# framing, focus). Joey's rule: never produce six separate prompts —
# always one prompt, one image, six panels.
SHEET_PROMPT_TEMPLATE_JOEY_GRID = (
    "A 6-panel character reference sheet arranged as a 3-column by 2-row "
    "grid in a single horizontal frame, separated by thin clean white "
    "gutters between panels. Each panel shows the same single character: "
    "{description}. "
    "CRITICAL: Preserve all outfit details, colors, accessories, hairstyle, "
    "and proportions exactly as written in the description above — do not "
    "substitute or add clothing items that were not specified (no chef whites, "
    "no athletic gear, no uniforms unless the description explicitly says so). "
    "Render as a photorealistic cinematic photograph by default — real human "
    "skin with visible pores and texture, real fabric, real lighting. Only use "
    "an illustrated, anime, watercolor, 3D-render or cartoon style if the "
    "description ABOVE explicitly names that style; never default to "
    "illustration or cartoon for a human character. "
    "Panel 1 (top-left): full body front, straight-on neutral stance, "
    "full styling readable head-to-toe. "
    "Panel 2 (top-center): full body 3/4 turn, body angled 30 degrees "
    "from camera, weight on back hip. "
    "Panel 3 (top-right): full body back, showing hair fall and "
    "accessory details from behind. "
    "Panel 4 (bottom-left): waist-up portrait, head, shoulders, upper "
    "torso. "
    "Panel 5 (bottom-center): hands detail close-up, both hands forward, "
    "ring stack and nail finish visible. "
    "Panel 6 (bottom-right): face detail close-up, tight crop from "
    "collarbone up, earrings, lips, skin texture, eyes. "
    "Pure white seamless studio backdrop uniformly across all six panels. "
    "Soft three-point classical lighting — key from camera-left at 45 "
    "degrees, gentle fill from camera-right, subtle rim defining shoulder "
    "and hair separation — uniformly across all six panels. Sharp focus "
    "across every panel. Identical character identity locked across all "
    "six panels — same face, same skin, same hair, same wardrobe, same "
    "accessories, same proportions in every cell. "
    "Photorealistic cinematic photograph, shot on 35mm film, realistic skin "
    "texture and fabric, natural color grade, sharp focus. Absolutely no "
    "illustration, no anime, no cartoon, no 3D render, no painting. "
    "No text, no labels."
)

FALLBACK_PROMPT_TEMPLATE = (
    "Full-body portrait of {description}. "
    "Front view, standing pose. "
    "Photorealistic, DSLR, muted colors. Shot on 35mm film. No Text."
)

# Close-up portrait — Joey's GPT-2-style face/chest-up detail shot from
# banana-pro-director SKILL.md. Generates a tight beauty-lit portrait so
# the user can verify face identity, skin texture, and styling lock
# BEFORE any Seedance video credits are spent. Routed through the same
# Go Bananas REST endpoint (gemini-pro-image model) — no separate GPT-2
# integration; the template alone is enough to pull face fidelity.
CLOSEUP_PROMPT_TEMPLATE = (
    "Chest-up portrait of {description}. "
    "Pure white seamless studio background. Classical beauty lighting — "
    "soft key from slightly above and camera-left at 35 degrees, soft "
    "fill at chest level from camera-right, subtle hair light behind "
    "defining the crown, soft underlight bounce lifting the eye sockets. "
    "Tight crop from collarbone up. "
    "Extreme face fidelity: real skin texture with visible pores, fine "
    "peach fuzz catching light along the jawline and upper lip, subtle "
    "subsurface scattering on the nose bridge cheeks and ears, "
    "micro-expression detail in the eyes and mouth corners, individual "
    "lash detail, real moisture and reflection in the iris with visible "
    "iris pattern, real lip texture with subtle natural lip lines, hair "
    "rendered strand by strand at the hairline with visible baby hairs "
    "and flyaways, fabric weave visible at the collar and shoulder. "
    "Photorealistic, DSLR. Shot on 35mm film. No Text."
)


# Valid character-sheet shapes. Keep in sync with TS CharacterSheetShape enum
# in src/video/joey-flags.ts. 'multi' is the historical default (4-column,
# 8-cell sheet from SHEET_PROMPT_TEMPLATE). 'single-grid' switches to
# Joey's 6-panel 3×2 grid.
SHEET_SHAPES = ("multi", "single-grid")


def build_sheet_prompt(
    description: str,
    style: str = "",
    shape: str = "multi",
) -> str:
    """Build the character reference sheet prompt.

    Args:
        description: Character description (e.g. "tall warrior with armor").
        style: Optional style modifier (e.g. "anime", "Disney Pixar 3D").
        shape: 'multi' (default — 4-column 8-cell sheet) or 'single-grid'
            (Joey's 6-panel 3×2 grid). Honors VC_JOEY_CHARACTER_SHEET env
            var indirectly via the caller in main().

    Returns:
        Formatted prompt string.
    """
    if shape not in SHEET_SHAPES:
        raise ValueError(
            f"Unknown character-sheet shape: {shape!r}. "
            f"Valid: {SHEET_SHAPES}"
        )
    template = (
        SHEET_PROMPT_TEMPLATE_JOEY_GRID if shape == "single-grid"
        else SHEET_PROMPT_TEMPLATE
    )
    prompt = template.format(description=description)
    if style:
        # Apply the style as a colour-grade modifier ONLY — never strip the
        # photoreal anchor. A cinematic preset (e.g. "wong-kar-wai") used to
        # replace "Photorealistic, DSLR" wholesale, which made human
        # characters render cartoony. Keep "Photorealistic cinematic
        # photograph" and just tint the grade.
        prompt = prompt.replace("natural color grade", f"{style} color grade")
    return prompt


def build_fallback_prompt(description: str, style: str = "") -> str:
    """Build a simpler single-image fallback prompt.

    Used when the multi-angle sheet generation fails.

    Args:
        description: Character description.
        style: Optional style modifier.

    Returns:
        Formatted prompt string.
    """
    prompt = FALLBACK_PROMPT_TEMPLATE.format(description=description)
    if style:
        prompt = prompt.replace("Photorealistic, DSLR, muted colors", f"{style}, muted colors")
    return prompt


def build_closeup_prompt(description: str, style: str = "") -> str:
    """Build a chest-up close-up portrait prompt (Joey GPT-2-style).

    Used for verifying face identity + styling lock independently of the
    full character sheet. Tight beauty-lit framing emphasizes skin
    texture, eye detail, and hair edge — the things that drift first.

    Args:
        description: Character description.
        style: Optional style modifier (e.g. "anime", "Disney Pixar 3D").

    Returns:
        Formatted prompt string.
    """
    prompt = CLOSEUP_PROMPT_TEMPLATE.format(description=description)
    if style:
        prompt = prompt.replace("Photorealistic, DSLR", f"{style}, DSLR")
    return prompt


def _sanitize_filename(name: str) -> str:
    """Sanitize a character name into a safe filename component.

    Lowercases, replaces non-alphanumeric with underscores, collapses runs.
    """
    safe = name.lower().strip()
    safe = "".join(c if c.isalnum() else "_" for c in safe)
    # Collapse runs of underscores
    while "__" in safe:
        safe = safe.replace("__", "_")
    return safe.strip("_") or "character"


# ---------------------------------------------------------------------------
# Go Bananas REST API call
# ---------------------------------------------------------------------------


def _call_go_bananas_api(
    prompt: str,
    api_key: str,
    aspect_ratio: str = "landscape",
    model_id: str = "gemini-pro-image",
    character_id: int | None = None,
) -> str | None:
    """Call Go Bananas REST API to generate an image.

    Args:
        prompt: Image generation prompt.
        api_key: GO_BANANAS_API_KEY for X-API-Key auth.
        aspect_ratio: One of "16:9", "9:16", "1:1".
        model_id: Model to use (default: gemini-pro-image).
        character_id: Optional Go Bananas character ID. When provided, the
            character's stored reference images are pulled in by the
            backend — identity locks across sheet, close-up, and scene
            generations (all three see the same reference set). This is
            the Joey base-reference-first pattern: one source of truth
            for face/hair/wardrobe rather than independent rolls from
            description text.

    Returns:
        Image URL on success, None on failure.
    """
    url = f"{GB_REST_BASE_URL}/images"

    payload: dict = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "model_id": model_id,
        "enhance_prompt": False,
        "negative_prompt": "text, watermark, logo, title, blurry, deformed",
    }
    if character_id is not None:
        payload["character_id"] = character_id

    body = json.dumps(payload).encode()
    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
    }

    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    logger.debug("REST generate: %s", url)
    logger.debug("Payload: %s", json.dumps(payload))

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()[:300]
        logger.error("REST API HTTP %s: %s", e.code, body_text)
        return None
    except Exception as e:
        logger.error("REST API request failed: %s", e)
        return None

    # Extract URL from current Go Bananas REST response shapes.
    img_url = (
        data.get("url")
        or data.get("image_url")
        or (data.get("data") or {}).get("url")
    )
    if not img_url and isinstance(data.get("data"), dict):
        images = data["data"].get("images")
        if isinstance(images, list) and images:
            first = images[0]
            if isinstance(first, dict):
                img_url = first.get("full_url") or first.get("url")
    if not img_url and data.get("images"):
        img_url = data["images"][0].get("full_url") or data["images"][0].get("url")

    if not img_url:
        logger.error("No URL in REST response: %s", json.dumps(data)[:300])
        return None

    return img_url


# ---------------------------------------------------------------------------
# Core generation function
# ---------------------------------------------------------------------------


def _resolve_sheet_shape(shape: str | None) -> str:
    """Resolve sheet shape from explicit arg, env var, or default.

    Order: explicit `shape` arg > VC_JOEY_CHARACTER_SHEET env var > 'multi'.
    """
    if shape and shape in SHEET_SHAPES:
        return shape
    env_shape = os.environ.get("VC_JOEY_CHARACTER_SHEET")
    if env_shape and env_shape in SHEET_SHAPES:
        return env_shape
    return "multi"


def generate_character_sheet_url(
    description: str,
    style: str = "",
    aspect_ratio: str = "landscape",
    api_key: str | None = None,
    shape: str | None = None,
    character_id: int | None = None,
) -> str | None:
    """Generate a character reference sheet and return the Go Bananas CDN URL.

    Returned URL is already publicly hostable and accepted by
    /upload-for-editing — callers can skip download + re-host entirely.
    Falls back to a single-portrait prompt if the multi-view sheet fails.

    Args:
        description: Character description.
        style: Optional style modifier.
        aspect_ratio: "landscape" / "portrait" / "square".
        api_key: GO_BANANAS_API_KEY override.
        shape: 'multi' (4-column 8-cell sheet) or 'single-grid' (Joey's
            6-panel 3×2 grid). Defaults from VC_JOEY_CHARACTER_SHEET env
            var when not given explicitly.
        character_id: Optional Go Bananas character ID. When provided,
            the backend pulls the character's reference images into the
            generation — identity locks across sheet, close-up, and
            scene calls (Joey base-reference-first rule).
    """
    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")
    if not api_key:
        return None
    ratio_map = {"landscape": "16:9", "portrait": "9:16", "square": "1:1"}
    api_ratio = ratio_map.get(aspect_ratio, aspect_ratio)
    resolved_shape = _resolve_sheet_shape(shape)
    sheet_prompt = build_sheet_prompt(description, style, shape=resolved_shape)
    img_url = _call_go_bananas_api(
        prompt=sheet_prompt, api_key=api_key, aspect_ratio=api_ratio,
        character_id=character_id,
    )
    if img_url:
        return img_url
    fallback_prompt = build_fallback_prompt(description, style)
    return _call_go_bananas_api(
        prompt=fallback_prompt, api_key=api_key, aspect_ratio="9:16",
        character_id=character_id,
    )


def generate_character_sheet(
    description: str,
    name: str,
    output_dir: str,
    style: str = "",
    aspect_ratio: str = "landscape",
    api_key: str | None = None,
    shape: str | None = None,
    character_id: int | None = None,
) -> str:
    """Generate a character reference sheet image.

    Calls Go Bananas REST API with the Nano Banana Pro sheet prompt.
    Falls back to a simpler single-portrait prompt if the sheet generation fails.
    Saves the result to {output_dir}/{name}_sheet.jpg.

    Args:
        description: Character description (e.g. "tall warrior with plate armor").
        name: Character name (used for filename).
        output_dir: Directory to save the sheet image.
        style: Optional style override (default: photorealistic).
        aspect_ratio: Aspect ratio — "landscape" (default, best for 4-column layout),
                      "portrait", or "square".
        api_key: GO_BANANAS_API_KEY. Falls back to env var if not provided.
        shape: 'multi' (default — 4-column 8-cell sheet) or 'single-grid'
            (Joey's 6-panel 3×2 grid from --character-sheet single-grid).
            Resolved from VC_JOEY_CHARACTER_SHEET env var when not given.

    Returns:
        Absolute path to the saved sheet image.

    Raises:
        ValueError: If api_key is not provided and GO_BANANAS_API_KEY env var is not set.
        RuntimeError: If both sheet and fallback generation fail.
    """
    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")
    if not api_key:
        raise ValueError(
            "GO_BANANAS_API_KEY not set. Provide api_key argument or set the environment variable."
        )

    # Map friendly names to API ratio strings
    ratio_map = {"landscape": "16:9", "portrait": "9:16", "square": "1:1"}
    api_ratio = ratio_map.get(aspect_ratio, aspect_ratio)

    # Build output path
    safe_name = _sanitize_filename(name)
    output_path = os.path.join(output_dir, f"{safe_name}_sheet.jpg")

    # Ensure output directory exists
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # --- Attempt 1: Full character sheet (shape determines layout) ---
    resolved_shape = _resolve_sheet_shape(shape)
    sheet_prompt = build_sheet_prompt(description, style, shape=resolved_shape)
    layout_label = "6-panel 3x2 grid" if resolved_shape == "single-grid" else "4-angle sheet"
    logger.info(
        "Generating %s for '%s': %s",
        layout_label,
        name,
        sheet_prompt[:100] + "..." if len(sheet_prompt) > 100 else sheet_prompt,
    )

    img_url = _call_go_bananas_api(
        prompt=sheet_prompt,
        api_key=api_key,
        aspect_ratio=api_ratio,
        character_id=character_id,
    )

    if img_url:
        logger.info("Sheet image URL: %s", img_url)
        if download_image(img_url, output_path):
            logger.info("Saved sheet: %s", output_path)
            return os.path.abspath(output_path)
        logger.warning("Sheet download failed, trying fallback")

    # --- Attempt 2: Simpler single-portrait fallback ---
    logger.info("Falling back to single-portrait generation for '%s'", name)
    fallback_prompt = build_fallback_prompt(description, style)

    img_url = _call_go_bananas_api(
        prompt=fallback_prompt,
        api_key=api_key,
        aspect_ratio="9:16",  # Portrait orientation for single character
        character_id=character_id,
    )

    if img_url:
        logger.info("Fallback image URL: %s", img_url)
        if download_image(img_url, output_path):
            logger.info("Saved fallback sheet: %s", output_path)
            return os.path.abspath(output_path)

    raise RuntimeError(
        f"Failed to generate character sheet for '{name}'. "
        "Both 4-angle sheet and single-portrait fallback failed."
    )


def generate_character_closeup(
    description: str,
    name: str,
    output_dir: str,
    style: str = "",
    api_key: str | None = None,
    character_id: int | None = None,
) -> str:
    """Generate a Joey GPT-2-style close-up portrait for a character.

    Tight chest-up beauty-lit shot meant to verify face identity and
    styling lock independently of the full character sheet. Lives at
    {output_dir}/{name}_closeup.jpg.

    Aspect ratio is fixed to 9:16 (portrait) since this is a face shot.

    Args:
        description: Character description.
        name: Character name (used for filename).
        output_dir: Directory to save the close-up.
        style: Optional style override.
        api_key: GO_BANANAS_API_KEY. Falls back to env var.
        character_id: Optional Go Bananas character ID. When provided,
            the close-up generation pulls the character's reference
            images alongside the description — face/hair/wardrobe stay
            locked to the same identity used for the sheet and scenes.

    Returns:
        Absolute path to the saved close-up image.

    Raises:
        ValueError: When api_key is unavailable.
        RuntimeError: When generation or download fails.
    """
    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")
    if not api_key:
        raise ValueError(
            "GO_BANANAS_API_KEY not set. Provide api_key argument or set the environment variable."
        )

    safe_name = _sanitize_filename(name)
    output_path = os.path.join(output_dir, f"{safe_name}_closeup.jpg")
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    closeup_prompt = build_closeup_prompt(description, style)
    logger.info(
        "Generating close-up for '%s': %s",
        name,
        closeup_prompt[:100] + "..." if len(closeup_prompt) > 100 else closeup_prompt,
    )

    img_url = _call_go_bananas_api(
        prompt=closeup_prompt,
        api_key=api_key,
        aspect_ratio="9:16",
        character_id=character_id,
    )
    if not img_url:
        raise RuntimeError(f"Close-up generation failed for '{name}' — API returned no URL.")
    if not download_image(img_url, output_path):
        raise RuntimeError(f"Close-up download failed for '{name}' (URL: {img_url}).")
    logger.info("Saved close-up: %s", output_path)
    return os.path.abspath(output_path)


# ---------------------------------------------------------------------------
# Batch generation
# ---------------------------------------------------------------------------


def generate_sheets_from_manifest(
    manifest: list[dict],
    output_dir: str,
    style: str = "",
    api_key: str | None = None,
    with_closeups: bool = False,
) -> list[dict]:
    """Generate sheets for multiple characters from a manifest.

    Args:
        manifest: List of dicts with "name" and "description" keys.
        output_dir: Directory to save all sheets.
        style: Optional style override.
        api_key: GO_BANANAS_API_KEY.
        with_closeups: When True, also emit a Joey GPT-2-style close-up
            portrait per character (`{name}_closeup.jpg`). Result entries
            gain a `closeup_image` field. A close-up failure is logged but
            does NOT mark the entry as failed — the sheet is the primary
            artifact.

    Returns:
        List of dicts with "name", "sheet_image", "status", and (when
        with_closeups is set) "closeup_image" keys. Compatible with
        SeedanceCharacterRef / CharacterRef.
    """
    results: list[dict] = []

    for entry in manifest:
        name = entry["name"]
        description = entry["description"]
        # Optional Go Bananas character ID — when present, both sheet and
        # close-up generations pull the character's reference images so
        # identity locks across all three (sheet, close-up, future scene
        # plates). Joey base-reference-first rule.
        cid_raw = entry.get("character_id")
        char_id: int | None = int(cid_raw) if isinstance(cid_raw, (int, str)) and str(cid_raw).isdigit() else None

        try:
            sheet_path = generate_character_sheet(
                description=description,
                name=name,
                output_dir=output_dir,
                style=style,
                api_key=api_key,
                character_id=char_id,
            )
            entry_result: dict = {
                "name": name,
                "sheet_image": sheet_path,
                "status": "ok",
            }
            if char_id is not None:
                entry_result["character_id"] = char_id
            if with_closeups:
                try:
                    closeup_path = generate_character_closeup(
                        description=description,
                        name=name,
                        output_dir=output_dir,
                        style=style,
                        api_key=api_key,
                        character_id=char_id,
                    )
                    entry_result["closeup_image"] = closeup_path
                    logger.info("[OK closeup] %s -> %s", name, closeup_path)
                except (ValueError, RuntimeError) as e:
                    entry_result["closeup_image"] = ""
                    entry_result["closeup_error"] = str(e)
                    logger.warning(
                        "[WARN closeup] %s: %s (sheet still produced)", name, e,
                    )
            results.append(entry_result)
            logger.info("[OK] %s -> %s", name, sheet_path)
        except (ValueError, RuntimeError) as e:
            results.append({
                "name": name,
                "sheet_image": "",
                "status": f"error: {e}",
            })
            logger.error("[FAIL] %s: %s", name, e)

    succeeded = sum(1 for r in results if r["status"] == "ok")
    logger.info("Batch complete: %d/%d succeeded", succeeded, len(results))

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate 4-angle character reference sheets via Go Bananas.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Single character
  python3 character_sheet_generator.py \\
      --name "Hero" \\
      --description "tall warrior with plate armor and red cape" \\
      --output-dir ./images

  # With style override
  python3 character_sheet_generator.py \\
      --name "Princess" \\
      --description "young princess with flowing golden hair" \\
      --output-dir ./images \\
      --style "Disney Pixar 3D animated"

  # Batch from manifest
  python3 character_sheet_generator.py \\
      --batch-manifest characters.json \\
      --output-dir ./images

Batch manifest format:
  [
    {"name": "Hero", "description": "tall warrior with plate armor"},
    {"name": "Villain", "description": "dark sorceress with glowing eyes"}
  ]

Environment:
  GO_BANANAS_API_KEY  API key (required)
  GO_BANANAS_API_URL  REST API base (default: https://gobananasai.com/api)
""",
    )

    parser.add_argument(
        "--name",
        help="Character name (used for filename, required for single mode)",
    )
    parser.add_argument(
        "--description",
        help="Character description (required for single mode)",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory to save generated sheet images",
    )
    parser.add_argument(
        "--style",
        default="",
        help="Style override (e.g. 'anime', 'Disney Pixar 3D animated')",
    )
    parser.add_argument(
        "--aspect-ratio",
        choices=["landscape", "portrait", "square"],
        default="landscape",
        help="Aspect ratio (default: landscape — best for 4-column layout)",
    )
    parser.add_argument(
        "--batch-manifest",
        metavar="PATH",
        help="JSON file with array of {name, description} objects for batch generation",
    )
    parser.add_argument(
        "--with-closeups",
        action="store_true",
        help=(
            "Also emit a Joey GPT-2-style chest-up close-up portrait per "
            "character (`{name}_closeup.jpg`) for face/identity verification "
            "before video generation. Honored in both single and batch modes. "
            "Defaults from VC_JOEY_PREVIEW_CLOSEUPS=1."
        ),
    )
    parser.add_argument(
        "--character-id",
        type=int,
        default=None,
        help=(
            "Optional Go Bananas character ID. When provided, the backend "
            "pulls the character's reference images into BOTH the sheet "
            "and close-up generations so face/hair/wardrobe stay locked "
            "to the same identity used for scenes. Joey base-reference-"
            "first rule. Single mode only — batch mode reads "
            "character_id per entry from the manifest."
        ),
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose debug output")

    args = parser.parse_args()
    setup_logging(verbose=args.verbose)

    api_key = os.environ.get("GO_BANANAS_API_KEY")
    if not api_key:
        logger.error("GO_BANANAS_API_KEY environment variable not set")
        sys.exit(1)

    # Close-ups are gated by either the explicit CLI flag or the env var
    # set by the TS executor's JoeyFlags bridge.
    with_closeups = args.with_closeups or os.environ.get("VC_JOEY_PREVIEW_CLOSEUPS") == "1"

    # Batch mode
    if args.batch_manifest:
        with open(args.batch_manifest) as f:
            manifest = json.load(f)
        if not isinstance(manifest, list):
            logger.error("Batch manifest must be a JSON array")
            sys.exit(1)

        results = generate_sheets_from_manifest(
            manifest=manifest,
            output_dir=args.output_dir,
            style=args.style,
            api_key=api_key,
            with_closeups=with_closeups,
        )

        # Print summary
        for r in results:
            status = "OK" if r["status"] == "ok" else "FAIL"
            line = f"  [{status}] {r['name']}: {r['sheet_image'] or r['status']}"
            if "closeup_image" in r:
                line += f"  closeup={r['closeup_image'] or r.get('closeup_error', '?')}"
            print(line)

        failures = sum(1 for r in results if r["status"] != "ok")
        sys.exit(0 if failures == 0 else 1)

    # Single mode — require --name and --description
    if not args.name or not args.description:
        parser.error("Single mode requires --name and --description")

    try:
        sheet_path = generate_character_sheet(
            description=args.description,
            name=args.name,
            output_dir=args.output_dir,
            style=args.style,
            aspect_ratio=args.aspect_ratio,
            api_key=api_key,
            character_id=args.character_id,
        )
        print(f"Sheet saved: {sheet_path}")
        if with_closeups:
            try:
                closeup_path = generate_character_closeup(
                    description=args.description,
                    name=args.name,
                    output_dir=args.output_dir,
                    style=args.style,
                    api_key=api_key,
                    character_id=args.character_id,
                )
                print(f"Close-up saved: {closeup_path}")
            except (ValueError, RuntimeError) as e:
                # Close-up failure is non-fatal — sheet already saved.
                logger.warning("Close-up generation failed: %s", e)
    except (ValueError, RuntimeError) as e:
        logger.error("Generation failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
