"""Supabase access for the worker.

Jobs talk to the ``AnalysisStore`` protocol rather than the Supabase client
directly, which keeps them testable with an in-memory fake and keeps every
query the worker issues in one place.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Protocol

from prosody_worker.config import (
    ATTEMPT_BUCKET,
    AUDIO_BUCKET,
    CLAIM_TIMEOUT_SECONDS,
    DRAIN_TIMEOUT_SECONDS,
    MAX_ATTEMPTS,
    MAX_WORKERS,
    RESERVATION_MARGIN_SECONDS,
    WAITING_PER_WORKER,
    WorkerConfig,
)

log = logging.getLogger(__name__)

Row = dict[str, Any]

log = logging.getLogger("prosody_worker")

# How long the worker trusts a claim_timeout read from job_settings.
SETTINGS_TTL_SECONDS = 5 * 60

_INTERVAL = re.compile(
    r"^\s*(?:(?P<days>-?\d+) days?)?\s*"
    r"(?:(?P<sign>-)?(?P<hours>\d+):(?P<minutes>\d{2}):(?P<seconds>\d{2}(?:\.\d+)?))?\s*$"
)


def parse_interval(value: str) -> float:
    """Seconds in a Postgres interval as PostgREST returns it, e.g. "00:15:00"
    or "1 day 02:00:00". Month and year units have no fixed length and are
    rejected, like any other format."""
    match = _INTERVAL.match(value)
    if not match or not (match["days"] or match["hours"]):
        raise ValueError(f"unsupported interval: {value!r}")
    seconds = int(match["hours"] or 0) * 3600 + int(match["minutes"] or 0) * 60 + float(match["seconds"] or 0)
    if match["sign"]:
        seconds = -seconds
    return int(match["days"] or 0) * 86400 + seconds


class AnalysisStore(Protocol):
    def claim_next(self, analyzer_version: str) -> Row | None: ...

    def download_audio(self, path: str) -> bytes: ...

    def complete(self, row_id: str, fields: Row) -> None: ...

    def fail(self, row_id: str, message: str) -> None: ...

    def upload_audio(self, path: str, data: bytes, content_type: str = "audio/wav", upsert: bool = False) -> None: ...

    def save_generation(self, row_id: str, generation: Row) -> None: ...

    def upsert_ready(self, fields: Row) -> Row: ...


class AttemptStore(Protocol):
    def claim_next_attempt(self, analyzer_version: str) -> Row | None: ...

    def fetch_reference(self, analysis_id: str) -> Row | None: ...

    def download_attempt_audio(self, path: str) -> bytes: ...

    def download_clip(self, path: str) -> bytes: ...

    def complete_attempt(self, row_id: str, fields: Row) -> None: ...

    def fail_attempt(self, row_id: str, message: str) -> None: ...


class WorkerPool(Protocol):
    """Reservations for the hosted workers (see prosody_worker/scaling.py)."""

    def reserve_workers(self, queue: str, analyzer_version: str) -> list[str]: ...

    def release_worker(self, worker_id: str) -> None: ...


class SupabaseStore:
    """``AnalysisStore``, ``AttemptStore`` and ``WorkerPool`` backed by
    supabase-py with the service-role key. The client is not shared across
    threads, so each worker thread builds its own store.

    A store remembers the claim token of each row it claimed, and writes a
    result back only while the row still carries that token."""

    def __init__(self, config: WorkerConfig) -> None:
        try:
            from supabase import create_client
        except ImportError as exc:
            raise RuntimeError(
                "supabase is not installed; pip install -r requirements-worker.txt"
            ) from exc
        self._client = create_client(config.supabase_url, config.service_role_key)
        self._tokens: dict[str, str] = {}

    def _table(self, name: str = "analyses"):
        return self._client.table(name)

    def claim_next(self, analyzer_version: str) -> Row | None:
        return self._claim_next("claim_next_analysis", analyzer_version)

    def _claim_next(self, function: str, analyzer_version: str) -> Row | None:
        """Claim the oldest pending row in one statement (FOR UPDATE SKIP
        LOCKED), so workers asking at the same moment get different rows.

        The function also marks failed any row that has used up its
        attempts (a worker kept dying on it) instead of retrying it forever.
        """
        response = self._client.rpc(function, {
            "p_analyzer_version": analyzer_version,
            "p_claim_timeout_seconds": CLAIM_TIMEOUT_SECONDS,
            "p_max_attempts": MAX_ATTEMPTS,
        }).execute()
        row = response.data
        if not row:
            return None
        self._tokens[row["id"]] = row["claim_token"]
        return row

    def download_audio(self, path: str) -> bytes:
        return self._client.storage.from_(AUDIO_BUCKET).download(path)

    def complete(self, row_id: str, fields: Row) -> None:
        self._complete("analyses", row_id, fields)

    def fail(self, row_id: str, message: str) -> None:
        self._fail("analyses", row_id, message)

    def _complete(self, table: str, row_id: str, fields: Row) -> None:
        self._finish(table, row_id, {**fields, "status": "ready", "error": None})

    def _fail(self, table: str, row_id: str, message: str) -> None:
        self._finish(table, row_id, {"status": "failed", "error": message[:500]})

    def _finish(self, table: str, row_id: str, fields: Row) -> None:
        query = self._table(table).update(fields).eq("id", row_id)
        token = self._tokens.pop(row_id, None)
        if token:
            query = query.eq("claim_token", token)
        response = query.execute()
        if token and not response.data:
            log.warning("%s %s was claimed again by another worker; result discarded", table, row_id)

    def upload_audio(self, path: str, data: bytes, content_type: str = "audio/wav", upsert: bool = False) -> None:
        """Store reference audio. Upload paths are content-addressed, so an
        object that already exists holds these exact bytes and is left
        alone. Listening clips are keyed by analysis id and are replaced."""
        try:
            self._client.storage.from_(AUDIO_BUCKET).upload(
                path, data, {"content-type": content_type, "upsert": "true" if upsert else "false"}
            )
        except Exception as exc:  # storage client raises its own error types
            if not re.search(r"exists|duplicate", str(exc), re.IGNORECASE):
                raise

    def save_generation(self, row_id: str, generation: Row) -> None:
        """Record a generated clip whose audio is stored, so a retry reuses it."""
        self._table().update({"generation": generation}).eq("id", row_id).execute()

    def upsert_ready(self, fields: Row) -> Row:
        """Insert or overwrite a finished analysis for its source and engine settings."""
        response = (
            self._table()
            .upsert(
                {**fields, "status": "ready", "error": None, "claimed_at": None},
                on_conflict="source_key,model_size,analyzer_version",
            )
            .execute()
        )
        return response.data[0]

    # -- attempts --------------------------------------------------------

    def claim_next_attempt(self, analyzer_version: str) -> Row | None:
        return self._claim_next("claim_next_attempt", analyzer_version)

    def fetch_reference(self, analysis_id: str) -> Row | None:
        """The reference ``recording`` and its listening ``clip_path``."""
        response = self._table().select("recording,clip_path").eq("id", analysis_id).limit(1).execute()
        rows = response.data or []
        return rows[0] if rows else None

    def download_clip(self, path: str) -> bytes:
        return self.download_audio(path)

    def download_attempt_audio(self, path: str) -> bytes:
        return self._client.storage.from_(ATTEMPT_BUCKET).download(path)

    def complete_attempt(self, row_id: str, fields: Row) -> None:
        self._complete("attempts", row_id, fields)

    def fail_attempt(self, row_id: str, message: str) -> None:
        self._fail("attempts", row_id, message)

    # -- worker pool -----------------------------------------------------

    def reserve_workers(self, queue: str, analyzer_version: str) -> list[str]:
        """Reserve the workers ``queue`` is short of and return their ids."""
        response = self._client.rpc("reserve_workers", {
            "p_queue": queue,
            "p_analyzer_version": analyzer_version,
            "p_waiting_per_worker": WAITING_PER_WORKER,
            "p_max_workers": MAX_WORKERS[queue],
            "p_lifetime_seconds": DRAIN_TIMEOUT_SECONDS[queue] + RESERVATION_MARGIN_SECONDS,
            "p_claim_timeout_seconds": CLAIM_TIMEOUT_SECONDS,
        }).execute()
        return list(response.data or [])

    def release_worker(self, worker_id: str) -> None:
        self._table("queue_workers").delete().eq("id", worker_id).execute()
