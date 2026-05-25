#!/usr/bin/env python3
"""
Seedance 2.0 Prompt Director — Multi-shot orchestration layer.

Sits above seedance_prompt_builder.py to compose prompts at three control levels:
- FULL: Timestamp + Cut to + image labels + dialogue
- LOOSE: Narrative Cut to, no timestamps, AI decides pacing
- IDEA: High-level story concept, AI decides everything

Character reference sheets are mandatory in ALL prompts with human characters.

Usage:
    python3 seedance_prompt_director.py compose --input scenes.json
    python3 seedance_prompt_director.py detect --input scenes.json
    python3 seedance_prompt_director.py validate-refs --input scenes.json
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

# Optional builder / DB imports — graceful fallback if unavailable
try:
    from seedance_prompt_builder import enhance_with_style, append_negative_prompts, select_atmosphere
except ImportError:
    def enhance_with_style(prompt: str, genre: str) -> str:  # type: ignore[misc]
        return prompt

    def append_negative_prompts(prompt: str, genre: str | None = None) -> str:  # type: ignore[misc]
        return prompt

    def select_atmosphere(genre: str, mood: str | None = None) -> dict[str, str]:  # type: ignore[misc]
        return {"lighting": "natural", "color_tone": "neutral", "texture": "cinematic", "mood": mood or "neutral"}

try:
    from seedance_prompt_db import PromptDB
except ImportError:
    class PromptDB:  # type: ignore[no-redef]
        def detect_genre(self, description: str) -> str:
            return "cinematic"

# Optional hooks library — production-grade patterns from Higgsfield skills
try:
    from seedance_hooks import get_hooks_for_genre, format_hook, get_lighting_for_genre
    HOOKS_AVAILABLE = True
except ImportError:
    HOOKS_AVAILABLE = False

# Optional chain/validation imports — graceful fallback
try:
    from seedance_chain_manager import build_chain_plan, ChainPlan
except ImportError:
    def build_chain_plan(scenes):  # type: ignore[misc]
        return None
    ChainPlan = None  # type: ignore[assignment,misc]

try:
    from seedance_reference_validator import validate_references_heuristic, ReferenceReport
except ImportError:
    def validate_references_heuristic(prompt, media_roles, scene_number):  # type: ignore[misc]
        return []

    class ReferenceReport:  # type: ignore[no-redef]
        def __init__(self, checks):
            self.checks = checks
        @property
        def passed(self):
            return not any(c.conflict is not None and c.severity == "error" for c in self.checks)
        def to_dict(self):
            return {"passed": self.passed, "checks": []}

try:
    from seedance_prompt_critique import critique_prompt, auto_fix_prompt
except ImportError:
    def critique_prompt(prompt, **kwargs):  # type: ignore[misc]
        class _FakeCrit:
            passed = True
            issues = []
        return _FakeCrit()

    def auto_fix_prompt(prompt, critique, characters=None):  # type: ignore[misc]
        return prompt


class ControlLevel(Enum):
    FULL = "full"
    LOOSE = "loose"
    IDEA = "idea"


# ---------------------------------------------------------------------------
# Genre Constants & Templates
# ---------------------------------------------------------------------------

SUPPORTED_GENRES = (
    "cinematic", "commercial", "meme", "ugc", "anime", "drama", "vfx",
)

# Mode x Genre compatibility matrix — from wiki mode-genre-matrix.md
# Values: "best", "good", "okay"
MODE_GENRE_MATRIX: dict[str, dict[str, str]] = {
    "cinematic":  {"full": "best", "loose": "good", "idea": "okay"},
    "commercial": {"full": "good", "loose": "good", "idea": "best"},
    "meme":       {"full": "best", "loose": "good", "idea": "good"},
    "ugc":        {"full": "best", "loose": "good", "idea": "okay"},
    "anime":      {"full": "good", "loose": "best", "idea": "good"},
    "drama":      {"full": "best", "loose": "good", "idea": "okay"},
    "vfx":        {"full": "best", "loose": "okay", "idea": "good"},
}

# Genre-specific prompt templates — from wiki genre-specific-prompting-guide.md
# Each returns a formatted prompt string given scene data.

_GENRE_TEMPLATES: dict[str, dict[str, str]] = {
    "cinematic": {
        "style_prefix": "Style: {director_style}, {film_format}, {mood}.\nDuration: {duration}s.",
        "shot_format": "[{t_start:02d}-{t_end:02d}s] Shot {shot_num}: {title} ({purpose}).\n{scene}. {action}. {camera}.",
        "default_director": "Denis Villeneuve style",
        "default_format": "IMAX 70mm, cinematic grain",
    },
    "commercial": {
        "style_prefix": "",
        "shot_format": "{scene}. {action}.",
        "minimal": True,
    },
    "meme": {
        "style_prefix": "【Style】Mockumentary, {perspective} perspective, hyperrealistic CG, {quality} quality.\n【Duration】{duration} seconds",
        "shot_format": "[{t_start:02d}:{t_start_s:02d}-{t_end:02d}:{t_end_s:02d}] Shot {shot_num}: {title} ({purpose}).\n{scene}",
        "default_perspective": "third-person",
        "default_quality": "production",
        "punchline_structure": True,  # 3-shot: Setup → Interaction → Punchline
    },
    "ugc": {
        "style_prefix": "【Style】Mockumentary (Vlog Style), hyperrealism, fixed-camera real-shot feel, natural lighting, slight suspenseful comedy tone.\n【Duration】{duration} seconds",
        "shot_format": "[{t_start:02d}:{t_start_s:02d}-{t_end:02d}:{t_end_s:02d}] Shot {shot_num}: {title} ({purpose}).\n{scene}",
    },
    "anime": {
        "style_prefix": "",
        "shot_format": "Act {shot_num}: {title} (Testing {purpose})\nVisual: {scene}. Action: {action}.",
    },
    "drama": {
        "style_prefix": "【Style】{subgenre} (Mini-Drama Style), extreme fast-cut rhythm, high attractiveness filter, {emotional_tone}, {setting}.\n【Duration】{duration} seconds",
        "shot_format": "[{t_start:02d}:{t_start_s:02d}-{t_end:02d}:{t_end_s:02d}] Shot {shot_num}: {title}.\n{scene}",
        "dialogue_format": "【Dialogue lip-sync guidance】{speaker}: \"{line}\"",
        "bracket_notation": True,
    },
    "vfx": {
        "style_prefix": "【Style】Surrealism, {scale_concept}, epic visual spectacle, {quality_level}, extremely realistic lighting and shadow rendering.\n【Duration】{duration} seconds",
        "shot_format": "[{t_start:02d}:{t_start_s:02d}-{t_end:02d}:{t_end_s:02d}] Shot {shot_num}: {title} ({purpose}).\n{scene}",
    },
}

# Genre detection keywords — for auto-detecting genre from description
_GENRE_KEYWORDS: dict[str, list[str]] = {
    "commercial": ["product", "brand", "promotional", "commercial", "advertising", "advert", "showcase", "marketing", "promo"],
    "meme": ["meme", "funny", "absurd", "punchline", "mockumentary", "viral", "trending"],
    "ugc": ["ugc", "vlog", "user-generated", "tiktok", "reel", "selfie", "unboxing"],
    "anime": ["anime", "manga", "animated", "animation", "cartoon", "2d", "cel-shaded"],
    "drama": ["drama", "soap", "romance", "romantic", "betrayal", "revenge", "emotional", "dialogue-heavy", "mini-drama", "爽剧"],
    "vfx": ["vfx", "visual effects", "surreal", "transformation", "physics", "experimental", "impossible", "scale"],
    "cinematic": ["cinematic", "film", "movie", "epic", "director", "cinematography", "noir", "thriller"],
}


def detect_genre(description: str) -> str:
    """Detect genre from scene description using keyword matching.

    Returns one of SUPPORTED_GENRES. Falls back to 'cinematic'.
    """
    desc_lower = description.lower()
    scores: dict[str, int] = {g: 0 for g in SUPPORTED_GENRES}
    for genre, keywords in _GENRE_KEYWORDS.items():
        for kw in keywords:
            if kw in desc_lower:
                scores[genre] += 1
    best = max(scores, key=scores.get)  # type: ignore[arg-type]
    return best if scores[best] > 0 else "cinematic"


def auto_select_mode(
    genre: str,
    has_timestamps: bool = False,
    has_dialogue: bool = False,
    has_concept_only: bool = False,
) -> ControlLevel:
    """Auto-select the best control mode based on genre and input characteristics.

    Decision logic from wiki mode-genre-matrix.md:
    - Timestamps always → Full Control
    - Commercial without dialogue → Idea Mode
    - Dialogue → Full Control (except anime → Loose)
    - Concept only → Idea Mode
    - Default → Full Control (safe default)
    """
    if has_timestamps:
        return ControlLevel.FULL
    if genre == "commercial" and not has_dialogue:
        return ControlLevel.IDEA
    if has_dialogue:
        return ControlLevel.LOOSE if genre == "anime" else ControlLevel.FULL
    if has_concept_only:
        return ControlLevel.IDEA
    return ControlLevel.FULL


def joey_flags_from_env(env: dict | None = None) -> dict:
    """Read VC_JOEY_* env vars set by the TS production-executor and return
    kwargs ready to splat into DirectorConfig(...).

    Boolean vars use the convention "1" = True, anything else = False.
    Value vars (register, cinema mode, output shape, character sheet) pass
    through as strings. Unset vars fall back to DirectorConfig defaults.

    Args:
        env: optional env dict (defaults to os.environ). Useful for tests.

    Returns:
        dict suitable for `DirectorConfig(**joey_flags_from_env())`.
    """
    import os
    e = env if env is not None else os.environ
    def _bool(key: str, default: bool) -> bool:
        v = e.get(key)
        if v is None:
            return default
        return v == "1"
    out: dict = {}
    # Only set the fields when the env var is present, so DirectorConfig
    # defaults survive when the executor isn't driving the run.
    if "VC_JOEY_DIEGETIC_AUDIO" in e:
        out["append_diegetic_audio"] = _bool("VC_JOEY_DIEGETIC_AUDIO", True)
    if "VC_JOEY_PHOTOREAL_CLOSER" in e:
        out["append_photoreal_closer"] = _bool("VC_JOEY_PHOTOREAL_CLOSER", True)
    if "VC_JOEY_PHOTOREAL_CLOSER_STRICT" in e:
        out["photoreal_closer_strict"] = _bool(
            "VC_JOEY_PHOTOREAL_CLOSER_STRICT", False,
        )
    if "VC_JOEY_PHOTOREAL_REGISTER" in e:
        register = e["VC_JOEY_PHOTOREAL_REGISTER"]
        if register in ("human", "env-only"):
            out["photoreal_register"] = register
    if "VC_JOEY_OUTPUT_SHAPE" in e:
        shape = e["VC_JOEY_OUTPUT_SHAPE"]
        if shape in ("bracket", "joey-paragraph", "cinema-worldbuilder"):
            out["output_shape"] = shape
    return out


@dataclass
class CharacterRef:
    name: str
    sheet_image: str
    image_label: int | None = None
    description: str | None = None  # Physical description for Anchor & Master verbatim repetition


@dataclass
class Shot:
    description: str
    camera: str | None = None
    character_ref: str | None = None
    dialogue: str | None = None
    emotion: str | None = None
    duration_hint: int | None = None


@dataclass
class DirectorScene:
    scene_number: int
    description: str
    duration: int = 15
    shots: list[Shot] | None = None
    media_roles: dict[str, str | list[str]] | None = None
    dialogue: str | None = None
    characters: list[CharacterRef] | None = None
    control_level: ControlLevel | None = None
    continues_from_previous: bool = False
    genre: str | None = None  # Optional genre override per scene


# ---------------------------------------------------------------------------
# Joey-skill helpers: diegetic audio + photoreal closer
# ---------------------------------------------------------------------------
#
# Default-on, opt-out additions to every Seedance prompt this module
# emits. Both are derived from Joey's cinema-worldbuilder and
# banana-pro-director SKILL.md rules.
#
# Diegetic audio rule: every prompt gets a single audio line that lists
# only sounds the scene physically produces. NEVER music/lyrics/score.
# This kills the "ghost music artifact" Seedance emits when audio
# direction is left ambiguous.
#
# Photoreal closer: a locked paragraph appended after the prompt body
# encoding pores / peach fuzz / strand-by-strand hair / fabric weave /
# Kodak Vision3 film / halation / fine grain. Two variants — 'human'
# (full stack with skin lines) and 'env-only' (drops skin/hair, keeps
# fabric/lens/grade) for pure-environment plates.


PHOTOREAL_CLOSER_HUMAN = (
    "Hyperrealistic photography. Real human skin texture with visible "
    "pores, subtle subsurface scattering on the cheeks, nose bridge, and "
    "ears, fine peach fuzz catching light along the jawline and "
    "cheekbones, slight skin imperfections — natural unevenness, not "
    "retouched. Hair rendered strand by strand with realistic flyaways, "
    "baby hairs at the hairline, individual strands catching light, light "
    "transmission through the hair ends, natural texture and movement. "
    "Fabric rendered with real weave detail, real weight, real drape, "
    "visible texture variation across the surface. Eyes with real "
    "reflection, real moisture, real depth in the iris. Jewelry with real "
    "metal surface detail and tarnish or polish appropriate to the piece. "
    "Kodak Vision3 500T film emulation, visible fine film grain, subtle "
    "chromatic aberration at the edges of the frame, soft lens vignette, "
    "cinematic color grade with warm mid-tones and slightly cooled "
    "shadows. Lived-in, not pristine. Photographic, not rendered."
)

PHOTOREAL_CLOSER_ENV_ONLY = (
    "Hyperrealistic photography. Fabric, surfaces, and props rendered "
    "with real weave detail, real weight, real material wear — oxidized "
    "metal, dust-covered glass, cracked paint, moisture stains where "
    "appropriate. Kodak Vision3 500T film emulation, visible fine film "
    "grain, subtle chromatic aberration at the edges of the frame, soft "
    "lens vignette, cinematic color grade with warm mid-tones and "
    "slightly cooled shadows. Lived-in, not pristine. Photographic, not "
    "rendered."
)


# ---------------------------------------------------------------------------
# Diegetic audio composer
# ---------------------------------------------------------------------------

# Allow-list of diegetic sound cues keyed by scene-content patterns.
# Each entry is (pattern, sound_phrase). Patterns are matched
# case-insensitively against the scene description. Up to ~6 phrases get
# composed into a single audio line so it stays focused.

_DIEGETIC_AUDIO_RULES: list[tuple[re.Pattern, str]] = [
    # Footsteps with surface detection
    (re.compile(r"\bwet\s+pavement\b", re.IGNORECASE),
        "boots on wet pavement"),
    (re.compile(r"\bgravel\b", re.IGNORECASE),
        "footsteps crunching on gravel"),
    (re.compile(r"\bwooden?\s+floor\b", re.IGNORECASE),
        "footsteps on wood floor"),
    (re.compile(r"\bpolished\s+floor\b|\bmarble\s+floor\b", re.IGNORECASE),
        "footsteps on polished floor"),
    (re.compile(r"\b(?:concrete|asphalt|pavement|sidewalk)\b", re.IGNORECASE),
        "footsteps on concrete"),
    (re.compile(r"\b(?:grass|meadow|field)\b", re.IGNORECASE),
        "soft footfalls on grass"),
    (re.compile(r"\b(?:walk(?:s|ing)?|step(?:s|ping)?|stride(?:s|ing)?|run(?:s|ning)?)\b",
                re.IGNORECASE),
        "footsteps"),
    # Movement / exertion
    (re.compile(r"\b(?:fabric|cloth|dress|skirt|coat|cape|jacket)\b",
                re.IGNORECASE),
        "fabric rustle on movement"),
    (re.compile(r"\b(?:breath(?:ing|s)?|inhale|exhale|gasp)\b",
                re.IGNORECASE),
        "steady breath"),
    (re.compile(r"\b(?:fight|fighting|combat|strike|kick|punch|dodge|"
                r"sprint(?:s|ing)?|chase|chasing|dash(?:es|ed|ing)?)\b",
                re.IGNORECASE),
        "ragged breath, sharp inhales"),
    # Performance / crowd
    (re.compile(r"\b(?:stadium|arena|concert|festival|crowd|audience|pit)\b",
                re.IGNORECASE),
        "crowd cheering and screaming"),
    (re.compile(r"\b(?:lightstick|light\s+stick)\b", re.IGNORECASE),
        "light stick taps and clatter"),
    (re.compile(r"\b(?:stage|on-stage|microphone|mic\b|in-ear\s+monitor)\b",
                re.IGNORECASE),
        "stage floor creak, in-ear monitor rustle, haze machine hiss"),
    # Mech / sci-fi
    (re.compile(r"\bmech(?:s|a)?\b|\brobot(?:s|ic)?\b|\bservo(?:s|motor)?\b",
                re.IGNORECASE),
        "servos whining, mechanical joints flexing"),
    (re.compile(r"\b(?:weapon|laser|pulse\s+fire|charging)\b", re.IGNORECASE),
        "weapon charging hum and pulse fire impact"),
    (re.compile(r"\b(?:alien|creature|monster)\b", re.IGNORECASE),
        "low alien screech, debris fall"),
    (re.compile(r"\b(?:explode|explosion|debris|rubble|shockwave|impact)\b",
                re.IGNORECASE),
        "explosive impact and debris fall"),
    # Weather
    (re.compile(r"\brain(?:ing|y)?\b", re.IGNORECASE),
        "rain on the lens and pavement"),
    (re.compile(r"\bwind(?:y)?\b|\bgale\b|\bbreeze\b", re.IGNORECASE),
        "wind cutting between buildings"),
    (re.compile(r"\b(?:snow|snowfall|blizzard)\b", re.IGNORECASE),
        "soft snowfall hush"),
    (re.compile(r"\bthunder\b|\blightning\b|\bstorm\b", re.IGNORECASE),
        "distant thunder"),
    # Traffic / urban
    (re.compile(r"\b(?:traffic|subway|train|car|horn|engine)\b",
                re.IGNORECASE),
        "distant traffic hum with layered horns"),
    # Indoor / quiet
    (re.compile(r"\b(?:kitchen|apartment|bedroom|hallway|interior|room)\b",
                re.IGNORECASE),
        "ambient room tone"),
    # Doors and objects
    (re.compile(r"\bdoor(?:s|way)?\b", re.IGNORECASE),
        "door hinge creak"),
    (re.compile(r"\bglass\b", re.IGNORECASE),
        "glass clink"),
    # Body / jewelry
    (re.compile(r"\b(?:jewelry|chain|necklace|bracelet|ring)\b",
                re.IGNORECASE),
        "soft jewelry chime"),
]

# Sound cues to ADD when the cinema mode is known (overrides empty audio
# lines for stadium/atmospheric scenes that don't trip the keyword rules).
_MODE_AUDIO_DEFAULTS: dict[str, list[str]] = {
    "M1": ["ambient room tone", "fabric rustle on movement"],
    "M2": ["ambient studio tone", "fabric rustle on movement"],
    "M3": ["debris fall and impact", "ragged breath, sharp inhales", "distant rumble"],
    "M4": ["crowd cheering and screaming", "in-ear monitor rustle",
           "haze machine hiss", "stage floor creak"],
    "M5": ["wind through the environment", "ambient atmospheric tone",
           "distant low rumble"],
}

_AUDIO_BAN_PHRASE = (
    # Phrased as "spoken on camera" rather than "spoken in frame" so the
    # text doesn't accidentally trip sanitize_for_seedance's language-anchor
    # detector (which scans for /(speaking|spoken) in \w+/).
    "no music, no dialogue except what is physically spoken on camera"
)


def build_diegetic_audio(
    scene_description: str,
    mode: str | None = None,
    max_phrases: int = 6,
) -> str:
    """Compose a one-line diegetic audio spec from scene content.

    Scans the scene description for keywords from the allow-list and
    assembles up to `max_phrases` cues + the universal music ban. The
    output goes inline in the Seedance prompt's Static Description.

    Joey's rule: prompt audio describes ONLY sounds the scene physically
    produces. Music is added post-process via Suno; baking music cues
    into the prompt causes "ghost music" visual artifacts.

    Args:
        scene_description: free-text scene description.
        mode: optional cinema mode code (M1-M5) to seed defaults when the
            description is sparse.
        max_phrases: cap on how many diegetic phrases the line carries.

    Returns:
        Audio spec line, e.g. "Audio: diegetic only — footsteps on wet
        pavement, fabric rustle on movement, distant traffic hum, no
        music, no dialogue except what is physically spoken in frame."
    """
    phrases: list[str] = []
    seen: set[str] = set()

    def _add(phrase: str) -> None:
        if phrase in seen:
            return
        seen.add(phrase)
        phrases.append(phrase)

    desc = scene_description or ""
    for pattern, phrase in _DIEGETIC_AUDIO_RULES:
        if len(phrases) >= max_phrases:
            break
        if pattern.search(desc):
            _add(phrase)

    # If nothing matched, seed from cinema-mode defaults so the line
    # still carries useful direction.
    if not phrases and mode:
        for phrase in _MODE_AUDIO_DEFAULTS.get(mode.upper(), []):
            if len(phrases) >= max_phrases:
                break
            _add(phrase)

    # Last-resort fallback so every prompt has *some* diegetic line.
    if not phrases:
        _add("ambient room tone")
        _add("fabric rustle on movement")

    body = ", ".join(phrases)
    return f"Audio: diegetic only — {body}, {_AUDIO_BAN_PHRASE}."


# Strict-mode tail (Joey experimental flag --photoreal-closer-strict).
# Appended *after* the base closer when strict mode is on. Pushes against
# common AI-image failure modes more aggressively. May over-correct in
# some scenes — kept default-off until proven via A/B.
PHOTOREAL_CLOSER_STRICT_TAIL = (
    " Not CGI. Not a 3D render. Not Unreal Engine. Not Octane. Not "
    "Cinema 4D. No plastic skin. No commercial-ad sheen. No magazine "
    "retouch finish. Captured on real glass, on a real camera, by a "
    "real operator. Every reflection has a physical source visible in "
    "the frame."
)


def append_photoreal_closer(
    prompt: str,
    register: str = "human",
    strict: bool = False,
) -> str:
    """Append the photoreal closer paragraph to a prompt.

    Joey's rule: every prompt produced for Banana Pro / scene plates /
    Seedance video gets the locked photoreal stack at the end. Encodes
    real-skin / real-fabric / Kodak Vision3 / fine grain. Two variants:

    - 'human' (default): full stack with skin/hair lines.
    - 'env-only': drops skin/hair; keeps fabric/material/lens/grade.
      Use for pure-environment plates and M5 atmospheric scenes.

    Strict mode (Joey experimental): appends an additional negative
    phrasing block that explicitly rejects CGI/3D/render aesthetics.
    Helpful for scenes that come back rendered-looking; may over-correct
    on legitimate stylized work.

    If the prompt already contains the closer (idempotency check), this
    is a no-op (whether strict or not).

    Args:
        prompt: prompt text.
        register: 'human' or 'env-only'.
        strict: if True, append the strict-mode negative phrasing tail.

    Returns:
        Prompt with the closer appended (separated by two newlines).
    """
    if register not in ("human", "env-only"):
        raise ValueError(
            f"Invalid photoreal register: {register!r}. "
            f"Expected 'human' or 'env-only'."
        )
    base = (
        PHOTOREAL_CLOSER_ENV_ONLY if register == "env-only"
        else PHOTOREAL_CLOSER_HUMAN
    )
    closer = base + (PHOTOREAL_CLOSER_STRICT_TAIL if strict else "")
    # Idempotency — first sentence of either variant is unique enough.
    if "Hyperrealistic photography." in prompt and "Kodak Vision3" in prompt:
        return prompt
    sep = "\n\n" if prompt and not prompt.endswith(("\n", " ")) else ""
    return f"{prompt.rstrip()}{sep}{closer}"


@dataclass
class DirectorConfig:
    control_level: ControlLevel | None = None
    selection_mode: str = "auto"
    quality_tier: str = "smart-checkpoint"
    enable_chaining: bool = True
    enable_reference_validation: bool = True
    max_variants: int = 2
    genre: str | None = None  # Optional genre override
    language: str = "English"  # Language anchor for dialogue
    # Joey-skill defaults — set False to opt out of the corresponding
    # always-on behavior. Subprocess callers can also flip these via the
    # VC_JOEY_* env vars resolved by joey_flags_from_env().
    append_diegetic_audio: bool = True
    append_photoreal_closer: bool = True
    photoreal_register: str = "human"  # 'human' or 'env-only' (no skin/hair lines)
    # Experimental (default-off): appends the strict closer tail that
    # explicitly rejects CGI/3D/render aesthetics. Toggled by
    # --photoreal-closer-strict / VC_JOEY_PHOTOREAL_CLOSER_STRICT=1.
    photoreal_closer_strict: bool = False
    # Output shape: 'bracket' (default, Chinese-market 【Style】【Duration】
    # format via the genre-specific composers) or 'joey-paragraph' (single
    # continuous paragraph with inline **Style & Mood / Dynamic Description
    # / Static Description** labels, per Joey's cinema-worldbuilder skill).
    # Toggled by --output-shape / VC_JOEY_OUTPUT_SHAPE.
    output_shape: str = "bracket"


@dataclass
class ComposedScene:
    scene_number: int
    submission_prompt: str
    control_level: ControlLevel
    mode: str
    media_files: list[str]
    image_label_map: dict[int, str]
    duration: int
    chain_group: int | None = None
    critique: Any = None


@dataclass
class DirectorResult:
    scenes: list[ComposedScene]
    chain_plan: Any = None
    reference_report: Any = None
    variants: dict[int, list[str]] | None = None
    selected_control_levels: dict[int, ControlLevel] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Task 2: Control Level Auto-Detection
# ---------------------------------------------------------------------------

_ACTION_VERBS = re.compile(
    r"\b(walk(?:s|ed|ing)?|run(?:s|ning)?|jump(?:s|ed|ing)?|spin(?:s|ning)?|"
    r"turn(?:s|ed|ing)?|dance(?:s|d|ing)?|fight(?:s|ing)?|clash(?:es|ed|ing)?|"
    r"strike(?:s|ing)?|struck|charge(?:s|d|ing)?|leap(?:s|ed|ing)?|"
    r"dodge(?:s|d|ing)?|block(?:s|ed|ing)?|slam(?:s|med|ming)?|"
    r"kick(?:s|ed|ing)?|punch(?:es|ed|ing)?|chase(?:s|d|ing)?|"
    r"flee(?:s|ing)?|fled|climb(?:s|ed|ing)?|fall(?:s|ing)?|fell|"
    r"fly(?:ing)?|flies|flew|swim(?:s|ming)?|dive(?:s|d|ing)?|"
    r"explode(?:s|d|ing)?|crash(?:es|ed|ing)?|smash(?:es|ed|ing)?|"
    r"throw(?:s|ing)?|threw|catch(?:es|ing)?|caught|grab(?:s|bed|bing)?|"
    r"push(?:es|ed|ing)?|pull(?:s|ed|ing)?|drag(?:s|ged|ging)?|"
    r"slide(?:s|ing)?|slid|roll(?:s|ed|ing)?|flip(?:s|ped|ping)?|"
    r"land(?:s|ed|ing)?)\b",
    re.IGNORECASE,
)


def detect_control_level(scenes: list[DirectorScene]) -> ControlLevel:
    """Auto-detect the best control level based on scene content.
    Priority: FULL > LOOSE > IDEA
    """
    has_dialogue = False
    has_structured_shots = False
    total_media_roles = 0
    action_scene_count = 0
    has_any_media = False

    for scene in scenes:
        if scene.dialogue:
            has_dialogue = True
        if scene.shots:
            has_structured_shots = True
        if scene.media_roles:
            has_any_media = True
            total_media_roles += sum(
                len(v) if isinstance(v, list) else 1
                for v in scene.media_roles.values()
            )
        action_count = len(_ACTION_VERBS.findall(scene.description))
        if action_count >= 2:
            action_scene_count += 1

    if has_dialogue:
        return ControlLevel.FULL
    if total_media_roles >= 3:
        return ControlLevel.FULL
    if has_structured_shots:
        return ControlLevel.FULL
    if action_scene_count >= 1:
        return ControlLevel.LOOSE
    if has_any_media:
        return ControlLevel.LOOSE
    return ControlLevel.IDEA


# ---------------------------------------------------------------------------
# Task 3: Image Label Assignment
# ---------------------------------------------------------------------------

_SCENE_ROLES_ORDER = ["start_frame", "end_frame", "scene_ref"]


def assign_image_labels(
    media_roles: dict[str, str | list[str]] | None,
    characters: list[CharacterRef],
) -> tuple[dict[int, str], list[CharacterRef]]:
    """Assign image labels: scene refs first (image 1+), then character sheets."""
    label_map: dict[int, str] = {}
    next_label = 1

    if media_roles:
        for role in _SCENE_ROLES_ORDER:
            urls = media_roles.get(role)
            if not urls:
                continue
            if isinstance(urls, str):
                urls = [urls]
            for url in urls:
                label_map[next_label] = url
                next_label += 1

    updated_chars = []
    for char in characters:
        updated = CharacterRef(
            name=char.name, sheet_image=char.sheet_image,
            image_label=next_label, description=char.description,
        )
        label_map[next_label] = char.sheet_image
        next_label += 1
        updated_chars.append(updated)

    return label_map, updated_chars


# ---------------------------------------------------------------------------
# Task 4: Dialogue Parser & Auto-Decomposition
# ---------------------------------------------------------------------------

_DIALOGUE_PATTERN = re.compile(
    r"([\w][\w\s]*?)\s*(?:\(([^)]+)\))?\s*:\s*(['\"])(.+?)\3(?=\s|$|[.!?,;])",
)


def parse_dialogue(text: str) -> list[dict[str, str | None]]:
    """Parse dialogue string into turns. Supports: A: 'Hello.' / Character A (whispering): "text" """
    if not text:
        return []
    turns = []
    for match in _DIALOGUE_PATTERN.finditer(text):
        turns.append({
            "speaker": match.group(1).strip(),
            "line": match.group(4).strip(),
            "emotion": match.group(2).strip() if match.group(2) else None,
        })
    return turns


def auto_decompose_shots(
    description: str, dialogue: str | None, duration: int, characters: list[CharacterRef],
) -> list[Shot]:
    """Auto-decompose a scene into shots based on dialogue."""
    if not dialogue:
        return [Shot(description=description, duration_hint=duration)]

    turns = parse_dialogue(dialogue)
    if not turns:
        return [Shot(description=description, duration_hint=duration)]

    shots: list[Shot] = []
    char_lookup: dict[str, CharacterRef] = {}
    for char in characters:
        char_lookup[char.name.lower()] = char
        words = char.name.split()
        if len(words) > 1:
            char_lookup[words[-1].lower()] = char

    establishing_time = 3
    closing_time = max(2, duration - establishing_time - len(turns) * 4)
    dialogue_time_each = max(2, (duration - establishing_time - closing_time) // max(len(turns), 1))
    used = establishing_time + dialogue_time_each * len(turns)
    closing_time = duration - used

    shots.append(Shot(description=description, camera="wide", duration_hint=establishing_time))

    for turn in turns:
        speaker = turn["speaker"]
        matched_char = char_lookup.get(speaker.lower())
        shots.append(Shot(
            description=f"Close-up of {speaker}", camera="close_up",
            character_ref=matched_char.name if matched_char else speaker,
            dialogue=turn["line"], emotion=turn["emotion"],
            duration_hint=dialogue_time_each,
        ))

    shots.append(Shot(description=description, camera="medium", duration_hint=max(closing_time, 2)))
    return shots


# ---------------------------------------------------------------------------
# Task 5: Full Control Multi-Shot Prompt Composer
# ---------------------------------------------------------------------------

_CAMERA_LABELS = {
    "wide": "wide tracking shot",
    "close_up": "close-up shot",
    "medium": "medium shot",
    "extreme_close_up": "extreme close-up shot",
    "over_shoulder": "over-the-shoulder shot",
    "pov": "POV shot",
    "tracking": "tracking shot",
    "aerial": "aerial shot",
}

_MAX_PROMPT_LEN = 1200


def _camera_label(camera: str | None) -> str:
    """Convert a camera shorthand to a human-readable shot label."""
    if not camera:
        return "shot"
    return _CAMERA_LABELS.get(camera, f"{camera} shot")


def _build_char_lookup(characters: list[CharacterRef]) -> dict[str, CharacterRef]:
    """Build a case-insensitive lookup from character name (and last-name) to ref."""
    lookup: dict[str, CharacterRef] = {}
    for char in characters:
        lookup[char.name.lower()] = char
        words = char.name.split()
        if len(words) > 1:
            lookup[words[-1].lower()] = char
    return lookup


def _allocate_timestamps(
    shots: list[Shot], duration: int,
) -> list[tuple[int, int]]:
    """Allocate timestamps across shots based on duration hints."""
    total_hint = sum(s.duration_hint or 0 for s in shots)
    if total_hint <= 0:
        per_shot = duration // max(len(shots), 1)
        for s in shots:
            s.duration_hint = per_shot
        if shots:
            shots[-1].duration_hint = duration - per_shot * (len(shots) - 1)
        total_hint = duration

    scale = duration / total_hint if total_hint > 0 else 1.0
    timestamps: list[tuple[int, int]] = []
    cursor = 0
    for s in shots:
        dur = max(1, round((s.duration_hint or 1) * scale))
        end = min(cursor + dur, duration)
        timestamps.append((cursor, end))
        cursor = end
    return timestamps


def _find_scene_image_label(
    image_label_map: dict[int, str], characters: list[CharacterRef],
) -> int | None:
    """Find the lowest image label that is NOT a character sheet."""
    if not image_label_map:
        return None
    char_images = {c.sheet_image for c in characters}
    for label in sorted(image_label_map.keys()):
        if image_label_map[label] not in char_images:
            return label
    return None


def _build_char_refs_text(characters: list[CharacterRef]) -> str:
    """Build 'referencing character sheet in image N' text."""
    refs = [f"image {c.image_label}" for c in characters if c.image_label]
    if len(refs) == 1:
        return f", referencing character sheet in {refs[0]}"
    elif refs:
        return f", referencing character sheets in {' and '.join(refs)}"
    return ""


def _build_anchor_master_text(characters: list[CharacterRef]) -> str:
    """Build Anchor & Master character description text with face stability cue."""
    char_descs = [f"{c.name}: {c.description}" for c in characters if c.description]
    if char_descs:
        stability = ". Maintain high character consistency — same facial features, same proportions, same outfit throughout"
        return ". " + ", ".join(char_descs) + stability
    return ""


def _trim_prompt(prompt: str, suffix: str = ". No subtitles.") -> str:
    """Trim prompt to fit within _MAX_PROMPT_LEN, preserving suffix."""
    max_body = _MAX_PROMPT_LEN - len(suffix)
    if len(prompt) > max_body:
        prompt = prompt[:max_body - 3].rsplit(". Cut to", 1)[0]
        if not prompt.endswith("."):
            last_period = prompt.rfind(".")
            if last_period > 0:
                prompt = prompt[:last_period + 1]
    prompt = prompt.rstrip(". ")
    prompt += suffix
    return prompt


# ---------------------------------------------------------------------------
# Sound Design Helper
# ---------------------------------------------------------------------------


def _build_sound_design(scene: DirectorScene, genre: str = "cinematic") -> str:
    """Generate a sound design line for the prompt based on scene content."""
    desc = scene.description.lower()

    parts = []
    # Detect environment sounds
    if any(w in desc for w in ["rain", "storm", "thunder"]):
        parts.append("SFX: rain pattering, distant thunder")
    elif any(w in desc for w in ["city", "street", "urban", "traffic"]):
        parts.append("SFX: city ambience, distant traffic, footsteps")
    elif any(w in desc for w in ["forest", "nature", "garden", "park", "meadow"]):
        parts.append("SFX: birds chirping, gentle wind through leaves")
    elif any(w in desc for w in ["ocean", "sea", "beach", "waves"]):
        parts.append("SFX: waves crashing, seagulls, ocean breeze")
    elif any(w in desc for w in ["fight", "battle", "punch", "kick", "combat"]):
        parts.append("SFX: impact hits, whoosh, debris crumbling")
    elif any(w in desc for w in ["kitchen", "cooking", "baking"]):
        parts.append("SFX: sizzling, utensils clinking, timer bell")
    elif any(w in desc for w in ["space", "astronaut", "orbit"]):
        parts.append("SFX: deep space hum, radio static, breathing")

    # Detect dialogue cues
    if scene.dialogue:
        parts.append("Dialogue: clear voice, room tone")

    return ". ".join(parts) if parts else ""


# ---------------------------------------------------------------------------
# Genre-Specific Full Control Composers
# ---------------------------------------------------------------------------

def _compose_full_control_drama(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    shots: list[Shot],
) -> str:
    """Full control with Chinese bracket notation for drama genre.

    Format from wiki genre-specific-prompting-guide.md:
    【Style】[subgenre] (Mini-Drama Style), ...
    【Duration】15 seconds
    [00:00-00:05] Shot 1: ...
    【Dialogue lip-sync guidance】Character: "line"
    """
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    parts: list[str] = []

    # Style block
    parts.append(
        f"【Style】Drama (Mini-Drama Style), extreme fast-cut rhythm, "
        f"high attractiveness filter, emotional tension"
    )
    parts.append(f"【Duration】{scene.duration} seconds")

    # Characters block with Anchor & Master
    if characters:
        char_parts = []
        for c in characters:
            desc = f" ({c.description})" if c.description else ""
            img = f" in image {c.image_label}" if c.image_label else ""
            char_parts.append(f"{c.name}{desc}{img}")
        parts.append("【Characters】" + " VS ".join(char_parts))

    char_lookup = _build_char_lookup(characters)

    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        shot_line = f"[{t_start:02d}:{0:02d}-{t_end:02d}:{0:02d}] Shot {i + 1}: {shot.description}"
        if i == 0 and scene_image_label is not None:
            shot_line += f" shown in image {scene_image_label}"
        parts.append(shot_line)

        if shot.dialogue:
            speaker = shot.character_ref or "character"
            emotion = f" ({shot.emotion})" if shot.emotion else ""
            parts.append(f"【Dialogue lip-sync guidance】{speaker}{emotion}: \"{shot.dialogue}\"")

    sound = _build_sound_design(scene, "drama")
    if sound:
        parts.append(f"Audio: {sound}")

    prompt = "\n".join(parts)
    return _trim_prompt(prompt)


def _compose_bracket_notation(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    shots: list[Shot],
) -> str:
    """Chinese market bracket notation format — works for any genre.

    Format:
    【Style】[genre] (style description), [rhythm], [tone]
    【Duration】15 seconds
    【Characters】Character1 (desc) in image 1 VS Character2 (desc) in image 2
    【Setting】[location/environment]
    [00:00-00:05] Shot 1: [description] shown in image 1
    【Dialogue lip-sync guidance】Speaker (emotion): "line"
    【Audio】SFX: [environment sounds]. Music: [style]. Foley: [details]
    """
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    parts: list[str] = []

    # Style block (inferred from scene context)
    parts.append("【Style】Cinematic production, refined pacing, professional quality")
    parts.append(f"【Duration】{scene.duration} seconds")

    # Characters block with Anchor & Master
    if characters:
        char_parts = []
        for c in characters:
            desc = f" ({c.description})" if c.description else ""
            img = f" in image {c.image_label}" if c.image_label else ""
            char_parts.append(f"{c.name}{desc}{img}")
        if len(characters) > 1:
            parts.append("【Characters】" + " VS ".join(char_parts))
        else:
            parts.append("【Characters】" + char_parts[0])

    # Setting
    if hasattr(scene, 'setting') and getattr(scene, 'setting', None):
        parts.append(f"【Setting】{scene.setting}")

    # Shots
    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        shot_line = f"[{t_start:02d}:{0:02d}-{t_end:02d}:{0:02d}] Shot {i + 1}: {shot.description}"
        if i == 0 and scene_image_label is not None:
            shot_line += f" shown in image {scene_image_label}"
        parts.append(shot_line)

        if shot.dialogue:
            speaker = shot.character_ref or "character"
            emotion = f" ({shot.emotion})" if shot.emotion else ""
            parts.append(f"【Dialogue lip-sync guidance】{speaker}{emotion}: \"{shot.dialogue}\"")

    # Audio
    sound = _build_sound_design(scene) if '_build_sound_design' in globals() else ''
    if sound:
        parts.append(f"【Audio】{sound}")

    prompt = "\n".join(parts)
    return _trim_prompt(prompt)


def _detect_acts(description: str) -> list[dict]:
    """Split a scene description into acts if Act 1/Act 2 markers present."""
    import re
    # Match "Act 1:", "Act 2:", etc. or "Part 1:", "Phase 1:"
    pattern = re.compile(r'\b(Act|Part|Phase)\s+(\d+)[:.]?\s*([^.]+)', re.IGNORECASE)
    matches = list(pattern.finditer(description))
    if len(matches) < 2:
        return []  # Not multi-act

    acts = []
    for i, m in enumerate(matches):
        next_start = matches[i + 1].start() if i + 1 < len(matches) else len(description)
        act_content = description[m.start():next_start].strip()
        acts.append({
            'number': int(m.group(2)),
            'marker': m.group(1),
            'content': act_content,
        })
    return acts


def _compose_full_control_meme(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    shots: list[Shot],
) -> str:
    """Full control with 3-shot punchline structure for meme genre.

    Format from wiki: Setup → Interaction → Punchline
    """
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    parts: list[str] = []

    parts.append(
        "【Style】Mockumentary, third-person perspective, hyperrealistic CG, "
        "production quality"
    )
    parts.append(f"【Duration】{scene.duration} seconds")

    # Map shots to 3-act punchline structure
    punchline_labels = ["Visual spectacle (The Reveal)", "Absurd interaction (The Interaction)", "Memetic ending (The Punchline)"]
    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        label = punchline_labels[i] if i < len(punchline_labels) else f"Shot {i + 1}"
        shot_line = f"[{t_start:02d}:{0:02d}-{t_end:02d}:{0:02d}] Shot {i + 1}: {label}."
        shot_line += f"\n{shot.description}"
        if i == 0 and scene_image_label is not None:
            shot_line += f" shown in image {scene_image_label}"
        parts.append(shot_line)

    # Character refs
    if characters:
        parts.append(_build_char_refs_text(characters).lstrip(", "))
        parts.append(_build_anchor_master_text(characters).lstrip(". "))

    sound = _build_sound_design(scene, "meme")
    if sound:
        parts.append(f"Audio: {sound}")

    prompt = "\n".join(p for p in parts if p)
    return _trim_prompt(prompt)


def _compose_full_control_cinematic(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    shots: list[Shot],
) -> str:
    """Full control with Director Brief format for cinematic genre.

    Format: Style header + timestamped shots with director-style shorthand.
    """
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    parts: list[str] = []

    # Style header
    parts.append(
        f"Style: Cinematic, IMAX 70mm, cinematic grain.\n"
        f"Duration: {scene.duration}s."
    )

    char_lookup = _build_char_lookup(characters)

    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        cam = _camera_label(shot.camera)
        shot_line = f"[{t_start:02d}-{t_end:02d}s] Shot {i + 1}: {cam.capitalize()}"
        shot_line += f".\n{shot.description}"
        if i == 0 and scene_image_label is not None:
            shot_line += f" shown in image {scene_image_label}"
        if i == 0 and characters:
            shot_line += _build_char_refs_text(characters)
            shot_line += _build_anchor_master_text(characters)
        parts.append(shot_line)

        if shot.dialogue:
            speaker = shot.character_ref or "character"
            emotion = f" ({shot.emotion})" if shot.emotion else ""
            matched = char_lookup.get((shot.character_ref or "").lower())
            ref_text = f", referencing image {matched.image_label}" if matched and matched.image_label else ""
            parts.append(f"{speaker}{emotion}{ref_text} says: \"{shot.dialogue}\"")

    sound = _build_sound_design(scene, "cinematic")
    if sound:
        parts.append(f"Audio: {sound}")

    prompt = "\n".join(parts)
    return _trim_prompt(prompt)


def _compose_full_control_ugc(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    shots: list[Shot],
) -> str:
    """Full control with UGC bracket notation (fixed-camera, one surreal twist).

    Format from wiki genre-specific-prompting-guide.md:
    【Style】Mockumentary (Vlog Style), hyperrealism, fixed-camera real-shot feel, ...
    【Duration】15 seconds
    [00:00-00:06] Shot 1: Daily setup (Normalcy).
    [00:06-00:11] Shot 2: BUG appears (The Glitch).
    [00:11-00:15] Shot 3: Comedic callback (The Punchline).
    """
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    parts: list[str] = []
    parts.append(
        "【Style】Mockumentary (Vlog Style), hyperrealism, fixed-camera "
        "real-shot feel, natural lighting, slight suspenseful comedy tone"
    )
    parts.append(f"【Duration】{scene.duration} seconds")

    # 3-act UGC structure: Normalcy → Glitch → Punchline
    ugc_labels = [
        "Daily setup (Normalcy)",
        "BUG appears (The Glitch)",
        "Comedic callback (The Punchline)",
    ]
    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        label = ugc_labels[i] if i < len(ugc_labels) else f"Shot {i + 1}"
        shot_line = f"[{t_start:02d}:{0:02d}-{t_end:02d}:{0:02d}] Shot {i + 1}: {label}."
        shot_line += f"\n{shot.description}"
        if i == 0 and scene_image_label is not None:
            shot_line += f" shown in image {scene_image_label}"
        parts.append(shot_line)

    # Director's note reminder for glitch realism
    if len(shots) >= 2:
        parts.append("Director's note: Must create a 'network delay' / impossible-physics feel on the glitch.")

    # Character refs
    if characters:
        ref_text = _build_char_refs_text(characters).lstrip(", ")
        if ref_text:
            parts.append(ref_text)
        anchor = _build_anchor_master_text(characters).lstrip(". ")
        if anchor:
            parts.append(anchor)

    sound = _build_sound_design(scene, "ugc")
    if sound:
        parts.append(f"Audio: {sound}")

    prompt = "\n".join(p for p in parts if p)
    return _trim_prompt(prompt)


def _compose_full_control_vfx(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    shots: list[Shot],
) -> str:
    """Full control with VFX bracket notation + explicit physics directives.

    Format from wiki genre-specific-prompting-guide.md:
    【Style】Surrealism, [scale concept], epic visual spectacle, ...
    [00:00-00:05] Shot 1: Calm illusion (The Calm).
    [00:05-00:10] Shot 2: Transformation (The Disruption).
    [00:10-00:15] Shot 3: Revelation (The Revelation).
    """
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    parts: list[str] = []
    parts.append(
        "【Style】Surrealism, epic visual spectacle, production quality, "
        "extremely realistic lighting and shadow rendering, precise physics simulation"
    )
    parts.append(f"【Duration】{scene.duration} seconds")

    vfx_labels = [
        "Calm illusion (The Calm)",
        "Transformation (The Disruption)",
        "Revelation (The Revelation)",
    ]
    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        label = vfx_labels[i] if i < len(vfx_labels) else f"Shot {i + 1}"
        shot_line = f"[{t_start:02d}:{0:02d}-{t_end:02d}:{0:02d}] Shot {i + 1}: {label}."
        shot_line += f"\n{shot.description}"
        if i == 0 and scene_image_label is not None:
            shot_line += f" shown in image {scene_image_label}"
        parts.append(shot_line)

    # Explicit physics reminder — VFX needs this
    parts.append("Physics: describe how materials deform, how light refracts, how mass moves. Specify scale explicitly.")

    if characters:
        ref_text = _build_char_refs_text(characters).lstrip(", ")
        if ref_text:
            parts.append(ref_text)
        anchor = _build_anchor_master_text(characters).lstrip(". ")
        if anchor:
            parts.append(anchor)

    sound = _build_sound_design(scene, "vfx")
    if sound:
        parts.append(f"Audio: {sound}")

    prompt = "\n".join(p for p in parts if p)
    return _trim_prompt(prompt)


def _compose_full_control_anime(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    shots: list[Shot],
) -> str:
    """Full control with anime Act structure for complex multi-act sequences.

    Format from wiki genre-specific-prompting-guide.md:
    Act 1: [Title] (Testing [Capability])
    Visual: [Description]. Action: [Description].
    Visual Focus: Testing [specific model capability].
    Act 2: [Title] ...

    Uses Act N labels rather than shot timestamps; timestamps included as hints.

    If the scene description contains explicit Act/Part/Phase markers (e.g.,
    "Act 1: ... Act 2: ..."), the prompt is restructured as a multi-act
    sequence with dramatic transitions.
    """
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    parts: list[str] = []

    # Multi-act detection — if the description contains Act/Part/Phase markers,
    # structure the prompt as a multi-act sequence.
    acts = _detect_acts(scene.description)
    if acts:
        parts.append("【Style】Anime multi-act sequence, dynamic transitions, emotional arcs")
        parts.append(f"【Duration】{scene.duration} seconds total")

        # Allocate time per act
        time_per_act = scene.duration // len(acts)
        cursor = 0
        for act in acts:
            act_end = cursor + time_per_act
            parts.append(f"[{cursor:02d}-{act_end:02d}s] {act['marker']} {act['number']}: {act['content']}")
            cursor = act_end

        # Add transition directive between acts
        parts.append("Transitions: dramatic whip-pan or flash-cut between acts to maintain anime energy")

        if characters:
            parts.append(_build_anchor_master_text(characters).lstrip(". "))

        return _trim_prompt("\n".join(p for p in parts if p))

    parts.append(f"Style: Anime, cel-shaded, vibrant color palette, dynamic line work.")
    parts.append(f"Duration: {scene.duration}s.")

    char_lookup = _build_char_lookup(characters)

    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        act_line = f"Act {i + 1} ({t_start:02d}-{t_end:02d}s): {_camera_label(shot.camera).capitalize()}"
        act_line += f".\nVisual: {shot.description}"
        if i == 0 and scene_image_label is not None:
            act_line += f" shown in image {scene_image_label}"
        if i == 0 and characters:
            act_line += _build_char_refs_text(characters)
            act_line += _build_anchor_master_text(characters)
        parts.append(act_line)

        if shot.dialogue:
            speaker = shot.character_ref or "character"
            emotion = f" ({shot.emotion})" if shot.emotion else ""
            matched = char_lookup.get((shot.character_ref or "").lower())
            ref_text = f", referencing image {matched.image_label}" if matched and matched.image_label else ""
            parts.append(f"Action: {speaker}{emotion}{ref_text} says: \"{shot.dialogue}\"")

    sound = _build_sound_design(scene, "anime")
    if sound:
        parts.append(f"Audio: {sound}")

    prompt = "\n".join(parts)
    return _trim_prompt(prompt)


def compose_full_control(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    genre: str = "cinematic",
    use_bracket_notation: bool = False,
) -> str:
    """Compose a Seedance 2.0 full-control prompt with timestamps, Cut to, and image labels.

    When a genre is specified, uses genre-specific formatting:
    - drama: Chinese bracket notation with 【Dialogue lip-sync guidance】
    - meme: 3-shot punchline structure (Setup → Interaction → Punchline)
    - cinematic: Director Brief with style header
    - ugc: Bracket notation with Normalcy → Glitch → Punchline 3-act structure
    - vfx: Bracket notation with Calm → Disruption → Revelation + physics directives
    - anime: Act N structure with Visual/Action blocks
    - Default: Original tutorial format with "From X to Y seconds"

    When use_bracket_notation=True, overrides the genre-specific composer and
    uses the generic Chinese market bracket notation format (works for any genre).

    Output format for default mirrors the official Seedance 2.0 tutorial:
      From 0 to 3 seconds, wide tracking shot, a scene of ... shown in image 1,
      referencing character sheets in image 2 and image 3. Cut to close-up shot ...
    """
    # Get shots — use provided shots or auto-decompose
    shots = scene.shots or auto_decompose_shots(
        scene.description, scene.dialogue, scene.duration, characters,
    )

    # Generic bracket notation override — takes precedence over genre routing
    if use_bracket_notation:
        return _compose_bracket_notation(scene, characters, image_label_map, shots)

    # Route to genre-specific composer
    if genre == "drama":
        return _compose_full_control_drama(scene, characters, image_label_map, shots)
    if genre == "meme":
        return _compose_full_control_meme(scene, characters, image_label_map, shots)
    if genre == "cinematic":
        return _compose_full_control_cinematic(scene, characters, image_label_map, shots)
    if genre == "ugc":
        return _compose_full_control_ugc(scene, characters, image_label_map, shots)
    if genre == "vfx":
        return _compose_full_control_vfx(scene, characters, image_label_map, shots)
    if genre == "anime":
        return _compose_full_control_anime(scene, characters, image_label_map, shots)

    # Default format (also used for commercial in full control)
    char_lookup = _build_char_lookup(characters)
    timestamps = _allocate_timestamps(shots, scene.duration)
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    fragments: list[str] = []
    for i, (shot, (t_start, t_end)) in enumerate(zip(shots, timestamps)):
        cam = _camera_label(shot.camera)
        desc = shot.description

        # Timestamp prefix
        frag = f"From {t_start} to {t_end} seconds, {cam}"

        # First shot: include scene description and "shown in image N"
        if i == 0:
            frag += f", a scene of {desc}"
            if scene_image_label is not None:
                frag += f" shown in image {scene_image_label}"
            # Reference all character sheets in establishing shot
            frag += _build_char_refs_text(characters)
            # Anchor & Master: repeat character descriptions verbatim
            frag += _build_anchor_master_text(characters)
        else:
            # Subsequent shots
            # Check for character reference
            matched_char: CharacterRef | None = None
            if shot.character_ref:
                matched_char = char_lookup.get(shot.character_ref.lower())

            if matched_char and matched_char.image_label:
                if shot.dialogue:
                    frag += f" on {desc}, referencing the character sheet in image {matched_char.image_label}"
                else:
                    frag += f", {desc}, referencing the character sheet in image {matched_char.image_label}"
            else:
                frag += f", {desc}"

            # Dialogue
            if shot.dialogue:
                speaker = shot.character_ref or "character"
                emotion_prefix = f" ({shot.emotion})" if shot.emotion else ""
                frag += f'{emotion_prefix}, {speaker} says: "{shot.dialogue}"'

        fragments.append(frag)

    prompt = ". Cut to ".join(fragments)

    sound = _build_sound_design(scene, genre)
    if sound:
        prompt += f"\nAudio: {sound}"

    return _trim_prompt(prompt)


# ---------------------------------------------------------------------------
# Task 6: Loose Control & Idea Mode Composers
# ---------------------------------------------------------------------------

def compose_loose_control(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    genre: str = "cinematic",
) -> str:
    """Compose a loose-control prompt: Cut to transitions, no timestamps, atmosphere mood.

    Same shot structure as full control but without timestamp prefixes.
    AI decides pacing; we provide narrative structure.

    Loose Control template (from wiki seedance-2-prompt-modes.md):
      A scene of [description]. Cut to a close-up shot of [character].
      [Character] says in a [emotion] voice: "[dialogue]"
      [Character] suddenly [action]. Cut to a shot of [result].
      No subtitles.
    """
    # Get shots
    shots = scene.shots or auto_decompose_shots(
        scene.description, scene.dialogue, scene.duration, characters,
    )

    char_lookup = _build_char_lookup(characters)

    # Detect genre for atmosphere
    resolved_genre = genre
    if not resolved_genre:
        _db = PromptDB()
        resolved_genre = _db.detect_genre(scene.description)
    atm = select_atmosphere(resolved_genre)

    scene_image_label = _find_scene_image_label(image_label_map, characters)

    fragments: list[str] = []
    for i, shot in enumerate(shots):
        cam = _camera_label(shot.camera)
        desc = shot.description

        if i == 0:
            frag = f"A scene of {desc}"
            if scene_image_label is not None:
                frag += f" shown in image {scene_image_label}"
            frag += _build_char_refs_text(characters)
            # Anchor & Master: repeat character descriptions verbatim
            frag += _build_anchor_master_text(characters)
        else:
            matched_char: CharacterRef | None = None
            if shot.character_ref:
                matched_char = char_lookup.get(shot.character_ref.lower())

            if matched_char and matched_char.image_label:
                if shot.dialogue:
                    frag = f"{cam} on {desc}, referencing the character sheet in image {matched_char.image_label}"
                else:
                    frag = f"{cam}, {desc}, referencing the character sheet in image {matched_char.image_label}"
            else:
                frag = f"{cam}, {desc}"

            # Dialogue — loose control uses "says in a [emotion] voice" style
            if shot.dialogue:
                speaker = shot.character_ref or "character"
                if shot.emotion:
                    frag += f', {speaker} says in a {shot.emotion} voice: "{shot.dialogue}"'
                else:
                    frag += f', {speaker} says: "{shot.dialogue}"'

        fragments.append(frag)

    prompt = ". Cut to ".join(fragments)

    # Add atmosphere mood at end
    mood_str = atm.get("mood", "")
    if mood_str:
        prompt += f". {mood_str.capitalize()} atmosphere"

    return _trim_prompt(prompt)


def compose_idea(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    genre: str = "cinematic",
    scene_index: int = 0,
    total_scenes: int = 1,
) -> str:
    """Compose an idea-mode prompt: high-level concept, AI decides shot structure.

    Idea Mode template (from wiki seedance-2-prompt-modes.md):
      Start with an establishing shot of [setting] shown in image one.
      Create a scene that tells a story of [narrative concept].
      No subtitles.

    Character sheet declarations up front, establishing shot reference,
    then story description enhanced with style and negative prompts.
    No timestamps, no Cut to transitions.
    """
    resolved_genre = genre
    if not resolved_genre:
        _db = PromptDB()
        resolved_genre = _db.detect_genre(scene.description)

    parts: list[str] = []

    # Character sheet declarations (Anchor & Master: include descriptions when available)
    if characters:
        char_refs = []
        for c in characters:
            if c.image_label:
                if c.description:
                    char_refs.append(f"{c.name} ({c.description}) shown in image {c.image_label}")
                else:
                    char_refs.append(f"{c.name} shown in image {c.image_label}")
        if char_refs:
            parts.append("Characters: " + ", ".join(char_refs))

    # Scene image reference — establishing shot
    scene_image_label = _find_scene_image_label(image_label_map, characters)

    if scene_image_label is not None:
        parts.append(f"Start with an establishing shot shown in image {scene_image_label}")

    # Hook from library (if available) — adds a 2-second attention grab.
    # Fetch enough hooks for all scenes and rotate by scene_index to ensure
    # different hooks across scenes instead of repeating the same one.
    if HOOKS_AVAILABLE:
        hook_pool_size = max(total_scenes, 3)
        hooks = get_hooks_for_genre(resolved_genre, hook_pool_size)
        if hooks:
            selected_hook = hooks[scene_index % len(hooks)]
            hook_text = format_hook(selected_hook, detail="the subject", action="the motion")
            parts.append(f"Opening hook: {hook_text}")

        # Lighting suggestion — also rotate across available presets
        lights = get_lighting_for_genre(resolved_genre)
        if lights:
            lp = lights[scene_index % len(lights)]
            parts.append(f"{lp.description}, {lp.kelvin}")

    # For commercial genre, keep it minimal — per wiki
    if resolved_genre == "commercial":
        parts.append(f"Generate a promotional video about {scene.description}")
    else:
        # Story description
        parts.append(f"Create a scene that tells a story of {scene.description}")

    prompt = ". ".join(parts)

    # Enhance with style and negative prompts
    prompt = enhance_with_style(prompt, resolved_genre)
    prompt = append_negative_prompts(prompt, resolved_genre)

    # Ensure it ends with No subtitles
    if not prompt.rstrip().endswith("No subtitles."):
        prompt = prompt.rstrip(". ") + ". No subtitles."

    # Trim if over limit
    if len(prompt) > _MAX_PROMPT_LEN:
        suffix = ". No subtitles."
        core = prompt[:_MAX_PROMPT_LEN - len(suffix)]
        last_period = core.rfind(".")
        if last_period > 0:
            core = core[:last_period]
        prompt = core + suffix

    return prompt


# ---------------------------------------------------------------------------
# Joey-paragraph composer (--output-shape joey-paragraph, experimental)
# ---------------------------------------------------------------------------
#
# Peer to compose_full_control / compose_loose_control / compose_idea above.
# Emits a single continuous paragraph with inline **Style & Mood**,
# **Dynamic Description**, **Static Description** bolded labels — the
# format from Joey's cinema-worldbuilder skill — instead of the
# Chinese-market bracket notation used by the genre composers.
#
# This is shape-only; the cinema-mode camera block and diegetic audio
# line still get appended downstream in compose()'s variant loop.

def compose_joey_paragraph(
    scene: DirectorScene,
    characters: list[CharacterRef],
    image_label_map: dict[int, str],
    genre: str = "cinematic",
) -> str:
    """Compose a Joey-style continuous-paragraph prompt.

    Output shape (single paragraph, inline bolded labels):

        **Style & Mood:** <register + tone>. **Dynamic Description:** <action
        across duration, multi-shot timing inline>. **Static Description:**
        <locked frame elements — characters, environment, props>. No subtitles.

    No timestamps or bracket-notation. Character references appear inside
    Static Description by name + image label so the model still binds the
    reference correctly.

    Args:
        scene: scene to compose.
        characters: character refs (used inline in Static Description).
        image_label_map: label → URL mapping for any media refs in frame.
        genre: genre used to derive the Style & Mood register sentence.

    Returns:
        Composed prompt (without cinema-mode camera block or audio line —
        those are appended by compose()'s variant loop).
    """
    # Style & Mood — short genre-flavored sentence.
    genre_register = {
        "cinematic": "Cinematic realism with patient observational framing.",
        "commercial": "Clean commercial register, product-forward composition.",
        "meme": "Mockumentary deadpan with hyperrealistic textures.",
        "ugc": "First-person vlog register, natural handheld energy.",
        "anime": "Hand-drawn anime composition with cel-shaded clarity.",
        "drama": "Mini-drama emotional register with tight cuts.",
        "vfx": "Surreal scale shift, photoreal effects integration.",
    }.get(genre, "Cinematic realism with patient observational framing.")

    style_mood = genre_register

    # Dynamic Description — what happens. If the scene has structured
    # shots with duration hints, surface them with inline timing.
    if scene.shots and scene.duration:
        timestamps = _allocate_timestamps(scene.shots, scene.duration)
        beats: list[str] = []
        for i, (shot, (t_start, t_end)) in enumerate(
            zip(scene.shots, timestamps), start=1,
        ):
            beat = f"Shot {i} ({t_start}–{t_end}s): {shot.description}"
            if shot.dialogue:
                speaker = shot.character_ref or "the figure"
                beat += f". {speaker} says: \"{shot.dialogue}\""
            beats.append(beat)
        dynamic = " Hard cut to ".join(beats)
    else:
        dynamic = scene.description

    # Static Description — characters + environment locked elements.
    static_parts: list[str] = []
    if characters:
        char_refs: list[str] = []
        for c in characters:
            if c.image_label:
                desc = f" ({c.description})" if c.description else ""
                char_refs.append(
                    f"{c.name}{desc} shown in image {c.image_label}",
                )
        if char_refs:
            static_parts.append("Characters: " + "; ".join(char_refs))

    # Any non-character scene-image references are listed too.
    scene_image_label = _find_scene_image_label(image_label_map, characters)
    if scene_image_label is not None:
        static_parts.append(f"Scene reference in image {scene_image_label}")

    # The scene description doubles as environment when no shots structure
    # was provided. When shots ARE present, the description still belongs
    # in static so the model has continuity context across the cuts.
    if scene.shots:
        static_parts.append(scene.description)

    static = ". ".join(static_parts) if static_parts else scene.description

    # Compose continuous paragraph with inline bolded labels.
    prompt = (
        f"**Style & Mood:** {style_mood} "
        f"**Dynamic Description:** {dynamic}. "
        f"**Static Description:** {static}."
    )

    # Genre-specific style/negative prompt enhancers, same as other
    # composers, so the same hardening applies regardless of shape.
    prompt = enhance_with_style(prompt, genre)
    prompt = append_negative_prompts(prompt, genre)

    # Ensure "No subtitles." is present (also handled later by
    # sanitize_for_seedance, but include here so the body reads complete
    # when inspected pre-sanitize).
    if not _NO_SUBTITLES_RE.search(prompt):
        prompt = prompt.rstrip(". ") + ". No subtitles."

    if len(prompt) > _MAX_PROMPT_LEN:
        suffix = ". No subtitles."
        core = prompt[:_MAX_PROMPT_LEN - len(suffix)]
        last_period = core.rfind(".")
        if last_period > 0:
            core = core[:last_period]
        prompt = core + suffix
    return prompt


# Module-level compile so compose_joey_paragraph isn't recompiling each call.
_NO_SUBTITLES_RE = re.compile(r"\bno\s+subtitles?\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Task 10: Director compose() Entry Point
# ---------------------------------------------------------------------------

class SeedancePromptDirector:
    """Orchestrates Seedance 2.0 prompt composition at three control levels.

    Main entry point: compose() takes scenes + characters → returns DirectorResult
    with composed prompts, chain plan, reference validation, and variant selection.

    Genre-aware: auto-detects or accepts genre parameter to select the right
    prompt template (Director Brief, bracket notation, 3-shot punchline, etc.)
    """

    def __init__(self, config: DirectorConfig):
        self.config = config
        try:
            self._db = PromptDB()
        except Exception:
            self._db = None

    def _resolve_genre(self, description: str, override: str | None = None) -> str:
        """Resolve genre: config override > parameter override > auto-detect."""
        if self.config.genre:
            return self.config.genre
        if override:
            return override
        # Try PromptDB first, then our keyword-based detector
        if self._db:
            try:
                return self._db.detect_genre(description)
            except Exception:
                pass
        return detect_genre(description)

    def compose(
        self,
        scenes: list[DirectorScene],
        characters: list[CharacterRef],
        project_description: str,
        genre: str | None = None,
    ) -> DirectorResult:
        """Main entry point. Detect → compose → validate → select.

        Pipeline: genre detection → mode selection → genre-aware composition
        → auto-fix → sanitize → score → select best variant.
        """
        # Detect genre
        resolved_genre = self._resolve_genre(project_description, genre)

        # Determine control level — use auto_select_mode if not overridden
        global_level = self.config.control_level
        if not global_level:
            # Check if scenes provide enough signal for auto_select_mode
            has_timestamps = any(s.shots for s in scenes)
            has_dialogue = any(s.dialogue for s in scenes)
            has_concept_only = (
                not has_timestamps
                and not has_dialogue
                and all(not s.media_roles for s in scenes)
            )
            global_level = auto_select_mode(
                resolved_genre,
                has_timestamps=has_timestamps,
                has_dialogue=has_dialogue,
                has_concept_only=has_concept_only,
            )

        # Build chain plan
        chain_plan = build_chain_plan(scenes) if self.config.enable_chaining else None

        # Compose each scene
        composed_scenes: list[ComposedScene] = []
        all_variants: dict[int, list[str]] = {}
        selected_levels: dict[int, ControlLevel] = {}
        warnings: list[str] = []
        all_ref_checks: list = []

        for scene in scenes:
            # Per-scene genre (override > global)
            scene_genre = scene.genre or resolved_genre

            # Per-scene control level (override > global)
            level = scene.control_level or global_level

            # Assign image labels
            label_map, updated_chars = assign_image_labels(
                scene.media_roles, characters,
            )

            # Generate variants — pass genre to composers
            variants: list[tuple[ControlLevel, str]] = []
            scene_idx = scenes.index(scene)
            num_scenes = len(scenes)
            def _compose(lvl: ControlLevel, sc: DirectorScene, chars: list[CharacterRef], lm: dict[int, str], g: str) -> str:
                # Joey-paragraph shape (experimental) bypasses the genre +
                # control-level matrix entirely — it's a single peer format
                # for English-market workflows. Bracket notation (default)
                # routes through the existing genre-specific composers.
                if self.config.output_shape == "cinema-worldbuilder":
                    from cinema_worldbuilder import build_cinema_worldbuilder_prompt
                    import os
                    # Feed the RAW scene description (with [0-Xs] beats) — NOT
                    # the composed joey-paragraph, which already carries its
                    # own labels/shots and would double up when re-parsed.
                    # Character identity goes into the static description by
                    # visual description only (the skill's no-name rule).
                    raw = sc.description
                    static = "; ".join(
                        c.description.strip()
                        for c in chars
                        if getattr(c, "description", None)
                    ) or None
                    mode = os.environ.get("VC_JOEY_CINEMA_MODE", "auto")
                    runtime = int(getattr(sc, "duration", None) or 15)
                    return build_cinema_worldbuilder_prompt(
                        raw, mode, runtime, static_description=static,
                    )
                if self.config.output_shape == "joey-paragraph":
                    return compose_joey_paragraph(sc, chars, lm, genre=g)
                if lvl == ControlLevel.FULL:
                    return compose_full_control(sc, chars, lm, genre=g)
                elif lvl == ControlLevel.LOOSE:
                    return compose_loose_control(sc, chars, lm, genre=g)
                else:
                    return compose_idea(sc, chars, lm, genre=g, scene_index=scene_idx, total_scenes=num_scenes)

            if self.config.max_variants >= 2 and level != ControlLevel.IDEA:
                # Generate primary + alternative
                primary = _compose(level, scene, updated_chars, label_map, scene_genre)
                variants.append((level, primary))
                # Alternative: one level down (FULL→LOOSE, LOOSE→IDEA)
                alt_level = {
                    ControlLevel.FULL: ControlLevel.LOOSE,
                    ControlLevel.LOOSE: ControlLevel.IDEA,
                }.get(level, ControlLevel.IDEA)
                alt = _compose(alt_level, scene, updated_chars, label_map, scene_genre)
                variants.append((alt_level, alt))
            else:
                primary = _compose(level, scene, updated_chars, label_map, scene_genre)
                variants.append((level, primary))

            # Reference validation (Tier 1 — heuristic)
            if self.config.enable_reference_validation and scene.media_roles:
                for _var_level, var_prompt in variants:
                    ref_checks = validate_references_heuristic(
                        var_prompt, scene.media_roles, scene.scene_number,
                    )
                    all_ref_checks.extend(ref_checks)

            # Critique each variant and score
            scored: list[tuple[float, ControlLevel, str]] = []
            for var_level, var_prompt in variants:
                char_dicts = [
                    {"name": c.name, "image_label": c.image_label}
                    for c in updated_chars
                ]
                media_count = len(label_map)
                crit = critique_prompt(
                    var_prompt,
                    scene_number=scene.scene_number,
                    duration=scene.duration,
                    media_count=media_count,
                    characters=char_dicts if char_dicts else None,
                )
                # Auto-fix: clean keyword soup, vague lighting, discrete
                # actions, and append missing exclusions regardless of
                # whether the critique passed — auto_fix_prompt applies
                # pattern-based rewrites that go beyond critique issues.
                # SKIPPED for cinema-worldbuilder: its canonical camera
                # blocks are verbatim from the skill and must not be
                # rewritten (e.g. auto-fix mangling "oval bokeh" inside the
                # ARRI block). Age/name sanitization is already applied
                # inside cinema_worldbuilder.py before this point.
                if self.config.output_shape != "cinema-worldbuilder":
                    var_prompt = auto_fix_prompt(
                        var_prompt, crit,
                        char_dicts if char_dicts else None,
                    )
                # Joey-skill additions: diegetic audio + photoreal closer.
                # Both default-on via DirectorConfig; opt-out per config.
                # SKIPPED for cinema-worldbuilder: that shape is already a
                # self-contained format with its own diegetic audio line and
                # a canonical camera/grade block — appending the legacy closer
                # would double the audio line and contradict the film stock.
                if self.config.output_shape != "cinema-worldbuilder":
                    if self.config.append_diegetic_audio:
                        audio_line = build_diegetic_audio(scene.description)
                        if audio_line and audio_line not in var_prompt:
                            # Insert before the photoreal closer (if any) by
                            # appending to body; the closer goes after.
                            var_prompt = f"{var_prompt.rstrip()}\n\n{audio_line}"
                    if self.config.append_photoreal_closer:
                        var_prompt = append_photoreal_closer(
                            var_prompt,
                            register=self.config.photoreal_register,
                            strict=self.config.photoreal_closer_strict,
                        )
                # Score: prefer passing, shorter, and primary level
                score = 0.0
                if crit.passed:
                    score += 50
                score += max(0, (1200 - len(var_prompt)) / 1200 * 30)
                if var_level == level:
                    score += 20  # Prefer detected/selected level
                scored.append((score, var_level, var_prompt))

            scored.sort(key=lambda x: x[0], reverse=True)

            # Selection
            if self.config.selection_mode == "review":
                all_variants[scene.scene_number] = [v[2] for v in scored]
                # Use best as default, user can override
                _best_score, best_level, best_prompt = scored[0]
            else:
                # Auto: pick best
                _best_score, best_level, best_prompt = scored[0]

            selected_levels[scene.scene_number] = best_level

            # Sanitize: strip violent/combat language that triggers Seedance
            # content filters.  Must run AFTER auto_fix_prompt (which cleans
            # keyword soup / vague lighting) so both passes compose cleanly.
            best_prompt = self.sanitize_for_seedance(
                best_prompt, language=self.config.language,
            )

            # Content filter warnings
            scene_warnings = self._check_content_warnings(best_prompt, scene)
            warnings.extend(scene_warnings)

            # Build media_files list in label order
            media_files = [label_map[k] for k in sorted(label_map.keys())]

            # Determine mode
            mode = "frames-to-video" if media_files else "text-to-video"

            # Determine chain group
            scene_chain_group = None
            if chain_plan:
                for g in chain_plan.groups:
                    if scene.scene_number in g.scene_numbers:
                        scene_chain_group = g.group_id
                        break

            composed_scenes.append(ComposedScene(
                scene_number=scene.scene_number,
                submission_prompt=best_prompt,
                control_level=best_level,
                mode=mode,
                media_files=media_files,
                image_label_map=label_map,
                duration=scene.duration,
                chain_group=scene_chain_group,
            ))

        ref_report = ReferenceReport(checks=all_ref_checks) if all_ref_checks else None

        return DirectorResult(
            scenes=composed_scenes,
            chain_plan=chain_plan,
            reference_report=ref_report,
            variants=all_variants if all_variants else None,
            selected_control_levels=selected_levels,
            warnings=warnings,
        )

    @staticmethod
    def sanitize_for_seedance(prompt: str, language: str = "English") -> str:
        """Sanitize prompt for Seedance content filters.

        Improvements from wiki seedance-2-content-filters.md:
        1. Remove violent/combat language that triggers content filters
        2. Auto-append "No subtitles." if not present
        3. Add language anchor ("Speaking in {language}.") to prevent spontaneous switching
        4. Warn-level checks for celebrity resemblance (handled in _check_content_warnings)
        """
        import re
        # Phrases that trigger content filters on Seedance/xskill.ai
        _FILTER_PHRASES = [
            r"intense combat energy",
            r"motion blur on impacts",
            r"dynamic fast-paced action",
            r"devastating.*blow",
            r"explosive impact",
            r"bone-cracking",
            r"battle cries",
            r"blood",
            r"killing",
            r"murder",
            r"weapon.*slash",
            r"brutal",
            r"violent",
            r"gore",
        ]
        result = prompt
        for phrase in _FILTER_PHRASES:
            result = re.sub(phrase, "", result, flags=re.IGNORECASE)

        # Clean up double spaces and trailing commas
        result = re.sub(r",\s*,", ",", result)
        result = re.sub(r"\s{2,}", " ", result)
        result = result.strip()

        # Auto-append "No subtitles." if not present
        if not re.search(r"\bno\s+subtitles?\b", result, re.IGNORECASE):
            if result and not result.endswith((".", "!", "?")):
                result += "."
            result += " No subtitles."

        # Language anchor: append "Speaking in {language}." to reduce spontaneous switching
        # Only add if dialogue is present (contains "says" or quotes) and no language is specified
        has_dialogue = bool(re.search(r'says[:\s]|"[^"]+?"', result))
        lang_pattern = re.compile(r"\b(?:speaking|spoken)\s+in\s+\w+", re.IGNORECASE)
        if has_dialogue and not lang_pattern.search(result):
            # Insert before "No subtitles." if present
            no_sub_match = re.search(r"\s*No\s+subtitles?\.\s*$", result, re.IGNORECASE)
            if no_sub_match:
                insert_pos = no_sub_match.start()
                result = result[:insert_pos] + f" Speaking in {language}." + result[insert_pos:]
            else:
                result = result.rstrip()
                if not result.endswith("."):
                    result += "."
                result += f" Speaking in {language}."

        return result.strip()

    @staticmethod
    def _check_content_warnings(prompt: str, scene: DirectorScene) -> list[str]:
        """Generate content warnings for potential filter triggers.

        Checks from wiki seedance-2-content-filters.md:
        1. Celebrity resemblance warning
        2. Dialogue length check (>15 words per line)
        3. Character without reference sheet warning
        """
        warnings: list[str] = []

        # Celebrity resemblance — common famous names that trigger Seedance filter
        _CELEBRITY_NAMES = re.compile(
            r"\b(?:taylor\s+swift|beyonce|elon\s+musk|trump|obama|"
            r"scarlett\s+johansson|brad\s+pitt|leonardo\s+dicaprio|"
            r"tom\s+cruise|angelina\s+jolie|jennifer\s+aniston|"
            r"chris\s+hemsworth|keanu\s+reeves|margot\s+robbie)\b",
            re.IGNORECASE,
        )
        celeb_match = _CELEBRITY_NAMES.search(prompt)
        if celeb_match:
            warnings.append(
                f"Scene {scene.scene_number}: Celebrity resemblance detected "
                f"('{celeb_match.group(0)}'). Seedance will likely reject this — "
                f"redesign character to reduce resemblance."
            )

        # Dialogue length check — lines >15 words get truncated or repeated
        dialogue_pattern = re.compile(r'"([^"]+)"')
        for match in dialogue_pattern.finditer(prompt):
            line = match.group(1)
            word_count = len(line.split())
            if word_count > 15:
                warnings.append(
                    f"Scene {scene.scene_number}: Dialogue line is {word_count} words "
                    f"(max recommended: 15). Line may be truncated: "
                    f"'{line[:50]}...'"
                )

        return warnings

    def compose_single(
        self,
        scene: DirectorScene,
        characters: list[CharacterRef],
        genre: str,
    ) -> ComposedScene:
        """Single scene composition — used by chain execution.

        Note: compose() already applies auto_fix_prompt + sanitize_for_seedance,
        so no additional sanitization is needed here.
        """
        result = self.compose([scene], characters, scene.description, genre=genre)
        return result.scenes[0]


# ---------------------------------------------------------------------------
# Task 11: CLI Entry Point
# ---------------------------------------------------------------------------

def _cli():
    """CLI entry point for the Prompt Director."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Seedance 2.0 Prompt Director",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # compose
    compose_parser = subparsers.add_parser("compose", help="Compose prompts")
    compose_parser.add_argument("--input", required=True, help="JSON input file")
    compose_parser.add_argument("--control-level", choices=["full", "loose", "idea", "auto"], default="auto")
    compose_parser.add_argument("--selection-mode", choices=["auto", "review", "ab_test"], default="auto")
    compose_parser.add_argument("--max-variants", type=int, default=2)
    compose_parser.add_argument("--genre", choices=list(SUPPORTED_GENRES) + ["auto"], default="auto",
                                help="Genre for prompt formatting (auto-detected if not specified)")
    compose_parser.add_argument("--language", default="English", help="Language anchor for dialogue")

    # detect
    detect_parser = subparsers.add_parser("detect", help="Detect control level")
    detect_parser.add_argument("--input", required=True, help="JSON scenes file")

    # validate-refs
    validate_parser = subparsers.add_parser("validate-refs", help="Validate references")
    validate_parser.add_argument("--input", required=True, help="JSON scenes file")

    args = parser.parse_args()

    if args.command == "compose":
        with open(args.input) as f:
            data = json.load(f)

        scenes = [
            DirectorScene(
                scene_number=s["scene_number"],
                description=s["description"],
                duration=s.get("duration", 15),
                dialogue=s.get("dialogue"),
                media_roles=s.get("media_roles"),
                continues_from_previous=s.get("continues_from_previous", False),
            )
            for s in data["scenes"]
        ]
        characters = [
            CharacterRef(
                name=c["name"], sheet_image=c["sheet_image"],
                description=c.get("description"),
            )
            for c in data.get("characters", [])
        ]

        control = None if args.control_level == "auto" else ControlLevel(args.control_level)
        # Genre/language: CLI args take precedence, then JSON input fields, then auto-detect
        genre_override = None if args.genre == "auto" else args.genre
        if genre_override is None and data.get("genre"):
            genre_override = data["genre"]
        language = args.language
        if language == "English" and data.get("language"):
            language = data["language"]
        config = DirectorConfig(
            control_level=control,
            selection_mode=args.selection_mode,
            max_variants=args.max_variants,
            genre=genre_override,
            language=language,
            # Hydrate Joey-flag fields from VC_JOEY_* env vars when the TS
            # executor is driving this run. When invoked standalone, no
            # VC_JOEY_* vars are set and the DirectorConfig defaults apply.
            **joey_flags_from_env(),
        )
        director = SeedancePromptDirector(config)
        result = director.compose(
            scenes, characters, data.get("project_description", ""),
            genre=genre_override,
        )

        output = {
            "scenes": [
                {
                    "scene_number": s.scene_number,
                    "submission_prompt": s.submission_prompt,
                    "control_level": s.control_level.value,
                    "mode": s.mode,
                    "media_files": s.media_files,
                    "image_label_map": {str(k): v for k, v in s.image_label_map.items()},
                    "duration": s.duration,
                }
                for s in result.scenes
            ],
            "chain_plan": result.chain_plan.to_dict() if result.chain_plan else None,
            "reference_report": result.reference_report.to_dict() if result.reference_report else None,
            "variants": result.variants,
            "selected_control_levels": {
                str(k): v.value for k, v in result.selected_control_levels.items()
            },
            "warnings": result.warnings,
        }
        print(json.dumps(output, indent=2))

    elif args.command == "detect":
        with open(args.input) as f:
            data = json.load(f)
        scenes = [
            DirectorScene(
                scene_number=s["scene_number"],
                description=s["description"],
                duration=s.get("duration", 15),
                dialogue=s.get("dialogue"),
                media_roles=s.get("media_roles"),
            )
            for s in data["scenes"]
        ]
        level = detect_control_level(scenes)
        print(json.dumps({"control_level": level.value}))

    elif args.command == "validate-refs":
        with open(args.input) as f:
            data = json.load(f)
        all_checks = []
        for s in data["scenes"]:
            if s.get("media_roles"):
                checks = validate_references_heuristic(
                    s.get("seedance_prompt", s["description"]),
                    s["media_roles"],
                    s["scene_number"],
                )
                all_checks.extend(checks)
        report = ReferenceReport(checks=all_checks)
        print(json.dumps(report.to_dict(), indent=2))


if __name__ == "__main__":
    _cli()
