#!/usr/bin/env python3
"""
Shared Seedance 2.0 API client layer.

Provides common API functions used by both seedance_backend.py (pipeline integration)
and seedance_omni.py (standalone omni_reference mode). Extracted to avoid duplication.

Functions:
    get_api_key()              — Read SUTUI_API_KEY from environment
    get_headers(api_key)       — Build request headers
    is_content_violation(msg)  — Check if error is content moderation (2038)
    pre_validate_prompt(text)  — Check prompt for likely-to-fail patterns, return warnings
    sanitize_prompt(text, lvl) — Sanitize prompt for content policy
    create_task(...)           — Create a Seedance video generation task
    poll_task(task_id)         — Poll task until completion
    extract_video_url(result)  — Extract video URL from API response
    download_video(url, path)  — Download video to local file

Content Filter Notes (Seedance 2.0, updated Feb 2026):
    Seedance enforces strict server-side safety filters (prompt scan + input analysis).
    Filters tightened significantly after launch due to Hollywood IP backlash, deepfake
    concerns, and Chinese regulatory requirements. Key risk categories:

    HIGH RISK (almost always blocked):
    - Real human faces/photos as reference images
    - Children/minors (any age mention under ~18 in sensitive contexts)
    - Celebrity/public figure names or strong likenesses
    - Copyrighted characters/IP (Marvel, Disney, Star Wars, anime named characters, etc.)
    - NSFW / nudity / sexual / suggestive content
    - Political figures or sensitive political topics

    MEDIUM RISK (sometimes blocked, retry with sanitization):
    - Realistic human figures without stylization cues
    - Brand names, trademarks, product names
    - Violence/combat (graphic) — mild graceful motion often passes
    - Audio with voice cloning potential

    SAFE (reliable):
    - Generic "young adult figure", "elegant dancer", "athletic person"
    - Fully stylized: anime, cartoon, 3D render, illustration, painting, surreal
    - Camera/motion descriptors: dolly, pan, push in, slow zoom, cinematic
    - Environment/nature/architecture without identifiable real places
    - Abstract/non-human subjects
    - Own AI-generated stylized images as references (no real faces)
"""

import json
import os
import re
import threading
import time

import requests

from config import (
    MIN_VIDEO_SIZE_BYTES,
    SEEDANCE_CREATE_URL,
    SEEDANCE_DEAD_TASK_THRESHOLD,
    SEEDANCE_DEFAULT_DURATION,
    SEEDANCE_DEFAULT_RESOLUTION,
    SEEDANCE_GENERATE_AUDIO,
    SEEDANCE_INITIAL_POLL_DELAY,
    SEEDANCE_MAX_DURATION,
    SEEDANCE_MAX_POLL_TIME,
    SEEDANCE_MIN_DURATION,
    SEEDANCE_MODEL_ID,
    SEEDANCE_POLL_INTERVAL,
    SEEDANCE_QUALITY_MAP,
    SEEDANCE_QUERY_URL,
    SEEDANCE_RATIO_MAP,
    SEEDANCE_RATIO_MAP_EXTENDED,
    SEEDANCE_SMART_POLL_INTERVAL,
    SEEDANCE_USE_ARK_API,
    SEEDANCE_WATERMARK,
)
from exceptions import SeedanceError, SeedanceTimeoutError
from logging_config import setup_logging

logger = setup_logging(__name__)


# ============================================================================
# Content Violation Detection
# ============================================================================

# Content violation errors from Chinese content moderation (retryable with sanitization)
_CONTENT_VIOLATION_PATTERNS = [
    "content violates regulations",
    "violates regulations",
    "error code: 2038",
    "error code:2038",
    "违规",           # Chinese: "violation"
    "内容违规",        # Chinese: "content violation"
    "内容不合规",      # Chinese: "content non-compliant"
    "审核不通过",      # Chinese: "review failed"
    "内容安全",        # Chinese: "content safety"
    "触发安全",        # Chinese: "triggered safety"
]

# Regex for media references that must be preserved during sanitization
_MEDIA_REF_PATTERN = re.compile(r"@(?:image|video|audio)\d+")

# Patterns for brand/product names and marketing language
_BRAND_PATTERNS = [
    re.compile(r"\b[A-Z][a-z]+[A-Z]\w*\b"),               # CamelCase: ChronoLux, SmartWatch
    re.compile(r'\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\b'),         # ALL CAPS multi-word: LUXURY BRAND
    re.compile(r'"[^"]{2,30}"'),                            # Quoted names: "ChronoLux"
    re.compile(r"'[^']{2,30}'"),                            # Single-quoted names
    re.compile(r"(?:™|®|©)"),                               # Trademark symbols
]

_MARKETING_WORDS = re.compile(
    r"\b(?:revolutionary|groundbreaking|world[- ]?class|best[- ]?in[- ]?class|"
    r"premium|luxury|exclusive|limited[- ]?edition|award[- ]?winning|"
    r"patented|proprietary|trademarked|branded|signature|"
    r"unrivaled|unmatched|unparalleled|superior|ultimate|"
    r"#\d+\s+(?:selling|rated|ranked)|market[- ]?leading|"
    r"buy\s+now|order\s+today|shop\s+now|get\s+yours|"
    r"discount|sale|offer|deal|promo|coupon|free\s+shipping)\b",
    re.IGNORECASE,
)

# High-risk terms: celebrities, copyrighted characters, political figures
# These are near-certain filter triggers — level 1 sanitization replaces them
_CELEBRITY_IP_PATTERNS = re.compile(
    r"\b(?:"
    # Common celebrity/public figure names (sample — keep generic in prompts)
    r"taylor\s+swift|beyoncé|beyonce|selena\s+gomez|ariana\s+grande|"
    r"tom\s+cruise|brad\s+pitt|leonardo\s+dicaprio|scarlett\s+johansson|"
    r"elon\s+musk|jeff\s+bezos|bill\s+gates|steve\s+jobs|barack\s+obama|"
    r"donald\s+trump|vladimir\s+putin|xi\s+jinping|"
    # Copyrighted characters — Marvel/DC/Disney/other
    r"spider[- ]?man|iron\s+man|captain\s+america|thor|hulk|black\s+widow|"
    r"batman|superman|wonder\s+woman|joker|harley\s+quinn|"
    r"mickey\s+mouse|minnie\s+mouse|elsa|anna|olaf|moana|simba|"
    r"darth\s+vader|yoda|luke\s+skywalker|stormtrooper|r2[- ]?d2|"
    r"harry\s+potter|hermione|dumbledore|voldemort|"
    r"mario|luigi|pikachu|goku|naruto|luffy|"
    r"shrek|donkey|fiona|"
    r"stranger\s+things|eleven|eleven\s+hopper|"
    r"arcane|jinx|vi\s+jinx|jayce|"
    # Brands/franchises
    r"marvel|avengers|x[- ]?men|dc\s+comics|star\s+wars|disney|pixar|"
    r"netflix\s+original|hbo\s+max|prime\s+video"
    r")\b",
    re.IGNORECASE,
)

# High-risk: minors / children (highest risk category per ByteDance policy)
_MINOR_PATTERNS = re.compile(
    r"\b(?:child|children|kid|kids|boy|girl|baby|infant|toddler|teenager|teen|"
    r"adolescent|juvenile|minor|underage|youth|young\s+child|little\s+girl|"
    r"little\s+boy|school\s+child|school\s+kid|pre[- ]?teen|tween|"
    r"\d+[- ]?year[- ]?old(?!\s*(?:tree|building|car|wine|whiskey|aged))|"  # e.g. "5-year-old" but not "5-year-old whiskey"
    r"age\s+[1-9]\b|age\s+1[0-7]\b"  # age 1-17
    r")\b",
    re.IGNORECASE,
)

# Pre-validation risk levels
_PRE_VALIDATE_HIGH = "HIGH"
_PRE_VALIDATE_MEDIUM = "MEDIUM"
_PRE_VALIDATE_LOW = "LOW"


# ============================================================================
# API Key & Headers
# ============================================================================

def get_api_key() -> str:
    """Read SUTUI_API_KEY from environment."""
    key = os.environ.get("SUTUI_API_KEY", "")
    if not key:
        raise SeedanceError(
            "SUTUI_API_KEY not set. Get one at https://www.xskill.ai/#/v2/api-keys"
        )
    return key


def get_headers(api_key: str) -> dict:
    """Build request headers."""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


# ============================================================================
# Content Moderation
# ============================================================================

def is_content_violation(error_msg: str) -> bool:
    """Check if error indicates a content regulation violation (error code 2038).

    These errors come from Seedance's Chinese content moderation and are
    retryable with prompt sanitization.
    """
    if not error_msg:
        return False
    lower = error_msg.lower()
    for pattern in _CONTENT_VIOLATION_PATTERNS:
        if pattern.lower() in lower:
            return True
    return False


def pre_validate_prompt(prompt: str) -> list[dict]:
    """Check a prompt for likely content filter triggers before submission.

    Returns a list of warning dicts, each with:
        {"level": "HIGH"|"MEDIUM"|"LOW", "reason": str, "match": str}

    HIGH warnings are near-certain filter triggers.
    MEDIUM warnings sometimes pass but should be reworded if errors occur.
    LOW warnings are advisory only.

    Usage:
        warnings = pre_validate_prompt(scene_prompt)
        for w in warnings:
            logger.warning("[Seedance] %s risk: %s (matched: %r)", w["level"], w["reason"], w["match"])
    """
    warnings = []
    text = prompt.lower()

    # HIGH: Celebrity names / copyrighted IP
    match = _CELEBRITY_IP_PATTERNS.search(prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_HIGH,
            "reason": "Celebrity name or copyrighted character detected. Replace with generic description.",
            "match": match.group(0),
        })

    # HIGH: Children / minors (highest priority category per ByteDance policy)
    match = _MINOR_PATTERNS.search(prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_HIGH,
            "reason": "Minor/child reference detected. Use 'young adult' (mid-20s) instead, or remove age.",
            "match": match.group(0),
        })

    # HIGH: NSFW / sexual / nudity
    nsfw_terms = re.compile(
        r"\b(?:nude|naked|nudity|topless|bottomless|nsfw|sexy|sexual|erotic|"
        r"lingerie|underwear|bikini\s+(?:model|shoot)|intimate\s+(?:scene|moment|touch)|"
        r"suggestive|revealing\s+(?:outfit|clothing|dress)|cleavage|seductive)\b",
        re.IGNORECASE,
    )
    match = nsfw_terms.search(prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_HIGH,
            "reason": "NSFW/sexual content detected. Keep characters fully clothed in neutral contexts.",
            "match": match.group(0),
        })

    # HIGH: Political figures / sensitive politics
    political_terms = re.compile(
        r"\b(?:president|prime\s+minister|senator|congressman|chancellor|"
        r"communist\s+party|ccp|politburo|government\s+official|"
        r"protest|revolution|coup|dictator|regime|propaganda)\b",
        re.IGNORECASE,
    )
    match = political_terms.search(prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_HIGH,
            "reason": "Political content detected. Avoid political figures and events entirely.",
            "match": match.group(0),
        })

    # MEDIUM: Real human faces as references (usually in prompt description, not detectable
    # from text alone — flag if prompt strongly implies realistic portraiture)
    portrait_terms = re.compile(
        r"\b(?:real\s+person|real\s+face|photo[- ]?realistic\s+(?:person|face|human)|"
        r"portrait\s+photo|headshot|selfie|face\s+swap|deepfake|"
        r"based\s+on\s+(?:a\s+)?(?:photo|image|picture)\s+of)\b",
        re.IGNORECASE,
    )
    match = portrait_terms.search(prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_MEDIUM,
            "reason": "Photo-realistic portrait reference detected. Use stylized/illustrated references only.",
            "match": match.group(0),
        })

    # MEDIUM: Violence / gore
    violence_terms = re.compile(
        r"\b(?:gore|blood(?:y|ied)?|decapitat|dismember|brutal\s+(?:fight|kill|death)|"
        r"graphic\s+(?:violence|injury|wound)|murder|execution|torture|"
        r"combat\s+with\s+(?:blood|injury|death)|war\s+crime)\b",
        re.IGNORECASE,
    )
    match = violence_terms.search(prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_MEDIUM,
            "reason": "Graphic violence detected. Use 'energetic movement' or 'graceful action' instead.",
            "match": match.group(0),
        })

    # MEDIUM: Trademark symbols or very specific brand names
    match = re.search(r"(?:™|®|©)", prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_MEDIUM,
            "reason": "Trademark symbol detected. Remove brand marks from prompts.",
            "match": match.group(0),
        })

    # LOW: Anime named characters (sometimes flagged post-Feb 2026)
    anime_named = re.compile(
        r"\b(?:goku|naruto\s+uzumaki|luffy|sasuke|vegeta|nezuko|tanjiro|"
        r"levi\s+ackerman|mikasa|eren\s+yeager|jujutsu|demon\s+slayer)\b",
        re.IGNORECASE,
    )
    match = anime_named.search(prompt)
    if match:
        warnings.append({
            "level": _PRE_VALIDATE_LOW,
            "reason": "Named anime character detected. Use generic 'anime-style warrior/hero' instead.",
            "match": match.group(0),
        })

    return warnings


def sanitize_prompt(prompt: str, level: int = 1) -> str:
    """Sanitize a prompt to avoid content regulation violations.

    Args:
        prompt: Original prompt text (may contain @image1/@video1/@audio1 refs)
        level: Sanitization aggressiveness
            1 = Light: strip brand names, celebrity/IP names, marketing superlatives
            2 = Heavy: reduce to pure camera motion + generic visual description

    Returns:
        Sanitized prompt string with media references preserved
    """
    # Extract and preserve media references (@image1, @video1, @audio1)
    media_refs = _MEDIA_REF_PATTERN.findall(prompt)
    # Remove media refs from text for processing, rejoin later
    text = _MEDIA_REF_PATTERN.sub("", prompt).strip()

    if level == 1:
        text = _sanitize_level1(text)
    elif level >= 2:
        text = _sanitize_level2(text)

    # Rejoin media refs at the start (where Seedance expects them)
    if media_refs:
        prefix = " ".join(media_refs)
        text = f"{prefix} {text}".strip()

    return text


def _sanitize_level1(text: str) -> str:
    """Light sanitization: strip brand names, celebrity/IP names, and marketing language."""
    # Strip celebrity names and copyrighted IP (near-certain filter triggers)
    text = _CELEBRITY_IP_PATTERNS.sub("", text)

    # Replace minor/child references with safe generic alternative
    # Use "young adult" rather than empty string to preserve sentence meaning
    text = _MINOR_PATTERNS.sub("young adult", text)

    # Strip brand/product names and marketing superlatives
    for pattern in _BRAND_PATTERNS:
        text = pattern.sub("", text)
    text = _MARKETING_WORDS.sub("", text)

    # Clean up whitespace artifacts
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\s+([,.])", r"\1", text)
    text = re.sub(r"^[,.\s]+", "", text)
    text = text.strip()
    return text


def _sanitize_level2(text: str) -> str:
    """Heavy sanitization: reduce to camera motion + generic visual description."""
    camera_pattern = re.compile(
        r"(?:camera|pan|tilt|dolly|tracking|push|pull|zoom|orbit|crane|"
        r"aerial|close[- ]?up|wide[- ]?shot|medium[- ]?shot|establish|"
        r"follow|static|slow[- ]?motion|time[- ]?lapse|"
        r"forward|backward|left|right|up|down|in|out|"
        r"smooth|gentle|dramatic|cinematic|sweeping)\s*\w*",
        re.IGNORECASE,
    )
    camera_frags = camera_pattern.findall(text)

    visual_pattern = re.compile(
        r"(?:person|object|product|scene|interior|exterior|room|"
        r"table|surface|background|light|shadow|color|"
        r"bright|dark|warm|cool|soft|natural|ambient|"
        r"golden[- ]?hour|sunset|sunrise|morning|evening|night)\s*\w*",
        re.IGNORECASE,
    )
    visual_frags = visual_pattern.findall(text)

    parts = []
    if camera_frags:
        parts.append(" ".join(camera_frags[:5]))
    if visual_frags:
        parts.append(" ".join(visual_frags[:5]))

    if parts:
        return ". ".join(parts).strip()

    return "Smooth camera movement across the scene"


# ============================================================================
# Task Creation
# ============================================================================

def create_task(
    prompt: str,
    media_files: list[str],
    quality: str = "fast",
    ratio: str = "landscape",
    duration: int | None = None,
    service_tier: str = "default",
    callback_url: str | None = None,
) -> str:
    """Create a Seedance video generation task.

    Supports two API formats based on SEEDANCE_USE_ARK_API config:

    **ark/seedance-2.0** (default):
        - ``image_url`` for first-frame I2V (mutually exclusive with ``reference_images``)
        - ``reference_images`` array for character refs / multi-image (up to 9)
        - When both scene image and character refs exist, ALL go into
          ``reference_images`` (scene image first, then character sheets)
        - ``reference_videos``, ``reference_audios`` for video/audio refs
        - Duration as string, ``generate_audio``, ``resolution``, ``watermark``

    **st-ai/super-seed2** (legacy):
        - ``image_files`` array format with ``functionMode: omni_reference``

    Args:
        prompt: Prompt text with optional @image1/@video1/@audio1 references
        media_files: List of public media URLs (images, videos, audio).
            For ark model: first image = scene frame (I2V), rest = character refs.
        quality: "fast" or "quality"
        ratio: Base ("landscape", "portrait", "square") or extended
        duration: Video duration in seconds (4-15, default: 15)
        service_tier: "default" or "flex" (50% cost savings)

    Returns:
        task_id string

    Raises:
        SeedanceError: On API failure
    """
    api_key = get_api_key()
    mode = SEEDANCE_QUALITY_MAP.get(quality, "seedance_2.0_fast")
    aspect_ratio = SEEDANCE_RATIO_MAP.get(ratio) or SEEDANCE_RATIO_MAP_EXTENDED.get(ratio, "16:9")
    dur = duration or SEEDANCE_DEFAULT_DURATION
    dur = max(SEEDANCE_MIN_DURATION, min(SEEDANCE_MAX_DURATION, dur))

    # Auto-classify media files by extension
    _image_exts = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
    _video_exts = {'.mp4', '.mov', '.webm', '.avi', '.mkv'}
    _audio_exts = {'.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'}

    _image_files: list[str] = []
    _video_files: list[str] = []
    _audio_files: list[str] = []
    for url in (media_files or []):
        # Asset URIs (Asset://asset-xxx) are always image references
        if url.startswith("Asset://"):
            _image_files.append(url)
            continue
        ext = os.path.splitext(url.split('?')[0])[1].lower()
        if ext in _video_exts:
            _video_files.append(url)
        elif ext in _audio_exts:
            _audio_files.append(url)
        else:
            _image_files.append(url)  # default: treat as image

    if SEEDANCE_USE_ARK_API:
        params = _build_ark_params(
            prompt, _image_files, _video_files, _audio_files,
            mode, aspect_ratio, dur,
        )
    else:
        params = _build_legacy_params(
            prompt, _image_files, _video_files, _audio_files,
            mode, aspect_ratio, dur,
        )

    payload: dict = {
        "model": SEEDANCE_MODEL_ID,
        "params": params,
        "channel": None,
    }

    # Webhook callback (v2.46): xskill.ai POSTs status changes to this URL
    if callback_url:
        payload["callback_url"] = callback_url

    if service_tier and service_tier != "default":
        payload["params"]["service_tier"] = service_tier

    logger.info("[Seedance] Creating task: prompt=%s...", prompt[:80])
    logger.info(
        "[Seedance] model=%s, images=%d videos=%d audio=%d, ratio=%s, duration=%s, mode=%s, tier=%s",
        SEEDANCE_MODEL_ID,
        len(_image_files), len(_video_files), len(_audio_files),
        aspect_ratio, params.get("duration", dur), mode, service_tier,
    )

    try:
        resp = requests.post(
            SEEDANCE_CREATE_URL,
            json=payload,
            headers=get_headers(api_key),
            timeout=30,
        )
    except requests.RequestException as e:
        raise SeedanceError(f"Network error creating task: {e}") from e

    if resp.status_code != 200:
        raise SeedanceError(f"HTTP {resp.status_code}: {resp.text[:500]}")

    result = resp.json()
    if result.get("code") != 200:
        raise SeedanceError(f"Task creation failed: {json.dumps(result, ensure_ascii=False)[:500]}")

    task_id = result["data"]["task_id"]
    price = result["data"].get("price", "?")
    logger.info("[Seedance] Task created: id=%s, credits=%s", task_id, price)
    return task_id


def _build_ark_params(
    prompt: str,
    image_files: list[str],
    video_files: list[str],
    audio_files: list[str],
    mode: str,
    aspect_ratio: str,
    dur: int,
) -> dict:
    """Build params dict for ark/seedance-2.0 API format.

    Key rules for image handling:
    - ``image_url`` and ``reference_images`` are MUTUALLY EXCLUSIVE
    - Single image (scene frame only, no character refs) -> ``image_url`` for I2V
    - Multiple images (scene frame + character refs) -> ALL go into
      ``reference_images`` array (scene image first, then character sheets)
    - Character refs only (no scene frame) -> ``reference_images``

    Duration is passed as a string (ark requirement).
    """
    params: dict = {
        "prompt": prompt,
        "ratio": aspect_ratio,
        "duration": str(dur),
        "model": mode,
        "resolution": SEEDANCE_DEFAULT_RESOLUTION,
        "generate_audio": SEEDANCE_GENERATE_AUDIO,
        "watermark": SEEDANCE_WATERMARK,
    }

    if image_files:
        # Check if all images are Asset URIs (safe for reference_images mode).
        # Raw HTTP URLs with real-person faces get rejected in reference_images
        # but the filter is looser for image_url (first-frame mode).
        all_assets = all(u.startswith("Asset://") for u in image_files)
        if len(image_files) == 1:
            params["image_url"] = image_files[0]
        elif all_assets:
            # All Asset URIs — safe to use reference_images for multi-character
            params["reference_images"] = image_files
        else:
            # Mix of HTTP URLs + Asset URIs — use image_url (first frame, looser
            # filter) for the scene image, skip character sheets to avoid rejection
            params["image_url"] = image_files[0]
            logger.info("[Seedance] Using image_url mode (mixed URLs detected, reference_images may trigger real-person filter)")

    if video_files:
        params["reference_videos"] = video_files
    if audio_files:
        params["reference_audios"] = audio_files

    return params


def _build_legacy_params(
    prompt: str,
    image_files: list[str],
    video_files: list[str],
    audio_files: list[str],
    mode: str,
    aspect_ratio: str,
    dur: int,
) -> dict:
    """Build params dict for legacy st-ai/super-seed2 API format.

    Uses image_files/video_files/audio_files arrays with
    functionMode: omni_reference.
    """
    params: dict = {
        "prompt": prompt,
        "ratio": aspect_ratio,
        "duration": dur,
        "model": mode,
        "functionMode": "omni_reference",
    }

    if image_files:
        params["image_files"] = image_files
    if video_files:
        params["video_files"] = video_files
    if audio_files:
        params["audio_files"] = audio_files

    return params


# ============================================================================
# Failure Recovery Suggestions
# ============================================================================


def _suggest_recovery(error_msg: str, prompt: str) -> str:
    """Suggest a fix based on the error message and prompt content."""
    msg = error_msg.lower()
    suggestions = []

    if "real person" in msg or "content filter" in msg or "2038" in msg:
        suggestions.append("Upload image to Asset Library first (Asset:// URI bypasses real-person filter)")
    if "celebrity" in msg or "public figure" in msg:
        suggestions.append("Remove celebrity references. Describe the character generically instead")
    if "violence" in msg or "gore" in msg:
        suggestions.append("Reduce violence level. Use 'action sequence' instead of explicit violence")
    if "timeout" in msg or "timed out" in msg:
        suggestions.append("Try shorter duration (5s instead of 15s) or simpler prompt")
    if "too long" in msg or "token" in msg:
        suggestions.append("Shorten the prompt — remove redundant descriptions")
    if "nsfw" in msg or "adult" in msg:
        suggestions.append("Remove NSFW content. Keep it PG-13 for Seedance")

    if not suggestions:
        suggestions.append("Try simplifying the prompt or using a different scene description")

    return " | ".join(suggestions)


# ============================================================================
# Task Polling
# ============================================================================

def poll_task(
    task_id: str,
    smart_poll: bool = True,
    webhook_event: "threading.Event | None" = None,
) -> dict:
    """Poll a Seedance task until completion.

    Uses smart polling by default: initial 30s delay before first poll,
    then 15s intervals instead of 5s.

    Webhook acceleration (v2.46): when ``webhook_event`` is provided,
    sleeps are replaced with ``event.wait(timeout=interval)``. If a
    webhook fires, the event is set and the poll loop wakes immediately
    instead of waiting the full interval. This is purely an accelerator —
    the authoritative status always comes from the API query, not the
    webhook payload.

    Dead-task detection (v2.45): tracks ``updated_at`` from the API response.
    If the value stays unchanged for ``SEEDANCE_DEAD_TASK_THRESHOLD`` seconds
    the task is assumed stalled — we attempt to cancel it and raise
    ``SeedanceTimeoutError`` immediately instead of waiting the full 600s.

    Args:
        task_id: Task ID from create_task()
        smart_poll: If True, use initial 30s delay + 15s intervals.
        webhook_event: Optional threading.Event set by webhook receiver on
            task status change. Wakes the poll loop early.

    Returns:
        Full API response dict on completion

    Raises:
        SeedanceError: On task failure
        SeedanceTimeoutError: If task doesn't complete within max poll time
            or is detected as dead/stalled
    """
    api_key = get_api_key()
    elapsed = 0

    def _wait(seconds: float) -> None:
        """Sleep or wait on webhook event. Clears event if triggered."""
        nonlocal elapsed
        if webhook_event is not None:
            triggered = webhook_event.wait(timeout=seconds)
            if triggered:
                webhook_event.clear()
                logger.info("[Seedance] %ds — webhook woke poll loop early", elapsed)
        else:
            time.sleep(seconds)
        elapsed += seconds

    if smart_poll:
        initial_delay = SEEDANCE_INITIAL_POLL_DELAY
        poll_interval = SEEDANCE_SMART_POLL_INTERVAL
        webhook_tag = " +webhook" if webhook_event else ""
        logger.info("[Seedance] Polling task %s (initial wait %ds, then every %ds, max %ds%s)...",
                     task_id, initial_delay, poll_interval, SEEDANCE_MAX_POLL_TIME, webhook_tag)
        _wait(initial_delay)
    else:
        poll_interval = SEEDANCE_POLL_INTERVAL
        webhook_tag = " +webhook" if webhook_event else ""
        logger.info("[Seedance] Polling task %s (every %ds, max %ds%s)...",
                     task_id, poll_interval, SEEDANCE_MAX_POLL_TIME, webhook_tag)

    # Dead-task detection state (v2.45)
    last_updated_at: str | None = None
    last_updated_at_changed: float = time.time()

    while elapsed < SEEDANCE_MAX_POLL_TIME:
        try:
            resp = requests.post(
                SEEDANCE_QUERY_URL,
                json={"task_id": task_id},
                headers=get_headers(api_key),
                timeout=30,
            )
        except requests.RequestException as e:
            logger.warning("[Seedance] Poll network error (%ds): %s", elapsed, e)
            _wait(poll_interval)
            continue

        if resp.status_code != 200:
            logger.warning("[Seedance] Poll HTTP %d (%ds)", resp.status_code, elapsed)
            _wait(poll_interval)
            continue

        result = resp.json()
        data = result.get("data", {})
        status = data.get("status", "unknown")
        logger.info("[Seedance] %ds — status: %s", elapsed, status)

        if status == "completed":
            return result

        if status == "failed":
            error_msg = (
                data.get("output", {}).get("error", "")
                or data.get("error", "Unknown error")
            )
            recovery = _suggest_recovery(error_msg, "")
            logger.warning("[Seedance] Recovery suggestion: %s", recovery)
            raise SeedanceError(f"Task failed: {error_msg}. Suggestion: {recovery}")

        # Dead-task detection (v2.45): check updated_at staleness
        current_updated_at = data.get("updated_at") or data.get("updateTime") or ""
        if current_updated_at != last_updated_at:
            last_updated_at = current_updated_at
            last_updated_at_changed = time.time()
        else:
            stall_duration = time.time() - last_updated_at_changed
            if stall_duration >= SEEDANCE_DEAD_TASK_THRESHOLD:
                logger.warning(
                    "[Seedance] Task %s appears dead — updated_at unchanged for %.0fs "
                    "(status: %s). Attempting cancel.",
                    task_id, stall_duration, status,
                )
                # Record telemetry event
                try:
                    from telemetry import get_current_run
                    if run := get_current_run():
                        run.record_dead_task(task_id=task_id, stall_duration=stall_duration)
                except Exception:
                    pass
                # Attempt to cancel the stalled task
                try:
                    from seedance_backend import cancel_task
                    cancel_task(task_id)
                except Exception:
                    pass
                raise SeedanceTimeoutError(
                    f"Seedance task {task_id} appears dead — updated_at unchanged "
                    f"for {stall_duration:.0f}s (threshold: {SEEDANCE_DEAD_TASK_THRESHOLD}s)"
                )

        _wait(poll_interval)

    raise SeedanceTimeoutError(f"Seedance task {task_id} timed out after {SEEDANCE_MAX_POLL_TIME}s")


# ============================================================================
# Video URL Extraction
# ============================================================================

def extract_video_url(task_result: dict) -> str:
    """Extract video URL from task result, handling multiple response shapes.

    Known shapes:
    1. data.result.output.images[0]
    2. data.output.video_url
    3. data.result.video_url
    4. data.result.output.videos[0]
    5. data.video_url

    Returns:
        Video URL string

    Raises:
        SeedanceError: If no video URL found
    """
    data = task_result.get("data", {})

    images = data.get("result", {}).get("output", {}).get("images", [])
    if images:
        return images[0]

    video_url = data.get("output", {}).get("video_url", "")
    if video_url:
        return video_url

    video_url = data.get("result", {}).get("video_url", "")
    if video_url:
        return video_url

    videos = data.get("result", {}).get("output", {}).get("videos", [])
    if videos:
        return videos[0]

    video_url = data.get("video_url", "")
    if video_url:
        return video_url

    raise SeedanceError(f"No video URL in response: {json.dumps(data)[:300]}")


# ============================================================================
# Video Download
# ============================================================================

def download_video(video_url: str, output_path: str) -> str:
    """Stream download a video from URL to local file.

    Returns:
        output_path on success

    Raises:
        SeedanceError: On download failure
    """
    logger.info("[Seedance] Downloading video to %s...", output_path)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # Write to a sibling .tmp path first and atomically rename on success.
    # A crash mid-download leaves only the .tmp, so downstream existsSync
    # checks on output_path never see a half-written file.
    tmp_path = f"{output_path}.tmp"
    try:
        resp = requests.get(video_url, stream=True, timeout=120)
        resp.raise_for_status()

        with open(tmp_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

    except requests.RequestException as e:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise SeedanceError(f"Download failed: {e}") from e

    file_size = os.path.getsize(tmp_path)
    if file_size < MIN_VIDEO_SIZE_BYTES:
        os.remove(tmp_path)
        raise SeedanceError(f"Downloaded video too small ({file_size} bytes), likely corrupt")

    os.replace(tmp_path, output_path)
    logger.info("[Seedance] Downloaded: %s (%.1fMB)", output_path, file_size / 1024 / 1024)
    return output_path
