"""Process one claimed analysis row end to end."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Callable

from prosody_coach.audio import AudioError, encode_clip
from prosody_coach.models import Recording
from prosody_coach.pipeline import PipelineOptions, analyze_recording
from prosody_coach.transcribe import TranscriptionError
from prosody_worker.serialize import summary_fields, to_practice_view
from prosody_worker.sources import (
    ResolvedSource,
    SourceError,
    download_youtube_audio,
    verify_upload,
)
from prosody_worker.store import AnalysisStore, Row

log = logging.getLogger(__name__)

Analyzer = Callable[[str | Path, str, PipelineOptions], Recording]
YoutubeFetcher = Callable[[str, Path], ResolvedSource]


def process(
    row: Row,
    store: AnalysisStore,
    analyze: Analyzer = analyze_recording,
    fetch_youtube: YoutubeFetcher = download_youtube_audio,
) -> None:
    """Resolve the row's audio, analyse it and write the result back.

    Expected failures (bad source, undecodable audio, no speech) mark the
    row failed with a message the UI can show. Anything unexpected is also
    recorded as a failure, then re-raised so the worker logs the traceback.
    """
    row_id = row["id"]
    try:
        with tempfile.TemporaryDirectory(prefix="prosody_job_") as tmp:
            source = _resolve(row, store, Path(tmp), fetch_youtube)
            options = PipelineOptions(model_size=row.get("model_size") or PipelineOptions.model_size)
            recording = analyze(source.path, "reference", options)
            clip_path = _store_clip(row_id, source.path, store) if recording.words else None
    except (SourceError, AudioError, TranscriptionError) as exc:
        log.info("analysis %s failed: %s", row_id, exc)
        store.fail(row_id, str(exc))
        return
    except Exception:
        store.fail(row_id, "Unexpected error while analysing this clip.")
        raise

    if not recording.words:
        store.fail(row_id, "No speech was found in this clip.")
        return

    title = row.get("title") or source.title
    # The local temp path means nothing to readers and leaks the host's
    # directory layout into a world-readable row.
    recording.path = row["source_key"]
    store.complete(row_id, {
        **summary_fields(recording),
        "title": title,
        "recording": recording.to_dict(),
        "view": to_practice_view(recording, title),
        "clip_path": clip_path,
    })
    log.info("analysis %s ready (%d phrases)", row_id, len(recording.phrases))


def _store_clip(row_id: str, source: Path, store: AnalysisStore) -> str | None:
    """Save a compressed copy of the reference for models that listen to
    takes. YouTube audio is not kept otherwise. Best effort: without a clip
    those models hear the learner's take only."""
    path = f"clips/{row_id}.ogg"
    try:
        clip = encode_clip(source, source.with_name("clip.ogg"))
        store.upload_audio(path, clip.read_bytes(), content_type="audio/ogg", upsert=True)
    except Exception:
        log.warning("analysis %s: could not store the listening clip", row_id, exc_info=True)
        return None
    return path


def _resolve(row: Row, store: AnalysisStore, dest: Path, fetch_youtube: YoutubeFetcher) -> ResolvedSource:
    source_type = row["source_type"]
    source_key: str = row["source_key"]

    if source_type == "youtube":
        return fetch_youtube(source_key.removeprefix("youtube:"), dest)
    if source_type == "upload":
        if not row.get("audio_path"):
            raise SourceError("Upload is missing its audio file.")
        try:
            data = store.download_audio(row["audio_path"])
        except Exception as exc:  # storage client raises its own error types
            raise SourceError(f"Could not read the uploaded audio: {exc}") from exc
        return verify_upload(data, source_key, dest)
    raise SourceError(f"Unknown source type: {source_type}")
