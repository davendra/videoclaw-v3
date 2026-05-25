#!/usr/bin/env python3
"""
CTA Banner Generator - Phase 7

Generates animated CTA banners with logo, phone number, text, and QR code
using Remotion. The banner can be overlaid onto videos during stitching.

Usage:
    # Interactive mode
    python generate_cta_banner.py --project "{slug}"

    # Non-interactive mode
    python generate_cta_banner.py --project "{slug}" \
        --logo "logo.png" \
        --phone "555-123-4567" \
        --cta-text "Call {phone} today!" \
        --qr-url "https://example.com" \
        --timing "last-10s" \
        --animation "slide-fade" \
        --theme "light" \
        --ratio landscape \
        --yes
"""

import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

# Try to import qrcode for QR generation
try:
    import qrcode
    from qrcode.image.pure import PyPNGImage  # noqa: F401
    HAS_QRCODE = True
except ImportError:
    HAS_QRCODE = False
    print("Warning: qrcode library not installed. Install with: pip install qrcode[pil]")

# Try to import branding module
try:
    from branding import BrandConfig, get_brand_dir, list_brands, load_brand  # noqa: F401
    HAS_BRANDING = True
except ImportError:
    HAS_BRANDING = False

# Project paths
SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
REMOTION_DIR = SKILL_DIR / "remotion-banner"
PROJECTS_BASE = SKILL_DIR.parent.parent.parent / "projects"


def get_project_path(project_name: str) -> Path:
    """Get the full project path."""
    # Check if it's already a full path
    if os.path.isabs(project_name):
        return Path(project_name)

    # Check in projects directory
    project_path = PROJECTS_BASE / project_name
    if project_path.exists():
        return project_path

    # Try to find by partial match
    for p in PROJECTS_BASE.iterdir():
        if p.is_dir() and project_name in p.name:
            return p

    # Return the expected path (will be created)
    return project_path


def generate_qr_code(url: str, output_path: Path, size: int = 300) -> str:
    """Generate QR code and return as data URL."""
    if not HAS_QRCODE:
        # Fallback: return URL for API-based generation
        return f"https://api.qrserver.com/v1/create-qr-code/?size={size}x{size}&data={url}"

    # Generate QR code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")

    # Save to file
    img.save(str(output_path))
    print(f"  QR code saved: {output_path}")

    # Convert to data URL for Remotion
    with open(output_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")

    return f"data:image/png;base64,{data}"


def get_logo_data_url(logo_path: str) -> str:
    """Convert logo file to data URL."""
    if not logo_path or not os.path.exists(logo_path):
        return ""

    # Determine MIME type
    ext = Path(logo_path).suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
    }
    mime = mime_types.get(ext, "image/png")

    with open(logo_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")

    return f"data:{mime};base64,{data}"


def load_brand_config(brand_name: str) -> dict[str, Any] | None:
    """Load brand configuration and convert to CTA banner config format.

    Args:
        brand_name: Name of the brand in the library

    Returns:
        Dict with CTA banner config fields, or None if brand not found
    """
    if not HAS_BRANDING:
        print("Warning: Branding module not available")
        return None

    brand = load_brand(brand_name)
    if not brand:
        print(f"Brand '{brand_name}' not found in library")
        return None

    brand_dir = get_brand_dir(brand_name)

    # Get logo path (prefer horizontal for banner)
    logo_path = ""
    if brand.logos.horizontal:
        logo_path = str(brand_dir / brand.logos.horizontal)
    elif brand.logos.full:
        logo_path = str(brand_dir / brand.logos.full)

    # Build config from brand
    config = {
        "logoPath": logo_path,
        "companyName": brand.brand_name,
        "phoneNumber": brand.contact.phone or "",
        "qrUrl": brand.contact.website or "",
    }

    # Use brand colors for theme if available
    if brand.colors.primary:
        config["theme"] = "custom"
        config["customColors"] = {
            "background": brand.colors.background or "#FFFFFF",
            "text": brand.colors.text or "#1a1a2e",
            "accent": brand.colors.primary,
        }
    else:
        # Auto-detect theme based on brand colors
        config["theme"] = brand.get_theme_from_colors()

    return config


def print_available_brands() -> None:
    """Print list of available brands in the library."""
    if not HAS_BRANDING:
        print("  (Branding module not available)")
        return

    brands = list_brands()
    if not brands:
        print("  (No saved brands)")
        return

    print("  Available brands:")
    for brand in brands:
        print(f"    - {brand}")


def parse_timing(timing_str: str, video_duration_frames: int = 2400, fps: int = 30) -> dict[str, int]:
    """Parse timing string into start frame and duration.

    Args:
        timing_str: "entire", "last-5s", "last-10s", "custom-30" (start at 30s)
        video_duration_frames: Total video duration in frames
        fps: Frames per second
    """
    if timing_str == "entire":
        return {"startFrame": 0, "showDuration": video_duration_frames}

    if timing_str.startswith("last-"):
        seconds = int(timing_str.replace("last-", "").replace("s", ""))
        start_frame = video_duration_frames - (seconds * fps)
        return {"startFrame": max(0, start_frame), "showDuration": seconds * fps}

    if timing_str.startswith("custom-"):
        start_seconds = int(timing_str.replace("custom-", ""))
        return {"startFrame": start_seconds * fps, "showDuration": video_duration_frames - (start_seconds * fps)}

    # Default: last 10 seconds
    return {"startFrame": video_duration_frames - (10 * fps), "showDuration": 10 * fps}


def prompt_user_input() -> dict[str, Any]:
    """Interactive prompt for user input."""
    print("\n" + "=" * 60)
    print("CTA BANNER GENERATOR")
    print("=" * 60)

    config = {}

    # Option to load from saved brand
    if HAS_BRANDING:
        brands = list_brands()
        if brands:
            print("\n0. LOAD FROM SAVED BRAND")
            print_available_brands()
            brand_choice = input("   Enter brand name (or press Enter to skip): ").strip()
            if brand_choice:
                brand_config = load_brand_config(brand_choice)
                if brand_config:
                    config.update(brand_config)
                    print(f"   ✓ Loaded brand: {brand_choice}")
                    print(f"     Logo: {config.get('logoPath') or '(none)'}")
                    print(f"     Phone: {config.get('phoneNumber') or '(none)'}")
                    print(f"     Website: {config.get('qrUrl') or '(none)'}")
                    print("\n   You can override any fields below, or press Enter to keep brand values.")

    # Logo
    print("\n1. LOGO")
    default_logo = config.get("logoPath", "")
    prompt_text = f"   Logo image path [{default_logo}]: " if default_logo else "   Logo image path (or press Enter to skip): "
    logo_input = input(prompt_text).strip()
    config["logoPath"] = logo_input if logo_input else default_logo

    # Company name
    print("\n2. COMPANY NAME")
    default_company = config.get("companyName", "Your Company")
    company_input = input(f"   Company name [{default_company}]: ").strip()
    config["companyName"] = company_input if company_input else default_company

    # Phone number
    print("\n3. PHONE NUMBER")
    default_phone = config.get("phoneNumber", "")
    prompt_text = f"   Phone number [{default_phone}]: " if default_phone else "   Phone number (e.g., 555-123-4567): "
    phone_input = input(prompt_text).strip()
    config["phoneNumber"] = phone_input if phone_input else default_phone

    # CTA Text
    print("\n4. CALL-TO-ACTION TEXT")
    print("   Use {phone} as placeholder for phone number")
    default_cta = "Scan or call {phone} to schedule an appointment"
    cta_input = input(f"   CTA text [{default_cta}]: ").strip()
    config["ctaText"] = cta_input if cta_input else default_cta

    # QR Code destination
    print("\n5. QR CODE DESTINATION")
    default_qr = config.get("qrUrl", "")
    if default_qr:
        print(f"   Current: {default_qr}")
    print("   [A] Website URL")
    print("   [B] Phone number (tel: link)")
    print("   [C] Custom URL")
    print("   [K] Keep current" if default_qr else "")
    qr_choice = input("   Choice [A/B/C" + ("/K" if default_qr else "") + "]: ").strip().upper() or ("K" if default_qr else "A")

    if qr_choice == "K" and default_qr:
        pass  # Keep existing qrUrl
    elif qr_choice == "B":
        config["qrUrl"] = f"tel:{config['phoneNumber'].replace('-', '').replace(' ', '')}"
    elif qr_choice == "C":
        config["qrUrl"] = input("   Enter custom URL: ").strip()
    else:
        url_input = input(f"   Enter website URL [{default_qr}]: ").strip()
        config["qrUrl"] = url_input if url_input else default_qr

    # Timing
    print("\n6. BANNER TIMING")
    print("   [A] Entire video")
    print("   [B] Last 5 seconds")
    print("   [C] Last 10 seconds")
    print("   [D] Custom (enter start time)")
    timing_choice = input("   Choice [A/B/C/D]: ").strip().upper() or "C"

    timing_map = {"A": "entire", "B": "last-5s", "C": "last-10s"}
    if timing_choice == "D":
        start_time = input("   Start time in seconds: ").strip()
        config["timing"] = f"custom-{start_time}"
    else:
        config["timing"] = timing_map.get(timing_choice, "last-10s")

    # Animation
    print("\n7. ANIMATION STYLE")
    print("   [A] Slide up from bottom")
    print("   [B] Fade in")
    print("   [C] Slide + Fade (combined)")
    print("   [D] Static (no animation)")
    anim_choice = input("   Choice [A/B/C/D]: ").strip().upper() or "C"

    anim_map = {"A": "slide", "B": "fade", "C": "slide-fade", "D": "static"}
    config["animation"] = anim_map.get(anim_choice, "slide-fade")

    # Theme
    print("\n8. BANNER THEME")
    print("   [A] Light (white background)")
    print("   [B] Dark (dark background, white text)")
    print("   [C] Semi-transparent (blur effect)")
    print("   [D] Custom colors")
    theme_choice = input("   Choice [A/B/C/D]: ").strip().upper() or "A"

    theme_map = {"A": "light", "B": "dark", "C": "transparent", "D": "custom"}
    config["theme"] = theme_map.get(theme_choice, "light")

    if config["theme"] == "custom":
        print("\n   Enter custom colors (hex format):")
        config["customColors"] = {
            "background": input("   Background color [#FFFFFF]: ").strip() or "#FFFFFF",
            "text": input("   Text color [#1a1a2e]: ").strip() or "#1a1a2e",
            "accent": input("   Accent color [#4a00e0]: ").strip() or "#4a00e0",
        }

    # Aspect ratio
    print("\n9. ASPECT RATIO")
    print("   [A] Landscape (16:9)")
    print("   [B] Portrait (9:16)")
    print("   [C] Both")
    ratio_choice = input("   Choice [A/B/C]: ").strip().upper() or "A"

    ratio_map = {"A": "landscape", "B": "portrait", "C": "both"}
    config["ratio"] = ratio_map.get(ratio_choice, "landscape")

    print("\n" + "=" * 60)

    return config


def render_banner(
    props_path: Path,
    output_path: Path,
    composition: str = "CTABannerOverlay",
    codec: str = "vp9",
    transparent: bool = True,
) -> bool:
    """Render the banner using Remotion CLI directly."""

    # Check if Remotion project has node_modules
    node_modules = REMOTION_DIR / "node_modules"
    if not node_modules.exists():
        print("Installing Remotion dependencies...")
        subprocess.run(
            ["npm", "install"],
            cwd=REMOTION_DIR,
            check=True,
        )

    # Use Remotion CLI directly instead of custom render.ts
    # This is more reliable and supports all Remotion features
    entry_point = REMOTION_DIR / "src" / "index.ts"

    cmd = [
        "npx", "remotion", "render",
        str(entry_point),
        composition,
        str(output_path),
        "--props", str(props_path),
        "--codec", codec,
    ]

    print(f"  Running: {' '.join(cmd)}")

    result = subprocess.run(
        cmd,
        cwd=REMOTION_DIR,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"  Error: {result.stderr}")
        return False

    print(f"  {result.stdout}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Generate CTA banner for video overlay"
    )
    parser.add_argument("--project", required=True, help="Project name or path")
    parser.add_argument("--brand", help="Load settings from saved brand in library")
    parser.add_argument("--list-brands", action="store_true", help="List available brands")
    parser.add_argument("--logo", help="Logo image path (overrides brand)")
    parser.add_argument("--company-name", help="Company name (overrides brand)")
    parser.add_argument("--phone", help="Phone number")
    parser.add_argument("--cta-text", help="CTA text (use {phone} for phone placeholder)")
    parser.add_argument("--qr-url", help="URL for QR code")
    parser.add_argument("--timing", default="last-10s",
                       help="Banner timing: entire, last-5s, last-10s, custom-N")
    parser.add_argument("--animation", default="slide-fade",
                       choices=["slide", "fade", "slide-fade", "static"],
                       help="Animation style")
    parser.add_argument("--theme", default="light",
                       choices=["light", "dark", "transparent", "custom"],
                       help="Banner theme")
    parser.add_argument("--bg-color", help="Custom background color (hex)")
    parser.add_argument("--text-color", help="Custom text color (hex)")
    parser.add_argument("--accent-color", help="Custom accent color (hex)")
    parser.add_argument("--ratio", default="landscape",
                       choices=["landscape", "portrait", "both"],
                       help="Aspect ratio")
    parser.add_argument("--video-duration", type=int, default=80,
                       help="Video duration in seconds (for timing calculation)")
    parser.add_argument("--fps", type=int, default=30, help="Frames per second")
    parser.add_argument("--yes", "-y", action="store_true",
                       help="Skip confirmation prompts")
    parser.add_argument("--dry-run", action="store_true",
                       help="Show what would be done without rendering")

    args = parser.parse_args()

    # Handle --list-brands
    if args.list_brands:
        print("\nAvailable brands in library:")
        print_available_brands()
        return

    # Get project path
    project_path = get_project_path(args.project)
    banner_dir = project_path / "banner"
    banner_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nProject: {project_path}")
    print(f"Banner output: {banner_dir}")

    # Load brand config if specified
    brand_config = {}
    if args.brand:
        brand_config = load_brand_config(args.brand) or {}
        if brand_config:
            print(f"  ✓ Loaded brand: {args.brand}")

    # Interactive mode if required args not provided
    if not args.phone and not args.yes and not brand_config.get("phoneNumber"):
        config = prompt_user_input()
    else:
        # Start with brand config as base, then override with CLI args
        config = {
            "logoPath": args.logo or brand_config.get("logoPath", ""),
            "companyName": args.company_name or brand_config.get("companyName", "Your Company"),
            "phoneNumber": args.phone or brand_config.get("phoneNumber", ""),
            "ctaText": args.cta_text or "Scan or call {phone} to schedule an appointment",
            "qrUrl": args.qr_url or brand_config.get("qrUrl", ""),
            "timing": args.timing,
            "animation": args.animation,
            "theme": args.theme if args.theme != "light" or not brand_config.get("theme") else brand_config.get("theme", "light"),
            "ratio": args.ratio,
        }

        # Use brand custom colors if available and theme is custom
        if brand_config.get("customColors") and config["theme"] == "custom":
            config["customColors"] = brand_config["customColors"]

        if args.theme == "custom" or (args.bg_color or args.text_color or args.accent_color):
            config["theme"] = "custom"
            config["customColors"] = {
                "background": args.bg_color or brand_config.get("customColors", {}).get("background", "#FFFFFF"),
                "text": args.text_color or brand_config.get("customColors", {}).get("text", "#1a1a2e"),
                "accent": args.accent_color or brand_config.get("customColors", {}).get("accent", "#4a00e0"),
            }

    # Validate required fields
    if not config.get("phoneNumber"):
        print("Error: Phone number is required")
        sys.exit(1)

    if not config.get("qrUrl"):
        print("Error: QR code URL is required")
        sys.exit(1)

    # Calculate timing
    video_duration_frames = args.video_duration * args.fps
    timing = parse_timing(config["timing"], video_duration_frames, args.fps)

    # Generate QR code
    print("\n" + "=" * 60)
    print("GENERATING CTA BANNER")
    print("=" * 60)

    qr_path = banner_dir / "qr_code.png"
    print(f"\n  Generating QR code for: {config['qrUrl']}")
    qr_data_url = generate_qr_code(config["qrUrl"], qr_path)

    # Get logo as data URL
    logo_data_url = ""
    if config.get("logoPath"):
        print(f"  Loading logo: {config['logoPath']}")
        logo_data_url = get_logo_data_url(config["logoPath"])

    # Build Remotion props
    props = {
        "logoUrl": logo_data_url,
        "companyName": config["companyName"],
        "phoneNumber": config["phoneNumber"],
        "ctaText": config["ctaText"],
        "qrCodeUrl": config["qrUrl"],
        "qrCodeDataUrl": qr_data_url,
        "animation": config["animation"],
        "theme": config["theme"],
        "timing": timing,
        "overlayMode": True,
    }

    if config.get("customColors"):
        props["customColors"] = config["customColors"]

    # Save props
    props_path = banner_dir / "props.json"
    with open(props_path, "w") as f:
        json.dump(props, f, indent=2)
    print(f"  Props saved: {props_path}")

    # Save config for reference
    config_path = banner_dir / "config.json"
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"  Config saved: {config_path}")

    if args.dry_run:
        print("\n  [DRY RUN] Would render banner with these settings:")
        print(f"    Animation: {config['animation']}")
        print(f"    Theme: {config['theme']}")
        print(f"    Timing: {config['timing']}")
        print(f"    Ratio: {config['ratio']}")
        return

    # Render banners
    ratios_to_render = []
    if config["ratio"] in ["landscape", "both"]:
        ratios_to_render.append(("landscape", "CTABannerOverlay", 1920, 200))
    if config["ratio"] in ["portrait", "both"]:
        ratios_to_render.append(("portrait", "CTABannerOverlayPortrait", 1080, 350))

    print("\n  Rendering banner(s)...")

    for ratio_name, composition, width, height in ratios_to_render:
        output_path = banner_dir / f"cta_banner_{ratio_name}.webm"
        print(f"\n  [{ratio_name.upper()}] Rendering {width}x{height}...")

        success = render_banner(
            props_path=props_path,
            output_path=output_path,
            composition=composition,
            codec="vp9",
            transparent=True,
        )

        if success:
            print(f"  ✓ {output_path}")
        else:
            print(f"  ✗ Failed to render {ratio_name} banner")

    print("\n" + "=" * 60)
    print("BANNER GENERATION COMPLETE")
    print("=" * 60)
    print(f"\n  Output directory: {banner_dir}")
    print("\n  To apply to your video:")
    print("    python stitch_video.py --videos-dir '...' \\")
    print(f"      --cta-banner '{banner_dir}/cta_banner_landscape.webm' \\")
    print("      --output 'final_with_cta.mp4'")
    print("=" * 60)


if __name__ == "__main__":
    main()
