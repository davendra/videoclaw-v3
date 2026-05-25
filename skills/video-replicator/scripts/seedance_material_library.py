#!/usr/bin/env python3
"""
Material descriptions library for Seedance prompt enhancement.

Provides detailed material/texture descriptions organized by category.
When a prompt mentions a material (e.g., "metal", "glass", "fabric"),
the library provides physics-accurate descriptions that Seedance renders well.

Usage:
    from seedance_material_library import get_material, get_materials_for_genre, suggest_materials

    metal = get_material("brushed-aluminum")
    # -> "Brushed aluminum with subtle anisotropic scratches and warm oxide patina"

    materials = get_materials_for_genre("3d-product")
    # -> list of material dicts relevant to 3D product shots
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass
class Material:
    """A material description with rendering hints."""
    name: str
    key: str
    description: str
    category: str
    genres: list[str]


MATERIALS: list[Material] = [
    # ─── METALS ───
    Material("Brushed Aluminum", "brushed-aluminum",
             "Brushed aluminum with subtle anisotropic scratches and warm oxide patina, soft directional highlights",
             "metal", ["3d", "product", "tech"]),
    Material("Polished Chrome", "polished-chrome",
             "Mirror-polished chrome with razor-sharp reflections, zero diffuse, pure specular environment mapping",
             "metal", ["3d", "product", "automotive", "fashion"]),
    Material("Aged Copper", "aged-copper",
             "Weathered copper with green verdigris patina, warm orange base peeking through oxidation",
             "metal", ["cinematic", "fantasy", "period"]),
    Material("Matte Black Metal", "matte-black-metal",
             "Matte black anodized metal, zero reflections, absorbs light, tactile micro-texture",
             "metal", ["tech", "product", "fashion"]),
    Material("Hammered Gold", "hammered-gold",
             "Hand-hammered gold with irregular dimples catching light at different angles, warm rich lustre",
             "metal", ["fantasy", "jewelry", "period"]),
    Material("Rusted Iron", "rusted-iron",
             "Heavily rusted iron with flaking orange-brown oxidation, rough pitted surface, industrial decay",
             "metal", ["horror", "post-apocalyptic", "industrial"]),
    Material("Stainless Steel", "stainless-steel",
             "Satin-finish stainless steel with soft blurred reflections, fingerprint-free, clinical precision",
             "metal", ["product", "kitchen", "medical", "tech"]),
    Material("Rose Gold", "rose-gold",
             "Warm rose gold with pink-copper hue, soft feminine shimmer, luxury finish",
             "metal", ["fashion", "beauty", "jewelry", "lifestyle"]),

    # ─── GLASS & CRYSTAL ───
    Material("Frosted Glass", "frosted-glass",
             "Frosted glass with soft light diffusion, translucent milky white, blurred shapes visible through",
             "glass", ["product", "architecture", "minimal"]),
    Material("Crystal Clear", "crystal-clear",
             "Optically perfect crystal with rainbow caustic refractions, prismatic light dispersion",
             "glass", ["product", "luxury", "3d"]),
    Material("Stained Glass", "stained-glass",
             "Medieval stained glass with rich jewel-toned colors, black lead lines, backlit radiance",
             "glass", ["fantasy", "period", "architecture"]),
    Material("Wet Glass", "wet-glass",
             "Rain-streaked glass with water droplets refracting background into bokeh points, condensation fog",
             "glass", ["cinematic", "drama", "thriller"]),
    Material("Shattered Glass", "shattered-glass",
             "Explosively shattered glass mid-air, razor fragments catching light like diamonds, dynamic debris",
             "glass", ["action", "thriller", "vfx"]),

    # ─── FABRICS & TEXTILES ───
    Material("Raw Denim", "raw-denim",
             "Unwashed indigo denim with visible warp and weft texture, stiff selvage edge, authentic wear patterns",
             "fabric", ["fashion", "ugc", "lifestyle"]),
    Material("Silk Satin", "silk-satin",
             "Liquid silk satin with flowing drape, high specular sheen, light pooling in folds",
             "fabric", ["fashion", "luxury", "beauty"]),
    Material("Worn Leather", "worn-leather",
             "Aged saddle leather with rich patina, deep creases, warm brown tones, hand-oiled surface",
             "fabric", ["cinematic", "western", "fashion"]),
    Material("Cashmere Knit", "cashmere-knit",
             "Ultra-soft cashmere knit with fine visible stitches, gentle fuzz halo in backlight, cozy warmth",
             "fabric", ["lifestyle", "fashion", "winter"]),
    Material("Velvet", "velvet",
             "Deep velvet with rich pile that shifts color with viewing angle, luxurious light absorption",
             "fabric", ["fashion", "drama", "gothic"]),
    Material("Linen Natural", "linen-natural",
             "Natural linen with visible flax fibers, relaxed wrinkles, sun-bleached warmth, organic texture",
             "fabric", ["lifestyle", "food", "summer"]),
    Material("Tattered Cloth", "tattered-cloth",
             "Frayed and torn cloth with hanging threads, worn thin patches, distressed aged appearance",
             "fabric", ["horror", "post-apocalyptic", "fantasy"]),

    # ─── ORGANIC & NATURAL ───
    Material("Wet Skin", "wet-skin",
             "Rain-wet human skin with water beading on surface, subsurface scattering glow, translucent pores",
             "organic", ["cinematic", "drama", "beauty"]),
    Material("Bark Texture", "bark-texture",
             "Ancient tree bark with deep furrowed cracks, moss in crevices, lichen patches, forest age",
             "organic", ["nature", "fantasy", "environmental"]),
    Material("Fresh Leaves", "fresh-leaves",
             "Translucent green leaves with visible vein networks, dewdrops, subsurface light scattering",
             "organic", ["nature", "food", "environmental"]),
    Material("Coral Reef", "coral-reef",
             "Living coral with intricate calcium carbonate structure, vibrant pinks and oranges, tiny polyps",
             "organic", ["nature", "underwater", "documentary"]),
    Material("Ice Crystal", "ice-crystal",
             "Macro ice crystal formation with hexagonal geometry, internal light refraction, frost bloom edges",
             "organic", ["nature", "winter", "fantasy"]),
    Material("Volcanic Rock", "volcanic-rock",
             "Black volcanic basalt with glassy obsidian patches, tiny gas bubble holes, sharp crystalline edges",
             "organic", ["cinematic", "fantasy", "nature"]),

    # ─── FOOD & LIQUID ───
    Material("Molten Chocolate", "molten-chocolate",
             "Thick molten dark chocolate with glossy flowing surface, rich brown ripples, steam wisps",
             "food", ["food", "product", "commercial"]),
    Material("Champagne Bubbles", "champagne-bubbles",
             "Golden champagne with streams of tiny rising bubbles, light refracting through fizz, celebration",
             "food", ["food", "luxury", "celebration"]),
    Material("Honey Drip", "honey-drip",
             "Thick golden honey in slow viscous drip, warm amber translucency, catching sunlight",
             "food", ["food", "nature", "product"]),

    # ─── SYNTHETIC & TECH ───
    Material("Carbon Fiber", "carbon-fiber",
             "Woven carbon fiber with distinctive 2x2 twill pattern, deep black with subtle blue sheen",
             "tech", ["tech", "automotive", "product"]),
    Material("Holographic Film", "holographic-film",
             "Holographic iridescent film shifting rainbow colors with viewing angle, futuristic shimmer",
             "tech", ["fashion", "music-video", "cyberpunk"]),
    Material("LED Matrix", "led-matrix",
             "Dense LED pixel matrix glowing with digital patterns, visible individual diodes, tech grid",
             "tech", ["tech", "cyberpunk", "music-video"]),
    Material("Translucent Plastic", "translucent-plastic",
             "Semi-transparent colored plastic with soft light diffusion, candy-like quality, playful",
             "tech", ["product", "toy", "pop"]),
    Material("Concrete Raw", "concrete-raw",
             "Raw poured concrete with form marks, aggregate visible, industrial brutalist texture",
             "architecture", ["architecture", "industrial", "minimal"]),

    # ─── PARTICLE & ATMOSPHERIC ───
    Material("Dust Motes", "dust-motes",
             "Floating dust particles catching beam of light, golden sparkles in dark space, atmospheric",
             "atmospheric", ["cinematic", "drama", "documentary"]),
    Material("Smoke Wisps", "smoke-wisps",
             "Delicate smoke tendrils curling upward, volumetric light scattering through haze, ethereal",
             "atmospheric", ["cinematic", "drama", "mystery"]),
    Material("Sparks", "sparks",
             "Hot metal sparks flying in parabolic arcs, bright orange-white points trailing dark smoke",
             "atmospheric", ["action", "industrial", "blacksmith"]),
    Material("Water Splash", "water-splash",
             "High-speed water splash frozen mid-air, crystal droplets, crown formation, dynamic liquid",
             "atmospheric", ["product", "sports", "nature"]),
]


def get_material(key: str) -> Material | None:
    """Get a material by key (case-insensitive)."""
    lower = key.lower()
    for m in MATERIALS:
        if m.key == lower:
            return m
    return None


def get_materials_for_genre(genre: str) -> list[Material]:
    """Get all materials relevant to a genre."""
    lower = genre.lower()
    return [m for m in MATERIALS if lower in m.genres]


def get_materials_by_category(category: str) -> list[Material]:
    """Get all materials in a category (metal, glass, fabric, organic, food, tech, atmospheric)."""
    lower = category.lower()
    return [m for m in MATERIALS if m.category == lower]


def suggest_materials(prompt: str) -> list[Material]:
    """Suggest materials based on keywords found in a prompt."""
    lower = prompt.lower()
    suggestions = []
    keywords = {
        "metal": ["metal", "steel", "iron", "gold", "silver", "chrome", "aluminum", "copper"],
        "glass": ["glass", "crystal", "window", "mirror", "transparent"],
        "fabric": ["dress", "cloth", "fabric", "silk", "leather", "denim", "velvet", "linen"],
        "organic": ["tree", "bark", "leaf", "coral", "ice", "rock", "stone"],
        "food": ["chocolate", "champagne", "wine", "honey", "coffee", "food"],
        "tech": ["carbon", "led", "holograph", "plastic", "concrete"],
        "atmospheric": ["dust", "smoke", "spark", "splash", "rain", "fog", "mist"],
    }
    for category, terms in keywords.items():
        if any(term in lower for term in terms):
            suggestions.extend(get_materials_by_category(category)[:3])
    return suggestions


def list_categories() -> list[str]:
    """Return all material categories."""
    return sorted(set(m.category for m in MATERIALS))
