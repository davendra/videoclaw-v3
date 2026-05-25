#!/usr/bin/env python3
"""
Shared utility functions for video-replicator scripts.

This module is a backward-compatible facade that re-exports all functions
from the split utility modules. All existing ``from utils import X``
statements continue to work unchanged.

Modules:
    config          — centralized constants and paths
    utils_project   — project dirs, run versioning, manifest
    utils_transitions — transition scene detection
    utils_validation — timestamp/freshness validation
    utils_strict    — strict image validation
    utils_variation — multi-variation support
    utils_image     — image processing (crop, resize, dimensions)
    utils_download  — image downloading
    utils_video     — FFmpeg/ffprobe helpers
    utils_preflight — pre-flight validation orchestration
    utils_aspect    — aspect ratio validation/fixing
    utils_command   — I2V/F2V command building
    utils_prompt    — prompt simplification, mix spec parsing
"""

# ============================================================================
# Re-export: config constants
# ============================================================================
from config import (  # noqa: F401
    LANDSCAPE_HEIGHT,
    LANDSCAPE_RATIO,
    LANDSCAPE_WIDTH,
    PORTRAIT_HEIGHT,
    PORTRAIT_RATIO,
    PORTRAIT_WIDTH,
)

# ============================================================================
# Re-export: utils_aspect
# ============================================================================
from utils_aspect import (  # noqa: F401
    add_aspect_ratio_to_prompt,
    adjust_prompt_for_ratio,
    crop_to_ratio,
    get_scene_type,
    print_aspect_ratio_summary,
    validate_and_fix_aspect_ratios,
)

# ============================================================================
# Re-export: utils_command
# ============================================================================
from utils_command import (  # noqa: F401
    build_veo_command,
    format_f2v_prompt,
    format_i2v_prompt,
)

# ============================================================================
# Re-export: utils_download
# ============================================================================
from utils_download import (  # noqa: F401
    download_gobananas_images,
    download_image,
    download_images,
    download_scene_images,
)

# ============================================================================
# Re-export: utils_image
# ============================================================================
from utils_image import (  # noqa: F401
    crop_landscape_to_portrait,
    get_aspect_ratio_string,
    get_aspect_ratio_type,
    get_image_dimensions,
    resize_to_landscape,
    validate_aspect_ratios,
)

# ============================================================================
# Re-export: utils_preflight
# ============================================================================
from utils_preflight import (  # noqa: F401
    print_preflight_results,
    validate_preflight,
)

# ============================================================================
# Re-export: utils_project
# ============================================================================
from utils_project import (  # noqa: F401
    clean_artifacts,
    detect_image_run_prefix,
    ensure_project_dirs,
    get_current_run_id,
    get_latest_run_id,
    get_or_create_manifest,
    get_project_dirs,
    get_run_dir,
    get_run_subdir,
    has_run_structure,
    increment_run,
    list_run_files,
    sync_image_run_prefix,
    update_run_status,
)

# ============================================================================
# Re-export: utils_prompt
# ============================================================================
from utils_prompt import (  # noqa: F401
    parse_mix_spec,
    simplify_prompt,
)

# ============================================================================
# Re-export: utils_strict
# ============================================================================
from utils_strict import (  # noqa: F401
    print_strict_validation,
    validate_images_strict,
)

# ============================================================================
# Re-export: utils_transitions
# ============================================================================
from utils_transitions import (  # noqa: F401
    filter_content_scenes,
    is_transition_scene,
)

# ============================================================================
# Re-export: utils_validation
# ============================================================================
from utils_validation import (  # noqa: F401
    get_run_start_timestamp,
    print_stale_images_warning,
    validate_file_freshness,
    validate_image_freshness,
    validate_images_freshness,
    validate_video_freshness,
    validate_videos_freshness,
)

# ============================================================================
# Re-export: utils_variation
# ============================================================================
from utils_variation import (  # noqa: F401
    detect_variations,
    estimate_generation_cost,
    find_frame_image_variation,
    get_variation_suffix,
    print_cost_estimate,
)

# ============================================================================
# Re-export: utils_video
# ============================================================================
from utils_video import (  # noqa: F401
    count_scene_videos,
    extract_frame_ffmpeg,
    extract_last_frame,
    get_video_dimensions,
    get_video_duration,
    get_video_info,
    parse_sealcam_timestamp,
)
