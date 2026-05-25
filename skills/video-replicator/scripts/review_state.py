#!/usr/bin/env python3
"""
Manage review state for interactive pipeline.

Creates/updates review_state.json that the web UI reads.
Supports checkpoints at each stage of the pipeline.

Usage:
    from review_state import create_checkpoint, wait_for_approval, approve_checkpoint

    # Create a checkpoint and wait for approval
    create_checkpoint(project_dir, "prompts", {"prompts": scenes, "aspect_ratio": "portrait"})
    approval = wait_for_approval(project_dir)

    # Or programmatically approve
    approve_checkpoint(project_dir, regenerate_scenes=[1, 3])
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ProjectError, ValidationError

# Valid pipeline stages
STAGES = ["prompts", "images", "aspect_mismatch", "videos", "final", "complete"]
StageType = Literal["prompts", "images", "aspect_mismatch", "videos", "final", "complete"]

# Agent status types
AgentStatusType = Literal["idle", "working", "complete", "error"]


def get_state_file_path(project_dir: str) -> str:
    """Get the path to the review state file."""
    return os.path.join(project_dir, "review_state.json")


def create_checkpoint(
    project_dir: str,
    stage: StageType,
    data: dict[str, Any],
    message: str | None = None,
    agent_assisted: bool = False
) -> str:
    """
    Create a checkpoint and prepare for user approval.

    Args:
        project_dir: Path to the project directory
        stage: Current pipeline stage
        data: Stage-specific data to store
        message: Optional message to display to user
        agent_assisted: Enable AI agent pre-analysis at this checkpoint

    Returns:
        Path to the state file
    """
    state_file = get_state_file_path(project_dir)

    state = {
        "project": os.path.basename(project_dir),
        "project_path": os.path.abspath(project_dir),
        "stage": stage,
        "status": "pending_review",
        "data": data,
        "message": message,
        "approval": None,
        "regenerate_scenes": [],
        "auto_fix": False,
        "timestamp": datetime.now().isoformat(),
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        # Agent-assisted fields
        "agent_assisted": agent_assisted,
        "agent_status": "pending" if agent_assisted else "idle",
        "agent_working": None,
        "agent_updated_at": None,
        "regenerated_scenes": [],
    }

    # Ensure directory exists
    os.makedirs(project_dir, exist_ok=True)

    with open(state_file, "w") as f:
        json.dump(state, f, indent=2)

    return state_file


def read_state(project_dir: str) -> dict | None:
    """Read the current review state."""
    state_file = get_state_file_path(project_dir)

    if not os.path.exists(state_file):
        return None

    with open(state_file) as f:
        return json.load(f)


def update_state(project_dir: str, updates: dict[str, Any]) -> dict:
    """Update the review state with new values."""
    state_file = get_state_file_path(project_dir)

    state = read_state(project_dir)
    if not state:
        raise ProjectError(f"No state file found in {project_dir}")

    state.update(updates)
    state["updated_at"] = datetime.now().isoformat()

    with open(state_file, "w") as f:
        json.dump(state, f, indent=2)

    return state


def wait_for_approval(
    project_dir: str,
    timeout: int = 3600,
    poll_interval: int = 2
) -> dict:
    """
    Poll state file until user approves or timeout.

    Args:
        project_dir: Path to the project directory
        timeout: Maximum time to wait in seconds (default: 1 hour)
        poll_interval: Time between polls in seconds (default: 2s)

    Returns:
        The approval data including any edits or regeneration requests

    Raises:
        TimeoutError: If timeout is reached
        ValueError: If user rejected the checkpoint
    """
    state_file = get_state_file_path(project_dir)
    start = time.time()

    print(f"\nWaiting for approval... (timeout: {timeout}s)")
    print(f"Review at: http://localhost:5173/review/?project={os.path.basename(project_dir)}")

    while time.time() - start < timeout:
        if not os.path.exists(state_file):
            time.sleep(poll_interval)
            continue

        with open(state_file) as f:
            state = json.load(f)

        if state["status"] == "approved":
            print("Checkpoint approved!")
            return state
        elif state["status"] == "rejected":
            raise ValidationError("User rejected at checkpoint")

        # Show a progress indicator
        elapsed = int(time.time() - start)
        if elapsed > 0 and elapsed % 30 == 0:
            print(f"  Still waiting... ({elapsed}s elapsed)")

        time.sleep(poll_interval)

    raise TimeoutError(f"Review timeout after {timeout} seconds")


def approve_checkpoint(
    project_dir: str,
    regenerate_scenes: list[int] | None = None,
    data_updates: dict | None = None,
    auto_fix: bool = False
) -> dict:
    """
    Programmatically approve the current checkpoint.

    Called by web UI or CLI to approve the current stage.

    Args:
        project_dir: Path to the project directory
        regenerate_scenes: List of scene numbers to regenerate
        data_updates: Optional updates to the data (e.g., edited prompts)
        auto_fix: Whether to auto-fix aspect ratio issues

    Returns:
        Updated state
    """
    state = read_state(project_dir)
    if not state:
        raise ProjectError(f"No state file found in {project_dir}")

    updates = {
        "status": "approved",
        "regenerate_scenes": regenerate_scenes or [],
        "auto_fix": auto_fix,
        "approved_at": datetime.now().isoformat(),
    }

    if data_updates:
        updates["data"] = {**state.get("data", {}), **data_updates}

    return update_state(project_dir, updates)


def reject_checkpoint(project_dir: str, reason: str | None = None) -> dict:
    """
    Reject the current checkpoint and stop the pipeline.

    Args:
        project_dir: Path to the project directory
        reason: Optional reason for rejection

    Returns:
        Updated state
    """
    return update_state(project_dir, {
        "status": "rejected",
        "rejection_reason": reason,
        "rejected_at": datetime.now().isoformat(),
    })


def advance_stage(project_dir: str, new_stage: StageType, data: dict[str, Any]) -> str:
    """
    Advance to the next pipeline stage.

    Creates a new checkpoint for the next stage.

    Args:
        project_dir: Path to the project directory
        new_stage: Next stage to advance to
        data: Data for the new stage

    Returns:
        Path to the state file
    """
    return create_checkpoint(project_dir, new_stage, data)


def complete_pipeline(project_dir: str, final_data: dict[str, Any]) -> dict:
    """
    Mark the pipeline as complete.

    Args:
        project_dir: Path to the project directory
        final_data: Final output data (video paths, etc.)

    Returns:
        Updated state
    """
    return update_state(project_dir, {
        "stage": "complete",
        "status": "approved",
        "data": final_data,
        "completed_at": datetime.now().isoformat(),
    })


def get_regeneration_list(project_dir: str) -> list[int]:
    """Get the list of scenes to regenerate from the state."""
    state = read_state(project_dir)
    if not state:
        return []
    return state.get("regenerate_scenes", [])


def should_auto_fix(project_dir: str) -> bool:
    """Check if auto-fix was requested."""
    state = read_state(project_dir)
    if not state:
        return False
    return state.get("auto_fix", False)


# ============================================================================
# Agent-Assisted Review Management
# ============================================================================


def enable_agent_assisted(project_dir: str) -> dict:
    """
    Enable agent-assisted review mode for a project.

    Args:
        project_dir: Path to the project directory

    Returns:
        Updated state dict
    """
    return update_state(project_dir, {
        "agent_assisted": True,
        "agent_status": "idle"
    })


def set_agent_status(
    project_dir: str,
    status: AgentStatusType,
    working_info: dict | None = None
) -> dict:
    """
    Update agent status in review state.

    Args:
        project_dir: Path to the project directory
        status: Agent status (idle, working, complete, error)
        working_info: Optional info about current work

    Returns:
        Updated state dict
    """
    updates = {
        "agent_status": status,
        "agent_working": working_info,
        "agent_updated_at": datetime.now().isoformat()
    }
    return update_state(project_dir, updates)


def get_agent_status(project_dir: str) -> dict:
    """
    Get current agent status.

    Args:
        project_dir: Path to the project directory

    Returns:
        Dict with agent_assisted, agent_status, agent_working
    """
    state = read_state(project_dir)
    if not state:
        return {
            "agent_assisted": False,
            "agent_status": "idle",
            "agent_working": None
        }

    return {
        "agent_assisted": state.get("agent_assisted", False),
        "agent_status": state.get("agent_status", "idle"),
        "agent_working": state.get("agent_working"),
        "agent_updated_at": state.get("agent_updated_at")
    }


def set_qa_report(project_dir: str, qa_report: dict) -> dict:
    """
    Store QA report from image-qa agents.

    Args:
        project_dir: Path to the project directory
        qa_report: Aggregated QA report

    Returns:
        Updated state dict
    """
    state = read_state(project_dir)
    if not state:
        raise ProjectError(f"No state file found in {project_dir}")

    data = state.get("data", {})
    data["qa_report"] = qa_report

    return update_state(project_dir, {
        "data": data,
        "agent_status": "complete"
    })


def get_qa_report(project_dir: str) -> dict | None:
    """
    Get QA report from state.

    Args:
        project_dir: Path to the project directory

    Returns:
        QA report dict or None
    """
    state = read_state(project_dir)
    if not state:
        return None

    return state.get("data", {}).get("qa_report")


def set_video_comparison(project_dir: str, comparison: dict) -> dict:
    """
    Store video comparison results.

    Args:
        project_dir: Path to the project directory
        comparison: Comparison results from video-comparison agent

    Returns:
        Updated state dict
    """
    state = read_state(project_dir)
    if not state:
        raise ProjectError(f"No state file found in {project_dir}")

    data = state.get("data", {})
    data["video_comparison"] = comparison

    return update_state(project_dir, {
        "data": data,
        "agent_status": "complete"
    })


def get_video_comparison(project_dir: str) -> dict | None:
    """
    Get video comparison results from state.

    Args:
        project_dir: Path to the project directory

    Returns:
        Video comparison dict or None
    """
    state = read_state(project_dir)
    if not state:
        return None

    return state.get("data", {}).get("video_comparison")


def mark_regeneration_complete(
    project_dir: str,
    results: dict[int, dict],
    scenes: list[int]
) -> dict:
    """
    Mark regeneration as complete and reset for re-review.

    Args:
        project_dir: Path to the project directory
        results: Dict mapping scene number to result
        scenes: List of regenerated scene numbers

    Returns:
        Updated state dict
    """
    state = read_state(project_dir)
    if not state:
        raise ProjectError(f"No state file found in {project_dir}")

    data = state.get("data", {})
    data["regeneration_results"] = results
    data["regeneration_timestamp"] = datetime.now().isoformat()

    return update_state(project_dir, {
        "data": data,
        "status": "pending_review",
        "agent_status": "complete",
        "agent_working": None,
        "regenerated_scenes": scenes
    })


# ============================================================================
# Go Bananas Context Management
# ============================================================================


def set_go_bananas_context(
    project_dir: str,
    character_id: int | None = None,
    character_name: str | None = None,
    product_id: int | None = None,
    product_name: str | None = None,
    aspect_ratio: str = "9:16",
    image_prompts: dict[str, str] | None = None
) -> dict:
    """
    Store Go Bananas context for regeneration.

    This context is used by the regenerate_images.py script to maintain
    character/product consistency when regenerating specific scenes.

    Args:
        project_dir: Path to the project directory
        character_id: Go Bananas character ID
        character_name: Go Bananas character name (for display)
        product_id: Go Bananas product ID
        product_name: Go Bananas product name (for display)
        aspect_ratio: Target aspect ratio (e.g., "9:16", "16:9")
        image_prompts: Scene-specific image generation prompts

    Returns:
        Updated state dict
    """
    state = read_state(project_dir)
    if not state:
        raise ProjectError(f"No state file found in {project_dir}")

    if "data" not in state:
        state["data"] = {}

    state["data"]["go_bananas_context"] = {
        "character_id": character_id,
        "character_name": character_name,
        "product_id": product_id,
        "product_name": product_name,
        "aspect_ratio": aspect_ratio,
    }

    if image_prompts:
        state["data"]["image_prompts"] = image_prompts

    return update_state(project_dir, {"data": state["data"]})


def get_go_bananas_context(project_dir: str) -> dict:
    """
    Get Go Bananas context from state.

    Returns:
        Context dict with character_id, product_id, aspect_ratio, etc.
        Returns empty dict if no context is set.
    """
    state = read_state(project_dir)
    if not state:
        return {}

    return state.get("data", {}).get("go_bananas_context", {})


def get_image_prompts(project_dir: str) -> dict[str, str]:
    """
    Get image prompts for each scene.

    Returns:
        Dict mapping scene number (as string) to prompt text.
    """
    state = read_state(project_dir)
    if not state:
        return {}

    # First check for dedicated image_prompts
    image_prompts = state.get("data", {}).get("image_prompts", {})
    if image_prompts:
        return image_prompts

    # Fall back to regular prompts
    return state.get("data", {}).get("prompts", {})


# ============================================================================
# CLI Commands
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Review state management")
    parser.add_argument("--project", "-p", required=True, help="Project directory")
    parser.add_argument("--action", "-a", choices=["create", "approve", "reject", "status", "wait"],
                       default="status", help="Action to perform")
    parser.add_argument("--stage", "-s", choices=STAGES, help="Stage for create action")
    parser.add_argument("--regenerate", "-r", type=int, nargs="*", help="Scenes to regenerate")
    parser.add_argument("--autofix", action="store_true", help="Enable auto-fix")
    parser.add_argument("--timeout", "-t", type=int, default=3600, help="Wait timeout")

    args = parser.parse_args()

    if args.action == "status":
        state = read_state(args.project)
        if state:
            print(json.dumps(state, indent=2))
        else:
            print(f"No state file found in {args.project}")

    elif args.action == "create":
        if not args.stage:
            print("Error: --stage required for create action")
            exit(1)
        state_file = create_checkpoint(args.project, args.stage, {})
        print(f"Created checkpoint at {state_file}")

    elif args.action == "approve":
        state = approve_checkpoint(
            args.project,
            regenerate_scenes=args.regenerate,
            auto_fix=args.autofix
        )
        print(f"Approved checkpoint: {state['stage']}")

    elif args.action == "reject":
        state = reject_checkpoint(args.project)
        print("Rejected checkpoint")

    elif args.action == "wait":
        try:
            state = wait_for_approval(args.project, timeout=args.timeout)
            print(f"Approved! Regenerate scenes: {state.get('regenerate_scenes', [])}")
        except TimeoutError:
            print("Timeout waiting for approval")
            exit(1)
        except (ValueError, ValidationError) as e:
            print(f"Error: {e}")
            exit(1)
