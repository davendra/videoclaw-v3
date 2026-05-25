#!/usr/bin/env python3
"""
Centralized configuration for video-replicator scripts.

All constants, paths, and presets are defined here instead of being
scattered across individual scripts. Import from this module:

    from config import (
        VEO_CLI_PATH, PROJECT_BASE,
        LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT,
        PORTRAIT_WIDTH, PORTRAIT_HEIGHT,
    )
"""

import os
from pathlib import Path

# ============================================================================
# Path Resolution
# ============================================================================

# scripts/ directory
SCRIPTS_DIR = Path(__file__).resolve().parent

# videoclaw project root (2 levels up from scripts/video/)
_PROJECT_ROOT = SCRIPTS_DIR.parent.parent

# Default paths (overridable via environment variables)
VEO_CLI_PATH: str = os.environ.get(
    "VEO_CLI_PATH", str(_PROJECT_ROOT / "veo-cli")
)
PROJECT_BASE: str = os.environ.get(
    "VIDEO_REPLICATOR_PROJECTS", str(Path.home() / "videoclaw" / "projects")
)


# ============================================================================
# Image Dimensions
# ============================================================================

# Standard portrait dimensions (9:16 ratio)
PORTRAIT_WIDTH: int = 504
PORTRAIT_HEIGHT: int = 896
PORTRAIT_RATIO: float = 9 / 16  # 0.5625

# Standard landscape dimensions (16:9 ratio) — matches Veo output
LANDSCAPE_WIDTH: int = 1280
LANDSCAPE_HEIGHT: int = 720
LANDSCAPE_RATIO: float = 16 / 9  # 1.778


# ============================================================================
# Retry Settings
# ============================================================================

MAX_RETRIES: int = 2
RETRY_DELAY_SECONDS: int = 30

# Diagnostic prompt for image rejection detection (v2.39)
# Used to test whether an image is being rejected by Google's content filter.
# This prompt is intentionally neutral — no subject matter, no action, just
# camera movement and lighting. If generation fails with this prompt too,
# the IMAGE itself is the problem (not the prompt text).
IMAGE_DIAGNOSTIC_PROMPT: str = "Slow camera push in, ambient light, cinematic"


# ============================================================================
# File Size Thresholds
# ============================================================================

# Minimum valid video file size (100KB) — smaller files are likely corrupt
MIN_VIDEO_SIZE_BYTES: int = 100_000

# Minimum valid image file size (1KB)
MIN_IMAGE_SIZE_BYTES: int = 1_000


# ============================================================================
# Audio Volume Presets
# ============================================================================

AUDIO_PRESETS: dict = {
    "default": {
        "music_volume": 0.6,
        "video_volume": 0.3,
        "music_fade_out": 3.0,
    },
    "presenter": {
        "music_volume": 0.25,
        "video_volume": 0.85,
        "music_fade_out": 3.0,
    },
    "narrated": {
        "music_volume": 0.15,
        "video_volume": 0.85,
        "music_fade_out": 3.0,
    },
}


# ============================================================================
# Quality Presets
# ============================================================================

QUALITY_PRESETS: dict = {
    "draft": {
        "quality": "fast",
        "variations": 1,
    },
    "final": {
        "quality": "quality",
        "variations": 2,
    },
}

# Credits per video by quality tier
CREDITS_PER_VIDEO: dict = {
    "quality": 100,
    "fast": 10,
    "free": 0,
    "veo2": 100,
}

# Approximate cost per credit (USD)
COST_PER_CREDIT: float = 0.005


# ============================================================================
# Lip-Sync Prompt Pattern
# ============================================================================

# Template for Veo lip-sync dialogue scenes.
# Proven pattern: Veo 3 generates lip-synced audio when dialogue is in the prompt.
# {character} = character description, {dialogue} = spoken text,
# {action} = physical actions, {environment} = scene setting
LIP_SYNC_PROMPT_PATTERN: str = (
    "The {character} speaks directly to camera saying: \"{dialogue}\". "
    "{action}. {environment}."
)


# ============================================================================
# FFmpeg Settings
# ============================================================================

FFMPEG_TIMEOUT: int = 300  # 5 minutes default timeout
FFPROBE_TIMEOUT: int = 10
CONCAT_FILTER_THRESHOLD: int = 8  # Use concat filter (not demuxer) for 8+ segments to prevent A/V drift

# FPS Normalization (v2.45) — explicit constants for Seedance/Veo output frame rates
SEEDANCE_OUTPUT_FPS: int = 60   # Seedance outputs 60fps
TARGET_ASSEMBLY_FPS: int = 24   # Pipeline normalizes everything to 24fps


# ============================================================================
# UGC Campaign Settings
# ============================================================================

# Default number of belief scripts per campaign
UGC_DEFAULT_SCRIPTS: int = 3

# Scene types in UGC belief-driven scripts
UGC_SCENE_TYPES: list = [
    "hook", "problem", "mechanism", "proof", "offer", "cta",
]

# Word limits per segment duration (seconds → max words)
UGC_WORD_LIMITS: dict = {
    4: 12,
    6: 18,
    8: 25,
    12: 35,
}

# Subtitle defaults
UGC_SUBTITLE_FONT_SIZE: int = 48
UGC_SUBTITLE_WORDS_PER_LINE: int = 6

# UGC audio preset (voice-forward with subtle music)
AUDIO_PRESETS["ugc"] = {
    "music_volume": 0.10,
    "video_volume": 0.90,
    "music_fade_out": 2.0,
}


# ============================================================================
# Seedance 2.0 Backend Settings
# ============================================================================

SEEDANCE_BASE_URL: str = "https://api.xskill.ai"
SEEDANCE_CREATE_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/tasks/create"
SEEDANCE_QUERY_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/tasks/query"
SEEDANCE_CANCEL_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/tasks/cancel"
SEEDANCE_BALANCE_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/balance"
# ark/seedance-2.0 (default) vs legacy st-ai/super-seed2
# Set SEEDANCE_USE_ARK_API=false to revert to the legacy model.
SEEDANCE_USE_ARK_API: bool = os.environ.get("SEEDANCE_USE_ARK_API", "true").lower() != "false"
SEEDANCE_MODEL_ID_ARK: str = "ark/seedance-2.0"
SEEDANCE_MODEL_ID_LEGACY: str = "st-ai/super-seed2"
SEEDANCE_MODEL_ID: str = SEEDANCE_MODEL_ID_ARK if SEEDANCE_USE_ARK_API else SEEDANCE_MODEL_ID_LEGACY

# ark/seedance-2.0 specific defaults
SEEDANCE_DEFAULT_RESOLUTION: str = "720p"
SEEDANCE_GENERATE_AUDIO: bool = True
SEEDANCE_WATERMARK: bool = False

SEEDANCE_QUALITY_MAP: dict = {
    "fast": "seedance_2.0_fast",
    "quality": "seedance_2.0",
}

SEEDANCE_RATIO_MAP: dict = {
    "landscape": "16:9",
    "portrait": "9:16",
    "square": "1:1",
}

SEEDANCE_MIN_DURATION: int = 4
SEEDANCE_MAX_DURATION: int = 15
SEEDANCE_DEFAULT_DURATION: int = 15
SEEDANCE_POLL_INTERVAL: int = 5   # seconds between status polls
SEEDANCE_MAX_POLL_TIME: int = 1200  # 20 minutes max wait per task

CATBOX_UPLOAD_URL: str = "https://catbox.moe/user/api.php"
UGUU_UPLOAD_URL: str = "https://uguu.se/upload"
UGUU_MAX_FILE_SIZE: int = 100 * 1024 * 1024  # 100MB (uguu.se limit)

# xskill.ai upload (uses same CDN as Seedance — guaranteed accessible)
XSKILL_UPLOAD_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/upload"
XSKILL_MAX_FILE_SIZE: int = 10 * 1024 * 1024  # 10MB conservative limit

# xskill.ai MCP upload (Streamable HTTP, works when /api/v3/upload returns 404)
XSKILL_MCP_HTTP_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/mcp-http"
XSKILL_MCP_MESSAGE_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/mcp/message"  # legacy SSE-era path (fallback)
XSKILL_MCP_TIMEOUT: int = 60  # upload timeout

# Seedance quality fallback (model unavailability recovery)
SEEDANCE_FALLBACK_QUALITY: dict = {
    "seedance_2.0": "seedance_2.0_fast",  # quality → fast
}
SEEDANCE_MODEL_NOT_FOUND_PATTERNS: list = [
    "模型菜单中未找到",    # Chinese: "model not found in menu"
    "model not found",
    "model unavailable",
]

# Seedance per-mode credit costs (flat per-5s, legacy — kept for backward compat)
SEEDANCE_CREDITS_PER_MODE: dict = {
    "text-to-video": {"fast": 12, "quality": 19},
    "frames-to-video": {"fast": 19, "quality": 19},
    "audio-lipsync": {"fast": 19, "quality": 19},
    "motion-transfer": {"fast": 38, "quality": 38},
    "camera-ref": {"fast": 24, "quality": 24},
}

# Seedance per-second credit rates (upstream docs, duration-aware pricing)
# Modes without video input: fast=2.4/sec, quality=3.0/sec
# Modes with video input:    fast=4.8/sec, quality=6.0/sec
SEEDANCE_CREDITS_PER_SECOND: dict = {
    "text-to-video":   {"fast": 2.4, "quality": 3.0},
    "frames-to-video": {"fast": 2.4, "quality": 3.0},
    "audio-lipsync":   {"fast": 2.4, "quality": 3.0},
    "motion-transfer": {"fast": 4.8, "quality": 6.0},
    "camera-ref":      {"fast": 4.8, "quality": 6.0},
}

# 4K Upscale Pre-Flight (v2.43) — upscale frame images via Go Bananas before Seedance
UPSCALE_4K_DEFAULT_PROMPT: str = "upscale image, high detail, 4K, preserve all details, cinematic quality"

# Style Consistency Classification (v2.43) — Gemini Vision style categories
STYLE_CONSISTENCY_CATEGORIES: list = [
    "photorealistic", "3d_animated", "anime", "sketch", "illustration", "mixed",
]

# Seedance output resolution (xskill.ai platform limitation)
SEEDANCE_OUTPUT_RESOLUTION: str = "640x360"
SEEDANCE_UPSCALE_RESOLUTION: str = "1280x720"

# Seedance duration validation
SEEDANCE_DURATION_TOLERANCE: float = 0.8  # retry if actual < 80% of requested
SEEDANCE_OVER_DURATION_TOLERANCE: float = 1.1  # auto-trim if actual > 110% of requested

# amix filter safe default (prevents early audio termination)
AMIX_DROPOUT_TRANSITION: int = 600

# Domains known to be inaccessible from Seedance's Chinese infrastructure.
# URLs on these domains are automatically re-downloaded and re-uploaded to a
# China-accessible CDN (imgbb or xskill) before being sent to the Seedance API.
SEEDANCE_REHOST_DOMAINS: list = [
    "catbox.moe",     # catbox uploads (blocked from China)
    "uguu.se",        # uguu temporary uploads (expire ~48h, not China-reliable)
    # Note: r2.dev (Cloudflare R2) removed — Go Bananas R2 URLs are globally accessible
]

# Seedance Dead Task Detection (v2.45) — detect stalled tasks in poll loop
SEEDANCE_DEAD_TASK_THRESHOLD: int = 1200  # seconds with no updated_at change → assume dead (I2V can take 10-20 min)

# Seedance Smart Polling (v2.37) — initial delay then longer intervals
SEEDANCE_INITIAL_POLL_DELAY: int = 30  # Wait 30s before first poll (task won't be done sooner)
SEEDANCE_SMART_POLL_INTERVAL: int = 15  # Then poll every 15s (was 5s, saves ~10 wasted calls)

# Seedance Extended Ratio Map (v2.37) — includes ultrawide, classic, cinemascope
# API-validated: only these 6 raw values accepted: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16
SEEDANCE_RATIO_MAP_EXTENDED: dict = {
    "landscape": "16:9",
    "portrait": "9:16",
    "square": "1:1",
    "ultrawide": "21:9",
    "classic": "4:3",
    "classic_portrait": "3:4",
    "cinemascope": "21:9",  # API rejects 2.35:1 — maps to closest supported ultrawide
    "adaptive": "adaptive",
}

# Seedance Media File Limits (v2.37)
SEEDANCE_MAX_IMAGES: int = 9
SEEDANCE_MAX_VIDEOS: int = 3
SEEDANCE_MAX_AUDIO: int = 3
SEEDANCE_MAX_MEDIA_TOTAL: int = 12
SEEDANCE_MAX_REF_DURATION: int = 15  # max total seconds for video/audio references
SEEDANCE_MAX_IMAGE_SIZE: int = 30 * 1024 * 1024  # 30MB per image
SEEDANCE_IMAGE_MIN_RES: int = 300   # minimum image dimension (px)
SEEDANCE_IMAGE_MAX_RES: int = 6000  # maximum image dimension (px)

# Seedance Service Tiers (v2.37) — flex tier gives 50% cost savings
SEEDANCE_SERVICE_TIERS: dict = {
    "default": {"cost_multiplier": 1.0},
    "flex": {"cost_multiplier": 0.5},
}

# Seedance content violation auto-retry (v2.38)
SEEDANCE_MAX_CONTENT_RETRIES: int = 2  # Max sanitization retries per scene

# Seedance auto-fallback backend (v2.45) — switch to Veo on permanent Seedance failure
SEEDANCE_FALLBACK_BACKEND: str = "useapi"  # Backend to fall back to
SEEDANCE_FALLBACK_ENABLED: bool = False    # Disabled by default; enable via --fallback-backend

# Seedance pre-submission image analysis (v2.45) — Gemini-based risk detection
SEEDANCE_PRE_ANALYZE_IMAGES: bool = False  # Disabled by default; enable via --pre-analyze-images
SEEDANCE_RISK_THRESHOLD: str = "high"      # Block images at this risk level or above

# Seedance Omni Reference Mode (v2.39)
SEEDANCE_OMNI_FUNCTION_MODE: str = "omni_reference"
SEEDANCE_OMNI_MAX_IMAGES: int = 4          # Max image_file_N slots (1-4)
SEEDANCE_OMNI_MAX_DURATION: int = 15       # Single omni_reference max seconds
SEEDANCE_OMNI_SEGMENT_DURATION: int = 15   # Max seconds per segment (for chaining)
SEEDANCE_OMNI_MAX_SEGMENTS: int = 4        # Max chained segments (60s total)
SEEDANCE_OMNI_IMAGE_ROLES: list = ["product", "environment", "character", "logo"]
SEEDANCE_OMNI_CROSSFADE_DURATION: float = 0.5  # Crossfade between chained segments
SEEDANCE_OMNI_CREDITS_PER_SEGMENT: int = 150   # Actual cost per omni_reference segment

# Storyboard Panels JSON (v2.43) — maps scene numbers to panel images for Seedance reference
STORYBOARD_PANELS_FILE: str = "analysis/storyboard_panels.json"

# Camera Variety Block (v2.43) — append to Seedance prompts for dynamic camera angles
CAMERA_VARIETY_BLOCK: str = (
    "a lot of camera shots: Extreme wide shot, wide shot, medium shot, medium close-up, "
    "close-up, extreme close-up, over-the-shoulder, point-of-view, insert shot, two-shot, "
    "tracking shot, push-in, pull-back, crane shot, arc shot, high angle, low angle, "
    "Dutch angle, and top-down bird's-eye shot."
)

# Seedance Prompt Engine (v2.35)
SEEDANCE_NEGATIVE_PROMPTS: str = "No text, no subtitles, no watermarks, no logos, no abrupt cuts"
SEEDANCE_TIME_SEGMENT_THRESHOLD: int = 8  # Add time segments for clips >= this duration

# Seedance Prompt Library DB (v2.36)
SEEDANCE_PROMPT_DB_PATH: str = str(SCRIPTS_DIR / "data" / "seedance_prompts.db")
SEEDANCE_PROMPT_DATA_DIR: str = str(SCRIPTS_DIR / "data")

# Seedance Batch Settings
SEEDANCE_BATCH_SUBMIT_DELAY: float = 0.5     # seconds between submissions
SEEDANCE_BATCH_MAX_WORKERS: int = 20          # max concurrent pollers
SEEDANCE_BATCH_POLL_TIMEOUT: int = 1800       # 30 min default per task
SEEDANCE_BATCH_CHECKPOINT_INTERVAL: int = 1   # save after every N completions

# ============================================================================
# Seedance Webhook Settings (v2.46)
# ============================================================================

SEEDANCE_WEBHOOK_ENABLED: bool = os.environ.get("SEEDANCE_WEBHOOK_ENABLED", "true").lower() != "false"
SEEDANCE_WEBHOOK_PORT: int = int(os.environ.get("SEEDANCE_WEBHOOK_PORT", "0"))  # 0 = auto
SEEDANCE_WEBHOOK_USE_TUNNEL: bool = os.environ.get("SEEDANCE_WEBHOOK_USE_TUNNEL", "true").lower() != "false"
SEEDANCE_WEBHOOK_PATH: str = "/webhook/seedance"

# xskill.ai Asset Library (character reference images → Asset URIs bypass content filter)
SEEDANCE_ASSET_GROUPS_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/assets/groups"
SEEDANCE_ASSETS_URL: str = f"{SEEDANCE_BASE_URL}/api/v3/assets"
SEEDANCE_ASSET_GROUP_NAME: str = "videoclaw-characters"
SEEDANCE_ASSET_CACHE_FILE: str = str(Path.home() / ".videoclaw" / "asset_cache.json")


# ============================================================================
# useapi.net Backend Settings (Extend Chain, v2.38)
# ============================================================================

USEAPI_BASE_URL: str = "https://api.useapi.net/v1"
USEAPI_VIDEOS_URL: str = f"{USEAPI_BASE_URL}/google-flow/videos"
USEAPI_EXTEND_URL: str = f"{USEAPI_BASE_URL}/google-flow/videos/extend"
USEAPI_CONCAT_URL: str = f"{USEAPI_BASE_URL}/google-flow/videos/concatenate"
USEAPI_ASSETS_URL: str = f"{USEAPI_BASE_URL}/google-flow/assets"  # append /{email}
USEAPI_JOBS_URL: str = f"{USEAPI_BASE_URL}/google-flow/jobs"      # append /{jobId}

USEAPI_MODEL_MAP: dict = {
    "fast": "veo-3.1-fast",
    "quality": "veo-3.1-quality",
    "lite": "veo-3.1-lite",
    "free": "veo-3.1-lite-low-priority",   # veo-3.1-fast-relaxed was removed by the API
    "relaxed": "veo-3.1-lite-low-priority",
    "omni-flash": "omni-flash",
}

USEAPI_POLL_INTERVAL: int = 3       # seconds between job status polls
USEAPI_MAX_POLL_TIME: int = 600     # 10 minutes max wait
USEAPI_REQUEST_TIMEOUT: int = 30    # HTTP request timeout (non-generation)
USEAPI_GENERATION_TIMEOUT: int = 180  # 3 minutes for video generation (sync response)
USEAPI_DOWNLOAD_TIMEOUT: int = 120  # video download timeout
USEAPI_MAX_IMAGE_SIZE: int = 20 * 1024 * 1024  # 20MB upload limit

# Google Flow v1 video duration (seconds): 4/6 Ultra-only on Veo, 10 omni-flash only.
USEAPI_DEFAULT_DURATION: int = 8

# The 30 Google Flow voice-narration presets (referenceAudio_1..5).
USEAPI_VOICE_PRESETS: list = [
    "Achird", "Achernar", "Algieba", "Algenib", "Alnilam", "Aoede", "Autonoe",
    "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux",
    "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Puck", "Pulcherrima",
    "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat", "Umbriel",
    "Vindemiatrix", "Zephyr", "Zubenelgenubi",
]

# Extend Chain defaults
EXTEND_CHAIN_OVERLAP_TRIM: float = 1.0  # seconds to trim from extension starts
EXTEND_CHAIN_SEGMENT_DURATION: float = 8.0  # approximate duration per segment


# ============================================================================
# Story Engine & Film Pipeline Settings (v2.37)
# ============================================================================

GEMINI_FLASH_MODEL: str = os.environ.get("GEMINI_FLASH_MODEL", "gemini-3-flash-preview")
GEMINI_PRO_MODEL: str = os.environ.get("GEMINI_PRO_MODEL", "gemini-2.0-pro-exp")
STORY_ENGINE_DURATIONS: list = [4, 6, 8]
STORY_ENGINE_DEFAULT_SHOTS: int = 6
STORY_ENGINE_MAX_SHOTS: int = 20

# Film Pipeline phases
FILM_PHASES: list = [
    "concept", "analysis", "screenplay", "characters", "breakdown",
    "images", "videos", "audio", "stitch", "complete",
]
FILM_SUPPORTED_BACKENDS: list = ["seedance", "direct", "useapi"]


# ============================================================================
# Music Generation Settings (Kie.ai / Suno)
# ============================================================================

KIE_API_BASE: str = "https://api.kie.ai"
MUSIC_MAX_RETRIES: int = 2             # Default retry attempts on failure
MUSIC_RETRY_BACKOFF: list = [30, 60]   # Seconds between retries (exponential)
MUSIC_POLL_INTERVAL: int = 5           # Seconds between status polls
MUSIC_POLL_MAX_ATTEMPTS: int = 60      # Max poll attempts (5 min at 5s interval)
MUSIC_POLL_TIMEOUT_MULTIPLIER: int = 2 # Multiply poll attempts on retry

# Retryable failure patterns (case-insensitive substring match)
MUSIC_RETRYABLE_ERRORS: list = [
    "GENERATE_AUDIO_FAILED",
    "timed out",
    "timeout",
    "Generation timed out",
]


# ============================================================================
# Narration Conductor
# ============================================================================

# ===================================================================
# Title Card
# ===================================================================

# Default hold duration (seconds)
TITLE_CARD_DURATION: int = 4

# Target dimensions (must match video pipeline)
TITLE_CARD_WIDTH: int = LANDSCAPE_WIDTH   # 1280
TITLE_CARD_HEIGHT: int = LANDSCAPE_HEIGHT  # 720

# FPS (must match video pipeline)
TITLE_CARD_FPS: int = 24

# Dark band at bottom (semi-transparent overlay for text legibility)
TITLE_CARD_BAND_TOP: int = 560
TITLE_CARD_BAND_OPACITY: int = 160  # 0-255 alpha

# Title text settings
TITLE_CARD_TITLE_FONT_SIZE: int = 58
TITLE_CARD_TITLE_COLOR: str = "white"
TITLE_CARD_TITLE_OUTLINE_WIDTH: int = 2

# Subtitle text settings
TITLE_CARD_SUBTITLE_FONT_SIZE: int = 28
TITLE_CARD_SUBTITLE_COLOR: str = "#C8DCFF"  # Light blue

# Font (PIL will fall back to default if not found)
TITLE_CARD_FONT: str = "Arial Bold"
TITLE_CARD_FONT_FALLBACK: str = "Helvetica"

# ===================================================================
# Narration Conductor
# ===================================================================

# Time to wait before narration starts in each scene (breathing room)
CONDUCTOR_DELAY_S: float = 0.5

# Minimum silence between scenes when stitched
CONDUCTOR_GAP_S: float = 0.3

# Fade-in duration on each TTS segment
CONDUCTOR_FADE_IN_S: float = 0.15

# Fade-out duration on each TTS segment
CONDUCTOR_FADE_OUT_S: float = 0.25

# Maximum speed-up factor when TTS exceeds available window
CONDUCTOR_MAX_SPEED: float = 1.15

# Skip narration for scene if available window is shorter than this
CONDUCTOR_MIN_WINDOW_S: float = 1.0


# ============================================================================
# Go Bananas Style Transfer
# ============================================================================

# Prompt template for style transfer via Go Bananas reference groups.
# Use with generate_image(image_to_edit_id=X, reference_group_id=Y,
# reference_mode="style"). Replace {group_name} with the actual group name.
STYLE_TRANSFER_PROMPT_TEMPLATE: str = (
    "Using the visual style from the reference images "
    '(reference group(s) "{group_name}"), style transfer. '
    "Match the artistic style, color palette, lighting, mood, "
    "and visual aesthetic from the references."
)

# Character Reference Sheet presets for Go Bananas
GO_BANANAS_CHAR_REF_SHEET_PRESET: int = 49   # 2x4 grid, 8 views
GO_BANANAS_CINEMATIC_REF_PRESET: int = 55    # Cinematic, 7 views

# Narration tone options for TTS script generation
NARRATION_TONES: dict = {
    "conversational": "Write as if talking to a friend over coffee. First person, casual, honest. No jargon. Use contractions. Short sentences.",
    "corporate": "Professional business presentation tone. Clear, structured, data-driven. Use industry terminology appropriately.",
    "storytelling": "Narrative voice. Set scenes, build tension, reveal insights. Use 'I remember when...' and 'Here's what nobody tells you...' patterns.",
    "casual": "Very informal. Use colloquialisms, humor, rhetorical questions. Like a podcast conversation.",
}
DEFAULT_NARRATION_TONE: str = "conversational"


# ============================================================================
# Genre Presets (cherry-picked from short-movie-maker)
# ============================================================================

GENRE_PRESETS: dict = {
    "drama": {
        "pacing": "slow to medium",
        "avg_shot_duration_s": 6,
        "scenes_per_minute": 2.5,
        "music_bpm": 80,
        "music_prompt_keywords": "orchestral underscore, solo piano, minimal",
        "color_grading_ffmpeg": "eq=contrast=1.05:brightness=0.01:saturation=0.85",
        "transition": "dissolve",
        "transition_duration_s": 0.8,
        "lighting_keywords": "natural, motivated, low-key for emotional scenes",
        "camera_keywords": "steady, deliberate movements, long takes",
    },
    "thriller": {
        "pacing": "builds from slow to fast",
        "avg_shot_duration_s": 4,
        "scenes_per_minute": 4,
        "music_bpm": 115,
        "music_prompt_keywords": "tense drones, staccato strings, building rhythm",
        "color_grading_ffmpeg": "eq=contrast=1.15:brightness=-0.02:saturation=0.75,colorbalance=rs=-0.1:bs=0.15",
        "transition": "fade",
        "transition_duration_s": 0.3,
        "lighting_keywords": "low-key, harsh shadows, motivated sources",
        "camera_keywords": "handheld for tension, steady for control",
    },
    "comedy": {
        "pacing": "quick, rhythmic",
        "avg_shot_duration_s": 4,
        "scenes_per_minute": 3.5,
        "music_bpm": 135,
        "music_prompt_keywords": "playful, upbeat, quirky instruments",
        "color_grading_ffmpeg": "eq=contrast=1.05:brightness=0.03:saturation=1.15",
        "transition": "wipeleft",
        "transition_duration_s": 0.3,
        "lighting_keywords": "high-key, even, bright",
        "camera_keywords": "static or simple pans, quick zooms for punchlines",
    },
    "sci-fi": {
        "pacing": "deliberate, with punctuated action",
        "avg_shot_duration_s": 5,
        "scenes_per_minute": 3,
        "music_bpm": 100,
        "music_prompt_keywords": "electronic, synth pads, atmospheric",
        "color_grading_ffmpeg": "eq=contrast=1.1:saturation=0.9,colorbalance=rs=-0.1:gs=-0.05:bs=0.2",
        "transition": "dissolve",
        "transition_duration_s": 0.5,
        "lighting_keywords": "practical neon, volumetric, rim lighting",
        "camera_keywords": "smooth tracking, crane shots, steady",
    },
    "horror": {
        "pacing": "slow builds with sudden bursts",
        "avg_shot_duration_s": 6,
        "scenes_per_minute": 2.5,
        "music_bpm": 70,
        "music_prompt_keywords": "dissonant drones, creeping tension, sudden stingers",
        "color_grading_ffmpeg": "eq=contrast=1.2:brightness=-0.05:saturation=0.6,colorbalance=gs=0.1",
        "transition": "fade",
        "transition_duration_s": 1.0,
        "lighting_keywords": "extreme low-key, single source, deep shadows",
        "camera_keywords": "slow tracking, occasional POV, dutch angles",
    },
    "romance": {
        "pacing": "gentle, flowing",
        "avg_shot_duration_s": 6,
        "scenes_per_minute": 2.5,
        "music_bpm": 80,
        "music_prompt_keywords": "gentle piano, acoustic guitar, soft strings",
        "color_grading_ffmpeg": "eq=contrast=0.95:brightness=0.03:saturation=1.05,colorbalance=rs=0.1:gs=0.05",
        "transition": "dissolve",
        "transition_duration_s": 1.0,
        "lighting_keywords": "golden hour, soft, diffused, backlit",
        "camera_keywords": "smooth dollies, slow pans, shallow DOF",
    },
    "action": {
        "pacing": "fast, relentless",
        "avg_shot_duration_s": 3,
        "scenes_per_minute": 5,
        "music_bpm": 145,
        "music_prompt_keywords": "driving percussion, heavy bass, adrenaline",
        "color_grading_ffmpeg": "eq=contrast=1.2:brightness=0.0:saturation=1.1,colorbalance=rs=0.15:bs=-0.1",
        "transition": "fade",
        "transition_duration_s": 0.2,
        "lighting_keywords": "dynamic, practical explosions, rim lighting",
        "camera_keywords": "handheld, fast tracking, dynamic angles",
    },
}

# Named color grade presets (usable independently of genre)
COLOR_GRADE_PRESETS: dict = {
    "nolan": "eq=contrast=1.15:brightness=-0.02:saturation=0.8,colorbalance=rs=-0.05:bs=0.15",
    "warm-cinematic": "eq=contrast=1.05:brightness=0.02:saturation=1.05,colorbalance=rs=0.1:gs=0.05",
    "noir": "eq=contrast=1.25:brightness=-0.05:saturation=0.4",
    "pastel": "eq=contrast=0.9:brightness=0.05:saturation=0.75",
}


# ============================================================================
# Reference Scenarios (elementsix integration)
# ============================================================================
# Maps scenario IDs to their Seedance 2.0 payload configuration.
# Source: elementsix-skills research (2026-02-27)
REFERENCE_SCENARIOS: dict[str, dict] = {
    "first_frame": {
        "description": "Use image as opening frame",
        "mode": "frames-to-video",
        "prompt_template": "@image1 {prompt}",
        "media_type": "image",
        "zh_equiv": "@图片1 作为首帧",
    },
    "character_ref": {
        "description": "Character reference for face/body consistency",
        "mode": "omni_reference",
        "prompt_template": "@image_file_{N} as character reference. {prompt}",
        "media_type": "image",
        "zh_equiv": "@图片1 角色参考",
    },
    "camera_clone": {
        "description": "Clone camera movement from reference video",
        "mode": "frames-to-video",
        "prompt_template": "{prompt} Fully reference @video1's camera movements.",
        "media_type": "video",
        "zh_equiv": "@视频1 运镜参考",
    },
    "video_extend": {
        "description": "Extend existing video by N seconds",
        "mode": "video-extend",
        "prompt_template": "Continue @video1 seamlessly. {prompt}",
        "media_type": "video",
        "zh_equiv": "延长视频",
    },
    "character_replace": {
        "description": "Replace character in video with new character from image",
        "mode": "character-replace",
        "prompt_template": "Replace main character in @video_file_1 with @image_file_1. {prompt}",
        "media_type": "image|video",
        "zh_equiv": "角色替换",
    },
    "audio_clone": {
        "description": "Use audio as BGM/rhythm reference",
        "mode": "omni_reference",
        "prompt_template": "Use @audio_file_1 as background music reference. {prompt}",
        "media_type": "audio",
        "zh_equiv": "声音参考",
    },
}

# ============================================================================
# Camera Vocabulary (bilingual Seedance-safe phrasing)
# ============================================================================
# Maps English camera terms → Chinese equivalent → Seedance-safe prompt phrase → emotional energy.
# Use these phrases in scene prompts for reliable Seedance camera move interpretation.
CAMERA_VOCABULARY: dict[str, dict[str, str]] = {
    "push_in":   {"zh": "推",     "seedance": "camera slowly pushes forward",              "energy": "approach"},
    "pull_back": {"zh": "拉",     "seedance": "camera pulls back to reveal",                "energy": "reveal"},
    "pan":       {"zh": "摇",     "seedance": "camera pans horizontally",                   "energy": "survey"},
    "tilt":      {"zh": "移",     "seedance": "camera tilts vertically",                    "energy": "discover"},
    "tracking":  {"zh": "跟",     "seedance": "tracking shot following subject",            "energy": "follow"},
    "orbit":     {"zh": "环绕",   "seedance": "camera orbits around subject",               "energy": "inspect"},
    "crane":     {"zh": "升降",   "seedance": "crane shot rising/descending",               "energy": "grandeur"},
    "hitchcock": {"zh": "希区柯克变焦", "seedance": "dolly zoom, background warps while subject stays fixed", "energy": "tension"},
}
