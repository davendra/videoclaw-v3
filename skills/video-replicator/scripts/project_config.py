#!/usr/bin/env python3
"""
Unified project configuration wizard.

Walks through all key decisions at project start and saves to
project_config.json. Other scripts can import load_project_config()
and get_config_value() to read settings as defaults.

Usage:
    python project_config.py --project "my-project"                    # Interactive wizard
    python project_config.py --project "my-project" --show             # Display current
    python project_config.py --project "my-project" --set quality=fast # Update one key
    python project_config.py --project "my-project" --yes              # Accept defaults
    python project_config.py --project "my-project" \\
        --mode COPY --aspect-ratio landscape --quality fast \\
        --variations 2 --audio-preset narrated --backend useapi        # Non-interactive
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import PROJECT_BASE
from exceptions import ValidationError
from logging_config import setup_logging

CONFIG_FILENAME = "project_config.json"
CONFIG_VERSION = "1.0"
VALID_MODES = ["COPY", "CREATE", "COPY NARRATED", "PRESENTATION"]
VALID_RATIOS = ["landscape", "portrait"]
VALID_QUALITIES = ["quality", "fast", "free", "veo2"]
VALID_AUDIO_PRESETS = ["default", "presenter", "narrated"]
VALID_BACKENDS = ["useapi", "direct"]

DEFAULTS = dict(mode="COPY", aspect_ratio="landscape", quality="fast", variations=1,
    audio_preset="narrated", voice_name=None, voice_id=None, transitions_enabled=True,
    character_ids=[], product_id=None, logo_path=None, logo_preset=None,
    backend="useapi", style=None, notes="")

WIZARD_STEPS = [
    ("mode", "Mode", [
        ("COPY", "Replicate an existing video"), ("CREATE", "Design from scratch"),
        ("COPY NARRATED", "Replicate with voiceover"), ("PRESENTATION", "Restyle slides")]),
    ("aspect_ratio", "Aspect Ratio", [
        ("landscape", "16:9 - YouTube, Ads, Web"), ("portrait", "9:16 - TikTok, Reels, Shorts")]),
    ("quality", "Quality", [
        ("fast", "10 credits, ~1.5 min"), ("quality", "100 credits, ~3.5 min"),
        ("free", "0 credits, ~1.5 min"), ("veo2", "100 credits, ~5 min, no audio")]),
    ("variations", "Variations per scene", [
        ("1", "Single output"), ("2", "A/B testing"), ("3", "Three variations"),
        ("4", "Maximum variations")]),
    ("audio_preset", "Audio Preset", [
        ("narrated", "Music 15%, video 85% - narrated content"),
        ("presenter", "Music 25%, video 85% - talking head"),
        ("default", "Music 60%, video 30% - ambient/B-roll")]),
    ("backend", "Backend", [
        ("useapi", "REST API (paid, reliable, I2V portrait)"),
        ("direct", "Browser automation (free, needs cookie.json)")]),
    ("transitions_enabled", "Camera Transitions", [
        ("yes", "Enable AI camera transitions"), ("no", "No transitions")]),
    ("style", "Art Style (optional)", None),  # None = free text
]


def load_project_config(project_path: str) -> dict | None:
    """Load project_config.json if it exists, return None otherwise."""
    config_path = os.path.join(project_path, CONFIG_FILENAME)
    if os.path.exists(config_path):
        with open(config_path) as f:
            return json.load(f)
    return None


def get_config_value(project_path: str, key: str, default=None):
    """Get a single value from project config with fallback."""
    config = load_project_config(project_path)
    if config:
        return config.get(key, default)
    return default


def save_project_config(project_path: str, config: dict) -> str:
    """Save config to project_config.json. Returns the file path."""
    os.makedirs(project_path, exist_ok=True)
    config_path = os.path.join(project_path, CONFIG_FILENAME)
    config["updated_at"] = datetime.now().isoformat()
    if "created_at" not in config:
        config["created_at"] = config["updated_at"]
    config["version"] = CONFIG_VERSION
    with open(config_path, "w") as f:
        json.dump(config, f, indent=4)
    return config_path


def resolve_project_path(slug: str, projects_base: str) -> str | None:
    """Find project directory by slug (supports date-prefixed folders)."""
    direct = os.path.join(projects_base, slug)
    if os.path.isdir(direct):
        return direct
    if not os.path.isdir(projects_base):
        return None
    for entry in sorted(os.listdir(projects_base), reverse=True):
        full = os.path.join(projects_base, entry)
        if not os.path.isdir(full):
            continue
        if entry.endswith(f"_{slug}"):
            return full
        manifest = os.path.join(full, "manifest.json")
        if os.path.exists(manifest):
            try:
                with open(manifest) as f:
                    if json.load(f).get("slug") == slug:
                        return full
            except (json.JSONDecodeError, KeyError):
                pass
    return None


def display_config(config: dict, project_path: str) -> None:
    """Print current project configuration."""
    sep, meta = "=" * 60, ("version", "created_at", "updated_at")
    print(f"\n{sep}\nPROJECT CONFIGURATION\n{sep}\n  Path:     {project_path}")
    for k in meta:
        print(f"  {k:10s} {config.get(k, 'unknown')}")
    print("-" * 60)
    for key, value in config.items():
        if key not in meta:
            print(f"  {key:25s} {json.dumps(value) if isinstance(value, (list, dict)) else value}")
    print(f"{sep}\n")


def prompt_choice(step_num: int, total: int, key: str, label: str,
                  choices: list | None, current_value) -> str | None:
    """Prompt user for a single wizard step. Returns chosen value."""
    print(f"\n[{step_num}/{total}] {label}:")
    if choices is None:  # free text
        default_display = current_value if current_value else "none"
        raw = input(f"  Enter value [{default_display}]: ").strip()
        return raw if raw else current_value
    for i, (value, desc) in enumerate(choices, 1):
        marker = " *" if str(value) == str(current_value) else ""
        print(f"  {i}. {value} - {desc}{marker}")
    while True:
        raw = input("  > ").strip()
        if not raw:
            return current_value
        try:
            idx = int(raw)
            if 1 <= idx <= len(choices):
                return choices[idx - 1][0]
        except ValueError:
            if raw in [c[0] for c in choices]:
                return raw
        print(f"  Please enter 1-{len(choices)} or press Enter for default.")


def run_wizard(project_name: str, existing: dict | None) -> dict:
    """Run interactive configuration wizard. Returns config dict."""
    config = dict(DEFAULTS)
    if existing:
        config.update({k: v for k, v in existing.items() if k in DEFAULTS})
    print(f"\n{'=' * 60}")
    print("PROJECT CONFIGURATION WIZARD")
    print(f"{'=' * 60}")
    print(f"Project: {project_name}")
    print("Press Enter to keep current/default value.")
    total = len(WIZARD_STEPS)
    for i, (key, label, choices) in enumerate(WIZARD_STEPS, 1):
        current = config.get(key, DEFAULTS.get(key))
        result = prompt_choice(i, total, key, label, choices, current)
        if key == "variations":
            config[key] = int(result)
        elif key == "transitions_enabled":
            config[key] = result in ("yes", "True", True)
        else:
            config[key] = result
    print(f"\n[notes] Any notes for this project? [{config.get('notes', '')}]")
    notes = input("  > ").strip()
    if notes:
        config["notes"] = notes
    return config


def apply_set(config: dict, assignment: str) -> dict:
    """Apply a key=value assignment to config with type coercion."""
    if "=" not in assignment:
        raise ValidationError(f"Invalid --set format: {assignment!r} (expected key=value)")
    key, _, raw = assignment.partition("=")
    key, raw = key.strip(), raw.strip()
    if key not in DEFAULTS:
        raise ValidationError(f"Unknown config key: {key!r}. Valid: {', '.join(DEFAULTS)}")
    default = DEFAULTS[key]
    if isinstance(default, bool):
        config[key] = raw.lower() in ("true", "yes", "1")
    elif isinstance(default, int):
        config[key] = int(raw)
    elif isinstance(default, list):
        config[key] = json.loads(raw) if raw else []
    elif default is None:
        config[key] = raw if raw and raw.lower() != "none" else None
    else:
        config[key] = raw
    return config


FLAG_ATTRS = [
    "mode", "aspect_ratio", "quality", "variations", "audio_preset",
    "voice_name", "voice_id", "backend", "style", "notes", "transitions",
]


def build_from_flags(args: argparse.Namespace) -> dict:
    """Build config dict from argparse flags, using defaults for unset."""
    config = dict(DEFAULTS)
    for attr in FLAG_ATTRS:
        val = getattr(args, attr, None)
        if val is not None:
            key = "transitions_enabled" if attr == "transitions" else attr
            config[key] = val
    return config


def has_any_flag(args: argparse.Namespace) -> bool:
    """Check if any config flag was explicitly passed."""
    return any(getattr(args, a, None) is not None for a in FLAG_ATTRS)


def main():
    p = argparse.ArgumentParser(description="Unified project configuration wizard")
    p.add_argument("--project", required=True, help="Project slug or name")
    p.add_argument("--project-base", default=PROJECT_BASE, help="Base path for projects")
    p.add_argument("--show", action="store_true", help="Display current config")
    p.add_argument("--set", dest="set_value", help="Update single setting (key=value)")
    p.add_argument("--yes", "-y", action="store_true", help="Accept defaults")
    p.add_argument("--verbose", action="store_true", help="Enable debug logging")
    p.add_argument("--mode", choices=VALID_MODES, help="Pipeline mode")
    p.add_argument("--aspect-ratio", dest="aspect_ratio", choices=VALID_RATIOS)
    p.add_argument("--quality", choices=VALID_QUALITIES)
    p.add_argument("--variations", type=int, choices=[1, 2, 3, 4])
    p.add_argument("--audio-preset", dest="audio_preset", choices=VALID_AUDIO_PRESETS)
    p.add_argument("--voice-name", dest="voice_name")
    p.add_argument("--voice-id", dest="voice_id")
    p.add_argument("--backend", choices=VALID_BACKENDS)
    p.add_argument("--style"); p.add_argument("--notes", default=None)
    p.add_argument("--transitions", default=None, help="true/false",
                   type=lambda v: v.lower() in ("true", "yes", "1"))
    args = p.parse_args()
    logger = setup_logging(__name__, verbose=args.verbose)

    project_path = resolve_project_path(args.project, args.project_base)
    if not project_path:
        project_path = os.path.join(args.project_base, args.project)
        os.makedirs(project_path, exist_ok=True)
        logger.info("Created project directory: %s", project_path)

    existing = load_project_config(project_path)

    if args.show:
        if not existing:
            print(f"No config found at {project_path}/{CONFIG_FILENAME}")
            sys.exit(1)
        display_config(existing, project_path)
        return

    if args.set_value:
        config = existing or dict(DEFAULTS)
        config = apply_set(config, args.set_value)
        path = save_project_config(project_path, config)
        logger.info("Updated %s in %s", args.set_value.split("=")[0], path)
        display_config(config, project_path)
        return

    if has_any_flag(args) or args.yes:
        config = build_from_flags(args)
        if existing:
            merged = dict(existing)
            if has_any_flag(args):
                for a in FLAG_ATTRS:
                    if getattr(args, a, None) is not None:
                        key = "transitions_enabled" if a == "transitions" else a
                        merged[key] = getattr(args, a)
            for k, v in DEFAULTS.items():
                merged.setdefault(k, v)
            config = merged
    else:
        config = run_wizard(args.project, existing)

    path = save_project_config(project_path, config)
    display_config(config, project_path)
    logger.info("%s config: %s", "Updated" if existing else "Created", path)


if __name__ == "__main__":
    main()
