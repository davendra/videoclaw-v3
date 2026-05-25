#!/usr/bin/env python3
"""
Run telemetry for video generation pipeline.

Records per-scene events to:
  - JSONL sidecar: projects/{slug}/telemetry/run{NNN}.jsonl  (crash-safe, real-time)
  - SQLite:        video-replicator.db run_telemetry table   (at run end)

Usage:
    from telemetry import start_run, get_current_run

    telem = start_run("my-project", "run003", "seedance", "fast", 5,
                      jsonl_dir=Path("projects/my-project/telemetry"))
    telem.record_scene_start(1)
    telem.record_scene_end(1, status="ok", cost=19, duration=340.0,
                           quality="fast", upload_service="xskill")
    telem.print_report()
    telem.flush_to_sqlite(Path("video-replicator.db"))
"""

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Optional

# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
_current_run: Optional["RunTelemetry"] = None


def start_run(
    project: str,
    run_id: str,
    backend: str,
    quality: str,
    num_scenes: int,
    jsonl_dir: Path,
) -> "RunTelemetry":
    """Start a new telemetry run. Replaces any existing singleton."""
    global _current_run
    if _current_run is not None:
        _current_run.close()
    _current_run = RunTelemetry(project, run_id, backend, quality, num_scenes, jsonl_dir)
    return _current_run


def get_current_run() -> Optional["RunTelemetry"]:
    """Return active RunTelemetry, or None if telemetry not started."""
    return _current_run


# ---------------------------------------------------------------------------
# SceneRecord
# ---------------------------------------------------------------------------
@dataclass
class SceneRecord:
    scene_id: int
    status: str = "pending"         # ok | fail | skipped
    attempts: int = 0
    cost_credits: int = 0
    duration_s: float = 0.0
    final_quality: str = ""
    upload_service: str = ""
    retries: list[dict[str, object]] = field(default_factory=list)   # [{"attempt": N, "reason": str}]
    quality_fallback: bool = False
    upload_fallback: bool = False
    failure_reason: str = ""
    started_at: float = 0.0
    ended_at: float = 0.0

    @property
    def content_violations(self) -> int:
        return sum(1 for r in self.retries if r.get("reason") == "content_filter")

    @property
    def notes(self) -> str:
        parts: list[str] = []
        reason_counts: dict[str, int] = {}
        for r in self.retries:
            reason = r.get("reason", "unknown")
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
        for reason, count in reason_counts.items():
            parts.append(f"{reason} \u00d7{count}" if count > 1 else reason)
        if self.quality_fallback:
            parts.append("quality_fallback")
        if self.upload_fallback and self.upload_service:
            parts.append(f"upload\u2192{self.upload_service}")
        return ", ".join(parts)


# ---------------------------------------------------------------------------
# RunTelemetry (skeleton — methods added in later tasks)
# ---------------------------------------------------------------------------
class RunTelemetry:
    def __init__(
        self,
        project: str,
        run_id: str,
        backend: str,
        quality: str,
        num_scenes: int,
        jsonl_dir: Path,
    ):
        self.project = project
        self.run_id = run_id
        self.backend = backend
        self.quality = quality
        self.num_scenes = num_scenes
        self.started_at = time.time()
        self.scenes: dict[int, SceneRecord] = {}
        self._jsonl_path: Optional[Path] = None
        self._jsonl_file: Optional[IO[str]] = None
        self._init_jsonl(jsonl_dir)
        self._write_event({
            "event": "run_start",
            "project": project,
            "run": run_id,
            "backend": backend,
            "quality": quality,
            "num_scenes": num_scenes,
        })

    def _init_jsonl(self, jsonl_dir: Path) -> None:
        try:
            jsonl_dir.mkdir(parents=True, exist_ok=True)
            self._jsonl_path = jsonl_dir / f"{self.run_id}.jsonl"
            self._jsonl_file = open(self._jsonl_path, "a", encoding="utf-8")
        except Exception:
            pass  # degrade silently to in-memory only

    def _write_event(self, data: dict) -> None:
        try:
            if self._jsonl_file:
                line = json.dumps({**data, "ts": int(time.time())})
                self._jsonl_file.write(line + "\n")
                self._jsonl_file.flush()
        except Exception:
            pass

    def _get_or_create_scene(self, scene_id: int) -> SceneRecord:
        if scene_id not in self.scenes:
            self.scenes[scene_id] = SceneRecord(scene_id=scene_id)
        return self.scenes[scene_id]

    def record_scene_start(self, scene_id: int) -> None:
        try:
            rec = self._get_or_create_scene(scene_id)
            rec.started_at = time.time()
            rec.attempts += 1
            self._write_event({"event": "scene_start", "scene": scene_id})
        except Exception:
            pass

    def record_scene_end(
        self,
        scene_id: int,
        status: str,
        cost: int = 0,
        duration: float = 0.0,
        quality: str = "",
        upload_service: str = "",
        failure_reason: str = "",
    ) -> None:
        try:
            rec = self._get_or_create_scene(scene_id)
            rec.status = status
            rec.cost_credits = cost
            rec.duration_s = duration
            rec.final_quality = quality or self.quality
            rec.upload_service = upload_service
            rec.failure_reason = failure_reason
            rec.ended_at = time.time()
            self._write_event({
                "event": "scene_end", "scene": scene_id, "status": status,
                "cost": cost, "duration": round(duration), "quality": rec.final_quality,
                "upload": upload_service, "reason": failure_reason,
            })
        except Exception:
            pass

    def record_retry(self, scene_id: int, attempt: int, reason: str) -> None:
        try:
            # Only mutate an existing scene record; do NOT create a phantom record
            # for scene_id=0 (sentinel used when the caller doesn't know the scene)
            if scene_id in self.scenes:
                rec = self.scenes[scene_id]
                rec.attempts = max(rec.attempts, attempt)
                rec.retries.append({"attempt": attempt, "reason": reason})
            self._write_event({"event": "retry", "scene": scene_id,
                               "attempt": attempt, "reason": reason})
        except Exception:
            pass

    def record_quality_fallback(self, scene_id: int, from_q: str, to_q: str) -> None:
        try:
            # Only mutate an existing scene record; do NOT create a phantom record
            # for scene_id=0 (sentinel used when the caller doesn't know the scene)
            if scene_id in self.scenes:
                self.scenes[scene_id].quality_fallback = True
            self._write_event({"event": "quality_fallback", "scene": scene_id,
                               "from": from_q, "to": to_q})
        except Exception:
            pass

    def record_dead_task(self, task_id: str = "", stall_duration: float = 0.0,
                         scene_id: int = 0) -> None:
        """Record a dead/stalled Seedance task detection (v2.45)."""
        try:
            self._write_event({
                "event": "dead_task",
                "task_id": task_id,
                "scene": scene_id,
                "stall_duration": round(stall_duration),
            })
        except Exception:
            pass

    def record_backend_fallback(self, scene_id: int, from_backend: str,
                                 to_backend: str, reason: str = "") -> None:
        """Record a backend fallback event (v2.45) — e.g. Seedance → Veo."""
        try:
            self._write_event({
                "event": "backend_fallback",
                "scene": scene_id,
                "from": from_backend,
                "to": to_backend,
                "reason": reason,
            })
        except Exception:
            pass

    def record_image_risk(self, scene_id: int, risk_level: str,
                          reasons: list[str] | None = None) -> None:
        """Record an image risk analysis result (v2.45)."""
        try:
            self._write_event({
                "event": "image_risk",
                "scene": scene_id,
                "risk": risk_level,
                "reasons": reasons or [],
            })
        except Exception:
            pass

    def record_upload_fallback(self, scene_id: int, from_svc: str, to_svc: str) -> None:
        try:
            # Only mutate an existing scene record; do NOT create a phantom record
            # for scene_id=0 (sentinel used when the caller doesn't know the scene).
            # utils_upload.py passes scene_id=0 as a sentinel meaning "unknown scene".
            if scene_id in self.scenes:
                self.scenes[scene_id].upload_fallback = True
            self._write_event({"event": "upload_fallback", "scene": scene_id,
                               "from": from_svc, "to": to_svc})
        except Exception:
            pass

    def _write_run_end_event(self) -> None:
        ok = sum(1 for r in self.scenes.values() if r.status == "ok")
        fail = sum(1 for r in self.scenes.values() if r.status == "fail")
        total_cost = sum(r.cost_credits for r in self.scenes.values())
        total_dur = sum(r.duration_s for r in self.scenes.values())
        self._write_event({
            "event": "run_end",
            "total_cost": total_cost,
            "total_duration": round(total_dur),
            "success": ok,
            "failed": fail,
        })

    def print_report(self) -> None:
        """Print formatted run report to stdout."""
        self._write_run_end_event()

        scenes = sorted(self.scenes.values(), key=lambda r: r.scene_id)
        total_cost = sum(r.cost_credits for r in scenes)
        total_dur = sum(r.duration_s for r in scenes)
        ok_count = sum(1 for r in scenes if r.status == "ok")
        fail_count = sum(1 for r in scenes if r.status == "fail")
        avg_dur = total_dur / len(scenes) if scenes else 0

        # Collect all issues for summary line
        all_issues: dict[str, int] = {}
        for rec in scenes:
            for r in rec.retries:
                reason = r.get("reason", "unknown")
                all_issues[reason] = all_issues.get(reason, 0) + 1
            if rec.quality_fallback:
                all_issues["quality_fallback"] = all_issues.get("quality_fallback", 0) + 1

        header = f"{self.project} · {self.run_id} · {self.backend}/{self.quality}"
        width = max(76, len(header) + 8)

        def mins(s: float) -> str:
            m, sec = divmod(int(s), 60)
            return f"{m}m {sec}s" if m else f"{sec}s"

        print(f"\n╔══ Run Report: {header} {'═' * max(0, width - len(header) - 16)}╗")
        print(f"║ {'Scene':<5} │ {'Status':<6} │ {'Tries':<5} │ {'Time':>6} │ {'Cost':>6} │ {'Notes':<30} ║")
        print(f"║{'─'*7}┼{'─'*8}┼{'─'*7}┼{'─'*8}┼{'─'*8}┼{'─'*32}║")

        for rec in scenes:
            # Use text labels to avoid emoji double-width terminal alignment issues
            status_str = "ok  " if rec.status == "ok" else ("FAIL" if rec.status == "fail" else "----")
            notes = rec.notes[:30] if rec.notes else ""
            dur_str = mins(rec.duration_s)
            cost_str = f"{rec.cost_credits}cr"
            print(
                f"║ {rec.scene_id:<5} │ {status_str:<6} │ {rec.attempts:<5} │ "
                f"{dur_str:>6} │ {cost_str:>6} │ {notes:<30} ║"
            )

        print(f"╠{'═'*width}╣")

        summary = f"  {ok_count}/{len(scenes)} ok  │  {total_cost}cr  │  {mins(total_dur)} total  │  {mins(avg_dur)} avg/scene"
        print(f"║{summary:<{width}}║")

        if all_issues:
            issues_str = "  Issues: " + " · ".join(
                f"{r} ×{c}" if c > 1 else r for r, c in sorted(all_issues.items(), key=lambda x: -x[1])
            )
            print(f"║{issues_str:<{width}}║")

        print(f"╚{'═'*width}╝")

        if self._jsonl_path:
            print(f"  📄 JSONL: {self._jsonl_path}")
        print()

    def flush_to_sqlite(self, db_path: Path) -> None:
        """Write run summary to SQLite. Never raises — failures logged silently."""
        try:
            from datetime import datetime
            from db import VideoReplicatorDB

            db = VideoReplicatorDB(db_path=db_path)
            scenes = list(self.scenes.values())
            ok_count = sum(1 for r in scenes if r.status == "ok")
            fail_count = sum(1 for r in scenes if r.status == "fail")
            total_credits = sum(r.cost_credits for r in scenes)
            total_dur = sum(r.duration_s for r in scenes)

            db.add_run_telemetry(
                project_slug=self.project,
                run_id=self.run_id,
                backend=self.backend,
                started_at=datetime.fromtimestamp(self.started_at).isoformat(),
                completed_at=datetime.now().isoformat(),
                total_scenes=len(scenes),
                success_count=ok_count,
                failed_count=fail_count,
                total_credits=total_credits,
                total_duration_s=total_dur,
                jsonl_path=str(self._jsonl_path) if self._jsonl_path else "",
            )
        except Exception as e:
            print(f"  ⚠️  Telemetry SQLite flush failed (non-fatal): {e}")

    def close(self) -> None:
        """Close the JSONL file handle if open."""
        try:
            if self._jsonl_file:
                self._jsonl_file.close()
                self._jsonl_file = None
        except Exception:
            pass
