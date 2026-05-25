#!/usr/bin/env python3
"""
Media file upload and URL caching for Seedance backend.

Seedance requires publicly accessible URLs for all media inputs.
This module uploads local files to a public host and caches the resulting
URLs keyed by file content hash to avoid redundant uploads.

Upload chain (tries in order):
    1. xskill.ai MCP  — SSE + JSON-RPC, CDN on cdn-video.51sux.com (GUARANTEED accessible)
    2. xskill.ai REST — if SUTUI_API_KEY is set (broken/404 since 2026-02-14, kept as fallback)
    3. uguu.se   — no key needed, China-accessible, images + audio (temporary files)
    4. imgbb.com  — if IMGBB_API_KEY is set (reliable, China-accessible, images only)
    5. catbox.moe — no API key needed, but NOT accessible from Chinese servers

xskill.ai MCP upload is preferred because it outputs URLs on cdn-video.51sux.com —
the SAME CDN that Seedance uses for its own outputs. This guarantees accessibility
from Seedance's Chinese GPU infrastructure and prevents silent task rejections
(status 20 stuck in processing) caused by inaccessible image URLs.

uguu.se (d.uguu.se) is the secondary fallback: tested and confirmed accessible from
Seedance's Chinese infrastructure. Files are temporary but persist long enough
for Seedance task processing. Supports images, audio, and video uploads.

Usage:
    from utils_upload import ensure_urls, upload_file

    urls = ensure_urls(["path/to/image.jpg", "path/to/audio.mp3"])
    url = upload_file("path/to/video.mp4", project_path="projects/my-project")
"""

import base64
import hashlib
import json
import os
import tempfile
import time
from urllib.parse import urlparse

import requests

import telemetry as _telemetry

from config import (
    CATBOX_UPLOAD_URL,
    SEEDANCE_REHOST_DOMAINS,
    UGUU_MAX_FILE_SIZE,
    UGUU_UPLOAD_URL,
    XSKILL_MAX_FILE_SIZE,
    XSKILL_MCP_HTTP_URL,
    XSKILL_MCP_MESSAGE_URL,
    XSKILL_MCP_TIMEOUT,
    XSKILL_UPLOAD_URL,
)
from exceptions import UploadError
from logging_config import setup_logging

logger = setup_logging(__name__)

# MIME type mapping by file extension
MIME_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
}

UPLOAD_TIMEOUT: int = 120  # 2 minutes for large files
IMGBB_UPLOAD_URL: str = "https://api.imgbb.com/1/upload"
IMGBB_MAX_SIZE: int = 32 * 1024 * 1024  # 32MB for imgbb


def _get_mime_type(file_path: str) -> str:
    """Detect MIME type from file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    return MIME_TYPES.get(ext, "application/octet-stream")


def _hash_file(file_path: str) -> str:
    """Compute SHA-256 hash of file contents."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def _load_cache(cache_path: str) -> dict:
    """Load upload cache from JSON file."""
    if os.path.exists(cache_path):
        try:
            with open(cache_path) as f:
                data = json.load(f)
            return data.get("entries", {})
        except (json.JSONDecodeError, OSError):
            logger.warning("Corrupt upload cache, starting fresh: %s", cache_path)
    return {}


def _save_cache(cache_path: str, entries: dict) -> None:
    """Save upload cache to JSON file."""
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w") as f:
        json.dump({"entries": entries}, f, indent=2)


def _get_cache_path(project_path: str | None) -> str:
    """Resolve cache file path based on project."""
    if project_path:
        return os.path.join(project_path, "upload_cache.json")
    return os.path.join(os.path.expanduser("~"), ".cache", "video-replicator", "upload_cache.json")


def upload_to_xskill(file_path: str) -> str:
    """
    Upload a file to xskill.ai using SUTUI_API_KEY.

    xskill.ai: same CDN as Seedance (cdn-video.51sux.com), guaranteed accessible
    from Seedance's infrastructure. Supports images AND audio. Reuses the
    SUTUI_API_KEY already needed for Seedance generation.

    Args:
        file_path: Local file path (image or audio)

    Returns:
        Public URL of uploaded file (on cdn-video.51sux.com)

    Raises:
        UploadError: If upload fails or API key not set
    """
    api_key = os.environ.get("SUTUI_API_KEY")
    if not api_key:
        raise UploadError("SUTUI_API_KEY not set. Get one at https://www.xskill.ai/#/v2/api-keys")

    if not os.path.exists(file_path):
        raise UploadError(f"File not found: {file_path}")

    file_size = os.path.getsize(file_path)
    if file_size > XSKILL_MAX_FILE_SIZE:
        raise UploadError(
            f"File too large for xskill.ai (max {XSKILL_MAX_FILE_SIZE // 1024 // 1024}MB): "
            f"{file_size / 1024 / 1024:.1f}MB"
        )

    mime_type = _get_mime_type(file_path)
    filename = os.path.basename(file_path)

    logger.info("Uploading %s to xskill (%s, %.1fMB)...", filename, mime_type, file_size / 1024 / 1024)

    try:
        with open(file_path, "rb") as f:
            file_b64 = base64.b64encode(f.read()).decode()

        response = requests.post(
            XSKILL_UPLOAD_URL,
            json={"image": file_b64, "content_type": mime_type},
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            timeout=UPLOAD_TIMEOUT,
        )

        if response.status_code != 200:
            raise UploadError(f"xskill upload failed: HTTP {response.status_code} — {response.text[:200]}")

        data = response.json()

        # Handle multiple response shapes
        url = None
        if isinstance(data, dict):
            # Shape 1: {"url": "..."}
            url = data.get("url")
            # Shape 2: {"data": {"url": "..."}}
            if not url:
                url = data.get("data", {}).get("url")
            # Shape 3: {"data": {"image": {"url": "..."}}}
            if not url:
                url = data.get("data", {}).get("image", {}).get("url")

        if not url:
            raise UploadError(f"xskill returned no URL: {response.text[:200]}")

        # Verify expected CDN domain
        if "cdn-video.51sux.com" not in url and "xskill" not in url:
            logger.warning("xskill returned unexpected domain: %s", url)

        logger.info("Uploaded to xskill: %s → %s", filename, url)
        return url

    except requests.RequestException as e:
        raise UploadError(f"xskill upload network error: {e}") from e


def _extract_mcp_url(result: dict) -> str | None:
    """Extract URL from a JSON-RPC MCP response.

    Handles multiple response shapes:
      1. {"result": {"content": [{"text": '{"url": "..."}'}]}}  (nested JSON)
      2. {"result": {"content": [{"text": "https://..."}]}}     (direct URL)
      3. {"result": {"url": "..."}}
      4. {"result": "https://..."}
    """
    if "result" not in result:
        return None

    r = result["result"]
    # Shape 1 & 2: content array
    if isinstance(r, dict) and "content" in r:
        for item in r.get("content", []):
            text = item.get("text", "")
            try:
                inner = json.loads(text)
                if isinstance(inner, dict) and inner.get("url"):
                    return inner["url"]
            except (json.JSONDecodeError, ValueError):
                pass
            if text.startswith("http"):
                return text
    # Shape 3: dict with url
    elif isinstance(r, dict):
        url = r.get("url")
        if url:
            return url
    # Shape 4: direct string
    elif isinstance(r, str) and r.startswith("http"):
        return r

    return None


def upload_to_xskill_mcp(file_path: str) -> str:
    """
    Upload a file via xskill.ai MCP endpoint (Streamable HTTP).

    Tries /api/v3/mcp-http first (documented upstream endpoint), then
    falls back to /api/v3/mcp/message (legacy SSE-era path) if the
    primary endpoint fails.

    Returns CDN URL on cdn-video.51sux.com — guaranteed accessible from
    Seedance's Chinese infrastructure (same CDN as Seedance outputs).

    Args:
        file_path: Local file path (image or audio)

    Returns:
        Public URL of uploaded file

    Raises:
        UploadError: If upload fails or API key not set
    """
    api_key = os.environ.get("SUTUI_API_KEY")
    if not api_key:
        raise UploadError("SUTUI_API_KEY not set. Get one at https://www.xskill.ai/#/v2/api-keys")

    if not os.path.exists(file_path):
        raise UploadError(f"File not found: {file_path}")

    file_size = os.path.getsize(file_path)
    if file_size > XSKILL_MAX_FILE_SIZE:
        raise UploadError(
            f"File too large for xskill MCP (max {XSKILL_MAX_FILE_SIZE // 1024 // 1024}MB): "
            f"{file_size / 1024 / 1024:.1f}MB"
        )

    mime_type = _get_mime_type(file_path)
    filename = os.path.basename(file_path)

    logger.info("Uploading %s via xskill MCP (%s, %.1fMB)...", filename, mime_type, file_size / 1024 / 1024)

    try:
        # Read file and encode as base64
        with open(file_path, "rb") as f:
            file_b64 = base64.b64encode(f.read()).decode()

        # JSON-RPC payload (same for both endpoints)
        jsonrpc_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "upload_image",
                "arguments": {
                    "image_data": file_b64,
                    "content_type": mime_type,
                    "filename": filename,
                },
            },
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

        # Try /api/v3/mcp-http first (upstream-documented Streamable HTTP endpoint)
        endpoints = [XSKILL_MCP_HTTP_URL, XSKILL_MCP_MESSAGE_URL]
        last_error = None

        for endpoint in endpoints:
            try:
                resp = requests.post(
                    endpoint,
                    json=jsonrpc_payload,
                    headers=headers,
                    timeout=XSKILL_MCP_TIMEOUT,
                )

                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code} — {resp.text[:200]}"
                    logger.debug("xskill MCP %s failed: %s", endpoint, last_error)
                    continue

                result = resp.json()
                url = _extract_mcp_url(result)

                if url:
                    logger.info("Uploaded via xskill MCP: %s → %s", filename, url)
                    return url

                last_error = f"no URL in response: {resp.text[:300]}"
                logger.debug("xskill MCP %s returned no URL, trying fallback", endpoint)

            except requests.RequestException as e:
                last_error = str(e)
                logger.debug("xskill MCP %s network error: %s", endpoint, e)
                continue

        raise UploadError(f"xskill MCP upload failed on all endpoints: {last_error}")

    except UploadError:
        raise
    except requests.RequestException as e:
        raise UploadError(f"xskill MCP network error: {e}") from e


def upload_to_uguu(file_path: str) -> str:
    """
    Upload a file to uguu.se (temporary file host, China-accessible).

    uguu.se: no API key required, 100MB limit, supports images/audio/video.
    URLs on d.uguu.se are confirmed accessible from Seedance's Chinese
    infrastructure. Files are temporary but persist long enough for
    Seedance task processing (~48 hours).

    Args:
        file_path: Local file path (any type)

    Returns:
        Public URL of uploaded file (on d.uguu.se)

    Raises:
        UploadError: If upload fails
    """
    if not os.path.exists(file_path):
        raise UploadError(f"File not found: {file_path}")

    file_size = os.path.getsize(file_path)
    if file_size > UGUU_MAX_FILE_SIZE:
        raise UploadError(
            f"File too large for uguu.se (max {UGUU_MAX_FILE_SIZE // 1024 // 1024}MB): "
            f"{file_size / 1024 / 1024:.1f}MB"
        )

    mime_type = _get_mime_type(file_path)
    filename = os.path.basename(file_path)

    logger.info("Uploading %s to uguu (%s, %.1fMB)...", filename, mime_type, file_size / 1024 / 1024)

    try:
        with open(file_path, "rb") as f:
            response = requests.post(
                UGUU_UPLOAD_URL,
                files={"files[]": (filename, f, mime_type)},
                timeout=UPLOAD_TIMEOUT,
            )

        if response.status_code != 200:
            raise UploadError(f"uguu upload failed: HTTP {response.status_code} — {response.text[:200]}")

        data = response.json()
        if not data.get("success") or not data.get("files"):
            raise UploadError(f"uguu upload failed: {response.text[:200]}")

        url = data["files"][0]["url"]
        logger.info("Uploaded to uguu: %s → %s", filename, url)
        return url

    except requests.RequestException as e:
        raise UploadError(f"uguu upload network error: {e}") from e


def upload_to_imgbb(file_path: str) -> str:
    """
    Upload an image to imgbb.com using API key.

    imgbb.com: requires IMGBB_API_KEY, 32MB limit, images only.
    Reliable and accessible from Chinese infrastructure (works with Seedance).

    Args:
        file_path: Local image file path

    Returns:
        Public URL of uploaded image

    Raises:
        UploadError: If upload fails or API key not set
    """
    api_key = os.environ.get("IMGBB_API_KEY")
    if not api_key:
        raise UploadError("IMGBB_API_KEY not set. Get a free key at https://api.imgbb.com/")

    if not os.path.exists(file_path):
        raise UploadError(f"File not found: {file_path}")

    file_size = os.path.getsize(file_path)
    if file_size > IMGBB_MAX_SIZE:
        raise UploadError(f"File too large for imgbb.com (max 32MB): {file_size / 1024 / 1024:.1f}MB")

    # imgbb only supports images
    mime_type = _get_mime_type(file_path)
    if not mime_type.startswith("image/"):
        raise UploadError(f"imgbb only supports images, got: {mime_type}")

    filename = os.path.basename(file_path)
    logger.info("Uploading %s to imgbb (%s, %.1fMB)...", filename, mime_type, file_size / 1024 / 1024)

    try:
        with open(file_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        response = requests.post(
            IMGBB_UPLOAD_URL,
            data={"key": api_key, "image": img_b64, "name": os.path.splitext(filename)[0]},
            timeout=UPLOAD_TIMEOUT,
        )

        if response.status_code == 200:
            data = response.json()
            url = data.get("data", {}).get("url")
            if url:
                logger.info("Uploaded to imgbb: %s → %s", filename, url)
                return url
            raise UploadError(f"imgbb returned no URL: {response.text[:200]}")

        raise UploadError(f"imgbb upload failed: HTTP {response.status_code} — {response.text[:200]}")

    except requests.RequestException as e:
        raise UploadError(f"imgbb upload network error: {e}") from e


def upload_to_catbox(file_path: str) -> str:
    """
    Upload a file to catbox.moe with correct MIME type detection.

    Catbox.moe: no API key required, 200MB limit, supports images/video/audio.

    Note: catbox.moe URLs may not be accessible from Seedance's Chinese
    infrastructure. For Seedance, prefer imgbb (set IMGBB_API_KEY).

    Args:
        file_path: Local file path to upload

    Returns:
        Public URL of uploaded file

    Raises:
        UploadError: If upload fails
    """
    if not os.path.exists(file_path):
        raise UploadError(f"File not found: {file_path}")

    file_size = os.path.getsize(file_path)
    if file_size > 200 * 1024 * 1024:
        raise UploadError(f"File too large for catbox.moe (max 200MB): {file_size / 1024 / 1024:.1f}MB")

    mime_type = _get_mime_type(file_path)
    filename = os.path.basename(file_path)

    logger.info("Uploading %s to catbox (%s, %.1fMB)...", filename, mime_type, file_size / 1024 / 1024)

    try:
        with open(file_path, "rb") as f:
            response = requests.post(
                CATBOX_UPLOAD_URL,
                data={"reqtype": "fileupload"},
                files={"fileToUpload": (filename, f, mime_type)},
                timeout=UPLOAD_TIMEOUT,
            )

        if response.status_code == 200 and response.text.strip().startswith("https://"):
            url = response.text.strip()
            logger.info("Uploaded to catbox: %s → %s", filename, url)
            return url

        raise UploadError(f"Catbox upload failed: HTTP {response.status_code} — {response.text[:200]}")

    except requests.RequestException as e:
        raise UploadError(f"Catbox upload network error: {e}") from e


def _upload_with_fallback(file_path: str) -> str:
    """
    Upload a file using the best available host.

    Upload chain:
        1. xskill.ai MCP  — SSE + JSON-RPC, CDN on cdn-video.51sux.com (GUARANTEED accessible)
        2. xskill.ai REST — if SUTUI_API_KEY is set (broken/404 since 2026-02-14, kept as fallback)
        3. uguu.se   — no key needed, China-accessible, images + audio + video
        4. imgbb.com  — if IMGBB_API_KEY is set (reliable, China-accessible, images only)
        5. catbox.moe — no API key needed (last resort, NOT accessible from China)

    Args:
        file_path: Local file path to upload

    Returns:
        Public URL of uploaded file

    Raises:
        UploadError: If all upload hosts fail
    """
    errors = []

    # Try xskill MCP first (same CDN as Seedance — cdn-video.51sux.com, guaranteed accessible)
    sutui_key = os.environ.get("SUTUI_API_KEY")
    if sutui_key:
        try:
            return upload_to_xskill_mcp(file_path)
        except Exception as e:
            errors.append(f"xskill MCP: {e}")
            logger.warning("xskill MCP upload failed, trying REST: %s", e)
            if run := _telemetry.get_current_run():
                run.record_upload_fallback(0, from_svc="xskill_mcp", to_svc="xskill_rest")

        # Try xskill REST (broken/404 since 2026-02-14, but kept as fallback in case it's fixed)
        try:
            return upload_to_xskill(file_path)
        except Exception as e:
            errors.append(f"xskill REST: {e}")
            logger.warning("xskill REST upload failed, trying next: %s", e)
            if run := _telemetry.get_current_run():
                run.record_upload_fallback(0, from_svc="xskill_rest", to_svc="uguu")

    # Try uguu.se (China-accessible, no API key needed, all file types)
    try:
        return upload_to_uguu(file_path)
    except Exception as e:
        errors.append(f"uguu: {e}")
        logger.warning("uguu upload failed, trying next: %s", e)
        if run := _telemetry.get_current_run():
            run.record_upload_fallback(0, from_svc="uguu", to_svc="imgbb")

    # Try imgbb (reliable, China-accessible, images only)
    imgbb_key = os.environ.get("IMGBB_API_KEY")
    mime_type = _get_mime_type(file_path)
    if imgbb_key and mime_type.startswith("image/"):
        try:
            return upload_to_imgbb(file_path)
        except Exception as e:
            errors.append(f"imgbb: {e}")
            logger.warning("imgbb upload failed, trying catbox: %s", e)
            if run := _telemetry.get_current_run():
                run.record_upload_fallback(0, from_svc="imgbb", to_svc="catbox")

    # Last resort: catbox (NOT accessible from China)
    try:
        return upload_to_catbox(file_path)
    except Exception as e:
        errors.append(f"catbox: {e}")

    # All hosts failed
    raise UploadError(
        f"All upload hosts failed:\n  " + "\n  ".join(errors)
    )


def upload_file(file_path: str, project_path: str | None = None) -> str:
    """
    Upload a local file with hash-based caching.

    Checks cache first — if the same file content was previously uploaded,
    returns the cached URL without re-uploading. Uses fallback upload chain
    (xskill MCP → xskill REST → uguu → imgbb → catbox).

    Args:
        file_path: Local file path
        project_path: Optional project directory for cache storage

    Returns:
        Public URL of uploaded file

    Raises:
        UploadError: If upload fails
    """
    file_path = os.path.abspath(file_path)
    cache_path = _get_cache_path(project_path)
    cache = _load_cache(cache_path)

    # Check cache by content hash
    file_hash = _hash_file(file_path)
    if file_hash in cache:
        cached = cache[file_hash]
        logger.info("Cache hit: %s → %s", os.path.basename(file_path), cached["url"])
        return cached["url"]

    # Upload with fallback chain and cache result
    url = _upload_with_fallback(file_path)
    cache[file_hash] = {
        "url": url,
        "local_path": file_path,
        "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _save_cache(cache_path, cache)

    return url


def _is_risky_domain(url: str) -> bool:
    """Check if URL is on a domain known to be inaccessible from Seedance's Chinese servers.

    Compares the URL hostname against SEEDANCE_REHOST_DOMAINS suffixes.

    Args:
        url: URL to check

    Returns:
        True if the domain is known-risky and should be rehosted
    """
    hostname = urlparse(url).hostname or ""
    return any(hostname.endswith(domain) for domain in SEEDANCE_REHOST_DOMAINS)


def _guess_extension(url: str, content_type: str = "") -> str:
    """Guess file extension from URL path or Content-Type header.

    Args:
        url: URL to extract extension from
        content_type: HTTP Content-Type header value

    Returns:
        File extension including dot (e.g., ".jpg")
    """
    path = urlparse(url).path
    _, ext = os.path.splitext(path)
    if ext and ext.lower() in MIME_TYPES:
        return ext.lower()

    # Fall back to content-type
    reverse_mime = {v: k for k, v in MIME_TYPES.items()}
    return reverse_mime.get(content_type.split(";")[0].strip(), ".jpg")


def rehost_url(url: str, project_path: str | None = None) -> str:
    """Download a URL and re-upload to a China-accessible CDN.

    Used when the original URL is on a domain that Seedance's Chinese
    servers cannot reliably access (e.g., Cloudflare R2, catbox.moe).

    Results are cached by original URL to avoid redundant re-uploads.

    Args:
        url: Original URL to rehost
        project_path: Optional project directory for cache storage

    Returns:
        New URL on a China-accessible CDN

    Raises:
        UploadError: If download or re-upload fails
    """
    # Check cache first (keyed by original URL)
    cache_path = _get_cache_path(project_path)
    cache = _load_cache(cache_path)

    cache_key = f"rehost:{url}"
    if cache_key in cache:
        cached_url = cache[cache_key]["url"]
        logger.info("Rehost cache hit: %s → %s", url[:60], cached_url)
        return cached_url

    # Download to temp file
    logger.info("Rehosting from risky domain: %s", url[:80])
    try:
        response = requests.get(url, timeout=60, stream=True)
        response.raise_for_status()
    except requests.RequestException as e:
        raise UploadError(f"Failed to download URL for rehosting: {url} — {e}") from e

    ext = _guess_extension(url, response.headers.get("content-type", ""))

    fd, tmp_path = tempfile.mkstemp(suffix=ext)
    try:
        with os.fdopen(fd, "wb") as f:
            for chunk in response.iter_content(8192):
                f.write(chunk)

        # Upload via fallback chain (xskill MCP → xskill REST → uguu → imgbb → catbox)
        new_url = _upload_with_fallback(tmp_path)

        # Cache the rehosted URL
        cache[cache_key] = {
            "url": new_url,
            "original_url": url,
            "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        _save_cache(cache_path, cache)

        logger.info("Rehosted: %s → %s", url[:60], new_url)
        return new_url
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def ensure_urls(
    file_paths: list[str],
    project_path: str | None = None,
    rehost_risky: bool = False,
) -> list[str]:
    """
    Convert a list of local file paths to publicly accessible URLs.

    Strings that are already URLs (start with http:// or https://) pass through
    unless rehost_risky=True and the URL is on a domain known to be inaccessible
    from Seedance's Chinese infrastructure — in which case the image is
    re-downloaded and re-uploaded to a China-accessible CDN.

    Local file paths are uploaded via the fallback chain with caching.

    Args:
        file_paths: List of local paths or URLs
        project_path: Optional project directory for cache storage
        rehost_risky: If True, re-upload URLs on risky domains (R2, catbox)

    Returns:
        List of public URLs in the same order

    Raises:
        UploadError: If any upload fails
    """
    urls = []
    for path in file_paths:
        if path.startswith("http://") or path.startswith("https://"):
            if rehost_risky and _is_risky_domain(path):
                urls.append(rehost_url(path, project_path=project_path))
            else:
                urls.append(path)
        else:
            url = upload_file(path, project_path=project_path)
            # Cached URLs may be on risky domains from a previous upload — rehost
            if rehost_risky and _is_risky_domain(url):
                logger.info("Cached URL on risky domain, rehosting: %s", url)
                url = rehost_url(url, project_path=project_path)
            urls.append(url)
    return urls
