#!/usr/bin/env python3
"""bunty_image_filter_check.py — Predict which slides will trip Veo's content filter.

Veo rejects ~5-15% of comic-deck slides on the first-frame-image content filter
(seen on Match 5/6/7: warriors with weapons, supernatural figures with glowing
energy balls, dark industrial imagery with helmeted silhouettes). Each rejected
slide wastes ~$0.50 at quality tier + 5 min wall time for the futile retries.

This script uses Gemini Vision to flag at-risk slides BEFORE F2V generation runs,
so the operator can either (a) accept that those slides will need static fallback,
or (b) regenerate them via Go Bananas with softer composition first.

Heuristics applied (Gemini classifies each slide on these):
- Weapon imagery (swords, guns, glowing energy weapons)
- Combat-pose silhouettes (warrior stances, fighting poses)
- Supernatural/demonic figures (glowing eyes, dark robes, dramatic auras)
- Dark industrial-noir compositions (rusted metal, dark figures in destroyed
  environments — Match 6 slide 6 was rejected for exactly this)

Verdicts:
- safe: clean composition, should pass Veo's filter
- risky: contains one or more high-risk elements; expect ~30% rejection rate
- likely-blocked: composition matches known rejection patterns; expect rejection

Usage:
  python bunty_image_filter_check.py --project projects/<slug>
  python bunty_image_filter_check.py --project projects/<slug> --json
  python bunty_image_filter_check.py --project projects/<slug> --threshold likely-blocked
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

PROMPT_TEMPLATE = """You are auditing a cricket-match-recap video deck slide. The pipeline will use this slide as a first-frame image for Google Veo (video generation). Veo has an image content filter that rejects images containing:

- Weapon imagery (swords, knives, guns, glowing energy weapons, bats held like weapons)
- Combat-pose silhouettes (warriors in fighting stances, dramatic battle poses)
- Supernatural or demonic figures (glowing eyes, hooded dark figures, dramatic auras around people)
- Dark industrial-noir compositions (rusted metal scoreboards, dark helmeted silhouettes in destroyed environments)

The slide should be ABOUT cricket (statistics, team logos, player portraits in cricket gear, scoreboards) — but stylised comic-book panels sometimes lean into action-hero/warrior aesthetics that look like combat imagery to the filter.

Classify the attached slide image. Reply in this EXACT format (no other text):
verdict: <safe|risky|likely-blocked>
reason: <one sentence noting any flagged elements; if safe, say "clean cricket composition">
"""


def encode_image_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def check_image(image_path: Path, api_key: str) -> dict:
    import urllib.request

    img_b64 = encode_image_b64(image_path)
    body = {
        "contents": [{
            "parts": [
                {"text": PROMPT_TEMPLATE},
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
            if v in ("safe", "risky", "likely-blocked"):
                verdict = v
        elif line.lower().startswith("reason:"):
            reason = line.split(":", 1)[1].strip()
    return {"verdict": verdict, "reason": reason}


def load_api_key() -> str | None:
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if key:
        return key
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


VERDICT_ORDER = {"safe": 0, "risky": 1, "likely-blocked": 2}


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Predict Veo content-filter rejections on deck slides via Gemini Vision",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Exit codes:
  0  no slides at or above threshold
  1  one or more slides flagged at or above threshold
  2  API call failure on at least one slide
  3  missing files

Run BEFORE bunty_animate_slides.py — flags rejection risk early, saves credits.
""",
    )
    ap.add_argument("--project", required=True, help="Project directory (e.g. projects/<slug>)")
    ap.add_argument("--slides-dir", default=None,
                    help="Path to slides directory (default: <project>/slides)")
    ap.add_argument("--threshold", default="likely-blocked", choices=["risky", "likely-blocked"],
                    help="Exit non-zero if any slide is at or above this verdict (default: likely-blocked)")
    ap.add_argument("--json", action="store_true", help="Emit JSON report only")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not project.is_dir():
        print(f"ERROR: project not found: {project}", file=sys.stderr)
        return 3

    slides_dir = Path(args.slides_dir) if args.slides_dir else project / "slides"
    if not slides_dir.is_dir():
        print(f"ERROR: slides dir not found: {slides_dir}", file=sys.stderr)
        return 3

    api_key = load_api_key()
    if not api_key:
        print("ERROR: no GOOGLE_API_KEY (env or .claude/settings.local.json)", file=sys.stderr)
        return 2

    slide_paths = sorted(slides_dir.glob("slide_*.jpg"))
    if not slide_paths:
        print(f"ERROR: no slide images found in {slides_dir}", file=sys.stderr)
        return 3

    results = []
    for path in slide_paths:
        # Parse scene number from filename: slide_NNN.jpg
        try:
            n = int(path.stem.split("_")[1])
        except (IndexError, ValueError):
            continue
        if not args.json:
            print(f"  checking slide {n}...", end=" ", flush=True, file=sys.stderr)
        r = check_image(path, api_key)
        r["scene"] = n
        r["slide_path"] = str(path)
        results.append(r)
        if not args.json:
            print(r["verdict"], file=sys.stderr)

    if args.json:
        print(json.dumps({"results": results}, indent=2))
    else:
        print(file=sys.stderr)
        print("=" * 78, file=sys.stderr)
        print(f"Veo content-filter prediction — {len(results)} slides", file=sys.stderr)
        print("=" * 78, file=sys.stderr)
        icon = {"safe": "✓", "risky": "△", "likely-blocked": "✗", "error": "?"}
        for r in results:
            mark = icon.get(r["verdict"], "?")
            print(f"  {mark} slide {r['scene']:>2} [{r['verdict']:>15}]  {r['reason']}", file=sys.stderr)

    errors = [r for r in results if r["verdict"] == "error"]
    if errors:
        print(f"\n  {len(errors)} error(s); transient — re-run.", file=sys.stderr)
        return 2

    threshold_level = VERDICT_ORDER[args.threshold]
    flagged = [r for r in results if VERDICT_ORDER.get(r["verdict"], -1) >= threshold_level]
    if flagged:
        print(f"\n  {len(flagged)} slide(s) at or above '{args.threshold}' threshold.", file=sys.stderr)
        print(f"  Consider regenerating those via Go Bananas with softer composition", file=sys.stderr)
        print(f"  before paying for F2V at quality tier (~$0.50 per failed scene).", file=sys.stderr)
        return 1
    print(f"\n  All {len(results)} slides predicted safe. Proceed with bunty_animate_slides.py.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
