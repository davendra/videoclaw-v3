#!/usr/bin/env python3
"""
Seedance 2.0 Pre-Submission Prompt Critique.

Validates individual Seedance prompts against known constraints BEFORE
submission.  Catches issues like content-filter risks, duration-complexity
mismatches, incomplete @ references, conflicting camera instructions, and
prompt length concerns.

All checks are local pattern-matching -- no API calls, no LLM calls.
The module produces a structured report; nothing is fatal at the pipeline
level.

Usage:
    from seedance_prompt_critique import critique_prompt

    result = critique_prompt(
        prompt="@image1 Camera pushes in on a villa at golden hour...",
        scene_number=3,
        duration=8,
        media_count=1,
    )
    if not result.passed:
        for issue in result.issues:
            print(f"[{issue.severity}] {issue.category}: {issue.message}")

CLI:
    python3 seedance_prompt_critique.py critique "<prompt>" --duration 8
    python3 seedance_prompt_critique.py critique-queue --queue queue.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure scripts/video/ is importable (same pattern as other modules)
# ---------------------------------------------------------------------------
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# ---------------------------------------------------------------------------
# Imports from siblings — graceful fallbacks
# ---------------------------------------------------------------------------

try:
    from seedance_client import pre_validate_prompt as _upstream_pre_validate
except ImportError:
    _upstream_pre_validate = None

try:
    from seedance_prompt_builder import CAMERA_VOCABULARY
except ImportError:
    CAMERA_VOCABULARY = {}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# xskill.ai has no documented hard limit; Volcengine caps at 500.
# For xskill.ai, warn at 800 and error at 1200 to keep prompts focused.
_PROMPT_MAX_LENGTH = 1200
# Leave margin — warn above this threshold
_PROMPT_WARN_LENGTH = 800

# Action verbs (English + Chinese) that imply motion complexity.
# Allow common inflections: -s, -es, -ed, -ing (e.g. walks, jumping, dashed).
_ACTION_VERBS_EN = re.compile(
    r"\b(?:walk|run|jump|spin|turn|dance|fight|push|pull|pan|orbit|"
    r"fly|climb|fall|throw|catch|kick|punch|slide|roll|flip|dive|"
    r"leap|crawl|sprint|rush|dash|swing|lift|drop|shake|explode|"
    r"crash|collide|chase|dodge|strike|slash|block|parry)"
    r"(?:s|es|ed|ing|ned|ped|bed)?\b",
    re.IGNORECASE,
)
_ACTION_VERBS_ZH = re.compile(r"[走跑跳转舞飞爬打踢推拉滑翻冲撞追闪击挡]")

# Time-segment pattern: "0-3s", "4s-8s", "0:00-0:03", etc.
_TIME_SEGMENT_PATTERN = re.compile(
    r"(\d+)\s*[-–]\s*(\d+)\s*s\b"
    r"|(\d+)s\s*[-–]\s*(\d+)s\b"
    r"|(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)",
    re.IGNORECASE,
)

# Media reference pattern: @image1, @video2, @audio3, @image_file_1, etc.
_MEDIA_REF_PATTERN = re.compile(r"@(?:image|video|audio)(?:_file_)?\d+", re.IGNORECASE)

# Exclusion keywords commonly appended to Seedance prompts
_EXCLUSION_KEYWORDS = re.compile(
    r"\b(?:no\s+text|no\s+watermark|no\s+logo|no\s+subtitle|"
    r"no\s+abrupt|no\s+cuts|no\s+letters|no\s+words|"
    r"without\s+text|without\s+watermark|without\s+logo)\b",
    re.IGNORECASE,
)

# Camera movement terms for conflict detection (English text patterns)
_STATIC_CAMERA_PATTERN = re.compile(
    r"\b(?:static\s+camera|camera\s+(?:is\s+)?(?:fixed|locked|stationary|still)|"
    r"fixed\s+(?:camera|shot|frame)|locked\s+(?:off|down)\s+camera|"
    r"no\s+camera\s+(?:movement|motion))\b",
    re.IGNORECASE,
)

_MOVEMENT_CAMERA_PATTERN = re.compile(
    r"\b(?:orbit(?:s|ing)?|pan(?:s|ning)?|tilt(?:s|ing)?|dolly(?:ing)?|"
    r"tracking|push(?:es)?\s+in|pull(?:s)?\s+back|crane|fly\s+through|"
    r"arc(?:s|ing)?|sweep(?:s|ing)?|zoom(?:s|ing)?|whip\s+pan|"
    r"steadicam|handheld)\b",
    re.IGNORECASE,
)

# Contradictory camera pairs (if both appear, flag a conflict)
_CAMERA_CONTRADICTIONS: list[tuple[re.Pattern, re.Pattern, str]] = [
    (
        re.compile(r"\bpush(?:es)?\s+in\b", re.IGNORECASE),
        re.compile(r"\bpull(?:s)?\s+back\b", re.IGNORECASE),
        "push in + pull back",
    ),
    (
        re.compile(r"\bzoom\s+in\b", re.IGNORECASE),
        re.compile(r"\bzoom\s+out\b", re.IGNORECASE),
        "zoom in + zoom out",
    ),
    (
        re.compile(r"\bcrane\s+up\b", re.IGNORECASE),
        re.compile(r"\bcrane\s+down\b", re.IGNORECASE),
        "crane up + crane down",
    ),
    (
        re.compile(r"\bdolly\s+forward\b", re.IGNORECASE),
        re.compile(r"\bdolly\s+backward\b", re.IGNORECASE),
        "dolly forward + dolly backward",
    ),
]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class CritiqueIssue:
    """A single validation issue found in a prompt."""
    severity: str   # 'info' | 'warning' | 'error'
    category: str   # 'content_filter' | 'duration' | 'references' | 'camera' | 'complexity' | 'length'
    message: str


@dataclass
class PromptCritique:
    """Result of validating a single Seedance prompt."""
    prompt: str
    scene_number: int
    issues: list[CritiqueIssue] = field(default_factory=list)
    content_risk: str = "none"  # 'none' | 'low' | 'medium' | 'high'

    @property
    def passed(self) -> bool:
        """True if no error-level issues were found."""
        return not any(i.severity == "error" for i in self.issues)

    def to_dict(self) -> dict:
        """Serialize to JSON-friendly dict."""
        return {
            "scene_number": self.scene_number,
            "passed": self.passed,
            "content_risk": self.content_risk,
            "issues": [
                {"severity": i.severity, "category": i.category, "message": i.message}
                for i in self.issues
            ],
        }


# ---------------------------------------------------------------------------
# Fallback content-risk checker (when seedance_client is not importable)
# ---------------------------------------------------------------------------

# Simplified HIGH-risk keywords (subset of seedance_client._CELEBRITY_IP_PATTERNS)
_FALLBACK_HIGH_PATTERNS = re.compile(
    r"\b(?:taylor\s+swift|beyonce|elon\s+musk|donald\s+trump|"
    r"spider[- ]?man|iron\s+man|batman|superman|mickey\s+mouse|"
    r"harry\s+potter|darth\s+vader|mario|pikachu|goku|naruto|"
    r"marvel|avengers|star\s+wars|disney)\b",
    re.IGNORECASE,
)
_FALLBACK_MEDIUM_PATTERNS = re.compile(
    r"(?:™|®|©)|"
    r"\b(?:nude|naked|nsfw|deepfake|blood(?:y|ied)?|gore|"
    r"president|dictator|regime)\b",
    re.IGNORECASE,
)


def _fallback_pre_validate(prompt: str) -> list[dict]:
    """Simplified content risk check when seedance_client is unavailable."""
    warnings: list[dict] = []
    m = _FALLBACK_HIGH_PATTERNS.search(prompt)
    if m:
        warnings.append({
            "level": "HIGH",
            "reason": "Celebrity/IP name detected",
            "match": m.group(0),
        })
    m = _FALLBACK_MEDIUM_PATTERNS.search(prompt)
    if m:
        warnings.append({
            "level": "MEDIUM",
            "reason": "Potential content filter trigger",
            "match": m.group(0),
        })
    return warnings


# ---------------------------------------------------------------------------
# Core critique function
# ---------------------------------------------------------------------------

def critique_prompt(
    prompt: str,
    scene_number: int = 0,
    duration: int = 8,
    media_count: int = 0,
    characters: list[dict] | None = None,
) -> PromptCritique:
    """Validate a single Seedance prompt before submission.

    Checks:
        1. Content filter risk (via pre_validate_prompt or fallback)
        2. Duration-complexity match (actions vs available time)
        3. @ reference completeness (refs vs media_count)
        4. Camera instruction conflicts (contradictory movements)
        5. Prompt length (warn > 400 chars, error > 500)
        6. Missing exclusion declarations (no negative prompt)
        7. Character reference completeness (characters with sheets referenced by image label)

    Args:
        prompt: The Seedance prompt text.
        scene_number: Scene index for reporting.
        duration: Requested video duration in seconds.
        media_count: Number of media files that will be attached.
        characters: Optional list of character dicts with 'name' and 'image_label' keys.

    Returns:
        PromptCritique with all detected issues.
    """
    result = PromptCritique(prompt=prompt, scene_number=scene_number)

    # 1. Content filter risk
    _check_content_filter(prompt, result)

    # 2. Duration-complexity match
    _check_duration_complexity(prompt, duration, result)

    # 3. @ reference completeness
    _check_references(prompt, media_count, result)

    # 4. Camera instruction conflicts
    _check_camera_conflicts(prompt, result)

    # 5. Prompt length
    _check_prompt_length(prompt, result)

    # 6. Missing exclusion declarations
    _check_missing_exclusion(prompt, result)

    # 7. Character reference completeness
    if characters:
        _check_character_references(prompt, characters, result)

    # 8. Emergence without empty-state reference
    _check_emergence_pattern(prompt, media_count, result)

    # 9. Dialogue line length (>15 words may be truncated)
    _check_dialogue_length(prompt, result)

    return result


# ---------------------------------------------------------------------------
# Individual check implementations
# ---------------------------------------------------------------------------

def _check_content_filter(prompt: str, result: PromptCritique) -> None:
    """Check 1: Content filter risk."""
    validate_fn = _upstream_pre_validate or _fallback_pre_validate
    warnings = validate_fn(prompt)

    if not warnings:
        result.content_risk = "none"
        return

    # Determine highest risk level
    levels = {w["level"].upper() for w in warnings}
    if "HIGH" in levels:
        result.content_risk = "high"
    elif "MEDIUM" in levels:
        result.content_risk = "medium"
    else:
        result.content_risk = "low"

    for w in warnings:
        level = w["level"].upper()
        match = w.get("match", "")
        reason = w.get("reason", "Content filter risk")
        if level == "HIGH":
            result.issues.append(CritiqueIssue(
                "error", "content_filter",
                f"High content filter risk: {reason} (matched: {match!r})",
            ))
        elif level == "MEDIUM":
            result.issues.append(CritiqueIssue(
                "warning", "content_filter",
                f"Medium content filter risk: {reason} (matched: {match!r})",
            ))
        else:
            result.issues.append(CritiqueIssue(
                "info", "content_filter",
                f"Low content filter risk: {reason} (matched: {match!r})",
            ))


def _check_duration_complexity(prompt: str, duration: int, result: PromptCritique) -> None:
    """Check 2: Duration vs action complexity."""
    # Count action verbs
    en_actions = _ACTION_VERBS_EN.findall(prompt)
    zh_actions = _ACTION_VERBS_ZH.findall(prompt)
    total_actions = len(en_actions) + len(zh_actions)

    # Too many actions for the duration
    threshold = max(2, int(duration * 1.5))
    if total_actions > threshold:
        result.issues.append(CritiqueIssue(
            "warning", "complexity",
            f"Too many actions ({total_actions}) for {duration}s duration "
            f"(max recommended: {threshold}). Simplify or increase duration.",
        ))

    # Check time segments for overrun
    total_segment_seconds = 0
    for m in _TIME_SEGMENT_PATTERN.finditer(prompt):
        groups = m.groups()
        if groups[0] is not None and groups[1] is not None:
            # "0-3s" format
            start, end = int(groups[0]), int(groups[1])
        elif groups[2] is not None and groups[3] is not None:
            # "4s-8s" format
            start, end = int(groups[2]), int(groups[3])
        elif groups[4] is not None and groups[7] is not None:
            # "0:00-0:03" format
            start = int(groups[4]) * 60 + int(groups[5])
            end = int(groups[6]) * 60 + int(groups[7])
        else:
            continue
        total_segment_seconds = max(total_segment_seconds, end)

    if total_segment_seconds > duration:
        result.issues.append(CritiqueIssue(
            "error", "duration",
            f"Time segments total {total_segment_seconds}s but video duration is "
            f"only {duration}s. Segments will be cut off.",
        ))


def _check_references(prompt: str, media_count: int, result: PromptCritique) -> None:
    """Check 3: @ reference completeness."""
    refs = _MEDIA_REF_PATTERN.findall(prompt)
    ref_count = len(refs)

    if ref_count > 0 and media_count == 0:
        result.issues.append(CritiqueIssue(
            "error", "references",
            f"Prompt references {ref_count} media ({', '.join(refs)}) "
            f"but no media files are attached (media_count=0).",
        ))
    elif ref_count > media_count and media_count > 0:
        result.issues.append(CritiqueIssue(
            "warning", "references",
            f"Prompt references {ref_count} media ({', '.join(refs)}) "
            f"but only {media_count} media file(s) available.",
        ))


def _check_camera_conflicts(prompt: str, result: PromptCritique) -> None:
    """Check 4: Camera instruction conflicts."""
    has_static = _STATIC_CAMERA_PATTERN.search(prompt)
    has_movement = _MOVEMENT_CAMERA_PATTERN.search(prompt)

    # Static + any movement = conflict
    if has_static and has_movement:
        result.issues.append(CritiqueIssue(
            "warning", "camera",
            f"Conflicting camera instructions: static/fixed camera + "
            f"movement ({has_movement.group(0)!r}). Remove one.",
        ))

    # Check contradictory movement pairs
    for pat_a, pat_b, label in _CAMERA_CONTRADICTIONS:
        if pat_a.search(prompt) and pat_b.search(prompt):
            result.issues.append(CritiqueIssue(
                "warning", "camera",
                f"Contradictory camera movements: {label}. "
                f"Use only one direction per scene.",
            ))


def _check_prompt_length(prompt: str, result: PromptCritique) -> None:
    """Check 5: Prompt length."""
    length = len(prompt)
    if length > _PROMPT_MAX_LENGTH:
        result.issues.append(CritiqueIssue(
            "error", "length",
            f"Prompt is {length} characters, exceeding the {_PROMPT_MAX_LENGTH} "
            f"character API limit. Trim by {length - _PROMPT_MAX_LENGTH} chars.",
        ))
    elif length > _PROMPT_WARN_LENGTH:
        result.issues.append(CritiqueIssue(
            "warning", "length",
            f"Prompt is {length} characters (warn threshold: {_PROMPT_WARN_LENGTH}). "
            f"Close to the {_PROMPT_MAX_LENGTH} char API limit.",
        ))


def _check_missing_exclusion(prompt: str, result: PromptCritique) -> None:
    """Check 6: Missing exclusion / negative prompt declarations."""
    if not _EXCLUSION_KEYWORDS.search(prompt):
        result.issues.append(CritiqueIssue(
            "info", "content_filter",
            "No exclusion keywords found (e.g. 'no text', 'no watermark'). "
            "Consider adding negative prompts for cleaner output.",
        ))


def _check_character_references(
    prompt: str,
    characters: list[dict],
    result: PromptCritique,
) -> None:
    """Check: Every character with a sheet must be referenced by image label."""
    if not characters:
        return
    for char in characters:
        name = char.get("name", "")
        label = char.get("image_label")
        if label is None:
            continue
        label_patterns = [
            f"image {label}",
            f"image{label}",
        ]
        found = any(p in prompt.lower() for p in label_patterns)
        if not found:
            result.issues.append(CritiqueIssue(
                "error", "character_ref",
                f"Character '{name}' has a sheet (image {label}) "
                f"but it is not referenced in the prompt.",
            ))


def _check_emergence_pattern(
    prompt: str,
    media_count: int,
    result: PromptCritique,
) -> None:
    """Check: Scenes describing something 'appearing' should have an empty-state ref.

    From wiki reference-image-behavior.md (the sandworm lesson):
    If something needs to appear or emerge, include a reference of the scene
    WITHOUT that thing. Reference images define the starting visual state.
    """
    if not _EMERGENCE_PATTERN.search(prompt):
        return
    # If the prompt describes emergence but has reference images, the user
    # should be aware that refs show the starting state
    if media_count > 0:
        result.issues.append(CritiqueIssue(
            "info", "references",
            "Prompt describes something appearing/emerging. Ensure reference images "
            "show the scene WITHOUT the emerging element — refs define starting state. "
            "Add an empty-state reference if needed.",
        ))
    else:
        result.issues.append(CritiqueIssue(
            "info", "references",
            "Prompt describes something appearing/emerging. Consider adding a reference "
            "image showing the empty scene (without the emerging element) for better "
            "visual consistency.",
        ))


def _check_dialogue_length(prompt: str, result: PromptCritique) -> None:
    """Check: Dialogue lines >15 words are likely to be truncated or repeated.

    From wiki seedance-2-prompt-modes.md:
    "Over-specified dialogue: Very long dialogue lines get cut off or repeated.
     Keep individual lines under 15 words."
    """
    _dialogue_pattern = re.compile(r'"([^"]+)"')
    for match in _dialogue_pattern.finditer(prompt):
        line = match.group(1)
        word_count = len(line.split())
        if word_count > 15:
            result.issues.append(CritiqueIssue(
                "warning", "complexity",
                f"Dialogue line is {word_count} words (max recommended: 15). "
                f"Line may be truncated or repeated by Seedance: "
                f"'{line[:60]}{'...' if len(line) > 60 else ''}'",
            ))


# ---------------------------------------------------------------------------
# Anti-pattern auto-fix mappings
# ---------------------------------------------------------------------------

# Keyword soup tokens → technical replacements (or None to remove entirely)
_KEYWORD_SOUP_REPLACEMENTS: dict[str, str | None] = {
    "8k": "shot on ARRI Alexa, high resolution",
    "4k": "high resolution",
    "masterpiece": None,
    "trending": None,
    "trending on artstation": None,
    "best quality": None,
    "ultra detailed": None,
    "ultra realistic": None,
    "hyper realistic": None,
    "hyperrealistic": None,
    "photorealistic": None,
    "unreal engine": None,
    "octane render": None,
    "highly detailed": None,
    "extremely detailed": None,
    "professional": None,
    "award winning": None,
    "award-winning": None,
    "beautiful": None,
    "stunning": None,
    "perfect": None,
    "hdr": "high dynamic range lighting",
    "uhd": "high resolution",
    "ray tracing": None,
    "volumetric lighting": "volumetric light, atmospheric haze",
    "bokeh": "shallow depth of field, f/1.4",
}

# Compile a single regex for keyword soup detection (word-boundary match)
_KEYWORD_SOUP_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _KEYWORD_SOUP_REPLACEMENTS) + r")\b",
    re.IGNORECASE,
)

# Vague lighting phrases → physics-based replacements
_VAGUE_LIGHTING_REPLACEMENTS: dict[str, str] = {
    "good lighting": "warm key light at 45 degrees, soft fill",
    "nice lighting": "soft natural light, golden hour warmth",
    "cool lighting": "cool volumetric light, 6500K",
    "great lighting": "three-point lighting setup, warm key at 45 degrees",
    "beautiful lighting": "rim light with warm key, soft ambient fill",
    "perfect lighting": "motivated key light at 45 degrees, soft bounce fill",
    "cinematic lighting": "warm tungsten key at 45 degrees, cool fill, rim backlight",
    "dramatic lighting": "hard key light from low angle, deep shadows, minimal fill",
    "moody lighting": "single low-angle key, warm practicals, underexposed fill",
    "soft lighting": "large diffused source overhead, 5600K, minimal shadows",
    "natural lighting": "available daylight, sun at 30 degrees, no artificial fill",
    "ambient lighting": "even omnidirectional fill, low contrast, 4000K",
    "studio lighting": "three-point setup: key at 45 degrees, fill at minus 30, hair light above",
}

# Compile a regex for vague lighting detection
_VAGUE_LIGHTING_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in _VAGUE_LIGHTING_REPLACEMENTS) + r")\b",
    re.IGNORECASE,
)

# Discrete action patterns → continuous motion rewrites
_DISCRETE_ACTION_PATTERNS: list[tuple[re.Pattern, str]] = [
    (
        re.compile(r"\bruns\s+and\s+then\s+stops\b", re.IGNORECASE),
        "running with gradual deceleration",
    ),
    (
        re.compile(r"\bwalks\s+and\s+then\s+stops\b", re.IGNORECASE),
        "walking with a slow ease to stillness",
    ),
    (
        re.compile(r"\bjumps\s+and\s+(?:then\s+)?lands\b", re.IGNORECASE),
        "leaping upward with a fluid arc into a soft landing",
    ),
    (
        re.compile(r"\bstarts\s+and\s+(?:then\s+)?stops\b", re.IGNORECASE),
        "easing into motion then gradually settling",
    ),
    (
        re.compile(r"\bstands\s+up\s+and\s+(?:then\s+)?sits\s+down\b", re.IGNORECASE),
        "rising fluidly then lowering back with controlled weight",
    ),
    (
        re.compile(r"\bturns\s+and\s+(?:then\s+)?freezes\b", re.IGNORECASE),
        "rotating smoothly into a held pose",
    ),
    (
        re.compile(r"\bopens\s+and\s+(?:then\s+)?closes\b", re.IGNORECASE),
        "opening with a slow arc then easing shut",
    ),
    (
        re.compile(r"\bruns\s+and\s+(?:then\s+)?falls\b", re.IGNORECASE),
        "running with momentum carrying into a stumbling descent",
    ),
    # Generic "[verb]s and then [verb]s" pattern — catches patterns not above
    (
        re.compile(r"\b(\w+)s\s+and\s+then\s+(\w+)s\b", re.IGNORECASE),
        r"\1ing with a fluid transition into \2ing",
    ),
]

# Emergence without empty-state reference — warn about reference-image-behavior
_EMERGENCE_PATTERN = re.compile(
    r"\b(appear(?:s|ing)?|emerge(?:s|ing)?|materializ(?:es?|ing)|"
    r"spawn(?:s|ing)?|grow(?:s|ing)?|ris(?:es?|ing)\s+from|"
    r"com(?:es?|ing)\s+into\s+view)\b",
    re.IGNORECASE,
)

# Pattern to detect if "No subtitles" is already present
_NO_SUBTITLES_PATTERN = re.compile(
    r"\bno\s+subtitles?\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Joey-skill sanitizers: brand names, age words, aspect ratios, proper names
# ---------------------------------------------------------------------------
#
# Always-on cleanup pass derived from Joey's cinema-worldbuilder and
# banana-pro-director skills. Each of these patterns matches output that
# Seedance/Higgsfield treats as noise, copyright risk, or content-filter
# bait. Auto-replacing them removes the most common regeneration causes.
#
# Each sanitizer is also exposed as a critique-level issue so the user can
# see what was changed. Set `apply=False` on the relevant sanitizer in
# auto_fix_prompt to disable individual passes (opt-out, default-on).

# Common brand names that produce uncanny artifacts or moderation flags.
# Maps brand → generic visual descriptor that survives across prompts.
_BRAND_NAME_REPLACEMENTS: dict[str, str] = {
    # Footwear
    r"\bnike\s+(?:air\s+(?:max|force|jordan)|dunks?|sambas?)\b": "athletic sneakers",
    r"\b(?:nike|adidas|puma|reebok|new\s+balance)\s+sneakers?\b": "athletic sneakers",
    r"\bair\s+jordan(?:s|\s+\d+)?\b": "high-top athletic sneakers",
    r"\bair\s+force\s+(?:1|ones?)\b": "white low-top athletic sneakers",
    r"\b(?:adidas\s+)?sambas?\b": "low-top athletic sneakers with three stripes",
    r"\bstan\s+smiths?\b": "white low-top tennis sneakers",
    r"\byeezys?\b": "knit athletic sneakers",
    r"\bconverse(?:\s+chuck\s+taylors?)?\b": "canvas high-top sneakers",
    r"\bchuck\s+taylors?\b": "canvas high-top sneakers",
    r"\bvans(?:\s+old\s+skools?)?\b": "canvas skate shoes",
    r"\btimberlands?\b": "tan suede work boots",
    r"\bdoc\s+martens?\b": "black leather lace-up boots",
    r"\bdr\.?\s+martens?\b": "black leather lace-up boots",
    r"\buggs?\b": "shearling-lined boots",
    r"\bcrocs?\b": "rubber clogs",
    # Tech
    r"\biphones?\b": "smartphone",
    r"\bipads?\b": "tablet",
    r"\bairpods?(?:\s+pros?)?\b": "wireless earbuds",
    r"\bmacbooks?(?:\s+pros?|\s+airs?)?\b": "laptop",
    r"\bimacs?\b": "desktop computer",
    r"\bapple\s+watch(?:es)?\b": "smartwatch",
    r"\bsamsung\s+galaxy\b": "smartphone",
    r"\bgoogle\s+pixels?\b": "smartphone",
    r"\bplaystation(?:\s+\d)?\b": "game console",
    r"\bps[45]\b": "game console",
    r"\bxbox(?:\s+(?:one|series\s+[sx]))?\b": "game console",
    r"\bnintendo\s+switch\b": "handheld game console",
    r"\bgopros?\b": "wide-angle action camera",
    # Cars
    r"\bteslas?(?:\s+(?:model\s+[sx3y]|cybertruck))?\b": "electric sedan",
    r"\bcybertrucks?\b": "angular electric pickup",
    r"\b(?:bmw|mercedes(?:-benz)?|audi|porsche)\b": "luxury sedan",
    r"\bferraris?\b": "red sports car",
    r"\blamborghinis?\b": "angular supercar",
    r"\b(?:toyota|honda|nissan|hyundai|kia)\b": "compact car",
    r"\bford\s+(?:f-?150|mustang|raptor)\b": "pickup truck",
    # Beverage
    r"\bcoca[\s-]?colas?\b": "cola can",
    r"\bcokes?(?=\s+(?:can|bottle))": "cola",
    r"\bpepsis?\b": "cola can",
    r"\bstarbucks?\b": "coffee chain",
    r"\bred\s+bulls?\b": "energy drink can",
    r"\bmonster\s+energy\b": "energy drink can",
    # Food/restaurants
    r"\bmcdonald'?s\b": "fast-food burger restaurant",
    r"\bburger\s+king\b": "fast-food burger restaurant",
    r"\bkfcs?\b": "fried chicken restaurant",
    r"\bsubways?\b": "sandwich shop",
    r"\bstarbucks\s+cups?\b": "coffee cup",
    # Camera bodies (kept generic — film-stock/lens mentions stay; specific brands go)
    r"\bcanons?\s+(?:eos\s+)?(?:r\d|\d+d)\b": "DSLR camera",
    r"\bnikons?\s+(?:d\d+|z\d+)\b": "DSLR camera",
    # Luxury fashion (note: leave generic styles like "Chanel-style" alone)
    r"\bguccis?\b": "luxury Italian fashion",
    r"\blouis\s+vuittons?\b": "luxury monogram leather",
    r"\bpradas?\b": "luxury Italian fashion",
    r"\bversaces?\b": "ornate gold-accented fashion",
    r"\bbalenciagas?\b": "oversized streetwear",
    r"\boff[\s-]?whites?\b": "industrial-stripe streetwear",
    r"\bsupremes?\b": "red-box logo streetwear",
    r"\byeezy\s+(?:gap|season)\b": "minimalist streetwear",
    # Streaming / media (often slips in via narrator-style prompts)
    r"\bnetflix\b": "streaming platform",
    r"\bspotifys?\b": "music streaming app",
    r"\binstagrams?\b": "photo-sharing app",
    r"\btiktoks?\b": "short-video app",
    r"\byoutubes?\b": "video platform",
    # Energy/oil (occasionally appears in B-roll prompts)
    r"\bshells?\s+(?:station|gas)\b": "fuel station",
    r"\bexxons?\b": "fuel station",
    r"\bbps?\s+station\b": "fuel station",
}

# Compiled brand-name patterns (built once)
_BRAND_NAME_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(pat, re.IGNORECASE), repl)
    for pat, repl in _BRAND_NAME_REPLACEMENTS.items()
]

# Age qualifiers that Seedance/Higgsfield treat as content-filter bait or
# noise. Strategy: drop the qualifier and leave the head noun. Joey's rule:
# describe by role, build, and clothing — never age.
_AGE_WORD_REPLACEMENTS: list[tuple[re.Pattern, str]] = [
    # "young/old/elderly/middle-aged X" → "X"  (head noun preserved)
    (re.compile(
        r"\b(?:very\s+)?(?:young|old|elderly|middle[\s-]?aged|aging|aged)\s+"
        r"(woman|man|figure|person|people|individual|adult)\b",
        re.IGNORECASE), r"\1"),
    # "teen/teenage/teenaged X" → "figure" (avoid "teen woman" Frankenstein)
    (re.compile(r"\bteen(?:age|aged)?\s+(?:girl|boy|woman|man|child|kid)\b",
                re.IGNORECASE), "figure"),
    # Bare child/kid/boy/girl — replace with "figure" since Joey's age-blind
    # rule excludes these terms entirely. Preserves wardrobe/role context
    # already in the prompt.
    (re.compile(r"\b(?:little|small)\s+(?:girl|boy|child|kid)\b",
                re.IGNORECASE), "figure"),
    (re.compile(r"\b(?:young\s+)?(?:girl|boy)s?\b", re.IGNORECASE), "figure"),
    (re.compile(r"\b(?:little\s+)?child(?:ren)?\b", re.IGNORECASE), "figure"),
    (re.compile(r"\bkids?\b", re.IGNORECASE), "figures"),
    (re.compile(r"\bteenagers?\b", re.IGNORECASE), "figure"),
    # "in (her|his|their) (early/late/mid) 20s/30s/etc" — keep, model handles it.
    # Don't touch numeric age phrases — too brittle to rewrite.
]

# Detect aspect-ratio specs leaking into the prompt body. Joey's rule: ratio
# is a UI/API parameter, not a prompt token.
_ASPECT_RATIO_PATTERN = re.compile(
    r"\b(?:"
    r"(?:in\s+)?(?:1\s*:\s*1|4\s*:\s*3|3\s*:\s*4|4\s*:\s*5|5\s*:\s*4|"
    r"2\s*:\s*3|3\s*:\s*2|9\s*:\s*16|16\s*:\s*9|21\s*:\s*9|"
    r"2\.39\s*:\s*1|2\.35\s*:\s*1|1\.85\s*:\s*1|1\.78\s*:\s*1)"
    r"(?:\s+(?:aspect\s+ratio|widescreen|cinematic|portrait|vertical|"
    r"horizontal|square|landscape))?|"
    r"\b(?:vertical|portrait|horizontal|landscape|square)\s+aspect\s+ratio\b|"
    r"\baspect\s+ratio\s*[:=]?\s*\d+\s*:\s*\d+\b"
    r")",
    re.IGNORECASE,
)


def _strip_brand_names(prompt: str) -> tuple[str, list[str]]:
    """Replace real brand names with generic visual descriptors.

    Returns (fixed_prompt, list_of_matched_brands).
    """
    fixed = prompt
    matched: list[str] = []
    for pattern, replacement in _BRAND_NAME_PATTERNS:
        def _record(m: re.Match) -> str:
            matched.append(m.group(0))
            return replacement
        fixed = pattern.sub(_record, fixed)
    return fixed, matched


def _strip_age_words(prompt: str) -> tuple[str, list[str]]:
    """Drop age qualifiers; preserve head nouns where possible.

    Returns (fixed_prompt, list_of_matched_age_terms).
    """
    fixed = prompt
    matched: list[str] = []
    for pattern, replacement in _AGE_WORD_REPLACEMENTS:
        def _record(m: re.Match) -> str:
            matched.append(m.group(0))
            return m.expand(replacement) if "\\" in replacement else replacement
        fixed = pattern.sub(_record, fixed)
    return fixed, matched


def _strip_aspect_ratios(prompt: str) -> tuple[str, list[str]]:
    """Remove aspect-ratio specs from prompt body.

    Returns (fixed_prompt, list_of_matched_ratios).
    """
    matched = [m.group(0) for m in _ASPECT_RATIO_PATTERN.finditer(prompt)]
    fixed = _ASPECT_RATIO_PATTERN.sub("", prompt)
    return fixed, matched


def _strip_character_names(
    prompt: str,
    character_names: list[str],
    descriptors: dict[str, str] | None = None,
) -> tuple[str, list[str]]:
    """Replace proper character names with visual descriptors.

    Higgsfield/Seedance treats names as noise. Pass the character roster +
    optional descriptor map (name → "the rose-pink haired woman in white tank")
    and this strips names from the prompt.

    Args:
        prompt: prompt text.
        character_names: list of character names to remove (case-insensitive).
        descriptors: optional mapping from name → replacement descriptor. If
            a name is not in the map, it is replaced with "the figure".

    Returns:
        (fixed_prompt, list_of_matched_names).
    """
    if not character_names:
        return prompt, []
    fixed = prompt
    matched: list[str] = []
    # Sort by length desc so "Mira Jade" matches before "Mira"
    for name in sorted(character_names, key=len, reverse=True):
        if not name or not name.strip():
            continue
        pattern = re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)
        replacement = (descriptors or {}).get(name, "the figure")
        def _record(m: re.Match) -> str:
            matched.append(m.group(0))
            return replacement
        fixed = pattern.sub(_record, fixed)
    return fixed, matched


# ---------------------------------------------------------------------------
# Auto-fix function
# ---------------------------------------------------------------------------

def auto_fix_prompt(
    prompt: str,
    critique: PromptCritique,
    characters: list[dict] | None = None,
    *,
    sanitize_brands: bool = True,
    sanitize_ages: bool = True,
    sanitize_aspect_ratios: bool = True,
    sanitize_names: bool = True,
    character_descriptors: dict[str, str] | None = None,
) -> str:
    """Apply automatic fixes to a Seedance prompt based on critique results.

    Fixes applied:
        1. Replace keyword soup tokens with technical equivalents (or remove).
        2. Rewrite discrete actions as continuous motion.
        3. Replace vague lighting phrases with physics-based directives.
        4. (Joey) Strip real brand names → generic visual descriptors.
        5. (Joey) Strip age qualifiers (young/old/teen/etc).
        6. (Joey) Strip aspect-ratio specs from prompt body.
        7. (Joey) Strip proper character names → descriptors when characters
           passed in. Higgsfield/Seedance treat names as noise.
        8. Append "No subtitles." if missing.

    Each sanitizer that actually mutates the prompt adds an info-level
    CritiqueIssue so the user can see what changed.

    Args:
        prompt: The original Seedance prompt text.
        critique: The PromptCritique result from critique_prompt() — info-level
            issues are appended here when sanitizers fire.
        characters: Optional list of character dicts with 'name' (and
            optionally 'descriptor') keys. Names are stripped when
            sanitize_names is True.
        sanitize_brands / sanitize_ages / sanitize_aspect_ratios /
        sanitize_names: per-pass opt-out flags (all default-on).
        character_descriptors: optional explicit name → descriptor mapping.
            Overrides the 'descriptor' key inside `characters`.

    Returns:
        The fixed prompt string.
    """
    fixed = prompt

    # 1. Replace keyword soup tokens
    def _replace_keyword(match: re.Match) -> str:
        token = match.group(0).lower()
        replacement = _KEYWORD_SOUP_REPLACEMENTS.get(token)
        if replacement is None:
            return ""  # Remove the token entirely
        return replacement

    fixed = _KEYWORD_SOUP_PATTERN.sub(_replace_keyword, fixed)

    # 2. Rewrite discrete actions as continuous motion
    for pattern, replacement in _DISCRETE_ACTION_PATTERNS:
        fixed = pattern.sub(replacement, fixed)

    # 3. Replace vague lighting with physics directives
    def _replace_lighting(match: re.Match) -> str:
        phrase = match.group(0).lower()
        return _VAGUE_LIGHTING_REPLACEMENTS.get(phrase, match.group(0))

    fixed = _VAGUE_LIGHTING_PATTERN.sub(_replace_lighting, fixed)

    # 4. Joey: brand names → generic descriptors
    if sanitize_brands:
        fixed, matched_brands = _strip_brand_names(fixed)
        if matched_brands:
            critique.issues.append(CritiqueIssue(
                "info", "sanitizer",
                f"Stripped brand names → generic descriptors: "
                f"{', '.join(sorted(set(matched_brands)))}",
            ))

    # 5. Joey: age qualifiers
    if sanitize_ages:
        fixed, matched_ages = _strip_age_words(fixed)
        if matched_ages:
            critique.issues.append(CritiqueIssue(
                "info", "sanitizer",
                f"Stripped age qualifiers: "
                f"{', '.join(sorted(set(matched_ages)))}",
            ))

    # 6. Joey: aspect ratios in prompt body
    if sanitize_aspect_ratios:
        fixed, matched_ratios = _strip_aspect_ratios(fixed)
        if matched_ratios:
            critique.issues.append(CritiqueIssue(
                "info", "sanitizer",
                f"Stripped aspect-ratio specs (set ratio in UI/API param): "
                f"{', '.join(sorted(set(matched_ratios)))}",
            ))

    # 7. Joey: proper character names → descriptors
    if sanitize_names and characters:
        names: list[str] = []
        descriptors_map: dict[str, str] = dict(character_descriptors or {})
        for ch in characters:
            name = ch.get("name") if isinstance(ch, dict) else None
            if not name:
                continue
            names.append(name)
            if "descriptor" in ch and ch["descriptor"]:
                descriptors_map.setdefault(name, ch["descriptor"])
        if names:
            fixed, matched_names = _strip_character_names(
                fixed, names, descriptors_map,
            )
            if matched_names:
                critique.issues.append(CritiqueIssue(
                    "info", "sanitizer",
                    f"Stripped character names → visual descriptors: "
                    f"{', '.join(sorted(set(matched_names)))}",
                ))

    # 8. Append "No subtitles." if missing
    if not _NO_SUBTITLES_PATTERN.search(fixed):
        # Ensure there's a period/space before appending
        fixed = fixed.rstrip()
        if fixed and not fixed.endswith((".","!","?")):
            fixed += "."
        fixed += " No subtitles."

    # Clean up: collapse multiple spaces, strip leading/trailing whitespace,
    # remove orphaned commas from removed tokens (e.g. ", , " → ", ")
    fixed = re.sub(r",\s*,", ",", fixed)
    fixed = re.sub(r"\s{2,}", " ", fixed)
    fixed = re.sub(r"\s+([.,!?])", r"\1", fixed)
    fixed = re.sub(r"^[,\s]+", "", fixed)
    fixed = fixed.strip()

    return fixed


# ---------------------------------------------------------------------------
# Queue critique
# ---------------------------------------------------------------------------

def critique_queue(queue_path: str) -> list[PromptCritique]:
    """Critique all scenes in a Seedance batch queue JSON file.

    Reads the queue format used by seedance_batch.py:
        { "projects": { "<name>": { "scenes": [ { "seedance_prompt": ..., ... } ] } } }

    Returns:
        List of PromptCritique for every scene across all projects.
    """
    with open(queue_path) as f:
        queue = json.load(f)

    projects = queue.get("projects", {})
    # Handle list format (seedance_batch.py normalizes this)
    if isinstance(projects, list):
        projects_dict = {}
        for proj in projects:
            projects_dict[proj.get("name", f"project-{len(projects_dict)}")] = proj
        projects = projects_dict

    results: list[PromptCritique] = []
    for _proj_name, proj_data in projects.items():
        scenes = proj_data.get("scenes", [])
        for scene in scenes:
            prompt = scene.get("seedance_prompt", "")
            if not prompt:
                continue
            scene_num = scene.get("scene_number", 0)
            duration = scene.get("seedance_duration", 8)
            # Count media: image_url counts as 1 if present
            media_count = 0
            if scene.get("image_url"):
                media_count += 1
            if scene.get("video_url"):
                media_count += 1
            if scene.get("audio_url"):
                media_count += 1
            # Also count media_files list if present
            media_count += len(scene.get("media_files", []))

            critique = critique_prompt(
                prompt=prompt,
                scene_number=scene_num,
                duration=duration,
                media_count=media_count,
            )
            results.append(critique)

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seedance prompt pre-submission critique",
    )
    sub = parser.add_subparsers(dest="command")

    # critique <prompt>
    crit = sub.add_parser("critique", help="Critique a single prompt")
    crit.add_argument("prompt", help="Prompt text to validate")
    crit.add_argument("--duration", type=int, default=8, help="Video duration in seconds")
    crit.add_argument("--media-count", type=int, default=0, help="Number of attached media files")
    crit.add_argument("--scene", type=int, default=0, help="Scene number")

    # critique-queue --queue <path>
    cq = sub.add_parser("critique-queue", help="Critique all scenes in a queue JSON")
    cq.add_argument("--queue", required=True, help="Path to queue JSON file")

    # auto-fix <prompt>
    af = sub.add_parser("auto-fix", help="Critique and auto-fix a single prompt")
    af.add_argument("prompt", help="Prompt text to fix")
    af.add_argument("--duration", type=int, default=8, help="Video duration in seconds")
    af.add_argument("--media-count", type=int, default=0, help="Number of attached media files")
    af.add_argument("--scene", type=int, default=0, help="Scene number")
    af.add_argument("--characters", default=None,
                    help="Comma-separated character names to strip (e.g. 'Mira,Sol,Zara')")
    af.add_argument("--no-sanitize-brands", action="store_true",
                    help="Disable brand-name → generic descriptor replacement")
    af.add_argument("--no-sanitize-ages", action="store_true",
                    help="Disable age-qualifier stripping")
    af.add_argument("--no-sanitize-aspect-ratios", action="store_true",
                    help="Disable aspect-ratio stripping from prompt body")
    af.add_argument("--no-sanitize-names", action="store_true",
                    help="Disable character-name → descriptor replacement")

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "critique":
        result = critique_prompt(
            prompt=args.prompt,
            scene_number=args.scene,
            duration=args.duration,
            media_count=args.media_count,
        )
        output = result.to_dict()
        output["prompt_preview"] = args.prompt[:80] + ("..." if len(args.prompt) > 80 else "")
        print(json.dumps(output, indent=2, ensure_ascii=False))
        sys.exit(0 if result.passed else 1)

    elif args.command == "critique-queue":
        results = critique_queue(args.queue)
        output = {
            "total_scenes": len(results),
            "passed": sum(1 for r in results if r.passed),
            "failed": sum(1 for r in results if not r.passed),
            "scenes": [r.to_dict() for r in results],
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
        failed = output["failed"]
        sys.exit(0 if failed == 0 else 1)

    elif args.command == "auto-fix":
        result = critique_prompt(
            prompt=args.prompt,
            scene_number=args.scene,
            duration=args.duration,
            media_count=args.media_count,
        )
        characters: list[dict] | None = None
        if args.characters:
            characters = [
                {"name": n.strip()}
                for n in args.characters.split(",") if n.strip()
            ]
        fixed = auto_fix_prompt(
            args.prompt, result,
            characters=characters,
            sanitize_brands=not args.no_sanitize_brands,
            sanitize_ages=not args.no_sanitize_ages,
            sanitize_aspect_ratios=not args.no_sanitize_aspect_ratios,
            sanitize_names=not args.no_sanitize_names,
        )
        output = {
            "original": args.prompt,
            "fixed": fixed,
            "changed": fixed != args.prompt,
            "critique": result.to_dict(),
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
        sys.exit(0)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
