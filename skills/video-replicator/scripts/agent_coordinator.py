#!/usr/bin/env python3
"""
Agent Coordinator for Review Pipeline.

Provides helper functions for agent communication, state management,
and result aggregation in the agent-assisted review workflow.

Usage:
    from agent_coordinator import AgentCoordinator

    coordinator = AgentCoordinator(project_dir)
    coordinator.start_qa_workflow()
    coordinator.submit_qa_report(scene_number, report)
    coordinator.trigger_regeneration(scenes)
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import ProjectError

# Import review_state functions
from review_state import read_state, update_state


class AgentCoordinator:
    """Coordinates agent-assisted review workflow."""

    def __init__(self, project_dir: str):
        """
        Initialize coordinator for a project.

        Args:
            project_dir: Path to the project directory
        """
        self.project_dir = Path(project_dir)
        self.results_dir = self.project_dir / "agent_results"
        self.results_dir.mkdir(exist_ok=True)

    # =========================================================================
    # State Management
    # =========================================================================

    def get_state(self) -> dict | None:
        """Get current review state."""
        return read_state(str(self.project_dir))

    def update_agent_status(
        self,
        status: Literal["idle", "working", "complete", "error"],
        working_info: dict | None = None
    ) -> dict:
        """
        Update agent status in review state.

        Args:
            status: Current agent status
            working_info: Optional info about current work (type, progress, etc.)
        """
        updates = {
            "agent_status": status,
            "agent_working": working_info,
            "agent_updated_at": datetime.now().isoformat()
        }
        return update_state(str(self.project_dir), updates)

    def set_qa_report(self, qa_report: dict) -> dict:
        """
        Store QA report in review state.

        Args:
            qa_report: Aggregated QA report from image-qa agents
        """
        state = self.get_state()
        if not state:
            raise ProjectError(f"No state file found in {self.project_dir}")

        data = state.get("data", {})
        data["qa_report"] = qa_report

        return update_state(str(self.project_dir), {
            "data": data,
            "agent_status": "complete"
        })

    def set_video_comparison(self, comparison: dict) -> dict:
        """
        Store video comparison results in review state.

        Args:
            comparison: Comparison results from video-comparison agent
        """
        state = self.get_state()
        if not state:
            raise ProjectError(f"No state file found in {self.project_dir}")

        data = state.get("data", {})
        data["video_comparison"] = comparison

        return update_state(str(self.project_dir), {
            "data": data,
            "agent_status": "complete"
        })

    # =========================================================================
    # QA Workflow
    # =========================================================================

    def start_qa_workflow(self, stage: str) -> dict:
        """
        Start QA workflow for a checkpoint stage.

        Args:
            stage: Current stage (images or videos)
        """
        return self.update_agent_status(
            status="working",
            working_info={
                "type": f"{stage}-qa",
                "started_at": datetime.now().isoformat(),
                "progress": "Starting analysis..."
            }
        )

    def update_qa_progress(self, completed: int, total: int, current_scene: int | None = None) -> dict:
        """
        Update QA progress.

        Args:
            completed: Number of scenes analyzed
            total: Total scenes to analyze
            current_scene: Currently processing scene number
        """
        return self.update_agent_status(
            status="working",
            working_info={
                "type": "image-qa",
                "progress": f"{completed}/{total} scenes analyzed",
                "current_scene": current_scene,
                "percent": round(completed / total * 100) if total > 0 else 0
            }
        )

    def submit_scene_qa(self, scene_number: int, report: dict) -> Path:
        """
        Submit QA report for a single scene.

        Args:
            scene_number: Scene number
            report: QA report from image-qa agent

        Returns:
            Path to saved report file
        """
        report_file = self.results_dir / f"image_qa_scene_{scene_number}.json"
        with open(report_file, "w") as f:
            json.dump(report, f, indent=2)
        return report_file

    def aggregate_qa_reports(self) -> dict:
        """
        Aggregate all scene QA reports into a single report.

        Returns:
            Aggregated QA report
        """
        reports = []
        report_files = sorted(self.results_dir.glob("image_qa_scene_*.json"))

        for report_file in report_files:
            with open(report_file) as f:
                reports.append(json.load(f))

        if not reports:
            return {
                "timestamp": datetime.now().isoformat(),
                "scenes": [],
                "overall_score": 0,
                "recommendations": []
            }

        # Calculate overall score
        overall_score = sum(r.get("scores", {}).get("overall", 0) for r in reports) / len(reports)

        # Build recommendations
        recommendations = []
        for report in reports:
            rec = report.get("recommendation", {})
            recommendations.append({
                "scene": report.get("scene_number"),
                "action": rec.get("action", "review"),
                "confidence": rec.get("confidence", 0.5),
                "notes": rec.get("notes", "")
            })

        # Determine if auto-approve is eligible (all scenes >= 0.85)
        auto_approve = all(r.get("scores", {}).get("overall", 0) >= 0.85 for r in reports)

        return {
            "timestamp": datetime.now().isoformat(),
            "scenes": reports,
            "overall_score": round(overall_score, 2),
            "recommendations": recommendations,
            "auto_approve_eligible": auto_approve,
            "summary": {
                "approve": len([r for r in recommendations if r["action"] == "approve"]),
                "review": len([r for r in recommendations if r["action"] == "review"]),
                "regenerate": len([r for r in recommendations if r["action"] == "regenerate"])
            }
        }

    # =========================================================================
    # Regeneration Workflow
    # =========================================================================

    def start_regeneration(self, scenes: list[int]) -> dict:
        """
        Start regeneration workflow.

        Args:
            scenes: List of scene numbers to regenerate
        """
        return self.update_agent_status(
            status="working",
            working_info={
                "type": "regeneration",
                "scenes": scenes,
                "started_at": datetime.now().isoformat(),
                "progress": f"0/{len(scenes)} scenes regenerated"
            }
        )

    def update_regeneration_progress(self, completed: int, total: int, current_scene: int) -> dict:
        """
        Update regeneration progress.

        Args:
            completed: Number of scenes regenerated
            total: Total scenes to regenerate
            current_scene: Currently regenerating scene
        """
        return self.update_agent_status(
            status="working" if completed < total else "complete",
            working_info={
                "type": "regeneration",
                "progress": f"{completed}/{total} scenes regenerated",
                "current_scene": current_scene,
                "percent": round(completed / total * 100) if total > 0 else 0
            }
        )

    def complete_regeneration(self, results: dict[int, dict]) -> dict:
        """
        Complete regeneration workflow.

        Args:
            results: Dict mapping scene number to result (success, image_id, error)
        """
        state = self.get_state()
        if not state:
            raise ProjectError(f"No state file found in {self.project_dir}")

        data = state.get("data", {})
        data["regeneration_results"] = results
        data["regeneration_timestamp"] = datetime.now().isoformat()

        # Reset status to pending_review for re-review
        return update_state(str(self.project_dir), {
            "data": data,
            "status": "pending_review",
            "agent_status": "complete",
            "agent_working": None,
            "regenerated_scenes": list(results.keys())
        })

    # =========================================================================
    # Video Comparison Workflow
    # =========================================================================

    def start_video_comparison(self, scenes: list[int]) -> dict:
        """
        Start video comparison workflow.

        Args:
            scenes: List of scene numbers to compare
        """
        return self.update_agent_status(
            status="working",
            working_info={
                "type": "video-comparison",
                "scenes": scenes,
                "started_at": datetime.now().isoformat(),
                "progress": f"0/{len(scenes)} scenes compared"
            }
        )

    def submit_video_comparison(self, scene_number: int, comparison: dict) -> Path:
        """
        Submit comparison result for a single scene.

        Args:
            scene_number: Scene number
            comparison: Comparison result from video-comparison agent

        Returns:
            Path to saved comparison file
        """
        comparison_file = self.results_dir / f"video_comparison_scene_{scene_number}.json"
        with open(comparison_file, "w") as f:
            json.dump(comparison, f, indent=2)
        return comparison_file

    def aggregate_video_comparisons(self) -> dict:
        """
        Aggregate all video comparison results.

        Returns:
            Aggregated comparison report
        """
        comparisons = []
        comparison_files = sorted(self.results_dir.glob("video_comparison_scene_*.json"))

        for comp_file in comparison_files:
            with open(comp_file) as f:
                comparisons.append(json.load(f))

        if not comparisons:
            return {
                "timestamp": datetime.now().isoformat(),
                "scenes": [],
                "auto_selections": {}
            }

        # Build auto-selections
        auto_selections = {}
        confidence_levels = {"high": [], "medium": [], "low": []}

        for comp in comparisons:
            scene = comp.get("scene_number") or comp.get("scene")
            recommendation = comp.get("recommendation", "primary")
            confidence = comp.get("confidence", 0.5)

            auto_selections[str(scene)] = recommendation

            if confidence >= 0.80:
                confidence_levels["high"].append(scene)
            elif confidence >= 0.65:
                confidence_levels["medium"].append(scene)
            else:
                confidence_levels["low"].append(scene)

        return {
            "timestamp": datetime.now().isoformat(),
            "scenes": comparisons,
            "auto_selections": auto_selections,
            "confidence_levels": confidence_levels,
            "summary": {
                "primary_recommended": len([c for c in comparisons if c.get("recommendation") == "primary"]),
                "alt_recommended": len([c for c in comparisons if c.get("recommendation") == "alt"]),
                "needs_review": len(confidence_levels["low"])
            }
        }

    # =========================================================================
    # Utility Methods
    # =========================================================================

    def get_images_for_qa(self) -> list[dict]:
        """
        Get list of images to analyze from state.

        Returns:
            List of image info dicts with path, scene_number, prompt
        """
        state = self.get_state()
        if not state:
            return []

        data = state.get("data", {})
        images = data.get("images", [])
        prompts = data.get("prompts", {})
        target_ratio = data.get("target_ratio", "portrait")

        result = []
        for img in images:
            scene = img.get("scene_number") or img.get("scene")
            result.append({
                "scene_number": scene,
                "path": img.get("path") or img.get("url"),
                "prompt": prompts.get(str(scene), ""),
                "target_ratio": target_ratio
            })

        return result

    def get_videos_for_comparison(self) -> list[dict]:
        """
        Get list of video pairs to compare from state.

        Returns:
            List of video info dicts with primary, alt paths
        """
        state = self.get_state()
        if not state:
            return []

        data = state.get("data", {})
        videos = data.get("videos", [])
        prompts = data.get("prompts", {})

        result = []
        for video in videos:
            scene = video.get("scene_number") or video.get("scene")
            result.append({
                "scene_number": scene,
                "primary": video.get("primary"),
                "alt": video.get("alt"),
                "prompt": prompts.get(str(scene), "")
            })

        return result

    def get_go_bananas_context(self) -> dict:
        """
        Get Go Bananas context for regeneration.

        Returns:
            Context dict with character_id, product_id, aspect_ratio
        """
        state = self.get_state()
        if not state:
            return {}

        return state.get("data", {}).get("go_bananas_context", {})

    def clear_results(self):
        """Clear all agent result files."""
        for f in self.results_dir.glob("*.json"):
            f.unlink()


# =============================================================================
# CLI Interface
# =============================================================================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Agent coordinator CLI")
    parser.add_argument("--project", "-p", required=True, help="Project directory")
    parser.add_argument("--action", "-a", required=True,
                       choices=["status", "start-qa", "aggregate-qa", "start-regen",
                               "complete-regen", "aggregate-video", "clear"],
                       help="Action to perform")
    parser.add_argument("--scenes", "-s", type=str, help="Comma-separated scene numbers")
    parser.add_argument("--stage", type=str, default="images", help="Pipeline stage")

    args = parser.parse_args()

    coordinator = AgentCoordinator(args.project)

    if args.action == "status":
        state = coordinator.get_state()
        if state:
            print(json.dumps({
                "agent_status": state.get("agent_status"),
                "agent_working": state.get("agent_working"),
                "stage": state.get("stage"),
                "status": state.get("status")
            }, indent=2))
        else:
            print("No state found")

    elif args.action == "start-qa":
        coordinator.start_qa_workflow(args.stage)
        print(f"Started QA workflow for {args.stage}")

    elif args.action == "aggregate-qa":
        report = coordinator.aggregate_qa_reports()
        coordinator.set_qa_report(report)
        print(json.dumps(report, indent=2))

    elif args.action == "start-regen":
        if not args.scenes:
            print("Error: --scenes required")
            return
        scenes = [int(s) for s in args.scenes.split(",")]
        coordinator.start_regeneration(scenes)
        print(f"Started regeneration for scenes: {scenes}")

    elif args.action == "complete-regen":
        if not args.scenes:
            print("Error: --scenes required")
            return
        scenes = [int(s) for s in args.scenes.split(",")]
        results = {s: {"success": True} for s in scenes}
        _result = coordinator.complete_regeneration(results)
        print("Regeneration completed")

    elif args.action == "aggregate-video":
        comparison = coordinator.aggregate_video_comparisons()
        coordinator.set_video_comparison(comparison)
        print(json.dumps(comparison, indent=2))

    elif args.action == "clear":
        coordinator.clear_results()
        print("Cleared agent results")


if __name__ == "__main__":
    main()
