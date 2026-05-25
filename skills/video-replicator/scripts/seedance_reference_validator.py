#!/usr/bin/env python3
"""
Seedance Reference Validator — catches semantic conflicts between
reference images and prompt actions before expensive generation.

Tier 1: Heuristic pattern matching (instant, always runs)
Tier 2: Vision model analysis via Gemini (2-5s per image, optional)
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass


@dataclass
class ReferenceCheck:
    scene_number: int
    role: str
    image_path: str
    conflict: str | None
    severity: str
    suggestion: str
    confidence: float


@dataclass
class ReferenceReport:
    checks: list[ReferenceCheck]

    @property
    def passed(self) -> bool:
        return not any(
            c.conflict is not None and c.severity == "error"
            for c in self.checks
        )

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "checks": [
                {
                    "scene_number": c.scene_number,
                    "role": c.role,
                    "image_path": c.image_path,
                    "conflict": c.conflict,
                    "severity": c.severity,
                    "suggestion": c.suggestion,
                    "confidence": c.confidence,
                }
                for c in self.checks
            ],
        }


_HEURISTIC_RULES: list[tuple[re.Pattern, str, str, str]] = [
    (
        re.compile(r"\b(emerges?\s+from|bursts?\s+through|erupts?\s+from|rises?\s+from)\b", re.I),
        "start_frame",
        "Subject likely already visible in start frame — AI will replicate visible state instead of generating emergence",
        "Use a 'before' state reference showing the scene without the subject (e.g., empty terrain)",
    ),
    (
        re.compile(r"\b(transforms?\s+into|morphs?\s+into|changes?\s+to|becomes?)\b", re.I),
        "start_frame",
        "Start frame may show the final state — AI needs the 'before' state to animate transformation",
        "Start frame should show the initial state before the transformation begins",
    ),
    (
        re.compile(r"\b(enters?\s+(the\s+)?frame|appears?\s+from|from\s+behind|steps?\s+into\s+view)\b", re.I),
        "start_frame",
        "Subject may already be visible in start frame — conflicts with entering/appearing action",
        "Start frame should show the scene before the subject enters",
    ),
    (
        re.compile(r"\b(explod|destruct|collaps|crumbl|shatter|break\s+apart)\b", re.I),
        "start_frame",
        "Start frame may show intact state when prompt requests destruction, or vice versa",
        "Verify reference shows the pre-destruction state matching the prompt's starting point",
    ),
]

_MOTION_VERBS = re.compile(
    r"\b(walk|run|move|pan|track|orbit|push|pull|dolly|crane|fly|swim|chase|spin|rotate)\b",
    re.IGNORECASE,
)


def validate_references_heuristic(
    prompt: str,
    media_roles: dict[str, str | list[str]] | None,
    scene_number: int,
) -> list[ReferenceCheck]:
    """Tier 1: Fast heuristic check for reference-prompt conflicts."""
    if not media_roles:
        return []

    checks: list[ReferenceCheck] = []

    start_frame = media_roles.get("start_frame")
    if start_frame:
        image_path = start_frame if isinstance(start_frame, str) else start_frame[0]
        conflict_found = False
        for pattern, role, conflict_desc, suggestion in _HEURISTIC_RULES:
            if role != "start_frame":
                continue
            if pattern.search(prompt):
                checks.append(ReferenceCheck(
                    scene_number=scene_number, role="start_frame",
                    image_path=image_path, conflict=conflict_desc,
                    severity="error", suggestion=suggestion, confidence=0.8,
                ))
                conflict_found = True
                break
        if not conflict_found:
            checks.append(ReferenceCheck(
                scene_number=scene_number, role="start_frame",
                image_path=image_path, conflict=None,
                severity="info", suggestion="", confidence=1.0,
            ))

    camera_ref = media_roles.get("camera_ref")
    if camera_ref:
        image_path = camera_ref if isinstance(camera_ref, str) else camera_ref[0]
        has_motion = bool(_MOTION_VERBS.search(prompt))
        if not has_motion:
            checks.append(ReferenceCheck(
                scene_number=scene_number, role="camera_ref",
                image_path=image_path,
                conflict="Camera reference implies motion but prompt has no movement verbs",
                severity="warning",
                suggestion="Add camera or subject motion to the prompt to match the camera reference",
                confidence=0.7,
            ))

    return checks


def validate_references_vision(
    prompt: str,
    media_roles: dict[str, str | list[str]],
    scene_number: int,
    api_key: str | None = None,
) -> list[ReferenceCheck]:
    """Tier 2: Vision model analysis for semantic conflicts. Optional — needs API key."""
    if not api_key:
        api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return []

    checks: list[ReferenceCheck] = []
    roles_to_check = ["start_frame", "character_ref"]

    for role in roles_to_check:
        files = media_roles.get(role)
        if not files:
            continue
        if isinstance(files, str):
            files = [files]

        for file_path in files:
            if not os.path.isfile(file_path):
                continue
            try:
                import google.genai as genai
                from google.genai import types
                client = genai.Client(api_key=api_key)
                with open(file_path, "rb") as img_f:
                    image_bytes = img_f.read()
                ext = file_path.lower().rsplit(".", 1)[-1] if "." in file_path else "jpeg"
                mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
                mime_type = mime_map.get(ext, "image/jpeg")
                image_part = types.Part(inline_data=types.Blob(data=image_bytes, mime_type=mime_type))
                analysis_prompt = (
                    f"Analyze this reference image used as '{role}' for AI video generation.\n\n"
                    f"The video prompt says: \"{prompt}\"\n\n"
                    f"Check for semantic conflicts:\n"
                    f"1. Does the image show a state contradicting the desired action?\n"
                    f"2. Does the image show the wrong phase of the action?\n"
                    f"3. Are there elements that conflict with the prompt?\n\n"
                    f"Respond with exactly one line:\n"
                    f"PASS - no conflicts\nOR\n"
                    f"CONFLICT: [description] | FIX: [suggestion]"
                )
                response = client.models.generate_content(
                    model="gemini-3-flash-preview",
                    contents=[analysis_prompt, image_part],
                    config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=200),
                )
                text = response.text.strip()
                if text.upper().startswith("PASS"):
                    checks.append(ReferenceCheck(
                        scene_number=scene_number, role=role, image_path=file_path,
                        conflict=None, severity="info", suggestion="", confidence=0.9,
                    ))
                elif text.upper().startswith("CONFLICT"):
                    parts = text.split("|")
                    conflict_desc = parts[0].replace("CONFLICT:", "").strip()
                    fix = parts[1].replace("FIX:", "").strip() if len(parts) > 1 else ""
                    checks.append(ReferenceCheck(
                        scene_number=scene_number, role=role, image_path=file_path,
                        conflict=conflict_desc, severity="error", suggestion=fix, confidence=0.85,
                    ))
            except Exception:
                pass

    return checks
