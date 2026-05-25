#!/usr/bin/env python3
"""
Structured logging configuration for video-replicator scripts.

Provides colored console output with optional file logging.
Scripts opt in by calling ``setup_logging()``:

    from logging_config import setup_logging
    logger = setup_logging(__name__)
    logger.info("Processing scene 3")

For progress-style output:

    from logging_config import ProgressLogger
    progress = ProgressLogger(total=9, prefix="Generating")
    progress.step("scene 1")   # [1/9] Generating scene 1
"""

import logging
import sys

# ============================================================================
# Color codes (ANSI)
# ============================================================================

_COLORS = {
    "DEBUG": "\033[36m",     # cyan
    "INFO": "\033[32m",      # green
    "WARNING": "\033[33m",   # yellow
    "ERROR": "\033[31m",     # red
    "CRITICAL": "\033[1;31m",  # bold red
    "RESET": "\033[0m",
}


class _ColorFormatter(logging.Formatter):
    """Formatter that adds ANSI color codes to level names."""

    def __init__(self, fmt: str, use_color: bool = True):
        super().__init__(fmt)
        self.use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        if self.use_color:
            # Save and restore levelname to avoid mutation across handlers/propagation.
            # Mutating record.levelname in-place caused RecursionError when multiple
            # handlers or propagation to the root logger triggered repeated formatting.
            original_levelname = record.levelname
            color = _COLORS.get(record.levelname, "")
            reset = _COLORS["RESET"]
            record.levelname = f"{color}{original_levelname:<7}{reset}"
            try:
                return super().format(record)
            finally:
                record.levelname = original_levelname
        return super().format(record)


def setup_logging(
    name: str,
    verbose: bool = False,
    log_file: str | None = None,
    use_color: bool = True,
) -> logging.Logger:
    """
    Configure and return a logger for a script.

    Args:
        name: Logger name (typically ``__name__``)
        verbose: If True, set level to DEBUG; otherwise INFO
        log_file: Optional path to write logs to a file
        use_color: If True, colorize console output (default: True)

    Returns:
        Configured ``logging.Logger``
    """
    logger = logging.getLogger(name)

    # Avoid duplicate handlers if called multiple times
    if logger.handlers:
        return logger

    level = logging.DEBUG if verbose else logging.INFO
    logger.setLevel(level)

    # Prevent propagation to root logger — avoids double-formatting and
    # RecursionError when the root logger has its own handlers.
    logger.propagate = False

    # Console handler with color
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    fmt = "%(levelname)s %(message)s"
    console.setFormatter(_ColorFormatter(fmt, use_color=use_color))
    logger.addHandler(console)

    # Optional file handler (no color)
    if log_file:
        file_handler = logging.FileHandler(log_file, mode="a")
        file_handler.setLevel(logging.DEBUG)
        file_fmt = "%(asctime)s %(levelname)-7s %(name)s %(message)s"
        file_handler.setFormatter(logging.Formatter(file_fmt))
        logger.addHandler(file_handler)

    return logger


class ProgressLogger:
    """
    Helper for ``[3/9] Processing scene 3`` style output.

    Usage::

        progress = ProgressLogger(total=9, prefix="Generating")
        progress.step("scene 1")   # [1/9] Generating scene 1
        progress.step("scene 2")   # [2/9] Generating scene 2
    """

    def __init__(
        self,
        total: int,
        prefix: str = "Processing",
        logger: logging.Logger | None = None,
    ):
        self.total = total
        self.prefix = prefix
        self.current = 0
        self.logger = logger

    def step(self, description: str) -> None:
        """Log next step with progress counter."""
        self.current += 1
        msg = f"[{self.current}/{self.total}] {self.prefix} {description}"
        if self.logger:
            self.logger.info(msg)
        else:
            print(msg, flush=True)

    def reset(self) -> None:
        """Reset counter to zero."""
        self.current = 0
