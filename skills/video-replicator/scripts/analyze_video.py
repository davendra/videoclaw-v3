#!/usr/bin/env python3
"""
Video Analysis Script using Gemini 1.5 Pro (SEALCAM+ Enhanced)
Analyzes a video and outputs detailed SEALCAM+ scene breakdown as JSON.

Usage:
    python analyze_video.py --video "path/or/url" --output "output.json"
    python analyze_video.py --video "https://youtube.com/watch?v=xxx" --output "sealcam.json"
    python analyze_video.py --video "input.mp4" --project "prada-snow" --save-to-db

Requirements:
    pip install google-genai yt-dlp

Environment:
    GOOGLE_API_KEY - Required for Gemini API access
"""

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: google-genai not installed. Run: pip install google-genai")
    sys.exit(1)

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from exceptions import VideoProcessingError
from logging_config import setup_logging

# Logger configured in main() with --verbose flag; default INFO for library use
logger = setup_logging(__name__)

try:
    from db import VideoReplicatorDB
except ImportError:
    VideoReplicatorDB = None


def repair_json(text: str) -> str:
    """Attempt to repair common JSON issues from Gemini responses.

    Fixes:
        1. Trailing commas before } and ] (e.g., {"key": "value",} -> {"key": "value"})
        2. JavaScript-style comments (// line and /* block */)
        3. Single-quoted strings -> double-quoted strings (careful with apostrophes)
        4. Truncated JSON (close unclosed brackets/braces)
        5. Leading/trailing non-JSON content (e.g., "Here is the analysis:\\n{...}")

    Args:
        text: Raw text that may contain malformed JSON.

    Returns:
        Repaired text that is more likely to be valid JSON.
    """
    if not text or not text.strip():
        return text

    result = text.strip()

    # --- Step 1: Strip leading/trailing non-JSON content ---
    # Remove markdown code blocks (```json ... ``` or ``` ... ```)
    if result.startswith("```"):
        lines = result.split("\n")
        # Remove first line (```json or ```) and last line (```)
        start_idx = 1
        end_idx = len(lines)
        for i in range(len(lines) - 1, 0, -1):
            if lines[i].strip() == "```":
                end_idx = i
                break
        result = "\n".join(lines[start_idx:end_idx])

    # Strip leading prose before first { or [
    first_brace = result.find("{")
    first_bracket = result.find("[")
    if first_brace == -1 and first_bracket == -1:
        # No JSON structure found at all, return as-is
        return result
    elif first_brace == -1:
        json_start = first_bracket
    elif first_bracket == -1:
        json_start = first_brace
    else:
        json_start = min(first_brace, first_bracket)

    if json_start > 0:
        result = result[json_start:]

    # Strip trailing non-JSON content after the JSON body.
    # Only strip if the remaining text after the last } or ] is clearly
    # non-JSON (letters, prose). Do NOT strip if we're in a truncated
    # JSON scenario where the last } is inside a partial structure.
    last_brace = result.rfind("}")
    last_bracket = result.rfind("]")
    if last_brace == -1 and last_bracket == -1:
        pass  # No closing found; will be handled by truncation repair
    else:
        json_end = max(last_brace, last_bracket)
        trailing = result[json_end + 1:].strip()
        if trailing:
            # Only strip if trailing content looks like prose (not JSON structure)
            # If trailing starts with , { [ or is empty, it's likely truncated JSON
            if trailing and not trailing[0] in ',{[':
                result = result[:json_end + 1]

    # --- Step 2: Remove JavaScript-style comments ---
    # Remove block comments /* ... */ (non-greedy)
    result = re.sub(r'/\*.*?\*/', '', result, flags=re.DOTALL)
    # Remove line comments // ... (but not inside strings)
    # Simple approach: remove // comments that appear after the value portion
    # We process line by line to avoid breaking URLs in string values
    lines = result.split("\n")
    cleaned_lines = []
    for line in lines:
        # Only strip // comments that are outside of string values
        # Heuristic: if // appears after an even number of unescaped quotes, it's a comment
        in_string = False
        i = 0
        comment_pos = -1
        while i < len(line):
            ch = line[i]
            if ch == '\\' and in_string:
                i += 2  # skip escaped character
                continue
            if ch == '"':
                in_string = not in_string
            elif ch == '/' and not in_string and i + 1 < len(line) and line[i + 1] == '/':
                comment_pos = i
                break
            i += 1
        if comment_pos >= 0:
            line = line[:comment_pos]
        cleaned_lines.append(line)
    result = "\n".join(cleaned_lines)

    # --- Step 3: Fix single-quoted strings -> double-quoted strings ---
    # This is tricky because of apostrophes inside values.
    # Strategy: only convert single quotes that appear to be JSON string delimiters
    # i.e., a single quote that follows/precedes JSON structural characters: : , [ { } ]
    # We do a careful character-by-character pass.
    result = _fix_single_quotes(result)

    # --- Step 4: Remove trailing commas before } and ] ---
    # Match comma followed by optional whitespace and then } or ]
    result = re.sub(r',\s*([}\]])', r'\1', result)

    # --- Step 5: Handle truncated JSON by closing unclosed brackets/braces ---
    result = _close_truncated_json(result)

    return result


def _fix_single_quotes(text: str) -> str:
    """Replace single-quoted JSON strings with double-quoted strings.

    Only converts quotes that look like JSON string delimiters, not
    apostrophes within already double-quoted strings or natural English text.
    """
    # Quick check: if there are no single quotes, nothing to do
    if "'" not in text:
        return text

    # If the text already parses as JSON, no need to touch it
    try:
        json.loads(text)
        return text
    except (json.JSONDecodeError, ValueError):
        pass

    # Character-by-character replacement
    chars = list(text)
    in_double_string = False
    in_single_string = False
    i = 0
    while i < len(chars):
        ch = chars[i]
        if ch == '\\' and (in_double_string or in_single_string):
            i += 2  # skip escaped char
            continue
        if ch == '"' and not in_single_string:
            in_double_string = not in_double_string
        elif ch == "'" and not in_double_string:
            if not in_single_string:
                # Check if this looks like a JSON key/value delimiter
                # Look at surrounding context
                before = text[:i].rstrip()
                if before and before[-1] in ':{[,':
                    chars[i] = '"'
                    in_single_string = True
                # Also handle start of text or after whitespace following structural chars
                elif not before:
                    chars[i] = '"'
                    in_single_string = True
            else:
                # We're closing a single-quoted string
                # Check if the next non-whitespace char is a JSON structural character
                after = text[i + 1:].lstrip()
                if not after or after[0] in ':,}]\n':
                    chars[i] = '"'
                    in_single_string = False
                else:
                    # Likely an apostrophe inside the string value — leave it
                    pass
        i += 1

    return "".join(chars)


def _close_truncated_json(text: str) -> str:
    """Close unclosed brackets and braces in truncated JSON.

    Walks the text tracking open/close of { } [ ] while respecting strings,
    then appends any missing closing characters.
    """
    # First try parsing — if it works, no fix needed
    try:
        json.loads(text)
        return text
    except (json.JSONDecodeError, ValueError):
        pass

    stack = []
    in_string = False
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == '\\' and in_string:
            i += 2
            continue
        if ch == '"' and not in_string:
            in_string = True
        elif ch == '"' and in_string:
            in_string = False
        elif not in_string:
            if ch == '{':
                stack.append('}')
            elif ch == '[':
                stack.append(']')
            elif ch in '}]':
                if stack and stack[-1] == ch:
                    stack.pop()
        i += 1

    # If we're inside an unclosed string, close it
    if in_string:
        text += '"'

    # Remove any trailing comma before we close brackets
    text = text.rstrip()
    if text.endswith(','):
        text = text[:-1]

    # Close remaining open brackets/braces in reverse order
    while stack:
        text += stack.pop()

    return text


SEALCAM_PLUS_SYSTEM_PROMPT = """You are a professional video analysis agent specializing in cinematic commercial breakdowns. Your task is to analyze provided videos and dissect them into clear sequential scenes using the enhanced SEALCAM+ framework.

## SEALCAM+ Framework

For each scene, provide detailed structured analysis:

### S (Subject)
- **appearance**: Detailed description of who/what is shown (age, gender, style, clothing, features)
- **pose**: Body position and posture at the start of the scene
- **position_in_frame**: Where the subject is (left/center/right, foreground/midground/background)
- **facing_direction**: Which way the subject faces (left/right/camera/away)

### E (Environment)
- **setting**: Main location description
- **depth_layers**: What's in foreground, midground, background
- **ground_plane**: Surface type, reflections, shadows on ground
- **atmospheric_elements**: Particles, fog, dust, weather effects if any

### A (Action) - DETAILED STRUCTURE
- **primary**: Main movement or activity (e.g., "walking left to right in profile view")
- **secondary**: Array of concurrent movements (e.g., ["arm swing", "head turn"])
- **speed**: Speed descriptor + percentage estimate (e.g., "slow (30%)")
- **path**: Direction and trajectory (e.g., "linear left-to-right, no depth change")
- **start_pose**: Position/posture at scene start
- **end_pose**: Position/posture at scene end
- **keyframes**: Array of key moments with timestamps:
  - {"time": "0.0s", "percentage": "0%", "description": "enters frame left"}
  - {"time": "1.5s", "percentage": "50%", "description": "crosses frame center"}
  - {"time": "3.0s", "percentage": "100%", "description": "exits frame right"}

### Micromotion
- **breathing**: Visibility and rhythm (e.g., "subtle chest rise")
- **fabric**: How clothing moves (e.g., "jacket catches light on movement")
- **hair**: Hair physics (e.g., "slight sway following head movement")
- **weight_shifts**: Balance changes (e.g., "alternating left-right with walking rhythm")

### L (Lighting)
- **setup**: Lighting style (3-point, natural, dramatic, high-key, low-key)
- **direction**: Where light comes from (front, side, back, rim, top)
- **quality**: Hard/soft, diffused, specular
- **shadows**: Shadow behavior (minimal, dramatic, moving)

### C (Camera) - DETAILED STRUCTURE
- **shot_type**: Wide, medium, close-up, ECU
- **angle**: Eye level, low, high, dutch
- **movement_type**: Static, pan, dolly, tracking, crane, handheld
- **movement_speed**: If moving, how fast (linear, ease-in, ease-out)
- **movement_direction**: If moving, which direction (e.g., "left-to-right")
- **focus**: Rack focus, follow focus, deep focus

### A (Audio)
- **style**: Genre and mood
- **tempo_bpm**: Estimated BPM if music present
- **instruments**: Key instruments heard
- **sync_points**: Key moments music syncs with visuals

### M (Metatokens)
- **visual_style**: Cinematic, documentary, editorial, etc.
- **era**: Modern, retro, futuristic
- **quality**: 8K, film grain, color grade descriptors
- **mood**: Emotional tone

## Output Format

Return your analysis as valid JSON only, no markdown code blocks:

{
  "video_analysis": {
    "overall_vibe": "Brief description of the video's aesthetic and mood",
    "total_duration": 15,
    "scene_count": 4,
    "content_scene_count": 3,
    "transition_scene_count": 1,
    "pacing": "Description of rhythm (fast cuts, slow transitions, etc.)",
    "brand_category": "Product/service category",
    "aspect_ratio": "16:9"
  },
  "scenes": [
    {
      "scene_number": 1,
      "timestamp": "0:00-0:03",
      "duration_seconds": 3,
      "scene_type": "content",
      "skip_recommended": false,
      "subject": {
        "appearance": "Detailed description",
        "pose": "Starting pose",
        "position_in_frame": "center, midground",
        "facing_direction": "right"
      },
      "environment": {
        "setting": "Location description",
        "depth_layers": {
          "foreground": "What's in front",
          "midground": "Where subject is",
          "background": "What's behind"
        },
        "ground_plane": "Surface description",
        "atmospheric_elements": null
      },
      "action": {
        "primary": "Main action",
        "secondary": ["secondary 1", "secondary 2"],
        "speed": "slow (30%)",
        "path": "left-to-right, linear",
        "start_pose": "entering frame left",
        "end_pose": "exiting frame right",
        "keyframes": [
          {"time": "0.0s", "percentage": "0%", "description": "state at start"},
          {"time": "1.5s", "percentage": "50%", "description": "state at midpoint"},
          {"time": "3.0s", "percentage": "100%", "description": "state at end"}
        ]
      },
      "micromotion": {
        "breathing": "subtle" or null,
        "fabric": "catches light on movement",
        "hair": "slight sway" or null,
        "weight_shifts": "alternating with walk" or null
      },
      "lighting": {
        "setup": "high-key studio",
        "direction": "front with rim",
        "quality": "soft, diffused",
        "shadows": "minimal"
      },
      "camera": {
        "shot_type": "medium shot",
        "angle": "eye level",
        "movement_type": "tracking",
        "movement_speed": "linear, matches subject",
        "movement_direction": "left-to-right",
        "focus": "follow focus"
      },
      "audio": {
        "style": "minimal electronic",
        "tempo_bpm": 95,
        "instruments": ["synth pads", "subtle bass"],
        "sync_points": []
      },
      "metatokens": {
        "visual_style": "cinematic, luxury",
        "era": "modern",
        "quality": "8K",
        "mood": "sophisticated"
      }
    }
  ],
  "music_prompt": "Detailed prompt for generating matching background music",
  "continuity_notes": {
    "subject_consistency": "Notes on keeping subject appearance consistent",
    "scene_transitions": [
      {"from": 1, "to": 2, "transition_type": "cut", "continuity_concern": "position"}
    ]
  }
}

## Important Rules

1. Ignore any text overlays, logos, or watermarks in your descriptions - we want clean plates
2. Use specific cinematography terminology
3. Be precise about durations and keyframe timings
4. Focus on reproducible visual elements
5. Each scene should be self-contained and independently generatable
6. For subjects (people), describe in ways that can be swapped (age, gender, style, not identity)
7. Capture micromotion details - these are crucial for realistic video generation
8. Note scene-to-scene continuity concerns
9. Use percentage-based keyframes (0%, 50%, 100%) for duration-agnostic timing
10. Distinguish between camera movement and subject movement clearly

## Scene Type Detection (v2.14)

For each scene, identify the scene_type:
- **"content"**: Main content with subjects, action, and environment (should be recreated)
- **"transition"**: Blank/solid color backgrounds, text overlays, or minimal visual content (should be skipped)
- **"text_overlay"**: Primarily text/graphics over simple background (should be skipped)

Set **skip_recommended: true** for scenes that:
- Have blank/solid color backgrounds (white, black, solid colors)
- Show only text, logos, or graphics without subjects
- Have duration < 1.5 seconds with no meaningful action
- Are purely transitional (fade to black, etc.)

This helps downstream tools automatically filter out non-content scenes.
"""


def download_video(url: str, output_dir: str) -> str:
    """Download video from URL using yt-dlp."""
    try:
        import yt_dlp
    except ImportError:
        logger.error("yt-dlp not installed. Run: pip install yt-dlp")
        sys.exit(1)

    output_path = os.path.join(output_dir, "reference_video.mp4")

    ydl_opts = {
        'format': 'best[ext=mp4]/best',
        'outtmpl': output_path,
        'quiet': True,
        'no_warnings': True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    return output_path


def analyze_video(video_path: str, api_key: str, model_name: str = "gemini-3-flash-preview") -> dict:
    """Analyze video using Gemini with SEALCAM+ framework."""
    client = genai.Client(api_key=api_key)

    # Upload video to Gemini
    logger.info(f"Uploading video: {video_path}")
    video_file = client.files.upload(file=video_path)

    # Wait for processing
    logger.info("Waiting for video processing...")
    import time
    while video_file.state.name == "PROCESSING":
        time.sleep(5)
        video_file = client.files.get(name=video_file.name)

    if video_file.state.name == "FAILED":
        raise VideoProcessingError(f"Video processing failed: {video_file.state.name}")

    logger.info("Video processed. Analyzing with SEALCAM+ framework...")

    # Generate content using the new SDK
    response = client.models.generate_content(
        model=model_name,
        contents=[
            video_file,
            "Analyze this video and break it down into scenes using the SEALCAM+ framework. "
            "I want to recreate this video with my own product/character. "
            "Focus on the visual structure and ignore any text overlays. "
            "Pay special attention to motion details, keyframes, and micromotion. "
            "Output as JSON only, no markdown."
        ],
        config=types.GenerateContentConfig(
            system_instruction=SEALCAM_PLUS_SYSTEM_PROMPT,
            temperature=0.2,
            max_output_tokens=16384,
        )
    )

    # Parse JSON from response
    response_text = response.text.strip()

    # Try parsing the raw response first
    result = None
    try:
        result = json.loads(response_text)
        logger.debug("Parsed Gemini response as valid JSON (no repair needed)")
    except json.JSONDecodeError:
        # Raw parse failed — attempt repair
        logger.info("Raw JSON parse failed, attempting repair...")
        repaired_text = repair_json(response_text)
        try:
            result = json.loads(repaired_text)
            logger.info("JSON repair succeeded — parsed repaired response")
        except json.JSONDecodeError as e2:
            logger.error(f"Failed to parse Gemini JSON response even after repair: {e2}")
            logger.debug(f"Raw response (first 500 chars):\n{response_text[:500]}...")
            logger.debug(f"Repaired text (first 500 chars):\n{repaired_text[:500]}...")
            # Return a structured error result that downstream code can handle
            result = {
                "_parse_error": True,
                "parse_error_message": str(e2),
                "raw_response": response_text,
                "scenes": [],  # Empty scenes array for downstream compatibility
                "video_analysis": {
                    "total_duration": 0,
                    "overall_vibe": "PARSE_ERROR",
                    "pacing": "N/A"
                }
            }
            logger.warning("Analysis failed. The output file will contain the raw response for debugging.")

    # Add metadata
    result["_metadata"] = {
        "source_video": video_path,
        "model_used": model_name,
        "framework": "SEALCAM+"
    }

    return result


def save_to_database(result: dict, project_slug: str, reference_url: str = None) -> dict:
    """Save analysis results to database."""
    if not VideoReplicatorDB:
        logger.warning("Database module not available, skipping DB save")
        return result

    db = VideoReplicatorDB()

    # Get or create project
    project = db.get_or_create_project(project_slug, project_slug)
    project_id = project["id"]

    # Save analysis
    analysis_id = db.save_analysis(
        project_id,
        result,
        gemini_model=result.get("_metadata", {}).get("model_used", "gemini-1.5-pro")
    )

    # Save each scene
    scenes = result.get("scenes", [])
    for scene in scenes:
        db.save_scene(analysis_id, project_id, scene)

    logger.info(f"Saved analysis to database: project_id={project_id}, analysis_id={analysis_id}")
    logger.info(f"Saved {len(scenes)} scenes")

    result["_database"] = {
        "project_id": project_id,
        "analysis_id": analysis_id,
        "scenes_saved": len(scenes)
    }

    db.close()
    return result


def main():
    parser = argparse.ArgumentParser(description="Analyze video with SEALCAM+ framework")
    parser.add_argument("--video", required=True, help="Video path or URL")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--project", help="Project slug for database storage")
    parser.add_argument("--save-to-db", action="store_true", help="Save to SQLite database")
    parser.add_argument("--model", default="gemini-3-flash-preview",
                        help="Gemini model to use (default: gemini-3-flash-preview)")
    parser.add_argument("--transcribe", action="store_true",
                        help="Run Whisper transcription after analysis (requires: brew install openai-whisper)")
    parser.add_argument("--whisper-model", default="medium",
                        choices=["tiny", "base", "small", "medium", "large"],
                        help="Whisper model size (default: medium)")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose/debug logging")
    args = parser.parse_args()

    # Reconfigure logger level with verbose flag
    if args.verbose:
        import logging
        logger.setLevel(logging.DEBUG)
        for handler in logger.handlers:
            handler.setLevel(logging.DEBUG)

    # Get API key
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("GOOGLE_API_KEY environment variable not set")
        sys.exit(1)

    video_path = args.video
    reference_url = None

    # Download if URL
    if video_path.startswith(("http://", "https://")):
        logger.info(f"Downloading video from URL: {video_path}")
        reference_url = video_path
        with tempfile.TemporaryDirectory() as temp_dir:
            video_path = download_video(args.video, temp_dir)
            result = analyze_video(video_path, api_key, args.model)
    else:
        # Local file
        if not os.path.exists(video_path):
            logger.error(f"Video file not found: {video_path}")
            sys.exit(1)
        result = analyze_video(video_path, api_key, args.model)

    # Save to database if requested
    if args.save_to_db or args.project:
        project_slug = args.project or Path(args.output).stem
        result = save_to_database(result, project_slug, reference_url)

    # Ensure output directory exists
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write output
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    logger.info(f"Analysis saved to: {args.output}")

    # Optional: Run Whisper transcription
    if args.transcribe:
        try:
            from transcribe_audio import (
                align_transcript_to_scenes,
                build_transcript_output,
                check_whisper_installed,
                extract_audio_track,
                print_install_instructions,
                run_whisper,
            )

            if not check_whisper_installed():
                logger.warning("Whisper CLI not installed. Skipping transcription.")
                print_install_instructions()
            else:
                logger.info("Running Whisper Transcription")
                # Determine the actual video path (may differ if downloaded from URL)
                transcribe_video = video_path

                import tempfile as _tf
                with _tf.TemporaryDirectory() as _temp_dir:
                    wav_path = os.path.join(_temp_dir, "audio.wav")
                    if extract_audio_track(transcribe_video, wav_path):
                        whisper_out_dir = os.path.join(_temp_dir, "whisper_output")
                        whisper_result = run_whisper(wav_path, whisper_out_dir, args.whisper_model)

                        if whisper_result:
                            aligned = align_transcript_to_scenes(whisper_result, result)
                            transcript_output = build_transcript_output(
                                whisper_result, aligned, transcribe_video, args.whisper_model
                            )

                            # Embed transcript in analysis result
                            result["transcript"] = transcript_output["transcript"]
                            result["scene_transcripts"] = transcript_output.get("scene_transcripts", [])

                            # Re-save analysis with transcript
                            with open(output_path, "w") as f:
                                json.dump(result, f, indent=2)

                            # Also save standalone transcript.json
                            transcript_path = output_path.parent / "transcript.json"
                            with open(transcript_path, "w") as f:
                                json.dump(transcript_output, f, indent=2)

                            lang = transcript_output["transcript"]["language"]
                            seg_count = len(transcript_output["transcript"]["segments"])
                            logger.info(f"Transcription complete: {lang}, {seg_count} segments")
                            logger.info(f"Transcript saved to: {transcript_path}")
                        else:
                            logger.warning("Whisper transcription returned no result.")
                    else:
                        logger.warning("Could not extract audio track. Video may have no audio.")
        except Exception as e:
            logger.warning(f"Transcription failed (non-blocking): {e}")
            logger.info("Analysis result is still valid.")

    # Print summary
    video_analysis = result.get("video_analysis", {})
    scenes = result.get("scenes", [])
    logger.info(f"Found {len(scenes)} scenes ({video_analysis.get('total_duration', '?')}s total)")
    logger.info(f"Overall vibe: {video_analysis.get('overall_vibe', 'N/A')}")
    logger.info(f"Pacing: {video_analysis.get('pacing', 'N/A')}")

    # Print scene summary
    logger.info("Scene Summary:")
    for scene in scenes:
        scene_num = scene.get("scene_number", "?")
        duration = scene.get("duration_seconds", "?")

        # Handle both dict and string formats
        action = scene.get("action", {})
        if isinstance(action, dict):
            primary = action.get("primary", "N/A")[:50]
        else:
            primary = str(action)[:50]

        camera = scene.get("camera", {})
        if isinstance(camera, dict):
            cam_move = camera.get("movement_type", "N/A")
        else:
            cam_move = str(camera)[:30]

        logger.info(f"Scene {scene_num} ({duration}s): Action: {primary}... | Camera: {cam_move}")

        # Show keyframes if available
        if isinstance(action, dict) and action.get("keyframes"):
            keyframes = action["keyframes"]
            kf_summary = " -> ".join([kf.get("description", "")[:20] for kf in keyframes[:3]])
            logger.debug(f"Scene {scene_num} Motion: {kf_summary}")


if __name__ == "__main__":
    main()
