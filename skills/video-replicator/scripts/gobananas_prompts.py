#!/usr/bin/env python3
"""
Go Bananas Comprehensive Prompt Builder

Builds structured prompts that leverage ALL Go Bananas capabilities:
- Characters (single & multiple)
- Products
- Style Presets (17 available)
- Reference Groups (multi-image style/composition references)
- Scenes (reusable scene presets)

The key insight: When using Go Bananas character/product references, the
prompt should NOT repeat character appearance details. The reference already
contains that information. Instead, prompts should focus on:
- scene_prompt: pose/action + environment
- additional_details: lighting, mood, style tokens

Usage:
    from gobananas_prompts import GoBananasPromptBuilder, GoBananasPrompt

    builder = GoBananasPromptBuilder()
    prompt = builder.build_character_prompt(scene_data, character_id=27)

    # Use the structured output
    print(prompt.scene_prompt)
    print(prompt.additional_details)
    print(prompt.to_mcp_command())
"""

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

# ============================================================================
# Style Preset Mapping
# ============================================================================

# Map SEALCAM+ metatokens/styles to Go Bananas style preset names
STYLE_PRESET_MAPPING = {
    # Cinematic/Luxury styles
    "cinematic": "Photo-Realistic Cinematic",
    "luxury": "Photo-Realistic Cinematic",
    "editorial": "Photo-Realistic Cinematic",
    "fashion": "Photo-Realistic Cinematic",
    "high-end": "Photo-Realistic Cinematic",
    "premium": "Photo-Realistic Cinematic",

    # Lifestyle styles
    "lifestyle": "Lifestyle Photography",
    "natural": "Lifestyle Photography",
    "authentic": "Lifestyle Photography",
    "candid": "Lifestyle Photography",
    "casual": "Lifestyle Photography",

    # Documentary styles
    "documentary": "Documentary Photography",
    "real": "Documentary Photography",
    "journalistic": "Documentary Photography",
    "raw": "Documentary Photography",

    # Vibrant styles
    "vibrant": "Vibrant & Bold",
    "bold": "Vibrant & Bold",
    "colorful": "Vibrant & Bold",
    "saturated": "Vibrant & Bold",
    "pop": "Vibrant & Bold",

    # Product styles
    "product": "Product Showcase",
    "commercial": "Product Showcase",
    "ecommerce": "Product Showcase",
    "catalog": "Product Showcase",
    "hero shot": "Product Showcase",

    # Natural/Organic styles
    "organic": "Natural & Organic",
    "earthy": "Natural & Organic",
    "sustainable": "Natural & Organic",
    "eco": "Natural & Organic",

    # Special styles
    "cyberpunk": "Neon Noir Cyberpunk",
    "neon": "Neon Noir Cyberpunk",
    "futuristic": "Neon Noir Cyberpunk",
    "sci-fi": "Neon Noir Cyberpunk",

    # Artistic styles
    "watercolor": "Watercolor Art",
    "painted": "Watercolor Art",
    "illustration": "Watercolor Art",

    # 3D/Animation styles
    "pixar": "Disney-Pixar Style",
    "animated": "Disney-Pixar Style",
    "cartoon": "Disney-Pixar Style",
    "3d": "3D Sticker Bomb",
    "claymation": "Claymation Studio",
    "clay": "Claymation Studio",
    "papercut": "Papercut Diorama",
}

# Style preset IDs from Go Bananas (for direct ID reference)
STYLE_PRESET_IDS = {
    "Photo-Realistic Cinematic": 9,
    "Lifestyle Photography": 3,
    "Documentary Photography": 10,
    "Vibrant & Bold": 5,
    "Product Showcase": 2,
    "Natural & Organic": 6,
    "Neon Noir Cyberpunk": 15,
    "Watercolor Art": 1,
    "Disney-Pixar Style": 7,
    "3D Sticker Bomb": 12,
    "Claymation Studio": 13,
    "Papercut Diorama": 14,
    "Technical Blueprint": 16,
}

# Default negative prompts for clean outputs
DEFAULT_NEGATIVE_PROMPT = "no text, no logos, no watermarks, clean plate, anatomically correct"

# Enhanced negative prompt for group/multi-character scenes (v2.20)
GROUP_SCENE_NEGATIVE_PROMPT = (
    "no text, no logos, no watermarks, clean plate, anatomically correct, "
    "no duplicate faces, no similar looking people, no clone faces, "
    "each person has unique distinct face"
)

# ============================================================================
# Character Negative Prompts (v2.28)
# ============================================================================

# Path to character negative prompts registry
import os

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REFERENCES_DIR = os.path.join(_SCRIPT_DIR, "..", "references")
CHARACTER_NEGATIVE_PROMPTS_PATH = os.path.join(_REFERENCES_DIR, "character-negative-prompts.json")

# Cache for loaded character negative prompts
_character_negative_prompts_cache = None


def load_character_negative_prompts() -> dict:
    """
    Load character-specific negative prompts from the registry file.

    Returns:
        Dict with 'characters' and 'global' keys containing negative prompts.
        Returns empty structure if file not found.
    """
    global _character_negative_prompts_cache

    if _character_negative_prompts_cache is not None:
        return _character_negative_prompts_cache

    try:
        with open(CHARACTER_NEGATIVE_PROMPTS_PATH) as f:
            _character_negative_prompts_cache = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        _character_negative_prompts_cache = {
            "characters": {},
            "global": []
        }

    return _character_negative_prompts_cache


def get_character_negatives(
    character_id: int | None = None,
    character_name: str | None = None,
    include_global: bool = True
) -> list[str]:
    """
    Get negative prompts for a specific character.

    Args:
        character_id: Character ID to look up
        character_name: Character name to look up (alternative to ID)
        include_global: If True, include global negative prompts

    Returns:
        List of negative prompt strings
    """
    registry = load_character_negative_prompts()
    negatives = []

    # Look up by character_id
    if character_id is not None:
        for _name, info in registry.get("characters", {}).items():
            if info.get("character_id") == character_id:
                negatives.extend(info.get("negative_prompts", []))
                break

    # Look up by character_name
    elif character_name is not None:
        char_info = registry.get("characters", {}).get(character_name)
        if char_info:
            negatives.extend(char_info.get("negative_prompts", []))

    # Add global negatives
    if include_global:
        negatives.extend(registry.get("global", []))

    return negatives


def build_negative_prompt_with_character(
    base_negative: str,
    character_id: int | None = None,
    character_name: str | None = None,
    include_global: bool = True
) -> str:
    """
    Build a complete negative prompt with character-specific anti-patterns.

    Args:
        base_negative: Base negative prompt (DEFAULT_NEGATIVE_PROMPT or custom)
        character_id: Character ID for lookup
        character_name: Character name for lookup (alternative)
        include_global: If True, include global negative prompts

    Returns:
        Complete negative prompt string
    """
    parts = [base_negative] if base_negative else []

    # Get character-specific negatives
    char_negatives = get_character_negatives(
        character_id=character_id,
        character_name=character_name,
        include_global=include_global
    )

    if char_negatives:
        parts.extend(char_negatives)

    # Deduplicate while preserving order
    seen = set()
    unique_parts = []
    for part in parts:
        part_lower = part.lower().strip()
        if part_lower and part_lower not in seen:
            seen.add(part_lower)
            unique_parts.append(part.strip())

    return ", ".join(unique_parts)


# ============================================================================
# Prompt Simplification for Character References
# ============================================================================

# Patterns that describe appearance and should be removed when using character_id
# These patterns cause Go Bananas to ignore the character reference
APPEARANCE_PATTERNS_TO_REMOVE = [
    # Names (capitalized first + last)
    r'\b[A-Z][a-z]+\s+[A-Z][a-z]+\b',
    # Facial expressions
    r'\b(?:warm|genuine|confident|friendly|welcoming|bright|radiant|subtle|gentle|soft)\s+(?:smile|expression|look|gaze|eyes)\b',
    r'\b(?:smiling|grinning|beaming)\b',
    # Age descriptors
    r'\b(?:young|old|elderly|mature|youthful|middle-aged|middle aged)\s+(?:man|woman|person|male|female|adult|Indian|Asian|African|Caucasian|Latino)\b',
    r'\b\d+\s*(?:-\s*)?year(?:s)?(?:\s*-\s*)?old\b',
    r'\bin\s+(?:his|her|their)\s+(?:20s|30s|40s|50s|60s|70s)\b',
    # Body descriptors
    r'\b(?:handsome|beautiful|attractive|striking|gorgeous|pretty)\b',
    r'\b(?:athletic|slim|muscular|slender|petite|tall|short)\s+(?:build|figure|frame|body)\b',
    # Hair descriptors
    r'\b(?:dark|light|brown|black|blonde|gray|grey|white|red|auburn)\s+hair\b',
    r'\b(?:long|short|curly|straight|wavy)\s+hair\b',
    # Skin descriptors
    r'\b(?:fair|dark|light|tan|pale|olive|brown)\s+(?:skin|complexion|skinned)\b',
    # Ethnicity descriptors (when they describe the person, not culture/setting)
    r'\b(?:Indian|Asian|African|Caucasian|Latino|European|American)\s+(?:man|woman|person|male|female|features)\b',
]


def simplify_prompt_for_character(prompt: str, aggressive: bool = False) -> str:
    """
    Remove appearance descriptions from prompt when using character_id.

    When using Go Bananas character references, the model will ignore the
    reference if the prompt contains detailed appearance descriptions.
    This function strips those descriptions to let the character reference
    work properly.

    Keeps: pose, action, environment, clothing, lighting, camera, style tokens
    Removes: names, expressions, age, body descriptions, hair, skin

    Args:
        prompt: Original prompt text
        aggressive: If True, also remove more ambiguous patterns

    Returns:
        Simplified prompt focused on pose/action/environment

    Example:
        >>> original = "Ram Patel, warm genuine smile, greeting gesture in namaste. Young Indian man."
        >>> simplified = simplify_prompt_for_character(original)
        >>> print(simplified)
        "greeting gesture in namaste."
    """
    if not prompt:
        return prompt

    simplified = prompt

    # Apply each pattern
    for pattern in APPEARANCE_PATTERNS_TO_REMOVE:
        simplified = re.sub(pattern, '', simplified, flags=re.IGNORECASE)

    # Clean up resulting text
    # Remove double spaces
    simplified = re.sub(r'\s+', ' ', simplified)
    # Remove orphaned commas
    simplified = re.sub(r',\s*,', ',', simplified)
    # Remove leading/trailing commas
    simplified = re.sub(r'^\s*,\s*', '', simplified)
    simplified = re.sub(r'\s*,\s*$', '', simplified)
    # Remove empty parentheses
    simplified = re.sub(r'\(\s*\)', '', simplified)
    # Clean up spacing around punctuation
    simplified = re.sub(r'\s+([.,!?])', r'\1', simplified)
    simplified = re.sub(r'([.,!?])\s*([.,!?])', r'\1', simplified)

    return simplified.strip()


def validate_prompt_for_character(prompt: str, character_id: int) -> list:
    """
    Check if prompt might override character reference.

    Returns a list of warnings about patterns that may cause the
    character reference to be ignored.

    Args:
        prompt: Prompt text to validate
        character_id: Character ID being used

    Returns:
        List of warning strings (empty if prompt looks good)

    Example:
        >>> warnings = validate_prompt_for_character(
        ...     "Ram Patel, warm smile, young Indian man",
        ...     character_id=27
        ... )
        >>> print(warnings)
        ["Prompt contains a name - may override character reference",
         "Prompt describes facial expression - may conflict with reference",
         "Prompt contains age descriptor - may conflict with reference"]
    """
    warnings = []

    if not prompt:
        return warnings

    prompt_lower = prompt.lower()

    # Check for capitalized names (First Last pattern)
    if re.search(r'\b[A-Z][a-z]+\s+[A-Z][a-z]+\b', prompt):
        warnings.append("Prompt contains a name - may override character reference")

    # Check for expression descriptions
    expression_patterns = [
        r'\b(?:warm|genuine|confident|friendly|welcoming|bright|radiant)\s+(?:smile|expression|look)\b',
        r'\b(?:smiling|grinning|beaming|frowning)\b',
    ]
    for pattern in expression_patterns:
        if re.search(pattern, prompt_lower):
            warnings.append("Prompt describes facial expression - may conflict with reference")
            break

    # Check for age descriptors
    age_patterns = [
        r'\b(?:young|old|elderly|mature|middle-aged)\b',
        r'\b\d+\s*year(?:s)?(?:\s*-\s*)?old\b',
        r'\bin\s+(?:his|her|their)\s+(?:20s|30s|40s|50s|60s|70s)\b',
    ]
    for pattern in age_patterns:
        if re.search(pattern, prompt_lower):
            warnings.append("Prompt contains age descriptor - may conflict with reference")
            break

    # Check for body descriptors
    body_patterns = [
        r'\b(?:handsome|beautiful|attractive|striking|gorgeous|pretty)\b',
        r'\b(?:athletic|slim|muscular|slender|petite)\s+(?:build|figure|frame|body)\b',
    ]
    for pattern in body_patterns:
        if re.search(pattern, prompt_lower):
            warnings.append("Prompt describes physical appearance - may conflict with reference")
            break

    # Check for hair descriptors
    if re.search(r'\b(?:dark|light|brown|black|blonde|gray|grey|white)\s+hair\b', prompt_lower):
        warnings.append("Prompt describes hair - may conflict with reference")

    # Check for ethnicity + person descriptors
    if re.search(r'\b(?:Indian|Asian|African|Caucasian|Latino)\s+(?:man|woman|person|male|female)\b', prompt_lower):
        warnings.append("Prompt describes ethnicity/person - reference already provides this")

    return warnings


def get_prompt_simplification_summary(original: str, simplified: str) -> str:
    """
    Generate a summary of what was removed from a prompt.

    Args:
        original: Original prompt text
        simplified: Simplified prompt text

    Returns:
        Human-readable summary of changes
    """
    original_words = set(original.lower().split())
    simplified_words = set(simplified.lower().split())
    removed_words = original_words - simplified_words

    if not removed_words:
        return "No changes needed - prompt is already action-focused"

    # Categorize removed words
    categories = {
        "names": [],
        "expressions": [],
        "age": [],
        "appearance": [],
        "other": [],
    }

    expression_words = {"smile", "smiling", "expression", "look", "gaze", "warm", "genuine", "confident", "friendly"}
    age_words = {"young", "old", "elderly", "mature", "year", "years", "20s", "30s", "40s", "50s", "60s", "70s"}
    appearance_words = {"handsome", "beautiful", "attractive", "striking", "athletic", "slim", "muscular",
                        "hair", "skin", "tall", "short", "dark", "light", "fair", "tan"}

    for word in removed_words:
        if word.istitle() or (len(word) > 1 and word[0].isupper()):
            categories["names"].append(word)
        elif word in expression_words:
            categories["expressions"].append(word)
        elif word in age_words:
            categories["age"].append(word)
        elif word in appearance_words:
            categories["appearance"].append(word)
        else:
            categories["other"].append(word)

    summary_parts = []
    if categories["names"]:
        summary_parts.append(f"Names: {', '.join(categories['names'])}")
    if categories["expressions"]:
        summary_parts.append(f"Expressions: {', '.join(categories['expressions'])}")
    if categories["age"]:
        summary_parts.append(f"Age descriptors: {', '.join(categories['age'])}")
    if categories["appearance"]:
        summary_parts.append(f"Appearance: {', '.join(categories['appearance'])}")

    if summary_parts:
        return "Removed: " + "; ".join(summary_parts)
    else:
        return "Minor cleanup applied"


# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class GoBananasPrompt:
    """
    Complete Go Bananas generation parameters.

    When using character/product references, scene_prompt should contain
    ONLY pose/action + environment, NOT character appearance details.
    """
    # Required fields
    scene_prompt: str  # Pose/action + environment (NO appearance when using refs)
    additional_details: str  # Lighting, mood, style tokens
    negative_prompt: str  # What to avoid
    aspect_ratio: str  # "9:16", "16:9", "1:1"

    # Optional enhancements
    style_preset_name: str | None = None
    style_preset_id: int | None = None
    reference_group_name: str | None = None
    reference_group_id: int | None = None
    reference_mode: str | None = None  # "style" or "add"
    scene_preset_name: str | None = None
    scene_preset_id: int | None = None

    # Metadata
    generation_method: str = "standalone"  # character, multi_character, product, standalone
    scene_number: int | None = None

    # For multi-character scenes
    character_ids: list[int] = field(default_factory=list)

    # Legacy compatibility
    legacy_prompt: str | None = None  # Full prompt for backward compatibility

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result = asdict(self)
        # Remove None values
        return {k: v for k, v in result.items() if v is not None}

    def to_mcp_command(
        self,
        character_id: int | None = None,
        product_id: int | None = None,
    ) -> str:
        """
        Generate complete MCP command for Claude to execute.

        Args:
            character_id: Single character ID (for character generation)
            product_id: Product ID (for product generation)

        Returns:
            Formatted MCP command string
        """
        if character_id and len(self.character_ids) == 0:
            return self._mcp_character_command(character_id)
        elif len(self.character_ids) >= 2:
            return self._mcp_multi_character_command()
        elif product_id:
            return self._mcp_product_command(product_id)
        else:
            return self._mcp_standalone_command()

    def _mcp_character_command(self, character_id: int) -> str:
        """Generate MCP command for single character using generate_image with Pro model."""
        # Combine scene_prompt + additional_details for generate_image
        full_prompt = self.scene_prompt
        if self.additional_details:
            full_prompt += f" {self.additional_details}"

        lines = [
            "mcp__go-bananas__generate_image(",
            f'    prompt="{self._escape(full_prompt)}",',
            f'    character_id={character_id},',
            f'    aspect_ratio="{self.aspect_ratio}",',
            '    model_id="gemini-pro-image"  # ALWAYS use Pro model',
        ]
        lines.append(")")
        return "\n".join(lines)

    def _mcp_multi_character_command(self) -> str:
        """Generate MCP command for multiple characters using generate_image with Pro model."""
        ids_str = "[" + ", ".join(str(cid) for cid in self.character_ids) + "]"
        # Combine scene_prompt + additional_details for generate_image
        full_prompt = self.scene_prompt
        if self.additional_details:
            full_prompt += f" {self.additional_details}"

        lines = [
            "mcp__go-bananas__generate_image(",
            f'    prompt="{self._escape(full_prompt)}",',
            f'    character_ids={ids_str},',
            f'    aspect_ratio="{self.aspect_ratio}",',
            '    model_id="gemini-pro-image"  # ALWAYS use Pro model',
        ]
        lines.append(")")
        return "\n".join(lines)

    def _mcp_product_command(self, product_id: int) -> str:
        """Generate MCP command for product using generate_image with Pro model."""
        # Combine scene_prompt + additional_details for generate_image
        full_prompt = self.scene_prompt
        if self.additional_details:
            full_prompt += f" {self.additional_details}"

        lines = [
            "mcp__go-bananas__generate_image(",
            f'    prompt="{self._escape(full_prompt)}",',
            f'    product_id={product_id},',
            f'    aspect_ratio="{self.aspect_ratio}",',
            '    model_id="gemini-pro-image"  # ALWAYS use Pro model',
        ]
        lines.append(")")
        return "\n".join(lines)

    def _mcp_standalone_command(self) -> str:
        """Generate MCP command for standalone generation with Pro model."""
        # For standalone, combine scene_prompt + additional_details
        full_prompt = self.scene_prompt
        if self.additional_details:
            full_prompt += f" {self.additional_details}"

        lines = [
            "mcp__go-bananas__generate_image(",
            f'    prompt="{self._escape(full_prompt)}",',
        ]
        if self.negative_prompt:
            lines.append(f'    negative_prompt="{self._escape(self.negative_prompt)}",')
        if self.style_preset_name:
            lines.append(f'    style_preset_name="{self.style_preset_name}",')
        elif self.style_preset_id:
            lines.append(f'    style_preset_id={self.style_preset_id},')
        if self.reference_group_name:
            lines.append(f'    reference_group_name="{self.reference_group_name}",')
        elif self.reference_group_id:
            lines.append(f'    reference_group_id={self.reference_group_id},')
        if self.reference_mode:
            lines.append(f'    reference_mode="{self.reference_mode}",')
        lines.append(f'    aspect_ratio="{self.aspect_ratio}",')
        lines.append('    model_id="gemini-pro-image"  # ALWAYS use Pro model')
        lines.append(")")
        return "\n".join(lines)

    def _escape(self, text: str) -> str:
        """Escape quotes and newlines for MCP command."""
        return text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ')

    def to_mcp_dict(
        self,
        character_id: int | None = None,
        product_id: int | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Generate MCP parameters as dictionary for generate_image with Pro model.

        v2.20: Added model_id parameter with validation. Warns if using flash
        model with character/product references (will produce poor results).

        Args:
            character_id: Single character ID
            product_id: Product ID
            model_id: Override model ID (default: "gemini-pro-image").
                      WARNING: "gemini-flash-image" ignores character references.

        Returns:
            Dict ready to be passed to generate_image MCP tool

        Raises:
            ValueError: If character_id/product_id set but model_id missing
        """
        # Combine scene_prompt + additional_details for generate_image
        full_prompt = self.scene_prompt
        if self.additional_details:
            full_prompt += f" {self.additional_details}"

        # Determine effective model_id (always default to Pro)
        effective_model_id = model_id or "gemini-pro-image"

        # Warn if using flash model with references (v2.20)
        has_refs = character_id or product_id or len(self.character_ids) >= 2
        if has_refs and effective_model_id == "gemini-flash-image":
            import warnings
            warnings.warn(
                "Using gemini-flash-image with character/product references will produce "
                "poor results. The flash model ignores references. Use gemini-pro-image instead.",
                UserWarning,
                stacklevel=2,
            )

        # Base result with Pro model
        result = {
            "prompt": full_prompt,
            "aspect_ratio": self.aspect_ratio,
            "model_id": effective_model_id,
        }

        # Add character or product reference
        if character_id and len(self.character_ids) == 0:
            result["character_id"] = character_id
        elif len(self.character_ids) >= 2:
            result["character_ids"] = self.character_ids
        elif product_id:
            result["product_id"] = product_id

        # Add negative prompt if present
        if self.negative_prompt:
            result["negative_prompt"] = self.negative_prompt

        # Add optional style/reference settings
        if self.style_preset_name:
            result["style_preset_name"] = self.style_preset_name
        elif self.style_preset_id:
            result["style_preset_id"] = self.style_preset_id
        if self.reference_group_name:
            result["reference_group_name"] = self.reference_group_name
        elif self.reference_group_id:
            result["reference_group_id"] = self.reference_group_id
        if self.reference_mode:
            result["reference_mode"] = self.reference_mode

        return result


# ============================================================================
# Prompt Builder
# ============================================================================

class GoBananasPromptBuilder:
    """
    Build comprehensive prompts for all Go Bananas generation methods.

    The core principle: When using character/product references, DON'T repeat
    appearance details in the prompt. The reference already contains that.
    Instead, focus prompts on:
    - scene_prompt: pose/action + environment
    - additional_details: lighting, mood, style tokens
    """

    def __init__(self, default_aspect_ratio: str = "9:16"):
        """
        Initialize builder with defaults.

        Args:
            default_aspect_ratio: Default aspect ratio for generated images
        """
        self.default_aspect_ratio = default_aspect_ratio

    # ========================================================================
    # Main Generation Methods
    # ========================================================================

    def build_character_prompt(
        self,
        scene: dict,
        character_id: int,
        aspect_ratio: str | None = None,
    ) -> GoBananasPrompt:
        """
        Build prompt for single character generation.

        CRITICAL: scene_prompt should NOT contain character appearance.
        The character reference already has that information.

        v2.28: Now includes character-specific negative prompts.

        Args:
            scene: SEALCAM+ scene data
            character_id: Go Bananas character ID
            aspect_ratio: Override aspect ratio

        Returns:
            GoBananasPrompt with scene_prompt focused on pose/action/environment
        """
        return GoBananasPrompt(
            scene_prompt=self.extract_scene_prompt(scene),
            additional_details=self.extract_additional_details(scene),
            negative_prompt=self.extract_negative_prompt(scene, character_id=character_id),
            aspect_ratio=aspect_ratio or self.default_aspect_ratio,
            style_preset_name=self.recommend_style_preset(scene),
            style_preset_id=self._get_style_preset_id(scene),
            reference_mode=self.recommend_reference_mode(scene),
            generation_method="character",
            scene_number=scene.get("scene_number"),
            legacy_prompt=self._build_legacy_prompt(scene),
        )

    def build_multi_character_prompt(
        self,
        scene: dict,
        character_ids: list[int],
        aspect_ratio: str | None = None,
    ) -> GoBananasPrompt:
        """
        Build prompt for multi-character scene (2-5 characters).

        v2.20: Uses GROUP_SCENE_NEGATIVE_PROMPT to prevent duplicate faces.

        Args:
            scene: SEALCAM+ scene data
            character_ids: List of Go Bananas character IDs
            aspect_ratio: Override aspect ratio

        Returns:
            GoBananasPrompt for multi-character generation
        """
        # Use group-specific negative prompt to prevent duplicate faces
        negative = scene.get("negative_prompt", "")
        if not negative:
            negative = GROUP_SCENE_NEGATIVE_PROMPT
        elif "duplicate" not in negative.lower():
            negative += ", no duplicate faces, each person has unique distinct face"

        return GoBananasPrompt(
            scene_prompt=self.extract_scene_prompt(scene),
            additional_details=self.extract_additional_details(scene),
            negative_prompt=negative,
            aspect_ratio=aspect_ratio or self.default_aspect_ratio,
            style_preset_name=self.recommend_style_preset(scene),
            style_preset_id=self._get_style_preset_id(scene),
            reference_mode=self.recommend_reference_mode(scene),
            generation_method="multi_character",
            scene_number=scene.get("scene_number"),
            character_ids=character_ids,
            legacy_prompt=self._build_legacy_prompt(scene),
        )

    def build_product_prompt(
        self,
        scene: dict,
        product_id: int,
        aspect_ratio: str | None = None,
    ) -> GoBananasPrompt:
        """
        Build prompt for product marketing scene.

        Args:
            scene: SEALCAM+ scene data
            product_id: Go Bananas product ID
            aspect_ratio: Override aspect ratio

        Returns:
            GoBananasPrompt for product generation
        """
        return GoBananasPrompt(
            scene_prompt=self.extract_scene_prompt(scene),
            additional_details=self.extract_additional_details(scene),
            negative_prompt=self.extract_negative_prompt(scene),
            aspect_ratio=aspect_ratio or self.default_aspect_ratio,
            style_preset_name=self.recommend_style_preset(scene),
            style_preset_id=self._get_style_preset_id(scene),
            reference_mode=self.recommend_reference_mode(scene),
            generation_method="product",
            scene_number=scene.get("scene_number"),
            legacy_prompt=self._build_legacy_prompt(scene),
        )

    def build_standalone_prompt(
        self,
        scene: dict,
        aspect_ratio: str | None = None,
        style_preset: str | None = None,
        reference_group: str | None = None,
    ) -> GoBananasPrompt:
        """
        Build prompt for standalone generation (no character/product ref).

        For standalone generation, the full subject description IS included.

        Args:
            scene: SEALCAM+ scene data
            aspect_ratio: Override aspect ratio
            style_preset: Explicit style preset name
            reference_group: Reference group name for style/composition

        Returns:
            GoBananasPrompt for standalone generation
        """
        return GoBananasPrompt(
            scene_prompt=self._build_standalone_scene_prompt(scene),
            additional_details=self.extract_additional_details(scene),
            negative_prompt=self.extract_negative_prompt(scene),
            aspect_ratio=aspect_ratio or self.default_aspect_ratio,
            style_preset_name=style_preset or self.recommend_style_preset(scene),
            style_preset_id=self._get_style_preset_id(scene) if not style_preset else None,
            reference_group_name=reference_group,
            reference_mode="style" if reference_group else None,
            generation_method="standalone",
            scene_number=scene.get("scene_number"),
            legacy_prompt=self._build_legacy_prompt(scene),
        )

    def build_style_transfer_prompt(
        self,
        scene: dict,
        reference_group_id: int,
        reference_mode: str = "style",
        aspect_ratio: str | None = None,
    ) -> GoBananasPrompt:
        """
        Build prompt using reference group for style transfer.

        Uses Go Bananas reference_group_id + reference_mode to transfer
        visual style from reference images onto generated scenes. Ideal for
        matching architectural renders, illustration styles, or art direction.

        Args:
            scene: SEALCAM+ scene data
            reference_group_id: Go Bananas reference group ID
            reference_mode: "style" for style transfer, "add" for composition
            aspect_ratio: Override aspect ratio

        Returns:
            GoBananasPrompt with reference_group_id and reference_mode set
        """
        return GoBananasPrompt(
            scene_prompt=self._build_standalone_scene_prompt(scene),
            additional_details=self.extract_additional_details(scene),
            negative_prompt=self.extract_negative_prompt(scene),
            aspect_ratio=aspect_ratio or self.default_aspect_ratio,
            style_preset_name=self.recommend_style_preset(scene),
            style_preset_id=self._get_style_preset_id(scene),
            reference_group_id=reference_group_id,
            reference_mode=reference_mode,
            generation_method="style_transfer",
            scene_number=scene.get("scene_number"),
            legacy_prompt=self._build_legacy_prompt(scene),
        )

    # ========================================================================
    # Component Extractors
    # ========================================================================

    def extract_scene_prompt(self, scene: dict) -> str:
        """
        Extract scene prompt: CLOTHING + pose/action + environment.

        CRITICAL: Character reference is for FACE ONLY.
        - INCLUDE: Clothing/outfit (varies per scene, must match original video)
        - EXCLUDE: Face/body appearance (skin, hair, age, ethnicity)

        Args:
            scene: SEALCAM+ scene data

        Returns:
            Scene prompt with clothing + pose/action + environment
        """
        parts = []

        # 1. Extract CLOTHING from subject (exclude face/body details)
        clothing = self._extract_clothing_from_subject(scene)
        if clothing:
            parts.append(clothing)

        # 2. Action/Pose (primary focus for character refs)
        action = scene.get("action", {})
        if isinstance(action, dict):
            primary = action.get("primary", "")
            if primary:
                parts.append(primary)

            # Add direction/path if present
            path = action.get("path", "")
            if path and ("left" in path.lower() or "right" in path.lower()):
                parts.append(path)
        elif action:
            parts.append(str(action))

        # 3. Environment/Setting
        env = scene.get("environment", {})
        if isinstance(env, dict):
            setting = env.get("setting", "")
            if setting:
                parts.append(setting)
            # Add atmosphere if distinct from setting
            atmosphere = env.get("atmosphere", "")
            if atmosphere and atmosphere.lower() not in str(setting).lower():
                parts.append(atmosphere)
        elif env:
            parts.append(str(env))

        # 4. Camera framing (relevant for composition)
        camera = scene.get("camera", {})
        if isinstance(camera, dict):
            shot_type = camera.get("shot_type", "")
            if shot_type:
                parts.append(f"{shot_type} shot")

        return ". ".join(filter(None, parts))

    def _extract_clothing_from_subject(self, scene: dict) -> str:
        """
        Extract ONLY clothing/outfit from subject appearance.

        Character reference handles face, so we extract:
        - INCLUDE: wearing, jacket, shirt, pants, dress, shoes, boots, gloves, etc.
        - EXCLUDE: skin, hair, age, ethnicity, gender, body type

        Args:
            scene: SEALCAM+ scene data

        Returns:
            Clothing description string
        """
        subject = scene.get("subject", {})
        if isinstance(subject, dict):
            appearance = subject.get("appearance", "")
        else:
            appearance = str(subject) if subject else ""

        if not appearance:
            return ""

        # Keywords that indicate face/body (to EXCLUDE)
        face_body_keywords = [
            "skin", "hair", "eyes", "face", "complexion",
            "young", "old", "adult", "male", "female", "man", "woman",
            "asian", "caucasian", "african", "latino", "indian", "south asian",
            "fair", "dark", "light", "tan", "pale",
            "tall", "short", "slim", "muscular", "athletic",
            "age", "year", "years old",
        ]

        # Find where clothing description starts (usually after "wearing")
        appearance_lower = appearance.lower()

        # Try to find "wearing" as the start of clothing
        wearing_idx = appearance_lower.find("wearing")
        if wearing_idx != -1:
            # Extract from "wearing" onwards
            clothing_part = appearance[wearing_idx:]
            return clothing_part

        # If no "wearing", try to extract clothing items directly
        # Look for clothing keywords
        clothing_keywords = [
            "jacket", "coat", "shirt", "blouse", "sweater", "hoodie",
            "pants", "jeans", "leggings", "shorts", "skirt", "dress",
            "shoes", "boots", "sneakers", "heels", "sandals",
            "gloves", "hat", "cap", "sunglasses", "glasses",
            "scarf", "tie", "belt", "watch", "jewelry",
            "outfit", "suit", "uniform", "costume",
        ]

        # Check if appearance contains clothing keywords
        has_clothing = any(kw in appearance_lower for kw in clothing_keywords)
        if not has_clothing:
            return ""

        # Filter out face/body parts, keep clothing
        # Split by comma and filter
        parts = appearance.split(",")
        clothing_parts = []

        for part in parts:
            part_lower = part.lower().strip()
            # Skip if it contains face/body keywords
            if any(fb in part_lower for fb in face_body_keywords):
                continue
            # Keep if it contains clothing keywords or "wearing"
            if any(ck in part_lower for ck in clothing_keywords) or "wearing" in part_lower:
                clothing_parts.append(part.strip())

        if clothing_parts:
            return ", ".join(clothing_parts)

        return ""

    def extract_additional_details(self, scene: dict) -> str:
        """
        Extract additional details: lighting, mood, style tokens.

        These enhance the scene without duplicating appearance info.

        Args:
            scene: SEALCAM+ scene data

        Returns:
            Additional details string
        """
        parts = []

        # 1. Lighting
        lighting = scene.get("lighting", {})
        if isinstance(lighting, dict):
            setup = lighting.get("setup", "")
            quality = lighting.get("quality", "")
            direction = lighting.get("direction", "")

            lighting_parts = []
            if setup:
                lighting_parts.append(setup)
            if quality and quality.lower() not in str(setup).lower():
                lighting_parts.append(quality)
            if direction and direction.lower() not in str(setup).lower():
                lighting_parts.append(direction)

            if lighting_parts:
                parts.append(", ".join(lighting_parts))
        elif lighting:
            parts.append(str(lighting))

        # 2. Mood (from environment or lighting)
        env = scene.get("environment", {})
        if isinstance(env, dict):
            mood = env.get("mood", "")
            if mood:
                parts.append(mood)

        # 3. Style tokens (metatokens)
        metatokens = scene.get("metatokens", {})
        if isinstance(metatokens, dict):
            visual_style = metatokens.get("visual_style", "")
            quality = metatokens.get("quality", "")
            mood = metatokens.get("mood", "")

            style_parts = []
            if visual_style:
                style_parts.append(visual_style)
            if quality:
                style_parts.append(quality)
            if mood and mood not in str(visual_style):
                style_parts.append(mood)

            if style_parts:
                parts.append(", ".join(style_parts))
        elif metatokens:
            parts.append(str(metatokens))

        return ". ".join(filter(None, parts))

    def extract_negative_prompt(
        self,
        scene: dict,
        character_id: int | None = None,
        character_name: str | None = None
    ) -> str:
        """
        Extract or generate negative prompt with character-specific anti-patterns.

        v2.28: Now includes character-specific negative prompts from registry.

        Args:
            scene: SEALCAM+ scene data
            character_id: Optional character ID for character-specific negatives
            character_name: Optional character name for character-specific negatives

        Returns:
            Negative prompt string including character-specific anti-patterns
        """
        # Check if scene has explicit negative prompt
        base_negative = scene.get("negative_prompt", "")
        if not base_negative:
            base_negative = DEFAULT_NEGATIVE_PROMPT

        # Ensure core items are included
        if "no text" not in base_negative.lower():
            base_negative += ", no text"
        if "no logos" not in base_negative.lower():
            base_negative += ", no logos"
        if "clean plate" not in base_negative.lower():
            base_negative += ", clean plate"

        # Add character-specific negative prompts
        if character_id or character_name:
            return build_negative_prompt_with_character(
                base_negative,
                character_id=character_id,
                character_name=character_name,
                include_global=True
            )

        return base_negative

    # ========================================================================
    # Style Recommendations
    # ========================================================================

    def recommend_style_preset(self, scene: dict) -> str | None:
        """
        Recommend Go Bananas style preset based on scene data.

        Args:
            scene: SEALCAM+ scene data

        Returns:
            Style preset name or None
        """
        # Extract style keywords from metatokens
        metatokens = scene.get("metatokens", {})
        if isinstance(metatokens, dict):
            visual_style = metatokens.get("visual_style", "").lower()
            mood = metatokens.get("mood", "").lower()
            combined = f"{visual_style} {mood}"
        elif metatokens:
            combined = str(metatokens).lower()
        else:
            combined = ""

        # Check environment for style hints
        env = scene.get("environment", {})
        if isinstance(env, dict):
            atmosphere = env.get("atmosphere", "").lower()
            combined += f" {atmosphere}"

        # Match against style mapping
        for keyword, preset in STYLE_PRESET_MAPPING.items():
            if keyword in combined:
                return preset

        # Default to cinematic for fashion/editorial content
        subject = scene.get("subject", {})
        if isinstance(subject, dict):
            appearance = subject.get("appearance", "").lower()
            if any(word in appearance for word in ["model", "fashion", "wearing", "dressed"]):
                return "Photo-Realistic Cinematic"

        return None

    def recommend_reference_mode(self, scene: dict) -> str:
        """
        Recommend reference mode for style/composition references.

        Args:
            scene: SEALCAM+ scene data

        Returns:
            "style" for style transfer or "add" for composition
        """
        # Default to style mode for consistency
        # Use "add" only when specific composition elements are needed
        return "style"

    def _get_style_preset_id(self, scene: dict) -> int | None:
        """Get style preset ID if we have a recommended preset."""
        preset_name = self.recommend_style_preset(scene)
        if preset_name:
            return STYLE_PRESET_IDS.get(preset_name)
        return None

    # ========================================================================
    # Legacy Support
    # ========================================================================

    def _build_standalone_scene_prompt(self, scene: dict) -> str:
        """
        Build scene prompt for standalone generation (includes subject).

        For standalone generation without character/product refs, we need
        to include the subject appearance in the prompt.

        Args:
            scene: SEALCAM+ scene data

        Returns:
            Full scene prompt including subject
        """
        parts = []

        # 1. Subject (full appearance for standalone)
        subject = scene.get("subject", {})
        if isinstance(subject, dict):
            appearance = subject.get("appearance", "")
            if appearance:
                parts.append(appearance)
        elif subject:
            parts.append(str(subject))

        # 2. Action/Pose
        action = scene.get("action", {})
        if isinstance(action, dict):
            primary = action.get("primary", "")
            if primary:
                parts.append(primary)
        elif action:
            parts.append(str(action))

        # 3. Environment
        env = scene.get("environment", {})
        if isinstance(env, dict):
            setting = env.get("setting", "")
            if setting:
                parts.append(f"in {setting}")
        elif env:
            parts.append(f"in {env}")

        # 4. Camera framing
        camera = scene.get("camera", {})
        if isinstance(camera, dict):
            shot_type = camera.get("shot_type", "")
            if shot_type:
                parts.append(f"{shot_type} shot")

        return ". ".join(filter(None, parts))

    def _build_legacy_prompt(self, scene: dict) -> str:
        """
        Build legacy full prompt for backward compatibility.

        Args:
            scene: SEALCAM+ scene data

        Returns:
            Full legacy prompt string
        """
        parts = []

        # Subject (full)
        subject = scene.get("subject", {})
        if isinstance(subject, dict):
            parts.append(subject.get("appearance", ""))
        elif subject:
            parts.append(str(subject))

        # Environment
        env = scene.get("environment", {})
        if isinstance(env, dict):
            setting = env.get("setting", "")
            if setting:
                parts.append(f"in {setting}")
        elif env:
            parts.append(f"in {env}")

        # Action
        action = scene.get("action", {})
        if isinstance(action, dict):
            primary = action.get("primary", "")
            if primary:
                parts.append(primary)
        elif action:
            parts.append(str(action))

        # Lighting
        lighting = scene.get("lighting", {})
        if isinstance(lighting, dict):
            setup = lighting.get("setup", "")
            if setup:
                parts.append(f"Lighting: {setup}")
        elif lighting:
            parts.append(f"Lighting: {lighting}")

        # Camera
        camera = scene.get("camera", {})
        if isinstance(camera, dict):
            shot = camera.get("shot_type", "")
            angle = camera.get("angle", "")
            if shot or angle:
                parts.append(f"Camera: {shot}, {angle}".strip(", "))

        # Metatokens
        metatokens = scene.get("metatokens", {})
        if isinstance(metatokens, dict):
            style = metatokens.get("visual_style", "")
            quality = metatokens.get("quality", "")
            if style or quality:
                parts.append(f"{style}, {quality}".strip(", "))
        elif metatokens:
            parts.append(str(metatokens))

        parts.append("no text, no logos, no watermarks, clean plate")

        return ", ".join(filter(None, parts))


# ============================================================================
# Character Variant Analysis
# ============================================================================

# Age-related keywords that indicate age requirements in scene descriptions
AGE_KEYWORDS = {
    # Explicit ages
    "teenager": (13, 19),
    "teen": (13, 19),
    "young adult": (18, 30),
    "young": (18, 30),
    "adult": (25, 45),
    "middle-aged": (40, 55),
    "middle aged": (40, 55),
    "mature": (45, 60),
    "elderly": (65, 85),
    "old": (60, 80),
    "senior": (65, 85),

    # Decade ranges
    "in their 20s": (20, 29),
    "in his 20s": (20, 29),
    "in her 20s": (20, 29),
    "in their 30s": (30, 39),
    "in his 30s": (30, 39),
    "in her 30s": (30, 39),
    "in their 40s": (40, 49),
    "in his 40s": (40, 49),
    "in her 40s": (40, 49),
    "in their 50s": (50, 59),
    "in his 50s": (50, 59),
    "in her 50s": (50, 59),
    "in their 60s": (60, 69),
    "in his 60s": (60, 69),
    "in her 60s": (60, 69),
    "in their 70s": (70, 79),
    "in his 70s": (70, 79),
    "in her 70s": (70, 79),

    # Family relationship indicators (implies age difference)
    "father": (40, 60),
    "dad": (40, 60),
    "mother": (35, 55),
    "mom": (35, 55),
    "grandfather": (60, 85),
    "grandpa": (60, 85),
    "grandmother": (60, 85),
    "grandma": (60, 85),
    "parent": (35, 60),
    "child": (5, 15),
    "kid": (5, 15),
    "baby": (0, 3),
    "toddler": (1, 4),
}

# Appearance-related keywords that require variants
APPEARANCE_KEYWORDS = {
    "beard": "facial_hair",
    "bearded": "facial_hair",
    "clean-shaven": "facial_hair",
    "clean shaven": "facial_hair",
    "mustache": "facial_hair",
    "goatee": "facial_hair",
    "stubble": "facial_hair",

    "gray hair": "hair_color",
    "grey hair": "hair_color",
    "white hair": "hair_color",
    "blonde": "hair_color",
    "brunette": "hair_color",
    "redhead": "hair_color",
    "bald": "hair_style",
    "shaved head": "hair_style",
    "long hair": "hair_style",
    "short hair": "hair_style",
    "curly hair": "hair_style",
}


def extract_age_from_text(text: str) -> tuple | None:
    """
    Extract age range from text description.

    Priority order:
    1. Explicit numeric ages ("50 year old", "aged 45")
    2. Decade patterns ("in his 50s", "in her 40s") - most specific
    3. Family relationship indicators ("father", "grandfather")
    4. Generic age keywords ("young", "elderly", "mature")

    Args:
        text: Text to analyze (e.g., "50 year old man", "father in his 50s")

    Returns:
        Tuple of (min_age, max_age) or None if no age found
    """
    if not text:
        return None

    text_lower = text.lower()
    import re

    # Priority 1: Check for explicit age patterns like "50 year old" or "50-year-old"
    explicit_age = re.search(r'(\d+)\s*(?:-|\s)?year(?:s)?(?:-|\s)?old', text_lower)
    if explicit_age:
        age = int(explicit_age.group(1))
        return (age - 3, age + 3)  # Small range around explicit age

    # Priority 2: Check for "age X" or "aged X"
    age_pattern = re.search(r'age[d]?\s+(\d+)', text_lower)
    if age_pattern:
        age = int(age_pattern.group(1))
        return (age - 3, age + 3)

    # Priority 3: Check for decade patterns FIRST (most specific)
    # These are more specific than generic keywords
    decade_keywords = [
        ("in their 20s", (20, 29)),
        ("in his 20s", (20, 29)),
        ("in her 20s", (20, 29)),
        ("in their 30s", (30, 39)),
        ("in his 30s", (30, 39)),
        ("in her 30s", (30, 39)),
        ("in their 40s", (40, 49)),
        ("in his 40s", (40, 49)),
        ("in her 40s", (40, 49)),
        ("in their 50s", (50, 59)),
        ("in his 50s", (50, 59)),
        ("in her 50s", (50, 59)),
        ("in their 60s", (60, 69)),
        ("in his 60s", (60, 69)),
        ("in her 60s", (60, 69)),
        ("in their 70s", (70, 79)),
        ("in his 70s", (70, 79)),
        ("in her 70s", (70, 79)),
    ]

    # Find ALL decade matches and return the OLDEST one
    # (for family scenes, we want to detect the oldest mismatch)
    found_decades = []
    for keyword, age_range in decade_keywords:
        if keyword in text_lower:
            found_decades.append(age_range)

    if found_decades:
        # Return the oldest age range found (highest midpoint)
        return max(found_decades, key=lambda r: (r[0] + r[1]) / 2)

    # Priority 4: Family relationship indicators
    family_keywords = [
        ("grandfather", (60, 85)),
        ("grandpa", (60, 85)),
        ("grandmother", (60, 85)),
        ("grandma", (60, 85)),
        ("father", (40, 60)),
        ("dad", (40, 60)),
        ("mother", (35, 55)),
        ("mom", (35, 55)),
        ("parent", (35, 60)),
    ]

    for keyword, age_range in family_keywords:
        if keyword in text_lower:
            return age_range

    # Priority 5: Generic age keywords (least specific)
    generic_keywords = [
        ("elderly", (65, 85)),
        ("senior", (65, 85)),
        ("old", (60, 80)),
        ("middle-aged", (40, 55)),
        ("middle aged", (40, 55)),
        ("mature", (45, 60)),
        ("adult", (25, 45)),
        ("young adult", (18, 30)),
        ("young", (18, 30)),
        ("teenager", (13, 19)),
        ("teen", (13, 19)),
        ("child", (5, 15)),
        ("kid", (5, 15)),
        ("baby", (0, 3)),
        ("toddler", (1, 4)),
    ]

    for keyword, age_range in generic_keywords:
        if keyword in text_lower:
            return age_range

    return None


def extract_appearance_changes(text: str) -> list[str]:
    """
    Extract appearance change requirements from text.

    Args:
        text: Text to analyze

    Returns:
        List of change types needed (e.g., ["facial_hair", "hair_color"])
    """
    if not text:
        return []

    text_lower = text.lower()
    changes = set()

    for keyword, change_type in APPEARANCE_KEYWORDS.items():
        if keyword in text_lower:
            changes.add(change_type)

    return list(changes)


@dataclass
class CharacterMatchResult:
    """Result of character match analysis for a scene."""
    scene_number: int
    match: bool
    reason: str
    character_age_range: tuple | None = None
    scene_age_range: tuple | None = None
    appearance_changes: list[str] = field(default_factory=list)
    suggested_variant_name: str | None = None
    variant_prompt: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "scene_number": self.scene_number,
            "match": self.match,
            "reason": self.reason,
            "character_age_range": self.character_age_range,
            "scene_age_range": self.scene_age_range,
            "appearance_changes": self.appearance_changes,
            "suggested_variant_name": self.suggested_variant_name,
            "variant_prompt": self.variant_prompt,
        }


def analyze_character_match(
    scene: dict,
    character_info: dict,
    scene_number: int = 1,
) -> CharacterMatchResult:
    """
    Analyze if scene requirements match character reference appearance.

    When using Go Bananas character references, the model cannot reconcile
    mismatches between reference appearance and prompt requirements. This
    function detects such mismatches and suggests creating variant characters.

    Args:
        scene: SEALCAM+ scene data with subject/action/environment
        character_info: Character info dict with:
            - name: Character name
            - base_prompt: Character's base prompt (describes their appearance)
            - description: Optional description
        scene_number: Scene number for reporting

    Returns:
        CharacterMatchResult with match status and variant suggestions
    """
    # Extract subject description from scene
    subject = scene.get("subject", {})
    if isinstance(subject, dict):
        subject_text = subject.get("appearance", "")
    else:
        subject_text = str(subject) if subject else ""

    # Also check action for age indicators
    action = scene.get("action", {})
    if isinstance(action, dict):
        action_text = action.get("primary", "")
    else:
        action_text = str(action) if action else ""

    combined_scene_text = f"{subject_text} {action_text}"

    # Extract character age from base_prompt
    char_name = character_info.get("name", character_info.get("character_name", "Character"))
    char_base_prompt = character_info.get("base_prompt", "")
    char_description = character_info.get("description", "")
    char_text = f"{char_base_prompt} {char_description}"

    char_age = extract_age_from_text(char_text)
    scene_age = extract_age_from_text(combined_scene_text)

    # Check for appearance change requirements
    appearance_changes = extract_appearance_changes(combined_scene_text)

    # Analyze match
    reasons = []
    needs_variant = False

    # Check age mismatch
    if char_age and scene_age:
        char_mid = (char_age[0] + char_age[1]) / 2
        scene_mid = (scene_age[0] + scene_age[1]) / 2
        age_diff = abs(char_mid - scene_mid)

        # If age difference is more than 15 years, likely needs variant
        if age_diff > 15:
            needs_variant = True
            reasons.append(
                f"Age mismatch: character is ~{int(char_mid)}yo, "
                f"scene requires ~{int(scene_mid)}yo"
            )
    elif scene_age and not char_age:
        # Scene specifies age but character doesn't have explicit age
        # Check if scene age is significantly different from typical "young adult"
        scene_mid = (scene_age[0] + scene_age[1]) / 2
        if scene_mid > 40:  # Assume character refs are typically young
            needs_variant = True
            reasons.append(f"Scene requires age ~{int(scene_mid)} but character age unknown")

    # Check appearance changes
    if appearance_changes:
        needs_variant = True
        reasons.append(f"Appearance changes needed: {', '.join(appearance_changes)}")

    # Build result
    if needs_variant:
        # Generate variant suggestions
        suggested_name = char_name
        variant_prompt_parts = [char_name]

        if scene_age:
            scene_mid = int((scene_age[0] + scene_age[1]) / 2)
            suggested_name = f"{char_name} {scene_mid}"
            variant_prompt_parts.append(f"at {scene_mid} years old")

            # Add age-appropriate descriptors
            if scene_mid >= 60:
                variant_prompt_parts.append("elderly, gray hair, weathered features")
            elif scene_mid >= 45:
                variant_prompt_parts.append("mature, distinguished, gray at temples")
            elif scene_mid >= 35:
                variant_prompt_parts.append("mature features, experienced look")

        if "facial_hair" in appearance_changes:
            # Check what type
            if "beard" in combined_scene_text.lower():
                variant_prompt_parts.append("with full beard")
            elif "clean" in combined_scene_text.lower():
                variant_prompt_parts.append("clean-shaven")

        if "hair_color" in appearance_changes:
            if "gray" in combined_scene_text.lower() or "grey" in combined_scene_text.lower():
                variant_prompt_parts.append("gray hair")
            elif "white" in combined_scene_text.lower():
                variant_prompt_parts.append("white hair")

        variant_prompt_parts.append("portrait headshot, professional lighting")
        variant_prompt = ", ".join(variant_prompt_parts)

        return CharacterMatchResult(
            scene_number=scene_number,
            match=False,
            reason="; ".join(reasons),
            character_age_range=char_age,
            scene_age_range=scene_age,
            appearance_changes=appearance_changes,
            suggested_variant_name=suggested_name,
            variant_prompt=variant_prompt,
        )
    else:
        return CharacterMatchResult(
            scene_number=scene_number,
            match=True,
            reason="No age or appearance mismatch detected",
            character_age_range=char_age,
            scene_age_range=scene_age,
        )


def analyze_all_scenes_character_match(
    scenes: list[dict],
    character_info: dict,
) -> dict[str, Any]:
    """
    Analyze all scenes for character match and suggest variants.

    Args:
        scenes: List of SEALCAM+ scene data
        character_info: Character info dict

    Returns:
        Dict with analysis results:
        {
            "character_name": "Ram Patel",
            "character_age_range": (18, 25),
            "total_scenes": 5,
            "matches": 3,
            "mismatches": 2,
            "needed_variants": ["Ram Patel 50", "Ram Patel 70"],
            "scene_results": [CharacterMatchResult, ...],
            "variant_commands": [{"name": "...", "prompt": "...", "for_scenes": [2, 3]}, ...]
        }
    """
    char_name = character_info.get("name", character_info.get("character_name", "Character"))

    results = []
    variants_needed = {}  # variant_name -> {"prompt": ..., "scenes": [...]}

    for i, scene in enumerate(scenes, 1):
        result = analyze_character_match(scene, character_info, scene_number=i)
        results.append(result)

        if not result.match and result.suggested_variant_name:
            variant_name = result.suggested_variant_name
            if variant_name not in variants_needed:
                variants_needed[variant_name] = {
                    "prompt": result.variant_prompt,
                    "scenes": [],
                }
            variants_needed[variant_name]["scenes"].append(i)

    # Build variant commands
    variant_commands = []
    for name, info in variants_needed.items():
        variant_commands.append({
            "name": name,
            "prompt": info["prompt"],
            "for_scenes": info["scenes"],
        })

    # Extract character age from first result that has it
    char_age = None
    for r in results:
        if r.character_age_range:
            char_age = r.character_age_range
            break

    return {
        "character_name": char_name,
        "character_age_range": char_age,
        "total_scenes": len(scenes),
        "matches": sum(1 for r in results if r.match),
        "mismatches": sum(1 for r in results if not r.match),
        "needed_variants": list(variants_needed.keys()),
        "scene_results": [r.to_dict() for r in results],
        "variant_commands": variant_commands,
    }


def print_character_match_report(analysis: dict[str, Any]) -> None:
    """
    Print a formatted character match analysis report.

    Args:
        analysis: Result from analyze_all_scenes_character_match()
    """
    print("\n" + "=" * 60)
    print("CHARACTER MATCH ANALYSIS")
    print("=" * 60)

    print(f"\nCharacter: {analysis['character_name']}")
    if analysis['character_age_range']:
        age_range = analysis['character_age_range']
        print(f"Base prompt age: ~{(age_range[0] + age_range[1]) // 2} years old")

    print(f"\nTotal scenes: {analysis['total_scenes']}")
    print(f"Matches: {analysis['matches']}")
    print(f"Mismatches: {analysis['mismatches']}")

    print("\n" + "-" * 60)
    print("SCENE ANALYSIS")
    print("-" * 60)

    for result in analysis['scene_results']:
        status = "✓ MATCH" if result['match'] else "✗ MISMATCH"
        print(f"\nScene {result['scene_number']}: {status}")
        print(f"  Reason: {result['reason']}")
        if result['suggested_variant_name']:
            print(f"  → Suggested variant: {result['suggested_variant_name']}")
            print(f"  → Variant prompt: {result['variant_prompt']}")

    if analysis['variant_commands']:
        print("\n" + "-" * 60)
        print("RECOMMENDED VARIANTS TO CREATE")
        print("-" * 60)

        for i, variant in enumerate(analysis['variant_commands'], 1):
            print(f"\n{i}. {variant['name']}")
            print(f"   For scenes: {variant['for_scenes']}")
            print(f"   Prompt: {variant['prompt']}")

        print("\n" + "-" * 60)
        print("MCP COMMANDS TO CREATE VARIANTS")
        print("-" * 60)

        for variant in analysis['variant_commands']:
            print(f"""
# Create {variant['name']}
# Step 1: Generate aged version
mcp__go-bananas__generate_image(
    prompt="{variant['prompt']}",
    character_id=<ORIGINAL_CHARACTER_ID>,
    aspect_ratio="9:16",
    model_id="gemini-pro-image"
)

# Step 2: Create new character from result
mcp__go-bananas__create_character(
    character_name="{variant['name']}",
    base_prompt="{variant['prompt']}",
    reference_image_ids=[<GENERATED_IMAGE_ID>],
    description="Variant for scenes {variant['for_scenes']}"
)
""")

    print("\n" + "=" * 60)


# ============================================================================
# Convenience Functions
# ============================================================================

def build_gobananas_prompt(
    scene: dict,
    character_id: int | None = None,
    character_ids: list[int] | None = None,
    product_id: int | None = None,
    aspect_ratio: str = "9:16",
) -> GoBananasPrompt:
    """
    Convenience function to build Go Bananas prompt with appropriate method.

    Args:
        scene: SEALCAM+ scene data
        character_id: Single character ID
        character_ids: Multiple character IDs (2-5)
        product_id: Product ID
        aspect_ratio: Target aspect ratio

    Returns:
        GoBananasPrompt configured for the appropriate generation method
    """
    builder = GoBananasPromptBuilder(default_aspect_ratio=aspect_ratio)

    if character_ids and len(character_ids) >= 2:
        return builder.build_multi_character_prompt(scene, character_ids, aspect_ratio)
    elif character_id:
        return builder.build_character_prompt(scene, character_id, aspect_ratio)
    elif product_id:
        return builder.build_product_prompt(scene, product_id, aspect_ratio)
    else:
        return builder.build_standalone_prompt(scene, aspect_ratio)


def scene_to_gobananas_dict(
    scene: dict,
    character_id: int | None = None,
    aspect_ratio: str = "9:16",
) -> dict[str, Any]:
    """
    Convert SEALCAM+ scene to Go Bananas-ready dictionary.

    This is the main integration point for rewrite_prompts.py.

    Args:
        scene: SEALCAM+ scene data
        character_id: Character ID if using character reference
        aspect_ratio: Target aspect ratio

    Returns:
        Dictionary with Go Bananas parameters
    """
    prompt = build_gobananas_prompt(scene, character_id=character_id, aspect_ratio=aspect_ratio)
    return prompt.to_dict()


# ============================================================================
# CLI Entry Point (for testing)
# ============================================================================

if __name__ == "__main__":

    # Example scene data for testing
    example_scene = {
        "scene_number": 1,
        "subject": {
            "appearance": "Young adult male, fair skin, short dark hair, wearing sunglasses, an olive green hooded winter jacket, matching leggings"
        },
        "environment": {
            "setting": "Snowy mountain backdrop with pine forest",
            "atmosphere": "Pristine winter wonderland"
        },
        "action": {
            "primary": "Walking from left to right in profile view",
            "path": "striding through fresh snow"
        },
        "lighting": {
            "setup": "Bright winter daylight",
            "quality": "Soft diffused light from overcast sky",
            "direction": "Front-lit"
        },
        "camera": {
            "shot_type": "Medium full",
            "angle": "Eye level",
            "movement_type": "tracking"
        },
        "metatokens": {
            "visual_style": "Fashion editorial",
            "quality": "Cinematic, 8K",
            "mood": "Sophisticated, elegant"
        },
        "duration_seconds": 4
    }

    print("=" * 60)
    print("Go Bananas Prompt Builder - Example Output")
    print("=" * 60)

    # Build character prompt
    builder = GoBananasPromptBuilder()
    prompt = builder.build_character_prompt(example_scene, character_id=27)

    print("\n--- Character Generation (ID: 27) ---")
    print(f"\nscene_prompt:\n  {prompt.scene_prompt}")
    print(f"\nadditional_details:\n  {prompt.additional_details}")
    print(f"\nnegative_prompt:\n  {prompt.negative_prompt}")
    print(f"\naspect_ratio: {prompt.aspect_ratio}")
    print(f"style_preset: {prompt.style_preset_name}")
    print(f"generation_method: {prompt.generation_method}")

    print("\n--- MCP Command ---")
    print(prompt.to_mcp_command(character_id=27))

    print("\n--- MCP Dict ---")
    print(json.dumps(prompt.to_mcp_dict(character_id=27), indent=2))

    print("\n--- Standalone Generation (no refs) ---")
    standalone = builder.build_standalone_prompt(example_scene)
    print(f"\nscene_prompt:\n  {standalone.scene_prompt}")
    print("\nMCP Command:")
    print(standalone.to_mcp_command())
