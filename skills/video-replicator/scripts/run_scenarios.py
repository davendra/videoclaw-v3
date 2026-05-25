#!/usr/bin/env python3
"""
Batch Scenario Runner for parallel_video_gen.py

Run a list of scenarios (each a set of CLI args for parallel_video_gen.py)
in sequence, tracking which completed. Supports resume, range/ID filtering,
and dry-run mode.

Usage:
    # Run all scenarios
    python run_scenarios.py --scenarios scenarios.json

    # Run scenarios 1-5 by index (1-based)
    python run_scenarios.py --scenarios scenarios.json --range 1-5

    # Run specific scenarios by ID
    python run_scenarios.py --scenarios scenarios.json --ids test-cinematic-1,test-seedance-t2v

    # Resume (skip already-completed)
    python run_scenarios.py --scenarios scenarios.json --resume

    # Dry-run (print what would run)
    python run_scenarios.py --scenarios scenarios.json --dry-run

Scenario file format (scenarios.json):
    [
      {
        "id": "test-cinematic-1",
        "description": "Cinematic push-in test",
        "args": "--product test-cinematic --scenes '{\"1\":\"slow cinematic push in\"}' --quality fast --ratio landscape --yes"
      }
    ]
"""

import argparse
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from logging_config import setup_logging

# Resolve parallel_video_gen.py relative to this script
SCRIPTS_DIR = Path(__file__).resolve().parent
PARALLEL_VIDEO_GEN = SCRIPTS_DIR / "parallel_video_gen.py"

# Logger is initialized in main() after argparse (for --verbose support)
logger = None


def load_scenarios(path: str) -> list[dict]:
    """Load and validate scenarios from a JSON file.

    Args:
        path: Path to scenarios JSON file.

    Returns:
        List of scenario dicts, each with 'id', 'description', and 'args'.

    Raises:
        SystemExit: If file is missing, invalid JSON, or scenarios malformed.
    """
    scenarios_path = Path(path)
    if not scenarios_path.exists():
        logger.error(f"Scenarios file not found: {path}")
        sys.exit(1)

    try:
        with open(scenarios_path) as f:
            scenarios = json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {path}: {e}")
        sys.exit(1)

    if not isinstance(scenarios, list):
        logger.error(f"Scenarios file must contain a JSON array, got {type(scenarios).__name__}")
        sys.exit(1)

    for i, s in enumerate(scenarios):
        if not isinstance(s, dict):
            logger.error(f"Scenario {i + 1} must be an object, got {type(s).__name__}")
            sys.exit(1)
        if "id" not in s:
            logger.error(f"Scenario {i + 1} missing required 'id' field")
            sys.exit(1)
        if "args" not in s:
            logger.error(f"Scenario {i + 1} (id={s['id']}) missing required 'args' field")
            sys.exit(1)

    # Check for duplicate IDs
    ids = [s["id"] for s in scenarios]
    dupes = [sid for sid in set(ids) if ids.count(sid) > 1]
    if dupes:
        logger.error(f"Duplicate scenario IDs: {', '.join(dupes)}")
        sys.exit(1)

    return scenarios


def load_progress(path: str) -> dict[str, str]:
    """Load progress file if it exists.

    Args:
        path: Path to progress JSON file.

    Returns:
        Dict mapping scenario ID to status string.
    """
    progress_path = Path(path)
    if not progress_path.exists():
        return {}

    try:
        with open(progress_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        logger.warning(f"Could not read progress file: {path}, starting fresh")
        return {}


def save_progress(path: str, progress: dict[str, str]) -> None:
    """Save progress to file.

    Args:
        path: Path to progress JSON file.
        progress: Dict mapping scenario ID to status string.
    """
    with open(path, "w") as f:
        json.dump(progress, f, indent=2)


def progress_path_for(scenarios_path: str) -> str:
    """Derive progress file path from scenarios file path.

    Args:
        scenarios_path: Path to the scenarios JSON file.

    Returns:
        Path string with .progress.json appended.
    """
    return scenarios_path + ".progress.json"


def filter_by_range(scenarios: list[dict], range_str: str) -> list[dict]:
    """Filter scenarios by 1-based index range (e.g., '1-5' or '3').

    Args:
        scenarios: Full list of scenarios.
        range_str: Range string like '1-5' or '3'.

    Returns:
        Filtered list of scenarios.

    Raises:
        SystemExit: If range is invalid.
    """
    try:
        if "-" in range_str:
            parts = range_str.split("-", 1)
            start = int(parts[0])
            end = int(parts[1])
        else:
            start = end = int(range_str)
    except ValueError:
        logger.error(f"Invalid range: {range_str} (expected N or N-M)")
        sys.exit(1)

    if start < 1 or end < start or end > len(scenarios):
        logger.error(
            f"Range {range_str} out of bounds (scenarios: 1-{len(scenarios)})"
        )
        sys.exit(1)

    return scenarios[start - 1 : end]


def filter_by_ids(scenarios: list[dict], ids_str: str) -> list[dict]:
    """Filter scenarios by comma-separated IDs.

    Args:
        scenarios: Full list of scenarios.
        ids_str: Comma-separated scenario IDs.

    Returns:
        Filtered list of scenarios in the order specified.

    Raises:
        SystemExit: If any ID is not found.
    """
    requested = [sid.strip() for sid in ids_str.split(",")]
    by_id = {s["id"]: s for s in scenarios}

    missing = [sid for sid in requested if sid not in by_id]
    if missing:
        logger.error(f"Unknown scenario IDs: {', '.join(missing)}")
        available = ", ".join(by_id.keys())
        logger.error(f"Available: {available}")
        sys.exit(1)

    return [by_id[sid] for sid in requested]


def run_scenario(scenario: dict) -> str:
    """Run a single scenario via subprocess.

    Args:
        scenario: Scenario dict with 'id', 'args', and optional 'description'.

    Returns:
        'completed' if exit code 0, 'failed' otherwise.
    """
    sid = scenario["id"]
    desc = scenario.get("description", "")
    args_str = scenario["args"]

    logger.info(f"--- Starting: {sid} ---")
    if desc:
        logger.info(f"    {desc}")

    cmd = [sys.executable, str(PARALLEL_VIDEO_GEN), *shlex.split(args_str)]
    logger.info(f"    Command: python parallel_video_gen.py {args_str}")

    start_time = time.time()
    try:
        result = subprocess.run(cmd, timeout=None)
        elapsed = time.time() - start_time
        if result.returncode == 0:
            logger.info(f"    Completed in {elapsed:.1f}s")
            return "completed"
        else:
            logger.error(
                f"    Failed (exit code {result.returncode}) after {elapsed:.1f}s"
            )
            return "failed"
    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"    Error after {elapsed:.1f}s: {e}")
        return "failed"


def print_summary(progress: dict[str, str], scenarios: list[dict]) -> None:
    """Print a summary of the run.

    Args:
        progress: Dict mapping scenario ID to status.
        scenarios: List of scenarios that were attempted.
    """
    attempted_ids = {s["id"] for s in scenarios}
    completed = sum(
        1 for sid, status in progress.items()
        if sid in attempted_ids and status == "completed"
    )
    failed = sum(
        1 for sid, status in progress.items()
        if sid in attempted_ids and status == "failed"
    )
    skipped = sum(
        1 for sid, status in progress.items()
        if sid in attempted_ids and status == "skipped"
    )

    logger.info("")
    logger.info("=" * 50)
    logger.info("SUMMARY")
    logger.info(f"  Completed: {completed}")
    logger.info(f"  Failed:    {failed}")
    logger.info(f"  Skipped:   {skipped}")
    logger.info(f"  Total:     {len(scenarios)}")
    logger.info("=" * 50)

    if failed > 0:
        failed_ids = [
            sid for sid, status in progress.items()
            if sid in attempted_ids and status == "failed"
        ]
        logger.info(f"  Failed IDs: {', '.join(failed_ids)}")
        logger.info("  Re-run with: --ids " + ",".join(failed_ids))


def main():
    parser = argparse.ArgumentParser(
        description="Batch-run parallel_video_gen.py scenarios with resume support"
    )
    parser.add_argument(
        "--scenarios", required=True,
        help="Path to scenarios JSON file"
    )
    parser.add_argument(
        "--range",
        help="Run scenarios by 1-based index range (e.g., 1-5 or 3)"
    )
    parser.add_argument(
        "--ids",
        help="Run specific scenarios by comma-separated IDs"
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Skip already-completed scenarios"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would run without executing"
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Enable debug logging"
    )
    args = parser.parse_args()

    global logger
    logger = setup_logging(__name__, verbose=args.verbose)

    # Load scenarios
    scenarios = load_scenarios(args.scenarios)
    logger.info(f"Loaded {len(scenarios)} scenarios from {args.scenarios}")

    # Apply filters
    if args.range and args.ids:
        logger.error("--range and --ids are mutually exclusive")
        sys.exit(1)

    if args.range:
        scenarios = filter_by_range(scenarios, args.range)
        logger.info(f"Filtered to {len(scenarios)} scenarios by range {args.range}")
    elif args.ids:
        scenarios = filter_by_ids(scenarios, args.ids)
        logger.info(f"Filtered to {len(scenarios)} scenarios by IDs")

    # Load progress
    prog_path = progress_path_for(args.scenarios)
    progress = load_progress(prog_path) if args.resume else {}

    if args.resume:
        already_done = sum(
            1 for s in scenarios if progress.get(s["id"]) == "completed"
        )
        if already_done:
            logger.info(f"Resume: {already_done} scenarios already completed")

    # Dry-run
    if args.dry_run:
        logger.info("")
        logger.info("DRY RUN — would execute:")
        for i, s in enumerate(scenarios, 1):
            status = progress.get(s["id"], "pending")
            skip_mark = " [SKIP - completed]" if status == "completed" and args.resume else ""
            desc = s.get("description", "")
            logger.info(f"  {i}. [{s['id']}] {desc}{skip_mark}")
            logger.info(f"     python parallel_video_gen.py {s['args']}")
        return

    # Run scenarios
    total = len(scenarios)
    for i, scenario in enumerate(scenarios, 1):
        sid = scenario["id"]

        # Skip if already completed and --resume
        if args.resume and progress.get(sid) == "completed":
            logger.info(f"[{i}/{total}] Skipping {sid} (already completed)")
            progress[sid] = "skipped"
            save_progress(prog_path, progress)
            continue

        logger.info(f"[{i}/{total}] Running scenario: {sid}")
        status = run_scenario(scenario)
        progress[sid] = status
        save_progress(prog_path, progress)

    # Summary
    print_summary(progress, scenarios)


if __name__ == "__main__":
    main()
