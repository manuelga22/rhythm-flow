"""Transcription with word-level timestamps.

Backed by faster-whisper running locally on CPU. The import is deferred to
call time so that the rest of the package, and the test suite, work without
the heavyweight model dependency installed.

Word timings from Whisper come from cross-attention alignment. They are good
to roughly 30-50 ms on clean speech, which is adequate for word-level
prosody: we care about ratios between word durations and about which word
carries a pitch peak, not about phoneme boundaries.

This module takes in an audio file and returns a Transcript object, which
contains all the words that were said and the timing for each.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
import threading
from functools import lru_cache
from pathlib import Path


# "small" balances accuracy against CPU speed. Overridable per run, and via
# the environment so a machine with more headroom can default higher.
DEFAULT_MODEL = os.environ.get("PROSODY_WHISPER_MODEL", "small")
DEFAULT_COMPUTE = os.environ.get("PROSODY_WHISPER_COMPUTE", "int8")


class TranscriptionError(RuntimeError):
    """Raised when transcription is unavailable or produces nothing usable."""


@dataclass
class TimedWord:
    """A word with its start and end time in seconds."""

    text: str
    start: float
    end: float


@dataclass
class Transcript:
    text: str
    words: list[TimedWord]


# The worker transcribes on two threads. lru_cache does not stop both from
# loading the same model at once on first use, so loads are serialised.
# A loaded model is safe to share: CTranslate2 handles concurrent calls.
_LOAD_LOCK = threading.Lock()


def _load_model(model_size: str, compute_type: str):
    with _LOAD_LOCK:
        return _load_model_cached(model_size, compute_type)


@lru_cache(maxsize=2)
def _load_model_cached(model_size: str, compute_type: str):
    """Load and cache a Whisper model.

    Cached because a CLI run transcribes two files and reloading the model
    for the second would roughly double the wall time.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise TranscriptionError(
            "faster-whisper is not installed, so audio cannot be transcribed.\n"
            "  Install it with:  pip install -r requirements.txt\n"
            "  Or run 'python demo.py' to see the algorithm on synthetic audio."
        ) from exc

    try:
        return WhisperModel(model_size, device="cpu", compute_type=compute_type)
    except Exception as exc:
        raise TranscriptionError(
            f"Could not load Whisper model '{model_size}': {exc}"
        ) from exc


def transcribe(
    path: str | Path,
    *,
    model_size: str = DEFAULT_MODEL,
    compute_type: str = DEFAULT_COMPUTE,
    language: str = "en"
) -> Transcript:
    """Transcribe ``path`` and return word-level timings.

    ``initial_prompt`` biases decoding toward an expected wording. It is used
    for the user recording during shadowing, where the reference transcript
    is already known, which materially improves word-timing accuracy on
    accented speech.
    """
    model = _load_model(model_size, compute_type)

    segments, _info = model.transcribe(
        str(path),
        language=language,
        word_timestamps=True,
        # Conservative VAD: we must not let the transcriber delete the very
        # pauses the prosody analysis is trying to measure.
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 700, "speech_pad_ms": 200},
        beam_size=5,
        condition_on_previous_text=False,
    )

    words: list[TimedWord] = []
    pieces: list[str] = []
    for segment in segments:
        pieces.append(segment.text.strip())
        for word in (segment.words or []):
            text = word.word.strip()
            if not text:
                continue
            start = float(word.start)
            end = float(word.end)
            if end <= start:
                # Whisper occasionally emits a zero-width word. Give it a
                # nominal duration so downstream ratios stay finite.
                end = start + 0.01
            words.append(TimedWord(text=text, start=start, end=end))

    if not words:
        raise TranscriptionError(
            f"No speech detected in {Path(path).name}. "
            "Check that the file contains audible speech."
        )

    text = " ".join(p for p in pieces if p).strip()
    return Transcript(text=text or " ".join(w.text for w in words), words=words)


def transcript_from_text(text: str, words: list[TimedWord]) -> Transcript:
    """Build a Transcript from externally supplied pieces."""
    return Transcript(text=text, words=words)
