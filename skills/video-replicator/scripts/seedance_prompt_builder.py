#!/usr/bin/env python3
"""
Seedance 2.0 Cinematic Prompt Engine.

Transforms basic scene descriptions into optimized Seedance prompts
with cinematic camera vocabulary, time-segmented storyboarding, style
tokens, and negative prompts.  Dramatically improves output quality
without users needing to know Seedance prompt tricks.

v2.36: DB-powered prompt expansion — auto-detects genre, finds matching
templates from the Seedance Prompt Library (63 curated ByteDance prompts),
and enriches simple descriptions with proven camera, audio, and color
patterns.

Usage:
    from seedance_prompt_builder import (
        build_cinematic_prompt,
        build_enhanced_prompt,
        format_seedance_prompt,
        get_camera_fragment,
        list_camera_movements,
        list_genres,
        list_prompt_styles,
    )

    # Basic enhancement (v2.35 — camera + style + negatives)
    enhanced = build_cinematic_prompt(
        description="Villa exterior at golden hour",
        camera="push_in",
        duration=8,
        genre="cinematic",
    )

    # DB-powered enhancement (v2.36 — auto-detects genre, uses templates)
    enhanced = build_enhanced_prompt(
        description="Two warriors clash in temple",
        duration=15,
        prompt_style="fight",  # or auto-detect if None
    )

    # Build a complete Seedance-ready prompt with media references
    sp = format_seedance_prompt(
        base_prompt=enhanced,
        mode="frames-to-video",
        image_url="https://cdn.example.com/villa.jpg",
    )
    print(sp.prompt, sp.media_files)
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from config import (
    SEEDANCE_DEFAULT_DURATION,
    SEEDANCE_MAX_AUDIO,
    SEEDANCE_MAX_IMAGES,
    SEEDANCE_MAX_MEDIA_TOTAL,
    SEEDANCE_MAX_VIDEOS,
    SEEDANCE_NEGATIVE_PROMPTS,
    SEEDANCE_TIME_SEGMENT_THRESHOLD,
)

# ============================================================================
# Camera Vocabulary
# ============================================================================

CAMERA_VOCABULARY: dict[str, dict[str, str]] = {
    # Movement — enhanced with speed, path, and mechanical precision
    # for Seedance 2.0's motion reproduction engine.
    "push_in": {
        "fragment": "Camera pushes in steadily on dolly rails, gradually closing distance",
        "category": "movement",
    },
    "pull_back": {
        "fragment": "Camera pulls back on smooth dolly track revealing the wider scene",
        "category": "movement",
    },
    "dolly_forward": {
        "fragment": "Smooth dolly glides forward through the space at steady walking pace",
        "category": "movement",
    },
    "dolly_backward": {
        "fragment": "Smooth dolly retreats backward from the subject, opening up the frame",
        "category": "movement",
    },
    "tracking_left": {
        "fragment": "Camera tracks laterally left on rails, paralleling the subject",
        "category": "movement",
    },
    "tracking_right": {
        "fragment": "Camera tracks laterally right on rails, paralleling the subject",
        "category": "movement",
    },
    "crane_up": {
        "fragment": "Camera cranes upward on jib arm, sweeping from ground to elevated reveal",
        "category": "movement",
    },
    "crane_down": {
        "fragment": "Camera descends on crane jib from elevated position toward the subject",
        "category": "movement",
    },
    "pedestal_up": {
        "fragment": "Camera rises vertically on column, maintaining locked framing",
        "category": "movement",
    },
    "pedestal_down": {
        "fragment": "Camera lowers vertically on column, maintaining locked framing",
        "category": "movement",
    },
    "arc_left": {
        "fragment": "Camera arcs in a curved path around the subject to the left",
        "category": "movement",
    },
    "arc_right": {
        "fragment": "Camera arcs in a curved path around the subject to the right",
        "category": "movement",
    },
    "orbit": {
        "fragment": "Camera orbits in a full circular path around the subject at steady pace",
        "category": "movement",
    },
    "fly_through": {
        "fragment": "Camera flies through the environment in a continuous forward glide",
        "category": "movement",
    },
    "aerial_descend": {
        "fragment": "Drone-style camera descends from high aerial toward ground level",
        "category": "movement",
    },
    "aerial_ascend": {
        "fragment": "Drone-style camera ascends from ground level into wide aerial view",
        "category": "movement",
    },
    # Angle
    "low_angle": {
        "fragment": "Low angle looking upward at the subject, emphasizing power and scale",
        "category": "angle",
    },
    "high_angle": {
        "fragment": "High angle looking down on the subject, conveying vulnerability",
        "category": "angle",
    },
    "birds_eye": {
        "fragment": "Top-down bird's eye view directly overhead",
        "category": "angle",
    },
    "dutch_angle": {
        "fragment": "Tilted Dutch angle creating visual unease and dramatic tension",
        "category": "angle",
    },
    "eye_level": {
        "fragment": "Eye-level neutral perspective at subject height",
        "category": "angle",
    },
    "worms_eye": {
        "fragment": "Extreme low angle from ground level looking up at towering subject",
        "category": "angle",
    },
    # Technique — enhanced with mechanical specificity
    "hitchcock_zoom": {
        "fragment": "Dolly zoom — camera pulls back while lens zooms in, warping perspective",
        "category": "technique",
    },
    "rack_focus": {
        "fragment": "Rack focus pulls depth of field from foreground to background subject",
        "category": "technique",
    },
    "whip_pan": {
        "fragment": "Rapid whip pan with motion blur snapping to a new point of interest",
        "category": "technique",
    },
    "one_take": {
        "fragment": "Continuous single-take gimbal-stabilized movement without cuts",
        "category": "technique",
    },
    "steadicam": {
        "fragment": "Smooth steadicam follow shot gliding behind or alongside the subject",
        "category": "technique",
    },
    "handheld": {
        "fragment": "Raw handheld with subtle organic shake for documentary immediacy",
        "category": "technique",
    },
    "slow_zoom_in": {
        "fragment": "Agonizingly slow zoom drawing in toward the subject over full duration",
        "category": "technique",
    },
    "slow_zoom_out": {
        "fragment": "Slow pullback zoom gradually revealing the full surroundings",
        "category": "technique",
    },
    # Shot size
    "extreme_closeup": {
        "fragment": "Extreme close-up filling the frame with fine texture and detail",
        "category": "shot_size",
    },
    "closeup": {
        "fragment": "Tight close-up isolating the subject's key features",
        "category": "shot_size",
    },
    "medium": {
        "fragment": "Medium shot framing the subject from waist up in context",
        "category": "shot_size",
    },
    "wide": {
        "fragment": "Wide shot capturing the full scene with environmental context",
        "category": "shot_size",
    },
    "establishing": {
        "fragment": "Wide establishing shot setting the location and atmospheric tone",
        "category": "shot_size",
    },
    "extreme_wide": {
        "fragment": "Extreme wide shot for sweeping landscape or epic environmental scale",
        "category": "shot_size",
    },
}

# ============================================================================
# Style Tokens by Genre
# ============================================================================

STYLE_TOKENS: dict[str, list[str]] = {
    "cinematic": [
        "cinematic quality",
        "shallow depth of field",
        "film grain",
        "anamorphic widescreen",
        "24fps filmic motion",
    ],
    "commercial": [
        "polished commercial look",
        "bright even lighting",
        "product-focused composition",
        "clean professional framing",
    ],
    "documentary": [
        "documentary style",
        "natural lighting",
        "observational camera",
        "authentic unscripted feel",
    ],
    "dramatic": [
        "dramatic lighting",
        "high contrast",
        "volumetric light rays",
        "intense atmospheric mood",
    ],
    "luxury": [
        "luxury editorial aesthetic",
        "golden hour warmth",
        "premium visual feel",
        "Vogue-inspired composition",
    ],
    "action": [
        "dynamic energy",
        "fast-paced movement",
        "motion blur accents",
        "high contrast dramatic look",
    ],
    "nature": [
        "natural beauty",
        "organic color palette",
        "ambient environmental sound",
        "golden or blue hour light",
    ],
    "horror": [
        "unsettling atmosphere",
        "desaturated cold tones",
        "deep shadows",
        "suspenseful tension",
    ],
    "romantic": [
        "soft warm glow",
        "dreamy bokeh",
        "pastel tones",
        "gentle ambient light",
    ],
    "sci_fi": [
        "futuristic neon aesthetic",
        "cyberpunk lighting",
        "sleek metallic surfaces",
        "atmospheric haze",
    ],
    # New genres from Seedance Prompt Library (v2.36)
    "fight": [
        "intense combat energy",
        "high contrast dramatic lighting",
        "motion blur on impacts",
        "dynamic fast-paced action",
    ],
    "xianxia": [
        "Chinese fantasy epic style",
        "golden ethereal glow",
        "energy runes and magic circles",
        "ultra-fine CG animation quality",
    ],
    "ecommerce": [
        "polished product showcase",
        "bright commercial lighting",
        "clean studio aesthetic",
        "professional product photography",
    ],
    "food": [
        "appetizing warm tones",
        "macro detail texture",
        "golden hour food styling",
        "crisp satisfying visuals",
    ],
    "popscience": [
        "ultra-realistic 4K medical CGI",
        "translucent blue visualization",
        "clinical educational tone",
        "smooth anatomical transitions",
    ],
    "kpop": [
        "neon high-saturation vibrant colors",
        "modern stage lighting",
        "sharp energetic movement",
        "hard-cut fast-paced editing feel",
    ],
    "fantasy": [
        "rich saturated magical colors",
        "ethereal glow effects",
        "epic dramatic scale",
        "mystical atmospheric haze",
    ],
    "drama": [
        "intimate emotional lighting",
        "natural skin tones",
        "shallow depth of field bokeh",
        "Rembrandt lighting on faces",
    ],
    # Extended genres (v2.36+) — previously fell back to generic cinematic tokens
    "bollywood": [
        "vibrant saturated colors",
        "sweeping camera movements",
        "Bollywood grandeur",
        "dramatic emotional intensity",
    ],
    "cyberpunk": [
        "neon-reflective wet surfaces",
        "holographic UI overlays",
        "Blade Runner atmosphere",
        "chrome and neon contrast",
    ],
    "music_video": [
        "beat-synchronized visuals",
        "concert stage energy",
        "dramatic spotlight beams",
        "high-contrast performer lighting",
    ],
    "superhero": [
        "VFX blockbuster quality",
        "power-glow energy effects",
        "heroic dramatic composition",
        "dynamic cape and fabric physics",
    ],
    "noir": [
        "high contrast black and white tones",
        "venetian blind shadow patterns",
        "smoky atmospheric depth",
        "classic film noir cinematography",
    ],
    "underwater": [
        "crystal-clear aquatic depth",
        "bioluminescent glow effects",
        "caustic light ray patterns",
        "weightless fluid motion",
    ],
    "fairy_tale": [
        "magical storybook luminosity",
        "enchanted particle sparkle",
        "soft dreamy diffusion",
        "fairy-tale color saturation",
    ],
    "dance": [
        "dynamic body-motion clarity",
        "stage lighting with colored gels",
        "rhythmic visual cadence",
        "athletic performance precision",
    ],
    "travel": [
        "golden hour travel photography",
        "National Geographic beauty",
        "atmospheric depth and scale",
        "warm wanderlust tones",
    ],
    "fashion": [
        "editorial photography aesthetic",
        "luxurious texture rendering",
        "elegant model composition",
        "beauty key lighting",
    ],
    "vfx": [
        "seamless particle compositing",
        "clean energy rendering",
        "smooth morphing transitions",
        "dynamic visual spectacle",
    ],
    "sports": [
        "high-framerate athletic clarity",
        "stadium dramatic lighting",
        "peak-action freeze quality",
        "vivid broadcast HDR",
    ],
    "anime": [
        "cel-shaded animation style",
        "vivid color blocks and bold outlines",
        "manga-inspired dramatic framing",
        "anime speed lines and impact frames",
    ],
    "romance": [
        "soft warm golden glow",
        "dreamy romantic bokeh",
        "intimate shallow depth of field",
        "tender pastel warmth",
    ],
    "thriller": [
        "cold desaturated tension",
        "sharp shadow edges",
        "claustrophobic tight framing",
        "high contrast unease",
    ],
    "comedy": [
        "bright cheerful lighting",
        "vivid warm color palette",
        "clean sharp detail",
        "comedic timing emphasis",
    ],
    "historical": [
        "rich period-accurate detail",
        "warm candlelight texture",
        "museum-quality production value",
        "epic historical grandeur",
    ],
    "western": [
        "sun-bleached frontier tones",
        "Sergio Leone grandeur",
        "dust-filtered golden light",
        "wide frontier landscape framing",
    ],
    "war": [
        "visceral handheld realism",
        "gritty battle grain texture",
        "smoke-filtered atmosphere",
        "Saving Private Ryan intensity",
    ],
}

DEFAULT_GENRE = "cinematic"

# ============================================================================
# Subtle Slide Prompts (for f2v_loop mode)
# ============================================================================

SUBTLE_SLIDE_PROMPTS: list[str] = [
    "Gentle ambient light shift",
    "Subtle color temperature change",
    "Soft parallax drift",
    "Minimal atmospheric motion",
    "Delicate light variation",
]

# ============================================================================
# Negative Prompts
# ============================================================================

# Standard negative prompts (always appended)
DEFAULT_NEGATIVE = "No text, no subtitles, no watermarks, no logos, no abrupt cuts"

# Genre-specific extra negatives
GENRE_NEGATIVES: dict[str, str] = {
    "documentary": "no special effects, no CGI, no dramatic reenactment",
    "nature": "no domesticated animals, no human interference, no artificial environments",
    "horror": "no bright happy colors, no comedic elements",
    "romance": "no harsh lighting, no aggressive movements, no cold clinical colors",
    "commercial": "no shaky camera, no grainy footage",
    "fight": "no blurry impacts, no frozen poses, no slow static camera",
    "xianxia": "no modern objects, no western architecture, no flat lighting",
    "ecommerce": "no distracting backgrounds, no shadows on product, no cluttered frame",
    "food": "no unappetizing colors, no cold clinical lighting, no blurry texture",
    "popscience": "no cartoon style, no fantasy elements, no hand-drawn look",
    "kpop": "no dull lighting, no static camera, no muted desaturated colors",
    "fantasy": "no modern technology, no mundane settings, no flat daylight",
    "action": "no static poses, no slow pacing, no gentle lighting",
    "drama": "no comedic timing, no exaggerated expressions, no bright neon colors",
    "cinematic": "no handheld shake, no harsh direct flash, no flat composition",
    "bollywood": "no dull muted colors, no static camera, no western modern clothing",
    "sci_fi": "no medieval settings, no natural sunlight, no organic textures without tech",
    "sports": "no static poses, no empty stadium, no blurry motion",
    "anime": "no photorealistic style, no dull muted colors, no flat lighting without drama",
    "thriller": "no bright cheerful colors, no comedic timing, no wide open sunny spaces",
    "war": "no bright cheerful colors, no clean pristine settings, no comedic elements",
    "comedy": "no dark moody lighting, no horror elements, no dramatic tension",
    "historical": "no modern objects, no contemporary clothing, no anachronistic technology",
    "western": "no modern vehicles, no contemporary buildings, no urban city elements",
    "cyberpunk": "no natural sunlight, no rural settings, no organic warmth",
    "music_video": "no static poses, no silence, no empty venues",
    "superhero": "no mundane settings, no ordinary clothing, no low-energy static poses",
    "noir": "no bright cheerful colors, no sunlit outdoor scenes, no modern technology",
    "underwater": "no dry land visible, no above-water sky, no terrestrial animals",
    "fairy_tale": "no modern technology, no dark gritty realism, no contemporary urban settings",
    "dance": "no static poses, no sitting, no slow pacing",
    "travel": "no indoor studio settings, no cluttered frames, no artificial environments",
    "fashion": "no casual messy settings, no harsh unflattering light, no cluttered backgrounds",
    "vfx": "no static frames, no live-action realism, no text or UI overlays",
}

# ============================================================================
# Edit / Extension Prompt Templates
# ============================================================================

EDIT_TEMPLATES: dict[str, str] = {
    "color_change": (
        "@video1 Change {target} color to {replacement}. "
        "Preserve all motion, camera angles, lighting, and scene composition. "
        "Only modify the specified color — everything else remains identical."
    ),
    "object_swap": (
        "@video1 Replace {target} with {replacement}. "
        "Maintain original motion paths, camera movement, and scene timing. "
        "The replacement should naturally fit the existing scene context."
    ),
    "style_transfer": (
        "@video1 Transform visual style to {replacement}. "
        "Keep all subject motion, camera work, and scene structure identical. "
        "Only the artistic rendering style changes — content stays the same."
    ),
    "lighting_change": (
        "@video1 Change lighting from {target} to {replacement}. "
        "Preserve subject motion, camera movement, and scene layout. "
        "Adjust shadows and reflections to match the new lighting naturally."
    ),
    "weather_change": (
        "@video1 Change weather from {target} to {replacement}. "
        "Keep subject actions and camera movement intact. "
        "Add appropriate atmospheric effects for the new weather condition."
    ),
    "add_effect": (
        "@video1 Add {replacement} effect to the scene. "
        "Preserve all existing motion, subjects, and camera work. "
        "The effect should blend naturally with the existing footage."
    ),
    "remove_element": (
        "@video1 Remove {target} from the scene. "
        "Fill the removed area naturally with surrounding context. "
        "Maintain all camera motion and remaining subject movement."
    ),
    "general": (
        "@video1 {edit_description}. "
        "Preserve original camera movement and scene timing where possible."
    ),
}

EXTENSION_TEMPLATES: dict[str, str] = {
    "forward": (
        "@video1 Continue seamlessly from the final frame. "
        "Maintain exact visual style, color grading, and camera motion. "
        "{continuation_description}"
    ),
    "backward": (
        "@video1 Generate a prequel leading into the first frame. "
        "Match visual style, color grading, and camera motion exactly. "
        "{continuation_description}"
    ),
}


def build_edit_prompt(
    edit_description: str,
    edit_type: str = "general",
    target: str = "",
    replacement: str = "",
    genre: str | None = None,
) -> str:
    """Build an optimized edit prompt from a template.

    Args:
        edit_description: Raw edit description from user
        edit_type: Edit template key (color_change, object_swap, etc.)
        target: What to change (e.g. "blue shirt", "daytime")
        replacement: What to change it to (e.g. "red", "nighttime")
        genre: Optional genre for negative prompts

    Returns:
        Formatted edit prompt string
    """
    template = EDIT_TEMPLATES.get(edit_type, EDIT_TEMPLATES["general"])

    # Use general formatting when type is "general" or when falling back to general
    if edit_type == "general" or edit_type not in EDIT_TEMPLATES:
        prompt = template.format(edit_description=edit_description)
    else:
        prompt = template.format(
            target=target or "the specified element",
            replacement=replacement or edit_description,
        )

    # Append negative prompts if genre provided
    if genre:
        prompt = append_negative_prompts(prompt, genre)
    else:
        prompt = append_negative_prompts(prompt)

    return prompt


def build_extension_prompt(
    continuation_description: str,
    duration: int = SEEDANCE_DEFAULT_DURATION,
    genre: str | None = None,
    direction: str = "forward",
) -> str:
    """Build an optimized extension prompt from a template.

    Args:
        continuation_description: What should happen in the extension
        duration: Extension duration in seconds
        genre: Optional genre for style tokens and negatives
        direction: "forward" (continue) or "backward" (prequel)

    Returns:
        Formatted extension prompt string
    """
    template = EXTENSION_TEMPLATES.get(direction, EXTENSION_TEMPLATES["forward"])

    # Build the continuation description with optional time segments
    desc = continuation_description.rstrip(".")
    if duration >= SEEDANCE_TIME_SEGMENT_THRESHOLD:
        desc = build_time_segments(desc, duration)

    prompt = template.format(continuation_description=desc + ".")

    # Apply style tokens if genre provided
    if genre:
        style_genre = genre if genre in STYLE_TOKENS else DEFAULT_GENRE
        prompt = enhance_with_style(prompt, style_genre)

    # Append negatives
    prompt = append_negative_prompts(prompt, genre if genre and genre in GENRE_NEGATIVES else None)

    return prompt


# ============================================================================
# Beat-Sync Prompt Builder
# ============================================================================

BEAT_PATTERNS: dict[str, dict] = {
    "fight": {
        "beats_per_segment": 2,
        "segment_style": "hard cut",
        "camera_cycle": ["whip_pan", "low_angle", "tracking_right", "dutch_angle", "handheld"],
        "action_verbs": ["strikes", "blocks", "dodges", "charges", "leaps", "clashes", "parries", "slams"],
    },
    "romantic": {
        "beats_per_segment": 4,
        "segment_style": "slow dissolve",
        "camera_cycle": ["slow_zoom_in", "arc_left", "steadicam", "rack_focus"],
        "action_verbs": ["gazes", "reaches", "embraces", "turns", "whispers", "touches"],
    },
    "kpop": {
        "beats_per_segment": 2,
        "segment_style": "choreography synced",
        "camera_cycle": ["whip_pan", "low_angle", "tracking_left", "crane_up", "dutch_angle"],
        "action_verbs": ["poses", "spins", "drops", "hits", "snaps", "kicks", "slides"],
    },
    "cinematic": {
        "beats_per_segment": 4,
        "segment_style": "smooth transition",
        "camera_cycle": ["push_in", "crane_up", "pull_back", "orbit", "steadicam"],
        "action_verbs": ["reveals", "discovers", "approaches", "surveys", "emerges"],
    },
    "action": {
        "beats_per_segment": 2,
        "segment_style": "fast cut",
        "camera_cycle": ["handheld", "whip_pan", "tracking_right", "low_angle", "aerial_descend"],
        "action_verbs": ["runs", "crashes", "explodes", "chases", "jumps", "slides", "fires"],
    },
    "drama": {
        "beats_per_segment": 4,
        "segment_style": "slow fade",
        "camera_cycle": ["slow_zoom_in", "push_in", "rack_focus", "steadicam"],
        "action_verbs": ["contemplates", "turns away", "faces", "confronts", "reveals"],
    },
    "documentary": {
        "beats_per_segment": 4,
        "segment_style": "natural transition",
        "camera_cycle": ["steadicam", "handheld", "slow_zoom_in", "tracking_left"],
        "action_verbs": ["observes", "explores", "discovers", "examines", "follows"],
    },
    "horror": {
        "beats_per_segment": 4,
        "segment_style": "tension build",
        "camera_cycle": ["slow_zoom_in", "dutch_angle", "handheld", "rack_focus", "push_in"],
        "action_verbs": ["creeps", "lurks", "reveals", "shatters", "emerges", "freezes"],
    },
    "ecommerce": {
        "beats_per_segment": 2,
        "segment_style": "clean cut",
        "camera_cycle": ["orbit", "push_in", "slow_zoom_in", "rack_focus"],
        "action_verbs": ["showcases", "reveals", "highlights", "presents", "transforms"],
    },
}


def calculate_beat_grid(bpm: int, duration: int) -> list[float]:
    """Calculate beat timestamps for a given BPM and duration.

    Args:
        bpm: Beats per minute (e.g. 120)
        duration: Clip duration in seconds

    Returns:
        List of beat timestamps in seconds (e.g. [0.0, 0.5, 1.0, ...])
    """
    if bpm <= 0:
        return [0.0]
    beat_interval = 60.0 / bpm
    beats = []
    t = 0.0
    while t < duration:
        beats.append(round(t, 2))
        t += beat_interval
    return beats


def beats_to_segments(
    beats: list[float],
    beats_per_segment: int,
    duration: int,
) -> list[tuple[float, float]]:
    """Group beats into time segments.

    Args:
        beats: List of beat timestamps
        beats_per_segment: Number of beats per segment (2 = fast, 4 = slow)
        duration: Total clip duration in seconds

    Returns:
        List of (start, end) tuples in seconds
    """
    if not beats:
        return [(0, duration)]

    segments = []
    for i in range(0, len(beats), beats_per_segment):
        start = beats[i]
        # End is the beat after this segment, or the duration
        end_idx = i + beats_per_segment
        end = beats[end_idx] if end_idx < len(beats) else duration
        segments.append((round(start, 1), round(end, 1)))

    # Ensure last segment extends to full duration
    if segments and segments[-1][1] < duration:
        segments[-1] = (segments[-1][0], float(duration))

    return segments


def build_beat_synced_prompt(
    description: str,
    bpm: int,
    duration: int = SEEDANCE_DEFAULT_DURATION,
    genre: str = DEFAULT_GENRE,
    beat_pattern: str | None = None,
) -> str:
    """Build a time-segmented prompt with actions landing on beat boundaries.

    Cycles through camera movements and action verbs per segment,
    synchronized to the beat grid.

    Args:
        description: Base scene description
        bpm: Beats per minute of the music track
        duration: Clip duration in seconds
        genre: Style genre for tokens and negatives
        beat_pattern: Override beat pattern key (defaults to genre)

    Returns:
        Beat-synced time-segmented prompt string
    """
    pattern_key = beat_pattern or genre
    pattern = BEAT_PATTERNS.get(pattern_key, BEAT_PATTERNS.get("cinematic"))

    beats = calculate_beat_grid(bpm, duration)
    segments = beats_to_segments(beats, pattern["beats_per_segment"], duration)

    cameras = pattern["camera_cycle"]
    verbs = pattern["action_verbs"]

    parts = []
    for i, (start, end) in enumerate(segments):
        cam_key = cameras[i % len(cameras)]
        cam_frag = get_camera_fragment(cam_key)
        verb = verbs[i % len(verbs)]

        start_int = int(start)
        end_int = int(end)
        segment_text = f"{start_int}-{end_int}s: {cam_frag}, subject {verb}"

        # First segment includes the description
        if i == 0:
            segment_text = f"{start_int}-{end_int}s: {cam_frag}. {description.rstrip('.')}. Subject {verb}"

        parts.append(segment_text)

    prompt = " ".join(parts)
    prompt += f". [{pattern['segment_style']} rhythm at {bpm} BPM]"

    # Apply style tokens
    style_genre = genre if genre in STYLE_TOKENS else DEFAULT_GENRE
    prompt = enhance_with_style(prompt, style_genre)

    # Apply negatives
    prompt = append_negative_prompts(prompt, genre if genre in GENRE_NEGATIVES else None)

    return prompt


# ============================================================================
# Shot Types (for reference / future use)
# ============================================================================

SHOT_TYPES: dict[str, str] = {
    "extreme_closeup": "Filling frame with fine detail (eyes, texture, small object)",
    "closeup": "Head and shoulders, or single small object",
    "medium_closeup": "Chest up, tighter framing",
    "medium": "Waist up, balanced framing",
    "medium_wide": "Knees up, environmental context",
    "wide": "Full body or full scene, establishes spatial relationships",
    "extreme_wide": "Vast landscape, epic scale, tiny subject in frame",
    "establishing": "Location-setting shot, typically wide or aerial",
}


# ============================================================================
# Media Roles (v2.37) — structured role assignment for multimodal prompts
# ============================================================================

MEDIA_ROLES: dict[str, str] = {
    "start_frame": "@image1",
    "end_frame": "@image2",
    "character_ref": "@image3-5",
    "scene_ref": "@image6-9",
    "camera_ref": "@video1",
    "action_ref": "@video2",
    "bgm_ref": "@audio1",
    "dialogue_ref": "@audio2",
}


# ============================================================================
# Atmosphere Banks (v2.37) — from seedance2-api reference
# ============================================================================

ATMOSPHERE_BANKS: dict[str, list[str]] = {
    "lighting": [
        "backlight", "side light", "Rembrandt light", "silhouette",
        "rim light", "volumetric light", "Tyndall effect",
    ],
    "color_tone": [
        "warm tones", "cool tones", "cyberpunk", "vintage film",
        "high saturation", "black and white",
    ],
    "texture": [
        "cinematic", "documentary", "commercial", "MV style",
        "oil painting", "ink wash",
    ],
    "mood": [
        "tense", "suspenseful", "cheerful", "melancholic",
        "epic", "healing", "horror",
    ],
}

# Genre → atmosphere auto-selection mapping
_GENRE_ATMOSPHERE: dict[str, dict[str, str]] = {
    "cinematic": {"lighting": "volumetric light", "color_tone": "warm tones", "texture": "cinematic", "mood": "epic"},
    "documentary": {"lighting": "side light", "color_tone": "warm tones", "texture": "documentary", "mood": "cheerful"},
    "horror": {"lighting": "silhouette", "color_tone": "cool tones", "texture": "cinematic", "mood": "horror"},
    "romantic": {"lighting": "backlight", "color_tone": "warm tones", "texture": "cinematic", "mood": "healing"},
    "action": {"lighting": "rim light", "color_tone": "high saturation", "texture": "cinematic", "mood": "tense"},
    "drama": {"lighting": "Rembrandt light", "color_tone": "warm tones", "texture": "cinematic", "mood": "melancholic"},
    "sci_fi": {"lighting": "rim light", "color_tone": "cyberpunk", "texture": "cinematic", "mood": "suspenseful"},
    "fight": {"lighting": "rim light", "color_tone": "high saturation", "texture": "cinematic", "mood": "tense"},
    "xianxia": {"lighting": "volumetric light", "color_tone": "high saturation", "texture": "ink wash", "mood": "epic"},
    "ecommerce": {"lighting": "side light", "color_tone": "warm tones", "texture": "commercial", "mood": "cheerful"},
    "food": {"lighting": "backlight", "color_tone": "warm tones", "texture": "commercial", "mood": "cheerful"},
    "kpop": {"lighting": "rim light", "color_tone": "high saturation", "texture": "MV style", "mood": "cheerful"},
    "noir": {"lighting": "silhouette", "color_tone": "black and white", "texture": "cinematic", "mood": "suspenseful"},
    "fantasy": {"lighting": "Tyndall effect", "color_tone": "high saturation", "texture": "cinematic", "mood": "epic"},
    "nature": {"lighting": "backlight", "color_tone": "warm tones", "texture": "documentary", "mood": "healing"},
    "luxury": {"lighting": "backlight", "color_tone": "warm tones", "texture": "commercial", "mood": "healing"},
    "commercial": {"lighting": "side light", "color_tone": "warm tones", "texture": "commercial", "mood": "cheerful"},
    "dramatic": {"lighting": "Rembrandt light", "color_tone": "cool tones", "texture": "cinematic", "mood": "tense"},
}


# ============================================================================
# Chinese Camera Map (v2.37) — bilingual camera vocabulary
# ============================================================================

CHINESE_CAMERA_MAP: dict[str, str] = {
    "push_in": "推镜头",
    "pull_back": "拉镜头",
    "pan": "摇镜头",
    "dolly": "移镜头",
    "follow": "跟镜头",
    "orbit": "环绕镜头",
    "crane": "升降镜头",
    "hitchcock_zoom": "希区柯克变焦",
    "handheld": "手持晃动",
    "one_take": "一镜到底",
}


# ============================================================================
# SeedancePrompt Dataclass
# ============================================================================

@dataclass
class SeedancePrompt:
    """A fully-formed Seedance prompt ready for _create_task()."""

    prompt: str
    media_files: list[str] = field(default_factory=list)
    duration: int = SEEDANCE_DEFAULT_DURATION
    aspect_ratio: str = "16:9"
    mode: str = "text-to-video"
    scene_number: int | None = None


# ============================================================================
# Builder Functions
# ============================================================================

def get_camera_fragment(camera_name: str) -> str:
    """Look up a camera movement and return its descriptive fragment.

    Args:
        camera_name: Key from CAMERA_VOCABULARY (e.g. "push_in", "orbit")

    Returns:
        Descriptive fragment string, or empty string if not found.
    """
    entry = CAMERA_VOCABULARY.get(camera_name)
    if entry:
        return entry["fragment"]
    return ""


def list_camera_movements() -> list[str]:
    """Return sorted list of all available camera movement keys."""
    return sorted(CAMERA_VOCABULARY.keys())


def list_genres() -> list[str]:
    """Return sorted list of all available genre keys."""
    return sorted(STYLE_TOKENS.keys())


def build_time_segments(description: str, duration: int) -> str:
    """Break a description into time-segmented storyboard segments.

    For clips below SEEDANCE_TIME_SEGMENT_THRESHOLD (default 8s),
    returns the description unchanged.

    Args:
        description: Scene description text
        duration: Clip duration in seconds

    Returns:
        Time-segmented prompt string or original description
    """
    if duration < SEEDANCE_TIME_SEGMENT_THRESHOLD:
        return description

    # Split description into sentences for distribution across segments
    # Use simple splitting on '. ' and ', ' boundaries
    parts = [s.strip() for s in description.replace(". ", ".|").replace(", ", ",|").split("|") if s.strip()]

    if duration <= 8:
        # 2 segments: 0-4s, 5-8s
        mid = max(1, len(parts) // 2)
        seg1 = " ".join(parts[:mid])
        seg2 = " ".join(parts[mid:]) if parts[mid:] else seg1
        return f"0-4s: {seg1} 5-{duration}s: {seg2}"

    if duration <= 12:
        # 3 segments
        third = max(1, len(parts) // 3)
        seg1 = " ".join(parts[:third])
        seg2 = " ".join(parts[third:2 * third]) or seg1
        seg3 = " ".join(parts[2 * third:]) or seg2
        return f"0-3s: {seg1} 4-8s: {seg2} 9-{duration}s: {seg3}"

    # 4 segments (13-15s)
    quarter = max(1, len(parts) // 4)
    seg1 = " ".join(parts[:quarter])
    seg2 = " ".join(parts[quarter:2 * quarter]) or seg1
    seg3 = " ".join(parts[2 * quarter:3 * quarter]) or seg2
    seg4 = " ".join(parts[3 * quarter:]) or seg3
    return f"0-3s: {seg1} 4-8s: {seg2} 9-12s: {seg3} 13-{duration}s: {seg4}"


def enhance_with_style(prompt: str, genre: str) -> str:
    """Append genre-appropriate style tokens to a prompt.

    Deduplicates tokens already present in the prompt body (case-insensitive
    substring match) to avoid bloating the prompt with redundant phrases like
    "motion blur on impacts" appearing twice.

    Args:
        prompt: Base prompt text
        genre: Genre key (e.g. "cinematic", "documentary")

    Returns:
        Prompt with non-redundant style tokens appended
    """
    tokens = STYLE_TOKENS.get(genre, STYLE_TOKENS.get(DEFAULT_GENRE, []))
    if not tokens:
        return prompt

    # Deduplicate: skip tokens whose key words already appear in prompt
    prompt_lower = prompt.lower()
    novel_tokens = []
    for token in tokens:
        # Check if the distinctive part of the token is already in the prompt.
        # Extract the core phrase (skip very short generic words).
        core_words = [w for w in token.lower().split() if len(w) > 3]
        if core_words and all(w in prompt_lower for w in core_words[:2]):
            continue  # Already present — skip
        novel_tokens.append(token)

    if not novel_tokens:
        return prompt
    style_str = ", ".join(novel_tokens)
    return f"{prompt} {style_str}."


def append_negative_prompts(prompt: str, genre: str | None = None) -> str:
    """Append negative prompts (exclusions) to a prompt.

    Uses the constant from config.py as the default, then adds
    genre-specific negatives if applicable.

    Args:
        prompt: Base prompt text
        genre: Optional genre for genre-specific negatives

    Returns:
        Prompt with negative prompts appended
    """
    negatives = SEEDANCE_NEGATIVE_PROMPTS
    if genre and genre in GENRE_NEGATIVES:
        negatives = f"{negatives}, {GENRE_NEGATIVES[genre]}"
    return f"{prompt} {negatives}."


def select_atmosphere(genre: str, mood: str | None = None) -> dict[str, str]:
    """Auto-select atmosphere settings (lighting, color_tone, texture, mood) for a genre.

    Uses genre-specific defaults from _GENRE_ATMOSPHERE mapping, with optional
    mood override.

    Args:
        genre: Genre key (e.g. "cinematic", "horror", "fight")
        mood: Optional mood override (e.g. "tense", "cheerful")

    Returns:
        Dict with keys: lighting, color_tone, texture, mood
    """
    # Look up genre defaults, fall back to cinematic
    defaults = _GENRE_ATMOSPHERE.get(genre, _GENRE_ATMOSPHERE.get(DEFAULT_GENRE, {}))
    result = dict(defaults)  # shallow copy

    # Override mood if provided and valid
    if mood and mood in ATMOSPHERE_BANKS.get("mood", []):
        result["mood"] = mood

    # If genre not mapped, pick random from banks
    if not result:
        result = {
            "lighting": random.choice(ATMOSPHERE_BANKS["lighting"]),
            "color_tone": random.choice(ATMOSPHERE_BANKS["color_tone"]),
            "texture": random.choice(ATMOSPHERE_BANKS["texture"]),
            "mood": mood or random.choice(ATMOSPHERE_BANKS["mood"]),
        }

    return result


def build_multimodal_prompt(
    description: str,
    media_roles: dict[str, str | list[str]],
    genre: str | None = None,
) -> "SeedancePrompt":
    """Build a prompt with structured media role assignments.

    Auto-assigns @imageN/@videoN/@audioN references based on roles and
    validates against Seedance media limits.

    Args:
        description: Scene description text
        media_roles: Dict mapping role names to file URLs. Keys match MEDIA_ROLES
                     (start_frame, end_frame, character_ref, scene_ref,
                      camera_ref, action_ref, bgm_ref, dialogue_ref).
                     Values are single URL strings or lists of URLs.
        genre: Optional genre for style tokens and negatives

    Returns:
        SeedancePrompt with assembled prompt and media_files list

    Raises:
        ValueError: If media limits exceeded (max 12 total, 9 images + 3 videos + 3 audio)
    """
    media_files: list[str] = []
    prompt_parts: list[str] = []
    image_count = 0
    video_count = 0
    audio_count = 0

    # Process roles in canonical order
    role_order = [
        "start_frame", "end_frame", "character_ref", "scene_ref",
        "camera_ref", "action_ref", "bgm_ref", "dialogue_ref",
    ]

    for role in role_order:
        urls = media_roles.get(role)
        if not urls:
            continue
        if isinstance(urls, str):
            urls = [urls]

        for url in urls:
            # Classify media type from role
            if role in ("start_frame", "end_frame", "character_ref", "scene_ref"):
                image_count += 1
                ref = f"@image{image_count}"
            elif role in ("camera_ref", "action_ref"):
                video_count += 1
                ref = f"@video{video_count}"
            elif role in ("bgm_ref", "dialogue_ref"):
                audio_count += 1
                ref = f"@audio{audio_count}"
            else:
                continue

            media_files.append(url)
            prompt_parts.append(ref)

    # Validate limits
    if image_count > SEEDANCE_MAX_IMAGES:
        raise ValueError(f"Too many images: {image_count} > max {SEEDANCE_MAX_IMAGES}")
    if video_count > SEEDANCE_MAX_VIDEOS:
        raise ValueError(f"Too many videos: {video_count} > max {SEEDANCE_MAX_VIDEOS}")
    if audio_count > SEEDANCE_MAX_AUDIO:
        raise ValueError(f"Too many audio files: {audio_count} > max {SEEDANCE_MAX_AUDIO}")
    if len(media_files) > SEEDANCE_MAX_MEDIA_TOTAL:
        raise ValueError(f"Too many media files: {len(media_files)} > max {SEEDANCE_MAX_MEDIA_TOTAL}")

    # Build prompt with media references
    refs_str = "".join(prompt_parts)
    if refs_str:
        prompt = f"{refs_str} {description}"
    else:
        prompt = description

    # Apply genre styling if provided
    if genre:
        style_genre = genre if genre in STYLE_TOKENS else DEFAULT_GENRE
        prompt = enhance_with_style(prompt, style_genre)
        prompt = append_negative_prompts(prompt, genre if genre in GENRE_NEGATIVES else None)
    else:
        prompt = append_negative_prompts(prompt)

    return SeedancePrompt(
        prompt=prompt,
        media_files=media_files,
        mode="text-to-video" if not media_files else "frames-to-video",
    )


def build_one_take_prompt(
    scene_descriptions: list[str],
    character_refs: list[str] | None = None,
) -> "SeedancePrompt":
    """Build a one-take shot (一镜到底) prompt across multiple scenes.

    Produces a continuous single-take prompt with image references for
    characters, connected scenes without cuts.

    Args:
        scene_descriptions: List of scene description strings to chain
        character_refs: Optional list of character reference image URLs

    Returns:
        SeedancePrompt with one-take prompt and media references
    """
    media_files: list[str] = []
    image_refs: list[str] = []

    # Add character reference images
    if character_refs:
        for i, url in enumerate(character_refs, start=1):
            media_files.append(url)
            image_refs.append(f"@image{i}")

    # Build refs prefix
    refs_str = "".join(image_refs)

    # Chain scene descriptions into continuous flow
    continuous = ", ".join(desc.rstrip(".") for desc in scene_descriptions)

    prompt = f"一镜到底, {refs_str} [continuous scene] {continuous}. No cuts"

    # Apply one_take camera technique fragment
    prompt = append_negative_prompts(prompt)

    return SeedancePrompt(
        prompt=prompt,
        media_files=media_files,
        mode="frames-to-video" if media_files else "text-to-video",
    )


def build_dialogue_prompt(
    character_desc: str,
    dialogue_text: str,
    emotion: str = "neutral",
) -> str:
    """Build a lip-sync dialogue prompt with proven Seedance pattern.

    Wraps dialogue with the pattern that produces reliable lip movement
    and matching expressions.

    Args:
        character_desc: Description of the speaking character
        dialogue_text: The dialogue text to be spoken
        emotion: Emotion/expression (e.g. "neutral", "happy", "angry", "sad")

    Returns:
        Formatted dialogue prompt string
    """
    return (
        f'{character_desc} speaks: "{dialogue_text}" '
        f"with {emotion} expression, matching lip movement"
    )


def build_connection_points(
    scene_a_desc: str,
    scene_b_desc: str,
) -> tuple[str, str]:
    """Generate visual state descriptions at scene boundaries for chained generation.

    Produces ending state for scene A and starting state for scene B to ensure
    visual continuity when chaining F2V scenes.

    Args:
        scene_a_desc: Description of the first (outgoing) scene
        scene_b_desc: Description of the second (incoming) scene

    Returns:
        Tuple of (scene_a_ending, scene_b_opening) description strings
    """
    # Extract key visual elements from both scenes
    scene_a_ending = (
        f"Scene settles into final position: {scene_a_desc.rstrip('.')}. "
        f"Camera comes to rest, establishing clear visual anchor point"
    )
    scene_b_opening = (
        f"Continuing seamlessly from previous shot. "
        f"Scene transitions naturally into: {scene_b_desc.rstrip('.')}. "
        f"Maintaining visual continuity and consistent lighting"
    )
    return scene_a_ending, scene_b_opening


def build_cinematic_prompt(
    description: str,
    camera: str | None = None,
    duration: int = SEEDANCE_DEFAULT_DURATION,
    genre: str = DEFAULT_GENRE,
    mode: str = "frames-to-video",
    f2v_loop: bool = False,
    atmosphere: dict[str, str] | None = None,
) -> str:
    """Transform a basic scene description into an optimized Seedance prompt.

    Applies camera vocabulary, time segments, style tokens, atmosphere,
    and negative prompts to produce a rich cinematic prompt.

    When f2v_loop=True (slide animations), uses subtle prompts instead of
    dramatic camera movements and time segments, producing minimal-motion
    output suitable for looping presentation slides.

    Args:
        description: Raw scene description (e.g. "Villa exterior at golden hour")
        camera: Camera movement key (e.g. "push_in", "orbit"). Optional.
        duration: Clip duration in seconds (default 8)
        genre: Style genre (default "cinematic")
        mode: Generation mode for context
        f2v_loop: If True, use subtle slide-appropriate prompts (skip camera/segments)
        atmosphere: Optional dict with lighting/color_tone/texture/mood overrides.
                    If None and genre is set, auto-selects via select_atmosphere().

    Returns:
        Enhanced prompt string ready for Seedance
    """
    if f2v_loop:
        # Subtle mode for slide animations — skip camera and time segments
        subtle = random.choice(SUBTLE_SLIDE_PROMPTS)
        base = f"{subtle}. {description.rstrip('.')}."

        # Use only 1-2 style tokens instead of full genre set
        tokens = STYLE_TOKENS.get(genre, STYLE_TOKENS.get(DEFAULT_GENRE, []))
        if tokens:
            base = f"{base} {', '.join(tokens[:2])}."

        # Still append negatives
        base = append_negative_prompts(base, genre)
        return base

    parts: list[str] = []

    # 1. Camera movement prefix
    cam_fragment = get_camera_fragment(camera) if camera else ""
    if cam_fragment:
        # Merge camera with description
        # e.g. "Camera slowly pushes forward toward the villa exterior..."
        parts.append(f"{cam_fragment} toward {description.rstrip('.')}.")
    else:
        parts.append(description.rstrip(".") + ".")

    base = " ".join(parts)

    # 2. Time segments (for 8s+ clips)
    base = build_time_segments(base, duration)

    # 3. Atmosphere injection (v2.37) — auto-select if not provided
    atmo = atmosphere if atmosphere else select_atmosphere(genre)
    if atmo:
        atmo_parts = []
        if atmo.get("lighting"):
            atmo_parts.append(atmo["lighting"])
        if atmo.get("color_tone"):
            atmo_parts.append(atmo["color_tone"])
        if atmo_parts:
            base = f"{base} {', '.join(atmo_parts)}."

    # 4. Style tokens
    base = enhance_with_style(base, genre)

    # 5. Negative prompts
    base = append_negative_prompts(base, genre)

    return base


def format_seedance_prompt(
    base_prompt: str,
    mode: str = "text-to-video",
    image_url: str | None = None,
    audio_url: str | None = None,
    video_url: str | None = None,
    camera_ref_url: str | None = None,
    duration: int = SEEDANCE_DEFAULT_DURATION,
    aspect_ratio: str = "16:9",
    scene_number: int | None = None,
) -> SeedancePrompt:
    """Build a complete SeedancePrompt ready for _create_task().

    Handles @ reference formatting per mode:
    - T2V: prompt as-is, no media files
    - I2V/F2V: @image1 prefix, image in media_files
    - Audio-lipsync: @image1 + @audio1, image + audio in media_files
    - Motion-transfer: @image1 + @video1, image + video in media_files

    Camera reference (camera_ref_url) can be added to T2V or I2V modes
    to replicate camera movement from a reference video.

    Args:
        base_prompt: Enhanced prompt text (from build_cinematic_prompt or raw)
        mode: "text-to-video", "frames-to-video", "audio-lipsync", "motion-transfer"
        image_url: Public URL of start image (for I2V/lipsync/motion modes)
        audio_url: Public URL of TTS audio (for audio-lipsync mode)
        video_url: Public URL of reference video (for motion-transfer mode)
        camera_ref_url: Public URL of camera reference video (for camera replication)
        duration: Clip duration in seconds
        aspect_ratio: "16:9", "9:16", or "1:1"
        scene_number: Optional scene number for metadata

    Returns:
        SeedancePrompt dataclass
    """
    media_files: list[str] = []

    if mode == "text-to-video":
        prompt = base_prompt

    elif mode in ("frames-to-video", "image-to-video"):
        if image_url:
            media_files.append(image_url)
        prompt = f"@image1 {base_prompt}"

    elif mode == "audio-lipsync":
        if image_url:
            media_files.append(image_url)
        if audio_url:
            media_files.append(audio_url)
        prompt = (
            f"@image1 character speaks naturally, matching @audio1 "
            f"content with natural expressions and lip movement. {base_prompt}"
        )

    elif mode == "motion-transfer":
        if image_url:
            media_files.append(image_url)
        if video_url:
            media_files.append(video_url)
        prompt = (
            f"@image1 character performs following @video1 motion "
            f"and camera style. {base_prompt}"
        )

    else:
        prompt = base_prompt

    # Camera reference video (v2.35) — replicate camera movement
    # Works with T2V and I2V modes (not motion-transfer which already has @video1)
    if camera_ref_url and mode not in ("motion-transfer", "audio-lipsync"):
        prompt += " Fully reference @video1's camera movements."
        media_files.append(camera_ref_url)

    return SeedancePrompt(
        prompt=prompt,
        media_files=media_files,
        duration=duration,
        aspect_ratio=aspect_ratio,
        mode=mode,
        scene_number=scene_number,
    )


# ============================================================================
# DB-Powered Prompt Enhancement (v2.36)
# ============================================================================

def list_prompt_styles() -> list[str]:
    """Return all available prompt styles (genres) from the DB.

    Combines built-in STYLE_TOKENS genres with DB-discovered genres.
    """
    styles = set(STYLE_TOKENS.keys())
    try:
        from seedance_prompt_db import PromptDB
        db = PromptDB()
        for genre, _count in db.get_all_genres():
            styles.add(genre)
        db.close()
    except Exception:
        pass  # DB not available, return built-in only
    return sorted(styles)


def build_enhanced_prompt(
    description: str,
    duration: int = SEEDANCE_DEFAULT_DURATION,
    prompt_style: str | None = None,
    camera: str | None = None,
    include_audio: bool = True,
    include_style_tokens: bool = True,
    include_negatives: bool = True,
    f2v_loop: bool = False,
) -> str:
    """Transform a scene description into a rich Seedance prompt using the DB.

    This is the v2.36 upgrade of build_cinematic_prompt(). It uses the
    Seedance Prompt Library DB to:
    1. Auto-detect genre from description (or use explicit prompt_style)
    2. Find matching templates with proven camera/audio/color patterns
    3. Build time-segmented prompt using genre-specific defaults
    4. Apply style tokens and negative prompts

    When f2v_loop=True (slide animations), skips DB template expansion and
    uses subtle motion prompts suitable for looping presentation slides.

    Falls back to build_cinematic_prompt() if the DB is unavailable.

    Args:
        description: Raw scene description (e.g. "Two warriors clash in temple")
        duration: Clip duration in seconds (default 8)
        prompt_style: Explicit genre/style (e.g. "fight", "ecommerce").
                      Auto-detected from description if None.
        camera: Camera movement key (e.g. "push_in"). Added on top of
                DB-suggested cameras. Optional.
        include_audio: Whether to add audio cue suggestions (default True)
        include_style_tokens: Whether to append style tokens (default True)
        include_negatives: Whether to append negative prompts (default True)
        f2v_loop: If True, use subtle slide-appropriate prompts (skip DB expansion)

    Returns:
        Enhanced prompt string ready for Seedance
    """
    if f2v_loop:
        # Subtle mode for slide animations — skip DB template expansion
        genre = prompt_style if prompt_style and prompt_style in STYLE_TOKENS else DEFAULT_GENRE
        subtle = random.choice(SUBTLE_SLIDE_PROMPTS)
        prompt = f"{subtle}. {description.rstrip('.')}."

        # Use only 1-2 style tokens
        if include_style_tokens:
            tokens = STYLE_TOKENS.get(genre, STYLE_TOKENS.get(DEFAULT_GENRE, []))
            if tokens:
                prompt = f"{prompt} {', '.join(tokens[:2])}."

        # Still append negatives
        if include_negatives:
            prompt = append_negative_prompts(prompt, genre if genre in GENRE_NEGATIVES else None)

        return prompt

    try:
        from seedance_prompt_db import PromptDB
        db = PromptDB()
    except Exception:
        # Fallback to basic builder
        genre = prompt_style if prompt_style and prompt_style in STYLE_TOKENS else DEFAULT_GENRE
        return build_cinematic_prompt(description, camera=camera, duration=duration, genre=genre)

    # Auto-detect or use explicit genre
    if prompt_style and prompt_style != "auto":
        genre = prompt_style
    else:
        genre = db.detect_genre(description)

    # Expand prompt using DB templates
    expanded = db.expand_prompt(
        description=description,
        genre=genre,
        duration=duration,
        include_audio=include_audio,
    )
    db.close()

    prompt = expanded.expanded

    # Prepend explicit camera if provided (on top of DB-suggested cameras)
    if camera:
        cam_fragment = get_camera_fragment(camera)
        if cam_fragment:
            prompt = f"{cam_fragment}. {prompt}"

    # Apply style tokens
    if include_style_tokens:
        # Map DB genre to STYLE_TOKENS key
        style_genre = genre if genre in STYLE_TOKENS else DEFAULT_GENRE
        prompt = enhance_with_style(prompt, style_genre)

    # Apply negative prompts
    if include_negatives:
        prompt = append_negative_prompts(prompt, genre if genre in GENRE_NEGATIVES else None)

    return prompt
