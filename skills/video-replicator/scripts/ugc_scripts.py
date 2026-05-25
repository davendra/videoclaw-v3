#!/usr/bin/env python3
"""
UGC Belief Script Validator and Converter.

Validates UGC belief scripts against schema and converts them to formats
used by the existing video pipeline (parallel_video_gen.py, generate_tts.py).

Usage:
    # Validate a belief script
    python ugc_scripts.py validate --script belief_1.json

    # Convert to parallel_video_gen.py --scenes format
    python ugc_scripts.py to-scenes --script belief_1.json

    # Convert to generate_tts.py editable transcript format
    python ugc_scripts.py to-transcript --script belief_1.json

    # Generate Veo spec files + HTML report
    python ugc_scripts.py veo-specs --script belief_1.json --project my-ugc

    # Dry-run (preview without writing files)
    python ugc_scripts.py veo-specs --script belief_1.json --project my-ugc --dry-run
"""

import argparse
import json
import sys
from pathlib import Path

from config import PROJECT_BASE, UGC_SCENE_TYPES, UGC_WORD_LIMITS
from exceptions import ScriptValidationError
from logging_config import setup_logging

logger = setup_logging(__name__)


# ============================================================================
# Validation
# ============================================================================


def load_script(script_path: str) -> dict:
    """Load and parse a belief script JSON file."""
    path = Path(script_path)
    if not path.exists():
        raise ScriptValidationError(f"Script file not found: {script_path}")
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise ScriptValidationError(f"Invalid JSON in {script_path}: {e}")


def _get_word_limit(duration: int) -> int:
    """Return max word count for a given scene duration.

    Uses the closest duration bucket that is >= the scene duration.
    Falls back to the largest bucket if duration exceeds all keys.
    """
    for d in sorted(UGC_WORD_LIMITS.keys()):
        if duration <= d:
            return UGC_WORD_LIMITS[d]
    return UGC_WORD_LIMITS[max(UGC_WORD_LIMITS.keys())]


def validate_script(script: dict) -> list[str]:
    """Validate a belief script against the UGC schema.

    Returns a list of validation error strings. Empty list means valid.
    """
    errors: list[str] = []

    # Required top-level fields
    for field in ("script_id", "belief_targeted", "duration_target", "scenes"):
        if field not in script:
            errors.append(f"Missing required field: {field}")

    if "scenes" not in script:
        return errors  # Can't validate further without scenes

    scenes = script["scenes"]
    if not isinstance(scenes, list) or len(scenes) == 0:
        errors.append("'scenes' must be a non-empty list")
        return errors

    # Check scene types
    scene_types_found = set()
    total_duration = 0

    for i, scene in enumerate(scenes):
        scene_num = scene.get("scene_number", i + 1)
        prefix = f"Scene {scene_num}"

        # Required scene fields
        for field in ("type", "duration", "visual", "veo_prompt"):
            if field not in scene:
                errors.append(f"{prefix}: missing required field '{field}'")

        scene_type = scene.get("type")
        if scene_type and scene_type not in UGC_SCENE_TYPES:
            errors.append(
                f"{prefix}: invalid type '{scene_type}'. "
                f"Must be one of: {', '.join(UGC_SCENE_TYPES)}"
            )
        if scene_type:
            scene_types_found.add(scene_type)

        duration = scene.get("duration", 0)
        if not isinstance(duration, (int, float)) or duration <= 0:
            errors.append(f"{prefix}: duration must be a positive number")
        else:
            total_duration += duration

        # Dialogue word count check
        dialogue = scene.get("dialogue", "")
        if dialogue:
            word_count = len(dialogue.split())
            limit = _get_word_limit(int(duration)) if duration > 0 else 0
            if limit > 0 and word_count > limit:
                errors.append(
                    f"{prefix}: dialogue has {word_count} words, "
                    f"max {limit} for {int(duration)}s duration"
                )

    # Must have at least hook and cta scenes
    if "hook" not in scene_types_found:
        errors.append("Script must contain at least one 'hook' scene")
    if "cta" not in scene_types_found:
        errors.append("Script must contain at least one 'cta' scene")

    # Duration target check (within 2s tolerance)
    duration_target = script.get("duration_target", 0)
    if duration_target and abs(total_duration - duration_target) > 2:
        errors.append(
            f"Total scene duration ({total_duration}s) does not match "
            f"duration_target ({duration_target}s) — exceeds 2s tolerance"
        )

    return errors


def cmd_validate(args: argparse.Namespace) -> int:
    """Run the validate subcommand."""
    script = load_script(args.script)
    errors = validate_script(script)

    if errors:
        logger.error(f"Validation failed with {len(errors)} error(s):")
        for err in errors:
            logger.error(f"  - {err}")
        return 1

    logger.info(
        f"Script '{script.get('script_id', '?')}' is valid "
        f"({len(script.get('scenes', []))} scenes, "
        f"{script.get('duration_target', '?')}s target)"
    )
    return 0


# ============================================================================
# Cumulative Timestamps
# ============================================================================


def add_cumulative_timestamps(script: dict) -> dict:
    """Inject cumulative_start and cumulative_end (MM:SS) into each scene.

    Mutates scenes in-place and returns the script for chaining.
    """
    cumulative = 0
    for scene in script.get("scenes", []):
        duration = scene.get("duration", 0)
        scene["cumulative_start"] = _format_timestamp(cumulative)
        cumulative += duration
        scene["cumulative_end"] = _format_timestamp(cumulative)
    return script


def _format_timestamp(seconds: float) -> str:
    """Format seconds as M:SS (e.g., 0:03, 0:25, 1:05)."""
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"


# ============================================================================
# to-scenes: Convert to parallel_video_gen.py --scenes format
# ============================================================================


def to_scenes(script: dict) -> dict[str, str]:
    """Convert belief script to {scene_number: veo_prompt} dict."""
    result = {}
    for scene in script.get("scenes", []):
        num = str(scene.get("scene_number", 0))
        prompt = scene.get("veo_prompt", "")
        if num and prompt:
            result[num] = prompt
    return result


def cmd_to_scenes(args: argparse.Namespace) -> int:
    """Run the to-scenes subcommand."""
    script = load_script(args.script)
    add_cumulative_timestamps(script)

    # Validate first
    errors = validate_script(script)
    if errors and not args.yes:
        logger.warning(f"Script has {len(errors)} validation warning(s):")
        for err in errors:
            logger.warning(f"  - {err}")

    scenes = to_scenes(script)
    output = json.dumps(scenes, indent=2)

    if args.output:
        if args.dry_run:
            logger.info(f"[DRY-RUN] Would write scenes to: {args.output}")
            print(output)
        else:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            with open(args.output, "w") as f:
                f.write(output)
            logger.info(f"Wrote scenes JSON to: {args.output}")
    else:
        print(output)

    return 0


# ============================================================================
# to-transcript: Convert to generate_tts.py editable transcript format
# ============================================================================


def to_transcript(script: dict) -> dict:
    """Convert belief script dialogue to editable transcript format."""
    scenes_out = []
    for scene in script.get("scenes", []):
        dialogue = scene.get("dialogue", "")
        if not dialogue:
            continue
        entry = {
            "scene": scene.get("scene_number", 0),
            "text": dialogue,
            "duration": scene.get("duration", 8),
        }
        if "cumulative_start" in scene:
            entry["start"] = scene["cumulative_start"]
            entry["end"] = scene["cumulative_end"]
        scenes_out.append(entry)
    return {"scenes": scenes_out}


def cmd_to_transcript(args: argparse.Namespace) -> int:
    """Run the to-transcript subcommand."""
    script = load_script(args.script)
    add_cumulative_timestamps(script)
    transcript = to_transcript(script)
    output = json.dumps(transcript, indent=2)

    if args.output:
        if args.dry_run:
            logger.info(f"[DRY-RUN] Would write transcript to: {args.output}")
            print(output)
        else:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            with open(args.output, "w") as f:
                f.write(output)
            logger.info(f"Wrote transcript JSON to: {args.output}")
    else:
        print(output)

    return 0


# ============================================================================
# veo-specs: Generate Veo spec files + HTML report
# ============================================================================


def generate_veo_spec(scene: dict, script: dict) -> dict:
    """Generate a Veo spec dict for a single scene."""
    spec = {
        "script_id": script.get("script_id", ""),
        "scene_number": scene.get("scene_number", 0),
        "scene_type": scene.get("type", ""),
        "visual_spec": scene.get("visual", ""),
        "camera": scene.get("camera", ""),
        "audio": scene.get("dialogue", ""),
        "veo_parameters": {
            "prompt": scene.get("veo_prompt", ""),
            "duration": scene.get("duration", 8),
            "aspect_ratio": "9:16",
        },
    }
    if "cumulative_start" in scene:
        spec["timing"] = f"{scene['cumulative_start']} – {scene['cumulative_end']}"
    return spec


def generate_html_report(script: dict, specs: list[dict]) -> str:
    """Generate an HTML overview page for the belief script."""
    script_id = script.get("script_id", "unknown")
    belief = script.get("belief_targeted", "")
    duration = script.get("duration_target", 0)
    cta = script.get("cta", {})

    rows = ""
    for spec in specs:
        sn = spec["scene_number"]
        st = spec["scene_type"]
        vis = spec["visual_spec"][:80] + ("..." if len(spec["visual_spec"]) > 80 else "")
        cam = spec["camera"]
        audio = spec["audio"][:60] + ("..." if len(spec["audio"]) > 60 else "")
        dur = spec["veo_parameters"]["duration"]
        timing = spec.get("timing", "")
        rows += (
            f"<tr>"
            f"<td>{sn}</td><td>{st}</td><td>{timing}</td><td>{dur}s</td>"
            f"<td>{vis}</td><td>{cam}</td><td>{audio}</td>"
            f"</tr>\n"
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Veo Specs: {script_id}</title>
<style>
  body {{ font-family: -apple-system, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }}
  h1 {{ color: #1a1a2e; }}
  .meta {{ background: #f0f0f5; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 0.9rem; }}
  th, td {{ border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }}
  th {{ background: #1a1a2e; color: white; }}
  tr:nth-child(even) {{ background: #f9f9fc; }}
  .cta {{ margin-top: 1.5rem; padding: 1rem; background: #e8f5e9; border-radius: 8px; }}
</style>
</head>
<body>
<h1>Veo Specs: {script_id}</h1>
<div class="meta">
  <strong>Belief Targeted:</strong> {belief}<br>
  <strong>Duration Target:</strong> {duration}s<br>
  <strong>Scenes:</strong> {len(specs)}
</div>
<table>
<tr><th>#</th><th>Type</th><th>Time</th><th>Dur</th><th>Visual</th><th>Camera</th><th>Audio</th></tr>
{rows}
</table>
{"<div class='cta'><strong>CTA:</strong> " + cta.get('text', '') + " &mdash; <a href='" + cta.get('url', '#') + "'>" + cta.get('url', '') + "</a></div>" if cta else ""}
</body>
</html>"""


def cmd_veo_specs(args: argparse.Namespace) -> int:
    """Run the veo-specs subcommand."""
    script = load_script(args.script)
    add_cumulative_timestamps(script)

    # Validate first
    errors = validate_script(script)
    if errors:
        logger.warning(f"Script has {len(errors)} validation warning(s):")
        for err in errors:
            logger.warning(f"  - {err}")

    script_id = script.get("script_id", "belief")

    # Determine output directory
    if args.output:
        specs_dir = Path(args.output)
    elif args.project:
        specs_dir = Path(PROJECT_BASE) / args.project / "veo_specs"
    else:
        logger.error("Either --project or --output is required for veo-specs")
        return 1

    # Generate specs
    specs = []
    for scene in script.get("scenes", []):
        spec = generate_veo_spec(scene, script)
        specs.append(spec)

    if args.dry_run:
        logger.info(f"[DRY-RUN] Would write {len(specs)} spec files to: {specs_dir}")
        for spec in specs:
            sn = spec["scene_number"]
            logger.info(f"  - {script_id}_scene_{sn}.json")
        logger.info(f"  - {script_id}_overview.html")
        print(json.dumps(specs, indent=2))
        return 0

    # Write spec files
    specs_dir.mkdir(parents=True, exist_ok=True)

    for spec in specs:
        sn = spec["scene_number"]
        spec_path = specs_dir / f"{script_id}_scene_{sn}.json"
        with open(spec_path, "w") as f:
            json.dump(spec, f, indent=2)
        logger.info(f"Wrote: {spec_path}")

    # Write HTML report
    html = generate_html_report(script, specs)
    html_path = specs_dir / f"{script_id}_overview.html"
    with open(html_path, "w") as f:
        f.write(html)
    logger.info(f"Wrote: {html_path}")

    logger.info(
        f"Generated {len(specs)} Veo spec files + HTML report in: {specs_dir}"
    )
    return 0


# ============================================================================
# CLI
# ============================================================================


def build_parser() -> argparse.ArgumentParser:
    """Build the argparse parser with subcommands."""
    parser = argparse.ArgumentParser(
        description="UGC Belief Script Validator and Converter",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Enable debug logging"
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # -- validate --
    p_validate = subparsers.add_parser(
        "validate", help="Validate a belief script JSON against schema"
    )
    p_validate.add_argument(
        "--script", required=True, help="Path to belief script JSON"
    )

    # -- to-scenes --
    p_scenes = subparsers.add_parser(
        "to-scenes",
        help="Convert belief script to parallel_video_gen.py --scenes format",
    )
    p_scenes.add_argument(
        "--script", required=True, help="Path to belief script JSON"
    )
    p_scenes.add_argument("--output", help="Output file path (prints to stdout if omitted)")
    p_scenes.add_argument("--dry-run", action="store_true", help="Preview without writing")
    p_scenes.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompts")

    # -- to-transcript --
    p_transcript = subparsers.add_parser(
        "to-transcript",
        help="Convert dialogue to generate_tts.py editable transcript format",
    )
    p_transcript.add_argument(
        "--script", required=True, help="Path to belief script JSON"
    )
    p_transcript.add_argument("--output", help="Output file path (prints to stdout if omitted)")
    p_transcript.add_argument("--dry-run", action="store_true", help="Preview without writing")

    # -- veo-specs --
    p_specs = subparsers.add_parser(
        "veo-specs",
        help="Generate Veo spec JSON files + HTML overview report",
    )
    p_specs.add_argument(
        "--script", required=True, help="Path to belief script JSON"
    )
    p_specs.add_argument("--project", help="Project slug (output to projects/{slug}/veo_specs/)")
    p_specs.add_argument("--output", help="Explicit output directory path")
    p_specs.add_argument("--dry-run", action="store_true", help="Preview without writing")
    p_specs.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompts")

    return parser


def main() -> int:
    """Main entry point."""
    parser = build_parser()
    args = parser.parse_args()

    if args.verbose:
        global logger
        logger = setup_logging(__name__ + ".verbose", verbose=True)

    if not args.command:
        parser.print_help()
        return 1

    commands = {
        "validate": cmd_validate,
        "to-scenes": cmd_to_scenes,
        "to-transcript": cmd_to_transcript,
        "veo-specs": cmd_veo_specs,
    }

    handler = commands.get(args.command)
    if not handler:
        parser.print_help()
        return 1

    try:
        return handler(args)
    except ScriptValidationError as e:
        logger.error(f"Validation error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
