#!/usr/bin/env python3
"""
Custom exception hierarchy for video-replicator scripts.

All scripts should catch and raise these specific exceptions instead
of generic Exception or bare except blocks.

Usage:
    from exceptions import (
        VideoReplicatorError,
        ProjectError,
        ValidationError,
        ImageProcessingError,
        VideoProcessingError,
        APIError,
    )
"""


class VideoReplicatorError(Exception):
    """Base exception for all video-replicator errors."""
    pass


# ============================================================================
# Project Errors
# ============================================================================

class ProjectError(VideoReplicatorError):
    """Error related to project structure or configuration."""
    pass


class ManifestError(ProjectError):
    """Error reading or writing manifest.json."""
    pass


class RunNotFoundError(ProjectError):
    """Requested run ID does not exist."""
    pass


# ============================================================================
# Validation Errors
# ============================================================================

class ValidationError(VideoReplicatorError):
    """Input validation failed."""
    pass


class StaleArtifactError(ValidationError):
    """Artifact (image or video) is stale — older than current run."""
    pass


# ============================================================================
# Processing Errors
# ============================================================================

class ImageProcessingError(VideoReplicatorError):
    """Error during image processing (crop, resize, download)."""
    pass


class VideoProcessingError(VideoReplicatorError):
    """Error during video processing (FFmpeg, ffprobe, stitching)."""
    pass


class StitchError(VideoProcessingError):
    """Stitch operation produced invalid output."""
    pass


# ============================================================================
# External Service Errors
# ============================================================================

class APIError(VideoReplicatorError):
    """Error communicating with an external API."""
    pass


class VeoCliError(APIError):
    """Error running veo-cli subprocess."""
    pass


class MissingDependencyError(VideoReplicatorError):
    """Required external tool is not installed (FFmpeg, Bun, etc.)."""
    pass


# ============================================================================
# UGC Campaign Errors
# ============================================================================

class StrategyError(VideoReplicatorError):
    """Error in UGC strategy document creation or validation."""
    pass


class ScriptValidationError(ValidationError):
    """UGC belief script failed validation (schema, word count, etc.)."""
    pass


class SubtitleError(VideoProcessingError):
    """Error during subtitle generation or burn-in."""
    pass


class CampaignManifestError(ProjectError):
    """Error reading or writing UGC campaign manifest."""
    pass


# ============================================================================
# Seedance 2.0 Backend Errors
# ============================================================================

class SeedanceError(APIError):
    """Error from Seedance 2.0 API."""
    pass


class SeedanceTimeoutError(SeedanceError):
    """Seedance task did not complete within the maximum poll time."""
    pass


class UploadError(APIError):
    """Error uploading media files to hosting service."""
    pass


# ============================================================================
# Film Pipeline Errors (v2.37)
# ============================================================================

class ScreenplayError(VideoReplicatorError):
    """Error during screenplay generation or validation."""
    pass


class CharacterDesignError(VideoReplicatorError):
    """Error during character extraction, reference creation, or voice assignment."""
    pass


class StoryEngineError(VideoReplicatorError):
    """Error in story engine (story mode, transitions, enhance)."""
    pass
