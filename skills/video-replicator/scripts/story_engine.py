#!/usr/bin/env python3
"""
Story Engine — Bottom-up video story generation.

Phase 0 script: generates storyboards, transition prompts, and enhanced prompts
using Gemini AI, outputting f2v_scenes.json for the video generation pipeline.

Three modes:
- story: lightweight concept → f2v_scenes.json (no full screenplay)
- transitions: analyze frame pairs with Gemini Vision for camera suggestions
- enhance: improve existing prompts with visual frame analysis

Usage:
    python story_engine.py story "A love story in Paris" --project my-project --shots 8
    python story_engine.py transitions --project my-project --images-dir "projects/test/images"
    python story_engine.py enhance --project my-project --config "f2v_scenes.json" --images-dir "projects/test/images"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from config import (
    GEMINI_FLASH_MODEL,
    GEMINI_PRO_MODEL,
    PROJECT_BASE,
    SCRIPTS_DIR,
    STORY_ENGINE_DEFAULT_SHOTS,
    STORY_ENGINE_DURATIONS,
    STORY_ENGINE_MAX_SHOTS,
)
from exceptions import StoryEngineError
from logging_config import setup_logging

logger = setup_logging(__name__)

# Gemini SDK — lazy import for graceful degradation
try:
    from google import genai

    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    GEMINI_AVAILABLE = False

# PIL for frame analysis
try:
    from PIL import Image
except ImportError:
    Image = None

VALID_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")

# Regex to match scene frame filenames:
# optional run prefix + scene_N_frame + optional suffix (_landscape, _cropped, etc.)
SCENE_FRAME_RE = re.compile(
    r"(?:run\d+_)?scene_(\d+)(?:_frame)?(?:_landscape|_cropped)?\.(?:jpg|jpeg|png|webp)$",
    re.IGNORECASE,
)


# ============================================================================
# Genre Detection
# ============================================================================

GENRE_KEYWORDS: dict[str, list[str]] = {
    "cinematic": ["cinematic", "film", "movie", "epic"],
    "commercial": ["ad", "commercial", "product", "brand", "luxury"],
    "nature": ["nature", "landscape", "ocean", "forest", "mountain", "sunset", "wildlife"],
    "action": ["fight", "battle", "chase", "explosion", "combat", "warrior"],
    "romance": ["love", "romance", "kiss", "couple", "wedding", "heart"],
    "horror": ["horror", "dark", "creepy", "scary", "gothic", "haunted"],
    "sci-fi": ["sci-fi", "space", "future", "robot", "alien", "cyberpunk", "neon"],
    "documentary": ["documentary", "real", "interview", "narrator", "educational"],
}


def detect_genre(text: str) -> str:
    """Detect genre from concept text using keyword matching.

    Scores each genre by counting keyword hits. Short keywords (<=3 chars)
    require exact word boundaries to avoid false positives.

    Args:
        text: Raw concept or scene description.

    Returns:
        Best-matching genre key, or "cinematic" as fallback.
    """
    text_lower = text.lower()
    scores: dict[str, int] = {}

    for genre, keywords in GENRE_KEYWORDS.items():
        score = 0
        for kw in keywords:
            if len(kw) <= 3:
                # Short keywords: exact word boundary on both sides
                if re.search(r"\b" + re.escape(kw) + r"\b", text_lower):
                    score += 1
            else:
                # Longer keywords: word boundary at start only (allows suffix matching)
                if re.search(r"\b" + re.escape(kw), text_lower):
                    score += 1
        if score > 0:
            scores[genre] = score

    if not scores:
        return "cinematic"

    max_score = max(scores.values())
    top_genres = [g for g, s in scores.items() if s == max_score]

    if len(top_genres) == 1:
        return top_genres[0]

    # Tiebreak: prefer content-specific genres over ambient ones
    _GENRE_PRIORITY = {
        "action": 10, "romance": 10, "horror": 10, "sci-fi": 10,
        "commercial": 9, "nature": 9, "documentary": 9,
        "cinematic": 3,  # lowest — acts as fallback
    }
    return max(top_genres, key=lambda g: _GENRE_PRIORITY.get(g, 5))


# ============================================================================
# Gemini Helpers
# ============================================================================


def _parse_json_response(text: str) -> any:
    """Extract and parse JSON from a Gemini response.

    Handles markdown-wrapped JSON (```json ... ```) and plain JSON.
    """
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]
    return json.loads(text.strip())


def _get_gemini_client():
    """Get a configured Gemini client.

    Raises:
        StoryEngineError: If google-genai is not installed or GOOGLE_API_KEY is missing.
    """
    if not GEMINI_AVAILABLE:
        raise StoryEngineError(
            "google-genai not installed. Run: pip install google-genai"
        )
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise StoryEngineError("GOOGLE_API_KEY environment variable not set")
    return genai.Client(api_key=api_key)


def _resolve_model(model: str) -> str:
    """Resolve 'flash'/'pro' shorthand to full model name."""
    if model == "flash":
        return GEMINI_FLASH_MODEL
    if model == "pro":
        return GEMINI_PRO_MODEL
    return model


def _normalize_duration(duration: int | str) -> int:
    """Ensure duration is one of the valid values (4, 6, or 8).

    Snaps to the nearest valid duration if the value is out of range.
    """
    try:
        d = int(duration)
    except (TypeError, ValueError):
        return 6
    if d not in STORY_ENGINE_DURATIONS:
        return min(STORY_ENGINE_DURATIONS, key=lambda x: abs(x - d))
    return d


# ============================================================================
# Utility Functions
# ============================================================================


def discover_frame_images(
    images_dir: str,
    prefer_landscape: bool = False,
) -> list[tuple[int, str]]:
    """Find and sort scene frame images in a directory.

    Looks for patterns: scene_N_frame.jpg, run*_scene_N_frame*.jpg, scene_N.jpg

    Args:
        images_dir: Path to directory containing frame images.
        prefer_landscape: If True, prefer _landscape.jpg variants when both exist.

    Returns:
        List of (scene_number, file_path) tuples sorted by scene number.
        When multiple files match the same scene, picks the best candidate.
    """
    if not os.path.isdir(images_dir):
        return []

    # Collect all matching files grouped by scene number
    scene_files: dict[int, list[str]] = {}

    for filename in os.listdir(images_dir):
        match = SCENE_FRAME_RE.search(filename)
        if match:
            scene_num = int(match.group(1))
            filepath = os.path.join(images_dir, filename)
            scene_files.setdefault(scene_num, []).append(filepath)

    # Pick best file per scene
    result = []
    for scene_num in sorted(scene_files.keys()):
        candidates = scene_files[scene_num]

        if len(candidates) == 1:
            result.append((scene_num, candidates[0]))
            continue

        # Rank candidates: prefer landscape suffix, then run-prefixed
        best = candidates[0]
        for candidate in candidates:
            basename = os.path.basename(candidate).lower()
            if prefer_landscape and "_landscape" in basename:
                best = candidate
                break
            if basename.startswith("run") and not os.path.basename(best).lower().startswith("run"):
                best = candidate

        result.append((scene_num, best))

    return result


def write_scenes_json(
    scenes: list[dict],
    output_path: str,
    extended: bool = True,
) -> str:
    """Write scenes to f2v_scenes.json format.

    Args:
        scenes: List of shot dicts with at least 'shot' and 'prompt' keys.
        output_path: Where to write the JSON file.
        extended: If True, writes dict format: {"1": {"prompt": "...", "duration": 8, ...}}
                  If False, writes simple format: {"1": "prompt string"}

    Returns:
        The output path written to.
    """
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    output = {}
    for shot in scenes:
        key = str(shot.get("shot", len(output) + 1))
        if extended:
            entry = {"prompt": shot.get("prompt", "")}
            if "duration" in shot:
                entry["duration"] = shot["duration"]
            if "description" in shot:
                entry["description"] = shot["description"]
            if "shot_story" in shot:
                entry["shot_story"] = shot["shot_story"]
            if "transition_to_next" in shot:
                entry["transition_to_next"] = shot["transition_to_next"]
            output[key] = entry
        else:
            output[key] = shot.get("prompt", "")

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    logger.info("Wrote %d scenes to %s", len(output), output_path)
    return output_path


def load_extended_scenes(config_path: str) -> tuple[dict, dict]:
    """Load f2v_scenes.json supporting both simple and extended formats.

    Returns:
        (scenes, metadata) where:
        - scenes: dict mapping scene_num (str) -> prompt (str)
        - metadata: dict mapping scene_num (str) -> full dict (for extended entries only)
    """
    with open(config_path) as f:
        raw = json.load(f)

    scenes = {}
    metadata = {}

    for key, value in raw.items():
        if isinstance(value, str):
            scenes[key] = value
        elif isinstance(value, dict):
            scenes[key] = value.get("prompt", "")
            metadata[key] = value
        else:
            scenes[key] = str(value)

    return scenes, metadata


# ============================================================================
# Mode 1: Story — One Sentence to Full Storyboard
# ============================================================================

STORYBOARD_SYSTEM_PROMPT = """Role: You are a professional film storyboard artist.
Context: You are creating shot-level prompts for video generation models (Veo / Seedance).

Use the SEALCAM framework for structured prompts:
- Subject: Who/what is in frame (detailed appearance)
- Environment: Setting, backdrop, atmosphere
- Action: Movement, what's happening
- Lighting: Quality, direction, mood
- Camera: Angle, movement, framing
- Audio: Music style, ambient sounds
- Metatokens: Style keywords (cinematic, 8K, etc.)

SAFETY GUIDELINES:
- If any part of the story suggests sexual content, graphic violence, self-harm,
  glorified death, hate, or illegal activities, rewrite into a safe, neutral version.
- All characters must be completely fictional. Do NOT use real-world person names.
- All human characters must be clearly adults in safe, non-exploitative contexts.
- Do NOT create realistic depictions of specific real people or celebrities.
"""


def generate_story(
    concept: str,
    num_shots: int = STORY_ENGINE_DEFAULT_SHOTS,
    genre: str | None = None,
    duration_per_shot: int = 8,
    model: str | None = None,
) -> list[dict]:
    """Generate a list of scene dicts from a concept.

    Each scene dict has: {"prompt": str, "duration": int, "description": str,
    "shot_story": str, "shot": int}. Shot 1 also has "heroSubject".

    Uses Gemini to generate a structured story with shots. If genre is None,
    auto-detects using detect_genre(). Falls back to simple template if
    Gemini is not available.

    Args:
        concept: One-sentence story concept.
        num_shots: Number of shots to generate (clamped to MAX_SHOTS).
        genre: Genre hint for style. Auto-detected if None.
        duration_per_shot: Default duration per shot (4, 6, or 8).
        model: Gemini model shorthand ("flash" or "pro"). Defaults to "flash".

    Returns:
        List of shot dicts with structured scene information.

    Raises:
        StoryEngineError: If Gemini is unavailable and no fallback is possible.
    """
    num_shots = min(max(1, num_shots), STORY_ENGINE_MAX_SHOTS)
    duration_per_shot = _normalize_duration(duration_per_shot)

    if genre is None:
        genre = detect_genre(concept)
        logger.info("Auto-detected genre: %s", genre)

    model = model or "flash"

    # Try Gemini first
    if GEMINI_AVAILABLE and os.environ.get("GOOGLE_API_KEY"):
        return _generate_story_gemini(concept, num_shots, genre, duration_per_shot, model)

    # Fallback: generate simple template-based scenes
    logger.warning("Gemini not available — using template fallback")
    return _generate_story_fallback(concept, num_shots, genre, duration_per_shot)


def _generate_story_gemini(
    concept: str,
    num_shots: int,
    genre: str,
    duration_per_shot: int,
    model: str,
) -> list[dict]:
    """Generate storyboard using Gemini AI."""
    client = _get_gemini_client()
    model_name = _resolve_model(model)

    valid_durations = ", ".join(str(d) for d in STORY_ENGINE_DURATIONS)

    user_prompt = f"""Create a continuous storyboard with EXACTLY {num_shots} shots for:
"{concept}"

Genre: {genre}

Requirements:
1. Continuous Story Arc — Beginning (25%), Middle (50%), End (25%)
2. Visual Consistency — Define a heroSubject in shot 1 for character consistency
3. Seamless Flow — Each shot continues immediately from the previous
4. Causal Relationship — Use transitional words (therefore, as a result, immediately after)
5. Temporal Continuity — Strict chronological order
6. Camera Variety — Use diverse camera movements (push in, tracking, crane, orbit, static)
7. Each prompt should be a detailed ENGLISH video generation prompt

Output ONLY a raw JSON array. Each element:
- shot: integer (1..{num_shots})
- prompt: Detailed video generation prompt with camera movement, lighting, atmosphere
- duration: integer, MUST be one of: {valid_durations}
- description: 1-sentence summary of the on-screen action
- shotStory: 2-3 sentences narrating this shot's role with causal transitions
- heroSubject: (ONLY shot 1) Detailed appearance description for character consistency
  (species/type, color, build, clothing, distinctive features)

Return ONLY the JSON array, no markdown, no comments."""

    full_prompt = f"{STORYBOARD_SYSTEM_PROMPT}\n\n{user_prompt}"

    logger.info("Generating storyboard: %d shots, genre=%s, model=%s", num_shots, genre, model_name)

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=full_prompt,
        )
        storyboard = _parse_json_response(response.text)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Gemini response as JSON: %s", e)
        raise StoryEngineError(f"Gemini returned invalid JSON: {e}") from e
    except Exception as e:
        logger.warning("Gemini call failed: %s — using fallback", e)
        return _generate_story_fallback(concept, num_shots, genre, duration_per_shot)

    # Post-process: normalize durations, add shot numbers, clean heroSubject
    for i, shot in enumerate(storyboard):
        shot["duration"] = _normalize_duration(shot.get("duration", duration_per_shot))
        shot.setdefault("shot", i + 1)
        shot.setdefault("description", "")
        # Normalize shotStory -> shot_story for internal consistency
        if "shotStory" in shot:
            shot["shot_story"] = shot.pop("shotStory")
        shot.setdefault("shot_story", "")

    # Ensure heroSubject only in shot 1
    for shot in storyboard[1:]:
        shot.pop("heroSubject", None)

    logger.info("Generated %d shots via Gemini", len(storyboard))
    return storyboard


def _generate_story_fallback(
    concept: str,
    num_shots: int,
    genre: str,
    duration_per_shot: int,
) -> list[dict]:
    """Generate a simple template-based storyboard without Gemini.

    Produces basic shot structures with generic camera movements.
    """
    camera_movements = [
        "Slow push in, cinematic",
        "Wide establishing shot",
        "Low angle tracking shot",
        "Close-up with shallow depth of field",
        "Smooth crane shot rising",
        "Handheld following shot",
        "Static locked-off frame",
        "Slow orbit around subject",
    ]

    arc_labels = {
        "beginning": "Story opens",
        "middle": "Action develops",
        "end": "Story concludes",
    }

    scenes = []
    for i in range(num_shots):
        # Determine story arc position
        progress = i / max(num_shots - 1, 1)
        if progress < 0.25:
            arc = "beginning"
        elif progress < 0.75:
            arc = "middle"
        else:
            arc = "end"

        camera = camera_movements[i % len(camera_movements)]
        shot = {
            "shot": i + 1,
            "prompt": f"{camera}. {concept}. {genre} style.",
            "duration": duration_per_shot,
            "description": f"{arc_labels[arc]} — shot {i + 1}",
            "shot_story": f"Shot {i + 1} of {num_shots}: {arc_labels[arc]}.",
        }
        if i == 0:
            shot["heroSubject"] = f"Main character in {concept}"
        scenes.append(shot)

    logger.info("Generated %d shots via template fallback", len(scenes))
    return scenes


# ============================================================================
# Mode 2: Transitions — AI Transition Prompts from Frame Pairs
# ============================================================================

TRANSITION_PROMPT_TEMPLATE = """Role: Expert Film Director and Cinematographer.
Context: You are generating prompts for video generation models (Veo / Seedance).

Frame A (current shot):
{context_a}

Frame B (next shot):
{context_b}

Analyze these two sequential storyboard frames.
1. Describe the specific camera movement and visual transition to bridge
   these shots seamlessly (e.g., "Slow dolly zoom in while panning right").
2. Determine optimal duration (MUST be 4, 6, or 8 seconds).
3. Identify the primary camera movement type.

Output ONLY raw JSON:
{{
  "prompt": "Detailed cinematic transition description...",
  "duration": 8,
  "camera_movement": "tracking_left",
  "description": "Brief summary of this transition"
}}"""

CLOSING_PROMPT_TEMPLATE = """Role: Expert Film Director and Cinematographer.
Context: You are generating a closing shot prompt for the final frame of a video.

Final frame context:
{context}

Generate a prompt for a final lingering shot that provides an elegant
cinematic conclusion. The camera should hold, with subtle ambient motion.

Output ONLY raw JSON:
{{
  "prompt": "Hold on the final frame with a gentle cinematic finish...",
  "duration": 6,
  "camera_movement": "static_hold",
  "description": "Closing shot summary"
}}"""

# Fallback camera suggestions when Gemini is not available
_FALLBACK_CAMERAS = [
    "smooth_push_in",
    "tracking_left",
    "slow_orbit",
    "crane_up",
    "dolly_zoom",
    "static_hold",
    "pull_back_reveal",
    "handheld_follow",
]


def analyze_frame_transition(
    frame_a: str,
    frame_b: str,
    context_a: str = "",
    context_b: str = "",
    model: str = "flash",
) -> dict:
    """Analyze transition between two frames using Gemini Vision.

    Uses Gemini with both images and asks for camera movement suggestion.
    If Gemini API is not available, returns a fallback with generic suggestions.

    Args:
        frame_a: Path to the first frame image.
        frame_b: Path to the second frame image.
        context_a: Optional narrative context for frame A.
        context_b: Optional narrative context for frame B.
        model: Gemini model shorthand.

    Returns:
        Dict with: prompt, duration, camera_movement, description.
    """
    # Try Gemini Vision
    if GEMINI_AVAILABLE and os.environ.get("GOOGLE_API_KEY") and Image is not None:
        try:
            client = _get_gemini_client()
            model_name = _resolve_model(model)

            img_a = Image.open(frame_a)
            img_b = Image.open(frame_b)

            prompt_text = TRANSITION_PROMPT_TEMPLATE.format(
                context_a=context_a or "No context provided.",
                context_b=context_b or "No context provided.",
            )

            response = client.models.generate_content(
                model=model_name,
                contents=[prompt_text, img_a, img_b],
            )
            result = _parse_json_response(response.text)
            result["duration"] = _normalize_duration(result.get("duration", 6))
            return result
        except (json.JSONDecodeError, KeyError, Exception) as e:
            logger.warning("Failed to parse transition response: %s", e)

    # Fallback: generic transition suggestion
    import hashlib
    hash_val = int(hashlib.md5((frame_a + frame_b).encode()).hexdigest()[:8], 16)
    camera = _FALLBACK_CAMERAS[hash_val % len(_FALLBACK_CAMERAS)]

    return {
        "prompt": f"Smooth cinematic transition, {camera.replace('_', ' ')}",
        "duration": 6,
        "camera_movement": camera,
        "description": "Auto-generated transition (Gemini unavailable)",
    }


def analyze_closing_shot(
    last_frame: str,
    context: str = "",
    model: str = "flash",
) -> dict:
    """Analyze the final frame for closing shot suggestion.

    Args:
        last_frame: Path to the final frame image.
        context: Optional narrative context for the closing.
        model: Gemini model shorthand.

    Returns:
        Dict with: prompt, duration, camera_movement, description.
    """
    if GEMINI_AVAILABLE and os.environ.get("GOOGLE_API_KEY") and Image is not None:
        try:
            client = _get_gemini_client()
            model_name = _resolve_model(model)

            img = Image.open(last_frame)

            prompt_text = CLOSING_PROMPT_TEMPLATE.format(
                context=context or "No context provided.",
            )

            response = client.models.generate_content(
                model=model_name,
                contents=[prompt_text, img],
            )
            result = _parse_json_response(response.text)
            result["duration"] = _normalize_duration(result.get("duration", 6))
            return result
        except (json.JSONDecodeError, KeyError, Exception) as e:
            logger.warning("Failed to parse closing shot response: %s", e)

    # Fallback
    return {
        "prompt": "Hold on the final frame with a gentle cinematic finish, subtle ambient light shift",
        "duration": 6,
        "camera_movement": "static_hold",
        "description": "Closing shot (Gemini unavailable)",
    }


def analyze_transitions(
    frames_dir: str,
    output_path: str | None = None,
    model: str = "flash",
) -> list[dict]:
    """Analyze all frame pairs in a directory.

    Discovers frames, analyzes each adjacent pair, and generates a closing
    shot for the last frame.

    Args:
        frames_dir: Directory containing scene frame images.
        output_path: Optional path to write f2v_scenes.json output.
        model: Gemini model shorthand.

    Returns:
        List of transition analysis dicts.
    """
    frames = discover_frame_images(frames_dir, prefer_landscape=True)
    if len(frames) < 2:
        logger.error("Need at least 2 frame images. Found %d in %s", len(frames), frames_dir)
        return []

    logger.info("Analyzing %d frame pairs + 1 closing shot", len(frames) - 1)
    scenes = []

    # Analyze adjacent pairs
    for i in range(len(frames) - 1):
        scene_a, path_a = frames[i]
        scene_b, path_b = frames[i + 1]

        logger.info("Analyzing transition: scene %d -> %d", scene_a, scene_b)
        result = analyze_frame_transition(
            path_a, path_b,
            model=model,
        )

        scenes.append({
            "shot": scene_a,
            "prompt": result["prompt"],
            "duration": result["duration"],
            "description": result.get("description", f"Transition {scene_a}->{scene_b}"),
            "transition_to_next": result.get("camera_movement", ""),
        })

    # Closing shot
    last_scene, last_path = frames[-1]
    logger.info("Generating closing shot for scene %d", last_scene)
    closing = analyze_closing_shot(last_path, model=model)

    scenes.append({
        "shot": last_scene,
        "prompt": closing["prompt"],
        "duration": closing["duration"],
        "description": closing.get("description", "Closing shot"),
    })

    # Write output if path provided
    if output_path:
        write_scenes_json(scenes, output_path, extended=True)

    return scenes


# ============================================================================
# Mode 3: Enhance — Improve Existing Prompts with Frame Analysis
# ============================================================================

ENHANCE_PROMPT_TEMPLATE = """Role: Expert Cinematographer reviewing video generation prompts.

Current prompt: {existing_prompt}
Current duration: {existing_duration}

Analyze this frame and improve the prompt by:
1. Adding specific camera movement that matches the visual composition
2. Adding atmospheric/lighting details visible in the frame
3. Ensuring the prompt captures the mood and tone of the image
4. Adjusting duration if the visual complexity warrants it

Output ONLY raw JSON:
{{
  "prompt": "Enhanced prompt with better camera movement and atmosphere...",
  "duration": 8,
  "camera_movement": "tracking_left",
  "reasoning": "Why this enhancement improves the shot"
}}"""


def enhance_prompts(
    scenes_json: str,
    frames_dir: str | None = None,
    model: str = "flash",
) -> list[dict]:
    """Enhance existing f2v_scenes.json prompts with visual analysis.

    Reads the scenes file, optionally analyzes matching frames,
    enriches prompts with camera/lighting/atmosphere suggestions.

    Args:
        scenes_json: Path to existing f2v_scenes.json.
        frames_dir: Optional directory with corresponding frame images.
        model: Gemini model shorthand.

    Returns:
        Enhanced scene list with improved prompts.
    """
    scenes_dict, metadata = load_extended_scenes(scenes_json)

    # Build frame map if images directory provided
    frame_map: dict[int, str] = {}
    if frames_dir:
        frames = discover_frame_images(frames_dir, prefer_landscape=True)
        frame_map = {scene_num: path for scene_num, path in frames}

    enhanced = []
    for key, prompt in scenes_dict.items():
        scene_num = int(key)
        existing_duration = metadata.get(key, {}).get("duration")

        if scene_num in frame_map:
            logger.info("Enhancing scene %d with frame analysis", scene_num)
            result = _enhance_single_prompt(
                frame_map[scene_num], prompt,
                existing_duration=existing_duration,
                model=model,
            )
            enhanced.append({
                "shot": scene_num,
                "prompt": result["prompt"],
                "duration": result["duration"],
                "description": metadata.get(key, {}).get("description", ""),
                "shot_story": metadata.get(key, {}).get("shot_story", ""),
            })
        else:
            # No frame available — keep original
            logger.debug("No frame for scene %d — keeping original prompt", scene_num)
            enhanced.append({
                "shot": scene_num,
                "prompt": prompt,
                "duration": _normalize_duration(existing_duration or 6),
                "description": metadata.get(key, {}).get("description", ""),
                "shot_story": metadata.get(key, {}).get("shot_story", ""),
            })

    return enhanced


def _enhance_single_prompt(
    frame_path: str,
    existing_prompt: str,
    existing_duration: int | None = None,
    model: str = "flash",
) -> dict:
    """Enhance a single prompt using Gemini's analysis of the frame image.

    Returns dict with: prompt, duration, camera_movement, reasoning.
    Falls back to original prompt on error.
    """
    if GEMINI_AVAILABLE and os.environ.get("GOOGLE_API_KEY") and Image is not None:
        try:
            client = _get_gemini_client()
            model_name = _resolve_model(model)

            img = Image.open(frame_path)

            prompt_text = ENHANCE_PROMPT_TEMPLATE.format(
                existing_prompt=existing_prompt,
                existing_duration=existing_duration or "not specified",
            )

            response = client.models.generate_content(
                model=model_name,
                contents=[prompt_text, img],
            )
            result = _parse_json_response(response.text)
            result["duration"] = _normalize_duration(result.get("duration", existing_duration or 6))
            return result
        except (json.JSONDecodeError, KeyError, Exception) as e:
            logger.warning("Failed to parse enhancement response: %s", e)

    # Fallback: return original prompt unchanged
    return {
        "prompt": existing_prompt,
        "duration": _normalize_duration(existing_duration or 6),
        "camera_movement": "unknown",
        "reasoning": "Enhancement unavailable (Gemini not configured)",
    }


# Keep backward-compatible alias used in tests/design doc
enhance_prompt_with_frame = _enhance_single_prompt


# ============================================================================
# Go Bananas Output Helper
# ============================================================================


def print_go_bananas_commands(
    storyboard: list[dict],
    character_id: int | None = None,
    style: str = "",
) -> None:
    """Print Go Bananas MCP commands for image generation.

    Step 1: Character creation from heroSubject (if present in shot 1)
    Step 2: Scene image generation per shot

    Args:
        storyboard: List of shot dicts from generate_story().
        character_id: Optional existing Go Bananas character ID.
        style: Art style for character reference (e.g., "Pixar 3D animated").
    """
    hero_subject = storyboard[0].get("heroSubject") if storyboard else None

    if hero_subject:
        char_style = f", {style} style" if style else ""
        print("\n# Step 1: Create character reference from heroSubject")
        print("# Execute this MCP call, then use --save-character-ids with the returned ID\n")
        print(f"""mcp__go_bananas__generate_image(
    prompt="Character reference sheet, {hero_subject}{char_style}, white background, full body portrait",
    aspect_ratio="square",
    model_id="gemini-pro-image"
)""")
        print("\n# After downloading, create the character:")
        print("""# mcp__go_bananas__create_character(name="Hero", images=[<downloaded_url>])""")
        print()

    print("# Step 2: Generate scene images")
    if not character_id and hero_subject:
        print("# NOTE: Replace <CHARACTER_ID> with the ID from Step 1\n")

    for shot in storyboard:
        shot_num = shot.get("shot", "?")
        prompt = shot.get("prompt", "")
        char_id = character_id or "<CHARACTER_ID>"

        print(f"# Scene {shot_num}: {shot.get('description', '')}")
        print(f"""mcp__go_bananas__generate_image(
    prompt="WIDE HORIZONTAL shot, {prompt}",
    character_ids=[{char_id}],
    aspect_ratio="16:9",
    model_id="gemini-pro-image"
)
""")


# ============================================================================
# CLI Subcommands
# ============================================================================


def cmd_story(args) -> None:
    """Execute story mode: one sentence -> storyboard + Go Bananas commands."""
    storyboard = generate_story(
        concept=args.concept,
        num_shots=args.num_shots,
        genre=args.genre,
        duration_per_shot=args.duration,
        model=args.model,
    )

    # Determine output paths
    project_dir = os.path.join(PROJECT_BASE, args.project) if args.project else "."
    os.makedirs(project_dir, exist_ok=True)

    # Write storyboard metadata
    storyboard_path = os.path.join(project_dir, "storyboard.json")
    with open(storyboard_path, "w") as f:
        json.dump(storyboard, f, indent=2)
    logger.info("Saved storyboard metadata to %s", storyboard_path)

    # Write f2v_scenes.json
    output_path = args.output or os.path.join(project_dir, "f2v_scenes.json")
    write_scenes_json(storyboard, output_path, extended=True)

    # Print summary
    print(f"\n{'=' * 60}")
    print(f"Storyboard: {len(storyboard)} shots")
    print(f"{'=' * 60}")
    for shot in storyboard:
        dur = shot.get("duration", "?")
        desc = shot.get("description", shot.get("prompt", "")[:60])
        print(f"  Shot {shot['shot']} ({dur}s): {desc}")
    print(f"{'=' * 60}\n")

    # Print Go Bananas commands
    print_go_bananas_commands(storyboard, style=args.genre or "")

    print(f"\nOutputs:")
    print(f"  Storyboard: {storyboard_path}")
    print(f"  Scenes:     {output_path}")
    print(f"\nNext steps:")
    print(f"  1. Execute the Go Bananas MCP commands above to generate images")
    if args.project:
        print(f"  2. Save images to projects/{args.project}/images/")
        print(f"  3. Run: python parallel_video_gen.py --product {args.project} "
              f"--config {output_path} --mode frames-to-video --ratio landscape")


def cmd_transitions(args) -> None:
    """Execute transitions mode: analyze frame pairs -> AI transition prompts."""
    images_dir = args.frames_dir
    if not os.path.isdir(images_dir):
        logger.error("Images directory not found: %s", images_dir)
        sys.exit(1)

    scenes = analyze_transitions(
        frames_dir=images_dir,
        model=args.model,
    )

    if not scenes:
        logger.error("No transitions generated")
        sys.exit(1)

    # Write output
    project_dir = os.path.join(PROJECT_BASE, args.project) if args.project else "."
    os.makedirs(project_dir, exist_ok=True)
    output_path = args.output or os.path.join(project_dir, "f2v_scenes.json")
    write_scenes_json(scenes, output_path, extended=True)

    # Print summary
    print(f"\n{'=' * 60}")
    print(f"Transition Analysis: {len(scenes)} scenes")
    print(f"{'=' * 60}")
    for s in scenes:
        dur = s.get("duration", "?")
        desc = s.get("description", s.get("prompt", "")[:60])
        print(f"  Scene {s['shot']} ({dur}s): {desc}")
    print(f"{'=' * 60}\n")
    print(f"Output: {output_path}")
    if args.project:
        print(f"\nNext: python parallel_video_gen.py --product {args.project} "
              f"--config {output_path} --mode frames-to-video --ratio landscape")


def cmd_enhance(args) -> None:
    """Execute enhance mode: improve existing prompts with frame analysis."""
    if not os.path.exists(args.scenes):
        logger.error("Scenes file not found: %s", args.scenes)
        sys.exit(1)

    enhanced = enhance_prompts(
        scenes_json=args.scenes,
        frames_dir=args.frames_dir,
        model=args.model,
    )

    # Write output
    project_dir = os.path.join(PROJECT_BASE, args.project) if args.project else "."
    os.makedirs(project_dir, exist_ok=True)

    # Backup original if not already backed up
    backup_path = os.path.join(project_dir, "f2v_scenes_original.json")
    if not os.path.exists(backup_path):
        with open(args.scenes) as f:
            original = json.load(f)
        with open(backup_path, "w") as f:
            json.dump(original, f, indent=2)
        logger.info("Backed up original to %s", backup_path)

    output_path = args.output or os.path.join(project_dir, "f2v_scenes_enhanced.json")
    write_scenes_json(enhanced, output_path, extended=True)

    # Print enhancement summary
    scenes_dict, _ = load_extended_scenes(args.scenes)
    changed = 0
    for scene in enhanced:
        key = str(scene["shot"])
        original_prompt = scenes_dict.get(key, "")
        if scene["prompt"] != original_prompt:
            changed += 1
            print(f"  Scene {key}:")
            print(f"    Before: {original_prompt[:80]}...")
            print(f"    After:  {scene['prompt'][:80]}...")
            print()

    print(f"\nEnhanced {changed}/{len(enhanced)} scenes")
    print(f"Original: {backup_path}")
    print(f"Enhanced: {output_path}")
    if args.project:
        print(f"\nNext: python parallel_video_gen.py --product {args.project} "
              f"--config {output_path} --mode frames-to-video --ratio landscape")


# ============================================================================
# CLI Parser
# ============================================================================


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser with story/transitions/enhance subcommands."""
    parser = argparse.ArgumentParser(
        description="Story Engine — Bottom-up video story generation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s story "A love story in Paris" --project my-project --num-shots 8
  %(prog)s transitions --project my-project --frames-dir projects/test/images
  %(prog)s enhance --project my-project --scenes f2v_scenes.json --frames-dir projects/test/images
""",
    )
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose logging")

    subparsers = parser.add_subparsers(dest="command")

    # --- story ---
    story_p = subparsers.add_parser(
        "story",
        help="Generate storyboard from one sentence",
    )
    story_p.add_argument("concept", help="Story concept (one sentence)")
    story_p.add_argument("--project", default=None, help="Project slug")
    story_p.add_argument("--num-shots", type=int, default=STORY_ENGINE_DEFAULT_SHOTS,
                         help=f"Number of shots (default: {STORY_ENGINE_DEFAULT_SHOTS}, max: {STORY_ENGINE_MAX_SHOTS})")
    story_p.add_argument("--genre", default=None,
                         help="Genre hint (auto-detected if omitted)")
    story_p.add_argument("--duration", type=int, default=8,
                         help="Default duration per shot in seconds (4, 6, or 8)")
    story_p.add_argument("--model", choices=["flash", "pro"], default="flash",
                         help="Gemini model: flash (fast) or pro (quality)")
    story_p.add_argument("--output", default=None,
                         help="Output path for f2v_scenes.json")
    story_p.add_argument("--yes", "-y", action="store_true",
                         help="Skip confirmation prompts")

    # --- transitions ---
    trans_p = subparsers.add_parser(
        "transitions",
        help="Generate transition prompts from frame images",
    )
    trans_p.add_argument("--project", default=None, help="Project slug")
    trans_p.add_argument("--frames-dir", required=True,
                         help="Directory containing frame images")
    trans_p.add_argument("--model", choices=["flash", "pro"], default="flash",
                         help="Gemini model: flash (fast) or pro (quality)")
    trans_p.add_argument("--output", default=None,
                         help="Output path for f2v_scenes.json")
    trans_p.add_argument("--yes", "-y", action="store_true",
                         help="Skip confirmation prompts")

    # --- enhance ---
    enh_p = subparsers.add_parser(
        "enhance",
        help="Enhance existing prompts with frame analysis",
    )
    enh_p.add_argument("--project", default=None, help="Project slug")
    enh_p.add_argument("--scenes", required=True,
                       help="Path to existing f2v_scenes.json")
    enh_p.add_argument("--frames-dir", default=None,
                       help="Directory with frame images for visual analysis")
    enh_p.add_argument("--model", choices=["flash", "pro"], default="flash",
                       help="Gemini model: flash (fast) or pro (quality)")
    enh_p.add_argument("--output", default=None,
                       help="Output path for enhanced f2v_scenes.json")
    enh_p.add_argument("--yes", "-y", action="store_true",
                       help="Skip confirmation prompts")

    return parser


def main() -> None:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args()

    if args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    dispatch = {
        "story": cmd_story,
        "transitions": cmd_transitions,
        "enhance": cmd_enhance,
    }

    try:
        dispatch[args.command](args)
    except StoryEngineError as e:
        logger.error("Story engine error: %s", e)
        sys.exit(1)
    except KeyboardInterrupt:
        logger.info("Interrupted")
        sys.exit(130)


if __name__ == "__main__":
    main()
