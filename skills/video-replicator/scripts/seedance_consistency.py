#!/usr/bin/env python3
"""
Cross-scene prompt consistency checker for Seedance.

Validates consistency across multiple Seedance scene prompts BEFORE they
are submitted to the API.  Catches issues like inconsistent character
descriptions, conflicting styles, incoherent camera arcs, or
duration-complexity mismatches that would produce a disjointed video.

All checks are pure pattern matching — no API or LLM calls.

Usage (as library):
    from seedance_consistency import check_prompt_consistency

    report = check_prompt_consistency([
        {"scene_number": 1, "seedance_prompt": "...", "seedance_duration": 8},
        {"scene_number": 2, "seedance_prompt": "...", "seedance_duration": 10},
    ])
    if not report.passed:
        for issue in report.issues:
            print(f"[{issue.severity}] scenes {issue.scene_indices}: {issue.message}")

Usage (CLI):
    python3 scripts/video/seedance_consistency.py check --queue /path/to/queue.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Import pattern dictionaries from siblings
# ---------------------------------------------------------------------------

# Ensure scripts/video is importable when run as a script
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from seedance_prompt_builder import (  # noqa: E402
    STYLE_TOKENS,
    build_connection_points,
)
from seedance_prompt_db import (  # noqa: E402
    AUDIO_PATTERNS,
    CAMERA_PATTERNS,
    COLOR_PATTERNS,
)

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ConsistencyIssue:
    """A single consistency issue found across scenes."""

    severity: str  # 'warning' | 'error'
    scene_indices: list[int]
    category: str  # 'character', 'style', 'camera', 'color', 'audio', 'duration'
    message: str


@dataclass
class ConsistencyReport:
    """Aggregated result of all consistency checks."""

    issues: list[ConsistencyIssue] = field(default_factory=list)
    connection_points: list[dict] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not any(i.severity == "error" for i in self.issues)

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "warning")

    def to_dict(self) -> dict:
        """Serialize the report for JSON output."""
        return {
            "passed": self.passed,
            "warning_count": self.warning_count,
            "issues": [
                {
                    "severity": i.severity,
                    "scene_indices": i.scene_indices,
                    "category": i.category,
                    "message": i.message,
                }
                for i in self.issues
            ],
            "connection_points": self.connection_points,
        }


# ---------------------------------------------------------------------------
# Pattern families used by style conflict detection
# ---------------------------------------------------------------------------

# Groups of style genres that are considered mutually incompatible.
# If a video mixes styles from different families it is flagged.
_STYLE_FAMILIES: dict[str, set[str]] = {
    "realistic": {"cinematic", "documentary", "commercial", "luxury", "travel", "sports"},
    "animated": {"anime", "fairy_tale", "vfx"},
    "dark": {"horror", "noir", "thriller", "war"},
    "bright": {"comedy", "romance", "romantic", "kpop"},
    "period": {"historical", "western", "xianxia"},
    "futuristic": {"sci_fi", "cyberpunk"},
}


def _family_for_genre(genre: str) -> str | None:
    for family, members in _STYLE_FAMILIES.items():
        if genre in members:
            return family
    return None


# ---------------------------------------------------------------------------
# Character extraction helpers
# ---------------------------------------------------------------------------

# Patterns that introduce character references in prompts.
_CHARACTER_INTRO = re.compile(
    r"(?:character|person|protagonist|figure|man|woman|warrior|knight|hero|heroine|girl|boy|child|elder|king|queen|prince|princess|detective|soldier)\b",
    re.IGNORECASE,
)

# Capture a character name (capitalized word sequence) — e.g. "Aiko", "Lord Vex"
_PROPER_NAME = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b")

# Descriptive phrase following a character word — up to 8 words.
_CHAR_DESC = re.compile(
    r"(?:character|person|protagonist|figure|man|woman|warrior|knight|hero|heroine|girl|boy|child|elder|king|queen|prince|princess|detective|soldier)"
    r"\s+((?:\w+\s+){0,7}\w+)",
    re.IGNORECASE,
)


def _extract_characters(prompt: str) -> list[dict]:
    """Extract character references from a prompt.

    Returns a list of dicts with keys 'name' (str|None) and 'description' (str).
    """
    chars: list[dict] = []

    # Proper names near character keywords
    names_found: set[str] = set()
    for m in _PROPER_NAME.finditer(prompt):
        name = m.group(1)
        # Skip common non-name words
        if name.lower() in {
            "camera", "scene", "the", "shot", "frame", "slowly",
            "cinematic", "dramatic", "golden", "natural", "background",
            "seamlessly", "continuing", "maintaining", "establishing",
            "extreme", "medium", "close", "wide",
        }:
            continue
        names_found.add(name)

    # Character descriptions
    for m in _CHAR_DESC.finditer(prompt):
        desc = m.group(1).strip().lower()
        # Associate with a nearby proper name if any
        start = max(0, m.start() - 60)
        end = min(len(prompt), m.end() + 60)
        window = prompt[start:end]
        associated_name = None
        for name in names_found:
            if name in window:
                associated_name = name
                break
        chars.append({"name": associated_name, "description": desc})

    # Also add standalone proper names that weren't associated
    for name in names_found:
        if not any(c.get("name") == name for c in chars):
            chars.append({"name": name, "description": ""})

    return chars


# ---------------------------------------------------------------------------
# Individual check functions
# ---------------------------------------------------------------------------


def _check_character_consistency(
    scenes: list[dict],
) -> list[ConsistencyIssue]:
    """Flag characters with inconsistent descriptions across scenes."""
    issues: list[ConsistencyIssue] = []

    # Map character name -> list of (scene_index, description)
    name_map: dict[str, list[tuple[int, str]]] = {}
    for scene in scenes:
        idx = scene.get("scene_number", 0)
        prompt = scene.get("seedance_prompt", "")
        chars = _extract_characters(prompt)
        for c in chars:
            if c["name"] and c["description"]:
                name_map.setdefault(c["name"], []).append((idx, c["description"]))

    # Check for description divergence per character
    for name, entries in name_map.items():
        if len(entries) < 2:
            continue
        descs = [e[1] for e in entries]
        indices = [e[0] for e in entries]
        # Simple check: if descriptions share less than 30% words, flag.
        first_words = set(descs[0].split())
        for i, desc in enumerate(descs[1:], 1):
            other_words = set(desc.split())
            if not first_words or not other_words:
                continue
            overlap = first_words & other_words
            similarity = len(overlap) / max(len(first_words), len(other_words))
            if similarity < 0.3:
                issues.append(
                    ConsistencyIssue(
                        severity="warning",
                        scene_indices=[indices[0], indices[i]],
                        category="character",
                        message=(
                            f"Character '{name}' has divergent descriptions: "
                            f"scene {indices[0]} says '{descs[0]}', "
                            f"scene {indices[i]} says '{desc}'"
                        ),
                    )
                )

    return issues


def _extract_style_genres(prompt: str) -> set[str]:
    """Detect which style genres are present in a prompt.

    Matches full style-token phrases (lowered) against the prompt text.
    Only counts a genre if the complete multi-word token appears verbatim,
    which avoids false positives from short common words like "depth" or
    "grain" that appear in many unrelated contexts.
    """
    prompt_lower = prompt.lower()
    found: set[str] = set()
    for genre, tokens in STYLE_TOKENS.items():
        for token in tokens:
            if token.lower() in prompt_lower:
                found.add(genre)
                break
    return found


def _check_style_consistency(scenes: list[dict]) -> list[ConsistencyIssue]:
    """Flag conflicting style families across scenes."""
    issues: list[ConsistencyIssue] = []

    scene_genres: list[tuple[int, set[str]]] = []
    for scene in scenes:
        idx = scene.get("scene_number", 0)
        prompt = scene.get("seedance_prompt", "")
        genres = _extract_style_genres(prompt)
        scene_genres.append((idx, genres))

    # Check cross-scene family conflicts
    all_families: dict[str, list[int]] = {}
    for idx, genres in scene_genres:
        for genre in genres:
            family = _family_for_genre(genre)
            if family:
                all_families.setdefault(family, []).append(idx)

    if len(all_families) > 1:
        family_names = sorted(all_families.keys())
        all_indices: set[int] = set()
        for idxs in all_families.values():
            all_indices.update(idxs)
        issues.append(
            ConsistencyIssue(
                severity="warning",
                scene_indices=sorted(all_indices),
                category="style",
                message=(
                    f"Scenes mix conflicting style families: "
                    f"{', '.join(family_names)}. "
                    f"This may produce visually incoherent output."
                ),
            )
        )

    return issues


def _extract_camera_labels(prompt: str) -> list[str]:
    """Extract camera movement labels from a prompt using CAMERA_PATTERNS."""
    prompt_lower = prompt.lower()
    labels: list[str] = []
    for pattern, label in CAMERA_PATTERNS:
        if re.search(pattern, prompt_lower):
            labels.append(label)
    return labels


def _check_camera_arc_flow(scenes: list[dict]) -> list[ConsistencyIssue]:
    """Flag monotonous or jarring camera arcs across consecutive scenes."""
    issues: list[ConsistencyIssue] = []
    if len(scenes) < 2:
        return issues

    scene_cameras: list[tuple[int, list[str]]] = []
    for scene in scenes:
        idx = scene.get("scene_number", 0)
        prompt = scene.get("seedance_prompt", "")
        labels = _extract_camera_labels(prompt)
        scene_cameras.append((idx, labels))

    # Check monotony: if ALL scenes share the exact same primary camera
    primary_cameras = []
    for idx, labels in scene_cameras:
        primary_cameras.append(labels[0] if labels else None)

    non_none = [c for c in primary_cameras if c is not None]
    if len(non_none) >= 3 and len(set(non_none)) == 1:
        all_indices = [idx for idx, _ in scene_cameras]
        issues.append(
            ConsistencyIssue(
                severity="warning",
                scene_indices=all_indices,
                category="camera",
                message=(
                    f"All {len(non_none)} scenes use the same camera movement "
                    f"'{non_none[0]}'. Consider varying camera work for visual interest."
                ),
            )
        )

    # Check jarring transitions between consecutive scenes
    _SHOT_SIZE_ORDER = {
        "extreme_closeup": 0,
        "closeup": 1,
        "medium": 2,
        "wide": 3,
        "establishing": 4,
        "extreme_wide": 5,
        "birds_eye": 6,
    }

    for i in range(len(scene_cameras) - 1):
        idx_a, labels_a = scene_cameras[i]
        idx_b, labels_b = scene_cameras[i + 1]
        # Check shot-size jumps
        sizes_a = [l for l in labels_a if l in _SHOT_SIZE_ORDER]
        sizes_b = [l for l in labels_b if l in _SHOT_SIZE_ORDER]
        if sizes_a and sizes_b:
            order_a = _SHOT_SIZE_ORDER[sizes_a[-1]]
            order_b = _SHOT_SIZE_ORDER[sizes_b[0]]
            if abs(order_a - order_b) >= 4:
                issues.append(
                    ConsistencyIssue(
                        severity="warning",
                        scene_indices=[idx_a, idx_b],
                        category="camera",
                        message=(
                            f"Jarring shot-size jump from '{sizes_a[-1]}' "
                            f"(scene {idx_a}) to '{sizes_b[0]}' (scene {idx_b}). "
                            f"Consider an intermediate shot size for smoother flow."
                        ),
                    )
                )

    return issues


def _extract_color_tones(prompt: str) -> list[str]:
    """Extract color tone labels from a prompt using COLOR_PATTERNS."""
    prompt_lower = prompt.lower()
    tones: list[str] = []
    for pattern, label in COLOR_PATTERNS:
        if re.search(pattern, prompt_lower):
            tones.append(label)
    return tones


def _check_color_palette(scenes: list[dict]) -> list[ConsistencyIssue]:
    """Flag contradictory color tones between consecutive scenes."""
    issues: list[ConsistencyIssue] = []
    if len(scenes) < 2:
        return issues

    _CONFLICTING_TONES = {
        frozenset({"warm", "cold"}),
        frozenset({"vivid", "soft"}),
        frozenset({"dark", "vivid"}),
    }

    for i in range(len(scenes) - 1):
        idx_a = scenes[i].get("scene_number", 0)
        idx_b = scenes[i + 1].get("scene_number", 0)
        tones_a = set(_extract_color_tones(scenes[i].get("seedance_prompt", "")))
        tones_b = set(_extract_color_tones(scenes[i + 1].get("seedance_prompt", "")))

        for pair in _CONFLICTING_TONES:
            a_match = tones_a & pair
            b_match = tones_b & pair
            if a_match and b_match and a_match != b_match:
                issues.append(
                    ConsistencyIssue(
                        severity="warning",
                        scene_indices=[idx_a, idx_b],
                        category="color",
                        message=(
                            f"Color tone clash: scene {idx_a} uses "
                            f"{', '.join(sorted(a_match))} tones while scene {idx_b} "
                            f"uses {', '.join(sorted(b_match))} tones."
                        ),
                    )
                )

    return issues


def _extract_audio_labels(prompt: str) -> list[str]:
    """Extract audio cue labels from a prompt using AUDIO_PATTERNS."""
    prompt_lower = prompt.lower()
    labels: list[str] = []
    for pattern, label in AUDIO_PATTERNS:
        if re.search(pattern, prompt_lower):
            labels.append(label)
    return labels


def _check_audio_direction(scenes: list[dict]) -> list[ConsistencyIssue]:
    """Flag abrupt audio genre changes between consecutive scenes."""
    issues: list[ConsistencyIssue] = []
    if len(scenes) < 2:
        return issues

    for i in range(len(scenes) - 1):
        idx_a = scenes[i].get("scene_number", 0)
        idx_b = scenes[i + 1].get("scene_number", 0)
        prompt_a = scenes[i].get("seedance_prompt", "")
        prompt_b = scenes[i + 1].get("seedance_prompt", "")
        audio_a = set(_extract_audio_labels(prompt_a))
        audio_b = set(_extract_audio_labels(prompt_b))

        # Flag if one scene has music and the next has only sfx/ambient
        # (or vice versa) — suggests an abrupt audio shift.
        if audio_a and audio_b and not (audio_a & audio_b):
            # Only flag if one is purely music and the other purely sfx/ambient
            if audio_a == {"music"} and "music" not in audio_b:
                issues.append(
                    ConsistencyIssue(
                        severity="warning",
                        scene_indices=[idx_a, idx_b],
                        category="audio",
                        message=(
                            f"Audio direction shifts abruptly: scene {idx_a} "
                            f"has music cues, scene {idx_b} has "
                            f"{', '.join(sorted(audio_b))} cues only."
                        ),
                    )
                )
            elif audio_b == {"music"} and "music" not in audio_a:
                issues.append(
                    ConsistencyIssue(
                        severity="warning",
                        scene_indices=[idx_a, idx_b],
                        category="audio",
                        message=(
                            f"Audio direction shifts abruptly: scene {idx_a} "
                            f"has {', '.join(sorted(audio_a))} cues, "
                            f"scene {idx_b} introduces music cues."
                        ),
                    )
                )

    return issues


# Action verbs commonly found in video prompts
_ACTION_VERBS = re.compile(
    r"\b(?:walks?|runs?|jumps?|turns?|spins?|falls?|rises?|strikes?"
    r"|swings?|throws?|catches?|flies?|lands?|opens?|closes?"
    r"|grabs?|pulls?|pushes?|lifts?|drops?|kicks?|punches?"
    r"|dances?|leaps?|rolls?|slides?|dives?|climbs?|descends?"
    r"|attacks?|defends?|dodges?|blocks?|slashes?|stabs?"
    r"|explodes?|shatters?|transforms?|morphs?|dissolves?"
    r"|appears?|vanishes?|emerges?|retreats?)\b",
    re.IGNORECASE,
)

# Time segment markers (e.g. "[0:00-0:03]" or "0s-3s")
_TIME_SEGMENT = re.compile(
    r"\[\d+:\d+\s*[-–]\s*\d+:\d+\]|\d+s\s*[-–]\s*\d+s",
)


def _check_duration_complexity(scenes: list[dict]) -> list[ConsistencyIssue]:
    """Flag prompts with too many actions for their duration."""
    issues: list[ConsistencyIssue] = []

    # Thresholds: max actions per second of duration
    _MAX_ACTIONS_PER_SECOND = 1.5  # e.g. 6 actions OK for 4s, 7 flagged

    for scene in scenes:
        idx = scene.get("scene_number", 0)
        prompt = scene.get("seedance_prompt", "")
        duration = scene.get("seedance_duration", 8)

        if not prompt or not duration:
            continue

        action_count = len(_ACTION_VERBS.findall(prompt))
        if action_count == 0:
            continue

        max_actions = int(duration * _MAX_ACTIONS_PER_SECOND)
        if action_count > max_actions:
            issues.append(
                ConsistencyIssue(
                    severity="warning",
                    scene_indices=[idx],
                    category="duration",
                    message=(
                        f"Scene {idx} has {action_count} action verbs "
                        f"in a {duration}s prompt (max recommended: {max_actions}). "
                        f"Consider simplifying or increasing duration."
                    ),
                )
            )

    return issues


def _generate_connection_points(
    scenes: list[dict],
) -> list[dict]:
    """Generate transition descriptions between consecutive scenes."""
    points: list[dict] = []
    for i in range(len(scenes) - 1):
        desc_a = scenes[i].get("seedance_prompt", "")
        desc_b = scenes[i + 1].get("seedance_prompt", "")
        idx_a = scenes[i].get("scene_number", i)
        idx_b = scenes[i + 1].get("scene_number", i + 1)

        ending, opening = build_connection_points(desc_a, desc_b)
        points.append(
            {
                "from_scene": idx_a,
                "to_scene": idx_b,
                "ending": ending,
                "opening": opening,
            }
        )
    return points


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def check_prompt_consistency(
    scenes: list[dict],
) -> ConsistencyReport:
    """Validate cross-scene prompt consistency.

    Args:
        scenes: List of scene dicts, each with at minimum:
            - scene_number (int)
            - seedance_prompt (str)
            - seedance_duration (int, optional — defaults to 8)

    Returns:
        ConsistencyReport with issues and connection points.

    Checks performed:
        1. Character consistency — same character names/descriptions across scenes
        2. Style consistency — style tokens don't conflict across families
        3. Camera arc flow — monotonous or jarring camera transitions
        4. Color palette coherence — contradictory color tones
        5. Audio direction consistency — abrupt audio genre shifts
        6. Duration-complexity match — too many actions for the duration
        7. Connection points — transition descriptions between consecutive scenes
    """
    report = ConsistencyReport()

    if not scenes or len(scenes) < 1:
        return report

    # Run all checks
    report.issues.extend(_check_character_consistency(scenes))
    report.issues.extend(_check_style_consistency(scenes))
    report.issues.extend(_check_camera_arc_flow(scenes))
    report.issues.extend(_check_color_palette(scenes))
    report.issues.extend(_check_audio_direction(scenes))
    report.issues.extend(_check_duration_complexity(scenes))

    # Generate connection points for consecutive scenes
    if len(scenes) >= 2:
        report.connection_points = _generate_connection_points(scenes)

    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _cli_check(args: argparse.Namespace) -> None:
    """CLI handler for the ``check`` subcommand."""
    queue_path = Path(args.queue)
    if not queue_path.exists():
        print(f"Error: queue file not found: {queue_path}", file=sys.stderr)
        sys.exit(1)

    with open(queue_path) as f:
        data = json.load(f)

    # Accept either a flat list or a dict with a "scenes" key
    if isinstance(data, list):
        scenes = data
    elif isinstance(data, dict) and "scenes" in data:
        scenes = data["scenes"]
    else:
        print("Error: queue JSON must be a list or {\"scenes\": [...]}", file=sys.stderr)
        sys.exit(1)

    report = check_prompt_consistency(scenes)
    print(json.dumps(report.to_dict(), indent=2))

    if not report.passed:
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cross-scene Seedance prompt consistency checker",
    )
    sub = parser.add_subparsers(dest="command")

    check_parser = sub.add_parser("check", help="Check prompt consistency")
    check_parser.add_argument(
        "--queue",
        required=True,
        help="Path to queue JSON file with scene data",
    )

    args = parser.parse_args()
    if args.command == "check":
        _cli_check(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
