#!/usr/bin/env python3
"""
Shared FFmpeg/ffprobe wrapper with consistent error handling.

Provides a thin interface around subprocess calls to ffmpeg and ffprobe,
with proper timeout handling, dependency checking, and typed return values.

Usage:
    from ffmpeg_wrapper import FFmpegWrapper, run_ffmpeg, run_ffprobe

    # Class-based usage
    ff = FFmpegWrapper(timeout=120)
    result = ff.run(["-i", "input.mp4", "-c:v", "libx264", "output.mp4"])
    duration = ff.get_duration("video.mp4")
    width, height = ff.get_dimensions("video.mp4")

    # Module-level convenience functions (use default singleton)
    result = run_ffmpeg(["-i", "input.mp4", "-c:v", "libx264", "output.mp4"])
    stdout = run_ffprobe("video.mp4", entries="format=duration")
"""

import os
import subprocess

from config import FFMPEG_TIMEOUT, FFPROBE_TIMEOUT
from exceptions import MissingDependencyError, VideoProcessingError


class FFmpegWrapper:
    """Shared FFmpeg/ffprobe interface with consistent error handling."""

    def __init__(self, timeout: int = None):
        """
        Initialize with optional timeout override.

        Args:
            timeout: Default timeout in seconds for FFmpeg commands.
                     Defaults to config.FFMPEG_TIMEOUT (300s).
        """
        self._timeout = timeout if timeout is not None else FFMPEG_TIMEOUT

    def run(
        self,
        args: list[str],
        timeout: int = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess:
        """
        Run an FFmpeg command.

        The ``-y`` flag (overwrite output without asking) is prepended
        automatically so callers never block on interactive prompts.

        Args:
            args: Command arguments *without* the ``ffmpeg`` prefix —
                  it is added automatically.
            timeout: Override timeout in seconds. Falls back to the
                     instance default when ``None``.
            check: If ``True``, raise ``VideoProcessingError`` on a
                   non-zero exit code.

        Returns:
            subprocess.CompletedProcess with captured stdout/stderr.

        Raises:
            VideoProcessingError: If the command fails and *check* is True,
                or if the command times out.
            MissingDependencyError: If ``ffmpeg`` is not installed.
        """
        cmd = ["ffmpeg", "-y"] + args
        effective_timeout = timeout if timeout is not None else self._timeout

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=effective_timeout,
            )
        except FileNotFoundError as err:
            raise MissingDependencyError(
                "ffmpeg not found. Install with: brew install ffmpeg"
            ) from err
        except subprocess.TimeoutExpired as err:
            raise VideoProcessingError(
                f"FFmpeg timed out after {effective_timeout}s. "
                f"Command: ffmpeg {' '.join(args[:6])}..."
            ) from err

        if check and result.returncode != 0:
            stderr_snippet = (result.stderr or "").strip()[:500]
            raise VideoProcessingError(
                f"FFmpeg exited with code {result.returncode}.\n"
                f"Command: ffmpeg {' '.join(args[:6])}...\n"
                f"stderr: {stderr_snippet}"
            )

        return result

    def probe(
        self,
        file_path: str,
        entries: str = None,
        select_streams: str = None,
        timeout: int = None,
    ) -> str:
        """
        Run ffprobe and return stdout.

        Args:
            file_path: Path to media file.
            entries: What to show, e.g. ``"format=duration"`` or
                     ``"stream=width,height"``.
            select_streams: Stream selector, e.g. ``"v:0"`` or ``"a:0"``.
            timeout: Override timeout in seconds. Falls back to
                     ``config.FFPROBE_TIMEOUT`` (10s).

        Returns:
            Raw stdout string from ffprobe (stripped of trailing whitespace).

        Raises:
            VideoProcessingError: If ffprobe exits with a non-zero code
                or times out.
            MissingDependencyError: If ``ffprobe`` is not installed.
            FileNotFoundError: If *file_path* does not exist.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Media file not found: {file_path}")

        cmd = ["ffprobe", "-v", "error"]

        if select_streams:
            cmd += ["-select_streams", select_streams]

        if entries:
            cmd += ["-show_entries", entries]
            cmd += ["-of", "default=noprint_wrappers=1:nokey=1"]

        cmd.append(file_path)

        effective_timeout = timeout if timeout is not None else FFPROBE_TIMEOUT

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=effective_timeout,
            )
        except FileNotFoundError as err:
            raise MissingDependencyError(
                "ffprobe not found. Install with: brew install ffmpeg"
            ) from err
        except subprocess.TimeoutExpired as err:
            raise VideoProcessingError(
                f"ffprobe timed out after {effective_timeout}s for: {file_path}"
            ) from err

        if result.returncode != 0:
            stderr_snippet = (result.stderr or "").strip()[:500]
            raise VideoProcessingError(
                f"ffprobe failed for {file_path}.\n"
                f"stderr: {stderr_snippet}"
            )

        return result.stdout.strip()

    def get_duration(self, file_path: str) -> float | None:
        """
        Get media duration in seconds.

        Returns:
            Duration as float, or ``None`` if it cannot be determined.
        """
        try:
            output = self.probe(file_path, entries="format=duration")
            return float(output)
        except (VideoProcessingError, MissingDependencyError, FileNotFoundError,
                ValueError):
            return None

    def get_dimensions(self, file_path: str) -> tuple[int, int] | None:
        """
        Get video dimensions (width, height).

        Returns:
            Tuple of (width, height), or ``None`` if it cannot be determined.
        """
        try:
            output = self.probe(
                file_path,
                entries="stream=width,height",
                select_streams="v:0",
            )
            parts = output.split(",") if "," in output else output.split("\n")
            if len(parts) >= 2:
                return (int(parts[0].strip()), int(parts[1].strip()))
        except (VideoProcessingError, MissingDependencyError, FileNotFoundError,
                ValueError, IndexError):
            pass
        return None

    def get_fps(self, file_path: str) -> float | None:
        """
        Get video frame rate (fps).

        Probes ``r_frame_rate`` from the first video stream and parses
        the fraction (e.g. ``"30000/1001"`` → ``29.97``).

        Returns:
            Frame rate as float, or ``None`` if it cannot be determined.
        """
        try:
            output = self.probe(
                file_path,
                entries="stream=r_frame_rate",
                select_streams="v:0",
            )
            if "/" in output:
                num, den = output.split("/")
                return float(num) / float(den) if float(den) != 0 else None
            return float(output)
        except (VideoProcessingError, MissingDependencyError, FileNotFoundError,
                ValueError, ZeroDivisionError):
            return None

    def extract_frame(
        self,
        video_path: str,
        seconds: float,
        output_path: str,
    ) -> bool:
        """
        Extract a single frame from video at the given timestamp.

        Creates the output directory if it does not exist.

        Args:
            video_path: Path to the source video.
            seconds: Timestamp in seconds to extract.
            output_path: Where to write the extracted frame image.

        Returns:
            ``True`` on success, ``False`` on any failure (does NOT raise).
        """
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        try:
            self.run(
                [
                    "-ss", f"{seconds:.3f}",
                    "-i", video_path,
                    "-frames:v", "1",
                    "-q:v", "2",
                    output_path,
                ],
                timeout=30,
            )
            return os.path.exists(output_path) and os.path.getsize(output_path) > 0
        except (VideoProcessingError, MissingDependencyError):
            return False

    def concat_via_filter(
        self,
        video_files: list[str],
        output_path: str,
        crf: int = 20,
        audio_bitrate: str = "192k",
        sample_rate: int = 44100,
        channels: int = 2,
    ) -> bool:
        """
        Concatenate videos using the FFmpeg concat *filter* instead of the
        concat demuxer.

        The concat filter processes all segments through a single filter graph
        with precise timestamp computation, preventing the A/V drift that the
        concat demuxer accumulates over many (8+) segments.

        Args:
            video_files: Ordered list of video file paths to concatenate.
            output_path: Where to write the concatenated video.
            crf: H.264 CRF quality (lower = better, default 20).
            audio_bitrate: AAC audio bitrate (default "192k").
            sample_rate: Audio sample rate in Hz (default 44100).
            channels: Audio channel count (default 2 = stereo).

        Returns:
            ``True`` on success, ``False`` on any failure (does NOT raise).
        """
        if not video_files:
            return False

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        n = len(video_files)

        # Build input args: -i file0 -i file1 ... -i fileN-1
        input_args: list[str] = []
        for f in video_files:
            input_args += ["-i", f]

        # Build filter_complex:
        # [0:v][0:a][1:v][1:a]...[N-1:v][N-1:a]concat=n=N:v=1:a=1[outv][outa]
        filter_inputs = "".join(f"[{i}:v][{i}:a]" for i in range(n))
        filter_complex = (
            f"{filter_inputs}concat=n={n}:v=1:a=1[outv][outa]"
        )

        args = (
            input_args
            + [
                "-filter_complex", filter_complex,
                "-map", "[outv]",
                "-map", "[outa]",
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", str(crf),
                "-c:a", "aac",
                "-b:a", audio_bitrate,
                "-ar", str(sample_rate),
                "-ac", str(channels),
                "-movflags", "+faststart",
                output_path,
            ]
        )

        # Scale timeout with segment count — 30s per segment, minimum 120s
        timeout = max(120, n * 30)

        try:
            self.run(args, timeout=timeout)
            return os.path.exists(output_path) and os.path.getsize(output_path) > 0
        except (VideoProcessingError, MissingDependencyError):
            return False

    def auto_scale_video(
        self,
        input_path: str,
        target_width: int,
        target_height: int,
        output_path: str,
        mode: str = "fit",
    ) -> str:
        """
        Scale a video to target dimensions, preserving aspect ratio.

        Two modes are supported:

        - **fit** (default): Scale down to fit within the target box and pad
          with black bars (letterbox/pillarbox) so the output is exactly
          ``target_width x target_height``.
        - **fill**: Scale up to cover the target box and centre-crop any
          overflow so the output is exactly ``target_width x target_height``.

        Creates the output directory if it does not exist.

        Args:
            input_path: Path to the source video.
            target_width: Desired output width in pixels.
            target_height: Desired output height in pixels.
            output_path: Where to write the scaled video.
            mode: ``"fit"`` for letterbox or ``"fill"`` for crop.

        Returns:
            *output_path* on success.

        Raises:
            VideoProcessingError: If FFmpeg fails.
            ValueError: If *mode* is not ``"fit"`` or ``"fill"``.
            FileNotFoundError: If *input_path* does not exist.
        """
        if mode not in ("fit", "fill"):
            raise ValueError(f"mode must be 'fit' or 'fill', got '{mode}'")

        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Video file not found: {input_path}")

        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        w, h = target_width, target_height

        if mode == "fit":
            vf = (
                f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black"
            )
        else:  # fill
            vf = (
                f"scale={w}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h}"
            )

        self.run([
            "-i", input_path,
            "-vf", vf,
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-c:a", "copy",
            output_path,
        ])

        return output_path

    def extract_last_frame(
        self,
        video_path: str,
        output_path: str,
    ) -> bool:
        """
        Extract the last frame of a video using ``-sseof -0.1``.

        Useful for chained F2V generation where the last frame of scene N
        becomes the start frame for scene N+1.

        Creates the output directory if it does not exist.

        Args:
            video_path: Path to the source video.
            output_path: Where to write the extracted frame image.

        Returns:
            ``True`` on success, ``False`` on any failure (does NOT raise).
        """
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        try:
            self.run(
                [
                    "-sseof", "-0.1",
                    "-i", video_path,
                    "-frames:v", "1",
                    "-q:v", "2",
                    output_path,
                ],
                timeout=30,
            )
            return os.path.exists(output_path) and os.path.getsize(output_path) > 0
        except (VideoProcessingError, MissingDependencyError):
            return False


# ============================================================================
# Module-level convenience functions
# ============================================================================

_default = FFmpegWrapper()


def run_ffmpeg(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run FFmpeg using the default wrapper instance."""
    return _default.run(args, **kwargs)


def run_ffprobe(file_path: str, **kwargs) -> str:
    """Run ffprobe using the default wrapper instance."""
    return _default.probe(file_path, **kwargs)


def concat_via_filter(video_files: list[str], output_path: str, **kwargs) -> bool:
    """Concatenate videos via concat filter using the default wrapper instance.

    Use this instead of the concat demuxer for 8+ segments to prevent
    accumulated A/V timestamp drift.
    """
    return _default.concat_via_filter(video_files, output_path, **kwargs)


def auto_scale_video(
    input_path: str,
    target_width: int,
    target_height: int,
    output_path: str,
    mode: str = "fit",
) -> str:
    """Scale a video to target dimensions using the default wrapper instance.

    See ``FFmpegWrapper.auto_scale_video`` for full documentation.
    """
    return _default.auto_scale_video(
        input_path, target_width, target_height, output_path, mode=mode,
    )
