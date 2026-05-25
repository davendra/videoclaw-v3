#!/usr/bin/env python3
"""bunty_narration_check.py — Verify slide images match the narration text.

The bunty pipeline has bitten us twice now with slide/narration misalignment:
1. NotebookLM compresses two beats into one slide → narration runs ahead of visuals
2. NotebookLM inserts an extra slide → narration runs behind visuals

This script uses Gemini Vision to check, for each slide N, whether the
narration text in editable_transcript.json["scenes"][str(N)] actually describes
what slide N's image shows. Three outcomes per slide:

  - aligned: narration describes the slide accurately
  - partial: narration is related but misses or invents content
  - mismatch: narration is talking about a different beat

Run after drafting narration, BEFORE generating TTS. Exits non-zero on any
mismatch so the operator can fix the transcript first.

Usage:
  python bunty_narration_check.py --project projects/<slug>
  python bunty_narration_check.py --project projects/<slug> --verbose
  python bunty_narration_check.py --project projects/<slug> --json
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if Path.cwd() != REPO_ROOT:
    os.chdir(REPO_ROOT)

PROMPT_TEMPLATE = """You are auditing a cricket-match-recap video pipeline. Below is one slide image from the deck and the planned narration that will play while this slide is on screen. Your job: classify whether the narration matches what the slide actually shows.

Slide {n} narration:
"{narration}"

Classify as one of:
- aligned: narration directly describes what the slide shows (key stats, player names, beat). Minor flourish/catchphrase wording is fine.
- partial: narration is in the right ballpark but misses a key element on the slide OR mentions something not shown.
- mismatch: narration describes a completely different beat (e.g. talking about the toss while slide shows a wicket).

Reply in this EXACT format (no other text):
verdict: <aligned|partial|mismatch>
reason: <one sentence explaining the verdict>
"""


def encode_image_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def check_slide(image_path: Path, narration: str, scene_num: int, api_key: str) -> dict:
    """Call Gemini Vision to classify alignment. Returns dict with verdict, reason."""
    import urllib.request

    img_b64 = encode_image_b64(image_path)
    prompt = PROMPT_TEMPLATE.format(n=scene_num, narration=narration)

    body = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": img_b64}},
            ],
        }],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 200},
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"verdict": "error", "reason": f"API call failed: {e!r}"}

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError):
        return {"verdict": "error", "reason": f"Unexpected response: {data!r}"[:200]}

    verdict = "error"
    reason = text
    for line in text.splitlines():
        if line.lower().startswith("verdict:"):
            v = line.split(":", 1)[1].strip().lower()
            if v in ("aligned", "partial", "mismatch"):
                verdict = v
        elif line.lower().startswith("reason:"):
            reason = line.split(":", 1)[1].strip()

    return {"verdict": verdict, "reason": reason}


def load_api_key() -> str | None:
    # 1. env var
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    # 2. .claude/settings.local.json
    for settings_path in [
        REPO_ROOT / ".claude" / "settings.local.json",
        REPO_ROOT.parent / ".claude" / "settings.local.json",
    ]:
        if settings_path.is_file():
            try:
                data = json.loads(settings_path.read_text())
                env = data.get("env", {})
                key = env.get("GOOGLE_API_KEY") or env.get("GEMINI_API_KEY")
                if key:
                    return key
            except json.JSONDecodeError:
                continue
    return None


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Verify slide images match planned narration via Gemini Vision",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Exit codes:
  0  all slides aligned (or only 'partial' with --allow-partial)
  1  one or more slides flagged 'partial' or 'mismatch'
  2  API call failure on at least one slide (transient)
  3  missing files (slides.jpg or transcript)

Run BEFORE generate_tts.py — catches narration drift before you pay for TTS.
""",
    )
    ap.add_argument("--project", required=True, help="Project directory (e.g. projects/<slug>)")
    ap.add_argument("--transcript", default=None,
                    help="Path to editable_transcript.json (default: <project>/audio/tts/editable_transcript.json)")
    ap.add_argument("--slides-dir", default=None,
                    help="Path to slides directory (default: <project>/slides)")
    ap.add_argument("--allow-partial", action="store_true",
                    help="Treat 'partial' as a pass (still fails on 'mismatch')")
    ap.add_argument("--json", action="store_true", help="Emit JSON report only (no human-readable lines)")
    ap.add_argument("--verbose", "-v", action="store_true", help="Print full reasons even on aligned slides")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not project.is_dir():
        print(f"ERROR: project not found: {project}", file=sys.stderr)
        return 3

    transcript_path = Path(args.transcript) if args.transcript else project / "audio" / "tts" / "editable_transcript.json"
    slides_dir = Path(args.slides_dir) if args.slides_dir else project / "slides"

    if not transcript_path.is_file():
        print(f"ERROR: transcript not found: {transcript_path}", file=sys.stderr)
        return 3
    if not slides_dir.is_dir():
        print(f"ERROR: slides dir not found: {slides_dir}", file=sys.stderr)
        return 3

    api_key = load_api_key()
    if not api_key:
        print("ERROR: no GOOGLE_API_KEY (env or .claude/settings.local.json)", file=sys.stderr)
        return 2

    data = json.loads(transcript_path.read_text())
    scenes = data.get("scenes", {})
    if not scenes:
        print(f"ERROR: no 'scenes' key in {transcript_path}", file=sys.stderr)
        return 3

    results = []
    for scene_num_str in sorted(scenes.keys(), key=lambda x: int(x) if x.isdigit() else 999):
        if not scene_num_str.isdigit():
            continue
        n = int(scene_num_str)
        narration = scenes[scene_num_str].strip()
        slide_image = slides_dir / f"slide_{n:03d}.jpg"
        if not slide_image.is_file():
            results.append({"scene": n, "verdict": "error", "reason": f"slide image missing: {slide_image.name}"})
            continue
        if not args.json:
            print(f"  checking scene {n}...", end=" ", flush=True, file=sys.stderr)
        r = check_slide(slide_image, narration, n, api_key)
        r["scene"] = n
        r["narration_preview"] = narration[:60] + ("..." if len(narration) > 60 else "")
        results.append(r)
        if not args.json:
            print(r["verdict"], file=sys.stderr)

    if args.json:
        print(json.dumps({"results": results}, indent=2))
    else:
        print(file=sys.stderr)
        print("=" * 78, file=sys.stderr)
        print(f"Narration alignment report — {len(results)} scenes", file=sys.stderr)
        print("=" * 78, file=sys.stderr)
        icon = {"aligned": "✓", "partial": "△", "mismatch": "✗", "error": "?"}
        for r in results:
            mark = icon.get(r["verdict"], "?")
            line = f"  {mark} scene {r['scene']:>2} [{r['verdict']:>8}]  {r['narration_preview']}"
            print(line, file=sys.stderr)
            if r["verdict"] in ("partial", "mismatch", "error") or args.verbose:
                print(f"          → {r['reason']}", file=sys.stderr)

    mismatches = [r for r in results if r["verdict"] == "mismatch"]
    partials = [r for r in results if r["verdict"] == "partial"]
    errors = [r for r in results if r["verdict"] == "error"]

    if errors:
        print(f"\n  {len(errors)} error(s) (API/file). Re-run; transient.", file=sys.stderr)
        return 2
    if mismatches:
        print(f"\n  {len(mismatches)} MISMATCH(es) — fix transcript before running generate_tts.py.", file=sys.stderr)
        return 1
    if partials and not args.allow_partial:
        print(f"\n  {len(partials)} PARTIAL(s) — review (--allow-partial to override).", file=sys.stderr)
        return 1
    print(f"\n  All {len(results)} scenes aligned. Safe to generate TTS.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
