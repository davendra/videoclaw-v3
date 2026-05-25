#!/usr/bin/env python3
"""
UGC Strategy Document Manager.

Scaffold, validate, and export UGC strategy documents for belief-driven
ad campaigns.

Usage:
    python ugc_strategy.py scaffold --project my-brand
    python ugc_strategy.py validate --project my-brand
    python ugc_strategy.py export --project my-brand
"""

import argparse
import json
import sys
from pathlib import Path

from config import PROJECT_BASE
from exceptions import StrategyError
from logging_config import setup_logging

logger = setup_logging(__name__)

# ============================================================================
# Templates
# ============================================================================

AVATAR_TEMPLATE = {
    "name": "",
    "age_range": "",
    "gender": "",
    "location": "",
    "occupation": "",
    "pain_points": [],
    "desires": [],
    "current_beliefs": [],
    "language_patterns": [],
    "video_strategy": {
        "storyline_type": "single_character",
        "character_consistency": True,
    },
}

OFFER_TEMPLATE = {
    "product_name": "",
    "product_url": "",
    "unique_mechanism": "",
    "differentiation": "",
    "key_claims": [],
    "proof_points": [],
    "price": "",
    "value_stack": [],
}

BELIEFS_TEMPLATE = {
    "current_beliefs": [],
    "necessary_beliefs": [],
}

HOOKS_TEMPLATE = {
    "hook_angles": [],
}

RESEARCH_TEMPLATE = """# Market Research

## Target Market Overview

<!-- Describe the target market, size, trends -->

## Competitor Analysis

<!-- List key competitors and their positioning -->

## Customer Insights

<!-- Key findings from customer research -->

## Pain Points & Desires

<!-- What keeps the target audience up at night? What do they dream about? -->

## Language & Messaging

<!-- How does the audience talk about their problems? What words do they use? -->
"""

STRATEGY_FILES = {
    "avatar.json": AVATAR_TEMPLATE,
    "offer.json": OFFER_TEMPLATE,
    "beliefs.json": BELIEFS_TEMPLATE,
    "hooks.json": HOOKS_TEMPLATE,
}

# Required non-empty string fields per file
REQUIRED_FIELDS = {
    "avatar.json": ["name", "age_range", "gender"],
    "offer.json": ["product_name", "unique_mechanism", "differentiation"],
    "beliefs.json": [],
    "hooks.json": [],
}

# Required non-empty list fields per file
REQUIRED_LISTS = {
    "avatar.json": ["pain_points", "desires"],
    "offer.json": ["key_claims", "proof_points"],
    "beliefs.json": ["necessary_beliefs"],
    "hooks.json": ["hook_angles"],
}

MIN_BELIEFS = 5


# ============================================================================
# Helpers
# ============================================================================


def _strategy_dir(project: str) -> Path:
    """Return the strategy directory path for a project."""
    return Path(PROJECT_BASE) / project / "strategy"


def _read_json(path: Path) -> dict:
    """Read and parse a JSON file."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise StrategyError(f"Invalid JSON in {path}: {exc}") from exc
    except OSError as exc:
        raise StrategyError(f"Cannot read {path}: {exc}") from exc


# ============================================================================
# Subcommands
# ============================================================================


def cmd_scaffold(project: str, yes: bool = False) -> None:
    """Create strategy directory with empty template files."""
    strategy_dir = _strategy_dir(project)

    if strategy_dir.exists() and not yes:
        logger.warning("Strategy directory already exists: %s", strategy_dir)
        response = input("Overwrite existing templates? [y/N] ").strip().lower()
        if response != "y":
            logger.info("Aborted.")
            return

    strategy_dir.mkdir(parents=True, exist_ok=True)

    for filename, template in STRATEGY_FILES.items():
        filepath = strategy_dir / filename
        filepath.write_text(
            json.dumps(template, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        logger.info("Created %s", filepath)

    research_path = strategy_dir / "research.md"
    research_path.write_text(RESEARCH_TEMPLATE, encoding="utf-8")
    logger.info("Created %s", research_path)

    logger.info("Strategy scaffold created at %s", strategy_dir)


def cmd_validate(project: str) -> bool:
    """Validate all strategy documents are complete. Returns True if valid."""
    strategy_dir = _strategy_dir(project)
    errors: list[str] = []

    if not strategy_dir.exists():
        raise StrategyError(
            f"Strategy directory not found: {strategy_dir}. "
            f"Run 'scaffold --project {project}' first."
        )

    # Check all files exist
    for filename in [*STRATEGY_FILES, "research.md"]:
        filepath = strategy_dir / filename
        if not filepath.exists():
            errors.append(f"Missing file: {filename}")

    # Validate JSON files
    for filename in STRATEGY_FILES:
        filepath = strategy_dir / filename
        if not filepath.exists():
            continue

        data = _read_json(filepath)

        # Check required string fields
        for field in REQUIRED_FIELDS.get(filename, []):
            value = data.get(field, "")
            if not value or not str(value).strip():
                errors.append(f"{filename}: '{field}' is empty")

        # Check required list fields
        for field in REQUIRED_LISTS.get(filename, []):
            value = data.get(field, [])
            if not value:
                errors.append(f"{filename}: '{field}' is empty")

    # Check minimum beliefs count
    beliefs_path = strategy_dir / "beliefs.json"
    if beliefs_path.exists():
        beliefs_data = _read_json(beliefs_path)
        belief_count = len(beliefs_data.get("necessary_beliefs", []))
        if belief_count < MIN_BELIEFS:
            errors.append(
                f"beliefs.json: need at least {MIN_BELIEFS} necessary beliefs "
                f"(found {belief_count})"
            )

    # Check research.md has content beyond template
    research_path = strategy_dir / "research.md"
    if research_path.exists():
        content = research_path.read_text(encoding="utf-8").strip()
        # Check if it's still just the template (only headings and comments)
        non_template_lines = [
            line
            for line in content.splitlines()
            if line.strip()
            and not line.strip().startswith("#")
            and not line.strip().startswith("<!--")
            and not line.strip().endswith("-->")
        ]
        if not non_template_lines:
            errors.append("research.md: contains only template placeholders")

    if errors:
        logger.error("Validation failed with %d error(s):", len(errors))
        for err in errors:
            logger.error("  - %s", err)
        return False

    logger.info("All strategy documents are valid.")
    return True


def cmd_export(project: str) -> dict:
    """Export combined strategy summary as JSON."""
    strategy_dir = _strategy_dir(project)

    if not strategy_dir.exists():
        raise StrategyError(
            f"Strategy directory not found: {strategy_dir}. "
            f"Run 'scaffold --project {project}' first."
        )

    summary: dict = {"project": project}

    for filename, _template in STRATEGY_FILES.items():
        filepath = strategy_dir / filename
        key = filename.replace(".json", "")
        if filepath.exists():
            summary[key] = _read_json(filepath)
        else:
            logger.warning("Missing %s, skipping", filename)
            summary[key] = None

    # Include research.md content
    research_path = strategy_dir / "research.md"
    if research_path.exists():
        summary["research"] = research_path.read_text(encoding="utf-8")
    else:
        logger.warning("Missing research.md, skipping")
        summary["research"] = None

    output = json.dumps(summary, indent=2, ensure_ascii=False)
    print(output)
    return summary


# ============================================================================
# CLI
# ============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(
        description="UGC Strategy Document Manager",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # scaffold
    sp_scaffold = subparsers.add_parser(
        "scaffold", help="Create strategy directory with empty templates"
    )
    sp_scaffold.add_argument("--project", required=True, help="Project slug")
    sp_scaffold.add_argument(
        "--yes", "-y", action="store_true", help="Non-interactive mode"
    )

    # validate
    sp_validate = subparsers.add_parser(
        "validate", help="Validate all strategy docs are complete"
    )
    sp_validate.add_argument("--project", required=True, help="Project slug")

    # export
    sp_export = subparsers.add_parser(
        "export", help="Export strategy summary as JSON"
    )
    sp_export.add_argument("--project", required=True, help="Project slug")

    args = parser.parse_args()

    try:
        if args.command == "scaffold":
            cmd_scaffold(args.project, yes=args.yes)
        elif args.command == "validate":
            valid = cmd_validate(args.project)
            if not valid:
                sys.exit(1)
        elif args.command == "export":
            cmd_export(args.project)
    except StrategyError as exc:
        logger.error("%s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
