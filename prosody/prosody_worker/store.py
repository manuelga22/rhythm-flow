"""Supabase access for the worker.

Jobs talk to the ``AnalysisStore`` protocol rather than the Supabase client
directly, which keeps them testable with an in-memory fake and keeps every
query the worker issues in one place.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from prosody_worker.config import (
    AUDIO_BUCKET,
    CLAIM_TIMEOUT_SECONDS,
    MAX_ATTEMPTS,
    WorkerConfig,
)

Row = dict[str, Any]


class AnalysisStore(Protocol):
    def fetch_pending(self, analyzer_version: str, limit: int) -> list[Row]: ...

    def claim(self, row: Row) -> bool: ...

    def download_audio(self, path: str) -> bytes: ...

    def complete(self, row_id: str, fields: Row) -> None: ...

    def fail(self, row_id: str, message: str) -> None: ...

    def upload_audio(self, path: str, data: bytes) -> None: ...

    def upsert_ready(self, fields: Row) -> Row: ...


class SupabaseStore:
    """``AnalysisStore`` backed by supabase-py with the service-role key."""

    def __init__(self, config: WorkerConfig) -> None:
        try:
            from supabase import create_client
        except ImportError as exc:
            raise RuntimeError(
                "supabase is not installed; pip install -r requirements-worker.txt"
            ) from exc
        self._client = create_client(config.supabase_url, config.service_role_key)

    def _table(self):
        return self._client.table("analyses")

    def fetch_pending(self, analyzer_version: str, limit: int) -> list[Row]:
        stale = (datetime.now(timezone.utc) - timedelta(seconds=CLAIM_TIMEOUT_SECONDS)).isoformat()
        response = (
            self._table()
            .select("id,source_type,source_key,title,model_size,audio_path,attempts")
            .eq("status", "processing")
            .eq("analyzer_version", analyzer_version)
            .or_(f"claimed_at.is.null,claimed_at.lt.{stale}")
            .order("created_at")
            .limit(limit)
            .execute()
        )
        return list(response.data or [])

    def claim(self, row: Row) -> bool:
        """Compare-and-set on ``attempts`` so only one worker wins a row.

        Rows that have already used up their attempts (a worker kept dying
        on them) are marked failed instead of being retried forever.
        """
        attempts = int(row.get("attempts") or 0)
        if attempts >= MAX_ATTEMPTS:
            self.fail(row["id"], "Analysis did not finish after several attempts.")
            return False
        response = (
            self._table()
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
        self._table().update({**fields, "status": "ready", "error": None}).eq("id", row_id).execute()

    def fail(self, row_id: str, message: str) -> None:
        self._table().update({"status": "failed", "error": message[:500]}).eq("id", row_id).execute()

    def upload_audio(self, path: str, data: bytes) -> None:
        """Store reference audio. Paths are content-addressed, so an object
        that already exists holds these exact bytes and is left alone."""
        try:
            self._client.storage.from_(AUDIO_BUCKET).upload(
                path, data, {"content-type": "audio/wav", "upsert": "false"}
            )
        except Exception as exc:  # storage client raises its own error types
            if not re.search(r"exists|duplicate", str(exc), re.IGNORECASE):
                raise

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
