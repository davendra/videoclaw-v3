#!/usr/bin/env python3
"""
Seedance 2.0 API backend for video generation.

ByteDance's Seedance 2.0 (st-ai/super-seed2) is a pure REST API backend
that bypasses veo-cli entirely. When backend=="seedance", generate_scene()
dispatches to seedance_generate_scene() which returns the same result dict
format so the rest of the pipeline (retry, stitch, TTS) works unchanged.

Capabilities beyond Veo:
- Audio-driven lip sync (feed TTS audio directly)
- Motion transfer (replicate a reference video's movements)
- Video extension (extend existing scenes by 4-15 seconds)
- Video plot editing (modify what happens in an existing video)
- Up to 12 media inputs (9 images + 3 videos + 3 audio)

Usage:
    from seedance_backend import seedance_generate_scene, is_retryable_error

    result = seedance_generate_scene(
        scene_number=1,
        prompt="Camera push in on villa exterior",
        mode="frames-to-video",
        image_path="projects/test/images/run001_scene_1_frame_landscape.jpg",
        quality="fast",
        ratio="landscape",
        output_dir="projects/test/videos",
        run_id="run001",
        variation=None,
        variations=1,
    )
"""

import json
import os
import subprocess
import time

import requests

import re

from config import (
    MIN_VIDEO_SIZE_BYTES,
    SEEDANCE_CANCEL_URL,
    SEEDANCE_CREATE_URL,
    SEEDANCE_CREDITS_PER_MODE,
    SEEDANCE_CREDITS_PER_SECOND,
    SEEDANCE_DEFAULT_DURATION,
    SEEDANCE_DURATION_TOLERANCE,
    SEEDANCE_FALLBACK_QUALITY,
    SEEDANCE_IMAGE_MAX_RES,
    SEEDANCE_IMAGE_MIN_RES,
    SEEDANCE_INITIAL_POLL_DELAY,
    SEEDANCE_MAX_AUDIO,
    SEEDANCE_MAX_CONTENT_RETRIES,
    SEEDANCE_MAX_DURATION,
    SEEDANCE_MAX_IMAGE_SIZE,
    SEEDANCE_MAX_IMAGES,
    SEEDANCE_MAX_MEDIA_TOTAL,
    SEEDANCE_MAX_POLL_TIME,
    SEEDANCE_MAX_VIDEOS,
    SEEDANCE_MIN_DURATION,
    SEEDANCE_MODEL_ID,
    SEEDANCE_MODEL_NOT_FOUND_PATTERNS,
    SEEDANCE_OUTPUT_RESOLUTION,
    SEEDANCE_OVER_DURATION_TOLERANCE,
    SEEDANCE_POLL_INTERVAL,
    SEEDANCE_QUALITY_MAP,
    SEEDANCE_QUERY_URL,
    SEEDANCE_RATIO_MAP,
    SEEDANCE_RATIO_MAP_EXTENDED,
    SEEDANCE_SERVICE_TIERS,
    SEEDANCE_SMART_POLL_INTERVAL,
    SEEDANCE_UPSCALE_RESOLUTION,
)
from exceptions import SeedanceError
from logging_config import setup_logging
import telemetry as _telemetry
from seedance_client import (
    get_api_key as _get_api_key_shared,
    get_headers as _get_headers_shared,
    is_content_violation,
    pre_validate_prompt,
    sanitize_prompt as sanitize_prompt_for_content_policy,
    create_task as _create_task_shared,
    poll_task as _poll_task_shared,
    extract_video_url as _extract_video_url_shared,
    download_video as _download_video_shared,
)

logger = setup_logging(__name__)

# Backward-compatible aliases (underscore-prefixed names used throughout this module)
_get_api_key = _get_api_key_shared
_get_headers = _get_headers_shared
_create_task = _create_task_shared
_poll_task = _poll_task_shared
_extract_video_url = _extract_video_url_shared
_download_video = _download_video_shared


def _get_video_duration(video_path: str) -> float | None:
    """Get video duration using ffprobe. Returns None if ffprobe fails."""
    try:
        from ffmpeg_wrapper import FFmpegWrapper
        ff = FFmpegWrapper()
        return ff.get_duration(video_path)
    except Exception:
        return None


def _trim_video(video_path: str, target_duration: int) -> bool:
    """Trim video to target duration using FFmpeg -c copy (no re-encode).

    Overwrites the original file. Returns True if trimmed successfully.
    """
    tmp_path = video_path + ".trimmed.mp4"
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", video_path,
                "-t", str(target_duration),
                "-c", "copy", "-avoid_negative_ts", "make_zero",
                tmp_path,
            ],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            logger.warning("[Seedance] Trim failed: %s", result.stderr[:200])
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return False

        # Verify trimmed file is valid
        trimmed_size = os.path.getsize(tmp_path)
        if trimmed_size < MIN_VIDEO_SIZE_BYTES:
            logger.warning("[Seedance] Trimmed file too small: %d bytes", trimmed_size)
            os.remove(tmp_path)
            return False

        # Replace original with trimmed
        os.replace(tmp_path, video_path)
        return True
    except Exception as e:
        logger.warning("[Seedance] Trim error: %s", e)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return False


def _reset_pts(video_path: str) -> None:
    """Reset container timestamps to fix Seedance A/V start time mismatch.

    Seedance videos have mismatched stream start times (video ~0.083s,
    audio ~0.036s). This lightweight remux with -avoid_negative_ts make_zero
    normalises both streams to start at 0, preventing PTS drift when
    segments are concatenated downstream.
    """
    tmp = video_path + ".pts_tmp.mp4"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path,
             "-c", "copy", "-avoid_negative_ts", "make_zero",
             tmp],
            check=True, capture_output=True,
        )
        os.replace(tmp, video_path)
    except subprocess.CalledProcessError:
        # Non-fatal: leave original if reset fails
        if os.path.exists(tmp):
            os.remove(tmp)


# Errors that indicate a transient failure (worth retrying)
_RETRYABLE_PATTERNS = [
    "timeout",
    "rate limit",
    "too many requests",
    "service unavailable",
    "internal server error",
    "502",
    "503",
    "504",
    "temporarily",
    "source files were unavailable",   # catbox/CDN URLs inaccessible from China
    "source file was unavailable",
    "source file unavailable",
]

# Errors that are permanent (do not retry)
_PERMANENT_PATTERNS = [
    "invalid api key",
    "unauthorized",
    "invalid parameter",
    "content policy",
    "nsfw",
    "insufficient credits",
    "insufficient balance",
]


# Note: is_content_violation, sanitize_prompt_for_content_policy, _get_api_key,
# _get_headers, _create_task, _poll_task, _extract_video_url, _download_video
# are imported from seedance_client.py (see imports above).


def check_balance() -> dict | None:
    """Check Seedance credit balance before generation.

    Returns:
        Dict with balance info (e.g. {"credits": 500, ...}),
        or None if the balance check fails (non-critical).
    """
    from config import SEEDANCE_BALANCE_URL
    try:
        api_key = _get_api_key()
        resp = requests.get(
            SEEDANCE_BALANCE_URL,
            headers=_get_headers(api_key),
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            # Try common response shapes
            if isinstance(data, dict):
                balance = data.get("data", data)
                return balance
        logger.debug("[Seedance] Balance check returned %d", resp.status_code)
        return None
    except Exception as e:
        logger.debug("[Seedance] Balance check failed: %s", e)
        return None


def validate_media_files(media_files: list[str]) -> list[str]:
    """Pre-API validation of media files against Seedance limits.

    Validates:
    - Max 12 total files (9 images + 3 videos + 3 audio)
    - Image files < 30MB
    - Image resolution between 300-6000px

    Args:
        media_files: List of file paths or URLs to validate

    Returns:
        List of warning/error strings (empty = all valid)
    """
    errors: list[str] = []
    image_count = 0
    video_count = 0
    audio_count = 0

    for f in media_files:
        # Classify by extension
        lower = f.lower()
        if any(lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp")):
            image_count += 1
            # Check file size for local files
            if os.path.isfile(f):
                size = os.path.getsize(f)
                if size > SEEDANCE_MAX_IMAGE_SIZE:
                    errors.append(f"Image too large: {f} ({size / 1024 / 1024:.1f}MB > {SEEDANCE_MAX_IMAGE_SIZE / 1024 / 1024:.0f}MB)")
                # Check resolution via PIL (best-effort)
                try:
                    from PIL import Image
                    with Image.open(f) as img:
                        w, h = img.size
                        if w < SEEDANCE_IMAGE_MIN_RES or h < SEEDANCE_IMAGE_MIN_RES:
                            errors.append(f"Image too small: {f} ({w}x{h}, min {SEEDANCE_IMAGE_MIN_RES}px)")
                        if w > SEEDANCE_IMAGE_MAX_RES or h > SEEDANCE_IMAGE_MAX_RES:
                            errors.append(f"Image too large: {f} ({w}x{h}, max {SEEDANCE_IMAGE_MAX_RES}px)")
                except Exception:
                    pass  # PIL not available or not an image — skip resolution check
        elif any(lower.endswith(ext) for ext in (".mp4", ".mov", ".webm", ".avi")):
            video_count += 1
        elif any(lower.endswith(ext) for ext in (".mp3", ".wav", ".m4a", ".aac", ".ogg")):
            audio_count += 1

    if image_count > SEEDANCE_MAX_IMAGES:
        errors.append(f"Too many images: {image_count} (max {SEEDANCE_MAX_IMAGES})")
    if video_count > SEEDANCE_MAX_VIDEOS:
        errors.append(f"Too many videos: {video_count} (max {SEEDANCE_MAX_VIDEOS})")
    if audio_count > SEEDANCE_MAX_AUDIO:
        errors.append(f"Too many audio files: {audio_count} (max {SEEDANCE_MAX_AUDIO})")
    if len(media_files) > SEEDANCE_MAX_MEDIA_TOTAL:
        errors.append(f"Too many total media files: {len(media_files)} (max {SEEDANCE_MAX_MEDIA_TOTAL})")

    return errors


def estimate_cost(
    mode: str,
    duration: int = SEEDANCE_DEFAULT_DURATION,
    quality: str = "fast",
    has_video_input: bool = False,
    service_tier: str = "default",
) -> dict:
    """Estimate credits and USD cost for a Seedance generation.

    Uses per-second credit rates from upstream docs for duration-aware pricing.
    Falls back to flat per-mode rates if the mode isn't in per-second table.

    Args:
        mode: Generation mode (text-to-video, frames-to-video, audio-lipsync, motion-transfer)
        duration: Video duration in seconds
        quality: "fast" or "quality"
        has_video_input: Whether a video reference is included (for camera-ref mode)
        service_tier: "default" or "flex" (50% cost)

    Returns:
        Dict with keys: credits, usd, per_second, mode, quality, service_tier
    """
    # Determine effective mode for cost lookup
    cost_mode = mode
    if has_video_input and mode not in ("motion-transfer",):
        cost_mode = "camera-ref"

    # Per-second pricing (upstream-documented, duration-aware)
    per_sec_rates = SEEDANCE_CREDITS_PER_SECOND.get(cost_mode, {})
    rate = per_sec_rates.get(quality)

    if rate is not None:
        credits = rate * max(duration, 1)
    else:
        # Fallback to flat per-mode rates
        mode_costs = SEEDANCE_CREDITS_PER_MODE.get(cost_mode, {})
        credits = mode_costs.get(quality, mode_costs.get("fast", 19))

    # Apply service tier multiplier
    tier_info = SEEDANCE_SERVICE_TIERS.get(service_tier, SEEDANCE_SERVICE_TIERS["default"])
    credits = credits * tier_info["cost_multiplier"]

    # Cost per credit (from config)
    from config import COST_PER_CREDIT
    usd = credits * COST_PER_CREDIT

    return {
        "credits": round(credits, 2),
        "usd": round(usd, 4),
        "per_second": round(credits / max(duration, 1), 2),
        "mode": mode,
        "quality": quality,
        "service_tier": service_tier,
    }


def check_balance_sufficient(estimated_credits: int) -> tuple[bool, int]:
    """Check if current balance is sufficient for estimated generation cost.

    Args:
        estimated_credits: Total estimated credits needed

    Returns:
        Tuple of (is_sufficient, current_balance).
        If balance check fails, returns (True, -1) to allow generation.
    """
    balance_info = check_balance()
    if balance_info is None:
        logger.debug("[Seedance] Balance check unavailable, proceeding anyway")
        return True, -1

    # Try multiple response shapes for credits field
    current = (
        balance_info.get("credits")
        or balance_info.get("balance")
        or balance_info.get("credit")
        or 0
    )

    try:
        current = int(current)
    except (ValueError, TypeError):
        return True, -1

    sufficient = current >= estimated_credits
    if not sufficient:
        logger.warning(
            "[Seedance] Insufficient balance: need %d credits, have %d",
            estimated_credits, current,
        )
    return sufficient, current


def extract_last_frame_from_response(result: dict) -> str | None:
    """Extract last frame URL from API response if available.

    Some Seedance API responses include a last_frame field that can be used
    directly for chained generation, avoiding ffmpeg extraction.

    Args:
        result: Full API response dict

    Returns:
        Last frame URL string, or None if not available
    """
    data = result.get("data", {})

    # Try common response shapes
    last_frame = data.get("result", {}).get("output", {}).get("last_frame")
    if last_frame:
        return last_frame

    last_frame = data.get("result", {}).get("last_frame")
    if last_frame:
        return last_frame

    last_frame = data.get("last_frame")
    if last_frame:
        return last_frame

    return None


def extract_price_from_response(result: dict) -> float | None:
    """Extract actual credits charged from API response.

    Args:
        result: Full API response dict

    Returns:
        Credits charged as float, or None if not found
    """
    data = result.get("data", {})

    # Price is typically in the task creation response, not completion
    price = data.get("price")
    if price is not None:
        try:
            return float(price)
        except (ValueError, TypeError):
            pass

    # Also check result sub-dict
    price = data.get("result", {}).get("price")
    if price is not None:
        try:
            return float(price)
        except (ValueError, TypeError):
            pass

    return None


def cancel_task(task_id: str) -> bool:
    """Cancel a running Seedance task.

    Args:
        task_id: Task ID to cancel

    Returns:
        True if cancellation was accepted, False otherwise
    """
    try:
        api_key = _get_api_key()
        resp = requests.post(
            SEEDANCE_CANCEL_URL,
            json={"task_id": task_id},
            headers=_get_headers(api_key),
            timeout=15,
        )
        if resp.status_code == 200:
            result = resp.json()
            if result.get("code") == 200:
                logger.info("[Seedance] Task %s cancelled", task_id)
                return True
            logger.warning("[Seedance] Cancel response: %s", result)
        else:
            logger.warning("[Seedance] Cancel HTTP %d: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.warning("[Seedance] Cancel error: %s", e)
    return False


def list_tasks(status: str | None = None, limit: int = 20) -> list[dict]:
    """List recent Seedance tasks.

    Args:
        status: Filter by status ("completed", "failed", "processing"). None = all.
        limit: Max tasks to return (default 20)

    Returns:
        List of task dicts, or empty list on failure
    """
    try:
        api_key = _get_api_key()
        params: dict = {"limit": limit}
        if status:
            params["status"] = status

        resp = requests.get(
            f"{SEEDANCE_CREATE_URL.rsplit('/', 1)[0]}/list",
            params=params,
            headers=_get_headers(api_key),
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            tasks = data.get("data", {}).get("tasks", [])
            if isinstance(tasks, list):
                return tasks[:limit]
        logger.debug("[Seedance] List tasks HTTP %d", resp.status_code)
    except Exception as e:
        logger.debug("[Seedance] List tasks error: %s", e)
    return []



# _create_task, _poll_task, _extract_video_url, _download_video
# are now imported from seedance_client.py (backward-compatible aliases above).


def _build_output_path(
    output_dir: str,
    scene_number: int,
    run_id: str | None,
    variation: int | None,
    variations: int,
) -> str:
    """Build output video file path matching the pipeline naming convention."""
    parts = []
    if run_id:
        parts.append(run_id)
    parts.append(f"scene_{scene_number}")
    if variation and variations > 1:
        parts.append(f"v{variation}")

    filename = "_".join(parts) + ".mp4"
    return os.path.join(output_dir, filename)


def _find_tts_file(tts_dir: str, scene_number: int) -> str | None:
    """Find TTS audio file for a scene, checking multiple naming patterns."""
    patterns = [
        f"scene_{scene_number}_tts.mp3",
        f"scene_{scene_number}_combined.mp3",
        f"scene_{scene_number}.mp3",
    ]
    for pattern in patterns:
        path = os.path.join(tts_dir, pattern)
        if os.path.exists(path):
            return path
    return None


def soften_image_for_content_filter(
    image_path: str,
    scene_number: int = 0,
    output_dir: str | None = None,
) -> str | None:
    """Analyze a blocked image and generate a softened description (v2.45).

    Uses Gemini Vision to describe the image, replacing combat/violence elements
    with softer alternatives. Saves the softened prompt to a `.prompt.txt` sidecar
    file for manual regeneration (e.g. via Go Bananas).

    Args:
        image_path: Path to the blocked image
        scene_number: Scene number (for logging)
        output_dir: Directory for sidecar file (defaults to image directory)

    Returns:
        Path to the saved .prompt.txt file, or None on failure
    """
    try:
        from config import GEMINI_FLASH_MODEL
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            logger.debug("[Scene %d] No GOOGLE_API_KEY — cannot soften image", scene_number)
            return None

        import base64
        from google import genai

        with open(image_path, "rb") as f:
            img_bytes = f.read()
        img_b64 = base64.b64encode(img_bytes).decode()
        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "webp": "image/webp"}.get(ext, "image/jpeg")

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": mime, "data": img_b64}},
                        {"text": (
                            "This image was blocked by a Chinese AI video content filter. "
                            "Describe the image in detail, but replace ALL combat/violence "
                            "elements with softer alternatives:\n"
                            "- Weapons → glowing staffs or magical wands\n"
                            "- Explosions → soft light bursts or energy halos\n"
                            "- Fighting poses → dancing or martial arts kata poses\n"
                            "- Blood/gore → colored mist or flower petals\n"
                            "- Military uniforms → flowing ceremonial robes\n\n"
                            "Keep the composition, characters, art style, and environment "
                            "the same. Output ONLY the softened image prompt (1-3 sentences), "
                            "suitable for AI image generation. No JSON, no markdown."
                        )},
                    ],
                }
            ],
        )
        softened_prompt = response.text.strip()
        if not softened_prompt:
            return None

        # Save sidecar file
        save_dir = output_dir or os.path.dirname(image_path)
        os.makedirs(save_dir, exist_ok=True)
        base_name = os.path.splitext(os.path.basename(image_path))[0]
        sidecar_path = os.path.join(save_dir, f"{base_name}_softened.prompt.txt")
        with open(sidecar_path, "w", encoding="utf-8") as f:
            f.write(softened_prompt)

        logger.info(
            "[Scene %d] Softened image prompt saved: %s",
            scene_number, sidecar_path,
        )
        logger.info(
            "[Scene %d] Regenerate via Go Bananas with this prompt: %s",
            scene_number, softened_prompt[:120],
        )
        return sidecar_path
    except Exception as e:
        logger.debug("[Scene %d] Image softening failed (non-fatal): %s", scene_number, e)
        return None


def analyze_image_risk(
    image_path: str,
    scene_number: int = 0,
) -> dict:
    """Analyze image for content that may trigger Seedance's content filter (v2.45).

    Uses Gemini Flash to classify image as low/medium/high risk for
    Chinese content moderation. Degrades gracefully — returns low risk
    if analysis fails or API key is missing.

    Returns:
        {"risk": "low|medium|high", "reasons": [...], "suggestion": str}
    """
    default = {"risk": "low", "reasons": [], "suggestion": ""}
    try:
        from config import GEMINI_FLASH_MODEL
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            logger.debug("[Scene %d] No GOOGLE_API_KEY — skipping image risk analysis", scene_number)
            return default

        import base64
        from google import genai

        with open(image_path, "rb") as f:
            img_bytes = f.read()
        img_b64 = base64.b64encode(img_bytes).decode()
        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "webp": "image/webp"}.get(ext, "image/jpeg")

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": mime, "data": img_b64}},
                        {"text": (
                            "Classify this image for Chinese video AI content moderation risk. "
                            "Detect: weapons actively in use, active combat/fighting, blood/gore, "
                            "real human faces (not cartoon), political/religious symbols, nudity. "
                            "Respond ONLY with valid JSON (no markdown):\n"
                            '{"risk": "low|medium|high", "reasons": ["reason1"], '
                            '"suggestion": "how to soften the image if high risk"}'
                        )},
                    ],
                }
            ],
        )
        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        parsed = json.loads(text)
        risk = parsed.get("risk", "low")
        reasons = parsed.get("reasons", [])
        suggestion = parsed.get("suggestion", "")
        logger.info(
            "[Scene %d] Image risk analysis: %s (reasons: %s)",
            scene_number, risk, ", ".join(reasons) if reasons else "none",
        )
        return {"risk": risk, "reasons": reasons, "suggestion": suggestion}
    except Exception as e:
        logger.debug("[Scene %d] Image risk analysis failed (non-fatal): %s", scene_number, e)
        return default


def seedance_generate_scene(
    scene_number: int,
    prompt: str,
    mode: str = "text-to-video",
    image_path: str | None = None,
    end_image_path: str | None = None,
    quality: str = "fast",
    ratio: str = "landscape",
    output_dir: str = ".",
    run_id: str | None = None,
    variation: int | None = None,
    variations: int = 1,
    duration: int | None = None,
    f2v_loop: bool = False,
    audio_path: str | None = None,
    motion_ref_path: str | None = None,
    camera_ref_path: str | None = None,
    tts_dir: str | None = None,
    project_path: str | None = None,
    dry_run: bool = False,
    service_tier: str = "default",
    extra_reference_urls: list[tuple[str, str]] | None = None,
    pre_analyze_images: bool = False,
    risk_threshold: str = "high",
) -> dict:
    """
    Generate a single scene video using Seedance 2.0 API.

    Returns the same result dict format as generate_scene() in parallel_video_gen.py
    so the retry logic, stitch pipeline, and TTS workflow work unchanged.

    Args:
        scene_number: Scene number for output naming
        prompt: Scene description / motion prompt
        mode: "text-to-video", "frames-to-video", "audio-lipsync", or "motion-transfer"
        image_path: Start image path (for I2V, lipsync, motion-transfer)
        end_image_path: End image path (for frames-to-video with end frame)
        quality: "fast" or "quality"
        ratio: "landscape", "portrait", or "square"
        output_dir: Directory for output video
        run_id: Run ID prefix for filename
        variation: Variation number (1-4)
        variations: Total variations count
        duration: Video duration seconds (4-15)
        f2v_loop: If True, use same image as start+end for seamless loop
        audio_path: TTS audio file for audio-lipsync mode
        motion_ref_path: Reference video for motion-transfer mode
        camera_ref_path: Reference video for camera movement (v2.35, any mode with image)
        tts_dir: TTS directory (for audio-lipsync auto-discovery)
        project_path: Project path for upload caching
        dry_run: If True, build prompt and return without calling API
        service_tier: "default" or "flex" (50% cost savings, v2.37)
        extra_reference_urls: Optional list of (url, prompt_note) tuples to append
            as additional image references (e.g., storyboard panels). Each tuple
            adds the URL to media_files and appends prompt_note to the prompt.

    Returns:
        {"scene_number", "success", "videos", "error", "mode", "prompt", ...}
    """
    from utils_upload import ensure_urls

    result = {
        "scene_number": scene_number,
        "success": False,
        "videos": [],
        "error": None,
        "mode": mode,
        "prompt": prompt,
        "image_path": image_path,
        "run_id": run_id,
        "variation": variation,
        "variations": variations,
    }

    tag = f"scene_{scene_number}"
    run_info = f" [{run_id}]" if run_id else ""
    var_info = f" v{variation}" if variation else ""
    logger.info("[Scene %d]%s%s Seedance generation (%s)...", scene_number, run_info, var_info, mode)
    logger.info(
        "[Seedance] Output resolution: %s (upscaled to %s during assembly)",
        SEEDANCE_OUTPUT_RESOLUTION, SEEDANCE_UPSCALE_RESOLUTION,
    )

    # Pre-validate prompt for likely content filter triggers (log warnings before API call)
    _pv_warnings = pre_validate_prompt(prompt)
    for _w in _pv_warnings:
        log_fn = logger.warning if _w["level"] == "HIGH" else logger.info
        log_fn(
            "[Scene %d] Content filter risk %s: %s (matched: %r)",
            scene_number, _w["level"], _w["reason"], _w["match"],
        )

    try:
        # Build prompt and media_files based on mode
        media_files_local: list[str] = []
        seedance_prompt = prompt

        if mode == "text-to-video":
            # Pure text — no media files (unless camera ref provided)
            seedance_prompt = prompt
            if camera_ref_path:
                seedance_prompt += " Fully reference @video1's camera movements."
                media_files_local.append(camera_ref_path)

        elif mode == "frames-to-video":
            if not image_path:
                result["error"] = "image_path required for frames-to-video mode"
                return result

            if f2v_loop:
                # Same image as start and end for seamless loop
                seedance_prompt = f"@image1 to @image2: {prompt}"
                media_files_local = [image_path, image_path]
            elif end_image_path:
                # Start + end frame
                seedance_prompt = f"@image1 to @image2: {prompt}"
                media_files_local = [image_path, end_image_path]
            else:
                # Single start image (I2V)
                seedance_prompt = f"@image1 {prompt}"
                media_files_local = [image_path]

            # Camera reference video (v2.35) — replicate camera movement from ref
            if camera_ref_path:
                seedance_prompt += " Fully reference @video1's camera movements."
                media_files_local.append(camera_ref_path)

        elif mode == "audio-lipsync":
            if not image_path:
                result["error"] = "image_path required for audio-lipsync mode"
                return result

            # Find TTS audio file
            if not audio_path and tts_dir:
                audio_path = _find_tts_file(tts_dir, scene_number)

            if not audio_path:
                result["error"] = f"No TTS audio found for scene {scene_number}"
                return result

            seedance_prompt = f"@image1 character speaks naturally, matching @audio1 content with natural expressions and lip movement. {prompt}"
            media_files_local = [image_path, audio_path]

        elif mode == "motion-transfer":
            if not image_path:
                result["error"] = "image_path required for motion-transfer mode"
                return result
            if not motion_ref_path:
                result["error"] = "motion_ref_path required for motion-transfer mode"
                return result

            seedance_prompt = f"@image1 character performs following @video1 motion and camera style. {prompt}"
            media_files_local = [image_path, motion_ref_path]

        else:
            result["error"] = f"Unknown mode: {mode}"
            return result

        # Append extra reference images (v2.43 — storyboard panels, etc.)
        if extra_reference_urls:
            for ref_url, ref_note in extra_reference_urls:
                media_files_local.append(ref_url)
                seedance_prompt += f" {ref_note}"
                logger.info("[Scene %d] Extra reference: %s", scene_number, ref_url[:80])

        # Dry-run: show what would be generated
        if dry_run:
            logger.info("[Scene %d] DRY RUN — Seedance prompt: %s", scene_number, seedance_prompt)
            logger.info("[Scene %d] DRY RUN — Media files: %s", scene_number, media_files_local)
            logger.info("[Scene %d] DRY RUN — Quality: %s, Ratio: %s, Duration: %s",
                        scene_number, quality, ratio, duration or SEEDANCE_DEFAULT_DURATION)
            result["success"] = True
            result["prompt"] = seedance_prompt
            return result

        # v2.45: Pre-submission image risk analysis (opt-in)
        if pre_analyze_images and image_path and os.path.isfile(image_path):
            risk_result = analyze_image_risk(image_path, scene_number)
            risk_level = risk_result.get("risk", "low")
            risk_levels = {"low": 0, "medium": 1, "high": 2}
            threshold_val = risk_levels.get(risk_threshold, 2)
            current_val = risk_levels.get(risk_level, 0)

            if trun := _telemetry.get_current_run():
                trun.record_image_risk(scene_number, risk_level, risk_result.get("reasons"))

            if current_val >= threshold_val:
                suggestion = risk_result.get("suggestion", "")
                msg = (
                    f"Image blocked by pre-analysis: risk={risk_level} "
                    f"(threshold={risk_threshold}). "
                    f"Reasons: {', '.join(risk_result.get('reasons', []))}."
                )
                if suggestion:
                    msg += f" Suggestion: {suggestion}"
                logger.warning("[Scene %d] %s", scene_number, msg)
                result["error"] = msg
                return result

        # Upload local files to get public URLs
        if media_files_local:
            logger.info("[Scene %d] Uploading %d media file(s)...", scene_number, len(media_files_local))
            media_urls = ensure_urls(media_files_local, project_path=project_path, rehost_risky=True)
            # Log final URLs for debugging silent rejections (status 20 stuck in processing)
            for i, (local, url) in enumerate(zip(media_files_local, media_urls)):
                logger.info("[Scene %d] Media[%d]: %s → %s", scene_number, i, os.path.basename(local) if not local.startswith("http") else local[:60], url)
        else:
            media_urls = []

        # Create + poll task, with content violation sanitization retries (v2.38)
        current_prompt = seedance_prompt
        content_retries = 0
        task_result = None

        # Track effective quality outside the loop so fallback persists across retries
        effective_quality = quality
        while task_result is None:
            try:
                task_id = _create_task(
                    prompt=current_prompt,
                    media_files=media_urls,
                    quality=effective_quality,
                    ratio=ratio,
                    duration=duration,
                    service_tier=service_tier,
                )
            except SeedanceError as e:
                error_str = str(e)
                if is_content_violation(error_str) and content_retries < SEEDANCE_MAX_CONTENT_RETRIES:
                    content_retries += 1
                    if run := _telemetry.get_current_run():
                        run.record_retry(scene_number, attempt=content_retries, reason="content_filter")
                    logger.warning(
                        "[Scene %d] Content violation — sanitizing prompt (level %d) and retrying...",
                        scene_number, content_retries,
                    )
                    current_prompt = sanitize_prompt_for_content_policy(current_prompt, level=content_retries)
                    logger.info("[Scene %d] Sanitized prompt: %s", scene_number, current_prompt[:120])
                    continue
                elif is_content_violation(error_str) and content_retries >= SEEDANCE_MAX_CONTENT_RETRIES:
                    # v2.45: On final content retry failure, generate softened image prompt
                    if image_path and os.path.isfile(image_path):
                        logger.warning(
                            "[Scene %d] All %d content retries exhausted — generating softened image prompt...",
                            scene_number, SEEDANCE_MAX_CONTENT_RETRIES,
                        )
                        soften_image_for_content_filter(image_path, scene_number,
                                                        output_dir=os.path.dirname(image_path))
                    raise
                elif is_model_not_found(error_str):
                    mode_str = SEEDANCE_QUALITY_MAP.get(effective_quality, effective_quality)
                    fallback = SEEDANCE_FALLBACK_QUALITY.get(mode_str)
                    if fallback:
                        fallback_key = next(
                            (k for k, v in SEEDANCE_QUALITY_MAP.items() if v == fallback),
                            effective_quality,
                        )
                        logger.warning(
                            "[Scene %d] Quality model '%s' unavailable, falling back to '%s'",
                            scene_number, mode_str, fallback,
                        )
                        if run := _telemetry.get_current_run():
                            run.record_quality_fallback(scene_number, from_q=quality, to_q=fallback_key)
                        effective_quality = fallback_key
                        task_id = _create_task(
                            prompt=current_prompt,
                            media_files=media_urls,
                            quality=effective_quality,
                            ratio=ratio,
                            duration=duration,
                            service_tier=service_tier,
                        )
                    else:
                        raise
                else:
                    raise

            # Poll until complete
            try:
                task_result = _poll_task(task_id)
            except SeedanceError as e:
                error_str = str(e)
                if is_content_violation(error_str) and content_retries < SEEDANCE_MAX_CONTENT_RETRIES:
                    content_retries += 1
                    if run := _telemetry.get_current_run():
                        run.record_retry(scene_number, attempt=content_retries, reason="content_filter")
                    logger.warning(
                        "[Scene %d] Content violation during poll — sanitizing prompt (level %d) and retrying...",
                        scene_number, content_retries,
                    )
                    current_prompt = sanitize_prompt_for_content_policy(current_prompt, level=content_retries)
                    logger.info("[Scene %d] Sanitized prompt: %s", scene_number, current_prompt[:120])
                    task_result = None  # Force retry
                    continue
                # Quality fallback on task failure (model unavailable mid-poll)
                elif is_model_not_found(error_str) and effective_quality == quality:
                    mode_str = SEEDANCE_QUALITY_MAP.get(quality, quality)
                    fallback = SEEDANCE_FALLBACK_QUALITY.get(mode_str)
                    if fallback:
                        fallback_key = next(
                            (k for k, v in SEEDANCE_QUALITY_MAP.items() if v == fallback),
                            quality,
                        )
                        logger.warning(
                            "[Scene %d] Task failed: model '%s' unavailable, retrying with '%s'",
                            scene_number, mode_str, fallback,
                        )
                        if run := _telemetry.get_current_run():
                            run.record_quality_fallback(scene_number, from_q=quality, to_q=fallback_key)
                        effective_quality = fallback_key
                        task_id = _create_task(
                            prompt=current_prompt,
                            media_files=media_urls,
                            quality=effective_quality,
                            ratio=ratio,
                            duration=duration,
                            service_tier=service_tier,
                        )
                        task_result = _poll_task(task_id)
                    else:
                        raise
                else:
                    raise

        # Update prompt in result if it was sanitized
        if current_prompt != seedance_prompt:
            logger.info(
                "[Scene %d] Prompt was sanitized (%d level(s)). Original: %s",
                scene_number, content_retries, seedance_prompt[:80],
            )
            seedance_prompt = current_prompt

        # Extract video URL
        video_url = _extract_video_url(task_result)

        # Download to local file
        output_path = _build_output_path(output_dir, scene_number, run_id, variation, variations)
        _download_video(video_url, output_path)
        _reset_pts(output_path)

        # Duration validation: retry once if video is too short (v2.34)
        requested_dur = duration or SEEDANCE_DEFAULT_DURATION
        requested_dur = max(SEEDANCE_MIN_DURATION, min(SEEDANCE_MAX_DURATION, requested_dur))
        actual_dur = _get_video_duration(output_path)
        if actual_dur is not None and actual_dur < requested_dur * SEEDANCE_DURATION_TOLERANCE:
            logger.warning(
                "[Scene %d] Short video: got %.1fs, wanted %ds — retrying once",
                scene_number, actual_dur, requested_dur,
            )
            os.remove(output_path)
            task_id2 = _create_task(
                prompt=seedance_prompt,
                media_files=media_urls,
                quality=effective_quality,
                ratio=ratio,
                duration=duration,
                service_tier=service_tier,
            )
            task_result2 = _poll_task(task_id2)
            video_url2 = _extract_video_url(task_result2)
            _download_video(video_url2, output_path)
            _reset_pts(output_path)
            actual_dur2 = _get_video_duration(output_path)
            if actual_dur2 is not None:
                logger.info("[Scene %d] Retry duration: %.1fs (wanted %ds)", scene_number, actual_dur2, requested_dur)
                actual_dur = actual_dur2  # update for over-duration check below

        # Over-duration auto-trim: if video is >150% of requested, trim it (v2.36)
        if actual_dur is None:
            actual_dur = _get_video_duration(output_path)
        if actual_dur is not None and actual_dur > requested_dur * SEEDANCE_OVER_DURATION_TOLERANCE:
            logger.warning(
                "[Scene %d] Over-duration: got %.1fs, wanted %ds — auto-trimming",
                scene_number, actual_dur, requested_dur,
            )
            if _trim_video(output_path, requested_dur):
                trimmed_dur = _get_video_duration(output_path)
                logger.info(
                    "[Scene %d] Trimmed to %.1fs (was %.1fs)",
                    scene_number, trimmed_dur or requested_dur, actual_dur,
                )
            else:
                logger.warning("[Scene %d] Trim failed, keeping original %.1fs video", scene_number, actual_dur)

        result["success"] = True
        result["videos"] = [output_path]
        result["prompt"] = seedance_prompt
        logger.info("[Scene %d] Seedance generation complete: %s", scene_number, output_path)

        # For audio-lipsync, write lip_sync_scenes.json metadata
        if mode == "audio-lipsync" and project_path:
            _write_lipsync_metadata(project_path, scene_number)

    except (SeedanceError, TimeoutError) as e:
        result["error"] = str(e)
        logger.error("[Scene %d] Seedance error: %s", scene_number, e)
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"
        logger.error("[Scene %d] Unexpected error: %s", scene_number, e, exc_info=True)

    return result


def _write_lipsync_metadata(project_path: str, scene_number: int) -> None:
    """Append scene to lip_sync_scenes.json for stitch auto-detection."""
    metadata_path = os.path.join(project_path, "videos", "lip_sync_scenes.json")
    existing = []
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path) as f:
                data = json.load(f)
                # Handle both formats: plain list [17,18] or dict {"scenes": [17,18]}
                if isinstance(data, list):
                    existing = data
                elif isinstance(data, dict) and "scenes" in data:
                    existing = data["scenes"]
        except (json.JSONDecodeError, OSError):
            existing = []

    if scene_number not in existing:
        existing.append(scene_number)
        existing.sort()
        os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
        with open(metadata_path, "w") as f:
            json.dump(existing, f)
        logger.info("[Seedance] Updated lip_sync_scenes.json: %s", existing)


def is_model_not_found(error_msg: str) -> bool:
    """Check if error indicates model unavailability (triggers quality fallback)."""
    if not error_msg:
        return False
    lower = error_msg.lower()
    for pattern in SEEDANCE_MODEL_NOT_FOUND_PATTERNS:
        if pattern.lower() in lower:
            return True
    return False


def is_retryable_error(error_msg: str) -> bool:
    """
    Classify whether a Seedance error is worth retrying.

    Model-not-found errors are classified as retryable so the caller
    can downgrade quality and retry (see quality fallback in
    seedance_generate_scene).

    Content violation errors (error code 2038) are classified as retryable
    so the caller can sanitize the prompt and retry (v2.38).

    Args:
        error_msg: Error message string

    Returns:
        True if error is transient and worth retrying
    """
    if not error_msg:
        return False

    lower = error_msg.lower()

    # Model-not-found is retryable (with quality downgrade)
    if is_model_not_found(error_msg):
        return True

    # Content violations are retryable (with prompt sanitization, v2.38)
    if is_content_violation(error_msg):
        return True

    # Check permanent errors first — never retry these
    for pattern in _PERMANENT_PATTERNS:
        if pattern in lower:
            return False

    # Check retryable patterns
    for pattern in _RETRYABLE_PATTERNS:
        if pattern in lower:
            return True

    # Default: don't retry unknown errors
    return False


# ============================================================================
# Standalone utilities for extend_video.py and edit_video.py
# ============================================================================

def extend_video(
    video_path: str,
    duration: int = 8,
    prompt: str = "",
    output_path: str | None = None,
    quality: str = "fast",
    project_path: str | None = None,
    genre: str | None = None,
    direction: str = "forward",
) -> str:
    """
    Extend an existing video by generating continuation.

    Args:
        video_path: Path to existing video
        duration: Extension duration (4-15 seconds)
        prompt: Optional guidance for continuation
        output_path: Output file path (default: {video}_extended.mp4)
        quality: "fast" or "quality"
        project_path: For upload caching
        genre: Optional genre for style tokens and negative prompts
        direction: "forward" (continue) or "backward" (prequel)

    Returns:
        Output file path

    Raises:
        SeedanceError: On generation failure
    """
    from utils_upload import ensure_urls

    if not output_path:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_extended{ext}"

    media_urls = ensure_urls([video_path], project_path=project_path)

    try:
        from seedance_prompt_builder import build_extension_prompt
        seedance_prompt = build_extension_prompt(
            continuation_description=prompt or "continue seamlessly, maintaining style and camera motion",
            duration=duration,
            genre=genre,
            direction=direction,
        )
    except ImportError:
        seedance_prompt = f"@video1 continue seamlessly, maintaining style and camera motion"
        if prompt:
            seedance_prompt = f"@video1 {prompt}"

    task_id = _create_task(
        prompt=seedance_prompt,
        media_files=media_urls,
        quality=quality,
        ratio="landscape",  # match source
        duration=duration,
    )

    task_result = _poll_task(task_id)
    video_url = _extract_video_url(task_result)
    _download_video(video_url, output_path)
    _reset_pts(output_path)

    return output_path


def edit_video(
    video_path: str,
    edit_prompt: str,
    output_path: str | None = None,
    quality: str = "fast",
    duration: int | None = None,
    project_path: str | None = None,
    edit_type: str = "general",
    target: str = "",
    replacement: str = "",
    genre: str | None = None,
) -> str:
    """
    Edit an existing video's content (plot editing).

    Args:
        video_path: Path to existing video
        edit_prompt: Description of desired changes
        output_path: Output file path (default: {video}_edited.mp4)
        quality: "fast" or "quality"
        duration: Override duration (default: match source)
        project_path: For upload caching
        edit_type: Edit template key (color_change, object_swap, etc.)
        target: What to change (e.g. "blue shirt", "daytime")
        replacement: What to change it to (e.g. "red", "nighttime")
        genre: Optional genre for style-aware negative prompts

    Returns:
        Output file path

    Raises:
        SeedanceError: On generation failure
    """
    from utils_upload import ensure_urls

    if not output_path:
        base, ext = os.path.splitext(video_path)
        output_path = f"{base}_edited{ext}"

    media_urls = ensure_urls([video_path], project_path=project_path)

    try:
        from seedance_prompt_builder import build_edit_prompt
        seedance_prompt = build_edit_prompt(
            edit_description=edit_prompt,
            edit_type=edit_type,
            target=target,
            replacement=replacement,
            genre=genre,
        )
    except ImportError:
        seedance_prompt = f"@video1 {edit_prompt}"

    task_id = _create_task(
        prompt=seedance_prompt,
        media_files=media_urls,
        quality=quality,
        ratio="landscape",
        duration=duration,
    )

    task_result = _poll_task(task_id)
    video_url = _extract_video_url(task_result)
    _download_video(video_url, output_path)
    _reset_pts(output_path)

    return output_path
