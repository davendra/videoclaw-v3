#!/usr/bin/env python3
"""
Extend Chain — Continuous Video Extension via useapi.net.

Generates an initial video (T2V, I2V, or R2V) then keeps extending it N times
using useapi.net's /videos/extend endpoint. Each extension adds ~8s of continuous
video that picks up from where the previous segment left off.

Usage:
    # T2V + 4 extensions (~36s total)
    python extend_chain.py \\
      --product "my-project" \\
      --prompt "A serene mountain landscape at sunset" \\
      --extend-prompts '["Camera pans right","Zoom into pool","Underwater","Rise"]' \\
      --quality fast --ratio landscape --yes

    # I2V start + auto-repeat 5 times
    python extend_chain.py \\
      --product "my-project" \\
      --prompt "Continuous drone footage over mountains" \\
      --start-image "projects/my-project/images/hero.jpg" \\
      --extend-count 5 --quality fast --yes

    # Resume from broken chain
    python extend_chain.py --product "my-project" --resume

    # Dry-run to see cost
    python extend_chain.py --product "my-project" --prompt "Sunset" \\
      --extend-count 3 --dry-run
"""

import argparse
import json
import mimetypes
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from config import (
    COST_PER_CREDIT,
    CREDITS_PER_VIDEO,
    EXTEND_CHAIN_OVERLAP_TRIM,
    EXTEND_CHAIN_SEGMENT_DURATION,
    MIN_VIDEO_SIZE_BYTES,
    PROJECT_BASE,
    USEAPI_ASSETS_URL,
    USEAPI_CONCAT_URL,
    USEAPI_DOWNLOAD_TIMEOUT,
    USEAPI_EXTEND_URL,
    USEAPI_GENERATION_TIMEOUT,
    USEAPI_JOBS_URL,
    USEAPI_MAX_POLL_TIME,
    USEAPI_MODEL_MAP,
    USEAPI_POLL_INTERVAL,
    USEAPI_REQUEST_TIMEOUT,
    USEAPI_VIDEOS_URL,
)
from exceptions import APIError, ValidationError
from logging_config import ProgressLogger, setup_logging

logger = setup_logging(__name__)


# ============================================================================
# useapi.net REST helpers
# ============================================================================


def _get_auth() -> tuple[str, str]:
    """Read USEAPI_API_TOKEN and USEAPI_ACCOUNT_EMAIL from environment."""
    token = os.environ.get("USEAPI_API_TOKEN", "")
    email = os.environ.get("USEAPI_ACCOUNT_EMAIL", "")
    if not token:
        raise APIError(
            "USEAPI_API_TOKEN not set. Get one at https://useapi.net"
        )
    if not email:
        raise APIError(
            "USEAPI_ACCOUNT_EMAIL not set. Set the Google account email for useapi."
        )
    return token, email


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _extract_media_gen_id(response: dict) -> str:
    """Extract mediaGenerationId from useapi response."""
    ops = response.get("operations", [])
    if ops:
        # Try shorthand first
        mgid = ops[0].get("mediaGenerationId")
        if mgid:
            return mgid if isinstance(mgid, str) else mgid.get("mediaGenerationId", "")
        # Try nested path
        mgid = (
            ops[0]
            .get("operation", {})
            .get("metadata", {})
            .get("video", {})
            .get("mediaGenerationId", "")
        )
        if mgid:
            return mgid
    raise APIError(f"No mediaGenerationId in response: {json.dumps(response)[:300]}")


def _extract_fife_url(response: dict) -> str:
    """Extract signed video download URL from useapi response."""
    ops = response.get("operations", [])
    if ops:
        url = (
            ops[0]
            .get("operation", {})
            .get("metadata", {})
            .get("video", {})
            .get("fifeUrl", "")
        )
        if url:
            return url
    raise APIError(f"No fifeUrl in response: {json.dumps(response)[:300]}")


def _poll_job(token: str, job_id: str) -> dict:
    """Poll a useapi job until completion."""
    elapsed = 0
    logger.info("[useapi] Polling job %s (every %ds, max %ds)...",
                job_id, USEAPI_POLL_INTERVAL, USEAPI_MAX_POLL_TIME)

    while elapsed < USEAPI_MAX_POLL_TIME:
        try:
            resp = requests.get(
                f"{USEAPI_JOBS_URL}/{job_id}",
                headers=_headers(token),
                timeout=USEAPI_REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            logger.warning("[useapi] Poll error (%ds): %s", elapsed, e)
            time.sleep(USEAPI_POLL_INTERVAL)
            elapsed += USEAPI_POLL_INTERVAL
            continue

        if resp.status_code != 200:
            logger.warning("[useapi] Poll HTTP %d (%ds)", resp.status_code, elapsed)
            time.sleep(USEAPI_POLL_INTERVAL)
            elapsed += USEAPI_POLL_INTERVAL
            continue

        data = resp.json()
        status = data.get("status", "unknown")

        if status == "completed":
            # Return the full response including operations
            return data.get("response", data)

        if status == "failed":
            error = data.get("error", "Unknown error")
            raise APIError(f"Job failed: {error}")

        logger.info("[useapi] %ds — status: %s", elapsed, status)
        time.sleep(USEAPI_POLL_INTERVAL)
        elapsed += USEAPI_POLL_INTERVAL

    raise TimeoutError(f"Job {job_id} timed out after {USEAPI_MAX_POLL_TIME}s")


def upload_image(image_path: str, token: str, email: str) -> str:
    """Upload a local image to useapi.net, returns mediaGenerationId."""
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")

    mime, _ = mimetypes.guess_type(image_path)
    if mime not in ("image/png", "image/jpeg"):
        # Default to PNG for unknown types
        mime = "image/png"

    logger.info("[useapi] Uploading %s (%s)...", os.path.basename(image_path), mime)

    with open(image_path, "rb") as f:
        image_data = f.read()

    resp = requests.post(
        f"{USEAPI_ASSETS_URL}/{email}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": mime,
        },
        data=image_data,
        timeout=60,
    )

    if resp.status_code != 200:
        raise APIError(f"Image upload failed: HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    mgid = data.get("mediaGenerationId", "")
    # useapi may nest: {"mediaGenerationId": {"mediaGenerationId": "user:..."}}
    if isinstance(mgid, dict):
        mgid = mgid.get("mediaGenerationId", "")
    if not mgid:
        raise APIError(f"No mediaGenerationId from upload: {json.dumps(data)[:300]}")

    logger.info("[useapi] Uploaded: %s", mgid[:60])
    return mgid


def generate_initial(
    prompt: str,
    token: str,
    email: str,
    model: str,
    aspect_ratio: str,
    start_image_id: str | None = None,
    reference_image_ids: list[str] | None = None,
) -> dict:
    """Generate the initial video. Returns full response dict."""
    payload: dict = {
        "prompt": prompt,
        "model": model,
        "aspectRatio": aspect_ratio,
        "count": 1,
        "email": email,
    }

    if start_image_id:
        payload["startImage"] = start_image_id

    if reference_image_ids:
        for i, rid in enumerate(reference_image_ids[:3], 1):
            payload[f"referenceImage_{i}"] = rid

    logger.info("[useapi] Generating initial video: %s...", prompt[:80])
    logger.info("[useapi] Model: %s, Ratio: %s", model, aspect_ratio)

    resp = requests.post(
        USEAPI_VIDEOS_URL,
        json=payload,
        headers=_headers(token),
        timeout=USEAPI_GENERATION_TIMEOUT,
    )

    if resp.status_code == 200:
        return resp.json()
    elif resp.status_code == 201:
        # Async — poll for result
        data = resp.json()
        job_id = data.get("jobId", "")
        if not job_id:
            raise APIError(f"No jobId in 201 response: {resp.text[:300]}")
        return _poll_job(token, job_id)
    else:
        raise APIError(f"Generate failed: HTTP {resp.status_code}: {resp.text[:500]}")


def extend_segment(
    media_gen_id: str,
    prompt: str,
    token: str,
    model: str,
) -> dict:
    """Extend a video from its mediaGenerationId. Returns full response dict."""
    payload = {
        "mediaGenerationId": media_gen_id,
        "prompt": prompt,
        "model": model,
        "count": 1,
    }

    logger.info("[useapi] Extending video: %s...", prompt[:80])

    resp = requests.post(
        USEAPI_EXTEND_URL,
        json=payload,
        headers=_headers(token),
        timeout=USEAPI_GENERATION_TIMEOUT,
    )

    if resp.status_code == 200:
        return resp.json()
    elif resp.status_code == 201:
        data = resp.json()
        job_id = data.get("jobId", "")
        if not job_id:
            raise APIError(f"No jobId in 201 response: {resp.text[:300]}")
        return _poll_job(token, job_id)
    else:
        raise APIError(f"Extend failed: HTTP {resp.status_code}: {resp.text[:500]}")


def download_video(url: str, output_path: str) -> str:
    """Download video from fifeUrl to local file."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    logger.info("[useapi] Downloading to %s...", output_path)

    try:
        resp = requests.get(url, stream=True, timeout=USEAPI_DOWNLOAD_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise APIError(f"Download failed: {e}") from e

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    file_size = os.path.getsize(output_path)
    if file_size < MIN_VIDEO_SIZE_BYTES:
        os.remove(output_path)
        raise APIError(f"Downloaded video too small ({file_size} bytes), likely corrupt")

    logger.info("[useapi] Downloaded: %s (%.1fMB)", output_path, file_size / 1024 / 1024)
    return output_path


# ============================================================================
# Concatenation
# ============================================================================


def concatenate_segments(
    segment_paths: list[str],
    output_path: str,
    overlap_trim: float = EXTEND_CHAIN_OVERLAP_TRIM,
    *,
    token: str = "",
    media_gen_ids: list[str] | None = None,
) -> str:
    """Concatenate segments via useapi.net server-side concat API.

    Uses POST /google-flow/videos/concatenate with trimStart on extension
    segments to remove the ~1s overlap where the last frame of segment N
    repeats as the first frame of segment N+1.

    Falls back to local FFmpeg concat if API call fails or no mediaGenerationIds.

    Args:
        segment_paths: Local video file paths (for fallback + single-segment copy).
        output_path: Where to write the final concatenated video.
        overlap_trim: Seconds to trim from start of each extension segment.
        token: useapi.net API token (needed for server-side concat).
        media_gen_ids: List of mediaGenerationIds matching segment_paths.
    """
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    if len(segment_paths) == 1:
        import shutil
        shutil.copy2(segment_paths[0], output_path)
        return output_path

    # Try server-side concat via useapi.net (preferred — handles overlap trimming)
    if token and media_gen_ids and len(media_gen_ids) == len(segment_paths):
        try:
            return _concat_via_api(
                media_gen_ids, output_path, overlap_trim, token
            )
        except Exception as e:
            logger.warning("[concat] API concat failed: %s — falling back to FFmpeg", e)

    # Fallback: local FFmpeg concat
    return _concat_via_ffmpeg(segment_paths, output_path, overlap_trim)


def _concat_via_api(
    media_gen_ids: list[str],
    output_path: str,
    overlap_trim: float,
    token: str,
) -> str:
    """Server-side concatenation via useapi.net /videos/concatenate.

    - No CAPTCHA required
    - Returns base64 encoded video
    - trimStart on extension segments removes overlap frames
    """
    media_items: list[dict] = []
    for i, mgid in enumerate(media_gen_ids):
        item: dict = {"mediaGenerationId": mgid}
        if i > 0 and overlap_trim > 0:
            item["trimStart"] = overlap_trim
        media_items.append(item)

    logger.info("[concat] Server-side concat: %d segments (trimStart=%.1fs on extensions)",
                len(media_items), overlap_trim)

    resp = requests.post(
        USEAPI_CONCAT_URL,
        json={"media": media_items},
        headers=_headers(token),
        timeout=180,  # API docs say 15-20s but allow margin
    )

    if resp.status_code != 200:
        raise APIError(f"Concat API failed: HTTP {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    status = data.get("status", "")
    if "FAILED" in status:
        raise APIError(f"Concat API returned failure: {data.get('error', status)}")

    encoded_video = data.get("encodedVideo", "")
    if not encoded_video:
        raise APIError("Concat API returned no encodedVideo")

    # Decode base64 video and save
    import base64
    video_bytes = base64.b64decode(encoded_video)
    if len(video_bytes) < MIN_VIDEO_SIZE_BYTES:
        raise APIError(f"Concat result too small: {len(video_bytes)} bytes")

    with open(output_path, "wb") as f:
        f.write(video_bytes)

    logger.info("[concat] Final video: %s (%.1fMB)", output_path,
                len(video_bytes) / (1024 * 1024))
    return output_path


def _concat_via_ffmpeg(
    segment_paths: list[str],
    output_path: str,
    overlap_trim: float,
) -> str:
    """Fallback local FFmpeg concat with overlap trimming."""
    from ffmpeg_wrapper import FFmpegWrapper

    ff = FFmpegWrapper()

    # Trim overlap from extensions (segments 1+)
    trimmed_paths: list[str] = [segment_paths[0]]
    for i, seg_path in enumerate(segment_paths[1:], 1):
        trimmed = seg_path.replace(".mp4", "_trimmed.mp4")
        try:
            ff.run([
                "-ss", f"{overlap_trim:.2f}",
                "-i", seg_path,
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                trimmed,
            ])
            trimmed_paths.append(trimmed)
        except Exception as e:
            logger.warning("[concat] Trim failed for segment %d: %s — using untrimmed", i, e)
            trimmed_paths.append(seg_path)

    # Build concat list file
    concat_list = output_path.replace(".mp4", "_concat.txt")
    with open(concat_list, "w") as f:
        for p in trimmed_paths:
            f.write(f"file '{os.path.abspath(p)}'\n")

    try:
        ff.run([
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list,
            "-c", "copy",
            output_path,
        ])
    finally:
        os.remove(concat_list)
        for p in trimmed_paths[1:]:
            if p.endswith("_trimmed.mp4") and os.path.exists(p):
                os.remove(p)

    if not os.path.exists(output_path) or os.path.getsize(output_path) < MIN_VIDEO_SIZE_BYTES:
        raise APIError(f"Concatenation produced invalid output: {output_path}")

    logger.info("[concat] Final video: %s", output_path)
    return output_path


# ============================================================================
# Metadata persistence
# ============================================================================


def _metadata_path(project_dir: str) -> str:
    return os.path.join(project_dir, "extend_chain_metadata.json")


def save_metadata(project_dir: str, metadata: dict) -> None:
    os.makedirs(project_dir, exist_ok=True)
    path = _metadata_path(project_dir)
    with open(path, "w") as f:
        json.dump(metadata, f, indent=2)
    logger.info("[metadata] Saved to %s", path)


def load_metadata(project_dir: str) -> dict | None:
    path = _metadata_path(project_dir)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


# ============================================================================
# Run prefix detection
# ============================================================================


def _detect_run_id(videos_dir: str) -> str:
    """Detect the next available run ID from existing files."""
    if not os.path.exists(videos_dir):
        return "run001"

    existing = [
        f for f in os.listdir(videos_dir)
        if f.startswith("run") and "_extend_" in f
    ]
    if not existing:
        # Check for any run-prefixed files
        all_runs = set()
        for f in os.listdir(videos_dir):
            if f.startswith("run") and "_" in f:
                run = f.split("_")[0]
                all_runs.add(run)
        if all_runs:
            latest = sorted(all_runs)[-1]
            num = int(latest.replace("run", ""))
            return f"run{num + 1:03d}"
        return "run001"

    runs = set()
    for f in existing:
        run = f.split("_")[0]
        runs.add(run)
    latest = sorted(runs)[-1]
    num = int(latest.replace("run", ""))
    return f"run{num + 1:03d}"


# ============================================================================
# Main orchestrator
# ============================================================================


def build_cost_estimate(quality: str, num_extensions: int) -> dict:
    """Calculate cost estimate for the chain."""
    credits_per = CREDITS_PER_VIDEO.get(quality, 10)
    total_generations = 1 + num_extensions
    total_credits = credits_per * total_generations
    total_usd = total_credits * COST_PER_CREDIT
    total_duration = EXTEND_CHAIN_SEGMENT_DURATION + (
        num_extensions * (EXTEND_CHAIN_SEGMENT_DURATION - EXTEND_CHAIN_OVERLAP_TRIM)
    )
    return {
        "quality": quality,
        "credits_per_generation": credits_per,
        "total_generations": total_generations,
        "total_credits": total_credits,
        "total_usd": round(total_usd, 2),
        "estimated_duration_seconds": total_duration,
    }


def run_chain(args: argparse.Namespace) -> str | None:
    """Execute the extend chain. Returns path to final concatenated video, or None on error."""
    project_dir = os.path.join(PROJECT_BASE, args.product)
    videos_dir = os.path.join(project_dir, "videos")
    final_dir = os.path.join(project_dir, "final")

    # Resolve extend prompts
    if args.extend_prompts:
        extend_prompts = json.loads(args.extend_prompts)
        num_extensions = len(extend_prompts)
    elif args.extend_count:
        num_extensions = args.extend_count
        extend_prompts = [args.prompt] * num_extensions
    else:
        raise ValidationError("Provide --extend-prompts or --extend-count")

    model = USEAPI_MODEL_MAP.get(args.quality, "veo-3.1-fast")
    aspect_ratio = args.ratio

    # Cost estimate
    cost = build_cost_estimate(args.quality, num_extensions)
    logger.info("=== Extend Chain Plan ===")
    logger.info("  Product:      %s", args.product)
    logger.info("  Quality:      %s (%s)", args.quality, model)
    logger.info("  Ratio:        %s", aspect_ratio)
    logger.info("  Initial:      %s", args.prompt[:80])
    logger.info("  Extensions:   %d", num_extensions)
    logger.info("  Est. duration: %.0fs", cost["estimated_duration_seconds"])
    logger.info("  Est. cost:    %d credits ($%.2f)", cost["total_credits"], cost["total_usd"])

    if args.start_image:
        logger.info("  Start image:  %s", args.start_image)
    if args.reference_images:
        logger.info("  References:   %s", args.reference_images)

    for i, ep in enumerate(extend_prompts):
        logger.info("  Extension %d:  %s", i + 1, ep[:60])

    if args.dry_run:
        logger.info("=== DRY RUN — no API calls ===")
        print(json.dumps(cost, indent=2))
        return None

    if not args.yes:
        confirm = input("\nProceed? [y/N] ").strip().lower()
        if confirm not in ("y", "yes"):
            logger.info("Cancelled.")
            return None

    # Auth
    token, email = _get_auth()
    run_id = _detect_run_id(videos_dir)
    os.makedirs(videos_dir, exist_ok=True)
    os.makedirs(final_dir, exist_ok=True)

    # Metadata
    metadata: dict = {
        "product": args.product,
        "run": run_id,
        "quality": args.quality,
        "ratio": aspect_ratio,
        "overlap_trim": args.overlap_trim,
        "segments": [],
    }

    progress = ProgressLogger(total=1 + num_extensions, prefix="Generating")
    segment_paths: list[str] = []

    try:
        # Upload images if needed
        start_image_id = None
        reference_image_ids = None

        if args.start_image:
            start_image_id = upload_image(args.start_image, token, email)

        if args.reference_images:
            ref_paths = [p.strip() for p in args.reference_images.split(",")]
            reference_image_ids = [
                upload_image(p, token, email) for p in ref_paths
            ]

        # Step 1: Initial generation
        progress.step("initial video")
        result = generate_initial(
            prompt=args.prompt,
            token=token,
            email=email,
            model=model,
            aspect_ratio=aspect_ratio,
            start_image_id=start_image_id,
            reference_image_ids=reference_image_ids,
        )

        media_gen_id = _extract_media_gen_id(result)
        fife_url = _extract_fife_url(result)
        seg_path = os.path.join(videos_dir, f"{run_id}_extend_seg_0.mp4")
        download_video(fife_url, seg_path)
        segment_paths.append(seg_path)

        metadata["segments"].append({
            "index": 0,
            "type": "initial",
            "prompt": args.prompt,
            "mediaGenerationId": media_gen_id,
            "video_path": seg_path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        save_metadata(project_dir, metadata)

        # Steps 2..N: Extensions
        current_mgid = media_gen_id
        for i, ext_prompt in enumerate(extend_prompts):
            progress.step(f"extension {i + 1}/{num_extensions}")
            result = extend_segment(
                media_gen_id=current_mgid,
                prompt=ext_prompt,
                token=token,
                model=model,
            )

            new_mgid = _extract_media_gen_id(result)
            fife_url = _extract_fife_url(result)
            seg_path = os.path.join(videos_dir, f"{run_id}_extend_seg_{i + 1}.mp4")
            download_video(fife_url, seg_path)
            segment_paths.append(seg_path)

            metadata["segments"].append({
                "index": i + 1,
                "type": "extend",
                "prompt": ext_prompt,
                "mediaGenerationId": new_mgid,
                "video_path": seg_path,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            save_metadata(project_dir, metadata)
            current_mgid = new_mgid

    except (APIError, TimeoutError) as e:
        logger.error("Chain failed at segment %d: %s", len(segment_paths), e)
        logger.info("Resume with: python extend_chain.py --product %s --resume", args.product)
        save_metadata(project_dir, metadata)
        return None

    # Concatenation
    if args.no_concat:
        logger.info("Skipping concatenation (--no-concat). Segments in %s", videos_dir)
        return segment_paths[-1]

    output_path = os.path.join(final_dir, f"{run_id}_extended_chain.mp4")
    media_gen_ids = [s["mediaGenerationId"] for s in metadata["segments"]]
    logger.info("Concatenating %d segments (overlap trim: %.1fs)...",
                len(segment_paths), args.overlap_trim)

    try:
        concatenate_segments(
            segment_paths, output_path, args.overlap_trim,
            token=token, media_gen_ids=media_gen_ids,
        )
    except Exception as e:
        logger.error("Concatenation failed: %s", e)
        logger.info("Segments are preserved in %s — concatenate manually.", videos_dir)
        return None

    # Final summary
    from ffmpeg_wrapper import FFmpegWrapper
    ff = FFmpegWrapper()
    duration = ff.get_duration(output_path)
    size_mb = os.path.getsize(output_path) / 1024 / 1024

    logger.info("=== Extend Chain Complete ===")
    logger.info("  Output:    %s", output_path)
    logger.info("  Duration:  %.1fs", duration or 0)
    logger.info("  Size:      %.1fMB", size_mb)
    logger.info("  Segments:  %d", len(segment_paths))
    logger.info("  Cost:      %d credits ($%.2f)", cost["total_credits"], cost["total_usd"])

    metadata["final_output"] = output_path
    metadata["final_duration"] = duration
    save_metadata(project_dir, metadata)

    return output_path


def run_resume(args: argparse.Namespace) -> str | None:
    """Resume a broken chain from metadata."""
    project_dir = os.path.join(PROJECT_BASE, args.product)
    metadata = load_metadata(project_dir)

    if not metadata:
        logger.error("No extend_chain_metadata.json found in %s", project_dir)
        return None

    segments = metadata.get("segments", [])
    if not segments:
        logger.error("No segments in metadata — nothing to resume")
        return None

    last_seg = segments[-1]
    last_mgid = last_seg.get("mediaGenerationId", "")
    last_index = last_seg.get("index", 0)

    logger.info("Resuming from segment %d (mediaGenerationId: %s...)",
                last_index, last_mgid[:40])

    # Determine remaining extensions
    if args.extend_prompts:
        all_prompts = json.loads(args.extend_prompts)
    elif args.extend_count:
        all_prompts = [args.prompt or metadata.get("segments", [{}])[0].get("prompt", "")] * args.extend_count
    else:
        logger.error("Provide --extend-prompts or --extend-count for remaining extensions")
        return None

    remaining_prompts = all_prompts[last_index:]
    if not remaining_prompts:
        logger.info("All extensions already completed. Proceeding to concatenation.")
    else:
        logger.info("Remaining extensions: %d", len(remaining_prompts))

    token, email = _get_auth()
    model = USEAPI_MODEL_MAP.get(metadata.get("quality", "fast"), "veo-3.1-fast")
    run_id = metadata["run"]
    videos_dir = os.path.join(project_dir, "videos")
    final_dir = os.path.join(project_dir, "final")

    current_mgid = last_mgid
    segment_paths = [s["video_path"] for s in segments]
    progress = ProgressLogger(total=len(remaining_prompts), prefix="Extending")

    try:
        for i, ext_prompt in enumerate(remaining_prompts):
            seg_index = last_index + 1 + i
            progress.step(f"extension {seg_index}")

            result = extend_segment(
                media_gen_id=current_mgid,
                prompt=ext_prompt,
                token=token,
                model=model,
            )

            new_mgid = _extract_media_gen_id(result)
            fife_url = _extract_fife_url(result)
            seg_path = os.path.join(videos_dir, f"{run_id}_extend_seg_{seg_index}.mp4")
            download_video(fife_url, seg_path)
            segment_paths.append(seg_path)

            metadata["segments"].append({
                "index": seg_index,
                "type": "extend",
                "prompt": ext_prompt,
                "mediaGenerationId": new_mgid,
                "video_path": seg_path,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            save_metadata(project_dir, metadata)
            current_mgid = new_mgid

    except (APIError, TimeoutError) as e:
        logger.error("Resume failed at segment %d: %s", len(segment_paths), e)
        save_metadata(project_dir, metadata)
        return None

    # Concatenation
    overlap_trim = metadata.get("overlap_trim", EXTEND_CHAIN_OVERLAP_TRIM)
    if args.no_concat:
        logger.info("Segments preserved in %s", videos_dir)
        return segment_paths[-1]

    output_path = os.path.join(final_dir, f"{run_id}_extended_chain.mp4")
    media_gen_ids = [s["mediaGenerationId"] for s in metadata["segments"]]
    try:
        concatenate_segments(
            segment_paths, output_path, overlap_trim,
            token=token, media_gen_ids=media_gen_ids,
        )
    except Exception as e:
        logger.error("Concatenation failed: %s", e)
        return None

    metadata["final_output"] = output_path
    save_metadata(project_dir, metadata)
    logger.info("=== Resume Complete: %s ===", output_path)
    return output_path


# ============================================================================
# CLI
# ============================================================================


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Extend Chain — continuous video extension via useapi.net",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    p.add_argument("--product", required=True, help="Project name for output directory")
    p.add_argument("--prompt", help="Initial video prompt")

    # Extension specification (one required unless --resume)
    ext = p.add_mutually_exclusive_group()
    ext.add_argument("--extend-prompts", help="JSON array of prompts, one per extension")
    ext.add_argument("--extend-count", type=int, help="Number of extensions (repeats initial prompt)")

    # Start mode
    p.add_argument("--start-image", help="Path to start frame for I2V")
    p.add_argument("--reference-images", help="Comma-separated paths for R2V")

    # Generation settings
    p.add_argument("--quality", default="fast", choices=["fast", "quality", "free"],
                   help="Quality tier (default: fast)")
    p.add_argument("--ratio", default="landscape", choices=["landscape", "portrait"],
                   help="Aspect ratio (default: landscape)")
    p.add_argument("--overlap-trim", type=float, default=EXTEND_CHAIN_OVERLAP_TRIM,
                   help=f"Seconds to trim from extension starts (default: {EXTEND_CHAIN_OVERLAP_TRIM})")

    # Flow control
    p.add_argument("--no-concat", action="store_true", help="Keep segments separate, skip concatenation")
    p.add_argument("--dry-run", action="store_true", help="Show plan without API calls")
    p.add_argument("--resume", action="store_true", help="Resume from metadata")
    p.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")

    args = p.parse_args(argv)

    # Validation
    if not args.resume and not args.prompt:
        p.error("--prompt is required (unless --resume)")

    if not args.resume and not args.dry_run:
        if not args.extend_prompts and not args.extend_count:
            p.error("Provide --extend-prompts or --extend-count")

    if args.extend_count is not None and args.extend_count < 1:
        p.error("--extend-count must be >= 1")

    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        if args.resume:
            result = run_resume(args)
        else:
            result = run_chain(args)

        if result:
            print(f"\nOutput: {result}")
            return 0
        elif args.dry_run:
            return 0
        else:
            return 1

    except (APIError, ValidationError) as e:
        logger.error("Error: %s", e)
        return 1
    except KeyboardInterrupt:
        logger.info("\nInterrupted.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
