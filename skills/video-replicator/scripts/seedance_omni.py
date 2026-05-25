#!/usr/bin/env python3
"""
Seedance 2.0 Omni Reference — multi-image, time-segmented video generation.

Generates cinematic videos using Seedance's omni_reference mode, which accepts
up to 4 reference images and a time-segmented prompt describing how each image
appears across scenes within the video.

Supports single-shot (≤15s) and chained multi-segment (16-60s) generation.
Uses Gemini to auto-generate time-segmented prompts from a concept brief.

Usage:
    # Interactive — concept + images → Gemini prompt → review → generate
    python seedance_omni.py \\
        --concept "Kids organic food ad, family picnic in tropical garden" \\
        --images "product:path/to/bag.png" "environment:path/to/villa.jpg" \\
                 "character:path/to/model.jpg" "logo:path/to/logo.png" \\
        --duration 15 --ratio landscape --quality fast --yes

    # Chained 30s video (2 segments × 15s, crossfade joined)
    python seedance_omni.py \\
        --concept "Luxury resort experience, morning to evening" \\
        --images "environment:pool.jpg" "product:bottle.png" "logo:logo.png" \\
        --duration 30 --ratio landscape --quality fast --yes

    # Dry-run to preview prompts and cost
    python seedance_omni.py \\
        --concept "Sportswear brand reveal" \\
        --images "product:jacket.jpg" "character:model.jpg" \\
        --duration 15 --dry-run

    # Multiple variants
    python seedance_omni.py \\
        --concept "Wedding venue showcase" \\
        --images "environment:venue1.jpg" "environment:venue2.jpg" \\
        --duration 15 --variants 2 --yes

    # Direct prompt (skip Gemini, provide your own time-segmented prompt)
    python seedance_omni.py \\
        --prompt "Scene 1 (0-5s): @image_file_1 bag on table..." \\
        --images "product:bag.png" "environment:villa.jpg" \\
        --duration 15 --yes
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Add scripts dir to path for sibling imports
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    GEMINI_FLASH_MODEL,
    LANDSCAPE_HEIGHT,
    LANDSCAPE_WIDTH,
    SEEDANCE_CREATE_URL,
    SEEDANCE_MODEL_ID,
    SEEDANCE_OMNI_CREDITS_PER_SEGMENT,
    SEEDANCE_OMNI_CROSSFADE_DURATION,
    SEEDANCE_OMNI_FUNCTION_MODE,
    SEEDANCE_OMNI_IMAGE_ROLES,
    SEEDANCE_OMNI_MAX_DURATION,
    SEEDANCE_OMNI_MAX_IMAGES,
    SEEDANCE_OMNI_MAX_SEGMENTS,
    SEEDANCE_OMNI_SEGMENT_DURATION,
    SEEDANCE_QUALITY_MAP,
    SEEDANCE_RATIO_MAP,
)
from exceptions import SeedanceError
from logging_config import ProgressLogger, setup_logging
from seedance_client import is_content_violation, pre_validate_prompt, sanitize_prompt

logger = setup_logging(__name__)


# ============================================================================
# Image Role Mapping
# ============================================================================

def parse_image_args(image_args: list[str]) -> list[dict]:
    """Parse --images arguments into structured image dicts.

    Accepts:
        "role:path"  — e.g. "product:/path/to/bag.png"
        "path"       — auto-assigns role based on position

    Valid roles: product, environment, character, logo

    Returns:
        List of {"role": str, "path": str} dicts
    """
    images = []
    auto_roles = list(SEEDANCE_OMNI_IMAGE_ROLES)  # copy for pop

    for arg in image_args:
        if ":" in arg and not arg.startswith("/") and not arg.startswith("http"):
            # Check if it's role:path (not a Windows path or URL)
            parts = arg.split(":", 1)
            role = parts[0].lower().strip()
            path = parts[1].strip()
            if role not in SEEDANCE_OMNI_IMAGE_ROLES:
                logger.warning("Unknown role '%s', treating as path", role)
                role = auto_roles.pop(0) if auto_roles else "reference"
                path = arg
        else:
            # Auto-assign role
            role = auto_roles.pop(0) if auto_roles else "reference"
            path = arg

        images.append({"role": role, "path": path})

    return images


def validate_images(images: list[dict]) -> list[str]:
    """Validate image files exist and count is within limits.

    Returns list of error strings (empty = valid).
    """
    errors = []
    if len(images) > SEEDANCE_OMNI_MAX_IMAGES:
        errors.append(
            f"Too many images: {len(images)} (max {SEEDANCE_OMNI_MAX_IMAGES})"
        )
    if not images:
        errors.append("At least one image is required")

    for img in images:
        path = img["path"]
        if not path.startswith("http") and not os.path.isfile(path):
            errors.append(f"Image not found: {path}")

    return errors


# ============================================================================
# Segment Calculation
# ============================================================================

def calculate_segments(total_duration: int) -> list[dict]:
    """Calculate time segments for the given total duration.

    Each segment is ≤15s. Returns list of {"index": N, "start": s, "end": e, "duration": d}.

    Rules:
        ≤15s  → 1 segment
        16-30s → 2 segments (split evenly)
        31-45s → 3 segments
        46-60s → 4 segments
    """
    max_seg = SEEDANCE_OMNI_SEGMENT_DURATION
    total_duration = min(total_duration, max_seg * SEEDANCE_OMNI_MAX_SEGMENTS)

    if total_duration <= max_seg:
        return [{"index": 1, "start": 0, "end": total_duration, "duration": total_duration}]

    n_segments = min(
        SEEDANCE_OMNI_MAX_SEGMENTS,
        (total_duration + max_seg - 1) // max_seg,  # ceil division
    )

    # Distribute duration evenly
    base_dur = total_duration // n_segments
    remainder = total_duration % n_segments

    segments = []
    current = 0
    for i in range(n_segments):
        dur = base_dur + (1 if i < remainder else 0)
        segments.append({
            "index": i + 1,
            "start": current,
            "end": current + dur,
            "duration": dur,
        })
        current += dur

    return segments


def assign_segment_roles(num_segments: int, has_logo: bool = True) -> list[str]:
    """Assign narrative roles to segments: intro, body, outro.

    Rules:
        1 segment + logo  → ["outro"]
        1 segment no logo → ["body"]
        2+ segments + logo → intro + N×body + outro
        2+ segments no logo → intro + N×body
    """
    if num_segments == 1:
        return ["outro"] if has_logo else ["body"]
    roles = ["intro"]
    for _ in range(num_segments - 2):
        roles.append("body")
    roles.append("outro" if has_logo else "body")
    return roles


# ============================================================================
# Prompt Generation (Gemini)
# ============================================================================

def _build_gemini_system_prompt(segment_roles: list[str] | None = None) -> str:
    """System prompt for Gemini to generate omni_reference time-segmented prompts.

    Args:
        segment_roles: Optional list of roles per segment (intro/body/outro).
            When provided, adds role-specific guidance for each scene.
    """
    base = """You are a professional video director writing prompts for Seedance 2.0's omni_reference mode.

You will receive:
1. A concept brief describing the video
2. A list of reference images with roles (product, environment, character, logo)
3. Time segment boundaries (e.g., 0-5s, 5-10s, 10-15s)

Your task: Write a time-segmented prompt that tells the AI video generator exactly what to show in each time segment.

Rules:
- Reference images using @image_file_N (1-indexed, matching the order provided)
- Each scene must specify: what's happening, camera movement, lighting, mood
- Use cinematic camera vocabulary: push_in, tracking_right, dolly_forward, crane_up, slow_orbit, rack_focus
- Include natural transitions between scenes (e.g., "fade into", "camera pans to reveal")
- Keep each scene description to 2-4 sentences
- Sound direction (REQUIRED per scene): End each scene segment with "Sound: [specific SFX]. [music/silence instruction]."
  Examples: "Sound: ocean waves, seagull cries. No music." | "Sound: baby giggles, toy rattles. No background music."
  Be specific — "baby giggles" is better than "ambient sounds". Use silence instructions to prevent unwanted Seedance audio.

Output format (EXACTLY this format, no markdown, no extra text):
Scene 1 (0-5s):
[description using @image_file_N references]

Scene 2 (5-10s):
[description]

Scene 3 (10-15s):
[description]"""

    if segment_roles:
        role_guidance = "\n\nSegment role guidance:"
        for i, role in enumerate(segment_roles):
            scene_num = i + 1
            if role == "intro":
                role_guidance += f"\n- Scene {scene_num} (INTRO): Establish the world. Do NOT show any logo, brand mark, or text. Focus on environment and atmosphere."
            elif role == "outro":
                role_guidance += f"\n- Scene {scene_num} (OUTRO): Brand reveal. Show the logo image elegantly — particles converge, animated frame, or graceful appearance. End with brand identity."
            else:
                role_guidance += f"\n- Scene {scene_num} (BODY): Continue the visual narrative. Do NOT show any logo or text. Focus on product/character action."
        base += role_guidance

    return base


def generate_prompt_with_gemini(
    concept: str,
    images: list[dict],
    segments: list[dict],
    segment_roles: list[str] | None = None,
) -> str:
    """Use Gemini to generate a time-segmented omni_reference prompt.

    Args:
        concept: User's concept brief
        images: List of {"role": str, "path": str} dicts
        segments: Time segment definitions from calculate_segments()
        segment_roles: Optional narrative roles per segment (intro/body/outro)

    Returns:
        Time-segmented prompt string ready for Seedance API
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise SeedanceError(
            "GOOGLE_API_KEY not set. Required for Gemini prompt generation. "
            "Set it in .claude/settings.local.json or use --prompt to provide your own."
        )

    # Build the user message
    image_list = "\n".join(
        f"  @image_file_{i+1}: {img['role']} — {os.path.basename(img['path'])}"
        for i, img in enumerate(images)
    )

    segment_list = "\n".join(
        f"  Scene {s['index']} ({s['start']}-{s['end']}s)"
        for s in segments
    )

    user_msg = f"""Concept: {concept}

Reference images:
{image_list}

Time segments:
{segment_list}

Write the time-segmented prompt for this video."""

    logger.info("[Gemini] Generating prompt for %d segments...", len(segments))

    try:
        import google.genai as genai

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=[
                {"role": "user", "parts": [{"text": user_msg}]},
            ],
            config={
                "system_instruction": _build_gemini_system_prompt(segment_roles),
                "temperature": 0.7,
                "max_output_tokens": 2000,
            },
        )

        prompt_text = response.text.strip()
        logger.info("[Gemini] Generated %d chars", len(prompt_text))
        return prompt_text

    except ImportError:
        raise SeedanceError(
            "google-genai package not installed. Run: pip install google-genai"
        )
    except Exception as e:
        raise SeedanceError(f"Gemini prompt generation failed: {e}") from e


# ============================================================================
# Seedance API — Omni Reference Payload
# ============================================================================

def build_omni_payload(
    prompt: str,
    image_urls: dict[int, str],
    duration: int,
    ratio: str = "landscape",
    quality: str = "fast",
    audio_ref_url: str | None = None,
) -> dict:
    """Build the Seedance omni_reference API payload.

    Args:
        prompt: Time-segmented prompt with @image_file_N references
        image_urls: Mapping of 1-indexed position to public URL
        duration: Video duration in seconds (4-15)
        ratio: "landscape", "portrait", or "square"
        quality: "fast" or "quality"

    Returns:
        Complete API payload dict ready for POST
    """
    mode = SEEDANCE_QUALITY_MAP.get(quality, "seedance_2.0_fast")
    aspect_ratio = SEEDANCE_RATIO_MAP.get(ratio, "16:9")
    dur = max(4, min(SEEDANCE_OMNI_MAX_DURATION, duration))

    params: dict = {
        "model": mode,
        "prompt": prompt,
        "functionMode": SEEDANCE_OMNI_FUNCTION_MODE,
        "ratio": aspect_ratio,
        "duration": str(dur),
    }

    # Add image_file_N keys (1-indexed)
    for idx, url in sorted(image_urls.items()):
        params[f"image_file_{idx}"] = url

    # Add audio reference for BGM clone (audio_clone scenario)
    if audio_ref_url:
        params["audio_file_1"] = audio_ref_url
        if "@audio_file_1" not in params.get("prompt", ""):
            params["prompt"] = f"Use @audio_file_1 as background music reference. {params['prompt']}"

    return {
        "model": SEEDANCE_MODEL_ID,
        "params": params,
        "channel": None,
    }


def submit_omni_task(payload: dict) -> str:
    """Submit an omni_reference task to Seedance API.

    Returns task_id string.
    """
    import requests as req
    from seedance_client import get_api_key, get_headers

    api_key = get_api_key()
    headers = get_headers(api_key)

    logger.info("[Seedance] Submitting omni_reference task...")
    logger.info("[Seedance] Duration: %ss, Images: %d",
                payload["params"]["duration"],
                sum(1 for k in payload["params"] if k.startswith("image_file_")))

    try:
        resp = req.post(
            SEEDANCE_CREATE_URL,
            json=payload,
            headers=headers,
            timeout=30,
        )
    except Exception as e:
        raise SeedanceError(f"Network error: {e}") from e

    if resp.status_code != 200:
        logger.debug("[Seedance] Full API response: %s", resp.text[:2000])
        raise SeedanceError(f"HTTP {resp.status_code}: {resp.text[:500]}")

    result = resp.json()
    if result.get("code") != 200:
        logger.debug("[Seedance] Full API result: %s", json.dumps(result, ensure_ascii=False)[:2000])
        raise SeedanceError(
            f"Task creation failed: {json.dumps(result, ensure_ascii=False)[:500]}"
        )

    task_id = result["data"]["task_id"]
    price = result["data"].get("price", "?")
    logger.info("[Seedance] Task created: id=%s, credits=%s", task_id, price)
    return task_id


def poll_and_download(task_id: str, output_path: str) -> str:
    """Poll task until complete, then download video.

    Returns output_path on success.
    """
    from seedance_client import poll_task, extract_video_url, download_video

    task_result = poll_task(task_id)
    video_url = extract_video_url(task_result)
    download_video(video_url, output_path)
    return output_path


# ============================================================================
# Post-Processing
# ============================================================================

def upscale_video(input_path: str, output_path: str | None = None) -> str:
    """Upscale video from 640x360 to 1280x720 using FFmpeg lanczos.

    Args:
        input_path: Path to 640x360 video
        output_path: Output path (default: {input}_720p.mp4)

    Returns:
        Path to upscaled video
    """
    if not output_path:
        base, ext = os.path.splitext(input_path)
        output_path = f"{base}_720p{ext}"

    logger.info("[Upscale] %s → %s", os.path.basename(input_path), os.path.basename(output_path))

    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", f"scale={LANDSCAPE_WIDTH}:{LANDSCAPE_HEIGHT}:flags=lanczos",
        "-c:v", "libx264", "-crf", "18", "-preset", "slow",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "copy",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise SeedanceError(f"Upscale failed: {result.stderr[:300]}")

    size = os.path.getsize(output_path)
    logger.info("[Upscale] Done: %.1f MB", size / 1024 / 1024)
    return output_path


def crossfade_concat(video_paths: list[str], output_path: str, fade_duration: float = 0.5) -> str:
    """Concatenate videos with crossfade transitions.

    Args:
        video_paths: List of video file paths to join
        output_path: Final output path
        fade_duration: Crossfade duration in seconds

    Returns:
        output_path on success
    """
    if len(video_paths) == 1:
        # Single video — just copy
        import shutil
        shutil.copy2(video_paths[0], output_path)
        return output_path

    logger.info("[Concat] Joining %d segments with %.1fs crossfade...", len(video_paths), fade_duration)

    # Build xfade filter chain
    # For N videos: need N-1 xfade filters chained together
    inputs = []
    for vp in video_paths:
        inputs.extend(["-i", vp])

    # Get durations for offset calculation
    durations = []
    for vp in video_paths:
        dur = _get_duration(vp)
        durations.append(dur)

    filter_parts = []

    if len(video_paths) == 2:
        current_offset = durations[0] - fade_duration
        filter_parts.append(
            f"[0:v][1:v]xfade=transition=fade:duration={fade_duration}:offset={current_offset}[vout]"
        )
        # Audio crossfade
        filter_parts.append(
            f"[0:a][1:a]acrossfade=d={fade_duration}[aout]"
        )
    else:
        # Multi-segment xfade chain
        # offset for xfade at junction i (0-indexed) = sum(durations[0..i]) - (i+1)*fade_duration
        prev_label = "0:v"
        for i in range(1, len(video_paths)):
            out_label = "vout" if i == len(video_paths) - 1 else f"v{i}"
            # Accumulated output offset: sum of first i durations minus i crossfades
            offset = sum(durations[:i]) - i * fade_duration
            filter_parts.append(
                f"[{prev_label}][{i}:v]xfade=transition=fade:duration={fade_duration}:offset={offset:.3f}[{out_label}]"
            )
            prev_label = out_label

        # Audio: simple concat (crossfade for audio is tricky with many inputs)
        audio_inputs = "".join(f"[{i}:a]" for i in range(len(video_paths)))
        filter_parts.append(
            f"{audio_inputs}concat=n={len(video_paths)}:v=0:a=1[aout]"
        )

    filter_complex = ";".join(filter_parts)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-crf", "18", "-preset", "slow",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "192k",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        # Fallback: simple concat without crossfade
        logger.warning("[Concat] Crossfade failed, falling back to simple concat: %s", result.stderr[:200])
        return _simple_concat(video_paths, output_path)

    size = os.path.getsize(output_path)
    logger.info("[Concat] Done: %.1f MB", size / 1024 / 1024)
    return output_path


def _simple_concat(video_paths: list[str], output_path: str) -> str:
    """Simple concat without crossfade (fallback)."""
    import tempfile

    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for vp in video_paths:
            f.write(f"file '{vp}'\n")
        list_path = f.name

    try:
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", list_path,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            # Clean up partial output
            if os.path.exists(output_path):
                os.unlink(output_path)
            raise SeedanceError(f"Concat failed: {result.stderr[:300]}")
    finally:
        os.unlink(list_path)

    return output_path


def _get_duration(video_path: str) -> float:
    """Get video duration using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if result.returncode == 0 and result.stdout.strip():
        return float(result.stdout.strip())
    logger.warning("[Duration] ffprobe failed for %s, using fallback 8.0s", video_path)
    return 8.0  # fallback


# ============================================================================
# Upload Images
# ============================================================================

def upload_images(images: list[dict], project_path: str | None = None) -> dict[int, str]:
    """Upload local image files to Seedance-accessible CDN.

    Args:
        images: List of {"role": str, "path": str} dicts
        project_path: Optional project path for upload caching

    Returns:
        Dict mapping 1-indexed position to public URL
    """
    from utils_upload import ensure_urls

    paths = [img["path"] for img in images]
    urls = ensure_urls(paths, project_path=project_path, rehost_risky=True)

    image_urls = {}
    for i, (img, url) in enumerate(zip(images, urls)):
        idx = i + 1
        image_urls[idx] = url
        logger.info("[Upload] image_file_%d (%s): %s", idx, img["role"], url[:80])

    return image_urls


# ============================================================================
# Storyboard Panel References (v2.43)
# ============================================================================

def load_storyboard_panels(panels_json_path: str) -> dict:
    """Load storyboard_panels.json and return the parsed dict.

    Args:
        panels_json_path: Path to storyboard_panels.json

    Returns:
        Parsed JSON dict with "panels" key mapping scene numbers to panel info
    """
    with open(panels_json_path) as f:
        return json.load(f)


def inject_storyboard_panel(
    images: list[dict],
    image_urls: dict[int, str],
    prompt: str,
    segment_index: int,
    panels_data: dict,
    project_path: str | None = None,
) -> tuple[list[dict], dict[int, str], str]:
    """Inject a storyboard panel as an additional reference image for a segment.

    Looks up the panel for the given segment_index (1-based scene number) in
    panels_data and, if found, uploads the panel image and adds it to the
    image_urls dict with a new @image_file_N reference in the prompt.

    Args:
        images: Current list of image dicts (modified in place)
        image_urls: Current 1-indexed URL mapping (modified in place)
        prompt: Current prompt text
        segment_index: 1-based segment/scene number
        panels_data: Loaded storyboard_panels.json dict
        project_path: Optional project path for upload caching

    Returns:
        Tuple of (updated images, updated image_urls, updated prompt)
    """
    from utils_upload import ensure_urls

    panels = panels_data.get("panels", {})
    panel = panels.get(str(segment_index))
    if not panel:
        return images, image_urls, prompt

    panel_path = panel.get("image_path")
    panel_url = panel.get("image_url")

    if not panel_path and not panel_url:
        logger.warning("[Storyboard Ref] Scene %d: no image_path or image_url in panel data", segment_index)
        return images, image_urls, prompt

    # Get or upload the panel URL
    if not panel_url:
        if not os.path.isfile(panel_path):
            logger.warning("[Storyboard Ref] Scene %d: panel image not found: %s", segment_index, panel_path)
            return images, image_urls, prompt
        urls = ensure_urls([panel_path], project_path=project_path, rehost_risky=True)
        panel_url = urls[0]
        # Cache the URL back into panels_data
        panel["image_url"] = panel_url

    # Determine next image_file index
    next_idx = max(image_urls.keys(), default=0) + 1

    image_urls[next_idx] = panel_url
    images = list(images)  # shallow copy to avoid mutating caller's list
    images.append({"role": "storyboard", "path": panel_path or panel_url})

    # Append storyboard reference instruction to prompt
    storyboard_ref = (
        f"\n@image_file_{next_idx} is the storyboard composition reference showing the exact "
        f"action, camera angle and narrative for this shot. Follow its composition closely."
    )
    prompt = prompt + storyboard_ref

    logger.info("[Storyboard Ref] Scene %d: added storyboard panel as @image_file_%d", segment_index, next_idx)
    return images, image_urls, prompt


# ============================================================================
# Main Pipeline
# ============================================================================

def generate_omni_video(
    concept: str | None = None,
    prompt: str | None = None,
    images: list[dict] | None = None,
    image_urls: dict[int, str] | None = None,
    duration: int = 15,
    ratio: str = "landscape",
    quality: str = "fast",
    output_dir: str = ".",
    project_name: str = "omni",
    variants: int = 1,
    dry_run: bool = False,
    yes: bool = False,
    project_path: str | None = None,
    resume: bool = False,
    voiceover: bool = False,
    vo_style: str = "luxury",
    vo_voice: str = "Rachel",
    vo_text: str | None = None,
    music: str | None = None,
    storyboard_panels: str | None = None,
    audio_ref_url: str | None = None,
) -> list[str]:
    """Main pipeline: concept → prompt → submit → download → upscale.

    Args:
        concept: Concept brief for Gemini prompt generation
        prompt: Direct prompt (skips Gemini)
        images: List of {"role": str, "path": str} dicts
        image_urls: Pre-uploaded image URLs (skip upload phase)
        duration: Total video duration in seconds
        ratio: Aspect ratio
        quality: "fast" or "quality"
        output_dir: Directory for output videos
        project_name: Name prefix for output files
        variants: Number of A/B variants to generate
        dry_run: Preview without generating
        yes: Skip confirmation prompts
        project_path: Project path for upload caching

    Returns:
        List of output video file paths
    """
    os.makedirs(output_dir, exist_ok=True)

    # ── Pre-flight: Check API keys early ──────────────────────────────────
    if concept and not prompt and not os.environ.get("GOOGLE_API_KEY"):
        raise SeedanceError(
            "GOOGLE_API_KEY required for --concept. "
            "Set it in .claude/settings.local.json or use --prompt to provide your own."
        )

    # ── Load storyboard panels (v2.43) ──────────────────────────────────
    _storyboard_panels_data = None
    if storyboard_panels:
        if os.path.isfile(storyboard_panels):
            _storyboard_panels_data = load_storyboard_panels(storyboard_panels)
            panel_count = len(_storyboard_panels_data.get("panels", {}))
            logger.info("[Storyboard] Loaded %d panels from %s", panel_count, storyboard_panels)
        else:
            logger.warning("[Storyboard] Panels file not found: %s — skipping", storyboard_panels)

    # ── Phase 1: Calculate segments ───────────────────────────────────────
    segments = calculate_segments(duration)
    is_chained = len(segments) > 1

    logger.info("=" * 60)
    logger.info("Seedance Omni Reference — %ds video (%d segment%s)",
                duration, len(segments), "s" if len(segments) > 1 else "")
    logger.info("=" * 60)
    logger.info("Ratio: %s | Quality: %s | Variants: %d", ratio, quality, variants)

    if is_chained:
        for seg in segments:
            logger.info("  Segment %d: %d-%ds (%ds)", seg["index"], seg["start"], seg["end"], seg["duration"])

    # ── Assign narrative roles ─────────────────────────────────────────────
    has_logo = any(img.get("role") == "logo" for img in (images or []))
    segment_roles = assign_segment_roles(len(segments), has_logo=has_logo)
    if is_chained:
        for seg, role in zip(segments, segment_roles):
            logger.info("  Segment %d role: %s", seg["index"], role)

    # ── Phase 2: Upload images ────────────────────────────────────────────
    if image_urls is None:
        if images is None or len(images) == 0:
            raise SeedanceError("No images provided. Use --images to specify reference images.")

        errors = validate_images(images)
        if errors:
            for err in errors:
                logger.error("  %s", err)
            raise SeedanceError("Image validation failed")

        logger.info("\nImages (%d):", len(images))
        for i, img in enumerate(images):
            logger.info("  [%d] %s: %s", i + 1, img["role"], os.path.basename(img["path"]))

        if not dry_run:
            image_urls = upload_images(images, project_path=project_path)
        else:
            image_urls = {i + 1: f"<dry-run-url-{i+1}>" for i in range(len(images))}

    # ── Phase 3: Generate prompt ──────────────────────────────────────────
    if prompt:
        logger.info("\nUsing provided prompt (%d chars)", len(prompt))
        final_prompt = prompt
    elif concept:
        if is_chained:
            # For chained: generate one prompt per segment (each ≤15s)
            # For now, generate a single prompt for first segment
            # Subsequent segments get continuation prompts
            logger.info("\nGenerating prompt from concept via Gemini...")
            final_prompt = generate_prompt_with_gemini(concept, images or [], segments[:1], segment_roles[:1])
        else:
            logger.info("\nGenerating prompt from concept via Gemini...")
            final_prompt = generate_prompt_with_gemini(concept, images or [], segments, segment_roles)
    else:
        raise SeedanceError("Provide --concept or --prompt")

    # ── Display plan ──────────────────────────────────────────────────────
    logger.info("\n" + "─" * 50)
    logger.info("PROMPT:")
    logger.info("─" * 50)
    for line in final_prompt.split("\n"):
        logger.info("  %s", line)
    logger.info("─" * 50)

    # Cost estimate — omni_reference has a fixed cost per segment
    per_segment_credits = SEEDANCE_OMNI_CREDITS_PER_SEGMENT
    total_credits = per_segment_credits * len(segments) * variants
    usd_per_credit = 0.01  # approximate
    total_usd = total_credits * usd_per_credit
    logger.info("\nEstimated cost: %d credits per variant (%d credits/segment × %d segments)",
                per_segment_credits * len(segments), per_segment_credits, len(segments))
    if variants > 1:
        logger.info("Total for %d variants: %d credits (~$%.2f)", variants, total_credits, total_usd)

    if dry_run:
        logger.info("\n[DRY RUN] Would submit %d segment(s) × %d variant(s)", len(segments), variants)
        # Build and show payload
        payload = build_omni_payload(
            prompt=final_prompt,
            image_urls=image_urls,
            duration=segments[0]["duration"] if segments else duration,
            ratio=ratio,
            quality=quality,
            audio_ref_url=audio_ref_url,
        )
        logger.info("\nPayload preview:")
        logger.info(json.dumps(payload, indent=2, ensure_ascii=False)[:2000])
        return []

    # ── Confirmation ──────────────────────────────────────────────────────
    if not yes:
        logger.info("\nReady to generate. Total: %d segment(s) × %d variant(s) = %d API calls",
                    len(segments), variants, len(segments) * variants)
        confirm = input("Proceed? [y/N] ").strip().lower()
        if confirm not in ("y", "yes"):
            logger.info("Cancelled.")
            return []

    # ── Phase 4: Generate ─────────────────────────────────────────────────
    # Load completed segments for resume support
    completed_progress: dict[int, str] = {}
    if resume:
        completed_progress = _load_progress_paths(output_dir)
        if completed_progress:
            logger.info("[Resume] Skipping %d already-completed segment(s): %s",
                        len(completed_progress), sorted(completed_progress.keys()))

    max_retries = 2
    retry_delay = 30
    output_files = []
    progress = ProgressLogger(total=len(segments) * variants, prefix="Generating")

    for variant in range(1, variants + 1):
        variant_suffix = f"_v{variant}" if variants > 1 else ""
        segment_files = []
        chain_broken = False

        for seg in segments:
            progress.step(f"segment {seg['index']}{variant_suffix}")

            # Skip if already completed (resume mode)
            if resume and seg["index"] in completed_progress:
                seg_path = completed_progress[seg["index"]]
                logger.info("[Resume] Skipping segment %d — already at %s", seg["index"], seg_path)
                segment_files.append(seg_path)
                continue

            # For chained segments beyond the first, generate continuation prompts
            if is_chained and seg["index"] > 1:
                seg_role = segment_roles[seg["index"] - 1] if seg["index"] - 1 < len(segment_roles) else "body"
                seg_prompt = _build_continuation_prompt(concept or "", images or [], seg, role=seg_role)
            else:
                seg_prompt = final_prompt

            # Inject storyboard panel as extra reference (v2.43)
            seg_image_urls = dict(image_urls)  # per-segment copy
            if _storyboard_panels_data:
                _, seg_image_urls, seg_prompt = inject_storyboard_panel(
                    images=images or [],
                    image_urls=seg_image_urls,
                    prompt=seg_prompt,
                    segment_index=seg["index"],
                    panels_data=_storyboard_panels_data,
                    project_path=project_path,
                )

            payload = build_omni_payload(
                prompt=seg_prompt,
                image_urls=seg_image_urls,
                duration=seg["duration"],
                ratio=ratio,
                quality=quality,
                audio_ref_url=audio_ref_url,
            )

            seg_filename = f"{project_name}_seg{seg['index']}{variant_suffix}.mp4"
            seg_path = os.path.join(output_dir, seg_filename)

            # Pre-validate segment prompt for likely content filter triggers
            _pv_warnings = pre_validate_prompt(seg_prompt)
            for _w in _pv_warnings:
                log_fn = logger.warning if _w["level"] == "HIGH" else logger.info
                log_fn(
                    "[Segment %d] Content filter risk %s: %s (matched: %r)",
                    seg["index"], _w["level"], _w["reason"], _w["match"],
                )

            # Retry loop with content moderation + quality fallback
            success = False
            current_payload = payload.copy()
            current_prompt = current_payload.get("params", {}).get("prompt", seg_prompt)
            sanitize_level = 0
            quality_downgraded = False

            for attempt in range(max_retries + 1):
                try:
                    task_id = submit_omni_task(current_payload)
                    poll_and_download(task_id, seg_path)
                    save_segment_progress(output_dir, seg["index"], seg_path)
                    segment_files.append(seg_path)
                    success = True
                    break
                except (SeedanceError, TimeoutError) as e:
                    error_msg = str(e)
                    # Clean up partial download
                    if os.path.exists(seg_path):
                        os.unlink(seg_path)

                    # Content moderation violation — sanitize prompt and retry
                    if is_content_violation(error_msg) and sanitize_level < 2:
                        sanitize_level += 1
                        current_prompt = sanitize_prompt(seg_prompt, level=sanitize_level)
                        current_payload = build_omni_payload(
                            prompt=current_prompt,
                            image_urls=seg_image_urls,
                            duration=seg["duration"],
                            ratio=ratio,
                            quality=quality if not quality_downgraded else "fast",
                            audio_ref_url=audio_ref_url,
                        )
                        logger.warning(
                            "[Segment %d] Content violation — sanitizing to level %d and retrying...",
                            seg["index"], sanitize_level,
                        )
                        time.sleep(retry_delay)
                        continue

                    # Model not found — fallback to fast quality
                    if not quality_downgraded and "模型菜单中未找到" in error_msg:
                        quality_downgraded = True
                        current_payload = build_omni_payload(
                            prompt=current_prompt,
                            image_urls=seg_image_urls,
                            duration=seg["duration"],
                            ratio=ratio,
                            quality="fast",
                            audio_ref_url=audio_ref_url,
                        )
                        logger.warning(
                            "[Segment %d] Model not found — falling back to fast quality...",
                            seg["index"],
                        )
                        time.sleep(retry_delay)
                        continue

                    if attempt < max_retries:
                        logger.warning(
                            "[Segment %d] Attempt %d/%d failed: %s — retrying in %ds...",
                            seg["index"], attempt + 1, max_retries + 1, e, retry_delay,
                        )
                        time.sleep(retry_delay)
                    else:
                        logger.error(
                            "[Segment %d] Failed after %d attempts: %s",
                            seg["index"], max_retries + 1, e,
                        )

            if not success:
                chain_broken = True
                break

        if not segment_files:
            logger.error("No segments generated for variant %d", variant)
            continue

        # ── Phase 5: Post-process ─────────────────────────────────────────
        # Upscale each segment
        upscaled_files = []
        for seg_path in segment_files:
            up_path = upscale_video(seg_path)
            upscaled_files.append(up_path)

        # Concat if chained
        if is_chained and len(upscaled_files) > 1:
            final_path = os.path.join(
                output_dir, f"{project_name}_final{variant_suffix}.mp4"
            )
            crossfade_concat(
                upscaled_files,
                final_path,
                fade_duration=SEEDANCE_OMNI_CROSSFADE_DURATION,
            )
            output_files.append(final_path)
        elif upscaled_files:
            # Single segment — rename to final
            final_path = os.path.join(
                output_dir, f"{project_name}_final{variant_suffix}.mp4"
            )
            if os.path.exists(final_path):
                os.unlink(final_path)
            os.rename(upscaled_files[0], final_path)
            output_files.append(final_path)

    # Voiceover baking (onto the first/only output file per variant)
    if voiceover and output_files:
        _apply_voiceover(
            output_files=output_files,
            segments=segments,
            concept=concept,
            images=images or [],
            vo_text=vo_text,
            vo_style=vo_style,
            vo_voice=vo_voice,
            music_path=music,
        )

    # ── Summary ───────────────────────────────────────────────────────────
    logger.info("\n" + "=" * 60)
    if output_files:
        logger.info("COMPLETE — %d video(s) generated:", len(output_files))
        for f in output_files:
            size = os.path.getsize(f) if os.path.exists(f) else 0
            logger.info("  %s (%.1f MB)", f, size / 1024 / 1024)
    else:
        logger.error("FAILED — no videos generated")
    logger.info("=" * 60)

    if not output_files and not dry_run:
        raise SeedanceError("All variants failed to generate. Check logs above for details.")

    return output_files


def _apply_voiceover(
    output_files: list[str],
    segments: list[dict],
    concept: str | None,
    images: list[dict],
    vo_text: str | None,
    vo_style: str,
    vo_voice: str,
    music_path: str | None,
) -> None:
    """Generate TTS tagline and bake onto the outro portion of output videos."""
    import tempfile

    # Determine voiceover text
    if not vo_text:
        # Try to generate via Gemini
        try:
            import google.genai as genai
            api_key = os.environ.get("GOOGLE_API_KEY")
            if api_key and concept:
                client = genai.Client(api_key=api_key)
                style_prompts = {
                    "luxury": "Write a 1-sentence luxury brand tagline (10-15 words, evocative, aspirational).",
                    "energetic": "Write a 1-sentence energetic brand slogan (8-12 words, punchy, action-driven).",
                    "minimal": "Write a 1-sentence minimal brand statement (6-10 words, clean, direct).",
                    "inspirational": "Write a 1-sentence inspirational brand message (10-15 words, emotional).",
                }
                style_prompt = style_prompts.get(vo_style, style_prompts["luxury"])
                resp = client.models.generate_content(
                    model=os.environ.get("GEMINI_FLASH_MODEL", "gemini-3-flash-preview"),
                    contents=[f"Brand concept: {concept}\n\n{style_prompt}\nReturn ONLY the tagline text, no quotes, no prefix."],
                )
                vo_text = resp.text.strip().strip('"').strip("'")
                logger.info("[VO] Generated tagline: %s", vo_text)
        except Exception as e:
            logger.warning("[VO] Could not generate tagline via Gemini: %s", e)

    if not vo_text:
        logger.warning("[VO] No voiceover text — skipping voiceover bake")
        return

    # Generate TTS via ElevenLabs
    import requests as _requests

    el_key = os.environ.get("ELEVENLABS_API_KEY")
    if not el_key:
        logger.warning("[VO] ELEVENLABS_API_KEY not set — skipping voiceover bake")
        return

    # Resolve voice name to ID
    try:
        voices_resp = _requests.get(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": el_key},
            timeout=10,
        )
        voices_resp.raise_for_status()
        voices = voices_resp.json().get("voices", [])
        voice_id = next(
            (v["voice_id"] for v in voices if v["name"].lower() == vo_voice.lower()),
            None,
        )
        if not voice_id:
            voice_id = "21m00Tcm4TlvDq8ikWAM"  # Rachel fallback
            logger.warning("[VO] Voice '%s' not found, using Rachel", vo_voice)
    except Exception as e:
        logger.warning("[VO] Could not resolve voice: %s — using Rachel", e)
        voice_id = "21m00Tcm4TlvDq8ikWAM"

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_audio:
        tmp_audio_path = tmp_audio.name

    try:
        tts_resp = _requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={"xi-api-key": el_key, "Content-Type": "application/json"},
            json={"text": vo_text, "model_id": "eleven_multilingual_v2"},
            timeout=30,
        )
        tts_resp.raise_for_status()
        with open(tmp_audio_path, "wb") as f:
            f.write(tts_resp.content)
        logger.info("[VO] TTS audio: %s (%.0f KB)", tmp_audio_path, len(tts_resp.content) / 1024)
    except Exception as e:
        logger.warning("[VO] TTS generation failed: %s — skipping voiceover", e)
        os.unlink(tmp_audio_path)
        return

    # Calculate outro start time
    total_dur = sum(s["duration"] for s in segments)
    outro_start = total_dur - segments[-1]["duration"] if len(segments) > 1 else 0.0

    # Bake onto each output file in place
    for i, video_path in enumerate(output_files):
        try:
            vo_video = bake_voiceover(video_path, tmp_audio_path, outro_start, music_path)
            output_files[i] = vo_video
            logger.info("[VO] Baked onto: %s", vo_video)
        except Exception as e:
            logger.warning("[VO] Bake failed for %s: %s", video_path, e)

    os.unlink(tmp_audio_path)


def _build_continuation_prompt(concept: str, images: list[dict], segment: dict, role: str = "body") -> str:
    """Build a continuation prompt for chained segments beyond the first.

    For chained generation, segments after the first need prompts that continue
    the story naturally from where the previous segment left off.
    """
    role_hint = ""
    if role == "outro":
        role_hint = "\n\nThis is the OUTRO segment. If a logo image was provided, feature it prominently in a logo reveal. Include a tagline or call-to-action."
    elif role == "intro":
        role_hint = "\n\nThis is the INTRO segment. Do NOT show any logos. Focus on establishing the setting and mood."

    try:
        return generate_prompt_with_gemini(
            concept=f"{concept}\n\nThis is SEGMENT {segment['index']} (continuation). "
                    f"Continue the story from the {segment['start']}s mark. "
                    f"Time: {segment['start']}-{segment['end']}s.{role_hint}",
            images=images,
            segments=[segment],
        )
    except Exception as e:
        logger.warning("[Gemini] Continuation prompt failed: %s, using generic", e)
        # Fallback: generic continuation
        refs = " ".join(f"@image_file_{i+1}" for i in range(len(images)))
        return (
            f"Scene {segment['index']} ({segment['start']}-{segment['end']}s):\n"
            f"{refs} Continue the story seamlessly. Smooth camera movement, "
            f"natural lighting transitions. Maintain visual consistency."
        )


# ============================================================================
# Progress Tracking & Resume
# ============================================================================

OMNI_PROGRESS_FILE = "omni_progress.json"


def save_segment_progress(
    output_dir: str,
    segment_index: int,
    video_path: str,
    status: str = "completed",
) -> None:
    """Save segment completion to omni_progress.json for resume support."""
    progress_file = os.path.join(output_dir, OMNI_PROGRESS_FILE)

    if os.path.exists(progress_file):
        with open(progress_file) as f:
            data = json.load(f)
    else:
        data = {"segments": []}

    data["segments"].append({
        "index": segment_index,
        "video_path": video_path,
        "status": status,
    })

    with open(progress_file, "w") as f:
        json.dump(data, f, indent=2)


def load_segment_progress(output_dir: str) -> set[int]:
    """Load completed segment indices from omni_progress.json.

    Returns:
        Set of segment indices that completed successfully.
    """
    progress_file = os.path.join(output_dir, OMNI_PROGRESS_FILE)
    if not os.path.exists(progress_file):
        return set()

    with open(progress_file) as f:
        data = json.load(f)

    return {
        seg["index"]
        for seg in data.get("segments", [])
        if seg.get("status") == "completed"
    }


def _load_progress_paths(output_dir: str) -> dict[int, str]:
    """Load completed segment index→path mapping from omni_progress.json."""
    progress_file = os.path.join(output_dir, OMNI_PROGRESS_FILE)
    if not os.path.exists(progress_file):
        return {}
    with open(progress_file) as f:
        data = json.load(f)
    return {
        seg["index"]: seg["video_path"]
        for seg in data.get("segments", [])
        if seg.get("status") == "completed" and os.path.exists(seg.get("video_path", ""))
    }


# ============================================================================
# Enhanced Dry-Run Display
# ============================================================================

def format_dry_run_segment(
    segment: dict,
    role: str,
    prompt_preview: str,
    has_logo_ref: bool,
) -> str:
    """Format a single segment for dry-run display.

    Returns a multi-line string with role, cost, prompt preview, and logo status.
    """
    from config import SEEDANCE_OMNI_CREDITS_PER_SEGMENT

    lines = [
        f"  Segment {segment['index']} ({segment['start']}-{segment['end']}s) — Role: {role.upper()}",
        f"    Credits: {SEEDANCE_OMNI_CREDITS_PER_SEGMENT}",
        f"    Logo ref: {'Yes' if has_logo_ref else 'No'}",
        f"    Prompt: {prompt_preview[:100]}{'...' if len(prompt_preview) > 100 else ''}",
    ]
    return "\n".join(lines)


# ============================================================================
# Pipelined Segment Generation
# ============================================================================

def generate_segments_pipelined(
    segments: list[dict],
    build_payload_fn,
    output_dir: str,
    project_name: str,
    max_retries: int = 2,
    retry_delay: int = 30,
    variant_suffix: str = "",
) -> list[str]:
    """Generate segments with 1-segment lookahead and circuit breaker.

    Submits segment N+1 while segment N is still polling, reducing total
    wall-clock time. Aborts if 2 consecutive segments fail.

    Args:
        segments: List of segment dicts from calculate_segments()
        build_payload_fn: Callable(segment) → payload dict
        output_dir: Directory for output video files
        project_name: Project name for file naming
        max_retries: Max retries per segment
        retry_delay: Delay between retries in seconds
        variant_suffix: Suffix for variant naming (e.g., "_v2")

    Returns:
        List of successfully generated segment file paths
    """
    from concurrent.futures import ThreadPoolExecutor, Future

    segment_files = []
    consecutive_failures = 0
    circuit_breaker_limit = 2

    def _generate_one(seg: dict) -> str | None:
        """Generate a single segment with retries. Returns path or None."""
        seg_filename = f"{project_name}_seg{seg['index']}{variant_suffix}.mp4"
        seg_path = os.path.join(output_dir, seg_filename)
        payload = build_payload_fn(seg)

        for attempt in range(max_retries + 1):
            try:
                task_id = submit_omni_task(payload)
                poll_and_download(task_id, seg_path)
                return seg_path
            except (SeedanceError, TimeoutError) as e:
                if os.path.exists(seg_path):
                    os.unlink(seg_path)
                if attempt < max_retries:
                    logger.warning(
                        "[Segment %d] Attempt %d/%d failed: %s — retrying in %ds...",
                        seg["index"], attempt + 1, max_retries + 1, e, retry_delay,
                    )
                    time.sleep(retry_delay)
                else:
                    logger.error(
                        "[Segment %d] Failed after %d attempts: %s",
                        seg["index"], max_retries + 1, e,
                    )
        return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        pending_future: Future | None = None
        pending_seg_idx = -1

        for i, seg in enumerate(segments):
            if consecutive_failures >= circuit_breaker_limit:
                logger.error(
                    "[Pipeline] Circuit breaker: %d consecutive failures, aborting remaining segments",
                    consecutive_failures,
                )
                break

            # Submit current segment
            future = executor.submit(_generate_one, seg)

            # If there's a pending future from previous iteration, collect it
            if pending_future is not None:
                result = pending_future.result()
                if result:
                    segment_files.append(result)
                    consecutive_failures = 0
                else:
                    consecutive_failures += 1

            pending_future = future
            pending_seg_idx = i

        # Collect the last pending future
        if pending_future is not None and consecutive_failures < circuit_breaker_limit:
            result = pending_future.result()
            if result:
                segment_files.append(result)
            else:
                consecutive_failures += 1

    return segment_files


# ============================================================================
# Voiceover Support
# ============================================================================

def parse_voiceover_text(gemini_response: str) -> str | None:
    """Extract VOICEOVER tagline from Gemini response.

    Looks for a line matching: VOICEOVER: "text here"
    Returns the text without quotes, or None if not found.
    """
    for line in gemini_response.split("\n"):
        line = line.strip()
        if line.upper().startswith("VOICEOVER:"):
            text = line.split(":", 1)[1].strip()
            # Remove surrounding quotes
            text = text.strip('"').strip("'")
            return text if text else None
    return None


def bake_voiceover(
    video_path: str,
    vo_audio: str,
    outro_start: float,
    music_path: str | None = None,
) -> str:
    """Mix voiceover + optional music onto final video.

    Args:
        video_path: Input video file
        vo_audio: Voiceover audio file (TTS output)
        outro_start: Seconds from start where outro begins
        music_path: Optional background music file

    Returns:
        Path to output video with baked audio
    """
    output_path = video_path.replace(".mp4", "_vo.mp4")
    delay_ms = int(outro_start * 1000)

    if music_path:
        # 3-way mix: video SFX (30%) + VO delayed (120%) + music (10%)
        filter_complex = (
            f"[0:a]volume=0.3[vaud];"
            f"[1:a]adelay={delay_ms}|{delay_ms},volume=1.2[vo];"
            f"[2:a]volume=0.10[music];"
            f"[vaud][vo][music]amix=inputs=3:duration=longest:dropout_transition=600[aout]"
        )
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", vo_audio,
            "-i", music_path,
            "-filter_complex", filter_complex,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            output_path,
        ]
    else:
        # 2-way mix: video SFX (30%) + VO delayed (120%)
        filter_complex = (
            f"[0:a]volume=0.3[vaud];"
            f"[1:a]adelay={delay_ms}|{delay_ms},volume=1.2[vo];"
            f"[vaud][vo]amix=inputs=2:duration=longest:dropout_transition=600[aout]"
        )
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", vo_audio,
            "-filter_complex", filter_complex,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            output_path,
        ]

    logger.info("[VO] Baking voiceover at %.1fs into %s", outro_start, output_path)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error("[VO] FFmpeg failed: %s", result.stderr[:500])
        raise SeedanceError(f"Voiceover bake failed: {result.stderr[:200]}")

    return output_path


# ============================================================================
# CLI
# ============================================================================

def build_parser() -> argparse.ArgumentParser:
    """Build CLI argument parser."""
    parser = argparse.ArgumentParser(
        description="Seedance 2.0 Omni Reference — multi-image, time-segmented video generation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Concept-driven (Gemini generates prompt)
  python seedance_omni.py --concept "Kids organic ad" --images "product:bag.png" "environment:villa.jpg" --duration 15 --yes

  # Direct prompt (skip Gemini)
  python seedance_omni.py --prompt "Scene 1 (0-5s): @image_file_1 bag on table..." --images "product:bag.png" --duration 15 --yes

  # Chained 30s video
  python seedance_omni.py --concept "Resort tour" --images "environment:pool.jpg" "logo:logo.png" --duration 30 --yes

  # Dry-run preview
  python seedance_omni.py --concept "Fashion reveal" --images "product:jacket.jpg" --duration 15 --dry-run
""",
    )

    # Input
    input_group = parser.add_argument_group("Input")
    input_group.add_argument(
        "--concept", "-c",
        help="Concept brief for Gemini prompt generation",
    )
    input_group.add_argument(
        "--prompt", "-p",
        help="Direct time-segmented prompt (skips Gemini)",
    )
    input_group.add_argument(
        "--images", "-i",
        nargs="+",
        help='Reference images as "role:path" (roles: product, environment, character, logo)',
    )
    input_group.add_argument(
        "--storyboard-panels",
        help="Path to storyboard_panels.json — injects per-scene panel as extra Seedance reference",
    )

    # Generation settings
    gen_group = parser.add_argument_group("Generation")
    gen_group.add_argument(
        "--duration", "-d",
        type=int,
        default=15,
        help="Total video duration in seconds (default: 15, max: 60)",
    )
    gen_group.add_argument(
        "--ratio", "-r",
        choices=["landscape", "portrait", "square"],
        default="landscape",
        help="Aspect ratio (default: landscape)",
    )
    gen_group.add_argument(
        "--quality", "-q",
        choices=["fast", "quality"],
        default="fast",
        help="Quality tier (default: fast)",
    )
    gen_group.add_argument(
        "--variants", "-n",
        type=int,
        default=1,
        help="Number of A/B variants (default: 1)",
    )

    # Output
    out_group = parser.add_argument_group("Output")
    out_group.add_argument(
        "--output-dir", "-o",
        default=None,
        help="Output directory (default: projects/<project>/videos/omni)",
    )
    out_group.add_argument(
        "--project", "--product",
        default="omni",
        help="Project/product name for output naming",
    )

    # Voiceover
    vo_group = parser.add_argument_group("Voiceover")
    vo_group.add_argument(
        "--voiceover", "--vo",
        action="store_true",
        help="Enable voiceover tagline on outro segment",
    )
    vo_group.add_argument(
        "--vo-style",
        default="luxury",
        choices=["luxury", "energetic", "minimal", "inspirational"],
        help="Voiceover style (default: luxury)",
    )
    vo_group.add_argument(
        "--vo-voice",
        default="Rachel",
        help="ElevenLabs voice name for TTS (default: Rachel)",
    )
    vo_group.add_argument(
        "--vo-text",
        help="Override auto-generated voiceover text",
    )
    vo_group.add_argument(
        "--music",
        help="Background music file path",
    )
    vo_group.add_argument(
        "--audio-ref",
        metavar="PATH",
        help="Audio file URL to use as BGM reference (audio_clone scenario)",
    )

    # Control
    ctrl_group = parser.add_argument_group("Control")
    ctrl_group.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview prompts and cost without generating",
    )
    ctrl_group.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Skip confirmation prompts",
    )
    ctrl_group.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )
    ctrl_group.add_argument(
        "--resume",
        action="store_true",
        help="Resume from last progress checkpoint (skip completed segments)",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    # Validate inputs
    if not args.concept and not args.prompt:
        parser.error("Provide --concept or --prompt")

    if not args.images:
        parser.error("Provide --images with at least one reference image")

    # Parse images
    images = parse_image_args(args.images)

    # Resolve output directory
    output_dir = args.output_dir
    if not output_dir:
        from config import PROJECT_BASE
        output_dir = os.path.join(PROJECT_BASE, args.project, "videos", "omni")

    project_path = os.path.join(
        os.path.dirname(output_dir.rstrip("/")),
        "..",
    ) if output_dir else None

    # Run pipeline
    try:
        results = generate_omni_video(
            concept=args.concept,
            prompt=args.prompt,
            images=images,
            duration=args.duration,
            ratio=args.ratio,
            quality=args.quality,
            output_dir=output_dir,
            project_name=args.project,
            variants=args.variants,
            dry_run=args.dry_run,
            yes=args.yes,
            project_path=project_path,
            resume=args.resume,
            voiceover=args.voiceover,
            vo_style=args.vo_style,
            vo_voice=args.vo_voice,
            vo_text=args.vo_text,
            music=args.music,
            storyboard_panels=getattr(args, "storyboard_panels", None),
            audio_ref_url=getattr(args, "audio_ref", None),
        )

        if results:
            sys.exit(0)
        elif args.dry_run:
            sys.exit(0)
        else:
            sys.exit(1)

    except SeedanceError as e:
        logger.error("Error: %s", e)
        sys.exit(1)
    except KeyboardInterrupt:
        logger.info("\nCancelled by user")
        sys.exit(130)


if __name__ == "__main__":
    main()
