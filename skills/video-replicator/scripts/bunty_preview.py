#!/usr/bin/env python3
"""bunty_preview.py — generate a Bunty match-recap review page.

Reads a project's slides, narration, lip-sync clips, screenshots, and final
stitch, then emits projects/<slug>/preview.html — a single self-contained
file viewable in any browser. All paths in the page are relative to the
project dir so the page travels with the project.

Modeled on projects/mirchi-mode/preview.html (SHAKTI MIRCHI review page).
Bunty palette: orange blazer accent + cricket green secondary.

Usage:
  python3 bunty_preview.py --project projects/<slug>
  python3 bunty_preview.py --latest                  # newest projects/ dir
  python3 bunty_preview.py --project ... --open      # auto-open in browser

Exit codes:
  0 success
  1 project not found or missing required assets
  2 malformed inputs (bad JSON, etc.)
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional


PROJECTS_ROOT = Path(__file__).resolve().parents[3] / "projects"


# ---------------------------------------------------------------- discovery


def newest_project(root: Path) -> Optional[Path]:
    candidates = [p for p in root.iterdir() if p.is_dir() and (p / "reference").exists()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def find_final_video(project: Path) -> tuple[Optional[Path], Optional[Path]]:
    """Return (animated_mp4, static_mp4) — either may be None."""
    final = project / "final"
    if not final.exists():
        return None, None
    animated = next(iter(final.glob("*_BUNTY_animated.mp4")), None)
    static = next(
        (p for p in final.glob("*_BUNTY.mp4") if "animated" not in p.name),
        None,
    )
    return animated, static


def ffprobe_duration(path: Path) -> Optional[float]:
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error", "-show_entries",
                "format=duration", "-of", "csv=p=0", str(path),
            ],
            stderr=subprocess.DEVNULL, timeout=10,
        )
        return float(out.decode().strip())
    except Exception:
        return None


def file_size_mb(path: Path) -> Optional[float]:
    try:
        return path.stat().st_size / (1024 * 1024)
    except Exception:
        return None


# --------------------------------------------------------- match_facts parsing


MATCH_FACTS_PATTERNS = {
    "teams": re.compile(r"^\s*(.+?CC[^V]*)\s+Vs\s+(.+?CC[^\n]*?)\s*$", re.MULTILINE),
    "ground": re.compile(r"Ground\s+(.+?)\s{2,}", re.MULTILINE),
    "date": re.compile(r"Date\s+([A-Za-z]+\s+\d+[a-z]{2}\s+[A-Za-z]+\s+\d{4})"),
    "toss": re.compile(r"Toss\s+(.+?)\s{2,}", re.MULTILINE),
    "result": re.compile(r"Result\s*:\s*(.+?)\s*$", re.MULTILINE),
    "league": re.compile(r"League:\s*(.+?)\s{2,}", re.MULTILINE),
}


def parse_match_facts(text: str) -> dict:
    out = {}
    for key, pat in MATCH_FACTS_PATTERNS.items():
        m = pat.search(text)
        if m:
            if key == "teams":
                out["home_team"] = m.group(1).strip()
                out["away_team"] = m.group(2).strip()
            else:
                out[key] = m.group(1).strip()
    return out


# ---------------------------------------------------------------- rendering


CSS = """
:root {
  color-scheme: dark;
  --bg: #0a0a0d;
  --panel: #14141a;
  --panel-2: #1a1a22;
  --line: #232330;
  --ink: #e8e6e1;
  --ink-2: #b6b6c0;
  --ink-3: #7a7a86;
  --ink-4: #4f4f5a;
  --bunty-orange: #e8862e;
  --cricket-green: #1f7a4d;
  --accent: #ffb454;
  --danger: #d8556a;
  --good: #5fc792;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: radial-gradient(ellipse 1200px 600px at 50% -50px, rgba(232,134,46,0.08), transparent 60%),
              var(--bg);
  color: var(--ink);
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif;
  padding: 56px 32px 96px;
  max-width: 1480px;
  margin: 0 auto;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: var(--ink-2); background: #20202a; padding: 1px 6px; border-radius: 4px; }

header.hero { margin-bottom: 56px; }
.eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .22em; text-transform: uppercase; color: var(--ink-3); }
h1 { font-size: 56px; font-weight: 800; letter-spacing: -.02em; line-height: 1.02; margin: 8px 0 10px; display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
h1 .vs { color: var(--ink-3); font-weight: 400; }
h1 .crest { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: #1c1c20; border: 1px solid var(--line); }
.tagline { color: var(--ink-2); font-size: 16px; max-width: 760px; margin-bottom: 22px; }
.bunty-bar {
  height: 5px; width: 240px; border-radius: 3px;
  background: linear-gradient(90deg, var(--bunty-orange) 0 60%, var(--cricket-green) 60%);
}

.stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin: 36px 0 64px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px 18px; }
.stat .v { font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
.stat .l { font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); margin-top: 4px; }

section { margin-bottom: 64px; }
h2 { font-size: 11px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px; }
.section-title { font-size: 28px; font-weight: 700; letter-spacing: -.01em; margin-bottom: 6px; }
.section-sub { color: var(--ink-2); font-size: 14px; margin-bottom: 24px; max-width: 760px; }
.section-head { padding-bottom: 16px; border-bottom: 1px solid var(--line); margin-bottom: 28px; }

.hero-video {
  margin: 0 0 56px;
  background: linear-gradient(180deg, rgba(232,134,46,0.08), rgba(31,122,77,0.04) 60%, transparent);
  border: 1px solid var(--line); border-radius: 18px;
  padding: 22px; overflow: hidden; position: relative;
}
.hero-video::before {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, var(--bunty-orange) 0 60%, var(--cricket-green) 60%);
  height: 3px; top: 0; bottom: auto;
}
.hero-video video { width: 100%; aspect-ratio: 16/9; display: block; background: #000; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.hero-video .hv-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; padding: 0 6px; gap: 14px; flex-wrap: wrap; }
.hero-video .hv-label { font-size: 11px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--accent); }
.hero-video .hv-title { font-size: 18px; font-weight: 700; color: var(--ink); margin-top: 4px; }
.hero-video .hv-stats { font-size: 12px; color: var(--ink-3); font-family: ui-monospace, "SF Mono", Menlo, monospace; }

.match-card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 26px 28px;
  display: grid; grid-template-columns: 1.2fr 1fr; gap: 32px;
}
.match-card .mc-facts dt { font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); margin-top: 16px; }
.match-card .mc-facts dt:first-child { margin-top: 0; }
.match-card .mc-facts dd { font-size: 15px; color: var(--ink); margin-top: 4px; }
.match-card .mc-result { font-size: 20px; font-weight: 700; color: var(--accent); }
.match-card .mc-shots { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.match-card .mc-shots .shot { background: #0e0e14; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.match-card .mc-shots .shot img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }
.match-card .mc-shots .shot .lbl { padding: 6px 10px; font-size: 10px; color: var(--ink-3); letter-spacing: .12em; text-transform: uppercase; }

.deck-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
@media (max-width: 1100px) { .deck-grid { grid-template-columns: 1fr; } }
.slide-card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: grid; grid-template-columns: 280px 1fr; }
.slide-card .slide-img img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; background: #1c1c20; }
.slide-card .slide-body { padding: 16px 18px; display: flex; flex-direction: column; }
.slide-card .slide-num { font-size: 10px; font-weight: 700; letter-spacing: .18em; color: var(--bunty-orange); text-transform: uppercase; }
.slide-card .slide-text { font-size: 13px; line-height: 1.55; color: var(--ink); margin-top: 6px; flex: 1; }
.slide-card audio { width: 100%; margin-top: 10px; height: 32px; }
.slide-card .slide-dur { font-size: 10px; color: var(--ink-4); margin-top: 6px; font-family: ui-monospace, monospace; }

.presenter { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-bottom: 24px; }
.presenter .p-card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.presenter .p-card .p-img img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
.presenter .p-card .p-cap { padding: 14px 18px; }
.presenter .p-card .p-cap .lbl { font-size: 10px; font-weight: 700; letter-spacing: .14em; color: var(--bunty-orange); text-transform: uppercase; }
.presenter .p-card .p-cap .title { font-size: 14px; font-weight: 600; margin-top: 4px; }

.clip-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 1100px) { .clip-grid { grid-template-columns: repeat(2, 1fr); } }
.clip { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.clip video { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; background: #000; }
.clip .cap { padding: 12px 14px; }
.clip .cid { font-size: 10px; font-weight: 700; letter-spacing: .14em; color: var(--accent); }
.clip .ctitle { font-size: 13px; color: var(--ink); margin-top: 3px; font-weight: 600; }
.clip .csub { font-size: 11px; color: var(--ink-3); margin-top: 2px; }

.finals { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
.finals .final-card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.finals .final-card.featured { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(255,180,84,0.25); }
.finals .final-card video { width: 100%; aspect-ratio: 16/9; object-fit: contain; display: block; background: #000; }
.finals .final-card .cap { padding: 16px 20px; }
.finals .final-card .v { font-size: 18px; font-weight: 700; }
.finals .final-card .v .star { color: var(--accent); margin-left: 8px; }
.finals .final-card .meta { font-size: 11px; color: var(--ink-3); margin-top: 4px; font-family: ui-monospace, monospace; }

.audio-strip { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px 26px; }
.audio-strip audio { width: 100%; }
.audio-strip .lbl { font-size: 11px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; }

.journey { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px 28px; }
.journey ol { list-style: none; counter-reset: step; }
.journey li { position: relative; padding: 14px 0 14px 64px; border-bottom: 1px dashed var(--line); }
.journey li:last-child { border-bottom: none; }
.journey li::before {
  counter-increment: step; content: counter(step);
  position: absolute; left: 0; top: 14px;
  width: 42px; height: 42px; border-radius: 50%;
  background: linear-gradient(135deg, var(--bunty-orange), var(--cricket-green));
  color: #0a0a0d; font-weight: 800; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
}
.journey .step-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.journey .step-body { font-size: 13px; color: var(--ink-2); margin-top: 4px; line-height: 1.55; }
.journey .step-tag { font-size: 10px; font-weight: 700; letter-spacing: .14em; color: var(--accent); text-transform: uppercase; margin-bottom: 2px; display: block; }

footer { margin-top: 72px; padding-top: 26px; border-top: 1px solid var(--line); color: var(--ink-4); font-size: 12px; text-align: center; }

/* Review HUD + card controls (contract-compatible with videoclaw review-pages) */
body[data-mode="edit"] { padding-bottom: 140px; }
.hud {
  position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
  background: rgba(20,20,26,0.92); backdrop-filter: blur(12px);
  border: 1px solid var(--line); border-radius: 999px;
  padding: 10px 18px; display: flex; gap: 16px; align-items: center;
  font-size: 12px; font-weight: 600; letter-spacing: .08em;
  z-index: 50; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
}
.hud .rs-approved { color: var(--good); }
.hud .rs-regen { color: var(--accent); }
.hud button#copy-decisions-btn {
  background: var(--bunty-orange); color: #0a0a0d; border: none;
  padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 11px;
  letter-spacing: .12em; text-transform: uppercase; cursor: pointer;
  transition: transform .12s ease;
}
.hud button#copy-decisions-btn:hover { transform: translateY(-1px); }
[data-card-kind] .review-controls {
  display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; align-items: center;
}
[data-card-kind] .review-btn {
  background: #0e0e14; color: var(--ink-2); border: 1px solid var(--line);
  padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600;
  letter-spacing: .08em; cursor: pointer; transition: all .12s ease;
}
[data-card-kind] .review-btn:hover { color: var(--ink); border-color: var(--ink-3); }
[data-card-kind] .review-btn[data-review-action="approve"][aria-pressed="true"] {
  background: rgba(95,199,146,0.15); color: var(--good); border-color: var(--good);
}
[data-card-kind] .review-btn[data-review-action="regenerate"][aria-pressed="true"] {
  background: rgba(255,180,84,0.15); color: var(--accent); border-color: var(--accent);
}
[data-card-kind] .review-note {
  width: 100%; margin-top: 10px; background: #0e0e14; color: var(--ink);
  border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
  resize: vertical; min-height: 56px;
}
[data-card-kind] .review-note:focus { outline: none; border-color: var(--bunty-orange); }
body[data-mode="client"] .hud,
body[data-mode="client"] .review-controls,
body[data-mode="client"] .review-note { display: none; }

nav.toc {
  position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px);
  background: rgba(10,10,13,0.78); border-bottom: 1px solid var(--line);
  padding: 12px 16px; margin: -56px -32px 28px; display: flex; gap: 4px; flex-wrap: wrap;
  align-items: center; justify-content: center;
}
nav.toc a { font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); padding: 6px 12px; border-radius: 6px; }
nav.toc a:hover { color: var(--ink); background: var(--panel); text-decoration: none; }
"""


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def rel(path: Path, root: Path) -> str:
    """Relative path from project root, forward slashes."""
    return str(path.relative_to(root)).replace(os.sep, "/")


def fmt_duration(seconds: Optional[float]) -> str:
    if seconds is None:
        return "—"
    m = int(seconds // 60)
    s = int(seconds - m * 60)
    return f"{m}:{s:02d}"


def fmt_size(mb: Optional[float]) -> str:
    if mb is None:
        return "—"
    return f"{mb:.0f} MB" if mb >= 1 else f"{mb*1024:.0f} KB"


# ---------------------------------------------------------------- main render


REVIEW_JS = r"""
// Lifted from videoclaw src/video/review-pages/templates/review.js so the
// VIDEOCLAW_REVIEW_DECISIONS paste-back contract stays compatible.
(function () {
  function refreshHud() {
    var approved = document.querySelectorAll('[data-review-action="approve"][aria-pressed="true"]').length;
    var regen = document.querySelectorAll('[data-review-action="regenerate"][aria-pressed="true"]').length;
    var a = document.getElementById('rs-approved');
    var r = document.getElementById('rs-regen');
    if (a) a.textContent = '✅ ' + approved + ' approved';
    if (r) r.textContent = '🔄 ' + regen + ' to regenerate';
  }
  function initToggles() {
    document.querySelectorAll('.review-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pressed = btn.getAttribute('aria-pressed') === 'true';
        var card = btn.closest('[data-card-kind]');
        if (card) card.querySelectorAll('.review-btn').forEach(function (b) {
          b.setAttribute('aria-pressed', 'false');
        });
        btn.setAttribute('aria-pressed', pressed ? 'false' : 'true');
        refreshHud();
      });
    });
  }
  function gatherDecisions() {
    var out = [];
    document.querySelectorAll('[data-card-kind]').forEach(function (card) {
      var action = card.querySelector('.review-btn[aria-pressed="true"]');
      if (!action) return;
      var note = card.querySelector('.review-note');
      out.push({
        kind: card.dataset.cardKind,
        id: card.dataset.cardId,
        action: action.dataset.reviewAction,
        note: note ? note.value.trim() : ''
      });
    });
    return out;
  }
  function initCopy() {
    var btn = document.getElementById('copy-decisions-btn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var decisions = gatherDecisions();
      var payload = decisions.length
        ? decisions.map(function (d) {
            return '- ' + d.kind + '#' + d.id + ': ' + d.action +
              (d.note ? ' — ' + d.note.replace(/\n/g, ' / ') : '');
          }).join('\n')
        : '(no decisions selected)';
      var block = 'VIDEOCLAW_REVIEW_DECISIONS\n' + payload + '\n';
      try {
        await navigator.clipboard.writeText(block);
        btn.textContent = '✅ Copied — paste into LLM';
        setTimeout(function () { btn.textContent = '📋 Copy Review Decisions'; }, 2200);
      } catch (e) {
        console.log(block);
        btn.textContent = '⚠ Clipboard blocked — see console';
      }
    });
  }
  function init() {
    if (document.body.dataset.mode !== 'edit') return;
    initToggles();
    initCopy();
    refreshHud();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
"""


def review_controls(kind: str, card_id: str | int, prefill_note: str = "") -> str:
    """Approve / Regen buttons + editable note textarea. Hidden in client mode by CSS."""
    return f"""        <div class="review-controls">
          <button type="button" class="review-btn" data-review-action="approve" aria-pressed="false">✅ Approve</button>
          <button type="button" class="review-btn" data-review-action="regenerate" aria-pressed="false">🔄 Regenerate</button>
        </div>
        <textarea class="review-note" placeholder="Notes / rewrite (sent with the decision)…">{esc(prefill_note)}</textarea>
"""


def render(project: Path, mode: str = "edit") -> str:
    ref = project / "reference"
    slides = project / "slides"
    videos = project / "videos"
    images = project / "images"
    tts_dir = project / "audio" / "tts"
    final_dir = project / "final"

    # Match facts
    facts_path = ref / "match_facts.txt"
    facts = parse_match_facts(facts_path.read_text(errors="ignore")) if facts_path.exists() else {}
    home = facts.get("home_team", "Home")
    away = facts.get("away_team", "Away")
    short_home = home.split(" CC")[0].strip() if " CC" in home else home
    short_away = away.split(" CC")[0].strip() if " CC" in away else away
    title_short = f"{short_home} vs {short_away}"

    # Deck meta + transcript + manifest
    deck_meta = {}
    if (project / "analysis" / "deck_meta.json").exists():
        deck_meta = json.loads((project / "analysis" / "deck_meta.json").read_text())
    num_slides = deck_meta.get("num_slides")

    transcript = {}
    et_path = tts_dir / "editable_transcript.json"
    if et_path.exists():
        transcript = json.loads(et_path.read_text()).get("scenes", {})

    nm_path = project / "audio" / "narration_manifest.json"
    durations: dict[int, float] = {}
    if nm_path.exists():
        nm = json.loads(nm_path.read_text())
        for s in nm.get("scenes", []):
            durations[int(s["scene_number"])] = float(s.get("duration") or 0.0)

    # Slide files (use deck count, else discover)
    slide_files = sorted(slides.glob("slide_*.jpg"))
    if num_slides is None:
        num_slides = len(slide_files)

    # Final videos
    animated, static = find_final_video(project)
    hero = animated or static
    hero_dur = ffprobe_duration(hero) if hero else None
    hero_size = file_size_mb(hero) if hero else None

    # Lip-sync clips (voice-changed preferred)
    clip_specs = [
        (17, "Intro 1", "Bunty opens"),
        (19, "Intro 2", "Chained · sets the match"),
        (20, "Outro 1", "Bunty closes"),
        (21, "Outro 2", "Chained · sign-off"),
    ]
    lip_clips = []
    for scene, label, sub in clip_specs:
        vc = videos / f"run001_scene_{scene}_vc.mp4"
        raw = videos / f"run001_scene_{scene}.mp4"
        chosen = vc if vc.exists() else (raw if raw.exists() else None)
        lip_clips.append((scene, label, sub, chosen))

    # Bunty character source frames
    intro_frame = images / "run001_scene_17_frame.jpg"
    outro_frame = images / "run001_scene_20_frame.jpg"

    # Reference screenshots — match_hero leads (the splash with logos + result).
    # Ball-by-ball is text now (extracted directly from the DOM), not a screenshot,
    # so it doesn't appear in the image strip — the deck consumes it as an NLM source.
    screenshots = [
        ("match_hero.png", "Result hero"),
        ("scorecard_screenshot.png", "Scorecard"),
        ("division_table_screenshot.png", "Division table"),
        ("match_branding.png", "Match header"),
    ]
    available_shots = [(p, lbl) for p, lbl in screenshots if (ref / p).exists()]

    # Team crests (downloaded from play-cricket badge_image URLs)
    home_logo = ref / "home_logo.png"
    away_logo = ref / "away_logo.png"

    # Audio: full narration track
    narration_mp3 = project / "audio" / "narration.mp3"

    # --- build HTML ---
    out: list[str] = []
    a = out.append

    a(f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title_short)} — Bunty Match Day Analysis</title>
<style>{CSS}</style>
</head>
<body data-mode="{esc(mode)}">

<nav class="toc">
  <a href="#match">Match</a>
  <a href="#deck">Deck &amp; narration</a>
  <a href="#presenter">Bunty</a>
  <a href="#final">Final cut</a>
  <a href="#journey">Journey</a>
</nav>

<header class="hero">
  <div class="eyebrow">Match Day Analysis · Bunty · {esc(facts.get('league','Cricket'))}</div>
  <h1>
    {f'<img class="crest" src="{esc(rel(home_logo, project))}" alt="{esc(short_home)} logo">' if home_logo.exists() else ''}
    <span>{esc(short_home)}</span>
    <span class="vs">vs</span>
    <span>{esc(short_away)}</span>
    {f'<img class="crest" src="{esc(rel(away_logo, project))}" alt="{esc(short_away)} logo">' if away_logo.exists() else ''}
  </h1>
  <p class="tagline">{esc(facts.get('result', 'Match recap'))} · {esc(facts.get('ground', ''))} · {esc(facts.get('date', ''))}. Narrated by Bunty (cartoon Indian commentator, orange blazer) with {num_slides} NotebookLM-generated stat cards and a Bunty lip-synced intro + outro pair.</p>
  <div class="bunty-bar"></div>
</header>
""")

    if hero:
        kind = "animated" if hero == animated else "static slides"
        a(f"""
<div class="hero-video">
  <video controls preload="metadata" playsinline src="{esc(rel(hero, project))}"></video>
  <div class="hv-meta">
    <div>
      <div class="hv-label">★ Final cut · {esc(kind)}</div>
      <div class="hv-title">{esc(title_short)} — Bunty</div>
    </div>
    <div class="hv-stats">{fmt_duration(hero_dur)} · {fmt_size(hero_size)}</div>
  </div>
</div>
""")

    # stats strip
    style = deck_meta.get("style", "broadcast")
    a(f"""
<div class="stats">
  <div class="stat"><div class="v">{num_slides}</div><div class="l">Slides</div></div>
  <div class="stat"><div class="v">{len(lip_clips)}</div><div class="l">Lip-sync clips</div></div>
  <div class="stat"><div class="v">{len(transcript)}</div><div class="l">Narration beats</div></div>
  <div class="stat"><div class="v">{fmt_duration(hero_dur)}</div><div class="l">Runtime</div></div>
  <div class="stat"><div class="v">{esc(style)}</div><div class="l">Deck style</div></div>
  <div class="stat"><div class="v">{fmt_size(hero_size)}</div><div class="l">Final size</div></div>
</div>
""")

    # MATCH
    a(f"""
<section id="match">
  <div class="section-head">
    <h2>Section 01</h2>
    <div class="section-title">The match — {esc(facts.get('league',''))}</div>
    <div class="section-sub">Source material captured from play-cricket: the scorecard with captain/keeper icons preserved, ball-by-ball detail for wicket drama, and the live division-table for the closing beat.</div>
  </div>
  <div class="match-card">
    <div>
      <dl class="mc-facts">
        <dt>Result</dt><dd class="mc-result">{esc(facts.get('result','—'))}</dd>
        <dt>Ground</dt><dd>{esc(facts.get('ground','—'))}</dd>
        <dt>Date</dt><dd>{esc(facts.get('date','—'))}</dd>
        <dt>Toss</dt><dd>{esc(facts.get('toss','—'))}</dd>
        <dt>League</dt><dd>{esc(facts.get('league','—'))}</dd>
      </dl>
    </div>
    <div class="mc-shots">
""")
    for fn, lbl in available_shots:
        a(f"""      <div class="shot"><img src="reference/{esc(fn)}" alt="{esc(lbl)}"><div class="lbl">{esc(lbl)}</div></div>\n""")
    a("""    </div>
  </div>
</section>
""")

    # DECK + narration
    a(f"""
<section id="deck">
  <div class="section-head">
    <h2>Section 02</h2>
    <div class="section-title">The deck — {num_slides} stat cards with Bunty narration</div>
    <div class="section-sub">NotebookLM-generated {esc(style)} deck. Each slide pairs the rendered image with Bunty's voice-line and the ElevenLabs TTS clip. Edit <code>audio/tts/editable_transcript.json</code> + rerun TTS if any line needs a tweak.</div>
  </div>
  <div class="deck-grid">
""")
    for i in range(1, (num_slides or 0) + 1):
        slide_img = slides / f"slide_{i:03d}.jpg"
        tts = tts_dir / f"scene_{i}_tts.mp3"
        text = transcript.get(str(i), "")
        dur = durations.get(i)
        img_html = (
            f'<img src="{esc(rel(slide_img, project))}" alt="Slide {i}">'
            if slide_img.exists()
            else '<div style="aspect-ratio:16/9;background:#1c1c20;"></div>'
        )
        audio_html = (
            f'<audio controls preload="none" src="{esc(rel(tts, project))}"></audio>'
            if tts.exists() else ""
        )
        dur_html = f'<div class="slide-dur">{dur:.1f}s</div>' if dur else ""
        a(f"""    <div class="slide-card" data-card-kind="slide" data-card-id="{i}">
      <div class="slide-img">{img_html}</div>
      <div class="slide-body">
        <div class="slide-num">Beat {i:02d}</div>
        <div class="slide-text">{esc(text) or '<em style="color:var(--ink-4)">No narration drafted</em>'}</div>
        {audio_html}
        {dur_html}
{review_controls('slide', i, prefill_note=text)}      </div>
    </div>
""")
    a("""  </div>
</section>
""")

    # narration full track
    if narration_mp3.exists():
        a(f"""
<section id="audio">
  <div class="section-head">
    <h2>Section 03</h2>
    <div class="section-title">Full narration track</div>
    <div class="section-sub">All {len(transcript)} beats concatenated, ElevenLabs voice <code>nwj0s2LU9bDWRKND5yzA</code> (Bunty).</div>
  </div>
  <div class="audio-strip">
    <div class="lbl">narration.mp3 · Bunty voice</div>
    <audio controls src="{esc(rel(narration_mp3, project))}"></audio>
  </div>
</section>
""")

    # PRESENTER section: Bunty character + lip-sync clips
    a(f"""
<section id="presenter">
  <div class="section-head">
    <h2>Section 04</h2>
    <div class="section-title">Bunty as presenter — intro + outro</div>
    <div class="section-sub">Go Bananas <code>character_id=97</code>, hair-locked canonical prompt. Two source frames (intro + outro) drive four Veo I2V lip-sync clips chained 2+2, voice-changed with the same ElevenLabs voice.</div>
  </div>
  <div class="presenter">
""")
    for path, lbl, title, card_id in [
        (intro_frame, "Intro source frame", "Bunty opens (scene 17 input)", "intro"),
        (outro_frame, "Outro source frame", "Bunty closes (scene 20 input)", "outro"),
    ]:
        if path.exists():
            a(f"""    <div class="p-card" data-card-kind="presenter" data-card-id="{esc(card_id)}">
      <div class="p-img"><img src="{esc(rel(path, project))}" alt="{esc(lbl)}"></div>
      <div class="p-cap"><div class="lbl">{esc(lbl)}</div><div class="title">{esc(title)}</div>
{review_controls('presenter', card_id)}      </div>
    </div>
""")
    a("""  </div>
  <div class="clip-grid">
""")
    for scene, label, sub, clip in lip_clips:
        if clip and clip.exists():
            vc_badge = " · voice-changed" if clip.name.endswith("_vc.mp4") else ""
            a(f"""    <div class="clip" data-card-kind="clip" data-card-id="{scene}">
      <video controls preload="metadata" src="{esc(rel(clip, project))}"></video>
      <div class="cap">
        <div class="cid">Scene {scene}</div>
        <div class="ctitle">{esc(label)}</div>
        <div class="csub">{esc(sub)}{vc_badge}</div>
{review_controls('clip', scene)}      </div>
    </div>
""")
    a("""  </div>
</section>
""")

    # FINAL CUT (both if present)
    if animated or static:
        a(f"""
<section id="final">
  <div class="section-head">
    <h2>Section 05</h2>
    <div class="section-title">Final cut</div>
    <div class="section-sub">The stitched MP4{'s' if animated and static else ''}. Animated uses F2V ambient-motion loops on every slide; static uses still slide images.</div>
  </div>
  <div class="finals">
""")
        if animated:
            dur = ffprobe_duration(animated); sz = file_size_mb(animated)
            a(f"""    <div class="final-card featured" data-card-kind="final" data-card-id="animated">
      <video controls preload="metadata" src="{esc(rel(animated, project))}"></video>
      <div class="cap">
        <div class="v">Animated <span class="star">★ recommended</span></div>
        <div class="meta">{esc(animated.name)} · {fmt_duration(dur)} · {fmt_size(sz)}</div>
{review_controls('final', 'animated')}      </div>
    </div>
""")
        if static:
            dur = ffprobe_duration(static); sz = file_size_mb(static)
            a(f"""    <div class="final-card" data-card-kind="final" data-card-id="static">
      <video controls preload="metadata" src="{esc(rel(static, project))}"></video>
      <div class="cap">
        <div class="v">Static slides</div>
        <div class="meta">{esc(static.name)} · {fmt_duration(dur)} · {fmt_size(sz)}</div>
{review_controls('final', 'static')}      </div>
    </div>
""")
        a("""  </div>
</section>
""")

    # JOURNEY
    url = deck_meta.get("url", "")
    a(f"""
<section id="journey">
  <div class="section-head">
    <h2>Section 06</h2>
    <div class="section-title">Production journey</div>
    <div class="section-sub">How this video came together, top to bottom — every step the Bunty skill ran for this match.</div>
  </div>
  <div class="journey">
    <ol>
      <li><span class="step-tag">Source</span><div class="step-title">play-cricket URL → /print scorecard</div><div class="step-body">{esc(url) or 'URL captured from match input'} — Playwright pulled the print PDF, three live screenshots (scorecard with icons, ball-by-ball, division table), and the match-header branding.</div></li>
      <li><span class="step-tag">Deck</span><div class="step-title">NotebookLM presenter_slides ({esc(style)} style)</div><div class="step-body">Six sources uploaded (PDF + 4 screenshots + URL). NLM generated {num_slides} slides: title → team-sheet → match arc → both final scorecards → division table.</div></li>
      <li><span class="step-tag">Narration</span><div class="step-title">Bunty voice-line drafting (two passes)</div><div class="step-body">Facts pass first (boring but correct), then Bunty-fy per the voice guide — catchphrases (Shabash, Hai Ram, Kya baat hai), direct address (my friends, boys), tone shifts (hype/mock-outrage/affection/sympathy), softening NLM's harsh phrasings.</div></li>
      <li><span class="step-tag">TTS</span><div class="step-title">ElevenLabs Bunty voice × {len(transcript)} scenes</div><div class="step-body">Voice <code>nwj0s2LU9bDWRKND5yzA</code>, eleven_flash_v2_5, stability 0.5, similarity 0.75.</div></li>
      <li><span class="step-tag">Images</span><div class="step-title">Bunty intro + outro via Go Bananas</div><div class="step-body">Character_id 97 with the canonical hair-locked prompt (negative-promptied against curly hair drift + clean-shaven young-guy drift).</div></li>
      <li><span class="step-tag">Animation</span><div class="step-title">Veo I2V lip-sync — 4 chained clips</div><div class="step-body">Scenes 17+19 (intro pair) and 20+21 (outro pair). Last-frame of 17 → input of 19 (and 20 → 21) for visual continuity.</div></li>
      <li><span class="step-tag">Voice-change</span><div class="step-title">Re-cast Veo audio in Bunty's voice</div><div class="step-body">ElevenLabs voice-change on the 4 lip-sync clips, seed 42, BG noise removed.</div></li>
      <li><span class="step-tag">Stitch</span><div class="step-title">stitch_bunty.py with fade-through-black at boundaries</div><div class="step-body">Intro (17,19) → slide segments (1..N) → Outro (20,21). Animated variant swaps slide segments for F2V loops.</div></li>
    </ol>
  </div>
</section>

<footer>Generated by <code>bunty_preview.py</code> · {esc(project.name)} · mode={esc(mode)}</footer>

<div class="hud" id="review-hud" role="status">
  <span class="rs-approved" id="rs-approved">✅ 0 approved</span>
  <span class="rs-regen" id="rs-regen">🔄 0 to regenerate</span>
  <button type="button" id="copy-decisions-btn">📋 Copy Review Decisions</button>
</div>

<script>{REVIEW_JS}</script>

</body>
</html>
""")

    return "".join(out)


# ---------------------------------------------------------------- CLI


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a Bunty match-recap preview.html")
    parser.add_argument("--project", help="Path to projects/<slug> directory")
    parser.add_argument("--latest", action="store_true", help="Use the newest project under projects/")
    parser.add_argument("--output", help="Output path (default: <project>/preview.html)")
    parser.add_argument("--mode", choices=["edit", "client"], default="edit",
                        help="edit (default): per-card Approve/Regen toggles + Copy Decisions HUD. "
                             "client: read-only review-only view (no decision controls).")
    parser.add_argument("--open", dest="open_after", action="store_true", help="Open in the default browser after writing")
    args = parser.parse_args()

    if args.latest:
        project = newest_project(PROJECTS_ROOT)
        if project is None:
            print(f"error: no projects found under {PROJECTS_ROOT}", file=sys.stderr)
            return 1
    elif args.project:
        project = Path(args.project).resolve()
    else:
        parser.error("--project PATH or --latest required")

    if not project.exists() or not project.is_dir():
        print(f"error: project not found: {project}", file=sys.stderr)
        return 1
    if not (project / "reference").exists():
        print(f"error: missing reference/ in {project}", file=sys.stderr)
        return 1

    out_path = Path(args.output).resolve() if args.output else (project / "preview.html")
    html_text = render(project, mode=args.mode)
    out_path.write_text(html_text, encoding="utf-8")
    print(f"wrote {out_path}  ({len(html_text)/1024:.1f} KB)")

    if args.open_after:
        if sys.platform == "darwin":
            subprocess.run(["open", str(out_path)], check=False)
        elif sys.platform.startswith("linux"):
            subprocess.run(["xdg-open", str(out_path)], check=False)
        else:
            print(f"file://{out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
