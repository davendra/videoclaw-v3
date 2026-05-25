#!/usr/bin/env python3
"""
Download audio or video from YouTube.

Supports single videos, playlists, and batch URL lists.
Uses yt-dlp for extraction and FFmpeg for conversion/merging.

Usage:
    # --- Audio (MP3) ---
    python youtube_dl.py "URL"
    python youtube_dl.py "URL" --quality 320
    python youtube_dl.py "URL" --start 30 --end 90

    # --- Video (MP4) ---
    python youtube_dl.py "URL" --video
    python youtube_dl.py "URL" --video --resolution 1080
    python youtube_dl.py "URL" --video --resolution 4k

    # --- Both audio + video ---
    python youtube_dl.py "URL" --both

    # --- Common options ---
    python youtube_dl.py "URL" --output-dir downloads/
    python youtube_dl.py "URL" --filename "my-file"
    python youtube_dl.py "URL" --dry-run
    python youtube_dl.py --from-file urls.txt --output-dir downloads/ --yes

Requirements:
    pip install yt-dlp
    brew install ffmpeg
    brew install deno  (recommended for reliable YouTube extraction)
"""

import argparse
import os
import subprocess
import sys

try:
    import yt_dlp
except ImportError:
    print("Error: yt-dlp not installed. Run: pip install yt-dlp")
    sys.exit(1)


# ============================================================
# Utilities
# ============================================================


def check_ffmpeg() -> bool:
    """Check if FFmpeg is available."""
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def parse_time(time_str: str) -> float:
    """Parse time string (seconds or HH:MM:SS) to seconds."""
    if time_str is None:
        return 0.0
    try:
        return float(time_str)
    except ValueError:
        pass
    parts = time_str.split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    elif len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    raise ValueError(f"Invalid time format: {time_str}")


def format_duration(seconds: float) -> str:
    """Format seconds to MM:SS or HH:MM:SS."""
    if seconds is None:
        return "unknown"
    seconds = int(seconds)
    if seconds >= 3600:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        s = seconds % 60
        return f"{h}:{m:02d}:{s:02d}"
    return f"{seconds // 60}:{seconds % 60:02d}"


def format_size(size_bytes: float) -> str:
    """Format bytes to human-readable size."""
    if size_bytes is None:
        return "unknown"
    if size_bytes >= 1024 * 1024 * 1024:
        return f"{size_bytes / 1024 / 1024 / 1024:.1f} GB"
    if size_bytes >= 1024 * 1024:
        return f"{size_bytes / 1024 / 1024:.1f} MB"
    return f"{size_bytes / 1024:.0f} KB"


def _progress_hook(d):
    """Simple progress indicator."""
    if d["status"] == "downloading":
        pct = d.get("_percent_str", "?%").strip()
        speed = d.get("_speed_str", "").strip()
        eta = d.get("_eta_str", "").strip()
        line = f"\r  Downloading: {pct}"
        if speed:
            line += f" at {speed}"
        if eta:
            line += f" ETA {eta}"
        print(line + "    ", end="", flush=True)
    elif d["status"] == "finished":
        print(f"\r  Processing...                              ", end="", flush=True)


# ============================================================
# Info / Dry-run
# ============================================================


def get_video_info(url: str) -> dict:
    """Get video metadata without downloading."""
    ydl_opts = {"quiet": True, "no_warnings": True, "extract_flat": False}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(url, download=False)


def print_video_info(url: str) -> list:
    """Print video info for dry-run. Returns list of entries."""
    print(f"\nFetching info for: {url}")
    try:
        info = get_video_info(url)
    except Exception as e:
        print(f"  Error: {e}")
        return []

    entries = info.get("entries", [info])
    if info.get("_type") == "playlist":
        print(f"  Playlist: {info.get('title', 'Unknown')}")
        print(f"  Videos: {len(entries)}")

    for entry in entries:
        if entry is None:
            continue
        title = entry.get("title", "Unknown")
        duration = entry.get("duration", 0)
        # Show available resolutions
        formats = entry.get("formats", [])
        resolutions = set()
        for fmt in formats:
            h = fmt.get("height")
            if h and h >= 360:
                resolutions.add(h)
        res_str = ", ".join(f"{r}p" for r in sorted(resolutions)) if resolutions else "N/A"
        print(f"  {title} ({format_duration(duration)}) [{res_str}]")

    return entries


# ============================================================
# Trim
# ============================================================


def trim_file(input_path: str, output_path: str, start: float, end: float, is_video: bool = False) -> bool:
    """Trim an audio or video file using FFmpeg."""
    cmd = ["ffmpeg", "-y"]
    if start > 0:
        cmd.extend(["-ss", f"{start:.3f}"])
    cmd.extend(["-i", input_path])
    if end > 0:
        cmd.extend(["-t", f"{end - start:.3f}"])
    if is_video:
        cmd.extend(["-c:v", "libx264", "-preset", "fast", "-c:a", "aac"])
    else:
        cmd.extend(["-c:a", "libmp3lame", "-b:a", "192k"])
    cmd.append(output_path)

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    return result.returncode == 0


# ============================================================
# Download: Audio
# ============================================================


def download_audio(
    url: str,
    output_dir: str = ".",
    quality: int = 192,
    filename: str = None,
    start: float = 0,
    end: float = 0,
    verbose: bool = False,
) -> list:
    """Download audio from a YouTube URL as MP3."""
    os.makedirs(output_dir, exist_ok=True)

    if filename:
        outtmpl = os.path.join(output_dir, f"{filename}.%(ext)s")
    else:
        outtmpl = os.path.join(output_dir, "%(title)s.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(quality),
            }
        ],
        "outtmpl": outtmpl,
        "quiet": not verbose,
        "no_warnings": not verbose,
        "progress_hooks": [_progress_hook] if not verbose else [],
    }

    downloaded = []

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            entries = info.get("entries", [info])
            for entry in entries:
                if entry is None:
                    continue
                title = entry.get("title", "Unknown")
                if filename:
                    mp3_path = os.path.join(output_dir, f"{filename}.mp3")
                else:
                    sanitized = yt_dlp.utils.sanitize_filename(title)
                    mp3_path = os.path.join(output_dir, f"{sanitized}.mp3")
                if os.path.exists(mp3_path):
                    downloaded.append(mp3_path)
                    print(f"\n  Saved: {os.path.basename(mp3_path)} ({format_size(os.path.getsize(mp3_path))})")

    except yt_dlp.utils.DownloadError as e:
        print(f"\n  Download error: {e}")
        return downloaded
    except Exception as e:
        print(f"\n  Error: {e}")
        return downloaded

    # Trim if requested
    if (start > 0 or end > 0) and downloaded:
        downloaded = _trim_files(downloaded, start, end, is_video=False)

    return downloaded


# ============================================================
# Download: Video
# ============================================================


RESOLUTION_MAP = {
    "360": 360, "360p": 360,
    "480": 480, "480p": 480,
    "720": 720, "720p": 720, "hd": 720,
    "1080": 1080, "1080p": 1080, "fullhd": 1080, "fhd": 1080,
    "1440": 1440, "1440p": 1440, "2k": 1440, "qhd": 1440,
    "2160": 2160, "2160p": 2160, "4k": 2160, "uhd": 2160,
    "best": 0,
}


def parse_resolution(res_str: str) -> int:
    """Parse resolution string to height in pixels. 0 means best available."""
    if res_str is None:
        return 0
    key = res_str.lower().strip()
    if key in RESOLUTION_MAP:
        return RESOLUTION_MAP[key]
    try:
        return int(key)
    except ValueError:
        print(f"Warning: Unknown resolution '{res_str}', using best available")
        return 0


def download_video(
    url: str,
    output_dir: str = ".",
    resolution: int = 0,
    filename: str = None,
    start: float = 0,
    end: float = 0,
    verbose: bool = False,
) -> list:
    """Download video from a YouTube URL as MP4."""
    os.makedirs(output_dir, exist_ok=True)

    if filename:
        outtmpl = os.path.join(output_dir, f"{filename}.%(ext)s")
    else:
        outtmpl = os.path.join(output_dir, "%(title)s.%(ext)s")

    # Build format string based on resolution
    if resolution > 0:
        fmt = f"bestvideo[height<={resolution}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={resolution}]+bestaudio/best[height<={resolution}]/best"
    else:
        fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"

    ydl_opts = {
        "format": fmt,
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
        "quiet": not verbose,
        "no_warnings": not verbose,
        "progress_hooks": [_progress_hook] if not verbose else [],
    }

    downloaded = []

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            entries = info.get("entries", [info])
            for entry in entries:
                if entry is None:
                    continue
                title = entry.get("title", "Unknown")
                if filename:
                    mp4_path = os.path.join(output_dir, f"{filename}.mp4")
                else:
                    sanitized = yt_dlp.utils.sanitize_filename(title)
                    mp4_path = os.path.join(output_dir, f"{sanitized}.mp4")
                if os.path.exists(mp4_path):
                    downloaded.append(mp4_path)
                    print(f"\n  Saved: {os.path.basename(mp4_path)} ({format_size(os.path.getsize(mp4_path))})")

    except yt_dlp.utils.DownloadError as e:
        print(f"\n  Download error: {e}")
        return downloaded
    except Exception as e:
        print(f"\n  Error: {e}")
        return downloaded

    # Trim if requested
    if (start > 0 or end > 0) and downloaded:
        downloaded = _trim_files(downloaded, start, end, is_video=True)

    return downloaded


# ============================================================
# Shared trim helper
# ============================================================


def _trim_files(files: list, start: float, end: float, is_video: bool) -> list:
    """Trim a list of downloaded files in-place."""
    trimmed = []
    ext = ".mp4" if is_video else ".mp3"
    for path in files:
        trimmed_path = path.replace(ext, f"_trimmed{ext}")
        print(f"  Trimming: {format_duration(start)} -> {format_duration(end) if end > 0 else 'end'}")
        if trim_file(path, trimmed_path, start, end, is_video=is_video):
            os.replace(trimmed_path, path)
            trimmed.append(path)
            print(f"  Trimmed: {os.path.basename(path)} ({format_size(os.path.getsize(path))})")
        else:
            print(f"  Trim failed, keeping original: {os.path.basename(path)}")
            trimmed.append(path)
    return trimmed


# ============================================================
# Main
# ============================================================


def main():
    parser = argparse.ArgumentParser(
        description="Download audio or video from YouTube",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Audio (default)
  python youtube_dl.py "URL"
  python youtube_dl.py "URL" --quality 320 --output-dir music/

  # Video
  python youtube_dl.py "URL" --video
  python youtube_dl.py "URL" --video --resolution 1080
  python youtube_dl.py "URL" --video --resolution 4k

  # Both audio + video
  python youtube_dl.py "URL" --both

  # Trim
  python youtube_dl.py "URL" --start 30 --end 90
  python youtube_dl.py "URL" --video --start 1:30 --end 2:45

  # Batch
  python youtube_dl.py --from-file urls.txt -o downloads/ --yes

  # Dry-run
  python youtube_dl.py "URL" --dry-run
        """,
    )

    # URLs
    parser.add_argument("urls", nargs="*", help="YouTube URL(s) to download")
    parser.add_argument("--from-file", help="Read URLs from file (one per line)")

    # Mode
    parser.add_argument("--video", action="store_true",
                       help="Download video (MP4) instead of audio")
    parser.add_argument("--both", action="store_true",
                       help="Download both audio (MP3) and video (MP4)")

    # Output
    parser.add_argument("--output-dir", "-o", default=".", help="Output directory (default: current)")
    parser.add_argument("--filename", "-f", help="Custom output filename (without extension)")

    # Audio options
    parser.add_argument("--quality", "-q", type=int, default=192,
                       choices=[64, 128, 192, 256, 320],
                       help="MP3 bitrate in kbps (default: 192)")

    # Video options
    parser.add_argument("--resolution", "-r", default=None,
                       help="Video resolution: 360, 480, 720, 1080, 1440, 2160, 4k, best (default: best)")

    # Trim
    parser.add_argument("--start", "-s", default=None, help="Trim start time (seconds or MM:SS or HH:MM:SS)")
    parser.add_argument("--end", "-e", default=None, help="Trim end time (seconds or MM:SS or HH:MM:SS)")

    # Behavior
    parser.add_argument("--dry-run", action="store_true", help="Show info without downloading")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show detailed yt-dlp progress")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation for batch downloads")

    args = parser.parse_args()

    # Collect URLs
    urls = list(args.urls) if args.urls else []
    if args.from_file:
        if not os.path.exists(args.from_file):
            print(f"Error: File not found: {args.from_file}")
            sys.exit(1)
        with open(args.from_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    urls.append(line)

    if not urls:
        print("Error: No URLs provided. Pass URLs as arguments or use --from-file.")
        parser.print_help()
        sys.exit(1)

    if not check_ffmpeg():
        print("Error: FFmpeg not found. Install with: brew install ffmpeg")
        sys.exit(1)

    # Determine mode
    download_audio_flag = not args.video or args.both
    download_video_flag = args.video or args.both

    # Parse options
    start_time = parse_time(args.start) if args.start else 0
    end_time = parse_time(args.end) if args.end else 0
    resolution = parse_resolution(args.resolution)
    res_label = f"{resolution}p" if resolution > 0 else "best"

    # Determine mode label
    if args.both:
        mode_label = "audio (MP3) + video (MP4)"
    elif args.video:
        mode_label = f"video (MP4, {res_label})"
    else:
        mode_label = f"audio (MP3, {args.quality} kbps)"

    # Summary
    print(f"\nYouTube Downloader")
    print(f"{'='*50}")
    print(f"  URLs: {len(urls)}")
    print(f"  Mode: {mode_label}")
    print(f"  Output: {os.path.abspath(args.output_dir)}")
    if start_time > 0 or end_time > 0:
        print(f"  Trim: {format_duration(start_time)} -> {format_duration(end_time) if end_time > 0 else 'end'}")
    if args.dry_run:
        print(f"  DRY RUN")
    print(f"{'='*50}")

    # Dry-run
    if args.dry_run:
        for url in urls:
            print_video_info(url)
        return

    # Confirmation for batch
    if not args.yes and len(urls) > 1:
        confirm = input(f"\nDownload {len(urls)} items? (y/n): ").strip().lower()
        if confirm not in ("y", "yes"):
            print("Cancelled.")
            return

    # Download
    all_downloaded = []

    for i, url in enumerate(urls, 1):
        if len(urls) > 1:
            print(f"\n[{i}/{len(urls)}] {url}")
        else:
            print(f"\n{url}")

        fname = args.filename if len(urls) == 1 else None

        if download_audio_flag:
            files = download_audio(
                url=url, output_dir=args.output_dir, quality=args.quality,
                filename=fname, start=start_time, end=end_time, verbose=args.verbose,
            )
            all_downloaded.extend(files)

        if download_video_flag:
            files = download_video(
                url=url, output_dir=args.output_dir, resolution=resolution,
                filename=fname, start=start_time, end=end_time, verbose=args.verbose,
            )
            all_downloaded.extend(files)

    # Summary
    print(f"\n{'='*50}")
    print(f"Downloaded: {len(all_downloaded)} file(s)")
    total_size = 0
    for f in all_downloaded:
        size = os.path.getsize(f)
        total_size += size
        print(f"  {os.path.basename(f)} ({format_size(size)})")
    if total_size > 0:
        print(f"  Total: {format_size(total_size)}")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    main()
