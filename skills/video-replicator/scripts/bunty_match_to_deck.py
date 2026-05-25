#!/usr/bin/env python3
"""bunty_match_to_deck.py — One-shot URL → NotebookLM slide deck for Bunty videos.

Pipeline:
  1. Fetch a play-cricket match URL via Playwright → match.pdf + match_branding.png
  2. Create a NotebookLM notebook + add 3 sources (PDF, screenshot, URL)
  3. Generate a Presenter slide deck via `nlm slides create` with a styled focus prompt
  4. Poll until the deck artifact is ready, download as PDF
  5. Extract slides as images via extract_pdf_slides.py

Output layout:
  projects/{slug}/
    reference/match.pdf
    reference/match_branding.png
    reference/notebook_id.txt
    slides/deck.pdf
    slides/scene_1_frame.jpg ... scene_N_frame.jpg
    analysis/slides.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

NLM = str(Path.home() / ".local/bin/nlm")

# cwd hardening — the script writes relative `projects/<slug>/...` paths via
# subprocess calls. Anchor to video-replicator-veo-cli repo root regardless of
# where the caller invoked us. parents[4] climbs from
# scripts/bunty_match_to_deck.py → scripts → video-replicator → .claude/skills
# → video-replicator-veo-cli (repo root).
REPO_ROOT = Path(__file__).resolve().parents[4]
if Path.cwd() != REPO_ROOT:
    os.chdir(REPO_ROOT)

# Shared narrative-structure guidance — appended to every style.
_NARRATIVE_BEATS = (
    " Focus: tell the story of the match in ~16 beats — title card with date/ground, "
    "TEAM SHEETS slide (split-panel showing the playing XI of BOTH teams from the scorecard, "
    "with the captain — marked with a shield icon — and wicket-keeper — marked with gloves "
    "icon — visually called out per team; this is the lineup introduction slide), "
    "toss, batting collapse and recovery, captain's anchor knock, middle-order partnerships, "
    "late cameo, first-innings total, second-innings start, hero bowling spell, "
    "supporting bowler, dramatic final over moments, final result + league points, "
    "FINAL SCORECARD slide for team 1 (full batting figures: name, how out, runs, balls), "
    "FINAL SCORECARD slide for team 2 (full batting figures), "
    "LEAGUE TABLE slide (FINAL BEAT — division standings showing where the home team now "
    "sits after this result). "
    "Each slide plays under ~30 seconds of spoken Bunty commentary, so prioritise visual "
    "clarity over readable text. No walls of prose, no bullet lists longer than 3 items "
    "(EXCEPT the team-sheet, final-scorecard, and league-table slides which deliberately "
    "list players or teams). "
    "Use the team logos from the sources where available. "
    "TEAM SHEETS SLIDE: Render player names as a clean stylised list per team (one column "
    "per side), use the playing XI from the 'Scorecard screenshot' source, visually distinguish "
    "captain (with a shield/star icon next to name) and wicket-keeper (gloves icon). Do NOT "
    "include batting figures on this slide — those come later. Keep player names readable. "
    "FINAL SCORECARD SLIDES: One slide per team. Render the FULL batting "
    "scorecard from the 'Scorecard screenshot' source as a clean stylised table: player name, "
    "how out, runs, balls — top to bottom. Include the innings total + wickets + overs at the "
    "bottom. Apply the deck's visual style (e.g. tabloid newsprint, comic panels, broadcast "
    "graphics) to the table styling. Names + figures MUST be readable at video resolution. "
    "Use the same captain/keeper icons as the team-sheet slide for consistency. These are "
    "data-dense slides — give them visual room. "
    "EACH ROW MUST BE A DISTINCT BATTER from the 'Scorecard screenshot' source — DO NOT "
    "repeat the same player name across rows, even if rendering one team produces fewer "
    "batters than the other. If a batter who BATTED (was dismissed or remained not-out) "
    "appears on the scorecard, they MUST appear on this slide; if they did not bat, they "
    "must NOT appear. Cross-check the dismissed batter list against your output before "
    "finalising. (This prevents an NLM rendering quirk where one batter's row gets "
    "duplicated in place of a different batter — observed on the 2026-05-23 WICC scorecard, "
    "where Anand Panchal was rendered twice instead of Shibam Jena being included.) "
    "LEAGUE TABLE SLIDE (FINAL BEAT): Render the current division/league standings table "
    "from the 'Division table screenshot' source as a clean stylised standings panel — at "
    "minimum POS / TEAM / P (played) / W (won) / L (lost) / PTS (points). Visually HIGHLIGHT "
    "the home team's row (accent colour fill, bold typography, glow, or a callout marker) so "
    "the viewer can immediately see where the team sits after this result. If the full table "
    "is too tall, show the top 6 teams + the home team (with a small ellipsis gap if the home "
    "team is below position 6). Include the division name as a header (e.g. 'DIVISION ELEVEN "
    "WEST'). Apply the deck's visual style (tabloid newsprint, broadcast graphics, comic "
    "panels, etc.) to the standings table styling. This is the closing image of the entire "
    "recap — it answers 'so where does this match put us?' and gives the viewer a sense of "
    "season trajectory. Names + numbers MUST be readable at video resolution. "
    "RENDER THE LEAGUE TABLE EXACTLY ONCE — there is one and only one league-table slide "
    "in the deck, and it is the FINAL beat. Do NOT render a second standings slide in a "
    "different visual style; do NOT split it across two slides; do NOT add a 'standings recap' "
    "or 'final table' duplicate. If you produced the league-table slide already, the deck "
    "ends — do not append another. (This prevents an NLM rendering quirk where the league "
    "table appears twice in different aesthetics — observed on the 2026-05-23 WICC 4th XI "
    "vs Grange Park comic deck, where slide 14 rendered the table in comic style and "
    "slide 15 redundantly re-rendered the same table in broadcast style.) "
    "AUTHORITATIVE FACTS: When the sources disagree on player roles (captain vs keeper) "
    "or specific figures, the 'Scorecard screenshot' image source is the source of truth "
    "— it preserves the inline role icons (shield = captain, gloves = wicket-keeper) that "
    "the print PDF strips. The 'Ball-by-ball commentary' text source is authoritative for "
    "which over and which delivery a wicket fell on, especially the final-over drama. "
    "The 'Division table screenshot' is authoritative for current league standings, "
    "position, and points totals."
)

# Each style is a distinct VISUAL aesthetic. Same 15-beat narrative arc, different look.
STYLE_PROMPTS = {
    "broadcast": (
        "Audience: club cricket fans watching a recap video. "
        "Style: high-energy Sky Sports / ITV cricket broadcast aesthetic — bold sans-serif "
        'typography, hero-sized stat numbers (e.g. "211 ALL OUT", "4-30"), team-colour '
        "accent bars, neon-circuit overlays, glossy glow effects. ONE headline plus ONE "
        "big stat per slide, minimal prose. Sky Sports / TNT Sports / ITV Cricket feel."
    ) + _NARRATIVE_BEATS,
    "tabloid": (
        "Audience: club cricket fans watching a recap video. "
        "Style: tabloid back-page newspaper aesthetic — bold condensed serif headlines, "
        "dramatic all-caps shouts, halftone-print backgrounds, faux-newsprint texture, "
        "ink-splatter accents, faux-folded paper corners. Black-and-white photo style with "
        "one bold accent colour (red or club blue). Hero stats rendered as torn-newsprint "
        "cutouts. Headlines like 'INDIANS' AGONY' or 'MOORE MAULS!'. ONE headline plus ONE "
        "big stat per slide. Tabloid drama, not subtle."
    ) + _NARRATIVE_BEATS,
    "minimal": (
        "Audience: club cricket fans watching a recap video. "
        "Style: editorial minimal aesthetic — clean white background, single accent colour "
        "(club orange or blue), abundant negative space, ultra-modern sans-serif typography "
        "(Helvetica / Inter feel), restrained iconography, NO gradient or glow effects. "
        "Hero stat in monumental size centred, supporting context as small all-caps below. "
        "Use the team crests minimally. High-end magazine / design-publication tribute to "
        "cricket. Whitespace > visual noise."
    ) + _NARRATIVE_BEATS,
    "comic": (
        "Audience: club cricket fans watching a recap video. "
        "Style: comic-book / pulp action panels — bold black outlines, halftone Ben-Day dots, "
        "KAPOW-style burst captions, four-colour print palette (red/yellow/blue/black), "
        "speech-bubble stat callouts, dramatic motion lines, hand-drawn cartoon energy. "
        "Hero stats inside burst-shaped panels with motion lines. Each slide is a single "
        "comic-book panel capturing one giant moment. Classic Tinkle / Beano / Marvel pulp feel."
    ) + _NARRATIVE_BEATS,
    "indian-tv": (
        "Audience: club cricket fans watching a recap video. "
        "Style: Indian sports TV graphics (Star Sports / Hotstar IPL) — vibrant saturated "
        "colours (saffron, deep blue, gold), big chrome-effect numbers, glossy 3D-rendered "
        "stat boxes, dramatic radial light bursts, animated lower-thirds feel, Bollywood-style "
        "intensity. Hero stats with chrome shading and gradient sheen. Use the team crests "
        "prominently. Maximum drama, maximum colour, maximum Indian sports TV energy."
    ) + _NARRATIVE_BEATS,
}

# Default style preserves prior behaviour
STYLE_PROMPT = STYLE_PROMPTS["broadcast"]

UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def normalize_play_cricket_url(url: str) -> str:
    """Ensure play-cricket.com result URLs use the /print variant — the bare URL returns
    only the result summary, but /print returns the full scorecard (player names, bowling
    figures, fall of wickets) which is what NotebookLM needs to produce a useful deck."""
    if "play-cricket.com" not in url:
        return url
    if "/print" in url:
        return url
    return url.rstrip("/") + "/print"


def run(cmd: list[str], *, capture: bool = True, check: bool = True, quiet: bool = False) -> subprocess.CompletedProcess:
    if not quiet:
        print(f"  $ {' '.join(cmd)}", file=sys.stderr)
    return subprocess.run(cmd, capture_output=capture, text=True, check=check)


def fetch_url_assets(
    url: str,
    pdf_out: Path,
    png_out: Path,
    scorecard_png: Path | None = None,
    ballbyball_txt: Path | None = None,
    division_table_png: Path | None = None,
    hero_png: Path | None = None,
    home_logo: Path | None = None,
    away_logo: Path | None = None,
) -> None:
    """Use Playwright to capture a print PDF + full-page screenshot + (optionally)
    scorecard, ball-by-ball, and division-table screenshots from the live (non-print)
    page.

    The /print PDF + the full-page screenshot of /print are kept (NotebookLM source
    material). The scorecard + ball-by-ball captures use the live page because that
    page renders the captain/keeper role icons inline — those icons are lost in the
    /print PDF, causing role-misattribution downstream (e.g. wicket-keeper rendered
    as captain). Capturing both lets a downstream Vision fact-check resolve roles
    authoritatively. The division-table capture follows the 'Division ...' link on
    the live match page and screenshots the current standings — used as the final
    league-table slide that closes the recap.
    """
    from playwright.sync_api import sync_playwright

    pdf_out.parent.mkdir(parents=True, exist_ok=True)
    live_url = url.replace("/print", "") if url.endswith("/print") else url

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1600, "height": 1200})
        page = ctx.new_page()

        # 1. Print page: PDF + full-page screenshot (NotebookLM source material)
        print(f"[playwright] loading {url} (print)", file=sys.stderr)
        page.goto(url, wait_until="load", timeout=60_000)
        page.wait_for_timeout(3500)
        page.emulate_media(media="print")
        page.pdf(path=str(pdf_out), format="A4", print_background=True, margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"})
        page.emulate_media(media="screen")
        page.screenshot(path=str(png_out), full_page=True)
        print(f"[playwright] saved {pdf_out.name} ({pdf_out.stat().st_size:,} bytes), {png_out.name} ({png_out.stat().st_size:,} bytes)", file=sys.stderr)

        # 2. Live page: hero shot, team logos, scorecard, ball-by-ball, division-table
        wants_live = any(p is not None for p in [
            scorecard_png, ballbyball_txt, division_table_png,
            hero_png, home_logo, away_logo,
        ])
        if wants_live:
            print(f"[playwright] loading {live_url} (live, for hero + logos + icon-preserving + division screenshots)", file=sys.stderr)
            page.goto(live_url, wait_until="load", timeout=60_000)
            page.wait_for_timeout(3500)

            # Hero shot: scroll to top, capture viewport only (1600x1200) — this is
            # the match-result splash with both team logos + "WON BY X WICKETS" banner.
            # The team logos here are what NotebookLM should use on stat slides, so
            # we explicitly upload this image + the two extracted logos as separate
            # NLM sources downstream.
            if hero_png is not None:
                try:
                    page.evaluate("window.scrollTo(0, 0)")
                    page.wait_for_timeout(500)
                    page.screenshot(path=str(hero_png), full_page=False)
                    print(f"[playwright] saved {hero_png.name} ({hero_png.stat().st_size:,} bytes) — viewport hero shot", file=sys.stderr)
                except Exception as e:
                    print(f"[playwright] WARNING: hero shot failed: {e!r}", file=sys.stderr)

            # Team logos: parse the badge_image URLs from the result-hero card and
            # download them as separate PNGs. The home team is .team-cov (left), the
            # away team is .team-att (right) — both are <p class="team-ttl ..."><img src="...">.
            if home_logo is not None or away_logo is not None:
                def _extract_badge(side_class: str) -> str | None:
                    try:
                        sel = f'p.team-ttl.{side_class} img'
                        src = page.locator(sel).first.get_attribute('src', timeout=4000)
                        return src
                    except Exception:
                        return None

                logos = []
                if home_logo is not None:
                    src = _extract_badge('team-cov')
                    if src:
                        logos.append((src, home_logo, 'home'))
                    else:
                        print(f"[playwright] WARNING: could not locate home-team badge (.team-cov)", file=sys.stderr)
                if away_logo is not None:
                    src = _extract_badge('team-att')
                    if src:
                        logos.append((src, away_logo, 'away'))
                    else:
                        print(f"[playwright] WARNING: could not locate away-team badge (.team-att)", file=sys.stderr)

                for src, out_path, label in logos:
                    try:
                        resp = ctx.request.get(src, timeout=15_000)
                        if resp.ok:
                            out_path.write_bytes(resp.body())
                            print(f"[playwright] saved {out_path.name} ({out_path.stat().st_size:,} bytes) — {label} team logo", file=sys.stderr)
                        else:
                            print(f"[playwright] WARNING: {label} logo fetch returned HTTP {resp.status}", file=sys.stderr)
                    except Exception as e:
                        print(f"[playwright] WARNING: {label} logo download failed: {e!r}", file=sys.stderr)

            if scorecard_png is not None:
                # The scorecard tab is the default landing tab; full-page screenshot
                # captures both team batting + bowling tables with role icons intact.
                page.screenshot(path=str(scorecard_png), full_page=True)
                print(f"[playwright] saved {scorecard_png.name} ({scorecard_png.stat().st_size:,} bytes)", file=sys.stderr)
            if ballbyball_txt is not None:
                # The BBB panel is in the DOM but its content is lazy-loaded by an
                # embedded ECB widget on tab activation. A native DOM .click() on
                # the tab element triggers the widget's loader — Playwright's own
                # .click() can be intercepted by the page's cookie banner, but a
                # JS-dispatched .click() fires from inside the element and bypasses
                # pointer-event intercepts entirely.
                # Text is preferred over a screenshot here so NLM gets the wicket
                # order / partnerships / final-over deliveries verbatim, no OCR.
                # Not every match exposes the BBB tab: some club themes omit it,
                # and matches without ball-by-ball data captured render nothing.
                # Soft-fail so the deck pipeline continues with the remaining sources.
                clicked = page.evaluate(
                    "() => { const t = document.querySelector('#iasBallbyballtab-tab');"
                    " if (!t) return false; t.click(); return true; }"
                )
                if not clicked:
                    print("[playwright] WARNING: #iasBallbyballtab-tab not found on this page; skipping ball_by_ball.txt", file=sys.stderr)
                else:
                    try:
                        page.wait_for_function(
                            "document.querySelector('#iasBallbyballtab')?.innerText.trim().length > 200",
                            timeout=10000,
                        )
                        bbb_text = page.locator('#iasBallbyballtab').first.inner_text(timeout=5000)
                        bbb_text = re.sub(r'\n{3,}', '\n\n', bbb_text.strip()) + '\n'
                        ballbyball_txt.write_text(bbb_text, encoding='utf-8')
                        print(f"[playwright] saved {ballbyball_txt.name} ({ballbyball_txt.stat().st_size:,} bytes) — ball-by-ball text from DOM", file=sys.stderr)
                    except Exception as e:
                        print(f"[playwright] WARNING: BBB panel did not populate ({e!r}); skipping ball_by_ball.txt", file=sys.stderr)

            if division_table_png is not None:
                # The Division URL is injected by jQuery AFTER initial page load via
                # $('#league_url_link').html("... <a href='/website/division/{id}'> ...").
                # Querying for `a[href*="/division/"]` at load time returns nothing — the
                # anchor doesn't exist in the DOM yet. Strategy: re-load the live page,
                # then either (a) wait for the populated #league_url_link <a>, OR
                # (b) regex-extract the division URL from the raw page source as a fallback
                # and navigate directly. (b) is more robust against further script changes.
                print(f"[playwright] navigating back to {live_url} to capture division table", file=sys.stderr)
                page.goto(live_url, wait_until="load", timeout=60_000)
                page.wait_for_timeout(3500)

                division_url = None
                # Strategy A: wait for the jQuery-injected anchor inside #league_url_link
                try:
                    page.wait_for_selector('#league_url_link a[href*="/division/"]', timeout=8000)
                    division_url = page.locator('#league_url_link a[href*="/division/"]').first.get_attribute('href')
                except Exception:
                    pass
                # Strategy B: regex-extract from raw page content (jQuery init string)
                if not division_url:
                    try:
                        html = page.content()
                        m = re.search(r'href=\\?"(https://[^"\\]+/website/division/\d+)\\?"', html)
                        if m:
                            division_url = m.group(1)
                    except Exception:
                        pass

                if division_url:
                    print(f"[playwright] resolved division URL → {division_url}", file=sys.stderr)
                    page.goto(division_url, wait_until="load", timeout=60_000)
                    page.wait_for_timeout(3000)
                    page.screenshot(path=str(division_table_png), full_page=True)
                    print(f"[playwright] saved {division_table_png.name} ({division_table_png.stat().st_size:,} bytes)", file=sys.stderr)
                else:
                    print(f"[playwright] WARNING: could not resolve Division URL (jQuery-injected anchor missing AND regex match failed); skipping {division_table_png.name}", file=sys.stderr)

        browser.close()


def nlm_create_notebook(title: str) -> str:
    """Create a notebook and return its ID. Falls back to list-by-title if stdout doesn't carry the id."""
    res = run([NLM, "notebook", "create", title])
    out = (res.stdout or "") + (res.stderr or "")
    m = UUID_RE.search(out)
    if m:
        return m.group(0)
    # Fallback: list notebooks, find newest one with matching title
    res = run([NLM, "list", "notebooks", "--json"])
    data = json.loads(res.stdout)
    matches = [nb for nb in data if nb.get("title") == title]
    if not matches:
        raise RuntimeError(f"Could not locate freshly-created notebook '{title}'. Output:\n{out}")
    matches.sort(key=lambda nb: nb.get("updated_at", ""), reverse=True)
    return matches[0]["id"]


def nlm_add_source(nb_id: str, *, file: Path | None = None, url: str | None = None, title: str | None = None) -> None:
    cmd = [NLM, "source", "add", nb_id, "--wait", "--wait-timeout", "300"]
    if file:
        cmd += ["--file", str(file)]
    if url:
        cmd += ["--url", url]
    if title:
        cmd += ["--title", title]
    run(cmd)


def nlm_create_slide_deck(nb_id: str, focus: str) -> None:
    run([
        NLM, "slides", "create", nb_id,
        "--format", "presenter_slides",
        "--length", "default",
        "--focus", focus,
        "--confirm",
    ])


def find_slide_deck_artifact(nb_id: str) -> dict | None:
    res = run([NLM, "list", "artifacts", nb_id, "--json"], quiet=True)
    try:
        data = json.loads(res.stdout)
    except json.JSONDecodeError:
        return None
    # Artifact schema is not strictly documented; match defensively on type/format hints.
    # Skip artifacts already in a terminal-failed state — a fresh slide-deck retrigger on
    # the same notebook creates a NEW artifact, and we want to wait on that one, not on
    # the stale failed record. This lets `--reuse-notebook-id` retries work cleanly when
    # the previous attempt failed (e.g., NLM transient errors).
    deck_artifacts = []
    for art in data:
        kind = (art.get("type") or art.get("artifact_type") or art.get("kind") or "").lower()
        if "slide" in kind or "deck" in kind:
            status = (art.get("status") or art.get("state") or "").lower()
            if status in {"failed", "error"}:
                continue
            deck_artifacts.append(art)
    if deck_artifacts:
        # Prefer the most recent — newest createdAt / updatedAt last
        deck_artifacts.sort(key=lambda a: a.get("created_at") or a.get("updated_at") or "", reverse=True)
        return deck_artifacts[0]
    return None


def wait_for_slide_deck(nb_id: str, timeout: int = 600, poll: int = 15) -> None:
    """Poll until a slide-deck artifact exists. Status field is best-effort."""
    deadline = time.time() + timeout
    last_status = None
    while time.time() < deadline:
        art = find_slide_deck_artifact(nb_id)
        if art:
            status = (art.get("status") or art.get("state") or "ready").lower()
            if status != last_status:
                print(f"[nlm] slide deck artifact: status={status}", file=sys.stderr)
                last_status = status
            if status in {"ready", "completed", "done", "succeeded"}:
                return
            if status in {"failed", "error"}:
                raise RuntimeError(f"NotebookLM slide-deck generation failed: {art}")
        time.sleep(poll)
    raise TimeoutError(f"Slide deck did not become ready within {timeout}s")


def nlm_download_slide_deck(nb_id: str, dest: Path, *, retries: int = 4, delay: int = 10) -> None:
    """Download with retry. Race: nlm reports artifact status=completed before the download endpoint is fully ready, so the first attempt can return non-zero."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            run([NLM, "download", "slide-deck", nb_id, "--format", "pdf", "--no-progress", "-o", str(dest)])
            if dest.exists() and dest.stat().st_size > 0:
                return
            last_err = RuntimeError(f"Downloaded deck is empty: {dest}")
        except subprocess.CalledProcessError as e:
            last_err = e
            print(f"[nlm] download attempt {attempt}/{retries} failed (exit {e.returncode}); retrying in {delay}s…", file=sys.stderr)
        if attempt < retries:
            time.sleep(delay)
    raise RuntimeError(f"Slide deck download failed after {retries} attempts") from last_err


def extract_slides(deck_pdf: Path, project_dir: Path) -> None:
    slides_dir = project_dir / "slides"
    slides_json = project_dir / "analysis" / "slides.json"
    slides_dir.mkdir(parents=True, exist_ok=True)
    slides_json.parent.mkdir(parents=True, exist_ok=True)
    extractor = Path(__file__).with_name("extract_pdf_slides.py")
    run([
        sys.executable, str(extractor),
        "--pdf", str(deck_pdf),
        "--output-dir", str(slides_dir),
        "--output-json", str(slides_json),
        "--dpi", "200",
    ])


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a NotebookLM slide deck from a play-cricket match URL")
    ap.add_argument("--list-styles", action="store_true", help="List available slide-deck visual styles and exit")
    ap.add_argument("--url", help="play-cricket match URL (preferably the /print variant — auto-appended if missing)")
    ap.add_argument("--slug", help="Project slug, e.g. 2026-05-09_wicc-vs-rothwell-town")
    ap.add_argument("--projects-dir", default="projects", help="Root projects directory (default: ./projects)")
    ap.add_argument("--style", default="broadcast", choices=sorted(STYLE_PROMPTS.keys()), help="Slide-deck visual style (default: broadcast). Use --list-styles to see all options.")
    ap.add_argument("--focus-extra", default="", help="Match-specific style note appended to the chosen style's focus prompt")
    ap.add_argument("--notebook-title", default=None, help="NotebookLM notebook title (default: 'Bunty: <slug>')")
    ap.add_argument("--keep-pdf", action="store_true", help="Skip Playwright capture and re-use existing match.pdf if present")
    ap.add_argument("--reuse-notebook-id", default=None, help="Skip notebook creation + source upload; use this notebook ID directly")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan and exit without doing anything")
    args = ap.parse_args()

    if args.list_styles:
        print("Available slide-deck visual styles for --style:\n")
        for name, prompt in STYLE_PROMPTS.items():
            # First sentence of each style's prompt is the aesthetic summary
            summary = prompt.split(".")[1].strip() if "." in prompt else prompt[:120]
            marker = " (default)" if name == "broadcast" else ""
            print(f"  {name}{marker}\n    {summary}.\n")
        return 0

    if not args.url or not args.slug:
        ap.error("--url and --slug are required (unless using --list-styles)")

    project_dir = Path(args.projects_dir) / args.slug
    ref_dir = project_dir / "reference"
    pdf_path = ref_dir / "match.pdf"
    png_path = ref_dir / "match_branding.png"
    scorecard_png = ref_dir / "scorecard_screenshot.png"
    ballbyball_txt = ref_dir / "ball_by_ball.txt"
    division_table_png = ref_dir / "division_table_screenshot.png"
    hero_png = ref_dir / "match_hero.png"
    home_logo = ref_dir / "home_logo.png"
    away_logo = ref_dir / "away_logo.png"
    deck_path = project_dir / "slides" / "deck.pdf"
    nb_id_path = ref_dir / "notebook_id.txt"

    # Auto-append /print to play-cricket URLs (bare URL only has the result summary).
    original_url = args.url
    args.url = normalize_play_cricket_url(args.url)
    if args.url != original_url:
        print(f"[url] normalized to /print variant: {args.url}", file=sys.stderr)

    notebook_title = args.notebook_title or f"Bunty: {args.slug}"
    focus = STYLE_PROMPTS[args.style]
    if args.focus_extra:
        focus = focus + "\n\nMatch-specific guidance: " + args.focus_extra.strip()

    print(f"[plan] slug         = {args.slug}", file=sys.stderr)
    print(f"[plan] url          = {args.url}", file=sys.stderr)
    print(f"[plan] project_dir  = {project_dir}", file=sys.stderr)
    print(f"[plan] notebook     = {notebook_title}", file=sys.stderr)
    print(f"[plan] focus prompt = {len(focus)} chars", file=sys.stderr)
    if args.dry_run:
        print("[dry-run] exiting before any side effects.", file=sys.stderr)
        return 0

    # Step 1: capture URL → PDF + PNG + scorecard/ball-by-ball/division-table screenshots
    #          + hero shot (logos + result banner) + two team badge logos
    if args.keep_pdf and pdf_path.exists() and scorecard_png.exists():
        print(f"[step 1] reusing existing {pdf_path} + {scorecard_png.name}", file=sys.stderr)
    else:
        fetch_url_assets(
            args.url, pdf_path, png_path,
            scorecard_png=scorecard_png,
            ballbyball_txt=ballbyball_txt,
            division_table_png=division_table_png,
            hero_png=hero_png,
            home_logo=home_logo,
            away_logo=away_logo,
        )

    # Step 2: NotebookLM ingestion
    if args.reuse_notebook_id:
        nb_id = args.reuse_notebook_id
        print(f"[step 2] reusing notebook {nb_id}", file=sys.stderr)
    else:
        nb_id = nlm_create_notebook(notebook_title)
        nb_id_path.write_text(nb_id + "\n")
        print(f"[step 2] created notebook {nb_id}", file=sys.stderr)
        nlm_add_source(nb_id, file=pdf_path, title="Match scorecard (PDF)")
        if png_path.exists():
            nlm_add_source(nb_id, file=png_path, title="Match page (branding)")
        # Scorecard + ball-by-ball screenshots from the LIVE page (icons preserved
        # — captain/keeper roles correctly inferable, unlike the /print PDF which
        # strips inline glyphs and causes role misattribution).
        if scorecard_png.exists():
            nlm_add_source(nb_id, file=scorecard_png, title="Scorecard screenshot (role icons preserved — authoritative for captain/keeper)")
        if ballbyball_txt.exists():
            nlm_add_source(nb_id, file=ballbyball_txt, title="Ball-by-ball commentary (text extract — authoritative for wicket order, partnerships, final-over drama)")
        if division_table_png.exists():
            nlm_add_source(nb_id, file=division_table_png, title="Division table screenshot (authoritative for league standings — final-beat slide)")
        # Hero shot + team logos: hero is the match splash with both team crests +
        # result banner ("WON BY 7 WICKETS"); logos are the two badge_image PNGs
        # extracted from the result-hero card. Upload all three so NotebookLM can
        # use authentic club crests on title/team-sheet/scorecard slides.
        if hero_png.exists():
            nlm_add_source(nb_id, file=hero_png, title="Match hero shot (team logos + result banner — title-card source)")
        if home_logo.exists():
            nlm_add_source(nb_id, file=home_logo, title="Home team logo (use on home-side slides)")
        if away_logo.exists():
            nlm_add_source(nb_id, file=away_logo, title="Away team logo (use on away-side slides)")
        nlm_add_source(nb_id, url=args.url, title="play-cricket live page")

    # Step 3 + 4: trigger + wait for slide-deck artifact
    print("[step 3] triggering slide-deck generation…", file=sys.stderr)
    nlm_create_slide_deck(nb_id, focus)
    wait_for_slide_deck(nb_id)

    # Step 5: download deck + extract slides
    nlm_download_slide_deck(nb_id, deck_path)
    extract_slides(deck_path, project_dir)

    # Step 6: dump match scorecard as plain text for the narration drafting step
    # (the Bunty voice guide pass needs to cross-check claims against actual scorecard data)
    facts_path = project_dir / "reference" / "match_facts.txt"
    try:
        subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), str(facts_path)],
            check=True, capture_output=True, text=True,
        )
        print(f"[step 6] extracted scorecard text → {facts_path} ({facts_path.stat().st_size:,} bytes)", file=sys.stderr)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"[step 6] pdftotext failed ({e!r}); skipping match_facts.txt — narration will need manual fact check", file=sys.stderr)

    n_slides = len(list((project_dir / "slides").glob("slide_*.jpg")))

    # Sidecar: write deck_meta.json so downstream helpers (bunty_animate_slides.py)
    # can auto-detect the deck style + slide count without the operator having
    # to repeat --style on every command in the pipeline.
    meta_path = project_dir / "analysis" / "deck_meta.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps({
        "style": args.style,
        "num_slides": n_slides,
        "notebook_id": nb_id,
        "url": args.url,
    }, indent=2) + "\n")
    print(f"  Sidecar: {meta_path}", file=sys.stderr)

    print(f"\nDone. Notebook: {nb_id}\n  Deck: {deck_path}\n  Slides: {n_slides} extracted to {project_dir / 'slides'}\n  Facts: {facts_path}\n  Next: review slides, draft Bunty narration (two-pass: facts → Bunty-fy per bunty-voice-guide.md), then run the existing lip-sync pipeline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
