"""Convert analysis results into the view models the Practice UI renders.

The shape matches ``PracticePhrase`` in ``src/components/cadence/data.ts``:

    {id, text, start, end, durationSeconds, pauseMs?, structure: [{text, accent?}]}

``Recording.to_dict()`` is stored alongside this for completeness, but it
only emits dataclass fields, so phrase text, timing and pauses (which are
properties) have to be derived here from the live objects.
"""

from __future__ import annotations

import math
import re
from typing import Any

from prosody_coach.models import Comparison, IssueType, PitchMovement, Prominence, Recording, Word

# Pauses shorter than this are ordinary articulation gaps, not phrasing.
MIN_PAUSE_SECONDS = 0.05

_ACCENTS = {PitchMovement.RISING: "up", PitchMovement.FALLING: "down"}
_TRAILING_PUNCTUATION = re.compile(r"^(.*?)([.,!?;:…]*)$", re.DOTALL)


def to_practice_view(recording: Recording, title: str | None = None) -> dict[str, Any]:
    phrases = []
    for index, phrase in enumerate(recording.phrases, start=1):
        if not phrase.words:
            continue
        is_last = index == len(recording.phrases)
        entry: dict[str, Any] = {
            "id": index,
            "text": " ".join(_token(word) for word in phrase.words),
            "start": round(phrase.start, 2),
            "end": round(phrase.end, 2),
            "durationSeconds": max(0.1, round(phrase.duration, 1)),
            "structure": _structure(phrase.words),
        }
        if not is_last and phrase.pause_after >= MIN_PAUSE_SECONDS:
            entry["pauseMs"] = round(phrase.pause_after * 1000)
        phrases.append(entry)

    return {
        "title": title,
        "duration": round(recording.duration, 1),
        "transcript": recording.transcript.strip(),
        "phrases": phrases,
    }


def to_comparison_view(comparison: Comparison) -> dict[str, Any]:
    """The Feedback tab's view of one attempt.

    Word flags follow ``render_comparison_line`` in prosody_coach.render, so
    the app and the CLI colour the same words the same way.
    """
    flagged = {
        issue_type: {issue.detail.get("word") for issue in comparison.issues if issue.type is issue_type}
        for issue_type in (IssueType.EXCESSIVE_PROMINENCE, IssueType.MISSING_PROMINENCE)
    }

    words: list[dict[str, Any]] = []
    for pair in comparison.pairs:
        if pair.user is None:
            if pair.reference is not None:
                words.append({"text": _token(pair.reference), "flag": "missing_word"})
            continue
        word = pair.user
        if word.normalized in flagged[IssueType.EXCESSIVE_PROMINENCE]:
            flag = "extra_stress"
        elif word.normalized in flagged[IssueType.MISSING_PROMINENCE]:
            flag = "missing_stress"
        elif word.prominence is Prominence.ANCHOR:
            matched = pair.reference is not None and pair.reference.prominence is Prominence.ANCHOR
            flag = "hit_beat" if matched else "stressed"
        elif word.prominence is Prominence.BRIDGE:
            flag = "reduced"
        else:
            flag = None
        entry: dict[str, Any] = {"text": _token(word), "flag": flag}
        if word.pause_after >= MIN_PAUSE_SECONDS:
            entry["pauseAfter"] = round(word.pause_after, 2)
        words.append(entry)

    reference_beats = [pair for pair in comparison.pairs if pair.reference and pair.reference.prominence is Prominence.ANCHOR]
    matched_beats = [pair for pair in reference_beats if pair.user and pair.user.prominence is Prominence.ANCHOR]
    feedback = comparison.feedback

    return {
        "reference": _structure(comparison.reference.words),
        "words": words,
        "beats": {"matched": len(matched_beats), "total": len(reference_beats)},
        "pace": {
            # >1 means the user spoke more slowly than the reference.
            "rateRatio": round(comparison.rate_ratio, 3),
            "userWps": _finite(round(comparison.user.articulation_rate_wps, 2)),
            "referenceWps": _finite(round(comparison.reference.articulation_rate_wps, 2)),
        },
        "feedback": {
            "positive": feedback.positive,
            "primary": feedback.primary_issue,
            "secondary": feedback.secondary_issue,
            "next": feedback.next_attempt,
        },
        "categories": [
            {"name": category.name, "verdict": category.verdict, "comment": category.comment}
            for category in feedback.categories
        ],
    }


def summary_fields(recording: Recording) -> dict[str, Any]:
    """The speaker-level metrics stored as typed columns on ``analyses``."""
    return {
        "transcript": recording.transcript.strip(),
        "duration_seconds": round(recording.duration, 2),
        "pitch_baseline_hz": _finite(recording.pitch_baseline_hz),
        "pitch_range_hz": _finite(recording.pitch_range_hz),
        "speech_rate_wps": _finite(recording.speech_rate_wps),
        "articulation_rate_wps": _finite(recording.articulation_rate_wps),
        "total_pause_time": _finite(recording.total_pause_time),
    }


def _finite(value: float) -> float | None:
    return value if math.isfinite(value) else None


def _token(word: Word) -> str:
    # Whisper prefixes words with a space; the view joins them itself.
    return word.text.strip()


def _structure(words: list[Word]) -> list[dict[str, str]]:
    """Split a phrase into plain runs and accented beats.

    A beat is an anchor word with a clear rise or fall. Trailing punctuation
    stays outside the beat so the UI renders ``QUICK↘,`` rather than
    ``QUICK,↘``. Joining every part's text reproduces the phrase text.
    """
    parts: list[dict[str, str]] = []
    buffer = ""

    for position, word in enumerate(words):
        token = _token(word)
        separator = " " if position else ""
        accent = _ACCENTS.get(word.pitch_movement) if word.prominence is Prominence.ANCHOR else None

        if accent is None:
            buffer += separator + token
            continue

        match = _TRAILING_PUNCTUATION.match(token)
        core, trailing = (match.group(1), match.group(2)) if match else (token, "")
        if not core:
            buffer += separator + token
            continue

        buffer += separator
        if buffer:
            parts.append({"text": buffer})
        parts.append({"text": core, "accent": accent})
        buffer = trailing

    if buffer:
        parts.append({"text": buffer})
    return parts
