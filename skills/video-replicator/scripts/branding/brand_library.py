#!/usr/bin/env python3
"""
Brand Library Management.

Manages the global brand library at ~/.video-replicator/brands/
Provides functions for listing, loading, saving, and deleting brands.
"""

import os
import shutil
from pathlib import Path

from .brand_config import BrandConfig, load_brand_config, save_brand_config


def get_brand_library_path() -> Path:
    """
    Get the path to the global brand library.

    Returns:
        Path to ~/.video-replicator/brands/
    """
    return Path.home() / ".video-replicator" / "brands"


def get_brand_dir(name: str) -> Path:
    """
    Get the directory path for a specific brand.

    Args:
        name: Brand name (slug)

    Returns:
        Path to ~/.video-replicator/brands/{name}/
    """
    # Sanitize name for filesystem
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name.lower())
    return get_brand_library_path() / safe_name


def brand_exists(name: str) -> bool:
    """
    Check if a brand exists in the library.

    Args:
        name: Brand name to check

    Returns:
        True if brand exists, False otherwise
    """
    brand_dir = get_brand_dir(name)
    config_path = brand_dir / "brand_config.json"
    return config_path.exists()


def list_brands() -> list[str]:
    """
    List all brands in the library.

    Returns:
        List of brand names (directory names)
    """
    library_path = get_brand_library_path()
    if not library_path.exists():
        return []

    brands = []
    for item in library_path.iterdir():
        if item.is_dir():
            config_path = item / "brand_config.json"
            if config_path.exists():
                brands.append(item.name)

    return sorted(brands)


def load_brand(name: str) -> BrandConfig | None:
    """
    Load a brand from the library.

    Args:
        name: Brand name to load

    Returns:
        BrandConfig if found, None otherwise
    """
    brand_dir = get_brand_dir(name)
    config_path = brand_dir / "brand_config.json"

    if not config_path.exists():
        return None

    return load_brand_config(str(config_path))


def save_brand(config: BrandConfig, name: str | None = None) -> Path:
    """
    Save a brand to the library.

    Args:
        config: BrandConfig to save
        name: Optional name override (defaults to config.brand_name)

    Returns:
        Path to the brand directory
    """
    brand_name = name or config.brand_name
    brand_dir = get_brand_dir(brand_name)

    # Create brand directory
    brand_dir.mkdir(parents=True, exist_ok=True)

    # Save config
    config_path = brand_dir / "brand_config.json"
    save_brand_config(config, str(config_path))

    return brand_dir


def delete_brand(name: str) -> bool:
    """
    Delete a brand from the library.

    Args:
        name: Brand name to delete

    Returns:
        True if deleted, False if not found
    """
    brand_dir = get_brand_dir(name)

    if not brand_dir.exists():
        return False

    shutil.rmtree(brand_dir)
    return True


def copy_logo_to_brand(source_path: str, brand_name: str, logo_type: str) -> str:
    """
    Copy a logo file to the brand directory.

    Args:
        source_path: Path to source logo file
        brand_name: Brand name
        logo_type: One of "full", "horizontal", "icon", "white"

    Returns:
        Relative path to logo within brand directory (e.g., "logo_full.png")
    """
    brand_dir = get_brand_dir(brand_name)
    brand_dir.mkdir(parents=True, exist_ok=True)

    # Determine destination filename
    ext = os.path.splitext(source_path)[1] or ".png"
    dest_filename = f"logo_{logo_type}{ext}"
    dest_path = brand_dir / dest_filename

    # Copy file
    shutil.copy2(source_path, dest_path)

    return dest_filename


def get_brand_logo_path(brand_name: str, logo_type: str) -> str | None:
    """
    Get the absolute path to a brand's logo file.

    Args:
        brand_name: Brand name
        logo_type: One of "full", "horizontal", "icon", "white"

    Returns:
        Absolute path to logo file, or None if not found
    """
    config = load_brand(brand_name)
    if not config:
        return None

    brand_dir = get_brand_dir(brand_name)
    return config.get_logo_for_context(logo_type, str(brand_dir))


def print_brand_summary(config: BrandConfig) -> None:
    """Print a summary of a brand configuration."""
    print(f"┌{'─' * 50}┐")
    print(f"│ Brand: {config.brand_name:<42}│")
    print(f"├{'─' * 50}┤")

    if config.logos.full:
        print(f"│ Logo (full):       {config.logos.full:<30}│")
    if config.logos.horizontal:
        print(f"│ Logo (horizontal): {config.logos.horizontal:<30}│")
    if config.logos.icon:
        print(f"│ Logo (icon):       {config.logos.icon:<30}│")

    if config.contact.phone:
        print(f"│ Phone:             {config.contact.phone:<30}│")
    if config.contact.website:
        print(f"│ Website:           {config.contact.website:<30}│")

    if config.colors.primary:
        print(f"│ Primary color:     {config.colors.primary:<30}│")

    if config.animation.preferred_preset:
        print(f"│ Animation preset:  {config.animation.preferred_preset:<30}│")
    if config.animation.cached_intro:
        print(f"│ Cached intro:      {config.animation.cached_intro:<30}│")

    print(f"└{'─' * 50}┘")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python brand_library.py <command> [args]")
        print("Commands: list, show <name>, delete <name>")
        sys.exit(1)

    command = sys.argv[1]

    if command == "list":
        brands = list_brands()
        if brands:
            print("Saved brands:")
            for brand in brands:
                print(f"  - {brand}")
        else:
            print("No brands saved yet.")

    elif command == "show" and len(sys.argv) > 2:
        name = sys.argv[2]
        config = load_brand(name)
        if config:
            print_brand_summary(config)
        else:
            print(f"Brand '{name}' not found.")

    elif command == "delete" and len(sys.argv) > 2:
        name = sys.argv[2]
        if delete_brand(name):
            print(f"Deleted brand '{name}'.")
        else:
            print(f"Brand '{name}' not found.")

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
