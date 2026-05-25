# .claude/skills/video-replicator/scripts/storyboard_templates.py
"""
Storyboard Templates - 8 narrative templates for cinematic story generation.

Each template defines a 9-panel storyboard structure with:
- Shot types (wide, medium, close-up, insert, two-shot, etc.)
- Panel purposes (establishing, emotional beat, resolution, etc.)
- Default camera motions
- Description templates for prompt generation
"""

from dataclasses import dataclass, field

# =============================================================================
# Data Classes (for compatibility with generate_storyboard.py)
# =============================================================================

@dataclass
class PanelDefinition:
    """Definition for a single panel in a storyboard template."""
    panel_number: int
    shot_type: str
    purpose: str
    default_motion: str
    character_focus: str | None = None
    dialogue_hint: str = ""


@dataclass
class StoryTemplate:
    """A narrative template for storyboard generation."""
    template_id: str
    name: str
    description: str
    emotional_arc: str
    use_case: str = ""
    min_characters: int = 1
    panels: list[PanelDefinition] = field(default_factory=list)

    def get_panel(self, panel_number: int) -> PanelDefinition | None:
        """Get a panel by number (1-9)."""
        for panel in self.panels:
            if panel.panel_number == panel_number:
                return panel
        return None


# =============================================================================
# Template Definitions
# =============================================================================

STORYBOARD_TEMPLATES = {
    "dialogue_confrontation": {
        "name": "Dialogue/Confrontation",
        "description": "Two+ characters in tense conversation, building to a decision point",
        "emotional_arc": "Tension → Breaking point → Resolution",
        "best_for": ["arguments", "negotiations", "dramatic conversations", "decisions"],
        "min_characters": 2,
        "panels": [
            {
                "number": 1,
                "shot_type": "Wide Establishing",
                "purpose": "Context, isolation, scale",
                "default_motion": "slow pan or static",
                "description": "Extreme long shot. Both characters and the environment small within the vast landscape. Strong negative space. Emphasize isolation.",
                "characters_visible": "both_small",
            },
            {
                "number": 2,
                "shot_type": "Medium (Character A)",
                "purpose": "Character state, tension",
                "default_motion": "subtle push in",
                "description": "Medium shot of first character. Body language focused, tense. Scanning the environment or looking at the situation.",
                "characters_visible": "character_a",
            },
            {
                "number": 3,
                "shot_type": "Medium (Character B)",
                "purpose": "Counter-position, conflict",
                "default_motion": "subtle push in",
                "description": "Medium shot of second character standing slightly apart. Posture uncertain, shoulders heavy, eyes searching.",
                "characters_visible": "character_b",
            },
            {
                "number": 4,
                "shot_type": "Tight Close-up A",
                "purpose": "Emotional beat, reaction",
                "default_motion": "static or micro-push",
                "description": "Tight close-up on first character's face. Minimal movement. Restrained emotion visible in expression.",
                "characters_visible": "character_a_face",
            },
            {
                "number": 5,
                "shot_type": "Insert Shot",
                "purpose": "Narrative detail (no characters)",
                "default_motion": "static",
                "description": "Extreme close-up insert. A key object or detail that represents the situation. No characters visible.",
                "characters_visible": "none",
            },
            {
                "number": 6,
                "shot_type": "Tight Close-up B",
                "purpose": "Counter-reaction",
                "default_motion": "static or micro-push",
                "description": "Tight close-up on second character's face. Eyes reflecting fear, exhaustion, or determination.",
                "characters_visible": "character_b_face",
            },
            {
                "number": 7,
                "shot_type": "High-Angle Wide",
                "purpose": "Vulnerability, stakes",
                "default_motion": "slow crane or static",
                "description": "High or top-down shot. Both characters visible from above. They appear small and vulnerable against the environment.",
                "characters_visible": "both_overhead",
            },
            {
                "number": 8,
                "shot_type": "Two-Shot",
                "purpose": "Relationship dynamics, conflict",
                "default_motion": "track or static",
                "description": "Both characters in frame, standing several feet apart. The environment or key object partially between them.",
                "characters_visible": "both_together",
            },
            {
                "number": 9,
                "shot_type": "Wide Exit",
                "purpose": "Resolution, commitment",
                "default_motion": "pull out or static",
                "description": "Wide shot from behind or side. One or both characters begin moving forward. Something is left behind.",
                "characters_visible": "both_walking",
            },
        ],
    },
    "chase_pursuit": {
        "name": "Chase/Pursuit",
        "description": "Movement, pursuit, urgency - someone running from or toward something",
        "emotional_arc": "Urgency → Escalation → Climax",
        "best_for": ["escapes", "races", "physical conflict", "being followed"],
        "min_characters": 1,
        "panels": [
            {"number": 1, "shot_type": "Wide Establishing", "purpose": "Set the arena", "default_motion": "fast pan", "description": "Wide establishing shot of the chase environment.", "characters_visible": "pursuer_and_pursued"},
            {"number": 2, "shot_type": "Medium Tracking", "purpose": "The pursued in motion", "default_motion": "tracking alongside", "description": "Medium tracking shot of the main character running. Desperation in movement.", "characters_visible": "character_a_running"},
            {"number": 3, "shot_type": "Over-Shoulder", "purpose": "The threat behind", "default_motion": "handheld shake", "description": "Over-shoulder or POV shot looking back at what's pursuing.", "characters_visible": "pursuer_gaining"},
            {"number": 4, "shot_type": "Close-up Feet/Hands", "purpose": "Physical strain", "default_motion": "static with motion blur", "description": "Extreme close-up of feet pounding pavement or hands grabbing.", "characters_visible": "detail_motion"},
            {"number": 5, "shot_type": "Insert Shot", "purpose": "Obstacle or goal", "default_motion": "static", "description": "Insert of the goal or obstacle.", "characters_visible": "none"},
            {"number": 6, "shot_type": "Close-up Face", "purpose": "Fear or determination", "default_motion": "static", "description": "Tight on face showing exhaustion, fear, or determination.", "characters_visible": "character_a_face"},
            {"number": 7, "shot_type": "Low Angle Wide", "purpose": "The pursuer's power", "default_motion": "tilt up", "description": "Low angle making the pursuer look large and threatening.", "characters_visible": "pursuer_dominant"},
            {"number": 8, "shot_type": "Action Two-Shot", "purpose": "Near catch/confrontation", "default_motion": "dynamic track", "description": "Both in frame - the moment of near-catch.", "characters_visible": "both_close_action"},
            {"number": 9, "shot_type": "Wide Resolution", "purpose": "Escape or capture", "default_motion": "crane up or pull out", "description": "Wide shot showing the outcome.", "characters_visible": "resolution_wide"},
        ],
    },
    "discovery_reveal": {
        "name": "Discovery/Reveal",
        "description": "Finding something important - mystery, secrets, plot twists",
        "emotional_arc": "Mystery → Investigation → Revelation",
        "best_for": ["finding something", "plot twists", "secrets revealed", "transformations"],
        "min_characters": 1,
        "panels": [
            {"number": 1, "shot_type": "Wide Establishing", "purpose": "Set the mystery location", "default_motion": "slow push in", "description": "Wide shot of mysterious location.", "characters_visible": "character_entering"},
            {"number": 2, "shot_type": "Medium", "purpose": "Character investigating", "default_motion": "tracking", "description": "Character moving through space, looking for something.", "characters_visible": "character_a"},
            {"number": 3, "shot_type": "Close-up Reaction", "purpose": "Something catches attention", "default_motion": "static", "description": "Close-up of character noticing something.", "characters_visible": "character_a_face"},
            {"number": 4, "shot_type": "POV Shot", "purpose": "What they see", "default_motion": "slow push", "description": "POV approaching the discovery.", "characters_visible": "none_pov"},
            {"number": 5, "shot_type": "Insert Reveal", "purpose": "The discovery itself", "default_motion": "static reveal", "description": "Close-up of what was found.", "characters_visible": "none"},
            {"number": 6, "shot_type": "Extreme Close-up", "purpose": "Emotional impact", "default_motion": "static", "description": "Extreme close-up of character's reaction.", "characters_visible": "character_a_eyes"},
            {"number": 7, "shot_type": "Wide Context", "purpose": "Implications sink in", "default_motion": "slow pull out", "description": "Wider shot showing character with discovery.", "characters_visible": "character_with_discovery"},
            {"number": 8, "shot_type": "Medium Decisive", "purpose": "Decision moment", "default_motion": "subtle push", "description": "Character making a decision.", "characters_visible": "character_a"},
            {"number": 9, "shot_type": "Wide Exit", "purpose": "Changed trajectory", "default_motion": "static or pull out", "description": "Character leaving with new purpose.", "characters_visible": "character_departing"},
        ],
    },
    "journey_transformation": {
        "name": "Journey/Transformation",
        "description": "Travel, personal growth, before/after arc",
        "emotional_arc": "Beginning → Struggle → Arrival",
        "best_for": ["travel montages", "personal growth", "before/after", "training"],
        "min_characters": 1,
        "panels": [
            {"number": 1, "shot_type": "Wide Origin", "purpose": "Where we start", "default_motion": "static establishing", "description": "Wide shot of the starting point.", "characters_visible": "character_at_start"},
            {"number": 2, "shot_type": "Medium Departure", "purpose": "Leaving behind", "default_motion": "tracking", "description": "Character leaving the starting point.", "characters_visible": "character_a"},
            {"number": 3, "shot_type": "Wide Journey A", "purpose": "First stage of journey", "default_motion": "pan", "description": "Wide shot of character in new environment.", "characters_visible": "character_in_landscape"},
            {"number": 4, "shot_type": "Close-up Struggle", "purpose": "Challenge faced", "default_motion": "handheld", "description": "Close-up showing difficulty or effort.", "characters_visible": "character_a_face"},
            {"number": 5, "shot_type": "Insert Symbol", "purpose": "Journey marker", "default_motion": "static", "description": "Insert of something marking progress.", "characters_visible": "none"},
            {"number": 6, "shot_type": "Wide Journey B", "purpose": "Deeper into journey", "default_motion": "crane or dolly", "description": "Different landscape, further along.", "characters_visible": "character_in_landscape"},
            {"number": 7, "shot_type": "Medium Breakthrough", "purpose": "Turning point", "default_motion": "push in", "description": "Character having a breakthrough.", "characters_visible": "character_a"},
            {"number": 8, "shot_type": "Close-up Changed", "purpose": "Internal transformation", "default_motion": "static", "description": "Face showing change.", "characters_visible": "character_a_face"},
            {"number": 9, "shot_type": "Wide Arrival", "purpose": "Destination/new state", "default_motion": "reveal crane", "description": "Wide shot of destination.", "characters_visible": "character_at_destination"},
        ],
    },
    "romance_connection": {
        "name": "Romance/Connection",
        "description": "Meeting, bonding, emotional intimacy between characters",
        "emotional_arc": "Distant → Drawing closer → Together",
        "best_for": ["meeting scenes", "bonding", "emotional intimacy", "reconciliation"],
        "min_characters": 2,
        "panels": [
            {"number": 1, "shot_type": "Wide Establishing", "purpose": "Set the meeting place", "default_motion": "slow pan", "description": "Beautiful location where characters meet.", "characters_visible": "location_only"},
            {"number": 2, "shot_type": "Medium Character A", "purpose": "First character waiting/arriving", "default_motion": "static", "description": "One character alone, anticipating.", "characters_visible": "character_a"},
            {"number": 3, "shot_type": "Medium Character B", "purpose": "Second character appears", "default_motion": "tracking", "description": "Second character approaching.", "characters_visible": "character_b"},
            {"number": 4, "shot_type": "Close-up Eyes A", "purpose": "Looking at each other", "default_motion": "static", "description": "Close-up of first character's eyes.", "characters_visible": "character_a_face"},
            {"number": 5, "shot_type": "Close-up Eyes B", "purpose": "Returned gaze", "default_motion": "static", "description": "Close-up of second character's eyes.", "characters_visible": "character_b_face"},
            {"number": 6, "shot_type": "Two-Shot Apart", "purpose": "Distance between them", "default_motion": "static", "description": "Both in frame with space between.", "characters_visible": "both_apart"},
            {"number": 7, "shot_type": "Medium Moving Closer", "purpose": "Closing the gap", "default_motion": "slow track", "description": "One or both moving toward each other.", "characters_visible": "both_approaching"},
            {"number": 8, "shot_type": "Close Two-Shot", "purpose": "Intimate proximity", "default_motion": "subtle orbit", "description": "Both close together.", "characters_visible": "both_close"},
            {"number": 9, "shot_type": "Wide Together", "purpose": "United", "default_motion": "pull out", "description": "Wide shot of the pair together.", "characters_visible": "both_together_wide"},
        ],
    },
    "comedy_surprise": {
        "name": "Comedy/Surprise",
        "description": "Mishaps, unexpected twists, humor - setup and payoff",
        "emotional_arc": "Setup → Complication → Punchline",
        "best_for": ["mishaps", "unexpected twists", "humor", "ironic situations"],
        "min_characters": 1,
        "panels": [
            {"number": 1, "shot_type": "Wide Establishing", "purpose": "Normal situation", "default_motion": "static", "description": "Establishing the normal situation.", "characters_visible": "character_in_normal"},
            {"number": 2, "shot_type": "Medium Character", "purpose": "Character confident/unaware", "default_motion": "tracking", "description": "Character acting confident, unaware.", "characters_visible": "character_a"},
            {"number": 3, "shot_type": "Insert Foreshadow", "purpose": "Hint of trouble", "default_motion": "static", "description": "Insert hinting at the complication.", "characters_visible": "none"},
            {"number": 4, "shot_type": "Close-up Oblivious", "purpose": "Still unaware", "default_motion": "static", "description": "Character focused elsewhere.", "characters_visible": "character_a_face"},
            {"number": 5, "shot_type": "Wide Action", "purpose": "The mishap happens", "default_motion": "static wide", "description": "Wide shot capturing the mishap.", "characters_visible": "character_in_action"},
            {"number": 6, "shot_type": "Close-up Reaction", "purpose": "Immediate reaction", "default_motion": "static", "description": "Character's face in realization.", "characters_visible": "character_a_face"},
            {"number": 7, "shot_type": "Medium Aftermath", "purpose": "Dealing with it", "default_motion": "static or handheld", "description": "Character dealing with aftermath.", "characters_visible": "character_a"},
            {"number": 8, "shot_type": "Insert Detail", "purpose": "The ironic detail", "default_motion": "static", "description": "The ironic detail that makes it worse.", "characters_visible": "none"},
            {"number": 9, "shot_type": "Wide Resolution", "purpose": "Final state", "default_motion": "static or slow pull", "description": "Final wide showing new state.", "characters_visible": "character_in_result"},
        ],
    },
    "horror_suspense": {
        "name": "Horror/Suspense",
        "description": "Dread, threat, survival - building and releasing tension",
        "emotional_arc": "Calm → Unease → Terror",
        "best_for": ["dread", "threats", "survival", "jump scares", "creepy atmosphere"],
        "min_characters": 1,
        "panels": [
            {"number": 1, "shot_type": "Wide Establishing", "purpose": "False calm", "default_motion": "slow push", "description": "Seemingly normal location, something feels off.", "characters_visible": "character_entering"},
            {"number": 2, "shot_type": "Medium Character", "purpose": "Unaware protagonist", "default_motion": "tracking", "description": "Character not yet aware of danger.", "characters_visible": "character_a"},
            {"number": 3, "shot_type": "Insert Warning", "purpose": "First hint", "default_motion": "static", "description": "Insert of something wrong.", "characters_visible": "none"},
            {"number": 4, "shot_type": "Close-up Alert", "purpose": "Something noticed", "default_motion": "static", "description": "Character's first awareness.", "characters_visible": "character_a_face"},
            {"number": 5, "shot_type": "Wide Threat Revealed", "purpose": "We see it", "default_motion": "static reveal", "description": "Wide shot revealing the threat.", "characters_visible": "character_and_threat"},
            {"number": 6, "shot_type": "Close-up Terror", "purpose": "The realization", "default_motion": "static", "description": "Character's face at moment of terror.", "characters_visible": "character_a_face"},
            {"number": 7, "shot_type": "Low Angle Threat", "purpose": "Threat dominates", "default_motion": "push or static", "description": "Low angle making threat appear large.", "characters_visible": "threat_dominant"},
            {"number": 8, "shot_type": "Action Shot", "purpose": "Flight or fight", "default_motion": "handheld chaos", "description": "Character running or confronting.", "characters_visible": "character_in_action"},
            {"number": 9, "shot_type": "Wide Unknown", "purpose": "Uncertain fate", "default_motion": "static or slow push", "description": "Wide shot with ambiguous ending.", "characters_visible": "uncertain_outcome"},
        ],
    },
    "product_story": {
        "name": "Product Story",
        "description": "Character discovers, uses, and benefits from a product",
        "emotional_arc": "Problem → Discovery → Transformation",
        "best_for": ["commercials", "product narratives", "before/after", "testimonials"],
        "min_characters": 1,
        "panels": [
            {"number": 1, "shot_type": "Wide Problem", "purpose": "Life before product", "default_motion": "static", "description": "Character with a problem or need.", "characters_visible": "character_with_problem"},
            {"number": 2, "shot_type": "Close-up Frustration", "purpose": "Emotional pain point", "default_motion": "static", "description": "Character's frustration visible.", "characters_visible": "character_a_face"},
            {"number": 3, "shot_type": "Insert Product", "purpose": "Product introduction", "default_motion": "reveal push", "description": "Product appears. Clean product shot.", "characters_visible": "none"},
            {"number": 4, "shot_type": "Medium Discovery", "purpose": "Character finds product", "default_motion": "subtle push", "description": "Character discovering the product.", "characters_visible": "character_with_product"},
            {"number": 5, "shot_type": "Close-up Using", "purpose": "Product in use", "default_motion": "static detail", "description": "Hands using product.", "characters_visible": "hands_with_product"},
            {"number": 6, "shot_type": "Medium Experience", "purpose": "Using product", "default_motion": "tracking", "description": "Character actively using product.", "characters_visible": "character_a"},
            {"number": 7, "shot_type": "Close-up Satisfaction", "purpose": "Benefit realized", "default_motion": "static", "description": "Character's face showing satisfaction.", "characters_visible": "character_a_face"},
            {"number": 8, "shot_type": "Wide Transformed", "purpose": "Life improved", "default_motion": "slow pull out", "description": "Character in improved situation.", "characters_visible": "character_transformed"},
            {"number": 9, "shot_type": "Product Hero", "purpose": "Product finale", "default_motion": "static or slow orbit", "description": "Clean product hero shot.", "characters_visible": "product_hero_with_character"},
        ],
    },
}


# =============================================================================
# Compatibility Exports (for generate_storyboard.py)
# =============================================================================

# Alias for compatibility
TEMPLATES_BY_NAME = STORYBOARD_TEMPLATES


def _convert_to_story_template(template_id: str, data: dict) -> StoryTemplate:
    """Convert a dict template to StoryTemplate dataclass."""
    panels = [
        PanelDefinition(
            panel_number=p["number"],
            shot_type=p["shot_type"],
            purpose=p["purpose"],
            default_motion=p["default_motion"],
            character_focus=p.get("characters_visible", ""),
            dialogue_hint="",
        )
        for p in data["panels"]
    ]
    return StoryTemplate(
        template_id=template_id,
        name=data["name"],
        description=data["description"],
        emotional_arc=data["emotional_arc"],
        use_case=", ".join(data.get("best_for", [])),
        min_characters=data.get("min_characters", 1),
        panels=panels,
    )


# Pre-build StoryTemplate objects for each template
TEMPLATES: dict[str, StoryTemplate] = {
    tid: _convert_to_story_template(tid, data)
    for tid, data in STORYBOARD_TEMPLATES.items()
}


def list_templates() -> list[dict]:
    """List all templates with summary info (for generate_storyboard.py compatibility)."""
    return [
        {
            "id": tid,
            "name": data["name"],
            "emotional_arc": data["emotional_arc"],
            "best_for": data.get("best_for", []),
            "min_characters": data.get("min_characters", 1),
        }
        for tid, data in STORYBOARD_TEMPLATES.items()
    ]


def get_panel_prompt_hints(template: StoryTemplate, panel_number: int) -> dict:
    """Get prompt hints for a specific panel (for generate_storyboard.py compatibility)."""
    panel = template.get_panel(panel_number)
    if not panel:
        return {}

    return {
        "image_hints": {
            "shot_type": panel.shot_type,
            "purpose": panel.purpose,
            "character_focus": panel.character_focus,
        },
        "motion_hints": {
            "default_motion": panel.default_motion,
        },
    }


# =============================================================================
# Access Functions
# =============================================================================

def get_template(template_id: str) -> dict | None:
    """Get a template by ID. Returns None if not found."""
    return STORYBOARD_TEMPLATES.get(template_id)


def get_template_names() -> list[str]:
    """Get list of all template IDs."""
    return list(STORYBOARD_TEMPLATES.keys())


def get_panel_by_number(template_id: str, panel_number: int) -> dict | None:
    """Get a specific panel from a template by number (1-9)."""
    template = get_template(template_id)
    if not template:
        return None
    for panel in template["panels"]:
        if panel["number"] == panel_number:
            return panel
    return None


def get_templates_for_character_count(min_chars: int) -> list[str]:
    """Get templates that work with a minimum number of characters."""
    return [
        tid for tid, t in STORYBOARD_TEMPLATES.items()
        if t.get("min_characters", 1) <= min_chars
    ]


def format_template_summary(template_id: str) -> str:
    """Format a template as a readable summary for display."""
    template = get_template(template_id)
    if not template:
        return f"Unknown template: {template_id}"

    lines = [
        f"**{template['name']}**",
        f"_{template['description']}_",
        f"Arc: {template['emotional_arc']}",
        f"Best for: {', '.join(template['best_for'])}",
        "",
        "Panels:",
    ]
    for panel in template["panels"]:
        lines.append(f"  {panel['number']}. {panel['shot_type']} - {panel['purpose']}")

    return "\n".join(lines)


def build_panel_description(
    template_id: str,
    panel_number: int,
    character_a_name: str = "Character A",
    character_b_name: str = "Character B",
    environment: str = "",
    custom_detail: str = "",
) -> str:
    """Build a full panel description with substitutions."""
    panel = get_panel_by_number(template_id, panel_number)
    if not panel:
        return ""

    description = panel["description"]
    description = description.replace("first character", character_a_name)
    description = description.replace("second character", character_b_name)
    description = description.replace("Character A", character_a_name)
    description = description.replace("Character B", character_b_name)

    if environment and "environment" in description.lower():
        description = description.replace("the environment", environment)
        description = description.replace("vast landscape", environment)

    if custom_detail:
        description += f" {custom_detail}"

    return description


def suggest_template(premise: str) -> list[str]:
    """Suggest templates based on premise keywords."""
    premise_lower = premise.lower()
    suggestions = []

    # Keyword matching for template suggestions
    keyword_map = {
        "dialogue_confrontation": ["argue", "confront", "negotiate", "decision", "ultimatum", "tense", "conflict"],
        "chase_pursuit": ["chase", "run", "escape", "pursue", "race", "follow", "urgent"],
        "discovery_reveal": ["find", "discover", "reveal", "secret", "mystery", "twist", "hidden"],
        "journey_transformation": ["journey", "travel", "grow", "transform", "change", "before", "after"],
        "romance_connection": ["love", "romance", "meet", "bond", "connect", "relationship", "together"],
        "comedy_surprise": ["funny", "comedy", "surprise", "mishap", "humor", "unexpected", "ironic"],
        "horror_suspense": ["horror", "scary", "dread", "fear", "threat", "survival", "terror"],
        "product_story": ["product", "commercial", "demo", "benefit", "solution", "testimonial"],
    }

    for template_id, keywords in keyword_map.items():
        if any(kw in premise_lower for kw in keywords):
            suggestions.append(template_id)

    # Default to dialogue_confrontation if no matches
    if not suggestions:
        suggestions = ["dialogue_confrontation", "journey_transformation"]

    return suggestions[:3]  # Return top 3 suggestions


# =============================================================================
# CLI Interface
# =============================================================================

if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(
        description="Storyboard Templates - 8 narrative templates for cinematic story generation"
    )
    parser.add_argument("--list", action="store_true", help="List all available templates")
    parser.add_argument("--show", type=str, metavar="TEMPLATE_ID", help="Show detailed template info")
    parser.add_argument("--suggest", type=str, metavar="PREMISE", help="Suggest templates for a premise")
    parser.add_argument("--json", action="store_true", help="Output in JSON format")

    args = parser.parse_args()

    if args.list:
        if args.json:
            templates = [
                {
                    "id": tid,
                    "name": t["name"],
                    "emotional_arc": t["emotional_arc"],
                    "best_for": t["best_for"],
                }
                for tid, t in STORYBOARD_TEMPLATES.items()
            ]
            print(json.dumps(templates, indent=2))
        else:
            print("Available Storyboard Templates:\n")
            for tid, t in STORYBOARD_TEMPLATES.items():
                print(f"  {tid}")
                print(f"    Name: {t['name']}")
                print(f"    Arc:  {t['emotional_arc']}")
                print(f"    For:  {', '.join(t['best_for'][:3])}")
                print()

    elif args.show:
        template = get_template(args.show)
        if not template:
            print(f"Error: Unknown template '{args.show}'")
            print(f"Available: {', '.join(get_template_names())}")
            exit(1)

        if args.json:
            print(json.dumps(template, indent=2))
        else:
            print(format_template_summary(args.show))

    elif args.suggest:
        suggestions = suggest_template(args.suggest)
        if args.json:
            print(json.dumps({"suggestions": suggestions}))
        else:
            print(f"Suggested templates for: '{args.suggest}'")
            for i, tid in enumerate(suggestions, 1):
                t = STORYBOARD_TEMPLATES[tid]
                print(f"  {i}. {tid} - {t['name']}")

    else:
        parser.print_help()
