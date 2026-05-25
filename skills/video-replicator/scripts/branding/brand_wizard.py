#!/usr/bin/env python3
"""
Brand Setup Wizard.

Interactive CLI for setting up and managing brand configurations.
Handles brand discovery, website extraction, logo setup, and animation preferences.
"""

import argparse
import sys
import urllib.request
from pathlib import Path

from .brand_config import BrandConfig
from .brand_extractor import (
    display_extraction_confirmation,
    extract_brand_from_url,
)
from .brand_library import (
    brand_exists,
    get_brand_dir,
    list_brands,
    load_brand,
    save_brand,
)

# Logo animation presets (from generate_logo_animation.py)
LOGO_ANIMATION_PRESETS = [
    ("liquid-chrome", "Liquid chrome morphing effect"),
    ("particle-assemble", "Particles assembling into logo"),
    ("sketch-to-life", "Hand-drawn sketch fills in with color"),
    ("neon-powerup", "Neon tubes power up and illuminate"),
    ("organic-growth", "Nature/vines grow into logo shape"),
    ("ink-drop", "Ink droplets spread and form logo"),
    ("fabric-weave", "Threads weave together"),
    ("glitch-decode", "Digital glitch reveals logo"),
    ("custom", "Custom animation prompt"),
]


def print_header(title: str) -> None:
    """Print a formatted header."""
    width = 55
    print(f"┌{'─' * width}┐")
    print(f"│  {title:<{width-3}}│")
    print(f"└{'─' * width}┘")


def print_menu(options: list[tuple[str, str]], title: str = "") -> None:
    """Print a numbered menu."""
    if title:
        print(f"\n  {title}")
    print()
    for i, (key, desc) in enumerate(options, 1):
        print(f"  [{i}] {key:<20} - {desc}")
    print()


def get_choice(prompt: str, max_choice: int, default: int = 1) -> int:
    """Get a numbered choice from user."""
    while True:
        try:
            response = input(f"{prompt} [{default}]: ").strip()
            if not response:
                return default
            choice = int(response)
            if 1 <= choice <= max_choice:
                return choice
            print(f"  Please enter a number between 1 and {max_choice}")
        except ValueError:
            print("  Please enter a valid number")


def get_yes_no(prompt: str, default: bool = True) -> bool:
    """Get a yes/no response from user."""
    default_str = "Y/n" if default else "y/N"
    while True:
        response = input(f"{prompt} [{default_str}]: ").strip().lower()
        if not response:
            return default
        if response in ("y", "yes"):
            return True
        if response in ("n", "no"):
            return False
        print("  Please enter 'y' or 'n'")


def prompt_brand_selection() -> str | None:
    """
    Prompt user to select from existing brands.

    Returns:
        Brand name if selected, None if user wants to create new
    """
    brands = list_brands()
    if not brands:
        return None

    print("\n  Found existing brands:")
    for i, brand in enumerate(brands, 1):
        print(f"  [{i}] {brand}")
    print("  [0] Create new brand")
    print()

    choice = get_choice("Select brand", len(brands))
    if choice == 0:
        return None
    return brands[choice - 1]


def prompt_for_website() -> str | None:
    """Prompt user for website URL."""
    print("\n  Enter the brand's website URL (or press Enter to skip):")
    url = input("  URL: ").strip()
    if not url:
        return None
    # Add https if missing
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    return url


def prompt_for_brand_name(default: str = "") -> str:
    """Prompt user for brand name."""
    while True:
        prompt = f"  Brand name [{default}]: " if default else "  Brand name: "
        name = input(prompt).strip()
        if not name and default:
            return default
        if name:
            return name
        print("  Brand name is required")


def prompt_logo_animation_preferences(config: BrandConfig) -> BrandConfig:
    """
    Prompt user for logo animation preferences.

    Args:
        config: BrandConfig to update

    Returns:
        Updated BrandConfig with animation preferences
    """
    print_header("LOGO ANIMATION PREFERENCES")

    # Check if any logo exists
    has_logo = config.logos.full or config.logos.horizontal or config.logos.icon
    if not has_logo:
        print("\n  No logo configured. Animation preferences will be saved for later.")
        print("  You can add a logo with: --logo <path>")

    # Animation preset selection
    print_menu(LOGO_ANIMATION_PRESETS, "Choose animation style:")
    choice = get_choice("Animation style", len(LOGO_ANIMATION_PRESETS))
    preset_id, _ = LOGO_ANIMATION_PRESETS[choice - 1]
    config.animation.preferred_preset = preset_id

    # Background preference
    print("\n  Background color for logo animation:")
    print("  [1] auto    - Detect from logo (transparent → black, solid → contrast)")
    print("  [2] black   - Always use black background")
    print("  [3] white   - Always use white background")
    print("  [4] custom  - Specify hex color")
    print()
    bg_choice = get_choice("Background", 4, 1)
    if bg_choice == 1:
        config.animation.preferred_background = "auto"
    elif bg_choice == 2:
        config.animation.preferred_background = "#000000"
    elif bg_choice == 3:
        config.animation.preferred_background = "#FFFFFF"
    else:
        hex_color = input("  Enter hex color (e.g., #1a365d): ").strip()
        if hex_color.startswith("#") and len(hex_color) == 7:
            config.animation.preferred_background = hex_color
        else:
            print("  Invalid hex color, using auto")
            config.animation.preferred_background = "auto"

    # Hold-end duration
    print("\n  Freeze final frame duration (seconds to hold logo at end):")
    print("  Recommended: 2 seconds for logo visibility")
    hold_str = input("  Hold duration [2]: ").strip()
    try:
        config.animation.hold_end = float(hold_str) if hold_str else 2.0
    except ValueError:
        config.animation.hold_end = 2.0

    print("\n  ✓ Animation preferences saved")
    return config


def download_logo(url: str, output_path: Path) -> bool:
    """
    Download logo from URL.

    Args:
        url: URL to download from
        output_path: Path to save the file

    Returns:
        True if successful
    """
    try:
        print(f"  Downloading logo from {url[:50]}...")
        request = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        })
        with urllib.request.urlopen(request, timeout=30) as response:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(response.read())
        print(f"  ✓ Logo saved to {output_path}")
        return True
    except Exception as e:
        print(f"  Warning: Failed to download logo: {e}")
        return False


def setup_brand_from_website(url: str) -> BrandConfig | None:
    """
    Set up a brand by extracting information from website.

    Args:
        url: Website URL to analyze

    Returns:
        BrandConfig if successful, None otherwise
    """
    print_header("EXTRACTING BRAND FROM WEBSITE")

    config = extract_brand_from_url(url)
    if not config:
        print("\n  Failed to extract brand information.")
        return None

    # Display what was found
    print()
    display_extraction_confirmation(config)

    # Confirm or edit
    if not get_yes_no("\n  Use these settings?"):
        print("  Extraction cancelled.")
        return None

    # Prompt for brand name if needed
    config.brand_name = prompt_for_brand_name(config.brand_name)

    return config


def setup_brand_manually() -> BrandConfig:
    """
    Set up a brand manually without website extraction.

    Returns:
        BrandConfig with user-provided values
    """
    print_header("MANUAL BRAND SETUP")

    brand_name = prompt_for_brand_name()
    config = BrandConfig(brand_name=brand_name)

    # Phone
    phone = input("\n  Phone number (optional): ").strip()
    if phone:
        config.contact.phone = phone

    # Website
    website = input("  Website URL (optional): ").strip()
    if website:
        if not website.startswith(("http://", "https://")):
            website = f"https://{website}"
        config.contact.website = website
        config.source_url = website

    # Email
    email = input("  Email (optional): ").strip()
    if email:
        config.contact.email = email

    # Primary color
    color = input("  Primary color hex (optional, e.g., #1a365d): ").strip()
    if color and color.startswith("#"):
        config.colors.primary = color.upper()

    return config


def wizard_setup_brand(
    url: str | None = None,
    brand_name: str | None = None,
    logo_path: str | None = None,
    skip_animation: bool = False,
    yes: bool = False,
) -> BrandConfig | None:
    """
    Main wizard entry point for brand setup.

    Args:
        url: Website URL to extract from (optional)
        brand_name: Override brand name (optional)
        logo_path: Path to logo file (optional)
        skip_animation: Skip animation preference prompts
        yes: Auto-confirm prompts

    Returns:
        Saved BrandConfig, or None if cancelled
    """
    print_header("BRAND SETUP WIZARD")

    # Step 1: Extract from URL or manual setup
    if url:
        config = setup_brand_from_website(url)
        if not config:
            if not yes and get_yes_no("  Set up manually instead?"):
                config = setup_brand_manually()
            else:
                return None
    else:
        # Check for existing brands
        existing = prompt_brand_selection() if not yes else None
        if existing:
            config = load_brand(existing)
            print(f"\n  Loaded existing brand: {existing}")
        else:
            config = setup_brand_manually()

    if not config:
        return None

    # Override brand name if provided
    if brand_name:
        config.brand_name = brand_name

    # Step 2: Handle logo
    brand_dir = get_brand_dir(config.brand_name)
    brand_dir.mkdir(parents=True, exist_ok=True)

    if logo_path:
        # Copy provided logo
        logo_file = Path(logo_path)
        if logo_file.exists():
            dest = brand_dir / f"logo{logo_file.suffix}"
            import shutil
            shutil.copy(logo_file, dest)
            config.logos.full = dest.name
            print(f"  ✓ Logo copied to {dest}")
        else:
            print(f"  Warning: Logo file not found: {logo_path}")

    elif config.logos.full and config.logos.full.startswith("http"):
        # Download logo from URL extracted from website
        logo_url = config.logos.full
        # Determine extension from URL
        ext = ".png"
        if ".jpg" in logo_url.lower() or ".jpeg" in logo_url.lower():
            ext = ".jpg"
        elif ".svg" in logo_url.lower():
            ext = ".svg"
        elif ".webp" in logo_url.lower():
            ext = ".webp"

        dest = brand_dir / f"logo{ext}"
        if download_logo(logo_url, dest):
            config.logos.full = dest.name
        else:
            config.logos.full = None

    # Step 3: Animation preferences
    if not skip_animation:
        if yes:
            # Use defaults
            config.animation.preferred_preset = "liquid-chrome"
            config.animation.preferred_background = "auto"
            config.animation.hold_end = 2.0
        else:
            config = prompt_logo_animation_preferences(config)

    # Step 4: Save brand
    save_brand(config)
    print(f"\n  ✓ Brand '{config.brand_name}' saved to library")

    return config


def prompt_use_existing_brand(brand_name: str) -> tuple[bool, BrandConfig | None]:
    """
    Prompt user whether to use an existing brand.

    Used as a lazy trigger when a project references a brand name.

    Args:
        brand_name: Name of the brand to check

    Returns:
        (use_brand, config) - True and config if using, False and None otherwise
    """
    if not brand_exists(brand_name):
        return False, None

    config = load_brand(brand_name)
    if not config:
        return False, None

    print(f"\n  Found existing brand: '{brand_name}'")
    print(f"    Phone:   {config.contact.phone or 'Not set'}")
    print(f"    Website: {config.contact.website or 'Not set'}")
    print(f"    Logo:    {'Configured' if config.logos.full else 'Not set'}")
    print()

    if get_yes_no(f"  Use brand '{brand_name}'?"):
        return True, config
    return False, None


def prompt_setup_new_brand(suggested_name: str = "") -> BrandConfig | None:
    """
    Prompt to set up a new brand (lazy trigger).

    Used when no brand is found for a project.

    Args:
        suggested_name: Suggested brand name (e.g., from project slug)

    Returns:
        BrandConfig if set up, None if skipped
    """
    print("\n  No brand found for this project.")
    if not get_yes_no("  Would you like to set up brand information?"):
        return None

    # Ask for website
    url = prompt_for_website()

    if url:
        return wizard_setup_brand(url=url, brand_name=suggested_name)
    else:
        config = setup_brand_manually()
        if suggested_name and not config.brand_name:
            config.brand_name = suggested_name
        save_brand(config)
        return config


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Brand setup wizard for Video Replicator"
    )
    parser.add_argument(
        "--url", "-u",
        help="Website URL to extract brand from"
    )
    parser.add_argument(
        "--name", "-n",
        help="Brand name (overrides extracted name)"
    )
    parser.add_argument(
        "--logo", "-l",
        help="Path to logo file"
    )
    parser.add_argument(
        "--skip-animation",
        action="store_true",
        help="Skip animation preference prompts"
    )
    parser.add_argument(
        "--yes", "-y",
        action="store_true",
        help="Auto-confirm prompts (use defaults)"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all saved brands"
    )
    parser.add_argument(
        "--show",
        metavar="BRAND",
        help="Show details for a specific brand"
    )

    args = parser.parse_args()

    # List brands
    if args.list:
        brands = list_brands()
        if not brands:
            print("No brands saved yet.")
        else:
            print(f"\nSaved brands ({len(brands)}):")
            for brand in brands:
                print(f"  - {brand}")
        return

    # Show brand details
    if args.show:
        config = load_brand(args.show)
        if not config:
            print(f"Brand '{args.show}' not found.")
            sys.exit(1)
        display_extraction_confirmation(config)
        return

    # Run wizard
    config = wizard_setup_brand(
        url=args.url,
        brand_name=args.name,
        logo_path=args.logo,
        skip_animation=args.skip_animation,
        yes=args.yes,
    )

    if config:
        print("\n  Brand setup complete!")
        print(f"  Use with: --brand '{config.brand_name}'")
    else:
        print("\n  Brand setup cancelled.")
        sys.exit(1)


if __name__ == "__main__":
    main()
