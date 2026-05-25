#!/usr/bin/env python3
"""
Seedance 2.0 Hook & Camera Library — Production-grade patterns from Higgsfield skills.

Provides 2-second hook frameworks, camera movement encyclopedias, and lighting presets
for use by the Prompt Director when composing prompts.

Source: https://github.com/beshuaxian/higgsfield-seedance2-jineng
"""

from __future__ import annotations

import random
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# 2-Second Hook Framework
# ---------------------------------------------------------------------------

@dataclass
class Hook:
    name: str
    description: str
    genres: list[str]
    prompt_fragment: str


HOOKS: list[Hook] = [
    # Cinematic hooks
    Hook("extreme_closeup_reveal", "Extreme close-up of detail, pulls back to reveal full scene",
         ["cinematic", "drama", "ecommerce", "fashion"],
         "Extreme close-up of {detail}, camera slowly pulls back to reveal"),
    Hook("black_to_light", "Darkness bursts into light, revealing subject",
         ["cinematic", "drama", "action"],
         "Complete darkness, then a burst of light reveals"),
    Hook("reverse_motion", "Action plays in reverse then snaps forward",
         ["cinematic", "action", "fight"],
         "Reverse motion of {action}, then snaps forward to normal speed"),
    Hook("silhouette_reveal", "Backlit silhouette, light shifts to reveal subject",
         ["cinematic", "fashion", "drama"],
         "Dramatic backlit silhouette, light gradually shifts to reveal"),
    Hook("eye_contact", "Direct eye contact with camera, immediate connection",
         ["cinematic", "drama", "fashion", "social"],
         "Direct intense eye contact with camera, commanding attention"),

    # Product/E-commerce hooks
    Hook("particle_materialization", "Product emerges from particles, slowly solidifies",
         ["ecommerce", "3d_cgi", "product"],
         "Particles swirl and coalesce, slowly materializing into"),
    Hook("spotlight_snap", "Single harsh spotlight illuminates product in darkness",
         ["ecommerce", "product", "fashion"],
         "Darkness, then a single dramatic spotlight snaps on to illuminate"),
    Hook("unwrap_reveal", "Protective wrapping peels away to reveal product",
         ["ecommerce", "product"],
         "Elegant wrapping peels away layer by layer, revealing"),
    Hook("self_assembly", "Product components float and snap into place",
         ["ecommerce", "3d_cgi", "product"],
         "Individual components float in space, then snap together with precision into"),
    Hook("macro_to_wide", "Impossible-angle macro pulls back to full view",
         ["ecommerce", "product", "food"],
         "Extreme macro on {texture_detail}, camera pulls back smoothly to reveal full"),

    # Fashion hooks
    Hook("dramatic_outfit_reveal", "Curtain/door opening exposes garment",
         ["fashion", "ecommerce"],
         "Curtain pulls back dramatically, revealing"),
    Hook("power_walk_approach", "Model walks directly at camera with confidence",
         ["fashion", "social"],
         "Confident power-walk directly toward camera, showcasing"),
    Hook("fabric_texture_macro", "Extreme close-up of material, pulls back to reveal wearer",
         ["fashion", "ecommerce"],
         "Extreme macro on fabric texture, slowly pulling back to reveal"),
    Hook("slow_motion_wind", "Hair/fabric billow in breeze",
         ["fashion", "cinematic"],
         "Slow-motion wind catches fabric and hair, billowing dramatically as"),

    # Action hooks
    Hook("impact_shockwave", "Crash with impact and ripple effect",
         ["action", "fight", "3d_cgi"],
         "Explosive impact creates shockwave ripple, camera shakes as"),
    Hook("speed_ramp", "Fast to slow motion transition",
         ["action", "fight", "cinematic"],
         "Ultra-fast motion suddenly shifts to dramatic slow-motion as"),

    # Food/Beverage hooks
    Hook("splash_freeze", "Liquid splash frozen mid-air",
         ["food", "ecommerce"],
         "Dynamic liquid splash frozen in mid-air, droplets suspended, then"),
    Hook("steam_rise", "Steam/aroma rises from subject",
         ["food"],
         "Wisps of steam rise from {subject}, catching warm light as"),
]


def get_hooks_for_genre(genre: str, count: int = 3) -> list[Hook]:
    """Get the best hooks for a given genre."""
    # Exact matches first, then partial
    exact = [h for h in HOOKS if genre.lower() in h.genres]
    if len(exact) >= count:
        return random.sample(exact, count)
    # Fill with general cinematic hooks
    general = [h for h in HOOKS if "cinematic" in h.genres and h not in exact]
    return (exact + general)[:count]


def format_hook(hook: Hook, **kwargs: str) -> str:
    """Format a hook's prompt fragment with scene-specific details."""
    # Use a defaultdict so missing placeholders like {subject} stay as generic text
    # instead of raising KeyError when the caller only provides {detail}/{action}.
    class _Defaults(dict):
        def __missing__(self, key: str):
            return f"the {key}"
    return hook.prompt_fragment.format_map(_Defaults({k: v for k, v in kwargs.items() if v}))


# ---------------------------------------------------------------------------
# Camera Movement Encyclopedia
# ---------------------------------------------------------------------------

@dataclass
class CameraMove:
    name: str
    seedance_phrase: str
    speed: str
    best_for: list[str]


CAMERA_MOVES: list[CameraMove] = [
    # Dolly/Track
    CameraMove("dolly_forward", "slow dolly forward", "2 ft/s", ["reveal", "approach", "detail"]),
    CameraMove("dolly_back", "slow dolly backward", "2 ft/s", ["reveal", "establish", "pullback"]),
    CameraMove("tracking_lateral", "smooth lateral tracking shot", "3 ft/s", ["walk", "movement", "fashion"]),
    CameraMove("push_in", "camera pushes in steadily", "medium", ["tension", "focus", "drama"]),
    CameraMove("pull_back_reveal", "camera pulls back to reveal", "medium", ["reveal", "establish", "product"]),

    # Pan/Tilt
    CameraMove("pan_left", "slow horizontal pan left", "15°/s", ["environment", "scene"]),
    CameraMove("pan_right", "slow horizontal pan right", "15°/s", ["environment", "scene"]),
    CameraMove("tilt_up", "camera tilts upward", "10°/s", ["reveal", "scale", "architecture"]),
    CameraMove("tilt_down", "camera tilts downward", "10°/s", ["reveal", "product", "detail"]),

    # Orbit/Rotation
    CameraMove("orbit_360", "smooth 360-degree orbital shot", "30°/s", ["product", "showcase", "hero"]),
    CameraMove("orbit_180", "smooth 180-degree arc", "25°/s", ["reveal", "product", "fashion"]),
    CameraMove("slow_orbit", "slow continuous orbital movement", "15°/s", ["luxury", "product", "cinematic"]),

    # Crane/Boom
    CameraMove("crane_up", "crane rises smoothly upward", "medium", ["reveal", "establish", "epic"]),
    CameraMove("crane_down", "crane descends smoothly", "medium", ["approach", "intimate", "detail"]),
    CameraMove("boom_up_rotation", "camera rises vertically during rotation", "medium", ["product", "epic"]),

    # Steadicam/Smooth
    CameraMove("steadicam_follow", "smooth Steadicam follow shot", "walking pace", ["follow", "walk", "fashion"]),
    CameraMove("floating_glide", "ethereal floating camera movement", "slow", ["dream", "fantasy", "luxury"]),

    # Special
    CameraMove("whip_pan", "rapid whip pan transition", "90°/s", ["transition", "energy", "action"]),
    CameraMove("rack_focus", "rack focus from foreground to background", "0.5s", ["depth", "reveal", "detail"]),
    CameraMove("dolly_zoom", "simultaneous zoom and dolly creating vertigo", "medium", ["tension", "drama"]),
    CameraMove("dutch_tilt", "tilted camera angle", "static", ["unease", "style", "action"]),
    CameraMove("aerial_descend", "aerial camera descending toward subject", "medium", ["establish", "epic", "reveal"]),
]


def get_camera_for_purpose(purpose: str) -> list[CameraMove]:
    """Get camera moves suitable for a purpose (reveal, product, walk, etc.)."""
    return [c for c in CAMERA_MOVES if purpose.lower() in c.best_for]


# ---------------------------------------------------------------------------
# Lighting Presets
# ---------------------------------------------------------------------------

@dataclass
class LightingPreset:
    name: str
    kelvin: str
    description: str
    genres: list[str]


LIGHTING_PRESETS: list[LightingPreset] = [
    LightingPreset("golden_hour", "3200K", "Warm, diffused, flattering golden light",
                   ["fashion", "cinematic", "food", "real_estate"]),
    LightingPreset("studio_flash", "5600K", "Crisp editorial lighting with defined shadows",
                   ["fashion", "ecommerce", "product"]),
    LightingPreset("three_point", "4000K", "Classic three-point lighting setup",
                   ["cinematic", "drama", "interview"]),
    LightingPreset("chiaroscuro", "3500K", "High-contrast dramatic light and shadow",
                   ["cinematic", "drama", "action"]),
    LightingPreset("neon_night", "mixed", "Colorful artificial neon lighting, edgy atmosphere",
                   ["action", "social", "anime", "urban"]),
    LightingPreset("moonlit_cool", "6500K", "Cool blue moonlight atmosphere",
                   ["cinematic", "drama", "fantasy"]),
    LightingPreset("volumetric_rays", "4500K", "God rays with visible light shafts",
                   ["cinematic", "fantasy", "epic"]),
    LightingPreset("soft_diffused", "4000K", "Soft window light, minimal shadows",
                   ["fashion", "food", "product", "minimalist"]),
    LightingPreset("dramatic_backlight", "variable", "Strong backlighting creating silhouettes and rim light",
                   ["fashion", "cinematic", "drama"]),
    LightingPreset("cool_clinical", "5600K", "Clean, bright, precision lighting",
                   ["product", "ecommerce", "tech"]),
    LightingPreset("warm_ambient", "3200K", "Warm practical lighting from environment",
                   ["food", "real_estate", "lifestyle"]),
    LightingPreset("rim_light", "variable", "Strong edge lighting separating subject from background",
                   ["action", "fight", "cinematic"]),

    # Expanded lighting presets
    LightingPreset("overcast_diffuse", "5500K", "Overcast sky diffusion, even soft shadows, muted colors",
                   ["documentary", "drama"]),
    LightingPreset("tungsten_warm", "2700K", "Warm tungsten bulb interior, 2700K, cozy orange cast",
                   ["drama", "ugc"]),
    LightingPreset("fluorescent_cool", "4000K", "Cool fluorescent office lighting, slightly green tint, flat",
                   ["horror", "thriller"]),
    LightingPreset("fire_flicker", "1800K", "Campfire or candle flicker, dancing warm shadows, intimate",
                   ["drama", "fantasy"]),
    LightingPreset("sunrise_gradient", "3000-5000K", "Dawn gradient from deep blue to warm amber on horizon",
                   ["cinematic", "nature"]),
    LightingPreset("sunset_silhouette", "2500K", "Strong backlight from low sun, deep silhouettes, warm rim",
                   ["cinematic", "music-video"]),
    LightingPreset("split_lighting", "4500K", "Half-face illuminated, half in shadow, dramatic bisection",
                   ["drama", "thriller", "portrait"]),
    LightingPreset("butterfly_lighting", "5000K", "Key light directly above, butterfly shadow under nose, glamorous",
                   ["fashion", "beauty"]),
    LightingPreset("rembrandt_lighting", "4200K", "45-degree key with triangle of light on shadow cheek, classic portrait",
                   ["cinematic", "portrait"]),
    LightingPreset("practical_lighting", "mixed", "Only visible light sources in frame — lamps, screens, signs",
                   ["drama", "ugc", "thriller"]),
    LightingPreset("haze_atmosphere", "5500K", "Light atmospheric haze with visible light beams, ethereal",
                   ["cinematic", "fantasy", "music-video"]),
    LightingPreset("underwater_caustics", "6500K", "Dappled underwater light patterns, blue-green ripples on surfaces",
                   ["fantasy", "nature", "3d"]),
    LightingPreset("stage_spotlight", "5600K", "Single focused spot from above, black surroundings, theatrical",
                   ["music-video", "drama", "dance"]),
    LightingPreset("cyberpunk_neon_mix", "mixed", "Multiple competing neon sources — pink, cyan, purple, harsh reflections on wet surfaces",
                   ["cyberpunk", "music-video", "meme"]),
    LightingPreset("natural_window", "5500K", "Soft natural light from a large window, gentle shadows, airy",
                   ["ugc", "lifestyle", "food"]),
    LightingPreset("horror_underlighting", "3500K", "Light source from below face, ghoulish shadows, unnatural",
                   ["horror", "thriller"]),
    LightingPreset("lens_flare_cinematic", "5600K", "Intentional anamorphic lens flares from bright source, JJ Abrams style",
                   ["cinematic", "sci-fi"]),
    LightingPreset("led_panel_rgb", "variable", "Colored LED panels creating gradient washes, modern production look",
                   ["music-video", "fashion", "tech"]),
]


def get_lighting_for_genre(genre: str) -> list[LightingPreset]:
    """Get lighting presets suitable for a genre."""
    return [lp for lp in LIGHTING_PRESETS if genre.lower() in lp.genres]


# ---------------------------------------------------------------------------
# Timeline Templates
# ---------------------------------------------------------------------------

TIMELINE_TEMPLATES: dict[int, list[dict[str, str]]] = {
    5: [
        {"beat": "hook", "time": "0-2s", "purpose": "Attention grab — 2-second hook"},
        {"beat": "payoff", "time": "2-5s", "purpose": "Main reveal or action"},
    ],
    8: [
        {"beat": "hook", "time": "0-2s", "purpose": "Attention grab"},
        {"beat": "context", "time": "2-5s", "purpose": "Establish scene/subject"},
        {"beat": "payoff", "time": "5-8s", "purpose": "Resolution or CTA"},
    ],
    10: [
        {"beat": "hook", "time": "0-2s", "purpose": "Attention grab"},
        {"beat": "setup", "time": "2-4s", "purpose": "Establish scene"},
        {"beat": "rising", "time": "4-7s", "purpose": "Build tension/interest"},
        {"beat": "climax", "time": "7-10s", "purpose": "Peak moment"},
    ],
    15: [
        {"beat": "hook", "time": "0-2s", "purpose": "Attention grab — stop the scroll"},
        {"beat": "setup", "time": "2-5s", "purpose": "Establish context and subject"},
        {"beat": "rising", "time": "5-9s", "purpose": "Build interest, show details"},
        {"beat": "climax", "time": "9-12s", "purpose": "Peak action or reveal"},
        {"beat": "resolution", "time": "12-15s", "purpose": "Closing pose or CTA"},
    ],
}


def get_timeline(duration: int) -> list[dict[str, str]]:
    """Get the best timeline template for a given duration."""
    # Find closest match
    durations = sorted(TIMELINE_TEMPLATES.keys())
    closest = min(durations, key=lambda d: abs(d - duration))
    return TIMELINE_TEMPLATES[closest]


# ---------------------------------------------------------------------------
# Director Style Presets
# ---------------------------------------------------------------------------

DIRECTOR_STYLE_PRESETS: dict[str, dict[str, str]] = {
    "villeneuve": {
        "name": "Denis Villeneuve",
        "camera": "slow wide establishing shots, symmetrical framing, extreme patience",
        "lighting": "desaturated natural light, volumetric haze, cold blue-gray palette",
        "color": "muted earth tones, teal shadows, minimal saturation",
        "mood": "epic scale, existential dread, overwhelming silence",
    },
    "wong-kar-wai": {
        "name": "Wong Kar-wai",
        "camera": "handheld close-ups, step-printed slow motion, canted angles",
        "lighting": "saturated neon reflections, warm tungsten interiors, rain-soaked streets",
        "color": "deep reds, greens, and blues, high contrast, film grain",
        "mood": "romantic melancholy, urban loneliness, time slipping away",
    },
    "wes-anderson": {
        "name": "Wes Anderson",
        "camera": "perfectly centered symmetrical compositions, flat frontal angles, whip pans",
        "lighting": "soft even pastel lighting, no harsh shadows, storybook quality",
        "color": "pastel palette — mint, coral, mustard, powder blue, cream",
        "mood": "whimsical, meticulously arranged, deadpan humor",
    },
    "spielberg": {
        "name": "Steven Spielberg",
        "camera": "low angle hero shots, sweeping crane movements, push-in on reaction faces",
        "lighting": "golden hour magic, volumetric god rays, warm practical lights",
        "color": "warm amber highlights, deep blue shadows, Janusz Kaminski contrast",
        "mood": "wonder, adventure, emotional crescendo",
    },
    "kubrick": {
        "name": "Stanley Kubrick",
        "camera": "one-point perspective tunnels, steady symmetrical tracking, long unbroken takes",
        "lighting": "cold sterile overhead fluorescents, or single candle practicals",
        "color": "clinical whites and cold blues, or warm candlelit gold",
        "mood": "unsettling precision, mechanical perfection, psychological tension",
    },
    "nolan": {
        "name": "Christopher Nolan",
        "camera": "IMAX extreme wide, practical in-camera effects, minimal CGI feel",
        "lighting": "natural overcast or harsh directional, high dynamic range",
        "color": "desaturated with selective warm accents, film stock texture",
        "mood": "cerebral intensity, time manipulation, visceral realism",
    },
    "tarantino": {
        "name": "Quentin Tarantino",
        "camera": "trunk shots, low angle power shots, long dialogue tracking, crash zooms",
        "lighting": "saturated high-key with deep shadows, 70s film stock warmth",
        "color": "bold saturated primaries, yellow tint, retro film grain",
        "mood": "stylized violence, sharp dialogue energy, pop culture cool",
    },
    "miyazaki": {
        "name": "Hayao Miyazaki",
        "camera": "gentle pan across landscapes, slow contemplative establishing, child's eye level",
        "lighting": "warm watercolor diffusion, soft cloud-filtered sunlight, magical golden sparkles",
        "color": "rich greens, sky blues, warm earth tones, hand-painted watercolor palette",
        "mood": "wonder, environmental reverence, gentle adventure, childhood innocence",
    },
    "fincher": {
        "name": "David Fincher",
        "camera": "impossibly smooth tracking, clinical precision, CGI-enhanced one-takes",
        "lighting": "sickly green-yellow fluorescents, dark moody interiors, rain-streaked windows",
        "color": "desaturated green-brown teal, crushed blacks, zero warmth",
        "mood": "obsessive detail, paranoid tension, elegant darkness",
    },
    "ridley-scott": {
        "name": "Ridley Scott",
        "camera": "epic sweeping helicopter shots, atmospheric slow push-ins, smoke-filled frames",
        "lighting": "shafts of light through dust and smoke, backlit silhouettes, fire glow",
        "color": "warm bronze and gold with cold steel blue, high contrast",
        "mood": "grand historical scale, mythic weight, visceral battle chaos",
    },
}


def get_director_style(name: str) -> dict[str, str] | None:
    """Get a director style preset by name (case-insensitive, partial match)."""
    lower = name.lower()
    for key, style in DIRECTOR_STYLE_PRESETS.items():
        if lower in key or lower in style["name"].lower():
            return style
    return None


# ---------------------------------------------------------------------------
# Color Grading Presets
# ---------------------------------------------------------------------------

COLOR_GRADING_PRESETS: dict[str, dict[str, str]] = {
    "teal-orange": {"name": "Teal & Orange", "description": "Hollywood blockbuster: teal shadows, warm orange skin tones, high contrast", "genres": ["cinematic", "action"]},
    "desaturated": {"name": "Desaturated", "description": "Muted colors, low saturation, documentary feel, raw and gritty", "genres": ["drama", "documentary", "thriller"]},
    "vintage-film": {"name": "Vintage Film", "description": "Faded colors, lifted blacks, warm yellow cast, film grain, 70s nostalgia", "genres": ["retro", "drama", "music-video"]},
    "neon-noir": {"name": "Neon Noir", "description": "Deep blacks with vivid neon accents (pink, cyan, purple), wet reflections", "genres": ["cyberpunk", "thriller", "music-video"]},
    "bleach-bypass": {"name": "Bleach Bypass", "description": "Desaturated high contrast, silvery highlights, gritty war-film look", "genres": ["war", "thriller", "drama"]},
    "monochrome-bw": {"name": "Monochrome B&W", "description": "Pure black and white, high contrast, dramatic shadows, timeless", "genres": ["drama", "art", "fashion"]},
    "pastel-dream": {"name": "Pastel Dream", "description": "Soft lifted shadows, pastel highlights, ethereal low contrast, dreamy", "genres": ["fantasy", "romance", "anime"]},
    "golden-hour": {"name": "Golden Hour", "description": "Warm amber wash, long soft shadows, everything bathed in honey light", "genres": ["cinematic", "romance", "nature"]},
    "cross-process": {"name": "Cross Process", "description": "Shifted colors — green shadows, magenta highlights, experimental film error look", "genres": ["music-video", "fashion", "experimental"]},
    "day-for-night": {"name": "Day for Night", "description": "Blue-tinted underexposed, simulated moonlight from daylight footage", "genres": ["horror", "thriller", "fantasy"]},
    "sepia-warm": {"name": "Sepia Warm", "description": "Warm brown monochrome, aged photograph feel, historical period", "genres": ["period", "western", "documentary"]},
    "ice-cold": {"name": "Ice Cold", "description": "Blue-white color shift, zero warmth, clinical sterile, frozen atmosphere", "genres": ["sci-fi", "horror", "thriller"]},
    "tropical-vivid": {"name": "Tropical Vivid", "description": "Boosted saturation, lush greens, bright sky blues, vibrant and alive", "genres": ["nature", "travel", "food", "lifestyle"]},
    "film-noir": {"name": "Film Noir", "description": "High contrast B&W, venetian blind shadows, smoke, hard directional light", "genres": ["thriller", "detective", "drama"]},
    "anime-cel": {"name": "Anime Cel", "description": "Flat colors with hard shadow edges, limited palette, clean line art feel", "genres": ["anime", "cartoon", "3d-toon"]},
}


def get_color_grading(genre: str) -> dict[str, str] | None:
    """Get the best color grading preset for a genre."""
    for key, preset in COLOR_GRADING_PRESETS.items():
        if genre.lower() in preset.get("genres", []):
            return preset
    return None


# ---------------------------------------------------------------------------
# Composition Rules
# ---------------------------------------------------------------------------

COMPOSITION_RULES: list[dict[str, str]] = [
    {"name": "Rule of Thirds", "description": "Place subject at intersection of thirds grid lines", "best_for": "general, portrait, landscape"},
    {"name": "Center Symmetry", "description": "Subject dead center, perfect bilateral symmetry, Kubrick/Anderson style", "best_for": "establishing, architectural, dramatic"},
    {"name": "Golden Ratio", "description": "Subject at golden spiral focal point, natural eye flow", "best_for": "nature, portrait, cinematic"},
    {"name": "Leading Lines", "description": "Roads, corridors, rivers guide eye to subject, depth emphasis", "best_for": "landscape, architecture, chase"},
    {"name": "Frame Within Frame", "description": "Use doorways, windows, arches to frame subject, adds depth layers", "best_for": "portrait, thriller, mystery"},
    {"name": "Negative Space", "description": "Subject small in vast empty space, emphasizes isolation or scale", "best_for": "cinematic, lonely, epic scale"},
    {"name": "Depth Layering", "description": "Foreground + midground + background elements, rich parallax depth", "best_for": "cinematic, action, establishing"},
    {"name": "Dutch Angle", "description": "Camera tilted 15-30 degrees, creates unease and dynamism", "best_for": "thriller, horror, action"},
    {"name": "Over-the-Shoulder", "description": "Camera behind one character looking at another, conversation intimacy", "best_for": "dialogue, confrontation, drama"},
    {"name": "Low Angle Power", "description": "Camera below eye level looking up, makes subject dominant and heroic", "best_for": "hero, villain, monument, power"},
    {"name": "High Angle Vulnerability", "description": "Camera above looking down, makes subject small and vulnerable", "best_for": "defeat, sadness, overview"},
    {"name": "Extreme Close-Up", "description": "Fill frame with single detail — eye, hand, object — intense focus", "best_for": "emotion, detail, tension"},
]


def get_composition_for_shot(shot_type: str) -> dict[str, str] | None:
    """Suggest a composition rule for a shot type."""
    lower = shot_type.lower()
    for rule in COMPOSITION_RULES:
        if any(term in lower for term in rule["best_for"].split(", ")):
            return rule
    return None


# ---------------------------------------------------------------------------
# Cinema Modes — curated bundles from Joey's cinema-worldbuilder skill
# ---------------------------------------------------------------------------
#
# Five named bundles of camera/lens/movement/filtration/grade. Each is a
# drop-in spec paragraph appended to the end of a Seedance prompt with
# `{lens_mm}` and `{runtime_s}` placeholders. Picking one of these instead
# of composing atom-by-atom from CAMERA_MOVES + LIGHTING_PRESETS +
# COLOR_GRADING_PRESETS gives the model a coherent, tested combination
# that survives Seedance's grading.
#
# pick_cinema_mode() auto-detects from scene keywords; callers can also
# pass an explicit mode via `cinema_mode` on the DirectorScene.

@dataclass
class CinemaMode:
    code: str            # 'M1' / 'M2' / 'M3' / 'M4' / 'M5'
    name: str            # 'Narrative' / 'Studio' / 'Action' / 'Performance' / 'Atmospheric'
    use_when: str        # Short description of when this mode fits
    body: str            # Camera body
    lens_family: str     # Lens family + range
    default_lens_mm: int # Default lens length when none specified
    movement: str        # Movement language
    filtration: str      # Filter stack
    grade: str           # Color grade summary
    spec_template: str   # Drop-in paragraph with {lens_mm} + {runtime_s} + optional {palette_descriptor} / {stage_lighting}


CINEMA_MODES: dict[str, CinemaMode] = {
    "M1": CinemaMode(
        code="M1",
        name="Narrative",
        use_when="Real-world dramatic — streets, kitchens, cars, bars, interior/exterior location",
        body="ARRI Alexa 35",
        lens_family="Panavision Ultra Vintage 2x anamorphic 40/55/75/100mm",
        default_lens_mm=55,
        movement="Handheld with natural breath and slight shake, occasional slow dolly",
        filtration="Tiffen Black Pro-Mist 1/4",
        grade="Kodak Vision3 250D, 800 ASA grain, teal-amber color split",
        spec_template=(
            "Shot on ARRI Alexa 35 in ProRes 4444 LogC4, Panavision Ultra Vintage 2x "
            "anamorphic {lens_mm}mm at T2.3 with Tiffen Black Pro-Mist 1/4 filter, "
            "handheld with natural breath and slight shake, photoreal cinematic grit "
            "with oval bokeh and horizontal streak flares, warm anamorphic falloff "
            "toward frame edges, Kodak Vision3 250D film emulation grade with slight "
            "halation on highlights and 800 ASA grain structure, teal-amber color "
            "split with cool teal-blue shadows and warm amber highlights, organic "
            "lens breathing on focus racks, shallow depth of field, 24fps base "
            "shutter 180 degrees, total runtime roughly {runtime_s} seconds."
        ),
    ),
    "M2": CinemaMode(
        code="M2",
        name="Studio / Editorial",
        use_when="White void, clean studio, editorial portraits, fashion film, hyperpop saturated set",
        body="ARRI Alexa Mini LF",
        lens_family="Cooke S4/i spherical 32/50/75/100mm",
        default_lens_mm=50,
        movement="Locked-off tripod with optional 4-to-6 inch slow push-in",
        filtration="Tiffen Black Pro-Mist 1/2 + Glimmerglass on chrome/rhinestone",
        grade="Saturated editorial — pushed magentas or pastels, warm-retained blacks, 400 ASA",
        spec_template=(
            "Shot on ARRI Alexa Mini LF in ProRes 4444 LogC4, Cooke S4/i spherical "
            "prime {lens_mm}mm at T2 with Tiffen Black Pro-Mist 1/2 filter, locked-off "
            "tripod with optional 4-to-6 inch slow push-in, photoreal editorial "
            "fashion film aesthetic with gentle halation bloom on highlights and "
            "soft warm falloff in the Cooke signature, fine 400 ASA film grain "
            "structure retaining warmth in the shadows, highlights allowed to bloom "
            "slightly around fabric and chrome surfaces, saturated editorial grade "
            "with warm-retained blacks not crushed to pure black, slight skin tone "
            "warmth from the Cooke color rendition, 24fps base shutter 180 degrees, "
            "total runtime roughly {runtime_s} seconds. Not CGI, not plastic, "
            "shot-on-film analog aesthetic with real-world lens character."
        ),
    ),
    "M3": CinemaMode(
        code="M3",
        name="Action / Combat",
        use_when="Combat, chase, stunts, mech battles, alien encounters, debris, smoke, dust",
        body="ARRI Alexa 35",
        lens_family="Panavision Ultra Vintage 2x anamorphic 40/55/75/100mm",
        default_lens_mm=40,
        movement="Handheld and shaky throughout with constant operator micro-jitter and chaotic shake; no stabilized or locked-off shots anywhere",
        filtration="Tiffen Black Pro-Mist 1/4",
        grade="Kodak Vision3 250D, 800 ASA, gritty documentary-meets-sci-fi war-film aesthetic",
        spec_template=(
            "Shot on ARRI Alexa 35 in ProRes 4444 LogC4, Panavision Ultra Vintage 2x "
            "anamorphic {lens_mm}mm at T2.3 with Tiffen Black Pro-Mist 1/4 filter, "
            "all camera work is handheld and shaky throughout with constant operator "
            "micro-jitter, reactive movement, and chaotic shake, no stabilized or "
            "locked-off or dolly-smooth shots anywhere, gritty documentary-meets-"
            "sci-fi war film aesthetic with no stylization and everything grounded "
            "in physical realism, Kodak Vision3 250D film emulation with 800 ASA "
            "grain structure, {palette_descriptor} with dusty atmospheric haze, "
            "slight halation on highlights, 24fps base shutter 180 degrees, total "
            "runtime roughly {runtime_s} seconds."
        ),
    ),
    "M4": CinemaMode(
        code="M4",
        name="Performance / Concert",
        use_when="Stadium and arena performance, festival pit, concert footage, jumbotron-and-lightstick worlds",
        body="ARRI Alexa 35",
        lens_family="Panavision Ultra Vintage 2x anamorphic 40/55/75/100mm",
        default_lens_mm=40,
        movement="Mixed handheld pit-photographer and shaky operator energy, orbital handheld around figures, hard cuts between angles",
        filtration="Tiffen Black Pro-Mist 1/4",
        grade="Desaturated cool tones with warm highlight bloom, deep blacks, heavy volumetric haze",
        spec_template=(
            "Shot on ARRI Alexa 35 in ProRes 4444 LogC4, Panavision Ultra Vintage 2x "
            "anamorphic {lens_mm}mm at T2.3 with Tiffen Black Pro-Mist 1/4 filter, "
            "mixed handheld pit-photographer energy with rapid handhelds and shaky "
            "low-angle operator work and orbital handheld passes around the "
            "performers, hard cuts between angles, no stabilized or locked-off "
            "shots, photoreal concert documentary aesthetic, Kodak Vision3 250D "
            "film emulation with fine grain structure overlaid throughout, slightly "
            "desaturated cool tones with warm highlight bloom and deep blacks "
            "holding shadow detail, {stage_lighting}, heavy volumetric haze with "
            "dust suspended in every beam, real sweat sheen on skin and real fabric "
            "darkening from exertion, gentle halation on light sources, 24fps base "
            "shutter 180 degrees, total runtime roughly {runtime_s} seconds."
        ),
    ),
    "M5": CinemaMode(
        code="M5",
        name="Atmospheric / Empty",
        use_when="Abandoned environments, no-humans plates, landscapes, weather pieces, world-establishing footage",
        body="ARRI Alexa Mini LF",
        lens_family="Panavision Ultra Vintage 2x anamorphic 35-85mm push range",
        default_lens_mm=35,
        movement="Locked-off or extremely slow push-in / pull-back / drift; no handheld",
        filtration="Tiffen Black Pro-Mist 1/4",
        grade="Kodak Vision3 250D, 400 ASA, palette-driven with hex values per scene",
        spec_template=(
            "Shot on ARRI Alexa Mini LF in ProRes 4444 LogC4, Panavision Ultra Vintage "
            "2x anamorphic {lens_mm}mm at T2.3 with Tiffen Black Pro-Mist 1/4 filter, "
            "locked-off or extremely slow push-in motion only, no handheld energy, "
            "photoreal atmospheric environment plate aesthetic, Kodak Vision3 250D "
            "film emulation with fine 400 ASA grain structure, palette-driven grade "
            "with {palette_descriptor}, strong negative space, deep depth of field, "
            "light atmospheric haze with dust particles suspended in air, weathered "
            "material detail with oxidized metal and dust-covered glass and cracked "
            "paint and moisture stains, slight anamorphic flares on any directional "
            "light sources, 24fps base shutter 180 degrees, total runtime roughly "
            "{runtime_s} seconds. No humans, no silhouettes, no living beings — the "
            "environment is the subject."
        ),
    ),
}


# Auto-detection keyword sets. Order matters — M5 (no-humans) before M1
# (narrative default), so "abandoned street" doesn't fall through to M1.
_CINEMA_MODE_KEYWORDS: list[tuple[str, list[str]]] = [
    ("M5", [
        "no humans", "no people", "no figures", "empty", "abandoned",
        "deserted", "uninhabited", "ghost city", "ghost town", "ruins",
        "no living beings", "weather plate", "landscape plate", "environment plate",
        "no-humans", "pure environment", "establishing shot", "establishing wide",
    ]),
    ("M3", [
        "combat", "fight", "fighting", "chase", "chasing", "stunt", "stunts",
        "mech", "mechs", "alien encounter", "alien battle", "war", "battle",
        "explosion", "explodes", "debris", "rubble", "smoke and dust",
        "smashes through", "crashes into", "shockwave", "impact",
        "high-energy physical", "fight choreography",
    ]),
    ("M4", [
        "stadium", "arena", "concert", "performance", "festival",
        "jumbotron", "lightstick", "light stick", "pit", "front barrier",
        "stage lighting", "crowd cheers", "audience screams",
        "on stage", "on-stage", "fans screaming", "k-pop", "live show",
    ]),
    ("M2", [
        "white void", "white seamless", "studio backdrop", "editorial",
        "fashion film", "runway", "lookbook", "hyperpop", "clean set",
        "studio shoot", "fashion editorial", "void background",
        "pastel void", "saturated set",
    ]),
    # M1 is the default — no keywords listed; falls through.
]


def pick_cinema_mode(scene_description: str, fallback: str = "M1") -> str:
    """Auto-pick a cinema mode code (M1-M5) from a scene description.

    Returns 'M1' (Narrative) when no specific keywords match — the safe
    default for lived-in real-world scenes.

    Args:
        scene_description: free-text scene description.
        fallback: mode to return when nothing matches (default 'M1').

    Returns:
        Cinema mode code: 'M1' / 'M2' / 'M3' / 'M4' / 'M5'.
    """
    lower = scene_description.lower()
    for code, keywords in _CINEMA_MODE_KEYWORDS:
        if any(kw in lower for kw in keywords):
            return code
    return fallback


def get_cinema_mode(code: str) -> CinemaMode | None:
    """Look up a CinemaMode by code (case-insensitive, 'M1'/'M2'/etc.)."""
    return CINEMA_MODES.get(code.upper().strip())


def render_cinema_mode_spec(
    code: str,
    runtime_s: int,
    lens_mm: int | None = None,
    *,
    palette_descriptor: str | None = None,
    stage_lighting: str | None = None,
) -> str:
    """Render a CinemaMode's spec template with concrete values.

    Args:
        code: 'M1' / 'M2' / 'M3' / 'M4' / 'M5'.
        runtime_s: total runtime in seconds (e.g. 8, 10, 15).
        lens_mm: lens length in mm; defaults to the mode's default_lens_mm.
        palette_descriptor: required for M3 and M5 — e.g. 'daylight overcast
            palette' (M3) or 'cold greys, steel blues, muted greens' (M5).
            Falls back to a neutral default when omitted.
        stage_lighting: required for M4 — e.g. 'magenta-red color cast from
            the LED cube above'. Falls back to neutral when omitted.

    Returns:
        Filled spec paragraph ready to append to a Seedance prompt.

    Raises:
        ValueError: if code is unknown.
    """
    mode = get_cinema_mode(code)
    if mode is None:
        raise ValueError(f"Unknown cinema mode: {code!r}. Valid: {list(CINEMA_MODES)}")
    lens = lens_mm if lens_mm is not None else mode.default_lens_mm
    fill = {
        "lens_mm": lens,
        "runtime_s": runtime_s,
        "palette_descriptor": (
            palette_descriptor or "scene-appropriate palette"
        ),
        "stage_lighting": (
            stage_lighting
            or "warm tungsten and cool blue stage wash with directional spots"
        ),
    }
    return mode.spec_template.format(**fill)
