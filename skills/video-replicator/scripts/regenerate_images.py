#!/usr/bin/env python3
"""
Regenerate images for selected scenes using Go Bananas MCP.

This script reads the review_state.json to find which scenes need regeneration,
then calls Go Bananas MCP server to generate new images.

Usage:
    # Regenerate scenes from review_state.json
    python regenerate_images.py --project seemanti-test

    # Regenerate specific scenes
    python regenerate_images.py --project seemanti-test --scenes 1,3,5

    # With character reference
    python regenerate_images.py --project seemanti-test --character-id 42

    # Dry run (show what would be done)
    python regenerate_images.py --project seemanti-test --dry-run

    # Output MCP commands for Claude to execute
    python regenerate_images.py --project seemanti-test --mcp-output

Requirements:
    - GO_BANANAS_API_KEY environment variable (for MCP API)
    - Or use --mcp-output to get MCP tool calls for Claude

Environment:
    GO_BANANAS_API_KEY - API key for Go Bananas MCP server
    GO_BANANAS_MCP_URL - Optional MCP server URL (default: https://gobananasai.com/mcp)

Note:
    The Go Bananas MCP API may not always respect aspect ratio requests.
    For guaranteed portrait output, use --mcp-output and have Claude execute
    the MCP tools directly with explicit aspect ratio parameters.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import requests

# Script directory for relative imports
SCRIPT_DIR = Path(__file__).parent
PROJECT_BASE = SCRIPT_DIR.parent.parent.parent.parent / "projects"

# Go Bananas MCP API
# The MCP server URL - can be overridden with GO_BANANAS_MCP_URL env var
GO_BANANAS_MCP_URL = os.environ.get("GO_BANANAS_MCP_URL", "https://gobananasai.com/mcp")


def load_review_state(project_name: str) -> dict | None:
    """Load review state for a project."""
    state_file = PROJECT_BASE / project_name / "review_state.json"
    if not state_file.exists():
        print(f"Error: review_state.json not found at {state_file}")
        return None

    with open(state_file) as f:
        return json.load(f)


def save_review_state(project_name: str, state: dict):
    """Save review state for a project."""
    state_file = PROJECT_BASE / project_name / "review_state.json"
    state["updated_at"] = datetime.now().isoformat()

    with open(state_file, "w") as f:
        json.dump(state, f, indent=2)


def get_scenes_to_regenerate(state: dict, specific_scenes: list[int] | None = None) -> list[int]:
    """Get list of scene numbers to regenerate."""
    if specific_scenes:
        return specific_scenes

    # Get from review_state
    if state.get("regenerate_scenes"):
        return state["regenerate_scenes"]

    return []


def get_scene_prompt(state: dict, scene_num: int) -> str:
    """Get the prompt for a scene."""
    prompts = state.get("data", {}).get("prompts", {})
    return prompts.get(str(scene_num), "")


def get_scene_image_info(state: dict, scene_num: int) -> dict | None:
    """Get image info for a scene."""
    images = state.get("data", {}).get("images", [])
    for img in images:
        if img.get("scene") == scene_num or img.get("scene_number") == scene_num:
            return img
    return None


class MCPClient:
    """
    Simple MCP HTTP client for Go Bananas.

    Implements the MCP Streamable HTTP transport protocol with session management.
    """

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.session_id = None
        self._request_id = 0

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _headers(self) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "X-API-Key": self.api_key,
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        return headers

    def _parse_sse_response(self, text: str) -> dict | None:
        """Parse Server-Sent Events response format."""
        for line in text.split("\n"):
            if line.startswith("data: "):
                try:
                    return json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
        # Try parsing as plain JSON
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    def initialize(self) -> bool:
        """Initialize MCP session."""
        try:
            response = requests.post(
                self.base_url,
                headers=self._headers(),
                json={
                    "jsonrpc": "2.0",
                    "id": self._next_id(),
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "regenerate-images", "version": "1.0"}
                    }
                },
                timeout=30
            )

            if response.status_code == 200:
                # Extract session ID from response headers
                self.session_id = response.headers.get("Mcp-Session-Id")
                data = self._parse_sse_response(response.text)
                if data and "result" in data:
                    return True

            print(f"    Warning: MCP initialize failed: {response.status_code}")
        except Exception as e:
            print(f"    Warning: MCP initialize error: {e}")

        return False

    def call_tool(self, tool_name: str, arguments: dict) -> dict | None:
        """Call an MCP tool."""
        if not self.session_id and not self.initialize():
            return None

        try:
            response = requests.post(
                self.base_url,
                headers=self._headers(),
                json={
                    "jsonrpc": "2.0",
                    "id": self._next_id(),
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments
                    }
                },
                timeout=120
            )

            if response.status_code == 200:
                data = self._parse_sse_response(response.text)
                if data:
                    return data
            else:
                print(f"    Warning: MCP tool call failed: {response.status_code} - {response.text[:200]}")
        except Exception as e:
            print(f"    Warning: MCP tool call error: {e}")

        return None


def generate_image_mcp(
    prompt: str,
    aspect_ratio: str = "9:16",
    character_id: int | None = None,
    product_id: int | None = None,
    api_key: str = None
) -> dict | None:
    """
    Generate image using Go Bananas MCP server.

    Uses the MCP Streamable HTTP transport protocol.

    Returns:
        {"image_id": int, "url": str} on success, None on failure.
    """
    if not api_key:
        return None

    try:
        client = MCPClient(GO_BANANAS_MCP_URL, api_key)

        # Build tool arguments
        arguments = {
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "n": 1,
        }

        # Determine tool arguments
        tool_name = "generate_image"
        if character_id:
            arguments["character_id"] = character_id
        elif product_id:
            arguments["product_id"] = product_id
        arguments["model_id"] = "gemini-pro-image"

        # Call the MCP tool
        response = client.call_tool(tool_name, arguments)

        if response and "result" in response:
            result = response["result"]

            # Parse the content - MCP returns content array with text
            if isinstance(result, dict) and "content" in result:
                for content_item in result.get("content", []):
                    if content_item.get("type") == "text":
                        text = content_item.get("text", "")
                        # Parse "Generated: URL (ID: 123)" format
                        if "Generated:" in text:
                            url_match = re.search(r'Generated:\s*(https?://\S+)', text)
                            id_match = re.search(r'\(ID:\s*(\d+)\)', text)
                            if url_match:
                                return {
                                    "image_id": int(id_match.group(1)) if id_match else None,
                                    "url": url_match.group(1),
                                }

            # Handle direct result format
            if isinstance(result, dict):
                if "url" in result:
                    return {
                        "image_id": result.get("id") or result.get("image_id"),
                        "url": result["url"],
                    }
                if "images" in result and len(result["images"]) > 0:
                    img = result["images"][0]
                    return {
                        "image_id": img.get("id") or img.get("image_id"),
                        "url": img.get("url"),
                    }

        # Handle error response
        if response and "error" in response:
            print(f"    Warning: MCP error: {response['error']}")

    except Exception as e:
        print(f"    Warning: Go Bananas MCP failed: {e}")

    return None


def download_image(url: str, output_path: str, timeout: int = 60) -> bool:
    """Download image from URL to local path."""
    try:
        response = requests.get(url, timeout=timeout, stream=True)
        response.raise_for_status()

        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        print(f"  Warning: Failed to download {url}: {e}")
        return False


def get_image_dimensions(path: str) -> tuple | None:
    """Get image dimensions using sips or PIL."""
    import subprocess

    try:
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")
            width = height = None
            for line in lines:
                if "pixelWidth" in line:
                    width = int(line.split()[-1])
                elif "pixelHeight" in line:
                    height = int(line.split()[-1])
            if width and height:
                return (width, height)
    except Exception:
        pass

    try:
        from PIL import Image
        with Image.open(path) as img:
            return img.size
    except Exception:
        pass

    return None


def regenerate_scene(
    project_name: str,
    scene_num: int,
    prompt: str,
    aspect_ratio: str = "9:16",
    character_id: int | None = None,
    product_id: int | None = None,
    api_key: str | None = None,
    dry_run: bool = False
) -> dict | None:
    """
    Regenerate a single scene image.

    Returns:
        Image info dict on success, None on failure.
    """
    print(f"\n  Scene {scene_num}:")
    print(f"    Prompt: {prompt[:80]}...")

    if dry_run:
        print(f"    [DRY RUN] Would generate with aspect_ratio={aspect_ratio}")
        return {"scene": scene_num, "dry_run": True}

    # Use MCP API
    if api_key:
        print("    Generating via MCP API...")
        result = generate_image_mcp(
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            character_id=character_id,
            product_id=product_id,
            api_key=api_key
        )

        if result and result.get("url"):
            # Download the image
            images_dir = PROJECT_BASE / project_name / "images"
            images_dir.mkdir(parents=True, exist_ok=True)
            output_path = images_dir / f"scene_{scene_num}_frame.jpg"

            print(f"    Downloading to {output_path}...")
            if download_image(result["url"], str(output_path)):
                dims = get_image_dimensions(str(output_path))
                width, height = dims if dims else (0, 0)
                _ratio_type = "portrait" if width < height else "landscape" if width > height else "square"

                return {
                    "scene_number": scene_num,
                    "path": f"images/scene_{scene_num}_frame.jpg",
                    "width": width,
                    "height": height,
                    "regenerated": True,
                    "go_bananas_id": result.get("image_id"),
                }
            else:
                print("    ERROR: Failed to download image")
        else:
            print("    ERROR: Failed to generate image via MCP API")
    else:
        print("    No API key - outputting MCP command instead")
        print_mcp_command(prompt, aspect_ratio, character_id, product_id, scene_num)

    return None


def print_mcp_command(
    prompt: str,
    aspect_ratio: str,
    character_id: int | None,
    product_id: int | None,
    scene_num: int
):
    """Print MCP tool call for Claude to execute (legacy single-prompt format)."""
    print(f"\n    MCP Command for Scene {scene_num}:")
    print("    ---")

    print("    mcp__go-bananas__generate_image(")
    print(f"      prompt=\"{prompt[:100]}...\",")
    if character_id:
        print(f"      character_id={character_id},")
    elif product_id:
        print(f"      product_id={product_id},")
    print(f"      aspect_ratio=\"{aspect_ratio}\",")
    print("      model_id=\"gemini-pro-image\"")
    print("    )")
    print("    ---")


def print_structured_mcp_command(
    gobananas_config: dict,
    aspect_ratio: str,
    character_id: int | None,
    product_id: int | None,
    scene_num: int
):
    """
    Print MCP tool call using structured Go Bananas parameters.

    This uses the new format with scene_prompt + additional_details separated,
    which is optimal when using character/product references since it doesn't
    repeat appearance details that are already in the reference.

    Args:
        gobananas_config: Dict with scene_prompt, additional_details, negative_prompt, etc.
        aspect_ratio: Target aspect ratio (e.g., "9:16")
        character_id: Go Bananas character ID
        product_id: Go Bananas product ID
        scene_num: Scene number for logging
    """
    scene_prompt = gobananas_config.get("scene_prompt", "")
    additional_details = gobananas_config.get("additional_details", "")
    negative_prompt = gobananas_config.get("negative_prompt", "")
    style_preset = gobananas_config.get("recommended_style_preset")

    # Use aspect ratio from config if available, otherwise use parameter
    ar = gobananas_config.get("aspect_ratio", aspect_ratio)

    print(f"\n    MCP Command for Scene {scene_num} [Structured Format]:")
    print("    ---")

    # Combine scene_prompt + additional_details into full prompt
    full_prompt = scene_prompt
    if additional_details:
        full_prompt += f" {additional_details}"

    print("    mcp__go-bananas__generate_image(")
    print(f"        prompt=\"{_escape_for_print(full_prompt)}\",")
    if character_id:
        print(f"        character_id={character_id},")
    elif product_id:
        print(f"        product_id={product_id},")
    if negative_prompt:
        print(f"        negative_prompt=\"{_escape_for_print(negative_prompt)}\",")
    if style_preset:
        print(f"        style_preset_name=\"{style_preset}\",")
    print(f"        aspect_ratio=\"{ar}\",")
    print("        model_id=\"gemini-pro-image\"")
    print("    )")

    print("    ---")

    # Print human-readable summary
    print("\n    Summary:")
    print(f"      Scene Prompt: {scene_prompt[:70]}...")
    if additional_details:
        print(f"      Additional Details: {additional_details[:50]}...")
    if style_preset:
        print(f"      Style Preset: {style_preset}")


def _escape_for_print(text: str) -> str:
    """Escape quotes and newlines for printing MCP command."""
    return text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ')


def regenerate_images(
    project_name: str,
    scenes: list[int] | None = None,
    character_id: int | None = None,
    product_id: int | None = None,
    api_key: str | None = None,
    dry_run: bool = False,
    mcp_output: bool = False
) -> dict:
    """
    Main regeneration workflow.

    Args:
        project_name: Name of the project
        scenes: Specific scene numbers to regenerate (or use review_state)
        character_id: Go Bananas character ID to use
        product_id: Go Bananas product ID to use
        api_key: Go Bananas API key
        dry_run: If True, only show what would be done
        mcp_output: If True, output MCP commands instead of calling API

    Returns:
        Result dict with success status and regenerated scenes
    """
    print(f"\n{'='*60}")
    print(f"Regenerate Images - {project_name}")
    print(f"{'='*60}")

    # Load state
    state = load_review_state(project_name)
    if not state:
        return {"success": False, "error": "Could not load review state"}

    # Get scenes to regenerate
    scenes_to_regen = get_scenes_to_regenerate(state, scenes)
    if not scenes_to_regen:
        print("\nNo scenes to regenerate.")
        return {"success": True, "regenerated": []}

    print(f"\nScenes to regenerate: {scenes_to_regen}")

    # Get aspect ratio from state (check both aspect_ratio and target_ratio)
    data = state.get("data", {})
    aspect_ratio = data.get("aspect_ratio") or data.get("target_ratio", "9:16")

    # Convert human-readable names to MCP aspect ratios
    aspect_ratio_map = {
        "portrait": "9:16",
        "landscape": "16:9",
        "square": "1:1",
    }
    aspect_ratio = aspect_ratio_map.get(aspect_ratio.lower(), aspect_ratio)
    print(f"Target aspect ratio: {aspect_ratio}")

    # Check API key
    api_key = api_key or os.environ.get("GO_BANANAS_API_KEY")
    if not api_key and not mcp_output and not dry_run:
        print("\nWarning: No GO_BANANAS_API_KEY set. Using --mcp-output mode.")
        mcp_output = True

    # Regenerate each scene
    regenerated = []
    failed = []

    for scene_num in scenes_to_regen:
        prompt = get_scene_prompt(state, scene_num)
        if not prompt:
            print(f"\n  Scene {scene_num}: No prompt found, skipping")
            failed.append(scene_num)
            continue

        if mcp_output:
            print_mcp_command(prompt, aspect_ratio, character_id, product_id, scene_num)
            continue

        result = regenerate_scene(
            project_name=project_name,
            scene_num=scene_num,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            character_id=character_id,
            product_id=product_id,
            api_key=api_key,
            dry_run=dry_run
        )

        if result:
            regenerated.append(result)
            # Update state with new image info
            images = state.get("data", {}).get("images", [])
            for i, img in enumerate(images):
                if img.get("scene") == scene_num or img.get("scene_number") == scene_num:
                    images[i] = result
                    break
        else:
            failed.append(scene_num)

    # Update state
    if not dry_run and not mcp_output and regenerated:
        state["status"] = "pending_review"
        state["regenerate_scenes"] = []
        state["message"] = f"Regenerated {len(regenerated)} scenes. Ready for review."
        save_review_state(project_name, state)
        print("\nState updated - status reset to pending_review")

    # Summary
    print(f"\n{'='*60}")
    print("Summary")
    print(f"{'='*60}")
    if dry_run:
        print("  DRY RUN - no changes made")
    elif mcp_output:
        print(f"  MCP commands output for {len(scenes_to_regen)} scenes")
        print("  Run these commands in Claude to regenerate images")
    else:
        print(f"  Regenerated: {len(regenerated)}")
        print(f"  Failed: {len(failed)}")
        if failed:
            print(f"  Failed scenes: {failed}")
    print(f"{'='*60}")

    return {
        "success": len(failed) == 0,
        "regenerated": regenerated,
        "failed": failed,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Regenerate images for selected scenes using Go Bananas",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Regenerate from review_state.json
    python regenerate_images.py --project seemanti-test

    # Regenerate specific scenes
    python regenerate_images.py --project seemanti-test --scenes 1,3,5

    # With character reference
    python regenerate_images.py --project seemanti-test --character-id 42

    # Output MCP commands for Claude
    python regenerate_images.py --project seemanti-test --mcp-output

    # Dry run
    python regenerate_images.py --project seemanti-test --dry-run
        """
    )

    parser.add_argument("--project", "-p", required=True,
                        help="Project name")
    parser.add_argument("--scenes", "-s",
                        help="Comma-separated scene numbers to regenerate (e.g., 1,3,5)")
    parser.add_argument("--character-id", "-c", type=int,
                        help="Go Bananas character ID to use")
    parser.add_argument("--product-id", type=int,
                        help="Go Bananas product ID to use")
    parser.add_argument("--api-key",
                        help="Go Bananas MCP API key (or set GO_BANANAS_API_KEY env)")
    parser.add_argument("--dry-run", "-n", action="store_true",
                        help="Show what would be done without making changes")
    parser.add_argument("--mcp-output", "-m", action="store_true",
                        help="Output MCP commands for Claude instead of calling API")

    args = parser.parse_args()

    # Parse scenes
    scenes = None
    if args.scenes:
        scenes = [int(s.strip()) for s in args.scenes.split(",")]

    result = regenerate_images(
        project_name=args.project,
        scenes=scenes,
        character_id=args.character_id,
        product_id=args.product_id,
        api_key=args.api_key,
        dry_run=args.dry_run,
        mcp_output=args.mcp_output
    )

    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
