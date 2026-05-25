#!/usr/bin/env python3
"""
Seedance Prompt Library — SQLite-backed prompt database with search.

Stores production-quality Seedance prompts from ByteDance's official docs,
plus extracted camera vocabulary, audio cues, and color palettes. Provides
genre-based search, keyword matching, and template-based prompt expansion.

Usage:
    from seedance_prompt_db import PromptDB

    db = PromptDB()  # auto-creates/populates DB on first use

    # Search by genre
    fight_prompts = db.search(genre="fight")

    # Search by keyword
    results = db.search(keyword="sword")

    # Get camera phrases for a genre
    cameras = db.get_camera_phrases(genre="fight")

    # Expand a simple description using matching templates
    expanded = db.expand_prompt(
        description="Two warriors clash in temple",
        genre="fight",
        duration=15,
    )

CLI:
    python seedance_prompt_db.py stats           # DB statistics
    python seedance_prompt_db.py search fight     # Search by genre
    python seedance_prompt_db.py search --keyword sword  # Search by keyword
    python seedance_prompt_db.py cameras fight    # Camera phrases for genre
    python seedance_prompt_db.py expand "warriors clash" --genre fight --duration 15
    python seedance_prompt_db.py rebuild          # Force rebuild from CSVs
"""

from __future__ import annotations

import csv
import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# ============================================================================
# Constants
# ============================================================================

DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "seedance_prompts.db"
LARK_CSV = DATA_DIR / "lark_seedance_prompts.csv"
XSKILL_CSV = DATA_DIR / "xskill_skills.csv"

# Genre mappings from CSV categories to searchable genre keys
CATEGORY_TO_GENRES: dict[str, list[str]] = {
    "AI comic drama": ["xianxia", "fantasy", "fight", "magic", "epic"],
    "Real life short drama": ["drama", "emotional", "romance", "comedy"],
    "Cool mirror": ["vfx", "transition", "mirror", "special_effects"],
    "real fight": ["fight", "action", "combat", "martial_arts"],
    "dance imitation": ["dance", "motion_transfer", "kpop"],
    "E-commerce/Advertising": ["ecommerce", "commercial", "product", "food", "fashion"],
    "Popular science teaching": ["popscience", "medical", "educational", "science"],
    "AI MV": ["kpop", "music_video", "mv"],
    "AI Vlog": ["vlog", "lifestyle"],
    "Video continuation": ["continuation", "extend"],
    "P video": ["parody", "creative"],
}

# Keywords that map to genres for auto-detection
GENRE_KEYWORDS: dict[str, list[str]] = {
    "fight": [
        "fight", "battle", "combat", "warrior", "sword", "punch", "kick",
        "clash", "duel", "strike", "attack", "defend", "dodge", "martial",
        "fist", "blade", "weapon", "explosion", "shatter", "destroy",
        "samurai", "katana", "boxing", "wrestling", "karate", "kung fu",
        "gladiator", "arena", "spar", "bout",
        "showdown", "face off", "standoff", "unsheathes", "unsheathe",
    ],
    "xianxia": [
        "xianxia", "cultivation", "immortal", "fairy", "magic circle",
        "energy", "rune", "spell", "qi", "cultivation", "jade",
        "mystical", "divine", "demon", "spirit", "celestial",
        "dao", "sect", "cultivator", "heavenly", "tribulation",
    ],
    "ecommerce": [
        "product", "brand", "commercial", "advertisement", "marketing",
        "showcase", "unbox", "promotional", "retail",
        "shopping", "package", "bottle", "shoe", "handbag", "phone",
        "luxury", "watch", "jewelry", "marble surface",
        "cosmetic", "perfume", "sneaker", "headphone", "gadget", "premium",
        "pricing", "store", "packaging",
    ],
    "food": [
        "food", "cooking", "recipe", "kitchen", "chef", "ingredient",
        "meal", "dish", "restaurant", "tea", "coffee", "juice", "drink",
        "burger", "pizza", "dessert", "fruit", "vegetable",
        "ramen", "noodle", "chopstick", "sushi", "steak", "soup",
        "sizzling", "steaming", "plating", "appetizing", "delicious",
        "chocolate", "cake", "pastry", "bread", "sauce", "cream",
        "chicken", "fried", "grilled", "baked", "roasted", "honey",
        "seafood", "lobster", "shrimp", "taco", "burrito", "curry",
        "ice cream", "waffle", "pancake", "syrup", "dipping",
        "crunchy", "crispy", "juicy", "melting", "drizzle",
    ],
    "drama": [
        "emotional", "tears", "cry", "love", "heartbreak", "relationship",
        "family", "argument", "confrontation", "confession", "betrayal",
        "forgive", "romance", "kiss",
        "embrace", "lovers", "farewell", "reunion", "longing", "sorrow",
        "sadness", "determination", "reflecting", "reflects", "peace",
        "peaceful", "solitude", "contemplat", "memories", "nostalgia",
        "grief", "hope", "resilience", "warrior",
    ],
    "popscience": [
        "science", "medical", "health", "brain", "cell", "blood",
        "anatomy", "microscopic", "organ", "heart", "neuron", "CGI",
        "educational", "explain",
        "DNA", "molecule", "atom", "neural", "pupil", "retina",
        "virus", "bacteria", "genome", "protein", "synapse",
    ],
    "kpop": [
        "choreography", "stage", "performance", "idol", "group",
        "beat", "rhythm", "MV", "music video", "concert",
        "hip hop", "breakdance", "street dance",
        "dance", "k-pop", "kpop", "dancer", "dancing",
        "formation", "crew", "routine",
    ],
    "fantasy": [
        "magic", "dragon", "wizard", "spell", "enchanted", "mythical",
        "fairy tale", "sorcerer", "transformation", "supernatural",
        "elemental", "fire", "ice",
        "phoenix", "griffin", "wings", "creature", "realm", "throne",
        "warrior", "quest", "enchant", "conjure",
    ],
    "action": [
        "chase", "explosion", "run", "jump", "fast", "speed", "crash",
        "car", "motorcycle", "stunt", "parkour", "escape", "danger",
        "villain", "flames", "burning", "hero", "pursuit", "ambush",
    ],
    "bollywood": [
        "bollywood", "indian", "desi", "mehendi", "henna", "lehenga",
        "saree", "sari", "diwali", "holi", "sangeet", "baraat",
        "dhol", "tabla", "kathak", "bharatanatyam", "garba",
        "namaste", "rangoli", "mahal", "haveli", "palace",
        "romantic rain", "train station farewell",
        "dupatta", "ghagra", "kurta", "sherwani", "bindi",
        "mandap", "wedding", "mehndi", "tilak",
    ],
    "horror": [
        "horror", "scary", "shadow", "creepy", "haunted",
        "ghost", "nightmare", "terror", "suspense", "thriller",
        "darkness", "sinister", "dread", "eerie", "ominous",
        "creaking", "foggy", "abandoned", "crumbling", "decay",
    ],
    "vfx": [
        "effect", "transition", "transform", "morph", "particle",
        "dissolve", "reveal", "appear", "vanish", "special effect",
    ],
    "nature": [
        # Wildlife
        "whale", "dolphin", "eagle", "wolf", "bear", "lion", "deer",
        "fox", "bird", "wildlife", "nature", "breaching", "migration",
        "habitat", "predator", "prey", "herd", "flock", "nest",
        "jellyfish", "coral", "reef", "octopus", "shark",
        "humpback", "cheetah", "gorilla", "elephant", "penguin",
        "butterfly", "insect", "spider", "snake", "crocodile",
        # Habitats / biomes
        "savanna", "arctic", "glacier", "rainforest", "wetland",
        "tundra", "meadow", "prairie", "marshland", "mangrove",
        # Landscape elements — compound keywords preferred over standalone
        # to avoid stealing detection from underwater genre (e.g. "jellyfish
        # in deep ocean" should stay underwater, not nature).
        "waves", "coastline", "seashore", "tidal",
        "mountain", "summit", "ridge", "alpine",
        "desert", "dunes", "arid",
        "forest", "woodland", "canopy", "redwood", "old-growth",
        "waterfall", "cascade", "rapids",
        "volcano", "lava", "volcanic", "eruption",
        "thunderstorm", "lightning strike",
        "northern lights", "aurora borealis",
        "tide pool", "rocky shore",
        "snow-capped", "mountain peak", "mountain range",
        "crashing waves", "breaking waves",
        "sand dune", "sand dunes",
    ],
    "documentary": [
        "documentary", "narrator", "investigation", "archive",
        "civilization", "expedition", "exploration", "expedition",
        "historical", "ancient ruins", "discovery", "unearthed",
        "civilization", "tribe", "indigenous", "anthropology",
        "archaeological", "footage", "chronicle", "testimony",
    ],
    "sci_fi": [
        "spaceship", "spacecraft", "cyberpunk", "futuristic", "android",
        "robot", "hologram", "neon city", "dystopian", "dystopia",
        "space station", "laser", "warp", "hyperspace", "alien",
        "mech", "mecha", "cyborg", "matrix", "virtual reality",
        "portal", "dimension", "starship", "asteroid", "nebula",
        "planet", "colonize", "terraforming", "zero gravity", "cryo",
    ],
    "cinematic": [
        "landscape", "sunset", "sunrise", "mountain", "ocean", "sky",
        "aerial", "drone", "panorama", "vista", "horizon", "valley",
        "galaxy", "milky way", "timelapse", "time-lapse", "starry",
        "waterfall", "cliff", "canyon", "forest", "wilderness",
        "volcanic", "eruption", "aurora", "borealis",
        "desert", "jungle", "temple", "ruins",
    ],
    "sports": [
        "soccer", "football", "basketball", "tennis", "baseball",
        "cricket", "golf", "swimming pool", "surfing",
        "skiing", "snowboard", "skateboard", "cycling", "marathon",
        "sprinter", "hurdle", "relay race", "athlete", "stadium",
        "slam dunk", "touchdown", "home run", "wicket",
        "boxing ring", "gymnasium", "court", "pitch",
        "olympic", "medal", "championship", "trophy", "coach",
        "referee", "scoreboard", "spectator",
        "racing", "motorsport", "formula one", "grand prix",
    ],
    "anime": [
        "anime", "manga", "otaku", "chibi", "kawaii",
        "shonen", "shojo", "mecha", "isekai", "seinen",
        "sakura", "cherry blossom", "school uniform", "bento",
        "katana slash", "power up", "aura", "transformation",
        "sensei", "senpai", "samurai anime", "ninja anime",
        "energy beam", "spirit animal", "onsen", "torii gate",
        "cel shaded", "2D animation", "hand drawn", "keyframe",
    ],
    "romance": [
        "romance", "romantic", "love story", "first kiss",
        "embrace", "heartbreak", "proposal", "soulmate",
        "candlelight", "date night", "slow dance", "holding hands",
        "valentine", "rose petals", "sunset walk", "stargazing",
        "love letter", "confession", "longing", "reunion",
        "farewell", "tenderness", "couple", "lovers",
        "honeymoon", "anniversary", "prom", "first date",
        "balcony scene", "park bench",
    ],
    "thriller": [
        "thriller", "suspense", "suspenseful", "tension",
        "mystery", "detective", "investigation", "crime scene",
        "hostage", "kidnapping", "stalker", "surveillance",
        "conspiracy", "double cross", "betrayal", "deception",
        "countdown", "ticking clock", "time bomb", "ransom",
        "interrogation", "witness", "fugitive", "manhunt",
        "heist", "vault", "infiltration", "undercover",
        "noir", "shadowy figure", "alleyway", "getaway",
        "evidence", "fingerprint", "clue",
    ],
    "comedy": [
        "comedy", "comedic", "funny", "humor", "humorous",
        "slapstick", "prank", "blooper", "pratfall", "gag",
        "sitcom", "stand-up", "punchline", "joke", "laughing",
        "clumsy", "awkward", "absurd", "parody", "satire",
        "pie in the face", "double take", "facepalm", "overreaction",
        "exaggerated", "wacky", "silly", "goofy", "ridiculous",
    ],
    "war": [
        "war", "warfare", "battle", "battlefield", "warzone",
        "soldier", "soldiers", "military", "army", "navy",
        "marines", "air force", "special forces", "commando",
        "infantry", "cavalry", "artillery", "tank", "tanks",
        "trench", "trenches", "bunker", "foxhole", "barricade",
        "patrol", "ambush", "airstrike", "bombing", "shelling",
        "mortar", "grenade", "helicopter", "gunship",
        "medic", "evacuation", "platoon", "regiment",
        "d-day", "normandy", "frontline", "ceasefire",
    ],
    "historical": [
        "historical", "medieval", "ancient", "renaissance",
        "victorian", "colonial", "dynasty", "empire", "emperor",
        "pharaoh", "pyramid", "gladiator", "colosseum", "roman",
        "greek", "spartan", "viking", "crusade", "crusader",
        "castle", "throne", "crown", "coronation", "court",
        "feudal", "peasant", "noble", "knight", "kingdom",
        "sultan", "ottoman", "mongol", "genghis", "samurai",
        "shogun", "plague", "revolution", "guillotine",
        "chariot", "scroll", "ancient temple", "ruins",
    ],
    "western": [
        "western", "cowboy", "cowboys", "gunslinger", "outlaw",
        "sheriff", "deputy", "marshal", "bounty hunter",
        "saloon", "frontier", "prairie", "canyon", "desert town",
        "horseback", "stagecoach", "wagon train", "lasso",
        "revolver", "holster", "quickdraw", "showdown",
        "tumbleweeds", "dusty trail", "gold rush", "prospector",
        "ranch", "rancher", "cattle", "stampede", "rodeo",
        "wanted poster", "bandit", "tombstone",
    ],
    "cyberpunk": [
        "cyberpunk", "neon city", "neon-lit", "dystopian", "dystopia",
        "cyborg", "augmented", "implant", "neural", "hack",
        "hacker", "hacking", "hologram", "holographic",
        "megacity", "megacorp", "corporate tower", "rain-soaked neon",
        "android", "synthetic", "replicant", "blade runner",
        "neon signs", "cyber", "cybernetic", "wired",
        "data stream", "virtual reality", "matrix",
        "techno noir", "chrome", "punk", "underground market",
    ],
    "music_video": [
        "music video", "performance", "concert", "performer",
        "stage", "spotlight", "microphone", "vocalist", "singer",
        "band", "guitarist", "drummer", "bass player",
        "choreography", "choreographed", "backup dancers",
        "music scene", "recording studio", "headphones",
        "vinyl", "turntable", "disc jockey",
        "crowd surfing", "mosh pit", "festival",
        "lyric", "verse", "chorus", "melody",
        "rock star", "pop star", "hip hop", "rapper",
    ],
    "superhero": [
        "superhero", "superheroine", "hero landing", "cape",
        "superpowers", "superpower", "flying hero", "levitating",
        "villain", "nemesis", "arch enemy", "evil lair",
        "laser eyes", "heat vision", "super strength",
        "shield throw", "infinity", "gauntlet",
        "origin story", "secret identity", "masked hero",
        "saving the city", "rescue mission",
        "comic book", "graphic novel",
        "power beam", "force field", "telekinesis", "telepathy",
        "invincible", "indestructible", "bulletproof",
    ],
    "noir": [
        "noir", "film noir", "neo noir", "detective", "private eye",
        "femme fatale", "hard-boiled", "gumshoe", "trench coat",
        "cigarette smoke", "venetian blinds", "shadow stripes",
        "rain-slicked", "neon sign", "back alley", "dimly lit",
        "smoky bar", "whiskey glass", "fedora", "revolver",
        "double cross", "double-cross", "betrayal",
        "crime scene", "murder mystery", "whodunit",
        "monochrome", "black and white", "chiaroscuro",
        "seedy motel", "investigator", "informant", "undercover",
    ],
    "underwater": [
        "underwater", "deep sea", "ocean floor", "submarine",
        "coral reef", "coral", "abyss", "abyssal",
        "mermaid", "merman", "aquatic", "submerged",
        "scuba", "diver", "diving", "snorkeling",
        "jellyfish", "squid", "octopus", "whale",
        "shark", "dolphin", "sea turtle", "stingray",
        "bioluminescent", "bioluminescence", "glowing plankton",
        "shipwreck", "sunken", "trench", "mariana",
        "kelp forest", "seaweed", "tide pool", "seahorse",
        "hydrothermal vent", "nautical",
    ],
    "fairy_tale": [
        "fairy tale", "fairytale", "once upon a time",
        "enchanted", "enchantment", "magical forest",
        "princess", "prince", "wicked witch", "evil queen",
        "dragon", "unicorn", "pixie", "faerie",
        "glass slipper", "magic mirror", "spell",
        "cursed", "curse", "enchanted forest",
        "talking animal", "gingerbread", "storybook",
        "happily ever after", "fairy godmother", "wand",
        "castle tower", "thorns", "beanstalk", "golden egg",
        "woodcutter", "cottage", "cobblestone path",
    ],
    "dance": [
        "dance", "dancing", "dancer", "ballet", "ballerina",
        "hip-hop dance", "breakdance", "breaking", "b-boy",
        "contemporary dance", "modern dance", "jazz dance",
        "salsa", "tango", "waltz", "flamenco",
        "ballroom", "pirouette", "leap", "arabesque",
        "choreograph", "routine", "dance floor",
        "pointe shoes", "tutu", "dance studio",
        "freestyle", "dance battle", "dance crew",
        "body wave", "popping", "locking",
    ],
    "travel": [
        "travel", "traveler", "journey", "exploration",
        "destination", "landmark", "tourist", "tourism",
        "backpacker", "passport", "airport", "departure",
        "hotel lobby", "resort", "hostel",
        "drone shot", "panoramic vista",
        "tropical island", "beach resort",
        "temple visit", "local marketplace",
        "road trip", "scenic route", "wanderlust",
        "adventure travel", "cultural immersion",
        "street food tour", "local cuisine", "bazaar",
        "mountain trek", "coastal drive", "sunset viewpoint",
    ],
    "fashion": [
        "fashion", "runway", "catwalk", "haute couture",
        "fashion show", "couture", "designer gown",
        "supermodel", "editorial shoot",
        "vogue", "glamour", "glamorous",
        "outfit", "ensemble", "garment",
        "fabric draping", "silk gown", "velvet dress", "lace detail",
        "stiletto", "clutch bag",
        "fashion week", "backstage fashion", "fitting room",
        "look book", "collection", "avant-garde fashion",
        "high fashion", "street style",
    ],
}

# Camera phrase patterns to extract from prompt text
CAMERA_PATTERNS: list[tuple[str, str]] = [
    (r"low[- ]angle\b", "low_angle"),
    (r"high[- ]angle\b", "high_angle"),
    (r"close[- ]?up\b", "closeup"),
    (r"extreme close[- ]?up\b", "extreme_closeup"),
    (r"medium shot\b", "medium"),
    (r"wide shot\b", "wide"),
    (r"long shot\b", "wide"),
    (r"establishing shot\b", "establishing"),
    (r"bird'?s?[- ]eye\b", "birds_eye"),
    (r"top[- ]down\b", "birds_eye"),
    (r"dutch angle\b", "dutch_angle"),
    (r"panning camera\b", "pan"),
    (r"pan(?:s|ning)?\s+(?:to|left|right)\b", "pan"),
    (r"tracking (?:shot|camera|left|right)\b", "tracking"),
    (r"hitchcock[- ]zoom\b", "hitchcock_zoom"),
    (r"dolly[- ]zoom\b", "hitchcock_zoom"),
    (r"vertigo[- ]zoom\b", "hitchcock_zoom"),
    (r"dolly (?:in|forward|backward|zoom)\b", "dolly"),
    (r"crane (?:up|down|shot)\b", "crane"),
    (r"orbit(?:s|ing)?\b", "orbit"),
    (r"zoom(?:s|ing)?\s+(?:in|out)\b", "zoom"),
    (r"slow[- ]?mo(?:tion)?\b", "slow_motion"),
    (r"freeze\s+frame\b", "freeze_frame"),
    (r"whip pan\b", "whip_pan"),
    (r"rack focus\b", "rack_focus"),
    (r"pull(?:s|ing)?\s+back\b", "pull_back"),
    (r"push(?:es|ing)?\s+(?:in|forward)\b", "push_in"),
    (r"tilt(?:s|ing)?\s+(?:up|down)\b", "tilt"),
    (r"upward shot\b", "low_angle"),
    (r"camera (?:slowly |quickly )?(?:advances|moves forward|pushes)\b", "push_in"),
    (r"camera (?:slowly |quickly )?(?:retreats|pulls back|moves back)\b", "pull_back"),
    (r"camera (?:slowly |quickly )?(?:rises|ascends|cranes up)\b", "crane_up"),
    (r"camera (?:slowly |quickly )?(?:descends|lowers|cranes down)\b", "crane_down"),
    (r"camera (?:circles|arcs|orbits)\b", "orbit"),
    (r"quick cut\b", "quick_cut"),
    (r"hard cut\b", "hard_cut"),
    (r"fade\s+(?:in|out|to)\b", "fade"),
    (r"fisheye\s+lens\b", "fisheye"),
    (r"first[- ]person\b", "first_person"),
    (r"steadicam\b", "steadicam"),
    (r"handheld\b", "handheld"),
]


def classify_camera_move(text: str) -> str | None:
    """Return the first camera label that matches *text*, or None.

    Patterns are tested in list order, so more-specific entries
    (e.g. ``dolly zoom``) must appear before catch-alls (e.g. ``dolly``)
    in CAMERA_PATTERNS.
    """
    text_lower = text.lower()
    for pattern, label in CAMERA_PATTERNS:
        if re.search(pattern, text_lower):
            return label
    return None


# Audio cue patterns
AUDIO_PATTERNS: list[tuple[str, str]] = [
    (r"sound (?:of|effect)\s+(.+?)(?:[,;.]|\band\b)", "sfx"),
    (r"accompanied by\s+(?:the\s+)?(.+?)(?:[,;.]|\band\b)", "sfx"),
    (r"(?:background |brisk |soft |tense |exciting )(?:music|sound|audio)\b", "music"),
    (r"(?:piano|drum|guitar|violin|string|percussion|synthesizer|bass|flute)\b", "music"),
    (r"(?:electronic|orchestral|folk|jazz|rock|pop|classical|ambient)\s+(?:music|rhythm|beat)\b", "music"),
    (r"(?:roar|crash|boom|bang|crack|shatter|explod|rumbl)\w*\b", "sfx"),
    (r"(?:whisper|murmur|shout|scream|roar|groan)\w*\b", "voice"),
    (r"(?:footstep|breathing|heartbeat|wind|rain|thunder)\b", "ambient"),
    (r"sound\s+(?:fades?|dissipate|end)\b", "sfx"),
]

# Color/tone patterns
COLOR_PATTERNS: list[tuple[str, str]] = [
    (r"(?:red|golden|warm|orange|amber)\s+(?:tone|light|glow|hue)\b", "warm"),
    (r"(?:blue|cold|cool|icy|silver|frost)\s+(?:tone|light|glow|hue)\b", "cold"),
    (r"(?:purple|violet|magenta|indigo)\s+(?:tone|light|glow|hue)\b", "mystical"),
    (r"(?:green|emerald|jade|lime)\s+(?:tone|light|glow|hue)\b", "natural"),
    (r"(?:dark|noir|shadow|black)\s+(?:tone|atmosphere|mood)\b", "dark"),
    (r"(?:bright|vivid|neon|saturated|high[- ]saturation)\b", "vivid"),
    (r"(?:pastel|soft|muted|desaturated)\b", "soft"),
    (r"warm\s+(?:and|&)\s+cold\s+(?:contrast|tone)\b", "contrast"),
    (r"(?:red and gold|golden red)\b", "warm"),
    (r"(?:purple and black|dark purple)\b", "dark_mystical"),
]


# ============================================================================
# Data Classes
# ============================================================================

@dataclass
class PromptRecord:
    """A single prompt record from the database."""
    id: int
    category: str
    subcategory: str
    prompt_text: str
    source_url: str
    duration: int
    genres: list[str] = field(default_factory=list)
    camera_techniques: list[str] = field(default_factory=list)
    audio_cues: list[str] = field(default_factory=list)
    color_palettes: list[str] = field(default_factory=list)
    has_time_segments: bool = False
    has_dialogue: bool = False
    quality_score: float | None = None
    generation_count: int = 0
    success_count: int = 0
    content_filter_count: int = 0
    last_used: str | None = None
    feedback_notes: str = ''


@dataclass
class ExpandedPrompt:
    """Result of expanding a simple description using templates."""
    original: str
    expanded: str
    genre: str
    duration: int
    template_id: int | None = None
    camera_suggestions: list[str] = field(default_factory=list)
    audio_suggestions: list[str] = field(default_factory=list)
    color_suggestions: list[str] = field(default_factory=list)
    negative_prompt: str = ""


# Genre-aware negative prompts — each genre has visual artifacts and
# aesthetic traps that should be explicitly excluded.  The base negative
# is always included; genre-specific additions target common failure modes.
_BASE_NEGATIVE = "text, watermark, logo, UI overlay, subtitle, blurry, distorted face, extra limbs, deformed hands"

_GENRE_NEGATIVES: dict[str, str] = {
    "fight": "still pose, peaceful, calm, smiling, relaxed body language",
    "xianxia": "modern clothing, cars, phones, western architecture",
    "ecommerce": "cluttered background, harsh shadows, unflattering angle, dirty surface",
    "food": "unappetizing, overcooked, messy plating, cold lighting, dull colors",
    "drama": "melodramatic, soap opera lighting, overacted expressions",
    "horror": "bright cheerful lighting, colorful, happy expressions, cartoon",
    "nature": "urban elements, buildings, roads, power lines, humans, trash",
    "documentary": "staged, posed, artificial lighting, dramatic color grading",
    "sci_fi": "medieval, rustic, organic textures only, low-tech",
    "sports": "slow, static, low energy, poor form, amateur technique",
    "anime": "photorealistic, live action, western comic style, 3D render",
    "romance": "harsh lighting, aggressive poses, cold colors, clinical setting",
    "thriller": "warm cozy lighting, cheerful, relaxed atmosphere, bright colors",
    "comedy": "dark, morbid, grim, desaturated, horror-style lighting",
    "war": "clean, pristine, peaceful, well-groomed, spotless uniforms",
    "historical": "modern anachronisms, digital screens, contemporary clothing",
    "western": "modern city, neon lights, high-tech, green lush vegetation",
    "cyberpunk": "natural pastoral, rustic countryside, warm earth tones only",
    "noir": "bright colorful, vivid saturated, cheerful atmosphere, daylight",
    "bollywood": "muted colors, static camera, western minimal aesthetic",
    "fashion": "casual frumpy clothing, harsh unflattering light, messy background",
    "dance": "stiff rigid movement, poor posture, off-beat timing",
    "underwater": "dry land, above water, sandy desert, urban setting",
    "fairy_tale": "gritty realistic, industrial, modern urban, horror elements",
    "superhero": "mundane, ordinary, powerless, slow, weak",
    "travel": "indoor, studio, same location, static, urban decay",
    "music_video": "static, no rhythm, out of sync, poor lip sync, amateur",
    "kpop": "static pose, out of sync, poor choreography, dull lighting",
    "fantasy": "modern technology, cars, phones, realistic urban setting",
    "vfx": "low quality render, obvious CG, green screen visible",
}


# ============================================================================
# PromptDB Class
# ============================================================================

class PromptDB:
    """SQLite-backed Seedance prompt library with search and expansion."""

    def __init__(self, db_path: Path | str | None = None, auto_populate: bool = True):
        self.db_path = Path(db_path) if db_path else DB_PATH
        self._conn: sqlite3.Connection | None = None
        if auto_populate:
            self._ensure_db()

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self.db_path))
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    # ------------------------------------------------------------------
    # Schema & Population
    # ------------------------------------------------------------------

    def _ensure_db(self):
        """Create and populate DB if it doesn't exist or is empty."""
        needs_populate = True
        if self.db_path.exists():
            # Check if populated
            try:
                count = self.conn.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
                if count > 0:
                    needs_populate = False
            except sqlite3.OperationalError:
                pass  # Table doesn't exist, create it

        if needs_populate:
            self._create_schema()
            self._populate_from_csv()

        # Feedback tracking columns (safe migration — ALTER TABLE ADD COLUMN is idempotent-ish)
        self._migrate_feedback_columns()

    def _migrate_feedback_columns(self):
        """Add feedback tracking columns if they don't already exist."""
        feedback_columns = [
            ("quality_score", "REAL DEFAULT NULL"),
            ("generation_count", "INTEGER DEFAULT 0"),
            ("success_count", "INTEGER DEFAULT 0"),
            ("content_filter_count", "INTEGER DEFAULT 0"),
            ("last_used", "TEXT DEFAULT NULL"),
            ("feedback_notes", "TEXT DEFAULT ''"),
        ]
        for col_name, col_def in feedback_columns:
            try:
                self.conn.execute(f"ALTER TABLE prompts ADD COLUMN {col_name} {col_def}")
            except Exception:
                pass  # Column already exists
        self.conn.commit()

    def _create_schema(self):
        """Create database tables."""
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                subcategory TEXT DEFAULT '',
                prompt_text TEXT NOT NULL,
                source_url TEXT DEFAULT '',
                duration INTEGER DEFAULT 15,
                has_time_segments BOOLEAN DEFAULT 0,
                has_dialogue BOOLEAN DEFAULT 0,
                camera_techniques TEXT DEFAULT '[]',
                audio_cues TEXT DEFAULT '[]',
                color_palettes TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS genre_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id INTEGER NOT NULL,
                genre TEXT NOT NULL,
                relevance REAL DEFAULT 1.0,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id)
            );

            CREATE TABLE IF NOT EXISTS camera_phrases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phrase TEXT NOT NULL,
                category TEXT DEFAULT 'movement',
                source_prompt_id INTEGER,
                FOREIGN KEY (source_prompt_id) REFERENCES prompts(id)
            );

            CREATE TABLE IF NOT EXISTS audio_phrases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phrase TEXT NOT NULL,
                category TEXT DEFAULT 'sfx',
                source_prompt_id INTEGER,
                FOREIGN KEY (source_prompt_id) REFERENCES prompts(id)
            );

            CREATE TABLE IF NOT EXISTS xskill_skills (
                id INTEGER PRIMARY KEY,
                skill_id TEXT,
                name TEXT,
                description TEXT,
                category TEXT,
                tags TEXT DEFAULT '[]'
            );

            CREATE INDEX IF NOT EXISTS idx_genre_tags_genre ON genre_tags(genre);
            CREATE INDEX IF NOT EXISTS idx_genre_tags_prompt ON genre_tags(prompt_id);
            CREATE INDEX IF NOT EXISTS idx_camera_category ON camera_phrases(category);
            CREATE INDEX IF NOT EXISTS idx_audio_category ON audio_phrases(category);
        """)
        self.conn.commit()

    def add_prompt(
        self,
        category: str,
        subcategory: str,
        prompt_text: str,
        genres: list[str],
        *,
        source_url: str = "",
        duration: int = 15,
    ) -> int:
        """Insert a single prompt with genre tags.

        Args:
            category: Top-level category (e.g. "Cinematic Scene Templates").
            subcategory: Sub-category (e.g. "Heavy Object Physics").
            prompt_text: The full prompt template text.
            genres: List of genre keys to tag (e.g. ["cinematic", "action"]).
            source_url: Optional source URL.
            duration: Default duration in seconds.

        Returns:
            The row id of the inserted prompt.
        """
        cameras = self._extract_cameras(prompt_text)
        audio = self._extract_audio(prompt_text)
        colors = self._extract_colors(prompt_text)
        has_time = bool(re.search(r"\d+-\d+\s*(?:s|seconds?)\b", prompt_text, re.IGNORECASE))
        has_dialogue = bool(re.search(r'[""\u201c\u201d]', prompt_text))

        cursor = self.conn.execute(
            """INSERT INTO prompts
               (category, subcategory, prompt_text, source_url,
                duration, has_time_segments, has_dialogue,
                camera_techniques, audio_cues, color_palettes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                category, subcategory, prompt_text, source_url,
                duration, has_time, has_dialogue,
                json.dumps(cameras), json.dumps(audio), json.dumps(colors),
            ),
        )
        prompt_id = cursor.lastrowid

        for genre in genres:
            self.conn.execute(
                "INSERT INTO genre_tags (prompt_id, genre, relevance) VALUES (?, ?, ?)",
                (prompt_id, genre, 1.0),
            )

        for cam in cameras:
            self.conn.execute(
                "INSERT INTO camera_phrases (phrase, category, source_prompt_id) VALUES (?, ?, ?)",
                (cam, "extracted", prompt_id),
            )

        for aud in audio:
            self.conn.execute(
                "INSERT INTO audio_phrases (phrase, category, source_prompt_id) VALUES (?, ?, ?)",
                (aud, "extracted", prompt_id),
            )

        return prompt_id

    def _populate_from_csv(self):
        """Parse CSV files and populate the database."""
        # Populate prompts from Lark CSV
        if LARK_CSV.exists():
            self._populate_lark_prompts()

        # Populate xskill skills
        if XSKILL_CSV.exists():
            self._populate_xskill_skills()

        # Populate built-in cinematic scene templates
        self._populate_cinematic_templates()

        self.conn.commit()

    def _populate_lark_prompts(self):
        """Parse lark_seedance_prompts.csv and insert into DB."""
        with open(LARK_CSV, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                prompt_text = row.get("prompt_text", "").strip()
                if not prompt_text or len(prompt_text) < 20:
                    continue  # Skip empty or too-short prompts

                category = row.get("section_h1", "").strip()
                subcategory = row.get("section_h2", "").strip()
                source_url = row.get("source_url", "").strip()

                # Extract metadata from prompt text
                has_time = bool(re.search(r"\d+-\d+\s*(?:s|seconds?)\b", prompt_text, re.IGNORECASE))
                has_dialogue = bool(re.search(r'[""\u201c\u201d]', prompt_text))
                cameras = self._extract_cameras(prompt_text)
                audio = self._extract_audio(prompt_text)
                colors = self._extract_colors(prompt_text)

                # Insert prompt
                cursor = self.conn.execute(
                    """INSERT INTO prompts
                       (category, subcategory, prompt_text, source_url,
                        duration, has_time_segments, has_dialogue,
                        camera_techniques, audio_cues, color_palettes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        category, subcategory, prompt_text, source_url,
                        15,  # Default Seedance duration
                        has_time, has_dialogue,
                        json.dumps(cameras), json.dumps(audio), json.dumps(colors),
                    ),
                )
                prompt_id = cursor.lastrowid

                # Insert genre tags
                genres = self._map_genres(category, subcategory, prompt_text)
                for genre, relevance in genres:
                    self.conn.execute(
                        "INSERT INTO genre_tags (prompt_id, genre, relevance) VALUES (?, ?, ?)",
                        (prompt_id, genre, relevance),
                    )

                # Insert extracted camera phrases
                for cam in cameras:
                    self.conn.execute(
                        "INSERT INTO camera_phrases (phrase, category, source_prompt_id) VALUES (?, ?, ?)",
                        (cam, "extracted", prompt_id),
                    )

                # Insert extracted audio phrases
                for aud in audio:
                    self.conn.execute(
                        "INSERT INTO audio_phrases (phrase, category, source_prompt_id) VALUES (?, ?, ?)",
                        (aud, "extracted", prompt_id),
                    )

    def _populate_xskill_skills(self):
        """Parse xskill_skills.csv and insert into DB."""
        with open(XSKILL_CSV, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                skill_id = row.get("skill_id", "").strip()
                name = row.get("name", "").strip()
                description = row.get("description", "").strip()
                category = row.get("category", "").strip()
                tags = row.get("tags_text", "").strip()

                if not name:
                    continue

                self.conn.execute(
                    """INSERT OR IGNORE INTO xskill_skills
                       (skill_id, name, description, category, tags)
                       VALUES (?, ?, ?, ?, ?)""",
                    (skill_id, name, description, category, json.dumps(tags.split(" | ") if tags else [])),
                )

    def _populate_cinematic_templates(self):
        """Seed 6 cinematic scene templates from Yeraflasher PRD (v13 testing)."""
        _CAT = "Cinematic Scene Templates"

        self.add_prompt(
            category=_CAT,
            subcategory="Heavy Object Physics",
            prompt_text=(
                "[STYLE] shot, [CHARACTER] with [HEAVY OBJECT] walking slowly towards "
                "[DESTINATION], seen from the backside, [OBJECT] close to camera, dragging "
                "[OBJECT] behind them, [OBJECT] scrapes against ground leaving sparks and "
                "deep marks, heavy atmosphere, cinematic shadows, ultra-detailed, 4K, "
                "anamorphic lens, shallow depth of field. [CAMERA_VARIETY_BLOCK]"
            ),
            genres=["cinematic", "action", "fight"],
            duration=15,
        )

        self.add_prompt(
            category=_CAT,
            subcategory="Multi-Character Fight Scene",
            prompt_text=(
                "[CHARACTER_1 @image1] with [WEAPON @image2] and [VILLAIN @image3] in "
                "[LOCATION]. [VILLAIN] starts [MICRO-BEHAVIOUR: e.g., laughing, looks left "
                "and right at allies]. Unexpectedly [VILLAIN] launches forward at high speed, "
                "[ACTION_SEQUENCE]. [CAMERA_VARIETY_BLOCK]"
            ),
            genres=["cinematic", "action", "fight"],
            duration=15,
        )

        self.add_prompt(
            category=_CAT,
            subcategory="Boss Reveal",
            prompt_text=(
                "[CHARACTER_1] is fighting alongside [CHARACTER_2]. Suddenly everyone turns "
                "around as a loud [SOUND: scream/rumble/chains] echoes from [DIRECTION: deep "
                "in the cave/darkness]. A [CREATURE/BOSS DESCRIPTION] emerges from [LOCATION] "
                "in the distance. Low angle shot, backlit silhouette, scale established by "
                "comparison to characters."
            ),
            genres=["cinematic", "action", "boss", "fight"],
            duration=15,
        )

        self.add_prompt(
            category=_CAT,
            subcategory="Physics Impact & Recovery",
            prompt_text=(
                "[ATTACKER] strikes [HERO] with [WEAPON/FORCE], sending [HERO] flying far "
                "back until [HERO] crashes into [SURFACE]. [HERO] stands up slowly, "
                "[RECOVERY_ACTION: brushes dust off shoulders]. [HERO] says: "
                "'[WIT_DIALOGUE]'. [REACTION from attacker]. They both start running toward "
                "each other."
            ),
            genres=["cinematic", "action", "impact", "fight", "comedy"],
            duration=15,
        )

        self.add_prompt(
            category=_CAT,
            subcategory="Micro-Expression Acting Close-Up",
            prompt_text=(
                "Show [CHARACTER_A] and [CHARACTER_B] in close-up alternating reactions. "
                "[CHARACTER_A] lets out a [EMOTION: long scream / laugh / cry] at "
                "[CHARACTER_B]. Then [CHARACTER_B] [REACTION]. [CHARACTER_A] [ESCALATION]. "
                "[CHARACTER_A] [PHYSICAL_ACTION: starts coughing, runs toward camera until "
                "extreme close-up]. Focus on facial mechanics, mouth movement, eye expressions."
            ),
            genres=["cinematic", "action", "fight"],
            duration=15,
        )

        self.add_prompt(
            category=_CAT,
            subcategory="Key Item / MacGuffin Close-Up",
            prompt_text=(
                "[VILLAIN] is [RESTRAINED: stuck in chains / defeated / kneeling]. [HERO] "
                "says: '[VICTORY_LINE]'. [VILLAIN] [REACTION: screams / struggles]. [HERO] "
                "takes [ITEM NAME] from [LOCATION on villain]. We see extreme close-up of "
                "[ITEM] in [HERO]'s hand at the end. [CAMERA_VARIETY_BLOCK]"
            ),
            genres=["cinematic", "action", "item", "fight"],
            duration=15,
        )

    # ------------------------------------------------------------------
    # Extraction Helpers
    # ------------------------------------------------------------------

    def _extract_cameras(self, text: str) -> list[str]:
        """Extract camera technique phrases from prompt text."""
        found = []
        text_lower = text.lower()
        for pattern, label in CAMERA_PATTERNS:
            if re.search(pattern, text_lower):
                if label not in found:
                    found.append(label)
        return found

    def _extract_audio(self, text: str) -> list[str]:
        """Extract audio cue phrases from prompt text."""
        found = []
        text_lower = text.lower()
        for pattern, label in AUDIO_PATTERNS:
            matches = re.findall(pattern, text_lower)
            if matches:
                if label not in found:
                    found.append(label)
        return found

    def _extract_colors(self, text: str) -> list[str]:
        """Extract color/tone descriptions from prompt text."""
        found = []
        text_lower = text.lower()
        for pattern, label in COLOR_PATTERNS:
            if re.search(pattern, text_lower):
                if label not in found:
                    found.append(label)
        return found

    def _map_genres(self, category: str, subcategory: str, text: str) -> list[tuple[str, float]]:
        """Map a prompt to genres based on category and content analysis."""
        genres: list[tuple[str, float]] = []
        seen = set()

        # Category-based mapping (high relevance)
        for cat_key, genre_list in CATEGORY_TO_GENRES.items():
            if cat_key.lower() in category.lower() or cat_key.lower() in subcategory.lower():
                for g in genre_list:
                    if g not in seen:
                        genres.append((g, 1.0))
                        seen.add(g)

        # Keyword-based mapping (lower relevance)
        text_lower = text.lower()
        for genre, keywords in GENRE_KEYWORDS.items():
            if genre in seen:
                continue
            match_count = sum(1 for kw in keywords if kw in text_lower)
            if match_count >= 2:
                relevance = min(1.0, match_count * 0.2)
                genres.append((genre, relevance))
                seen.add(genre)

        return genres if genres else [("general", 0.5)]

    # ------------------------------------------------------------------
    # Search Methods
    # ------------------------------------------------------------------

    def search(
        self,
        genre: str | None = None,
        keyword: str | None = None,
        category: str | None = None,
        duration: int | None = None,
        has_time_segments: bool | None = None,
        limit: int = 10,
    ) -> list[PromptRecord]:
        """Search prompts by genre, keyword, category, or duration.

        Args:
            genre: Genre key (e.g. "fight", "ecommerce", "xianxia")
            keyword: Text keyword to search in prompt_text
            category: CSV category (e.g. "E-commerce/Advertising")
            duration: Filter by duration
            has_time_segments: Filter by time-segmented structure
            limit: Max results to return

        Returns:
            List of PromptRecord objects sorted by relevance
        """
        query_parts = ["SELECT DISTINCT p.*"]
        from_parts = ["FROM prompts p"]
        where_parts = []
        params: list = []
        order = "p.id"

        if genre:
            from_parts.append("JOIN genre_tags gt ON p.id = gt.prompt_id")
            where_parts.append("gt.genre = ?")
            params.append(genre)
            order = "gt.relevance DESC, p.id"

        if keyword:
            where_parts.append("p.prompt_text LIKE ?")
            params.append(f"%{keyword}%")

        if category:
            where_parts.append("p.category LIKE ?")
            params.append(f"%{category}%")

        if duration is not None:
            where_parts.append("p.duration = ?")
            params.append(duration)

        if has_time_segments is not None:
            where_parts.append("p.has_time_segments = ?")
            params.append(1 if has_time_segments else 0)

        query = " ".join(query_parts + from_parts)
        if where_parts:
            query += " WHERE " + " AND ".join(where_parts)
        query += f" ORDER BY {order} LIMIT ?"
        params.append(limit)

        rows = self.conn.execute(query, params).fetchall()
        return [self._row_to_record(row) for row in rows]

    def get_all_genres(self) -> list[tuple[str, int]]:
        """Return all genres with prompt counts, sorted by count."""
        rows = self.conn.execute(
            """SELECT genre, COUNT(DISTINCT prompt_id) as cnt
               FROM genre_tags
               GROUP BY genre
               ORDER BY cnt DESC"""
        ).fetchall()
        return [(row["genre"], row["cnt"]) for row in rows]

    def get_camera_phrases(self, genre: str | None = None) -> list[str]:
        """Get unique camera phrases, optionally filtered by genre."""
        if genre:
            rows = self.conn.execute(
                """SELECT DISTINCT cp.phrase
                   FROM camera_phrases cp
                   JOIN genre_tags gt ON cp.source_prompt_id = gt.prompt_id
                   WHERE gt.genre = ?
                   ORDER BY cp.phrase""",
                (genre,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT DISTINCT phrase FROM camera_phrases ORDER BY phrase"
            ).fetchall()
        return [row["phrase"] for row in rows]

    def get_audio_phrases(self, genre: str | None = None) -> list[str]:
        """Get unique audio phrases, optionally filtered by genre."""
        if genre:
            rows = self.conn.execute(
                """SELECT DISTINCT ap.phrase
                   FROM audio_phrases ap
                   JOIN genre_tags gt ON ap.source_prompt_id = gt.prompt_id
                   WHERE gt.genre = ?
                   ORDER BY ap.phrase""",
                (genre,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT DISTINCT phrase FROM audio_phrases ORDER BY phrase"
            ).fetchall()
        return [row["phrase"] for row in rows]

    def get_prompt_by_id(self, prompt_id: int) -> PromptRecord | None:
        """Get a single prompt by ID."""
        row = self.conn.execute(
            "SELECT * FROM prompts WHERE id = ?", (prompt_id,)
        ).fetchone()
        return self._row_to_record(row) if row else None

    # ------------------------------------------------------------------
    # Feedback Tracking
    # ------------------------------------------------------------------

    def record_result(self, prompt_id: int, quality_score: float, passed: bool, notes: str = '') -> None:
        """Record a generation result against a prompt for feedback learning.

        Args:
            prompt_id: The prompt row id.
            quality_score: Numeric quality score (e.g. 0-100).
            passed: Whether the generation was successful.
            notes: Optional free-text notes (content-filter failures detected automatically).
        """
        now = datetime.now().isoformat()
        self.conn.execute("""
            UPDATE prompts SET
                quality_score = CASE
                    WHEN quality_score IS NULL THEN ?
                    ELSE (quality_score + ?) / 2.0
                END,
                generation_count = generation_count + 1,
                success_count = success_count + CASE WHEN ? THEN 1 ELSE 0 END,
                content_filter_count = content_filter_count + CASE WHEN ? THEN 0 ELSE
                    CASE WHEN ? LIKE '%content%filter%' OR ? LIKE '%violation%' THEN 1 ELSE 0 END
                END,
                last_used = ?,
                feedback_notes = CASE
                    WHEN feedback_notes = '' THEN ?
                    ELSE feedback_notes || x'0a' || ?
                END
            WHERE id = ?
        """, (quality_score, quality_score, passed, passed, notes, notes, now, notes, notes, prompt_id))
        self.conn.commit()

    def get_best_exemplars(self, genre: str, limit: int = 5) -> list[PromptRecord]:
        """Get top-rated prompts for a genre, ranked by quality and success rate.

        Only returns prompts that have been used at least once and have a
        quality score recorded.

        Args:
            genre: Genre key to filter by (e.g. "cinematic", "fight").
            limit: Maximum number of results to return.

        Returns:
            List of PromptRecord objects, best first.
        """
        rows = self.conn.execute("""
            SELECT p.* FROM prompts p
            JOIN genre_tags gt ON gt.prompt_id = p.id
            WHERE gt.genre = ?
            AND p.generation_count > 0
            AND p.quality_score IS NOT NULL
            ORDER BY p.quality_score * (CAST(p.success_count AS REAL) / MAX(p.generation_count, 1)) DESC
            LIMIT ?
        """, (genre, limit)).fetchall()
        return [self._row_to_record(row) for row in rows]

    # ------------------------------------------------------------------
    # Genre Auto-Detection
    # ------------------------------------------------------------------

    def detect_genre(self, description: str) -> str:
        """Auto-detect the most likely genre from a scene description.

        Uses keyword matching with tiebreaking: when multiple genres
        have the same score, prefers content-specific genres over
        ambient ones (horror, vfx, action have many false positives
        from generic words like "dark", "reveal", "car").

        Args:
            description: Raw scene description text

        Returns:
            Best-matching genre key (e.g. "fight", "ecommerce")
        """
        import re
        text_lower = description.lower()
        scores: dict[str, int] = {}

        for genre, keywords in GENRE_KEYWORDS.items():
            score = 0
            for kw in keywords:
                # Short keywords (≤4 chars): exact word boundary both sides
                # to avoid false positives (e.g., "car" in "scar").
                # Long keywords (>4 chars): word boundary at START only,
                # allowing suffix matching (e.g., "fight" → "fighting")
                # while preventing mid-word matches (e.g., "racing" in
                # "embracing", "chase" in "purchase").
                if len(kw) <= 4:
                    if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
                        score += 1
                else:
                    if re.search(r'\b' + re.escape(kw), text_lower):
                        score += 1
            if score > 0:
                scores[genre] = score

        if not scores:
            return "cinematic"  # Default fallback

        # When both fight and drama score, prefer drama if emotional keywords dominate.
        # This prevents "warrior + sadness" from being classified as fight.
        _EMOTIONAL_OVERRIDES = {"sadness", "determination", "reflecting", "reflects",
            "peace", "peaceful", "solitude", "contemplat", "memories", "emotional",
            "tears", "cry", "grief", "hope", "longing", "sorrow", "nostalgia"}
        if "fight" in scores and "drama" in scores:
            emotional_count = sum(1 for ew in _EMOTIONAL_OVERRIDES if ew in text_lower)
            if emotional_count >= 1:
                scores["drama"] += emotional_count * 2  # Boost drama significantly

        max_score = max(scores.values())

        # If only 1 genre has the max, return it
        top_genres = [g for g, s in scores.items() if s == max_score]
        if len(top_genres) == 1:
            return top_genres[0]

        # Tiebreak: prefer content-specific genres over ambient ones
        # Priority order (higher = preferred in ties)
        _GENRE_PRIORITY = {
            "fight": 10, "food": 10, "ecommerce": 10, "popscience": 10,
            "xianxia": 9, "fantasy": 9, "kpop": 9, "drama": 9, "bollywood": 9,
            "sports": 9, "anime": 9, "war": 9, "historical": 9, "western": 9,
            "cyberpunk": 9, "music_video": 9, "superhero": 9,
            "comedy": 8, "romance": 8, "thriller": 8,
            "sci_fi": 8, "nature": 8, "documentary": 8, "noir": 8,
            "underwater": 8, "fairy_tale": 8, "dance": 8,
            "travel": 7, "fashion": 7,
            "cinematic": 7, "action": 6,
            "horror": 5, "vfx": 4, "general": 1,
        }
        return max(top_genres, key=lambda g: _GENRE_PRIORITY.get(g, 5))

    # ------------------------------------------------------------------
    # Prompt Expansion
    # ------------------------------------------------------------------

    def expand_prompt(
        self,
        description: str,
        genre: str | None = None,
        duration: int = 15,
        include_audio: bool = True,
        include_color: bool = True,
        aspect_ratio: str = "landscape",
    ) -> ExpandedPrompt:
        """Expand a simple description into a rich time-segmented Seedance prompt.

        Finds the best matching template from the DB, extracts its structural
        pattern (time segments, camera flow, audio cues), and applies it to
        the user's description.

        Args:
            description: Simple scene description (e.g. "Two warriors clash")
            genre: Genre key. Auto-detected if None.
            duration: Target clip duration in seconds
            include_audio: Whether to add audio cue suggestions
            include_color: Whether to add color/tone suggestions
            aspect_ratio: "landscape" (16:9), "portrait" (9:16), or "square" (1:1)

        Returns:
            ExpandedPrompt with enriched prompt text and suggestions
        """
        if genre is None:
            genre = self.detect_genre(description)

        # Find matching templates
        templates = self.search(genre=genre, has_time_segments=True, limit=5)
        if not templates:
            templates = self.search(genre=genre, limit=5)

        # Collect camera/audio/color suggestions from matching templates
        camera_suggestions = []
        audio_suggestions = []
        color_suggestions = []
        template_id = None

        for t in templates:
            camera_suggestions.extend(t.camera_techniques)
            audio_suggestions.extend(t.audio_cues)
            color_suggestions.extend(t.color_palettes)
            if template_id is None:
                template_id = t.id

        # Deduplicate
        camera_suggestions = list(dict.fromkeys(camera_suggestions))
        audio_suggestions = list(dict.fromkeys(audio_suggestions))
        color_suggestions = list(dict.fromkeys(color_suggestions))

        # Build time-segmented prompt
        expanded = self._build_time_segmented(
            description, duration, genre, camera_suggestions,
            audio_suggestions if include_audio else [],
            color_suggestions if include_color else [],
            aspect_ratio=aspect_ratio,
        )

        # Build genre-aware negative prompt
        genre_neg = _GENRE_NEGATIVES.get(genre, "")
        negative = f"{_BASE_NEGATIVE}, {genre_neg}" if genre_neg else _BASE_NEGATIVE

        return ExpandedPrompt(
            original=description,
            expanded=expanded,
            genre=genre,
            duration=duration,
            template_id=template_id,
            camera_suggestions=camera_suggestions[:6],
            audio_suggestions=audio_suggestions[:4],
            color_suggestions=color_suggestions[:3],
            negative_prompt=negative,
        )

    def _build_time_segmented(
        self,
        description: str,
        duration: int,
        genre: str,
        cameras: list[str],
        audio: list[str],
        colors: list[str],
        aspect_ratio: str = "landscape",
    ) -> str:
        """Build a time-segmented prompt using genre patterns."""
        # Aspect-ratio-aware framing prefix — portrait videos benefit from
        # vertical composition cues while landscape uses cinematic widescreen.
        _ASPECT_FRAMING: dict[str, str] = {
            "portrait": "vertical frame, ",
            "square": "",
            "landscape": "",  # default cinematic, no extra prefix needed
        }
        aspect_prefix = _ASPECT_FRAMING.get(aspect_ratio, "")

        # Genre-specific camera/framing defaults
        genre_camera_defaults = {
            "fight": ["low_angle", "quick_cut", "tracking", "slow_motion", "closeup"],
            "xianxia": ["low_angle", "crane_up", "orbit", "slow_motion", "push_in"],
            "ecommerce": ["closeup", "orbit", "push_in", "tracking", "slow_zoom_in"],
            "food": ["extreme_closeup", "slow_zoom_in", "tracking", "push_in"],
            "drama": ["closeup", "medium", "push_in", "pull_back", "rack_focus"],
            "popscience": ["push_in", "zoom", "orbit", "tracking"],
            "kpop": ["low_angle", "tracking", "quick_cut", "whip_pan"],
            "fantasy": ["low_angle", "crane_up", "orbit", "push_in", "wide"],
            "action": ["tracking", "handheld", "whip_pan", "low_angle"],
            "horror": ["slow_zoom_in", "dutch_angle", "handheld", "push_in"],
            "nature": ["aerial_descend", "slow_zoom_in", "tracking", "crane_up", "wide", "push_in"],
            "documentary": ["slow_zoom_in", "dolly_forward", "push_in", "tracking", "pull_back"],
            "bollywood": ["crane_up", "orbit", "tracking", "low_angle", "whip_pan", "push_in"],
            "sci_fi": ["push_in", "tracking", "crane_up", "orbit", "low_angle", "whip_pan", "pull_back"],
            "sports": ["tracking", "slow_motion", "low_angle", "whip_pan", "closeup", "crane_up", "handheld"],
            "anime": ["push_in", "tracking", "low_angle", "whip_pan", "closeup", "crane_up", "quick_cut"],
            "romance": ["push_in", "slow_zoom_in", "orbit", "rack_focus", "closeup", "pull_back", "tracking"],
            "thriller": ["slow_zoom_in", "push_in", "tracking", "handheld", "dutch_angle", "rack_focus", "pull_back"],
            "comedy": ["medium", "quick_cut", "push_in", "whip_pan", "closeup", "tracking", "pull_back"],
            "war": ["tracking", "handheld", "low_angle", "crane_up", "push_in", "wide", "slow_motion"],
            "historical": ["crane_up", "slow_zoom_in", "tracking", "wide", "push_in", "low_angle", "pull_back"],
            "western": ["wide", "tracking", "slow_zoom_in", "low_angle", "push_in", "pan", "pull_back"],
            "cyberpunk": ["push_in", "tracking", "low_angle", "dutch_angle", "crane_up", "whip_pan", "pull_back"],
            "music_video": ["tracking", "low_angle", "whip_pan", "crane_up", "quick_cut", "push_in", "closeup"],
            "superhero": ["low_angle", "tracking", "crane_up", "push_in", "slow_motion", "wide", "whip_pan"],
            "noir": ["slow_zoom_in", "push_in", "dutch_angle", "tracking", "low_angle", "pull_back", "rack_focus"],
            "underwater": ["slow_zoom_in", "tracking", "crane_down", "push_in", "orbit", "pull_back", "low_angle"],
            "fairy_tale": ["crane_up", "tracking", "push_in", "slow_zoom_in", "orbit", "wide", "pull_back"],
            "dance": ["tracking", "low_angle", "whip_pan", "crane_up", "slow_motion", "quick_cut", "push_in"],
            "travel": ["aerial_descend", "tracking", "crane_up", "slow_zoom_in", "push_in", "wide", "pan"],
            "fashion": ["tracking", "slow_zoom_in", "push_in", "low_angle", "orbit", "closeup", "pull_back"],
            "vfx": ["push_in", "zoom", "orbit", "tracking", "slow_motion", "quick_cut", "pull_back"],
            "cinematic": ["aerial_descend", "dolly_forward", "crane_up", "push_in", "establishing", "slow_zoom_in", "tracking_right", "pull_back"],
            "general": ["push_in", "medium", "tracking", "slow_zoom_in"],
        }

        # Genre-specific audio defaults
        genre_audio_defaults = {
            "fight": ["impact sounds", "whoosh effects", "tense percussion", "battle cries"],
            "xianxia": ["energy hum", "mystical chimes", "sword clash", "ethereal choir"],
            "ecommerce": ["upbeat music", "crisp product sounds", "satisfying click"],
            "food": ["sizzling", "crisp cutting", "liquid pouring", "ambient kitchen"],
            "drama": ["emotional piano", "subtle strings", "ambient silence", "heartbeat"],
            "popscience": ["electronic ambient", "subtle pulse", "clean transitions"],
            "kpop": ["heavy bass", "electronic beat", "percussion hits", "synth lead"],
            "fantasy": ["orchestral swell", "mystical chimes", "energy burst"],
            "action": ["percussion heavy", "engine roar", "impact bass"],
            "horror": ["low drone", "dissonant strings", "sudden silence"],
            "nature": ["nature ambience", "birdsong", "water flowing", "wind through trees"],
            "documentary": ["ambient score", "contemplative piano", "atmospheric tension"],
            "bollywood": ["orchestral strings swell", "dhol beats", "sitar melody", "dramatic tabla rhythm"],
            "sci_fi": ["electronic hum", "synthesizer pulse", "engine throb", "energy discharge"],
            "sports": ["roaring crowd", "referee whistle", "ball impact", "athletic footsteps"],
            "anime": ["orchestral swell", "dramatic impact sound", "wind rush", "power-up charge"],
            "romance": ["tender piano melody", "soft strings", "gentle breeze", "heartbeat"],
            "thriller": ["tense low drone", "ticking clock", "sharp string stabs", "distant sirens"],
            "comedy": ["comedic timing beat", "cartoonish sound effect", "surprised gasp", "crowd laughter"],
            "war": ["distant artillery thunder", "boots on gravel", "radio static chatter", "helicopter rotors"],
            "historical": ["period orchestral score", "stone footsteps in grand hall", "distant church bells", "crowd murmur"],
            "western": ["lonely harmonica", "wind across empty plains", "creaking saloon doors", "distant coyote howl"],
            "cyberpunk": ["synthetic bass pulse", "neon hum and electrical crackle", "distant city traffic", "digital glitch stutter"],
            "music_video": ["driving bass rhythm", "percussive hits synced to action", "crowd energy roar", "vocal echo"],
            "superhero": ["heroic orchestral fanfare", "power charge energy hum", "cape whipping in wind", "ground impact boom"],
            "noir": ["melancholy saxophone", "rain on window pane", "footsteps on wet pavement", "distant police siren"],
            "underwater": ["muffled ocean currents", "bubble streams rising", "whale song in distance", "deep pressure hum"],
            "fairy_tale": ["gentle music box melody", "sparkling magic chimes", "rustling enchanted leaves", "soft harp glissando"],
            "dance": ["driving rhythmic beat", "bass drop with floor vibration", "body movement swoosh", "crowd energy pulse"],
            "travel": ["ambient world music", "local street sounds", "distant call to prayer or bells", "gentle wind and nature"],
            "fashion": ["sleek electronic beat", "camera shutter clicks", "fabric rustling on runway", "audience murmur and applause"],
            "vfx": ["digital whoosh", "particle shimmer", "energy pulse", "transformative impact"],
            "cinematic": ["ambient atmospheric sound", "sweeping orchestral", "wind and nature"],
            "general": ["ambient sound", "subtle music"],
        }

        # Genre-specific tone/color defaults
        genre_color_defaults = {
            "fight": ["high contrast", "dark red and gold tones"],
            "xianxia": ["golden and ethereal tones", "purple energy accents"],
            "ecommerce": ["bright, clean, commercial lighting"],
            "food": ["warm appetizing tones", "golden hour warmth"],
            "drama": ["moody contrast", "natural skin tones"],
            "popscience": ["cool clinical blue", "translucent visualization"],
            "kpop": ["neon high saturation", "vivid contrast"],
            "fantasy": ["rich saturated colors", "magical glow"],
            "action": ["desaturated gritty", "high contrast"],
            "horror": ["desaturated cold", "deep shadows"],
            "nature": ["earth tones and natural greens", "golden natural light"],
            "documentary": ["desaturated natural tones", "archival warmth"],
            "bollywood": ["rich saturated warm tones", "vibrant jewel colors", "golden opulence"],
            "sci_fi": ["cool blue and cyan neon", "holographic highlights", "deep space black"],
            "sports": ["vivid broadcast colors", "natural daylight contrast", "stadium green"],
            "anime": ["vibrant saturated anime colors", "dramatic light shafts", "cel-shaded highlights"],
            "romance": ["warm golden tones", "soft pink hues", "dreamy bokeh highlights"],
            "thriller": ["cold desaturated tones", "harsh shadow contrast", "muted urban palette"],
            "comedy": ["bright saturated colors", "warm cheerful tones", "exaggerated contrast"],
            "war": ["desaturated olive and earth tones", "smoke-hazed atmosphere", "muted blood and steel"],
            "historical": ["warm sepia tones", "candlelit amber warmth", "muted period color palette"],
            "western": ["sun-bleached warm tones", "dusty amber and ochre", "scorched desert palette"],
            "cyberpunk": ["neon magenta and cyan", "deep black with electric highlights", "rain-reflective chrome"],
            "music_video": ["high contrast vivid colors", "dramatic stage lighting gels", "saturated pop palette"],
            "superhero": ["bold primary colors", "dramatic light vs shadow", "vivid comic-book saturation"],
            "noir": ["high contrast black and white", "deep shadow pools", "single-source warm light spill"],
            "underwater": ["deep ocean blue and teal", "bioluminescent accents", "filtered sunlight rays"],
            "fairy_tale": ["soft pastel warmth", "golden storybook glow", "enchanted jewel-tone accents"],
            "dance": ["vivid saturated colors", "dramatic stage lighting gels", "high-energy neon accents"],
            "travel": ["warm golden hour tones", "rich natural earth colors", "vibrant local palette"],
            "fashion": ["elegant muted tones", "high contrast black and color", "luxurious metallic accents"],
            "vfx": ["vibrant energy colors", "digital glow accents", "chromatic transition tones"],
            "cinematic": ["golden hour warmth", "filmic color grading"],
            "general": ["cinematic tones"],
        }

        # Always prefer genre-specific defaults (hand-crafted, descriptive)
        # over DB-extracted tokens which are often too generic or mismatched
        cam = genre_camera_defaults.get(genre, cameras[:4] if cameras else ["push_in", "medium"])
        aud = genre_audio_defaults.get(genre, audio[:3] if audio else ["ambient sound"])
        col = genre_color_defaults.get(genre, colors[:2] if colors else ["cinematic tones"])

        # Context-aware color palette overrides — genre defaults are too
        # generic for sub-genres.  E.g. sports uses "vivid broadcast colors"
        # and "stadium green" but boxing needs "dark red and warm leather" and
        # swimming needs "aqua blue and white lane markers".
        _COLOR_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], list[str]]]] = {
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight"], ["dark red and warm leather tones", "harsh canvas white spotlight"]),
                (["wrestling", "mma", "octagon", "cage"], ["cage steel grey and blood red", "harsh mat-lit contrast"]),
                (["swimming", "diving", "pool"], ["aqua blue and white lane markers", "underwater caustic green"]),
                (["soccer", "football", "pitch"], ["vivid green pitch and white lines", "crowd color mosaic"]),
                (["tennis", "racket", "court"], ["clay orange or grass green court", "bright white ball trails"]),
                (["racing", "formula", "motorsport"], ["metallic car livery colors", "asphalt grey with tire smoke"]),
                (["skiing", "snowboard", "ice"], ["crisp white snow and sky blue", "neon gear accents"]),
            ],
            "nature": [
                # More specific sub-genres first (volcano before mountain) — first match wins
                (["volcano", "lava", "eruption", "volcanic"], ["molten orange and deep volcanic red", "ash grey smoke plumes"]),
                (["aurora", "northern lights", "borealis"], ["ethereal green and purple curtains", "deep arctic blue sky"]),
                (["ocean", "sea", "wave", "beach",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], ["deep ocean blue and seafoam white", "sun-sparkled water highlights"]),
                (["desert", "sand", "dune"], ["sun-bleached golden sand", "burnt amber and ochre gradient"]),
                (["forest", "jungle", "rainforest"], ["deep emerald and moss green", "dappled golden light spots"]),
                (["mountain", "peak", "alpine"], ["cool slate grey and snow white", "warm golden summit light"]),
                (["storm", "lightning", "thunder"], ["dark bruised purple-grey clouds", "electric white lightning flash"]),
                (["waterfall", "cascade", "river"], ["crystal blue water and misty white", "rainbow prismatic spray"]),
            ],
            "horror": [
                (["haunted", "mansion", "castle", "gothic"], ["decayed muted greens and bone white", "sickly yellow candlelight flicker"]),
                (["forest", "woods", "cabin", "swamp"], ["cold moonlit blue-grey and dead brown", "fog-diffused pale white"]),
                (["hospital", "asylum", "corridor", "institution"], ["clinical cold green under fluorescent flicker", "sterile white with blood-red accents"]),
                (["urban", "subway", "alley", "basement"], ["sodium orange streetlight and deep black shadow", "grimy rust and concrete grey"]),
                (["underwater", "deep sea", "abyss", "creature"], ["abyssal blue-black and bioluminescent green", "murky teal with phosphorescent highlights"]),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor"], ["hot neon pink and electric cyan reflections on wet pavement", "holographic signage glow"]),
                (["rooftop", "skyline", "tower", "aerial"], ["deep indigo sky with neon city glow below", "distant holographic billboard shimmer"]),
                (["club", "rave", "underground", "bar"], ["strobing magenta and UV violet", "pulsing laser green on chrome surfaces"]),
                (["corporate", "office", "tower", "executive"], ["cold steel blue and sterile white", "subtle holographic data teal accents"]),
                (["rain", "neon", "night", "puddle"], ["neon reflections fractured in wet asphalt", "streaked cyan and magenta rain trails"]),
            ],
            "war": [
                (["trench", "foxhole", "bunker", "barricade"], ["mud brown and gunmetal grey", "muzzle flash orange cutting through smoke"]),
                (["urban", "ruins", "city", "rubble"], ["dusty concrete grey and charred black", "fire orange through shattered windows"]),
                (["aerial", "sky", "plane", "bomber"], ["cold altitude blue and aluminium silver", "explosion orange against overcast grey"]),
                (["naval", "ship", "submarine", "destroyer"], ["steel grey sea and battleship iron", "signal flare red over dark water"]),
                (["jungle", "guerrilla", "vietnam", "tropics"], ["dark humid green and sweat-stained khaki", "filtered golden light through dense canopy"]),
            ],
            "romance": [
                (["rain", "storm", "umbrella", "downpour"], ["silver rain streaks and warm window glow", "soft blurred city bokeh pastels"]),
                (["beach", "seaside", "sunset", "shore"], ["warm peach sunset and gentle turquoise water", "golden sand catching last light"]),
                (["garden", "meadow", "flower", "blossom"], ["soft petal pink and fresh spring green", "warm golden pollen-dusted light"]),
                (["city", "rooftop", "skyline", "balcony"], ["warm amber streetlight and cool twilight blue", "city sparkle bokeh"]),
                (["ballroom", "dance", "wedding", "gala"], ["rich ivory and champagne gold", "crystal chandelier warm prismatic light"]),
            ],
            "food": [
                (["sushi", "japanese", "ramen", "sashimi"], ["clean white ceramic and deep soy brown", "warm bamboo and lacquer red accents"]),
                (["steak", "grill", "bbq", "flame"], ["charred black and seared caramel brown", "fire orange glow and smoke grey"]),
                (["pastry", "dessert", "cake", "chocolate"], ["pastel cream and rich chocolate brown", "powdered sugar white and berry red"]),
                (["cocktail", "wine", "bar", "spirits"], ["amber liquid and crystal-clear ice", "dark mahogany bar and copper highlights"]),
                (["street food", "market", "vendor", "stall"], ["vibrant spice orange and turmeric yellow", "raw ingredient greens and basket tan"]),
            ],
            "sci_fi": [
                (["space", "station", "orbit", "shuttle"], ["cold void black and instrument blue", "visor reflection and status light green"]),
                (["robot", "android", "cybernetic", "mech"], ["brushed titanium silver and LED blue", "power core amber and circuit green"]),
                (["alien", "planet", "colony", "atmosphere"], ["otherworldly teal and alien amber", "bioluminescent purple and mineral rust"]),
                (["laboratory", "research", "experiment", "device"], ["clean clinical white and hologram blue", "sample glow green and warning red"]),
            ],
            "fantasy": [
                (["castle", "kingdom", "throne", "knight"], ["royal gold and stone grey", "stained glass jewel tones and torch amber"]),
                (["enchanted", "magical", "spell", "fairy"], ["ethereal purple and enchanted green shimmer", "magical gold particle glow"]),
                (["dragon", "beast", "creature", "wyvern"], ["scale green and fire orange", "molten gold and obsidian black"]),
                (["dungeon", "cave", "underground", "crypt"], ["deep shadow black and torch amber", "crystal blue and mineral rust"]),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee"], ["motion-blurred city grey and brake-light red", "streaked headlight white"]),
                (["explosion", "fire", "destruction", "blast"], ["fireball orange and shockwave white", "debris-cloud grey and ember red"]),
                (["rooftop", "parkour", "urban", "jump"], ["concrete grey and sky blue", "harsh directional sunlight and deep shadow"]),
                (["vehicle", "car", "motorcycle", "helicopter"], ["metallic paint reflection and road asphalt grey", "dashboard glow and tunnel light streak"]),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence", "crime scene"], ["cold forensic blue-white and clinical grey", "evidence-lamp harsh yellow spot"]),
                (["chase", "pursuit", "escape", "run"], ["panic-desaturated grey-green", "harsh emergency exit red spill"]),
                (["hostage", "kidnap", "captive", "trapped"], ["oppressive shadow black and bare-bulb amber", "concrete grey and rust stain"]),
                (["surveillance", "spy", "covert", "shadow"], ["security-monitor green-tint and deep black", "cold steel grey with single accent"]),
                (["conspiracy", "paranoia", "cover-up"], ["desaturated documentary grey-green", "fluorescent office-pallor white"]),
            ],
        }
        color_ctx = _COLOR_CONTEXT_OVERRIDES.get(genre, [])
        if color_ctx:
            desc_lower_col = description.lower()
            for keywords, override_colors in color_ctx:
                if any(kw in desc_lower_col for kw in keywords):
                    col = override_colors
                    break

        # Context-aware audio for nature genre (ocean vs forest vs savanna etc.)
        if genre == "nature":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("ocean", "sea", "whale", "dolphin", "coral", "reef", "underwater", "jellyfish", "shark")):
                aud = ["deep ocean ambience", "whale song", "bubbles and water currents", "waves crashing"]
            elif any(w in desc_lower for w in ("forest", "rainforest", "jungle", "canopy", "woodland")):
                aud = ["dense forest ambience", "exotic birdsong", "rustling leaves", "distant animal calls"]
            elif any(w in desc_lower for w in ("savanna", "plains", "grassland", "african", "safari")):
                aud = ["wind through dry grass", "distant animal calls", "insect chorus", "thundering hooves"]
            elif any(w in desc_lower for w in ("arctic", "glacier", "ice", "polar", "frozen", "tundra")):
                aud = ["howling arctic wind", "cracking ice", "distant wolf howl", "crunching snow"]
            elif any(w in desc_lower for w in ("mountain", "peak", "alpine", "cliff", "canyon")):
                aud = ["mountain wind", "distant eagle cry", "rockfall echo", "rushing stream"]

        # Context-aware audio for sports genre (combat, court, water, etc.)
        if genre == "sports":
            desc_lower = description.lower()
            # Combat sports must come before general indoor to avoid boxing→court
            if any(w in desc_lower for w in ("boxing", "boxer", "ring", "heavyweight", "uppercut", "knockout")):
                aud = ["leather glove impact on flesh", "corner bell clanging", "heavy breathing through mouthguard", "rope tension creak"]
            elif any(w in desc_lower for w in ("wrestling", "mma", "grapple", "takedown", "octagon", "cage")):
                aud = ["body slam on canvas", "crowd roar on takedown", "referee counting", "mat thudding"]
            elif any(w in desc_lower for w in ("swimming", "diving", "surfing", "water polo", "pool")):
                aud = ["splashing water", "muffled underwater sound", "crowd cheering", "starting horn"]
            elif any(w in desc_lower for w in ("basketball", "volleyball", "gymnasium", "indoor", "court")):
                aud = ["sneaker squeaks on court", "ball bounce echo", "indoor crowd roar", "buzzer"]
            elif any(w in desc_lower for w in ("soccer", "football", "goal", "pitch", "stadium")):
                aud = ["boot striking ball", "crowd erupting on goal", "referee whistle", "chanting fans"]
            elif any(w in desc_lower for w in ("tennis", "racket", "serve", "rally")):
                aud = ["racket striking ball", "ball bouncing on clay", "crowd gasp", "umpire call"]
            elif any(w in desc_lower for w in ("skiing", "snowboard", "ice", "skating")):
                aud = ["carving through snow", "wind rush", "crowd bells ringing", "crunching ice"]
            elif any(w in desc_lower for w in ("racing", "formula", "motorsport", "car", "motorcycle")):
                aud = ["engine roar", "tire screech", "wind at high speed", "pit crew radio chatter"]
            elif any(w in desc_lower for w in ("sprint", "run", "track", "relay", "hurdle", "100m", "200m")):
                aud = ["starting pistol crack", "spikes on track surface", "crowd crescendo building", "heavy athletic breathing"]
            elif any(w in desc_lower for w in ("gymnast", "vault", "beam", "pommel", "floor exercise")):
                aud = ["springboard thud", "body landing on mat", "chalk dust puff", "hushed crowd anticipation"]

        # Context-aware audio for romance genre (rain, beach, dance, city)
        if genre == "romance":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("rain", "storm", "umbrella", "downpour")):
                aud = ["soft rain pattering", "distant thunder", "gentle dripping", "emotional piano"]
            elif any(w in desc_lower for w in ("beach", "shore", "ocean", "seaside", "waves")):
                aud = ["gentle waves lapping", "sea breeze", "distant gulls", "soft guitar melody"]
            elif any(w in desc_lower for w in ("dance", "waltz", "ballroom", "slow dance")):
                aud = ["sweeping orchestral waltz", "soft footsteps on floor", "rustling fabric", "gentle music box"]
            elif any(w in desc_lower for w in ("city", "rooftop", "skyline", "balcony", "window")):
                aud = ["distant city hum", "soft jazz piano", "gentle wind", "muffled traffic below"]

        # Context-aware audio for war genre (trench, aerial, naval, jungle)
        if genre == "war":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("trench", "foxhole", "bunker", "barricade", "frontline")):
                aud = ["machine gun rattle", "mortar whistle and impact", "mud squelching", "shouted orders over gunfire"]
            elif any(w in desc_lower for w in ("aerial", "air force", "bomber", "airstrike", "helicopter", "gunship")):
                aud = ["jet engine roar", "anti-aircraft fire", "bomb whistle and explosion", "cockpit radio chatter"]
            elif any(w in desc_lower for w in ("naval", "navy", "submarine", "battleship", "destroyer")):
                aud = ["waves crashing on hull", "torpedo alarm", "deep sonar ping", "engine room rumble"]
            elif any(w in desc_lower for w in ("jungle", "vietnam", "guerrilla", "ambush")):
                aud = ["dense jungle ambience", "distant mortar fire", "helicopter rotors overhead", "rustling undergrowth"]

        # Context-aware audio for thriller genre (heist, chase, interrogation, surveillance)
        if genre == "thriller":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("heist", "vault", "safe", "robbery", "infiltration")):
                aud = ["metallic clicks and mechanisms", "muffled radio chatter", "tense electronic pulse", "alarm trigger"]
            elif any(w in desc_lower for w in ("chase", "pursuit", "getaway", "manhunt", "fugitive")):
                aud = ["pounding heartbeat", "running footsteps on wet pavement", "distant sirens wailing", "screeching tires"]
            elif any(w in desc_lower for w in ("interrogation", "confession", "witness", "detective")):
                aud = ["fluorescent light buzz", "pen scratching paper", "echoing room tone", "sharp table slam"]
            elif any(w in desc_lower for w in ("surveillance", "stalker", "watching", "hidden camera")):
                aud = ["static hiss", "camera shutter click", "muffled breathing", "tense low frequency hum"]

        # Context-aware audio for historical genre (medieval, ancient, renaissance, revolution)
        if genre == "historical":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("medieval", "castle", "knight", "feudal", "crusade", "siege")):
                aud = ["clanking armor", "horse hooves on cobblestone", "distant battle horns", "crackling torchlight"]
            elif any(w in desc_lower for w in ("ancient", "pharaoh", "pyramid", "roman", "greek", "spartan", "colosseum")):
                aud = ["sandstone wind", "ceremonial drums", "distant crowd chanting", "bronze instruments"]
            elif any(w in desc_lower for w in ("renaissance", "victorian", "court", "ball", "coronation")):
                aud = ["chamber music", "rustling silk gowns", "murmured conversation", "crystal clinking"]
            elif any(w in desc_lower for w in ("revolution", "guillotine", "uprising", "rebellion")):
                aud = ["angry mob roar", "marching drums", "musket fire", "breaking chains"]

        # Context-aware audio for superhero genre (flight, battle, origin, rescue)
        if genre == "superhero":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("flying", "flight", "soaring", "levitating", "hovering")):
                aud = ["rushing wind at altitude", "sonic boom", "cape fluttering at high speed", "heroic orchestral soar"]
            elif any(w in desc_lower for w in ("villain", "nemesis", "battle", "fight", "clash")):
                aud = ["explosive impact shockwave", "energy beam clash", "dramatic combat percussion", "building collapse rumble"]
            elif any(w in desc_lower for w in ("origin", "transform", "awaken", "discover")):
                aud = ["energy surge building to crescendo", "transformation electrical crackle", "heartbeat accelerating", "power awakening hum"]
            elif any(w in desc_lower for w in ("rescue", "saving", "protect", "shield")):
                aud = ["sirens and chaos in background", "grateful crowd cheering", "heroic brass fanfare", "debris settling"]

        # Context-aware audio for cyberpunk genre (street, club, corporate, underground)
        if genre == "cyberpunk":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("street", "alley", "rain", "neon city", "market")):
                aud = ["rain on neon signs", "distant hover traffic", "street vendor chatter", "electronic bass thrum"]
            elif any(w in desc_lower for w in ("club", "rave", "nightclub", "underground")):
                aud = ["thumping techno bass", "laser sound effects", "crowd pulse", "synthesizer wail"]
            elif any(w in desc_lower for w in ("corporate", "tower", "office", "boardroom")):
                aud = ["sterile hum of servers", "holographic interface chimes", "glass elevator whir", "digital assistant voice"]
            elif any(w in desc_lower for w in ("hack", "neural", "matrix", "data", "cyber")):
                aud = ["rapid data stream clicks", "neural interface connecting", "digital code cascade", "glitch distortion pulse"]

        # Context-aware audio for music_video genre (live, studio, festival, intimate)
        if genre == "music_video":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("concert", "festival", "crowd", "arena", "stadium")):
                aud = ["massive crowd roar", "bass drop shaking the venue", "crowd singing along", "pyrotechnics blast"]
            elif any(w in desc_lower for w in ("studio", "recording", "headphones", "booth")):
                aud = ["studio monitor playback", "vocal booth intimacy", "mixing board clicks", "headphone bleed"]
            elif any(w in desc_lower for w in ("acoustic", "unplugged", "intimate", "coffeehouse")):
                aud = ["acoustic guitar fingerpicking", "soft vocal warmth", "gentle room ambience", "audience murmur"]
            elif any(w in desc_lower for w in ("hip hop", "rap", "rapper", "beat")):
                aud = ["heavy 808 bass hit", "hi-hat rolls", "vocal ad-libs", "vinyl scratch"]

        # Context-aware audio for western genre (town, chase, campfire, showdown)
        if genre == "western":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("saloon", "bar", "tavern", "poker", "gambling")):
                aud = ["piano saloon music", "glass clinking", "poker chips shuffling", "creaking floorboards"]
            elif any(w in desc_lower for w in ("chase", "gallop", "horseback", "pursuit", "stampede")):
                aud = ["thundering hooves", "whip crack", "heavy breathing", "dust cloud rushing"]
            elif any(w in desc_lower for w in ("campfire", "night", "sunset", "starry", "camp")):
                aud = ["crackling campfire", "distant coyote howl", "gentle guitar strum", "cricket chorus"]
            elif any(w in desc_lower for w in ("showdown", "quickdraw", "duel", "standoff")):
                aud = ["tense silence", "ticking pocket watch", "wind whistle through empty street", "dramatic sting"]

        # Context-aware audio for noir genre (bar, street, office, crime scene)
        if genre == "noir":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("bar", "lounge", "club", "smoky", "whiskey")):
                aud = ["muffled jazz piano", "ice clinking in glass", "hushed conversation", "cigarette lighter click"]
            elif any(w in desc_lower for w in ("street", "alley", "rain", "neon", "pavement")):
                aud = ["rain on concrete", "distant car horn", "footsteps echoing in alley", "dripping drainpipe"]
            elif any(w in desc_lower for w in ("office", "desk", "blinds", "typewriter")):
                aud = ["typewriter clacking", "ceiling fan hum", "venetian blinds rattling", "phone ringing in distance"]
            elif any(w in desc_lower for w in ("crime", "murder", "body", "evidence", "blood")):
                aud = ["police radio static", "camera flash click", "chalk scraping pavement", "uneasy silence"]

        # Context-aware audio for underwater genre (reef, deep, wreck, surface)
        if genre == "underwater":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("reef", "coral", "tropical", "colorful", "fish")):
                aud = ["gentle current flow", "small fish darting", "distant clicking sounds", "soft bubble trails"]
            elif any(w in desc_lower for w in ("deep", "abyss", "trench", "dark", "pressure")):
                aud = ["deep pressure groaning", "distant metallic creaking", "eerie whale call", "ominous low frequency pulse"]
            elif any(w in desc_lower for w in ("wreck", "shipwreck", "sunken", "ruin")):
                aud = ["metal groaning and settling", "chain links swaying", "fish darting through corridors", "muffled water displacement"]
            elif any(w in desc_lower for w in ("surface", "light", "sun", "wave", "snorkel")):
                aud = ["surface waves overhead", "air bubbles ascending", "muffled splash", "shimmering light ambient"]

        # Context-aware audio for fairy_tale genre (forest, castle, village, dark)
        if genre == "fairy_tale":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("forest", "wood", "tree", "path", "mushroom")):
                aud = ["birdsong and fairy chimes", "rustling enchanted branches", "babbling brook", "gentle woodland breeze"]
            elif any(w in desc_lower for w in ("castle", "tower", "throne", "kingdom", "palace")):
                aud = ["stone echo footsteps", "distant trumpet fanfare", "heavy door creaking", "tapestry rustling"]
            elif any(w in desc_lower for w in ("village", "cottage", "market", "cobblestone")):
                aud = ["cheerful village bustle", "wind chimes tinkling", "distant laughter", "horse cart on cobblestone"]
            elif any(w in desc_lower for w in ("dark", "witch", "cursed", "dungeon", "thorn")):
                aud = ["ominous low strings", "crow cawing", "wind howling through ruins", "creaking gate"]

        # Context-aware audio for dance genre (ballet, street, ballroom, club)
        if genre == "dance":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("ballet", "ballerina", "pointe", "tutu", "pirouette", "arabesque")):
                aud = ["delicate piano accompaniment", "pointe shoes tapping on stage", "soft orchestral strings", "gentle breathing rhythm"]
            elif any(w in desc_lower for w in ("breakdance", "b-boy", "street", "popping", "locking", "freestyle")):
                aud = ["booming boombox beat", "sneakers squeaking on concrete", "crowd hyping and cheering", "vinyl scratch"]
            elif any(w in desc_lower for w in ("ballroom", "waltz", "tango", "salsa", "flamenco")):
                aud = ["sweeping orchestral dance music", "heels clicking on polished floor", "fabric swishing with each turn", "partner breathing"]
            elif any(w in desc_lower for w in ("club", "floor", "party", "rave")):
                aud = ["thumping bass beat", "DJ drop with crowd reaction", "laser sound whoosh", "crowd dancing energy"]

        # Context-aware audio for travel genre (city, nature, market, beach)
        if genre == "travel":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("city", "urban", "skyline", "architecture", "monument")):
                aud = ["bustling city ambience", "distant traffic and horns", "footsteps on pavement", "ambient world music"]
            elif any(w in desc_lower for w in ("mountain", "trek", "hike", "trail", "summit")):
                aud = ["mountain wind", "gravel crunching underfoot", "distant eagle cry", "rushing stream"]
            elif any(w in desc_lower for w in ("market", "bazaar", "street food", "vendor", "spice")):
                aud = ["bustling market chatter", "sizzling street food", "merchant calling", "exotic instruments"]
            elif any(w in desc_lower for w in ("beach", "island", "coastal", "ocean", "tropical")):
                aud = ["gentle waves lapping on shore", "tropical breeze through palms", "distant steel drums", "seabird calls"]

        # Context-aware audio for fashion genre (runway, studio, backstage, street)
        if genre == "fashion":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("runway", "catwalk", "fashion show", "model walk")):
                aud = ["deep electronic bass beat", "heels clicking on runway", "camera shutters firing", "audience gasps"]
            elif any(w in desc_lower for w in ("studio", "editorial", "photoshoot", "shoot")):
                aud = ["camera shutter click", "studio flash pop", "soft music playback", "stylist adjusting fabric"]
            elif any(w in desc_lower for w in ("backstage", "fitting", "preparation", "mirror")):
                aud = ["hairdryer and makeup brushes", "zippers and fabric rustle", "hurried whispered directions", "countdown timer beeps"]
            elif any(w in desc_lower for w in ("street", "urban", "casual", "everyday")):
                aud = ["city sidewalk ambience", "café background chatter", "gentle indie music", "bicycle passing"]

        # Context-aware audio for action genre
        if genre == "action":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("car", "chase", "vehicle", "motorcycle", "race")):
                aud = ["engine roar and tire screech", "metal crunching", "wind rush at speed", "police siren"]
            elif any(w in desc_lower for w in ("explosion", "bomb", "blast", "fire")):
                aud = ["massive explosion boom", "debris raining", "crackling fire", "distant alarm"]
            elif any(w in desc_lower for w in ("run", "sprint", "escape", "parkour")):
                aud = ["pounding footsteps", "heavy breathing", "obstacles crashing", "adrenaline heartbeat"]

        # Context-aware audio for anime genre
        if genre == "anime":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("battle", "fight", "clash", "sword", "power")):
                aud = ["dramatic impact strike", "energy blast charge", "speed lines whoosh", "explosive power release"]
            elif any(w in desc_lower for w in ("school", "slice of life", "friendship", "cafe")):
                aud = ["cheerful school chime", "gentle wind chime", "soft piano melody", "cicada ambient"]
            elif any(w in desc_lower for w in ("mecha", "robot", "machine", "transform")):
                aud = ["hydraulic servo whir", "metal transformation clang", "energy core hum", "rocket thruster ignition"]

        # Context-aware audio for bollywood genre
        if genre == "bollywood":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("dance", "song", "celebration", "wedding", "festival")):
                aud = ["energetic dhol rhythm", "joyous crowd cheering", "jingling anklets", "festive shehnai"]
            elif any(w in desc_lower for w in ("romance", "love", "couple", "heart")):
                aud = ["romantic sitar melody", "soft flute", "gentle breeze", "heartfelt vocal hum"]
            elif any(w in desc_lower for w in ("fight", "action", "hero", "villain")):
                aud = ["dramatic tabla buildup", "punching impact", "roaring crowd", "heroic brass fanfare"]

        # Context-aware audio for comedy genre
        if genre == "comedy":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("slapstick", "fall", "trip", "crash", "slip")):
                aud = ["cartoonish boing sound", "slide whistle", "crash and clatter", "comedic timpani hit"]
            elif any(w in desc_lower for w in ("party", "celebration", "fun", "dance")):
                aud = ["upbeat party music", "crowd laughter", "popping confetti", "cheerful clinking glasses"]
            elif any(w in desc_lower for w in ("awkward", "cringe", "embarrass", "mistake")):
                aud = ["uncomfortable silence", "lone cricket chirp", "nervous cough", "record scratch"]

        # Context-aware audio for documentary genre
        if genre == "documentary":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("interview", "testimony", "witness", "speak")):
                aud = ["quiet room tone", "subtle ambient hum", "pen scratching paper", "contemplative pause"]
            elif any(w in desc_lower for w in ("archive", "historical", "footage", "photograph")):
                aud = ["film projector whir", "nostalgic orchestral", "crackling vinyl warmth", "typewriter distant"]
            elif any(w in desc_lower for w in ("nature", "wildlife", "animal", "landscape")):
                aud = ["natural wilderness ambience", "gentle wind", "distant birdsong", "water flowing"]

        # Context-aware audio for drama genre
        if genre == "drama":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("cry", "tear", "grief", "funeral", "loss")):
                aud = ["mournful cello solo", "gentle rain", "suppressed sobbing", "heavy silence"]
            elif any(w in desc_lower for w in ("confront", "argument", "anger", "shout")):
                aud = ["tense staccato strings", "door slamming", "sharp breath", "ringing silence after"]
            elif any(w in desc_lower for w in ("reunion", "embrace", "forgive", "joy")):
                aud = ["swelling warm strings", "relieved laughter", "gentle piano", "birdsong outside"]

        # Context-aware audio for ecommerce genre
        if genre == "ecommerce":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("unbox", "package", "deliver", "open")):
                aud = ["crisp box opening", "tissue paper rustling", "satisfying peel", "gentle reveal chime"]
            elif any(w in desc_lower for w in ("tech", "gadget", "phone", "laptop", "device")):
                aud = ["digital startup sound", "clean interface click", "subtle tech hum", "notification ping"]
            elif any(w in desc_lower for w in ("beauty", "cosmetic", "skincare", "makeup")):
                aud = ["glass bottle set down", "cream dispenser pump", "soft brush strokes", "elegant ambient"]

        # Context-aware audio for fantasy genre
        if genre == "fantasy":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("dragon", "fire", "flame", "breath")):
                aud = ["dragon roar", "fire crackling and whooshing", "wings beating powerfully", "trembling ground"]
            elif any(w in desc_lower for w in ("spell", "magic", "enchant", "wizard", "sorcerer")):
                aud = ["mystical energy crackle", "spell incantation hum", "arcane rune glow", "ethereal choir"]
            elif any(w in desc_lower for w in ("forest", "elf", "fairy", "woodland")):
                aud = ["enchanted forest ambience", "mystical wind chime", "fairy wings flutter", "ancient tree creaking"]

        # Context-aware audio for fight genre
        if genre == "fight":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("sword", "blade", "katana", "duel")):
                aud = ["steel clashing", "blade singing through air", "parry ring", "sheath slide"]
            elif any(w in desc_lower for w in ("martial", "kung fu", "karate", "kick", "punch")):
                aud = ["bone-cracking impact", "fabric snap from kick", "battle grunt", "body hitting mat"]
            elif any(w in desc_lower for w in ("gun", "shoot", "bullet", "sniper")):
                aud = ["gunshot crack and echo", "shell casing tinkle", "bullet whiz", "weapon reload click"]

        # Context-aware audio for food genre
        if genre == "food":
            desc_lower = description.lower()
            # Dessert topping/decoration (must come before baking check since
            # "cake" overlaps — "ganache on cake" ≠ "baking a cake")
            if any(w in desc_lower for w in ("ganache", "frosting", "glaze", "drizzle", "topping", "decorat")):
                aud = ["velvety ganache pouring smoothly", "spatula scraping bowl", "drip settling on surface", "gentle spread and settle"]
            elif any(w in desc_lower for w in ("chocolate", "truffle", "mousse", "fondue", "melt")):
                aud = ["rich chocolate melting slowly", "smooth pouring and swirl", "delicate crunch of cocoa shell", "satisfied sigh of indulgence"]
            elif any(w in desc_lower for w in ("bake", "oven", "bread", "pastry")):
                aud = ["oven door opening with heat rush", "bread crust crackling", "whisk in bowl", "timer ding"]
            elif any(w in desc_lower for w in ("cake", "cupcake", "pie", "tart")):
                aud = ["knife cutting through layers", "cream settling softly", "plate set down with care", "fork tines on porcelain"]
            elif any(w in desc_lower for w in ("grill", "barbecue", "flame", "sear", "steak")):
                aud = ["meat sizzling on grill", "fire crackling", "tongs clinking", "juices dripping"]
            elif any(w in desc_lower for w in ("noodle", "ramen", "soup", "broth", "pho", "udon", "pasta", "spaghetti")):
                aud = ["broth simmering gently", "chopsticks lifting noodles", "steam hissing upward", "slurping satisfaction"]
            elif any(w in desc_lower for w in ("drink", "cocktail", "pour", "coffee", "tea")):
                aud = ["liquid pouring over ice", "cocktail shaker rhythm", "espresso machine hiss", "cup set on saucer"]
            elif any(w in desc_lower for w in ("sushi", "nigiri", "sashimi", "maki")):
                aud = ["knife on cutting board", "rice pressing gently", "bamboo mat rolling", "wasabi dissolving in soy"]
            elif any(w in desc_lower for w in ("ice cream", "gelato", "sorbet", "scoop")):
                aud = ["scoop carving through frozen cream", "waffle cone crunch", "drip melting slowly", "spoon clinking on glass"]

        # Context-aware audio for horror genre
        if genre == "horror":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("ghost", "spirit", "haunt", "paranormal", "apparition")):
                aud = ["ethereal whisper", "cold wind through empty room", "flickering light buzz", "distant child laughter"]
            elif any(w in desc_lower for w in ("creature", "monster", "demon", "beast")):
                aud = ["guttural inhuman growl", "wet flesh tearing", "bones cracking", "slithering on stone"]
            elif any(w in desc_lower for w in ("forest", "woods", "cabin", "isolated")):
                aud = ["snapping twig", "owl hooting ominously", "wind howling through cracks", "distant wolf howl"]

        # Context-aware audio for kpop genre
        if genre == "kpop":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("dance", "choreograph", "practice", "routine")):
                aud = ["tight snare and bass hit", "sneakers squeaking on floor", "synchronized breath", "electronic buildup"]
            elif any(w in desc_lower for w in ("concert", "stage", "perform", "fan")):
                aud = ["massive crowd screaming", "bass-heavy concert speakers", "lightstick ocean shimmer", "fan chant rhythm"]
            elif any(w in desc_lower for w in ("mv", "video", "cinematic", "storyline")):
                aud = ["moody synth pad", "cinematic string transition", "bass drop with reverb", "atmospheric vocal sample"]

        # Context-aware audio for popscience genre
        if genre == "popscience":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("space", "star", "galaxy", "cosmos", "planet")):
                aud = ["cosmic deep space drone", "stellar wind whisper", "radio telescope signal", "gravitational wave pulse"]
            elif any(w in desc_lower for w in ("cell", "dna", "molecule", "atom", "micro")):
                aud = ["microscopic electrical hum", "cellular division pulse", "molecular bond snap", "electron orbit whir"]
            elif any(w in desc_lower for w in ("brain", "neuron", "synapse", "mind")):
                aud = ["neural firing crackle", "synapse connection spark", "brainwave oscillation", "thought pulse hum"]

        # Context-aware audio for sci_fi genre
        if genre == "sci_fi":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("space", "ship", "starship", "cockpit", "galaxy")):
                aud = ["engine hum and hull vibration", "beeping control panels", "airlock hiss", "hyperspace whoosh"]
            elif any(w in desc_lower for w in ("robot", "android", "ai", "cyber", "hologram")):
                aud = ["servo motor whir", "holographic projection buzz", "digital voice modulation", "circuit board hum"]
            elif any(w in desc_lower for w in ("dystopia", "ruins", "wasteland", "post-apocalyptic")):
                aud = ["desolate wind through ruins", "distant metallic grinding", "radiation detector clicks", "eerie silence"]

        # Context-aware audio for xianxia genre
        if genre == "xianxia":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("cultivation", "meditat", "qi", "breakthrough")):
                aud = ["spiritual energy gathering hum", "cosmic qi flow", "lotus chime", "celestial awakening chord"]
            elif any(w in desc_lower for w in ("sword", "battle", "fight", "combat", "duel")):
                aud = ["immortal sword singing", "qi explosion impact", "aerial combat whoosh", "spiritual weapon clash"]
            elif any(w in desc_lower for w in ("mountain", "sect", "temple", "palace")):
                aud = ["mountain mist wind", "temple bell resonance", "waterfall distant thunder", "ancient guqin melody"]

        # Context-aware audio for vfx genre
        if genre == "vfx":
            desc_lower = description.lower()
            if any(w in desc_lower for w in ("transform", "morph", "shape", "change")):
                aud = ["morphing stretch and snap", "particle dissolve shimmer", "transformation whoosh", "reality warp bass"]
            elif any(w in desc_lower for w in ("particle", "dissolve", "scatter", "shatter")):
                aud = ["glass shattering into particles", "energy scatter crackle", "digital disintegration", "reform crystalline chime"]
            elif any(w in desc_lower for w in ("reveal", "appear", "emerge", "materialize")):
                aud = ["magical reveal crescendo", "materialization hum", "light burst shimmer", "dramatic reveal hit"]

        # Camera arc templates — cinematically coherent progressions.
        # In cinema, cameras follow logical arcs (establish → track → close →
        # resolve) rather than random angles.  Each genre has 2-3 arcs; the
        # description hash selects which arc (variety) while each arc is
        # internally coherent (quality).  Falls back to hash-rotation for
        # genres without explicit arcs.
        _GENRE_CAMERA_ARCS: dict[str, list[list[str]]] = {
            "fight": [
                ["wide", "tracking", "closeup", "slow_motion"],
                ["low_angle", "quick_cut", "tracking", "closeup"],
                ["push_in", "whip_pan", "closeup", "pull_back"],
            ],
            "xianxia": [
                ["wide", "crane_up", "orbit", "slow_motion"],
                ["low_angle", "push_in", "closeup", "pull_back"],
            ],
            "ecommerce": [
                ["wide", "push_in", "closeup", "orbit"],
                ["tracking", "slow_zoom_in", "extreme_closeup", "pull_back"],
            ],
            "food": [
                ["wide", "push_in", "extreme_closeup", "slow_zoom_in"],
                ["tracking", "closeup", "extreme_closeup", "pull_back"],
            ],
            "drama": [
                ["medium", "push_in", "closeup", "pull_back"],
                ["wide", "rack_focus", "closeup", "pull_back"],
            ],
            "horror": [
                ["wide", "slow_zoom_in", "dutch_angle", "push_in"],
                ["tracking", "handheld", "closeup", "slow_zoom_in"],
                ["push_in", "dutch_angle", "closeup", "wide"],
            ],
            "nature": [
                ["aerial_descend", "tracking", "closeup", "wide"],
                ["wide", "slow_zoom_in", "tracking", "crane_up"],
                ["push_in", "tracking", "closeup", "pull_back"],
            ],
            "romance": [
                ["wide", "push_in", "closeup", "pull_back"],
                ["medium", "slow_zoom_in", "closeup", "orbit"],
                ["tracking", "rack_focus", "closeup", "pull_back"],
            ],
            "thriller": [
                ["wide", "slow_zoom_in", "push_in", "closeup"],
                ["tracking", "handheld", "dutch_angle", "closeup"],
                ["push_in", "rack_focus", "closeup", "pull_back"],
            ],
            "war": [
                ["wide", "tracking", "handheld", "closeup"],
                ["low_angle", "push_in", "tracking", "slow_motion"],
                ["crane_up", "handheld", "closeup", "wide"],
            ],
            "bollywood": [
                ["crane_up", "tracking", "closeup", "orbit"],
                ["wide", "push_in", "closeup", "pull_back"],
                ["low_angle", "whip_pan", "closeup", "crane_up"],
            ],
            "anime": [
                ["wide", "push_in", "closeup", "slow_motion"],
                ["low_angle", "tracking", "whip_pan", "closeup"],
                ["push_in", "quick_cut", "closeup", "crane_up"],
            ],
            "cyberpunk": [
                ["wide", "tracking", "push_in", "closeup"],
                ["low_angle", "dutch_angle", "tracking", "pull_back"],
                ["crane_up", "push_in", "closeup", "whip_pan"],
            ],
            "superhero": [
                ["wide", "low_angle", "tracking", "closeup"],
                ["crane_up", "push_in", "slow_motion", "wide"],
                ["low_angle", "whip_pan", "closeup", "pull_back"],
            ],
            "noir": [
                ["wide", "slow_zoom_in", "closeup", "pull_back"],
                ["push_in", "dutch_angle", "rack_focus", "tracking"],
                ["low_angle", "tracking", "closeup", "pull_back"],
            ],
            "western": [
                ["wide", "slow_zoom_in", "closeup", "wide"],
                ["tracking", "low_angle", "push_in", "pull_back"],
                ["pan", "push_in", "closeup", "wide"],
            ],
            "comedy": [
                ["medium", "push_in", "closeup", "pull_back"],
                ["wide", "quick_cut", "closeup", "whip_pan"],
            ],
            "documentary": [
                ["wide", "slow_zoom_in", "push_in", "pull_back"],
                ["tracking", "dolly_forward", "closeup", "wide"],
            ],
            "sci_fi": [
                ["wide", "push_in", "orbit", "pull_back"],
                ["tracking", "crane_up", "closeup", "low_angle"],
                ["low_angle", "push_in", "whip_pan", "pull_back"],
            ],
            "music_video": [
                ["wide", "tracking", "closeup", "crane_up"],
                ["low_angle", "whip_pan", "closeup", "quick_cut"],
                ["push_in", "tracking", "closeup", "pull_back"],
            ],
            "underwater": [
                ["wide", "slow_zoom_in", "tracking", "crane_down"],
                ["push_in", "orbit", "closeup", "pull_back"],
            ],
            "fairy_tale": [
                ["wide", "crane_up", "tracking", "push_in"],
                ["slow_zoom_in", "orbit", "closeup", "pull_back"],
            ],
            "dance": [
                ["wide", "tracking", "low_angle", "slow_motion"],
                ["push_in", "whip_pan", "closeup", "crane_up"],
                ["tracking", "quick_cut", "closeup", "pull_back"],
            ],
            "travel": [
                ["aerial_descend", "tracking", "push_in", "wide"],
                ["wide", "slow_zoom_in", "tracking", "crane_up"],
                ["pan", "push_in", "closeup", "pull_back"],
            ],
            "fashion": [
                ["wide", "tracking", "closeup", "pull_back"],
                ["low_angle", "push_in", "orbit", "slow_zoom_in"],
            ],
            "sports": [
                ["wide", "tracking", "closeup", "slow_motion"],
                ["low_angle", "whip_pan", "closeup", "crane_up"],
                ["handheld", "tracking", "slow_motion", "wide"],
            ],
            "vfx": [
                ["wide", "push_in", "orbit", "pull_back"],
                ["tracking", "zoom", "closeup", "slow_motion"],
            ],
            "cinematic": [
                ["aerial_descend", "tracking", "push_in", "pull_back"],
                ["wide", "dolly_forward", "closeup", "crane_up"],
                ["establishing", "slow_zoom_in", "tracking_right", "pull_back"],
            ],
        }

        import hashlib
        desc_hash = int(hashlib.md5(description.encode()).hexdigest(), 16)

        # Context-aware arc preference — when the description contains
        # keywords that imply a specific visual style (chase → tracking,
        # meditation → slow zoom, reveal → pull_back), prefer arcs that
        # contain matching camera labels instead of pure hash selection.
        _ARC_KEYWORD_PREFS: dict[str, list[str]] = {
            "chase": ["tracking", "handheld", "whip_pan"],
            "run": ["tracking", "handheld"],
            "pursuit": ["tracking", "handheld", "whip_pan"],
            "escape": ["tracking", "handheld"],
            "gallop": ["tracking", "handheld"],
            "sprint": ["tracking", "handheld"],
            "meditation": ["slow_zoom_in", "push_in"],
            "still": ["slow_zoom_in", "medium"],
            "contemplat": ["slow_zoom_in", "push_in"],
            "quiet": ["slow_zoom_in", "medium", "push_in"],
            "serene": ["slow_zoom_in", "crane_up"],
            "aerial": ["aerial_descend", "crane_up", "wide"],
            "above": ["crane_up", "aerial_descend"],
            "panoram": ["pan", "wide", "crane_up"],
            "skyline": ["crane_up", "wide", "pan"],
            "face": ["closeup", "push_in", "rack_focus"],
            "detail": ["closeup", "push_in"],
            "eyes": ["closeup", "push_in", "slow_zoom_in"],
            "whisper": ["closeup", "push_in"],
            "intimate": ["closeup", "push_in", "rack_focus"],
            "reveal": ["pull_back", "crane_up", "wide"],
            "discover": ["push_in", "tracking"],
            "unveil": ["pull_back", "crane_up"],
            "battle": ["tracking", "handheld", "low_angle"],
            "clash": ["tracking", "low_angle"],
            "explosion": ["wide", "handheld", "tracking"],
            "standoff": ["wide", "slow_zoom_in", "push_in"],
            "duel": ["tracking", "push_in", "closeup"],
        }

        arcs = _GENRE_CAMERA_ARCS.get(genre)
        if arcs:
            # Collect preferred camera labels from description keywords
            desc_lower = description.lower()
            preferred: list[str] = []
            for kw, labels in _ARC_KEYWORD_PREFS.items():
                if kw in desc_lower:
                    preferred.extend(labels)

            if preferred and len(arcs) > 1:
                # Score each arc by how many preferred labels it contains
                pref_set = set(preferred)
                scored = [
                    (sum(1 for label in arc if label in pref_set), i, arc)
                    for i, arc in enumerate(arcs)
                ]
                best_score = max(s[0] for s in scored)
                if best_score > 0:
                    # Among highest-scoring arcs, use hash for determinism
                    best_arcs = [s[2] for s in scored if s[0] == best_score]
                    cam = best_arcs[desc_hash % len(best_arcs)]
                else:
                    # No keyword match — fall back to hash selection
                    cam = arcs[desc_hash % len(arcs)]
            else:
                # Single arc or no keywords — hash selection
                cam = arcs[desc_hash % len(arcs)]
        elif len(cam) > 1:
            # Fallback: rotate for genres without explicit arcs
            rotation = desc_hash % len(cam)
            cam = cam[rotation:] + cam[:rotation]

        # Fallback descriptions for extracted camera labels not in CAMERA_VOCABULARY
        _EXTRACTED_CAM_LABELS: dict[str, str] = {
            "pan": "Camera pans across the scene",
            "tilt": "Camera tilts to reveal the subject",
            "zoom": "Camera zooms dramatically",
            "slow_motion": "Slow-motion cinematic shot",
            "freeze_frame": "Freeze frame dramatic pause",
            "quick_cut": "Quick cut to new angle",
            "hard_cut": "Hard cut transition",
            "fade": "Smooth fade transition",
            "fisheye": "Fisheye lens distortion shot",
            "first_person": "First-person perspective shot",
            "tracking": "Camera tracks alongside the action",
            "crane_up": "Camera cranes upward for dramatic reveal",
            "crane_down": "Camera descends from above",
        }

        # Genre-contextual camera overrides — more specific than generic CAMERA_VOCABULARY
        _GENRE_CAM_OVERRIDES: dict[str, dict[str, str]] = {
            "fight": {
                "closeup": "Intense close-up capturing the fighter's expression and sweat",
                "low_angle": "Low angle heroic shot looking up at the warrior mid-strike",
                "tracking": "Tracking shot following the fight choreography laterally",
                "slow_motion": "Dramatic slow-motion capturing the impact of the blow",
                "quick_cut": "Rapid cut to a new intense angle mid-combat",
                "push_in": "Camera aggressively pushes toward the action",
                "pan": "Camera sweeps across the battleground following the fighters",
                "wide": "Wide shot revealing the full combat arena and fighters' distance",
                "zoom": "Dramatic zoom onto the decisive strike",
            },
            "xianxia": {
                "closeup": "Mystical close-up revealing glowing energy in the eyes",
                "low_angle": "Reverent low angle as celestial power emanates upward",
                "crane_up": "Majestic crane rising to reveal ethereal landscape",
                "orbit": "Camera spirals around the cultivator mid-technique",
                "push_in": "Camera drifts forward through swirling spiritual energy",
                "wide": "Epic wide shot revealing the mythical landscape in its grandeur",
                "pan": "Camera sweeps across the celestial realm",
            },
            "ecommerce": {
                "closeup": "Tight product close-up showcasing texture and detail",
                "orbit": "Camera glides smoothly around the product at eye level",
                "push_in": "Camera draws closer revealing premium material quality",
                "tracking": "Smooth lateral tracking past the product showcase",
                "slow_zoom_in": "Elegant slow zoom highlighting the product finish",
                "quick_cut": "Sharp editorial cut revealing the product from a new angle",
                "pan": "Camera pans across the premium product lineup",
                "wide": "Elegant wide shot of the product in its curated setting",
            },
            "food": {
                "wide": "Appetizing wide shot of the beautifully plated dish in its warm setting",
                "extreme_closeup": "Extreme macro capturing steam rising and sauce glistening",
                "slow_zoom_in": "Appetizing slow zoom revealing layers of texture",
                "tracking": "Camera glides past dishes at table level",
                "push_in": "Camera pushes in toward the sizzling surface",
                "zoom": "Mouth-watering zoom capturing every appetizing detail",
                "closeup": "Tight close-up on the food surface showing texture and steam",
                "pull_back": "Camera pulls back revealing the full spread on the table",
            },
            "popscience": {
                "push_in": "Camera dives into the microscopic world",
                "zoom": "Dramatic zoom into molecular-scale detail",
                "orbit": "Camera rotates around the scientific visualization",
                "tracking": "Camera tracks along the cellular structure",
            },
            "fantasy": {
                "closeup": "Dramatic close-up as magical energy crackles",
                "low_angle": "Awe-inspiring low angle gazing up at the imposing subject",
                "crane_up": "Camera soars upward revealing the mythical landscape",
                "orbit": "Camera circles the magical phenomenon",
                "push_in": "Camera pushes through enchanted mist toward the subject",
                "wide": "Epic wide establishing the fantastical realm",
            },
            "kpop": {
                "low_angle": "Dynamic low angle capturing the dancer mid-move",
                "tracking": "Energetic tracking following the choreography",
                "quick_cut": "Sharp cut synced to the beat drop",
                "whip_pan": "Snappy whip pan between performers",
                "first_person": "POV shot moving through the dance formation",
                "closeup": "Stylized close-up on the dancer's expression under neon lights",
                "pan": "Smooth pan across the dance crew in formation",
            },
            "action": {
                "tracking": "High-speed tracking alongside the moving subject",
                "handheld": "Raw handheld camera matching the chaotic energy",
                "whip_pan": "Explosive whip pan between action beats",
                "low_angle": "Powerful low angle as the subject charges forward",
                "pan": "Rapid pan following the high-speed action across the frame",
                "closeup": "Adrenaline-fueled close-up on the subject mid-action",
                "wide": "Wide shot capturing the full explosive action sequence",
                "zoom": "Dramatic crash zoom into the action",
            },
            "horror": {
                "slow_zoom_in": "Unsettling slow zoom creeping toward the subject",
                "dutch_angle": "Disorienting Dutch angle as reality warps",
                "handheld": "Trembling handheld as if the camera operator is afraid",
                "push_in": "Camera inches forward into the oppressive darkness",
                "closeup": "Dread-filled close-up on the terrified face",
                "pan": "Camera slowly pans through the desolate scene",
                "wide": "Isolating wide shot emphasizing vulnerability",
                "tracking": "Camera stalks forward through the corridor",
            },
            "drama": {
                "closeup": "Intimate close-up capturing raw emotion on the face",
                "push_in": "Camera slowly pushes in during the emotional beat",
                "pull_back": "Camera gently pulls back revealing isolation",
                "rack_focus": "Focus shifts between characters mid-dialogue",
                "wide": "Wide establishing shot framing the emotional weight of the scene",
                "medium": "Medium shot balancing intimacy with the surrounding tension",
            },
            "nature": {
                "aerial_descend": "Sweeping aerial descent toward the wildlife habitat",
                "slow_zoom_in": "Patient zoom drawing into the animal's world",
                "tracking": "Camera tracks alongside the creature in natural motion",
                "crane_up": "Camera rises to reveal the vast natural landscape",
                "wide": "Wide establishing shot of the untouched wilderness",
                "push_in": "Camera glides forward into the heart of the habitat",
                "closeup": "Ultra-close macro revealing nature's intricate detail",
            },
            "documentary": {
                "wide": "Wide observational shot establishing the documentary setting and context",
                "slow_zoom_in": "Observational slow zoom into the subject",
                "dolly_forward": "Deliberate dolly forward through the scene",
                "push_in": "Camera steadily approaches the evidence",
                "tracking": "Camera follows the narrative through the space",
                "pull_back": "Camera pulls back revealing the full context",
            },
            "sci_fi": {
                "wide": "Vast wide shot revealing the immense scale of the futuristic environment",
                "push_in": "Camera pushes through the high-tech corridor toward the glowing core",
                "tracking": "Camera tracks alongside the moving vessel through the digital landscape",
                "crane_up": "Camera rises to reveal the massive futuristic structure",
                "orbit": "Camera orbits the hovering technology, holographic data streaming",
                "low_angle": "Low angle looking up at the towering mech or spacecraft",
                "whip_pan": "Rapid pan between control panels and the viewport",
                "pull_back": "Camera pulls back revealing the vast scale of the sci-fi environment",
            },
            "bollywood": {
                "crane_up": "Grand crane rising to reveal the spectacular setting",
                "orbit": "Camera sweeps around the character with flowing fabric and golden light",
                "tracking": "Smooth tracking alongside the dramatic gesture",
                "low_angle": "Heroic low angle emphasizing grandeur and power",
                "whip_pan": "Dramatic whip pan to reveal the emotional counterpart",
                "push_in": "Camera glides forward capturing the intense emotional expression",
                "closeup": "Intimate close-up on expressive eyes, tears glistening",
            },
            "sports": {
                "tracking": "Camera tracks alongside the athlete at full sprint speed",
                "slow_motion": "Ultra slow-motion capturing the peak athletic moment",
                "wide": "Wide stadium shot capturing the full athletic arena and crowd",
                "low_angle": "Powerful low angle looking up at the athlete mid-leap",
                "whip_pan": "Rapid whip pan following the ball across the field",
                "closeup": "Intense close-up on the athlete's focused expression, sweat glistening",
                "crane_up": "Camera rises to reveal the packed stadium and roaring crowd",
                "handheld": "Raw courtside handheld capturing the intensity of competition",
            },
            "anime": {
                "wide": "Epic wide anime shot establishing the dramatic landscape and characters",
                "push_in": "Camera rushes forward through dramatic speed lines",
                "tracking": "Dynamic tracking following the character mid-action with motion blur",
                "low_angle": "Dramatic low angle with power aura radiating from the character",
                "whip_pan": "Lightning-fast whip pan between characters in confrontation",
                "closeup": "Intense close-up on determined eyes with dramatic reflection",
                "crane_up": "Camera soars upward revealing the epic anime landscape",
                "quick_cut": "Rapid cut matching the beat of the dramatic soundtrack",
            },
            "romance": {
                "wide": "Soft wide shot of the romantic setting, warm light and gentle atmosphere",
                "push_in": "Camera drifts gently closer as the intimate moment deepens",
                "slow_zoom_in": "Dreamy slow zoom drawing into the lovers' world",
                "orbit": "Camera floats around the couple, soft golden light wrapping them",
                "rack_focus": "Focus shifts tenderly between the two faces in conversation",
                "closeup": "Intimate close-up on eyes meeting, soft-focus background",
                "pull_back": "Camera pulls back revealing the romantic setting around the couple",
                "tracking": "Gentle tracking alongside the couple as they walk together",
                "medium": "Medium two-shot framing the couple in warm intimate composition",
            },
            "thriller": {
                "wide": "Tense wide shot establishing the space where danger lurks unseen",
                "slow_zoom_in": "Agonizingly slow zoom building unbearable tension",
                "push_in": "Camera creeps forward toward the subject, tension mounting",
                "tracking": "Camera stalks the subject through dimly lit corridors",
                "handheld": "Shaky handheld conveying panic and urgency",
                "dutch_angle": "Disorienting Dutch angle as the situation tilts out of control",
                "rack_focus": "Focus snaps between the threat and the protagonist's reaction",
                "pull_back": "Camera slowly pulls back revealing the trap closing in",
            },
            "comedy": {
                "wide": "Wide comedic establishing shot setting up the scene for the gag",
                "medium": "Medium shot framing the comedic reaction perfectly",
                "quick_cut": "Snap cut to the hilarious reveal at the perfect moment",
                "push_in": "Camera pushes in on the character's dawning realization",
                "whip_pan": "Whip pan to the unexpected punchline source",
                "closeup": "Close-up capturing the exaggerated facial reaction",
                "tracking": "Camera follows the character stumbling through the scene",
                "pull_back": "Camera pulls back revealing the absurd full picture",
            },
            "war": {
                "tracking": "Camera charges forward alongside soldiers under fire",
                "handheld": "Visceral handheld shaking with each nearby explosion",
                "low_angle": "Heroic low angle looking up at soldiers advancing through smoke",
                "crane_up": "Camera rises above the battlefield revealing the scale of combat",
                "push_in": "Camera pushes through smoke and debris toward the frontline",
                "wide": "Wide shot of the full battlefield, explosions and troop movement",
                "slow_motion": "Dramatic slow-motion capturing the soldier's determined expression",
            },
            "historical": {
                "crane_up": "Majestic crane rising to reveal the grand historical setting",
                "slow_zoom_in": "Reverent slow zoom drawing closer to the subject with solemnity",
                "tracking": "Camera glides through the period setting, details emerging",
                "wide": "Sweeping wide shot establishing the period landscape",
                "push_in": "Camera advances solemnly toward the central figure",
                "low_angle": "Imposing low angle looking up at the subject against the sky",
                "pull_back": "Camera pulls back revealing the full grandeur of the era",
            },
            "western": {
                "wide": "Vast wide shot of the frontier landscape, figure silhouetted on horizon",
                "tracking": "Camera rides alongside the galloping horse through dusty terrain",
                "slow_zoom_in": "Tense slow zoom toward the gunslinger's narrowing eyes",
                "low_angle": "Dramatic low angle looking up at the lone figure against the sky",
                "push_in": "Camera pushes down the empty main street toward the standoff",
                "pan": "Sweeping pan across the sprawling desert canyon or frontier town",
                "pull_back": "Camera pulls back revealing the solitary figure against vast wilderness",
            },
            "cyberpunk": {
                "push_in": "Camera pushes through rain-slicked neon streets toward the subject",
                "tracking": "Camera tracks alongside the figure through holographic advertisements",
                "low_angle": "Low angle looking up at towering megacity spires, neon reflections",
                "dutch_angle": "Disorienting Dutch angle in the chaotic neon-lit underworld",
                "crane_up": "Camera rises through layers of the megacity, neon fading to smog",
                "whip_pan": "Rapid whip pan between neon signs and chrome-augmented faces",
                "pull_back": "Camera pulls back revealing the sprawling dystopian cityscape",
            },
            "music_video": {
                "wide": "Wide performance shot capturing the full stage, lights, and crowd energy",
                "tracking": "Dynamic tracking following the performer across the stage",
                "low_angle": "Power low angle looking up at the performer under spotlight beams",
                "whip_pan": "Energetic whip pan between band members mid-performance",
                "crane_up": "Camera soars above the crowd revealing the massive concert stage",
                "quick_cut": "Beat-synced cut to a new dramatic performance angle",
                "push_in": "Camera pushes toward the vocalist during the emotional crescendo",
                "closeup": "Intimate close-up on the performer's passionate expression",
            },
            "superhero": {
                "low_angle": "Heroic low angle looking up at the hero, cape billowing against the sky",
                "tracking": "Camera tracks alongside the hero at superhuman speed",
                "crane_up": "Camera soars upward following the hero's ascent into the sky",
                "push_in": "Camera charges toward the hero during the power-up moment",
                "slow_motion": "Epic slow-motion hero landing, ground cracking under the impact",
                "wide": "Wide shot revealing the hero silhouetted against the devastated cityscape",
                "whip_pan": "Explosive whip pan from hero to the incoming threat",
            },
            "noir": {
                "wide": "Atmospheric wide shot of the rain-soaked noir cityscape, shadows and neon",
                "slow_zoom_in": "Slow ominous zoom through venetian blind shadows toward the detective's face",
                "push_in": "Camera pushes through cigarette smoke toward the shadowy figure",
                "dutch_angle": "Tilted Dutch angle capturing the moral corruption of the scene",
                "tracking": "Camera follows the lone figure through rain-slicked streets under neon",
                "low_angle": "Low angle looking up at the imposing figure silhouetted by streetlight",
                "pull_back": "Camera pulls away revealing the full scene of the crime",
                "rack_focus": "Focus shifts from the gun on the desk to the suspect across the room",
                "closeup": "Tight close-up through shadow bars, half the face lit, half in darkness",
            },
            "underwater": {
                "slow_zoom_in": "Gentle zoom toward the marine creature, light refracting through water",
                "tracking": "Camera glides alongside the school of fish through the coral canyon",
                "crane_down": "Camera descends through shafts of light into the deep blue abyss",
                "push_in": "Camera pushes forward through kelp forest curtains toward the hidden subject",
                "orbit": "Camera circles the magnificent sea creature in a graceful arc",
                "pull_back": "Camera drifts backward revealing the vast underwater panorama",
                "low_angle": "Looking upward through crystal water toward the sun-dappled surface",
            },
            "fairy_tale": {
                "crane_up": "Camera rises above the enchanted forest canopy into golden storybook light",
                "tracking": "Camera follows the adventurer down the cobblestone path through magical woodland",
                "push_in": "Camera floats forward through the ornate castle gate into the grand hall",
                "slow_zoom_in": "Gentle zoom toward the glowing magical artifact resting on its pedestal",
                "orbit": "Camera circles the enchanted clearing where fireflies dance in the air",
                "wide": "Wide establishing shot of the fairy-tale kingdom with castle spires and rolling hills",
                "pull_back": "Camera pulls back through the storybook frame, revealing the illustration come to life",
            },
            "dance": {
                "wide": "Wide stage shot capturing the full choreography, formations, and lighting",
                "tracking": "Dynamic tracking alongside the dancer as they move across the stage",
                "low_angle": "Power low angle capturing the dancer's leap against stage lights",
                "whip_pan": "Energetic whip pan following the rapid change of formation",
                "crane_up": "Camera rises above the dance floor revealing the full choreography",
                "slow_motion": "Slow-motion capturing the peak of the athletic movement",
                "quick_cut": "Beat-matched cut to a new dynamic angle of the performance",
                "push_in": "Camera pushes toward the dancer during the climactic move",
            },
            "travel": {
                "aerial_descend": "Sweeping drone descent toward the destination landmark below",
                "tracking": "Camera glides alongside the traveler through the vibrant locale",
                "crane_up": "Camera rises above the landscape revealing the panoramic destination view",
                "slow_zoom_in": "Contemplative zoom toward the cultural landmark or natural wonder",
                "push_in": "Camera pushes forward through the bustling local marketplace",
                "wide": "Vast wide shot establishing the breathtaking destination landscape",
                "pan": "Smooth panoramic pan across the scenic vista or historic skyline",
            },
            "fashion": {
                "wide": "Elegant wide shot of the runway setting, models and audience framed perfectly",
                "tracking": "Smooth tracking alongside the model as she strides down the runway",
                "slow_zoom_in": "Elegant zoom toward the intricate fabric detail and craftsmanship",
                "push_in": "Camera glides forward toward the model's dramatic pose",
                "low_angle": "Power angle looking up at the model silhouetted against stage lights",
                "orbit": "Camera circles the model, capturing the garment from every angle",
                "closeup": "Intimate close-up on the luxurious texture and accessory detail",
                "pull_back": "Camera pulls back revealing the full runway look from head to toe",
            },
            "vfx": {
                "wide": "Wide establishing shot before the visual effect transforms the entire scene",
                "push_in": "Camera pushes forward through the transforming visual effect",
                "zoom": "Dramatic zoom into the center of the particle effect",
                "orbit": "Camera orbits the morphing subject as it transforms",
                "tracking": "Camera tracks alongside the wave of visual transformation",
                "slow_motion": "Ultra slow-motion capturing each particle and energy strand",
                "quick_cut": "Sharp cut to reveal the next stage of the transformation",
                "pull_back": "Camera pulls back revealing the full scale of the VFX spectacle",
            },
            "cinematic": {
                "wide": "Grand cinematic wide shot establishing the majestic scope of the scene",
                "aerial_descend": "Sweeping aerial descent toward the landscape",
                "dolly_forward": "Smooth dolly forward through the cinematic environment",
                "crane_up": "Majestic crane rising to reveal the panoramic vista",
                "push_in": "Elegant camera glide forward into the scene",
                "establishing": "Grand establishing shot setting scale and atmosphere",
                "slow_zoom_in": "Slow cinematic zoom drawing the eye into the scene",
                "tracking_right": "Smooth tracking shot gliding laterally through the environment",
                "pull_back": "Camera gracefully pulls back revealing the epic scope",
            },
        }

        # Map camera labels to descriptive phrases (genre-specific when available)
        from seedance_prompt_builder import CAMERA_VOCABULARY
        genre_overrides = _GENRE_CAM_OVERRIDES.get(genre, {})

        # Context-aware camera description overrides — nature genre defaults
        # mention "creature"/"animal"/"wildlife habitat" which are wrong for
        # landscape nature scenes.  Merge sub-genre camera descriptions when
        # description keywords match.
        _CAMERA_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], dict[str, str]]]] = {
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight", "uppercut", "knockout"], {
                    "tracking": "Camera circles ringside tracking the boxer's footwork",
                    "slow_motion": "Ultra slow-motion capturing the punch impact and sweat spray",
                    "wide": "Wide ring shot capturing both fighters and the roaring crowd",
                    "low_angle": "Powerful low angle through the ropes looking up at the fighter",
                    "whip_pan": "Rapid whip pan between fighters exchanging blows",
                    "closeup": "Intense close-up on the fighter's battered face, sweat flying",
                    "crane_up": "Camera rises above the ring revealing the packed arena",
                    "handheld": "Raw ringside handheld capturing the visceral impact of each blow",
                }),
                (["wrestling", "mma", "grapple", "takedown", "octagon", "cage"], {
                    "tracking": "Camera tracks around the cage following the fighters",
                    "slow_motion": "Slow-motion capturing the submission hold or takedown",
                    "wide": "Wide octagon shot capturing the full fight and crowd reaction",
                    "low_angle": "Low angle from mat level looking up at the dominant fighter",
                    "handheld": "Cageside handheld capturing the brutal intensity",
                    "closeup": "Tight close-up on the fighter's strained expression during grapple",
                }),
                (["swimming", "diving", "surfing", "water polo", "pool"], {
                    "tracking": "Underwater tracking alongside the swimmer's powerful strokes",
                    "slow_motion": "Ultra slow-motion capturing the dive entry or wave ride",
                    "wide": "Wide pool shot from above capturing all lanes and the race",
                    "low_angle": "Low angle from water level looking up at the diver mid-air",
                    "push_in": "Camera pushes toward the swimmer's reach for the wall",
                }),
                (["soccer", "football", "goal", "pitch", "stadium"], {
                    "tracking": "Camera tracks alongside the player sprinting down the pitch",
                    "whip_pan": "Rapid whip pan following the ball across the field",
                    "wide": "Wide stadium shot capturing the full pitch and roaring crowd",
                    "crane_up": "Camera rises to reveal the massive stadium atmosphere",
                    "handheld": "Raw pitch-side handheld capturing the goal celebration",
                }),
                (["tennis", "racket", "serve", "rally"], {
                    "tracking": "Camera tracks the baseline movement during the rally",
                    "slow_motion": "Ultra slow-motion capturing racket striking the ball",
                    "wide": "Wide court shot capturing both players and the net",
                    "whip_pan": "Rapid whip pan following the ball across the court",
                }),
                (["racing", "formula", "motorsport", "car", "motorcycle"], {
                    "tracking": "Camera tracks alongside the car at breakneck speed",
                    "whip_pan": "Blistering whip pan as vehicles streak past the camera",
                    "wide": "Wide circuit shot from above capturing the pack of racers",
                    "low_angle": "Low angle from trackside as the car screams past",
                    "handheld": "In-car onboard camera capturing the driver's perspective",
                }),
            ],
            "nature": [
                (["ocean", "sea", "wave", "reef", "coast", "beach", "shore",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], {
                    "aerial_descend": "Sweeping aerial descent toward the ocean's expanse",
                    "slow_zoom_in": "Patient zoom drawing into the wave's curling power",
                    "tracking": "Camera tracks alongside the surging coastline",
                    "push_in": "Camera glides forward into the heart of the breaking waves",
                }),
                (["mountain", "peak", "summit", "cliff", "alpine"], {
                    "aerial_descend": "Sweeping aerial descent toward the mountain range",
                    "slow_zoom_in": "Patient zoom drawing into the rugged alpine terrain",
                    "tracking": "Camera tracks along the mountain ridge line",
                    "push_in": "Camera glides forward into the mountain's dramatic face",
                }),
                (["desert", "sand", "dune", "sahara", "arid"], {
                    "aerial_descend": "Sweeping aerial descent over the vast desert expanse",
                    "slow_zoom_in": "Patient zoom drawing into the wind-sculpted dune formations",
                    "tracking": "Camera tracks across the shifting desert landscape",
                    "push_in": "Camera glides forward through the heat-shimmer horizon",
                }),
                (["forest", "tree", "trees", "jungle", "rainforest", "woodland"], {
                    "aerial_descend": "Sweeping aerial descent through the forest canopy",
                    "slow_zoom_in": "Patient zoom drawing into the dappled woodland interior",
                    "tracking": "Camera tracks through the forest path between ancient trunks",
                    "push_in": "Camera glides forward into the heart of the ancient grove",
                }),
                (["rain", "storm", "lightning", "thunder"], {
                    "aerial_descend": "Sweeping aerial descent through the gathering storm clouds",
                    "slow_zoom_in": "Patient zoom drawing into the storm's electrifying core",
                    "tracking": "Camera tracks alongside the advancing storm front",
                    "push_in": "Camera pushes forward into the wall of rain and wind",
                }),
                (["waterfall", "cascade", "river", "rapids"], {
                    "aerial_descend": "Sweeping aerial descent toward the cascading waters",
                    "slow_zoom_in": "Patient zoom drawing into the thundering water flow",
                    "tracking": "Camera tracks alongside the rushing current",
                    "push_in": "Camera glides forward into the mist of the falls",
                }),
                (["volcano", "lava", "eruption", "volcanic"], {
                    "aerial_descend": "Sweeping aerial descent toward the volcanic crater",
                    "slow_zoom_in": "Patient zoom drawing into the molten landscape",
                    "tracking": "Camera tracks alongside the flowing lava river",
                    "push_in": "Camera pushes forward toward the erupting caldera",
                }),
                (["aurora", "northern lights", "borealis", "starry", "milky way"], {
                    "aerial_descend": "Sweeping aerial descent beneath the celestial display",
                    "slow_zoom_in": "Patient zoom drawing into the luminous sky phenomenon",
                    "tracking": "Camera tracks across the dancing celestial lights",
                    "push_in": "Camera tilts upward into the vast shimmering sky",
                }),
            ],
            "horror": [
                (["haunted", "mansion", "castle", "gothic", "house"], {
                    "tracking": "Camera creeps through the decaying corridor, shadows shifting",
                    "slow_zoom_in": "Agonizingly slow zoom toward the dark doorway ahead",
                    "push_in": "Camera pushes forward into the blackness beyond the threshold",
                    "wide": "Wide establishing shot of the isolated structure against a sick sky",
                    "handheld": "Unsteady found-footage handheld stumbling through darkness",
                    "low_angle": "Low angle looking up at the looming decrepit staircase",
                }),
                (["forest", "woods", "cabin", "swamp", "fog"], {
                    "tracking": "Camera weaves between gnarled trees, something moving in the periphery",
                    "slow_zoom_in": "Creeping zoom into the fog-choked clearing ahead",
                    "push_in": "Camera drifts forward through mist-wrapped dead branches",
                    "wide": "Wide shot of the figure dwarfed by the oppressive forest",
                    "handheld": "Frantic handheld crashing through underbrush in the dark",
                }),
                (["hospital", "asylum", "corridor", "institution"], {
                    "tracking": "Camera glides down the sterile corridor, flickering lights ahead",
                    "slow_zoom_in": "Clinical zoom toward the figure at the end of the hallway",
                    "push_in": "Camera pushes through the swinging ward doors into darkness",
                    "wide": "Wide shot of the empty institutional hallway stretching to infinity",
                }),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], {
                    "tracking": "Camera weaves through the neon-drenched street crowd",
                    "push_in": "Camera pushes forward through holographic advertisements and rain",
                    "wide": "Wide shot of the sprawling neon cityscape from street level",
                    "low_angle": "Low angle looking up through rain at towering neon signage",
                    "handheld": "Gritty handheld following the figure through the packed market",
                }),
                (["rooftop", "skyline", "tower", "aerial"], {
                    "aerial_descend": "Swooping descent between megastructure towers into neon haze below",
                    "tracking": "Camera tracks along the rooftop edge, city sprawling below",
                    "wide": "Vast wide shot of the endless neon city grid to the horizon",
                    "push_in": "Camera pushes forward off the rooftop edge into the city abyss",
                }),
                (["club", "rave", "underground", "bar"], {
                    "tracking": "Camera moves through pulsing laser beams and chrome surfaces",
                    "push_in": "Camera pushes through the crowd toward the neon-lit stage",
                    "handheld": "Visceral handheld caught in the strobe-lit energy of the crowd",
                    "low_angle": "Low angle from the dance floor looking up at holographic displays",
                }),
            ],
            "war": [
                (["trench", "foxhole", "bunker", "barricade", "frontline"], {
                    "tracking": "Camera moves low through the mud-caked trench, soldiers crouching",
                    "push_in": "Camera pushes forward over the trench lip into no-man's-land",
                    "wide": "Wide shot of the desolate battlefield stretching to the horizon",
                    "handheld": "Raw combat handheld ducking through incoming fire and debris",
                    "low_angle": "Low angle from the trench floor looking up at soldiers and sky",
                }),
                (["aerial", "sky", "plane", "bomber", "helicopter"], {
                    "tracking": "Camera tracks alongside the aircraft banking through flak",
                    "wide": "Wide aerial shot of the battlefield from altitude, smoke columns below",
                    "push_in": "Camera pushes forward from cockpit perspective toward the target",
                }),
                (["naval", "ship", "submarine", "destroyer", "sea"], {
                    "tracking": "Camera tracks along the warship's hull as waves crash against it",
                    "wide": "Wide shot of the naval fleet spread across the grey horizon",
                    "push_in": "Camera pushes forward through spray toward the enemy vessel",
                    "low_angle": "Low angle from the waterline looking up at the massive hull",
                }),
            ],
            "romance": [
                (["rain", "storm", "umbrella", "downpour"], {
                    "tracking": "Camera circles slowly around the couple in the rain",
                    "slow_zoom_in": "Gentle zoom drawing closer to the rain-soaked embrace",
                    "push_in": "Camera drifts forward through falling rain toward the couple",
                    "wide": "Wide shot of two silhouettes under an umbrella in the downpour",
                }),
                (["beach", "seaside", "sunset", "shore", "ocean"], {
                    "tracking": "Camera tracks alongside the couple walking the shoreline at sunset",
                    "slow_zoom_in": "Warm zoom drawing closer as golden light wraps the couple",
                    "wide": "Wide shot of the couple silhouetted against the ocean sunset",
                    "push_in": "Camera drifts forward through warm golden haze toward the couple",
                }),
                (["garden", "meadow", "flower", "blossom", "park"], {
                    "tracking": "Camera glides through blossoms following the couple's path",
                    "slow_zoom_in": "Gentle zoom through soft-focus petals toward the intimate moment",
                    "wide": "Wide shot of the couple in the sunlit garden, petals drifting",
                    "crane_up": "Camera rises through the flowers revealing the couple below",
                }),
                (["city", "rooftop", "skyline", "balcony", "bridge"], {
                    "tracking": "Camera circles the couple against the glittering city backdrop",
                    "slow_zoom_in": "Intimate zoom with city bokeh blurring into soft light",
                    "wide": "Wide shot of the couple framed by the illuminated skyline",
                }),
            ],
            "food": [
                (["sushi", "japanese", "ramen", "sashimi", "knife"], {
                    "slow_zoom_in": "Precise zoom drawing into the chef's meticulous knife work",
                    "tracking": "Camera glides along the immaculate counter of glistening preparations",
                    "push_in": "Camera pushes toward the finished plate, every grain visible",
                    "closeup": "Extreme macro on the jewel-like surface of the fresh cut",
                }),
                (["steak", "grill", "bbq", "flame", "sear"], {
                    "slow_zoom_in": "Hungry zoom into the sizzling surface, fat rendering and caramelizing",
                    "tracking": "Camera tracks along the grill grates, flames licking each piece",
                    "push_in": "Camera pushes through rising smoke toward the perfect sear",
                    "low_angle": "Low angle from grill level, flames and heat shimmer rising",
                }),
                (["pastry", "dessert", "cake", "chocolate", "bake"], {
                    "slow_zoom_in": "Delicate zoom into the layered cross-section of the dessert",
                    "tracking": "Camera glides past the pastry display, each creation lit perfectly",
                    "push_in": "Camera pushes toward the dripping glaze catching the light",
                }),
                (["cocktail", "wine", "bar", "spirits", "pour"], {
                    "slow_zoom_in": "Luxurious zoom into the amber liquid catching candlelight",
                    "tracking": "Camera tracks along the polished bar past gleaming glassware",
                    "push_in": "Camera pushes toward the glass as the pour creates perfect layers",
                }),
            ],
            "sci_fi": [
                (["space", "station", "orbit", "shuttle", "satellite"], {
                    "tracking": "Camera tracks alongside the vessel against the star-filled void",
                    "push_in": "Camera pushes forward through the observation window into deep space",
                    "wide": "Wide shot of the station orbiting the planet, sun cresting the horizon",
                    "crane_up": "Camera rises to reveal the massive orbital structure in full",
                }),
                (["robot", "android", "cybernetic", "mech", "mechanical"], {
                    "tracking": "Camera circles the mechanical figure, servos and joints visible",
                    "slow_zoom_in": "Clinical zoom into the intricate mechanical details and optics",
                    "push_in": "Camera pushes forward to meet the machine's awakening gaze",
                    "low_angle": "Low angle looking up at the towering mechanical form",
                }),
                (["alien", "planet", "colony", "atmosphere", "terrain"], {
                    "tracking": "Camera tracks across the alien landscape, strange formations passing",
                    "wide": "Wide shot of the alien world's impossible geography",
                    "push_in": "Camera pushes forward into the unknown terrain ahead",
                    "aerial_descend": "Descent through alien atmosphere toward the surface below",
                }),
            ],
            "fantasy": [
                (["castle", "kingdom", "throne", "knight", "court"], {
                    "tracking": "Camera glides through the grand hall past stone columns and banners",
                    "slow_zoom_in": "Reverent zoom drawing toward the ornate throne or artifact",
                    "push_in": "Camera advances through the castle gates into the courtyard",
                    "wide": "Wide establishing shot of the castle against the dramatic sky",
                    "crane_up": "Camera rises to reveal the full majesty of the fortress",
                    "low_angle": "Imposing low angle gazing up at the towering castle walls",
                }),
                (["enchanted", "magical", "spell", "fairy", "mystical"], {
                    "tracking": "Camera drifts through shimmering magical particles and light",
                    "slow_zoom_in": "Dreamlike zoom into the source of the enchantment",
                    "push_in": "Camera floats forward through the magical barrier into the other realm",
                }),
                (["dragon", "beast", "creature", "wyvern", "monster"], {
                    "tracking": "Camera tracks the creature's massive form as it moves",
                    "low_angle": "Awe-struck low angle looking up at the towering beast",
                    "wide": "Wide shot revealing the creature's full terrifying scale",
                    "push_in": "Camera pushes forward toward the creature's piercing gaze",
                }),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee", "run"], {
                    "tracking": "High-speed tracking alongside the subject in full sprint",
                    "handheld": "Visceral handheld crashing through obstacles in the pursuit",
                    "whip_pan": "Rapid whip pan as the chase changes direction",
                    "wide": "Wide shot capturing the full scope of the chaotic pursuit",
                }),
                (["explosion", "fire", "destruction", "blast", "crash"], {
                    "slow_motion": "Ultra slow-motion capturing the shockwave and debris",
                    "wide": "Wide shot of the massive explosion and its aftermath",
                    "push_in": "Camera pushes toward the epicenter through settling debris",
                    "low_angle": "Low angle as the blast wave rolls overhead",
                }),
                (["rooftop", "parkour", "urban", "jump", "climb"], {
                    "tracking": "Camera tracks alongside the parkour athlete across rooftops",
                    "handheld": "Raw handheld matching the chaotic energy of the run",
                    "low_angle": "Low angle looking up as the figure leaps between buildings",
                    "whip_pan": "Snap whip pan following the leap across the gap",
                }),
                (["vehicle", "car", "motorcycle", "helicopter", "truck"], {
                    "tracking": "Camera tracks alongside the vehicle at breakneck speed",
                    "handheld": "In-vehicle handheld capturing the driver's intensity",
                    "wide": "Wide shot of the vehicle tearing through the landscape",
                    "low_angle": "Low angle from road level as the vehicle screams past",
                }),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence", "crime scene"], {
                    "push_in": "Slow deliberate push toward the revealing evidence",
                    "tracking": "Camera follows the detective through the crime scene",
                    "wide": "Wide establishing shot of the investigation space",
                    "slow_zoom_in": "Creeping zoom isolating the critical detail",
                }),
                (["chase", "pursuit", "escape", "run", "flee"], {
                    "handheld": "Shaky panic-driven handheld through narrow corridors",
                    "tracking": "Tight tracking behind the fleeing subject",
                    "whip_pan": "Frantic whip pan checking behind for the pursuer",
                    "wide": "Surveillance-wide showing the predator-prey distance closing",
                }),
                (["hostage", "kidnap", "captive", "trapped", "confined"], {
                    "slow_zoom_in": "Suffocating slow zoom on the captive's face",
                    "wide": "Locked-off wide showing the claustrophobic space",
                    "push_in": "Camera pushes in as the situation deteriorates",
                    "handheld": "Agitated handheld as the standoff intensifies",
                }),
                (["surveillance", "spy", "covert", "shadow", "watch"], {
                    "slow_zoom_in": "Patient telephoto zoom from a concealed vantage",
                    "tracking": "Covert tracking maintaining professional distance",
                    "push_in": "Camera closes in as the target approaches the drop point",
                    "wide": "Wide establishing the surveillance perimeter",
                }),
            ],
        }
        cam_context_list = _CAMERA_CONTEXT_OVERRIDES.get(genre, [])
        if cam_context_list:
            desc_lower_cam = description.lower()
            for keywords, cam_overrides in cam_context_list:
                if any(kw in desc_lower_cam for kw in keywords):
                    genre_overrides = {**genre_overrides, **cam_overrides}
                    break

        cam_descriptions = []
        for c in cam:
            if c in genre_overrides:
                cam_descriptions.append(genre_overrides[c])
            elif c in CAMERA_VOCABULARY:
                cam_descriptions.append(CAMERA_VOCABULARY[c]["fragment"])
            elif c in _EXTRACTED_CAM_LABELS:
                cam_descriptions.append(_EXTRACTED_CAM_LABELS[c])
            else:
                cam_descriptions.append(c.replace("_", " ").capitalize() + " shot")

        # Genre-specific segment intensifier phrases (replace generic "the scene intensifies")
        _GENRE_SEGMENT_PHRASES: dict[str, dict[str, str]] = {
            "fight": {
                "seg2": "the combat reaches its climax, impact and debris fill the frame",
                "seg3_build": "the fighters clash with devastating force, sweat and sparks flying",
                "seg3_peak": "the decisive blow lands, the outcome is sealed",
                "seg4_build": "strikes accelerate into a furious exchange",
                "seg4_peak": "a devastating finishing move in dramatic slow-motion",
                "seg4_settle": "the dust settles, the victor stands breathing heavily",
            },
            "xianxia": {
                "seg2": "spiritual energy erupts, qi manifests as luminous force",
                "seg3_build": "the cultivator channels ancient power, runes blazing to life",
                "seg3_peak": "a divine technique unleashes blinding celestial energy",
                "seg4_build": "mystical formations spiral around the cultivator",
                "seg4_peak": "heaven and earth tremble as ultimate power manifests",
                "seg4_settle": "golden light fades revealing the transcendent aftermath",
            },
            "ecommerce": {
                "seg2": "the product rotates to reveal its premium craftsmanship and detail",
                "seg3_build": "light catches the surface, highlighting material quality and texture",
                "seg3_peak": "the hero angle reveals the product in its most desirable form",
                "seg4_build": "subtle reflections emphasize the premium finish",
                "seg4_peak": "the definitive beauty shot, every detail perfectly lit",
                "seg4_settle": "the product rests elegantly, embodying luxury and desire",
            },
            "food": {
                "seg2": "steam rises luxuriously, the dish reveals its warm inviting textures",
                "seg3_build": "ingredients glisten with fresh moisture, colors pop appetizingly",
                "seg3_peak": "the perfect bite moment, textures and flavors visible in every detail",
                "seg4_build": "sauce cascades in slow-motion over the dish",
                "seg4_peak": "the ultimate food hero shot, steam and color at peak appeal",
                "seg4_settle": "the finished dish rests beautifully plated, irresistible and warm",
            },
            "popscience": {
                "seg2": "the visualization transforms, revealing the hidden scientific process",
                "seg3_build": "molecular structures shift and reconfigure in mesmerizing detail",
                "seg3_peak": "the phenomenon reaches full expression, science made visible",
                "seg4_build": "data streams and particles dance in organized complexity",
                "seg4_peak": "the breakthrough moment visualized in stunning clarity",
                "seg4_settle": "the visualization stabilizes, revealing profound scientific beauty",
            },
            "fantasy": {
                "seg2": "magical energy surges through the scene, enchantment takes hold",
                "seg3_build": "the mythical creature or force grows in power and scale",
                "seg3_peak": "magic reaches its zenith, the world transforms in radiant light",
                "seg4_build": "arcane forces swirl and intensify around the subject",
                "seg4_peak": "the spell reaches full power, reality bends to magical will",
                "seg4_settle": "the magic subsides leaving the transformed world in its wake",
            },
            "kpop": {
                "seg2": "the performance peaks with explosive choreography and energy",
                "seg3_build": "the formation shifts dynamically, synchronized perfection",
                "seg3_peak": "the dance break hits its climax, freeze frame on the key pose",
                "seg4_build": "rhythmic precision builds as the beat intensifies",
                "seg4_peak": "the signature move in slow-motion with strobing energy",
                "seg4_settle": "the final pose locks in, spotlight isolating the performer",
            },
            "action": {
                "seg2": "the action explodes into full intensity, speed and power unleashed",
                "seg3_build": "velocity and force build to dangerous levels",
                "seg3_peak": "the most intense moment captured in breathtaking motion",
                "seg4_build": "adrenaline peaks as the stakes reach maximum",
                "seg4_peak": "the explosive climax in slow-motion impact",
                "seg4_settle": "the aftermath reveals the scale of what just happened",
            },
            "horror": {
                "seg2": "the atmosphere tightens, something stirs in the shadows",
                "seg3_build": "dread builds as the darkness encroaches closer",
                "seg3_peak": "the terrifying reveal, the horror fully manifests",
                "seg4_build": "unease grows as reality distorts around the subject",
                "seg4_peak": "the jump scare moment, the nightmare is real",
                "seg4_settle": "silence returns but the horror lingers, nothing feels safe",
            },
            "drama": {
                "seg2": "the emotional weight builds to a quiet, devastating climax",
                "seg3_build": "raw emotion surfaces, vulnerability laid bare",
                "seg3_peak": "the pivotal emotional moment, tears or revelation",
                "seg4_build": "tension between characters reaches a breaking point",
                "seg4_peak": "the defining emotional beat, catharsis or heartbreak",
                "seg4_settle": "silence carries the weight of what was said or left unsaid",
            },
            "nature": {
                "seg2": "the creature reveals itself in stunning detail, wild and alive",
                "seg3_build": "nature unfolds with breathtaking intimacy, every texture visible",
                "seg3_peak": "the animal in its most powerful or graceful moment",
                "seg4_build": "the wild encounter intensifies, raw nature in action",
                "seg4_peak": "the definitive wildlife moment, power and beauty in harmony",
                "seg4_settle": "peace returns to the habitat, the cycle of nature continues",
            },
            "documentary": {
                "seg2": "the story deepens, revealing layers of truth and context",
                "seg3_build": "evidence and testimony build the narrative arc",
                "seg3_peak": "the central revelation, the truth comes to light",
                "seg4_build": "the investigation narrows, crucial detail emerges",
                "seg4_peak": "the pivotal discovery, understanding crystallizes",
                "seg4_settle": "reflection on what was uncovered, lasting significance",
            },
            "bollywood": {
                "seg2": "the emotion intensifies with dramatic gesture, fabrics flow in slow motion",
                "seg3_build": "the spectacle builds with vibrant color and sweeping movement",
                "seg3_peak": "the climactic emotional beat, intense close-up with dramatic expression",
                "seg4_build": "dramatic tension rises, ornate details shimmer in warm light",
                "seg4_peak": "the grand emotional crescendo, tears or joy in epic slow-motion",
                "seg4_settle": "the moment lingers in golden light, an iconic final frame",
            },
            "sci_fi": {
                "seg2": "technology activates with pulsing energy, lights and data streams surge",
                "seg3_build": "systems power up, holographic displays and energy fields intensify",
                "seg3_peak": "the technological spectacle at full power, light and force converge",
                "seg4_build": "digital elements cascade and multiply across the environment",
                "seg4_peak": "the sci-fi climax, reality bends with technological force",
                "seg4_settle": "energy stabilizes, the futuristic vista settles into its new state",
            },
            "sports": {
                "seg2": "the athletic effort intensifies, muscles straining at peak performance",
                "seg3_build": "the crowd roars as the decisive moment approaches",
                "seg3_peak": "the winning play unfolds in spectacular slow-motion",
                "seg4_build": "adrenaline peaks as the competition reaches its climax",
                "seg4_peak": "the triumphant moment, victory captured in freeze-frame clarity",
                "seg4_settle": "celebration erupts, the crowd and athlete share the glory",
            },
            "anime": {
                "seg2": "the power builds with visible aura, dramatic wind and light effects",
                "seg3_build": "energy concentrates as the character prepares the ultimate technique",
                "seg3_peak": "the signature move unleashes with explosive anime impact frames",
                "seg4_build": "speed lines and particle effects intensify around the character",
                "seg4_peak": "the climactic strike lands with screen-shaking impact",
                "seg4_settle": "the dust clears revealing the dramatic aftermath, wind flowing through hair",
            },
            "romance": {
                "seg2": "the intimacy deepens, eyes locked in tender connection",
                "seg3_build": "hearts draw closer, the world around them fades to soft bokeh",
                "seg3_peak": "the defining romantic moment, a kiss or embrace in golden light",
                "seg4_build": "emotion swells as the couple shares a vulnerable look",
                "seg4_peak": "the most tender moment, time seems to stop between them",
                "seg4_settle": "they rest in each other's arms, bathed in warm amber glow",
            },
            "thriller": {
                "seg2": "the tension ratchets higher, something is very wrong",
                "seg3_build": "clues converge, the truth begins to emerge from the shadows",
                "seg3_peak": "the shocking revelation, the trap springs or the betrayal is exposed",
                "seg4_build": "paranoia mounts as the walls close in around the subject",
                "seg4_peak": "the heart-stopping climax, danger fully realized in stark clarity",
                "seg4_settle": "uneasy silence lingers, the aftermath leaves nothing resolved",
            },
            "comedy": {
                "seg2": "the situation escalates hilariously, the absurdity fully visible",
                "seg3_build": "things go from bad to worse in the most ridiculous way possible",
                "seg3_peak": "the comedic climax, the punchline lands with perfect timing",
                "seg4_build": "the comedy of errors compounds, chaos builds delightfully",
                "seg4_peak": "the ultimate punchline moment, exaggerated reaction in slow-motion",
                "seg4_settle": "the aftermath is a mess, but everyone is laughing",
            },
            "war": {
                "seg2": "the battle intensifies, explosions and gunfire fill the frame",
                "seg3_build": "soldiers push forward through smoke and debris, determination etched on faces",
                "seg3_peak": "the decisive assault, chaos and heroism in the same violent moment",
                "seg4_build": "the tide of battle turns, urgent radio chatter and running soldiers",
                "seg4_peak": "the climactic charge through enemy fire, slow-motion sacrifice and valor",
                "seg4_settle": "silence falls over the battlefield, smoke drifting over the cost of war",
            },
            "historical": {
                "seg2": "the historical moment deepens, power and grandeur fill the frame",
                "seg3_build": "the weight of history bears down, fate hangs in the balance",
                "seg3_peak": "the pivotal historical moment, destiny decided in one act",
                "seg4_build": "tension mounts in the great hall, whispers and glances exchange",
                "seg4_peak": "the defining moment of the era, glory or tragedy crystallized",
                "seg4_settle": "history settles into its course, the aftermath etched in stone",
            },
            "western": {
                "seg2": "the tension builds under the scorching sun, hands hover near holsters",
                "seg3_build": "the frontier standoff intensifies, dust swirls between opponents",
                "seg3_peak": "the decisive draw, gunfire echoes across the empty landscape",
                "seg4_build": "the lone figure rides deeper into untamed territory",
                "seg4_peak": "the frontier justice moment, a single shot decides everything",
                "seg4_settle": "dust settles over the frontier, the lone figure rides into the sunset",
            },
            "cyberpunk": {
                "seg2": "the neon-soaked environment pulses with data streams and electric energy",
                "seg3_build": "digital systems activate, holographic displays cascade around the subject",
                "seg3_peak": "the cybernetic climax, reality and virtual worlds collide in neon fire",
                "seg4_build": "augmented reality overlays intensify, chrome and flesh blur together",
                "seg4_peak": "the system overload, neon explosion of data and light",
                "seg4_settle": "rain washes over the chrome surfaces, neon reflections pool on wet streets",
            },
            "music_video": {
                "seg2": "the performance intensifies, lights and energy surge with the music",
                "seg3_build": "the musical build-up reaches fever pitch, performer and crowd unite",
                "seg3_peak": "the chorus drops, explosive visual and sonic climax",
                "seg4_build": "the energy builds toward the final crescendo, lights strobing",
                "seg4_peak": "the ultimate performance moment, spotlit and transcendent",
                "seg4_settle": "the final note rings out, performer basks in the aftermath of raw energy",
            },
            "superhero": {
                "seg2": "the hero powers up, energy radiates outward with devastating force",
                "seg3_build": "the confrontation escalates, powers clash with blinding intensity",
                "seg3_peak": "the ultimate heroic moment, raw power unleashed to save the day",
                "seg4_build": "the hero charges forward through destruction, unstoppable determination",
                "seg4_peak": "the climactic hero landing, ground shattering under the impact of power",
                "seg4_settle": "the hero stands triumphant, cape settling as dust and light fade",
            },
            "noir": {
                "seg2": "the shadows deepen, revealing a darker truth beneath the surface",
                "seg3_build": "the clues converge in the smoke-filled room, betrayal hangs in the air",
                "seg3_peak": "the fateful moment, the femme fatale's true nature exposed under harsh light",
                "seg4_build": "the investigator closes in, rain streaking across the noir cityscape",
                "seg4_peak": "the double-cross springs, gunshot echoing through the empty street",
                "seg4_settle": "the detective stands alone in the rain, justice served but nothing clean",
            },
            "underwater": {
                "seg2": "the ocean reveals hidden wonders, bioluminescence awakens in the deep",
                "seg3_build": "marine life converges in a mesmerizing underwater ballet",
                "seg3_peak": "the most breathtaking underwater moment, scale and beauty converge",
                "seg4_build": "currents intensify, the underwater world pulses with life",
                "seg4_peak": "the climactic deep-sea spectacle, raw oceanic majesty on full display",
                "seg4_settle": "stillness returns to the deep, shafts of light filter through the silence",
            },
            "fairy_tale": {
                "seg2": "magic awakens in the scene, enchanted particles shimmer in the air",
                "seg3_build": "the enchantment builds, transforming the world in sparkling wonder",
                "seg3_peak": "the magical climax, the spell reaches its fullest radiant power",
                "seg4_build": "fairy-tale forces gather, the world shimmers between ordinary and magical",
                "seg4_peak": "the most wondrous moment, pure enchantment fills every corner of the frame",
                "seg4_settle": "the magic settles gently like stardust, leaving the world forever changed",
            },
            "dance": {
                "seg2": "the rhythm intensifies, the dancer's movement becomes fluid and explosive",
                "seg3_build": "choreography builds to fever pitch, every beat matched with precision",
                "seg3_peak": "the climactic move in slow-motion, athletic beauty frozen in the air",
                "seg4_build": "the energy builds, dancers synchronize for the grand finale",
                "seg4_peak": "the show-stopping move, the apex of physical artistry and rhythm",
                "seg4_settle": "the final pose holds, breath visible, the performance complete",
            },
            "travel": {
                "seg2": "the destination reveals its hidden beauty, details emerge in golden light",
                "seg3_build": "the journey deepens, local life and culture come alive around the traveler",
                "seg3_peak": "the most breathtaking vista, the destination at its most awe-inspiring",
                "seg4_build": "the exploration continues, each corner reveals new wonder",
                "seg4_peak": "the defining travel moment, the landscape or culture at its most magnificent",
                "seg4_settle": "the traveler pauses to absorb the view, golden light on the horizon",
            },
            "fashion": {
                "seg2": "the garment catches the light, revealing its luxurious texture and construction",
                "seg3_build": "the model commands the space, fabric flowing with each confident step",
                "seg3_peak": "the hero moment, the look fully revealed in its most striking angle",
                "seg4_build": "details emerge, accessories and fabric interplay elegantly",
                "seg4_peak": "the definitive fashion moment, elegance and artistry in perfect frame",
                "seg4_settle": "the model holds the final pose, the look seared into memory",
            },
            "vfx": {
                "seg2": "the visual effect accelerates, particles and energy reshape the scene",
                "seg3_build": "the transformation intensifies, reality bending and morphing",
                "seg3_peak": "the effect reaches its peak spectacle, full visual transformation complete",
                "seg4_build": "layers of visual effects cascade through the frame",
                "seg4_peak": "the most spectacular moment, every particle perfectly placed",
                "seg4_settle": "the effect resolves, the transformed scene stabilizes into its new form",
            },
            "cinematic": {
                "seg2": "the vista reveals its full majesty, scale becomes breathtaking",
                "seg3_build": "the landscape transforms with shifting light and atmosphere",
                "seg3_peak": "the most spectacular view, nature at its most awe-inspiring",
                "seg4_build": "golden light plays across the sweeping terrain",
                "seg4_peak": "the money shot, the landscape in its most cinematic glory",
                "seg4_settle": "the scene breathes with quiet grandeur, a final lingering moment",
            },
        }

        seg_phrases = _GENRE_SEGMENT_PHRASES.get(genre, _GENRE_SEGMENT_PHRASES.get("cinematic", {}))

        # Context-aware segment phrase overrides — the nature genre defaults
        # to creature/animal phrases ("the creature reveals itself", "the
        # animal in its most powerful moment") which are wrong for landscape
        # nature scenes (oceans, mountains, deserts, storms, waterfalls).
        # Same pattern as _AUDIO_CONTEXT_OVERRIDES and _PARTICLE_CONTEXT_OVERRIDES.
        _SEGMENT_PHRASE_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], dict[str, str]]]] = {
            "nature": [
                (["ocean", "sea", "wave", "reef", "coast", "beach", "shore", "tide",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], {
                    "seg2": "the ocean reveals its vast power, waves building with rhythmic force",
                    "seg3_build": "the sea displays raw elemental energy, water and light intertwined",
                    "seg3_peak": "the most spectacular oceanic moment, wave at its towering peak",
                    "seg4_build": "the tide surges with elemental fury, spray and foam catching light",
                    "seg4_peak": "the defining ocean moment, raw marine power at its most magnificent",
                    "seg4_settle": "the waters calm to a gentle rhythm, vast ocean stretching to the horizon",
                }),
                (["mountain", "peak", "summit", "cliff", "alpine", "himalaya", "everest"], {
                    "seg2": "the mountain reveals its grandeur, rock and snow catching shifting light",
                    "seg3_build": "the alpine landscape unfolds with dramatic scale, clouds and stone in dialogue",
                    "seg3_peak": "the summit at its most spectacular, light breaking through clouds onto the peak",
                    "seg4_build": "the mountain terrain transforms with sweeping weather and light",
                    "seg4_peak": "the defining mountain vista, geological majesty at its most awe-inspiring",
                    "seg4_settle": "mist settles around the peaks, the mountain returns to ancient stillness",
                }),
                (["desert", "sand", "dune", "sahara", "arid", "cactus"], {
                    "seg2": "the desert reveals its stark beauty, sand patterns sculpted by wind",
                    "seg3_build": "the arid landscape transforms with shifting light and heat shimmer",
                    "seg3_peak": "the most dramatic desert moment, light and sand in breathtaking harmony",
                    "seg4_build": "the terrain shifts as shadows stretch across the dunes",
                    "seg4_peak": "the defining desert vista, raw elemental beauty at its peak",
                    "seg4_settle": "the desert falls quiet under a vast sky, endless sand meeting the horizon",
                }),
                (["rain", "storm", "lightning", "thunder", "monsoon", "hurricane", "tornado"], {
                    "seg2": "the storm gathers force, clouds darkening with elemental power",
                    "seg3_build": "the weather builds to dramatic intensity, rain and wind unleashed",
                    "seg3_peak": "the storm at its peak fury, lightning illuminating the landscape",
                    "seg4_build": "the tempest reaches maximum force, nature's raw power on display",
                    "seg4_peak": "the most spectacular storm moment, elemental chaos and beauty",
                    "seg4_settle": "the storm passes, raindrops catching light as calm returns",
                }),
                (["waterfall", "cascade", "river", "rapids", "stream", "creek"], {
                    "seg2": "the water reveals its dynamic power, cascading with hypnotic force",
                    "seg3_build": "the flow intensifies, mist and spray catching rainbow light",
                    "seg3_peak": "the most spectacular water moment, hydro power and beauty converge",
                    "seg4_build": "the cascade surges with elemental energy, foam and current intertwined",
                    "seg4_peak": "the defining water moment, liquid sculpture at its finest",
                    "seg4_settle": "the flow settles into gentle rhythm, water finding its ancient path",
                }),
                (["forest", "tree", "trees", "jungle", "rainforest", "woodland", "grove"], {
                    "seg2": "the forest reveals hidden depths, light filtering through the canopy",
                    "seg3_build": "the woodland atmosphere deepens, shadows and light playing through leaves",
                    "seg3_peak": "the most enchanting forest moment, nature's cathedral at its finest",
                    "seg4_build": "the canopy comes alive with shifting light and gentle motion",
                    "seg4_peak": "the defining forest vista, ancient trees and dappled light in harmony",
                    "seg4_settle": "the forest settles into golden stillness, leaves catching the last light",
                }),
                (["volcano", "lava", "eruption", "volcanic", "magma", "geyser"], {
                    "seg2": "the volcanic landscape reveals its raw power, heat and smoke rising",
                    "seg3_build": "the eruption builds with primal force, lava and ash filling the frame",
                    "seg3_peak": "the most explosive volcanic moment, geological fury unleashed",
                    "seg4_build": "the eruption reaches maximum intensity, rivers of molten rock flowing",
                    "seg4_peak": "the defining volcanic spectacle, earth's inner fire on full display",
                    "seg4_settle": "the eruption subsides, steam and embers settling over the transformed landscape",
                }),
                (["aurora", "northern lights", "borealis", "sky", "starry", "milky way"], {
                    "seg2": "the sky reveals its celestial display, light dancing across the heavens",
                    "seg3_build": "the celestial show intensifies, colors rippling through the atmosphere",
                    "seg3_peak": "the most breathtaking sky moment, nature's light show at its peak",
                    "seg4_build": "the display reaches full radiance, the heavens alive with color",
                    "seg4_peak": "the defining celestial vista, cosmic beauty at its most awe-inspiring",
                    "seg4_settle": "the display softens, stars settling into quiet eternal brilliance",
                }),
            ],
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight", "uppercut", "knockout"], {
                    "seg2": "the fighter launches a devastating combination, leather snapping on contact",
                    "seg3_build": "the bout reaches fever pitch, both fighters trading brutal blows",
                    "seg3_peak": "the knockout punch connects in spectacular slow-motion, sweat exploding",
                    "seg4_build": "the final round intensifies, exhaustion and determination on bloodied faces",
                    "seg4_peak": "the decisive blow lands, the opponent crumbles in dramatic slow-motion",
                    "seg4_settle": "the champion raises gloves in triumph, corner erupts in celebration",
                }),
                (["wrestling", "mma", "grapple", "takedown", "octagon", "cage"], {
                    "seg2": "the grapple intensifies, bodies locked in a brutal ground battle",
                    "seg3_build": "the submission attempt tightens, the crowd roars for the finish",
                    "seg3_peak": "the decisive takedown, body slammed onto the canvas with devastating impact",
                    "seg4_build": "the final exchange erupts, desperate strikes and clinch work",
                    "seg4_peak": "the submission locked in, the opponent taps in dramatic close-up",
                    "seg4_settle": "the victor stands over the defeated, the cage door opens to celebration",
                }),
                (["swimming", "diving", "pool"], {
                    "seg2": "the swimmer surges through the water, powerful strokes cutting through lanes",
                    "seg3_build": "the race tightens, neck and neck with every stroke",
                    "seg3_peak": "the final touch, fingertips reaching for the wall in slow-motion",
                    "seg4_build": "the dive unfolds, the athlete arcing through the air in perfect form",
                    "seg4_peak": "the entry, barely a ripple as the diver pierces the water surface",
                    "seg4_settle": "the scoreboard flashes, the swimmer erupts in celebration in the water",
                }),
                (["racing", "formula", "motorsport", "car"], {
                    "seg2": "the car screams through the corner, tires at the limit of grip",
                    "seg3_build": "the overtake develops, nose to tail at breakneck speed",
                    "seg3_peak": "the decisive move, the car lunges ahead in a spray of sparks",
                    "seg4_build": "the final lap pressure mounts, every corner a battle against time",
                    "seg4_peak": "the finish line crossed, checkered flag waved in a blur of speed",
                    "seg4_settle": "the car slows on the cool-down lap, victory radio message crackling",
                }),
            ],
            "horror": [
                # Supernatural/demon BEFORE slasher — first match wins.
                (["supernatural", "demon", "possession", "creature", "monster", "curse"], {
                    "seg2": "the entity manifests, unnatural presence warping the space around it",
                    "seg3_build": "the supernatural force intensifies, reality cracking at the edges",
                    "seg3_peak": "the entity at full terrifying power, otherworldly horror unleashed",
                    "seg4_build": "the possession deepens, the host contorts in impossible ways",
                    "seg4_peak": "the most horrifying supernatural moment, pure cosmic dread made flesh",
                    "seg4_settle": "the entity fades leaving scarred emptiness, eerie calm replacing chaos",
                }),
                (["slasher", "knife", "stalk", "killer", "masked"], {
                    "seg2": "the killer draws closer, each footstep deliberate and menacing",
                    "seg3_build": "the pursuit intensifies, the victim cornered with nowhere to run",
                    "seg3_peak": "the blade strikes, the attack in brutal unflinching detail",
                    "seg4_build": "the chase resumes, desperate flight through dark corridors",
                    "seg4_peak": "the final confrontation, killer and victim face to face",
                    "seg4_settle": "silence falls, only the dripping sound remains in the aftermath",
                }),
                (["psychological", "mind", "insanity", "hallucination"], {
                    "seg2": "reality begins to fracture, familiar spaces becoming distorted",
                    "seg3_build": "the hallucinations intensify, impossible things appearing in shadows",
                    "seg3_peak": "the breaking point of sanity, the terrifying truth revealed",
                    "seg4_build": "the mind spirals further, unable to distinguish real from imagined",
                    "seg4_peak": "the most disturbing revelation, the horror was inside all along",
                    "seg4_settle": "an uncertain calm, but is this reality or another layer of delusion",
                }),
            ],
            "dance": [
                (["ballet", "ballerina", "pointe", "swan", "classical"], {
                    "seg2": "the dancer launches into a soaring leap, defying gravity momentarily",
                    "seg3_build": "the choreography builds to its emotional peak, spins accelerating",
                    "seg3_peak": "the grand jeté in breathtaking slow-motion, pure grace suspended",
                    "seg4_build": "the final variation unfolds, technique and emotion perfectly merged",
                    "seg4_peak": "the climactic pose, a moment of perfect stillness after explosive movement",
                    "seg4_settle": "the curtain call bow, the dancer breathes as the audience erupts",
                }),
                (["breakdance", "bboy", "popping", "locking", "breaking"], {
                    "seg2": "the dancer drops to the floor, launching into rapid footwork",
                    "seg3_build": "the power moves escalate, windmills and flares spinning faster",
                    "seg3_peak": "the signature freeze in impossible balance, the crowd erupts",
                    "seg4_build": "the battle heats up, each move more explosive than the last",
                    "seg4_peak": "the final power move, a gravity-defying freeze that defines the battle",
                    "seg4_settle": "the dancer rises to crowd roar, victorious pose and respect exchanged",
                }),
            ],
            "war": [
                # Samurai BEFORE medieval — "sword" alone is too generic.
                (["samurai", "katana", "duel", "shogun", "ronin"], {
                    "seg2": "the warriors circle each other, hands hovering over katana hilts",
                    "seg3_build": "the tension reaches unbearable height, a single breath before the strike",
                    "seg3_peak": "the blades flash in a single devastating exchange, steel singing",
                    "seg4_build": "the aftermath reveals the strike's precision, silk falling in the air",
                    "seg4_peak": "the decisive blow landed, the defeated warrior falls in slow-motion",
                    "seg4_settle": "the victor sheathes the katana, cherry blossoms drifting in silence",
                }),
                (["medieval", "sword", "shield", "castle", "knight", "siege"], {
                    "seg2": "the charge begins, armored warriors clashing with brutal force",
                    "seg3_build": "the melee intensifies, swords and shields creating a wall of steel",
                    "seg3_peak": "the siege weapon fires, castle walls crumbling under devastating impact",
                    "seg4_build": "the final push, warriors scaling walls amid arrows and boiling oil",
                    "seg4_peak": "the banner rises over the conquered walls, victory cries echoing",
                    "seg4_settle": "the battle subsides, smoke and silence settling over the bloodied field",
                }),
                (["sniper", "scope", "tactical", "aim"], {
                    "seg2": "the scope tracks the target, wind and distance calculations visible",
                    "seg3_build": "breathing slows to a crawl, the crosshairs settling on the mark",
                    "seg3_peak": "the trigger pull in extreme slow-motion, the round leaving the barrel",
                    "seg4_build": "the bullet traces through the air, time slowed to microseconds",
                    "seg4_peak": "the impact, mission accomplished in a single decisive moment",
                    "seg4_settle": "the spotter confirms the hit, the sniper begins silent extraction",
                }),
            ],
            "sci_fi": [
                (["floating", "zero gravity", "weightless", "eva", "spacewalk", "drift"], {
                    "seg2": "the astronaut drifts deeper into the void, tether trailing behind",
                    "seg3_build": "a moment of pure weightless stillness, Earth filling the visor below",
                    "seg3_peak": "the most breathtaking vista, stars and planet in perfect silence",
                    "seg4_build": "the astronaut rotates slowly, sunlight catching the helmet visor",
                    "seg4_peak": "the defining cosmic moment, alone in the infinite expanse",
                    "seg4_settle": "the astronaut floats in serene orbit, Earth's glow reflecting on the suit",
                }),
                (["mecha", "robot", "cockpit", "pilot"], {
                    "seg2": "the mecha powers up, HUD flickering to life as systems come online",
                    "seg3_build": "the battle escalates, the mecha unleashing devastating weapons",
                    "seg3_peak": "the final blow, the enemy mecha torn apart in explosive slow-motion",
                    "seg4_build": "the damaged mecha presses forward, sparking systems and warning alarms",
                    "seg4_peak": "the decisive strike, the mecha's signature attack at full power",
                    "seg4_settle": "the mecha stands victorious amid wreckage, pilot breathing hard",
                }),
                (["space", "station", "orbit", "spaceship"], {
                    "seg2": "the vessel approaches, the station growing larger in the viewport",
                    "seg3_build": "the docking sequence begins, precision maneuvers in the void",
                    "seg3_peak": "the most spectacular space moment, stars and structure in perfect frame",
                    "seg4_build": "systems activate, the station pulsing with technological energy",
                    "seg4_peak": "the defining cosmic vista, humanity's creation against infinite space",
                    "seg4_settle": "the station drifts in peaceful orbit, Earth's blue glow reflecting on hull",
                }),
            ],
            "food": [
                (["sushi", "nigiri", "sashimi", "maki"], {
                    "seg2": "the chef's knife glides with precision, each cut reveals perfect texture",
                    "seg3_build": "the plating begins, each piece placed with artistic intention",
                    "seg3_peak": "the hero shot of the finished plate in all its glory",
                    "seg4_build": "garnish and final touches elevate the presentation",
                    "seg4_peak": "the most appetizing angle, every detail inviting",
                    "seg4_settle": "the dish rests in its warm setting, steam rising gently",
                }),
                (["grill", "sizzle", "bbq", "steak"], {
                    "seg2": "the meat hits the grill, searing contact and steam erupts",
                    "seg3_build": "the crust forms with caramelization, juices pooling",
                    "seg3_peak": "the flip reveals perfect grill marks, sizzle intensifies",
                    "seg4_build": "resting on the board, juices redistributing under crust",
                    "seg4_peak": "the cross-section cut reveals perfect interior doneness",
                    "seg4_settle": "the plated steak in warm resting glow, appetizing finish",
                }),
            ],
            "fantasy": [
                (["dragon", "fire", "flame", "breath"], {
                    "seg2": "the dragon rises, wings unfurling against the sky",
                    "seg3_build": "flame gathers in the beast's throat, heat distortion visible",
                    "seg3_peak": "the fire breath erupts, engulfing everything in blazing light",
                    "seg4_build": "the aftermath smolders, embers drifting through scorched air",
                    "seg4_peak": "the dragon wheels above the destruction in silhouette",
                    "seg4_settle": "distant wingbeats fade, smoke rising from the scarred landscape",
                }),
                (["spell", "magic", "enchant", "wizard"], {
                    "seg2": "arcane energy gathers, runes appearing in the air",
                    "seg3_build": "the spell builds to critical mass, reality bending",
                    "seg3_peak": "the magical discharge erupts in a cascade of power",
                    "seg4_build": "the aftereffects ripple through the environment",
                    "seg4_peak": "the transformation is complete, a new reality revealed",
                    "seg4_settle": "magical residue settles like stardust, silence returns",
                }),
            ],
            "anime": [
                (["mecha", "robot", "transform"], {
                    "seg2": "the mecha's systems power up, panels shifting and reconfiguring",
                    "seg3_build": "transformation sequence accelerates, metal plates rotating into position",
                    "seg3_peak": "the final form is revealed in a dramatic pose against explosion backdrop",
                    "seg4_build": "the mecha charges forward, weapons systems online",
                    "seg4_peak": "the decisive strike connects with devastating impact",
                    "seg4_settle": "the mecha stands in victory pose, dust and debris settling",
                }),
            ],
            "documentary": [
                (["nature", "wildlife", "animal"], {
                    "seg2": "the subject emerges into view, the observer patient and still",
                    "seg3_build": "behavior unfolds naturally, each movement telling a story",
                    "seg3_peak": "the defining moment captured, nature's truth revealed",
                    "seg4_build": "the aftermath of the encounter, landscape returning to calm",
                    "seg4_peak": "the final establishing wide, subject in its full context",
                    "seg4_settle": "peaceful resolution, the natural world continuing its rhythm",
                }),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], {
                    "seg2": "the baraat procession surges forward, dancing and drums intensifying",
                    "seg3_build": "the celebrations reach fever pitch, whirling garments and marigold showers",
                    "seg3_peak": "the bride and groom lock eyes through the festive chaos, time freezes",
                    "seg4_build": "the pheras around sacred fire, seven vows exchanged with devotion",
                    "seg4_peak": "the sindoor moment, vermillion marking the union in golden light",
                    "seg4_settle": "the couple stands together, family blessing with tearful smiles",
                }),
                (["rain", "monsoon", "barish"], {
                    "seg2": "the first drops fall, lovers reaching toward each other through rain",
                    "seg3_build": "the monsoon intensifies, spinning and dancing in sheets of water",
                    "seg3_peak": "the embrace in pouring rain, world dissolving into romantic slow-motion",
                    "seg4_build": "lightning illuminates the lovers' faces, rain streaming over them",
                    "seg4_peak": "the most romantic rain moment, eyes locked through water drops",
                    "seg4_settle": "rain softens to drizzle, lovers sheltering together in warm afterglow",
                }),
                (["dance", "garba", "dandiya", "kathak"], {
                    "seg2": "the rhythm accelerates, dancers moving in synchronized circles",
                    "seg3_build": "the choreography builds to explosive energy, spins and leaps",
                    "seg3_peak": "the climactic dance freeze, dramatic pose in swirling fabric",
                    "seg4_build": "the troupe resumes with maximum energy, floor-shaking footwork",
                    "seg4_peak": "the final formation, all dancers in breathtaking synchronized pose",
                    "seg4_settle": "the music settles, dancers breathing hard with triumphant smiles",
                }),
                (["emotional", "farewell", "bidaai", "departure"], {
                    "seg2": "tears begin to flow, hands clasping in desperate farewell",
                    "seg3_build": "the emotional dam breaks, embraces tightening with raw grief",
                    "seg3_peak": "the most heartbreaking moment, the final look back through tears",
                    "seg4_build": "the departure begins, each step away heavier than the last",
                    "seg4_peak": "the car pulls away, a hand reaching from the window in desperation",
                    "seg4_settle": "the figure recedes into distance, left behind standing in empty silence",
                }),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], {
                    "seg2": "neon signs flicker overhead, the crowd parts around a figure in rain-slicked streets",
                    "seg3_build": "holographic advertisements glitch and distort, the city pulses with electric tension",
                    "seg3_peak": "the neon-soaked moment of truth, rain and light colliding in vivid clarity",
                    "seg4_build": "data streams cascade through the air, the city revealing its digital underbelly",
                    "seg4_peak": "the full cyberpunk spectacle, technology and humanity clashing in neon rain",
                    "seg4_settle": "the streets settle into their restless rhythm, neon reflections pooling in puddles",
                }),
                (["rooftop", "skyline", "tower", "aerial", "drone"], {
                    "seg2": "the sprawling megacity reveals its vertical expanse, towers piercing smog",
                    "seg3_build": "flying vehicles streak past, the cityscape alive with airborne traffic",
                    "seg3_peak": "the breathtaking vista from above, infinite neon grid stretching to the horizon",
                    "seg4_build": "searchlights sweep the skyline, corporate logos burning through the haze",
                    "seg4_peak": "the defining rooftop moment, alone above the teeming electric abyss",
                    "seg4_settle": "dawn breaks over the megacity, the neon dimming against pale sky",
                }),
                (["club", "bar", "underground", "rave"], {
                    "seg2": "bass throbs through the walls, synthetic beats syncing with pulsing lights",
                    "seg3_build": "the crowd surges on the dance floor, bodies and holograms intermingling",
                    "seg3_peak": "the beat drops with blinding intensity, the entire club erupting in light",
                    "seg4_build": "shadowy figures negotiate in VIP booths, data deals under strobe",
                    "seg4_peak": "the most electric underground moment, vice and neon in perfect harmony",
                    "seg4_settle": "the music fades to a low pulse, smoke and afterimages lingering",
                }),
                (["chase", "pursuit", "escape", "flee"], {
                    "seg2": "the pursuit explodes through neon corridors, boots splashing through puddles",
                    "seg3_build": "shortcuts through maintenance tunnels, sparks flying from brushed metal",
                    "seg3_peak": "the desperate leap between buildings, city lights blurring below",
                    "seg4_build": "drones give chase overhead, searchlights cutting through rain",
                    "seg4_peak": "the final narrow escape, disappearing into the anonymous crowd",
                    "seg4_settle": "the pursuer loses the trail, neon reflections the only witness",
                }),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence", "crime scene"], {
                    "seg2": "a detail emerges under examination, the puzzle piece clicking into place",
                    "seg3_build": "evidence mounts, photographs and documents spreading across the desk",
                    "seg3_peak": "the breakthrough revelation, the connection that changes everything",
                    "seg4_build": "the implications unfold, each thread leading to a darker truth",
                    "seg4_peak": "the devastating discovery, the truth more terrible than imagined",
                    "seg4_settle": "alone with the knowledge, the weight of revelation settling in",
                }),
                (["chase", "pursuit", "run", "escape", "flee"], {
                    "seg2": "footsteps echo in empty corridors, the gap narrowing with each turn",
                    "seg3_build": "the pursuit intensifies through confined spaces, obstacles barely cleared",
                    "seg3_peak": "the cornered moment, nowhere left to run, face to face with threat",
                    "seg4_build": "desperation fuels one final attempt, crashing through barriers",
                    "seg4_peak": "the decisive moment of escape or capture, suspended in time",
                    "seg4_settle": "the aftermath of the chase, adrenaline fading to shaking exhaustion",
                }),
                (["hostage", "kidnap", "captive", "trapped", "confined"], {
                    "seg2": "the captor circles slowly, control and menace in every movement",
                    "seg3_build": "the situation deteriorates, demands escalating with dangerous urgency",
                    "seg3_peak": "the moment of maximum peril, a life hanging in the balance",
                    "seg4_build": "a window of opportunity appears, the smallest chance of escape",
                    "seg4_peak": "the decisive act, freedom or failure in a single heartbeat",
                    "seg4_settle": "the crisis resolves, the cost of survival written on every face",
                }),
                (["surveillance", "spy", "covert", "shadow", "watch"], {
                    "seg2": "the target moves through the frame, unaware of watching eyes",
                    "seg3_build": "the operation closes in, assets moving into position",
                    "seg3_peak": "the moment of contact, cover identities tested under pressure",
                    "seg4_build": "the extraction unfolds, precise timing against mounting risk",
                    "seg4_peak": "the mission-critical instant, success or catastrophic failure",
                    "seg4_settle": "the operative vanishes, only a ghost of presence remaining",
                }),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee", "run"], {
                    "seg2": "the pursuit launches at full speed, vehicles and bodies in motion",
                    "seg3_build": "the chase escalates through increasingly dangerous terrain",
                    "seg3_peak": "the most spectacular stunt, defying physics and probability",
                    "seg4_build": "wreckage and chaos in the wake, the chase refusing to relent",
                    "seg4_peak": "the final collision or narrow escape, the defining moment of speed",
                    "seg4_settle": "dust and debris settle, the aftermath of explosive pursuit",
                }),
                (["explosion", "fire", "destruction", "blast", "bomb"], {
                    "seg2": "the detonation wave begins, fire blooming outward from the source",
                    "seg3_build": "the shockwave expands, shattering everything in its radius",
                    "seg3_peak": "the full explosive spectacle, debris and fire in devastating slow-motion",
                    "seg4_build": "secondary explosions chain outward, the destruction compounding",
                    "seg4_peak": "the inferno at maximum intensity, the structure collapsing in flame",
                    "seg4_settle": "smoke and embers drift through the devastated scene, eerie quiet",
                }),
                (["fight", "combat", "brawl", "punch", "kick"], {
                    "seg2": "the first strike lands, the combatants engaging with ferocity",
                    "seg3_build": "the fight intensifies, trading blows with increasing desperation",
                    "seg3_peak": "the decisive combination, the most brutal and beautiful exchange",
                    "seg4_build": "both fighters dig deep, exhaustion and determination driving them",
                    "seg4_peak": "the knockout blow, the fight ending in spectacular fashion",
                    "seg4_settle": "the victor stands breathing hard, the vanquished still on the ground",
                }),
                (["vehicle", "car", "motorcycle", "helicopter"], {
                    "seg2": "the engine roars as the vehicle tears through the environment",
                    "seg3_build": "the driving becomes reckless, narrow misses and sliding turns",
                    "seg3_peak": "the most insane vehicular moment, airborne or sideways or both",
                    "seg4_build": "pursuit vehicles close in, the noose tightening at speed",
                    "seg4_peak": "the spectacular vehicular finale, metal and momentum colliding",
                    "seg4_settle": "the engine dies, smoke rising from the battered machine",
                }),
            ],
        }
        seg_override_list = _SEGMENT_PHRASE_CONTEXT_OVERRIDES.get(genre, [])
        if seg_override_list:
            desc_lower = description.lower()
            for keywords, override_phrases in seg_override_list:
                if any(kw in desc_lower for kw in keywords):
                    seg_phrases = {**seg_phrases, **override_phrases}
                    break

        # Genre-specific lighting descriptions (injected into first segment)
        _GENRE_LIGHTING: dict[str, str] = {
            "fight": "dramatic rim lighting with harsh shadows",
            "xianxia": "ethereal golden backlight with volumetric mist",
            "ecommerce": "bright studio three-point lighting, soft shadows",
            "food": "warm golden directional light, steam glow",
            "drama": "soft Rembrandt lighting with emotional shadow",
            "popscience": "clean clinical blue-white illumination",
            "kpop": "pulsing neon stage lighting with colored gels",
            "fantasy": "magical ambient glow with god rays",
            "action": "harsh directional light with lens flares",
            "horror": "single source low-key lighting, deep shadows",
            "nature": "natural ambient light with soft atmospheric depth",
            "documentary": "natural available light, observational feel",
            "bollywood": "warm golden backlighting with romantic diffusion, dramatic rim light",
            "sci_fi": "cool blue neon glow with holographic rim light and volumetric fog",
            "sports": "bright stadium floodlights with dramatic rim lighting on athlete",
            "anime": "dramatic directional light with bold shadows and colored rim highlights",
            "romance": "soft warm golden backlighting with romantic lens diffusion",
            "thriller": "high contrast chiaroscuro lighting with cold blue undertones and sharp shadow edges",
            "comedy": "bright even lighting with warm tones, no harsh shadows",
            "war": "harsh overcast diffused light with smoke-filtered sun and muzzle flash bursts",
            "historical": "warm candlelight and torchlight with soft period-accurate shadow depth",
            "western": "harsh desert sun casting long dramatic shadows, golden dust-filtered light",
            "cyberpunk": "neon glow from signs and holograms, rain-reflected colored light in darkness",
            "music_video": "dramatic stage lighting with colored gels, spotlight beams through haze",
            "superhero": "dramatic backlighting with power-glow rim light and volumetric energy beams",
            "noir": "high contrast single-source key light through venetian blinds, deep pool shadows",
            "underwater": "filtered caustic light rays from above, bioluminescent glow from below",
            "fairy_tale": "soft golden fairy light with magical particle sparkle and warm diffusion",
            "dance": "dynamic stage lighting with colored gels and dramatic rim light",
            "travel": "golden hour natural light with atmospheric warmth and soft lens flare",
            "fashion": "elegant studio three-point lighting with beauty key and soft fill",
            "vfx": "dramatic rim lighting with energy glow sources illuminating particle effects",
            "cinematic": "golden hour backlight with atmospheric haze",
        }
        lighting = _GENRE_LIGHTING.get(genre, "cinematic lighting")

        # Context-aware lighting overrides — genre defaults are too generic
        # for sub-genres.  E.g. sports uses "bright stadium floodlights" but
        # boxing needs "harsh overhead ring lights" and swimming needs
        # "bright pool lane lighting".
        _LIGHTING_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], str]]] = {
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight", "uppercut"], "harsh overhead ring lights casting sharp shadows on the canvas"),
                (["wrestling", "mma", "octagon", "cage"], "intense cage lighting with dramatic shadows on the mat"),
                (["swimming", "diving", "pool"], "bright pool lane lighting with underwater caustics and reflected ripples"),
                (["soccer", "football", "pitch"], "bright stadium floodlights with evening golden tinge on the grass"),
                (["tennis", "racket", "court"], "bright court lighting with clean shadows on the playing surface"),
                (["racing", "formula", "motorsport"], "harsh track lighting with headlight flare and motion-streaked stadium lights"),
                (["skiing", "snowboard", "ice", "skating"], "crisp alpine light reflecting off snow and ice surfaces"),
            ],
            "nature": [
                # More specific sub-genres first (volcano before mountain,
                # aurora before storm) — first match wins
                (["volcano", "lava", "eruption", "volcanic"], "molten orange glow from below with smoke-diffused dim light above"),
                (["aurora", "northern lights", "borealis"], "celestial aurora glow painting the landscape in green and purple"),
                (["ocean", "sea", "wave", "beach", "coast",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], "natural coastal light with sun glinting off water surface"),
                (["desert", "sand", "dune"], "harsh desert sun with heat shimmer and golden dust-filtered light"),
                (["forest", "jungle", "rainforest", "woodland"], "dappled forest light filtering through canopy gaps"),
                (["mountain", "peak", "alpine", "cliff"], "crisp mountain light with dramatic cloud shadow play"),
                (["storm", "lightning", "thunder"], "dramatic storm light with intermittent lightning flashes illuminating clouds"),
                (["waterfall", "cascade", "river"], "soft diffused light with rainbow mist catching in the spray"),
                (["underwater", "coral", "reef"], "filtered blue-green caustic light rays from above"),
            ],
            "horror": [
                (["haunted", "mansion", "castle", "gothic", "house"], "guttering candlelight and pale moonbeams cutting through broken windows"),
                (["forest", "woods", "cabin", "swamp", "fog"], "cold blue moonlight filtered through dead branches, ground fog glowing"),
                (["hospital", "asylum", "corridor", "institution"], "harsh flickering fluorescent tubes with pools of total darkness between"),
                (["urban", "subway", "alley", "basement"], "single harsh sodium lamp casting long distorted shadows"),
                (["underwater", "deep sea", "abyss"], "faint bioluminescent glow in otherwise total darkness"),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor"], "dense neon signage reflections on wet pavement, holographic ad spill"),
                (["rooftop", "skyline", "tower", "aerial"], "city neon glow from below illuminating low clouds and rain"),
                (["club", "rave", "underground", "bar"], "strobing UV blacklight and laser lines cutting through haze"),
                (["corporate", "office", "tower"], "cold clinical overhead panels with holographic screen glow"),
                (["rain", "neon", "night", "puddle"], "fractured neon reflections in rain puddles and windshield streaks"),
            ],
            "war": [
                (["trench", "foxhole", "bunker", "barricade"], "dim smoky haze lit by distant muzzle flashes and signal flares"),
                (["urban", "ruins", "city", "rubble"], "harsh directional light through shattered buildings, dust-filled beams"),
                (["aerial", "sky", "plane", "bomber"], "cold high-altitude light with cloud shadow play and flak bursts"),
                (["naval", "ship", "submarine", "destroyer"], "overcast grey sea light with searchlight sweeps and deck lamp glow"),
                (["jungle", "guerrilla", "vietnam", "tropics"], "dense canopy-filtered tropical light with sudden brightness in clearings"),
            ],
            "romance": [
                (["rain", "storm", "umbrella", "downpour"], "soft diffused overcast light with warm glowing windows in background"),
                (["beach", "seaside", "sunset", "shore"], "warm golden hour light wrapping the couple in amber embrace"),
                (["garden", "meadow", "flower", "blossom"], "dappled sunlight through petals and leaves, soft warm luminance"),
                (["city", "rooftop", "skyline", "balcony"], "warm ambient city glow with intimate candlelight or string lights"),
                (["ballroom", "dance", "wedding", "gala"], "warm crystal chandelier light casting soft prismatic patterns"),
            ],
            "food": [
                (["sushi", "japanese", "ramen", "sashimi"], "warm directional side light on clean surfaces, minimal shadow"),
                (["steak", "grill", "bbq", "flame"], "warm fire glow from below with dramatic overhead key light"),
                (["pastry", "dessert", "cake", "chocolate"], "soft warm beauty lighting with gentle gradient background"),
                (["cocktail", "wine", "bar", "spirits"], "moody low-key bar lighting with amber liquid catching a single beam"),
                (["street food", "market", "vendor"], "mixed warm tungsten and cool daylight creating vibrant contrast"),
            ],
            "sci_fi": [
                (["space", "station", "orbit", "shuttle"], "cold vacuum starlight with warm instrument panel glow from within"),
                (["robot", "android", "cybernetic", "mech"], "cold clinical light with LED indicator accents and chrome reflections"),
                (["alien", "planet", "colony", "atmosphere"], "otherworldly ambient light from alien sky, unfamiliar color temperature"),
                (["laboratory", "research", "experiment"], "bright clinical white overhead with colored experiment glow below"),
            ],
            "fantasy": [
                (["castle", "kingdom", "throne", "knight"], "warm torch and firelight flickering on stone walls and armored surfaces"),
                (["enchanted", "magical", "spell", "fairy"], "soft ethereal glow emanating from within, magical particles catching light"),
                (["dragon", "beast", "creature", "wyvern"], "dramatic fire-breath illumination with deep shadows and ember glow"),
                (["dungeon", "cave", "underground", "crypt"], "dim torch light and crystal glow in deep underground darkness"),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee"], "harsh directional light with motion-blurred street lamps and headlights"),
                (["explosion", "fire", "destruction", "blast"], "explosion fireball illumination with shockwave-cast shadows"),
                (["rooftop", "parkour", "urban", "jump"], "harsh directional sun with deep architectural shadows"),
                (["vehicle", "car", "motorcycle", "helicopter"], "streaking headlights and tunnel light flicker at high speed"),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence", "crime scene"], "cold harsh forensic lighting with single overhead spot on evidence"),
                (["chase", "pursuit", "escape", "run"], "intermittent emergency lighting, red exit signs and flickering overheads"),
                (["hostage", "kidnap", "captive", "trapped"], "single bare-bulb harsh light creating oppressive shadows"),
                (["surveillance", "spy", "covert", "shadow"], "ambient low-light with security monitor glow and distant street lamps"),
                (["conspiracy", "paranoia", "cover-up"], "flat institutional fluorescent with paranoid overexposure"),
            ],
        }
        light_ctx = _LIGHTING_CONTEXT_OVERRIDES.get(genre, [])
        if light_ctx:
            desc_lower_light = description.lower()
            for keywords, override_lighting in light_ctx:
                if any(kw in desc_lower_light for kw in keywords):
                    lighting = override_lighting
                    break

        # Evolved lighting across segments — in cinema, lighting shifts to
        # support the emotional arc.  Seg 1 uses _GENRE_LIGHTING above; these
        # provide the progression for segments 2-4.
        _GENRE_LIGHTING_EVOLUTION: dict[str, dict[str, str]] = {
            "fight": {
                "seg2": "high-key clash lighting, sparks illuminating both fighters",
                "seg3": "silhouette rim light on impact, lens flare burst",
                "seg4": "dust-filtered low light settling over the aftermath",
            },
            "xianxia": {
                "seg2": "blinding qi-radiance, the cultivator's body emitting golden light",
                "seg3": "celestial overexposure, divine brightness consuming the frame",
                "seg4": "soft afterglow, warm golden particles drifting through fading mist",
            },
            "ecommerce": {
                "seg2": "angled key light revealing texture and contour",
                "seg3": "hero beauty lighting, soft gradient background bloom",
                "seg4": "elegant low-key spotlight isolating the product",
            },
            "food": {
                "seg2": "warm side-light catching steam and moisture droplets",
                "seg3": "focused macro light revealing texture at peak appetizing appeal",
                "seg4": "gentle warm fill, the dish bathed in inviting golden glow",
            },
            "drama": {
                "seg2": "shifting shadow on the face, emotional chiaroscuro",
                "seg3": "single tear-lit close-up, soft rim light on emotion",
                "seg4": "fading natural light, the scene left in quiet shadow",
            },
            "horror": {
                "seg2": "flickering light source, shadows crawling unpredictably",
                "seg3": "harsh strobe reveal, the horror lit in stark cold flash",
                "seg4": "near-darkness, only faint ambient outlining the silence",
            },
            "nature": {
                "seg2": "shifting dappled sunlight through foliage",
                "seg3": "dramatic backlit moment, animal silhouetted against golden sky",
                "seg4": "soft twilight glow, the habitat settling into dusk warmth",
            },
            "romance": {
                "seg2": "soft candlelight warmth, bokeh points of golden light",
                "seg3": "backlit silhouette moment, sun flare kissing the couple",
                "seg4": "deep amber afterglow, warm diffused light wrapping the scene",
            },
            "thriller": {
                "seg2": "cold fluorescent flicker, uneven pools of harsh light",
                "seg3": "interrogation-bright reveal, over-exposed truth",
                "seg4": "dim emergency lighting, red-tinged unease lingering",
            },
            "war": {
                "seg2": "muzzle flash and explosion bursts cutting through smoke",
                "seg3": "fire-lit chaos, orange flames illuminating the assault",
                "seg4": "overcast grey aftermath, diffused light through settling dust",
            },
            "bollywood": {
                "seg2": "warm amber spotlights catching flowing fabrics",
                "seg3": "dramatic low-angle golden rim light on emotional peak",
                "seg4": "soft golden diffusion, the scene glowing like a painting",
            },
            "cyberpunk": {
                "seg2": "neon sign reflections flickering in puddles and chrome",
                "seg3": "holographic overload, electric blue and magenta flooding the frame",
                "seg4": "rain-dimmed neon afterglow, muted reflections on wet surfaces",
            },
            "kpop": {
                "seg2": "rapid-fire colored gel changes, strobing stage energy",
                "seg3": "spotlight isolation on the performer, everything else dark",
                "seg4": "warm wash fading to single pin spot on the final pose",
            },
            "superhero": {
                "seg2": "power-glow intensifying from the hero, casting dynamic shadows",
                "seg3": "explosive energy burst, lens flare from the impact point",
                "seg4": "settling dust backlit by dawn, hero silhouetted in victory light",
            },
            "noir": {
                "seg2": "cigarette glow and neon sign spill through rain-streaked glass",
                "seg3": "harsh interrogation lamp, face half in blinding light half in shadow",
                "seg4": "dim streetlamp pool in rain, the detective alone in noir darkness",
            },
            "underwater": {
                "seg2": "bioluminescent glow awakening around the subject",
                "seg3": "deep sun shaft piercing through the water column",
                "seg4": "ambient deep-blue fade, gentle caustic patterns on the seafloor",
            },
            "anime": {
                "seg2": "dramatic speedline lighting, power aura illuminating the character",
                "seg3": "screen-flash impact frame, over-exposed energy burst",
                "seg4": "soft wind-swept aftermath light, hair and clothes catching golden rays",
            },
            "western": {
                "seg2": "scorching noon sun casting razor-sharp shadows at the standoff",
                "seg3": "muzzle flash in dust cloud, momentary bright exposure",
                "seg4": "long sunset shadows stretching across the frontier",
            },
            "comedy": {
                "seg2": "bright sitcom-style even lighting, no dramatic shadows",
                "seg3": "spotlight on the punchline moment, theatrical emphasis",
                "seg4": "warm cheerful lighting, everything visible and light-hearted",
            },
            "documentary": {
                "seg2": "natural shifting light as the camera follows the subject",
                "seg3": "close-up available light, intimate and unmanipulated",
                "seg4": "contemplative window light, reflective and quiet",
            },
            "sports": {
                "seg2": "stadium floodlights intensifying on the action zone",
                "seg3": "freeze-frame flash, the winning moment caught in bright clarity",
                "seg4": "warm celebration lighting, confetti catching golden spotlights",
            },
            "sci_fi": {
                "seg2": "holographic display glow intensifying, cool blue data light",
                "seg3": "energy field activation, white-hot technological radiance",
                "seg4": "stabilized ambient glow, the technology humming in cool blue equilibrium",
            },
            "historical": {
                "seg2": "torchlight flickering across stone walls and costumes",
                "seg3": "dramatic shaft of natural light illuminating the subject",
                "seg4": "warm amber settling, the scene aglow in period warmth",
            },
            "music_video": {
                "seg2": "rapid colored gel transitions, stage lights pulsing with the beat",
                "seg3": "single dramatic spotlight, performer backlit through haze",
                "seg4": "warm wash fading to intimate single-source light",
            },
            "fairy_tale": {
                "seg2": "magical sparkle intensifying, enchanted particles glowing brighter",
                "seg3": "radiant spell-light at peak magic, the world aglow",
                "seg4": "gentle stardust settling, warm fairy-light afterglow",
            },
            "dance": {
                "seg2": "dynamic colored stage washes tracking the movement",
                "seg3": "dramatic silhouette moment, dancer backlit in single beam",
                "seg4": "warm amber settling on the final pose, soft theatrical glow",
            },
            "travel": {
                "seg2": "shifting golden hour light painting the landscape",
                "seg3": "dramatic cloudbreak, sun bursting through to illuminate the vista",
                "seg4": "warm sunset afterglow, the destination bathed in farewell light",
            },
            "fashion": {
                "seg2": "angled beauty light catching fabric texture and movement",
                "seg3": "dramatic backlit silhouette, model glowing against bright background",
                "seg4": "soft editorial fill light, elegant and flattering final frame",
            },
            "vfx": {
                "seg2": "energy sources casting dynamic colored shadows",
                "seg3": "peak VFX glow, bright particle systems illuminating everything",
                "seg4": "fading effect light, ambient settling to the new-state luminance",
            },
            "cinematic": {
                "seg2": "shifting golden light as clouds pass, dynamic natural lighting",
                "seg3": "dramatic cloudbreak, the landscape lit in spectacular grandeur",
                "seg4": "warm twilight settling, the vista in farewell golden light",
            },
        }
        light_evo = _GENRE_LIGHTING_EVOLUTION.get(
            genre, _GENRE_LIGHTING_EVOLUTION.get("cinematic", {})
        )

        # Context-aware lighting evolution overrides — nature defaults mention
        # "animal silhouetted" which is wrong for landscape scenes.
        _LIGHT_EVO_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], dict[str, str]]]] = {
            "nature": [
                (["ocean", "sea", "wave", "reef", "coast", "beach",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], {
                    "seg2": "light reflecting off wave surfaces, shifting aquatic glow",
                    "seg3": "dramatic backlit wave spray, sun bursting through cresting water",
                    "seg4": "soft oceanic twilight, warm light playing on calm waters",
                }),
                # Volcano/aurora BEFORE mountain — first match wins,
                # "mountainside" would wrongly match "mountain" otherwise.
                (["volcano", "lava", "eruption", "volcanic"], {
                    "seg2": "molten glow casting orange-red light on surrounding terrain",
                    "seg3": "explosive eruption light, lava illuminating the night sky",
                    "seg4": "cooling embers glowing against dark volcanic landscape",
                }),
                (["aurora", "northern lights", "borealis", "starry", "milky way"], {
                    "seg2": "celestial glow intensifying, colors rippling across the sky",
                    "seg3": "peak aurora radiance, vivid greens and purples filling the heavens",
                    "seg4": "soft celestial afterglow, stars shining through fading aurora",
                }),
                (["mountain", "peak", "summit", "cliff", "alpine"], {
                    "seg2": "shifting clouds casting moving shadows across rock faces",
                    "seg3": "dramatic alpenglow, the summit lit in golden-pink radiance",
                    "seg4": "soft twilight glow, the mountain range silhouetted against fading sky",
                }),
                (["desert", "sand", "dune", "sahara"], {
                    "seg2": "harsh sun casting razor-sharp shadows across dune ridges",
                    "seg3": "dramatic backlit sand spray, golden particles in blazing light",
                    "seg4": "warm sunset painting the desert in deep amber and purple",
                }),
                (["forest", "tree", "jungle", "rainforest", "woodland"], {
                    "seg2": "shifting dappled sunlight filtering through dense canopy",
                    "seg3": "dramatic god rays breaking through the treetops",
                    "seg4": "soft golden light filtering through leaves at golden hour",
                }),
                (["storm", "lightning", "thunder", "rain"], {
                    "seg2": "darkening clouds casting shifting shadow across the landscape",
                    "seg3": "lightning flash illuminating the entire scene in stark white",
                    "seg4": "post-storm light breaking through dispersing clouds",
                }),
            ],
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight", "uppercut", "knockout"], {
                    "seg2": "harsh overhead ring lights intensifying on sweat-soaked fighters",
                    "seg3": "blinding flash on knockout impact, stark white ring lighting",
                    "seg4": "warm spotlight on victor, arena lights dimming around the ring",
                }),
                (["wrestling", "mma", "octagon", "cage"], {
                    "seg2": "harsh cage lighting casting sharp grid shadows on the mat",
                    "seg3": "intense spotlight on submission attempt, dramatic shadow play",
                    "seg4": "spotlight isolating the winner, crowd in atmospheric darkness",
                }),
                (["swimming", "diving", "pool"], {
                    "seg2": "pool lane lighting with rippling underwater caustics intensifying",
                    "seg3": "bright surface light bursting as swimmer breaks through water",
                    "seg4": "soft pool glow settling, gentle underwater light play",
                }),
                (["racing", "formula", "motorsport"], {
                    "seg2": "harsh track lighting with headlamp flare streaking through frame",
                    "seg3": "dramatic backlit spray on overtake, lens flare from headlights",
                    "seg4": "checkered flag lighting, warm golden celebratory glow",
                }),
                (["tennis", "racket", "court"], {
                    "seg2": "bright court lighting casting crisp shadow on playing surface",
                    "seg3": "dramatic sun glare through serve toss, ball catching harsh light",
                    "seg4": "warm evening court light settling, long player shadows",
                }),
            ],
            "horror": [
                (["psychological", "mind", "insanity", "hallucination"], {
                    "seg2": "harsh single-source interrogation light with deep shadows",
                    "seg3": "rapid flickering strobe revealing something wrong",
                    "seg4": "near-total darkness with faint sourceless glow",
                }),
                # Supernatural/demon BEFORE slasher — "stalk" is too generic.
                (["supernatural", "demon", "possession", "curse", "creature", "monster"], {
                    "seg2": "sickly pulsing underglow with unnatural color shifts",
                    "seg3": "explosive supernatural light burst from entity",
                    "seg4": "dim ashen aftermath, pale otherworldly residue glow",
                }),
                (["slasher", "knife", "stalk", "killer"], {
                    "seg2": "moonlight through trees casting slashing shadows",
                    "seg3": "sudden harsh light on blade glint, blinding flash",
                    "seg4": "dim red-tinged aftermath, emergency light pulse",
                }),
                (["found footage", "vhs", "tape", "camera"], {
                    "seg2": "harsh camera-mounted light cone in pitch darkness",
                    "seg3": "night vision green wash with infrared flare",
                    "seg4": "camera light failing, intermittent dark flashes",
                }),
            ],
            "dance": [
                (["ballet", "ballerina", "pointe", "classical"], {
                    "seg2": "soft warm follow-spot tracking the dancer's arc",
                    "seg3": "dramatic single spotlight isolating the final pose",
                    "seg4": "gentle stage wash dimming to intimate amber glow",
                }),
                (["breakdance", "bboy", "popping", "street"], {
                    "seg2": "harsh overhead fluorescent with urban grit shadows",
                    "seg3": "dramatic backlit silhouette during power move",
                    "seg4": "warm street-light amber settling on final freeze",
                }),
                (["concert", "festival", "stage", "crowd"], {
                    "seg2": "pulsing colored stage lights sweeping the venue",
                    "seg3": "blinding pyrotechnic flash and strobe peak",
                    "seg4": "warm golden house lights rising for curtain call",
                }),
            ],
            "war": [
                (["medieval", "sword", "siege", "knight", "castle"], {  # "battle" too broad — matches "Civil War battle"
                    "seg2": "torch-lit chaos casting flickering orange on armor",
                    "seg3": "fire-siege blinding light, flaming projectile flash",
                    "seg4": "smoke-filtered dawn light on the aftermath field",
                }),
                (["samurai", "katana", "duel", "shogun"], {
                    "seg2": "soft diffused overcast light, contemplative mood",
                    "seg3": "blade-flash catching harsh directional sunlight",
                    "seg4": "golden sunset silhouetting the victor",
                }),
                (["sniper", "scope", "tactical"], {
                    "seg2": "cold blue surveillance light, night vision ambient",
                    "seg3": "muzzle flash harsh white burst in darkness",
                    "seg4": "dim grey dawn light, muted operational afterglow",
                }),
            ],
            "romance": [
                (["wedding", "ceremony", "bride", "aisle"], {
                    "seg2": "soft warm light wrapping the couple in romantic haze",
                    "seg3": "warm vow-light, radiance on faces",
                    "seg4": "champagne celebration sparkle, warm joyful glow",
                }),
                (["farewell", "goodbye", "departure", "leaving"], {
                    "seg2": "melancholic side light with long dramatic shadows",
                    "seg3": "harsh backlit silhouette against bright departure",
                    "seg4": "dim fading light, empty space in muted tones",
                }),
            ],
            "sci_fi": [
                (["space", "zero-g", "station", "orbit"], {
                    "seg2": "harsh sunlight/shadow boundary of space vacuum",
                    "seg3": "blinding solar flare or engine ignition burst",
                    "seg4": "soft Earth-glow blue ambient on station hull",
                }),
                (["mecha", "robot", "cockpit", "pilot"], {
                    "seg2": "cockpit HUD glow casting green-amber on pilot face",
                    "seg3": "weapons-fire flash, explosive white-orange burst",
                    "seg4": "emergency red warning lights pulsing in damaged cockpit",
                }),
            ],
            "food": [
                (["sushi", "nigiri", "sashimi", "maki"], {
                    "seg2": "warm side-light catching glossy fish surface",
                    "seg3": "close macro light revealing rice grain texture",
                    "seg4": "soft ambient glow settling on finished plate",
                }),
                (["grill", "sizzle", "bbq", "steak"], {
                    "seg2": "fire glow from below casting warm orange uplight",
                    "seg3": "intense searing light and steam backlit dramatically",
                    "seg4": "warm resting light, golden and appetizing",
                }),
                (["pour", "drizzle", "ganache", "sauce", "chocolate"], {
                    "seg2": "studio highlight catching viscous flow surface",
                    "seg3": "dramatic backlight through translucent liquid",
                    "seg4": "soft diffused glow on glossy finished surface",
                }),
                (["bake", "oven", "bread", "pastry"], {
                    "seg2": "warm oven glow spilling golden light outward",
                    "seg3": "steam backlit by warm golden interior light",
                    "seg4": "soft natural window light on cooling baked goods",
                }),
            ],
            "fantasy": [
                (["dragon", "fire", "flame", "breath"], {
                    "seg2": "firelight casting flickering orange-red on rock walls",
                    "seg3": "blinding dragon-fire illumination, white-hot center",
                    "seg4": "smoldering ember glow fading to dramatic darkness",
                }),
                (["spell", "magic", "enchant", "wizard"], {
                    "seg2": "arcane glow building, blue-violet ethereal light",
                    "seg3": "spell-burst radiance, blinding magical flash",
                    "seg4": "residual magical shimmer settling to ambient",
                }),
                (["forest", "fairy", "elf", "woodland"], {
                    "seg2": "dappled sunlight through enchanted canopy",
                    "seg3": "fairy-light glow intensifying in clearing",
                    "seg4": "soft mystical twilight, bioluminescent glow",
                }),
            ],
            "anime": [
                (["mecha", "robot", "transform"], {
                    "seg2": "dramatic rim-light silhouette against explosion",
                    "seg3": "transformation energy burst, blinding white flash",
                    "seg4": "heroic backlit pose, lens flare and dramatic shadow",
                }),
                (["school", "slice", "cafe"], {
                    "seg2": "warm afternoon window light, golden and nostalgic",
                    "seg3": "soft diffused classroom light, gentle and even",
                    "seg4": "warm sunset orange flooding through windows",
                }),
            ],
            "documentary": [
                (["interview", "testimony", "witness"], {
                    "seg2": "steady key light with subtle fill, professional setup",
                    "seg3": "emotional close-up lighting, dramatic but natural",
                    "seg4": "contemplative soft light, thoughtful atmosphere",
                }),
                (["nature", "wildlife", "animal"], {
                    "seg2": "natural golden-hour light warming the landscape",
                    "seg3": "dramatic directional light catching the subject",
                    "seg4": "soft dusk light settling, peaceful resolution",
                }),
            ],
            "comedy": [
                (["slapstick", "physical", "fall"], {
                    "seg2": "bright even lighting, clear visibility for gag",
                    "seg3": "flash of impact, comedic spotlight moment",
                    "seg4": "aftermath lighting, bright and revealing",
                }),
                (["party", "celebration"], {
                    "seg2": "colorful party lights, festive multi-hue glow",
                    "seg3": "strobe and flash effects, peak celebration light",
                    "seg4": "warm post-party glow, contented ambient",
                }),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], {
                    "seg2": "warm marigold-golden festive lighting, flickering diya glow",
                    "seg3": "blazing mandap firelight with sparkler illumination",
                    "seg4": "soft warm amber romantic afterglow settling",
                }),
                (["rain", "monsoon", "barish"], {
                    "seg2": "diffused overcast light through rain, wet surface reflections",
                    "seg3": "dramatic backlit rain silhouette, lightning flash illumination",
                    "seg4": "post-rain golden light breaking through clouds",
                }),
                (["dance", "garba", "dandiya", "kathak"], {
                    "seg2": "vibrant stage lighting with colored gel washes",
                    "seg3": "pulsing neon and spotlight sweeps at peak intensity",
                    "seg4": "warm golden finale spotlight, single dramatic pool",
                }),
                (["emotional", "farewell", "bidaai", "departure"], {
                    "seg2": "soft diffused emotional light, warm window glow",
                    "seg3": "harsh directional farewell light, dramatic shadows on face",
                    "seg4": "fading twilight amber, melancholic last-light warmth",
                }),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], {
                    "seg2": "neon signage reflections intensifying on wet pavement",
                    "seg3": "holographic ad overload, fractured neon flooding the frame",
                    "seg4": "rain-muted neon afterglow, puddle reflections settling",
                }),
                (["rooftop", "skyline", "tower", "aerial"], {
                    "seg2": "city neon glow building beneath thick cloud layer",
                    "seg3": "lightning flash over the megacity, neon and natural light colliding",
                    "seg4": "dimmed city haze, distant tower beacons pulsing slowly",
                }),
                (["club", "rave", "underground", "bar"], {
                    "seg2": "UV blacklight intensifying, chrome surfaces catching laser lines",
                    "seg3": "strobe peak, freeze-frame white flash in the crowd",
                    "seg4": "warm amber house lights rising, the haze settling",
                }),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee", "run"], {
                    "seg2": "harsh shifting streetlight as subject races through urban environment",
                    "seg3": "blinding headlight flare on collision moment",
                    "seg4": "dim alley aftermath, single distant light source",
                }),
                (["explosion", "fire", "destruction", "blast"], {
                    "seg2": "growing firelight casting long dancing shadows",
                    "seg3": "blinding white-orange fireball flash, shockwave shadow",
                    "seg4": "smoldering ember glow through settling dust and smoke",
                }),
                (["rooftop", "parkour", "urban", "jump"], {
                    "seg2": "harsh directional sun with deep shadow between buildings",
                    "seg3": "backlit silhouette mid-leap, sun flare through limbs",
                    "seg4": "warm rooftop golden-hour light on final landing",
                }),
                (["vehicle", "car", "motorcycle", "helicopter"], {
                    "seg2": "streaking headlights and tunnel light flicker accelerating",
                    "seg3": "dramatic impact flash, sparks and glass catching harsh light",
                    "seg4": "dust-filtered roadside light settling on wreckage",
                }),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence"], {
                    "seg2": "cold desk lamp cutting through office darkness",
                    "seg3": "harsh evidence-room fluorescent revealing the connection",
                    "seg4": "dim contemplative light, weight of discovery settling",
                }),
                (["chase", "escape", "stalker", "pursuit"], {
                    "seg2": "shifting shadows as pursuer closes in",
                    "seg3": "sudden harsh light burst on confrontation",
                    "seg4": "dim post-chase exhaustion, muted safety light",
                }),
                (["hostage", "captive", "interrogation", "cell"], {
                    "seg2": "harsh single overhead bulb, total darkness beyond",
                    "seg3": "blinding interrogation lamp turned to face",
                    "seg4": "dim residual glow, aftermath darkness closing in",
                }),
            ],
        }
        light_evo_overrides = _LIGHT_EVO_CONTEXT_OVERRIDES.get(genre, [])
        if light_evo_overrides:
            desc_lower_light = description.lower()
            for keywords, override_light in light_evo_overrides:
                if any(kw in desc_lower_light for kw in keywords):
                    light_evo = {**light_evo, **override_light}
                    break

        # Genre-specific quality/resolution tokens + film vocabulary.
        # Seedance responds well to both resolution cues and industry-specific
        # terminology.  Each genre includes its cinematic vocabulary to guide
        # the model toward the right visual language.
        _GENRE_QUALITY: dict[str, str] = {
            "fight": "8K ultra-detailed, motion blur on impacts, wuxia wire-work precision",
            "xianxia": "ultra-fine CG rendering, 8K detail, xianxia cultivation aesthetics",
            "ecommerce": "studio-quality 4K, crisp product hero shot, catalog-grade clarity",
            "food": "8K macro hero shot, hyper-realistic food photography textures",
            "drama": "film-quality 4K, natural grain, mise-en-scène storytelling",
            "popscience": "ultra-realistic 4K medical CGI, educational clarity",
            "kpop": "4K broadcast quality, vivid HDR, idol-cam choreography",
            "fantasy": "8K CG quality, hyper-detailed, epic tableau composition",
            "action": "high-framerate action clarity, 4K, Bourne-style kinetic energy",
            "horror": "gritty 4K, subtle noise texture, dread-inducing stillness",
            "cinematic": "8K cinematic, filmic quality, auteur-grade composition",
            "nature": "8K nature documentary, hyper-real detail, Planet Earth caliber",
            "documentary": "4K cinéma vérité, observational naturalism, raw authenticity",
            "sci_fi": "8K CG quality, photorealistic sci-fi, volumetric lighting, Blade Runner atmosphere",
            "sports": "4K broadcast quality, high-framerate athletic clarity, ESPN replay grade",
            "anime": "sakuga-quality animation, detailed cel shading, vivid color palette",
            "romance": "8K cinematic, soft film grain, romantic warmth",
            "thriller": "4K gritty realism, desaturated tones, Fincher-precise composition",
            "comedy": "4K bright and clean, vivid colors, sharp comedic timing clarity",
            "war": "8K cinematic war film, Saving Private Ryan grain, visceral handheld realism",
            "historical": "8K period drama, rich filmic grain, Kubrick-grade period detail",
            "western": "8K cinematic western, sun-bleached film stock, Sergio Leone grandeur",
            "cyberpunk": "8K photorealistic cyberpunk, neon-reflective surfaces, Ghost in the Shell atmosphere",
            "music_video": "4K broadcast quality, high-contrast stage lighting, music video glamour",
            "superhero": "8K VFX blockbuster quality, MCU-grade CG, dynamic volumetric effects",
            "noir": "4K film noir aesthetic, rich grain texture, classic Hollywood chiaroscuro",
            "underwater": "8K underwater cinematography, crystal-clear aquatic detail, Blue Planet caliber",
            "fairy_tale": "8K fantasy illustration quality, magical storybook detail, painterly luminosity",
            "dance": "4K performance capture quality, high-framerate motion clarity, choreographic precision",
            "travel": "8K cinematic travel photography, drone-quality aerials, National Geographic beauty",
            "fashion": "4K editorial photography quality, Vogue-grade styling, luxurious texture rendering",
            "vfx": "4K visual effects quality, clean particle rendering, seamless compositing",
            "bollywood": "8K cinematic, Yash Raj production value, rich filmic depth",
        }
        quality_tag = _GENRE_QUALITY.get(genre, "cinematic quality")

        # Build segments based on duration
        desc = description.rstrip(".")

        # Subject anchor: first phrase unit from description, capped at a
        # natural boundary (comma or period) to avoid mid-sentence truncation.
        # Strip leading articles for more natural mid-sentence use.
        # ByteDance's own prompts repeat the subject in later segments.
        _STRIP_LEADING = {"a", "an", "the", "this", "that", "some", "with", "in", "on", "at", "from", "for"}
        # Split on commas and periods to find phrase boundaries
        import re
        phrases = re.split(r"[,.]", desc)
        anchor_phrase = phrases[0].strip()
        # Cap at ~8 words — shorter anchors reduce repetition bloat
        # while still grounding Seedance on the subject.
        # When truncating, prefer cutting before a preposition to avoid
        # dangling phrases like "at a fine dining" (missing the noun).
        _CUT_BEFORE = {"at", "in", "on", "from", "with", "by", "for",
                        "through", "during", "under", "near", "above", "below"}
        anchor_words = anchor_phrase.split()
        if len(anchor_words) > 8:
            # Scan backward from word 8 to find a preposition boundary
            cut = 8
            for j in range(7, 3, -1):  # words 7→4 (0-indexed)
                if anchor_words[j].lower() in _CUT_BEFORE:
                    cut = j
                    break
            anchor_words = anchor_words[:cut]
        # Strip leading articles/prepositions
        while len(anchor_words) > 2 and anchor_words[0].lower() in _STRIP_LEADING:
            anchor_words = anchor_words[1:]
        desc_anchor = " ".join(anchor_words).rstrip(",.")

        # Short anchor for later segments (13-15s, 4 segments).
        # Repeating the full anchor 4× bloats 15s prompts to 1300+ chars.
        # Seg 3-4 use a condensed anchor (first 4 words max, was 6) since
        # segment phrases already carry the narrative progression.
        # After truncation, strip trailing prepositions/articles so the anchor
        # doesn't end on dangling words like "duel in" or "cake being".
        _TRAILING_STRIP = {"in", "on", "at", "the", "a", "an", "with", "of",
                           "for", "to", "from", "by", "and", "or", "being",
                           "is", "are", "was", "were", "its", "their",
                           "his", "her", "my", "our", "your",
                           "first", "last", "next", "final", "new", "old"}
        short_anchor_words = anchor_words[:4] if len(anchor_words) > 4 else anchor_words
        while len(short_anchor_words) > 2 and short_anchor_words[-1].lower() in _TRAILING_STRIP:
            short_anchor_words = short_anchor_words[:-1]
        desc_anchor_short = " ".join(short_anchor_words).rstrip(",.")

        # Genre-specific lens / depth-of-field directives.
        # In cinema, lens choice is as important as lighting — it shapes
        # spatial perception, subject isolation, and visual texture.
        # Seedance interprets these cues to control focus falloff, bokeh,
        # and field compression, significantly improving visual depth.
        _GENRE_LENS: dict[str, str] = {
            "fight": "anamorphic lens with motion-tracked focus",
            "xianxia": "ethereal soft focus with energy-glow diffusion",
            "ecommerce": "sharp macro lens with clean bokeh background",
            "food": "macro tilt-shift lens with extreme shallow focus",
            "drama": "50mm prime lens with intimate shallow depth",
            "popscience": "precision macro lens with clinical focus",
            "kpop": "wide-angle lens with distorted close-up energy",
            "fantasy": "vintage anamorphic with dreamy halation",
            "action": "wide-angle lens with handheld focus pull",
            "horror": "distorted wide lens with uncomfortable close focus",
            "nature": "telephoto lens with compressed atmospheric depth",
            "documentary": "natural lens with observational depth of field",
            "bollywood": "anamorphic lens with golden bokeh circles",
            "sci_fi": "anamorphic widescreen with chromatic aberration",
            "sports": "telephoto lens with razor-sharp subject isolation",
            "anime": "flat cel-shaded focus with sharp outlines",
            "romance": "vintage soft-focus lens with dreamy bokeh",
            "thriller": "cold prime lens with clinical shallow focus",
            "comedy": "neutral lens with clean even focus",
            "war": "gritty handheld lens with chaotic rack focus",
            "historical": "vintage coated lens with period-accurate softness",
            "western": "anamorphic widescreen with dust-filtered flare",
            "cyberpunk": "anamorphic lens with neon bokeh and chromatic split",
            "music_video": "wide-angle lens with dramatic rack focus",
            "superhero": "anamorphic with power-surge lens flare",
            "noir": "uncoated lens with soft halation",
            "underwater": "dome port wide-angle with aquatic distortion",
            "fairy_tale": "soft-focus diffusion lens with storybook glow",
            "dance": "wide-angle lens with full-body framing depth",
            "travel": "wide-angle with deep environmental focus",
            "fashion": "portrait lens with creamy subject-isolating bokeh",
            "vfx": "clean digital lens with sharp edge-to-edge clarity",
            "cinematic": "anamorphic 2.39:1 with cinematic lens breathing",
        }
        lens = _GENRE_LENS.get(genre, "cinematic lens")

        # Context-aware lens overrides — sub-genres need specific optics.
        # E.g. boxing needs ringside tight lens, swimming needs split-level.
        _LENS_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], str]]] = {
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight"], "tight ringside telephoto with sweat-droplet shallow focus"),
                (["wrestling", "mma", "octagon", "cage"], "close cage-side lens with grapple-tracking focus"),
                (["swimming", "diving", "pool"], "split-level wide-angle with above/below waterline distortion"),
                (["racing", "formula", "motorsport"], "tracking telephoto with extreme motion blur background"),
                (["tennis", "racket", "court"], "baseline telephoto with shallow focus on ball contact"),
                (["gymnastics", "vault", "beam"], "wide-angle lens with full-routine framing depth"),
            ],
            "nature": [
                (["underwater", "coral", "reef"], "dome port wide-angle with underwater caustic distortion"),
                (["aurora", "northern lights", "borealis"], "ultra-wide fisheye with full-sky atmospheric depth"),
                (["volcano", "lava", "eruption"], "heat-resistant telephoto with volcanic distortion shimmer"),
                (["ocean", "wave", "surf"], "waterproof wide-angle with spray-on-lens texture"),
            ],
            "horror": [
                (["found footage", "vhs", "handheld", "tape"], "raw shaky camcorder with VHS noise texture"),
                (["slasher", "stalk", "killer"], "stalking telephoto with menacing shallow focus"),
                (["body", "gore", "visceral"], "clinical macro lens with unflinching detail"),
                (["supernatural", "demon", "possession"], "distorted wide-angle with barrel aberration"),
            ],
            "war": [
                (["sniper", "scope", "aim"], "extreme telephoto with compressed depth and scope vignette"),
                (["medieval", "sword", "siege", "knight"], "gritty wide-angle with foreground warrior depth"),  # "battle" too broad
                (["tank", "armor", "armored"], "low wide-angle with crushing perspective distortion"),
            ],
            "sci_fi": [
                # "space" alone is too broad (matches "spaceship") — use specific EVA/station terms.
                (["zero-g", "spacewalk", "eva", "helmet", "airlock"], "fisheye helmet-cam with curved horizon distortion"),
                (["mecha", "robot", "cockpit"], "tight cockpit fisheye with HUD overlay bokeh"),
                (["hologram", "interface", "data"], "shallow focus on holographic depth with chromatic aberration"),
            ],
            "dance": [
                (["ballet", "ballerina", "classical"], "soft-focus telephoto with dreamy bokeh isolation"),
                (["breakdance", "bboy", "street"], "low wide-angle capturing floor-level power moves"),
                (["concert", "festival", "stage"], "anamorphic wide with stage-light flare distortion"),
            ],
            "food": [
                (["sushi", "nigiri", "sashimi"], "macro tilt-shift with extreme shallow focus on knife edge"),
                (["pour", "drizzle", "ganache", "sauce"], "overhead macro with viscous flow tracking"),
                (["grill", "sizzle", "bbq", "steak"], "low-angle close-up with heat shimmer distortion"),
                (["bake", "oven", "pastry", "bread"], "warm soft-focus with golden bokeh glow"),
            ],
            "fantasy": [
                (["dragon", "fire", "flame", "breath"], "wide anamorphic with heat distortion and fire glow"),
                (["spell", "magic", "enchant", "wizard"], "swirling macro with ethereal bokeh particles"),
                (["forest", "fairy", "elf", "woodland"], "dreamy soft-focus telephoto with dappled bokeh"),
                (["treasure", "cave", "dungeon"], "dark wide-angle with torch-lit vignette"),
            ],
            "anime": [
                (["mecha", "robot", "transform"], "dynamic low-angle with speed-line radial blur"),
                (["school", "slice", "cafe"], "warm mid-shot with gentle soft-focus background"),
                (["magic", "spell", "enchant"], "dramatic close-up with prismatic lens flare"),
            ],
            "documentary": [
                (["interview", "testimony", "witness"], "steady mid-shot with shallow depth of field"),
                (["archive", "historical", "footage"], "degraded film-grain lens with period softness"),
                (["nature", "wildlife", "animal"], "telephoto with wildlife observation compression"),
            ],
            "comedy": [
                (["slapstick", "physical", "fall"], "exaggerated wide-angle with comedic distortion"),
                (["awkward", "cringe", "reaction"], "tight close-up with uncomfortable shallow focus"),
                (["party", "celebration", "chaos"], "handheld wide-angle with chaotic energy"),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], "crane-mounted anamorphic with golden festive bokeh"),
                (["rain", "monsoon", "barish"], "romantic soft-focus with rain-droplet lens texture"),
                (["dance", "garba", "dandiya", "kathak"], "sweeping tracking lens with colorful motion blur"),
                (["fight", "action", "dishoom"], "dynamic low-angle with heroic slow-motion distortion"),
                (["emotional", "farewell", "bidaai", "departure"], "intimate close-up with tear-glistening shallow focus"),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], "wide anamorphic with neon bokeh bleeding and rain-streaked distortion"),
                (["rooftop", "skyline", "tower", "aerial"], "ultra-wide with chromatic aberration and smog diffusion"),
                (["club", "bar", "underground", "rave"], "fisheye with holographic lens flare and strobe distortion"),
                (["chase", "pursuit", "escape"], "handheld with motion blur streaks and neon smear"),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence"], "clinical macro with shallow focus on evidence detail"),
                (["chase", "pursuit", "escape", "run"], "handheld with unstable focus pull and claustrophobic framing"),
                (["hostage", "kidnap", "captive", "trapped"], "locked-off wide with oppressive surveillance-cam distortion"),
                (["surveillance", "spy", "covert", "shadow"], "telephoto with compressed depth and voyeuristic distance"),
            ],
            "action": [
                (["chase", "pursuit", "escape"], "wide-angle with speed-blur and foreground whip-pan distortion"),
                (["explosion", "fire", "destruction", "blast"], "wide anamorphic with shockwave distortion and heat shimmer"),
                (["fight", "combat", "brawl", "punch"], "tight handheld with impact-shake and shallow focus punch"),
                (["vehicle", "car", "motorcycle", "helicopter"], "tracking telephoto with extreme motion blur background"),
            ],
        }
        lens_ctx = _LENS_CONTEXT_OVERRIDES.get(genre, [])
        if lens_ctx:
            desc_lower_lens = description.lower()
            for keywords, override_lens in lens_ctx:
                if any(kw in desc_lower_lens for kw in keywords):
                    lens = override_lens
                    break

        # Woven atmosphere string: merge lighting + color + lens into a
        # single vivid phrase that sets the visual foundation for segment 1.
        col_str = " with ".join(col[:2]) if len(col) >= 2 else (col[0] if col else "cinematic tones")
        atmosphere = f"{lighting}, {col_str}, {lens}"

        # Genre-aware audio verb — more cinematic than generic "Sound:"
        _AUDIO_VERBS: dict[str, str] = {
            "fight": "Impact audio:",
            "xianxia": "Ethereal soundscape:",
            "food": "ASMR audio:",
            "horror": "Dread soundscape:",
            "nature": "Natural ambience:",
            "noir": "Noir soundscape:",
            "underwater": "Deep ocean audio:",
            "romance": "Tender audio:",
            "war": "Battlefield audio:",
            "kpop": "Beat:",
            "dance": "Rhythm:",
            "music_video": "Track:",
            "thriller": "Tension audio:",
            "fantasy": "Mystical soundscape:",
            "sci_fi": "Sci-fi soundscape:",
            "cyberpunk": "Neon soundscape:",
            "superhero": "Heroic soundscape:",
            "sports": "Stadium audio:",
            "bollywood": "Bollywood score:",
            "documentary": "Ambient audio:",
            "comedy": "Comedic audio:",
            "western": "Frontier audio:",
            "historical": "Period audio:",
            "anime": "Anime soundscape:",
            "fairy_tale": "Enchanted audio:",
            "ecommerce": "Product audio:",
            "popscience": "Scientific audio:",
            "vfx": "FX audio:",
            "travel": "Ambient audio:",
            "fashion": "Runway audio:",
            "drama": "Dramatic audio:",
        }
        audio_verb = _AUDIO_VERBS.get(genre, "Sound:")

        # Genre-specific pacing directives — tells Seedance the tempo/rhythm
        # of the video. This is a missing dimension: current prompts describe
        # WHAT to show but not HOW FAST. A fight should cut rapidly; food
        # should linger. Injected once into segment 1 to influence the whole
        # clip's feel.
        _GENRE_PACING: dict[str, str] = {
            "fight": "high-energy rapid pacing with swift cuts",
            "xianxia": "building celestial momentum, slow to explosive",
            "ecommerce": "smooth deliberate pacing, elegant and controlled",
            "food": "slow luxurious pacing, lingering on every texture",
            "drama": "measured emotional pacing with weighted pauses",
            "popscience": "steady exploratory pacing, curious and precise",
            "kpop": "high-tempo rhythmic pacing, beat-synchronized",
            "fantasy": "sweeping epic pacing, building to grandeur",
            "action": "accelerating kinetic pacing, relentless momentum",
            "horror": "crawling dread pacing with sudden jolts",
            "nature": "patient observational pacing, unhurried and reverent",
            "documentary": "measured contemplative pacing, thoughtful rhythm",
            "bollywood": "dramatic rhythmic pacing, emotionally expansive",
            "sci_fi": "precise technological pacing, building system energy",
            "sports": "explosive athletic pacing, burst and recovery",
            "anime": "dynamic manga-panel pacing, rapid with freeze frames",
            "romance": "gentle flowing pacing, tender and unhurried",
            "thriller": "tightening suspense pacing, escalating unease",
            "comedy": "snappy timing with comedic beats and pauses",
            "war": "urgent battlefield pacing, chaos and determination",
            "historical": "stately period pacing, grand and deliberate",
            "western": "tense frontier pacing, long beats then sudden action",
            "cyberpunk": "frenetic neon-pulse pacing, data-stream rhythm",
            "music_video": "beat-driven visual pacing, synced to rhythm",
            "superhero": "building heroic momentum, impact then stillness",
            "noir": "languorous noir pacing, smoke-slow with sharp reveals",
            "underwater": "dreamlike fluid pacing, weightless and mesmerizing",
            "fairy_tale": "gentle storybook pacing, wonder building softly",
            "dance": "rhythmic body-driven pacing, motion as music",
            "travel": "wandering exploratory pacing, discovery and awe",
            "fashion": "runway-precise pacing, confident and editorial",
            "vfx": "building spectacle pacing, setup to payoff",
            "cinematic": "sweeping cinematic pacing, deliberate and grand",
        }
        pacing = _GENRE_PACING.get(genre, "cinematic pacing")

        # Context-aware pacing overrides — genre defaults are too generic
        # for sub-genres.  E.g. sports uses "explosive athletic" but
        # swimming should be "fluid rhythmic", not explosive.
        _PACING_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], str]]] = {
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight"], "explosive staccato pacing, rapid burst exchanges"),
                (["wrestling", "mma", "grapple", "octagon"], "grinding relentless pacing, pressure and submission"),
                (["swimming", "diving", "pool"], "fluid rhythmic pacing, streamlined and continuous"),
                (["racing", "formula", "motorsport"], "blistering high-speed pacing, lap after relentless lap"),
                (["tennis", "racket"], "rally-driven pacing, tension building point by point"),
                (["gymnastics", "vault", "beam"], "precise controlled pacing, stillness then explosive burst"),
            ],
            "nature": [
                (["ocean", "sea", "wave",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], "rhythmic wave-driven pacing, surging and receding"),
                (["storm", "lightning", "thunder"], "building urgent pacing, accelerating to peak fury"),
                (["volcano", "lava", "eruption"], "rumbling escalating pacing, building to explosive release"),
                (["desert", "sand", "dune"], "vast unhurried pacing, timeless and still"),
            ],
            "horror": [
                (["psychological", "mind", "insanity"], "disorienting uneven pacing, reality-fracturing rhythm"),
                (["supernatural", "demon", "creature", "monster"], "dread building pacing, slow then explosive burst"),
                (["slasher", "knife", "stalk", "killer"], "stalking deliberate pacing, tense then violent"),
                (["found footage", "vhs", "handheld"], "frantic unsteady pacing, panic accelerating"),
            ],
            "dance": [
                (["ballet", "ballerina", "pointe"], "graceful flowing pacing, elegant and measured"),
                (["breakdance", "bboy", "popping"], "beat-locked pacing, freeze then explode"),
                (["tango", "flamenco"], "passionate rhythmic pacing, tension and release"),
                (["concert", "festival", "stage"], "crowd-energy pacing, building to fever pitch"),
            ],
            "war": [
                (["medieval", "sword", "shield", "siege"], "chaotic clash pacing, waves of brutal contact"),  # "battle" too broad
                (["samurai", "katana", "duel"], "contemplative stillness then single explosive beat"),
                (["sniper", "scope", "tactical"], "methodical patient pacing, one decisive moment"),
                (["tank", "armor"], "heavy grinding pacing, relentless forward advance"),
            ],
            "sci_fi": [
                (["zero-g", "weightless", "float"], "dreamlike suspended pacing, slow and weightless"),
                (["mecha", "robot", "cockpit"], "heavy mechanical pacing, servo-driven rhythm"),
                (["hologram", "interface", "data"], "rapid data-flow pacing, digital precision"),
            ],
            "food": [
                (["sushi", "nigiri", "sashimi"], "precise deliberate pacing, zen-like calm"),
                (["grill", "sizzle", "bbq", "steak"], "slow luxurious pacing, lingering on every texture"),
                (["pour", "drizzle", "ganache", "sauce"], "hypnotic flowing pacing, viscous slow-motion"),
                (["bake", "oven", "pastry"], "warm patient pacing, anticipation building"),
                (["chop", "slice", "dice"], "rhythmic percussive pacing, blade-beat tempo"),
            ],
            "fantasy": [
                (["dragon", "fire", "breath"], "epic escalating pacing, mythic grandeur"),
                (["spell", "magic", "enchant", "wizard"], "mystical building pacing, incantation rhythm"),
                (["forest", "fairy", "elf"], "ethereal dreamlike pacing, timeless wonder"),
                (["treasure", "quest", "dungeon"], "adventurous accelerating pacing, discovery momentum"),
            ],
            "anime": [
                (["mecha", "robot", "transform"], "heavy mechanical pacing with dramatic pauses"),
                (["school", "slice", "cafe"], "gentle everyday pacing, warm and unhurried"),
                (["magic", "spell", "power"], "escalating dramatic pacing, power-up build"),
            ],
            "documentary": [
                (["interview", "testimony"], "measured conversational pacing, thoughtful pauses"),
                (["archive", "historical"], "somber reflective pacing, weight of history"),
                (["nature", "wildlife", "animal"], "patient observational pacing, nature's rhythm"),
            ],
            "comedy": [
                (["slapstick", "physical", "fall"], "rapid chaotic pacing, comedic timing beats"),
                (["awkward", "cringe", "reaction"], "excruciating slow pacing, drawn-out discomfort"),
                (["party", "celebration"], "frenetic joyful pacing, escalating energy"),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], "grand celebratory pacing, joyous and expansive"),
                (["rain", "monsoon", "barish"], "romantic slow-motion pacing, yearning and tender"),
                (["dance", "garba", "dandiya", "kathak"], "rhythmic percussive pacing, beat-driven energy"),
                (["fight", "action", "dishoom"], "heroic escalating pacing, dramatic with slow-motion peaks"),
                (["emotional", "farewell", "bidaai"], "aching drawn-out pacing, heavy emotional weight"),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], "gritty street-level pacing, restless urban rhythm"),
                (["rooftop", "skyline", "tower", "aerial"], "sweeping vertical pacing, ascending scale revelation"),
                (["club", "bar", "underground", "rave"], "bass-driven pulsing pacing, syncopated and relentless"),
                (["chase", "pursuit", "escape", "flee"], "breakneck neon-blur pacing, no room to breathe"),
                (["hack", "data", "interface", "terminal"], "rapid data-cascade pacing, digital precision"),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence"], "methodical forensic pacing, slow build to revelation"),
                (["chase", "pursuit", "escape", "run"], "accelerating panic pacing, claustrophobic urgency"),
                (["hostage", "kidnap", "captive", "trapped"], "suffocating slow pacing, unbearable stillness then bursts"),
                (["surveillance", "spy", "covert", "shadow"], "patient calculated pacing, meticulous then sudden"),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee"], "breakneck velocity pacing, obstacles flying past"),
                (["explosion", "fire", "destruction", "blast"], "building detonation pacing, setup to massive payoff"),
                (["fight", "combat", "brawl", "punch"], "rapid exchange pacing, burst combos then recovery"),
                (["vehicle", "car", "motorcycle", "helicopter"], "screaming mechanical pacing, redline engine rhythm"),
            ],
        }
        pacing_ctx = _PACING_CONTEXT_OVERRIDES.get(genre, [])
        if pacing_ctx:
            desc_lower_pacing = description.lower()
            for keywords, override_pacing in pacing_ctx:
                if any(kw in desc_lower_pacing for kw in keywords):
                    pacing = override_pacing
                    break

        # Genre-specific motion intensity — tells Seedance how much
        # physical movement to render.  Fight scenes need explosive
        # motion; food scenes need almost none (just steam/light).
        # This complements pacing (rhythm) with a motion amount cue.
        _GENRE_MOTION: dict[str, str] = {
            "fight": "explosive physical motion",
            "xianxia": "sweeping ethereal motion",
            "ecommerce": "smooth controlled motion",
            "food": "minimal ambient motion",
            "drama": "restrained emotional motion",
            "popscience": "precise analytical motion",
            "kpop": "sharp synchronized motion",
            "fantasy": "grand sweeping motion",
            "action": "explosive kinetic motion",
            "horror": "creeping unnatural motion",
            "nature": "organic flowing motion",
            "documentary": "observational steady motion",
            "bollywood": "expressive dramatic motion",
            "sci_fi": "precise mechanical motion",
            "sports": "explosive athletic motion",
            "anime": "dynamic exaggerated motion",
            "romance": "gentle subtle motion",
            "thriller": "taut controlled motion",
            "comedy": "exaggerated comedic motion",
            "war": "chaotic visceral motion",
            "historical": "dignified measured motion",
            "western": "deliberate frontier motion",
            "cyberpunk": "frenetic digital motion",
            "music_video": "rhythmic performance motion",
            "superhero": "powerful heroic motion",
            "noir": "languid shadow motion",
            "underwater": "weightless fluid motion",
            "fairy_tale": "gentle magical motion",
            "dance": "fluid rhythmic motion",
            "travel": "wandering exploratory motion",
            "fashion": "confident editorial motion",
            "vfx": "controlled spectacle motion",
            "cinematic": "deliberate cinematic motion",
        }
        motion = _GENRE_MOTION.get(genre, "cinematic motion")

        # Context-aware motion overrides — genre defaults are too generic
        # for sub-genres.  E.g. sports uses "explosive athletic" but
        # swimming should be "streamlined fluid", not explosive.
        _MOTION_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], str]]] = {
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight"], "explosive staccato striking motion, burst power"),
                (["wrestling", "mma", "grapple", "octagon"], "grinding grappling motion, clinch and slam"),
                (["swimming", "diving", "pool"], "streamlined fluid motion, cutting through water"),
                (["racing", "formula", "motorsport"], "blistering velocity motion, tearing through track"),
                (["tennis", "racket"], "rapid lateral motion, explosive racket swing"),
                (["gymnastics", "vault", "beam"], "controlled acrobatic motion, explosive then still"),
                (["skiing", "snowboard", "skating"], "carving glide motion, edge-to-edge flow"),
            ],
            "nature": [
                (["volcano", "lava", "eruption"], "violent eruption motion, magma surging upward"),
                (["storm", "lightning", "thunder"], "turbulent storm motion, wind-whipped fury"),
                (["ocean", "sea", "wave",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], "surging wave motion, rhythmic crash and pull"),
                (["waterfall", "cascade", "rapids"], "thundering downward motion, endless cascade"),
                (["desert", "sand", "dune"], "languid drift motion, windswept sand shifting"),
                (["aurora", "northern lights"], "ethereal shimmer motion, curtains of light dancing"),
            ],
            "food": [
                (["sizzle", "grill", "fry", "steak"], "searing contact motion, oil spattering"),
                (["pour", "drizzle", "ganache", "sauce"], "silky pouring motion, viscous flow"),
                (["chop", "slice", "dice", "knife"], "precise blade motion, rhythmic cuts"),
            ],
            "dance": [
                (["ballet", "ballerina", "pointe"], "graceful flowing pirouette motion, suspended arabesque"),
                (["breakdance", "bboy", "popping", "locking"], "explosive freeze-pop motion, gravity-defying spins"),
                (["hip-hop", "street", "urban"], "sharp isolate motion, rhythmic bounce and swagger"),
                (["tango", "flamenco", "latin"], "passionate grounded motion, sharp heel strikes"),
                (["concert", "stage", "performance", "crowd"], "dynamic stage presence motion, audience-engaging energy"),
            ],
            "war": [
                (["medieval", "sword", "shield", "castle", "knight"], "brutal melee clash motion, shield wall surge"),
                (["samurai", "katana", "duel", "shogun"], "deliberate stance motion, explosive single strike"),
                (["sniper", "scope", "aim"], "controlled breathing stillness, microscopic recoil"),
                (["tank", "armor", "armored"], "grinding slow advance motion, treads crushing debris"),
                (["tactical", "breach", "special ops", "urban warfare"], "rapid tactical breach motion, cover-to-cover advance"),
            ],
            "horror": [
                (["psychological", "mind", "insanity"], "disorienting swaying motion, reality-warping drift"),
                # Supernatural/demon BEFORE slasher — "stalk" is too generic.
                (["supernatural", "demon", "possession", "creature", "monster"], "unnatural jerking motion, contorted movement"),
                (["slasher", "knife", "stalk", "killer"], "slow stalking motion, sudden violent burst"),
                (["found footage", "vhs", "handheld"], "frantic shaking motion, desperate fleeing"),
            ],
            "sci_fi": [
                # "space" alone is too broad (matches "spaceship") — use specific zero-g terms.
                (["zero-g", "weightless", "float", "drift", "eva"], "weightless floating motion, slow spin drift"),
                (["mecha", "robot", "cockpit"], "heavy hydraulic motion, mechanical precision stomp"),
                (["hologram", "interface", "data"], "fluid digital motion, data-stream flow"),
            ],
            "fantasy": [
                (["dragon", "fire", "breath", "wing"], "massive sweeping motion, wings beating and fire arcing"),
                (["spell", "magic", "enchant", "wizard"], "swirling arcane motion, energy gathering and release"),
                (["forest", "fairy", "elf", "woodland"], "delicate floating motion, ethereal glide"),
                (["treasure", "quest", "dungeon", "cave"], "cautious exploratory motion, torch-lit advance"),
            ],
            "anime": [
                (["mecha", "robot", "transform"], "heavy mechanical motion with dramatic pose holds"),
                (["school", "slice", "cafe", "friendship"], "gentle everyday motion, natural and warm"),
                (["magic", "spell", "power", "enchant"], "explosive sakuga motion, dynamic speed lines"),
                (["sword", "blade", "katana"], "swift slash motion, freeze-frame impact"),
            ],
            "documentary": [
                (["interview", "testimony", "witness"], "minimal steady motion, composed and still"),
                (["archive", "historical", "footage"], "slow pan motion across archival material"),
                (["nature", "wildlife", "animal"], "patient stalking motion, observational steadiness"),
                (["timelapse", "city", "urban"], "compressed accelerated motion, time flowing"),
            ],
            "comedy": [
                (["slapstick", "physical", "fall", "trip"], "exaggerated tumbling motion, comedic ragdoll"),
                (["awkward", "cringe", "reaction"], "frozen uncomfortable stillness, minimal fidget"),
                (["party", "celebration", "chaos"], "frenetic bouncing motion, joyful energy"),
                (["chase", "running", "pursuit"], "comedic scrambling motion, arms flailing"),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], "grand sweeping processional motion, joyous crowd surge"),
                (["rain", "monsoon", "barish"], "graceful twirling motion, arms outstretched in rain"),
                (["dance", "garba", "dandiya", "kathak"], "sharp rhythmic footwork motion, spinning with energy"),
                (["fight", "action", "dishoom"], "over-the-top heroic motion, dramatic flying kick with slow-mo"),
                (["emotional", "farewell", "bidaai"], "restrained trembling motion, held-back tears and reaching hands"),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], "weaving crowd-navigation motion, shoulders brushing through masses"),
                (["rooftop", "skyline", "tower", "aerial"], "wind-buffeted high-altitude motion, coat whipping in updraft"),
                (["club", "bar", "underground", "rave"], "bass-throbbing body motion, crowd surging with the beat"),
                (["chase", "pursuit", "escape", "flee"], "parkour-fluid escape motion, vaulting barriers and sliding under obstacles"),
                (["hack", "data", "interface", "terminal"], "rapid finger-typing motion, holographic data manipulation"),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence"], "careful deliberate motion, gloved hands examining details"),
                (["chase", "pursuit", "escape", "run"], "desperate scrambling motion, slamming through doors and stumbling"),
                (["hostage", "kidnap", "captive", "trapped"], "restricted twitching motion, bound and struggling"),
                (["surveillance", "spy", "covert", "shadow"], "controlled stealth motion, measured footsteps and careful corners"),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee"], "flat-out sprinting motion, leaping gaps and crashing through"),
                (["explosion", "fire", "destruction", "blast"], "flying debris motion, shockwave pushing bodies backward"),
                (["fight", "combat", "brawl", "punch"], "bone-crunching impact motion, rapid strike combinations"),
                (["vehicle", "car", "motorcycle", "helicopter"], "high-G turning motion, tires screeching and body rolling"),
            ],
        }
        motion_ctx = _MOTION_CONTEXT_OVERRIDES.get(genre, [])
        if motion_ctx:
            desc_lower_motion = description.lower()
            for keywords, override_motion in motion_ctx:
                if any(kw in desc_lower_motion for kw in keywords):
                    motion = override_motion
                    break

        # Genre-specific environmental particles / detail layer.
        # These micro-details (debris, steam, dust, light motes) add
        # physical texture that separates cinematic from generic AI video.
        # Injected into segment 2+ to enrich the evolving scene.
        _GENRE_PARTICLES: dict[str, str] = {
            "fight": "impact sparks and debris fragments in air",
            "xianxia": "glowing qi particles and ethereal energy wisps",
            "ecommerce": "subtle dust motes catching studio light",
            "food": "rising steam wisps and condensation droplets",
            "drama": "floating dust motes in shaft of light",
            "popscience": "microscopic particles and data visualization sparks",
            "kpop": "confetti and stage pyrotechnic sparks",
            "fantasy": "magical sparkles and enchanted floating embers",
            "action": "debris shower and shattered glass fragments",
            "horror": "dust motes drifting through light beams",
            "nature": "floating pollen and wind-carried seeds",
            "documentary": "natural atmospheric haze and dust",
            "bollywood": "floating flower petals and glitter",
            "sci_fi": "holographic data particles and lens artifacts",
            "sports": "kicked-up turf and sweat droplets frozen",
            "anime": "speed lines and dramatic particle bursts",
            "romance": "floating bokeh lights and drifting petals",
            "thriller": "breath vapor and cold atmospheric mist",
            "comedy": "exaggerated motion debris and visual pop",
            "war": "floating ash and drifting embers",
            "historical": "candlelit dust motes and torch sparks",
            "western": "kicked-up desert dust and tumbling debris",
            "cyberpunk": "digital glitch particles and neon rain streaks",
            "music_video": "stage fog wisps and spotlight dust",
            "superhero": "energy discharge particles and power debris",
            "noir": "cigarette smoke curls and rain on glass",
            "underwater": "suspended micro-bubbles and plankton particles",
            "fairy_tale": "stardust motes and magical firefly sparks",
            "dance": "stage haze wisps catching colored light",
            "travel": "atmospheric golden-hour dust and lens flare",
            "fashion": "editorial light-leak particles and soft haze",
            "vfx": "procedural particle effects and energy trails",
            "cinematic": "atmospheric haze and volumetric light motes",
        }
        particles = _GENRE_PARTICLES.get(genre, "atmospheric particles")

        # Context-aware particle overrides — when the description has
        # sub-genre keywords, swap in particles that match the actual
        # scene content.  E.g. nature "ocean wave" gets spray/foam, not
        # pollen/seeds.  Same pattern as audio context overrides.
        _PARTICLE_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], str]]] = {
            "nature": [
                (["ocean", "sea", "wave", "reef", "coast",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], "spray mist and foam droplets"),
                (["mountain", "peak", "summit", "cliff"], "wind-blown snow crystals and cloud wisps"),
                (["desert", "sand", "dune"], "wind-swept sand particles and heat shimmer"),
                (["rain", "storm", "lightning"], "rain streaks and mist droplets"),
                (["waterfall", "cascade", "river", "rapids"], "mist droplets and rainbow spray"),
                (["forest", "tree", "jungle", "rainforest"], "floating leaf fragments and dappled light motes"),
                (["volcano", "lava", "eruption"], "volcanic ash and glowing ember particles"),
                (["aurora", "northern lights", "borealis", "starry"], "shimmering atmospheric light particles"),
            ],
            "fight": [
                (["sword", "katana", "blade"], "metal shavings and blade-sparked embers"),
                (["gun", "shoot", "bullet"], "shell casings and muzzle smoke wisps"),
                (["explosion", "blast", "grenade"], "shrapnel fragments and fire embers"),
            ],
            "action": [
                (["car", "race", "drift"], "tire smoke and kicked-up gravel"),
                (["motorcycle", "bike"], "exhaust vapor and road spray"),
                (["water", "rain", "flood"], "water spray and splashing droplets"),
            ],
            "horror": [
                (["rain", "storm"], "rain streaks on windows and cold mist"),
                (["fire", "candle", "flame"], "flickering embers and ash flakes"),
                (["snow", "winter", "cold"], "frost crystals and breath vapor"),
                # Supernatural BEFORE body/gore — "creature"/"monster" are common.
                (["supernatural", "demon", "curse", "spirit", "creature", "monster"], "swirling dark smoke tendrils and ash particles"),
                (["body", "gore", "blood", "visceral"], "blood spray mist and visceral droplets"),
                (["found footage", "vhs", "tape"], "VHS scan-line artifacts and static grain"),
            ],
            "western": [
                (["rain", "storm", "mud"], "mud splashes and rain on leather"),
                (["snow", "winter", "blizzard"], "blowing snow and frost crystals"),
            ],
            "sci_fi": [
                (["space", "zero-g", "weightless"], "floating debris and micro-meteorites"),
                (["rain", "acid", "neon"], "neon-reflected rain droplets and steam"),
                (["mecha", "robot", "pilot"], "exhaust vapor jets and mechanical debris sparks"),
                (["hologram", "interface", "data"], "flickering holographic scan lines and digital artifacts"),
            ],
            "dance": [
                (["concert", "festival", "crowd"], "pyrotechnic sparks and crowd confetti mid-air"),
                (["ballet", "classical", "pointe"], "rosin dust particles and ethereal stage fog wisps"),
                (["breakdance", "bboy", "street"], "kicked-up ground dust and sweat droplets"),
            ],
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight", "uppercut", "knockout"], "sweat spray and leather dust, canvas scuff marks"),
                (["wrestling", "mma", "grapple", "octagon", "cage"], "mat burns and sweat splatter, body slam impact dust"),
                (["swimming", "diving", "pool", "water polo"], "chlorine mist and lane-splashed water droplets"),
                (["soccer", "football", "pitch"], "kicked-up turf clumps and grass blades, boot spray"),
                (["tennis", "racket", "court"], "court surface chalk dust and felt fuzz, ball impact particles"),
                (["racing", "formula", "motorsport"], "tire smoke and carbon fiber particles, heat shimmer off asphalt"),
                (["skiing", "snowboard", "skating", "ice"], "powder spray and ice crystal shavings, breath vapor"),
                (["basketball", "court", "dunk"], "sneaker squeak dust and sweat droplets mid-air"),
                (["gymnastics", "vault", "beam"], "chalk dust cloud and rosin powder, landing impact particles"),
            ],
            "war": [
                (["snow", "winter", "arctic"], "blowing snow and frozen breath vapor"),
                (["jungle", "vietnam", "tropical"], "insect swarms and dripping moisture"),
                (["naval", "ship", "submarine"], "sea spray and hull condensation"),
                (["medieval", "sword", "siege", "shield"], "mud splatter and blood spray mist"),  # "battle" too broad
                (["samurai", "katana", "duel"], "cherry blossom petals and blade-strike air shimmer"),
                (["modern", "urban", "breach", "tactical"], "breaching door smoke and concrete dust explosion"),
            ],
            "food": [
                (["sushi", "nigiri", "sashimi"], "delicate rice grain particles and subtle mist"),
                (["grill", "sizzle", "bbq", "steak"], "oil spatter droplets and smoke wisps rising"),
                (["pour", "drizzle", "ganache", "sauce"], "viscous drip strands and glossy surface sheen"),
                (["bake", "oven", "bread", "pastry"], "flour dust motes and golden crumb particles"),
                (["ice cream", "gelato", "sorbet"], "frost crystals and cold condensation vapor"),
                (["chop", "slice", "dice"], "juice spray micro-droplets and herb fragments"),
            ],
            "fantasy": [
                (["dragon", "fire", "flame", "breath"], "fire embers and volcanic ash swirling upward"),
                (["spell", "magic", "enchant", "wizard"], "arcane sparkle particles and ethereal energy wisps"),
                (["forest", "fairy", "elf", "woodland"], "magical firefly sparks and floating pollen motes"),
                (["treasure", "cave", "dungeon"], "torch ember sparks and ancient dust motes"),
            ],
            "anime": [
                (["mecha", "robot", "transform"], "metal shavings and hydraulic steam jets"),
                (["magic", "spell", "power"], "prismatic energy particles and speed-line streaks"),
                (["school", "slice", "cafe"], "cherry blossom petals and gentle light motes"),
            ],
            "documentary": [
                (["nature", "wildlife", "animal"], "natural atmospheric haze and floating pollen"),
                (["archive", "historical"], "film grain dust and age-spotted texture"),
                (["underwater", "marine", "coral"], "suspended micro-bubbles and plankton particles"),
            ],
            "comedy": [
                (["slapstick", "physical", "fall"], "exaggerated debris cloud and cartoon-scale dust"),
                (["party", "celebration", "confetti"], "confetti shower and balloon fragments"),
                (["food fight", "mess", "splatter"], "flying food particles and splatter droplets"),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], "floating marigold petals and golden glitter shower"),
                (["rain", "monsoon", "barish"], "romantic rain droplets and wet splashing spray"),
                (["dance", "garba", "dandiya"], "swirling dupatta fabric trails and ankle-bell sparkle"),
                (["fight", "action", "dishoom"], "shattered glass fragments and dramatic dust cloud"),
                (["emotional", "farewell", "bidaai"], "floating rice grains and drifting vermillion powder"),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], "neon rain streaks and holographic ad fragments"),
                (["rooftop", "skyline", "tower", "aerial"], "smog particles and distant vehicle exhaust trails"),
                (["club", "bar", "underground", "rave"], "strobe-lit smoke wisps and sweat-mist vapor"),
                (["chase", "pursuit", "escape", "flee"], "sparking cable fragments and puddle-splash droplets"),
                (["hack", "data", "interface", "terminal"], "floating data glyphs and holographic scan artifacts"),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence"], "floating dust motes in harsh evidence-lamp beam"),
                (["chase", "pursuit", "escape", "run"], "disturbed dust clouds and dislodged debris fragments"),
                (["hostage", "kidnap", "captive", "trapped"], "cold breath vapor and dripping condensation"),
                (["surveillance", "spy", "covert", "shadow"], "lens flare artifacts and security-feed grain"),
            ],
        }
        particle_overrides = _PARTICLE_CONTEXT_OVERRIDES.get(genre, [])
        if particle_overrides:
            desc_lower = description.lower()
            for keywords, override_particles in particle_overrides:
                if any(kw in desc_lower for kw in keywords):
                    particles = override_particles
                    break

        # Context-aware audio sub-specialization — when the description
        # contains sub-genre keywords, override the first audio cue with
        # a more specific one.  E.g. "sword fight" gets steel sounds,
        # "boxing" gets leather impacts.
        _AUDIO_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], str]]] = {
            "fight": [
                (["sword", "katana", "blade", "samurai"], "steel clashing and ringing metal"),
                (["boxing", "punch", "fist", "ring"], "leather impact and crowd roar"),
                (["gun", "shoot", "bullet"], "gunfire echo and shell casings"),
                (["martial", "kung fu", "karate"], "swift air cuts and bare-knuckle impacts"),
            ],
            "food": [
                # Dessert toppings before baking (ganache on cake ≠ baking cake)
                (["ganache", "frosting", "glaze", "drizzle", "topping"], "velvety pouring and drip settling"),
                (["chocolate", "truffle", "mousse", "fondue"], "smooth chocolate pouring and delicate crunch"),
                (["ramen", "noodle", "soup", "broth"], "slurping broth and chopstick tapping"),
                (["sizzle", "grill", "fry", "steak"], "sizzling oil and crackling heat"),
                (["sushi", "nigiri", "sashimi", "maki"], "knife on board and rice pressing"),
                (["ice cream", "gelato", "sorbet", "scoop"], "scoop carving and waffle cone crunch"),
                (["bake", "oven", "bread", "pastry"], "oven crackle and crisp crust snapping"),
                (["cake", "cupcake", "pie", "tart"], "knife cutting through layers and fork on porcelain"),
            ],
            "nature": [
                (["ocean", "sea", "wave", "beach",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], "crashing waves and distant seabirds"),
                (["forest", "tree", "jungle"], "rustling canopy and birdsong"),
                (["mountain", "peak", "summit"], "howling wind and distant eagle cry"),
                (["savanna", "safari", "lion"], "cicada buzz and distant animal calls"),
                (["desert", "sand", "dune"], "desert wind moaning and sand hiss"),
                (["waterfall", "cascade", "river"], "rushing water and waterfall thunder"),
                (["storm", "lightning", "thunder"], "distant thunder rumble and wind gusts"),
                (["volcano", "lava", "eruption"], "deep volcanic rumble and hissing steam"),
                (["aurora", "northern lights", "borealis"], "crystalline arctic silence and gentle wind"),
            ],
            "action": [
                (["car", "race", "driving"], "engine roar and tire screech"),
                (["motorcycle", "bike"], "high-rev engine whine and wind rush"),
                (["parkour", "running", "chase"], "rapid footsteps and heavy breathing"),
                (["explosion", "blast"], "massive detonation and debris rain"),
            ],
            "horror": [
                (["ghost", "spirit", "haunted"], "spectral whispers and distant moaning"),
                (["asylum", "hospital"], "creaking doors and flickering fluorescent hum"),
                (["forest", "woods"], "snapping twigs and unidentifiable rustling"),
                (["doll", "puppet", "toy"], "music box tinkling and eerie giggling"),
                # Supernatural/demon BEFORE slasher — "stalk" is too generic,
                # "demonic creature stalks" should match demon, not slasher.
                (["supernatural", "demon", "possession", "creature", "monster"], "demonic growl reverb and shattering glass"),
                (["slasher", "knife", "stalk", "killer"], "knife scraping and distant screaming echo"),
                (["body", "gore", "visceral", "mutate"], "wet visceral sounds and bone cracking"),
                (["found footage", "vhs", "tape"], "camera motor whir and static interference"),
            ],
            "bollywood": [
                (["wedding", "baraat", "celebration"], "dhol drums and shehnai melody with joyous cheering"),
                (["rain", "monsoon"], "monsoon rain on marble and romantic playback vocals"),
                (["dance", "garba", "dandiya"], "rhythmic ankle bells and tabla percussion"),
                (["emotional", "farewell", "departure"], "melancholic violin strings and soft sobbing"),
            ],
            "cyberpunk": [
                (["rain", "street", "alley"], "rain on neon signs and distant hover traffic hum"),
                (["hack", "neural", "jack"], "data stream glitch pulses and keyboard rapid-fire"),
                (["club", "bar", "rave"], "thumping synthwave bass and distorted crowd murmur"),
                (["chase", "running", "pursuit"], "synthetic siren wail and cybernetic footstep impacts"),
            ],
            "thriller": [
                (["heist", "vault", "safe"], "metallic mechanism clicks and alarm tones"),
                (["chase", "pursuit", "running"], "pounding heartbeat and distant police sirens"),
                (["interrogation", "confession"], "fluorescent hum and pen scratching on paper"),
                (["surveillance", "camera", "watching"], "tape recorder whir and static crackle"),
            ],
            "war": [
                (["trench", "foxhole", "bunker"], "machine gun rattle and mortar whistles in mud"),
                (["aerial", "bomber", "airstrike"], "jet engine roar and bomb detonation echo"),
                (["naval", "ship", "submarine"], "sonar ping and hull pressure groans"),
                (["medic", "wounded", "hospital"], "muffled artillery and urgent medical clatter"),
                (["medieval", "sword", "shield", "castle"], "steel clash on shield and war horn blast"),
                (["samurai", "katana", "duel"], "blade unsheathing ring and wind through bamboo"),
                (["sniper", "scope", "tactical"], "suppressed rifle crack and radio static chirp"),
                (["tank", "armor", "armored"], "diesel engine rumble and cannon blast shockwave"),
            ],
            "western": [
                (["saloon", "bar", "poker"], "honky-tonk piano and whiskey glass clinking"),
                (["showdown", "duel", "noon"], "deathly silence, pocket watch ticking, wind whistle"),
                (["stampede", "horse", "ride"], "thundering hooves and leather saddle creaking"),
                (["canyon", "desert", "mesa"], "distant coyote howl and desert wind moaning"),
            ],
            "romance": [
                (["rain", "umbrella"], "gentle rain patter and romantic piano melody"),
                (["dance", "waltz", "ballroom"], "orchestral waltz and gentle footstep rhythm"),
                (["letter", "read", "write"], "pen nib on paper and wistful piano notes"),
                (["beach", "sunset", "ocean"], "soft waves and distant seagulls at golden hour"),
            ],
            "anime": [
                (["mecha", "robot", "transform"], "hydraulic servo whir and metallic transformation clang"),
                (["magic", "spell", "enchant"], "crystalline sparkle cascade and ethereal choir swell"),
                (["battle", "clash", "sword", "power"], "dramatic impact strike and energy whoosh"),
                (["school", "cafe", "friendship"], "gentle chime and soft piano background"),
            ],
            "dance": [
                (["ballet", "ballerina", "tutu", "pointe"], "piano melody and pointe shoe tapping on wood"),
                (["breakdance", "bboy", "breaking", "popping"], "boombox beats and sneaker screeching on concrete"),
                (["tango", "flamenco"], "passionate guitar strumming and heel stamps on floor"),
                (["contemporary", "modern"], "ambient electronic pulse and bare feet sliding on stage"),
            ],
            "superhero": [
                (["fly", "flying", "soaring", "sky"], "rushing wind and cape flutter at supersonic speed"),
                (["battle", "fight", "clash", "villain"], "shockwave impact and energy beam crackle"),
                (["transform", "suit", "armor"], "metallic assembly clicks and power-up energy hum"),
                (["city", "rescue", "save"], "distant crowd cheering and emergency siren fading"),
            ],
            "noir": [
                (["bar", "whiskey", "drink"], "jazz saxophone solo and ice cubes in glass"),
                (["crime", "murder", "body"], "police radio crackle and distant sirens in rain"),
                (["rain", "alley", "street"], "rain splashing on cobblestones and lonely footsteps"),
                (["office", "desk", "typewriter"], "typewriter keys clacking and cigarette lighter flick"),
            ],
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight", "uppercut"], "leather glove impact and crowd eruption, corner shouts"),
                (["wrestling", "mma", "grapple", "octagon", "cage"], "body slam impact and cage rattle, referee counting"),
                (["swimming", "diving", "pool"], "splashing water and muffled underwater flow, starting pistol"),
                (["soccer", "football", "pitch"], "boot striking leather and crowd chanting, whistle blast"),
                (["tennis", "racket", "court"], "racket string twang and ball bounce, crowd gasp"),
                (["racing", "formula", "motorsport"], "screaming engine doppler and tire screech, pit radio chatter"),
                (["basketball", "court", "dunk"], "sneaker squeak and ball bouncing, net swish, crowd roar"),
                (["gymnastics", "vault", "beam"], "springboard thud and landing impact, crowd applause"),
            ],
            "sci_fi": [
                (["space", "zero-g", "vacuum", "station"], "muffled suit breathing and radio static crackle"),
                (["mecha", "robot", "cockpit", "pilot"], "hydraulic servo whine and cockpit warning beeps"),
                (["ai", "computer", "system", "interface"], "electronic data pulses and synthetic voice warnings"),
                (["hologram", "data", "scan"], "digital projection hum and holographic flicker"),
            ],
            "fantasy": [
                (["dragon", "fire", "breath", "wing"], "massive wing beat and deep dragon rumble"),
                (["spell", "magic", "enchant", "wizard"], "crystalline sparkle cascade and arcane energy hum"),
                (["forest", "fairy", "elf", "woodland"], "enchanted wind chimes and magical birdsong"),
                (["treasure", "cave", "dungeon"], "torch crackling and distant cavern drip echo"),
                (["sword", "quest", "knight"], "steel unsheathing ring and adventure horn call"),
            ],
            "documentary": [
                (["interview", "testimony", "witness"], "measured voice in quiet room, subtle ambient"),
                (["archive", "historical", "footage"], "vintage film projector whir and period music"),
                (["nature", "wildlife", "animal"], "wilderness birdsong and wind through habitat"),
                (["city", "urban", "timelapse"], "compressed city sounds and traffic flow"),
            ],
            "comedy": [
                (["slapstick", "physical", "fall"], "exaggerated impact sound and comedic timing beat"),
                (["awkward", "cringe", "reaction"], "uncomfortable silence and awkward cough"),
                (["party", "celebration", "chaos"], "laughter and crowd noise with clinking glasses"),
                (["chase", "running"], "comedic scrambling footsteps and bumping sounds"),
            ],
        }
        desc_lower = description.lower()
        context_overrides = _AUDIO_CONTEXT_OVERRIDES.get(genre, [])
        context_audio_override = None
        for keywords, audio_cue in context_overrides:
            if any(kw in desc_lower for kw in keywords):
                context_audio_override = audio_cue
                break

        # Resolve effective first audio cue (context override or DB-extracted)
        aud_first = context_audio_override or (aud[0] if aud else "ambient sound")

        # Audio evolution across segments — just like lighting evolves,
        # audio should follow a narrative arc (establish → build → peak →
        # settle) rather than pulling random cues from the defaults list.
        _GENRE_AUDIO_EVOLUTION: dict[str, dict[str, str]] = {
            "fight": {
                "seg2": "clash intensity building, steel impacts and grunts",
                "seg3": "explosive peak combat sounds, devastating impacts",
                "seg4": "fading echoes, heavy breathing, silence settling",
            },
            "xianxia": {
                "seg2": "qi energy building, spiritual resonance deepening",
                "seg3": "celestial power unleashed, divine thunder and chimes",
                "seg4": "ethereal afterglow hum, gentle wind through spirit realm",
            },
            "ecommerce": {
                "seg2": "crisp material sounds, satisfying texture reveal",
                "seg3": "premium finish sound, elegant placement click",
                "seg4": "subtle ambient shimmer, aspirational quiet",
            },
            "food": {
                "seg2": "sizzling intensifies, moisture and steam sounds",
                "seg3": "peak ASMR moment, crunch and drip at full detail",
                "seg4": "gentle settling, warm ambient kitchen comfort",
            },
            "drama": {
                "seg2": "emotional score building, subtle tension in strings",
                "seg3": "raw emotional peak, cathartic silence or swelling strings",
                "seg4": "quiet aftermath, distant ambient sound, emotional weight",
            },
            "horror": {
                "seg2": "unsettling sound builds, creaking and distant whispers",
                "seg3": "shock audio burst, terrifying reveal sound",
                "seg4": "suffocating silence, only heartbeat remains",
            },
            "nature": {
                "seg2": "wildlife sounds intensify, creature calls closer",
                "seg3": "peak natural moment, dramatic animal sound or wind burst",
                "seg4": "settling ambient, nature's quiet rhythm returns",
            },
            "romance": {
                "seg2": "tender music swells gently, intimate sounds closer",
                "seg3": "romantic crescendo, emotional peak melody",
                "seg4": "warm afterglow ambient, gentle heartbeat rhythm",
            },
            "thriller": {
                "seg2": "tension ratchets, ticking and heartbeat accelerating",
                "seg3": "shocking reveal hit, sharp audio stab",
                "seg4": "uneasy drone lingering, nothing resolved",
            },
            "war": {
                "seg2": "gunfire and explosions intensifying, chaos building",
                "seg3": "peak battle fury, deafening explosions and war cries",
                "seg4": "aftermath ringing ears, distant smoke and silence",
            },
            "bollywood": {
                "seg2": "music builds with tabla and strings, emotional swell",
                "seg3": "dramatic Bollywood crescendo, full orchestral peak",
                "seg4": "soft melodic fadeout, emotional resonance lingering",
            },
            "anime": {
                "seg2": "power-up charge building, energy concentration sound",
                "seg3": "explosive impact burst, screen-shaking audio",
                "seg4": "wind settling, emotional aftermath melody",
            },
            "cyberpunk": {
                "seg2": "data streams accelerating, neon hum intensifying",
                "seg3": "system overload crackle, electric surge peak",
                "seg4": "rain static returning, distant city pulse settling",
            },
            "superhero": {
                "seg2": "power charge building, energy gathering crescendo",
                "seg3": "explosive hero impact, shockwave boom",
                "seg4": "heroic aftermath, cape flutter and crowd distant",
            },
            "noir": {
                "seg2": "jazz tempo darkening, rain intensifying on glass",
                "seg3": "sharp reveal sting, gunshot echo in wet streets",
                "seg4": "melancholy saxophone fading, rain on empty pavement",
            },
            "western": {
                "seg2": "tension building, leather creak and wind whistle",
                "seg3": "gunshot crack echoing across empty frontier",
                "seg4": "lonely wind, hoofbeats fading into distance",
            },
            "comedy": {
                "seg2": "comedic escalation sounds, situation building absurdly",
                "seg3": "punchline hit, comedic sound effect and crowd reaction",
                "seg4": "laughter settling, warm light-hearted ambient",
            },
            "documentary": {
                "seg2": "ambient score deepening, contemplative undertone",
                "seg3": "revelation audio moment, truth scoring with quiet intensity",
                "seg4": "reflective piano, the weight of discovery settling",
            },
            "sci_fi": {
                "seg2": "systems powering up, electronic hum escalating",
                "seg3": "technology at full power, energy discharge climax",
                "seg4": "cool blue ambient hum, stabilized technological equilibrium",
            },
            "music_video": {
                "seg2": "beat building toward the drop, energy escalating",
                "seg3": "chorus drops, full sonic and visual explosion",
                "seg4": "final note ringing, crowd energy slowly fading",
            },
            "underwater": {
                "seg2": "deeper ocean sounds, pressure building, whale call",
                "seg3": "peak underwater spectacle, massive creature or current rush",
                "seg4": "gentle current settling, bubbles ascending to silence",
            },
            "fairy_tale": {
                "seg2": "magical chimes intensifying, enchantment building",
                "seg3": "spell at full power, radiant magical crescendo",
                "seg4": "gentle stardust settling, music box melody fading",
            },
            "dance": {
                "seg2": "rhythm building intensity, percussion driving harder",
                "seg3": "beat drops for climactic move, crowd erupting",
                "seg4": "final beat hit, settling breath and applause",
            },
            "travel": {
                "seg2": "local sounds emerging, cultural ambience deepening",
                "seg3": "destination at full atmosphere, immersive world sounds",
                "seg4": "contemplative ambient, sunset wind and distant life",
            },
            "fashion": {
                "seg2": "beat intensifying, runway energy building",
                "seg3": "camera shutters and gasps at the hero look",
                "seg4": "elegant ambient, soft applause fading",
            },
            "sports": {
                "seg2": "crowd energy rising, anticipation building",
                "seg3": "roaring crowd eruption, peak athletic impact",
                "seg4": "celebration sounds, triumphant crowd chanting",
            },
            "vfx": {
                "seg2": "transformation sounds building, energy gathering",
                "seg3": "peak effect audio, massive energy release",
                "seg4": "stabilizing hum, new-state ambient settling",
            },
            "kpop": {
                "seg2": "beat building, synth energy escalating to drop",
                "seg3": "bass drop and synchronized hit, crowd screaming",
                "seg4": "final pose hit, single spotlight silence",
            },
            "popscience": {
                "seg2": "electronic visualization pulse accelerating",
                "seg3": "breakthrough moment audio, clarity chime",
                "seg4": "settling data hum, contemplative ambient pulse",
            },
            "cinematic": {
                "seg2": "orchestral score building, atmospheric depth",
                "seg3": "sweeping musical crescendo, awe-inspiring peak",
                "seg4": "gentle fade, the landscape breathes in quiet grandeur",
            },
            "historical": {
                "seg2": "period instruments intensifying, crowd tension building",
                "seg3": "dramatic historical moment, fanfare or war cry peak",
                "seg4": "solemn aftermath, distant bells and wind through stone",
            },
        }
        audio_evo = _GENRE_AUDIO_EVOLUTION.get(
            genre, _GENRE_AUDIO_EVOLUTION.get("cinematic", {})
        )

        # Context-aware audio evolution overrides — nature defaults mention
        # "creature calls" and "animal sound" which are wrong for landscape scenes.
        _AUDIO_EVO_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], dict[str, str]]]] = {
            "nature": [
                (["ocean", "sea", "wave", "reef", "coast", "beach",
                  "whale", "dolphin", "shark", "turtle", "jellyfish", "manta", "coral"], {
                    "seg2": "wave crashes intensifying, deep ocean rumble building",
                    "seg3": "peak wave impact, thunderous surf and seabird cries",
                    "seg4": "settling tide rhythm, gentle wave lapping returning",
                }),
                # Volcano/aurora BEFORE mountain — first match wins,
                # "mountainside" would wrongly match "mountain" otherwise.
                (["volcano", "lava", "eruption", "volcanic"], {
                    "seg2": "volcanic rumble building, earth trembling underfoot",
                    "seg3": "explosive eruption sound, deafening geological fury",
                    "seg4": "settling hiss of cooling lava, distant rumble fading",
                }),
                (["aurora", "northern lights", "borealis", "starry", "milky way"], {
                    "seg2": "gentle arctic wind, crystalline silence deepening",
                    "seg3": "ethereal atmospheric hum at peak celestial display",
                    "seg4": "vast cosmic silence, only gentle wind remains",
                }),
                (["mountain", "peak", "summit", "cliff", "alpine"], {
                    "seg2": "wind intensifying across rocky terrain, distant rumble",
                    "seg3": "peak mountain silence broken by wind gust or rockfall",
                    "seg4": "gentle mountain wind settling, vast quiet returning",
                }),
                (["desert", "sand", "dune", "sahara"], {
                    "seg2": "wind building across sand, granular hiss intensifying",
                    "seg3": "peak desert wind, sand shifting in dramatic gusts",
                    "seg4": "desert silence returning, only distant wind remains",
                }),
                (["forest", "tree", "jungle", "rainforest", "woodland"], {
                    "seg2": "canopy rustling intensifies, birdsong and leaf movement",
                    "seg3": "peak forest atmosphere, wind through ancient branches",
                    "seg4": "forest settling into quiet, gentle rustling and distant birds",
                }),
                (["storm", "lightning", "thunder", "rain"], {
                    "seg2": "thunder rumble building, rain intensifying on surfaces",
                    "seg3": "peak storm fury, crack of lightning and deafening thunder",
                    "seg4": "storm receding, gentle rain pattering as calm returns",
                }),
                (["waterfall", "cascade", "river", "rapids"], {
                    "seg2": "rushing water intensifying, roar of the falls building",
                    "seg3": "thunderous water crash at maximum flow, spray hissing",
                    "seg4": "water settling to steady flow, gentle current sounds",
                }),
            ],
            "sports": [
                (["boxing", "boxer", "ring", "heavyweight", "uppercut", "knockout"], {
                    "seg2": "leather impact snaps accelerating, crowd roar building",
                    "seg3": "explosive knockout impact, crowd eruption and bell ringing",
                    "seg4": "arena settling, heavy breathing and distant crowd murmur",
                }),
                (["wrestling", "mma", "octagon", "cage"], {
                    "seg2": "body slam thuds intensifying, cage rattling with impact",
                    "seg3": "submission struggle sounds peak, crowd at fever pitch",
                    "seg4": "referee counting, crowd settling into applause",
                }),
                (["swimming", "diving", "pool"], {
                    "seg2": "splashing intensifying, underwater flow and kick rhythm",
                    "seg3": "explosive finish touch, crowd roar and water eruption",
                    "seg4": "pool settling, heavy breathing and gentle water lapping",
                }),
                (["racing", "formula", "motorsport"], {
                    "seg2": "engine pitch screaming higher, tire screech on corners",
                    "seg3": "peak RPM redline howl, overtake crowd surge",
                    "seg4": "engines cooling, victory celebration and champagne spray",
                }),
                (["tennis", "racket", "court"], {
                    "seg2": "rally rhythm building, ball bounce and racket impact",
                    "seg3": "ace serve crack, crowd eruption and umpire call",
                    "seg4": "post-point applause settling, player breathing audible",
                }),
            ],
            "horror": [
                (["psychological", "mind", "insanity", "hallucination"], {
                    "seg2": "dissonant tones building, reality-bending audio distortion",
                    "seg3": "overwhelming sensory cacophony, breaking-point audio",
                    "seg4": "hollow ringing silence, single heartbeat echoing",
                }),
                # Supernatural/demon BEFORE slasher — "stalk" is too generic.
                (["supernatural", "demon", "possession", "creature", "monster"], {
                    "seg2": "unearthly whispers multiplying, low rumble building",
                    "seg3": "demonic roar and explosive supernatural energy",
                    "seg4": "eerie calm settling, faint residual whispers",
                }),
                (["slasher", "knife", "stalk", "killer"], {
                    "seg2": "footsteps approaching, breathing getting closer",
                    "seg3": "violent sudden impact, piercing scream",
                    "seg4": "dripping silence, distant police siren",
                }),
                (["found footage", "vhs", "tape", "camera"], {
                    "seg2": "camera motor whir and static interference bursts",
                    "seg3": "audio completely distorts, overwhelming noise",
                    "seg4": "dead air with occasional static pop, silence",
                }),
            ],
            "dance": [
                (["ballet", "ballerina", "pointe", "classical"], {
                    "seg2": "orchestral strings swelling, pointe shoes tapping on stage",
                    "seg3": "musical crescendo at the grand jeté peak",
                    "seg4": "gentle music fade, soft landing and breath settling",
                }),
                (["breakdance", "bboy", "popping", "street"], {
                    "seg2": "heavy beat building, crowd hyping with chanting",
                    "seg3": "beat drop with crowd eruption at power move",
                    "seg4": "final beat hit silence, crowd roar and applause",
                }),
                (["concert", "festival", "stage", "crowd"], {
                    "seg2": "live band intensifying, crowd singing along",
                    "seg3": "pyrotechnic blast and peak musical moment",
                    "seg4": "crowd ovation roar, instruments fading to audience",
                }),
            ],
            "war": [
                (["medieval", "sword", "siege", "knight", "castle"], {  # "battle" too broad
                    "seg2": "steel clash and war cries building, horses charging",
                    "seg3": "peak battle fury, siege weapon impact and screaming",
                    "seg4": "battle settling, moaning wounded and distant horn",
                }),
                (["samurai", "katana", "duel", "shogun"], {
                    "seg2": "wind through bamboo, tense breathing standoff",
                    "seg3": "single explosive blade strike, silk cutting air",
                    "seg4": "absolute silence, body falling and wind resuming",
                }),
                (["sniper", "scope", "tactical"], {
                    "seg2": "controlled breathing and wind readings, radio static",
                    "seg3": "suppressed shot crack, bullet impact downrange",
                    "seg4": "chamber cycling, mission complete radio click",
                }),
            ],
            "romance": [
                (["wedding", "ceremony", "bride", "aisle"], {
                    "seg2": "gentle processional music, guests murmuring with emotion",
                    "seg3": "vow exchange in intimate silence, stifled tears",
                    "seg4": "joyful celebration burst, cheering and champagne pop",
                }),
                (["farewell", "goodbye", "departure", "leaving"], {
                    "seg2": "strained conversation, ambient noise emphasizing distance",
                    "seg3": "final words spoken, train whistle or departure bell",
                    "seg4": "receding footsteps, vast emptiness and quiet wind",
                }),
            ],
            "sci_fi": [
                (["space", "zero-g", "station", "orbit"], {
                    "seg2": "muffled suit breathing and radio static crackle",
                    "seg3": "alarm blaring, hull breach hiss or engine ignition",
                    "seg4": "deep space silence, gentle life-support hum",
                }),
                (["mecha", "robot", "cockpit", "pilot"], {
                    "seg2": "hydraulic servo whine building, cockpit warning beeps",
                    "seg3": "weapons discharge roar, explosive impact shockwave",
                    "seg4": "systems powering down, cooling fans and damage report",
                }),
            ],
            "food": [
                (["sushi", "nigiri", "sashimi"], {
                    "seg2": "precise knife on board, rice pressing sounds",
                    "seg3": "gentle plating sounds, chopstick placement",
                    "seg4": "satisfied silence, soft ambient restaurant murmur",
                }),
                (["grill", "sizzle", "bbq", "steak"], {
                    "seg2": "sizzling intensifies, oil popping and crackling",
                    "seg3": "peak searing contact, dramatic hiss and steam burst",
                    "seg4": "gentle resting sizzle, juices settling, knife cut",
                }),
                (["pour", "drizzle", "ganache", "sauce", "chocolate"], {
                    "seg2": "viscous pouring sound, glossy drip and settle",
                    "seg3": "satisfying pour-meets-surface sound, spreading",
                    "seg4": "quiet drip settling, surface sheen sounds",
                }),
                (["bake", "oven", "bread", "pastry"], {
                    "seg2": "oven door opening, warm air rush and crackle",
                    "seg3": "crisp crust snapping, steam escaping from break",
                    "seg4": "cooling rack clink, soft breadcrumb texture",
                }),
            ],
            "fantasy": [
                (["dragon", "fire", "flame", "breath"], {
                    "seg2": "deep dragon rumble building, wing leather creaking",
                    "seg3": "roaring fire breath blast, massive wing beat",
                    "seg4": "smoldering crackle, distant dragon cry echoing",
                }),
                (["spell", "magic", "enchant", "wizard"], {
                    "seg2": "incantation whisper building, arcane energy hum",
                    "seg3": "spell discharge burst, crystalline shatter sound",
                    "seg4": "magical residue shimmer, ethereal settling tones",
                }),
                (["forest", "fairy", "elf", "woodland"], {
                    "seg2": "enchanted bird calls, wind through ancient trees",
                    "seg3": "fairy chime sounds, magical forest awakening",
                    "seg4": "peaceful woodland ambience, distant magical echo",
                }),
            ],
            "anime": [
                (["mecha", "robot", "transform"], {
                    "seg2": "mechanical transformation sounds, gears engaging",
                    "seg3": "dramatic power-up burst with impact bass",
                    "seg4": "heroic theme swell, servo settle and cockpit beeps",
                }),
                (["school", "slice", "cafe"], {
                    "seg2": "school bell chime, gentle background chatter",
                    "seg3": "emotional piano melody building",
                    "seg4": "warm evening cicadas, nostalgic ambient",
                }),
            ],
            "documentary": [
                (["interview", "testimony", "witness"], {
                    "seg2": "measured voice tone, ambient room quiet",
                    "seg3": "emotional vocal shift, powerful testimony moment",
                    "seg4": "contemplative silence, weight of words settling",
                }),
                (["nature", "wildlife", "animal"], {
                    "seg2": "natural environment sounds intensifying",
                    "seg3": "dramatic predator-prey moment, nature's climax",
                    "seg4": "peaceful resolution sounds, dawn chorus or sunset calm",
                }),
            ],
            "comedy": [
                (["slapstick", "physical", "fall"], {
                    "seg2": "building anticipation, comedic tension sounds",
                    "seg3": "crash-bang impact, comedic sound effect",
                    "seg4": "aftermath silence, then laughter",
                }),
                (["party", "celebration"], {
                    "seg2": "music and chatter building, glasses clinking",
                    "seg3": "peak celebration roar, champagne pop and cheers",
                    "seg4": "winding down laughter, warm ambient chatter",
                }),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], {
                    "seg2": "dhol beats building with shehnai melody, crowd cheering louder",
                    "seg3": "explosive baraat drums peak with joyous singing and fireworks",
                    "seg4": "gentle wedding melody fading, emotional murmur and bells",
                }),
                (["rain", "monsoon", "barish"], {
                    "seg2": "monsoon rain intensifying on rooftops, romantic playback vocals building",
                    "seg3": "dramatic thunder clap with soaring vocal melody peak",
                    "seg4": "rain softening to gentle patter, tender piano resolution",
                }),
                (["dance", "garba", "dandiya", "kathak"], {
                    "seg2": "tabla and dholak rhythm accelerating, ankle bells jingling faster",
                    "seg3": "percussive peak with clapping and energetic vocal burst",
                    "seg4": "rhythm settling to gentle tap, breathing and soft applause",
                }),
                (["emotional", "farewell", "bidaai", "departure"], {
                    "seg2": "melancholic violin swell with soft sobbing building",
                    "seg3": "raw emotional cry peak, dramatic string crescendo",
                    "seg4": "fading train whistle or car engine, hollow silence settling",
                }),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], {
                    "seg2": "neon hum and distant bass thump building through rain",
                    "seg3": "holographic ad burst and crowd surge, electronic static peak",
                    "seg4": "rain-dampened ambient hum, distant siren and neon buzz",
                }),
                (["rooftop", "skyline", "tower", "aerial"], {
                    "seg2": "city ambience rising from below, wind and distant sirens",
                    "seg3": "thunder crack over the megacity, structural groan",
                    "seg4": "high-altitude wind settling, distant city hum far below",
                }),
                (["club", "rave", "underground", "bar"], {
                    "seg2": "bass drop building, synthetic beats escalating",
                    "seg3": "peak drop with crowd roar and speaker distortion",
                    "seg4": "beats fading, ringing ears and muffled crowd murmur",
                }),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee", "run"], {
                    "seg2": "pounding footsteps accelerating, heavy breathing and traffic rush",
                    "seg3": "impact crash, glass shattering and metal scraping",
                    "seg4": "distant sirens, heavy breathing settling in quiet alley",
                }),
                (["explosion", "fire", "destruction", "blast"], {
                    "seg2": "ominous structural creak and gas hiss building",
                    "seg3": "deafening explosion blast, shockwave bass hit",
                    "seg4": "settling debris rain, crackling fire and distant calls",
                }),
                (["rooftop", "parkour", "urban", "jump"], {
                    "seg2": "footsteps on concrete accelerating, wind rushing",
                    "seg3": "leap silence then landing impact, gravel scatter",
                    "seg4": "settling breath, distant city sounds resuming",
                }),
                (["vehicle", "car", "motorcycle", "helicopter"], {
                    "seg2": "engine revving higher, tire screech on corners",
                    "seg3": "collision impact, metal crunch and glass shower",
                    "seg4": "engine ticking cool, settling debris and distant siren",
                }),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence"], {
                    "seg2": "pen scratching, paper rustling, clock ticking",
                    "seg3": "sharp intake of breath on discovery, chair scrape",
                    "seg4": "heavy silence, weight of revelation settling",
                }),
                (["chase", "escape", "stalker", "pursuit"], {
                    "seg2": "echoing footsteps getting closer, breath quickening",
                    "seg3": "door slam and confrontation sounds, struggle",
                    "seg4": "heavy panting, distant safety sounds slowly emerging",
                }),
                (["hostage", "captive", "interrogation", "cell"], {
                    "seg2": "dripping water, chain rattle, muffled sounds outside",
                    "seg3": "harsh voice demanding answers, fist on table impact",
                    "seg4": "heavy door shutting, footsteps receding to silence",
                }),
            ],
        }
        audio_evo_overrides = _AUDIO_EVO_CONTEXT_OVERRIDES.get(genre, [])
        if audio_evo_overrides:
            desc_lower_audio = description.lower()
            for keywords, override_audio_evo in audio_evo_overrides:
                if any(kw in desc_lower_audio for kw in keywords):
                    audio_evo = {**audio_evo, **override_audio_evo}
                    break

        # Color grading evolution across segments — in professional color
        # grading, the palette shifts to reinforce the emotional arc.
        # Seg 1 uses the DB-extracted colors (in `atmosphere`); these provide
        # the grade shift for segments 2-4.  Short phrases only (3-6 words)
        # to keep prompt length manageable.
        _GENRE_COLOR_EVOLUTION: dict[str, dict[str, str]] = {
            "fight": {
                "seg2": "palette shifts fiery red-orange",
                "seg3": "stark white-hot impact flash",
                "seg4": "desaturated cool blue aftermath",
            },
            "xianxia": {
                "seg2": "golden qi radiance intensifies",
                "seg3": "blinding celestial white-gold",
                "seg4": "soft jade-green afterglow",
            },
            "ecommerce": {
                "seg2": "warm aspirational product tones",
                "seg3": "clean bright hero lighting",
                "seg4": "refined minimal gradient backdrop",
            },
            "food": {
                "seg2": "warm golden appetizing glow",
                "seg3": "saturated rich food colors peak",
                "seg4": "soft warm amber comfort tones",
            },
            "drama": {
                "seg2": "muted tones deepen emotionally",
                "seg3": "high contrast raw emotion grade",
                "seg4": "desaturated melancholy palette",
            },
            "horror": {
                "seg2": "sickly green-grey creeping in",
                "seg3": "stark cold clinical white flash",
                "seg4": "near-black desaturated dread",
            },
            "nature": {
                "seg2": "rich earthy greens and golds",
                "seg3": "vivid saturated peak color",
                "seg4": "warm golden twilight palette",
            },
            "romance": {
                "seg2": "warm blush pink deepens",
                "seg3": "golden hour amber embrace",
                "seg4": "deep warm rose afterglow",
            },
            "thriller": {
                "seg2": "cold steel-blue tension grade",
                "seg3": "harsh overexposed reveal white",
                "seg4": "dim red emergency undertone",
            },
            "war": {
                "seg2": "smoke-grey desaturated chaos",
                "seg3": "fire-orange explosion palette",
                "seg4": "muted grey-green aftermath",
            },
            "bollywood": {
                "seg2": "vibrant jewel-tone sari colors",
                "seg3": "rich golden dramatic warmth",
                "seg4": "soft amber romantic afterglow",
            },
            "anime": {
                "seg2": "saturated energy-glow colors",
                "seg3": "overblown impact frame whites",
                "seg4": "soft pastel settling tones",
            },
            "cyberpunk": {
                "seg2": "neon magenta-cyan intensifies",
                "seg3": "electric overload white-blue",
                "seg4": "rain-dimmed muted neon fade",
            },
            "superhero": {
                "seg2": "power-glow saturated heroic",
                "seg3": "impact flash bright white-gold",
                "seg4": "dawn-lit hopeful warm tones",
            },
            "noir": {
                "seg2": "deep pool shadow contrast",
                "seg3": "harsh interrogation white-black",
                "seg4": "cold blue-grey rain palette",
            },
            "western": {
                "seg2": "bleached sun-scorched gold",
                "seg3": "dusty flash warm contrast",
                "seg4": "sunset burnt-orange horizon",
            },
            "comedy": {
                "seg2": "bright vivid cheerful palette",
                "seg3": "spotlight warm theatrical glow",
                "seg4": "sunny warm feel-good tones",
            },
            "documentary": {
                "seg2": "natural shifting available tones",
                "seg3": "intimate warm close-up grade",
                "seg4": "contemplative muted palette",
            },
            "sci_fi": {
                "seg2": "holographic blue-data glow",
                "seg3": "white-hot technological peak",
                "seg4": "cool equilibrium blue-teal",
            },
            "music_video": {
                "seg2": "rapid color gel transitions",
                "seg3": "single-color dramatic isolation",
                "seg4": "warm fade to intimate amber",
            },
            "underwater": {
                "seg2": "bioluminescent cyan-green glow",
                "seg3": "sun-shaft gold through blue",
                "seg4": "deep ocean indigo-blue fade",
            },
            "fairy_tale": {
                "seg2": "magical sparkle gold intensifies",
                "seg3": "radiant enchanted white-gold",
                "seg4": "soft stardust lavender settle",
            },
            "dance": {
                "seg2": "dynamic colored wash shifts",
                "seg3": "dramatic silhouette contrast",
                "seg4": "warm amber final-pose glow",
            },
            "travel": {
                "seg2": "rich saturated local colors",
                "seg3": "peak golden hour radiance",
                "seg4": "warm sunset farewell palette",
            },
            "fashion": {
                "seg2": "editorial contrast heightens",
                "seg3": "dramatic backlit silhouette grade",
                "seg4": "soft elegant beauty tones",
            },
            "sports": {
                "seg2": "vivid stadium-lit HDR colors",
                "seg3": "freeze-frame bright clarity",
                "seg4": "warm golden celebration palette",
            },
            "vfx": {
                "seg2": "energy-source colored glow",
                "seg3": "peak particle bright whites",
                "seg4": "settling ambient new-state grade",
            },
            "kpop": {
                "seg2": "neon gel-color rapid shifts",
                "seg3": "single spotlight high-contrast",
                "seg4": "warm pin-spot intimate fade",
            },
            "popscience": {
                "seg2": "data-visualization blue-white",
                "seg3": "breakthrough clarity bright",
                "seg4": "cool ambient scientific teal",
            },
            "historical": {
                "seg2": "torch-warm amber on stone",
                "seg3": "dramatic shaft-lit contrast",
                "seg4": "candlelit rich amber warmth",
            },
            "cinematic": {
                "seg2": "shifting golden cloud-filtered",
                "seg3": "dramatic cloudbreak radiance",
                "seg4": "warm twilight farewell amber",
            },
        }
        color_evo = _GENRE_COLOR_EVOLUTION.get(
            genre, _GENRE_COLOR_EVOLUTION.get("cinematic", {})
        )

        # Context-aware color evolution overrides — sub-genre keywords
        # refine the generic genre palette.  Same first-match-wins pattern
        # as _LIGHT_EVO_CONTEXT_OVERRIDES and _AUDIO_EVO_CONTEXT_OVERRIDES.
        _COLOR_EVO_CONTEXT_OVERRIDES: dict[str, list[tuple[list[str], dict[str, str]]]] = {
            "nature": [
                # Volcano/aurora BEFORE mountain — first match wins.
                (["volcano", "lava", "eruption", "magma"], {
                    "seg2": "orange-red magma glow intensifies",
                    "seg3": "white-hot molten eruption peak",
                    "seg4": "cooling ember red-grey ash tones",
                }),
                (["aurora", "northern lights", "borealis"], {
                    "seg2": "green-violet curtain glow shifting",
                    "seg3": "vivid neon aurora peak brilliance",
                    "seg4": "soft teal-indigo afterglow fade",
                }),
                (["underwater", "reef", "ocean depth", "coral"], {
                    "seg2": "deep cyan-blue intensifies",
                    "seg3": "bioluminescent glow peaks vivid",
                    "seg4": "mysterious indigo-abyss fade",
                }),
                (["desert", "sand", "dune"], {
                    "seg2": "bleached amber heat shimmer",
                    "seg3": "sun-scorched white-gold peak",
                    "seg4": "burnt sienna cooling dusk",
                }),
                (["storm", "lightning", "thunder"], {
                    "seg2": "bruised purple-grey cloud mass",
                    "seg3": "white lightning flash burst",
                    "seg4": "rain-washed grey-green calm",
                }),
            ],
            "horror": [
                (["psychological", "mind", "insanity", "hallucination"], {
                    "seg2": "reality desaturates to grey",
                    "seg3": "harsh clinical white-black",
                    "seg4": "complete color drain to noir",
                }),
                # Supernatural/demon BEFORE slasher/body — "creature" and "monster" are common.
                (["supernatural", "demon", "possession", "curse", "creature", "monster"], {
                    "seg2": "unearthly amber-red glow",
                    "seg3": "blinding unholy white flash",
                    "seg4": "ashen grey-purple void tones",
                }),
                (["body", "gore", "visceral", "mutate"], {
                    "seg2": "sickly flesh-tone pink-red",
                    "seg3": "vivid crimson blood peak",
                    "seg4": "dark coagulated rust-brown",
                }),
            ],
            "romance": [
                (["wedding", "ceremony", "bride", "aisle"], {
                    "seg2": "ivory and soft blush tones",
                    "seg3": "radiant white-gold purity",
                    "seg4": "champagne celebration glow",
                }),
                (["farewell", "goodbye", "departure", "leaving"], {
                    "seg2": "muted sepia melancholy tones",
                    "seg3": "cold blue loneliness wash",
                    "seg4": "deep grey-amber nostalgia",
                }),
            ],
            "sports": [
                (["boxing", "boxer", "ring", "knockout"], {
                    "seg2": "harsh arena red-gold spots",
                    "seg3": "blinding flash impact white",
                    "seg4": "warm spotlight golden victory",
                }),
                (["swimming", "pool", "diving"], {
                    "seg2": "turquoise pool-lit glow",
                    "seg3": "bright surface burst white-blue",
                    "seg4": "calm aqua settling tones",
                }),
                (["racing", "formula", "motorsport"], {
                    "seg2": "vivid sponsor-colored streaks",
                    "seg3": "speed-blur saturated peak",
                    "seg4": "checkered flag warm gold",
                }),
            ],
            "war": [
                (["medieval", "sword", "shield", "castle", "knight"], {
                    "seg2": "muddy brown blood-tinged earth",
                    "seg3": "fire-lit siege orange blast",
                    "seg4": "smoke-grey ash aftermath",
                }),
                (["samurai", "katana", "duel", "shogun"], {
                    "seg2": "cherry blossom soft pink-white",
                    "seg3": "blade-flash silver-white strike",
                    "seg4": "crimson blood-red aftermath",
                }),
                (["sniper", "scope", "tactical"], {
                    "seg2": "cold blue-grey surveillance",
                    "seg3": "muzzle flash amber-white",
                    "seg4": "dark olive aftermath mute",
                }),
            ],
            "sci_fi": [
                (["space", "zero-g", "station", "orbit"], {
                    "seg2": "deep space indigo-black",
                    "seg3": "star-bright white-blue flare",
                    "seg4": "nebula purple-teal afterglow",
                }),
                (["mecha", "robot", "cockpit", "pilot"], {
                    "seg2": "HUD green-amber overlay",
                    "seg3": "weapons-hot red-white flash",
                    "seg4": "cooling blue diagnostic tones",
                }),
            ],
            "dance": [
                (["ballet", "ballerina", "pointe", "classical"], {
                    "seg2": "soft pastel stage wash",
                    "seg3": "single warm spotlight gold",
                    "seg4": "ethereal blue-lavender fadeout",
                }),
                (["breakdance", "bboy", "popping", "street"], {
                    "seg2": "vivid neon graffiti colors",
                    "seg3": "strobe white-flash intensity",
                    "seg4": "warm amber street-light settle",
                }),
            ],
            "food": [
                (["sushi", "nigiri", "sashimi"], {
                    "seg2": "warm salmon-pink and ivory rice tones",
                    "seg3": "glossy wasabi-green accent and soy amber",
                    "seg4": "rich appetizing warm tones with ginger pink",
                }),
                (["grill", "sizzle", "bbq", "steak"], {
                    "seg2": "deep charcoal and ember-orange glow",
                    "seg3": "searing golden-brown caramelization peak",
                    "seg4": "warm resting mahogany with juice sheen",
                }),
                (["chocolate", "truffle", "ganache", "mousse"], {
                    "seg2": "deep cocoa-brown richness intensifying",
                    "seg3": "glossy dark-chocolate sheen with gold flecks",
                    "seg4": "warm mocha-amber settling glow",
                }),
                (["bake", "oven", "bread", "pastry"], {
                    "seg2": "golden crust tones warming",
                    "seg3": "peak golden-brown caramelization",
                    "seg4": "soft wheat-cream cooling tones",
                }),
            ],
            "fantasy": [
                (["dragon", "fire", "flame", "breath"], {
                    "seg2": "ember orange-red intensifying with smoke grey",
                    "seg3": "blinding white-gold dragon-fire peak",
                    "seg4": "cooling ash-grey with dying ember-red",
                }),
                (["spell", "magic", "enchant", "wizard"], {
                    "seg2": "blue-violet arcane energy building",
                    "seg3": "blinding white-gold magical discharge",
                    "seg4": "soft residual purple-blue shimmer fading",
                }),
                (["forest", "fairy", "elf", "woodland"], {
                    "seg2": "enchanted emerald-green with golden dapples",
                    "seg3": "fairy-light cyan-gold ethereal peak",
                    "seg4": "mystical deep green-violet twilight",
                }),
            ],
            "anime": [
                (["mecha", "robot", "transform"], {
                    "seg2": "metallic blue-silver with warning amber",
                    "seg3": "blinding transformation white with energy colors",
                    "seg4": "heroic cool steel-blue with victory gold",
                }),
                (["school", "slice", "cafe"], {
                    "seg2": "warm nostalgic amber classroom tones",
                    "seg3": "soft sakura-pink emotional peak",
                    "seg4": "golden sunset orange through windows",
                }),
            ],
            "documentary": [
                (["nature", "wildlife", "animal"], {
                    "seg2": "natural golden-hour warmth building",
                    "seg3": "dramatic directional natural light peak",
                    "seg4": "soft earth-tone resolution, peaceful colors",
                }),
                (["archive", "historical"], {
                    "seg2": "desaturated sepia-tinted archive tones",
                    "seg3": "slightly warmer nostalgic amber peak",
                    "seg4": "faded warm monochrome settling",
                }),
            ],
            "comedy": [
                (["slapstick", "physical", "fall"], {
                    "seg2": "bright vivid primary colors",
                    "seg3": "flash of exaggerated color on impact",
                    "seg4": "bright cheerful aftermath tones",
                }),
                (["party", "celebration"], {
                    "seg2": "multi-hue festive party colors building",
                    "seg3": "peak celebration confetti rainbow burst",
                    "seg4": "warm golden post-party glow settling",
                }),
            ],
            "bollywood": [
                (["wedding", "baraat", "mehendi", "sangeet"], {
                    "seg2": "vibrant marigold-orange and crimson red festive hues",
                    "seg3": "blazing gold and rich jewel-tone peak opulence",
                    "seg4": "soft warm amber with bridal red settling glow",
                }),
                (["rain", "monsoon", "barish"], {
                    "seg2": "wet slate-grey with emerald green foliage",
                    "seg3": "dramatic lightning-lit blue-white flash",
                    "seg4": "post-rain golden warmth with rainbow hints",
                }),
                (["dance", "garba", "dandiya", "kathak"], {
                    "seg2": "vivid sari colors, magenta and turquoise swirling",
                    "seg3": "saturated jewel-tone peak with golden highlights",
                    "seg4": "warm amber stage-glow with rich fabric sheen",
                }),
                (["emotional", "farewell", "bidaai", "departure"], {
                    "seg2": "muted warm tones with tear-glistening highlights",
                    "seg3": "desaturated emotional grey with vermillion accent",
                    "seg4": "sepia-amber farewell tones, fading warmth",
                }),
            ],
            "cyberpunk": [
                (["street", "market", "alley", "vendor", "crowd"], {
                    "seg2": "neon pink-cyan intensifying in rain reflections",
                    "seg3": "oversaturated holographic color peak, chromatic bleed",
                    "seg4": "muted blue-grey dawn washing out the neon",
                }),
                (["rooftop", "skyline", "tower", "aerial"], {
                    "seg2": "deep smog-orange against distant neon grid",
                    "seg3": "sweeping searchlight white cutting through haze",
                    "seg4": "cold pre-dawn steel-blue with dying neon",
                }),
                (["club", "bar", "underground", "rave"], {
                    "seg2": "pulsing UV purple and laser green",
                    "seg3": "strobe-white flash with neon afterimage",
                    "seg4": "dim red-amber low-light aftermath",
                }),
                (["chase", "pursuit", "escape", "flee"], {
                    "seg2": "streaking neon color trails in motion blur",
                    "seg3": "blinding headlight white with emergency red",
                    "seg4": "dark alley shadow with distant neon glow",
                }),
            ],
            "thriller": [
                (["investigation", "detective", "clue", "evidence"], {
                    "seg2": "cold forensic blue-white under examination",
                    "seg3": "harsh yellow-white evidence spotlight peak",
                    "seg4": "desaturated grey-green, the weight of discovery",
                }),
                (["chase", "pursuit", "escape", "run"], {
                    "seg2": "panic-flushed warm shifting to cold",
                    "seg3": "emergency red and harsh white flash",
                    "seg4": "exhaustion-grey with distant amber safety",
                }),
                (["hostage", "kidnap", "captive", "trapped"], {
                    "seg2": "oppressive shadow-black closing in",
                    "seg3": "bare-bulb harsh yellow-white on terrified face",
                    "seg4": "cold blue aftermath, the ordeal's toll visible",
                }),
                (["surveillance", "spy", "covert", "shadow"], {
                    "seg2": "monitor green-tint with deep shadow black",
                    "seg3": "flash of exposure white, cover blown",
                    "seg4": "cold operational grey, mission complete or failed",
                }),
            ],
            "action": [
                (["chase", "pursuit", "escape", "flee"], {
                    "seg2": "motion-blurred city grey streaked with brake red",
                    "seg3": "blinding collision white with sparking orange",
                    "seg4": "smoke-grey aftermath with distant red-blue emergency",
                }),
                (["explosion", "fire", "destruction", "blast"], {
                    "seg2": "growing orange-red fireball glow",
                    "seg3": "blinding white-yellow detonation peak",
                    "seg4": "ash-grey and ember-orange settling aftermath",
                }),
                (["fight", "combat", "brawl", "punch"], {
                    "seg2": "harsh arena-light with sweat sheen",
                    "seg3": "impact flash white on the decisive blow",
                    "seg4": "dim blood-red exhaustion tones",
                }),
                (["vehicle", "car", "motorcycle", "helicopter"], {
                    "seg2": "dashboard glow and tunnel light streak",
                    "seg3": "blinding headlight flare on impact moment",
                    "seg4": "smoking wreckage grey with oil-sheen rainbow",
                }),
            ],
        }
        color_evo_overrides = _COLOR_EVO_CONTEXT_OVERRIDES.get(genre, [])
        if color_evo_overrides:
            desc_lower_color = description.lower()
            for keywords, override_color in color_evo_overrides:
                if any(kw in desc_lower_color for kw in keywords):
                    color_evo = {**color_evo, **override_color}
                    break

        # Duration-aware motion scaling — shorter durations need simpler,
        # faster movements.  Longer durations can afford elaborate multi-stage
        # camera work.  We prepend a pace qualifier to each cam description.
        if duration <= 5:
            _dur_qualifier = "swift "  # 5s: fast, single movement
        elif duration <= 8:
            _dur_qualifier = ""  # 8s: standard pace (default)
        elif duration <= 12:
            _dur_qualifier = "measured "  # 10-12s: deliberate, room to breathe
        else:
            _dur_qualifier = "gradual "  # 13-15s: slow, elaborate movements

        # Apply duration qualifier to camera descriptions (but don't duplicate
        # if the fragment already starts with a speed word)
        _SPEED_STARTS = {"swift", "slow", "rapid", "fast", "quick", "gradual",
                         "measured", "agonizingly", "patient", "gentle", "raw"}
        cam_desc_scaled = []
        for cd in cam_descriptions:
            first_word = cd.split()[0].lower().rstrip(",") if cd else ""
            if _dur_qualifier and first_word not in _SPEED_STARTS:
                cam_desc_scaled.append(_dur_qualifier + cd[0].lower() + cd[1:])
            else:
                cam_desc_scaled.append(cd)
        cam_descriptions = cam_desc_scaled

        # Prepend aspect ratio framing cue to the description for seg 1
        desc_framed = f"{aspect_prefix}{desc}" if aspect_prefix else desc

        # Genre-aware segment phrase fallbacks — replace hardcoded
        # "the scene intensifies with dramatic energy" with genre-appropriate
        # phrases when no sub-genre context override matches.
        _SEG_FALLBACKS: dict[str, dict[str, str]] = {
            "food": {
                "seg2": "textures sharpen with appetizing clarity, every detail inviting",
                "seg3_build": "the presentation reaches peak visual appeal, every layer revealed",
                "seg3_peak": "the hero shot in perfect light, maximum culinary beauty",
                "seg4_build": "the finishing touches elevate the composition",
                "seg4_peak": "the definitive appetizing moment, perfectly styled and lit",
                "seg4_settle": "the dish rests in its warm setting, inviting and complete",
            },
            "romance": {
                "seg2": "intimacy deepens with tender warmth, the connection strengthening",
                "seg3_build": "emotion builds between the subjects, every glance weighted",
                "seg3_peak": "the most romantic moment, pure emotional truth captured",
                "seg4_build": "the tenderness reaches its height, vulnerability exposed",
                "seg4_peak": "the defining romantic moment, hearts laid bare",
                "seg4_settle": "a gentle resolution, warmth settling into quiet contentment",
            },
            "documentary": {
                "seg2": "the narrative unfolds with observational patience, truth emerging",
                "seg3_build": "the story deepens, context and meaning layering",
                "seg3_peak": "the defining revelation, the essential truth of the subject",
                "seg4_build": "perspective widens, placing the moment in broader context",
                "seg4_peak": "the most impactful documentary moment, reality unvarnished",
                "seg4_settle": "contemplative resolution, the subject in its full context",
            },
            "ecommerce": {
                "seg2": "product details emerge with premium finish catching the light",
                "seg3_build": "the product reveals its craftsmanship and design excellence",
                "seg3_peak": "the hero shot, maximum product appeal and desirability",
                "seg4_build": "final details and finishing touches spotlight quality",
                "seg4_peak": "the aspirational product moment, desire at its peak",
                "seg4_settle": "the product rests in its lifestyle context, elegant and inviting",
            },
            "comedy": {
                "seg2": "the comedic setup escalates with perfectly timed absurdity",
                "seg3_build": "the situation spirals into increasingly hilarious territory",
                "seg3_peak": "the punchline lands with perfect comedic timing",
                "seg4_build": "the aftermath compounds the humor with unexpected consequences",
                "seg4_peak": "the biggest laugh, the most absurd moment delivered perfectly",
                "seg4_settle": "the comedic dust settles, characters left in humorous aftermath",
            },
            "nature": {
                "seg2": "the natural world reveals a deeper layer of beauty and power",
                "seg3_build": "the landscape transforms with shifting light and weather",
                "seg3_peak": "the most breathtaking natural moment, awe-inspiring beauty",
                "seg4_build": "the environment shifts toward a new equilibrium",
                "seg4_peak": "nature at its most magnificent, the defining vista",
                "seg4_settle": "peaceful stillness returns, the landscape in serene repose",
            },
            "travel": {
                "seg2": "the destination reveals its character, cultural details emerging",
                "seg3_build": "the journey reaches its most visually stunning passage",
                "seg3_peak": "the awe-inspiring vista, the reason this place captivates",
                "seg4_build": "hidden local details enrich the sense of discovery",
                "seg4_peak": "the defining travel moment, wanderlust captured perfectly",
                "seg4_settle": "the destination settles into golden-hour tranquility",
            },
            "fashion": {
                "seg2": "fabric and form catch the light with editorial precision",
                "seg3_build": "the garment reveals its movement and construction artistry",
                "seg3_peak": "the hero fashion moment, silhouette at its most striking",
                "seg4_build": "final details — texture, drape, finishing — under spotlight",
                "seg4_peak": "the defining editorial shot, aspirational and flawless",
                "seg4_settle": "the model holds the final pose, garment in perfect repose",
            },
            "horror": {
                "seg2": "the unease deepens, something shifts in the shadows",
                "seg3_build": "dread tightens as the threat becomes unmistakable",
                "seg3_peak": "the terrifying reveal, the full horror exposed",
                "seg4_build": "the nightmare intensifies, no escape visible",
                "seg4_peak": "the most visceral moment of terror, inescapable dread",
                "seg4_settle": "an uneasy stillness, the horror lingers in the silence",
            },
            "sci_fi": {
                "seg2": "technology activates, systems pulsing with otherworldly energy",
                "seg3_build": "the futuristic environment reveals its scale and complexity",
                "seg3_peak": "the sci-fi spectacle reaches full magnitude, awe and wonder",
                "seg4_build": "cascading systems and data streams fill the space",
                "seg4_peak": "the technological sublime, the future fully realized",
                "seg4_settle": "systems stabilize, the futuristic world hums with quiet power",
            },
            "war": {
                "seg2": "the battlefield reveals its brutal scope, tension mounting",
                "seg3_build": "combat intensifies, smoke and chaos engulfing the scene",
                "seg3_peak": "the defining moment of battle, sacrifice and valor colliding",
                "seg4_build": "the conflict reaches its most desperate point",
                "seg4_peak": "the climactic battle moment, raw human courage under fire",
                "seg4_settle": "the aftermath settles, dust and silence replacing chaos",
            },
            "sports": {
                "seg2": "the athlete's focus sharpens, every muscle coiled with intent",
                "seg3_build": "the competition intensifies, the crowd's energy surging",
                "seg3_peak": "the defining athletic moment, peak human performance",
                "seg4_build": "the final push, everything on the line",
                "seg4_peak": "the triumphant climax, victory or heartbreak crystallized",
                "seg4_settle": "the exertion subsides, the result sinking in",
            },
            "bollywood": {
                "seg2": "the emotion swells with rich color and dramatic expression",
                "seg3_build": "the scene reaches maximum melodramatic intensity",
                "seg3_peak": "the hero moment, larger-than-life emotion and spectacle",
                "seg4_build": "the dramatic stakes reach their absolute zenith",
                "seg4_peak": "the most spectacular Bollywood moment, emotion and grandeur united",
                "seg4_settle": "the drama resolves with cinematic grace and emotional warmth",
            },
            "anime": {
                "seg2": "the energy builds with dynamic impact lines and speed",
                "seg3_build": "power surges visibly, the transformation beginning",
                "seg3_peak": "the ultimate technique unleashed, maximum anime spectacle",
                "seg4_build": "energy crackles and distorts the environment",
                "seg4_peak": "the climactic anime moment, raw power at its peak",
                "seg4_settle": "the energy dissipates, leaving dramatic stillness in its wake",
            },
            "dance": {
                "seg2": "the choreography builds in complexity and expressiveness",
                "seg3_build": "movement becomes more dynamic, the performance escalating",
                "seg3_peak": "the most spectacular move, perfect form at peak energy",
                "seg4_build": "the final sequence pushes physical limits",
                "seg4_peak": "the show-stopping moment, dance at its most electrifying",
                "seg4_settle": "the performer holds the final pose, energy still radiating",
            },
            "western": {
                "seg2": "tension builds under the scorching sun, hands hover near holsters",
                "seg3_build": "the standoff tightens, sweat and dust in the silence",
                "seg3_peak": "the decisive moment, the draw that decides everything",
                "seg4_build": "the frontier justice plays out in slow, deliberate motion",
                "seg4_peak": "the climactic western showdown, gunsmoke and dust",
                "seg4_settle": "the dust settles on the frontier, silence reclaims the land",
            },
            "superhero": {
                "seg2": "the hero's power manifests, energy building around them",
                "seg3_build": "the battle escalates to superhuman proportions",
                "seg3_peak": "the ultimate power moment, the hero at full strength",
                "seg4_build": "the final confrontation pushes abilities to the limit",
                "seg4_peak": "the most spectacular superhero moment, power unleashed completely",
                "seg4_settle": "the hero stands victorious, cape settling in the aftermath",
            },
        }
        _seg_fb = _SEG_FALLBACKS.get(genre, {})
        _default_seg2 = _seg_fb.get("seg2", "the scene intensifies with dramatic energy")
        _default_seg3_build = _seg_fb.get("seg3_build", "the action builds, dynamic energy fills the frame")
        _default_seg3_peak = _seg_fb.get("seg3_peak", "climactic moment, the scene reaches its peak")
        _default_seg4_build = _seg_fb.get("seg4_build", "the energy builds, movement becomes dynamic")
        _default_seg4_peak = _seg_fb.get("seg4_peak", "climactic peak, maximum visual impact")
        _default_seg4_settle = _seg_fb.get("seg4_settle", "the moment settles, final dramatic beat")

        if duration <= 5:
            # Short clip: no time segments, just enriched description
            prompt = (
                f"{cam_descriptions[0] if cam_descriptions else 'Cinematic shot'}, "
                f"{desc_framed}. {atmosphere}, {motion}, {pacing}, {quality_tag}. "
                f"{audio_verb} {context_audio_override or ', '.join(aud[:2])}."
            )

        elif duration <= 8:
            # 2 segments
            seg2_phrase = seg_phrases.get("seg2", _default_seg2)
            seg2_light = light_evo.get("seg2", "")
            seg2_color = color_evo.get("seg2", "")
            seg2_audio = audio_evo.get("seg2", ", ".join(aud[1:3]) if len(aud) > 1 else "building intensity")
            # Build visual evolution string (light + color)
            seg2_visual = ", ".join(filter(None, [seg2_light, seg2_color]))
            prompt = (
                f"0-4s: {cam_descriptions[0] if cam_descriptions else 'Opening shot'}, "
                f"{desc_framed}. {atmosphere}, {motion}, {pacing}, {quality_tag}. "
                f"{audio_verb} {aud_first}. "
                f"5-{duration}s: {cam_descriptions[1] if len(cam_descriptions) > 1 else 'Camera shifts'}, "
                f"{desc_anchor}, {seg2_phrase}, {particles}. "
                f"{seg2_visual + '. ' if seg2_visual else ''}"
                f"{audio_verb} {seg2_audio}."
            )

        elif duration <= 12:
            # 3 segments
            seg3_build = seg_phrases.get("seg3_build", _default_seg3_build)
            seg3_peak = seg_phrases.get("seg3_peak", _default_seg3_peak)
            seg2_light = light_evo.get("seg2", "")
            seg3_light = light_evo.get("seg3", "")
            seg2_color = color_evo.get("seg2", "")
            seg3_color = color_evo.get("seg3", "")
            seg2_audio = audio_evo.get("seg2", aud[1] if len(aud) > 1 else "rising tension")
            seg3_audio = audio_evo.get("seg3", ", ".join(aud[2:]) if len(aud) > 2 else "peak intensity, then fade")
            seg2_visual = ", ".join(filter(None, [seg2_light, seg2_color]))
            seg3_visual = ", ".join(filter(None, [seg3_light, seg3_color]))
            prompt = (
                f"0-3s: {cam_descriptions[0] if cam_descriptions else 'Opening shot'}, "
                f"{desc_framed}. {atmosphere}, {motion}, {pacing}, {quality_tag}. "
                f"{audio_verb} {aud_first}. "
                f"4-8s: {cam_descriptions[1] if len(cam_descriptions) > 1 else 'Camera movement intensifies'}, "
                f"{desc_anchor}, {seg3_build}, {particles}. "
                f"{seg2_visual + '. ' if seg2_visual else ''}"
                f"{audio_verb} {seg2_audio}. "
                f"9-{duration}s: {cam_descriptions[2] if len(cam_descriptions) > 2 else 'Final dramatic framing'}, "
                f"{desc_anchor_short}, {seg3_peak}. {seg3_visual + '. ' if seg3_visual else ''}"
                f"{audio_verb} {seg3_audio}."
            )

        else:
            # 4 segments (13-15s) — the full ByteDance pattern
            # Uses desc_anchor_short for segments 3-4 to keep within ~1000 chars.
            seg4_build = seg_phrases.get("seg4_build", _default_seg4_build)
            seg4_peak = seg_phrases.get("seg4_peak", _default_seg4_peak)
            seg4_settle = seg_phrases.get("seg4_settle", _default_seg4_settle)
            seg2_light = light_evo.get("seg2", "")
            seg3_light = light_evo.get("seg3", "")
            seg4_light = light_evo.get("seg4", "")
            seg2_color = color_evo.get("seg2", "")
            seg3_color = color_evo.get("seg3", "")
            seg4_color = color_evo.get("seg4", "")
            seg2_audio = audio_evo.get("seg2", aud[1] if len(aud) > 1 else "rising intensity")
            seg3_audio = audio_evo.get("seg3", aud[2] if len(aud) > 2 else "climactic peak")
            seg4_audio = audio_evo.get("seg4", ", ".join(aud[3:]) if len(aud) > 3 else "fading to silence")
            seg2_visual = ", ".join(filter(None, [seg2_light, seg2_color]))
            seg3_visual = ", ".join(filter(None, [seg3_light, seg3_color]))
            seg4_visual = ", ".join(filter(None, [seg4_light, seg4_color]))
            prompt = (
                f"0-3s: {cam_descriptions[0] if cam_descriptions else 'Opening shot'}, "
                f"{desc_framed}. {atmosphere}, {pacing}, {quality_tag}. "
                f"{audio_verb} {aud_first}. "
                f"4-8s: {cam_descriptions[1] if len(cam_descriptions) > 1 else 'Camera shifts to action'}, "
                f"{desc_anchor}, {seg4_build}. {seg2_visual + '. ' if seg2_visual else ''}"
                f"{audio_verb} {seg2_audio}. "
                f"9-12s: {cam_descriptions[2] if len(cam_descriptions) > 2 else 'Dramatic wide reveal'}, "
                f"{desc_anchor_short}, {seg4_peak}. {seg3_visual + '. ' if seg3_visual else ''}"
                f"{audio_verb} {seg3_audio}. "
                f"13-{duration}s: {cam_descriptions[3] if len(cam_descriptions) > 3 else 'Slow close-up'}, "
                f"{desc_anchor_short}, {seg4_settle}. {seg4_visual + '. ' if seg4_visual else ''}"
                f"{audio_verb} {seg4_audio}."
            )

        return self._deduplicate_prompt(prompt, desc_words=desc, audio_verb=audio_verb)

    @staticmethod
    def _deduplicate_prompt(
        prompt: str,
        max_repeats: int = 2,
        desc_words: str = "",
        audio_verb: str = "",
    ) -> str:
        """Remove excessive word repetition across the prompt.

        Words longer than 5 chars that appear more than *max_repeats* times
        have their 3rd+ occurrences silently dropped.  Words from the
        original description (subject anchors) or the audio verb label
        get a higher threshold since they intentionally repeat.

        Compound cinematic terms (e.g. "golden hour", "slow motion") are
        protected — their constituent words won't be stripped when they
        appear as part of a recognized bigram.
        """
        import re

        _TIME_RE = re.compile(r"\d+-\d+s:")

        # Words to never deduplicate (common connectors / structural)
        _SKIP = frozenset({
            "the", "and", "with", "from", "that", "this", "into", "over",
            "through", "camera", "audio", "sound", "light", "frame",
            "scene", "shot",
        })

        # Compound cinematic terms — when a word appears as part of a
        # known bigram, skip dedup for that occurrence.  The second word
        # of each pair is the one that typically gets stripped.
        _COMPOUND_TERMS: set[tuple[str, str]] = {
            ("golden", "hour"), ("slow", "motion"), ("high", "contrast"),
            ("shallow", "focus"), ("deep", "focus"), ("motion", "blur"),
            ("lens", "flare"), ("low", "angle"), ("wide", "angle"),
            ("tracking", "shot"), ("handheld", "camera"),
            ("rack", "focus"), ("depth", "field"),
            ("film", "grain"), ("film", "stock"), ("color", "grade"),
            ("rim", "light"), ("natural", "lighting"),
            ("camera", "movement"), ("ambient", "light"),
            ("dramatic", "shadows"), ("volumetric", "lighting"),
            ("chromatic", "aberration"), ("barrel", "distortion"),
        }
        # Build lookup: word → set of valid next-words
        _COMPOUND_NEXT: dict[str, set[str]] = {}
        for w1, w2 in _COMPOUND_TERMS:
            _COMPOUND_NEXT.setdefault(w1, set()).add(w2)

        # Subject/anchor words from the original description get +2 allowance.
        # The first 3 content words (the true subject identity) are fully
        # immune — they form the anchor that grounds Seedance on-subject
        # and must survive no matter how many times templates reuse them.
        _STRIP_LEADING_DEDUP = {"a", "an", "the", "this", "that", "some"}
        desc_content = [
            w.lower().rstrip(".,;:!?")
            for w in desc_words.split()
            if w.lower().rstrip(".,;:!?") not in _STRIP_LEADING_DEDUP
        ]
        subject_core = frozenset(
            w for w in desc_content[:3] if len(w) > 3
        )
        protected = {
            w.lower().rstrip(".,;:!?")
            for w in desc_words.split()
            if len(w.rstrip(".,;:!?")) > 5
        }
        # Audio verb words (e.g. "Natural", "Heroic") repeat by design
        for w in audio_verb.split():
            core = w.lower().rstrip(".,;:!?")
            if len(core) > 5:
                protected.add(core)

        # Audio verb labels — stored WITHOUT trailing colon since rstrip removes it
        _LABEL_NEXT = frozenset({"audio", "soundscape", "ambience"})

        tokens = prompt.split()
        seen: dict[str, int] = {}
        out: list[str] = []

        for i, tok in enumerate(tokens):
            if _TIME_RE.match(tok):
                out.append(tok)
                continue

            core = tok.lower().rstrip(".,;:!?").lstrip("(")
            if len(core) <= 5 or core in _SKIP:
                out.append(tok)
                continue

            # Never dedup a word immediately before an audio label marker
            next_core = (
                tokens[i + 1].lower().rstrip(".,;:!?")
                if i + 1 < len(tokens) else ""
            )
            if next_core in _LABEL_NEXT:
                out.append(tok)
                continue

            # Protect compound cinematic terms — if this word + next word
            # form a known compound, skip dedup for this occurrence.
            if core in _COMPOUND_NEXT and next_core in _COMPOUND_NEXT[core]:
                out.append(tok)
                continue
            # Also protect the second word of a compound (check prev word)
            if i > 0:
                prev_core = tokens[i - 1].lower().rstrip(".,;:!?").lstrip("(")
                if prev_core in _COMPOUND_NEXT and core in _COMPOUND_NEXT.get(prev_core, set()):
                    out.append(tok)
                    continue

            # Subject-core words (first 3 content words) are fully immune
            if core in subject_core:
                out.append(tok)
                continue

            seen[core] = seen.get(core, 0) + 1
            limit = max_repeats + 2 if core in protected else max_repeats
            if seen[core] <= limit:
                out.append(tok)

        return " ".join(out)

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def stats(self) -> dict:
        """Return database statistics."""
        prompts_count = self.conn.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
        genres = self.get_all_genres()
        cameras_count = self.conn.execute("SELECT COUNT(DISTINCT phrase) FROM camera_phrases").fetchone()[0]
        audio_count = self.conn.execute("SELECT COUNT(DISTINCT phrase) FROM audio_phrases").fetchone()[0]
        skills_count = self.conn.execute("SELECT COUNT(*) FROM xskill_skills").fetchone()[0]
        time_seg_count = self.conn.execute(
            "SELECT COUNT(*) FROM prompts WHERE has_time_segments = 1"
        ).fetchone()[0]
        dialogue_count = self.conn.execute(
            "SELECT COUNT(*) FROM prompts WHERE has_dialogue = 1"
        ).fetchone()[0]

        categories = self.conn.execute(
            "SELECT category, COUNT(*) as cnt FROM prompts GROUP BY category ORDER BY cnt DESC"
        ).fetchall()

        return {
            "total_prompts": prompts_count,
            "total_genres": len(genres),
            "genres": genres,
            "unique_camera_phrases": cameras_count,
            "unique_audio_phrases": audio_count,
            "xskill_skills": skills_count,
            "with_time_segments": time_seg_count,
            "with_dialogue": dialogue_count,
            "categories": [(row["category"], row["cnt"]) for row in categories],
        }

    # ------------------------------------------------------------------
    # Rebuild
    # ------------------------------------------------------------------

    def rebuild(self):
        """Force rebuild the database from CSV source files."""
        self.close()
        if self.db_path.exists():
            self.db_path.unlink()
        self._conn = None
        self._create_schema()
        self._migrate_feedback_columns()
        self._populate_from_csv()

    # ------------------------------------------------------------------
    # Internal Helpers
    # ------------------------------------------------------------------

    def _row_to_record(self, row: sqlite3.Row) -> PromptRecord:
        """Convert a database row to a PromptRecord."""
        # Fetch genres for this prompt
        genres = self.conn.execute(
            "SELECT genre FROM genre_tags WHERE prompt_id = ? ORDER BY relevance DESC",
            (row["id"],),
        ).fetchall()

        return PromptRecord(
            id=row["id"],
            category=row["category"],
            subcategory=row["subcategory"],
            prompt_text=row["prompt_text"],
            source_url=row["source_url"],
            duration=row["duration"],
            genres=[g["genre"] for g in genres],
            camera_techniques=json.loads(row["camera_techniques"]),
            audio_cues=json.loads(row["audio_cues"]),
            color_palettes=json.loads(row["color_palettes"]),
            has_time_segments=bool(row["has_time_segments"]),
            has_dialogue=bool(row["has_dialogue"]),
            quality_score=row["quality_score"],
            generation_count=row["generation_count"] or 0,
            success_count=row["success_count"] or 0,
            content_filter_count=row["content_filter_count"] or 0,
            last_used=row["last_used"],
            feedback_notes=row["feedback_notes"] or '',
        )


# ============================================================================
# CLI
# ============================================================================

def main():
    import sys

    if len(sys.argv) < 2:
        print("Usage: python seedance_prompt_db.py <command> [args]")
        print("Commands: stats, search, cameras, audios, genres, expand, beat-sync, rebuild")
        sys.exit(1)

    cmd = sys.argv[1]
    db = PromptDB()

    if cmd == "stats":
        s = db.stats()
        print(f"\n=== Seedance Prompt Library ===")
        print(f"Total prompts:          {s['total_prompts']}")
        print(f"With time segments:     {s['with_time_segments']}")
        print(f"With dialogue:          {s['with_dialogue']}")
        print(f"Unique camera phrases:  {s['unique_camera_phrases']}")
        print(f"Unique audio phrases:   {s['unique_audio_phrases']}")
        print(f"xskill.ai skills:       {s['xskill_skills']}")
        print(f"\nCategories:")
        for cat, cnt in s["categories"]:
            print(f"  {cat}: {cnt}")
        print(f"\nGenres ({s['total_genres']}):")
        for genre, cnt in s["genres"]:
            print(f"  {genre}: {cnt} prompts")

    elif cmd == "search":
        genre = None
        keyword = None
        for i, arg in enumerate(sys.argv[2:], 2):
            if arg == "--keyword" and i + 1 < len(sys.argv):
                keyword = sys.argv[i + 1]
            elif not arg.startswith("--") and genre is None:
                genre = arg

        results = db.search(genre=genre, keyword=keyword, limit=5)
        print(f"\n=== Search Results ({len(results)}) ===")
        for r in results:
            print(f"\n--- Prompt #{r.id} [{r.category}/{r.subcategory}] ---")
            print(f"Genres: {', '.join(r.genres)}")
            print(f"Cameras: {', '.join(r.camera_techniques[:5])}")
            print(f"Audio: {', '.join(r.audio_cues[:3])}")
            print(f"Time segments: {'Yes' if r.has_time_segments else 'No'}")
            # Show first 200 chars of prompt
            preview = r.prompt_text[:200] + "..." if len(r.prompt_text) > 200 else r.prompt_text
            print(f"Prompt: {preview}")

    elif cmd == "cameras":
        genre = sys.argv[2] if len(sys.argv) > 2 else None
        phrases = db.get_camera_phrases(genre=genre)
        label = f" for genre '{genre}'" if genre else ""
        print(f"\n=== Camera Phrases{label} ({len(phrases)}) ===")
        for p in phrases:
            print(f"  - {p}")

    elif cmd == "audios":
        genre = sys.argv[2] if len(sys.argv) > 2 else None
        phrases = db.get_audio_phrases(genre=genre)
        label = f" for genre '{genre}'" if genre else ""
        print(f"\n=== Audio Phrases{label} ({len(phrases)}) ===")
        for p in phrases:
            print(f"  - {p}")

    elif cmd == "genres":
        genres = db.get_all_genres()
        print(f"\n=== Available Genres ({len(genres)}) ===")
        for genre, cnt in genres:
            print(f"  {genre}: {cnt} prompts")

    elif cmd == "expand":
        if len(sys.argv) < 3:
            print("Usage: python seedance_prompt_db.py expand \"description\" [--genre fight] [--duration 15]")
            sys.exit(1)

        description = sys.argv[2]
        genre = None
        duration = 15

        for i, arg in enumerate(sys.argv[3:], 3):
            if arg == "--genre" and i + 1 < len(sys.argv):
                genre = sys.argv[i + 1]
            elif arg == "--duration" and i + 1 < len(sys.argv):
                duration = int(sys.argv[i + 1])

        result = db.expand_prompt(description, genre=genre, duration=duration)
        print(f"\n=== Prompt Expansion ===")
        print(f"Original:    {result.original}")
        print(f"Genre:       {result.genre}")
        print(f"Duration:    {result.duration}s")
        print(f"Template ID: {result.template_id}")
        print(f"Cameras:     {', '.join(result.camera_suggestions)}")
        print(f"Audio:       {', '.join(result.audio_suggestions)}")
        print(f"Colors:      {', '.join(result.color_suggestions)}")
        print(f"\nExpanded prompt:")
        print(f"  {result.expanded}")

    elif cmd == "beat-sync":
        if len(sys.argv) < 3:
            print("Usage: python seedance_prompt_db.py beat-sync \"description\" --bpm 120 [--duration 8] [--genre cinematic]")
            sys.exit(1)

        description = sys.argv[2]
        bpm = None
        duration = 8
        genre = None

        for i, arg in enumerate(sys.argv[3:], 3):
            if arg == "--bpm" and i + 1 < len(sys.argv):
                bpm = int(sys.argv[i + 1])
            elif arg == "--duration" and i + 1 < len(sys.argv):
                duration = int(sys.argv[i + 1])
            elif arg == "--genre" and i + 1 < len(sys.argv):
                genre = sys.argv[i + 1]

        if bpm is None:
            print("Error: --bpm is required")
            sys.exit(1)

        from seedance_prompt_builder import build_beat_synced_prompt

        result = build_beat_synced_prompt(
            description=description,
            bpm=bpm,
            duration=duration,
            genre=genre or "cinematic",
        )
        print(f"\n=== Beat-Synced Prompt ({bpm} BPM, {duration}s, genre={genre or 'cinematic'}) ===")
        print(f"\n{result}")

    elif cmd == "rebuild":
        db.rebuild()
        s = db.stats()
        print(f"Database rebuilt: {s['total_prompts']} prompts, {s['total_genres']} genres")

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)

    db.close()


if __name__ == "__main__":
    main()
