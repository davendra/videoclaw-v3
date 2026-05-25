#!/usr/bin/env python3
"""
Minimal HTTP server to handle review approvals.

Run alongside VitePress dev server to handle approval/rejection
requests from the web dashboard.

Usage:
    python review_server.py
    python review_server.py --port 8765 --projects ../projects

Endpoints:
    GET  /state?project=<name>      - Get review state for project
    POST /approve                   - Approve checkpoint
    POST /reject                    - Reject checkpoint
    POST /autofix                   - Auto-fix aspect ratios
    POST /regenerate-images         - Regenerate images for scenes
    POST /set-go-bananas-context    - Set Go Bananas character/product context
    POST /generate-videos           - Trigger video generation
    GET  /projects                  - List all projects
    GET  /health                    - Health check

Agent Endpoints:
    POST /agent/qa-report           - Submit QA analysis report
    POST /agent/regeneration-complete - Notify regeneration done
    POST /agent/video-comparison    - Submit video comparison results
    GET  /agent/pending-tasks       - Get agent work queue
    POST /agent/enable              - Enable agent-assisted mode
    GET  /agent/status              - Get agent status
"""

import argparse
import json
import os
import subprocess
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Track running processes
running_processes = {}

# Default configuration
DEFAULT_PORT = 8765
DEFAULT_PROJECT_BASE = None  # Will be set based on script location

# Get the project base directory relative to this script
SCRIPT_DIR = Path(__file__).parent.parent.parent.parent.parent  # Go up to video-replicator-veo-cli
PROJECT_BASE = SCRIPT_DIR / "projects"


class ReviewHandler(BaseHTTPRequestHandler):
    """HTTP request handler for review operations."""

    def _set_headers(self, status=200, content_type="application/json"):
        """Set response headers with CORS support."""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send_json(self, data, status=200):
        """Send JSON response."""
        self._set_headers(status)
        self.wfile.write(json.dumps(data).encode())

    def _send_error(self, message, status=400):
        """Send error response."""
        self._send_json({"error": message}, status)

    def _get_project_dir(self, project_name):
        """Get the full path to a project directory."""
        return PROJECT_BASE / project_name

    def _read_state(self, project_name):
        """Read review state for a project."""
        state_file = self._get_project_dir(project_name) / "review_state.json"
        if not state_file.exists():
            return None
        with open(state_file) as f:
            return json.load(f)

    def _write_state(self, project_name, state):
        """Write review state for a project."""
        state_file = self._get_project_dir(project_name) / "review_state.json"
        state["updated_at"] = datetime.now().isoformat()
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)
        return state

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self._set_headers()

    def do_GET(self):
        """Handle GET requests."""
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == "/state":
            # Get review state for a project
            project = params.get("project", [None])[0]
            if not project:
                self._send_error("Missing project parameter")
                return

            state = self._read_state(project)
            if state:
                self._send_json(state)
            else:
                self._send_error(f"Project not found: {project}", 404)

        elif path == "/projects":
            # List all projects
            projects = []
            if PROJECT_BASE.exists():
                for p in PROJECT_BASE.iterdir():
                    if p.is_dir():
                        state_file = p / "review_state.json"
                        project_info = {"name": p.name, "has_state": state_file.exists()}
                        if state_file.exists():
                            try:
                                with open(state_file) as f:
                                    state = json.load(f)
                                project_info["stage"] = state.get("stage")
                                project_info["status"] = state.get("status")
                            except Exception:
                                pass
                        projects.append(project_info)
            self._send_json({"projects": projects})

        elif path == "/health":
            # Health check
            self._send_json({"status": "ok", "project_base": str(PROJECT_BASE)})

        elif path.startswith("/images/"):
            # Serve image files: /images/<project>/<path>
            # e.g., /images/test-agent/images/scene_1_frame.jpg
            parts = path[8:].split("/", 1)  # Remove "/images/" prefix
            if len(parts) < 2:
                self._send_error("Invalid image path", 400)
                return

            project = parts[0]
            image_path = parts[1]
            full_path = PROJECT_BASE / project / image_path

            if not full_path.exists():
                self._send_error(f"Image not found: {image_path}", 404)
                return

            # Determine content type
            ext = full_path.suffix.lower()
            content_types = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".webp": "image/webp"
            }
            content_type = content_types.get(ext, "application/octet-stream")

            # Send the image
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "max-age=3600")
            self.end_headers()

            with open(full_path, "rb") as f:
                self.wfile.write(f.read())

        elif path == "/agent/status":
            # Get agent status for a project
            project = params.get("project", [None])[0]
            if not project:
                self._send_error("Missing project parameter")
                return

            state = self._read_state(project)
            if state:
                self._send_json({
                    "agent_assisted": state.get("agent_assisted", False),
                    "agent_status": state.get("agent_status", "idle"),
                    "agent_working": state.get("agent_working"),
                    "agent_updated_at": state.get("agent_updated_at"),
                    "qa_report": state.get("data", {}).get("qa_report"),
                    "video_comparison": state.get("data", {}).get("video_comparison")
                })
            else:
                self._send_error(f"Project not found: {project}", 404)

        elif path == "/agent/pending-tasks":
            # Get pending tasks for agents
            project = params.get("project", [None])[0]
            if not project:
                self._send_error("Missing project parameter")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            tasks = []
            stage = state.get("stage")
            agent_status = state.get("agent_status", "idle")

            # Only queue tasks if agent-assisted and pending
            if state.get("agent_assisted") and agent_status == "idle":
                if stage == "images":
                    # Queue image QA tasks
                    images = state.get("data", {}).get("images", [])
                    prompts = state.get("data", {}).get("prompts", {})
                    for img in images:
                        scene = img.get("scene_number") or img.get("scene")
                        tasks.append({
                            "type": "image-qa",
                            "scene": scene,
                            "image_path": img.get("path") or img.get("url"),
                            "prompt": prompts.get(str(scene), ""),
                            "target_ratio": state.get("data", {}).get("target_ratio", "portrait")
                        })
                elif stage == "videos":
                    # Queue video comparison tasks
                    videos = state.get("data", {}).get("videos", [])
                    prompts = state.get("data", {}).get("prompts", {})
                    for video in videos:
                        scene = video.get("scene_number") or video.get("scene")
                        tasks.append({
                            "type": "video-comparison",
                            "scene": scene,
                            "primary": video.get("primary"),
                            "alt": video.get("alt"),
                            "prompt": prompts.get(str(scene), "")
                        })

            self._send_json({
                "project": project,
                "stage": stage,
                "agent_status": agent_status,
                "tasks": tasks
            })

        else:
            self._send_error("Not found", 404)

    def do_POST(self):
        """Handle POST requests."""
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._send_error("Invalid JSON")
            return

        path = urlparse(self.path).path

        if path == "/approve":
            project = data.get("project")
            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Update state with approval
            state["status"] = "approved"
            state["regenerate_scenes"] = data.get("regenerate_scenes", [])
            state["auto_fix"] = data.get("auto_fix", False)
            state["approved_at"] = datetime.now().isoformat()

            # Update data if provided (edited prompts, etc.)
            if "data" in data:
                state["data"] = data["data"]

            self._write_state(project, state)
            self._send_json({"ok": True, "status": "approved"})

        elif path == "/reject":
            project = data.get("project")
            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            state["status"] = "rejected"
            state["rejection_reason"] = data.get("reason")
            state["rejected_at"] = datetime.now().isoformat()

            self._write_state(project, state)
            self._send_json({"ok": True, "status": "rejected"})

        elif path == "/autofix":
            project = data.get("project")
            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Trigger auto-fix and approve
            state["status"] = "approved"
            state["auto_fix"] = True
            state["approved_at"] = datetime.now().isoformat()

            self._write_state(project, state)
            self._send_json({"ok": True, "status": "approved", "auto_fix": True})

        elif path == "/generate-videos":
            project = data.get("project")
            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Check if already running
            if project in running_processes and running_processes[project].get("status") == "running":
                self._send_json({
                    "ok": False,
                    "error": "Video generation already running",
                    "status": "running"
                })
                return

            # Build command
            script_path = SCRIPT_DIR / ".claude" / "skills" / "video-replicator" / "scripts" / "parallel_video_gen.py"
            images_dir = PROJECT_BASE / project / "images"
            ratio = state.get("data", {}).get("target_ratio", "portrait")

            cmd = [
                "python3", str(script_path),
                "--product", project,
                "--mode", "frames-to-video",
                "--images-dir", str(images_dir),
                "--ratio", ratio,
                "--quality", "fast"
            ]

            # Update state
            state["status"] = "generating_videos"
            state["video_gen_started"] = datetime.now().isoformat()
            self._write_state(project, state)

            # Run in background thread
            def run_video_gen():
                try:
                    running_processes[project] = {"status": "running", "started": datetime.now().isoformat()}
                    result = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        cwd=str(SCRIPT_DIR),
                        timeout=3600  # 1 hour timeout
                    )
                    running_processes[project] = {
                        "status": "completed" if result.returncode == 0 else "failed",
                        "returncode": result.returncode,
                        "stdout": result.stdout[-2000:] if result.stdout else "",
                        "stderr": result.stderr[-1000:] if result.stderr else "",
                        "completed": datetime.now().isoformat()
                    }
                    # Update state
                    state = self._read_state(project)
                    if state:
                        state["status"] = "pending_review" if result.returncode == 0 else "video_gen_failed"
                        state["stage"] = "videos" if result.returncode == 0 else "images"
                        state["video_gen_completed"] = datetime.now().isoformat()
                        self._write_state(project, state)
                except Exception as e:
                    running_processes[project] = {"status": "error", "error": str(e)}

            thread = threading.Thread(target=run_video_gen, daemon=True)
            thread.start()

            self._send_json({
                "ok": True,
                "status": "started",
                "message": f"Video generation started for {project}",
                "command": " ".join(cmd)
            })

        elif path == "/regenerate-images":
            project = data.get("project")
            scenes = data.get("scenes", [])

            if not project:
                self._send_error("Missing project")
                return

            if not scenes:
                self._send_error("No scenes specified")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Get Go Bananas context from state
            go_bananas_context = state.get("data", {}).get("go_bananas_context", {})
            character_id = go_bananas_context.get("character_id")
            character_name = go_bananas_context.get("character_name")
            product_id = go_bananas_context.get("product_id")
            aspect_ratio = go_bananas_context.get("aspect_ratio") or state.get("data", {}).get("aspect_ratio", "9:16")

            # Check for API key
            api_key = os.environ.get("GO_BANANAS_API_KEY")

            # Build command
            script_path = SCRIPT_DIR / ".claude" / "skills" / "video-replicator" / "scripts" / "regenerate_images.py"
            scenes_str = ",".join(str(s) for s in scenes)

            cmd = [
                "python3", str(script_path),
                "--project", project,
                "--scenes", scenes_str,
            ]

            # Add character/product context if available
            if character_id:
                cmd.extend(["--character-id", str(character_id)])
            if product_id:
                cmd.extend(["--product-id", str(product_id)])

            # If no API key, output MCP commands
            if not api_key:
                cmd.append("--mcp-output")

            # Update state
            state["status"] = "regenerating"
            state["regenerate_scenes"] = scenes
            self._write_state(project, state)

            # Run and capture output
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    cwd=str(SCRIPT_DIR),
                    timeout=300
                )

                # If no API key, return MCP instructions for Claude
                if not api_key:
                    # Build MCP call instructions
                    mcp_calls = []
                    prompts = state.get("data", {}).get("prompts", {})
                    for scene in scenes:
                        prompt = prompts.get(str(scene), "")
                        params = {
                            "prompt": prompt,
                            "aspect_ratio": aspect_ratio,
                            "model_id": "gemini-pro-image",
                        }
                        if character_id:
                            params["character_id"] = character_id
                        elif product_id:
                            params["product_id"] = product_id
                        mcp_calls.append({
                            "tool": "mcp__go-bananas__generate_image",
                            "params": params,
                            "scene": scene
                        })

                    self._send_json({
                        "ok": True,
                        "mode": "mcp",
                        "mcp_calls": mcp_calls,
                        "context": {
                            "character_id": character_id,
                            "character_name": character_name,
                            "product_id": product_id,
                            "aspect_ratio": aspect_ratio,
                        },
                        "message": "No GO_BANANAS_API_KEY set. Use MCP commands below in Claude."
                    })
                else:
                    self._send_json({
                        "ok": result.returncode == 0,
                        "mode": "rest",
                        "status": "completed" if result.returncode == 0 else "failed",
                        "output": result.stdout,
                        "error": result.stderr if result.returncode != 0 else None
                    })
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)})

        elif path == "/set-go-bananas-context":
            project = data.get("project")
            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Update go_bananas_context in state
            if "data" not in state:
                state["data"] = {}

            state["data"]["go_bananas_context"] = {
                "character_id": data.get("character_id"),
                "character_name": data.get("character_name"),
                "product_id": data.get("product_id"),
                "product_name": data.get("product_name"),
                "aspect_ratio": data.get("aspect_ratio", "9:16"),
            }

            self._write_state(project, state)
            self._send_json({"ok": True, "message": "Go Bananas context saved"})

        elif path == "/process-status":
            project = data.get("project")
            if not project:
                self._send_error("Missing project")
                return

            status = running_processes.get(project, {"status": "not_found"})
            self._send_json(status)

        elif path == "/update-prompt":
            project = data.get("project")
            scene = data.get("scene")
            prompt = data.get("prompt")

            if not project:
                self._send_error("Missing project")
                return
            if scene is None:
                self._send_error("Missing scene number")
                return
            if prompt is None:
                self._send_error("Missing prompt")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Update the prompt in state
            if "data" not in state:
                state["data"] = {}
            if "prompts" not in state["data"]:
                state["data"]["prompts"] = {}

            state["data"]["prompts"][str(scene)] = prompt

            self._write_state(project, state)
            self._send_json({"ok": True, "scene": scene, "prompt_updated": True})

        # =====================================================================
        # Agent Endpoints
        # =====================================================================

        elif path == "/agent/enable":
            # Enable agent-assisted mode for a project
            project = data.get("project")
            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            state["agent_assisted"] = True
            state["agent_status"] = "idle"
            self._write_state(project, state)
            self._send_json({"ok": True, "agent_assisted": True})

        elif path == "/agent/qa-report":
            # Submit QA analysis report from image-qa agents
            project = data.get("project")
            qa_report = data.get("qa_report")

            if not project:
                self._send_error("Missing project")
                return
            if not qa_report:
                self._send_error("Missing qa_report")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Store QA report in state data
            if "data" not in state:
                state["data"] = {}
            state["data"]["qa_report"] = qa_report
            state["agent_status"] = "complete"
            state["agent_working"] = None
            state["agent_updated_at"] = datetime.now().isoformat()

            self._write_state(project, state)
            self._send_json({
                "ok": True,
                "message": "QA report saved",
                "overall_score": qa_report.get("overall_score"),
                "auto_approve_eligible": qa_report.get("auto_approve_eligible", False)
            })

        elif path == "/agent/video-comparison":
            # Submit video comparison results
            project = data.get("project")
            comparison = data.get("video_comparison")

            if not project:
                self._send_error("Missing project")
                return
            if not comparison:
                self._send_error("Missing video_comparison")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Store comparison in state data
            if "data" not in state:
                state["data"] = {}
            state["data"]["video_comparison"] = comparison
            state["agent_status"] = "complete"
            state["agent_working"] = None
            state["agent_updated_at"] = datetime.now().isoformat()

            self._write_state(project, state)
            self._send_json({
                "ok": True,
                "message": "Video comparison saved",
                "auto_selections": comparison.get("auto_selections", {})
            })

        elif path == "/agent/regeneration-complete":
            # Notify that regeneration is complete
            project = data.get("project")
            results = data.get("results", {})
            scenes = data.get("scenes", [])

            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            # Update state with regeneration results
            if "data" not in state:
                state["data"] = {}
            state["data"]["regeneration_results"] = results
            state["data"]["regeneration_timestamp"] = datetime.now().isoformat()
            state["status"] = "pending_review"  # Reset for re-review
            state["agent_status"] = "complete"
            state["agent_working"] = None
            state["regenerated_scenes"] = scenes

            self._write_state(project, state)
            self._send_json({
                "ok": True,
                "message": f"Regeneration complete for {len(scenes)} scenes",
                "regenerated_scenes": scenes
            })

        elif path == "/agent/update-status":
            # Update agent working status
            project = data.get("project")
            status = data.get("status", "idle")
            working_info = data.get("working_info")

            if not project:
                self._send_error("Missing project")
                return

            state = self._read_state(project)
            if not state:
                self._send_error(f"Project not found: {project}", 404)
                return

            state["agent_status"] = status
            state["agent_working"] = working_info
            state["agent_updated_at"] = datetime.now().isoformat()

            self._write_state(project, state)
            self._send_json({"ok": True, "agent_status": status})

        else:
            self._send_error("Not found", 404)

    def log_message(self, format, *args):
        """Custom logging format."""
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")


def run_server(port=DEFAULT_PORT, project_base=None):
    """Run the review server."""
    global PROJECT_BASE

    if project_base:
        PROJECT_BASE = Path(project_base)

    server = HTTPServer(("localhost", port), ReviewHandler)
    print(f"\n{'='*60}")
    print("Video Replicator - Review Server")
    print(f"{'='*60}")
    print(f"  Port:          http://localhost:{port}")
    print(f"  Project Base:  {PROJECT_BASE}")
    print(f"{'='*60}")
    print("\nEndpoints:")
    print("  GET  /state?project=<name>      - Get review state")
    print("  POST /approve                   - Approve checkpoint")
    print("  POST /reject                    - Reject checkpoint")
    print("  POST /autofix                   - Auto-fix and approve")
    print("  POST /regenerate-images         - Regenerate selected scenes")
    print("  POST /set-go-bananas-context    - Set character/product context")
    print("  POST /generate-videos           - Trigger video generation")
    print("  GET  /projects                  - List all projects")
    print("  GET  /health                    - Health check")
    print("\nPress Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Review approval server")
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT,
                       help=f"Port to listen on (default: {DEFAULT_PORT})")
    parser.add_argument("--projects", "-d", type=str, default=None,
                       help="Base directory for projects")

    args = parser.parse_args()
    run_server(port=args.port, project_base=args.projects)
