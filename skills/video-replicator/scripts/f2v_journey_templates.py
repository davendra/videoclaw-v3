#!/usr/bin/env python3
"""
F2V Journey Templates — Pre-built transition prompt templates for chained F2V generation.

Each template provides ordered scene descriptions with camera motion language
optimized for Veo's frames-to-video mode. Use with --chained --journey-template
on parallel_video_gen.py.

Templates:
  - property_tour: Walk-through home/property tour (exterior → interior → rooms)
  - building_ascent: Ground floor → upper floors → terrace → aerial
  - nature_walk: Path through landscape/garden/park
  - product_reveal: Approach → detail → hero shot → pullback
  - architectural_walkthrough: Room-to-room interior walkthrough

Usage:
    from f2v_journey_templates import get_template, list_templates, merge_template_with_scenes

    # List all available templates
    templates = list_templates()

    # Get a template by name
    template = get_template("property_tour")

    # Merge template prompts with user scene overrides
    scenes = merge_template_with_scenes(template, user_scenes)
"""

from dataclasses import dataclass, field


@dataclass
class JourneyScene:
    """A single scene in a journey template."""
    id: int
    transition_type: str
    prompt: str
    description: str = ""


@dataclass
class JourneyTemplate:
    """A pre-built F2V journey template with ordered scenes."""
    template_id: str
    name: str
    description: str
    recommended_scenes: int
    best_for: list[str] = field(default_factory=list)
    scenes: list[JourneyScene] = field(default_factory=list)

    def get_scene(self, scene_id: int) -> JourneyScene | None:
        """Get a scene by ID."""
        for scene in self.scenes:
            if scene.id == scene_id:
                return scene
        return None

    def get_prompts_dict(self) -> dict[str, str]:
        """Return scenes as {scene_number: prompt} dict for parallel_video_gen.py."""
        return {str(s.id): s.prompt for s in self.scenes}


# =============================================================================
# Template Definitions
# =============================================================================

JOURNEY_TEMPLATES: dict[str, JourneyTemplate] = {}


def _register(template: JourneyTemplate) -> JourneyTemplate:
    JOURNEY_TEMPLATES[template.template_id] = template
    return template


_register(JourneyTemplate(
    template_id="property_tour",
    name="Property Tour (Exterior to Interior)",
    description="Walk-through home tour from street approach to interior rooms. "
                "Best for real estate, architecture, and property showcase videos.",
    recommended_scenes=8,
    best_for=["real estate", "architecture", "property showcase", "home tour"],
    scenes=[
        JourneyScene(1, "aerial_descend",
            "Smooth cinematic camera descending from aerial view, slowly revealing the property below, "
            "gentle downward tilt, continuous motion, no cuts",
            "Aerial establishing shot descending toward property"),
        JourneyScene(2, "forward_approach",
            "Smooth cinematic camera moving forward along the path toward the entrance, "
            "steady forward dolly, eye-level, continuous motion",
            "Forward approach to front entrance"),
        JourneyScene(3, "push_through",
            "Smooth cinematic camera pushing through the entrance doorway into the foyer, "
            "continuous forward motion crossing threshold, interior reveals",
            "Push through entrance into foyer"),
        JourneyScene(4, "pan_reveal",
            "Smooth cinematic camera panning slowly right to reveal the living space, "
            "gentle rotation, maintaining height, revealing room details",
            "Pan to reveal main living area"),
        JourneyScene(5, "forward_glide",
            "Smooth cinematic camera gliding forward through the living area toward the next room, "
            "low steady dolly, passing furniture and details",
            "Glide through living area"),
        JourneyScene(6, "push_in",
            "Smooth cinematic camera pushing in toward a key feature or detail, "
            "slow zoom emphasizing craftsmanship or design element",
            "Push in on key feature/detail"),
        JourneyScene(7, "tracking_lateral",
            "Smooth cinematic camera tracking laterally along the space, "
            "steady sideways motion revealing depth and layout",
            "Lateral tracking shot through room"),
        JourneyScene(8, "pullback_reveal",
            "Smooth cinematic camera pulling back to reveal the full exterior from the garden or terrace, "
            "slow reverse dolly, wide angle, expansive final view",
            "Pullback to reveal full property"),
    ],
))


_register(JourneyTemplate(
    template_id="building_ascent",
    name="Building Ascent (Ground to Sky)",
    description="Vertical journey from ground floor up through building levels to terrace/aerial. "
                "Best for multi-story properties, hotels, and commercial buildings.",
    recommended_scenes=6,
    best_for=["multi-story buildings", "hotels", "commercial property", "penthouse"],
    scenes=[
        JourneyScene(1, "ground_entry",
            "Smooth cinematic camera at street level approaching the building entrance, "
            "eye-level forward dolly, revealing ground floor facade",
            "Ground level approach"),
        JourneyScene(2, "push_interior",
            "Smooth cinematic camera pushing into the ground floor interior, "
            "revealing lobby or main entrance hall, continuous forward motion",
            "Enter ground floor"),
        JourneyScene(3, "tilt_ascend",
            "Smooth cinematic camera tilting upward along the staircase or atrium, "
            "vertical pan revealing multiple levels, sense of height and space",
            "Look up through staircase/atrium"),
        JourneyScene(4, "floor_reveal",
            "Smooth cinematic camera moving forward into an upper floor room, "
            "steady dolly revealing furnished space with natural light from windows",
            "Upper floor room reveal"),
        JourneyScene(5, "push_to_terrace",
            "Smooth cinematic camera pushing through doors or windows onto the terrace, "
            "transition from interior to exterior, light changes dramatically",
            "Push out to terrace/balcony"),
        JourneyScene(6, "aerial_ascend",
            "Smooth cinematic camera ascending from terrace level to aerial view, "
            "slow crane up revealing rooftop and surrounding neighborhood, "
            "expansive sky, sense of achievement",
            "Rise to aerial view"),
    ],
))


_register(JourneyTemplate(
    template_id="nature_walk",
    name="Nature Walk (Path Through Landscape)",
    description="Walking journey through natural environment. "
                "Best for gardens, parks, trails, and outdoor spaces.",
    recommended_scenes=6,
    best_for=["garden", "park", "trail", "outdoor spaces", "landscape"],
    scenes=[
        JourneyScene(1, "aerial_descend",
            "Smooth cinematic camera descending from above the treetops to path level, "
            "gentle downward crane revealing the landscape and trail entrance",
            "Descend to trail entrance"),
        JourneyScene(2, "forward_walk",
            "Smooth cinematic camera moving forward along the path, "
            "low steady dolly at walking height, foliage passing on both sides",
            "Walk forward along path"),
        JourneyScene(3, "pan_environment",
            "Smooth cinematic camera panning slowly to take in the surrounding nature, "
            "gentle rotation revealing trees, water, or landscape features",
            "Pan to reveal environment"),
        JourneyScene(4, "forward_clearing",
            "Smooth cinematic camera moving forward into a clearing or vista point, "
            "steady dolly, light opens up as canopy thins",
            "Move into clearing/vista"),
        JourneyScene(5, "push_detail",
            "Smooth cinematic camera pushing in toward a natural detail, "
            "flower, water feature, or interesting texture, slow controlled push",
            "Push in on natural detail"),
        JourneyScene(6, "pullback_wide",
            "Smooth cinematic camera pulling back and rising to reveal the full landscape, "
            "slow reverse crane, expansive wide shot of the entire scene",
            "Pull back to wide vista"),
    ],
))


_register(JourneyTemplate(
    template_id="product_reveal",
    name="Product Reveal (Approach to Hero Shot)",
    description="Dramatic product reveal sequence from approach to detail to hero shot. "
                "Best for product launches, commercials, and brand videos.",
    recommended_scenes=5,
    best_for=["product launch", "commercial", "brand video", "luxury goods"],
    scenes=[
        JourneyScene(1, "approach_dark",
            "Smooth cinematic camera moving forward in a dark environment, "
            "spotlight gradually illuminating the product ahead, dramatic lighting, "
            "slow controlled dolly",
            "Approach product in dramatic lighting"),
        JourneyScene(2, "orbit_reveal",
            "Smooth cinematic camera orbiting around the product, "
            "slow 180-degree arc revealing different angles, consistent lighting, "
            "product stays centered",
            "Orbit to reveal product angles"),
        JourneyScene(3, "push_detail",
            "Smooth cinematic camera pushing in extremely close to a key product detail, "
            "macro-level detail, texture and craftsmanship visible, shallow depth of field",
            "Extreme close-up on product detail"),
        JourneyScene(4, "pullback_hero",
            "Smooth cinematic camera pulling back from detail to full product hero shot, "
            "reverse dolly revealing the complete product in its best angle, "
            "dramatic lighting, pristine background",
            "Pull back to hero shot"),
        JourneyScene(5, "final_flourish",
            "Smooth cinematic camera with gentle upward drift, product centered, "
            "light rays or atmospheric particles adding drama, "
            "final frame holds on the perfect product composition",
            "Final dramatic hero frame"),
    ],
))


_register(JourneyTemplate(
    template_id="architectural_walkthrough",
    name="Architectural Walkthrough (Room to Room)",
    description="Interior walkthrough moving through connected rooms. "
                "Best for interior design, hospitality, and furnished spaces.",
    recommended_scenes=7,
    best_for=["interior design", "hospitality", "furnished spaces", "showroom"],
    scenes=[
        JourneyScene(1, "entrance_push",
            "Smooth cinematic camera pushing through the main entrance into the first room, "
            "crossing threshold, interior light and space revealing",
            "Enter through main entrance"),
        JourneyScene(2, "room_pan",
            "Smooth cinematic camera panning across the room to show full layout, "
            "gentle 180-degree rotation, furniture and decor visible",
            "Pan across first room"),
        JourneyScene(3, "forward_corridor",
            "Smooth cinematic camera moving forward through a corridor or passage, "
            "steady dolly, walls framing the shot, leading to next space",
            "Move through corridor"),
        JourneyScene(4, "room_enter",
            "Smooth cinematic camera entering the next room with a subtle reveal, "
            "doorway framing transitioning to open space, new materials and light",
            "Enter second room"),
        JourneyScene(5, "detail_push",
            "Smooth cinematic camera pushing toward a design detail or focal point, "
            "slow controlled push highlighting craftsmanship or art piece",
            "Push in on design detail"),
        JourneyScene(6, "lateral_track",
            "Smooth cinematic camera tracking sideways along a feature wall or large window, "
            "steady lateral dolly, exterior light visible through glass",
            "Track along feature wall"),
        JourneyScene(7, "final_pullback",
            "Smooth cinematic camera pulling back to show the grand final space, "
            "reverse dolly revealing ceiling height, natural light, and full room scope",
            "Pull back for grand reveal"),
    ],
))


# =============================================================================
# Public API
# =============================================================================

def list_templates() -> list[dict]:
    """List all available journey templates with metadata."""
    return [
        {
            "id": t.template_id,
            "name": t.name,
            "description": t.description,
            "scenes": t.recommended_scenes,
            "best_for": t.best_for,
        }
        for t in JOURNEY_TEMPLATES.values()
    ]


def get_template(template_id: str) -> JourneyTemplate | None:
    """Get a journey template by ID."""
    return JOURNEY_TEMPLATES.get(template_id)


def merge_template_with_scenes(
    template: JourneyTemplate,
    user_scenes: dict[str, str] | None = None,
) -> dict[str, str]:
    """
    Merge a template's default prompts with user-provided scene overrides.

    User scenes take precedence — template prompts are used as defaults
    for scenes not explicitly provided by the user.

    Args:
        template: The journey template
        user_scenes: Optional dict of {scene_number: custom_prompt} overrides

    Returns:
        Complete scenes dict ready for parallel_video_gen.py
    """
    scenes = template.get_prompts_dict()

    if user_scenes:
        for scene_num, prompt in user_scenes.items():
            scenes[scene_num] = prompt

    return scenes


def print_templates() -> None:
    """Print all templates in a readable format."""
    for t in JOURNEY_TEMPLATES.values():
        print(f"\n{'='*60}")
        print(f"  {t.template_id}: {t.name}")
        print(f"  {t.description}")
        print(f"  Scenes: {t.recommended_scenes} | Best for: {', '.join(t.best_for)}")
        print(f"{'='*60}")
        for s in t.scenes:
            print(f"  Scene {s.id} [{s.transition_type}]: {s.description}")
        print()


if __name__ == "__main__":
    print_templates()
