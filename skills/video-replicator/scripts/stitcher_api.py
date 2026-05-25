#!/usr/bin/env python3
"""
Video Stitcher API Server
HTTP API for the Video Stitcher web UI.

Usage:
    python stitcher_api.py              # Start on default port 8766
    python stitcher_api.py --port 8080  # Custom port

Endpoints:
    GET  /api/videos?folder=downloads   List MP4 files in folder
    GET  /api/audio                     List available audio files
    GET  /api/jobs                      List all stitch jobs
    GET  /api/jobs/:id                  Get job details
    POST /api/stitch                    Start a stitch operation
    GET  /videos/:filename              Serve stitched video files
    GET  /audio/:id                     Serve audio file by ID
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent))

from exceptions import VideoProcessingError

# Import audio utilities for speech detection and audio mixing
try:
    from audio_utils import (
        has_audio_stream,
        strip_audio,
        validate_video_audio,
    )
    AUDIO_UTILS_AVAILABLE = True
except ImportError:
    AUDIO_UTILS_AVAILABLE = False



class ReuseAddrHTTPServer(HTTPServer):
    """HTTPServer with SO_REUSEADDR enabled for quick restarts."""
    allow_reuse_address = True


# Configuration
DEFAULT_PORT = 8766
DB_PATH = Path(__file__).parent.parent.parent.parent.parent / "stitcher.db"
CONFIG_PATH = Path(__file__).parent.parent.parent.parent.parent / "stitcher_config.json"
OUTPUT_DIR = Path.home() / "Downloads" / "stitched"
THUMBNAIL_DIR = Path(__file__).parent.parent.parent.parent.parent / ".thumbnails"

# Default folder paths (used when no custom paths configured)
DEFAULT_FOLDER_PATHS = {
    "downloads": Path.home() / "Downloads",
    "documents": Path.home() / "Documents",
    "projects": Path(__file__).parent.parent.parent.parent.parent / "projects",
}

# Supported video extensions
VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"]

# Supported audio extensions
AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg"]


def load_config() -> dict:
    """Load configuration from JSON file."""
    default_config = {
        "video_paths": [],
        "audio_paths": [],
        "recursive": True
    }

    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                config = json.load(f)
                # Merge with defaults to handle missing keys
                return {**default_config, **config}
        except (OSError, json.JSONDecodeError) as e:
            print(f"Error loading config: {e}")

    return default_config


def save_config(config: dict) -> bool:
    """Save configuration to JSON file."""
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump(config, f, indent=2)
        return True
    except OSError as e:
        print(f"Error saving config: {e}")
        return False


def validate_path(path_str: str) -> Path | None:
    """
    Validate a path for security and accessibility.
    Returns Path object if valid, None otherwise.
    """
    if not path_str:
        return None

    # Reject path traversal attempts
    if ".." in path_str:
        return None

    # Convert to absolute path
    path = Path(path_str).expanduser().resolve()

    # Check path exists and is a directory
    if not path.exists() or not path.is_dir():
        return None

    # Check path is readable
    if not os.access(path, os.R_OK):
        return None

    return path


def open_folder_browser(initial_dir: str = None) -> str | None:
    """
    Open a native folder browser dialog using subprocess.
    Returns the selected folder path or None if cancelled.
    """
    # Set initial directory
    start_dir = initial_dir if initial_dir and os.path.isdir(initial_dir) else str(Path.home())

    # Use subprocess to run tkinter in a fresh Python process
    # This avoids threading issues with the HTTP server
    script = f'''
import tkinter as tk
from tkinter import filedialog
import subprocess
import sys

# On macOS, use AppleScript to bring Python to front
if sys.platform == "darwin":
    subprocess.run(["osascript", "-e", 'tell application "System Events" to set frontmost of process "Python" to true'], capture_output=True)

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
root.lift()
root.focus_force()
root.after(100, lambda: None)  # Small delay to ensure window is ready
root.update()
folder = filedialog.askdirectory(initialdir="{start_dir}", title="Select Folder", parent=root)
root.destroy()
print(folder if folder else "")
'''

    try:
        result = subprocess.run(
            ["python3", "-c", script],
            capture_output=True,
            text=True,
            timeout=120  # 2 minute timeout for user to select
        )
        folder_path = result.stdout.strip()
        return folder_path if folder_path else None
    except subprocess.TimeoutExpired:
        return None
    except Exception as e:
        print(f"Error opening folder browser: {e}")
        return None


def init_database():
    """Initialize SQLite database with required tables."""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()

    # Stitch jobs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS stitch_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            progress INTEGER DEFAULT 0,
            output_path TEXT,
            duration REAL,
            file_size INTEGER,
            error TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        )
    """)

    # Video queue table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS video_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER REFERENCES stitch_jobs(id) ON DELETE CASCADE,
            source_path TEXT NOT NULL,
            position INTEGER NOT NULL,
            duration_seconds REAL
        )
    """)

    # Audio library table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audio_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            duration_seconds REAL,
            category TEXT DEFAULT 'custom',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    conn.close()
    print(f"Database initialized: {DB_PATH}")


def get_db_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def get_video_info(video_path: str) -> dict:
    """Get video metadata using ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration:format=duration,size",
            "-of", "json",
            video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

        if result.returncode != 0:
            return None

        data = json.loads(result.stdout)
        stream = data.get("streams", [{}])[0]
        format_info = data.get("format", {})

        # Get duration from stream or format
        duration = float(stream.get("duration", 0) or format_info.get("duration", 0))

        return {
            "width": int(stream.get("width", 0)),
            "height": int(stream.get("height", 0)),
            "duration": duration,
            "fileSize": int(format_info.get("size", 0))
        }
    except Exception as e:
        print(f"Error getting video info for {video_path}: {e}")
        return None


def get_audio_duration(audio_path: str) -> float:
    """Get audio duration using ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            audio_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return float(result.stdout.strip()) if result.returncode == 0 else 0
    except Exception:
        return 0


def generate_thumbnail(video_path: str, video_id: str) -> str | None:
    """
    Generate a thumbnail from the first frame of a video.
    Returns the thumbnail filename if successful, None otherwise.
    """
    try:
        # Ensure thumbnail directory exists
        THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)

        # Generate thumbnail filename based on video ID
        thumbnail_filename = f"{video_id}.jpg"
        thumbnail_path = THUMBNAIL_DIR / thumbnail_filename

        # Skip if thumbnail already exists and is recent
        if thumbnail_path.exists():
            # Check if video is newer than thumbnail
            video_mtime = Path(video_path).stat().st_mtime
            thumb_mtime = thumbnail_path.stat().st_mtime
            if thumb_mtime >= video_mtime:
                return thumbnail_filename

        # Use FFmpeg to extract first frame
        cmd = [
            "ffmpeg",
            "-y",  # Overwrite
            "-i", video_path,
            "-vf", "thumbnail,scale=320:-1",  # Get representative frame, scale to 320px wide
            "-frames:v", "1",  # Only one frame
            "-q:v", "5",  # Quality (2-31, lower is better)
            str(thumbnail_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode == 0 and thumbnail_path.exists():
            return thumbnail_filename
        else:
            print(f"Thumbnail generation failed for {video_path}: {result.stderr[:200]}")
            return None

    except Exception as e:
        print(f"Error generating thumbnail for {video_path}: {e}")
        return None


def list_videos(folder: str = None, custom_paths: list = None) -> list:
    """
    List video files from specified paths.

    Args:
        folder: Legacy folder identifier ('downloads', 'documents', 'projects')
        custom_paths: List of custom directory paths to scan (takes precedence)

    Returns:
        List of video file metadata dicts
    """
    videos = []
    all_video_files = []

    if custom_paths:
        # Use custom paths - scan all recursively
        for path_str in custom_paths:
            validated_path = validate_path(path_str)
            if validated_path:
                # Scan recursively for all video extensions
                for ext in VIDEO_EXTENSIONS:
                    all_video_files.extend(validated_path.rglob(f"*{ext}"))
    else:
        # Legacy folder-based mode
        folder_path = DEFAULT_FOLDER_PATHS.get(folder, DEFAULT_FOLDER_PATHS["downloads"])

        if not folder_path.exists():
            return []

        # Always use recursive glob for all folders
        for ext in VIDEO_EXTENSIONS:
            all_video_files.extend(folder_path.rglob(f"*{ext}"))

    # Remove duplicates (same file could be found via symlinks)
    seen_paths = set()
    unique_files = []
    for f in all_video_files:
        resolved = f.resolve()
        if resolved not in seen_paths:
            seen_paths.add(resolved)
            unique_files.append(f)

    # Sort by modification time (newest first)
    unique_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)

    # Limit to 100 files
    for filepath in unique_files[:100]:
        video_id = str(uuid.uuid5(uuid.NAMESPACE_URL, str(filepath)))
        info = get_video_info(str(filepath))

        if info:
            # Generate thumbnail (cached)
            thumb_filename = generate_thumbnail(str(filepath), video_id)
            thumb_url = f"/thumbnails/{thumb_filename}" if thumb_filename else None

            # Get file modification time
            mtime = filepath.stat().st_mtime
            created_at = datetime.fromtimestamp(mtime).isoformat()

            videos.append({
                "id": video_id,
                "path": str(filepath),
                "filename": filepath.name,
                "duration": info["duration"],
                "width": info["width"],
                "height": info["height"],
                "fileSize": info["fileSize"],
                "thumbnail": thumb_url,
                "createdAt": created_at
            })

    return videos


def list_audio(custom_paths: list = None) -> list:
    """
    List available audio files from database and specified locations.

    Args:
        custom_paths: List of custom directory paths to scan (takes precedence over defaults)

    Returns:
        List of audio file metadata dicts
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # Get audio from database
    cursor.execute("SELECT id, name, path, duration_seconds, category FROM audio_library ORDER BY name")
    db_audio = [dict(row) for row in cursor.fetchall()]
    conn.close()

    # Determine which directories to scan
    if custom_paths:
        # Use custom paths
        audio_dirs = []
        for path_str in custom_paths:
            validated_path = validate_path(path_str)
            if validated_path:
                audio_dirs.append(validated_path)
    else:
        # Use default audio locations
        audio_dirs = [
            Path.home() / "Downloads",
            Path.home() / "Music",
            DEFAULT_FOLDER_PATHS["projects"],
        ]

    found_audio = []
    seen_paths = set()

    for audio_dir in audio_dirs:
        if not audio_dir.exists():
            continue

        # Always use recursive scanning for audio
        for ext in AUDIO_EXTENSIONS:
            for filepath in audio_dir.rglob(f"*{ext}"):
                # Skip duplicates
                resolved = filepath.resolve()
                if resolved in seen_paths:
                    continue
                seen_paths.add(resolved)

                # Skip if already in database
                if any(a["path"] == str(filepath) for a in db_audio):
                    continue

                duration = get_audio_duration(str(filepath))
                if duration > 0:
                    # Use stable hash (MD5) instead of Python's hash() which varies between sessions
                    stable_id = int(hashlib.md5(str(filepath).encode()).hexdigest()[:8], 16)
                    found_audio.append({
                        "id": stable_id,
                        "name": filepath.stem,
                        "path": str(filepath),
                        "duration": duration,
                        "source": "local"
                    })

    # Sort found audio by name
    found_audio.sort(key=lambda x: x["name"].lower())

    # Combine and format
    audio_list = []
    for a in db_audio:
        audio_list.append({
            "id": a["id"],
            "name": a["name"],
            "path": a["path"],
            "duration": a["duration_seconds"] or 0,
            "source": a["category"] or "library"
        })

    audio_list.extend(found_audio[:50])  # Increased limit for scanned audio
    return audio_list


def create_stitch_job(name: str, video_paths: list, audio_path: str | None) -> int:
    """Create a new stitch job in the database."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "INSERT INTO stitch_jobs (name, status) VALUES (?, ?)",
        (name, "pending")
    )
    job_id = cursor.lastrowid

    # Add videos to queue
    for i, video_path in enumerate(video_paths):
        info = get_video_info(video_path)
        duration = info["duration"] if info else 0
        cursor.execute(
            "INSERT INTO video_queue (job_id, source_path, position, duration_seconds) VALUES (?, ?, ?, ?)",
            (job_id, video_path, i, duration)
        )

    conn.commit()
    conn.close()
    return job_id


def update_job_status(job_id: int, status: str, progress: int = None,
                      output_path: str = None, duration: float = None,
                      file_size: int = None, error: str = None):
    """Update job status in database."""
    conn = get_db_connection()
    cursor = conn.cursor()

    updates = ["status = ?"]
    params = [status]

    if progress is not None:
        updates.append("progress = ?")
        params.append(progress)

    if output_path is not None:
        updates.append("output_path = ?")
        params.append(output_path)

    if duration is not None:
        updates.append("duration = ?")
        params.append(duration)

    if file_size is not None:
        updates.append("file_size = ?")
        params.append(file_size)

    if error is not None:
        updates.append("error = ?")
        params.append(error)

    if status in ("complete", "failed"):
        updates.append("completed_at = ?")
        params.append(datetime.now().isoformat())

    params.append(job_id)

    cursor.execute(
        f"UPDATE stitch_jobs SET {', '.join(updates)} WHERE id = ?",
        params
    )
    conn.commit()
    conn.close()


def get_job(job_id: int) -> dict:
    """Get job details from database."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM stitch_jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return {
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "progress": row["progress"] or 0,
        "outputPath": row["output_path"],
        "duration": row["duration"],
        "fileSize": row["file_size"],
        "error": row["error"]
    }


def list_jobs(limit: int = 10) -> list:
    """List recent stitch jobs."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT * FROM stitch_jobs ORDER BY created_at DESC LIMIT ?",
        (limit,)
    )
    rows = cursor.fetchall()
    conn.close()

    return [{
        "id": row["id"],
        "name": row["name"],
        "status": row["status"],
        "progress": row["progress"] or 0,
        "outputPath": row["output_path"],
        "duration": row["duration"],
        "fileSize": row["file_size"],
        "error": row["error"]
    } for row in rows]


def create_concat_file(video_files: list, output_path: str) -> str:
    """Create FFmpeg concat demuxer file."""
    concat_content = "\n".join([f"file '{os.path.abspath(f)}'" for f in video_files])
    with open(output_path, "w") as f:
        f.write(concat_content)
    return output_path


def build_transition_filter(video_paths: list, transition: str, duration: float) -> tuple:
    """
    Build FFmpeg filter complex for transitions between clips.
    Returns (filter_string, output_label).

    Supported transitions:
    - fade, fadeblack, fadewhite
    - wipeleft, wiperight, wipeup, wipedown
    - slideleft, slideright, slideup, slidedown
    - circlecrop, rectcrop
    - dissolve, pixelize, diagtl, diagtr, diagbl, diagbr
    - hlslice, hrslice, vuslice, vdslice
    - radial, zoomin, smoothleft, smoothright
    """
    if not transition or transition == "none" or len(video_paths) < 2:
        return None, None

    # Get video durations
    durations = []
    for v in video_paths:
        info = get_video_info(v)
        durations.append(info["duration"] if info else 5.0)

    # Build filter complex with xfade between each pair
    filters = []

    # First, add scale/fps normalization for each input
    for i in range(len(video_paths)):
        filters.append(f"[{i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{i}]")

    # Calculate xfade offsets and build chain
    # offset = sum of previous durations minus accumulated transition durations
    current_label = "v0"
    for i in range(1, len(video_paths)):
        # Calculate offset: when the transition starts
        # It's the end of previous segment minus transition duration
        offset = sum(durations[:i]) - (duration * i)
        offset = max(0, offset)  # Ensure non-negative

        next_label = f"v{i}"
        out_label = f"x{i}" if i < len(video_paths) - 1 else "vout"

        filters.append(f"[{current_label}][{next_label}]xfade=transition={transition}:duration={duration}:offset={offset:.3f}[{out_label}]")
        current_label = out_label

    return ";".join(filters), "vout"


def check_videos_have_audio(video_paths: list) -> bool:
    """Check if any video in the list has an audio stream."""
    if not AUDIO_UTILS_AVAILABLE:
        return True  # Assume videos might have audio

    for video_path in video_paths:
        try:
            if has_audio_stream(video_path):
                return True
        except Exception:
            pass
    return False


def preprocess_videos_for_speech(video_paths: list) -> tuple:
    """
    Preprocess videos: detect speech and mute videos that have it.

    Returns:
        (processed_paths, speech_muted_list) tuple
    """
    if not AUDIO_UTILS_AVAILABLE:
        return video_paths, []

    processed = []
    speech_muted = []

    for path in video_paths:
        try:
            validation = validate_video_audio(path, check_speech=True)
            if validation.get("has_speech", False):
                # Mute this video
                muted_path = strip_audio(path)
                processed.append(muted_path)
                speech_muted.append(os.path.basename(path))
                print(f"  ⚠️ Speech detected, muted: {os.path.basename(path)}")
            else:
                processed.append(path)
        except Exception as e:
            print(f"  Warning: Could not process {path}: {e}")
            processed.append(path)

    return processed, speech_muted


def run_stitch(job_id: int, video_paths: list, audio_path: str | None,
               transition: str | None = None, transition_duration: float = 0.5,
               preserve_audio: bool = True, music_volume: float = 0.6,
               video_volume: float = 0.3, check_speech: bool = False,
               music_fade_out: float = 3.0):
    """Run the actual stitching operation in a background thread.

    Args:
        job_id: Database job ID for progress tracking
        video_paths: List of video file paths to stitch
        audio_path: Optional background music file
        transition: Transition type (e.g., "fade", "dissolve")
        transition_duration: Duration of transitions in seconds
        preserve_audio: If True, mix video audio with background music
        music_volume: Volume level for background music (0.0-1.0)
        video_volume: Volume level for video audio (0.0-1.0)
        check_speech: If True, detect and auto-mute videos with speech
        music_fade_out: Fade out music at end (seconds, 0 to disable)
    """
    try:
        update_job_status(job_id, "processing", progress=10)

        # Ensure output directory exists
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        # Generate output filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"stitch_{timestamp}.mp4"
        output_path = OUTPUT_DIR / output_filename

        # Speech detection preprocessing
        speech_muted = []
        if check_speech and AUDIO_UTILS_AVAILABLE:
            print("Analyzing videos for speech...")
            video_paths, speech_muted = preprocess_videos_for_speech(video_paths)

        update_job_status(job_id, "processing", progress=20)

        # Check audio conditions
        has_video_audio = check_videos_have_audio(video_paths) if preserve_audio else False
        has_background_music = audio_path and os.path.exists(audio_path)

        # Determine audio mode
        if has_video_audio and has_background_music and preserve_audio:
            audio_mode = "mixed"
        elif has_background_music:
            audio_mode = "music_only"
        elif has_video_audio and preserve_audio:
            audio_mode = "video_only"
        else:
            audio_mode = "silent"

        print(f"Audio mode: {audio_mode}")

        # Check if using transitions
        use_transitions = transition and transition != "none" and len(video_paths) >= 2

        if use_transitions:
            # Build filter complex for transitions
            filter_complex, out_label = build_transition_filter(
                video_paths, transition, transition_duration
            )

            # Build command with filter complex
            cmd = ["ffmpeg", "-y"]

            # Add all input files
            for video_path in video_paths:
                cmd.extend(["-i", video_path])

            # Add audio if provided
            audio_input_idx = len(video_paths)
            if audio_path and os.path.exists(audio_path):
                cmd.extend(["-i", audio_path])

            # Add filter complex
            cmd.extend(["-filter_complex", filter_complex])

            # Map video output
            cmd.extend(["-map", f"[{out_label}]"])

            # Map audio
            if audio_path and os.path.exists(audio_path):
                cmd.extend(["-map", f"{audio_input_idx}:a:0"])

            # Calculate expected output duration (accounting for transitions)
            video_duration = sum(
                get_video_info(v)["duration"] for v in video_paths
                if get_video_info(v)
            ) - (transition_duration * (len(video_paths) - 1))

            # Limit duration if audio
            if audio_path and os.path.exists(audio_path):
                cmd.extend(["-t", str(video_duration)])

            # Output settings
            cmd.extend([
                "-c:v", "libx264",
                "-preset", "medium",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "192k",
                str(output_path)
            ])
        else:
            # No transitions - use simple concat demuxer
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as concat_file:
                concat_path = concat_file.name
                create_concat_file(video_paths, concat_path)

            try:
                if audio_mode == "mixed":
                    # Mix video audio with background music
                    print(f"Adding audio mix: video={video_volume:.0%}, music={music_volume:.0%}")

                    # Calculate fade out timing if enabled
                    video_duration = sum(
                        get_video_info(v)["duration"] for v in video_paths
                        if get_video_info(v)
                    )

                    # Build music filter with optional fade-out
                    if music_fade_out > 0 and video_duration > music_fade_out:
                        fade_start = video_duration - music_fade_out
                        print(f"Music fade-out: {music_fade_out}s (starts at {fade_start:.1f}s)")
                        music_filter = f"[1:a]volume={music_volume},afade=t=out:st={fade_start:.2f}:d={music_fade_out:.2f}[ma]"
                    else:
                        music_filter = f"[1:a]volume={music_volume}[ma]"

                    cmd = [
                        "ffmpeg", "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concat_path,
                        "-i", audio_path,
                        "-filter_complex",
                        f"[0:a]volume={video_volume}[va];"
                        f"{music_filter};"
                        "[va][ma]amix=inputs=2:duration=shortest:dropout_transition=600[aout]",
                        "-map", "0:v:0",
                        "-map", "[aout]",
                        "-c:v", "libx264",
                        "-preset", "medium",
                        "-crf", "23",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-shortest",
                        str(output_path)
                    ]
                elif audio_mode == "music_only":
                    # Replace with background music (original behavior)
                    video_duration = sum(
                        get_video_info(v)["duration"] for v in video_paths
                        if get_video_info(v)
                    )

                    # Build music filter with optional fade-out
                    if music_fade_out > 0 and video_duration > music_fade_out:
                        fade_start = video_duration - music_fade_out
                        print(f"Music fade-out: {music_fade_out}s (starts at {fade_start:.1f}s)")
                        cmd = [
                            "ffmpeg", "-y",
                            "-f", "concat",
                            "-safe", "0",
                            "-i", concat_path,
                            "-i", audio_path,
                            "-t", str(video_duration),
                            "-filter_complex",
                            f"[1:a]volume={music_volume},afade=t=out:st={fade_start:.2f}:d={music_fade_out:.2f}[aout]",
                            "-map", "0:v:0",
                            "-map", "[aout]",
                            "-c:v", "libx264",
                            "-preset", "medium",
                            "-crf", "23",
                            "-c:a", "aac",
                            "-b:a", "192k",
                            str(output_path)
                        ]
                    else:
                        cmd = [
                            "ffmpeg", "-y",
                            "-f", "concat",
                            "-safe", "0",
                            "-i", concat_path,
                            "-i", audio_path,
                            "-t", str(video_duration),
                            "-map", "0:v:0",
                            "-map", "1:a:0",
                            "-c:v", "libx264",
                            "-preset", "medium",
                            "-crf", "23",
                            "-c:a", "aac",
                            "-b:a", "192k",
                            str(output_path)
                        ]
                elif audio_mode == "video_only":
                    # Keep video audio only
                    cmd = [
                        "ffmpeg", "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concat_path,
                        "-c:v", "libx264",
                        "-preset", "medium",
                        "-crf", "23",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        str(output_path)
                    ]
                else:
                    # Silent output
                    cmd = [
                        "ffmpeg", "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concat_path,
                        "-c:v", "libx264",
                        "-preset", "medium",
                        "-crf", "23",
                        "-an",
                        str(output_path)
                    ]
            finally:
                pass  # Cleanup handled below

        update_job_status(job_id, "processing", progress=50)

        # Run FFmpeg
        print(f"Running FFmpeg command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        # Cleanup concat file if used
        if not use_transitions and 'concat_path' in locals() and os.path.exists(concat_path):
            os.remove(concat_path)

        if result.returncode != 0:
            raise VideoProcessingError(f"FFmpeg failed: {result.stderr[:500]}")

        update_job_status(job_id, "processing", progress=90)

        # Get output info
        info = get_video_info(str(output_path))
        duration = info["duration"] if info else 0
        file_size = output_path.stat().st_size

        update_job_status(
            job_id,
            "complete",
            progress=100,
            output_path=output_filename,
            duration=duration,
            file_size=file_size
        )

        print(f"Stitch complete: {output_path} (audio: {audio_mode})")
        if speech_muted:
            print(f"Speech muted in: {', '.join(speech_muted)}")

    except Exception as e:
        print(f"Stitch error: {e}")
        import traceback
        traceback.print_exc()
        update_job_status(job_id, "failed", error=str(e)[:500])


class StitcherAPIHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the Stitcher API."""

    def send_json(self, data: dict, status: int = 200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def send_file(self, filepath: Path, content_type: str):
        """Send file response."""
        if not filepath.exists():
            self.send_error(404, "File not found")
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", filepath.stat().st_size)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(filepath, "rb") as f:
            self.wfile.write(f.read())

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """Handle GET requests."""
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # API: Get configuration
        if path == "/api/config":
            config = load_config()
            self.send_json(config)
            return

        # API: Browse for folder (opens native dialog)
        if path == "/api/browse-folder":
            initial_dir = query.get("initial_dir", [None])[0]
            folder_path = open_folder_browser(initial_dir)

            if folder_path:
                self.send_json({"path": folder_path, "success": True})
            else:
                self.send_json({"path": None, "success": False, "cancelled": True})
            return

        # API: List videos
        if path == "/api/videos":
            # Check for custom paths first
            paths_param = query.get("paths", [None])[0]
            if paths_param:
                # Parse comma-separated paths
                custom_paths = [p.strip() for p in paths_param.split(",") if p.strip()]
                videos = list_videos(custom_paths=custom_paths)
            else:
                # Legacy folder-based mode
                folder = query.get("folder", ["downloads"])[0]
                videos = list_videos(folder=folder)
            self.send_json({"videos": videos})
            return

        # API: List audio
        if path == "/api/audio":
            # Check for custom paths from query or config
            paths_param = query.get("paths", [None])[0]
            if paths_param:
                custom_paths = [p.strip() for p in paths_param.split(",") if p.strip()]
            else:
                # Use configured audio paths instead of scanning huge default dirs
                config = load_config()
                custom_paths = config.get("audio_paths", [])
            audio = list_audio(custom_paths=custom_paths if custom_paths else None)
            self.send_json({"audio": audio})
            return

        # API: List jobs
        if path == "/api/jobs":
            limit = int(query.get("limit", [10])[0])
            jobs = list_jobs(limit)
            self.send_json({"jobs": jobs})
            return

        # API: Get job by ID
        job_match = re.match(r"/api/jobs/(\d+)", path)
        if job_match:
            job_id = int(job_match.group(1))
            job = get_job(job_id)
            if job:
                self.send_json(job)
            else:
                self.send_json({"error": "Job not found"}, 404)
            return

        # Serve video files
        if path.startswith("/videos/"):
            filename = path[8:]  # Remove "/videos/"
            filepath = OUTPUT_DIR / filename
            self.send_file(filepath, "video/mp4")
            return

        # Serve thumbnail images
        if path.startswith("/thumbnails/"):
            filename = path[12:]  # Remove "/thumbnails/"
            filepath = THUMBNAIL_DIR / filename
            self.send_file(filepath, "image/jpeg")
            return

        # Serve audio files by ID
        if path.startswith("/audio/"):
            audio_id = path[7:]  # Remove "/audio/"
            # Find audio file by ID - use config paths to avoid slow scan
            config = load_config()
            custom_paths = config.get("audio_paths", [])
            audio_files = list_audio(custom_paths=custom_paths if custom_paths else None)
            audio_file = next((a for a in audio_files if str(a.get("id")) == audio_id), None)
            if audio_file and os.path.exists(audio_file.get("path", "")):
                filepath = Path(audio_file["path"])
                # Determine MIME type
                ext = filepath.suffix.lower()
                mime_types = {
                    ".mp3": "audio/mpeg",
                    ".wav": "audio/wav",
                    ".m4a": "audio/mp4",
                    ".aac": "audio/aac",
                    ".ogg": "audio/ogg",
                }
                mime_type = mime_types.get(ext, "audio/mpeg")
                self.send_file(filepath, mime_type)
            else:
                self.send_error(404, "Audio not found")
            return

        # Health check
        if path == "/health":
            self.send_json({"status": "ok", "timestamp": datetime.now().isoformat()})
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        """Handle POST requests."""
        parsed = urlparse(self.path)
        path = parsed.path

        # Read request body
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode() if content_length > 0 else "{}"

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        # API: Update configuration
        if path == "/api/config":
            video_paths = data.get("video_paths", [])
            audio_paths = data.get("audio_paths", [])
            recursive = data.get("recursive", True)

            # Validate all paths
            invalid_video_paths = []
            valid_video_paths = []
            for p in video_paths:
                if validate_path(p):
                    valid_video_paths.append(p)
                else:
                    invalid_video_paths.append(p)

            invalid_audio_paths = []
            valid_audio_paths = []
            for p in audio_paths:
                if validate_path(p):
                    valid_audio_paths.append(p)
                else:
                    invalid_audio_paths.append(p)

            # Save configuration (only valid paths)
            config = {
                "video_paths": valid_video_paths,
                "audio_paths": valid_audio_paths,
                "recursive": recursive
            }

            if save_config(config):
                response = {
                    "success": True,
                    "config": config,
                }
                # Include warnings about invalid paths
                if invalid_video_paths or invalid_audio_paths:
                    response["warnings"] = {}
                    if invalid_video_paths:
                        response["warnings"]["invalid_video_paths"] = invalid_video_paths
                    if invalid_audio_paths:
                        response["warnings"]["invalid_audio_paths"] = invalid_audio_paths
                self.send_json(response)
            else:
                self.send_json({"error": "Failed to save configuration"}, 500)
            return

        # API: Start stitch operation
        if path == "/api/stitch":
            videos = data.get("videos", [])
            audio_path = data.get("audio_path")
            name = data.get("name", f"stitch_{int(time.time())}")
            transition = data.get("transition", "none")  # none, fade, dissolve, etc.
            transition_duration = float(data.get("transition_duration", 0.5))

            # Audio mixing options
            preserve_audio = data.get("preserve_audio", True)
            music_volume = float(data.get("music_volume", 0.6))
            video_volume = float(data.get("video_volume", 0.3))
            check_speech = data.get("check_speech", False)
            music_fade_out = float(data.get("music_fade_out", 3.0))

            if not videos or len(videos) < 2:
                self.send_json({"error": "At least 2 videos required"}, 400)
                return

            # Validate video files exist
            missing = [v for v in videos if not os.path.exists(v)]
            if missing:
                self.send_json({"error": f"Missing files: {missing}"}, 400)
                return

            # Validate transition type
            valid_transitions = [
                "none", "fade", "fadeblack", "fadewhite",
                "wipeleft", "wiperight", "wipeup", "wipedown",
                "slideleft", "slideright", "slideup", "slidedown",
                "circlecrop", "rectcrop", "dissolve", "pixelize",
                "diagtl", "diagtr", "diagbl", "diagbr",
                "hlslice", "hrslice", "vuslice", "vdslice",
                "radial", "zoomin", "smoothleft", "smoothright"
            ]
            if transition not in valid_transitions:
                transition = "none"

            # Validate transition duration (0.1 to 2.0 seconds)
            transition_duration = max(0.1, min(2.0, transition_duration))

            # Validate volume levels (0.0 to 1.0)
            music_volume = max(0.0, min(1.0, music_volume))
            video_volume = max(0.0, min(1.0, video_volume))

            # Validate music fade-out (0.0 to 10.0 seconds)
            music_fade_out = max(0.0, min(10.0, music_fade_out))

            # Create job and start stitching in background
            job_id = create_stitch_job(name, videos, audio_path)

            thread = threading.Thread(
                target=run_stitch,
                args=(job_id, videos, audio_path, transition, transition_duration,
                      preserve_audio, music_volume, video_volume, check_speech,
                      music_fade_out),
                daemon=True
            )
            thread.start()

            self.send_json({
                "job_id": job_id,
                "name": name,
                "transition": transition,
                "transition_duration": transition_duration,
                "preserve_audio": preserve_audio,
                "music_volume": music_volume,
                "video_volume": video_volume,
                "check_speech": check_speech,
                "music_fade_out": music_fade_out,
            })
            return

        self.send_error(404, "Not found")

    def log_message(self, format, *args):
        """Custom log format."""
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="Video Stitcher API Server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Port (default: {DEFAULT_PORT})")
    args = parser.parse_args()

    # Initialize database
    init_database()

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Start server with SO_REUSEADDR to allow quick restarts
    server = ReuseAddrHTTPServer(("", args.port), StitcherAPIHandler)
    print(f"\n{'='*50}")
    print("  Video Stitcher API Server")
    print(f"{'='*50}")
    print(f"  Port:     http://localhost:{args.port}")
    print(f"  Database: {DB_PATH}")
    print(f"  Output:   {OUTPUT_DIR}")
    print(f"{'='*50}")
    print("\nEndpoints:")
    print("  GET  /api/videos?folder=downloads")
    print("  GET  /api/audio")
    print("  GET  /api/jobs")
    print("  GET  /api/jobs/:id")
    print("  POST /api/stitch")
    print("  GET  /videos/:filename")
    print("  GET  /audio/:id")
    print("\nPress Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
