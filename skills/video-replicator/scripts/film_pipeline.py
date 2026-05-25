#!/usr/bin/env python3
"""
Film Pipeline — stateful orchestrator for concept-to-video production.

Ties together screenplay generation, character design, scene breakdown,
image generation, video generation, audio, and stitching into a resumable
pipeline with phase tracking.  Follows the nex_assemble.py pattern
(argparse, phase orchestration, --yes).

Two entry points:
  1. run_pipeline()            — top-down: concept → full film
  2. run_pipeline_from_video() — COPY-to-Film: reference video → film

Each phase writes state to ``projects/{slug}/film_state.json`` so the
pipeline can be resumed from any point after interruption or manual steps.

Usage:
    # Top-down: concept → film (Seedance backend)
    python film_pipeline.py --concept "30s smartwatch ad" --project test \\
      --duration 30 --scenes 6 --backend seedance --dry-run

    # COPY-to-Film: reference video → reproduce
    python film_pipeline.py --reference-video "input.mp4" --project test-copy \\
      --backend seedance --new-subject "A young woman in red dress"

    # Resume from any phase
    python film_pipeline.py --project test --resume-from breakdown

    # Check pipeline status
    python film_pipeline.py --project test --status
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Ensure scripts/ is on the Python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    FILM_PHASES,
    FILM_SUPPORTED_BACKENDS,
    GENRE_PRESETS,
    PROJECT_BASE,
)
from exceptions import CharacterDesignError, ScreenplayError
from style_bible import StyleBible, create_style_bible, load_style_bible, save_style_bible
from logging_config import setup_logging

# Imports from peer modules — guarded with try/except because some modules
# may be created in parallel (Waves 2-4 of v2.37).
try:
    from screenplay_generator import (
        Screenplay,
        detect_genre,
        extract_hero_subject,
        generate_screenplay,
        save_screenplay_to_file,
        screenplay_from_analysis,
        validate_screenplay,
    )
except ImportError:
    Screenplay = None  # type: ignore[misc,assignment]
    generate_screenplay = None  # type: ignore[assignment]
    screenplay_from_analysis = None  # type: ignore[assignment]
    detect_genre = None  # type: ignore[assignment]
    extract_hero_subject = None  # type: ignore[assignment]
    validate_screenplay = None  # type: ignore[assignment]
    save_screenplay_to_file = None  # type: ignore[assignment]

try:
    from scene_breakdown import breakdown_screenplay, write_breakdown_outputs
except ImportError:
    breakdown_screenplay = None  # type: ignore[assignment]
    write_breakdown_outputs = None  # type: ignore[assignment]

try:
    from character_designer import (
        assign_voices,
        create_character_references,
        extract_characters,
        write_characters_json,
    )
except ImportError:
    extract_characters = None  # type: ignore[assignment]
    create_character_references = None  # type: ignore[assignment]
    assign_voices = None  # type: ignore[assignment]
    write_characters_json = None  # type: ignore[assignment]

logger = logging.getLogger("film_pipeline")


# ============================================================================
# Film State
# ============================================================================


@dataclass
class FilmState:
    """Tracks the current state of a film pipeline run."""

    project_slug: str
    project_dir: str
    concept: str = ""
    genre: str = ""
    backend: str = "seedance"
    target_duration: int = 60
    scene_count: int = 8
    current_phase: str = "concept"
    reference_video: str | None = None
    new_subject: str | None = None
    screenplay_path: str | None = None
    characters_path: str | None = None
    breakdown_path: str | None = None
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Serialize state to a plain dict for JSON persistence."""
        return {
            "project_slug": self.project_slug,
            "project_dir": self.project_dir,
            "concept": self.concept,
            "genre": self.genre,
            "backend": self.backend,
            "target_duration": self.target_duration,
            "scene_count": self.scene_count,
            "current_phase": self.current_phase,
            "reference_video": self.reference_video,
            "new_subject": self.new_subject,
            "screenplay_path": self.screenplay_path,
            "characters_path": self.characters_path,
            "breakdown_path": self.breakdown_path,
            "errors": self.errors,
        }

    @classmethod
    def from_dict(cls, data: dict) -> FilmState:
        """Reconstruct state from a deserialized dict."""
        return cls(
            project_slug=data.get("project_slug", ""),
            project_dir=data.get("project_dir", ""),
            concept=data.get("concept", ""),
            genre=data.get("genre", ""),
            backend=data.get("backend", "seedance"),
            target_duration=data.get("target_duration", 60),
            scene_count=data.get("scene_count", 8),
            current_phase=data.get("current_phase", "concept"),
            reference_video=data.get("reference_video"),
            new_subject=data.get("new_subject"),
            screenplay_path=data.get("screenplay_path"),
            characters_path=data.get("characters_path"),
            breakdown_path=data.get("breakdown_path"),
            errors=data.get("errors", []),
        )

    def save(self) -> None:
        """Persist state to ``project_dir/film_state.json``."""
        state_path = os.path.join(self.project_dir, "film_state.json")
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        with open(state_path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)
        logger.debug("Saved pipeline state to %s (phase=%s)", state_path, self.current_phase)

    @classmethod
    def load(cls, project_dir: str) -> FilmState | None:
        """Load state from ``project_dir/film_state.json``.

        Returns ``None`` if the file does not exist.
        """
        state_path = os.path.join(project_dir, "film_state.json")
        if not os.path.exists(state_path):
            return None
        with open(state_path) as f:
            data = json.load(f)
        return cls.from_dict(data)


# ============================================================================
# Public API
# ============================================================================


def get_pipeline_state(project_slug: str) -> FilmState | None:
    """Load pipeline state for *project_slug* from the project directory."""
    project_dir = os.path.join(PROJECT_BASE, project_slug)
    return FilmState.load(project_dir)


def advance_phase(state: FilmState, target_phase: str) -> FilmState:
    """Advance *state* to *target_phase*, validating phase ordering.

    Raises ``ValueError`` if *target_phase* is not a recognised phase or
    comes before the current phase.
    """
    if target_phase not in FILM_PHASES:
        raise ValueError(f"Unknown phase '{target_phase}'. Valid phases: {FILM_PHASES}")

    target_idx = FILM_PHASES.index(target_phase)
    current_idx = FILM_PHASES.index(state.current_phase) if state.current_phase in FILM_PHASES else -1

    if target_idx < current_idx:
        raise ValueError(
            f"Cannot move backward from '{state.current_phase}' to '{target_phase}'"
        )

    state.current_phase = target_phase
    state.save()
    return state


# ============================================================================
# Top-Down Entry Point
# ============================================================================


def run_pipeline(
    concept: str,
    project_slug: str,
    duration: int = 60,
    scene_count: int = 8,
    genre: str | None = None,
    backend: str = "seedance",
    resume_from: str | None = None,
    dry_run: bool = False,
    yes: bool = False,
) -> FilmState:
    """Top-down entry point: concept -> full pipeline.

    Creates a project, then runs each phase sequentially:

    1. concept     - save concept, detect genre, create dirs
    2. screenplay  - generate_screenplay() via Gemini
    3. characters  - extract_characters(), output MCP commands
    4. breakdown   - breakdown_screenplay(backend=backend)
    5. images      - print Go Bananas MCP commands (manual step)
    6. videos      - print parallel_video_gen.py command
    7. audio       - print generate_tts.py / generate_music.py commands
    8. stitch      - print stitch_video.py command
    9. complete    - mark done

    Phases 5-8 print commands for the user / Claude to execute
    (they depend on external tools like Go Bananas MCP and veo-cli).

    If *resume_from* is set, skip phases before it.
    If *dry_run*, print what would happen without executing.
    """
    if backend not in FILM_SUPPORTED_BACKENDS:
        raise ValueError(f"Unsupported backend '{backend}'. Choose from: {FILM_SUPPORTED_BACKENDS}")

    project_dir = os.path.join(PROJECT_BASE, project_slug)

    # Try to load existing state
    state = FilmState.load(project_dir)
    if state is None:
        state = FilmState(
            project_slug=project_slug,
            project_dir=project_dir,
            concept=concept,
            genre=genre or "",
            backend=backend,
            target_duration=duration,
            scene_count=scene_count,
        )

    # Override mutable settings on each invocation
    state.backend = backend
    if concept:
        state.concept = concept
    if genre:
        state.genre = genre

    return _execute_pipeline(state, resume_from=resume_from, dry_run=dry_run, yes=yes)


# ============================================================================
# COPY-to-Film Entry Point
# ============================================================================


def run_pipeline_from_video(
    reference_video: str,
    project_slug: str,
    new_subject: str | None = None,
    backend: str = "seedance",
    resume_from: str | None = None,
    dry_run: bool = False,
    yes: bool = False,
) -> FilmState:
    """COPY-to-Film entry point: reference video -> full pipeline.

    1. analysis   - print analyze_video.py command
    2. screenplay - screenplay_from_analysis()
    3-9           - same as run_pipeline()
    """
    if backend not in FILM_SUPPORTED_BACKENDS:
        raise ValueError(f"Unsupported backend '{backend}'. Choose from: {FILM_SUPPORTED_BACKENDS}")

    project_dir = os.path.join(PROJECT_BASE, project_slug)

    state = FilmState.load(project_dir)
    if state is None:
        state = FilmState(
            project_slug=project_slug,
            project_dir=project_dir,
            backend=backend,
            reference_video=os.path.abspath(reference_video),
            new_subject=new_subject,
        )
    else:
        state.reference_video = os.path.abspath(reference_video)
        if new_subject:
            state.new_subject = new_subject
        state.backend = backend

    return _execute_pipeline(state, resume_from=resume_from, dry_run=dry_run, yes=yes)


# ============================================================================
# Core Phase Execution
# ============================================================================


def _execute_pipeline(
    state: FilmState,
    resume_from: str | None = None,
    dry_run: bool = False,
    yes: bool = False,
) -> FilmState:
    """Run pipeline phases sequentially from *resume_from* onward."""

    # Determine start phase
    if resume_from:
        if resume_from not in FILM_PHASES:
            raise ValueError(f"Unknown phase '{resume_from}'. Valid: {FILM_PHASES}")
        start_idx = FILM_PHASES.index(resume_from)
    else:
        start_idx = 0

    is_copy_path = bool(state.reference_video)

    phase_runners = {
        "concept": _run_concept_phase,
        "analysis": _run_analysis_phase,
        "screenplay": _run_screenplay_phase,
        "characters": _run_characters_phase,
        "breakdown": _run_breakdown_phase,
        "images": _run_images_phase,
        "videos": _run_videos_phase,
        "audio": _run_audio_phase,
        "stitch": _run_stitch_phase,
    }

    # Manual-step phases: after printing commands, pause for user execution.
    manual_phases = {"images", "videos", "audio", "stitch"}

    for phase in FILM_PHASES[start_idx:]:
        # Skip the analysis phase for top-down (non-COPY) path
        if phase == "analysis" and not is_copy_path:
            continue

        if dry_run:
            logger.info("[DRY RUN] Would run phase: %s", phase)
            # Show style bible summary on breakdown phase
            if phase == "breakdown" and state.genre:
                bible = create_style_bible(state.genre)
                logger.info("[DRY RUN] Style Bible: %s", bible.style_tag)
                logger.info("[DRY RUN]   Palette: %s", bible.color_palette)
                logger.info("[DRY RUN]   Lighting: %s", bible.lighting_default)
                genre_preset = GENRE_PRESETS.get(state.genre, {})
                if genre_preset:
                    logger.info("[DRY RUN]   Color grade: %s", genre_preset.get("color_grading_ffmpeg", "none"))
            continue

        state.current_phase = phase
        state.save()

        runner = phase_runners.get(phase)
        if runner:
            try:
                state = runner(state, dry_run=dry_run)
            except (ScreenplayError, CharacterDesignError) as exc:
                state.errors.append(f"{phase}: {exc}")
                state.save()
                logger.error("Phase '%s' failed: %s", phase, exc)
                return state
            except Exception as exc:
                state.errors.append(f"{phase}: {exc}")
                state.save()
                logger.error("Phase '%s' failed unexpectedly: %s", phase, exc)
                return state

        if phase == "complete":
            state.current_phase = "complete"
            state.save()
            logger.info("Pipeline complete for project '%s'.", state.project_slug)
            break

        # Phases that require manual execution — print commands and pause
        if phase in manual_phases:
            next_idx = FILM_PHASES.index(phase) + 1
            if next_idx < len(FILM_PHASES):
                next_phase = FILM_PHASES[next_idx]
                # Skip analysis hint for top-down path
                if next_phase == "analysis" and not is_copy_path:
                    next_idx += 1
                    if next_idx < len(FILM_PHASES):
                        next_phase = FILM_PHASES[next_idx]

                if not yes:
                    print(f"\n  Execute the above commands, then resume with:")
                    print(
                        f"  python film_pipeline.py --project {state.project_slug} "
                        f"--resume-from {next_phase}"
                    )
                    break

    return state


# ============================================================================
# Phase Runners
# ============================================================================


def _run_concept_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Save concept, detect genre, create project directories."""

    logger.info("=" * 60)
    logger.info("Phase: CONCEPT")
    logger.info("=" * 60)

    # Create project directory structure
    dirs = ["analysis", "images", "videos", "audio", "audio/tts", "final"]
    for d in dirs:
        os.makedirs(os.path.join(state.project_dir, d), exist_ok=True)
    logger.info("Created project dirs: %s", state.project_dir)

    # Detect genre if not already set
    if not state.genre and state.concept:
        if detect_genre is not None:
            state.genre = detect_genre(state.concept)
        else:
            state.genre = "cinematic"
    logger.info("Concept: %s", state.concept)
    logger.info("Genre:   %s", state.genre)
    logger.info("Backend: %s", state.backend)
    logger.info("Target:  %ds, %d scenes", state.target_duration, state.scene_count)

    # Persist to DB (best-effort)
    try:
        from db_unified import get_or_create_project, save_screenplay

        project = get_or_create_project(state.project_slug, state.project_slug)
        save_screenplay(
            project_id=project["id"],
            concept=state.concept,
            genre=state.genre,
            target_duration=state.target_duration,
            scene_count=state.scene_count,
            current_phase="concept",
        )
        logger.info("Saved concept to database (project_id=%s)", project["id"])
    except Exception as exc:
        logger.debug("Could not save to DB: %s", exc)

    state.save()
    return state


def _run_analysis_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """COPY-to-Film path: print analyze_video.py command."""

    logger.info("=" * 60)
    logger.info("Phase: ANALYSIS (COPY-to-Film)")
    logger.info("=" * 60)

    if not state.reference_video:
        logger.info("No reference video — skipping analysis phase.")
        return state

    analysis_output = os.path.join(state.project_dir, "analysis", "sealcam_analysis.json")

    print("\n  Run the following command to analyze the reference video:\n")
    print(
        f"  python {_scripts_dir()}/analyze_video.py \\\n"
        f"    --video \"{state.reference_video}\" \\\n"
        f"    --output \"{analysis_output}\"\n"
    )
    print("  Then resume with:")
    print(
        f"  python film_pipeline.py --project {state.project_slug} "
        f"--resume-from screenplay\n"
    )

    state.save()
    return state


def _run_screenplay_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Generate screenplay via Gemini or from SEALCAM+ analysis."""

    logger.info("=" * 60)
    logger.info("Phase: SCREENPLAY")
    logger.info("=" * 60)

    screenplay_output = os.path.join(state.project_dir, "analysis", "screenplay.json")

    if state.reference_video:
        # COPY-to-Film path
        analysis_path = os.path.join(state.project_dir, "analysis", "sealcam_analysis.json")
        if not os.path.exists(analysis_path):
            raise ScreenplayError(
                f"SEALCAM+ analysis not found at {analysis_path}. "
                f"Run the analysis phase first."
            )

        if screenplay_from_analysis is None:
            raise ScreenplayError(
                "screenplay_generator module not available. "
                "Ensure screenplay_generator.py exists."
            )

        logger.info("Converting SEALCAM+ analysis to screenplay...")
        screenplay = screenplay_from_analysis(
            analysis=analysis_path,
            new_subject=state.new_subject,
        )
    else:
        # Top-down path
        if generate_screenplay is None:
            raise ScreenplayError(
                "screenplay_generator module not available. "
                "Ensure screenplay_generator.py exists."
            )

        logger.info("Generating screenplay from concept: '%s'", state.concept[:80])
        screenplay = generate_screenplay(
            concept=state.concept,
            duration=state.target_duration,
            scene_count=state.scene_count,
            genre=state.genre or None,
        )

    # Validate
    if validate_screenplay is not None:
        errors = validate_screenplay(screenplay)
        if errors:
            logger.warning("Screenplay validation warnings: %s", errors)

    # Save to file
    if save_screenplay_to_file is not None:
        save_screenplay_to_file(screenplay, screenplay_output)
    else:
        os.makedirs(os.path.dirname(screenplay_output), exist_ok=True)
        with open(screenplay_output, "w") as f:
            json.dump(screenplay.to_dict(), f, indent=2)
        logger.info("Wrote screenplay to %s", screenplay_output)

    state.screenplay_path = screenplay_output
    state.genre = screenplay.genre
    state.scene_count = len(screenplay.scenes)
    state.target_duration = screenplay.target_duration

    # Auto-create style bible from genre
    if state.genre:
        bible = create_style_bible(state.genre)
        bible_path = os.path.join(state.project_dir, "analysis", "style_bible.json")
        save_style_bible(bible, bible_path)
        logger.info("Created style bible: %s → %s", state.genre, bible_path)

    # Print summary
    print(f"\n{'='*60}")
    print(f"Screenplay: {screenplay.concept[:70]}")
    print(
        f"Genre: {screenplay.genre} | Duration: {screenplay.total_duration()}s | "
        f"Scenes: {len(screenplay.scenes)}"
    )
    if screenplay.hero_subject:
        print(f"Hero: {screenplay.hero_subject}")
    print(f"{'='*60}")
    for scene in screenplay.scenes:
        kf_count = len(scene.keyframes)
        chars = ", ".join(scene.characters_present) if scene.characters_present else "—"
        print(f"  Scene {scene.scene_number} ({scene.duration_seconds}s) @ {scene.location}")
        print(f"    {scene.description[:80]}")
        print(f"    Characters: {chars} | Keyframes: {kf_count}")
    print(f"{'='*60}\n")

    state.save()
    return state


def _run_characters_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Extract characters from screenplay, print Go Bananas create_character commands."""

    logger.info("=" * 60)
    logger.info("Phase: CHARACTERS")
    logger.info("=" * 60)

    if not state.screenplay_path or not os.path.exists(state.screenplay_path):
        raise CharacterDesignError(
            f"Screenplay not found at {state.screenplay_path}. "
            f"Run the screenplay phase first."
        )

    with open(state.screenplay_path) as f:
        sp_data = json.load(f)

    if Screenplay is not None:
        screenplay = Screenplay.from_dict(sp_data)
    else:
        screenplay = None

    characters_output = os.path.join(state.project_dir, "analysis", "characters.json")

    if extract_characters is not None and screenplay is not None:
        logger.info("Extracting characters from screenplay...")
        characters = extract_characters(screenplay)

        if assign_voices is not None:
            characters = assign_voices(characters)

        if create_character_references is not None:
            style = "cinematic" if state.genre in ("cinematic", "drama", "vfx") else state.genre
            refs = create_character_references(characters, style=style, project_dir=state.project_dir)
            print("\n  Go Bananas MCP commands for character references:")
            print("  " + "-" * 56)
            for ref in refs:
                print(f"  {ref}")
            print()

        if write_characters_json is not None:
            write_characters_json(characters, state.project_dir)
            state.characters_path = characters_output
            logger.info("Wrote characters to %s", characters_output)
    else:
        # Fallback: extract character names from screenplay JSON
        logger.info("character_designer module not available — extracting names from screenplay.")
        all_chars: list[str] = []
        for scene in sp_data.get("scenes", []):
            for ch in scene.get("characters_present", []):
                if ch not in all_chars:
                    all_chars.append(ch)

        characters_data = {"characters": [{"name": c} for c in all_chars]}
        os.makedirs(os.path.dirname(characters_output), exist_ok=True)
        with open(characters_output, "w") as f:
            json.dump(characters_data, f, indent=2)
        state.characters_path = characters_output

        if all_chars:
            print(f"\n  Detected characters: {', '.join(all_chars)}")
            print("\n  Create Go Bananas character references for each character:")
            print("  " + "-" * 56)
            for ch in all_chars:
                print(
                    f"  mcp__go-bananas__create_character("
                    f"name=\"{ch}\", "
                    f"prompt=\"Full-body portrait of {ch}, {state.genre} style\", "
                    f"model_id=\"gemini-pro-image\")"
                )
            print()
            print("  After creating characters, save their IDs:")
            print(
                f"  python {_scripts_dir()}/generate_storyboard.py "
                f"--project \"{state.project_slug}\" "
                f"--save-character-ids <ID1,ID2,...>"
            )
        else:
            logger.info("No characters found in screenplay.")

    print()
    state.save()
    return state


def _run_breakdown_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Backend-aware scene breakdown: screenplay -> per-scene prompts."""

    logger.info("=" * 60)
    logger.info("Phase: BREAKDOWN (backend=%s)", state.backend)
    logger.info("=" * 60)

    if not state.screenplay_path or not os.path.exists(state.screenplay_path):
        raise ScreenplayError(
            f"Screenplay not found at {state.screenplay_path}. "
            f"Run the screenplay phase first."
        )

    with open(state.screenplay_path) as f:
        sp_data = json.load(f)

    if Screenplay is not None:
        screenplay = Screenplay.from_dict(sp_data)
    else:
        screenplay = None

    breakdown_output = os.path.join(state.project_dir, "analysis", "scene_breakdown.json")
    f2v_scenes_output = os.path.join(state.project_dir, "analysis", "f2v_scenes.json")

    # Load style bible if available
    style_bible = None
    bible_path = os.path.join(state.project_dir, "analysis", "style_bible.json")
    if os.path.exists(bible_path):
        style_bible = load_style_bible(bible_path)
        logger.info("Loaded style bible: %s", style_bible.style_tag)

    if breakdown_screenplay is not None and screenplay is not None:
        logger.info("Breaking down screenplay into per-scene prompts...")
        breakdowns = breakdown_screenplay(
            screenplay=screenplay,
            backend=state.backend,
            genre=state.genre,
            style_bible=style_bible,
        )

        if write_breakdown_outputs is not None:
            write_breakdown_outputs(breakdowns, state.project_dir)
            state.breakdown_path = f2v_scenes_output
            logger.info("Wrote breakdown to %s", f2v_scenes_output)
        else:
            os.makedirs(os.path.dirname(breakdown_output), exist_ok=True)
            with open(breakdown_output, "w") as f:
                json.dump(breakdowns, f, indent=2)
            state.breakdown_path = breakdown_output
    else:
        # Fallback: generate minimal f2v_scenes.json from screenplay scenes
        logger.info("scene_breakdown module not available — generating minimal f2v_scenes.json.")
        scenes_dict = {}
        for scene in sp_data.get("scenes", []):
            num = scene.get("scene_number", 1)
            desc = scene.get("description", "")
            scenes_dict[str(num)] = desc

        os.makedirs(os.path.dirname(f2v_scenes_output), exist_ok=True)
        with open(f2v_scenes_output, "w") as f:
            json.dump(scenes_dict, f, indent=2)
        state.breakdown_path = f2v_scenes_output
        logger.info("Wrote fallback f2v_scenes.json to %s", f2v_scenes_output)

    # Print the breakdown summary
    if state.breakdown_path and os.path.exists(state.breakdown_path):
        with open(state.breakdown_path) as f:
            bd = json.load(f)
        scene_keys = sorted(bd.keys(), key=lambda k: int(k))
        print(f"\n  Scene breakdown ({len(scene_keys)} scenes, backend={state.backend}):")
        print("  " + "-" * 56)
        for k in scene_keys:
            prompt_text = bd[k] if isinstance(bd[k], str) else bd[k].get("prompt", str(bd[k]))
            print(f"  Scene {k}: {prompt_text[:70]}...")
        print()

    state.save()
    return state


def _run_images_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Print Go Bananas generate_image MCP commands for each scene."""

    logger.info("=" * 60)
    logger.info("Phase: IMAGES")
    logger.info("=" * 60)

    if not state.breakdown_path or not os.path.exists(state.breakdown_path):
        logger.warning("No scene breakdown found — cannot generate image commands.")
        state.save()
        return state

    with open(state.breakdown_path) as f:
        bd = json.load(f)

    # Load characters.json if available for character_ids
    character_ids_str = ""
    chars_path = os.path.join(state.project_dir, "analysis", "characters.json")
    if os.path.exists(chars_path):
        with open(chars_path) as f:
            chars_data = json.load(f)
        ids = []
        for ch in chars_data.get("characters", []):
            if "go_bananas_id" in ch:
                ids.append(str(ch["go_bananas_id"]))
        if ids:
            character_ids_str = f", character_ids=[{', '.join(ids)}]"

    images_dir = os.path.join(state.project_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    scene_keys = sorted(bd.keys(), key=lambda k: int(k))
    print(f"\n  Generate first-frame images for {len(scene_keys)} scenes:")
    print("  " + "-" * 56)

    for k in scene_keys:
        entry = bd[k]
        if isinstance(entry, dict):
            image_prompt = entry.get("image_prompt", entry.get("prompt", ""))
        else:
            image_prompt = str(entry)

        # Truncate for display, use full prompt in command
        display = image_prompt[:60]
        print(
            f"\n  # Scene {k}\n"
            f"  mcp__go-bananas__generate_image(\n"
            f"      prompt=\"{display}...\",\n"
            f"      aspect_ratio=\"16:9\"{character_ids_str},\n"
            f"      model_id=\"gemini-pro-image\"\n"
            f"  )"
        )

    print(
        f"\n  After downloading images, save them to:\n"
        f"    {images_dir}/run001_scene_N_frame.jpg\n"
    )

    state.save()
    return state


def _run_videos_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Print parallel_video_gen.py command."""

    logger.info("=" * 60)
    logger.info("Phase: VIDEOS (backend=%s)", state.backend)
    logger.info("=" * 60)

    images_dir = os.path.join(state.project_dir, "images")
    f2v_scenes = state.breakdown_path or os.path.join(state.project_dir, "analysis", "f2v_scenes.json")

    if not os.path.exists(f2v_scenes):
        logger.warning("No f2v_scenes.json found — cannot print video gen command.")
        state.save()
        return state

    # Build the command
    cmd_parts = [
        f"python {_scripts_dir()}/parallel_video_gen.py",
        f"  --product \"{state.project_slug}\"",
        f"  --backend {state.backend}",
        f"  --mode frames-to-video",
        f"  --images-dir \"{images_dir}\"",
        f"  --scenes-file \"{f2v_scenes}\"",
        f"  --ratio landscape",
        f"  --quality fast",
        f"  --variations 1",
    ]

    if state.backend == "seedance":
        # Seedance-specific: add duration
        avg_dur = state.target_duration // max(state.scene_count, 1)
        dur = max(4, min(15, avg_dur))
        cmd_parts.append(f"  --duration {dur}")

    cmd_parts.append("  --yes")

    print("\n  Generate videos:\n")
    print("  " + " \\\n  ".join(cmd_parts))
    print()

    state.save()
    return state


def _run_audio_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Print TTS and music generation commands."""

    logger.info("=" * 60)
    logger.info("Phase: AUDIO")
    logger.info("=" * 60)

    tts_dir = os.path.join(state.project_dir, "audio", "tts")
    os.makedirs(tts_dir, exist_ok=True)

    # Check if editable_transcript.json exists
    transcript_path = os.path.join(tts_dir, "editable_transcript.json")
    screenplay_path = state.screenplay_path or os.path.join(
        state.project_dir, "analysis", "screenplay.json"
    )

    print("\n  1) Generate narration script from screenplay (if not already done):\n")
    print(
        f"     python {_scripts_dir()}/generate_narration_script.py \\\n"
        f"       --slides-json \"{screenplay_path}\" \\\n"
        f"       --output \"{transcript_path}\" \\\n"
        f"       --style professional\n"
    )

    print("  2) Generate TTS narration:\n")
    print(
        f"     python {_scripts_dir()}/generate_tts.py \\\n"
        f"       --edit \"{transcript_path}\" \\\n"
        f"       --output-dir \"{tts_dir}\" \\\n"
        f"       --voice-name \"Rachel\" --yes\n"
    )

    # Music generation
    music_duration = state.target_duration
    # Round up to nearest 30s
    music_duration = ((music_duration + 29) // 30) * 30

    print("  3) Generate background music:\n")
    print(
        f"     python {_scripts_dir()}/generate_music.py \\\n"
        f"       --prompt \"{state.genre} cinematic, emotional\" \\\n"
        f"       --duration {music_duration} \\\n"
        f"       --output \"{os.path.join(state.project_dir, 'audio', 'background.mp3')}\"\n"
    )

    state.save()
    return state


def _run_stitch_phase(state: FilmState, dry_run: bool = False) -> FilmState:
    """Print stitch_video.py command."""

    logger.info("=" * 60)
    logger.info("Phase: STITCH")
    logger.info("=" * 60)

    videos_dir = os.path.join(state.project_dir, "videos")
    audio_path = os.path.join(state.project_dir, "audio", "background.mp3")
    output_path = os.path.join(
        state.project_dir, "final", f"{state.project_slug}_film.mp4"
    )

    print("\n  Stitch final video:\n")
    print(
        f"  python {_scripts_dir()}/stitch_video.py \\\n"
        f"    --videos-dir \"{videos_dir}\" \\\n"
        f"    --audio \"{audio_path}\" \\\n"
        f"    --output \"{output_path}\" \\\n"
        f"    --narrated\n"
    )

    state.save()
    return state


# ============================================================================
# Status Display
# ============================================================================


def print_pipeline_status(state: FilmState) -> None:
    """Print a summary of the current pipeline state."""

    print(f"\n{'='*60}")
    print(f"  Film Pipeline Status: {state.project_slug}")
    print(f"{'='*60}")
    print(f"  Project dir:   {state.project_dir}")
    print(f"  Backend:       {state.backend}")
    print(f"  Current phase: {state.current_phase}")

    if state.concept:
        print(f"  Concept:       {state.concept[:60]}")
    if state.genre:
        print(f"  Genre:         {state.genre}")
    print(f"  Target:        {state.target_duration}s, {state.scene_count} scenes")

    if state.reference_video:
        print(f"  Reference:     {state.reference_video}")
    if state.new_subject:
        print(f"  New subject:   {state.new_subject}")

    # Phase checklist
    print(f"\n  Phases:")
    current_idx = FILM_PHASES.index(state.current_phase) if state.current_phase in FILM_PHASES else -1
    for i, phase in enumerate(FILM_PHASES):
        if i < current_idx:
            marker = "[x]"
        elif i == current_idx:
            marker = "[>]"
        else:
            marker = "[ ]"
        print(f"    {marker} {phase}")

    # Artifacts
    print(f"\n  Artifacts:")
    artifacts = [
        ("Screenplay", state.screenplay_path),
        ("Characters", state.characters_path),
        ("Breakdown", state.breakdown_path),
    ]
    for name, path in artifacts:
        if path and os.path.exists(path):
            size = os.path.getsize(path)
            print(f"    {name}: {path} ({size:,} bytes)")
        elif path:
            print(f"    {name}: {path} (MISSING)")
        else:
            print(f"    {name}: —")

    # Errors
    if state.errors:
        print(f"\n  Errors ({len(state.errors)}):")
        for err in state.errors:
            print(f"    - {err}")

    print(f"{'='*60}\n")


# ============================================================================
# Helpers
# ============================================================================


def _scripts_dir() -> str:
    """Return the absolute path to the scripts directory."""
    return str(Path(__file__).resolve().parent)


# ============================================================================
# CLI
# ============================================================================


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Film Pipeline — concept-to-video production orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  # Top-down: concept -> film (Seedance)
  python film_pipeline.py --concept "30s smartwatch ad" --project test \\
    --duration 30 --scenes 6 --backend seedance --dry-run

  # Top-down: concept -> film (Veo via useapi)
  python film_pipeline.py --concept "30s smartwatch ad" --project test \\
    --duration 30 --scenes 6 --backend useapi --dry-run

  # COPY-to-Film: reference video -> reproduce
  python film_pipeline.py --reference-video "input.mp4" --project test-copy \\
    --backend seedance --new-subject "A young woman in red dress"

  # Resume from any phase
  python film_pipeline.py --project test --resume-from breakdown

  # Check pipeline status
  python film_pipeline.py --project test --status

  # Bottom-up enhance with existing frames
  python film_pipeline.py --project test --enhance-with-frames "projects/test/images"
""",
    )

    # Entry-point arguments (mutually exclusive groups)
    parser.add_argument("--concept", help="One-line concept for top-down pipeline")
    parser.add_argument("--reference-video", help="Reference video for COPY-to-Film pipeline")

    # Project
    parser.add_argument("--project", required=True, help="Project slug (directory name)")

    # Configuration
    parser.add_argument("--duration", type=int, default=60, help="Target duration in seconds (default: 60)")
    parser.add_argument("--scenes", type=int, default=8, help="Number of scenes (default: 8)")
    parser.add_argument("--genre", help="Genre override (auto-detected if omitted)")
    parser.add_argument(
        "--backend",
        choices=FILM_SUPPORTED_BACKENDS,
        default="seedance",
        help="Video generation backend (default: seedance)",
    )
    parser.add_argument("--new-subject", help="Replace subject in COPY-to-Film mode")

    # Control flow
    parser.add_argument("--resume-from", choices=FILM_PHASES, help="Resume from a specific phase")
    parser.add_argument("--status", action="store_true", help="Show current pipeline status")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without executing")
    parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation prompts, auto-continue through manual phases")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")

    # Bottom-up integration
    parser.add_argument(
        "--enhance-with-frames",
        metavar="DIR",
        help="Bottom-up: enhance existing frames with story engine (prints integration commands)",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    # Set up logging
    global logger
    logger = setup_logging("film_pipeline", verbose=args.verbose)

    # Status check
    if args.status:
        state = get_pipeline_state(args.project)
        if state:
            print_pipeline_status(state)
        else:
            logger.info("No pipeline state found for project '%s'.", args.project)
        return

    # Bottom-up enhance
    if args.enhance_with_frames:
        logger.info("Bottom-up enhancement with existing frames:")
        logger.info("  Frames dir: %s", args.enhance_with_frames)
        print(
            f"\n  To integrate with the film pipeline, run:\n\n"
            f"  python film_pipeline.py --project {args.project} "
            f"--concept \"<describe the story>\" "
            f"--resume-from breakdown --backend {args.backend}\n"
        )
        return

    # Validate entry point
    if not args.concept and not args.reference_video and not args.resume_from:
        parser.error(
            "Provide --concept (top-down), --reference-video (COPY-to-Film), "
            "or --resume-from (resume existing pipeline)"
        )

    # Resume without concept or reference video
    if args.resume_from and not args.concept and not args.reference_video:
        state = get_pipeline_state(args.project)
        if state is None:
            parser.error(
                f"No existing pipeline state for project '{args.project}'. "
                f"Provide --concept or --reference-video to start a new pipeline."
            )
        state.backend = args.backend
        try:
            result = _execute_pipeline(
                state,
                resume_from=args.resume_from,
                dry_run=args.dry_run,
                yes=args.yes,
            )
        except (ScreenplayError, CharacterDesignError, ValueError) as exc:
            logger.error("Pipeline error: %s", exc)
            sys.exit(1)
        print_pipeline_status(result)
        return

    # Run the pipeline
    try:
        if args.reference_video:
            result = run_pipeline_from_video(
                reference_video=args.reference_video,
                project_slug=args.project,
                new_subject=args.new_subject,
                backend=args.backend,
                resume_from=args.resume_from,
                dry_run=args.dry_run,
                yes=args.yes,
            )
        else:
            result = run_pipeline(
                concept=args.concept,
                project_slug=args.project,
                duration=args.duration,
                scene_count=args.scenes,
                genre=args.genre,
                backend=args.backend,
                resume_from=args.resume_from,
                dry_run=args.dry_run,
                yes=args.yes,
            )
    except (ScreenplayError, CharacterDesignError, ValueError) as exc:
        logger.error("Pipeline error: %s", exc)
        sys.exit(1)

    print_pipeline_status(result)


if __name__ == "__main__":
    main()
