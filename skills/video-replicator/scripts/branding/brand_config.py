#!/usr/bin/env python3
"""
Brand Configuration Module.

Defines the BrandConfig class and utilities for loading/saving brand configurations.
Brand configs store all brand assets: logos, colors, contact info, typography, and animation preferences.
"""

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class LogoConfig:
    """Logo file paths (relative to brand directory)."""
    full: str | None = None
    horizontal: str | None = None
    icon: str | None = None
    white: str | None = None


@dataclass
class ContactConfig:
    """Contact information for CTA banners."""
    phone: str | None = None
    website: str | None = None
    email: str | None = None


@dataclass
class ColorsConfig:
    """Brand color palette."""
    primary: str | None = None
    secondary: str | None = None
    accent: str | None = None
    background: str | None = None
    text: str | None = None


@dataclass
class TypographyConfig:
    """Font preferences."""
    heading: str | None = None
    body: str | None = None


@dataclass
class SocialConfig:
    """Social media handles."""
    instagram: str | None = None
    facebook: str | None = None
    youtube: str | None = None
    tiktok: str | None = None
    twitter: str | None = None


@dataclass
class AnimationConfig:
    """Logo animation preferences."""
    preferred_preset: str | None = None
    preferred_background: str = "auto"
    hold_end: float = 2.0
    cached_intro: str | None = None
    cached_outro: str | None = None


@dataclass
class VariantInfo:
    """How a logo variant was generated."""
    method: str  # "go_bananas", "auto_crop", "manual"
    prompt: str | None = None
    bounds: list[int] | None = None


@dataclass
class BrandConfig:
    """
    Complete brand configuration.

    Stores all brand assets and settings needed for video generation:
    - Logos in multiple formats (full, horizontal, icon, white)
    - Contact information (phone, website, email)
    - Color palette
    - Typography preferences
    - Social media handles
    - Animation preferences
    """
    brand_name: str
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    source_url: str | None = None

    logos: LogoConfig = field(default_factory=LogoConfig)
    contact: ContactConfig = field(default_factory=ContactConfig)
    colors: ColorsConfig = field(default_factory=ColorsConfig)
    typography: TypographyConfig = field(default_factory=TypographyConfig)
    social: SocialConfig = field(default_factory=SocialConfig)
    animation: AnimationConfig = field(default_factory=AnimationConfig)

    variants_generated: dict[str, VariantInfo] = field(default_factory=dict)

    def get_logo_for_context(self, context: str, brand_dir: str | None = None) -> str | None:
        """
        Get the appropriate logo variant for a given context.

        Args:
            context: One of "intro", "banner", "watermark", "full"
            brand_dir: Base directory for resolving relative paths

        Returns:
            Absolute path to logo file, or None if not available
        """
        logo_map = {
            "intro": self.logos.full or self.logos.horizontal,
            "banner": self.logos.horizontal or self.logos.full,
            "watermark": self.logos.icon or self.logos.horizontal or self.logos.full,
            "full": self.logos.full,
            "horizontal": self.logos.horizontal,
            "icon": self.logos.icon,
            "white": self.logos.white,
        }

        logo_path = logo_map.get(context)
        if logo_path and brand_dir:
            return os.path.join(brand_dir, logo_path)
        return logo_path

    def get_theme_from_colors(self) -> str:
        """
        Determine banner theme (light/dark) from brand colors.

        Returns:
            "light" if primary color is dark (needs light banner)
            "dark" if primary color is light (needs dark banner)
        """
        if not self.colors.primary:
            return "light"

        # Parse hex color
        hex_color = self.colors.primary.lstrip("#")
        if len(hex_color) != 6:
            return "light"

        try:
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)

            # Calculate luminance
            luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

            # Dark primary = light banner, Light primary = dark banner
            return "light" if luminance < 0.5 else "dark"
        except ValueError:
            return "light"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result = {
            "brand_name": self.brand_name,
            "created_at": self.created_at,
            "source_url": self.source_url,
            "logos": asdict(self.logos),
            "contact": asdict(self.contact),
            "colors": asdict(self.colors),
            "typography": asdict(self.typography),
            "social": asdict(self.social),
            "animation": asdict(self.animation),
            "variants_generated": {
                k: asdict(v) if isinstance(v, VariantInfo) else v
                for k, v in self.variants_generated.items()
            },
        }
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BrandConfig":
        """Create BrandConfig from dictionary."""
        return cls(
            brand_name=data.get("brand_name", "Unknown"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            source_url=data.get("source_url"),
            logos=LogoConfig(**data.get("logos", {})),
            contact=ContactConfig(**data.get("contact", {})),
            colors=ColorsConfig(**data.get("colors", {})),
            typography=TypographyConfig(**data.get("typography", {})),
            social=SocialConfig(**data.get("social", {})),
            animation=AnimationConfig(**data.get("animation", {})),
            variants_generated={
                k: VariantInfo(**v) if isinstance(v, dict) else v
                for k, v in data.get("variants_generated", {}).items()
            },
        )


def load_brand_config(path: str) -> BrandConfig:
    """
    Load brand configuration from JSON file.

    Args:
        path: Path to brand_config.json file

    Returns:
        BrandConfig instance

    Raises:
        FileNotFoundError: If config file doesn't exist
        json.JSONDecodeError: If config file is invalid JSON
    """
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return BrandConfig.from_dict(data)


def save_brand_config(config: BrandConfig, path: str) -> None:
    """
    Save brand configuration to JSON file.

    Args:
        config: BrandConfig instance to save
        path: Path to save brand_config.json
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config.to_dict(), f, indent=2)


if __name__ == "__main__":
    # Example usage
    config = BrandConfig(
        brand_name="Handyside",
        source_url="https://handyside.com",
    )
    config.logos.full = "logo_full.png"
    config.logos.horizontal = "logo_horizontal.png"
    config.contact.phone = "717-607-1200"
    config.contact.website = "https://handyside.com"
    config.colors.primary = "#1a365d"
    config.colors.background = "#ffffff"

    print(f"Brand: {config.brand_name}")
    print(f"Theme from colors: {config.get_theme_from_colors()}")
    print(f"Logo for banner: {config.get_logo_for_context('banner')}")
    print(f"\nJSON:\n{json.dumps(config.to_dict(), indent=2)}")
