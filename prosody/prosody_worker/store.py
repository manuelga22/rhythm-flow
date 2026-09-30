"""Supabase access for the worker.

Jobs talk to the ``AnalysisStore`` protocol rather than the Supabase client
directly, which keeps them testable with an in-memory fake and keeps every
query the worker issues in one place.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from prosody_worker.config import (
    ATTEMPT_BUCKET,
    AUDIO_BUCKET,
    CLAIM_TIMEOUT_SECONDS,
    MAX_ATTEMPTS,
    WorkerConfig,
)

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
    def fetch_pending(self, analyzer_version: str, limit: int) -> list[Row]: ...

    def claim(self, row: Row) -> bool: ...

    def download_audio(self, path: str) -> bytes: ...

    def complete(self, row_id: str, fields: Row) -> None: ...

    def fail(self, row_id: str, message: str) -> None: ...

    def upload_audio(self, path: str, data: bytes, content_type: str = "audio/wav", upsert: bool = False) -> None: ...

    def save_generation(self, row_id: str, generation: Row) -> None: ...

    def upsert_ready(self, fields: Row) -> Row: ...


class AttemptStore(Protocol):
    def fetch_pending_attempts(self, analyzer_version: str, limit: int) -> list[Row]: ...

    def claim_attempt(self, row: Row) -> bool: ...

    def fetch_reference(self, analysis_id: str) -> Row | None: ...

    def download_attempt_audio(self, path: str) -> bytes: ...

    def download_clip(self, path: str) -> bytes: ...

    def complete_attempt(self, row_id: str, fields: Row) -> None: ...

    def fail_attempt(self, row_id: str, message: str) -> None: ...


class SupabaseStore:
    """``AnalysisStore`` and ``AttemptStore`` backed by supabase-py with the
    service-role key. The client is not shared across threads, so each
    worker thread builds its own store."""

    def __init__(self, config: WorkerConfig) -> None:
        try:
            from supabase import create_client
        except ImportError as exc:
            raise RuntimeError(
                "supabase is not installed; pip install -r requirements-worker.txt"
            ) from exc
        self._client = create_client(config.supabase_url, config.service_role_key)
        # queue -> (claim timeout in seconds, when it was read)
        self._claim_timeouts: dict[str, tuple[float, float]] = {}

    def _table(self, name: str = "analyses"):
        return self._client.table(name)

    def fetch_pending(self, analyzer_version: str, limit: int) -> list[Row]:
        return self._fetch_pending(
            "analyses", "id,source_type,source_key,title,model_size,audio_path,generation,attempts",
            analyzer_version, limit,
        )

    def claim_timeout(self, queue: str) -> float:
        """Seconds before a claimed row in ``queue`` may be claimed again.

        Read from job_settings, which the database watchdog uses too, so the
        two agree on when a job is abandoned. Falls back to
        CLAIM_TIMEOUT_SECONDS on a database without the table.
        """
        cached = self._claim_timeouts.get(queue)
        now = time.monotonic()
        if cached and now - cached[1] < SETTINGS_TTL_SECONDS:
            return cached[0]
        seconds = float(CLAIM_TIMEOUT_SECONDS)
        try:
            response = self._table("job_settings").select("claim_timeout").eq("queue", queue).limit(1).execute()
            rows = response.data or []
            if rows:
                seconds = parse_interval(rows[0]["claim_timeout"])
        except Exception:  # missing table, bad value, dropped connection
            log.warning("using the default claim timeout for %s", queue, exc_info=True)
        self._claim_timeouts[queue] = (seconds, now)
        return seconds

    def _fetch_pending(self, table: str, columns: str, analyzer_version: str, limit: int) -> list[Row]:
        stale = (datetime.now(timezone.utc) - timedelta(seconds=self.claim_timeout(table))).isoformat()
        response = (
            self._table(table)
            .select(columns)
            .eq("status", "processing")
            .eq("analyzer_version", analyzer_version)
            .or_(f"claimed_at.is.null,claimed_at.lt.{stale}")
            .order("created_at")
            .limit(limit)
            .execute()
        )
        return list(response.data or [])

    def claim(self, row: Row) -> bool:
        return self._claim("analyses", row, "Analysis did not finish after several attempts.")

    def _claim(self, table: str, row: Row, gave_up: str) -> bool:
        """Compare-and-set on ``attempts`` so only one worker wins a row.

        Rows that have already used up their attempts (a worker kept dying
        on them) are marked failed instead of being retried forever.
        """
        attempts = int(row.get("attempts") or 0)
        if attempts >= MAX_ATTEMPTS:
            self._fail(table, row["id"], gave_up)
            return False
        response = (
            self._table(table)
            .update({
                "attempts": attempts + 1,
                "claimed_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", row["id"])
            .eq("status", "processing")
            .eq("attempts", attempts)
            .execute()
        )
        return bool(response.data)

    def download_audio(self, path: str) -> bytes:
        return self._client.storage.from_(AUDIO_BUCKET).download(path)

    def complete(self, row_id: str, fields: Row) -> None:
        self._complete("analyses", row_id, fields)

    def fail(self, row_id: str, message: str) -> None:
        self._fail("analyses", row_id, message)

    def _complete(self, table: str, row_id: str, fields: Row) -> None:
        self._table(table).update({**fields, "status": "ready", "error": None}).eq("id", row_id).execute()

    def _fail(self, table: str, row_id: str, message: str) -> None:
        self._table(table).update({"status": "failed", "error": message[:500]}).eq("id", row_id).execute()

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

    def fetch_pending_attempts(self, analyzer_version: str, limit: int) -> list[Row]:
        return self._fetch_pending(
            "attempts",
            "id,analysis_id,phrase_id,audio_path,model_size,attempts,feedback_model,"
            "feedback_models(provider,model,label)",
            analyzer_version,
            limit,
        )

    def claim_attempt(self, row: Row) -> bool:
        return self._claim("attempts", row, "Feedback did not finish after several attempts.")

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
