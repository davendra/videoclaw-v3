"""
Branding Module for Video Replicator.

Provides unified brand asset management including:
- Brand configuration (logos, colors, contact, typography)
- Global brand library (~/.video-replicator/brands/)
- Website extraction for auto-populating brand data
- Logo variant generation (horizontal, icon, white versions)
"""

from .brand_config import BrandConfig, load_brand_config, save_brand_config
from .brand_extractor import (
    detect_fonts_from_css,
    display_extraction_confirmation,
    extract_brand_from_url,
    extract_colors_from_css,
    find_email_from_html,
    find_logo_from_html,
    find_phone_from_html,
    find_social_links,
)
from .brand_library import (
    brand_exists,
    delete_brand,
    get_brand_dir,
    get_brand_library_path,
    list_brands,
    load_brand,
    save_brand,
)
from .brand_wizard import (
    prompt_logo_animation_preferences,
    prompt_setup_new_brand,
    prompt_use_existing_brand,
    wizard_setup_brand,
)

__all__ = [
    # Config
    "BrandConfig",
    "load_brand_config",
    "save_brand_config",
    # Library
    "list_brands",
    "load_brand",
    "save_brand",
    "delete_brand",
    "brand_exists",
    "get_brand_library_path",
    "get_brand_dir",
    # Extractor
    "extract_brand_from_url",
    "extract_colors_from_css",
    "find_logo_from_html",
    "find_phone_from_html",
    "find_email_from_html",
    "find_social_links",
    "detect_fonts_from_css",
    "display_extraction_confirmation",
    # Wizard
    "wizard_setup_brand",
    "prompt_use_existing_brand",
    "prompt_setup_new_brand",
    "prompt_logo_animation_preferences",
]
