#!/usr/bin/env python3
"""Voice Design preset registry.

Each preset defines voice characteristics for ElevenLabs Voice Design API.
Presets provide tested combinations of gender, age, accent, tone, and other
vocal qualities for consistent, professional voice generation.

Usage:
    from voice_presets import VOICE_DESIGN_PRESETS, get_preset, get_preset_description

    preset = get_preset("professional-narrator")
    description = get_preset_description("professional-narrator")
"""


VOICE_DESIGN_PRESETS: dict[str, dict] = {
    # ═══════════════════════════════════════════════════════════════════════════
    # PROFESSIONAL & CORPORATE
    # Best for: Business videos, corporate presentations, training content
    # ═══════════════════════════════════════════════════════════════════════════
    "professional-narrator": {
        "description": (
            "A mature, confident male voice with a deep resonant quality. "
            "Speaks with measured pacing and authoritative yet warm delivery. "
            "Clear American accent, perfect articulation. "
            "Professional studio recording quality with no background noise."
        ),
        "gender": "male",
        "age": "middle-aged",
        "accent": "american",
        "tone": "authoritative",
        "emotion": "neutral",
        "pacing": "measured",
        "audio_quality": "clean studio",
        "special": "resonant",
        "best_for": "Corporate videos, training content, business presentations",
    },
    "documentary-narrator": {
        "description": (
            "A seasoned male voice with gravitas and depth, reminiscent of classic "
            "documentary narration. Contemplative delivery with thoughtful pauses. "
            "Rich baritone timbre with subtle warmth. British accent adds sophistication. "
            "Cinematic quality, intimate yet expansive."
        ),
        "gender": "male",
        "age": "mature",
        "accent": "british",
        "tone": "contemplative",
        "emotion": "contemplative",
        "pacing": "slow",
        "audio_quality": "clean studio",
        "special": "gravelly",
        "best_for": "Documentaries, nature films, historical content",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # ENERGETIC & DYNAMIC
    # Best for: Ads, promos, product launches, sports content
    # ═══════════════════════════════════════════════════════════════════════════
    "energetic-announcer": {
        "description": (
            "A dynamic male voice bursting with enthusiasm and energy. "
            "Fast-paced delivery with punchy emphasis on key words. "
            "Bright, crisp vocal quality that cuts through any mix. "
            "American accent with broadcast-quality clarity. "
            "Perfect for grabbing attention and driving excitement."
        ),
        "gender": "male",
        "age": "young",
        "accent": "american",
        "tone": "energetic",
        "emotion": "excited",
        "pacing": "fast",
        "audio_quality": "clean studio",
        "special": "crisp",
        "best_for": "Commercials, promos, sports, product launches",
    },
    "friendly-presenter": {
        "description": (
            "A warm, approachable female voice with natural charm. "
            "Conversational delivery that feels like talking to a friend. "
            "Moderate pacing with gentle enthusiasm. Clear American accent. "
            "Inviting and trustworthy, perfect for building connection."
        ),
        "gender": "female",
        "age": "young",
        "accent": "american",
        "tone": "friendly",
        "emotion": "happy",
        "pacing": "natural",
        "audio_quality": "clean studio",
        "special": "breathy",
        "best_for": "Tutorials, explainer videos, lifestyle content, wellness",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # STORYTELLING & CREATIVE
    # Best for: Narratives, audiobooks, children's content, podcasts
    # ═══════════════════════════════════════════════════════════════════════════
    "storyteller": {
        "description": (
            "A captivating female voice with theatrical range and expressiveness. "
            "Dramatic pacing with dynamic shifts in tone and emotion. "
            "Rich, melodic quality that draws listeners into the narrative. "
            "Neutral accent with clear enunciation. "
            "Warm vintage audio character for intimate storytelling."
        ),
        "gender": "female",
        "age": "middle-aged",
        "accent": "neutral",
        "tone": "dramatic",
        "emotion": "neutral",
        "pacing": "measured",
        "audio_quality": "warm vintage",
        "special": "resonant",
        "best_for": "Audiobooks, children's stories, branded narratives",
    },
    "dramatic-narrator": {
        "description": (
            "A powerful male voice with intense dramatic presence. "
            "Deep, commanding delivery with controlled intensity. "
            "Measured pacing that builds tension and anticipation. "
            "American accent with theatrical polish. "
            "Perfect for trailers, teasers, and high-stakes content."
        ),
        "gender": "male",
        "age": "middle-aged",
        "accent": "american",
        "tone": "dramatic",
        "emotion": "serious",
        "pacing": "slow",
        "audio_quality": "clean studio",
        "special": "gravelly",
        "best_for": "Movie trailers, game cinematics, dramatic promos",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # TECH & EDUCATIONAL
    # Best for: Tech content, tutorials, educational videos
    # ═══════════════════════════════════════════════════════════════════════════
    "tech-explainer": {
        "description": (
            "A clear, articulate male voice with modern tech-savvy appeal. "
            "Naturally paced delivery that makes complex topics accessible. "
            "Crisp, clean vocal quality with perfect clarity. "
            "Neutral American accent, youthful but professional. "
            "Confident without being condescending."
        ),
        "gender": "male",
        "age": "young",
        "accent": "american",
        "tone": "professional",
        "emotion": "neutral",
        "pacing": "natural",
        "audio_quality": "clean studio",
        "special": "crisp",
        "best_for": "Tech tutorials, software demos, product walkthroughs",
    },
    "podcast-host": {
        "description": (
            "A relatable, engaging female voice with podcast-natural delivery. "
            "Conversational pacing with authentic personality. "
            "Warm, natural audio quality that feels intimate and real. "
            "American accent with genuine warmth. "
            "Makes listeners feel like part of the conversation."
        ),
        "gender": "female",
        "age": "young",
        "accent": "american",
        "tone": "friendly",
        "emotion": "happy",
        "pacing": "natural",
        "audio_quality": "podcast natural",
        "special": "breathy",
        "best_for": "Podcasts, vlogs, social media content",
    },
    # ═══════════════════════════════════════════════════════════════════════════
    # REGIONAL & SPECIALIZED
    # Best for: Market-specific content, meditation, wellness
    # ═══════════════════════════════════════════════════════════════════════════
    "indian-professional": {
        "description": (
            "A polished male voice with a refined Indian accent. "
            "Professional and authoritative with warm undertones. "
            "Measured pacing with clear articulation. "
            "Perfect for South Asian market content or global tech narration. "
            "Clean studio quality with modern production values."
        ),
        "gender": "male",
        "age": "middle-aged",
        "accent": "indian",
        "tone": "professional",
        "emotion": "neutral",
        "pacing": "measured",
        "audio_quality": "clean studio",
        "special": "resonant",
        "best_for": "Indian market content, tech, corporate training",
    },
    "calm-meditation": {
        "description": (
            "A serene, soothing female voice with calming presence. "
            "Slow, gentle pacing with mindful pauses. "
            "Soft, breathy quality that promotes relaxation. "
            "Neutral accent with ethereal warmth. "
            "Perfect for guiding meditation, sleep, and wellness content."
        ),
        "gender": "female",
        "age": "middle-aged",
        "accent": "neutral",
        "tone": "calm",
        "emotion": "contemplative",
        "pacing": "slow",
        "audio_quality": "clean studio",
        "special": "breathy",
        "best_for": "Meditation, sleep content, wellness apps, ASMR",
    },
}

# ═══════════════════════════════════════════════════════════════════════════════
# CONVERSATIONAL CHARACTER PRESETS
# Best for: Dialogue, storytelling, drama, audiobooks with multiple characters
# These presets include emotion_palette for V3 emotion tagging
# ═══════════════════════════════════════════════════════════════════════════════

CONVERSATIONAL_PRESETS: dict[str, dict] = {
    "conversational-frustrated-female": {
        "description": (
            "Female voice, late 20s to early 30s. Voice is frustrated, tired, and weary. "
            "Speech has quiet intensity with occasional sharp edges. Delivers lines with "
            "restrained anger that occasionally breaks through. Natural conversational dialogue."
        ),
        "gender": "female",
        "age": "late 20s to early 30s",
        "accent": "neutral",
        "tone": "frustrated",
        "emotion_palette": ["frustrated", "tired", "quiet", "annoyed", "weary", "angry", "irritation"],
        "delivery_tags": ["pause", "measured", "lower", "quicker"],
        "best_for": "Drama, tense scenes, arguments, exasperated characters",
        "conversational": True,
    },
    "conversational-desperate-male": {
        "description": (
            "Male voice, late 20s to early 30s. Voice is tense, defeated, and weary. "
            "Speech shifts between desperate hope and resigned acceptance. Occasional voice "
            "cracks betray deep emotion. Natural conversational dialogue."
        ),
        "gender": "male",
        "age": "late 20s to early 30s",
        "accent": "neutral",
        "tone": "desperate",
        "emotion_palette": ["exhausted", "desperate", "whiny", "defeated", "hopeless", "shaky"],
        "delivery_tags": ["breathing", "voice cracks", "quiet", "pause"],
        "best_for": "Drama, survival scenarios, emotional breakdowns, hopeless situations",
        "conversational": True,
    },
    "conversational-hopeful-female": {
        "description": (
            "Female voice, mid 20s. Voice carries warmth and underlying optimism even in "
            "difficult moments. Speech balances vulnerability with quiet determination. "
            "Genuine emotional connection in delivery. Natural conversational dialogue."
        ),
        "gender": "female",
        "age": "mid 20s",
        "accent": "neutral",
        "tone": "hopeful",
        "emotion_palette": ["hopeful", "warm", "gentle", "determined", "vulnerable", "encouraging"],
        "delivery_tags": ["soft", "pause", "quicker", "brighter"],
        "best_for": "Inspirational content, recovery stories, supportive characters",
        "conversational": True,
    },
    "conversational-fearful-male": {
        "description": (
            "Male voice, late 20s. Voice conveys underlying anxiety and unease. "
            "Speech is hesitant with occasional tremors. Delivery shifts between forced "
            "calm and barely contained panic. Natural conversational dialogue."
        ),
        "gender": "male",
        "age": "late 20s",
        "accent": "neutral",
        "tone": "fearful",
        "emotion_palette": ["uneasy", "fear", "anxious", "nervous", "shaky", "panicked"],
        "delivery_tags": ["voice cracks", "whisper", "quicker", "breathing", "pause"],
        "best_for": "Horror, thriller, suspense, anxiety-driven scenes",
        "conversational": True,
    },
    "conversational-resolute-female": {
        "description": (
            "Female voice, early 30s. Voice is firm and decisive with underlying steel. "
            "Speech is measured and deliberate, conveying authority without aggression. "
            "Commands respect through quiet confidence. Natural conversational dialogue."
        ),
        "gender": "female",
        "age": "early 30s",
        "accent": "neutral",
        "tone": "resolute",
        "emotion_palette": ["firm", "resolute", "determined", "confident", "steady", "commanding"],
        "delivery_tags": ["measured", "lower", "pause", "deliberate"],
        "best_for": "Leadership moments, decisions, strong female characters",
        "conversational": True,
    },
    "conversational-weary-male": {
        "description": (
            "Male voice, late 30s to early 40s. Voice carries the weight of experience "
            "and exhaustion. Speech is slower, more deliberate, with sighs and pauses. "
            "Underlying sadness tempered by hard-won wisdom. Natural conversational dialogue."
        ),
        "gender": "male",
        "age": "late 30s to early 40s",
        "accent": "neutral",
        "tone": "weary",
        "emotion_palette": ["tired", "weary", "sad", "resigned", "contemplative", "exhausted"],
        "delivery_tags": ["slower", "pause", "breathing", "lower", "sigh"],
        "best_for": "World-weary characters, mentors, post-trauma narratives",
        "conversational": True,
    },
    "conversational-angry-female": {
        "description": (
            "Female voice, late 20s. Voice burns with controlled fury that occasionally "
            "erupts. Speech alternates between tight, clipped delivery and passionate outbursts. "
            "Righteous anger drives every word. Natural conversational dialogue."
        ),
        "gender": "female",
        "age": "late 20s",
        "accent": "neutral",
        "tone": "angry",
        "emotion_palette": ["angry", "furious", "intense", "sharp", "bitter", "seething"],
        "delivery_tags": ["shouting", "quicker", "clipped", "lower", "pause"],
        "best_for": "Confrontations, injustice scenes, passionate arguments",
        "conversational": True,
    },
    "conversational-sarcastic-male": {
        "description": (
            "Male voice, early 30s. Voice drips with dry wit and sardonic undertones. "
            "Speech has rhythmic quality with perfectly timed pauses for effect. "
            "Eye-roll practically audible in delivery. Natural conversational dialogue."
        ),
        "gender": "male",
        "age": "early 30s",
        "accent": "neutral",
        "tone": "sarcastic",
        "emotion_palette": ["sarcastic", "dry", "amused", "dismissive", "ironic", "deadpan"],
        "delivery_tags": ["pause", "slower", "emphasis", "flat"],
        "best_for": "Comedy, cynical characters, witty dialogue",
        "conversational": True,
    },
}

# Merge conversational presets into main registry
VOICE_DESIGN_PRESETS.update(CONVERSATIONAL_PRESETS)


def get_preset(name: str) -> dict | None:
    """Get a voice preset by name.

    Args:
        name: Preset name (e.g., "professional-narrator")

    Returns:
        Preset dict if found, None otherwise
    """
    return VOICE_DESIGN_PRESETS.get(name)


def get_preset_description(name: str) -> str | None:
    """Get just the description from a preset.

    Args:
        name: Preset name

    Returns:
        Description string if preset exists, None otherwise
    """
    preset = get_preset(name)
    return preset.get("description") if preset else None


def list_presets() -> dict[str, str]:
    """List all presets with their best_for descriptions.

    Returns:
        Dict mapping preset name to best_for description
    """
    return {
        name: preset.get("best_for", "General use")
        for name, preset in VOICE_DESIGN_PRESETS.items()
    }


def build_description_from_attributes(
    gender: str,
    age: str,
    accent: str,
    tone: str,
    emotion: str | None = None,
    pacing: str | None = None,
    audio_quality: str | None = None,
    special: str | None = None,
) -> str:
    """Build a voice description from individual attributes.

    Args:
        gender: "male", "female", or "neutral"
        age: "young", "middle-aged", or "mature"
        accent: "american", "british", "australian", "indian", "neutral"
        tone: "professional", "friendly", "dramatic", "calm", "energetic", "authoritative"
        emotion: Optional emotion modifier
        pacing: Optional pacing preference
        audio_quality: Optional audio quality description
        special: Optional special vocal quality

    Returns:
        Formatted voice description string for ElevenLabs Voice Design API
    """
    # Map age to more descriptive terms
    age_descriptions = {
        "young": "youthful, in their 20s",
        "middle-aged": "mature, in their 30s-40s",
        "mature": "seasoned, in their 50s or older",
    }
    age_desc = age_descriptions.get(age, age)

    # Map tone to delivery style
    tone_styles = {
        "professional": "professional and polished",
        "friendly": "warm and approachable",
        "dramatic": "dramatic and expressive",
        "calm": "calm and soothing",
        "energetic": "energetic and dynamic",
        "authoritative": "authoritative and confident",
        "contemplative": "thoughtful and contemplative",
    }
    tone_desc = tone_styles.get(tone, tone)

    # Build the description
    parts = [
        f"A {age_desc} {gender} voice with a {accent} accent.",
        f"Delivery is {tone_desc}.",
    ]

    if emotion:
        parts.append(f"The emotional quality is {emotion}.")

    if pacing:
        pacing_descs = {
            "slow": "Pacing is slow and deliberate with thoughtful pauses.",
            "measured": "Pacing is measured and controlled.",
            "natural": "Pacing is natural and conversational.",
            "fast": "Pacing is fast and energetic.",
        }
        parts.append(pacing_descs.get(pacing, f"Pacing is {pacing}."))

    if special:
        special_descs = {
            "gravelly": "The voice has a gravelly, textured quality.",
            "breathy": "The voice has a soft, breathy quality.",
            "resonant": "The voice has a deep, resonant quality.",
            "crisp": "The voice is crisp and articulate.",
        }
        parts.append(special_descs.get(special, f"The voice is {special}."))

    if audio_quality:
        quality_descs = {
            "clean studio": "Professional studio recording quality with no background noise.",
            "warm vintage": "Warm, vintage audio character with subtle analog warmth.",
            "podcast natural": "Natural podcast-style recording with authentic intimacy.",
        }
        parts.append(quality_descs.get(audio_quality, f"Audio quality: {audio_quality}."))

    return " ".join(parts)


# Simple questionnaire options
SIMPLE_QUESTIONNAIRE = {
    "gender": {
        "question": "What gender should the voice be?",
        "options": ["Male", "Female", "Neutral"],
        "values": ["male", "female", "neutral"],
    },
    "age": {
        "question": "What age range?",
        "options": ["Young (20s)", "Middle-aged (30-40s)", "Mature (50+)"],
        "values": ["young", "middle-aged", "mature"],
    },
    "accent": {
        "question": "What accent?",
        "options": ["American", "British", "Australian", "Indian", "Neutral"],
        "values": ["american", "british", "australian", "indian", "neutral"],
    },
    "tone": {
        "question": "What tone/style?",
        "options": ["Professional", "Friendly", "Dramatic", "Calm", "Energetic"],
        "values": ["professional", "friendly", "dramatic", "calm", "energetic"],
    },
}

# Detailed questionnaire adds these
DETAILED_QUESTIONNAIRE_EXTRA = {
    "emotion": {
        "question": "What emotional quality?",
        "options": ["Neutral", "Happy", "Serious", "Excited", "Contemplative"],
        "values": ["neutral", "happy", "serious", "excited", "contemplative"],
    },
    "pacing": {
        "question": "What pacing?",
        "options": ["Slow", "Measured", "Natural", "Fast"],
        "values": ["slow", "measured", "natural", "fast"],
    },
    "audio_quality": {
        "question": "What audio quality style?",
        "options": ["Clean studio", "Warm vintage", "Podcast natural"],
        "values": ["clean studio", "warm vintage", "podcast natural"],
    },
    "special": {
        "question": "Any special vocal quality?",
        "options": ["None", "Gravelly", "Breathy", "Resonant", "Crisp"],
        "values": [None, "gravelly", "breathy", "resonant", "crisp"],
    },
}

# Conversational character questionnaire
CONVERSATIONAL_QUESTIONNAIRE = {
    "gender": {
        "question": "What gender is the character?",
        "options": ["Male", "Female"],
        "values": ["male", "female"],
    },
    "age": {
        "question": "What age range?",
        "options": ["Early 20s", "Late 20s", "Early 30s", "Late 30s", "40s+"],
        "values": ["early 20s", "late 20s", "early 30s", "late 30s", "40s"],
    },
    "accent": {
        "question": "What accent?",
        "options": ["American", "British", "Australian", "Indian", "Creole", "Neutral"],
        "values": ["american", "british", "australian", "indian", "creole", "neutral"],
    },
    "primary_emotion": {
        "question": "What is the character's PRIMARY emotional state?",
        "options": ["Frustrated/Angry", "Desperate/Hopeless", "Fearful/Anxious", "Hopeful/Determined", "Weary/Tired", "Sarcastic/Dry"],
        "values": ["frustrated", "desperate", "fearful", "hopeful", "weary", "sarcastic"],
    },
    "personality": {
        "question": "Describe the character's personality traits (comma-separated):",
        "options": None,  # Free text input
        "values": None,
        "free_text": True,
        "examples": "strict, tense, weary, slightly annoyed",
    },
}

# Emotion palettes for V3 tagging
EMOTION_PALETTES = {
    "frustrated": ["frustrated", "tired", "quiet", "annoyed", "weary", "angry", "irritation", "exasperated"],
    "desperate": ["exhausted", "desperate", "whiny", "defeated", "hopeless", "shaky", "crying", "breathing"],
    "fearful": ["uneasy", "fear", "anxious", "nervous", "shaky", "panicked", "voice cracks", "whisper"],
    "hopeful": ["hopeful", "warm", "gentle", "determined", "vulnerable", "encouraging", "brighter"],
    "weary": ["tired", "weary", "sad", "resigned", "contemplative", "exhausted", "sigh"],
    "sarcastic": ["sarcastic", "dry", "amused", "dismissive", "ironic", "deadpan", "flat"],
    "angry": ["angry", "furious", "intense", "sharp", "bitter", "seething", "shouting"],
    "resolute": ["firm", "resolute", "determined", "confident", "steady", "commanding", "measured"],
}

# Delivery tags for pacing/volume control
DELIVERY_TAGS = ["pause", "quicker", "slower", "whisper", "shouting", "breathing",
                 "voice cracks", "lower", "measured", "clipped", "soft", "emphasis"]


def build_conversational_description(
    gender: str,
    age: str,
    accent: str,
    primary_emotion: str,
    personality: str | None = None,
) -> str:
    """Build a conversational character voice description.

    Automatically appends "Natural conversational dialogue." to avoid
    the "announcer" read style.

    Args:
        gender: "male" or "female"
        age: Age range like "late 20s", "early 30s"
        accent: Accent type
        primary_emotion: Primary emotional state
        personality: Comma-separated personality traits

    Returns:
        Formatted voice description for ElevenLabs Voice Design API
    """
    # Build base description
    parts = [f"{gender.capitalize()} voice, {age}."]

    # Add accent
    if accent and accent != "neutral":
        parts.append(f"{accent.capitalize()} accent.")

    # Add emotional quality based on primary emotion
    emotion_descriptions = {
        "frustrated": "Voice is frustrated, tired, and tense. Speech has quiet intensity with occasional sharp edges.",
        "desperate": "Voice is desperate and defeated. Speech shifts between hopeless resignation and faint hope.",
        "fearful": "Voice conveys underlying anxiety and unease. Speech is hesitant with occasional tremors.",
        "hopeful": "Voice carries warmth and underlying optimism. Speech balances vulnerability with quiet determination.",
        "weary": "Voice carries the weight of exhaustion. Speech is slower, more deliberate, with sighs and pauses.",
        "sarcastic": "Voice drips with dry wit and sardonic undertones. Speech has perfectly timed pauses for effect.",
        "angry": "Voice burns with controlled fury. Speech alternates between tight delivery and passionate outbursts.",
        "resolute": "Voice is firm and decisive. Speech is measured and deliberate, conveying quiet authority.",
    }
    if primary_emotion in emotion_descriptions:
        parts.append(emotion_descriptions[primary_emotion])

    # Add personality traits if provided
    if personality:
        traits = [t.strip() for t in personality.split(",")]
        if traits:
            parts.append(f"The character is {', '.join(traits)}.")

    # Always end with this to avoid announcer style
    parts.append("Natural conversational dialogue.")

    return " ".join(parts)


def get_emotion_palette(emotion: str) -> list[str]:
    """Get suggested emotion tags for a primary emotion.

    Args:
        emotion: Primary emotion like "frustrated", "desperate"

    Returns:
        List of emotion tag strings for V3 bracketed tags
    """
    return EMOTION_PALETTES.get(emotion, [])


def list_conversational_presets() -> dict[str, str]:
    """List only conversational character presets.

    Returns:
        Dict mapping preset name to best_for description
    """
    return {
        name: preset.get("best_for", "Dialogue")
        for name, preset in CONVERSATIONAL_PRESETS.items()
    }


def is_conversational_preset(name: str) -> bool:
    """Check if a preset is a conversational character preset.

    Args:
        name: Preset name

    Returns:
        True if preset has conversational=True
    """
    preset = get_preset(name)
    return preset.get("conversational", False) if preset else False


if __name__ == "__main__":
    # CLI for listing presets
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        print("\n  VOICE DESIGN PRESETS\n")
        print("  " + "=" * 70)
        for name, best_for in list_presets().items():
            print(f"\n  {name}")
            print(f"    Best for: {best_for}")
            preset = get_preset(name)
            if preset:
                print(f"    Gender: {preset.get('gender')}, Age: {preset.get('age')}, "
                      f"Accent: {preset.get('accent')}")
        print("\n")
    else:
        print("Usage: python voice_presets.py --list")
