#!/usr/bin/env python3
"""
Screenplay Generator — concept → structured screenplay with keyframes.

Top-down entry point for the Film Pipeline. Takes a one-line concept and
produces a full screenplay with per-scene keyframes (2-5 per scene at ~3s
each), camera vocabulary, lighting, audio, and pacing metadata.

Two paths:
  1. generate_screenplay() — concept → Gemini → Screenplay object
  2. screenplay_from_analysis() — SEALCAM+ JSON → Screenplay (COPY-to-Film)

Usage:
    from screenplay_generator import (
        generate_screenplay,
        screenplay_from_analysis,
        detect_genre,
        extract_hero_subject,
        validate_screenplay,
    )

    # Top-down: concept → screenplay
    sp = generate_screenplay("30-second luxury watch ad", duration=30, scene_count=6)

    # COPY-to-Film: reference video analysis → screenplay
    sp = screenplay_from_analysis(sealcam_json, new_subject="Young woman in red dress")

CLI:
    python screenplay_generator.py --concept "A love story in Paris" --duration 60 --scenes 8
    python screenplay_generator.py --from-analysis analysis.json --new-subject "..."
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Ensure scripts/ is on the Python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    GEMINI_FLASH_MODEL,
    GEMINI_PRO_MODEL,
    PROJECT_BASE,
    STORY_ENGINE_DURATIONS,
    STORY_ENGINE_MAX_SHOTS,
)
from exceptions import ScreenplayError

logger = logging.getLogger("screenplay_generator")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s | %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


# ============================================================================
# Data Classes
# ============================================================================


@dataclass
class Keyframe:
    """A single keyframe within a scene (represents ~3 seconds)."""

    time: str  # e.g. "0-3s", "3-6s"
    camera: str  # e.g. "wide establishing shot, slow crane down"
    action: str  # e.g. "two deities standing apart, golden auras"
    lighting: str  # e.g. "backlit silhouettes"
    audio: str  # e.g. "tension building ambient"
    pacing: str = "medium"  # slow, medium, quick, frenetic


@dataclass
class ScreenplayScene:
    """A single scene in the screenplay."""

    scene_number: int
    duration_seconds: int
    location: str
    description: str
    characters_present: list[str] = field(default_factory=list)
    keyframes: list[Keyframe] = field(default_factory=list)
    dialogue: str | None = None
    mode: str = "frames-to-video"  # text-to-video, frames-to-video, audio-lipsync


@dataclass
class Screenplay:
    """Full screenplay with scenes and metadata."""

    concept: str
    genre: str
    target_duration: int  # seconds
    scene_count: int
    hero_subject: str = ""
    scenes: list[ScreenplayScene] = field(default_factory=list)
    acts: list[dict] = field(default_factory=list)  # optional act structure

    def total_duration(self) -> int:
        return sum(s.duration_seconds for s in self.scenes)

    def to_dict(self) -> dict:
        return {
            "concept": self.concept,
            "genre": self.genre,
            "target_duration": self.target_duration,
            "scene_count": self.scene_count,
            "hero_subject": self.hero_subject,
            "total_duration": self.total_duration(),
            "acts": self.acts,
            "scenes": [
                {
                    "scene_number": s.scene_number,
                    "duration_seconds": s.duration_seconds,
                    "location": s.location,
                    "description": s.description,
                    "characters_present": s.characters_present,
                    "dialogue": s.dialogue,
                    "mode": s.mode,
                    "keyframes": [
                        {
                            "time": kf.time,
                            "camera": kf.camera,
                            "action": kf.action,
                            "lighting": kf.lighting,
                            "audio": kf.audio,
                            "pacing": kf.pacing,
                        }
                        for kf in s.keyframes
                    ],
                }
                for s in self.scenes
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> Screenplay:
        scenes = []
        for sd in data.get("scenes", []):
            keyframes = [
                Keyframe(
                    time=kf["time"],
                    camera=kf["camera"],
                    action=kf["action"],
                    lighting=kf["lighting"],
                    audio=kf.get("audio", ""),
                    pacing=kf.get("pacing", "medium"),
                )
                for kf in sd.get("keyframes", [])
            ]
            scenes.append(
                ScreenplayScene(
                    scene_number=sd["scene_number"],
                    duration_seconds=sd["duration_seconds"],
                    location=sd.get("location", ""),
                    description=sd.get("description", ""),
                    characters_present=sd.get("characters_present", []),
                    keyframes=keyframes,
                    dialogue=sd.get("dialogue"),
                    mode=sd.get("mode", "frames-to-video"),
                )
            )
        return cls(
            concept=data.get("concept", ""),
            genre=data.get("genre", "cinematic"),
            target_duration=data.get("target_duration", 60),
            scene_count=data.get("scene_count", len(scenes)),
            hero_subject=data.get("hero_subject", ""),
            scenes=scenes,
            acts=data.get("acts", []),
        )


# ============================================================================
# Genre Detection (reuses seedance_prompt_db patterns)
# ============================================================================


def detect_genre(concept: str) -> str:
    """Detect genre from concept text using keyword matching.

    Reuses the GENRE_KEYWORDS patterns from seedance_prompt_db.py for
    consistency across the pipeline.
    """
    try:
        from seedance_prompt_db import PromptDB

        db = PromptDB()
        return db.detect_genre(concept)
    except ImportError:
        pass

    # Fallback: simplified keyword matching
    text_lower = concept.lower()
    genre_hints = {
        "fight": ["fight", "battle", "combat", "warrior", "duel"],
        "ecommerce": ["product", "brand", "ad", "commercial", "luxury"],
        "food": ["food", "cooking", "recipe", "kitchen", "chef"],
        "romance": ["love", "romance", "couple", "wedding", "heart"],
        "drama": ["drama", "emotional", "family", "conflict"],
        "cinematic": ["cinematic", "film", "epic", "dramatic"],
        "dance": ["dance", "dancing", "choreography", "kpop"],
        "fashion": ["fashion", "model", "runway", "designer", "outfit"],
        "nature": ["nature", "landscape", "ocean", "mountain", "forest"],
        "vfx": ["vfx", "transition", "effect", "morph"],
    }
    scores: dict[str, int] = {}
    for genre, keywords in genre_hints.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > 0:
            scores[genre] = score

    if not scores:
        return "cinematic"
    return max(scores, key=scores.get)


# ============================================================================
# Keyframe Allocation
# ============================================================================


def allocate_keyframe_count(duration: int) -> int:
    """Map scene duration to optimal number of keyframes.

    Each keyframe covers ~3 seconds. Longer scenes get more keyframes
    for richer time-segmented Seedance prompts.
    """
    if duration <= 5:
        return 2
    elif duration <= 8:
        return 3
    elif duration <= 12:
        return 4
    else:
        return 5


def allocate_scene_durations(target_duration: int, scene_count: int) -> list[int]:
    """Allocate durations across scenes to hit the target.

    Uses a mix from STORY_ENGINE_DURATIONS (4, 6, 8 seconds).
    First and last scenes tend to be longer (8s) for impact.
    """
    if scene_count <= 0:
        return []

    valid_durations = sorted(STORY_ENGINE_DURATIONS)
    avg = target_duration / scene_count

    durations = []
    for i in range(scene_count):
        # First and last scenes get more time
        if i == 0 or i == scene_count - 1:
            dur = max(valid_durations)
        elif avg <= valid_durations[0]:
            dur = valid_durations[0]
        elif avg >= valid_durations[-1]:
            dur = valid_durations[-1]
        else:
            # Pick closest valid duration
            dur = min(valid_durations, key=lambda d: abs(d - avg))
        durations.append(dur)

    # Adjust to match target (trim excess from middle scenes)
    total = sum(durations)
    diff = total - target_duration
    if diff != 0:
        # Adjust middle scenes to close the gap
        for idx in range(1, len(durations) - 1):
            if diff == 0:
                break
            if diff > 0 and durations[idx] > valid_durations[0]:
                step = min(diff, durations[idx] - valid_durations[0])
                durations[idx] -= step
                diff -= step
            elif diff < 0 and durations[idx] < valid_durations[-1]:
                step = min(-diff, valid_durations[-1] - durations[idx])
                durations[idx] += step
                diff += step

    return durations


# ============================================================================
# Hero Subject Extraction (StoryGen pattern)
# ============================================================================


def extract_hero_subject(screenplay: Screenplay) -> str:
    """Extract the hero subject from the first scene's description.

    StoryGen pattern: scene 1 establishes the main subject, which is then
    referenced in all subsequent scenes for visual consistency.
    """
    if not screenplay.scenes:
        return ""

    first = screenplay.scenes[0]

    # If characters are listed, use the first character
    if first.characters_present:
        return first.characters_present[0]

    # Otherwise extract from description — take the first noun phrase
    desc = first.description
    # Simple heuristic: first sentence up to a comma or period
    match = re.match(r"^(.+?)[,.]", desc)
    if match:
        return match.group(1).strip()

    # Fallback: first 50 chars
    return desc[:50].strip() if desc else ""


# ============================================================================
# Sliding Window Context (StoryGen A→B continuity)
# ============================================================================


def build_sliding_window_context(scenes: list[ScreenplayScene], idx: int) -> dict:
    """Build continuity context for scene at idx from neighboring scenes.

    StoryGen pattern: each scene gets context from its predecessor (A) and
    successor (B) for seamless transitions.
    """
    context: dict = {}

    if idx > 0:
        prev = scenes[idx - 1]
        context["previous_scene"] = {
            "description": prev.description,
            "location": prev.location,
            "ending_action": prev.keyframes[-1].action if prev.keyframes else "",
            "ending_camera": prev.keyframes[-1].camera if prev.keyframes else "",
        }

    if idx < len(scenes) - 1:
        nxt = scenes[idx + 1]
        context["next_scene"] = {
            "description": nxt.description,
            "location": nxt.location,
            "opening_action": nxt.keyframes[0].action if nxt.keyframes else "",
        }

    return context


# ============================================================================
# Screenplay Validation
# ============================================================================

VALID_PACING = {"slow", "medium", "quick", "frenetic"}


def validate_screenplay(screenplay: Screenplay) -> list[str]:
    """Validate screenplay structure. Returns list of error strings (empty = OK)."""
    errors: list[str] = []

    if not screenplay.concept:
        errors.append("Missing concept")

    if not screenplay.scenes:
        errors.append("No scenes")
        return errors

    # Check scene numbers are sequential
    numbers = [s.scene_number for s in screenplay.scenes]
    expected = list(range(1, len(screenplay.scenes) + 1))
    if numbers != expected:
        errors.append(f"Scene numbers not sequential: {numbers}")

    # Check each scene
    for scene in screenplay.scenes:
        if scene.duration_seconds < 2 or scene.duration_seconds > 20:
            errors.append(
                f"Scene {scene.scene_number}: duration {scene.duration_seconds}s "
                f"out of range (2-20s)"
            )

        if not scene.description:
            errors.append(f"Scene {scene.scene_number}: missing description")

        if not scene.keyframes:
            errors.append(f"Scene {scene.scene_number}: no keyframes")
        else:
            expected_kf = allocate_keyframe_count(scene.duration_seconds)
            if len(scene.keyframes) < 1:
                errors.append(f"Scene {scene.scene_number}: too few keyframes")
            elif len(scene.keyframes) > expected_kf + 1:
                errors.append(
                    f"Scene {scene.scene_number}: too many keyframes "
                    f"({len(scene.keyframes)} for {scene.duration_seconds}s scene)"
                )

            for kf in scene.keyframes:
                if kf.pacing not in VALID_PACING:
                    errors.append(
                        f"Scene {scene.scene_number}: invalid pacing '{kf.pacing}'"
                    )

    # Check total duration is reasonable
    total = screenplay.total_duration()
    target = screenplay.target_duration
    if target > 0:
        tolerance = max(target * 0.3, 4)  # 30% tolerance or 4s minimum
        if abs(total - target) > tolerance:
            errors.append(
                f"Total duration {total}s too far from target {target}s "
                f"(tolerance: ±{tolerance:.0f}s)"
            )

    return errors


# ============================================================================
# Gemini-Powered Screenplay Generation
# ============================================================================

SCREENPLAY_SYSTEM_PROMPT = """You are a professional screenwriter and cinematographer.
Given a concept, create a structured screenplay with keyframes for AI video generation.

RULES:
1. Each scene has 2-5 keyframes at ~3 second intervals
2. Use cinematic camera vocabulary: push_in, pull_back, orbit, crane_up, crane_down,
   dolly_left, dolly_right, handheld, steadicam, dutch_angle, whip_pan, rack_focus,
   aerial, close_up, extreme_close_up, wide_establishing
3. Keyframes must have: time, camera, action, lighting, audio, pacing
4. Pacing values: slow, medium, quick, frenetic
5. Scene durations must be 4, 6, 8, 12, or 15 seconds
6. First scene establishes the hero subject/character
7. Last scene provides a satisfying conclusion or call-to-action
8. Dialogue field is optional — only include if the scene has spoken words
9. Each keyframe's time field should be a range like "0-3s", "3-6s", etc.
10. Ensure variety in camera movements — don't repeat the same camera for consecutive keyframes

OUTPUT FORMAT (JSON):
{
  "concept": "...",
  "genre": "...",
  "hero_subject": "Main visual subject from scene 1",
  "acts": [
    {"act": 1, "name": "Setup", "scenes": [1, 2]},
    {"act": 2, "name": "Development", "scenes": [3, 4, 5]},
    {"act": 3, "name": "Resolution", "scenes": [6, 7, 8]}
  ],
  "scenes": [
    {
      "scene_number": 1,
      "duration_seconds": 8,
      "location": "...",
      "description": "...",
      "characters_present": ["Character A"],
      "dialogue": null,
      "mode": "frames-to-video",
      "keyframes": [
        {
          "time": "0-3s",
          "camera": "wide establishing shot, slow crane down",
          "action": "description of what happens",
          "lighting": "golden hour backlight",
          "audio": "ambient nature sounds",
          "pacing": "slow"
        }
      ]
    }
  ]
}
"""


def generate_screenplay(
    concept: str,
    duration: int = 60,
    scene_count: int = 8,
    genre: str | None = None,
    model: str = "flash",
) -> Screenplay:
    """Generate a screenplay from a concept using Gemini.

    Args:
        concept: One-line concept (e.g., "30-second luxury watch ad")
        duration: Target duration in seconds
        scene_count: Number of scenes
        genre: Optional genre override (auto-detected if None)
        model: "flash" or "pro" (Gemini model tier)

    Returns:
        Screenplay object with scenes and keyframes

    Raises:
        ScreenplayError: On generation or parsing failure
    """
    if scene_count > STORY_ENGINE_MAX_SHOTS:
        raise ScreenplayError(
            f"Scene count {scene_count} exceeds max {STORY_ENGINE_MAX_SHOTS}"
        )

    detected_genre = genre or detect_genre(concept)
    durations = allocate_scene_durations(duration, scene_count)

    # Build duration hint for the prompt
    duration_hint = ", ".join(f"Scene {i+1}: {d}s" for i, d in enumerate(durations))

    user_prompt = (
        f"Create a {duration}-second screenplay for: {concept}\n\n"
        f"Genre: {detected_genre}\n"
        f"Number of scenes: {scene_count}\n"
        f"Scene durations: {duration_hint}\n\n"
        f"Generate the full screenplay with keyframes for each scene."
    )

    # Select model
    model_name = GEMINI_PRO_MODEL if model == "pro" else GEMINI_FLASH_MODEL

    logger.info("Generating screenplay: concept='%s', genre=%s, %d scenes, %ds",
                concept[:60], detected_genre, scene_count, duration)
    logger.info("Using Gemini model: %s", model_name)

    try:
        import google.genai as genai

        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise ScreenplayError("GOOGLE_API_KEY not set")

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=[
                {"role": "user", "parts": [{"text": SCREENPLAY_SYSTEM_PROMPT}]},
                {"role": "model", "parts": [{"text": "Understood. I'll create a structured screenplay with keyframes in JSON format."}]},
                {"role": "user", "parts": [{"text": user_prompt}]},
            ],
        )
    except ImportError:
        raise ScreenplayError(
            "google-genai package not installed. Run: pip install google-genai"
        )
    except Exception as e:
        raise ScreenplayError(f"Gemini API error: {e}") from e

    # Parse JSON from response
    text = response.text.strip()
    screenplay_data = _parse_json_response(text)

    # Inject metadata
    screenplay_data["concept"] = concept
    screenplay_data["genre"] = detected_genre
    screenplay_data["target_duration"] = duration
    screenplay_data["scene_count"] = scene_count

    screenplay = Screenplay.from_dict(screenplay_data)

    # Extract hero subject if not set by Gemini
    if not screenplay.hero_subject:
        screenplay.hero_subject = extract_hero_subject(screenplay)

    # Validate
    errors = validate_screenplay(screenplay)
    if errors:
        logger.warning("Screenplay validation warnings: %s", errors)

    logger.info(
        "Generated screenplay: %d scenes, %ds total (target: %ds), hero: '%s'",
        len(screenplay.scenes),
        screenplay.total_duration(),
        duration,
        screenplay.hero_subject[:40],
    )

    return screenplay


def _parse_json_response(text: str) -> dict:
    """Extract JSON from Gemini response text (handles markdown code blocks)."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    json_match = re.search(r"```(?:json)?\s*\n(.*?)\n\s*```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding first { to last }
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        try:
            return json.loads(text[first_brace:last_brace + 1])
        except json.JSONDecodeError:
            pass

    raise ScreenplayError(f"Could not parse JSON from Gemini response:\n{text[:500]}")


# ============================================================================
# COPY-to-Film Bridge: SEALCAM+ Analysis → Screenplay
# ============================================================================


def screenplay_from_analysis(
    analysis: dict | str,
    new_subject: str | None = None,
) -> Screenplay:
    """Convert a SEALCAM+ analysis into a Screenplay with keyframes.

    Maps:
      - SEALCAM action.keyframes (percentage-based) → time-based keyframes
      - SEALCAM camera.movement_type → camera vocabulary
      - SEALCAM lighting.setup → keyframe lighting field
      - SEALCAM audio.style → keyframe audio field

    Args:
        analysis: SEALCAM+ JSON dict or path to JSON file
        new_subject: Optional subject swap (replaces original subject)

    Returns:
        Screenplay with keyframes derived from the analysis
    """
    if isinstance(analysis, str):
        with open(analysis) as f:
            analysis = json.load(f)

    # Extract top-level metadata
    concept = analysis.get("overall_vibe", "Replicated video")
    genre = _detect_genre_from_analysis(analysis)
    scenes_data = analysis.get("scenes", [])

    if not scenes_data:
        raise ScreenplayError("No scenes found in SEALCAM+ analysis")

    screenplay_scenes: list[ScreenplayScene] = []

    for scene_data in scenes_data:
        scene_num = scene_data.get("scene_number", len(screenplay_scenes) + 1)
        duration = _parse_duration(scene_data)

        # Extract SEALCAM fields
        subject = scene_data.get("subject", "")
        environment = scene_data.get("environment", "")
        action = scene_data.get("action", "")
        lighting = scene_data.get("lighting", "")
        camera = scene_data.get("camera", "")
        audio = scene_data.get("audio", "")

        # Subject swap if requested
        if new_subject and subject:
            subject = new_subject

        # Build description
        description = f"{subject} in {environment}. {action}."

        # Convert to keyframes
        keyframes = _sealcam_to_keyframes(
            scene_data, duration=duration, fallback_camera=camera,
            fallback_lighting=lighting, fallback_audio=audio,
        )

        # Extract characters
        characters = []
        if subject:
            characters.append(subject.split(",")[0].strip())

        screenplay_scenes.append(
            ScreenplayScene(
                scene_number=scene_num,
                duration_seconds=duration,
                location=environment,
                description=description,
                characters_present=characters,
                keyframes=keyframes,
            )
        )

    total_duration = sum(s.duration_seconds for s in screenplay_scenes)

    screenplay = Screenplay(
        concept=concept,
        genre=genre,
        target_duration=total_duration,
        scene_count=len(screenplay_scenes),
        scenes=screenplay_scenes,
    )

    screenplay.hero_subject = extract_hero_subject(screenplay)

    logger.info(
        "Converted SEALCAM+ analysis to screenplay: %d scenes, %ds",
        len(screenplay_scenes),
        total_duration,
    )

    return screenplay


def _detect_genre_from_analysis(analysis: dict) -> str:
    """Detect genre from SEALCAM+ analysis metadata."""
    vibe = analysis.get("overall_vibe", "")
    category = analysis.get("brand_category", "")
    combined = f"{vibe} {category}"
    return detect_genre(combined) if combined.strip() else "cinematic"


def _parse_duration(scene_data: dict) -> int:
    """Parse scene duration from SEALCAM data, defaulting to 8s."""
    timestamp = scene_data.get("timestamp", "")
    duration = scene_data.get("duration_seconds")
    if duration:
        return max(4, min(15, int(duration)))

    # Try parsing from timestamp like "0:00-0:06"
    if "-" in timestamp:
        parts = timestamp.split("-")
        if len(parts) == 2:
            try:
                start = _timestamp_to_seconds(parts[0].strip())
                end = _timestamp_to_seconds(parts[1].strip())
                dur = int(end - start)
                return max(4, min(15, dur))
            except (ValueError, IndexError):
                pass

    return 8  # default


def _timestamp_to_seconds(ts: str) -> float:
    """Convert timestamp like '0:06' or '1:30' to seconds."""
    parts = ts.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    return float(ts)


def _sealcam_to_keyframes(
    scene_data: dict,
    duration: int,
    fallback_camera: str = "",
    fallback_lighting: str = "",
    fallback_audio: str = "",
) -> list[Keyframe]:
    """Convert SEALCAM+ scene data to time-based keyframes."""
    # Check if scene has explicit keyframe data
    action_data = scene_data.get("action", "")
    if isinstance(action_data, dict) and "keyframes" in action_data:
        return _convert_percentage_keyframes(
            action_data["keyframes"], duration,
            fallback_camera, fallback_lighting, fallback_audio,
        )

    # No explicit keyframes — generate from SEALCAM fields
    num_kf = allocate_keyframe_count(duration)
    segment_duration = duration / num_kf

    camera_str = fallback_camera
    if isinstance(camera_str, dict):
        camera_str = camera_str.get("movement_type", "") or camera_str.get("description", "")

    lighting_str = fallback_lighting
    if isinstance(lighting_str, dict):
        lighting_str = lighting_str.get("setup", "") or lighting_str.get("description", "")

    audio_str = fallback_audio
    if isinstance(audio_str, dict):
        audio_str = audio_str.get("style", "") or audio_str.get("description", "")

    action_str = action_data if isinstance(action_data, str) else str(action_data)

    keyframes = []
    for i in range(num_kf):
        start = int(i * segment_duration)
        end = int((i + 1) * segment_duration)
        keyframes.append(
            Keyframe(
                time=f"{start}-{end}s",
                camera=camera_str,
                action=action_str,
                lighting=lighting_str,
                audio=audio_str,
                pacing="medium",
            )
        )

    return keyframes


def _convert_percentage_keyframes(
    pct_keyframes: list[dict],
    duration: int,
    fallback_camera: str,
    fallback_lighting: str,
    fallback_audio: str,
) -> list[Keyframe]:
    """Convert percentage-based keyframes (0%, 50%, 100%) to time-based (0-3s, 3-6s)."""
    keyframes = []
    for kf in pct_keyframes:
        pct = kf.get("position", 0)
        if isinstance(pct, str):
            pct = float(pct.replace("%", ""))
        start = int(pct / 100 * duration)
        end = min(start + 3, duration)

        keyframes.append(
            Keyframe(
                time=f"{start}-{end}s",
                camera=kf.get("camera", fallback_camera),
                action=kf.get("action", ""),
                lighting=kf.get("lighting", fallback_lighting),
                audio=kf.get("audio", fallback_audio),
                pacing=kf.get("pacing", "medium"),
            )
        )

    return keyframes


# ============================================================================
# Save to DB
# ============================================================================


def save_screenplay_to_db(screenplay: Screenplay, project_id: int | str) -> None:
    """Persist screenplay to the database via db_unified."""
    try:
        from db_unified import save_screenplay

        save_screenplay(
            project_id=project_id,
            concept=screenplay.concept,
            genre=screenplay.genre,
            target_duration=screenplay.target_duration,
            scene_count=screenplay.scene_count,
            outline_json=json.dumps(screenplay.acts) if screenplay.acts else None,
            screenplay_json=json.dumps(screenplay.to_dict()),
            current_phase="screenplay",
        )
        logger.info("Saved screenplay to database for project %s", project_id)
    except Exception as e:
        logger.warning("Could not save screenplay to DB: %s", e)


def save_screenplay_to_file(screenplay: Screenplay, output_path: str) -> str:
    """Write screenplay JSON to file."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(screenplay.to_dict(), f, indent=2)
    logger.info("Wrote screenplay to %s", output_path)
    return output_path


# ============================================================================
# CLI
# ============================================================================


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate structured screenplays with keyframes for AI video generation"
    )
    sub = parser.add_subparsers(dest="command")

    # generate subcommand
    gen = sub.add_parser("generate", help="Generate screenplay from concept")
    gen.add_argument("--concept", required=True, help="One-line concept")
    gen.add_argument("--duration", type=int, default=60, help="Target duration (seconds)")
    gen.add_argument("--scenes", type=int, default=8, help="Number of scenes")
    gen.add_argument("--genre", default=None, help="Genre override (auto-detected if omitted)")
    gen.add_argument("--model", choices=["flash", "pro"], default="flash")
    gen.add_argument("--project", help="Project slug (for file output)")
    gen.add_argument("--output", "-o", help="Output JSON path")

    # from-analysis subcommand
    conv = sub.add_parser("from-analysis", help="Convert SEALCAM+ analysis to screenplay")
    conv.add_argument("--analysis", required=True, help="Path to SEALCAM+ JSON")
    conv.add_argument("--new-subject", help="Replace original subject")
    conv.add_argument("--project", help="Project slug (for file output)")
    conv.add_argument("--output", "-o", help="Output JSON path")

    # validate subcommand
    val = sub.add_parser("validate", help="Validate a screenplay JSON file")
    val.add_argument("screenplay", help="Path to screenplay JSON")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        # Support --concept as top-level arg for convenience
        parser.print_help()
        sys.exit(1)

    if args.command == "generate":
        screenplay = generate_screenplay(
            concept=args.concept,
            duration=args.duration,
            scene_count=args.scenes,
            genre=args.genre,
            model=args.model,
        )

        output = args.output
        if not output and args.project:
            project_dir = os.path.join(PROJECT_BASE, args.project, "analysis")
            os.makedirs(project_dir, exist_ok=True)
            output = os.path.join(project_dir, "screenplay.json")

        if output:
            save_screenplay_to_file(screenplay, output)

        # Print summary
        print(f"\n{'='*60}")
        print(f"Screenplay: {screenplay.concept}")
        print(f"Genre: {screenplay.genre} | Duration: {screenplay.total_duration()}s | Scenes: {len(screenplay.scenes)}")
        print(f"Hero: {screenplay.hero_subject}")
        print(f"{'='*60}")
        for scene in screenplay.scenes:
            kf_count = len(scene.keyframes)
            chars = ", ".join(scene.characters_present) if scene.characters_present else "—"
            print(f"  Scene {scene.scene_number} ({scene.duration_seconds}s) @ {scene.location}")
            print(f"    {scene.description[:80]}")
            print(f"    Characters: {chars} | Keyframes: {kf_count}")
            if scene.dialogue:
                print(f"    Dialogue: \"{scene.dialogue[:60]}...\"")
        print(f"{'='*60}\n")

        if output:
            print(f"Output: {output}")

    elif args.command == "from-analysis":
        screenplay = screenplay_from_analysis(
            analysis=args.analysis,
            new_subject=args.new_subject,
        )

        output = args.output
        if not output and args.project:
            project_dir = os.path.join(PROJECT_BASE, args.project, "analysis")
            os.makedirs(project_dir, exist_ok=True)
            output = os.path.join(project_dir, "screenplay.json")

        if output:
            save_screenplay_to_file(screenplay, output)

        print(f"Converted {len(screenplay.scenes)} scenes from SEALCAM+ analysis")
        print(f"Total duration: {screenplay.total_duration()}s")
        if output:
            print(f"Output: {output}")

    elif args.command == "validate":
        with open(args.screenplay) as f:
            data = json.load(f)

        screenplay = Screenplay.from_dict(data)
        errors = validate_screenplay(screenplay)

        if errors:
            print(f"Validation FAILED ({len(errors)} errors):")
            for err in errors:
                print(f"  - {err}")
            sys.exit(1)
        else:
            print(f"Validation PASSED: {len(screenplay.scenes)} scenes, "
                  f"{screenplay.total_duration()}s total")


if __name__ == "__main__":
    main()
