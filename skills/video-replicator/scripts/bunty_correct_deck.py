#!/usr/bin/env python3
"""bunty_correct_deck.py — Upload corrections to a NotebookLM notebook, regenerate
the deck, swap the new slides in, report which slides changed.

Use this when NotebookLM gets a fact wrong in the deck (wrong captain/keeper, wrong
figures, conflated beats, etc.). The recovery pattern is:

  1. Write a `match_facts_corrected.txt` with the authoritative corrections
  2. Upload to the existing notebook as a new source
  3. Trigger a fresh slide-deck generation with a focus prompt that explicitly
     cites the corrections source as the source of truth
  4. Poll until ready, download as deck_vN.pdf, extract slides_vN/
  5. Swap slides_vN → slides (preserving prior versions), update sidecar
  6. Print a diff: which slides changed (by content hash) so the operator knows
     which TTS + F2V loops need regen

Without this, the manual process took 8+ separate `nlm` + ffmpeg + python invocations
on Match 6 (2026-05-12). This script wraps the whole loop.

Usage:
  python bunty_correct_deck.py --project projects/<slug> \\
      --corrections projects/<slug>/reference/match_facts_corrected.txt

  # With explicit style override
  python bunty_correct_deck.py --project projects/<slug> \\
      --corrections corrections.txt --style comic

  # Dry-run (build the focus prompt but don't trigger NLM)
  python bunty_correct_deck.py --project projects/<slug> \\
      --corrections corrections.txt --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if Path.cwd() != REPO_ROOT:
    os.chdir(REPO_ROOT)

NLM = str(Path.home() / ".local/bin/nlm")
SCRIPTS_DIR = Path(__file__).resolve().parent


STYLE_PROMPTS = {
    "broadcast": "high-energy Sky Sports / ITV cricket broadcast aesthetic",
    "tabloid": "tabloid back-page newspaper aesthetic",
    "minimal": "editorial minimal aesthetic",
    "comic": "comic-book / pulp action panels",
    "indian-tv": "Indian sports TV graphics (Star Sports / Hotstar IPL)",
}


def run(cmd: list[str], *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(cmd)[:160]}", file=sys.stderr)
    r = subprocess.run(cmd, capture_output=capture, text=True)
    if check and r.returncode != 0:
        print(f"  ERROR (exit {r.returncode}): {(r.stderr or r.stdout or '')[:500]}", file=sys.stderr)
        sys.exit(r.returncode)
    return r


def hash_jpeg(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def find_next_version_dir(project: Path, base: str) -> Path:
    """Find slides_vN where N is the next unused integer."""
    n = 2
    while (project / f"{base}_v{n}").exists():
        n += 1
    return project / f"{base}_v{n}"


def wait_for_artifact(nb_id: str, prior_artifact_ids: set[str], timeout: int = 600, poll: int = 15) -> str:
    """Poll until a NEW slide-deck artifact (not in prior_artifact_ids) is ready.
    Returns the new artifact ID."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = subprocess.run([NLM, "list", "artifacts", nb_id, "--json"], capture_output=True, text=True)
        try:
            data = json.loads(r.stdout)
        except json.JSONDecodeError:
            time.sleep(poll)
            continue
        for art in data:
            kind = (art.get("type") or art.get("artifact_type") or art.get("kind") or "").lower()
            if "slide" not in kind and "deck" not in kind:
                continue
            aid = art.get("id")
            if aid in prior_artifact_ids:
                continue
            state = (art.get("status") or art.get("state") or "ready").lower()
            if state in {"ready", "completed", "done", "succeeded"}:
                return aid
            if state in {"failed", "error"}:
                sys.exit(f"NLM slide deck generation failed: {art}")
        time.sleep(poll)
    sys.exit(f"Timed out waiting for new slide deck (>{timeout}s)")


def main() -> int:
    ap = argparse.ArgumentParser(description="Upload corrections + regenerate NLM slide deck",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="Project directory (e.g. projects/<slug>)")
    ap.add_argument("--corrections", required=True,
                    help="Path to a plain-text corrections file with authoritative facts")
    ap.add_argument("--style", default=None, choices=sorted(STYLE_PROMPTS.keys()),
                    help="Deck visual style (default: read from analysis/deck_meta.json)")
    ap.add_argument("--notebook-id", default=None,
                    help="NLM notebook ID (default: read from reference/notebook_id.txt)")
    ap.add_argument("--source-title", default="CORRECTED facts (authoritative roles)",
                    help="Title for the corrections source in NLM")
    ap.add_argument("--keep-old-slides", action="store_true",
                    help="Keep slides_vN/ archive of the previous deck (default: yes)")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan and exit without calling NLM")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not project.is_dir():
        sys.exit(f"ERROR: project not found: {project}")

    corrections_path = Path(args.corrections).resolve()
    if not corrections_path.is_file():
        sys.exit(f"ERROR: corrections file not found: {corrections_path}")

    # Read notebook ID
    nb_id = args.notebook_id
    if not nb_id:
        nb_id_path = project / "reference" / "notebook_id.txt"
        if not nb_id_path.is_file():
            sys.exit(f"ERROR: notebook_id not found. Pass --notebook-id or create {nb_id_path}")
        nb_id = nb_id_path.read_text().strip()

    # Read deck style from sidecar or CLI
    style = args.style
    meta_path = project / "analysis" / "deck_meta.json"
    if not style and meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text())
            style = meta.get("style")
        except json.JSONDecodeError:
            pass
    if not style:
        style = "broadcast"
        print(f"  WARNING: no --style and no sidecar — defaulting to '{style}'", file=sys.stderr)

    # Build the focus prompt
    style_summary = STYLE_PROMPTS.get(style, STYLE_PROMPTS["broadcast"])
    focus = (
        f"Audience: club cricket fans watching a recap video. Style: {style_summary}. "
        f"Each slide is a single panel capturing one giant moment. "
        f"Tell the story of the match in ~12 beats — title card with date/ground, toss, batting "
        f"collapse and recovery, captain's anchor knock, middle-order partnerships, late cameo, "
        f"first-innings total, second-innings start, hero bowling spell, supporting bowler, "
        f"dramatic final-over moments, final result + league points. Each slide plays under ~30 "
        f"seconds of spoken Bunty commentary; prioritise visual clarity over readable text. No "
        f"walls of prose, no bullet lists longer than 3 items. Use team logos from the sources "
        f"where available. "
        f"CRITICAL ACCURACY: The source titled '{args.source_title}' is the AUTHORITATIVE source "
        f"of truth for player roles, figures, and dramatic moments. When any other source "
        f"disagrees with it, trust the corrections source."
    )

    print(f"[plan] project       = {project.name}", file=sys.stderr)
    print(f"[plan] notebook_id   = {nb_id}", file=sys.stderr)
    print(f"[plan] style         = {style}", file=sys.stderr)
    print(f"[plan] corrections   = {corrections_path}", file=sys.stderr)
    print(f"[plan] focus prompt  = {len(focus)} chars", file=sys.stderr)
    if args.dry_run:
        print("\n[dry-run] exiting before any NLM calls.", file=sys.stderr)
        return 0

    # Snapshot prior artifact IDs so we wait for the NEW one
    r = subprocess.run([NLM, "list", "artifacts", nb_id, "--json"], capture_output=True, text=True)
    prior_ids = set()
    try:
        for art in json.loads(r.stdout):
            if "slide" in (art.get("type", "") + art.get("artifact_type", "") + art.get("kind", "")).lower():
                prior_ids.add(art.get("id"))
    except json.JSONDecodeError:
        pass
    print(f"[step 1] {len(prior_ids)} prior slide-deck artifact(s) in notebook", file=sys.stderr)

    # Upload the corrections source
    print(f"\n[step 2] Uploading corrections to NotebookLM…", file=sys.stderr)
    run([NLM, "source", "add", nb_id, "--wait", "--wait-timeout", "180",
         "--file", str(corrections_path), "--title", args.source_title])

    # Trigger slide-deck regeneration
    print(f"\n[step 3] Triggering slide-deck regeneration with corrections cited as truth…", file=sys.stderr)
    run([NLM, "slides", "create", nb_id,
         "--format", "presenter_slides", "--length", "default",
         "--focus", focus, "--confirm"])

    # Wait for the new deck
    print(f"\n[step 4] Waiting for new deck (polling every 15s, timeout 10min)…", file=sys.stderr)
    new_aid = wait_for_artifact(nb_id, prior_ids)
    print(f"  new artifact ready: {new_aid}", file=sys.stderr)

    # Download + extract
    archive_base = "slides"
    if args.keep_old_slides and (project / "slides").is_dir():
        old_archive = find_next_version_dir(project, "slides")
        old_archive_name = old_archive.name
        (project / "slides").rename(old_archive)
        if (project / "analysis" / "slides.json").is_file():
            old_json = find_next_version_dir(project / "analysis", "slides")
            (project / "analysis" / "slides.json").rename(project / "analysis" / f"{old_json.name}.json")
        print(f"\n[step 5] Archived previous deck → {old_archive_name}", file=sys.stderr)

    new_deck = project / "slides" / "deck.pdf"
    new_deck.parent.mkdir(parents=True, exist_ok=True)
    run([NLM, "download", "slide-deck", nb_id, "--format", "pdf", "--no-progress",
         "-o", str(new_deck)])

    extractor = SCRIPTS_DIR / "extract_pdf_slides.py"
    run([sys.executable, str(extractor),
         "--pdf", str(new_deck),
         "--output-dir", str(project / "slides"),
         "--output-json", str(project / "analysis" / "slides.json"),
         "--dpi", "200"])

    # Update sidecar
    new_slide_count = len(list((project / "slides").glob("slide_*.jpg")))
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text())
        meta["num_slides"] = new_slide_count
        meta["version"] = f"v{len(prior_ids) + 1}-corrected"
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")

    # Report what changed (slide count delta + content hashes)
    print(f"\n[step 6] Diff report — new deck has {new_slide_count} slides", file=sys.stderr)
    if args.keep_old_slides:
        # Find the just-archived slides_v* directory
        archived = sorted(project.glob("slides_v*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if archived:
            old_dir = archived[0]
            old_count = len(list(old_dir.glob("slide_*.jpg")))
            print(f"  previous deck: {old_count} slides in {old_dir.name}", file=sys.stderr)
            print(f"  delta: {new_slide_count - old_count:+d}", file=sys.stderr)
            print(f"  per-slide content hash (first 12 chars):", file=sys.stderr)
            for i in range(1, max(old_count, new_slide_count) + 1):
                old_slide = old_dir / f"slide_{i:03d}.jpg"
                new_slide = project / "slides" / f"slide_{i:03d}.jpg"
                old_h = hash_jpeg(old_slide) if old_slide.is_file() else "—"
                new_h = hash_jpeg(new_slide) if new_slide.is_file() else "—"
                marker = " " if old_h == new_h else " * CHANGED" if old_h != "—" and new_h != "—" else " * ADDED/REMOVED"
                print(f"    slide {i:>2}  {old_h} → {new_h}{marker}", file=sys.stderr)

    print(f"\nDone. New deck: {new_deck}", file=sys.stderr)
    print(f"  Next: review slides, update editable_transcript.json if beats shifted, regen TTS + F2V loops.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
