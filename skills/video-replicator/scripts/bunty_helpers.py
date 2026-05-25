"""bunty_helpers.py — canonical Bunty image-gen helpers.

Bunty (Go Bananas character_id=97) is a recurring character. The Pro model
+ character_id alone is NOT sufficient — generations drift into clean-shaven,
slim, young, generic male models on roughly 2 of 3 calls. This module
prepends the canonical base prompt and a strong negative prompt to every
Bunty image generation, eliminating drift.

Usage:
    from bunty_helpers import build_bunty_image_kwargs

    kwargs = build_bunty_image_kwargs(
        "He is standing at the boundary of a cricket ground in golden hour, "
        "energetic, mid-gesture, big toothy grin."
    )
    # → dict of all kwargs to pass to mcp__go-bananas__generate_image

    # Or for the outro scene:
    kwargs = build_bunty_image_kwargs(
        "He is at twilight on the cricket pitch, hand raised in salute, "
        "warm satisfied smile.",
        negative_extra="no closed eyes",
    )

    # Auto-ground: parse the actual match ground from match_facts.txt
    # and build a Bunty image prompt anchored to it (instead of a generic preset):
    from pathlib import Path
    scene_desc = build_match_ground_scene_description(
        ground_name=parse_ground_from_match_facts(Path("projects/<slug>/reference/match_facts.txt")),
        segment="intro",
    )
    kwargs = build_bunty_image_kwargs(scene_desc)
"""

from __future__ import annotations

import re
from pathlib import Path

BUNTY_CHARACTER_ID = 97

BUNTY_CANONICAL_PROMPT = (
    "Pixar-style 3D cartoon character. Middle-aged Indian man named Bunty, a cricket "
    "commentator. Round cheerful face, THICK BLACK HANDLEBAR MOUSTACHE (curly only at "
    "the tips), chubby cheeks, expressive wide animated eyes, big infectious grin. "
    "HAIR: SLICKED BACK FLAT against the scalp, glossy low pompadour combover swept "
    "back from forehead — STRAIGHT hair, NOT curly, NOT voluminous, NOT fluffy. "
    "SLIGHTLY CHUBBY BUILD, NOT slim, NOT young. Warm golden skin tone. "
    "Exaggerated cartoon proportions, vibrant Pixar quality 3D render. "
    "CRITICAL — IDENTITY-LOCKED ACROSS ALL MOODS: regardless of whether the scene "
    "calls for energetic, calm, reflective, or paternal framing, the FACE must stay "
    "cartoon-exaggerated — round soft-edged face, chubby cheeks intact, double-chin "
    "hint, prominent handlebar moustache, slicked-back combover. Do NOT slim the "
    "face, do NOT sharpen the jaw, do NOT naturalise the features just because the "
    "mood is reflective. Hair must match the supplied character reference EXACTLY "
    "— slicked back, NOT curly."
)

BUNTY_NEGATIVE_PROMPT = (
    "realistic photograph, scary, dark, sad, dull colors, "
    "skinny, young, clean-shaven, no moustache, slim build, beardless face, "
    "baby face, generic male model, twenty-something, athletic build, "
    "curly hair, afro, voluminous hair, fluffy hair, big hair, wavy hair, "
    "tight curls on head, frizzy hair, different hairstyle from reference, "
    # Outro-drift terms (added 2026-05-24 after Burton Latimer match showed the
    # canonical Bunty intro paired with a thinner-faced, sharper-jawed outro —
    # caused by the outro's 'calmer / reflective / satisfied smile' mood text
    # pushing Pro toward a more naturalistic rendering of the same character).
    "thin face, narrow face, sharp jawline, angular jaw, chiseled jaw, "
    "defined cheekbones, gaunt face, hollow cheeks, refined features, "
    "naturalistic rendering, photoreal middle-aged man, model-like face, "
    "handsome lead-actor features, mature actor headshot, "
    "no text, no logos, no watermarks, no captions, no team crests, "
    "no microphone wire, no other people, no players in background, "
    "no mid-speech mouth open"
)


def build_bunty_image_kwargs(
    scene_description: str,
    *,
    aspect_ratio: str = "16:9",
    negative_extra: str = "",
    landscape_token: str = "WIDE HORIZONTAL shot, cinematic widescreen 16:9.",
) -> dict:
    """Build the full kwargs dict for mcp__go-bananas__generate_image with canonical Bunty.

    The scene_description should describe ONLY pose, action, environment, lighting —
    NOT face/body details (those come from the canonical prompt + character ref).

    Returns a dict ready to spread into mcp__go-bananas__generate_image:
        {prompt, character_id, model_id, aspect_ratio, negative_prompt, enhance_prompt}
    """
    prompt = f"{BUNTY_CANONICAL_PROMPT} {landscape_token} {scene_description.strip()}"
    negative = BUNTY_NEGATIVE_PROMPT
    if negative_extra:
        negative = f"{negative}, {negative_extra}"
    return {
        "prompt": prompt,
        "character_id": BUNTY_CHARACTER_ID,
        "model_id": "gemini-pro-image",
        "aspect_ratio": aspect_ratio,
        "negative_prompt": negative,
        "enhance_prompt": False,
    }


# ---------------------------------------------------------------------------
# Auto-ground: pull the actual match venue from match_facts.txt and build
# a Bunty image scene description anchored to it (instead of using a generic
# location preset like cricket-ground / tropical-beach).
# ---------------------------------------------------------------------------
# Match 12 (Billing / Bernard Weston Pavilion) and Match 13 (Avenue Road /
# Finedon Dolben) both needed manual Bunty prompt customisation per match
# because the cricket-ground preset references "Memorial Sports Ground" by
# name, which is wrong for away fixtures. These helpers automate that step.

_GROUND_LINE_RE = re.compile(r"^\s*Ground\s+(.+?)\s*$", re.MULTILINE)


def parse_ground_from_match_facts(facts_path: Path | str) -> str | None:
    """Extract the 'Ground       <name>' value from a match_facts.txt file.

    The play-cricket /print PDF starts with a header block that includes a
    line like `Ground       Avenue Road`. pdftotext --layout preserves the
    column gap as whitespace.

    Returns the trimmed ground name, or None if not found / file missing.
    """
    p = Path(facts_path)
    if not p.is_file():
        return None
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    m = _GROUND_LINE_RE.search(text)
    if not m:
        return None
    ground = m.group(1).strip()
    # Some play-cricket pages render two columns; strip anything after
    # 2+ consecutive spaces (next column header).
    ground = re.split(r"\s{2,}", ground, maxsplit=1)[0].strip()
    return ground or None


def build_match_ground_scene_description(
    ground_name: str,
    segment: str,
    *,
    region: str = "Northamptonshire, England",
) -> str:
    """Build a Bunty scene description anchored to a specific match ground
    (parsed from match_facts.txt by parse_ground_from_match_facts).

    Args:
        ground_name: Free-form ground name, e.g. "Avenue Road" or "Billing".
        segment: "intro" (golden-hour, energetic) or "outro" (twilight, reflective).
        region: Optional regional anchor — defaults to Northants since the league
            is Northamptonshire Cricket League. Override for tour fixtures.
    """
    if segment not in ("intro", "outro"):
        raise ValueError(f"segment must be 'intro' or 'outro', got {segment!r}")
    ground = ground_name.strip()
    if segment == "intro":
        return (
            f"He is standing at the boundary edge of {ground} cricket ground in "
            f"{region} — an English village / club cricket ground in golden-hour "
            "Saturday afternoon light. Visible context: lush green outfield, "
            "modest single-storey English club pavilion with white-painted "
            "weatherboard cladding in soft focus behind him to one side, white "
            "vertical sightscreen at the bowler's end in the distance, mature "
            "English oak and chestnut trees ringing the boundary, plain wooden "
            "boundary benches, soft warm late-afternoon English sunshine, calm "
            "Saturday-league atmosphere, no spectators, no signage. Bunty is "
            "energetic, mid-gesture with his free hand, big toothy grin, eyes "
            "wide with excitement. His mouth is closed, lips together, NOT "
            "mid-speech. He holds a black handheld microphone with a furry "
            "windsock at chest level."
        )
    return (
        f"He is at the boundary of {ground} cricket ground in {region} as "
        "twilight falls after a long Saturday match. Visible context: lush "
        "green outfield going dark, modest single-storey English club pavilion "
        "with white-painted weatherboard cladding silhouetted behind him with "
        "warm interior lights glowing through the windows, white sightscreen "
        "just visible in the gloom, deep purple-orange dusk sky overhead with "
        "first stars, mature English oak and chestnut trees ringing the "
        "boundary as dark silhouettes, soft warm halation halos around the "
        "pavilion lights. No spectators, no signage. Bunty is calmer, "
        "reflective, his free hand raised in a relaxed salute, warm satisfied "
        "smile. His mouth is closed, lips together, NOT mid-speech. He holds "
        "a black handheld microphone."
    )


# ---------------------------------------------------------------------------
# Intro / sign-off line templates
# ---------------------------------------------------------------------------
# Scene 17 (intro 1) and scene 21 (sign-off) have near-identical structure
# across all matches — only venue, result, and margin/points change. These
# templates keep the Bunty voice consistent and stay under the 28-word /
# 20-word cutoffs (per bunty-voice-guide.md and bunty_dialogue_lint.py).

def build_intro_line(
    venue: str,
    result: str,
    margin: str,
    *,
    won: bool,
) -> str:
    """Build the scene 17 (intro 1) line.

    Args:
        venue: e.g. "Billing", "Memorial Sports Ground", "Thurleigh"
        result: e.g. "beaten Stony Stratford", "dismantled Rothwell Town", "took a beating"
        margin: e.g. "twenty-eight runs", "one-twenty-nine runs"
        won: True if WICC won, False if they lost — flips the catchphrase

    Returns a line in the 24-26 word range (Veo-safe).
    """
    catchphrase = "Shabash!" if won else "Hai Ram!"
    return (
        f"What a day at {venue}, boys! It's your boy Bunty — "
        f"and the Indians have {result} by {margin}! "
        f"{catchphrase} Let's break it down."
    )


def build_signoff_line(points: str, *, won: bool) -> str:
    """Build the scene 21 (final sign-off) line.

    Args:
        points: e.g. "Twenty points", "Five points"
        won: True if WICC won — picks "Job done" vs "Lesson learned"

    Returns a line in the 15-18 word range (sign-off-safe).
    """
    closer = "Job done" if won else "Lesson learned"
    return (
        f"{points}. {closer}. See you next match — "
        f"keep it Indian, keep it cricket. Bunty out!"
    )


def build_tied_intro_line(venue: str, opponent: str, tied_score: str) -> str:
    """Build scene 17 (intro 1) for a TIED match.

    Args:
        venue: e.g. "the New Ground"
        opponent: e.g. "Wollaston"
        tied_score: e.g. "Sixty-seven each", "One-fifty each"

    Returns a line in the 22-26 word range (Veo-safe).
    """
    return (
        f"What a day at {venue}! Bunty here — and the Indians "
        f"have TIED with {opponent}! {tied_score}. Stick around for the breakdown!"
    )


def build_tied_signoff_line(points_each: str = "Two points each") -> str:
    """Build scene 21 sign-off for a TIED match.

    Args:
        points_each: e.g. "Two points each" (standard for a tie)

    Returns a 15-17 word line.
    """
    return (
        f"{points_each}. Honours even. See you next match — "
        f"keep it Indian, keep it cricket. Bunty out!"
    )


# Compatibility aliases for older imports
BUNTY_CANONICAL = BUNTY_CANONICAL_PROMPT
BUNTY_NEGATIVE = BUNTY_NEGATIVE_PROMPT


# ---------------------------------------------------------------------------
# Location presets — Bunty doesn't have to report from a cricket boundary
# every match. Each preset bundles intro + outro scene descriptions that
# share a setting (visual continuity within a single video) but vary across
# matches for catalog variety. Pick a fresh location per match.
#
# Within a preset:
#   - `image_intro` / `image_outro`: scene description fed to Go Bananas
#     `build_bunty_image_kwargs()` for the hero portrait
#   - `veo_intro_a` (scene 17): energetic push-in/track shot
#   - `veo_intro_b` (scene 19): chained continuation with hand gestures
#   - `veo_outro_a` (scene 20): reflective zoom-out / hand salute
#   - `veo_outro_b` (scene 21): static dramatic sign-off
# ---------------------------------------------------------------------------

BUNTY_LOCATIONS: dict[str, dict[str, str]] = {
    "cricket-ground": {
        "summary": "Northamptonshire cricket boundary at golden hour (Memorial Sports Ground vibe)",
        "image_intro": (
            "He is standing at the boundary edge of a green Northamptonshire cricket ground in "
            "golden-hour light. Memorial Sports Ground style — wooden pavilion in soft focus "
            "behind, vertical sight screen visible, lens flare on the right. Bunty is energetic, "
            "mid-gesture with his free hand, big toothy grin, eyes wide with excitement. His "
            "mouth is closed, lips together, NOT mid-speech. He holds a black handheld microphone "
            "with a furry windsock at chest level."
        ),
        "image_outro": (
            "He is standing at the edge of the cricket pitch as twilight falls. Memorial Sports "
            "Ground style with stadium lights starting to glow softly behind him with halation "
            "halos, deep purple-orange dusk sky overhead, pavilion silhouette in the background. "
            "Bunty is calmer, reflective, his free hand raised in a relaxed salute, warm satisfied "
            "smile. His mouth is closed, lips together, NOT mid-speech. He holds a black handheld "
            "microphone."
        ),
        "ambient_intro": "cricket ground ambience, distant crowd murmur, light wind",
        "ambient_outro": "evening cricket ground ambience, distant crowd, soft wind",
    },
    "tropical-beach": {
        "summary": "Tropical beach at golden hour, palm trees, turquoise ocean",
        "image_intro": (
            "He is standing on a tropical white-sand beach at golden hour. Tall palm trees lean "
            "behind him, turquoise ocean waves break softly in the mid-distance, a wooden beach "
            "shack with thatched roof is visible in soft focus. Warm golden light from the low "
            "sun. Bunty is energetic, mid-gesture with his free hand, big toothy grin, eyes "
            "wide with excitement. His mouth is closed, lips together, NOT mid-speech. He holds "
            "a black handheld microphone with a furry windsock at chest level."
        ),
        "image_outro": (
            "He is standing on the same tropical beach as twilight falls. Palm trees are now "
            "silhouetted, a small driftwood bonfire glows warmly to his side, the ocean reflects "
            "deep purple and orange sunset hues, hanging fairy lights twinkle on the beach shack "
            "behind. Bunty is calmer, reflective, his free hand raised in a relaxed salute, "
            "warm satisfied smile. His mouth is closed, lips together, NOT mid-speech. He holds "
            "a black handheld microphone."
        ),
        "ambient_intro": "gentle ocean waves, distant seabirds, soft tropical breeze",
        "ambient_outro": "evening ocean waves, crackling bonfire, soft night breeze",
    },
    "fancy-car": {
        "summary": "Vintage British convertible on a scenic country road",
        "image_intro": (
            "He is seated in the driver's seat of a polished vintage British convertible "
            "(racing-green Jaguar E-Type style) with the top down, parked on a scenic country "
            "lane. Rolling green Northamptonshire countryside stretches behind, drystone wall "
            "visible at the roadside, midday sun. Polished walnut dashboard and leather steering "
            "wheel in foreground. Bunty is energetic, mid-gesture with his free hand, big toothy "
            "grin, eyes wide with excitement. His mouth is closed, lips together, NOT mid-speech. "
            "He holds a black handheld microphone with a furry windsock at chest level."
        ),
        "image_outro": (
            "He is in the same vintage convertible, now parked at a scenic overlook at dusk. "
            "Headlights glow softly, the countryside is bathed in alpenglow, a deep purple sky "
            "settles in behind. Polished dashboard reflects the sunset. Bunty is calmer, "
            "reflective, his free hand raised in a relaxed salute over the windscreen, warm "
            "satisfied smile. His mouth is closed, lips together, NOT mid-speech. He holds a "
            "black handheld microphone."
        ),
        "ambient_intro": "soft engine idle, birdsong, gentle countryside breeze",
        "ambient_outro": "soft engine off, evening crickets, distant owl",
    },
    "indian-restaurant": {
        "summary": "Upscale Indian restaurant interior, warm hanging lanterns",
        "image_intro": (
            "He is standing inside an upscale Indian restaurant in mid-afternoon light streaming "
            "through tall arched windows. Warm hanging brass lanterns glow above carved wooden "
            "tables in soft focus behind him, intricate jali screen wall on the right, a small "
            "tabla and harmonium decoration visible. Polished marble floor reflects the warm "
            "light. Bunty is energetic, mid-gesture with his free hand, big toothy grin, eyes "
            "wide with excitement. His mouth is closed, lips together, NOT mid-speech. He holds "
            "a black handheld microphone with a furry windsock at chest level."
        ),
        "image_outro": (
            "He is in the same restaurant after the dinner service has ended. Candles glow "
            "on the tables behind, the lanterns are dim and warm, the jali screen casts patterned "
            "shadows on the wall, a faint chai aroma is suggested by steam from a kettle on a "
            "side table. Bunty is calmer, reflective, his free hand raised in a relaxed salute, "
            "warm satisfied smile. His mouth is closed, lips together, NOT mid-speech. He holds "
            "a black handheld microphone."
        ),
        "ambient_intro": "soft sitar music, gentle clink of cutlery, distant kitchen chatter",
        "ambient_outro": "post-service quiet, soft kettle steam, distant tabla",
    },
    "mumbai-rooftop": {
        "summary": "Mumbai high-rise rooftop with Marine Drive skyline",
        "image_intro": (
            "He is standing on a modern Mumbai rooftop in late afternoon. The Marine Drive "
            "coastline curves behind him under hazy daylight, distant high-rises blur in soft "
            "focus, a small infinity pool reflects the sky at the edge of frame, potted palms "
            "frame the view. Bunty is energetic, mid-gesture with his free hand, big toothy "
            "grin, eyes wide with excitement. His mouth is closed, lips together, NOT mid-speech. "
            "He holds a black handheld microphone with a furry windsock at chest level."
        ),
        "image_outro": (
            "He is on the same Mumbai rooftop as twilight settles over the city. Marine Drive's "
            "iconic curve of streetlights — the Queen's Necklace — glows behind him, the sky is "
            "deep indigo with the last orange glow on the horizon, the infinity pool reflects "
            "the city lights. Bunty is calmer, reflective, his free hand raised in a relaxed "
            "salute, warm satisfied smile. His mouth is closed, lips together, NOT mid-speech. "
            "He holds a black handheld microphone."
        ),
        "ambient_intro": "distant city hum, soft sea breeze, far-off horns",
        "ambient_outro": "evening city pulse, soft pool ripples, distant traffic",
    },
    "food-truck": {
        "summary": "Mumbai chaat street-food stall with neon signage",
        "image_intro": (
            "He is standing beside a vibrant Mumbai chaat street-food stall in mid-afternoon. "
            "Colourful awnings stretch overhead, plates of samosas, pani puri, and bhel puri are "
            "visible on the counter behind him in soft focus, a steaming chai urn sits on the "
            "side, neon-lit menu boards in Hindi and English glow gently. Bunty is energetic, "
            "mid-gesture with his free hand, big toothy grin, eyes wide with excitement. His "
            "mouth is closed, lips together, NOT mid-speech. He holds a black handheld microphone "
            "with a furry windsock at chest level."
        ),
        "image_outro": (
            "He is at the same chaat stall as evening sets in. The neon signs now blaze "
            "vibrantly against the dusky sky, string lights twinkle along the awning, the chai "
            "urn steams visibly in the cooler air, a few late customers blur in the background. "
            "Bunty is calmer, reflective, his free hand raised in a relaxed salute, warm "
            "satisfied smile. His mouth is closed, lips together, NOT mid-speech. He holds a "
            "black handheld microphone."
        ),
        "ambient_intro": "sizzling street food, distant chatter, soft Bollywood music",
        "ambient_outro": "evening market hum, gentle wok sizzle, distant traffic",
    },
    "london-cab": {
        "summary": "Black London cab interior, iconic landmarks through window",
        "image_intro": (
            "He is seated in the passenger compartment of an iconic black London cab, looking "
            "toward camera. Through the rear window behind him: the iconic London skyline at "
            "midday — Tower Bridge or the London Eye visible in soft focus, double-decker buses "
            "passing. Polished interior trim, jump seats folded. Bunty is energetic, mid-gesture "
            "with his free hand, big toothy grin, eyes wide with excitement. His mouth is closed, "
            "lips together, NOT mid-speech. He holds a black handheld microphone with a furry "
            "windsock at chest level."
        ),
        "image_outro": (
            "He is in the same London cab as evening falls. Through the rear window: the lit-up "
            "London skyline at dusk — bridge lights glowing, double-decker buses with windows "
            "aglow, gentle rain reflecting streetlamps on the wet pavement. Bunty is calmer, "
            "reflective, his free hand raised in a relaxed salute, warm satisfied smile. His "
            "mouth is closed, lips together, NOT mid-speech. He holds a black handheld microphone."
        ),
        "ambient_intro": "distant London traffic, soft cab engine, occasional bus rumble",
        "ambient_outro": "evening London rain, soft cab idle, distant bus",
    },
    "mountain-hike": {
        "summary": "Himalayan vista, snow-capped peaks, prayer flags",
        "image_intro": (
            "He is standing at a Himalayan mountain overlook in clear daylight. Snow-capped "
            "peaks stretch into the distance behind him, colourful Tibetan prayer flags flutter "
            "on a stone cairn beside him, pine forest carpets the slopes below. Crisp mountain "
            "air, brilliant blue sky. Bunty is energetic, mid-gesture with his free hand, big "
            "toothy grin, eyes wide with excitement. His mouth is closed, lips together, NOT "
            "mid-speech. He holds a black handheld microphone with a furry windsock at chest "
            "level."
        ),
        "image_outro": (
            "He is at the same Himalayan overlook as the sun sets. Alpenglow paints the snow "
            "peaks pink and gold behind him, the prayer flags glow against the deepening sky, "
            "a small campfire flickers warmly at his feet, distant peaks fade into purple "
            "silhouettes. Bunty is calmer, reflective, his free hand raised in a relaxed salute, "
            "warm satisfied smile. His mouth is closed, lips together, NOT mid-speech. He holds "
            "a black handheld microphone."
        ),
        "ambient_intro": "mountain wind, prayer flags fluttering, distant eagle cry",
        "ambient_outro": "soft alpine evening wind, crackling campfire, distant cowbell",
    },
    "tea-plantation": {
        "summary": "Darjeeling tea fields rolling over misty hills",
        "image_intro": (
            "He is standing on a path through a sprawling Darjeeling tea plantation in morning "
            "light. Endless rows of low tea bushes sweep down the hillside behind him, misty "
            "blue hills layer into the distance, a single tea picker in traditional dress is "
            "visible in soft focus far behind. Bunty is energetic, mid-gesture with his free "
            "hand, big toothy grin, eyes wide with excitement. His mouth is closed, lips "
            "together, NOT mid-speech. He holds a black handheld microphone with a furry "
            "windsock at chest level."
        ),
        "image_outro": (
            "He is on the same tea plantation path as evening golden hour glows. The tea bushes "
            "glow warm green, distant misty hills catch peach-pink sunset light, a colonial "
            "tea-estate bungalow's windows glow warmly in the background. Bunty is calmer, "
            "reflective, his free hand raised in a relaxed salute, warm satisfied smile. His "
            "mouth is closed, lips together, NOT mid-speech. He holds a black handheld microphone."
        ),
        "ambient_intro": "morning birdsong, soft mountain breeze, distant tea-picker chatter",
        "ambient_outro": "evening birdsong, gentle hill wind, distant temple bell",
    },
    "cricket-museum": {
        "summary": "Vintage cricket museum interior, autographed memorabilia",
        "image_intro": (
            "He is standing in a vintage cricket museum gallery in warm daylight from skylight "
            "windows. Glass display cases of autographed bats, vintage caps, and yellowing "
            "scorecards line the wall behind him in soft focus, a wooden plaque of historic "
            "captains hangs above, polished parquet floor reflects the gallery lights. Bunty is "
            "energetic, mid-gesture with his free hand, big toothy grin, eyes wide with "
            "excitement. His mouth is closed, lips together, NOT mid-speech. He holds a black "
            "handheld microphone with a furry windsock at chest level."
        ),
        "image_outro": (
            "He is in the same museum after closing hours. Soft picture lights illuminate the "
            "display cases warmly, the gallery is otherwise dim and intimate, the parquet floor "
            "reflects the focused exhibit lights. Bunty is calmer, reflective, his free hand "
            "raised in a relaxed salute, warm satisfied smile. His mouth is closed, lips "
            "together, NOT mid-speech. He holds a black handheld microphone."
        ),
        "ambient_intro": "hushed museum atmosphere, soft footsteps in the distance, faint HVAC hum",
        "ambient_outro": "after-hours museum silence, soft creaks of wood, very faint clock tick",
    },
}

DEFAULT_LOCATION = "cricket-ground"


def get_location_scene(location: str, segment: str) -> str:
    """Look up scene description for a given location + segment ('intro' or 'outro').
    Falls back to default cricket-ground on unknown location with a stderr warning."""
    import sys as _sys
    if location not in BUNTY_LOCATIONS:
        print(f"[bunty_helpers] WARNING: unknown location '{location}', using '{DEFAULT_LOCATION}'", file=_sys.stderr)
        location = DEFAULT_LOCATION
    key = "image_intro" if segment == "intro" else "image_outro"
    return BUNTY_LOCATIONS[location][key]


def get_location_ambient(location: str, segment: str) -> str:
    """Look up ambient sound description for a given location + segment."""
    if location not in BUNTY_LOCATIONS:
        location = DEFAULT_LOCATION
    key = "ambient_intro" if segment == "intro" else "ambient_outro"
    return BUNTY_LOCATIONS[location][key]


def list_locations() -> list[tuple[str, str]]:
    """Return [(name, summary), ...] for help output."""
    return [(name, data["summary"]) for name, data in BUNTY_LOCATIONS.items()]
