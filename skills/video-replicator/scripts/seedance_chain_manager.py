#!/usr/bin/env python3
"""
Seedance Chain Manager — Scene continuation via last-frame injection.

Organizes scenes into chain groups:
- Sequential chains: each scene uses previous scene's last frame as start_frame
- Parallel groups: independent scenes that can generate concurrently

Improvements from wiki scene-chaining.md:
- Character sheet re-upload at every chain link (prevents drift after 4-5 chains)
- Chaining vs extend decision logic
- Maximum-quality screenshot extraction
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from seedance_prompt_director import CharacterRef, DirectorScene

_CONTINUE_PATTERN = re.compile(
    r"^(continue|continues|continuing|next|then|following|afterwards)\b",
    re.IGNORECASE,
)


class ContinuationType(Enum):
    """How a scene continues from the previous one.

    Decision tree from wiki scene-chaining.md:
    - SAME_SHOT_SMOOTH: Use extend mode (preserves style, motion, audio)
    - NEW_DIRECTION: Use scene chaining (screenshot + new prompt)
    """
    SAME_SHOT_SMOOTH = "same_shot_smooth"
    NEW_DIRECTION = "new_direction"


@dataclass
class ChainGroup:
    group_id: int
    scene_numbers: list[int]
    parallel: bool

    def to_dict(self) -> dict:
        return {
            "group_id": self.group_id,
            "scene_numbers": self.scene_numbers,
            "parallel": self.parallel,
        }


@dataclass
class ChainLink:
    """A single link in a scene chain, tracking what references to include."""
    scene_number: int
    last_frame_path: str | None = None
    character_sheets: list[str] = field(default_factory=list)
    continuation_type: ContinuationType = ContinuationType.NEW_DIRECTION
    extend_request_id: str | None = None  # For extend mode

    def to_dict(self) -> dict:
        return {
            "scene_number": self.scene_number,
            "last_frame_path": self.last_frame_path,
            "character_sheets": self.character_sheets,
            "continuation_type": self.continuation_type.value,
            "extend_request_id": self.extend_request_id,
        }


@dataclass
class ChainPlan:
    groups: list[ChainGroup]
    links: list[ChainLink] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "groups": [g.to_dict() for g in self.groups],
            "links": [l.to_dict() for l in self.links],
        }


def detect_continuation_type(
    prev_description: str,
    next_description: str,
) -> ContinuationType:
    """Determine whether to use extend mode or scene chaining.

    Decision logic from wiki scene-chaining.md:
    - If the next scene continues the exact same shot/action → extend
    - If it changes camera angle, adds characters, or shifts direction → chain

    Heuristics:
    - "same shot", "continues", "smooth" → SAME_SHOT_SMOOTH
    - "cut to", "new angle", "meanwhile", different setting → NEW_DIRECTION
    """
    next_lower = next_description.lower()

    # Extend mode indicators
    _EXTEND_PATTERNS = re.compile(
        r"\b(same\s+shot|smooth\s+continuation|continues?\s+the\s+same|"
        r"keep\s+going|extends?\b|seamless|unbroken)\b",
        re.IGNORECASE,
    )
    if _EXTEND_PATTERNS.search(next_lower):
        return ContinuationType.SAME_SHOT_SMOOTH

    # Chain mode indicators (default)
    _CHAIN_PATTERNS = re.compile(
        r"\b(cut\s+to|new\s+angle|meanwhile|different|another|shifts?\s+to|"
        r"transitions?\s+to|reveals?|suddenly)\b",
        re.IGNORECASE,
    )
    if _CHAIN_PATTERNS.search(next_lower):
        return ContinuationType.NEW_DIRECTION

    # Default to chaining — safer for visual consistency
    return ContinuationType.NEW_DIRECTION


def build_chain_plan(
    scenes: list[DirectorScene],
    characters: list[CharacterRef] | None = None,
) -> ChainPlan:
    """Build a chain plan from scenes.

    Scenes with continues_from_previous=True chain with the previous scene.
    Auto-detects continuation from description keywords.
    Independent scenes become parallel groups.

    When characters are provided, builds ChainLink entries that include
    character sheet paths for re-upload at every chain link (wiki:
    "Re-upload character sheets at every chain link — not just the first clip").
    """
    if not scenes:
        return ChainPlan(groups=[], links=[])

    continues = [False] * len(scenes)
    for i, scene in enumerate(scenes):
        if i == 0:
            continue
        if scene.continues_from_previous:
            continues[i] = True
        elif _CONTINUE_PATTERN.match(scene.description.strip()):
            continues[i] = True

    groups: list[ChainGroup] = []
    current_group: list[int] = [scenes[0].scene_number]
    is_chain = False

    for i in range(1, len(scenes)):
        if continues[i]:
            current_group.append(scenes[i].scene_number)
            is_chain = True
        else:
            groups.append(ChainGroup(
                group_id=len(groups),
                scene_numbers=list(current_group),
                parallel=not is_chain,
            ))
            current_group = [scenes[i].scene_number]
            is_chain = False

    groups.append(ChainGroup(
        group_id=len(groups),
        scene_numbers=list(current_group),
        parallel=not is_chain,
    ))

    # Build chain links with character sheet re-upload info
    links: list[ChainLink] = []
    char_sheets = [c.sheet_image for c in (characters or []) if c.sheet_image]

    for i, scene in enumerate(scenes):
        if i == 0 or not continues[i]:
            continue
        cont_type = detect_continuation_type(
            scenes[i - 1].description, scene.description,
        )
        links.append(ChainLink(
            scene_number=scene.scene_number,
            character_sheets=list(char_sheets),  # Re-upload ALL sheets every time
            continuation_type=cont_type,
        ))

    return ChainPlan(groups=groups, links=links)


def build_chain_media_roles(
    link: ChainLink,
    existing_media_roles: dict[str, str | list[str]] | None = None,
) -> dict[str, str | list[str]]:
    """Build media_roles dict for a chain link, including character sheet re-upload.

    From wiki character-consistency.md:
    "After 4-5 chained clips, character drift accumulates. Re-upload the original
    character sheet alongside the screenshot for every chain link."

    Returns a media_roles dict with:
    - start_frame: last-frame screenshot from previous clip
    - character_sheets: list of character sheet paths (re-uploaded every time)
    """
    roles: dict[str, str | list[str]] = dict(existing_media_roles or {})

    # Set last frame as start_frame
    if link.last_frame_path:
        roles["start_frame"] = link.last_frame_path

    # Re-upload character sheets at every chain link
    if link.character_sheets:
        roles["character_ref"] = link.character_sheets

    return roles


def extract_last_frame(
    video_path: str,
    output_path: str,
    max_quality: bool = True,
) -> str:
    """Extract the last frame of a video using FFmpeg.

    Args:
        video_path: Path to input MP4
        output_path: Path for output PNG/JPG
        max_quality: If True, extract at maximum quality (PNG, no compression).
                     From wiki scene-chaining.md: "Ensure last-frame capture is
                     at maximum resolution, not compressed."

    Returns:
        output_path on success

    Raises:
        RuntimeError: If FFmpeg fails
        FileNotFoundError: If video not found
    """
    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    probe_cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")

    duration = float(result.stdout.strip())
    seek_time = max(0, duration - 0.5)

    # Build extraction command — max quality uses PNG and no compression
    extract_cmd = [
        "ffmpeg", "-y",
        "-ss", str(seek_time),
        "-i", video_path,
        "-frames:v", "1",
    ]
    if max_quality:
        # Use PNG format for lossless extraction at full resolution
        if not output_path.lower().endswith(".png"):
            # Override to PNG for max quality
            output_path = os.path.splitext(output_path)[0] + ".png"
        extract_cmd.extend(["-compression_level", "0"])
    else:
        # Original behavior — JPEG q:v 2
        extract_cmd.extend(["-q:v", "2"])

    extract_cmd.append(output_path)

    result = subprocess.run(extract_cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg frame extraction failed: {result.stderr}")

    if not os.path.isfile(output_path):
        raise RuntimeError(f"Frame not created at {output_path}")

    return output_path
