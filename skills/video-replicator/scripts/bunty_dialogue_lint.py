#!/usr/bin/env python3
"""bunty_dialogue_lint.py — word-count linter for Bunty lip-sync dialogue files.

Veo I2V lip-sync clips have a FIXED 8-second duration. At >28 words the speech
gets cut off mid-sentence (confirmed 2026-05-11 with match 3 scene 17 at 34 words).
The sign-off (scene 21) is even tighter — 15-20 words max for dramatic pacing.

Usage:
    # Lint a single file
    python3 bunty_dialogue_lint.py projects/<slug>/dialogue_pair1.json

    # Lint all dialogue_*.json files in a project
    python3 bunty_dialogue_lint.py --project projects/<slug>

    # Strict mode — exit non-zero on any warning (use as pre-Veo gate)
    python3 bunty_dialogue_lint.py --project projects/<slug> --strict

Limits (from bunty-voice-guide.md, codified 2026-05-11):
    Standard lip-sync (scenes 17, 19, 20): 24-28 words MAX
    Sign-off (scene 21):                   15-20 words MAX
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Word-count limits per voice guide
STANDARD_MAX = 28           # scenes 17, 19, 20
STANDARD_RECOMMENDED = 26   # comfortable middle
SIGNOFF_SCENE = "21"
SIGNOFF_MAX = 20            # scene 21 sign-off
SIGNOFF_RECOMMENDED = 18


def count_words(text: str) -> int:
    """Count tokens that look like words (have at least one letter or digit). This excludes
    standalone punctuation like em dashes (—) which split on whitespace into their own token
    but aren't spoken by TTS / Veo. Hyphenated words like 'top-order' count as one."""
    return len([w for w in re.split(r"\s+", text.strip()) if any(c.isalnum() for c in w)])


def lint_file(path: Path) -> list[tuple[str, str, int, str]]:
    """Returns list of (scene, severity, word_count, message). severity in {ok, warn, error}."""
    try:
        data = json.loads(path.read_text())
    except Exception as e:
        return [("?", "error", 0, f"Could not parse {path}: {e}")]

    results = []
    for scene, line in data.items():
        if not isinstance(line, str):
            continue
        n = count_words(line)
        is_signoff = scene == SIGNOFF_SCENE
        max_words = SIGNOFF_MAX if is_signoff else STANDARD_MAX
        recommended = SIGNOFF_RECOMMENDED if is_signoff else STANDARD_RECOMMENDED
        label = "sign-off" if is_signoff else "lip-sync"

        if n > max_words:
            results.append((scene, "error", n, f"Scene {scene} ({label}): {n} words — OVER LIMIT ({max_words}). Veo will cut off speech mid-sentence. Trim to ≤{recommended}."))
        elif n > recommended:
            results.append((scene, "warn", n, f"Scene {scene} ({label}): {n} words — at the edge ({max_words} max). Consider trimming to ≤{recommended} for safety."))
        else:
            results.append((scene, "ok", n, f"Scene {scene} ({label}): {n} words — OK"))
    return results


def emit(results: list[tuple[str, str, int, str]], path: Path) -> int:
    """Print results with colors. Returns highest severity level (0 ok, 1 warn, 2 error)."""
    print(f"\n=== {path.name} ===")
    level = 0
    for _scene, severity, _n, msg in sorted(results, key=lambda r: r[0]):
        prefix = {"ok": "  ✓", "warn": "  ⚠", "error": "  ✗"}[severity]
        print(f"{prefix} {msg}")
        level = max(level, {"ok": 0, "warn": 1, "error": 2}[severity])
    return level


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="One or more dialogue_*.json files to lint")
    ap.add_argument("--project", help="Project directory; lints all dialogue_*.json files within")
    ap.add_argument("--strict", action="store_true", help="Exit non-zero on any warning or error (use as pre-Veo gate)")
    args = ap.parse_args()

    targets: list[Path] = []
    if args.project:
        proj = Path(args.project)
        if not proj.is_dir():
            ap.error(f"--project not a directory: {proj}")
        targets.extend(sorted(proj.glob("dialogue_*.json")))
    targets.extend(Path(f) for f in args.files)

    if not targets:
        ap.error("Provide files or --project")

    worst = 0
    for path in targets:
        if not path.exists():
            print(f"\n=== {path.name} ===\n  ✗ Not found", file=sys.stderr)
            worst = 2
            continue
        results = lint_file(path)
        worst = max(worst, emit(results, path))

    # Summary
    print()
    if worst == 0:
        print("All dialogue files within safe limits.")
    elif worst == 1:
        print("Warnings present — dialogue at the edge of Veo's cutoff threshold.")
    else:
        print("ERRORS — dialogue WILL be cut off by Veo. Trim before generating.")

    # --strict gates on warn (1) or error (2); default only fails on error
    threshold = 1 if args.strict else 2
    return 1 if worst >= threshold else 0


if __name__ == "__main__":
    sys.exit(main())
