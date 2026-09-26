"""Process one claimed shadowing attempt end to end.

The reference was analysed once, when the clip was requested; its
``Recording`` is stored on the analyses row. An attempt only has to analyse
the learner's take and compare the two, so it stays short enough to feel
interactive. main.py runs these on their own thread so a long reference
analysis never holds them up.
"""

from __future__ import annotations

import logging
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Callable

from prosody_coach.audio import AudioError
from prosody_coach.models import Phrase, Recording
from prosody_coach.pipeline import PipelineOptions, analyze_recording, build_comparison
from prosody_coach.transcribe import TranscriptionError
from prosody_worker.config import MAX_ATTEMPT_BYTES
from prosody_worker.serialize import to_comparison_view
from prosody_worker.store import AttemptStore, Row

log = logging.getLogger(__name__)

Analyzer = Callable[[str | Path, str, PipelineOptions], Recording]

NO_SPEECH = "We couldn't hear any speech in your take. Try again closer to the mic."


class AttemptError(RuntimeError):
    """An attempt that cannot be compared, with a message the UI can show."""


def process_attempt(row: Row, store: AttemptStore, analyze: Analyzer = analyze_recording) -> None:
    """Analyse the take, compare it with its reference and write the result.

    Expected failures mark the row failed with a readable message. Anything
    unexpected is recorded as a failure too, then re-raised for the log.
    """
    row_id = row["id"]
    try:
        reference = _load_reference(row, store)
        with tempfile.TemporaryDirectory(prefix="prosody_attempt_") as tmp:
            path = _download_take(row, store, Path(tmp))
            options = PipelineOptions(model_size=row.get("model_size") or PipelineOptions.model_size)
            user = analyze(path, "user", options)
    except AttemptError as exc:
        log.info("attempt %s failed: %s", row_id, exc)
        store.fail_attempt(row_id, str(exc))
        return
    except TranscriptionError as exc:
        log.info("attempt %s failed: %s", row_id, exc)
        store.fail_attempt(row_id, NO_SPEECH)
        return
    except AudioError as exc:
        log.info("attempt %s failed: %s", row_id, exc)
        store.fail_attempt(row_id, "Couldn't read that recording. Try recording it again.")
        return
    except Exception:
        store.fail_attempt(row_id, "Unexpected error while comparing your take.")
        raise

    if not user.words:
        store.fail_attempt(row_id, NO_SPEECH)
        return

    comparison = build_comparison(reference, user)
    # The temp path means nothing to readers of a world-readable row.
    user.path = row["audio_path"]
    store.complete_attempt(row_id, {
        "user_recording": user.to_dict(),
        "result": to_comparison_view(comparison),
    })
    log.info("attempt %s ready (%d issues)", row_id, len(comparison.issues))


def reference_excerpt(recording: Recording, phrase_id: int | None) -> Recording:
    """The part of the reference the learner shadowed.

    ``phrase_id`` is the 1-based phrase id from the practice view (None for
    the whole clip). Word-level prosody keeps the values measured in the
    full clip, where the speaker's baseline is best estimated; only the
    speaker-level rates are recomputed, since they feed the comparison's
    rate normalisation.
    """
    if phrase_id is None:
        return recording
    if not 1 <= phrase_id <= len(recording.phrases) or not recording.phrases[phrase_id - 1].words:
        raise AttemptError("That phrase is no longer part of this clip.")

    words = list(recording.phrases[phrase_id - 1].words)
    # The pause after the phrase belongs to the clip, not to what the
    # learner was asked to say.
    words[-1] = replace(words[-1], pause_after=0.0)
    span = max(words[-1].end - words[0].start, 1e-6)
    pause_time = sum(word.pause_after for word in words)

    return replace(
        recording,
        transcript=" ".join(word.text.strip() for word in words),
        words=words,
        phrases=[Phrase(words=words)],
        duration=span,
        speech_rate_wps=len(words) / span,
        articulation_rate_wps=len(words) / max(span - pause_time, 1e-6),
        total_pause_time=pause_time,
    )


def _load_reference(row: Row, store: AttemptStore) -> Recording:
    data = store.fetch_reference(row["analysis_id"])
    if not data or not data.get("words"):
        raise AttemptError("The reference clip for this take is no longer available.")
    return reference_excerpt(Recording.from_dict(data), row.get("phrase_id"))


def _download_take(row: Row, store: AttemptStore, dest: Path) -> Path:
    audio_path: str = row["audio_path"]
    try:
        data = store.download_attempt_audio(audio_path)
    except Exception as exc:  # storage client raises its own error types
        raise AttemptError(f"Could not read your uploaded take: {exc}") from exc
    if not data:
        raise AttemptError("Your take was empty. Try recording it again.")
    if len(data) > MAX_ATTEMPT_BYTES:
        raise AttemptError("Your take is too long to compare.")
    # Keep the extension so PyAV and Whisper pick the right demuxer.
    path = dest / f"take{Path(audio_path).suffix}"
    path.write_bytes(data)
    return path
