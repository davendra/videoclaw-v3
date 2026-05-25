#!/usr/bin/env python3
"""
Seedance 2.0 Task Status CLI.

Check, watch, and cancel Seedance video generation tasks without running
the full pipeline. Useful for monitoring long-running tasks or recovering
task outputs.

Usage:
    # Query a task's current status
    python seedance_task_status.py query <task_id>
    python seedance_task_status.py query <task_id> --download output.mp4

    # Watch a task until completion (live progress)
    python seedance_task_status.py watch <task_id>
    python seedance_task_status.py watch <task_id> --download output.mp4

    # Cancel a running task
    python seedance_task_status.py cancel <task_id>

Requires: SUTUI_API_KEY environment variable
"""

import argparse
import json
import sys
import time

import requests

from config import (
    SEEDANCE_CANCEL_URL,
    SEEDANCE_MAX_POLL_TIME,
    SEEDANCE_POLL_INTERVAL,
    SEEDANCE_QUERY_URL,
)
from logging_config import setup_logging
from seedance_backend import (
    _download_video,
    _extract_video_url,
    _get_api_key,
    _get_headers,
)

logger = setup_logging(__name__)


def query_task(task_id: str, download_path: str | None = None) -> dict:
    """Query a single task's status.

    Args:
        task_id: Seedance task ID
        download_path: Optional path to download completed video

    Returns:
        Task status dict with keys: status, task_id, video_url, error
    """
    api_key = _get_api_key()

    try:
        resp = requests.post(
            SEEDANCE_QUERY_URL,
            json={"task_id": task_id},
            headers=_get_headers(api_key),
            timeout=30,
        )
    except requests.RequestException as e:
        return {"status": "error", "task_id": task_id, "error": f"Network error: {e}"}

    if resp.status_code != 200:
        return {"status": "error", "task_id": task_id, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}

    result = resp.json()
    data = result.get("data", {})
    status = data.get("status", "unknown")

    output = {
        "status": status,
        "task_id": task_id,
        "video_url": None,
        "error": None,
    }

    if status == "completed":
        try:
            video_url = _extract_video_url(result)
            output["video_url"] = video_url
            if download_path:
                _download_video(video_url, download_path)
                output["downloaded_to"] = download_path
        except Exception as e:
            output["error"] = f"Video extraction failed: {e}"

    elif status == "failed":
        error_msg = (
            data.get("output", {}).get("error", "")
            or data.get("error", "Unknown error")
        )
        output["error"] = error_msg

    return output


def watch_task(task_id: str, download_path: str | None = None) -> dict:
    """Watch a task until completion with live progress.

    Args:
        task_id: Seedance task ID
        download_path: Optional path to download completed video

    Returns:
        Final task status dict
    """
    api_key = _get_api_key()
    elapsed = 0

    logger.info("Watching task %s (max %ds)...", task_id, SEEDANCE_MAX_POLL_TIME)

    while elapsed < SEEDANCE_MAX_POLL_TIME:
        try:
            resp = requests.post(
                SEEDANCE_QUERY_URL,
                json={"task_id": task_id},
                headers=_get_headers(api_key),
                timeout=30,
            )
        except requests.RequestException as e:
            logger.warning("[%ds] Network error: %s", elapsed, e)
            time.sleep(SEEDANCE_POLL_INTERVAL)
            elapsed += SEEDANCE_POLL_INTERVAL
            continue

        if resp.status_code != 200:
            logger.warning("[%ds] HTTP %d", elapsed, resp.status_code)
            time.sleep(SEEDANCE_POLL_INTERVAL)
            elapsed += SEEDANCE_POLL_INTERVAL
            continue

        result = resp.json()
        data = result.get("data", {})
        status = data.get("status", "unknown")
        progress = data.get("progress", "")

        progress_str = f" ({progress})" if progress else ""
        logger.info("[%ds] Status: %s%s", elapsed, status, progress_str)

        if status == "completed":
            output = {"status": "completed", "task_id": task_id}
            try:
                video_url = _extract_video_url(result)
                output["video_url"] = video_url
                logger.info("Task completed! Video URL: %s", video_url)
                if download_path:
                    _download_video(video_url, download_path)
                    output["downloaded_to"] = download_path
                    logger.info("Downloaded to: %s", download_path)
            except Exception as e:
                output["error"] = f"Video extraction failed: {e}"
            return output

        if status == "failed":
            error_msg = (
                data.get("output", {}).get("error", "")
                or data.get("error", "Unknown error")
            )
            logger.error("Task failed: %s", error_msg)
            return {"status": "failed", "task_id": task_id, "error": error_msg}

        time.sleep(SEEDANCE_POLL_INTERVAL)
        elapsed += SEEDANCE_POLL_INTERVAL

    logger.error("Timed out after %ds", SEEDANCE_MAX_POLL_TIME)
    return {"status": "timeout", "task_id": task_id, "error": f"Timed out after {SEEDANCE_MAX_POLL_TIME}s"}


def cancel_task(task_id: str) -> dict:
    """Attempt to cancel a running task.

    Note: The Seedance API may not support cancellation. This handles
    404 gracefully with a clear message.

    Args:
        task_id: Seedance task ID

    Returns:
        Cancellation result dict
    """
    api_key = _get_api_key()

    try:
        resp = requests.post(
            SEEDANCE_CANCEL_URL,
            json={"task_id": task_id},
            headers=_get_headers(api_key),
            timeout=30,
        )
    except requests.RequestException as e:
        return {"status": "error", "task_id": task_id, "error": f"Network error: {e}"}

    if resp.status_code == 404:
        return {
            "status": "unsupported",
            "task_id": task_id,
            "error": "Cancel not supported by the Seedance API. Task will continue running.",
        }

    if resp.status_code == 200:
        return {"status": "cancelled", "task_id": task_id}

    return {
        "status": "error",
        "task_id": task_id,
        "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seedance 2.0 Task Status -- query, watch, or cancel tasks",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # query
    p_query = subparsers.add_parser("query", help="Query a task's current status")
    p_query.add_argument("task_id", help="Seedance task ID")
    p_query.add_argument("--download", default=None, help="Download video to this path if completed")

    # watch
    p_watch = subparsers.add_parser("watch", help="Watch a task until completion")
    p_watch.add_argument("task_id", help="Seedance task ID")
    p_watch.add_argument("--download", default=None, help="Download video to this path when completed")

    # cancel
    p_cancel = subparsers.add_parser("cancel", help="Cancel a running task")
    p_cancel.add_argument("task_id", help="Seedance task ID")

    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")

    args = parser.parse_args()

    if hasattr(args, "verbose") and args.verbose:
        global logger
        logger = setup_logging(__name__, verbose=True)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "query":
        result = query_task(args.task_id, download_path=args.download)
    elif args.command == "watch":
        result = watch_task(args.task_id, download_path=args.download)
    elif args.command == "cancel":
        result = cancel_task(args.task_id)
    else:
        parser.print_help()
        sys.exit(1)

    # Print result as formatted JSON
    print(json.dumps(result, indent=2))

    # Exit code: 0 for success, 1 for failure
    if result.get("status") in ("completed", "cancelled"):
        sys.exit(0)
    elif result.get("status") == "unsupported":
        sys.exit(0)  # Not an error per se
    else:
        sys.exit(1 if result.get("error") else 0)


if __name__ == "__main__":
    main()
