#!/usr/bin/env python3
"""
Platform-specific optimization for Seedance video generation.

Adjusts hook timing, pacing rules, aspect ratios, and prompt modifiers
for different social media platforms.

Usage:
    from seedance_platform_optimizer import optimize_for_platform, get_platform_config

    config = get_platform_config("tiktok")
    optimized_prompt = optimize_for_platform(prompt, "tiktok", duration=15)
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass
class PlatformConfig:
    """Configuration for a specific social media platform."""
    name: str
    display_name: str
    # Timing
    max_hook_seconds: float  # Maximum time before hook must land
    ideal_duration_range: tuple[int, int]  # Min, max seconds
    # Visual
    preferred_aspect_ratios: list[str]  # In order of preference
    default_aspect_ratio: str
    # Pacing
    min_cuts_per_15s: int  # Minimum number of shot changes per 15s
    max_static_seconds: float  # Max time without motion/cut before viewer drops
    # Audio
    music_required: bool
    captions_recommended: bool
    # Hook rules
    hook_rules: list[str]
    # Prompt modifiers
    prompt_prefix: str  # Added to start of every prompt
    prompt_suffix: str  # Added to end of every prompt
    # Content rules
    content_tips: list[str]


PLATFORMS: dict[str, PlatformConfig] = {
    "tiktok": PlatformConfig(
        name="tiktok",
        display_name="TikTok",
        max_hook_seconds=1.5,
        ideal_duration_range=(7, 60),
        preferred_aspect_ratios=["9:16", "1:1"],
        default_aspect_ratio="9:16",
        min_cuts_per_15s=5,
        max_static_seconds=2.0,
        music_required=True,
        captions_recommended=True,
        hook_rules=[
            "First 1.5 seconds must stop the scroll — extreme visual impact",
            "Start with motion, never a static frame",
            "Face or eyes in first frame boosts retention 40%",
            "Text overlay hook in first 2 seconds",
        ],
        prompt_prefix="Fast-paced, high energy, vertical framing optimized for mobile viewing.",
        prompt_suffix="Quick cuts, dynamic camera movement, never static. Vertical 9:16 composition.",
        content_tips=[
            "Trending audio increases reach 3x",
            "Loop-friendly endings boost replay",
            "Green screen effects trend well",
            "Duet-friendly framing (leave space on side)",
        ],
    ),
    "youtube": PlatformConfig(
        name="youtube",
        display_name="YouTube",
        max_hook_seconds=3.0,
        ideal_duration_range=(15, 600),
        preferred_aspect_ratios=["16:9"],
        default_aspect_ratio="16:9",
        min_cuts_per_15s=3,
        max_static_seconds=4.0,
        music_required=False,
        captions_recommended=True,
        hook_rules=[
            "First 3 seconds determine if viewer stays",
            "Thumbnail moment should appear within first 5 seconds",
            "Pattern interrupt in first 10 seconds",
            "Promise the value proposition early",
        ],
        prompt_prefix="Cinematic widescreen, high production value, YouTube-optimized.",
        prompt_suffix="Professional quality, 16:9 widescreen composition, engaging pacing.",
        content_tips=[
            "Chapters improve retention for longer videos",
            "End screen elements need clean last 20 seconds",
            "Cards work best in first 30% of video",
            "SEO title keywords should match visual content",
        ],
    ),
    "youtube-shorts": PlatformConfig(
        name="youtube-shorts",
        display_name="YouTube Shorts",
        max_hook_seconds=2.0,
        ideal_duration_range=(15, 60),
        preferred_aspect_ratios=["9:16"],
        default_aspect_ratio="9:16",
        min_cuts_per_15s=4,
        max_static_seconds=2.5,
        music_required=True,
        captions_recommended=True,
        hook_rules=[
            "2-second hook — even faster than TikTok due to swipe behavior",
            "Music-driven pacing matches trending sounds",
            "Bold text overlay for silent viewing",
            "Loop point — last frame should connect to first",
        ],
        prompt_prefix="Vertical format, punchy fast-paced, YouTube Shorts optimized.",
        prompt_suffix="Quick dynamic cuts, vertical 9:16, loop-friendly pacing.",
        content_tips=[
            "60 seconds max, 30-45s is sweet spot",
            "Trending audio from YouTube music library",
            "Subscribe CTA works in last 3 seconds",
        ],
    ),
    "instagram-reels": PlatformConfig(
        name="instagram-reels",
        display_name="Instagram Reels",
        max_hook_seconds=2.0,
        ideal_duration_range=(7, 90),
        preferred_aspect_ratios=["9:16", "4:5"],
        default_aspect_ratio="9:16",
        min_cuts_per_15s=4,
        max_static_seconds=2.5,
        music_required=True,
        captions_recommended=True,
        hook_rules=[
            "Visual-first platform — stunning imagery in first frame",
            "Aesthetic consistency with Instagram grid",
            "Smooth transitions between shots (no hard cuts)",
            "Color palette should match brand aesthetic",
        ],
        prompt_prefix="Aesthetically polished, Instagram-quality, vertical format.",
        prompt_suffix="Smooth transitions, beautiful color grading, 9:16 vertical composition.",
        content_tips=[
            "Cover frame optimization for grid",
            "Hashtag-friendly visual themes",
            "Collab-friendly split screen compositions",
            "Save-worthy educational or inspirational content",
        ],
    ),
    "linkedin": PlatformConfig(
        name="linkedin",
        display_name="LinkedIn",
        max_hook_seconds=3.0,
        ideal_duration_range=(15, 120),
        preferred_aspect_ratios=["16:9", "1:1"],
        default_aspect_ratio="1:1",
        min_cuts_per_15s=2,
        max_static_seconds=5.0,
        music_required=False,
        captions_recommended=True,
        hook_rules=[
            "Professional tone — no gimmicky hooks",
            "Data or insight lead-in works best",
            "Captions are essential (80% watch muted)",
            "Clear value proposition in first 3 seconds",
        ],
        prompt_prefix="Professional, clean, corporate-appropriate, high production value.",
        prompt_suffix="Clean composition, professional lighting, business-appropriate tone.",
        content_tips=[
            "Square 1:1 gets more feed real estate than 16:9",
            "Captions/subtitles are mandatory (muted autoplay)",
            "Thought leadership positioning",
            "Native video gets 5x more engagement than links",
        ],
    ),
    "twitter": PlatformConfig(
        name="twitter",
        display_name="X / Twitter",
        max_hook_seconds=2.0,
        ideal_duration_range=(6, 140),
        preferred_aspect_ratios=["16:9", "1:1"],
        default_aspect_ratio="16:9",
        min_cuts_per_15s=3,
        max_static_seconds=3.0,
        music_required=False,
        captions_recommended=True,
        hook_rules=[
            "Autoplay without sound — visual hook is everything",
            "Meme-friendly format works best",
            "Controversial or surprising opener",
            "Quote-tweet friendly (leave room for commentary)",
        ],
        prompt_prefix="Bold, attention-grabbing, optimized for timeline scroll.",
        prompt_suffix="High contrast, clear subject, works without audio.",
        content_tips=[
            "Under 2:20 for auto-loop",
            "GIF-like short loops perform well",
            "Text-heavy content gets more engagement",
            "Thread-friendly chapter structure",
        ],
    ),
}


def get_platform_config(platform: str) -> PlatformConfig | None:
    """Get configuration for a platform (case-insensitive, partial match)."""
    lower = platform.lower().replace(" ", "-")
    if lower in PLATFORMS:
        return PLATFORMS[lower]
    # Partial match
    for key, config in PLATFORMS.items():
        if lower in key or lower in config.display_name.lower():
            return config
    return None


def optimize_for_platform(
    prompt: str,
    platform: str,
    duration: int = 15,
) -> str:
    """Optimize a Seedance prompt for a specific platform.

    Adds platform-specific prefix/suffix and adjusts pacing cues.
    Returns the optimized prompt, or the original if platform is unknown.
    """
    config = get_platform_config(platform)
    if not config:
        return prompt

    parts = []
    if config.prompt_prefix:
        parts.append(config.prompt_prefix)
    parts.append(prompt.strip())
    if config.prompt_suffix:
        parts.append(config.prompt_suffix)

    return "\n".join(parts)


def get_platform_aspect_ratio(platform: str) -> str:
    """Get the default aspect ratio for a platform."""
    config = get_platform_config(platform)
    return config.default_aspect_ratio if config else "16:9"


def validate_for_platform(
    prompt: str,
    platform: str,
    duration: int,
) -> list[str]:
    """Validate a video spec against platform requirements. Returns list of warnings."""
    config = get_platform_config(platform)
    if not config:
        return []

    warnings = []
    min_dur, max_dur = config.ideal_duration_range
    if duration < min_dur:
        warnings.append(f"{config.display_name}: video ({duration}s) is shorter than ideal ({min_dur}-{max_dur}s)")
    if duration > max_dur:
        warnings.append(f"{config.display_name}: video ({duration}s) exceeds ideal length ({min_dur}-{max_dur}s)")

    return warnings


def list_platforms() -> list[str]:
    """Return all supported platform names."""
    return list(PLATFORMS.keys())
