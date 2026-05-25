#!/usr/bin/env python3
"""
Character Designer — extract characters from screenplays, create Go Bananas
character references with DB persistence, and assign ElevenLabs voices.

Part of the Film Pipeline (v2.37 Wave 4). Takes a Screenplay object and
produces FilmCharacter objects with:
  - Physical descriptions extracted from scene text
  - Role classification (lead / supporting / extra) by frequency
  - Go Bananas MCP commands for portrait generation
  - ElevenLabs voice assignment by gender heuristic
  - Persistent storage via characters.json + db_unified

Usage:
    from character_designer import (
        FilmCharacter,
        extract_characters,
        create_character_references,
        assign_voices,
        save_character_ids,
        write_characters_json,
    )

    # Extract from screenplay
    characters = extract_characters(screenplay)

    # Assign voices
    characters = assign_voices(characters)

    # Generate Go Bananas MCP commands
    commands = create_character_references(characters, style="cinematic")

    # Save after Go Bananas IDs are known
    save_character_ids(characters, project_dir="projects/my-film")

CLI:
    python character_designer.py extract --screenplay screenplay.json
    python character_designer.py references --screenplay screenplay.json --style "Disney Pixar 3D animated"
    python character_designer.py assign-voices --screenplay screenplay.json
    python character_designer.py save-ids --screenplay screenplay.json --ids 95,96,97 --project test
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Ensure scripts/ is on the Python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import PROJECT_BASE
from exceptions import CharacterDesignError

logger = logging.getLogger("character_designer")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s | %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


# ============================================================================
# Voice Presets (ElevenLabs)
# ============================================================================

VOICE_PRESETS: dict[str, list[dict[str, str]]] = {
    "male": [
        {"name": "Daniel", "id": "onwK4e9ZLuTAKqWW03F9"},
        {"name": "Josh", "id": "TxGEqnHWrfWFTfGW9XjX"},
        {"name": "Adam", "id": "pNInz6obpgDQGcFmaJgB"},
        {"name": "Liam", "id": "TX3LPaxmHKxFdv7VOQHJ"},
    ],
    "female": [
        {"name": "Rachel", "id": "21m00Tcm4TlvDq8ikWAM"},
        {"name": "Sarah", "id": "EXAVITQu4vr4xnSDxMaL"},
        {"name": "Emily", "id": "LcfcDJNUP1GQjkzn1xUU"},
    ],
    "neutral": [
        {"name": "Rachel", "id": "21m00Tcm4TlvDq8ikWAM"},
    ],
}

# Keywords that hint at gender in character names or descriptions.
# Explicit gender terms (man, woman, boy, girl) are weighted higher via
# _STRONG_MALE / _STRONG_FEMALE to avoid ties from ambiguous role words.
_MALE_HINTS = {
    "man", "boy", "male", "king", "prince", "father", "dad", "brother",
    "son", "uncle", "husband", "gentleman", "mr", "sir", "lord",
    "he", "his", "him",
}
_FEMALE_HINTS = {
    "woman", "girl", "female", "queen", "princess", "mother", "mom",
    "sister", "daughter", "aunt", "wife", "lady", "mrs", "ms", "miss",
    "heroine", "she", "her", "hers",
}
# Strong indicators get double weight in scoring
_STRONG_MALE = {"man", "boy", "male", "father", "brother", "son", "husband", "king", "prince"}
_STRONG_FEMALE = {"woman", "girl", "female", "mother", "sister", "daughter", "wife", "queen", "princess"}


# ============================================================================
# Data Class
# ============================================================================

@dataclass
class FilmCharacter:
    """Character extracted from a screenplay with production metadata."""

    name: str
    role: str = "supporting"  # "lead", "supporting", "extra"
    description: str = ""  # Physical description from screenplay
    age: int | None = None
    gender: str | None = None
    voice_id: str | None = None  # ElevenLabs voice ID
    voice_name: str | None = None  # ElevenLabs voice name
    go_bananas_character_id: int | None = None
    go_bananas_image_url: str | None = None
    scene_appearances: list[int] = field(default_factory=list)
    character_definition: "CharacterDefinition | None" = None  # noqa: F821

    def to_dict(self) -> dict:
        """Serialize to a JSON-friendly dict."""
        d: dict = {
            "name": self.name,
            "role": self.role,
            "description": self.description,
            "scene_appearances": self.scene_appearances,
        }
        if self.age is not None:
            d["age"] = self.age
        if self.gender is not None:
            d["gender"] = self.gender
        if self.voice_id:
            d["voice_id"] = self.voice_id
        if self.voice_name:
            d["voice_name"] = self.voice_name
        if self.go_bananas_character_id is not None:
            d["go_bananas_character_id"] = self.go_bananas_character_id
        if self.go_bananas_image_url:
            d["go_bananas_image_url"] = self.go_bananas_image_url
        return d

    @classmethod
    def from_dict(cls, data: dict) -> FilmCharacter:
        """Deserialize from a dict."""
        return cls(
            name=data["name"],
            role=data.get("role", "supporting"),
            description=data.get("description", ""),
            age=data.get("age"),
            gender=data.get("gender"),
            voice_id=data.get("voice_id"),
            voice_name=data.get("voice_name"),
            go_bananas_character_id=data.get("go_bananas_character_id"),
            go_bananas_image_url=data.get("go_bananas_image_url"),
            scene_appearances=data.get("scene_appearances", []),
        )


# ============================================================================
# Character Extraction
# ============================================================================

def extract_characters(screenplay) -> list[FilmCharacter]:
    """Extract unique characters from screenplay scenes.

    - Deduplicates by name (case-insensitive)
    - Assigns role based on frequency:
        - appears in 50%+ scenes -> "lead"
        - appears in 20-50% -> "supporting"
        - appears less -> "extra"
    - Extracts description hints from scene descriptions
    - Records scene_appearances for each character

    Args:
        screenplay: Screenplay object (from screenplay_generator.py)

    Returns:
        List of FilmCharacter objects sorted by number of appearances (desc)
    """
    if not screenplay.scenes:
        return []

    # Collect raw character names and their scene appearances
    # key = lowercased name, value = (canonical_name, set of scene_numbers)
    char_map: dict[str, tuple[str, set[int]]] = {}

    for scene in screenplay.scenes:
        for name in scene.characters_present:
            name_stripped = name.strip()
            if not name_stripped:
                continue
            key = name_stripped.lower()
            if key not in char_map:
                char_map[key] = (name_stripped, set())
            char_map[key][1].add(scene.scene_number)

    if not char_map:
        logger.info("No characters found in screenplay scenes")
        return []

    total_scenes = len(screenplay.scenes)

    characters: list[FilmCharacter] = []
    for key, (canonical_name, scene_nums) in char_map.items():
        # Determine role by frequency
        ratio = len(scene_nums) / total_scenes if total_scenes > 0 else 0
        if ratio >= 0.5:
            role = "lead"
        elif ratio >= 0.2:
            role = "supporting"
        else:
            role = "extra"

        # Extract description hints from scene descriptions
        description = _extract_description_hints(canonical_name, screenplay.scenes)

        # Infer gender from name and description context
        gender = _infer_gender(canonical_name, description)

        # Try to extract age hints from description
        age = _extract_age(description)

        characters.append(
            FilmCharacter(
                name=canonical_name,
                role=role,
                description=description,
                age=age,
                gender=gender,
                scene_appearances=sorted(scene_nums),
            )
        )

    # Sort by appearance count (descending), then alphabetically
    characters.sort(key=lambda c: (-len(c.scene_appearances), c.name))

    logger.info(
        "Extracted %d characters from %d scenes: %s",
        len(characters),
        total_scenes,
        ", ".join(f"{c.name} ({c.role})" for c in characters),
    )

    return characters


def _extract_description_hints(name: str, scenes) -> str:
    """Extract physical description hints by searching scene descriptions for character name."""
    hints: list[str] = []
    name_lower = name.lower()

    for scene in scenes:
        desc = scene.description
        if not desc:
            continue

        # Check if this character's name appears in the description
        if name_lower not in desc.lower():
            continue

        # Extract sentences containing the character name
        sentences = re.split(r"[.!?]+", desc)
        for sentence in sentences:
            sentence = sentence.strip()
            if name_lower in sentence.lower() and len(sentence) > 10:
                # Avoid duplicating very similar sentences
                if not any(_text_similarity(sentence, h) > 0.7 for h in hints):
                    hints.append(sentence)

    if not hints:
        return ""

    # Take the first 3 most relevant hints and combine
    return ". ".join(hints[:3])


def _text_similarity(a: str, b: str) -> float:
    """Simple Jaccard similarity between two strings (word-level)."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union) if union else 0.0


def _infer_gender(name: str, description: str) -> str | None:
    """Infer gender from character name and description.

    Uses weighted scoring: strong indicators (man, woman, boy, girl) get
    double weight to avoid ties when ambiguous role words are present.

    Returns "male", "female", or None if uncertain.
    """
    combined = f"{name} {description}".lower()
    words = set(re.findall(r"\b\w+\b", combined))

    male_score = len(words & _MALE_HINTS) + len(words & _STRONG_MALE)
    female_score = len(words & _FEMALE_HINTS) + len(words & _STRONG_FEMALE)

    if male_score > female_score:
        return "male"
    elif female_score > male_score:
        return "female"
    return None


def _extract_age(description: str) -> int | None:
    """Try to extract an age from description text.

    Looks for patterns like "25-year-old", "age 30", "young (20s)".
    """
    if not description:
        return None

    # Pattern: "N-year-old"
    match = re.search(r"(\d{1,3})[- ]?year[- ]?old", description, re.IGNORECASE)
    if match:
        age = int(match.group(1))
        if 1 <= age <= 120:
            return age

    # Pattern: "age N" or "aged N"
    match = re.search(r"\bage[d]?\s+(\d{1,3})\b", description, re.IGNORECASE)
    if match:
        age = int(match.group(1))
        if 1 <= age <= 120:
            return age

    return None


# ============================================================================
# Character Reference Generation (Go Bananas MCP)
# ============================================================================

def create_character_references(
    characters: list[FilmCharacter],
    style: str = "",
    project_dir: str | None = None,
) -> list[dict]:
    """Generate Go Bananas MCP commands for character portrait generation.

    For each character, outputs a dict with:
    - prompt: Portrait prompt (from CharacterDefinition.to_prompt() or generated)
    - character_name: For tracking
    - mcp_command: String representation of the mcp__go-bananas__generate_image call

    Uses CharacterDefinition if available, otherwise builds prompt from
    FilmCharacter description.

    Args:
        characters: List of FilmCharacter objects
        style: Art style (e.g., "Disney Pixar 3D animated", "cinematic")
        project_dir: Optional project directory for session_id

    Returns:
        List of command dicts to be executed by Claude
    """
    commands: list[dict] = []
    session_id = Path(project_dir).name if project_dir else "film-characters"

    for char in characters:
        # Build portrait prompt
        if char.character_definition:
            prompt = char.character_definition.to_prompt(style)
        else:
            prompt = _build_portrait_prompt(char, style)

        # Build negative prompt
        negative_prompt = _build_negative_prompt(char)

        # Build MCP command string
        mcp_cmd = (
            f'mcp__go-bananas__generate_image(\n'
            f'    prompt="""{prompt}""",\n'
            f'    aspect_ratio="portrait",\n'
            f'    negative_prompt="{negative_prompt}",\n'
            f'    model_id="gemini-pro-image",\n'
            f'    session_id="{session_id}"\n'
            f')'
        )

        commands.append({
            "character_name": char.name,
            "role": char.role,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "mcp_command": mcp_cmd,
        })

    logger.info("Generated %d Go Bananas MCP commands", len(commands))
    return commands


def _build_portrait_prompt(char: FilmCharacter, style: str = "") -> str:
    """Build a portrait prompt from FilmCharacter fields."""
    parts: list[str] = []

    # Age + gender
    age_str = f"{char.age}-year-old " if char.age else ""
    gender_str = char.gender or "person"
    # Map "male"/"female" to friendlier terms
    gender_display = {
        "male": "man",
        "female": "woman",
    }.get(gender_str, gender_str)

    parts.append(f"Image of a {age_str}{gender_display}")
    if style:
        parts[-1] += f", {style} style"

    # Add description if available
    if char.description:
        # Extract appearance-relevant phrases from description
        desc_clean = char.description.replace(char.name, "the character")
        # Limit description length for prompt
        if len(desc_clean) > 150:
            desc_clean = desc_clean[:150].rsplit(" ", 1)[0] + "..."
        parts.append(desc_clean)

    parts.append("Portrait shot, warm lighting, clean background.")

    return ", ".join(parts)


def _build_negative_prompt(char: FilmCharacter) -> str:
    """Build negative prompt based on character attributes."""
    negatives = ["realistic", "photorealistic", "text", "watermark"]

    if char.age and char.age < 18:
        negatives.extend(["adult", "mature", "facial hair", "beard", "wrinkles"])

    if char.gender == "male":
        negatives.extend(["female", "woman", "girl"])
    elif char.gender == "female":
        negatives.extend(["male", "man", "boy"])

    return ", ".join(negatives)


# ============================================================================
# Save Character IDs
# ============================================================================

def save_character_ids(
    characters: list[FilmCharacter],
    project_dir: str,
    save_to_db: bool = True,
) -> None:
    """Save Go Bananas character IDs to characters.json and optionally DB.

    Writes characters.json in the format expected by generate_storyboard.py:
    {
        "characters": [
            {"name": "Ram", "character_id": 95, "description": "..."},
            ...
        ],
        "style": "..."
    }

    Also saves each character to DB via db_unified.save_film_character().

    Args:
        characters: List of FilmCharacter with go_bananas_character_id set
        project_dir: Path to project directory (e.g., "projects/my-film")
        save_to_db: Whether to persist to the database (default: True)

    Raises:
        CharacterDesignError: If no characters have Go Bananas IDs
    """
    chars_with_ids = [c for c in characters if c.go_bananas_character_id is not None]
    if not chars_with_ids:
        logger.warning("No characters have Go Bananas IDs set; skipping save")
        return

    # Write characters.json
    storyboard_dir = os.path.join(project_dir, "storyboard")
    os.makedirs(storyboard_dir, exist_ok=True)
    chars_path = os.path.join(storyboard_dir, "characters.json")

    chars_data = {
        "characters": [
            {
                "name": c.name,
                "character_id": c.go_bananas_character_id,
                "go_bananas_id": c.go_bananas_character_id,
                "description": c.description,
                "role": c.role,
                "gender": c.gender,
                "age": c.age,
            }
            for c in chars_with_ids
        ],
    }

    with open(chars_path, "w") as f:
        json.dump(chars_data, f, indent=2)
    logger.info("Saved %d character IDs to %s", len(chars_with_ids), chars_path)

    # Save to database
    if save_to_db:
        _save_characters_to_db(characters, project_dir)


def _save_characters_to_db(characters: list[FilmCharacter], project_dir: str) -> None:
    """Persist characters to the unified database."""
    try:
        from db_unified import get_or_create_project, save_film_character

        # Derive project slug from directory name
        slug = Path(project_dir).name
        project = get_or_create_project(slug)
        project_id = project.get("id") or project.get("_id")

        if not project_id:
            logger.warning("Could not get project ID for '%s'; skipping DB save", slug)
            return

        for char in characters:
            save_film_character(
                project_id=project_id,
                name=char.name,
                role=char.role,
                description=char.description,
                age=char.age,
                gender=char.gender,
                voice_id=char.voice_id,
                voice_name=char.voice_name,
                go_bananas_character_id=char.go_bananas_character_id,
                go_bananas_image_url=char.go_bananas_image_url,
                character_json=char.to_dict(),
            )

        logger.info("Saved %d characters to database", len(characters))
    except Exception as e:
        logger.warning("Could not save characters to DB: %s", e)


# ============================================================================
# Voice Assignment
# ============================================================================

def assign_voices(
    characters: list[FilmCharacter],
    default_voice: str = "Rachel",
) -> list[FilmCharacter]:
    """Assign ElevenLabs voices to characters.

    Heuristic voice assignment:
    - Male characters -> pick from male voices (round-robin)
    - Female characters -> pick from female voices (round-robin)
    - Unknown gender -> use default_voice

    Does NOT call ElevenLabs API -- just maps names to known voice IDs.

    Args:
        characters: List of FilmCharacter objects
        default_voice: Fallback voice name (default: "Rachel")

    Returns:
        Characters with voice_id and voice_name set
    """
    # Build a flat lookup for the default voice
    all_voices = []
    for group in VOICE_PRESETS.values():
        all_voices.extend(group)
    default_entry = next(
        (v for v in all_voices if v["name"].lower() == default_voice.lower()),
        VOICE_PRESETS["neutral"][0],
    )

    # Track assignment index per gender for round-robin
    male_idx = 0
    female_idx = 0

    for char in characters:
        if char.voice_id and char.voice_name:
            # Already assigned, skip
            continue

        if char.gender == "male":
            pool = VOICE_PRESETS["male"]
            voice = pool[male_idx % len(pool)]
            male_idx += 1
        elif char.gender == "female":
            pool = VOICE_PRESETS["female"]
            voice = pool[female_idx % len(pool)]
            female_idx += 1
        else:
            voice = default_entry

        char.voice_id = voice["id"]
        char.voice_name = voice["name"]

    logger.info(
        "Assigned voices: %s",
        ", ".join(f"{c.name}={c.voice_name}" for c in characters),
    )

    return characters


# ============================================================================
# Write Characters JSON
# ============================================================================

def write_characters_json(
    characters: list[FilmCharacter],
    project_dir: str,
    style: str = "",
) -> str:
    """Write characters.json to project directory.

    Format compatible with generate_storyboard.py --generate-scenes:
    {
        "characters": [...],
        "style": "...",
        "voices": {
            "character_name": {"voice_id": "...", "voice_name": "..."}
        }
    }

    Args:
        characters: List of FilmCharacter objects
        project_dir: Path to project directory
        style: Art style string

    Returns:
        Path to written file
    """
    # Build characters list
    chars_list: list[dict] = []
    for c in characters:
        entry: dict = {
            "name": c.name,
            "role": c.role,
            "description": c.description,
        }
        if c.go_bananas_character_id is not None:
            entry["go_bananas_id"] = c.go_bananas_character_id
            entry["character_id"] = c.go_bananas_character_id
        if c.age is not None:
            entry["age"] = c.age
        if c.gender:
            entry["gender"] = c.gender
        if c.go_bananas_image_url:
            entry["image_url"] = c.go_bananas_image_url
        entry["scene_appearances"] = c.scene_appearances
        chars_list.append(entry)

    # Build voices map
    voices: dict[str, dict[str, str]] = {}
    for c in characters:
        if c.voice_id and c.voice_name:
            voices[c.name] = {
                "voice_id": c.voice_id,
                "voice_name": c.voice_name,
            }

    data = {
        "characters": chars_list,
        "style": style,
        "voices": voices,
    }

    # Write to storyboard directory (compatible with generate_storyboard.py)
    storyboard_dir = os.path.join(project_dir, "storyboard")
    os.makedirs(storyboard_dir, exist_ok=True)
    output_path = os.path.join(storyboard_dir, "characters.json")

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    logger.info("Wrote characters.json to %s", output_path)
    return output_path


# ============================================================================
# CLI
# ============================================================================

def _load_screenplay(path: str):
    """Load a Screenplay from a JSON file."""
    from screenplay_generator import Screenplay

    with open(path) as f:
        data = json.load(f)
    return Screenplay.from_dict(data)


def _load_characters_from_screenplay(path: str) -> list[FilmCharacter]:
    """Load a screenplay and extract characters."""
    screenplay = _load_screenplay(path)
    return extract_characters(screenplay)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract characters from screenplays, create Go Bananas "
                    "references, and assign ElevenLabs voices",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python character_designer.py extract --screenplay screenplay.json
  python character_designer.py references --screenplay screenplay.json --style "cinematic"
  python character_designer.py assign-voices --screenplay screenplay.json
  python character_designer.py save-ids --screenplay screenplay.json --ids 95,96 --project test
""",
    )

    sub = parser.add_subparsers(dest="command")

    # extract
    ext = sub.add_parser("extract", help="Extract characters from screenplay")
    ext.add_argument("--screenplay", required=True, help="Path to screenplay JSON")

    # references
    ref = sub.add_parser("references", help="Generate Go Bananas MCP commands")
    ref.add_argument("--screenplay", required=True, help="Path to screenplay JSON")
    ref.add_argument("--style", default="", help="Art style for portraits")
    ref.add_argument("--project", help="Project directory for session_id")

    # assign-voices
    av = sub.add_parser("assign-voices", help="Assign ElevenLabs voices")
    av.add_argument("--screenplay", required=True, help="Path to screenplay JSON")
    av.add_argument("--default-voice", default="Rachel", help="Default voice name")

    # save-ids
    si = sub.add_parser("save-ids", help="Save Go Bananas character IDs")
    si.add_argument("--screenplay", required=True, help="Path to screenplay JSON")
    si.add_argument("--ids", required=True, help="Go Bananas IDs (comma-separated)")
    si.add_argument("--project", required=True, help="Project slug")
    si.add_argument("--style", default="", help="Art style")
    si.add_argument("--no-db", action="store_true", help="Skip database save")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "extract":
        characters = _load_characters_from_screenplay(args.screenplay)

        print(f"\n{'='*60}")
        print(f"  Characters Extracted: {len(characters)}")
        print(f"{'='*60}")
        for c in characters:
            scenes_str = ", ".join(str(s) for s in c.scene_appearances)
            print(f"\n  {c.name} [{c.role}]")
            print(f"    Gender: {c.gender or 'unknown'} | Age: {c.age or 'unknown'}")
            print(f"    Scenes: {scenes_str} ({len(c.scene_appearances)} appearances)")
            if c.description:
                desc = c.description[:100] + "..." if len(c.description) > 100 else c.description
                print(f"    Description: {desc}")
        print(f"\n{'='*60}\n")

    elif args.command == "references":
        characters = _load_characters_from_screenplay(args.screenplay)
        project_dir = args.project if args.project else None

        commands = create_character_references(characters, style=args.style, project_dir=project_dir)

        print(f"\n{'='*70}")
        print("  GO BANANAS CHARACTER REFERENCE COMMANDS")
        print(f"{'='*70}")
        for cmd in commands:
            print(f"\n# {cmd['character_name']} ({cmd['role']})")
            print(cmd["mcp_command"])
        print(f"\n{'='*70}")
        print("\nAfter generating portraits, run:")
        print(f"  python character_designer.py save-ids --screenplay {args.screenplay} "
              f"--ids <ID1>,<ID2>,... --project <slug>")
        print(f"{'='*70}\n")

    elif args.command == "assign-voices":
        characters = _load_characters_from_screenplay(args.screenplay)
        characters = assign_voices(characters, default_voice=args.default_voice)

        print(f"\n{'='*60}")
        print("  Voice Assignments")
        print(f"{'='*60}")
        for c in characters:
            print(f"  {c.name} ({c.gender or 'unknown'}) -> {c.voice_name} ({c.voice_id})")
        print(f"{'='*60}\n")

    elif args.command == "save-ids":
        characters = _load_characters_from_screenplay(args.screenplay)

        # Parse IDs
        ids = [int(x.strip()) for x in args.ids.split(",")]
        if len(ids) != len(characters):
            logger.warning(
                "%d IDs provided but %d characters extracted", len(ids), len(characters)
            )

        # Assign IDs to characters in order
        for i, char in enumerate(characters):
            if i < len(ids):
                char.go_bananas_character_id = ids[i]

        # Resolve project path
        project_dir = os.path.join(PROJECT_BASE, args.project)

        # Assign voices before saving
        characters = assign_voices(characters)

        # Write characters.json
        write_characters_json(characters, project_dir, style=args.style)

        # Save IDs (also writes to storyboard/characters.json + DB)
        save_character_ids(characters, project_dir, save_to_db=not args.no_db)

        print(f"\nSaved {len(ids)} character IDs for project: {args.project}")
        for c in characters:
            if c.go_bananas_character_id is not None:
                print(f"  {c.name}: ID={c.go_bananas_character_id}, Voice={c.voice_name}")


if __name__ == "__main__":
    main()
