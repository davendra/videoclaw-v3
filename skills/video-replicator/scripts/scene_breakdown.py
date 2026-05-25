#!/usr/bin/env python3
"""
Scene Breakdown — convert screenplay keyframes into backend-specific video prompts.

Wave 3 of the v2.37 Film Pipeline. Seedance gets time-segmented prompts
(0-3s, 3-6s format). Veo gets flat SEALCAM prompts. Same screenplay, different output.

Usage:
    from scene_breakdown import breakdown_screenplay, SceneBreakdown, write_breakdown_outputs

    breakdowns = breakdown_screenplay(screenplay, backend="seedance", genre="fight")
    write_breakdown_outputs(breakdowns, "projects/my-project")

CLI:
    python scene_breakdown.py --screenplay screenplay.json --backend seedance --project test
    python scene_breakdown.py --screenplay screenplay.json --backend useapi
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import FILM_SUPPORTED_BACKENDS, GENRE_PRESETS, PROJECT_BASE, SEEDANCE_TIME_SEGMENT_THRESHOLD
from exceptions import ScreenplayError
from prompt_template import build_character_tag, build_shot_prompt
from screenplay_generator import Keyframe, Screenplay, ScreenplayScene, extract_hero_subject
from seedance_prompt_builder import (
    CAMERA_VOCABULARY,
    STYLE_TOKENS,
    append_negative_prompts,
    build_cinematic_prompt,
    build_time_segments,
    enhance_with_style,
    get_camera_fragment,
)

logger = logging.getLogger("scene_breakdown")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s | %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


# ============================================================================
# Data Classes
# ============================================================================


@dataclass
class SceneBreakdown:
    """Result of breaking down a single screenplay scene into backend-specific prompts."""

    scene_number: int
    prompt: str                    # Backend-specific video generation prompt
    duration: int | None           # Seedance: explicit duration. Veo: None
    description: str               # Human-readable scene description (for dashboard)
    image_prompt: str              # Go Bananas prompt for first frame image
    mode: str                      # frames-to-video, text-to-video, audio-lipsync
    dialogue: str | None = None    # Optional lip-sync dialogue text
    audio_path: str | None = None  # Seedance audio-lipsync only
    motion_ref: str | None = None  # Seedance motion-transfer only

    def to_dict(self) -> dict:
        return {
            "prompt": self.prompt,
            "duration": self.duration,
            "description": self.description,
            "image_prompt": self.image_prompt,
            "mode": self.mode,
            "dialogue": self.dialogue,
            "audio_path": self.audio_path,
            "motion_ref": self.motion_ref,
        }


# ============================================================================
# Main Entry Point
# ============================================================================


def breakdown_screenplay(
    screenplay: Screenplay,
    backend: str = "seedance",
    genre: str | None = None,
    style_bible: object | None = None,
    characters: list[dict] | None = None,
) -> list[SceneBreakdown]:
    """Main entry point. Convert screenplay into list of SceneBreakdowns.

    backend: "seedance", "direct", or "useapi"
    genre: Optional override. Uses screenplay.genre if None.
    """
    if backend not in FILM_SUPPORTED_BACKENDS:
        raise ValueError(
            f"Unsupported backend '{backend}'. Supported: {FILM_SUPPORTED_BACKENDS}"
        )
    if not screenplay.scenes:
        raise ScreenplayError("Screenplay has no scenes to break down")

    effective_genre = genre or screenplay.genre or "cinematic"
    hero_subject = screenplay.hero_subject or extract_hero_subject(screenplay)

    # Extract style tag and character tags for prompt template
    style_tag = ""
    if style_bible and hasattr(style_bible, "style_tag"):
        style_tag = style_bible.style_tag

    character_tags: list[str] = []
    if characters:
        for ch in characters:
            tag = build_character_tag(ch)
            if tag:
                character_tags.append(tag)

    # Genre-specific keywords for prompt enrichment
    genre_preset = GENRE_PRESETS.get(effective_genre, {})
    genre_camera = genre_preset.get("camera_keywords", "")
    genre_lighting = genre_preset.get("lighting_keywords", "")

    logger.info(
        "Breaking down screenplay: %d scenes, backend=%s, genre=%s, hero='%s'",
        len(screenplay.scenes), backend, effective_genre, hero_subject[:40],
    )

    breakdowns: list[SceneBreakdown] = []
    for scene in screenplay.scenes:
        # --- Backend dispatch ---
        if backend == "seedance":
            raw_prompt = _build_seedance_scene_prompt(scene, effective_genre, hero_subject)
            duration = scene.duration_seconds
        else:  # "direct" or "useapi"
            raw_prompt = _build_veo_scene_prompt(scene, hero_subject)
            duration = None

        # Apply prompt template: append character tags + style tag
        prompt = build_shot_prompt(
            visual_prompt=raw_prompt,
            character_tags=character_tags if character_tags else None,
            style_tag=style_tag if style_tag else None,
        )

        breakdowns.append(SceneBreakdown(
            scene_number=scene.scene_number,
            prompt=prompt,
            duration=duration,
            description=scene.description,
            image_prompt=build_image_prompt(scene, hero_subject),
            mode=scene.mode,
            dialogue=scene.dialogue,
        ))

    logger.info("Breakdown complete: %d scenes", len(breakdowns))
    return breakdowns


# ============================================================================
# Seedance Path
# ============================================================================


def _build_seedance_scene_prompt(
    scene: ScreenplayScene, genre: str, hero_subject: str,
) -> str:
    """Build a complete Seedance prompt. Falls back to build_cinematic_prompt()
    when no keyframes are present."""
    if not scene.keyframes:
        logger.debug("Scene %d: no keyframes, using fallback", scene.scene_number)
        return build_cinematic_prompt(
            description=scene.description, duration=scene.duration_seconds, genre=genre,
        )

    segments = keyframes_to_time_segments(scene.keyframes, scene.duration_seconds, genre)
    return build_seedance_prompt_from_segments(
        segments, scene.description, hero_subject, genre,
    )


def keyframes_to_time_segments(
    keyframes: list[Keyframe], duration: int, genre: str | None = None,
) -> str:
    """Convert keyframes to Seedance time-segment format.

    Output:
        0-3s: Camera pushes in steadily, two warriors face each other, dramatic backlight
        3-6s: Quick whip pan, swords clash with sparks, flashing steel
        6-8s: Slow crane up, aftermath revealed, volumetric smoke
    """
    if not keyframes:
        return ""

    lines: list[str] = []
    for i, kf in enumerate(keyframes):
        camera_desc = _resolve_camera(kf.camera)
        parts = [p for p in [camera_desc, kf.action, kf.lighting] if p and p.strip()]
        parts = [p.strip() for p in parts]
        segment_content = ", ".join(parts) if parts else "scene continues"

        # Use keyframe's time field or compute from position
        time_label = kf.time
        if not time_label:
            seg_dur = duration / len(keyframes)
            start = int(i * seg_dur)
            end = int((i + 1) * seg_dur) if i < len(keyframes) - 1 else duration
            time_label = f"{start}-{end}s"
        elif not time_label.endswith("s"):
            time_label = f"{time_label}s"

        lines.append(f"{time_label}: {segment_content}")

    return "\n".join(lines)


def _resolve_camera(camera_text: str) -> str:
    """Resolve camera text through CAMERA_VOCABULARY. Tries exact key, normalized
    key, substring match, then falls back to raw text."""
    if not camera_text:
        return ""
    camera_text = camera_text.strip()

    # Exact match
    fragment = get_camera_fragment(camera_text)
    if fragment:
        return fragment

    # Normalized key (spaces/hyphens -> underscores, lowercase)
    normalized = re.sub(r"[\s\-]+", "_", camera_text.lower())
    fragment = get_camera_fragment(normalized)
    if fragment:
        return fragment

    # Substring match against vocabulary keys
    text_lower = camera_text.lower()
    for key in CAMERA_VOCABULARY:
        readable_key = key.replace("_", " ")
        if readable_key in text_lower or key in text_lower:
            return CAMERA_VOCABULARY[key]["fragment"]

    return camera_text


def build_seedance_prompt_from_segments(
    segments: str, scene_desc: str, hero_subject: str, genre: str | None = None,
) -> str:
    """Produce full Seedance prompt: header + time segments + style + negatives."""
    effective_genre = genre or "cinematic"
    desc_clean = scene_desc.rstrip(".")

    header = f"{hero_subject}. {desc_clean}." if hero_subject else f"{desc_clean}."
    prompt = f"{header}\n{segments}"

    style_genre = effective_genre if effective_genre in STYLE_TOKENS else "cinematic"
    prompt = enhance_with_style(prompt, style_genre)
    prompt = append_negative_prompts(prompt, effective_genre)
    return prompt


# ============================================================================
# Veo Path
# ============================================================================


def _build_veo_scene_prompt(scene: ScreenplayScene, hero_subject: str) -> str:
    """Build a Veo prompt. T2V gets full description; I2V gets motion only."""
    if not scene.keyframes:
        desc = scene.description.rstrip(".")
        base = f"{hero_subject}. {desc}" if hero_subject else desc
        return f"{base}. Cinematic quality, smooth camera motion."

    if scene.mode == "text-to-video":
        return build_veo_prompt_t2v(scene.keyframes, scene.description, hero_subject)
    return build_veo_prompt_i2v(scene.keyframes, scene.description)


def build_veo_prompt_t2v(
    keyframes: list[Keyframe], scene_desc: str, hero_subject: str,
) -> str:
    """Flat SEALCAM prompt for Veo T2V. Collapses all keyframes into single
    rich description. No time segments (Veo ignores 0-3s syntax)."""
    if not keyframes:
        desc = scene_desc.rstrip(".")
        return f"{hero_subject}. {desc}." if hero_subject else f"{desc}."

    parts: list[str] = []
    if hero_subject:
        parts.append(hero_subject)

    camera_parts: list[str] = []
    action_parts: list[str] = []
    lighting_parts: list[str] = []

    for kf in keyframes:
        cam = _resolve_camera(kf.camera)
        if cam and cam not in camera_parts:
            camera_parts.append(cam)
        if kf.action and kf.action not in action_parts:
            action_parts.append(kf.action.strip())
        if kf.lighting and kf.lighting not in lighting_parts:
            lighting_parts.append(kf.lighting.strip())

    parts.append(scene_desc.rstrip("."))

    # Camera movements (limit to 2 most distinctive)
    if camera_parts:
        parts.append(", then ".join(camera_parts[:2]))

    # Add actions not already in scene description
    scene_lower = scene_desc.lower()
    for action in action_parts:
        action_words = set(action.lower().split())
        desc_words = set(scene_lower.split())
        if len(action_words & desc_words) < len(action_words) * 0.5:
            parts.append(action.rstrip("."))

    if lighting_parts:
        parts.append(lighting_parts[0])

    prompt = ". ".join(parts).rstrip(".") + "."
    return _deduplicate_prompt(prompt)


def build_veo_prompt_i2v(keyframes: list[Keyframe], scene_desc: str) -> str:
    """Flat SEALCAM prompt for Veo I2V. Motion instructions ONLY -- don't
    re-describe what's in the start frame. Focus on camera + action changes."""
    if not keyframes:
        return "Smooth cinematic camera motion with natural movement."

    motion_parts: list[str] = []
    for kf in keyframes:
        cam = _resolve_camera(kf.camera)
        if cam:
            motion_parts.append(cam)
        if kf.action and _is_dynamic_action(kf.action.strip()):
            motion_parts.append(kf.action.strip().rstrip("."))

    if not motion_parts:
        return "Smooth cinematic camera motion with natural movement."

    if len(motion_parts) <= 2:
        return ", ".join(motion_parts) + "."
    initial = ", ".join(motion_parts[:2])
    remaining = ", then ".join(motion_parts[2:])
    return f"{initial}, then {remaining}."


# ============================================================================
# Shared Helpers
# ============================================================================

# Dynamic verb patterns for filtering I2V actions
_DYNAMIC_RE = re.compile(
    r"\b(moves?|runs?|walks?|jumps?|falls?|flies?|rises?|drops?|"
    r"clash|strike|swing|spin|turn|shift|transform|explode|"
    r"approach|retreat|advance|charge|dodge|lean|"
    r"push|pull|sweep|pan|tilt|track|orbit|crane|dolly|"
    r"opens?|closes?|reveals?|emerges?|fades?|appears?|"
    r"rushes?|dashes?|sprints?|surges?|swirls?|flows?|ing)\b",
    re.IGNORECASE,
)
_STATIC_RE = re.compile(
    r"\b(standing|sitting|lying|positioned|visible|present)\b|\b(is|are|has|have)\s|\bbackground\b",
    re.IGNORECASE,
)


def _is_dynamic_action(action_text: str) -> bool:
    """Check if action is dynamic (movement) vs static (state description)."""
    if _DYNAMIC_RE.search(action_text):
        return True
    if _STATIC_RE.search(action_text):
        return False
    return len(action_text.split()) <= 6


def _deduplicate_prompt(prompt: str) -> str:
    """Remove repeated sentences from a prompt (40% novelty threshold)."""
    sentences = [s.strip() for s in prompt.split(". ") if s.strip()]
    if len(sentences) <= 1:
        return prompt

    seen_words: set[str] = set()
    unique: list[str] = []
    for sentence in sentences:
        words = set(sentence.lower().split())
        new_words = words - seen_words
        if len(new_words) >= max(1, len(words) * 0.4):
            unique.append(sentence)
            seen_words |= words

    result = ". ".join(unique)
    return result if result.endswith(".") else result + "."


def build_image_prompt(
    scene: ScreenplayScene,
    hero_subject: str,
    characters: list[dict] | None = None,
    style: str = "",
) -> str:
    """Build Go Bananas prompt for first frame image. Includes 'WIDE HORIZONTAL
    shot' for landscape compatibility. Uses first keyframe's action + lighting."""
    parts: list[str] = ["WIDE HORIZONTAL shot, cinematic widescreen"]

    if scene.location:
        parts.append(f"set in {scene.location}")

    # Characters / hero subject
    if characters:
        char_descs = []
        for c in characters:
            name, desc = c.get("name", ""), c.get("description", "")
            char_descs.append(f"{name} ({desc})" if name and desc else name or desc)
        if char_descs:
            parts.append(", ".join(char_descs))
    elif scene.characters_present:
        parts.append(", ".join(scene.characters_present))
    elif hero_subject:
        parts.append(hero_subject)

    # Visual context from first keyframe
    if scene.keyframes:
        kf = scene.keyframes[0]
        if kf.action:
            parts.append(kf.action.strip())
        if kf.lighting:
            parts.append(kf.lighting.strip())
    else:
        parts.append(scene.description.rstrip("."))

    if style:
        parts.append(style)

    return ", ".join(parts).rstrip(",. ") + "."


# ============================================================================
# Output Writers
# ============================================================================


def write_breakdown_outputs(
    breakdowns: list[SceneBreakdown],
    project_dir: str,
    save_to_db: bool = True,
) -> dict:
    """Write f2v_scenes.json + f2v_prompts.json and optionally save to DB.

    f2v_scenes.json: full breakdown per scene (backward-compatible).
    f2v_prompts.json: {"1": "prompt", "2": "prompt"} for --scenes flag.
    """
    scenes_dict = {str(bd.scene_number): bd.to_dict() for bd in breakdowns}

    analysis_dir = os.path.join(project_dir, "analysis")
    os.makedirs(analysis_dir, exist_ok=True)

    output_path = os.path.join(analysis_dir, "f2v_scenes.json")
    with open(output_path, "w") as f:
        json.dump(scenes_dict, f, indent=2)
    logger.info("Wrote %d scene breakdowns to %s", len(breakdowns), output_path)

    prompts_path = os.path.join(analysis_dir, "f2v_prompts.json")
    scenes_prompts = {str(bd.scene_number): bd.prompt for bd in breakdowns}
    with open(prompts_path, "w") as f:
        json.dump(scenes_prompts, f, indent=2)
    logger.info("Wrote scene prompts to %s", prompts_path)

    if save_to_db:
        _save_breakdowns_to_db(breakdowns, project_dir)

    return {
        "output_path": output_path,
        "prompts_path": prompts_path,
        "scene_count": len(breakdowns),
        "scenes": scenes_dict,
    }


def _save_breakdowns_to_db(breakdowns: list[SceneBreakdown], project_dir: str) -> None:
    """Save breakdown metadata to the database."""
    try:
        from db_unified import get_or_create_project, save_screenplay

        slug = os.path.basename(project_dir.rstrip("/"))
        project = get_or_create_project(slug, slug)
        project_id = project.get("id") if isinstance(project, dict) else project

        breakdown_data = {str(bd.scene_number): bd.to_dict() for bd in breakdowns}
        save_screenplay(
            project_id=project_id,
            concept="",
            screenplay_json=json.dumps({"breakdowns": breakdown_data}),
            current_phase="breakdown",
        )
        logger.info("Saved breakdowns to database for project '%s'", slug)
    except Exception as e:
        logger.warning("Could not save breakdowns to DB: %s", e)


# ============================================================================
# CLI
# ============================================================================


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Convert screenplay keyframes into backend-specific video prompts.",
    )
    parser.add_argument("--screenplay", required=True, help="Path to screenplay JSON")
    parser.add_argument(
        "--backend", choices=FILM_SUPPORTED_BACKENDS, default="seedance",
        help="Video generation backend (default: seedance)",
    )
    parser.add_argument("--genre", default=None, help="Genre override (applies genre-specific camera/lighting keywords)")
    parser.add_argument("--style-bible", default=None, help="Path to style bible JSON (applies style tag to all prompts)")
    parser.add_argument("--project", default=None, help="Project slug for file output")
    parser.add_argument("--output", "-o", default=None, help="Output JSON path")
    parser.add_argument("--no-db", action="store_true", help="Skip saving to database")
    parser.add_argument("--verbose", "-v", action="store_true", help="Debug logging")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    if not os.path.exists(args.screenplay):
        logger.error("Screenplay file not found: %s", args.screenplay)
        sys.exit(1)

    try:
        with open(args.screenplay) as f:
            screenplay = Screenplay.from_dict(json.load(f))
    except (json.JSONDecodeError, KeyError) as e:
        logger.error("Failed to parse screenplay: %s", e)
        sys.exit(1)

    logger.info(
        "Loaded screenplay: '%s' (%d scenes, %ds, genre=%s)",
        screenplay.concept[:50], len(screenplay.scenes),
        screenplay.total_duration(), screenplay.genre,
    )

    # Load style bible if provided
    style_bible = None
    if args.style_bible:
        from style_bible import load_style_bible
        style_bible = load_style_bible(args.style_bible)
        logger.info("Loaded style bible: %s", style_bible.style_tag)

    breakdowns = breakdown_screenplay(screenplay, args.backend, args.genre, style_bible=style_bible)

    # Output
    if args.output:
        output_dir = os.path.dirname(args.output) or "."
        os.makedirs(output_dir, exist_ok=True)
        scenes_dict = {str(bd.scene_number): bd.to_dict() for bd in breakdowns}
        with open(args.output, "w") as f:
            json.dump(scenes_dict, f, indent=2)
        logger.info("Wrote %d breakdowns to %s", len(breakdowns), args.output)
        result = {"output_path": args.output, "scene_count": len(breakdowns)}
    elif args.project:
        result = write_breakdown_outputs(
            breakdowns, os.path.join(PROJECT_BASE, args.project),
            save_to_db=not args.no_db,
        )
    else:
        scenes_dict = {str(bd.scene_number): bd.to_dict() for bd in breakdowns}
        print(json.dumps(scenes_dict, indent=2))
        result = {"scene_count": len(breakdowns)}

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Scene Breakdown Summary")
    print(f"Backend: {args.backend} | Genre: {args.genre or screenplay.genre}")
    print(f"Scenes: {len(breakdowns)} | Total duration: {screenplay.total_duration()}s")
    print(f"{'=' * 60}")
    for bd in breakdowns:
        dur = f"{bd.duration}s" if bd.duration else "auto"
        preview = bd.prompt[:80].replace("\n", " ")
        print(f"  Scene {bd.scene_number} ({dur}, {bd.mode})")
        print(f"    Prompt: {preview}...")
        if bd.dialogue:
            print(f"    Dialogue: \"{bd.dialogue[:50]}...\"")
    print(f"{'=' * 60}")
    if "output_path" in result:
        print(f"Output: {result['output_path']}")
    if "prompts_path" in result:
        print(f"Prompts: {result['prompts_path']}")
    print()


if __name__ == "__main__":
    main()
