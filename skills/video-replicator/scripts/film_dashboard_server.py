#!/usr/bin/env python3
"""
Film Dashboard HTTP Server — serves pipeline state, screenplays, characters, breakdowns.

Runs on port 8766 (separate from review_server at 8765). Provides read-only
endpoints for the Film Dashboard Vue components, plus POST endpoints for
advancing pipeline phases and saving character IDs.

Usage:
    python film_dashboard_server.py
    python film_dashboard_server.py --port 8766 --projects ../projects

Endpoints:
    GET  /pipeline?project=<slug>     → FilmState JSON
    GET  /screenplay?project=<slug>   → Screenplay JSON
    GET  /characters?project=<slug>   → Characters list
    GET  /breakdowns?project=<slug>   → Scene breakdowns with prompts
    GET  /projects                    → All projects with film data
    GET  /health                      → Health check

    POST /save-character-ids          → Save Go Bananas character IDs
    POST /advance-phase               → Trigger next phase
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Ensure scripts/ is on the Python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import FILM_PHASES, FILM_SUPPORTED_BACKENDS, PROJECT_BASE

logger = logging.getLogger("film_dashboard_server")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s | %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


# ============================================================================
# Default Configuration
# ============================================================================

DEFAULT_PORT = 8766
SCRIPT_DIR = Path(__file__).resolve().parent
# Go up to video-replicator-veo-cli
REPLICATOR_ROOT = SCRIPT_DIR.parent.parent.parent.parent
DEFAULT_PROJECT_BASE = REPLICATOR_ROOT / "projects"


# ============================================================================
# Helper — read JSON files safely
# ============================================================================


def _read_json(path: Path) -> dict | list | None:
    """Read a JSON file, returning None on error."""
    try:
        if path.exists():
            with open(path) as f:
                return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read %s: %s", path, exc)
    return None


def _get_project_dir(project_slug: str, project_base: Path) -> Path | None:
    """Find project directory — supports date-prefixed and plain slugs."""
    # Try exact match first
    exact = project_base / project_slug
    if exact.is_dir():
        return exact

    # Try date-prefixed directories (e.g., 2026-01-23_001_slug)
    for d in sorted(project_base.iterdir(), reverse=True):
        if d.is_dir() and d.name.endswith(f"_{project_slug}"):
            return d

    return None


def _list_film_projects(project_base: Path) -> list[dict]:
    """List all projects that have film_state.json."""
    projects = []
    if not project_base.is_dir():
        return projects

    for d in sorted(project_base.iterdir()):
        if not d.is_dir():
            continue
        state_path = d / "film_state.json"
        if state_path.exists():
            state = _read_json(state_path)
            if state:
                projects.append({
                    "slug": state.get("project_slug", d.name),
                    "dir_name": d.name,
                    "concept": state.get("concept", ""),
                    "genre": state.get("genre", ""),
                    "backend": state.get("backend", ""),
                    "current_phase": state.get("current_phase", "unknown"),
                    "target_duration": state.get("target_duration", 0),
                    "scene_count": state.get("scene_count", 0),
                })
    return projects


# ============================================================================
# Film Dashboard HTTP Handler
# ============================================================================


class FilmDashboardHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the Film Dashboard."""

    # Set by server setup
    project_base: Path = DEFAULT_PROJECT_BASE

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------

    def _set_headers(self, status: int = 200, content_type: str = "application/json"):
        """Set response headers with CORS support."""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send_json(self, data, status: int = 200):
        """Send JSON response."""
        self._set_headers(status)
        self.wfile.write(json.dumps(data, default=str).encode())

    def _send_error(self, message: str, status: int = 400):
        """Send error response."""
        self._send_json({"error": message}, status)

    def _get_query_param(self, param: str) -> str | None:
        """Extract query parameter from URL."""
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        values = params.get(param, [])
        return values[0] if values else None

    def _read_body(self) -> dict:
        """Read JSON body from POST request."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {}

    def _resolve_project(self) -> tuple[str | None, Path | None]:
        """Get project slug from query param and resolve directory."""
        slug = self._get_query_param("project")
        if not slug:
            self._send_error("Missing ?project= parameter")
            return None, None
        project_dir = _get_project_dir(slug, self.project_base)
        if not project_dir:
            self._send_error(f"Project '{slug}' not found", 404)
            return None, None
        return slug, project_dir

    # ------------------------------------------------------------------
    # OPTIONS (CORS preflight)
    # ------------------------------------------------------------------

    def do_OPTIONS(self):
        self._set_headers(204)

    # ------------------------------------------------------------------
    # GET routes
    # ------------------------------------------------------------------

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        routes = {
            "/health": self._handle_health,
            "/projects": self._handle_projects,
            "/pipeline": self._handle_pipeline,
            "/screenplay": self._handle_screenplay,
            "/characters": self._handle_characters,
            "/breakdowns": self._handle_breakdowns,
        }

        handler = routes.get(path)
        if handler:
            handler()
        else:
            self._send_error(f"Unknown endpoint: {path}", 404)

    def _handle_health(self):
        """GET /health — health check."""
        self._send_json({
            "status": "ok",
            "server": "film-dashboard",
            "port": self.server.server_address[1],
            "phases": FILM_PHASES,
            "backends": FILM_SUPPORTED_BACKENDS,
        })

    def _handle_projects(self):
        """GET /projects — list all projects with film data."""
        projects = _list_film_projects(self.project_base)
        self._send_json({"projects": projects, "count": len(projects)})

    def _handle_pipeline(self):
        """GET /pipeline?project=<slug> — FilmState JSON."""
        slug, project_dir = self._resolve_project()
        if not slug:
            return

        state = _read_json(project_dir / "film_state.json")
        if not state:
            self._send_json({
                "project_slug": slug,
                "current_phase": "none",
                "phases": FILM_PHASES,
                "message": "No film pipeline started for this project",
            })
            return

        # Enrich with phase index for progress bar
        current = state.get("current_phase", "concept")
        phase_idx = FILM_PHASES.index(current) if current in FILM_PHASES else -1
        state["phase_index"] = phase_idx
        state["total_phases"] = len(FILM_PHASES)
        state["phases"] = FILM_PHASES
        state["progress_pct"] = round(phase_idx / max(len(FILM_PHASES) - 1, 1) * 100)

        self._send_json(state)

    def _handle_screenplay(self):
        """GET /screenplay?project=<slug> — Screenplay JSON."""
        slug, project_dir = self._resolve_project()
        if not slug:
            return

        # Try analysis/screenplay.json first
        screenplay = _read_json(project_dir / "analysis" / "screenplay.json")
        if not screenplay:
            self._send_error("No screenplay found for this project", 404)
            return

        self._send_json(screenplay)

    def _handle_characters(self):
        """GET /characters?project=<slug> — Characters list."""
        slug, project_dir = self._resolve_project()
        if not slug:
            return

        # Try characters.json in storyboard/ or project root
        characters = None
        for path in [
            project_dir / "storyboard" / "characters.json",
            project_dir / "characters.json",
            project_dir / "analysis" / "characters.json",
        ]:
            characters = _read_json(path)
            if characters:
                break

        if not characters:
            self._send_json({"characters": [], "message": "No characters defined yet"})
            return

        self._send_json(characters)

    def _handle_breakdowns(self):
        """GET /breakdowns?project=<slug> — Scene breakdowns with prompts."""
        slug, project_dir = self._resolve_project()
        if not slug:
            return

        # Try f2v_scenes.json in analysis/
        breakdowns = _read_json(project_dir / "analysis" / "f2v_scenes.json")
        if not breakdowns:
            self._send_error("No scene breakdowns found", 404)
            return

        # Normalize format — convert dict to list for easier frontend consumption
        scenes = []
        if isinstance(breakdowns, dict):
            for scene_num, data in sorted(breakdowns.items(), key=lambda x: int(x[0])):
                if isinstance(data, str):
                    scenes.append({
                        "scene_number": int(scene_num),
                        "prompt": data,
                    })
                elif isinstance(data, dict):
                    scenes.append({
                        "scene_number": int(scene_num),
                        **data,
                    })
        elif isinstance(breakdowns, list):
            scenes = breakdowns

        self._send_json({"scenes": scenes, "count": len(scenes)})

    # ------------------------------------------------------------------
    # POST routes
    # ------------------------------------------------------------------

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        routes = {
            "/save-character-ids": self._handle_save_character_ids,
            "/advance-phase": self._handle_advance_phase,
        }

        handler = routes.get(path)
        if handler:
            handler()
        else:
            self._send_error(f"Unknown endpoint: {path}", 404)

    def _handle_save_character_ids(self):
        """POST /save-character-ids — Save Go Bananas character IDs.

        Body: {"project": "slug", "character_ids": {"Ram": 95, "Krishna": 96}}
        """
        body = self._read_body()
        slug = body.get("project")
        character_ids = body.get("character_ids")

        if not slug or not character_ids:
            self._send_error("Required: project, character_ids")
            return

        project_dir = _get_project_dir(slug, self.project_base)
        if not project_dir:
            self._send_error(f"Project '{slug}' not found", 404)
            return

        # Read existing characters.json
        chars_path = None
        for path in [
            project_dir / "storyboard" / "characters.json",
            project_dir / "characters.json",
            project_dir / "analysis" / "characters.json",
        ]:
            if path.exists():
                chars_path = path
                break

        if not chars_path:
            # Create new characters.json in analysis/
            chars_path = project_dir / "analysis" / "characters.json"
            os.makedirs(chars_path.parent, exist_ok=True)
            chars_data = {"characters": [], "style": ""}
        else:
            chars_data = _read_json(chars_path) or {"characters": [], "style": ""}

        # Update character IDs
        existing_chars = chars_data.get("characters", [])
        for name, char_id in character_ids.items():
            found = False
            for c in existing_chars:
                if c.get("name", "").lower() == name.lower():
                    c["character_id"] = char_id
                    found = True
                    break
            if not found:
                existing_chars.append({
                    "name": name,
                    "character_id": char_id,
                })

        chars_data["characters"] = existing_chars

        with open(chars_path, "w") as f:
            json.dump(chars_data, f, indent=2)

        # Also save to DB if available
        try:
            from db_unified import get_or_create_project, update_film_character, get_film_character_by_name
            project = get_or_create_project(slug)
            for name, char_id in character_ids.items():
                char = get_film_character_by_name(project["id"], name)
                if char:
                    update_film_character(char["id"], go_bananas_character_id=char_id)
        except Exception as exc:
            logger.warning("DB update failed (non-critical): %s", exc)

        self._send_json({"status": "ok", "saved": len(character_ids)})

    def _handle_advance_phase(self):
        """POST /advance-phase — Advance pipeline to next phase.

        Body: {"project": "slug", "target_phase": "breakdown"}
        """
        body = self._read_body()
        slug = body.get("project")
        target_phase = body.get("target_phase")

        if not slug:
            self._send_error("Required: project")
            return

        project_dir = _get_project_dir(slug, self.project_base)
        if not project_dir:
            self._send_error(f"Project '{slug}' not found", 404)
            return

        state_path = project_dir / "film_state.json"
        state = _read_json(state_path)
        if not state:
            self._send_error("No film pipeline state found", 404)
            return

        current = state.get("current_phase", "concept")
        if target_phase and target_phase not in FILM_PHASES:
            self._send_error(f"Invalid phase: {target_phase}. Valid: {FILM_PHASES}")
            return

        if target_phase:
            # Validate phase ordering
            current_idx = FILM_PHASES.index(current) if current in FILM_PHASES else 0
            target_idx = FILM_PHASES.index(target_phase)
            if target_idx < current_idx:
                self._send_error(
                    f"Cannot go backward: {current} → {target_phase}"
                )
                return
            state["current_phase"] = target_phase
        else:
            # Advance to next phase
            if current in FILM_PHASES:
                idx = FILM_PHASES.index(current)
                if idx < len(FILM_PHASES) - 1:
                    state["current_phase"] = FILM_PHASES[idx + 1]
                else:
                    state["current_phase"] = "complete"

        with open(state_path, "w") as f:
            json.dump(state, f, indent=2)

        self._send_json({
            "status": "ok",
            "previous_phase": current,
            "current_phase": state["current_phase"],
        })

    # ------------------------------------------------------------------
    # Suppress default logging (use our logger instead)
    # ------------------------------------------------------------------

    def log_message(self, format, *args):
        logger.debug("%s - %s", self.address_string(), format % args)


# ============================================================================
# Server Setup
# ============================================================================


def start_server(port: int = DEFAULT_PORT, project_base: str | None = None):
    """Start the Film Dashboard HTTP server."""
    base_path = Path(project_base) if project_base else DEFAULT_PROJECT_BASE
    FilmDashboardHandler.project_base = base_path

    server = HTTPServer(("", port), FilmDashboardHandler)
    logger.info("Film Dashboard server started on http://localhost:%d", port)
    logger.info("Projects directory: %s", base_path)
    logger.info("Endpoints:")
    logger.info("  GET  /health              — Health check")
    logger.info("  GET  /projects            — List film projects")
    logger.info("  GET  /pipeline?project=   — Pipeline state")
    logger.info("  GET  /screenplay?project= — Screenplay JSON")
    logger.info("  GET  /characters?project= — Characters list")
    logger.info("  GET  /breakdowns?project= — Scene breakdowns")
    logger.info("  POST /save-character-ids  — Save Go Bananas IDs")
    logger.info("  POST /advance-phase       — Advance pipeline phase")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped.")
        server.server_close()


# ============================================================================
# CLI
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Film Dashboard HTTP Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--projects", type=str, default=None,
        help=f"Projects directory (default: {DEFAULT_PROJECT_BASE})",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logger.setLevel(logging.DEBUG)

    start_server(port=args.port, project_base=args.projects)


if __name__ == "__main__":
    main()
