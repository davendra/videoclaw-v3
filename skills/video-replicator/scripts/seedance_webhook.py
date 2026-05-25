#!/usr/bin/env python3
"""
Webhook receiver for xskill.ai Seedance task callbacks.

Replaces polling with push-based notifications. When a Seedance task is
created with a ``callback_url``, xskill.ai POSTs status changes here.

Three components:

1. **WebhookEventStore** -- thread-safe task registry with waitable events
2. **WebhookHandler** -- HTTP request handler (POST /webhook/seedance, GET /health)
3. **WebhookServer** -- lifecycle manager (daemon thread + optional ngrok tunnel)

Usage (library, not CLI)::

    from seedance_webhook import start_webhook_server, stop_webhook_server

    server = start_webhook_server()
    callback_url = server.get_callback_url()  # public ngrok URL or None

    event = server.event_store.register_task(task_id)
    # ... create Seedance task with callback_url ...
    event.wait(timeout=600)
    result = server.event_store.get_latest(task_id)

    server.event_store.unregister_task(task_id)
    stop_webhook_server()
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional

from logging_config import setup_logging

logger = setup_logging(__name__)

# Optional pyngrok -- gracefully degrade when not installed.
try:
    from pyngrok import ngrok as _ngrok

    _HAS_NGROK = True
except ImportError:
    _ngrok = None  # type: ignore[assignment]
    _HAS_NGROK = False


# ============================================================================
# Data types
# ============================================================================


@dataclass
class TaskEvent:
    """Immutable snapshot of a webhook callback for a single task."""

    task_id: str
    status: str
    payload: dict = field(default_factory=dict)
    updated_at: str = ""


# ============================================================================
# WebhookEventStore
# ============================================================================


class WebhookEventStore:
    """Thread-safe registry of tasks awaiting webhook callbacks.

    Each registered task gets a :class:`threading.Event` that is set when
    the first qualifying callback arrives.  Duplicate deliveries (same
    ``(task_id, updated_at)`` pair) are silently ignored.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # task_id -> threading.Event (waitable)
        self._events: dict[str, threading.Event] = {}
        # task_id -> latest TaskEvent
        self._latest: dict[str, TaskEvent] = {}
        # dedup set of (task_id, updated_at)
        self._seen: set[tuple[str, str]] = set()

    def register_task(self, task_id: str) -> threading.Event:
        """Register *task_id* and return a waitable :class:`threading.Event`.

        Calling :meth:`deliver` for this task will set the event.
        """
        with self._lock:
            if task_id in self._events:
                return self._events[task_id]
            evt = threading.Event()
            self._events[task_id] = evt
            return evt

    def deliver(self, task_id: str, status: str, payload: dict) -> bool:
        """Deliver a webhook event for *task_id*.

        Returns ``True`` if this is a new (non-duplicate) event, ``False``
        if the ``(task_id, updated_at)`` pair was already seen.
        """
        updated_at = (
            payload.get("data", {}).get("updated_at", "")
            or payload.get("updated_at", "")
        )
        dedup_key = (task_id, updated_at)

        with self._lock:
            if dedup_key in self._seen:
                return False
            self._seen.add(dedup_key)

            event_obj = TaskEvent(
                task_id=task_id,
                status=status,
                payload=payload,
                updated_at=updated_at,
            )
            self._latest[task_id] = event_obj

            waiter = self._events.get(task_id)
            if waiter is not None:
                waiter.set()

        return True

    def get_latest(self, task_id: str) -> Optional[TaskEvent]:
        """Return the most recent :class:`TaskEvent` for *task_id*, or ``None``."""
        with self._lock:
            return self._latest.get(task_id)

    def unregister_task(self, task_id: str) -> None:
        """Remove all state associated with *task_id*."""
        with self._lock:
            self._events.pop(task_id, None)
            self._latest.pop(task_id, None)
            # Prune dedup entries for this task
            self._seen = {
                key for key in self._seen if key[0] != task_id
            }


# ============================================================================
# WebhookHandler
# ============================================================================

# Module-level reference set by WebhookServer before the HTTPServer starts.
_event_store: Optional[WebhookEventStore] = None


class WebhookHandler(BaseHTTPRequestHandler):
    """Minimal HTTP handler for Seedance webhook callbacks."""

    # Silence default stderr logging -- route through project logger instead.
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        logger.debug(format, *args)

    # ------------------------------------------------------------------
    # Routes
    # ------------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._respond(200, {"status": "ok"})
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/webhook/seedance":
            self._handle_seedance_callback()
        else:
            self._respond(404, {"error": "not found"})

    # ------------------------------------------------------------------
    # Seedance callback logic
    # ------------------------------------------------------------------

    def _handle_seedance_callback(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._respond(400, {"error": "empty body"})
            return

        raw = self.rfile.read(content_length)
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            logger.warning("Invalid JSON in webhook body: %s", exc)
            self._respond(400, {"error": "invalid JSON"})
            return

        data = payload.get("data", {})
        task_id = data.get("task_id", "")
        status = data.get("status", "")

        if not task_id:
            logger.warning("Webhook payload missing data.task_id")
            self._respond(400, {"error": "missing data.task_id"})
            return

        store = _event_store
        if store is None:
            # Server is shutting down or misconfigured; accept anyway.
            logger.warning("Event store unavailable, accepting payload for task %s", task_id)
            self._respond(200, {"accepted": True})
            return

        is_new = store.deliver(task_id, status, payload)
        if is_new:
            logger.info("Webhook delivered: task=%s status=%s", task_id, status)
        else:
            logger.debug("Webhook duplicate ignored: task=%s", task_id)

        # Always return 200 -- even for unknown tasks (may be a race where
        # registration hasn't happened yet, or task was already unregistered).
        self._respond(200, {"accepted": True})

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _respond(self, code: int, body: dict) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())


# ============================================================================
# WebhookServer
# ============================================================================


class WebhookServer:
    """Manages the webhook HTTP server lifecycle and optional ngrok tunnel."""

    def __init__(self) -> None:
        self._server: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._tunnel: object = None  # pyngrok tunnel object
        self._tunnel_url: Optional[str] = None
        self._store = WebhookEventStore()

    @property
    def event_store(self) -> WebhookEventStore:
        """Access the underlying :class:`WebhookEventStore`."""
        return self._store

    def start(self, port: int = 0, use_tunnel: bool = True) -> None:
        """Start the HTTP server on a daemon thread.

        Args:
            port: TCP port to bind. ``0`` lets the OS pick a free port.
            use_tunnel: If ``True`` and pyngrok is installed, open an ngrok
                tunnel to make the server publicly reachable.
        """
        global _event_store  # noqa: PLW0603
        _event_store = self._store

        self._server = HTTPServer(("0.0.0.0", port), WebhookHandler)
        actual_port = self._server.server_address[1]
        logger.info("Webhook server listening on port %d", actual_port)

        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="seedance-webhook",
            daemon=True,
        )
        self._thread.start()

        # Attempt ngrok tunnel
        if use_tunnel and _HAS_NGROK:
            try:
                self._tunnel = _ngrok.connect(actual_port, "http")
                self._tunnel_url = self._tunnel.public_url  # type: ignore[union-attr]
                logger.info("ngrok tunnel active: %s", self._tunnel_url)
            except Exception as exc:
                logger.warning("ngrok tunnel failed, webhook will be local-only: %s", exc)
                self._tunnel = None
                self._tunnel_url = None
        elif use_tunnel and not _HAS_NGROK:
            logger.debug("pyngrok not installed -- skipping tunnel")

    def stop(self) -> None:
        """Shutdown the HTTP server and close any ngrok tunnel."""
        global _event_store  # noqa: PLW0603

        if self._tunnel is not None and _HAS_NGROK:
            try:
                _ngrok.disconnect(self._tunnel.public_url)  # type: ignore[union-attr]
                logger.info("ngrok tunnel closed")
            except Exception as exc:
                logger.debug("Error closing ngrok tunnel: %s", exc)
            self._tunnel = None
            self._tunnel_url = None

        if self._server is not None:
            self._server.shutdown()
            logger.info("Webhook server stopped")
            self._server = None

        self._thread = None
        _event_store = None

    def get_callback_url(self) -> Optional[str]:
        """Return the public webhook URL, or ``None`` if no tunnel is active.

        The full callback path is ``{tunnel_url}/webhook/seedance``.
        """
        if self._tunnel_url:
            return f"{self._tunnel_url}/webhook/seedance"
        return None


# ============================================================================
# Module-level singleton
# ============================================================================

_singleton: Optional[WebhookServer] = None
_singleton_lock = threading.Lock()


def get_webhook_server() -> Optional[WebhookServer]:
    """Return the current singleton :class:`WebhookServer`, or ``None``."""
    return _singleton


def start_webhook_server(port: int = 0, use_tunnel: bool = True) -> WebhookServer:
    """Create (or return existing) singleton :class:`WebhookServer` and start it.

    Args:
        port: TCP port. ``0`` for OS auto-assign.
        use_tunnel: Whether to attempt an ngrok tunnel.

    Returns:
        The running :class:`WebhookServer` instance.
    """
    global _singleton  # noqa: PLW0603
    with _singleton_lock:
        if _singleton is not None:
            return _singleton
        server = WebhookServer()
        server.start(port=port, use_tunnel=use_tunnel)
        _singleton = server
        return server


def stop_webhook_server() -> None:
    """Stop and discard the singleton :class:`WebhookServer`."""
    global _singleton  # noqa: PLW0603
    with _singleton_lock:
        if _singleton is not None:
            _singleton.stop()
            _singleton = None
