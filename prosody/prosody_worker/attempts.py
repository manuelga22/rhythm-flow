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

from prosody_coach.audio import AudioError, encode_clip
from prosody_coach.listen import listen_feedback
from prosody_coach.models import Comparison, Feedback, Phrase, Recording
from prosody_coach.pipeline import PipelineOptions, analyze_recording, build_comparison
from prosody_coach.transcribe import TranscriptionError
from prosody_worker.config import CLIP_PAD_SECONDS, MAX_ATTEMPT_BYTES
from prosody_worker.serialize import to_comparison_view
from prosody_worker.store import AttemptStore, Row

log = logging.getLogger(__name__)

Analyzer = Callable[[str | Path, str, PipelineOptions], Recording]
Listener = Callable[..., Feedback]

NO_SPEECH = "We couldn't hear any speech in your take. Try again closer to the mic."


class AttemptError(RuntimeError):
    """An attempt that cannot be compared, with a message the UI can show."""


def process_attempt(
    row: Row,
    store: AttemptStore,
    analyze: Analyzer = analyze_recording,
    listen: Listener = listen_feedback,
) -> None:
    """Analyse the take, compare it with its reference and write the result.

    Expected failures mark the row failed with a readable message. Anything
    unexpected is recorded as a failure too, then re-raised for the log.
    """
    row_id = row["id"]
    try:
        reference_row = _load_reference_row(row, store)
        reference = reference_excerpt(Recording.from_dict(reference_row["recording"]), row.get("phrase_id"))
        with tempfile.TemporaryDirectory(prefix="prosody_attempt_") as tmp:
            path = _download_take(row, store, Path(tmp))
            options = PipelineOptions(model_size=row.get("model_size") or PipelineOptions.model_size)
            user = analyze(path, "user", options)
            if not user.words:
                store.fail_attempt(row_id, NO_SPEECH)
                return
            comparison = build_comparison(reference, user)
            _listen(row, store, comparison, path, reference, reference_row.get("clip_path"), Path(tmp), listen)
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

    # The temp path means nothing to readers of a world-readable row.
    user.path = row["audio_path"]
    store.complete_attempt(row_id, {
        "user_recording": user.to_dict(),
        "result": to_comparison_view(comparison),
    })
    log.info(
        "attempt %s ready (%d issues, %s feedback)",
        row_id, len(comparison.issues), comparison.feedback.model or comparison.feedback.source,
    )


def _listen(
    row: Row,
    store: AttemptStore,
    comparison: Comparison,
    take: Path,
    reference: Recording,
    clip_path: str | None,
    tmp: Path,
    listen: Listener,
) -> None:
    """Replace the template feedback with feedback from the model the
    learner chose, if it listens. Any failure keeps the templates: the
    learner still gets feedback, and the reason goes to the log."""
    choice = row.get("feedback_models") or {}
    if choice.get("provider") != "gemini" or not choice.get("model"):
        return
    try:
        take_clip = encode_clip(take, tmp / "take.ogg")
        reference_clip = _reference_clip(store, reference, clip_path, tmp)
        comparison.feedback = listen(
            comparison, take_clip, reference_clip, choice["model"], label=choice.get("label"),
        )
    except Exception:
        log.warning("attempt %s: %s feedback failed, using templates", row["id"], choice["model"], exc_info=True)


def _reference_clip(store: AttemptStore, reference: Recording, clip_path: str | None, tmp: Path) -> Path | None:
    """The practised part of the stored reference clip, or None when this
    reference was analysed before clips were kept."""
    if not clip_path or not reference.words:
        return None
    full = tmp / "reference_full.ogg"
    full.write_bytes(store.download_clip(clip_path))
    start = max(0.0, reference.words[0].start - CLIP_PAD_SECONDS)
    end = reference.words[-1].end + CLIP_PAD_SECONDS
    return encode_clip(full, tmp / "reference.ogg", start=start, end=end)


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


def _load_reference_row(row: Row, store: AttemptStore) -> Row:
    data = store.fetch_reference(row["analysis_id"])
    if not data or not (data.get("recording") or {}).get("words"):
        raise AttemptError("The reference clip for this take is no longer available.")
    return data


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
