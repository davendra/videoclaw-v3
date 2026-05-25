# .claude/skills/video-replicator/scripts/storyboard_prompts.py
"""
Storyboard Prompt Builder - Generate Go Bananas prompts for 3x3 grid images.

Assembles complete prompts from:
- Character references and descriptions
- Template panel structures
- Environment descriptions
- Dialogue hints for facial expressions
"""


from exceptions import ValidationError
from storyboard_templates import build_panel_description, get_template

GRID_PROMPT_TEMPLATE = """REFERENCE IMAGES
Use the uploaded image(s) as reference for location, lighting, color grading, mood, style, and environment. Use the uploaded characters as character references. Keep characters consistent across all panels.

WORLD & ENVIRONMENT
{environment}

CHARACTERS
{characters}

STORYBOARD STRUCTURE
CRITICAL: Create a SQUARE image (1:1 aspect ratio) containing exactly 9 panels in a 3×3 uniform grid.
- 3 rows, 3 columns, all panels EQUAL SIZE
- Thin black borders (3px) between panels
- The overall image MUST be square, NOT portrait or landscape
{aspect_instruction}

{panels}

{dialogue_section}
STYLE
Cinematic, photorealistic, consistent lighting across all panels, professional film storyboard quality. No text or captions in panels."""


ASPECT_INSTRUCTIONS = {
    "16:9": "Each panel should have landscape (16:9) composition suitable for widescreen video.",
    "9:16": "Each panel should have portrait (9:16) composition suitable for vertical video (TikTok/Reels).",
    "1:1": "Each panel should have square (1:1) composition.",
}


def format_character_descriptions(characters: list[dict]) -> str:
    """
    Format character list for prompt.

    Args:
        characters: List of dicts with 'name' and 'description' keys

    Returns formatted string.
    """
    if not characters:
        return "No specific characters - use generic figures."

    lines = []
    for i, char in enumerate(characters):
        name = char.get("name", f"Character {i+1}")
        desc = char.get("description", "")
        lines.append(f"- **{name}**: {desc}")

    return "\n".join(lines)


def format_dialogue_hints(hints: dict[int, str]) -> str:
    """
    Format dialogue hints for panels.

    Args:
        hints: Dict mapping panel number (1-9) to dialogue text

    Returns formatted section or empty string if no hints.
    """
    if not hints:
        return ""

    lines = ["DIALOGUE HINTS (for facial expressions)"]
    for panel_num in sorted(hints.keys()):
        lines.append(f"- Panel {panel_num}: {hints[panel_num]}")
    lines.append("")

    return "\n".join(lines)


def build_panel_section(
    template_id: str,
    character_a: str = "Character A",
    character_b: str = "Character B",
    environment: str = "",
) -> str:
    """
    Build the 9-panel description section.

    Args:
        template_id: Template to use
        character_a: Name of first character
        character_b: Name of second character
        environment: Environment description

    Returns formatted panel descriptions.
    """
    template = get_template(template_id)
    if not template:
        raise ValidationError(f"Unknown template: {template_id}")

    lines = []
    for panel in template["panels"]:
        desc = build_panel_description(
            template_id=template_id,
            panel_number=panel["number"],
            character_a_name=character_a,
            character_b_name=character_b,
            environment=environment,
        )
        lines.append(f"{panel['number']}) {panel['shot_type']}")
        lines.append(desc)
        lines.append("")

    return "\n".join(lines)


def build_grid_prompt(
    characters: list[dict],
    template_id: str,
    environment: str,
    aspect_ratio: str = "16:9",
    dialogue_hints: dict[int, str] | None = None,
) -> str:
    """
    Build complete Go Bananas prompt for 3x3 storyboard grid.

    Args:
        characters: List of character dicts with 'name' and 'description'
        template_id: Template ID (e.g., "dialogue_confrontation")
        environment: Scene environment description
        aspect_ratio: "16:9", "9:16", or "1:1"
        dialogue_hints: Optional dict mapping panel numbers to dialogue

    Returns complete prompt string.
    """
    # Get character names for panel descriptions
    char_a = characters[0]["name"] if characters else "Character A"
    char_b = characters[1]["name"] if len(characters) > 1 else "Character B"

    # Build sections
    char_desc = format_character_descriptions(characters)
    panels = build_panel_section(template_id, char_a, char_b, environment)
    dialogue = format_dialogue_hints(dialogue_hints or {})
    aspect_inst = ASPECT_INSTRUCTIONS.get(aspect_ratio, ASPECT_INSTRUCTIONS["16:9"])

    # Assemble
    prompt = GRID_PROMPT_TEMPLATE.format(
        environment=environment,
        characters=char_desc,
        aspect_instruction=aspect_inst,
        panels=panels,
        dialogue_section=dialogue,
    )

    return prompt.strip()


def build_motion_prompt(
    template_id: str,
    panel_number: int,
    image_description: str = "",
) -> str:
    """
    Build video generation motion prompt for a panel.

    Combines template default motion with optional AI-refined description.

    Args:
        template_id: Template ID
        panel_number: Panel number (1-9)
        image_description: Optional AI description of the specific image

    Returns motion prompt for video generation.
    """
    template = get_template(template_id)
    if not template:
        return "Camera static, minimal motion."

    panel = None
    for p in template["panels"]:
        if p["number"] == panel_number:
            panel = p
            break

    if not panel:
        return "Camera static, minimal motion."

    motion = panel["default_motion"]

    # Build prompt
    parts = [f"Camera: {motion}."]

    if image_description:
        parts.append(image_description)

    return " ".join(parts)
