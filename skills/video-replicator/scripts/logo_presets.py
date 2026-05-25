#!/usr/bin/env python3
"""Logo Candy animation preset registry.

Each preset defines:
- direction: "forward" (animation builds logo) or "reverse" (destruction reversed to assembly)
- veo_mode: "i2v" (logo as first frame) or "r2v" (logo as reference asset)
- background: background type for compositing (dark, light, brick, water, neutral, noise, green)
- prompt_template: Veo prompt with {logo_description} placeholder
- best_for: description of ideal use cases
"""


LANDSCAPE_DIMS = (1280, 720)
PORTRAIT_DIMS = (504, 896)

BACKGROUND_COLORS: dict[str, tuple[int, int, int]] = {
    "dark": (10, 10, 10),
    "light": (255, 255, 255),
    "brick": (45, 30, 25),
    "water": (180, 210, 230),
    "neutral": (200, 190, 180),
    "noise": (128, 128, 128),
    "green": (40, 80, 40),
    "ocean": (15, 30, 60),      # Dark ocean blue for night/underwater scenes
    "paper": (250, 245, 235),   # Warm cream for paper/craft aesthetics
    "soil": (35, 25, 20),       # Dark soil for organic/nature presets
    "concrete": (120, 115, 110),# Gray concrete for industrial looks
    "blueprint": (20, 45, 80),  # Cyanotype blue for technical aesthetics
}

# Suffix added to all prompts to preserve logo text integrity
_PRESERVE_TEXT = "IMPORTANT: Every letter of the logo text must remain fully visible, legible, and unobstructed throughout the entire animation."

PRESETS: dict[str, dict] = {
    "liquid-chrome": {
        "direction": "reverse",
        "veo_mode": "i2v",
        "background": "dark",
        "prompt_template": (
            "Liquid metal formations. Molten chrome droplets float in zero gravity "
            "against a dark void. The silver liquid magnetically disperses from the center, "
            "flowing outward as the {logo_description} dissolves into floating chrome droplets. "
            "High contrast studio lighting, glossy reflections, 8k resolution. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Luxury, tech, automotive",
    },
    "particle-assemble": {
        "direction": "reverse",
        "veo_mode": "i2v",
        "background": "dark",
        "prompt_template": (
            "Bioluminescent particle dissolution. The sharp {logo_description} "
            "breaks apart into swirling constellations of glowing blue cybernetic dust "
            "that rush outward to the edges. Volumetric fog, macro detail, cinematic lighting. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Gaming, software, crypto",
    },
    "sketch-to-life": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "light",
        "prompt_template": (
            "Pencil sketch evolution on textured white paper. Invisible hands rapidly "
            "sketch the wireframe of the {logo_description} in graphite. The sketch suddenly "
            "fills with vibrant color and texture, popping into a photorealistic 3D object. "
            "Paper texture visible, stop-motion style. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Design, consulting, engineering",
    },
    "neon-powerup": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "brick",
        "prompt_template": (
            "Neon gas ignition on pitch black scene. The outline of the "
            "{logo_description} flickers with electrical sparks. Suddenly, the logo ignites "
            "in bright neon gas, illuminating a dark brick texture behind it. Flickering light "
            "effects, smoke passing through light beams. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Nightlife, fashion, energy",
    },
    "organic-growth": {
        "direction": "reverse",
        "veo_mode": "i2v",
        "background": "green",
        "prompt_template": (
            "Fast-motion nature decay. The {logo_description} formed of green moss "
            "and blooming flowers begins to wilt and scatter. Petals fly off, vines unravel, "
            "revealing empty space. Natural sunlight, morning dew drops, shallow depth of field. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Eco, wellness, food",
    },
    "ink-drop": {
        "direction": "reverse",
        "veo_mode": "i2v",
        "background": "water",
        "prompt_template": (
            "Ink dispersion in water. The sharp {logo_description} formed of thick "
            "colorful ink dissolves into clear water. The ink clouds swirl elegantly outward "
            "from the defined shape into chaos. Slow motion, high frame rate, fluid dynamics. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Elegant, publishers, NGOs",
    },
    "fabric-weave": {
        "direction": "reverse",
        "veo_mode": "i2v",
        "background": "neutral",
        "prompt_template": (
            "Silk thread unraveling. The embroidered {logo_description} made of "
            "thousands of golden silk threads begins to unravel. Threads loosen, detach, "
            "and float away in mid-air. The threads move around the letters, never covering them. "
            "Macro lens, soft lighting, tactile texture. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Fashion, interior design",
    },
    "glitch-decode": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "noise",
        "prompt_template": (
            "Datamosh glitch reveal. The screen is filled with digital noise and "
            "compression artifacts. A heavy data-moshing wipe effect passes across the screen, "
            "decoding the pixelated noise to reveal the clean {logo_description} underneath. "
            "RGB split, CRT monitor texture. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Security, IT, edgy brands",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # ORGANIC & BIOLUMINESCENT (Nature Tech)
    # Best for: Sustainability, Health, Future-Tech
    # ═══════════════════════════════════════════════════════════════════════════
    "mycelium-network": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "soil",
        "prompt_template": (
            "Macro time-lapse. White fungal mycelium threads rapidly grow and interconnect "
            "across a dark soil texture. The organic network pulsates with bio-electric light, "
            "weaving together to form the solid shape of the {logo_description}. "
            "8k resolution, National Geographic style, highly detailed texture. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Sustainability, biotech, future-tech",
    },
    "coral-reef-bloom": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "water",
        "prompt_template": (
            "Underwater cinematography. Vibrant coral polyps bloom instantly in fast-motion, "
            "growing out from a central point. The colorful coral structures calcify and harden, "
            "taking the precise geometric form of the {logo_description}. "
            "Caustic lighting, floating particles, depth of field. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Ocean conservation, wellness, aquatic brands",
    },
    "crystal-geode-crack": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Geological reveal. A rough, dark rock surface cracks open down the center. "
            "Inside, a glowing amethyst crystal structure is revealed. The camera pushes into "
            "the sparkling crystals, which are arranged in the shape of the {logo_description}. "
            "Internal light refractions, macro lens. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Luxury, jewelry, premium brands",
    },
    "liquid-moss": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "concrete",
        "prompt_template": (
            "Surreal nature. A thick, viscous green liquid flows over a concrete surface. "
            "Wherever the liquid touches, lush moss and tiny flowers instantly bloom. "
            "The vegetation grows within invisible boundaries to reveal the {logo_description}. "
            "Soft overcast lighting, tactile realism. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Eco, wellness, organic food brands",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # TACTILE & MIXED MEDIA (Stop Motion/Craft)
    # Best for: Creative Agencies, Handmade Brands, Education
    # ═══════════════════════════════════════════════════════════════════════════
    "claymation-morph": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "light",
        "prompt_template": (
            "Claymation stop-motion animation. A colorful ball of plasticine clay is squashed "
            "and molded by invisible hands. Fingerprints are visible on the clay surface. "
            "The clay rapidly morphs and reshapes itself into the {logo_description}. "
            "12fps frame rate, studio lighting, playful vibe. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Creative agencies, kids brands, playful",
    },
    "origami-fold": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "paper",
        "prompt_template": (
            "Papercraft unfolding. A flat sheet of textured craft paper folds and unfolds "
            "rapidly in a complex origami sequence. The paper constructs itself into a 3D "
            "relief version of the {logo_description}. "
            "Sharp creases, paper grain texture, soft shadows. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Design studios, stationery, education",
    },
    "embroidery-speedrun": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "neutral",
        "prompt_template": (
            "Macro needlework. An invisible needle rapidly stitches colorful thread into a "
            "denim fabric background. The stitching frenzy accelerates, filling in the design "
            "until the {logo_description} is fully embroidered. "
            "Fuzzy thread texture, tactile close-up. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Fashion, handmade crafts, artisan brands",
    },
    "blueprint-schematic": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "blueprint",
        "prompt_template": (
            "Architectural schematics. Cyanotype blue background. White technical lines draw "
            "themselves rapidly, measuring angles and dimensions. The schematic lines snap into "
            "place, turning into a solid, photorealistic 3D architectural model of the {logo_description}. "
            "Technical aesthetics, engineering precision. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Engineering, architecture, construction",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # EXPERIMENTAL & FLUID (High-End Abstract)
    # Best for: Luxury, AI Startups, Crypto
    # ═══════════════════════════════════════════════════════════════════════════
    "ferrofluid-magnetism": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Black ferrofluid macro. Spiky, magnetic black liquid rises from a flat surface, "
            "pulled upward by an invisible magnetic field. The liquid spikes align and smooth out, "
            "freezing into the glossy, metallic shape of the {logo_description}. "
            "Studio reflection, high contrast. "
            + _PRESERVE_TEXT
        ),
        "best_for": "AI startups, luxury tech, experimental",
    },
    "smoke-collision": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Volumetric smoke simulation. Two streams of heavy colored smoke (Blue and Orange) "
            "collide in slow motion in the center of the frame. The collision creates a shockwave "
            "that solidifies the smoke into the hard edges of the {logo_description}. "
            "Cinematic lighting, turbulence. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Entertainment, sports, energy drinks",
    },
    "molten-gold-pour": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Liquid gold casting. Molten gold is poured into an invisible mold in a dark void. "
            "The glowing hot metal flows and cools rapidly, turning from bright yellow to polished gold, "
            "solidifying into the {logo_description}. "
            "Heat haze, embers, luxury aesthetic. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Luxury, finance, premium jewelry",
    },
    "glass-dispersion": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Refractive glass assembly. Shards of invisible glass fly together from the edges "
            "of the frame. As they lock into place, they refract the background light, creating "
            "a chromatic aberration rainbow effect that defines the {logo_description}. "
            "Clean, prismatic, high-tech. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Optics, tech hardware, premium brands",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # CYBERPUNK & GLITCH (Edgy/Modern)
    # Best for: Gaming, Music, Streetwear
    # ═══════════════════════════════════════════════════════════════════════════
    "crt-power-on": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Retro TV startup. The screen is black. Suddenly, a CRT monitor powers on with "
            "a white flash and static noise. The scanlines stabilize to reveal the {logo_description} "
            "glowing in low-resolution phosphor green. "
            "VCR tracking artifacts, analog horror vibe. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Gaming, retro brands, horror",
    },
    "data-mosh-wipe": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "noise",
        "prompt_template": (
            "Datamosh transition. The screen is filled with colorful digital compression artifacts "
            "and pixel sorting. A wave of pixels washes over the frame, 'healing' the glitch to reveal "
            "the pristine, sharp {logo_description} underneath. "
            "Digital distortion, RGB split. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Music labels, streetwear, digital art",
    },
    "laser-scan": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Lidar scanning effect. A dark void. A bright red laser grid scans across the darkness, "
            "mapping out 3D topography. The laser points accumulate, building a wireframe point-cloud "
            "that increases in density until it forms the {logo_description}. "
            "Cybernetic interface. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Automotive, robotics, security tech",
    },
    "chrome-melting": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Y2K aesthetic. A metallic chrome sphere floats in the center. It creates a liquid "
            "mercury ripple effect, melting and warping. The metal creates a splash that freezes "
            "mid-air, forming the {logo_description}. "
            "Fisheye lens, futuristic studio. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Y2K revival, fashion, experimental",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # CINEMATIC & EPIC (Film/Corporate)
    # Best for: Production Houses, Real Estate, Finance
    # ═══════════════════════════════════════════════════════════════════════════
    "eclipse-reveal": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Cinematic eclipse. A bright light source is blocked by a dark object, creating a "
            "'diamond ring' lens flare effect. As the light moves, the shadow recedes to reveal "
            "the massive stone texture of the {logo_description} backlit by the sun. "
            "Epic scale, god rays. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Film production, real estate, corporate",
    },
    "drone-flyover": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "ocean",
        "prompt_template": (
            "Aerial cinematography. Fast drone shot flying over a dark ocean at night. "
            "Bioluminescent waves crash against a massive rock formation rising from the water. "
            "The rock formation is shaped exactly like the {logo_description}. "
            "Moonlight, misty atmosphere. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Travel, luxury resorts, adventure brands",
    },
    "marble-carving": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "light",
        "prompt_template": (
            "Classical sculpture reveal. Fast time-lapse. A block of raw white marble is chipped "
            "away by invisible chisels. Dust flies and stone falls away, revealing the polished, "
            "smooth surface of the {logo_description} inside. "
            "Museum lighting, classical art style. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Art galleries, luxury, heritage brands",
    },
    "dust-explosion": {
        "direction": "forward",
        "veo_mode": "r2v",
        "background": "dark",
        "prompt_template": (
            "Slow motion impact. A pile of colored powder sits on a black surface. An invisible "
            "impact hits it, sending the powder exploding outward in a shockwave. In the center "
            "of the dust cloud, the negative space creates the perfect silhouette of the {logo_description}. "
            "High speed camera. "
            + _PRESERVE_TEXT
        ),
        "best_for": "Sports, festivals, energy brands",
    },
    "custom": {
        "direction": "forward",
        "veo_mode": "i2v",
        "background": "dark",
        "prompt_template": "",
        "best_for": "Any (user provides custom prompt)",
    },
}


def get_preset(name: str) -> dict | None:
    return PRESETS.get(name)


def get_background_color(bg_type: str) -> tuple[int, int, int]:
    return BACKGROUND_COLORS.get(bg_type, BACKGROUND_COLORS["dark"])


def get_prompt_template(preset_name: str, logo_description: str) -> str:
    preset = PRESETS.get(preset_name)
    if not preset or not preset["prompt_template"]:
        return ""
    return preset["prompt_template"].format(logo_description=logo_description)


def get_target_dims(ratio: str) -> tuple[int, int]:
    if ratio == "portrait":
        return PORTRAIT_DIMS
    return LANDSCAPE_DIMS
