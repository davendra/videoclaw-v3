#!/usr/bin/env python3
"""
Style Bible — consistent visual identity for film productions.

A style bible captures the visual language for a project: color palette,
lighting defaults, composition rules, texture notes, and an optional
director reference.  It is auto-generated from a genre preset and can be
saved/loaded as JSON for reuse across pipeline phases.

Usage:
    from style_bible import create_style_bible, save_style_bible, load_style_bible

    bible = create_style_bible("thriller", director_ref="Fincher")
    save_style_bible(bible, "projects/test/style_bible.json")

CLI:
    python style_bible.py --genre drama
    python style_bible.py --genre thriller --director "Denis Villeneuve"
    python style_bible.py --load projects/test/style_bible.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import GENRE_PRESETS


# ============================================================================
# Data Classes
# ============================================================================


@dataclass
class StyleBible:
    """Visual identity document for a film production."""

    style_tag: str
    color_palette: str
    lighting_default: str
    composition: str
    texture: str
    director_reference: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> StyleBible:
        return cls(
            style_tag=data.get("style_tag", ""),
            color_palette=data.get("color_palette", ""),
            lighting_default=data.get("lighting_default", ""),
            composition=data.get("composition", ""),
            texture=data.get("texture", ""),
            director_reference=data.get("director_reference", ""),
        )


# ============================================================================
# Built-in Style Bibles (one per genre)
# ============================================================================

_BUILTIN_BIBLES: dict[str, dict] = {
    "drama": {
        "style_tag": "cinematic drama, naturalistic color palette",
        "color_palette": "earth tones, desaturated blues, warm highlights with cool shadows",
        "lighting_default": "natural motivated lighting, low-key for emotional beats",
        "composition": "steady deliberate framing, long takes, rule of thirds",
        "texture": "subtle film grain, shallow depth of field",
    },
    "thriller": {
        "style_tag": "taut thriller, desaturated teal grade",
        "color_palette": "cool blues, greens, high contrast, blue-teal shadows",
        "lighting_default": "low-key harsh shadows, single motivated source",
        "composition": "tight framing, dutch angles for unease, negative space",
        "texture": "sharp detail, crushed blacks, minimal grain",
    },
    "comedy": {
        "style_tag": "bright comedy, warm saturated palette",
        "color_palette": "bright warm saturated colors, high-key",
        "lighting_default": "high-key even bright lighting",
        "composition": "clean simple framing, static or gentle pans",
        "texture": "clean digital look, vivid colors",
    },
    "sci-fi": {
        "style_tag": "futuristic sci-fi, cool teal-purple grade",
        "color_palette": "teals, blues, purples, chrome accents",
        "lighting_default": "practical neon, volumetric haze, rim lighting",
        "composition": "wide establishing shots, smooth tracking, layered depth",
        "texture": "sharp clean detail, lens flares, volumetric light",
    },
    "horror": {
        "style_tag": "atmospheric horror, desaturated green-red grade",
        "color_palette": "muted greens, deep reds, blacks, crushed shadows",
        "lighting_default": "extreme low-key, single source, deep shadows",
        "composition": "slow tracking, POV shots, dutch angles, negative space",
        "texture": "heavy grain, soft focus edges, vignette",
    },
    "romance": {
        "style_tag": "soft romance, warm golden palette",
        "color_palette": "warm golds, soft pinks, creams, gentle highlights",
        "lighting_default": "golden hour, soft diffused backlight",
        "composition": "smooth dollies, slow pans, shallow DOF, intimate framing",
        "texture": "soft glow, dreamy bokeh, gentle halation",
    },
    "action": {
        "style_tag": "high-energy action, orange-teal grade",
        "color_palette": "high contrast, oranges and teals, crushed blacks",
        "lighting_default": "dynamic practical lighting, rim lighting, explosions",
        "composition": "handheld, fast tracking, dynamic angles, tight on action",
        "texture": "sharp detail, pumped contrast, impact frames",
    },
}


# ============================================================================
# Public API
# ============================================================================


def create_style_bible(genre: str, director_ref: str | None = None) -> StyleBible:
    """Create a style bible from a genre preset.

    Falls back to 'drama' if the genre is not recognized.
    """
    genre_key = genre.lower().replace("-", "_").replace(" ", "_")
    base = _BUILTIN_BIBLES.get(genre_key, _BUILTIN_BIBLES["drama"])
    return StyleBible(
        style_tag=base["style_tag"],
        color_palette=base["color_palette"],
        lighting_default=base["lighting_default"],
        composition=base["composition"],
        texture=base["texture"],
        director_reference=director_ref or "",
    )


def save_style_bible(bible: StyleBible, path: str) -> None:
    """Save a style bible to JSON."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(bible.to_dict(), f, indent=2)


def load_style_bible(path: str) -> StyleBible:
    """Load a style bible from JSON."""
    with open(path) as f:
        return StyleBible.from_dict(json.load(f))


# ============================================================================
# CLI
# ============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(description="Style Bible — visual identity for film productions")
    parser.add_argument("--genre", help="Genre to create style bible from")
    parser.add_argument("--director", help="Director reference (e.g., 'Fincher', 'Villeneuve')")
    parser.add_argument("--load", help="Load and display an existing style bible JSON")
    parser.add_argument("--save", help="Save output to JSON file")
    args = parser.parse_args()

    if args.load:
        bible = load_style_bible(args.load)
    elif args.genre:
        bible = create_style_bible(args.genre, director_ref=args.director)
    else:
        parser.error("Provide --genre or --load")
        return

    print(json.dumps(bible.to_dict(), indent=2))

    if args.save:
        save_style_bible(bible, args.save)
        print(f"\nSaved to {args.save}")


if __name__ == "__main__":
    main()
