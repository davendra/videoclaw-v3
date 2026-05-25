#!/usr/bin/env python3
"""
Storyboard Grid Generator - Generate 9-panel cinematic storyboards with character consistency.

This script orchestrates the storyboard generation workflow:
1. Phase 1: Generate Go Bananas prompt for 3x3 grid
2. Phase 2: Split grid into reference panels + generate dialogue
3. Phase 2.5 (NEW): Create character references for consistency
4. Phase 3: Generate production images using character_ids
5. Phase 4: Generate videos (parallel_video_gen.py)
6. Phase 5: Stitch final video (stitch_video.py)

Usage:
    # Phase 1: Generate Go Bananas prompt for storyboard grid
    python generate_storyboard.py --project "my-story" \
        --character-ids 27,28 \
        --template dialogue_confrontation \
        --premise "Two survivors argue" \
        --environment "Desert badlands" \
        --yes

    # Phase 2: Split grid into reference panels
    python generate_storyboard.py --project "my-story" --grid-image "grid.jpg"

    # Phase 2.5: Create character references (for consistent scene generation)
    python generate_storyboard.py --project "my-story" \
        --create-characters \
        --characters '[{"name":"Kai","age":12,"gender":"boy","hair":"dark messy","outfit":"blue hoodie"},
                      {"name":"Lena","age":12,"gender":"girl","hair":"dark ponytail","outfit":"red striped shirt"}]' \
        --style "Disney Pixar 3D animated"

    # Phase 3: Generate production images using character_ids
    python generate_storyboard.py --project "my-story" \
        --generate-scenes \
        --character-ids 95,96

    # List templates
    python generate_storyboard.py --list-templates
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Add scripts dir to path
sys.path.insert(0, str(Path(__file__).parent))

from config import STORYBOARD_PANELS_FILE
from exceptions import MissingDependencyError, ValidationError
from logging_config import setup_logging
from utils_project import get_current_run_id

# Module-level logger — verbose can be enabled via setup_logging(__name__, verbose=True)
logger = setup_logging(__name__)

from split_grid import split_grid_to_scene_images, validate_grid_image
from storyboard_prompts import build_grid_prompt, build_motion_prompt
from storyboard_templates import get_template, get_template_names

try:
    from google import genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False


# =============================================================================
# Configuration
# =============================================================================

@dataclass
class CharacterDefinition:
    """Definition for a character to be created in Go Bananas."""
    name: str
    age: int = 25
    gender: str = "person"  # boy, girl, man, woman, person
    hair: str = "dark"
    outfit: str = ""
    skin_tone: str = "medium"
    extra_details: str = ""

    def to_prompt(self, style: str = "") -> str:
        """Convert to a Go Bananas prompt for character portrait."""
        age_desc = f"{self.age}-year-old" if self.age else ""
        parts = [
            f"Image of a {age_desc} {self.gender}",
        ]
        if style:
            parts[0] += f", {style} style"
        if self.hair:
            parts.append(f"{self.hair} hair")
        if self.skin_tone:
            parts.append(f"{self.skin_tone} skin tone")
        if self.outfit:
            parts.append(f"wearing {self.outfit}")
        if self.extra_details:
            parts.append(self.extra_details)
        parts.append("Portrait shot, warm lighting, clean background.")
        return ", ".join(parts)


@dataclass
class StoryboardConfig:
    """Configuration for storyboard generation."""
    project: str
    characters: list[dict]
    template_id: str
    environment: str
    aspect_ratio: str
    premise: str
    dialogue_beats: list[str] = field(default_factory=list)
    character_ids: list[int] = field(default_factory=list)  # Go Bananas IDs
    style: str = "Disney Pixar 3D animated"  # Art style for consistency
    system_instruction: str = ""  # Style guidance for all generations


def validate_storyboard_config(config: StoryboardConfig) -> tuple[bool, str]:
    """Validate storyboard configuration. Returns (valid, error_message)."""
    if not config.characters:
        return False, "At least one characters entry is required"

    if not get_template(config.template_id):
        valid_templates = ", ".join(get_template_names())
        return False, f"Invalid template '{config.template_id}'. Valid: {valid_templates}"

    if config.aspect_ratio not in ["16:9", "9:16", "1:1"]:
        return False, f"Invalid aspect ratio '{config.aspect_ratio}'. Use 16:9, 9:16, or 1:1"

    if not config.premise:
        return False, "Story premise is required"

    if not config.environment:
        return False, "Environment description is required"

    return True, ""


# =============================================================================
# Gemini API Helpers
# =============================================================================

def call_gemini_api(prompt: str, system_prompt: str = "") -> dict:
    """Call Gemini API and parse JSON response."""
    if not GEMINI_AVAILABLE:
        raise MissingDependencyError("google-genai not installed. Run: pip install google-genai")

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValidationError("GOOGLE_API_KEY not set")

    client = genai.Client(api_key=api_key)

    full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=full_prompt,
    )

    # Extract JSON from response
    text = response.text
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]

    return json.loads(text.strip())


PREMISE_ANALYSIS_PROMPT = """Analyze this story premise and suggest the best storyboard template.

Available templates:
- dialogue_confrontation: Two+ characters in tense conversation (arguments, negotiations, decisions)
- chase_pursuit: Movement, pursuit, urgency (escapes, races, being followed)
- discovery_reveal: Finding something important (mystery, secrets, plot twists)
- journey_transformation: Travel, personal growth (before/after, training)
- romance_connection: Meeting, bonding, emotional intimacy
- comedy_surprise: Mishaps, unexpected twists, humor
- horror_suspense: Dread, threat, survival
- product_story: Character discovers and benefits from a product

Premise: {premise}
Number of characters: {character_count}

Respond with JSON:
{{
    "template_id": "template_name",
    "confidence": 0.0-1.0,
    "reasoning": "Brief explanation"
}}"""


def analyze_premise_for_template(premise: str, character_count: int) -> dict:
    """Use AI to suggest best template for premise."""
    prompt = PREMISE_ANALYSIS_PROMPT.format(
        premise=premise,
        character_count=character_count,
    )
    return call_gemini_api(prompt)


# =============================================================================
# Character Reference Creation (Phase 2.5)
# =============================================================================

def build_character_prompt(char_def: CharacterDefinition, style: str) -> str:
    """Build a concise prompt for generating a character portrait."""
    return char_def.to_prompt(style)


def build_negative_prompt(char_def: CharacterDefinition) -> str:
    """Build negative prompt based on character definition."""
    negatives = ["realistic", "photorealistic", "text", "watermark"]

    # Add age-appropriate negatives
    if char_def.age and char_def.age < 18:
        negatives.extend(["adult", "mature", "facial hair", "beard", "wrinkles"])

    # Add gender-specific negatives if specified
    if char_def.gender in ["boy", "man"]:
        negatives.extend(["female", "woman", "girl"])
    elif char_def.gender in ["girl", "woman"]:
        negatives.extend(["male", "man", "boy"])

    return ", ".join(negatives)


def save_characters_json(
    characters: list[dict],
    style: str,
    system_instruction: str,
    output_path: str,
) -> str:
    """Save character definitions to characters.json."""
    data = {
        "style": style,
        "system_instruction": system_instruction,
        "characters": characters,
    }
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)
    return output_path


def load_characters_json(project: str) -> dict | None:
    """Load characters.json if it exists."""
    chars_path = Path(f"projects/{project}/storyboard/characters.json")
    if chars_path.exists():
        with open(chars_path) as f:
            return json.load(f)
    return None


def print_character_creation_commands(
    characters: list[CharacterDefinition],
    style: str,
    project: str,
):
    """Print the Go Bananas MCP commands to create character references."""
    print("\n" + "=" * 70)
    print("  PHASE 2.5: CHARACTER REFERENCE CREATION")
    print("=" * 70)
    print(f"\nStyle: {style}")
    print(f"Characters: {len(characters)}")
    print("\n" + "-" * 70)
    print("Step 1: Generate character portraits")
    print("-" * 70)

    for i, char in enumerate(characters, 1):
        prompt = build_character_prompt(char, style)
        negative = build_negative_prompt(char)

        print(f"\n# Character {i}: {char.name}")
        print(f"""mcp__go-bananas__generate_image(
    prompt=\"\"\"{prompt}\"\"\",
    aspect_ratio="portrait",
    negative_prompt="{negative}",
    model_id="gemini-pro-image",
    session_id="{project}-characters"
)""")

    print("\n" + "-" * 70)
    print("Step 2: Create character references from generated portraits")
    print("-" * 70)
    print("\nAfter generating portraits, note the image IDs and run:")

    system_inst = f"{style} style, warm lighting, soft shadows, vibrant colors"

    for i, char in enumerate(characters, 1):
        base_prompt = char.to_prompt("")
        negative = build_negative_prompt(char)

        print(f"\n# Character {i}: {char.name}")
        print(f"""mcp__go-bananas__create_character(
    character_name="{char.name}-{project}",
    base_prompt=\"\"\"{base_prompt}\"\"\",
    description="{char.name} - character for {project}",
    reference_image_ids=[<IMAGE_ID_FROM_STEP_1>],  # Replace with actual ID
    system_instruction="{system_inst}",
    negative_prompt="{negative}",
    preferred_aspect_ratio="16:9",
    tags=["{project}", "storyboard", "animated"]
)""")

    print("\n" + "-" * 70)
    print("Step 3: Save character IDs to characters.json")
    print("-" * 70)
    print(f"""
After creating character references, run:
    python generate_storyboard.py --project "{project}" \\
        --save-character-ids <KAI_ID>,<LENA_ID>

Or manually create projects/{project}/storyboard/characters.json:
{{
    "style": "{style}",
    "system_instruction": "{system_inst}",
    "characters": [
        {{"name": "...", "go_bananas_id": <ID>, "prompt": "..."}},
        ...
    ]
}}
""")


def _build_character_count_prompt(char_ids: list[int], characters_data: dict | None) -> str | None:
    """Build a character count description for anti-duplication.

    Looks up gender info from characters.json to produce specific descriptions
    like 'ONE man and ONE woman' instead of generic 'exactly 2 characters'.
    """
    if not characters_data or len(char_ids) < 2:
        return None

    gender_labels = []
    for char in characters_data.get("characters", []):
        gb_id = char.get("go_bananas_id")
        if gb_id in char_ids:
            gender = char.get("gender", "").lower()
            if gender in ("boy", "male", "man"):
                gender_labels.append("man")
            elif gender in ("girl", "female", "woman"):
                gender_labels.append("woman")
            else:
                gender_labels.append("person")

    if len(gender_labels) == 2:
        return f"ONE {gender_labels[0]} and ONE {gender_labels[1]}"
    elif gender_labels:
        return f"exactly {len(gender_labels)} characters"
    return f"exactly {len(char_ids)} characters"


def print_scene_generation_commands(
    character_ids: list[int],
    template_id: str,
    premise: str,
    environment: str,
    style: str,
    project: str,
):
    """Print Go Bananas MCP commands for generating all 9 scenes."""
    template = get_template(template_id)
    if not template:
        logger.error("Unknown template %s", template_id)
        return

    # Load characters.json for anti-duplication safeguards
    characters_data = load_characters_json(project)

    print("\n" + "=" * 70)
    print("  PHASE 3: SCENE GENERATION WITH CHARACTER REFERENCES")
    print("=" * 70)
    print(f"\nTemplate: {template['name']}")
    print(f"Characters: {character_ids}")
    print(f"Style: {style}")
    print("\nExecute these Go Bananas calls to generate consistent scenes:\n")

    for panel in template["panels"]:
        panel_num = panel["number"]
        shot_type = panel["shot_type"]
        purpose = panel["purpose"]
        description = panel.get("description", "")
        chars_visible = panel.get("characters_visible", "")

        # Build scene prompt
        prompt_parts = [
            f"{shot_type}.",
            description,
            f"Environment: {environment}.",
            f"{style} style.",
        ]
        prompt = " ".join(prompt_parts)

        # Determine which character_ids to use based on panel
        scene_char_ids = []  # Track per-scene character IDs for anti-duplication
        if "none" in chars_visible.lower() or "insert" in shot_type.lower():
            # No characters in this panel
            char_param = ""
            prompt += " No characters visible."
        elif "both" in chars_visible.lower() or "two" in chars_visible.lower():
            # Both characters
            scene_char_ids = list(character_ids)
            char_param = f"character_ids={character_ids},"
        elif "character_a" in chars_visible.lower() or "first" in chars_visible.lower():
            # First character only
            if character_ids:
                scene_char_ids = [character_ids[0]]
            char_param = f"character_id={character_ids[0]}," if character_ids else ""
        elif "character_b" in chars_visible.lower() or "second" in chars_visible.lower():
            # Second character only
            if len(character_ids) > 1:
                scene_char_ids = [character_ids[1]]
                char_param = f"character_id={character_ids[1]},"
            elif character_ids:
                scene_char_ids = [character_ids[0]]
                char_param = f"character_id={character_ids[0]},"
            else:
                char_param = ""
        else:
            # Default: use all characters
            scene_char_ids = list(character_ids)
            if len(character_ids) == 1:
                char_param = f"character_id={character_ids[0]},"
            else:
                char_param = f"character_ids={character_ids},"

        # Anti-duplication safeguard: when 2+ characters, add count constraint to prompt
        negative_prompt = "realistic, photorealistic, text, watermark"
        if len(scene_char_ids) >= 2:
            count_prompt = _build_character_count_prompt(scene_char_ids, characters_data)
            if count_prompt:
                prompt += f" {count_prompt} in frame. No extra characters, no duplicates."
            else:
                prompt += f" Only {len(scene_char_ids)} people in frame. No extra characters, no duplicates."
            negative_prompt += ", duplicates, extra characters, crowd, group"

        print(f"# Scene {panel_num}: {shot_type} - {purpose}")
        print(f"""mcp__go-bananas__generate_image(
    prompt=\"\"\"{prompt}\"\"\",
    {char_param}
    aspect_ratio="16:9",
    model_id="gemini-pro-image",
    negative_prompt="{negative_prompt}",
    session_id="{project}-scenes"
)
""")


def print_enhanced_scene_generation_commands(project: str):
    """Print enhanced Go Bananas MCP commands using storyboard_metadata.json.

    Builds richer prompts from stored metadata, applying character duplication
    safeguards automatically.
    """
    # Load storyboard metadata
    metadata_path = os.path.join("projects", project, "storyboard", "storyboard_metadata.json")
    if not os.path.exists(metadata_path):
        logger.error("storyboard_metadata.json not found at %s", metadata_path)
        logger.error("Run storyboard generation first (Phase 2).")
        sys.exit(1)

    with open(metadata_path) as f:
        metadata = json.load(f)

    template_id = metadata.get("template_id", "")
    premise = metadata.get("premise", "")
    environment = metadata.get("environment", "")
    style = metadata.get("style", "")
    character_ids = metadata.get("character_ids", [])

    if not template_id:
        logger.error("No template_id in storyboard_metadata.json")
        sys.exit(1)

    template = get_template(template_id)
    if not template:
        logger.error("Unknown template '%s'", template_id)
        sys.exit(1)

    # Load characters data for anti-duplication
    characters_data = load_characters_json(project)

    # Get style from characters.json if not in metadata
    if not style and characters_data:
        style = characters_data.get("style", "")
    if not style:
        style = "cinematic"

    print("\n" + "=" * 70)
    print("  ENHANCED SCENE IMAGE GENERATION")
    print("=" * 70)
    print(f"\nProject: {project}")
    print(f"Template: {template['name']}")
    print(f"Premise: {premise[:80]}{'...' if len(premise) > 80 else ''}")
    print(f"Environment: {environment[:80]}{'...' if len(environment) > 80 else ''}")
    print(f"Style: {style}")
    print(f"Characters: {character_ids}")
    print("\nExecute these Go Bananas calls to generate production scene images:\n")

    for panel in template["panels"]:
        panel_num = panel["number"]
        shot_type = panel["shot_type"]
        purpose = panel["purpose"]
        description = panel.get("description", "")
        chars_visible = panel.get("characters_visible", "")

        # Build enhanced prompt with all context
        prompt_parts = [
            "WIDE HORIZONTAL cinematic shot.",
            f"{shot_type}.",
            description,
            f"Scene context: {premise}.",
            f"Environment: {environment}.",
            f"{style} style.",
        ]
        prompt = " ".join(p for p in prompt_parts if p)

        # Determine character IDs for this panel (same logic as existing function)
        scene_char_ids = []
        if "none" in chars_visible.lower() or "insert" in shot_type.lower():
            char_param = ""
            prompt += " No characters visible."
        elif "both" in chars_visible.lower() or "two" in chars_visible.lower():
            scene_char_ids = list(character_ids)
            if len(character_ids) == 1:
                char_param = f"character_id={character_ids[0]},"
            else:
                char_param = f"character_ids={character_ids},"
        elif "character_a" in chars_visible.lower() or "first" in chars_visible.lower():
            if character_ids:
                scene_char_ids = [character_ids[0]]
            char_param = f"character_id={character_ids[0]}," if character_ids else ""
        elif "character_b" in chars_visible.lower() or "second" in chars_visible.lower():
            if len(character_ids) > 1:
                scene_char_ids = [character_ids[1]]
                char_param = f"character_id={character_ids[1]},"
            elif character_ids:
                scene_char_ids = [character_ids[0]]
                char_param = f"character_id={character_ids[0]},"
            else:
                char_param = ""
        else:
            scene_char_ids = list(character_ids)
            if len(character_ids) == 1:
                char_param = f"character_id={character_ids[0]},"
            else:
                char_param = f"character_ids={character_ids},"

        # Anti-duplication safeguard
        negative_prompt = "realistic, photorealistic, text, watermark"
        if len(scene_char_ids) >= 2:
            count_prompt = _build_character_count_prompt(scene_char_ids, characters_data)
            if count_prompt:
                prompt += f" {count_prompt} in frame. No extra characters, no duplicates."
            else:
                prompt += f" Only {len(scene_char_ids)} people in frame. No extra characters, no duplicates."
            negative_prompt += ", duplicates, extra characters, crowd, group"

        print(f"# Scene {panel_num}: {shot_type} - {purpose}")
        print(f"""mcp__go-bananas__generate_image(
    prompt=\"\"\"{prompt}\"\"\",
    {char_param}
    aspect_ratio="16:9",
    model_id="gemini-pro-image",
    negative_prompt="{negative_prompt}",
    session_id="{project}-enhanced-scenes"
)
""")

    print("=" * 70)
    print("After generating, download images to:")
    print(f"  projects/{project}/images/")
    print("Use naming: run001_scene_N_frame.jpg")
    print("=" * 70 + "\n")


# =============================================================================
# Reference Panel Analysis (Phase 3)
# =============================================================================

PANEL_ANALYSIS_PROMPT = """Analyze this storyboard reference panel and generate a detailed prompt for creating a high-quality production image.

Scene context:
- Panel number: {panel_number} of 9
- Shot type: {shot_type}
- Purpose: {purpose}
- Story premise: {premise}
- Environment: {environment}

Analyze the reference image and describe:
1. **Composition**: Camera angle, framing, subject placement
2. **Characters**: Poses, expressions, positioning, clothing visible
3. **Environment**: Setting details, props, background elements
4. **Lighting**: Direction, quality, mood
5. **Color palette**: Dominant colors, mood

Then generate a production prompt that:
- Recreates the exact composition and framing
- Maintains character consistency (will use character_ids)
- Matches the lighting and mood
- Is optimized for Go Bananas image generation
- Excludes face/body details (handled by character reference)
- Focuses on pose, action, environment, and cinematography

Respond with JSON:
{{
    "analysis": {{
        "composition": "description...",
        "characters": "description...",
        "environment": "description...",
        "lighting": "description...",
        "colors": "description..."
    }},
    "production_prompt": "The full prompt for Go Bananas, 2-3 sentences, cinematic and detailed..."
}}"""


def analyze_reference_panel(
    image_path: str,
    panel_number: int,
    template_id: str,
    premise: str,
    environment: str,
) -> dict:
    """Analyze a reference panel with Gemini Vision and generate production prompt."""
    if not GEMINI_AVAILABLE:
        raise MissingDependencyError("google-generativeai not installed")

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValidationError("GOOGLE_API_KEY not set")

    # Get template panel info
    template = get_template(template_id)
    panel_info = next((p for p in template["panels"] if p["number"] == panel_number), None)
    shot_type = panel_info["shot_type"] if panel_info else "unknown"
    purpose = panel_info["purpose"] if panel_info else "unknown"

    # Build prompt
    prompt = PANEL_ANALYSIS_PROMPT.format(
        panel_number=panel_number,
        shot_type=shot_type,
        purpose=purpose,
        premise=premise,
        environment=environment,
    )

    # Load image
    from PIL import Image
    img = Image.open(image_path)

    # Call Gemini Vision
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-3-flash-preview")
    response = model.generate_content([prompt, img])

    # Parse JSON response
    text = response.text
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]

    return json.loads(text.strip())


def generate_production_prompts(
    reference_dir: str,
    template_id: str,
    premise: str,
    environment: str,
    character_ids: list[int],
    run_id: str = "run001",
) -> dict:
    """Analyze all reference panels and generate production image prompts."""
    results = {"panels": {}, "mcp_commands": []}

    for panel_num in range(1, 10):
        # Find reference panel
        ref_path = os.path.join(reference_dir, f"{run_id}_scene_{panel_num}_frame.jpg")
        if not os.path.exists(ref_path):
            logger.warning("Reference panel %d not found: %s", panel_num, ref_path)
            continue

        logger.info("Analyzing panel %d...", panel_num)
        try:
            analysis = analyze_reference_panel(
                image_path=ref_path,
                panel_number=panel_num,
                template_id=template_id,
                premise=premise,
                environment=environment,
            )

            results["panels"][str(panel_num)] = {
                "reference_path": ref_path,
                "analysis": analysis.get("analysis", {}),
                "production_prompt": analysis.get("production_prompt", ""),
            }

            # Build MCP command
            mcp_cmd = {
                "tool": "mcp__go-bananas__generate_image",
                "scene": panel_num,
                "params": {
                    "prompt": analysis.get("production_prompt", ""),
                    "aspect_ratio": "16:9",
                    "model_id": "gemini-pro-image",
                    "reference_images": [ref_path],
                    "reference_mode": "style",
                }
            }

            if len(character_ids) == 1:
                mcp_cmd["params"]["character_id"] = character_ids[0]
            elif len(character_ids) > 1:
                mcp_cmd["params"]["character_ids"] = character_ids

            # Panel 5 is insert shot - no characters
            template = get_template(template_id)
            panel_info = next((p for p in template["panels"] if p["number"] == panel_num), None)
            if panel_info and "insert" in panel_info.get("shot_type", "").lower():
                mcp_cmd["params"].pop("character_id", None)
                mcp_cmd["params"].pop("character_ids", None)

            results["mcp_commands"].append(mcp_cmd)

        except Exception as e:
            logger.warning("Panel %d analysis failed: %s", panel_num, e)
            results["panels"][str(panel_num)] = {"error": str(e)}

    return results


def print_production_mcp_calls(results: dict, output_file: str = None):
    """Print or save the MCP commands for production image generation."""
    print("\n" + "=" * 70)
    print("  PHASE 3: PRODUCTION IMAGE GENERATION")
    print("=" * 70)
    print("\nExecute these Go Bananas calls to generate production-quality images:")
    print("(Each uses the reference panel for composition/style guidance)\n")

    for cmd in results.get("mcp_commands", []):
        scene = cmd.get("scene", "?")
        params = cmd.get("params", {})

        print(f"--- Scene {scene} ---")
        print("mcp__go-bananas__generate_image(")
        print(f'    prompt="""{params.get("prompt", "")}""",')

        if "character_id" in params:
            print(f'    character_id={params["character_id"]},')
        elif "character_ids" in params:
            print(f'    character_ids={params["character_ids"]},')

        print(f'    reference_images=["{params.get("reference_images", [""])[0]}"],')
        print('    reference_mode="style",')
        print(f'    aspect_ratio="{params.get("aspect_ratio", "16:9")}",')
        print('    model_id="gemini-pro-image"')
        print(")\n")

    if output_file:
        with open(output_file, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\n✓ Saved to {output_file}")


DIALOGUE_GENERATION_PROMPT = """Write dialogue/narration for a 9-scene storyboard.

Story premise: {premise}
Template: {template_name} (Arc: {emotional_arc})

Key dialogue beats to include:
{dialogue_beats}

Panel structure:
{panel_structure}

Rules:
- ~20-25 words per scene (fills ~8 seconds of video)
- Match emotional tone to panel type (close-up = intimate, wide = context)
- Include emotional tags for TTS: [softly], [urgently], [whispered], [narrator]
- Panel 5 is INSERT SHOT (no characters) - use [silence] or [narrator]
- Build emotional arc: {emotional_arc}

Respond with JSON:
{{
    "scenes": {{
        "1": "[tag] Dialogue or narration text...",
        "2": "...",
        ...
        "9": "..."
    }}
}}"""


def generate_dialogue_script(
    premise: str,
    template_id: str,
    dialogue_beats: list[str],
) -> dict:
    """Use AI to generate dialogue for all 9 scenes."""
    template = get_template(template_id)
    if not template:
        raise ValidationError(f"Unknown template: {template_id}")

    # Format dialogue beats
    beats_text = "\n".join(f"- {beat}" for beat in dialogue_beats) if dialogue_beats else "None specified"

    # Format panel structure
    panel_lines = []
    for p in template["panels"]:
        panel_lines.append(f"{p['number']}. {p['shot_type']}: {p['purpose']}")
    panel_text = "\n".join(panel_lines)

    prompt = DIALOGUE_GENERATION_PROMPT.format(
        premise=premise,
        template_name=template["name"],
        emotional_arc=template["emotional_arc"],
        dialogue_beats=beats_text,
        panel_structure=panel_text,
    )

    return call_gemini_api(prompt)


# =============================================================================
# Output Generation
# =============================================================================

def save_storyboard_metadata(
    config: StoryboardConfig,
    output_dir: str,
    dialogue: dict,
) -> str:
    """Save storyboard configuration and dialogue to JSON."""
    metadata = {
        "source": "storyboard_generator",
        "template_id": config.template_id,
        "template_name": get_template(config.template_id)["name"],
        "premise": config.premise,
        "environment": config.environment,
        "aspect_ratio": config.aspect_ratio,
        "characters": config.characters,
        "character_ids": config.character_ids,
        "dialogue_beats": config.dialogue_beats,
    }

    # Save main metadata
    metadata_path = os.path.join(output_dir, "storyboard_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)

    # Save dialogue as editable_transcript.json for TTS pipeline
    transcript = {
        "source": "storyboard_generator",
        "premise": config.premise,
        "scenes": dialogue.get("scenes", {}),
    }

    transcript_path = os.path.join(output_dir, "editable_transcript.json")
    with open(transcript_path, "w") as f:
        json.dump(transcript, f, indent=2)

    return metadata_path


def export_storyboard_panels(
    panel_paths: list[str],
    project: str,
    grid_image_url: str | None = None,
) -> str:
    """Export storyboard_panels.json mapping scene numbers to panel image paths.

    This JSON file is consumed by seedance_omni.py and parallel_video_gen.py
    to pass storyboard panels as Seedance IMAGE references.

    Args:
        panel_paths: List of panel image paths from split_grid_to_scene_images()
        project: Project slug
        grid_image_url: Optional URL of the original grid image

    Returns:
        Path to the written storyboard_panels.json file
    """
    from datetime import datetime, timezone

    panels = {}
    for i, path in enumerate(panel_paths, 1):
        panels[str(i)] = {
            "panel_index": i - 1,
            "image_path": path,
            "image_url": None,
        }

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "grid_image_url": grid_image_url,
        "panels": panels,
    }

    output_path = os.path.join("projects", project, STORYBOARD_PANELS_FILE)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    logger.info("Exported storyboard panels JSON to %s (%d panels)", output_path, len(panels))
    return output_path


def save_motion_prompts(
    config: StoryboardConfig,
    output_dir: str,
) -> str:
    """Generate and save motion prompts for video generation."""
    prompts = {}

    for panel_num in range(1, 10):
        prompts[str(panel_num)] = build_motion_prompt(
            template_id=config.template_id,
            panel_number=panel_num,
        )

    prompts_path = os.path.join(output_dir, "motion_prompts.json")
    with open(prompts_path, "w") as f:
        json.dump(prompts, f, indent=2)

    return prompts_path


# =============================================================================
# Main Workflow
# =============================================================================

def run_storyboard_wizard(project: str, interactive: bool = True) -> StoryboardConfig:
    """Run interactive storyboard configuration wizard."""
    print("\n" + "=" * 60)
    print("  STORYBOARD GRID GENERATOR")
    print("=" * 60)

    # This is a placeholder - full interactive implementation would go here
    # For now, return a minimal config that requires CLI args
    raise NotImplementedError("Interactive wizard not yet implemented. Use CLI arguments.")


def ensure_project_dirs(project: str) -> dict:
    """Create project directories and return paths."""
    base = Path(f"projects/{project}")
    dirs = {
        "base": base,
        "storyboard": base / "storyboard",
        "images": base / "images",
        "characters": base / "characters",  # NEW: Character reference images
        "analysis": base / "analysis",
        "audio": base / "audio" / "tts",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return {k: str(v) for k, v in dirs.items()}


def save_pending_state(config: StoryboardConfig, prompt: str, output_dir: str) -> str:
    """Save pending state for phase 2 continuation."""
    state = {
        "status": "pending_grid_image",
        "config": {
            "project": config.project,
            "characters": config.characters,
            "template_id": config.template_id,
            "environment": config.environment,
            "aspect_ratio": config.aspect_ratio,
            "premise": config.premise,
            "dialogue_beats": config.dialogue_beats,
            "character_ids": config.character_ids,
        },
        "prompt": prompt,
    }
    state_path = os.path.join(output_dir, "storyboard_pending.json")
    with open(state_path, "w") as f:
        json.dump(state, f, indent=2)
    return state_path


def load_pending_state(project: str) -> dict | None:
    """Load pending state if exists."""
    state_path = Path(f"projects/{project}/storyboard/storyboard_pending.json")
    if state_path.exists():
        with open(state_path) as f:
            return json.load(f)
    return None


def print_go_bananas_call(prompt: str, character_ids: list[int], aspect_ratio: str):
    """Print the Go Bananas MCP call for Claude to execute."""
    print("\n" + "=" * 70)
    print("  GO BANANAS MCP CALL")
    print("=" * 70)
    print("\n⚠️  IMPORTANT: Grid MUST be SQUARE (1:1) for proper splitting!")
    print("    If Go Bananas outputs portrait/landscape, regenerate with 'square' aspect.\n")
    print("Execute this Go Bananas call to generate the 3×3 storyboard grid:\n")

    # Format character_ids for display
    if len(character_ids) == 1:
        char_param = f'character_id={character_ids[0]}'
    else:
        char_param = f'character_ids={character_ids}'

    print(f"""mcp__go-bananas__generate_image(
    prompt=\"\"\"{prompt}\"\"\",
    {char_param},
    aspect_ratio="square",  # MUST be square for uniform 3×3 grid splitting
    model_id="gemini-pro-image"  # REQUIRED for character consistency
)""")

    print("\n" + "-" * 70)
    print("After generation, verify the image is SQUARE before running Phase 2.")
    print('  python generate_storyboard.py --project "..." --grid-image "<downloaded_grid.jpg>"')
    print("-" * 70 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Generate 9-panel storyboard grid with character consistency",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Phase 1: Generate Go Bananas prompt for storyboard grid
  python generate_storyboard.py --project "my-story" --character-ids 27,28 \\
    --template dialogue_confrontation --premise "Two survivors argue" \\
    --environment "Desert badlands" --yes

  # Phase 2: Split grid into reference panels
  python generate_storyboard.py --project "my-story" --grid-image "grid.jpg"

  # Phase 2.5: Create character references (NEW - for consistent scene generation)
  python generate_storyboard.py --project "my-story" --create-characters \\
    --characters '[{"name":"Kai","age":12,"gender":"boy","hair":"dark messy","outfit":"blue hoodie"}]' \\
    --style "Disney Pixar 3D animated"

  # Phase 2.5b: Save character IDs after creating references
  python generate_storyboard.py --project "my-story" --save-character-ids 95,96

  # Phase 3: Generate production scenes using character_ids
  python generate_storyboard.py --project "my-story" --generate-scenes

  # Phase 3 (legacy): Analyze reference panels for production prompts
  python generate_storyboard.py --project "my-story" --generate-production \\
    --character-ids 27,28

  # List available templates
  python generate_storyboard.py --list-templates
""")

    parser.add_argument("--project", help="Project slug")
    parser.add_argument("--character-ids", help="Go Bananas character IDs (comma-separated)")
    parser.add_argument("--template", dest="template_id", help="Template ID")
    parser.add_argument("--premise", help="Story premise")
    parser.add_argument("--environment", help="Environment description")
    parser.add_argument("--aspect-ratio", default="16:9", choices=["16:9", "9:16", "1:1"])
    parser.add_argument("--dialogue-beats", help="Key dialogue (comma-separated)")
    parser.add_argument("--dry-run", action="store_true", help="Show plan without executing")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmations")
    parser.add_argument("--show-prompt", action="store_true", help="Show generated prompt only")
    parser.add_argument("--list-templates", action="store_true", help="List available templates")
    parser.add_argument("--grid-image", help="Path to generated grid image (Phase 2)")
    parser.add_argument("--generate-production", action="store_true",
                        help="Phase 3 (legacy): Analyze reference panels and generate production image prompts")

    # Phase 2.5: Character Reference Creation
    parser.add_argument("--create-characters", action="store_true",
                        help="Phase 2.5: Print commands to create character references")
    parser.add_argument("--characters", type=str,
                        help='Character definitions as JSON array, e.g. \'[{"name":"Kai","age":12,"gender":"boy","hair":"dark messy","outfit":"blue hoodie"}]\'')
    parser.add_argument("--style", default="Disney Pixar 3D animated",
                        help="Art style for character consistency (default: Disney Pixar 3D animated)")
    parser.add_argument("--save-character-ids", type=str,
                        help="Save character IDs to characters.json (comma-separated)")

    # Phase 3: Scene Generation with character_ids
    parser.add_argument("--generate-scenes", action="store_true",
                        help="Phase 3: Print commands to generate scenes using character_ids from characters.json")
    parser.add_argument("--generate-scene-images", action="store_true",
                        help="Generate enhanced Go Bananas MCP calls from storyboard_metadata.json")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose/debug logging")

    # Storyboard panels export (v2.43)
    parser.add_argument("--export-panels-json", action="store_true", default=True,
                        help="Export storyboard_panels.json after grid split (default: True)")
    parser.add_argument("--no-export-panels-json", action="store_false", dest="export_panels_json",
                        help="Skip exporting storyboard_panels.json")

    args = parser.parse_args()

    # Re-initialize logger with verbose flag if requested
    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    # List templates mode
    if args.list_templates:
        print("\nAvailable Storyboard Templates:\n")
        for name in get_template_names():
            template = get_template(name)
            print(f"  {name}")
            print(f"    {template['description']}")
            print(f"    Arc: {template['emotional_arc']}")
            print(f"    Best for: {template['best_for']}")
            print(f"    Min characters: {template['min_characters']}")
            print()
        return

    # Require project for all other modes
    if not args.project:
        parser.error("--project is required")

    # Ensure project directories exist
    dirs = ensure_project_dirs(args.project)

    # =========================================================================
    # Phase 2.5: Create Character References
    # =========================================================================
    if args.create_characters:
        logger.info("[Phase 2.5] Creating character references for project: %s", args.project)

        # Parse character definitions from JSON
        if not args.characters:
            logger.error("--characters is required with --create-characters")
            logger.error("   Example: --characters '[{\"name\":\"Kai\",\"age\":12,\"gender\":\"boy\",\"hair\":\"dark messy\",\"outfit\":\"blue hoodie\"}]'")
            sys.exit(1)

        try:
            char_data = json.loads(args.characters)
            if not isinstance(char_data, list):
                char_data = [char_data]
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in --characters: %s", e)
            sys.exit(1)

        # Convert to CharacterDefinition objects
        characters = []
        for cd in char_data:
            characters.append(CharacterDefinition(
                name=cd.get("name", f"Character {len(characters)+1}"),
                age=cd.get("age", 25),
                gender=cd.get("gender", "person"),
                hair=cd.get("hair", ""),
                outfit=cd.get("outfit", ""),
                skin_tone=cd.get("skin_tone", "medium"),
                extra_details=cd.get("extra_details", ""),
            ))

        logger.info("Style: %s", args.style)
        logger.info("Characters: %s", [c.name for c in characters])

        # Print the MCP commands
        print_character_creation_commands(characters, args.style, args.project)

        # Save initial characters.json (without IDs yet)
        initial_chars = [
            {
                "name": c.name,
                "go_bananas_id": None,  # To be filled in after creation
                "prompt": c.to_prompt(""),
                "age": c.age,
                "gender": c.gender,
                "hair": c.hair,
                "outfit": c.outfit,
            }
            for c in characters
        ]

        system_inst = f"{args.style} style, warm lighting, soft shadows, vibrant colors"
        chars_path = os.path.join(dirs["storyboard"], "characters.json")
        save_characters_json(initial_chars, args.style, system_inst, chars_path)
        logger.info("Saved character definitions to %s", chars_path)
        logger.info("(go_bananas_id is null - update after creating references)")
        return

    # =========================================================================
    # Phase 2.5b: Save Character IDs
    # =========================================================================
    if args.save_character_ids:
        logger.info("[Phase 2.5b] Saving character IDs for project: %s", args.project)

        # Load existing characters.json
        chars_path = os.path.join(dirs["storyboard"], "characters.json")
        if not os.path.exists(chars_path):
            logger.error("characters.json not found at %s", chars_path)
            logger.error("Run --create-characters first to generate character definitions")
            sys.exit(1)

        with open(chars_path) as f:
            chars_data = json.load(f)

        # Parse IDs
        ids = [int(x.strip()) for x in args.save_character_ids.split(",")]
        characters = chars_data.get("characters", [])

        if len(ids) != len(characters):
            logger.warning("%d IDs provided but %d characters defined", len(ids), len(characters))

        # Update IDs
        for i, char in enumerate(characters):
            if i < len(ids):
                char["go_bananas_id"] = ids[i]
                logger.info("%s: ID = %d", char['name'], ids[i])

        # Save updated file
        with open(chars_path, "w") as f:
            json.dump(chars_data, f, indent=2)

        logger.info("Updated %s with character IDs", chars_path)
        logger.info("Next: Run --generate-scenes to create scene images with character consistency")
        return

    # =========================================================================
    # Phase 3 (enhanced): Generate Scene Images from storyboard_metadata.json
    # =========================================================================
    if args.generate_scene_images:
        print_enhanced_scene_generation_commands(args.project)
        sys.exit(0)

    # =========================================================================
    # Phase 3: Generate Scenes with Character IDs
    # =========================================================================
    if args.generate_scenes:
        logger.info("[Phase 3] Generating scene commands for project: %s", args.project)

        # Load characters.json
        chars_data = load_characters_json(args.project)
        if not chars_data:
            logger.error("characters.json not found")
            logger.error("Run --create-characters and --save-character-ids first")
            sys.exit(1)

        # Extract character IDs
        character_ids = []
        for char in chars_data.get("characters", []):
            cid = char.get("go_bananas_id")
            if cid:
                character_ids.append(cid)
            else:
                logger.warning("%s has no go_bananas_id", char.get('name', 'Unknown'))

        if not character_ids:
            logger.error("No character IDs found in characters.json")
            logger.error("Run --save-character-ids to save Go Bananas character IDs")
            sys.exit(1)

        # Load template from metadata or CLI
        metadata_path = os.path.join(dirs["storyboard"], "storyboard_metadata.json")
        if os.path.exists(metadata_path):
            with open(metadata_path) as f:
                meta = json.load(f)
            template_id = meta.get("template_id", "dialogue_confrontation")
            premise = meta.get("premise", "")
            environment = meta.get("environment", "")
        else:
            template_id = args.template_id or "dialogue_confrontation"
            premise = args.premise or ""
            environment = args.environment or ""

        style = chars_data.get("style", args.style)

        logger.info("Template: %s", template_id)
        logger.info("Character IDs: %s", character_ids)
        logger.info("Style: %s", style)

        # Print scene generation commands
        print_scene_generation_commands(
            character_ids=character_ids,
            template_id=template_id,
            premise=premise,
            environment=environment,
            style=style,
            project=args.project,
        )

        print("\n" + "-" * 70)
        print("After generating scenes, download images to:")
        print(f"  {dirs['images']}/run001_scene_N_frame.jpg")
        print("\nThen generate videos:")
        print(f"  python parallel_video_gen.py --product \"{args.project}\" \\")
        print(f"    --mode frames-to-video --images-dir \"projects/{args.project}/images\" \\")
        print("    --scenes '{\"1\":\"motion prompt\",...}' --ratio landscape --quality fast --yes")
        return

    # Phase 3 (legacy): Generate production image prompts from reference panels
    if args.generate_production:
        logger.info("[Phase 3] Generating production image prompts for project: %s", args.project)

        # Load config from pending state or storyboard metadata
        dirs = ensure_project_dirs(args.project)
        metadata_path = os.path.join(dirs["storyboard"], "storyboard_metadata.json")
        pending = load_pending_state(args.project)

        if pending:
            cfg = pending["config"]
            config = StoryboardConfig(**cfg)
            logger.info("Loaded config from pending state")
        elif os.path.exists(metadata_path):
            with open(metadata_path) as f:
                meta = json.load(f)
            config = StoryboardConfig(
                project=args.project,
                characters=meta.get("characters", []),
                template_id=meta.get("template_id", "dialogue_confrontation"),
                environment=meta.get("environment", ""),
                aspect_ratio=meta.get("aspect_ratio", "16:9"),
                premise=meta.get("premise", ""),
                dialogue_beats=meta.get("dialogue_beats", []),
                character_ids=meta.get("character_ids", []),
            )
            logger.info("Loaded config from storyboard_metadata.json")
        else:
            # Use CLI args
            character_ids = [int(x) for x in args.character_ids.split(",")] if args.character_ids else []
            config = StoryboardConfig(
                project=args.project,
                characters=[],
                template_id=args.template_id or "dialogue_confrontation",
                environment=args.environment or "",
                aspect_ratio=args.aspect_ratio,
                premise=args.premise or "",
                dialogue_beats=[],
                character_ids=character_ids,
            )
            logger.info("Using CLI args")

        # Override character_ids from CLI if provided
        if args.character_ids:
            config.character_ids = [int(x) for x in args.character_ids.split(",")]

        if not config.character_ids:
            logger.error("--character-ids required for Phase 3")
            logger.error("These are the Go Bananas character IDs to use in production images")
            sys.exit(1)

        # Check for reference panels
        ref_dir = dirs["images"]
        ref_panels = [f for f in os.listdir(ref_dir) if f.endswith("_frame.jpg")]
        if not ref_panels:
            logger.error("No reference panels found in %s", ref_dir)
            logger.error("Run Phase 2 first: --grid-image <grid.jpg>")
            sys.exit(1)

        logger.info("Found %d reference panels", len(ref_panels))
        logger.info("Template: %s", config.template_id)
        logger.info("Characters: %s", config.character_ids)

        # Analyze panels and generate prompts
        logger.info("Analyzing reference panels with Gemini Vision...")
        results = generate_production_prompts(
            reference_dir=ref_dir,
            template_id=config.template_id,
            premise=config.premise,
            environment=config.environment,
            character_ids=config.character_ids,
            run_id="run001",
        )

        # Save results
        output_file = os.path.join(dirs["storyboard"], "production_prompts.json")
        print_production_mcp_calls(results, output_file)

        print("\n✅ Phase 3 complete!")
        print("\nNext steps:")
        print("  1. Execute the MCP commands above to generate production images")
        print(f"  2. Download images to {ref_dir}/ with names like run001_scene_N_production.jpg")
        print("  3. Use production images for video generation")
        return

    # Phase 2: Process grid image
    if args.grid_image:
        logger.info("[Phase 2] Processing grid image for project: %s", args.project)

        # Load pending state or use defaults
        pending = load_pending_state(args.project)
        if pending:
            cfg = pending["config"]
            config = StoryboardConfig(**cfg)
            logger.info("Loaded pending config (template: %s)", config.template_id)
        else:
            # Minimal config for splitting
            config = StoryboardConfig(
                project=args.project,
                characters=[],
                template_id=args.template_id or "dialogue_confrontation",
                environment=args.environment or "",
                aspect_ratio=args.aspect_ratio,
                premise=args.premise or "",
                dialogue_beats=[],
                character_ids=[],
            )
            logger.info("Using CLI args (template: %s)", config.template_id)

        # Validate grid image
        if not os.path.exists(args.grid_image):
            logger.error("Grid image not found: %s", args.grid_image)
            sys.exit(1)

        valid, msg = validate_grid_image(args.grid_image)
        if not valid:
            logger.error("Invalid grid image: %s", msg)
            sys.exit(1)

        # Create output directories
        dirs = ensure_project_dirs(args.project)

        # Split grid into scene frames
        logger.info("Splitting grid into 9 panels...")
        run_id = get_current_run_id(str(dirs["base"]))
        panels = split_grid_to_scene_images(
            grid_path=args.grid_image,
            output_dir=dirs["images"],
            aspect_ratio=config.aspect_ratio,
            run_id=run_id,
        )
        logger.info("Created %d scene frames in %s", len(panels), dirs['images'])
        for p in panels:
            logger.debug("  - %s", os.path.basename(p))

        # Export storyboard_panels.json (v2.43) — for Seedance reference
        if getattr(args, "export_panels_json", True):
            export_storyboard_panels(
                panel_paths=panels,
                project=args.project,
                grid_image_url=None,  # URL not available at this point
            )

        # Generate dialogue if we have premise
        dialogue = {"scenes": {}}
        if config.premise and GEMINI_AVAILABLE and os.environ.get("GOOGLE_API_KEY"):
            logger.info("Generating dialogue script...")
            try:
                dialogue = generate_dialogue_script(
                    premise=config.premise,
                    template_id=config.template_id,
                    dialogue_beats=config.dialogue_beats,
                )
                logger.info("Generated dialogue for %d scenes", len(dialogue.get('scenes', {})))
            except Exception as e:
                logger.warning("Dialogue generation failed: %s", e)
                logger.warning("(You can add dialogue manually to editable_transcript.json)")

        # Save outputs
        logger.info("Saving metadata...")
        save_storyboard_metadata(config, dirs["storyboard"], dialogue)
        save_motion_prompts(config, dirs["storyboard"])

        # Copy transcript to TTS dir for pipeline compatibility
        transcript_src = os.path.join(dirs["storyboard"], "editable_transcript.json")
        transcript_dst = os.path.join(dirs["audio"], "editable_transcript.json")
        if os.path.exists(transcript_src):
            import shutil
            shutil.copy2(transcript_src, transcript_dst)
            logger.info("Copied transcript to %s", transcript_dst)

        # Clean up pending state
        pending_path = os.path.join(dirs["storyboard"], "storyboard_pending.json")
        if os.path.exists(pending_path):
            os.remove(pending_path)

        logger.info("Storyboard complete!")
        logger.info("Outputs:")
        logger.info("  Scene frames:     %s/", dirs['images'])
        logger.info("  Motion prompts:   %s/motion_prompts.json", dirs['storyboard'])
        logger.info("  Transcript:       %s/editable_transcript.json", dirs['audio'])
        logger.info("Next steps:")
        logger.info("  1. Review/edit editable_transcript.json for TTS")
        logger.info("  2. Generate TTS: python generate_tts.py --edit ... --voice-name Rachel --yes")
        logger.info("  3. Generate videos: python parallel_video_gen.py --product %s ...", args.project)
        return

    # Phase 1: Build config and generate prompt

    # Build character list from IDs (placeholder names - Go Bananas has the details)
    character_ids = [int(x) for x in args.character_ids.split(",")] if args.character_ids else []
    characters = [{"name": f"Character {i+1}", "description": f"(Go Bananas character_id={cid})"}
                  for i, cid in enumerate(character_ids)]

    config = StoryboardConfig(
        project=args.project,
        characters=characters,
        template_id=args.template_id or "dialogue_confrontation",
        environment=args.environment or "",
        aspect_ratio=args.aspect_ratio,
        premise=args.premise or "",
        dialogue_beats=args.dialogue_beats.split(",") if args.dialogue_beats else [],
        character_ids=character_ids,
    )

    # Validate config
    valid, error = validate_storyboard_config(config)
    if not valid:
        logger.error("Configuration error: %s", error)
        sys.exit(1)

    # Build the Go Bananas prompt
    dialogue_hints = {}
    if config.dialogue_beats:
        for i, beat in enumerate(config.dialogue_beats[:9]):
            dialogue_hints[i + 1] = beat.strip()

    prompt = build_grid_prompt(
        characters=config.characters,
        template_id=config.template_id,
        environment=config.environment,
        aspect_ratio=config.aspect_ratio,
        dialogue_hints=dialogue_hints,
    )

    # Dry-run mode
    if args.dry_run:
        print("\n[DRY RUN] Would generate storyboard with:")
        print(f"  Project: {config.project}")
        print(f"  Template: {config.template_id}")
        print(f"  Aspect Ratio: {config.aspect_ratio}")
        print(f"  Premise: {config.premise}")
        print(f"  Environment: {config.environment}")
        print(f"  Characters: {config.character_ids}")
        print(f"\nPrompt length: {len(prompt)} characters")
        return

    # Show prompt only mode
    if args.show_prompt:
        print("\n" + "=" * 70)
        print("  STORYBOARD GRID PROMPT")
        print("=" * 70)
        print(prompt)
        print("=" * 70)
        return

    # Phase 1 execution
    logger.info("[Phase 1] Preparing storyboard for project: %s", config.project)
    logger.info("Template: %s", config.template_id)
    logger.info("Premise: %s", config.premise[:60] + "..." if len(config.premise) > 60 else config.premise)
    logger.info("Characters: %s", config.character_ids)

    # Create project directories
    dirs = ensure_project_dirs(args.project)

    # Save pending state
    save_pending_state(config, prompt, dirs["storyboard"])
    logger.info("Saved pending state to %s/storyboard_pending.json", dirs['storyboard'])

    # Output the Go Bananas call
    print_go_bananas_call(prompt, config.character_ids, config.aspect_ratio)


if __name__ == "__main__":
    main()
